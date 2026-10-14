//! Explicit, ephemeral cross-session navigation handoffs.
//!
//! The Engine holds the job/stream lock, freezes its native source/claim fence,
//! clears inherited session material and persists the pending marker before
//! returning a ticket. Browser scope must be observed by the owning worker.
//! This runtime never persists tokens or starts/probes/replays a request.
use crate::{navigation::SessionScope, Engine, Job, JobState};
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fmt,
    sync::Arc,
    time::{Duration, Instant},
};

pub const TICKET_TTL_MS: u64 = 5 * 60 * 1000;
pub const MAX_TICKETS: usize = 128;
const MAX_GENERATION: u64 = 9_007_199_254_740_991;

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum DesktopRequest {
    Prepare {
        id: String,
        expected_scope: SessionScope,
        expected_source_generation: u64,
        consent: bool,
    },
    Cancel {
        id: String,
        expected_scope: SessionScope,
        expected_source_generation: u64,
    },
}
impl fmt::Debug for DesktopRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Prepare { id, consent, .. } => f
                .debug_struct("PrepareTransfer")
                .field("id", id)
                .field("consent", consent)
                .finish_non_exhaustive(),
            Self::Cancel { id, .. } => f
                .debug_struct("CancelTransfer")
                .field("id", id)
                .finish_non_exhaustive(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum BrowserRequest {
    Continue {
        id: String,
        scope: SessionScope,
        source_generation: u64,
        consent: bool,
    },
    Preview {
        token: String,
        recipient_scope: SessionScope,
    },
    Accept {
        token: String,
        recipient_scope: SessionScope,
        consent: bool,
    },
}
impl fmt::Debug for BrowserRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct(match self {
            Self::Preview { .. } => "PreviewTransfer",
            Self::Accept { .. } => "AcceptTransfer",
            Self::Continue { .. } => "ContinueTransferRecovery",
        })
        .field("token", &"[redacted]")
        .finish_non_exhaustive()
    }
}

/// Immutable native authority after prepare has advanced source and claim.
#[derive(Clone, PartialEq, Eq)]
pub struct FrozenFence {
    pub id: String,
    pub owner: String,
    pub scope: SessionScope,
    pub source_generation: u64,
    pub page_url: String,
    pub filename: String,
}
impl fmt::Debug for FrozenFence {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("FrozenFence")
            .field("id", &self.id)
            .field("source_generation", &self.source_generation)
            .field("claim_generation", &self.scope.claim_generation)
            .field("private", &self.scope.private)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Prepared {
    pub token: String,
    pub expires_at_ms: u64,
    pub id: String,
    pub scope: SessionScope,
    pub source_generation: u64,
}
impl fmt::Debug for Prepared {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PreparedTransfer")
            .field("token", &"[redacted]")
            .field("id", &self.id)
            .field("expires_at_ms", &self.expires_at_ms)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Serialize)]
