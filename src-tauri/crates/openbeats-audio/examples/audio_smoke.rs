//! Headless audio smoke probe for CI.
//!
//! Two independent checks, because they fail for different reasons:
//!
//! * `--offline` renders a known project through the sequencer and synth with no
//!   device at all and asserts non-zero RMS. Works on every platform, including
//!   GitHub-hosted Windows runners, which have no audio endpoint.
//! * `--device <id>` opens the real CPAL layer and asserts that callbacks run.
//!   The tone peak is printed but not asserted: ALSA's `null` PCM consumes
//!   samples as fast as they are written, so a peak sampled from another thread
//!   can miss the tone even though the stream is healthy.
//!
//! Exit code 0 means the assertion passed, 1 means it failed, 2 means the probe
//! could not run (bad arguments, no device).

use std::process::ExitCode;

use openbeats_audio::sequencer::{PlaybackProject, Sequencer};
use openbeats_audio::synth::VoicePool;

const SAMPLE_RATE: f32 = 48_000.0;

/// A short project that sustains: RMS is only meaningful if the note lasts.
const PROJECT: &str = r#"{
  "bpm": 120,
  "steps": 16,
  "master_gain": 1.0,
  "channels": [
    { "id": "smoke", "preset": "keys", "root": 60, "gain": 0.9 }
  ],
  "notes": [
    { "channel": "smoke", "pitch": 60, "start": 0, "len": 16, "vel": 1.0 },
    { "channel": "smoke", "pitch": 64, "start": 8, "len": 8, "vel": 0.8 }
  ]
}"#;

struct Reading {
    frames: usize,
    peak: f32,
    rms: f32,
}

fn render_offline(seconds: f32) -> Result<Reading, String> {
    let project = PlaybackProject::from_json(PROJECT)?;
    let mut sequencer = Sequencer::new(project, SAMPLE_RATE);
    let mut pool = VoicePool::new(SAMPLE_RATE, 32);
    let mut triggers = Vec::with_capacity(64);
    let frames = (SAMPLE_RATE * seconds) as usize;
    let mut peak = 0.0f32;
    let mut sum = 0.0f64;

    for _ in 0..frames {
        sequencer.tick_into(&mut triggers);
        for trigger in triggers.iter() {
            if let Some(channel) = sequencer.project().channels.get(trigger.channel_index) {
                pool.trigger_panned(
                    channel,
                    trigger.pitch,
                    trigger.velocity,
                    trigger.duration_sec,
                    trigger.gain,
                    trigger.pan,
                );
            }
        }
        let (left, right) = pool.next_frame();
        let mono = (left + right) * 0.5;
        peak = peak.max(mono.abs());
        sum += (mono as f64) * (mono as f64);
    }

    Ok(Reading {
        frames,
        peak,
        rms: (sum / frames.max(1) as f64).sqrt() as f32,
    })
}

#[cfg(feature = "device")]
fn render_device(device: &str, seconds: f32) -> Result<(Reading, String, u32, String), String> {
    use std::time::{Duration, Instant};

    use openbeats_audio::engine::NativeEngine;

    let requested = if device.eq_ignore_ascii_case("auto") {
        None
    } else {
        Some(device.to_string())
    };
    let engine = NativeEngine::start_with(requested, false)?;
    let opened = engine.snapshot();
    let before = opened.callbacks;
    engine.test_tone(seconds);

    let mut peak = 0.0f32;
    let mut callbacks = 0u32;
    let deadline = Instant::now() + Duration::from_secs_f32(seconds + 2.0);
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
        let snapshot = engine.snapshot();
        peak = peak.max(snapshot.peak);
        callbacks = snapshot.callbacks.wrapping_sub(before);
        if callbacks > 0 && peak > 0.0 && Instant::now() + Duration::from_millis(200) < deadline {
            // Keep watching for a moment so the peak is not a single block.
            std::thread::sleep(Duration::from_millis(200));
        }
    }

    let final_state = engine.snapshot();
    Ok((
        Reading {
            frames: 0,
            peak,
            rms: 0.0,
        },
        final_state.device,
        callbacks,
        final_state.last_error,
    ))
}

fn usage() -> ExitCode {
    eprintln!("usage: audio_smoke --offline [--seconds N] | --device <id|auto> [--seconds N]");
    ExitCode::from(2)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut mode: Option<String> = None;
    let mut seconds = 1.5f32;

    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--offline" => mode = Some("offline".into()),
            "--device" => {
                index += 1;
                match args.get(index) {
                    Some(device) => mode = Some(format!("device:{device}")),
                    None => return usage(),
                }
            }
            "--seconds" => {
                index += 1;
                match args.get(index).and_then(|value| value.parse::<f32>().ok()) {
                    Some(value) => seconds = value.clamp(0.1, 30.0),
                    None => return usage(),
                }
            }
            "-h" | "--help" => return usage(),
            other => {
                eprintln!("unknown argument: {other}");
                return usage();
            }
        }
        index += 1;
    }

    let Some(mode) = mode else {
        return usage();
    };

    if mode == "offline" {
        match render_offline(seconds) {
            Ok(reading) => {
                println!(
                    "{{\"mode\":\"offline\",\"frames\":{},\"peak\":{:.5},\"rms\":{:.5}}}",
                    reading.frames, reading.peak, reading.rms
                );
                if reading.frames == 0 || reading.rms < 0.001 || reading.peak < 0.01 {
                    eprintln!(
                        "offline render produced no usable audio (peak {:.5}, rms {:.5})",
                        reading.peak, reading.rms
                    );
                    return ExitCode::from(1);
                }
                return ExitCode::SUCCESS;
            }
            Err(error) => {
                eprintln!("offline render failed: {error}");
                return ExitCode::from(1);
            }
        }
    }

    let device = mode.trim_start_matches("device:").to_string();

    #[cfg(feature = "device")]
    {
        match render_device(&device, seconds) {
            Ok((reading, opened, callbacks, last_error)) => {
                println!(
                    "{{\"mode\":\"device\",\"requested\":\"{}\",\"opened\":\"{}\",\"callbacks\":{},\"peak\":{:.5},\"last_error\":\"{}\"}}",
                    device,
                    opened.replace('"', "'"),
                    callbacks,
                    reading.peak,
                    last_error.replace('"', "'")
                );
                if callbacks == 0 {
                    eprintln!(
                        "the stream opened but delivered no callbacks (last error: {last_error})"
                    );
                    return ExitCode::from(1);
                }
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("device probe failed: {error}");
                ExitCode::from(1)
            }
        }
    }
    #[cfg(not(feature = "device"))]
    {
        let _ = device;
        eprintln!("this build has no device layer: rebuild with --features device");
        ExitCode::from(2)
    }
}
