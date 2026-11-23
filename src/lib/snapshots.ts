import type { Project } from '../model/types';

/**
 * Named project snapshots, separate from the undo stack.
 *
 * Undo is shallow and short lived (`past`/`future` in the store). A snapshot is
 * a deep copy the user can jump back to after a long detour, so it is kept in a
 * module store with its own subscription and capped at a fixed length.
 */
export interface Snapshot {
  id: string;
  label: string;
  at: number;
  project: Project;
}

export const SNAPSHOT_LIMIT = 40;

let entries: Snapshot[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshots(): Snapshot[] {
  return entries;
}

export function capture(
  project: Project,
  label = 'Edit',
  at = Date.now(),
  limit = SNAPSHOT_LIMIT,
): Snapshot {
  const snapshot: Snapshot = {
    id: `snap-${at}-${entries.length}`,
    label,
    at,
    project: structuredClone(project),
  };
  entries = [snapshot, ...entries].slice(0, limit);
  emit();
  return snapshot;
}

let lastAuto = 0;

/** Automatic snapshots are throttled: one at most every `everyMs`. */
export function captureIfDue(
  project: Project,
  everyMs = 20_000,
  at = Date.now(),
): Snapshot | null {
  if (at - lastAuto < everyMs) return null;
  lastAuto = at;
  return capture(project, 'Auto', at);
}

/** A copy, so restoring and then editing cannot mutate the stored snapshot. */
export function restore(id: string): Project | null {
  const found = entries.find((entry) => entry.id === id);
  return found ? structuredClone(found.project) : null;
}

export function remove(id: string): void {
  entries = entries.filter((entry) => entry.id !== id);
  emit();
}

export function clear(): void {
  entries = [];
  emit();
}

/** Test helper: drops state and listeners between cases. */
export function reset(): void {
  entries = [];
  listeners.clear();
}
