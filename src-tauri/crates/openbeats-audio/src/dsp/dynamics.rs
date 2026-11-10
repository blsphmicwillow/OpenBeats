//! Compressor and limiter, ported from the `comp` and `limiter` inserts in
//! `src/audio/effects.ts`.
//!
//! The JavaScript versions rely on Web Audio's `DynamicsCompressorNode`. These
//! are explicit implementations so the behaviour is identical in the native
//! engine and testable without a browser.

use crate::{db_to_gain, gain_to_db};

use super::{clamp, one_pole};

/// Feed-forward compressor with a soft knee.
#[derive(Clone, Copy, Debug)]
pub struct Compressor {
    sample_rate: f32,
    threshold_db: f32,
    ratio: f32,
    attack_sec: f32,
    release_sec: f32,
    knee_db: f32,
    make_up_db: f32,
    attack_coef: f32,
    release_coef: f32,
    envelope: f32,
    gain: f32,
}

impl Compressor {
    pub fn new(sample_rate: f32) -> Self {
        let mut c = Self {
            sample_rate,
            threshold_db: -20.0,
            ratio: 4.0,
            attack_sec: 0.005,
            release_sec: 0.15,
            knee_db: 6.0,
            make_up_db: 0.0,
            attack_coef: 0.0,
            release_coef: 0.0,
            envelope: 0.0,
            gain: 1.0,
        };
        c.recompute();
        c
    }

    /// `attack` and `release` are the 0..1 control values used by the UI, mapped
    /// the same way the Web Audio insert maps them.
    pub fn set_params(
        &mut self,
        threshold_db: f32,
        ratio: f32,
        attack: f32,
        release: f32,
        knee_db: f32,
        make_up_db: f32,
    ) {
        self.threshold_db = threshold_db;
        self.ratio = ratio.max(1.0);
        self.attack_sec = 0.001 + attack.clamp(0.0, 1.0) * 0.3;
        self.release_sec = 0.02 + release.clamp(0.0, 1.0) * 0.8;
        self.knee_db = knee_db.max(0.0);
        self.make_up_db = make_up_db;
        self.recompute();
    }

    fn recompute(&mut self) {
        self.attack_coef = one_pole(self.sample_rate, self.attack_sec);
        self.release_coef = one_pole(self.sample_rate, self.release_sec);
    }

    /// Gain reduction in dB for a detector level in dB (negative or zero).
    fn reduction_db(&self, level_db: f32) -> f32 {
        let over = level_db - self.threshold_db;
        let knee = self.knee_db;
        if knee > 0.0 && over > -knee / 2.0 && over < knee / 2.0 {
            // Quadratic soft knee.
            let x = over + knee / 2.0;
            (1.0 / self.ratio - 1.0) * x * x / (2.0 * knee)
        } else if over > 0.0 {
            over * (1.0 / self.ratio - 1.0)
        } else {
            0.0
        }
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        let rectified = x.abs();
        let coef = if rectified > self.envelope {
            self.attack_coef
        } else {
            self.release_coef
        };
        self.envelope = coef * self.envelope + (1.0 - coef) * rectified;

        let target = db_to_gain(self.reduction_db(gain_to_db(self.envelope)));
        // Smooth the gain itself so the knee does not chatter.
        self.gain = self.release_coef * self.gain + (1.0 - self.release_coef) * target;

        let out = x * self.gain * db_to_gain(self.make_up_db);
        if out.is_finite() {
            clamp(out, -8.0, 8.0)
        } else {
            0.0
        }
    }

    pub fn reset(&mut self) {
        self.envelope = 0.0;
        self.gain = 1.0;
    }

    pub fn gain_reduction_db(&self) -> f32 {
        gain_to_db(self.gain)
    }
}

/// Peak limiter with a hard ceiling guarantee.
#[derive(Clone, Copy, Debug)]
pub struct Limiter {
    sample_rate: f32,
    ceiling: f32,
    ceiling_db: f32,
    release_sec: f32,
    envelope: f32,
    gain: f32,
}

