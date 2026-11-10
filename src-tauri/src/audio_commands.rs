//! Tauri commands for the native audio engine.
//!
//! The React frontend sends a compact JSON playback snapshot; Rust owns the
//! transport, the synth voices, the master chain and the recovery buffer.

use std::sync::Mutex;

use openbeats_audio::automation::{AutomationLane, AutomationSet};
use openbeats_audio::chord::{chord_for, chord_stamp, suggest_progression, Chord};
use openbeats_audio::command::{parse_command, ParsedCommand};
use openbeats_audio::effect_graph::ModularGraph;
use openbeats_audio::engine::{EngineSnapshot, NativeEngine};
use openbeats_audio::mixer::{MixError, MixerGraph, MixerStrip};
use openbeats_audio::notes::{normalize_gains, note_name, KeyLabels};
use openbeats_audio::piano_tools::{
    arpeggiate, flam, scale_pitches, snap_to_scale, strum, ArpMode, Scale, StrumOptions, ToolNote,
};
use openbeats_audio::playlist_tools::{
    chop as chop_span, quantize_start, slice as slice_span, ClipSpan,
};
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

/// Chord Stamp: notes for a chord, ready to insert into a pattern.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn stamp_chord(
    root: u8,
    quality: String,
    inversion: u8,
    octave: u8,
    start: f32,
    len: f32,
    vel: f32,
) -> Vec<ToolNote> {
    chord_stamp(root, &quality, inversion, octave, start, len, vel)
}

/// Piano-roll key labels: custom names with scientific defaults filled in.
#[tauri::command]
pub fn key_labels(labels: KeyLabels, pitches: Vec<u8>) -> Vec<(u8, String)> {
    labels.labelled(&pitches)
}

/// Gain multipliers that normalise clip peaks individually or as a selection.
#[tauri::command]
pub fn normalise_clip_gains(peaks: Vec<f32>, as_group: bool) -> Vec<f32> {
    normalize_gains(&peaks, as_group)
}

/// The mixed output for every strip plus the master.
#[derive(Serialize)]
pub struct MixerRender {
    pub outputs: Vec<[f32; 2]>,
    pub master: [f32; 2],
}

/// Resolves mixer routing to a mixing order, rejecting cycles.
#[tauri::command]
pub fn mixer_order(strips: Vec<MixerStrip>) -> Result<Vec<usize>, String> {
    MixerGraph::new(strips)
        .order()
        .map_err(|err: MixError| err.to_string())
}

/// Mixes one frame per strip, honouring sends, mute, solo and routing.
#[tauri::command]
pub fn mixer_render(strips: Vec<MixerStrip>, inputs: Vec<[f32; 2]>) -> Result<MixerRender, String> {
    let graph = MixerGraph::new(strips);
    let frames: Vec<(f32, f32)> = inputs.iter().map(|frame| (frame[0], frame[1])).collect();
    let (outputs, master) = graph.render(&frames).map_err(|err| err.to_string())?;
    Ok(MixerRender {
        outputs: outputs.iter().map(|(l, r)| [*l, *r]).collect(),
        master: [master.0, master.1],
    })
}

/// Reads an automation lane at a position in 16th steps.
#[tauri::command]
pub fn automation_value(lane: AutomationLane, time: f32) -> f32 {
    lane.value_at(time)
}

/// Samples an automation lane once per step.
#[tauri::command]
pub fn automation_sample(lane: AutomationLane, steps: u32) -> Vec<f32> {
    lane.sample_steps(steps)
}

/// Every automated parameter's value at `time`, keyed by target name.
#[tauri::command]
pub fn automation_apply(set: AutomationSet, time: f32) -> std::collections::BTreeMap<String, f32> {
    let mut values = std::collections::BTreeMap::new();
    set.apply(time, &mut values);
    values
}

/// Piano-roll Strum tool.
#[tauri::command]
pub fn strum_notes(notes: Vec<ToolNote>, start: f32, tension: f32, velocity: f32) -> Vec<ToolNote> {
    strum(
        &notes,
        StrumOptions {
            start,
            tension,
            velocity,
        },
    )
}

/// Piano-roll Arpeggiator tool.
#[tauri::command]
pub fn arpeggiate_notes(
    notes: Vec<ToolNote>,
    mode: ArpMode,
    rate: f32,
    octaves: u8,
) -> Vec<ToolNote> {
    arpeggiate(&notes, mode, rate, octaves)
}

/// Piano-roll Flam tool.
#[tauri::command]
pub fn flam_notes(
    notes: Vec<ToolNote>,
    offset: f32,
    repeats: u8,
    velocity_decay: f32,
) -> Vec<ToolNote> {
    flam(&notes, offset, repeats, velocity_decay)
}

/// Pitches of a scale, for piano-roll highlighting.
#[tauri::command]
pub fn scale_notes(root: u8, scale: Scale, octaves: u8) -> Vec<u8> {
    scale_pitches(root, scale, octaves)
}

/// Snaps a pitch into the given scale.
#[tauri::command]
pub fn snap_note_to_scale(pitch: u8, root: u8, scale: Scale) -> u8 {
    snap_to_scale(pitch, root, scale)
}

/// Splits a playlist clip in two at `at` steps.
#[tauri::command]
pub fn slice_clip(start: f32, len: f32, at: f32) -> Option<(ClipSpan, ClipSpan)> {
    slice_span(ClipSpan::new(start, len), at)
}

/// Chops a playlist clip into `pieces` equal parts.
#[tauri::command]
pub fn chop_clip(start: f32, len: f32, pieces: u32) -> Vec<ClipSpan> {
    chop_span(ClipSpan::new(start, len), pieces)
}

/// Quantizes a clip start to the nearest grid line.
#[tauri::command]
pub fn quantize_clip_start(start: f32, grid: f32) -> f32 {
    quantize_start(start, grid)
}

/// Evaluation order of a modular effect graph, rejecting cycles.
#[tauri::command]
pub fn effect_graph_order(graph: ModularGraph) -> Result<Vec<usize>, String> {
    graph.order().map_err(|err| err.to_string())
}

/// Renders samples through a modular effect graph.
#[tauri::command]
pub fn render_effect_graph(
    mut graph: ModularGraph,
    input: Vec<f32>,
    sample_rate: f32,
) -> Result<Vec<f32>, String> {
    let mut out = Vec::with_capacity(input.len());
    for sample in input {
        out.push(
            graph
                .process(sample, sample_rate)
                .map_err(|e| e.to_string())?,
        );
    }
    Ok(out)
}
