//! System commands for the 1.0.1 work-in-progress build.
//!
//! Everything that touches the network (suggestions, update checks), the file
//! system (pack import, export) or an extra audio stream lives here so the
//! audio engine module stays focused on playback.

use std::io::Write;
use std::panic::AssertUnwindSafe;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use openbeats_audio::decode;
use openbeats_audio::export;
use openbeats_audio::io::{InputCapture, PreviewEngine};
use openbeats_audio::packs::{self, Pack, PackImport};
use openbeats_audio::suggestion;
use openbeats_audio::update;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const RELEASES_PAGE: &str = "https://github.com/blsphmicwillow/OpenBeats/releases";
const LATEST_RELEASE_API: &str =
    "https://api.github.com/repos/blsphmicwillow/OpenBeats/releases/latest";

/// Holds the preview stream and the input stream.
#[derive(Default)]
pub struct SystemState {
    preview: Mutex<Option<PreviewEngine>>,
    input: Mutex<Option<InputCapture>>,
}

#[derive(Serialize)]
pub struct InputReading {
    pub device: String,
    pub rms: f32,
    pub peak: f32,
    pub recording: bool,
    pub tuning: Option<openbeats_audio::Tuning>,
}

#[derive(Serialize)]
pub struct RecordingResult {
    pub path: String,
    pub seconds: f32,
    pub sample_rate: u32,
}

#[derive(Serialize)]
pub struct UpdateCheck {
    pub current: String,
    pub latest: Option<update::UpdateInfo>,
    pub releases_url: String,
}

/* ------------------------------------------------------------------ *
 * Splash window
 * ------------------------------------------------------------------ */

/// Closes the native splash window once the main UI has mounted.
#[tauri::command]
pub fn close_splash(app: AppHandle) -> bool {
    if let Some(window) = app.get_webview_window("splash") {
        let _ = window.close();
        true
    } else {
        false
    }
}

/* ------------------------------------------------------------------ *
 * Suggestions webhook
 * ------------------------------------------------------------------ */

/// Posts a suggestion to the Discord webhook, off the UI thread.
#[tauri::command]
pub async fn submit_suggestion(message: String) -> Result<(), String> {
    let payload = suggestion::payload(&message, std::env::consts::OS, APP_VERSION)?;
    tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent("OpenBeats")
            .build()
            .map_err(|e| format!("could not start the request: {e}"))?;
        let response = client
            .post(suggestion::WEBHOOK_URL)
            .json(&payload)
            .send()
            .map_err(|e| format!("could not reach Discord: {e}"))?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(format!("Discord answered {}", response.status()))
        }
    })
    .await
    .map_err(|e| format!("the suggestion task failed: {e}"))?
}

/* ------------------------------------------------------------------ *
 * Update checking
 * ------------------------------------------------------------------ */

/// Reads the latest GitHub release and reports whether it is newer.
#[tauri::command]
pub async fn check_for_updates() -> Result<UpdateCheck, String> {
    let text = tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent("OpenBeats")
            .build()
            .map_err(|e| format!("could not start the request: {e}"))?;
        client
            .get(LATEST_RELEASE_API)
            .header("Accept", "application/vnd.github+json")
            .send()
            .map_err(|e| format!("could not reach GitHub: {e}"))?
            .error_for_status()
            .map_err(|e| format!("GitHub answered: {e}"))?
            .text()
            .map_err(|e| format!("could not read the response: {e}"))
    })
    .await
    .map_err(|e| format!("the update task failed: {e}"))??;

    let arch = std::env::consts::ARCH;
    let latest = update::parse(&text, APP_VERSION, std::env::consts::OS, arch)?;
    Ok(UpdateCheck {
        current: APP_VERSION.to_string(),
        latest,
        releases_url: RELEASES_PAGE.to_string(),
    })
}

/* ------------------------------------------------------------------ *
 * Sample preview
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Update installation
 * ------------------------------------------------------------------ */

#[cfg(target_os = "linux")]
fn launch_installer(path: &PathBuf) -> Result<bool, String> {
    let is_appimage = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("appimage"))
        .unwrap_or(false);
    let mut command = if is_appimage {
        std::process::Command::new(path)
    } else {
        let mut opener = std::process::Command::new("xdg-open");
        opener.arg(path);
        opener
    };
    command
        .spawn()
        .map_err(|e| format!("could not launch the installer: {e}"))?;
    // Only the AppImage replaces the running binary; a package opens its
    // installer and the app stays up until the user relaunches it.
    Ok(is_appimage)
}

