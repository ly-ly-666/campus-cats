// ratings.js — 猫咪评分+评语 + 评分榜（复用 Netlify 点赞后端）
const RATE_API = (typeof window !== 'undefined' && window.YMCAO_LIKES_API)
  ? window.YMCAO_LIKES_API + '/.netlify/functions/likes'
  : 'https://melodic-crepe-74a890.netlify.app/.netlify/functions/likes';

const RATE_KEY = 'ymcao_rate_cache_v1';
const SNAP_URL = 'data/ratings-snapshot.json';
let _snapCache = null;
// 读取站点同源发布的评分快照（GitHub Pages），Netlify 在微信里拉不到时兜底，秒开
async function readSnapshot() {
  try {
    if (_snapCache && _snapCache.t === 'snap' && _snapCache.list) return _snapCache.list;
    const r = await fetch(SNAP_URL + '?v=' + Date.now(), { method: 'GET', cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    if (j && Array.isArray(j)) { _snapCache = { t: 'snap', list: j }; return j; }
  } catch (e) {}
  return null;
}
function snapByCat(list, catId) { return list ? list.find(x => x && x.catId === String(catId)) || null : null; }

/* ---------- 实时数据（Netlify） ----------
   一次 ?ratings=true 同时拿到「排行榜 + 全部评语」，比原来单独打 ?rank=true 更省。
   时间戳落在 localStorage：同一浏览器 LIVE_TTL 内即使刷新页面也不会重复打函数。 */
const LIVE_TTL = 10 * 60 * 1000;
const LIVE_KEY = 'ymcao_live_rank_v1';
let _live = null; // { list:[{catId,avg,votes,reviews}], ts }
function readLiveCache() {
  if (_live) return _live;
  try {
    const raw = localStorage.getItem(LIVE_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && Array.isArray(o.list) && o.list.length) { _live = o; return _live; }
    }
  } catch (e) {}
  return null;
}
function saveLiveCache(list) {
  _live = { list: list, ts: Date.now() };
  try { localStorage.setItem(LIVE_KEY, JSON.stringify(_live)); } catch (e) {}
}
async function fetchLive(force) {
  const c = readLiveCache();
  if (!force && c && (Date.now() - c.ts) < LIVE_TTL) return c;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : null;
  try {
    const r = await fetch(RATE_API + '?ratings=true', { method: 'GET', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
    if (timer) clearTimeout(timer);
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !Array.isArray(j.list) || !j.list.length) return null;
    saveLiveCache(j.list);
    return _live;
  } catch (e) { return null; }
}
const toRankRows = (list) => (list || []).map((x) => ({ catId: x.catId, avg: x.avg, votes: x.votes }));

// 读取全部猫咪的评分评语。live=true 走实时接口（同一浏览器 10 分钟内复用）；
// 否则读站点静态快照（免费，不消耗 Netlify 函数预算）。
export async function fetchAllReviews(opts) {
  const live = opts === true || !!(opts && opts.live);
  if (live) {
    const l = await fetchLive(false);
    if (l) return l.list;
  }
  const list = await readSnapshot();
  return Array.isArray(list) ? list : [];
}
// 读取某猫的评分评语缓存（localStorage）
export function cachedRating(catId) {
  try {
    const raw = localStorage.getItem(RATE_KEY + '_' + catId);
    if (raw) { const o = JSON.parse(raw); if (o && o.avg != null) return o; }
  } catch (e) {}
  return null;
}
// 读取某猫的评分：{ avg, votes, myScore, rated, reviews:[{name,score,content,at}] }；带超时防卡死；Netlify 失败则回退站点快照
// 缓存只用来「秒出首屏」，不再当成最终结果：过期就等实时接口，拿到就重绘。
// （旧逻辑缓存过期只在后台刷新、结果丢弃，导致档案页永远少最新那一条）
const RATE_CACHE_TTL = 60 * 1000; // 1 分钟内的缓存视为新鲜，直接用
export function fetchRating(catId) {
  const hit = cachedRating(catId);
  if (hit && (Date.now() - (hit._t || 0)) < RATE_CACHE_TTL) return Promise.resolve(hit);
  return _refreshRating(catId).then((fresh) => fresh || hit || null);
}
async function _refreshRating(catId) {
  try {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : null;
    const r = await fetch(RATE_API + '?rate=' + encodeURIComponent(catId), { method: 'GET', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
    if (timer) clearTimeout(timer);
    if (!r.ok) throw new Error('rate http ' + r.status);
    const data = await r.json();
    if (data && data.avg != null) {
      data._t = Date.now();
      try { localStorage.setItem(RATE_KEY + '_' + catId, JSON.stringify(data)); } catch (e) {}
      return data;
    }
  } catch (e) {}
  // 实时接口失败/超时 → 回退站点快照（微信里 Netlify 不通也能显示评论）
  try {
    const list = await readSnapshot();
    const s = snapByCat(list, catId);
    if (s) { const data = { avg: s.avg, votes: s.votes, reviews: s.reviews || [], rated: false, myScore: 0, snap: true, _t: Date.now() }; return data; }
  } catch (e2) {}
  return null;
}

// 提交评分+评语：后端的 rate 动作，评语随评分一起打（不用再单独发评论）
export async function submitRating(catId, score, content, name) {
  try {
    const r = await fetch(RATE_API, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'rate', catId, score, content, name }) });
    const j = await r.json();
    if (j && j.ok) {
      // 刚提交的评分立刻并进本地实时缓存：本机后续重绘（切页/重进榜单）不会再退回旧数字
      const c = readLiveCache();
      if (c) {
        const entry = { catId: String(catId), avg: j.avg, votes: j.votes, reviews: j.reviews || [] };
        const i = c.list.findIndex((x) => String(x.catId) === String(catId));
        if (i >= 0) c.list[i] = entry; else c.list.push(entry);
        try { localStorage.setItem(LIVE_KEY, JSON.stringify(c)); } catch (e) {}
      }
    }
    return j;
  } catch (e) { return { ok: false, error: '网络异常，请稍后再试' }; }
}

// 本地实时缓存（10 分钟内算「实时」，超时算「缓存」）→ 静态快照（免费秒开）。都没有才返回 null
async function localRank() {
  const c = readLiveCache();
  if (c) return { list: toRankRows(c.list), source: (Date.now() - c.ts) < LIVE_TTL ? 'live' : 'cache' };
  const snap = await readSnapshot();
  if (Array.isArray(snap) && snap.length) return { list: toRankRows(snap), source: 'snap' };
  return null;
}
/**
 * 排行榜取数。返回 { list, source }：list 立即可画，
 * source = live(实时接口) / cache(本地缓存) / snap(站点静态快照)。
 * 优先返回本地缓存/静态快照（免费、秒开），实时榜在后台拉，拿到后通过 onUpdate 回调再重绘一次
 * —— 旧代码把实时结果只写进缓存、从不回绘，所以页面永远显示旧快照。
 * @param {Object} [opts] { force } force=true（手动点「🔄 刷新最新」）忽略 10 分钟限制并等待实时结果
 * @param {Function} [opts.onUpdate] 实时数据到达时的回调（用于二次重绘）
 */
export async function fetchRank(opts) {
  const o = typeof opts === 'function' ? { onUpdate: opts } : (opts || {});
  const force = o.force === true;
  const base = await localRank();

  if (force) {
    const live = await fetchLive(true);
    if (live) return { list: toRankRows(live.list), source: 'live' };
    return base || { list: [], source: 'snap' };
  }

  const task = fetchLive(false).then((live) => {
    if (!live) return null;
    const out = { list: toRankRows(live.list), source: 'live' };
    if (o.onUpdate) o.onUpdate(out);
    return out;
  }).catch(() => null);

  if (base) { task.then(function () {}); return base; } // 先画旧的，实时到了再重绘
  const out = await task;
  return out || { list: [], source: 'snap' };
}

/* ---------- 渲染：评分+评语组件（地图弹窗 / 档案页复用） ---------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtTime(t) {
  if (!t) return '';
  const d = new Date(t); const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

export async function mountRatingBox(host, catId) {
  if (!host) return;
  const id = catId;
  host.innerHTML = `
    <div class="rate-box">
      <div class="rate-hero">
        <div class="rate-hero-score">
          <span class="rate-num" data-avg>–</span><span class="rate-den">/10</span>
        </div>
        <div class="rate-hero-info">
          <div class="rate-stars"><span class="stars-bg">★★★★★</span><span class="stars-fg" data-stars-fg>★★★★★</span></div>
          <div class="rate-meta" data-votes>暂无评分</div>
        </div>
      </div>
      <div class="rate-tip">点数字为它打分（1–10 分），可顺带写一句评语</div>
      <div class="rate-pick" data-pick></div>
      <div class="rate-mine" data-mine></div>
      <div class="cm-write cm-ext">
        <input class="cm-name" placeholder="昵称（可留空=匿名）" maxlength="20">
        <textarea class="cm-text" placeholder="评语（选填，例如：性格好亲人、超粘人～）" maxlength="300"></textarea>
        <button class="cm-send" type="button">提交评分</button>
      </div>
      <div class="rate-feedback" data-feedback></div>
      <div class="cm-list" data-list></div>
      <button class="cm-more" type="button" data-more hidden></button>
    </div>`;
  const avgEl = host.querySelector('[data-avg]');
  const votesEl = host.querySelector('[data-votes]');
  const starsFg = host.querySelector('[data-stars-fg]');
  const mineEl = host.querySelector('[data-mine]');
  const pickEl = host.querySelector('[data-pick]');
  const nameEl = host.querySelector('.cm-name');
  const textEl = host.querySelector('.cm-text');
  const sendBtn = host.querySelector('.cm-send');
  const listEl = host.querySelector('[data-list]');
  const moreBtn = host.querySelector('[data-more]');
  const fbEl = host.querySelector('[data-feedback]');
  let fbTimer = null;
  const feedback = (msg, ok) => {
    fbEl.textContent = msg;
    fbEl.className = 'rate-feedback ' + (ok ? 'ok' : 'err') + ' show';
    clearTimeout(fbTimer);
    fbTimer = setTimeout(() => { fbEl.className = 'rate-feedback'; }, 2600);
  };

  let myScore = 0;
  let allReviews = [];        // 全部评分评语
  let reviewExpanded = false; // 评论是否已展开
  const REVIEW_PREVIEW = 2;   // 默认只露 2 条，其余点「查看全部」展开

  const paintPick = (my) => {
    myScore = my;
    pickEl.innerHTML = '';
    for (let i = 1; i <= 10; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rate-chip' + (my === i ? ' on' : '');
      b.textContent = i;
      b.setAttribute('aria-label', '打 ' + i + ' 分');
      b.addEventListener('click', () => { paintPick(i); });
      pickEl.appendChild(b);
    }
  };

  const reviewItem = (c) => {
    const s = Number(c.score) || 0;
    const nm = String(c.name || '匿名猫友').trim() || '匿名猫友';
    return `<div class="cm-item">
        <div class="cm-head">
          <span class="cm-avatar">${esc(nm.slice(0, 1))}</span>
          <span class="cm-name-x">${esc(nm)}</span>
          <span class="cm-score">${s} 分</span>
          <span class="cm-time">${fmtTime(c.at)}</span>
        </div>
        <div class="cm-txt">${esc(c.content || '（只打了分，没写评语）')}</div>
      </div>`;
  };

  const paintReviews = () => {
    if (!allReviews.length) {
      listEl.innerHTML = '<div class="cm-empty">还没有人评分，来打第一个分吧～</div>';
      if (moreBtn) moreBtn.hidden = true;
      return;
    }
    const shown = reviewExpanded ? allReviews : allReviews.slice(0, REVIEW_PREVIEW);
    listEl.innerHTML = shown.map(reviewItem).join('');
    if (moreBtn) {
      moreBtn.hidden = allReviews.length <= REVIEW_PREVIEW;
      moreBtn.textContent = reviewExpanded ? '收起评论 ▴' : '查看全部 ' + allReviews.length + ' 条评论 ▾';
    }
  };

  if (moreBtn) {
    moreBtn.addEventListener('click', () => { reviewExpanded = !reviewExpanded; paintReviews(); });
  }

  // 星级条：平均分（满分 10）换算成 5 星填充比例
  const paintStars = (avg) => {
    if (!starsFg) return;
    const pct = Math.max(0, Math.min(100, (Number(avg) || 0) / 10 * 100));
    starsFg.style.width = pct + '%';
  };

  const paint = (d) => {
    const votes = d && Number(d.votes);
    if (votes) {
      avgEl.textContent = d.avg;
      votesEl.textContent = d.votes + ' 人评分';
    } else {
      avgEl.textContent = '–';
      votesEl.textContent = '暂无评分';
    }
    paintStars(votes ? d.avg : 0);
    mineEl.innerHTML = d && d.rated
      ? '我的评分：<b>' + d.myScore + '</b> 分'
      : '点击上方数字为它打分吧～';
    allReviews = (d && Array.isArray(d.reviews) && d.reviews.length) ? d.reviews : [];
    paintReviews();
  };

  // 先显示缓存（秒开），保证微信等慢网络也能立刻看到评论，不白屏
  const cached = cachedRating(id);
  paint(cached);
  const rate = await fetchRating(id);        // 后台等最新
  if (rate) { paintPick(rate.myScore || 0); paint(rate); }  // 有实时则覆盖
  else { paintPick(cached ? cached.myScore || 0 : 0); }

  sendBtn.addEventListener('click', async () => {
    if (!myScore) { feedback('请先点一个分数（1-10）再提交～', false); return; }
    const name = nameEl.value.trim();
    const content = textEl.value.trim();
    sendBtn.disabled = true;
    sendBtn.textContent = '提交中…';
    const r = await submitRating(id, myScore, content, name);
    sendBtn.disabled = false;
    sendBtn.textContent = '提交评分';
    if (r && r.ok) {
      textEl.value = '';
      paint(r); // 复用统一渲染：平均分/星级/我的评分/评论一并刷新
      try { localStorage.setItem(RATE_KEY + '_' + id, JSON.stringify(r)); } catch (e2) {}
      feedback('✓ 评分已提交，感谢你的反馈', true);
    } else {
      const err = (r && r.error) || '提交失败，请稍后再试';
      feedback('✕ ' + err, false);
    }
  });
}