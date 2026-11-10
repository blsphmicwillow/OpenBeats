//! System commands for the 1.0.1 work-in-progress build.
//!
//! Everything that touches the network (suggestions, update checks), the file
//! system (pack import, export) or an extra audio stream lives here so the
//! audio engine module stays focused on playback.

use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use openbeats_audio::decode;
use openbeats_audio::export;
use openbeats_audio::io::{InputCapture, PreviewEngine};
use openbeats_audio::packs::{self, Pack};
use openbeats_audio::suggestion;
use openbeats_audio::update;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const RELEASES_PAGE: &str = "https://github.com/blsphmicwillow/OpenBeats/releases";
const LATEST_RELEASE_API: &str =
    "https://api.github.com/repos/blsphmicwillow/OpenBeats/releases/latest";

/// Holds the preview stream, the input stream and the imported pack index.
#[derive(Default)]
pub struct SystemState {
    preview: Mutex<Option<PreviewEngine>>,
    input: Mutex<Option<InputCapture>>,
    packs: Mutex<Vec<Pack>>,
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
    let decoded = decode::decode_file(&PathBuf::from(&path))?;
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

/// Imports a folder, or extracts a .zip into the Packs folder and indexes it.
#[tauri::command]
pub fn import_pack(
    app: AppHandle,
    state: State<'_, SystemState>,
    path: Option<String>,
) -> Result<Pack, String> {
    let source = match path.filter(|value| !value.trim().is_empty()) {
        Some(value) => PathBuf::from(value),
        None => app
            .dialog()
            .file()
            .set_title("Choose a sample pack folder")
            .blocking_pick_folder()
            .ok_or_else(|| "the pack picker was cancelled".to_string())?
            .into_path()
            .map_err(|e| format!("that path is not usable: {e}"))?,
    };
    if !source.exists() {
        return Err(format!("{} does not exist", source.display()));
    }
    let (packs_dir, index_path) = packs_index(&app)?;

    let root = if source.is_file() {
        if source
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("zip"))
            .unwrap_or(false)
        {
            let name = source
                .file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or("pack")
                .to_string();
            let target = packs_dir.join(&name);
            std::fs::create_dir_all(&target)
                .map_err(|e| format!("could not create {}: {e}", target.display()))?;
            let file =
                std::fs::File::open(&source).map_err(|e| format!("could not open the zip: {e}"))?;
            let mut archive =
                zip::ZipArchive::new(file).map_err(|e| format!("not a readable zip: {e}"))?;
            archive
                .extract(&target)
                .map_err(|e| format!("could not extract the pack: {e}"))?;
            // Packs often wrap everything in one top folder; use it as the root.
            let mut children = std::fs::read_dir(&target)
                .map_err(|e| format!("could not read {}: {e}", target.display()))?
                .flatten()
                .map(|entry| entry.path())
                .collect::<Vec<_>>();
            let nested = children.len() == 1 && children[0].is_dir();
            children.clear();
            if nested {
                target.join(
                    std::fs::read_dir(&target)
                        .map_err(|e| e.to_string())?
                        .flatten()
                        .next()
                        .map(|e| e.file_name())
                        .unwrap_or_default(),
                )
            } else {
                target
            }
        } else {
            return Err("pick a folder or a .zip sample pack".into());
        }
    } else {
        source.clone()
    };

    let pack = packs::scan(&root)?;
    if pack.samples.is_empty() {
        return Err("that pack contains no wav, mp3, ogg or flac files".into());
    }
    let mut stored = read_index(&index_path);
    stored.retain(|existing| existing.root != pack.root);
    stored.push(pack.clone());
    write_index(&index_path, &stored)?;
    if let Ok(mut cache) = state.packs.lock() {
        *cache = stored;
    }
    Ok(pack)
}

/// Packs imported on this machine.
#[tauri::command]
pub fn get_packs(app: AppHandle) -> Vec<Pack> {
    let Ok((_, index)) = packs_index(&app) else {
        return Vec::new();
    };
    read_index(&index)
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
    let bytes = std::fs::read(&file).map_err(|e| format!("could not read the sample: {e}"))?;
    Ok(SamplePayload {
        name: file
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "sample".into()),
        data: STANDARD.encode(bytes),
    })
}
