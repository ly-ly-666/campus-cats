// profile.js — 猫咪独立档案页
import { DEFAULT_PHOTO } from './config.js';

const GENDER_LABEL = { male: '公', female: '母' };
const STATUS_TAG = { 已绝育: 'neutered', 未绝育: 'unneutered' };

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function photoUrl(src) {
  if (!src) return DEFAULT_PHOTO;
  if (/^https?:/i.test(src) || /\?v=/.test(src)) return src;
  return src + '?v=' + Date.now();
}

function showToast(message) {
  var el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  setTimeout(function () { el.classList.remove('show'); }, 4200);
}

async function loadData() {
  try {
    const [catsRes, relsRes] = await Promise.all([
      fetch('./data/cats.json'),
      fetch('./data/relations.json')
    ]);
    const cats = await catsRes.json();
    const relations = await relsRes.json();
    render(cats, relations);
  } catch (e) {
    document.getElementById('profile-main').innerHTML = '<div class="not-found">数据加载失败：' + escapeHtml(e.message) + '</div>';
  }
}

function render(cats, relations) {
  const id = (location.hash || '').replace(/^#/, '');
  const cat = cats.find(function (c) { return c.id === id; });
  if (!cat) {
    document.getElementById('profile-header').style.display = 'none';
    document.getElementById('profile-main').innerHTML = '<div class="not-found">找不到这只猫咪的档案 🐱</div>';
    return;
  }

  document.title = cat.name + ' · 猫咪档案';

  const photo = photoUrl(cat.photo);
  const past = cat.leftAt ? '<span class="tag tag-past">过往</span>' : '';
  const tags = (cat.tags || []).map(function (t) { return '<span class="tag">' + escapeHtml(t) + '</span>'; }).join('');

  document.getElementById('profile-header').innerHTML = `
    <img class="profile-avatar" src="${photo}" alt="" onerror="this.src='${DEFAULT_PHOTO}'">
    <h1 class="profile-name">${escapeHtml(cat.name)}</h1>
    ${cat.nickname ? '<div class="profile-nick">外号：' + escapeHtml(cat.nickname) + '</div>' : ''}
    <div class="profile-tags">
      ${past}
      <span class="tag tag-${cat.gender === 'male' ? 'male' : 'female'}">${GENDER_LABEL[cat.gender] || cat.gender}</span>
      <span class="tag tag-${STATUS_TAG[cat.status] || 'unneutered'}">${escapeHtml(cat.status || '')}</span>
      ${tags}
    </div>
  `;

  const items = [
    ['年龄', cat.age],
    ['毛色', cat.color],
    ['常出现区域', cat.area],
    ['首次发现', cat.firstSeen],
    ['离开时间', cat.leftAt],
    ['照料人', cat.caretaker],
    ['经纬度', cat.lat != null && cat.lng != null ? cat.lat + ', ' + cat.lng : '']
  ].filter(function (x) { return x[1]; });

  const infoHtml = items.map(function (x) {
    return '<div class="info-item"><div class="info-label">' + x[0] + '</div><div class="info-val">' + escapeHtml(x[1]) + '</div></div>';
  }).join('');

  const album = Array.isArray(cat.album) ? cat.album : [];
  const albumHtml = album.length
    ? '<div class="profile-album">' + album.map(function (src) {
      return '<img src="' + photoUrl(src) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">';
    }).join('') + '</div>'
    : '<p class="hint">暂无相册照片</p>';

  const catById = new Map(cats.map(function (c) { return [c.id, c]; }));
  const relItems = [];
  relations.forEach(function (rel) {
    if (rel.from === cat.id) {
      const other = catById.get(rel.to);
      if (other) relItems.push({ type: rel.relation, other: other, note: rel.note });
    } else if (rel.to === cat.id) {
      const other = catById.get(rel.from);
      if (other) relItems.push({ type: rel.relation, other: other, note: rel.note, reverse: true });
    }
  });
  const relHtml = relItems.length
    ? relItems.map(function (item) {
      return '<div class="relation-item"><span class="relation-type">' + (item.reverse ? '↔ ' : '') + escapeHtml(item.type) + '</span>' +
        '<span class="relation-other">→ ' + escapeHtml(item.other.name) + '</span>' +
        (item.note ? '<span class="relation-note">（' + escapeHtml(item.note) + '）</span>' : '') + '</div>';
    }).join('')
    : '<p class="hint">暂无关系记录</p>';

  document.getElementById('profile-main').innerHTML = `
    <a class="back-link" href="./index.html">← 返回地图</a>
    <section class="profile-section">
      <h3>📋 基本信息</h3>
      <div class="info-grid">${infoHtml}</div>
    </section>
    ${cat.story ? '<section class="profile-section"><h3>📖 猫咪故事</h3><div class="story-text">' + escapeHtml(cat.story) + '</div></section>' : ''}
    ${cat.description ? '<section class="profile-section"><h3>📝 简介</h3><div class="story-text">' + escapeHtml(cat.description) + '</div></section>' : ''}
    <section class="profile-section">
      <h3>🖼️ 相册</h3>
      ${albumHtml}
    </section>
    <section class="profile-section">
      <h3>🪢 关系</h3>
      ${relHtml}
    </section>
  `;

  document.querySelectorAll('.profile-album img').forEach(function (img) {
    img.addEventListener('click', function () { window.open(img.src, '_blank'); });
  });
}

loadData();