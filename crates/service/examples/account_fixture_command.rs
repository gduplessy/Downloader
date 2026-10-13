//! Trusted desktop-side fixture IPC. Never exposes credential consume responses to HTTP.
use anyhow::{bail, Result};
use std::io::Read;
fn main() -> Result<()> {
    let mut source = String::new();
    std::io::stdin().read_to_string(&mut source)?;
    let command: downloader_core::Command = serde_json::from_str(&source)?;
    if !matches!(
        command,
        downloader_core::Command::SiteAccount(_)
            | downloader_core::Command::Snapshot
            | downloader_core::Command::Settings(_)
            | downloader_core::Command::Navigate(_)
            | downloader_core::Command::Cancel { .. }
            | downloader_core::Command::Quit
    ) {
        bail!("Fixture desktop command not allowed");
    }
    println!("{}", downloader_service::call(command)?);
    Ok(())
}
