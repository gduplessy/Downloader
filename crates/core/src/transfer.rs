use crate::{model::*, security, store::Store};
use anyhow::{bail, Context, Result};
use curl::easy::{Easy, List};
use serde::Serialize;
use std::{
    collections::HashSet,
    fs::File,
    io::{Seek, SeekFrom, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Default, Serialize)]
pub struct Metadata {
    pub status: u32,
    pub total: Option<u64>,
    pub etag: Option<String>,
    pub modified: Option<String>,
    pub ranges: bool,
    pub content_type: String,
    pub filename: Option<String>,
    pub url: String,
    #[serde(skip)]
    pub context: RequestContext,
}
#[derive(Debug, Clone, Default)]
pub struct Headers {
    pub status: u32,
    pub length: Option<u64>,
    pub range: Option<(u64, u64, u64)>,
    pub etag: Option<String>,
    pub modified: Option<String>,
    pub ranges: bool,
    pub location: Option<String>,
    pub content_type: String,
    pub filename: Option<String>,
    pub retry_after: Option<u64>,
    pub encoding: Option<String>,
    pub invalid: bool,
}
impl Headers {
    pub fn accept(&mut self, line: &[u8]) {
        let line = String::from_utf8_lossy(line);
        let line = line.trim();
        if line.starts_with("HTTP/") {
            *self = Self::default();
            self.status = line
                .split_whitespace()
                .nth(1)
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            return;
        }
        let Some((key, value)) = line.split_once(':') else {
            return;
        };
        let value = value.trim();
        match key.to_ascii_lowercase().as_str() {
            "content-length" => {
                let length = value.parse::<u64>().ok();
                self.invalid |= length.is_none() || self.length.is_some_and(|n| Some(n) != length);
                self.length = length;
            }
            "content-encoding" => self.encoding = Some(value.into()),
            "etag" => self.etag = Some(value.into()),
            "last-modified" => self.modified = Some(value.into()),
            "accept-ranges" => self.ranges = value.eq_ignore_ascii_case("bytes"),
            "location" => self.location = Some(value.into()),
            "content-type" => self.content_type = value.into(),
            "retry-after" => {
                self.retry_after = value.parse().ok().or_else(|| {
                    chrono::DateTime::parse_from_rfc2822(value)
                        .ok()
                        .map(|d| (d.timestamp() - chrono::Utc::now().timestamp()).max(0) as u64)
                })
            }
            "content-range" => {
                let previous = self.range;
                if let Some(range) = value.strip_prefix("bytes ") {
                    if let Some((bounds, total)) = range.split_once('/') {
                        if let Some((a, b)) = bounds.split_once('-') {
                            self.range = a
                                .parse()
                                .ok()
                                .zip(b.parse().ok())
                                .zip(total.parse().ok())
                                .map(|((a, b), t)| (a, b, t));
                        }
                    }
                }
                self.invalid |=
                    self.range.is_none_or(|(a, b, t)| a > b || b >= t) || previous.is_some();
            }
            "content-disposition" => {
                for item in value.split(';') {
                    let item = item.trim();
                    if let Some(v) = item.strip_prefix("filename*=") {
                        self.filename = Some(percent_decode(
                            v.split_once("''").map(|(_, v)| v).unwrap_or(v),
                        ));
                    } else if self.filename.is_none() {
                        if let Some(v) = item.strip_prefix("filename=") {
                            self.filename = Some(security::safe_filename(v.trim_matches('"')));
                        }
                    }
                }
            }
            _ => {}
        }
    }
}
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = vec![];
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = |b: u8| match b {
                b'0'..=b'9' => Some(b - b'0'),
                b'a'..=b'f' => Some(b - b'a' + 10),
                b'A'..=b'F' => Some(b - b'A' + 10),
                _ => None,
            };
            if let Some((a, b)) = hex(bytes[i + 1]).zip(hex(bytes[i + 2])) {
                out.push(a * 16 + b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    security::safe_filename(&String::from_utf8_lossy(&out))
}
pub fn configure(
    easy: &mut Easy,
    url: &str,
    context: &RequestContext,
    settings: &Settings,
) -> Result<()> {
    let routes = crate::network::Routes::resolve(url, settings)?;
    configure_route(easy, url, context, settings, routes.current())
}
fn configure_route(
    easy: &mut Easy,
    url: &str,
    context: &RequestContext,
    settings: &Settings,
    route: Option<&str>,
) -> Result<()> {
    let parsed = security::validate_url(url)?;
    if !curl::Version::get()
        .protocols()
        .any(|p| p == parsed.scheme())
    {
        bail!("protocol_unsupported: Source protocol is unavailable in this libcurl build");
    }
    security::validate_context(context)?;
    easy.reset();
    easy.url(url)?;
    easy.follow_location(false)?;
    easy.connect_timeout(Duration::from_secs(20))?;
    easy.low_speed_limit(1)?;
    easy.low_speed_time(Duration::from_secs(30))?;
    easy.progress(true)?;
    easy.ssl_verify_peer(true)?;
    easy.ssl_verify_host(true)?;
    easy.useragent(concat!("Downloader/", env!("CARGO_PKG_VERSION")))?;
    easy.accept_encoding("identity")?;
    crate::network::apply(easy, url, settings, route)?;
    let mut headers = List::new();
    headers.append("Accept-Encoding: identity")?;
    for (k, v) in &context.headers {
        headers.append(&format!("{k}: {v}"))?;
    }
    easy.http_headers(headers)?;
    if let Some(id) = &context.credential_id {
        let (user, password) = security::credential(id)?;
        easy.username(&user)?;
        easy.password(&password)?;
        let auth = crate::network::authentication(&settings.network.authentication)?;
        easy.http_auth(&auth)?;
    }
    if let Some(id) = &settings.proxy_credential {
        let (user, password) = security::credential(id)?;
        easy.proxy_username(&user)?;
        easy.proxy_password(&password)?;
        let auth = crate::network::authentication(&settings.network.proxy_authentication)?;
        easy.proxy_auth(&auth)?;
    }
    Ok(())
}
pub fn inspect(url: &str, context: &RequestContext, settings: &Settings) -> Result<Metadata> {
    inspect_controlled(url, context, settings, &AtomicU8::new(0))
}
fn inspect_controlled(
    url: &str,
    context: &RequestContext,
    settings: &Settings,
    control: &AtomicU8,
) -> Result<Metadata> {
    let mut url = security::validate_url(url)?;
    let mut context = context.clone();
    let mut routes = crate::network::Routes::resolve(url.as_str(), settings)?;
    let mut redirects = 0;
    loop {
        let mut easy = crate::pool::checkout_route(
            url.as_str(),
            &context,
            settings,
            control,
            routes.current(),
        )?;
        configure_route(
            &mut easy,
            url.as_str(),
            &context,
            settings,
            routes.current(),
        )?;
        easy.nobody(true)?;
        easy.fetch_filetime(true)?;
        let mut headers = Headers::default();
        {
            let mut transfer = easy.transfer();
            transfer.header_function(|line| {
                headers.accept(line);
                true
            })?;
            transfer.progress_function(|_, _, _, _| control.load(Ordering::Relaxed) == 0)?;
            let result = transfer.perform();
            drop(transfer);
            if control.load(Ordering::Relaxed) != 0 {
                bail!("operation_cancelled")
            }
            if let Err(error) = result {
                if headers.status >= 400 {
                    bail!("{}", crate::failure::http_error(headers.status));
                }
                if routes.advance(&error, headers.status, 0) {
                    continue;
                }
                return Err(error.into());
            }
        }
        headers.status = easy.response_code()?;
        if matches!(headers.status, 405 | 501) {
            configure_route(
                &mut easy,
                url.as_str(),
                &context,
                settings,
                routes.current(),
            )?;
            easy.range("0-0")?;
            headers = Headers::default();
            let mut transfer = easy.transfer();
            transfer.header_function(|line| {
                headers.accept(line);
                true
            })?;
            transfer.write_function(|_| Ok(0))?;
            transfer.progress_function(|_, _, _, _| control.load(Ordering::Relaxed) == 0)?;
            let result = transfer.perform();
            drop(transfer);
            if let Err(e) = result {
                if control.load(Ordering::Relaxed) != 0 {
                    bail!("operation_cancelled")
                }
                if !e.is_write_error() {
                    if routes.advance(&e, headers.status, 0) {
                        continue;
                    }
                    return Err(e.into());
                }
            }
        }
        if matches!(headers.status, 301 | 302 | 303 | 307 | 308) {
            let next = url.join(
                headers
                    .location
                    .as_deref()
                    .context("Redirect lacks Location")?,
            )?;
            security::validate_url(next.as_str())?;
            if url.scheme() == "https" && next.scheme() != "https" {
                bail!("protocol_unsupported: Refusing HTTPS downgrade");
            }
            if next.origin() != url.origin() {
                context.headers.clear();
                context.credential_id = None;
            }
            url = next;
            redirects += 1;
            if redirects >= 10 {
                bail!("Too many redirects");
            }
            routes = crate::network::Routes::resolve(url.as_str(), settings)?;
            continue;
        }
        if headers.status >= 400 {
            bail!("{}", crate::failure::http_error(headers.status));
        }
        if headers.invalid {
            bail!("range_invalid: Malformed response headers");
        }
        if headers.length.is_none() {
            headers.length = easy
                .content_length_download()
                .ok()
                .filter(|n| *n >= 0.0)
                .map(|n| n as u64);
        }
        if headers.modified.is_none() {
            headers.modified = easy.filetime().ok().flatten().map(|n| n.to_string());
        }
        let encoded = headers
            .encoding
            .as_deref()
            .is_some_and(|v| !v.eq_ignore_ascii_case("identity"));
        let total = if encoded {
            None
        } else {
            headers.range.map(|r| r.2).or(headers.length)
        };
        return Ok(Metadata {
            status: headers.status,
            total,
            etag: headers.etag,
            modified: headers.modified,
            ranges: !encoded
                && (headers.ranges || headers.range.is_some() || url.scheme().starts_with("ftp")),
            content_type: headers.content_type,
            filename: headers.filename,
            url: url.into(),
            context,
        });
    }
}
fn redirected(
    current: &str,
    location: Option<&str>,
    context: &RequestContext,
) -> Result<(String, RequestContext)> {
    let current = security::validate_url(current)?;
    let next = current.join(location.context("Redirect lacks Location")?)?;
    security::validate_url(next.as_str())?;
    if current.scheme() == "https" && next.scheme() != "https" {
        bail!("protocol_unsupported: Refusing HTTPS downgrade");
    }
    let mut context = context.clone();
    if next.origin() != current.origin() {
        context.headers.clear();
        context.credential_id = None;
    }
    Ok((next.into(), context))
}
pub fn fetch_bytes(
    url: &str,
    context: &RequestContext,
    settings: &Settings,
    limit: usize,
    range: Option<(u64, u64)>,
) -> Result<(Headers, Vec<u8>)> {
    let metadata = inspect(url, context, settings)?;
    let (mut url, mut context) = (metadata.url, metadata.context);
    let mut routes = crate::network::Routes::resolve(&url, settings)?;
    let mut redirects = 0;
    loop {
        let mut easy = crate::pool::checkout_route(
            &url,
            &context,
            settings,
            &AtomicU8::new(0),
            routes.current(),
        )?;
        configure_route(&mut easy, &url, &context, settings, routes.current())?;
        if let Some((a, b)) = range {
            if a > b {
                bail!("range_invalid: Reversed byte range");
            }
            easy.range(&format!("{a}-{b}"))?;
        }
        let headers = std::cell::RefCell::new(Headers::default());
        let mut bytes = vec![];
        let result = {
            let mut t = easy.transfer();
            t.header_function(|l| {
                headers.borrow_mut().accept(l);
                true
            })?;
            t.write_function(|d| {
                let h = headers.borrow();
                if matches!(h.status, 301 | 302 | 303 | 307 | 308)
                    || h.status >= 400
                    || h.invalid
                    || range.is_some_and(|(a, b)| {
                        h.status != 206 || h.range.map(|r| (r.0, r.1)) != Some((a, b))
                    })
                    || bytes.len().saturating_add(d.len()) > limit
                {
                    return Ok(0);
                }
                bytes.extend_from_slice(d);
                Ok(d.len())
            })?;
            t.perform()
        };
        let headers = headers.into_inner();
        if result
            .as_ref()
            .is_err_and(|e| routes.advance(e, headers.status, bytes.len() as u64))
        {
            continue;
        }
        if matches!(headers.status, 301 | 302 | 303 | 307 | 308) {
            (url, context) = redirected(&url, headers.location.as_deref(), &context)?;
            redirects += 1;
            if redirects >= 10 {
                bail!("Too many GET redirects");
            }
            routes = crate::network::Routes::resolve(&url, settings)?;
            continue;
        }
        if headers.status >= 400 {
            bail!("{}", crate::failure::http_error(headers.status));
        }
        if headers.invalid {
            bail!("range_invalid: Malformed response");
        }
        if let Some((a, b)) = range {
            if headers.status != 206
                || headers.range.map(|r| (r.0, r.1)) != Some((a, b))
                || headers
                    .encoding
                    .as_deref()
                    .is_some_and(|v| !v.eq_ignore_ascii_case("identity"))
            {
                bail!("range_invalid: Server ignored or returned an invalid byte range");
            }
            if bytes.len() as u64 != b - a + 1 {
                bail!("Truncated range response");
            }
        }
        result?;
        return Ok((headers, bytes));
    }
}
pub type SharedJob = Arc<Mutex<Job>>;
pub fn part_path(job: &Job) -> PathBuf {
    job.destination
        .with_file_name(format!(".{}.{}.part", job.filename, job.id))
}
pub fn checkpoint(
    job: &SharedJob,
    store: &Arc<Mutex<Store>>,
    file: &Arc<Mutex<File>>,
) -> Result<()> {
    let started = Instant::now();
    // The file and job locks keep offsets consistent with the bytes being fsynced.
    let file = file.lock().unwrap();
    let mut job = job.lock().unwrap();
    crate::fault::io("sync")
        .and_then(|_| file.sync_data())
        .context("storage_error: Could not flush checkpoint bytes")?;
    crate::fault::point("checkpoint_before_commit");
    job.bytes = job.segments.iter().map(|s| s.downloaded).sum();
    job.updated = chrono::Utc::now();
    store.lock().unwrap().put("job", &job.id, &*job)?;
    job.metrics.checkpoints += 1;
    job.metrics.checkpoint_seconds += started.elapsed().as_secs_f64();
    crate::fault::point("checkpoint_after_commit");
    Ok(())
}
struct Allocator {
    active: HashSet<usize>,
}
fn claim(job: &SharedJob, allocator: &Arc<Mutex<Allocator>>) -> Option<usize> {
    let mut allocator = allocator.lock().unwrap();
    let mut job = job.lock().unwrap();
    if let Some(i) = job
        .segments
        .iter()
        .enumerate()
        .find(|(i, s)| s.remaining() > 0 && !allocator.active.contains(i))
        .map(|(i, _)| i)
    {
        allocator.active.insert(i);
        return Some(i);
    }
    if let Some((i, remaining)) = job
        .segments
        .iter()
        .enumerate()
        .map(|(i, s)| (i, s.remaining()))
        .max_by_key(|(_, r)| *r)
    {
        if remaining > 8 * 1024 * 1024 {
            let segment = &mut job.segments[i];
            let new_start = segment.start + segment.downloaded + remaining / 2;
            let end = segment.end;
            segment.end = new_start - 1;
            let n = job.segments.len();
            job.segments.push(Segment {
                start: new_start,
                end,
                downloaded: 0,
            });
            allocator.active.insert(n);
            return Some(n);
        }
    }
    None
}
pub fn run(
    job: SharedJob,
    store: Arc<Mutex<Store>>,
    settings: Settings,
    context: RequestContext,
    control: Arc<AtomicU8>,
    rate: u64,
) -> Result<()> {
    let snapshot = job.lock().unwrap().clone();
    if snapshot.verified_sha256.is_some() && snapshot.total == Some(snapshot.bytes) {
        return crate::finalize::finish(job, store, &settings, &control);
    }
    let mut metadata = inspect_controlled(&snapshot.url, &context, &settings, &control)?;
    // Advertised range support is only a hint. An actual 206 response is required.
    if metadata.url.starts_with("http") && metadata.ranges && metadata.total.is_some_and(|n| n > 0)
    {
        metadata.ranges =
            fetch_bytes(&metadata.url, &metadata.context, &settings, 1, Some((0, 0))).is_ok();
    }
    let total = metadata.total;
    let http = metadata.url.starts_with("http");
    let resumed = snapshot.bytes > 0;
    if resumed {
        let strong = snapshot.etag.as_ref().filter(|v| !v.starts_with("W/"));
        let unchanged = if let Some(etag) = strong {
            metadata.etag.as_ref() == Some(etag)
        } else {
            snapshot.modified.is_some()
                && snapshot.modified == metadata.modified
                && snapshot.total == total
        };
        if !unchanged || snapshot.total != total {
            bail!("source_changed: Resume cannot be verified; refresh the source or explicitly restart");
        }
        if !snapshot.resumable || !metadata.ranges || http && !settings.network.segmented {
            bail!(
                "resume_unsupported: Server no longer permits verified resume; explicitly restart"
            );
        }
    }
    if let Some(parent) = snapshot.destination.parent() {
        std::fs::create_dir_all(parent)
            .context("storage_error: Could not create output directory")?;
    }
    let path = part_path(&snapshot);
    let file = Arc::new(Mutex::new(crate::storage::open_partial(
        &path,
        !resumed && !snapshot.partial_created,
    )?));
    if !resumed && snapshot.partial_created {
        let f = file.lock().unwrap();
        f.set_len(0)
            .context("storage_error: Could not discard uncommitted owned bytes")?;
        crate::fault::io("sync").and_then(|_| f.sync_data())?;
    }
    if resumed {
        crate::storage::validate_checkpoint(&snapshot, file.lock().unwrap().metadata()?.len())?;
    }
    let ranged = http
        && settings.network.segmented
        && metadata.ranges
        && total.is_some_and(|n| n > 0)
        && (metadata.etag.as_ref().is_some_and(|v| !v.starts_with("W/"))
            || metadata.modified.is_some());
    {
        let mut j = job.lock().unwrap();
        j.total = total;
        j.etag = metadata.etag.clone();
        j.modified = metadata.modified.clone();
        j.resumable = ranged || !http && metadata.total.is_some() && metadata.modified.is_some();
        if !resumed {
            j.segments = vec![Segment {
                start: 0,
                end: total.map(|n| n.saturating_sub(1)).unwrap_or(u64::MAX - 1),
                downloaded: 0,
            }];
        }
        j.partial_created = true;
        store.lock().unwrap().put("job", &j.id, &*j)?;
        crate::fault::point("partial_created");
        j.state = JobState::Downloading;
    }
    let workers = if ranged {
        settings.connections.min(settings.host_connections).max(1)
    } else {
        1
    };
    let allocator = Arc::new(Mutex::new(Allocator {
        active: HashSet::new(),
    }));
    let error = Arc::new(Mutex::new(None::<String>));
    let transferred = Arc::new(Mutex::new(0u64));
    std::thread::scope(|scope| {
        for _ in 0..workers {
            let job = job.clone();
            let store = store.clone();
            let file = file.clone();
            let allocator = allocator.clone();
            let error = error.clone();
            let control = control.clone();
            let metadata = metadata.clone();
            let settings = settings.clone();
            let transferred = transferred.clone();
            scope.spawn(move || {
                worker(
                    job,
                    store,
                    file,
                    allocator,
                    error,
                    control,
                    metadata,
                    settings,
                    transferred,
                    ranged,
                    http,
                    rate,
                    workers,
                )
            });
        }
    });
    checkpoint(&job, &store, &file)?;
    if settings.quota_bytes == 0 {
        store
            .lock()
            .unwrap()
            .record_usage(*transferred.lock().unwrap())?;
    }
    if control.load(Ordering::Relaxed) != 0 {
        return Ok(());
    }
    if let Some(error) = error.lock().unwrap().take() {
        if ranged && !resumed && error.contains("range_invalid") {
            file.lock()
                .unwrap()
                .set_len(0)
                .context("storage_error: Could not restart rejected ranges")?;
            file.lock().unwrap().sync_data()?;
            drop(file);
            {
                let mut j = job.lock().unwrap();
                j.bytes = 0;
                j.segments.clear();
                j.viable = false;
                store.lock().unwrap().put("job", &j.id, &*j)?;
            }
            let mut serial = settings;
            serial.network.segmented = false;
            return run(job, store, serial, context, control, rate);
        }
        bail!(error);
    }
    file.lock()
        .unwrap()
        .sync_all()
        .context("storage_error: Final output flush failed")?;
    drop(file);
    if !http {
        let current = inspect_controlled(&metadata.url, &metadata.context, &settings, &control)?;
        if current.total != metadata.total || current.modified != metadata.modified {
            bail!("source_changed: FTP file changed during transfer");
        }
    }
    crate::finalize::finish(job, store, &settings, &control)
}

#[allow(clippy::too_many_arguments)]
fn worker(
    job: SharedJob,
    store: Arc<Mutex<Store>>,
    file: Arc<Mutex<File>>,
    allocator: Arc<Mutex<Allocator>>,
    error: Arc<Mutex<Option<String>>>,
    control: Arc<AtomicU8>,
    mut metadata: Metadata,
    settings: Settings,
    transferred: Arc<Mutex<u64>>,
    ranged: bool,
    http: bool,
    rate: u64,
    workers: usize,
) {
    while control.load(Ordering::Relaxed) == 0 && error.lock().unwrap().is_none() {
        let Some(index) = claim(&job, &allocator) else {
            break;
        };
        let mut last_error = None;
        let mut attempt = 0;
        let mut redirects = 0;
        let mut routes = crate::network::Routes::resolve(&metadata.url, &settings);
        loop {
            if control.load(Ordering::Relaxed) != 0 || error.lock().unwrap().is_some() {
                break;
            }
            if attempt > 0 && !ranged && http {
                // A serial response is replayed from zero, never appended to a failed body.
                let f = file.lock().unwrap();
                let mut j = job.lock().unwrap();
                if let Err(e) = f.set_len(0).and_then(|_| f.sync_data()) {
                    last_error = Some(format!("storage_error: {e}"));
                    break;
                }
                j.segments[index].downloaded = 0;
                j.bytes = 0;
                j.viable = false;
                if let Err(e) = store.lock().unwrap().put("job", &j.id, &*j) {
                    last_error = Some(format!("storage_error: {e}"));
                    break;
                }
            }
            let segment = job.lock().unwrap().segments[index].clone();
            let offset = segment.start + segment.downloaded;
            if segment.remaining() == 0 {
                break;
            }
            let mut retry_after = None;
            let result = (|| -> Result<()> {
                let route = routes.as_mut().map_err(|e| anyhow::anyhow!("{e}"))?;
                let mut easy = crate::pool::checkout_route(
                    &metadata.url,
                    &metadata.context,
                    &settings,
                    &control,
                    route.current(),
                )?;
                configure_route(
                    &mut easy,
                    &metadata.url,
                    &metadata.context,
                    &settings,
                    route.current(),
                )?;
                if rate > 0 {
                    easy.max_recv_speed((rate / workers as u64).max(1))?;
                }
                if ranged {
                    easy.range(&format!("{offset}-{}", segment.end))?;
                    let mut list = List::new();
                    list.append("Accept-Encoding: identity")?;
                    for (k, v) in &metadata.context.headers {
                        list.append(&format!("{k}: {v}"))?;
                    }
                    if let Some(v) = metadata.etag.as_ref().filter(|v| !v.starts_with("W/")) {
                        list.append(&format!("If-Range: {v}"))?;
                        list.append(&format!("If-Match: {v}"))?;
                    } else if let Some(v) = &metadata.modified {
                        list.append(&format!("If-Range: {v}"))?;
                    }
                    easy.http_headers(list)?;
                } else if !http && offset > 0 {
                    easy.resume_from(offset)?;
                }
                let headers = std::cell::RefCell::new(Headers::default());
                let mut invalid = None;
                let mut write_error = None;
                let mut split_boundary = false;
                let mut last_checkpoint = Instant::now();
                let attempt_started = Instant::now();
                let mut attempt_bytes = 0u64;
                let mut transfer = easy.transfer();
                transfer.header_function(|l| {
                    headers.borrow_mut().accept(l);
                    true
                })?;
                transfer.progress_function(|_, _, _, _| {
                    control.load(Ordering::Relaxed) == 0 && error.lock().unwrap().is_none()
                })?;
                transfer.write_function(|data| {
                                if control.load(Ordering::Relaxed)!=0 {return Ok(0);}
                                let h=headers.borrow();
                                if http {
                                    if matches!(h.status,301|302|303|307|308){return Ok(0);}
                                    if h.status>=400 {invalid=Some(crate::failure::http_error(h.status));return Ok(0);}
                                    if h.invalid || ranged && (h.status!=206 || h.range!=Some((offset,segment.end,metadata.total.unwrap())) || h.encoding.as_deref().is_some_and(|v|!v.eq_ignore_ascii_case("identity"))) {
                                        invalid=Some("range_invalid: Server returned an unexpected range; explicitly restart with one connection".into());return Ok(0);
                                    }
                                    if !ranged && h.status!=200 {invalid=Some(format!("HTTP {} while downloading",h.status));return Ok(0);}
                                    let changed = metadata.etag.as_ref().filter(|v| !v.starts_with("W/")).map_or(
                                        ranged && h.modified != metadata.modified,
                                        |etag| h.etag.as_ref() != Some(etag),
                                    );
                                    if changed {invalid=Some("source_changed: Remote validator changed during transfer".into());return Ok(0);}
                                }
                                drop(h);
                                let mut f=file.lock().unwrap();let mut j=job.lock().unwrap();
                                let remaining=j.segments[index].remaining();
                                let split=ranged && j.segments[index].end<segment.end;
                                if data.len() as u64>remaining && !split {invalid=Some("range_invalid: Response exceeds its expected byte count".into());return Ok(0);}
                                let mut count=data.len().min(remaining.min(usize::MAX as u64) as usize);
                                if split && count<data.len() {split_boundary=true;}
                                if count==0 {return Ok(0);}
                                if settings.quota_bytes>0 {
                                    let usage=store.lock().unwrap();
                                    let used=match usage.usage(settings.quota_minutes) {Ok(v)=>v,Err(e)=>{write_error=Some(format!("storage_error: {e}"));return Ok(0);}};
                                    count=count.min(settings.quota_bytes.saturating_sub(used).min(usize::MAX as u64) as usize);
                                    if let Err(e)=usage.record_usage(count as u64) {write_error=Some(format!("storage_error: {e}"));return Ok(0);}
                                    if count==0 {control.store(3,Ordering::Relaxed);return Ok(0);}
                                }
                                let s=&mut j.segments[index];
                                if let Err(e)=crate::fault::io("write").and_then(|_|f.seek(SeekFrom::Start(s.start+s.downloaded))).and_then(|_|f.write_all(&data[..count])) {write_error=Some(format!("storage_error: {e}"));return Ok(0);}
                                s.downloaded+=count as u64;j.bytes=j.segments.iter().map(|s|s.downloaded).sum();attempt_bytes+=count as u64;
                                j.speed=(attempt_bytes as f64/attempt_started.elapsed().as_secs_f64().max(0.001)) as u64;
                                j.viable=true;*transferred.lock().unwrap()+=count as u64;
                                drop(j);drop(f);
                                if count<data.len() && !split_boundary {control.store(3,Ordering::Relaxed);}
                                if last_checkpoint.elapsed()>Duration::from_millis(settings.network.checkpoint_milliseconds) {
                                    if let Err(e)=checkpoint(&job,&store,&file) {write_error=Some(format!("storage_error: {e}"));return Ok(0);}
                                    last_checkpoint=Instant::now();
                                }
                                Ok(count)
                            })?;
                let result = transfer.perform();
                drop(transfer);
                let h = headers.borrow();
                retry_after = h.retry_after;
                if matches!(h.status, 429 | 503) {
                    crate::pool::backoff(&metadata.url);
                }
                if control.load(Ordering::Relaxed) != 0 {
                    return Ok(());
                }
                if result
                    .as_ref()
                    .is_err_and(|e| route.advance(e, h.status, attempt_bytes))
                {
                    bail!("proxy_failover");
                }
                if matches!(h.status, 301 | 302 | 303 | 307 | 308) {
                    let (url, context) =
                        redirected(&metadata.url, h.location.as_deref(), &metadata.context)?;
                    drop(h);
                    drop(easy);
                    let next = inspect_controlled(&url, &context, &settings, &control)?;
                    let changed = metadata
                        .etag
                        .as_ref()
                        .filter(|v| !v.starts_with("W/"))
                        .map_or(next.modified != metadata.modified, |etag| {
                            next.etag.as_ref() != Some(etag)
                        });
                    if next.total != metadata.total || changed {
                        bail!("source_changed: Redirect target differs from the validated source");
                    }
                    metadata = next;
                    routes = crate::network::Routes::resolve(&metadata.url, &settings);
                    bail!("redirect_retry");
                }
                if let Some(e) = write_error.or(invalid) {
                    bail!(e);
                }
                if http && !ranged && !matches!(h.status, 200 | 204) && h.status < 400 {
                    bail!(
                        "protocol_unsupported: Unexpected successful HTTP status {}",
                        h.status
                    );
                }
                if http && h.status >= 400 {
                    bail!("{}", crate::failure::http_error(h.status));
                }
                if http
                    && (h.invalid
                        || ranged
                            && (h.status != 206
                                || h.range != Some((offset, segment.end, metadata.total.unwrap()))))
                {
                    bail!("range_invalid: Invalid or missing range response");
                }
                // Check libcurl's result before trusting the bytes or marking a segment complete.
                if !(split_boundary && result.as_ref().is_err_and(|e| e.is_write_error())) {
                    if let Err(e) = &result {
                        if !http && (e.is_range_error() || e.is_bad_download_resume()) {
                            bail!(
                                "resume_unsupported: FTP server refused REST; explicitly restart"
                            );
                        }
                    }
                    result.context("Transfer interrupted")?;
                }
                let mut j = job.lock().unwrap();
                if ranged {
                    if j.segments[index].remaining() != 0 {
                        bail!("Truncated range response");
                    }
                } else {
                    let length = j.segments[index].downloaded;
                    if metadata.total.is_some_and(|n| n != length) {
                        bail!("Truncated response");
                    }
                    if length == 0 {
                        j.segments.clear();
                    } else {
                        j.segments[index].end = length - 1;
                    }
                    j.total = Some(length);
                }
                Ok(())
            })();
            match result {
                Ok(()) => {
                    last_error = None;
                    break;
                }
                Err(e) => {
                    let message = e.to_string();
                    if message == "proxy_failover" {
                        continue;
                    }
                    if message == "redirect_retry" {
                        redirects += 1;
                        if redirects <= 10 {
                            continue;
                        }
                        last_error = Some("protocol_unsupported: Too many GET redirects".into());
                        break;
                    }
                    let fatal = !crate::failure::TransferFailure::classify(&message).retryable;
                    last_error = Some(message);
                    if fatal || attempt == settings.network.retries {
                        break;
                    }
                    // A failed transfer that filled a range must replay that range, not finalize it.
                    if ranged && job.lock().unwrap().segments[index].remaining() == 0 {
                        let mut j = job.lock().unwrap();
                        j.segments[index].downloaded = segment.downloaded;
                    }
                    let delay = retry_after.unwrap_or((1u64 << attempt).min(30)).min(3600);
                    attempt += 1;
                    for _ in 0..delay * 10 {
                        if control.load(Ordering::Relaxed) != 0 || error.lock().unwrap().is_some() {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                }
            }
        }
        allocator.lock().unwrap().active.remove(&index);
        if let Some(e) = last_error {
            // Other workers abort once this is set. Their curl cancellation
            // must not replace the primary storage/source failure.
            let mut primary = error.lock().unwrap();
            if primary.is_none() {
                *primary = Some(e);
            }
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encoded_unicode_filename_is_portable() {
        let mut headers = Headers::default();
        headers.accept(b"Content-Disposition: attachment; filename*=UTF-8''%E7%95%8C-%D8%B9%D8%B1%D8%A8%D9%8A.bin\r\n");
        assert_eq!(headers.filename.as_deref(), Some("界-عربي.bin"));
    }
    #[test]
    fn parse_response_and_ranges() {
        let mut h = Headers::default();
        for l in [
            "HTTP/2 206\r\n",
            "Content-Range: bytes 10-19/100\r\n",
            "ETag: \"v1\"\r\n",
        ] {
            h.accept(l.as_bytes());
        }
        assert_eq!(h.range, Some((10, 19, 100)));
        h.accept(b"HTTP/1.1 302 Found\r\n");
        assert!(h.range.is_none());
    }
}
