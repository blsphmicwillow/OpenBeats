/**
 * Transport glue for playlist audio clips.
 *
 * ENGINE: Web Audio only. `scheduleAudioClips` is called by the Web Audio tick
 * in `store.ts`; the native transport never sees audio clips, which is why the
 * UI carries "Playlist audio clips: Web Audio (desktop native pending)".
 *
 * Loop handling: on play/seek the player schedules the current pass plus the
 * next loop pass. When the transport wraps, `advanceAudioClips` extends one more
 * pass without restarting what is already sounding. That is the fix for the
 * original gap where clips were scheduled once and never came back after a
 * wrap.
 */

import type { Project } from '../model/types';
import { TICKS_PER_STEP } from '../model/audioClip';
import { AudioClipPlayer } from './audioClipScheduler';
import { buffersForClips } from './sampleLibrary';

let player: AudioClipPlayer | null = null;
let lastStep = 0;

function transportFor(project: Project, step: number) {
  return {
    bpm: project.bpm,
    loop: project.loop,
    loopStartTick: project.loopStart * TICKS_PER_STEP,
    loopEndTick: project.loopEnd * TICKS_PER_STEP,
    tick: Math.max(0, step) * TICKS_PER_STEP,
  };
}

/** Loop length in seconds; 0 when the project does not loop. */
function loopSeconds(project: Project): number {
  const length = (project.loopEnd - project.loopStart) * TICKS_PER_STEP;
  if (!project.loop || length <= 0) return 0;
  return (length / 480) * (60 / Math.max(1, project.bpm));
}

/** Current pass plus the upcoming wrap, so a loop never falls silent. */
function horizonFor(project: Project, step: number): number {
  const pass = loopSeconds(project);
  if (pass <= 0) return 1;
  const endRel = Math.max(0, project.loopEnd - step) * TICKS_PER_STEP;
  const untilWrap = (endRel / 480) * (60 / Math.max(1, project.bpm));
  return untilWrap + pass;
}

export function startAudioClips(ctx: BaseAudioContext, destination: AudioNode, project: Project, step: number): void {
  stopAudioClips();
  if (!project.audioClips?.length) return;
  player = new AudioClipPlayer(ctx, destination);
  lastStep = step;
  player.schedule(
    project.audioClips,
    buffersForClips(project.audioClips),
    transportFor(project, step),
    horizonFor(project, step),
  );
}

/**
 * Called on every transport tick. Detects the wrap (the step moved backwards)
 * and schedules the next pass; while playing inside a pass it does nothing.
 */
export function advanceAudioClips(project: Project, step: number): void {
  if (!player) return;
  const wrapped = step < lastStep;
  lastStep = step;
  if (!wrapped) return;
  player.extend(
    project.audioClips,
    buffersForClips(project.audioClips),
    transportFor(project, step),
    loopSeconds(project) || 1,
  );
}

export function stopAudioClips(): void {
  player?.stopAll();
  player = null;
}

export function audioClipWindows() {
  return player?.lastWindows ?? [];
}
