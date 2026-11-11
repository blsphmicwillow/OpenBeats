import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { patternById, useApp } from '../store';
import { songLengthSteps } from '../audio/sequencer';
import {
  AUDIO_CLIP_MIME,
  clampSourceOffset,
  createAudioClipFromDrop,
  resolveSnapTick,
  secondsToTicks,
  TICKS_PER_STEP,
  ticksToSteps,
  type AudioClip,
} from '../model/audioClip';
import { dropGhost, playlistSnapContext } from '../playlistDrop';
import { getSampleBuffer, getSampleName, getSamplePeaks, getSampleRef, peakLevelCount } from '../audio/sampleLibrary';
import { IconGrid, IconPiano, IconPlus, IconTrash } from '../ui/icons';
import { keepPlayheadVisible } from '../lib/playheadFollow';

const HEAD = 142;

type DragState =
  | { kind: 'clip'; id: string; startX: number; origStart: number; origLen: number }
  | { kind: 'resize'; id: string; startX: number; origLen: number }
  | { kind: 'loop'; edge: 'start' | 'end'; startX: number; orig: number }
  | { kind: 'loop-move'; startX: number; origStart: number; origEnd: number }
  | { kind: 'playhead'; startX: number; rulerLeft: number }
  | { kind: 'audio-clip'; id: string; track: number; startX: number; origStartTick: number }
  | { kind: 'audio-slip'; id: string; startX: number; origOffset: number; lengthTicks: number; sourceDurationTicks: number }
  | { kind: 'marker'; id: string; startX: number; origStart: number }
  | { kind: 'fade-in' | 'fade-out'; id: string; audio: boolean; startX: number; orig: number; len: number };

import { AudioClipWave } from './AudioClipWave';

