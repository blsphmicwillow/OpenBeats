/**
 * REAPER project (.rpp) import/export.
 *
 * RPP is a plain-text, indented chunk format. We handle the musical core:
 * tempo, tracks, MIDI items and note events at 960 ticks per quarter note.
 */
import { clamp, type ExchangeMarker, type ExchangeNote, type ExchangeSong, type ExchangeTrack } from './types';

const PPQ = 960;

function secondsPerStep(bpm: number): number {
  return 60 / clamp(bpm, 20, 300) / 4;
}

function event(status: number, data1: number, data2: number): string {
  return `${status.toString(16).toUpperCase()} ${data1.toString(16).toUpperCase().padStart(2, '0')} ${data2
    .toString(16)
    .toUpperCase()
    .padStart(2, '0')}`;
}

export function writeRpp(song: ExchangeSong): string {
  const bpm = clamp(song.bpm, 20, 300);
  const sps = secondsPerStep(bpm);
  const lines: string[] = ['<REAPER_PROJECT 0.1 "7.0" 0', `  TEMPO ${bpm} 4 4`, '  MASTER_FX 1'];

  (song.markers ?? []).forEach((marker, index) => {
    const name = marker.name.replace(/"/g, "'").slice(0, 64);
    lines.push(
      `  MARKER ${index + 1} ${(Math.max(0, marker.start) * sps).toFixed(6)} "${name}" 0 0 1 B`,
    );
  });

  for (const track of song.tracks) {
    if (!track.notes.length) continue;
    const endStep = Math.max(...track.notes.map((n) => n.start + n.len));
    const length = Math.max(1, endStep * sps);
    lines.push('  <TRACK', `    NAME "${track.name.replace(/"/g, "'")}"`, '    <ITEM', '      POSITION 0', `      LENGTH ${length.toFixed(6)}`, '      <SOURCE MIDI', '        HASDATA 1 960 QN');
    const events: { tick: number; order: number; line: string }[] = [];
    for (const note of track.notes) {
      const pitch = clamp(Math.round(note.pitch), 0, 127);
      const start = Math.round(note.start * (PPQ / 4));
      const end = Math.round((note.start + Math.max(1 / 16, note.len)) * (PPQ / 4));
      const velocity = clamp(Math.round(note.vel * 127), 1, 127);
      events.push({ tick: start, order: 2, line: event(0x90, pitch, velocity) });
      events.push({ tick: end, order: 1, line: event(0x80, pitch, 0) });
    }
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);
    let last = 0;
    for (const e of events) {
      lines.push(`        E ${e.tick - last} ${e.line}`);
      last = e.tick;
    }
    lines.push('      >', '    >', '  >');
  }
  lines.push('>');
  return `${lines.join('\n')}\n`;
}

export function parseRpp(text: string): ExchangeSong {
  const lines = text.split(/\r?\n/);
  const tempoMatch = lines.find((l) => /^\s*TEMPO\s+/i.test(l));
  const bpm = clamp(tempoMatch ? Number(tempoMatch.trim().split(/\s+/)[1]) || 120 : 120, 20, 300);
  const sps = secondsPerStep(bpm);

  const tracks: ExchangeTrack[] = [];
  const markers: ExchangeMarker[] = [];
  let depth = 0;
  let trackDepth = -1;
  let itemDepth = -1;
  let sourceDepth = -1;
  let currentName = '';
  let currentPosition = 0;
  let open = new Map<number, { tick: number; pitch: number; vel: number }[]>();
  let closed: ExchangeNote[] = [];
  let ticks = 0;

  const flushNotes = () => {
    const notes: ExchangeNote[] = [...closed];
    for (const [pitch, queue] of open) {
      for (const start of queue) {
        notes.push({
          pitch,
          start: start.tick / (PPQ / 4),
          len: Math.max(1 / 16, (ticks - start.tick) / (PPQ / 4)),
          vel: clamp(start.vel / 127, 0.05, 1),
        });
      }
    }
    open = new Map();
    closed = [];
    return notes;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('<')) {
      depth += 1;
      const tag = line.slice(1).split(/\s+/)[0].toUpperCase();
      if (tag === 'TRACK') {
        trackDepth = depth;
        currentName = '';
      } else if (tag === 'ITEM' && trackDepth >= 0) {
        itemDepth = depth;
        currentPosition = 0;
      } else if (tag === 'SOURCE' && itemDepth >= 0) {
        sourceDepth = depth;
        ticks = 0;
        open = new Map();
        closed = [];
      }
      continue;
    }
    if (line === '>') {
      if (sourceDepth === depth && sourceDepth >= 0) {
        // Notes are closed when the item ends.
      }
      if (itemDepth === depth && itemDepth >= 0) {
        const notes = flushNotes();
        if (currentPosition > 0) for (const n of notes) n.start += currentPosition / sps;
        if (notes.length) tracks.push({ name: currentName || `Track ${tracks.length + 1}`, notes });
        itemDepth = -1;
      }
      if (trackDepth === depth && trackDepth >= 0) trackDepth = -1;
      depth -= 1;
      continue;
    }

    const upper = line.toUpperCase();
    if (depth === 1 && upper.startsWith('MARKER ')) {
      const match = line.match(/^MARKER\s+\d+\s+([\d.]+)\s+"([^"]*)"/i);
      if (match) {
        markers.push({
          name: match[2].slice(0, 64) || `Marker ${markers.length + 1}`,
          start: Math.max(0, (Number(match[1]) || 0) / sps),
        });
      }
    }
    if (trackDepth === depth && upper.startsWith('NAME ')) {
      currentName = line.slice(5).trim().replace(/^"|"$/g, '');
    }
    if (itemDepth === depth && upper.startsWith('POSITION ')) {
      currentPosition = Number(line.split(/\s+/)[1]) || 0;
    }
    if (sourceDepth === depth && upper.startsWith('E ')) {
      const parts = line.split(/\s+/);
      const delta = Number(parts[1]) || 0;
      ticks += delta;
      const status = parseInt(parts[2] ?? '0', 16);
      const data1 = parseInt(parts[3] ?? '0', 16);
      const data2 = parseInt(parts[4] ?? '0', 16);
      const command = status & 0xf0;
      if (command === 0x90 && data2 > 0) {
        const queue = open.get(data1) ?? [];
        queue.push({ tick: ticks, pitch: data1, vel: data2 });
        open.set(data1, queue);
      } else if (command === 0x80 || command === 0x90) {
        const start = open.get(data1)?.shift();
        if (start) {
          closed.push({
            pitch: data1,
            start: start.tick / (PPQ / 4),
            len: Math.max(1 / 16, (ticks - start.tick) / (PPQ / 4)),
            vel: clamp(start.vel / 127, 0.05, 1),
          });
        }
      }
    }
  }

  if (!tracks.length) throw new Error('No MIDI items were found in this REAPER project');
  return { name: 'Imported REAPER project', bpm, tracks, markers, source: 'rpp' };
}
