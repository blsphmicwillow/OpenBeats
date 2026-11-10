import { useEffect, useMemo, useRef, useState } from 'react';
import { applyParsedCommand } from '../lib/commandActions';
import { nativeParseCommand, type ParsedCommand } from '../lib/nativeAudio';
import { useApp } from '../store';
import { PRESETS } from '../model/defaults';

interface Command {
  id: string;
  label: string;
  hint?: string;
  section: string;
  run: () => void;
}

/** Ctrl/Cmd+K spotlight for every action in the studio. */
export function CommandPalette() {
  const open = useApp((s) => s.ui.paletteOpen);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [parsed, setParsed] = useState<ParsedCommand | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const s = useApp.getState();
    return [
      { id: 'tab-playlist', section: 'View', label: 'Go to Playlist', hint: 'F5', run: () => s.setUI({ tab: 'playlist' }) },
      { id: 'tab-piano', section: 'View', label: 'Go to Piano roll', hint: 'F7', run: () => s.setUI({ tab: 'pianoroll' }) },
      { id: 'tab-mixer', section: 'View', label: 'Go to Mixer', hint: 'F9', run: () => s.setUI({ tab: 'mixer' }) },
      { id: 'tab-changelog', section: 'View', label: 'What’s new (Changelog)', run: () => s.setUI({ tab: 'changelog' }) },
      { id: 'mode', section: 'View', label: s.settings.uiMode === 'classic' ? 'Switch to Modern interface' : 'Switch to Classic interface', run: () => s.patchSettings({ uiMode: s.settings.uiMode === 'classic' ? 'modern' : 'classic' }) },
      { id: 'settings', section: 'View', label: 'Open Settings', hint: 'F11', run: () => s.setUI({ settingsOpen: true }) },
      { id: 'browser', section: 'View', label: 'Toggle Browser', hint: 'F10', run: () => s.setUI({ browserOpen: !s.ui.browserOpen }) },
      { id: 'plugins', section: 'View', label: 'Open plugin library', run: () => s.setUI({ pluginsOpen: true }) },
      { id: 'play', section: 'Transport', label: s.transport.playing ? 'Stop' : 'Play', hint: 'Space', run: () => s.togglePlay() },
      { id: 'songmode', section: 'Transport', label: 'Toggle pattern / song mode', hint: 'L', run: () => s.toggleSongMode() },
      { id: 'metronome', section: 'Transport', label: 'Toggle metronome', hint: 'C', run: () => s.toggleMetronome() },
      { id: 'bounce', section: 'Audio', label: 'Export audio (WAV, FLAC, MP3, OGG, M4A)', run: () => s.setUI({ exportOpen: true }) },
      { id: 'exchange', section: 'Project', label: 'Import / export song (MIDI, Ableton, REAPER)', run: () => s.setUI({ exchangeOpen: true }) },
      { id: 'export-midi', section: 'Project', label: 'Export multi-track MIDI', run: () => void s.exportMidi() },
      { id: 'export-rpp', section: 'Project', label: 'Export REAPER project', run: () => void s.exportRpp() },
      { id: 'fixmix', section: 'Audio', label: 'Fix My Mix — analyse the master', run: () => s.setUI({ fixMixOpen: true }) },
      { id: 'hum', section: 'Audio', label: 'Hum to Melody — record a melody', run: () => s.setUI({ humOpen: true }) },
      { id: 'inspire', section: 'Audio', label: 'Inspire Me — generate a chord progression', run: () => s.setUI({ inspireOpen: true }) },
      { id: 'updates', section: 'Audio', label: 'Check for updates', run: () => void s.checkUpdates() },
      { id: 'save', section: 'Project', label: 'Save project file', hint: 'Ctrl+S', run: () => void s.saveProjectFile() },
      { id: 'open', section: 'Project', label: 'Open project…', run: () => void s.openProjectNative() },
      { id: 'projects', section: 'Project', label: 'Projects — new or old project', run: () => s.setUI({ projectHubOpen: true }) },
      { id: 'new', section: 'Project', label: 'New empty project', run: () => s.newProject('blank') },
      { id: 'demo', section: 'Project', label: 'Load the “Neon Drift” demo', run: () => s.newProject('demo') },
      { id: 'undo', section: 'Edit', label: 'Undo', hint: 'Ctrl+Z', run: () => s.undo() },
      { id: 'redo', section: 'Edit', label: 'Redo', hint: 'Ctrl+Shift+Z', run: () => s.redo() },
      { id: 'pattern', section: 'Edit', label: 'New pattern', run: () => s.addPattern() },
      ...PRESETS.map((p) => ({
        id: `add-${p.id}`,
        section: 'Add channel',
        label: `Add ${p.name}`,
        hint: p.category,
        run: () => s.addChannel(p.id),
      })),
    ];
  }, [open]);

  // The Rust parser understands phrases the command list does not contain.
  useEffect(() => {
    if (!open || !query.trim()) {
      setParsed(null);
      return;
    }
    let alive = true;
    void nativeParseCommand(query).then((result) => {
      if (alive) setParsed(result);
    });
    return () => {
      alive = false;
    };
  }, [open, query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const local: Command[] = parsed
      ? [
          {
            id: 'local-command',
            section: 'Local command',
            label: `Run “${parsed.raw}”`,
            hint: parsed.action,
            run: () => useApp.getState().toast(applyParsedCommand(parsed)),
          },
        ]
      : [];
    if (!q) return commands;
    const matches = commands.filter((c) => `${c.section} ${c.label}`.toLowerCase().includes(q));
    return [...local, ...matches];
  }, [commands, query, parsed]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!open) return null;

  const close = () => useApp.getState().setUI({ paletteOpen: false });

  const run = (cmd?: Command) => {
    if (!cmd) return;
    close();
    cmd.run();
  };

  return (
    <div className="palette-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <div className="palette-input">
          <span className="palette-key">⌘K</span>
          <input
            ref={inputRef}
            value={query}
            placeholder="Search actions — bounce, mixer, fix my mix…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                close();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(filtered.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                run(filtered[active]);
              }
            }}
          />
        </div>
        <div className="palette-list">
          {filtered.length === 0 && <div className="palette-empty">No matching action</div>}
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              className={`palette-item ${i === active ? 'active' : ''}`}
              onPointerEnter={() => setActive(i)}
              onClick={() => run(cmd)}
            >
              <span className="pi-section">{cmd.section}</span>
              <span className="pi-label">{cmd.label}</span>
              {cmd.hint && <span className="pi-hint">{cmd.hint}</span>}
            </button>
          ))}
        </div>
        <div className="palette-foot">
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>esc close</span>
          <div className="spacer" />
          <span>Ctrl/Cmd + K</span>
        </div>
      </div>
    </div>
  );
}