#[cfg(target_os = "macos")]
fn launch_installer(path: &PathBuf) -> Result<bool, String> {
    std::process::Command::new("open")
        .arg(path)
        .spawn()
        .map_err(|e| format!("could not open the disk image: {e}"))?;
    Ok(true)
}

#[cfg(target_os = "windows")]
fn launch_installer(path: &PathBuf) -> Result<bool, String> {
    std::process::Command::new(path)
        .spawn()
        .map_err(|e| format!("could not launch the installer: {e}"))?;
    Ok(true)
}

/// Downloads the release installer for `url`, launches it and restarts the app.
///
/// The URL must be an asset on this project's GitHub releases; anything else is
/// refused so a malformed update payload cannot run arbitrary files.
#[tauri::command]
pub async fn perform_update(app: AppHandle, url: String) -> Result<String, String> {
    let url = url.trim().to_string();
    let file_name = update::validate_installer_url(&url)?;

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("the app data folder is unavailable: {e}"))?
        .join("updates");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let target = dir.join(&file_name);
    let download_target = target.clone();
    let download_url = url.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(600))
            .user_agent("OpenBeats")
            .build()
            .map_err(|e| format!("could not start the download: {e}"))?;
        let response = client
            .get(&download_url)
            .send()
            .map_err(|e| format!("could not reach GitHub: {e}"))?
            .error_for_status()
            .map_err(|e| format!("GitHub answered: {e}"))?;
        let bytes = response
            .bytes()
            .map_err(|e| format!("could not read the installer: {e}"))?;
        if bytes.len() < 1_024 {
            return Err("the downloaded installer looks incomplete".to_string());
        }
        std::fs::write(&download_target, &bytes)
            .map_err(|e| format!("could not write {}: {e}", download_target.display()))?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("the update task failed: {e}"))??;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&target)
            .map(|meta| meta.permissions().mode())
            .unwrap_or(0);
        let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(mode | 0o111));
    }

    let restart = launch_installer(&target)?;
    if restart {
        let handle = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(900));
            handle.restart();
        });
        Ok("Installing the update — the app will restart.".into())
    } else {
        Ok(format!(
            "Downloaded {file_name} — finish the install in your package manager."
        ))
    }
}

/// Decodes a file and plays it on the preview stream, replacing any preview
/// already playing. The project engine is untouched.
#[tauri::command]
pub fn preview_sample(state: State<'_, SystemState>, path: String) -> Result<String, String> {
    let file = PathBuf::from(&path);
    let metadata =
        std::fs::metadata(&file).map_err(|e| format!("could not inspect the sample: {e}"))?;
    if metadata.len() > packs::MAX_SAMPLE_BYTES {
        return Err(format!(
            "that sample is larger than the {} MB limit",
            packs::MAX_SAMPLE_BYTES / 1024 / 1024
        ));
    }
    let decoded = decode::decode_file(&file)?;
    let mut guard = state
        .preview
        .lock()
        .map_err(|_| "the preview state is unavailable".to_string())?;
    if guard.is_none() {
        *guard = Some(PreviewEngine::start()?);
    }
    let preview = guard.as_ref().ok_or("the preview stream did not start")?;
    preview.play(decoded.samples, decoded.channels)?;
    preview.set_gain(0.9);
    Ok(format!(
        "{} · {:.2}s · {} Hz",
        PathBuf::from(&path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        decoded.seconds,
        decoded.sample_rate
    ))
}

#[tauri::command]
pub fn stop_preview(state: State<'_, SystemState>) -> bool {
    if let Ok(guard) = state.preview.lock() {
        if let Some(preview) = guard.as_ref() {
            preview.stop();
            return true;
        }
    }
    false
}

/* ------------------------------------------------------------------ *
 * Sample packs
 * ------------------------------------------------------------------ */

fn packs_index(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("the app data folder is unavailable: {e}"))?;
    let packs_dir = base.join("Packs");
    std::fs::create_dir_all(&packs_dir)
        .map_err(|e| format!("could not create {}: {e}", packs_dir.display()))?;
    let index = packs_dir.join("index.json");
    Ok((packs_dir, index))
}

