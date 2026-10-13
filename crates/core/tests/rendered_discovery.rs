use downloader_core::{Command, Engine};
use serde_json::{json, Value};
use std::sync::Arc;
fn call(engine: &Arc<Engine>, command: &str, mut args: Value) -> Value {
    if command == "discovery_page_result" {
        let state = engine
            .store
            .lock()
            .unwrap()
            .all::<downloader_core::rendered_grabber::Discovery>("rendered_discovery")
            .unwrap()
            .into_iter()
            .find(|state| state.project.id == args["id"])
            .unwrap();
        let document = json!({"nonce":"00000000-0000-4000-8000-000000000001","generation":1});
        downloader_core::rendered_grabber::claim(engine,serde_json::from_value(json!({"id":args["id"],"scope":args["scope"],"generation":args["generation"],"tab_id":42,"permitted_origins":state.permitted_origins,"document":document})).unwrap()).unwrap();
        args["document"] = document;
    }
    let value = json!({"command":command,"args":args});
    let request: downloader_core::Request = serde_json::from_value(
        json!({"version":1,"id":"fixture","command":command,"args":value["args"]}),
    )
    .unwrap();
    engine.command(request.command).unwrap()
}
fn project(dir: &std::path::Path, private: bool) -> downloader_core::GrabberProject {
    serde_json::from_value(json!({"id":"rendered-project","name":"rendered fixture","url":"http://127.0.0.1:18782/","directory":dir.join("output"),"depth":2,"max_pages":5,"same_domain":true,"include":"*.bin","exclude":"","min_size":0,"max_size":null,"mirror":false,"rendered":true,"private":private,"next_run":null})).unwrap()
}
fn scope(private: bool) -> Value {
    json!({"browser":"chromium","profile":"00000000-0000-0000-0000-000000000001","private":private,"cookie_store_id":if private{"1"}else{"0"},"container_id":null,"partition_key":null,"claim_generation":1})
}
fn initialize(engine: &Arc<Engine>, dir: &std::path::Path, private: bool) {
    let p = project(dir, private);
    engine.command(Command::Grabber(p.clone())).unwrap();
    downloader_core::rendered_grabber::start(engine, p).unwrap();
}
#[test]
fn real_engine_restart_selection_is_scoped_idempotent_and_never_probed() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    initialize(&engine, dir.path(), false);
    let args = json!({"id":"rendered-project","scope":scope(false),"generation":1,"tab_id":42,"permitted_origins":[]});
    let claim = call(&engine, "discovery_claim", args.clone());
    assert_eq!(claim["page"]["url"], "http://127.0.0.1:18782/");
    call(
        &engine,
        "discovery_page_result",
        json!({"id":"rendered-project","scope":scope(false),"generation":1,"page_url":"http://127.0.0.1:18782/","final_url":"http://127.0.0.1:18782/","bytes":20,"links":[{"url":"http://127.0.0.1:18782/auth.bin","resource":true,"name":"auth.bin","size":null,"content_type":"application/octet-stream"}],"reason":null}),
    );
    let select = json!({"id":"rendered-project","scope":scope(false),"generation":1,"urls":["http://127.0.0.1:18782/auth.bin"]});
    let first = call(&engine, "discovery_select", select.clone());
    let second = call(&engine, "discovery_select", select.clone());
    assert_eq!(first, second);
    let job = engine.job(first["jobs"][0].as_str().unwrap()).unwrap();
    let job = job.lock().unwrap();
    assert_eq!(
        serde_json::to_value(&job.navigation_scope).unwrap(),
        scope(false)
    );
    assert_eq!(job.state, downloader_core::JobState::WaitingBrowser);
    assert_eq!(job.bytes, 0);
    assert!(!job.destination.exists());
    drop(job);
    drop(engine);
    let engine = Engine::open(dir.path()).unwrap();
    let third = call(&engine, "discovery_select", select);
    assert_eq!(first, third);
    let state = call(
        &engine,
        "discovery_status",
        json!({"id":"rendered-project","scope":scope(false),"generation":1,"action":"snapshot"}),
    );
    assert_eq!(state["resources"].as_array().unwrap().len(), 1);
}
#[test]
fn new_private_project_is_ephemeral_and_public_cannot_relabel() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    initialize(&engine, dir.path(), true);
    let list = call(&engine, "discovery_list", json!({"scope":scope(false)}));
    assert_eq!(list, json!([]));
    call(
        &engine,
        "discovery_claim",
        json!({"id":"rendered-project","scope":scope(true),"generation":1,"tab_id":3,"permitted_origins":[]}),
    );
    drop(engine);
    let engine = Engine::open(dir.path()).unwrap();
    assert_eq!(
        call(&engine, "discovery_list", json!({"scope":scope(true)})),
        json!([])
    );
    assert_eq!(engine.command(Command::GrabberList).unwrap(), json!([]));
    initialize(&engine, dir.path(), false);
    assert!(downloader_core::rendered_grabber::claim(&engine,serde_json::from_value(json!({"id":"rendered-project","scope":scope(true),"generation":1,"tab_id":3,"permitted_origins":[]})).unwrap()).is_err());
}
#[test]
fn cross_origin_requires_explicit_permission_and_fresh_same_store_partition() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let mut p = project(dir.path(), false);
    p.same_domain = false;
    engine.command(Command::Grabber(p.clone())).unwrap();
    downloader_core::rendered_grabber::start(&engine, p).unwrap();
    let mut first = scope(false);
    first["partition_key"] = json!({"top_level_site":"http://127.0.0.1"});
    let args = json!({"id":"rendered-project","scope":first,"generation":1,"tab_id":42,"permitted_origins":["http://127.0.0.2:18783"]});
    call(&engine, "discovery_claim", args.clone());
    call(
        &engine,
        "discovery_page_result",
        json!({"id":"rendered-project","scope":first,"generation":1,"page_url":"http://127.0.0.1:18782/","final_url":"http://127.0.0.1:18782/","bytes":20,"links":[{"url":"http://127.0.0.2:18783/page","resource":false,"name":"page","size":null,"content_type":""}],"reason":null}),
    );
    let next = call(&engine, "discovery_claim", args);
    assert_eq!(next["page"]["url"], "http://127.0.0.2:18783/page");
    let mut renewed = first.clone();
    renewed["partition_key"] = json!({"top_level_site":"http://127.0.0.2"});
    renewed["claim_generation"] = json!(2);
    let claim = json!({"id":"rendered-project","scope":renewed,"generation":1,"tab_id":42,"observed_url":"http://127.0.0.2:18783/page","permitted_origins":["http://127.0.0.2:18783"]});
    let mut foreign = claim.clone();
    foreign["scope"]["cookie_store_id"] = json!("foreign");
    assert!(downloader_core::rendered_grabber::claim(
        &engine,
        serde_json::from_value(foreign).unwrap()
    )
    .is_err());
    call(&engine, "discovery_claim", claim);
    let stale: downloader_core::rendered_grabber::Status = serde_json::from_value(
        json!({"id":"rendered-project","scope":first,"generation":1,"action":"snapshot"}),
    )
    .unwrap();
    assert!(downloader_core::rendered_grabber::status(&engine, stale).is_err());
}
#[test]
fn discovery_shares_global_admission_and_reconciles_only_exact_project_scope() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let owner = scope(false)["profile"].as_str().unwrap().to_string();
    for index in 0..3 {
        let job = call(
            &engine,
            "navigate",
            json!({"request_id":format!("navigation-{index}"),"url":format!("http://fixture-{index}.invalid/page"),"filename":null,"directory":dir.path().join("output"),"queue":null,"checksum":null,"paused":true,"context":{"profile":owner},"media":null,"description":""}),
        );
        call(
            &engine,
            "navigation_scheduler",
            json!({"owner":owner,"scope":null,"request":{"action":"admit","id":job["id"],"generation":1}}),
        );
    }
    initialize(&engine, dir.path(), false);
    let denied = call(
        &engine,
        "discovery_claim",
        json!({"id":"rendered-project","scope":scope(false),"generation":1,"tab_id":42,"permitted_origins":[]}),
    );
    assert_eq!(denied["admitted"], false);
    assert_eq!(denied["page"], Value::Null);
    let snapshot = call(
        &engine,
        "navigation_scheduler",
        json!({"owner":owner,"scope":null,"request":{"action":"snapshot"}}),
    );
    assert_eq!(snapshot["active"], 3);
    assert!(snapshot["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .any(|task| task["id"] == "discovery:rendered-project"));
}

#[test]
fn stale_document_result_cannot_replace_current_rendered_page() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    initialize(&engine, dir.path(), false);
    let current = json!({"nonce":"00000000-0000-4000-8000-000000000002","generation":2});
    call(
        &engine,
        "discovery_claim",
        json!({"id":"rendered-project","scope":scope(false),"generation":1,"tab_id":42,"document":current}),
    );
    for document in [
        Value::Null,
        json!({"nonce":"00000000-0000-4000-8000-000000000001","generation":1}),
    ] {
        let request = serde_json::from_value(json!({"id":"rendered-project","scope":scope(false),"generation":1,"page_url":"http://127.0.0.1:18782/","final_url":"http://127.0.0.1:18782/","bytes":20,"links":[{"url":"http://127.0.0.1:18782/evil.bin","resource":true,"name":"evil.bin","size":null,"content_type":"application/octet-stream"}],"reason":null,"document":document})).unwrap();
        assert!(downloader_core::rendered_grabber::report(&engine, request).is_err());
    }
    let state = call(
        &engine,
        "discovery_status",
        json!({"id":"rendered-project","scope":scope(false),"generation":1,"action":"snapshot"}),
    );
    assert_eq!(state["resources"].as_array().unwrap().len(), 0);
    assert_eq!(state["lease"]["document"], current);
}

