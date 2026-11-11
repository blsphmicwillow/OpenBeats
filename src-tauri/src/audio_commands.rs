//! Tauri commands for the native audio engine.
//!
//! The React frontend sends a compact JSON playback snapshot; Rust owns the
//! transport, the synth voices, the master chain and the recovery buffer.

use std::sync::Mutex;

use openbeats_audio::analyzer::SpectralAnalyzer;
use openbeats_audio::arp::{ArpEvent, Arpeggiator};
use openbeats_audio::automation::{AutomationLane, AutomationSet};
use openbeats_audio::chord::{chord_for, chord_stamp, suggest_progression, Chord};
use openbeats_audio::command::{parse_command, ParsedCommand};
use openbeats_audio::devices::AudioDevices;
use openbeats_audio::effect_graph::ModularGraph;
use openbeats_audio::engine::list_devices;
use openbeats_audio::engine::{EngineSnapshot, NativeEngine};
use openbeats_audio::melody::{self as melody_mod, MelodyOptions};
use openbeats_audio::mixer::{MixError, MixerGraph, MixerStrip};
use openbeats_audio::notes::{normalize_gains, note_name, KeyLabels};
use openbeats_audio::piano_tools::{
    arpeggiate, flam, scale_pitches, snap_to_scale, strum, ArpMode, Scale, StrumOptions, ToolNote,
};
use openbeats_audio::playlist_tools::{
    chop as chop_span, quantize_start, slice as slice_span, ClipSpan,
};
use openbeats_audio::sequencer::{PlaybackChannel, PlaybackProject};
use openbeats_audio::theme::css_variables;
use openbeats_audio::workflow::{
    auto_gain_staging, health_check, humanize, tap_tempo, Groove, HealthIssue, ProjectHealth,
};
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
        latency_ms: 0.0,
        channels: 0,
        device_swaps: 0,
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

/// Plays one instrument note outside the transport: clicking a channel in the
/// rack, or a key in the piano roll, must not depend on the sequencer.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn play_test_note(
    state: State<'_, AudioState>,
    preset: String,
    pitch: u8,
    velocity: Option<f32>,
    gain: Option<f32>,
    pan: Option<f32>,
    root: Option<u8>,
    attack: Option<f32>,
    decay: Option<f32>,
    release: Option<f32>,
    tone: Option<f32>,
) -> Result<(), String> {
    let mut guard = state
        .engine
        .lock()
        .map_err(|_| "the audio state is unavailable".to_string())?;
    if guard.is_none() {
        *guard = Some(NativeEngine::start()?);
    }
    let channel = PlaybackChannel {
        id: "preview".into(),
        preset,
        mixer: 0,
        gain: gain.unwrap_or(0.9).clamp(0.05, 2.0),
        pan: pan.unwrap_or(0.0).clamp(-1.0, 1.0),
        mute: false,
        solo: false,
        root: root.unwrap_or(pitch),
        attack: attack.unwrap_or(0.01),
        decay: decay.unwrap_or(0.35),
        release: release.unwrap_or(0.25),
        tone: tone.unwrap_or(0.5),
        inserts: Vec::new(),
        automation: Vec::new(),
    };
    guard
        .as_ref()
        .ok_or_else(|| "the audio engine did not start".to_string())?
        .preview_note(channel, pitch, velocity.unwrap_or(0.85), 0.6);
    Ok(())
}

/// Plays one metronome click immediately, even with the transport stopped.
#[tauri::command]
pub fn play_metronome(state: State<'_, AudioState>, accent: Option<bool>) -> Result<(), String> {
    let mut guard = state
        .engine
        .lock()
        .map_err(|_| "the audio state is unavailable".to_string())?;
    if guard.is_none() {
        *guard = Some(NativeEngine::start()?);
    }
    guard
        .as_ref()
        .ok_or_else(|| "the audio engine did not start".to_string())?
        .click(accent.unwrap_or(false));
    Ok(())
}

