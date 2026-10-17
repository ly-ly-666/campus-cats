#!/usr/bin/env node
/**
 * check-stickers.mjs — 表情包上传后的自检脚本（validate.mjs 只查 JSON 形状，这个查文件本体）
 *
 * 用法：node scripts/check-stickers.mjs
 *
 * 检查内容：
 *   1. 每个表情包的 cats 是否都存在于 cats.json
 *   2. 每个表情项的 src 文件是否存在
 *   3. 文件魔数与扩展名是否一致（GIF/JPG/PNG/WebP 冒充会报错）
 *   4. animated 标记是否与真实文件一致（.gif → animated 应为 true）
 *   5. 单文件体积警告（>900KB 时 GitHub 网页推送会推不上去）
 *   6. images/stickers/ 里的孤儿文件（没有任何表情包引用）
 *
 * 退出码：有「错误」（缺文件/魔数不符）→ 1；只有「警告」→ 0
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STICKERS_PATH = join(ROOT, 'data', 'stickers.json');
const CATS_PATH = join(ROOT, 'data', 'cats.json');
const STICKER_IMG_DIR = join(ROOT, 'images', 'stickers');

let errors = 0;
let warnings = 0;
const err = (m) => { errors++; console.log('  ❌ ' + m); };
const warn = (m) => { warnings++; console.log('  ⚠️  ' + m); };
const ok = (m) => console.log('  ✅ ' + m);

// 魔数 → 扩展名
function sniffKind(buf) {
  if (buf.length < 12) return 'unknown';
  const ascii = (start, len) => buf.toString('latin1', start, start + len);
  if (ascii(0, 3) === 'GIF') return 'gif';                       // GIF87a / GIF89a
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';          // JPEG
  if (buf[0] === 0x89 && ascii(1, 3) === 'PNG') return 'png';    // PNG
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'webp';
  return 'unknown';
}

// ---------- 1. stickers.json 形状 ----------
let packs;
try {
  packs = JSON.parse(readFileSync(STICKERS_PATH, 'utf8'));
  if (!Array.isArray(packs)) throw new Error('顶层不是数组');
} catch (e) {
  console.log('❌ data/stickers.json 无法解析：' + e.message);
  process.exit(1);
}
console.log(`📋 data/stickers.json：${packs.length} 个表情包`);

// ---------- 2. cats.json 里的 id 集合 ----------
let catIds = new Set();
try {
  const cats = JSON.parse(readFileSync(CATS_PATH, 'utf8'));
  catIds = new Set(cats.map((c) => c.id));
} catch { /* cats.json 坏了不归这个脚本管 */ }

// ---------- 3. 逐包逐项 ----------
const referenced = new Set();
for (const p of packs) {
  const title = p.title || p.id || '(无 id)';
  const items = Array.isArray(p.items) ? p.items : [];
  console.log(`\n📦 ${title} — ${items.length} 张`);
  if (!p.id) err(`${title}：缺少 id`);
  if (!Array.isArray(p.cats)) warn(`${title}：cats 不是数组`);
  else for (const cid of p.cats) if (catIds.size && !catIds.has(cid)) err(`${title}：关联猫 ${cid} 不存在于 cats.json`);
  if (!items.length) warn(`${title}：一个表情都没有`);
  for (const it of items) {
    const label = it.label ? `「${it.label}」` : '';
    if (!it.src) { err(`${title}${label}：items 里有一项没有 src`); continue; }
    referenced.add(it.src.replace(/\\/g, '/'));
    const file = join(ROOT, it.src);
    if (!existsSync(file)) { err(`${title}${label}：文件不存在 → ${it.src}`); continue; }
    const buf = readFileSync(file);
    const size = buf.length;
    const kind = sniffKind(buf);
    const ext = (it.src.split('.').pop() || '').toLowerCase();
    const kindByExt = ext === 'jpeg' ? 'jpg' : ext;
    if (kind !== 'unknown' && kind !== kindByExt) {
      err(`${title}${label}：扩展名 .${ext} 但文件魔数是 ${kind}（冒充文件）→ ${it.src}`);
    }
    if (kindByExt === 'gif' && it.animated !== true) {
      warn(`${title}${label}：文件是 GIF 但 animated 不是 true（公开站会显示成静图角标）→ ${it.src}`);
    }
    if (kindByExt !== 'gif' && it.animated === true) {
      warn(`${title}${label}：animated=true 但文件不是 GIF（动画已丢，八成被压缩成了 JPG）→ ${it.src}`);
    }
    if (size > 900 * 1024) {
      warn(`${title}${label}：${(size / 1024).toFixed(0)}KB > 900KB，GitHub 网页推送单文件上限 1MB 可能推不上去 → ${it.src}`);
    }
    ok(`${it.src}  ${(size / 1024).toFixed(0)}KB  ${kind}`);
  }
}

// ---------- 4. 孤儿文件 ----------
if (existsSync(STICKER_IMG_DIR)) {
  const files = readdirSync(STICKER_IMG_DIR).filter((f) => !f.startsWith('_test_'));
  const orphans = files.filter((f) => !referenced.has('images/stickers/' + f));
  if (orphans.length) {
    console.log(`\n🧹 images/stickers/ 里 ${orphans.length} 个文件没有被任何表情包引用（删包没删图或改了路径）：`);
    for (const f of orphans) {
      const size = statSync(join(STICKER_IMG_DIR, f)).size;
      warn(`images/stickers/${f}  ${(size / 1024).toFixed(0)}KB`);
    }
  } else {
    console.log('\n🧹 images/stickers/ 没有孤儿文件');
  }
} else {
  console.log('\nℹ️  images/stickers/ 还不存在（还没上传过表情图）');
}

// ---------- 汇总 ----------
console.log('\n———————————————');
if (errors) {
  console.log(`❌ 自检未通过：${errors} 个错误，${warnings} 个警告`);
  process.exit(1);
}
console.log(`✅ 自检通过（${warnings} 个警告）`);
