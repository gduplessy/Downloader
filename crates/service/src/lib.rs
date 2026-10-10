use anyhow::{bail, Context, Result};
use downloader_core::{model::*, Engine};
#[cfg(unix)]
use interprocess::local_socket::GenericFilePath;
#[cfg(windows)]
use interprocess::local_socket::GenericNamespaced;
use interprocess::local_socket::{prelude::*, ListenerOptions, Stream};
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::Path,
    process::{Command, Stdio},
    sync::Arc,
    time::Duration,
};

pub const HOST_NAME: &str = "org.downloader.native";
const MAX_MESSAGE: usize = 1024 * 1024;

fn socket_name() -> Result<interprocess::local_socket::Name<'static>> {
    #[cfg(windows)]
    {
        use std::hash::{Hash, Hasher};
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        data_dir().hash(&mut hash);
        Ok(format!("downloader-{:x}", hash.finish())
            .to_ns_name::<GenericNamespaced>()?
            .into_owned())
    }
    #[cfg(unix)]
    {
        Ok(data_dir()
            .join("engine.sock")
            .to_fs_name::<GenericFilePath>()?
            .into_owned())
    }
}
pub fn read_frame(reader: &mut impl Read, max: usize) -> Result<Option<Vec<u8>>> {
    let mut size = [0u8; 4];
    match reader.read_exact(&mut size) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let size = u32::from_ne_bytes(size) as usize;
    if size == 0 || size > max {
        bail!("Message exceeds allowed size");
    }
    let mut data = vec![0; size];
    reader.read_exact(&mut data)?;
    Ok(Some(data))
}
pub fn write_frame(writer: &mut impl Write, data: &[u8], max: usize) -> Result<()> {
    if data.is_empty() || data.len() > max {
        bail!("Response exceeds allowed size");
    }
    writer.write_all(&(data.len() as u32).to_ne_bytes())?;
    writer.write_all(data)?;
    writer.flush()?;
    Ok(())
}
pub fn call(command: downloader_core::Command) -> Result<serde_json::Value> {
    let mut stream = Stream::connect(socket_name()?).context("Engine is not running")?;
    let request = Request {
        version: PROTOCOL_VERSION,
        id: format!(
            "{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_nanos()
        ),
        command,
    };
    write_frame(&mut stream, &serde_json::to_vec(&request)?, MAX_MESSAGE)?;
    let bytes =
        read_frame(&mut stream, 8 * MAX_MESSAGE)?.context("Engine closed the connection")?;
    let response: Response = serde_json::from_slice(&bytes)?;
    if !response.ok {
        bail!(
            "{}",
            response
                .error
                .map(|e| e.message)
                .unwrap_or_else(|| "Engine request failed".into())
        );
    }
    Ok(response.data)
}
pub fn ensure_service() -> Result<()> {
    if Stream::connect(socket_name()?).is_ok() {
        return Ok(());
    }
    let current = std::env::current_exe()?;
    let service = current
        .parent()
        .context("Executable directory unavailable")?
        .join(format!(
            "downloader-service{}",
            std::env::consts::EXE_SUFFIX
        ));
    let mut command = Command::new(&service);
    command
        .arg("daemon")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000 | 0x00000200);
    }
    command
        .spawn()
        .with_context(|| format!("Could not start {}", service.display()))?;
    for _ in 0..100 {
        if Stream::connect(socket_name()?).is_ok() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    bail!("Engine did not start within 10 seconds")
}
pub fn serve() -> Result<()> {
    let directory = data_dir();
    std::fs::create_dir_all(&directory)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))?;
    }
    let options = ListenerOptions::new().name(socket_name()?);
    #[cfg(windows)]
    let options = {
        use interprocess::os::windows::{
            local_socket::ListenerOptionsExt, security_descriptor::SecurityDescriptor,
        };
        let sddl = widestring::U16CString::from_str("D:P(A;;GA;;;OW)")?;
        options.security_descriptor(SecurityDescriptor::deserialize(&sddl)?)
    };
    #[cfg(unix)]
    let options = {
        use interprocess::os::unix::local_socket::ListenerOptionsExt;
        options.mode(0o600)
    };
    let listener = options.create_sync()?;
    let engine = Engine::open(&directory)?;
    engine.start();
    for stream in listener.incoming() {
        if engine.stopping.load(std::sync::atomic::Ordering::Relaxed) {
            break;
        }
        let mut stream = stream?;
        let engine = engine.clone();
        std::thread::spawn(move || {
            let _ = handle(&mut stream, &engine);
        });
    }
    engine.shutdown();
    Ok(())
}
fn handle(stream: &mut impl ReadWrite, engine: &Arc<Engine>) -> Result<()> {
    let data = read_frame(stream, MAX_MESSAGE)?.context("No request")?;
    let request: Request = serde_json::from_slice(&data)?;
    let response = if request.version != PROTOCOL_VERSION {
        Response::failure(
            request.id,
            "protocol_mismatch",
            "Upgrade the app and extension to compatible versions".into(),
        )
    } else {
        match engine.command(request.command) {
            Ok(data) => Response::success(request.id, data),
            Err(e) => Response::failure(
                request.id,
                "command_failed",
                downloader_core::security::redact(&e.to_string()),
            ),
        }
    };
    write_frame(stream, &serde_json::to_vec(&response)?, 8 * MAX_MESSAGE)?;
    if engine.stopping.load(std::sync::atomic::Ordering::Relaxed) {
        let _ = Stream::connect(socket_name()?);
    }
    Ok(())
}
trait ReadWrite: Read + Write {}
impl<T: Read + Write> ReadWrite for T {}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Registration {
    pub chrome_ids: Vec<String>,
    pub firefox_ids: Vec<String>,
}
pub fn register(config: Registration, root: Option<&Path>) -> Result<serde_json::Value> {
    if config
        .chrome_ids
        .iter()
        .any(|id| id.len() != 32 || !id.bytes().all(|b| (b'a'..=b'p').contains(&b)))
    {
        bail!("Chromium extension IDs must contain 32 letters a-p");
    }
    if config
        .firefox_ids
        .iter()
        .any(|id| id.is_empty() || id.contains(['\r', '\n', '\0']))
    {
        bail!("Invalid Firefox extension ID");
    }
    let directory = root.map(Path::to_path_buf).unwrap_or_else(data_dir);
    std::fs::create_dir_all(&directory)?;
    std::fs::write(
        directory.join("native-allowlist.json"),
        serde_json::to_vec_pretty(&config)?,
    )?;
    let binary = std::env::current_exe()?.parent().unwrap().join(format!(
        "downloader-service{}",
        std::env::consts::EXE_SUFFIX
    ));
    let chromium = serde_json::json!({"name":HOST_NAME,"description":"Downloader browser integration","path":binary,"type":"stdio","allowed_origins":config.chrome_ids.iter().map(|id|format!("chrome-extension://{id}/")).collect::<Vec<_>>()});
    let firefox = serde_json::json!({"name":HOST_NAME,"description":"Downloader browser integration","path":binary,"type":"stdio","allowed_extensions":config.firefox_ids});
    let chrome_path = directory.join("chromium-native.json");
    let firefox_path = directory.join("firefox-native.json");
    std::fs::write(&chrome_path, serde_json::to_vec_pretty(&chromium)?)?;
    std::fs::write(&firefox_path, serde_json::to_vec_pretty(&firefox)?)?;
    if root.is_none() {
        #[cfg(windows)]
        for (browser, path) in [
            ("Google\\Chrome", &chrome_path),
            ("Microsoft\\Edge", &chrome_path),
            ("Mozilla", &firefox_path),
        ] {
            let key = format!("HKCU\\Software\\{browser}\\NativeMessagingHosts\\{HOST_NAME}");
            let mut cmd = Command::new("reg");
            cmd.args(["ADD", &key, "/ve", "/t", "REG_SZ", "/d"])
                .arg(path)
                .arg("/f");
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
            if !cmd.status()?.success() {
                bail!("Could not register native host");
            }
        }
        #[cfg(target_os = "macos")]
        for (folder, manifest) in [
            (
                "Library/Application Support/Google/Chrome/NativeMessagingHosts",
                &chromium,
            ),
            (
                "Library/Application Support/Microsoft Edge/NativeMessagingHosts",
                &chromium,
            ),
            (
                "Library/Application Support/Mozilla/NativeMessagingHosts",
                &firefox,
            ),
        ] {
            let p = dirs::home_dir().context("Home unavailable")?.join(folder);
            std::fs::create_dir_all(&p)?;
            std::fs::write(
                p.join(format!("{HOST_NAME}.json")),
                serde_json::to_vec_pretty(manifest)?,
            )?;
        }
        #[cfg(target_os = "linux")]
        for (folder, manifest) in [
            (".config/google-chrome/NativeMessagingHosts", &chromium),
            (".config/microsoft-edge/NativeMessagingHosts", &chromium),
            (".mozilla/native-messaging-hosts", &firefox),
        ] {
            let p = dirs::home_dir().context("Home unavailable")?.join(folder);
            std::fs::create_dir_all(&p)?;
            std::fs::write(
                p.join(format!("{HOST_NAME}.json")),
                serde_json::to_vec_pretty(manifest)?,
            )?;
        }
    }
    Ok(serde_json::json!({"chromium":chrome_path,"firefox":firefox_path,"host":HOST_NAME}))
}
pub fn native(args: &[String]) -> Result<()> {
    let config: Registration = serde_json::from_slice(
        &std::fs::read(data_dir().join("native-allowlist.json"))
            .context("Native host has not been registered")?,
    )?;
    let allowed = args.first().is_some_and(|origin| {
        config
            .chrome_ids
            .iter()
            .any(|id| origin == &format!("chrome-extension://{id}/"))
    }) || args
        .get(1)
        .is_some_and(|id| config.firefox_ids.contains(id));
    if !allowed {
        bail!("Unregistered extension origin");
    }
    ensure_service()?;
    let mut stdin = std::io::stdin().lock();
    let mut stdout = std::io::stdout().lock();
    while let Some(bytes) = read_frame(&mut stdin, MAX_MESSAGE)? {
        let request: Request = serde_json::from_slice(&bytes)?;
        let id = request.id.clone();
        let result = (|| -> Result<serde_json::Value> {
            if request.version != PROTOCOL_VERSION {
                bail!("Protocol version mismatch");
            }
            match request.command {
                downloader_core::Command::Add(mut add) => {
                    add.directory = None;
                    add.checksum = None;
                    add.context.browser = Some("extension".into());
                    call(downloader_core::Command::Add(add))
                }
                downloader_core::Command::Navigate(mut add) => {
                    add.directory = None;
                    add.checksum = None;
                    add.context.browser = Some("extension".into());
                    call(downloader_core::Command::Navigate(add))
                }
                downloader_core::Command::Snapshot => {
                    browser_snapshot(call(downloader_core::Command::Snapshot)?)
                }
                c @ (downloader_core::Command::Pause { .. }
                | downloader_core::Command::Resume { restart: false, .. }
                | downloader_core::Command::Cancel { .. }
                | downloader_core::Command::Resolve { .. }
                | downloader_core::Command::ClaimNavigation { .. }
                | downloader_core::Command::BrowserStatus { .. }) => {
                    let id = match &c {
                        downloader_core::Command::Pause { id }
                        | downloader_core::Command::Resume { id, .. }
                        | downloader_core::Command::Cancel { id }
                        | downloader_core::Command::Resolve { id, .. }
                        | downloader_core::Command::ClaimNavigation { id, .. }
                        | downloader_core::Command::BrowserStatus { id, .. } => id,
                        _ => unreachable!(),
                    };
                    let snapshot = call(downloader_core::Command::Snapshot)?;
                    if !snapshot["jobs"].as_array().is_some_and(|jobs| {
                        jobs.iter()
                            .any(|j| j["id"].as_str() == Some(id) && browser_visible(j))
                    }) {
                        bail!("Browser cannot control this job");
                    }
                    call(c)
                }
                c @ (downloader_core::Command::Inspect { .. }
                | downloader_core::Command::InspectMedia { .. }) => call(c),
                downloader_core::Command::Diagnostics => {
                    let mut data = call(downloader_core::Command::Diagnostics)?;
                    data.as_object_mut().unwrap().remove("jobs");
                    data.as_object_mut().unwrap().remove("components");
                    Ok(data)
                }
                _ => bail!("Command is not allowed from a browser extension"),
            }
        })();
        let mut response = match result {
            Ok(data) => Response::success(id.clone(), data),
            Err(e) => Response::failure(
                id.clone(),
                "native_failed",
                downloader_core::security::redact(&e.to_string()),
            ),
        };
        let mut data = serde_json::to_vec(&response)?;
        if data.len() > MAX_MESSAGE {
            response = Response::failure(
                id,
                "response_too_large",
                "Use the desktop application for this result".into(),
            );
            data = serde_json::to_vec(&response)?;
        }
        write_frame(&mut stdout, &data, MAX_MESSAGE)?;
    }
    Ok(())
}
fn browser_visible(job: &serde_json::Value) -> bool {
    job["browser_source"] == true || job["page_url"].is_string()
}
fn browser_snapshot(data: serde_json::Value) -> Result<serde_json::Value> {
    // No local paths, configuration, credentials, or unrelated desktop jobs.
    let jobs=data["jobs"].as_array().context("Invalid engine snapshot")?.iter().filter(|j|browser_visible(j)).map(|j|serde_json::json!({
        "id":j["id"],"request_id":j["request_id"],"url":j["url"],"page_url":j["page_url"],"navigation_owner":j["navigation_owner"],"filename":j["filename"],
        "state":j["state"],"bytes":j["bytes"],"total":j["total"],"viable":j["viable"],"error":j["error"]
    })).collect::<Vec<_>>();
    Ok(serde_json::json!({"version":data["version"],"sequence":data["sequence"],"jobs":jobs}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_binary_framing() {
        let mut out = Vec::new();
        write_frame(&mut out, "العربية".as_bytes(), 1024).unwrap();
        assert_eq!(
            read_frame(&mut out.as_slice(), 1024).unwrap().unwrap(),
            "العربية".as_bytes()
        );
        assert!(read_frame(&mut (2048u32.to_ne_bytes().as_slice()), 1024).is_err());
    }
}
