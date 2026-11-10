//! Synth voices for the native engine.
//!
//! These are compact procedural voices, one per channel preset, with the same
//! parameter names the React instruments use (attack, decay, release, tone).
//! They are intentionally simple: a native voice is a starting point for
//! parity, not a claim that the Web Audio instruments have been replaced
//! sample-for-sample.

use std::f32::consts::PI;

use crate::sequencer::PlaybackChannel;

/// The channel-preset ids from `src/model/types.ts`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Preset {
    Kick,
    Snare,
    Hat,
    OpenHat,
    Clap,
    Tom,
    Rim,
    Bass,
    Sub,
    Lead,
    Keys,
    Chords,
    Pluck,
    Pad,
    Fx,
    Sample,
}

impl Preset {
    pub fn from_id(id: &str) -> Self {
        match id {
            "kick" => Preset::Kick,
            "snare" => Preset::Snare,
            "hat" => Preset::Hat,
            "openhat" => Preset::OpenHat,
            "clap" => Preset::Clap,
            "tom" => Preset::Tom,
            "rim" => Preset::Rim,
            "bass" => Preset::Bass,
            "sub" => Preset::Sub,
            "lead" => Preset::Lead,
            "keys" => Preset::Keys,
            "chords" => Preset::Chords,
            "pluck" => Preset::Pluck,
            "pad" => Preset::Pad,
            "fx" => Preset::Fx,
            _ => Preset::Sample,
        }
    }

    /// True for the voices that need a pitched oscillator rather than a burst.
    fn pitched(self) -> bool {
        matches!(
            self,
            Preset::Bass
                | Preset::Sub
                | Preset::Lead
                | Preset::Keys
                | Preset::Chords
                | Preset::Pluck
                | Preset::Pad
                | Preset::Kick
                | Preset::Tom
        )
    }
}

/// Deterministic white noise, one generator per voice.
#[derive(Clone, Copy, Debug)]
struct Noise(u32);

impl Noise {
    fn new(seed: u32) -> Self {
        Self(seed | 1)
    }

    #[inline]
    fn next(&mut self) -> f32 {
        // xorshift32
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        (x as f32 / u32::MAX as f32) * 2.0 - 1.0
    }
}

#[derive(Clone, Copy, Debug)]
struct Adsr {
    attack_sec: f32,
    decay_sec: f32,
    sustain: f32,
    release_sec: f32,
    elapsed: f32,
    held_for: f32,
}

impl Adsr {
    #[inline]
    fn level(&self) -> f32 {
        if self.elapsed < self.attack_sec {
            if self.attack_sec <= 0.0 {
                1.0
            } else {
                self.elapsed / self.attack_sec
            }
        } else if self.elapsed < self.attack_sec + self.decay_sec {
            let t = (self.elapsed - self.attack_sec) / self.decay_sec.max(1e-6);
            1.0 - (1.0 - self.sustain) * t
        } else if self.elapsed < self.held_for {
            self.sustain
        } else {
            let t = (self.elapsed - self.held_for) / self.release_sec.max(1e-5);
            (self.sustain * (1.0 - t)).max(0.0)
        }
    }