/// Moves the native playhead without stopping and restarting the stream.
#[tauri::command]
pub fn set_playhead_position(state: State<'_, AudioState>, step: u32) -> Result<(), String> {
    let guard = state
        .engine
        .lock()
        .map_err(|_| "the audio state is unavailable".to_string())?;
    if let Some(engine) = guard.as_ref() {
        engine.seek(step)?;
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
    let logger = engine
        .logger()
        .ok_or_else(|| "the audio stream is not open yet".to_string())?;
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

/* ------------------------------------------------------------------ *
 * Device selection, low latency and cue routing (native builds)
 * ------------------------------------------------------------------ */

/// Every input and output device CPAL reports, for the Audio settings tab.
#[tauri::command]
pub fn get_audio_devices() -> AudioDevices {
    list_devices()
}

/// Rebuilds the stream on `device` (or the platform preference when null).
#[tauri::command]
pub fn select_audio_device(
    state: State<'_, AudioState>,
    device: Option<String>,
) -> Result<EngineSnapshot, String> {
    let mut guard = state
        .engine
        .lock()
        .map_err(|_| "the audio state is unavailable".to_string())?;
    if guard.is_none() {
        *guard = Some(NativeEngine::start_with(device, false)?);
    } else if let Some(engine) = guard.as_mut() {
        engine.select_device(device)?;
    }
    // The stream is rebuilt on the audio thread; give it a moment so the caller
    // gets the new device name and latency rather than the old snapshot.
    std::thread::sleep(std::time::Duration::from_millis(300));
    Ok(guard
        .as_ref()
        .map(|engine| engine.snapshot())
        .unwrap_or_else(stopped_snapshot))
}

/// Reopens the stream with the device minimum buffer (`true`) or its default.
#[tauri::command]
pub fn set_low_latency(
    state: State<'_, AudioState>,
    enabled: bool,
) -> Result<EngineSnapshot, String> {
    let mut guard = state
        .engine
        .lock()
        .map_err(|_| "the audio state is unavailable".to_string())?;
    if guard.is_none() {
        *guard = Some(NativeEngine::start_with(None, enabled)?);
    } else if let Some(engine) = guard.as_mut() {
        engine.set_low_latency(enabled)?;
    }
    std::thread::sleep(std::time::Duration::from_millis(300));
    Ok(guard
        .as_ref()
        .map(|engine| engine.snapshot())
        .unwrap_or_else(stopped_snapshot))
}

/// Level of the cue bus written to outputs 3/4.
#[tauri::command]
pub fn set_master_gain(state: State<'_, AudioState>, gain: f32) -> Result<(), String> {
    let guard = state
        .engine
        .lock()
        .map_err(|_| "the audio state is unavailable".to_string())?;
    if let Some(engine) = guard.as_ref() {
        engine.set_master_gain(gain);
    }
    Ok(())
}

#[tauri::command]
pub fn set_cue_gain(state: State<'_, AudioState>, gain: f32) -> Result<(), String> {
    let guard = state
        .engine
        .lock()
        .map_err(|_| "the audio state is unavailable".to_string())?;
    if let Some(engine) = guard.as_ref() {
        engine.set_cue_gain(gain);
    }
    Ok(())
}

/// Current engine snapshot without touching the transport.
#[tauri::command]
pub fn audio_engine_info(state: State<'_, AudioState>) -> EngineSnapshot {
    state
        .engine
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|engine| engine.snapshot()))
        .unwrap_or_else(stopped_snapshot)
}

/* ------------------------------------------------------------------ *
 * Smart workflow and composition
 * ------------------------------------------------------------------ */

fn groove_for(id: &str) -> Groove {
    match id.to_lowercase().as_str() {
        "laid_back" | "laidback" | "laid-back" => Groove::laid_back(),
        "pushed" | "push" => Groove::pushed(),
        "shuffle" | "swing" => Groove::shuffle(),
        _ => Groove::straight(),
    }
}

/// Groove-aware humanise: the same notes and groove always give the same result.
#[tauri::command]
pub fn humanize_notes(notes: Vec<ToolNote>, groove: String, amount: f32) -> Vec<ToolNote> {
    humanize(&notes, &groove_for(&groove), amount)
}

/// Fader gains that leave the requested headroom (-6 dBFS by default).
#[tauri::command]
pub fn auto_gain_gains(peaks: Vec<f32>, headroom_db: Option<f32>) -> Vec<f32> {
    auto_gain_staging(&peaks, headroom_db.unwrap_or(-6.0))
}

