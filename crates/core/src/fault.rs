//! Deterministic process termination hooks, absent from ordinary/release builds.
#[cfg(feature = "fault-injection")]
pub fn point(name: &str) {
    if std::env::var("DOWNLOADER_FAILPOINT").as_deref() == Ok(name) {
        #[cfg(windows)]
        unsafe {
            #[link(name = "kernel32")]
            extern "system" {
                fn SetErrorMode(mode: u32) -> u32;
            }
            SetErrorMode(2 | 0x8000);
        }
        std::process::abort();
    }
}
#[cfg(not(feature = "fault-injection"))]
#[inline]
pub fn point(_name: &str) {}

#[cfg(feature = "fault-injection")]
pub fn force_copy() -> bool {
    std::env::var("DOWNLOADER_FORCE_COPY").as_deref() == Ok("1")
}
#[cfg(not(feature = "fault-injection"))]
pub fn force_copy() -> bool {
    false
}

pub fn io(_operation: &str) -> std::io::Result<()> {
    #[cfg(feature = "fault-injection")]
    if std::env::var("DOWNLOADER_IO_FAILURE").as_deref() == Ok(_operation) {
        return Err(std::io::Error::other(
            "Injected storage write/flush failure",
        ));
    }
    Ok(())
}