pub struct Preview {
    pub id: String,
    pub filename: String,
    pub page_url: String,
    pub private: bool,
    pub expires_at_ms: u64,
    pub source_generation: u64,
    pub claim_generation: u64,
}
#[derive(Clone, Serialize)]
pub struct Accepted {
    pub id: String,
    pub owner: String,
    pub scope: SessionScope,
    pub source_generation: u64,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryReason {
    Cancelled,
    Expired,
    Interrupted,
    PreparationFailed,
    AcceptanceFailed,
}
#[derive(Debug, Clone)]
pub struct Recovery {
    pub fence: FrozenFence,
    pub reason: RecoveryReason,
}

#[derive(Clone, PartialEq, Eq)]
struct Recipient {
    browser: String,
    profile: String,
    private: bool,
    cookie_store_id: String,
    container_id: Option<String>,
}
impl Recipient {
    fn observed(scope: &SessionScope, private: bool) -> Result<Self> {
        scope
            .validate()
            .map_err(|_| anyhow::anyhow!("transfer_recipient_scope_invalid"))?;
        if scope.private != private {
            bail!("transfer_lane_mismatch");
        }
        let cookie_store_id = scope
            .cookie_store_id
            .clone()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| anyhow::anyhow!("transfer_recipient_scope_invalid"))?;
        Ok(Self {
            browser: scope.browser.clone(),
            profile: scope.profile.clone(),
            private,
            cookie_store_id,
            container_id: scope.container_id.clone(),
        })
    }
}
struct Ticket {
    fence: FrozenFence,
    expires_at_ms: u64,
    recipient: Option<Recipient>,
    created: Instant,
}
#[derive(Default)]
pub struct Runtime {
    tickets: HashMap<String, Ticket>,
    recoveries: HashMap<String, Recovery>,
}
impl fmt::Debug for Runtime {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TransferRuntime")
            .field("entries", &self.tickets.len())
            .field("recoveries", &self.recoveries.len())
            .finish()
    }
}
impl Runtime {
    /// Issue only after eligibility is checked under the native job lock.
    /// Caller must roll back this runtime entry if pending persistence fails.
    pub fn prepare(&mut self, fence: FrozenFence, now_ms: u64) -> Result<Prepared> {
        fence
            .scope
            .validate()
            .map_err(|_| anyhow::anyhow!("transfer_scope_invalid"))?;
        if fence.owner != fence.scope.profile || fence.source_generation == 0 {
            bail!("transfer_scope_invalid");
        }
        source_page(&fence.page_url)?;
        if self.tickets.values().any(|t| t.fence.id == fence.id)
            || self.recoveries.contains_key(&fence.id)
        {
            bail!("transfer_already_pending");
        }
        if self.tickets.len() + self.recoveries.len() >= MAX_TICKETS {
            bail!("transfer_capacity_reached");
        }
        let expires_at_ms = now_ms
            .checked_add(TICKET_TTL_MS)
            .ok_or_else(|| anyhow::anyhow!("transfer_clock_invalid"))?;
        let token = uuid::Uuid::new_v4().to_string();
        let result = Prepared {
            token: token.clone(),
            expires_at_ms,
            id: fence.id.clone(),
            scope: fence.scope.clone(),
            source_generation: fence.source_generation,
        };
        self.tickets.insert(
            token,
            Ticket {
                fence,
                expires_at_ms,
                recipient: None,
                created: Instant::now(),
            },
        );
        Ok(result)
    }
    /// Used internally before locking and validating the persisted pending job.
    pub fn fence(&self, token: &str, now_ms: u64) -> Result<FrozenFence> {
        Ok(self.available(token, now_ms)?.fence.clone())
    }
    pub fn preview(
        &mut self,
        token: &str,
        recipient_scope: &SessionScope,
        now_ms: u64,
    ) -> Result<Preview> {
        let private = self.available(token, now_ms)?.fence.scope.private;
        let recipient = Recipient::observed(recipient_scope, private)?;
        let ticket = self.tickets.get_mut(token).expect("validated ticket");
        if ticket
            .recipient
            .as_ref()
            .is_some_and(|first| first != &recipient)
        {
            bail!("transfer_recipient_mismatch");
        }
        ticket.recipient = Some(recipient);
        Ok(Preview {
            id: ticket.fence.id.clone(),
            filename: ticket.fence.filename.clone(),
            page_url: ticket.fence.page_url.clone(),
            private,
            expires_at_ms: ticket.expires_at_ms,
            source_generation: ticket.fence.source_generation,
            claim_generation: ticket.fence.scope.claim_generation,
        })
    }
    /// Engine validates `fence()` against the frozen job while holding its lock,
    /// then consumes the ticket and atomically applies this new native authority.
    pub fn accept(
        &mut self,
        token: &str,
        recipient_scope: &SessionScope,
        consent: bool,
        now_ms: u64,
    ) -> Result<Accepted> {
        if !consent {
            bail!("transfer_consent_required");
        }
        let ticket = self.available(token, now_ms)?;
        let recipient = Recipient::observed(recipient_scope, ticket.fence.scope.private)?;
        let first = ticket
            .recipient
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("transfer_preview_required"))?;
        if first != &recipient {
            bail!("transfer_recipient_mismatch");
        }
        let mut scope = recipient_scope.clone();
        scope.claim_generation = advance(ticket.fence.scope.claim_generation)?;
        // Partition is the newly observed HTTP tab's value, never the old scope's
        // partition or an invented default. Null is valid when actually observed.
        let accepted = Accepted {
            id: ticket.fence.id.clone(),
            owner: scope.profile.clone(),
            scope,
            source_generation: ticket.fence.source_generation,
        };
        self.tickets.remove(token);
        Ok(accepted)
    }
    pub fn cancel(&mut self, fence: &FrozenFence) -> Result<Recovery> {
        let token = self
            .tickets
            .iter()
            .find_map(|(token, ticket)| (ticket.fence == *fence).then(|| token.clone()))
            .ok_or_else(|| anyhow::anyhow!("transfer_ticket_unavailable"))?;
        let ticket = self.tickets.remove(&token).expect("matched ticket");
        let recovery = Recovery {
            fence: ticket.fence,
            reason: RecoveryReason::Cancelled,
        };
        self.queue_recovery(recovery.clone());
        Ok(recovery)
    }
    /// Remove expired entries only together with their manual recovery records.
    /// Run on tick/prepare/preview/accept; never silently drop pending jobs.
    pub fn expire(&mut self, now_ms: u64) -> Vec<Recovery> {
        self.expire_at(now_ms, Instant::now())
    }
    fn expire_at(&mut self, now_ms: u64, monotonic_now: Instant) -> Vec<Recovery> {
        let expired = self
            .tickets
            .iter()
            .filter(|(_, ticket)| {
                now_ms >= ticket.expires_at_ms
                    || monotonic_now.saturating_duration_since(ticket.created)
                        >= Duration::from_millis(TICKET_TTL_MS)
            })
            .map(|(token, _)| token.clone())
            .collect::<Vec<_>>();
        let recoveries = expired
            .into_iter()
            .map(|token| Recovery {
                fence: self.tickets.remove(&token).expect("expired ticket").fence,
                reason: RecoveryReason::Expired,
            })
            .collect::<Vec<_>>();
        for recovery in &recoveries {
            self.queue_recovery(recovery.clone());
        }
        recoveries
    }
    fn queue_recovery(&mut self, recovery: Recovery) {
        // Every queued failure consumes a released ticket slot. Continues do not
        // create tickets and restore their already-persisted manual gate on failure.
        self.recoveries.insert(recovery.fence.id.clone(), recovery);
    }
    fn acknowledge_recovery(&mut self, fence: &FrozenFence) {
        if self
            .recoveries
            .get(&fence.id)
            .is_some_and(|pending| pending.fence == *fence)
        {
            self.recoveries.remove(&fence.id);
        }
    }
    pub fn pending(&self, id: &str) -> Option<FrozenFence> {
        self.tickets
            .values()
            .find(|ticket| ticket.fence.id == id)
            .map(|ticket| ticket.fence.clone())
    }
    pub fn len(&self) -> usize {
        self.tickets.len()
    }
    pub fn is_empty(&self) -> bool {
        self.tickets.is_empty()
    }
    fn available(&self, token: &str, now_ms: u64) -> Result<&Ticket> {
        self.available_at(token, now_ms, Instant::now())
    }
    fn available_at(&self, token: &str, now_ms: u64, monotonic_now: Instant) -> Result<&Ticket> {
        if token.len() != 36 || uuid::Uuid::parse_str(token).is_err() {
            bail!("transfer_ticket_unavailable");
        }
        let ticket = self
            .tickets
            .get(token)
            .filter(|ticket| {
                now_ms < ticket.expires_at_ms
                    && monotonic_now.saturating_duration_since(ticket.created)
                        < Duration::from_millis(TICKET_TTL_MS)
            })
            .ok_or_else(|| anyhow::anyhow!("transfer_ticket_unavailable"))?;
        Ok(ticket)
    }
}

