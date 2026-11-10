/**
 * Bridge to the native Rust audio engine.
 *
 * The desktop build plays through CPAL in Rust: this module flattens the project
 * into the snapshot `start_playback` expects, so the WebView never touches Web
 * Audio. In a plain browser (the web demo) `isNative()` is false and the caller
 * keeps using the Web Audio engine.
 */

import type { Project } from '../model/types';
import {
  eventsAtPatternStep,
  eventsAtSongStep,
  isChannelAudible,
  patternSteps,
  songLengthSteps,
} from '../audio/sequencer';
import { isNative, nativeInvoke } from './native';

export interface PlaybackChannelSnapshot {
  id: string;
  preset: string;
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
}

export interface AudioDeviceInfo {
  name: string;
  kind: 'output' | 'input';
  host: string;
  is_default: boolean;
  channels: number;
  sample_rate: number;
  /** True for the Linux PulseAudio/PipeWire bridge. */
  is_pulse_bridge: boolean;
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
      preset: channel.preset,
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
  return nativeInvoke<NativePlaybackStatus>('start_playback', {
    projectData: JSON.stringify(snapshot),
  });
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

/** Every input and output device, for the Audio settings tab. */
export async function getAudioDevices(): Promise<AudioDeviceInfo[]> {
  if (!isNative()) return [];
  return (await nativeInvoke<AudioDeviceInfo[]>('get_audio_devices')) ?? [];
}

/** Rebuilds the CPAL stream on a device (null restores the platform default). */
export async function selectAudioDevice(
  device: string | null,
): Promise<NativePlaybackState | null> {
  if (!isNative()) return null;
  return nativeInvoke<NativePlaybackState>('select_audio_device', { device });
}

/** Reopens the stream with the device minimum buffer, or its default size. */
export async function setLowLatency(enabled: boolean): Promise<NativePlaybackState | null> {
  if (!isNative()) return null;
  return nativeInvoke<NativePlaybackState>('set_low_latency', { enabled });
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

export async function playNativeTestTone(): Promise<boolean> {
  if (!isNative()) return false;
  await nativeInvoke<null>('play_test_tone');
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
}

export interface NativePack {
  name: string;
  root: string;
  samples: NativePackSample[];
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
export async function nativePreviewSample(path: string): Promise<string | null> {
  if (!isNative()) return null;
  try {
    return await nativeInvoke<string>('preview_sample', { path });
  } catch {
    return null;
  }
}

export async function nativeStopPreview(): Promise<boolean> {
  if (!isNative()) return false;
  return Boolean(await nativeInvoke<boolean>('stop_preview'));
}

/** Imports a folder or .zip; the native dialog opens when `path` is omitted. */
export async function nativeImportPack(path?: string): Promise<NativePack | null> {
  if (!isNative()) return null;
  try {
    return await nativeInvoke<NativePack>('import_pack', { path: path ?? null });
  } catch {
    return null;
  }
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
    preset: opts.preset,
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

/** Downloads and launches a release installer; a string is the status message. */
export async function nativePerformUpdate(url: string): Promise<string | null> {
  if (!isNative()) return null;
  return nativeInvoke<string>('perform_update', { url });
}
