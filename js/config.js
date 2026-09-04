// config.js — 全局配置与常量

// 校区中心坐标（广东石油化工学院官渡校区），Leaflet 使用 [lat, lng] 顺序
export const CAMPUS_CENTER = [21.6795, 110.9226];

// 以 campus 中心为圆心，半径约 1km 的矩形边界（plain arrays，map.js 中转为 L.latLngBounds）
export const MAP_BOUNDS_SW = [CAMPUS_CENTER[0] - 0.009, CAMPUS_CENTER[1] - 0.0097];
export const MAP_BOUNDS_NE = [CAMPUS_CENTER[0] + 0.009, CAMPUS_CENTER[1] + 0.0097];

// 地图初始缩放级别
export const DEFAULT_ZOOM = 17;

// 地图最大缩放级别
export const MAX_ZOOM = 20;

// 照片缺失时的默认占位图路径（相对路径，兼容子路径部署）
export const DEFAULT_PHOTO = 'images/placeholder.svg';

// 地图瓦片源列表（按顺序回退，首项为默认首选）。
// ★ 高德：国内直连快、带中文标注、无需 Key（非官方接口，应急/演示用，正式项目建议改用天地图，见 README）；
//   OSM / CARTO：适合境外访问，国内网络常超时。
// 如需接入天地图（官方免费，需申请 Key），可把 key 填入后取消下面注释并加入队列。
export const TILE_PROVIDERS = [
  { name: '高德', url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', attribution: '© 高德地图', maxZoom: 20, maxNativeZoom: 18, subdomains: ['1', '2', '3', '4'] },
  { name: 'OpenStreetMap', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors', maxZoom: 20, maxNativeZoom: 19 },
  { name: 'CARTO', url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', attribution: '© OpenStreetMap © CARTO', maxZoom: 20, maxNativeZoom: 19 }
];

// 示例：天地图（需在 https://console.tianditu.gov.cn 免费申请 Key）
// 用法：const TIANDITU_KEY = '你的天地图Key'; // 取消下行注释并入列
// { name: '天地图', url: 'https://t{s}.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=' + TIANDITU_KEY, attribution: '© 天地图', maxZoom: 18, subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'] }

// 各关系类型对应的边样式（颜色 / 线宽 / 线型），供 graph.js 使用
export const RELATION_STYLE = {
  配偶:     { color: '#e74c3c', width: 3,   type: 'solid' },
  父子:     { color: '#3498db', width: 2,   type: 'solid' },
  母子:     { color: '#e91e63', width: 2,   type: 'solid' },
  兄弟姐妹: { color: '#2ecc71', width: 1.5, type: 'dashed' },
  朋友:     { color: '#95a5a6', width: 1,   type: 'dotted' },
};

// ---------------- 共享工具（原 lightbox.js / relations-util.js，合并以省请求） ----------------

// 关系派生：根据父母关系（母子/父子）自动推断「兄弟姐妹」关系。
// 规则：两只猫共享至少一位父母（同母或同父）即视为兄弟姐妹；已在数据里手写的兄弟姐妹不重复。
// 推出来的关系带 auto:true 标记（自动推断），可据此在界面上标注。
export function deriveSiblingRelations(cats, relations) {
  const catIds = new Set((cats || []).map((c) => c.id));
  const rels = Array.isArray(relations) ? relations : [];

  const explicit = new Set();
  rels.forEach((r) => {
    if (r.relation !== '兄弟姐妹') return;
    const a = String(r.from), b = String(r.to);
    explicit.add(a < b ? a + '_' + b : b + '_' + a);
  });

  const parents = new Map();
  const addP = (child, parent) => {
    if (!catIds.has(child) || !catIds.has(parent)) return;
    if (!parents.has(child)) parents.set(child, new Set());
    parents.get(child).add(parent);
  };
  rels.forEach((r) => {
    if (r.relation === '母子' || r.relation === '父子') addP(r.to, r.from);
  });

  const children = [...parents.keys()];
  const result = [];
  const done = new Set(explicit);
  for (let i = 0; i < children.length; i++) {
    for (let j = i + 1; j < children.length; j++) {
      const a = children[i], b = children[j];
      const ps = parents.get(a);
      const shared = [...ps].some((p) => parents.get(b) && parents.get(b).has(p));
      if (!shared) continue;
      const key = a < b ? a + '_' + b : b + '_' + a;
      if (done.has(key)) continue;
      done.add(key);
      result.push({ from: a, to: b, relation: '兄弟姐妹', auto: true });
    }
  }
  return result;
}

// 收集与某只猫关联的「故事配图」（判定逻辑与故事集卡片一致）：
// 故事把这只猫列为关联猫咪（cats 数组包含它且猫咪存在），或故事未关联任何猫时这只猫是发布者（宿主）。
// 返回 [{src, title}]，title 为故事标题（可空），用于相册合并展示。
export function collectStoryAlbumImages(cat, cats) {
  if (!cat) return [];
  const catIds = new Set((cats || []).map((c) => c && c.id));
  const out = [];
  const seen = new Set();
  const add = (src, title) => {
    if (!src || seen.has(src)) return;
    seen.add(src);
    out.push({ src, title: title || '' });
  };
  (cats || []).forEach((c) => {
    if (!c || !Array.isArray(c.stories)) return;
    c.stories.forEach((s) => {
      if (!s || !Array.isArray(s.images) || !s.images.length) return;
      const linked = (Array.isArray(s.cats) ? s.cats : []).filter((cid) => catIds.has(cid));
      const shown = linked.length ? linked : [c.id];
      if (shown.indexOf(cat.id) < 0) return;
      const t = s.title || '';
      s.images.forEach((src) => add(src, t));
    });
  });
  return out;
}

// 通用图片放大查看器（桌面 + 手机）。微信式「查看原图」：
// 先秒出已缓存缩略图；原图约 600ms 内能加载完则自动替换成高清，否则出现「查看原图」按钮，点击再按需加载（带进度）。
// 传入 gallery（数组 {src,thumb,caption}）与 index 时，支持左右滑动/方向键/箭头在一组图片间切换，并显示序号「x / n」。
export function openLightbox(src, caption, thumbSrc, gallery, index) {
  if (!src && !(Array.isArray(gallery) && gallery.length)) return;
  let box = document.getElementById('lightbox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'lightbox';
    box.className = 'lightbox';
    box.innerHTML = '<div class="lightbox-backdrop"></div><div class="lightbox-body">'
      + '<button class="lightbox-close" aria-label="关闭">×</button>'
      + '<div class="lightbox-loading"><span></span><b class="lightbox-loading-pct"></b></div>'
      + '<img class="lightbox-img" alt="">'
      + '<button class="lightbox-fullbtn" type="button">👀 查看原图</button>'
      + '<button class="lightbox-nav lightbox-prev" type="button" aria-label="上一张">‹</button>'
      + '<button class="lightbox-nav lightbox-next" type="button" aria-label="下一张">›</button>'
      + '<div class="lightbox-index"></div>'
      + '<div class="lightbox-caption"></div></div>';
    document.body.appendChild(box);
  }
  const img = box.querySelector('.lightbox-img');
  const loadEl = box.querySelector('.lightbox-loading');
  const pctEl = box.querySelector('.lightbox-loading-pct');
  const fullBtn = box.querySelector('.lightbox-fullbtn');
  const cap = box.querySelector('.lightbox-caption');
  const idxEl = box.querySelector('.lightbox-index');
  const prevBtn = box.querySelector('.lightbox-prev');
  const nextBtn = box.querySelector('.lightbox-next');

  const fit = () => {
    if (!img.naturalWidth || !img.naturalHeight) return;
    const vv = (window.visualViewport && window.visualViewport.width) ? window.visualViewport : window;
    const vw = vv.width * 0.92;
    const vh = vv.height * 0.84;
    img.style.maxWidth = Math.min(vw, img.naturalWidth) + 'px';
    img.style.maxHeight = Math.min(vh, img.naturalHeight) + 'px';
  };

  const g = Array.isArray(gallery) && gallery.length ? gallery : null;
  let gIdx = 0;
  if (g) gIdx = (typeof index === 'number') ? Math.min(Math.max(index, 0), g.length - 1) : 0;

  const showNav = () => {
    const multi = !!g && g.length > 1;
    if (!multi) idxEl.textContent = '';
    prevBtn.style.display = multi ? 'block' : 'none';
    nextBtn.style.display = multi ? 'block' : 'none';
    idxEl.style.display = multi ? 'block' : 'none';
  };

  let loadToken = 0;
  let loadTimer = 0;

  function loadItem(item) {
    const myToken = ++loadToken;
    const iSrc = item ? item.src : src;
    const iThumb = item ? item.thumb : thumbSrc;
    const iCap = item ? (item.caption || '') : (caption || '');
    const isFull = !iThumb || iThumb === iSrc;
    clearTimeout(loadTimer);
    let done = false, inGrace = true, userAsked = false, revealed = false;
    loadEl.style.display = 'none';
    pctEl.style.display = 'none';
    pctEl.textContent = '';
    fullBtn.style.display = 'none';
    img.style.opacity = 0;
    img.onload = () => { img.style.opacity = 1; fit(); };
    img.src = iThumb || iSrc;
    if (img.complete && img.naturalWidth) img.onload();

    const reveal = () => {
      if (myToken !== loadToken || revealed) return;
      revealed = true;
      clearTimeout(loadTimer);
      fullBtn.style.display = 'none';
      loadEl.style.display = 'none';
      img.onload = () => { img.style.opacity = 1; fit(); };
      img.src = iSrc;
      if (img.complete && img.naturalWidth) img.onload();
    };
    if (!isFull) {
      const full = new Image();
      full.onload = () => { if (myToken !== loadToken) return; done = true; if (inGrace || userAsked) reveal(); };
      full.onerror = () => { if (myToken !== loadToken) return; done = true; loadEl.style.display = 'none'; fullBtn.style.display = 'none'; };
      if (typeof full.addEventListener === 'function') {
        full.addEventListener('progress', (e) => {
          if (myToken !== loadToken || revealed || !e.lengthComputable) return;
          pctEl.style.display = 'block';
          pctEl.textContent = Math.round(e.loaded / e.total * 100) + '%';
        });
      }
      full.src = iSrc;
      loadTimer = setTimeout(() => { inGrace = false; if (myToken === loadToken && !done && !revealed) fullBtn.style.display = 'block'; }, 600);
      fullBtn.onclick = () => {
        userAsked = true;
        fullBtn.style.display = 'none';
        if (done) { reveal(); return; }
        loadEl.style.display = 'flex';
        pctEl.style.display = 'block';
      };
    }
    cap.textContent = iCap;
    cap.style.display = iCap ? '' : 'none';
    showNav();
    if (g) idxEl.textContent = (gIdx + 1) + ' / ' + g.length;
  }

  function goTo(delta) {
    if (!g) return;
    gIdx = (gIdx + delta + g.length) % g.length;
    loadItem(g[gIdx]);
  }

  box.__nav = (d) => goTo(d);
  loadItem(g ? g[gIdx] : null);

  // 触摸左右滑动切换（不干扰页面纵向滚动）
  let tx = 0, ty = 0, touching = false;
  box.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    tx = e.touches[0].clientX; ty = e.touches[0].clientY; touching = true;
  }, { passive: true });
  box.addEventListener('touchend', (e) => {
    if (!touching) return;
    touching = false;
    if (!g || g.length < 2 || !e.changedTouches.length) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - tx, dy = t.clientY - ty;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) goTo(dx < 0 ? 1 : -1);
  }, { passive: true });

  prevBtn.onclick = () => goTo(-1);
  nextBtn.onclick = () => goTo(1);

  box.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  var box = document.getElementById('lightbox');
  if (!box) return;
  box.classList.remove('open');
  document.body.style.overflow = '';
}

