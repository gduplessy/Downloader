use downloader_core::{Command, Engine};
use serde_json::{json, Value};
use std::sync::Arc;
fn call(engine: &Arc<Engine>, command: &str, args: Value) -> Value {
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