/// Validate desktop consent and the exact rendered source before any mutation.
/// Returns the advanced fence; the Engine must install it and clear all inherited
/// contexts/account associations/grants/credentials/replay/solver material.
pub fn prepare_fence(
    job: &Job,
    pending: bool,
    expected_scope: &SessionScope,
    expected_source_generation: u64,
    consent: bool,
) -> Result<FrozenFence> {
    if !consent {
        bail!("transfer_consent_required");
    }
    if pending {
        bail!("transfer_already_pending");
    }
    if !job.browser_source || !matches!(job.state, JobState::WaitingBrowser | JobState::WaitingUser)
    {
        bail!("transfer_job_not_waiting");
    }
    // Progress from another session cannot be silently inherited or discarded.
    if job.bytes != 0 || job.partial_created || job.segments.iter().any(|s| s.downloaded != 0) {
        bail!("transfer_partial_data_requires_recovery");
    }
    let scope = job
        .navigation_scope
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("transfer_scope_invalid"))?;
    scope
        .validate()
        .map_err(|_| anyhow::anyhow!("transfer_scope_invalid"))?;
    if scope != expected_scope
        || job.source_generation != expected_source_generation
        || job.navigation_owner.as_deref() != Some(&scope.profile)
        || job.private != scope.private
    {
        bail!("transfer_scope_stale");
    }
    let page_url = job
        .page_url
        .clone()
        .ok_or_else(|| anyhow::anyhow!("transfer_provenance_unavailable"))?;
    source_page(&page_url)?;
    let mut frozen = scope.clone();
    frozen.claim_generation = advance(scope.claim_generation)?;
    Ok(FrozenFence {
        id: job.id.clone(),
        owner: scope.profile.clone(),
        scope: frozen,
        source_generation: advance(job.source_generation)?,
        page_url,
        filename: job.filename.clone(),
    })
}
/// Validate the persisted job before preview disclosure, accept or cancel.
pub fn validate_frozen(job: &Job, pending: bool, fence: &FrozenFence) -> Result<()> {
    if !pending
        || job.id != fence.id
        || job.navigation_owner.as_deref() != Some(&fence.owner)
        || job.navigation_scope.as_ref() != Some(&fence.scope)
        || job.source_generation != fence.source_generation
        || job.private != fence.scope.private
        || job.page_url.as_deref() != Some(&fence.page_url)
        || !matches!(job.state, JobState::WaitingBrowser | JobState::WaitingUser)
    {
        bail!("transfer_scope_stale");
    }
    Ok(())
}
fn advance(generation: u64) -> Result<u64> {
    if generation == 0 || generation >= MAX_GENERATION {
        bail!("transfer_generation_exhausted");
    }
    Ok(generation + 1)
}
fn source_page(value: &str) -> Result<()> {
    let page =
        url::Url::parse(value).map_err(|_| anyhow::anyhow!("transfer_provenance_unavailable"))?;
    if value.len() > 16 * 1024
        || value.contains(['\0', '\r', '\n'])
        || !matches!(page.scheme(), "http" | "https")
        || page.host_str().is_none()
        || !page.username().is_empty()
        || page.password().is_some()
    {
        bail!("transfer_provenance_unavailable");
    }
    Ok(())
}

