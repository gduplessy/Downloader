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
/// A resolved, bounded route list belongs to one request, never global routing state.
pub(crate) struct Routes {
    values: Vec<Option<String>>,
    index: usize,
}
impl Routes {
    pub(crate) fn resolve(url: &str, settings: &crate::Settings) -> Result<Self> {
        let explicit = settings.proxy.as_ref().filter(|p| !p.is_empty());
        let values = match settings.network.proxy_mode {
            ProxyMode::Direct => vec![Some(String::new())],
            ProxyMode::Manual => vec![Some(
                explicit.context("Manual proxy URL is required")?.clone(),
            )],
            ProxyMode::Pac => pac(url, settings.network.pac_url.as_deref(), &settings.network)?
                .into_iter()
                .map(Some)
                .collect(),
            ProxyMode::System if explicit.is_some() => vec![explicit.cloned()],
            ProxyMode::System => {
                #[cfg(windows)]
                {
                    pac(url, None, &settings.network)?
                        .into_iter()
                        .map(Some)
                        .collect()
                }
                #[cfg(not(windows))]
                {
                    crate::system_proxy::system(url)?
                        .map_or_else(|| vec![None], |v| v.into_iter().map(Some).collect())
                }
            }
        };
        if values.is_empty() || values.len() > 16 {
            bail!("Invalid or excessive proxy route list");
        }
        Ok(Self { values, index: 0 })
    }
    pub(crate) fn current(&self) -> Option<&str> {
        self.values[self.index].as_deref()
    }
    pub(crate) fn advance(&mut self, error: &curl::Error, status: u32, bytes: u64) -> bool {
        // Never replay received data or turn authentication/TLS/source failures into DIRECT.
        if status != 0
            || bytes != 0
            || self.current().is_none_or(str::is_empty)
            || !(error.is_couldnt_connect()
                || error.is_couldnt_resolve_proxy()
                || error.is_operation_timedout())
            || self.index + 1 == self.values.len()
        {
            return false;
        }
        self.index += 1;
        true
    }
}

