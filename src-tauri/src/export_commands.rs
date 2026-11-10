//! Export command for the WIP 1.0.1 build.
//!
//! The frontend renders the song offline and sends interleaved f32 PCM; this
//! module encodes it (WAV/FLAC natively, MP3/OGG/M4A through ffmpeg) on a
//! blocking thread so the webview never freezes.

use std::io::Write;
use std::path::PathBuf;
use std::process::Command;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use openbeats_audio::export::{self, ExportFormat};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

fn decode_pcm(encoded: &str) -> Result<Vec<f32>, String> {
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|e| format!("the rendered audio was not valid base64: {e}"))?;
    if bytes.len() % 4 != 0 {
        return Err("the rendered audio was truncated".into());
    }
    Ok(bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect())
}

fn ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn encode_with_ffmpeg(
    format: ExportFormat,
    samples: &[f32],
    sample_rate: u32,
    channels: u16,
    quality: u8,
    target: &PathBuf,
) -> Result<(), String> {
    if !ffmpeg_available() {
        return Err(format!(
            "{} export needs ffmpeg on your PATH — install it, or export WAV/FLAC",
            format.label()
        ));
    }
    let temp = std::env::temp_dir().join(format!(
        "openbeats-export-{}-{}.wav",
        std::process::id(),
        samples.len()
    ));
    let wav = export::wav_bytes(samples, sample_rate, channels, 16);
    std::fs::write(&temp, wav).map_err(|e| format!("could not stage the render: {e}"))?;

    let mut command = Command::new("ffmpeg");
    command.args(["-y", "-hide_banner", "-loglevel", "error", "-i"]);
    command.arg(&temp);
    command.args(export::ffmpeg_args(format, quality));
    command.arg(target);
    let output = command
        .output()
        .map_err(|e| format!("could not run ffmpeg: {e}"))?;
    std::fs::remove_file(&temp).ok();
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "ffmpeg could not encode the file: {}",
            stderr.lines().next().unwrap_or("unknown error")
        ));
    }
    Ok(())
}

/// Encodes interleaved f32 PCM to `path`, or a save dialog when `path` is null.
///
/// `format` accepts wav, wav24, flac, mp3, ogg and m4a.
#[tauri::command]
pub async fn export_audio(
    app: AppHandle,
    format: String,
    quality: Option<u8>,
    sample_rate: u32,
    channels: u16,
    pcm_base64: String,
    path: Option<String>,
) -> Result<String, String> {
    let format = ExportFormat::parse(&format).ok_or_else(|| format!("unknown format {format}"))?;
    let quality = quality.unwrap_or(5);
    let target = match path {
        Some(path) if !path.trim().is_empty() => PathBuf::from(path),
        _ => {
            let suggested = format!("openbeats.{}", format.extension());
            let picked = app
                .dialog()
                .file()
                .set_file_name(&suggested)
                .add_filter(format.label(), &[format.extension()])
                .blocking_save_file()
                .ok_or_else(|| "the export was cancelled".to_string())?
                .into_path()
                .map_err(|e| format!("that path is not usable: {e}"))?;
            picked
        }
    };

    tauri::async_runtime::spawn_blocking(move || {
        let samples = decode_pcm(&pcm_base64)?;
        if samples.is_empty() {
            return Err("there is nothing to export".into());
        }
        if format.needs_ffmpeg() {
            encode_with_ffmpeg(format, &samples, sample_rate, channels, quality, &target)?;
        } else {
            let bytes = export::encode(format, &samples, sample_rate, channels, quality)?;
            let mut file = std::fs::File::create(&target)
                .map_err(|e| format!("could not create {}: {e}", target.display()))?;
            file.write_all(&bytes)
                .map_err(|e| format!("could not write the file: {e}"))?;
        }
        Ok::<String, String>(target.display().to_string())
    })
    .await
    .map_err(|e| format!("the export task failed: {e}"))?
}

/// Explicit save-dialog entry point used by the export window.
///
/// `export_audio` already prompts when `path` is null; this alias keeps the
/// frontend contract obvious and always shows the native dialog.
#[tauri::command]
pub async fn export_audio_with_dialog(
    app: AppHandle,
    format: String,
    quality: Option<u8>,
    sample_rate: u32,
    channels: u16,
    pcm_base64: String,
) -> Result<String, String> {
    export_audio(
        app,
        format,
        quality,
        sample_rate,
        channels,
        pcm_base64,
        None,
    )
    .await
}
