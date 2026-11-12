/**
 * Bridge to the native Rust audio engine.
 *
 * The desktop build plays through CPAL in Rust: this module flattens the project
 * into the snapshot `start_playback` expects, so the WebView never touches Web
 * Audio. In a plain browser (the web demo) `isNative()` is false and the caller
 * keeps using the Web Audio engine.
 */

import type { AudioPreferences, Project, UpdateAsset } from '../model/types';
import {
  eventsAtPatternStep,
  eventsAtSongStep,
  isChannelAudible,
  patternSteps,
  songLengthSteps,
} from '../audio/sequencer';
import { invokeAudio, invokeNative, isNative, nativeInvoke } from './native';
import { nativeVoiceId } from './nativeVoices';

export type NativeInsertSnapshot =
  | { kind: 'gain'; gain_db: number }
  | { kind: 'eq3'; low_db: number; mid_db: number; high_db: number; mid_hz: number }
  | {
      kind: 'compressor';
      threshold_db: number;
      ratio: number;
      attack: number;
      release: number;
      knee_db: number;
      makeup_db: number;
    }
  | { kind: 'limiter'; ceiling_db: number; attack_ms: number; release_ms: number }
  | { kind: 'lowpass'; cutoff_hz: number }
  | { kind: 'highpass'; cutoff_hz: number }
  | { kind: 'drive'; amount: number }
  | { kind: 'eq10'; gains: number[] }
  | { kind: 'reverb'; size: number; decay: number; damp: number; mix: number }
  | { kind: 'delay'; time: number; feedback: number; tone: number; mix: number }
  | { kind: 'chorus'; rate: number; depth: number; mix: number }
  | { kind: 'phaser'; rate: number; depth: number; feedback: number; mix: number }
  | { kind: 'tremolo'; rate: number; depth: number }
  | { kind: 'autopan'; rate: number; depth: number; mix: number }
  | { kind: 'ringmod'; freq: number; tone: number; mix: number }
  | { kind: 'bitcrush'; bits: number; tone: number; mix: number };

export interface NativeAutomationPointSnapshot {
  time: number;
  value: number;
  curve: 'linear' | 'hold' | 'ease_in' | 'ease_out' | 's_curve';
}

export interface NativeAutomationLaneSnapshot {
  target: string;
  default: number;
  min: number;
  max: number;
  loop_len: number | null;
  points: NativeAutomationPointSnapshot[];
}

export interface PlaybackChannelSnapshot {
  id: string;
  preset: string;
  mixer: number;
  inserts: NativeInsertSnapshot[];
  automation: NativeAutomationLaneSnapshot[];
  gain: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  root: number;
  attack: number;
  decay: number;
  release: number;
  tone: number;
}

export interface PlaybackNoteSnapshot {
  channel: string;
  pitch: number;
  start: number;
  len: number;
  vel: number;
  /** Clip gain envelope value; 1 is unity. */
  gain: number;
  /** Per-clip pan, -1..1. */
  pan: number;
}

export interface PlaybackClipSnapshot {
  id: string;
  pattern: string;
  track: number;
  start: number;
  len: number;
  gain: number;
  pan: number;
  pitch: number;
  stretch: number;
  fade_in: number;
  fade_out: number;
  muted: boolean;
}

export interface PlaybackPatternSnapshot {
  id: string;
  bars: number;
  notes: { channel: string; pitch: number; start: number; len: number; vel: number }[];
}

export interface PlaybackSnapshot {
  bpm: number;
  swing: number;
  master_gain: number;
  /** Click on every quarter note while the transport rolls. */
  metronome: boolean;
  steps: number;
  loop_enabled: boolean;
  loop_start: number;
  loop_end: number;
  start_step: number;
  channels: PlaybackChannelSnapshot[];
  notes: PlaybackNoteSnapshot[];
  /** Song-mode clips, expanded natively with pan/pitch/stretch/fades. */
  clips: PlaybackClipSnapshot[];
  patterns: PlaybackPatternSnapshot[];
  mixer: {
    strips: {
      id: number;
      gain: number;
      mute: boolean;
      solo: boolean;
      route: number | null;
      sends: { to: number; amount: number; pre_fader: boolean }[];
      sidechain: number | null;
    }[];
  };
}

export interface NativePlaybackStatus {
  playing: boolean;
  sample_rate: number;
  device: string;
  voices_ready: boolean;
}

