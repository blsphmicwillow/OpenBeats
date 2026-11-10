import { useEffect, useMemo, useRef, useState } from 'react';
import { channelNotes, currentPattern, previewChannel, useApp } from '../store';
import { Knob } from '../ui/Knob';
import { IconPiano, IconPlus, IconTrash } from '../ui/icons';

const ROW_H = 15;
const LOW = 24;
const HIGH = 108;

const BLACK = new Set([1, 3, 6, 8, 10]);
import { detectKey } from '../lib/theory';
import { scrollAtEdges, type ScrollEdge } from '../lib/edgeScroll';
import { chordAtStep } from '../lib/chords';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SCALES: Record<string, number[]> = {
  Off: [],
  Minor: [0, 2, 3, 5, 7, 8, 10],
  Major: [0, 2, 4, 5, 7, 9, 11],
  Dorian: [0, 2, 3, 5, 7, 9, 10],
  Pentatonic: [0, 3, 5, 7, 10],
  Harmonic: [0, 2, 3, 5, 7, 8, 11],
};

type Drag =
  | { kind: 'move'; noteId: string; startX: number; startY: number; origStart: number; origPitch: number }
  | { kind: 'resize'; noteId: string; startX: number; origLen: number }
  | { kind: 'velocity'; noteId: string; startY: number; origVel: number };

