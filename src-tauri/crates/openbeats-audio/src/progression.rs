//! Rule-based chord progression generator.
//!
//! A progression is a loop of scale degrees with the triad each degree owns, so
//! every chord is diatonic and the result can be dropped straight into the piano
//! roll. Styles are small degree recipes rather than random choices, which keeps
//! the output usable and repeatable.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    Major,
    Minor,
    Diminished,
}

impl Quality {
    pub fn symbol(self) -> &'static str {
        match self {
            Self::Major => "",
            Self::Minor => "m",
            Self::Diminished => "dim",
        }
    }

    fn from_intervals(third: u8, fifth: u8) -> Self {
        match (third, fifth) {
            (3, 6) => Self::Diminished,
            (3, 7) => Self::Minor,
            _ => Self::Major,
        }
    }
}

/// One bar of the generated loop.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProgressionBar {
    /// 1-based scale degree.
    pub degree: u8,
    pub quality: Quality,
    /// Chord tones as MIDI notes, root first.
    pub pitches: Vec<u8>,
    /// Human-readable label such as `Am`.
    pub label: String,
    pub start_beat: f32,
    pub beats: f32,
}

const MAJOR: [u8; 7] = [0, 2, 4, 5, 7, 9, 11];
const MINOR: [u8; 7] = [0, 2, 3, 5, 7, 8, 10];

fn degrees_for(style: &str, bars: usize) -> Vec<u8> {
    let recipe: &[u8] = match style.trim().to_lowercase().as_str() {
        "jazz" => &[2, 5, 1, 6],
        "lofi" | "lo-fi" | "chill" => &[1, 6, 2, 5],
        "trap" | "dark" => &[1, 6, 5, 7],
        "house" | "dance" => &[1, 5, 6, 4],
        "cinematic" | "epic" => &[1, 6, 4, 5],
        "blues" => &[1, 4, 1, 5],
        "pop" | _ => &[1, 5, 6, 4],
    };
    (0..bars.max(1)).map(|i| recipe[i % recipe.len()]).collect()
}

/// Generates `bars` diatonic chords.
///
/// `root` is a pitch class 0..11, `octave` the octave of the tonic (4 = middle),
/// `style` one of pop/jazz/lofi/trap/house/cinematic/blues.
pub fn generate(
    root: u8,
    minor: bool,
    octave: u8,
    style: &str,
    bars: usize,
    beats_per_bar: f32,
) -> Vec<ProgressionBar> {
    let scale = if minor { MINOR } else { MAJOR };
    let tonic = 12.0 * (octave as f32 + 1.0) + root as f32 % 12.0;
    let beats = if beats_per_bar > 0.0 {
        beats_per_bar
    } else {
        4.0
    };
    degrees_for(style, bars)
        .into_iter()
        .enumerate()
        .map(|(index, degree)| {
            let step = (degree - 1) as usize;
            let pick = |offset: usize| -> u8 {
                let absolute = step + offset;
                let span = (absolute / 7) as f32 * 12.0;
                tonic as u8 + scale[absolute % 7] + span as u8
            };
            let chord_root = pick(0);
            let third = pick(2);
            let fifth = pick(4);
            let quality = Quality::from_intervals(third - chord_root, fifth - chord_root);
            let label = format!(
                "{}{}",
                crate::pitch::note_name(chord_root),
                quality.symbol()
            );
            ProgressionBar {
                degree,
                quality,
                pitches: vec![chord_root, third, fifth],
                label,
                start_beat: index as f32 * beats,
                beats,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pop_is_the_four_chord_loop_every_time() {
        let first = generate(9, true, 4, "pop", 4, 4.0);
        let second = generate(9, true, 4, "pop", 4, 4.0);
        assert_eq!(first, second);
        assert_eq!(first.len(), 4);
        assert_eq!(
            first.iter().map(|b| b.degree).collect::<Vec<_>>(),
            vec![1, 5, 6, 4]
        );
        assert_eq!(first[0].label, "Am");
    }

    #[test]
    fn every_tone_is_diatonic_to_the_chosen_scale() {
        let chords = generate(0, false, 4, "jazz", 8, 3.0);
        let pitch_classes: Vec<u8> = MAJOR.iter().map(|s| *s).collect();
        for bar in chords {
            for pitch in bar.pitches {
                assert!(
                    pitch_classes.contains(&(pitch % 12)),
                    "{pitch} outside C major"
                );
            }
            assert!(bar.beats > 0.0);
        }
    }

    #[test]
    fn styles_change_the_loop_and_repeat_to_fill_the_request() {
        let jazz = generate(0, false, 4, "jazz", 8, 4.0);
        let trap = generate(0, false, 4, "trap", 8, 4.0);
        assert_ne!(
            jazz.iter().map(|b| b.degree).collect::<Vec<_>>(),
            trap.iter().map(|b| b.degree).collect::<Vec<_>>()
        );
        assert_eq!(jazz[4].degree, jazz[0].degree);
        assert!(jazz[3].start_beat > jazz[2].start_beat);
    }

    #[test]
    fn minor_tonic_is_the_requested_pitch_class() {
        let chords = generate(4, true, 3, "lofi", 4, 4.0);
        assert_eq!(chords[0].pitches[0] % 12, 4);
        assert_eq!(chords[0].quality, Quality::Minor);
    }
}
