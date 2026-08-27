// make-thumbs.mjs — 为 images/ 下所有图片生成缩略图到 images/thumb/
// 用法：
//   1) 安装依赖（一次即可）：npm i sharp --no-save --no-audit --no-fund
//   2) 生成/更新缩略图：node scripts/make-thumbs.mjs
// 说明：预览场景（地图标记/列表/相册/事件）加载缩略图，详情/放大才用原图。
// 缩略图命名规则：<原文件名去扩展名>.jpg，前端 ui.js 的 thumbUrl() 按此规则查找。
import sharp from 'sharp';
import { mkdirSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const wd = join(dirname(fileURLToPath(import.meta.url)), '..');
const imgDir = join(wd, 'images');
const thumbDir = join(wd, 'images', 'thumb');
mkdirSync(thumbDir, { recursive: true });

const THUMB_SIZE = 160;   // 预览最大显示 ~56px，160px 兼容 2x 高清屏
const QUALITY = 78;       // JPEG 质量

const files = readdirSync(imgDir).filter((f) => /\.(jpg|jpeg|png|webp|gif)$/i.test(f));
console.log('待处理图片:', files.length, '个');

let ok = 0, skip = 0, fail = 0;
for (const f of files) {
  const src = join(imgDir, f);
  const name = f.replace(/\.[^.]+$/, '') + '.jpg';
  const out = join(thumbDir, name);
  if (existsSync(out)) { skip++; continue; } // 已存在则跳过（删除 thumb 目录可全量重建）
  try {
    await sharp(src)
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover', position: 'attention' })
      .jpeg({ quality: QUALITY })
      .toFile(out);
    const kb = (statSync(src).size / 1024).toFixed(0) + 'KB  →  ' + (statSync(out).size / 1024).toFixed(1) + 'KB';
    console.log('  ✓ ' + name.padEnd(36) + kb);
    ok++;
  } catch (e) {
    console.log('  ✗ ' + f + ': ' + e.message);
    fail++;
  }
}
console.log(`\n完成: 新生成 ${ok}，跳过 ${skip}，失败 ${fail}`);
console.log('缩略图目录:', thumbDir);
