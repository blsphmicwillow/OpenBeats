//! Transmitter — the FL Studio `Transient Processor` / envelope-splitter idea.
//!
//! A fast and a slow envelope follower are compared. Where the fast envelope
//! leads the slow one the sample is transient energy, the rest is sustain. The
//! two parts sum back to the input exactly, so routing them to separate mixer
//! tracks never changes the summed signal.

use super::{clamp, one_pole};

/// One frame's split, with the per-part gains already applied.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct TransmitterSplit {
    pub transient: f32,
    pub sustain: f32,
    /// 0..1 — how transient the current sample is.
    pub transient_amount: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct Transmitter {
    sample_rate: f32,
    fast_coef: f32,
    slow_coef: f32,
    fast_env: f32,
    slow_env: f32,
    /// Threshold below which the split is treated as silence (0..1).
    threshold: f32,
    sensitivity: f32,
    transient_gain: f32,
    sustain_gain: f32,
    /// How long a detected transient stays transient before release takes over.
    hold_sec: f32,
    hold_left: f32,
    hold_amount: f32,
    release_coef: f32,
}

impl Transmitter {
    pub fn new(sample_rate: f32) -> Self {
        let mut t = Self {
            sample_rate,
            fast_coef: 0.0,
            slow_coef: 0.0,
            fast_env: 0.0,
            slow_env: 0.0,
            threshold: 0.002,
            sensitivity: 1.0,
            transient_gain: 1.0,
            sustain_gain: 1.0,
            hold_sec: 0.0,
            hold_left: 0.0,
            hold_amount: 0.0,
            release_coef: one_pole(sample_rate, 0.05),
        };
        t.set_times(0.002, 0.08);
        t
    }

    /// Transient `hold` and `release` from the plugin's detection section.
    ///
    /// Hold keeps a detected hit in the transient path for `hold_sec`; release
    /// shortens or lengthens how quickly the detector returns to sustain.
    pub fn set_detection(&mut self, hold_sec: f32, release_sec: f32) {
        self.hold_sec = clamp(hold_sec, 0.0, 1.0);
        self.release_coef = one_pole(self.sample_rate, release_sec.clamp(0.001, 0.5));
    }

    /// Envelope follower times in seconds.
    pub fn set_times(&mut self, fast_sec: f32, slow_sec: f32) {
        self.fast_coef = one_pole(self.sample_rate, fast_sec.max(1e-4));
        self.slow_coef = one_pole(self.sample_rate, slow_sec.max(fast_sec.max(1e-4)));
    }

