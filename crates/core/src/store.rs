use anyhow::Result;
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
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS usage (time INTEGER NOT NULL, bytes INTEGER NOT NULL); PRAGMA user_version=1;")?;
        Ok(Self { connection })
    }
    pub fn put<T: Serialize>(&self, kind: &str, id: &str, value: &T) -> Result<()> {
        self.connection.execute("INSERT INTO records(kind,id,data) VALUES(?1,?2,?3) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",params![kind,id,serde_json::to_string(value)?])?;
        Ok(())
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
        self.connection.execute(
            "DELETE FROM records WHERE kind=?1 AND id=?2",
            params![kind, id],
        )?;
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
