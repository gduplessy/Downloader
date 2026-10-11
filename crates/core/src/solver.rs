//! Optional local page resolution. The solver never transports file bytes.
use crate::{security, transfer, RequestContext, Settings};
use anyhow::{bail, Context, Result};
use curl::easy::{Easy, List};
use scraper::{ElementRef, Html, Selector};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    sync::atomic::{AtomicU8, Ordering},
    time::{Duration, Instant},
};

const RESPONSE_LIMIT: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct SolverSettings {
    pub enabled: bool,
    pub endpoint: String,
    pub timeout_seconds: u64,
}
impl Default for SolverSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            endpoint: "http://localhost:9191/".into(),
            timeout_seconds: 60,
        }
    }
}
impl SolverSettings {
    pub fn validate(&self) -> Result<url::Url> {
        let u = url::Url::parse(&self.endpoint).context("Invalid FlareSolverr endpoint")?;
        let local = match u.host() {
            Some(url::Host::Domain(h)) => h == "localhost",
            Some(url::Host::Ipv4(h)) => h.is_loopback(),
            Some(url::Host::Ipv6(h)) => h.is_loopback(),
            _ => false,
        };
        if !local
            || u.scheme() != "http"
            || !u.username().is_empty()
            || u.password().is_some()
            || u.query().is_some()
            || u.fragment().is_some()
            || u.path() != "/"
            || !(1..=120).contains(&self.timeout_seconds)
        {
            bail!("FlareSolverr requires an HTTP loopback root URL and a 1–120 second timeout");
        }
        Ok(u)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SolverCookie {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
    #[serde(default)]
    pub secure: bool,
    #[serde(default)]
    pub expires: Option<f64>,
}
/// Service-created only; never accepted from IPC or persisted in job records.
#[derive(Debug, Clone, Serialize)]
pub struct SolverContext {
    pub origin: String,
    pub user_agent: String,
    pub cookies: Vec<SolverCookie>,
}
impl SolverContext {
    pub fn validate(&self) -> Result<()> {
        let u = security::validate_url(&self.origin)?;
        if !["http", "https"].contains(&u.scheme())
            || self.user_agent.is_empty()
            || self.user_agent.len() > 1024
            || !self.user_agent.bytes().all(|b| (32..127).contains(&b))
            || self.cookies.len() > 128
        {
            bail!("Invalid FlareSolverr session context");
        }
        for c in &self.cookies {
            if c.name.is_empty()
                || c.name.len() > 256
                || !c
                    .name
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_-.".contains(&b))
                || c.value.len() > 8192
                || c.value
                    .bytes()
                    .any(|b| !(32..127).contains(&b) || b == b';')
                || !c.path.starts_with('/')
                || c.path.len() > 4096
                || c.domain.len() > 253
                || !c
                    .domain
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-. ".contains(&b))
                || c.domain.contains(' ')
                || c.expires.is_some_and(|n| !n.is_finite())
            {
                bail!("Invalid FlareSolverr cookie");
            }
        }
        Ok(())
    }
    pub fn cookie_header(&self, target: &url::Url) -> Option<String> {
        let origin = url::Url::parse(&self.origin).ok()?;
        if target.origin() != origin.origin() {
            return None;
        }
        let host = target.host_str()?;
        let now = chrono::Utc::now().timestamp() as f64;
        let mut cookies: Vec<_> = self
            .cookies
            .iter()
            .filter(|c| {
                let domain = c.domain.trim_start_matches('.');
                let domain_match = host.eq_ignore_ascii_case(domain)
                    || c.domain.starts_with('.')
                        && host
                            .to_ascii_lowercase()
                            .ends_with(&format!(".{}", domain.to_ascii_lowercase()));
                let path_match = target.path() == c.path
                    || target.path().starts_with(&c.path)
                        && (c.path.ends_with('/')
                            || target.path().as_bytes().get(c.path.len()) == Some(&b'/'));
                domain_match
                    && path_match
                    && (!c.secure || target.scheme() == "https")
                    && c.expires.is_none_or(|n| n <= 0.0 || n > now)
            })
            .collect();
        cookies.sort_by_key(|c| std::cmp::Reverse(c.path.len()));
        let value = cookies
            .iter()
            .map(|c| format!("{}={}", c.name, c.value))
            .collect::<Vec<_>>()
            .join("; ");
        (!value.is_empty()).then_some(value)
    }
}

fn api(settings: &SolverSettings, payload: Option<&Value>, control: &AtomicU8) -> Result<Value> {
    let endpoint = settings.validate()?;
    let mut easy = Easy::new();
    easy.url(
        if payload.is_some() {
            endpoint.join("v1")?
        } else {
            endpoint
        }
        .as_str(),
    )?;
    easy.proxy("")?;
    easy.follow_location(false)?;
    easy.connect_timeout(Duration::from_secs(5))?;
    easy.timeout(Duration::from_secs(settings.timeout_seconds + 5))?;
    easy.progress(true)?;
    if let Some(payload) = payload {
        let mut headers = List::new();
        headers.append("Content-Type: application/json")?;
        easy.http_headers(headers)?;
        easy.post(true)?;
        easy.post_fields_copy(&serde_json::to_vec(payload)?)?;
    }
    let mut bytes = Vec::new();
    let result = {
        let mut t = easy.transfer();
        t.write_function(|chunk| {
            if bytes.len().saturating_add(chunk.len()) > RESPONSE_LIMIT {
                return Ok(0);
            }
            bytes.extend_from_slice(chunk);
            Ok(chunk.len())
        })?;
        t.progress_function(|_, _, _, _| control.load(Ordering::Relaxed) == 0)?;
        t.perform()
    };
    if control.load(Ordering::Relaxed) != 0 {
        bail!("operation_cancelled");
    }
    if let Err(e) = result {
        bail!(if e.is_operation_timedout() {
            "FlareSolverr timed out; continue in the browser"
        } else {
            "FlareSolverr connection or response failed; check the service"
        });
    }
    if easy.response_code()? != 200 {
        bail!("FlareSolverr returned an HTTP error; check the service");
    }
    let value: Value =
        serde_json::from_slice(&bytes).context("Invalid FlareSolverr JSON response")?;
    if payload.is_some() && value["status"] != "ok" {
        // Provider messages may contain cookies, signed URLs, or HTML.
        bail!("FlareSolverr could not complete this request; continue in the browser");
    }
    Ok(value)
}

pub fn test(settings: &SolverSettings) -> Result<Value> {
    let v = api(settings, None, &AtomicU8::new(0))?;
    if v["msg"] != "FlareSolverr is ready!" {
        bail!("The endpoint is not a ready FlareSolverr service");
    }
    let version = v["version"]
        .as_str()
        .filter(|s| {
            s.len() < 64
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || ".-_".contains(c))
        })
        .context("Invalid FlareSolverr version")?;
    Ok(json!({"available":true,"version":version}))
}

fn visible(e: ElementRef<'_>) -> bool {
    std::iter::once(e)
        .chain(e.ancestors().filter_map(ElementRef::wrap))
        .all(|el| {
            let style = el
                .value()
                .attr("style")
                .unwrap_or("")
                .replace(' ', "")
                .to_ascii_lowercase();
            el.value().attr("hidden").is_none()
                && el.value().attr("aria-hidden") != Some("true")
                && !style.contains("display:none")
                && !style.contains("visibility:hidden")
        })
}
fn elements<'a>(doc: &'a Html, selector: &str) -> Vec<ElementRef<'a>> {
    doc.select(&Selector::parse(selector).expect("Static selector"))
        .filter(|e| visible(*e))
        .collect()
}
pub fn blocked_reason(html: &str) -> Option<&'static str> {
    let doc = Html::parse_document(html);
    let text = doc
        .root_element()
        .text()
        .collect::<String>()
        .to_ascii_lowercase();
    if text.contains("link expired") || text.contains("link abgelaufen") {
        return Some("solver_expired");
    }
    if !elements(&doc, "input[type=password]").is_empty() {
        return Some("solver_authentication");
    }
    if !elements(
        &doc,
        "[role=timer],[data-countdown],[id*=countdown],[class*=countdown]",
    )
    .is_empty()
    {
        return Some("solver_countdown");
    }
    if !elements(
        &doc,
        "#challenge-running,#challenge-stage,.cf-challenge-running,#cf-challenge-running",
    )
    .is_empty()
        || text.contains("checking your browser")
        || text.contains("verify you are human") && text.contains("cloudflare")
    {
        return Some("solver_browser_challenge");
    }
    if !elements(
        &doc,
        "iframe[src*=captcha],[id*=captcha],[class*=captcha],iframe[src*=turnstile]",
    )
    .is_empty()
    {
        return Some("solver_captcha");
    }
    None
}
fn action(text: &str) -> bool {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    regex::Regex::new(r"(?i)^(start download|download( now| file| free)?|free download|(get|create|generate) (download )?link|continue( to download)?|slow download)( your file is ready)?$").unwrap().is_match(&text)
}
fn excluded(text: &str) -> bool {
    regex::Regex::new(
        r"(?i)premium|torrent|magnet:|subscribe|subscription|purchase|buy\b|pay\b|advert|sponsor",
    )
    .unwrap()
    .is_match(text)
}
/// Only one unambiguous ordinary GET is eligible. Never evaluate site scripts.
pub fn candidate(html: &str, base: &str) -> Result<String> {
    if let Some(reason) = blocked_reason(html) {
        bail!("{reason}");
    }
    let doc = Html::parse_document(html);
    let base = security::validate_url(base)?;
    let mut candidates = HashSet::new();
    for a in elements(&doc, "a[href]") {
        let text = a.text().collect::<String>();
        if excluded(&format!(
            "{} {}",
            text,
            a.value().attr("href").unwrap_or("")
        )) {
            continue;
        }
        if !action(&text) && a.value().attr("download").is_none() {
            continue;
        }
        if let Ok(u) = base.join(a.value().attr("href").unwrap()) {
            if ["http", "https"].contains(&u.scheme())
                && security::validate_url(u.as_str()).is_ok()
                && !(base.scheme() == "https" && u.scheme() != "https")
            {
                candidates.insert(u.to_string());
            }
        }
    }
    for form in elements(&doc, "form") {
        if form.select(&Selector::parse("select,textarea,input[type=file],input[type=password],input[type=checkbox],input[type=radio]").unwrap()).next().is_some() {
            continue;
        }
        if !form
            .value()
            .attr("method")
            .unwrap_or("get")
            .eq_ignore_ascii_case("get")
        {
            continue;
        }
        let buttons = form
            .select(&Selector::parse("button,input[type=submit]").unwrap())
            .filter(|e| visible(*e))
            .collect::<Vec<_>>();
        if buttons.len() != 1 {
            continue;
        }
        let button = buttons[0];
        if button.value().attr("disabled").is_some()
            || button.value().attr("formaction").is_some()
            || button.value().attr("formmethod").is_some()
        {
            continue;
        }
        let text = button
            .value()
            .attr("value")
            .map(str::to_owned)
            .unwrap_or_else(|| button.text().collect());
        if !action(&text) {
            continue;
        }
        let mut u = base.join(form.value().attr("action").unwrap_or(""))?;
        if !["http", "https"].contains(&u.scheme())
            || base.scheme() == "https" && u.scheme() != "https"
        {
            continue;
        }
        u.set_query(None);
        let input_selector = Selector::parse("input").unwrap();
        let fields = form.select(&input_selector);
        {
            let mut query = u.query_pairs_mut();
            for field in fields {
                if field.value().attr("disabled").is_some() {
                    continue;
                }
                let kind = field.value().attr("type").unwrap_or("text");
                if ["file", "password", "checkbox", "radio", "button", "reset"].contains(&kind) {
                    continue;
                }
                if kind == "submit" && field != button {
                    continue;
                }
                if let Some(name) = field.value().attr("name") {
                    query.append_pair(name, field.value().attr("value").unwrap_or(""));
                }
            }
            if button.value().name() == "button" {
                if let Some(name) = button.value().attr("name") {
                    query.append_pair(name, button.value().attr("value").unwrap_or(""));
                }
            }
        }
        security::validate_url(u.as_str())?;
        candidates.insert(u.to_string());
    }
    if candidates.len() != 1 {
        bail!("solver_ambiguous");
    }
    Ok(candidates.into_iter().next().unwrap())
}

