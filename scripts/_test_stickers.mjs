// scripts/_test_stickers.mjs — 表情包功能端到端冒烟测试（生成测试图 + stickers.json，校验公开站渲染）
// 用法：node scripts/_test_stickers.mjs make   —— 生成 images/stickers/_test_*.gif|jpg 与 data/stickers.json
//      node scripts/_test_stickers.mjs clean  —— 删除测试图与测试 stickers.json
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'images', 'stickers');

// ---------- 最小 GIF89a 编码器（仅用于造测试动图） ----------
function lzwEncode(minCodeSize, indices) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  const dict = new Map();
  const bits = [];
  let acc = 0, accBits = 0;
  const emit = (code) => {
    acc |= code << accBits; accBits += codeSize;
    while (accBits >= 8) { bits.push(acc & 0xff); acc >>= 8; accBits -= 8; }
  };
  for (let i = 0; i < clearCode; i++) dict.set(String(i), i);
  emit(clearCode);
  let cur = String(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const cand = cur + ',' + k;
    if (dict.has(cand)) { cur = cand; continue; }
    emit(dict.get(cur));
    dict.set(cand, nextCode++);
    if (nextCode === (1 << codeSize) && codeSize < 12) codeSize++;
    else if (nextCode >= 4096) { emit(clearCode); dict.clear(); for (let j = 0; j < clearCode; j++) dict.set(String(j), j); nextCode = eoiCode + 1; codeSize = minCodeSize + 1; }
    cur = String(k);
  }
  emit(dict.get(cur));
  emit(eoiCode);
  if (accBits > 0) { bits.push(acc & 0xff); acc = 0; accBits = 0; }
  return Buffer.from(bits);
}

function blocks(bufs) { return Buffer.concat(bufs.map((b) => (Buffer.isBuffer(b) ? b : typeof b === 'number' ? Buffer.from([b]) : Buffer.from(b)))); }

function makeGif(w, h, frames) {
  const out = [];
  out.push(Buffer.from('GIF89a', 'ascii'));
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(w, 0); lsd.writeUInt16LE(h, 2);
  lsd[4] = 0x87; lsd[5] = 0; lsd[6] = 0; // GCT flag, 8 色
  out.push(lsd);
  out.push(Buffer.from([
    255, 255, 255,   // 0 白
    245, 158, 11,    // 1 主色橙
    37, 99, 235,     // 2 蓝
    220, 38, 38,     // 3 红
    16, 185, 129,    // 4 绿
    45, 42, 38,      // 5 深
    250, 246, 239,   // 6 米
    236, 72, 153,    // 7 粉
  ]));
  const app = Buffer.from([0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, 0x03, 0x01, 0x00, 0x00, 0x00]); // NETSCAPE2.0 无限循环
  out.push(app);
  let prev = null;
  for (const f of frames) {
    let gce;
    if (prev === null) {
      gce = Buffer.from([0x21, 0xf9, 0x04, 0x08, 10, 0, 0, 0]); // full frame, delay 100ms
    } else {
      gce = Buffer.alloc(8); gce[0] = 0x21; gce[1] = 0xf9; gce[2] = 4; gce[3] = 4; gce[4] = 10; gce[5] = 0; // dispose-to-prev, index 4
      gce[6] = 4; gce[7] = 0;
    }
    out.push(gce);
    if (prev !== null) {
      const tr = Buffer.alloc(16);
      tr[0] = 0x2c; tr.writeUInt16LE(0, 1); tr.writeUInt16LE(0, 3); tr.writeUInt16LE(w, 5); tr.writeUInt16LE(h, 7); tr[9] = 0x89;
      out.push(tr);
      out.push(Buffer.from([0, 0, 255, 255, 255, 45, 42, 38, 236, 72, 153]));
      out.push(Buffer.from([4]));
      out.push(lzwEncode(3, f));
      out.push(0);
    } else {
      const im = Buffer.alloc(9);
      im[0] = 0x2c; im.writeUInt16LE(0, 1); im.writeUInt16LE(0, 3); im.writeUInt16LE(w, 5); im.writeUInt16LE(h, 7); im[9] = 0x87;
      out.push(im);
      out.push(lzwEncode(3, f));
      out.push(0);
    }
    prev = f;
  }
  out.push(0x3b);
  return blocks(out);
}

function frameIndices(w, h, fn) {
  const idx = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) idx.push(fn(x, y));
  return idx;
}

