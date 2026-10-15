//! Owner-fenced original browser-response storage. No network requests are issued here.
mod lease;
use crate::{navigation::*, security, storage, transfer, Engine, JobState};
use anyhow::{bail, Context, Result};
pub(crate) use lease::ReaderLeases;
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
    let identity = identity.clone();
    let ack = operation_locked(engine, operation)?;
    let mut leases = engine.browser_reader_leases.lock().unwrap();
    if ack.terminal {
        leases.remove(&identity.stream_id);
    } else {
        leases.observe(&identity, std::time::Instant::now());
    }
    Ok(ack)
}
fn checkpoint(engine: &Arc<Engine>, id: &str) -> Result<Option<Checkpoint>> {
    match engine.store.lock().unwrap().get("browser_stream", id) {
        Ok(record) => Ok(Some(record)),
        Err(error)
            if matches!(
                error.downcast_ref::<rusqlite::Error>(),
                Some(rusqlite::Error::QueryReturnedNoRows)
            ) =>
        {
            Ok(None)
        }
        Err(error) => Err(error),
    }
}
fn operation_locked(engine: &Arc<Engine>, operation: StreamOperation) -> Result<StreamAck> {
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
    let previous = checkpoint(engine, &identity.stream_id)?;
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
        || job.navigation_transfer_pending
        || job.navigation_transfer_recovery
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
                if reason == "reader_lost" {
                    "browser_reader_lost: original browser reader disappeared; request a fresh provider action"
                } else if reason == "cancelled" {
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
/// A lost original reader requires a fresh provider action, never a source replay.
pub(crate) fn expire_readers(engine: &Arc<Engine>) -> Result<()> {
    expire_readers_at(engine, std::time::Instant::now())
}
fn expire_readers_at(engine: &Arc<Engine>, now: std::time::Instant) -> Result<()> {
    let expired = engine
        .browser_reader_leases
        .lock()
        .unwrap()
        .expired_identities(now);
    let mut failures = Vec::new();
    for identity in expired {
        if let Err(error) = expire_reader_at(engine, identity, now) {
            failures.push(error.to_string());
        }
    }
    if !failures.is_empty() {
        bail!(
            "{} browser reader recoveries failed: {}",
            failures.len(),
            failures.join("; ")
        );
    }
    Ok(())
}
fn expire_reader_at(
    engine: &Arc<Engine>,
    identity: StreamIdentity,
    now: std::time::Instant,
) -> Result<()> {
    let serial = engine
        .browser_stream_locks
        .lock()
        .unwrap()
        .entry(identity.stream_id.clone())
        .or_insert_with(|| Arc::new(std::sync::Mutex::new(())))
        .clone();
    let _serial = serial.lock().unwrap();
    // A heartbeat or durable frame may have renewed while we waited for this stream.
    if !engine
        .browser_reader_leases
        .lock()
        .unwrap()
        .expired(&identity, now)
    {
        return Ok(());
    }
    let checkpoint = checkpoint(engine, &identity.stream_id)?;
    let shared = checkpoint
        .as_ref()
        .and_then(|record| engine.jobs.lock().unwrap().get(&record.job_id).cloned());
    let eligible = checkpoint.as_ref().is_some_and(|record| {
        !record.terminal
            && record.identity.scope == identity.scope
            && record.identity.source_generation == identity.source_generation
    }) && shared.as_ref().is_some_and(|shared| {
        let job = shared.lock().unwrap();
        matches!(
            job.state,
            JobState::BrowserDownloading | JobState::WaitingUser
        ) && job.navigation_scope.as_ref() == Some(&identity.scope)
            && job.source_generation == identity.source_generation
            && job.navigation_owner.as_ref() == Some(&identity.scope.profile)
            && !job.navigation_transfer_pending
            && !job.navigation_transfer_recovery
    });
    if !eligible {
        engine
            .browser_reader_leases
            .lock()
            .unwrap()
            .remove(&identity.stream_id);
        return Ok(());
    }
    // Failed durable abort remains retryable; never report recovery before persistence.
    operation_locked(
        engine,
        StreamOperation::Abort {
            identity: identity.clone(),
            reason: "reader_lost".into(),
        },
    )?;
    engine
        .browser_reader_leases
        .lock()
        .unwrap()
        .remove(&identity.stream_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn reader_fixture() -> (tempfile::TempDir, Arc<Engine>, String, StreamIdentity) {
        reader_fixture_private(false)
    }
    fn reader_fixture_private(
        private: bool,
    ) -> (tempfile::TempDir, Arc<Engine>, String, StreamIdentity) {
        let directory = tempfile::tempdir().unwrap();
        let engine = Engine::open(directory.path()).unwrap();
        let (id, identity) = add_reader(&engine, directory.path(), private);
        (directory, engine, id, identity)
    }
    fn add_reader(
        engine: &Arc<Engine>,
        directory: &std::path::Path,
        private: bool,
    ) -> (String, StreamIdentity) {
        let owner = uuid::Uuid::new_v4().to_string();
        let job = engine
            .command(crate::Command::Navigate(crate::AddJob {
                request_id: uuid::Uuid::new_v4().to_string(),
                url: "http://127.0.0.1:9/one-use".into(),
                filename: Some("original.bin".into()),
                directory: Some(directory.join("output")),
                queue: None,
                checksum: None,
                paused: true,
                context: crate::RequestContext {
                    profile: Some(owner.clone()),
                    browser: Some("firefox".into()),
                    private,
                    ..Default::default()
                },
                media: None,
                description: String::new(),
            }))
            .unwrap();
        let id = job["id"].as_str().unwrap().to_string();
        let scope = SessionScope {
            browser: "firefox".into(),
            profile: owner.clone(),
            private,
            cookie_store_id: Some("firefox-container-1".into()),
            container_id: Some("firefox-container-1".into()),
            partition_key: None,
            claim_generation: 1,
        };
        engine
            .command(crate::Command::ClaimNavigation {
                id: id.clone(),
                owner,
                force: false,
                scope: Some(scope.clone()),
                source_generation: None,
            })
            .unwrap();
        let identity = StreamIdentity {
            stream_id: uuid::Uuid::new_v4().to_string(),
            scope,
            source_generation: 1,
        };
        operation(
            engine,
            StreamOperation::Begin {
                identity: identity.clone(),
                target: NavigationTarget::Job { id: id.clone() },
                filename: "original.bin".into(),
                total: Some(6),
            },
        )
        .unwrap();
        operation(
            engine,
            StreamOperation::Chunk {
                identity: identity.clone(),
                offset: 0,
                data_base64: "AQID".into(),
            },
        )
        .unwrap();
        (id, identity)
    }
    #[test]
    fn lost_reader_preserves_actual_durable_prefix_and_fences_late_frames() {
        let (_directory, engine, id, identity) = reader_fixture();
        let now = std::time::Instant::now();
        engine
            .browser_reader_leases
            .lock()
            .unwrap()
            .observe(&identity, now);
        expire_readers_at(&engine, now + lease::READER_TIMEOUT).unwrap();
        let job = engine.job(&id).unwrap();
        let job = job.lock().unwrap();
        assert_eq!(job.state, JobState::WaitingUser);
        assert_eq!(job.bytes, 3);
        assert!(job.verified_sha256.is_none());
        assert!(job
            .error
            .as_ref()
            .unwrap()
            .starts_with("browser_reader_lost:"));
        assert_eq!(std::fs::read(transfer::part_path(&job)).unwrap(), [1, 2, 3]);
        assert!(!job.destination.exists());
        drop(job);
        assert!(
            checkpoint(&engine, &identity.stream_id)
                .unwrap()
                .unwrap()
                .terminal
        );
        for frame in [
            StreamOperation::Chunk {
                identity: identity.clone(),
                offset: 3,
                data_base64: "BAUG".into(),
            },
            StreamOperation::End {
                identity: identity.clone(),
                total: 3,
                expected_sha256: None,
            },
        ] {
            assert!(operation(&engine, frame)
                .unwrap_err()
                .to_string()
                .contains("terminal"));
        }
        assert!(engine
            .browser_reader_leases
            .lock()
            .unwrap()
            .expired_identities(now + lease::READER_TIMEOUT * 2)
            .is_empty());
    }
    #[test]
    fn reopened_checkpoint_has_grace_and_exact_retained_ack_can_renew() {
        let (directory, engine, id, identity) = reader_fixture();
        drop(engine);
        let engine = Engine::open(directory.path()).unwrap();
        let now = std::time::Instant::now();
        expire_readers_at(&engine, now + std::time::Duration::from_secs(44)).unwrap();
        assert_eq!(
            engine.job(&id).unwrap().lock().unwrap().state,
            JobState::BrowserDownloading
        );
        let ack = operation(
            &engine,
            StreamOperation::Chunk {
                identity: identity.clone(),
                offset: 0,
                data_base64: "AQID".into(),
            },
        )
        .unwrap();
        assert_eq!(ack.accepted_offset, 3);
        assert!(!ack.terminal);
        let checkpoint = checkpoint(&engine, &identity.stream_id).unwrap().unwrap();
        assert_eq!(checkpoint.offset, 3);
    }
    #[test]
    fn corrupt_checkpoint_is_reported_and_expiry_remains_retryable() {
        let (directory, engine, _id, identity) = reader_fixture();
        let now = std::time::Instant::now();
        engine
            .browser_reader_leases
            .lock()
            .unwrap()
            .observe(&identity, now);
        let saved = checkpoint(&engine, &identity.stream_id).unwrap().unwrap();
        let connection =
            rusqlite::Connection::open(directory.path().join("downloader.db")).unwrap();
        connection
            .execute(
                "UPDATE records SET data='invalid-json' WHERE kind='browser_stream' AND id=?1",
                [&identity.stream_id],
            )
            .unwrap();
        assert!(expire_readers_at(&engine, now + lease::READER_TIMEOUT).is_err());
        assert!(engine
            .browser_reader_leases
            .lock()
            .unwrap()
            .expired(&identity, now + lease::READER_TIMEOUT));
        connection
            .execute(
                "UPDATE records SET data=?1 WHERE kind='browser_stream' AND id=?2",
                rusqlite::params![serde_json::to_string(&saved).unwrap(), identity.stream_id],
            )
            .unwrap();
        expire_readers_at(&engine, now + lease::READER_TIMEOUT).unwrap();
    }
    #[test]
    fn failed_reader_does_not_starve_other_expired_readers() {
        let (directory, engine, first_id, first) = reader_fixture();
        let (second_id, second) = add_reader(&engine, directory.path(), false);
        let now = std::time::Instant::now();
        {
            let mut leases = engine.browser_reader_leases.lock().unwrap();
            leases.observe(&first, now);
            leases.observe(&second, now);
        }
        let deadline = now + lease::READER_TIMEOUT;
        // Corrupt the first identity in the actual sweep order, so returning early
        // would deterministically leave the following healthy reader stranded.
        let failed = engine
            .browser_reader_leases
            .lock()
            .unwrap()
            .expired_identities(deadline)[0]
            .clone();
        let healthy = if failed.stream_id == first.stream_id {
            &second
        } else {
            &first
        };
        let healthy_id = if healthy.stream_id == first.stream_id {
            &first_id
        } else {
            &second_id
        };
        let saved = checkpoint(&engine, &failed.stream_id).unwrap().unwrap();
        let connection =
            rusqlite::Connection::open(directory.path().join("downloader.db")).unwrap();
        connection
            .execute(
                "UPDATE records SET data='invalid-json' WHERE kind='browser_stream' AND id=?1",
                [&failed.stream_id],
            )
            .unwrap();
        let error = expire_readers_at(&engine, deadline).unwrap_err();
        assert!(error
            .to_string()
            .contains("1 browser reader recoveries failed"));
        assert!(engine
            .browser_reader_leases
            .lock()
            .unwrap()
            .expired(&failed, deadline));
        assert_eq!(
            engine.job(healthy_id).unwrap().lock().unwrap().state,
            JobState::WaitingUser
        );
        assert!(
            checkpoint(&engine, &healthy.stream_id)
                .unwrap()
                .unwrap()
                .terminal
        );
        assert!(!engine
            .browser_reader_leases
            .lock()
            .unwrap()
            .expired(healthy, deadline));
        connection
            .execute(
                "UPDATE records SET data=?1 WHERE kind='browser_stream' AND id=?2",
                rusqlite::params![serde_json::to_string(&saved).unwrap(), failed.stream_id],
            )
            .unwrap();
        expire_readers_at(&engine, deadline).unwrap();
        assert!(engine
            .browser_reader_leases
            .lock()
            .unwrap()
            .expired_identities(deadline)
            .is_empty());
        assert!(
            checkpoint(&engine, &failed.stream_id)
                .unwrap()
                .unwrap()
                .terminal
        );
    }
    #[test]
    fn replaced_or_cancelled_owner_cannot_be_changed_by_old_reader_expiry() {
        for cancelled in [false, true] {
            let (_directory, engine, id, identity) = reader_fixture();
            let now = std::time::Instant::now();
            engine
                .browser_reader_leases
                .lock()
                .unwrap()
                .observe(&identity, now);
            let job = engine.job(&id).unwrap();
            if cancelled {
                job.lock().unwrap().state = JobState::Cancelled;
            } else {
                job.lock().unwrap().source_generation = 2;
            }
            expire_readers_at(&engine, now + lease::READER_TIMEOUT).unwrap();
            let job = job.lock().unwrap();
            assert_eq!(job.bytes, 3);
            assert_eq!(
                job.state,
                if cancelled {
                    JobState::Cancelled
                } else {
                    JobState::BrowserDownloading
                }
            );
            assert!(engine
                .browser_reader_leases
                .lock()
                .unwrap()
                .expired_identities(now + lease::READER_TIMEOUT)
                .is_empty());
        }
    }
    #[test]
    fn reader_heap_tracks_only_live_streams_and_private_leases_do_not_survive_restart() {
        let (directory, engine, id, identity) = reader_fixture_private(true);
        for _ in 0..8 {
            operation(
                &engine,
                StreamOperation::Begin {
                    identity: identity.clone(),
                    target: NavigationTarget::Job { id: id.clone() },
                    filename: "original.bin".into(),
                    total: Some(6),
                },
            )
            .unwrap();
        }
        assert_eq!(engine.browser_reader_leases.lock().unwrap().len(), 1);
        drop(engine);
        let engine = Engine::open(directory.path()).unwrap();
        assert!(engine.snapshot().jobs.is_empty());
        assert_eq!(engine.browser_reader_leases.lock().unwrap().len(), 0);
    }
    #[test]
    fn strict_bounded_base64() {
        assert_eq!(decode("AQID/w==").unwrap(), [1, 2, 3, 255]);
        for value in ["", "AA=A", "AB==", "AAAA====", "$AAA"] {
            assert!(decode(value).is_err());
        }
        assert!(decode(&"A".repeat(STREAM_CHUNK_BYTES / 3 * 4 + 4)).is_err());
    }
}
