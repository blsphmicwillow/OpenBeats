//! Note naming and clip normalisation helpers.
//!
//! Covers two workflow features from the FL Studio changelog: renaming notes in
//! the piano roll, and normalising clip gain individually or as a group.

/// Scientific pitch names, C0-based.
const NAMES: [&str; 12] = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

/// The default name for a MIDI pitch, e.g. 60 → "C4".
pub fn note_name(pitch: u8) -> String {
    let octave = (pitch as i32 / 12) - 1;
    format!("{}{}", NAMES[(pitch % 12) as usize], octave)
}

/// A user-supplied name for a pitch, or the default when there is none.
pub fn display_name(pitch: u8, custom: Option<&str>) -> String {
    match custom {
        Some(name) if !name.trim().is_empty() => name.trim().to_string(),
        _ => note_name(pitch),
    }
}

/// Names for a list of pitches, in the order given.
pub fn note_names(pitches: &[u8]) -> Vec<String> {
    pitches.iter().map(|p| note_name(*p)).collect()
}

/// Target peak used by clip normalisation (about -0.2 dBFS).
pub const NORMALIZE_TARGET: f32 = 0.98;

/// Gain multipliers that bring each clip to the target peak.
///
/// * `as_group == false` — every clip is normalised on its own.
/// * `as_group == true` — the loudest clip in the selection sets the scale, so
///   the relative balance of the selection is preserved.
pub fn normalize_gains(peaks: &[f32], as_group: bool) -> Vec<f32> {
    if peaks.is_empty() {
        return Vec::new();
    }
    if as_group {
        let loudest = peaks.iter().fold(0.0f32, |acc, peak| acc.max(peak.abs()));
        if loudest <= 1e-6 {
            return vec![1.0; peaks.len()];
        }
        let scale = NORMALIZE_TARGET / loudest;
        return peaks.iter().map(|_| scale).collect();
    }
    peaks
        .iter()
        .map(|peak| {
            let peak = peak.abs();
            if peak <= 1e-6 {
                1.0
            } else {
                NORMALIZE_TARGET / peak
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_middle_c_and_edges() {
        assert_eq!(note_name(60), "C4");
        assert_eq!(note_name(69), "A4");
        assert_eq!(note_name(0), "C-1");
        assert_eq!(note_name(127), "G9");
    }

    #[test]
    fn custom_names_win_over_defaults() {
        assert_eq!(display_name(36, Some("Boom")), "Boom");
        assert_eq!(display_name(36, Some("  ")), "C2");
        assert_eq!(display_name(36, None), "C2");
    }

    #[test]
    fn note_names_keeps_order() {
        assert_eq!(note_names(&[60, 62, 64]), vec!["C4", "D4", "E4"]);
    }

    #[test]
    fn individual_normalisation_brings_each_clip_to_target() {
        let gains = normalize_gains(&[0.49, 0.25, 0.98], false);
        for (gain, peak) in gains.iter().zip([0.49, 0.25, 0.98]) {
            assert!((gain * peak - NORMALIZE_TARGET).abs() < 1e-5);
        }
    }

    #[test]
    fn group_normalisation_preserves_relative_balance() {
        let peaks = [0.49, 0.245];
        let gains = normalize_gains(&peaks, true);
        assert!(
            (gains[0] - gains[1]).abs() < 1e-6,
            "group gains should match"
        );
        assert!((peaks[0] * gains[0] - NORMALIZE_TARGET).abs() < 1e-5);
        // The quieter clip stays half as loud.
        assert!((peaks[1] * gains[1] - NORMALIZE_TARGET / 2.0).abs() < 1e-5);
    }

    #[test]
    fn silence_is_left_alone() {
        assert_eq!(normalize_gains(&[0.0], false), vec![1.0]);
        assert_eq!(normalize_gains(&[], true).len(), 0);
    }
}
