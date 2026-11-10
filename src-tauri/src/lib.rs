use std::path::PathBuf;
use std::process::Command;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
fn platform() -> &'static str {
    std::env::consts::OS
}

fn safe_url(url: &str) -> bool {
    url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:")
}

/// Opens a link in the user's default browser instead of inside the app webview.
#[tauri::command]
fn open_external(url: String) -> bool {
    if !safe_url(&url) {
        return false;
    }
    #[cfg(target_os = "windows")]
    let result = Command::new("cmd").args(["/C", "start", "", &url]).spawn();
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(&url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(&url).spawn();
    result.is_ok()
}

/// Shows a file in Finder / Explorer / the Linux file manager.
#[tauri::command]
fn reveal_path(path: String) -> bool {
    let p = PathBuf::from(&path);
    let target = if p.is_dir() {
        p
    } else {
        p.parent().map(|x| x.to_path_buf()).unwrap_or(p)
    };
    #[cfg(target_os = "windows")]
    let result = Command::new("explorer").arg(target).spawn();
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg("-R").arg(target).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(target).spawn();
    result.is_ok()
}

/// Native “Save project” dialog. Returns the chosen path, or null when cancelled.
#[tauri::command]
async fn save_text_file(
    app: tauri::AppHandle,
    contents: String,
    suggested_name: String,
) -> Option<String> {
    let picked = app
        .dialog()
        .file()
        .set_file_name(&suggested_name)
        .add_filter("OpenBeats project", &["obeats"])
        .blocking_save_file()?;
    let path = picked.into_path().ok()?;
    std::fs::write(&path, contents).ok()?;
    Some(path.display().to_string())
}

/// Native “Open project” dialog. Returns the file contents, or null.
#[tauri::command]
async fn open_text_file(app: tauri::AppHandle) -> Option<String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("OpenBeats project", &["obeats", "json"])
        .blocking_pick_file()?;
    let path = picked.into_path().ok()?;
    std::fs::read_to_string(&path).ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            platform,
            open_external,
            reveal_path,
            save_text_file,
            open_text_file
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running OpenBeats");
}
