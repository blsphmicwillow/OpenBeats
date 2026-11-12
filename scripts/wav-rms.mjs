#!/usr/bin/env node
/**
 * Assert that a WAV file actually contains audio.
 *
 * Used by the audio smoke job after capturing a null-sink monitor: a successful
 * capture of silence is the exact failure this is meant to catch, so the check
 * is RMS against a threshold rather than "the file exists".
 *
 * Usage: node scripts/wav-rms.mjs <file.wav> [threshold]
 */
import { readFileSync } from 'node:fs';

const [file, rawThreshold] = process.argv.slice(2);
const threshold = Number(rawThreshold ?? 0.001);

if (!file) {
  console.error('usage: wav-rms.mjs <file.wav> [threshold]');
  process.exit(2);
}

const bytes = readFileSync(file);
const ascii = (offset, length) => bytes.subarray(offset, offset + length).toString('latin1');

if (ascii(0, 4) !== 'RIFF' || ascii(8, 12) !== 'WAVE') {
  console.error(`${file} is not a RIFF/WAVE file`);
  process.exit(2);
}

// Walk the chunk list rather than assuming a 44-byte header: pw-record writes
// extra chunks before `data`.
let offset = 12;
let format = null;
while (offset + 8 <= bytes.length) {
  const id = ascii(offset, 4);
  const size = bytes.readUInt32LE(offset + 4);
  const body = offset + 8;
  if (id === 'fmt ') {
    format = {
      code: bytes.readUInt16LE(body),
      channels: bytes.readUInt16LE(body + 2),
      rate: bytes.readUInt32LE(body + 4),
      bits: bytes.readUInt16LE(body + 14),
    };
  } else if (id === 'data') {
    if (!format) break;
    const width = Math.max(1, format.bits / 8);
    const frames = Math.floor(size / (width * Math.max(1, format.channels)));
    const count = frames * Math.max(1, format.channels);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < count; i += 1) {
      const at = body + i * width;
      if (at + width > bytes.length) break;
      let value;
      if (format.bits === 8) value = (bytes[at] - 128) / 128;
      else if (format.bits === 16) value = bytes.readInt16LE(at) / 32768;
      else if (format.bits === 24) value = bytes.readIntLE(at, 3) / 8388608;
      else if (format.bits === 32) value = bytes.readInt32LE(at) / 2147483648;
      else value = 0;
      sum += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
    const rms = count > 0 ? Math.sqrt(sum / count) : 0;
    console.log(
      JSON.stringify({
        file,
        channels: format.channels,
        rate: format.rate,
        bits: format.bits,
        frames,
        seconds: Number((frames / Math.max(1, format.rate)).toFixed(3)),
        peak: Number(peak.toFixed(5)),
        rms: Number(rms.toFixed(5)),
        threshold,
      }),
    );
    if (frames === 0) {
      console.error('the capture has no frames');
      process.exit(1);
    }
    if (rms < threshold) {
      console.error(`captured RMS ${rms.toFixed(5)} is below the ${threshold} threshold`);
      process.exit(1);
    }
    process.exit(0);
  }
  offset = body + size + (size % 2);
}

console.error('no fmt/data chunk found');
process.exit(2);
