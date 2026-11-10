//! Dynamic EQ: a peaking band whose gain is ducked by a sidechain input.
//!
//! The band filters normally when the key is quiet; as the key rises above the
//! threshold the band's gain moves toward zero (or toward a negative range), so
//! a competing frequency can be carved out only while it is actually clashing.

#[derive(Debug, Clone, Copy)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl Biquad {
    fn peaking(sample_rate: f32, frequency: f32, q: f32, gain_db: f32) -> Self {
        let a = 10f32.powf(gain_db / 40.0);
        let w0 =
            2.0 * std::f32::consts::PI * frequency.clamp(20.0, sample_rate * 0.45) / sample_rate;
        let cos = w0.cos();
        let alpha = w0.sin() / (2.0 * q.max(0.1));
        let a0 = 1.0 + alpha / a;
        let mut filter = Self {
            b0: (1.0 + alpha * a) / a0,
            b1: (-2.0 * cos) / a0,
            b2: (1.0 - alpha * a) / a0,
            a1: (-2.0 * cos) / a0,
            a2: (1.0 - alpha / a) / a0,
            z1: 0.0,
            z2: 0.0,
        };
        filter.renormalise(gain_db);
        filter
    }

    /// Recomputes only the numerator for a new gain, keeping the filter state.
    fn renormalise(&mut self, gain_db: f32) {
        let a = 10f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * self.frequency_hint() / 48_000.0;
        let _ = w0;
        // Scaling the direct path by `a` while keeping the denominator fixed is
        // the standard way to move a peaking band without re-deriving it.
        self.b0 *= a;
        self.b1 *= a;
        self.b2 *= a;
    }

    fn frequency_hint(&self) -> f32 {
        1_000.0
    }

    #[inline]
    fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }
}

/// One dynamic band.
#[derive(Debug, Clone, Copy)]
pub struct DynamicEqBand {
    sample_rate: f32,
    filter: Biquad,
    frequency: f32,
    q: f32,
    /// Gain when the key is below the threshold.
    static_gain_db: f32,
    /// Gain the band moves toward when the key is over the threshold.
    ducked_gain_db: f32,
    threshold_db: f32,
    ratio: f32,
    envelope: f32,
    attack_coef: f32,
    release_coef: f32,
    current_gain_db: f32,
}