export interface NativePlaybackState {
  playing: boolean;
  step: number;
  meter_left: number;
  meter_right: number;
  voices: number;
  transient: number;
  stream_errors: number;
  sample_rate: number;
  device: string;
  /** Estimated output latency in milliseconds for the open buffer. */
  latency_ms: number;
  /** Channels the stream writes to; 4 or more means the cue bus is routed. */
  channels: number;
  /** How many times the stream was rebuilt (device switch or recovery). */
  device_swaps: number;
  /** Total stream callbacks since launch; a dead stream stops counting. */
  callbacks: number;
  /** Peak of the last rendered block, 0..1. Zero while callbacks climb means silence upstream. */
  peak: number;
  /** Last stream or reopen error, empty when the engine is healthy. */
  last_error: string;
  /** Frames per callback the device actually grants. */
  buffer_frames: number;
  /** Worst callback interval in milliseconds since the stream opened. */
  interval_max_ms: number;
  /** Callbacks later than 1.5x their nominal period: the stream cannot keep up. */
  deadline_misses: number;
  /** Output peak in dBFS, -120 when the graph is silent. */
  peak_db: number;
  /** Sound-server node the stream is connected to (Linux), empty elsewhere. */
  sink: string;
  /** CPAL host the stream was opened on. */
  host: string;
  /** Stall-triggered reopens since launch. */
  stall_reopens: number;
  /** The last stall reopen, with reason, buffers and silence. */
  last_reopen: string;
}

export interface DeviceInfo {
  /** Host-qualified id sent back to the native output or input stream. */
  id: string;
  friendly_name: string;
  is_default: boolean;
}

export interface AudioDevices {
  inputs: DeviceInfo[];
  outputs: DeviceInfo[];
}

export interface NativeGroove {
  name: string;
  timing: number[];
  velocity: number[];
}

export interface NativeMelodyOptions {
  root: number;
  scale: NativeScale;
  bars: number;
  rhythm: 'straight' | 'syncopated' | 'long';
  octave: number;
  seed: number;
}

export interface NativeHealthIssue {
  kind: string;
  detail: string;
}

export interface NativeThemeVariables {
  name: string;
  variables: [string, string][];
  css: string;
}

export interface RecoveredLog {
  path: string;
  frames: number;
  seconds: number;
  sample_rate: number;
}

export interface NativeChord {
  name: string;
  root: number;
  quality: string;
  bass: string;
}

export interface ParsedCommand {
  action: string;
  target?: string | null;
  value?: number | null;
  confidence: number;
  raw: string;
}

/** Flattens the project into the sequencer data the Rust engine consumes. */
function nativeInserts(project: Project, mixer: number): NativeInsertSnapshot[] {
  const strip = project.strips.find((candidate) => candidate.id === mixer);
  if (!strip) return [];
  const inserts: NativeInsertSnapshot[] = [];
  for (const effect of strip.effects) {
    if (effect.bypass) continue;
    const p = effect.params;
    switch (effect.type) {
      case 'eq3':
        inserts.push({
          kind: 'eq3',
          low_db: p.low ?? 0,
          mid_db: p.mid ?? 0,
          high_db: p.high ?? 0,
          mid_hz: p.freq ?? 1000,
        });
        break;
      case 'comp':
        inserts.push({
          kind: 'compressor',
          threshold_db: p.threshold ?? -20,
          ratio: p.ratio ?? 4,
          attack: p.attack ?? 0.15,
          release: p.release ?? 0.35,
          knee_db: p.knee ?? 6,
          makeup_db: p.makeup ?? 0,
        });
        break;
      case 'limiter':
        inserts.push({
          kind: 'limiter',
          ceiling_db: p.threshold ?? -1,
          attack_ms: 1,
          release_ms: Math.max(1, (p.release ?? 0.1) * 1000),
        });
        break;
      case 'drive':
        inserts.push({ kind: 'drive', amount: Math.max(0, Math.min(1, (p.amount ?? 6) / 40)) });
        break;
      case 'filter':
        inserts.push({
          kind: 'lowpass',
          cutoff_hz: 80 * Math.pow(150, p.cutoff ?? 0.8),
        });
        break;
      case 'eq10':
        inserts.push({
          kind: 'eq10',
          gains: Array.from({ length: 10 }, (_, index) => p[`g${index}`] ?? 0),
        });
        break;
      case 'reverb':
        inserts.push({
          kind: 'reverb',
          size: p.size ?? 0.5,
          decay: p.decay ?? 0.55,
          damp: p.damp ?? 0.45,
          mix: p.mix ?? 0.25,
        });
        break;
      case 'delay':
        inserts.push({
          kind: 'delay',
          time: p.time ?? 0.32,
          feedback: p.feedback ?? 0.35,
          tone: p.tone ?? 0.5,
          mix: p.mix ?? 0.25,
        });
        break;
      case 'chorus':
        inserts.push({
          kind: 'chorus',
          rate: p.rate ?? 0.3,
          depth: p.depth ?? 0.4,
          mix: p.mix ?? 0.35,
        });
        break;
      case 'phaser':
        inserts.push({
          kind: 'phaser',
          rate: p.rate ?? 0.28,
          depth: p.depth ?? 0.5,
          feedback: p.feedback ?? 0.25,
          mix: p.mix ?? 0.5,
        });
        break;
      case 'tremolo':
        inserts.push({ kind: 'tremolo', rate: p.rate ?? 0.35, depth: p.depth ?? 0.6 });
        break;
      case 'autopan':
        inserts.push({
          kind: 'autopan',
          rate: p.rate ?? 0.3,
          depth: p.depth ?? 0.7,
          mix: p.mix ?? 1,
        });
        break;
      case 'ringmod':
        inserts.push({
          kind: 'ringmod',
          freq: p.freq ?? 220,
          tone: p.tone ?? 0.6,
          mix: p.mix ?? 0.6,
        });
        break;
      case 'bitcrush':
        inserts.push({
          kind: 'bitcrush',
          bits: p.bits ?? 8,
          tone: p.tone ?? 0.55,
          mix: p.mix ?? 0.8,
        });
        break;
      default:
        break;
    }
  }
  return inserts;
}

