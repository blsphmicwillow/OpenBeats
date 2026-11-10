//! Audio Logger — a 60-second circular buffer on the master output.
//!
//! FL Studio's audio logger idea: everything that reaches the master is kept
//! whether or not the user hit record, so an unrecorded idea can be recovered.
//!
//! The ring is written from the audio callback and read from a command thread.
//! Writes use `try_lock` so a slow reader can never stall the callback; a
//! skipped frame costs one sample of recovery audio, never a glitch.

use std::f32::consts::PI;
use std::path::Path;

/// Default recovery window in seconds.
pub const DEFAULT_SECONDS: f32 = 60.0;

#[derive(Debug)]
pub struct AudioLogger {
    sample_rate: f32,
    /// Interleaved stereo: [l, r, l, r, ...]
    buffer: Vec<f32>,
    write_index: usize,
    /// Total frames pushed since the last clear, used to know how full the ring is.
    frames_written: u64,
    capacity_frames: usize,
}

impl AudioLogger {
    pub fn new(sample_rate: f32, seconds: f32) -> Self {
        let capacity_frames = ((sample_rate.max(1.0) * seconds.max(1.0)) as usize).max(1);
        Self {
            sample_rate,
            buffer: vec![0.0; capacity_frames * 2],
            write_index: 0,
            frames_written: 0,
            capacity_frames,
        }
    }

    pub fn capacity_frames(&self) -> usize {
        self.capacity_frames
    }

    pub fn sample_rate(&self) -> f32 {
        self.sample_rate
    }

    /// Frames actually available (saturates at the capacity).
    pub fn available_frames(&self) -> usize {
        self.frames_written.min(self.capacity_frames as u64) as usize
    }

    #[inline]
    pub fn push_frame(&mut self, left: f32, right: f32) {
        let idx = self.write_index * 2;
        self.buffer[idx] = left;
        self.buffer[idx + 1] = right;
        self.write_index += 1;
        if self.write_index >= self.capacity_frames {
            self.write_index = 0;
        }
        self.frames_written = self.frames_written.saturating_add(1);
    }

    pub fn clear(&mut self) {
        self.buffer.fill(0.0);
        self.write_index = 0;
        self.frames_written = 0;
    }

    /// The most recent `seconds` of audio, interleaved and in chronological order.
    pub fn recent(&self, seconds: f32) -> Vec<f32> {
        let available = self.available_frames();
        let wanted = ((self.sample_rate * seconds.max(0.0)) as usize).min(available);
        if wanted == 0 {
            return Vec::new();
        }
        let start_frame = (self.write_index + self.capacity_frames - wanted) % self.capacity_frames;
        let mut out = Vec::with_capacity(wanted * 2);
        for i in 0..wanted {
            let frame = (start_frame + i) % self.capacity_frames;
            out.push(self.buffer[frame * 2]);
            out.push(self.buffer[frame * 2 + 1]);
        }
        out
    }

    /// Writes the recovered audio as a 16-bit stereo WAV file.
    pub fn write_wav(&self, seconds: f32, path: &Path) -> std::io::Result<usize> {
        let samples = self.recent(seconds);
        let frames = samples.len() / 2;
        let data_bytes = (samples.len() * 2) as u32;
        let mut out = Vec::with_capacity(44 + samples.len() * 2);
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + data_bytes).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes()); // PCM
        out.extend_from_slice(&2u16.to_le_bytes()); // stereo
        out.extend_from_slice(&(self.sample_rate as u32).to_le_bytes());
        let byte_rate = self.sample_rate as u32 * 4;
        out.extend_from_slice(&byte_rate.to_le_bytes());
        out.extend_from_slice(&4u16.to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&data_bytes.to_le_bytes());
        for sample in samples {
            let clamped = sample.clamp(-1.0, 1.0);
            out.extend_from_slice(&((clamped * 32_767.0) as i16).to_le_bytes());
        }
        std::fs::write(path, out)?;
        Ok(frames)
    }
}

/// Convenience: a one-second sine, used by tests and by the startup self-check.
pub fn sine_frame(frames: usize, sample_rate: f32, freq: f32, amp: f32) -> Vec<f32> {
    (0..frames)
        .flat_map(|i| {
            let s = (2.0 * PI * freq * i as f32 / sample_rate).sin() * amp;
            [s, s]
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_most_recent_seconds_in_order() {
        let mut log = AudioLogger::new(1_000.0, 2.0);
        for i in 0..3_000 {
            log.push_frame(i as f32, -(i as f32));
        }
        let recent = log.recent(0.5);
        assert_eq!(recent.len(), 1_000); // 500 frames * 2 channels
                                         // Chronological: the last frame pushed is last.
        assert_eq!(recent[recent.len() - 2], 2_999.0);
        assert_eq!(recent[0], 2_500.0);
    }

    #[test]
    fn wraps_without_losing_capacity() {
        let mut log = AudioLogger::new(100.0, 1.0);
        assert_eq!(log.capacity_frames(), 100);
        for i in 0..250 {
            log.push_frame(i as f32, 0.0);
        }
        assert_eq!(log.available_frames(), 100);
        let all = log.recent(10.0);
        assert_eq!(all.len(), 200);
        assert_eq!(all[0], 150.0);
        assert_eq!(all[198], 249.0);
    }

    #[test]
    fn clear_empties_the_ring() {
        let mut log = AudioLogger::new(100.0, 1.0);
        for _ in 0..10 {
            log.push_frame(0.5, 0.5);
        }
        log.clear();
        assert_eq!(log.available_frames(), 0);
        assert!(log.recent(1.0).is_empty());
    }

    #[test]
    fn writes_a_valid_stereo_wav() {
        let mut log = AudioLogger::new(8_000.0, 1.0);
        for sample in sine_frame(800, 8_000.0, 440.0, 0.5).chunks(2) {
            log.push_frame(sample[0], sample[1]);
        }
        let path = std::env::temp_dir().join("openbeats-logger-test.wav");
        let frames = log.write_wav(1.0, &path).expect("wav wrote");
        assert_eq!(frames, 800);
        let bytes = std::fs::read(&path).expect("wav read");
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(bytes.len(), 44 + 800 * 4);
        let _ = std::fs::remove_file(path);
    }
}
