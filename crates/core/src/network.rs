//! Explicit routing and build capability policy; TLS verification is never disabled.
use anyhow::{bail, Context, Result};
use curl::easy::{Auth, Easy, HttpVersion};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, time::Duration};
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProxyMode {
    #[default]
    System,
    Direct,
    Manual,
    Pac,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Authentication {
    #[default]
    Auto,
    Basic,
    Digest,
    Ntlm,
    Negotiate,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HttpPolicy {
    #[default]
    Auto,
    Http1,
    Http2Tls,
    Http2PriorKnowledge,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct NetworkSettings {
    pub proxy_mode: ProxyMode,
    pub pac_url: Option<String>,
    pub ca_file: Option<PathBuf>,
    pub authentication: Authentication,
    pub proxy_authentication: Authentication,
    pub http_policy: HttpPolicy,
    pub segmented: bool,
    pub ftp_tls: bool,
    pub retries: u32,
    pub connect_timeout_seconds: u64,
    pub stall_timeout_seconds: u64,
    pub checkpoint_milliseconds: u64,
}
impl Default for NetworkSettings {
    fn default() -> Self {
        Self {
            proxy_mode: ProxyMode::System,
            pac_url: None,
            ca_file: None,
            authentication: Authentication::Auto,
            proxy_authentication: Authentication::Auto,
            http_policy: HttpPolicy::Auto,
            segmented: true,
            ftp_tls: false,
            retries: 5,
            connect_timeout_seconds: 20,
            stall_timeout_seconds: 30,
            checkpoint_milliseconds: 1000,
        }
    }
}
impl NetworkSettings {
    pub fn validate(&self) -> Result<()> {
        if self.retries > 10
            || !(1..=300).contains(&self.connect_timeout_seconds)
            || !(1..=600).contains(&self.stall_timeout_seconds)
            || !(100..=60000).contains(&self.checkpoint_milliseconds)
        {
            bail!("Invalid networking limits");
        }
        if let Some(path) = &self.ca_file {
            if !path.is_absolute() || !path.is_file() {
                bail!("CA file must be an existing absolute path");
            }
        }
        if self.proxy_mode == ProxyMode::Pac {
            let u = url::Url::parse(self.pac_url.as_deref().context("PAC URL is required")?)?;
            if !["http", "https"].contains(&u.scheme())
                || u.password().is_some()
                || !u.username().is_empty()
            {
                bail!("Invalid PAC URL");
            }
        }
        authentication(&self.authentication)?;
        authentication(&self.proxy_authentication)?;
        Ok(())
    }
}
pub fn capabilities() -> serde_json::Value {
    let v = curl::Version::get();
    serde_json::json!({"version":v.version(),"protocols":v.protocols().collect::<Vec<_>>(),"tls":v.ssl_version(),"http2":v.feature_http2(),"large_files":v.feature_largefile(),"gzip":v.feature_libz(),"ntlm":v.feature_ntlm(),"negotiate":v.feature_gss_negotiate()||v.feature_spnego()||v.feature_sspi(),"https_proxy":v.feature_https_proxy(),"system_pac":cfg!(windows)||cfg!(target_os="macos")||crate::network::linux_pac_available()})
}
pub fn authentication(method: &Authentication) -> Result<Auth> {
    let v = curl::Version::get();
    let ntlm = v.feature_ntlm();
    let negotiate = v.feature_gss_negotiate() || v.feature_spnego() || v.feature_sspi();
    if *method == Authentication::Ntlm && !ntlm
        || *method == Authentication::Negotiate && !negotiate
    {
        bail!("protocol_unsupported: Selected authentication is unavailable in this libcurl build");
    }
    let mut a = Auth::new();
    a.basic(matches!(
        method,
        Authentication::Auto | Authentication::Basic
    ))
    .digest(matches!(
        method,
        Authentication::Auto | Authentication::Digest
    ))
    .ntlm(ntlm && matches!(method, Authentication::Auto | Authentication::Ntlm))
    .gssnegotiate(negotiate && matches!(method, Authentication::Auto | Authentication::Negotiate));
    Ok(a)
}
pub fn apply(easy: &mut Easy, url: &str, settings: &crate::Settings) -> Result<()> {
    let n = &settings.network;
    easy.connect_timeout(Duration::from_secs(n.connect_timeout_seconds))?;
    easy.low_speed_time(Duration::from_secs(n.stall_timeout_seconds))?;
    easy.max_connects(1)?;
    if n.ftp_tls && url.starts_with("ftp:") {
        let code = unsafe {
            curl_sys::curl_easy_setopt(
                easy.raw(),
                curl_sys::CURLOPT_USE_SSL,
                curl_sys::CURLUSESSL_ALL as std::ffi::c_long,
            )
        };
        if code != curl_sys::CURLE_OK {
            return Err(curl::Error::new(code).into());
        }
    }
    if let Some(path) = &n.ca_file {
        easy.cainfo(path)?;
        easy.proxy_cainfo(path.to_str().context("CA path must be UTF-8")?)?;
    }
    let version = match n.http_policy {
        HttpPolicy::Auto => HttpVersion::Any,
        HttpPolicy::Http1 => HttpVersion::V11,
        HttpPolicy::Http2Tls => HttpVersion::V2TLS,
        HttpPolicy::Http2PriorKnowledge => HttpVersion::V2PriorKnowledge,
    };
    if matches!(
        n.http_policy,
        HttpPolicy::Http2Tls | HttpPolicy::Http2PriorKnowledge
    ) && !curl::Version::get().feature_http2()
    {
        bail!("protocol_unsupported: HTTP/2 is unavailable in this build");
    }
    easy.http_version(version)?;
    match n.proxy_mode {
        ProxyMode::Direct => easy.proxy("")?,
        ProxyMode::Manual => {
            easy.proxy(
                settings
                    .proxy
                    .as_deref()
                    .context("Manual proxy URL is required")?,
            )?;
            easy.noproxy("")?;
        }
        ProxyMode::Pac => {
            let proxy = pac(url, n.pac_url.as_deref(), n)?;
            easy.proxy(&proxy)?;
            easy.noproxy("")?;
        }
        ProxyMode::System => {
            if let Some(proxy) = settings.proxy.as_ref().filter(|p| !p.is_empty()) {
                easy.proxy(proxy)?;
                easy.noproxy("")?;
            }
            #[cfg(windows)]
            if settings.proxy.is_none() {
                easy.proxy(&pac(url, None, n)?)?;
            }
            #[cfg(not(windows))]
            {
                if settings.proxy.is_none() {
                    if let Some(proxy) = crate::system_proxy::system(url)? {
                        easy.proxy(&proxy)?;
                        easy.noproxy("")?;
                    }
                }
            }
        }
    }
    Ok(())
}
#[cfg(not(windows))]
fn pac(url: &str, script: Option<&str>, settings: &NetworkSettings) -> Result<String> {
    crate::system_proxy::pac(url, script.context("PAC URL is required")?, settings)
}
#[cfg(windows)]
fn pac(url: &str, script: Option<&str>, _settings: &NetworkSettings) -> Result<String> {
    use std::{ffi::c_void, ptr};
    #[repr(C)]
    struct Config {
        auto: i32,
        url: *mut u16,
        proxy: *mut u16,
        bypass: *mut u16,
    }
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
    struct Info {
        access: u32,
        proxy: *mut u16,
        bypass: *mut u16,
    }
    #[link(name = "winhttp")]
    extern "system" {
        fn WinHttpGetIEProxyConfigForCurrentUser(c: *mut Config) -> i32;
        fn WinHttpOpen(
            agent: *const u16,
            access: u32,
            proxy: *const u16,
            bypass: *const u16,
            flags: u32,
        ) -> *mut c_void;
        fn WinHttpGetProxyForUrl(
            session: *mut c_void,
            url: *const u16,
            options: *mut Options,
            info: *mut Info,
        ) -> i32;
        fn WinHttpCloseHandle(handle: *mut c_void) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalFree(p: *mut c_void) -> *mut c_void;
    }
    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }
    unsafe fn string(p: *const u16) -> String {
        if p.is_null() {
            return String::new();
        }
        let mut n = 0;
        while *p.add(n) != 0 {
            n += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(p, n))
    }
    let mut config = Config {
        auto: 0,
        url: ptr::null_mut(),
        proxy: ptr::null_mut(),
        bypass: ptr::null_mut(),
    };
    let (auto, pac_url, manual, bypass) = unsafe {
        if script.is_none() && WinHttpGetIEProxyConfigForCurrentUser(&mut config) == 0 {
            return Err(std::io::Error::last_os_error()).context("System proxy discovery failed");
        }
        let result = (
            config.auto,
            string(config.url),
            string(config.proxy),
            string(config.bypass),
        );
        for p in [config.url, config.proxy, config.bypass] {
            if !p.is_null() {
                GlobalFree(p.cast());
            }
        }
        result
    };
    let script = script.unwrap_or(&pac_url);
    let proxy = if !script.is_empty() || auto != 0 {
        let agent = wide("Downloader");
        let target = wide(url);
        let script_wide = wide(script);
        let mut options = Options {
            flags: if script.is_empty() { 1 } else { 2 },
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
        let mut info = Info {
            access: 1,
            proxy: ptr::null_mut(),
            bypass: ptr::null_mut(),
        };
        unsafe {
            let session = WinHttpOpen(agent.as_ptr(), 1, ptr::null(), ptr::null(), 0);
            if session.is_null() {
                bail!("System proxy session unavailable");
            }
            let ok = WinHttpGetProxyForUrl(session, target.as_ptr(), &mut options, &mut info);
            let error = std::io::Error::last_os_error();
            WinHttpCloseHandle(session);
            let proxy = string(info.proxy);
            for p in [info.proxy, info.bypass] {
                if !p.is_null() {
                    GlobalFree(p.cast());
                }
            }
            if ok == 0 && script.is_empty() && error.raw_os_error() == Some(12180) {
                return Ok(manual);
            }
            if ok == 0 {
                return Err(error)
                    .context("PAC evaluation failed; routing was not silently bypassed");
            }
            proxy
        }
    } else {
        let host = url::Url::parse(url)?.host_str().unwrap_or("").to_owned();
        // WinHTTP's explicit bypass list supports host globs and <local>.
        if bypass
            .split(';')
            .any(|p| p.trim() == host || p.trim() == "<local>" && !host.contains('.'))
        {
            return Ok(String::new());
        }
        manual
    };
    let scheme = url::Url::parse(url)?.scheme().to_owned();
    let chosen = proxy
        .split(';')
        .find_map(|entry| {
            entry
                .trim()
                .strip_prefix(&format!("{scheme}="))
                .map(str::to_owned)
        })
        .or_else(|| {
            proxy
                .split(';')
                .find(|s| !s.contains('='))
                .map(|s| s.trim().to_owned())
        })
        .unwrap_or_default();
    if chosen.is_empty() || chosen.contains("://") {
        Ok(chosen)
    } else {
        Ok(format!("http://{chosen}"))
    }
}

fn linux_pac_available() -> bool {
    #[cfg(target_os = "linux")]
    {
        unsafe { libloading::Library::new("libpacparser.so.1").is_ok() }
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}
