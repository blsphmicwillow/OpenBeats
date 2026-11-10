//! Workflow helpers: groove humanising, automatic gain staging, tap tempo and a
//! project health scan.
//!
//! All of these are deterministic: the same project and the same groove always
//! produce the same result, so an edit can be undone and repeated exactly.

use serde::{Deserialize, Serialize};

use crate::piano_tools::ToolNote;

/// A 16-step groove: timing offset in steps and a velocity multiplier.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct Groove {
    pub name: String,
    /// Per-16th timing offset in steps (positive = late).
    pub timing: Vec<f32>,
    /// Per-16th velocity multiplier.
    pub velocity: Vec<f32>,
}

impl Groove {
    pub fn straight() -> Self {
        Self {
            name: "Straight".into(),
            timing: vec![0.0; 16],
            velocity: vec![1.0; 16],
        }
    }

    /// Behind the beat, softer off-beats: the classic laid-back feel.
    pub fn laid_back() -> Self {
        let mut timing = vec![0.0; 16];
        let mut velocity = vec![1.0; 16];
        for step in 0..16 {
            timing[step] = if step % 4 == 0 { 0.0 } else { 0.03 };
            velocity[step] = if step % 2 == 0 { 1.0 } else { 0.82 };
        }
        Self {
            name: "Laid back".into(),
            timing,
            velocity,
        }
    }

    /// Pushed ahead with accented off-beats.
    pub fn pushed() -> Self {
        let mut timing = vec![0.0; 16];
        let mut velocity = vec![1.0; 16];
        for step in 0..16 {
            timing[step] = if step % 4 == 0 { 0.0 } else { -0.02 };
            velocity[step] = if step % 4 == 2 { 1.08 } else { 1.0 };
        }
        Self {
            name: "Pushed".into(),
            timing,
            velocity,
        }
    }

    /// Triplet-style shuffle: every second 16th is late.
    pub fn shuffle() -> Self {
        let mut timing = vec![0.0; 16];
        let mut velocity = vec![1.0; 16];
        for step in 0..16 {
            timing[step] = if step % 2 == 1 { 0.06 } else { 0.0 };
            velocity[step] = if step % 2 == 1 { 0.9 } else { 1.0 };
        }
        Self {
            name: "Shuffle".into(),
            timing,
            velocity,
        }
    }

    fn at(&self, step: usize) -> (f32, f32) {
        let index = step % 16;
        (
            *self.timing.get(index).unwrap_or(&0.0),
            *self.velocity.get(index).unwrap_or(&1.0),
        )
    }
}

fn hash(mut x: u32) -> u32 {
    x ^= x >> 16;
    x = x.wrapping_mul(0x7feb_352d);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846c_a68b);
    x ^ (x >> 16)
}

/// Applies a groove to notes.
///
/// `amount` scales the timing offset (0 = no timing change, 1 = the groove as
/// written). The tiny per-note variation comes from a hash of the note, not from
/// a random number generator, so the result is reproducible.
pub fn humanize(notes: &[ToolNote], groove: &Groove, amount: f32) -> Vec<ToolNote> {
    let amount = amount.clamp(0.0, 2.0);
    notes
        .iter()
        .enumerate()
        .map(|(index, note)| {
            let step = note.start.round().max(0.0) as usize;
            let (timing, velocity) = groove.at(step);
            let jitter = (hash(index as u32 ^ (note.pitch as u32) << 8) % 1000) as f32 / 1000.0;
            let jitter = (jitter - 0.5) * 0.02; // ±0.01 steps, below a 64th
            ToolNote {
                start: (note.start + timing * amount + jitter * amount).max(0.0),
                vel: (note.vel * (1.0 + (velocity - 1.0) * amount)).clamp(0.0, 1.0),
                ..*note
            }
        })
        .collect()
}

/// Headroom used by automatic gain staging.
pub const DEFAULT_HEADROOM_DB: f32 = -6.0;

