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