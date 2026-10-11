use crate::store::Store;
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

const LEASE_MS: i64 = 90_000;
const RECHECK_MS: i64 = 30_000;
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulerSettings {
    pub max_active: usize,
    pub paused: bool,
    pub notifications: bool,
}
impl Default for SchedulerSettings {
    fn default() -> Self {
        Self {
            max_active: 3,
            paused: false,
            notifications: false,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum QueueStatus {
    Queued,
    Active,
    Waiting,
    Manual,
    Recovering,
    Paused,
    Finished,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaitMetadata {
    pub generation: u64,
    pub source_generation: u64,
    pub observed_at_ms: i64,
    pub observed_duration_ms: u64,
    pub deadline_ms: i64,
    pub next_recheck_ms: i64,
    pub basis: WaitBasis,
    pub requires_live_tab: bool,
    pub expires_at_ms: Option<i64>,
    pub reason: String,
    pub notified: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WaitBasis {
    Server,
    Page,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lease {
    pub owner: String,
    pub tab_id: i64,
    pub generation: u64,
    pub expires_at_ms: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueTask {
    pub id: String,
    pub generation: u64,
    #[serde(default)]
    pub private: bool,
    #[serde(default)]
    pub scope: Option<crate::navigation::SessionScope>,
    pub owner: String,
    pub host_keys: Vec<String>,
    pub priority: i32,
    pub order: u64,
    pub status: QueueStatus,
    pub reason: String,
    pub lease: Option<Lease>,
    pub wait: Option<WaitMetadata>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Scheduler {
    pub settings: SchedulerSettings,
    pub tasks: Vec<QueueTask>,
    pub sequence: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulerSnapshot {
    pub settings: SchedulerSettings,
    pub active: usize,
    pub tasks: Vec<QueueTask>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum SchedulerRequest {
    Admit {
        id: String,
        generation: u64,
    },
    Heartbeat {
        id: String,
        generation: u64,
        tab_id: i64,
    },
    Wait {
        id: String,
        generation: u64,
        wait: WaitMetadata,
    },
    Ready {
        id: String,
        generation: u64,
        wait_generation: u64,
        ready: bool,
    },
    Release {
        id: String,
        generation: u64,
    },
    Reconcile {
        live: Vec<LiveLease>,
    },
    Control {
        id: Option<String>,
        paused: Option<bool>,
        priority: Option<i32>,
    },
    Settings {
        max_active: usize,
        notifications: bool,
    },
    Manual {
        id: String,
        generation: u64,
    },
    Validate {
        id: String,
        generation: u64,
    },
    Notify {
        id: String,
        generation: u64,
        wait_generation: u64,
    },
    Snapshot,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveLease {
    pub id: String,
    pub generation: u64,
    pub tab_id: i64,
    #[serde(default)]
    pub scope: Option<crate::navigation::SessionScope>,
}
impl Scheduler {
    pub fn load(store: &Store) -> Result<Self> {
        Ok(store
            .all::<Self>("navigation_scheduler")?
            .into_iter()
            .next()
            .unwrap_or_default())
    }
    pub fn persist(&self, store: &Store) -> Result<()> {
        let mut public = self.clone();
        public.tasks.retain(|task| !task.private);
        store.put("navigation_scheduler", "main", &public)
    }
    /// Called only with service-validated job/project and opaque host lock keys.
    pub fn enqueue(
        &mut self,
        id: String,
        generation: u64,
        owner: String,
        host_keys: Vec<String>,
    ) -> Result<()> {
        if id.is_empty()
            || owner.is_empty()
            || host_keys.is_empty()
            || host_keys.iter().any(|h| h.is_empty() || h.len() > 512)
        {
            bail!("Invalid navigation queue identity");
        }
        if let Some(old) = self.tasks.iter().find(|t| t.id == id) {
            if old.generation == generation && old.owner == owner {
                return Ok(());
            }
            if old.status != QueueStatus::Finished {
                bail!("Prior navigation generation must be fenced before replacement");
            }
        }
        self.tasks.retain(|t| t.id != id);
        self.sequence = self
            .sequence
            .checked_add(1)
            .ok_or_else(|| anyhow::anyhow!("Queue sequence overflow"))?;
        self.tasks.push(QueueTask {
            id,
            generation,
            owner,
            private: false,
            scope: None,
            host_keys,
            priority: 0,
            order: self.sequence,
            status: QueueStatus::Queued,
            reason: "queued".into(),
            lease: None,
            wait: None,
        });
        Ok(())
    }
    pub fn snapshot(&self) -> SchedulerSnapshot {
        let mut tasks = self.tasks.clone();
        tasks.sort_by_key(|t| (std::cmp::Reverse(t.priority), t.order));
        SchedulerSnapshot {
            settings: self.settings.clone(),
            active: self.tasks.iter().filter(|t| t.lease.is_some()).count(),
            tasks,
        }
    }
    fn task_mut(&mut self, owner: &str, id: &str, generation: u64) -> Result<&mut QueueTask> {
        let task = self
            .tasks
            .iter_mut()
            .find(|t| t.id == id)
            .ok_or_else(|| anyhow::anyhow!("Unknown navigation task"))?;
        if task.owner != owner || task.generation != generation {
            bail!("Stale navigation owner or generation");
        }
        Ok(task)
    }
    fn refresh_reasons(&mut self) {
        let active = self.tasks.iter().filter(|t| t.lease.is_some()).count();
        let locks: Vec<String> = self
            .tasks
            .iter()
            .filter(|t| {
                t.lease.is_some()
                    || matches!(
                        t.status,
                        QueueStatus::Waiting | QueueStatus::Manual | QueueStatus::Recovering
                    )
            })
            .flat_map(|t| t.host_keys.clone())
            .collect();
        for t in self
            .tasks
            .iter_mut()
            .filter(|t| t.status == QueueStatus::Queued)
        {
            t.reason = if self.settings.paused {
                "queue_paused"
            } else if t.host_keys.iter().any(|h| locks.contains(h)) {
                "host_session_busy"
            } else if active >= self.settings.max_active {
                "tab_limit"
            } else {
                "queued"
            }
            .into();
        }
    }
    pub fn apply(
        &mut self,
        owner: &str,
        request: SchedulerRequest,
        now: i64,
    ) -> Result<SchedulerSnapshot> {
        for t in &mut self.tasks {
            if t.lease.as_ref().is_some_and(|l| l.expires_at_ms <= now)
                && t.status != QueueStatus::Finished
            {
                t.status = QueueStatus::Recovering;
                t.reason = "lease_expired_reconcile_tabs".into();
            }
        }
        match request {
            SchedulerRequest::Admit { id, generation } => {
                let task = self
                    .tasks
                    .iter()
                    .find(|t| t.id == id)
                    .ok_or_else(|| anyhow::anyhow!("Unknown navigation task"))?;
                if task.owner != owner || task.generation != generation {
                    bail!("Stale navigation owner or generation");
                }
                if task.lease.is_some() && task.status != QueueStatus::Recovering {
                    return Ok(self.snapshot());
                }
                let active = self.tasks.iter().filter(|t| t.lease.is_some()).count();
                let blocked = |candidate: &QueueTask| {
                    self.tasks.iter().any(|other| {
                        other.id != candidate.id
                            && (other.lease.is_some()
                                || matches!(
                                    other.status,
                                    QueueStatus::Waiting
                                        | QueueStatus::Manual
                                        | QueueStatus::Recovering
                                ))
                            && other
                                .host_keys
                                .iter()
                                .any(|key| candidate.host_keys.contains(key))
                    })
                };
                if self.settings.paused
                    || task.status != QueueStatus::Queued
                    || active >= self.settings.max_active
                    || blocked(task)
                {
                    self.refresh_reasons();
                    return Ok(self.snapshot());
                }
                let eligible = self
                    .tasks
                    .iter()
                    .filter(|t| t.status == QueueStatus::Queued && t.owner == owner && !blocked(t))
                    .min_by_key(|t| (std::cmp::Reverse(t.priority), t.order));
                if eligible.is_none_or(|t| t.id != id) {
                    self.task_mut(owner, &id, generation)?.reason = "queue_order".into();
                    return Ok(self.snapshot());
                }
                let task = self.task_mut(owner, &id, generation)?;
                task.status = QueueStatus::Active;
                task.reason = "active".into();
                task.lease = Some(Lease {
                    owner: owner.into(),
                    tab_id: -1,
                    generation,
                    expires_at_ms: now.saturating_add(LEASE_MS),
                });
            }
            SchedulerRequest::Heartbeat {
                id,
                generation,
                tab_id,
            } => {
                if tab_id < 0 {
                    bail!("Invalid live tab");
                }
                let t = self.task_mut(owner, &id, generation)?;
                let lease = t
                    .lease
                    .as_mut()
                    .ok_or_else(|| anyhow::anyhow!("Navigation has no admission"))?;
                if lease.tab_id >= 0 && lease.tab_id != tab_id {
                    bail!("Navigation tab mismatch");
                }
                lease.tab_id = tab_id;
                lease.expires_at_ms = now.saturating_add(LEASE_MS);
                if t.status == QueueStatus::Recovering {
                    t.status = if t.wait.is_some() {
                        QueueStatus::Waiting
                    } else {
                        QueueStatus::Active
                    };
                    t.reason = "recovered_revalidate_page".into();
                }
            }
            SchedulerRequest::Wait {
                id,
                generation,
                mut wait,
            } => {
                if wait.source_generation != generation
                    || wait.reason.len() > 256
                    || wait.observed_duration_ms > 7 * 24 * 60 * 60 * 1000
                    || wait.generation == 0
                {
                    bail!("Invalid wait metadata");
                }
                let t = self.task_mut(owner, &id, generation)?;
                if t.lease.is_none() {
                    bail!("Wait requires admitted navigation");
                }
                if t.wait
                    .as_ref()
                    .is_some_and(|old| old.generation > wait.generation)
                {
                    bail!("Stale wait generation");
                }
                // Duplicate observations must not push the deadline indefinitely.
                if t.wait
                    .as_ref()
                    .is_none_or(|old| old.generation != wait.generation)
                {
                    wait.notified = false;
                    wait.next_recheck_ms = now
                        .saturating_add(RECHECK_MS)
                        .min(wait.deadline_ms.max(now));
                    t.wait = Some(wait);
                }
                t.status = QueueStatus::Waiting;
                t.reason = "waiting_server_readiness".into();
            }
            SchedulerRequest::Ready {
                id,
                generation,
                wait_generation,
                ready,
            } => {
                let t = self.task_mut(owner, &id, generation)?;
                if t.lease.is_none() || t.status == QueueStatus::Recovering {
                    bail!("Readiness requires a reconciled live session");
                }
                let wait = t
                    .wait
                    .as_mut()
                    .ok_or_else(|| anyhow::anyhow!("No active wait"))?;
                if wait.generation != wait_generation || wait.source_generation != generation {
                    bail!("Stale wait readiness");
                }
                if wait.expires_at_ms.is_some_and(|expiry| expiry <= now) {
                    t.status = QueueStatus::Manual;
                    t.reason = "wait_token_expired".into();
                } else if ready {
                    t.status = QueueStatus::Active;
                    t.reason = "ready_confirmed".into();
                } else {
                    wait.next_recheck_ms = now.saturating_add(RECHECK_MS);
                    t.reason = "waiting_server_readiness".into();
                }
            }
            SchedulerRequest::Release { id, generation } => {
                let t = self.task_mut(owner, &id, generation)?;
                t.lease = None;
                t.wait = None;
                t.status = QueueStatus::Finished;
                t.reason = "released".into();
            }
            SchedulerRequest::Reconcile { live } => {
                for t in self
                    .tasks
                    .iter_mut()
                    .filter(|t| t.owner == owner && t.lease.is_some())
                {
                    let lease = t.lease.as_mut().unwrap();
                    if let Some(found) = live.iter().find(|l| {
                        l.id == t.id
                            && l.generation == t.generation
                            && (lease.tab_id < 0 || lease.tab_id == l.tab_id)
                            && l.tab_id >= 0
                    }) {
                        lease.tab_id = found.tab_id;
                        lease.expires_at_ms = now.saturating_add(LEASE_MS);
                        t.status = if t.wait.is_some() {
                            QueueStatus::Waiting
                        } else {
                            QueueStatus::Active
                        };
                        t.reason = "recovered_revalidate_page".into();
                    } else {
                        t.lease = None;
                        t.status = QueueStatus::Manual;
                        t.reason = "owning_tab_missing_continue_required".into();
                    }
                }
            }
            SchedulerRequest::Control {
                id,
                paused,
                priority,
            } => {
                if let Some(id) = id {
                    let t = self
                        .tasks
                        .iter_mut()
                        .find(|t| t.id == id && t.owner == owner)
                        .ok_or_else(|| anyhow::anyhow!("Unknown navigation owner"))?;
                    if let Some(p) = priority {
                        t.priority = p.clamp(-100, 100);
                    }
                    if let Some(p) = paused {
                        if p && t.lease.is_none() {
                            t.status = QueueStatus::Paused;
                            t.reason = "task_paused".into();
                        } else if !p
                            && matches!(t.status, QueueStatus::Paused | QueueStatus::Manual)
                        {
                            t.status = if t.lease.is_some() {
                                QueueStatus::Active
                            } else {
                                QueueStatus::Queued
                            };
                            t.wait = None;
                            t.reason = "queued".into();
                        }
                    }
                } else if let Some(p) = paused {
                    self.settings.paused = p;
                }
            }
            SchedulerRequest::Settings {
                max_active,
                notifications,
            } => {
                if !(1..=20).contains(&max_active) {
                    bail!("Navigation limit must be between 1 and 20");
                }
                self.settings.max_active = max_active;
                self.settings.notifications = notifications;
            }
            SchedulerRequest::Manual { id, generation } => {
                let task = self.task_mut(owner, &id, generation)?;
                task.status = QueueStatus::Manual;
                task.reason = "browser_input_required".into();
            }
            SchedulerRequest::Validate { id, generation } => {
                let task = self
                    .tasks
                    .iter()
                    .find(|t| t.id == id)
                    .ok_or_else(|| anyhow::anyhow!("Unknown navigation task"))?;
                if task.owner != owner
                    || task.generation != generation
                    || task.lease.is_none()
                    || task.status == QueueStatus::Recovering
                {
                    bail!("Navigation admission is stale");
                }
                let collision = self.tasks.iter().any(|other| {
                    other.id != id
                        && other.lease.is_some()
                        && other
                            .host_keys
                            .iter()
                            .any(|key| task.host_keys.contains(key))
                });
                if collision {
                    let task = self.task_mut(owner, &id, generation)?;
                    task.status = QueueStatus::Manual;
                    task.reason = "host_session_busy".into();
                }
            }
            SchedulerRequest::Notify {
                id,
                generation,
                wait_generation,
            } => {
                let t = self.task_mut(owner, &id, generation)?;
                let wait = t
                    .wait
                    .as_mut()
                    .ok_or_else(|| anyhow::anyhow!("No active wait"))?;
                if wait.generation != wait_generation || t.status != QueueStatus::Active {
                    bail!("Readiness notification is stale");
                }
                if !wait.notified {
                    wait.notified = true;
                    t.reason = "ready_notification_claimed".into();
                } else {
                    t.reason = "ready_confirmed".into();
                }
            }
            SchedulerRequest::Snapshot => {}
        }
        self.refresh_reasons();
        Ok(self.snapshot())
    }
}
#[cfg(test)]
mod tests;
