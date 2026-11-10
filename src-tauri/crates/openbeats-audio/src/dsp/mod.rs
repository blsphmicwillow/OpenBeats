//! Native DSP ported from `src/audio/effects.ts`.
//!
//! Every processor here is a plain Rust struct with a `process` method, so the
//! same code runs in the realtime callback and in offline tests.

mod dynamics;
mod eq;
mod transmitter;

pub use dynamics::{Compressor, Limiter};
pub use eq::{Biquad, Eq3};
pub use transmitter::{Transmitter, TransmitterSplit};

/// Clamp helper shared by the processors.
pub(crate) fn clamp(v: f32, lo: f32, hi: f32) -> f32 {
    if v < lo {
        lo
    } else if v > hi {
        hi
    } else {
        v
    }
}

/// One-pole smoothing coefficient for a time constant in seconds.
pub(crate) fn one_pole(sample_rate: f32, seconds: f32) -> f32 {
    if seconds <= 0.0 || sample_rate <= 0.0 {
        0.0
    } else {
        (-1.0 / (sample_rate * seconds)).exp()
    }
}
