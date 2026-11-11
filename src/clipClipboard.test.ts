import { describe, expect, it } from 'vitest';
import type { AudioClip } from './model/audioClip';
import { pasteAudioClip, pastePatternClip, snapshotClip } from './model/clipClipboard';
import type { Clip, Project } from './model/types';

const pattern: Clip = {
  id: 'cl-1',
  pattern: 'pat-1',
  track: 2,
  start: 16,
  len: 32,
  gain: 0.8,
  pan: -0.2,
  fadeIn: 4,
  fadeOut: 6,
};

const audio: AudioClip = {
  id: 'ac-1',
  sample_id: 'sample-1',
  media_ref: { path: 'idb://x', hash: 'abc', mime: 'audio/wav', bytes: 100, name: 'loop.wav' },
  start_tick: 480,
  length_ticks: 960,
  source_offset_ticks: 240,
  gain: 1,
  pan: 0,
  pitch_cents: 0,
  stretch_ratio: 1,
  fade_in: 120,
  fade_out: 240,
  reversed: true,
  normalized: true,
  loop_mode: 'loop',
  name: 'loop.wav',
  track: 1,
};

describe('clip clipboard', () => {
  it('snapshots patterns without retaining project references', () => {
    const project = { clips: [pattern], audioClips: [audio] } as Project;
    const snapshot = snapshotClip(project, pattern.id);
    expect(snapshot).toMatchObject({ kind: 'pattern', clip: { id: 'cl-1', pattern: 'pat-1' } });
    project.clips[0].start = 999;
    expect(snapshot?.clip.start).toBe(16);
  });

  it('pastes a pattern at a new position and track', () => {
    const pasted = pastePatternClip(pattern, 64, 0, 'new-clip');
    expect(pasted).toMatchObject({ id: 'new-clip', track: 0, start: 64, len: 32, gain: 0.8, fadeIn: 4, fadeOut: 6 });
  });

  it('pastes audio with its source flags and media intact', () => {
    const project = { clips: [], audioClips: [audio] } as Project;
    const snapshot = snapshotClip(project, audio.id);
    expect(snapshot?.kind).toBe('audio');
    if (!snapshot || snapshot.kind !== 'audio') return;
    const pasted = pasteAudioClip(snapshot.clip, 8, 3, 'new-audio');
    expect(pasted).toMatchObject({
      id: 'new-audio',
      track: 3,
      start_tick: 960,
      source_offset_ticks: 240,
      reversed: true,
      normalized: true,
      loop_mode: 'loop',
    });
    expect(pasted.media_ref).toEqual(audio.media_ref);
  });
});
