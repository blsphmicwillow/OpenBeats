//! Spectral analysis for the UI spectrum display.
//!
//! A windowed real FFT (`rustfft`) turns a block of master audio into
//! magnitudes, which the React spectrum component draws. Analysing only on the
//! UI side keeps the audio callback free of FFT work.

use std::sync::Arc;

use rustfft::num_complex::Complex;
use rustfft::{Fft, FftPlanner};

/// A reusable windowed FFT.
pub struct SpectralAnalyzer {
    fft: Arc<dyn Fft<f32>>,
    size: usize,
    window: Vec<f32>,
    /// Mean window value, used to normalise magnitudes back to signal level.
    window_gain: f32,
    buffer: Vec<Complex<f32>>,
    scratch: Vec<Complex<f32>>,
}

impl SpectralAnalyzer {
    /// `size` is rounded up to a power of two and clamped to 64..=16384.
    pub fn new(size: usize) -> Self {
        let size = size.next_power_of_two().clamp(64, 16_384);
        let mut planner = FftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(size);
        let scratch = vec![Complex::new(0.0f32, 0.0); fft.get_inplace_scratch_len()];
        let window: Vec<f32> = (0..size)
            .map(|i| {
                let phase = std::f32::consts::TAU * i as f32 / size as f32;
                0.5 - 0.5 * phase.cos()
            })
            .collect();
        let window_gain = (window.iter().sum::<f32>() / size as f32).max(1e-6);
        Self {
            fft,
            size,
            window,
            window_gain,
            buffer: vec![Complex::new(0.0, 0.0); size],
            scratch,
        }
    }

    pub fn size(&self) -> usize {
        self.size
    }

    /// Number of bins `magnitudes` returns.
    pub fn bins(&self) -> usize {
        self.size / 2 + 1
    }

    /// Magnitude spectrum of the most recent `size` samples.
    ///
    /// Values are normalised so a full-scale sine reads about 1.0 in its bin,
    /// which makes the display independent of the FFT size.
    pub fn magnitudes(&mut self, samples: &[f32]) -> Vec<f32> {
        let start = samples.len().saturating_sub(self.size);
        let recent = &samples[start..];
        for (index, slot) in self.buffer.iter_mut().enumerate() {
            let value = recent.get(index).copied().unwrap_or(0.0) * self.window[index];
            *slot = Complex::new(value, 0.0);
        }
        self.fft
            .process_with_scratch(&mut self.buffer, &mut self.scratch);
        let scale = 2.0 / (self.size as f32 * self.window_gain);
        self.buffer[..self.size / 2 + 1]
            .iter()
            .map(|bin| bin.norm() * scale)
            .collect()
    }

    /// Magnitude per frequency band, averaging the bins inside each edge pair.
    ///
    /// `edges_hz` must ascend and be shorter than the bin count; a band with no
    /// bins reports zero.
    pub fn bands(&mut self, samples: &[f32], edges_hz: &[f32], sample_rate: f32) -> Vec<f32> {
        let spectrum = self.magnitudes(samples);
        if edges_hz.len() < 2 || sample_rate <= 0.0 {
            return Vec::new();
        }
        let bin_hz = sample_rate / self.size as f32;
        edges_hz
            .windows(2)
            .map(|pair| {
                let first = (pair[0] / bin_hz).floor().max(0.0) as usize;
                let last = ((pair[1] / bin_hz).ceil() as usize).min(spectrum.len());
                if first >= last {
                    return 0.0;
                }
                let slice = &spectrum[first..last];
                slice.iter().sum::<f32>() / slice.len() as f32
            })
            .collect()
    }
}

impl Default for SpectralAnalyzer {
    fn default() -> Self {
        Self::new(2048)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    fn sine(freq: f32, amplitude: f32, frames: usize) -> Vec<f32> {
        (0..frames)
            .map(|i| (std::f32::consts::TAU * freq * i as f32 / SR).sin() * amplitude)
            .collect()
    }

    #[test]
    fn a_sine_lands_in_the_expected_bin() {
        let mut analyzer = SpectralAnalyzer::new(4096);
        let spectrum = analyzer.magnitudes(&sine(1_000.0, 0.8, 4096));
        assert_eq!(spectrum.len(), 2049);
        let peak = spectrum
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
            .map(|(index, _)| index)
            .unwrap();
        let expected = (1_000.0 * 4096.0 / SR).round() as usize;
        assert!(
            peak.abs_diff(expected) <= 1,
            "peak bin {peak}, expected {expected}"
        );
    }

    #[test]
    fn a_full_scale_sine_reads_near_unity() {
        let mut analyzer = SpectralAnalyzer::new(4096);
        let spectrum = analyzer.magnitudes(&sine(1_000.0, 1.0, 4096));
        let peak = spectrum.iter().cloned().fold(0.0f32, f32::max);
        assert!(peak > 0.8 && peak < 1.2, "peak magnitude {peak}");
    }

    #[test]
    fn silence_has_no_energy() {
        let mut analyzer = SpectralAnalyzer::new(1024);
        let spectrum = analyzer.magnitudes(&[0.0; 1024]);
        assert!(spectrum.iter().all(|value| *value < 1e-6));
    }

    #[test]
    fn bands_follow_the_signal() {
        let mut analyzer = SpectralAnalyzer::new(4096);
        let edges = [20.0, 250.0, 2_000.0, 20_000.0];
        let low = analyzer.bands(&sine(100.0, 1.0, 4096), &edges, SR);
        let high = analyzer.bands(&sine(8_000.0, 1.0, 4096), &edges, SR);
        assert!(low[0] > low[1], "low tone leaked: {low:?}");
        assert!(high[1] > high[0], "high tone leaked: {high:?}");
    }

    #[test]
    fn the_size_is_a_bounded_power_of_two() {
        assert_eq!(SpectralAnalyzer::new(1_000).size(), 1024);
        assert_eq!(SpectralAnalyzer::new(10).size(), 64);
        assert_eq!(SpectralAnalyzer::new(1 << 20).size(), 16_384);
    }
}
