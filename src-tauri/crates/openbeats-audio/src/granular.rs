//! Granular sampler engine.
//!
//! Mono grain cloud over an in-memory sample: `position` scrubs, `grain_ms` sets
//! the grain length, `density` grains per second, `pitch` resamples and `spread`
//! jitters the start position. The random source is a seeded LCG so a take is
//! reproducible.

struct Grain {
    /// Playhead inside the source, in frames.
    cursor: f32,
    /// Frames left before the grain retires.
    remaining: f32,
    length: f32,
    step: f32,
    gain: f32,
}

/// A grain cloud playing one buffer.
pub struct GranularEngine {
    source: Vec<f32>,
    sample_rate: f32,
    /// 0..1 scrub position.
    pub position: f32,
    pub grain_ms: f32,
    /// Grains per second.
    pub density: f32,
    /// Playback rate multiplier (1 = original pitch).
    pub pitch: f32,
    /// 0..1 randomness of grain start positions.
    pub spread: f32,
    grains: Vec<Grain>,
    spawn_accumulator: f32,
    seed: u32,
}

impl GranularEngine {
    pub fn new(source: Vec<f32>, sample_rate: f32) -> Self {
        Self {
            source,
            sample_rate: if sample_rate > 0.0 {
                sample_rate
            } else {
                48_000.0
            },
            position: 0.25,
            grain_ms: 60.0,
            density: 18.0,
            pitch: 1.0,
            spread: 0.1,
            grains: Vec::new(),
            spawn_accumulator: 0.0,
            seed: 0x1234_5678,
        }
    }

    pub fn set_source(&mut self, source: Vec<f32>) {
        self.source = source;
        self.grains.clear();
    }

    fn random(&mut self) -> f32 {
        self.seed = self
            .seed
            .wrapping_mul(1_664_525)
            .wrapping_add(1_013_904_223);
        (self.seed >> 8) as f32 / 16_777_216.0
    }

    fn spawn(&mut self) {
        if self.source.is_empty() {
            return;
        }
        let length = ((self.grain_ms.clamp(5.0, 500.0) / 1_000.0) * self.sample_rate).max(16.0);
        let jitter = (self.random() - 0.5) * self.spread.clamp(0.0, 1.0) * length * 2.0;
        let anchor = self.position.clamp(0.0, 1.0) * self.source.len() as f32;
        let cursor =
            (anchor - length / 2.0 + jitter).clamp(0.0, (self.source.len() as f32 - 1.0).max(0.0));
        let gain = 0.5 + self.random() * 0.5;
        self.grains.push(Grain {
            cursor,
            remaining: length,
            length,
            step: self.pitch.clamp(0.25, 4.0),
            gain,
        });
    }

    /// Renders `frames` of mono audio.
    pub fn render(&mut self, frames: usize) -> Vec<f32> {
        let mut out = vec![0.0f32; frames];
        if self.source.is_empty() || frames == 0 {
            return out;
        }
        let interval = self.sample_rate / self.density.clamp(0.5, 200.0);
        for frame in 0..frames {
            self.spawn_accumulator += 1.0;
            if self.spawn_accumulator >= interval {
                self.spawn_accumulator -= interval;
                self.spawn();
            }
            let mut mix = 0.0f32;
            for grain in &mut self.grains {
                if grain.remaining <= 0.0 {
                    continue;
                }
                let index = grain.cursor as usize;
                if index + 1 < self.source.len() {
                    let frac = grain.cursor - index as f32;
                    let sample = self.source[index] * (1.0 - frac) + self.source[index + 1] * frac;
                    // Hann window over the grain's life.
                    let t = (grain.length - grain.remaining) / grain.length;
                    let window = (std::f32::consts::PI * t.clamp(0.0, 1.0)).sin();
                    mix += sample * window * grain.gain;
                }
                grain.cursor += grain.step;
                grain.remaining -= grain.step;
            }
            self.grains.retain(|grain| grain.remaining > 0.0);
            out[frame] = mix.clamp(-1.0, 1.0);
        }
        out
    }

    pub fn active_grains(&self) -> usize {
        self.grains.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(frames: usize) -> Vec<f32> {
        (0..frames)
            .map(|i| (2.0 * std::f32::consts::PI * 220.0 * i as f32 / 48_000.0).sin() * 0.6)
            .collect()
    }

    #[test]
    fn a_cloud_produces_audio_and_retires_its_grains() {
        let mut engine = GranularEngine::new(sine(48_000), 48_000.0);
        let out = engine.render(4_800);
        assert_eq!(out.len(), 4_800);
        assert!(out.iter().any(|s| s.abs() > 0.01));
        assert!(out.iter().all(|s| s.is_finite() && s.abs() <= 1.0));
        assert!(engine.active_grains() > 0);
    }

    #[test]
    fn the_scrub_position_changes_the_source_material() {
        let mut low = GranularEngine::new(sine(48_000), 48_000.0);
        low.position = 0.0;
        low.spread = 0.0;
        low.density = 40.0;
        let first = low.render(6_000);
        let mut high = GranularEngine::new(sine(48_000), 48_000.0);
        high.position = 1.0;
        high.spread = 0.0;
        high.density = 40.0;
        let second = high.render(6_000);
        assert_ne!(first, second);
    }

    #[test]
    fn identical_settings_reproduce_the_take() {
        let source = sine(24_000);
        let mut a = GranularEngine::new(source.clone(), 48_000.0);
        let mut b = GranularEngine::new(source, 48_000.0);
        for engine in [&mut a, &mut b] {
            engine.density = 30.0;
            engine.grain_ms = 40.0;
            engine.pitch = 1.5;
        }
        assert_eq!(a.render(1_024), b.render(1_024));
    }

    #[test]
    fn empty_sources_render_silence() {
        let mut engine = GranularEngine::new(Vec::new(), 48_000.0);
        assert!(engine.render(512).iter().all(|s| *s == 0.0));
        assert_eq!(engine.active_grains(), 0);
    }

    #[test]
    fn extreme_settings_stay_in_range() {
        let mut engine = GranularEngine::new(sine(8_000), 48_000.0);
        engine.grain_ms = 5_000.0;
        engine.density = 500.0;
        engine.pitch = 9.0;
        engine.position = 4.0;
        engine.spread = 3.0;
        let out = engine.render(2_048);
        assert!(out.iter().all(|s| s.is_finite() && s.abs() <= 1.0));
    }
}