pub fn desktop(engine: &Arc<Engine>, request: DesktopRequest) -> Result<serde_json::Value> {
    sweep(engine)?;
    match request {
        DesktopRequest::Prepare {
            id,
            expected_scope,
            expected_source_generation,
            consent,
        } => {
            let controls = engine.controls.lock().unwrap();
            let solver_tasks = engine.solver_tasks.lock().unwrap();
            if controls.contains_key(&id) || solver_tasks.contains_key(&id) {
                bail!("transfer_job_not_waiting");
            }
            let shared = engine.job(&id)?;
            let mut job = shared.lock().unwrap();
            let fence = prepare_fence(
                &job,
                job.navigation_transfer_pending,
                &expected_scope,
                expected_source_generation,
                consent,
            )?;
            if job.solver_session.is_some() {
                bail!("transfer_solver_cleanup_required");
            }
            let prepared = engine
                .navigation_transfer
                .lock()
                .unwrap()
                .prepare(fence.clone(), now_ms()?)?;
            clear_inherited_job(&mut job);
            job.source_generation = fence.source_generation;
            job.navigation_scope = Some(fence.scope.clone());
            job.navigation_transfer_pending = true;
            job.navigation_transfer_recovery = false;
            job.state = JobState::WaitingUser;
            job.error = Some("transfer_pending".into());
            engine.contexts.lock().unwrap().remove(&id);
            engine.site_accounts.lock().unwrap().invalidate_job(&id);
            let saved = (|| -> Result<()> {
                let store = engine.store.lock().unwrap();
                store.remove("site_account_selection", &id)?;
                store.put("job", &id, &*job)?;
                Ok(())
            })();
            if let Err(error) = saved {
                let mut runtime = engine.navigation_transfer.lock().unwrap();
                let _ = runtime.cancel(&fence);
                runtime.queue_recovery(Recovery {
                    fence: fence.clone(),
                    reason: RecoveryReason::PreparationFailed,
                });
                drop(runtime);
                job.navigation_transfer_pending = false;
                job.navigation_transfer_recovery = true;
                job.error = Some("transfer_preparation_failed".into());
                let _ = engine.store.lock().unwrap().put("job", &id, &*job);
                return Err(error);
            }
            drop(job);
            drop(solver_tasks);
            drop(controls);
            release_queue(engine, &id)?;
            cancel_unavailable_challenges(engine)?;
            Ok(serde_json::to_value(prepared)?)
        }
        DesktopRequest::Cancel {
            id,
            expected_scope,
            expected_source_generation,
        } => {
            let shared = engine.job(&id)?;
            let job = shared.lock().unwrap();
            require_current(&job, &expected_scope, expected_source_generation)?;
            if !job.navigation_transfer_pending {
                if job.navigation_transfer_recovery {
                    return Ok(authority(&job));
                }
                bail!("transfer_ticket_unavailable");
            }
            let fence = engine
                .navigation_transfer
                .lock()
                .unwrap()
                .pending(&id)
                .ok_or_else(|| anyhow::anyhow!("transfer_ticket_unavailable"))?;
            validate_frozen(&job, true, &fence)?;
            let recovery = engine.navigation_transfer.lock().unwrap().cancel(&fence)?;
            drop(job);
            apply_recovery(engine, &recovery)?;
            engine
                .navigation_transfer
                .lock()
                .unwrap()
                .acknowledge_recovery(&recovery.fence);
            Ok(serde_json::json!({"id":id,"cancelled":true}))
        }
    }
}

