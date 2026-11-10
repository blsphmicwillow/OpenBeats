import { useRef, useState } from 'react';
import { useApp } from '../store';
import { Knob } from '../ui/Knob';
import { MasterMeter } from '../ui/Meter';
import type { MenuItem } from '../model/types';
import {
  IconCopy,
  IconDownload,
  IconFolder,
  IconGear,
  IconHelp,
  IconLogo,
  IconLoop,
  IconMetro,
  IconPlay,
  IconPlus,
  IconRecord,
  IconRedo,
  IconSave,
  IconStop,
  IconUndo,
} from '../ui/icons';

export function TopBar() {
  const project = useApp((s) => s.project);
  const transport = useApp((s) => s.transport);
  const ui = useApp((s) => s.ui);
  const history = useApp((s) => s.history);
  const {
    patchProject,
    togglePlay,
    rewind,
    toggleRecord,
    toggleSongMode,
    setBpm,
    setSwing,
    openMenu,
    hint,
    setUI,
    undo,
    redo,
    saveProjectFile,
    newProject,
    openProjectFile,
    selectPattern,
    addPattern,
    duplicatePattern,
    removePattern,
    setPatternBars,
    addChannel,
    removeChannel,
    transposeChannel,
    clearChannelSteps,
    resetAll,
    toggleMetronome,
    checkUpdates,
  } = useApp.getState();

  const [openName, setOpenName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bpmDrag = useRef<{ y: number; bpm: number } | null>(null);

  const show = (e: React.MouseEvent<HTMLButtonElement>, name: string, items: MenuItem[]) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setOpenName(name);
    openMenu(rect.left, rect.bottom + 3, items);
  };

  const activePattern = project.patterns.find((p) => p.id === project.currentPattern);
  const selectedChannel = project.channels.find((c) => c.id === project.selectedChannel);

  const fileMenu: MenuItem[] = [
    { label: 'Projects…', shortcut: 'Ctrl+Shift+O', onClick: () => setUI({ projectHubOpen: true }) },
    { label: 'New project', shortcut: '', onClick: () => newProject('blank') },
    { label: 'Load demo song', onClick: () => newProject('demo') },
    { separator: true },
    { label: 'Open project…', shortcut: 'Ctrl+O', onClick: () => fileRef.current?.click() },
    { label: 'Save project as…', shortcut: 'Ctrl+S', onClick: saveProjectFile },
    { label: 'Import / export song…', onClick: () => setUI({ exchangeOpen: true }) },
    { label: 'Export audio…', onClick: () => setUI({ exportOpen: true }) },
    { separator: true },
    { label: 'Reset all settings & project', danger: true, onClick: resetAll },
  ];

  const editMenu: MenuItem[] = [
    { label: 'Undo', shortcut: 'Ctrl+Z', disabled: !history.past.length, onClick: undo },
    { label: 'Redo', shortcut: 'Ctrl+Shift+Z', disabled: !history.future.length, onClick: redo },
    { separator: true },
    { label: 'Duplicate pattern', shortcut: 'Ctrl+D', onClick: () => duplicatePattern() },
    { label: 'New pattern', onClick: addPattern },
    ...(selectedChannel
      ? [
          { separator: true } as MenuItem,
          { label: `Transpose ${selectedChannel.name} +1`, onClick: () => transposeChannel(selectedChannel.id, 1) },
          { label: `Transpose ${selectedChannel.name} −1`, onClick: () => transposeChannel(selectedChannel.id, -1) },
          { label: `Clear ${selectedChannel.name} notes`, onClick: () => clearChannelSteps(selectedChannel.id) },
        ]
      : []),
  ];

  const viewMenu: MenuItem[] = [
    { label: 'Playlist', shortcut: 'F5', checked: ui.tab === 'playlist', onClick: () => setUI({ tab: 'playlist' }) },
    { label: 'Piano roll', shortcut: 'F7', checked: ui.tab === 'pianoroll', onClick: () => setUI({ tab: 'pianoroll' }) },
    { label: 'Mixer', shortcut: 'F9', checked: ui.tab === 'mixer', onClick: () => setUI({ tab: 'mixer' }) },
    { separator: true },
    { label: 'Browser panel', checked: ui.browserOpen, onClick: () => setUI({ browserOpen: !ui.browserOpen }) },
    { label: 'Plugin library…', checked: ui.pluginsOpen, onClick: () => setUI({ pluginsOpen: true }) },
    { label: 'Settings…', shortcut: 'F11', onClick: () => setUI({ settingsOpen: true }) },
  ];

  const helpMenu: MenuItem[] = [
    { label: 'Tutorial', onClick: () => setUI({ tutorialStep: 0 }) },
    { label: 'Manual & shortcuts', shortcut: 'F1', onClick: () => setUI({ aboutOpen: true }) },
    {
      label: ui.updateChecking ? 'Checking for updates…' : 'Check for updates…',
      disabled: ui.updateChecking,
      onClick: () => void checkUpdates(),
    },
    { separator: true },
    { label: 'OpenBeats is free software (GPL-3.0)', disabled: true },
  ];

  const patternMenu: MenuItem[] = [
    ...project.patterns.map((p, i) => ({
      label: `${i + 1}. ${p.name}`,
      checked: p.id === project.currentPattern,
      onClick: () => selectPattern(p.id),
    })),
    { separator: true },
    { label: 'New pattern', onClick: addPattern },
    { label: 'Clone pattern', onClick: () => duplicatePattern() },
    {
      label: 'Pattern length',
      disabled: true,
    },
    ...[1, 2, 4, 8].map((bars) => ({
      label: `${bars} bar${bars > 1 ? 's' : ''}`,
      checked: (activePattern?.bars ?? 1) === bars,
      onClick: () => activePattern && setPatternBars(activePattern.id, bars),
    })),
    { separator: true },
    {
      label: 'Delete pattern',
      danger: true,
      disabled: project.patterns.length <= 1,
      onClick: () => activePattern && removePattern(activePattern.id),
    },
  ];

  const channelMenu: MenuItem[] = [
    { label: 'Kick', onClick: () => addChannel('kick') },
    { label: 'Snare', onClick: () => addChannel('snare') },
    { label: 'Hi-hat', onClick: () => addChannel('hat') },
    { label: 'Clap', onClick: () => addChannel('clap') },
    { separator: true },
    { label: 'Bass', onClick: () => addChannel('bass') },
    { label: 'Lead', onClick: () => addChannel('lead') },
    { label: 'FM Keys', onClick: () => addChannel('keys') },
    { label: 'Chord stack', onClick: () => addChannel('chords') },
    { separator: true },
    { label: 'Pluck', onClick: () => addChannel('pluck') },
    { label: 'Pad', onClick: () => addChannel('pad') },
    { label: 'Riser FX', onClick: () => addChannel('fx') },
  ];

  const stepBpm = (delta: number) => setBpm(project.bpm + delta);

  const compactMenu: MenuItem[] = [
    { label: 'Projects…', onClick: () => setUI({ projectHubOpen: true }) },
    { label: 'New project', onClick: () => newProject('blank') },
    { label: 'Load demo song', onClick: () => newProject('demo') },
    { label: 'Open project…', onClick: () => fileRef.current?.click() },
    { label: 'Save project as…', onClick: saveProjectFile },
    { label: 'Import / export song…', onClick: () => setUI({ exchangeOpen: true }) },
    { label: 'Export audio…', onClick: () => setUI({ exportOpen: true }) },
    { separator: true },
    { label: 'Undo', disabled: !history.past.length, onClick: undo },
    { label: 'Redo', disabled: !history.future.length, onClick: redo },
    { separator: true },
    { label: 'Playlist', checked: ui.tab === 'playlist', onClick: () => setUI({ tab: 'playlist' }) },
    { label: 'Piano roll', checked: ui.tab === 'pianoroll', onClick: () => setUI({ tab: 'pianoroll' }) },
    { label: 'Mixer', checked: ui.tab === 'mixer', onClick: () => setUI({ tab: 'mixer' }) },
    { label: 'Browser', checked: ui.browserOpen, onClick: () => setUI({ browserOpen: !ui.browserOpen }) },
    { label: 'Plugin library…', onClick: () => setUI({ pluginsOpen: true }) },
    { separator: true },
    { label: 'Tutorial', onClick: () => setUI({ tutorialStep: 0 }) },
    { label: 'Manual & shortcuts', onClick: () => setUI({ aboutOpen: true }) },
    { label: 'Check for updates…', disabled: ui.updateChecking, onClick: () => void checkUpdates() },
    { label: 'Settings…', onClick: () => setUI({ settingsOpen: true }) },
  ];

  return (
    <div className="topbar" data-tour="transport">
      <div className="logo">
        <span className="logo-mark">
          <IconLogo size={17} />
        </span>
        <span className="logo-text">
          <b>OpenBeats</b>
          <span>open-source studio</span>
        </span>
      </div>

      <button className="menu-btn compact-menu" onClick={(e) => show(e, 'all', compactMenu)} title="Menu">
        ☰
      </button>

      <div className="menubar">
        <button className={`menu-btn ${openName === 'file' ? 'open' : ''}`} onClick={(e) => show(e, 'file', fileMenu)}>
          File
        </button>
        <button className={`menu-btn ${openName === 'edit' ? 'open' : ''}`} onClick={(e) => show(e, 'edit', editMenu)}>
          Edit
        </button>
        <button className={`menu-btn ${openName === 'view' ? 'open' : ''}`} onClick={(e) => show(e, 'view', viewMenu)}>
          View
        </button>
        <button className={`menu-btn ${openName === 'help' ? 'open' : ''}`} onClick={(e) => show(e, 'help', helpMenu)}>
          Help
        </button>
      </div>

      <div className="tb-group">
        <button
          className={`tbtn ${transport.songMode ? 'active' : ''}`}
          onClick={toggleSongMode}
          onMouseEnter={() => hint('Pattern / Song mode (L) — Song plays the playlist arrangement.')}
          title="Pattern / Song mode (L)"
        >
          {transport.songMode ? 'SONG' : 'PAT'}
        </button>
        <button
          className={`tbtn play ${transport.playing ? 'active' : ''}`}
          onClick={togglePlay}
          onMouseEnter={() => hint('Play / pause (Space).')}
          title="Play / pause (Space)"
          aria-label={transport.playing ? 'Pause' : 'Play'}
          aria-pressed={transport.playing}
        >
          <IconPlay />
        </button>
        <button className="tbtn" onClick={rewind} title="Stop and return to the start" aria-label="Stop" onMouseEnter={() => hint('Stop and return to bar 1.')}>
          <IconStop />
        </button>
        <button
          className={`tbtn rec ${transport.record ? 'active' : ''}`}
          onClick={toggleRecord}
          title="Record arm (R)"
          aria-label="Record arm"
          aria-pressed={transport.record}
          onMouseEnter={() => hint('Arm recording: play the QWERTY keys while rolling to write notes into the current pattern.')}
        >
          <IconRecord />
        </button>
      </div>

      <div className="tb-group">
        <div
          className="display"
          title="Tempo — drag or scroll to change"
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            bpmDrag.current = { y: e.clientY, bpm: project.bpm };
          }}
          onPointerMove={(e) => {
            if (!bpmDrag.current) return;
            const delta = Math.round((bpmDrag.current.y - e.clientY) / 4);
            setBpm(bpmDrag.current.bpm + delta);
            hint(`Tempo ${Math.round(project.bpm + delta)} BPM`);
          }}
          onPointerUp={() => {
            bpmDrag.current = null;
          }}
          onWheel={(e) => stepBpm(e.deltaY < 0 ? 1 : -1)}
          onDoubleClick={() => setBpm(120)}
          role="slider"
          tabIndex={0}
          aria-label="Tempo in beats per minute"
          aria-valuemin={40}
          aria-valuemax={300}
          aria-valuenow={Math.round(project.bpm)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowRight') stepBpm(1);
            else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') stepBpm(-1);
            else if (e.key === 'PageUp') stepBpm(10);
            else if (e.key === 'PageDown') stepBpm(-10);
            else if (e.key === 'Home') setBpm(40);
            else if (e.key === 'End') setBpm(300);
            else return;
            e.preventDefault();
          }}
        >
          <span className="display-label">tempo</span>
          <span className="display-value">
            {Math.round(project.bpm)}
            <small>BPM</small>
          </span>
        </div>
        <div className="display sig-display" style={{ minWidth: 54, cursor: 'default' }} title="Time signature">
          <span className="display-label">sig</span>
          <span className="display-value">
            {project.beatsPerBar}
            <small>/4</small>
          </span>
        </div>
        <span className="swing-wrap">
          <Knob
            value={project.swing}
            min={0}
            max={0.9}
            onChange={setSwing}
            label="Swing"
            size={30}
            format={(v) => `${Math.round(v * 100)}%`}
            defaultValue={0}
            hintText="Swing — delays every second 16th for groove. Double-click to reset."
          />
        </span>
        <span className="loop-group">
          <button
            className={`tbtn ${project.loop ? 'active' : ''}`}
            onClick={() => patchProject((p) => (p.loop = !p.loop))}
            title="Loop"
            aria-label="Loop"
            aria-pressed={project.loop}
            onMouseEnter={() => hint('Loop the pattern / song arrangement.')}
          >
            <IconLoop />
          </button>
          <button
            className={`tbtn ${project.metronome ? 'active' : ''}`}
            onClick={toggleMetronome}
            title="Metronome (C)"
            aria-label="Metronome"
            aria-pressed={project.metronome}
            onMouseEnter={() => hint('Metronome click on every beat.')}
          >
            <IconMetro />
          </button>
        </span>
      </div>

      <div className="tb-group">
        <button className="tbtn small pattern-nav" onClick={() => {
          const idx = project.patterns.findIndex((p) => p.id === project.currentPattern);
          selectPattern(project.patterns[(idx - 1 + project.patterns.length) % project.patterns.length].id);
        }} title="Previous pattern (PageUp)" aria-label="Previous pattern">
          ‹
        </button>
        <select
          className="select"
          value={project.currentPattern}
          onChange={(e) => selectPattern(e.target.value)}
          onMouseEnter={() => hint('Pattern selector — the channel rack and piano roll edit this pattern.')}
          title="Current pattern"
        >
          {project.patterns.map((p, i) => (
            <option key={p.id} value={p.id}>
              {i + 1}. {p.name}
            </option>
          ))}
        </select>
        <button className="tbtn small" onClick={(e) => show(e, 'pattern', patternMenu)} title="Pattern menu">
          ▾
        </button>
        <button className="tbtn small pattern-nav" onClick={() => {
          const idx = project.patterns.findIndex((p) => p.id === project.currentPattern);
          selectPattern(project.patterns[(idx + 1) % project.patterns.length].id);
        }} title="Next pattern (PageDown)" aria-label="Next pattern">
          ›
        </button>
        <button className="tbtn small pattern-extra" onClick={addPattern} title="New pattern" aria-label="New pattern">
          <IconPlus size={11} />
        </button>
        <button className="tbtn small pattern-extra" onClick={() => duplicatePattern()} title="Clone pattern (Ctrl+D)" aria-label="Clone pattern">
          <IconCopy size={11} />
        </button>
      </div>

      <button className="tbtn add-channel-btn" onClick={(e) => show(e, 'add', channelMenu)} title="Add a channel" onMouseEnter={() => hint('Add a new instrument channel to the rack.')}>
        + Channel
      </button>

      <div className="tb-group master-group">
        <MasterMeter />
        <Knob
          value={project.masterGain}
          min={0}
          max={1.4}
          onChange={(v) => patchProject((p) => (p.masterGain = v), { coalesce: 'master' })}
          label="Master"
          size={28}
          format={(v) => `${Math.round(v * 100)}%`}
          defaultValue={0.85}
          hintText="Master volume. Keep the limiter on the master strip to catch peaks."
        />
      </div>

      <div className="spacer" />

      <div className="tb-group history-group" style={{ borderLeft: 0 }}>
        <button className="tbtn flat" onClick={undo} disabled={!history.past.length} title="Undo (Ctrl+Z)" aria-label="Undo">
          <IconUndo size={13} />
        </button>
        <button className="tbtn flat" onClick={redo} disabled={!history.future.length} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
          <IconRedo size={13} />
        </button>
      </div>

      <div className="tb-group actions-group">
        <button className="tbtn" onClick={saveProjectFile} title="Save project as… (Ctrl+S)" aria-label="Save project as" onMouseEnter={() => hint('Save the whole project as a portable .obeats file, anywhere on disk.')}>
          <IconSave size={13} />
        </button>
        <button
          className="tbtn"
          onClick={() => setUI({ exportOpen: true })}
          disabled={!!ui.exporting}
          data-tour="bounce"
          title="Export the song to audio"
          aria-label="Export the song to audio"
          onMouseEnter={() => hint('Render the arrangement offline to WAV, FLAC, MP3, OGG or M4A.')}
        >
          <IconDownload size={13} />
          {ui.exporting ? 'Rendering…' : 'Bounce'}
        </button>
        <button
          className={`tbtn ${ui.browserOpen ? 'active' : ''}`}
          onClick={() => setUI({ browserOpen: !ui.browserOpen })}
          title="Browser (F10)"
          aria-label="Toggle sample browser"
          aria-pressed={ui.browserOpen}
        >
          <IconFolder size={13} />
        </button>
        <button className="tbtn" onClick={() => setUI({ pluginsOpen: true })} data-tour="plugins" title="Browse VST3/CLAP plugins" aria-label="Open plugin library">
          Plugins
        </button>
        <button className="tbtn" onClick={() => setUI({ settingsOpen: true })} title="Settings (F11)" aria-label="Open settings" data-tour="settings">
          <IconGear size={13} />
        </button>
        <button className="tbtn" onClick={() => setUI({ aboutOpen: true })} data-tour="help" title="Manual, shortcuts and credits (F1)" aria-label="Open manual and shortcuts">
          <IconHelp size={13} />
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".obeats,.json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void openProjectFile(file);
          e.target.value = '';
        }}
      />
      <span className="chip gpl-chip" title="This project is open source — press F1 for the manual">
        GPL-3.0
      </span>
    </div>
  );
}
