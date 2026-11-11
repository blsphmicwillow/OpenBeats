//! Native insert processors that were previously Web Audio-only.
//!
//! Every buffer is allocated when the insert chain is built. `process` only
//! updates state, so these run on the audio callback without allocating.

use std::f32::consts::PI;

fn clamp(v: f32, lo: f32, hi: f32) -> f32 {
    v.max(lo).min(hi)
}

#[derive(Clone, Copy, Default)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl Biquad {
    fn peaking(sample_rate: f32, freq: f32, gain_db: f32, q: f32) -> Self {
        let a = 10f32.powf(gain_db / 40.0);
        let w = 2.0 * PI * clamp(freq, 20.0, sample_rate * 0.45) / sample_rate;
        let alpha = w.sin() / (2.0 * q.max(0.1));
        let a0 = 1.0 + alpha / a;
        Self {
            b0: (1.0 + alpha * a) / a0,
            b1: (-2.0 * w.cos()) / a0,
            b2: (1.0 - alpha * a) / a0,
            a1: (-2.0 * w.cos()) / a0,
            a2: (1.0 - alpha / a) / a0,
            ..Self::default()
        }
    }

    fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }
}

pub struct Eq10 {
    bands: [Biquad; 10],
}

impl Eq10 {
    const FREQS: [f32; 10] = [
        31.0, 62.0, 125.0, 250.0, 500.0, 1_000.0, 2_000.0, 4_000.0, 8_000.0, 16_000.0,
    ];

    pub fn new(sample_rate: f32, gains: &[f32; 10]) -> Self {
        let bands =
            std::array::from_fn(|i| Biquad::peaking(sample_rate, Self::FREQS[i], gains[i], 1.2));
        Self { bands }
    }

    pub fn process(&mut self, input: (f32, f32)) -> (f32, f32) {
        let mut out = input;
        for band in &mut self.bands {
            out.0 = band.process(out.0);
            out.1 = band.process(out.1);
        }
        out
    }
}

struct Comb {
    buffer: Vec<f32>,
    index: usize,
    damped: f32,
}

impl Comb {
    fn new(len: usize) -> Self {
        Self {
            buffer: vec![0.0; len.max(1)],
            index: 0,
            damped: 0.0,
        }
    }

    fn process(&mut self, input: f32, feedback: f32, damp: f32) -> f32 {
        let out = self.buffer[self.index];
        self.damped = out * (1.0 - damp) + self.damped * damp;
        self.buffer[self.index] = input + self.damped * feedback;
        self.index = (self.index + 1) % self.buffer.len();
        out
    }
}

struct Allpass {
    buffer: Vec<f32>,
    index: usize,
}

impl Allpass {
    fn new(len: usize) -> Self {
        Self {
            buffer: vec![0.0; len.max(1)],
            index: 0,
        }
    }

    fn process(&mut self, input: f32) -> f32 {
        let delayed = self.buffer[self.index];
        self.buffer[self.index] = input + delayed * 0.5;
        self.index = (self.index + 1) % self.buffer.len();
        delayed - input
    }
}

struct ReverbCore {
    combs: [Comb; 4],
    allpasses: [Allpass; 2],
}

impl ReverbCore {
    fn new(sample_rate: f32, size: f32, offset: f32) -> Self {
        let scale = (0.55 + size * 1.1) * sample_rate;
        let lengths = [0.0297, 0.0371, 0.0411, 0.0437];
        let combs = std::array::from_fn(|i| Comb::new((lengths[i] * scale + offset) as usize));
        let allpasses = [
            Allpass::new((0.005 * sample_rate + offset) as usize),
            Allpass::new((0.0017 * sample_rate + offset) as usize),
        ];
        Self { combs, allpasses }
    }

    fn process(&mut self, input: f32, feedback: f32, damp: f32) -> f32 {
        let mut out = 0.0;
        for comb in &mut self.combs {
            out += comb.process(input, feedback, damp);
        }
        out *= 0.25;
        for allpass in &mut self.allpasses {
            out = allpass.process(out);
        }
        out
    }
}

pub struct Reverb {
    left: ReverbCore,
    right: ReverbCore,
    feedback: f32,
    damp: f32,
    mix: f32,
}

