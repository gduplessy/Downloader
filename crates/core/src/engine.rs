use crate::{archive, grabber, media, model::*, security, store::Store, transfer};
use anyhow::{bail, Context, Result};
use std::{
    collections::HashMap,
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

pub struct Engine {
    pub store: Arc<Mutex<Store>>,
    pub jobs: Mutex<HashMap<String, transfer::SharedJob>>,
    pub settings: Mutex<Settings>,
    pub queues: Mutex<Vec<Queue>>,
    contexts: Mutex<HashMap<String, RequestContext>>,
    controls: Mutex<HashMap<String, Arc<AtomicU8>>>,
    sequence: AtomicU64,
    pub stopping: AtomicBool,
}
impl Engine {
    pub fn open(directory: &Path) -> Result<Arc<Self>> {
        let store = Store::open(&directory.join("downloader.db"))?;
        let settings = store
            .all::<Settings>("settings")?
            .into_iter()
            .next()
            .unwrap_or_default();
        let mut jobs = HashMap::new();
        for mut job in store.all::<Job>("job")? {
            if matches!(
                job.state,
                JobState::Assembling | JobState::Scanning | JobState::Complete
            ) {
                match crate::finalize::recover(&mut job, &settings) {
                    Ok(()) => {
                        store.put("job", &job.id, &job)?;
                        if job.state == JobState::Complete && transfer::part_path(&job).is_file() {
                            std::fs::remove_file(transfer::part_path(&job))?;
                        }
                    }
                    Err(e) => {
                        job.state = JobState::Failed;
                        job.error = Some(security::redact(&e.to_string()));
                        store.put("job", &job.id, &job)?;
                    }
                }
            }
            if job.state.active() {
                job.state = if job.browser_source {
                    JobState::WaitingAuthentication
                } else {
                    JobState::Paused
                };
                job.error = Some("Recovered after interruption; resume when ready".into());
                job.speed = 0;
                job.viable = false;
                store.put("job", &job.id, &job)?;
            }
            jobs.insert(job.id.clone(), Arc::new(Mutex::new(job)));
        }
        let mut queues = store.all::<Queue>("queue")?;
        if queues.is_empty() {
            queues.push(Queue::default());
            store.put("queue", "default", &queues[0])?;
        }
        Ok(Arc::new(Self {
            store: Arc::new(Mutex::new(store)),
            jobs: Mutex::new(jobs),
            settings: Mutex::new(settings),
            queues: Mutex::new(queues),
            contexts: Mutex::new(HashMap::new()),
            controls: Mutex::new(HashMap::new()),
            sequence: AtomicU64::new(1),
            stopping: AtomicBool::new(false),
        }))
    }
    pub fn start(self: &Arc<Self>) {
        let engine = self.clone();
        std::thread::spawn(move || {
            while !engine.stopping.load(Ordering::Relaxed) {
                if let Err(e) = engine.tick() {
                    eprintln!("Scheduler: {}", security::redact(&e.to_string()));
                }
                std::thread::sleep(Duration::from_millis(250));
            }
        });
    }
    pub fn snapshot(&self) -> Snapshot {
        let mut jobs: Vec<_> = self
            .jobs
            .lock()
            .unwrap()
            .values()
            .map(|j| j.lock().unwrap().clone())
            .collect();
        jobs.sort_by_key(|j| j.created);
        let settings = self.settings.lock().unwrap().clone();
        Snapshot {
            version: PROTOCOL_VERSION,
            sequence: self.sequence.load(Ordering::Relaxed),
            jobs,
            queues: self.queues.lock().unwrap().clone(),
            components: media::components(&settings),
            settings,
        }
    }
    fn persist(&self, job: &transfer::SharedJob) -> Result<()> {
        let job = job.lock().unwrap().clone();
        self.store.lock().unwrap().put("job", &job.id, &job)?;
        self.sequence.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }
    pub fn job(&self, id: &str) -> Result<transfer::SharedJob> {
        self.jobs
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .context("Unknown download")
    }
    pub fn add(&self, request: AddJob) -> Result<Job> {
        security::validate_url(&request.url)?;
        security::validate_context(&request.context)?;
        if request.request_id.is_empty() || request.request_id.len() > 256 {
            bail!("A request ID of at most 256 characters is required");
        }
        if let Some(hash) = &request.checksum {
            if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
                bail!("Expected checksum must be a SHA-256 hex digest");
            }
        }
        let mut jobs = self.jobs.lock().unwrap();
        if let Some(existing) = jobs
            .values()
            .map(|j| j.lock().unwrap().clone())
            .find(|j| j.request_id == request.request_id)
        {
            return Ok(existing);
        }
        let url = url::Url::parse(&request.url)?;
        let settings = self.settings.lock().unwrap().clone();
        let filename = security::safe_filename(request.filename.as_deref().unwrap_or_else(|| {
            url.path_segments()
                .and_then(|mut s| s.next_back())
                .filter(|s| !s.is_empty())
                .unwrap_or("download")
        }));
        let category = settings.categories.iter().find(|c| {
            c.extensions
                .iter()
                .any(|e| filename.to_ascii_lowercase().ends_with(&format!(".{e}")))
        });
        let directory = request.directory.unwrap_or_else(|| {
            category
                .map(|c| c.directory.clone())
                .unwrap_or(settings.directory)
        });
        if !directory.is_absolute() {
            bail!("Download directory must be an absolute path");
        }
        let mut destination = security::unique_destination(&directory, &filename);
        let reserved: Vec<_> = jobs
            .values()
            .map(|j| j.lock().unwrap().destination.clone())
            .collect();
        while reserved.contains(&destination) {
            destination = directory.join(format!("{}-{}", uuid::Uuid::new_v4(), filename));
        }
        let filename = destination
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let queue = request.queue.unwrap_or_else(|| "default".into());
        if !self.queues.lock().unwrap().iter().any(|q| q.id == queue) {
            bail!("Unknown queue");
        }
        let job = Job {
            id: uuid::Uuid::new_v4().to_string(),
            request_id: request.request_id,
            url: request.url,
            filename,
            destination,
            queue,
            category: category
                .map(|c| c.id.clone())
                .unwrap_or_else(|| "other".into()),
            state: if request.paused {
                JobState::Paused
            } else {
                JobState::Queued
            },
            bytes: 0,
            total: None,
            speed: 0,
            resumable: false,
            etag: None,
            modified: None,
            segments: vec![],
            checksum: request.checksum,
            error: None,
            created: chrono::Utc::now(),
            updated: chrono::Utc::now(),
            media: request.media,
            description: request.description,
            browser_source: request.context.browser.is_some(),
            viable: false,
            page_url: None,
            navigation_owner: None,
        };
        self.store.lock().unwrap().put("job", &job.id, &job)?;
        self.contexts
            .lock()
            .unwrap()
            .insert(job.id.clone(), request.context);
        jobs.insert(job.id.clone(), Arc::new(Mutex::new(job.clone())));
        self.sequence.fetch_add(1, Ordering::Relaxed);
        Ok(job)
    }
    pub fn command(self: &Arc<Self>, command: Command) -> Result<serde_json::Value> {
        match command {
            Command::Navigate(mut add) => {
                if add.media.is_some() {
                    bail!("Page navigation and media extraction are separate source types");
                }
                add.paused = true;
                let created = self.add(add)?;
                let job = self.job(&created.id)?;
                {
                    let mut j = job.lock().unwrap();
                    if j.page_url.is_none() {
                        j.page_url = Some(j.url.clone());
                        j.state = JobState::WaitingBrowser;
                        j.error = Some(
                            "Open the browser extension to continue through the download page"
                                .into(),
                        );
                    }
                }
                self.persist(&job)?;
                let value = serde_json::to_value(job.lock().unwrap().clone())?;
                Ok(value)
            }
            Command::ClaimNavigation { id, owner, force } => {
                uuid::Uuid::parse_str(&owner).context("Invalid browser profile identifier")?;
                let job = self.job(&id)?;
                {
                    let mut j = job.lock().unwrap();
                    if j.page_url.is_none()
                        || !matches!(j.state, JobState::WaitingBrowser | JobState::WaitingUser)
                    {
                        bail!("Job is not waiting for browser navigation");
                    }
                    if !force
                        && j.navigation_owner
                            .as_ref()
                            .is_some_and(|existing| existing != &owner)
                    {
                        bail!("Navigation is assigned to another browser profile");
                    }
                    j.navigation_owner = Some(owner);
                }
                self.persist(&job)?;
                Ok(serde_json::json!({"id":id}))
            }
            Command::Resolve {
                id,
                owner,
                url,
                filename,
                context,
            } => {
                security::validate_url(&url)?;
                security::validate_context(&context)?;
                if self.controls.lock().unwrap().contains_key(&id) {
                    bail!("Download is already running");
                }
                let job = self.job(&id)?;
                let filename = match filename {
                    Some(name) => Some(name),
                    None => {
                        transfer::inspect(&url, &context, &self.settings.lock().unwrap().clone())?
                            .filename
                    }
                };
                let mut j = job.lock().unwrap();
                if j.navigation_owner.as_ref() != Some(&owner) {
                    bail!("Navigation belongs to another browser profile");
                }
                if j.page_url.is_none()
                    || !matches!(j.state, JobState::WaitingBrowser | JobState::WaitingUser)
                {
                    bail!("Job is not waiting for a browser-resolved source");
                }
                if let Some(name) = filename {
                    let name = security::safe_filename(&name);
                    let directory = j
                        .destination
                        .parent()
                        .context("Missing destination")?
                        .to_path_buf();
                    let candidate = security::unique_destination(&directory, &name);
                    j.filename = candidate
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into();
                    j.destination = candidate;
                }
                j.url = url;
                j.state = JobState::Queued;
                j.error = None;
                j.browser_source = true;
                j.viable = false;
                self.contexts.lock().unwrap().insert(id, context);
                drop(j);
                self.persist(&job)?;
                let value = serde_json::to_value(job.lock().unwrap().clone())?;
                Ok(value)
            }
            Command::BrowserStatus {
                id,
                owner,
                state,
                message,
                bytes,
                total,
            } => {
                if !matches!(
                    state,
                    JobState::WaitingBrowser
                        | JobState::WaitingUser
                        | JobState::BrowserDownloading
                        | JobState::BrowserComplete
                        | JobState::Failed
                ) {
                    bail!("Invalid browser navigation state");
                }
                let job = self.job(&id)?;
                {
                    let mut j = job.lock().unwrap();
                    if j.navigation_owner.as_ref() != Some(&owner) {
                        bail!("Navigation belongs to another browser profile");
                    }
                    if j.page_url.is_none()
                        || j.state.active()
                        || j.state == JobState::Complete
                        || j.state == JobState::Cancelled
                    {
                        bail!("Job is not controlled by browser navigation");
                    }
                    j.state = state;
                    j.error = message
                        .map(|s| security::redact(&s.chars().take(1024).collect::<String>()));
                    j.bytes = bytes;
                    j.total = total;
                }
                self.persist(&job)?;
                Ok(serde_json::json!({"id":id}))
            }
            Command::Snapshot => Ok(serde_json::to_value(self.snapshot())?),
            Command::Add(add) => Ok(serde_json::to_value(self.add(add)?)?),
            Command::Pause { id } => {
                let j = self.job(&id)?;
                if let Some(c) = self.controls.lock().unwrap().get(&id) {
                    c.store(1, Ordering::Relaxed);
                } else {
                    let mut job = j.lock().unwrap();
                    if job.state != JobState::Complete && job.state != JobState::Cancelled {
                        job.state = JobState::Paused;
                    }
                }
                self.persist(&j)?;
                Ok(serde_json::json!({"id":id}))
            }
            Command::Cancel { id } => {
                let j = self.job(&id)?;
                if let Some(c) = self.controls.lock().unwrap().get(&id) {
                    c.store(2, Ordering::Relaxed);
                } else {
                    j.lock().unwrap().state = JobState::Cancelled;
                }
                self.persist(&j)?;
                Ok(serde_json::json!({"id":id}))
            }
            Command::Resume { id, restart } => {
                let j = self.job(&id)?;
                if self.controls.lock().unwrap().contains_key(&id) {
                    bail!("Wait for the active transfer to stop");
                }
                let mut job = j.lock().unwrap();
                if job.state == JobState::Complete {
                    bail!("Download is already complete");
                }
                if job.page_url.as_ref() == Some(&job.url) {
                    job.state = JobState::WaitingBrowser;
                    job.error = Some("Continue page navigation from the browser extension".into());
                    drop(job);
                    self.persist(&j)?;
                    return Ok(serde_json::json!({"id":id}));
                }
                if restart {
                    let path = transfer::part_path(&job);
                    if path.exists() {
                        std::fs::remove_file(path)?;
                    }
                    job.bytes = 0;
                    job.segments.clear();
                    job.etag = None;
                    job.modified = None;
                }
                job.state = JobState::Queued;
                job.error = None;
                job.viable = false;
                drop(job);
                self.persist(&j)?;
                Ok(serde_json::json!({"id":id}))
            }
            Command::Refresh { id, url, context } => {
                security::validate_url(&url)?;
                security::validate_context(&context)?;
                if self.controls.lock().unwrap().contains_key(&id) {
                    bail!("Pause the download before refreshing its source");
                }
                let j = self.job(&id)?;
                j.lock().unwrap().url = url;
                self.contexts.lock().unwrap().insert(id, context);
                self.persist(&j)?;
                let result = serde_json::to_value(j.lock().unwrap().clone())?;
                Ok(result)
            }
            Command::Remove { id, delete_file } => {
                if self.controls.lock().unwrap().contains_key(&id) {
                    bail!("Stop the download before removing it");
                }
                let j = self.job(&id)?.lock().unwrap().clone();
                if delete_file && j.destination.is_file() {
                    std::fs::remove_file(&j.destination)?;
                }
                let part = transfer::part_path(&j);
                if part.exists() {
                    std::fs::remove_file(part)?;
                }
                self.store.lock().unwrap().remove("job", &id)?;
                self.jobs.lock().unwrap().remove(&id);
                self.contexts.lock().unwrap().remove(&id);
                Ok(serde_json::json!({"id":id}))
            }
            Command::Settings(settings) => {
                if settings.max_jobs == 0
                    || settings.max_jobs > 32
                    || settings.connections == 0
                    || settings.connections > 32
                    || settings.host_connections == 0
                    || settings.host_connections > 64
                    || settings.quota_minutes == 0
                {
                    bail!("Invalid transfer limits");
                }
                if !settings.directory.is_absolute() || !settings.components.is_absolute() {
                    bail!("Directories must be absolute");
                }
                if let Some(proxy) = &settings.proxy {
                    let p = url::Url::parse(proxy)?;
                    if !["http", "https", "socks4", "socks5", "socks5h"].contains(&p.scheme())
                        || p.password().is_some()
                        || !p.username().is_empty()
                    {
                        bail!("Invalid proxy URL; use saved credentials");
                    }
                }
                if !["en", "fr", "es", "de", "ar", "zh-CN"].contains(&settings.locale.as_str()) {
                    bail!("Unsupported language");
                }
                self.store
                    .lock()
                    .unwrap()
                    .put("settings", "main", &settings)?;
                *self.settings.lock().unwrap() = settings;
                Ok(serde_json::to_value(self.snapshot())?)
            }
            Command::Queue(queue) => {
                if queue.id.is_empty() || queue.concurrency == 0 || queue.concurrency > 32 {
                    bail!("Invalid queue");
                }
                for value in [&queue.start_time, &queue.stop_time].into_iter().flatten() {
                    chrono::NaiveTime::parse_from_str(value, "%H:%M")?;
                }
                self.store.lock().unwrap().put("queue", &queue.id, &queue)?;
                let mut queues = self.queues.lock().unwrap();
                if let Some(q) = queues.iter_mut().find(|q| q.id == queue.id) {
                    *q = queue.clone();
                } else {
                    queues.push(queue.clone());
                }
                Ok(serde_json::to_value(queue)?)
            }
            Command::DeleteQueue { id } => {
                if id == "default" {
                    bail!("The main queue cannot be deleted");
                }
                if self.snapshot().jobs.iter().any(|j| j.queue == id) {
                    bail!("Move or remove downloads before deleting the queue");
                }
                self.store.lock().unwrap().remove("queue", &id)?;
                self.queues.lock().unwrap().retain(|q| q.id != id);
                Ok(serde_json::Value::Null)
            }
            Command::Inspect { url, context } => Ok(serde_json::to_value(transfer::inspect(
                &url,
                &context,
                &self.settings.lock().unwrap().clone(),
            )?)?),
            Command::InspectMedia { url, context } => {
                media::inspect(&url, &context, &self.settings.lock().unwrap().clone())
            }
            Command::ZipPreview { url, context } => {
                archive::preview(&url, &context, &self.settings.lock().unwrap().clone())
            }
            Command::Grabber(project) => {
                security::validate_url(&project.url)?;
                if project.depth > 20
                    || project.max_pages == 0
                    || project.max_pages > 10000
                    || !project.directory.is_absolute()
                {
                    bail!("Invalid grabber bounds or directory");
                }
                self.store
                    .lock()
                    .unwrap()
                    .put("grabber", &project.id, &project)?;
                Ok(serde_json::to_value(project)?)
            }
            Command::GrabberList => Ok(serde_json::to_value(
                self.store
                    .lock()
                    .unwrap()
                    .all::<GrabberProject>("grabber")?,
            )?),
            Command::GrabberRun { id } => {
                let p = self
                    .store
                    .lock()
                    .unwrap()
                    .all::<GrabberProject>("grabber")?
                    .into_iter()
                    .find(|p| p.id == id)
                    .context("Unknown grabber project")?;
                let engine = self.clone();
                std::thread::spawn(move || {
                    if let Err(e) = grabber::run(p, &engine) {
                        eprintln!("Grabber: {}", security::redact(&e.to_string()));
                    }
                });
                Ok(serde_json::json!({"id":id}))
            }
            Command::GrabberDownload { id, urls } => grabber::download(self, &id, &urls),
            Command::Export => Ok(
                serde_json::json!({"version":1,"jobs":self.snapshot().jobs.iter().map(|j|serde_json::json!({"request_id":uuid::Uuid::new_v4().to_string(),"url":j.url,"filename":j.filename,"directory":j.destination.parent(),"queue":"default","checksum":j.checksum,"paused":true,"media":j.media,"description":j.description})).collect::<Vec<_>>()}),
            ),
            Command::Import { jobs } => {
                if jobs.len() > 10000 {
                    bail!("Import limited to 10,000 jobs");
                }
                let mut added = vec![];
                for j in jobs {
                    added.push(self.add(j)?);
                }
                Ok(serde_json::to_value(added)?)
            }
            Command::Credential {
                id,
                username,
                password,
            } => {
                security::save_credential(&id, &username, &password)?;
                Ok(serde_json::json!({"id":id}))
            }
            Command::Diagnostics => {
                let s = self.snapshot();
                Ok(
                    serde_json::json!({"version":env!("CARGO_PKG_VERSION"),"protocol":PROTOCOL_VERSION,"platform":std::env::consts::OS,"curl":curl::Version::get().version(),"http2":curl::Version::get().feature_http2(),"components":s.components,"jobs":s.jobs.iter().map(|j|serde_json::json!({"id":j.id,"state":j.state,"bytes":j.bytes,"error":j.error.as_ref().map(|e|security::redact(e))})).collect::<Vec<_>>()}),
                )
            }
            Command::Quit => {
                self.shutdown();
                Ok(serde_json::Value::Null)
            }
        }
    }
    fn tick(self: &Arc<Self>) -> Result<()> {
        let settings = self.settings.lock().unwrap().clone();
        let snapshot = self.snapshot();
        let active = self.controls.lock().unwrap().len();
        let quota = self.store.lock().unwrap().usage(settings.quota_minutes)?;
        if settings.quota_bytes > 0 && quota >= settings.quota_bytes {
            for control in self.controls.lock().unwrap().values() {
                control.store(3, Ordering::Relaxed);
            }
            for job in snapshot.jobs.iter().filter(|j| j.state == JobState::Queued) {
                let shared = self.job(&job.id)?;
                shared.lock().unwrap().state = JobState::WaitingQuota;
                self.persist(&shared)?;
            }
            return Ok(());
        }
        let now = chrono::Local::now().time();
        let utc = chrono::Utc::now();
        for queue in &snapshot.queues {
            if !queue.enabled {
                continue;
            }
            let start = queue
                .start_time
                .as_ref()
                .and_then(|s| chrono::NaiveTime::parse_from_str(s, "%H:%M").ok());
            let stop = queue
                .stop_time
                .as_ref()
                .and_then(|s| chrono::NaiveTime::parse_from_str(s, "%H:%M").ok());
            let in_window = match (start, stop) {
                (Some(a), Some(b)) if a > b => now >= a || now < b,
                (a, b) => a.is_none_or(|a| now >= a) && b.is_none_or(|b| now < b),
            };
            if !in_window {
                for j in snapshot
                    .jobs
                    .iter()
                    .filter(|j| j.queue == queue.id && j.state.active())
                {
                    if let Some(c) = self.controls.lock().unwrap().get(&j.id) {
                        c.store(4, Ordering::Relaxed);
                    }
                }
                continue;
            }
            if queue.synchronize && queue.next_run.is_some_and(|t| utc >= t) {
                for old in snapshot
                    .jobs
                    .iter()
                    .filter(|j| j.queue == queue.id && j.state == JobState::Complete)
                {
                    let context = self
                        .contexts
                        .lock()
                        .unwrap()
                        .get(&old.id)
                        .cloned()
                        .unwrap_or_default();
                    if let Ok(meta) = transfer::inspect(&old.url, &context, &settings) {
                        if meta.etag != old.etag
                            || meta.modified != old.modified
                            || meta.total != old.total
                        {
                            let _ = self.add(AddJob {
                                request_id: uuid::Uuid::new_v4().to_string(),
                                url: old.url.clone(),
                                filename: Some(old.filename.clone()),
                                directory: old.destination.parent().map(Path::to_path_buf),
                                queue: Some(queue.id.clone()),
                                checksum: None,
                                paused: false,
                                context,
                                media: old.media.clone(),
                                description: old.description.clone(),
                            });
                        }
                    }
                }
            }
            if let Some(minutes) = queue
                .interval_minutes
                .filter(|_| queue.next_run.is_none_or(|t| utc >= t))
            {
                let mut q = queue.clone();
                q.next_run = Some(utc + chrono::Duration::minutes(minutes.clamp(1, 525600) as i64));
                self.command(Command::Queue(q))?;
            }
            let mut candidates: Vec<_> = snapshot
                .jobs
                .iter()
                .filter(|j| {
                    j.queue == queue.id
                        && matches!(
                            j.state,
                            JobState::Queued | JobState::WaitingQuota | JobState::WaitingSchedule
                        )
                })
                .collect();
            candidates.sort_by_key(|j| {
                (
                    queue
                        .order
                        .iter()
                        .position(|id| id == &j.id)
                        .unwrap_or(usize::MAX),
                    j.created,
                )
            });
            let mut queue_active = snapshot
                .jobs
                .iter()
                .filter(|j| j.queue == queue.id && j.state.active())
                .count();
            for candidate in candidates {
                if self.controls.lock().unwrap().len() >= settings.max_jobs
                    || queue_active >= queue.concurrency
                {
                    break;
                }
                let host = url::Url::parse(&candidate.url)?
                    .host_str()
                    .unwrap_or("")
                    .to_string();
                let host_active = self
                    .snapshot()
                    .jobs
                    .iter()
                    .filter(|j| {
                        j.state.active()
                            && url::Url::parse(&j.url)
                                .ok()
                                .and_then(|u| u.host_str().map(str::to_owned))
                                == Some(host.clone())
                    })
                    .count();
                if host_active * settings.connections >= settings.host_connections {
                    continue;
                }
                let j = self.job(&candidate.id)?;
                let control = Arc::new(AtomicU8::new(0));
                self.controls
                    .lock()
                    .unwrap()
                    .insert(candidate.id.clone(), control.clone());
                j.lock().unwrap().state = JobState::Connecting;
                self.persist(&j)?;
                let context = self
                    .contexts
                    .lock()
                    .unwrap()
                    .get(&candidate.id)
                    .cloned()
                    .unwrap_or_default();
                let engine = self.clone();
                let mut limits = settings.clone();
                limits.connections = limits
                    .connections
                    .min(
                        limits
                            .host_connections
                            .saturating_sub(host_active * limits.connections),
                    )
                    .max(1);
                let rate = if settings.speed_limit > 0 {
                    settings.speed_limit / settings.max_jobs as u64
                } else {
                    0
                };
                queue_active += 1;
                std::thread::spawn(move || {
                    let is_media = j.lock().unwrap().media.is_some();
                    let result = if is_media {
                        media::run(
                            j.clone(),
                            engine.store.clone(),
                            limits,
                            context,
                            control.clone(),
                            rate,
                        )
                    } else {
                        transfer::run(
                            j.clone(),
                            engine.store.clone(),
                            limits,
                            context,
                            control.clone(),
                            rate,
                        )
                    };
                    let mut controls = engine.controls.lock().unwrap();
                    {
                        let mut job = j.lock().unwrap();
                        job.speed = 0;
                        if let Err(e) = result {
                            let message = security::redact(&e.to_string());
                            job.state = if message.contains("authentication_required")
                                || message.contains("HTTP 401")
                            {
                                JobState::WaitingAuthentication
                            } else if message.contains("source_changed")
                                || message.contains("HTTP 403")
                            {
                                JobState::WaitingSource
                            } else {
                                JobState::Failed
                            };
                            job.error = Some(message);
                        } else if control.load(Ordering::Relaxed) != 0 {
                            job.state = match control.load(Ordering::Relaxed) {
                                2 => JobState::Cancelled,
                                3 => JobState::WaitingQuota,
                                4 => JobState::WaitingSchedule,
                                _ => JobState::Paused,
                            };
                        }
                    }
                    let _ = engine.persist(&j);
                    let id = j.lock().unwrap().id.clone();
                    controls.remove(&id);
                });
            }
        }
        let _ = active;
        self.sequence.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }
    pub fn shutdown(&self) {
        self.stopping.store(true, Ordering::Relaxed);
        for c in self.controls.lock().unwrap().values() {
            c.store(1, Ordering::Relaxed);
        }
        for _ in 0..100 {
            if self.controls.lock().unwrap().is_empty() {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(directory: &Path) -> AddJob {
        AddJob {
            request_id: "same-request".into(),
            url: "https://example.com/file.zip".into(),
            filename: None,
            directory: Some(directory.into()),
            queue: None,
            checksum: None,
            paused: true,
            context: RequestContext::default(),
            media: None,
            description: String::new(),
        }
    }
    #[test]
    fn duplicate_request_is_one_durable_job() {
        let dir = tempfile::tempdir().unwrap();
        let e = Engine::open(dir.path()).unwrap();
        let a = e.add(request(dir.path())).unwrap();
        let b = e.add(request(dir.path())).unwrap();
        assert_eq!(a.id, b.id);
        drop(e);
        let e = Engine::open(dir.path()).unwrap();
        assert_eq!(e.snapshot().jobs.len(), 1);
    }
    #[test]
    fn distinct_jobs_reserve_distinct_filenames() {
        let dir = tempfile::tempdir().unwrap();
        let e = Engine::open(dir.path()).unwrap();
        let a = e.add(request(dir.path())).unwrap();
        let mut r = request(dir.path());
        r.request_id = "other".into();
        let b = e.add(r).unwrap();
        assert_ne!(a.destination, b.destination);
    }
}