pub fn browser(engine: &Arc<Engine>, request: BrowserRequest) -> Result<serde_json::Value> {
    sweep(engine)?;
    match request {
        BrowserRequest::Preview {
            token,
            recipient_scope,
        } => {
            let fence = engine
                .navigation_transfer
                .lock()
                .unwrap()
                .fence(&token, now_ms()?)?;
            let shared = engine.job(&fence.id)?;
            let job = shared.lock().unwrap();
            validate_frozen(&job, job.navigation_transfer_pending, &fence)?;
            let preview = engine.navigation_transfer.lock().unwrap().preview(
                &token,
                &recipient_scope,
                now_ms()?,
            )?;
            Ok(serde_json::to_value(preview)?)
        }
        BrowserRequest::Accept {
            token,
            recipient_scope,
            consent,
        } => {
            let fence = engine
                .navigation_transfer
                .lock()
                .unwrap()
                .fence(&token, now_ms()?)?;
            let shared = engine.job(&fence.id)?;
            let mut job = shared.lock().unwrap();
            validate_frozen(&job, job.navigation_transfer_pending, &fence)?;
            let accepted = engine.navigation_transfer.lock().unwrap().accept(
                &token,
                &recipient_scope,
                consent,
                now_ms()?,
            )?;
            job.navigation_owner = Some(accepted.owner.clone());
            job.navigation_scope = Some(accepted.scope.clone());
            job.source_generation = accepted.source_generation;
            job.navigation_transfer_pending = false;
            job.navigation_transfer_recovery = false;
            job.state = JobState::WaitingBrowser;
            job.error = None;
            if let Err(error) = engine.store.lock().unwrap().put("job", &job.id, &*job) {
                // No accepted response escaped while the job lock was held.
                // Token stays consumed; preserve the original frozen owner for
                // manual recovery rather than strand the recipient after failure.
                job.navigation_owner = Some(fence.owner.clone());
                job.navigation_scope = Some(fence.scope.clone());
                job.source_generation = fence.source_generation;
                job.navigation_transfer_recovery = true;
                job.state = JobState::WaitingUser;
                job.error = Some("transfer_acceptance_failed".into());
                engine
                    .navigation_transfer
                    .lock()
                    .unwrap()
                    .queue_recovery(Recovery {
                        fence,
                        reason: RecoveryReason::AcceptanceFailed,
                    });
                return Err(error);
            }
            Ok(serde_json::to_value(accepted)?)
        }
        BrowserRequest::Continue {
            id,
            scope,
            source_generation,
            consent,
        } => {
            if !consent {
                bail!("transfer_consent_required");
            }
            let shared = engine.job(&id)?;
            let mut job = shared.lock().unwrap();
            require_current(&job, &scope, source_generation)?;
            if job.navigation_transfer_pending {
                bail!("transfer_already_pending");
            }
            if !matches!(job.state, JobState::WaitingBrowser | JobState::WaitingUser) {
                bail!("transfer_job_not_waiting");
            }
            if job.navigation_transfer_recovery {
                job.navigation_transfer_recovery = false;
                job.state = JobState::WaitingBrowser;
                job.error = None;
                if let Err(error) = engine.store.lock().unwrap().put("job", &job.id, &*job) {
                    job.navigation_transfer_recovery = true;
                    job.state = JobState::WaitingUser;
                    job.error = Some("transfer_continue_failed".into());
                    return Err(error);
                }
            }
            Ok(authority(&job))
        }
    }
}

