//! Per-strip insert chain and gain automation.
//!
//! These processors run inside the CPAL callback and never allocate. The
//! master EQ -> compressor -> limiter chain remains separate and unchanged.

use serde::{Deserialize, Serialize};

use crate::automation::AutomationLane;
use crate::dsp::{Compressor, Eq3, TruePeakLimiter};

/// One insert on a channel strip.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Insert {
    Gain {
        gain_db: f32,
    },
    Eq3 {
        low_db: f32,
        mid_db: f32,
        high_db: f32,
        mid_hz: f32,
    },
    Compressor {
        threshold_db: f32,
        ratio: f32,
        attack: f32,
        release: f32,
        knee_db: f32,
        makeup_db: f32,
    },
    Limiter {
        ceiling_db: f32,
        attack_ms: f32,
        release_ms: f32,
    },
    Lowpass {
        cutoff_hz: f32,
    },
    Highpass {
        cutoff_hz: f32,
    },
    Drive {
        amount: f32,
    },
}

impl Insert {
    pub fn gain(gain_db: f32) -> Self {
        Self::Gain { gain_db }
    }
}

enum Stage {
    Gain(f32),
    Eq3([Eq3; 2]),
    Compressor([Compressor; 2]),
    Limiter(TruePeakLimiter),
    Lowpass { state: [f32; 2], coef: f32 },
    Highpass { state: [f32; 2], coef: f32 },
    Drive(f32),
}

/// A channel strip's insert chain. Empty chains pass audio through.
pub struct StripProcessor {
    stages: Vec<Stage>,
}

impl StripProcessor {
    pub fn new(sample_rate: f32, inserts: &[Insert]) -> Self {
        let stages = inserts
            .iter()
            .map(|insert| match *insert {
                Insert::Gain { gain_db } => Stage::Gain(10f32.powf(gain_db / 20.0)),
                Insert::Eq3 {
                    low_db,
                    mid_db,
                    high_db,
                    mid_hz,
                } => {
                    let mut eq = [Eq3::new(sample_rate); 2];
                    for band in &mut eq {
                        band.set_params(low_db, mid_db, high_db, mid_hz);
                    }
                    Stage::Eq3(eq)
                }
                Insert::Compressor {
                    threshold_db,
                    ratio,
                    attack,
                    release,
                    knee_db,
                    makeup_db,
                } => {
                    let mut compressor = [Compressor::new(sample_rate); 2];
                    for comp in &mut compressor {
                        comp.set_params(threshold_db, ratio, attack, release, knee_db, makeup_db);
                    }
                    Stage::Compressor(compressor)
                }
                Insert::Limiter {
                    ceiling_db,
                    attack_ms,
                    release_ms,
                } => {
                    let mut limiter = TruePeakLimiter::new(sample_rate);
                    limiter.set_params(ceiling_db, attack_ms, release_ms);
                    Stage::Limiter(limiter)
                }
                Insert::Lowpass { cutoff_hz } => Stage::Lowpass {
                    state: [0.0; 2],
                    coef: one_pole(sample_rate, cutoff_hz),
                },
                Insert::Highpass { cutoff_hz } => Stage::Highpass {
                    state: [0.0; 2],
                    coef: one_pole(sample_rate, cutoff_hz),
                },
                Insert::Drive { amount } => Stage::Drive(1.0 + amount.max(0.0) * 12.0),
            })
            .collect();
        Self { stages }
    }

    pub fn is_empty(&self) -> bool {
        self.stages.is_empty()
    }

    pub fn process(&mut self, mut left: f32, mut right: f32) -> (f32, f32) {
        for stage in &mut self.stages {
            match stage {
                Stage::Gain(gain) => {
                    left *= *gain;
                    right *= *gain;
                }
                Stage::Eq3(eq) => {
                    left = eq[0].process(left);
                    right = eq[1].process(right);
                }
                Stage::Compressor(comp) => {
                    left = comp[0].process(left);
                    right = comp[1].process(right);
                }
                Stage::Limiter(limiter) => {
                    (left, right) = limiter.process(left, right);
                }
                Stage::Lowpass { state, coef } => {
                    state[0] = left * (1.0 - *coef) + state[0] * *coef;
                    state[1] = right * (1.0 - *coef) + state[1] * *coef;
                    left = state[0];
                    right = state[1];
                }
                Stage::Highpass { state, coef } => {
                    state[0] = left * (1.0 - *coef) + state[0] * *coef;
                    state[1] = right * (1.0 - *coef) + state[1] * *coef;
                    left -= state[0];
                    right -= state[1];
                }
                Stage::Drive(drive) => {
                    let norm = drive.tanh().max(1e-6);
                    left = (left * *drive).tanh() / norm;
                    right = (right * *drive).tanh() / norm;
                }
            }
        }
        (left, right)
    }
}

