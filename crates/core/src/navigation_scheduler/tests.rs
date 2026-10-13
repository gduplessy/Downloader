use super::*;
fn queue(count: usize) -> Scheduler {
    let mut s = Scheduler::default();
    for i in 0..count {
        s.enqueue(
            format!("j{i}"),
            1,
            "owner".into(),
            vec![format!("host{}", i % 5)],
        )
        .unwrap();
    }
    s
}
fn call(s: &mut Scheduler, r: SchedulerRequest, t: i64) -> SchedulerSnapshot {
    s.apply("owner", r, t).unwrap()
}
fn admit(s: &mut Scheduler, i: usize, t: i64) -> SchedulerSnapshot {
    call(
        s,
        SchedulerRequest::Admit {
            id: format!("j{i}"),
            generation: 1,
        },
        t,
    )
}
fn wait() -> WaitMetadata {
    WaitMetadata {
        generation: 1,
        source_generation: 1,
        observed_at_ms: 0,
        observed_duration_ms: 120_000,
        deadline_ms: 120_000,
        next_recheck_ms: 30_000,
        basis: WaitBasis::Server,
        requires_live_tab: true,
        expires_at_ms: None,
        reason: "countdown".into(),
        notified: false,
    }
}
#[test]
fn fifty_jobs_fair_host_caps_and_cancelled_head() {
    let mut s = queue(50);
    for i in 0..50 {
        admit(&mut s, i, 0);
    }
    assert_eq!(s.snapshot().active, 3);
    assert_eq!(s.tasks[3].reason, "tab_limit");
    assert_eq!(s.tasks[5].reason, "host_session_busy");
    call(
        &mut s,
        SchedulerRequest::Release {
            id: "j0".into(),
            generation: 1,
        },
        1,
    );
    admit(&mut s, 3, 1);
    assert_eq!(s.snapshot().active, 3);
    assert!(s.tasks[3].lease.is_some());
}
#[test]
fn default_one_twenty_and_lowering_limit() {
    assert_eq!(Scheduler::default().settings.max_active, 3);
    let mut s = queue(50);
    for limit in [0, 21, usize::MAX] {
        assert!(s
            .apply(
                "owner",
                SchedulerRequest::Settings {
                    max_active: limit,
                    notifications: false
                },
                0
            )
            .is_err());
    }
    call(
        &mut s,
        SchedulerRequest::Settings {
            max_active: 20,
            notifications: false,
        },
        0,
    );
    for i in 0..50 {
        admit(&mut s, i, 0);
    }
    assert_eq!(s.snapshot().active, 5);
    call(
        &mut s,
        SchedulerRequest::Settings {
            max_active: 1,
            notifications: false,
        },
        1,
    );
    assert_eq!(s.snapshot().active, 5);
    for i in 0..5 {
        call(
            &mut s,
            SchedulerRequest::Release {
                id: format!("j{i}"),
                generation: 1,
            },
            1,
        );
    }
    for i in 5..50 {
        admit(&mut s, i, 2);
    }
    assert_eq!(s.snapshot().active, 1);
}
#[test]
fn duplicate_admission_stale_owner_and_fencing() {
    let mut s = queue(2);
    admit(&mut s, 0, 0);
    admit(&mut s, 0, 1);
    assert_eq!(s.snapshot().active, 1);
    assert!(s
        .apply(
            "other",
            SchedulerRequest::Release {
                id: "j0".into(),
                generation: 1
            },
            0
        )
        .is_err());
    assert!(s
        .apply(
            "owner",
            SchedulerRequest::Release {
                id: "j0".into(),
                generation: 2
            },
            0
        )
        .is_err());
    assert!(s
        .enqueue("j0".into(), 2, "owner".into(), vec!["host0".into()])
        .is_err());
}
#[test]
fn expired_lease_is_not_free_slot_or_permission_to_reassign() {
    let mut s = queue(2);
    admit(&mut s, 0, 0);
    call(&mut s, SchedulerRequest::Snapshot, 100_000);
    assert_eq!(s.tasks[0].status, QueueStatus::Recovering);
    assert_eq!(s.snapshot().active, 1);
    admit(&mut s, 0, 100_000);
    assert_eq!(s.tasks[0].status, QueueStatus::Recovering);
    call(
        &mut s,
        SchedulerRequest::Reconcile { live: vec![] },
        100_001,
    );
    assert_eq!(s.tasks[0].status, QueueStatus::Manual);
    assert_eq!(s.snapshot().active, 0);
}
#[test]
fn waiting_recovery_and_server_readiness_not_clock_readiness() {
    let mut s = queue(1);
    admit(&mut s, 0, 0);
    call(
        &mut s,
        SchedulerRequest::Heartbeat {
            id: "j0".into(),
            generation: 1,
            tab_id: 7,
        },
        0,
    );
    call(
        &mut s,
        SchedulerRequest::Wait {
            id: "j0".into(),
            generation: 1,
            wait: wait(),
        },
        0,
    );
    call(
        &mut s,
        SchedulerRequest::Reconcile {
            live: vec![LiveLease {
                id: "j0".into(),
                generation: 1,
                tab_id: 7,
                scope: None,
            }],
        },
        200_000,
    );
    assert_eq!(s.tasks[0].status, QueueStatus::Waiting);
    call(
        &mut s,
        SchedulerRequest::Ready {
            id: "j0".into(),
            generation: 1,
            wait_generation: 1,
            ready: false,
        },
        200_000,
    );
    assert_eq!(s.tasks[0].status, QueueStatus::Waiting);
    call(
        &mut s,
        SchedulerRequest::Ready {
            id: "j0".into(),
            generation: 1,
            wait_generation: 1,
            ready: true,
        },
        200_001,
    );
    assert_eq!(s.tasks[0].status, QueueStatus::Active);
}
#[test]
fn replaced_countdown_and_expired_token_require_current_observation() {
    let mut s = queue(1);
    admit(&mut s, 0, 0);
    call(
        &mut s,
        SchedulerRequest::Wait {
            id: "j0".into(),
            generation: 1,
            wait: wait(),
        },
        0,
    );
    let mut replacement = wait();
    replacement.generation = 2;
    replacement.expires_at_ms = Some(10);
    call(
        &mut s,
        SchedulerRequest::Wait {
            id: "j0".into(),
            generation: 1,
            wait: replacement,
        },
        1,
    );
    assert!(s
        .apply(
            "owner",
            SchedulerRequest::Ready {
                id: "j0".into(),
                generation: 1,
                wait_generation: 1,
                ready: true
            },
            2
        )
        .is_err());
    call(
        &mut s,
        SchedulerRequest::Ready {
            id: "j0".into(),
            generation: 1,
            wait_generation: 2,
            ready: true,
        },
        10,
    );
    assert_eq!(s.tasks[0].status, QueueStatus::Manual);
}
#[test]
fn restart_roundtrip_keeps_backlog_order_and_wait() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("nav.db");
    let mut s = queue(50);
    admit(&mut s, 0, 0);
    call(
        &mut s,
        SchedulerRequest::Wait {
            id: "j0".into(),
            generation: 1,
            wait: wait(),
        },
        0,
    );
    {
        let store = Store::open(&file).unwrap();
        s.persist(&store).unwrap();
    }
    let restored = Scheduler::load(&Store::open(&file).unwrap()).unwrap();
    assert_eq!(restored.tasks.len(), 50);
    assert_eq!(restored.tasks[49].order, 50);
    assert_eq!(
        restored.tasks[0].wait.as_ref().unwrap().deadline_ms,
        120_000
    );
}
#[test]
fn redirect_site_locks_and_pause_priority() {
    let mut s = queue(4);
    s.tasks[0].host_keys.push("host2".into());
    admit(&mut s, 0, 0);
    admit(&mut s, 2, 0);
    assert!(s.tasks[2].lease.is_none());
    call(
        &mut s,
        SchedulerRequest::Control {
            id: Some("j1".into()),
            paused: Some(true),
            priority: None,
        },
        0,
    );
    admit(&mut s, 3, 0);
    assert!(s.tasks[3].lease.is_some());
    call(
        &mut s,
        SchedulerRequest::Control {
            id: None,
            paused: Some(true),
            priority: None,
        },
        0,
    );
    assert!(s.settings.paused);
}
#[test]
fn notification_generation_is_claimed_only_once_and_cancelled_wait_has_no_lease() {
    let mut s = queue(1);
    admit(&mut s, 0, 0);
    call(
        &mut s,
        SchedulerRequest::Wait {
            id: "j0".into(),
            generation: 1,
            wait: wait(),
        },
        0,
    );
    call(
        &mut s,
        SchedulerRequest::Ready {
            id: "j0".into(),
            generation: 1,
            wait_generation: 1,
            ready: true,
        },
        1,
    );
    let first = call(
        &mut s,
        SchedulerRequest::Notify {
            id: "j0".into(),
            generation: 1,
            wait_generation: 1,
        },
        1,
    );
    assert_eq!(first.tasks[0].reason, "ready_notification_claimed");
    let second = call(
        &mut s,
        SchedulerRequest::Notify {
            id: "j0".into(),
            generation: 1,
            wait_generation: 1,
        },
        2,
    );
    assert_eq!(second.tasks[0].reason, "ready_confirmed");
    call(
        &mut s,
        SchedulerRequest::Release {
            id: "j0".into(),
            generation: 1,
        },
        3,
    );
    assert!(s.tasks[0].wait.is_none());
    assert!(s.tasks[0].lease.is_none());
}
#[test]
fn redirected_active_task_is_stopped_before_site_collision_submission() {
    let mut s = queue(2);
    admit(&mut s, 0, 0);
    admit(&mut s, 1, 0);
    s.tasks[0].host_keys.push("host1".into());
    call(
        &mut s,
        SchedulerRequest::Validate {
            id: "j0".into(),
            generation: 1,
        },
        1,
    );
    assert_eq!(s.tasks[0].status, QueueStatus::Manual);
    assert_eq!(s.tasks[0].reason, "host_session_busy");
}
#[test]
fn twenty_distinct_hosts_never_exceed_global_limit() {
    let mut s = queue(50);
    for (i, t) in s.tasks.iter_mut().enumerate() {
        t.host_keys = vec![format!("unique{i}")];
    }
    call(
        &mut s,
        SchedulerRequest::Settings {
            max_active: 20,
            notifications: false,
        },
        0,
    );
    for i in 0..50 {
        admit(&mut s, i, 0);
        assert!(s.snapshot().active <= 20);
    }
    assert_eq!(s.snapshot().active, 20);
    call(
        &mut s,
        SchedulerRequest::Settings {
            max_active: 1,
            notifications: false,
        },
        1,
    );
    assert_eq!(s.snapshot().active, 20);
    admit(&mut s, 20, 1);
    assert!(s.tasks[20].lease.is_none());
}