// 图集辅助：把容器内所有「可查看图」（带 data-full）组成可左右滑动的图集，并从当前点击图打开
export function openImgGallery(imgEl, containerSel) {
  if (!imgEl || typeof imgEl.closest !== 'function' || !containerSel) return;
  const box = imgEl.closest(containerSel);
  if (!box) return;
  const imgs = Array.from(box.querySelectorAll('img[data-full]'));
  if (!imgs.length) return;
  const idx = Math.max(0, imgs.indexOf(imgEl));
  const cur = imgs[idx];
  const list = imgs.map((el) => ({ src: el.getAttribute('data-full') || el.src, thumb: el.src, caption: el.getAttribute('data-caption') || '' }));
  openLightbox(cur.getAttribute('data-full') || cur.src, list[idx].caption, cur.src, list, idx);
}
window.__openImgGallery = openImgGallery;

export function initLightbox() {
  document.addEventListener('click', function (e) {
    if (e.target.closest('.lightbox-backdrop') || e.target.closest('.lightbox-close')) closeLightbox();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeLightbox(); return; }
    const box = document.getElementById('lightbox');
    if (box && box.classList.contains('open') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && typeof box.__nav === 'function') {
      box.__nav(e.key === 'ArrowLeft' ? -1 : 1);
    }
  });
}
