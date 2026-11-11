import { TICKS_PER_STEP, type AudioClip } from './audioClip';
import type { Clip, Project } from './types';

export type ClipClipboard =
  | { kind: 'pattern'; clip: Clip }
  | { kind: 'audio'; clip: AudioClip };

/** Snapshot the selected clip without retaining a live reference to the project. */
export function snapshotClip(project: Project, id: string): ClipClipboard | null {
  const pattern = project.clips.find((clip) => clip.id === id);
  if (pattern) return { kind: 'pattern', clip: structuredClone(pattern) };
  const audio = project.audioClips.find((clip) => clip.id === id);
  if (audio) return { kind: 'audio', clip: structuredClone(audio) };
  return null;
}

export function pastePatternClip(clip: Clip, atStep: number, track: number, id: string): Clip {
  return {
    ...structuredClone(clip),
    id,
    track,
    start: Math.max(0, Math.round(atStep)),
  };
}

export function pasteAudioClip(clip: AudioClip, atStep: number, track: number, id: string): AudioClip {
  return {
    ...structuredClone(clip),
    id,
    track,
    start_tick: Math.max(0, Math.round(atStep * TICKS_PER_STEP)),
  };
}
