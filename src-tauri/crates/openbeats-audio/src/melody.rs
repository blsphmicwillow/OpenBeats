//! Rule-based melody generation.
//!
//! No model, no network: a small set of composition rules (start on a chord
//! tone, move mostly by step, resolve leaps, arch the contour, land on the tonic
//! at the end) driven by a seeded generator. The same seed always produces the
//! same melody, so a take can be regenerated exactly.

use serde::{Deserialize, Serialize};

use crate::piano_tools::{is_in_scale, Scale, ToolNote};

/// Rhythmic flavour of the generated line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Rhythm {
    /// One note per beat.
    Straight,
    /// Off-beat onsets for a syncopated feel.
    Syncopated,
    /// Sparse, held notes.
    Long,
}

impl Rhythm {
    fn onsets(self) -> &'static [u8] {
        match self {
            Rhythm::Straight => &[0, 2, 4, 6, 8, 10, 12, 14],
            Rhythm::Syncopated => &[0, 3, 6, 8, 11, 14],
            Rhythm::Long => &[0, 4, 8, 12],
        }
    }
}

/// Generator settings.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
pub struct MelodyOptions {
    /// Root pitch class 0..11.
    pub root: u8,
    pub scale: Scale,
    /// Length in bars (4/4).
    pub bars: u8,
    pub rhythm: Rhythm,
    /// Octave for the first note (4 = middle C).
    pub octave: u8,
    /// Any 32-bit seed; equal seeds produce equal melodies.
    pub seed: u32,
}

impl Default for MelodyOptions {
    fn default() -> Self {
        Self {
            root: 0,
            scale: Scale::NaturalMinor,
            bars: 2,
            rhythm: Rhythm::Straight,
            octave: 4,
            seed: 1,
        }
    }
}

/// Deterministic LCG.
struct Rng(u32);

impl Rng {
    fn next(&mut self) -> u32 {
        self.0 = self.0.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        self.0
    }

    fn below(&mut self, limit: usize) -> usize {
        (self.next() as usize) % limit.max(1)
    }

    fn unit(&mut self) -> f32 {
        (self.next() >> 8) as f32 / 16_777_216.0
    }
}

/// The scale's degrees across four octaves, low to high.
fn degrees(root: u8, scale: Scale, octave: u8) -> Vec<u8> {
    let mut pitches = Vec::new();
    let base = 12 * (octave as i32 + 1) + root as i32;
    for offset in -12..=36 {
        let pitch = base + offset;
        if (0..=127).contains(&pitch) && is_in_scale(pitch as u8, root, scale) {
            pitches.push(pitch as u8);
        }
    }
    pitches
}

fn degree_index(scale: Scale, pitch: u8, root: u8) -> Option<usize> {
    let degree = (pitch as i32 - root as i32).rem_euclid(12) as u8;
    scale
        .intervals()
        .iter()
        .position(|interval| *interval == degree)
}

/// Generates a melody.
///
/// The line starts on the tonic or third, moves by scale steps with occasional
/// leaps that resolve back, arches up in the first half and down in the second,
/// and ends on a chord tone.
pub fn generate(options: &MelodyOptions) -> Vec<ToolNote> {
    let grid = degrees(options.root, options.scale, options.octave);
    if grid.is_empty() {
        return Vec::new();
    }
    let onsets = options.rhythm.onsets();
    let bars = options.bars.max(1) as usize;
    let mut rng = Rng(options.seed | 1);

    // Begin on the tonic, third or fifth inside the grid.
    let start_candidates: Vec<usize> = (1..grid.len())
        .filter(|index| {
            matches!(
                degree_index(options.scale, grid[*index], options.root),
                Some(0) | Some(2) | Some(4)
            )
        })
        .collect();
    let mut position = *start_candidates
        .get(rng.below(start_candidates.len().max(1)))
        .unwrap_or(&(grid.len() / 4));
    let low = position.saturating_sub(5);
    let high = (position + 7).min(grid.len() - 1);

    let mut notes = Vec::with_capacity(onsets.len() * bars);
    let total = onsets.len() * bars;
    for index in 0..total {
        let bar = index / onsets.len();
        let onset = onsets[index % onsets.len()];
        let step = bar * 16 + onset as usize;
        let last = index + 1 == total;

        let pitch = if last {
            chord_tone_near(&grid, options, position)
        } else {
            grid[position]
        };

        let length = match options.rhythm {
            Rhythm::Long => 3.5,
            _ => 1.5,
        };
        let velocity = 0.7 + rng.unit() * 0.25;
        notes.push(ToolNote::new(pitch, step as f32, length, velocity));

        // Pick the degree for the next note: arch up, then down, mostly by step
        // with occasional leaps that resolve on the following note.
        let progress = (index + 1) as f32 / total.max(1) as f32;
        let direction = if progress < 0.5 { 1i32 } else { -1 };
        let leap = rng.unit() < 0.18;
        let distance = if leap { 2 + rng.below(2) as i32 } else { 1 };
        let mut next = position as i32 + direction * distance;
        if leap && rng.unit() < 0.6 {
            next -= direction;
        }
        position = (next.clamp(low as i32, high as i32) as usize).min(grid.len() - 1);
    }
    notes
}

