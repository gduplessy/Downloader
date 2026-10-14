use downloader_core::{
    navigation::SessionScope,
    navigation_selection::{AdapterIdentity, SelectionRequest},
    AddJob, Command, Engine, RequestContext,
};

fn setup(private: bool) -> (tempfile::TempDir, std::sync::Arc<Engine>, SelectionRequest) {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let owner = uuid::Uuid::new_v4().to_string();
    let page = "http://127.0.0.1:9/nav-adapters/g4u/chosen".to_string();
    let job = engine
        .command(Command::Navigate(AddJob {
            request_id: uuid::Uuid::new_v4().to_string(),
            url: page.clone(),
            filename: Some("selected.bin".into()),
            directory: Some(dir.path().join("output")),
            queue: None,
            checksum: None,
            paused: true,
            context: RequestContext {
                profile: Some(owner.clone()),
                browser: None,
                private,
                ..Default::default()
            },
            media: None,
            description: String::new(),
        }))
        .unwrap();
    let id = job["id"].as_str().unwrap().to_string();
    let scope = SessionScope {
        browser: "chromium".into(),
        profile: owner.clone(),
        private,
        cookie_store_id: Some("0".into()),
        container_id: None,
        partition_key: None,
        claim_generation: 1,
    };
    assert!(!engine.job(&id).unwrap().lock().unwrap().browser_source);
    engine
        .command(Command::ClaimNavigation {
            id: id.clone(),
            owner: owner.clone(),
            force: false,
            scope: Some(scope.clone()),
            source_generation: Some(1),
        })
        .unwrap();
    assert!(engine.job(&id).unwrap().lock().unwrap().browser_source);
    (
        dir,
        engine,
        SelectionRequest {
            id,
            owner,
            scope,
            source_generation: 1,
            page,
            selected_host: Some("ddownload.com".into()),
            adapter: AdapterIdentity {
                id: "local-fixture".into(),
                version: "1.0.0".into(),
            },
        },
    )
}

#[test]
fn selected_host_and_adapter_survive_service_reopen_without_replacing_original_page() {
    let (dir, engine, request) = setup(false);
    engine
        .command(Command::NavigationSelection(request.clone()))
        .unwrap();
    let mut later = request.clone();
    later.selected_host = None;
    engine.command(Command::NavigationSelection(later)).unwrap();
    drop(engine);
    let reopened = Engine::open(dir.path()).unwrap();
    let job = reopened.job(&request.id).unwrap();
    let job = job.lock().unwrap();
    assert_eq!(job.selected_host.as_deref(), Some("ddownload.com"));
    assert_eq!(job.navigation_adapter.as_ref(), Some(&request.adapter));
    assert_eq!(job.page_url.as_deref(), Some(request.page.as_str()));
}

#[test]
fn changed_owner_scope_source_page_or_adapter_cannot_change_selection() {
    let (_, engine, request) = setup(false);
    let mut invalid = Vec::new();
    let mut changed = request.clone();
    changed.owner = uuid::Uuid::new_v4().to_string();
    invalid.push(changed);
    let mut changed = request.clone();
    changed.scope.claim_generation += 1;
    invalid.push(changed);
    let mut changed = request.clone();
    changed.scope.cookie_store_id = Some("another".into());
    invalid.push(changed);
    let mut changed = request.clone();
    changed.source_generation += 1;
    invalid.push(changed);
    let mut changed = request.clone();
    changed.page.push_str("?replaced=true");
    invalid.push(changed);
    let mut changed = request.clone();
    changed.adapter.id = "g4u".into();
    invalid.push(changed);
    let mut changed = request.clone();
    changed.adapter.version = "2.0.0".into();
    invalid.push(changed);
    let mut changed = request.clone();
    changed.selected_host = Some("attacker.invalid".into());
    invalid.push(changed);
    for changed in invalid {
        assert!(engine
            .command(Command::NavigationSelection(changed))
            .is_err());
        assert!(engine
            .job(&request.id)
            .unwrap()
            .lock()
            .unwrap()
            .selected_host
            .is_none());
    }
    engine
        .command(Command::Cancel {
            id: request.id.clone(),
        })
        .unwrap();
    assert!(engine
        .command(Command::NavigationSelection(request))
        .is_err());
}

