// map.js — 地图模块（Leaflet 初始化与圆形猫咪标记）
import { CAMPUS_CENTER, DEFAULT_ZOOM, MAX_ZOOM, DEFAULT_PHOTO, TILE_PROVIDERS, MAP_BOUNDS_SW, MAP_BOUNDS_NE } from './config.js';
const IMG_CACHE_BUST = 'v1'; // 固定版本，浏览器可正常缓存
function photoUrl(src) {
  if (!src) return DEFAULT_PHOTO;
  if (/^https?:/i.test(src) || /\?v=/.test(src)) return src;
  return src + '?v=' + IMG_CACHE_BUST;
}
import { showToast, thumbUrl, gentleLeftAt } from './ui.js';

let currentProviderIdx = 0;
let tileErrors = 0;
const TILE_ERROR_LIMIT = 6; // 连续失败阈值，达到后自动切换瓦片源

/** 添加瓦片层（带失败自动回退到下一个瓦片源） */
function addTileLayer(map) {
  const p = TILE_PROVIDERS[currentProviderIdx];
  const opts = {
    maxZoom: p.maxZoom || MAX_ZOOM,
    maxNativeZoom: p.maxNativeZoom || 18, // 超过原始清晰度后自动放大（overzoom）
    attribution: p.attribution,
  };
  if (p.subdomains) opts.subdomains = p.subdomains;

  const layer = L.tileLayer(p.url, opts);

  layer.on('tileerror', () => {
    tileErrors++;
    if (tileErrors >= TILE_ERROR_LIMIT && currentProviderIdx < TILE_PROVIDERS.length - 1) {
      tileErrors = 0;
      currentProviderIdx++;
      map.removeLayer(layer);
      addTileLayer(map);
      showToast('网络原因，地图瓦片源已自动切换为「' + TILE_PROVIDERS[currentProviderIdx].name + '」');
    }
  });

  layer.addTo(map);
}

/**
 * 创建单个猫咪的圆形 divIcon 标记。
 * 背景显示猫照片，照片加载失败时兜底为底色 + 猫图标。
 */
function createCatIcon(cat) {
  // 圆形标记：显示真实头像（缓存已固定，浏览器可正常缓存），加载失败时兜底显示名字首字
  const initial = (cat.name || '?')[0];
  const isPast = cat.life === '去喵星了' || cat.leftAt ? true : false;
  const lifeRing = cat.life === '失踪' ? ' ring-missing' : (cat.life === '失踪已久' ? ' ring-missing-old' : (cat.life === '已领养' ? ' ring-adopted' : ''));
  const hasPhoto = !!cat.photo && cat.photo.indexOf('placeholder') < 0;
  const imgHtml = hasPhoto
    ? `<img class="cat-marker-img" src="${thumbUrl(cat.photo)}" alt="" onerror="this.style.display='none';this.parentElement.classList.add('marker-fallback');">`
    : '';
  const html = `
    <div class="cat-marker${isPast ? ' cat-marker-past' : ''}${lifeRing}" data-cat-id="${cat.id}">
      ${imgHtml}
      <span class="marker-letter">${initial}</span>
    </div>`;
  return L.divIcon({
    className: 'cat-marker-wrapper',
    html,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -22],
  });
}

/**
 * 在指定容器内初始化 Leaflet 地图并渲染所有猫咪标记。
 * @param {string} containerId 容器元素 id
 * @param {Array} cats 猫咪数组
 * @param {Function} onCatClick 点击标记时的回调 onCatClick(cat)
 * @returns {L.Map} Leaflet 地图实例
 */
