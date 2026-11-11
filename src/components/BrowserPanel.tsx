import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { previewChannel, useApp } from '../store';
import { PRESETS, createChannel } from '../model/defaults';
import { SAMPLE_BANK } from '../audio/instruments';
import {
  nativeGetPacks,
  nativeImportPack,
  nativePreviewPcm,
  nativePreviewSample,
  nativeReadSample,
  nativeRemovePack,
  nativeStopPreview,
  type NativePack,
  type NativePackFormat,
  type NativePackImport,
} from '../lib/nativeAudio';
import { importPackSafely } from '../lib/packImport';
import { isNative } from '../lib/native';
import { PackImportReport } from './PackImportReport';
import { IconDownload, IconFolder, IconPlus, IconSearch, IconWave } from '../ui/icons';
import type { PresetId } from '../model/types';
import { AUDIO_CLIP_MIME } from '../model/audioClip';

type Tab = 'packs' | 'projects' | 'samples';

const PACK_FORMAT: Record<NativePackFormat, string> = {
  open_beats: 'OpenBeats',
  fl_studio: 'FL layout',
  generic: 'One-shots',
  flat: 'Flat',
};

export function BrowserPanel() {
  const ui = useApp((s) => s.ui);
  const project = useApp((s) => s.project);
  const outputId = useApp((s) => s.settings.audio.outputId);
  const [tab, setTab] = useState<Tab>('packs');
  const [query, setQuery] = useState('');
  const [packs, setPacks] = useState<NativePack[]>([]);
  const [openPacks, setOpenPacks] = useState<string[]>([]);
  const [report, setReport] = useState<NativePackImport | null>(null);
  const sampleInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const importRef = useRef<(kind: 'folder' | 'zip', path?: string) => Promise<void>>(async () => {});
  const { addChannel, saveProjectFile, openProjectFile, newProject, importSampleFiles, setUI, hint, toast } = useApp.getState();

  useEffect(() => {
    if (!ui.browserOpen) return;
    void nativeGetPacks().then((loaded) => setPacks(loaded));
  }, [ui.browserOpen]);

  importRef.current = async (kind, path) => {
    const result = await importPackSafely(
      () => nativeImportPack(path, kind),
      (message) => toast(message),
    );
    if (!result) {
      // Cancelling the native dialog is silent; the web build explains itself.
      if (!isNative()) toast('Pack import is only available in the desktop app');
      return;
    }
    setPacks((previous) => [
      ...previous.filter((pack) => pack.root !== result.pack.root),
      result.pack,
    ]);
    setOpenPacks((previous) => Array.from(new Set([...previous, result.pack.root])));
    setReport(result);
    hint(`Imported ${result.pack.name} — ${result.pack.samples.length} samples`);
  };

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: 'folder' | 'zip'; path?: string }>).detail;
      void importRef.current(detail?.kind ?? 'folder', detail?.path);
    };
    const showPacks = () => setTab('packs');
    window.addEventListener('openbeats:import-pack', handler);
    window.addEventListener('openbeats:show-packs', showPacks);
    return () => {
      window.removeEventListener('openbeats:import-pack', handler);
      window.removeEventListener('openbeats:show-packs', showPacks);
    };
  }, []);

  if (!ui.browserOpen) return null;

  const filtered = PRESETS.filter(
    (p) => !query || p.name.toLowerCase().includes(query.toLowerCase()) || p.category.toLowerCase().includes(query.toLowerCase()),
  );
  const groups = Array.from(new Set(filtered.map((p) => p.category)));

  const loadSample = async (file: File) => {
    await importSampleFiles([file], true);
  };

  const removePack = async (event: MouseEvent, pack: NativePack) => {
    event.stopPropagation();
    if (!window.confirm(`Remove “${pack.name}” from the library?`)) return;
    try {
      const result = await nativeRemovePack(pack.root);
      setPacks((previous) => previous.filter((item) => item.root !== pack.root));
      setOpenPacks((previous) => previous.filter((root) => root !== pack.root));
      setReport((current) => (current?.pack.root === pack.root ? null : current));
      toast(
        result.left_source
          ? `Removed ${pack.name} from the library — its source folder was left untouched`
          : `Removed ${pack.name} and ${result.deleted_files} imported files`,
      );
    } catch (error) {
      console.error('Pack removal failed', error);
      toast(error instanceof Error ? error.message : 'That pack could not be removed');
    }
  };

  const allPackSamples = packs.flatMap((pack) =>
    pack.samples.map((sample) => ({ ...sample, packName: pack.name })),
  );
  const visiblePackSamples = allPackSamples
    .filter(
      (sample) =>
        !query ||
        sample.name.toLowerCase().includes(query.toLowerCase()) ||
        sample.category.toLowerCase().includes(query.toLowerCase()) ||
        sample.packName.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 200);

  const audition = async (path: string) => {
    try {
      const result = await nativePreviewSample(path, outputId);
      if (result) hint(`Preview: ${result}`);
      else toast('Sample previews need the desktop build');
    } catch (error) {
      console.error('Sample preview failed', error);
      toast(error instanceof Error ? error.message : 'That sample could not be previewed');
    }
  };

  const auditionSample = async (id: string, channel: (typeof project.channels)[number] | undefined) => {
    const buffer = SAMPLE_BANK.get(id);
    if (!buffer) return;
    if (isNative()) {
      try {
        const result = await nativePreviewPcm(buffer, outputId);
        if (result) hint(`Preview: ${result}`);
      } catch (error) {
        console.error('Sample preview failed', error);
        toast(error instanceof Error ? error.message : 'That sample could not be previewed');
      }
      return;
    }
    if (channel) previewChannel(channel);
  };

  const addPackSample = async (path: string) => {
    const payload = await nativeReadSample(path);
    if (!payload) {
      toast('Could not read that sample');
      return;
    }
    const bytes = Uint8Array.from(atob(payload.data), (c) => c.charCodeAt(0));
    const file = new File([bytes], payload.name);
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
        {tab === 'packs' && (
          <>
            <div className="browser-group">Imported packs</div>
            {packs.length === 0 && (
              <div className="browser-empty">
                No packs yet. Import a folder or a .zip to tag and browse its samples.
              </div>
            )}
            {packs.map((pack) => {
              const expanded = openPacks.includes(pack.root);
              const visible = pack.samples.filter(
                (sample) =>
                  !query ||
                  sample.name.toLowerCase().includes(query.toLowerCase()) ||
                  sample.tags.some((tag) => tag.toLowerCase().includes(query.toLowerCase())),
              );
              return (
                <div key={pack.root}>
                  <div
                    className="browser-item"
                    title={`${pack.root} — click to expand`}
                    onClick={() =>
                      setOpenPacks((previous) =>
                        previous.includes(pack.root)
                          ? previous.filter((root) => root !== pack.root)
                          : [...previous, pack.root],
                      )
                    }
                  >
                    <span className="dot" style={{ background: 'var(--accent)' }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pack.name}</span>
                    <span className="bi-meta">
                      {PACK_FORMAT[pack.format ?? 'flat']} · {pack.samples.length}
                    </span>
                    <button
                      className="tbtn small flat pack-remove"
                      title="Remove this pack from the library"
                      aria-label={`Remove ${pack.name}`}
                      onClick={(event) => void removePack(event, pack)}
                    >
                      ×
                    </button>
                  </div>
                  {expanded &&
                    visible.map((sample) => (
                      <div
                        key={sample.path}
                        className="browser-item"
                        style={{ paddingLeft: 22 }}
                        title={`${sample.tags.join(', ') || 'untagged'} — click to preview, double-click to load`}
                        onClick={() => void audition(sample.path)}
                        onDoubleClick={() => void addPackSample(sample.path)}
                      >
                        <IconWave size={10} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sample.name}</span>
                        <span className="bi-meta">{sample.tags[0] ?? ''}</span>
                      </div>
                    ))}
                </div>
              );
            })}

            <div className="browser-group">Instruments</div>
            {groups.map((group) => (
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
          </>
        )}

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
            <div className="browser-item" onClick={() => setUI({ exportOpen: true })}>
              <IconWave size={12} />
              <span>Export audio…</span>
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
            {allPackSamples.length > 0 && (
              <>
                <div className="browser-group">Pack samples ({allPackSamples.length})</div>
                {visiblePackSamples.map((sample) => (
                  <div
                    key={sample.path}
                    className="browser-item"
                    title={`${sample.packName} · ${sample.category} · click to preview, double-click to load`}
                    onClick={() => void audition(sample.path)}
                    onDoubleClick={() => void addPackSample(sample.path)}
                  >
                    <IconWave size={10} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sample.name}
                    </span>
                    <span className="bi-meta">{sample.category}</span>
                  </div>
                ))}
                {allPackSamples.length > visiblePackSamples.length && (
                  <div className="browser-empty" style={{ fontSize: 10 }}>
                    Showing {visiblePackSamples.length} of {allPackSamples.length}. Search to narrow
                    the list.
                  </div>
                )}
              </>
            )}
            <div className="browser-group">Your samples</div>
            {Array.from(SAMPLE_BANK.keys()).length === 0 && <div className="browser-empty">No samples loaded yet.<br />Drop in a one-shot below.</div>}
            {Array.from(SAMPLE_BANK.entries()).map(([id, buffer]) => {
              const channel = project.channels.find((c) => c.sample?.id === id);
              return (
                <div
                  key={id}
                  className="browser-item"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(AUDIO_CLIP_MIME, id);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => void auditionSample(id, channel)}
                  title={`${buffer.duration.toFixed(2)}s · ${buffer.sampleRate} Hz · drag to a playlist lane`}
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
        {tab === 'packs' ? (
          <>
            <button
              className="btn ghost"
              style={{ flex: 1 }}
              onClick={() => void importRef.current('folder')}
              data-tour="pack-import"
              title="Import a sample pack folder"
            >
              Import pack
            </button>
            <button
              className="btn ghost"
              onClick={() => void importRef.current('zip')}
              title="Import a .zip sample pack"
            >
              ZIP
            </button>
          </>
        ) : (
          <button className="btn ghost" style={{ flex: 1 }} onClick={() => sampleInput.current?.click()}>
            Import sample
          </button>
        )}
        <button
          className="btn ghost"
          onClick={() => {
            void nativeStopPreview();
            hint('Preview stopped');
          }}
          title="Stop the sample preview"
        >
          ■
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
      {report && (
        <PackImportReport
          pack={report.pack}
          report={report.report}
          onClose={() => setReport(null)}
        />
      )}
    </aside>
  );
}
