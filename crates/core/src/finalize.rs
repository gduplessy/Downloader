use crate::{model::*, security, store::Store, transfer};
use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::Path,
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

pub fn digest(path: &Path, control: &AtomicU8) -> Result<String> {
    let mut f =
        File::open(path).context("storage_error: Could not read output for verification")?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 128 * 1024];
    loop {
        if control.load(Ordering::Relaxed) != 0 {
            bail!("operation_cancelled");
        }
        let n = f
            .read(&mut buffer)
            .context("storage_error: Verification read failed")?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn sync_parent(path: &Path) -> Result<()> {
    #[cfg(unix)]
    File::open(path.parent().context("Destination has no parent")?)?.sync_all()?;
    #[cfg(windows)]
    {
        let _ = path;
    }
    Ok(())
}
fn rename_no_replace(from: &Path, to: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        extern "system" {
            fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32;
        }
        let a: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
        let b: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe { MoveFileExW(a.as_ptr(), b.as_ptr(), 8) } == 0 {
            return Err(std::io::Error::last_os_error())
                .context("storage_error: No-overwrite publication failed");
        }
    }
    #[cfg(unix)]
    {
        std::fs::hard_link(from, to)
            .context("storage_error: Filesystem cannot publish without overwrite")?;
        std::fs::remove_file(from)?;
    }
    sync_parent(to)
}
pub fn publish(
    part: &Path,
    destination: &Path,
    expected: &str,
    force_copy: bool,
    control: &AtomicU8,
) -> Result<()> {
    if !force_copy && !crate::fault::force_copy() {
        match std::fs::hard_link(part, destination) {
            Ok(()) => {
                sync_parent(destination)?;
                return Ok(());
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err(e)
                    .context("storage_error: Destination already exists; it was not overwritten")
            }
            Err(_) => {}
        }
    }
    // Copy into a hidden staging file on the destination filesystem, then publish.
    let stage = destination.with_file_name(format!(
        "{}.publish",
        part.file_name()
            .context("Missing partial filename")?
            .to_string_lossy()
    ));
    // A stable job-scoped staging path makes interrupted cross-volume copies recoverable.
    if stage.exists() {
        let file = crate::storage::open_partial(&stage, false)?;
        if file.metadata()?.len() == std::fs::metadata(part)?.len()
            && digest(&stage, control)? == expected
        {
            drop(file);
            return rename_no_replace(&stage, destination);
        }
        drop(file);
        std::fs::remove_file(&stage)?;
    }
    let result = (|| -> Result<()> {
        let mut input = File::open(part)?;
        let mut output = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&stage)?;
        let mut buffer = [0u8; 128 * 1024];
        loop {
            if control.load(Ordering::Relaxed) != 0 {
                bail!("operation_cancelled");
            }
            let n = input.read(&mut buffer)?;
            if n == 0 {
                break;
            }
            output.write_all(&buffer[..n])?;
            crate::fault::point("copy_during");
        }
        output.sync_all()?;
        drop(output);
        if digest(&stage, control)? != expected {
            bail!("checksum_mismatch: Publication copy differs from verified output");
        }
        crate::fault::point("copy_before_publish");
        rename_no_replace(&stage, destination)
    })();
    if stage.exists() {
        let _ = std::fs::remove_file(&stage);
    }
    result.context("storage_error: Recoverable publication failed")
}
fn scan(job: &Job, settings: &Settings, control: &AtomicU8) -> Result<()> {
    let Some(scanner) = &settings.scanner else {
        return Ok(());
    };
    let mut command = std::process::Command::new(&scanner.executable);
    command
        .args(
            scanner
                .args
                .iter()
                .map(|a| a.replace("{file}", &job.destination.to_string_lossy())),
        )
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let (mut child, tree) = crate::process::spawn(&mut command)
        .context("scan_failed: Could not start configured scanner")?;
    let start = Instant::now();
    loop {
        if control.load(Ordering::Relaxed) != 0 || start.elapsed() > Duration::from_secs(300) {
            tree.terminate();
            let _ = child.kill();
            let _ = child.wait();
            bail!("scan_failed: Scanner cancelled or exceeded five-minute timeout");
        }
        if let Some(status) = child.try_wait()? {
            if !status.success() {
                bail!("scan_failed: Scanner reported an error or threat");
            }
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    if digest(&job.destination, control)?
        != job
            .verified_sha256
            .as_deref()
            .context("scan_failed: Verification record is missing")?
    {
        bail!("scan_failed: Output changed or was removed during scanning");
    }
    Ok(())
}
fn verified(job: &mut Job, control: &AtomicU8) -> Result<()> {
    let part = transfer::part_path(job);
    if job.total != Some(job.bytes)
        || std::fs::metadata(&part)
            .context("storage_error: Recovery input is missing")?
            .len()
            != job.bytes
    {
        bail!("storage_error: Finalization checkpoint is incomplete");
    }
    let hash = digest(&part, control)?;
    if job
        .checksum
        .as_ref()
        .is_some_and(|h| !hash.eq_ignore_ascii_case(h))
        || job.verified_sha256.as_ref().is_some_and(|h| h != &hash)
    {
        bail!("checksum_mismatch: Output differs from its expected or durable verified hash");
    }
    job.verified_sha256 = Some(hash);
    Ok(())
}
pub fn finish(
    job: transfer::SharedJob,
    store: Arc<Mutex<Store>>,
    settings: &Settings,
    control: &AtomicU8,
) -> Result<()> {
    let mut j = job.lock().unwrap().clone();
    let recovering = j.verified_sha256.is_some();
    j.state = JobState::Verifying;
    let persist = |j: &Job| -> Result<()> {
        store.lock().unwrap().put("job", &j.id, j)?;
        *job.lock().unwrap() = j.clone();
        Ok(())
    };
    persist(&j)?;
    crate::fault::point("verifying");
    let started = Instant::now();
    verified(&mut j, control)?;
    j.metrics.verification_seconds += started.elapsed().as_secs_f64();
    if control.load(Ordering::Relaxed) != 0 {
        return Ok(());
    }
    j.state = JobState::Assembling;
    persist(&j)?;
    let part = transfer::part_path(&j);
    let started = Instant::now();
    crate::fault::point("publication_before");
    if j.destination.exists() {
        if !recovering || digest(&j.destination, control)? != j.verified_sha256.as_deref().unwrap()
        {
            bail!("storage_error: Destination collision; original file preserved");
        }
    } else {
        publish(
            &part,
            &j.destination,
            j.verified_sha256.as_deref().unwrap(),
            false,
            control,
        )?;
    }
    j.metrics.publication_seconds += started.elapsed().as_secs_f64();
    crate::fault::point("publication_after");
    security::mark_download(&j.destination, &security::redact(&j.url))?;
    if settings.scanner.is_some() {
        j.state = JobState::Scanning;
        persist(&j)?;
        crate::fault::point("scanning_before");
        let started = Instant::now();
        scan(&j, settings, control)?;
        j.metrics.scan_seconds += started.elapsed().as_secs_f64();
    }
    if control.load(Ordering::Relaxed) != 0 {
        return Ok(());
    }
    crate::fault::point("completion_before");
    j.state = JobState::Complete;
    j.error = None;
    j.failure = None;
    j.speed = 0;
    persist(&j)?;
    let _ = std::fs::remove_file(part);
    Ok(())
}
pub fn recover(job: &mut Job, settings: &Settings) -> Result<()> {
    let part = transfer::part_path(job);
    let control = AtomicU8::new(0);
    if job.state == JobState::Complete {
        if part.is_file()
            && job.destination.is_file()
            && digest(&part, &control)? != digest(&job.destination, &control)?
        {
            bail!("storage_error: Finalized destination differs from recoverable output");
        }
        return Ok(());
    }
    if !matches!(
        job.state,
        JobState::Verifying | JobState::Assembling | JobState::Scanning
    ) {
        return Ok(());
    }
    verified(job, &control)?;
    if job.destination.exists() {
        if digest(&job.destination, &control)? != job.verified_sha256.as_deref().unwrap() {
            bail!("storage_error: Destination collision during recovery");
        }
    } else {
        publish(
            &part,
            &job.destination,
            job.verified_sha256.as_deref().unwrap(),
            false,
            &control,
        )?;
    }
    security::mark_download(&job.destination, &security::redact(&job.url))?;
    scan(job, settings, &control)?;
    job.state = JobState::Complete;
    job.error = None;
    job.failure = None;
    job.speed = 0;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn copy_publication_is_verified_and_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let part = dir.path().join("part");
        let dest = dir.path().join("out");
        let c = AtomicU8::new(0);
        std::fs::write(&part, b"verified").unwrap();
        let h = digest(&part, &c).unwrap();
        publish(&part, &dest, &h, true, &c).unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"verified");
        std::fs::write(&part, b"different").unwrap();
        assert!(publish(&part, &dest, &digest(&part, &c).unwrap(), true, &c).is_err());
        assert_eq!(std::fs::read(&dest).unwrap(), b"verified");
    }
    #[test]
    fn cancelled_verification_keeps_recoverable_input() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("part");
        std::fs::write(&p, b"input").unwrap();
        assert!(digest(&p, &AtomicU8::new(1)).is_err());
        assert!(p.exists());
    }
}
