/**
 * Standard MIDI File (SMF) import/export.
 *
 * SMF type 1 is the interchange every DAW understands: FL Studio, Ableton,
 * Logic, Cubase, Studio One, Bitwig and REAPER all import it as separate
 * tracks. Only musical data travels — notes, tempo, track names and program
 * changes — not devices, automation or audio.
 */
import { clamp, type ExchangeNote, type ExchangeSong, type ExchangeTrack } from './types';

const PPQ = 96;
const FOUR_OH_FOUR = [4, 2, 24, 8];

function textBytes(value: string): number[] {
  return Array.from(new TextEncoder().encode(value));
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function u16(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function ascii(value: string): number[] {
  return Array.from(value, (c) => c.charCodeAt(0));
}

function chunk(id: string, data: number[]): number[] {
  return [...ascii(id), ...u32(data.length), ...data];
}

function varint(value: number): number[] {
  let v = Math.max(0, Math.round(value));
  const out = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    out.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return out;
}

function meta(type: number, payload: number[]): number[] {
  return [0xff, type, ...varint(payload.length), ...payload];
}

interface TimedEvent {
  tick: number;
  /** Note-offs sort before note-ons at the same tick. */
  order: number;
  bytes: number[];
}

function encodeTrack(events: TimedEvent[]): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const out: number[] = [];
  let last = 0;
  for (const event of sorted) {
    const delta = Math.max(0, event.tick - last);
    last = event.tick;
    out.push(...varint(delta), ...event.bytes);
  }
  out.push(...varint(0), ...meta(0x2f, []));
  return out;
}

/** Steps (16ths) → MIDI ticks at our fixed 96 PPQ. */
function stepToTick(step: number): number {
  return Math.round((step * PPQ) / 4);
}

export function writeMidi(song: ExchangeSong): Uint8Array {
  const tempo = Math.round(60_000_000 / clamp(song.bpm, 20, 300));
  const tempoTrack = encodeTrack([
    { tick: 0, order: 0, bytes: meta(0x03, textBytes(song.name.slice(0, 120))) },
    { tick: 0, order: 0, bytes: meta(0x51, [(tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff]) },
    { tick: 0, order: 0, bytes: meta(0x58, FOUR_OH_FOUR) },
  ]);

  const tracks: number[][] = [chunk('MTrk', tempoTrack)];

  song.tracks.forEach((track, index) => {
    if (!track.notes.length) return;
    const channel = index % 16;
    const events: TimedEvent[] = [
      { tick: 0, order: 2, bytes: meta(0x03, textBytes(track.name.slice(0, 120))) },
    ];
    if (typeof track.program === 'number') {
      events.push({ tick: 0, order: 2, bytes: [0xc0 | channel, clamp(track.program, 0, 127)] });
    }
    for (const note of track.notes) {
      const pitch = clamp(Math.round(note.pitch), 0, 127);
      const start = stepToTick(note.start);
      const end = stepToTick(note.start + Math.max(1 / 16, note.len));
      const velocity = clamp(Math.round(note.vel * 127), 1, 127);
      events.push({ tick: start, order: 3, bytes: [0x90 | channel, pitch, velocity] });
      events.push({ tick: end, order: 1, bytes: [0x80 | channel, pitch, 0] });
    }
    tracks.push(chunk('MTrk', encodeTrack(events)));
  });

  const header = [...ascii('MThd'), ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(PPQ)];
  return new Uint8Array([...header, ...tracks.flat()]);
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

class Reader {
  pos = 0;
  constructor(readonly bytes: Uint8Array) {}
  get done(): boolean {
    return this.pos >= this.bytes.length;
  }
  u8(): number {
    return this.bytes[this.pos++] ?? 0;
  }
  u16(): number {
    return (this.u8() << 8) | this.u8();
  }
  u32(): number {
    return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
  }
  varint(): number {
    let value = 0;
    for (let i = 0; i < 4; i += 1) {
      const byte = this.u8();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) break;
    }
    return value;
  }
  take(n: number): number[] {
    const out = Array.from(this.bytes.slice(this.pos, this.pos + n));
    this.pos += n;
    return out;
  }
  string(n: number): string {
    return new TextDecoder().decode(new Uint8Array(this.take(n)));
  }
}

interface ParsedTrack {
  name: string;
  events: { tick: number; channel: number; pitch: number; velocity: number; on: boolean }[];
}

function parseTrack(reader: Reader): ParsedTrack {
  let tick = 0;
  let running = 0;
  let name = '';
  const events: ParsedTrack['events'] = [];
  while (!reader.done) {
    tick += reader.varint();
    let status = reader.u8();
    if (status < 0x80) {
      if (!running) break;
      status = running;
      reader.pos -= 1;
    }
    if (status === 0xff) {
      const type = reader.u8();
      const length = reader.varint();
      const payload = reader.take(length);
      if (type === 0x03) name = new TextDecoder().decode(new Uint8Array(payload)).trim();
      if (type === 0x2f) break;
      continue;
    }
    if (status === 0xf0 || status === 0xf7) {
      reader.take(reader.varint());
      continue;
    }
    if (status >= 0xf0) {
      // System common messages are not needed for a song import.
      if (status === 0xf2) reader.take(2);
      else if (status !== 0xf6) reader.take(1);
      continue;
    }
    running = status;
    const command = status & 0xf0;
    const channel = status & 0x0f;
    const data1 = reader.u8();
    const data2 = command === 0xc0 || command === 0xd0 ? 0 : reader.u8();
    if (command === 0x90) events.push({ tick, channel, pitch: data1, velocity: data2, on: data2 > 0 });
    else if (command === 0x80) events.push({ tick, channel, pitch: data1, velocity: 0, on: false });
  }
  return { name, events };
}

function notesFromEvents(events: ParsedTrack['events']): ExchangeNote[] {
  const open = new Map<string, { tick: number; vel: number }[]>();
  const notes: ExchangeNote[] = [];
  let maxTick = 0;
  for (const event of events) {
    maxTick = Math.max(maxTick, event.tick);
    if (event.on) {
      const key = `${event.channel}:${event.pitch}`;
      const queue = open.get(key) ?? [];
      queue.push({ tick: event.tick, vel: event.velocity });
      open.set(key, queue);
    } else {
      const key = `${event.channel}:${event.pitch}`;
      const queue = open.get(key);
      const start = queue?.shift();
      if (start) {
        notes.push({
          pitch: event.pitch,
          start: (start.tick / PPQ) * 4,
          len: Math.max(1 / 16, ((event.tick - start.tick) / PPQ) * 4),
          vel: clamp(start.vel / 127, 0.05, 1),
        });
      }
    }
  }
  for (const queue of open.values()) {
    for (const start of queue) {
      notes.push({
        pitch: 0,
        start: (start.tick / PPQ) * 4,
        len: Math.max(1 / 16, ((maxTick - start.tick) / PPQ) * 4),
        vel: clamp(start.vel / 127, 0.05, 1),
      });
    }
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return notes;
}

export function parseMidi(input: ArrayBuffer | Uint8Array): ExchangeSong {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const reader = new Reader(bytes);
  if (reader.string(4) !== 'MThd') throw new Error('Not a Standard MIDI File');
  const headerLength = reader.u32();
  const format = reader.u16();
  const trackCount = reader.u16();
  const division = reader.u16();
  reader.take(Math.max(0, headerLength - 6));
  if (division & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported');

  let bpm = 120;
  const parsed: ParsedTrack[] = [];
  for (let i = 0; i < trackCount && !reader.done; i += 1) {
    const id = reader.string(4);
    const length = reader.u32();
    const end = reader.pos + length;
    if (id !== 'MTrk') {
      reader.pos = end;
      continue;
    }
    const trackReader = new Reader(bytes.subarray(reader.pos, end));
    const track = parseTrack(trackReader);
    // The first track carries tempo. Parse it for the meta event even when it has no notes.
    if (i === 0) {
      const tr = new Reader(bytes.subarray(reader.pos, end));
      // Re-scan only for tempo without consuming the parsed notes.
      let tick = 0;
      let running = 0;
      while (!tr.done) {
        tick += tr.varint();
        let status = tr.u8();
        if (status < 0x80) {
          if (!running) break;
          status = running;
          tr.pos -= 1;
        }
        if (status === 0xff) {
          const type = tr.u8();
          const metaLength = tr.varint();
          const payload = tr.take(metaLength);
          if (type === 0x51 && payload.length >= 3) {
            const micros = (payload[0] << 16) | (payload[1] << 8) | payload[2];
            if (micros > 0) bpm = 60_000_000 / micros;
          }
        } else if (status >= 0xf0) {
          if (status === 0xf0 || status === 0xf7) tr.take(tr.varint());
          else if (status === 0xf2) tr.take(2);
          else if (status !== 0xf6) tr.take(1);
        } else {
          running = status;
          const command = status & 0xf0;
          tr.take(command === 0xc0 || command === 0xd0 ? 1 : 2);
        }
      }
    }
    parsed.push(track);
    reader.pos = end;
  }

  const tracks: ExchangeTrack[] = [];
  if (format === 0) {
    const byChannel = new Map<number, ParsedTrack['events']>();
    for (const track of parsed) {
      for (const event of track.events) {
        const list = byChannel.get(event.channel) ?? [];
        list.push(event);
        byChannel.set(event.channel, list);
      }
    }
    [...byChannel.entries()]
      .sort((a, b) => a[0] - b[0])
      .forEach(([channel, events]) => {
        const notes = notesFromEvents(events);
        if (notes.length) tracks.push({ name: `MIDI Channel ${channel + 1}`, notes });
      });
  } else {
    parsed.forEach((track, index) => {
      const notes = notesFromEvents(track.events);
      if (notes.length) tracks.push({ name: track.name || `Track ${index + 1}`, notes });
    });
  }

  if (!tracks.length) throw new Error('This MIDI file contains no notes');
  return {
    name: 'Imported MIDI',
    bpm: clamp(Math.round(bpm * 10) / 10, 20, 300),
    tracks,
    source: 'midi',
  };
}