function nativeAutomation(project: Project, mixer: number): NativeAutomationLaneSnapshot[] {
  const strip = project.strips.find((candidate) => candidate.id === mixer);
  const lane = strip?.automation.find((candidate) => candidate.target === 'volume');
  if (!strip || !lane || lane.points.length === 0) return [];
  return [
    {
      target: 'gain',
      default: strip.gain,
      min: 0,
      max: 1.25,
      loop_len: null,
      points: lane.points.map((point) => ({
        time: point.step,
        value: Math.max(0, Math.min(1, point.value / 1.25)),
        curve:
          point.curve === 'hold' ? 'hold' : point.curve === 'smooth' ? 's_curve' : 'linear',
      })),
    },
  ];
}

export function buildPlaybackSnapshot(
  project: Project,
  songMode: boolean,
  startStep = 0,
): PlaybackSnapshot {
  const steps = songMode
    ? songLengthSteps(project)
    : patternSteps(project, project.currentPattern);

  // Song mode sends clips and lets Rust expand them (per-clip pan, pitch,
  // stretch and fades are native logic); pattern mode sends flat notes.
  const useClips = songMode && project.clips.length > 0;
  const notes: PlaybackNoteSnapshot[] = [];
  if (!useClips) {
    for (let step = 0; step < steps; step += 1) {
      const events = songMode
        ? eventsAtSongStep(project, step)
        : eventsAtPatternStep(project, project.currentPattern, step);
      for (const event of events) {
        if (!isChannelAudible(project, event.channelId)) continue;
        notes.push({
          channel: event.channelId,
          pitch: event.pitch,
          start: step,
          len: event.lenSteps,
          vel: event.vel,
          gain: event.gain ?? 1,
          pan: event.pan ?? 0,
        });
      }
    }
  }

  return {
    bpm: project.bpm,
    swing: project.swing,
    master_gain: project.masterGain,
    metronome: project.metronome,
    steps,
    loop_enabled: project.loop,
    loop_start: project.loopStart,
    loop_end: project.loopEnd,
    start_step: Math.max(0, Math.round(startStep)),
    channels: project.channels.map((channel) => ({
      id: channel.id,
      preset: nativeVoiceId(channel.preset),
      mixer: channel.mixer,
      inserts: nativeInserts(project, channel.mixer),
      automation: nativeAutomation(project, channel.mixer),
      gain: channel.gain,
      pan: channel.pan,
      mute: channel.mute,
      solo: channel.solo,
      root: channel.root,
      attack: channel.attack,
      decay: channel.decay,
      release: channel.release,
      tone: channel.tone,
    })),
    notes,
    clips: useClips
      ? project.clips.map((clip) => ({
          id: clip.id,
          pattern: clip.pattern,
          track: clip.track,
          start: clip.start,
          len: clip.len,
          gain: clip.gain ?? 1,
          pan: clip.pan ?? 0,
          pitch: clip.pitch ?? 0,
          stretch: clip.stretch && clip.stretch > 0.05 ? clip.stretch : 1,
          fade_in: clip.fadeIn ?? 0,
          fade_out: clip.fadeOut ?? 0,
          muted: project.tracks[clip.track]?.mute ?? false,
        }))
      : [],
    mixer: {
      strips: project.strips.map((strip) => ({
        id: strip.id,
        gain: strip.gain,
        mute: strip.mute,
        solo: strip.solo,
        route: strip.route,
        sends: strip.sends.map((send) => ({ ...send, pre_fader: false })),
        sidechain: null,
      })),
    },
    patterns: useClips
      ? project.patterns.map((pattern) => ({
          id: pattern.id,
          bars: pattern.bars,
          notes: Object.entries(pattern.notes).flatMap(([channel, list]) =>
            (list ?? []).map((n) => ({
              channel,
              pitch: n.pitch,
              start: n.start,
              len: n.len,
              vel: n.vel,
            })),
          ),
        }))
      : [],
  };
}

