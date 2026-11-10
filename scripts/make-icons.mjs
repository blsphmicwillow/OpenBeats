#!/usr/bin/env node
/**
 * Generates the desktop icon set (PNG, ICO, ICNS) from scratch so the repo has
 * no binary art dependencies. Run with `npm run icons`.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve('src-tauri/icons');
mkdirSync(OUT, { recursive: true });

const ACCENT = [0xff, 0xa3, 0x1a];
const BG = [0x15, 0x15, 0x16];
const PANEL = [0x24, 0x24, 0x26];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const radius = size * 0.22;
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const dx = Math.max(radius - x, x - (size - radius), 0);
      const dy = Math.max(radius - y, y - (size - radius), 0);
      const inside = Math.hypot(dx, dy) <= radius;
      const edge = Math.hypot(dx, dy) > radius - size * 0.012 && Math.hypot(dx, dy) <= radius;
      let r = PANEL[0];
      let g = PANEL[1];
      let b = PANEL[2];
      let a = inside ? 255 : 0;
      if (!inside) {
        raw[i] = 0; raw[i + 1] = 0; raw[i + 2] = 0; raw[i + 3] = 0;
        continue;
      }
      if (edge) {
        r = ACCENT[0]; g = ACCENT[1]; b = ACCENT[2];
      } else {
        // Five waveform bars, symmetric around the centre.
        const bars = [0.30, 0.52, 0.78, 0.5, 0.34];
        const barW = size * 0.085;
        const gap = size * 0.035;
        const totalW = bars.length * barW + (bars.length - 1) * gap;
        const startX = (size - totalW) / 2;
        for (let k = 0; k < bars.length; k += 1) {
          const bx = startX + k * (barW + gap);
          const h = size * bars[k] * 0.62;
          const top = (size - h) / 2;
          if (x >= bx && x <= bx + barW && y >= top && y <= top + h) {
            r = ACCENT[0]; g = ACCENT[1]; b = ACCENT[2];
          }
        }
        if (Math.hypot(x - size / 2, y - size / 2) < size * 0.36 && Math.hypot(x - size / 2, y - size / 2) > size * 0.345) {
          r = ACCENT[0]; g = ACCENT[1]; b = ACCENT[2];
        }
      }
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function ico(png256) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = 0;
  entry[1] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png256.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png256]);
}

function icns(images) {
  const entries = Object.entries(images).map(([type, data]) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 4, 'ascii');
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const body = Buffer.concat(entries);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 4, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

const sizes = [32, 64, 128, 256, 512, 1024];
const images = new Map();
for (const s of sizes) images.set(s, png(s));

for (const s of sizes) writeFileSync(resolve(OUT, `${s}x${s}.png`), images.get(s));
writeFileSync(resolve(OUT, '32x32.png'), images.get(32));
writeFileSync(resolve(OUT, '128x128.png'), images.get(128));
writeFileSync(resolve(OUT, '128x128@2x.png'), images.get(256));
writeFileSync(resolve(OUT, 'icon.png'), images.get(1024));
writeFileSync(resolve(OUT, 'icon.ico'), ico(images.get(256)));
writeFileSync(resolve(OUT, 'icon.icns'), icns({ ic09: images.get(512), ic10: images.get(1024) }));
console.log(`icons written to ${dirname(resolve(OUT, 'icon.png'))}`);
