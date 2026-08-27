// ui.js — UI 模块（列表渲染、详情弹窗、标签页、HTML 转义）
import { DEFAULT_PHOTO } from './config.js';
const IMG_CACHE_BUST = Date.now();
function photoUrl(src) {
  if (!src) return DEFAULT_PHOTO;
  if (/^https?:/i.test(src) || /\?v=/.test(src)) return src;
  return src + '?v=' + IMG_CACHE_BUST;
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
      const photo = photoUrl(cat.photo);
      return `
      <div class="cat-item" data-cat-id="${cat.id}" tabindex="0" role="button" aria-label="查看 ${escapeHtml(cat.name)}">
        <div class="cat-item-photo${cat.life === '失踪' ? ' ring-missing' : (cat.life === '失踪已久' ? ' ring-missing-old' : (cat.life === '已领养' ? ' ring-adopted' : ''))}">
          <img src="${photo}" alt="" loading="lazy"
               onerror="this.style.display='none';this.parentElement.classList.add('cat-item-fallback');">
          <span class="cat-item-fallback-icon">🐱</span>
        </div>
        <div class="cat-item-info">
          <div class="cat-item-name">
            ${escapeHtml(cat.name)}
            ${cat.nickname && !cat.nickname.startsWith('img-') ? '<span class="cat-item-nick">（' + escapeHtml(cat.nickname) + '）</span>' : ''}
            ${cat.leftAt ? '<span class="tag tag-past">过往</span>' : ''}
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
    ['离开时间', cat.leftAt],
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

  const relationHtml = relationItems.length
    ? relationItems.map((item) => {
        const prefix = item.reverse ? '↔ ' : '';
        const label = item.type;
        return `
          <div class="relation-item">
            <span class="relation-type">${prefix}${escapeHtml(label)}</span>
            <span class="relation-other">→ ${escapeHtml(item.other.name)}</span>
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
          ${Array.isArray(ev.images) && ev.images.length ? `<div class="modal-event-imgs">${ev.images.map((src) => `<img src="${photoUrl(src)}" alt="" loading="lazy" onclick="window.open(this.src,'_blank')">`).join('')}</div>` : ''}
        </div>`).join('') + '</div>'
    : '';

  const album = Array.isArray(cat.album) ? cat.album : [];
  const albumHtml = album.length
    ? `<div class="modal-album">${album.map((src) => `
        <div class="album-thumb"><img src="${photoUrl(src)}" alt="" loading="lazy" onerror="this.style.display='none'"></div>
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
            ${cat.leftAt ? '<span class="tag tag-past">过往</span>' : ''}
            <span class="tag tag-${cat.gender === 'male' ? 'male' : (cat.gender === 'female' ? 'female' : 'unknown')}">${GENDER_LABEL[cat.gender] || '未知'}</span>
            <span class="tag tag-${STATUS_TAG[cat.status] || 'unneutered'}">${escapeHtml(cat.status || '')}</span>
          </div>
        </div>
      </div>
      ${statusBanner}
      ${cat.description ? `<p class="modal-desc">${escapeHtml(cat.description)}</p>` : ''}
      <div class="modal-info">${infoHtml}</div>
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
    const photo = photoUrl(cat.photo);
    const imgs = item.images.length
      ? '<div class="tl-event-imgs">' + item.images.map((src) => {
          return '<img src="' + photoUrl(src) + '" alt="" loading="lazy" onclick="openLightbox(this.src)">';
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
  if (totalEl) totalEl.textContent = String(list.length);
  if (neuEl) neuEl.textContent = String(list.filter((c) => c.status === '已绝育').length);
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
  return '【猫咪信息更正】\n🐱 猫咪：' + catName + '\n✍️ 更正内容：' + (body || '（未填写）') + '\n\n—— 来自校园猫咪地图访客';
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
 * 通用图片放大查看器（lightbox）。点击头像 / 相册图 / 事件截图会调用它。
 * @param {string} src 图片地址（可以是 dataURL 或路径）
 * @param {string} [caption] 可选：图片下方说明文字
 */
export function openLightbox(src, caption) {
  if (!src) return;
  let box = document.getElementById('lightbox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'lightbox';
    box.className = 'lightbox';
    box.innerHTML = '<div class="lightbox-backdrop"></div><div class="lightbox-body"><button class="lightbox-close" aria-label="关闭">×</button><img class="lightbox-img" alt=""><div class="lightbox-caption"></div></div>';
    document.body.appendChild(box);
  }
  box.querySelector('.lightbox-img').src = src;
  const cap = box.querySelector('.lightbox-caption');
  cap.textContent = caption || '';
  cap.style.display = caption ? '' : 'none';
  box.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeLightbox() {
  var box = document.getElementById('lightbox');
  if (!box) return;
  box.classList.remove('open');
  document.body.style.overflow = '';
}
export function initLightbox() {
  document.addEventListener('click', function (e) {
    if (e.target.closest('.lightbox-backdrop') || e.target.closest('.lightbox-close')) closeLightbox();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeLightbox();
  });
}
// 挂到 window，供地图标记等内联 onclick 使用
window.openLightbox = openLightbox;