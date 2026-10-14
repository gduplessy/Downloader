use downloader_core::{
    navigation::*, navigation_scheduler::SchedulerRequest, AddJob, Command, Engine, JobState,
    RequestContext,
};
fn setup(
    private: bool,
) -> (
    tempfile::TempDir,
    std::sync::Arc<Engine>,
    String,
    StreamIdentity,
) {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let owner = uuid::Uuid::new_v4().to_string();
    let job = engine
        .command(Command::Navigate(AddJob {
            request_id: uuid::Uuid::new_v4().to_string(),
            url: "http://127.0.0.1:9/original".into(),
            filename: Some("cancel.bin".into()),
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
            owner,
            force: false,
            scope: Some(scope.clone()),
            source_generation: None,
        })
        .unwrap();
    (
        dir,
        engine,
        id,
        StreamIdentity {
            stream_id: uuid::Uuid::new_v4().to_string(),
            scope,
            source_generation: 1,
        },
    )
}
fn cancel(
    engine: &std::sync::Arc<Engine>,
    id: &str,
    identity: &StreamIdentity,
) -> anyhow::Result<serde_json::Value> {
    engine.command(Command::CancelNavigation {
        id: id.into(),
        owner: identity.scope.profile.clone(),
        scope: identity.scope.clone(),
        source_generation: identity.source_generation,
    })
}
#[test]
fn exact_cancel_preserves_partial_fences_late_writes_and_releases_queue() {
    for private in [false, true] {
        let (dir, engine, id, identity) = setup(private);
        engine
            .command(Command::NavigationScheduler {
                owner: identity.scope.profile.clone(),
                private_lane: private,
                scope: Some(identity.scope.clone()),
                request: SchedulerRequest::Admit {
                    id: id.clone(),
                    generation: 1,
                },
            })
            .unwrap();
        engine
            .command(Command::BrowserStream(StreamOperation::Begin {
                identity: identity.clone(),
                target: NavigationTarget::Job { id: id.clone() },
                filename: "cancel.bin".into(),
                total: Some(6),
            }))
            .unwrap();
        engine
            .command(Command::BrowserStream(StreamOperation::Chunk {
                identity: identity.clone(),
                offset: 0,
                data_base64: "YWJj".into(),
            }))
            .unwrap();
        assert_eq!(cancel(&engine, &id, &identity).unwrap()["cancelled"], true);
        cancel(&engine, &id, &identity).unwrap();
        for op in [
            StreamOperation::Chunk {
                identity: identity.clone(),
                offset: 3,
                data_base64: "ZGVm".into(),
            },
            StreamOperation::End {
                identity: identity.clone(),
                total: 3,
                expected_sha256: None,
            },
            StreamOperation::Abort {
                identity: identity.clone(),
                reason: "late".into(),
            },
        ] {
            assert!(engine.command(Command::BrowserStream(op)).is_err());
        }
        let job = engine.job(&id).unwrap().lock().unwrap().clone();
        assert_eq!(job.state, JobState::Cancelled);
        assert_eq!(job.bytes, 3);
        assert!(job.partial_created);
        assert_eq!(
            std::fs::read(downloader_core::transfer::part_path(&job)).unwrap(),
            b"abc"
        );
        assert!(!job.destination.exists());
        let queue = engine
            .command(Command::NavigationScheduler {
                owner: identity.scope.profile.clone(),
                private_lane: private,
                scope: None,
                request: SchedulerRequest::Snapshot,
            })
            .unwrap();
        assert_eq!(queue["active"], 0);
        assert!(queue["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .all(|t| t["id"] != id));
        if !private {
            drop(engine);
            let restored = Engine::open(dir.path()).unwrap();
            assert_eq!(
                restored.job(&id).unwrap().lock().unwrap().state,
                JobState::Cancelled
            );
        }
    }
}
#[test]
fn stale_foreign_private_and_recovery_fences_cannot_cancel() {
    let (_dir, engine, id, identity) = setup(false);
    for kind in ["claim", "source", "private", "profile"] {
        let mut bad = identity.clone();
        match kind {
            "claim" => bad.scope.claim_generation += 1,
            "source" => bad.source_generation += 1,
            "private" => bad.scope.private = true,
            _ => bad.scope.profile = uuid::Uuid::new_v4().to_string(),
        };
        assert!(cancel(&engine, &id, &bad).is_err());
        assert_eq!(
            engine.job(&id).unwrap().lock().unwrap().state,
            JobState::WaitingBrowser
        );
    }
    for pending in [true, false] {
        let shared = engine.job(&id).unwrap();
        {
            let mut job = shared.lock().unwrap();
            job.navigation_transfer_pending = pending;
            job.navigation_transfer_recovery = !pending;
        }
        assert!(cancel(&engine, &id, &identity).is_err());
        assert_eq!(shared.lock().unwrap().state, JobState::WaitingBrowser);
    }
}
