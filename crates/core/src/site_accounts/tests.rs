use super::*;
use std::cell::RefCell;
#[derive(Default)]
struct FakeVault(RefCell<HashMap<String, (String, String)>>);
impl Vault for FakeVault {
    fn write(&self, id: &str, u: &str, p: &str) -> Result<()> {
        self.0.borrow_mut().insert(id.into(), (u.into(), p.into()));
        Ok(())
    }
    fn read(&self, id: &str) -> Result<(String, String)> {
        self.0
            .borrow()
            .get(id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("missing"))
    }
    fn delete(&self, id: &str) -> Result<()> {
        self.0.borrow_mut().remove(id);
        Ok(())
    }
}
fn scope() -> SessionScope {
    SessionScope {
        browser: "chromium".into(),
        profile: uuid::Uuid::new_v4().to_string(),
        private: false,
        cookie_store_id: Some("0".into()),
        container_id: None,
        partition_key: None,
        claim_generation: 1,
    }
}
fn account(scope: SessionScope) -> Account {
    Account {
        revision: 0,
        id: uuid::Uuid::new_v4().to_string(),
        label: "Fixture Alice".into(),
        origin: "http://127.0.0.1:18783".into(),
        provider: "local-fixture".into(),
        account_id: "alice".into(),
        scope,
        saved_fill: false,
        credential_ref: None,
    }
}
fn form() -> FormProof {
    FormProof {
        tab_id: 10,
        frame_id: 0,
        origin: "http://127.0.0.1:18783".into(),
        page: "http://127.0.0.1:18783/nav-adapters/ddownload/login".into(),
        action: "http://127.0.0.1:18783/nav-adapters/ddownload/login".into(),
        method: "POST".into(),
        adapter_id: "local-fixture".into(),
        adapter_version: "1.0.0".into(),
        fingerprint: "a".repeat(64),
        document_generation: 1,
        document_nonce: "c3b45e0f-227f-41fc-b9c5-af170af9a65d".into(),
        document_id: Some("fixture-document".into()),
        username_name: "username".into(),
        password_name: "password".into(),
    }
}
#[test]
fn passwords_only_in_vault_and_identity_immutable() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(&dir.path().join("db")).unwrap();
    let vault = FakeVault::default();
    let mut a = account(scope());
    a.saved_fill = true;
    let saved = save(
        &store,
        a.clone(),
        Some("test-secret-never-persisted".into()),
        &vault,
    )
    .unwrap();
    assert_eq!(
        vault
            .read(saved.credential_ref.as_ref().unwrap())
            .unwrap()
            .1,
        "test-secret-never-persisted"
    );
    assert!(
        !serde_json::to_string(&store.all::<Account>("site_account").unwrap())
            .unwrap()
            .contains("test-secret")
    );
    a.scope.container_id = Some("firefox-container-2".into());
    assert!(save(&store, a, None, &vault).is_err());
    let forged = Account {
        credential_ref: Some("other-service".into()),
        ..account(scope())
    };
    assert!(save(&store, forged, None, &vault).is_err());
}
#[test]
fn private_selection_is_ephemeral_and_private_password_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("db");
    let store = Store::open(&db).unwrap();
    let vault = FakeVault::default();
    let mut s = scope();
    s.private = true;
    let a = account(s);
    assert!(save(&store, a.clone(), Some("secret".into()), &vault).is_err());
    save(&store, a, None, &vault).unwrap();
    assert_eq!(store.all::<Account>("site_account").unwrap().len(), 1);
    drop(store);
    assert!(Store::open(&db)
        .unwrap()
        .all::<Account>("site_account")
        .unwrap()
        .is_empty());
}
#[test]
fn forms_fail_closed_for_frames_origin_fields_live_layouts() {
    let a = account(scope());
    let f = form();
    proof(&f, &a, true).unwrap();
    for changed in [
        FormProof {
            frame_id: 1,
            ..f.clone()
        },
        FormProof {
            origin: "https://evil.invalid".into(),
            ..f.clone()
        },
        FormProof {
            action: "https://evil.invalid/login".into(),
            ..f.clone()
        },
        FormProof {
            password_name: "payment".into(),
            ..f.clone()
        },
        FormProof {
            adapter_version: "2.0.0".into(),
            ..f.clone()
        },
    ] {
        assert!(proof(&changed, &a, true).is_err());
    }
    let live = Account {
        origin: "https://ddownload.com".into(),
        provider: "ddownload".into(),
        ..a
    };
    let f = FormProof {
        origin: live.origin.clone(),
        page: format!("{}/login", live.origin),
        action: format!("{}/login", live.origin),
        ..f
    };
    assert!(proof(&f, &live, true).is_err());
}
fn setup() -> (tempfile::TempDir, Arc<Engine>, String, Account) {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let a = account(scope());
    let owner = a.scope.profile.clone();
    let value = engine
        .command(crate::Command::Navigate(crate::AddJob {
            request_id: uuid::Uuid::new_v4().to_string(),
            url: form().page,
            filename: None,
            directory: None,
            queue: None,
            checksum: None,
            paused: true,
            context: crate::RequestContext {
                profile: Some(owner.clone()),
                ..Default::default()
            },
            media: None,
            description: String::new(),
        }))
        .unwrap();
    let id = value["id"].as_str().unwrap().to_string();
    engine
        .command(crate::Command::ClaimNavigation {
            id: id.clone(),
            owner,
            force: false,
            scope: Some(a.scope.clone()),
            source_generation: Some(1),
        })
        .unwrap();
    engine
        .command(crate::Command::SiteAccount(DesktopRequest::Save {
            account: Box::new(a.clone()),
            password: None,
        }))
        .unwrap();
    engine
        .command(crate::Command::SiteAccount(DesktopRequest::Select {
            job_id: id.clone(),
            account_id: Some(a.id.clone()),
            mode: Mode::Premium,
        }))
        .unwrap();
    (dir, engine, id, a)
}
fn request(engine: &Arc<Engine>, id: &str, action: BrowserAction) -> BrowserRequest {
    let job = engine.job(id).unwrap();
    let job = job.lock().unwrap();
    BrowserRequest {
        job_id: id.into(),
        owner: job.navigation_owner.clone().unwrap(),
        scope: job.navigation_scope.clone().unwrap(),
        source_generation: job.source_generation,
        request: action,
    }
}
#[test]
fn selection_fences_profile_claim_source_and_unknown_entitlement() {
    let (_d, e, id, a) = setup();
    let req = request(&e, &id, BrowserAction::Selection);
    let selection = browser(&e, req.clone()).unwrap();
    assert_eq!(selection["entitlement"], "unknown");
    assert_eq!(selection["mode"], "premium");
    for changed in [
        BrowserRequest {
            scope: SessionScope {
                profile: uuid::Uuid::new_v4().to_string(),
                ..req.scope.clone()
            },
            ..req.clone()
        },
        BrowserRequest {
            source_generation: 1,
            ..req.clone()
        },
        BrowserRequest {
            scope: SessionScope {
                container_id: Some("other".into()),
                ..req.scope.clone()
            },
            ..req.clone()
        },
        BrowserRequest {
            scope: SessionScope {
                claim_generation: 1,
                ..req.scope.clone()
            },
            ..req.clone()
        },
    ] {
        assert!(browser(&e, changed).is_err());
    }
    let action = BrowserAction::Observe {
        proof: form(),
        auth: AuthState::Authenticated,
        entitlement: Entitlement::Active,
        account_id: Some("wrong-account".into()),
        selected_host: None,
    };
    assert!(browser(&e, request(&e, &id, action)).is_err());
    let action = BrowserAction::Observe {
        proof: form(),
        auth: AuthState::Authenticated,
        entitlement: Entitlement::Active,
        account_id: Some(a.account_id),
        selected_host: Some("ddownload.com".into()),
    };
    assert_eq!(
        browser(&e, request(&e, &id, action)).unwrap()["entitlement"],
        "active"
    );
    e.command(crate::Command::SiteAccount(DesktopRequest::Remove {
        id: a.id,
    }))
    .unwrap();
    assert!(browser(&e, req).is_err());
}
#[test]
fn grants_are_bound_once_and_attempts_bounded_without_loading_secrets() {
    let (_d, e, id, _a) = setup();
    let store = e.store.lock().unwrap();
    let mut s = store
        .get::<Selection>("site_account_selection", &id)
        .unwrap();
    s.account.saved_fill = true;
    s.account.credential_ref = Some("not-created".into());
    store
        .put("site_account", &s.account.id, &s.account)
        .unwrap();
    drop(store);
    let grant = browser(&e, request(&e, &id, BrowserAction::Grant { proof: form() })).unwrap();
    let grant_id = grant["grant_id"].as_str().unwrap().to_string();
    assert!(browser(&e, request(&e, &id, BrowserAction::Grant { proof: form() })).is_err());
    let wrong = FormProof {
        tab_id: 11,
        ..form()
    };
    assert!(browser(
        &e,
        request(
            &e,
            &id,
            BrowserAction::Consume {
                grant_id: grant_id.clone(),
                proof: wrong
            }
        )
    )
    .is_err());
    assert!(browser(
        &e,
        request(
            &e,
            &id,
            BrowserAction::Consume {
                grant_id,
                proof: form()
            }
        )
    )
    .is_err());
}

