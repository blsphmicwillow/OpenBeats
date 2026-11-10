//! fundsp graph glue (feature = "fundsp-graph").
//!
//! The hand-written processors in [`crate::dsp`] do the real work — biquad EQ,
//! compressor, limiter — because fundsp has no equivalent blocks with the same
//! parameters as the Web Audio inserts. fundsp builds the surrounding graph:
//! the summed master input, and the diagnostic sine used to prove a device is
//! alive.

use fundsp::hacker::*;

/// Sums the mono voice bus into a stereo master pair.
pub struct MasterGraph {
    unit: Box<dyn AudioUnit>,
}

impl MasterGraph {
    pub fn new(sample_rate: f32) -> Self {
        // One input, two equal-power outputs (`pan` is a mono-to-stereo panner).
        let mut graph = Self {
            unit: Box::new(pan(0.0)),
        };
        graph.set_sample_rate(sample_rate);
        graph
    }

    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        self.unit.set_sample_rate(sample_rate as f64);
    }

    /// Processes one frame of mono input into the stereo pair.
    #[inline]
    pub fn process(&mut self, mono: f32, gain: f32) -> (f32, f32) {
        let mut output = [0.0f32; 2];
        self.unit.tick(&[mono * gain], &mut output);
        (output[0], output[1])
    }
}

/// A sine oscillator for the "is this device working?" check.
pub struct ToneOscillator {
    unit: Box<dyn AudioUnit>,
}

impl ToneOscillator {
    pub fn new(frequency: f32, sample_rate: f32) -> Self {
        let mut unit: Box<dyn AudioUnit> = Box::new(sine_hz(frequency));
        unit.set_sample_rate(sample_rate as f64);
        Self { unit }
    }

    #[inline]
    pub fn next(&mut self) -> f32 {
        let mut output = [0.0f32; 1];
        self.unit.tick(&[], &mut output);
        output[0]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tone_oscillator_produces_a_signal() {
        let mut osc = ToneOscillator::new(440.0, 48_000.0);
        let mut peak: f32 = 0.0;
        let mut energy = 0.0f32;
        for _ in 0..4_800 {
            let sample = osc.next();
            peak = peak.max(sample.abs());
            energy += sample * sample;
        }
        assert!(peak > 0.9, "fundsp tone was silent: {peak}");
        assert!(energy > 1.0, "fundsp tone carried no energy");
    }

    #[test]
    fn master_graph_duplicates_the_mono_bus() {
        let mut graph = MasterGraph::new(48_000.0);
        let (left, right) = graph.process(0.25, 1.0);
        assert!(
            (left - right).abs() < 1e-6,
            "channels differ: {left} vs {right}"
        );
        assert!(left > 0.0, "no output: {left}");
    }

    #[test]
    fn master_gain_scales_the_output() {
        let mut graph = MasterGraph::new(48_000.0);
        let (quiet, _) = graph.process(0.5, 0.25);
        let mut graph2 = MasterGraph::new(48_000.0);
        let (loud, _) = graph2.process(0.5, 1.0);
        assert!(loud > quiet * 2.0, "gain ignored: {quiet} vs {loud}");
    }
}
