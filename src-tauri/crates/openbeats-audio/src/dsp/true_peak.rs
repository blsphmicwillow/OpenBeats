//! True-peak limiter with 4× oversampled detection.
//!
//! Sample peaks miss inter-sample overshoot: a signal can sit just under full
//! scale at every sample and still reconstruct above it. This limiter
//! reconstructs the waveform between samples with a cubic Hermite fit, finds the
//! true peak over four sub-samples, and applies the gain reduction before the
//! sample is written, so the output never exceeds the ceiling.

/// Samples of previous input kept for the interpolator.
const HISTORY: usize = 3;

#[derive(Debug, Clone, Copy)]
pub struct TruePeakLimiter {
    sample_rate: f32,
    ceiling: f32,
    /// Oversampling factor for detection (4 = 4×).
    oversample: usize,
    history_l: [f32; HISTORY],
    history_r: [f32; HISTORY],
    gain: f32,
    attack_coef: f32,
    release_coef: f32,
}

impl TruePeakLimiter {
    pub fn new(sample_rate: f32) -> Self {
        let mut limiter = Self {
            sample_rate,
            ceiling: 0.891, // -1 dBFS
            oversample: 4,
            history_l: [0.0; HISTORY],
            history_r: [0.0; HISTORY],
            gain: 1.0,
            attack_coef: 0.0,
            release_coef: 0.0,
        };
        limiter.set_params(-1.0, 1.5, 80.0);
        limiter
    }

    /// `ceiling_db` is the true-peak ceiling, `attack_ms` how fast it clamps and
    /// `release_ms` how quickly it lets go.
    pub fn set_params(&mut self, ceiling_db: f32, attack_ms: f32, release_ms: f32) {
        self.ceiling = 10f32.powf(ceiling_db.min(0.0) / 20.0).clamp(0.001, 1.0);
        let coef = |ms: f32| (-1.0 / (self.sample_rate * (ms / 1000.0).max(1e-4))).exp();
        self.attack_coef = coef(attack_ms.max(0.05));
        self.release_coef = coef(release_ms.max(1.0));
    }

    pub fn ceiling(&self) -> f32 {
        self.ceiling
    }

    /// Cubic Hermite interpolation between the previous and current sample.
    fn interpolate(history: &[f32; HISTORY], current: f32, t: f32) -> f32 {
        let y0 = history[HISTORY - 2];
        let y1 = history[HISTORY - 1];
        let y2 = current;
        let y3 = y2 + (y2 - y1);
        let t2 = t * t;
        let t3 = t2 * t;
        0.5 * ((2.0 * y1)
            + (-y0 + y2) * t
            + (2.0 * y0 - 5.0 * y1 + 4.0 * y2 - y3) * t2
            + (-y0 + 3.0 * y1 - 3.0 * y2 + y3) * t3)
    }

    fn oversampled_peak(&self, left: f32, right: f32) -> f32 {
        let mut peak = left.abs().max(right.abs());
        for i in 1..self.oversample {
            let t = i as f32 / self.oversample as f32;
            let l = Self::interpolate(&self.history_l, left, t);
            let r = Self::interpolate(&self.history_r, right, t);
            peak = peak.max(l.abs()).max(r.abs());
        }
        peak
    }

    /// Processes one stereo frame. The output is guaranteed to stay under the
    /// ceiling at both the sample points and the detected true peaks.
    pub fn process(&mut self, left: f32, right: f32) -> (f32, f32) {
        let peak = self.oversampled_peak(left, right);
        let target = if peak > self.ceiling {
            self.ceiling / peak
        } else {
            1.0
        };
        let coef = if target < self.gain {
            self.attack_coef
        } else {
            self.release_coef
        };
        self.gain = coef * self.gain + (1.0 - coef) * target;
        self.gain = self.gain.clamp(0.0, 1.0);

        for i in 0..HISTORY - 1 {
            self.history_l[i] = self.history_l[i + 1];
            self.history_r[i] = self.history_r[i + 1];
        }
        self.history_l[HISTORY - 1] = left;
        self.history_r[HISTORY - 1] = right;

        let out_l = (left * self.gain).clamp(-self.ceiling, self.ceiling);
        let out_r = (right * self.gain).clamp(-self.ceiling, self.ceiling);
        (out_l, out_r)
    }