fn read_index(index: &PathBuf) -> Vec<Pack> {
    std::fs::read_to_string(index)
        .ok()
        .and_then(|text| serde_json::from_str::<Vec<Pack>>(&text).ok())
        .unwrap_or_default()
}

fn write_index(index: &PathBuf, packs: &[Pack]) -> Result<(), String> {
    let text = serde_json::to_string_pretty(packs).map_err(|e| e.to_string())?;
    std::fs::write(index, text).map_err(|e| format!("could not write the pack index: {e}"))
}

fn safe_pack_name(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|ch| {
            if ch.is_alphanumeric() || matches!(ch, ' ' | '-' | '_' | '(' | ')') {
                ch
            } else {
                ' '
            }
        })
        .collect();
    let joined = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = joined.trim_matches(['.', ' ']);
    let mut name: String = if trimmed.is_empty() {
        "Imported pack".into()
    } else {
        trimmed.chars().take(64).collect()
    };
    if name.starts_with('.') {
        name.insert_str(0, "Pack ");
    }
    name
}

fn unique_pack_target(packs_dir: &Path, name: &str) -> PathBuf {
    let mut candidate = packs_dir.join(name);
    let mut suffix = 2;
    while candidate.exists() && suffix < 10_000 {
        candidate = packs_dir.join(format!("{name} ({suffix})"));
        suffix += 1;
    }
    candidate
}

fn single_child_dir(path: &Path) -> Option<PathBuf> {
    let children = std::fs::read_dir(path)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    if children.len() == 1 && children[0].is_dir() {
        Some(children[0].clone())
    } else {
        None
    }
}

struct RemoveDirOnDrop(Option<PathBuf>);

impl RemoveDirOnDrop {
    fn new(path: PathBuf) -> Self {
        Self(Some(path))
    }

    fn disarm(&mut self) {
        self.0 = None;
    }
}

impl Drop for RemoveDirOnDrop {
    fn drop(&mut self) {
        if let Some(path) = &self.0 {
            let _ = std::fs::remove_dir_all(path);
        }
    }
}

#[derive(Serialize, serde::Deserialize)]
struct ImportManifest {
    format: String,
    version: u32,
    #[serde(default)]
    files: Vec<String>,
}

fn collect_relative_files(
    root: &Path,
    dir: &Path,
    out: &mut Vec<String>,
    depth: usize,
) -> Result<(), String> {
    if depth > 16 {
        return Ok(());
    }
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("could not inventory {}: {e}", dir.display()))?;
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            collect_relative_files(root, &path, out, depth + 1)?;
        } else if file_type.is_file()
            && path.file_name().and_then(|name| name.to_str()) != Some(".openbeats-import.json")
        {
            out.push(
                path.strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
        }
    }
    Ok(())
}

fn write_import_manifest(root: &Path) -> Result<usize, String> {
    let mut files = Vec::new();
    collect_relative_files(root, root, &mut files, 0)?;
    files.sort();
    let manifest = ImportManifest {
        format: "openbeats-import".into(),
        version: 1,
        files: files.clone(),
    };
    let text = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    std::fs::write(root.join(".openbeats-import.json"), text)
        .map_err(|e| format!("could not record the imported files: {e}"))?;
    Ok(files.len())
}

fn add_pack_warning(scan: &mut packs::PackScan, message: String) {
    if !scan.report.warnings.contains(&message) {
        scan.report.warnings.push(message.clone());
    }
    if !scan.pack.warnings.contains(&message) {
        scan.pack.warnings.push(message.clone());
    }
    scan.report.log.push(message);
}

