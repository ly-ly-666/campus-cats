// profile.js — 猫咪独立档案页
import { DEFAULT_PHOTO } from './config.js';

const GENDER_LABEL = { male: '公', female: '母', unknown: '未知' };
const STATUS_TAG = { 已绝育: 'neutered', 未绝育: 'unneutered', 未知: 'unknown' };

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function photoUrl(src) {
  if (!src) return DEFAULT_PHOTO;
  if (/^https?:/i.test(src) || /\?v=/.test(src)) return src;
  return src + '?v=2'; // 固定版本号，浏览器可正常缓存（改图后手动+1）
}

// 预览用缩略图（快），点击看原图（高清）
function thumbUrl(src) {
  if (!src) return DEFAULT_PHOTO;
  if (/^https?:/i.test(src) || /^data:/i.test(src)) return src;
  const clean = String(src).split('?')[0];
  const name = clean.replace(/^.*[\\/]/, '');
  const jpg = name.replace(/\.[^.]+$/, '') + '.jpg';
  return 'images/thumb/' + jpg + '?v=2';
}

// 关系的方向化描述：如"小q 是 年年的妈妈" / "A 与 B 是配偶"
function relationDescText(type, aName, bName) {
  switch (type) {
    case '母子': return aName + ' 是 ' + bName + ' 的妈妈';
    case '父子': return aName + ' 是 ' + bName + ' 的爸爸';
    case '兄弟姐妹': return aName + ' 与 ' + bName + ' 是兄弟姐妹';
    case '配偶': return aName + ' 与 ' + bName + ' 是配偶';
    case '朋友': return aName + ' 与 ' + bName + ' 是朋友';
    default: return aName + ' ' + (type || '') + ' ' + bName;
  }
}

