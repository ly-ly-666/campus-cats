// gallery.js — 猫咪照片墙（沉浸式浏览 + 大图查看）
import { DEFAULT_PHOTO, openLightbox, initLightbox } from './config.js?v=20261116c';

initLightbox();

const BATCH = 60;

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanSrc(src) {
  return String(src || '').split('?')[0];
}

function photoUrl(src) {
  if (!src) return DEFAULT_PHOTO;
  if (/^https?:/i.test(src) || /^data:/i.test(src) || /\?v=/.test(src)) return src;
  return src + '?v=2';
}

function thumbUrl(src) {
  if (!src) return DEFAULT_PHOTO;
  if (/^https?:/i.test(src) || /^data:/i.test(src)) return src;
  const name = cleanSrc(src).replace(/^.*[\\/]/, '');
  return 'images/thumb/' + name.replace(/\.[^.]+$/, '') + '.jpg?v=2';
}

const SOURCE_RANK = { avatar: 0, album: 1, event: 2, story: 3 };
const SOURCE_LABEL = { avatar: '头像', album: '相册', event: '事件', story: '故事' };

const grid = document.getElementById('wall-grid');
const countEl = document.getElementById('wall-count');
const moreWrap = document.getElementById('wall-more');
const moreBtn = document.getElementById('wall-more-btn');
const searchEl = document.getElementById('wall-search');
const catSelect = document.getElementById('wall-cat');
const filterBtns = Array.from(document.querySelectorAll('.wall-filter'));
const errorEl = document.getElementById('wall-error');

let allPhotos = [];
let visible = [];
const catById = new Map();
const state = { q: '', cat: '', source: 'all', shown: 0 };

function showError(msg) {
  if (errorEl) {
    errorEl.hidden = false;
    errorEl.textContent = msg;
  }
  if (grid) grid.innerHTML = '';
  if (moreWrap) moreWrap.hidden = true;
}

function catNames(photo) {
  return photo.cats.map((id) => (catById.get(id) || {}).name).filter(Boolean);
}

function sourceLabel(photo) {
  return SOURCE_LABEL[photo.source] || '照片';
}

function caption(photo) {
  const parts = [];
  const names = catNames(photo);
  if (names.length) parts.push(names.join('、'));
  if (photo.title) parts.push(photo.title);
  if (photo.date) parts.push(photo.date);
  return parts.filter(Boolean).join(' · ');
}

