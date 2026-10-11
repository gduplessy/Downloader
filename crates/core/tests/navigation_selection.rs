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
                browser: Some("chromium".into()),
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
    engine
        .command(Command::ClaimNavigation {
            id: id.clone(),
            owner: owner.clone(),
            force: false,
            scope: Some(scope.clone()),
            source_generation: Some(1),
        })
        .unwrap();
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
