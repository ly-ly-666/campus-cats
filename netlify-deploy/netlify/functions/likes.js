// Netlify 点赞 + 评论接口 — 油喵地图
// 数据存 Netlify Blobs（免费内置存储），无需额外数据库。
//
// 点赞：
//   GET  ?catId=xxx              -> { ok, key, kind, likes, likedByMe }
//   GET  ?storyId=xxx            -> 同上，key=story_<id>
//   GET  ?stats=true             -> { ok, stats:{key:count} } (含故事，key 带 story_ 前缀)
//   POST {catId|storyId, toggle} -> 点赞/取消
//
// 评论（按故事，key=comment_<storyId>）：
//   GET  ?comments=<storyId>            -> { ok, comments:[{id,name,content,at}] }
//   POST {action:'add-comment', storyId, name, content} -> 追加评论，返回最新列表
//   POST {action:'del-comment', storyId, commentId, adminKey} -> 删除评论（需口令）
//
// 访客身份用 IP+UA 哈希区分，非真实用户体系，仅用于避免同一访客重复计数。
import { getStore } from '@netlify/blobs';

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

// 管理评论删除口令：优先读环境变量 ADMIN_KEY，可避免提交到仓库硬编码
const ADMIN_KEY = process.env.ADMIN_KEY || 'lyf48d7f1e719409';
const MAX_COMMENTS = 100;   // 每篇故事最多保留多少条（超出丢弃最旧的）
const COOLDOWN_MS = 20000;  // 防刷：同一访客 20 秒内只能发一条评论

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

async function read(store, key, fallback) {
  const raw = await store.get(key).catch(() => null);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (e) { return fallback; }
}

export default async (req) => {
  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });

    const url = new URL(req.url);
    const body = (req.method === 'POST') ? await req.json().catch(() => ({})) : {};
    const store = getStore({ name: 'likes', consistency: 'strong' });

    // ---- 汇总接口 ----
    if (url.searchParams.get('stats') === 'true') {
      const stats = {};
      let cursor;
      do {
        const page = { cursor: cursor || undefined };
        const listing = await store.list(page);
        for (const item of listing.blobs || []) {
          if (item.key.startsWith('comment_')) continue; // 评论不计入点赞统计
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

    // ---- 读取评论 GET ?comments=<storyId> ----
    const commentsStory = url.searchParams.get('comments');
    if (commentsStory) {
      const ckey = 'comment_' + commentsStory;
      const arr = await read(store, ckey, []);
      return json(200, { ok: true, storyId: commentsStory, comments: arr });
    }

    // ---- 添加评论 POST {action:'add-comment', storyId, name, content} ----
    if (body.action === 'add-comment') {
      const story = String(body.storyId || '').trim();
      const content = String(body.content || '').trim().slice(0, 300);
      const name = String(body.name || '').trim().slice(0, 20) || '匿名猫友';
      if (!story || !content) return json(400, { ok: false, error: '缺少 storyId 或内容为空' });
      const ckey = 'comment_' + story;
      const arr = await read(store, ckey, []);
      // 冷却防刷：同一访客 20 秒内只能发一条
      const vk = visitorKey(req);
      const last = arr[arr.length - 1];
      const tooSoon = last && last.vk === vk && (Date.now() - (last.at || 0)) < COOLDOWN_MS;
      if (tooSoon) return json(429, { ok: false, error: '发送太快啦，歇 20 秒再发～' });
      arr.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, content, at: Date.now(), vk });
      const trimmed = arr.slice(-MAX_COMMENTS);
      await store.set(ckey, JSON.stringify(trimmed));
      return json(200, { ok: true, storyId: story, comments: trimmed });
    }

    // ---- 删除评论 POST {action:'del-comment', storyId, commentId, adminKey} ----
    if (body.action === 'del-comment') {
      const story = String(body.storyId || '');
      const cid = String(body.commentId || '');
      if (String(body.adminKey || '') !== ADMIN_KEY) return json(403, { ok: false, error: '口令不对，无法删除' });
      const ckey = 'comment_' + story;
      const arr = await read(store, ckey, []);
      const next = arr.filter((c) => String(c.id) !== cid);
      if (next.length !== arr.length) await store.set(ckey, JSON.stringify(next));
      return json(200, { ok: true, storyId: story, comments: next });
    }

    // ---- 点赞 ----
    const rawCat = url.searchParams.get('catId') || body.catId || '';
    const rawStory = url.searchParams.get('storyId') || body.storyId || '';
    const id = rawCat || (rawStory ? 'story_' + rawStory : '');
    const kind = rawStory ? 'story' : 'cat';

    if (!id) return json(400, { ok: false, error: '缺少 catId/storyId，或使用 ?stats=true / ?comments=<id> 获取数据' });

    const raw = await store.get(id).catch(() => null);
    const data = raw ? JSON.parse(raw) : { count: 0, visitors: {} };
    const vk = visitorKey(req);

    if (req.method === 'GET') {
      return json(200, { ok: true, key: id, kind, likes: data.count, likedByMe: !!data.visitors[vk] });
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
    return json(200, { ok: true, key: id, likes: data.count, liked, likedByMe: !!data.visitors[vk] });
  } catch (e) {
    return json(500, { ok: false, error: String((e && e.message) || e) });
  }
};