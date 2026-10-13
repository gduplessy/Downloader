use downloader_core::{
    navigation::{NavigationTarget, PartitionKey, SessionScope, StreamIdentity, StreamOperation},
    navigation_scheduler::SchedulerRequest,
    navigation_selection::{AdapterIdentity, SelectionRequest},
    navigation_transfer::{
        self, BrowserRequest, DesktopRequest, Prepared, Runtime, MAX_TICKETS, TICKET_TTL_MS,
    },
    site_accounts::{
        Account, BrowserAction, BrowserRequest as AccountRequest, DesktopRequest as AccountDesktop,
        Mode,
    },
    AddJob, Command, Engine, Job, JobState, RequestContext,
};
use std::sync::Arc;

struct Fixture {
    dir: Arc<tempfile::TempDir>,
    engine: Arc<Engine>,
    id: String,
    scope: SessionScope,
}
fn setup(private: bool) -> Fixture {
    let dir = Arc::new(tempfile::tempdir().unwrap());
    let engine = Engine::open(dir.path()).unwrap();
    let owner = uuid::Uuid::new_v4().to_string();
    let page = "http://127.0.0.1:9/nav-adapters/g4u/transfer";
    let result = engine
        .command(Command::Navigate(AddJob {
            request_id: uuid::Uuid::new_v4().to_string(),
            url: page.into(),
            filename: Some("permitted-transfer.bin".into()),
            directory: Some(dir.path().join("output")),
            queue: None,
            checksum: None,
            paused: true,
            media: None,
            description: String::new(),
            context: RequestContext {
                profile: Some(owner.clone()),
                private,
                credential_id: Some("fixture-ref-not-a-password".into()),
                ..Default::default()
            },
        }))
        .unwrap();
    let id = result["id"].as_str().unwrap().to_string();
    let scope = SessionScope {
        browser: "chromium".into(),
        profile: owner.clone(),
        private,
        cookie_store_id: Some(if private { "1" } else { "0" }.into()),
        container_id: None,
        partition_key: Some(PartitionKey {
            top_level_site: "http://127.0.0.1:9".into(),
            has_cross_site_ancestor: Some(false),
        }),
        claim_generation: 1,
    };
    engine
        .command(Command::ClaimNavigation {
            id: id.clone(),
            owner,
            force: false,
            scope: Some(scope.clone()),
            source_generation: Some(1),
        })
        .unwrap();
    Fixture {
        dir,
        engine,
        id,
        scope,
    }
}
fn job(f: &Fixture) -> Job {
    f.engine.job(&f.id).unwrap().lock().unwrap().clone()
}
fn prepare(f: &Fixture) -> Prepared {
    let j = job(f);
    serde_json::from_value(
        f.engine
            .command(Command::NavigationTransfer(DesktopRequest::Prepare {
                id: f.id.clone(),
                expected_scope: j.navigation_scope.unwrap(),
                expected_source_generation: j.source_generation,
                consent: true,
            }))
            .unwrap(),
    )
    .unwrap()
}
fn recipient(private: bool) -> SessionScope {
    SessionScope {
        browser: "firefox".into(),
        profile: uuid::Uuid::new_v4().to_string(),
        private,
        cookie_store_id: Some(
            if private {
                "firefox-private"
            } else {
                "firefox-container-2"
            }
            .into(),
        ),
        container_id: (!private).then(|| "firefox-container-2".into()),
        partition_key: None,
        claim_generation: 1,
    }
}
fn preview(f: &Fixture, p: &Prepared, scope: &SessionScope) -> anyhow::Result<serde_json::Value> {
    f.engine.command(Command::BrowserNavigationTransfer(
        BrowserRequest::Preview {
            token: p.token.clone(),
            recipient_scope: scope.clone(),
        },
    ))
}
fn accept(
    f: &Fixture,
    p: &Prepared,
    scope: &SessionScope,
    consent: bool,
) -> anyhow::Result<serde_json::Value> {
    f.engine
        .command(Command::BrowserNavigationTransfer(BrowserRequest::Accept {
            token: p.token.clone(),
            recipient_scope: scope.clone(),
            consent,
        }))
}
fn continue_job(f: &Fixture, p: &Prepared, consent: bool) -> anyhow::Result<serde_json::Value> {
    f.engine.command(Command::BrowserNavigationTransfer(
        BrowserRequest::Continue {
            id: f.id.clone(),
            scope: p.scope.clone(),
            source_generation: p.source_generation,
            consent,
        },
    ))
}
fn cancel(f: &Fixture, p: &Prepared) {
    f.engine
        .command(Command::NavigationTransfer(DesktopRequest::Cancel {
            id: f.id.clone(),
            expected_scope: p.scope.clone(),
            expected_source_generation: p.source_generation,
        }))
        .unwrap();
}
fn assert_browser_fenced(f: &Fixture, scope: &SessionScope, source: u64) {
    let commands = vec![
        Command::ClaimNavigation {
            id: f.id.clone(),
            owner: scope.profile.clone(),
            force: true,
            scope: Some(scope.clone()),
            source_generation: Some(source),
        },
        Command::BrowserStatus {
            id: f.id.clone(),
            owner: scope.profile.clone(),
            state: JobState::BrowserDownloading,
            message: None,
            bytes: 0,
            total: None,
            url: None,
            scope: Some(scope.clone()),
            source_generation: Some(source),
        },
        Command::RefreshBrowser {
            id: f.id.clone(),
            owner: scope.profile.clone(),
            url: "http://127.0.0.1:9/forbidden-refresh".into(),
            context: RequestContext::default(),
            scope: Some(scope.clone()),
            source_generation: Some(source),
        },
        Command::SolveChallenge {
            id: f.id.clone(),
            owner: Some(scope.profile.clone()),
            url: None,
            automatic: true,
            scope: Some(scope.clone()),
            source_generation: Some(source),
        },
        Command::NavigationSelection(SelectionRequest {
            id: f.id.clone(),
            owner: scope.profile.clone(),
            scope: scope.clone(),
            source_generation: source,
            page: job(f).page_url.unwrap(),
            selected_host: Some("ddownload.com".into()),
            adapter: AdapterIdentity {
                id: "local-fixture".into(),
                version: "1.0.0".into(),
            },
        }),
        Command::BrowserAccount(AccountRequest {
            job_id: f.id.clone(),
            owner: scope.profile.clone(),
            scope: scope.clone(),
            source_generation: source,
            request: BrowserAction::Selection,
        }),
        Command::NavigationScheduler {
            owner: scope.profile.clone(),
            private_lane: scope.private,
            scope: Some(scope.clone()),
            request: SchedulerRequest::Admit {
                id: f.id.clone(),
                generation: source,
            },
        },
        Command::BrowserStream(StreamOperation::Begin {
            identity: StreamIdentity {
                stream_id: uuid::Uuid::new_v4().to_string(),
                scope: scope.clone(),
                source_generation: source,
            },
            target: NavigationTarget::Job { id: f.id.clone() },
            filename: "must-not-publish.bin".into(),
            total: Some(1),
        }),
    ];
    for command in commands {
        assert!(
            f.engine.command(command.clone()).is_err(),
            "unexpectedly accepted {command:?}"
        );
    }
    assert_eq!(job(f).bytes, 0);
    assert!(!f.dir.path().join("output/must-not-publish.bin").exists());
}

