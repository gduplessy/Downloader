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
fn desktop_source_replacement_leaves_actionable_recovery_and_fences_old_bytes() {
    let (dir, engine, id, identity) = setup(false);
    frame(
        &engine,
        StreamOperation::Begin {
            identity: identity.clone(),
            target: NavigationTarget::Job { id: id.clone() },
            filename: "replacement.bin".into(),
            total: Some(6),
        },
    )
    .unwrap();
    frame(
        &engine,
        StreamOperation::Chunk {
            identity: identity.clone(),
            offset: 0,
            data_base64: "AQID".into(),
        },
    )
    .unwrap();
    engine
        .command(Command::Refresh {
            id: id.clone(),
            url: "http://127.0.0.1:9/fresh-action".into(),
            context: RequestContext::default(),
        })
        .unwrap();
    let current = engine
        .snapshot()
        .jobs
        .into_iter()
        .find(|job| job.id == id)
        .unwrap();
    assert_eq!(current.state, JobState::WaitingUser);
    assert_eq!(current.source_generation, 2);
    assert_eq!(current.navigation_scope.unwrap().claim_generation, 2);
    assert!(current
        .error
        .unwrap()
        .starts_with("browser_source_replaced:"));
    assert!(frame(
        &engine,
        StreamOperation::Chunk {
            identity: identity.clone(),
            offset: 3,
            data_base64: "BAUG".into(),
        }
    )
    .is_err());
    assert!(frame(
        &engine,
        StreamOperation::End {
            identity,
            total: 3,
            expected_sha256: None,
        }
    )
    .is_err());
    assert!(!dir.path().join("output/replacement.bin").exists());
    assert_eq!(engine.snapshot().jobs[0].state, JobState::WaitingUser);
}
#[test]
fn browser_recovery_status_preserves_durable_partial_progress() {
    let (_, engine, id, identity) = setup(false);
    frame(
        &engine,
        StreamOperation::Begin {
            identity: identity.clone(),
            target: NavigationTarget::Job { id: id.clone() },
            filename: "partial.bin".into(),
            total: Some(6),
        },
    )
    .unwrap();
    frame(
        &engine,
        StreamOperation::Chunk {
            identity: identity.clone(),
            offset: 0,
            data_base64: "AQID".into(),
        },
    )
    .unwrap();
    engine
        .command(Command::BrowserStatus {
            id,
            owner: identity.scope.profile.clone(),
            state: JobState::WaitingUser,
            message: Some("browser_document_replaced".into()),
            bytes: 0,
            total: None,
            url: None,
            scope: Some(identity.scope),
            source_generation: Some(identity.source_generation),
        })
        .unwrap();
    let current = &engine.snapshot().jobs[0];
    assert_eq!(current.state, JobState::WaitingUser);
    assert_eq!(current.bytes, 3);
    assert_eq!(current.total, Some(6));
    assert!(current.verified_sha256.is_none());
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
#[test]
fn forced_claim_advances_fence_and_rejects_old_status() {
    let (_, engine, id, identity) = setup(false);
    let claim = engine
        .command(Command::ClaimNavigation {
            id: id.clone(),
            owner: identity.scope.profile.clone(),
            force: true,
            scope: Some(identity.scope.clone()),
            source_generation: Some(1),
        })
        .unwrap();
    assert_eq!(claim["scope"]["claim_generation"], 2);
    let result = engine.command(Command::BrowserStatus {
        id: id.clone(),
        owner: identity.scope.profile.clone(),
        state: JobState::WaitingUser,
        message: None,
        bytes: 0,
        total: None,
        url: None,
        scope: Some(identity.scope.clone()),
        source_generation: Some(1),
    });
    assert!(result.unwrap_err().to_string().contains("fence"));
    let mut invalid = identity.scope;
    invalid.private = true;
    assert!(engine
        .command(Command::ClaimNavigation {
            id,
            owner: invalid.profile.clone(),
            force: true,
            scope: Some(invalid),
            source_generation: Some(1)
        })
        .is_err());
}

#[test]
fn browser_snapshots_and_events_exclude_other_profiles() {
    let (_, engine, _id, identity) = setup(true);
    let foreign = uuid::Uuid::new_v4().to_string();
    let snap = engine
        .command(Command::BrowserSnapshot {
            owner: foreign.clone(),
            private: true,
            scopes: vec![],
        })
        .unwrap();
    assert!(snap["jobs"].as_array().unwrap().is_empty());
    let events = engine
        .command(Command::BrowserSubscribe {
            owner: foreign,
            private: true,
            scopes: vec![],
            after_sequence: None,
            limit: 100,
        })
        .unwrap();
    assert!(events["snapshot"]["jobs"].as_array().unwrap().is_empty());
    let own = engine
        .command(Command::BrowserSnapshot {
            owner: identity.scope.profile.clone(),
            private: true,
            scopes: vec![identity.scope.clone()],
        })
        .unwrap();
    assert_eq!(own["jobs"].as_array().unwrap().len(), 1);
}

#[test]
fn private_lane_and_container_projection_require_exact_owned_scope() {
    let (_, engine, _, identity) = setup(true);
    for scopes in [vec![], {
        let mut foreign = identity.scope.clone();
        foreign.container_id = Some("firefox-container-9".into());
        vec![foreign]
    }] {
        let snap = engine
            .command(Command::BrowserSnapshot {
                owner: identity.scope.profile.clone(),
                private: true,
                scopes,
            })
            .unwrap();
        assert!(snap["jobs"].as_array().unwrap().is_empty());
    }
    let regular = engine
        .command(Command::BrowserSubscribe {
            owner: identity.scope.profile.clone(),
            private: false,
            scopes: vec![],
            after_sequence: None,
            limit: 100,
        })
        .unwrap();
    assert!(regular["snapshot"]["jobs"].as_array().unwrap().is_empty());
    assert!(regular["events"]
        .as_array()
        .unwrap()
        .iter()
        .all(|e| e["job"].is_null()));
    assert!(engine
        .command(Command::BrowserSnapshot {
            owner: identity.scope.profile.clone(),
            private: false,
            scopes: vec![identity.scope]
        })
        .is_err());
}
#[test]
fn stale_claim_challenge_and_source_refresh_are_fenced_before_network() {
    let (_, engine, id, identity) = setup(false);
    assert!(engine
        .command(Command::ClaimNavigation {
            id: id.clone(),
            owner: identity.scope.profile.clone(),
            force: true,
            scope: Some(identity.scope.clone()),
            source_generation: Some(0)
        })
        .is_err());
    assert!(engine
        .command(Command::SolveChallenge {
            id: id.clone(),
            owner: Some(identity.scope.profile.clone()),
            url: None,
            automatic: false,
            scope: None,
            source_generation: None
        })
        .unwrap_err()
        .to_string()
        .contains("fence"));
    let mut foreign = identity.scope.clone();
    foreign.cookie_store_id = Some("1".into());
    assert!(engine
        .command(Command::ClaimNavigation {
            id: id.clone(),
            owner: foreign.profile.clone(),
            force: true,
            scope: Some(foreign),
            source_generation: Some(1)
        })
        .is_err());
    engine
        .command(Command::RefreshBrowser {
            id: id.clone(),
            owner: identity.scope.profile.clone(),
            url: "http://127.0.0.1:9/fresh".into(),
            context: RequestContext::default(),
            scope: Some(identity.scope.clone()),
            source_generation: Some(1),
        })
        .unwrap();
    let job = engine
        .snapshot()
        .jobs
        .into_iter()
        .find(|j| j.id == id)
        .unwrap();
    assert_eq!(job.source_generation, 2);
    assert_eq!(job.navigation_scope.unwrap().claim_generation, 2);
    assert!(engine
        .command(Command::ClaimNavigation {
            id,
            owner: identity.scope.profile.clone(),
            force: false,
            scope: Some(identity.scope),
            source_generation: Some(1)
        })
        .is_err());
}
#[test]
fn acknowledged_checkpoint_and_quota_survive_restart_and_trailing_bytes_refuse_eof() {
    let (dir, engine, id, identity) = setup(false);
    frame(
        &engine,
        StreamOperation::Begin {
            identity: identity.clone(),
            target: NavigationTarget::Job { id: id.clone() },
            filename: "atomic.bin".into(),
            total: Some(3),
        },
    )
    .unwrap();
    frame(
        &engine,
        StreamOperation::Chunk {
            identity: identity.clone(),
            offset: 0,
            data_base64: "AQID".into(),
        },
    )
    .unwrap();
    drop(engine);
    let engine = Engine::open(dir.path()).unwrap();
    let job = engine
        .snapshot()
        .jobs
        .into_iter()
        .find(|j| j.id == id)
        .unwrap();
    assert_eq!(job.bytes, 3);
    assert!(job.partial_created);
    frame(
        &engine,
        StreamOperation::Chunk {
            identity: identity.clone(),
            offset: 0,
            data_base64: "AQID".into(),
        },
    )
    .unwrap();
    let connection = rusqlite::Connection::open(dir.path().join("downloader.db")).unwrap();
    let usage: i64 = connection
        .query_row("SELECT SUM(bytes) FROM usage", [], |r| r.get(0))
        .unwrap();
    assert_eq!(usage, 3);
    let partial = downloader_core::transfer::part_path(&job);
    std::fs::OpenOptions::new()
        .write(true)
        .open(&partial)
        .unwrap()
        .set_len(4)
        .unwrap();
    assert!(frame(
        &engine,
        StreamOperation::End {
            identity,
            total: 3,
            expected_sha256: None
        }
    )
    .unwrap_err()
    .to_string()
    .contains("trailing"));
    assert!(!dir.path().join("output/atomic.bin").exists());
}

#[test]
fn concurrent_eof_and_publication_checkpoint_gap_acknowledge_one_artifact() {
    let (dir, engine, id, identity) = setup(false);
    frame(
        &engine,
        StreamOperation::Begin {
            identity: identity.clone(),
            target: NavigationTarget::Job { id },
            filename: "once.bin".into(),
            total: Some(3),
        },
    )
    .unwrap();
    frame(
        &engine,
        StreamOperation::Chunk {
            identity: identity.clone(),
            offset: 0,
            data_base64: "AQID".into(),
        },
    )
    .unwrap();
    let end = StreamOperation::End {
        identity: identity.clone(),
        total: 3,
        expected_sha256: None,
    };
    let other = engine.clone();
    let other_end = end.clone();
    let thread = std::thread::spawn(move || frame(&other, other_end).unwrap());
    let first = frame(&engine, end.clone()).unwrap();
    let second = thread.join().unwrap();
    assert_eq!(first, second);
    assert_eq!(first["terminal"], true);
    drop(engine);
    let connection = rusqlite::Connection::open(dir.path().join("downloader.db")).unwrap();
    connection.execute("UPDATE records SET data=json_set(data,'$.terminal',json('false')) WHERE kind='browser_stream' AND id=?1",[&identity.stream_id]).unwrap();
    drop(connection);
    let engine = Engine::open(dir.path()).unwrap();
    let ack = frame(&engine, end).unwrap();
    assert_eq!(ack["terminal"], true);
    assert_eq!(
        std::fs::read(dir.path().join("output/once.bin")).unwrap(),
        [1, 2, 3]
    );
    assert_eq!(
        std::fs::read_dir(dir.path().join("output"))
            .unwrap()
            .count(),
        1
    );
}
