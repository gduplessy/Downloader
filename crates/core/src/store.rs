use crate::model::*;
use anyhow::{bail, Result};
use rusqlite::{params, Connection};
use serde::{de::DeserializeOwned, Serialize};
use std::path::Path;

pub struct Store {
    connection: Connection,
    ephemeral_events: std::cell::RefCell<std::collections::BTreeMap<u64, EventPayload>>,
    ephemeral: std::cell::RefCell<std::collections::BTreeMap<(String, String), String>>,
}
impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(path)?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        let version: i64 = connection.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version > 2 {
            bail!("Database schema is newer than this application");
        }
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS usage (time INTEGER NOT NULL, bytes INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, job_id TEXT NOT NULL, fingerprint TEXT); PRAGMA user_version=2;")?;
        Ok(Self {
            connection,
            ephemeral: Default::default(),
            ephemeral_events: Default::default(),
        })
    }
    pub fn put<T: Serialize>(&self, kind: &str, id: &str, value: &T) -> Result<()> {
        let data = serde_json::to_string(value)?;
        let json: serde_json::Value = serde_json::from_str(&data)?;
        let private = (["job", "grabber", "rendered_discovery"].contains(&kind)
            && json["private"] == true)
            || json["scope"]["private"] == true
            || json["identity"]["scope"]["private"] == true;
        if private {
            let old = self
                .ephemeral
                .borrow_mut()
                .insert((kind.into(), id.into()), data.clone());
            if kind == "job" && old.as_ref() != Some(&data) {
                let job: Job = serde_json::from_str(&data)?;
                let tx = self.connection.unchecked_transaction()?;
                // Persist only a nonsecret sequence marker; actual private events stay in memory.
                Self::append(&tx, EventPayload::SettingsChanged)?;
                tx.commit()?;
                let sequence = self.sequence()?;
                let payload = if old
                    .as_ref()
                    .and_then(|value| serde_json::from_str::<Job>(value).ok())
                    .is_none_or(|old| old.state != job.state)
                {
                    EventPayload::JobLifecycle { job: Box::new(job) }
                } else {
                    EventPayload::JobProgress { job: Box::new(job) }
                };
                self.ephemeral_events.borrow_mut().insert(sequence, payload);
                self.ephemeral_events
                    .borrow_mut()
                    .retain(|key, _| sequence.saturating_sub(*key) < 2048);
            }
            return Ok(());
        }
        let tx = self.connection.unchecked_transaction()?;
        let old: Option<String> = tx
            .query_row(
                "SELECT data FROM records WHERE kind=?1 AND id=?2",
                params![kind, id],
                |r| r.get(0),
            )
            .ok();
        tx.execute("INSERT INTO records(kind,id,data) VALUES(?1,?2,?3) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",params![kind,id,data])?;
        if old.as_ref() != Some(&data) {
            let event = match kind {
                "job" => {
                    let job: Job = serde_json::from_str(&data)?;
                    tx.execute(
                        "INSERT OR IGNORE INTO requests(id,job_id,fingerprint) VALUES(?1,?2,?3)",
                        params![job.request_id, job.id, job.request_fingerprint],
                    )?;
                    if old
                        .as_ref()
                        .and_then(|s| serde_json::from_str::<Job>(s).ok())
                        .is_none_or(|j| j.state != job.state)
                    {
                        Some(EventPayload::JobLifecycle { job: Box::new(job) })
                    } else {
                        Some(EventPayload::JobProgress { job: Box::new(job) })
                    }
                }
                "settings" => Some(EventPayload::SettingsChanged),
                "queue" => Some(EventPayload::QueuesChanged),
                _ => None,
            };
            if let Some(event) = event {
                Self::append(&tx, event)?;
            }
        }
        tx.commit()?;
        Ok(())
    }
    pub fn put_browser_checkpoint(
        &self,
        checkpoint: &crate::browser_stream::Checkpoint,
        job: &Job,
    ) -> Result<()> {
        if job.private {
            self.put("browser_stream", &checkpoint.identity.stream_id, checkpoint)?;
            return self.put("job", &job.id, job);
        }
        let tx = self.connection.unchecked_transaction()?;
        let previous: Option<String> = tx
            .query_row(
                "SELECT data FROM records WHERE kind='job' AND id=?1",
                [&job.id],
                |r| r.get(0),
            )
            .ok();
        for (kind, id, data) in [
            (
                "browser_stream",
                &checkpoint.identity.stream_id,
                serde_json::to_string(checkpoint)?,
            ),
            ("job", &job.id, serde_json::to_string(job)?),
        ] {
            tx.execute("INSERT INTO records(kind,id,data) VALUES(?1,?2,?3) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",params![kind,id,data])?;
        }
        let payload = if previous
            .and_then(|s| serde_json::from_str::<Job>(&s).ok())
            .is_none_or(|previous| previous.state != job.state)
        {
            EventPayload::JobLifecycle {
                job: Box::new(job.clone()),
            }
        } else {
            EventPayload::JobProgress {
                job: Box::new(job.clone()),
            }
        };
        Self::append(&tx, payload)?;
        tx.commit()?;
        Ok(())
    }
    fn append(tx: &rusqlite::Transaction, event: EventPayload) -> Result<()> {
        tx.execute(
            "INSERT INTO events(at,data) VALUES(?1,?2)",
            params![
                chrono::Utc::now().to_rfc3339(),
                serde_json::to_string(&event)?
            ],
        )?;
        tx.execute("DELETE FROM events WHERE sequence <= (SELECT COALESCE(MAX(sequence),0)-2048 FROM events)",[])?;
        Ok(())
    }
    pub fn sequence(&self) -> Result<u64> {
        Ok(self
            .connection
            .query_row("SELECT COALESCE(MAX(sequence),0) FROM events", [], |r| {
                Ok(r.get::<_, i64>(0)? as u64)
            })?)
    }
    pub fn request(&self, id: &str) -> Result<Option<(String, Option<String>)>> {
        for ((kind, _), data) in self.ephemeral.borrow().iter() {
            if kind == "job" {
                let j: Job = serde_json::from_str(data)?;
                if j.request_id == id {
                    return Ok(Some((j.id, j.request_fingerprint)));
                }
            }
        }
        use rusqlite::OptionalExtension;
        Ok(self
            .connection
            .query_row(
                "SELECT job_id,fingerprint FROM requests WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?)
    }
    pub fn replay(&self, after: u64, limit: usize) -> Result<Option<(Vec<EngineEvent>, bool)>> {
        let first: u64 =
            self.connection
                .query_row("SELECT COALESCE(MIN(sequence),0) FROM events", [], |r| {
                    Ok(r.get::<_, i64>(0)? as u64)
                })?;
        if after > self.sequence()? || first > after.saturating_add(1) {
            return Ok(None);
        }
        let mut query = self.connection.prepare(
            "SELECT sequence,at,data FROM events WHERE sequence>?1 ORDER BY sequence LIMIT ?2",
        )?;
        let rows = query.query_map(params![after as i64, (limit + 1) as i64], |r| {
            Ok((
                r.get::<_, i64>(0)? as u64,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?;
        let mut events = vec![];
        for row in rows {
            let (sequence, at, data) = row?;
            events.push(EngineEvent {
                sequence,
                at: chrono::DateTime::parse_from_rfc3339(&at)?.with_timezone(&chrono::Utc),
                payload: self
                    .ephemeral_events
                    .borrow()
                    .get(&sequence)
                    .cloned()
                    .unwrap_or(serde_json::from_str(&data)?),
            });
        }
        let more = events.len() > limit;
        events.truncate(limit);
        Ok(Some((events, more)))
    }

    pub fn get<T: DeserializeOwned>(&self, kind: &str, id: &str) -> Result<T> {
        if let Some(data) = self.ephemeral.borrow().get(&(kind.into(), id.into())) {
            return Ok(serde_json::from_str(data)?);
        }
        let data: String = self.connection.query_row(
            "SELECT data FROM records WHERE kind=?1 AND id=?2",
            params![kind, id],
            |r| r.get(0),
        )?;
        Ok(serde_json::from_str(&data)?)
    }
    pub fn all<T: DeserializeOwned>(&self, kind: &str) -> Result<Vec<T>> {
        let mut query = self
            .connection
            .prepare("SELECT data FROM records WHERE kind=?1 ORDER BY rowid")?;
        let values = query.query_map([kind], |r| r.get::<_, String>(0))?;
        let mut result = vec![];
        for value in values {
            result.push(serde_json::from_str(&value?)?);
        }
        for ((record_kind, _), data) in self.ephemeral.borrow().iter() {
            if record_kind == kind {
                result.push(serde_json::from_str(data)?);
            }
        }
        Ok(result)
    }
    pub fn remove(&self, kind: &str, id: &str) -> Result<()> {
        if let Some(data) = self
            .ephemeral
            .borrow_mut()
            .remove(&(kind.into(), id.into()))
        {
            if kind == "job" {
                let job: Job = serde_json::from_str(&data)?;
                let tx = self.connection.unchecked_transaction()?;
                Self::append(&tx, EventPayload::SettingsChanged)?;
                tx.commit()?;
                self.ephemeral_events.borrow_mut().insert(
                    self.sequence()?,
                    EventPayload::JobRemoved {
                        id: id.into(),
                        browser_source: job.browser_source,
                        page_url: job.page_url,
                    },
                );
            }
            return Ok(());
        }
        let tx = self.connection.unchecked_transaction()?;
        if kind == "job" {
            let old: String = tx.query_row(
                "SELECT data FROM records WHERE kind='job' AND id=?1",
                [id],
                |r| r.get(0),
            )?;
            let job: Job = serde_json::from_str(&old)?;
            Self::append(
                &tx,
                EventPayload::JobRemoved {
                    id: id.into(),
                    browser_source: job.browser_source,
                    page_url: job.page_url,
                },
            )?;
        } else if kind == "queue" {
            Self::append(&tx, EventPayload::QueuesChanged)?;
        }
        tx.execute(
            "DELETE FROM records WHERE kind=?1 AND id=?2",
            params![kind, id],
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn record_usage(&self, bytes: u64) -> Result<()> {
        if bytes > 0 {
            self.connection.execute(
                "INSERT INTO usage(time,bytes) VALUES(?1,?2)",
                params![
                    chrono::Utc::now().timestamp(),
                    bytes.min(i64::MAX as u64) as i64
                ],
            )?;
        }
        Ok(())
    }
    pub fn usage(&self, minutes: u64) -> Result<u64> {
        Ok(self.connection.query_row(
            "SELECT COALESCE(SUM(bytes),0) FROM usage WHERE time>=?1",
            [chrono::Utc::now().timestamp() - (minutes.min(525600) * 60) as i64],
            |r| r.get::<_, i64>(0),
        )? as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Queue;
    #[test]
    fn durable_idempotent_records() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let store = Store::open(&path).unwrap();
        store.put("queue", "default", &Queue::default()).unwrap();
        store.put("queue", "default", &Queue::default()).unwrap();
        drop(store);
        let store = Store::open(&path).unwrap();
        assert_eq!(store.all::<Queue>("queue").unwrap().len(), 1);
        store.record_usage(123).unwrap();
        assert_eq!(store.usage(60).unwrap(), 123);
    }
    #[test]
    fn replay_limits_and_retention_gaps_are_explicit() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(&directory.path().join("events.db")).unwrap();
        for i in 0..5 {
            let queue = Queue {
                id: format!("q{i}"),
                ..Default::default()
            };
            store.put("queue", &queue.id, &queue).unwrap();
        }
        let (events, more) = store.replay(0, 2).unwrap().unwrap();
        assert_eq!(events.len(), 2);
        assert!(more);
        assert_eq!(events[0].sequence, 1);
        store
            .connection
            .execute("DELETE FROM events WHERE sequence<4", [])
            .unwrap();
        assert!(store.replay(1, 2).unwrap().is_none());
        let (events, more) = store.replay(3, 2).unwrap().unwrap();
        assert_eq!(events.len(), 2);
        assert!(!more);
        assert_eq!(events[0].sequence, 4);
    }
}