/// Nearest chord tone (root, third or fifth) to `position`.
fn chord_tone_near(grid: &[u8], options: &MelodyOptions, position: usize) -> u8 {
    for distance in 0..=4 {
        for candidate in [position.checked_sub(distance), Some(position + distance)]
            .into_iter()
            .flatten()
        {
            if candidate >= grid.len() {
                continue;
            }
            if matches!(
                degree_index(options.scale, grid[candidate], options.root),
                Some(0) | Some(2) | Some(4)
            ) {
                return grid[candidate];
            }
        }
    }
    grid[position]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options(seed: u32) -> MelodyOptions {
        MelodyOptions {
            root: 9, // A
            scale: Scale::NaturalMinor,
            bars: 2,
            rhythm: Rhythm::Straight,
            octave: 4,
            seed,
        }
    }

    #[test]
    fn generation_is_deterministic() {
        assert_eq!(generate(&options(7)), generate(&options(7)));
    }

    #[test]
    fn different_seeds_produce_different_lines() {
        let a = generate(&options(1));
        let b = generate(&options(2));
        assert_ne!(a, b, "seeds produced identical melodies");
    }

    #[test]
    fn every_note_is_in_the_key() {
        for seed in 1..20 {
            for note in generate(&options(seed)) {
                assert!(
                    is_in_scale(note.pitch, 9, Scale::NaturalMinor),
                    "out of key: {} (seed {seed})",
                    note.pitch
                );
            }
        }
    }

    #[test]
    fn the_line_fits_the_requested_length() {
        let notes = generate(&options(3));
        assert_eq!(notes.len(), Rhythm::Straight.onsets().len() * 2);
        assert!(notes.iter().all(|n| n.start < 32.0));
        assert!(notes.iter().all(|n| n.start >= 0.0 && n.len > 0.0));
    }

    #[test]
    fn the_melody_starts_and_ends_on_chord_tones() {
        let notes = generate(&options(11));
        let first = degree_index(Scale::NaturalMinor, notes[0].pitch, 9);
        assert!(
            matches!(first, Some(0) | Some(2) | Some(4)),
            "start: {first:?}"
        );
        let last = notes.last().unwrap();
        let end = degree_index(Scale::NaturalMinor, last.pitch, 9);
        assert!(matches!(end, Some(0) | Some(2) | Some(4)), "end: {end:?}");
    }

    #[test]
    fn velocities_are_musical_and_bounded() {
        for note in generate(&options(5)) {
            assert!((0.6..=1.0).contains(&note.vel), "velocity: {}", note.vel);
        }
    }

    #[test]
    fn sparse_rhythms_produce_fewer_notes() {
        let mut long = options(4);
        long.rhythm = Rhythm::Long;
        let mut sync = options(4);
        sync.rhythm = Rhythm::Syncopated;
        assert!(generate(&long).len() < generate(&sync).len());
    }

    #[test]
    fn the_contour_stays_within_a_reasonable_range() {
        let notes = generate(&options(9));
        let highest = notes.iter().map(|n| n.pitch).max().unwrap();
        let lowest = notes.iter().map(|n| n.pitch).min().unwrap();
        assert!(
            highest as i32 - lowest as i32 <= 24,
            "melody spans {} semitones",
            highest as i32 - lowest as i32
        );
    }
}
