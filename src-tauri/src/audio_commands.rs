//! Tauri commands for the native audio engine.
//!
//! The React frontend sends a compact JSON playback snapshot; Rust owns the
//! transport, the synth voices, the master chain and the recovery buffer.

use std::sync::Mutex;

use openbeats_audio::chord::{chord_for, suggest_progression, Chord};
use openbeats_audio::command::{parse_command, ParsedCommand};
use openbeats_audio::engine::{EngineSnapshot, NativeEngine};
use openbeats_audio::notes::{normalize_gains, note_name};
use openbeats_audio::sequencer::PlaybackProject;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

/// Holds the engine; the stream lives on its own thread inside it.
#[derive(Default)]
pub struct AudioState {
    engine: Mutex<Option<NativeEngine>>,
}

#[derive(Serialize)]
pub struct PlaybackStatus {
    pub playing: bool,
    pub sample_rate: f32,
    pub device: String,
    pub voices_ready: bool,
}

#[derive(Serialize)]
pub struct RecoveredLog {
    pub path: String,
    pub frames: usize,
    pub seconds: f32,
    pub sample_rate: f32,
}

fn stopped_snapshot() -> EngineSnapshot {
    EngineSnapshot {
        playing: false,
        step: 0,
        meter_left: 0.0,
        meter_right: 0.0,
        voices: 0,
        transient: 0.0,
        stream_errors: 0,
        sample_rate: 0.0,
        device: String::new(),
    }
}

/// Starts (or reuses) the CPAL stream and plays the supplied sequencer data.
#[tauri::command]
pub fn start_playback(
    state: State<'_, AudioState>,
    project_data: String,
) -> Result<PlaybackStatus, String> {
    let project = PlaybackProject::from_json(&project_data)?;
    let mut guard = state
        .engine
        .lock()
        .map_err(|_| "the audio state is unavailable".to_string())?;

    if guard.is_none() {
        match NativeEngine::start() {
            Ok(engine) => *guard = Some(engine),
            Err(err) => return Err(err),
        }
    }

    let engine = guard.as_ref().ok_or("the audio engine did not start")?;
    engine.play(project)?;
    Ok(PlaybackStatus {
        playing: true,
        sample_rate: engine.sample_rate(),
        device: engine.device_name().to_string(),
        voices_ready: true,
    })
}

#[tauri::command]
pub fn stop_playback(state: State<'_, AudioState>) -> Result<(), String> {
    let guard = state
        .engine
        .lock()
        .map_err(|_| "the audio state is unavailable".to_string())?;
    if let Some(engine) = guard.as_ref() {
        engine.stop();
    }
    Ok(())
}

#[tauri::command]
pub fn playback_state(state: State<'_, AudioState>) -> Result<EngineSnapshot, String> {
    let guard = state
        .engine
        .lock()
        .map_err(|_| "the audio state is unavailable".to_string())?;
    Ok(guard
        .as_ref()
        .map(|engine| engine.snapshot())
        .unwrap_or_else(stopped_snapshot))
}

#[tauri::command]
pub fn native_audio_devices() -> Vec<String> {
    NativeEngine::devices()
}

/// Plays a short 440 Hz tone so "is my device working?" has an answer.
#[tauri::command]
pub fn play_test_tone(state: State<'_, AudioState>) -> Result<(), String> {
    let mut guard = state
        .engine
        .lock()
        .map_err(|_| "the audio state is unavailable".to_string())?;
    if guard.is_none() {
        *guard = Some(NativeEngine::start()?);
    }
    if let Some(engine) = guard.as_ref() {
        engine.test_tone(1.5);
    }
    Ok(())
}

/// Writes the last `seconds` of master output to a WAV file for recovery.
#[tauri::command]
pub fn recover_audio_log(
    app: AppHandle,
    state: State<'_, AudioState>,
    seconds: f32,
) -> Result<Option<RecoveredLog>, String> {
    let guard = state
        .engine
        .lock()
        .map_err(|_| "the audio state is unavailable".to_string())?;
    let Some(engine) = guard.as_ref() else {
        return Ok(None);
    };
    let logger = engine.logger();
    let log = logger
        .lock()
        .map_err(|_| "the audio logger is unavailable".to_string())?;
    if log.available_frames() == 0 {
        return Ok(None);
    }

    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {dir:?}: {e}"))?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let path = dir.join(format!("recovered-{stamp}.wav"));
    let frames = log
        .write_wav(seconds, &path)
        .map_err(|e| format!("could not write the recovered audio: {e}"))?;
    if frames == 0 {
        return Ok(None);
    }
    Ok(Some(RecoveredLog {
        path: path.display().to_string(),
        frames,
        seconds: frames as f32 / log.sample_rate(),
        sample_rate: log.sample_rate(),
    }))
}

/// Chord name for the pitches under the piano-roll cursor.
#[tauri::command]
pub fn detect_chord(pitches: Vec<u8>) -> Option<Chord> {
    chord_for(&pitches)
}

/// Local natural-language command parsing; no network involved.
#[tauri::command]
pub fn parse_native_command(text: String) -> Option<ParsedCommand> {
    parse_command(&text)
}

/// A piano-roll note name, e.g. 60 → "C4".
#[derive(Serialize)]
pub struct NamedNote {
    pub pitch: u8,
    pub name: String,
}

/// Names for a set of pitches, for the piano-roll key labels.
#[tauri::command]
pub fn pitch_names(pitches: Vec<u8>) -> Vec<NamedNote> {
    pitches
        .into_iter()
        .map(|pitch| NamedNote {
            pitch,
            name: note_name(pitch),
        })
        .collect()
}

/// Diatonic chords of a key, the local equivalent of the chord panel suggestions.
#[tauri::command]
pub fn chord_suggestions(root: u8, minor: bool) -> Vec<String> {
    suggest_progression(root, minor)
}

/// Gain multipliers that normalise clip peaks individually or as a selection.
#[tauri::command]
pub fn normalise_clip_gains(peaks: Vec<f32>, as_group: bool) -> Vec<f32> {
    normalize_gains(&peaks, as_group)
}
