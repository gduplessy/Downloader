//! Service-owned optional CoordinatesTask integration. No page secrets or images persist.
use crate::{security, store::Store};
use anyhow::{bail, Context, Result};
use curl::easy::{Easy, List};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct ProviderSettings {
    pub enabled: bool,
    pub external_opt_in: bool,
    pub key_ref: String,
    pub total_budget_microusd: u64,
    pub task_ceiling_microusd: u64,
}
impl ProviderSettings {
    pub fn validate(&self) -> Result<()> {
        if self.key_ref.len() > 128
            || self.task_ceiling_microusd > self.total_budget_microusd
            || self.total_budget_microusd > 100_000_000
        {
            bail!("captcha_invalid_settings");
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageTask {
    pub image_base64: String,
    pub instruction: String,
    pub width: u32,
    pub height: u32,
    pub binding: String,
}
impl ImageTask {
    fn validate(&self) -> Result<()> {
        // Encoded bound includes base64 expansion; validate canonical input and decoded magic below.
        if self.image_base64.len() > 800_000
            || self.instruction.len() > 1000
            || self.width == 0
            || self.height == 0
            || self.width > 1000
            || self.height > 1000
            || self.binding.len() != 64
            || !self.binding.bytes().all(|b| b.is_ascii_hexdigit())
        {
            bail!("captcha_invalid_image");
        }
        let bytes = decode(&self.image_base64)?;
        if bytes.is_empty()
            || bytes.len() > 600_000
            || !(bytes.starts_with(b"\x89PNG\r\n\x1a\n")
                || bytes.starts_with(b"\xff\xd8\xff")
                || bytes.starts_with(b"GIF87a")
                || bytes.starts_with(b"GIF89a"))
        {
            bail!("captcha_invalid_image");
        }
        let dimensions = image_dimensions(&bytes).context("captcha_invalid_image")?;
        if dimensions != (self.width, self.height) {
            bail!("captcha_invalid_dimensions");
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ProviderRequest {
    Snapshot,
    Start { image: ImageTask },
    Poll { binding: String },
    Cancel { binding: String },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Reservation {
    binding: String,
    job: String,
    reserved: u64,
    task_id: Option<u64>,
    cancelled: bool,
    terminal: bool,
    spent: u64,
    width: u32,
    height: u32,
    polls: u32,
    next_poll: i64,
    #[serde(default)]
    point: Option<[u32; 2]>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct Ledger {
    tasks: Vec<Reservation>,
}
pub trait Transport {
    fn call(&self, method: &str, payload: &Value) -> Result<Value>;
}
pub struct HttpTransport;
impl Transport for HttpTransport {
    fn call(&self, method: &str, payload: &Value) -> Result<Value> {
        if !["createTask", "getTaskResult"].contains(&method) {
            bail!("captcha_invalid_method");
        }
        let mut easy = Easy::new();
        easy.url(&format!("https://api.2captcha.com/{method}"))?;
        easy.proxy("")?;
        easy.follow_location(false)?;
        easy.connect_timeout(Duration::from_secs(5))?;
        easy.timeout(Duration::from_secs(10))?;
        easy.post(true)?;
        let mut headers = List::new();
        headers.append("Content-Type: application/json")?;
        easy.http_headers(headers)?;
        easy.post_fields_copy(&serde_json::to_vec(payload)?)?;
        let mut bytes = Vec::new();
        {
            let mut transfer = easy.transfer();
            transfer.write_function(|chunk| {
                if bytes.len() + chunk.len() > 64 * 1024 {
                    return Ok(0);
                }
                bytes.extend_from_slice(chunk);
                Ok(chunk.len())
            })?;
            transfer.perform().context("captcha_provider_unreachable")?;
        }
        if easy.response_code()? != 200 {
            bail!("captcha_provider_http");
        }
        serde_json::from_slice(&bytes).context("captcha_provider_response")
    }
}
fn summary(ledger: &Ledger) -> Value {
    json!({"spent_microusd":ledger.tasks.iter().map(|t|t.spent).sum::<u64>(),"reserved_microusd":ledger.tasks.iter().filter(|t|!t.terminal).map(|t|t.reserved).sum::<u64>(),"pending":ledger.tasks.iter().filter(|t|!t.terminal).count()})
}
fn cost(value: &Value) -> Option<u64> {
    let s = value.as_str()?;
    let mut p = s.split('.');
    let whole = p.next()?.parse::<u64>().ok()?;
    let fraction = p.next().unwrap_or("");
    if p.next().is_some() || fraction.len() > 6 || !fraction.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    whole
        .checked_mul(1_000_000)?
        .checked_add(format!("{fraction:0<6}").parse::<u64>().ok()?)
}
/// Caller holds the engine provider mutex and has validated job owner/scope/source generation.
/// Transport is injectable only by Rust tests; production endpoint is fixed HTTPS.
pub fn handle(
    store: &Store,
    settings: &ProviderSettings,
    job: &str,
    request: ProviderRequest,
    now: i64,
    transport: &dyn Transport,
) -> Result<Value> {
    let mut ledger = store
        .all::<Ledger>("captcha_ledger")?
        .into_iter()
        .next()
        .unwrap_or_default();
    if matches!(request, ProviderRequest::Snapshot) {
        return Ok(summary(&ledger));
    }
    settings.validate()?;
    if !settings.enabled
        || !settings.external_opt_in
        || settings.total_budget_microusd == 0
        || settings.task_ceiling_microusd == 0
        || settings.key_ref.is_empty()
    {
        bail!("captcha_provider_disabled");
    }
    let (_, key) = security::credential(&settings.key_ref).context("captcha_key_unavailable")?;
    execute(
        store,
        settings,
        job,
        request,
        now,
        ProviderCall {
            transport,
            key: &key,
        },
        &mut ledger,
    )
}
struct ProviderCall<'a> {
    transport: &'a dyn Transport,
    key: &'a str,
}
fn execute(
    store: &Store,
    settings: &ProviderSettings,
    job: &str,
    request: ProviderRequest,
    now: i64,
    provider: ProviderCall<'_>,
    ledger: &mut Ledger,
) -> Result<Value> {
    let ProviderCall { transport, key } = provider;
    match request {
        ProviderRequest::Snapshot => Ok(summary(ledger)),
        ProviderRequest::Start { image } => {
            image.validate()?;
            if ledger.tasks.iter().any(|t| t.binding == image.binding) {
                bail!("captcha_duplicate_task");
            }
            let exposure = ledger
                .tasks
                .iter()
                .try_fold(0u64, |n, t| {
                    n.checked_add(if t.terminal { t.spent } else { t.reserved })
                })
                .context("captcha_budget_overflow")?;
            if exposure
                .checked_add(settings.task_ceiling_microusd)
                .is_none_or(|n| n > settings.total_budget_microusd)
            {
                bail!("captcha_budget_exhausted");
            }
            if ledger.tasks.len() >= 10000 {
                bail!("captcha_ledger_full");
            }
            ledger.tasks.push(Reservation {
                binding: image.binding.clone(),
                job: job.into(),
                reserved: settings.task_ceiling_microusd,
                task_id: None,
                cancelled: false,
                terminal: false,
                spent: 0,
                width: image.width,
                height: image.height,
                polls: 0,
                next_poll: now + 5000,
                point: None,
            });
            store.put("captcha_ledger", "main", ledger)?;
            // An ambiguous network failure leaves the reservation intact across restart.
            let response=transport.call("createTask",&json!({"clientKey":key,"task":{"type":"CoordinatesTask","body":image.image_base64,"comment":image.instruction,"minClicks":1,"maxClicks":1}}))?;
            let task = ledger.tasks.last_mut().unwrap();
            if response["errorId"].as_u64().is_some_and(|n| n != 0) {
                task.terminal = true;
                task.spent = 0;
                store.put("captcha_ledger", "main", ledger)?;
                bail!("captcha_provider_refused");
            }
            task.task_id = Some(
                response["taskId"]
                    .as_u64()
                    .filter(|n| *n > 0)
                    .context("captcha_provider_response")?,
            );
            store.put("captcha_ledger", "main", ledger)?;
            Ok(json!({"status":"processing","binding":image.binding,"budget":summary(ledger)}))
        }
        ProviderRequest::Cancel { binding } => {
            let t = ledger
                .tasks
                .iter_mut()
                .find(|t| t.binding == binding && t.job == job)
                .context("captcha_task_unavailable")?;
            t.cancelled = true;
            store.put("captcha_ledger", "main", ledger)?;
            Ok(json!({"status":"cancelled","budget":summary(ledger)}))
        }
        ProviderRequest::Poll { binding } => {
            let t = ledger
                .tasks
                .iter_mut()
                .find(|t| t.binding == binding && t.job == job)
                .context("captcha_task_unavailable")?;
            if t.terminal {
                let point = t.point;
                let cancelled = t.cancelled;
                return Ok(if cancelled {
                    json!({"status":"cancelled","budget":summary(ledger)})
                } else if let Some([x, y]) = point {
                    json!({"status":"ready","point":{"x":x,"y":y},"budget":summary(ledger)})
                } else {
                    json!({"status":"terminal","budget":summary(ledger)})
                });
            }
            if now < t.next_poll || t.polls >= 120 {
                bail!("captcha_poll_deadline");
            }
            let id = t.task_id.context("captcha_charge_uncertain")?;
            t.polls += 1;
            t.next_poll = now + 5000;
            store.put("captcha_ledger", "main", ledger)?;
            let response =
                transport.call("getTaskResult", &json!({"clientKey":key,"taskId":id}))?;
            let t = ledger
                .tasks
                .iter_mut()
                .find(|t| t.binding == binding)
                .unwrap();
            if response["status"] != "ready" {
                return Ok(json!({"status":"processing","budget":summary(ledger)}));
            }
            let charge = cost(&response["cost"]).context("captcha_charge_uncertain")?;
            // A charge above reservation trips the ceiling instead of silently releasing exposure.
            if charge > t.reserved {
                t.spent = charge;
                t.terminal = true;
                store.put("captcha_ledger", "main", ledger)?;
                bail!("captcha_cost_exceeds_reservation");
            }
            t.spent = charge;
            t.terminal = true;
            let coordinates = response["solution"]["coordinates"]
                .as_array()
                .filter(|a| a.len() == 1)
                .and_then(|a| {
                    let x = a[0]["x"].as_u64()?;
                    let y = a[0]["y"].as_u64()?;
                    (x < u64::from(t.width) && y < u64::from(t.height))
                        .then_some(json!({"x":x,"y":y}))
                });
            let cancelled = t.cancelled;
            t.point = if cancelled {
                None
            } else {
                coordinates.as_ref().map(|p| {
                    [
                        p["x"].as_u64().unwrap() as u32,
                        p["y"].as_u64().unwrap() as u32,
                    ]
                })
            };
            store.put("captcha_ledger", "main", ledger)?;
            if cancelled {
                return Ok(json!({"status":"cancelled","budget":summary(ledger)}));
            }
            Ok(
                json!({"status":"ready","point":coordinates.context("captcha_invalid_coordinates")?,"budget":summary(ledger)}),
            )
        }
    }
}
pub fn binding_digest(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
fn decode(value: &str) -> Result<Vec<u8>> {
    if value.is_empty()
        || value.len() > 600_000usize.div_ceil(3) * 4
        || !value.len().is_multiple_of(4)
    {
        bail!("Invalid captcha image chunk");
    }
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity(value.len() / 4 * 3);
    for (index, chunk) in value.as_bytes().chunks_exact(4).enumerate() {
        let mut n = 0u32;
        let mut padding = 0;
        for (i, b) in chunk.iter().enumerate() {
            let digit = if *b == b'=' {
                padding += 1;
                if i < 2 || index != value.len() / 4 - 1 {
                    bail!("Invalid base64 padding");
                }
                0
            } else {
                if padding > 0 {
                    bail!("Invalid base64 padding");
                }
                alphabet
                    .iter()
                    .position(|a| a == b)
                    .context("Invalid base64 byte")? as u32
            };
            n = (n << 6) | digit;
        }
        if padding > 2 || (padding == 1 && n & 0xff != 0) || (padding == 2 && n & 0xffff != 0) {
            bail!("Noncanonical base64 padding");
        }
        out.push((n >> 16) as u8);
        if padding < 2 {
            out.push((n >> 8) as u8);
        }
        if padding < 1 {
            out.push(n as u8);
        }
    }
    if out.len() > 600_000usize {
        bail!("captcha image chunk exceeds negotiated limit");
    }
    Ok(out)
}

fn image_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.get(12..16)? == b"IHDR" {
        return Some((
            u32::from_be_bytes(bytes.get(16..20)?.try_into().ok()?),
            u32::from_be_bytes(bytes.get(20..24)?.try_into().ok()?),
        ));
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some((
            u32::from(u16::from_le_bytes(bytes.get(6..8)?.try_into().ok()?)),
            u32::from(u16::from_le_bytes(bytes.get(8..10)?.try_into().ok()?)),
        ));
    }
    if !bytes.starts_with(b"\xff\xd8\xff") {
        return None;
    }
    let mut offset = 2;
    while offset + 4 <= bytes.len() {
        if bytes[offset] != 255 {
            return None;
        }
        let marker = bytes[offset + 1];
        offset += 2;
        if matches!(marker, 0xd8 | 0x01 | 0xd0..=0xd7) {
            continue;
        }
        if matches!(marker, 0xd9 | 0xda) {
            return None;
        }
        let length = usize::from(u16::from_be_bytes(
            bytes.get(offset..offset + 2)?.try_into().ok()?,
        ));
        if length < 2 {
            return None;
        }
        if matches!(marker,0xc0..=0xc3|0xc5..=0xc7|0xc9..=0xcb|0xcd..=0xcf) {
            return Some((
                u32::from(u16::from_be_bytes(
                    bytes.get(offset + 5..offset + 7)?.try_into().ok()?,
                )),
                u32::from(u16::from_be_bytes(
                    bytes.get(offset + 3..offset + 5)?.try_into().ok()?,
                )),
            ));
        }
        offset = offset.checked_add(length)?;
    }
    None
}
pub fn budget(store: &Store) -> Result<Value> {
    let ledger = store
        .all::<Ledger>("captcha_ledger")?
        .into_iter()
        .next()
        .unwrap_or_default();
    Ok(summary(&ledger))
}

/// Reconcile bounded outstanding charges after worker or daemon restart.
/// Numeric coordinates are bound metadata; image/instruction/key never persist.
pub fn reconcile(
    store: &Store,
    settings: &ProviderSettings,
    now: i64,
    transport: &dyn Transport,
) -> Result<()> {
    if !settings.enabled
        || !settings.external_opt_in
        || settings.total_budget_microusd == 0
        || settings.key_ref.is_empty()
    {
        return Ok(());
    }
    settings.validate()?;
    let mut ledger = store
        .all::<Ledger>("captcha_ledger")?
        .into_iter()
        .next()
        .unwrap_or_default();
    let pending = ledger
        .tasks
        .iter()
        .filter(|t| !t.terminal && t.task_id.is_some() && t.polls < 120 && t.next_poll <= now)
        .take(4)
        .map(|t| (t.job.clone(), t.binding.clone()))
        .collect::<Vec<_>>();
    if pending.is_empty() {
        return Ok(());
    }
    let (_, key) = security::credential(&settings.key_ref).context("captcha_key_unavailable")?;
    for (job, binding) in pending {
        // Errors retain reservation; each next-poll deadline was persisted before IO.
        let _ = execute(
            store,
            settings,
            &job,
            ProviderRequest::Poll { binding },
            now,
            ProviderCall {
                transport,
                key: &key,
            },
            &mut ledger,
        );
    }
    Ok(())
}

pub fn ownership(job: &crate::Job) -> Option<String> {
    let scope = job.navigation_scope.as_ref()?;
    if job.private
        || !matches!(
            job.state,
            crate::JobState::WaitingBrowser | crate::JobState::WaitingUser
        )
    {
        return None;
    }
    Some(format!(
        "{}:{}:{}:{}",
        job.id, scope.profile, scope.claim_generation, job.source_generation
    ))
}
pub fn cancel_unavailable(store: &Store, available: &[String]) -> Result<()> {
    let mut ledger = store
        .all::<Ledger>("captcha_ledger")?
        .into_iter()
        .next()
        .unwrap_or_default();
    let mut changed = false;
    for task in &mut ledger.tasks {
        if !available.contains(&task.job) && (!task.cancelled || task.point.is_some()) {
            task.cancelled = true;
            task.point = None;
            changed = true;
        }
    }
    if changed {
        store.put("captcha_ledger", "main", &ledger)?;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    struct Mock {
        calls: Mutex<Vec<String>>,
        responses: Mutex<Vec<Value>>,
        fail: bool,
    }
    impl Transport for Mock {
        fn call(&self, m: &str, _: &Value) -> Result<Value> {
            self.calls.lock().unwrap().push(m.into());
            if self.fail {
                bail!("timeout");
            }
            Ok(self.responses.lock().unwrap().remove(0))
        }
    }
    fn image() -> ImageTask {
        ImageTask {
            image_base64: "iVBORw0KGgoAAAANSUhEUgAAAGQAAABk".into(),
            instruction: "click open circle".into(),
            width: 100,
            height: 100,
            binding: "a".repeat(64),
        }
    }
    fn settings() -> ProviderSettings {
        ProviderSettings {
            enabled: true,
            external_opt_in: true,
            key_ref: "mock".into(),
            total_budget_microusd: 2000,
            task_ceiling_microusd: 1000,
        }
    }
    #[test]
    fn zero_budget_never_reads_key_or_calls() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("db")).unwrap();
        let mock = Mock {
            calls: Mutex::new(vec![]),
            responses: Mutex::new(vec![]),
            fail: false,
        };
        assert!(handle(
            &store,
            &ProviderSettings::default(),
            "job",
            ProviderRequest::Start { image: image() },
            0,
            &mock
        )
        .is_err());
        assert!(mock.calls.lock().unwrap().is_empty());
    }
    #[test]
    fn durable_uncertain_charge_prevents_duplicate_and_budget_reset() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("db")).unwrap();
        let mock = Mock {
            calls: Mutex::new(vec![]),
            responses: Mutex::new(vec![]),
            fail: true,
        };
        let mut ledger = Ledger::default();
        assert!(execute(
            &store,
            &settings(),
            "job",
            ProviderRequest::Start { image: image() },
            0,
            ProviderCall {
                transport: &mock,
                key: "test"
            },
            &mut ledger
        )
        .is_err());
        let mut restored = store.get::<Ledger>("captcha_ledger", "main").unwrap();
        assert_eq!(summary(&restored)["reserved_microusd"], 1000);
        assert!(execute(
            &store,
            &settings(),
            "job",
            ProviderRequest::Start { image: image() },
            0,
            ProviderCall {
                transport: &mock,
                key: "test"
            },
            &mut restored
        )
        .is_err());
        assert_eq!(mock.calls.lock().unwrap().len(), 1);
    }
    #[test]
    fn cancelled_late_result_accounts_cost_without_coordinates() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("db")).unwrap();
        let mock = Mock {
            calls: Mutex::new(vec![]),
            responses: Mutex::new(vec![
                json!({"errorId":0,"taskId":7}),
                json!({"status":"ready","cost":"0.0007","solution":{"coordinates":[{"x":40,"y":50}]}}),
            ]),
            fail: false,
        };
        let mut ledger = Ledger::default();
        execute(
            &store,
            &settings(),
            "job",
            ProviderRequest::Start { image: image() },
            0,
            ProviderCall {
                transport: &mock,
                key: "test",
            },
            &mut ledger,
        )
        .unwrap();
        execute(
            &store,
            &settings(),
            "job",
            ProviderRequest::Cancel {
                binding: "a".repeat(64),
            },
            1,
            ProviderCall {
                transport: &mock,
                key: "test",
            },
            &mut ledger,
        )
        .unwrap();
        let result = execute(
            &store,
            &settings(),
            "job",
            ProviderRequest::Poll {
                binding: "a".repeat(64),
            },
            5000,
            ProviderCall {
                transport: &mock,
                key: "test",
            },
            &mut ledger,
        )
        .unwrap();
        assert!(result.get("point").is_none());
        assert_eq!(result["budget"]["spent_microusd"], 700);
        assert_eq!(result["budget"]["reserved_microusd"], 0);
    }
    #[test]
    fn costs_are_exact_and_images_bounded() {
        assert_eq!(cost(&json!("0.00125")), Some(1250));
        assert!(cost(&json!("1.0000001")).is_none());
        let mut i = image();
        i.width = 1001;
        assert!(i.validate().is_err());
    }

    #[test]
    fn ready_answer_survives_restart_but_stale_owner_cannot_poll() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("db")).unwrap();
        let mock = Mock {
            calls: Mutex::new(vec![]),
            responses: Mutex::new(vec![
                json!({"errorId":0,"taskId":8}),
                json!({"status":"ready","cost":"0.0008","solution":{"coordinates":[{"x":30,"y":40}]}}),
            ]),
            fail: false,
        };
        let mut ledger = Ledger::default();
        execute(
            &store,
            &settings(),
            "job:claim1",
            ProviderRequest::Start { image: image() },
            0,
            ProviderCall {
                transport: &mock,
                key: "test",
            },
            &mut ledger,
        )
        .unwrap();
        let ready = execute(
            &store,
            &settings(),
            "job:claim1",
            ProviderRequest::Poll {
                binding: "a".repeat(64),
            },
            5000,
            ProviderCall {
                transport: &mock,
                key: "test",
            },
            &mut ledger,
        )
        .unwrap();
        assert_eq!(ready["point"]["x"], 30);
        let mut restored = store.get::<Ledger>("captcha_ledger", "main").unwrap();
        assert!(execute(
            &store,
            &settings(),
            "job:claim2",
            ProviderRequest::Poll {
                binding: "a".repeat(64)
            },
            6000,
            ProviderCall {
                transport: &mock,
                key: "test"
            },
            &mut restored
        )
        .is_err());
        let cached = execute(
            &store,
            &settings(),
            "job:claim1",
            ProviderRequest::Poll {
                binding: "a".repeat(64),
            },
            6000,
            ProviderCall {
                transport: &mock,
                key: "test",
            },
            &mut restored,
        )
        .unwrap();
        assert_eq!(cached["point"]["x"], 30);
        assert_eq!(mock.calls.lock().unwrap().len(), 2);
        cancel_unavailable(&store, &[]).unwrap();
        let mut cancelled = store.get::<Ledger>("captcha_ledger", "main").unwrap();
        let cached = execute(
            &store,
            &settings(),
            "job:claim1",
            ProviderRequest::Poll {
                binding: "a".repeat(64),
            },
            7000,
            ProviderCall {
                transport: &mock,
                key: "test",
            },
            &mut cancelled,
        )
        .unwrap();
        assert!(cached.get("point").is_none());
    }
    #[test]
    fn provider_refusal_releases_reservation_and_budget_ceiling_blocks_new_task() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("db")).unwrap();
        let mock = Mock {
            calls: Mutex::new(vec![]),
            responses: Mutex::new(vec![json!({"errorId":12})]),
            fail: false,
        };
        let mut ledger = Ledger::default();
        assert!(execute(
            &store,
            &settings(),
            "job",
            ProviderRequest::Start { image: image() },
            0,
            ProviderCall {
                transport: &mock,
                key: "test"
            },
            &mut ledger
        )
        .is_err());
        assert_eq!(summary(&ledger)["reserved_microusd"], 0);
        ledger.tasks[0].terminal = false;
        let mut limited = settings();
        limited.total_budget_microusd = 1000;
        let mut second = image();
        second.binding = "b".repeat(64);
        assert!(execute(
            &store,
            &limited,
            "job",
            ProviderRequest::Start { image: second },
            0,
            ProviderCall {
                transport: &mock,
                key: "test"
            },
            &mut ledger
        )
        .unwrap_err()
        .to_string()
        .contains("budget_exhausted"));
        assert_eq!(mock.calls.lock().unwrap().len(), 1);
        let mut oversized = image();
        oversized.width = 101;
        assert!(oversized.validate().is_err());
    }
}
