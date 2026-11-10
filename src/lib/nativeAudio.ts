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