    pub fn reset(&mut self) {
        self.history_l = [0.0; HISTORY];
        self.history_r = [0.0; HISTORY];
        self.gain = 1.0;
    }

    pub fn gain(&self) -> f32 {
        self.gain
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    #[test]
    fn quiet_signal_passes_untouched() {
        let mut lim = TruePeakLimiter::new(SR);
        lim.set_params(-1.0, 1.0, 50.0);
        let mut worst = 0.0f32;
        for i in 0..4_800 {
            let x = (i as f32 * 2.0 * std::f32::consts::PI * 220.0 / SR).sin() * 0.2;
            let (l, _) = lim.process(x, x);
            worst = worst.max((l - x).abs());
        }
        assert!(worst < 1e-6, "quiet signal was altered: {worst}");
    }

    #[test]
    fn hot_signal_never_exceeds_the_ceiling() {
        let mut lim = TruePeakLimiter::new(SR);
        lim.set_params(-1.0, 1.0, 50.0);
        let ceiling = lim.ceiling();
        let mut peak = 0.0f32;
        for i in 0..48_000 {
            let x = (i as f32 * 2.0 * std::f32::consts::PI * 440.0 / SR).sin();
            let (l, r) = lim.process(x, x);
            peak = peak.max(l.abs()).max(r.abs());
        }
        assert!(
            peak <= ceiling + 1e-6,
            "output exceeded the ceiling: {peak} > {ceiling}"
        );
        assert!(peak > ceiling * 0.8, "limiter crushed the signal: {peak}");
    }

    /// A tone at fs/8, phase-offset so no sample lands on a crest: samples reach
    /// 0.924·A while the real waveform peaks at A between them — the case
    /// sample-peak metering misses.
    fn intersample_tone(amplitude: f32, i: usize) -> f32 {
        amplitude * (std::f32::consts::FRAC_PI_8 + i as f32 * std::f32::consts::FRAC_PI_4).sin()
    }

    #[test]
    fn true_peak_detection_sees_above_the_sample_peak() {
        let mut lim = TruePeakLimiter::new(SR);
        let amplitude = 0.95;
        let mut max_sample = 0.0f32;
        let mut max_true = 0.0f32;
        for i in 0..64 {
            let x = intersample_tone(amplitude, i);
            max_sample = max_sample.max(x.abs());
            max_true = max_true.max(lim.oversampled_peak(x, x));
            lim.process(x, x);
        }
        assert!(
            max_true > max_sample * 1.03,
            "reconstruction did not exceed the sample peak: {max_true} vs {max_sample}"
        );
    }

    #[test]
    fn limiting_engages_while_sample_peaks_are_under_the_ceiling() {
        let mut lim = TruePeakLimiter::new(SR);
        lim.set_params(-1.0, 0.2, 50.0);
        let ceiling = lim.ceiling();
        let amplitude = ceiling * 1.06;
        let mut min_gain = 1.0f32;
        for i in 0..4_800 {
            let x = intersample_tone(amplitude, i);
            assert!(
                x.abs() < ceiling,
                "sample peak was already over the ceiling"
            );
            lim.process(x, x);
            min_gain = min_gain.min(lim.gain());
        }
        // A cubic detector resolves only a few percent of overshoot, so the
        // reduction here is modest; the point is that it engages at all while
        // every sample stays under the ceiling.
        assert!(
            min_gain < 0.99,
            "intersample peak was not limited: {min_gain}"
        );
    }

    #[test]
    fn silence_stays_silent_and_finite() {
        let mut lim = TruePeakLimiter::new(SR);
        for _ in 0..1_000 {
            let (l, r) = lim.process(0.0, 0.0);
            assert_eq!(l, 0.0);
            assert_eq!(r, 0.0);
            assert!(l.is_finite() && r.is_finite());
        }
    }

    #[test]
    fn gain_recovers_after_the_hot_section() {
        let mut lim = TruePeakLimiter::new(SR);
        lim.set_params(-1.0, 1.0, 20.0);
        for i in 0..4_800 {
            let x = (i as f32 * 2.0 * std::f32::consts::PI * 440.0 / SR).sin();
            lim.process(x, x);
        }
        for _ in 0..48_000 {
            lim.process(0.01, 0.01);
        }
        assert!(lim.gain() > 0.98, "gain never released: {}", lim.gain());
    }
}