export function PianoRoll() {
  const project = useApp((s) => s.project);
  const settings = useApp((s) => s.settings);
  const transport = useApp((s) => s.transport);
  const [zoom, setZoom] = useState(20);
  const [noteLen, setNoteLen] = useState(2);
  const [scale, setScale] = useState<keyof typeof SCALES>('Minor');
  const [root, setRoot] = useState(9); // A
  const [selected, setSelected] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const keyRef = useRef<HTMLDivElement>(null);
  const scrollStart = useRef({ x: 0, y: 0 });
  const lastPointer = useRef({ x: 0, y: 0 });
  const edgeRef = useRef<ScrollEdge | null>(null);
  const [scrollEdge, setScrollEdge] = useState<ScrollEdge | null>(null);

  const {
    addNote,
    updateNote,
    removeNote,
    updateChannel,
    transposeChannel,
    patchProject,
    openMenu,
    hint,
    pushHistory,
    patchSettings,
  } = useApp.getState();

  const channel = project.channels.find((c) => c.id === project.selectedChannel) ?? project.channels[0];
  const channelId = channel?.id ?? null;
  const pattern = currentPattern(project);
  const notes = channel ? channelNotes(project, channel.id) : [];
  const totalSteps = Math.max(16, (pattern?.bars ?? 1) * 16);
  const barSteps = project.beatsPerBar * 4;
  const width = totalSteps * zoom;
  const height = (HIGH - LOW + 1) * ROW_H;
  const snap = settings.snap || 0;
  const snapStep = (v: number) => (snap ? Math.round(v / snap) * snap : Math.round(v));
  const color = channel?.color ?? 'var(--accent)';
  const detectedKey = detectKey(project.patterns.flatMap((p) => Object.values(p.notes).flat()));
  const playheadChord = chordAtStep(notes, transport.step)?.name ?? null;

  const inScale = (pitch: number) => {
    if (!scale || scale === 'Off') return false;
    const rel = ((pitch - root) % 12 + 12) % 12;
    return (SCALES[scale] ?? []).includes(rel);
  };

  // Remembers the scroll offset so edge auto-scroll keeps the note under the
  // pointer instead of letting it drift away with the grid.
  const startNoteDrag = (e: React.PointerEvent, next: Drag) => {
    const el = scrollRef.current;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    scrollStart.current = { x: el?.scrollLeft ?? 0, y: el?.scrollTop ?? 0 };
    drag.current = next;
  };

  useEffect(() => {
    // One project commit per animation frame: the clone and engine sync are
    // heavier than the pointer events themselves.
    let frame = 0;
    let autoFrame = 0;

    const apply = () => {
      frame = 0;
      const d = drag.current;
      if (!d || !channelId) return;
      const state = useApp.getState();
      const el = scrollRef.current;
      // Auto-scrolling moves the grid under the pointer, so add the distance
      // scrolled since the drag started to the pointer position.
      const px = lastPointer.current.x + (el ? el.scrollLeft - scrollStart.current.x : 0);
      const py = lastPointer.current.y + (el ? el.scrollTop - scrollStart.current.y : 0);
      if (d.kind === 'move') {
        const steps = (px - d.startX) / zoom;
        const rows = Math.round((d.startY - py) / ROW_H);
        state.updateNote(
          channelId,
          d.noteId,
          {
            start: Math.max(0, snapStep(d.origStart + steps)),
            pitch: Math.max(0, Math.min(127, d.origPitch + rows)),
          },
          `note-move:${d.noteId}`,
        );
      } else if (d.kind === 'resize') {
        const steps = (px - d.startX) / zoom;
        state.updateNote(channelId, d.noteId, { len: Math.max(0.25, snapStep(d.origLen + steps)) }, `note-len:${d.noteId}`);
      } else {
        const dy = d.startY - py;
        state.updateNote(channelId, d.noteId, { vel: Math.max(0.05, Math.min(1, d.origVel + dy / 60)) }, `note-vel:${d.noteId}`);
      }
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    const tick = () => {
      autoFrame = 0;
      const d = drag.current;
      const el = scrollRef.current;
      if (!d || !el || d.kind === 'velocity') {
        if (edgeRef.current !== null) {
          edgeRef.current = null;
          setScrollEdge(null);
        }
        return;
      }
      const { dx, dy, edge } = scrollAtEdges(el, lastPointer.current.x, lastPointer.current.y, { zone: 56 });
      if (edge !== edgeRef.current) {
        edgeRef.current = edge;
        setScrollEdge(edge);
      }
      if (dx || dy) schedule();
      // Keep looping while the drag lives, even if the pointer stops moving.
      autoFrame = requestAnimationFrame(tick);
    };

    const move = (e: PointerEvent) => {
      if (!drag.current) return;
      lastPointer.current = { x: e.clientX, y: e.clientY };
      schedule();
      if (!autoFrame) autoFrame = requestAnimationFrame(tick);
    };

    const finish = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        apply();
      }
      if (autoFrame) cancelAnimationFrame(autoFrame);
      autoFrame = 0;
      drag.current = null;
      edgeRef.current = null;
      setScrollEdge(null);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (frame) cancelAnimationFrame(frame);
      if (autoFrame) cancelAnimationFrame(autoFrame);
    };
  }, [zoom, snap, channelId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !channel) return;
    const row = (HIGH - channel.root) * ROW_H;
    el.scrollTop = Math.max(0, row - el.clientHeight / 2);
  }, [channel?.id]);

  const rows = useMemo(() => Array.from({ length: HIGH - LOW + 1 }, (_, i) => HIGH - i), []);

  const noteMenu = (e: React.MouseEvent, noteId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!channel) return;
    openMenu(e.clientX, e.clientY, [
      { label: 'Delete note', danger: true, onClick: () => removeNote(channel.id, noteId) },
      { separator: true },
      { label: 'Transpose channel +1', onClick: () => transposeChannel(channel.id, 1) },
      { label: 'Transpose channel −1', onClick: () => transposeChannel(channel.id, -1) },
    ]);
  };

  if (!channel) {
    return <div className="empty-state">Add a channel to start writing notes.</div>;
  }

  return (
    <div className="pianoroll" data-tour="pianoroll">
      <div className="toolbar">
        <span className="lbl">channel</span>
        <select
          className="mini-select"
          value={channel.id}
          onChange={(e) => patchProject((p) => { p.selectedChannel = e.target.value; }, { history: false })}
        >
          {project.channels.map((c, i) => (
            <option key={c.id} value={c.id}>
              {i + 1}. {c.name}
            </option>
          ))}
        </select>
        <span className="lbl">length</span>
        <select className="mini-select" value={noteLen} onChange={(e) => setNoteLen(Number(e.target.value))}>
          <option value={0.5}>1/32</option>
          <option value={1}>1/16</option>
          <option value={2}>1/8</option>
          <option value={4}>1/4</option>
          <option value={8}>1/2</option>
          <option value={16}>1 bar</option>
        </select>
        <span className="lbl">snap</span>
        <select className="mini-select" value={String(settings.snap)} onChange={(e) => patchSettings({ snap: Number(e.target.value) })}>
          <option value="1">1/16</option>
          <option value="0.5">1/32</option>
          <option value="0.25">1/64</option>
          <option value="0">Off</option>
        </select>
        <div className="sep" />
        <span className="lbl">key</span>
        <select className="mini-select" value={root} onChange={(e) => setRoot(Number(e.target.value))}>
          {NOTE_NAMES.map((n, i) => (
            <option key={n} value={i}>
              {n}
            </option>
          ))}
        </select>
        <select className="mini-select" value={scale} onChange={(e) => setScale(e.target.value as keyof typeof SCALES)}>
          {Object.keys(SCALES).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="chip" title="Estimated key across every pattern and channel">
          {detectedKey ?? 'no notes'}
        </span>
        <span className="chip" title="Chord sounding at the playhead">
          {playheadChord ?? '—'}
        </span>
        <div className="sep" />
        <button
          className="tbtn small"
          title="Snap all notes to the grid"
          onClick={() => {
            if (!pattern) return;
            pushHistory();
            patchProject((p) => {
              const pat = currentPattern(p);
              const list = pat?.notes[channel.id];
              if (!list) return;
              list.forEach((n) => {
                n.start = Math.max(0, Math.round(n.start));
              });
            });
            hint('Notes quantised to 1/16');
          }}
        >
          Quantise
        </button>
        <button className="tbtn small" onClick={() => transposeChannel(channel.id, 1)} title="Transpose +1 semitone">
          +1
        </button>
        <button className="tbtn small" onClick={() => transposeChannel(channel.id, -1)} title="Transpose −1 semitone">
          −1
        </button>
        <button
          className="tbtn small"
          onClick={() => {
            pushHistory();
            patchProject((p) => {
              const pat = currentPattern(p);
              if (pat) pat.notes[channel.id] = [];
            });
          }}
          title="Clear this channel's notes"
        >
          <IconTrash size={10} />
        </button>
        <div className="spacer" />
        <Knob
          value={channel.gain}
          min={0}
          max={1.3}
          onChange={(v) => updateChannel(channel.id, { gain: v }, `pr-gain:${channel.id}`)}
          onGestureStart={() => pushHistory(`pr-gain:${channel.id}`)}
          label="Level"
          size={26}
          format={(v) => `${Math.round(v * 100)}%`}
          color={channel.color}
        />
        <span className="tiny-note">{notes.length} notes</span>
      </div>

      <div className={`pr-scroll ${scrollEdge ? `auto-${scrollEdge}` : ''}`} ref={scrollRef}>
        <div className="pr-inner" style={{ display: 'flex', width: 70 + width, height }}>
          <div className="pr-keys" ref={keyRef} style={{ height }}>
            {rows.map((pitch) => {
              const black = BLACK.has(pitch % 12);
              const active = notes.some((n) => n.pitch === pitch);
              return (
                <div
                  key={pitch}
                  className={`pr-key ${black ? 'black' : ''} ${active ? 'active' : ''}`}
                  style={{ height: ROW_H }}
                  onPointerDown={() => previewChannel({ ...channel, root: pitch })}
                  title={`${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`}
                >
                  {pitch % 12 === 0 ? `C${Math.floor(pitch / 12) - 1}` : ''}
                </div>
              );
            })}
          </div>

          <div
            className="pr-grid"
            style={{ width, height, background: 'color-mix(in srgb, var(--bg) 55%, var(--panel))' }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('pr-row')) return;
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const step = Math.max(0, snapStep((e.clientX - rect.left) / zoom));
              const pitch = HIGH - Math.floor((e.clientY - rect.top) / ROW_H);
              pushHistory();
              addNote(channel.id, { pitch, start: step, len: noteLen, vel: 0.85 });
              previewChannel({ ...channel, root: pitch });
              setSelected(null);
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {rows.map((pitch) => (
              <div
                key={pitch}
                className={`pr-row ${BLACK.has(pitch % 12) ? 'black' : ''} ${inScale(pitch) ? 'in-scale' : ''}`}
                style={{ top: (HIGH - pitch) * ROW_H, height: ROW_H }}
              />
            ))}
            {Array.from({ length: Math.floor(totalSteps / 4) + 1 }, (_, i) => (
              <div
                key={`l${i}`}
                className={`pr-vline ${i * 4 % barSteps === 0 ? 'bar' : i % 4 === 0 ? 'beat' : ''}`}
                style={{ left: i * 4 * zoom }}
              />
            ))}
            {notes.map((note) => (
              <div
                key={note.id}
                className={`pr-note ${selected === note.id ? 'selected' : ''}`}
                style={{
                  left: note.start * zoom,
                  top: (HIGH - note.pitch) * ROW_H + 1,
                  width: Math.max(5, note.len * zoom),
                  height: ROW_H - 2,
                  ['--note-color' as string]: color,
                  opacity: 0.45 + note.vel * 0.55,
                }}
                title={`${NOTE_NAMES[note.pitch % 12]}${Math.floor(note.pitch / 12) - 1} · vel ${Math.round(note.vel * 100)}%`}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  setSelected(note.id);
                  pushHistory();
                  startNoteDrag(e, {
                    kind: 'move',
                    noteId: note.id,
                    startX: e.clientX,
                    startY: e.clientY,
                    origStart: note.start,
                    origPitch: note.pitch,
                  });
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  removeNote(channel.id, note.id);
                }}
                onContextMenu={(e) => noteMenu(e, note.id)}
              >
                <span>{note.len >= 2 ? NOTE_NAMES[note.pitch % 12] : ''}</span>
                <div
                  className="note-resize"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    pushHistory();
                    startNoteDrag(e, { kind: 'resize', noteId: note.id, startX: e.clientX, origLen: note.len });
                  }}
                />
              </div>
            ))}
            <div
              className="playhead-line"
              style={{ left: (transport.step % totalSteps) * zoom, zIndex: 3 }}
            />
          </div>
        </div>
      </div>

      <div className="vel-lane">
        <div className="vel-label">
          Velocity
          <div className="tiny-note" style={{ marginTop: 4 }}>
            drag bars
          </div>
        </div>
        <div className="vel-grid">
          {notes.map((note) => (
            <div
              key={note.id}
              className="vel-bar"
              style={{ left: note.start * zoom, height: `${Math.max(4, note.vel * 60)}px` }}
              title={`Velocity ${Math.round(note.vel * 100)}%`}
              onPointerDown={(e) => {
                e.stopPropagation();
                pushHistory();
                startNoteDrag(e, { kind: 'velocity', noteId: note.id, startY: e.clientY, origVel: note.vel });
              }}
            />
          ))}
        </div>
      </div>

      <div className="tiny-note" style={{ padding: '3px 8px', borderTop: '1px solid var(--border)', display: 'flex', gap: 12 }}>
        <span><IconPiano size={10} /> click empty grid to draw · double-click a note to delete</span>
        <span><IconPlus size={10} /> drag note body to move, right edge to resize</span>
        <span style={{ marginLeft: 'auto' }}>snap {snap || 'off'} · {pattern?.name}</span>
      </div>
    </div>
  );
}
