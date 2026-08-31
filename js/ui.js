// ui.js — UI 模块（列表渲染、详情弹窗、标签页、HTML 转义）
import { DEFAULT_PHOTO, deriveSiblingRelations, openLightbox, initLightbox, collectStoryAlbumImages } from './config.js';
import { mountLikeButton, mountStoryLikeButton } from './likes.js';
export { openLightbox, initLightbox };

// 温和化展示「离开时间」— 替换敏感词，展示层用
export function gentleLeftAt(cat) {
  if (!cat || cat.life === '去喵星了') return '';
  return String(cat.leftAt || '').replace(/离世|去世|车祸去世/g, '去喵星了');
}
const IMG_CACHE_BUST = 'v2'; // 改版本号时更新这里，浏览器即可重新缓存
function photoUrl(src) {
  if (!src) return DEFAULT_PHOTO;
  if (/^https?:/i.test(src) || /\?v=/.test(src)) return src;
  return src + '?v=' + IMG_CACHE_BUST;
}

/**
 * 生成缩略图路径：预览场景（地图/列表/相册/事件小图）用低码率小图，加载快；
 * 点击看详情 / 放大（lightbox）时再用原图。外链/data 图没有缩略图，直接返回原图。
 */
export function thumbUrl(src) {
  if (!src) return DEFAULT_PHOTO;
  if (/^https?:/i.test(src) || /^data:/i.test(src)) return src;
  const clean = String(src).split('?')[0];
  const name = clean.replace(/^.*[\\/]/, '');
  const jpg = name.replace(/\.[^.]+$/, '') + '.jpg';
  return 'images/thumb/' + jpg + '?v=' + IMG_CACHE_BUST;
}

/**
 * 后台预取图片到浏览器缓存（渐进式加载）：
 * 缩略图先显示 → 空闲时慢慢把原图拉进缓存 → 用户看详情/放大时原图秒开。
 * 利用 requestIdleCallback（不支持则 setTimeout），低频小并发，不抢关键带宽。
 * @param {string[]|string} urls 原图 URL 列表
 * @param {Object} [opts] { delay } 初始延迟 ms
 */
const _prefetchQueue = [];
let _prefetchScheduled = false;
export function prefetchImages(urls, opts = {}) {
  const list = (Array.isArray(urls) ? urls : [urls]).map(String).filter((u) => u && !u.startsWith('data:'));
  if (!list.length || typeof Image === 'undefined') return;
  _prefetchQueue.push(...list);
  if (_prefetchScheduled) return;
  _prefetchScheduled = true;
  const BATCH = 4;          // 每批并发数
  const GAP = 250;          // 批间隔 ms，慢慢拉不抢带宽
  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 1));
  idle(() => {
    const drain = () => {
      _prefetchScheduled = false;
      const batch = _prefetchQueue.splice(0, BATCH);
      if (!batch.length) return;
      batch.forEach((u) => { try { var img = new Image(); img.src = u; } catch (e) {} });
      if (_prefetchQueue.length) {
        _prefetchScheduled = true;
        setTimeout(drain, GAP);
      }
    };
    setTimeout(drain, opts.delay != null ? opts.delay : 0);
  });
}

