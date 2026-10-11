use crate::{archive, grabber, media, model::*, security, store::Store, transfer};
use anyhow::{bail, Context, Result};
use std::{
    collections::HashMap,
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU8, Ordering},
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
    pub(crate) controls: Mutex<HashMap<String, Arc<AtomicU8>>>,
    solver_tasks: Mutex<HashMap<String, Arc<AtomicU8>>>,
    pub(crate) browser_stream_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
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
        store.put("settings", "main", &settings)?;
        let mut jobs = HashMap::new();
        for mut job in store.all::<Job>("job")? {
            if job.state == JobState::SolvingChallenge {
                job.state = JobState::WaitingUser;
                job.solver_outcome = Some("solver_interrupted".into());
                job.error = Some("Solver interrupted; continue in the browser or try again".into());
                store.put("job", &job.id, &job)?;
            }
            if matches!(
                job.state,
                JobState::Verifying
                    | JobState::Assembling
                    | JobState::Scanning
                    | JobState::Complete
            ) {
                match crate::finalize::recover(&mut job, &settings) {
                    Ok(()) => {
                        store.put("job", &job.id, &job)?;
                        if job.state == JobState::Complete && transfer::part_path(&job).is_file() {
                            let _ = std::fs::remove_file(transfer::part_path(&job));
                        }
                    }
                    Err(e) => {
                        job.state = JobState::Failed;
                        job.error = Some(security::redact(&e.to_string()));
                        job.failure = Some(crate::failure::TransferFailure::classify(
                            job.error.as_deref().unwrap(),
                        ));
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
        let contexts = jobs
            .iter()
            .filter_map(|(id, job)| {
                let j = job.lock().unwrap();
                if !j.browser_source {
                    Some((
                        id.clone(),
                        RequestContext {
                            credential_id: j.credential_id.clone(),
                            ..Default::default()
                        },
                    ))
                } else {
                    None
                }
            })
            .collect();
        let engine = Arc::new(Self {
            store: Arc::new(Mutex::new(store)),
            jobs: Mutex::new(jobs),
            settings: Mutex::new(settings),
            queues: Mutex::new(queues),
            contexts: Mutex::new(contexts),
            controls: Mutex::new(HashMap::new()),
            solver_tasks: Mutex::new(HashMap::new()),
            browser_stream_locks: Mutex::new(HashMap::new()),
            stopping: AtomicBool::new(false),
        });
        engine.cleanup_solver_sessions();
        Ok(engine)
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
    fn cleanup_solver_sessions(self: &Arc<Self>) {
        let pending: Vec<_> = self
            .jobs
            .lock()
            .unwrap()
            .values()
            .filter_map(|job| {
                let j = job.lock().unwrap();
                (j.state != JobState::SolvingChallenge)
                    .then(|| j.solver_session.clone())
                    .flatten()
                    .map(|session| (job.clone(), session))
            })
            .collect();
        if pending.is_empty() {
            return;
        }
        let mut tasks = self.solver_tasks.lock().unwrap();
        if !tasks.is_empty() {
            return;
        }
        tasks.insert("cleanup".into(), Arc::new(AtomicU8::new(0)));
        drop(tasks);
        let engine = self.clone();
        let settings = self.settings.lock().unwrap().solver.clone();
        std::thread::spawn(move || {
            for (job, session) in pending {
                let cleaned = crate::solver::destroy(&settings, &session).is_ok();
                let mut j = job.lock().unwrap();
                if j.solver_session.as_ref() == Some(&session) {
                    if cleaned {
                        j.solver_session = None;
                    } else {
                        j.solver_outcome = Some("solver_cleanup".into());
                    }
                }
                drop(j);
                let _ = engine.persist(&job);
            }
            engine.solver_tasks.lock().unwrap().remove("cleanup");
        });
    }
    pub fn snapshot(&self) -> Snapshot {
        // Job changes and their events commit in the same SQLite transaction.
        // Reading all records under this lock makes the reconnect cursor coherent.
        let store = self.store.lock().unwrap();
        Self::stored_snapshot(&store)
    }
    fn stored_snapshot(store: &Store) -> Snapshot {
        let mut jobs = store.all::<Job>("job").expect("Read durable jobs");
        jobs.sort_by_key(|j| j.created);
        let settings = store
            .all::<Settings>("settings")
            .expect("Read settings")
            .into_iter()
            .next()
            .unwrap_or_default();
        Snapshot {
            version: PROTOCOL_VERSION,
            sequence: store.sequence().expect("Read event cursor"),
            jobs,
            queues: store.all("queue").expect("Read queues"),
            components: media::components(&settings),
            settings,
        }
    }
    pub fn subscribe(&self, after: Option<u64>, limit: usize) -> Result<EventBatch> {
        if !(1..=1000).contains(&limit) {
            bail!("Event limit must be between 1 and 1000");
        }
        let store = self.store.lock().unwrap();
        if let Some((events, has_more)) =
            after.map(|s| store.replay(s, limit)).transpose()?.flatten()
        {
            let sequence = events
                .last()
                .map(|e| e.sequence)
                .unwrap_or(store.sequence()?);
            return Ok(EventBatch {
                snapshot: None,
                events,
                sequence,
                has_more,
            });
        }
        let snapshot = Self::stored_snapshot(&store);
        Ok(EventBatch {
            sequence: snapshot.sequence,
            snapshot: Some(snapshot),
            events: vec![],
            has_more: false,
        })
    }
    fn persist(&self, job: &transfer::SharedJob) -> Result<()> {
        let job = job.lock().unwrap().clone();
        self.store.lock().unwrap().put("job", &job.id, &job)?;
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
        use sha2::{Digest, Sha256};
        let fingerprint = format!("{:x}", Sha256::digest(serde_json::to_vec(&request)?));
        let mut jobs = self.jobs.lock().unwrap();
        if let Some((id, hash)) = self.store.lock().unwrap().request(&request.request_id)? {
            if hash.is_some_and(|h| h != fingerprint) {
                bail!("request_conflict: Request ID was already used with a different payload");
            }
            return jobs
                .get(&id)
                .map(|j| j.lock().unwrap().clone())
                .context("request_removed: Original job was removed; use a new request ID");
        }
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
            metrics: Default::default(),
            request_fingerprint: Some(fingerprint),
            credential_id: request.context.credential_id.clone(),
            private: request.context.private,
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
            failure: None,
            verified_sha256: None,
            partial_created: false,
            created: chrono::Utc::now(),
            updated: chrono::Utc::now(),
            media: request.media,
            description: request.description,
            browser_source: request.context.browser.is_some(),
            viable: false,
            page_url: None,
            navigation_owner: request.context.profile.clone(),
            navigation_scope: None,
            source_generation: 1,
            replay_decision: None,
            navigation_url: None,
            solver_attempted: false,
            solver_outcome: None,
            solver_session: None,
        };
        self.store.lock().unwrap().put("job", &job.id, &job)?;
        self.contexts
            .lock()
            .unwrap()
            .insert(job.id.clone(), request.context);
        jobs.insert(job.id.clone(), Arc::new(Mutex::new(job.clone())));
        Ok(job)
    }
    fn check_navigation_fence(
        &self,
        job: &Job,
        scope: Option<&crate::navigation::SessionScope>,
        generation: Option<u64>,
    ) -> Result<()> {
        if let Some(expected) = &job.navigation_scope {
            if scope != Some(expected) || generation != Some(job.source_generation) {
                bail!("Stale or missing navigation session fence");
            }
        }
        Ok(())
    }
    pub fn command(self: &Arc<Self>, command: Command) -> Result<serde_json::Value> {
        match command {
            Command::BrowserStream(operation) => Ok(serde_json::to_value(
                crate::browser_stream::operation(self, operation)?,
            )?),
            Command::TestSolver { settings } => {
                let result = crate::solver::test(&settings)?;
                self.cleanup_solver_sessions();
                Ok(result)
            }
            Command::SolveChallenge {
                id,
                owner,
                url,
                automatic,
            } => self.solve_challenge(id, owner, url, automatic),
            Command::Negotiate { minimum, maximum } => {
                if minimum > PROTOCOL_VERSION || maximum < PROTOCOL_VERSION || minimum > maximum {
                    bail!("protocol_mismatch: Supported protocol is 1");
                }
                Ok(
                    serde_json::json!({"selected":PROTOCOL_VERSION,"minimum":1,"maximum":1,"features":["durable_idempotency","sequenced_events","snapshot_first"]}),
                )
            }
            Command::Subscribe {
                after_sequence,
                limit,
            } => Ok(serde_json::to_value(
                self.subscribe(after_sequence, limit)?,
            )?),
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
            Command::ClaimNavigation {
                id,
                owner,
                force,
                scope,
                source_generation: _,
            } => {
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
                    if let Some(mut scope) = scope {
                        scope.validate()?;
                        if scope.profile != owner || scope.private != j.private {
                            bail!("Browser claim scope does not match job");
                        }
                        if j.navigation_scope.as_ref() != Some(&scope) {
                            scope.claim_generation = j
                                .navigation_scope
                                .as_ref()
                                .map_or(1, |old| old.claim_generation.saturating_add(1));
                        }
                        j.navigation_scope = Some(scope);
                    } else if j.navigation_scope.is_some() {
                        bail!("Scoped navigation requires a fenced claim");
                    }
                    j.navigation_owner = Some(owner);
                }
                self.persist(&job)?;
                let claimed = job.lock().unwrap().clone();
                Ok(
                    serde_json::json!({"id":id,"scope":claimed.navigation_scope,"source_generation":claimed.source_generation}),
                )
            }
            Command::Resolve {
                id,
                owner,
                url,
                filename,
                context,
                scope,
                source_generation,
            } => {
                security::validate_url(&url)?;
                security::validate_context(&context)?;
                if self.controls.lock().unwrap().contains_key(&id) {
                    bail!("Download is already running");
                }
                let job = self.job(&id)?;
                {
                    let j = job.lock().unwrap();
                    self.check_navigation_fence(&j, scope.as_ref(), source_generation)?;
                    if j.navigation_scope.is_some()
                        && !j.replay_decision.as_ref().is_some_and(|r| {
                            r.disposition == crate::navigation::ReplayDisposition::Replayable
                                && r.source_generation == j.source_generation
                        })
                    {
                        bail!("Source is not qualified for replay; use direct browser streaming");
                    }
                }
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
                url,
                scope,
                source_generation,
            } => {
                if let Some(ref url) = url {
                    let parsed = security::validate_url(url)?;
                    if !["http", "https"].contains(&parsed.scheme()) {
                        bail!("Navigation requires HTTP or HTTPS");
                    }
                }
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
                let solver_control = self.solver_tasks.lock().unwrap().get(&id).cloned();
                {
                    let mut j = job.lock().unwrap();
                    self.check_navigation_fence(&j, scope.as_ref(), source_generation)?;
                    if j.navigation_owner.as_ref() != Some(&owner) {
                        bail!("Navigation belongs to another browser profile");
                    }
                    if j.state == JobState::SolvingChallenge {
                        if url
                            .as_ref()
                            .is_some_and(|u| j.navigation_url.as_ref() != Some(u))
                        {
                            j.navigation_url = url;
                            j.state = JobState::WaitingUser;
                            j.solver_outcome = Some("solver_stale".into());
                            if let Some(control) = solver_control {
                                control.store(1, Ordering::Relaxed);
                            }
                            drop(j);
                            self.persist(&job)?;
                            return Ok(serde_json::json!({"id":id}));
                        }
                        bail!("Wait for challenge resolution");
                    }
                    if j.page_url.is_none()
                        || j.state.active()
                        || j.state == JobState::Complete
                        || j.state == JobState::Cancelled
                    {
                        bail!("Job is not controlled by browser navigation");
                    }
                    j.state = state;
                    if let Some(url) = url {
                        j.navigation_url = Some(url);
                    }
                    j.error = message
                        .map(|s| security::redact(&s.chars().take(1024).collect::<String>()));
                    j.bytes = bytes;
                    j.total = total;
                }
                self.persist(&job)?;
                Ok(serde_json::json!({"id":id}))
            }
            Command::BrowserSnapshot { owner } => {
                uuid::Uuid::parse_str(&owner)?;
                let mut value = serde_json::to_value(self.snapshot())?;
                if let Some(jobs) = value["jobs"].as_array_mut() {
                    jobs.retain(|j| {
                        j["navigation_owner"] == owner
                            || (j["navigation_owner"].is_null() && j["private"] != true)
                    });
                }
                Ok(value)
            }
            Command::BrowserSubscribe {
                owner,
                after_sequence,
                limit,
            } => {
                uuid::Uuid::parse_str(&owner)?;
                let mut value = serde_json::to_value(self.subscribe(after_sequence, limit)?)?;
                if let Some(jobs) = value["snapshot"]["jobs"].as_array_mut() {
                    jobs.retain(|j| {
                        j["navigation_owner"] == owner
                            || (j["navigation_owner"].is_null() && j["private"] != true)
                    });
                }
                if let Some(events) = value["events"].as_array_mut() {
                    events.retain(|e| {
                        e["job"].is_null()
                            || e["job"]["navigation_owner"] == owner
                            || (e["job"]["navigation_owner"].is_null()
                                && e["job"]["private"] != true)
                    });
                }
                Ok(value)
            }
            Command::Snapshot => Ok(serde_json::to_value(self.snapshot())?),
            Command::Add(add) => Ok(serde_json::to_value(self.add(add)?)?),
            Command::Pause { id } => {
                let j = self.job(&id)?;
                if let Some(c) = self.controls.lock().unwrap().get(&id) {
                    c.store(1, Ordering::Relaxed);
                    // The transfer owns flushing/checkpointing active offsets.
                    return Ok(serde_json::json!({"id":id}));
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
                    return Ok(serde_json::json!({"id":id}));
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
                    job.verified_sha256 = None;
                    job.partial_created = false;
                    job.metrics = Default::default();
                }
                job.state = JobState::Queued;
                job.error = None;
                job.failure = None;
                job.viable = false;
                drop(job);
                self.persist(&j)?;
                Ok(serde_json::json!({"id":id}))
            }
            Command::RefreshBrowser {
                id,
                owner,
                url,
                mut context,
                scope,
                source_generation,
            } => {
                let job = self.job(&id)?.lock().unwrap().clone();
                self.check_navigation_fence(&job, scope.as_ref(), source_generation)?;
                if !job.browser_source || job.navigation_owner.as_deref() != Some(&owner) {
                    bail!("Browser profile cannot refresh this job");
                }
                context.browser = Some("extension".into());
                context.profile = Some(owner);
                self.command(Command::Refresh { id, url, context })
            }
            Command::Refresh { id, url, context } => {
                security::validate_url(&url)?;
                security::validate_context(&context)?;
                if self.controls.lock().unwrap().contains_key(&id) {
                    bail!("Pause the download before refreshing its source");
                }
                let j = self.job(&id)?;
                {
                    let mut job = j.lock().unwrap();
                    if matches!(job.state, JobState::Complete | JobState::Cancelled) {
                        bail!("Finished jobs cannot refresh their source");
                    }
                    job.url = url;
                    job.credential_id = context.credential_id.clone();
                }
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
                settings.network.validate()?;
                settings.solver.validate()?;
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
                let previous = self.settings.lock().unwrap().clone();
                let changed_solver = serde_json::to_value(&previous.solver)?
                    != serde_json::to_value(&settings.solver)?
                    || previous.network.proxy_mode != settings.network.proxy_mode;
                let controls = self.controls.lock().unwrap();
                if changed_solver {
                    for control in self.solver_tasks.lock().unwrap().values() {
                        let _ =
                            control.compare_exchange(0, 5, Ordering::Relaxed, Ordering::Relaxed);
                    }
                }
                self.store
                    .lock()
                    .unwrap()
                    .put("settings", "main", &settings)?;
                *self.settings.lock().unwrap() = settings;
                drop(controls);
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
                    serde_json::json!({"version":env!("CARGO_PKG_VERSION"),"protocol":PROTOCOL_VERSION,"platform":std::env::consts::OS,"curl":curl::Version::get().version(),"http2":curl::Version::get().feature_http2(),"capabilities":crate::network::capabilities(),"connections":crate::pool::diagnostics(),"components":s.components,"jobs":s.jobs.iter().map(|j|serde_json::json!({"id":j.id,"state":j.state,"bytes":j.bytes,"error":j.error.as_ref().map(|e|security::redact(e))})).collect::<Vec<_>>()}),
                )
            }
            Command::Quit => {
                self.shutdown();
                Ok(serde_json::Value::Null)
            }
        }
    }
    fn solve_challenge(
        self: &Arc<Self>,
        id: String,
        owner: Option<String>,
        url: Option<String>,
        automatic: bool,
    ) -> Result<serde_json::Value> {
        let settings = self.settings.lock().unwrap().clone();
        if !settings.solver.enabled {
            bail!("solver_disabled");
        }
        settings.solver.validate()?;
        if settings.network.proxy_mode != crate::network::ProxyMode::Direct {
            bail!("solver_routing");
        }
        let job = self.job(&id)?;
        let control = Arc::new(AtomicU8::new(0));
        let mut controls = self.controls.lock().unwrap();
        let mut tasks = self.solver_tasks.lock().unwrap();
        if !tasks.is_empty() {
            bail!("solver_busy");
        }
        if controls.contains_key(&id) {
            bail!("Wait for active work to stop");
        }
        let (page, profile, session) = {
            let mut j = job.lock().unwrap();
            if j.solver_session.is_some() {
                bail!("solver_cleanup: Test the connection to retry pending session cleanup");
            }
            if !matches!(j.state, JobState::WaitingBrowser | JobState::WaitingUser)
                || j.page_url.is_none()
                || j.private
                || j.credential_id.is_some()
            {
                bail!("Solver requires an ordinary anonymous hosted-page job");
            }
            if owner
                .as_ref()
                .is_some_and(|o| j.navigation_owner.as_ref() != Some(o))
                || automatic && owner.is_none()
            {
                bail!("Navigation belongs to another browser profile");
            }
            if automatic && j.solver_attempted {
                bail!("solver_already_attempted");
            }
            let page = j
                .navigation_url
                .clone()
                .or_else(|| j.page_url.clone())
                .unwrap();
            if url.as_ref().is_some_and(|u| u != &page) {
                bail!("solver_stale");
            }
            let parsed = security::validate_url(&page)?;
            if !["http", "https"].contains(&parsed.scheme()) {
                bail!("solver_source");
            }
            let session = format!("downloader-{}", uuid::Uuid::new_v4());
            j.navigation_url = Some(page.clone());
            j.state = JobState::SolvingChallenge;
            j.solver_attempted = true;
            j.solver_outcome = None;
            j.solver_session = Some(session.clone());
            j.error = None;
            (page, j.navigation_owner.clone(), session)
        };
        controls.insert(id.clone(), control.clone());
        tasks.insert(id.clone(), control.clone());
        drop(tasks);
        drop(controls);
        if let Err(error) = self.persist(&job) {
            self.controls.lock().unwrap().remove(&id);
            self.solver_tasks.lock().unwrap().remove(&id);
            let mut j = job.lock().unwrap();
            j.state = JobState::WaitingUser;
            j.solver_session = None;
            return Err(error);
        }
        let engine = self.clone();
        let accepted = serde_json::json!({"id":id,"accepted":true});
        std::thread::spawn(move || {
            let result =
                crate::solver::resolve(&page, profile.clone(), &settings, &control, &session);
            let cleanup_failed = result
                .as_ref()
                .err()
                .is_some_and(|e| e.to_string() == "solver_cleanup");
            let mut controls = engine.controls.lock().unwrap();
            let mut tasks = engine.solver_tasks.lock().unwrap();
            let mut j = job.lock().unwrap();
            if j.state == JobState::SolvingChallenge
                && j.navigation_owner == profile
                && j.navigation_url.as_ref() == Some(&page)
            {
                match control.load(Ordering::Relaxed) {
                    2 => {
                        j.state = JobState::Cancelled;
                        j.solver_outcome = Some("solver_cancelled".into());
                    }
                    1 | 4 => {
                        j.state = JobState::Paused;
                        j.solver_outcome = Some("solver_interrupted".into());
                    }
                    5 => {
                        j.state = JobState::WaitingUser;
                        j.solver_outcome = Some("solver_interrupted".into());
                    }
                    _ => match result {
                        Ok(resolved) => {
                            if let Some(filename) = resolved.filename {
                                let name = security::safe_filename(&filename);
                                if let Some(directory) = j.destination.parent() {
                                    let destination =
                                        security::unique_destination(directory, &name);
                                    j.filename = destination
                                        .file_name()
                                        .unwrap_or_default()
                                        .to_string_lossy()
                                        .into();
                                    j.destination = destination;
                                }
                            }
                            j.url = resolved.url;
                            j.state = JobState::Queued;
                            j.browser_source = true;
                            j.viable = false;
                            j.solver_outcome = Some("solver_resolved".into());
                            engine
                                .contexts
                                .lock()
                                .unwrap()
                                .insert(id.clone(), resolved.context);
                        }
                        Err(error) => {
                            j.state = JobState::WaitingUser;
                            j.solver_outcome =
                                Some(crate::solver::outcome(&error.to_string()).into());
                            j.error = Some("Challenge resolution stopped; continue in the browser or try again".into());
                        }
                    },
                }
            }
            if !cleanup_failed {
                j.solver_session = None;
            }
            drop(j);
            let _ = engine.persist(&job);
            tasks.remove(&id);
            controls.remove(&id);
        });
        Ok(accepted)
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
                let limits = settings.clone();
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
                    // Failure must not publish in-memory offsets whose fsync or commit failed.
                    let durable = if !is_media && result.is_err() {
                        let id = j.lock().unwrap().id.clone();
                        Some(engine.store.lock().unwrap().get::<Job>("job", &id))
                    } else {
                        None
                    };
                    let allow_persist = durable.as_ref().is_none_or(|r| r.is_ok());
                    let mut controls = engine.controls.lock().unwrap();
                    {
                        let mut job = j.lock().unwrap();
                        if let Some(Ok(durable)) = durable {
                            *job = durable;
                        }
                        job.speed = 0;
                        let result = if control.load(Ordering::Relaxed) != 0
                            && result
                                .as_ref()
                                .is_err_and(|e| e.to_string().contains("operation_cancelled"))
                        {
                            Ok(())
                        } else {
                            result
                        };
                        if let Err(e) = result {
                            let message = security::redact(&e.to_string());
                            let failure = crate::failure::TransferFailure::classify(&message);
                            job.state = match failure.code {
                                crate::failure::FailureCode::AuthenticationRequired => {
                                    JobState::WaitingAuthentication
                                }
                                crate::failure::FailureCode::SourceExpired
                                | crate::failure::FailureCode::SourceChanged
                                | crate::failure::FailureCode::ResumeUnsupported
                                | crate::failure::FailureCode::RangeInvalid => {
                                    JobState::WaitingSource
                                }
                                _ => JobState::Failed,
                            };
                            job.failure = Some(failure);
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
                    if allow_persist {
                        let _ = engine.persist(&j);
                    }
                    let id = j.lock().unwrap().id.clone();
                    if matches!(
                        j.lock().unwrap().state,
                        JobState::Complete | JobState::Cancelled | JobState::Failed
                    ) {
                        engine.contexts.lock().unwrap().remove(&id);
                    }
                    controls.remove(&id);
                });
            }
        }
        let _ = active;
        Ok(())
    }
    pub fn shutdown(&self) {
        self.stopping.store(true, Ordering::Relaxed);
        for c in self.controls.lock().unwrap().values() {
            let _ = c.compare_exchange(0, 1, Ordering::Relaxed, Ordering::Relaxed);
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
    #[test]
    fn durable_event_reconnect_and_request_tombstones() {
        let dir = tempfile::tempdir().unwrap();
        let e = Engine::open(dir.path()).unwrap();
        let first = e.subscribe(None, 10).unwrap();
        assert!(first.snapshot.is_some());
        let j = e.add(request(dir.path())).unwrap();
        let batch = e.subscribe(Some(first.sequence), 10).unwrap();
        assert!(batch
            .events
            .iter()
            .any(|v| matches!(&v.payload,EventPayload::JobLifecycle{job} if job.id==j.id)));
        assert!(batch.snapshot.is_none());
        let mut different = request(dir.path());
        different.url = "https://example.com/other.zip".into();
        assert!(e
            .add(different)
            .unwrap_err()
            .to_string()
            .contains("request_conflict"));
        e.command(Command::Remove {
            id: j.id,
            delete_file: false,
        })
        .unwrap();
        assert!(e
            .add(request(dir.path()))
            .unwrap_err()
            .to_string()
            .contains("request_removed"));
        let last = e.subscribe(Some(batch.sequence), 10).unwrap().sequence;
        drop(e);
        let e = Engine::open(dir.path()).unwrap();
        assert!(e.snapshot().sequence >= last);
        assert!(e.add(request(dir.path())).is_err());
        assert!(e.subscribe(Some(u64::MAX), 10).unwrap().snapshot.is_some());
        assert!(e
            .command(Command::Negotiate {
                minimum: 2,
                maximum: 3
            })
            .is_err());
    }
    #[test]
    fn active_controls_do_not_publish_unflushed_progress() {
        let directory = tempfile::tempdir().unwrap();
        let e = Engine::open(directory.path()).unwrap();
        let j = e.add(request(directory.path())).unwrap();
        e.controls
            .lock()
            .unwrap()
            .insert(j.id.clone(), Arc::new(AtomicU8::new(0)));
        {
            let shared = e.job(&j.id).unwrap();
            let mut job = shared.lock().unwrap();
            job.state = JobState::Downloading;
            job.bytes = 123;
        }
        for command in [
            Command::Pause { id: j.id.clone() },
            Command::Cancel { id: j.id.clone() },
        ] {
            e.command(command).unwrap();
            let durable: Job = e.store.lock().unwrap().get("job", &j.id).unwrap();
            assert_eq!(durable.bytes, 0);
        }
    }
    #[test]
    fn browser_refresh_requires_the_owning_profile() {
        let directory = tempfile::tempdir().unwrap();
        let e = Engine::open(directory.path()).unwrap();
        let owner = uuid::Uuid::new_v4().to_string();
        let mut request = request(directory.path());
        request.context.browser = Some("extension".into());
        request.context.profile = Some(owner.clone());
        let j = e.add(request).unwrap();
        assert!(e
            .command(Command::RefreshBrowser {
                id: j.id.clone(),
                owner: uuid::Uuid::new_v4().to_string(),
                url: "https://example.com/refreshed".into(),
                context: RequestContext::default(),
                scope: None,
                source_generation: None,
            })
            .is_err());
        e.command(Command::RefreshBrowser {
            id: j.id.clone(),
            owner,
            url: "https://example.com/refreshed".into(),
            context: RequestContext::default(),
            scope: None,
            source_generation: None,
        })
        .unwrap();
        let refreshed = e.job(&j.id).unwrap().lock().unwrap().clone();
        assert_eq!(refreshed.url, "https://example.com/refreshed");
        assert_eq!(refreshed.bytes, j.bytes);
        assert_eq!(refreshed.segments.len(), j.segments.len());
    }
}
