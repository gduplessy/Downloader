use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::PathBuf};

pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JobState {
    Queued,
    Connecting,
    Downloading,
    Paused,
    WaitingAuthentication,
    WaitingSource,
    WaitingQuota,
    WaitingSchedule,
    WaitingBrowser,
    WaitingUser,
    BrowserDownloading,
    BrowserComplete,
    Verifying,
    Assembling,
    Scanning,
    Complete,
    Failed,
    Cancelled,
}
impl JobState {
    pub fn active(&self) -> bool {
        matches!(
            self,
            Self::Connecting
                | Self::Downloading
                | Self::Verifying
                | Self::Assembling
                | Self::Scanning
        )
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Segment {
    pub start: u64,
    pub end: u64,
    pub downloaded: u64,
}
impl Segment {
    pub fn remaining(&self) -> u64 {
        self.end
            .saturating_sub(self.start)
            .saturating_add(1)
            .saturating_sub(self.downloaded)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RequestContext {
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    pub credential_id: Option<String>,
    pub browser: Option<String>,
    #[serde(default)]
    pub private: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MediaOptions {
    pub format: Option<String>,
    #[serde(default)]
    pub audio_only: bool,
    #[serde(default)]
    pub subtitles: bool,
    #[serde(default)]
    pub thumbnail: bool,
    #[serde(default)]
    pub playlist: bool,
    pub container: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddJob {
    pub request_id: String,
    pub url: String,
    pub filename: Option<String>,
    pub directory: Option<PathBuf>,
    pub queue: Option<String>,
    pub checksum: Option<String>,
    #[serde(default)]
    pub paused: bool,
    #[serde(default)]
    pub context: RequestContext,
    pub media: Option<MediaOptions>,
    #[serde(default)]
    pub description: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    pub request_id: String,
    pub url: String,
    pub filename: String,
    pub destination: PathBuf,
    pub queue: String,
    pub category: String,
    pub state: JobState,
    pub bytes: u64,
    pub total: Option<u64>,
    pub speed: u64,
    pub resumable: bool,
    pub etag: Option<String>,
    pub modified: Option<String>,
    pub segments: Vec<Segment>,
    pub checksum: Option<String>,
    pub error: Option<String>,
    pub created: DateTime<Utc>,
    pub updated: DateTime<Utc>,
    pub media: Option<MediaOptions>,
    pub description: String,
    #[serde(default)]
    pub browser_source: bool,
    #[serde(default)]
    pub viable: bool,
    #[serde(default)]
    pub page_url: Option<String>,
    #[serde(default)]
    pub navigation_owner: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Category {
    pub id: String,
    pub name: String,
    pub extensions: Vec<String>,
    pub directory: PathBuf,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Queue {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub concurrency: usize,
    pub order: Vec<String>,
    pub start_time: Option<String>,
    pub stop_time: Option<String>,
    pub interval_minutes: Option<u64>,
    pub next_run: Option<DateTime<Utc>>,
    #[serde(default)]
    pub synchronize: bool,
}
impl Default for Queue {
    fn default() -> Self {
        Self {
            id: "default".into(),
            name: "Main queue".into(),
            enabled: true,
            concurrency: 3,
            order: vec![],
            start_time: None,
            stop_time: None,
            interval_minutes: None,
            next_run: None,
            synchronize: false,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scanner {
    pub executable: PathBuf,
    pub args: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub directory: PathBuf,
    pub max_jobs: usize,
    pub connections: usize,
    pub host_connections: usize,
    pub speed_limit: u64,
    pub quota_bytes: u64,
    pub quota_minutes: u64,
    pub proxy: Option<String>,
    pub proxy_credential: Option<String>,
    pub categories: Vec<Category>,
    pub locale: String,
    pub theme: String,
    pub scanner: Option<Scanner>,
    pub components: PathBuf,
    #[serde(default)]
    pub clipboard: bool,
    #[serde(default)]
    pub completion_action: String,
    #[serde(default)]
    pub completion_command: Option<Scanner>,
}
impl Default for Settings {
    fn default() -> Self {
        let directory = dirs::download_dir().unwrap_or_else(|| PathBuf::from("Downloads"));
        let categories = [
            (
                "documents",
                "Documents",
                vec!["pdf", "doc", "docx", "txt", "epub"],
            ),
            (
                "archives",
                "Archives",
                vec!["zip", "7z", "rar", "tar", "gz"],
            ),
            ("music", "Music", vec!["mp3", "flac", "wav", "m4a", "ogg"]),
            ("video", "Video", vec!["mp4", "mkv", "webm", "mov"]),
            (
                "programs",
                "Programs",
                vec!["exe", "msi", "dmg", "deb", "appimage"],
            ),
        ]
        .into_iter()
        .map(|(id, name, ext)| Category {
            id: id.into(),
            name: name.into(),
            extensions: ext.into_iter().map(String::from).collect(),
            directory: directory.join(name),
        })
        .collect();
        Self {
            directory,
            max_jobs: 3,
            connections: 4,
            host_connections: 8,
            speed_limit: 0,
            quota_bytes: 0,
            quota_minutes: 60,
            proxy: None,
            proxy_credential: None,
            categories,
            locale: "en".into(),
            theme: "system".into(),
            scanner: None,
            components: data_dir().join("components"),
            clipboard: false,
            completion_action: String::new(),
            completion_command: None,
        }
    }
}
pub fn data_dir() -> PathBuf {
    std::env::var_os("DOWNLOADER_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            dirs::data_local_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("Downloader")
        })
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub version: u32,
    pub sequence: u64,
    pub jobs: Vec<Job>,
    pub queues: Vec<Queue>,
    pub settings: Settings,
    pub components: Vec<ComponentStatus>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentStatus {
    pub name: String,
    pub available: bool,
    pub path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "command", content = "args", rename_all = "snake_case")]
pub enum Command {
    Snapshot,
    Add(AddJob),
    Navigate(AddJob),
    ClaimNavigation {
        id: String,
        owner: String,
        #[serde(default)]
        force: bool,
    },
    Resolve {
        id: String,
        owner: String,
        url: String,
        filename: Option<String>,
        #[serde(default)]
        context: RequestContext,
    },
    BrowserStatus {
        id: String,
        owner: String,
        state: JobState,
        message: Option<String>,
        #[serde(default)]
        bytes: u64,
        total: Option<u64>,
    },
    Pause {
        id: String,
    },
    Resume {
        id: String,
        #[serde(default)]
        restart: bool,
    },
    Cancel {
        id: String,
    },
    Remove {
        id: String,
        #[serde(default)]
        delete_file: bool,
    },
    Refresh {
        id: String,
        url: String,
        #[serde(default)]
        context: RequestContext,
    },
    Settings(Settings),
    Queue(Queue),
    DeleteQueue {
        id: String,
    },
    Inspect {
        url: String,
        #[serde(default)]
        context: RequestContext,
    },
    InspectMedia {
        url: String,
        #[serde(default)]
        context: RequestContext,
    },
    ZipPreview {
        url: String,
        #[serde(default)]
        context: RequestContext,
    },
    Grabber(GrabberProject),
    GrabberList,
    GrabberRun {
        id: String,
    },
    GrabberDownload {
        id: String,
        urls: Vec<String>,
    },
    Export,
    Import {
        jobs: Vec<AddJob>,
    },
    Credential {
        id: String,
        username: String,
        password: String,
    },
    Diagnostics,
    Quit,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Request {
    pub version: u32,
    pub id: String,
    #[serde(flatten)]
    pub command: Command,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Response {
    pub version: u32,
    pub id: String,
    pub ok: bool,
    pub data: serde_json::Value,
    pub error: Option<ProtocolError>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolError {
    pub code: String,
    pub message: String,
}
impl Response {
    pub fn success(id: String, data: impl Serialize) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            id,
            ok: true,
            data: serde_json::to_value(data).unwrap_or_default(),
            error: None,
        }
    }
    pub fn failure(id: String, code: &str, message: String) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            id,
            ok: false,
            data: serde_json::Value::Null,
            error: Some(ProtocolError {
                code: code.into(),
                message,
            }),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrabberProject {
    pub id: String,
    pub name: String,
    pub url: String,
    pub directory: PathBuf,
    pub depth: usize,
    pub max_pages: usize,
    pub same_domain: bool,
    pub include: String,
    pub exclude: String,
    pub min_size: u64,
    pub max_size: Option<u64>,
    pub mirror: bool,
    #[serde(default)]
    pub rendered: bool,
    #[serde(default)]
    pub found: Vec<GrabberFile>,
    #[serde(default)]
    pub visited: Vec<String>,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub interval_minutes: Option<u64>,
    pub next_run: Option<DateTime<Utc>>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrabberFile {
    pub url: String,
    pub name: String,
    pub size: Option<u64>,
    pub content_type: String,
}
