// main.js — 入口模块（装配并启动应用）
import { initMap, initMapSearch } from './map.js?v=20260904b';
import { initGraph, resizeGraph, panGraph, zoomGraph, resetGraphView } from './graph.js?v=20260904b';
import { renderCatList, showModal, bindTabs, initCorrection, bindCatPanel, closeCatPanel, updateStats, bindJoin, initLightbox, renderEventsTimeline, renderStoriesTimeline, renderKnowledgeTimeline } from './ui.js?v=20260904b';

// 数据加载（原 data.js，内联以省一次请求）。全部使用相对路径，保证子路径部署下也能正确加载。
async function loadData() {
  let cats, relations, siteConfig = {}, knowledge = [];
  try {
    const cfgResp = await fetch('./data/site-config.json?v=' + Date.now());
    if (cfgResp.ok) siteConfig = await cfgResp.json();
  } catch (e) {
    siteConfig = {};
  }
  try {
    const catResp = await fetch('./data/cats.json?v=' + Date.now());
    if (!catResp.ok) throw new Error(`猫咪数据加载失败（HTTP ${catResp.status}）`);
    cats = await catResp.json();
  } catch (e) {
    throw new Error(`无法加载 data/cats.json：${e.message}`);
  }
  try {
    const relResp = await fetch('./data/relations.json?v=' + Date.now());
    if (!relResp.ok) throw new Error(`关系数据加载失败（HTTP ${relResp.status}）`);
    relations = await relResp.json();
  } catch (e) {
    throw new Error(`无法加载 data/relations.json：${e.message}`);
  }
  try {
    const knResp = await fetch('./data/knowledge.json?v=' + Date.now());
    if (knResp.ok) knowledge = await knResp.json();
  } catch (e) {
    knowledge = [];
  }
  return { cats, relations, siteConfig, knowledge };
}

window.__splashStart = performance.now();
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
  var minWait = Math.max(0, 1800 - elapsed);
  setTimeout(function() {
    splash.classList.add('fade-out');
    splash.addEventListener('transitionend', function() { splash.remove(); }, { once: true });
    setTimeout(function() { if (splash.parentNode) splash.remove(); }, 1200);
  }, minWait);
}

// 圈圈状态图例：展开/收起（默认收起，不遮挡地图主干）
function bindMapLegend() {
  const toggle = document.getElementById('map-legend-toggle');
  const body = document.getElementById('map-legend-body');
  if (!toggle || !body) return;
  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    body.hidden = expanded;
    toggle.textContent = expanded ? '🔍 圈圈含义' : '✕ 收起图例';
  });
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

  const { cats, relations, siteConfig, knowledge } = data;
  if (!Array.isArray(cats) || !cats.length) {
    showError('猫咪数据为空，请检查 data/cats.json');
    return;
  }

  setLoading('');

  // 地图：点击标记 -> 弹出详情
  let map = null;
  try {
    map = initMap('map', cats, (cat) => showModal(cat, cats, relations));
    if (map) { initMapSearch(map, cats); bindMapLegend(); }
  } catch (e) {
    console.error('地图初始化失败', e);
    if (typeof L === 'undefined') {
      showError('Leaflet 地图库加载失败（网络无法访问 jsdelivr/unpkg/cdnjs）。请检查网络后刷新；大陆网络可参考 README「国内访问」章节。');
      return;
    }
  }

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
  renderStoriesTimeline(cats, siteConfig);
  renderKnowledgeTimeline(knowledge, cats);

  // 标签页
  bindTabs(
    { map: '#map-view', graph: '#graph-view', events: '#events-view', stories: '#stories-view', knowledge: '#knowledge-view' },
    { onGraphShow: () => {
      if (!graphInitDone) { lazyInitGraph().then(() => setTimeout(() => resizeGraph(), 100)); }
      else { resizeGraph(); }
    }}
  );

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

  // 窗口尺寸变化时调整关系图
  window.addEventListener('resize', () => resizeGraph());

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

boot();