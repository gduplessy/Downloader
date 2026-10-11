//! Native OS-keyring lifecycle acceptance; only generated test credentials are used and removed.
use anyhow::{bail, Result};
use downloader_core::navigation::SessionScope;
use downloader_core::site_accounts::{Account, NativeVault, Vault};
fn main() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let engine = downloader_core::Engine::open(&dir.path().join("engine"))?;
    let account = Account {
        id: uuid::Uuid::new_v4().to_string(),
        label: "Qualification fixture".into(),
        origin: "http://127.0.0.1:18783".into(),
        provider: "local-fixture".into(),
        account_id: "fixture-user".into(),
        scope: SessionScope {
            browser: "chromium".into(),
            profile: uuid::Uuid::new_v4().to_string(),
            private: false,
            cookie_store_id: Some("0".into()),
            container_id: None,
            partition_key: None,
            claim_generation: 1,
        },
        saved_fill: true,
        credential_ref: None,
    };
    let password = format!("fixture-only-{}", uuid::Uuid::new_v4());
    let reference = format!("nav-account-{}", account.id);
    let result = (|| -> Result<()> {
        use downloader_core::site_accounts::{
            BrowserAction, BrowserRequest, DesktopRequest, FormProof, Mode,
        };
        use downloader_core::{AddJob, Command, RequestContext};
        let page = "http://127.0.0.1:18783/nav-adapters/ddownload/login";
        let owner = account.scope.profile.clone();
        let navigation = engine.command(Command::Navigate(AddJob {
            request_id: uuid::Uuid::new_v4().to_string(),
            url: page.into(),
            filename: None,
            directory: None,
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
        }))?;
        let job_id = navigation["id"].as_str().unwrap().to_string();
        engine.command(Command::ClaimNavigation {
            id: job_id.clone(),
            owner: owner.clone(),
            force: false,
            scope: Some(account.scope.clone()),
            source_generation: Some(1),
        })?;
        let saved = engine.command(Command::SiteAccount(DesktopRequest::Save {
            account: Box::new(account),
            password: Some(password.clone()),
        }))?;
        let account_id = saved["id"].as_str().unwrap().to_string();
        let selected = engine.command(Command::SiteAccount(DesktopRequest::Select {
            job_id: job_id.clone(),
            account_id: Some(account_id.clone()),
            mode: Mode::Premium,
        }))?;
        let scope: SessionScope = serde_json::from_value(selected["navigation_scope"].clone())?;
        let generation = selected["source_generation"].as_u64().unwrap();
        let proof = FormProof {
            tab_id: 10,
            frame_id: 0,
            origin: "http://127.0.0.1:18783".into(),
            page: page.into(),
            action: page.into(),
            method: "POST".into(),
            adapter_id: "local-fixture".into(),
            adapter_version: "1.0.0".into(),
            fingerprint: "a".repeat(64),
            document_generation: 1,
            document_id: Some("qualification-document".into()),
            username_name: "username".into(),
            password_name: "password".into(),
        };
        let command = |request| {
            Command::BrowserAccount(BrowserRequest {
                job_id: job_id.clone(),
                owner: owner.clone(),
                scope: scope.clone(),
                source_generation: generation,
                request,
            })
        };
        let grant = engine.command(command(BrowserAction::Grant {
            proof: proof.clone(),
        }))?;
        let grant_id = grant["grant_id"].as_str().unwrap().to_string();
        let credentials = engine.command(command(BrowserAction::Consume {
            grant_id: grant_id.clone(),
            proof: proof.clone(),
        }))?;
        if credentials["username"] != "fixture-user" || credentials["password"] != password {
            bail!("scoped native grant credential mismatch");
        }
        if engine
            .command(command(BrowserAction::Consume { grant_id, proof }))
            .is_ok()
        {
            bail!("one-use grant was reused");
        }
        if serde_json::to_string(&engine.snapshot())?.contains(&password)
            || serde_json::to_string(
                &engine
                    .store
                    .lock()
                    .unwrap()
                    .all::<Account>("site_account")?,
            )?
            .contains(&password)
        {
            bail!("secret persisted in account metadata or snapshot");
        }
        engine.command(Command::SiteAccount(DesktopRequest::Remove {
            id: account_id,
        }))?;
        Ok(())
    })();
    // Cleanup runs on success and failure; never retain qualification credentials.
    NativeVault.delete(&reference)?;
    if NativeVault.read(&reference).is_ok() {
        bail!("keyring deletion did not remove fixture credential");
    }
    result?;
    println!(
        "{}",
        serde_json::json!({"fixture":"nav-account-keyring-v1","os":std::env::consts::OS,"arch":std::env::consts::ARCH,"vault":"native-os-keyring","create_read_delete":"passed","nonsecret_metadata":"passed","engine_scoped_grant":"passed","duplicate_consume_rejected":true,"test_credential_removed":true})
    );
    Ok(())
}
