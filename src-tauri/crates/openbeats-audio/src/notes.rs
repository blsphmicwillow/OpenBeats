//! Note naming, user key labels and clip normalisation helpers.
//!
//! Covers renaming notes in the piano roll (per-pitch labels) and normalising
//! clip gain individually or as a group.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

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

/// User-defined keyboard labels: a replacement name for any MIDI pitch.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct KeyLabels {
    #[serde(default)]
    labels: BTreeMap<u8, String>,
}

impl KeyLabels {
    pub fn new() -> Self {
        Self::default()
    }

    /// Renames a key. An empty label removes the override; returns whether the
    /// map changed.
    pub fn set(&mut self, pitch: u8, label: &str) -> bool {
        let trimmed = label.trim();
        if trimmed.is_empty() {
            return self.labels.remove(&pitch).is_some();
        }
        if self.labels.get(&pitch).map(String::as_str) == Some(trimmed) {
            return false;
        }
        self.labels.insert(pitch, trimmed.to_string());
        true
    }

    pub fn remove(&mut self, pitch: u8) -> bool {
        self.labels.remove(&pitch).is_some()
    }

    pub fn is_custom(&self, pitch: u8) -> bool {
        self.labels.contains_key(&pitch)
    }

    /// The label to show: the user's name, or the scientific default.
    pub fn label_for(&self, pitch: u8) -> String {
        display_name(pitch, self.labels.get(&pitch).map(String::as_str))
    }

    /// Labels for a set of pitches, in the order given.
    pub fn labelled(&self, pitches: &[u8]) -> Vec<(u8, String)> {
        pitches
            .iter()
            .map(|pitch| (*pitch, self.label_for(*pitch)))
            .collect()
    }

    /// Drops every override.
    pub fn reset(&mut self) {
        self.labels.clear();
    }

    pub fn len(&self) -> usize {
        self.labels.len()
    }

    pub fn is_empty(&self) -> bool {
        self.labels.is_empty()
    }
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

    #[test]
    fn key_labels_override_the_default_name() {
        let mut labels = KeyLabels::new();
        assert_eq!(labels.label_for(36), "C2");
        assert!(!labels.is_custom(36));
        assert!(labels.set(36, "Kick"));
        assert_eq!(labels.label_for(36), "Kick");
        assert!(labels.is_custom(36));
        assert_eq!(labels.label_for(37), "C#2");
    }

    #[test]
    fn setting_the_same_label_is_not_a_change() {
        let mut labels = KeyLabels::new();
        assert!(labels.set(60, "Lead"));
        assert!(!labels.set(60, "Lead"));
        assert!(
            !labels.set(60, "  Lead  "),
            "whitespace should not count as a change"
        );
    }

    #[test]
    fn an_empty_label_restores_the_default() {
        let mut labels = KeyLabels::new();
        labels.set(60, "Lead");
        assert!(labels.set(60, "   "));
        assert_eq!(labels.label_for(60), "C4");
        assert!(labels.is_empty());
    }

    #[test]
    fn removing_and_resetting_labels() {
        let mut labels = KeyLabels::new();
        labels.set(36, "Kick");
        labels.set(38, "Snare");
        assert_eq!(labels.len(), 2);
        assert!(labels.remove(36));
        assert!(!labels.remove(36));
        assert_eq!(labels.len(), 1);
        labels.reset();
        assert!(labels.is_empty());
        assert_eq!(labels.label_for(38), "D2");
    }

    #[test]
    fn labelled_keeps_the_requested_order() {
        let mut labels = KeyLabels::new();
        labels.set(38, "Snare");
        let out = labels.labelled(&[38, 36]);
        assert_eq!(out[0], (38, "Snare".to_string()));
        assert_eq!(out[1], (36, "C2".to_string()));
    }
}
