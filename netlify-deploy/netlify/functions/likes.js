// Netlify 点赞计数接口 — 油喵地图
// 数据存 Netlify Blobs（免费内置存储），无需额外数据库。
// 用法：
//   GET  /.netlify/functions/likes?catId=xxx     -> { ok, catId, likes, likedByMe }
//   POST /.netlify/functions/likes  body {catId, toggle:true|false}  -> 点赞/取消
// 访客身份用 IP+UA 哈希区分，非真实用户体系，仅用于避免同一访客重复计数。
import { getStore } from '@netlify/blobs';

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: HEADERS });
}

function visitorKey(req) {
  const header = req.headers.get('cookie') || '';
  const m = header.match(/(?:^|;\s*)visitor=([^;]+)/);
  if (m) return m[1];
  const ua = req.headers.get('user-agent') || 'unknown';
  const ip = req.headers.get('x-forwarded-for') || '';
  let s = (ip + ua).replace(/\s+/g, '');
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return 'anon_' + Math.abs(h).toString(36);
}

export default async (req) => {
  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });

    const url = new URL(req.url);
    const body = (req.method === 'POST') ? await req.json().catch(() => ({})) : {};
    const id = url.searchParams.get('catId') || body.catId || '';

    const store = getStore({ name: 'likes', consistency: 'strong' });

    // 汇总接口：GET ?stats=true  -> 返回全部猫咪点赞数 {stats:{catId:count}}
    if (url.searchParams.get('stats') === 'true') {
      const stats = {};
      let cursor;
      do {
        const page = { cursor: cursor || undefined };
        const listing = await store.list(page);
        for (const item of listing.blobs || []) {
          const s = await store.get(item.key).catch(() => null);
          if (!s) continue;
          let count = 0;
          try { count = JSON.parse(s).count || 0; } catch (e) {}
          if (count > 0) stats[item.key] = count;
        }
        cursor = listing.nextCursor;
      } while (cursor);
      return json(200, { ok: true, stats });
    }

    if (!id) return json(400, { ok: false, error: '缺少 catId，或使用 ?stats=true 获取汇总' });

    const raw = await store.get(id).catch(() => null);
    const data = raw ? JSON.parse(raw) : { count: 0, visitors: {} };
    const vk = visitorKey(req);

    if (req.method === 'GET') {
      return json(200, { ok: true, catId: id, likes: data.count, likedByMe: !!data.visitors[vk] });
    }

    const toggle = body.toggle !== false;
    let liked;
    if (toggle && !data.visitors[vk]) {
      data.visitors[vk] = 1; data.count += 1; liked = true;
    } else if (!toggle && data.visitors[vk]) {
      delete data.visitors[vk]; data.count = Math.max(0, data.count - 1); liked = false;
    } else {
      liked = !!data.visitors[vk];
    }

    await store.set(id, JSON.stringify(data));
    return json(200, { ok: true, catId: id, likes: data.count, liked, likedByMe: !!data.visitors[vk] });
  } catch (e) {
    return json(500, { ok: false, error: String((e && e.message) || e) });
  }
};