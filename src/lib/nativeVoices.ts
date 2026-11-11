/**
 * The Rust/CPAL voice pool predates the 2026 instrument wave, so the desktop
 * engine plays the closest native voice for Web Audio-only instruments instead
 * of falling through to its sample/noise default. Keep this in sync with
 * `Preset::from_id` in src-tauri/crates/openbeats-audio/src/synth.rs.
 */
export const NATIVE_VOICE_APPROX: Record<string, string> = {
  anvil: 'kick',
  prism: 'glass',
  sundial: 'lead',
  cordwood: 'pluck',
  vector9: 'keys',
  acidwell: 'bass',
  dice: 'lead',
  dustdevil: 'sample',
  chatter: 'choir',
  hammerfelt: 'keys',
};

/** The id sent to the native engine for a UI preset. */
export function nativeVoiceId(preset: string): string {
  return NATIVE_VOICE_APPROX[preset] ?? preset;
}
