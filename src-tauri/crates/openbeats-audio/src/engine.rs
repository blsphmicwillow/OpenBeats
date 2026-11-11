//! CPAL device layer (feature = "device").
//!
//! The stream is created and owned by a dedicated thread, because `cpal::Stream`
//! is not `Send` on every backend. The UI talks to that thread over a channel
//! and reads meters from atomics, which keeps the Tauri state `Send + Sync`.
//!
//! Linux note: ALSA's `default` PCM is often a null sink when PipeWire owns the
//! hardware, which is why playback can look fine (the step counter moves) while
//! nothing is audible. The device picker in `crate::devices` prefers the
//! PipeWire/PulseAudio bridge on Linux and every stream failure is logged, so the
//! UI can show which device actually opened.
//!
//! Realtime notes: state is shared with the callback through a `Mutex` that the
//! callback only ever tries to lock, so a stalled command thread produces a
//! dropped buffer, never a blocked audio thread.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample, SupportedBufferSize};

use crate::automation::AutomationLane;
use crate::devices::{self, AudioDevices, Candidate, DeviceInfo};
use crate::dsp::{Compressor, Eq3, Transmitter, TruePeakLimiter};
use crate::logger::AudioLogger;
use crate::mixer_runtime::MixerRuntime;
use crate::sequencer::{PlaybackChannel, PlaybackProject, Sequencer, Trigger};
use crate::strip::{gain_at, StripProcessor};
use crate::synth::VoicePool;
use crate::DEFAULT_SAMPLE_RATE;

/// What the audio thread is told to do.
pub enum EngineCommand {
    Play(PlaybackProject),
    Stop,
    SetMasterGain(f32),
    /// Level of the cue (headphone) bus on outputs 3/4.
    SetCueGain(f32),
    TestTone(f32),
    /// One synth note independent of the transport (instrument audition).
    PreviewNote {
        channel: PlaybackChannel,
        pitch: u8,
        velocity: f32,
        seconds: f32,
    },
    /// A metronome click right now; `true` accents the first beat of the bar.
    Click(bool),
    /// Move the native transport without stopping the stream.
    Seek(u32),
    /// Startup chime: decoded samples plus their original sample rate.
    Chime(Vec<f32>, u32),
    /// Reopen the stream on a named device, or the system default when `None`.
    SwitchDevice(Option<String>),
    /// Reopen the stream with the device's smallest buffer, or the default one.
    SetLowLatency(bool),
    /// Apply an output and latency choice together, avoiding two stream rebuilds.
    Reconfigure {
        device: Option<String>,
        low_latency: bool,
    },
    Shutdown,
}

/// Where the current session's recovery ring buffer lives. The slot is stable so
/// a stream restart does not invalidate the handle the UI holds.
pub type LoggerSlot = Arc<Mutex<Option<Arc<Mutex<AudioLogger>>>>>;

#[derive(Debug)]
struct Shared {
    playing: AtomicU32,
    step: AtomicU32,
    meter_left: AtomicU32,
    meter_right: AtomicU32,
    voices: AtomicU32,
    transient: AtomicU32,
    stream_errors: AtomicU32,
    sample_rate: AtomicU32,
    latency_ms: AtomicU32,
    channels: AtomicU32,
    /// How many times the stream was reopened (device switch or recovery).
    device_swaps: AtomicU32,
    /// Total callbacks, so a stream that silently stops calling back can be
    /// distinguished from a healthy but idle stream.
    callbacks: AtomicU32,
    /// Last cue gain survives a stream rebuild during playback.
    cue_gain: AtomicU32,
    device: Mutex<String>,
}

impl Default for Shared {
    fn default() -> Self {
        Self {
            playing: AtomicU32::new(0),
            step: AtomicU32::new(0),
            meter_left: AtomicU32::new(0),
            meter_right: AtomicU32::new(0),
            voices: AtomicU32::new(0),
            transient: AtomicU32::new(0),
            stream_errors: AtomicU32::new(0),
            sample_rate: AtomicU32::new(0),
            latency_ms: AtomicU32::new(0),
            channels: AtomicU32::new(0),
            device_swaps: AtomicU32::new(0),
            callbacks: AtomicU32::new(0),
            cue_gain: AtomicU32::new(1.0f32.to_bits()),
            device: Mutex::new(String::new()),
        }
    }
}

fn store_f32(slot: &AtomicU32, value: f32) {
    slot.store(value.to_bits(), Ordering::Relaxed);
}

fn load_f32(slot: &AtomicU32) -> f32 {
    f32::from_bits(slot.load(Ordering::Relaxed))
}

/// A snapshot for the UI: meters, transport position, device and stream health.
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
    /// Estimated output latency in milliseconds for the current buffer.
    pub latency_ms: f32,
    /// Channels the open stream writes to (4 or more means cue is routed).
    pub channels: u32,
    pub device_swaps: u32,
}

