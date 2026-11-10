//! Mid/side processing for the mixer inserts.
//!
//! Encoding keeps the mono sum in `mid` and the stereo difference in `side`, so
//! a strip can process width independently of centre content. Decoding is the
//! exact inverse, so a unity mid/side pair is transparent.

/// Encodes a stereo frame into mid/side.
#[inline]
pub fn encode(left: f32, right: f32) -> (f32, f32) {
    ((left + right) * 0.5, (left - right) * 0.5)
}

/// Decodes mid/side back into stereo.
#[inline]
pub fn decode(mid: f32, side: f32) -> (f32, f32) {
    (mid + side, mid - side)
}

/// Mid/side processor: scales each component, then decodes.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MidSide {
    pub mid_gain: f32,
    pub side_gain: f32,
}

impl Default for MidSide {
    fn default() -> Self {
        Self {
            mid_gain: 1.0,
            side_gain: 1.0,
        }
    }
}

impl MidSide {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_gains(mid_gain: f32, side_gain: f32) -> Self {
        Self {
            mid_gain: mid_gain.max(0.0),
            side_gain: side_gain.max(0.0),
        }
    }

    #[inline]
    pub fn process(&mut self, left: f32, right: f32) -> (f32, f32) {
        let (mid, side) = encode(left, right);
        decode(mid * self.mid_gain, side * self.side_gain)
    }

    /// Processes a buffer of interleaved stereo frames in place.
    pub fn process_buffer(&mut self, frames: &mut [(f32, f32)]) {
        for frame in frames.iter_mut() {
            *frame = self.process(frame.0, frame.1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unity_mid_side_is_transparent() {
        let mut ms = MidSide::new();
        for (l, r) in [(0.3, -0.2), (0.0, 0.0), (1.0, 1.0), (-0.5, 0.25)] {
            let (out_l, out_r) = ms.process(l, r);
            assert!((out_l - l).abs() < 1e-6, "left changed: {out_l} vs {l}");
            assert!((out_r - r).abs() < 1e-6, "right changed: {out_r} vs {r}");
        }
    }

    #[test]
    fn encode_decode_round_trips() {
        let (m, s) = encode(0.7, -0.1);
        let (l, r) = decode(m, s);
        assert!((l - 0.7).abs() < 1e-6);
        assert!((r - -0.1).abs() < 1e-6);
    }

    #[test]
    fn removing_the_side_collapses_to_mono() {
        let mut ms = MidSide::with_gains(1.0, 0.0);
        let (l, r) = ms.process(0.8, 0.2);
        assert!((l - r).abs() < 1e-6, "not mono: {l} vs {r}");
        assert!((l - 0.5).abs() < 1e-6, "mid was not the average: {l}");
    }

    #[test]
    fn removing_the_mid_leaves_only_the_difference() {
        let mut ms = MidSide::with_gains(0.0, 1.0);
        let (l, r) = ms.process(0.8, 0.2);
        // side = 0.3, decoded as +0.3 / -0.3
        assert!((l - 0.3).abs() < 1e-6, "left was {l}");
        assert!((r - -0.3).abs() < 1e-6, "right was {r}");
    }

    #[test]
    fn identical_channels_have_no_side_content() {
        let (_, side) = encode(0.42, 0.42);
        assert!(side.abs() < 1e-6);
    }

    #[test]
    fn buffer_processing_matches_frame_processing() {
        let mut a = MidSide::with_gains(0.8, 1.4);
        let mut b = MidSide::with_gains(0.8, 1.4);
        let mut frames = [(0.2, -0.4), (0.9, 0.1)];
        let expected: Vec<(f32, f32)> = frames.iter().map(|f| b.process(f.0, f.1)).collect();
        a.process_buffer(&mut frames);
        for (got, want) in frames.iter().zip(expected.iter()) {
            assert!((got.0 - want.0).abs() < 1e-6);
            assert!((got.1 - want.1).abs() < 1e-6);
        }
    }
}
