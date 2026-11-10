//! 3-band EQ: low shelf (180 Hz), peaking mid, high shelf (4.2 kHz).
//!
//! Matches the Web Audio `eq3` insert in `src/audio/effects.ts` band for band,
//! using RBJ cookbook biquads in transposed direct form II.

use std::f32::consts::PI;

use super::clamp;

/// A single biquad section.
#[derive(Clone, Copy, Debug)]
pub struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl Default for Biquad {
    fn default() -> Self {
        Self::flat()
    }
}

impl Biquad {
    pub fn flat() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            z1: 0.0,
            z2: 0.0,
        }
    }

    fn normalized(b0: f32, b1: f32, b2: f32, a0: f32, a1: f32, a2: f32) -> Self {
        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
            z1: 0.0,
            z2: 0.0,
        }
    }

    /// Low shelf, `shelf_slope` fixed at 1 (as Web Audio's `lowshelf`).
    pub fn low_shelf(sample_rate: f32, freq: f32, gain_db: f32) -> Self {
        let big_a = 10f32.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * clamp(freq, 10.0, sample_rate * 0.49) / sample_rate;
        let cos_w0 = w0.cos();
        let alpha = w0.sin() / 2.0 * std::f32::consts::SQRT_2;
        let two_sqrt_a_alpha = 2.0 * big_a.sqrt() * alpha;
        Self::normalized(
            big_a * ((big_a + 1.0) - (big_a - 1.0) * cos_w0 + two_sqrt_a_alpha),
            2.0 * big_a * ((big_a - 1.0) - (big_a + 1.0) * cos_w0),
            big_a * ((big_a + 1.0) - (big_a - 1.0) * cos_w0 - two_sqrt_a_alpha),
            (big_a + 1.0) + (big_a - 1.0) * cos_w0 + two_sqrt_a_alpha,
            -2.0 * ((big_a - 1.0) + (big_a + 1.0) * cos_w0),
            (big_a + 1.0) + (big_a - 1.0) * cos_w0 - two_sqrt_a_alpha,
        )
    }

    /// Peaking EQ with quality factor `q`.
    pub fn peaking(sample_rate: f32, freq: f32, gain_db: f32, q: f32) -> Self {
        let big_a = 10f32.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * clamp(freq, 10.0, sample_rate * 0.49) / sample_rate;
        let cos_w0 = w0.cos();
        let alpha = w0.sin() / (2.0 * q.max(0.05));
        Self::normalized(
            1.0 + alpha * big_a,
            -2.0 * cos_w0,
            1.0 - alpha * big_a,
            1.0 + alpha / big_a,
            -2.0 * cos_w0,
            1.0 - alpha / big_a,
        )
    }

    /// High shelf.
    pub fn high_shelf(sample_rate: f32, freq: f32, gain_db: f32) -> Self {
        let big_a = 10f32.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * clamp(freq, 10.0, sample_rate * 0.49) / sample_rate;
        let cos_w0 = w0.cos();
        let alpha = w0.sin() / 2.0 * std::f32::consts::SQRT_2;
        let two_sqrt_a_alpha = 2.0 * big_a.sqrt() * alpha;
        Self::normalized(
            big_a * ((big_a + 1.0) + (big_a - 1.0) * cos_w0 + two_sqrt_a_alpha),
            -2.0 * big_a * ((big_a - 1.0) + (big_a + 1.0) * cos_w0),
            big_a * ((big_a + 1.0) + (big_a - 1.0) * cos_w0 - two_sqrt_a_alpha),
            (big_a + 1.0) - (big_a - 1.0) * cos_w0 + two_sqrt_a_alpha,
            2.0 * ((big_a - 1.0) - (big_a + 1.0) * cos_w0),
            (big_a + 1.0) - (big_a - 1.0) * cos_w0 - two_sqrt_a_alpha,
        )
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }

    pub fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }
}

/// Three bands in series: low shelf, peaking mid, high shelf.
#[derive(Clone, Copy, Debug, Default)]
pub struct Eq3 {
    low: Biquad,
    mid: Biquad,
    high: Biquad,
    sample_rate: f32,
}

impl Eq3 {
    pub const LOW_FREQ: f32 = 180.0;
    pub const HIGH_FREQ: f32 = 4_200.0;
    pub const MID_Q: f32 = 1.1;

    pub fn new(sample_rate: f32) -> Self {
        let mut eq = Self {
            sample_rate,
            ..Default::default()
        };
        eq.set_params(0.0, 0.0, 0.0, 1_000.0);
        eq
    }

    /// Gains in dB, mid centre frequency in Hz — the same units as the UI knobs.
    pub fn set_params(&mut self, low_db: f32, mid_db: f32, high_db: f32, mid_freq: f32) {
        self.low = Biquad::low_shelf(self.sample_rate, Self::LOW_FREQ, low_db);
        self.mid = Biquad::peaking(self.sample_rate, mid_freq, mid_db, Self::MID_Q);
        self.high = Biquad::high_shelf(self.sample_rate, Self::HIGH_FREQ, high_db);
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        let y = self.low.process(x);
        let y = self.mid.process(y);
        self.high.process(y)
    }

    pub fn reset(&mut self) {
        self.low.reset();
        self.mid.reset();
        self.high.reset();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    #[test]
    fn flat_eq_passes_dc_and_signal() {
        let mut eq = Eq3::new(SR);
        eq.set_params(0.0, 0.0, 0.0, 1_000.0);
        // DC settles near unity through a flat biquad chain.
        let mut y = 0.0;
        for _ in 0..4_000 {
            y = eq.process(0.5);
        }
        assert!((y - 0.5).abs() < 1e-3, "flat EQ altered DC: {y}");
    }

    #[test]
    fn low_shelf_boost_raises_low_frequency_energy() {
        let mut flat = Eq3::new(SR);
        flat.set_params(0.0, 0.0, 0.0, 1_000.0);
        let mut boosted = Eq3::new(SR);
        boosted.set_params(12.0, 0.0, 0.0, 1_000.0);

        let measure = |eq: &mut Eq3| {
            let mut phase = 0.0f32;
            let step = 2.0 * std::f32::consts::PI * 60.0 / SR;
            let mut peak = 0.0f32;
            for i in 0..48_000 {
                phase += step;
                let y = eq.process(phase.sin() * 0.25);
                if i > 24_000 {
                    peak = peak.max(y.abs());
                }
            }
            peak
        };

        let dry = measure(&mut flat);
        let wet = measure(&mut boosted);
        assert!(
            wet > dry * 1.5,
            "low shelf did not lift 60 Hz: {wet} vs {dry}"
        );
    }

    #[test]
    fn reset_clears_history() {
        let mut eq = Eq3::new(SR);
        eq.set_params(6.0, -6.0, 3.0, 900.0);
        for _ in 0..100 {
            eq.process(0.9);
        }
        eq.reset();
        let mut y = 0.0;
        for _ in 0..10 {
            y = eq.process(0.0);
        }
        assert!(y.abs() < 1e-6, "reset left state: {y}");
    }
}