/** True when the native engine can be used at all. */
export function nativeAudioAvailable(): boolean {
  return isNative();
}

export async function startNativePlayback(
  snapshot: PlaybackSnapshot,
): Promise<NativePlaybackStatus | null> {
  if (!isNative()) return null;
  try {
    // Loud on purpose: the error is shown before the caller falls back to
    // Web Audio, so a broken device never looks like "the play button is dead".
    return await invokeAudio<NativePlaybackStatus>('start_playback', {
      projectData: JSON.stringify(snapshot),
    });
  } catch {
    return null;
  }
}

export async function stopNativePlayback(): Promise<void> {
  if (!isNative()) return;
  await nativeInvoke<null>('stop_playback');
}

export async function nativePlaybackState(): Promise<NativePlaybackState | null> {
  if (!isNative()) return null;
  return nativeInvoke<NativePlaybackState>('playback_state');
}

export async function nativeAudioDevices(): Promise<string[]> {
  if (!isNative()) return [];
  return (await nativeInvoke<string[]>('native_audio_devices')) ?? [];
}

/**
 * Peak and RMS of what the engine actually handed to the device, read from the
 * recovery ring on the UI thread. The meters say what the graph produced; this
 * says what was delivered, which is what tells a silent graph from a silent
 * device.
 */
export async function renderedLevels(
  seconds = 3,
): Promise<{ peak: number; rms: number } | null> {
  if (!isNative()) return null;
  const value = await nativeInvoke<[number, number] | null>('audio_rendered_levels', { seconds });
  if (!value) return null;
  return { peak: value[0], rms: value[1] };
}

/** Every input and output device, for the Audio settings tab. */
export async function getAudioDevices(): Promise<AudioDevices> {
  if (!isNative()) return { inputs: [], outputs: [] };
  return (await nativeInvoke<AudioDevices>('get_audio_devices')) ?? { inputs: [], outputs: [] };
}

/** Rebuilds the CPAL stream on a device (null restores the platform default). */
export async function selectAudioDevice(
  device: string | null,
): Promise<NativePlaybackState | null> {
  if (!isNative()) return null;
  return invokeAudio<NativePlaybackState>('select_audio_device', { device });
}

/** Reopens the stream with the device minimum buffer, or its default size. */
export async function setLowLatency(enabled: boolean): Promise<NativePlaybackState | null> {
  if (!isNative()) return null;
  return invokeAudio<NativePlaybackState>('set_low_latency', { enabled });
}

/**
 * Applies the saved output, latency and cue level together. The first call also
 * opens the stream, which lets the startup chime use the chosen device.
 */
export async function configureNativeAudio(
  audio: AudioPreferences,
): Promise<NativePlaybackState | null> {
  if (!isNative()) return null;
  return invokeAudio<NativePlaybackState>('configure_audio', {
    device: audio.outputId,
    lowLatency: audio.lowLatency,
    cueGain: audio.cueGain,
  });
}

/** Level of the native master output (0..2). */
export async function setNativeMasterGain(gain: number): Promise<void> {
  if (!isNative()) return;
  await nativeInvoke<null>('set_master_gain', { gain });
}

/** Level of the cue bus on outputs 3/4. */
export async function setCueGain(gain: number): Promise<void> {
  if (!isNative()) return;
  await nativeInvoke<null>('set_cue_gain', { gain });
}

/** Groove-aware humanise using the Rust groove templates. */
export async function nativeHumanize(
  notes: NativeToolNote[],
  groove: 'straight' | 'laid_back' | 'pushed' | 'shuffle',
  amount = 1,
): Promise<NativeToolNote[] | null> {
  if (!isNative()) return null;
  return nativeInvoke<NativeToolNote[]>('humanize_notes', { notes, groove, amount });
}

/** Fader gains that leave `headroomDb` of headroom on each source. */
export async function nativeAutoGain(
  peaks: number[],
  headroomDb = -6,
): Promise<number[] | null> {
  if (!isNative()) return null;
  return nativeInvoke<number[]>('auto_gain_gains', { peaks, headroomDb });
}

/** Project health scan: clipping, unused channels, missing samples, heavy plugins. */
export async function nativeHealthCheck(project: {
  peak: number;
  channel_count: number;
  used_channels: number;
  missing_samples: number;
  high_cpu_plugins: number;
  unloaded_channels: number;
}): Promise<NativeHealthIssue[] | null> {
  if (!isNative()) return null;
  return nativeInvoke<NativeHealthIssue[]>('project_health', { project });
}

/** Rule-based melody generation; the same seed reproduces the same take. */
export async function nativeGenerateMelody(
  options: NativeMelodyOptions,
): Promise<NativeToolNote[] | null> {
  if (!isNative()) return null;
  return nativeInvoke<NativeToolNote[]>('generate_melody', { options });
}