struct CallbackState {
    sample_rate: f32,
    sequencer: Option<Sequencer>,
    voice_pool: VoicePool,
    strip_pools: Vec<VoicePool>,
    strip_processors: Vec<StripProcessor>,
    strip_automation: Vec<Vec<AutomationLane>>,
    strip_frames: Vec<(f32, f32)>,
    mixer_runtime: Option<MixerRuntime>,
    eq: [Eq3; 2],
    compressor: [Compressor; 2],
    limiter: TruePeakLimiter,
    transmitter: Transmitter,
    logger: Arc<Mutex<AudioLogger>>,
    master_gain: f32,
    cue_gain: f32,
    tone_seconds_left: f32,
    tone_phase: f32,
    click_left: f32,
    click_phase: f32,
    click_freq: f32,
    triggers: Vec<Trigger>,
    chime: Vec<f32>,
    chime_pos: f32,
    chime_step: f32,
    callbacks: u64,
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
        let mut limiter = TruePeakLimiter::new(sample_rate);
        limiter.set_params(-1.0, 1.0, 80.0);
        Self {
            sample_rate,
            sequencer: None,
            voice_pool: VoicePool::new(sample_rate, 64),
            strip_pools: Vec::new(),
            strip_processors: Vec::new(),
            strip_automation: Vec::new(),
            strip_frames: Vec::new(),
            mixer_runtime: None,
            eq,
            compressor,
            limiter,
            transmitter: Transmitter::new(sample_rate),
            logger,
            master_gain: 1.0,
            cue_gain: 1.0,
            tone_seconds_left: 0.0,
            tone_phase: 0.0,
            click_left: 0.0,
            click_phase: 0.0,
            click_freq: 1_000.0,
            triggers: Vec::with_capacity(64),
            chime: Vec::new(),
            chime_pos: 0.0,
            chime_step: 1.0,
            callbacks: 0,
        }
    }

    /// Renders one stereo frame through the whole chain, plus the transmitter's
    /// transient reading for the UI.
    /// Starts a short click; accented clicks are higher and louder.
    fn trigger_click(&mut self, accent: bool) {
        self.click_left = 0.045;
        self.click_phase = 0.0;
        self.click_freq = if accent { 1_760.0 } else { 1_100.0 };
    }

    #[inline]
    fn next_frame(&mut self) -> (f32, f32, f32) {
        let mut left = 0.0f32;
        let mut right = 0.0f32;

        // Disjoint field borrows so the sequencer can be read while the voice
        // pool is written.
        let mut click = None;
        {
            let Self {
                sequencer,
                voice_pool,
                strip_pools,
                triggers,
                ..
            } = self;
            if let Some(seq) = sequencer.as_mut() {
                seq.tick_into(triggers);
                for trigger in triggers.iter() {
                    if let Some(channel) = seq.project().channels.get(trigger.channel_index) {
                        if let Some(pool) = strip_pools.get_mut(trigger.channel_index) {
                            pool.trigger_panned(
                                channel,
                                trigger.pitch,
                                trigger.velocity,
                                trigger.duration_sec,
                                trigger.gain,
                                trigger.pan,
                            );
                        } else {
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
                if seq.project().metronome {
                    if let Some(step) = seq.last_emitted_step() {
                        if step % 4 == 0 {
                            click = Some(step % 16 == 0);
                        }
                    }
                }
            }
        }
        if let Some(accent) = click {
            self.trigger_click(accent);
        }
        let (voice_l, voice_r) = if self.strip_pools.is_empty() {
            self.voice_pool.next_frame()
        } else {
            let Self {
                strip_pools,
                strip_processors,
                strip_automation,
                sequencer,
                ..
            } = self;
            let time = sequencer
                .as_ref()
                .map(|seq| seq.position_steps())
                .unwrap_or(0.0);
            let frames = &mut self.strip_frames;
            frames.resize(strip_pools.len(), (0.0, 0.0));
            for (index, pool) in strip_pools.iter_mut().enumerate() {
                let (l, r) = pool.next_frame();
                let gain = strip_automation
                    .get(index)
                    .map(|lanes| gain_at(lanes, time))
                    .unwrap_or(1.0);
                frames[index] = match strip_processors.get_mut(index) {
                    Some(processor) => processor.process(l * gain, r * gain),
                    None => (l * gain, r * gain),
                };
            }
            if let Some(mixer) = self.mixer_runtime.as_mut() {
                mixer.process(frames)
            } else {
                frames
                    .iter()
                    .fold((0.0, 0.0), |(l, r), (sl, sr)| (l + sl, r + sr))
            }
        };
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

        // Metronome click: a short sine burst on every quarter note.
        if self.click_left > 0.0 {
            let dt = self.click_freq / self.sample_rate.max(1.0);
            self.click_phase = (self.click_phase + dt).fract();
            let envelope = (self.click_left / 0.045).clamp(0.0, 1.0);
            let value =
                (2.0 * std::f32::consts::PI * self.click_phase).sin() * 0.3 * envelope * envelope;
            left += value;
            right += value;
            self.click_left -= 1.0 / self.sample_rate.max(1.0);
        }

        // Startup chime, resampled to the open device rate.
        let chime_len = self.chime.len() as f32;
        if chime_len > 0.0 && self.chime_pos < chime_len {
            let index = self.chime_pos as usize;
            let frac = self.chime_pos - index as f32;
            let next = self.chime.get(index + 1).copied().unwrap_or(0.0);
            let value = (self.chime[index] * (1.0 - frac) + next * frac) * 0.9;
            left += value;
            right += value;
            self.chime_pos += self.chime_step.max(0.01);
        }

        let transient = self
            .transmitter
            .process((left + right) * 0.5)
            .transient_amount;

        let shaped_left = self.eq[0].process(left);
        let shaped_right = self.eq[1].process(right);
        let compressed_left = self.compressor[0].process(shaped_left);
        let compressed_right = self.compressor[1].process(shaped_right);
        // One stereo limiter sees both channels, so a peak in either pulls the
        // gain for the pair and the stereo image stays put.
        let (limited_left, limited_right) = self.limiter.process(compressed_left, compressed_right);
        left = limited_left;
        right = limited_right;

        left *= self.master_gain;
        right *= self.master_gain;
        (left.clamp(-1.0, 1.0), right.clamp(-1.0, 1.0), transient)
    }
}

/// One open output stream plus the state the command loop edits.
struct Session {
    /// Kept alive for as long as the session exists; dropping it closes audio.
    _stream: cpal::Stream,
    state: Arc<Mutex<CallbackState>>,
    logger: Arc<Mutex<AudioLogger>>,
    name: String,
    sample_rate: f32,
    /// The PipeWire/Pulse sink this stream was routed to, if known. A reconnecting
    /// Bluetooth headset gets a new sink name, so the audio thread watches this.
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    sink: Option<String>,
}

/// The engine handle held by Tauri. Cheap to clone the shared state, owns the
/// command channel to the audio thread.
pub struct NativeEngine {
    commands: Sender<EngineCommand>,
    shared: Arc<Shared>,
    logger: LoggerSlot,
    thread: Option<JoinHandle<()>>,
}

impl NativeEngine {
    /// Opens the preferred output device and keeps the stream alive.
    pub fn start() -> Result<Self, String> {
        Self::start_with(None, false)
    }

    /// Opens a named device (or the platform preference when `None`).
    pub fn start_with(device: Option<String>, low_latency: bool) -> Result<Self, String> {
        let (ready_tx, ready_rx) =
            mpsc::channel::<Result<(String, f32, Arc<Mutex<AudioLogger>>), String>>();
        let (command_tx, command_rx) = mpsc::channel::<EngineCommand>();
        let shared = Arc::new(Shared::default());
        let logger: LoggerSlot = Arc::new(Mutex::new(None));
        let thread_shared = Arc::clone(&shared);
        let thread_logger = Arc::clone(&logger);

        let thread = std::thread::Builder::new()
            .name("openbeats-audio".into())
            .spawn(move || {
                audio_thread(
                    command_rx,
                    thread_shared,
                    thread_logger,
                    ready_tx,
                    device,
                    low_latency,
                )
            })
            .map_err(|e| format!("could not start the audio thread: {e}"))?;

        ready_rx
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| "the audio device did not open in time".to_string())??;

        Ok(Self {
            commands: command_tx,
            shared,
            logger,
            thread: Some(thread),
        })
    }

    pub fn sample_rate(&self) -> f32 {
        load_f32(&self.shared.sample_rate)
    }

    /// The recovery ring buffer of the current stream, if one is open.
    pub fn logger(&self) -> Option<Arc<Mutex<AudioLogger>>> {
        self.logger.lock().ok().and_then(|slot| slot.clone())
    }

    pub fn device_name(&self) -> String {
        self.shared
            .device
            .lock()
            .map(|name| name.clone())
            .unwrap_or_default()
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

    pub fn set_cue_gain(&self, gain: f32) {
        let _ = self.commands.send(EngineCommand::SetCueGain(gain));
    }

    /// Rebuilds the stream on `name`, or the platform preference when `None`.
    pub fn select_device(&self, name: Option<String>) -> Result<(), String> {
        self.commands
            .send(EngineCommand::SwitchDevice(name))
            .map_err(|_| "the audio engine stopped".to_string())
    }

    /// Reopens the stream with the device minimum buffer (`on`) or its default.
    pub fn set_low_latency(&self, on: bool) -> Result<(), String> {
        self.commands
            .send(EngineCommand::SetLowLatency(on))
            .map_err(|_| "the audio engine stopped".to_string())
    }

    /// Reopens the stream with a device and latency setting in one rebuild.
    pub fn reconfigure(&self, device: Option<String>, low_latency: bool) -> Result<(), String> {
        self.commands
            .send(EngineCommand::Reconfigure {
                device,
                low_latency,
            })
            .map_err(|_| "the audio engine stopped".to_string())
    }

    pub fn test_tone(&self, seconds: f32) {
        let _ = self.commands.send(EngineCommand::TestTone(seconds));
    }

    /// Plays one note outside the transport, for instrument audition.
    pub fn preview_note(&self, channel: PlaybackChannel, pitch: u8, velocity: f32, seconds: f32) {
        let _ = self.commands.send(EngineCommand::PreviewNote {
            channel,
            pitch,
            velocity,
            seconds,
        });
    }

    /// A single metronome click, independent of playback.
    pub fn click(&self, accent: bool) {
        let _ = self.commands.send(EngineCommand::Click(accent));
    }

    /// Moves the sequencer while the stream keeps running.
    pub fn seek(&self, step: u32) -> Result<(), String> {
        self.commands
            .send(EngineCommand::Seek(step))
            .map_err(|_| "the audio engine stopped".to_string())
    }

    /// Plays the bundled startup chime through the main output stream.
    pub fn chime(&self) -> Result<(), String> {
        let (samples, rate) = crate::chime::bundled()?;
        self.commands
            .send(EngineCommand::Chime(samples, rate))
            .map_err(|_| "the audio engine stopped".to_string())
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
            sample_rate: load_f32(&self.shared.sample_rate),
            device: self.device_name(),
            latency_ms: load_f32(&self.shared.latency_ms),
            channels: self.shared.channels.load(Ordering::Relaxed),
            device_swaps: self.shared.device_swaps.load(Ordering::Relaxed),
        }
    }

    /// Friendly names of the available output devices.
    pub fn devices() -> Vec<String> {
        list_devices()
            .outputs
            .into_iter()
            .map(|info| info.friendly_name)
            .collect()
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

/// Formats the renderer can convert from `f32` without a custom I24 path.
fn output_format_supported(format: SampleFormat) -> bool {
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

/// Some ALSA devices advertise I24/U24 as their default but cannot open a
/// stream with the formats this renderer supports. Pick the first compatible
/// configuration instead of reporting the device as unusable or opening it with
/// a format that immediately fails.
fn choose_output_config(device: &cpal::Device) -> Result<cpal::SupportedStreamConfig, String> {
    if let Ok(config) = device.default_output_config() {
        if output_format_supported(config.sample_format()) {
            return Ok(config);
        }
    }
    device
        .supported_output_configs()
        .map_err(|err| err.to_string())?
        .find(|range| output_format_supported(range.sample_format()))
        .map(|range| range.with_max_sample_rate())
        .ok_or_else(|| "it has no sample format this engine can render".to_string())
}

/// A device is only useful to the app when the host reports at least one
/// stream configuration this renderer can open. Broken/ghost endpoints are
/// filtered out here.
fn has_output_config(device: &cpal::Device) -> bool {
    device
        .supported_output_configs()
        .map(|mut configs| configs.any(|range| output_format_supported(range.sample_format())))
        .unwrap_or(false)
}

/// Input capture understands F32, I16 and U16, so only advertise devices that
/// can provide one of those native formats.
fn has_input_config(device: &cpal::Device) -> bool {
    device
        .supported_input_configs()
        .map(|mut configs| {
            configs.any(|range| {
                matches!(
                    range.sample_format(),
                    SampleFormat::F32 | SampleFormat::I16 | SampleFormat::U16
                )
            })
        })
        .unwrap_or(false)
}

/// Every input and output device on every available CPAL host, for the Audio
/// settings tab. Windows exposes WASAPI (and ASIO when built in), macOS exposes
/// CoreAudio, and Linux exposes ALSA/JACK as available.
pub fn list_devices() -> AudioDevices {
    let mut devices = AudioDevices::default();

    #[cfg(target_os = "linux")]
    let pulse_outputs = crate::linux_audio::outputs();
    #[cfg(target_os = "linux")]
    let pulse_inputs = crate::linux_audio::inputs();
    #[cfg(target_os = "linux")]
    let default_output_label = pulse_outputs
        .iter()
        .find(|endpoint| endpoint.is_default)
        .map(|endpoint| endpoint.label.clone());
    #[cfg(target_os = "linux")]
    let default_input_label = pulse_inputs
        .iter()
        .find(|endpoint| endpoint.is_default)
        .map(|endpoint| endpoint.label.clone());
    #[cfg(target_os = "linux")]
    let names = crate::linux_audio::FriendlyNames::new();
    #[cfg(target_os = "linux")]
    let hide_raw_bridges = !pulse_outputs.is_empty();

    for host_id in cpal::available_hosts() {
        let Ok(host) = cpal::host_from_id(host_id) else {
            continue;
        };
        let host_name = host.id().name().to_string();
        let default_output = host.default_output_device().and_then(|d| d.name().ok());
        let default_input = host.default_input_device().and_then(|d| d.name().ok());

        if let Ok(outputs) = host.output_devices() {
            for device in outputs {
                let Ok(name) = device.name() else { continue };
                if !has_output_config(&device) {
                    continue;
                }
                #[cfg(target_os = "linux")]
                if hide_raw_bridges && crate::linux_audio::is_bridge_name(&name) {
                    continue;
                }
                #[cfg(target_os = "linux")]
                let friendly_name = names.label(&name, default_output_label.as_deref());
                #[cfg(not(target_os = "linux"))]
                let friendly_name = name.clone();
                devices.outputs.push(DeviceInfo {
                    id: devices::device_id(&host_name, &name),
                    is_default: default_output.as_deref() == Some(name.as_str()),
                    friendly_name,
                });
            }
        }

        if let Ok(inputs) = host.input_devices() {
            for device in inputs {
                let Ok(name) = device.name() else { continue };
                if !has_input_config(&device) {
                    continue;
                }
                #[cfg(target_os = "linux")]
                let friendly_name = names.label(&name, default_input_label.as_deref());
                #[cfg(not(target_os = "linux"))]
                let friendly_name = name.clone();
                devices.inputs.push(DeviceInfo {
                    id: devices::device_id(&host_name, &name),
                    is_default: default_input.as_deref() == Some(name.as_str()),
                    friendly_name,
                });
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let mut endpoints: Vec<DeviceInfo> = pulse_outputs
            .iter()
            .map(|endpoint| DeviceInfo {
                id: devices::device_id("PulseAudio", &format!("sink:{}", endpoint.name)),
                friendly_name: endpoint.label.clone(),
                is_default: endpoint.is_default,
            })
            .collect();
        endpoints.append(&mut devices.outputs);
        devices.outputs = endpoints;
    }

    devices
}

/// Opens the chosen device and starts its stream.
fn open_session(
    requested: Option<&str>,
    low_latency: bool,
    shared: &Arc<Shared>,
    logger_slot: &LoggerSlot,
) -> Result<Session, String> {
    let requested_name = requested.and_then(devices::requested_device_name);
    #[cfg(target_os = "linux")]
    let requested_sink = requested.and_then(devices::requested_sink);
    #[cfg(target_os = "linux")]
    let route_state = crate::linux_audio::route_state();
    #[cfg(target_os = "linux")]
    let sink = match route_state.as_ref() {
        Some(state) => state.target_sink(requested_sink),
        None => requested_sink.map(str::to_string),
    };
    #[cfg(not(target_os = "linux"))]
    let sink: Option<String> = None;

    let host = cpal::default_host();
    let default_name = host.default_output_device().and_then(|d| d.name().ok());

    let mut devices = Vec::new();
    let mut candidates = Vec::new();
    if let Ok(outputs) = host.output_devices() {
        for device in outputs {
            let Ok(name) = device.name() else { continue };
            candidates.push(Candidate {
                is_default: default_name.as_deref() == Some(name.as_str()),
                name,
            });
            devices.push(device);
        }
    }

    // PipeWire/PulseAudio is the audible path on most Linux desktops; ALSA's
    // default PCM may be a null sink, so prefer the bridge there.
    let index = devices::pick(&candidates, requested_name, cfg!(target_os = "linux"))
        .ok_or_else(|| "no audio output device was found".to_string())?;
    let device = &devices[index];
    let name = candidates[index].name.clone();

    #[cfg(target_os = "linux")]
    let _route = crate::linux_audio::route_sink(sink.as_deref());
    #[cfg(target_os = "linux")]
    if requested_sink.is_some() && sink.as_deref() != requested_sink {
        eprintln!(
            "openbeats: saved output \"{}\" is unavailable; using \"{}\"",
            requested_sink.unwrap_or_default(),
            sink.as_deref().unwrap_or("the system default")
        );
    }

    let supported = choose_output_config(device).map_err(|err| {
        format!("the output device \"{name}\" has no usable configuration: {err}")
    })?;
    let sample_format = supported.sample_format();
    let mut config: cpal::StreamConfig = supported.clone().into();
    let minimum = match supported.buffer_size() {
        SupportedBufferSize::Range { min, .. } => *min,
        SupportedBufferSize::Unknown => 256,
    };
    if low_latency {
        config.buffer_size = cpal::BufferSize::Fixed(minimum.max(32));
    }
    // With the default buffer size the device picks the period, so report a
    // conservative estimate rather than pretending the minimum is in use.
    let estimate = if low_latency { minimum.max(32) } else { 1024 };
    let sample_rate = config.sample_rate.0 as f32;
    let channels = config.channels as usize;
    let latency_ms = estimate as f32 * 1000.0 / sample_rate.max(1.0);

    let logger = Arc::new(Mutex::new(AudioLogger::new(sample_rate, 60.0)));
    let state = Arc::new(Mutex::new(CallbackState::new(
        sample_rate,
        Arc::clone(&logger),
    )));
    if let Ok(mut guard) = state.lock() {
        guard.cue_gain = load_f32(&shared.cue_gain);
    }

    let make_error = || {
        let shared = Arc::clone(shared);
        move |err: cpal::StreamError| {
            shared.stream_errors.fetch_add(1, Ordering::Relaxed);
            eprintln!("openbeats audio stream error: {err}");
        }
    };

    macro_rules! open_stream {
        ($sample:ty) => {{
            let state = Arc::clone(&state);
            let shared = Arc::clone(shared);
            device.build_output_stream(
                &config,
                move |data: &mut [$sample], _: &cpal::OutputCallbackInfo| {
                    render::<$sample>(&state, &shared, data, channels)
                },
                make_error(),
                None,
            )
        }};
    }

    let stream = match sample_format {
        SampleFormat::F32 => open_stream!(f32),
        SampleFormat::F64 => open_stream!(f64),
        SampleFormat::I8 => open_stream!(i8),
        SampleFormat::I16 => open_stream!(i16),
        SampleFormat::I32 => open_stream!(i32),
        SampleFormat::U8 => open_stream!(u8),
        SampleFormat::U16 => open_stream!(u16),
        other => {
            return Err(format!(
                "the output device \"{name}\" uses an unsupported sample format ({other:?})"
            ))
        }
    }
    .map_err(|err| format!("could not open the output stream on \"{name}\": {err}"))?;

    stream
        .play()
        .map_err(|err| format!("could not start the output stream on \"{name}\": {err}"))?;

    if let Ok(mut slot) = logger_slot.lock() {
        *slot = Some(Arc::clone(&logger));
    }
    store_f32(&shared.sample_rate, sample_rate);
    store_f32(&shared.latency_ms, latency_ms);
    shared.channels.store(channels as u32, Ordering::Relaxed);
    if let Ok(mut current) = shared.device.lock() {
        *current = name.clone();
    }

    println!(
        "openbeats: opened output \"{name}\" ({channels} ch, {sample_rate:.0} Hz, {sample_format:?}, \
         ~{latency_ms:.1} ms, low latency: {low_latency})"
    );

    Ok(Session {
        _stream: stream,
        state,
        logger,
        name,
        sample_rate,
        sink,
    })
}

fn apply_command(state: &mut CallbackState, shared: &Arc<Shared>, command: EngineCommand) {
    match command {
        EngineCommand::Play(project) => {
            state.master_gain = project.master_gain.clamp(0.0, 2.0);
            state.voice_pool.all_notes_off();
            state.strip_pools = project
                .channels
                .iter()
                .map(|_| VoicePool::new(state.sample_rate, 64))
                .collect();
            state.strip_processors = project
                .channels
                .iter()
                .map(|channel| StripProcessor::new(state.sample_rate, &channel.inserts))
                .collect();
            state.strip_automation = project
                .channels
                .iter()
                .map(|channel| channel.automation.clone())
                .collect();
            state.strip_frames = vec![(0.0, 0.0); project.channels.len()];
            let channel_mixers: Vec<usize> = project.channels.iter().map(|ch| ch.mixer).collect();
            state.mixer_runtime = MixerRuntime::new(&project.mixer, &channel_mixers);
            state.sequencer = Some(Sequencer::new(project, state.sample_rate));
            shared.playing.store(1, Ordering::Relaxed);
        }
        EngineCommand::Stop => {
            if let Some(seq) = state.sequencer.as_mut() {
                seq.stop();
            }
            state.voice_pool.all_notes_off();
            for pool in &mut state.strip_pools {
                pool.all_notes_off();
            }
            shared.playing.store(0, Ordering::Relaxed);
        }
        EngineCommand::SetMasterGain(gain) => state.master_gain = gain.clamp(0.0, 2.0),
        EngineCommand::SetCueGain(gain) => {
            state.cue_gain = gain.clamp(0.0, 2.0);
            store_f32(&shared.cue_gain, state.cue_gain);
        }
        EngineCommand::TestTone(seconds) => state.tone_seconds_left = seconds.max(0.0),
        EngineCommand::PreviewNote {
            channel,
            pitch,
            velocity,
            seconds,
        } => {
            state.voice_pool.trigger_panned(
                &channel,
                pitch,
                velocity.clamp(0.05, 1.0),
                seconds.clamp(0.05, 8.0),
                channel.gain.clamp(0.05, 2.0),
                channel.pan.clamp(-1.0, 1.0),
            );
        }
        EngineCommand::Click(accent) => state.trigger_click(accent),
        EngineCommand::Seek(step) => {
            state.voice_pool.all_notes_off();
            for pool in &mut state.strip_pools {
                pool.all_notes_off();
            }
            if let Some(seq) = state.sequencer.as_mut() {
                seq.seek(step);
            }
            shared.step.store(step, Ordering::Relaxed);
        }
        EngineCommand::Chime(samples, rate) => {
            state.chime = samples;
            state.chime_pos = 0.0;
            state.chime_step = rate as f32 / state.sample_rate.max(1.0);
        }
        // Handled by the session loop, which has to drop and rebuild the stream.
        EngineCommand::SwitchDevice(_)
        | EngineCommand::SetLowLatency(_)
        | EngineCommand::Reconfigure { .. } => {}
        EngineCommand::Shutdown => {}
    }
}

fn audio_thread(
    commands: Receiver<EngineCommand>,
    shared: Arc<Shared>,
    logger_slot: LoggerSlot,
    ready: Sender<Result<(String, f32, Arc<Mutex<AudioLogger>>), String>>,
    initial_device: Option<String>,
    initial_low_latency: bool,
) {
    let mut ready = Some(ready);
    let mut requested = initial_device;
    let mut low_latency = initial_low_latency;
    let mut last_project: Option<PlaybackProject> = None;

    loop {
        // Keep the user's preference even when it is temporarily unavailable.
        // A Bluetooth headset that vanished for a second must be picked up when
        // it reappears, rather than being replaced permanently by the fallback.
        let session = loop {
            match open_session(requested.as_deref(), low_latency, &shared, &logger_slot) {
                Ok(session) => break session,
                Err(err) => {
                    if ready.is_some() && requested.is_none() {
                        if let Some(tx) = ready.take() {
                            let _ = tx.send(Err(err));
                        }
                        return;
                    }
                    if requested.is_some() {
                        eprintln!(
                            "openbeats: saved output failed ({err}); trying the system default"
                        );
                        match open_session(None, low_latency, &shared, &logger_slot) {
                            Ok(session) => break session,
                            Err(fallback_err) => {
                                if let Some(tx) = ready.take() {
                                    let _ = tx.send(Err(format!(
                                        "{err}; system default: {fallback_err}"
                                    )));
                                    return;
                                }
                                eprintln!(
                                    "openbeats: could not reopen the audio device ({fallback_err}); retrying"
                                );
                                std::thread::sleep(Duration::from_millis(750));
                                continue;
                            }
                        }
                    }
                    if let Some(tx) = ready.take() {
                        let _ = tx.send(Err(err));
                        return;
                    }
                    eprintln!("openbeats: could not reopen the audio device ({err}); retrying");
                    std::thread::sleep(Duration::from_millis(750));
                }
            }
        };

        // A stream rebuild replaces the callback state. If the transport was
        // rolling, put the sequencer back at the last rendered step instead of
        // silently dropping playback along with the old device.
        if shared.playing.load(Ordering::Relaxed) == 1 {
            if let Some(mut project) = last_project.clone() {
                project.start_step = shared.step.load(Ordering::Relaxed);
                if let Ok(mut state) = session.state.lock() {
                    apply_command(&mut state, &shared, EngineCommand::Play(project));
                }
            }
        }

        if let Some(tx) = ready.take() {
            let _ = tx.send(Ok((
                session.name.clone(),
                session.sample_rate,
                Arc::clone(&session.logger),
            )));
        }

        let error_baseline = shared.stream_errors.load(Ordering::Relaxed);
        let mut callback_count = shared.callbacks.load(Ordering::Relaxed);
        let mut last_progress = Instant::now();
        #[cfg(target_os = "linux")]
        let mut route_check = Instant::now();
        let mut device_check = Instant::now();
        let mut stream_failed = false;

        // Every exit from this loop either returns or reopens the stream.
        loop {
            match commands.recv_timeout(Duration::from_millis(250)) {
                Ok(EngineCommand::Shutdown) => return,
                Ok(EngineCommand::SwitchDevice(name)) => {
                    requested = name;
                    break;
                }
                Ok(EngineCommand::SetLowLatency(on)) => {
                    low_latency = on;
                    break;
                }
                Ok(EngineCommand::Reconfigure {
                    device,
                    low_latency: next_low_latency,
                }) => {
                    requested = device;
                    low_latency = next_low_latency;
                    break;
                }
                Ok(command) => {
                    let is_play = matches!(&command, EngineCommand::Play(_));
                    if let EngineCommand::Play(project) = &command {
                        last_project = Some(project.clone());
                    }
                    if matches!(&command, EngineCommand::Stop) {
                        last_project = None;
                    }
                    match session.state.lock() {
                        Ok(mut guard) => apply_command(&mut guard, &shared, command),
                        Err(_) => break,
                    }
                    if is_play {
                        // Give a newly opened stream time to deliver its first
                        // callback before the no-callback watchdog can fire.
                        last_progress = Instant::now();
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    if shared.stream_errors.load(Ordering::Relaxed) > error_baseline {
                        eprintln!("openbeats: the audio device failed; reopening the saved route");
                        stream_failed = true;
                        break;
                    }

                    let callbacks = shared.callbacks.load(Ordering::Relaxed);
                    if callbacks != callback_count {
                        callback_count = callbacks;
                        last_progress = Instant::now();
                    } else if shared.playing.load(Ordering::Relaxed) == 1
                        && last_progress.elapsed() >= Duration::from_secs(2)
                    {
                        eprintln!("openbeats: audio callbacks stalled; reopening the saved route");
                        break;
                    }

                    #[cfg(target_os = "linux")]
                    if route_check.elapsed() >= Duration::from_secs(1) {
                        route_check = Instant::now();
                        let follows_default = requested
                            .as_deref()
                            .map(|id| devices::requested_sink(id).is_some())
                            .unwrap_or(true);
                        if follows_default {
                            if let Some(state) = crate::linux_audio::route_state() {
                                let preferred =
                                    requested.as_deref().and_then(devices::requested_sink);
                                if crate::linux_audio::should_reopen(
                                    preferred,
                                    session.sink.as_deref(),
                                    follows_default,
                                    &state,
                                ) {
                                    eprintln!(
                                        "openbeats: audio route changed; reopening {}",
                                        preferred.unwrap_or("the system default")
                                    );
                                    break;
                                }
                            }
                        }
                    }

                    // Pulse hosts use the sink watcher above. Every other host,
                    // and raw ALSA devices, use CPAL's own device list so a
                    // reconnected USB/Bluetooth endpoint is picked up again.
                    let check_physical = cfg!(not(target_os = "linux"))
                        || requested
                            .as_deref()
                            .and_then(devices::requested_device_name)
                            .is_some();
                    if check_physical && device_check.elapsed() >= Duration::from_secs(2) {
                        device_check = Instant::now();
                        let host = cpal::default_host();
                        let default_name = host.default_output_device().and_then(|d| d.name().ok());
                        let mut available = Vec::new();
                        if let Ok(outputs) = host.output_devices() {
                            for device in outputs {
                                if let Ok(name) = device.name() {
                                    available.push(name);
                                }
                            }
                        }
                        let requested_name = requested
                            .as_deref()
                            .and_then(devices::requested_device_name);
                        if devices::should_follow_device(
                            requested_name,
                            Some(&session.name),
                            default_name.as_deref(),
                            &available,
                        ) {
                            eprintln!(
                                "openbeats: output device changed; reopening {}",
                                requested_name.unwrap_or("the system default")
                            );
                            break;
                        }
                    }
                }
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }

        drop(session);
        shared.device_swaps.fetch_add(1, Ordering::Relaxed);
        if stream_failed {
            // A Bluetooth reconnect can take a moment to publish its new sink.
            std::thread::sleep(Duration::from_millis(400));
        }
    }
}

fn render<T>(
    state: &Arc<Mutex<CallbackState>>,
    shared: &Arc<Shared>,
    data: &mut [T],
    channels: usize,
) where
    T: SizedSample + FromSample<f32> + Copy,
{
    // Count every callback, including one that loses the state lock, so the
    // audio thread can tell a dead stream from an idle but healthy one.
    shared.callbacks.fetch_add(1, Ordering::Relaxed);

    let mut guard = match state.try_lock() {
        Ok(guard) => guard,
        Err(_) => {
            for slot in data.iter_mut() {
                *slot = T::from_sample(0.0);
            }
            return;
        }
    };

    let frames = data.len() / channels.max(1);
    let mut peak_left = 0.0f32;
    let mut peak_right = 0.0f32;
    let mut peak_transient = 0.0f32;
    // Clone the Arc first: borrowing the guard's field across `next_frame`
    // would conflict with the mutable borrow that call needs.
    let logger = Arc::clone(&guard.logger);
    let mut log = logger.try_lock().ok();
    let cue = guard.cue_gain;

    for frame in 0..frames {
        let (left, right, transient) = guard.next_frame();
        peak_left = peak_left.max(left.abs());
        peak_right = peak_right.max(right.abs());
        peak_transient = peak_transient.max(transient);
        if let Some(log) = log.as_mut() {
            log.push_frame(left, right);
        }
        for channel in 0..channels {
            // Outputs 1/2 carry the master, 3/4 the cue bus.
            let value = match channel {
                0 => left,
                1 => right,
                2 => left * cue,
                3 => right * cue,
                _ => (left + right) * 0.5 * cue,
            };
            data[frame * channels + channel] = T::from_sample(value);
        }
    }

    store_f32(&shared.meter_left, peak_left);
    store_f32(&shared.meter_right, peak_right);
    store_f32(&shared.transient, peak_transient);
    let strip_voices: usize = guard.strip_pools.iter().map(VoicePool::active_voices).sum();
    shared.voices.store(
        (guard.voice_pool.active_voices() + strip_voices) as u32,
        Ordering::Relaxed,
    );
    let step = guard.sequencer.as_ref().map(|s| s.step()).unwrap_or(0);
    shared.step.store(step, Ordering::Relaxed);
    let playing = guard
        .sequencer
        .as_ref()
        .map(|s| s.is_playing())
        .unwrap_or(false);
    shared.playing.store(u32::from(playing), Ordering::Relaxed);

    // Data-flow proof for users debugging a silent device: one line per second.
    guard.callbacks = guard.callbacks.wrapping_add(1);
    if guard.callbacks % 100 == 0 {
        println!(
            "openbeats audio: {} frames at {:.0} Hz, peak {:.3}/{:.3}",
            frames, guard.sample_rate, peak_left, peak_right
        );
    }
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
