use crate::RequestContext;
use anyhow::{bail, Result};
use std::path::{Path, PathBuf};

pub fn validate_url(value: &str) -> Result<url::Url> {
    if value.len() > 32768 {
        bail!("URL exceeds 32 KiB");
    }
    let url = url::Url::parse(value)?;
    if !["http", "https", "ftp", "ftps"].contains(&url.scheme()) || url.host_str().is_none() {
        bail!("Only HTTP, HTTPS, FTP and FTPS sources are supported");
    }
    if !url.username().is_empty() || url.password().is_some() {
        bail!("Save credentials in Site logins instead of embedding them in URLs");
    }
    Ok(url)
}
pub fn safe_filename(input: &str) -> String {
    let value = input.rsplit(['/', '\\']).next().unwrap_or("download");
    let mut name: String = value
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    // Bound UTF-8 bytes as well as Windows UTF-16 units; retain room for suffixes.
    while name.len() > 180 {
        name.pop();
    }
    name = name.trim().trim_end_matches(['.', ' ']).to_string();
    if name.is_empty() || name == "." || name == ".." {
        name = "download".into();
    }
    let stem = name
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end()
        .to_ascii_uppercase();
    if [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9", "COM¹",
        "COM²", "COM³", "LPT¹", "LPT²", "LPT³",
    ]
    .contains(&stem.as_str())
    {
        name.insert(0, '_');
    }
    name
}
pub fn validate_context(context: &RequestContext) -> Result<()> {
    if context.headers.len() > 64 {
        bail!("Too many request headers");
    }
    for (k, v) in &context.headers {
        if k.is_empty()
            || k.len() > 128
            || v.len() > 65536
            || !k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            || v.contains(['\r', '\n', '\0'])
        {
            bail!("Invalid request header");
        }
        if [
            "host",
            "content-length",
            "connection",
            "transfer-encoding",
            "proxy-authorization",
            "range",
            "if-range",
        ]
        .contains(&k.to_ascii_lowercase().as_str())
        {
            bail!("Request header {k} is managed by the engine");
        }
    }
    Ok(())
}
pub fn unique_destination(directory: &Path, name: &str) -> PathBuf {
    let name = safe_filename(name);
    let candidate = directory.join(&name);
    if !candidate.exists() {
        return candidate;
    }
    let stem = Path::new(&name)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    let ext = Path::new(&name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    for n in 1..100000 {
        let candidate = directory.join(format!("{stem} ({n}){ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{}-{name}", uuid::Uuid::new_v4()))
}
pub fn redact(message: &str) -> String {
    let re = regex::Regex::new(r#"(?i)(https?|ftps?)://[^\s\"<>]+"#).unwrap();
    re.replace_all(message, |caps: &regex::Captures| {
        url::Url::parse(&caps[0])
            .map(|mut u| {
                let _ = u.set_username("");
                let _ = u.set_password(None);
                u.set_query(None);
                u.set_fragment(None);
                u.to_string()
            })
            .unwrap_or_else(|_| "[URL]".into())
    })
    .into_owned()
}
pub fn mark_download(path: &Path, source: &str) -> Result<()> {
    #[cfg(windows)]
    {
        use std::io::Write;
        let mut f = std::fs::File::create(format!("{}:Zone.Identifier", path.display()))?;
        write!(
            f,
            "[ZoneTransfer]\r\nZoneId=3\r\nHostUrl={}\r\n",
            source.replace(['\r', '\n'], "")
        )?;
    }
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("xattr")
            .args(["-w", "com.apple.quarantine", "0083;00000000;Downloader;"])
            .arg(path)
            .status()?;
        if !status.success() {
            bail!("Could not mark downloaded file with quarantine metadata");
        }
        let _ = source;
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (path, source);
    }
    Ok(())
}
pub fn save_credential(id: &str, username: &str, password: &str) -> Result<()> {
    if id.is_empty() || id.len() > 128 {
        bail!("Invalid credential ID");
    }
    keyring::Entry::new("Downloader", id)?
        .set_password(&serde_json::to_string(&(username, password))?)?;
    Ok(())
}
pub fn credential(id: &str) -> Result<(String, String)> {
    Ok(serde_json::from_str(
        &keyring::Entry::new("Downloader", id)?.get_password()?,
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn filenames_cannot_escape() {
        assert_eq!(safe_filename("../../CON.exe"), "_CON.exe");
        assert_eq!(safe_filename("a:b?.zip"), "a_b_.zip");
        assert_eq!(safe_filename(".."), "download");
        assert!(safe_filename(&"界".repeat(180)).len() <= 180);
        assert_eq!(safe_filename("CON .txt"), "_CON .txt");
        assert_eq!(safe_filename("COM¹.log"), "_COM¹.log");
    }
    #[test]
    fn reject_header_injection_and_credentials() {
        assert!(validate_url("https://user:pass@example.com").is_err());
        assert!(validate_url("file:///etc/passwd").is_err());
        let mut c = RequestContext::default();
        c.headers
            .insert("Cookie".into(), "a=b\r\nHost: evil".into());
        assert!(validate_context(&c).is_err());
    }
}