pub(crate) fn apply(
    easy: &mut Easy,
    url: &str,
    settings: &crate::Settings,
    route: Option<&str>,
) -> Result<()> {
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
    if let Some(route) = route {
        easy.proxy(route)?;
        easy.noproxy("")?;
    }
    Ok(())
}
#[cfg(not(windows))]
fn pac(url: &str, script: Option<&str>, settings: &NetworkSettings) -> Result<Vec<String>> {
    crate::system_proxy::pac(url, script.context("PAC URL is required")?, settings)
}
#[cfg(windows)]
fn pac(url: &str, script: Option<&str>, _settings: &NetworkSettings) -> Result<Vec<String>> {
    use std::{ffi::c_void, ptr};
    #[repr(C)]
    struct Config {
        auto: i32,
        url: *mut u16,
        proxy: *mut u16,
        bypass: *mut u16,
    }
    #[link(name = "winhttp")]
    extern "system" {
        fn WinHttpGetIEProxyConfigForCurrentUser(config: *mut Config) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalFree(p: *mut c_void) -> *mut c_void;
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
    let allow_native_bypass = script.is_none();
    let script = script.unwrap_or(&pac_url);
    let proxy = if !script.is_empty() || auto != 0 {
        match windows_pac::resolve(url, script, allow_native_bypass) {
            Ok(routes) => return Ok(routes),
            Err(error)
                if script.is_empty()
                    && error
                        .downcast_ref::<std::io::Error>()
                        .is_some_and(|e| e.raw_os_error() == Some(12180)) =>
            {
                manual
            }
            Err(error) => return Err(error),
        }
    } else {
        let host = url::Url::parse(url)?.host_str().unwrap_or("").to_owned();
        // WinHTTP's explicit bypass list supports host globs and <local>.
        if proxy_bypass(&host, &bypass) {
            return Ok(vec![String::new()]);
        }
        manual
    };
    let scheme = url::Url::parse(url)?.scheme().to_owned();
    Ok(vec![system_proxy_address(&proxy, &scheme)])
}

#[cfg(any(windows, test))]
fn system_proxy_address(proxy: &str, scheme: &str) -> String {
    let chosen = proxy
        .split(';')
        .find_map(|entry| {
            let (protocol, address) = entry.trim().split_once('=')?;
            protocol
                .trim()
                .eq_ignore_ascii_case(scheme)
                .then(|| address.trim().to_owned())
        })
        .or_else(|| {
            proxy
                .split(';')
                .find(|s| !s.contains('='))
                .map(|s| s.trim().to_owned())
        })
        .unwrap_or_default();
    if chosen.is_empty() || chosen.contains("://") {
        chosen
    } else {
        format!("http://{chosen}")
    }
}

#[cfg(any(windows, test))]
fn proxy_bypass(host: &str, list: &str) -> bool {
    list.split(';').any(|entry| {
        let entry = entry.trim();
        if entry.eq_ignore_ascii_case("<local>") {
            return !host.is_empty() && !host.contains(['.', ':', '[', ']']);
        }
        if entry.is_empty() || entry.len() > 1024 {
            return false;
        }
        let pattern = regex::escape(entry)
            .replace(r"\*", ".*")
            .replace(r"\?", ".");
        regex::Regex::new(&format!("(?i)^{pattern}$")).is_ok_and(|pattern| pattern.is_match(host))
    })
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

#[cfg(any(target_os = "linux", test))]
pub(crate) fn pac_routes(value: &str) -> Result<Vec<String>> {
    let mut routes = Vec::new();
    for entry in value.split(';').map(str::trim).filter(|v| !v.is_empty()) {
        if routes.len() == 16 {
            bail!("Excessive PAC route list");
        }
        if entry.eq_ignore_ascii_case("DIRECT") {
            routes.push(String::new());
            continue;
        }
        let (kind, address) = entry
            .split_once(char::is_whitespace)
            .context("Invalid PAC route")?;
        let scheme = match kind.to_ascii_uppercase().as_str() {
            "PROXY" | "HTTP" => "http",
            "HTTPS" => "https",
            "SOCKS" | "SOCKS5" => "socks5h",
            "SOCKS4" => "socks4",
            _ => bail!("Unsupported PAC proxy type"),
        };
        let route = format!("{scheme}://{}", address.trim());
        let parsed = url::Url::parse(&route)?;
        if parsed.host_str().is_none()
            || address
                .trim()
                .rsplit_once(':')
                .and_then(|(_, p)| p.parse::<u16>().ok())
                .is_none_or(|p| p == 0)
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.path() != "" && parsed.path() != "/"
            || parsed.query().is_some()
            || parsed.fragment().is_some()
        {
            bail!("Invalid PAC proxy address");
        }
        routes.push(route);
    }
    if routes.is_empty() {
        bail!("PAC returned no route");
    }
    Ok(routes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pac_preserves_order_and_never_invents_direct() {
        assert_eq!(
            pac_routes("PROXY one:3128; SOCKS5 two:1080; DIRECT").unwrap(),
            vec!["http://one:3128", "socks5h://two:1080", ""]
        );
        assert_eq!(
            pac_routes("PROXY one:3128; PROXY two:8080").unwrap().len(),
            2
        );
        assert_eq!(pac_routes("PROXY one:80").unwrap(), vec!["http://one:80"]);
        for invalid in [
            "",
            "UNKNOWN host:1",
            "PROXY user:pass@host:1",
            "PROXY host:1/path",
            "PROXY host",
        ] {
            assert!(pac_routes(invalid).is_err(), "{invalid}");
        }
        assert!(pac_routes(&vec!["DIRECT"; 17].join(";")).is_err());
    }
    #[test]
    fn failover_is_bounded_and_refuses_response_tls_auth_or_body_replay() {
        let connect = curl::Error::new(curl_sys::CURLE_COULDNT_CONNECT);
        let mut routes = Routes {
            values: vec![
                Some("http://first:1".into()),
                Some("http://second:1".into()),
                Some("".into()),
            ],
            index: 0,
        };
        assert!(!routes.advance(&connect, 407, 0));
        assert!(!routes.advance(&connect, 200, 0));
        assert!(!routes.advance(&connect, 0, 1));
        assert!(!routes.advance(
            &curl::Error::new(curl_sys::CURLE_PEER_FAILED_VERIFICATION),
            0,
            0
        ));
        assert!(routes.advance(&connect, 0, 0));
        assert_eq!(routes.current(), Some("http://second:1"));
        assert!(routes.advance(&connect, 0, 0));
        assert_eq!(routes.current(), Some(""));
        assert!(!routes.advance(&connect, 0, 0));
    }
    #[test]
    fn system_proxy_protocol_maps_are_case_insensitive() {
        assert_eq!(
            system_proxy_address("HTTP=plain:8080; HTTPS = secure:3128", "https"),
            "http://secure:3128"
        );
        assert_eq!(
            system_proxy_address(" HTTPS=secure:3128 ; HTTP=plain:8080 ", "http"),
            "http://plain:8080"
        );
        assert_eq!(
            system_proxy_address("https://proxy:8443", "https"),
            "https://proxy:8443"
        );
        assert_eq!(system_proxy_address("HTTP=plain:8080", "https"), "");
    }
    #[test]
    fn windows_bypass_matches_whole_hosts_and_local_names() {
        assert!(proxy_bypass("cdn.example.com", "*.EXAMPLE.COM; <local>"));
        assert!(proxy_bypass("host7.corp", "host?.corp"));
        assert!(proxy_bypass("intranet", "<LOCAL>"));
        assert!(proxy_bypass("127.0.0.1", "127.0.0.*"));
        assert!(!proxy_bypass("evil-example.com", "*.example.com"));
        assert!(!proxy_bypass("example.com.evil", "example.com"));
        assert!(!proxy_bypass("127.0.0.1", "<local>"));
        assert!(!proxy_bypass("[::1]", "<local>"));
        assert!(!proxy_bypass("", " ; <local>"));
    }
}

#[cfg(windows)]
#[path = "windows_pac.rs"]
mod windows_pac;
