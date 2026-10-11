use crate::{navigation::SessionScope, Engine, JobState};
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AdapterIdentity {
    pub id: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectionRequest {
    pub id: String,
    pub owner: String,
    pub scope: SessionScope,
    pub source_generation: u64,
    pub page: String,
    pub selected_host: Option<String>,
    pub adapter: AdapterIdentity,
}

pub(crate) fn record(engine: &Engine, request: SelectionRequest) -> Result<serde_json::Value> {
    request.scope.validate()?;
    if request.scope.profile != request.owner {
        bail!("Navigation selection owner mismatch");
    }
    let page = crate::security::validate_url(&request.page)?;
    if !["http", "https"].contains(&page.scheme()) {
        bail!("Navigation selection requires an HTTP page");
    }
    let expected_adapter = match page.host_str() {
        Some("g4u.to") => "g4u",
        Some("ddownload.com" | "www.ddownload.com") => "ddownload",
        Some("rapidgator.net" | "www.rapidgator.net") => "rapidgator",
        Some("gofile.io") => "gofile",
        Some("127.0.0.1" | "localhost" | "::1")
            if ["g4u", "ddownload", "rapidgator", "gofile"]
                .iter()
                .any(|provider| {
                    page.path()
                        .starts_with(&format!("/nav-adapters/{provider}/"))
                }) =>
        {
            "local-fixture"
        }
        _ => "generic",
    };
    if request.adapter.version != "1.0.0"
        || (request.adapter.id != expected_adapter && request.adapter.id != "generic")
    {
        bail!("Unsupported navigation adapter identity");
    }
    if request.selected_host.as_deref().is_some_and(|host| {
        !["g4u.to", "ddownload.com", "rapidgator.net", "gofile.io"].contains(&host)
    }) {
        bail!("Unsupported selected download host");
    }
    let shared = engine.job(&request.id)?;
    let mut job = shared.lock().unwrap();
    if job.navigation_owner.as_ref() != Some(&request.owner)
        || job.navigation_scope.as_ref() != Some(&request.scope)
        || job.source_generation != request.source_generation
        || !matches!(
            job.state,
            JobState::WaitingBrowser | JobState::WaitingUser | JobState::WaitingAuthentication
        )
        || job.navigation_url.as_ref().or(job.page_url.as_ref()) != Some(&request.page)
    {
        bail!("Stale navigation selection");
    }
    let mut updated = job.clone();
    // Absence means retain the explicit downstream choice during later provider steps.
    if request.selected_host.is_some() {
        updated.selected_host = request.selected_host;
    }
    updated.navigation_adapter = Some(request.adapter);
    updated.updated = chrono::Utc::now();
    engine
        .store
        .lock()
        .unwrap()
        .put("job", &updated.id, &updated)?;
    *job = updated;
    Ok(serde_json::json!({"selected_host": job.selected_host, "adapter": job.navigation_adapter}))
}
