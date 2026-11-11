//! Pure sample-preview helpers.
//!
//! The CPAL preview stream lives behind the `device` feature, but resampling is
//! deterministic and is tested without opening an output device.

/// Linearly resamples interleaved frames to the output device's rate.
pub(crate) fn resample_interleaved(
    samples: &[f32],
    channels: usize,
    source_rate: u32,
    target_rate: u32,
) -> Vec<f32> {
    let channels = channels.max(1);
    let frames = samples.len() / channels;
    if frames == 0 || source_rate == 0 || target_rate == 0 {
        return Vec::new();
    }
    if source_rate == target_rate {
        return samples[..frames * channels].to_vec();
    }

    let target_frames = ((frames as f64 * target_rate as f64) / source_rate as f64)
        .round()
        .max(1.0) as usize;
    let step = source_rate as f64 / target_rate as f64;
    let mut out = Vec::with_capacity(target_frames * channels);
    for frame in 0..target_frames {
        let position = frame as f64 * step;
        let index = position.floor() as usize;
        let next = (index + 1).min(frames - 1);
        let fraction = (position - index as f64) as f32;
        for channel in 0..channels {
            let a = samples[index * channels + channel];
            let b = samples[next * channels + channel];
            out.push(a + (b - a) * fraction);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_resampling_keeps_the_duration() {
        let samples = vec![0.25f32; 44_100 * 2];
        let out = resample_interleaved(&samples, 2, 44_100, 48_000);
        assert_eq!(out.len() / 2, 48_000);
        assert!(out.iter().all(|sample| (*sample - 0.25).abs() < 1e-6));
    }

    #[test]
    fn preview_resampling_leaves_a_matching_rate_untouched() {
        let samples = vec![0.1, -0.2, 0.3, -0.4];
        assert_eq!(resample_interleaved(&samples, 2, 48_000, 48_000), samples);
    }

    #[test]
    fn preview_interpolates_between_source_frames() {
        let samples = vec![0.0, 1.0];
        let out = resample_interleaved(&samples, 1, 1, 2);
        assert_eq!(out.len(), 4);
        assert!((out[1] - 0.5).abs() < 1e-6);
    }
}