#[test]
fn prepare_advances_fences_discards_refs_and_keeps_provenance_and_private_lane() {
    let f = setup(false);
    let original = job(&f);
    let p = prepare(&f);
    assert_eq!(p.source_generation, original.source_generation + 1);
    assert_eq!(p.scope.claim_generation, f.scope.claim_generation + 1);
    let frozen = job(&f);
    assert!(frozen.navigation_transfer_pending);
    assert!(!frozen.navigation_transfer_recovery);
    assert_eq!(frozen.state, JobState::WaitingUser);
    assert_eq!(frozen.page_url, original.page_url);
    assert_eq!(frozen.navigation_url, original.page_url);
    assert_eq!(frozen.url, original.page_url.unwrap());
    assert_eq!(frozen.private, original.private);
    assert_eq!(frozen.credential_id, None);
    assert!(frozen.replay_decision.is_none());
    assert_eq!(frozen.solver_session, None);
    assert_browser_fenced(&f, &f.scope, 1);
    assert_browser_fenced(&f, &p.scope, p.source_generation);
    assert!(!serde_json::to_string(&f.engine.snapshot())
        .unwrap()
        .contains(&p.token));
    assert!(!format!("{p:?}").contains(&p.token));
    assert!(!format!(
        "{:?}",
        BrowserRequest::Preview {
            token: p.token.clone(),
            recipient_scope: recipient(false)
        }
    )
    .contains(&p.token));
}

