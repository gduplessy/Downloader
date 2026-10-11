//! Platform proxy lookup stays local; explicit PAC failures never select direct routing.
#[cfg(not(target_os = "macos"))]
use crate::network::NetworkSettings;
#[cfg(not(target_os = "macos"))]
use anyhow::bail;
#[cfg(target_os = "linux")]
use anyhow::Context;
#[cfg(not(target_os = "macos"))]
use anyhow::Result;

#[cfg(target_os = "linux")]
pub fn system(url: &str) -> Result<Option<Vec<String>>> {
    use std::ffi::{CStr, CString};
    unsafe {
        let Ok(library) = libloading::Library::new("libproxy.so.1") else {
            return Ok(None);
        };
        let new: libloading::Symbol<unsafe extern "C" fn() -> *mut std::ffi::c_void> =
            library.get(b"px_proxy_factory_new\0")?;
        let get: libloading::Symbol<
            unsafe extern "C" fn(*mut std::ffi::c_void, *const i8) -> *mut *mut i8,
        > = library.get(b"px_proxy_factory_get_proxies\0")?;
        let free_list: libloading::Symbol<unsafe extern "C" fn(*mut *mut i8)> =
            library.get(b"px_proxy_factory_free_proxies\0")?;
        let free: libloading::Symbol<unsafe extern "C" fn(*mut std::ffi::c_void)> =
            library.get(b"px_proxy_factory_free\0")?;
        let target = CString::new(url)?;
        let factory = new();
        if factory.is_null() {
            bail!("System proxy factory unavailable")
        }
        let list = get(factory, target.as_ptr());
        let route = if list.is_null() || (*list).is_null() {
            None
        } else {
            let mut routes = Vec::new();
            let mut i = 0;
            while !(*list.add(i)).is_null() && i < 17 {
                let value = CStr::from_ptr(*list.add(i)).to_string_lossy().into_owned();
                routes.push(if value == "direct://" {
                    String::new()
                } else {
                    value
                });
                i += 1;
            }
            Some(routes)
        };
        if !list.is_null() {
            free_list(list);
        }
        free(factory);
        route
            .map(Some)
            .context("System proxy lookup returned no route")
    }
}
#[cfg(target_os = "linux")]
pub fn pac(url: &str, script_url: &str, settings: &NetworkSettings) -> Result<Vec<String>> {
    use std::{
        ffi::{CStr, CString},
        sync::Mutex,
        time::Duration,
    };
    static PARSER: Mutex<()> = Mutex::new(());
    let mut easy = curl::easy::Easy::new();
    easy.url(script_url)?;
    easy.proxy("")?;
    easy.timeout(Duration::from_secs(10))?;
    easy.connect_timeout(Duration::from_secs(5))?;
    easy.ssl_verify_peer(true)?;
    easy.ssl_verify_host(true)?;
    if let Some(ca) = &settings.ca_file {
        easy.cainfo(ca)?;
    }
    let mut bytes = Vec::new();
    {
        let mut transfer = easy.transfer();
        transfer.write_function(|d| {
            if bytes.len() + d.len() > 1024 * 1024 {
                return Ok(0);
            }
            bytes.extend_from_slice(d);
            Ok(d.len())
        })?;
        transfer.perform().context("PAC download failed")?;
    }
    if easy.response_code() != Ok(200) {
        bail!("PAC download did not return HTTP 200")
    }
    let script = CString::new(String::from_utf8(bytes)?)?;
    let target = CString::new(url)?;
    let parsed = url::Url::parse(url)?;
    let host = CString::new(parsed.host_str().context("PAC target has no host")?)?;
    let _lock = PARSER.lock().unwrap();
    unsafe {
        let library = libloading::Library::new("libpacparser.so.1")
            .context("protocol_unsupported: Install libpacparser1 for PAC routing")?;
        let init: libloading::Symbol<unsafe extern "C" fn() -> i32> =
            library.get(b"pacparser_init\0")?;
        let parse: libloading::Symbol<unsafe extern "C" fn(*const i8) -> i32> =
            library.get(b"pacparser_parse_pac_string\0")?;
        let find: libloading::Symbol<unsafe extern "C" fn(*const i8, *const i8) -> *const i8> =
            library.get(b"pacparser_find_proxy\0")?;
        let cleanup: libloading::Symbol<unsafe extern "C" fn()> =
            library.get(b"pacparser_cleanup\0")?;
        if init() == 0 {
            bail!("PAC parser initialization failed")
        }
        let result = if parse(script.as_ptr()) == 0 {
            Err(anyhow::anyhow!("PAC script evaluation failed"))
        } else {
            let value = find(target.as_ptr(), host.as_ptr());
            if value.is_null() {
                Err(anyhow::anyhow!("PAC returned no route"))
            } else {
                crate::network::pac_routes(&CStr::from_ptr(value).to_string_lossy())
            }
        };
        cleanup();
        result
    }
}
#[cfg(target_os = "macos")]
#[path = "system_proxy_macos.rs"]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::{pac, system};

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn system(_url: &str) -> Result<Option<Vec<String>>> {
    Ok(None)
}
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn pac(_url: &str, _script: &str, _settings: &NetworkSettings) -> Result<Vec<String>> {
    bail!("protocol_unsupported: Native PAC adapter is unavailable on this platform")
}
