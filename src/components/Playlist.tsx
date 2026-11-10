import { useEffect, useMemo, useRef, useState } from 'react';
import { patternById, useApp } from '../store';
import { songLengthSteps } from '../audio/sequencer';
import { IconGrid, IconPiano, IconPlus, IconTrash } from '../ui/icons';

const HEAD = 142;

type DragState =
  | { kind: 'clip'; id: string; startX: number; origStart: number; origLen: number }
  | { kind: 'resize'; id: string; startX: number; origLen: number }
  | { kind: 'loop'; edge: 'start' | 'end'; startX: number; orig: number };

export function Playlist() {
  const project = useApp((s) => s.project);
  const settings = useApp((s) => s.settings);
  const transport = useApp((s) => s.transport);
  const ui = useApp((s) => s.ui);
  const [zoom, setZoom] = useState(9);
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const drag = useRef<DragState | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  const {
    addClip,
    updateClip,
    removeClip,
    addTrack,
    updateTrack,
    removeTrack,
    seek,
    patchProject,
    selectPattern,
    setUI,
    openMenu,
    hint,
    pushHistory,
  } = useApp.getState();

  const barSteps = project.beatsPerBar * 4;
  const snap = settings.snap || 0;
  const contentSteps = Math.max(
    64,
    Math.ceil((songLengthSteps(project) + barSteps) / barSteps) * barSteps,
    Math.ceil((project.loopEnd + barSteps) / barSteps) * barSteps,
  );
  const width = contentSteps * zoom;

  const snapStep = (step: number) => (snap ? Math.round(step / snap) * snap : Math.round(step));

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const deltaSteps = (e.clientX - d.startX) / zoom;
      if (d.kind === 'clip') {
        updateClip(d.id, { start: Math.max(0, snapStep(d.origStart + deltaSteps)) }, `clip-move:${d.id}`);
      } else if (d.kind === 'resize') {
        updateClip(d.id, { len: Math.max(1, snapStep(d.origLen + deltaSteps)) }, `clip-resize:${d.id}`);
      } else {
        const value = snapStep(d.orig + deltaSteps);
        const state = useApp.getState();
        const current = state.project;
        if (d.edge === 'start') {
          const start = Math.max(0, Math.min(current.loopEnd - 1, value));
          state.patchProject((p) => {
            p.loopStart = start;
          }, { coalesce: 'loop' });
        } else {
          const end = Math.max(current.loopStart + 1, value);
          state.patchProject((p) => {
            p.loopEnd = end;
          }, { coalesce: 'loop' });
        }
      }
    };
    const up = () => {
      drag.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [zoom, snap, updateClip]);

  const clipMenu = (e: React.MouseEvent, clipId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const clip = project.clips.find((c) => c.id === clipId);
    if (!clip) return;
    const pat = patternById(project, clip.pattern);
    openMenu(e.clientX, e.clientY, [
      {
        label: 'Open in piano roll',
        onClick: () => {
          selectPattern(clip.pattern);
          setUI({ tab: 'pianoroll' });
        },
      },
      {
        label: 'Clone clip',
        onClick: () => addClip(clip.pattern, clip.track, clip.start + clip.len, clip.len),
      },
      {
        label: 'Move up a track',
        disabled: clip.track === 0,
        onClick: () => updateClip(clip.id, { track: clip.track - 1 }),
      },
      {
        label: 'Move down a track',
        disabled: clip.track >= project.tracks.length - 1,
        onClick: () => updateClip(clip.id, { track: clip.track + 1 }),
      },
      { separator: true },
      {
        label: `Clip gain: ${clip.gain && clip.gain !== 1 ? `${(20 * Math.log10(clip.gain)).toFixed(1)} dB` : '0.0 dB'}`,
        disabled: true,
      },
      {
        label: 'Clip gain +1 dB',
        onClick: () => updateClip(clip.id, { gain: Math.min(4, (clip.gain ?? 1) * 1.122) }),
      },
      {
        label: 'Clip gain −1 dB',
        onClick: () => updateClip(clip.id, { gain: Math.max(0, (clip.gain ?? 1) / 1.122) }),
      },
      { label: 'Reset clip gain', onClick: () => updateClip(clip.id, { gain: 1 }) },
      { separator: true },
      {
        label: `Pan: ${(clip.pan ?? 0) === 0 ? 'center' : (clip.pan ?? 0) < 0 ? `${Math.round(Math.abs(clip.pan ?? 0) * 100)}% left` : `${Math.round((clip.pan ?? 0) * 100)}% right`}`,
        disabled: true,
      },
      {
        label: 'Pan left',
        onClick: () => updateClip(clip.id, { pan: Math.max(-1, (clip.pan ?? 0) - 0.1) }),
      },
      {
        label: 'Pan right',
        onClick: () => updateClip(clip.id, { pan: Math.min(1, (clip.pan ?? 0) + 0.1) }),
      },
      { label: 'Center pan', onClick: () => updateClip(clip.id, { pan: 0 }) },
      { separator: true },
      { label: `Pitch: ${clip.pitch ?? 0} st`, disabled: true },
      { label: 'Pitch +1', onClick: () => updateClip(clip.id, { pitch: (clip.pitch ?? 0) + 1 }) },
      { label: 'Pitch −1', onClick: () => updateClip(clip.id, { pitch: (clip.pitch ?? 0) - 1 }) },
      { label: 'Reset pitch', onClick: () => updateClip(clip.id, { pitch: 0 }) },
      { separator: true },
      {
        label: `Stretch: ${(clip.stretch ?? 1).toFixed(2)}×`,
        onClick: () => updateClip(clip.id, { stretch: Math.min(4, (clip.stretch ?? 1) * 1.1) }),
      },
      {
        label: 'Reset stretch',
        onClick: () => updateClip(clip.id, { stretch: 1 }),
      },
      { separator: true },
      {
        label: `Fade in: ${clip.fadeIn ?? 0} steps`,
        onClick: () => updateClip(clip.id, { fadeIn: ((clip.fadeIn ?? 0) + 2) % 18 }),
      },
      {
        label: `Fade out: ${clip.fadeOut ?? 0} steps`,
        onClick: () => updateClip(clip.id, { fadeOut: ((clip.fadeOut ?? 0) + 2) % 18 }),
      },
      {
        label: 'Clear fades',
        onClick: () => updateClip(clip.id, { fadeIn: 0, fadeOut: 0 }),
      },
      { separator: true },
      { label: `Pattern: ${pat?.name ?? 'unknown'}`, disabled: true },
      { label: 'Delete clip', danger: true, onClick: () => removeClip(clip.id) },
    ]);
  };

  const trackMenu = (e: React.MouseEvent, index: number) => {
    e.preventDefault();
    const track = project.tracks[index];
    openMenu(e.clientX, e.clientY, [
      { label: 'Rename track', onClick: () => { setRenaming(index); setDraft(track.name); } },
      { label: 'Add track', onClick: addTrack },
      { label: 'Move up', disabled: index === 0, onClick: () => {
        const other = project.tracks[index - 1];
        patchProject((p) => {
          p.tracks[index - 1] = p.tracks[index];
          p.tracks[index] = other;
          p.clips.forEach((c) => {
            if (c.track === index) c.track = index - 1;
            else if (c.track === index - 1) c.track = index;
          });
        });
      } },
      { separator: true },
      { label: 'Delete track', danger: true, disabled: project.tracks.length <= 1, onClick: () => removeTrack(index) },
    ]);
  };

  const bars = useMemo(() => Math.ceil(contentSteps / barSteps), [contentSteps, barSteps]);

  return (
    <div className="playlist" data-tour="playlist">
      <div className="toolbar">
        <span className="lbl">paint</span>
        <select
          className="mini-select"
          value={project.currentPattern}
          onChange={(e) => selectPattern(e.target.value)}
          title="Pattern used when you double-click an empty lane"
        >
          {project.patterns.map((p, i) => (
            <option key={p.id} value={p.id}>
              {i + 1}. {p.name}
            </option>
          ))}
        </select>
        <button className="tbtn small" onClick={() => addClip(project.currentPattern, 0, transport.step, (patternById(project, project.currentPattern)?.bars ?? 2) * barSteps)} title="Add a clip at the playhead">
          <IconPlus size={10} /> Clip
        </button>
        <div className="sep" />
        <button className="tbtn small" onClick={addTrack} title="Add playlist track">
          <IconPlus size={10} /> Track
        </button>
        <button
          className="tbtn small"
          onClick={() =>
            hint(`${project.tracks.length} tracks · ${project.clips.length} clips · snap ${snap || 'off'} step${snap === 1 ? '' : 's'}`)
          }
          title="Arrangement info"
        >
          <IconGrid size={11} /> {project.tracks.length} × {project.clips.length}
        </button>
        <div className="sep" />
        <span className="lbl">snap</span>
        <select
          className="mini-select"
          value={String(settings.snap)}
          onChange={(e) => useApp.getState().patchSettings({ snap: Number(e.target.value) })}
        >
          <option value="1">1/16</option>
          <option value="0.5">1/32</option>
          <option value="0.25">1/64</option>
          <option value="0">Off</option>
        </select>
        <span className="lbl">zoom</span>
        <input
          type="range"
          min={4}
          max={26}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          style={{ width: 90 }}
          title="Horizontal zoom"
        />
        <div className="sep" />
        <button
          className={`tbtn small ${project.loop ? 'active' : ''}`}
          onClick={() => patchProject((p) => (p.loop = !p.loop))}
          title="Loop the song section"
        >
          Loop
        </button>
        <span className="tiny-note">
          Loop bars {Math.floor(project.loopStart / barSteps) + 1}–{Math.max(1, Math.ceil(project.loopEnd / barSteps))}
        </span>
        <div className="spacer" />
        <button
          className="tbtn small"
          onClick={() => {
            selectPattern(project.currentPattern);
            setUI({ tab: 'pianoroll' });
          }}
          title="Edit this pattern's notes"
        >
          <IconPiano size={11} /> Piano roll
        </button>
      </div>

      <div className="pl-scroll">
        <div className="pl-inner" style={{ width: HEAD + width }}>
          <div className="pl-ruler" style={{ marginLeft: HEAD, width }}>
            {Array.from({ length: bars }, (_, bar) => (
              <div
                key={bar}
                className={`tick ${bar % 4 === 0 ? 'major' : ''}`}
                style={{ left: bar * barSteps * zoom }}
              >
                {bar + 1}
              </div>
            ))}
            <div
              className="loop-region"
              style={{ left: project.loopStart * zoom, width: Math.max(2, (project.loopEnd - project.loopStart) * zoom) }}
            />
            <div
              className="loop-handle"
              style={{ left: project.loopStart * zoom, borderRadius: '2px 0 0 2px' }}
              onPointerDown={(e) => {
                e.stopPropagation();
                pushHistory();
                drag.current = { kind: 'loop', edge: 'start', startX: e.clientX, orig: project.loopStart };
              }}
              title="Drag the loop start"
            />
            <div
              className="loop-handle"
              style={{ left: project.loopEnd * zoom - 7, borderRadius: '0 2px 2px 0' }}
              onPointerDown={(e) => {
                e.stopPropagation();
                pushHistory();
                drag.current = { kind: 'loop', edge: 'end', startX: e.clientX, orig: project.loopEnd };
              }}
              title="Drag the loop end"
            />
            <div
              className="playhead-head"
              style={{ left: transport.step * zoom, top: 2, position: 'absolute' }}
            />
          </div>

          {project.tracks.map((track, index) => (
            <div className="track-row" key={track.id} style={{ height: track.height }}>
              <div className="track-head" onContextMenu={(e) => trackMenu(e, index)}>
                <span className="tnum">{index + 1}</span>
                <div className="tinfo">
                  {renaming === index ? (
                    <input
                      autoFocus
                      value={draft}
                      style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--accent)', fontSize: 11 }}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => {
                        updateTrack(index, { name: draft.trim() || track.name });
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setRenaming(null);
                        e.stopPropagation();
                      }}
                    />
                  ) : (
                    <div className="tname" onDoubleClick={() => { setRenaming(index); setDraft(track.name); }}>
                      {track.name}
                    </div>
                  )}
                  <div className="tbtns">
                    <button
                      className={`led ${track.mute ? 'on mute' : ''}`}
                      onClick={() => updateTrack(index, { mute: !track.mute })}
                      title="Mute track"
                    >
                      M
                    </button>
                    <button
                      className={`led ${track.solo ? 'on solo' : ''}`}
                      onClick={() => updateTrack(index, { solo: !track.solo })}
                      title="Solo track"
                    >
                      S
                    </button>
                    <button
                      className="led"
                      style={{ width: 16 }}
                      onClick={() => patchProject((p) => {
                        p.tracks[index].height = track.height > 70 ? 46 : 92;
                      })}
                      title="Collapse / expand lane"
                    >
                      {track.height > 70 ? '▾' : '▸'}
                    </button>
                  </div>
                </div>
              </div>
              <div
                className="lane"
                data-track={index}
                style={{ width, backgroundSize: `${barSteps * zoom}px 100%`, opacity: track.mute ? 0.55 : 1 }}
                onClick={(e) => {
                  if (e.target !== e.currentTarget) return;
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  seek(snapStep((e.clientX - rect.left) / zoom));
                  setSelectedClip(null);
                }}
                onDoubleClick={(e) => {
                  if (e.target !== e.currentTarget) return;
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const start = snapStep((e.clientX - rect.left) / zoom);
                  const len = (patternById(project, project.currentPattern)?.bars ?? 2) * barSteps;
                  addClip(project.currentPattern, index, start, len);
                }}
              >
                {project.clips
                  .filter((c) => c.track === index)
                  .map((clip) => {
                    const pat = patternById(project, clip.pattern);
                    const color = pat?.color ?? track.color;
                    const notes = pat ? Object.values(pat.notes).flat() : [];
                    return (
                      <div
                        key={clip.id}
                        className={`clip ${selectedClip === clip.id ? 'selected' : ''}`}
                        style={{ left: clip.start * zoom, width: Math.max(6, clip.len * zoom), ['--clip-color' as string]: color }}
                        title={`${pat?.name ?? 'Pattern'} — drag to move, drag the right edge to resize, double-click to edit`}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return;
                          e.stopPropagation();
                          setSelectedClip(clip.id);
                          pushHistory();
                          drag.current = { kind: 'clip', id: clip.id, startX: e.clientX, origStart: clip.start, origLen: clip.len };
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          selectPattern(clip.pattern);
                          setUI({ tab: 'pianoroll' });
                        }}
                        onContextMenu={(e) => clipMenu(e, clip.id)}
                      >
                        <div className="clip-label">{pat?.name ?? 'Pattern'}</div>
                        <div className="clip-notes">
                          {notes.slice(0, 120).map((n) => (
                            <i
                              key={n.id}
                              style={{
                                left: `${(n.start / Math.max(1, clip.len)) * 100}%`,
                                bottom: `${((n.pitch % 24) / 24) * 100}%`,
                                width: `${Math.max(0.6, (n.len / Math.max(1, clip.len)) * 100)}%`,
                              }}
                            />
                          ))}
                        </div>
                        <div
                          className="clip-resize"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            pushHistory();
                            drag.current = { kind: 'resize', id: clip.id, startX: e.clientX, origLen: clip.len };
                          }}
                        />
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}

          <div
            className="playhead-line"
            style={{ left: HEAD + transport.step * zoom, top: 24, zIndex: 4 }}
          />
        </div>
      </div>
      {ui.contextMenu === null && project.clips.length === 0 && (
        <div className="tiny-note" style={{ padding: '3px 8px', borderTop: '1px solid var(--border)' }}>
          Double-click a lane to paint the current pattern. Drag clips to arrange.
        </div>
      )}
      <div className="tiny-note" style={{ padding: '3px 8px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
        <span><IconTrash size={10} /> right-click a clip to delete</span>
        <span>double-click empty lane to paint</span>
        <span>drag the orange loop bar in the ruler</span>
      </div>
    </div>
  );
}
