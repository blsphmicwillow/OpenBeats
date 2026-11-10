//! OpenBeats Gain — the smallest useful native plugin that proves the
//! OpenBeats plugin distribution pipeline (VST3 + CLAP) works.
//!
//! Build with `cargo build --release`; the platform bundle is assembled by
//! `plugins/openbeats-gain/build.sh`.

use nice_plug::prelude::*;
use std::sync::Arc;

pub struct OpenBeatsGain {
    params: Arc<OpenBeatsGainParams>,
}

#[derive(Params)]
struct OpenBeatsGainParams {
    /// Stored as linear gain, displayed to the host in decibels.
    #[id = "gain"]
    pub gain: FloatParam,
}

impl Default for OpenBeatsGainParams {
    fn default() -> Self {
        Self {
            gain: FloatParam::new(
                "Gain",
                util::db_to_gain(0.0),
                FloatRange::Skewed {
                    min: util::db_to_gain(-30.0),
                    max: util::db_to_gain(30.0),
                    factor: FloatRange::gain_skew_factor(-30.0, 30.0),
                },
            )
            .with_smoother(SmoothingStyle::Logarithmic(50.0))
            .with_unit(" dB")
            .with_value_to_string(formatters::v2s_f32_gain_to_db(2))
            .with_string_to_value(formatters::s2v_f32_gain_to_db()),
        }
    }
}

impl Default for OpenBeatsGain {
    fn default() -> Self {
        Self {
            params: Arc::new(OpenBeatsGainParams::default()),
        }
    }
}

impl Plugin for OpenBeatsGain {
    const NAME: &'static str = "OpenBeats Gain";
    const VENDOR: &'static str = "OpenBeats";
    const URL: &'static str = "https://github.com/blsphmicwillow/OpenBeats";
    const EMAIL: &'static str = "blsphmicwillow@users.noreply.github.com";
    const VERSION: &'static str = env!("CARGO_PKG_VERSION");

    const AUDIO_IO_LAYOUTS: &'static [AudioIOLayout] = &[
        // Stereo is the normal OpenBeats channel layout.
        AudioIOLayout {
            main_input_channels: NonZeroU32::new(2),
            main_output_channels: NonZeroU32::new(2),
            ..AudioIOLayout::const_default()
        },
        // Mono keeps the plugin useful on a single-voice insert.
        AudioIOLayout {
            main_input_channels: NonZeroU32::new(1),
            main_output_channels: NonZeroU32::new(1),
            ..AudioIOLayout::const_default()
        },
    ];

    const MIDI_INPUT: MidiConfig = MidiConfig::None;
    const SAMPLE_ACCURATE_AUTOMATION: bool = true;

    type Editor = ();
    type SysExMessage = ();
    type BackgroundTask = ();

    fn params(&self) -> Arc<dyn Params> {
        self.params.clone()
    }

    fn process(
        &mut self,
        buffer: &mut Buffer,
        _aux: &mut AuxiliaryBuffers,
        _context: &mut impl ProcessContext<Self>,
    ) -> ProcessStatus {
        for channel_samples in buffer.iter_samples() {
            let gain = self.params.gain.smoothed.next();
            for sample in channel_samples {
                *sample *= gain;
            }
        }

        ProcessStatus::Normal
    }
}

impl ClapPlugin for OpenBeatsGain {
    const CLAP_ID: &'static str = "studio.openbeats.gain";
    const CLAP_DESCRIPTION: Option<&'static str> =
        Some("A smoothed gain utility from the OpenBeats plugin example");
    const CLAP_MANUAL_URL: Option<&'static str> = Some(Self::URL);
    const CLAP_SUPPORT_URL: Option<&'static str> = Some(Self::URL);
    const CLAP_FEATURES: &'static [ClapFeature] = &[
        ClapFeature::AudioEffect,
        ClapFeature::Stereo,
        ClapFeature::Mono,
        ClapFeature::Utility,
    ];
}

impl Vst3Plugin for OpenBeatsGain {
    const VST3_CLASS_ID: [u8; 16] = *b"OpenBeatsGain001";
    const VST3_SUBCATEGORIES: &'static [Vst3SubCategory] =
        &[Vst3SubCategory::Fx, Vst3SubCategory::Tools];
}

nice_export_clap!(OpenBeatsGain);
nice_export_vst3!(OpenBeatsGain);
