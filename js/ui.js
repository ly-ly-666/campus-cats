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
const GENDER_LABEL = { male: '公', female: '母' };
const STATUS_TAG = { 已绝育: 'neutered', 未绝育: 'unneutered' };

/**
 * 渲染猫咪列表。
 * @param {Array} cats 猫咪数组
 * @param {Function} onSelect 点击某一项时的回调 onSelect(cat)
 */
export function renderCatList(cats, onSelect) {
  const listEl = document.getElementById('cat-list');
  if (!listEl) return;

  listEl.innerHTML = cats.map((cat) => {
    const photo = photoUrl(cat.photo);
    return `
      <div class="cat-item" data-cat-id="${cat.id}" tabindex="0" role="button" aria-label="查看 ${escapeHtml(cat.name)}">
        <div class="cat-item-photo">
          <img src="${photo}" alt="" loading="lazy"
               onerror="this.style.display='none';this.parentElement.classList.add('cat-item-fallback');">
          <span class="cat-item-fallback-icon">🐱</span>
        </div>
        <div class="cat-item-info">
          <div class="cat-item-name">
            ${escapeHtml(cat.name)}
            ${cat.nickname && !cat.nickname.startsWith('img-') ? '<span class="cat-item-nick">（' + escapeHtml(cat.nickname) + '）</span>' : ''}
            ${cat.leftAt ? '<span class="tag tag-past">过往</span>' : ''}
            <span class="tag tag-${cat.gender === 'male' ? 'male' : 'female'}">${GENDER_LABEL[cat.gender] || cat.gender}</span>
            <span class="tag tag-${STATUS_TAG[cat.status] || 'unneutered'}">${escapeHtml(cat.status || '')}</span>
          </div>
          <div class="cat-item-area">📍 ${escapeHtml(cat.area || '')}</div>
        </div>
      </div>`;
  }).join('');

  listEl.querySelectorAll('.cat-item').forEach((el) => {
    const id = el.dataset.catId;
    const cat = cats.find((c) => c.id === id);
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

  // 更新侧边栏标题中的猫咪数量
  const countEl = document.getElementById('cat-count');
  if (countEl) countEl.textContent = String(cats.length);
}

/**
 * 弹出猫咪详情弹窗，展示猫咪信息及其全部关系（含反向关系）。
 * @param {Object} cat 当前猫咪
 * @param {Array} cats 猫咪数组
 * @param {Array} relations 关系数组
 */
export function showModal(cat, cats, relations) {
  if (!cat) return;
  const catById = new Map(cats.map((c) => [c.id, c]));

  const photo = photoUrl(cat.photo);
  const infoRows = [
    ['性别', GENDER_LABEL[cat.gender] || cat.gender],
    ['外号', cat.nickname],
    ['毛色', cat.color],
    ['区域', cat.area],
    ['状态', cat.status],
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

  const modal = document.getElementById('modal');
  if (!modal) return;
  modal.innerHTML = `
    <div class="modal-backdrop" data-close="1"></div>
    <div class="modal-panel">
      <button class="modal-close" data-close="1" aria-label="关闭">×</button>
      <div class="modal-header">
        <img class="modal-photo" src="${photo}" alt="" onerror="this.src='${DEFAULT_PHOTO}'">
        <div class="modal-title-block">
          <h2 class="modal-name">${escapeHtml(cat.name)}</h2>
          <div class="modal-tags">
            ${cat.leftAt ? '<span class="tag tag-past">过往</span>' : ''}
            <span class="tag tag-${cat.gender === 'male' ? 'male' : 'female'}">${GENDER_LABEL[cat.gender] || cat.gender}</span>
            <span class="tag tag-${STATUS_TAG[cat.status] || 'unneutered'}">${escapeHtml(cat.status || '')}</span>
          </div>
        </div>
      </div>
      ${cat.description ? `<p class="modal-desc">${escapeHtml(cat.description)}</p>` : ''}
      <div class="modal-info">${infoHtml}</div>
      <h3 class="modal-section-title">关系</h3>
      <div class="modal-relations">${relationHtml}</div>
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
export function showToast(message) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => el.classList.remove('show'), 4200);
}