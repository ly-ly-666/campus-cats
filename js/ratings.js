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
// 读取某猫的评分评语缓存（localStorage）
export function cachedRating(catId) {
  try {
    const raw = localStorage.getItem(RATE_KEY + '_' + catId);
    if (raw) { const o = JSON.parse(raw); if (o && o.avg != null) return o; }
  } catch (e) {}
  return null;
}
// 读取某猫的评分：{ avg, votes, myScore, rated, reviews:[{name,score,content,at}] }；带超时防卡死；Netlify 失败则回退站点快照
// 为省 Netlify 函数预算：缓存较新(10分钟内)直接返回不做后台刷新；较旧才后台刷新。避免同一猫被反复查看时重复打函数
const RATE_CACHE_TTL = 10 * 60 * 1000; // 10 分钟内的缓存视为新鲜，不再请求
export function fetchRating(catId) {
  const hit = cachedRating(catId);
  if (hit) {
    const fresh = (Date.now() - (hit._t || 0)) < RATE_CACHE_TTL;
    if (!fresh) _refreshRating(catId).catch(() => {}); // 缓存较旧 → 后台拉新但不阻塞 UI
    return Promise.resolve(hit);
  }
  return _refreshRating(catId);
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
    return await r.json();
  } catch (e) { return { ok: false, error: '网络异常，请稍后再试' }; }
}

