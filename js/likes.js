// likes.js — 猫咪点赞按钮（Netlify 计数版）
// 数据走后端 Netlify 函数（真实累计）。若接口未部署 / 不可达，自动降级为
// 浏览器本地计数（localStorage，仅本机可见）。

// Netlify 函数地址（已部署到 melodic-crepe-74a890.netlify.app）
const LIKES_API = (typeof window !== 'undefined' && window.YMCAO_LIKES_API)
  ? window.YMCAO_LIKES_API + '/.netlify/functions/likes'
  : 'https://melodic-crepe-74a890.netlify.app/.netlify/functions/likes';

const LS_KEY = 'ymaoditu_likes';
const LS_LIKECOUNT_KEY = 'ymaoditu_like_counts_v1'; // 点赞数缓存：先显示缓存再后台刷新，避免每个按钮反复直连函数
const localData = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; } };
const saveLocal = (d) => { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch (e) {} };
const countCache = () => { try { return JSON.parse(localStorage.getItem(LS_LIKECOUNT_KEY) || '{}'); } catch (e) { return {}; } };
const saveCountCache = (d) => { try { localStorage.setItem(LS_LIKECOUNT_KEY, JSON.stringify(d)); } catch (e) {} };

// 点赞数读取：同会话 120 秒内复用缓存，避免每个按钮 no-store 反复打函数（地图/故事列表几十个赞按钮的重复直连是耗积分主因）
const _countTTL = 120 * 1000;
let _pendingLikes = null;
// 批量点赞数预取：后端 ?stats=true 一次拉回全部猫咪+故事点赞，把「N 个按钮逐个打函数」压缩成 1 次调用。
// 批量成功后，未出现在统计里的 id 视为 0 赞，不再逐条直连，是省 Netlify 积分的关键。
let _bulkPromise = null;
let _bulkLoaded = false;
export function bulkLikeStats() {
  if (!_bulkPromise) {
    _bulkPromise = (async () => {
      try {
        const r = await fetch(LIKES_API + '?stats=true', { method: 'GET', cache: 'no-store' });
        const j = await r.json();
        if (!j || typeof j.stats !== 'object') return false;
        const mine = localData();
        const cc = countCache();
        const now = Date.now();
        for (const k in j.stats) {
          const n = Number(j.stats[k]);
          if (!Number.isFinite(n)) continue;
          const raw = (k.indexOf('story_') === 0) ? k.slice(6) : k; // 后端故事的 key 带 story_ 前缀，前端用裸 id
          cc[raw] = { likes: n, liked: !!mine[raw], t: now };
        }
        _bulkLoaded = true;
        saveCountCache(cc);
        return true;
      } catch (e) { return false; }
      finally { _bulkPromise = null; }
    })();
  }
  return _bulkPromise;
}
function _countHit(id) {
  const cc = countCache();
  if (cc[id] && typeof cc[id].likes === 'number' && Date.now() - cc[id].t < _countTTL) return { likes: cc[id].likes, liked: !!cc[id].liked };
  return null;
}
async function apiGetCached(id, kind) {
  let hit = _countHit(id);
  if (hit) return { likes: hit.likes, likedByMe: hit.liked };
  // 尽量走一次批量 stats（多处并发的键在首次调用即触发，其余按钮共用同一次），批量命中则不逐条直连
  if (!_bulkPromise) bulkLikeStats().catch(() => {});
  if (_bulkPromise) { try { await _bulkPromise; } catch (e) {} }
  hit = _countHit(id);
  if (hit) return { likes: hit.likes, likedByMe: hit.liked };
  if (_bulkLoaded) { // 批量统计里没有它 => 0 赞，本地缓存，不再直连函数
    const mine = localData();
    const cc = countCache(); cc[id] = { likes: 0, liked: !!mine[id], t: Date.now() }; saveCountCache(cc);
    return { likes: 0, likedByMe: !!mine[id] };
  }
  // 批量不可用 -> 回退单条直连（保底，不阻塞功能）
  if (_pendingLikes) { try { await _pendingLikes; } catch (e) {} return apiGetCached(id, kind); }
  _pendingLikes = (async () => {
    try {
      const r = await fetch(LIKES_API + '?' + ((kind === 'story') ? 'storyId' : 'catId') + '=' + encodeURIComponent(id), { method: 'GET', cache: 'no-store' });
      const j = await r.json();
      if (j && typeof j.likes === 'number') { const cc = countCache(); cc[id] = { likes: j.likes, liked: !!j.likedByMe, t: Date.now() }; saveCountCache(cc); }
      return j;
    } finally { _pendingLikes = null; }
  })();
  return _pendingLikes;
}
async function apiGet(id, kind) {
  const param = (kind === 'story') ? 'storyId' : 'catId';
  const r = await fetch(LIKES_API + '?' + param + '=' + encodeURIComponent(id), { method: 'GET', cache: 'no-store' });
  return r.json();
}
async function apiSend(id, kind, toggle) {
  const payload = (kind === 'story') ? { storyId: id, toggle } : { catId: id, toggle };
  const r = await fetch(LIKES_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json();
}

function renderLikeButton(container, id, kind) {
  let count = null, liked = false, online = true;
  const els = {};
  container.innerHTML = `
    <button type="button" class="like-btn" data-liked="0" aria-label="点赞">
      <span class="like-heart">❤</span>
      <span class="like-count">…</span>
    </button>`;
  els.btn = container.querySelector('.like-btn');
  els.heart = container.querySelector('.like-heart');
  els.count = container.querySelector('.like-count');

  const paint = () => {
    els.count.textContent = (count == null) ? '…' : count.toLocaleString();
    els.btn.dataset.liked = liked ? '1' : '0';
  };

  // 先显示本地缓存（若有），再后台从后端刷新 —— 避免每个按钮都先等一轮网络
  const cc = countCache();
  if (cc[id] && typeof cc[id].likes === 'number') { count = cc[id].likes; liked = !!cc[id].liked; paint(); }
  apiGetCached(id, kind).then((r) => {
    if (r && typeof r.likes === 'number') {
      count = r.likes; liked = !!r.likedByMe; online = true; paint();
    } else {
      degradedLoad();
    }
    paint();
  }).catch(() => { degradedLoad(); paint(); });

  const degradedLoad = () => {
    online = false;
    const d = localData();
    const key = id;
    liked = !!d[key];
    count = d[key + '_n'] || 0;
  };

  const animate = () => {
    els.heart.classList.remove('pop');
    void els.heart.offsetWidth;
    els.heart.classList.add('pop');
  };

  els.btn.addEventListener('click', () => {
    if (online) {
      const want = !liked;
      liked = want; count = Math.max(0, count + (want ? 1 : -1)); paint();
      animate();
      apiSend(id, kind, want).then((r) => {
        if (r && typeof r.likes === 'number') { count = r.likes; liked = !!r.likedByMe; paint(); }
        const cc2 = countCache(); cc2[id] = { likes: count, liked: !!liked, t: Date.now() }; saveCountCache(cc2); // 更新缓存，减少后续重复请求
      }).catch(() => { /* 保持乐观值 */ });
    } else {
      const d = localData();
      const key = id;
      liked = !liked;
      count = Math.max(0, count + (liked ? 1 : -1));
      d[key] = liked ? 1 : 0; d[key + '_n'] = count;
      saveLocal(d); paint(); animate();
    }
  });
}

export function mountLikeButton(container, catId) {
  if (!container || !catId) return;
  renderLikeButton(container, catId, 'cat');
}

export function mountStoryLikeButton(container, storyId) {
  if (!container || !storyId) return;
  renderLikeButton(container, storyId, 'story');
}

// ---------- 评论（按故事） ----------
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function apiCommentsGet(storyId) {
  const r = await fetch(LIKES_API + '?comments=' + encodeURIComponent(storyId), { method: 'GET', cache: 'no-store' });
  return r.json();
}
async function apiCommentSend(storyId, name, content) {
  const r = await fetch(LIKES_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'add-comment', storyId, name, content }),
  });
  return r.json();
}

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/**
 * 给故事挂评论区：默认折叠，点「💬 评论(N)」展开列表 + 输入框。
 * @param {HTMLElement} container
 * @param {string} storyId
 */
