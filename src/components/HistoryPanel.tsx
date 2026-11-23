import { useSyncExternalStore } from 'react';
import { useApp } from '../store';
import {
  capture,
  clear,
  getSnapshots,
  remove,
  restore,
  subscribe,
  type Snapshot,
} from '../lib/snapshots';
import { IconWave } from '../ui/icons';

/**
 * Named project snapshots. Undo is for the last few moves; this panel is for
 * "the version from ten minutes ago, before I changed the drums" and survives a
 * long detour. Snapshots are in memory for this session.
 */
export function HistoryPanel() {
  const entries = useSyncExternalStore(subscribe, getSnapshots, getSnapshots);
  const project = useApp((s) => s.project);
  const patchProject = useApp((s) => s.patchProject);
  const toast = useApp((s) => s.toast);

  const take = () => {
    capture(project, 'Manual');
    toast('Snapshot saved');
  };

  const apply = (entry: Snapshot) => {
    const next = restore(entry.id);
    if (!next) return;
    patchProject((p) => {
      Object.assign(p, next);
    });
    toast(`Restored the snapshot from ${new Date(entry.at).toLocaleTimeString()}`);
  };

  return (
    <div className="changelog">
      <div className="cl-head">
        <div>
          <div className="cl-eyebrow">History</div>
          <h2>Project snapshots</h2>
          <p className="cl-sub">
            {entries.length === 0
              ? 'Nothing captured yet. One is taken automatically as you edit, or save one now.'
              : `${entries.length} saved. Restoring never touches the undo stack.`}
          </p>
        </div>
        <div className="cl-actions">
          <button className="btn ghost small" onClick={take}>
            <IconWave size={12} /> Capture now
          </button>
          <button
            className="btn ghost small"
            onClick={() => {
              clear();
              toast('Snapshots cleared');
            }}
            disabled={entries.length === 0}
          >
            Clear all
          </button>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="cl-sub">Snapshots stay in memory for this session.</p>
      ) : (
        <ul className="cl-list">
          {entries.map((entry) => (
            <li key={entry.id} className="cl-group">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <b style={{ minWidth: 86 }}>{new Date(entry.at).toLocaleTimeString()}</b>
                <span className="cl-sub">{entry.label}</span>
                <span style={{ flex: 1 }} />
                <button className="btn ghost small" onClick={() => apply(entry)}>
                  Restore
                </button>
                <button className="btn ghost small" onClick={() => remove(entry.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
