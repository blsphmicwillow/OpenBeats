import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store';
import { Modal } from '../ui/Modal';
import { openExternal } from '../lib/native';
import {
  formatBytes,
  loadPluginCatalog,
  pluginPlatformLabel,
  recommendedAsset,
  type PluginCatalog,
  type PluginEntry,
  type PluginFormat,
} from '../lib/pluginRegistry';
import { IconDownload, IconSearch } from '../ui/icons';

const ISSUE_URL =
  'https://github.com/blsphmicwillow/OpenBeats/issues/new?template=plugin-submission.yml';

/** Registry-backed VST3/CLAP browser. It links downloads but never loads a plugin. */
export function PluginBrowser() {
  const open = useApp((s) => s.ui.pluginsOpen);
  const setUI = useApp((s) => s.setUI);
  const [catalog, setCatalog] = useState<PluginCatalog | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [format, setFormat] = useState<'all' | PluginFormat>('all');
  const [busy, setBusy] = useState(false);

  const load = async (force = false) => {
    setBusy(true);
    try {
      const next = await loadPluginCatalog(force);
      setCatalog(next);
      setSelectedId((current) => current || next.entries[0]?.id || '');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (open && !catalog) void load();
    // The catalog is fetched once per app session; Refresh forces a live lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, catalog]);

  const filtered = useMemo(() => {
    if (!catalog) return [];
    const q = query.trim().toLowerCase();
    return catalog.entries.filter((entry) => {
      if (format !== 'all' && !entry.formats.includes(format)) return false;
      if (!q) return true;
      return `${entry.name} ${entry.author} ${entry.description}`.toLowerCase().includes(q);
    });
  }, [catalog, format, query]);

  if (!open) return null;

  const selected =
    filtered.find((entry) => entry.id === selectedId) ?? filtered[0] ?? catalog?.entries[0] ?? null;
  const close = () => setUI({ pluginsOpen: false });
  const recommended = selected ? recommendedAsset(selected) : null;

  return (
    <Modal
      title="Plugin library"
      subtitle="Native VST3/CLAP releases · OpenBeats 1.0.0 browses and downloads; it does not host plugins yet"
      onClose={close}
      footer={
        <>
          <button className="btn ghost" onClick={() => void load(true)} disabled={busy}>
            {busy ? 'Refreshing…' : 'Refresh'}
          </button>
          <span className="tiny-note">
            {catalog ? `${catalog.source === 'remote' ? 'Live registry' : 'Bundled registry'} · updated ${catalog.updatedAt}` : 'Loading registry…'}
          </span>
          <div className="spacer" />
          <button className="btn ghost" onClick={() => void openExternal(ISSUE_URL)}>
            Submit a plugin
          </button>
          <button className="btn primary" onClick={close}>
            Done
          </button>
        </>
      }
    >
      <div className="plugin-browser">
        <div className="plugin-sidebar">
          <div className="plugin-search">
            <IconSearch size={13} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search plugins…"
              aria-label="Search plugins"
            />
          </div>
          <div className="plugin-filters" role="group" aria-label="Filter by plugin format">
            {(['all', 'vst3', 'clap'] as const).map((value) => (
              <button
                key={value}
                className={`plugin-filter ${format === value ? 'active' : ''}`}
                onClick={() => setFormat(value)}
                aria-pressed={format === value}
              >
                {value === 'all' ? 'All' : value.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="plugin-list">
            {busy && !catalog && <div className="plugin-empty">Reading registry…</div>}
            {!busy && !filtered.length && (
              <div className="plugin-empty">
                No matching plugins.
                <br />
                <button className="link-btn" onClick={() => void openExternal(ISSUE_URL)}>
                  Submit the first one →
                </button>
              </div>
            )}
            {filtered.map((entry) => (
              <button
                key={entry.id}
                className={`plugin-card ${selected?.id === entry.id ? 'active' : ''}`}
                onClick={() => setSelectedId(entry.id)}
              >
                <span className="plugin-card-top">
                  <b>{entry.name}</b>
                  {entry.featured && <span className="plugin-featured">first party</span>}
                </span>
                <span className="plugin-card-author">{entry.author}</span>
                <span className="plugin-card-meta">
                  {entry.formats.map((f) => f.toUpperCase()).join(' · ')}
                  {entry.release ? ` · v${entry.release.version}` : ' · no release'}
                </span>
                <span className="plugin-card-desc">{entry.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="plugin-detail">
          {!selected && <div className="plugin-empty">Select a plugin to see its releases.</div>}
          {selected && (
            <>
              <div className="plugin-hero">
                <div>
                  <h3>{selected.name}</h3>
                  <p>
                    by <b>{selected.author}</b> · {selected.license}
                  </p>
                </div>
                <div className="plugin-badges">
                  {selected.formats.map((f) => (
                    <span className="plugin-badge" key={f}>
                      {f.toUpperCase()}
                    </span>
                  ))}
                  {selected.verified && <span className="plugin-badge verified">reviewed</span>}
                </div>
              </div>
              <p className="plugin-description">{selected.description}</p>
              <div className="plugin-facts">
                <span>
                  <b>Platforms</b> {pluginPlatformLabel(selected.platforms)}
                </span>
                <span>
                  <b>Release</b>{' '}
                  {selected.release ? `${selected.release.tag} · ${selected.release.publishedAt.slice(0, 10)}` : 'not published'}
                </span>
              </div>

              {catalog?.warning && (
                <div className="plugin-warning">
                  Live registry unavailable ({catalog.warning}); using the copy bundled with OpenBeats.
                </div>
              )}
              {selected.error && (
                <div className="plugin-warning">
                  {selected.error}. You can still inspect the{' '}
                  <button className="link-btn" onClick={() => void openExternal(selected.homepage)}>
                    source project
                  </button>
                  .
                </div>
              )}

              {selected.release && (
                <div className="plugin-release">
                  <div className="plugin-release-head">
                    <b>{selected.release.name || selected.release.tag}</b>
                    <button className="link-btn" onClick={() => void openExternal(selected.release!.url)}>
                      Release notes ↗
                    </button>
                  </div>
                  {selected.release.assets.length === 0 && (
                    <div className="plugin-empty">That release has no downloadable plugin bundle yet.</div>
                  )}
                  {selected.release.assets.map((asset) => (
                    <div className="plugin-asset" key={asset.name}>
                      <span className="plugin-asset-name">{asset.name}</span>
                      <span className="plugin-asset-size">{formatBytes(asset.size)}</span>
                      <button
                        className="btn ghost small"
                        onClick={() => void openExternal(asset.downloadUrl)}
                      >
                        <IconDownload size={11} /> Download
                      </button>
                    </div>
                  ))}
                  {recommended && (
                    <p className="tiny-note">
                      Downloads open in your browser. Install the `.clap` file in `~/.clap` or the
                      `.vst3` bundle in `~/.vst3`, then rescan in your plugin host.
                    </p>
                  )}
                </div>
              )}

              {selected.notes && <p className="hinttext">{selected.notes}</p>}

              <div className="plugin-actions">
                <button className="btn ghost" onClick={() => void openExternal(selected.homepage)}>
                  Source / build instructions ↗
                </button>
                <button className="btn ghost" onClick={() => void openExternal(ISSUE_URL)}>
                  Submit your plugin ↗
                </button>
              </div>
              <div className="plugin-security">
                <b>Native binaries:</b> plugins run with your user permissions. Only download from
                publishers you trust; “reviewed” means provenance was checked, not audited.
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
