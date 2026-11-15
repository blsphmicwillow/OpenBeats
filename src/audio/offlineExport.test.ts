import { describe, expect, it } from 'vitest';
import { createStrip, blankProject } from '../model/defaults';
import { mixerRenderOrder, shiftInterleavedAudio } from './export';

describe('offline plugin export', () => {
  it('orders routed and send destinations after their source strips', () => {
    const project = blankProject();
    project.strips = [createStrip(0, 'Master', ''), createStrip(1, 'Source', ''), createStrip(2, 'Bus', '')];
    project.strips[1].route = 2;
    project.strips[1].sends = [{ to: 0, amount: 0.25 }];

    expect(mixerRenderOrder(project).map((strip) => strip.id)).toEqual([1, 2, 0]);
  });

  it('rejects cyclic mixer routes before rendering', () => {
    const project = blankProject();
    project.strips = [createStrip(0, 'Master', ''), createStrip(1, 'A', ''), createStrip(2, 'B', '')];
    project.strips[1].route = 2;
    project.strips[2].route = 1;

    expect(() => mixerRenderOrder(project)).toThrow('Mixer routing contains a cycle');
  });

  it('adds latency compensation by shifting complete stereo frames', () => {
    const input = new Float32Array([1, -1, 2, -2, 3, -3]);
    expect(shiftInterleavedAudio(input, 1)).toEqual(new Float32Array([0, 0, 1, -1, 2, -2]));
  });
});
