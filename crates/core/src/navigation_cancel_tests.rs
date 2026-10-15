use super::*;
use crate::navigation::{NavigationTarget, SessionScope, StreamIdentity, StreamOperation};
#[test]
fn cancel_revalidates_new_eof_control_and_never_revives_or_publishes_cancelled_job() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let owner = uuid::Uuid::new_v4().to_string();
    let job = engine
        .command(Command::Navigate(AddJob {
            request_id: uuid::Uuid::new_v4().to_string(),
            url: "http://127.0.0.1:9/original".into(),
            filename: Some("race.bin".into()),
            directory: Some(dir.path().join("output")),
            queue: None,
            checksum: None,
            paused: true,
            context: RequestContext {
                profile: Some(owner.clone()),
                browser: Some("chromium".into()),
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
        private: false,
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
            source_generation: None,
        })
        .unwrap();
    let identity = StreamIdentity {
        stream_id: uuid::Uuid::new_v4().to_string(),
        scope: scope.clone(),
        source_generation: 1,
    };
    engine
        .command(Command::BrowserStream(StreamOperation::Begin {
            identity: identity.clone(),
            target: NavigationTarget::Job { id: id.clone() },
            filename: "race.bin".into(),
            total: Some(3),
        }))
        .unwrap();
    engine
        .command(Command::BrowserStream(StreamOperation::Chunk {
            identity: identity.clone(),
            offset: 0,
            data_base64: "YWJj".into(),
        }))
        .unwrap();
    let cancel_pause = crate::fault::install_test_pause("cancel_navigation_prelock", &id);
    let eof_pause = crate::fault::install_test_pause("browser_stream_before_finalization", &id);
    let cancel_engine = engine.clone();
    let cancel_id = id.clone();
    let cancel_thread = std::thread::spawn(move || {
        cancel_engine.command(Command::CancelNavigation {
            id: cancel_id,
            owner,
            scope: Some(scope),
            source_generation: 1,
        })
    });
    cancel_pause.reached.wait(); // Cancellation observed no finalizer control.
    let eof_engine = engine.clone();
    let eof_thread = std::thread::spawn(move || {
        eof_engine.command(Command::BrowserStream(StreamOperation::End {
            identity,
            total: 3,
            expected_sha256: None,
        }))
    });
    eof_pause.reached.wait(); // EOF registered a new control, validated the old state and dropped its job lock.
    let finalizer = engine.controls.lock().unwrap().get(&id).cloned().unwrap();
    cancel_pause.resume.wait();
    let cancelled = cancel_thread.join().unwrap().unwrap();
    assert_eq!(cancelled["cancelled"], true);
    assert_eq!(finalizer.load(Ordering::Relaxed), 2);
    assert_eq!(
        engine.job(&id).unwrap().lock().unwrap().state,
        JobState::Cancelled
    );
    let after_cancel = engine
        .command(Command::Subscribe {
            after_sequence: None,
            limit: 100,
        })
        .unwrap();
    let cursor = after_cancel["sequence"].as_u64().unwrap();
    eof_pause.resume.wait();
    assert!(eof_thread.join().unwrap().is_err());
    let job = engine.job(&id).unwrap().lock().unwrap().clone();
    assert_eq!(job.state, JobState::Cancelled);
    assert_eq!(job.bytes, 3);
    assert!(!job.destination.exists());
    assert_eq!(std::fs::read(transfer::part_path(&job)).unwrap(), b"abc");
    {
        let events = engine
            .command(Command::Subscribe {
                after_sequence: Some(cursor),
                limit: 100,
            })
            .unwrap();
        for event in events["events"].as_array().unwrap() {
            if event["job"]["id"] == id {
                assert_eq!(
                    event["job"]["state"], "cancelled",
                    "No checkpoint may revive an acknowledged cancelled job"
                );
            }
        }
    }
}