#[test]
fn private_selection_metadata_stays_transient() {
    let (dir, engine, request) = setup(true);
    engine
        .command(Command::NavigationSelection(request.clone()))
        .unwrap();
    assert_eq!(
        engine
            .job(&request.id)
            .unwrap()
            .lock()
            .unwrap()
            .selected_host
            .as_deref(),
        Some("ddownload.com")
    );
    drop(engine);
    assert!(Engine::open(dir.path()).unwrap().job(&request.id).is_err());
    let bytes = std::fs::read(dir.path().join("downloader.db")).unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains("ddownload.com"));
}

#[test]
fn authority_renewal_reads_only_current_generations_in_the_same_context() {
    let (_, engine, request) = setup(false);
    let shared = engine.job(&request.id).unwrap();
    {
        let mut job = shared.lock().unwrap();
        job.source_generation += 1;
        job.navigation_scope.as_mut().unwrap().claim_generation += 1;
    }
    let command = |owner: String, scope: SessionScope| Command::NavigationAuthority {
        id: request.id.clone(),
        owner,
        scope,
    };
    let value = engine
        .command(command(request.owner.clone(), request.scope.clone()))
        .unwrap();
    assert_eq!(value["source_generation"], 2);
    assert_eq!(value["scope"]["claim_generation"], 2);
    assert_eq!(value.as_object().unwrap().len(), 5);
    assert_eq!(value["navigation_transfer_pending"], false);
    assert_eq!(value["navigation_transfer_recovery"], false);
    assert!(value.get("url").is_none());
    assert!(engine
        .command(command(
            uuid::Uuid::new_v4().to_string(),
            request.scope.clone()
        ))
        .is_err());
    for changed in [
        SessionScope {
            private: true,
            ..request.scope.clone()
        },
        SessionScope {
            cookie_store_id: Some("different".into()),
            ..request.scope.clone()
        },
        SessionScope {
            container_id: Some("different".into()),
            ..request.scope.clone()
        },
        SessionScope {
            claim_generation: 3,
            ..request.scope.clone()
        },
    ] {
        assert!(engine
            .command(command(request.owner.clone(), changed))
            .is_err());
    }
    assert!(engine
        .command(Command::NavigationSelection(request))
        .is_err());
    assert_eq!(shared.lock().unwrap().source_generation, 2);
}

#[test]
fn refreshed_scoped_sources_wait_for_qualification_and_cannot_resume_into_probing() {
    let (_, engine, request) = setup(false);
    let updated = engine
        .command(Command::RefreshBrowser {
            id: request.id.clone(),
            owner: request.owner.clone(),
            url: "http://127.0.0.1:9/one-use-new".into(),
            context: RequestContext::default(),
            scope: Some(request.scope.clone()),
            source_generation: Some(1),
        })
        .unwrap();
    assert_eq!(updated["state"], "waiting_browser");
    assert_eq!(updated["source_generation"], 2);
    engine
        .command(Command::Resume {
            id: request.id.clone(),
            restart: false,
        })
        .unwrap();
    let shared = engine.job(&request.id).unwrap();
    let job = shared.lock().unwrap();
    assert_eq!(job.state, downloader_core::JobState::WaitingBrowser);
    assert!(job.replay_decision.is_none());
    assert_eq!(job.page_url.as_deref(), Some(request.page.as_str()));
    drop(job);
    assert!(engine
        .command(Command::NavigationSelection(request.clone()))
        .is_err());
}

#[test]
fn scoped_incremental_subscription_preserves_a_null_snapshot() {
    let (_, engine, request) = setup(false);
    let snapshot = engine
        .command(Command::BrowserSnapshot {
            owner: request.owner.clone(),
            private: false,
            scopes: vec![request.scope.clone()],
        })
        .unwrap();
    let batch = engine
        .command(Command::BrowserSubscribe {
            owner: request.owner.clone(),
            private: false,
            scopes: vec![request.scope.clone()],
            after_sequence: Some(snapshot["sequence"].as_u64().unwrap()),
            limit: 50,
        })
        .unwrap();
    assert!(batch["snapshot"].is_null(), "{}", batch);
    assert!(batch["events"].is_array());
    engine
        .command(Command::NavigationSelection(request.clone()))
        .unwrap();
    let changed = engine
        .command(Command::BrowserSubscribe {
            owner: request.owner.clone(),
            private: false,
            scopes: vec![request.scope],
            after_sequence: Some(snapshot["sequence"].as_u64().unwrap()),
            limit: 50,
        })
        .unwrap();
    assert!(changed["snapshot"].is_null());
    assert!(changed["events"]
        .as_array()
        .unwrap()
        .iter()
        .any(|event| event["job"]["selected_host"] == "ddownload.com"));
}