#[test]
fn expired_grants_and_mfa_do_not_read_credentials() {
    let (_d, e, id, _) = setup();
    let store = e.store.lock().unwrap();
    let mut selection = store
        .get::<Selection>("site_account_selection", &id)
        .unwrap();
    selection.account.saved_fill = true;
    selection.account.credential_ref = Some("nonexistent-fixture".into());
    store
        .put("site_account", &selection.account.id, &selection.account)
        .unwrap();
    drop(store);
    let grant = browser(&e, request(&e, &id, BrowserAction::Grant { proof: form() })).unwrap();
    let gid = grant["grant_id"].as_str().unwrap().to_string();
    e.site_accounts
        .lock()
        .unwrap()
        .grants
        .get_mut(&gid)
        .unwrap()
        .expires = 0;
    assert!(browser(
        &e,
        request(
            &e,
            &id,
            BrowserAction::Consume {
                grant_id: gid,
                proof: form()
            }
        )
    )
    .unwrap_err()
    .to_string()
    .contains("expired"));
    let req = request(
        &e,
        &id,
        BrowserAction::Observe {
            proof: form(),
            auth: AuthState::MfaRequired,
            entitlement: Entitlement::Active,
            account_id: None,
            selected_host: None,
        },
    );
    let state = browser(&e, req).unwrap();
    assert_eq!(state["entitlement"], "unknown");
    assert!(
        browser(&e, request(&e, &id, BrowserAction::Grant { proof: form() }))
            .unwrap_err()
            .to_string()
            .contains("user_action_required")
    );
}
#[test]
fn competing_accounts_and_document_replacements_never_share_authority() {
    let (_d, e, id, a) = setup();
    let mut other = account(a.scope.clone());
    other.scope.cookie_store_id = Some("other-store".into());
    e.command(crate::Command::SiteAccount(DesktopRequest::Save {
        account: Box::new(other.clone()),
        password: None,
    }))
    .unwrap();
    assert!(e
        .command(crate::Command::SiteAccount(DesktopRequest::Select {
            job_id: id.clone(),
            account_id: Some(other.id),
            mode: Mode::Premium
        }))
        .is_err());
    let store = e.store.lock().unwrap();
    let mut selected = store
        .get::<Selection>("site_account_selection", &id)
        .unwrap();
    selected.account.saved_fill = true;
    selected.account.credential_ref = Some("nonexistent-fixture".into());
    store
        .put("site_account", &selected.account.id, &selected.account)
        .unwrap();
    drop(store);
    let grant = browser(&e, request(&e, &id, BrowserAction::Grant { proof: form() })).unwrap();
    let gid = grant["grant_id"].as_str().unwrap().to_string();
    let changed = FormProof {
        document_nonce: "c3b45e0f-227f-41fc-b9c5-af170af9a65d".into(),
        document_id: Some("replacement-document".into()),
        ..form()
    };
    assert!(browser(
        &e,
        request(
            &e,
            &id,
            BrowserAction::Consume {
                grant_id: gid,
                proof: changed
            }
        )
    )
    .unwrap_err()
    .to_string()
    .contains("binding_stale"));
}
#[test]
fn removing_accounts_does_not_revive_cancelled_jobs_and_diagnostics_redact_passwords() {
    let (_d, e, id, a) = setup();
    e.command(crate::Command::Cancel { id: id.clone() })
        .unwrap();
    e.command(crate::Command::SiteAccount(DesktopRequest::Remove {
        id: a.id.clone(),
    }))
    .unwrap();
    assert_eq!(
        e.job(&id).unwrap().lock().unwrap().state,
        JobState::Cancelled
    );
    let request = DesktopRequest::Save {
        account: Box::new(a),
        password: Some("do-not-debug-password".into()),
    };
    assert!(!format!("{request:?}").contains("do-not-debug-password"));
}