#[test]
fn accept_requires_preview_consent_first_recipient_and_consumes_once() {
    let f = setup(false);
    let p = prepare(&f);
    let target = recipient(false);
    assert!(accept(&f, &p, &target, true).is_err());
    let view = preview(&f, &p, &target).unwrap();
    assert_eq!(view["page_url"], job(&f).page_url.clone().unwrap());
    assert!(accept(&f, &p, &target, false).is_err());
    assert!(preview(&f, &p, &recipient(false)).is_err());
    let mut wrong_store = target.clone();
    wrong_store.cookie_store_id = Some("firefox-container-3".into());
    assert!(accept(&f, &p, &wrong_store, true).is_err());
    let mut wrong_container = target.clone();
    wrong_container.container_id = Some("firefox-container-3".into());
    assert!(accept(&f, &p, &wrong_container, true).is_err());
    let accepted = accept(&f, &p, &target, true).unwrap();
    assert_eq!(accepted["owner"], target.profile);
    assert_eq!(
        accepted["scope"]["claim_generation"],
        p.scope.claim_generation + 1
    );
    let moved = job(&f);
    assert_eq!(moved.state, JobState::WaitingBrowser);
    assert!(!moved.navigation_transfer_pending);
    assert!(!moved.navigation_transfer_recovery);
    assert_eq!(
        moved.navigation_scope.as_ref().unwrap().cookie_store_id,
        target.cookie_store_id
    );
    assert_eq!(
        moved.navigation_scope.as_ref().unwrap().container_id,
        target.container_id
    );
    assert_eq!(moved.navigation_scope.as_ref().unwrap().partition_key, None);
    assert_eq!(moved.credential_id, None);
    assert!(moved.replay_decision.is_none());
    assert!(preview(&f, &p, &target).is_err());
    assert!(accept(&f, &p, &target, true).is_err());
    assert_browser_fenced(&f, &p.scope, p.source_generation);
}

#[test]
fn private_lane_mismatch_refuses_before_preview_disclosure_and_private_state_never_persists() {
    let f = setup(true);
    let p = prepare(&f);
    let error = preview(&f, &p, &recipient(false)).unwrap_err().to_string();
    assert_eq!(error, "transfer_lane_mismatch");
    assert!(!error.contains("transfer.bin"));
    assert!(!error.contains(&p.token));
    let target = recipient(true);
    preview(&f, &p, &target).unwrap();
    accept(&f, &p, &target, true).unwrap();
    assert!(job(&f).private);
    let id = f.id.clone();
    let path = f.dir.path().to_path_buf();
    drop(f.engine);
    let reopened = Engine::open(&path).unwrap();
    assert!(reopened.job(&id).is_err());
}

