//! CPAL device layer (feature = "device").
//!
//! The stream is created and owned by a dedicated thread, because `cpal::Stream`
//! is not `Send` on every backend. The UI talks to that thread over a channel
//! and reads meters from atomics, which keeps the Tauri state `Send + Sync`.
//!
//! Realtime notes: state is shared with the callback through a `Mutex` that the
//! callback only ever tries to lock, so a stalled command thread produces a
//! dropped buffer, never a blocked audio thread. Moving to a lock-free ring is
//! tracked in docs/RUST_AUDIO.md; this milestone is about a real, audible
//! stream with real DSP, not about claiming RT purity.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;

use crate::dsp::{Compressor, Eq3, Limiter, Transmitter};
use crate::logger::AudioLogger;
use crate::sequencer::{PlaybackProject, Sequencer};
use crate::synth::VoicePool;
use crate::DEFAULT_SAMPLE_RATE;

/// What the audio thread is told to do.
pub enum EngineCommand {
    Play(PlaybackProject),
    Stop,
    SetMasterGain(f32),
    TestTone(f32),
    Shutdown,
}

#[derive(Debug, Default)]
struct Shared {
    playing: AtomicU32,
    step: AtomicU32,
    meter_left: AtomicU32,
    meter_right: AtomicU32,
    voices: AtomicU32,
    transient: AtomicU32,
    stream_errors: AtomicU32,
}

fn store_f32(slot: &AtomicU32, value: f32) {
    slot.store(value.to_bits(), Ordering::Relaxed);
}

fn load_f32(slot: &AtomicU32) -> f32 {
    f32::from_bits(slot.load(Ordering::Relaxed))
}

/// A snapshot for the UI: meters, transport position and stream health.
#[derive(Debug, Clone, serde::Serialize)]
pub struct EngineSnapshot {
    pub playing: bool,
    pub step: u32,
    pub meter_left: f32,
    pub meter_right: f32,
    pub voices: u32,
    pub transient: f32,
    pub stream_errors: u32,
    pub sample_rate: f32,
    pub device: String,
}

struct CallbackState {
    sample_rate: f32,
    sequencer: Option<Sequencer>,
    voice_pool: VoicePool,
    eq: [Eq3; 2],
    compressor: [Compressor; 2],
    limiter: [Limiter; 2],
    transmitter: Transmitter,
    logger: Arc<Mutex<AudioLogger>>,
    master_gain: f32,
    tone_seconds_left: f32,
    tone_phase: f32,
}

impl CallbackState {
    fn new(sample_rate: f32, logger: Arc<Mutex<AudioLogger>>) -> Self {
        let mut eq = [Eq3::new(sample_rate); 2];
        for band in &mut eq {
            band.set_params(0.0, 0.0, 0.0, 1_000.0);
        }
        let mut compressor = [Compressor::new(sample_rate); 2];
        for comp in &mut compressor {
            comp.set_params(-14.0, 3.0, 0.1, 0.25, 6.0, 0.0);
        }
        let mut limiter = [Limiter::new(sample_rate); 2];
        for lim in &mut limiter {
            lim.set_params(-0.3, 0.3);
        }
        Self {
            sample_rate,
            sequencer: None,
            voice_pool: VoicePool::new(sample_rate, 64),
            eq,
            compressor,
            limiter,
            transmitter: Transmitter::new(sample_rate),
            logger,
            master_gain: 1.0,
            tone_seconds_left: 0.0,
            tone_phase: 0.0,
        }
    }

    /// Renders one stereo frame through the whole chain, plus the transmitter's
    /// transient reading for the UI.
    #[inline]
    fn next_frame(&mut self) -> (f32, f32, f32) {
        let mut left = 0.0f32;
        let mut right = 0.0f32;

        // Disjoint field borrows so the sequencer can be read while the voice
        // pool is written.
        let Self {
            sequencer,
            voice_pool,
            ..
        } = self;
        if let Some(seq) = sequencer.as_mut() {
            for trigger in seq.tick() {
                if let Some(channel) = seq.project().channels.get(trigger.channel_index) {
                    voice_pool.trigger_panned(
                        channel,
                        trigger.pitch,
                        trigger.velocity,
                        trigger.duration_sec,
                        trigger.gain,
                        trigger.pan,
                    );
                }
            }
        }
        let (voice_l, voice_r) = voice_pool.next_frame();
        left += voice_l;
        right += voice_r;

        // Test tone, so "is the device alive" is answerable without a project.
        if self.tone_seconds_left > 0.0 {
            let dt = 440.0 / self.sample_rate;
            self.tone_phase = (self.tone_phase + dt).fract();
            let tone = (2.0 * std::f32::consts::PI * self.tone_phase).sin() * 0.2;
            left += tone;
            right += tone;
            self.tone_seconds_left -= 1.0 / self.sample_rate;
        }

        let transient = self
            .transmitter
            .process((left + right) * 0.5)
            .transient_amount;

        for channel in 0..2 {
            let input = if channel == 0 { left } else { right };
            let shaped = self.eq[channel].process(input);
            let compressed = self.compressor[channel].process(shaped);
            let limited = self.limiter[channel].process(compressed);
            if channel == 0 {
                left = limited;
            } else {
                right = limited;
            }
        }

        left *= self.master_gain;
        right *= self.master_gain;
        (left.clamp(-1.0, 1.0), right.clamp(-1.0, 1.0), transient)
    }
}

