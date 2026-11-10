/** Minimal structural type so effects/instruments compile against both the live
 * AudioContext and an OfflineAudioContext used for WAV export. */
export type BaseAudioContext = globalThis.BaseAudioContext;