#[test]
fn credential_revision_change_fences_consume_and_allows_only_a_fresh_attempt() {
    let (_d, e, id, _) = setup();
    let store = e.store.lock().unwrap();
    let mut selection = store
        .get::<Selection>("site_account_selection", &id)
        .unwrap();
    selection.account.saved_fill = true;
    selection.account.credential_ref = Some("not-created".into());
    store
        .put("site_account", &selection.account.id, &selection.account)
        .unwrap();
    drop(store);
    let grant = browser(&e, request(&e, &id, BrowserAction::Grant { proof: form() })).unwrap();
    let gid = grant["grant_id"].as_str().unwrap().to_string();
    // Simulate the save checkpoint before its runtime grant invalidation acquires the lock.
    selection.account.revision += 1;
    e.store
        .lock()
        .unwrap()
        .put("site_account", &selection.account.id, &selection.account)
        .unwrap();
    assert!(browser(
        &e,
        request(
            &e,
            &id,
            BrowserAction::Consume {
                grant_id: gid,
                proof: form()
            }
        )
    )
    .unwrap_err()
    .to_string()
    .contains("binding_stale"));
    let new = browser(&e, request(&e, &id, BrowserAction::Grant { proof: form() })).unwrap();
    assert!(new["grant_id"].is_string());
    assert!(browser(&e, request(&e, &id, BrowserAction::Grant { proof: form() })).is_err());
}