/// The engine handle held by Tauri. Cheap to clone the shared state, owns the
/// command channel to the audio thread.
pub struct NativeEngine {
    commands: Sender<EngineCommand>,
    shared: Arc<Shared>,
    logger: Arc<Mutex<AudioLogger>>,
    sample_rate: f32,
    device: String,
    thread: Option<JoinHandle<()>>,
}

impl NativeEngine {
    /// Opens the default output device and keeps the stream alive on its thread.
    pub fn start() -> Result<Self, String> {
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(String, f32), String>>();
        let (command_tx, command_rx) = mpsc::channel::<EngineCommand>();
        let shared = Arc::new(Shared::default());
        let thread_shared = Arc::clone(&shared);

        let thread = std::thread::Builder::new()
            .name("openbeats-audio".into())
            .spawn(move || audio_thread(command_rx, thread_shared, ready_tx))
            .map_err(|e| format!("could not start the audio thread: {e}"))?;

        let (device, sample_rate) = ready_rx
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| "the audio device did not open in time".to_string())??;

        Ok(Self {
            commands: command_tx,
            shared,
            logger: shared_logger,
            sample_rate,
            device,
            thread: Some(thread),
        })
    }

    pub fn sample_rate(&self) -> f32 {
        self.sample_rate
    }

    /// The recovery ring buffer, shared with the audio callback.
    pub fn logger(&self) -> &Arc<Mutex<AudioLogger>> {
        &self.logger
    }

    pub fn device_name(&self) -> &str {
        &self.device
    }

    pub fn play(&self, project: PlaybackProject) -> Result<(), String> {
        self.commands
            .send(EngineCommand::Play(project))
            .map_err(|_| "the audio engine stopped".to_string())
    }

    pub fn stop(&self) {
        let _ = self.commands.send(EngineCommand::Stop);
    }

    pub fn set_master_gain(&self, gain: f32) {
        let _ = self.commands.send(EngineCommand::SetMasterGain(gain));
    }

    pub fn test_tone(&self, seconds: f32) {
        let _ = self.commands.send(EngineCommand::TestTone(seconds));
    }

    pub fn snapshot(&self) -> EngineSnapshot {
        EngineSnapshot {
            playing: self.shared.playing.load(Ordering::Relaxed) == 1,
            step: self.shared.step.load(Ordering::Relaxed),
            meter_left: load_f32(&self.shared.meter_left),
            meter_right: load_f32(&self.shared.meter_right),
            voices: self.shared.voices.load(Ordering::Relaxed),
            transient: load_f32(&self.shared.transient),
            stream_errors: self.shared.stream_errors.load(Ordering::Relaxed),
            sample_rate: self.sample_rate,
            device: self.device.clone(),
        }
    }

    /// Names of the available output devices.
    pub fn devices() -> Vec<String> {
        let host = cpal::default_host();
        match host.output_devices() {
            Ok(devices) => devices.filter_map(|d| d.name().ok()).collect(),
            Err(_) => Vec::new(),
        }
    }
}

