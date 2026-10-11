//! Native OS-keyring lifecycle acceptance; only generated test credentials are used and removed.
use anyhow::{bail, Result};
use downloader_core::navigation::SessionScope;
use downloader_core::site_accounts::{Account, NativeVault, Vault};
fn main() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let store = downloader_core::store::Store::open(&dir.path().join("accounts.db"))?;
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
        let saved = downloader_core::site_accounts::save(
            &store,
            account,
            Some(password.clone()),
            &NativeVault,
        )?;
        let (username, value) = NativeVault.read(saved.credential_ref.as_deref().unwrap())?;
        if username != "fixture-user" || value != password {
            bail!("keyring round trip mismatch");
        }
        if serde_json::to_string(&store.all::<Account>("site_account")?)?.contains(&password) {
            bail!("secret persisted in account metadata");
        }
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
        serde_json::json!({"fixture":"nav-account-keyring-v1","os":std::env::consts::OS,"arch":std::env::consts::ARCH,"vault":"native-os-keyring","create_read_delete":"passed","nonsecret_metadata":"passed","test_credential_removed":true})
    );
    Ok(())
}