impl Limiter {
    pub fn new(sample_rate: f32) -> Self {
        let mut l = Self {
            sample_rate,
            ceiling: 1.0,
            ceiling_db: 0.0,
            release_sec: 0.25,
            envelope: 0.0,
            gain: 1.0,
        };
        l.set_params(-1.0, 0.25);
        l
    }

    /// `release` is the 0..1 UI control, mapped like the Web Audio insert.
    pub fn set_params(&mut self, ceiling_db: f32, release: f32) {
        self.ceiling_db = ceiling_db;
        self.ceiling = db_to_gain(clamp(ceiling_db, -60.0, 0.0));
        self.release_sec = 0.02 + release.clamp(0.0, 1.0) * 0.5;
    }

    /// Instant attack, exponential release: the ceiling is never exceeded.
    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        let rectified = x.abs();
        if rectified > self.envelope {
            self.envelope = rectified;
        } else {
            let coef = one_pole(self.sample_rate, self.release_sec);
            self.envelope = coef * self.envelope + (1.0 - coef) * rectified;
        }

        let target = if self.envelope > self.ceiling {
            self.ceiling / self.envelope
        } else {
            1.0
        };
        // Instant gain reduction, released smoothly.
        if target < self.gain {
            self.gain = target;
        } else {
            let coef = one_pole(self.sample_rate, self.release_sec);
            self.gain = coef * self.gain + (1.0 - coef) * target;
        }

        clamp(x * self.gain, -self.ceiling, self.ceiling)
    }

    pub fn reset(&mut self) {
        self.envelope = 0.0;
        self.gain = 1.0;
    }

    pub fn ceiling_db(&self) -> f32 {
        self.ceiling_db
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    #[test]
    fn compressor_reduces_gain_above_threshold() {
        let mut comp = Compressor::new(SR);
        comp.set_params(-18.0, 8.0, 0.1, 0.2, 0.0, 0.0);
        let input_peak = 0.9f32;
        let step = 2.0 * std::f32::consts::PI * 200.0 / SR;
        let mut phase = 0.0f32;
        let mut peak = 0.0f32;
        for i in 0..48_000 {
            phase += step;
            let y = comp.process(phase.sin() * input_peak);
            if i > 24_000 {
                peak = peak.max(y.abs());
            }
        }
        assert!(peak < input_peak * 0.8, "compressor did not reduce: {peak}");
        assert!(comp.gain_reduction_db() < -1.0);
    }

    #[test]
    fn compressor_leaves_quiet_signal_alone() {
        let mut comp = Compressor::new(SR);
        comp.set_params(-12.0, 4.0, 0.05, 0.2, 0.0, 0.0);
        let mut peak = 0.0f32;
        for _ in 0..48_000 {
            peak = peak.max(comp.process(0.01).abs());
        }
        assert!(peak <= 0.011, "quiet signal was compressed: {peak}");
    }

    #[test]
    fn limiter_never_exceeds_ceiling() {
        let mut lim = Limiter::new(SR);
        lim.set_params(-1.0, 0.3);
        let ceiling = db_to_gain(-1.0);
        let step = 2.0 * std::f32::consts::PI * 110.0 / SR;
        let mut phase = 0.0f32;
        for i in 0..96_000 {
            phase += step;
            let hot = phase.sin() * 4.0;
            let out = lim.process(hot);
            assert!(
                out.abs() <= ceiling + 1e-6,
                "ceiling exceeded at {i}: {out}"
            );
        }
    }

    #[test]
    fn limiter_is_transparent_below_ceiling() {
        let mut lim = Limiter::new(SR);
        lim.set_params(0.0, 0.5);
        let mut peak = 0.0f32;
        for _ in 0..4_800 {
            peak = peak.max(lim.process(0.2).abs());
        }
        assert!(
            (peak - 0.2).abs() < 1e-5,
            "limiter coloured a quiet signal: {peak}"
        );
    }
}