#[test]
fn duplicate_old_page_report_cannot_release_the_current_page_lease() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    initialize(&engine, dir.path(), false);
    let args = json!({"id":"rendered-project","scope":scope(false),"generation":1,"tab_id":42});
    call(&engine, "discovery_claim", args.clone());
    let mut report = json!({"id":"rendered-project","scope":scope(false),"generation":1,"page_url":"http://127.0.0.1:18782/","final_url":"http://127.0.0.1:18782/","bytes":20,"links":[{"url":"http://127.0.0.1:18782/next","resource":false,"name":"next","size":null,"content_type":""}],"reason":null});
    call(&engine, "discovery_page_result", report.clone());
    call(&engine, "discovery_claim", args);
    report["document"] = json!({"nonce":"00000000-0000-4000-8000-000000000001","generation":1});
    downloader_core::rendered_grabber::report(&engine, serde_json::from_value(report).unwrap())
        .unwrap();
    let state = call(
        &engine,
        "discovery_status",
        json!({"id":"rendered-project","scope":scope(false),"generation":1,"action":"snapshot"}),
    );
    assert_eq!(state["lease"]["url"], "http://127.0.0.1:18782/next");
    let scheduler = call(
        &engine,
        "navigation_scheduler",
        json!({"owner":scope(false)["profile"],"private_lane":false,"request":{"action":"snapshot"}}),
    );
    let task = scheduler["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|task| task["id"] == "discovery:rendered-project")
        .unwrap();
    assert_eq!(task["status"], "active");
    assert!(task["lease"].is_object());
}