export function Playlist() {
  const project = useApp((s) => s.project);
  const settings = useApp((s) => s.settings);
  const transport = useApp((s) => s.transport);
  const ui = useApp((s) => s.ui);
  const [zoom, setZoom] = useState(9);
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const drag = useRef<DragState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragStartScroll = useRef(0);
  const lastPointerX = useRef(0);
  const autoEdgeRef = useRef<'left' | 'right' | null>(null);
  const [autoEdge, setAutoEdge] = useState<'left' | 'right' | null>(null);
  const [dragging, setDragging] = useState<DragState['kind'] | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [audioGhost, setAudioGhost] = useState<{ track: number; left: number; width: number } | null>(null);
  const [renamingMarker, setRenamingMarker] = useState<string | null>(null);
  const [markerDraft, setMarkerDraft] = useState('');

  const {
    addMarker,
    updateMarker,
    removeMarker,
    loopFromMarker,
    addClip,
    updateClip,
    removeClip,
    splitClipAt,
    addAudioClip,
    updateAudioClip,
    removeAudioClip,
    importAudioClipFiles,
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
    Math.ceil((Math.max(0, ...project.markers.map((m) => m.start)) + barSteps) / barSteps) * barSteps,
  );
  const width = contentSteps * zoom;

  const snapStep = (step: number) => (snap ? Math.round(step / snap) * snap : Math.round(step));

  /** Playhead and clip edges on one track, in ticks, for drop snapping. */
  const audioEdgesFor = (track: number) => {
    const edges: number[] = [];
    project.clips
      .filter((c) => c.track === track)
      .forEach((c) => {
        edges.push(c.start * TICKS_PER_STEP, (c.start + c.len) * TICKS_PER_STEP);
      });
    project.audioClips
      .filter((c) => c.track === track)
      .forEach((c) => {
        edges.push(c.start_tick, c.start_tick + c.length_ticks);
      });
    return edges;
  };

  // Starts any drag: remembers the scroll offset so auto-scroll keeps the
  // dragged element under the pointer, and sets the visible affordance.
  const beginDrag = useCallback((e: React.PointerEvent, next: DragState) => {
    drag.current = next;
    dragStartScroll.current = scrollRef.current?.scrollLeft ?? 0;
    lastPointerX.current = e.clientX;
    setDragging(next.kind);
    document.body.style.cursor =
      next.kind === 'playhead'
        ? 'col-resize'
        : next.kind === 'clip' || next.kind === 'loop-move' || next.kind === 'audio-slip'
          ? 'grabbing'
          : 'ew-resize';
  }, []);

  useEffect(() => {
    // Coalesce pointer moves into one state commit per animation frame: the
    // project clone and engine sync are far heavier than the pointer events.
    let frame = 0;
    let autoFrame = 0;
    let pendingX: number | null = null;

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    const apply = () => {
      frame = 0;
      const clientX = pendingX;
      pendingX = null;
      const d = drag.current;
      if (clientX === null || !d) return;
      // Scrolling the lane moves the content under the pointer, so the drag has
      // to account for the distance scrolled since it started.
      const pointer = clientX + ((scrollRef.current?.scrollLeft ?? 0) - dragStartScroll.current);
      const deltaSteps = (pointer - d.startX) / zoom;
      const state = useApp.getState();
      if (d.kind === 'clip') {
        updateClip(d.id, { start: Math.max(0, snapStep(d.origStart + deltaSteps)) }, `clip-move:${d.id}`);
      } else if (d.kind === 'resize') {
        updateClip(d.id, { len: Math.max(1, snapStep(d.origLen + deltaSteps)) }, `clip-resize:${d.id}`);
      } else if (d.kind === 'playhead') {
        state.seek(Math.max(0, snapStep((pointer - d.rulerLeft) / zoom)));
      } else if (d.kind === 'audio-clip') {
        const rawTick = d.origStartTick + deltaSteps * TICKS_PER_STEP;
        const edges: number[] = [];
        state.project.clips
          .filter((c) => c.track === d.track)
          .forEach((c) => edges.push(c.start * TICKS_PER_STEP, (c.start + c.len) * TICKS_PER_STEP));
        state.project.audioClips
          .filter((c) => c.track === d.track && c.id !== d.id)
          .forEach((c) => edges.push(c.start_tick, c.start_tick + c.length_ticks));
        const context = playlistSnapContext({
          pointerTick: rawTick,
          playheadTick: state.transport.step * TICKS_PER_STEP,
          gridSteps: snap,
          pixelsPerStep: zoom,
          neighbourTicks: edges,
        });
        updateAudioClip(d.id, { start_tick: resolveSnapTick(rawTick, context) }, `audio-clip:${d.id}`);
      } else if (d.kind === 'audio-slip') {
        const value = clampSourceOffset(
          d.origOffset + deltaSteps * TICKS_PER_STEP,
          d.lengthTicks,
          d.sourceDurationTicks,
        );
        updateAudioClip(d.id, { source_offset_ticks: value }, `audio-slip:${d.id}`);
      } else if (d.kind === 'fade-in' || d.kind === 'fade-out') {
        const direction = d.kind === 'fade-in' ? 1 : -1;
        const raw = d.audio
          ? d.orig + direction * deltaSteps * TICKS_PER_STEP
          : d.orig + direction * deltaSteps;
        const value = Math.max(0, Math.min(d.len, d.audio ? Math.round(raw) : snapStep(raw)));
        if (d.audio) {
          updateAudioClip(
            d.id,
            d.kind === 'fade-in' ? { fade_in: value } : { fade_out: value },
            `fade:${d.id}:${d.kind}`,
          );
        } else {
          updateClip(
            d.id,
            d.kind === 'fade-in' ? { fadeIn: value } : { fadeOut: value },
            `fade:${d.id}:${d.kind}`,
          );
        }
      } else if (d.kind === 'marker') {
        updateMarker(d.id, { start: Math.max(0, snapStep(d.origStart + deltaSteps)) }, `marker:${d.id}`);
      } else if (d.kind === 'loop-move') {
        // Keep the loop length and slide the whole window.
        const length = Math.max(1, d.origEnd - d.origStart);
        const start = Math.max(0, d.origStart + snapStep(deltaSteps));
        state.patchProject((p) => {
          p.loopStart = start;
          p.loopEnd = start + length;
        }, { coalesce: 'loop' });
      } else if (d.kind === 'loop') {
        const value = snapStep(d.orig + deltaSteps);
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

    const EDGE = 64;
    const MAX_SPEED = 22;
    const tick = () => {
      autoFrame = 0;
      const el = scrollRef.current;
      if (!el || !drag.current) {
        if (autoEdgeRef.current !== null) {
          autoEdgeRef.current = null;
          setAutoEdge(null);
        }
        return;
      }
      const rect = el.getBoundingClientRect();
      const x = lastPointerX.current;
      let speed = 0;
      if (x < rect.left + EDGE) speed = -MAX_SPEED * Math.min(1, (rect.left + EDGE - x) / EDGE);
      else if (x > rect.right - EDGE) speed = MAX_SPEED * Math.min(1, (x - (rect.right - EDGE)) / EDGE);
      const edge = speed < 0 ? 'left' : speed > 0 ? 'right' : null;
      if (edge !== autoEdgeRef.current) {
        autoEdgeRef.current = edge;
        setAutoEdge(edge);
      }
      if (edge) {
        const before = el.scrollLeft;
        el.scrollLeft = Math.max(0, before + speed);
        if (el.scrollLeft !== before) {
          // Re-evaluate the drag with the new scroll position.
          pendingX = lastPointerX.current;
          schedule();
        }
      }
      autoFrame = requestAnimationFrame(tick);
    };

    const move = (e: PointerEvent) => {
      if (!drag.current) return;
      lastPointerX.current = e.clientX;
      pendingX = e.clientX;
      schedule();
      // The edge loop keeps scrolling even when the pointer stops moving.
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
      setDragging(null);
      setAutoEdge(null);
      autoEdgeRef.current = null;
      document.body.style.cursor = '';
    };
    // A cancelled drag (Esc, OS gesture, pointer loss) must leave no residue:
    // put an audio clip back where it started instead of committing the ghost.
    const cancel = () => {
      const d = drag.current;
      if (d && d.kind === 'audio-clip') {
        useApp.getState().updateAudioClip(d.id, { start_tick: d.origStartTick });
      } else if (d && d.kind === 'audio-slip') {
        useApp.getState().updateAudioClip(d.id, { source_offset_ticks: d.origOffset });
      }
      finish();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      if (frame) cancelAnimationFrame(frame);
      if (autoFrame) cancelAnimationFrame(autoFrame);
      document.body.style.cursor = '';
    };
  }, [zoom, snap, updateClip, updateAudioClip, beginDrag]);

  // Follow the transport while it rolls: scroll only when the playhead would
  // leave the viewport, so manual scrolling is not fought every step.
  useEffect(() => {
    if (transport.playing) keepPlayheadVisible(scrollRef.current, '.playhead-line', 96);
  }, [transport.step, transport.playing]);

  const nextPatternOverlap = (clip: { id: string; track: number; start: number; len: number }) => {
    const next = project.clips
      .filter((c) => c.track === clip.track && c.id !== clip.id && c.start > clip.start)
      .sort((a, b) => a.start - b.start)[0];
    return next && next.start < clip.start + clip.len ? next : null;
  };

  const nextAudioOverlap = (clip: AudioClip) => {
    const next = project.audioClips
      .filter((c) => c.track === clip.track && c.id !== clip.id && c.start_tick > clip.start_tick)
      .sort((a, b) => a.start_tick - b.start_tick)[0];
    return next && next.start_tick < clip.start_tick + clip.length_ticks ? next : null;
  };

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
      (() => {
        const next = nextPatternOverlap(clip);
        const overlap = next ? clip.start + clip.len - next.start : 0;
        return {
          label: next ? `Crossfade ${overlap} steps with next clip` : 'Crossfade needs an overlapping next clip',
          disabled: !next,
          onClick: () => {
            if (!next) return;
            patchProject((p) => {
              const current = p.clips.find((c) => c.id === clip.id);
              const following = p.clips.find((c) => c.id === next.id);
              if (current) current.fadeOut = overlap;
              if (following) following.fadeIn = overlap;
            });
          },
        };
      })(),
      { separator: true },
      {
        label: 'Split at playhead',
        disabled: transport.step <= clip.start || transport.step >= clip.start + clip.len,
        onClick: () => splitClipAt(clip.id, transport.step) && hint('Clip split at the playhead'),
      },
      { label: `Pattern: ${pat?.name ?? 'unknown'}`, disabled: true },
      { label: 'Delete clip', danger: true, onClick: () => removeClip(clip.id) },
    ]);
  };

  const audioClipMenu = (e: React.MouseEvent, clipId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const clip = project.audioClips.find((c) => c.id === clipId);
    if (!clip) return;
    openMenu(e.clientX, e.clientY, [
      { label: `${clip.name} — Web Audio clip`, disabled: true },
      { label: `Gain ${(20 * Math.log10(Math.max(0.001, clip.gain))).toFixed(1)} dB`, disabled: true },
      { label: 'Gain +1 dB', onClick: () => updateAudioClip(clip.id, { gain: Math.min(4, clip.gain * 1.122) }) },
      { label: 'Gain −1 dB', onClick: () => updateAudioClip(clip.id, { gain: Math.max(0, clip.gain / 1.122) }) },
      { label: 'Reset gain', onClick: () => updateAudioClip(clip.id, { gain: 1 }) },
      { separator: true },
      { label: 'Pan left', onClick: () => updateAudioClip(clip.id, { pan: Math.max(-1, clip.pan - 0.1) }) },
      { label: 'Pan right', onClick: () => updateAudioClip(clip.id, { pan: Math.min(1, clip.pan + 0.1) }) },
      { label: 'Center pan', onClick: () => updateAudioClip(clip.id, { pan: 0 }) },
      { separator: true },
      {
        label: `Loop the file: ${clip.loop_mode === 'loop' ? 'on' : 'off'}`,
        onClick: () => updateAudioClip(clip.id, { loop_mode: clip.loop_mode === 'loop' ? 'off' : 'loop' }),
      },
      {
        label: `Reverse playback: ${clip.reversed ? 'on' : 'off'} (Web Audio only)`,
        onClick: () => updateAudioClip(clip.id, { reversed: !clip.reversed }),
      },
      {
        label: `Normalize peak to −1 dBFS: ${clip.normalized ? 'on' : 'off'} (Web Audio only)`,
        onClick: () => updateAudioClip(clip.id, { normalized: !clip.normalized }),
      },
      { separator: true },
      {
        label: `Slip: ${ticksToSteps(clip.source_offset_ticks ?? 0)} steps`,
        disabled: true,
      },
      {
        label: 'Reset slip to source start',
        disabled: (clip.source_offset_ticks ?? 0) === 0,
        onClick: () => updateAudioClip(clip.id, { source_offset_ticks: 0 }),
      },
      (() => {
        const next = nextAudioOverlap(clip);
        const overlap = next ? clip.start_tick + clip.length_ticks - next.start_tick : 0;
        return {
          label: next ? `Crossfade ${ticksToSteps(overlap)} steps with next clip` : 'Crossfade needs an overlapping next clip',
          disabled: !next,
          onClick: () => {
            if (!next) return;
            patchProject((p) => {
              const current = p.audioClips.find((c) => c.id === clip.id);
              const following = p.audioClips.find((c) => c.id === next.id);
              if (current) current.fade_out = overlap;
              if (following) following.fade_in = overlap;
            });
          },
        };
      })(),
      { separator: true },
      {
        label: 'Split at playhead',
        disabled: transport.step * TICKS_PER_STEP <= clip.start_tick || transport.step * TICKS_PER_STEP >= clip.start_tick + clip.length_ticks,
        onClick: () => splitClipAt(clip.id, transport.step) && hint('Audio clip split at the playhead'),
      },
      { label: 'Delete clip', danger: true, onClick: () => removeAudioClip(clip.id) },
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

  const markerMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const marker = project.markers.find((m) => m.id === id);
    if (!marker) return;
    openMenu(e.clientX, e.clientY, [
      { label: 'Rename marker', onClick: () => { setRenamingMarker(id); setMarkerDraft(marker.name); } },
      { label: 'Move to playhead', onClick: () => updateMarker(id, { start: transport.step }) },
      { label: 'Loop to next marker', onClick: () => loopFromMarker(id) },
      { separator: true },
      { label: 'Delete marker', danger: true, onClick: () => removeMarker(id) },
    ]);
  };

  const selectedPattern = selectedClip ? project.clips.find((c) => c.id === selectedClip) : undefined;
  const selectedAudio = selectedClip ? project.audioClips.find((c) => c.id === selectedClip) : undefined;
  const selectedName = selectedPattern
    ? patternById(project, selectedPattern.pattern)?.name ?? 'Pattern clip'
    : selectedAudio?.name;
  const selectedGain = selectedPattern?.gain ?? selectedAudio?.gain ?? 1;
  const selectedPan = selectedPattern?.pan ?? selectedAudio?.pan ?? 0;
  const selectedFadeIn = selectedPattern ? (selectedPattern.fadeIn ?? 0) : selectedAudio ? ticksToSteps(selectedAudio.fade_in) : 0;
  const selectedFadeOut = selectedPattern ? (selectedPattern.fadeOut ?? 0) : selectedAudio ? ticksToSteps(selectedAudio.fade_out) : 0;
  const selectedFadeMax = selectedPattern?.len ?? (selectedAudio ? ticksToSteps(selectedAudio.length_ticks) : 0);
  const sourceDurationTicksFor = (clip: AudioClip) => {
    const buffer = getSampleBuffer(clip.sample_id);
    return buffer ? Math.round(secondsToTicks(buffer.duration, project.bpm)) : Number.MAX_SAFE_INTEGER;
  };
  const selectedSlip = selectedAudio ? Number((((selectedAudio.source_offset_ticks ?? 0) / TICKS_PER_STEP).toFixed(2))) : 0;
  const selectedSlipMax = selectedAudio
    ? ticksToSteps(clampSourceOffset(Number.MAX_SAFE_INTEGER, selectedAudio.length_ticks, sourceDurationTicksFor(selectedAudio)))
    : 0;
  const setSelectedSlip = (value: number) => {
    if (!selectedAudio || !Number.isFinite(value)) return;
    const offset = clampSourceOffset(value * TICKS_PER_STEP, selectedAudio.length_ticks, sourceDurationTicksFor(selectedAudio));
    updateAudioClip(selectedAudio.id, { source_offset_ticks: offset }, `inspector:${selectedAudio.id}:slip`);
  };
  const selectedCanSplit = selectedPattern
    ? transport.step > selectedPattern.start && transport.step < selectedPattern.start + selectedPattern.len
    : selectedAudio
      ? transport.step * TICKS_PER_STEP > selectedAudio.start_tick &&
        transport.step * TICKS_PER_STEP < selectedAudio.start_tick + selectedAudio.length_ticks
      : false;
  const splitSelected = () => {
    if (!selectedClip || !selectedCanSplit) return;
    if (splitClipAt(selectedClip, transport.step)) hint('Clip split at the playhead');
  };
  const setSelectedGain = (value: number) => {
    if (selectedPattern) updateClip(selectedPattern.id, { gain: value }, `inspector:${selectedPattern.id}:gain`);
    else if (selectedAudio) updateAudioClip(selectedAudio.id, { gain: value }, `inspector:${selectedAudio.id}:gain`);
  };
  const setSelectedPan = (value: number) => {
    if (selectedPattern) updateClip(selectedPattern.id, { pan: value }, `inspector:${selectedPattern.id}:pan`);
    else if (selectedAudio) updateAudioClip(selectedAudio.id, { pan: value }, `inspector:${selectedAudio.id}:pan`);
  };
  const setSelectedFade = (edge: 'in' | 'out', value: number) => {
    if (selectedPattern) {
      updateClip(selectedPattern.id, edge === 'in' ? { fadeIn: value } : { fadeOut: value }, `inspector:${selectedPattern.id}:fade-${edge}`);
    } else if (selectedAudio) {
      updateAudioClip(
        selectedAudio.id,
        edge === 'in' ? { fade_in: Math.round(value * TICKS_PER_STEP) } : { fade_out: Math.round(value * TICKS_PER_STEP) },
        `inspector:${selectedAudio.id}:fade-${edge}`,
      );
    }
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
        <button className="tbtn small" disabled={!selectedCanSplit} onClick={splitSelected} title="Split the selected clip at the playhead">
          Split
        </button>
        <button className="tbtn small" onClick={() => addMarker()} title="Add a marker at the playhead (M)">
          <IconPlus size={10} /> Marker
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
        <span className="tiny-note" title="Which engine plays audio clips">
          Playlist audio: Web Audio (desktop native pending). Alt-drag a clip to slip.
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

      {(selectedPattern || selectedAudio) && (
        <div className="clip-inspector" role="region" aria-label={`${selectedName ?? 'Clip'} controls`}>
          <strong>{selectedName}</strong>
          <label>
            Gain
            <input type="range" min={0} max={selectedAudio ? 4 : 2} step={0.01} value={selectedGain} onChange={(e) => setSelectedGain(Number(e.target.value))} />
          </label>
          <label>
            Pan
            <input type="range" min={-1} max={1} step={0.01} value={selectedPan} onChange={(e) => setSelectedPan(Number(e.target.value))} />
          </label>
          <label>
            Fade in
            <input type="number" min={0} max={selectedFadeMax} step={1} value={selectedFadeIn} onChange={(e) => setSelectedFade('in', Math.max(0, Math.min(selectedFadeMax, Number(e.target.value))))} />
          </label>
          <label>
            Fade out
            <input type="number" min={0} max={selectedFadeMax} step={1} value={selectedFadeOut} onChange={(e) => setSelectedFade('out', Math.max(0, Math.min(selectedFadeMax, Number(e.target.value))))} />
          </label>
          {selectedAudio && (
            <>
              <label>
                Slip
                <input
                  type="number"
                  min={0}
                  max={selectedSlipMax}
                  step={0.01}
                  value={selectedSlip}
                  onChange={(e) => setSelectedSlip(Number(e.target.value))}
                  title="Move the source window without moving the clip"
                />
              </label>
              <label className="clip-toggle">
                <input
                  type="checkbox"
                  checked={selectedAudio.reversed === true}
                  onChange={() => updateAudioClip(selectedAudio.id, { reversed: !selectedAudio.reversed })}
                />
                Reverse
              </label>
              <label className="clip-toggle">
                <input
                  type="checkbox"
                  checked={selectedAudio.normalized === true}
                  onChange={() => updateAudioClip(selectedAudio.id, { normalized: !selectedAudio.normalized })}
                />
                Normalize
              </label>
            </>
          )}
          <span className="tiny-note">
            Pattern fades: Rust + Web Audio. Audio-clip fades, reverse, normalize and slip: Web Audio only (live and bounce). Alt-drag an audio clip to slip its source.
          </span>
        </div>
      )}

      <div
        ref={scrollRef}
        className={`pl-scroll ${dragging ? 'dragging' : ''} ${autoEdge ? `auto-${autoEdge}` : ''}`}
      >
        <div className="pl-inner" style={{ width: HEAD + width }}>
          <div
            className={`pl-ruler ${dragging === 'playhead' ? 'dragging' : ''}`}
            style={{ marginLeft: HEAD, width }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              if ((e.target as HTMLElement).closest('.loop-region, .loop-handle')) return;
              const rect = e.currentTarget.getBoundingClientRect();
              seek(Math.max(0, snapStep((e.clientX - rect.left) / zoom)));
              beginDrag(e, { kind: 'playhead', startX: e.clientX, rulerLeft: rect.left });
            }}
            title="Click or drag to move the playhead"
          >
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
              className={`loop-region ${dragging === 'loop-move' ? 'dragging' : ''}`}
              style={{ left: project.loopStart * zoom, width: Math.max(2, (project.loopEnd - project.loopStart) * zoom) }}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                pushHistory();
                beginDrag(e, {
                  kind: 'loop-move',
                  startX: e.clientX,
                  origStart: project.loopStart,
                  origEnd: project.loopEnd,
                });
              }}
              title="Drag to slide the loop bar, or grab an edge to resize it"
            />
            <div
              className={`loop-handle ${dragging === 'loop' ? 'dragging' : ''}`}
              style={{ left: project.loopStart * zoom, borderRadius: '2px 0 0 2px' }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                pushHistory();
                beginDrag(e, { kind: 'loop', edge: 'start', startX: e.clientX, orig: project.loopStart });
              }}
              title="Drag the loop start"
            />
            <div
              className={`loop-handle ${dragging === 'loop' ? 'dragging' : ''}`}
              style={{ left: project.loopEnd * zoom - 7, borderRadius: '0 2px 2px 0' }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                pushHistory();
                beginDrag(e, { kind: 'loop', edge: 'end', startX: e.clientX, orig: project.loopEnd });
              }}
              title="Drag the loop end"
            />
            {(dragging === 'loop' || dragging === 'loop-move') && (
              <div
                className="loop-readout"
                style={{ left: Math.max(0, Math.min(project.loopStart * zoom - 4, width - 128)) }}
              >
                Bars {Math.floor(project.loopStart / barSteps) + 1}–
                {Math.max(1, Math.ceil(project.loopEnd / barSteps))}
              </div>
            )}
            <div
              className={`playhead-head ${dragging === 'playhead' ? 'dragging' : ''}`}
              style={{ left: transport.step * zoom, top: 2, position: 'absolute' }}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                const ruler = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                beginDrag(e, { kind: 'playhead', startX: e.clientX, rulerLeft: ruler.left });
              }}
              title="Drag the playhead"
            />
            {dragging === 'playhead' && (
              <div
                className="playhead-readout"
                style={{ left: Math.max(0, Math.min(transport.step * zoom - 4, width - 110)) }}
              >
                Bar {Math.floor(transport.step / barSteps) + 1} · Beat{' '}
                {Math.floor((transport.step % barSteps) / 4) + 1}
              </div>
            )}
          </div>

          <div className="pl-marker-lane" style={{ marginLeft: HEAD, width }}>
            {project.markers.map((marker) => (
              <div
                key={marker.id}
                className={`marker-flag ${dragging === 'marker' ? 'dragging' : ''}`}
                style={{ left: marker.start * zoom }}
                title={`${marker.name} — click to jump, drag to move, right-click for loop and rename`}
                onPointerDown={(e) => {
                  if (e.button !== 0 || (e.target as HTMLElement).closest('input')) return;
                  e.stopPropagation();
                  e.preventDefault();
                  pushHistory();
                  seek(marker.start);
                  beginDrag(e, { kind: 'marker', id: marker.id, startX: e.clientX, origStart: marker.start });
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setRenamingMarker(marker.id);
                  setMarkerDraft(marker.name);
                }}
                onContextMenu={(e) => markerMenu(e, marker.id)}
              >
                {renamingMarker === marker.id ? (
                  <input
                    autoFocus
                    value={markerDraft}
                    aria-label="Marker name"
                    onChange={(e) => setMarkerDraft(e.target.value)}
                    onBlur={() => {
                      updateMarker(marker.id, { name: markerDraft.trim() || marker.name });
                      setRenamingMarker(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setRenamingMarker(null);
                      e.stopPropagation();
                    }}
                  />
                ) : (
                  <span>{marker.name}</span>
                )}
              </div>
            ))}
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
                onDragOver={(e) => {
                  const files = e.dataTransfer.types.includes('Files');
                  const sample = e.dataTransfer.types.includes(AUDIO_CLIP_MIME);
                  if (!files && !sample) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = 'copy';
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const rawTick = ((e.clientX - rect.left) / zoom) * TICKS_PER_STEP;
                  const sampleId = sample ? e.dataTransfer.getData(AUDIO_CLIP_MIME) : '';
                  const durationSec = sampleId ? getSampleBuffer(sampleId)?.duration ?? 5 : 5;
                  const ghost = dropGhost(
                    index,
                    rawTick,
                    project.bpm,
                    durationSec,
                    playlistSnapContext({
                      pointerTick: rawTick,
                      playheadTick: transport.step * TICKS_PER_STEP,
                      gridSteps: snap,
                      pixelsPerStep: zoom,
                      neighbourTicks: audioEdgesFor(index),
                    }),
                  );
                  setAudioGhost({
                    track: index,
                    left: ticksToSteps(ghost.startTick) * zoom,
                    width: Math.max(6, ticksToSteps(ghost.lengthTicks) * zoom),
                  });
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget === e.target) setAudioGhost(null);
                }}
                onDrop={(e) => {
                  const sampleId = e.dataTransfer.getData(AUDIO_CLIP_MIME);
                  const files = Array.from(e.dataTransfer.files ?? []).filter(
                    (f) => f.type.startsWith('audio/') || /\.(wav|mp3|ogg|oga|flac|m4a|aiff?|webm)$/i.test(f.name),
                  );
                  setAudioGhost(null);
                  if (!sampleId && !files.length) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const rawTick = ((e.clientX - rect.left) / zoom) * TICKS_PER_STEP;
                  const context = playlistSnapContext({
                    pointerTick: rawTick,
                    playheadTick: transport.step * TICKS_PER_STEP,
                    gridSteps: snap,
                    pixelsPerStep: zoom,
                    neighbourTicks: audioEdgesFor(index),
                  });
                  if (sampleId) {
                    const buffer = getSampleBuffer(sampleId);
                    const ref = getSampleRef(sampleId);
                    if (!buffer || !ref) {
                      hint('That sample is no longer loaded — add it from the browser again');
                      return;
                    }
                    addAudioClip(
                      createAudioClipFromDrop({
                        id: `ac_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                        sampleId,
                        mediaRef: ref,
                        name: getSampleName(sampleId),
                        bpm: project.bpm,
                        durationSec: buffer.duration,
                        track: index,
                        startTick: resolveSnapTick(rawTick, context),
                      }),
                    );
                    return;
                  }
                  void importAudioClipFiles(files, index, resolveSnapTick(rawTick, context));
                }}
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
                {project.markers.map((marker) => (
                  <div
                    key={`line-${marker.id}`}
                    className="marker-line"
                    style={{ left: marker.start * zoom }}
                    aria-hidden
                  />
                ))}
                {project.clips
                  .filter((c) => c.track === index)
                  .map((clip) => {
                    const pat = patternById(project, clip.pattern);
                    const color = pat?.color ?? track.color;
                    const notes = pat ? Object.values(pat.notes).flat() : [];
                    const clipWidth = Math.max(6, clip.len * zoom);
                    return (
                      <div
                        key={clip.id}
                        className={`clip ${selectedClip === clip.id ? 'selected' : ''} ${
                          dragging === 'clip' && selectedClip === clip.id ? 'dragging' : ''
                        } ${dragging === 'resize' && selectedClip === clip.id ? 'resizing' : ''}`}
                        style={{ left: clip.start * zoom, width: clipWidth, ['--clip-color' as string]: color }}
                        title={`${pat?.name ?? 'Pattern'} — drag to move, drag the right edge to resize, double-click to edit`}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return;
                          e.preventDefault();
                          e.stopPropagation();
                          setSelectedClip(clip.id);
                          pushHistory();
                          beginDrag(e, { kind: 'clip', id: clip.id, startX: e.clientX, origStart: clip.start, origLen: clip.len });
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          selectPattern(clip.pattern);
                          setUI({ tab: 'pianoroll' });
                        }}
                        onContextMenu={(e) => clipMenu(e, clip.id)}
                      >
                        <div className="clip-label">{pat?.name ?? 'Pattern'}</div>
                        {(clip.fadeIn ?? 0) > 0 && (
                          <div className="clip-fade clip-fade-in" style={{ width: Math.min(clipWidth, (clip.fadeIn ?? 0) * zoom) }} />
                        )}
                        {(clip.fadeOut ?? 0) > 0 && (
                          <div className="clip-fade clip-fade-out" style={{ width: Math.min(clipWidth, (clip.fadeOut ?? 0) * zoom) }} />
                        )}
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
                        {selectedClip === clip.id && (
                          <>
                            <div
                              className="fade-handle fade-in"
                              style={{ left: Math.max(2, Math.min(clipWidth - 4, (clip.fadeIn ?? 0) * zoom)) }}
                              title="Drag to set fade in (steps)"
                              onPointerDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setSelectedClip(clip.id);
                                pushHistory();
                                beginDrag(e, { kind: 'fade-in', id: clip.id, audio: false, startX: e.clientX, orig: clip.fadeIn ?? 0, len: clip.len });
                              }}
                            />
                            <div
                              className="fade-handle fade-out"
                              style={{ left: Math.max(2, Math.min(clipWidth - 4, clipWidth - (clip.fadeOut ?? 0) * zoom)) }}
                              title="Drag to set fade out (steps)"
                              onPointerDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setSelectedClip(clip.id);
                                pushHistory();
                                beginDrag(e, { kind: 'fade-out', id: clip.id, audio: false, startX: e.clientX, orig: clip.fadeOut ?? 0, len: clip.len });
                              }}
                            />
                          </>
                        )}
                        <div
                          className="clip-resize"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            pushHistory();
                            beginDrag(e, { kind: 'resize', id: clip.id, startX: e.clientX, origLen: clip.len });
                          }}
                        />
                      </div>
                    );
                  })}
                {project.audioClips
                  .filter((clip) => clip.track === index)
                  .map((clip) => {
                    const width = Math.max(6, ticksToSteps(clip.length_ticks) * zoom);
                    return (
                      <div
                        key={clip.id}
                        className={`clip audio-clip ${selectedClip === clip.id ? 'selected' : ''} ${
                          dragging === 'audio-clip' && selectedClip === clip.id ? 'dragging' : ''
                        }`}
                        style={{
                          left: ticksToSteps(clip.start_tick) * zoom,
                          width,
                          ['--clip-color' as string]: '#4cc9f0',
                        }}
                        title={`${clip.name} — Web Audio clip (native playback pending). Drag to move, drag the SLIP grip to slip the source; right-click for gain, pan, loop, reverse and normalize.`}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return;
                          e.preventDefault();
                          e.stopPropagation();
                          setSelectedClip(clip.id);
                          pushHistory();
                          if (e.altKey) {
                            beginDrag(e, {
                              kind: 'audio-slip',
                              id: clip.id,
                              startX: e.clientX,
                              origOffset: clip.source_offset_ticks ?? 0,
                              lengthTicks: clip.length_ticks,
                              sourceDurationTicks: sourceDurationTicksFor(clip),
                            });
                            return;
                          }
                          beginDrag(e, {
                            kind: 'audio-clip',
                            id: clip.id,
                            track: clip.track,
                            startX: e.clientX,
                            origStartTick: clip.start_tick,
                          });
                        }}
                        onContextMenu={(e) => audioClipMenu(e, clip.id)}
                      >
                        <div className="clip-label">
                          {clip.name}
                          {clip.reversed ? ' · REV' : ''}
                          {clip.normalized ? ' · NORM' : ''}
                        </div>
                        {clip.fade_in > 0 && (
                          <div className="clip-fade clip-fade-in" style={{ width: Math.min(width, ticksToSteps(clip.fade_in) * zoom) }} />
                        )}
                        {clip.fade_out > 0 && (
                          <div className="clip-fade clip-fade-out" style={{ width: Math.min(width, ticksToSteps(clip.fade_out) * zoom) }} />
                        )}
                        <AudioClipWave clip={clip} width={width} bpm={project.bpm} />
                        <div
                          className="slip-handle"
                          role="slider"
                          tabIndex={0}
                          aria-label="Slip source audio"
                          aria-orientation="horizontal"
                          aria-valuemin={0}
                          aria-valuemax={ticksToSteps(clampSourceOffset(Number.MAX_SAFE_INTEGER, clip.length_ticks, sourceDurationTicksFor(clip)))}
                          aria-valuenow={ticksToSteps(clip.source_offset_ticks ?? 0)}
                          aria-valuetext={`${ticksToSteps(clip.source_offset_ticks ?? 0)} steps`}
                          title="Drag to slip the source audio (arrow keys for fine steps)"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setSelectedClip(clip.id);
                            pushHistory();
                            beginDrag(e, {
                              kind: 'audio-slip',
                              id: clip.id,
                              startX: e.clientX,
                              origOffset: clip.source_offset_ticks ?? 0,
                              lengthTicks: clip.length_ticks,
                              sourceDurationTicks: sourceDurationTicksFor(clip),
                            });
                          }}
                          onKeyDown={(e) => {
                            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                            e.preventDefault();
                            e.stopPropagation();
                            const direction = e.key === 'ArrowRight' ? 1 : -1;
                            const offset = clampSourceOffset(
                              (clip.source_offset_ticks ?? 0) + direction * TICKS_PER_STEP,
                              clip.length_ticks,
                              sourceDurationTicksFor(clip),
                            );
                            if (offset === (clip.source_offset_ticks ?? 0)) return;
                            pushHistory();
                            updateAudioClip(clip.id, { source_offset_ticks: offset }, `slip:${clip.id}`);
                          }}
                        >
                          <span aria-hidden="true">↔</span> SLIP
                        </div>
                        {selectedClip === clip.id && (
                          <>
                            <div
                              className="fade-handle fade-in"
                              style={{ left: Math.max(2, Math.min(width - 4, ticksToSteps(clip.fade_in) * zoom)) }}
                              title="Drag to set audio fade in"
                              onPointerDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setSelectedClip(clip.id);
                                pushHistory();
                                beginDrag(e, { kind: 'fade-in', id: clip.id, audio: true, startX: e.clientX, orig: clip.fade_in, len: clip.length_ticks });
                              }}
                            />
                            <div
                              className="fade-handle fade-out"
                              style={{ left: Math.max(2, Math.min(width - 4, width - ticksToSteps(clip.fade_out) * zoom)) }}
                              title="Drag to set audio fade out"
                              onPointerDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setSelectedClip(clip.id);
                                pushHistory();
                                beginDrag(e, { kind: 'fade-out', id: clip.id, audio: true, startX: e.clientX, orig: clip.fade_out, len: clip.length_ticks });
                              }}
                            />
                          </>
                        )}
                      </div>
                    );
                  })}
                {audioGhost && audioGhost.track === index && (
                  <div
                    className="clip audio-clip ghost"
                    style={{
                      left: audioGhost.left,
                      width: audioGhost.width,
                      opacity: 0.45,
                      pointerEvents: 'none',
                      ['--clip-color' as string]: '#4cc9f0',
                    }}
                  />
                )}
              </div>
            </div>
          ))}

          <div
            className={`playhead-line ${dragging === 'playhead' ? 'dragging' : ''}`}
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
        <span>drag the playhead or the orange loop bar in the ruler</span>
      </div>
    </div>
  );
}
