import { useRef, useState } from 'react';
import { previewChannel, useApp } from '../store';
import { PRESETS, createChannel } from '../model/defaults';
import { SAMPLE_BANK } from '../audio/instruments';
import { IconDownload, IconFolder, IconPlus, IconSearch, IconWave } from '../ui/icons';
import type { PresetId } from '../model/types';

type Tab = 'packs' | 'projects' | 'samples';

export function BrowserPanel() {
  const ui = useApp((s) => s.ui);
  const project = useApp((s) => s.project);
  const [tab, setTab] = useState<Tab>('packs');
  const [query, setQuery] = useState('');
  const sampleInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const { addChannel, saveProjectFile, openProjectFile, newProject, exportWav, updateChannel, importSampleFiles, setUI, hint } = useApp.getState();

  if (!ui.browserOpen) return null;

  const filtered = PRESETS.filter(
    (p) => !query || p.name.toLowerCase().includes(query.toLowerCase()) || p.category.toLowerCase().includes(query.toLowerCase()),
  );
  const groups = Array.from(new Set(filtered.map((p) => p.category)));

  const loadSample = async (file: File) => {
    await importSampleFiles([file], true);
  };

  return (
    <aside className="browser" data-tour="browser" style={{ width: ui.browserWidth }}>
      <div className="browser-head">
        <IconFolder size={12} /> Browser
        <div className="spacer" />
        <span className="tiny-note">{project.name}</span>
      </div>
      <div className="browser-search">
        <span style={{ display: 'grid', placeItems: 'center', color: 'var(--dim)' }}>
          <IconSearch size={13} />
        </span>
        <input placeholder="Search packs and samples…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="browser-tabs">
        {(['packs', 'projects', 'samples'] as Tab[]).map((t) => (
          <button key={t} className={`browser-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'packs' ? 'Packs' : t === 'projects' ? 'Projects' : 'Samples'}
          </button>
        ))}
      </div>

      <div className="browser-list">
        {tab === 'packs' &&
          groups.map((group) => (
            <div key={group}>
              <div className="browser-group">{group}</div>
              {filtered
                .filter((p) => p.category === group)
                .map((preset) => (
                  <div
                    key={preset.id}
                    className="browser-item"
                    title={`${preset.blurb} — click to audition, double-click to add a channel`}
                    onClick={() => {
                      previewChannel(
                        createChannel({
                          preset: preset.id as PresetId,
                          name: preset.name,
                          root: preset.root,
                          tone: preset.tone,
                          decay: preset.decay,
                          attack: preset.attack,
                          release: preset.release,
                          gain: preset.gain,
                          color: '#888',
                          mixer: 0,
                        }),
                      );
                      hint(`${preset.name}: ${preset.blurb}`);
                    }}
                    onDoubleClick={() => addChannel(preset.id as PresetId)}
                  >
                    <span className="dot" style={{ background: 'var(--accent)', opacity: 0.75 }} />
                    <span>{preset.name}</span>
                    <button
                      className="tbtn small flat"
                      style={{ marginLeft: 'auto' }}
                      title="Add channel"
                      onClick={(e) => {
                        e.stopPropagation();
                        addChannel(preset.id as PresetId);
                      }}
                    >
                      <IconPlus size={10} />
                    </button>
                  </div>
                ))}
            </div>
          ))}

        {tab === 'projects' && (
          <>
            <div className="browser-group">Current</div>
            <div className="browser-item" onDoubleClick={() => setUI({ tab: 'playlist' })}>
              <span className="dot" style={{ background: 'var(--accent)' }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</span>
              <span className="bi-meta">{Math.round(project.bpm)} BPM</span>
            </div>
            <div className="browser-group">Actions</div>
            <div className="browser-item" onClick={saveProjectFile}>
              <IconDownload size={12} />
              <span>Save this project</span>
              <span className="bi-meta">.obeats</span>
            </div>
            <div className="browser-item" onClick={() => projectInput.current?.click()}>
              <IconFolder size={12} />
              <span>Open a project…</span>
            </div>
            <div className="browser-item" onClick={() => void exportWav()}>
              <IconWave size={12} />
              <span>Bounce song to WAV</span>
            </div>
            <div className="browser-group">Start fresh</div>
            <div className="browser-item" onClick={() => newProject('blank')}>
              <IconPlus size={12} />
              <span>Empty project</span>
            </div>
            <div className="browser-item" onClick={() => newProject('demo')}>
              <IconWave size={12} />
              <span>Load “Neon Drift” demo</span>
            </div>
            <div className="browser-empty">
              Projects autosave to this browser while you work.
              <br />
              Save a file to move a song between machines.
            </div>
          </>
        )}

        {tab === 'samples' && (
          <>
            <div className="browser-group">Your samples</div>
            {Array.from(SAMPLE_BANK.keys()).length === 0 && <div className="browser-empty">No samples loaded yet.<br />Drop in a one-shot below.</div>}
            {Array.from(SAMPLE_BANK.entries()).map(([id, buffer]) => {
              const channel = project.channels.find((c) => c.sample?.id === id);
              return (
                <div
                  key={id}
                  className="browser-item"
                  onClick={() => channel && previewChannel(channel)}
                  title={`${buffer.duration.toFixed(2)}s · ${buffer.sampleRate} Hz`}
                >
                  <span className="dot" style={{ background: 'var(--accent)' }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {channel?.sample?.name ?? 'sample'}
                  </span>
                  <span className="bi-meta" title={channel?.sample?.tags?.join(', ')}>
                    {channel?.sample?.bpm ? `${channel.sample.bpm} BPM` : `${buffer.duration.toFixed(1)}s`}
                  </span>
                </div>
              );
            })}
            <div className="browser-group">Built-in drums</div>
            {PRESETS.filter((p) => p.category === 'Drums').map((p) => (
              <div key={p.id} className="browser-item" onClick={() => {
                const ch = project.channels.find((c) => c.id === project.selectedChannel) ?? project.channels[0];
                if (ch) previewChannel({ ...ch, preset: p.id as PresetId, root: p.root });
              }}>
                <span className="dot" style={{ background: 'var(--dim)' }} />
                <span>{p.name}</span>
              </div>
            ))}
            <div className="browser-empty" style={{ fontSize: 10 }}>
              Loaded samples live for this session only — bounce a WAV to keep the result.
            </div>
          </>
        )}
      </div>

      <div className="browser-foot">
        <button className="btn ghost" style={{ flex: 1 }} onClick={() => sampleInput.current?.click()}>
          Import sample
        </button>
        <button className="btn ghost" onClick={() => projectInput.current?.click()} title="Open project">
          <IconFolder size={12} />
        </button>
        <input
          ref={sampleInput}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void loadSample(file);
            e.target.value = '';
          }}
        />
        <input
          ref={projectInput}
          type="file"
          accept=".obeats,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void openProjectFile(file);
            e.target.value = '';
          }}
        />
      </div>
    </aside>
  );
}