#[test]
fn cancel_and_expiry_keep_manual_recovery_until_exact_explicit_continue() {
    for expired in [false, true] {
        let f = setup(false);
        let p = prepare(&f);
        if expired {
            navigation_transfer::sweep_at(&f.engine, p.expires_at_ms).unwrap();
        } else {
            cancel(&f, &p);
        }
        assert!(!job(&f).navigation_transfer_pending);
        assert!(job(&f).navigation_transfer_recovery);
        assert_eq!(job(&f).state, JobState::WaitingUser);
        assert_browser_fenced(&f, &p.scope, p.source_generation);
        assert!(continue_job(&f, &p, false).is_err());
        let mut stale = p.clone();
        stale.source_generation -= 1;
        assert!(continue_job(&f, &stale, true).is_err());
        continue_job(&f, &p, true).unwrap();
        assert!(!job(&f).navigation_transfer_recovery);
        assert_eq!(job(&f).state, JobState::WaitingBrowser);
        assert!(preview(&f, &p, &recipient(false)).is_err());
        assert_browser_fenced(&f, &f.scope, 1);
    }
}

#[test]
fn restarted_pending_ticket_is_unavailable_and_never_automatically_replays() {
    let f = setup(false);
    let p = prepare(&f);
    let id = f.id.clone();
    let path = f.dir.path().to_path_buf();
    drop(f.engine);
    let engine = Engine::open(&path).unwrap();
    let reopened = Fixture {
        dir: f.dir,
        engine,
        id,
        scope: f.scope,
    };
    assert!(!job(&reopened).navigation_transfer_pending);
    assert!(job(&reopened).navigation_transfer_recovery);
    assert_eq!(job(&reopened).state, JobState::WaitingUser);
    assert_eq!(job(&reopened).source_generation, p.source_generation);
    assert!(preview(&reopened, &p, &recipient(false)).is_err());
    assert_browser_fenced(&reopened, &p.scope, p.source_generation);
    continue_job(&reopened, &p, true).unwrap();
    assert_eq!(job(&reopened).state, JobState::WaitingBrowser);
}

#[test]
fn terminal_cancellation_is_not_revived_by_expiry_or_restart() {
    for restart in [false, true] {
        let f = setup(false);
        let p = prepare(&f);
        f.engine
            .command(Command::Cancel { id: f.id.clone() })
            .unwrap();
        if restart {
            let path = f.dir.path().to_path_buf();
            let id = f.id.clone();
            drop(f.engine);
            let reopened = Engine::open(&path).unwrap();
            let terminal = reopened.job(&id).unwrap().lock().unwrap().clone();
            assert_eq!(terminal.state, JobState::Cancelled);
            assert!(!terminal.navigation_transfer_recovery);
        } else {
            navigation_transfer::sweep_at(&f.engine, p.expires_at_ms).unwrap();
            assert_eq!(job(&f).state, JobState::Cancelled);
            assert!(!job(&f).navigation_transfer_recovery);
        }
    }
}

#[test]
fn active_partial_and_stale_sources_do_not_prepare_or_change_authority() {
    let f = setup(false);
    let original = job(&f);
    for state in [
        JobState::BrowserDownloading,
        JobState::Verifying,
        JobState::Assembling,
        JobState::Scanning,
        JobState::Downloading,
        JobState::Complete,
        JobState::WaitingAuthentication,
    ] {
        f.engine.job(&f.id).unwrap().lock().unwrap().state = state;
        assert!(f
            .engine
            .command(Command::NavigationTransfer(DesktopRequest::Prepare {
                id: f.id.clone(),
                expected_scope: f.scope.clone(),
                expected_source_generation: 1,
                consent: true
            }))
            .is_err());
        assert_eq!(job(&f).source_generation, 1);
        assert!(!job(&f).navigation_transfer_pending);
    }
    *f.engine.job(&f.id).unwrap().lock().unwrap() = original.clone();
    f.engine.job(&f.id).unwrap().lock().unwrap().bytes = 1;
    assert!(f
        .engine
        .command(Command::NavigationTransfer(DesktopRequest::Prepare {
            id: f.id.clone(),
            expected_scope: f.scope.clone(),
            expected_source_generation: 1,
            consent: true
        }))
        .is_err());
    *f.engine.job(&f.id).unwrap().lock().unwrap() = original;
    assert!(f
        .engine
        .command(Command::NavigationTransfer(DesktopRequest::Prepare {
            id: f.id.clone(),
            expected_scope: f.scope.clone(),
            expected_source_generation: 2,
            consent: true
        }))
        .is_err());
    assert!(f
        .engine
        .command(Command::NavigationTransfer(DesktopRequest::Prepare {
            id: f.id.clone(),
            expected_scope: f.scope.clone(),
            expected_source_generation: 1,
            consent: false
        }))
        .is_err());
    assert_eq!(job(&f).source_generation, 1);
}