/** BPM from tap times in milliseconds. */
export async function nativeTapTempo(tapsMs: number[]): Promise<number | null> {
  if (!isNative()) return null;
  return nativeInvoke<number | null>('tap_tempo_from_taps', { tapsMs });
}

/** Renders the held-note arpeggiator into a pattern. */
export async function nativeArpPattern(
  notes: NativeToolNote[],
  bpm: number,
  mode: NativeArpMode,
  rateSteps = 1,
  octaves = 1,
  gate = 0.6,
  steps = 16,
): Promise<NativeToolNote[] | null> {
  if (!isNative()) return null;
  return nativeInvoke<NativeToolNote[]>('arp_pattern', {
    notes,
    bpm,
    mode,
    rateSteps,
    octaves,
    gate,
    steps,
  });
}

/** Magnitudes per frequency band, analysed with rustfft. */
export async function nativeSpectrum(
  samples: number[],
  sampleRate: number,
  bands?: number[],
): Promise<number[] | null> {
  if (!isNative()) return null;
  return nativeInvoke<number[]>('spectrum_bands', { samples, sampleRate, bands });
}

/** Validated CSS variables for a JSON theme file. */
export async function nativeThemeVariables(json: string): Promise<NativeThemeVariables | null> {
  if (!isNative()) return null;
  return nativeInvoke<NativeThemeVariables>('parse_theme', { json });
}

/* ------------------------------------------------------------------ *
 * Session recovery (a Rust thread writing a hidden .recovery file)
 * ------------------------------------------------------------------ */

/** Starts the 30-second recovery thread and returns the snapshot path. */
export async function startSessionRecovery(): Promise<string | null> {
  if (!isNative()) return null;
  return nativeInvoke<string>('start_session_recovery');
}

/** Queues the current project for the recovery thread. */
export async function recoveryUpdate(contents: string): Promise<void> {
  if (!isNative()) return;
  await nativeInvoke<null>('recovery_update', { contents });
}

/** The last recovery snapshot, or null when there is none. */
export async function readRecovery(): Promise<string | null> {
  if (!isNative()) return null;
  return nativeInvoke<string | null>('read_recovery');
}

/** Removes the snapshot after a successful restore or save. */
export async function clearRecovery(): Promise<void> {
  if (!isNative()) return;
  await nativeInvoke<null>('clear_recovery');
}

/**
 * Why the native engine cannot reach PipeWire/PulseAudio, when it cannot:
 * `ok`, `missing-bridge` (server running, no ALSA bridge PCM) or `no-server`.
 */
export async function audioBridgeStatus(): Promise<string> {
  if (!isNative()) return 'ok';
  return (await nativeInvoke<string>('audio_bridge_status')) ?? 'ok';
}

/**
 * Plays the 440 Hz tone for `seconds` (Rust default 1.5, clamped 0.5..15).
 * The diagnostics panel passes a longer tone so it outlasts its own polling.
 */
export async function playNativeTestTone(seconds?: number): Promise<boolean> {
  if (!isNative()) return false;
  await invokeAudio<null>('play_test_tone', { seconds: seconds ?? null });
  return true;
}

/** Saves the logger's last `seconds` of master audio to a WAV file. */
export async function recoverAudioLog(seconds = 60): Promise<RecoveredLog | null> {
  if (!isNative()) return null;
  return nativeInvoke<RecoveredLog | null>('recover_audio_log', { seconds });
}

export async function nativeChord(pitches: number[]): Promise<NativeChord | null> {
  if (!isNative()) return null;
  return nativeInvoke<NativeChord | null>('detect_chord', { pitches });
}

export async function nativeParseCommand(text: string): Promise<ParsedCommand | null> {
  if (!isNative()) return null;
  return nativeInvoke<ParsedCommand | null>('parse_native_command', { text });
}

/** Piano-roll note names from Rust; falls back to null in the browser build. */
export async function nativePitchNames(
  pitches: number[],
): Promise<{ pitch: number; name: string }[] | null> {
  if (!isNative()) return null;
  return nativeInvoke<{ pitch: number; name: string }[]>('pitch_names', { pitches });
}

/** Diatonic chords of a key, for the chord panel. */
export async function nativeChordSuggestions(
  root: number,
  minor: boolean,
): Promise<string[] | null> {
  if (!isNative()) return null;
  return nativeInvoke<string[]>('chord_suggestions', { root, minor });
}

/** Clip normalisation gains, individually or as a selection. */
export async function nativeNormaliseGains(
  peaks: number[],
  asGroup: boolean,
): Promise<number[] | null> {
  if (!isNative()) return null;
  return nativeInvoke<number[]>('normalise_clip_gains', { peaks, asGroup });
}

