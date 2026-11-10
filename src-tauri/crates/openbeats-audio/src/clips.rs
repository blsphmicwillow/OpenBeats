//! Clip expansion: turns playlist clips into note events.
//!
//! Covers the clip properties the FL Studio changelog lists: per-clip gain,
//! pan, pitch, stretch factor and fade in/out. Everything is computed here so
//! the native sequencer and the JSON contract share one definition.
//!
//! Fades are applied at note granularity (each note gets the fade level at its
//! start), which is the honest resolution for a step-based pattern clip.

use serde::{Deserialize, Serialize};

fn one() -> f32 {
    1.0
}

/// A clip on a playlist track.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PlaybackClip {
    pub id: String,
    pub pattern: String,
    /// Playlist track index; muted tracks are filtered by the caller.
    #[serde(default)]
    pub track: usize,
    /// Start in 16th-note steps from the song start.
    pub start: f32,
    /// Length in steps.
    pub len: f32,
    #[serde(default = "one")]
    pub gain: f32,
    #[serde(default)]
    pub pan: f32,
    /// Transpose in semitones.
    #[serde(default)]
    pub pitch: i32,
    /// Time multiplier: 2.0 plays the pattern twice as long (half speed).
    #[serde(default = "one")]
    pub stretch: f32,
    /// Fade length in steps.
    #[serde(default)]
    pub fade_in: f32,
    #[serde(default)]
    pub fade_out: f32,
    #[serde(default)]
    pub muted: bool,
}

/// A pattern referenced by clips.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PlaybackPattern {
    pub id: String,
    /// Length in bars (4/4), so the clip can loop the pattern.
    #[serde(default = "default_bars")]
    pub bars: u32,
    #[serde(default)]
    pub notes: Vec<PlaybackPatternNote>,
}

fn default_bars() -> u32 {
    1
}

/// One note inside a pattern.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PlaybackPatternNote {
    pub channel: String,
    pub pitch: u8,
    /// Start in steps, relative to the pattern.
    pub start: f32,
    pub len: f32,
    #[serde(default = "one")]
    pub vel: f32,
}

/// A note ready for the sequencer, with clip properties applied.
#[derive(Debug, Clone, PartialEq)]
pub struct ExpandedNote {
    pub channel: String,
    pub pitch: u8,
    pub start: f32,
    pub len: f32,
    pub vel: f32,
    /// Clip gain including the fade ramp.
    pub gain: f32,
    pub pan: f32,
}

/// Steps in one bar of a 4/4 pattern.
pub const STEPS_PER_BAR: f32 = 16.0;

/// Gain multiplier from the clip's fades at `position` steps into the clip.
pub fn fade_gain_at(clip: &PlaybackClip, position: f32) -> f32 {
    let mut gain = 1.0f32;
    if clip.fade_in > 0.0 && position < clip.fade_in {
        gain *= (position / clip.fade_in).clamp(0.0, 1.0);
    }
    let from_end = clip.len - position;
    if clip.fade_out > 0.0 && from_end < clip.fade_out {
        gain *= (from_end / clip.fade_out).clamp(0.0, 1.0);
    }
    gain
}

/// Total gain for a note starting at `position` steps into the clip.
pub fn clip_gain_at(clip: &PlaybackClip, position: f32) -> f32 {
    clip.gain.max(0.0) * fade_gain_at(clip, position)
}

/// Transposes a pitch, clamped to the MIDI range.
pub fn transpose(pitch: u8, semitones: i32) -> u8 {
    (pitch as i32 + semitones).clamp(0, 127) as u8
}

