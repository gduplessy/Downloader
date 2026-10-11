use downloader_core::{solver::SolverSettings, AddJob, Command, Engine, JobState, RequestContext};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::{Shutdown, TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

struct Fixture {
    url: String,
    stop: Arc<AtomicBool>,
    sessions: Arc<Mutex<Vec<String>>>,
    requests: Arc<AtomicUsize>,
    file_requests: Arc<AtomicUsize>,
    cleanup_fail: Arc<AtomicBool>,
}
const DATA: &[u8] = b"solver transfer fixture, hashed and never HTML";
impl Fixture {
    fn new(html: &'static str, delay: bool) -> Self {
        Self::with_body(html, delay, DATA)
    }
    fn with_body(html: &'static str, delay: bool, data: &'static [u8]) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let stop = Arc::new(AtomicBool::new(false));
        let sessions = Arc::new(Mutex::new(Vec::new()));
        let requests = Arc::new(AtomicUsize::new(0));
        let file_requests = Arc::new(AtomicUsize::new(0));
        let cleanup_fail = Arc::new(AtomicBool::new(false));
        let cleanup_flag = cleanup_fail.clone();
        let (base, stopped, ss, rs, fs) = (
            url.clone(),
            stop.clone(),
            sessions.clone(),
            requests.clone(),
            file_requests.clone(),
        );
        std::thread::spawn(move || {
            while !stopped.load(Ordering::Relaxed) {
                if let Ok((stream, _)) = listener.accept() {
                    let (base, ss, rs, fs, fail) = (
                        base.clone(),
                        ss.clone(),
                        rs.clone(),
                        fs.clone(),
                        cleanup_flag.clone(),
                    );
                    std::thread::spawn(move || {
                        let _ = respond(stream, &base, html, delay, data, &ss, (&rs, &fs, &fail));
                    });
                } else {
                    std::thread::sleep(Duration::from_millis(5));
                }
            }
        });
        Self {
            url,
            stop,
            sessions,
            requests,
            file_requests,
            cleanup_fail,
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}
fn respond(
    mut stream: TcpStream,
    base: &str,
    html: &str,
    delay: bool,
    data: &[u8],
    sessions: &Mutex<Vec<String>>,
    counters: (&AtomicUsize, &AtomicUsize, &AtomicBool),
) -> std::io::Result<()> {
    let (requests, files, cleanup_fail) = counters;
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    let mut bytes = Vec::new();
    let mut byte = [0];
    while !bytes.ends_with(b"\r\n\r\n") {
        stream.read_exact(&mut byte)?;
        bytes.push(byte[0]);
    }
    let headers = String::from_utf8_lossy(&bytes);
    let size = headers
        .lines()
        .find_map(|line| {
            let (key, value) = line.split_once(':')?;
            key.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })
        .unwrap_or(0);
    let mut body = vec![0; size];
    stream.read_exact(&mut body)?;
    if headers.starts_with("POST /v1 ") {
        let payload: Value = serde_json::from_slice(&body).unwrap();
        let response = match payload["cmd"].as_str().unwrap_or("") {
            "sessions.create" => {
                sessions
                    .lock()
                    .unwrap()
                    .push(payload["session"].as_str().unwrap().into());
                json!({"status":"ok","session":payload["session"]})
            }
            "sessions.destroy" => {
                if cleanup_fail.load(Ordering::Relaxed) {
                    json!({"status":"error","message":"not published"})
                } else {
                    sessions
                        .lock()
                        .unwrap()
                        .retain(|s| Some(s.as_str()) != payload["session"].as_str());
                    json!({"status":"ok"})
                }
            }
            "request.get" => {
                requests.fetch_add(1, Ordering::Relaxed);
                if delay {
                    std::thread::sleep(Duration::from_secs(2));
                }
                json!({"status":"ok","solution":{"status":200,"url":format!("{base}/page"),"response":html,"userAgent":"FixtureBrowser/1.0","cookies":[{"name":"clearance","value":"secret","domain":"127.0.0.1","path":"/","secure":false}]}})
            }
            _ => json!({"status":"error"}),
        };
        let body = serde_json::to_vec(&response).unwrap();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )?;
        stream.write_all(&body)?;
    } else if headers.contains(" /file.bin ") {
        if !headers
            .to_ascii_lowercase()
            .contains("cookie: clearance=secret")
            || !headers.contains("FixtureBrowser/1.0")
        {
            write!(
                stream,
                "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            )?;
            return Ok(());
        }
        files.fetch_add(1, Ordering::Relaxed);
        let range = headers.lines().find_map(|line| {
            let (key, value) = line.split_once(':')?;
            if !key.eq_ignore_ascii_case("range") {
                return None;
            }
            let (a, b) = value.trim().strip_prefix("bytes=")?.split_once('-')?;
            Some((a.parse::<usize>().ok()?, b.parse::<usize>().ok()?))
        });
        let (status, body) = if let Some((a, b)) = range {
            ("206 Partial Content", &data[a..=b])
        } else {
            ("200 OK", data)
        };
        write!(stream,"HTTP/1.1 {status}\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=fixture.bin\r\nETag: \"fixture\"\r\nAccept-Ranges: bytes\r\nContent-Length: {}\r\nConnection: close\r\n",body.len())?;
        if let Some((a, b)) = range {
            write!(stream, "Content-Range: bytes {a}-{b}/{}\r\n", data.len())?;
        }
        stream.write_all(b"\r\n")?;
        if !headers.starts_with("HEAD ") {
            stream.write_all(body)?;
        }
    } else {
        write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 4\r\nConnection: close\r\n\r\npage")?;
    }
    // Finish the HTTP response gracefully. Closing a socket immediately after
    // writing can reset an in-flight loopback receive on Windows.
    stream.flush()?;
    stream.shutdown(Shutdown::Write)?;
    stream.set_read_timeout(Some(Duration::from_millis(200)))?;
    let _ = stream.read(&mut [0; 1024]);
    Ok(())
}
fn engine(dir: &std::path::Path, fixture: &Fixture) -> Arc<Engine> {
    let e = Engine::open(dir).unwrap();
    let mut settings = e.settings.lock().unwrap().clone();
    settings.directory = dir.into();
    settings.categories.clear();
    settings.network.proxy_mode = downloader_core::network::ProxyMode::Direct;
    settings.solver = SolverSettings {
        enabled: true,
        endpoint: format!("{}/", fixture.url),
        timeout_seconds: 5,
    };
    e.command(Command::Settings(settings)).unwrap();
    e
}
fn navigate(e: &Arc<Engine>, fixture: &Fixture, dir: &std::path::Path, owner: &str) -> String {
    let v = e
        .command(Command::Navigate(AddJob {
            request_id: uuid::Uuid::new_v4().to_string(),
            url: format!("{}/page", fixture.url),
            filename: Some("output.bin".into()),
            directory: Some(dir.into()),
            queue: None,
            checksum: Some(format!("{:x}", Sha256::digest(DATA))),
            paused: true,
            context: RequestContext {
                profile: Some(owner.into()),
                ..Default::default()
            },
            media: None,
            description: String::new(),
        }))
        .unwrap();
    v["id"].as_str().unwrap().into()
}
fn solve(id: &str, owner: &str, automatic: bool) -> Command {
    Command::SolveChallenge {
        id: id.into(),
        owner: Some(owner.into()),
        url: None,
        automatic,
    }
}
fn wait(e: &Engine, id: &str, state: JobState) {
    let start = Instant::now();
    while e.job(id).unwrap().lock().unwrap().state != state {
        assert!(
            start.elapsed() < Duration::from_secs(15),
            "waiting for {state:?}: {:?}",
            e.job(id).unwrap().lock().unwrap().state
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}
#[test]
fn solver_context_reaches_verified_transfer_without_persisting_secrets() {
    let fixture = Fixture::new("<a href='/file.bin'>Free Download</a>", false);
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path(), &fixture);
    let owner = uuid::Uuid::new_v4().to_string();
    let id = navigate(&e, &fixture, dir.path(), &owner);
    assert!(e
        .command(solve(&id, &uuid::Uuid::new_v4().to_string(), true))
        .is_err());
    assert_eq!(
        e.command(solve(&id, &owner, true)).unwrap()["accepted"],
        true
    );
    wait(&e, &id, JobState::Queued);
    assert!(fixture.sessions.lock().unwrap().is_empty());
    e.start();
    wait(&e, &id, JobState::Complete);
    let job = e.job(&id).unwrap().lock().unwrap().clone();
    assert_eq!(std::fs::read(&job.destination).unwrap(), DATA);
    assert!(job.resumable);
    assert_eq!(
        job.verified_sha256,
        Some(format!("{:x}", Sha256::digest(DATA)))
    );
    assert!(fixture.file_requests.load(Ordering::Relaxed) > 0);
    let records = serde_json::to_string(&e.snapshot()).unwrap();
    assert!(!records.contains("secret") && !records.contains("FixtureBrowser"));
    e.shutdown();
}
#[test]
fn html_disguised_as_binary_cannot_be_published_even_without_a_checksum() {
    let fixture = Fixture::with_body(
        "<a href='/file.bin'>Download</a>",
        false,
        b"<!doctype html><html>Link expired. Please solve captcha.</html>",
    );
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path(), &fixture);
    let owner = uuid::Uuid::new_v4().to_string();
    let id = navigate(&e, &fixture, dir.path(), &owner);
    e.job(&id).unwrap().lock().unwrap().checksum = None;
    e.command(solve(&id, &owner, false)).unwrap();
    wait(&e, &id, JobState::Queued);
    e.start();
    wait(&e, &id, JobState::WaitingSource);
    assert!(!e.job(&id).unwrap().lock().unwrap().destination.exists());
    e.shutdown();
}
#[test]
fn unresolved_captcha_and_expired_source_do_not_start_downloads() {
    for (html, reason) in [
        (
            "<img id=captchaImage><a href='/file.bin'>Download</a>",
            "solver_captcha",
        ),
        ("Link expired. Please solve the captcha.", "solver_expired"),
    ] {
        let fixture = Fixture::new(html, false);
        let dir = tempfile::tempdir().unwrap();
        let e = engine(dir.path(), &fixture);
        let config = e.settings.lock().unwrap().clone();
        let direct_error = downloader_core::solver::resolve(
            &format!("{}/page", fixture.url),
            None,
            &config,
            &std::sync::atomic::AtomicU8::new(0),
            &format!("downloader-{}", uuid::Uuid::new_v4()),
        )
        .err()
        .expect("Unsupported challenge must fail");
        assert_eq!(direct_error.to_string(), reason);
        let owner = uuid::Uuid::new_v4().to_string();
        let id = navigate(&e, &fixture, dir.path(), &owner);
        e.command(solve(&id, &owner, true)).unwrap();
        wait(&e, &id, JobState::WaitingUser);
        assert_eq!(
            e.job(&id)
                .unwrap()
                .lock()
                .unwrap()
                .solver_outcome
                .as_deref(),
            Some(reason)
        );
        assert_eq!(fixture.file_requests.load(Ordering::Relaxed), 0);
        assert!(fixture.sessions.lock().unwrap().is_empty());
        assert!(e.command(solve(&id, &owner, true)).is_err());
    }
}
#[test]
fn cancellation_serialization_and_changed_pages_discard_results() {
    for changed in [false, true] {
        let fixture = Fixture::new("<a href='/file.bin'>Download</a>", true);
        let dir = tempfile::tempdir().unwrap();
        let e = engine(dir.path(), &fixture);
        let owner = uuid::Uuid::new_v4().to_string();
        let id = navigate(&e, &fixture, dir.path(), &owner);
        e.command(solve(&id, &owner, true)).unwrap();
        let other = navigate(&e, &fixture, dir.path(), &owner);
        assert!(e
            .command(solve(&other, &owner, true))
            .unwrap_err()
            .to_string()
            .contains("solver_busy"));
        let start = Instant::now();
        while fixture.requests.load(Ordering::Relaxed) == 0 {
            assert!(start.elapsed() < Duration::from_secs(5));
            std::thread::sleep(Duration::from_millis(10));
        }
        if changed {
            e.command(Command::BrowserStatus {
                id: id.clone(),
                owner: owner.clone(),
                url: Some(format!("{}/changed", fixture.url)),
                state: JobState::WaitingUser,
                message: None,
                bytes: 0,
                total: None,
                scope: None,
                source_generation: None,
            })
            .unwrap();
        } else {
            e.command(Command::Cancel { id: id.clone() }).unwrap();
        }
        e.shutdown();
        wait(
            &e,
            &id,
            if changed {
                JobState::WaitingUser
            } else {
                JobState::Cancelled
            },
        );
        assert!(fixture.sessions.lock().unwrap().is_empty());
        assert_ne!(
            e.job(&id).unwrap().lock().unwrap().url,
            format!("{}/file.bin", fixture.url)
        );
    }
}
#[test]
fn interrupted_solver_recovers_to_manual_and_cleans_its_owned_session() {
    let fixture = Fixture::new("", false);
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path(), &fixture);
    let owner = uuid::Uuid::new_v4().to_string();
    let id = navigate(&e, &fixture, dir.path(), &owner);
    let session = format!("downloader-{}", uuid::Uuid::new_v4());
    fixture.sessions.lock().unwrap().push(session.clone());
    let mut job = e.job(&id).unwrap().lock().unwrap().clone();
    job.state = JobState::SolvingChallenge;
    job.solver_session = Some(session);
    e.store.lock().unwrap().put("job", &id, &job).unwrap();
    drop(e);
    let e = Engine::open(dir.path()).unwrap();
    assert_eq!(
        e.job(&id).unwrap().lock().unwrap().state,
        JobState::WaitingUser
    );
    let start = Instant::now();
    while !fixture.sessions.lock().unwrap().is_empty() {
        assert!(start.elapsed() < Duration::from_secs(5));
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn cleanup_failure_retains_owned_session_for_restart_recovery() {
    let fixture = Fixture::new("<a href='/file.bin'>Download</a>", false);
    fixture.cleanup_fail.store(true, Ordering::Relaxed);
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path(), &fixture);
    let owner = uuid::Uuid::new_v4().to_string();
    let id = navigate(&e, &fixture, dir.path(), &owner);
    e.command(solve(&id, &owner, false)).unwrap();
    wait(&e, &id, JobState::WaitingUser);
    assert_eq!(
        e.job(&id)
            .unwrap()
            .lock()
            .unwrap()
            .solver_outcome
            .as_deref(),
        Some("solver_cleanup")
    );
    e.shutdown();
    assert!(e.job(&id).unwrap().lock().unwrap().solver_session.is_some());
    assert!(e.command(solve(&id, &owner, false)).is_err());
    drop(e);
    fixture.cleanup_fail.store(false, Ordering::Relaxed);
    let e = Engine::open(dir.path()).unwrap();
    let start = Instant::now();
    while e.job(&id).unwrap().lock().unwrap().solver_session.is_some() {
        assert!(start.elapsed() < Duration::from_secs(5));
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(fixture.sessions.lock().unwrap().is_empty());
}

#[test]
fn disabling_solver_during_a_request_returns_to_manual_navigation() {
    let fixture = Fixture::new("<a href='/file.bin'>Download</a>", true);
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path(), &fixture);
    let owner = uuid::Uuid::new_v4().to_string();
    let id = navigate(&e, &fixture, dir.path(), &owner);
    e.command(solve(&id, &owner, false)).unwrap();
    let start = Instant::now();
    while fixture.requests.load(Ordering::Relaxed) == 0 {
        assert!(start.elapsed() < Duration::from_secs(5));
        std::thread::sleep(Duration::from_millis(10));
    }
    let mut settings = e.settings.lock().unwrap().clone();
    settings.solver.enabled = false;
    e.command(Command::Settings(settings)).unwrap();
    e.shutdown();
    wait(&e, &id, JobState::WaitingUser);
    assert!(fixture.sessions.lock().unwrap().is_empty());
    assert_eq!(
        e.job(&id)
            .unwrap()
            .lock()
            .unwrap()
            .solver_outcome
            .as_deref(),
        Some("solver_interrupted")
    );
}