pub struct Resolved {
    pub url: String,
    pub context: RequestContext,
    pub filename: Option<String>,
}
pub fn resolve(
    page: &str,
    profile: Option<String>,
    settings: &Settings,
    control: &AtomicU8,
) -> Result<Resolved> {
    if !settings.solver.enabled {
        bail!("solver_disabled");
    }
    // The local container cannot transparently inherit OS/PAC/browser routing.
    if settings.network.proxy_mode != crate::network::ProxyMode::Direct {
        bail!("solver_routing");
    }
    let u = security::validate_url(page)?;
    if !["http", "https"].contains(&u.scheme()) {
        bail!("solver_source");
    }
    let id = format!("downloader-{}", uuid::Uuid::new_v4());
    api(
        &settings.solver,
        Some(&json!({"cmd":"sessions.create","session":id})),
        control,
    )?;
    let result = resolve_session(page, profile, settings, control, &id);
    // Cleanup must proceed even when the job has been cancelled.
    let cleanup = SolverSettings {
        timeout_seconds: 5,
        ..settings.solver.clone()
    };
    let _ = api(
        &cleanup,
        Some(&json!({"cmd":"sessions.destroy","session":id})),
        &AtomicU8::new(0),
    );
    result
}
fn resolve_session(
    page: &str,
    profile: Option<String>,
    settings: &Settings,
    control: &AtomicU8,
    session: &str,
) -> Result<Resolved> {
    let deadline = Instant::now() + Duration::from_secs(settings.solver.timeout_seconds);
    let mut current = page.to_owned();
    let mut visited = HashSet::new();
    for _ in 0..6 {
        if control.load(Ordering::Relaxed) != 0 {
            bail!("operation_cancelled");
        }
        if !visited.insert(current.clone()) {
            bail!("solver_loop");
        }
        let remaining = deadline
            .saturating_duration_since(Instant::now())
            .as_millis() as u64;
        if remaining < 1000 {
            bail!("solver_timeout");
        }
        let response = api(
            &settings.solver,
            Some(
                &json!({"cmd":"request.get","session":session,"url":current,"maxTimeout":remaining}),
            ),
            control,
        )?;
        let solution = &response["solution"];
        let url = solution["url"]
            .as_str()
            .context("Missing FlareSolverr solution URL")?;
        let parsed = security::validate_url(url)?;
        if !["http", "https"].contains(&parsed.scheme())
            || current.starts_with("https:") && parsed.scheme() != "https"
        {
            bail!("solver_source");
        }
        if !solution["status"]
            .as_u64()
            .is_some_and(|s| (200..300).contains(&s))
        {
            bail!("solver_http_error");
        }
        let html = solution["response"]
            .as_str()
            .context("Missing FlareSolverr rendered page")?;
        if let Some(reason) = blocked_reason(html) {
            bail!("{reason}");
        }
        let session_context = SolverContext {
            origin: parsed.origin().ascii_serialization(),
            user_agent: solution["userAgent"]
                .as_str()
                .context("Missing FlareSolverr User-Agent")?
                .into(),
            cookies: serde_json::from_value(solution["cookies"].clone())
                .context("Invalid FlareSolverr cookies")?,
        };
        session_context.validate()?;
        let context = RequestContext {
            profile: profile.clone(),
            browser: Some("flaresolverr".into()),
            solver: Some(session_context),
            ..Default::default()
        };
        let next = candidate(html, url)?;
        let meta = transfer::inspect_controlled(&next, &context, settings, control);
        match meta {
            Ok(meta) if !meta.content_type.is_empty() && !is_html(&meta.content_type) => {
                return Ok(Resolved {
                    url: meta.url,
                    context: meta.context,
                    filename: meta.filename,
                });
            }
            // Cross-origin hops need a fresh browser navigation and scoped cookies.
            _ => current = next,
        }
    }
    bail!("solver_step_limit")
}
pub fn is_html(content_type: &str) -> bool {
    let kind = content_type.split(';').next().unwrap_or("").trim();
    kind.eq_ignore_ascii_case("text/html") || kind.eq_ignore_ascii_case("application/xhtml+xml")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn endpoint(body: Vec<u8>, status: u16) -> SolverSettings {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") {
                if stream.read_exact(&mut byte).is_err() {
                    return;
                }
                request.push(byte[0]);
            }
            let size = String::from_utf8_lossy(&request)
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length: ")
                        .and_then(|n| n.parse::<usize>().ok())
                })
                .unwrap_or(0);
            let mut payload = vec![0; size];
            let _ = stream.read_exact(&mut payload);
            let _ = write!(
                stream,
                "HTTP/1.1 {status} OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(&body);
        });
        SolverSettings {
            endpoint,
            ..Default::default()
        }
    }
    #[test]
    fn service_health_and_response_failures_are_sanitized() {
        let s = endpoint(
            br#"{"msg":"FlareSolverr is ready!","version":"3.4.6"}"#.to_vec(),
            200,
        );
        assert_eq!(test(&s).unwrap()["version"], "3.4.6");
        let s = endpoint(
            br#"{"status":"error","message":"Cookie: secret; https://x.test/?signed=secret"}"#
                .to_vec(),
            200,
        );
        let error = api(&s, Some(&json!({"cmd":"request.get"})), &AtomicU8::new(0))
            .unwrap_err()
            .to_string();
        assert!(!error.contains("secret"));
        let s = endpoint(b"not json".to_vec(), 200);
        assert!(api(&s, None, &AtomicU8::new(0)).is_err());
        let s = endpoint(b"error".to_vec(), 503);
        assert!(api(&s, None, &AtomicU8::new(0)).is_err());
        let s = endpoint(vec![b'x'; RESPONSE_LIMIT + 1], 200);
        assert!(api(&s, None, &AtomicU8::new(0)).is_err());
    }
    #[test]
    fn endpoints_and_defaults() {
        let s: SolverSettings = serde_json::from_str("{}").unwrap();
        assert!(!s.enabled);
        assert!(s.validate().is_ok());
        for endpoint in ["http://127.0.0.1:9191/", "http://[::1]:9191/"] {
            assert!(SolverSettings {
                endpoint: endpoint.into(),
                ..s.clone()
            }
            .validate()
            .is_ok());
        }
        for endpoint in [
            "http://example.com/",
            "https://localhost/",
            "http://localhost/v1",
            "http://u:p@localhost/",
            "http://localhost/?token=x",
        ] {
            assert!(SolverSettings {
                endpoint: endpoint.into(),
                ..s.clone()
            }
            .validate()
            .is_err());
        }
    }
    #[test]
    fn scoped_cookie_path_expiry_and_secure() {
        let ctx = SolverContext {
            origin: "https://files.example.test".into(),
            user_agent: "Chrome/test".into(),
            cookies: vec![
                SolverCookie {
                    name: "session".into(),
                    value: "secret".into(),
                    domain: ".example.test".into(),
                    path: "/file".into(),
                    secure: true,
                    expires: None,
                },
                SolverCookie {
                    name: "old".into(),
                    value: "old".into(),
                    domain: "files.example.test".into(),
                    path: "/".into(),
                    secure: false,
                    expires: Some(1.0),
                },
            ],
        };
        ctx.validate().unwrap();
        assert_eq!(
            ctx.cookie_header(&url::Url::parse("https://files.example.test/file/x").unwrap())
                .as_deref(),
            Some("session=secret")
        );
        for target in [
            "https://files.example.test/file-other",
            "https://other.example.test/file/x",
            "http://files.example.test/file/x",
        ] {
            assert!(ctx
                .cookie_header(&url::Url::parse(target).unwrap())
                .is_none());
        }
        let mut unsafe_ctx = ctx;
        unsafe_ctx.cookies[0].value = "secret\r\nX: y".into();
        assert!(unsafe_ctx.validate().is_err());
    }
    #[test]
    fn challenges_never_become_sources() {
        for (html, reason) in [
            (
                "Link expired. Please call up the download again and solve the captcha.",
                "solver_expired",
            ),
            ("<input type=password>", "solver_authentication"),
            (
                "<div id=challenge-running>Checking your browser</div>",
                "solver_browser_challenge",
            ),
            ("<img id=captchaImage>", "solver_captcha"),
            ("<div role=timer>3</div>", "solver_countdown"),
        ] {
            assert_eq!(blocked_reason(html), Some(reason));
            assert!(candidate(html, "https://example.test/").is_err());
        }
        assert_eq!(
            blocked_reason("<div hidden id=captchaLinksModal></div><p>Ready</p>"),
            None
        );
    }
    #[test]
    fn only_unambiguous_get_controls() {
        let base = "https://example.test/page";
        assert_eq!(
            candidate(
                "<a href='/file'>Free Download</a><a href='/premium'>Premium Download</a>",
                base
            )
            .unwrap(),
            "https://example.test/file"
        );
        assert_eq!(candidate("<form action='/file'><input type=hidden name=token value=abc><button>Start Download</button></form>",base).unwrap(),"https://example.test/file?token=abc");
        for html in [
            "<a href='/a'>Download</a><a href='/b'>Download</a>",
            "<form method=post action='/file'><button>Download</button></form>",
            "<a href='javascript:evil()' download>Download</a>",
            "<a href='http://example.test/file'>Download</a>",
            "<a hidden href='/file'>Download</a>",
            "<form action='/file'><button disabled>Download</button></form>",
        ] {
            assert!(candidate(html, base).is_err(), "{html}");
        }
    }
}