impl Drop for NativeEngine {
    fn drop(&mut self) {
        let _ = self.commands.send(EngineCommand::Shutdown);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn audio_thread(
    commands: Receiver<EngineCommand>,
    shared: Arc<Shared>,
    ready: Sender<Result<(String, f32), String>>,
) {
    let host = cpal::default_host();
    let device = match host.default_output_device() {
        Some(device) => device,
        None => {
            let _ = ready.send(Err("no audio output device was found".into()));
            return;
        }
    };
    let name = device
        .name()
        .unwrap_or_else(|_| "default output".to_string());
    let supported = match device.default_output_config() {
        Ok(config) => config,
        Err(err) => {
            let _ = ready.send(Err(format!(
                "the output device has no usable config: {err}"
            )));
            return;
        }
    };
    let sample_format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let sample_rate = config.sample_rate.0 as f32;
    let channels = config.channels as usize;

    let logger = Arc::new(Mutex::new(AudioLogger::new(sample_rate, 60.0)));
    let state = Arc::new(Mutex::new(CallbackState::new(
        sample_rate,
        Arc::clone(&logger),
    )));

    let err_shared = Arc::clone(&shared);
    let error_fn = move |err: cpal::StreamError| {
        err_shared.stream_errors.fetch_add(1, Ordering::Relaxed);
        eprintln!("openbeats audio stream error: {err}");
    };

    let stream_result = match sample_format {
        SampleFormat::F32 => {
            let state = Arc::clone(&state);
            let shared = Arc::clone(&shared);
            device.build_output_stream(
                &config,
                move |data: &mut [f32], _| {
                    render(&state, &shared, data, channels, SampleWriter::F32)
                },
                error_fn,
                None,
            )
        }
        SampleFormat::I16 => {
            let state = Arc::clone(&state);
            let shared = Arc::clone(&shared);
            device.build_output_stream(
                &config,
                move |data: &mut [i16], _| {
                    render(&state, &shared, data, channels, SampleWriter::I16)
                },
                error_fn,
                None,
            )
        }
        SampleFormat::U16 => {
            let state = Arc::clone(&state);
            let shared = Arc::clone(&shared);
            device.build_output_stream(
                &config,
                move |data: &mut [u16], _| {
                    render(&state, &shared, data, channels, SampleWriter::U16)
                },
                error_fn,
                None,
            )
        }
        other => {
            let _ = ready.send(Err(format!("unsupported sample format: {other:?}")));
            return;
        }
    };

    let stream = match stream_result {
        Ok(stream) => stream,
        Err(err) => {
            let _ = ready.send(Err(format!("could not open the output stream: {err}")));
            return;
        }
    };

    if let Err(err) = stream.play() {
        let _ = ready.send(Err(format!("could not start the stream: {err}")));
        return;
    }

    let _ = ready.send(Ok((name, sample_rate)));

    while let Ok(command) = commands.recv() {
        let mut guard = match state.lock() {
            Ok(guard) => guard,
            Err(_) => break,
        };
        match command {
            EngineCommand::Play(project) => {
                guard.voice_pool.all_notes_off();
                guard.sequencer = Some(Sequencer::new(project, guard.sample_rate));
                shared.playing.store(1, Ordering::Relaxed);
            }
            EngineCommand::Stop => {
                if let Some(seq) = guard.sequencer.as_mut() {
                    seq.stop();
                }
                guard.voice_pool.all_notes_off();
                shared.playing.store(0, Ordering::Relaxed);
            }
            EngineCommand::SetMasterGain(gain) => {
                guard.master_gain = gain.clamp(0.0, 2.0);
            }
            EngineCommand::TestTone(seconds) => {
                guard.tone_seconds_left = seconds.max(0.0);
            }
            EngineCommand::Shutdown => break,
        }
    }

    drop(stream);
}

#[derive(Clone, Copy)]
enum SampleWriter {
    F32,
    I16,
    U16,
}

/// Writes interleaved output for any sample format from one render path.
trait WriteFrame {
    fn write_sample(&mut self, value: f32);
}

impl WriteFrame for f32 {
    #[inline]
    fn write_sample(&mut self, value: f32) {
        *self = value;
    }
}

impl WriteFrame for i16 {
    #[inline]
    fn write_sample(&mut self, value: f32) {
        *self = (value.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
    }
}

impl WriteFrame for u16 {
    #[inline]
    fn write_sample(&mut self, value: f32) {
        let normalized = (value.clamp(-1.0, 1.0) + 1.0) * 0.5;
        *self = (normalized * u16::MAX as f32) as u16;
    }
}

fn render<T: WriteFrame + Copy>(
    state: &Arc<Mutex<CallbackState>>,
    shared: &Arc<Shared>,
    data: &mut [T],
    channels: usize,
    _format: SampleWriter,
) {
    let mut guard = match state.try_lock() {
        Ok(guard) => guard,
        Err(_) => {
            for slot in data.iter_mut() {
                slot.write_sample(0.0);
            }
            return;
        }
    };

    let frames = data.len() / channels.max(1);
    let mut peak_left = 0.0f32;
    let mut peak_right = 0.0f32;
    let mut peak_transient = 0.0f32;
    let mut log = guard.logger.try_lock().ok();

    for frame in 0..frames {
        let (left, right, transient) = guard.next_frame();
        peak_left = peak_left.max(left.abs());
        peak_right = peak_right.max(right.abs());
        peak_transient = peak_transient.max(transient);
        if let Some(log) = log.as_mut() {
            log.push_frame(left, right);
        }
        for channel in 0..channels {
            let value = if channel == 0 {
                left
            } else if channel == 1 {
                right
            } else {
                (left + right) * 0.5
            };
            data[frame * channels + channel].write_sample(value);
        }
    }

    store_f32(&shared.meter_left, peak_left);
    store_f32(&shared.meter_right, peak_right);
    store_f32(&shared.transient, peak_transient);
    shared
        .voices
        .store(guard.voice_pool.active_voices() as u32, Ordering::Relaxed);
    let step = guard.sequencer.as_ref().map(|s| s.step()).unwrap_or(0);
    shared.step.store(step, Ordering::Relaxed);
    let playing = guard
        .sequencer
        .as_ref()
        .map(|s| s.is_playing())
        .unwrap_or(false);
    shared.playing.store(u32::from(playing), Ordering::Relaxed);
}

/// Fallback used when the `device` feature is off: the rest of the crate still
/// builds and tests, and the app can report a clear error.
pub fn unavailable_reason() -> &'static str {
    "This build was compiled without the native audio device layer."
}

pub const FALLBACK_SAMPLE_RATE: f32 = DEFAULT_SAMPLE_RATE;

/// Recovers the logger ring by asking a running engine; exposed through Tauri.
pub fn recover_recent(logger: &AudioLogger, seconds: f32) -> Vec<f32> {
    logger.recent(seconds)
}