/** 生成猫咪名字首字占位图（SVG data URL），避免页面加载时并发请求 39 张照片 */
function initialsPlaceholder(name) {
  const s = (name || '?').charAt(0).toUpperCase().replace(/[$`]/g, '?');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
    <circle cx="40" cy="40" r="40" fill="#ffd9a8"/>
    <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-size="36" font-weight="700" fill="#7c4a1e" font-family="system-ui,-apple-system,sans-serif">${s}</text>
  </svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

/** 把 cat-list 里的占位图换成真实照片（面板打开时调用） */
export function loadCatListPhotos() {
  const list = document.getElementById('cat-list');
  if (!list) return;
  list.querySelectorAll('img[data-real-src]').forEach((img) => {
    img.src = img.dataset.realSrc;
    delete img.dataset.realSrc;
  });
}

/**
 * 对字符串进行 HTML 转义，防止 XSS。
 * @param {*} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 性别 / 绝育状态中文标签 */
const GENDER_LABEL = { male: '公', female: '母', unknown: '未知' };
const STATUS_TAG = { 已绝育: 'neutered', 未绝育: 'unneutered', 未知: 'unknown' };

/** 关系的方向化描述：如"小q 是 年年的妈妈" / "A 与 B 是配偶" */
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

/**
 * 渲染猫咪列表。
 * @param {Array} cats 猫咪数组
 * @param {Function} onSelect 点击某一项时的回调 onSelect(cat)
 */
export function renderCatList(cats, onSelect) {
  const listEl = document.getElementById('cat-list');
  if (!listEl) return;

  const allCats = Array.isArray(cats) ? cats : [];

  // 内部渲染函数：根据关键词过滤后渲染
  function renderFiltered(keyword) {
    const kw = (keyword || '').trim().toLowerCase();
    const filtered = kw
      ? allCats.filter((cat) => {
          const hay = [
            cat.name, cat.nickname, cat.color, cat.area,
            cat.caretaker, cat.age, cat.description,
            (cat.tags || []).join(' ')
          ].join(' ').toLowerCase();
          return hay.indexOf(kw) >= 0;
        })
      : allCats;

    if (!filtered.length) {
      listEl.innerHTML = '<div class="cat-list-empty">😿 没找到匹配「' + escapeHtml(keyword || '') + '」的猫咪</div>';
      return;
    }

    listEl.innerHTML = filtered.map((cat) => {
      const photo = thumbUrl(cat.photo); // 列表预览用缩略图，点开详情才看原图
      return `
      <div class="cat-item" data-cat-id="${cat.id}" tabindex="0" role="button" aria-label="查看 ${escapeHtml(cat.name)}">
        <div class="cat-item-photo${cat.life === '失踪' ? ' ring-missing' : (cat.life === '失踪已久' ? ' ring-missing-old' : (cat.life === '已领养' ? ' ring-adopted' : ''))}">
          <img src="${initialsPlaceholder(cat.name)}" data-real-src="${photo}" alt=""
               onerror="this.style.display='none';this.parentElement.classList.add('cat-item-fallback');">
          <span class="cat-item-fallback-icon">🐱</span>
        </div>
        <div class="cat-item-info">
          <div class="cat-item-name">
            ${escapeHtml(cat.name)}
            ${cat.nickname && !cat.nickname.startsWith('img-') ? '<span class="cat-item-nick">（' + escapeHtml(cat.nickname) + '）</span>' : ''}
            ${cat.life === '去喵星了' || cat.leftAt ? '<span class="tag tag-past">离世' + (cat.leftAt ? ' ' + escapeHtml(cat.leftAt) : '') + '</span>' : ''}
            <span class="tag tag-${cat.gender === 'male' ? 'male' : (cat.gender === 'female' ? 'female' : 'unknown')}">${GENDER_LABEL[cat.gender] || '未知'}</span>
            <span class="tag tag-${STATUS_TAG[cat.status] || 'unneutered'}">${escapeHtml(cat.status || '未知')}</span>
            ${cat.life === '失踪' ? '<span class="tag" style="background:#dc2626;color:#fff;">⚠️ 失踪</span>' : ''}
            ${cat.life === '失踪已久' ? '<span class="tag" style="background:#9f1239;color:#fff;">⚠️ 失踪已久</span>' : ''}
            ${cat.life === '已领养' ? '<span class="tag" style="background:#10b981;color:#fff;">🏠 已领养</span>' : ''}
          </div>
          <div class="cat-item-area">📍 ${escapeHtml(cat.area || '')}</div>
        </div>
      </div>`;
    }).join('');

    listEl.querySelectorAll('.cat-item').forEach((el) => {
      const id = el.dataset.catId;
      const cat = allCats.find((c) => c.id === id);
      if (!cat) return;
      const handler = () => typeof onSelect === 'function' && onSelect(cat);
      el.addEventListener('click', handler);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handler();
        }
      });
    });
  }

  // 初始渲染全部
  renderFiltered('');

  // 绑定搜索框
  const searchEl = document.getElementById('cat-search');
  if (searchEl && !searchEl._bound) {
    searchEl._bound = true;
    searchEl.addEventListener('input', () => renderFiltered(searchEl.value));
  }

  // 更新猫咪数量（浮层标题 + 浮动按钮）
  const countEl = document.getElementById('cat-count');
  if (countEl) countEl.textContent = String(allCats.length);
  const fabCount = document.getElementById('fab-count');
  if (fabCount) fabCount.textContent = String(allCats.length);
}

export function showModal(cat, cats, relations) {
  if (!cat) return;
  const catById = new Map(cats.map((c) => [c.id, c]));

  const photo = photoUrl(cat.photo);
  // 用户在查看这只猫，后台预取它的相册/故事/事件原图，避免点开时等待
  const _catExtras = []
    .concat(cat.album || [], collectStoryAlbumImages(cat, cats).map((it) => it.src), (cat.events || []).map((ev) => ev.images || []).flat());
  if (_catExtras.length) prefetchImages(_catExtras.map((s) => photoUrl(s)), { delay: 0 });
  let statusBanner = '';
  if (cat.life === '失踪') statusBanner = '<div style="background:#dc2626;color:#fff;padding:12px 14px;border-radius:10px;margin-bottom:12px;font-weight:600;font-size:14px;line-height:1.6;">⚠️ 这只猫失踪了！如果你见过它，请尽快联系猫协（抖音 / 小红书 / B 站搜「这里油只喵」）。任何线索都可能是它回家的希望。</div>';
  else if (cat.life === '失踪已久') statusBanner = '<div style="background:#9f1239;color:#fff;padding:12px 14px;border-radius:10px;margin-bottom:12px;font-weight:600;font-size:14px;line-height:1.6;">⚠️ 这只猫已失踪很久了。若你还见过它，请给猫协留言（抖音 / 小红书 / B 站「这里油只喵」），任何线索都很宝贵。</div>';
  else if (cat.life === '已领养') statusBanner = '<div style="background:#10b981;color:#fff;padding:10px 14px;border-radius:10px;margin-bottom:12px;font-size:14px;">🏠 这只猫已被领养，开启新生活啦～</div>';
  const infoRows = [
    ['性别', GENDER_LABEL[cat.gender] || '未知'],
    ['年龄', cat.age],
    ['外号', cat.nickname],
    ['毛色', cat.color],
    ['区域', cat.area],
    ['绝育状态', cat.status || '未知'],
    ['首次发现', cat.firstSeen],
    ['离开时间', cat.leftAt || (cat.life === '去喵星了' ? '去喵星了' : '')],
    ['照料人', cat.caretaker],
  ];

  // 收集该猫的所有关系（正向 + 反向）
  const relationItems = [];
  relations.forEach((rel) => {
    if (rel.from === cat.id) {
      const other = catById.get(rel.to);
      if (other) {
        relationItems.push({ type: rel.relation, other, note: rel.note, reverse: false });
      }
    } else if (rel.to === cat.id) {
      const other = catById.get(rel.from);
      if (other) {
        relationItems.push({ type: rel.relation, other, note: rel.note, reverse: true });
      }
    }
  });

  // 自动推断的兄弟姐妹（同父或同母），标注"自动推断"
  deriveSiblingRelations(cats, relations).forEach((d) => {
    if (d.from === cat.id) {
      const other = catById.get(d.to);
      if (other) relationItems.push({ type: '兄弟姐妹', other, note: '自动推断', reverse: false });
    } else if (d.to === cat.id) {
      const other = catById.get(d.from);
      if (other) relationItems.push({ type: '兄弟姐妹', other, note: '自动推断', reverse: true });
    }
  });

  const relationHtml = relationItems.length
    ? relationItems.map((item) => {
        // 方向化：无论从哪只猫看，都显示"谁是谁的妈妈"等明确描述
        const aName = item.reverse ? item.other.name : cat.name;
        const bName = item.reverse ? cat.name : item.other.name;
        const desc = relationDescText(item.type, aName, bName);
        return `
          <div class="relation-item">
            <span class="relation-desc">🐾 ${escapeHtml(desc)}</span>
            ${item.note ? `<span class="relation-note">（${escapeHtml(item.note)}）</span>` : ''}
          </div>`;
      }).join('')
    : '<div class="relation-empty">暂无关系记录</div>';

  const infoHtml = infoRows
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `<div class="modal-info-row"><span class="modal-info-key">${k}</span><span class="modal-info-val">${escapeHtml(v)}</span></div>`)
    .join('');

  const evts = Array.isArray(cat.events) ? cat.events : [];
  const eventsHtml = evts.length
    ? '<div class="modal-events">' + evts.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((ev) => `
        <div class="modal-event-item">
          <div class="modal-event-date">${escapeHtml(ev.date || '')}</div>
          <div class="modal-event-text">${escapeHtml(ev.text || '')}</div>
          ${Array.isArray(ev.images) && ev.images.length ? `<div class="modal-event-imgs">${ev.images.map((src) => `<img src="${photoUrl(src)}" alt="" loading="lazy" onclick="window.openLightbox(this.src,'')" style="cursor:zoom-in;">`).join('')}</div>` : ''}
        </div>`).join('') + '</div>'
    : '';

  // 相册 = 猫自己的照片 + 关联它的故事配图（按 src 去重，保留相册优先）
  const albumItems = [];
  const albumSeen = new Set();
  (Array.isArray(cat.album) ? cat.album : []).forEach((src) => {
    if (albumSeen.has(src)) return;
    albumSeen.add(src);
    albumItems.push({ src, title: cat.name });
  });
  collectStoryAlbumImages(cat, cats).forEach((it) => {
    if (albumSeen.has(it.src)) return;
    albumSeen.add(it.src);
    albumItems.push(it);
  });
  const albumHtml = albumItems.length
    ? `<div class="modal-album">${albumItems.map((it) => `
        <div class="album-thumb">${it.title && it.title !== cat.name ? `<span class="album-badge" title="来自故事：${escapeHtml(it.title)}">📖 故事</span>` : ''}<img src="${thumbUrl(it.src)}" alt="" loading="lazy" onerror="this.style.display='none'" data-full="${photoUrl(it.src)}" onclick="openLightbox(this.dataset.full, '${escapeHtml(it.title || cat.name)}', this.src)" style="cursor:zoom-in;"></div>
      `).join('')}</div>`
    : '<div class="relation-empty">暂无相册</div>';

  const modal = document.getElementById('modal');
  if (!modal) return;
  modal.innerHTML = `
    <div class="modal-backdrop" data-close="1"></div>
    <div class="modal-panel">
      <button class="modal-close" data-close="1" aria-label="关闭">×</button>
      <div class="modal-header">
        <img class="modal-photo" src="${photo}" alt="" onerror="this.src='${DEFAULT_PHOTO}'" onclick="openLightbox(this.src, '${escapeHtml(cat.name)}')" style="cursor:zoom-in;">
        <div class="modal-title-block">
          <h2 class="modal-name">${escapeHtml(cat.name)}</h2>
          <div class="modal-tags">
            ${cat.life === '去喵星了' || cat.leftAt ? '<span class="tag tag-past">离世' + (cat.leftAt ? ' ' + escapeHtml(cat.leftAt) : '') + '</span>' : ''}
            <span class="tag tag-${cat.gender === 'male' ? 'male' : (cat.gender === 'female' ? 'female' : 'unknown')}">${GENDER_LABEL[cat.gender] || '未知'}</span>
            <span class="tag tag-${STATUS_TAG[cat.status] || 'unneutered'}">${escapeHtml(cat.status || '')}</span>
          </div>
        </div>
      </div>
      ${statusBanner}
      ${cat.description ? `<p class="modal-desc">${escapeHtml(cat.description)}</p>` : ''}
      <div class="modal-info">${infoHtml}</div>
      <div class="modal-like" data-like-for="${cat.id}"></div>
      <div style="margin:8px 0;display:flex;gap:8px;flex-wrap:wrap;"><a class="btn btn-sm" href="./profile.html#${cat.id}">📖 查看完整档案</a><button class="btn btn-sm" id="corr-from-modal" data-cat-id="${cat.id}">🐾 信息有误？更正</button></div>
      <h3 class="modal-section-title">关系</h3>
      <div class="modal-relations">${relationHtml}</div>
      ${eventsHtml ? `<h3 class="modal-section-title">📅 最近事件</h3>${eventsHtml}` : ''}
      <h3 class="modal-section-title">相册</h3>
      ${albumHtml}
    </div>`;

  modal.classList.add('open');
  modal.style.display = 'flex';

  const close = () => {
    modal.classList.remove('open');
    modal.style.display = 'none';
  };
  modal.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close));
  window.__closeModal = close;

  const likeBox = modal.querySelector('[data-like-for="' + cat.id + '"]');
  if (likeBox) mountLikeButton(likeBox, cat.id);
}

/**
 * 绑定标签页切换（地图 / 关系图）。
 * @param {Object} views 各视图容器映射，如 { map: '#map-view', graph: '#graph-view' }
 * @param {Object} opts 可选，{ onGraphShow } 切换到位图时回调
 */
export function bindTabs(views, opts = {}) {
  const tabBar = document.querySelector('.tab-bar');
  if (!tabBar) return;

  tabBar.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const key = tab.dataset.tab;
      tabBar.querySelectorAll('[data-tab]').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      Object.entries(views).forEach(([viewKey, selector]) => {
        const el = document.querySelector(selector);
        if (!el) return;
        el.classList.toggle('active', viewKey === key);
      });

      // 切到关系图时延迟 resize，确保容器尺寸生效
      if (key === 'graph' && typeof opts.onGraphShow === 'function') {
        setTimeout(() => opts.onGraphShow(), 100);
      }
    });
  });
}

/**
 * 在页面右下角显示一条短暂的 toast 提示。
 * @param {string} message 提示内容
 */
export function openCatPanel() {
  const panel = document.getElementById('cat-panel');
  if (!panel) return;
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  // 面板打开后才加载真实照片，避免页面加载时并发 39 张图卡死
  loadCatListPhotos();
}
export function closeCatPanel() {
  const panel = document.getElementById('cat-panel');
  if (!panel) return;
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}
/**
 * 绑定猫咪列表浮层按钮（地图下的 📋 按钮 + 关闭按钮）。
 */
/**
 * 更新首页统计：已知流浪猫总数 + 已绝育数量。
 */
/**
 * 渲染「最近事件」总入口：汇总所有猫咪的事件，按日期倒序展示。
 * @param {Array} cats
 */
export function renderEventsTimeline(cats) {
  const box = document.getElementById('events-timeline');
  if (!box) return;
  const list = Array.isArray(cats) ? cats : [];

  // 汇总：每条事件带上猫咪信息
  const allEvents = [];
  list.forEach((cat) => {
    (cat.events || []).forEach((ev) => {
      allEvents.push({ cat, date: ev.date || '', text: ev.text || '', images: ev.images || [] });
    });
  });

  // 按日期倒序（有日期的在前），无日期的排最后
  allEvents.sort((a, b) => {
    const da = a.date || '';
    const db = b.date || '';
    if (da && db) return db.localeCompare(da);
    if (da) return -1;
    if (db) return 1;
    return 0;
  });

  if (!allEvents.length) {
    box.innerHTML = '<div class="events-empty">📅 还没有记录事件～<br>等猫咪们有新动态（绝育、救助、新照）就会出现在这里。</div>';
    return;
  }

  box.innerHTML = allEvents.map((item) => {
    const cat = item.cat;
    const photo = thumbUrl(cat.photo); // 时间线头像用缩略图
    const imgs = item.images.length
      ? '<div class="tl-event-imgs">' + item.images.map((src) => {
          return '<img src="' + thumbUrl(src) + '" data-full="' + photoUrl(src) + '" alt="" loading="lazy" onclick="openLightbox(this.dataset.full, \'\', this.src)">';
        }).join('') + '</div>'
      : '';
    return `
      <div class="tl-event" data-cat-id="${cat.id}">
        <img class="tl-event-avatar" src="${photo}" alt="" onerror="this.src='${DEFAULT_PHOTO}'"
             onclick="location.href='profile.html#' + this.parentElement.dataset.catId">
        <div class="tl-event-body">
          <div class="tl-event-head">
            <span class="tl-event-date">${escapeHtml(item.date) || '未注明日期'}</span>
            <a class="tl-event-cat" href="./profile.html#${cat.id}">${escapeHtml(cat.name)}</a>
          </div>
          <div class="tl-event-text">${escapeHtml(item.text) || ''}</div>
          ${imgs}
        </div>
      </div>`;
  }).join('');
}

export function updateStats(cats) {
  const list = Array.isArray(cats) ? cats : [];
  const totalEl = document.getElementById('stat-total');
  const neuEl = document.getElementById('stat-neutered');
  const fabEl = document.getElementById('fab-count');
  if (totalEl) totalEl.textContent = String(list.length);
  if (neuEl) neuEl.textContent = String(list.filter((c) => c.status === '已绝育').length);
  if (fabEl) fabEl.textContent = String(list.length);
}

/**
 * 绑定「加入我们 / 关于油喵」折叠面板。
 */
export function bindJoin() {
  const btn = document.getElementById('join-btn');
  const panel = document.getElementById('join-panel');
  if (!btn || !panel) return;
  btn.addEventListener('click', () => {
    const hidden = panel.hidden;
    panel.hidden = !hidden;
    btn.textContent = hidden ? '✕ 收起' : '💛 加入我们 · 关于油喵';
    if (!hidden) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  const poster = panel.querySelector('.join-poster img');
  if (poster) poster.addEventListener('click', () => {
    openLightbox(poster.getAttribute('src'), '油喵部门介绍 · 长按图片扫码加入我们');
  });
}

export function bindCatPanel() {
  const fab = document.getElementById('list-fab');
  if (fab) fab.addEventListener('click', openCatPanel);
  const closeBtn = document.getElementById('cat-panel-close');
  if (closeBtn) closeBtn.addEventListener('click', closeCatPanel);
  const panel = document.getElementById('cat-panel');
  if (panel) {
    panel.addEventListener('click', (e) => {
      if (e.target === panel) closeCatPanel();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('cat-panel') && document.getElementById('cat-panel').classList.contains('open')) {
      closeCatPanel();
    }
  });
}
export function showToast(message) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => el.classList.remove('show'), 4200);
}

/**
 * 更正猫咪信息：给访客一个提交更正内容的渠道，
 * 整理成文字后复制/发邮件给站长（纯静态站无法直接推送到后端）。
 */
let _corrCats = [];
export function openCorrection(cats, catId) {
  _corrCats = Array.isArray(cats) ? cats : [];
  const modal = document.getElementById('correction-modal');
  if (!modal) return;
  const sel = document.getElementById('corr-cat');
  if (sel) {
    sel.innerHTML = _corrCats
      .filter((c) => c && c.id)
      .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}${c.nickname ? '（' + escapeHtml(c.nickname) + '）' : ''}</option>`)
      .join('');
    if (catId && sel.querySelector(`option[value="${catId}"]`)) sel.value = catId;
  }
  const txt = document.getElementById('corr-text');
  if (txt) txt.value = '';
  const note = document.getElementById('corr-note');
  if (note) note.textContent = '提交后会生成文字，点「复制」粘贴发微信给站长；或点「用邮件发送」自动发到站长邮箱（' + (_corrEmail || '未配置') + '）。';
  const mailBtn = document.getElementById('corr-mail');
  if (mailBtn) mailBtn.disabled = !_corrEmail;
  modal.classList.add('open');
  modal.style.display = 'flex';
}
function closeCorrection() {
  const modal = document.getElementById('correction-modal');
  if (modal) { modal.classList.remove('open'); modal.style.display = 'none'; }
}
function buildCorrectionText() {
  const sel = document.getElementById('corr-cat');
  const txt = document.getElementById('corr-text');
  const catName = sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].text : '';
  const body = (txt && txt.value || '').trim();
  return '【猫咪信息更正】\n🐱 猫咪：' + catName + '\n✍️ 更正内容：' + (body || '（未填写）') + '\n\n—— 来自广油猫咪地图访客';
}
function copyCorrection() {
  const text = buildCorrectionText();
  function done() {
    showToast('✅ 已复制！粘贴到微信发给站长即可');
    closeCorrection();
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => { legacyCopy(text); done(); });
  } else { legacyCopy(text); done(); }
}
function legacyCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
  } catch (e) {}
}
function mailCorrection() {
  const text = buildCorrectionText();
  const subject = encodeURIComponent('猫咪信息更正：' + (document.getElementById('corr-cat') && document.getElementById('corr-cat').selectedOptions[0] ? document.getElementById('corr-cat').selectedOptions[0].text : ''));
  const body = encodeURIComponent(text);
  window.location.href = 'mailto:' + (_corrEmail || '') + '?subject=' + subject + '&body=' + body;
}
/**
 * 初始化更正信息入口：绑定浮动按钮 + 弹窗内按钮。
 * @param {Array} cats 猫咪数组（用于下拉选择）
 */
