// main.js — 入口模块（装配并启动应用）
import { initMap, initMapSearch, setMapStatusFilter } from './map.js?v=20261116c';
import { initGraph, resizeGraph, panGraph, zoomGraph, resetGraphView } from './graph.js?v=20261116c';
import { renderCatList, showModal, bindTabs, initCorrection, bindCatPanel, closeCatPanel, updateStats, bindJoin, initLightbox, renderEventsTimeline, renderStoriesTimeline, renderSubmitBanner, renderKnowledgeTimeline, renderRankTimeline, renderStickers } from './ui.js?v=20261116c';
import { catStatusKey } from './config.js?v=20261116c';
import { bulkLikeStats } from './likes.js?v=20260925b';
import { initBoard } from './board.js?v=20261116c';

// 数据加载（原 data.js，内联以省一次请求）。全部使用相对路径，保证子路径部署下也能正确加载。
// 不带 ?v=时间戳：那会让浏览器每次都重新下载（cats.json 约 135KB）。
// 改用 cache:'no-cache' 协商缓存 —— 数据没变只回 304，变了才真正下载，既快又不会看到旧数据。
async function loadData() {
  let cats, relations, siteConfig = {}, knowledge = [];
  try {
    const cfgResp = await fetch('./data/site-config.json', { cache: 'no-cache' });
    if (cfgResp.ok) siteConfig = await cfgResp.json();
  } catch (e) {
    siteConfig = {};
  }
  try {
    const catResp = await fetch('./data/cats.json', { cache: 'no-cache' });
    if (!catResp.ok) throw new Error(`猫咪数据加载失败（HTTP ${catResp.status}）`);
    cats = await catResp.json();
  } catch (e) {
    throw new Error(`无法加载 data/cats.json：${e.message}`);
  }
  try {
    const relResp = await fetch('./data/relations.json', { cache: 'no-cache' });
    if (!relResp.ok) throw new Error(`关系数据加载失败（HTTP ${relResp.status}）`);
    relations = await relResp.json();
  } catch (e) {
    throw new Error(`无法加载 data/relations.json：${e.message}`);
  }
  try {
    const knResp = await fetch('./data/knowledge.json', { cache: 'no-cache' });
    if (knResp.ok) knowledge = await knResp.json();
  } catch (e) {
    knowledge = [];
  }
  // 表情包：功能开关（site-config.json 的 stickersEnabled）关着就连数据都不拉。
  // 关闭时公开站与故事集页跟从前完全一致；代码和 data/stickers.json 都保留，改回 true 即恢复。
  let stickers = [];
  if (siteConfig && siteConfig.stickersEnabled === true) {
    try {
      const stResp = await fetch('./data/stickers.json', { cache: 'no-cache' });
      if (stResp.ok) stickers = await stResp.json();
    } catch (e) {
      stickers = [];
    }
  }

  // 本地管理端可把某只猫设为「隐藏」（visible: false）：公开站不展示它的任何内容
  // （地图标记、猫咪列表、关系图、排行榜、档案页），关系数据里指向它的连线一并去掉，避免悬空节点。
  const hiddenCats = Array.isArray(cats) ? cats.filter((c) => c && c.visible === false) : [];
  if (Array.isArray(cats)) cats = cats.filter((c) => c && c.visible !== false);
  if (Array.isArray(relations)) {
    const shownIds = new Set(cats.map((c) => c.id));
    relations = relations.filter((r) => r && shownIds.has(r.from) && shownIds.has(r.to));
  }
  return { cats, relations, siteConfig, knowledge, stickers, hiddenCats };
}

window.__splashStart = performance.now();
// 本次会话已播过启动页：立刻移除，页面间来回切换不再被它挡一下
if (document.documentElement.classList.contains('splash-skip')) {
  var _splash = document.getElementById('splash');
  if (_splash) _splash.remove();
}
setTimeout(function() { var s = document.getElementById('splash'); if (s) { s.classList.add('fade-out'); s.addEventListener('transitionend', function() { s.remove(); }, { once: true }); setTimeout(function() { if (s.parentNode) s.remove(); }, 800); } }, 6000);
const loadingEl = document.getElementById('loading');

