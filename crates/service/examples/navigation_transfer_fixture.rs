//! Trusted desktop-side IPC driver for isolated installed-browser handoff fixtures.
//! Tokens pass only through piped stdin/stdout; never use this with user data.
use anyhow::{bail, Context, Result};
use downloader_core::Command;
use std::{io::Read, path::PathBuf};
fn main() -> Result<()> {
    let directory = PathBuf::from(
        std::env::var("DOWNLOADER_DATA_DIR")
            .context("An explicit isolated fixture data directory is required")?,
    );
    if !directory.is_absolute()
        || !directory
            .join("navigation-transfer-fixture-owned")
            .is_file()
    {
        bail!("The isolated navigation-transfer fixture marker is required");
    }
    let mut input = Vec::new();
    std::io::stdin().take(65_537).read_to_end(&mut input)?;
    if input.len() > 65_536 {
        bail!("Fixture command exceeds its bound");
    }
    let command: Command = serde_json::from_slice(&input)?;
    if !matches!(command, Command::NavigationTransfer(_)) {
        bail!("This fixture driver only sends desktop navigation handoff commands");
    }
    let result = downloader_service::call(command)?;
    serde_json::to_writer(std::io::stdout(), &result)?;
    Ok(())
}
