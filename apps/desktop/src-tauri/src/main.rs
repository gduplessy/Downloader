#![cfg_attr(windows, windows_subsystem = "windows")]
use downloader_core::{Command, Snapshot};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};
#[tauri::command]
async fn request(command: serde_json::Value) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let command: Command = serde_json::from_value(command).map_err(|e| e.to_string())?;
        downloader_service::ensure_service().map_err(|e| e.to_string())?;
        downloader_service::call(command).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn register_extension(chrome_id: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        downloader_service::register(
            downloader_service::Registration {
                chrome_ids: vec![chrome_id],
                firefox_ids: vec!["downloader@opensource.local".into()],
            },
            None,
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn file_action(app: tauri::AppHandle, id: String, reveal: bool) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let snapshot: Snapshot = serde_json::from_value(
        downloader_service::call(Command::Snapshot).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let job = snapshot
        .jobs
        .iter()
        .find(|j| j.id == id)
        .ok_or("Unknown download")?;
    if reveal {
        app.opener()
            .reveal_item_in_dir(&job.destination)
            .map_err(|e| e.to_string())
    } else {
        if job.state != downloader_core::JobState::Complete {
            return Err("File is not complete".into());
        }
        app.opener()
            .open_path(job.destination.to_string_lossy(), None::<&str>)
            .map_err(|e| e.to_string())
    }
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            request,
            file_action,
            register_extension
        ])
        .setup(|app| {
            let _ = downloader_service::ensure_service();
            let show = MenuItem::with_id(app, "show", "Downloader", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Downloader")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        let _ = downloader_service::call(Command::Quit);
                        app.exit(0);
                    }
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("Could not run Downloader");
}
