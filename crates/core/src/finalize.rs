use crate::{model::*, security, transfer};
use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};
use std::{fs::File, io::Read, path::Path};
fn digest(path: &Path) -> Result<String> {
    let mut f = File::open(path)?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 128 * 1024];
    loop {
        let n = f.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
pub fn recover(job: &mut Job, settings: &Settings) -> Result<()> {
    let part = transfer::part_path(job);
    if job.state == JobState::Complete {
        if part.is_file() && job.destination.is_file() {
            std::fs::remove_file(part)?;
        }
        return Ok(());
    }
    if !matches!(job.state, JobState::Assembling | JobState::Scanning) {
        return Ok(());
    }
    if job.total != Some(job.bytes)
        || !part.is_file()
        || std::fs::metadata(&part)?.len() != job.bytes
    {
        bail!("Finalization checkpoint is incomplete");
    }
    let hash = digest(&part)?;
    if job
        .checksum
        .as_ref()
        .is_some_and(|expected| !hash.eq_ignore_ascii_case(expected))
    {
        bail!("checksum_mismatch during finalization recovery");
    }
    if job.destination.exists() {
        if digest(&job.destination)? != hash {
            bail!("Destination collision during finalization recovery");
        }
    } else {
        std::fs::hard_link(&part, &job.destination)
            .context("Could not finalize recovered output")?;
    }
    security::mark_download(&job.destination, &job.url)?;
    if let Some(scanner) = &settings.scanner {
        let mut command = std::process::Command::new(&scanner.executable);
        command.args(
            scanner
                .args
                .iter()
                .map(|a| a.replace("{file}", &job.destination.to_string_lossy())),
        );
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        if !command.status()?.success() {
            bail!("scan_failed during recovery");
        }
    }
    // Engine::open persists completion before removing the recoverable partial file.
    job.state = JobState::Complete;
    job.error = None;
    job.speed = 0;
    Ok(())
}
