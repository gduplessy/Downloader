use crate::model::*;
use anyhow::{bail, Result};
use rusqlite::{params, Connection};
use serde::{de::DeserializeOwned, Serialize};
use std::path::Path;

pub struct Store {
    connection: Connection,
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
        Ok(Self { connection })
    }
    pub fn put<T: Serialize>(&self, kind: &str, id: &str, value: &T) -> Result<()> {
        let data = serde_json::to_string(value)?;
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
                payload: serde_json::from_str(&data)?,
            });
        }
        let more = events.len() > limit;
        events.truncate(limit);
        Ok(Some((events, more)))
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
        Ok(result)
    }
    pub fn remove(&self, kind: &str, id: &str) -> Result<()> {
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
}
