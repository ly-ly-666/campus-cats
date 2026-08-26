// graph.js — 关系图模块（ECharts graph / force 力导向）
import { RELATION_STYLE } from './config.js';
import { escapeHtml } from './ui.js';

// 记录全局唯一的 chart 实例，供绑定 resize 使用
let currentChart = null;

const GENDER_COLOR = { male: '#3b82f6', female: '#ec4899' };

/**
 * 在指定容器内初始化 ECharts 关系图（graph/force 力导向）。
 * @param {string} containerId 容器元素 id
 * @param {Array} cats 猫咪数组
 * @param {Array} relations 关系数组
 * @returns {ECharts} ECharts 实例
 */
export function initGraph(containerId, cats, relations) {
  const container = document.getElementById(containerId);
  if (!container) throw new Error(`找不到关系图容器 #${containerId}`);

  if (currentChart) {
    currentChart.dispose();
    currentChart = null;
  }

  currentChart = echarts.init(container);

  // 节点：按性别着色（male 蓝 / female 粉）
  const nodes = cats.map((cat) => ({
    id: cat.id,
    name: cat.name,
    cat,
    symbolSize: 44,
    itemStyle: { color: GENDER_COLOR[cat.gender] || '#9ca3af' },
    label: {
      show: true,
      formatter: cat.name,
      fontSize: 11,
      color: '#333',
    },
  }));

  // 边：按 RELATION_STYLE 取样式
  const links = relations.map((rel, idx) => {
    const style = RELATION_STYLE[rel.relation] || { color: '#999', width: 1, type: 'solid' };
    return {
      id: `rel_${idx}`,
      source: rel.from,
      target: rel.to,
      relation: rel.relation,
      note: rel.note || '',
      lineStyle: {
        color: style.color,
        width: style.width,
        type: style.type,
        curveness: rel.relation === '配偶' ? 0.1 : 0.05,
      },
    };
  });

  const option = {
    tooltip: {
      trigger: 'item',
      confine: true,
      formatter(params) {
        if (params.dataType === 'node' && params.data.cat) {
          const c = params.data.cat;
          return [
            `<strong>${escapeHtml(c.name)}</strong>`,
            `性别：${c.gender === 'male' ? '公' : '母'}`,
            c.color ? `毛色：${escapeHtml(c.color)}` : null,
            c.area ? `区域：${escapeHtml(c.area)}` : null,
            c.status ? `状态：${escapeHtml(c.status)}` : null,
            c.description ? `<br>${escapeHtml(c.description)}` : null,
          ].filter(Boolean).join('<br>');
        }
        if (params.dataType === 'edge') {
          return `<strong>${escapeHtml(params.data.relation)}</strong>` +
            (params.data.note ? `<br>${escapeHtml(params.data.note)}` : '');
        }
        return '';
      },
    },
    series: [
      {
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        data: nodes,
        links,
        categories: [],
        label: { show: true, position: 'bottom' },
        force: {
          repulsion: 220,
          edgeLength: 110,
          gravity: 0.12,
          friction: 0.6,
        },
        emphasis: {
          focus: 'adjacency',
          lineStyle: { width: 3 },
        },
      },
    ],
  };

  currentChart.setOption(option);
  return currentChart;
}

/** 窗口尺寸变化时重新调整关系图尺寸。 */
export function resizeGraph() {
  if (currentChart) {
    currentChart.resize();
  }
}


