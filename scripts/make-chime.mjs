#!/usr/bin/env node
// Writes src-tauri/assets/chime.wav: a short three-note startup chime.
// Deterministic, so re-running it produces an identical asset.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rate = 44_100;
const channels = 2;
const seconds = 1.25;
const frames = Math.round(rate * seconds);
const notes = [
  { hz: 1046.5, at: 0.0, gain: 0.5 },
  { hz: 1318.5, at: 0.1, gain: 0.45 },
  { hz: 1568.0, at: 0.2, gain: 0.4 },
];

const left = new Float32Array(frames);
const right = new Float32Array(frames);

for (const note of notes) {
  const start = Math.round(note.at * rate);
  for (let i = start; i < frames; i += 1) {
    const t = (i - start) / rate;
    const attack = Math.min(1, t / 0.006);
    const decay = Math.exp(-t * 2.6);
    const wobble = 1 + 0.12 * Math.sin(2 * Math.PI * 4.5 * t) * Math.exp(-t * 3);
    const sample = Math.sin(2 * Math.PI * note.hz * t) * attack * decay * note.gain * wobble;
    left[i] += sample * 0.95;
    right[i] += sample * (0.95 - 0.08);
  }
}

// A gentle fade-out removes any click at the end of the file.
const fade = Math.round(rate * 0.08);
for (let i = 0; i < fade; i += 1) {
  const g = i / fade;
  left[frames - 1 - i] *= g;
  right[frames - 1 - i] *= g;
}

let peak = 0;
for (let i = 0; i < frames; i += 1) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
const norm = peak > 0 ? 0.42 / peak : 1;

const dataBytes = frames * channels * 2;
const buffer = Buffer.alloc(44 + dataBytes);
buffer.write('RIFF', 0, 'ascii');
buffer.writeUInt32LE(36 + dataBytes, 4);
buffer.write('WAVE', 8, 'ascii');
buffer.write('fmt ', 12, 'ascii');
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20);
buffer.writeUInt16LE(channels, 22);
buffer.writeUInt32LE(rate, 24);
buffer.writeUInt32LE(rate * channels * 2, 28);
buffer.writeUInt16LE(channels * 2, 32);
buffer.writeUInt16LE(16, 34);
buffer.write('data', 36, 'ascii');
buffer.writeUInt32LE(dataBytes, 40);

let offset = 44;
for (let i = 0; i < frames; i += 1) {
  for (const channel of [left, right]) {
    const value = Math.max(-1, Math.min(1, channel[i] * norm));
    buffer.writeInt16LE(Math.round(value * 32767), offset);
    offset += 2;
  }
}

const target = resolve(dirname(fileURLToPath(import.meta.url)), '../src-tauri/crates/openbeats-audio/assets/chime.wav');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, buffer);
console.log(`wrote ${target} (${buffer.length} bytes, peak ${(norm * peak).toFixed(2)})`);