#[test]
fn authenticated_redirect_observation_updates_current_page_and_preserves_original() {
    let (_d, e, id, a) = setup();
    let original = e.job(&id).unwrap().lock().unwrap().page_url.clone();
    let page = "http://127.0.0.1:18783/nav-adapters/ddownload/account";
    let p = FormProof {
        page: page.into(),
        action: page.into(),
        method: "GET".into(),
        username_name: String::new(),
        password_name: String::new(),
        ..form()
    };
    browser(
        &e,
        request(
            &e,
            &id,
            BrowserAction::Observe {
                proof: p,
                auth: AuthState::Authenticated,
                entitlement: Entitlement::Active,
                account_id: Some(a.account_id),
                selected_host: Some("ddownload.com".into()),
            },
        ),
    )
    .unwrap();
    let shared = e.job(&id).unwrap();
    let job = shared.lock().unwrap();
    assert_eq!(job.navigation_url.as_deref(), Some(page));
    assert_eq!(job.page_url, original);
}

#[test]
fn explicit_same_session_continue_and_refresh_keep_selection_but_invalidate_old_grants() {
    let (_d, e, id, a) = setup();
    let store = e.store.lock().unwrap();
    let mut selection = store
        .get::<Selection>("site_account_selection", &id)
        .unwrap();
    selection.account.saved_fill = true;
    selection.account.credential_ref = Some("not-created".into());
    store
        .put("site_account", &a.id, &selection.account)
        .unwrap();
    drop(store);
    let old = request(&e, &id, BrowserAction::Grant { proof: form() });
    let grant = browser(&e, old.clone()).unwrap();
    let claimed = e
        .command(crate::Command::ClaimNavigation {
            id: id.clone(),
            owner: old.owner.clone(),
            force: true,
            scope: Some(old.scope.clone()),
            source_generation: Some(old.source_generation),
        })
        .unwrap();
    assert_eq!(claimed["scope"]["claim_generation"], 3);
    let selected = browser(&e, request(&e, &id, BrowserAction::Selection)).unwrap();
    assert_eq!(selected["account"]["id"], a.id);
    assert_eq!(selected["scope"]["claim_generation"], 3);
    assert_eq!(selected["entitlement"], "unknown");
    let action = BrowserAction::Consume {
        grant_id: grant["grant_id"].as_str().unwrap().into(),
        proof: form(),
    };
    assert!(browser(&e, request(&e, &id, action)).is_err());
    // Continue cannot manufacture another automatic attempt in the same source/revision.
    assert!(browser(&e, request(&e, &id, BrowserAction::Grant { proof: form() })).is_err());
    let current = request(&e, &id, BrowserAction::Selection);
    e.command(crate::Command::RefreshBrowser {
        id: id.clone(),
        owner: current.owner,
        scope: Some(current.scope),
        source_generation: Some(current.source_generation),
        url: form().page,
        context: crate::RequestContext::default(),
    })
    .unwrap();
    let selected = browser(&e, request(&e, &id, BrowserAction::Selection)).unwrap();
    assert_eq!(selected["source_generation"], 3);
    assert_eq!(selected["scope"]["claim_generation"], 4);
    assert_eq!(selected["account"]["id"], a.id);
}

#[test]
fn same_url_nonce_replacement_without_document_id_burns_grant_before_vault_read() {
    let (_d, e, id, _a) = setup();
    let store = e.store.lock().unwrap();
    let mut selected = store
        .get::<Selection>("site_account_selection", &id)
        .unwrap();
    selected.account.saved_fill = true;
    selected.account.credential_ref = Some("nonexistent-fixture".into());
    store
        .put("site_account", &selected.account.id, &selected.account)
        .unwrap();
    drop(store);
    let original = FormProof {
        document_id: None,
        ..form()
    };
    let grant = browser(
        &e,
        request(
            &e,
            &id,
            BrowserAction::Grant {
                proof: original.clone(),
            },
        ),
    )
    .unwrap();
    let grant_id = grant["grant_id"].as_str().unwrap().to_owned();
    let replacement = FormProof {
        document_nonce: uuid::Uuid::new_v4().to_string(),
        ..original.clone()
    };
    assert!(browser(
        &e,
        request(
            &e,
            &id,
            BrowserAction::Consume {
                grant_id: grant_id.clone(),
                proof: replacement
            }
        )
    )
    .unwrap_err()
    .to_string()
    .contains("binding_stale"));
    assert!(browser(
        &e,
        request(
            &e,
            &id,
            BrowserAction::Consume {
                grant_id,
                proof: original
            }
        )
    )
    .is_err());
}