let _corrEmail = '';
export function initCorrection(cats, siteConfig) {
  _corrCats = Array.isArray(cats) ? cats : [];
  if (siteConfig) _corrEmail = siteConfig.feedbackEmail || '';
  const fab = document.getElementById('corr-fab');
  if (fab) fab.addEventListener('click', () => openCorrection(_corrCats));
  const modal = document.getElementById('correction-modal');
  if (modal) {
    modal.querySelectorAll('[data-cclose]').forEach((el) => el.addEventListener('click', closeCorrection));
    const copy = document.getElementById('corr-copy');
    if (copy) copy.addEventListener('click', copyCorrection);
    const mail = document.getElementById('corr-mail');
    if (mail) mail.addEventListener('click', mailCorrection);
  }
  // 详情弹窗里的「更正」按钮（每次 showModal 重新挂载，用事件委托）
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#corr-from-modal');
    if (btn) openCorrection(_corrCats, btn.dataset.catId);
  });
}

/**
 * 渲染「故事集」视图：按猫聚合展示所有故事
 */
// 故事内容超过该长度时折叠展示，点击「展开全文」查看全部
const STORY_TRUNCATE = 280;
// 「长文」判定：正文达到该字数即算长文（供「只看长文」筛选）
const LONG_STORY_CHARS = 300;
// 故事集筛选状态（跨标签页切换保留）
let _storyFilter = { q: '', date: '', long: false };