export function initMap(containerId, cats, onCatClick) {
  const container = document.getElementById(containerId);
  if (!container) throw new Error('找不到地图容器 #' + containerId);
  if (typeof L === 'undefined') throw new Error('Leaflet 地图库未加载（CDN 访问失败）');

  const bounds = L.latLngBounds(MAP_BOUNDS_SW, MAP_BOUNDS_NE);
  const map = L.map(containerId, { zoomControl: true, maxBounds: bounds, maxBoundsViscosity: 1.0 }).setView(CAMPUS_CENTER, DEFAULT_ZOOM);

  // 蒙版：半透明矩形覆盖 maxBounds 范围外
  const maskStyle = { fillColor: '#f5f0e8', fillOpacity: 0.45, stroke: false, interactive: false };
  L.rectangle([[bounds.getNorthEast().lat, -180], [90, 180]], maskStyle).addTo(map);
  L.rectangle([[-90, -180], [bounds.getSouthWest().lat, 180]], maskStyle).addTo(map);
  L.rectangle([[bounds.getSouthWest().lat, -180], [bounds.getNorthEast().lat, bounds.getSouthWest().lng]], maskStyle).addTo(map);
  L.rectangle([[bounds.getSouthWest().lat, bounds.getNorthEast().lng], [bounds.getNorthEast().lat, 180]], maskStyle).addTo(map);

  addTileLayer(map);

  const catById = new Map(cats.map((c) => [c.id, c]));

  cats.forEach((cat) => {
    if (typeof cat.lat !== 'number' || typeof cat.lng !== 'number') return;
    const marker = L.marker([cat.lat, cat.lng], { icon: createCatIcon(cat) })
      .addTo(map);

    const gentleLeft = gentleLeftAt(cat);
    const popupLines = [
      '<strong>' + cat.name + '</strong>' + (cat.life === '去喵星了' ? ' <span class="tag tag-past">去喵星了</span>' : (cat.leftAt ? ' <span class="tag tag-past">过往</span>' : '')),
      cat.nickname ? '🐾 外号：' + cat.nickname : null,
      cat.area ? '📍 ' + cat.area : null,
      gentleLeft ? '🚪 ' + gentleLeft : null,
      cat.description ? '💬 ' + cat.description : null,
    ].filter(Boolean);

    marker.bindPopup(popupLines.join('<br>'), { closeButton: true });
    marker.on('click', () => {
      const current = catById.get(cat.id) || cat;
      if (typeof onCatClick === 'function') onCatClick(current);
    });
  });

  return map;
}
/**
 * 地图内搜索：按 名字/外号/毛色/区域 模糊搜索猫咪，选中后 flyTo 定位并打开标记气泡。
 * 需要 index.html 中有 #map-search 输入框与 #map-search-results 结果容器。
 * @param {L.Map} map Leaflet 地图实例
 * @param {Array} cats 猫咪数组
 */
export function initMapSearch(map, cats) {
  const input = document.getElementById('map-search-input');
  const resultsEl = document.getElementById('map-search-results');
  const toggle = document.getElementById('map-search-toggle');
  const box = document.getElementById('map-search-box');
  if (!input || !resultsEl || !map) return;

  function openBox() {
    if (!box) return;
    box.hidden = false;
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
    setTimeout(() => { try { input.focus(); } catch (e) {} }, 30);
  }
  function closeBox() {
    if (box) box.hidden = true;
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    resultsEl.hidden = true;
  }
  if (toggle) toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (box && box.hidden) openBox(); else closeBox();
  });

  const markers = new Map(); // cat.id -> marker
  cats.forEach((c) => {
    const m = map.eachLayer ? null : null;
  });
  // 收集地图上已有的标记（带 data-cat-id）
  map.eachLayer((layer) => {
    if (layer && layer.options && layer.options.icon) {
      const el = layer.getElement ? layer.getElement() : null;
      const idEl = el && el.querySelector ? el.querySelector('[data-cat-id]') : null;
      if (idEl && idEl.dataset && idEl.dataset.catId) markers.set(idEl.dataset.catId, layer);
    }
  });

  function catHaystack(c) {
    return [c.name, c.nickname, c.color, c.area].filter(Boolean).join(' ').toLowerCase();
  }

  function renderResults(list) {
    if (!list.length) {
      resultsEl.innerHTML = '<div class="map-search-empty">没有找到匹配的猫咪</div>';
      resultsEl.hidden = false;
      return;
    }
    resultsEl.innerHTML = list.map((c) => {
      const lifeTag = c.life === '失踪' ? '<span class="search-life search-life-missing">失踪</span>'
        : (c.life === '失踪已久' ? '<span class="search-life search-life-missing-old">失踪已久</span>'
        : (c.life === '已领养' ? '<span class="search-life search-life-adopted">已领养</span>'
        : (c.life === '去喵星了' || c.leftAt ? '<span class="search-life search-life-past">去喵星</span>' : '')));
      return '<button type="button" class="map-search-item" data-id="' + c.id + '">'
        + '<span class="map-search-name">' + c.name + lifeTag + '</span>'
        + (c.area ? '<span class="map-search-area">📍 ' + c.area + '</span>' : '')
        + '</button>';
    }).join('');
    resultsEl.hidden = false;
  }

  function doSearch(q) {
    const s = (q || '').trim().toLowerCase();
    if (!s) { resultsEl.hidden = true; resultsEl.innerHTML = ''; return; }
    const list = cats.filter((c) => catHaystack(c).indexOf(s) >= 0).slice(0, 8);
    renderResults(list);
  }

  input.addEventListener('input', () => doSearch(input.value));
  input.addEventListener('focus', () => { if (input.value.trim()) doSearch(input.value); });

  resultsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.map-search-item');
    if (!btn) return;
    const cat = cats.find((c) => c.id === btn.dataset.id);
    if (!cat) return;
    const marker = markers.get(cat.id);
    if (map && typeof map.flyTo === 'function' && typeof cat.lat === 'number') {
      map.flyTo([cat.lat, cat.lng], 19, { duration: 0.8 });
      if (marker) setTimeout(() => marker.openPopup(), 850);
    }
    input.value = cat.name;
    closeBox();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#map-search')) closeBox();
  });
}