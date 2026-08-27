// map.js — 地图模块（Leaflet 初始化与圆形猫咪标记）
import { CAMPUS_CENTER, DEFAULT_ZOOM, MAX_ZOOM, DEFAULT_PHOTO, TILE_PROVIDERS } from './config.js';
const IMG_CACHE_BUST = Date.now();
function photoUrl(src) {
  if (!src) return DEFAULT_PHOTO;
  if (/^https?:/i.test(src) || /\?v=/.test(src)) return src;
  return src + '?v=' + IMG_CACHE_BUST;
}
import { showToast } from './ui.js';

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
  // 地图标记不加载真实头像，只显示占位符（首字母圆圈），避免首屏加载 39 张图卡死
  const initial = (cat.name || '?')[0];
  const isPast = cat.leftAt ? true : false;
  const lifeRing = cat.life === '失踪' ? ' ring-missing' : (cat.life === '失踪已久' ? ' ring-missing-old' : (cat.life === '已领养' ? ' ring-adopted' : ''));
  const html = `
    <div class="cat-marker${isPast ? ' cat-marker-past' : ''}${lifeRing}" data-cat-id="${cat.id}">
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

  const map = L.map(containerId, { zoomControl: true }).setView(CAMPUS_CENTER, DEFAULT_ZOOM);

  addTileLayer(map);

  const catById = new Map(cats.map((c) => [c.id, c]));

  cats.forEach((cat) => {
    if (typeof cat.lat !== 'number' || typeof cat.lng !== 'number') return;
    const marker = L.marker([cat.lat, cat.lng], { icon: createCatIcon(cat) })
      .addTo(map);

    const popupLines = [
      '<strong>' + cat.name + '</strong>' + (cat.leftAt ? ' <span class="tag tag-past">过往</span>' : ''),
      cat.nickname ? '🐾 外号：' + cat.nickname : null,
      cat.area ? '📍 ' + cat.area : null,
      cat.leftAt ? '🚪 离开时间：' + cat.leftAt : null,
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