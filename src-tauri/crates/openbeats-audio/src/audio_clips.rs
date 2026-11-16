//! Sample playback for Playlist audio clips.

use serde::{Deserialize, Serialize};
use std::sync::Arc;

fn unity() -> f32 {
    1.0
}

fn empty_samples() -> Arc<Vec<f32>> {
    Arc::new(Vec::new())
}

/// One media clip on the song timeline. PCM is attached by the native command
/// thread before playback, so the callback only reads already-decoded samples.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PlaybackAudioClip {
    pub id: String,
    pub media_hash: String,
    pub media_ext: String,
    pub start_tick: u64,
    pub length_ticks: u64,
    #[serde(default)]
    pub source_offset_ticks: u64,
    #[serde(default = "unity")]
    pub gain: f32,
    #[serde(default)]
    pub pan: f32,
    #[serde(default)]
    pub fade_in: u64,
    #[serde(default)]
    pub fade_out: u64,
    #[serde(default)]
    pub loop_mode: String,
    #[serde(default)]
    pub reversed: bool,
    #[serde(default)]
    pub normalized: bool,
    #[serde(default)]
    pub muted: bool,
    #[serde(skip, default = "empty_samples")]
    pub samples: Arc<Vec<f32>>,
    #[serde(skip)]
    pub sample_rate: u32,
    #[serde(skip)]
    pub channels: u16,
    #[serde(skip, default = "unity")]
    pub normalization_gain: f32,
}

/// Mixes the clips active at `position_steps` into one stereo frame.
///
/// The function performs no allocation or locking, making it suitable for the
/// CPAL callback. Source decoding and peak analysis happen before playback.
pub fn render_audio_clips(
    clips: &[PlaybackAudioClip],
    position_steps: f32,
    bpm: f32,
) -> (f32, f32) {
    if !position_steps.is_finite() || !bpm.is_finite() || bpm <= 0.0 {
        return (0.0, 0.0);
    }

    let seconds_per_step = 15.0 / bpm;
    let mut left = 0.0;
    let mut right = 0.0;
    for clip in clips {
        if clip.muted || clip.length_ticks == 0 || clip.sample_rate == 0 {
            continue;
        }
        let channels = clip.channels.max(1) as usize;
        let frames = clip.samples.len() / channels;
        if frames == 0 {
            continue;
        }

        let start = clip.start_tick as f32 / 120.0;
        let length = clip.length_ticks as f32 / 120.0;
        let progress = position_steps - start;
        if progress < 0.0 || progress >= length {
            continue;
        }

        let source_offset = clip.source_offset_ticks as f32 / 120.0 * seconds_per_step;
        let progress_seconds = progress * seconds_per_step;
        let duration_seconds = frames as f32 / clip.sample_rate as f32;
        let loop_source = clip.loop_mode == "loop";
        let source_seconds = if clip.reversed {
            let segment_end = (source_offset + length * seconds_per_step).min(duration_seconds);
            segment_end - progress_seconds - 1.0 / clip.sample_rate as f32
        } else {
            source_offset + progress_seconds
        };
        let source_seconds = if loop_source && duration_seconds > 0.0 {
            source_seconds.rem_euclid(duration_seconds)
        } else {
            source_seconds
        };
        if source_seconds < 0.0 || source_seconds >= duration_seconds {
            continue;
        }

        let source_frame = source_seconds * clip.sample_rate as f32;
        let frame_a = (source_frame.floor() as usize).min(frames - 1);
        let frame_b = if loop_source {
            (frame_a + 1) % frames
        } else {
            (frame_a + 1).min(frames - 1)
        };
        let fraction = source_frame.fract();
        let channel_sample = |channel: usize| {
            let channel = channel.min(channels - 1);
            let a = clip.samples[frame_a * channels + channel];
            let b = clip.samples[frame_b * channels + channel];
            a + (b - a) * fraction
        };
        let (mut clip_left, mut clip_right) = if channels == 1 {
            let sample = channel_sample(0);
            (sample, sample)
        } else {
            (channel_sample(0), channel_sample(1))
        };

        let progress_ticks = progress * 120.0;
        let remaining_ticks = length * 120.0 - progress_ticks;
        let mut envelope = 1.0f32;
        if clip.fade_in > 0 {
            envelope = envelope.min(progress_ticks / clip.fade_in as f32);
        }
        if clip.fade_out > 0 {
            envelope = envelope.min(remaining_ticks / clip.fade_out as f32);
        }
        let gain = clip.gain.clamp(0.0, 4.0)
            * if clip.normalized {
                clip.normalization_gain.max(0.0)
            } else {
                1.0
            }
            * envelope.clamp(0.0, 1.0);

        let pan = clip.pan.clamp(-1.0, 1.0);
        if channels == 1 {
            let angle = (pan + 1.0) * std::f32::consts::FRAC_PI_4;
            clip_left *= angle.cos() * std::f32::consts::SQRT_2;
            clip_right *= angle.sin() * std::f32::consts::SQRT_2;
        } else if pan < 0.0 {
            clip_right *= 1.0 + pan;
        } else if pan > 0.0 {
            clip_left *= 1.0 - pan;
        }
        left += clip_left * gain;
        right += clip_right * gain;
    }
    (left, right)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clip(samples: Vec<f32>) -> PlaybackAudioClip {
        PlaybackAudioClip {
            id: "audio-1".into(),
            media_hash: "a".repeat(64),
            media_ext: "wav".into(),
            start_tick: 0,
            length_ticks: 960,
            source_offset_ticks: 0,
            gain: 1.0,
            pan: 0.0,
            fade_in: 0,
            fade_out: 0,
            loop_mode: "off".into(),
            reversed: false,
            normalized: false,
            muted: false,
            samples: Arc::new(samples),
            sample_rate: 8,
            channels: 1,
            normalization_gain: 1.0,
        }
    }

    #[test]
    fn plays_and_trims_audio_at_timeline_boundaries() {
        let audio = clip(vec![0.25; 8]);
        let (left, right) = render_audio_clips(&[audio], 0.5, 120.0);
        assert!((left - 0.25).abs() < 1e-6);
        assert!((right - 0.25).abs() < 1e-6);
        assert_eq!(
            render_audio_clips(&[clip(vec![0.25; 8])], 8.0, 120.0),
            (0.0, 0.0)
        );
    }

    #[test]
    fn loops_the_source_and_applies_fades() {
        let mut audio = clip(vec![0.5; 4]);
        audio.length_ticks = 960;
        audio.loop_mode = "loop".into();
        audio.fade_in = 120;
        audio.fade_out = 120;
        let (start_l, _) = render_audio_clips(&[audio.clone()], 0.0, 120.0);
        let (loop_l, _) = render_audio_clips(&[audio.clone()], 5.0, 120.0);
        let (end_l, _) = render_audio_clips(&[audio], 7.99, 120.0);
        assert_eq!(start_l, 0.0);
        assert!((loop_l - 0.5).abs() < 1e-6);
        assert!(end_l < 0.01);
    }
}
