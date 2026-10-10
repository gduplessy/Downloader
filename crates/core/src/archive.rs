use crate::{transfer, RequestContext, Settings};
use anyhow::{bail, Context, Result};
use std::io::{Cursor, Read, Seek, SeekFrom};

// Range-backed reader keeps ZIP previews bounded even for multi-gigabyte archives.
struct RemoteReader<'a> {
    url: &'a str,
    context: &'a RequestContext,
    settings: &'a Settings,
    length: u64,
    position: u64,
    budget: usize,
}
impl Read for RemoteReader<'_> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        if self.position >= self.length {
            return Ok(0);
        }
        let size = buffer
            .len()
            .min(256 * 1024)
            .min(self.budget)
            .min((self.length - self.position) as usize);
        if size == 0 {
            return Err(std::io::Error::other(
                "ZIP preview exceeds 16 MiB metadata budget",
            ));
        }
        let (_, bytes) = transfer::fetch_bytes(
            self.url,
            self.context,
            self.settings,
            size,
            Some((self.position, self.position + size as u64 - 1)),
        )
        .map_err(|e| std::io::Error::other(e.to_string()))?;
        buffer[..bytes.len()].copy_from_slice(&bytes);
        self.position += bytes.len() as u64;
        self.budget -= bytes.len();
        Ok(bytes.len())
    }
}
impl Seek for RemoteReader<'_> {
    fn seek(&mut self, seek: SeekFrom) -> std::io::Result<u64> {
        let value = match seek {
            SeekFrom::Start(n) => n as i128,
            SeekFrom::End(n) => self.length as i128 + n as i128,
            SeekFrom::Current(n) => self.position as i128 + n as i128,
        };
        if value < 0 || value > self.length as i128 {
            return Err(std::io::Error::other("Invalid ZIP offset"));
        }
        self.position = value as u64;
        Ok(self.position)
    }
}
pub fn preview(
    url: &str,
    context: &RequestContext,
    settings: &Settings,
) -> Result<serde_json::Value> {
    let meta = transfer::inspect(url, context, settings)?;
    let length = meta
        .total
        .context("ZIP preview requires a known source size")?;
    fn entries<R: Read + Seek>(reader: R) -> Result<serde_json::Value> {
        let mut archive = zip::ZipArchive::new(reader)?;
        if archive.len() > 100000 {
            bail!("ZIP has too many entries");
        }
        let mut files = vec![];
        for i in 0..archive.len() {
            let file = archive.by_index_raw(i)?;
            files.push(serde_json::json!({"name":file.name(),"size":file.size(),"compressed":file.compressed_size(),"directory":file.is_dir(),"safe_path":file.enclosed_name().is_some()}));
        }
        Ok(serde_json::to_value(files)?)
    }
    if meta.ranges {
        entries(RemoteReader {
            url: &meta.url,
            context: &meta.context,
            settings,
            length,
            position: 0,
            budget: 16 * 1024 * 1024,
        })
    } else if length <= 16 * 1024 * 1024 {
        let (_, bytes) = transfer::fetch_bytes(url, context, settings, 16 * 1024 * 1024, None)?;
        entries(Cursor::new(bytes))
    } else {
        bail!("Large ZIP preview requires byte-range support")
    }
}
