// map.js — 地图模块（Leaflet 初始化与圆形猫咪标记）
import { CAMPUS_CENTER, DEFAULT_ZOOM, MAX_ZOOM, DEFAULT_PHOTO } from './config.js';

/**
 * 创建单个猫咪的圆形 divIcon 标记。
 * 背景显示猫照片，照片加载失败时兜底为底色 + 猫图标。
 */
function createCatIcon(cat) {
  const photo = cat.photo || DEFAULT_PHOTO;
  const html = `
    <div class="cat-marker" data-cat-id="${cat.id}">
      <img src="${photo}" alt="" loading="lazy"
           onerror="this.style.display='none';this.parentElement.classList.add('marker-fallback');">
      <span class="marker-fallback-icon">🐱</span>
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
  if (!container) throw new Error(`找不到地图容器 #${containerId}`);

  const map = L.map(containerId, { zoomControl: true }).setView(CAMPUS_CENTER, DEFAULT_ZOOM);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: MAX_ZOOM,
    attribution: '© OpenStreetMap contributors',
  }).addTo(map);

  const catById = new Map(cats.map((c) => [c.id, c]));

  cats.forEach((cat) => {
    if (typeof cat.lat !== 'number' || typeof cat.lng !== 'number') return;
    const marker = L.marker([cat.lat, cat.lng], { icon: createCatIcon(cat) })
      .addTo(map);

    const popupLines = [
      `<strong>${cat.name}</strong>`,
      cat.area ? `📍 ${cat.area}` : null,
      cat.description ? `💬 ${cat.description}` : null,
    ].filter(Boolean);

    marker.bindPopup(popupLines.join('<br>'), { closeButton: true });
    marker.on('click', () => {
      const current = catById.get(cat.id) || cat;
      if (typeof onCatClick === 'function') onCatClick(current);
    });
  });

  return map;
}
