//! Supervise configured scanner descendants without invoking a shell.
#[cfg(windows)]
use anyhow::Context;
use anyhow::Result;
use std::process::{Child, Command};

pub struct ProcessTree {
    #[cfg(windows)]
    handle: windows_sys::Win32::Foundation::HANDLE,
    #[cfg(unix)]
    group: i32,
}
impl ProcessTree {
    pub fn terminate(&self) {
        #[cfg(windows)]
        unsafe {
            windows_sys::Win32::System::JobObjects::TerminateJobObject(self.handle, 1);
        }
        #[cfg(unix)]
        unsafe {
            libc::kill(-self.group, libc::SIGKILL);
        }
    }
}
impl Drop for ProcessTree {
    fn drop(&mut self) {
        self.terminate();
        #[cfg(windows)]
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.handle);
        }
    }
}
pub fn spawn(command: &mut Command) -> Result<(Child, ProcessTree)> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
        let child = command.spawn()?;
        let tree = ProcessTree {
            group: child.id() as i32,
        };
        Ok((child, tree))
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::*;
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(std::io::Error::last_os_error()).context("Scanner job creation failed");
        }
        let tree = ProcessTree { handle };
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&limits) as u32,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error())
                .context("Scanner job configuration failed");
        }
        let mut child = command.spawn()?;
        if unsafe { AssignProcessToJobObject(handle, child.as_raw_handle()) } == 0 {
            let error = std::io::Error::last_os_error();
            let _ = child.kill();
            let _ = child.wait();
            return Err(error).context("Scanner process supervision failed");
        }
        Ok((child, tree))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        process::Stdio,
        time::{Duration, Instant},
    };
    #[test]
    #[ignore = "Scanner subprocess fixture"]
    fn scanner_child() {
        let marker = std::path::PathBuf::from(std::env::var("DOWNLOADER_SCANNER_MARKER").unwrap());
        if std::env::var("DOWNLOADER_SCANNER_LEAF").is_ok() {
            for i in 0..1000 {
                std::fs::write(&marker, i.to_string()).unwrap();
                std::thread::sleep(Duration::from_millis(20));
            }
        } else {
            // Let the parent attach its Windows job before spawning a descendant.
            std::thread::sleep(Duration::from_millis(200));
            let mut command = fixture(&marker);
            command.env("DOWNLOADER_SCANNER_LEAF", "1");
            let mut child = command.spawn().unwrap();
            let _ = child.wait();
        }
    }
    fn fixture(marker: &std::path::Path) -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", "process::tests::scanner_child", "--ignored"])
            .env("DOWNLOADER_SCANNER_MARKER", marker)
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        command
    }
    #[test]
    fn scanner_cancellation_stops_descendant_activity() {
        let directory = tempfile::tempdir().unwrap();
        let marker = directory.path().join("heartbeat");
        let (mut child, tree) = spawn(&mut fixture(&marker)).unwrap();
        let start = Instant::now();
        while !marker.exists() {
            assert!(start.elapsed() < Duration::from_secs(5));
            std::thread::sleep(Duration::from_millis(20));
        }
        tree.terminate();
        let _ = child.wait();
        std::thread::sleep(Duration::from_millis(200));
        let before = std::fs::read(&marker).unwrap();
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(before, std::fs::read(marker).unwrap());
    }
}
