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
    let e = Engine::open(dir.path()).unwrap();
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
    let e = Engine::open(dir.path()).unwrap();
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
    let unknown = path == "/unknown";
    let range = request
        .lines()
        .find_map(|l| {
            l.strip_prefix("Range: bytes=")
                .or_else(|| l.strip_prefix("range: bytes="))
        })
        .and_then(|r| r.trim().split_once('-'))
        .and_then(|(a, b)| a.parse::<usize>().ok().zip(b.parse::<usize>().ok()));
    let range = if path == "/ignored" || unknown {
        None
    } else {
        range
    };
    let (a, b) = range.unwrap_or((0, data.len() - 1));
    let b = b.min(data.len() - 1);
    let length = b - a + 1;
    let status = if range.is_some() { 206 } else { 200 };
    write!(stream,"HTTP/1.1 {status} OK\r\nConnection: close\r\nContent-Type: application/octet-stream\r\nETag: \"v{version}\"\r\n")?;
    if !unknown {
        write!(
            stream,
            "Content-Length: {length}\r\nAccept-Ranges: bytes\r\n"
        )?;
    }
    if range.is_some() {
        write!(stream, "Content-Range: bytes {a}-{b}/{}\r\n", data.len())?;
    }
    write!(stream, "\r\n")?;
    if head {
        return Ok(());
    }
    let end = if path == "/truncated" {
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
    let e = Engine::open(dir.path()).unwrap();
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
    for path in ["/ignored", "/unknown", "/redirect"] {
        let dir = tempfile::tempdir().unwrap();
        let e = Engine::open(dir.path()).unwrap();
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
    let e = Engine::open(dir.path()).unwrap();
    e.start();
    let j = add(&e, &server, "/slow", dir.path(), Some(digest(&server.data)));
    wait(&e, &j.id, |j| j.bytes > 256 * 1024);
    e.command(Command::Pause { id: j.id.clone() }).unwrap();
    let paused = wait(&e, &j.id, |j| j.state == JobState::Paused);
    assert!(paused.bytes > 0 && paused.bytes < server.data.len() as u64);
    e.shutdown();
    drop(e);
    let e = Engine::open(dir.path()).unwrap();
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
    let e = Engine::open(dir.path()).unwrap();
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
    let e = Engine::open(dir.path()).unwrap();
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
    let recovered = Engine::open(dir.path()).unwrap();
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
    let e = Engine::open(dir.path()).unwrap();
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
