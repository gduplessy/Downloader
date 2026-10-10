use crate::{model::*, security, store::Store};
use anyhow::{bail, Context, Result};
use curl::easy::{Auth, Easy, List};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
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
            "content-length" => self.length = value.parse().ok(),
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
    security::validate_url(url)?;
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
    easy.useragent("Downloader/0.1")?;
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
        let mut auth = Auth::new();
        auth.basic(true).digest(true).ntlm(true).gssnegotiate(true);
        easy.http_auth(&auth)?;
    }
    if let Some(proxy) = settings.proxy.as_ref().filter(|s| !s.is_empty()) {
        easy.proxy(proxy)?;
    }
    if let Some(id) = &settings.proxy_credential {
        let (user, password) = security::credential(id)?;
        easy.proxy_username(&user)?;
        easy.proxy_password(&password)?;
        let mut auth = Auth::new();
        auth.basic(true).digest(true).ntlm(true).gssnegotiate(true);
        easy.proxy_auth(&auth)?;
    }
    Ok(())
}
pub fn inspect(url: &str, context: &RequestContext, settings: &Settings) -> Result<Metadata> {
    let mut url = security::validate_url(url)?;
    let mut context = context.clone();
    let mut easy = Easy::new();
    for _ in 0..10 {
        configure(&mut easy, url.as_str(), &context, settings)?;
        easy.nobody(true)?;
        easy.fetch_filetime(true)?;
        let mut headers = Headers::default();
        {
            let mut transfer = easy.transfer();
            transfer.header_function(|line| {
                headers.accept(line);
                true
            })?;
            transfer.perform()?;
        }
        headers.status = easy.response_code()?;
        if matches!(headers.status, 301 | 302 | 303 | 307 | 308) {
            let next = url.join(
                headers
                    .location
                    .as_deref()
                    .context("Redirect lacks Location")?,
            )?;
            security::validate_url(next.as_str())?;
            if next.origin() != url.origin() {
                context.headers.clear();
                context.credential_id = None;
            }
            url = next;
            continue;
        }
        if matches!(headers.status, 405 | 501) {
            configure(&mut easy, url.as_str(), &context, settings)?;
            easy.range("0-0")?;
            headers = Headers::default();
            let mut transfer = easy.transfer();
            transfer.header_function(|line| {
                headers.accept(line);
                true
            })?;
            transfer.write_function(|_| Ok(0))?;
            let result = transfer.perform();
            if let Err(e) = result {
                if !e.is_write_error() {
                    return Err(e.into());
                }
            }
        }
        if matches!(headers.status, 401 | 407) {
            bail!("authentication_required: HTTP {}", headers.status);
        }
        if headers.status >= 400 {
            bail!("HTTP {} while inspecting source", headers.status);
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
        let total = headers.range.map(|r| r.2).or(headers.length);
        return Ok(Metadata {
            status: headers.status,
            total,
            etag: headers.etag,
            modified: headers.modified,
            ranges: headers.ranges || headers.range.is_some(),
            content_type: headers.content_type,
            filename: headers.filename,
            url: url.into(),
            context,
        });
    }
    bail!("Too many redirects")
}
pub fn fetch_bytes(
    url: &str,
    context: &RequestContext,
    settings: &Settings,
    limit: usize,
    range: Option<(u64, u64)>,
) -> Result<(Headers, Vec<u8>)> {
    let metadata = inspect(url, context, settings)?;
    let mut easy = Easy::new();
    configure(&mut easy, &metadata.url, &metadata.context, settings)?;
    if let Some((start, end)) = range {
        easy.range(&format!("{start}-{end}"))?;
    }
    let mut headers = Headers::default();
    let mut bytes = Vec::new();
    {
        let mut transfer = easy.transfer();
        transfer.header_function(|l| {
            headers.accept(l);
            true
        })?;
        transfer.write_function(|data| {
            if bytes.len() + data.len() > limit {
                return Ok(0);
            }
            bytes.extend_from_slice(data);
            Ok(data.len())
        })?;
        transfer.perform()?;
    }
    if headers.status >= 400 {
        bail!("HTTP {}", headers.status);
    }
    if let Some((a, b)) = range {
        if headers.status != 206 || headers.range.map(|r| (r.0, r.1)) != Some((a, b)) {
            bail!("Server ignored or returned an invalid byte range");
        }
    }
    Ok((headers, bytes))
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
    // The file and job locks keep offsets consistent with the bytes being fsynced.
    let file = file.lock().unwrap();
    let mut job = job.lock().unwrap();
    file.sync_data()?;
    job.bytes = job.segments.iter().map(|s| s.downloaded).sum();
    job.updated = chrono::Utc::now();
    store.lock().unwrap().put("job", &job.id, &*job)?;
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
    let mut metadata = inspect(&snapshot.url, &context, &settings)?;
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
        if !unchanged || !snapshot.resumable || !metadata.ranges {
            bail!("source_changed: Resume cannot be verified; refresh the source or explicitly restart");
        }
    }
    if let Some(parent) = snapshot.destination.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let path = part_path(&snapshot);
    let file = Arc::new(Mutex::new(
        OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(!resumed)
            .open(&path)?,
    ));
    if resumed
        && file.lock().unwrap().metadata()?.len()
            < snapshot
                .segments
                .iter()
                .map(|s| s.start + s.downloaded)
                .max()
                .unwrap_or(0)
    {
        bail!("storage_error: Partial file is missing or truncated; explicitly restart");
    }
    let ranged = http && metadata.ranges && total.is_some_and(|n| n > 0);
    {
        let mut j = job.lock().unwrap();
        j.total = total;
        j.etag = metadata.etag.clone();
        j.modified = metadata.modified.clone();
        j.resumable = ranged;
        if !resumed {
            j.segments = vec![Segment {
                start: 0,
                end: total.map(|n| n.saturating_sub(1)).unwrap_or(u64::MAX - 1),
                downloaded: 0,
            }];
        }
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
            scope.spawn(move||{
                let mut easy=Easy::new();
                while control.load(Ordering::Relaxed)==0 && error.lock().unwrap().is_none(){
                    let Some(index)=claim(&job,&allocator)else{break};
                    let mut last_error=None;
                    for attempt in 0..6 {
                        if control.load(Ordering::Relaxed)!=0{break;}
                        let segment=job.lock().unwrap().segments[index].clone();let offset=segment.start+segment.downloaded;
                        if segment.remaining()==0{break;}
                        let result=(||->Result<()> {
                            configure(&mut easy,&metadata.url,&metadata.context,&settings)?;
                            if rate>0{easy.max_recv_speed((rate/workers as u64).max(1))?;}
                            if ranged{easy.range(&format!("{offset}-{}",segment.end))?;let mut list=List::new();list.append("Accept-Encoding: identity")?;for(k,v)in &metadata.context.headers{list.append(&format!("{k}: {v}"))?;}
if resumed{if let Some(v)=metadata.etag.as_ref().filter(|v|!v.starts_with("W/")){list.append(&format!("If-Range: {v}"))?;}else if let Some(v)=&metadata.modified{list.append(&format!("If-Range: {v}"))?;}}easy.http_headers(list)?;}
                            let headers=std::cell::RefCell::new(Headers::default());let mut invalid=None;let mut write_error=None;let mut last_checkpoint=Instant::now();let attempt_started=Instant::now();let mut attempt_bytes=0u64;
                            let mut transfer=easy.transfer();transfer.header_function(|l|{headers.borrow_mut().accept(l);true})?;
                            transfer.progress_function(|_,_,_,_|control.load(Ordering::Relaxed)==0)?;
                            transfer.write_function(|data|{
                                if control.load(Ordering::Relaxed)!=0{return Ok(0);}
                                let h=headers.borrow();
                                if http {
                                    if h.status>=400{invalid=Some(format!("HTTP {}{}",h.status,h.retry_after.map(|n|format!(" retry_after={n}")).unwrap_or_default()));return Ok(0);}
if ranged&& (h.status!=206||h.range!=Some((offset,segment.end,metadata.total.unwrap()))){invalid=Some("range_invalid: Server ignored or returned an invalid byte range; restart with one connection".to_string());return Ok(0);}
                                    if !ranged&&h.status!=200{invalid=Some(format!("HTTP {} while downloading",h.status));return Ok(0);}
                                    if h.etag.is_some()&&metadata.etag.is_some()&&h.etag!=metadata.etag{invalid=Some("source_changed: Remote validator changed during transfer".into());return Ok(0);}
                                }
                                drop(h);
                                let mut f=file.lock().unwrap();let mut j=job.lock().unwrap();let s=&mut j.segments[index];let mut count=data.len().min(s.remaining().min(usize::MAX as u64)as usize);
                                if settings.quota_bytes>0{let usage=store.lock().unwrap();let used=match usage.usage(settings.quota_minutes){Ok(value)=>value,Err(e)=>{write_error=Some(format!("storage_error: {e}"));return Ok(0);}};let available=settings.quota_bytes.saturating_sub(used);count=count.min(available as usize);if let Err(e)=usage.record_usage(count as u64){write_error=Some(format!("storage_error: {e}"));return Ok(0);}
if count==0{control.store(3,Ordering::Relaxed);return Ok(0);}}
if count==0{return Ok(0);}
                                let write=f.seek(SeekFrom::Start(s.start+s.downloaded)).and_then(|_|f.write_all(&data[..count]));
                                if let Err(e)=write{write_error=Some(format!("storage_error: {e}"));return Ok(0);}
                                s.downloaded+=count as u64;j.bytes=j.segments.iter().map(|s|s.downloaded).sum();attempt_bytes+=count as u64;j.speed=(attempt_bytes as f64/attempt_started.elapsed().as_secs_f64().max(0.001))as u64;j.viable=true;*transferred.lock().unwrap()+=count as u64;
                                drop(j);drop(f);if settings.quota_bytes>0&&count<data.len(){control.store(3,Ordering::Relaxed);}
                                if last_checkpoint.elapsed()>Duration::from_secs(1){if let Err(e)=checkpoint(&job,&store,&file){write_error=Some(format!("storage_error: {e}"));return Ok(0);}last_checkpoint=Instant::now();}
                                Ok(count)
                            })?;
                            let result=transfer.perform();drop(transfer);
                            if let Some(e)=write_error.or(invalid){bail!(e);}
                            let h=headers.borrow();
                            if h.status>=400{bail!("HTTP {}{}",h.status,h.retry_after.map(|n|format!(" retry_after={n}")).unwrap_or_default());}
                            if control.load(Ordering::Relaxed)!=0{return Ok(());}
                            let complete=job.lock().unwrap().segments[index].remaining()==0;
                            if complete {return Ok(());}
                            if !ranged {result?;let mut j=job.lock().unwrap();let length=j.segments[index].downloaded;if let Some(expected)=metadata.total{if length!=expected{bail!("Truncated response: expected {expected} bytes, received {length}");}}j.segments[index].end=length.saturating_sub(1);j.total=Some(length);return Ok(());}
                            if let Err(e)=result {bail!("Transfer interrupted: {e}");}bail!("Truncated range response")
                        })();
                        match result {Ok(())=>{last_error=None;break},Err(e)=>{
                            let message=e.to_string();let fatal=message.contains("range_invalid")||message.contains("source_changed")||message.contains("storage_error")||message.contains("HTTP 401")||message.contains("HTTP 403")||message.contains("HTTP 404");
                            last_error=Some(message);if fatal||attempt==5||!ranged{break;}
                            let retry_after=last_error.as_ref().and_then(|s|s.split("retry_after=").nth(1)).and_then(|n|n.parse::<u64>().ok());
                            let delay=retry_after.unwrap_or((1u64<<attempt).min(30)).min(3600);for _ in 0..delay*10{if control.load(Ordering::Relaxed)!=0{break;}std::thread::sleep(Duration::from_millis(100));}
                        }}
                    }
                    allocator.lock().unwrap().active.remove(&index);
                    if let Some(e)=last_error{*error.lock().unwrap()=Some(e);break;}
                }
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
        bail!(error);
    }
    {
        let mut j = job.lock().unwrap();
        if let Some(total) = j.total {
            if j.bytes != total {
                bail!("Incomplete transfer: received {} of {total}", j.bytes);
            }
        }
        j.state = JobState::Verifying;
        store.lock().unwrap().put("job", &j.id, &*j)?;
    }
    if let Some(expected) = &snapshot.checksum {
        let mut f = File::open(&path)?;
        let mut hash = Sha256::new();
        let mut buffer = vec![0; 128 * 1024];
        loop {
            let n = f.read(&mut buffer)?;
            if n == 0 {
                break;
            }
            hash.update(&buffer[..n]);
        }
        let actual = format!("{:x}", hash.finalize());
        if !actual.eq_ignore_ascii_case(expected) {
            bail!("checksum_mismatch: SHA-256 does not match; partial output preserved");
        }
    }
    {
        let mut j = job.lock().unwrap();
        j.state = JobState::Assembling;
        store.lock().unwrap().put("job", &j.id, &*j)?;
    }
    file.lock().unwrap().sync_all()?;
    drop(file);
    // Never overwrite an unrelated file that appeared after the destination was reserved.
    std::fs::hard_link(&path, &snapshot.destination)
        .context("storage_error: Could not finalize without overwriting an existing file")?;
    security::mark_download(&snapshot.destination, &metadata.url)?;
    if let Some(scanner) = &settings.scanner {
        job.lock().unwrap().state = JobState::Scanning;
        let status = std::process::Command::new(&scanner.executable)
            .args(
                scanner
                    .args
                    .iter()
                    .map(|a| a.replace("{file}", &snapshot.destination.to_string_lossy())),
            )
            .status()?;
        if !status.success() {
            bail!("scan_failed: Scanner reported an error or threat; file was not opened");
        }
    }
    {
        let mut j = job.lock().unwrap();
        j.state = JobState::Complete;
        store.lock().unwrap().put("job", &j.id, &*j)?;
    }
    std::fs::remove_file(&path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
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