function setLoading(text) {
  if (!loadingEl) return;
  loadingEl.textContent = text || '';
  loadingEl.style.display = text ? 'flex' : 'none';
}

function showError(message) {
  dismissSplash();
  if (loadingEl) {
    loadingEl.innerHTML = '<span class="loading-error">⚠️ ' + message + '</span>';
    loadingEl.style.display = 'flex';
  }
}

function dismissSplash() {
  var splash = document.getElementById('splash');
  if (!splash) return;
  var elapsed = performance.now() - (window.__splashStart || 0);
  // 最短展示 700ms：数据早就加载完时不必干等（淡入 0.45s + 短暂停留 + 0.6s 淡出）
  var minWait = Math.max(0, 700 - elapsed);
  setTimeout(function() {
    splash.classList.add('fade-out');
    splash.addEventListener('transitionend', function() { splash.remove(); }, { once: true });
    setTimeout(function() { if (splash.parentNode) splash.remove(); }, 1200);
  }, minWait);
}

// 圈圈状态图例 + 地图状态筛选：展开/收起（默认收起，不遮挡地图主干）
function bindMapLegend() {
  const toggle = document.getElementById('map-legend-toggle');
  const body = document.getElementById('map-legend-body');
  if (!toggle || !body) return;
  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    body.hidden = expanded;
    toggle.textContent = expanded ? '🎛️ 筛选 / 图例' : '✕ 收起筛选';
  });
}

// 地图状态筛选：按钮可多选，隐藏/显示对应状态的猫咪标记
function initMapStatusFilter(map, cats) {
  const buttons = Array.from(document.querySelectorAll('[data-status-filter]'));
  if (!buttons.length) return;
  const keys = ['present', 'missing', 'missing-old', 'adopted', 'past'];
  const active = new Set(keys);
  const counts = { present: 0, missing: 0, 'missing-old': 0, adopted: 0, past: 0 };
  (cats || []).forEach((c) => {
    // 只统计真正会出现在地图上的猫（有经纬度才有标记），保证「显示 N 只」= 标记数
    if (typeof c.lat !== 'number' || typeof c.lng !== 'number') return;
    const k = catStatusKey(c);
    if (Object.prototype.hasOwnProperty.call(counts, k)) counts[k]++;
  });
  document.querySelectorAll('[data-count]').forEach((el) => {
    el.textContent = String(counts[el.dataset.count] || 0);
  });
  const countEl = document.getElementById('legend-filter-count');
  const toggle = document.getElementById('map-legend-toggle');
  const totalShown = keys.reduce((sum, k) => sum + counts[k], 0);

  function apply() {
    if (map) setMapStatusFilter(map, active);
    let shown = 0;
    keys.forEach((k) => { if (active.has(k)) shown += counts[k]; });
    const allOn = active.size === keys.length;
    buttons.forEach((b) => {
      const k = b.dataset.statusFilter;
      const on = k === 'all' ? allOn : active.has(k);
      b.classList.toggle('active', on);
      // 读屏/键盘用户也能知道当前筛选状态
      if (k === 'all') b.setAttribute('aria-pressed', String(allOn));
      else b.setAttribute('aria-pressed', String(on));
    });
    if (countEl) countEl.textContent = active.size === 0 ? '已隐藏全部猫咪' : '显示 ' + shown + ' 只';
    if (toggle) {
      toggle.classList.toggle('filtered', !allOn);
      toggle.title = allOn ? '查看地图状态筛选' : '有筛选：已隐藏 ' + (totalShown - shown) + ' 只';
    }
    // 筛选变化后，已展开的搜索结果按新可见范围重算（map.js 内注册）
    if (map && typeof map._refreshSearch === 'function') map._refreshSearch();
  }

  buttons.forEach((b) => {
    b.addEventListener('click', () => {
      const k = b.dataset.statusFilter;
      if (k === 'all') {
        // 「全部」是开关：已全选时再点=全部取消，否则=全部恢复
        if (active.size === keys.length) active.clear();
        else keys.forEach((x) => active.add(x));
      } else if (active.has(k)) active.delete(k);
      else active.add(k);
      apply();
    });
  });
  apply();
}

