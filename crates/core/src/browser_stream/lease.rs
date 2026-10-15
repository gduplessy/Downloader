use super::Checkpoint;
use crate::{navigation::StreamIdentity, store::Store};
use anyhow::Result;
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

pub(super) const READER_TIMEOUT: Duration = Duration::from_secs(45);
struct Lease {
    identity: StreamIdentity,
    observed: Instant,
}
#[derive(Default)]
pub struct ReaderLeases {
    live: HashMap<String, Lease>,
}
impl ReaderLeases {
    pub(crate) fn load(store: &Store) -> Result<Self> {
        let mut leases = Self::default();
        let now = Instant::now();
        for checkpoint in store.all::<Checkpoint>("browser_stream")? {
            if !checkpoint.terminal {
                leases.observe(&checkpoint.identity, now);
            }
        }
        Ok(leases)
    }
    pub(super) fn observe(&mut self, identity: &StreamIdentity, now: Instant) {
        self.live.insert(
            identity.stream_id.clone(),
            Lease {
                identity: identity.clone(),
                observed: now,
            },
        );
    }
    #[cfg(test)]
    pub(super) fn len(&self) -> usize {
        self.live.len()
    }
    pub(super) fn remove(&mut self, id: &str) {
        self.live.remove(id);
    }
    pub(super) fn expired(&self, identity: &StreamIdentity, now: Instant) -> bool {
        self.live.get(&identity.stream_id).is_some_and(|lease| {
            lease.identity.scope == identity.scope
                && lease.identity.source_generation == identity.source_generation
                && now.saturating_duration_since(lease.observed) >= READER_TIMEOUT
        })
    }
    pub(super) fn expired_identities(&self, now: Instant) -> Vec<StreamIdentity> {
        self.live
            .values()
            .filter(|lease| self.expired(&lease.identity, now))
            .map(|lease| lease.identity.clone())
            .collect()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_deadline_and_renewal_use_only_monotonic_time() {
        let scope = crate::navigation::SessionScope {
            browser: "firefox".into(),
            profile: "owner".into(),
            private: false,
            cookie_store_id: Some("firefox-container-1".into()),
            container_id: Some("firefox-container-1".into()),
            partition_key: None,
            claim_generation: 1,
        };
        let identity = StreamIdentity {
            stream_id: "original".into(),
            scope,
            source_generation: 1,
        };
        let now = Instant::now();
        let mut leases = ReaderLeases::default();
        leases.observe(&identity, now);
        assert!(!leases.expired(&identity, now + READER_TIMEOUT - Duration::from_nanos(1)));
        assert!(leases.expired(&identity, now + READER_TIMEOUT));
        leases.observe(&identity, now + Duration::from_secs(10));
        assert!(!leases.expired(&identity, now + READER_TIMEOUT));
        let mut replaced = identity.clone();
        replaced.source_generation = 2;
        assert!(!leases.expired(&replaced, now + READER_TIMEOUT * 2));
        leases.remove(&identity.stream_id);
        assert!(leases
            .expired_identities(now + READER_TIMEOUT * 2)
            .is_empty());
    }
}