/// Fader gains that put each source peak at `headroom_db`, leaving room for the
/// mix to sum without clipping.
pub fn auto_gain_staging(peaks: &[f32], headroom_db: f32) -> Vec<f32> {
    let target = 10f32.powf(headroom_db.min(0.0) / 20.0);
    peaks
        .iter()
        .map(|peak| {
            let peak = peak.abs();
            if peak <= 1e-6 {
                1.0
            } else {
                (target / peak).clamp(0.0, 8.0)
            }
        })
        .collect()
}

/// Tempo from tap times in milliseconds.
///
/// Uses the median interval so one missed or doubled tap does not derail the
/// result, and ignores intervals outside a musical range.
pub fn tap_tempo(taps_ms: &[u64]) -> Option<f32> {
    if taps_ms.len() < 2 {
        return None;
    }
    let mut intervals: Vec<f32> = taps_ms
        .windows(2)
        .map(|pair| pair[1].saturating_sub(pair[0]) as f32)
        .filter(|ms| {
            let bpm = 60_000.0 / ms.max(1.0);
            (20.0..=300.0).contains(&bpm)
        })
        .collect();
    if intervals.is_empty() {
        return None;
    }
    intervals.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median = intervals[intervals.len() / 2];
    Some((60_000.0 / median).clamp(20.0, 300.0))
}

/// One problem found by the health scan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HealthIssue {
    /// Machine-readable kind, e.g. `clipping`.
    pub kind: String,
    /// Human-readable explanation.
    pub detail: String,
}

/// Scans the numbers the project already exposes and reports problems.
#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize)]
pub struct ProjectHealth {
    #[serde(default)]
    pub peak: f32,
    #[serde(default)]
    pub channel_count: usize,
    #[serde(default)]
    pub used_channels: usize,
    #[serde(default)]
    pub missing_samples: usize,
    #[serde(default)]
    pub high_cpu_plugins: usize,
    #[serde(default)]
    pub unloaded_channels: usize,
}

