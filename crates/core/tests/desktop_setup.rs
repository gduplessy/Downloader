use downloader_core::{
    desktop_setup::{Request, TTL_MS},
    Command, Engine,
};
fn request() -> Request {
    Request {
        nonce: uuid::Uuid::new_v4().to_string(),
        expires_at: chrono::Utc::now().timestamp_millis() + TTL_MS - 1000,
    }
}
#[test]
fn setup_event_is_fixed_expiring_and_consumed_once_across_restarts() {
    let directory = tempfile::tempdir().unwrap();
    let engine = Engine::open(directory.path()).unwrap();
    let cursor = engine.snapshot().sequence;
    let request = request();
    for _ in 0..2 {
        engine
            .command(Command::DesktopDestinationSetup(request.clone()))
            .unwrap();
    }
    let batch = engine.subscribe(Some(cursor), 100).unwrap();
    assert_eq!(batch.events.len(), 1);
    let event = serde_json::to_value(&batch.events[0]).unwrap();
    assert_eq!(event["type"], "desktop_destination_setup");
    assert_eq!(event.as_object().unwrap().len(), 5); // type, sequence, at, nonce, expiry
    let consume = || Command::ConsumeDesktopDestinationSetup {
        nonce: request.nonce.clone(),
    };
    assert_eq!(engine.command(consume()).unwrap()["accepted"], true);
    assert_eq!(engine.command(consume()).unwrap()["accepted"], false);
    engine
        .command(Command::DesktopDestinationSetup(request.clone()))
        .unwrap();
    assert_eq!(
        engine
            .subscribe(Some(batch.sequence), 100)
            .unwrap()
            .events
            .len(),
        0
    );
    drop(engine);
    let engine = Engine::open(directory.path()).unwrap();
    assert_eq!(engine.command(consume()).unwrap()["accepted"], false);
}
#[test]
fn setup_rejects_expired_future_invalid_and_extra_fields() {
    let directory = tempfile::tempdir().unwrap();
    let engine = Engine::open(directory.path()).unwrap();
    for expires_at in [0, chrono::Utc::now().timestamp_millis() + TTL_MS * 2] {
        assert!(engine
            .command(Command::DesktopDestinationSetup(Request {
                expires_at,
                ..request()
            }))
            .is_err());
    }
    assert!(engine
        .command(Command::DesktopDestinationSetup(Request {
            nonce: "arbitrary".into(),
            ..request()
        }))
        .is_err());
    assert!(serde_json::from_value::<Request>(
        serde_json::json!({"nonce": uuid::Uuid::new_v4(), "expires_at": 1, "directory": "unsafe"})
    )
    .is_err());
}

#[test]
fn desktop_setup_events_are_not_projected_to_browser_subscribers() {
    let directory = tempfile::tempdir().unwrap();
    let engine = Engine::open(directory.path()).unwrap();
    let cursor = engine.snapshot().sequence;
    engine
        .command(Command::DesktopDestinationSetup(request()))
        .unwrap();
    let result = engine
        .command(Command::BrowserSubscribe {
            owner: uuid::Uuid::new_v4().to_string(),
            private: false,
            scopes: vec![],
            after_sequence: Some(cursor),
            limit: 100,
        })
        .unwrap();
    assert!(result["events"].as_array().unwrap().is_empty());
}
