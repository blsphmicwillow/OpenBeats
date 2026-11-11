/**
 * Pure drop planning for playlist audio clips.
 *
 * The Playlist component calls these; the smoke tests call the same functions
 * and then create the clip with `createAudioClipFromDrop`, so the assertions
 * cover the real decision logic rather than a copy of it.
 */

import type { AudioClip, SnapContext } from './model/audioClip';
import { createAudioClipFromDrop, resolveSnapTick, stepsToTicks } from './model/audioClip';
import type { MediaRef } from './model/audioClip';

export interface DroppedAudioFile {
  name: string;
  mime: string;
  durationSec: number;
}

export interface AudioDropPlanInput {
  files: DroppedAudioFile[];
  /** Pointer position expressed in ticks on the target track. */
  pointerTick: number;
  track: number;
  bpm: number;
  snap: SnapContext;
}

export interface PlannedClip {
  name: string;
  track: number;
  startTick: number;
  durationSec: number;
  mime: string;
}

/**
 * Places dropped files one after another from the snapped pointer position.
 * A cancelled drag never reaches this function, so nothing is written to the
 * model until the drop is committed.
 */
export function planAudioDrop(input: AudioDropPlanInput): PlannedClip[] {
  const startTick = resolveSnapTick(input.pointerTick, input.snap);
  const out: PlannedClip[] = [];
  let cursor = startTick;
  for (const file of input.files) {
    const durationSec = Math.max(0, file.durationSec);
    out.push({
      name: file.name,
      track: Math.max(0, Math.floor(input.track)),
      startTick: cursor,
      durationSec,
      mime: file.mime || 'application/octet-stream',
    });
    cursor += Math.max(1, Math.round((durationSec * input.bpm * 480) / 60));
  }
  return out;
}

/** Builds the model clip for one planned file once its media ref is known. */
export function clipFromPlan(
  plan: PlannedClip,
  mediaRef: MediaRef,
  sampleId: string,
  id: string,
  bpm: number,
): AudioClip {
  return createAudioClipFromDrop({
    id,
    sampleId,
    mediaRef,
    name: plan.name,
    bpm,
    durationSec: plan.durationSec,
    track: plan.track,
    startTick: plan.startTick,
  });
}

/**
 * Model commit/cancel pair. A drag only ever produces a ghost, so cancelling
 * returns the identical model object — no clip, no history entry, no residue.
 */
export interface AudioClipModel {
  audioClips: AudioClip[];
}

export function commitAudioDrop(model: AudioClipModel, clips: AudioClip[]): AudioClipModel {
  return { ...model, audioClips: [...model.audioClips, ...clips] };
}

export function cancelAudioDrop(model: AudioClipModel): AudioClipModel {
  return model;
}

/** Ghost rectangle shown while dragging audio over a lane. */
export interface DropGhost {
  track: number;
  startTick: number;
  lengthTicks: number;
}

export function dropGhost(
  track: number,
  pointerTick: number,
  bpm: number,
  defaultSeconds: number,
  snap: SnapContext,
): DropGhost {
  return {
    track,
    startTick: resolveSnapTick(pointerTick, snap),
    lengthTicks: Math.max(1, Math.round((defaultSeconds * bpm * 480) / 60)),
  };
}

/** Snap context built from the playlist's current zoom and neighbours. */
export function playlistSnapContext(opts: {
  pointerTick: number;
  playheadTick: number;
  gridSteps: number;
  pixelsPerStep: number;
  neighbourTicks: number[];
}): SnapContext {
  const ticksPerPixel = stepsToTicks(1) / Math.max(0.001, opts.pixelsPerStep);
  return {
    gridTicks: Math.max(0, opts.gridSteps) * stepsToTicks(1),
    // 10 px of tolerance, which is the same feel as the existing clip drags.
    thresholdTicks: 10 * ticksPerPixel,
    playheadTick: opts.playheadTick,
    edges: opts.neighbourTicks,
  };
}
