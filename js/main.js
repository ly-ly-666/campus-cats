// main.js — 入口模块（装配并启动应用）
import { initMap } from './map.js';
import { initGraph, resizeGraph } from './graph.js';
import { renderCatList, showModal, bindTabs, initCorrection, bindCatPanel, closeCatPanel } from './ui.js';
import { loadData } from './data.js';

const loadingEl = document.getElementById('loading');

function setLoading(text) {
  if (!loadingEl) return;
  loadingEl.textContent = text || '';
  loadingEl.style.display = text ? 'flex' : 'none';
}

function showError(message) {
  if (loadingEl) {
    loadingEl.innerHTML = '<span class="loading-error">⚠️ ' + message + '</span>';
    loadingEl.style.display = 'flex';
  }
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

  // 关系图
  let graph = null;
  try {
    graph = initGraph('graph', cats, relations);
  } catch (e) {
    console.error('关系图初始化失败', e);
    if (typeof echarts === 'undefined') {
      showError('ECharts 关系图库加载失败（网络无法访问 CDN）。请检查网络后刷新，或参考 README「国内访问」章节。');
      return;
    }
  }

  // 列表
  renderCatList(cats, (cat) => { closeCatPanel(); showModal(cat, cats, relations); });
  bindCatPanel();

  // 标签页
  bindTabs(
    { map: '#map-view', graph: '#graph-view' },
    { onGraphShow: () => resizeGraph() }
  );

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