//! Explicitly selected, exact-session site accounts. Passwords never enter durable records.
use crate::{navigation::SessionScope, store::Store, Engine, JobState};
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub label: String,
    pub origin: String,
    pub provider: String,
    pub account_id: String,
    pub scope: SessionScope,
    pub saved_fill: bool,
    pub credential_ref: Option<String>,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthState {
    SignedOut,
    Authenticated,
    Expired,
    MfaRequired,
    Rejected,
    AccountMismatch,
    Unknown,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Entitlement {
    Active,
    Expired,
    QuotaExhausted,
    Unknown,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Free,
    Premium,
    Manual,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Selection {
    pub account: Account,
    pub scope: SessionScope,
    pub mode: Mode,
    pub source_generation: u64,
    pub auth: AuthState,
    pub entitlement: Entitlement,
    pub observed_at: Option<i64>,
    pub selected_host: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum DesktopRequest {
    List,
    Save {
        account: Box<Account>,
        password: Option<String>,
    },
    Remove {
        id: String,
    },
    Select {
        job_id: String,
        account_id: Option<String>,
        mode: Mode,
    },
}
impl std::fmt::Debug for DesktopRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Save { account, .. } => f
                .debug_struct("Save")
                .field("account", account)
                .field("password", &"[redacted]")
                .finish(),
            Self::List => f.write_str("List"),
            Self::Remove { .. } => f.write_str("Remove"),
            Self::Select { .. } => f.write_str("Select"),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FormProof {
    pub tab_id: u64,
    pub frame_id: u64,
    pub origin: String,
    pub page: String,
    pub action: String,
    pub method: String,
    pub adapter_id: String,
    pub adapter_version: String,
    pub fingerprint: String,
    pub document_generation: u64,
    #[serde(default)]
    pub document_id: Option<String>,
    pub username_name: String,
    pub password_name: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum BrowserAction {
    Selection,
    Observe {
        proof: FormProof,
        auth: AuthState,
        entitlement: Entitlement,
        account_id: Option<String>,
        selected_host: Option<String>,
    },
    Grant {
        proof: FormProof,
    },
    Consume {
        grant_id: String,
        proof: FormProof,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserRequest {
    pub job_id: String,
    pub owner: String,
    pub scope: SessionScope,
    pub source_generation: u64,
    pub request: BrowserAction,
}
pub struct Grant {
    proof: FormProof,
    job_id: String,
    scope: SessionScope,
    source_generation: u64,
    account_id: String,
    expires: i64,
}
#[derive(Default)]
pub struct Runtime {
    grants: HashMap<String, Grant>,
    attempts: HashMap<(String, u64), usize>,
}
pub trait Vault {
    fn write(&self, id: &str, username: &str, password: &str) -> Result<()>;
    fn read(&self, id: &str) -> Result<(String, String)>;
    fn delete(&self, id: &str) -> Result<()>;
}
pub struct NativeVault;
impl Vault for NativeVault {
    fn write(&self, id: &str, username: &str, password: &str) -> Result<()> {
        crate::security::save_credential(id, username, password)
    }
    fn read(&self, id: &str) -> Result<(String, String)> {
        crate::security::credential(id)
    }
    fn delete(&self, id: &str) -> Result<()> {
        match keyring::Entry::new("Downloader", id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
}
pub fn same_session(a: &SessionScope, b: &SessionScope) -> bool {
    let mut a = a.clone();
    let mut b = b.clone();
    a.claim_generation = 1;
    b.claim_generation = 1;
    a == b
}
fn origin(value: &str) -> Result<String> {
    let u = url::Url::parse(value)?;
    if !matches!(u.scheme(), "http" | "https") || !u.username().is_empty() || u.password().is_some()
    {
        bail!("account_origin_invalid");
    }
    Ok(u.origin().ascii_serialization())
}
fn provider(value: &str) -> Result<&'static str> {
    let u = url::Url::parse(value)?;
    Ok(match u.host_str().unwrap_or("") {
        "127.0.0.1" | "localhost" | "[::1]" => "local-fixture",
        "ddownload.com" | "www.ddownload.com" => "ddownload",
        "rapidgator.net" | "www.rapidgator.net" => "rapidgator",
        "gofile.io" => "gofile",
        "g4u.to" => "g4u",
        _ => bail!("account_provider_unsupported"),
    })
}
fn validate_account(account: &Account) -> Result<()> {
    uuid::Uuid::parse_str(&account.id)?;
    account.scope.validate()?;
    for text in [&account.label, &account.account_id] {
        if text.is_empty() || text.len() > 128 || text.contains(['\r', '\n', '\0']) {
            bail!("account_metadata_invalid");
        }
    }
    if origin(&account.origin)? != account.origin || provider(&account.origin)? != account.provider
    {
        bail!("account_origin_mismatch");
    }
    if url::Url::parse(&account.origin)?.scheme() != "https" && account.provider != "local-fixture"
    {
        bail!("account_https_required");
    }
    if account.credential_ref.is_some() {
        bail!("credential_reference_is_service_owned");
    }
    Ok(())
}
pub fn save(
    store: &Store,
    mut account: Account,
    password: Option<String>,
    vault: &dyn Vault,
) -> Result<Account> {
    validate_account(&account)?;
    if account.scope.private && (password.is_some() || account.saved_fill) {
        bail!("private_accounts_use_existing_session_only");
    }
    let old = store.get::<Account>("site_account", &account.id).ok();
    if let Some(old) = &old {
        if old.origin != account.origin
            || !same_session(&old.scope, &account.scope)
            || old.account_id != account.account_id
        {
            bail!("account_identity_is_immutable");
        }
        account.credential_ref = old.credential_ref.clone();
    }
    if let Some(password) = password {
        if password.is_empty() || password.len() > 4096 {
            bail!("account_password_invalid");
        }
        let reference = format!("nav-account-{}", account.id);
        vault.write(&reference, &account.account_id, &password)?;
        account.credential_ref = Some(reference);
    }
    if account.saved_fill && account.credential_ref.is_none() {
        bail!("account_credentials_missing");
    }
    store.put("site_account", &account.id, &account)?;
    Ok(account)
}
fn proof(proof: &FormProof, account: &Account, login: bool) -> Result<()> {
    if proof.frame_id != 0
        || proof.document_generation == 0
        || proof.origin != account.origin
        || origin(&proof.page)? != account.origin
        || origin(&proof.action)? != account.origin
    {
        bail!("account_form_origin_or_frame_mismatch");
    }
    if proof.fingerprint.len() != 64 || !proof.fingerprint.bytes().all(|c| c.is_ascii_hexdigit()) {
        bail!("account_form_fingerprint_invalid");
    }
    // Only permitted fixture forms are qualified. Live providers retain visible manual input.
    let page = url::Url::parse(&proof.page)?;
    if account.provider != "local-fixture"
        || proof.adapter_id != "local-fixture"
        || proof.adapter_version != "1.0.0"
        || !page.path().starts_with("/nav-adapters/")
    {
        bail!("account_form_unqualified");
    }
    if login
        && (proof.method != "POST"
            || proof.username_name != "username"
            || proof.password_name != "password"
            || !url::Url::parse(&proof.action)?.path().ends_with("/login"))
    {
        bail!("account_login_form_unsupported");
    }
    Ok(())
}
pub fn desktop(engine: &Arc<Engine>, request: DesktopRequest) -> Result<serde_json::Value> {
    match request {
        DesktopRequest::List => Ok(serde_json::to_value(
            engine
                .store
                .lock()
                .unwrap()
                .all::<Account>("site_account")?,
        )?),
        DesktopRequest::Save { account, password } => {
            let account = save(
                &engine.store.lock().unwrap(),
                *account,
                password,
                &NativeVault,
            )?;
            engine
                .site_accounts
                .lock()
                .unwrap()
                .grants
                .retain(|_, g| g.account_id != account.id);
            Ok(serde_json::to_value(account)?)
        }
        DesktopRequest::Remove { id } => {
            uuid::Uuid::parse_str(&id)?;
            let account = engine
                .store
                .lock()
                .unwrap()
                .get::<Account>("site_account", &id)?;
            if let Some(reference) = &account.credential_ref {
                NativeVault.delete(reference)?;
            }
            engine.store.lock().unwrap().remove("site_account", &id)?;
            // Maintain job -> store -> account-runtime lock order in every account operation.
            let jobs: Vec<_> = engine.jobs.lock().unwrap().values().cloned().collect();
            for shared in jobs {
                let mut job = shared.lock().unwrap();
                let store = engine.store.lock().unwrap();
                if store
                    .get::<Selection>("site_account_selection", &job.id)
                    .is_ok_and(|s| s.account.id == id)
                {
                    store.remove("site_account_selection", &job.id)?;
                    job.source_generation += 1;
                    if let Some(scope) = &mut job.navigation_scope {
                        scope.claim_generation += 1;
                    }
                    if !matches!(
                        job.state,
                        JobState::Complete | JobState::Cancelled | JobState::Failed
                    ) {
                        job.state = JobState::WaitingAuthentication;
                        job.error =
                            Some("account_removed: select an existing browser session".into());
                    }
                    store.put("job", &job.id, &*job)?;
                }
            }
            engine
                .site_accounts
                .lock()
                .unwrap()
                .grants
                .retain(|_, g| g.account_id != id);
            Ok(serde_json::json!({"removed":true}))
        }
        DesktopRequest::Select {
            job_id,
            account_id,
            mode,
        } => {
            let job = engine.job(&job_id)?;
            let mut job = job.lock().unwrap();
            if job.page_url.is_none()
                || job.state.active()
                || matches!(
                    job.state,
                    JobState::Complete | JobState::Cancelled | JobState::Failed
                )
            {
                bail!("account_job_unavailable");
            }
            let mut scope = job
                .navigation_scope
                .clone()
                .ok_or_else(|| anyhow::anyhow!("account_browser_scope_required"))?;
            let store = engine.store.lock().unwrap();
            let account = account_id
                .map(|id| store.get::<Account>("site_account", &id))
                .transpose()?;
            if let Some(account) = &account {
                if !same_session(&account.scope, &scope) {
                    bail!("account_session_mismatch");
                }
                let page = job
                    .navigation_url
                    .as_ref()
                    .or(job.page_url.as_ref())
                    .unwrap_or(&job.url);
                if origin(page)? != account.origin {
                    bail!("account_page_origin_mismatch");
                }
            }
            job.source_generation += 1;
            scope.claim_generation += 1;
            job.navigation_scope = Some(scope.clone());
            if let Some(account) = account {
                let selection = Selection {
                    account,
                    scope,
                    mode,
                    source_generation: job.source_generation,
                    auth: AuthState::Unknown,
                    entitlement: Entitlement::Unknown,
                    observed_at: None,
                    selected_host: None,
                };
                store.put("site_account_selection", &job.id, &selection)?;
            } else {
                store.remove("site_account_selection", &job.id)?;
            }
            job.state = JobState::WaitingAuthentication;
            job.error = Some("account_session_selected: continue in the owning browser tab".into());
            store.put("job", &job.id, &*job)?;
            engine
                .site_accounts
                .lock()
                .unwrap()
                .grants
                .retain(|_, g| g.job_id != job_id);
            Ok(serde_json::to_value(&*job)?)
        }
    }
}
pub fn browser(engine: &Arc<Engine>, request: BrowserRequest) -> Result<serde_json::Value> {
    request.scope.validate()?;
    let job = engine.job(&request.job_id)?;
    let job = job.lock().unwrap();
    if job.navigation_owner.as_deref() != Some(&request.owner)
        || job.navigation_scope.as_ref() != Some(&request.scope)
        || job.source_generation != request.source_generation
        || matches!(
            job.state,
            JobState::Cancelled | JobState::Complete | JobState::Failed
        )
    {
        bail!("account_navigation_fence_stale");
    }
    let store = engine.store.lock().unwrap();
    let mut selection = match store.get::<Selection>("site_account_selection", &job.id) {
        Ok(value) => value,
        Err(_) if matches!(request.request, BrowserAction::Selection) => {
            return Ok(serde_json::Value::Null)
        }
        Err(_) => bail!("account_selection_required"),
    };
    let account = store
        .get::<Account>("site_account", &selection.account.id)
        .map_err(|_| anyhow::anyhow!("account_removed"))?;
    if !same_session(&account.scope, &request.scope)
        || selection.scope != request.scope
        || selection.source_generation != request.source_generation
    {
        bail!("account_selection_stale");
    }
    selection.account = account.clone();
    let mut runtime = engine.site_accounts.lock().unwrap();
    let now = chrono::Utc::now().timestamp_millis();
    runtime.grants.retain(|_, g| g.expires > now);
    match request.request {
        BrowserAction::Selection => {
            if selection.observed_at.is_none_or(|t| now - t > 90_000) {
                selection.auth = AuthState::Unknown;
                selection.entitlement = Entitlement::Unknown;
            }
            Ok(serde_json::to_value(selection)?)
        }
        BrowserAction::Observe {
            proof: p,
            auth,
            entitlement,
            account_id,
            selected_host,
        } => {
            proof(&p, &account, false)?;
            if auth == AuthState::Authenticated
                && account_id.as_deref() != Some(&account.account_id)
            {
                bail!("account_observed_identity_mismatch");
            }
            selection.auth = auth;
            selection.entitlement = if auth == AuthState::Authenticated {
                entitlement
            } else {
                Entitlement::Unknown
            };
            if let Some(host) = &selected_host {
                if host.len() > 253 || host.contains(['/', ':', '@', '?', '#']) {
                    bail!("account_selected_host_invalid");
                }
            }
            selection.selected_host = selected_host.or(selection.selected_host);
            selection.observed_at = Some(now);
            store.put("site_account_selection", &job.id, &selection)?;
            Ok(serde_json::to_value(selection)?)
        }
        BrowserAction::Grant { proof: p } => {
            proof(&p, &account, true)?;
            if !account.saved_fill || account.scope.private || account.credential_ref.is_none() {
                bail!("account_saved_fill_disabled");
            }
            if matches!(
                selection.auth,
                AuthState::MfaRequired | AuthState::Rejected | AuthState::AccountMismatch
            ) {
                bail!("account_user_action_required");
            }
            let attempts = runtime
                .attempts
                .entry((job.id.clone(), request.source_generation))
                .or_default();
            if *attempts >= 1 {
                bail!("account_login_attempt_exhausted");
            }
            *attempts += 1;
            let grant_id = uuid::Uuid::new_v4().to_string();
            runtime.grants.insert(
                grant_id.clone(),
                Grant {
                    proof: p,
                    job_id: job.id.clone(),
                    scope: request.scope,
                    source_generation: request.source_generation,
                    account_id: account.id,
                    expires: now + 15_000,
                },
            );
            Ok(serde_json::json!({"grant_id":grant_id,"expires_at":now+15_000}))
        }
        BrowserAction::Consume { grant_id, proof: p } => {
            let grant = runtime
                .grants
                .remove(&grant_id)
                .ok_or_else(|| anyhow::anyhow!("account_grant_expired_or_consumed"))?;
            if grant.job_id != job.id
                || grant.scope != request.scope
                || grant.source_generation != request.source_generation
                || grant.proof != p
                || grant.account_id != account.id
                || grant.expires <= now
            {
                bail!("account_grant_binding_stale");
            }
            proof(&p, &account, true)?;
            if !account.saved_fill || account.scope.private {
                bail!("account_saved_fill_disabled");
            }
            let reference = account
                .credential_ref
                .ok_or_else(|| anyhow::anyhow!("account_credentials_removed"))?;
            let (username, password) = NativeVault
                .read(&reference)
                .map_err(|_| anyhow::anyhow!("account_credentials_removed"))?;
            Ok(
                serde_json::json!({"username":username,"password":password,"expires_at":grant.expires}),
            )
        }
    }
}
#[cfg(test)]
mod tests;
