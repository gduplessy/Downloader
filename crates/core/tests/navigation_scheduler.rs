use downloader_core::{
    navigation_scheduler::SchedulerRequest, AddJob, Command, Engine, RequestContext,
};
use serde_json::{json, Value};
fn navigate(engine: &std::sync::Arc<Engine>, owner: &str, host: &str, private: bool) -> String {
    let result = engine
        .command(Command::Navigate(AddJob {
            request_id: uuid::Uuid::new_v4().to_string(),
            url: format!("http://{host}/page"),
            filename: None,
            directory: None,
            queue: None,
            checksum: None,
            paused: true,
            context: RequestContext {
                profile: Some(owner.into()),
                private,
                ..Default::default()
            },
            media: None,
            description: String::new(),
        }))
        .unwrap();
    result["id"].as_str().unwrap().into()
}
fn schedule(engine: &std::sync::Arc<Engine>, owner: &str, request: SchedulerRequest) -> Value {
    engine
        .command(Command::NavigationScheduler {
            owner: owner.into(),
            scope: None,
            request,
        })
        .unwrap()
}
#[test]
fn service_owns_queue_across_restart_and_profiles() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let owner = uuid::Uuid::new_v4().to_string();
    let other = uuid::Uuid::new_v4().to_string();
    let first = navigate(&engine, &owner, "localhost", false);
    let second = navigate(&engine, &owner, "127.0.0.1", false);
    let other_job = navigate(&engine, &other, "example.invalid", false);
    let admitted = schedule(
        &engine,
        &owner,
        SchedulerRequest::Admit {
            id: first.clone(),
            generation: 1,
        },
    );
    assert_eq!(admitted["active"], 1);
    assert_eq!(admitted["tasks"].as_array().unwrap().len(), 2);
    assert_eq!(admitted["tasks"][0]["host_keys"], json!([]));
    assert!(engine
        .command(Command::NavigationScheduler {
            owner: other.clone(),
            scope: None,
            request: SchedulerRequest::Release {
                id: first.clone(),
                generation: 1
            }
        })
        .is_err());
    let foreign = schedule(&engine, &other, SchedulerRequest::Snapshot);
    assert_eq!(foreign["tasks"][0]["id"], other_job);
    drop(engine);
    let restored = Engine::open(dir.path()).unwrap();
    let snapshot = schedule(&restored, &owner, SchedulerRequest::Snapshot);
    assert_eq!(snapshot["tasks"][0]["id"], first);
    assert_eq!(snapshot["tasks"][1]["id"], second);
    assert_eq!(snapshot["active"], 1);
    schedule(
        &restored,
        &owner,
        SchedulerRequest::Reconcile { live: vec![] },
    );
    let snapshot = schedule(&restored, &owner, SchedulerRequest::Snapshot);
    assert_eq!(snapshot["active"], 0);
    assert_eq!(snapshot["tasks"][0]["status"], "manual");
}
#[test]
fn private_task_metadata_is_not_written_to_scheduler_record() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let owner = uuid::Uuid::new_v4().to_string();
    let id = navigate(&engine, &owner, "private.invalid", true);
    schedule(
        &engine,
        &owner,
        SchedulerRequest::Admit {
            id: id.clone(),
            generation: 1,
        },
    );
    let records = engine
        .store
        .lock()
        .unwrap()
        .all::<Value>("navigation_scheduler")
        .unwrap();
    assert_eq!(records[0]["tasks"], json!([]));
    assert!(!serde_json::to_string(&records)
        .unwrap()
        .contains("private.invalid"));
}
#[test]
fn settings_validation_does_not_interrupt_existing_lease() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let owner = uuid::Uuid::new_v4().to_string();
    let first = navigate(&engine, &owner, "localhost", false);
    let second = navigate(&engine, &owner, "127.0.0.1", false);
    schedule(
        &engine,
        &owner,
        SchedulerRequest::Admit {
            id: first,
            generation: 1,
        },
    );
    schedule(
        &engine,
        &owner,
        SchedulerRequest::Admit {
            id: second,
            generation: 1,
        },
    );
    let result = schedule(
        &engine,
        &owner,
        SchedulerRequest::Settings {
            max_active: 1,
            notifications: false,
        },
    );
    assert_eq!(result["active"], 2);
    assert!(engine
        .command(Command::NavigationScheduler {
            owner,
            scope: None,
            request: SchedulerRequest::Settings {
                max_active: 21,
                notifications: false
            }
        })
        .is_err());
}