function haystack(photo) {
  return [catNames(photo).join(' '), photo.title, photo.area, sourceLabel(photo)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

async function loadPhotos() {
  let cats;
  try {
    const res = await fetch('./data/cats.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    cats = await res.json();
  } catch (e) {
    showError('照片数据加载失败：' + e.message);
    return;
  }
  if (!Array.isArray(cats)) { showError('照片数据格式不正确'); return; }

  const visibleCats = cats.filter((c) => c && c.visible !== false);
  visibleCats.forEach((c) => catById.set(c.id, c));

  const bySrc = new Map();
  function addPhoto(src, meta) {
    if (!src || /placeholder/i.test(src)) return;
    let item = bySrc.get(src);
    if (!item) {
      item = { src, cats: new Set(), title: '', date: '', area: '', source: meta.source || 'album' };
      bySrc.set(src, item);
    }
    if (meta.catId) item.cats.add(meta.catId);
    if ((SOURCE_RANK[meta.source] || 0) > (SOURCE_RANK[item.source] || 0)) item.source = meta.source;
    if (meta.title && !item.title) item.title = String(meta.title);
    if (meta.date && (!item.date || String(meta.date) > String(item.date))) item.date = String(meta.date);
    if (meta.area && !item.area) item.area = String(meta.area);
  }

  visibleCats.forEach((c) => {
    if (c.photo) addPhoto(c.photo, { catId: c.id, source: 'avatar', area: c.area, date: c.firstSeen });
    (Array.isArray(c.album) ? c.album : []).forEach((src) => {
      addPhoto(src, { catId: c.id, source: 'album', area: c.area });
    });
    (Array.isArray(c.events) ? c.events : []).forEach((ev) => {
      (Array.isArray(ev.images) ? ev.images : []).forEach((src) => {
        addPhoto(src, { catId: c.id, source: 'event', title: ev.text, date: ev.date, area: c.area });
      });
    });
    (Array.isArray(c.stories) ? c.stories : []).forEach((s) => {
      (Array.isArray(s.images) ? s.images : []).forEach((src) => {
        addPhoto(src, { catId: c.id, source: 'story', title: s.title, date: s.date, area: c.area });
      });
    });
  });

  allPhotos = Array.from(bySrc.values()).map((item) => ({
    src: item.src,
    cats: Array.from(item.cats),
    title: item.title,
    date: item.date,
    area: item.area,
    source: item.source,
  }));
  allPhotos.sort((a, b) => {
    const da = a.date || '';
    const db = b.date || '';
    if (da !== db) return db.localeCompare(da);
    return a.src.localeCompare(b.src);
  });

  // 猫咪筛选下拉
  const sortedCats = visibleCats.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh'));
  sortedCats.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name + (c.nickname ? '（' + c.nickname + '）' : '');
    catSelect.appendChild(opt);
  });

  update();
}

function applyFilters() {
  visible = allPhotos.filter((photo) => {
    if (state.cat && photo.cats.indexOf(state.cat) < 0) return false;
    if (state.source === 'story' && photo.source !== 'story') return false;
    if (state.source === 'event' && photo.source !== 'event') return false;
    if (state.source === 'album' && photo.source !== 'album' && photo.source !== 'avatar') return false;
    if (state.q && haystack(photo).indexOf(state.q) < 0) return false;
    return true;
  });
}

function itemHtml(photo, idx) {
  const full = photoUrl(photo.src);
  const thumb = thumbUrl(photo.src);
  const names = catNames(photo).map(escapeHtml).join('、');
  const title = photo.title ? escapeHtml(photo.title.length > 46 ? photo.title.slice(0, 46) + '…' : photo.title) : '';
  const date = photo.date ? escapeHtml(photo.date) : '';
  return '<figure class="wall-item" data-idx="' + idx + '" role="button" tabindex="0" aria-label="查看大图：' + escapeHtml(caption(photo)) + '">'
    + '<img src="' + escapeHtml(thumb) + '" data-full="' + escapeHtml(full) + '" alt="" loading="lazy" decoding="async" '
    + 'onerror="if(this.dataset.full&&this.src!==this.dataset.full){this.src=this.dataset.full;}else{this.style.display=\'none\';this.parentElement.classList.add(\'broken\');}">'
    + '<figcaption class="wall-cap"><b>' + (names || '🐱') + '</b>'
    + (title ? ' · ' + title : '')
    + (date ? ' · ' + date : '')
    + '</figcaption></figure>';
}

function update() {
  applyFilters();
  state.shown = 0;
  if (!grid) return;
  grid.innerHTML = '';
  if (!visible.length) {
    grid.innerHTML = '<div class="wall-empty">没有匹配的照片，换个搜索词或分类试试。</div>';
    if (countEl) countEl.textContent = '';
    if (moreWrap) moreWrap.hidden = true;
    return;
  }
  renderMore();
}

function renderMore() {
  if (!grid) return;
  const start = state.shown;
  const end = Math.min(visible.length, start + BATCH);
  if (start === 0) grid.innerHTML = '';
  grid.insertAdjacentHTML('beforeend', visible.slice(start, end).map((photo, i) => itemHtml(photo, start + i)).join(''));
  state.shown = end;
  if (countEl) countEl.textContent = '共 ' + visible.length + ' 张 · 已显示 ' + state.shown + ' 张';
  if (moreWrap) moreWrap.hidden = state.shown >= visible.length;
}

function openItem(el) {
  if (!el) return;
  const idx = Number(el.dataset.idx);
  if (!Number.isFinite(idx) || !visible[idx]) return;
  const gallery = visible.map((photo) => ({
    src: photoUrl(photo.src),
    thumb: thumbUrl(photo.src),
    caption: caption(photo),
  }));
  const current = gallery[idx];
  openLightbox(current.src, current.caption, current.thumb, gallery, idx);
}

grid.addEventListener('click', (e) => {
  const el = e.target.closest('.wall-item');
  if (el) openItem(el);
});
grid.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('.wall-item');
  if (!el) return;
  e.preventDefault();
  openItem(el);
});

let searchTimer = 0;
searchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = searchEl.value.trim().toLowerCase();
    update();
  }, 160);
});
catSelect.addEventListener('change', () => {
  state.cat = catSelect.value;
  update();
});
filterBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    state.source = btn.dataset.source || 'all';
    filterBtns.forEach((b) => b.classList.toggle('active', b === btn));
    update();
  });
});
moreBtn.addEventListener('click', renderMore);

loadPhotos();