#[test]
fn transfer_removes_account_association_but_does_not_delete_saved_account_metadata() {
    let f = setup(false);
    let account = Account {
        revision: 0,
        id: uuid::Uuid::new_v4().to_string(),
        label: "Permitted metadata fixture".into(),
        origin: "http://127.0.0.1:9".into(),
        provider: "local-fixture".into(),
        account_id: "fixture-alice".into(),
        scope: f.scope.clone(),
        saved_fill: false,
        credential_ref: None,
    };
    let id = account.id.clone();
    f.engine
        .command(Command::SiteAccount(AccountDesktop::Save {
            account: Box::new(account),
            password: None,
        }))
        .unwrap();
    f.engine
        .command(Command::SiteAccount(AccountDesktop::Select {
            job_id: f.id.clone(),
            account_id: Some(id.clone()),
            mode: Mode::Premium,
        }))
        .unwrap();
    let p = prepare(&f);
    assert!(f
        .engine
        .store
        .lock()
        .unwrap()
        .get::<serde_json::Value>("site_account_selection", &f.id)
        .is_err());
    assert!(f
        .engine
        .store
        .lock()
        .unwrap()
        .get::<Account>("site_account", &id)
        .is_ok());
    cancel(&f, &p);
    continue_job(&f, &p, true).unwrap();
    let selected = f
        .engine
        .command(Command::BrowserAccount(AccountRequest {
            job_id: f.id.clone(),
            owner: p.scope.profile.clone(),
            scope: p.scope.clone(),
            source_generation: p.source_generation,
            request: BrowserAction::Selection,
        }))
        .unwrap();
    assert!(selected.is_null());
}

#[test]
fn bounded_runtime_expiry_debug_and_missing_cookie_scope_are_fail_closed() {
    let f = setup(false);
    let baseline = job(&f);
    let mut runtime = Runtime::default();
    let mut tickets = Vec::new();
    for _ in 0..MAX_TICKETS {
        let mut fence =
            navigation_transfer::prepare_fence(&baseline, false, &f.scope, 1, true).unwrap();
        fence.id = uuid::Uuid::new_v4().to_string();
        tickets.push(runtime.prepare(fence, 1000).unwrap());
    }
    assert_eq!(runtime.len(), MAX_TICKETS);
    let mut extra =
        navigation_transfer::prepare_fence(&baseline, false, &f.scope, 1, true).unwrap();
    extra.id = uuid::Uuid::new_v4().to_string();
    assert!(runtime.prepare(extra, 1000).is_err());
    let mut target = recipient(false);
    target.cookie_store_id = None;
    assert!(runtime.preview(&tickets[0].token, &target, 1000).is_err());
    assert!(!format!("{runtime:?}").contains(&tickets[0].token));
    assert_eq!(runtime.expire(1000 + TICKET_TTL_MS).len(), MAX_TICKETS);
    assert!(runtime.is_empty());
    assert!(runtime.fence(&tickets[0].token, 1000).is_err());
}

