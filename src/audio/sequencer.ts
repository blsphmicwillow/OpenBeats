import type { Clip, Note, Project } from '../model/types';

export const STEPS_PER_BAR = 16;

export interface VoiceEvent {
  channelId: string;
  pitch: number;
  vel: number;
  /** Absolute position in 16th steps from song start. */
  step: number;
  lenSteps: number;
  /** Clip gain envelope value for this event; 1 when the clip is at unity. */
  gain?: number;
  /** Per-clip pan, -1..1. Used by the native engine. */
  pan?: number;
}

export function patternSteps(project: Project, patternId: string): number {
  const pat = project.patterns.find((p) => p.id === patternId);
  return Math.max(1, (pat?.bars ?? 1) * STEPS_PER_BAR);
}

export function songLengthSteps(project: Project): number {
  const end = project.clips.reduce((max, c) => Math.max(max, c.start + c.len), 0);
  const minimum = project.loopEnd || STEPS_PER_BAR * 4;
  return Math.max(STEPS_PER_BAR * 4, Math.ceil(Math.max(end, minimum) / STEPS_PER_BAR) * STEPS_PER_BAR);
}

/** Notes of one pattern that begin on `localStep` (looping within the pattern). */
export function eventsAtPatternStep(project: Project, patternId: string, localStep: number): VoiceEvent[] {
  const pattern = project.patterns.find((p) => p.id === patternId);
  if (!pattern) return [];
  const total = patternSteps(project, patternId);
  const step = ((localStep % total) + total) % total;
  const out: VoiceEvent[] = [];
  for (const channel of project.channels) {
    const notes: Note[] | undefined = pattern.notes[channel.id];
    if (!notes) continue;
    for (const n of notes) {
      const start = Math.round(n.start * 4) / 4;
      if (Math.abs(start - step) < 0.001) {
        out.push({ channelId: channel.id, pitch: n.pitch, vel: n.vel, step: localStep, lenSteps: n.len });
      }
    }
  }
  return out;
}

/** Fade multiplier for a position in steps inside a clip. */
export function clipFadeGain(clip: Clip, position: number): number {
  let gain = 1;
  const fadeIn = clip.fadeIn ?? 0;
  const fadeOut = clip.fadeOut ?? 0;
  if (fadeIn > 0 && position < fadeIn) gain *= Math.max(0, position / fadeIn);
  const fromEnd = clip.len - position;
  if (fadeOut > 0 && fromEnd < fadeOut) gain *= Math.max(0, fromEnd / fadeOut);
  return Math.min(1, gain);
}

/** Total clip gain (gain knob × fades) at a position in steps. */
export function clipGainAt(clip: Clip, position: number): number {
  return Math.max(0, clip.gain ?? 1) * clipFadeGain(clip, position);
}

/** Notes from every clip covering this absolute song step. */
export function eventsAtSongStep(project: Project, songStep: number): VoiceEvent[] {
  const out: VoiceEvent[] = [];
  for (const clip of project.clips) {
    if (songStep < clip.start || songStep >= clip.start + clip.len) continue;
    const track = project.tracks[clip.track];
    if (track && track.mute) continue;
    const rel = songStep - clip.start;
    const stretch = clip.stretch && clip.stretch > 0.05 ? clip.stretch : 1;
    const patternLen = patternSteps(project, clip.pattern) * stretch;
    const gain = clipGainAt(clip, rel);
    const pan = Math.max(-1, Math.min(1, clip.pan ?? 0));
    const transpose = clip.pitch ?? 0;
    // Walk each repetition of the pattern inside the clip; stretch maps song
    // steps onto pattern steps, so a 2× stretch triggers half as often.
    for (let cycle = 0; cycle * patternLen <= rel; cycle += 1) {
      const patternPos = (rel - cycle * patternLen) / stretch;
      if (Math.abs(patternPos - Math.round(patternPos)) > 0.001) continue;
      const localStep = Math.round(patternPos);
      if (localStep >= patternSteps(project, clip.pattern)) continue;
      for (const e of eventsAtPatternStep(project, clip.pattern, localStep)) {
        out.push({
          ...e,
          pitch: Math.max(0, Math.min(127, e.pitch + transpose)),
          gain,
          pan,
        });
      }
    }
  }
  return out;
}

/** Flattened song used by the offline exporter. */
export function songEvents(project: Project): VoiceEvent[] {
  const out: VoiceEvent[] = [];
  const length = songLengthSteps(project);
  for (let step = 0; step < length; step += 1) {
    out.push(...eventsAtSongStep(project, step));
  }
  return out;
}

export function stepsToSeconds(steps: number, bpm: number): number {
  return (steps * 60) / (bpm * 4);
}

/** Swing pushes odd 16ths later, in seconds. */
export function swingOffset(step: number, swing: number, stepSec: number): number {
  return step % 2 === 1 ? stepSec * 0.5 * Math.max(0, Math.min(0.85, swing)) : 0;
}

export function isChannelAudible(project: Project, channelId: string): boolean {
  const anySolo = project.channels.some((c) => c.solo);
  const ch = project.channels.find((c) => c.id === channelId);
  if (!ch || ch.mute) return false;
  if (anySolo && !ch.solo) return false;
  return true;
}

export function anyStripSolo(project: Project): boolean {
  return project.strips.some((s) => s.solo && s.id !== 0);
}

export function stripAudible(project: Project, stripId: number): boolean {
  const strip = project.strips.find((s) => s.id === stripId);
  if (!strip) return false;
  if (strip.mute) return false;
  if (anyStripSolo(project) && !strip.solo && stripId !== 0) return false;
  return true;
}
