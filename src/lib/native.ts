/**
 * Thin bridge to the Tauri (Rust) shell. Everything degrades to the browser
 * implementation when the app is running in a plain webview or a browser tab,
 * so the same bundle powers the desktop builds and the web demo.
 */

interface TauriInternals {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

function internals(): TauriInternals | null {
  const w = window as unknown as { __TAURI_INTERNALS__?: TauriInternals };
  return w.__TAURI_INTERNALS__ ?? null;
}

export interface AudioErrorReport {
  command: string;
  message: string;
  at: number;
  /** How many times this exact failure has repeated, for the settings panel. */
  count: number;
}

/** Identical failures inside this window share a single toast. */
const AUDIO_ERROR_COOLDOWN_MS = 4000;

const audioErrorSeen = new Map<string, number>();
let lastAudioError: AudioErrorReport | null = null;

/** The most recent native audio failure, for the Audio settings panel. */
export function audioErrorReport(): AudioErrorReport | null {
  return lastAudioError;
}

/**
 * Records an audio failure where a human can see it. Silence is the one bug the
 * engine cannot report by itself, so every failed audio command ends up here: a
 * console line for the log and a window event the UI turns into a toast.
 */
export function reportAudioError(command: string, message: string) {
  const now = Date.now();
  const key = `${command}\u0000${message}`;
  const previous = audioErrorSeen.get(key);
  const repeated = previous !== undefined && now - previous < AUDIO_ERROR_COOLDOWN_MS;
  const count =
    repeated && lastAudioError?.command === command && lastAudioError.message === message
      ? lastAudioError.count + 1
      : 1;
  audioErrorSeen.set(key, now);
  // Bounded: a reconnect loop can vary the message on every attempt.
  if (audioErrorSeen.size > 32) {
    for (const [seenKey, at] of audioErrorSeen) {
      if (now - at >= AUDIO_ERROR_COOLDOWN_MS) audioErrorSeen.delete(seenKey);
    }
  }
  lastAudioError = { command, message, at: now, count };
  // One toast per burst; polling callers cannot flood the screen.
  if (repeated) return;
  console.error(`OpenBeats audio command “${command}” failed: ${message}`);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<AudioErrorReport>('openbeats:audio-error', { detail: lastAudioError }),
    );
  }
}

export function isNative(): boolean {
  return internals() !== null;
}

export async function nativeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  const api = internals();
  if (!api) return null;
  try {
    return await api.invoke<T>(cmd, args);
  } catch (err) {
    console.warn(`native command “${cmd}” failed`, err);
    return null;
  }
}

/** Like nativeInvoke, but rejects so a dialog can show the real error. */
export async function invokeNative<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const api = internals();
  if (!api) throw new Error('This feature is only available in the desktop app');
  return api.invoke<T>(cmd, args);
}

/**
 * The loud wrapper for audio commands. It reports the failure before rethrowing,
 * so a caller may still fall back to Web Audio — but never silently. Use the
 * quiet `nativeInvoke` for optional features and polling.
 */
export async function invokeAudio<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invokeNative<T>(cmd, args);
  } catch (error) {
    reportAudioError(cmd, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/** Opens a URL in the system browser (native) or a new tab (web). */
export async function openExternal(url: string): Promise<void> {
  if (isNative()) {
    const ok = await nativeInvoke<boolean>('open_external', { url });
    if (ok) return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Native save dialog; returns false when unavailable so callers can fall back to a download. */
export async function saveTextNative(contents: string, suggestedName: string): Promise<boolean> {
  if (!isNative()) return false;
  const result = await nativeInvoke<string | null>('save_text_file', { contents, suggestedName });
  return Boolean(result);
}

/** Native open dialog; returns the file text or null. */
export async function openTextNative(): Promise<string | null> {
  if (!isNative()) return null;
  return nativeInvoke<string | null>('open_text_file');
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Native save dialog for binary song files (MIDI). Falls back to a browser download. */
export async function saveBinaryNative(bytes: Uint8Array, suggestedName: string): Promise<boolean> {
  if (!isNative()) return false;
  const result = await nativeInvoke<string | null>('save_binary_file', {
    data: toBase64(bytes),
    suggestedName,
  });
  return Boolean(result);
}

export async function nativePlatform(): Promise<string> {
  if (!isNative()) return 'web';
  return (await nativeInvoke<string>('platform')) ?? 'native';
}
