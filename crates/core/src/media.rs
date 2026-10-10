use crate::{model::*, security, store::Store, transfer::SharedJob};
use anyhow::{bail, Context, Result};
use std::{
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

fn executable(settings: &Settings, name: &str) -> PathBuf {
    settings
        .components
        .join(format!("{name}{}", std::env::consts::EXE_SUFFIX))
}
pub fn components(settings: &Settings) -> Vec<ComponentStatus> {
    ["yt-dlp", "ffmpeg", "ffprobe", "deno"]
        .into_iter()
        .map(|name| {
            let path = executable(settings, name);
            ComponentStatus {
                name: name.into(),
                available: path.is_file(),
                path,
            }
        })
        .collect()
}
fn command(settings: &Settings, context: &RequestContext, url: &str) -> Result<Command> {
    security::validate_url(url)?;
    security::validate_context(context)?;
    for component in components(settings) {
        if !component.available {
            bail!(
                "component_missing: {} is not installed; use Components setup",
                component.name
            );
        }
    }
    let mut command = Command::new(executable(settings, "yt-dlp"));
    command
        .args([
            "--ignore-config",
            "--no-plugin-dirs",
            "--no-colors",
            "--ffmpeg-location",
        ])
        .arg(&settings.components)
        .arg("--js-runtimes")
        .arg(format!("deno:{}", executable(settings, "deno").display()));
    for (k, v) in &context.headers {
        command.arg("--add-header").arg(format!("{k}:{v}"));
    }
    if let Some(proxy) = settings.proxy.as_ref().filter(|v| !v.is_empty()) {
        command.arg("--proxy").arg(proxy);
    }
    command.arg("--").arg(url);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    Ok(command)
}
pub fn inspect(
    url: &str,
    context: &RequestContext,
    settings: &Settings,
) -> Result<serde_json::Value> {
    let command = command(settings, context, url)?;
    // Insert options before the URL separator; no shell or ambient yt-dlp configuration.
    let args: Vec<_> = command.get_args().map(|a| a.to_os_string()).collect();
    let mut c = Command::new(command.get_program());
    c.args(&args[..args.len() - 2])
        .args(["--dump-single-json", "--skip-download", "--no-playlist"])
        .args(&args[args.len() - 2..]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x08000000);
    }
    let output = c.output()?;
    if !output.status.success() {
        bail!(
            "Media inspection failed: {}",
            security::redact(&String::from_utf8_lossy(&output.stderr))
        );
    }
    Ok(serde_json::from_slice(&output.stdout)?)
}
pub fn run(
    job: SharedJob,
    store: Arc<Mutex<Store>>,
    settings: Settings,
    context: RequestContext,
    control: Arc<AtomicU8>,
    rate: u64,
) -> Result<()> {
    let snapshot = job.lock().unwrap().clone();
    let options = snapshot.media.clone().context("Missing media options")?;
    let base = command(&settings, &context, &snapshot.url)?;
    let args: Vec<_> = base.get_args().map(|a| a.to_os_string()).collect();
    let mut command = Command::new(base.get_program());
    command.args(&args[..args.len() - 2]);
    command.args([
        "--newline",
        "--progress",
        "--continue",
        "--no-overwrites",
        "--concurrent-fragments",
        "1",
        "--retries",
        "5",
        "--fragment-retries",
        "5",
        "--progress-template",
        "download:DOWNLOADER_PROGRESS:%(progress)j",
        "--print",
        "after_move:DOWNLOADER_FILE:%(filepath)j",
        "--embed-metadata",
    ]);
    command.arg(if options.playlist {
        "--yes-playlist"
    } else {
        "--no-playlist"
    });
    if let Some(format) = &options.format {
        if format.len() > 512 {
            bail!("Format selector is too long");
        }
        command.args(["--format", format]);
    }
    if options.audio_only {
        command.args(["--extract-audio", "--audio-format", "mp3"]);
    }
    if options.subtitles {
        command.args([
            "--write-subs",
            "--write-auto-subs",
            "--sub-langs",
            "all,-live_chat",
        ]);
    }
    if options.thumbnail {
        command.arg("--write-thumbnail");
    }
    if let Some(container) = &options.container {
        if !["mp4", "mkv", "webm"].contains(&container.as_str()) {
            bail!("Unsupported media container");
        }
        command.args(["--merge-output-format", container]);
    }
    if rate > 0 {
        command.arg("--limit-rate").arg(rate.to_string());
    }
    let output = if options.playlist {
        std::fs::create_dir_all(&snapshot.destination)?;
        snapshot
            .destination
            .join("%(playlist_index)03d-%(title).160B [%(id)s].%(ext)s")
    } else {
        if let Some(p) = snapshot.destination.parent() {
            std::fs::create_dir_all(p)?;
        }
        snapshot.destination.clone()
    };
    command
        .arg("--output")
        .arg(output)
        .args(&args[args.len() - 2..]);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn()?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let errors = std::thread::spawn(move || {
        let mut tail = String::new();
        for line in BufReader::new(stderr)
            .lines()
            .map_while(std::result::Result::ok)
        {
            tail.push_str(&line);
            tail.push('\n');
            if tail.len() > 8192 {
                tail = tail
                    .chars()
                    .rev()
                    .take(4096)
                    .collect::<String>()
                    .chars()
                    .rev()
                    .collect();
            }
        }
        tail
    });
    let output_job = job.clone();
    let files = Arc::new(Mutex::new(Vec::<PathBuf>::new()));
    let out_files = files.clone();
    let progress = std::thread::spawn(move || {
        for line in BufReader::new(stdout)
            .lines()
            .map_while(std::result::Result::ok)
        {
            if let Some(data) = line.strip_prefix("DOWNLOADER_PROGRESS:") {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(data) {
                    let mut j = output_job.lock().unwrap();
                    j.bytes = value["downloaded_bytes"].as_u64().unwrap_or(j.bytes);
                    j.total = value["total_bytes"]
                        .as_u64()
                        .or(value["total_bytes_estimate"].as_u64());
                    j.speed = value["speed"].as_f64().unwrap_or(0.0).max(0.0) as u64;
                    j.state = if value["status"] == "finished" {
                        JobState::Assembling
                    } else {
                        JobState::Downloading
                    };
                    j.resumable = true;
                    j.viable = true;
                }
            }
            if let Some(data) = line.strip_prefix("DOWNLOADER_FILE:") {
                if let Ok(path) = serde_json::from_str::<String>(data) {
                    out_files.lock().unwrap().push(PathBuf::from(path));
                }
            }
        }
    });
    loop {
        if control.load(Ordering::Relaxed) != 0 {
            #[cfg(windows)]
            {
                let _ = Command::new("taskkill")
                    .args(["/PID", &child.id().to_string(), "/T", "/F"])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
            }
            let _ = child.kill();
            let _ = child.wait();
            break;
        }
        if child.try_wait()?.is_some() {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let status = child.wait()?;
    let _ = progress.join();
    let error = errors.join().unwrap_or_default();
    let snapshot_bytes = job.lock().unwrap().bytes;
    store.lock().unwrap().record_usage(snapshot_bytes)?;
    if control.load(Ordering::Relaxed) != 0 {
        return Ok(());
    }
    if !status.success() {
        bail!("Media download failed: {}", security::redact(&error));
    }
    let files = files.lock().unwrap();
    if files.is_empty() {
        bail!("Media tool produced no completed output");
    }
    for path in files.iter() {
        if !path.is_file() {
            bail!("Completed media output is missing");
        }
        security::mark_download(path, &snapshot.url)?;
        if let Some(scanner) = &settings.scanner {
            job.lock().unwrap().state = JobState::Scanning;
            let status = Command::new(&scanner.executable)
                .args(
                    scanner
                        .args
                        .iter()
                        .map(|a| a.replace("{file}", &path.to_string_lossy())),
                )
                .status()?;
            if !status.success() {
                bail!("scan_failed: Scanner reported an error or threat");
            }
        }
    }
    let mut j = job.lock().unwrap();
    if !options.playlist {
        j.destination = files[0].clone();
        j.filename = j
            .destination
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        j.bytes = std::fs::metadata(&j.destination)?.len();
        j.total = Some(j.bytes);
    }
    j.state = JobState::Complete;
    Ok(())
}