export function mountStoryComment(container, storyId) {
  if (!container || !storyId) return;

  let open = false, comments = [], online = true;

  container.innerHTML = `
    <div class="story-comment">
      <button type="button" class="comment-toggle">💬 加载评论…</button>
      <div class="comment-panel" hidden>
        <div class="comment-list"></div>
        <div class="comment-form">
          <input type="text" class="comment-name" maxlength="20" placeholder="昵称（可选）">
          <input type="text" class="comment-text" maxlength="300" placeholder="说点什么…">
          <button type="button" class="comment-send">发布</button>
        </div>
        <div class="comment-tip"></div>
      </div>
    </div>`;

  const toggle = container.querySelector('.comment-toggle');
  const panel = container.querySelector('.comment-panel');
  const listEl = container.querySelector('.comment-list');
  const nameEl = container.querySelector('.comment-name');
  const textEl = container.querySelector('.comment-text');
  const tipEl = container.querySelector('.comment-tip');
  const sendBtn = container.querySelector('.comment-send');

  const paint = () => {
    toggle.textContent = '💬 评论' + (comments.length ? '（' + comments.length + '）' : '');
    if (!open) return;
    listEl.innerHTML = comments.length
      ? comments.slice().reverse().map((c) => `
          <div class="comment-row">
            <span class="comment-name-tag">${escapeHtml(c.name)}</span>
            <span class="comment-time">${fmtTime(c.at)}</span>
            <p class="comment-text-show">${escapeHtml(c.content)}</p>
          </div>`).join('')
      : '<p class="comment-empty">还没有评论，来抢沙发～</p>';
  };

  const load = () => {
    apiCommentsGet(storyId).then((r) => {
      if (r && Array.isArray(r.comments)) { comments = r.comments; online = true; }
      paint();
    }).catch(() => { online = false; paint(); });
  };

  toggle.addEventListener('click', () => {
    open = !open;
    panel.hidden = !open;
    if (open) load();
  });

  sendBtn.addEventListener('click', () => {
    const content = textEl.value.trim();
    if (!content) { tipEl.textContent = '写点什么再发布哦～'; return; }
    const name = nameEl.value.trim();
    tipEl.textContent = '';
    sendBtn.disabled = true;
    apiCommentSend(storyId, name, content).then((r) => {
      if (r && Array.isArray(r.comments)) {
        comments = r.comments; textEl.value = ''; paint();
        tipEl.textContent = '✅ 已发布';
        if (!name) nameEl.value = '匿名猫友';
      } else {
        tipEl.textContent = (r && r.error) || '发布失败，歇一下再试';
      }
      setTimeout(() => { tipEl.textContent = ''; }, 2500);
    }).catch(() => {
      tipEl.textContent = '发布失败（网络问题）';
    }).finally(() => { sendBtn.disabled = false; });
  });
}