//! Monophonic pitch detection for the tuner and audio-to-note input.
//!
//! Normalised autocorrelation with parabolic peak refinement. It is deliberately
//! dependency-free: the tuner has to work on the same buffers the input stream
//! already captured, without an extra model or library.

/// One tuner reading.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct Tuning {
    /// Detected fundamental in Hz.
    pub frequency: f32,
    /// Nearest MIDI note number.
    pub midi: u8,
    /// Deviation from that note in cents, -50..50.
    pub cents: f32,
    /// 0..1, how periodic the signal is.
    pub clarity: f32,
}

/// Frequency of a MIDI note in equal temperament (A4 = 440 Hz).
pub fn frequency_of(midi: u8) -> f32 {
    440.0 * 2f32.powf((midi as f32 - 69.0) / 12.0)
}

/// MIDI note plus cents for a frequency.
pub fn note_for(frequency: f32) -> (u8, f32) {
    let semitones = 69.0 + 12.0 * (frequency.max(1.0) / 440.0).log2();
    let midi = semitones.round().clamp(0.0, 127.0);
    let cents = (semitones - midi) * 100.0;
    (midi as u8, cents)
}

/// Detects the fundamental of a mono buffer, or `None` when it is silent/noisy.
pub fn detect(samples: &[f32], sample_rate: f32) -> Option<Tuning> {
    if samples.len() < 256 || sample_rate <= 0.0 {
        return None;
    }
    let mean = samples.iter().sum::<f32>() / samples.len() as f32;
    let centred: Vec<f32> = samples.iter().map(|s| s - mean).collect();
    let rms = (centred.iter().map(|s| s * s).sum::<f32>() / centred.len() as f32).sqrt();
    if rms < 1e-4 {
        return None;
    }
    // Zero crossings above a fraction of the peak weed out fricatives.
    let peak = centred.iter().fold(0.0f32, |m, s| m.max(s.abs()));
    if peak < 1e-3 {
        return None;
    }

    let min_lag = (sample_rate / 1_200.0).max(2.0) as usize;
    let max_lag = ((sample_rate / 55.0) as usize).min(samples.len() / 2);
    if max_lag <= min_lag + 2 {
        return None;
    }

    let energy: f32 = centred.iter().map(|s| s * s).sum();
    if energy <= f32::EPSILON {
        return None;
    }

    let mut best_lag = 0usize;
    let mut best = 0.0f32;
    let mut scores = vec![0.0f32; max_lag + 1];
    for lag in min_lag..=max_lag {
        let mut sum = 0.0f32;
        for i in 0..(centred.len() - lag) {
            sum += centred[i] * centred[i + lag];
        }
        let score = sum / energy;
        scores[lag] = score;
        if score > best {
            best = score;
            best_lag = lag;
        }
    }
    if best_lag == 0 || best < 0.35 {
        return None;
    }

    // Parabolic interpolation between the neighbouring lags.
    let left = scores[best_lag - 1];
    let right = scores.get(best_lag + 1).copied().unwrap_or(best);
    let denominator = left - 2.0 * best + right;
    let offset = if denominator.abs() > 1e-9 {
        (0.5 * (left - right) / denominator).clamp(-1.0, 1.0)
    } else {
        0.0
    };
    let lag = best_lag as f32 + offset;
    let frequency = sample_rate / lag;
    if !(40.0..=2_000.0).contains(&frequency) {
        return None;
    }
    let (midi, cents) = note_for(frequency);
    Some(Tuning {
        frequency,
        midi,
        cents: cents.clamp(-50.0, 50.0),
        clarity: best.clamp(0.0, 1.0),
    })
}

/// Note name (scientific pitch, no octave) for a MIDI number.
pub fn note_name(midi: u8) -> &'static str {
    const NAMES: [&str; 12] = [
        "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
    ];
    NAMES[midi as usize % 12]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f32, frames: usize) -> Vec<f32> {
        (0..frames)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / 48_000.0).sin() * 0.4)
            .collect()
    }

    #[test]
    fn concert_a_is_440() {
        let tuning = detect(&sine(440.0, 4_096), 48_000.0).unwrap();
        assert!((tuning.frequency - 440.0).abs() < 3.0, "{:?}", tuning);
        assert_eq!(tuning.midi, 69);
        assert!(tuning.cents.abs() < 10.0);
        assert!(tuning.clarity > 0.5);
    }

    #[test]
    fn octaves_land_on_the_right_notes() {
        let low = detect(&sine(110.0, 8_192), 48_000.0).unwrap();
        assert_eq!(low.midi, 45);
        let middle = detect(&sine(261.63, 4_096), 48_000.0).unwrap();
        assert_eq!(middle.midi, 60);
    }

    #[test]
    fn silence_and_noise_are_rejected() {
        assert!(detect(&[0.0; 2_048], 48_000.0).is_none());
        let mut seed = 12345u32;
        let noise: Vec<f32> = (0..4_096)
            .map(|_| {
                seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                (seed as f32 / u32::MAX as f32 - 0.5) * 0.5
            })
            .collect();
        assert!(detect(&noise, 48_000.0).is_none());
    }

    #[test]
    fn frequency_table_matches_equal_temperament() {
        assert!((frequency_of(69) - 440.0).abs() < 0.01);
        assert!((frequency_of(60) - 261.6256).abs() < 0.1);
        assert_eq!(note_name(69), "A");
        let (midi, cents) = note_for(445.0);
        assert_eq!(midi, 69);
        assert!(cents > 0.0 && cents < 25.0);
    }
}
