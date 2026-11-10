//! Extra CPAL streams: sample preview, input monitoring, recording and tuning
//! (feature = "device").
//!
//! These are deliberately separate from `engine`: clicking a sample in the
//! browser must never disturb project playback, and the input stream has to stay
//! open while the transport is stopped. Each stream is owned by its own thread
//! because `cpal::Stream` is not `Send` everywhere.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample};

use crate::pitch::{detect, Tuning};

fn store_f32(slot: &AtomicU32, value: f32) {
    slot.store(value.to_bits(), Ordering::Relaxed);
}

fn load_f32(slot: &AtomicU32) -> f32 {
    f32::from_bits(slot.load(Ordering::Relaxed))
}

/* ------------------------------------------------------------------ *
 * Preview stream
 * ------------------------------------------------------------------ */

struct PreviewShared {
    samples: Mutex<Vec<f32>>,
    position: AtomicU64,
    channels: AtomicU32,
    playing: AtomicBool,
    gain: AtomicU32,
}

impl Default for PreviewShared {
    fn default() -> Self {
        Self {
            samples: Mutex::new(Vec::new()),
            position: AtomicU64::new(0),
            channels: AtomicU32::new(2),
            playing: AtomicBool::new(false),
            gain: AtomicU32::new(1.0f32.to_bits()),
        }
    }
}

enum PreviewCommand {
    Play(Vec<f32>, u16),
    Stop,
    Shutdown,
}

/// A one-shot preview player on its own output stream.
pub struct PreviewEngine {
    commands: Sender<PreviewCommand>,
    shared: Arc<PreviewShared>,
    thread: Option<JoinHandle<()>>,
    device: String,
}

