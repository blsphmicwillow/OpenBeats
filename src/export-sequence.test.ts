import { describe, expect, it } from 'vitest';
import { demoProject } from './model/defaults';
import { songEvents, songLengthSteps } from './audio/sequencer';

describe('offline song coverage', () => {
  it('emits note events through the final arrangement step', () => {
    const project = demoProject();
    const length = songLengthSteps(project);
    const events = songEvents(project);
    expect(length).toBe(128);
    expect(events.length).toBeGreaterThan(0);
    expect(Math.max(...events.map((event) => event.step))).toBeGreaterThanOrEqual(96);
  });
});
