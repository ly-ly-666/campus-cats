// main.js — 入口模块（装配并启动应用）
import { initMap } from './map.js';
import { initGraph, resizeGraph, panGraph, zoomGraph, resetGraphView } from './graph.js';
import { renderCatList, showModal, bindTabs, initCorrection, bindCatPanel, closeCatPanel, updateStats, bindJoin, initLightbox, renderEventsTimeline, renderStoriesTimeline, prefetchCatOriginals } from './ui.js';
import { loadData } from './data.js';

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

  const { cats, relations, siteConfig } = data;
  if (!Array.isArray(cats) || !cats.length) {
    showError('猫咪数据为空，请检查 data/cats.json');
    return;
  }

  setLoading('');

  // 淡出加载页
  dismissSplash();

  // 缩略图已就绪后，后台慢慢预取原图（渐进式加载：预览快，详情秒开）
  prefetchCatOriginals(cats);

  // 地图：点击标记 -> 弹出详情
  let map = null;
  try {
    map = initMap('map', cats, (cat) => showModal(cat, cats, relations));
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

  // 列表
  renderCatList(cats, (cat) => { closeCatPanel(); showModal(cat, cats, relations); });
  bindCatPanel();
  updateStats(cats);
  bindJoin();
  initLightbox();
  renderEventsTimeline(cats);
  renderStoriesTimeline(cats);

  // 标签页
  bindTabs(
    { map: '#map-view', graph: '#graph-view', events: '#events-view', stories: '#stories-view' },
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
}

boot();