#[test]
fn preparation_binds_known_resource_provenance_and_cancellation_releases_its_slot() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    initialize(&engine, dir.path(), false);
    let owner = scope(false);
    call(
        &engine,
        "discovery_claim",
        json!({"id":"rendered-project","scope":owner,"generation":1,"tab_id":42}),
    );
    call(
        &engine,
        "discovery_page_result",
        json!({"id":"rendered-project","scope":owner,"generation":1,"page_url":"http://127.0.0.1:18782/","final_url":"http://127.0.0.1:18782/","bytes":20,"links":[{"url":"http://127.0.0.1:18782/auth.bin","resource":true,"name":"auth.bin","size":null,"content_type":""}],"reason":null}),
    );
    let selected = call(
        &engine,
        "discovery_select",
        json!({"id":"rendered-project","scope":owner,"generation":1,"urls":["http://127.0.0.1:18782/auth.bin"]}),
    );
    let id = selected["jobs"][0].as_str().unwrap();
    let mut request = json!({"id":"rendered-project","job_id":id,"scope":owner,"generation":1,"action":"admit","observed_url":"http://127.0.0.1:18782/","tab_id":42});
    let admitted = call(&engine, "discovery_prepare", request.clone());
    assert_eq!(admitted["admitted"], true);
    assert_eq!(admitted["page_url"], "http://127.0.0.1:18782/");
    request["action"] = json!("enroll");
    request["tab_id"] = json!(43);
    request["document"] = json!({"nonce":"00000000-0000-4000-8000-000000000003","generation":1});
    let mut foreign = request.clone();
    foreign["scope"]["cookie_store_id"] = json!("foreign");
    assert!(downloader_core::rendered_grabber::prepare(
        &engine,
        serde_json::from_value(foreign).unwrap()
    )
    .is_err());
    call(&engine, "discovery_prepare", request.clone());
    request["action"] = json!("release");
    let mut stale = request.clone();
    stale["document"]["nonce"] = json!("00000000-0000-4000-8000-000000000004");
    assert!(downloader_core::rendered_grabber::prepare(
        &engine,
        serde_json::from_value(stale).unwrap()
    )
    .is_err());
    engine
        .command(Command::GrabberControl {
            id: "rendered-project".into(),
            action: "cancel".into(),
        })
        .unwrap();
    let state = call(
        &engine,
        "navigation_scheduler",
        json!({"owner":owner["profile"],"private_lane":false,"request":{"action":"snapshot"}}),
    );
    let task = state["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|task| task["id"] == "discovery-resource:rendered-project")
        .unwrap();
    assert!(task["lease"].is_null());
    assert_ne!(task["status"], "active");
    assert!(downloader_core::rendered_grabber::prepare(
        &engine,
        serde_json::from_value(request).unwrap()
    )
    .is_err());
}