pub fn sweep(engine: &Engine) -> Result<()> {
    sweep_at(engine, now_ms()?)
}
/// Deterministic clock entry point for native regression fixtures; not a wire command.
#[doc(hidden)]
pub fn sweep_at(engine: &Engine, now_ms: u64) -> Result<()> {
    let recoveries = {
        let mut runtime = engine.navigation_transfer.lock().unwrap();
        runtime.expire(now_ms);
        runtime.recoveries.values().cloned().collect::<Vec<_>>()
    };
    let mut first_error = None;
    for recovery in recoveries {
        match apply_recovery(engine, &recovery) {
            Ok(()) => engine
                .navigation_transfer
                .lock()
                .unwrap()
                .acknowledge_recovery(&recovery.fence),
            Err(error) => {
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
        }
    }
    match first_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}
pub fn recover_interrupted(job: &mut Job) -> bool {
    if !job.navigation_transfer_pending {
        return false;
    }
    job.navigation_transfer_pending = false;
    if matches!(
        job.state,
        JobState::Complete | JobState::BrowserComplete | JobState::Cancelled | JobState::Failed
    ) {
        job.navigation_transfer_recovery = false;
        return true;
    }
    clear_inherited_job(job);
    job.navigation_transfer_recovery = true;
    job.state = JobState::WaitingUser;
    job.error = Some("transfer_interrupted".into());
    true
}
fn apply_recovery(engine: &Engine, recovery: &Recovery) -> Result<()> {
    let Ok(shared) = engine.job(&recovery.fence.id) else {
        return Ok(());
    };
    let mut job = shared.lock().unwrap();
    // A failed durable write may already have set the in-memory recovery flag.
    // Retry that exact authority, but never undo a successful explicit Continue.
    let terminal = matches!(
        job.state,
        JobState::Complete | JobState::BrowserComplete | JobState::Cancelled | JobState::Failed
    );
    if !job.navigation_transfer_pending && !job.navigation_transfer_recovery && !terminal {
        return Ok(());
    }
    if job.id != recovery.fence.id
        || job.navigation_scope.as_ref() != Some(&recovery.fence.scope)
        || job.source_generation != recovery.fence.source_generation
        || job.navigation_owner.as_deref() != Some(&recovery.fence.owner)
        || job.private != recovery.fence.scope.private
    {
        return Ok(());
    }
    if matches!(
        job.state,
        JobState::Complete | JobState::BrowserComplete | JobState::Cancelled | JobState::Failed
    ) {
        job.navigation_transfer_pending = false;
        job.navigation_transfer_recovery = false;
    } else {
        if validate_frozen(&job, true, &recovery.fence).is_err() {
            return Ok(());
        }
        job.navigation_transfer_pending = false;
        job.navigation_transfer_recovery = true;
        job.state = JobState::WaitingUser;
        job.error = Some(
            match recovery.reason {
                RecoveryReason::Cancelled => "transfer_cancelled",
                RecoveryReason::Expired => "transfer_expired",
                RecoveryReason::Interrupted => "transfer_interrupted",
                RecoveryReason::PreparationFailed => "transfer_preparation_failed",
                RecoveryReason::AcceptanceFailed => "transfer_acceptance_failed",
            }
            .into(),
        );
    }
    engine.store.lock().unwrap().put("job", &job.id, &*job)?;
    drop(job);
    release_queue(engine, &recovery.fence.id)
}
fn clear_inherited_job(job: &mut Job) {
    job.credential_id = None;
    job.request_fingerprint = None;
    job.replay_decision = None;
    job.solver_session = None;
    job.solver_attempted = false;
    job.solver_outcome = None;
    job.navigation_url = job.page_url.clone();
    if let Some(page) = &job.page_url {
        job.url = page.clone();
    }
    job.speed = 0;
    job.viable = false;
    job.resumable = false;
    job.etag = None;
    job.modified = None;
    job.total = None;
    job.verified_sha256 = None;
    job.failure = None;
    if job.bytes == 0 && !job.partial_created {
        job.segments.clear();
    }
}
fn require_current(job: &Job, scope: &SessionScope, source: u64) -> Result<()> {
    scope
        .validate()
        .map_err(|_| anyhow::anyhow!("transfer_scope_invalid"))?;
    if job.navigation_owner.as_deref() != Some(&scope.profile)
        || job.navigation_scope.as_ref() != Some(scope)
        || job.source_generation != source
        || job.private != scope.private
    {
        bail!("transfer_scope_stale");
    }
    Ok(())
}
fn authority(job: &Job) -> serde_json::Value {
    serde_json::json!({"id":job.id,"scope":job.navigation_scope,"source_generation":job.source_generation,
        "state":job.state,"navigation_transfer_pending":job.navigation_transfer_pending,
        "navigation_transfer_recovery":job.navigation_transfer_recovery})
}
fn release_queue(engine: &Engine, id: &str) -> Result<()> {
    let mut scheduler = engine.navigation_scheduler.lock().unwrap();
    scheduler.tasks.retain(|task| task.id != id);
    scheduler.persist(&engine.store.lock().unwrap())
}
fn cancel_unavailable_challenges(engine: &Engine) -> Result<()> {
    let available = engine
        .snapshot()
        .jobs
        .iter()
        .filter_map(crate::captcha::ownership)
        .collect::<Vec<_>>();
    crate::captcha::cancel_unavailable(&engine.store.lock().unwrap(), &available)
}
fn now_ms() -> Result<u64> {
    chrono::Utc::now()
        .timestamp_millis()
        .try_into()
        .map_err(|_| anyhow::anyhow!("transfer_clock_invalid"))
}

#[cfg(test)]
mod clock_tests {
    use super::*;
    #[test]
    fn monotonic_deadline_refuses_wall_clock_rollback() {
        let profile = uuid::Uuid::new_v4().to_string();
        let fence = FrozenFence {
            id: uuid::Uuid::new_v4().to_string(),
            owner: profile.clone(),
            scope: SessionScope {
                browser: "chromium".into(),
                profile,
                private: false,
                cookie_store_id: Some("0".into()),
                container_id: None,
                partition_key: None,
                claim_generation: 2,
            },
            source_generation: 2,
            page_url: "http://127.0.0.1:9/fixture".into(),
            filename: "fixture.bin".into(),
        };
        let mut runtime = Runtime::default();
        let prepared = runtime.prepare(fence, 1_000_000).unwrap();
        let created = runtime.tickets.get(&prepared.token).unwrap().created;
        // A fresh Windows runner can have less uptime than the ticket TTL.
        // Advance the observed instant instead of subtracting from its epoch.
        let deadline = created + Duration::from_millis(TICKET_TTL_MS);
        assert!(runtime
            .available_at(&prepared.token, 1, deadline - Duration::from_nanos(1))
            .is_ok());
        assert!(runtime.available_at(&prepared.token, 1, deadline).is_err());
        assert_eq!(runtime.expire_at(1, deadline).len(), 1);
    }
}
