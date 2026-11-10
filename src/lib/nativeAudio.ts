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
