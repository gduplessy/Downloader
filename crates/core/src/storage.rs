//! Validate durable byte offsets before trusting an on-disk partial file.
use crate::{Job, Segment};
use anyhow::{bail, Context, Result};
use std::{
    fs::{File, OpenOptions},
    path::Path,
};

pub fn validate_checkpoint(job: &Job, file_length: u64) -> Result<()> {
    let mut segments: Vec<&Segment> = job.segments.iter().collect();
    segments.sort_by_key(|s| s.start);
    let mut previous_end = None;
    let mut bytes = 0u64;
    for s in segments {
        let length = s.end.checked_sub(s.start).and_then(|n| n.checked_add(1));
        if length.is_none_or(|length| s.downloaded > length) {
            bail!("storage_error: Invalid segment bounds in checkpoint");
        }
        if s.start != previous_end.map_or(0, |end: u64| end.saturating_add(1)) {
            bail!("storage_error: Overlapping or missing checkpoint segments");
        }
        if job.total.is_some_and(|total| s.end >= total) {
            bail!("storage_error: Segment exceeds remote file length");
        }
        if s.downloaded > 0
            && s.start
                .checked_add(s.downloaded)
                .is_none_or(|end| end > file_length)
        {
            bail!("storage_error: Partial file is shorter than durable checkpoint");
        }
        bytes = bytes
            .checked_add(s.downloaded)
            .context("storage_error: Checkpoint byte count overflow")?;
        previous_end = Some(s.end);
    }
    if bytes != job.bytes {
        bail!("storage_error: Checkpoint byte count does not match segments");
    }
    if job
        .total
        .is_some_and(|total| total > 0 && previous_end != Some(total - 1))
    {
        bail!("storage_error: Checkpoint does not cover the remote file");
    }
    Ok(())
}

pub fn open_partial(path: &Path, fresh: bool) -> Result<File> {
    let existing = match std::fs::symlink_metadata(path) {
        Ok(meta) => {
            if !meta.file_type().is_file()
                || meta.file_type().is_symlink()
                || (fresh && meta.len() > 0)
            {
                bail!("storage_error: Unsafe or unexpected partial file; explicitly restart");
            }
            true
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
        Err(e) => return Err(e).context("storage_error: Could not inspect partial file"),
    };
    let mut options = OpenOptions::new();
    options.read(true).write(true).create_new(!existing);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    let file = options
        .open(path)
        .context("storage_error: Could not open partial file")?;
    let meta = file.metadata()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if meta.nlink() != 1 {
            bail!("storage_error: Partial file has unexpected hard links");
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            bail!("storage_error: Partial file is a reparse point");
        }
    }
    if !meta.is_file() {
        bail!("storage_error: Partial output is not a regular file");
    }
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AddJob, Engine, RequestContext};
    fn job(path: &Path) -> Job {
        Engine::open(path)
            .unwrap()
            .add(AddJob {
                request_id: "offsets".into(),
                url: "https://example.invalid/file".into(),
                filename: None,
                directory: Some(path.into()),
                queue: None,
                checksum: None,
                paused: true,
                context: RequestContext::default(),
                media: None,
                description: String::new(),
            })
            .unwrap()
    }
    #[test]
    fn offsets_above_four_gib_and_unwritten_segments_are_validated() {
        let dir = tempfile::tempdir().unwrap();
        let mut j = job(dir.path());
        j.total = Some(6 * 1024 * 1024 * 1024);
        j.bytes = 123;
        j.segments = vec![
            Segment {
                start: 0,
                end: 4 * 1024 * 1024 * 1024 - 1,
                downloaded: 123,
            },
            Segment {
                start: 4 * 1024 * 1024 * 1024,
                end: j.total.unwrap() - 1,
                downloaded: 0,
            },
        ];
        validate_checkpoint(&j, 123).unwrap();
        j.segments[1].downloaded = 17;
        j.bytes += 17;
        assert!(validate_checkpoint(&j, 123).is_err());
        validate_checkpoint(&j, 4 * 1024 * 1024 * 1024 + 17).unwrap();
        j.segments[1].start = 1;
        assert!(validate_checkpoint(&j, j.total.unwrap()).is_err());
    }
    #[test]
    fn unexpected_partial_data_is_never_truncated() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("part");
        std::fs::write(&p, b"unrelated").unwrap();
        assert!(open_partial(&p, true).is_err());
        assert_eq!(std::fs::read(&p).unwrap(), b"unrelated");
    }
    #[cfg(windows)]
    #[test]
    fn locked_partial_is_reported_without_modification() {
        use std::os::windows::fs::OpenOptionsExt;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("locked");
        std::fs::write(&path, b"keep").unwrap();
        let lock = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .unwrap();
        let error = open_partial(&path, false).unwrap_err();
        assert!(error.to_string().contains("storage_error"));
        drop(lock);
        assert_eq!(std::fs::read(path).unwrap(), b"keep");
    }
    #[cfg(unix)]
    #[test]
    fn symlinks_and_aliased_partials_are_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let original = directory.path().join("original");
        std::fs::write(&original, b"keep").unwrap();
        let symlink = directory.path().join("symlink");
        std::os::unix::fs::symlink(&original, &symlink).unwrap();
        assert!(open_partial(&symlink, false).is_err());
        let alias = directory.path().join("alias");
        std::fs::hard_link(&original, &alias).unwrap();
        assert!(open_partial(&alias, false).is_err());
        assert_eq!(std::fs::read(original).unwrap(), b"keep");
    }
}
