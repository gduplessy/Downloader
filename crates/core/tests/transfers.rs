use downloader_core::{model::*, transfer, Engine};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, AtomicU8, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
#[test]
fn interrupted_finalization_recovers_without_network() {
    let dir = tempfile::tempdir().unwrap();
    let e = isolated_engine(dir.path());
    let mut j = e
        .add(AddJob {
            request_id: "finalize".into(),
            url: "https://example.invalid/file".into(),
            filename: Some("recovered.bin".into()),
            directory: Some(dir.path().into()),
            queue: None,
            checksum: Some(digest(b"complete output")),
            paused: true,
            context: RequestContext::default(),
            media: None,
            description: String::new(),
        })
        .unwrap();
    std::fs::write(transfer::part_path(&j), b"complete output").unwrap();
    j.bytes = 15;
    j.total = Some(15);
    j.state = JobState::Assembling;
    e.store.lock().unwrap().put("job", &j.id, &j).unwrap();
    drop(e);
    let e = isolated_engine(dir.path());
    let recovered = e.job(&j.id).unwrap().lock().unwrap().clone();
    assert_eq!(recovered.state, JobState::Complete);
    assert_eq!(
        std::fs::read(&recovered.destination).unwrap(),
        b"complete output"
    );
    assert!(!transfer::part_path(&recovered).exists());
}
struct Server {
    url: String,
    stop: Arc<AtomicBool>,
    version: Arc<AtomicU8>,
    data: Arc<Vec<u8>>,
}
impl Server {
    fn new() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let stop = Arc::new(AtomicBool::new(false));
        let version = Arc::new(AtomicU8::new(1));
        let data = Arc::new(
            (0..20 * 1024 * 1024)
                .map(|i| (i % 251) as u8)
                .collect::<Vec<_>>(),
        );
        let (s, v, d) = (stop.clone(), version.clone(), data.clone());
        std::thread::spawn(move || {
            while !s.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let (v, d) = (v.clone(), d.clone());
                        std::thread::spawn(move || {
                            let _ = respond(stream, &d, v.load(Ordering::Relaxed));
                        });
                    }
                    Err(_) => std::thread::sleep(Duration::from_millis(5)),
                }
            }
        });
        Self {
            url,
            stop,
            version,
            data,
        }
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}
fn respond(mut stream: TcpStream, data: &[u8], version: u8) -> std::io::Result<()> {
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    let mut request = vec![];
    let mut byte = [0u8; 1];
    while !request.ends_with(b"\r\n\r\n") && request.len() < 65536 {
        stream.read_exact(&mut byte)?;
        request.push(byte[0]);
    }
    let request = String::from_utf8_lossy(&request);
    let line = request.lines().next().unwrap();
    let path = line.split_whitespace().nth(1).unwrap();
    let head = line.starts_with("HEAD");
    if path == "/redirect" {
        write!(stream,"HTTP/1.1 302 Found\r\nLocation: /file\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")?;
        return Ok(());
    }
    if head && matches!(path, "/nohead" | "/fallbackredirect") {
        write!(
            stream,
            "HTTP/1.1 405 No HEAD\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        )?;
        return Ok(());
    }
    if !head && matches!(path, "/fallbackredirect" | "/getredirect") {
        write!(stream,"HTTP/1.1 302 Found\r\nLocation: /file\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")?;
        return Ok(());
    }
    if path == "/empty" {
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nETag: \"empty\"\r\nConnection: close\r\n\r\n"
        )?;
        return Ok(());
    }
    if matches!(path, "/auth" | "/expired") {
        let status = if path == "/auth" { 401 } else { 410 };
        write!(
            stream,
            "HTTP/1.1 {status} Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        )?;
        return Ok(());
    }
    let unknown = path == "/unknown";
    let range = request
        .lines()
        .find_map(|l| {
            l.strip_prefix("Range: bytes=")
                .or_else(|| l.strip_prefix("range: bytes="))
        })
        .and_then(|r| r.trim().split_once('-'))
        .and_then(|(a, b)| a.parse::<usize>().ok().zip(b.parse::<usize>().ok()));
    let range = if path == "/ignored"
        || unknown
        || path == "/serialtruncated"
        || path == "/lateignored" && !head && range != Some((0, 0))
    {
        None
    } else {
        range
    };
    let (a, b) = range.unwrap_or((0, data.len() - 1));
    let b = b.min(data.len() - 1);
    let length = b - a + 1;
    let status = if range.is_some() { 206 } else { 200 };
    write!(
        stream,
        "HTTP/1.1 {status} OK\r\nConnection: close\r\nContent-Type: application/octet-stream\r\n"
    )?;
    if path != "/missingvalidator" || head || range == Some((0, 0)) {
        write!(stream, "ETag: \"v{version}\"\r\n")?;
    }
    if !unknown {
        write!(
            stream,
            "Content-Length: {length}\r\nAccept-Ranges: bytes\r\n"
        )?;
    }
    if range.is_some() {
        write!(stream, "Content-Range: bytes {a}-{b}/{}\r\n", data.len())?;
    }
    write!(
        stream,
        "Content-Disposition: attachment; filename=\"archive.bin\"\r\n\r\n"
    )?;
    if head {
        return Ok(());
    }
    let end = if path == "/truncated" || path == "/serialtruncated" {
        a + length / 2
    } else {
        b + 1
    };
    for bytes in data[a..end].chunks(16384) {
        stream.write_all(bytes)?;
        if path == "/slow" {
            std::thread::sleep(Duration::from_millis(2));
        }
    }
    Ok(())
}
fn add(
    e: &Arc<Engine>,
    server: &Server,
    path: &str,
    dir: &std::path::Path,
    checksum: Option<String>,
) -> Job {
    e.add(AddJob {
        request_id: uuid::Uuid::new_v4().to_string(),
        url: format!("{}{path}", server.url),
        filename: Some("output.bin".into()),
        directory: Some(dir.into()),
        queue: None,
        checksum,
        paused: false,
        context: RequestContext::default(),
        media: None,
        description: String::new(),
    })
    .unwrap()
}
fn wait(e: &Engine, id: &str, predicate: impl Fn(&Job) -> bool) -> Job {
    let start = Instant::now();
    loop {
        let job = e.job(id).unwrap().lock().unwrap().clone();
        if predicate(&job) {
            return job;
        }
        assert!(
            start.elapsed() < Duration::from_secs(25),
            "Timed out in {:?}: {:?}; bytes={} segments={:?}",
            job.state,
            job.error,
            job.bytes,
            job.segments
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
#[test]
fn segmented_download_and_checksum() {
    let server = Server::new();
    let dir = tempfile::tempdir().unwrap();
    let e = isolated_engine(dir.path());
    e.start();
    let j = add(&e, &server, "/file", dir.path(), Some(digest(&server.data)));
    let j = wait(&e, &j.id, |j| {
        matches!(j.state, JobState::Complete | JobState::Failed)
    });
    e.shutdown();
    assert_eq!(j.state, JobState::Complete, "{:?}", j.error);
    assert!(j.segments.len() > 1);
    assert_eq!(
        digest(&std::fs::read(&j.destination).unwrap()),
        digest(&server.data)
    );
    assert!(!transfer::part_path(&j).exists());
}
#[test]
fn ignored_ranges_and_unknown_length_fall_back_safely() {
    let server = Server::new();
    for path in [
        "/ignored",
        "/unknown",
        "/redirect",
        "/nohead",
        "/fallbackredirect",
        "/getredirect",
        "/lateignored",
    ] {
        let dir = tempfile::tempdir().unwrap();
        let e = isolated_engine(dir.path());
        e.start();
        let j = add(&e, &server, path, dir.path(), None);
        let j = wait(&e, &j.id, |j| {
            matches!(j.state, JobState::Complete | JobState::Failed)
        });
        e.shutdown();
        assert_eq!(j.state, JobState::Complete, "{path}: {:?}", j.error);
        assert_eq!(
            digest(&std::fs::read(&j.destination).unwrap()),
            digest(&server.data)
        );
    }
}
#[test]
fn pause_checkpoint_resume_and_changed_validator() {
    let server = Server::new();
    let dir = tempfile::tempdir().unwrap();
    let e = isolated_engine(dir.path());
    e.start();
    let j = add(&e, &server, "/slow", dir.path(), Some(digest(&server.data)));
    wait(&e, &j.id, |j| j.bytes > 256 * 1024);
    e.command(Command::Pause { id: j.id.clone() }).unwrap();
    let paused = wait(&e, &j.id, |j| j.state == JobState::Paused);
    assert!(paused.bytes > 0 && paused.bytes < server.data.len() as u64);
    e.shutdown();
    drop(e);
    let e = isolated_engine(dir.path());
    e.start();
    server.version.store(2, Ordering::Relaxed);
    e.command(Command::Resume {
        id: j.id.clone(),
        restart: false,
    })
    .unwrap();
    let blocked = wait(&e, &j.id, |j| j.state == JobState::WaitingSource);
    assert!(!blocked.destination.exists());
    server.version.store(1, Ordering::Relaxed);
    e.command(Command::Resume {
        id: j.id.clone(),
        restart: false,
    })
    .unwrap();
    let done = wait(&e, &j.id, |j| {
        matches!(j.state, JobState::Complete | JobState::Failed)
    });
    e.shutdown();
    assert_eq!(done.state, JobState::Complete, "{:?}", done.error);
    assert_eq!(
        digest(&std::fs::read(&done.destination).unwrap()),
        digest(&server.data)
    );
}
#[test]
fn checksum_failure_never_publishes_output() {
    let server = Server::new();
    let dir = tempfile::tempdir().unwrap();
    let e = isolated_engine(dir.path());
    e.start();
    let j = add(&e, &server, "/file", dir.path(), Some("0".repeat(64)));
    let failed = wait(&e, &j.id, |j| j.state == JobState::Failed);
    e.shutdown();
    assert!(failed.error.unwrap().contains("checksum_mismatch"));
    assert!(!failed.destination.exists());
    assert!(transfer::part_path(&e.job(&j.id).unwrap().lock().unwrap()).exists());
}
#[test]
fn hosted_page_is_never_downloaded_as_the_file() {
    let dir = tempfile::tempdir().unwrap();
    let e = isolated_engine(dir.path());
    let request = AddJob {
        request_id: "page".into(),
        url: "https://example.com/hosted".into(),
        filename: None,
        directory: Some(dir.path().into()),
        queue: None,
        checksum: None,
        paused: false,
        context: RequestContext::default(),
        media: None,
        description: String::new(),
    };
    let j: Job = serde_json::from_value(e.command(Command::Navigate(request)).unwrap()).unwrap();
    e.start();
    std::thread::sleep(Duration::from_millis(350));
    assert_eq!(
        e.job(&j.id).unwrap().lock().unwrap().state,
        JobState::WaitingBrowser
    );
    assert!(!j.destination.exists());
    assert!(!transfer::part_path(&j).exists());
    let first = uuid::Uuid::new_v4().to_string();
    let second = uuid::Uuid::new_v4().to_string();
    e.command(Command::ClaimNavigation {
        id: j.id.clone(),
        owner: first.clone(),
        force: false,
    })
    .unwrap();
    assert!(e
        .command(Command::ClaimNavigation {
            id: j.id.clone(),
            owner: second.clone(),
            force: false
        })
        .is_err());
    assert!(e
        .command(Command::BrowserStatus {
            id: j.id.clone(),
            owner: second.clone(),
            state: JobState::BrowserComplete,
            message: None,
            bytes: 1,
            total: Some(1)
        })
        .is_err());
    assert_eq!(
        e.job(&j.id)
            .unwrap()
            .lock()
            .unwrap()
            .navigation_owner
            .as_ref(),
        Some(&first)
    );
    e.command(Command::Resume {
        id: j.id.clone(),
        restart: false,
    })
    .unwrap();
    assert_eq!(
        e.job(&j.id).unwrap().lock().unwrap().state,
        JobState::WaitingBrowser
    );
    e.shutdown();
    drop(e);
    let recovered = isolated_engine(dir.path());
    assert_eq!(
        recovered
            .job(&j.id)
            .unwrap()
            .lock()
            .unwrap()
            .navigation_owner
            .as_ref(),
        Some(&first)
    );
    recovered
        .command(Command::ClaimNavigation {
            id: j.id.clone(),
            owner: second,
            force: true,
        })
        .unwrap();
}

#[test]
fn rolling_quota_stops_exactly_and_resumes_without_corruption() {
    let server = Server::new();
    let dir = tempfile::tempdir().unwrap();
    let e = isolated_engine(dir.path());
    let mut settings = e.snapshot().settings;
    settings.quota_bytes = 300_003;
    e.command(Command::Settings(settings.clone())).unwrap();
    e.start();
    let created = add(&e, &server, "/file", dir.path(), Some(digest(&server.data)));
    let blocked = wait(&e, &created.id, |j| j.state == JobState::WaitingQuota);
    assert_eq!(blocked.bytes, settings.quota_bytes);
    assert_eq!(
        e.store
            .lock()
            .unwrap()
            .usage(settings.quota_minutes)
            .unwrap(),
        settings.quota_bytes
    );
    assert!(!blocked.destination.exists());
    settings.quota_bytes = 0;
    e.command(Command::Settings(settings)).unwrap();
    let complete = wait(&e, &created.id, |j| {
        matches!(j.state, JobState::Complete | JobState::Failed)
    });
    e.shutdown();
    assert_eq!(complete.state, JobState::Complete, "{:?}", complete.error);
    assert_eq!(
        digest(&std::fs::read(complete.destination).unwrap()),
        digest(&server.data)
    );
}

#[test]
fn browser_resolved_source_uses_server_filename_and_complete_hash() {
    let server = Server::new();
    let dir = tempfile::tempdir().unwrap();
    let e = isolated_engine(dir.path());
    let value = e
        .command(Command::Navigate(AddJob {
            request_id: "resolved".into(),
            url: format!("{}/hosted", server.url),
            filename: None,
            directory: Some(dir.path().into()),
            queue: None,
            checksum: Some(digest(&server.data)),
            paused: false,
            context: RequestContext::default(),
            media: None,
            description: String::new(),
        }))
        .unwrap();
    let j: Job = serde_json::from_value(value).unwrap();
    let owner = uuid::Uuid::new_v4().to_string();
    e.command(Command::ClaimNavigation {
        id: j.id.clone(),
        owner: owner.clone(),
        force: false,
    })
    .unwrap();
    let resolved: Job = serde_json::from_value(
        e.command(Command::Resolve {
            id: j.id.clone(),
            owner,
            url: format!("{}/file", server.url),
            filename: None,
            context: RequestContext::default(),
        })
        .unwrap(),
    )
    .unwrap();
    assert_eq!(resolved.filename, "archive.bin");
    e.start();
    let complete = wait(&e, &j.id, |j| {
        matches!(j.state, JobState::Complete | JobState::Failed)
    });
    e.shutdown();
    assert_eq!(complete.state, JobState::Complete, "{:?}", complete.error);
    assert_eq!(
        digest(&std::fs::read(complete.destination).unwrap()),
        digest(&server.data)
    );
}

#[test]
fn empty_output_and_actionable_source_failures() {
    let server = Server::new();
    for (path, state, code) in [
        ("/empty", JobState::Complete, None),
        (
            "/auth",
            JobState::WaitingAuthentication,
            Some(downloader_core::failure::FailureCode::AuthenticationRequired),
        ),
        (
            "/expired",
            JobState::WaitingSource,
            Some(downloader_core::failure::FailureCode::SourceExpired),
        ),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let e = isolated_engine(dir.path());
        e.start();
        let j = add(&e, &server, path, dir.path(), None);
        let j = wait(&e, &j.id, |j| {
            !j.state.active() && j.state != JobState::Queued
        });
        e.shutdown();
        assert_eq!(j.state, state, "{:?}", j.error);
        if let Some(code) = code {
            assert_eq!(j.failure.unwrap().code, code);
            assert!(!j.destination.exists());
        } else {
            assert_eq!(std::fs::metadata(j.destination).unwrap().len(), 0);
            assert_eq!(j.verified_sha256, Some(digest(b"")));
        }
    }
}
#[test]
fn malformed_headers_are_rejected() {
    for header in [
        "Content-Range: bytes 20-10/100",
        "Content-Range: bytes 0-100/100",
        "Content-Range: bytes garbage",
        "Content-Length: nope",
    ] {
        let mut h = transfer::Headers::default();
        h.accept(header.as_bytes());
        assert!(h.invalid, "{header}");
    }
    let mut h = transfer::Headers::default();
    h.accept(b"Content-Length: 10");
    h.accept(b"Content-Length: 11");
    assert!(h.invalid);
}

fn isolated_engine(path: &std::path::Path) -> Arc<Engine> {
    let e = Engine::open(path).unwrap();
    let mut settings = e.snapshot().settings;
    settings.network.proxy_mode = downloader_core::network::ProxyMode::Direct;
    e.command(Command::Settings(settings)).unwrap();
    e
}

#[cfg(feature = "fault-injection")]
#[test]
#[ignore = "Invoked only by the process-recovery test"]
fn crash_worker() {
    let directory = std::path::PathBuf::from(std::env::var("DOWNLOADER_CRASH_DIRECTORY").unwrap());
    let e = isolated_engine(&directory);
    if std::env::var("DOWNLOADER_FAILPOINT").as_deref() == Ok("scanning_before") {
        let mut settings = e.snapshot().settings;
        settings.scanner = Some(Scanner {
            executable: std::env::current_exe().unwrap(),
            args: vec!["--exact".into(), "scanner_stub".into(), "--ignored".into()],
        });
        e.command(Command::Settings(settings)).unwrap();
    }
    e.start();
    e.add(AddJob {
        request_id: "crash".into(),
        url: std::env::var("DOWNLOADER_CRASH_URL").unwrap(),
        filename: Some("crash.bin".into()),
        directory: Some(directory),
        queue: None,
        checksum: Some(std::env::var("DOWNLOADER_CRASH_HASH").unwrap()),
        paused: false,
        context: RequestContext::default(),
        media: None,
        description: String::new(),
    })
    .unwrap();
    std::thread::sleep(Duration::from_secs(40));
    panic!("Failpoint was not reached");
}
#[cfg(feature = "fault-injection")]
#[test]
fn terminated_processes_recover_durable_output() {
    let server = Server::new();
    for point in [
        "partial_created",
        "checkpoint_before_commit",
        "checkpoint_after_commit",
        "verifying",
        "publication_before",
        "publication_after",
        "completion_before",
        "scanning_before",
        "copy_during",
        "copy_before_publish",
    ] {
        let dir = tempfile::tempdir().unwrap();
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", "crash_worker", "--ignored"])
            .env("DOWNLOADER_FAILPOINT", point)
            .env(
                "DOWNLOADER_FORCE_COPY",
                if point.starts_with("copy_") { "1" } else { "0" },
            )
            .env("DOWNLOADER_CRASH_DIRECTORY", dir.path())
            .env("DOWNLOADER_CRASH_URL", format!("{}/slow", server.url))
            .env("DOWNLOADER_CRASH_HASH", digest(&server.data))
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn().unwrap();
        let deadline = Instant::now();
        let status = loop {
            if let Some(status) = child.try_wait().unwrap() {
                break status;
            }
            if deadline.elapsed() > Duration::from_secs(45) {
                child.kill().unwrap();
                panic!("Crash worker timed out at {point}");
            }
            std::thread::sleep(Duration::from_millis(20));
        };
        assert!(!status.success(), "{point}");
        let e = isolated_engine(dir.path());
        let j = e.snapshot().jobs.into_iter().next().unwrap();
        e.start();
        if j.state != JobState::Complete {
            e.command(Command::Resume {
                id: j.id.clone(),
                restart: false,
            })
            .unwrap();
        }
        let done = wait(&e, &j.id, |j| {
            matches!(
                j.state,
                JobState::Complete | JobState::Failed | JobState::WaitingSource
            )
        });
        e.shutdown();
        assert_eq!(done.state, JobState::Complete, "{point}: {:?}", done.error);
        assert_eq!(
            digest(&std::fs::read(done.destination).unwrap()),
            digest(&server.data),
            "{point}"
        );
    }
}

#[cfg(feature = "fault-injection")]
#[test]
#[ignore = "Scanner fixture subprocess"]
fn scanner_stub() {}

#[test]
fn missing_actual_response_validator_requires_safe_restart() {
    let server = Server::new();
    let dir = tempfile::tempdir().unwrap();
    let e = isolated_engine(dir.path());
    e.start();
    let j = add(&e, &server, "/missingvalidator", dir.path(), None);
    let result = wait(&e, &j.id, |j| {
        matches!(
            j.state,
            JobState::WaitingSource | JobState::Failed | JobState::Complete
        )
    });
    e.shutdown();
    assert_eq!(result.state, JobState::WaitingSource, "{:?}", result.error);
    assert_eq!(
        result.failure.unwrap().code,
        downloader_core::failure::FailureCode::SourceChanged
    );
    assert!(!result.destination.exists());
}

#[test]
fn cross_origin_redirect_drops_cookie_and_authorization() {
    let source = TcpListener::bind("127.0.0.1:0").unwrap();
    let target = TcpListener::bind("127.0.0.1:0").unwrap();
    let target_url = format!("http://{}/file", target.local_addr().unwrap());
    let source_url = format!("http://{}/file", source.local_addr().unwrap());
    let read = |mut stream: TcpStream| {
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut request = vec![];
        let mut byte = [0u8];
        while !request.ends_with(b"\r\n\r\n") {
            stream.read_exact(&mut byte).unwrap();
            request.push(byte[0]);
        }
        (stream, String::from_utf8(request).unwrap())
    };
    let a = std::thread::spawn(move || {
        let (mut stream, _) = read(source.accept().unwrap().0);
        write!(stream,"HTTP/1.1 302 Found\r\nLocation: {target_url}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
    });
    let b = std::thread::spawn(move || {
        for _ in 0..2 {
            let (mut stream, request) = read(target.accept().unwrap().0);
            assert!(!request.to_lowercase().contains("cookie:"));
            assert!(!request.to_lowercase().contains("authorization:"));
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\n"
            )
            .unwrap();
            if request.starts_with("GET") {
                stream.write_all(b"safe").unwrap();
            }
        }
    });
    let mut context = RequestContext::default();
    context
        .headers
        .insert("Cookie".into(), "secret=fixture".into());
    context
        .headers
        .insert("Authorization".into(), "Bearer fixture".into());
    let mut settings = Settings::default();
    settings.network.proxy_mode = downloader_core::network::ProxyMode::Direct;
    assert_eq!(
        transfer::fetch_bytes(&source_url, &context, &settings, 16, None)
            .unwrap()
            .1,
        b"safe"
    );
    a.join().unwrap();
    b.join().unwrap();
}

#[cfg(feature = "fault-injection")]
#[test]
#[ignore = "Storage-failure fixture subprocess"]
fn storage_failure_worker() {
    let directory = std::path::PathBuf::from(std::env::var("DOWNLOADER_CRASH_DIRECTORY").unwrap());
    let server = Server {
        url: std::env::var("DOWNLOADER_CRASH_URL").unwrap(),
        stop: Arc::new(AtomicBool::new(false)),
        version: Arc::new(AtomicU8::new(1)),
        data: Arc::new(vec![]),
    };
    let e = isolated_engine(&directory);
    e.start();
    let j = add(&e, &server, "/file", &directory, None);
    let result = wait(&e, &j.id, |j| {
        matches!(j.state, JobState::Failed | JobState::Complete)
    });
    e.shutdown();
    assert_eq!(result.state, JobState::Failed);
    assert_eq!(
        result.failure.unwrap().code,
        downloader_core::failure::FailureCode::StorageFailure
    );
    assert!(!result.destination.exists());
    let durable: Job = e.store.lock().unwrap().get("job", &j.id).unwrap();
    assert_eq!(
        durable.bytes, 0,
        "Failed fsync must not advance durable bytes"
    );
}
#[cfg(feature = "fault-injection")]
#[test]
fn write_and_flush_failures_never_complete() {
    let server = Server::new();
    for operation in ["write", "sync"] {
        let directory = tempfile::tempdir().unwrap();
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", "storage_failure_worker", "--ignored"])
            .env("DOWNLOADER_IO_FAILURE", operation)
            .env("DOWNLOADER_CRASH_DIRECTORY", directory.path())
            .env("DOWNLOADER_CRASH_URL", &server.url);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn().unwrap();
        let deadline = Instant::now();
        loop {
            if let Some(status) = child.try_wait().unwrap() {
                assert!(status.success(), "{operation}");
                break;
            }
            if deadline.elapsed() > Duration::from_secs(30) {
                child.kill().unwrap();
                panic!("Storage fixture timed out");
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}
#[test]
fn output_directory_failure_is_actionable() {
    let server = Server::new();
    let directory = tempfile::tempdir().unwrap();
    let blocker = directory.path().join("not-a-directory");
    std::fs::write(&blocker, b"keep").unwrap();
    let e = isolated_engine(directory.path());
    e.start();
    let j = add(&e, &server, "/file", &blocker, None);
    let result = wait(&e, &j.id, |j| {
        matches!(j.state, JobState::Failed | JobState::Complete)
    });
    e.shutdown();
    assert_eq!(result.state, JobState::Failed);
    assert_eq!(
        result.failure.unwrap().code,
        downloader_core::failure::FailureCode::StorageFailure
    );
    assert_eq!(std::fs::read(blocker).unwrap(), b"keep");
}
