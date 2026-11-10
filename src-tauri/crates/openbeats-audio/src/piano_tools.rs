//! Piano-roll tools ported from the FL Studio manual: Strum, Arpeggiate, Flam
//! and scale highlighting/snapping.
//!
//! All of them are pure note transformations, so the same functions serve the
//! native sequencer and the React piano roll (through Tauri commands).

use serde::{Deserialize, Serialize};

/// One note inside a tool operation.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
pub struct ToolNote {
    pub pitch: u8,
    pub start: f32,
    pub len: f32,
    #[serde(default = "unity")]
    pub vel: f32,
}

fn unity() -> f32 {
    1.0
}

impl ToolNote {
    pub fn new(pitch: u8, start: f32, len: f32, vel: f32) -> Self {
        Self {
            pitch,
            start,
            len,
            vel,
        }
    }
}

/// Strum controls: `start` shifts each note against the previous one, `tension`
/// accelerates or decelerates the spread, `velocity` changes the velocity of
/// each successive note (positive decreases it, as in the manual).
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
pub struct StrumOptions {
    pub start: f32,
    #[serde(default)]
    pub tension: f32,
    #[serde(default)]
    pub velocity: f32,
}

/// Strum: notes sharing a start time are treated as one chord and spread out.
///
/// A positive `start` strums low to high, a negative one high to low.
pub fn strum(notes: &[ToolNote], options: StrumOptions) -> Vec<ToolNote> {
    if notes.is_empty() || options.start == 0.0 {
        return notes.to_vec();
    }
    let mut out = Vec::with_capacity(notes.len());
    // Group by start time (rounded to a 64th) so separate chords stay separate.
    let mut groups: Vec<(i64, Vec<ToolNote>)> = Vec::new();
    for note in notes {
        let key = (note.start * 4.0).round() as i64;
        match groups.iter_mut().find(|(k, _)| *k == key) {
            Some((_, list)) => list.push(*note),
            None => groups.push((key, vec![*note])),
        }
    }

    for (_, mut chord) in groups {
        // Always walk low to high: a negative start then shifts the higher notes
        // earlier, so the chord is strummed high to low.
        chord.sort_by_key(|note| note.pitch);
        for (i, note) in chord.iter().enumerate() {
            let i = i as f32;
            // Tension bends the spacing: positive accelerates, negative eases in.
            let offset = options.start * (i + options.tension * i * i * 0.5);
            let vel = (note.vel * (1.0 - options.velocity * i)).clamp(0.0, 1.0);
            out.push(ToolNote {
                start: note.start + offset,
                vel,
                ..*note
            });
        }
    }
    out.sort_by(|a, b| {
        a.start
            .partial_cmp(&b.start)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out
}

/// Arpeggiator direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ArpMode {
    Up,
    Down,
    UpDown,
    AsPlayed,
}

/// Arpeggiator: turns a chord into single notes spaced `rate` steps apart.
///
/// `octaves` repeats the chord upwards (1 = the original octave only).
pub fn arpeggiate(notes: &[ToolNote], mode: ArpMode, rate: f32, octaves: u8) -> Vec<ToolNote> {
    if notes.is_empty() {
        return Vec::new();
    }
    let rate = rate.max(0.0625);
    let start = notes.iter().map(|n| n.start).fold(f32::INFINITY, f32::min);

    let mut base: Vec<ToolNote> = match mode {
        ArpMode::AsPlayed => notes.to_vec(),
        ArpMode::Up => {
            let mut sorted = notes.to_vec();
            sorted.sort_by_key(|n| n.pitch);
            sorted
        }
        ArpMode::Down => {
            let mut sorted = notes.to_vec();
            sorted.sort_by(|a, b| b.pitch.cmp(&a.pitch));
            sorted
        }
        ArpMode::UpDown => {
            let mut sorted = notes.to_vec();
            sorted.sort_by_key(|n| n.pitch);
            let mut down = sorted.iter().rev().skip(1).copied().collect::<Vec<_>>();
            down.pop();
            sorted.extend(down);
            sorted
        }
    };

    let octaves = octaves.max(1) as u16;
    if octaves > 1 {
        let original = base.clone();
        for octave in 1..octaves {
            for note in &original {
                let pitch = note.pitch as u16 + 12 * octave;
                if pitch <= 127 {
                    base.push(ToolNote {
                        pitch: pitch as u8,
                        ..*note
                    });
                }
            }
        }
    }

    base.iter()
        .enumerate()
        .map(|(i, note)| ToolNote {
            pitch: note.pitch,
            start: start + i as f32 * rate,
            len: (rate * 0.9).max(0.0625),
            vel: note.vel,
        })
        .collect()
}

/// Flam: repeats each note at a short offset, decaying in velocity.
pub fn flam(notes: &[ToolNote], offset: f32, repeats: u8, velocity_decay: f32) -> Vec<ToolNote> {
    let repeats = repeats.max(1);
    let mut out = Vec::with_capacity(notes.len() * repeats as usize);
    for note in notes {
        for i in 0..repeats {
            let i = i as f32;
            out.push(ToolNote {
                pitch: note.pitch,
                start: note.start + i * offset,
                len: note.len,
                vel: (note.vel * (1.0 - velocity_decay).powf(i)).clamp(0.0, 1.0),
            });
        }
    }
    out.sort_by(|a, b| {
        a.start
            .partial_cmp(&b.start)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out
}

/// Scales available for highlighting and snapping.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Scale {
    Major,
    NaturalMinor,
    HarmonicMinor,
    MelodicMinor,
    Dorian,
    Phrygian,
    Lydian,
    Mixolydian,
    PentatonicMajor,
    PentatonicMinor,
    Blues,
    Chromatic,
}

impl Scale {
    /// Semitone offsets from the root.
    pub fn intervals(self) -> &'static [u8] {
        match self {
            Scale::Major => &[0, 2, 4, 5, 7, 9, 11],
            Scale::NaturalMinor => &[0, 2, 3, 5, 7, 8, 10],
            Scale::HarmonicMinor => &[0, 2, 3, 5, 7, 8, 11],
            Scale::MelodicMinor => &[0, 2, 3, 5, 7, 9, 11],
            Scale::Dorian => &[0, 2, 3, 5, 7, 9, 10],
            Scale::Phrygian => &[0, 1, 3, 5, 7, 8, 10],
            Scale::Lydian => &[0, 2, 4, 6, 7, 9, 11],
            Scale::Mixolydian => &[0, 2, 4, 5, 7, 9, 10],
            Scale::PentatonicMajor => &[0, 2, 4, 7, 9],
            Scale::PentatonicMinor => &[0, 3, 5, 7, 10],
            Scale::Blues => &[0, 3, 5, 6, 7, 10],
            Scale::Chromatic => &[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        }
    }
}

/// True when `pitch` belongs to the scale rooted at `root`.
pub fn is_in_scale(pitch: u8, root: u8, scale: Scale) -> bool {
    let degree = (pitch as i32 - root as i32).rem_euclid(12) as u8;
    scale.intervals().contains(&degree)
}

/// The scale's pitches across `octaves`, starting at the root's octave.
pub fn scale_pitches(root: u8, scale: Scale, octaves: u8) -> Vec<u8> {
    let mut out = Vec::new();
    let base = (root as i32 / 12) * 12;
    for octave in 0..octaves.max(1) as i32 {
        for interval in scale.intervals() {
            let pitch = base + *interval as i32 + octave * 12;
            if (0..=127).contains(&pitch) {
                out.push(pitch as u8);
            }
        }
    }
    out
}

/// Moves a pitch to the nearest scale note, preferring the lower note on a tie.
pub fn snap_to_scale(pitch: u8, root: u8, scale: Scale) -> u8 {
    if is_in_scale(pitch, root, scale) {
        return pitch;
    }
    for distance in 1..=6u8 {
        if pitch >= distance && is_in_scale(pitch - distance, root, scale) {
            return pitch - distance;
        }
        if pitch + distance <= 127 && is_in_scale(pitch + distance, root, scale) {
            return pitch + distance;
        }
    }
    pitch
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chord() -> Vec<ToolNote> {
        vec![
            ToolNote::new(60, 0.0, 2.0, 1.0),
            ToolNote::new(64, 0.0, 2.0, 1.0),
            ToolNote::new(67, 0.0, 2.0, 1.0),
        ]
    }

    #[test]
    fn strum_spreads_a_chord_low_to_high() {
        let out = strum(
            &chord(),
            StrumOptions {
                start: 0.25,
                tension: 0.0,
                velocity: 0.0,
            },
        );
        assert_eq!(out.len(), 3);
        let starts: Vec<f32> = out.iter().map(|n| n.start).collect();
        assert!(
            starts[0] < starts[1] && starts[1] < starts[2],
            "starts {starts:?}"
        );
        assert_eq!(out[0].pitch, 60);
        assert_eq!(out[2].pitch, 67);
    }

    #[test]
    fn a_negative_strum_runs_high_to_low() {
        let out = strum(
            &chord(),
            StrumOptions {
                start: -0.25,
                tension: 0.0,
                velocity: 0.0,
            },
        );
        assert_eq!(out[0].pitch, 67, "negative strum should start on top");
        assert!(out[0].start < out[2].start);
    }

    #[test]
    fn strum_tension_accelerates_the_spread() {
        let plain = strum(
            &chord(),
            StrumOptions {
                start: 0.25,
                tension: 0.0,
                velocity: 0.0,
            },
        );
        let tight = strum(
            &chord(),
            StrumOptions {
                start: 0.25,
                tension: 1.0,
                velocity: 0.0,
            },
        );
        let plain_span = plain[2].start - plain[0].start;
        let tight_span = tight[2].start - tight[0].start;
        assert!(
            tight_span > plain_span,
            "tension did not widen: {plain_span} vs {tight_span}"
        );
    }

    #[test]
    fn strum_can_ramp_velocity() {
        let out = strum(
            &chord(),
            StrumOptions {
                start: 0.25,
                tension: 0.0,
                velocity: 0.2,
            },
        );
        // The manual: a positive velocity value decreases each successive note.
        assert!(out[0].vel > out[2].vel, "velocity did not ramp down");
        assert!(out[2].vel > 0.0);
    }

    #[test]
    fn separate_chords_stay_separate() {
        let notes = vec![
            ToolNote::new(60, 0.0, 1.0, 1.0),
            ToolNote::new(64, 0.0, 1.0, 1.0),
            ToolNote::new(48, 4.0, 1.0, 1.0),
            ToolNote::new(52, 4.0, 1.0, 1.0),
        ];
        let out = strum(
            &notes,
            StrumOptions {
                start: 0.1,
                tension: 0.0,
                velocity: 0.0,
            },
        );
        assert_eq!(out.len(), 4);
        assert!(out.iter().any(|n| (n.start - 4.0).abs() < 1e-6));
    }

    #[test]
    fn arpeggio_up_walks_the_chord_in_order() {
        let out = arpeggiate(&chord(), ArpMode::Up, 1.0, 1);
        assert_eq!(
            out.iter().map(|n| n.pitch).collect::<Vec<_>>(),
            vec![60, 64, 67]
        );
        assert!((out[0].start - 0.0).abs() < 1e-6);
        assert!((out[2].start - 2.0).abs() < 1e-6);
    }

    #[test]
    fn arpeggio_down_reverses_it() {
        let out = arpeggiate(&chord(), ArpMode::Down, 1.0, 1);
        assert_eq!(out[0].pitch, 67);
        assert_eq!(out[2].pitch, 60);
    }

    #[test]
    fn arpeggio_octaves_repeat_upwards() {
        let out = arpeggiate(&chord(), ArpMode::Up, 0.5, 2);
        assert_eq!(out.len(), 6);
        assert_eq!(out[3].pitch, 72, "second octave missing");
        assert!(out[3].start > out[2].start);
    }

    #[test]
    fn arpeggio_updown_does_not_repeat_the_ends() {
        let out = arpeggiate(&chord(), ArpMode::UpDown, 0.5, 1);
        // 60 64 67 64 — the top and bottom are not doubled.
        assert_eq!(
            out.iter().map(|n| n.pitch).collect::<Vec<_>>(),
            vec![60, 64, 67, 64]
        );
    }

    #[test]
    fn flam_repeats_with_decaying_velocity() {
        let note = vec![ToolNote::new(38, 0.0, 1.0, 1.0)];
        let out = flam(&note, 0.0625, 3, 0.3);
        assert_eq!(out.len(), 3);
        assert!(out[1].start > out[0].start);
        assert!(out[1].vel < out[0].vel);
        assert!(out[2].vel < out[1].vel);
    }

    #[test]
    fn scales_have_the_documented_intervals() {
        assert_eq!(Scale::Major.intervals().len(), 7);
        assert_eq!(Scale::PentatonicMinor.intervals(), &[0, 3, 5, 7, 10]);
        assert_eq!(Scale::Chromatic.intervals().len(), 12);
    }

    #[test]
    fn scale_membership_and_snapping() {
        assert!(is_in_scale(60, 60, Scale::Major));
        assert!(!is_in_scale(61, 60, Scale::Major));
        assert_eq!(snap_to_scale(61, 60, Scale::Major), 60);
        // F# in C major snaps down to F.
        assert_eq!(snap_to_scale(66, 60, Scale::Major), 65);
        assert_eq!(snap_to_scale(60, 60, Scale::Major), 60);
    }

    #[test]
    fn scale_pitches_cover_the_requested_octaves() {
        let pitches = scale_pitches(60, Scale::Major, 2);
        assert_eq!(pitches.len(), 14);
        assert_eq!(pitches[0], 60);
        assert_eq!(pitches[7], 72);
    }

    #[test]
    fn chord_stamp_writes_a_major_triad() {
        let notes = crate::chord::chord_stamp(0, "", 0, 4, 0.0, 4.0, 0.9);
        assert_eq!(
            notes.iter().map(|n| n.pitch).collect::<Vec<_>>(),
            vec![60, 64, 67]
        );
        assert!(notes.iter().all(|n| (n.len - 4.0).abs() < 1e-6));
        assert!(notes.iter().all(|n| (n.vel - 0.9).abs() < 1e-6));
    }

    #[test]
    fn chord_stamp_first_inversion_raises_the_root() {
        let notes = crate::chord::chord_stamp(0, "", 1, 4, 0.0, 1.0, 1.0);
        assert_eq!(
            notes.iter().map(|n| n.pitch).collect::<Vec<_>>(),
            vec![64, 67, 72]
        );
    }

    #[test]
    fn chord_stamp_respects_octave_and_quality() {
        let notes = crate::chord::chord_stamp(9, "m7", 0, 3, 0.0, 1.0, 1.0);
        assert_eq!(
            notes.iter().map(|n| n.pitch).collect::<Vec<_>>(),
            vec![57, 60, 64, 67]
        );
    }

    #[test]
    fn chord_stamp_rejects_an_unknown_quality() {
        assert!(crate::chord::chord_stamp(0, "nope", 0, 4, 0.0, 1.0, 1.0).is_empty());
    }
}