impl Reverb {
    pub fn new(sample_rate: f32, size: f32, decay: f32, damp: f32, mix: f32) -> Self {
        let size = clamp(size, 0.0, 1.0);
        Self {
            left: ReverbCore::new(sample_rate, size, 0.0),
            right: ReverbCore::new(sample_rate, size, 23.0),
            feedback: clamp(0.6 + decay * 0.38, 0.0, 0.95),
            damp: clamp(damp * 0.8, 0.0, 0.95),
            mix: clamp(mix, 0.0, 1.0),
        }
    }

    pub fn process(&mut self, input: (f32, f32)) -> (f32, f32) {
        let wet = (
            self.left
                .process(input.0 + input.1, self.feedback, self.damp),
            self.right
                .process(input.0 + input.1, self.feedback, self.damp),
        );
        (
            input.0 * (1.0 - self.mix) + wet.0 * self.mix,
            input.1 * (1.0 - self.mix) + wet.1 * self.mix,
        )
    }
}

pub struct Delay {
    left: Vec<f32>,
    right: Vec<f32>,
    index: usize,
    time_samples: usize,
    feedback: f32,
    tone: f32,
    tone_l: f32,
    tone_r: f32,
    mix: f32,
}

impl Delay {
    pub fn new(sample_rate: f32, time: f32, feedback: f32, tone: f32, mix: f32) -> Self {
        let capacity = (sample_rate * 2.0) as usize + 2;
        Self {
            left: vec![0.0; capacity],
            right: vec![0.0; capacity],
            index: 0,
            time_samples: ((0.02 + clamp(time, 0.0, 1.0) * 0.72) * sample_rate) as usize,
            feedback: clamp(feedback, 0.0, 0.9),
            tone: 0.02 + clamp(tone, 0.0, 1.0) * 0.42,
            tone_l: 0.0,
            tone_r: 0.0,
            mix: clamp(mix, 0.0, 1.0),
        }
    }

    pub fn process(&mut self, input: (f32, f32)) -> (f32, f32) {
        let len = self.left.len();
        let read = (self.index + len - self.time_samples.min(len - 1)) % len;
        let delayed = (self.left[read], self.right[read]);
        self.tone_l += (delayed.0 - self.tone_l) * self.tone;
        self.tone_r += (delayed.1 - self.tone_r) * self.tone;
        self.left[self.index] = input.0 + self.tone_l * self.feedback;
        self.right[self.index] = input.1 + self.tone_r * self.feedback;
        self.index = (self.index + 1) % len;
        (
            input.0 * (1.0 - self.mix) + delayed.0 * self.mix,
            input.1 * (1.0 - self.mix) + delayed.1 * self.mix,
        )
    }
}

pub struct Chorus {
    left: Vec<f32>,
    right: Vec<f32>,
    index: usize,
    phase: f32,
    rate: f32,
    depth: f32,
    mix: f32,
}

impl Chorus {
    pub fn new(sample_rate: f32, rate: f32, depth: f32, mix: f32) -> Self {
        let capacity = (sample_rate * 0.06) as usize + 2;
        Self {
            left: vec![0.0; capacity],
            right: vec![0.0; capacity],
            index: 0,
            phase: 0.0,
            rate: 0.08 + clamp(rate, 0.0, 1.0) * 4.5,
            depth: 0.001 + clamp(depth, 0.0, 1.0) * 0.006,
            mix: clamp(mix, 0.0, 1.0),
        }
    }

    fn read(buffer: &[f32], index: usize, delay: f32) -> f32 {
        let pos = index as f32 - delay;
        let wrapped = if pos < 0.0 {
            pos + buffer.len() as f32
        } else {
            pos
        };
        let a = wrapped.floor() as usize % buffer.len();
        let b = (a + 1) % buffer.len();
        let t = wrapped.fract();
        buffer[a] * (1.0 - t) + buffer[b] * t
    }

