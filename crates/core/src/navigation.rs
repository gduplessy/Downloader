//! Nonsecret contracts shared by navigation feature modules.
use anyhow::{bail, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub const NATIVE_FRAME_LIMIT: usize = 1024 * 1024;
pub const STREAM_CHUNK_BYTES: usize = 192 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PartitionKey {
    pub top_level_site: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_cross_site_ancestor: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionScope {
    pub browser: String,
    pub profile: String,
    pub private: bool,
    pub cookie_store_id: Option<String>,
    pub container_id: Option<String>,
    pub partition_key: Option<PartitionKey>,
    pub claim_generation: u64,
}
impl SessionScope {
    pub fn validate(&self) -> Result<()> {
        if !matches!(self.browser.as_str(), "chromium" | "firefox") {
            bail!("Unsupported browser scope");
        }
        uuid::Uuid::parse_str(&self.profile)?;
        if self.claim_generation == 0 || self.claim_generation > 9_007_199_254_740_991 {
            bail!("Invalid claim generation");
        }
        for value in [&self.cookie_store_id, &self.container_id]
            .into_iter()
            .flatten()
        {
            if value.is_empty() || value.len() > 256 || value.contains(['\0', '\r', '\n']) {
                bail!("Invalid cookie scope identifier");
            }
        }
        if let Some(key) = &self.partition_key {
            let url = url::Url::parse(&key.top_level_site)?;
            if !matches!(url.scheme(), "http" | "https")
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
                || url.path() != "/"
            {
                bail!("Partition key must be an HTTP origin");
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum NavigationTarget {
    Job { id: String },
    Project { id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NavigationPurpose {
    Navigation,
    Discovery,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NavigationStatus {
    WaitingAdmission,
    Active,
    WaitingSite,
    WaitingUser,
    WaitingBrowser,
    Streaming,
    Complete,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WaitBasis {
    Server,
    Page,
    RetryAfter,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TabRequirement {
    Live,
    Recreatable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WaitMetadata {
    pub observed_at: DateTime<Utc>,
    pub ready_at: Option<DateTime<Utc>>,
    pub recheck_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub basis: WaitBasis,
    pub tab_requirement: TabRequirement,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NavigationTask {
    pub id: String,
    pub target: NavigationTarget,
    pub purpose: NavigationPurpose,
    pub scope: SessionScope,
    pub source_generation: u64,
    pub source_origin: String,
    pub selected_host: Option<String>,
    pub adapter_id: String,
    pub adapter_version: String,
    pub status: NavigationStatus,
    pub reason: Option<String>,
    pub wait: Option<WaitMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReplayDisposition {
    Replayable,
    BrowserStreamOnly,
    RefreshRequired,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplayDecision {
    pub disposition: ReplayDisposition,
    pub reason: String,
    pub source_generation: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamIdentity {
    pub stream_id: String,
    pub scope: SessionScope,
    pub source_generation: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum StreamOperation {
    Begin {
        #[serde(flatten)]
        identity: StreamIdentity,
        target: NavigationTarget,
        filename: String,
        total: Option<u64>,
    },
    Chunk {
        #[serde(flatten)]
        identity: StreamIdentity,
        offset: u64,
        data_base64: String,
    },
    End {
        #[serde(flatten)]
        identity: StreamIdentity,
        total: u64,
        expected_sha256: Option<String>,
    },
    Abort {
        #[serde(flatten)]
        identity: StreamIdentity,
        reason: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamAck {
    pub stream_id: String,
    pub accepted_offset: u64,
    pub claim_generation: u64,
    pub source_generation: u64,
    pub terminal: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    fn scope() -> SessionScope {
        SessionScope {
            browser: "firefox".into(),
            profile: uuid::Uuid::new_v4().to_string(),
            private: false,
            cookie_store_id: Some("firefox-container-1".into()),
            container_id: Some("1".into()),
            partition_key: None,
            claim_generation: 1,
        }
    }
    #[test]
    fn scope_rejects_missing_owner_and_secret_partition_material() {
        let mut value = scope();
        assert!(value.validate().is_ok());
        value.claim_generation = 0;
        assert!(value.validate().is_err());
        value.claim_generation = 1;
        value.partition_key = Some(PartitionKey {
            top_level_site: "https://user:password@example.com/?token=secret".into(),
            has_cross_site_ancestor: None,
        });
        assert!(value.validate().is_err());
        value.partition_key.as_mut().unwrap().top_level_site = "https://example.com/".into();
        assert!(value.validate().is_ok());
    }
    #[test]
    fn largest_chunk_fits_native_frame_with_scope_metadata() {
        let frame = StreamOperation::Chunk {
            identity: StreamIdentity {
                stream_id: uuid::Uuid::new_v4().to_string(),
                scope: scope(),
                source_generation: 1,
            },
            offset: 0,
            data_base64: "A".repeat(STREAM_CHUNK_BYTES.div_ceil(3) * 4),
        };
        let encoded = serde_json::to_vec(&frame).unwrap();
        assert!(encoded.len() < NATIVE_FRAME_LIMIT);
        let roundtrip: StreamOperation = serde_json::from_slice(&encoded).unwrap();
        assert!(matches!(
            roundtrip,
            StreamOperation::Chunk { offset: 0, .. }
        ));
    }
}