// 故事排序时间：优先用 date 字段（YYYY-MM[-DD]），否则回退到 id 里的时间戳
function storyTs(s) {
  const d = String((s && s.date) || '').replace(/-/g, '');
  if (/^\d{6,8}$/.test(d)) return Number(d + '000000'.slice(0, 8 - d.length));
  const m = String((s && s.id) || '').match(/_?(\d{10,13})/);
  return m ? Number(m[1]) : 0;
}

function storyContentHtml(s, catId, idx) {
  const text = s.content || '';
  if (text.length <= STORY_TRUNCATE) {
    return '<div class="story-item-content">' + escapeHtml(text) + '</div>';
  }
  const id = 'sc-' + catId + '-' + idx;
  const preview = text.slice(0, STORY_TRUNCATE);
  return '<div class="story-item-content">'
    + '<span class="story-content-preview">' + escapeHtml(preview) + '…</span>'
    + '<button type="button" class="story-fold-btn" data-act="expand" data-id="' + id + '" aria-expanded="false">展开全文 ▾</button>'
    + '<span class="story-content-full" id="' + id + '" hidden>' + escapeHtml(text) + '</span>'
    + '</div>';
}

export function renderStoriesTimeline(cats, siteConfig) {
  const box = document.getElementById('stories-timeline');
  if (!box) return;
  // 事件委托：展开/收起（只绑一次）
  if (!box.__storyFoldBound) {
    box.addEventListener('click', (e) => {
      const btn = e.target.closest ? e.target.closest('.story-fold-btn') : null;
      if (!btn) return;
      const item = btn.closest('.story-item');
      if (!item) return;
      const preview = item.querySelector('.story-content-preview');
      const full = item.querySelector('.story-content-full');
      if (!preview || !full) return;
      if (btn.dataset.act === 'expand') {
        preview.style.display = 'none';
        full.hidden = false;
        btn.textContent = '收起 ▲';
        btn.dataset.act = 'collapse';
        btn.setAttribute('aria-expanded', 'true');
      } else {
        preview.style.display = '';
        full.hidden = true;
        btn.textContent = '展开全文 ▾';
        btn.dataset.act = 'expand';
        btn.setAttribute('aria-expanded', 'false');
      }
    });
    box.__storyFoldBound = true;
  }

  const list = Array.isArray(cats) ? cats : [];
  const catMap = new Map(list.map((c) => [c.id, c]));
  // 去重：同一篇故事（按 id）只保留一份，卡片上展示所有关联猫头像
  const storyMap = new Map();
  list.forEach((cat) => {
    let arr;
    if (Array.isArray(cat.stories) && cat.stories.length) {
      arr = cat.stories;
    } else if (cat.story && String(cat.story).trim()) {
      arr = [{ id: '__legacy_' + cat.id, title: '', content: cat.story, images: [] }];
    } else {
      arr = [];
    }
    arr.forEach((s) => {
      const sid = s.id || '__legacy_' + cat.id;
      if (storyMap.has(sid)) return;
      const linked = (Array.isArray(s.cats) ? s.cats : []).filter((cid) => catMap.has(cid));
      storyMap.set(sid, {
        id: sid,
        date: s.date || '',
        title: s.title || '',
        content: s.content || '',
        images: Array.isArray(s.images) ? s.images : [],
        cats: linked.length ? linked : [cat.id]
      });
    });
  });
  const stories = Array.from(storyMap.values());
  if (!stories.length) {
    box.innerHTML = '<div class="events-empty">📖 还没有故事，等猫咪们的日常被记录下来～</div>';
    return;
  }
  // 日期快捷筛选：统计实际出现的日期（含"无日期"），生成点击即选的 chip
  const dateCounts = new Map();
  stories.forEach((s) => { const k = s.date || '__none'; dateCounts.set(k, (dateCounts.get(k) || 0) + 1); });
  const dateKeys = Array.from(dateCounts.keys()).sort((a, b) => { if (a === '__none') return 1; if (b === '__none') return -1; return String(b).localeCompare(String(a)); });
  // 筛选栏（只搭一次；筛选状态在重渲染/切标签时保留）
  const MAX_VISIBLE_DATES = 3;
  const dateOnlyKeys = dateKeys.filter((k) => k !== '__none');
  const visibleDateKeys = dateOnlyKeys.slice(0, MAX_VISIBLE_DATES);
  const moreDateKeys = dateOnlyKeys.slice(MAX_VISIBLE_DATES);
  const hasNone = dateCounts.has('__none');
  const chipHtml = (k) => '<button type="button" class="story-filter-date-chip' + (_storyFilter.date === k ? ' active' : '') + '" data-date="' + k + '">' + (k === '__none' ? '无日期' : k) + ' · ' + dateCounts.get(k) + '</button>';
  if (!box.__storyFilterBound) {
    const chips = ['<button type="button" class="story-filter-date-chip' + (_storyFilter.date === '' ? ' active' : '') + '" data-date="">全部</button>'];
    visibleDateKeys.forEach((k) => chips.push(chipHtml(k)));
    if (hasNone) chips.push(chipHtml('__none'));
    const moreChips = moreDateKeys.length ? moreDateKeys.map(chipHtml).join('') : '';
    box.innerHTML =
      '<div class="story-filter-bar">' +
        '<div class="story-filter-row">' +
          '<input type="search" class="story-filter-q" placeholder="🔍 搜索标题 / 正文…" autocomplete="off">' +
          '<label class="story-filter-long"><input type="checkbox" class="story-filter-long-cb"> 📏 只看长文</label>' +
        '</div>' +
        '<div class="story-filter-dates">' + chips.join('') +
          (moreDateKeys.length ? '<button type="button" class="story-filter-more">更多日期 ▾</button>' : '') +
        '</div>' +
        (moreDateKeys.length ? '<div class="story-filter-dates-more" hidden>' + moreChips + '</div>' : '') +
        '<div class="story-filter-count"></div>' +
      '</div>' +
      '<div class="story-filter-results"></div>';
    const qEl = box.querySelector('.story-filter-q');
    const longCb = box.querySelector('.story-filter-long-cb');
    const rerender = () => {
      _storyFilter.q = qEl.value.trim();
      _storyFilter.long = longCb.checked;
      renderStoriesTimeline(list, siteConfig);
    };
    qEl.addEventListener('input', rerender);
    longCb.addEventListener('change', rerender);
    box.querySelectorAll('.story-filter-date-chip').forEach((btn) => {
      btn.addEventListener('click', () => { _storyFilter.date = btn.dataset.date; renderStoriesTimeline(list, siteConfig); });
    });
    const moreBtn = box.querySelector('.story-filter-more');
    const moreEl = box.querySelector('.story-filter-dates-more');
    if (moreBtn && moreEl) {
      box.__storyMoreBtn = moreBtn;
      box.__storyMoreEl = moreEl;
      box.__storyMoreKeys = moreDateKeys;
      const setMore = (open) => {
        _storyFilter.datesOpen = open;
        moreEl.hidden = !open;
        moreBtn.textContent = open ? '收起日期 ▴' : '更多日期 ▾ (' + moreDateKeys.length + ')';
      };
      moreBtn.addEventListener('click', () => setMore(moreEl.hidden));
      setMore(_storyFilter.datesOpen || moreDateKeys.includes(_storyFilter.date));
    }
    box.__storyFilterBound = true;
  } else {
    const qEl = box.querySelector('.story-filter-q'); if (qEl) qEl.value = _storyFilter.q;
    const longCb = box.querySelector('.story-filter-long-cb'); if (longCb) longCb.checked = _storyFilter.long;
    box.querySelectorAll('.story-filter-date-chip').forEach((btn) => { btn.classList.toggle('active', btn.dataset.date === _storyFilter.date); });
    const moreBtn = box.__storyMoreBtn;
    const moreEl = box.__storyMoreEl;
    if (moreBtn && moreEl) {
      const open = _storyFilter.datesOpen || (box.__storyMoreKeys && box.__storyMoreKeys.includes(_storyFilter.date));
      moreEl.hidden = !open;
      moreBtn.textContent = open ? '收起日期 ▴' : '更多日期 ▾ (' + box.__storyMoreKeys.length + ')';
    }
  }
  // 应用筛选：关键词 / 日期 / 只看长文
  const q = _storyFilter.q.toLowerCase();
  const dateF = _storyFilter.date;
  const longOnly = _storyFilter.long;
  const visible = stories.filter((s) => {
    if (dateF === '__none' && s.date) return false;
    if (dateF && dateF !== '__none' && s.date !== dateF) return false;
    if (longOnly && String(s.content).length < LONG_STORY_CHARS) return false;
    if (q && !((s.title + ' ' + s.content).toLowerCase().includes(q))) return false;
    return true;
  });
  // 置顶（最多 3 篇，仅在筛选结果内）按置顶顺序固定最前；其余按日期（无日期按上传时间）从新到旧
  const pinOrder = (siteConfig && Array.isArray(siteConfig.storyPinOrder)) ? siteConfig.storyPinOrder.filter((sid) => storyMap.has(sid) && visible.some((x) => x.id === sid)) : [];
  const pinSet = new Set(pinOrder);
  const pinned = pinOrder.map((sid) => storyMap.get(sid));
  const rest = visible.filter((s) => !pinSet.has(s.id)).sort((a, b) => storyTs(b) - storyTs(a) || String(a.title).localeCompare(String(b.title), 'zh'));
  const ordered = pinned.concat(rest);
  const resultsBox = box.querySelector('.story-filter-results');
  const countBox = box.querySelector('.story-filter-count');
  if (countBox) countBox.textContent = '共 ' + visible.length + ' 篇' + (visible.length !== stories.length ? '（全部 ' + stories.length + ' 篇）' : '');
  if (!ordered.length) {
    resultsBox.innerHTML = '<div class="events-empty">😿 没有符合条件的猫咪故事，试试清空筛选条件～</div>';
    return;
  }
  resultsBox.innerHTML = ordered.map((s, si) => {
    const dateLabel = storyDisplayDate(s);
    const pinHtml = pinSet.has(s.id) ? '<span class="story-item-pin">📌 置顶</span>' : '';
    const dateHtml = dateLabel ? '<span class="story-item-date">🗓 ' + escapeHtml(dateLabel) + '</span>' : '';
    const titleHtml = s.title ? '<div class="story-item-title">' + escapeHtml(s.title) + '</div>' : '<div class="story-item-title story-item-no-title">无标题</div>';
    const catsHtml = (s.cats && s.cats.length) ? '<div class="story-item-cats"><span class="story-item-cats-label">' + (s.cats.length > 1 ? '🐾 关联猫咪' : '🐱 猫咪') + '</span>' + s.cats.map((cid) => {
      const cc = catMap.get(cid);
      if (!cc) return '';
      return '<a class="story-item-cat" href="./profile.html#' + escapeHtml(cc.id) + '" title="点击查看「' + escapeHtml(cc.name) + '」档案"><img src="' + thumbUrl(cc.photo) + '" alt="" onerror="this.src=\'' + DEFAULT_PHOTO + '\'"><span>' + escapeHtml(cc.name) + '</span></a>';
    }).join('') + '</div>' : '';
    const contentHtml = s.content ? storyContentHtml(s, si, 0) : '';
    const imgsHtml = s.images.length ? '<div class="story-item-imgs">' + s.images.map((src) => '<img src="' + thumbUrl(src) + '" data-full="' + photoUrl(src) + '" data-caption="' + escapeHtml(s.title || '') + '" alt="" loading="lazy" onclick="window.openLightbox(this.dataset.full || this.src, this.dataset.caption, this.src)" style="cursor:zoom-in;">').join('') + '</div>' : '';
    return '<div class="story-item">' + pinHtml + dateHtml + titleHtml + catsHtml + contentHtml + imgsHtml + '<div class="story-item-like" data-story="' + escapeHtml(String(s.id)) + '"></div>' + '</div>';
  }).join('');
  // 为每篇故事挂载独立点赞按钮
  resultsBox.querySelectorAll('.story-item-like[data-story]').forEach((el) => {
    mountStoryLikeButton(el, el.dataset.story);
  });
}

