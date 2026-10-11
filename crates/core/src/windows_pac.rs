//! WinHTTP's cancellable resolver preserves the PAC list, including explicit DIRECT.
use anyhow::{bail, Context, Result};
use std::{
    collections::HashMap,
    ffi::c_void,
    ptr,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Condvar, Mutex, OnceLock,
    },
    time::Duration,
};
#[repr(C)]
struct Options {
    flags: u32,
    detect: u32,
    url: *const u16,
    reserved: *mut c_void,
    flags2: u32,
    login: i32,
}
#[repr(C)]
struct Entry {
    proxy: i32,
    bypass: i32,
    scheme: i32,
    host: *mut u16,
    port: u16,
}
#[repr(C)]
struct ProxyResult {
    count: u32,
    entries: *mut Entry,
}
#[repr(C)]
struct AsyncResult {
    result: usize,
    error: u32,
}
type Callback = unsafe extern "system" fn(*mut c_void, usize, u32, *mut c_void, u32);
#[link(name = "winhttp")]
extern "system" {
    fn WinHttpOpen(
        agent: *const u16,
        access: u32,
        proxy: *const u16,
        bypass: *const u16,
        flags: u32,
    ) -> *mut c_void;
    fn WinHttpCloseHandle(handle: *mut c_void) -> i32;
    fn WinHttpSetStatusCallback(
        handle: *mut c_void,
        callback: Callback,
        flags: u32,
        reserved: usize,
    ) -> usize;
    fn WinHttpCreateProxyResolver(session: *mut c_void, resolver: *mut *mut c_void) -> u32;
    fn WinHttpGetProxyForUrlEx(
        resolver: *mut c_void,
        url: *const u16,
        options: *mut Options,
        context: usize,
    ) -> u32;
    fn WinHttpGetProxyResult(resolver: *mut c_void, result: *mut ProxyResult) -> u32;
    fn WinHttpFreeProxyResult(result: *mut ProxyResult);
}
struct Handle(*mut c_void);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            WinHttpCloseHandle(self.0);
        }
    }
}
#[derive(Default)]
struct Completion {
    result: Mutex<Option<u32>>,
    changed: Condvar,
}
fn pending() -> &'static Mutex<HashMap<usize, Arc<Completion>>> {
    static PENDING: OnceLock<Mutex<HashMap<usize, Arc<Completion>>>> = OnceLock::new();
    PENDING.get_or_init(Default::default)
}
struct Registration(usize);
impl Drop for Registration {
    fn drop(&mut self) {
        pending().lock().unwrap().remove(&self.0);
    }
}
unsafe extern "system" fn complete(
    _handle: *mut c_void,
    id: usize,
    status: u32,
    info: *mut c_void,
    length: u32,
) {
    let value = match status {
        0x01000000 => 0,
        0x00200000 if !info.is_null() && length as usize >= std::mem::size_of::<AsyncResult>() => {
            (*(info.cast::<AsyncResult>())).error
        }
        _ => return,
    };
    // Numeric registrations avoid dangling callback pointers after cancellation/close.
    let state = pending().lock().unwrap().get(&id).cloned();
    if let Some(state) = state {
        *state.result.lock().unwrap() = Some(value);
        state.changed.notify_all();
    }
}
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
unsafe fn host(value: *const u16) -> Result<String> {
    if value.is_null() {
        bail!("Native proxy hostname missing");
    }
    for n in 0..4096 {
        if *value.add(n) == 0 {
            return Ok(String::from_utf16(std::slice::from_raw_parts(value, n))?);
        }
    }
    bail!("Native proxy hostname exceeds limit")
}
pub(super) fn resolve(url: &str, script: &str, allow_native_bypass: bool) -> Result<Vec<String>> {
    let agent = wide("Downloader");
    let target = wide(url);
    let script_wide = wide(script);
    let mut options = Options {
        flags: if script.is_empty() {
            1
        } else {
            2 | 0x00040000 | 0x00080000 | 0x00100000
        },
        detect: if script.is_empty() { 3 } else { 0 },
        url: if script.is_empty() {
            ptr::null()
        } else {
            script_wide.as_ptr()
        },
        reserved: ptr::null_mut(),
        flags2: 0,
        login: 0,
    };
    unsafe {
        let session = Handle(WinHttpOpen(
            agent.as_ptr(),
            1,
            ptr::null(),
            ptr::null(),
            0x10000000,
        ));
        if session.0.is_null() {
            return Err(std::io::Error::last_os_error())
                .context("System proxy session unavailable");
        }
        if WinHttpSetStatusCallback(session.0, complete, 0x01200000, 0) == usize::MAX {
            return Err(std::io::Error::last_os_error())
                .context("Proxy callback registration failed");
        }
        let mut raw = ptr::null_mut();
        let code = WinHttpCreateProxyResolver(session.0, &mut raw);
        if code != 0 {
            return Err(std::io::Error::from_raw_os_error(code as i32))
                .context("Proxy resolver unavailable");
        }
        let resolver = Handle(raw);
        static NEXT: AtomicUsize = AtomicUsize::new(1);
        let registration = Registration(NEXT.fetch_add(1, Ordering::Relaxed));
        let state = Arc::new(Completion::default());
        pending()
            .lock()
            .unwrap()
            .insert(registration.0, state.clone());
        let code =
            WinHttpGetProxyForUrlEx(resolver.0, target.as_ptr(), &mut options, registration.0);
        if code != 997 {
            return Err(std::io::Error::from_raw_os_error(code as i32))
                .context("PAC evaluation could not start");
        }
        let (result, timeout) = state
            .changed
            .wait_timeout_while(state.result.lock().unwrap(), Duration::from_secs(20), |r| {
                r.is_none()
            })
            .unwrap();
        if timeout.timed_out() && result.is_none() {
            bail!("PAC lookup exceeded twenty seconds; routing was not bypassed");
        }
        let code = result.context("PAC lookup returned no result")?;
        drop(result);
        if code != 0 {
            return Err(std::io::Error::from_raw_os_error(code as i32))
                .context("PAC evaluation failed; routing was not bypassed");
        }
        let mut native = ProxyResult {
            count: 0,
            entries: ptr::null_mut(),
        };
        let code = WinHttpGetProxyResult(resolver.0, &mut native);
        if code != 0 {
            return Err(std::io::Error::from_raw_os_error(code as i32))
                .context("PAC result unavailable");
        }
        let result = (|| {
            if native.count == 0 || native.count > 16 || native.entries.is_null() {
                bail!("Invalid native proxy route count");
            }
            let mut routes = Vec::new();
            let entries = std::slice::from_raw_parts(native.entries, native.count as usize);
            let contains_proxy = entries.iter().any(|entry| entry.proxy != 0);
            for entry in entries {
                if entry.proxy == 0 {
                    if entry.bypass != 0 && !allow_native_bypass && !contains_proxy {
                        bail!("protocol_unsupported: Windows requires a native bypass for this PAC target; use system or direct routing explicitly");
                    }
                    routes.push(String::new());
                    continue;
                }
                let scheme = match entry.scheme {
                    1 => "http",
                    2 => "https",
                    4 => "socks5h",
                    _ => bail!("Unsupported native proxy scheme"),
                };
                let hostname = host(entry.host)?;
                if entry.port == 0 || hostname.is_empty() {
                    bail!("Invalid native proxy address");
                }
                let hostname = if hostname.contains(':') && !hostname.starts_with('[') {
                    format!("[{hostname}]")
                } else {
                    hostname
                };
                routes.push(format!("{scheme}://{hostname}:{}", entry.port));
            }
            Ok(routes)
        })();
        WinHttpFreeProxyResult(&mut native);
        result
    }
}
