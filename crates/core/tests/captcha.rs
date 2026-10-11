use downloader_core::{
    captcha::ProviderRequest, navigation::SessionScope, AddJob, Command, Engine, RequestContext,
};
fn setup(
    private: bool,
) -> (
    tempfile::TempDir,
    std::sync::Arc<Engine>,
    String,
    SessionScope,
) {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let owner = uuid::Uuid::new_v4().to_string();
    let value = engine
        .command(Command::Navigate(AddJob {
            request_id: uuid::Uuid::new_v4().to_string(),
            url: "http://127.0.0.1:9/nav-challenges/g4u/page".into(),
            filename: None,
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
    let id = value["id"].as_str().unwrap().to_string();
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
            owner,
            force: false,
            scope: Some(scope.clone()),
            source_generation: None,
        })
        .unwrap();
    (dir, engine, id, scope)
}
fn request(id: &str, scope: &SessionScope, generation: u64) -> Command {
    Command::Captcha {
        id: id.into(),
        owner: scope.profile.clone(),
        scope: scope.clone(),
        source_generation: generation,
        request: ProviderRequest::Snapshot,
    }
}
#[test]
fn native_captcha_requires_current_owned_claim_and_source() {
    let (_dir, engine, id, scope) = setup(false);
    assert_eq!(
        engine.command(request(&id, &scope, 1)).unwrap()["spent_microusd"],
        0
    );
    let mut changed_claim = scope.clone();
    changed_claim.claim_generation += 1;
    let mut changed_store = scope.clone();
    changed_store.cookie_store_id = Some("other".into());
    let mut changed_container = scope.clone();
    changed_container.container_id = Some("other".into());
    for changed in [changed_claim, changed_store, changed_container] {
        assert!(engine
            .command(request(&id, &changed, 1))
            .unwrap_err()
            .to_string()
            .contains("session_rejected"));
    }
    let mut other = scope.clone();
    other.profile = uuid::Uuid::new_v4().to_string();
    assert!(engine.command(request(&id, &other, 1)).is_err());
    assert!(engine.command(request(&id, &scope, 2)).is_err());
    engine.command(Command::Cancel { id: id.clone() }).unwrap();
    assert!(engine.command(request(&id, &scope, 1)).is_err());
}
#[test]
fn private_provider_is_refused() {
    let (_dir, engine, id, scope) = setup(true);
    assert!(engine
        .command(request(&id, &scope, 1))
        .unwrap_err()
        .to_string()
        .contains("session_rejected"));
    assert_eq!(
        engine.command(Command::CaptchaBudget).unwrap()["pending"],
        0
    );
}