fn import_pack_blocking(
    app: &AppHandle,
    path: Option<String>,
    kind: Option<String>,
    max_bytes: Option<u64>,
) -> Result<Option<PackImport>, String> {
    let source = match path.filter(|value| !value.trim().is_empty()) {
        Some(value) => PathBuf::from(value),
        None => {
            let want_zip = kind.as_deref() == Some("zip");
            let picked = if want_zip {
                app.dialog()
                    .file()
                    .set_title("Choose a sample pack (.zip)")
                    .add_filter("Zip archives", &["zip"])
                    .blocking_pick_file()
            } else {
                app.dialog()
                    .file()
                    .set_title("Choose a sample pack folder")
                    .blocking_pick_folder()
            };
            match picked {
                Some(file) => file
                    .into_path()
                    .map_err(|e| format!("that path is not usable: {e}"))?,
                None => return Ok(None),
            }
        }
    };
    if !source.exists() {
        return Err(format!("{} does not exist", source.display()));
    }
    let source = std::fs::canonicalize(&source)
        .map_err(|e| format!("could not resolve {}: {e}", source.display()))?;
    let (packs_dir, index_path) = packs_index(app)?;
    let budget = max_bytes
        .unwrap_or(packs::DEFAULT_TOTAL_BYTES)
        .clamp(1024 * 1024, packs::HARD_TOTAL_BYTES);

    let mut final_guard: Option<RemoveDirOnDrop> = None;
    let (root, managed, archive_bytes, extraction) = if source.is_file() {
        let is_zip = source
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"));
        if !is_zip {
            return Err("choose a folder or a .zip sample pack".into());
        }
        let archive_bytes = std::fs::metadata(&source)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        let stem = source
            .file_stem()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "Pack".into());
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        let staging = packs_dir.join(format!(".import-{}-{stamp}", std::process::id()));
        std::fs::create_dir_all(&staging)
            .map_err(|e| format!("could not create the import staging folder: {e}"))?;
        let mut staging_guard = RemoveDirOnDrop::new(staging.clone());
        let extraction = packs::extract_zip_to(&source, &staging, budget)?;
        let extracted_root = single_child_dir(&staging).unwrap_or_else(|| staging.clone());
        let target = unique_pack_target(&packs_dir, &safe_pack_name(&stem));
        std::fs::rename(&extracted_root, &target).map_err(|e| {
            format!(
                "could not move the packed files into {}: {e}",
                target.display()
            )
        })?;
        let _ = std::fs::remove_dir_all(&staging);
        staging_guard.disarm();
        final_guard = Some(RemoveDirOnDrop::new(target.clone()));
        (target, true, archive_bytes, Some(extraction))
    } else {
        (source, false, 0, None)
    };

    let format = packs::detect_format(&root, managed);
    let mut scan = packs::scan_pack(&root, format, managed)?;
    if scan.pack.samples.is_empty() && scan.pack.presets.is_empty() {
        return Err("that pack contains no readable samples or presets".into());
    }
    if !managed {
        let total = scan
            .pack
            .samples
            .iter()
            .map(|sample| sample.bytes)
            .sum::<u64>();
        if total > budget {
            return Err(format!(
                "that folder is larger than the {} GB import limit",
                budget / 1024 / 1024 / 1024
            ));
        }
    }
    if let Some(extraction) = extraction {
        scan.report.archive_bytes = archive_bytes;
        scan.report.extracted_bytes = extraction.extracted_bytes;
        scan.report.skipped_count += extraction.skipped_count;
        scan.report.skipped.extend(extraction.skipped);
    }
    if managed {
        match write_import_manifest(&root) {
            Ok(count) => scan
                .report
                .log
                .push(format!("recorded {count} pack-owned files for uninstall")),
            Err(err) => add_pack_warning(
                &mut scan,
                format!("The pack was imported, but uninstall could not record it: {err}"),
            ),
        }
    }

    let mut stored = read_index(&index_path);
    stored.retain(|existing| existing.root != scan.pack.root);
    stored.push(scan.pack.clone());
    write_index(&index_path, &stored)?;
    if let Some(guard) = final_guard.as_mut() {
        guard.disarm();
    }
    Ok(Some(PackImport {
        pack: scan.pack,
        report: scan.report,
    }))
}

/// Imports a folder or zip on a worker thread, never on the UI thread. The
/// blocking file dialog is only shown from that worker.
#[tauri::command]
pub async fn import_pack(
    app: AppHandle,
    path: Option<String>,
    kind: Option<String>,
    max_bytes: Option<u64>,
) -> Result<Option<PackImport>, String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        match std::panic::catch_unwind(AssertUnwindSafe(|| {
            import_pack_blocking(&handle, path, kind, max_bytes)
        })) {
            Ok(result) => result,
            Err(_) => {
                Err("the pack importer hit an internal error; nothing was changed".to_string())
            }
        }
    })
    .await
    .map_err(|e| format!("the pack import task failed: {e}"))?
}

