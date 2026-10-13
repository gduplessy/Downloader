use anyhow::{bail, Result};
use clap::{Parser, Subcommand};
use downloader_core::{AddJob, Command, RequestContext};
use std::path::PathBuf;

#[derive(Parser)]
#[command(version, about = "Local, open-source download manager")]
struct Cli {
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    command: Action,
}
#[derive(Subcommand)]
enum Action {
    Add {
        url: String,
        #[arg(short, long)]
        directory: Option<PathBuf>,
        #[arg(short, long)]
        filename: Option<String>,
        #[arg(long)]
        queue: Option<String>,
        #[arg(long)]
        sha256: Option<String>,
        #[arg(long)]
        paused: bool,
        #[arg(long)]
        media: bool,
        /// Resolve a hosted download page through the browser extension.
        #[arg(long, conflicts_with = "media")]
        navigate: bool,
    },
    List,
    Watch,
    Pause {
        id: String,
    },
    Resume {
        id: String,
        #[arg(long)]
        restart: bool,
    },
    Cancel {
        id: String,
    },
    Remove {
        id: String,
        #[arg(long)]
        delete_file: bool,
    },
    Inspect {
        url: String,
    },
    Media {
        url: String,
    },
    Zip {
        url: String,
    },
    Refresh {
        id: String,
        url: String,
    },
    Export {
        file: PathBuf,
    },
    Import {
        file: PathBuf,
    },
    Diagnostics,
    /// Test a local FlareSolverr endpoint without enabling it.
    SolverTest {
        #[arg(long, default_value = "http://localhost:9191/")]
        endpoint: String,
    },
    /// Try the configured solver for an anonymous hosted-page job.
    Solve {
        id: String,
    },
    Settings,
    Set {
        file: PathBuf,
    },
    Queue {
        file: PathBuf,
    },
    Grabber {
        file: PathBuf,
    },
    GrabberRun {
        id: String,
    },
    /// Stage project resources; rendered resources require their chosen live browser session.
    GrabberDownload {
        id: String,
        urls: Vec<String>,
    },
    Register {
        #[arg(long)]
        chrome_id: Vec<String>,
        #[arg(long, default_value = "downloader@opensource.local")]
        firefox_id: Vec<String>,
        #[arg(long)]
        root: Option<PathBuf>,
    },
    Quit,
}
fn main() {
    if let Err(e) = run() {
        eprintln!("{e:#}");
        std::process::exit(1);
    }
}
fn run() -> Result<()> {
    let cli = Cli::parse();
    if let Action::Register {
        chrome_id,
        firefox_id,
        root,
    } = cli.command
    {
        println!(
            "{}",
            serde_json::to_string_pretty(&downloader_service::register(
                downloader_service::Registration {
                    chrome_ids: chrome_id,
                    firefox_ids: firefox_id
                },
                root.as_deref()
            )?)?
        );
        return Ok(());
    }
    downloader_service::ensure_service()?;
    if matches!(cli.command, Action::Watch) {
        downloader_service::call(Command::Negotiate {
            minimum: 1,
            maximum: 1,
        })?;
        let mut sequence = None;
        loop {
            let value = downloader_service::call(Command::Subscribe {
                after_sequence: sequence,
                limit: 100,
            })?;
            sequence = value["sequence"].as_u64();
            if cli.json {
                println!("{}", serde_json::to_string(&value)?);
            } else if value["snapshot"].is_object() {
                print_result(&value["snapshot"], false)?;
            } else {
                for event in value["events"].as_array().into_iter().flatten() {
                    if event["job"].is_object() {
                        print_result(&serde_json::json!({"jobs":[event["job"]]}), false)?;
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
    }
    let export = if let Action::Export { file } = &cli.command {
        Some(file.clone())
    } else {
        None
    };
    let command = match cli.command {
        Action::Add {
            url,
            directory,
            filename,
            queue,
            sha256,
            paused,
            media,
            navigate,
        } => {
            let add = AddJob {
                request_id: uuid::Uuid::new_v4().to_string(),
                url,
                directory,
                filename,
                queue,
                checksum: sha256,
                paused,
                context: RequestContext::default(),
                media: media.then(Default::default),
                description: String::new(),
            };
            if navigate {
                Command::Navigate(add)
            } else {
                Command::Add(add)
            }
        }
        Action::List => Command::Snapshot,
        Action::Pause { id } => Command::Pause { id },
        Action::Resume { id, restart } => Command::Resume { id, restart },
        Action::Cancel { id } => Command::Cancel { id },
        Action::Remove { id, delete_file } => Command::Remove { id, delete_file },
        Action::Inspect { url } => Command::Inspect {
            url,
            context: RequestContext::default(),
        },
        Action::Media { url } => Command::InspectMedia {
            url,
            context: RequestContext::default(),
        },
        Action::Zip { url } => Command::ZipPreview {
            url,
            context: RequestContext::default(),
        },
        Action::Refresh { id, url } => Command::Refresh {
            id,
            url,
            context: RequestContext::default(),
        },
        Action::Export { .. } => Command::Export,
        Action::Import { file } => {
            let value: serde_json::Value = serde_json::from_slice(&std::fs::read(file)?)?;
            Command::Import {
                jobs: serde_json::from_value(value["jobs"].clone())?,
            }
        }
        Action::Diagnostics => Command::Diagnostics,
        Action::SolverTest { endpoint } => Command::TestSolver {
            settings: downloader_core::solver::SolverSettings {
                endpoint,
                ..Default::default()
            },
        },
        Action::Solve { id } => Command::SolveChallenge {
            id,
            owner: None,
            url: None,
            automatic: false,
            scope: None,
            source_generation: None,
        },
        Action::Settings => Command::Snapshot,
        Action::Set { file } => Command::Settings(serde_json::from_slice(&std::fs::read(file)?)?),
        Action::Queue { file } => Command::Queue(serde_json::from_slice(&std::fs::read(file)?)?),
        Action::Grabber { file } => {
            Command::Grabber(serde_json::from_slice(&std::fs::read(file)?)?)
        }
        Action::GrabberRun { id } => Command::GrabberRun { id },
        Action::GrabberDownload { id, urls } => Command::GrabberDownload { id, urls },
        Action::Quit => Command::Quit,
        _ => bail!("Unsupported command"),
    };
    let value = downloader_service::call(command)?;
    if let Some(path) = export {
        std::fs::write(&path, serde_json::to_vec_pretty(&value)?)?;
        println!("Saved {}", path.display());
    } else {
        print_result(&value, cli.json)?;
    }
    Ok(())
}
fn print_result(value: &serde_json::Value, json: bool) -> Result<()> {
    if !json {
        if let Some(jobs) = value.get("jobs").and_then(|v| v.as_array()) {
            println!("{:<36}  {:<22} {:>12}  FILE", "ID", "STATE", "BYTES");
            for j in jobs {
                println!(
                    "{:<36}  {:<22} {:>12}  {}",
                    j["id"].as_str().unwrap_or(""),
                    j["state"].as_str().unwrap_or(""),
                    j["bytes"].as_u64().unwrap_or(0),
                    j["filename"].as_str().unwrap_or("")
                );
            }
            return Ok(());
        }
    }
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}
