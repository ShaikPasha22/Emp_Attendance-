// Generates the PWA PNG icons (clock glyph on brand colour) with no image dependencies.
// Usage: node scripts/generate-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const BRAND = [79, 70, 229];
const WHITE = [255, 255, 255];
const outDir = path.resolve('apps/web/public/icons');
mkdirSync(outDir, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, { rounded, glyphScale }) {
  const SS = 4; // supersampling for anti-aliasing
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const c = size / 2;
  const radius = rounded ? size * 0.22 : 0;
  const ringR = size * 0.3 * glyphScale;
  const ringW = size * 0.075 * glyphScale;
  const handW = size * 0.075 * glyphScale;
  const distToSeg = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  const inBg = (x, y) => {
    if (!rounded) return true;
    const qx = Math.max(Math.abs(x - c) - (c - radius), 0);
    const qy = Math.max(Math.abs(y - c) - (c - radius), 0);
    return Math.hypot(qx, qy) <= radius;
  };
  const inGlyph = (x, y) => {
    const d = Math.hypot(x - c, y - c);
    if (Math.abs(d - ringR) <= ringW / 2) return true;
    if (distToSeg(x, y, c, c, c, c - ringR * 0.62) <= handW / 2) return true;
    if (distToSeg(x, y, c, c, c + ringR * 0.45, c + ringR * 0.28) <= handW / 2) return true;
    return false;
  };
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let bg = 0, fg = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
          if (inBg(px, py)) {
            bg++;
            if (inGlyph(px, py)) fg++;
          }
        }
      const n = SS * SS;
      const a = bg / n, f = bg ? fg / bg : 0;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(BRAND[i] * (1 - f) + WHITE[i] * f);
      raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const icons = [
  ['icon-192.png', 192, { rounded: true, glyphScale: 1 }],
  ['icon-512.png', 512, { rounded: true, glyphScale: 1 }],
  ['maskable-512.png', 512, { rounded: false, glyphScale: 0.8 }],
  ['apple-touch-icon.png', 180, { rounded: false, glyphScale: 0.9 }],
];
for (const [name, size, opts] of icons) {
  writeFileSync(path.join(outDir, name), png(size, opts));
  console.log(`wrote ${name}`);
}
