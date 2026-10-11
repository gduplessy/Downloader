//! Acceptance against a disposable, capacity-bounded filesystem provisioned by the harness.
use anyhow::{bail, Context, Result};
use downloader_core::{failure::FailureCode, finalize, network::ProxyMode, storage, transfer, *};
use serde::Deserialize;
use std::{
    fs::{File, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::{atomic::AtomicU8, Arc},
    time::{Duration, Instant},
};
#[derive(Deserialize)]
struct Case {
    directory: PathBuf,
    volume: PathBuf,
    url: String,
    sha256: String,
}
fn wait(engine: &Engine, id: &str) -> Result<Job> {
    let start = Instant::now();
    loop {
        let job = engine.job(id)?.lock().unwrap().clone();
        if matches!(
            job.state,
            JobState::Complete | JobState::Failed | JobState::WaitingSource
        ) {
            return Ok(job);
        }
        if start.elapsed() > Duration::from_secs(90) {
            bail!("Filesystem fixture timed out: {:?}", job.state);
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}
fn add(engine: &Engine, case: &Case, name: &str) -> Result<Job> {
    engine.add(AddJob {
        request_id: name.into(),
        url: case.url.clone(),
        filename: Some(format!("{name}.bin")),
        directory: Some(case.volume.clone()),
        queue: None,
        checksum: Some(case.sha256.clone()),
        paused: true,
        context: RequestContext::default(),
        media: None,
        description: String::new(),
    })
}
fn resume(engine: &Arc<Engine>, id: &str) -> Result<Job> {
    engine.command(Command::Resume {
        id: id.into(),
        restart: false,
    })?;
    wait(engine, id)
}
fn failed(job: &Job) -> Result<()> {
    if job.state != JobState::Failed
        || job
            .failure
            .as_ref()
            .is_none_or(|f| f.code != FailureCode::StorageFailure)
        || job.destination.exists()
    {
        bail!(
            "Storage failure incorrectly handled: {:?} {:?}",
            job.state,
            job.failure
        );
    }
    Ok(())
}
fn engine(case: &Case) -> Result<Arc<Engine>> {
    let engine = Engine::open(&case.directory.join("state"))?;
    let mut settings = engine.snapshot().settings;
    settings.directory = case.volume.clone();
    settings.connections = 1;
    settings.network.proxy_mode = ProxyMode::Direct;
    engine.command(Command::Settings(settings))?;
    engine.start();
    Ok(engine)
}
fn complete(job: &Job, expected: &str) -> Result<()> {
    if job.state != JobState::Complete
        || finalize::digest(&job.destination, &AtomicU8::new(0))? != expected
    {
        bail!("Recovered output did not complete with the expected hash");
    }
    Ok(())
}
fn run() -> Result<()> {
    let case: Case = serde_json::from_slice(&std::fs::read(
        std::env::args().nth(1).context("Case path required")?,
    )?)?;
    // Only the harness-created, differently mounted volume is eligible for filling.
    if std::fs::read_to_string(case.volume.join(".downloader-disposable-volume"))?
        != case.directory.to_string_lossy()
    {
        bail!("Disposable volume marker does not match");
    }
    let started = Instant::now();
    let control = AtomicU8::new(0);
    let source = case.directory.join("cross-volume.part");
    std::fs::write(&source, b"cross-volume publication fixture")?;
    OpenOptions::new().write(true).open(&source)?.sync_all()?;
    let target = case.volume.join("cross-volume.bin");
    let error = std::fs::hard_link(&source, &target)
        .err()
        .context("Fixture paths are not on separate filesystems")?;
    #[cfg(windows)]
    if error.raw_os_error() != Some(17) {
        bail!("Expected ERROR_NOT_SAME_DEVICE, got {error}");
    }
    #[cfg(unix)]
    if error.raw_os_error() != Some(libc::EXDEV) {
        bail!("Expected EXDEV, got {error}");
    }
    let hash = finalize::digest(&source, &control)?;
    finalize::publish(&source, &target, &hash, false, &control)?;
    if finalize::digest(&target, &control)? != hash || !source.exists() {
        bail!("Cross-volume publication corrupted input/output");
    }
    std::fs::write(&source, b"replacement must not overwrite")?;
    if finalize::publish(
        &source,
        &target,
        &finalize::digest(&source, &control)?,
        false,
        &control,
    )
    .is_ok()
        || finalize::digest(&target, &control)? != hash
    {
        bail!("Cross-volume publication overwrote a collision");
    }

    let e = engine(&case)?;
    let job = add(&e, &case, "permission")?;
    let part = transfer::part_path(&job);
    File::create(&part)?.sync_all()?;
    let mut persisted = job.clone();
    persisted.partial_created = true;
    e.store.lock().unwrap().put("job", &job.id, &persisted)?;
    *e.job(&job.id)?.lock().unwrap() = persisted;
    let original = std::fs::metadata(&part)?.permissions();
    let mut permissions = original.clone();
    permissions.set_readonly(true);
    std::fs::set_permissions(&part, permissions)?;
    if storage::open_partial(&part, false).is_ok() {
        std::fs::set_permissions(&part, original)?;
        bail!("Fixture user can override read-only permissions");
    }
    let result = resume(&e, &job.id);
    std::fs::set_permissions(&part, original)?;
    failed(&result?)?;
    complete(&resume(&e, &job.id)?, &case.sha256)?;

    let job = add(&e, &case, "disk-full")?;
    let filler_path = case.volume.join("bounded-volume-filler.bin");
    let mut filler = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&filler_path)?;
    let block = [0x51u8; 1024 * 1024];
    let mut written = 0u64;
    let disk_error = loop {
        if written >= 256 * 1024 * 1024 {
            bail!("Refusing to fill a filesystem larger than the bounded fixture");
        }
        if let Err(error) = filler.write_all(&block).and_then(|_| filler.sync_data()) {
            break error;
        }
        written += block.len() as u64;
    };
    if disk_error.kind() != std::io::ErrorKind::StorageFull {
        bail!("Expected real disk-full failure, got {disk_error}");
    }
    drop(filler);
    failed(&resume(&e, &job.id)?)?;
    e.shutdown();
    drop(e);
    std::fs::remove_file(&filler_path)?;
    let e = engine(&case)?;
    failed(&e.job(&job.id)?.lock().unwrap().clone())?;
    let recovered = resume(&e, &job.id)?;
    complete(&recovered, &case.sha256)?;
    e.shutdown();
    println!(
        "{}",
        serde_json::json!({"version":env!("CARGO_PKG_VERSION"),"platform":std::env::consts::OS,"cross_volume_verified":true,"collision_preserved":true,"permission_failure_and_recovery":true,"real_disk_full_and_restart_recovery":true,"filler_bytes_before_failure":written,"bytes":recovered.bytes,"sha256":recovered.verified_sha256,"seconds":started.elapsed().as_secs_f64()})
    );
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
}