/// Packs imported on this machine.
#[tauri::command]
pub fn get_packs(app: AppHandle) -> Vec<Pack> {
    let Ok((_, index)) = packs_index(&app) else {
        return Vec::new();
    };
    read_index(&index)
}

#[derive(Serialize)]
pub struct RemovePackResult {
    pub deleted_files: usize,
    /// True when the source folder was outside OpenBeats' data directory and
    /// was deliberately left alone.
    pub left_source: bool,
}

fn safe_relative_path(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && path
            .components()
            .all(|component| matches!(component, std::path::Component::Normal(_)))
}

fn remove_empty_dirs(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && !path.is_symlink() {
            remove_empty_dirs(&path);
            if std::fs::read_dir(&path)
                .map(|mut entries| entries.next().is_none())
                .unwrap_or(false)
            {
                let _ = std::fs::remove_dir(&path);
            }
        }
    }
}

fn remove_pack_blocking(app: &AppHandle, root: String) -> Result<RemovePackResult, String> {
    let (packs_dir, index_path) = packs_index(app)?;
    let requested = PathBuf::from(&root);
    let canonical_root = std::fs::canonicalize(&requested).unwrap_or_else(|_| requested.clone());
    let canonical_packs = std::fs::canonicalize(&packs_dir).unwrap_or_else(|_| packs_dir.clone());
    let inside = canonical_root.starts_with(&canonical_packs);

    let mut stored = read_index(&index_path);
    stored.retain(|pack| {
        let path = Path::new(&pack.root);
        let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        pack.root != root && canonical != canonical_root
    });

    let mut deleted_files = 0usize;
    if inside && canonical_root.is_dir() {
        let manifest_path = canonical_root.join(".openbeats-import.json");
        let manifest = std::fs::read_to_string(&manifest_path)
            .ok()
            .and_then(|text| serde_json::from_str::<ImportManifest>(&text).ok())
            .filter(|manifest| manifest.format == "openbeats-import");
        if let Some(manifest) = manifest {
            for relative in manifest.files {
                let relative = Path::new(&relative);
                if !safe_relative_path(relative) {
                    continue;
                }
                let path = canonical_root.join(relative);
                if !path.starts_with(&canonical_root) {
                    continue;
                }
                let Ok(metadata) = std::fs::symlink_metadata(&path) else {
                    continue;
                };
                if metadata.file_type().is_file() && !metadata.file_type().is_symlink() {
                    if std::fs::remove_file(&path).is_ok() {
                        deleted_files += 1;
                    }
                }
            }
            let _ = std::fs::remove_file(&manifest_path);
            remove_empty_dirs(&canonical_root);
            if std::fs::read_dir(&canonical_root)
                .map(|mut entries| entries.next().is_none())
                .unwrap_or(false)
            {
                let _ = std::fs::remove_dir(&canonical_root);
            }
        }
    }

    write_index(&index_path, &stored)?;
    Ok(RemovePackResult {
        deleted_files,
        left_source: !inside || deleted_files == 0,
    })
}

/// Removes a pack from the library. Files are deleted only when the pack was
/// extracted by OpenBeats and is recorded in its own import manifest.
#[tauri::command]
pub async fn remove_pack(app: AppHandle, root: String) -> Result<RemovePackResult, String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        match std::panic::catch_unwind(AssertUnwindSafe(|| remove_pack_blocking(&handle, root))) {
            Ok(result) => result,
            Err(_) => Err("the pack uninstaller hit an internal error".to_string()),
        }
    })
    .await
    .map_err(|e| format!("the pack uninstall task failed: {e}"))?
}

/* ------------------------------------------------------------------ *
 * Input: monitor, recording and tuner
 * ------------------------------------------------------------------ */

#[tauri::command]
pub fn start_input(
    state: State<'_, SystemState>,
    device: Option<String>,
) -> Result<String, String> {
    let mut guard = state
        .input
        .lock()
        .map_err(|_| "the input state is unavailable".to_string())?;
    if let Some(existing) = guard.as_ref() {
        return Ok(existing.device_name().to_string());
    }
    let capture = InputCapture::start(device.as_deref())?;
    let name = capture.device_name().to_string();
    *guard = Some(capture);
    Ok(name)
}