impl PreviewEngine {
    pub fn start() -> Result<Self, String> {
        let shared = Arc::new(PreviewShared::default());
        let (tx, rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<String, String>>();
        let thread_shared = Arc::clone(&shared);
        let thread = std::thread::Builder::new()
            .name("openbeats-preview".into())
            .spawn(move || preview_thread(rx, thread_shared, ready_tx))
            .map_err(|e| format!("could not start the preview thread: {e}"))?;
        let device = ready_rx
            .recv_timeout(Duration::from_secs(8))
            .map_err(|_| "the preview device did not open".to_string())??;
        Ok(Self {
            commands: tx,
            shared,
            thread: Some(thread),
            device,
        })
    }

    /// Plays interleaved samples, replacing anything already playing.
    pub fn play(&self, samples: Vec<f32>, channels: u16) -> Result<(), String> {
        self.commands
            .send(PreviewCommand::Play(samples, channels.max(1)))
            .map_err(|_| "the preview stream stopped".to_string())
    }

    pub fn stop(&self) {
        let _ = self.commands.send(PreviewCommand::Stop);
    }

    pub fn set_gain(&self, gain: f32) {
        store_f32(&self.shared.gain, gain.clamp(0.0, 2.0));
    }

    pub fn is_playing(&self) -> bool {
        self.shared.playing.load(Ordering::Relaxed)
    }

    pub fn device_name(&self) -> &str {
        &self.device
    }
}

impl Drop for PreviewEngine {
    fn drop(&mut self) {
        let _ = self.commands.send(PreviewCommand::Shutdown);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn preview_thread(
    commands: Receiver<PreviewCommand>,
    shared: Arc<PreviewShared>,
    ready: Sender<Result<String, String>>,
) {
    let host = cpal::default_host();
    let Some(device) = host.default_output_device() else {
        let _ = ready.send(Err("no output device for the preview stream".into()));
        return;
    };
    let name = device.name().unwrap_or_else(|_| "default output".into());
    let config = match device.default_output_config() {
        Ok(config) => config,
        Err(e) => {
            let _ = ready.send(Err(format!("preview device has no config: {e}")));
            return;
        }
    };
    let stream_config: cpal::StreamConfig = config.clone().into();
    let sample_format = config.sample_format();

    let stream = match sample_format {
        SampleFormat::F32 => build_preview::<f32>(&device, &stream_config, Arc::clone(&shared)),
        SampleFormat::I16 => build_preview::<i16>(&device, &stream_config, Arc::clone(&shared)),
        SampleFormat::U16 => build_preview::<u16>(&device, &stream_config, Arc::clone(&shared)),
        other => Err(format!("preview: unsupported sample format {other:?}")),
    };
    let stream = match stream {
        Ok(stream) => stream,
        Err(e) => {
            let _ = ready.send(Err(e));
            return;
        }
    };
    if let Err(e) = stream.play() {
        let _ = ready.send(Err(format!("preview stream did not start: {e}")));
        return;
    }
    let _ = ready.send(Ok(name));

    loop {
        match commands.recv_timeout(Duration::from_millis(250)) {
            Ok(PreviewCommand::Play(samples, channels)) => {
                if let Ok(mut buffer) = shared.samples.lock() {
                    *buffer = samples;
                }
                shared.channels.store(channels as u32, Ordering::Relaxed);
                shared.position.store(0, Ordering::Relaxed);
                shared.playing.store(true, Ordering::Relaxed);
            }
            Ok(PreviewCommand::Stop) => {
                shared.playing.store(false, Ordering::Relaxed);
            }
            Ok(PreviewCommand::Shutdown) | Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {}
        }
    }
    drop(stream);
}

fn build_preview<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    shared: Arc<PreviewShared>,
) -> Result<cpal::Stream, String>
where
    T: SizedSample + FromSample<f32>,
{
    let channels = config.channels as usize;
    device
        .build_output_stream(
            config,
            move |output: &mut [T], _| {
                let gain = load_f32(&shared.gain);
                let playing = shared.playing.load(Ordering::Relaxed);
                if !playing {
                    for sample in output.iter_mut() {
                        *sample = T::from_sample(0.0f32);
                    }
                    return;
                }
                let file_channels = shared.channels.load(Ordering::Relaxed).max(1) as usize;
                let Ok(buffer) = shared.samples.try_lock() else {
                    for sample in output.iter_mut() {
                        *sample = T::from_sample(0.0f32);
                    }
                    return;
                };
                let mut position = shared.position.load(Ordering::Relaxed) as usize;
                for frame in output.chunks_mut(channels) {
                    if position + file_channels > buffer.len() {
                        shared.playing.store(false, Ordering::Relaxed);
                        for sample in frame.iter_mut() {
                            *sample = T::from_sample(0.0f32);
                        }
                        continue;
                    }
                    for (channel, sample) in frame.iter_mut().enumerate() {
                        let value = buffer[position + channel % file_channels] * gain;
                        *sample = T::from_sample(value.clamp(-1.0, 1.0));
                    }
                    position += file_channels;
                }
                shared.position.store(position as u64, Ordering::Relaxed);
            },
            |err| eprintln!("[openbeats preview] stream error: {err}"),
            None,
        )
        .map_err(|e| format!("could not open the preview stream: {e}"))
}

/* ------------------------------------------------------------------ *
 * Input: monitor, recording and tuner
 * ------------------------------------------------------------------ */

struct InputShared {
    monitor: AtomicBool,
    monitor_gain: AtomicU32,
    recording: AtomicBool,
    recorded: Mutex<Vec<f32>>,
    record_rate: AtomicU32,
    record_channels: AtomicU32,
    level: AtomicU32,
    peak: AtomicU32,
    tuner_buffer: Mutex<Vec<f32>>,
    monitor_queue: Mutex<VecDeque<f32>>,
    sample_rate: AtomicU32,
}

impl Default for InputShared {
    fn default() -> Self {
        Self {
            monitor: AtomicBool::new(false),
            monitor_gain: AtomicU32::new(0.7f32.to_bits()),
            recording: AtomicBool::new(false),
            recorded: Mutex::new(Vec::new()),
            record_rate: AtomicU32::new(48_000),
            record_channels: AtomicU32::new(1),
            level: AtomicU32::new(0.0f32.to_bits()),
            peak: AtomicU32::new(0.0f32.to_bits()),
            tuner_buffer: Mutex::new(Vec::new()),
            monitor_queue: Mutex::new(VecDeque::new()),
            sample_rate: AtomicU32::new(48_000),
        }
    }
}

enum InputCommand {
    Monitor(bool, f32),
    StartRecording,
    StopRecording,
    Shutdown,
}

/// Input capture with optional monitoring through a second output stream.
pub struct InputCapture {
    commands: Sender<InputCommand>,
    shared: Arc<InputShared>,
    thread: Option<JoinHandle<()>>,
    device: String,
}

impl InputCapture {
    /// Opens `device` (or the default input) and its monitor output.
    pub fn start(device: Option<&str>) -> Result<Self, String> {
        let shared = Arc::new(InputShared::default());
        let (tx, rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<String, String>>();
        let thread_shared = Arc::clone(&shared);
        let requested = device.map(|d| d.to_string());
        let thread = std::thread::Builder::new()
            .name("openbeats-input".into())
            .spawn(move || input_thread(rx, thread_shared, ready_tx, requested))
            .map_err(|e| format!("could not start the input thread: {e}"))?;
        let device = ready_rx
            .recv_timeout(Duration::from_secs(8))
            .map_err(|_| "the input device did not open".to_string())??;
        Ok(Self {
            commands: tx,
            shared,
            thread: Some(thread),
            device,
        })
    }

    pub fn set_monitor(&self, on: bool, gain: f32) {
        store_f32(&self.shared.monitor_gain, gain.clamp(0.0, 1.0));
        let _ = self.commands.send(InputCommand::Monitor(on, gain));
    }

    pub fn start_recording(&self) {
        if let Ok(mut buffer) = self.shared.recorded.lock() {
            buffer.clear();
        }
        let _ = self.commands.send(InputCommand::StartRecording);
    }

    /// Stops recording and returns interleaved samples with their format.
    pub fn stop_recording(&self) -> (Vec<f32>, u32, u16) {
        let _ = self.commands.send(InputCommand::StopRecording);
        std::thread::sleep(Duration::from_millis(60));
        let samples = self
            .shared
            .recorded
            .lock()
            .map(|buffer| buffer.clone())
            .unwrap_or_default();
        (
            samples,
            self.shared.record_rate.load(Ordering::Relaxed),
            self.shared.record_channels.load(Ordering::Relaxed) as u16,
        )
    }

    pub fn is_recording(&self) -> bool {
        self.shared.recording.load(Ordering::Relaxed)
    }

    pub fn levels(&self) -> (f32, f32) {
        (load_f32(&self.shared.level), load_f32(&self.shared.peak))
    }

    /// Pitch of the last ~90 ms of input, when there is one.
    pub fn tuning(&self) -> Option<Tuning> {
        let buffer = self.shared.tuner_buffer.lock().ok()?;
        let rate = self.shared.sample_rate.load(Ordering::Relaxed) as f32;
        detect(&buffer, rate)
    }

    pub fn device_name(&self) -> &str {
        &self.device
    }
}

impl Drop for InputCapture {
    fn drop(&mut self) {
        let _ = self.commands.send(InputCommand::Shutdown);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn input_thread(
    commands: Receiver<InputCommand>,
    shared: Arc<InputShared>,
    ready: Sender<Result<String, String>>,
    requested: Option<String>,
) {
    let host = cpal::default_host();
    let device = match requested.as_deref() {
        Some(name) => host
            .input_devices()
            .ok()
            .and_then(|devices| {
                devices
                    .into_iter()
                    .find(|d| d.name().map(|n| n == name).unwrap_or(false))
            })
            .or_else(|| host.default_input_device()),
        None => host.default_input_device(),
    };
    let Some(device) = device else {
        let _ = ready.send(Err("no input device is available".into()));
        return;
    };
    let name = device.name().unwrap_or_else(|_| "default input".into());
    let config = match device.default_input_config() {
        Ok(config) => config,
        Err(e) => {
            let _ = ready.send(Err(format!("input device has no config: {e}")));
            return;
        }
    };
    let sample_format = config.sample_format();
    let stream_config: cpal::StreamConfig = config.clone().into();
    shared
        .sample_rate
        .store(config.sample_rate().0, Ordering::Relaxed);

    let input = match sample_format {
        SampleFormat::F32 => build_input::<f32>(&device, &stream_config, Arc::clone(&shared)),
        SampleFormat::I16 => build_input::<i16>(&device, &stream_config, Arc::clone(&shared)),
        SampleFormat::U16 => build_input::<u16>(&device, &stream_config, Arc::clone(&shared)),
        other => Err(format!("input: unsupported sample format {other:?}")),
    };
    let input = match input {
        Ok(stream) => stream,
        Err(e) => {
            let _ = ready.send(Err(e));
            return;
        }
    };
    if let Err(e) = input.play() {
        let _ = ready.send(Err(format!("input stream did not start: {e}")));
        return;
    }

    // Monitoring output. A missing output device is not fatal: recording and the
    // tuner still work, and the UI reports that monitoring is unavailable.
    let monitor_stream = host.default_output_device().and_then(|out| {
        let config = out.default_output_config().ok()?;
        let stream_config: cpal::StreamConfig = config.clone().into();
        match config.sample_format() {
            SampleFormat::F32 => {
                build_monitor::<f32>(&out, &stream_config, Arc::clone(&shared)).ok()
            }
            SampleFormat::I16 => {
                build_monitor::<i16>(&out, &stream_config, Arc::clone(&shared)).ok()
            }
            SampleFormat::U16 => {
                build_monitor::<u16>(&out, &stream_config, Arc::clone(&shared)).ok()
            }
            _ => None,
        }
    });
    if let Some(stream) = &monitor_stream {
        let _ = stream.play();
    }
    let _ = ready.send(Ok(name));

    loop {
        match commands.recv_timeout(Duration::from_millis(200)) {
            Ok(InputCommand::Monitor(on, gain)) => {
                shared.monitor.store(on, Ordering::Relaxed);
                store_f32(&shared.monitor_gain, gain.clamp(0.0, 1.0));
                if !on {
                    if let Ok(mut queue) = shared.monitor_queue.lock() {
                        queue.clear();
                    }
                }
            }
            Ok(InputCommand::StartRecording) => {
                if let Ok(mut buffer) = shared.recorded.lock() {
                    buffer.clear();
                    buffer.reserve(48_000 * 4 * 60);
                }
                shared.record_rate.store(
                    shared.sample_rate.load(Ordering::Relaxed),
                    Ordering::Relaxed,
                );
                // Captured takes are stored mono, so the WAV header says one channel.
                shared.record_channels.store(1, Ordering::Relaxed);
                shared.recording.store(true, Ordering::Relaxed);
            }
            Ok(InputCommand::StopRecording) => {
                shared.recording.store(false, Ordering::Relaxed);
            }
            Ok(InputCommand::Shutdown) | Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {}
        }
    }
    drop(input);
    if let Some(stream) = monitor_stream {
        drop(stream);
    }
}

fn build_input<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    shared: Arc<InputShared>,
) -> Result<cpal::Stream, String>
where
    T: SizedSample + FromSample<f32>,
    f32: FromSample<T>,
{
    let channels = config.channels as usize;
    shared
        .record_channels
        .store(channels as u32, Ordering::Relaxed);
    device
        .build_input_stream(
            config,
            move |input: &[T], _| {
                let recording = shared.recording.load(Ordering::Relaxed);
                let monitor = shared.monitor.load(Ordering::Relaxed);
                let gain = load_f32(&shared.monitor_gain);
                let mut sum_squares = 0.0f32;
                let mut peak = 0.0f32;
                let mut mono = Vec::with_capacity(input.len() / channels.max(1));
                for frame in input.chunks(channels) {
                    let mut mixed = 0.0f32;
                    for sample in frame {
                        mixed += sample.to_sample::<f32>();
                    }
                    mixed /= channels as f32;
                    mono.push(mixed);
                    sum_squares += mixed * mixed;
                    peak = peak.max(mixed.abs());
                }
                if recording {
                    if let Ok(mut buffer) = shared.recorded.try_lock() {
                        // Store mono so a recorded take loads as a one-channel clip.
                        buffer.extend_from_slice(&mono);
                    }
                }
                if monitor {
                    if let Ok(mut queue) = shared.monitor_queue.try_lock() {
                        for sample in &mono {
                            if queue.len() < 16_384 {
                                queue.push_back(sample * gain);
                            }
                        }
                    }
                }
                if let Ok(mut tuner) = shared.tuner_buffer.try_lock() {
                    tuner.extend_from_slice(&mono);
                    let keep =
                        (shared.sample_rate.load(Ordering::Relaxed) as usize / 10).max(1_024);
                    if tuner.len() > keep * 2 {
                        let drain = tuner.len() - keep;
                        tuner.drain(0..drain);
                    }
                }
                if !mono.is_empty() {
                    store_f32(&shared.level, (sum_squares / mono.len() as f32).sqrt());
                }
                store_f32(&shared.peak, peak);
            },
            |err| eprintln!("[openbeats input] stream error: {err}"),
            None,
        )
        .map_err(|e| format!("could not open the input stream: {e}"))
}

fn build_monitor<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    shared: Arc<InputShared>,
) -> Result<cpal::Stream, String>
where
    T: SizedSample + FromSample<f32>,
{
    let channels = config.channels as usize;
    device
        .build_output_stream(
            config,
            move |output: &mut [T], _| {
                let Ok(mut queue) = shared.monitor_queue.try_lock() else {
                    for sample in output.iter_mut() {
                        *sample = T::from_sample(0.0f32);
                    }
                    return;
                };
                for frame in output.chunks_mut(channels) {
                    let value = queue.pop_front().unwrap_or(0.0);
                    for sample in frame.iter_mut() {
                        *sample = T::from_sample(value);
                    }
                }
            },
            |err| eprintln!("[openbeats monitor] stream error: {err}"),
            None,
        )
        .map_err(|e| format!("could not open the monitor stream: {e}"))
}