    pub fn process(&mut self, input: (f32, f32), sample_rate: f32) -> (f32, f32) {
        self.phase = (self.phase + self.rate / sample_rate) % 1.0;
        self.left[self.index] = input.0;
        self.right[self.index] = input.1;
        let delay = (0.012 + self.depth * (1.0 + (2.0 * PI * self.phase).sin())) * sample_rate;
        let wet = (
            Self::read(&self.left, self.index, delay),
            Self::read(&self.right, self.index, delay),
        );
        self.index = (self.index + 1) % self.left.len();
        (
            input.0 * (1.0 - self.mix) + wet.0 * self.mix,
            input.1 * (1.0 - self.mix) + wet.1 * self.mix,
        )
    }
}

pub struct Phaser {
    stages_l: [f32; 4],
    stages_r: [f32; 4],
    phase: f32,
    rate: f32,
    depth: f32,
    feedback: f32,
    mix: f32,
}

impl Phaser {
    pub fn new(rate: f32, depth: f32, feedback: f32, mix: f32) -> Self {
        Self {
            stages_l: [0.0; 4],
            stages_r: [0.0; 4],
            phase: 0.0,
            rate: 0.06 + clamp(rate, 0.0, 1.0) * 4.0,
            depth: clamp(depth, 0.0, 1.0),
            feedback: clamp(feedback, 0.0, 0.85),
            mix: clamp(mix, 0.0, 1.0),
        }
    }

    fn allpass(state: &mut f32, input: f32, coef: f32) -> f32 {
        let out = -input + *state;
        *state = input + out * coef;
        out
    }

    pub fn process(&mut self, input: (f32, f32), sample_rate: f32) -> (f32, f32) {
        self.phase = (self.phase + self.rate / sample_rate) % 1.0;
        let coef = 0.15 + self.depth * 0.7 * (0.5 + 0.5 * (2.0 * PI * self.phase).sin());
        let mut l = input.0 + self.stages_l[3] * self.feedback;
        let mut r = input.1 + self.stages_r[3] * self.feedback;
        for i in 0..4 {
            l = Self::allpass(&mut self.stages_l[i], l, coef);
            r = Self::allpass(&mut self.stages_r[i], r, coef);
        }
        (
            input.0 * (1.0 - self.mix) + l * self.mix,
            input.1 * (1.0 - self.mix) + r * self.mix,
        )
    }
}

pub struct Tremolo {
    phase: f32,
    rate: f32,
    depth: f32,
}

impl Tremolo {
    pub fn new(rate: f32, depth: f32) -> Self {
        Self {
            phase: 0.0,
            rate: 0.2 + clamp(rate, 0.0, 1.0) * 11.0,
            depth: clamp(depth, 0.0, 1.0),
        }
    }

    pub fn process(&mut self, input: (f32, f32), sample_rate: f32) -> (f32, f32) {
        self.phase = (self.phase + self.rate / sample_rate) % 1.0;
        let gain = 1.0 - self.depth * (0.5 + 0.5 * (2.0 * PI * self.phase).sin());
        (input.0 * gain, input.1 * gain)
    }
}

pub struct AutoPan {
    phase: f32,
    rate: f32,
    depth: f32,
    mix: f32,
}

impl AutoPan {
    pub fn new(rate: f32, depth: f32, mix: f32) -> Self {
        Self {
            phase: 0.0,
            rate: 0.05 + clamp(rate, 0.0, 1.0) * 3.0,
            depth: clamp(depth, 0.0, 1.0),
            mix: clamp(mix, 0.0, 1.0),
        }
    }

    pub fn process(&mut self, input: (f32, f32), sample_rate: f32) -> (f32, f32) {
        self.phase = (self.phase + self.rate / sample_rate) % 1.0;
        let pan = self.depth * (2.0 * PI * self.phase).sin();
        let angle = (pan + 1.0) * PI * 0.25;
        let wet = (input.0 * angle.cos(), input.1 * angle.sin());
        (
            input.0 * (1.0 - self.mix) + wet.0 * self.mix,
            input.1 * (1.0 - self.mix) + wet.1 * self.mix,
        )
    }
}

pub struct RingMod {
    phase: f32,
    freq: f32,
    tone: f32,
    state_l: f32,
    state_r: f32,
    mix: f32,
}

