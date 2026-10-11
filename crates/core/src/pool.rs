//! Per-process bounded handle pool. Authenticated sessions never cross pool keys.
use crate::{RequestContext, Settings};
use anyhow::{bail, Result};
use curl::easy::Easy;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    ops::{Deref, DerefMut},
    sync::{
        atomic::{AtomicU8, Ordering},
        Condvar, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
struct Idle {
    key: String,
    host: String,
    easy: Easy,
    used: Instant,
}
#[derive(Default)]
struct State {
    idle: Vec<Idle>,
    active: HashMap<String, usize>,
    created: u64,
    reused: u64,
    backoff: HashMap<String, Instant>,
}
struct Pool {
    state: Mutex<State>,
    changed: Condvar,
}
fn pool() -> &'static Pool {
    static POOL: OnceLock<Pool> = OnceLock::new();
    POOL.get_or_init(|| Pool {
        state: Mutex::new(State::default()),
        changed: Condvar::new(),
    })
}
pub struct Lease {
    easy: Option<Easy>,
    key: String,
    host: String,
    cap: usize,
}
impl Deref for Lease {
    type Target = Easy;
    fn deref(&self) -> &Easy {
        self.easy.as_ref().unwrap()
    }
}
impl DerefMut for Lease {
    fn deref_mut(&mut self) -> &mut Easy {
        self.easy.as_mut().unwrap()
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        let p = pool();
        let mut s = p.state.lock().unwrap();
        *s.active.get_mut(&self.host).unwrap() -= 1;
        if s.idle.len() < self.cap {
            s.idle.push(Idle {
                key: self.key.clone(),
                host: self.host.clone(),
                easy: self.easy.take().unwrap(),
                used: Instant::now(),
            });
        }
        p.changed.notify_all();
    }
}
pub fn checkout(
    url: &str,
    context: &RequestContext,
    settings: &Settings,
    control: &AtomicU8,
) -> Result<Lease> {
    checkout_route(url, context, settings, control, None)
}
pub(crate) fn checkout_route(
    url: &str,
    context: &RequestContext,
    settings: &Settings,
    control: &AtomicU8,
    route: Option<&str>,
) -> Result<Lease> {
    let u = url::Url::parse(url)?;
    let host = u.host_str().unwrap_or("").to_owned();
    let mut hash = Sha256::new();
    hash.update(u.origin().ascii_serialization());
    hash.update(serde_json::to_vec(context)?);
    hash.update(serde_json::to_vec(&context.solver)?);
    hash.update(serde_json::to_vec(&settings.network)?);
    hash.update(settings.proxy.as_deref().unwrap_or(""));
    hash.update(settings.proxy_credential.as_deref().unwrap_or(""));
    hash.update(serde_json::to_vec(&route)?);
    for id in [&context.credential_id, &settings.proxy_credential]
        .into_iter()
        .flatten()
    {
        let value = crate::security::credential(id)?;
        hash.update(value.0);
        hash.update([0]);
        hash.update(value.1);
    }
    let key = format!("{:x}", hash.finalize());
    let cap = (settings.max_jobs * settings.connections).clamp(1, 64);
    let p = pool();
    let mut s = p.state.lock().unwrap();
    loop {
        if control.load(Ordering::Relaxed) != 0 {
            bail!("operation_cancelled");
        }
        let limit = if s.backoff.get(&host).is_some_and(|t| *t > Instant::now()) {
            1
        } else {
            settings.host_connections
        };
        if s.active.values().sum::<usize>() < cap
            && s.active.get(&host).copied().unwrap_or(0) < limit
        {
            break;
        }
        s = p
            .changed
            .wait_timeout(s, Duration::from_millis(100))
            .unwrap()
            .0;
    }
    s.idle
        .retain(|i| i.used.elapsed() < Duration::from_secs(60));
    let easy = if let Some(index) = s.idle.iter().position(|i| i.key == key) {
        s.reused += 1;
        s.idle.swap_remove(index).easy
    } else {
        s.created += 1;
        Easy::new()
    };
    while s.active.values().sum::<usize>() + s.idle.len() >= cap
        || s.idle.iter().filter(|i| i.host == host).count()
            + s.active.get(&host).copied().unwrap_or(0)
            >= settings.host_connections
    {
        if let Some(i) = s
            .idle
            .iter()
            .position(|i| i.host == host)
            .or_else(|| (!s.idle.is_empty()).then_some(0))
        {
            s.idle.swap_remove(i);
        } else {
            break;
        }
    }
    *s.active.entry(host.clone()).or_default() += 1;
    Ok(Lease {
        easy: Some(easy),
        key,
        host,
        cap,
    })
}
pub fn backoff(url: &str) {
    if let Ok(u) = url::Url::parse(url) {
        if let Some(host) = u.host_str() {
            pool()
                .state
                .lock()
                .unwrap()
                .backoff
                .insert(host.into(), Instant::now() + Duration::from_secs(60));
        }
    }
}
pub fn diagnostics() -> serde_json::Value {
    let s = pool().state.lock().unwrap();
    serde_json::json!({"active":s.active.values().sum::<usize>(),"idle":s.idle.len(),"created":s.created,"reused":s.reused})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reusable_handles_are_session_isolated_and_cancel_admission() {
        let settings = Settings::default();
        let c = AtomicU8::new(0);
        let mut a = RequestContext::default();
        a.headers.insert("Cookie".into(), "session=A".into());
        let lease = checkout("http://pool-fixture.invalid", &a, &settings, &c).unwrap();
        let raw = lease.raw();
        drop(lease);
        let lease = checkout("http://pool-fixture.invalid", &a, &settings, &c).unwrap();
        assert_eq!(lease.raw(), raw);
        drop(lease);
        a.headers.insert("Cookie".into(), "session=B".into());
        let lease = checkout("http://pool-fixture.invalid", &a, &settings, &c).unwrap();
        assert_ne!(lease.raw(), raw);
        drop(lease);
        assert!(checkout(
            "http://pool-fixture.invalid",
            &a,
            &settings,
            &AtomicU8::new(1)
        )
        .is_err());
    }
}
