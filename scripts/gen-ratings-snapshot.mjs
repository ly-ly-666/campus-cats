// 生成评分/评语快照：调用 Netlify 一次拉全量，
// 写入 data/ratings-snapshot.json，随 GitHub Pages 发布。
// 前端在 Netlify 拉不到时回退读这份静态快照（微信等弱网秒开）。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const API = (process.env.YMCAO_LIKES_API || 'https://melodic-crepe-74a890.netlify.app') + '/.netlify/functions/likes';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'ratings-snapshot.json');

export async function buildSnapshot(dest = OUT) {
  const ctrl = AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined;
  const res = await fetch(API + '?ratings=true', { signal: ctrl });
  if (!res.ok) throw new Error('snapshot http ' + res.status);
  const j = await res.json();
  if (!j || !Array.isArray(j.list)) throw new Error('snapshot bad payload');
  // 只保留评论明细，供前端回退渲染
  const slim = j.list.map((x) => ({
    catId: x.catId,
    avg: x.avg,
    votes: x.votes,
    reviews: Array.isArray(x.reviews) ? x.reviews.map((r) => ({ name: r.name || '匿名猫友', score: r.score, content: r.content || '', at: r.at })) : []
  }));
  fs.writeFileSync(dest, JSON.stringify(slim, null, 0));
  return slim;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const list = await buildSnapshot();
  console.log('评分快照已生成: ' + OUT + ' (' + list.length + ' 只猫)');
}