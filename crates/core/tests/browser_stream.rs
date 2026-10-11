use downloader_core::{navigation::*, AddJob, Command, Engine, JobState, RequestContext};

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
            url: "http://127.0.0.1:9/consume-on-head?private_marker=fixture-secret".into(),
            filename: Some("fixture-secret-name.bin".into()),
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
    let identity = StreamIdentity {
        stream_id: uuid::Uuid::new_v4().to_string(),
        scope,
        source_generation: 1,
    };
    (dir, engine, id, identity)
}
fn frame(
    engine: &std::sync::Arc<Engine>,
    op: StreamOperation,
) -> anyhow::Result<serde_json::Value> {
    engine.command(Command::BrowserStream(op))
}
#[test]
fn original_bytes_publish_without_any_origin_probe() {
    let (dir, engine, id, identity) = setup(false);
    frame(
        &engine,
        StreamOperation::Begin {
            identity: identity.clone(),
            target: NavigationTarget::Job { id: id.clone() },
            filename: "original.bin".into(),
            total: Some(3),
        },
    )
    .unwrap();
    let ack = frame(
        &engine,
        StreamOperation::Chunk {
            identity: identity.clone(),
            offset: 0,
            data_base64: "AQID".into(),
        },
    )
    .unwrap();
    assert_eq!(ack["accepted_offset"], 3);
    let ack = frame(
        &engine,
        StreamOperation::End {
            identity,
            total: 3,
            expected_sha256: None,
        },
    )
    .unwrap();
    assert_eq!(ack["terminal"], true);
    assert_eq!(
        std::fs::read(dir.path().join("output/original.bin")).unwrap(),
        [1, 2, 3]
    );
    assert_eq!(engine.snapshot().jobs[0].state, JobState::Complete);
}
#[test]
fn eof_and_offsets_cannot_falsely_complete() {
    let (_, engine, id, identity) = setup(false);
    assert!(frame(
        &engine,
        StreamOperation::Begin {
            identity: identity.clone(),
            target: NavigationTarget::Job { id: id.clone() },
            filename: "x".into(),
            total: Some(0)
        }
    )
    .is_err());
    frame(
        &engine,
        StreamOperation::Begin {
            identity: identity.clone(),
            target: NavigationTarget::Job { id },
            filename: "x".into(),
            total: Some(3),
        },
    )
    .unwrap();
    assert!(frame(
        &engine,
        StreamOperation::Chunk {
            identity: identity.clone(),
            offset: 1,
            data_base64: "AQID".into()
        }
    )
    .is_err());
    assert!(frame(
        &engine,
        StreamOperation::End {
            identity,
            total: 3,
            expected_sha256: None
        }
    )
    .is_err());
    assert_ne!(engine.snapshot().jobs[0].state, JobState::Complete);
}
#[test]
fn lost_ack_retransmission_is_verified_and_generation_fenced() {
    let (_, engine, id, identity) = setup(false);
    frame(
        &engine,
        StreamOperation::Begin {
            identity: identity.clone(),
            target: NavigationTarget::Job { id: id.clone() },
            filename: "x".into(),
            total: Some(3),
        },
    )
    .unwrap();
    for _ in 0..2 {
        frame(
            &engine,
            StreamOperation::Chunk {
                identity: identity.clone(),
                offset: 0,
                data_base64: "AQID".into(),
            },
        )
        .unwrap();
    }
    assert!(frame(
        &engine,
        StreamOperation::Chunk {
            identity: identity.clone(),
            offset: 0,
            data_base64: "AQIE".into()
        }
    )
    .is_err());
    let mut stale = identity;
    stale.scope.claim_generation = 2;
    assert!(frame(
        &engine,
        StreamOperation::Chunk {
            identity: stale,
            offset: 3,
            data_base64: "AQID".into()
        }
    )
    .is_err());
    assert_eq!(engine.snapshot().jobs[0].bytes, 3);
}
#[test]
fn foreign_job_and_scoped_legacy_resolve_are_refused_before_probe() {
    let (_, engine, id, identity) = setup(false);
    assert!(engine
        .command(Command::Resolve {
            id: id.clone(),
            owner: identity.scope.profile.clone(),
            url: "http://127.0.0.1:9/consume".into(),
            filename: None,
            context: Default::default(),
            scope: None,
            source_generation: None
        })
        .unwrap_err()
        .to_string()
        .contains("fence"));
    assert!(engine
        .command(Command::Resolve {
            id: id.clone(),
            owner: identity.scope.profile.clone(),
            url: "http://127.0.0.1:9/consume".into(),
            filename: None,
            context: Default::default(),
            scope: Some(identity.scope.clone()),
            source_generation: Some(1)
        })
        .unwrap_err()
        .to_string()
        .contains("qualified"));
    let mut foreign = identity;
    foreign.scope.cookie_store_id = Some("1".into());
    assert!(frame(
        &engine,
        StreamOperation::Begin {
            identity: foreign,
            target: NavigationTarget::Job { id },
            filename: "x".into(),
            total: None
        }
    )
    .is_err());
}
#[test]
fn private_metadata_is_ephemeral_and_events_are_live_only() {
    let (dir, engine, id, identity) = setup(true);
    frame(
        &engine,
        StreamOperation::Begin {
            identity: identity.clone(),
            target: NavigationTarget::Job { id: id.clone() },
            filename: "private-file-marker".into(),
            total: Some(3),
        },
    )
    .unwrap();
    let live = serde_json::to_string(&engine.subscribe(None, 100).unwrap()).unwrap();
    assert!(live.contains("private-file-marker"));
    let replay = engine.subscribe(Some(0), 100).unwrap();
    assert!(serde_json::to_string(&replay)
        .unwrap()
        .contains("private-file-marker"));
    drop(engine);
    let reopened = Engine::open(dir.path()).unwrap();
    assert!(reopened.snapshot().jobs.is_empty());
    drop(reopened);
    for name in ["downloader.db", "downloader.db-wal"] {
        if let Ok(bytes) = std::fs::read(dir.path().join(name)) {
            let text = String::from_utf8_lossy(&bytes);
            assert!(!text.contains("fixture-secret"));
            assert!(!text.contains("private-file-marker"));
        }
    }
}
#[test]
fn terminal_verification_preserves_existing_destination() {
    let (dir, engine, id, identity) = setup(false);
    frame(
        &engine,
        StreamOperation::Begin {
            identity: identity.clone(),
            target: NavigationTarget::Job { id },
            filename: "original.bin".into(),
            total: Some(3),
        },
    )
    .unwrap();
    std::fs::write(dir.path().join("output/original.bin"), b"existing").unwrap();
    frame(
        &engine,
        StreamOperation::Chunk {
            identity: identity.clone(),
            offset: 0,
            data_base64: "AQID".into(),
        },
    )
    .unwrap();
    assert!(frame(
        &engine,
        StreamOperation::End {
            identity,
            total: 3,
            expected_sha256: None
        }
    )
    .is_err());
    assert_eq!(
        std::fs::read(dir.path().join("output/original.bin")).unwrap(),
        b"existing"
    );
    assert_ne!(engine.snapshot().jobs[0].state, JobState::Complete);
}