/// Expands a clip and its pattern into note events.
///
/// The pattern loops for the clip's length. `stretch` multiplies every time
/// value: 1.0 is the original tempo, 2.0 halves it, 0.5 doubles it.
pub fn expand_clip(clip: &PlaybackClip, pattern: &PlaybackPattern) -> Vec<ExpandedNote> {
    if clip.muted || clip.len <= 0.0 {
        return Vec::new();
    }
    let stretch = if clip.stretch.is_finite() && clip.stretch > 0.05 {
        clip.stretch
    } else {
        1.0
    };
    let pattern_len = (pattern.bars.max(1) as f32 * STEPS_PER_BAR * stretch).max(0.25);
    let clip_end = clip.start + clip.len;

    let mut out = Vec::new();
    let mut cycle = 0.0f32;
    // Guard against a pathological number of cycles.
    while clip.start + cycle * pattern_len < clip_end && cycle < 512.0 {
        for note in &pattern.notes {
            let start = clip.start + cycle * pattern_len + note.start * stretch;
            if start >= clip_end || start < clip.start {
                continue;
            }
            let len = (note.len * stretch).max(0.01);
            out.push(ExpandedNote {
                channel: note.channel.clone(),
                pitch: transpose(note.pitch, clip.pitch),
                start,
                len,
                vel: note.vel,
                gain: clip_gain_at(clip, start - clip.start),
                pan: clip.pan.clamp(-1.0, 1.0),
            });
        }
        cycle += 1.0;
    }
    out.sort_by(|a, b| {
        a.start
            .partial_cmp(&b.start)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clip() -> PlaybackClip {
        PlaybackClip {
            id: "c1".into(),
            pattern: "p1".into(),
            track: 0,
            start: 0.0,
            len: 16.0,
            gain: 1.0,
            pan: 0.0,
            pitch: 0,
            stretch: 1.0,
            fade_in: 0.0,
            fade_out: 0.0,
            muted: false,
        }
    }

    fn pattern() -> PlaybackPattern {
        PlaybackPattern {
            id: "p1".into(),
            bars: 1,
            notes: vec![
                PlaybackPatternNote {
                    channel: "kick".into(),
                    pitch: 36,
                    start: 0.0,
                    len: 1.0,
                    vel: 1.0,
                },
                PlaybackPatternNote {
                    channel: "snare".into(),
                    pitch: 38,
                    start: 4.0,
                    len: 1.0,
                    vel: 0.8,
                },
            ],
        }
    }

    #[test]
    fn expands_one_pattern_inside_one_clip() {
        let notes = expand_clip(&clip(), &pattern());
        assert_eq!(notes.len(), 2);
        assert_eq!(notes[0].pitch, 36);
        assert!((notes[1].start - 4.0).abs() < 1e-6);
    }

    #[test]
    fn per_clip_pitch_transposes_notes() {
        let mut c = clip();
        c.pitch = 12;
        let notes = expand_clip(&c, &pattern());
        assert_eq!(notes[0].pitch, 48);
        assert_eq!(notes[1].pitch, 50);
    }

    #[test]
    fn per_clip_pan_is_carried_to_every_note() {
        let mut c = clip();
        c.pan = -0.75;
        let notes = expand_clip(&c, &pattern());
        assert!(notes.iter().all(|n| (n.pan + 0.75).abs() < 1e-6));
    }

    #[test]
    fn stretch_scales_note_positions_and_lengths() {
        let mut c = clip();
        c.len = 32.0;
        c.stretch = 2.0;
        let notes = expand_clip(&c, &pattern());
        // Second note of the pattern lands twice as late and lasts twice as long.
        assert!(
            (notes[1].start - 8.0).abs() < 1e-6,
            "got {}",
            notes[1].start
        );
        assert!((notes[1].len - 2.0).abs() < 1e-6);
    }

    #[test]
    fn a_long_clip_loops_the_pattern() {
        let mut c = clip();
        c.len = 32.0;
        let notes = expand_clip(&c, &pattern());
        assert_eq!(notes.len(), 4, "pattern did not repeat");
        assert!((notes[2].start - 16.0).abs() < 1e-6);
    }

    #[test]
    fn fade_in_ramps_the_note_gain() {
        let mut c = clip();
        c.fade_in = 8.0;
        c.len = 16.0;
        let notes = expand_clip(&c, &pattern());
        assert!(
            notes[0].gain < 0.01,
            "first note should be near silent at the fade start"
        );
        // A note at step 4 into an 8-step fade is halfway up.
        let mid = clip_gain_at(&c, 4.0);
        assert!((mid - 0.5).abs() < 1e-6, "mid fade gain was {mid}");
    }

    #[test]
    fn fade_out_ramps_the_note_gain() {
        let mut c = clip();
        c.fade_out = 8.0;
        assert!((clip_gain_at(&c, 16.0) - 0.0).abs() < 1e-6);
        assert!((clip_gain_at(&c, 12.0) - 0.5).abs() < 1e-6);
        assert!((clip_gain_at(&c, 0.0) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn muted_clips_expand_to_nothing() {
        let mut c = clip();
        c.muted = true;
        assert!(expand_clip(&c, &pattern()).is_empty());
    }

    #[test]
    fn transpose_clamps_to_midi_range() {
        assert_eq!(transpose(120, 12), 127);
        assert_eq!(transpose(2, -12), 0);
    }

    #[test]
    fn zero_stretch_falls_back_to_one() {
        let mut c = clip();
        c.stretch = 0.0;
        let notes = expand_clip(&c, &pattern());
        assert!((notes[1].start - 4.0).abs() < 1e-6);
    }
}
