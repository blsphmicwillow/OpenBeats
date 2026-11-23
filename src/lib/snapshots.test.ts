import { beforeEach, describe, expect, it } from 'vitest';
import { capture, clear, getSnapshots, remove, reset, restore, SNAPSHOT_LIMIT } from './snapshots';
import { demoProject } from '../model/defaults';

function project(name: string) {
  return { ...demoProject(), name };
}

describe('snapshots', () => {
  beforeEach(() => reset());

  it('keeps the newest snapshot first', () => {
    capture(project('one'), 'first', 1_000);
    capture(project('two'), 'second', 2_000);
    expect(getSnapshots().map((entry) => entry.label)).toEqual(['second', 'first']);
  });

  it('caps the list and drops the oldest', () => {
    for (let i = 0; i < SNAPSHOT_LIMIT + 5; i += 1) capture(project(`take ${i}`), 'Edit', i);
    const entries = getSnapshots();
    expect(entries).toHaveLength(SNAPSHOT_LIMIT);
    expect(entries[0].project.name).toBe(`take ${SNAPSHOT_LIMIT + 4}`);
    expect(entries.some((entry) => entry.project.name === 'take 0')).toBe(false);
  });

  it('stores a deep copy, so later edits do not leak in', () => {
    const source = project('original');
    const entry = capture(source, 'manual', 1_000);
    source.name = 'edited after capture';
    source.channels[0].gain = 0;
    const stored = getSnapshots().find((item) => item.id === entry.id);
    expect(stored?.project.name).toBe('original');
    expect(stored?.project.channels[0].gain).not.toBe(0);
  });

  it('restores a copy and returns null for an unknown id', () => {
    const entry = capture(project('restorable'), 'manual', 1_000);
    const restored = restore(entry.id);
    expect(restored?.name).toBe('restorable');
    restored!.name = 'mutated copy';
    expect(getSnapshots()[0].project.name).toBe('restorable');
    expect(restore('missing')).toBeNull();
  });

  it('removes one entry and clears the rest', () => {
    const first = capture(project('one'), 'a', 1_000);
    capture(project('two'), 'b', 2_000);
    remove(first.id);
    expect(getSnapshots()).toHaveLength(1);
    clear();
    expect(getSnapshots()).toHaveLength(0);
  });
});
