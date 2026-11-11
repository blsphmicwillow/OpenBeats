/**
 * The Rust/CPAL voice pool implements every preset id, including the ten 2026
 * instruments, so the UI preset is sent to the native engine unchanged. The
 * helper stays as the single place to add a redirect if a future preset has no
 * native voice yet.
 */
export const NATIVE_VOICE_APPROX: Record<string, string> = {};

/** The id sent to the native engine for a UI preset. */
export function nativeVoiceId(preset: string): string {
  return NATIVE_VOICE_APPROX[preset] ?? preset;
}
