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

pub mod chord;
pub mod clips;
pub mod command;
pub mod dsp;
pub mod logger;
pub mod notes;
pub mod sequencer;
pub mod synth;

#[cfg(feature = "device")]
pub mod engine;

pub use chord::{chord_for, suggest_progression, Chord};
pub use clips::{expand_clip, PlaybackClip, PlaybackPattern};
pub use command::{parse_command, ParsedCommand};
pub use dsp::{Compressor, Eq3, Limiter, Transmitter};
pub use logger::AudioLogger;
pub use notes::{display_name, normalize_gains, note_name, note_names};
pub use sequencer::{PlaybackChannel, PlaybackNote, PlaybackProject, Sequencer};
pub use synth::{Preset, VoicePool};

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
