//! Fixture-only command transport. Uses an isolated directory supplied by the runner.
use std::io::{BufRead, Write};
fn main() -> anyhow::Result<()> {
    let path = std::env::args_os()
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("Fixture data directory required"))?;
    let engine = downloader_core::Engine::open(std::path::Path::new(&path))?;
    for line in std::io::stdin().lock().lines() {
        let line = line?;
        let result = (|| -> anyhow::Result<serde_json::Value> {
            let command = serde_json::from_str(&line)?;
            engine.command(command)
        })();
        let value = match result {
            Ok(data) => serde_json::json!({"ok":true,"data":data}),
            Err(error) => serde_json::json!({"ok":false,"error":error.to_string()}),
        };
        println!("{}", value);
        std::io::stdout().flush()?;
    }
    Ok(())
}