// 排行榜内存缓存：TTL 内直接返回，避免频繁触发 Netlify 冷启动、切页秒开
const _rankCache = { data: null, ts: 0 };
const RANK_TTL = 60 * 1000; // 60 秒内走缓存；后续进页显示缓存的同时后台刷新
const RANK_KEY = 'ymcao_rank_cache_v1';
// 排名优先读 GitHub Pages 的免费静态快照（不打 Netlify），仅每隔数小时才拉一次实时榜，压低积分消耗
const RANK_NETLIFY_TTL = 6 * 60 * 60 * 1000; // 同一浏览器 6 小时内最多打一次 Netlify 实时排名
let _netlifyRankTs = 0;
export function cachedRank() {
  try {
    const raw = localStorage.getItem(RANK_KEY);
    if (raw) { const o = JSON.parse(raw); if (o && Array.isArray(o.list) && o.list.length) return o; }
  } catch (e) {}
  return null;
}
async function _refreshRankFromNetlify() {
  _netlifyRankTs = Date.now();
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : null;
  try {
    const r = await fetch(RATE_API + '?rank=true', { method: 'GET', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
    if (timer) clearTimeout(timer);
    if (!r.ok) return null;
    const data = await r.json();
    if (data && Array.isArray(data.list)) {
      _rankCache.data = data;
      _rankCache.ts = Date.now();
      try { localStorage.setItem(RANK_KEY, JSON.stringify({ list: data.list, t: Date.now() })); } catch (e) {}
    }
    return data;
  } catch (e) { return null; }
}
export async function fetchRank(force) {
  if (force !== true && _rankCache.data && (Date.now() - _rankCache.ts) < RANK_TTL) return _rankCache.data;
  // 优先读免费静态快照（GitHub Pages，不产生 Netlify 调用），满足日常看榜
  try {
    const list = await readSnapshot();
    if (list && list.length) {
      const build = list.map((x) => ({ catId: x.catId, avg: x.avg, votes: x.votes }));
      const data = { ok: true, list: build };
      _rankCache.data = data; _rankCache.ts = Date.now();
      try { localStorage.setItem(RANK_KEY, JSON.stringify({ list: build, t: Date.now() })); } catch (e) {}
      if (Date.now() - _netlifyRankTs >= RANK_NETLIFY_TTL) _refreshRankFromNetlify().catch(() => {}); // 偶发后台刷新实时榜
      return data;
    }
  } catch (e) {}
  return _refreshRankFromNetlify();
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
      <div class="rate-bar">
        <span class="rate-label">🐱 猫咪评分</span>
        <span class="rate-num" data-avg>–</span><span class="rate-den">/10</span>
        <span class="rate-meta" data-votes>暂无评分</span>
      </div>
      <div class="rate-tip">点数字打分，可顺带写一句评语</div>
      <div class="rate-pick" data-pick></div>
      <div class="rate-mine" data-mine></div>
      <div class="cm-write cm-ext">
        <input class="cm-name" placeholder="昵称（可留空=匿名）" maxlength="20">
        <textarea class="cm-text" placeholder="评语（选填，例如：性格好亲人、超粘人～）" maxlength="300"></textarea>
        <button class="cm-send" type="button">提交评分</button>
      </div>
      <div class="rate-feedback" data-feedback></div>
      <div class="cm-list" data-list></div>
    </div>`;
  const avgEl = host.querySelector('[data-avg]');
  const votesEl = host.querySelector('[data-votes]');
  const mineEl = host.querySelector('[data-mine]');
  const pickEl = host.querySelector('[data-pick]');
  const nameEl = host.querySelector('.cm-name');
  const textEl = host.querySelector('.cm-text');
  const sendBtn = host.querySelector('.cm-send');
  const listEl = host.querySelector('[data-list]');
  const fbEl = host.querySelector('[data-feedback]');
  let fbTimer = null;
  const feedback = (msg, ok) => {
    fbEl.textContent = msg;
    fbEl.className = 'rate-feedback ' + (ok ? 'ok' : 'err') + ' show';
    clearTimeout(fbTimer);
    fbTimer = setTimeout(() => { fbEl.className = 'rate-feedback'; }, 2600);
  };

  let myScore = 0;

  const paintPick = (my) => {
    myScore = my;
    pickEl.innerHTML = '';
    for (let i = 1; i <= 10; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rate-chip' + (my === i ? ' on' : '');
      b.textContent = i;
      b.addEventListener('click', () => { paintPick(i); });
      pickEl.appendChild(b);
    }
  };

  const paintReviews = (arr) => {
    listEl.innerHTML = arr && arr.length
      ? arr.map(c => {
          const s = Number(c.score) || 0;
          return `<div class="cm-item">
              <span class="cm-name-x">${esc(c.name || '匿名猫友')}</span><span class="cm-score">${s}分</span><span class="cm-time">${fmtTime(c.at)}</span>
              <div class="cm-txt">${esc(c.content || '（只打了分，没写评语）')}</div>
            </div>`;
        }).join('')
      : '<div class="cm-empty">还没有人评分，来打第一个分吧～</div>';
  };

  // 先显示缓存（秒开），保证微信等慢网络也能立刻看到评论，不白屏
  const cached = cachedRating(id);
  const paint = (d, my) => {
    if (d && d.votes) { avgEl.textContent = d.avg; votesEl.textContent = d.votes + ' 人评分'; }
    mineEl.innerHTML = d && d.rated
      ? '我的评分：<b>' + d.myScore + '</b> 分'
      : '点击上方数字为它打分吧～';
    paintReviews(d && d.reviews && d.reviews.length ? d.reviews : (my && my.reviews) || []);
  };
  paint(cached, null);                       // 先用缓存渲染（秒出）
  const rate = await fetchRating(id);        // 后台等最新
  if (rate) { paintPick(rate.myScore || 0); paint(rate, null); }  // 有实时则覆盖
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
      if (r.votes) votesEl.textContent = r.votes + ' 人评分';
      avgEl.textContent = r.votes ? r.avg : '–';
      mineEl.innerHTML = '我的评分：<b>' + r.myScore + '</b> 分';
      paintReviews(r.reviews);
      try { localStorage.setItem(RATE_KEY + '_' + id, JSON.stringify(r)); } catch (e2) {}
      feedback('✓ 评分已提交，感谢你的反馈', true);
    } else {
      const err = (r && r.error) || '提交失败，请稍后再试';
      feedback('✕ ' + err, false);
    }
  });
}