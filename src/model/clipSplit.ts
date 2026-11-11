import type { AudioClip } from './audioClip';
import type { Clip } from './types';

/**
 * Non-destructive split at a song position. Fades on the outside edges survive;
 * fades on the new inner edges start at zero so the split does not dip.
 */
export function splitPatternClip(
  clip: Clip,
  atStep: number,
  nextId: () => string,
): [Clip, Clip] | null {
  const at = Math.round(atStep);
  const end = clip.start + clip.len;
  if (at <= clip.start || at >= end) return null;
  const leftLen = at - clip.start;
  const rightLen = end - at;
  return [
    {
      ...clip,
      id: nextId(),
      len: leftLen,
      fadeIn: Math.min(clip.fadeIn ?? 0, leftLen),
      fadeOut: 0,
    },
    {
      ...clip,
      id: nextId(),
      start: at,
      len: rightLen,
      fadeIn: 0,
      fadeOut: Math.min(clip.fadeOut ?? 0, rightLen),
    },
  ];
}

export function splitAudioClip(
  clip: AudioClip,
  atTick: number,
  nextId: () => string,
): [AudioClip, AudioClip] | null {
  const at = Math.round(atTick);
  const end = clip.start_tick + clip.length_ticks;
  if (at <= clip.start_tick || at >= end) return null;
  const leftLen = at - clip.start_tick;
  const rightLen = end - at;
  const sourceOffset = Math.max(0, clip.source_offset_ticks ?? 0);
  return [
    {
      ...clip,
      id: nextId(),
      length_ticks: leftLen,
      source_offset_ticks: sourceOffset,
      fade_in: Math.min(clip.fade_in, leftLen),
      fade_out: 0,
    },
    {
      ...clip,
      id: nextId(),
      start_tick: at,
      length_ticks: rightLen,
      source_offset_ticks: sourceOffset + leftLen,
      fade_in: 0,
      fade_out: Math.min(clip.fade_out, rightLen),
    },
  ];
}