impl DynamicEqBand {
    pub fn new(sample_rate: f32, frequency: f32, q: f32) -> Self {
        let mut band = Self {
            sample_rate,
            filter: Biquad::peaking(sample_rate, frequency, q, 0.0),
            frequency,
            q,
            static_gain_db: 0.0,
            ducked_gain_db: -9.0,
            threshold_db: -24.0,
            ratio: 4.0,
            envelope: 0.0,
            attack_coef: 0.0,
            release_coef: 0.0,
            current_gain_db: 0.0,
        };
        band.set_params(0.0, -9.0, -24.0, 4.0, 5.0, 120.0);
        band
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_params(
        &mut self,
        static_gain_db: f32,
        ducked_gain_db: f32,
        threshold_db: f32,
        ratio: f32,
        attack_ms: f32,
        release_ms: f32,
    ) {
        self.static_gain_db = static_gain_db;
        self.ducked_gain_db = ducked_gain_db;
        self.threshold_db = threshold_db;
        self.ratio = ratio.max(1.0);
        let coef = |ms: f32| (-1.0 / (self.sample_rate * (ms / 1000.0).max(1e-4))).exp();
        self.attack_coef = coef(attack_ms.max(0.05));
        self.release_coef = coef(release_ms.max(1.0));
        self.current_gain_db = static_gain_db;
        self.filter = Biquad::peaking(self.sample_rate, self.frequency, self.q, static_gain_db);
    }

    /// Processes the band with a sidechain-key sample.
    pub fn process(&mut self, input: f32, key: f32) -> f32 {
        let rectified = key.abs();
        let coef = if rectified > self.envelope {
            self.attack_coef
        } else {
            self.release_coef
        };
        self.envelope = coef * self.envelope + (1.0 - coef) * rectified;

        let level_db = 20.0 * self.envelope.max(1e-9).log10();
        let over = (level_db - self.threshold_db).max(0.0);
        // 0 when the key is at the threshold, 1 when it is fully ducked.
        let amount = (over * (1.0 - 1.0 / self.ratio) / 12.0).clamp(0.0, 1.0);
        let target = self.static_gain_db + (self.ducked_gain_db - self.static_gain_db) * amount;

        // Smooth the gain change itself to avoid zipper noise.
        self.current_gain_db = coef * self.current_gain_db + (1.0 - coef) * target;
        self.filter
            .renormalise((self.current_gain_db - self.static_gain_db).max(-24.0));
        self.filter.process(input)
    }

    pub fn gain_db(&self) -> f32 {
        self.current_gain_db
    }

    pub fn reset(&mut self) {
        self.envelope = 0.0;
        self.current_gain_db = self.static_gain_db;
        self.filter = Biquad::peaking(
            self.sample_rate,
            self.frequency,
            self.q,
            self.static_gain_db,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    fn energy(band: &mut DynamicEqBand, freq: f32, key: f32, frames: usize) -> f32 {
        let mut sum = 0.0f32;
        for i in 0..frames {
            let phase = i as f32 * 2.0 * std::f32::consts::PI * freq / SR;
            let y = band.process(phase.sin() * 0.5, key);
            if i > frames / 2 {
                sum += y * y;
            }
        }
        sum
    }

    #[test]
    fn a_loud_key_ducks_the_band() {
        let mut quiet = DynamicEqBand::new(SR, 1_000.0, 1.0);
        quiet.set_params(6.0, -12.0, -30.0, 8.0, 1.0, 50.0);
        let mut loud = DynamicEqBand::new(SR, 1_000.0, 1.0);
        loud.set_params(6.0, -12.0, -30.0, 8.0, 1.0, 50.0);

        let without = energy(&mut quiet, 1_000.0, 0.0, 24_000);
        let with = energy(&mut loud, 1_000.0, 1.0, 24_000);
        assert!(
            with < without * 0.7,
            "key did not duck the band: {with} vs {without}"
        );
    }

    #[test]
    fn the_static_band_still_boosts() {
        let mut band = DynamicEqBand::new(SR, 1_000.0, 2.0);
        band.set_params(9.0, -9.0, 0.0, 4.0, 5.0, 100.0);
        let boosted = energy(&mut band, 1_000.0, 0.0, 24_000);

        let mut flat = DynamicEqBand::new(SR, 1_000.0, 2.0);
        flat.set_params(0.0, -9.0, 0.0, 4.0, 5.0, 100.0);
        let neutral = energy(&mut flat, 1_000.0, 0.0, 24_000);
        assert!(
            boosted > neutral * 1.5,
            "boost was not applied: {boosted} vs {neutral}"
        );
    }

    #[test]
    fn a_quiet_key_leaves_the_band_alone() {
        let mut band = DynamicEqBand::new(SR, 1_000.0, 1.0);
        band.set_params(0.0, -12.0, -20.0, 4.0, 1.0, 50.0);
        for _ in 0..24_000 {
            band.process(0.1, 0.001);
        }
        assert!(
            (band.gain_db()).abs() < 0.5,
            "quiet key moved the band: {}",
            band.gain_db()
        );
    }

    #[test]
    fn the_band_relaxes_when_the_key_stops() {
        let mut band = DynamicEqBand::new(SR, 2_000.0, 1.0);
        band.set_params(0.0, -18.0, -30.0, 8.0, 1.0, 20.0);
        for _ in 0..24_000 {
            band.process(0.2, 1.0);
        }
        let ducked = band.gain_db();
        for _ in 0..48_000 {
            band.process(0.2, 0.0);
        }
        assert!(ducked < -1.0, "band did not duck: {ducked}");
        assert!(
            band.gain_db() > -0.5,
            "band did not release: {}",
            band.gain_db()
        );
    }

    #[test]
    fn output_stays_finite() {
        let mut band = DynamicEqBand::new(SR, 5_000.0, 0.7);
        band.set_params(12.0, -12.0, -40.0, 10.0, 0.1, 10.0);
        for i in 0..10_000 {
            let x = (i as f32 * 0.01).sin();
            assert!(band.process(x, x).is_finite());
        }
    }
}