// 故事日期显示：2026-08-28 → "2026 年 8 月 28 日"
function storyDateLabel(date) {
  const s = String(date || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (!m) return s;
  let out = m[1] + ' 年';
  if (m[2]) out += ' ' + parseInt(m[2], 10) + ' 月';
  if (m[3]) out += ' ' + parseInt(m[3], 10) + ' 日';
  return out;
}
// 展示用日期：优先显式 date；没有则用 id 里的创建时间戳兜底，保证每篇都显示日期
function storyDisplayDate(s) {
  if (s && s.date) return storyDateLabel(s.date);
  const ts = storyTs(s);
  if (!ts) return '';
  const d = new Date(ts);
  return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
}

// ---------- 猫咪小知识 ----------
const KNOWLEDGE_TRUNCATE = 320;
let _knowledgeFilter = { q: '' };
let _knowledgeCats = [];

function knowledgeTs(k) {
  const d = String((k && k.date) || '').replace(/-/g, '');
  if (/^\d{6,8}$/.test(d)) return Number(d + '000000'.slice(0, 8 - d.length));
  const m = String((k && k.id) || '').match(/_?(\d{10,13})/);
  return m ? Number(m[1]) : 0;
}
function knowledgeDisplayDate(k) {
  if (k && k.date) return storyDateLabel(k.date);
  const ts = knowledgeTs(k);
  if (!ts) return '';
  const d = new Date(ts);
  return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
}
function knowledgeContentHtml(k, idx) {
  const text = k.content || '';
  if (text.length <= KNOWLEDGE_TRUNCATE) {
    return '<div class="knowledge-item-content">' + escapeHtml(text) + '</div>';
  }
  const id = 'kc-' + idx;
  const preview = text.slice(0, KNOWLEDGE_TRUNCATE);
  return '<div class="knowledge-item-content">'
    + '<span class="knowledge-content-preview">' + escapeHtml(preview) + '…</span>'
    + '<button type="button" class="story-fold-btn" data-act="expand" data-id="' + id + '" aria-expanded="false">展开全文 ▾</button>'
    + '<span class="knowledge-content-full" id="' + id + '" hidden>' + escapeHtml(text) + '</span>'
    + '</div>';
}

export function renderKnowledgeTimeline(knowledge, cats) {
  const box = document.getElementById('knowledge-timeline');
  if (!box) return;
  // 事件委托：展开/收起（只绑一次）
  if (!box.__knowledgeFoldBound) {
    box.addEventListener('click', (e) => {
      const btn = e.target.closest ? e.target.closest('.story-fold-btn') : null;
      if (!btn) return;
      const item = btn.closest('.knowledge-item');
      if (!item) return;
      const preview = item.querySelector('.knowledge-content-preview');
      const full = item.querySelector('.knowledge-content-full');
      if (!preview || !full) return;
      if (btn.dataset.act === 'expand') {
        preview.style.display = 'none';
        full.hidden = false;
        btn.textContent = '收起 ▲';
        btn.dataset.act = 'collapse';
        btn.setAttribute('aria-expanded', 'true');
      } else {
        preview.style.display = '';
        full.hidden = true;
        btn.textContent = '展开全文 ▾';
        btn.dataset.act = 'expand';
        btn.setAttribute('aria-expanded', 'false');
      }
    });
    box.__knowledgeFoldBound = true;
  }

  _knowledgeCats = Array.isArray(cats) ? cats : _knowledgeCats;
  const list = (Array.isArray(knowledge) ? knowledge : []).filter((k) => k && (k.title || k.content || (Array.isArray(k.images) && k.images.length)));
  const catMap = new Map(_knowledgeCats.map((c) => [c.id, c]));

  if (!box.__knowledgeFilterBound) {
    box.innerHTML =
      '<div class="story-filter-bar">' +
        '<div class="story-filter-row">' +
          '<input type="search" class="knowledge-filter-q" placeholder="🔍 搜索标题 / 正文…" autocomplete="off">' +
        '</div>' +
        '<div class="story-filter-count"></div>' +
      '</div>' +
      '<div class="knowledge-filter-results"></div>';
    const qEl = box.querySelector('.knowledge-filter-q');
    qEl.addEventListener('input', () => {
      _knowledgeFilter.q = qEl.value.trim();
      renderKnowledgeTimeline(list, _knowledgeCats);
    });
    box.__knowledgeFilterBound = true;
  } else {
    const qEl = box.querySelector('.knowledge-filter-q');
    if (qEl) qEl.value = _knowledgeFilter.q;
  }

  const q = _knowledgeFilter.q.toLowerCase();
  const visible = list.filter((k) => {
    if (q && !((k.title || '') + ' ' + (k.content || '')).toLowerCase().includes(q)) return false;
    return true;
  });
  const countBox = box.querySelector('.story-filter-count');
  if (countBox) countBox.textContent = '共 ' + visible.length + ' 篇' + (visible.length !== list.length ? '（全部 ' + list.length + ' 篇）' : '');
  const resultsBox = box.querySelector('.knowledge-filter-results');
  if (!visible.length) {
    resultsBox.innerHTML = '<div class="events-empty">📚 还没有猫咪小知识，等站长慢慢补充～</div>';
    return;
  }
  const ordered = visible.slice().sort((a, b) => knowledgeTs(b) - knowledgeTs(a) || String(a.title || '').localeCompare(String(b.title || ''), 'zh'));
  resultsBox.innerHTML = ordered.map((k, ki) => {
    const dateLabel = knowledgeDisplayDate(k);
    const dateHtml = dateLabel ? '<span class="story-item-date">🗓 ' + escapeHtml(dateLabel) + '</span>' : '';
    const catHtml = k.category ? '<span class="knowledge-category">' + escapeHtml(k.category) + '</span>' : '';
    const titleHtml = k.title ? '<div class="knowledge-item-title">' + escapeHtml(k.title) + '</div>' : '<div class="knowledge-item-title knowledge-item-no-title">无标题</div>';
    const catsHtml = (Array.isArray(k.cats) && k.cats.length) ? '<div class="knowledge-item-cats"><span class="story-item-cats-label">🐾 关联猫咪</span>' + k.cats.map((cid) => {
      const cc = catMap.get(cid);
      if (!cc) return '';
      return '<a class="story-item-cat" href="./profile.html#' + escapeHtml(cc.id) + '" title="点击查看「' + escapeHtml(cc.name) + '」档案"><img src="' + thumbUrl(cc.photo) + '" alt="" onerror="this.src=\'' + DEFAULT_PHOTO + '\'"><span>' + escapeHtml(cc.name) + '</span></a>';
    }).join('') + '</div>' : '';
    const contentHtml = k.content ? knowledgeContentHtml(k, ki) : '';
    const imgsHtml = (Array.isArray(k.images) && k.images.length) ? '<div class="knowledge-item-imgs">' + k.images.map((src) => '<img src="' + thumbUrl(src) + '" data-full="' + photoUrl(src) + '" data-caption="' + escapeHtml(k.title || '') + '" alt="" loading="lazy" onclick="window.openLightbox(this.dataset.full || this.src, this.dataset.caption, this.src)" style="cursor:zoom-in;">').join('') + '</div>' : '';
    return '<div class="knowledge-item">' + dateHtml + catHtml + titleHtml + catsHtml + contentHtml + imgsHtml + '</div>';
  }).join('');
}

// 挂到 window，供地图标记等内联 onclick 使用
window.openLightbox = openLightbox;