/// Reports clipping, unused channels, missing samples and heavy plugins.
pub fn health_check(project: &ProjectHealth) -> Vec<HealthIssue> {
    let mut issues = Vec::new();
    if project.peak >= 1.0 {
        issues.push(HealthIssue {
            kind: "clipping".into(),
            detail: format!(
                "The master peaks at {:.1} dBFS. Lower the master or stage the channels.",
                20.0 * project.peak.max(1e-9).log10()
            ),
        });
    }
    if project.missing_samples > 0 {
        issues.push(HealthIssue {
            kind: "missing_samples".into(),
            detail: format!(
                "{} sample(s) could not be found. Re-link or replace them before exporting.",
                project.missing_samples
            ),
        });
    }
    if project.high_cpu_plugins > 0 {
        issues.push(HealthIssue {
            kind: "high_cpu".into(),
            detail: format!(
                "{} plugin(s) are reporting high CPU. Freeze or bypass them if playback stutters.",
                project.high_cpu_plugins
            ),
        });
    }
    let unused = project.channel_count.saturating_sub(project.used_channels);
    if unused > 0 {
        issues.push(HealthIssue {
            kind: "unused_channels".into(),
            detail: format!("{unused} channel(s) have no notes. Delete them to save CPU."),
        });
    }
    if project.unloaded_channels > 0 {
        issues.push(HealthIssue {
            kind: "unloaded_channels".into(),
            detail: format!(
                "{} channel(s) are unloaded and will stay silent.",
                project.unloaded_channels
            ),
        });
    }
    issues
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notes() -> Vec<ToolNote> {
        vec![
            ToolNote::new(60, 0.0, 1.0, 1.0),
            ToolNote::new(62, 1.0, 1.0, 1.0),
            ToolNote::new(64, 2.0, 1.0, 1.0),
            ToolNote::new(65, 4.0, 1.0, 1.0),
        ]
    }

    #[test]
    fn humanize_is_deterministic() {
        let a = humanize(&notes(), &Groove::laid_back(), 1.0);
        let b = humanize(&notes(), &Groove::laid_back(), 1.0);
        assert_eq!(a, b, "humanize is not reproducible");
    }

    #[test]
    fn a_straight_groove_at_zero_amount_changes_nothing() {
        let out = humanize(&notes(), &Groove::straight(), 0.0);
        assert_eq!(out, notes());
    }

    #[test]
    fn groove_timing_moves_off_beats_later() {
        let out = humanize(&notes(), &Groove::laid_back(), 1.0);
        // Step 1 is an off-beat: it should land late, within the jitter bound.
        let off = out.iter().find(|n| n.pitch == 62).unwrap();
        assert!(off.start > 1.0, "off-beat was not delayed: {}", off.start);
        assert!(off.start < 1.05, "delay was too large: {}", off.start);
        // Step 4 is on a beat: only the small jitter applies.
        let on = out.iter().find(|n| n.pitch == 65).unwrap();
        assert!(
            (on.start - 4.0).abs() <= 0.011,
            "downbeat moved: {}",
            on.start
        );
    }

    #[test]
    fn humanize_keeps_velocities_in_range() {
        let out = humanize(&notes(), &Groove::pushed(), 2.0);
        assert!(out.iter().all(|n| (0.0..=1.0).contains(&n.vel)));
    }

    #[test]
    fn auto_gain_staging_leaves_six_db_of_headroom() {
        let gains = auto_gain_staging(&[1.0, 0.5, 0.0], DEFAULT_HEADROOM_DB);
        assert!((gains[0] - 0.501).abs() < 0.01, "gain was {}", gains[0]);
        // A source already at -6 dBFS needs no change.
        assert!((gains[1] - 1.0).abs() < 0.01, "gain was {}", gains[1]);
        assert_eq!(gains[2], 1.0, "silence should not be boosted");
    }

    #[test]
    fn auto_gain_boosts_quiet_sources() {
        let gains = auto_gain_staging(&[0.25], -6.0);
        assert!(gains[0] > 1.5, "quiet source was not boosted: {}", gains[0]);
    }

    #[test]
    fn tap_tempo_reads_a_steady_click() {
        let bpm = tap_tempo(&[0, 500, 1000, 1500]).unwrap();
        assert!((bpm - 120.0).abs() < 0.5, "got {bpm}");
    }

    #[test]
    fn tap_tempo_ignores_a_missed_tap() {
        // One 1000 ms gap should not drag the median away from 500 ms.
        let bpm = tap_tempo(&[0, 500, 1000, 2000, 2500]).unwrap();
        assert!((bpm - 120.0).abs() < 0.5, "got {bpm}");
    }

    #[test]
    fn tap_tempo_needs_two_taps() {
        assert_eq!(tap_tempo(&[100]), None);
        assert_eq!(tap_tempo(&[]), None);
    }

    #[test]
    fn health_check_reports_every_problem() {
        let issues = health_check(&ProjectHealth {
            peak: 1.2,
            channel_count: 10,
            used_channels: 7,
            missing_samples: 2,
            high_cpu_plugins: 1,
            unloaded_channels: 1,
        });
        let kinds: Vec<&str> = issues.iter().map(|i| i.kind.as_str()).collect();
        for expected in [
            "clipping",
            "missing_samples",
            "high_cpu",
            "unused_channels",
            "unloaded_channels",
        ] {
            assert!(kinds.contains(&expected), "missing {expected}: {kinds:?}");
        }
    }

    #[test]
    fn a_healthy_project_reports_nothing() {
        let issues = health_check(&ProjectHealth {
            peak: 0.8,
            channel_count: 4,
            used_channels: 4,
            missing_samples: 0,
            high_cpu_plugins: 0,
            unloaded_channels: 0,
        });
        assert!(issues.is_empty(), "unexpected issues: {issues:?}");
    }
}
