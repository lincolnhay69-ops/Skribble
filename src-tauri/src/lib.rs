use tauri::{
    Emitter,
    Listener,
    Manager,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
};
use tauri_plugin_notification::NotificationExt;

#[tauri::command]
async fn notify(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}

#[tauri::command]
async fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
async fn show_window(app: tauri::AppHandle) -> Result<(), String> {
    focus_window(&app);
    Ok(())
}

#[tauri::command]
async fn download_installer(url: String) -> Result<String, String> {
    let response = reqwest::blocking::get(&url).map_err(|e| format!("Download failed: {}", e))?;
    let bytes = response.bytes().map_err(|e| format!("Read failed: {}", e))?;

    let temp_dir = std::env::temp_dir();
    let file_name = url.rsplit('/').next().unwrap_or("Scribble_setup.exe");
    let file_path = temp_dir.join(file_name);

    std::fs::write(&file_path, &bytes).map_err(|e| format!("Write failed: {}", e))?;

    open::that(&file_path).map_err(|e| format!("Launch failed: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

fn focus_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_skip_taskbar(false);
        let _ = window.set_focus();
    }
}

fn register_startup() {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(run) = hkcu.open_subkey_with_flags(
        r"Software\Microsoft\Windows\CurrentVersion\Run",
        winreg::enums::KEY_SET_VALUE,
    ) {
        if let Ok(exe) = std::env::current_exe() {
            let path = exe.to_string_lossy().to_string() + " --tray";
            let _ = run.set_value("Scribble", &path);
        }
    }
}

fn hide_to_tray(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_skip_taskbar(true);
        let _ = window.minimize();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Check if launched with --tray flag (from startup registry)
    let tray_start = std::env::args().any(|a| a == "--tray");

    // Register startup entry on first run (idempotent)
    register_startup();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_window(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .setup(move |app| {
            // On tray startup, immediately hide window
            if tray_start {
                hide_to_tray(app.handle());
            }

            // Listen for notification clicks in Rust as a fallback
            let handle = app.handle().clone();
            app.listen("notification", move |_event| {
                focus_window(&handle);
            });

            let open_item = MenuItemBuilder::with_id("open", "Show Scribble").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&open_item)
                .item(&quit_item)
                .build()?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => {
                        focus_window(app);
                    }
                    "quit" => {
                        let _ = app.emit("before-quit", ());
                    }
                    _ => {}
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_clone.set_skip_taskbar(true);
                        let _ = window_clone.minimize();
                    }
                });
            }

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![notify, open_url, quit_app, show_window, download_installer])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