const W = 160, H = 160;
// 帧 A：橙色圆脸 + 黑眼
const fa = frameIndices(W, H, (x, y) => {
  const d = Math.hypot(x - 80, y - 80);
  if (d < 62) {
    if (Math.hypot(x - 58, y - 66) < 9 || Math.hypot(x - 102, y - 66) < 9) return 5;
    if (y > 96 && y < 112 && Math.abs(x - 80) < 26 && (y - 96) * (112 - y) > 20) return 5;
    return 1;
  }
  return 6;
});
// 帧 B：闭眼笑（眼睛变横线）
const fb = frameIndices(W, H, (x, y) => {
  const d = Math.hypot(x - 80, y - 80);
  if (d < 62) {
    if ((y === 66 || y === 67) && (Math.abs(x - 58) < 10 || Math.abs(x - 102) < 10)) return 5;
    if (y > 96 && y < 112 && Math.abs(x - 80) < 26 && (y - 96) * (112 - y) > 20) return 5;
    return 4;
  }
  return 6;
});

const mode = process.argv[2] || 'make';
const GifPath = join(DIR, '_test_wave.gif');
const JpgPath = join(DIR, '_test_static.jpg');
const jsonPath = join(ROOT, 'data', 'stickers.json');
const bakPath = join(ROOT, 'data', 'stickers.json.bak');
import { readFileSync } from 'fs';

// 1x1 GIF（校验「扩展名是 gif 但字节不是 GIF」的坏数据被公开站跳过）
const tinyGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// 静图 JPEG：不引三方库，直接拼一个最小 baseline JPEG 不现实——用 BMP 伪装扩展名同样能验渲染；
// 这里改用 Canvas 无关的纯色 PNG（zlib 走 node 自带 deflateSync）。
import { deflateSync } from 'zlib';
function crc32(buf) {
  let c, table = crc32.t || (crc32.t = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })());
  c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePng(w, h, px) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) raw.set(px(x, y), y * (w * 3 + 1) + 1 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8bit truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

if (mode === 'clean') {
  for (const p of [GifPath, JpgPath, join(DIR, '_test_broken.gif'), join(DIR, '_test_static.png')]) {
    if (existsSync(p)) rmSync(p);
  }
  if (existsSync(bakPath)) {
    rmSync(jsonPath);
    writeFileSync(jsonPath, readFileSync(bakPath));
    rmSync(bakPath);
    console.log('🧹 测试数据已清理，stickers.json 已还原');
  } else if (existsSync(jsonPath)) {
    // 没有备份：只把测试包从数组里摘掉
    try {
      const arr = JSON.parse(readFileSync(jsonPath, 'utf-8'));
      const rest = Array.isArray(arr) ? arr.filter((p) => p && p.id !== 'st_test_demo') : [];
      writeFileSync(jsonPath, JSON.stringify(rest, null, 2) + '\n', 'utf-8');
      console.log('🧹 测试包已移除，原有表情包保留');
    } catch (e) { console.error('清理失败：' + e.message); process.exit(1); }
  }
  process.exit(0);
}

if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
writeFileSync(GifPath, makeGif(W, H, [fa, fb]));
writeFileSync(join(DIR, '_test_static.png'), makePng(W, H, (x, y) => {
  const d = Math.hypot(x - 80, y - 80);
  if (d < 62) return [245, 158, 11];
  return [250, 246, 239];
}));
writeFileSync(join(DIR, '_test_broken.gif'), tinyGif);

// 把测试包合并进现有 stickers.json（先备份，clean 时还原）—— 不覆盖真实表情包数据
let arr = [];
if (existsSync(jsonPath)) {
  if (!existsSync(bakPath)) writeFileSync(bakPath, readFileSync(jsonPath));
  try { arr = JSON.parse(readFileSync(jsonPath, 'utf-8')) || []; } catch (e) { arr = []; }
  arr = arr.filter((p) => p && p.id !== 'st_test_demo');
}
arr.push({
  id: 'st_test_demo',
  title: '🧪 测试包 · 冒烟',
  date: '2026-10-01',
  note: '这是表情包功能的自动化测试数据，验收后运行 node scripts/_test_stickers.mjs clean 删除。',
  cats: ['cat001', 'cat099'],
  items: [
    { id: 'si_t1', src: 'images/stickers/_test_wave.gif', label: '馆长打招呼（动图）', animated: true },
    { id: 'si_t2', src: 'images/stickers/_test_static.png', label: '静图表情', animated: false },
    { id: 'si_t3', src: 'images/stickers/_test_broken.gif', label: '坏数据（应为 GIF 实际不是）', animated: true },
    { id: 'si_t4', src: 'images/stickers/_test_missing.gif', label: '缺文件表情', animated: true },
  ],
});
writeFileSync(jsonPath, JSON.stringify(arr, null, 2) + '\n', 'utf-8');
console.log('✅ 测试数据已生成（测试包并入 data/stickers.json，clean 可还原）');
