/**
 * Task B smoke tests — playlist audio clips.
 *
 * ENGINE UNDER TEST: Web Audio only. The native Rust/CPAL path has no
 * audio-clip voice in 1.0.5, so nothing here claims native playback.
 *
 * jsdom has neither Web Audio nor a reliable DataTransfer constructor, so:
 *  - `FakeAudioContext` records node creation and `start()` arguments;
 *  - the drop is a real DOM `drop` event whose listener calls the same planner
 *    (`planAudioDrop` → `clipFromPlan`) the Playlist drop handler uses. File
 *    durations stand in for the decoded buffer durations the store measures.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioClip, MediaRef } from './model/audioClip';
import {
  barToTicks,
  createAudioClipFromDrop,
  secondsToTicks,
  TICKS_PER_STEP,
} from './model/audioClip';
import { AudioClipPlayer, scheduleWindows } from './audio/audioClipScheduler';
import { cancelAudioDrop, clipFromPlan, planAudioDrop, playlistSnapContext } from './playlistDrop';

const BPM = 120;
const ZOOM = 9;

const MEDIA: MediaRef = {
  path: `idb://openbeats-media/${'a'.repeat(64)}`,
  hash: 'a'.repeat(64),
  mime: 'audio/wav',
  bytes: 480_000,
  name: 'take.wav',
};

class FakeParam {
  value = 1;
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
}

class FakeNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeSource extends FakeNode {
  buffer: AudioBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  start = vi.fn();
  stop = vi.fn();
}

class FakePanner extends FakeNode {
  pan = { value: 0 };
}

class FakeAudioContext {
  currentTime = 0;
  destination = new FakeNode();
  createGain = vi.fn(() => new FakeGain());
  createBufferSource = vi.fn(() => new FakeSource());
  createStereoPanner = vi.fn(() => new FakePanner());
}

function makeClip(startTick: number, durationSec = 5, id = 'ac_1'): AudioClip {
  return createAudioClipFromDrop({
    id,
    sampleId: 'smp_1',
    mediaRef: MEDIA,
    name: 'take.wav',
    bpm: BPM,
    durationSec,
    track: 0,
    startTick,
  });
}

/** 5 seconds of decoded audio (the test double for a real AudioBuffer). */
const buffer5s = { duration: 5 } as AudioBuffer;

/**
 * Dispatches a real `drop` event at `startBar` on a lane element. The listener
 * body mirrors the Playlist handler: plan from the snapped pointer, then build
 * each clip from its media ref.
 */