#[tauri::command]
pub fn set_input_monitor(
    state: State<'_, SystemState>,
    enabled: bool,
    gain: Option<f32>,
) -> Result<(), String> {
    let mut guard = state
        .input
        .lock()
        .map_err(|_| "the input state is unavailable".to_string())?;
    if guard.is_none() {
        *guard = Some(InputCapture::start(None)?);
    }
    if let Some(capture) = guard.as_ref() {
        capture.set_monitor(enabled, gain.unwrap_or(0.7));
    }
    Ok(())
}

#[tauri::command]
pub fn start_input_recording(state: State<'_, SystemState>) -> Result<(), String> {
    let mut guard = state
        .input
        .lock()
        .map_err(|_| "the input state is unavailable".to_string())?;
    if guard.is_none() {
        *guard = Some(InputCapture::start(None)?);
    }
    if let Some(capture) = guard.as_ref() {
        capture.start_recording();
    }
    Ok(())
}

/// Stops a take and writes it to `path` (or a save dialog when null).
#[tauri::command]
pub fn stop_input_recording(
    app: AppHandle,
    state: State<'_, SystemState>,
    path: Option<String>,
) -> Result<RecordingResult, String> {
    let guard = state
        .input
        .lock()
        .map_err(|_| "the input state is unavailable".to_string())?;
    let Some(capture) = guard.as_ref() else {
        return Err("the input stream is not open".into());
    };
    let (samples, rate, channels) = capture.stop_recording();
    if samples.is_empty() {
        return Err("nothing was captured".into());
    }
    let target = match path {
        Some(path) => PathBuf::from(path),
        None => {
            let picked = app
                .dialog()
                .file()
                .set_file_name("take.wav")
                .add_filter("WAV audio", &["wav"])
                .blocking_save_file()
                .ok_or_else(|| "the save dialog was cancelled".to_string())?
                .into_path()
                .map_err(|e| format!("that path is not usable: {e}"))?;
            picked
        }
    };
    let bytes = export::wav_bytes(&samples, rate, channels, 16);
    std::fs::write(&target, bytes).map_err(|e| format!("could not write the take: {e}"))?;
    Ok(RecordingResult {
        path: target.display().to_string(),
        seconds: samples.len() as f32 / rate.max(1) as f32,
        sample_rate: rate,
    })
}

/// Live input levels plus the detected pitch for the tuner.
#[tauri::command]
pub fn input_status(state: State<'_, SystemState>) -> Result<InputReading, String> {
    let guard = state
        .input
        .lock()
        .map_err(|_| "the input state is unavailable".to_string())?;
    let Some(capture) = guard.as_ref() else {
        return Ok(InputReading {
            device: String::new(),
            rms: 0.0,
            peak: 0.0,
            recording: false,
            tuning: None,
        });
    };
    let (rms, peak) = capture.levels();
    Ok(InputReading {
        device: capture.device_name().to_string(),
        rms,
        peak,
        recording: capture.is_recording(),
        tuning: capture.tuning(),
    })
}

#[tauri::command]
pub fn stop_input(state: State<'_, SystemState>) -> bool {
    if let Ok(mut guard) = state.input.lock() {
        guard.take();
        return true;
    }
    false
}

/// Reads a sample into the webview so a pack sample can become a channel.
#[derive(Serialize)]
pub struct SamplePayload {
    pub name: String,
    pub data: String,
}

#[tauri::command]
pub fn read_sample(path: String) -> Result<SamplePayload, String> {
    let file = PathBuf::from(&path);
    let metadata =
        std::fs::metadata(&file).map_err(|e| format!("could not inspect the sample: {e}"))?;
    if metadata.len() > packs::MAX_SAMPLE_BYTES {
        return Err(format!(
            "that sample is larger than the {} MB limit",
            packs::MAX_SAMPLE_BYTES / 1024 / 1024
        ));
    }
    let bytes = std::fs::read(&file).map_err(|e| format!("could not read the sample: {e}"))?;
    Ok(SamplePayload {
        name: file
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "sample".into()),
        data: STANDARD.encode(bytes),
    })
}
