// likes.js — 猫咪点赞按钮（Netlify 计数版）
// 数据走后端 Netlify 函数（真实累计）。若接口未部署 / 不可达，自动降级为
// 浏览器本地计数（localStorage，仅本机可见）。

// Netlify 函数地址（已部署到 melodic-crepe-74a890.netlify.app）
const LIKES_API = (typeof window !== 'undefined' && window.YMCAO_LIKES_API)
  ? window.YMCAO_LIKES_API + '/.netlify/functions/likes'
  : 'https://melodic-crepe-74a890.netlify.app/.netlify/functions/likes';

const LS_KEY = 'ymaoditu_likes';
const localData = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; } };
const saveLocal = (d) => { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch (e) {} };

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

  // 先读后端；失败则读本地降级
  apiGet(id, kind).then((r) => {
    if (r && typeof r.likes === 'number') {
      count = r.likes; liked = !!r.likedByMe; online = true;
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