function simulateAudioDrop(
  files: { name: string; durationSec: number }[],
  startBar: number,
  options: { pointerOffsetPx?: number; playheadBar?: number } = {},
): AudioClip[] {
  const lane = document.createElement('div');
  document.body.appendChild(lane);
  const created: AudioClip[] = [];

  lane.addEventListener('drop', (event) => {
    const e = event as DragEvent;
    const rect = lane.getBoundingClientRect();
    const rawTick = ((e.clientX - rect.left) / ZOOM) * TICKS_PER_STEP;
    const snap = playlistSnapContext({
      pointerTick: rawTick,
      playheadTick: barToTicks(options.playheadBar ?? 0),
      gridSteps: 1,
      pixelsPerStep: ZOOM,
      neighbourTicks: [],
    });
    const plans = planAudioDrop({
      files,
      pointerTick: rawTick,
      track: 0,
      bpm: BPM,
      snap,
    });
    for (const plan of plans) created.push(clipFromPlan(plan, MEDIA, 'smp_1', 'ac_drop', BPM));
  });

  const fileList = files.map((f) => new File([new Uint8Array(8)], f.name, { type: 'audio/wav' }));
  const event = new MouseEvent('drop', {
    clientX: (barToTicks(startBar) / TICKS_PER_STEP) * ZOOM + (options.pointerOffsetPx ?? 0),
    clientY: 10,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'dataTransfer', {
    value: { files: fileList, types: ['Files'], dropEffect: 'copy' },
  });
  lane.dispatchEvent(event);
  lane.remove();
  return created;
}

describe('playlist audio clips (Web Audio)', () => {
  let ctx: FakeAudioContext;
  let player: AudioClipPlayer;

  beforeEach(() => {
    ctx = new FakeAudioContext();
    player = new AudioClipPlayer(
      ctx as unknown as BaseAudioContext,
      ctx.destination as unknown as AudioNode,
    );
  });

  it('1. schedules a mocked AudioBufferSourceNode instead of a real AudioContext', () => {
    const clip = makeClip(barToTicks(3));
    const started = player.schedule(
      [clip],
      new Map([[clip.id, buffer5s]]),
      { bpm: BPM, loop: false, loopStartTick: 0, loopEndTick: 0, tick: barToTicks(3) },
      2,
    );

    expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);
    const source = ctx.createBufferSource.mock.results[0].value as FakeSource;
    expect(source.buffer).toBe(buffer5s);
    expect(source.start).toHaveBeenCalledTimes(1);
    expect(started).toHaveLength(1);
  });

  it('2–3. creates an AudioClip at bar 3 when a 5-second file is dropped there', () => {
    const created = simulateAudioDrop([{ name: 'take.wav', durationSec: 5 }], 3);

    expect(created).toHaveLength(1);
    // Bar 3 in 4/4 is 8 beats = 3840 ticks.
    expect(created[0].start_tick).toBe(barToTicks(3));
    expect(created[0].start_tick).toBe(3840);
    expect(created[0].length_ticks).toBe(secondsToTicks(5, BPM));
    expect(created[0].length_ticks).toBe(4800);
    expect(created[0].media_ref.hash).toBe(MEDIA.hash);
    expect(created[0].track).toBe(0);
  });

  it('4–5. seeks to bar 5 and schedules the correct buffer offset', () => {
    const clip = makeClip(barToTicks(3));
    const windows = scheduleWindows(
      [clip],
      {
        bpm: BPM,
        fromTick: barToTicks(5),
        horizonSec: 10,
        loop: false,
        loopStartTick: 0,
        loopEndTick: 0,
      },
      { [clip.id]: 5 },
    );

    expect(windows).toHaveLength(1);
    // Bar 5 is 3840 ticks after the clip start: 3840/480 × (60/120) = 4 s.
    expect(windows[0].offsetSec).toBeCloseTo(4, 6);
    expect(windows[0].whenSec).toBeCloseTo(0, 6);
    // Only the last second of the 5 s file remains.
    expect(windows[0].durationSec).toBeCloseTo(1, 6);
  });

  it('6. a cancelled drag leaves the model untouched', () => {
    const model = { audioClips: [] as AudioClip[] };
    const cancelled = cancelAudioDrop(model);

    expect(cancelled).toBe(model);
    expect(cancelled.audioClips).toHaveLength(0);
  });

  it('reschedules the loop pass with the wrapped offset instead of restarting at zero', () => {
    const clip = makeClip(0, 5);
    // Loop bars 2–4: loop start 1920 ticks (bar 2), loop end 5760 ticks
    // (bar 4 downbeat = barToTicks(4)), so one pass is 4 s at 120 bpm.
    const windows = scheduleWindows(
      [clip],
      {
        bpm: BPM,
        fromTick: barToTicks(2),
        horizonSec: 7,
        loop: true,
        loopStartTick: barToTicks(2),
        loopEndTick: barToTicks(4),
      },
      { [clip.id]: 5 },
    );

    expect(windows.length).toBe(2);
    // First pass resumes 2 s into the file (1920 ticks at 120 bpm).
    expect(windows[0].offsetSec).toBeCloseTo(2, 6);
    expect(windows[0].loopPass).toBe(0);
    // After the wrap the clip resumes at the same offset, one pass (4 s)
    // later — not from 0 s, which was the pre-1.0.5 bug.
    expect(windows[1].loopPass).toBe(1);
    expect(windows[1].offsetSec).toBeCloseTo(2, 6);
    expect(windows[1].whenSec).toBeCloseTo(4, 6);
  });
});