fn fail_job_writes(f: &Fixture) -> rusqlite::Connection {
    let connection = rusqlite::Connection::open(f.dir.path().join("downloader.db")).unwrap();
    let id = uuid::Uuid::parse_str(&f.id).unwrap().to_string();
    connection.execute_batch(&format!("CREATE TRIGGER transfer_fixture_write_failure BEFORE INSERT ON records WHEN NEW.kind='job' AND NEW.id='{id}' BEGIN SELECT RAISE(FAIL, 'permitted fixture write failure'); END;")).unwrap();
    connection
}
fn allow_job_writes(connection: &rusqlite::Connection) {
    connection
        .execute_batch("DROP TRIGGER transfer_fixture_write_failure;")
        .unwrap();
}
fn persisted_job(f: &Fixture) -> Job {
    f.engine.store.lock().unwrap().get("job", &f.id).unwrap()
}
#[test]
fn failed_expiry_persistence_retries_the_manual_gate_without_replay() {
    let f = setup(false);
    let p = prepare(&f);
    let connection = fail_job_writes(&f);
    assert!(navigation_transfer::sweep_at(&f.engine, p.expires_at_ms).is_err());
    assert!(job(&f).navigation_transfer_recovery);
    assert!(persisted_job(&f).navigation_transfer_pending);
    assert_browser_fenced(&f, &p.scope, p.source_generation);
    allow_job_writes(&connection);
    // Use the actual clock now; the expired ticket's retained work must retry even
    // though this deterministic fixture's first sweep used a future wall clock.
    navigation_transfer::sweep(&f.engine).unwrap();
    let durable = persisted_job(&f);
    assert!(!durable.navigation_transfer_pending);
    assert!(durable.navigation_transfer_recovery);
    assert_eq!(durable.state, JobState::WaitingUser);
    assert!(preview(&f, &p, &recipient(false)).is_err());
    continue_job(&f, &p, true).unwrap();
    navigation_transfer::sweep(&f.engine).unwrap();
    assert_eq!(job(&f).state, JobState::WaitingBrowser);
    assert!(!job(&f).navigation_transfer_recovery);
}
#[test]
fn failed_cancel_persistence_keeps_token_burned_and_retries_recovery() {
    let f = setup(false);
    let p = prepare(&f);
    let connection = fail_job_writes(&f);
    assert!(f
        .engine
        .command(Command::NavigationTransfer(DesktopRequest::Cancel {
            id: f.id.clone(),
            expected_scope: p.scope.clone(),
            expected_source_generation: p.source_generation,
        }))
        .is_err());
    assert!(job(&f).navigation_transfer_recovery);
    allow_job_writes(&connection);
    navigation_transfer::sweep(&f.engine).unwrap();
    assert!(!persisted_job(&f).navigation_transfer_pending);
    assert!(persisted_job(&f).navigation_transfer_recovery);
    assert!(preview(&f, &p, &recipient(false)).is_err());
}
#[test]
fn failed_acceptance_restores_original_frozen_owner_and_retries_manual_persistence() {
    let f = setup(false);
    let p = prepare(&f);
    let target = recipient(false);
    preview(&f, &p, &target).unwrap();
    let connection = fail_job_writes(&f);
    assert!(accept(&f, &p, &target, true).is_err());
    assert_eq!(
        job(&f).navigation_owner.as_deref(),
        Some(f.scope.profile.as_str())
    );
    assert_eq!(job(&f).navigation_scope.as_ref(), Some(&p.scope));
    assert!(job(&f).navigation_transfer_recovery);
    allow_job_writes(&connection);
    navigation_transfer::sweep(&f.engine).unwrap();
    let durable = persisted_job(&f);
    assert_eq!(durable.navigation_scope.as_ref(), Some(&p.scope));
    assert!(!durable.navigation_transfer_pending);
    assert!(durable.navigation_transfer_recovery);
    assert!(accept(&f, &p, &target, true).is_err());
}
#[test]
fn expiry_failure_does_not_discard_other_jobs_recovery() {
    let f = setup(false);
    let first = prepare(&f);
    let scope = recipient(false);
    let added = f
        .engine
        .command(Command::Navigate(AddJob {
            request_id: uuid::Uuid::new_v4().to_string(),
            url: "http://127.0.0.1:9/nav-adapters/g4u/other".into(),
            filename: None,
            directory: Some(f.dir.path().join("output")),
            queue: None,
            checksum: None,
            paused: true,
            media: None,
            description: String::new(),
            context: RequestContext {
                profile: Some(scope.profile.clone()),
                ..Default::default()
            },
        }))
        .unwrap();
    let id = added["id"].as_str().unwrap().to_string();
    f.engine
        .command(Command::ClaimNavigation {
            id: id.clone(),
            owner: scope.profile.clone(),
            force: false,
            scope: Some(scope.clone()),
            source_generation: Some(1),
        })
        .unwrap();
    let other = Fixture {
        dir: f.dir.clone(),
        engine: f.engine.clone(),
        id,
        scope,
    };
    let second = prepare(&other);
    let connection = fail_job_writes(&f);
    let deadline = first.expires_at_ms.max(second.expires_at_ms);
    assert!(navigation_transfer::sweep_at(&f.engine, deadline).is_err());
    // Both tickets expire in one runtime. A write failure for one job must not
    // drop or prevent successful persistence of the other recovery record.
    assert!(persisted_job(&other).navigation_transfer_recovery);
    assert!(!persisted_job(&other).navigation_transfer_pending);
    allow_job_writes(&connection);
    navigation_transfer::sweep(&f.engine).unwrap();
    assert!(persisted_job(&f).navigation_transfer_recovery);
}