// 根据父母关系自动推断兄弟姐妹（同父或同母），带 auto:true
function deriveSiblingRelations(cats, relations) {
  var catIds = new Set(cats.map(function (c) { return c.id; }));
  var rels = relations || [];
  var explicit = new Set();
  rels.forEach(function (r) {
    if (r.relation !== '兄弟姐妹') return;
    var a = String(r.from), b = String(r.to);
    explicit.add(a < b ? a + '_' + b : b + '_' + a);
  });
  var parents = new Map();
  function addP(child, parent) {
    if (!catIds.has(child) || !catIds.has(parent)) return;
    if (!parents.has(child)) parents.set(child, new Set());
    parents.get(child).add(parent);
  }
  rels.forEach(function (r) {
    if (r.relation === '母子' || r.relation === '父子') addP(r.to, r.from);
  });
  var children = Array.from(parents.keys());
  var result = [];
  var done = new Set(explicit);
  for (var i = 0; i < children.length; i++) {
    for (var j = i + 1; j < children.length; j++) {
      var a = children[i], b = children[j];
      var shared = Array.from(parents.get(a)).some(function (pp) {
        return parents.get(b) && parents.get(b).has(pp);
      });
      if (!shared) continue;
      var key = a < b ? a + '_' + b : b + '_' + a;
      if (done.has(key)) continue;
      done.add(key);
      result.push({ from: a, to: b, relation: '兄弟姐妹', auto: true });
    }
  }
  return result;
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

// 温和化展示「离开时间」
function gentleLeftAt(cat) {
  if (!cat || cat.life === '去喵星了') return '';
  return String(cat.leftAt || '').replace(/离世|去世|车祸去世/g, '去喵星了');
}

// 渲染猫咪的多篇故事（stories优先，旧story兜底）
function renderProfileStories(cat) {
  var stories = [];
  if (Array.isArray(cat.stories) && cat.stories.length) {
    stories = cat.stories;
  } else if (cat.story && cat.story.trim()) {
    stories = [{ id: '', title: '', content: cat.story, images: [] }];
  }
  if (!stories.length) return '';
  var html = '<section class="profile-section"><h3>📖 猫咪故事</h3>';
  stories.forEach(function(s) {
    html += '<div class="story-item">';
    if (s.title) html += '<div class="story-item-title">' + escapeHtml(s.title) + '</div>';
    if (s.content) html += '<div class="story-item-content">' + escapeHtml(s.content) + '</div>';
    if (Array.isArray(s.images) && s.images.length) {
      html += '<div class="story-item-imgs">' + s.images.map(function(src) {
        return '<img src="' + thumbUrl(src) + '" data-full="' + photoUrl(src) + '" alt="" loading="lazy" onclick="window.open(this.dataset.full || this.src, \'_blank\')" style="cursor:zoom-in;">';
      }).join('') + '</div>';
    }
    html += '</div>';
  });
  html += '</section>';
  return html;
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
  const past = cat.life === '去喵星了' ? '<span class="tag tag-past">去喵星了</span>' : (cat.leftAt ? '<span class="tag tag-past">过往</span>' : '');
  const tags = (cat.tags || []).map(function (t) { return '<span class="tag">' + escapeHtml(t) + '</span>'; }).join('');

  document.getElementById('profile-header').innerHTML = `
    <img class="profile-avatar" src="${photo}" alt="" onerror="this.src='${DEFAULT_PHOTO}'">
    <h1 class="profile-name">${escapeHtml(cat.name)}</h1>
    ${cat.nickname ? '<div class="profile-nick">外号：' + escapeHtml(cat.nickname) + '</div>' : ''}
    <div class="profile-tags">
      ${past}
      <span class="tag tag-${cat.gender === 'male' ? 'male' : (cat.gender === 'female' ? 'female' : 'unknown')}">${GENDER_LABEL[cat.gender] || '未知'}</span>
      <span class="tag tag-${STATUS_TAG[cat.status] || 'unknown'}">${escapeHtml(cat.status || '未知')}</span>
      ${tags}
    </div>
  `;

  const items = [
    ['年龄', cat.age],
    ['毛色', cat.color],
    ['常出现区域', cat.area],
    ['首次发现', cat.firstSeen],
    ['离开时间', cat.life === '去喵星了' ? '' : gentleLeftAt(cat)],
    ['照料人', cat.caretaker],
    ['经纬度', cat.lat != null && cat.lng != null ? cat.lat + ', ' + cat.lng : '']
  ].filter(function (x) { return x[1]; });

  const infoHtml = items.map(function (x) {
    return '<div class="info-item"><div class="info-label">' + x[0] + '</div><div class="info-val">' + escapeHtml(x[1]) + '</div></div>';
  }).join('');

  const evts = Array.isArray(cat.events) ? cat.events : [];
  const eventsHtml = evts.length
    ? '<section class="profile-section"><h3>📅 最近事件</h3><div class="event-timeline">' +
      evts.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }).map(function (ev) {
        var imgs = Array.isArray(ev.images) && ev.images.length
          ? '<div class="event-imgs">' + ev.images.map(function (src) {
            return '<img src="' + thumbUrl(src) + '" data-full="' + photoUrl(src) + '" alt="" loading="lazy" onclick="window.open(this.dataset.full,\'_blank\')">';
          }).join('') + '</div>'
          : '';
        return '<div class="event-tl-item">' +
          '<div class="event-tl-date">' + escapeHtml(ev.date || '') + '</div>' +
          '<div class="event-tl-text">' + escapeHtml(ev.text || '') + '</div>' +
          imgs +
          '</div>';
      }).join('') +
      '</div></section>'
    : '';

  const album = Array.isArray(cat.album) ? cat.album : [];
  const albumHtml = album.length
    ? '<div class="profile-album">' + album.map(function (src) {
      return '<img src="' + thumbUrl(src) + '" data-full="' + photoUrl(src) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">';
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
  // 自动推断的兄弟姐妹（同父或同母）
  deriveSiblingRelations(cats, relations).forEach(function (d) {
    if (d.from === cat.id) {
      const other = catById.get(d.to);
      if (other) relItems.push({ type: '兄弟姐妹', other: other, note: '自动推断', reverse: false });
    } else if (d.to === cat.id) {
      const other = catById.get(d.from);
      if (other) relItems.push({ type: '兄弟姐妹', other: other, note: '自动推断', reverse: true });
    }
  });
  const relHtml = relItems.length
    ? relItems.map(function (item) {
      // 方向化：无论从哪只猫看，都显示"谁是谁的妈妈"等明确描述
      const aName = item.reverse ? item.other.name : cat.name;
      const bName = item.reverse ? cat.name : item.other.name;
      const desc = relationDescText(item.type, aName, bName);
      return '<div class="relation-item"><span class="relation-desc">🐾 ' + escapeHtml(desc) + '</span>' +
        (item.note ? '<span class="relation-note">（' + escapeHtml(item.note) + '）</span>' : '') + '</div>';
    }).join('')
    : '<p class="hint">暂无关系记录</p>';

  document.getElementById('profile-main').innerHTML = `
    <a class="back-link" href="./index.html">← 返回地图</a>
    <section class="profile-section">
      <h3>📋 基本信息</h3>
      <div class="info-grid">${infoHtml}</div>
    </section>
    ${eventsHtml}
    ${renderProfileStories(cat)}
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
    img.addEventListener('click', function () { window.open(img.dataset.full || img.src, '_blank'); });
  });
}

loadData();