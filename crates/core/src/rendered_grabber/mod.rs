use crate::{model::GrabberProject, navigation::SessionScope};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Page {
    pub url: String,
    pub depth: usize,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resource {
    pub url: String,
    pub page_url: String,
    pub name: String,
    pub size: Option<u64>,
    pub content_type: String,
    pub order: usize,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Discovery {
    #[serde(default)]
    pub private: bool,
    pub project: GrabberProject,
    pub scope: Option<SessionScope>,
    pub generation: u64,
    pub pending: Vec<Page>,
    pub visited: Vec<String>,
    pub resources: Vec<Resource>,
    pub lease: Option<Page>,
    pub status: String,
    pub bytes: u64,
    pub started_ms: i64,
    pub max_bytes: u64,
    pub max_time_ms: i64,
    pub permitted_origins: Vec<String>,
    #[serde(default)]
    pub selected: Vec<String>,
    #[serde(default)]
    pub reports: std::collections::BTreeMap<String, String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Link {
    pub url: String,
    pub resource: bool,
    pub name: String,
    pub size: Option<u64>,
    pub content_type: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageResult {
    pub id: String,
    pub scope: SessionScope,
    pub generation: u64,
    pub page_url: String,
    pub final_url: String,
    pub bytes: u64,
    pub links: Vec<Link>,
    pub reason: Option<String>,
}
impl Discovery {
    pub fn new(project: GrabberProject) -> Result<Self> {
        let url = canonical(&project.url)?;
        if project.max_pages == 0 || project.max_pages > 10000 || project.depth > 20 {
            bail!("Invalid discovery bounds");
        }
        Ok(Self {
            private: project.private,
            pending: vec![Page { url, depth: 0 }],
            project,
            scope: None,
            generation: 1,
            visited: vec![],
            resources: vec![],
            lease: None,
            status: "waiting_browser".into(),
            bytes: 0,
            started_ms: 0,
            max_bytes: 64 * 1024 * 1024,
            max_time_ms: 600000,
            permitted_origins: vec![],
            selected: vec![],
            reports: Default::default(),
        })
    }
    pub fn authorize(&self, scope: &SessionScope, generation: u64) -> Result<()> {
        scope.validate()?;
        if self.scope.as_ref() != Some(scope) || self.generation != generation {
            bail!("Stale discovery session or generation");
        }
        Ok(())
    }
    pub fn claim(&mut self, scope: SessionScope, now: i64) -> Result<()> {
        scope.validate()?;
        if scope.private != self.private {
            bail!("Discovery private lane mismatch");
        }
        if self.status == "cancelled" {
            bail!("Discovery cancelled");
        }
        if let Some(old) = &self.scope {
            if old != &scope {
                bail!("Discovery belongs to another browser session");
            }
        }
        if self.started_ms == 0 {
            self.started_ms = now;
        }
        self.scope = Some(scope);
        self.status = "exploring".into();
        Ok(())
    }
    pub fn next(&mut self, now: i64) -> Result<Option<Page>> {
        if self.status != "exploring" {
            return Ok(None);
        }
        if now - self.started_ms > self.max_time_ms
            || self.bytes >= self.max_bytes
            || self.visited.len() >= self.project.max_pages
        {
            self.status = "limit_reached".into();
            return Ok(None);
        }
        if self.lease.is_none() {
            self.lease = self.pending.first().cloned();
        }
        if self.lease.is_none() {
            self.status = "ready".into();
        }
        Ok(self.lease.clone())
    }
    pub fn permitted(&self, text: &str) -> bool {
        let Ok(url) = url::Url::parse(text) else {
            return false;
        };
        let Ok(base) = url::Url::parse(&self.project.url) else {
            return false;
        };
        url.origin() == base.origin()
            || (!self.project.same_domain
                && self
                    .permitted_origins
                    .contains(&url.origin().ascii_serialization()))
    }
    pub fn report(&mut self, report: PageResult, now: i64) -> Result<()> {
        self.authorize(&report.scope, report.generation)?;
        let page_url = canonical(&report.page_url)?;
        use sha2::{Digest, Sha256};
        let fingerprint = format!("{:x}", Sha256::digest(serde_json::to_vec(&report)?));
        if let Some(previous) = self.reports.get(&page_url) {
            if previous == &fingerprint {
                return Ok(());
            }
            bail!("Conflicting duplicate page report");
        }
        if self.status != "exploring" {
            bail!("Discovery is not active");
        }
        let page = self
            .lease
            .as_ref()
            .context("Missing discovery lease")?
            .clone();
        if page.url != page_url {
            bail!("Wrong discovery page");
        }
        let final_url = canonical(&report.final_url)?;
        if !self.permitted(&final_url) {
            bail!("Redirect origin is not permitted");
        }
        if report.links.len() > 2000
            || report.bytes > 8 * 1024 * 1024
            || self.bytes.saturating_add(report.bytes) > self.max_bytes
            || now - self.started_ms > self.max_time_ms
        {
            bail!("Discovery result exceeds bounds");
        }
        if let Some(reason) = report.reason {
            if ![
                "authentication_required",
                "tab_closed",
                "waiting_browser",
                "render_timeout",
            ]
            .contains(&reason.as_str())
            {
                bail!("Invalid discovery reason");
            }
            self.status = reason;
            self.lease = None;
            return Ok(());
        }
        let mut known: BTreeSet<String> = self
            .pending
            .iter()
            .map(|p| p.url.clone())
            .chain(self.visited.iter().cloned())
            .collect();
        let mut resources: BTreeSet<String> =
            self.resources.iter().map(|r| r.url.clone()).collect();
        for link in report.links {
            let Ok(text) = canonical(&link.url) else {
                continue;
            };
            if !self.permitted(&text) || matches_filter(&self.project.exclude, &text) {
                continue;
            }
            if link.resource {
                if (!self.project.include.is_empty()
                    && !matches_filter(&self.project.include, &text))
                    || link.size.is_some_and(|size| {
                        size < self.project.min_size
                            || self.project.max_size.is_some_and(|max| size > max)
                    })
                    || !resources.insert(text.clone())
                {
                    continue;
                }
                if self.resources.len() >= 10000 {
                    break;
                }
                self.resources.push(Resource {
                    url: text,
                    page_url: final_url.clone(),
                    name: crate::security::safe_filename(&link.name),
                    size: link.size,
                    content_type: link.content_type.chars().take(128).collect(),
                    order: self.resources.len(),
                });
            } else if page.depth < self.project.depth
                && known.insert(text.clone())
                && self.pending.len() + self.visited.len() < self.project.max_pages
            {
                self.pending.push(Page {
                    url: text,
                    depth: page.depth + 1,
                });
            }
        }
        self.reports.insert(page_url, fingerprint);
        self.bytes += report.bytes;
        self.visited.push(page.url.clone());
        self.pending.retain(|p| p.url != page.url);
        self.lease = None;
        if self.pending.is_empty() {
            self.status = "ready".into();
        }
        Ok(())
    }
    pub fn control(&mut self, action: &str) -> Result<()> {
        match action {
            "cancel" => {
                self.status = "cancelled".into();
                self.selected.clear();
                self.generation += 1;
                self.lease = None;
            }
            "resume" => {
                if self.status == "cancelled" {
                    bail!("Cancelled discovery cannot resume");
                }
                self.status = if self.scope.is_some() {
                    "exploring"
                } else {
                    "waiting_browser"
                }
                .into();
                self.lease = None;
            }
            _ => bail!("Invalid discovery control"),
        };
        Ok(())
    }
}
fn matches_filter(filter: &str, text: &str) -> bool {
    !filter.is_empty()
        && filter.split(',').filter(|s| !s.trim().is_empty()).any(|s| {
            regex::Regex::new(&format!(
                "(?i){}$",
                regex::escape(s.trim())
                    .replace("\\*", ".*")
                    .replace("\\?", ".")
            ))
            .is_ok_and(|r| r.is_match(text))
        })
}
fn canonical(text: &str) -> Result<String> {
    let mut url = crate::security::validate_url(text)?;
    url.set_fragment(None);
    Ok(url.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claim {
    pub id: String,
    pub scope: SessionScope,
    pub generation: u64,
    pub tab_id: Option<i64>,
    #[serde(default)]
    pub permitted_origins: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Status {
    pub id: String,
    pub scope: SessionScope,
    pub generation: u64,
    pub action: String,
}
pub(crate) fn load(store: &crate::store::Store, id: &str) -> Result<Discovery> {
    store
        .all::<Discovery>("rendered_discovery")?
        .into_iter()
        .find(|d| d.project.id == id)
        .context("Unknown rendered project")
}
pub fn start(engine: &crate::Engine, project: GrabberProject) -> Result<()> {
    let _operation = engine.discovery_operations.lock().unwrap();
    let store = engine.store.lock().unwrap();
    let mut state = if let Ok(state) = load(&store, &project.id) {
        state
    } else {
        Discovery::new(project)?
    };
    state.control("resume")?;
    store.put("rendered_discovery", &state.project.id, &state)
}
pub fn list(engine: &crate::Engine, scope: &SessionScope) -> Result<serde_json::Value> {
    scope.validate()?;
    let store = engine.store.lock().unwrap();
    let states:Vec<_>=store.all::<Discovery>("rendered_discovery")?.into_iter().filter(|d|d.private == scope.private && d.scope.as_ref().is_none_or(|s|s==scope) && !["ready","cancelled"].contains(&d.status.as_str())).map(|d|serde_json::json!({"id":d.project.id,"url":d.project.url,"generation":d.generation,"status":d.status})).collect();
    Ok(serde_json::to_value(states)?)
}
pub fn claim(engine: &crate::Engine, request: Claim) -> Result<serde_json::Value> {
    let _operation = engine.discovery_operations.lock().unwrap();
    let now = chrono::Utc::now().timestamp_millis();
    // Same lock order as navigation: scheduler, then store. Both admissions share one budget.
    let mut scheduler = engine.navigation_scheduler.lock().unwrap();
    let store = engine.store.lock().unwrap();
    let mut state = load(&store, &request.id)?;
    if state.generation != request.generation {
        bail!("Stale discovery generation");
    }
    state.claim(request.scope.clone(), now)?;
    for origin in &request.permitted_origins {
        let url = url::Url::parse(origin)?;
        if canonical(origin)? != format!("{}/", url.origin().ascii_serialization()) {
            bail!("Permission must name an HTTP origin");
        }
    }
    state.permitted_origins = request.permitted_origins;
    let id = format!("discovery:{}", request.id);
    if let Some(task) = scheduler.tasks.iter_mut().find(|t| t.id == id) {
        if task.status == crate::navigation_scheduler::QueueStatus::Finished {
            task.status = crate::navigation_scheduler::QueueStatus::Queued;
        }
    }
    scheduler.enqueue(
        id.clone(),
        state.generation,
        request.scope.profile.clone(),
        vec![url::Url::parse(&state.project.url)?
            .host_str()
            .context("Missing host")?
            .to_string()],
    )?;
    let task = scheduler.tasks.iter_mut().find(|t| t.id == id).unwrap();
    task.scope = Some(request.scope.clone());
    task.private = request.scope.private;
    let result = scheduler.apply(
        &request.scope.profile,
        crate::navigation_scheduler::SchedulerRequest::Admit {
            id: id.clone(),
            generation: state.generation,
        },
        now,
    )?;
    let admitted = result
        .tasks
        .iter()
        .any(|t| t.id == id && t.status == crate::navigation_scheduler::QueueStatus::Active);
    if admitted {
        if let Some(tab) = request.tab_id {
            scheduler.apply(
                &request.scope.profile,
                crate::navigation_scheduler::SchedulerRequest::Heartbeat {
                    id,
                    generation: state.generation,
                    tab_id: tab,
                },
                now,
            )?;
        }
    }
    let page = if admitted { state.next(now)? } else { None };
    if admitted && page.is_none() {
        scheduler.apply(
            &request.scope.profile,
            crate::navigation_scheduler::SchedulerRequest::Release {
                id: format!("discovery:{}", request.id),
                generation: state.generation,
            },
            now,
        )?;
    }
    scheduler.persist(&store)?;
    store.put("rendered_discovery", &state.project.id, &state)?;
    Ok(
        serde_json::json!({"page":page,"status":state.status,"generation":state.generation,"admitted":admitted}),
    )
}
pub fn report(engine: &crate::Engine, request: PageResult) -> Result<serde_json::Value> {
    let _operation = engine.discovery_operations.lock().unwrap();
    let mut scheduler = engine.navigation_scheduler.lock().unwrap();
    let store = engine.store.lock().unwrap();
    let mut state = load(&store, &request.id)?;
    state.report(request, chrono::Utc::now().timestamp_millis())?;
    scheduler.apply(
        &state.scope.as_ref().unwrap().profile,
        crate::navigation_scheduler::SchedulerRequest::Release {
            id: format!("discovery:{}", state.project.id),
            generation: state.generation,
        },
        chrono::Utc::now().timestamp_millis(),
    )?;
    scheduler.persist(&store)?;
    store.put("rendered_discovery", &state.project.id, &state)?;
    Ok(serde_json::json!({"status":state.status}))
}
pub fn status(engine: &crate::Engine, request: Status) -> Result<serde_json::Value> {
    let _operation = engine.discovery_operations.lock().unwrap();
    let mut scheduler = engine.navigation_scheduler.lock().unwrap();
    let store = engine.store.lock().unwrap();
    let mut state = load(&store, &request.id)?;
    if !(request.action == "snapshot"
        && state.status == "cancelled"
        && state.scope.as_ref() == Some(&request.scope)
        && request.generation.checked_add(1) == Some(state.generation))
    {
        state.authorize(&request.scope, request.generation)?;
    }
    if request.action != "snapshot" {
        if scheduler
            .tasks
            .iter()
            .any(|t| t.id == format!("discovery:{}", request.id))
        {
            scheduler.apply(
                &request.scope.profile,
                crate::navigation_scheduler::SchedulerRequest::Release {
                    id: format!("discovery:{}", request.id),
                    generation: state.generation,
                },
                chrono::Utc::now().timestamp_millis(),
            )?;
        }
        state.control(&request.action)?;
        scheduler.persist(&store)?;
        store.put("rendered_discovery", &state.project.id, &state)?;
    }
    Ok(serde_json::to_value(state)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn scope() -> SessionScope {
        serde_json::from_value(serde_json::json!({"browser":"chromium","profile":"00000000-0000-0000-0000-000000000001","private":false,"cookie_store_id":"0","container_id":null,"partition_key":null,"claim_generation":1})).unwrap()
    }
    fn state() -> Discovery {
        Discovery::new(serde_json::from_value(serde_json::json!({"id":"project","name":"fixture","url":"http://127.0.0.1:18782/","directory":"C:\\fixture","depth":2,"max_pages":3,"same_domain":true,"include":"*.bin","exclude":"","min_size":0,"max_size":null,"mirror":false,"rendered":true,"next_run":null})).unwrap()).unwrap()
    }
    fn result() -> PageResult {
        PageResult {
            id: "project".into(),
            scope: scope(),
            generation: 1,
            page_url: "http://127.0.0.1:18782/".into(),
            final_url: "http://127.0.0.1:18782/".into(),
            bytes: 10,
            links: vec![
                Link {
                    url: "http://127.0.0.1:18782/file.bin".into(),
                    resource: true,
                    name: "file.bin".into(),
                    size: Some(10),
                    content_type: "application/octet-stream".into(),
                },
                Link {
                    url: "http://127.0.0.1:18782/next".into(),
                    resource: false,
                    name: "next".into(),
                    size: None,
                    content_type: String::new(),
                },
            ],
            reason: None,
        }
    }
    #[test]
    fn persisted_frontier_order_duplicates_and_loops() {
        let mut d = state();
        d.claim(scope(), 100).unwrap();
        d.next(101).unwrap();
        let r = result();
        d.report(r.clone(), 102).unwrap();
        d.report(r, 103).unwrap();
        assert_eq!(d.resources.len(), 1);
        assert_eq!(d.bytes, 10);
        let mut restored: Discovery =
            serde_json::from_str(&serde_json::to_string(&d).unwrap()).unwrap();
        assert_eq!(
            restored.next(105).unwrap().unwrap().url,
            "http://127.0.0.1:18782/next"
        );
        assert_eq!(restored.resources[0].page_url, "http://127.0.0.1:18782/");
    }
    #[test]
    fn stale_scope_and_redirect_cannot_inject() {
        let mut d = state();
        d.claim(scope(), 100).unwrap();
        d.next(101).unwrap();
        let mut r = result();
        r.scope.claim_generation = 2;
        assert!(d.report(r, 102).is_err());
        let mut r = result();
        r.final_url = "https://example.com/".into();
        assert!(d.report(r, 102).is_err());
        assert!(d.resources.is_empty());
    }
    #[test]
    fn cancellation_fences_late_reports() {
        let mut d = state();
        d.claim(scope(), 100).unwrap();
        d.next(101).unwrap();
        d.control("cancel").unwrap();
        assert!(d.report(result(), 102).is_err());
        assert!(d.control("resume").is_err());
    }
    #[test]
    fn authenticated_block_retains_frontier() {
        let mut d = state();
        d.claim(scope(), 100).unwrap();
        d.next(101).unwrap();
        let mut r = result();
        r.reason = Some("authentication_required".into());
        d.report(r, 102).unwrap();
        assert_eq!(d.status, "authentication_required");
        assert!(d.resources.is_empty());
        d.control("resume").unwrap();
        assert!(d.next(103).unwrap().is_some());
    }
    #[test]
    fn byte_limit_rejects_without_partial_checkpoint() {
        let mut d = state();
        d.claim(scope(), 100).unwrap();
        d.next(101).unwrap();
        let mut r = result();
        r.bytes = 9 * 1024 * 1024;
        assert!(d.report(r, 102).is_err());
        assert_eq!(d.bytes, 0);
        assert!(d.visited.is_empty());
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Select {
    pub id: String,
    pub scope: SessionScope,
    pub generation: u64,
    pub urls: Vec<String>,
}
pub fn select(
    engine: &std::sync::Arc<crate::Engine>,
    request: Select,
) -> Result<serde_json::Value> {
    let _operation = engine.discovery_operations.lock().unwrap();
    let state = {
        let store = engine.store.lock().unwrap();
        let state = load(&store, &request.id)?;
        state.authorize(&request.scope, request.generation)?;
        state
    };
    if request.urls.len() > 1000 {
        bail!("Selection exceeds bound");
    }
    let mut ids = vec![];
    for url in request.urls {
        let file = state
            .resources
            .iter()
            .find(|r| r.url == url)
            .context("Resource is not in discovery results")?;
        use sha2::{Digest, Sha256};
        let request_id = format!(
            "discovery-{:x}",
            Sha256::digest(
                format!("{}:{}:{}", state.project.id, state.generation, file.url).as_bytes()
            )
        );
        let context = crate::model::RequestContext {
            profile: Some(request.scope.profile.clone()),
            browser: Some(request.scope.browser.clone()),
            private: request.scope.private,
            ..Default::default()
        };
        let created = engine.command(crate::model::Command::Navigate(crate::model::AddJob {
            request_id,
            url: file.url.clone(),
            filename: Some(file.name.clone()),
            directory: Some(state.project.directory.clone()),
            queue: None,
            checksum: None,
            paused: true,
            context,
            media: None,
            description: format!("Grabber: {}", state.project.name),
        }))?;
        let id = created["id"]
            .as_str()
            .context("Missing navigation job")?
            .to_string();
        let job = engine.job(&id)?;
        {
            let mut job = job.lock().unwrap();
            if job.navigation_scope.is_none() {
                job.navigation_scope = Some(request.scope.clone());
                job.navigation_owner = Some(request.scope.profile.clone());
                job.page_url = Some(file.page_url.clone());
                job.navigation_url = Some(file.page_url.clone());
            }
        }
        let job = job.lock().unwrap().clone();
        engine.store.lock().unwrap().put("job", &id, &job)?;
        ids.push(id);
    }
    {
        let store = engine.store.lock().unwrap();
        let mut current = load(&store, &request.id)?;
        current.authorize(&request.scope, request.generation)?;
        current.selected.clear();
        store.put("rendered_discovery", &request.id, &current)?;
    }
    Ok(serde_json::json!({"jobs":ids}))
}
pub fn projects(engine: &crate::Engine) -> Result<serde_json::Value> {
    let store = engine.store.lock().unwrap();
    let states = store.all::<Discovery>("rendered_discovery")?;
    let mut projects = store.all::<GrabberProject>("grabber")?;
    for project in &mut projects {
        if let Some(state) = states.iter().find(|s| s.project.id == project.id) {
            project.status = state.status.clone();
            project.visited = state.visited.clone();
            project.found = state
                .resources
                .iter()
                .map(|r| crate::model::GrabberFile {
                    url: r.url.clone(),
                    name: r.name.clone(),
                    size: r.size,
                    content_type: r.content_type.clone(),
                })
                .collect();
        }
    }
    Ok(serde_json::to_value(projects)?)
}
pub fn control(engine: &crate::Engine, id: &str, action: &str) -> Result<serde_json::Value> {
    let _operation = engine.discovery_operations.lock().unwrap();
    let mut scheduler = engine.navigation_scheduler.lock().unwrap();
    let store = engine.store.lock().unwrap();
    let mut state = load(&store, id)?;
    if let Some(scope) = &state.scope {
        if scheduler
            .tasks
            .iter()
            .any(|t| t.id == format!("discovery:{id}"))
        {
            scheduler.apply(
                &scope.profile,
                crate::navigation_scheduler::SchedulerRequest::Release {
                    id: format!("discovery:{id}"),
                    generation: state.generation,
                },
                chrono::Utc::now().timestamp_millis(),
            )?;
        }
    }
    state.control(action)?;
    scheduler.persist(&store)?;
    store.put("rendered_discovery", id, &state)?;
    Ok(serde_json::json!({"status":state.status}))
}

pub fn stage_selection(
    engine: &crate::Engine,
    id: &str,
    urls: &[String],
) -> Result<serde_json::Value> {
    let _operation = engine.discovery_operations.lock().unwrap();
    let store = engine.store.lock().unwrap();
    let mut state = load(&store, id)?;
    if state.status == "cancelled" || urls.len() > 1000 {
        bail!("Invalid rendered selection");
    }
    for url in urls {
        if !state.resources.iter().any(|r| &r.url == url) {
            bail!("Resource is not in discovery results");
        }
    }
    state.selected = urls.to_vec();
    store.put("rendered_discovery", id, &state)?;
    Ok(serde_json::json!({"status":"waiting_browser","selected":urls.len()}))
}
