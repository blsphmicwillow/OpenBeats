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
use cpal::{FromSample, SampleFormat, SizedSample, SupportedBufferSize};

use crate::pitch::{detect, Tuning};
use crate::preview::resample_interleaved;

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
    Play(Vec<f32>, u16, u32),
    Stop,
    Shutdown,
}

/// A one-shot preview player on its own output stream.
pub struct PreviewEngine {
    commands: Sender<PreviewCommand>,
    shared: Arc<PreviewShared>,
    thread: Option<JoinHandle<()>>,
    device: String,
    requested: Option<String>,
}

impl PreviewEngine {
    pub fn start() -> Result<Self, String> {
        Self::start_with(None)
    }

    /// Opens the saved output (or the platform default) for sample auditions.
    pub fn start_with(requested: Option<String>) -> Result<Self, String> {
        let requested = normalize_preview_request(requested);
        let shared = Arc::new(PreviewShared::default());
        let (tx, rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<String, String>>();
        let thread_shared = Arc::clone(&shared);
        let thread_request = requested.clone();
        let thread = std::thread::Builder::new()
            .name("openbeats-preview".into())
            .spawn(move || preview_thread(rx, thread_shared, ready_tx, thread_request))
            .map_err(|e| format!("could not start the preview thread: {e}"))?;
        let device = ready_rx
            .recv_timeout(Duration::from_secs(8))
            .map_err(|_| "the preview device did not open".to_string())??;
        Ok(Self {
            commands: tx,
            shared,
            thread: Some(thread),
            device,
            requested,
        })
    }

    /// Plays interleaved samples, replacing anything already playing.
    pub fn play(&self, samples: Vec<f32>, channels: u16, sample_rate: u32) -> Result<(), String> {
        self.commands
            .send(PreviewCommand::Play(
                samples,
                channels.max(1),
                sample_rate.max(1),
            ))
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

    /// True when this stream is already opening the requested output.
    pub fn matches_request(&self, requested: Option<&str>) -> bool {
        self.requested.as_deref() == requested.map(str::trim).filter(|value| !value.is_empty())
    }
}

fn normalize_preview_request(requested: Option<String>) -> Option<String> {
    requested
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
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
    requested: Option<String>,
) {
    let (host, requested_name, sink) = preview_host(requested.as_deref());
    // Resolve the saved sink the same way the main engine does. A Bluetooth
    // headset that reconnected under a new profile name must not leave previews
    // pinned to a sink that no longer exists.
    #[cfg(target_os = "linux")]
    let sink = match crate::linux_audio::route_state() {
        Some(state) => state.target_sink(sink.as_deref()),
        None => sink,
    };
    #[cfg(target_os = "linux")]
    let _route = crate::linux_audio::route_sink(sink.as_deref());
    #[cfg(not(target_os = "linux"))]
    let _ = sink;

    let default_name = host.default_output_device().and_then(|d| d.name().ok());
    let mut devices = Vec::new();
    let mut candidates = Vec::new();
    if let Ok(outputs) = host.output_devices() {
        for device in outputs {
            let Ok(name) = device.name() else { continue };
            candidates.push(crate::devices::Candidate {
                is_default: default_name.as_deref() == Some(name.as_str()),
                name,
            });
            devices.push(device);
        }
    }
    let Some(index) = crate::devices::pick(
        &candidates,
        requested_name.as_deref(),
        cfg!(target_os = "linux"),
    ) else {
        let _ = ready.send(Err("no output device for the preview stream".into()));
        return;
    };
    let device = &devices[index];
    let name = candidates[index].name.clone();
    if let Some(want) = requested_name.as_deref() {
        if !name.eq_ignore_ascii_case(want) {
            eprintln!("openbeats: preview output \"{want}\" is unavailable; using \"{name}\"");
        }
    }

    let config = match choose_preview_config(device) {
        Ok(config) => config,
        Err(error) => {
            let _ = ready.send(Err(error));
            return;
        }
    };
    let sample_format = config.sample_format();
    let stream_config: cpal::StreamConfig = config.clone().into();
    let output_rate = config.sample_rate().0;

    let stream = match sample_format {
        SampleFormat::F32 => build_preview::<f32>(device, &stream_config, Arc::clone(&shared)),
        SampleFormat::F64 => build_preview::<f64>(device, &stream_config, Arc::clone(&shared)),
        SampleFormat::I8 => build_preview::<i8>(device, &stream_config, Arc::clone(&shared)),
        SampleFormat::I16 => build_preview::<i16>(device, &stream_config, Arc::clone(&shared)),
        SampleFormat::I32 => build_preview::<i32>(device, &stream_config, Arc::clone(&shared)),
        SampleFormat::U8 => build_preview::<u8>(device, &stream_config, Arc::clone(&shared)),
        SampleFormat::U16 => build_preview::<u16>(device, &stream_config, Arc::clone(&shared)),
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
            Ok(PreviewCommand::Play(samples, channels, sample_rate)) => {
                let channels = channels.max(1) as usize;
                let samples = resample_interleaved(&samples, channels, sample_rate, output_rate);
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

fn preview_format_supported(format: SampleFormat) -> bool {
    matches!(
        format,
        SampleFormat::F32
            | SampleFormat::F64
            | SampleFormat::I8
            | SampleFormat::I16
            | SampleFormat::I32
            | SampleFormat::U8
            | SampleFormat::U16
    )
}

fn choose_preview_config(device: &cpal::Device) -> Result<cpal::SupportedStreamConfig, String> {
    if let Ok(config) = device.default_output_config() {
        if preview_format_supported(config.sample_format()) {
            return Ok(config);
        }
    }
    device
        .supported_output_configs()
        .map_err(|error| format!("preview device has no config: {error}"))?
        .find(|range| preview_format_supported(range.sample_format()))
        .map(|range| range.with_max_sample_rate())
        .ok_or_else(|| "preview device has no supported sample format".to_string())
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

/// A small input period keeps monitoring and the tuner responsive. CPAL will
/// clamp this to the range the chosen backend actually accepts.
const INPUT_BUFFER_FRAMES: u32 = 256;

fn host_by_name(name: &str) -> Option<cpal::Host> {
    cpal::available_hosts()
        .into_iter()
        .find(|id| id.name().eq_ignore_ascii_case(name))
        .and_then(|id| cpal::host_from_id(id).ok())
}

/// Windows prefers WASAPI and falls back to ASIO when the installed build has
/// the ASIO backend. macOS always uses CoreAudio so the microphone permission
/// prompt is attached to the correct host. Linux keeps the host default.
fn configured_host() -> cpal::Host {
    #[cfg(target_os = "windows")]
    {
        for name in ["WASAPI", "ASIO"] {
            if let Some(host) = host_by_name(name) {
                return host;
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(host) = cpal::host_from_id(cpal::HostId::CoreAudio) {
            return host;
        }
    }
    cpal::default_host()
}

fn requested_input_host(requested: Option<&str>) -> (cpal::Host, Option<String>) {
    let Some(id) = requested else {
        return (configured_host(), None);
    };
    let (host_name, device_name) = crate::devices::split_device_id(id);
    let host = host_name
        .and_then(host_by_name)
        .unwrap_or_else(configured_host);
    (host, Some(device_name.to_string()))
}

/// Resolves a host-qualified output id for the preview stream. Linux synthetic
/// sink ids are routed with `PULSE_SINK`/`PIPEWIRE_NODE`; Windows WASAPI/ASIO
/// and macOS CoreAudio ids open the host the picker named.
fn preview_host(requested: Option<&str>) -> (cpal::Host, Option<String>, Option<String>) {
    let Some(id) = requested else {
        return (configured_host(), None, None);
    };
    let (host_name, device_name) = crate::devices::split_device_id(id);
    let host = host_name
        .and_then(host_by_name)
        .unwrap_or_else(configured_host);
    #[cfg(target_os = "linux")]
    let sink = crate::devices::requested_sink(id).map(str::to_string);
    #[cfg(not(target_os = "linux"))]
    let sink = None;
    let name = (!device_name.is_empty() && !device_name.starts_with("sink:"))
        .then(|| device_name.to_string());
    (host, name, sink)
}

fn find_input_device(host: &cpal::Host, requested: Option<&str>) -> Option<cpal::Device> {
    if let Some(name) = requested {
        if let Ok(devices) = host.input_devices() {
            if let Some(device) = devices.into_iter().find(|device| {
                device
                    .name()
                    .map(|candidate| candidate.eq_ignore_ascii_case(name))
                    .unwrap_or(false)
            }) {
                return Some(device);
            }
        }
    }
    host.default_input_device()
}

fn input_format_supported(format: SampleFormat) -> bool {
    matches!(
        format,
        SampleFormat::F32 | SampleFormat::I16 | SampleFormat::U16
    )
}

/// Keeps the device's native default configuration (format, rate and channel
/// count) when it is one capture understands, otherwise picks a supported
/// F32/I16/U16 configuration at its maximum rate.
fn choose_input_config(device: &cpal::Device) -> Result<cpal::SupportedStreamConfig, String> {
    if let Ok(config) = device.default_input_config() {
        if input_format_supported(config.sample_format()) {
            return Ok(config);
        }
    }

    let mut supported = device
        .supported_input_configs()
        .map_err(|error| format!("the input device has no supported configurations: {error}"))?;
    let range = supported
        .find(|range| input_format_supported(range.sample_format()))
        .ok_or_else(|| "the input device does not support F32, I16 or U16 samples".to_string())?;
    Ok(range.with_max_sample_rate())
}

fn input_buffer_size(size: &SupportedBufferSize) -> cpal::BufferSize {
    match size {
        SupportedBufferSize::Range { min, max } => {
            cpal::BufferSize::Fixed(INPUT_BUFFER_FRAMES.clamp(*min, *max).max(1))
        }
        SupportedBufferSize::Unknown => cpal::BufferSize::Fixed(INPUT_BUFFER_FRAMES),
    }
}

#[cfg(target_os = "windows")]
fn input_open_error(error: cpal::BuildStreamError) -> String {
    eprintln!("[openbeats input] build failed: {error}");
    "Microphone access denied. Please check Windows Privacy Settings.".to_string()
}

#[cfg(target_os = "macos")]
fn input_open_error(error: cpal::BuildStreamError) -> String {
    eprintln!("[openbeats input] build failed: {error}");
    match error {
        cpal::BuildStreamError::DeviceNotAvailable => "The microphone is unavailable. Open System Settings → Privacy & Security → Microphone, allow OpenBeats, then restart the app.".to_string(),
        other => format!(
            "Could not open the microphone: {other}. Check System Settings → Privacy & Security → Microphone."
        ),
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn input_open_error(error: cpal::BuildStreamError) -> String {
    eprintln!("[openbeats input] build failed: {error}");
    format!("could not open the input stream: {error}")
}

#[cfg(target_os = "windows")]
fn input_play_error(error: cpal::PlayStreamError) -> String {
    eprintln!("[openbeats input] start failed: {error}");
    "Microphone access denied. Please check Windows Privacy Settings.".to_string()
}

#[cfg(target_os = "macos")]
fn input_play_error(error: cpal::PlayStreamError) -> String {
    eprintln!("[openbeats input] start failed: {error}");
    "The microphone could not start. Check System Settings → Privacy & Security → Microphone and allow OpenBeats.".to_string()
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn input_play_error(error: cpal::PlayStreamError) -> String {
    eprintln!("[openbeats input] start failed: {error}");
    format!("input stream did not start: {error}")
}

fn input_thread(
    commands: Receiver<InputCommand>,
    shared: Arc<InputShared>,
    ready: Sender<Result<String, String>>,
    requested: Option<String>,
) {
    let (host, requested_name) = requested_input_host(requested.as_deref());
    let Some(device) = find_input_device(&host, requested_name.as_deref()) else {
        let _ = ready.send(Err("no input device is available".into()));
        return;
    };
    let name = device.name().unwrap_or_else(|_| "default input".into());
    let config = match choose_input_config(&device) {
        Ok(config) => config,
        Err(error) => {
            let _ = ready.send(Err(error));
            return;
        }
    };
    let sample_format = config.sample_format();
    let mut stream_config: cpal::StreamConfig = config.clone().into();
    stream_config.buffer_size = input_buffer_size(config.buffer_size());
    shared
        .sample_rate
        .store(config.sample_rate().0, Ordering::Relaxed);

    let input = match sample_format {
        SampleFormat::F32 => build_input::<f32>(&device, &stream_config, Arc::clone(&shared)),
        SampleFormat::I16 => build_input::<i16>(&device, &stream_config, Arc::clone(&shared)),
        SampleFormat::U16 => build_input::<u16>(&device, &stream_config, Arc::clone(&shared)),
        other => {
            let _ = ready.send(Err(format!("input: unsupported sample format {other:?}")));
            return;
        }
    };
    let input = match input {
        Ok(stream) => stream,
        Err(error) => {
            let _ = ready.send(Err(input_open_error(error)));
            return;
        }
    };
    if let Err(error) = input.play() {
        let _ = ready.send(Err(input_play_error(error)));
        return;
    }

    // Monitoring output. A missing output device is not fatal: recording and the
    // tuner still work, and the UI reports that monitoring is unavailable.
    let monitor_stream = host.default_output_device().and_then(|out| {
        let config = out.default_output_config().ok()?;
        let mut stream_config: cpal::StreamConfig = config.clone().into();
        stream_config.buffer_size = input_buffer_size(config.buffer_size());
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
) -> Result<cpal::Stream, cpal::BuildStreamError>
where
    T: SizedSample + FromSample<f32>,
    f32: FromSample<T>,
{
    let channels = config.channels as usize;
    shared
        .record_channels
        .store(channels as u32, Ordering::Relaxed);
    device.build_input_stream(
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
                let keep = (shared.sample_rate.load(Ordering::Relaxed) as usize / 10).max(1_024);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_requests_a_256_sample_buffer() {
        let size = SupportedBufferSize::Range { min: 64, max: 1024 };
        assert!(matches!(
            input_buffer_size(&size),
            cpal::BufferSize::Fixed(INPUT_BUFFER_FRAMES)
        ));
    }

    #[test]
    fn input_buffer_is_clamped_to_the_device_range() {
        let size = SupportedBufferSize::Range {
            min: 512,
            max: 2048,
        };
        assert!(matches!(
            input_buffer_size(&size),
            cpal::BufferSize::Fixed(512)
        ));
        let unknown = SupportedBufferSize::Unknown;
        assert!(matches!(
            input_buffer_size(&unknown),
            cpal::BufferSize::Fixed(INPUT_BUFFER_FRAMES)
        ));
    }
}
