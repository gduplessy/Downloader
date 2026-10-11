//! Owner-fenced original browser-response storage. No network requests are issued here.
use crate::{navigation::*, security, storage, transfer, Engine, JobState};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Seek, SeekFrom, Write},
    sync::{atomic::AtomicU8, Arc},
};
#[derive(Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    pub identity: StreamIdentity,
    pub job_id: String,
    pub offset: u64,
    pub total: Option<u64>,
    pub terminal: bool,
}
fn decode(value: &str) -> Result<Vec<u8>> {
    if value.is_empty()
        || value.len() > STREAM_CHUNK_BYTES.div_ceil(3) * 4
        || !value.len().is_multiple_of(4)
    {
        bail!("Invalid browser stream chunk");
    }
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity(value.len() / 4 * 3);
    for (index, chunk) in value.as_bytes().chunks_exact(4).enumerate() {
        let mut n = 0u32;
        let mut padding = 0;
        for (i, b) in chunk.iter().enumerate() {
            let digit = if *b == b'=' {
                padding += 1;
                if i < 2 || index != value.len() / 4 - 1 {
                    bail!("Invalid base64 padding");
                }
                0
            } else {
                if padding > 0 {
                    bail!("Invalid base64 padding");
                }
                alphabet
                    .iter()
                    .position(|a| a == b)
                    .context("Invalid base64 byte")? as u32
            };
            n = (n << 6) | digit;
        }
        if padding > 2 || (padding == 1 && n & 0xff != 0) || (padding == 2 && n & 0xffff != 0) {
            bail!("Noncanonical base64 padding");
        }
        out.push((n >> 16) as u8);
        if padding < 2 {
            out.push((n >> 8) as u8);
        }
        if padding < 1 {
            out.push(n as u8);
        }
    }
    if out.len() > STREAM_CHUNK_BYTES {
        bail!("Browser stream chunk exceeds negotiated limit");
    }
    Ok(out)
}
fn ack(record: &Checkpoint) -> StreamAck {
    StreamAck {
        stream_id: record.identity.stream_id.clone(),
        accepted_offset: record.offset,
        claim_generation: record.identity.scope.claim_generation,
        source_generation: record.identity.source_generation,
        terminal: record.terminal,
    }
}
pub fn operation(engine: &Arc<Engine>, operation: StreamOperation) -> Result<StreamAck> {
    let identity = match &operation {
        StreamOperation::Begin { identity, .. }
        | StreamOperation::Chunk { identity, .. }
        | StreamOperation::End { identity, .. }
        | StreamOperation::Abort { identity, .. } => identity,
    };
    identity.scope.validate()?;
    uuid::Uuid::parse_str(&identity.stream_id)?;
    if identity.source_generation == 0 {
        bail!("Invalid source generation");
    }
    let serial = engine
        .browser_stream_locks
        .lock()
        .unwrap()
        .entry(identity.stream_id.clone())
        .or_insert_with(|| Arc::new(std::sync::Mutex::new(())))
        .clone();
    let _serial = serial.lock().unwrap();
    let previous: Option<Checkpoint> = engine
        .store
        .lock()
        .unwrap()
        .get("browser_stream", &identity.stream_id)
        .ok();
    let job_id = match &operation {
        StreamOperation::Begin {
            target: NavigationTarget::Job { id },
            ..
        } => id.clone(),
        StreamOperation::Begin { .. } => {
            bail!("Browser stream must target an owned navigation job")
        }
        _ => previous
            .as_ref()
            .context("Browser stream not begun")?
            .job_id
            .clone(),
    };
    let shared = engine
        .jobs
        .lock()
        .unwrap()
        .get(&job_id)
        .cloned()
        .context("Unknown stream job")?;
    // Keep this lock through durable write/checkpoint so a claim transfer cannot race a frame.
    let finalizer = if matches!(&operation, StreamOperation::End { .. }) {
        let mut controls = engine.controls.lock().unwrap();
        if controls.contains_key(&job_id) {
            bail!("Browser job already has an active finalizer");
        }
        let control = Arc::new(AtomicU8::new(0));
        controls.insert(job_id.clone(), control.clone());
        Some(control)
    } else {
        None
    };
    struct FinalizerGuard<'a> {
        engine: &'a Engine,
        id: &'a str,
        control: Option<Arc<AtomicU8>>,
    }
    impl Drop for FinalizerGuard<'_> {
        fn drop(&mut self) {
            if let Some(control) = &self.control {
                let mut controls = self.engine.controls.lock().unwrap();
                if controls
                    .get(self.id)
                    .is_some_and(|value| Arc::ptr_eq(value, control))
                {
                    controls.remove(self.id);
                }
            }
        }
    }
    let _finalizer_guard = FinalizerGuard {
        engine,
        id: &job_id,
        control: finalizer.clone(),
    };
    let mut job = shared.lock().unwrap();
    if finalizer
        .as_ref()
        .is_some_and(|control| control.load(std::sync::atomic::Ordering::Relaxed) != 0)
    {
        job.state = JobState::Cancelled;
        engine.store.lock().unwrap().put("job", &job.id, &*job)?;
        bail!("Browser stream finalization was cancelled");
    }
    if !job.browser_source
        || job.page_url.is_none()
        || job.navigation_scope.as_ref() != Some(&identity.scope)
        || job.source_generation != identity.source_generation
        || job.navigation_owner.as_ref() != Some(&identity.scope.profile)
    {
        bail!("Stale or foreign browser stream ownership");
    }
    // Publication and stream terminal checkpoint are separate durable operations.
    // If publication completed before a daemon crash, EOF replay acknowledges that exact
    // already-verified artifact instead of trying to publish it a second time.
    if let StreamOperation::End {
        total,
        expected_sha256,
        ..
    } = &operation
    {
        if job.state == JobState::Complete {
            if let Some(mut checkpoint) = previous.clone() {
                if checkpoint.offset == *total
                    && job.bytes == *total
                    && job.verified_sha256.is_some()
                    && expected_sha256.as_ref().is_none_or(|hash| {
                        job.verified_sha256
                            .as_ref()
                            .is_some_and(|verified| hash.eq_ignore_ascii_case(verified))
                    })
                    && std::fs::metadata(&job.destination).is_ok_and(|meta| meta.len() == *total)
                {
                    checkpoint.terminal = true;
                    engine
                        .store
                        .lock()
                        .unwrap()
                        .put_browser_checkpoint(&checkpoint, &job)?;
                    return Ok(ack(&checkpoint));
                }
            }
        }
    }
    if matches!(
        job.state,
        JobState::Cancelled | JobState::Complete | JobState::Paused
    ) {
        if job.state == JobState::Complete
            && previous.as_ref().is_some_and(|p| {
                p.terminal
                    && p.identity.scope == identity.scope
                    && p.identity.source_generation == identity.source_generation
            })
        {
            return Ok(ack(&previous.unwrap()));
        }
        bail!("Browser stream job is no longer writable");
    }
    if previous.as_ref().is_some_and(|p| {
        p.identity.scope != identity.scope
            || p.identity.source_generation != identity.source_generation
            || p.job_id != job_id
    }) {
        bail!("Browser stream identity cannot be reassigned");
    }
    let resumed = previous.is_some();
    let mut record = previous.unwrap_or(Checkpoint {
        identity: identity.clone(),
        job_id: job_id.clone(),
        offset: 0,
        total: None,
        terminal: false,
    });
    if record.terminal {
        bail!("Browser stream is terminal");
    }
    match operation {
        StreamOperation::Begin {
            filename, total, ..
        } => {
            if total == Some(0) {
                bail!("Empty browser response cannot complete a download");
            }
            if resumed {
                return Ok(ack(&record));
            }
            if engine
                .store
                .lock()
                .unwrap()
                .all::<Checkpoint>("browser_stream")?
                .iter()
                .any(|active| {
                    active.job_id == job.id
                        && !active.terminal
                        && active.identity.stream_id != record.identity.stream_id
                })
            {
                bail!("Browser job already has an owned response stream");
            }
            if job.partial_created
                && (job.bytes > 0
                    || std::fs::metadata(transfer::part_path(&job))
                        .map(|m| m.len() > 0)
                        .unwrap_or(false))
            {
                bail!("Partial browser stream requires its original stream ID");
            }
            let settings = engine.settings.lock().unwrap().clone();
            if settings.quota_bytes > 0
                && total.is_some_and(|t| {
                    engine
                        .store
                        .lock()
                        .unwrap()
                        .usage(settings.quota_minutes)
                        .unwrap_or(u64::MAX)
                        .saturating_add(t)
                        > settings.quota_bytes
                })
            {
                bail!("Browser stream exceeds transfer quota");
            }
            let name = security::safe_filename(&filename);
            let directory = job
                .destination
                .parent()
                .context("Missing browser stream destination")?
                .to_path_buf();
            std::fs::create_dir_all(&directory)?;
            let candidate = security::unique_destination(&directory, &name);
            job.filename = candidate.file_name().unwrap().to_string_lossy().into();
            job.destination = candidate;
            storage::open_partial(&transfer::part_path(&job), true)?.sync_all()?;
            job.partial_created = true;
            job.state = JobState::BrowserDownloading;
            job.resumable = false;
            job.total = total;
            record.total = total;
            job.error = None;
        }
        StreamOperation::Chunk {
            offset,
            data_base64,
            ..
        } => {
            let bytes = decode(&data_base64)?;
            let end = offset
                .checked_add(bytes.len() as u64)
                .context("Browser stream offset overflow")?;
            if record.total.is_some_and(|total| end > total) {
                bail!("Browser stream exceeds declared total");
            }
            let mut file = storage::open_partial(&transfer::part_path(&job), false)?;
            if file.metadata()?.len() < record.offset {
                bail!("Durable browser bytes are missing");
            }
            if offset < record.offset {
                if end > record.offset {
                    bail!("Overlapping browser stream retransmission");
                }
                file.seek(SeekFrom::Start(offset))?;
                let mut existing = vec![0; bytes.len()];
                file.read_exact(&mut existing)?;
                if existing != bytes {
                    bail!("Browser stream retransmission differs from durable bytes");
                }
                return Ok(ack(&record));
            }
            if offset != record.offset {
                bail!("Out-of-order browser stream chunk");
            }
            let settings = engine.settings.lock().unwrap().clone();
            let store = engine.store.lock().unwrap();
            if settings.quota_bytes > 0
                && store
                    .usage(settings.quota_minutes)?
                    .saturating_add(bytes.len() as u64)
                    > settings.quota_bytes
            {
                bail!("Browser stream exceeds transfer quota");
            }
            file.seek(SeekFrom::Start(offset))?;
            file.write_all(&bytes)
                .context("storage_error: Browser stream write failed")?;
            file.sync_all()
                .context("storage_error: Browser stream durable flush failed")?;
            record.offset = end;
            job.bytes = end;
            job.state = JobState::BrowserDownloading;
            store.put_browser_checkpoint(&record, &job)?;
            return Ok(ack(&record));
        }
        StreamOperation::End {
            total,
            expected_sha256,
            ..
        } => {
            if total == 0 || total != record.offset || record.total.is_some_and(|t| t != total) {
                bail!("Browser stream EOF does not match durable bytes");
            }
            if expected_sha256
                .as_ref()
                .is_some_and(|h| h.len() != 64 || !h.bytes().all(|b| b.is_ascii_hexdigit()))
            {
                bail!("Invalid stream checksum");
            }
            if std::fs::metadata(transfer::part_path(&job))?.len() != total {
                bail!("Browser stream has trailing unacknowledged bytes");
            }
            job.total = Some(total);
            job.checksum = expected_sha256;
            job.segments = vec![crate::Segment {
                start: 0,
                end: total - 1,
                downloaded: total,
            }];
            engine.store.lock().unwrap().put("job", &job.id, &*job)?;
            drop(job);
            let control = finalizer
                .clone()
                .context("Browser stream finalizer missing")?;
            let result = crate::finalize::finish(
                shared.clone(),
                engine.store.clone(),
                &engine.settings.lock().unwrap().clone(),
                &control,
            );
            engine.controls.lock().unwrap().remove(&record.job_id);
            if let Err(error) = result {
                let mut j = shared.lock().unwrap();
                j.state = match control.load(std::sync::atomic::Ordering::Relaxed) {
                    1 => JobState::Paused,
                    2 => JobState::Cancelled,
                    _ => JobState::Failed,
                };
                j.error = Some(security::redact(&error.to_string()));
                engine.store.lock().unwrap().put("job", &j.id, &*j)?;
                return Err(error);
            }
            record.terminal = shared.lock().unwrap().state == JobState::Complete;
            engine.store.lock().unwrap().put(
                "browser_stream",
                &record.identity.stream_id,
                &record,
            )?;
            return Ok(ack(&record));
        }
        StreamOperation::Abort { reason, .. } => {
            job.state = JobState::WaitingUser;
            // No source tokens or arbitrary page diagnostics are persisted.
            job.error = Some(
                if reason == "cancelled" {
                    "Browser stream cancelled; original source cannot be replayed"
                } else {
                    "Browser stream interrupted; request a fresh provider action"
                }
                .into(),
            );
            record.terminal = true;
        }
    }
    engine
        .store
        .lock()
        .unwrap()
        .put_browser_checkpoint(&record, &job)?;
    Ok(ack(&record))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strict_bounded_base64() {
        assert_eq!(decode("AQID/w==").unwrap(), [1, 2, 3, 255]);
        for value in ["", "AA=A", "AB==", "AAAA====", "$AAA"] {
            assert!(decode(value).is_err());
        }
        assert!(decode(&"A".repeat(STREAM_CHUNK_BYTES / 3 * 4 + 4)).is_err());
    }
}