/* ------------------------------------------------------------------ *
 * Mixer routing, automation and editing tools (all local Rust)
 * ------------------------------------------------------------------ */

export interface NativeSend {
  to: number;
  amount: number;
  pre_fader?: boolean;
}

export interface NativeMixerStrip {
  id: number;
  gain: number;
  mute: boolean;
  solo: boolean;
  route?: number | null;
  sends: NativeSend[];
  sidechain?: number | null;
}

export interface NativeMixerRender {
  outputs: [number, number][];
  master: [number, number];
}

export interface NativeAutomationPoint {
  time: number;
  value: number;
  curve?: 'linear' | 'hold' | 'ease_in' | 'ease_out' | 's_curve';
}

export interface NativeAutomationLane {
  target: string;
  default: number;
  min: number;
  max: number;
  loop_len?: number | null;
  points: NativeAutomationPoint[];
}

export interface NativeToolNote {
  pitch: number;
  start: number;
  len: number;
  vel: number;
}

export interface NativeClipSpan {
  start: number;
  len: number;
}

export type NativeArpMode = 'up' | 'down' | 'up_down' | 'as_played';

export type NativeScale =
  | 'major'
  | 'natural_minor'
  | 'harmonic_minor'
  | 'melodic_minor'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'pentatonic_major'
  | 'pentatonic_minor'
  | 'blues'
  | 'chromatic';

/** Resolves mixer routing; rejects cycles and unknown destinations. */
export async function nativeMixerOrder(strips: NativeMixerStrip[]): Promise<number[] | null> {
  if (!isNative()) return null;
  return nativeInvoke<number[]>('mixer_order', { strips });
}

/** Mixes one frame per strip through the Rust routing graph. */
export async function nativeMixerRender(
  strips: NativeMixerStrip[],
  inputs: [number, number][],
): Promise<NativeMixerRender | null> {
  if (!isNative()) return null;
  return nativeInvoke<NativeMixerRender>('mixer_render', { strips, inputs });
}

/** Value of an automation lane at a position in 16th steps. */
export async function nativeAutomationValue(
  lane: NativeAutomationLane,
  time: number,
): Promise<number | null> {
  if (!isNative()) return null;
  return nativeInvoke<number>('automation_value', { lane, time });
}

/** One automation value per step. */
export async function nativeAutomationSample(
  lane: NativeAutomationLane,
  steps: number,
): Promise<number[] | null> {
  if (!isNative()) return null;
  return nativeInvoke<number[]>('automation_sample', { lane, steps });
}

/** Every automated parameter at `time`, keyed by target. */
export async function nativeAutomationApply(
  lanes: NativeAutomationLane[],
  time: number,
): Promise<Record<string, number> | null> {
  if (!isNative()) return null;
  return nativeInvoke<Record<string, number>>('automation_apply', {
    set: { lanes },
    time,
  });
}

export async function nativeStrum(
  notes: NativeToolNote[],
  start: number,
  tension = 0,
  velocity = 0,
): Promise<NativeToolNote[] | null> {
  if (!isNative()) return null;
  return nativeInvoke<NativeToolNote[]>('strum_notes', { notes, start, tension, velocity });
}

export async function nativeArpeggiate(
  notes: NativeToolNote[],
  mode: NativeArpMode,
  rate: number,
  octaves = 1,
): Promise<NativeToolNote[] | null> {
  if (!isNative()) return null;
  return nativeInvoke<NativeToolNote[]>('arpeggiate_notes', { notes, mode, rate, octaves });
}

export async function nativeFlam(
  notes: NativeToolNote[],
  offset: number,
  repeats = 2,
  velocityDecay = 0.3,
): Promise<NativeToolNote[] | null> {
  if (!isNative()) return null;
  return nativeInvoke<NativeToolNote[]>('flam_notes', {
    notes,
    offset,
    repeats,
    velocityDecay,
  });
}

export async function nativeScaleNotes(
  root: number,
  scale: NativeScale,
  octaves = 1,
): Promise<number[] | null> {
  if (!isNative()) return null;
  return nativeInvoke<number[]>('scale_notes', { root, scale, octaves });
}

export async function nativeSnapToScale(
  pitch: number,
  root: number,
  scale: NativeScale,
): Promise<number | null> {
  if (!isNative()) return null;
  return nativeInvoke<number>('snap_note_to_scale', { pitch, root, scale });
}

export async function nativeSliceClip(
  start: number,
  len: number,
  at: number,
): Promise<[NativeClipSpan, NativeClipSpan] | null> {
  if (!isNative()) return null;
  return nativeInvoke<[NativeClipSpan, NativeClipSpan]>('slice_clip', { start, len, at });
}

export async function nativeChopClip(
  start: number,
  len: number,
  pieces: number,
): Promise<NativeClipSpan[] | null> {
  if (!isNative()) return null;
  return nativeInvoke<NativeClipSpan[]>('chop_clip', { start, len, pieces });
}

