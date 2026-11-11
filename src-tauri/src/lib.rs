mod audio_commands;
mod export_commands;
mod plugin_commands;
mod recovery;
mod system_commands;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri_plugin_dialog::DialogExt;

/// OpenBeats' Discord application. Rich Presence uses this app ID for every
/// install, so users no longer have to create or paste their own.
const DISCORD_CLIENT_ID: &str = "1569568675198140446";

static DISCORD: Mutex<Option<DiscordIpcClient>> = Mutex::new(None);

#[tauri::command]
fn discord_presence(details: String, state: String) -> bool {
    let mut guard = match DISCORD.lock() {
        Ok(guard) => guard,
        Err(_) => return false,
    };
    if guard.is_none() {
        let mut client = DiscordIpcClient::new(DISCORD_CLIENT_ID).unwrap();
        if client.connect().is_err() {
            return false;
        }
        *guard = Some(client);
    }
    let payload = activity::Activity::new().details(&details).state(&state);
    guard
        .as_mut()
        .map(|client| client.set_activity(payload).is_ok())
        .unwrap_or(false)
}

#[tauri::command]
fn discord_clear() -> bool {
    if let Ok(mut guard) = DISCORD.lock() {
        if let Some(mut client) = guard.take() {
            let _ = client.close();
        }
    }
    true
}

#[derive(serde::Serialize)]
struct BinaryPayload {
    name: String,
    data: String,
}

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

/// Native save dialog for MIDI and other binary song files.
#[tauri::command]
async fn save_binary_file(
    app: tauri::AppHandle,
    data: String,
    suggested_name: String,
) -> Option<String> {
    let bytes = STANDARD.decode(data).ok()?;
    let picked = app
        .dialog()
        .file()
        .set_file_name(&suggested_name)
        .add_filter("Song file", &["mid", "midi", "rpp"])
        .blocking_save_file()?;
    let path = picked.into_path().ok()?;
    std::fs::write(&path, bytes).ok()?;
    Some(path.display().to_string())
}

/// Native open dialog for binary song files, returned as base64.
#[tauri::command]
async fn open_binary_file(app: tauri::AppHandle) -> Option<BinaryPayload> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Song file", &["mid", "midi", "smf", "rpp", "als"])
        .blocking_pick_file()?;
    let path = picked.into_path().ok()?;
    let bytes = std::fs::read(&path).ok()?;
    Some(BinaryPayload {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        data: STANDARD.encode(bytes),
    })
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
    let app_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.to_path_buf()));
    let helper = openbeats_plugins::PluginHost::helper_path(app_dir.as_deref());
    let plugin_cache = std::env::temp_dir().join("openbeats-plugin-scan.json");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(audio_commands::AudioState::default())
        .manage(recovery::RecoveryState::default())
        .manage(system_commands::SystemState::default())
        .manage(plugin_commands::PluginState::new(helper, plugin_cache))
        .manage(plugin_commands::ClapState::new())
        .invoke_handler(tauri::generate_handler![
            platform,
            open_external,
            reveal_path,
            save_text_file,
            open_text_file,
            save_binary_file,
            open_binary_file,
            discord_presence,
            discord_clear,
            // Native audio engine
            audio_commands::start_playback,
            audio_commands::stop_playback,
            audio_commands::playback_state,
            audio_commands::native_audio_devices,
            audio_commands::play_test_tone,
            audio_commands::play_test_note,
            audio_commands::play_metronome,
            audio_commands::set_playhead_position,
            audio_commands::recover_audio_log,
            audio_commands::detect_chord,
            audio_commands::parse_native_command,
            audio_commands::pitch_names,
            audio_commands::chord_suggestions,
            audio_commands::normalise_clip_gains,
            audio_commands::stamp_chord,
            audio_commands::key_labels,
            // Mixer routing, automation and editing tools
            audio_commands::mixer_order,
            audio_commands::mixer_render,
            audio_commands::automation_value,
            audio_commands::automation_sample,
            audio_commands::automation_apply,
            audio_commands::strum_notes,
            audio_commands::arpeggiate_notes,
            audio_commands::flam_notes,
            audio_commands::scale_notes,
            audio_commands::snap_note_to_scale,
            audio_commands::slice_clip,
            audio_commands::chop_clip,
            audio_commands::quantize_clip_start,
            audio_commands::effect_graph_order,
            audio_commands::render_effect_graph,
            // Device selection, low latency and cue routing
            audio_commands::get_audio_devices,
            audio_commands::select_audio_device,
            audio_commands::set_low_latency,
            audio_commands::set_cue_gain,
            audio_commands::audio_engine_info,
            // Smart workflow and composition
            audio_commands::humanize_notes,
            audio_commands::auto_gain_gains,
            audio_commands::project_health,
            audio_commands::generate_melody,
            audio_commands::tap_tempo_from_taps,
            audio_commands::arp_pattern,
            audio_commands::spectrum_bands,
            audio_commands::parse_theme,
            // Session recovery
            recovery::start_session_recovery,
            recovery::recovery_update,
            recovery::recovery_flush,
            recovery::read_recovery,
            recovery::clear_recovery,
            // Splash, export, suggestions and updates
            system_commands::close_splash,
            system_commands::submit_suggestion,
            system_commands::check_for_updates,
            system_commands::perform_update,
            export_commands::export_audio,
            export_commands::export_audio_with_dialog,
            audio_commands::play_chime,
            // Sample preview and packs
            system_commands::preview_sample,
            system_commands::stop_preview,
            system_commands::import_pack,
            system_commands::get_packs,
            system_commands::remove_pack,
            system_commands::read_sample,
            // Input monitoring, recording and the tuner
            system_commands::start_input,
            system_commands::set_input_monitor,
            system_commands::start_input_recording,
            system_commands::stop_input_recording,
            system_commands::input_status,
            system_commands::stop_input,
            // Plugin hosting
            plugin_commands::scan_plugins,
            plugin_commands::load_plugin_chain,
            plugin_commands::unload_plugin_chain,
            plugin_commands::recover_plugin_chain,
            plugin_commands::plugin_host_support,
            plugin_commands::scan_plugins_linux,
            plugin_commands::load_plugin_linux
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running OpenBeats");
}