    /// `sensitivity` scales the transient share; gains are linear.
    pub fn set_params(
        &mut self,
        threshold: f32,
        sensitivity: f32,
        transient_gain: f32,
        sustain_gain: f32,
    ) {
        self.threshold = clamp(threshold, 0.0, 0.5);
        self.sensitivity = clamp(sensitivity, 0.0, 4.0);
        self.transient_gain = clamp(transient_gain, 0.0, 4.0);
        self.sustain_gain = clamp(sustain_gain, 0.0, 4.0);
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> TransmitterSplit {
        let rectified = x.abs();
        self.fast_env = self.fast_coef * self.fast_env + (1.0 - self.fast_coef) * rectified;
        self.slow_env = self.slow_coef * self.slow_env + (1.0 - self.slow_coef) * rectified;

        let amount = if self.slow_env <= self.threshold && self.fast_env <= self.threshold {
            // Silence: everything is sustain so nothing is invented.
            0.0
        } else {
            let lead = (self.fast_env - self.slow_env).max(0.0);
            let reference = self.slow_env.max(self.threshold).max(1e-6);
            clamp((lead / reference) * self.sensitivity, 0.0, 1.0)
        };

        // Hold: keep the last detected hit's amount for the hold time, then let
        // the release coefficient ease the detector back towards the raw value.
        if amount > 0.3 {
            self.hold_left = self.hold_sec;
            self.hold_amount = amount;
        } else if self.hold_left > 0.0 {
            self.hold_left = (self.hold_left - 1.0 / self.sample_rate).max(0.0);
        } else {
            self.hold_amount *= self.release_coef;
        }
        let amount = if self.hold_left > 0.0 {
            amount.max(self.hold_amount)
        } else {
            amount
        };

        // Split, then scale each part; the un-scaled parts sum to `x`.
        let transient = x * amount;
        let sustain = x - transient;

        TransmitterSplit {
            transient: transient * self.transient_gain,
            sustain: sustain * self.sustain_gain,
            transient_amount: amount,
        }
    }

    pub fn reset(&mut self) {
        self.fast_env = 0.0;
        self.slow_env = 0.0;
        self.hold_left = 0.0;
        self.hold_amount = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    #[test]
    fn parts_sum_to_input_with_unity_gains() {
        let mut tx = Transmitter::new(SR);
        tx.set_params(0.0, 1.0, 1.0, 1.0);
        let mut phase = 0.0f32;
        let step = 2.0 * std::f32::consts::PI * 220.0 / SR;
        for _ in 0..48_000 {
            phase += step;
            let x = phase.sin() * 0.6;
            let split = tx.process(x);
            assert!(
                (split.transient + split.sustain - x).abs() < 1e-6,
                "split did not reconstruct input"
            );
        }
    }

    #[test]
    fn percussive_attack_is_mostly_transient() {
        let mut tx = Transmitter::new(SR);
        tx.set_params(0.0, 1.5, 1.0, 1.0);
        // Impulse, then silence.
        let first = tx.process(0.9);
        assert!(
            first.transient_amount > 0.5,
            "attack not detected: {first:?}"
        );
        assert!(first.transient.abs() > first.sustain.abs());
    }

    #[test]
    fn steady_tone_becomes_sustain() {
        let mut tx = Transmitter::new(SR);
        tx.set_params(0.0, 1.0, 1.0, 1.0);
        let step = 2.0 * std::f32::consts::PI * 100.0 / SR;
        let mut phase = 0.0f32;
        let mut last = TransmitterSplit::default();
        for _ in 0..48_000 {
            phase += step;
            last = tx.process(phase.sin() * 0.5);
        }
        assert!(
            last.transient_amount < 0.2,
            "steady tone split as transient: {last:?}"
        );
    }

    #[test]
    fn hold_keeps_a_hit_in_the_transient_path() {
        let mut tx = Transmitter::new(SR);
        tx.set_params(0.0, 1.0, 1.0, 1.0);
        tx.set_detection(0.1, 0.3);
        tx.process(0.9);
        // Steady tone right after the hit: the hold must keep it transient.
        let step = 2.0 * std::f32::consts::PI * 100.0 / SR;
        let mut phase = 0.0f32;
        let mut last = TransmitterSplit::default();
        for _ in 0..2_400 {
            phase += step;
            last = tx.process(phase.sin() * 0.5);
        }
        assert!(
            last.transient_amount > 0.5,
            "hold did not keep the hit transient: {last:?}"
        );
    }

    #[test]
    fn a_real_split_still_sums_with_hold_engaged() {
        let mut tx = Transmitter::new(SR);
        tx.set_params(0.0, 1.0, 1.0, 1.0);
        tx.set_detection(0.05, 0.2);
        let step = 2.0 * std::f32::consts::PI * 220.0 / SR;
        let mut phase = 0.0f32;
        for i in 0..24_000 {
            phase += step;
            let x = phase.sin() * if i % 4_000 == 0 { 0.9 } else { 0.4 };
            let split = tx.process(x);
            assert!((split.transient + split.sustain - x).abs() < 1e-6);
        }
    }

    #[test]
    fn silence_stays_silent() {
        let mut tx = Transmitter::new(SR);
        for _ in 0..1_000 {
            let split = tx.process(0.0);
            assert_eq!(split.transient, 0.0);
            assert_eq!(split.sustain, 0.0);
        }
    }
}