#[test]
fn failed_terminal_marker_persistence_retries_without_reviving_cancelled_job() {
    let f = setup(false);
    let p = prepare(&f);
    f.engine
        .command(Command::Cancel { id: f.id.clone() })
        .unwrap();
    let connection = fail_job_writes(&f);
    assert!(navigation_transfer::sweep_at(&f.engine, p.expires_at_ms).is_err());
    assert_eq!(job(&f).state, JobState::Cancelled);
    assert!(persisted_job(&f).navigation_transfer_pending);
    allow_job_writes(&connection);
    navigation_transfer::sweep(&f.engine).unwrap();
    let durable = persisted_job(&f);
    assert_eq!(durable.state, JobState::Cancelled);
    assert!(!durable.navigation_transfer_pending);
    assert!(!durable.navigation_transfer_recovery);
}
#[test]
fn failed_explicit_continue_restores_manual_gate_and_requires_a_new_intent() {
    let f = setup(false);
    let p = prepare(&f);
    cancel(&f, &p);
    let connection = fail_job_writes(&f);
    assert!(continue_job(&f, &p, true).is_err());
    assert_eq!(job(&f).state, JobState::WaitingUser);
    assert!(job(&f).navigation_transfer_recovery);
    assert!(persisted_job(&f).navigation_transfer_recovery);
    allow_job_writes(&connection);
    navigation_transfer::sweep(&f.engine).unwrap();
    assert!(job(&f).navigation_transfer_recovery);
    assert_browser_fenced(&f, &p.scope, p.source_generation);
    continue_job(&f, &p, true).unwrap();
    assert_eq!(job(&f).state, JobState::WaitingBrowser);
}

#[test]
fn failed_prepare_never_returns_ticket_and_retries_cleared_refs_with_frozen_manual_authority() {
    let f = setup(false);
    let original = job(&f);
    let connection = fail_job_writes(&f);
    let result = f
        .engine
        .command(Command::NavigationTransfer(DesktopRequest::Prepare {
            id: f.id.clone(),
            expected_scope: f.scope.clone(),
            expected_source_generation: 1,
            consent: true,
        }));
    assert!(result.is_err());
    let failed = job(&f);
    assert_eq!(failed.source_generation, original.source_generation + 1);
    assert_eq!(
        failed.navigation_scope.as_ref().unwrap().claim_generation,
        f.scope.claim_generation + 1
    );
    assert!(!failed.navigation_transfer_pending);
    assert!(failed.navigation_transfer_recovery);
    assert!(failed.credential_id.is_none());
    allow_job_writes(&connection);
    navigation_transfer::sweep(&f.engine).unwrap();
    let durable = persisted_job(&f);
    assert_eq!(durable.source_generation, failed.source_generation);
    assert!(!durable.navigation_transfer_pending);
    assert!(durable.navigation_transfer_recovery);
    assert!(durable.credential_id.is_none());
    assert_browser_fenced(
        &f,
        durable.navigation_scope.as_ref().unwrap(),
        durable.source_generation,
    );
}
