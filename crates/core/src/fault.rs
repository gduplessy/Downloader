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

// Unique-job deterministic barriers are compiled only into unit-test binaries.
#[cfg(test)]
pub(crate) struct TestPause {
    pub reached: std::sync::Barrier,
    pub resume: std::sync::Barrier,
}
#[cfg(test)]
type PauseRegistry = std::collections::HashMap<(String, String), std::sync::Arc<TestPause>>;
#[cfg(test)]
fn pauses() -> &'static std::sync::Mutex<PauseRegistry> {
    static PAUSES: std::sync::OnceLock<std::sync::Mutex<PauseRegistry>> =
        std::sync::OnceLock::new();
    PAUSES.get_or_init(Default::default)
}
#[cfg(test)]
pub(crate) fn install_test_pause(name: &str, id: &str) -> std::sync::Arc<TestPause> {
    let pause = std::sync::Arc::new(TestPause {
        reached: std::sync::Barrier::new(2),
        resume: std::sync::Barrier::new(2),
    });
    pauses()
        .lock()
        .unwrap()
        .insert((name.into(), id.into()), pause.clone());
    pause
}
#[cfg(test)]
pub(crate) fn pause_for_test(name: &str, id: &str) {
    let pause = pauses().lock().unwrap().remove(&(name.into(), id.into()));
    if let Some(pause) = pause {
        pause.reached.wait();
        pause.resume.wait();
    }
}