fn one_pole(sample_rate: f32, cutoff_hz: f32) -> f32 {
    let cutoff = cutoff_hz.clamp(10.0, sample_rate.max(1.0) * 0.45);
    (-2.0 * std::f32::consts::PI * cutoff / sample_rate.max(1.0)).exp()
}

/// Gain from the first volume lane, or unity when the strip is not automated.
pub fn gain_at(lanes: &[AutomationLane], time: f32) -> f32 {
    lanes
        .iter()
        .find(|lane| lane.target == "gain" || lane.target.ends_with(":gain"))
        .map(|lane| lane.value_at(time).max(0.0))
        .unwrap_or(1.0)
}

/// Mixes already-rendered strip frames through their insert chains and gains.
/// Used by tests and as the single-strip reference path.
pub fn mix_strip_frames(
    frames: &[(f32, f32)],
    processors: &mut [StripProcessor],
    gains: &[f32],
) -> (f32, f32) {
    let mut left = 0.0;
    let mut right = 0.0;
    for (index, frame) in frames.iter().enumerate() {
        let gain = gains.get(index).copied().unwrap_or(1.0).max(0.0);
        let (l, r) = match processors.get_mut(index) {
            Some(processor) => processor.process(frame.0 * gain, frame.1 * gain),
            None => (frame.0 * gain, frame.1 * gain),
        };
        left += l;
        right += r;
    }
    (left, right)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_minus_six_db_insert_halves_only_its_strip() {
        let mut processors = [
            StripProcessor::new(48_000.0, &[Insert::gain(-6.020_6)]),
            StripProcessor::new(48_000.0, &[]),
        ];
        let frames = [(1.0, 1.0), (1.0, 1.0)];
        let (left, right) = mix_strip_frames(&frames, &mut processors, &[1.0, 1.0]);
        assert!((left - 1.5).abs() < 1e-5, "left was {left}");
        assert!((right - 1.5).abs() < 1e-5, "right was {right}");

        let (only_insert, _) = mix_strip_frames(&frames[..1], &mut processors[..1], &[1.0]);
        assert!((only_insert - 0.5).abs() < 1e-5, "insert was {only_insert}");
    }

    #[test]
    fn an_empty_strip_is_transparent() {
        let mut processor = StripProcessor::new(48_000.0, &[]);
        assert_eq!(processor.process(0.25, -0.25), (0.25, -0.25));
        assert!(processor.is_empty());
    }

    #[test]
    fn a_volume_lane_ramps_the_strip_gain() {
        let lane = AutomationLane::new("channel:kick:gain", 0.0, 1.0).with_points(vec![
            crate::automation::AutomationPoint::new(0.0, 0.0),
            crate::automation::AutomationPoint::new(8.0, 1.0),
        ]);
        assert!(gain_at(&[lane.clone()], 0.0).abs() < 1e-6);
        assert!((gain_at(&[lane.clone()], 4.0) - 0.5).abs() < 1e-6);
        assert!((gain_at(&[lane], 8.0) - 1.0).abs() < 1e-6);

        let mut processor = StripProcessor::new(48_000.0, &[]);
        let (early, _) =
            mix_strip_frames(&[(1.0, 1.0)], std::slice::from_mut(&mut processor), &[0.0]);
        assert_eq!(early, 0.0);
    }

    #[test]
    fn a_lowpass_insert_reduces_a_high_frequency_signal() {
        let mut processor = StripProcessor::new(48_000.0, &[Insert::Lowpass { cutoff_hz: 100.0 }]);
        let mut input = 1.0f32;
        let mut output = 0.0f32;
        for _ in 0..4_800 {
            input = -input;
            output = processor.process(input, input).0;
        }
        assert!(output.abs() < input.abs(), "lowpass did not attenuate");
    }
}