/// Clipping, unused channels, missing samples and heavy plugins.
#[tauri::command]
pub fn project_health(project: ProjectHealth) -> Vec<HealthIssue> {
    health_check(&project)
}

/// Rule-based melody generation; the same seed reproduces the same take.
#[tauri::command]
pub fn generate_melody(options: MelodyOptions) -> Vec<ToolNote> {
    melody_mod::generate(&options)
}

/// BPM from tap times in milliseconds.
#[tauri::command]
pub fn tap_tempo_from_taps(taps_ms: Vec<u64>) -> Option<f32> {
    tap_tempo(&taps_ms)
}

/// Renders the held-note arpeggiator into a note pattern.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn arp_pattern(
    notes: Vec<ToolNote>,
    bpm: f32,
    mode: ArpMode,
    rate_steps: f32,
    octaves: u8,
    gate: f32,
    steps: u32,
) -> Vec<ToolNote> {
    if notes.is_empty() || steps == 0 {
        return Vec::new();
    }
    let bpm = bpm.clamp(20.0, 300.0);
    let mut arp = Arpeggiator::new(48_000.0, bpm);
    arp.mode = mode;
    arp.rate_steps = rate_steps.clamp(0.25, 4.0);
    arp.octaves = octaves.max(1);
    arp.gate = gate.clamp(0.05, 1.0);
    for note in &notes {
        arp.note_on(note.pitch);
    }
    let frames_per_step = ((60.0 / bpm / 4.0) * 48_000.0 * arp.rate_steps).max(1.0) as usize;

    let mut out = Vec::new();
    let mut open: Option<(u8, f32)> = None;
    for step in 0..steps {
        for event in arp.advance(frames_per_step) {
            match event {
                ArpEvent::NoteOn(pitch) => {
                    if let Some((previous, start)) = open.take() {
                        out.push(ToolNote::new(
                            previous,
                            start,
                            (step as f32 - start).max(0.25),
                            0.9,
                        ));
                    }
                    open = Some((pitch, step as f32));
                }
                ArpEvent::NoteOff(_) => {
                    if let Some((pitch, start)) = open.take() {
                        out.push(ToolNote::new(
                            pitch,
                            start,
                            (step as f32 - start).max(0.25),
                            0.9,
                        ));
                    }
                }
            }
        }
    }
    if let Some((pitch, start)) = open {
        out.push(ToolNote::new(pitch, start, 0.5, 0.9));
    }
    out
}

/// Magnitudes per frequency band for the spectrum display.
#[tauri::command]
pub fn spectrum_bands(samples: Vec<f32>, sample_rate: f32, bands: Option<Vec<f32>>) -> Vec<f32> {
    let edges = bands.unwrap_or_else(|| {
        vec![
            20.0, 60.0, 120.0, 250.0, 500.0, 1_000.0, 2_000.0, 4_000.0, 8_000.0, 16_000.0, 20_000.0,
        ]
    });
    let mut analyzer = SpectralAnalyzer::new(2048);
    analyzer.bands(&samples, &edges, sample_rate)
}

/// CSS custom properties for a theme file, validated in Rust.
#[derive(Serialize)]
pub struct ThemeVariables {
    pub name: String,
    pub variables: Vec<(String, String)>,
    pub css: String,
}

/// Parses a JSON theme into `--variable` pairs the UI applies to the document.
#[tauri::command]
pub fn parse_theme(json: String) -> Result<ThemeVariables, String> {
    let parsed = css_variables(&json)?;
    Ok(ThemeVariables {
        name: parsed.name.clone(),
        css: parsed.stylesheet(),
        variables: parsed.variables,
    })
}

/// Plays the bundled startup chime through the main output stream.
#[tauri::command]
pub fn play_chime(state: State<'_, AudioState>) -> Result<(), String> {
    let mut guard = state
        .engine
        .lock()
        .map_err(|_| "the audio state is unavailable".to_string())?;
    if guard.is_none() {
        *guard = Some(NativeEngine::start()?);
    }
    guard
        .as_ref()
        .ok_or_else(|| "the audio engine did not start".to_string())?
        .chime()
}
