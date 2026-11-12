/**
 * Decides whether the app may create a Web Audio context at startup.
 *
 * A Web Audio context is not a harmless object: WebKitGTK backs it with a real
 * GStreamer output stream, so creating one in the desktop build opened a second
 * "openbeats" sink-input (1764 frames at 44100 Hz) next to the native CPAL one.
 * The native engine already owns the output, so the context must be created on
 * demand, by the features that only exist in Web Audio, and never at startup.
 */
export type AudioInitMode =
  /** Browser build: Web Audio is the only engine, create it. */
  | 'browser'
  /** Desktop with an open native stream: do not touch Web Audio. */
  | 'native'
  /** The startup chime is about to open the device: let it go first. */
  | 'deferred'
  /** Desktop, no native stream: create Web Audio and report the fallback. */
  | 'fallback';

export interface AudioInitInput {
  /** True inside the Tauri shell, where the Rust engine can open a device. */
  shell: boolean;
  /** Sample rate of an already-open native stream; 0 when none is open. */
  nativeSampleRate: number;
  /** The startup chime will open the native device moments from now. */
  chimePending: boolean;
}

export function resolveAudioInit(input: AudioInitInput): AudioInitMode {
  if (!input.shell) return 'browser';
  if (input.nativeSampleRate > 0) return 'native';
  if (input.chimePending) return 'deferred';
  return 'fallback';
}

/** Whether this mode is allowed to construct an AudioContext. */
export function createsWebAudio(mode: AudioInitMode): boolean {
  return mode === 'browser' || mode === 'fallback';
}
