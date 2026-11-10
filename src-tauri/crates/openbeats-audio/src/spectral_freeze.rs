//! Spectral freeze / blur.
//!
//! Captures one window of audio, throws away its phase, smooths the magnitude
//! spectrum (the "blur" knob) and re-synthesises a sustain from it. Useful as a
//! transition texture and cheap enough to run offline on the recovery buffer.

use rustfft::num_complex::Complex;
use rustfft::FftPlanner;

fn hann(size: usize) -> Vec<f32> {
    (0..size)
        .map(|i| {
            let x = std::f32::consts::PI * i as f32 / size as f32;
            x.sin() * x.sin()
        })
        .collect()
}

fn next_random(state: &mut u32) -> f32 {
    *state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
    (*state >> 8) as f32 / 16_777_216.0
}

/// Smooths the magnitudes with a moving average whose radius follows `blur`.
fn blur_magnitudes(magnitudes: &[f32], blur: f32) -> Vec<f32> {
    let radius = (blur.clamp(0.0, 1.0) * 24.0).round() as usize;
    if radius == 0 {
        return magnitudes.to_vec();
    }
    let mut out = vec![0.0f32; magnitudes.len()];
    let mut sum = 0.0f32;
    let mut count = 0usize;
    for index in 0..magnitudes.len() {
        let add = index + radius;
        if add < magnitudes.len() && add >= radius {
            sum += magnitudes[add];
            count += 1;
        }
        if index >= radius + 1 {
            sum -= magnitudes[index - radius - 1];
            count = count.saturating_sub(1);
        }
        let window = (index + radius + 1).min(magnitudes.len()) - index.saturating_sub(radius);
        out[index] = sum / count.max(1) as f32 * (window as f32 / (window as f32 + 1.0));
    }
    out
}

/// Re-synthesises `seconds` of frozen texture from `samples`.
///
/// Returns silence when the input is silent, so a freeze on an empty buffer does
/// not invent noise.
pub fn freeze(samples: &[f32], sample_rate: f32, seconds: f32, blur: f32) -> Vec<f32> {
    let rate = if sample_rate > 0.0 {
        sample_rate
    } else {
        48_000.0
    };
    let frames = ((seconds.clamp(0.1, 30.0) * rate) as usize).max(256);
    if samples.len() < 256 {
        return vec![0.0; frames];
    }
    // A power of two that never exceeds the buffer itself.
    let floor_pow2 = 1usize << (usize::BITS - 1 - samples.len().leading_zeros());
    let size = floor_pow2.min(4_096).max(256);
    let window = hann(size);
    let mid = samples.len() / 2;
    let start = mid.saturating_sub(size / 2).min(samples.len() - size);

    let mut buffer: Vec<Complex<f32>> = (0..size)
        .map(|i| Complex::new(samples[start + i] * window[i], 0.0))
        .collect();
    let mut planner = FftPlanner::<f32>::new();
    let forward = planner.plan_fft_forward(size);
    forward.process(&mut buffer);

    let magnitudes: Vec<f32> = buffer.iter().map(|c| c.norm()).collect();
    if magnitudes.iter().sum::<f32>() < 1e-6 {
        return vec![0.0; frames];
    }
    let smoothed = blur_magnitudes(&magnitudes, blur);

    // Deterministic pseudo-random phases: the same capture and blur always give
    // the same texture, which keeps a re-bounce identical.
    let mut seed = 0x9e37_79b9u32 ^ (blur.clamp(0.0, 1.0) * 1_000.0) as u32;
    let mut spectrum: Vec<Complex<f32>> = (0..size)
        .map(|index| {
            let phase = next_random(&mut seed) * std::f32::consts::TAU;
            Complex::from_polar(smoothed[index] / size as f32, phase)
        })
        .collect();
    // Keep it real-valued by mirroring the conjugate half.
    for index in 1..size / 2 {
        spectrum[size - index] = spectrum[index].conj();
    }

    let inverse = planner.plan_fft_inverse(size);
    inverse.process(&mut spectrum);
    let block: Vec<f32> = spectrum.iter().map(|c| c.re).collect();
    let peak = block.iter().fold(0.0f32, |m, s| m.max(s.abs()));
    let gain = if peak > 1e-6 { 0.4 / peak } else { 0.0 };

    // Tile the block with a crossfade so the texture loops without a seam.
    let mut out = vec![0.0f32; frames];
    let hop = size / 2;
    let fade = size / 4;
    let mut position = 0usize;
    while position < frames {
        for i in 0..size {
            let target = position + i;
            if target >= frames {
                break;
            }
            let mut value = block[i] * gain;
            // Fade in the first `fade` samples and out over the block's tail.
            if i < fade {
                value *= i as f32 / fade as f32;
            } else if i > size - fade {
                value *= (size - i) as f32 / fade as f32;
            }
            out[target] += value;
        }
        position += hop;
    }
    for sample in &mut out {
        if !sample.is_finite() {
            *sample = 0.0;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f32, frames: usize) -> Vec<f32> {
        (0..frames)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / 48_000.0).sin() * 0.5)
            .collect()
    }

    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|s| s * s).sum::<f32>() / samples.len().max(1) as f32).sqrt()
    }

    #[test]
    fn a_tonal_capture_turns_into_a_sustain() {
        let frozen = freeze(&sine(440.0, 16_384), 48_000.0, 2.0, 0.0);
        assert_eq!(frozen.len(), 96_000);
        assert!(rms(&frozen) > 0.02, "rms {}", rms(&frozen));
        assert!(frozen.iter().all(|s| s.is_finite() && s.abs() <= 1.0));
    }

    #[test]
    fn silence_stays_silent() {
        let frozen = freeze(&[0.0; 8_192], 48_000.0, 1.0, 0.5);
        assert!(frozen.iter().all(|s| *s == 0.0));
    }

    #[test]
    fn the_result_is_reproducible() {
        let input = sine(220.0, 8_192);
        let first = freeze(&input, 44_100.0, 0.5, 0.3);
        let second = freeze(&input, 44_100.0, 0.5, 0.3);
        assert_eq!(first, second);
    }

    #[test]
    fn blur_smooths_but_keeps_the_energy() {
        let input = sine(660.0, 8_192);
        let sharp = freeze(&input, 48_000.0, 1.0, 0.0);
        let soft = freeze(&input, 48_000.0, 1.0, 1.0);
        assert!(rms(&soft) > 0.005);
        assert!((rms(&sharp) - rms(&soft)).abs() < 0.2);
    }

    #[test]
    fn tiny_buffers_are_handled() {
        assert_eq!(freeze(&[], 48_000.0, 0.5, 0.0).len(), 24_000);
        assert_eq!(freeze(&[0.1; 10], 48_000.0, 0.1, 0.0).len(), 4_800);
    }
}
