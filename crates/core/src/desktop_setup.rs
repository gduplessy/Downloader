//! Fixed, expiring browser-to-desktop setup signal. No paths or browsing metadata in events.
use crate::{model::EventPayload, store::Store};
use anyhow::{bail, Result};
use rusqlite::params;
use serde::{Deserialize, Serialize};

pub const TTL_MS: i64 = 15_000;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub nonce: String,
    pub expires_at: i64,
}
impl Store {
    pub fn queue_destination_setup(&self, request: &Request) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        if uuid::Uuid::parse_str(&request.nonce).is_err()
            || request.expires_at <= now
            || request.expires_at > now + TTL_MS
        {
            bail!("desktop_setup_invalid_or_expired");
        }
        let tx = self.connection.unchecked_transaction()?;
        // A repeated nonce is an idempotent request; it never emits another event.
        tx.execute("DELETE FROM records WHERE kind='desktop_setup' AND CAST(json_extract(data,'$.expires_at') AS INTEGER) <= ?1", [now])?;
        let inserted = tx.execute(
            "INSERT OR IGNORE INTO records(kind,id,data) VALUES('desktop_setup',?1,?2)",
            params![request.nonce, serde_json::to_string(request)?],
        )?;
        if inserted > 0 {
            Self::append(
                &tx,
                EventPayload::DesktopDestinationSetup {
                    nonce: request.nonce.clone(),
                    expires_at: request.expires_at,
                },
            )?;
        }
        tx.commit()?;
        Ok(())
    }
    pub fn consume_destination_setup(&self, nonce: &str) -> Result<bool> {
        let now = chrono::Utc::now().timestamp_millis();
        // Retain the consumed row until expiry to fence duplicate browser commands.
        let changed = self.connection.execute("UPDATE records SET data=json_set(data,'$.consumed',1) WHERE kind='desktop_setup' AND id=?1 AND CAST(json_extract(data,'$.expires_at') AS INTEGER)>?2 AND json_extract(data,'$.consumed') IS NULL", params![nonce, now])?;
        Ok(changed == 1)
    }
}
