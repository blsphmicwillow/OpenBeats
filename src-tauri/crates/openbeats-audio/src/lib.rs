//! OpenBeats native audio engine.
//!
//! This crate is deliberately free of Tauri and of any system audio dependency
//! unless the `device` feature is on, so the DSP, the sequencer and the feature
//! maths can be unit-tested on any machine.
//!
//! Architecture:
//!
//! ```text
//! Sequencer (steps -> sample-accurate note events)
//!     -> VoicePool (per-channel synth voices, ADSR, pan)
//!         -> MasterChain (3-band EQ -> compressor -> limiter -> gain)
//!             -> Transmitter (transient/sustain split for routing)
//!             -> AudioLogger (60 s recovery ring buffer)
//!                 -> CPAL output stream            [feature = "device"]
//! ```

pub mod analyzer;
pub mod arp;
pub mod automation;
pub mod chime;
pub mod chord;
pub mod clips;
pub mod command;
pub mod devices;
pub mod dsp;
pub mod effect_graph;
pub mod export;
pub mod granular;
pub mod insert_fx;
#[cfg(target_os = "linux")]
pub mod linux_audio;
pub mod logger;
pub mod melody;
pub mod mixer;
pub mod mixer_runtime;
pub mod notes;
pub mod packs;
pub mod piano_tools;
pub mod pitch;
pub mod playlist_tools;
mod preview;
pub mod progression;
pub mod sequencer;
pub mod spectral_freeze;
pub mod strip;
pub mod suggestion;
pub mod synth;
pub mod theme;
pub mod update;
pub mod velocity;
pub mod watchdog;
pub mod workflow;

#[cfg(feature = "decode")]
pub mod decode;
#[cfg(feature = "device")]
pub mod engine;
#[cfg(feature = "device")]
pub mod io;

pub use analyzer::SpectralAnalyzer;
pub use arp::{ArpEvent, Arpeggiator};
pub use automation::{AutomationLane, AutomationPoint, AutomationSet, Curve};
pub use chime::{bundled as bundled_chime, decode_wav};
pub use chord::{chord_for, suggest_progression, Chord};
pub use clips::{expand_clip, PlaybackClip, PlaybackPattern};
pub use command::{parse_command, ParsedCommand};
pub use devices::{AudioDevices, DeviceInfo};
pub use dsp::{Compressor, Eq3, Limiter, Transmitter};
pub use effect_graph::{ModularGraph, NodeKind};
pub use export::{encode as encode_export, wav_bytes, ExportFormat};
pub use granular::GranularEngine;
pub use logger::AudioLogger;
pub use melody::{generate as generate_melody, MelodyOptions, Rhythm};
pub use mixer::{MixError, MixerGraph, MixerStrip, Send, Sidechain};
pub use mixer_runtime::MixerRuntime;
pub use notes::{display_name, normalize_gains, note_name, note_names};
pub use piano_tools::{arpeggiate, flam, strum, ArpMode, Scale, ToolNote};
pub use pitch::{detect as detect_pitch, note_for, Tuning};
pub use playlist_tools::{chop, duplicate, quantize_start, slice, trim, ClipSpan};
pub use progression::{generate as generate_progression, ProgressionBar, Quality};
pub use sequencer::{PlaybackChannel, PlaybackNote, PlaybackProject, Sequencer};
pub use strip::{gain_at, Insert, StripProcessor};
pub use synth::{Preset, VoicePool};
pub use theme::{css_variables, CssVariables, ThemeFile};
pub use update::{compare as compare_versions, parse as parse_release, UpdateInfo};
pub use velocity::{apply as apply_velocity_curve, VelocityCurve};
pub use workflow::{
    auto_gain_staging, health_check, humanize, tap_tempo, Groove, HealthIssue, ProjectHealth,
};

/// Samples per second used for offline tests and for the fallback device rate.
pub const DEFAULT_SAMPLE_RATE: f32 = 48_000.0;

pub(crate) fn db_to_gain(db: f32) -> f32 {
    10f32.powf(db / 20.0)
}

pub(crate) fn gain_to_db(gain: f32) -> f32 {
    20.0 * gain.max(1e-9).log10()
}

#[cfg(feature = "fundsp-graph")]
pub mod graph;