impl RingMod {
    pub fn new(freq: f32, tone: f32, mix: f32) -> Self {
        Self {
            phase: 0.0,
            freq: clamp(freq, 20.0, 4_000.0),
            tone: 0.08 + clamp(tone, 0.0, 1.0) * 0.8,
            state_l: 0.0,
            state_r: 0.0,
            mix: clamp(mix, 0.0, 1.0),
        }
    }

    pub fn process(&mut self, input: (f32, f32), sample_rate: f32) -> (f32, f32) {
        self.phase = (self.phase + self.freq / sample_rate) % 1.0;
        let carrier = (2.0 * PI * self.phase).sin();
        let wet = (input.0 * carrier, input.1 * carrier);
        self.state_l += (wet.0 - self.state_l) * self.tone;
        self.state_r += (wet.1 - self.state_r) * self.tone;
        (
            input.0 * (1.0 - self.mix) + self.state_l * self.mix,
            input.1 * (1.0 - self.mix) + self.state_r * self.mix,
        )
    }
}

pub struct Bitcrush {
    step: f32,
    tone: f32,
    state_l: f32,
    state_r: f32,
    mix: f32,
}

impl Bitcrush {
    pub fn new(bits: f32, tone: f32, mix: f32) -> Self {
        let levels = 2f32.powf(clamp(bits, 2.0, 16.0) - 1.0);
        Self {
            step: 1.0 / levels,
            tone: 0.08 + clamp(tone, 0.0, 1.0) * 0.8,
            state_l: 0.0,
            state_r: 0.0,
            mix: clamp(mix, 0.0, 1.0),
        }
    }

    pub fn process(&mut self, input: (f32, f32)) -> (f32, f32) {
        let wet = (
            (input.0 / self.step).round() * self.step,
            (input.1 / self.step).round() * self.step,
        );
        self.state_l += (wet.0 - self.state_l) * self.tone;
        self.state_r += (wet.1 - self.state_r) * self.tone;
        (
            input.0 * (1.0 - self.mix) + self.state_l * self.mix,
            input.1 * (1.0 - self.mix) + self.state_r * self.mix,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_native_insert_stays_finite_and_changes_a_signal() {
        let sr = 48_000.0;
        let mut processors: Vec<Box<dyn FnMut((f32, f32)) -> (f32, f32)>> = vec![
            Box::new({
                let mut eq = Eq10::new(
                    sr,
                    &[0.0, 0.0, 0.0, 0.0, 0.0, -18.0, -18.0, -18.0, -18.0, -18.0],
                );
                move |x| eq.process(x)
            }),
            Box::new({
                let mut fx = Reverb::new(sr, 0.5, 0.7, 0.4, 1.0);
                move |x| fx.process(x)
            }),
            Box::new({
                let mut fx = Delay::new(sr, 0.3, 0.4, 0.6, 1.0);
                move |x| fx.process(x)
            }),
            Box::new({
                let mut fx = Chorus::new(sr, 0.3, 0.5, 1.0);
                move |x| fx.process(x, sr)
            }),
            Box::new({
                let mut fx = Phaser::new(0.3, 0.5, 0.2, 1.0);
                move |x| fx.process(x, sr)
            }),
            Box::new({
                let mut fx = Tremolo::new(0.5, 1.0);
                move |x| fx.process(x, sr)
            }),
            Box::new({
                let mut fx = AutoPan::new(0.5, 1.0, 1.0);
                move |x| fx.process(x, sr)
            }),
            Box::new({
                let mut fx = RingMod::new(220.0, 0.6, 1.0);
                move |x| fx.process(x, sr)
            }),
            Box::new({
                let mut fx = Bitcrush::new(6.0, 0.5, 1.0);
                move |x| fx.process(x)
            }),
        ];
        for fx in &mut processors {
            let mut changed = false;
            for i in 0..2_000 {
                let input = (i as f32 / 2_000.0 * 0.4 - 0.2, 0.1);
                let out = fx(input);
                assert!(out.0.is_finite() && out.1.is_finite());
                changed |= (out.0 - input.0).abs() > 1e-6 || (out.1 - input.1).abs() > 1e-6;
            }
            assert!(changed);
        }
    }
}
