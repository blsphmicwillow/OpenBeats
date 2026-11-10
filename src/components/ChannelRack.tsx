import { useState } from 'react';
import { channelNotes, currentPattern, previewChannel, useApp } from '../store';
import { Knob } from '../ui/Knob';
import { Meter } from '../ui/Meter';
import { IconGear, IconPiano, IconPlus } from '../ui/icons';
import { PRESETS } from '../model/defaults';
import type { Channel, PresetId } from '../model/types';

export function ChannelRack() {
  const project = useApp((s) => s.project);
  const transport = useApp((s) => s.transport);
  const ui = useApp((s) => s.ui);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(true);

  const {
    toggleStep,
    updateChannel,
    removeChannel,
    duplicateChannel,
    selectChannel,
    setUI,
    openMenu,
    addChannel,
    clearChannelSteps,
    transposeChannel,
    selectPattern,
    setPatternBars,
    addPattern,
    duplicatePattern,
    removePattern,
    hint,
    pushHistory,
  } = useApp.getState();

  const pattern = currentPattern(project);
  const totalSteps = Math.max(16, (pattern?.bars ?? 1) * 16);
  const playStep = transport.playing ? transport.step % totalSteps : -1;
  const anySolo = project.channels.some((c) => c.solo);
  const selected = project.channels.find((c) => c.id === project.selectedChannel) ?? project.channels[0];

  const addMenu = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu(
      rect.left,
      rect.bottom + 3,
      PRESETS.filter((p) => p.id !== 'sample').map((preset) => ({
        label: `${preset.name}  ·  ${preset.category}`,
        onClick: () => addChannel(preset.id as PresetId),
      })),
    );
  };

  const rowMenu = (e: React.MouseEvent, channel: Channel) => {
    e.preventDefault();
    openMenu(e.clientX, e.clientY, [
      {
        label: 'Rename channel',
        onClick: () => {
          selectChannel(channel.id);
          setEditing(channel.id);
          setDraftName(channel.name);
        },
      },
      {
        label: 'Open in piano roll',
        shortcut: 'F7',
        onClick: () => {
          selectChannel(channel.id);
          setUI({ tab: 'pianoroll' });
        },
      },
      { label: 'Clone channel', onClick: () => duplicateChannel(channel.id) },
      { separator: true },
      { label: 'Clear notes in this pattern', onClick: () => clearChannelSteps(channel.id) },
      { label: 'Transpose +1 semitone', onClick: () => transposeChannel(channel.id, 1) },
      { label: 'Transpose −1 semitone', onClick: () => transposeChannel(channel.id, -1) },
      { separator: true },
      {
        label: channel.unloaded ? 'Load instrument' : 'Unload instrument (save CPU)',
        onClick: () => updateChannel(channel.id, { unloaded: !channel.unloaded }),
      },
      { label: 'Reset levels', onClick: () => updateChannel(channel.id, { gain: 0.8, pan: 0 }) },
      { separator: true },
      { label: 'Delete channel', danger: true, onClick: () => removeChannel(channel.id) },
    ]);
  };

  const audition = (channel: Channel) => {
    [0, 4, 7, 12].forEach((offset, i) => {
      window.setTimeout(() => previewChannel({ ...channel, root: channel.root + offset }), i * 140);
    });
    hint(`Auditioning “${channel.name}”.`);
  };

  return (
    <div className="rack" data-tour="rack" style={{ width: `min(${ui.rackWidth}px, 48vw)` }}>
      <div className="rack-head">
        <span className="rack-title">
          <IconGear size={12} /> Rack
        </span>
        <select
          className="mini-select"
          value={project.currentPattern}
          onChange={(e) => selectPattern(e.target.value)}
          title="Pattern being edited"
        >
          {project.patterns.map((p, i) => (
            <option key={p.id} value={p.id}>
              {i + 1}. {p.name}
            </option>
          ))}
        </select>
        <select
          className="mini-select"
          value={pattern?.bars ?? 2}
          onChange={(e) => pattern && setPatternBars(pattern.id, Number(e.target.value))}
          title="Pattern length in bars"
        >
          {[1, 2, 4, 8].map((b) => (
            <option key={b} value={b}>
              {b} bar{b > 1 ? 's' : ''}
            </option>
          ))}
        </select>
        <div className="spacer" />
        <button className="tbtn small" onClick={addPattern} title="New pattern">
          <IconPlus size={10} />
        </button>
        <button className="tbtn small rack-clone" onClick={() => duplicatePattern()} title="Clone pattern">
          Clone
        </button>
        <button
          className="tbtn small"
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            openMenu(rect.left, rect.bottom + 3, [
              ...project.patterns.map((p, i) => ({
                label: `${i + 1}. ${p.name}`,
                checked: p.id === project.currentPattern,
                onClick: () => selectPattern(p.id),
              })),
              { separator: true },
              { label: 'Delete current pattern', danger: true, onClick: () => pattern && removePattern(pattern.id) },
            ]);
          }}
          title="All patterns"
        >
          ▾
        </button>
        <button className="tbtn small" onClick={addMenu} title="Add channel">
          <IconPlus size={10} /> Ch
        </button>
      </div>

      <div className="rack-body">
        {project.channels.map((channel, index) => {
          const notes = pattern?.notes[channel.id] ?? [];
          const visible = !channel.mute && (!anySolo || channel.solo);
          return (
            <div
              key={channel.id}
              className={`chan-row ${project.selectedChannel === channel.id ? 'selected' : ''}`}
              onContextMenu={(e) => rowMenu(e, channel)}
              onPointerDown={() => selectChannel(channel.id)}
              style={{ ['--chan-color' as string]: channel.color }}
            >
              <div className="chan-main">
                <span className="chan-index">{index + 1}</span>
                <div className="chan-meta">
                  <span className="chan-dot" style={{ background: channel.color, color: channel.color }} />
                  {editing === channel.id ? (
                    <span className="chan-name">
                      <input
                        autoFocus
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onBlur={() => {
                          updateChannel(channel.id, { name: draftName.trim() || channel.name });
                          setEditing(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          if (e.key === 'Escape') setEditing(null);
                          e.stopPropagation();
                        }}
                      />
                    </span>
                  ) : (
                    <span
                      className="chan-name"
                      title={`${channel.name} — click to preview, double-click to rename`}
                      onClick={() => previewChannel(channel)}
                      onDoubleClick={() => {
                        setEditing(channel.id);
                        setDraftName(channel.name);
                      }}
                    >
                      {channel.name}
                      {channel.unloaded ? ' (off)' : ''}
                    </span>
                  )}
                  <div className="chan-btns">
                    <button
                      className={`led ${channel.mute ? 'on mute' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateChannel(channel.id, { mute: !channel.mute });
                      }}
                      title="Mute channel"
                    >
                      M
                    </button>
                    <button
                      className={`led ${channel.solo ? 'on solo' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateChannel(channel.id, { solo: !channel.solo });
                      }}
                      title="Solo channel"
                    >
                      S
                    </button>
                  </div>
                  <Meter stripId={channel.mixer} className="chan-meter" />
                </div>

                <div className="chan-steps" data-tour="steps">
                  {Array.from({ length: totalSteps }, (_, step) => {
                    const on = notes.some((n) => Math.abs(n.start - step) < 0.01);
                    return (
                      <button
                        key={step}
                        className={`step ${step % 4 === 0 ? 'beat' : ''} ${on ? 'on' : ''} ${playStep === step ? 'playhead' : ''}`}
                        style={{ opacity: visible ? 1 : 0.35 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!on) previewChannel(channel);
                          toggleStep(channel.id, step);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          clearChannelSteps(channel.id);
                        }}
                        title={`Step ${step + 1} — click to toggle, right-click clears the channel`}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}

        {!project.channels.length && (
          <div className="browser-empty">
            No channels yet.
            <br />
            Use <b>+ Ch</b> to add one.
          </div>
        )}
      </div>

      {selected && settingsOpen && (
        <div className="rack-settings">
          <div className="rs-head">
            <span className="chan-dot" style={{ background: selected.color, color: selected.color }} />
            <b style={{ fontSize: 11.5 }}>{selected.name}</b>
            <span className="tiny-note" style={{ flex: 1, minWidth: 90 }}>
              {PRESETS.find((p) => p.id === selected.preset)?.blurb}
            </span>
            <button
              className="tbtn small"
              onClick={() => {
                selectChannel(selected.id);
                setUI({ tab: 'pianoroll' });
              }}
              title="Edit notes in the piano roll"
            >
              <IconPiano size={11} />
            </button>
            <button className="tbtn small" onClick={() => audition(selected)} title="Audition this instrument">
              ♪
            </button>
            <button className="tbtn small flat" onClick={() => setSettingsOpen(false)} title="Collapse settings">
              ▾
            </button>
          </div>
          <div className="rs-controls">
            <Knob
              value={selected.gain}
              min={0}
              max={1.3}
              onChange={(v) => updateChannel(selected.id, { gain: v }, `gain:${selected.id}`)}
              onGestureStart={() => pushHistory(`gain:${selected.id}`)}
              label="Vol"
              size={32}
              format={(v) => `${Math.round(v * 100)}%`}
              defaultValue={0.8}
              color={selected.color}
            />
            <Knob
              value={selected.pan}
              min={-1}
              max={1}
              onChange={(v) => updateChannel(selected.id, { pan: v }, `pan:${selected.id}`)}
              onGestureStart={() => pushHistory(`pan:${selected.id}`)}
              label="Pan"
              size={32}
              format={(v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)}
              defaultValue={0}
              color={selected.color}
            />
            <Knob
              value={selected.tone}
              min={0}
              max={1}
              onChange={(v) => updateChannel(selected.id, { tone: v }, `tone:${selected.id}`)}
              onGestureStart={() => pushHistory(`tone:${selected.id}`)}
              label="Tone"
              size={32}
              format={(v) => `${Math.round(v * 100)}`}
              defaultValue={0.5}
              color={selected.color}
              hintText="Tone — brightness / filter opening of the instrument."
            />
            <Knob
              value={selected.decay}
              min={0.02}
              max={1}
              onChange={(v) => updateChannel(selected.id, { decay: v }, `decay:${selected.id}`)}
              onGestureStart={() => pushHistory(`decay:${selected.id}`)}
              label="Decay"
              size={32}
              format={(v) => v.toFixed(2)}
              defaultValue={0.4}
              color={selected.color}
            />
            <Knob
              value={selected.attack}
              min={0.001}
              max={1}
              onChange={(v) => updateChannel(selected.id, { attack: v }, `atk:${selected.id}`)}
              onGestureStart={() => pushHistory(`atk:${selected.id}`)}
              label="Attack"
              size={32}
              format={(v) => v.toFixed(2)}
              defaultValue={0.01}
              color={selected.color}
            />
            <Knob
              value={selected.release}
              min={0.02}
              max={1.2}
              onChange={(v) => updateChannel(selected.id, { release: v }, `rel:${selected.id}`)}
              onGestureStart={() => pushHistory(`rel:${selected.id}`)}
              label="Release"
              size={32}
              format={(v) => v.toFixed(2)}
              defaultValue={0.2}
              color={selected.color}
            />
            <Knob
              value={selected.transpose ?? 0}
              min={-24}
              max={24}
              step={1}
              onChange={(v) => updateChannel(selected.id, { transpose: v }, `tr:${selected.id}`)}
              onGestureStart={() => pushHistory(`tr:${selected.id}`)}
              label="Semi"
              size={32}
              format={(v) => `${v > 0 ? '+' : ''}${v}`}
              defaultValue={0}
              color={selected.color}
            />
            <div className="rs-selects">
              <label>
                <span>Instrument</span>
                <select
                  className="mini-select"
                  value={selected.preset}
                  onChange={(e) => updateChannel(selected.id, { preset: e.target.value as PresetId })}
                >
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Mixer route</span>
                <select
                  className="mini-select"
                  value={selected.mixer}
                  onChange={(e) => updateChannel(selected.id, { mixer: Number(e.target.value) })}
                >
                  {project.strips.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id === 0 ? 'Master' : `${s.id}. ${s.name}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </div>
      )}

      {selected && !settingsOpen && (
        <button className="rack-settings-collapsed" onClick={() => setSettingsOpen(true)}>
          <IconGear size={11} /> Channel settings · {selected.name} ▴
        </button>
      )}
    </div>
  );
}
