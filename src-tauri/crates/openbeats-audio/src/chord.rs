//! Chord detection for the piano roll, in Rust.
//!
//! Given the pitches sounding at the playhead (or the notes under the cursor)
//! it returns the best chord name. The React piano roll uses the same template
//! table for its label so the two never disagree.

use serde::{Deserialize, Serialize};

use crate::piano_tools::ToolNote;

const NOTE_NAMES: [&str; 12] = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

/// Chord template: semitone offsets from the root.
const TEMPLATES: [(&str, &[u8]); 9] = [
    ("", &[0, 4, 7]),
    ("m", &[0, 3, 7]),
    ("7", &[0, 4, 7, 10]),
    ("maj7", &[0, 4, 7, 11]),
    ("m7", &[0, 3, 7, 10]),
    ("dim", &[0, 3, 6]),
    ("aug", &[0, 4, 8]),
    ("sus2", &[0, 2, 7]),
    ("sus4", &[0, 5, 7]),
];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Chord {
    /// e.g. "Am", "C#dim", "Fmaj7".
    pub name: String,
    /// Root pitch class 0..11.
    pub root: u8,
    /// Template suffix, "" for a major triad.
    pub quality: String,
    /// Name of the lowest sounding note.
    pub bass: String,
}

/// Detects the chord from MIDI pitches. Returns `None` for fewer than two
/// distinct pitch classes, which is not enough to name a chord.
pub fn chord_for(pitches: &[u8]) -> Option<Chord> {
    if pitches.is_empty() {
        return None;
    }
    let mut classes: Vec<u8> = pitches.iter().map(|p| p % 12).collect();
    classes.sort_unstable();
    classes.dedup();
    if classes.len() < 2 {
        return None;
    }

    let lowest = *pitches.iter().min().unwrap();
    let bass = NOTE_NAMES[(lowest % 12) as usize].to_string();

    // Try every pitch class as the root; prefer the template that explains the
    // most notes, then the root that is actually present lowest in the voicing.
    let mut best: Option<(usize, u8, &str, usize)> = None;
    for root in 0..12u8 {
        for (suffix, template) in TEMPLATES {
            let matches = template
                .iter()
                .all(|offset| classes.contains(&((root + offset) % 12)));
            if !matches {
                continue;
            }
            // Score: template size must equal the played classes to avoid
            // calling a full triad "C" when a seventh is present.
            if template.len() != classes.len() {
                continue;
            }
            let root_present = classes.contains(&root);
            let score =
                template.len() * 2 + usize::from(root_present) + usize::from(root == lowest % 12);
            if best.map(|(s, _, _, _)| score > s).unwrap_or(true) {
                best = Some((score, root, suffix, template.len()));
            }
        }
    }

    // Fall back to an exact-interval match that ignores extra notes.
    let (root, suffix) = match best {
        Some((_, root, suffix, _)) => (root, suffix),
        None => {
            let mut found = None;
            'outer: for root in 0..12u8 {
                for (suffix, template) in TEMPLATES {
                    if template
                        .iter()
                        .all(|offset| classes.contains(&((root + offset) % 12)))
                    {
                        found = Some((root, suffix));
                        break 'outer;
                    }
                }
            }
            found?
        }
    };

    Some(Chord {
        name: format!("{}{}", NOTE_NAMES[root as usize], suffix),
        root,
        quality: suffix.to_string(),
        bass,
    })
}

/// Diatonic triads of a key, as the chord panel suggests them.
///
/// Major: I ii iii IV V vi vii° — Minor: i ii° III iv v VI VII.
pub fn suggest_progression(root: u8, minor: bool) -> Vec<String> {
    let root = root % 12;
    let (steps, qualities): ([u8; 7], [&str; 7]) = if minor {
        ([0, 2, 3, 5, 7, 8, 10], ["m", "dim", "", "m", "m", "", ""])
    } else {
        ([0, 2, 4, 5, 7, 9, 11], ["", "m", "m", "", "", "m", "dim"])
    };
    steps
        .iter()
        .zip(qualities.iter())
        .map(|(offset, quality)| {
            format!("{}{}", NOTE_NAMES[((root + offset) % 12) as usize], quality)
        })
        .collect()
}

