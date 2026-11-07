#!/usr/bin/env node
// 离屏渲染一帧，用来肉眼检查视觉效果。
// 用法: node tools/render-frame.mjs [秒数] [输出路径]
// 用法: node tools/render-frame.mjs 8 docs/preview.png

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seconds = Number(process.argv[2] ?? 8);
const outPath = path.resolve(ROOT, process.argv[3] ?? 'docs/preview.png');

const W = 320;
const H = 288;

function parseColor(value) {
  if (value.startsWith('#')) {
    let hex = value.slice(1);
    if (hex.length === 3) hex = hex.split('').map((ch) => ch + ch).join('');
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      255,
    ];
  }
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (match !== null) {
    const parts = match[1].split(',').map((part) => Number(part.trim()));
    return [parts[0] | 0, parts[1] | 0, parts[2] | 0, Math.round((parts[3] ?? 1) * 255)];
  }
  return [255, 0, 255, 255];
}

class Ctx {
  constructor() {
    this.px = new Uint8Array(W * H * 4);
    this.fillStyle = '#000000';
    this.globalAlpha = 1;
    this.imageSmoothingEnabled = false;
    this.sx = 1;
    this.sy = 1;
    this.ox = 0;
    this.oy = 0;
  }

  setTransform(a, _b, _c, d, e, f) {
    this.sx = a;
    this.sy = d;
    this.ox = e;
    this.oy = f;
  }

  fillRect(x, y, w, h) {
    const [r, g, b, a] = parseColor(this.fillStyle);
    const alpha = (a / 255) * this.globalAlpha;
    if (alpha <= 0) return;
    const x0 = Math.round(x * this.sx + this.ox);
    const y0 = Math.round(y * this.sy + this.oy);
    const x1 = Math.round((x + w) * this.sx + this.ox);
    const y1 = Math.round((y + h) * this.sy + this.oy);
    for (let py = y0; py < y1; py += 1) {
      if (py < 0 || py >= H) continue;
      for (let px = x0; px < x1; px += 1) {
        if (px < 0 || px >= W) continue;
        const i = (py * W + px) * 4;
        this.px[i] = Math.round(r * alpha + this.px[i] * (1 - alpha));
        this.px[i + 1] = Math.round(g * alpha + this.px[i + 1] * (1 - alpha));
        this.px[i + 2] = Math.round(b * alpha + this.px[i + 2] * (1 - alpha));
        this.px[i + 3] = 255;
      }
    }
  }
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const name = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([len, name, data, crc]);
}

function writePng(file, width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
  return png.length;
}

function compose(frames) {
  const cols = 2;
  const rows = 2;
  const width = W * cols;
  const height = H * rows;
  const out = Buffer.alloc(width * height * 4);
  frames.forEach((frame, index) => {
    const cx = (index % cols) * W;
    const cy = Math.floor(index / cols) * H;
    for (let y = 0; y < H; y += 1) {
      frame.copy(out, ((cy + y) * width + cx) * 4, y * W * 4, (y + 1) * W * 4);
    }
  });
  return { width, height, pixels: out };
}

let definition = null;
const window = {
  __ModuleLoader__: {
    load(def) {
      definition = def;
    },
  },
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  fetch: async () => {
    throw new Error('offline');
  },
  localStorage: { getItem: () => null, setItem: () => {} },
};
const sandbox = { window, performance: { now: () => 0 }, console, Math, Date };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8'), sandbox, {
  filename: 'client.js',
});
const React = {
  createElement: () => ({}),
  useRef: (value) => ({ current: value }),
  useState: (value) => [value, () => {}],
  useEffect: () => {},
  useReducer: (_fn, value) => [value, () => {}],
};
const mod = definition.factory((id) => {
  if (id === 'react') return React;
  throw new Error('unknown module ' + id);
});
const { createEntry, startFloor, tick, draw } = mod.__debug;

const floor = Number(process.argv[4] ?? 1);
const entry = createEntry('preview', 7);
if (floor !== 1) startFloor(entry, floor);
const frames = Math.round(seconds * 60);
for (let i = 0; i < frames; i += 1) {
  tick(entry, 1 / 60);
  const calm = entry.battle.enemies.every((enemy) => enemy.flash <= 0);
  if (entry.particles.length >= 4 && entry.battle.enemies.length >= 2 && calm) break;
}
const ctx = new Ctx();
draw(ctx, entry);

const strip = process.argv.includes('--strip');

if (strip) {
  const shots = [Buffer.from(ctx.px)];
  for (let k = 1; k < 4; k += 1) {
    for (let j = 0; j < 5; j += 1) tick(entry, 1 / 60);
    const next = new Ctx();
    draw(next, entry);
    shots.push(Buffer.from(next.px));
  }
  const image = compose(shots);
  const bytes = writePng(outPath, image.width, image.height, image.pixels);
  console.log(`wrote ${outPath} (${bytes} bytes) · 2x2 strip`);
} else {
  const bytes = writePng(outPath, W, H, Buffer.from(ctx.px));
  const battle = entry.battle;
  console.log(
    `wrote ${outPath} (${bytes} bytes) · floor ${entry.floor} · enemies ${battle.enemies.length} · particles ${entry.particles.length}`,
  );
}
