//! CFNetwork performs system exclusions, PAC discovery and evaluation.
use crate::network::NetworkSettings;
use anyhow::{bail, Context, Result};
use std::{
    ffi::{c_void, CString},
    ptr,
    time::{Duration, Instant},
};
type Ref = *const c_void;
struct Owned(Ref);
impl Drop for Owned {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CFRelease(self.0) }
        }
    }
}
#[repr(C)]
struct ClientContext {
    version: isize,
    info: *mut c_void,
    retain: Option<unsafe extern "C" fn(Ref) -> Ref>,
    release: Option<unsafe extern "C" fn(Ref)>,
    description: Option<unsafe extern "C" fn(Ref) -> Ref>,
}
type Callback = unsafe extern "C" fn(*mut c_void, Ref, Ref);
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(value: Ref);
    fn CFEqual(a: Ref, b: Ref) -> u8;
    fn CFStringCreateWithCString(allocator: Ref, text: *const i8, encoding: u32) -> Ref;
    fn CFStringGetCString(value: Ref, buffer: *mut i8, size: isize, encoding: u32) -> u8;
    fn CFURLCreateWithString(allocator: Ref, string: Ref, base: Ref) -> Ref;
    fn CFArrayGetCount(array: Ref) -> isize;
    fn CFArrayGetValueAtIndex(array: Ref, index: isize) -> Ref;
    fn CFDictionaryGetValue(dictionary: Ref, key: Ref) -> Ref;
    fn CFNumberGetValue(number: Ref, kind: isize, value: *mut c_void) -> u8;
    fn CFRunLoopGetCurrent() -> Ref;
    fn CFRunLoopAddSource(loop_ref: Ref, source: Ref, mode: Ref);
    fn CFRunLoopSourceInvalidate(source: Ref);
    fn CFRunLoopRunInMode(mode: Ref, seconds: f64, return_after: u8) -> i32;
    static kCFRunLoopDefaultMode: Ref;
}
#[link(name = "CFNetwork", kind = "framework")]
extern "C" {
    fn CFNetworkCopySystemProxySettings() -> Ref;
    fn CFNetworkCopyProxiesForURL(url: Ref, settings: Ref) -> Ref;
    fn CFNetworkExecuteProxyAutoConfigurationURL(
        pac: Ref,
        url: Ref,
        callback: Callback,
        context: *mut ClientContext,
    ) -> Ref;
    fn CFNetworkExecuteProxyAutoConfigurationScript(
        pac: Ref,
        url: Ref,
        callback: Callback,
        context: *mut ClientContext,
    ) -> Ref;
    static kCFProxyTypeKey: Ref;
    static kCFProxyTypeNone: Ref;
    static kCFProxyTypeHTTP: Ref;
    static kCFProxyTypeHTTPS: Ref;
    static kCFProxyTypeSOCKS: Ref;
    static kCFProxyTypeAutoConfigurationURL: Ref;
    static kCFProxyTypeAutoConfigurationJavaScript: Ref;
    static kCFProxyAutoConfigurationURLKey: Ref;
    static kCFProxyAutoConfigurationJavaScriptKey: Ref;
    static kCFProxyHostNameKey: Ref;
    static kCFProxyPortNumberKey: Ref;
}
fn cf_url(value: &str) -> Result<Owned> {
    let text = CString::new(value)?;
    let string =
        Owned(unsafe { CFStringCreateWithCString(ptr::null(), text.as_ptr(), 0x08000100) });
    let url = Owned(unsafe { CFURLCreateWithString(ptr::null(), string.0, ptr::null()) });
    if url.0.is_null() {
        bail!("Invalid proxy target URL")
    }
    Ok(url)
}
unsafe fn string(value: Ref) -> Result<String> {
    if value.is_null() {
        bail!("Proxy hostname is missing")
    }
    let mut bytes = vec![0i8; 4096];
    if CFStringGetCString(value, bytes.as_mut_ptr(), bytes.len() as isize, 0x08000100) == 0 {
        bail!("Proxy hostname is invalid")
    }
    Ok(std::ffi::CStr::from_ptr(bytes.as_ptr())
        .to_string_lossy()
        .into_owned())
}
unsafe fn route(list: Ref, target: Ref, allow_pac: bool) -> Result<Vec<String>> {
    if list.is_null() || CFArrayGetCount(list) == 0 {
        bail!("Native proxy lookup returned no route")
    }
    let count = CFArrayGetCount(list);
    if count > 16 {
        bail!("Excessive native proxy route list");
    }
    let mut routes = Vec::new();
    for index in 0..count {
        let dictionary = CFArrayGetValueAtIndex(list, index);
        let kind = CFDictionaryGetValue(dictionary, kCFProxyTypeKey);
        if kind.is_null() {
            bail!("Native proxy type is missing")
        }
        if CFEqual(kind, kCFProxyTypeNone) != 0 {
            routes.push(String::new());
            continue;
        }
        if CFEqual(kind, kCFProxyTypeAutoConfigurationURL) != 0
            || CFEqual(kind, kCFProxyTypeAutoConfigurationJavaScript) != 0
        {
            if !allow_pac {
                bail!("PAC returned another PAC route")
            }
            let javascript = CFEqual(kind, kCFProxyTypeAutoConfigurationJavaScript) != 0;
            let value = CFDictionaryGetValue(
                dictionary,
                if javascript {
                    kCFProxyAutoConfigurationJavaScriptKey
                } else {
                    kCFProxyAutoConfigurationURLKey
                },
            );
            if value.is_null() {
                bail!("System PAC configuration is missing")
            }
            routes.extend(evaluate(value, target, javascript)?);
            continue;
        }
        let scheme = if CFEqual(kind, kCFProxyTypeSOCKS) != 0 {
            "socks5h"
        } else if CFEqual(kind, kCFProxyTypeHTTP) != 0 || CFEqual(kind, kCFProxyTypeHTTPS) != 0 {
            "http"
        } else {
            bail!("Unsupported native proxy type")
        };
        let host = string(CFDictionaryGetValue(dictionary, kCFProxyHostNameKey))?;
        let mut port = 0i32;
        let number = CFDictionaryGetValue(dictionary, kCFProxyPortNumberKey);
        if number.is_null()
            || CFNumberGetValue(number, 3, (&mut port as *mut i32).cast()) == 0
            || !(1..=65535).contains(&port)
        {
            bail!("Native proxy port is invalid")
        }
        let host = if host.contains(':') {
            format!("[{host}]")
        } else {
            host
        };
        routes.push(format!("{scheme}://{host}:{port}"));
    }
    if routes.len() > 16 {
        bail!("Excessive native proxy route list");
    }
    Ok(routes)
}
struct Evaluation {
    target: Ref,
    result: Option<Result<Vec<String>>>,
}
unsafe extern "C" fn complete(client: *mut c_void, list: Ref, error: Ref) {
    let state = &mut *(client as *mut Evaluation);
    state.result = Some(if error.is_null() {
        route(list, state.target, false)
    } else {
        Err(anyhow::anyhow!(
            "PAC evaluation failed; routing was not bypassed"
        ))
    });
}
unsafe fn evaluate(script: Ref, target: Ref, javascript: bool) -> Result<Vec<String>> {
    let mut state = Evaluation {
        target,
        result: None,
    };
    let mut context = ClientContext {
        version: 0,
        info: (&mut state as *mut Evaluation).cast(),
        retain: None,
        release: None,
        description: None,
    };
    let source = Owned(if javascript {
        CFNetworkExecuteProxyAutoConfigurationScript(script, target, complete, &mut context)
    } else {
        CFNetworkExecuteProxyAutoConfigurationURL(script, target, complete, &mut context)
    });
    if source.0.is_null() {
        bail!("PAC execution could not start")
    }
    CFRunLoopAddSource(CFRunLoopGetCurrent(), source.0, kCFRunLoopDefaultMode);
    let started = Instant::now();
    while state.result.is_none() && started.elapsed() < Duration::from_secs(10) {
        CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.1, 1);
    }
    CFRunLoopSourceInvalidate(source.0);
    state.result.context("PAC lookup exceeded ten seconds")?
}
pub fn system(url: &str) -> Result<Option<Vec<String>>> {
    let target = cf_url(url)?;
    let settings = Owned(unsafe { CFNetworkCopySystemProxySettings() });
    if settings.0.is_null() {
        return Ok(None);
    }
    let proxies = Owned(unsafe { CFNetworkCopyProxiesForURL(target.0, settings.0) });
    unsafe { route(proxies.0, target.0, true).map(Some) }
}
pub fn pac(url: &str, script: &str, _settings: &NetworkSettings) -> Result<Vec<String>> {
    let target = cf_url(url)?;
    let source = cf_url(script)?;
    unsafe { evaluate(source.0, target.0, false) }
}