/// Convenience for the UI: notes with a start/length window, returning the
/// pitches that overlap `step`.
pub fn pitches_at(notes: &[(u8, f32, f32)], step: f32) -> Vec<u8> {
    notes
        .iter()
        .filter(|(_, start, len)| step >= *start && step < start + len)
        .map(|(pitch, _, _)| *pitch)
        .collect()
}

/// The interval template for a chord suffix (`""`, `"m"`, `"7"`, ...).
pub fn template_for(quality: &str) -> Option<&'static [u8]> {
    TEMPLATES
        .iter()
        .find(|(suffix, _)| *suffix == quality)
        .map(|(_, template)| *template)
}

/// Chord Stamp: the notes of a chord, ready to write into a pattern.
///
/// `octave` 4 puts a C-rooted chord at MIDI 60. Inversions rotate the lowest
/// note up an octave, and pitches outside 0..=127 are dropped.
#[allow(clippy::too_many_arguments)]
pub fn chord_stamp(
    root: u8,
    quality: &str,
    inversion: u8,
    octave: u8,
    start: f32,
    len: f32,
    vel: f32,
) -> Vec<ToolNote> {
    let Some(template) = template_for(quality) else {
        return Vec::new();
    };
    let base = 12 * (octave as i32 + 1) + root as i32;
    let mut pitches: Vec<i32> = template
        .iter()
        .map(|offset| base + *offset as i32)
        .collect();
    let inversion = (inversion as usize) % pitches.len().max(1);
    for _ in 0..inversion {
        if let Some(first) = pitches.first().copied() {
            pitches.remove(0);
            pitches.push(first + 12);
        }
    }
    pitches
        .into_iter()
        .filter(|pitch| (0..=127).contains(pitch))
        .map(|pitch| ToolNote::new(pitch as u8, start, len, vel))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn major_triad() {
        let chord = chord_for(&[60, 64, 67]).unwrap();
        assert_eq!(chord.name, "C");
        assert_eq!(chord.bass, "C");
    }

    #[test]
    fn minor_triad_with_bass_note() {
        let chord = chord_for(&[57, 60, 64]).unwrap();
        assert_eq!(chord.name, "Am");
        assert_eq!(chord.bass, "A");
    }

    #[test]
    fn seventh_chords_are_not_reported_as_triads() {
        assert_eq!(chord_for(&[60, 64, 67, 71]).unwrap().name, "Cmaj7");
        assert_eq!(chord_for(&[62, 65, 69, 72]).unwrap().name, "Dm7");
    }

    #[test]
    fn inversions_keep_the_root_name_and_report_the_bass() {
        let chord = chord_for(&[64, 67, 72]).unwrap();
        assert_eq!(chord.name, "C");
        assert_eq!(chord.bass, "E");
    }

    #[test]
    fn single_note_and_empty_are_not_chords() {
        assert!(chord_for(&[]).is_none());
        assert!(chord_for(&[60]).is_none());
        assert!(chord_for(&[60, 72]).is_none(), "octave is one pitch class");
    }

    #[test]
    fn pitches_at_filters_by_window() {
        let notes = [(60u8, 0.0f32, 2.0f32), (64, 1.0, 2.0), (67, 8.0, 1.0)];
        assert_eq!(pitches_at(&notes, 1.5), vec![60, 64]);
        // Note ends are exclusive: a note at 8.0 with length 1.0 is over at 9.0.
        assert_eq!(pitches_at(&notes, 8.5), vec![67]);
        assert!(pitches_at(&notes, 9.0).is_empty());
        assert!(pitches_at(&notes, 5.0).is_empty());
    }
}