// 标签栏横向滚动提示：两侧渐变 + 呼吸箭头，点击滚动；鼠标可拖拽
function initTabBarScrollHint() {
  const wrap = document.getElementById('tab-bar-wrap');
  const bar = wrap && wrap.querySelector('.tab-bar');
  const hintRight = document.getElementById('tab-scroll-hint');
  const hintLeft = document.getElementById('tab-scroll-hint-left');
  if (!wrap || !bar) return;
  const update = () => {
    const max = bar.scrollWidth - bar.clientWidth;
    wrap.classList.toggle('can-right', max > 4 && bar.scrollLeft < max - 4);
    wrap.classList.toggle('can-left', bar.scrollLeft > 4);
  };
  const scrollDir = (dir) => {
    // 内置浏览器里 smooth scrollBy 可能不生效，直接瞬时滚动最稳
    const max = bar.scrollWidth - bar.clientWidth;
    const amount = Math.max(160, bar.clientWidth * 0.7);
    bar.scrollLeft = dir > 0 ? Math.min(max, bar.scrollLeft + amount) : Math.max(0, bar.scrollLeft - amount);
    update();
  };
  if (hintRight) hintRight.addEventListener('click', () => scrollDir(1));
  if (hintLeft) hintLeft.addEventListener('click', () => scrollDir(-1));

  // 鼠标按住拖动横向滚动；触屏仍走浏览器原生滑动
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startScroll = 0;
  bar.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    dragging = true; moved = false;
    startX = e.clientX; startScroll = bar.scrollLeft;
    bar.classList.add('dragging');
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    if (!moved && Math.abs(dx) > 4) { moved = true; bar.classList.add('dragged'); }
    if (!moved) return;
    if (e.cancelable) e.preventDefault();
    bar.scrollLeft = startScroll - dx;
  }, { passive: false });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    bar.classList.remove('dragging');
    if (moved) {
      setTimeout(() => { bar.classList.remove('dragged'); moved = false; }, 0);
    }
    update();
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  // 拖动结束后拦截这一次 click，避免误触标签
  bar.addEventListener('click', (e) => {
    if (moved) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  bar.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  setTimeout(update, 80);
  setTimeout(update, 600);
}

// 本地预览提示：管理端点「👀 预览公开站效果」会带 ?preview=1 打开本地 index.html，
// 这里给站长一个明确信号 —— 看到的是本地数据、以及哪些猫被隐藏了（线上不会出现）。
function renderPreviewNotice(hiddenCats) {
  let isPreview = false;
  try { isPreview = new URLSearchParams(location.search).get('preview') === '1'; } catch (e) {}
  if (!isPreview) return;
  const names = (hiddenCats || []).map((c) => c.name).filter(Boolean);
  const bar = document.createElement('div');
  bar.id = 'preview-notice';
  bar.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;max-width:min(420px,86vw);background:#111827;color:#fff;font-size:12px;line-height:1.7;padding:10px 34px 10px 14px;border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.35);';
  const title = document.createElement('div');
  title.textContent = '👀 本地预览模式 · 数据来自本地文件，尚未推送线上';
  bar.appendChild(title);
  const sub = document.createElement('div');
  sub.style.cssText = 'color:#fbbf24;margin-top:4px;';
  sub.textContent = names.length
    ? '🚫 已隐藏 ' + names.length + ' 只：' + names.join('、') + '（线上不会出现）'
    : '✅ 当前没有隐藏的猫（与线上一致）';
  bar.appendChild(sub);
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '✕';
  close.setAttribute('aria-label', '关闭预览提示');
  close.style.cssText = 'position:absolute;top:6px;right:8px;background:none;border:none;color:#9ca3af;font-size:14px;cursor:pointer;padding:2px;';
  close.addEventListener('click', () => bar.remove());
  bar.appendChild(close);
  document.body.appendChild(bar);
}

async function boot() {
  setLoading('正在加载猫咪数据…');
  let data;
  try {
    data = await loadData();
  } catch (e) {
    console.error(e);
    showError(e.message);
    return;
  }

  const { cats, relations, siteConfig, knowledge, stickers } = data;
  // 表情包功能总开关（data/site-config.json → stickersEnabled）：
  // 为 false 时公开站不显示「🎭 表情包」子栏目、不拉表情数据、也不响应 ?sub=stickers。
  const stickersOn = !!(siteConfig && siteConfig.stickersEnabled === true);
  if (!Array.isArray(cats) || !cats.length) {
    showError('猫咪数据为空，请检查 data/cats.json');
    return;
  }

  setLoading('');
  renderPreviewNotice(data.hiddenCats);

  // 地图：点击标记 -> 弹出详情
  let map = null;
  try {
    map = initMap('map', cats, (cat) => showModal(cat, cats, relations));
    if (map) initMapSearch(map, cats);
  } catch (e) {
    console.error('地图初始化失败', e);
    if (typeof L === 'undefined') {
      showError('Leaflet 地图库加载失败（网络无法访问 jsdelivr/unpkg/cdnjs）。请检查网络后刷新；大陆网络可参考 README「国内访问」章节。');
      return;
    }
  }
  // 图例筛选不依赖地图是否初始化成功：计数、按钮状态与搜索跟随筛选始终可用
  bindMapLegend();
  initMapStatusFilter(map, cats);

  // 关系图：延迟加载 ECharts（不在首屏同步阻塞）
  let graphInitDone = false;
  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 3000));
  function ensureEcharts() {
    if (typeof echarts !== 'undefined') return Promise.resolve(echarts);
    return window.__loadEcharts ? window.__loadEcharts() : Promise.reject(new Error('ECharts loader not found'));
  }
  async function lazyInitGraph() {
    if (graphInitDone) return;
    try {
      await ensureEcharts();
      initGraph('graph', cats, relations);
      graphInitDone = true;
    } catch (e) { console.error('关系图初始化失败', e); }
  }
  idle(() => {
    ensureEcharts().then(() => console.log('ECharts 预取完成')).catch(() => {});
  });
  var graph = null;

  // 列表：点击猫咪弹出详情卡片时保持列表浮层不关闭，返回后仍停留在列表（可连续浏览）
  renderCatList(cats, (cat) => showModal(cat, cats, relations));
  bindCatPanel();
  updateStats(cats);
  bindJoin();
  initLightbox();
  renderEventsTimeline(cats);
  renderSubmitBanner(siteConfig);
  renderStoriesTimeline(cats, siteConfig);
  renderKnowledgeTimeline(knowledge, cats);
  if (stickersOn) renderStickers(stickers, cats);
  // 进首页就先批量拉一次全部点赞数（猫咪弹窗 + 故事列表共用这一次），避免后续逐个打 Netlify 函数
  bulkLikeStats().catch(() => {});

  // 标签页
  bindTabs(
    { map: '#map-view', graph: '#graph-view', events: '#events-view', stories: '#stories-view', knowledge: '#knowledge-view', rank: '#rank-view' },
    {
      onGraphShow: () => {
        if (!graphInitDone) { lazyInitGraph().then(() => setTimeout(() => resizeGraph(), 100)); }
        else { resizeGraph(); }
      },
      onTabShow: (key) => {
        if (key === 'rank') renderRankTimeline(cats);
        // 从其他标签切回地图时重新测量容器（隐藏期间尺寸可能变化）
        if (key === 'map' && map) setTimeout(() => map.invalidateSize(), 80);
      }
    }
  );
  renderRankTimeline(cats);
  // 留言墙（弹幕 + 留言列表）：挂在「评分·留言墙」标签页里，与榜单同页
  initBoard();

  // 从档案页点「返回排行榜」会带上 ?tab=rank，这里直接切到对应标签页
  try {
    const tabKey = new URLSearchParams(location.search).get('tab');
    if (tabKey) {
      const tabBtn = document.querySelector('.tab-bar [data-tab="' + tabKey + '"]');
      if (tabBtn) tabBtn.click();
    }
  } catch (e) {}

  // 从档案页点「返回猫咪卡片」会带上 ?cat=catNNN，这里直接打开这只猫的详情卡片
  try {
    const deepCatId = new URLSearchParams(location.search).get('cat');
    if (deepCatId) {
      const deepCat = cats.find((c) => c.id === deepCatId);
      if (deepCat) {
        showModal(deepCat, cats, relations);
        // 打开后清掉 ?cat（保留 tab 等其它参数），刷新页面不会反复弹出同一只猫
        const sp = new URLSearchParams(location.search);
        sp.delete('cat');
        const qs = sp.toString();
        history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
      }
    }
  } catch (e) {}

  // 故事集页内二级切换：📖 猫咪故事 / 🎭 表情包（开发中），交互沿用评分榜的胶囊按钮
  function bindStorySubtabs() {
    const bar = document.querySelector('.story-subtabs');
    if (!bar) return;
    // 子栏目条在 HTML 里默认 display:none（配合功能开关），只有启用表情包时才亮出来
    bar.style.display = '';
    const btns = Array.from(bar.querySelectorAll('.story-subtab'));
    const panes = {
      stories: document.getElementById('stories-pane'),
      stickers: document.getElementById('stickers-pane')
    };
    function activate(key) {
      btns.forEach((b) => b.classList.toggle('active', b.dataset.sub === key));
      Object.keys(panes).forEach((k) => { if (panes[k]) panes[k].hidden = k !== key; });
      // 同步地址栏，方便直接分享/回到表情包子页
      try {
        const sp = new URLSearchParams(location.search);
        sp.set('tab', 'stories');
        if (key === 'stickers') sp.set('sub', 'stickers'); else sp.delete('sub');
        history.replaceState(null, '', location.pathname + '?' + sp.toString());
      } catch (e) {}
    }
    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('.story-subtab');
      if (btn) activate(btn.dataset.sub);
    });
    // 支持 ?tab=stories&sub=stickers 直达表情包
    try {
      if (new URLSearchParams(location.search).get('sub') === 'stickers') activate('stickers');
    } catch (e) {}
  }
  // 开关关闭时不启用二级切换：子栏目条保持隐藏，故事集页回到单列表状态
  if (stickersOn) bindStorySubtabs();

  // 手机端：关系图平移/缩放按钮
  const gc = document.getElementById('graph-controls');
  if (gc) {
    gc.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-gc]');
      if (!btn) return;
      const act = btn.dataset.gc;
      if (act === 'up') panGraph(0, -5);
      else if (act === 'down') panGraph(0, 5);
      else if (act === 'left') panGraph(-5, 0);
      else if (act === 'right') panGraph(5, 0);
      else if (act === 'zoomin') zoomGraph(1.25);
      else if (act === 'zoomout') zoomGraph(0.8);
      else if (act === 'reset') resetGraphView();
    });
  }

  // 窗口尺寸变化时调整关系图 + 重新测量地图（否则 Leaflet 保留旧尺寸，右侧会出现灰边）
  let mapResizeTimer = null;
  window.addEventListener('resize', () => {
    resizeGraph();
    if (mapResizeTimer) clearTimeout(mapResizeTimer);
    mapResizeTimer = setTimeout(() => { if (map) map.invalidateSize(); }, 150);
  });

  // 更正信息入口
  initCorrection(cats, siteConfig || {});

  // 键盘关闭弹窗（Esc）
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && typeof window.__closeModal === 'function') {
      window.__closeModal();
    }
  });

  // 所有内容渲染完成后，再淡出加载页（避免同步渲染阻塞主线程导致淡出不丝滑）
  dismissSplash();
}

initTabBarScrollHint();
boot();