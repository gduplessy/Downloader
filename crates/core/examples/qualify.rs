//! Local-fixture qualification runner. No external websites or installed app configuration are modified.
use anyhow::{bail, Context, Result};
use downloader_core::{network::NetworkSettings, transfer, *};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};
#[derive(Deserialize)]
struct Case {
    name: String,
    url: String,
    directory: PathBuf,
    #[serde(default)]
    network: NetworkSettings,
    proxy: Option<String>,
    connections: Option<usize>,
    sha256: Option<String>,
    #[serde(default)]
    mode: String,
    username: Option<String>,
    password: Option<String>,
    pause_at: Option<u64>,
    speed_limit: Option<u64>,
    expected_failure: Option<String>,
}
// Read-only fixture credential injection; transport/job logic uses its ordinary keyring API.
struct RealmCredentials(String);
impl keyring::credential::CredentialBuilderApi for RealmCredentials {
    fn build(
        &self,
        target: Option<&str>,
        service: &str,
        user: &str,
    ) -> keyring::Result<Box<keyring::credential::Credential>> {
        use keyring::credential::CredentialApi;
        if target.is_some() || service != "Downloader" || user != "disposable-realm" {
            return Err(keyring::Error::NoEntry);
        }
        let credential = keyring::mock::MockCredential::default();
        credential.set_password(&self.0)?;
        Ok(Box::new(credential))
    }
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
    fn persistence(&self) -> keyring::credential::CredentialPersistence {
        keyring::credential::CredentialPersistence::ProcessOnly
    }
}
fn main() {
    if let Err(e) = run() {
        eprintln!("{e:#}");
        std::process::exit(1);
    }
}
fn run() -> Result<()> {
    let case: Case = serde_json::from_slice(&std::fs::read(
        std::env::args().nth(1).context("Case JSON path required")?,
    )?)?;
    std::fs::create_dir_all(&case.directory)?;
    let mut settings = Settings {
        directory: case.directory.clone(),
        network: case.network,
        proxy: case.proxy,
        connections: case.connections.unwrap_or(4),
        host_connections: 8,
        speed_limit: case.speed_limit.unwrap_or(0),
        ..Default::default()
    };
    let start = Instant::now();
    let cpu_start = cpu_memory().0;
    if case.mode == "zip" {
        let entries = archive::preview(&case.url, &RequestContext::default(), &settings)?;
        if !entries.as_array().is_some_and(|v| {
            v.len() == 1 && v[0]["name"] == "large-offset.txt" && v[0]["size"] == 5
        }) {
            bail!("ZIP64 fixture metadata differs");
        }
        println!(
            "{}",
            serde_json::json!({"name":case.name,"entries":entries,"capabilities":network::capabilities()})
        );
        return Ok(());
    }
    if case.mode == "auth_probe" {
        let mut easy = curl::easy::Easy::new();
        transfer::configure(&mut easy, &case.url, &RequestContext::default(), &settings)?;
        easy.username(case.username.as_deref().unwrap_or("fixture"))?;
        easy.password(case.password.as_deref().unwrap_or("fixture-password"))?;
        easy.http_auth(&network::authentication(&settings.network.authentication)?)?;
        let mut hash = Sha256::new();
        let mut bytes = 0u64;
        let performed = {
            let mut t = easy.transfer();
            t.write_function(|d| {
                hash.update(d);
                bytes += d.len() as u64;
                Ok(d.len())
            })?;
            t.perform()
        };
        let sha = format!("{:x}", hash.finalize());
        let status = easy.response_code()?;
        if case.expected_failure.as_deref() == Some("authentication_required") {
            if status != 401 || bytes > 65536 || case.directory.join("output.bin").exists() {
                bail!("Rejected authentication fixture was not refused safely: HTTP {status}, {bytes} response bytes");
            }
            println!(
                "{}",
                serde_json::json!({"name":case.name,"status":status,"bytes":0,"error_body_bytes":bytes,"expected_failure":"authentication_required","capabilities":network::capabilities()})
            );
            return Ok(());
        }
        performed?;
        if status != 200 || case.sha256.as_ref().is_some_and(|h| h != &sha) {
            bail!("Authentication fixture failed: HTTP {status}, {bytes} bytes, SHA-256 {sha}");
        }
        println!(
            "{}",
            serde_json::json!({"name":case.name,"status":status,"bytes":bytes,"sha256":sha,"seconds":start.elapsed().as_secs_f64(),"capabilities":network::capabilities()})
        );
        return Ok(());
    }
    let context = if case.mode == "auth_job" {
        // Only the fixture substitutes volatile credential storage; transport/job logic is real.
        keyring::set_default_credential_builder(Box::new(RealmCredentials(serde_json::to_string(
            &(
                case.username
                    .as_deref()
                    .context("Fixture username missing")?,
                case.password
                    .as_deref()
                    .context("Fixture password missing")?,
            ),
        )?)));
        RequestContext {
            credential_id: Some("disposable-realm".into()),
            private: true,
            ..Default::default()
        }
    } else {
        RequestContext::default()
    };
    let engine = Engine::open(&case.directory.join("state"))?;
    engine.command(Command::Settings(settings.clone()))?;
    engine.start();
    let job = engine.add(AddJob {
        request_id: format!("fixture-{}", case.name),
        url: case.url.clone(),
        filename: Some("output.bin".into()),
        directory: Some(case.directory.clone()),
        queue: None,
        checksum: case.sha256.clone(),
        paused: false,
        context,
        media: None,
        description: String::new(),
    })?;
    let mut engine = engine;
    let mut phases = std::collections::BTreeMap::new();
    let mut previous = JobState::Queued;
    let mut last = Instant::now();
    let mut resumed = false;
    loop {
        let j = engine.job(&job.id)?.lock().unwrap().clone();
        if j.state != previous {
            *phases.entry(format!("{previous:?}")).or_insert(0.0) += last.elapsed().as_secs_f64();
            previous = j.state.clone();
            last = Instant::now();
        }
        if !resumed
            && case.pause_at.is_some_and(|n| j.bytes >= n)
            && j.state == JobState::Downloading
        {
            engine.command(Command::Pause { id: j.id.clone() })?;
            while engine.job(&j.id)?.lock().unwrap().state != JobState::Paused {
                std::thread::sleep(Duration::from_millis(10));
            }
            engine.shutdown();
            drop(engine);
            engine = Engine::open(&case.directory.join("state"))?;
            settings.speed_limit = 0;
            engine.command(Command::Settings(settings.clone()))?;
            engine.start();
            engine.command(Command::Resume {
                id: j.id.clone(),
                restart: false,
            })?;
            resumed = true;
        }
        if j.state == JobState::Complete {
            if case.expected_failure.is_some() {
                bail!("Failure fixture incorrectly completed");
            }
            let (cpu, memory) = cpu_memory();
            println!(
                "{}",
                serde_json::json!({"name":case.name,"bytes":j.bytes,"sha256":j.verified_sha256,"seconds":start.elapsed().as_secs_f64(),"cpu_seconds":cpu-cpu_start,"peak_rss_bytes":memory,"phases_seconds":phases,"metrics":j.metrics,"segments":j.segments.len(),"resumed":resumed,"capabilities":network::capabilities(),"connections":pool::diagnostics()})
            );
            engine.shutdown();
            return Ok(());
        }
        if matches!(
            j.state,
            JobState::Failed | JobState::WaitingSource | JobState::WaitingAuthentication
        ) {
            engine.shutdown();
            if let Some(expected) = &case.expected_failure {
                let failure = j.failure.context("Missing structured failure")?;
                let actual = serde_json::to_value(&failure.code)?;
                if actual != *expected || j.destination.exists() {
                    bail!("Failure fixture did not fail safely: {actual}");
                }
                println!(
                    "{}",
                    serde_json::json!({"name":case.name,"expected_failure":actual,"recovery":failure.recovery,"destination_exists":false,"capabilities":network::capabilities()})
                );
                return Ok(());
            }
            bail!("{}: {:?}", case.name, j.error);
        }
        if start.elapsed() > Duration::from_secs(900) {
            engine.shutdown();
            bail!("Qualification timeout");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}
#[cfg(windows)]
fn cpu_memory() -> (f64, usize) {
    use std::ffi::c_void;
    #[repr(C)]
    struct Memory {
        cb: u32,
        faults: u32,
        peak: usize,
        working: usize,
        paged_peak: usize,
        paged: usize,
        nonpaged_peak: usize,
        nonpaged: usize,
        pagefile: usize,
        pagefile_peak: usize,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentProcess() -> *mut c_void;
        fn GetProcessTimes(
            p: *mut c_void,
            create: *mut u64,
            exit: *mut u64,
            kernel: *mut u64,
            user: *mut u64,
        ) -> i32;
    }
    #[link(name = "psapi")]
    extern "system" {
        fn GetProcessMemoryInfo(p: *mut c_void, m: *mut Memory, size: u32) -> i32;
    }
    unsafe {
        let p = GetCurrentProcess();
        let (mut c, mut e, mut k, mut u) = (0, 0, 0, 0);
        GetProcessTimes(p, &mut c, &mut e, &mut k, &mut u);
        let mut m: Memory = std::mem::zeroed();
        m.cb = std::mem::size_of::<Memory>() as u32;
        GetProcessMemoryInfo(p, &mut m, m.cb);
        ((k + u) as f64 / 10_000_000.0, m.peak)
    }
}
#[cfg(unix)]
fn cpu_memory() -> (f64, usize) {
    unsafe {
        let mut r: libc::rusage = std::mem::zeroed();
        libc::getrusage(libc::RUSAGE_SELF, &mut r);
        (
            (r.ru_utime.tv_sec + r.ru_stime.tv_sec) as f64
                + (r.ru_utime.tv_usec + r.ru_stime.tv_usec) as f64 / 1_000_000.0,
            r.ru_maxrss as usize * if cfg!(target_os = "macos") { 1 } else { 1024 },
        )
    }
}
