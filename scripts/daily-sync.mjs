// 每日同步：一次拉取 Netlify 的点赞汇总 + 评分明细，
// 产出 data/likes-backup.json、data/ratings-backup.json、data/ratings-snapshot.json。
// 合并前两个工作流各自拉取，每天要打 3 次函数；这里只打 2 次。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const API = (process.env.YMCAO_LIKES_API || 'https://melodic-crepe-74a890.netlify.app') + '/.netlify/functions/likes';
const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

async function getJSON(url) {
  const ctrl = AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined;
  const res = await fetch(url, { signal: ctrl });
  if (!res.ok) throw new Error('http ' + res.status);
  return res.json();
}

function writeIfChanged(name, obj) {
  const dest = path.join(DATA, name);
  const next = JSON.stringify(obj);
  if (fs.existsSync(dest) && fs.readFileSync(dest, 'utf8') === next) return false;
  fs.writeFileSync(dest, next);
  return true;
}

let ok = 0;

try {
  const stats = await getJSON(API + '?stats=true');
  if (!stats || typeof stats.stats !== 'object') throw new Error('响应非法');
  writeIfChanged('likes-backup.json', stats);
  ok++;
} catch (e) {
  console.error('点赞汇总拉取失败，跳过：' + e.message);
}

try {
  const ratings = await getJSON(API + '?ratings=true');
  if (!ratings || !Array.isArray(ratings.list)) throw new Error('响应非法');
  writeIfChanged('ratings-backup.json', ratings);
  const slim = ratings.list.map((x) => ({
    catId: x.catId,
    avg: x.avg,
    votes: x.votes,
    reviews: Array.isArray(x.reviews)
      ? x.reviews.map((r) => ({ name: r.name || '匿名猫友', score: r.score, content: r.content || '', at: r.at }))
      : []
  }));
  writeIfChanged('ratings-snapshot.json', slim);
  ok++;
  console.log('评分快照：' + slim.length + ' 只猫');
} catch (e) {
  console.error('评分明细拉取失败，跳过：' + e.message);
}

if (!ok) {
  console.error('两项都拉取失败');
  process.exit(1);
}