    #[inline]
    fn finished(&self) -> bool {
        self.elapsed > self.held_for + self.release_sec
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Voice {
    preset: Preset,
    frequency: f32,
    velocity: f32,
    gain: f32,
    pan_left: f32,
    pan_right: f32,
    tone: f32,
    phase: f32,
    phase2: f32,
    adsr: Adsr,
    noise: Noise,
    filter: f32,
    sample_rate: f32,
    active: bool,
}

impl Voice {
    fn silent() -> Self {
        Self {
            preset: Preset::Sample,
            frequency: 440.0,
            velocity: 0.0,
            gain: 0.0,
            pan_left: 0.0,
            pan_right: 0.0,
            tone: 0.5,
            phase: 0.0,
            phase2: 0.0,
            adsr: Adsr {
                attack_sec: 0.0,
                decay_sec: 0.1,
                sustain: 0.7,
                release_sec: 0.1,
                elapsed: 0.0,
                held_for: 0.0,
            },
            noise: Noise::new(1),
            filter: 0.0,
            sample_rate: 48_000.0,
            active: false,
        }
    }

    #[inline]
    fn osc(&mut self) -> f32 {
        let dt = self.frequency / self.sample_rate;
        self.phase = (self.phase + dt).fract();
        self.phase2 = (self.phase2 + dt * 1.005).fract();
        let p = self.phase;
        let p2 = self.phase2;
        match self.preset {
            Preset::Sub | Preset::Kick => (2.0 * PI * p).sin(),
            Preset::Bass => (2.0 * p - 1.0) * 0.7 + (2.0 * PI * p).sin() * 0.3,
            Preset::Lead => (2.0 * p - 1.0) * 0.6 + (2.0 * p2 - 1.0) * 0.4,
            Preset::Keys => (2.0 * PI * p).sin() + (2.0 * PI * p * 3.0).sin() * 0.18,
            Preset::Chords => {
                (2.0 * p - 1.0) * 0.35 + (2.0 * p2 - 1.0) * 0.35 + (2.0 * PI * p).sin() * 0.3
            }
            Preset::Pluck => (2.0 * p - 1.0) * 0.8 + (2.0 * PI * p).sin() * 0.2,
            Preset::Pad => (2.0 * p - 1.0) * 0.35 + (2.0 * p2 - 1.0) * 0.35,
            Preset::Tom => (2.0 * PI * p).sin(),
            Preset::Fx => self.noise.next() * 0.5 + (2.0 * PI * p).sin() * 0.5,
            _ => self.noise.next(),
        }
    }

    #[inline]
    fn next_frame(&mut self) -> Option<(f32, f32)> {
        if !self.active {
            return None;
        }
        let env = self.adsr.level();
        self.adsr.elapsed += 1.0 / self.sample_rate;
        // Only the envelope schedule ends a voice: the first sample of an
        // attack legitimately has a level of zero.
        if self.adsr.finished() {
            self.active = false;
            return None;
        }

        let mut sample = if self.preset.pitched() {
            self.osc()
        } else {
            self.noise.next()
        };

        // Tone is a one-pole low-pass in 200 Hz .. 12 kHz, like the channel knob.
        let cutoff = 200.0 + self.tone.clamp(0.0, 1.0).powf(2.0) * 11_800.0;
        let coef = (-2.0 * PI * cutoff / self.sample_rate).exp();
        self.filter = sample * (1.0 - coef) + self.filter * coef;
        sample = self.filter;

        // Percussive pitch drop for the kick and tom.
        if matches!(self.preset, Preset::Kick) {
            self.frequency = (self.frequency * 0.9995).max(45.0);
        }

        let amp = env * self.velocity * self.gain;
        Some((sample * amp * self.pan_left, sample * amp * self.pan_right))
    }
}

/// A fixed-size pool: allocation-free in the callback, oldest voice stolen.
pub struct VoicePool {
    voices: Vec<Voice>,
    sample_rate: f32,
    next_seed: u32,
}

impl VoicePool {
    pub fn new(sample_rate: f32, max_voices: usize) -> Self {
        Self {
            voices: vec![Voice::silent(); max_voices.max(1)],
            sample_rate,
            next_seed: 0x9e37_79b9,
        }
    }

    pub fn active_voices(&self) -> usize {
        self.voices.iter().filter(|v| v.active).count()
    }

    pub fn all_notes_off(&mut self) {
        for voice in &mut self.voices {
            voice.active = false;
        }
    }

    /// Starts a voice for a channel. `duration` is the note length in seconds.
    pub fn trigger(
        &mut self,
        channel: &PlaybackChannel,
        pitch: u8,
        velocity: f32,
        duration: f32,
        gain: f32,
    ) {
        self.trigger_panned(channel, pitch, velocity, duration, gain, channel.pan);
    }

    /// Starts a voice with an explicit pan, used for per-clip panning.
    #[allow(clippy::too_many_arguments)]
    pub fn trigger_panned(
        &mut self,
        channel: &PlaybackChannel,
        pitch: u8,
        velocity: f32,
        duration: f32,
        gain: f32,
        pan: f32,
    ) {
        let slot = match self.voices.iter().position(|v| !v.active) {
            Some(i) => i,
            // Steal the quietest voice rather than dropping the note.
            None => self
                .voices
                .iter()
                .enumerate()
                .min_by(|a, b| a.1.velocity.partial_cmp(&b.1.velocity).unwrap())
                .map(|(i, _)| i)
                .unwrap_or(0),
        };

        let preset = Preset::from_id(&channel.preset);
        let frequency = midi_to_freq(pitch);
        let pan = pan.clamp(-1.0, 1.0);
        // Equal-power pan.
        let angle = (pan + 1.0) * 0.25 * PI;
        self.next_seed = self
            .next_seed
            .wrapping_mul(1_664_525)
            .wrapping_add(1_013_904_223);

        let attack = channel.attack.clamp(0.0, 1.0) * 0.08 + 0.002;
        let decay = channel.decay.clamp(0.0, 1.0) * 0.6 + 0.05;
        let release = channel.release.clamp(0.0, 1.0) * 0.8 + 0.02;

        let mut voice = Voice::silent();
        voice.preset = preset;
        voice.frequency = if matches!(preset, Preset::Kick) {
            frequency * 3.0
        } else {
            frequency
        };
        voice.velocity = velocity.clamp(0.0, 1.0);
        voice.gain = (channel.gain.max(0.0) * gain).clamp(0.0, 2.0);
        voice.pan_left = angle.cos();
        voice.pan_right = angle.sin();
        voice.tone = channel.tone;
        voice.phase = 0.0;
        voice.phase2 = 0.25;
        voice.filter = 0.0;
        voice.sample_rate = self.sample_rate;
        voice.noise = Noise::new(self.next_seed);
        voice.adsr = Adsr {
            attack_sec: if matches!(preset, Preset::Pad) {
                attack * 6.0
            } else {
                attack
            },
            decay_sec: decay,
            sustain: match preset {
                Preset::Pad => 0.85,
                Preset::Pluck | Preset::Hat | Preset::OpenHat => 0.15,
                Preset::Kick | Preset::Snare | Preset::Clap | Preset::Rim => 0.0,
                _ => 0.7,
            },
            release_sec: match preset {
                Preset::Hat => 0.05,
                Preset::OpenHat => release.max(0.25),
                _ => release,
            },
            elapsed: 0.0,
            held_for: duration.max(0.01),
        };
        voice.active = true;
        self.voices[slot] = voice;
    }

    #[inline]
    pub fn next_frame(&mut self) -> (f32, f32) {
        let mut left = 0.0;
        let mut right = 0.0;
        for voice in &mut self.voices {
            if let Some((l, r)) = voice.next_frame() {
                left += l;
                right += r;
            }
        }
        (left, right)
    }
}

pub fn midi_to_freq(pitch: u8) -> f32 {
    440.0 * 2f32.powf((pitch as f32 - 69.0) / 12.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn channel(preset: &str) -> PlaybackChannel {
        PlaybackChannel {
            id: "c1".into(),
            preset: preset.into(),
            gain: 1.0,
            pan: 0.0,
            mute: false,
            solo: false,
            root: 60,
            attack: 0.05,
            decay: 0.2,
            release: 0.2,
            tone: 0.8,
        }
    }

    #[test]
    fn midi_conversion_matches_equal_temperament() {
        assert!((midi_to_freq(69) - 440.0).abs() < 0.01);
        assert!((midi_to_freq(81) - 880.0).abs() < 0.1);
        assert!((midi_to_freq(60) - 261.63).abs() < 0.2);
    }

    #[test]
    fn a_triggered_voice_produces_sound_then_finishes() {
        let mut pool = VoicePool::new(48_000.0, 8);
        pool.trigger(&channel("lead"), 60, 1.0, 0.05, 1.0);
        let mut peak = 0.0f32;
        for _ in 0..24_000 {
            let (l, r) = pool.next_frame();
            peak = peak.max(l.abs()).max(r.abs());
        }
        assert!(peak > 0.01, "voice was silent: {peak}");
        assert_eq!(pool.active_voices(), 0, "voice never released");
    }

    #[test]
    fn pan_places_energy_in_one_channel() {
        let mut left = channel("keys");
        left.pan = -1.0;
        let mut right = channel("keys");
        right.pan = 1.0;

        let energy = |c: PlaybackChannel| {
            let mut pool = VoicePool::new(48_000.0, 4);
            pool.trigger(&c, 60, 1.0, 0.1, 1.0);
            let (mut l, mut r) = (0.0f32, 0.0f32);
            for _ in 0..8_000 {
                let (a, b) = pool.next_frame();
                l += a.abs();
                r += b.abs();
            }
            (l, r)
        };

        let (l1, r1) = energy(left);
        let (l2, r2) = energy(right);
        assert!(l1 > r1, "hard-left pan leaked: {l1} vs {r1}");
        assert!(r2 > l2, "hard-right pan leaked: {l2} vs {r2}");
    }

    #[test]
    fn clip_pan_overrides_the_channel_pan() {
        let mut centered = channel("keys");
        centered.pan = 0.0;
        let mut pool = VoicePool::new(48_000.0, 4);
        pool.trigger_panned(&centered, 60, 1.0, 0.1, 1.0, 1.0);
        let (mut l, mut r) = (0.0f32, 0.0f32);
        for _ in 0..8_000 {
            let (a, b) = pool.next_frame();
            l += a.abs();
            r += b.abs();
        }
        assert!(r > l * 1.5, "clip pan was ignored: {l} vs {r}");
    }

    #[test]
    fn voice_pool_never_exceeds_its_size() {
        let mut pool = VoicePool::new(48_000.0, 4);
        for i in 0..32 {
            pool.trigger(&channel("pad"), 40 + i, 1.0, 1.0, 1.0);
            assert!(pool.active_voices() <= 4);
        }
    }
}