export async function nativeQuantizeClipStart(
  start: number,
  grid: number,
): Promise<number | null> {
  if (!isNative()) return null;
  return nativeInvoke<number>('quantize_clip_start', { start, grid });
}

/** Evaluation order of a modular effect graph (Patcher-style). */
export async function nativeEffectGraphOrder(graph: unknown): Promise<number[] | null> {
  if (!isNative()) return null;
  return nativeInvoke<number[]>('effect_graph_order', { graph });
}

/* ------------------------------------------------------------------ *
 * 1.0.1: splash, preview, packs, suggestions, input, export
 * ------------------------------------------------------------------ */

export interface NativePackSample {
  name: string;
  path: string;
  tags: string[];
  bytes: number;
  category: string;
}

export type NativePackFormat = 'open_beats' | 'fl_studio' | 'generic' | 'flat';

export interface NativePackPreset {
  name: string;
  plugin: string;
  source: string;
  kind: 'openbeats' | 'vst2-fxp' | 'fl-native-fst' | 'flp-reference';
  playable: boolean;
  notes: string;
  params?: unknown;
}

export interface NativePackSkip {
  file: string;
  reason: string;
}

export interface NativePackReport {
  format: NativePackFormat;
  samples: number;
  categories: Record<string, number>;
  presets: number;
  skipped: NativePackSkip[];
  skipped_count: number;
  warnings: string[];
  log: string[];
  archive_bytes: number;
  extracted_bytes: number;
}

export interface NativePack {
  name: string;
  root: string;
  samples: NativePackSample[];
  format?: NativePackFormat;
  presets?: NativePackPreset[];
  managed?: boolean;
  warnings?: string[];
}

export interface NativePackImport {
  pack: NativePack;
  report: NativePackReport;
}

export interface NativeRemovePackResult {
  deleted_files: number;
  left_source: boolean;
}

export interface NativeInputReading {
  device: string;
  rms: number;
  peak: number;
  recording: boolean;
  tuning: { frequency: number; midi: number; cents: number; clarity: number } | null;
}

/** Plays the native chime through the CPAL engine. */
export async function nativePlayChime(): Promise<boolean> {
  if (!isNative()) return false;
  return (await nativeInvoke<null>('play_chime')) !== undefined;
}

/** Closes the native splash window. */
export async function nativeCloseSplash(): Promise<boolean> {
  if (!isNative()) return false;
  return Boolean(await nativeInvoke<boolean>('close_splash'));
}

/** Decodes and previews a file on the separate preview stream. */
export async function nativePreviewSample(
  path: string,
  device?: string | null,
): Promise<string | null> {
  if (!isNative()) return null;
  return invokeAudio<string>('preview_sample', { path, device: device ?? null });
}

/** The first seconds of a decoded one-shot, interleaved for the native path. */
export interface PreviewPcm {
  pcm: Float32Array;
  channels: number;
  sampleRate: number;
  frames: number;
}

export const MAX_PREVIEW_SECONDS = 12;

export function interleavePreview(
  buffer: AudioBuffer,
  maxSeconds = MAX_PREVIEW_SECONDS,
): PreviewPcm {
  const channels = Math.max(1, Math.min(8, buffer.numberOfChannels));
  const frames = Math.min(
    buffer.length,
    Math.max(1, Math.round(buffer.sampleRate * Math.max(0.1, maxSeconds))),
  );
  const pcm = new Float32Array(frames * channels);
  const data = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      pcm[frame * channels + channel] = data[channel]?.[frame] ?? 0;
    }
  }
  return { pcm, channels, sampleRate: buffer.sampleRate, frames };
}

