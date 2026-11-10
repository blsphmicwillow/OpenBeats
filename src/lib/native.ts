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