function base64FromBytes(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Sends a decoded sample to CPAL, so browser auditions never use Web Audio. */
export async function nativePreviewPcm(
  buffer: AudioBuffer,
  device?: string | null,
): Promise<string | null> {
  if (!isNative()) return null;
  const preview = interleavePreview(buffer);
  const bytes = new Uint8Array(preview.pcm.buffer, preview.pcm.byteOffset, preview.pcm.byteLength);
  return invokeAudio<string>('preview_pcm', {
    pcmBase64: base64FromBytes(bytes),
    channels: preview.channels,
    sampleRate: preview.sampleRate,
    device: device ?? null,
    name: 'Sample',
  });
}

export async function nativeStopPreview(): Promise<boolean> {
  if (!isNative()) return false;
  return Boolean(await nativeInvoke<boolean>('stop_preview'));
}

/**
 * Imports a folder or .zip; the native dialog opens when `path` is omitted.
 * Cancellation returns null. Real failures reject so the UI can explain them.
 */
export async function nativeImportPack(
  path?: string,
  kind: 'folder' | 'zip' = 'folder',
  maxBytes?: number,
): Promise<NativePackImport | null> {
  if (!isNative()) return null;
  return invokeNative<NativePackImport | null>('import_pack', {
    path: path ?? null,
    kind,
    maxBytes: maxBytes ?? null,
  });
}

/** Removes an imported pack from the library. External source folders are kept. */
export async function nativeRemovePack(root: string): Promise<NativeRemovePackResult> {
  if (!isNative()) throw new Error('Pack removal is only available in the desktop app');
  return invokeNative<NativeRemovePackResult>('remove_pack', { root });
}

export async function nativeGetPacks(): Promise<NativePack[]> {
  if (!isNative()) return [];
  return (await nativeInvoke<NativePack[]>('get_packs')) ?? [];
}

export async function nativeReadSample(path: string): Promise<{ name: string; data: string } | null> {
  if (!isNative()) return null;
  return nativeInvoke<{ name: string; data: string }>('read_sample', { path });
}

/** Posts the suggestion to the webhook; null means it did not send. */
export async function nativeSubmitSuggestion(message: string): Promise<boolean> {
  if (!isNative()) return false;
  try {
    await nativeInvoke<null>('submit_suggestion', { message });
    return true;
  } catch {
    return false;
  }
}

export async function nativeStartInput(device?: string): Promise<string | null> {
  if (!isNative()) return null;
  return nativeInvoke<string>('start_input', { device: device ?? null });
}

export async function nativeSetInputMonitor(enabled: boolean, gain = 0.7): Promise<void> {
  if (!isNative()) return;
  await nativeInvoke<null>('set_input_monitor', { enabled, gain });
}

export async function nativeStartInputRecording(): Promise<boolean> {
  if (!isNative()) return false;
  return (await nativeInvoke<null>('start_input_recording')) !== undefined;
}

export async function nativeStopInputRecording(): Promise<{ path: string; seconds: number } | null> {
  if (!isNative()) return null;
  return nativeInvoke<{ path: string; seconds: number }>('stop_input_recording', { path: null });
}

/** Closes the input and monitor streams (used when saving a new input). */
export async function nativeStopInput(): Promise<boolean> {
  if (!isNative()) return false;
  return Boolean(await nativeInvoke<boolean>('stop_input'));
}

export async function nativeInputStatus(): Promise<NativeInputReading | null> {
  if (!isNative()) return null;
  return nativeInvoke<NativeInputReading>('input_status');
}

/** Encodes interleaved f32 PCM and writes it, opening a save dialog when path is null. */
export async function nativeExportAudio(opts: {
  format: string;
  quality?: number;
  sampleRate: number;
  channels: number;
  pcm: Float32Array;
  path?: string | null;
}): Promise<string | null> {
  if (!isNative()) return null;
  let binary = '';
  const bytes = new Uint8Array(opts.pcm.length * 4);
  const view = new DataView(bytes.buffer);
  opts.pcm.forEach((sample, index) => view.setFloat32(index * 4, sample, true));
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return nativeInvoke<string>('export_audio_with_dialog', {
    format: opts.format,
    quality: opts.quality ?? 5,
    sampleRate: opts.sampleRate,
    channels: opts.channels,
    pcmBase64: btoa(binary),
  });
}

/** One instrument note outside the transport (rack audition, piano keys). */
export async function nativePlayTestNote(opts: {
  preset: string;
  pitch: number;
  velocity?: number;
  gain?: number;
  pan?: number;
  root?: number;
  attack?: number;
  decay?: number;
  release?: number;
  tone?: number;
}): Promise<void> {
  if (!isNative()) return;
  await nativeInvoke<null>('play_test_note', {
    preset: nativeVoiceId(opts.preset),
    pitch: opts.pitch,
    velocity: opts.velocity ?? 0.85,
    gain: opts.gain ?? 0.9,
    pan: opts.pan ?? 0,
    root: opts.root ?? opts.pitch,
    attack: opts.attack ?? 0.01,
    decay: opts.decay ?? 0.35,
    release: opts.release ?? 0.25,
    tone: opts.tone ?? 0.5,
  });
}

/** One metronome click, even with the transport stopped. */
export async function nativePlayMetronome(accent = false): Promise<void> {
  if (!isNative()) return;
  await nativeInvoke<null>('play_metronome', { accent });
}

/** Moves the native playhead without stopping the stream. */
export async function nativeSetPlayhead(step: number): Promise<void> {
  if (!isNative()) return;
  await nativeInvoke<null>('set_playhead_position', { step: Math.max(0, Math.round(step)) });
}

/** Downloads and applies a release installer; rejects with the real error. */
export async function nativePerformUpdate(
  url: string,
  assets: UpdateAsset[] = [],
): Promise<string | null> {
  if (!isNative()) return null;
  return invokeNative<string>('perform_update', { url, assets });
}
