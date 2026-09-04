// graph.js — 关系图模块（ECharts graph / force 力导向）
import { RELATION_STYLE, deriveSiblingRelations } from './config.js?v=20260904f';
import { escapeHtml, thumbUrl } from './ui.js?v=20260904f';

// 记录全局唯一的 chart 实例，供绑定 resize 使用
let currentChart = null;

const GENDER_COLOR = { male: '#3b82f6', female: '#ec4899', unknown: '#9ca3af' };

function graphPhoto(cat) {
  const p = cat.photo || '';
  if (!p || p.indexOf('placeholder') >= 0) return '';
  return thumbUrl(p); // 关系图节点头像用缩略图，快
}

function genderLabel(cat) {
  if (cat.gender === 'male') return '公';
  if (cat.gender === 'female') return '母';
  return '未知';
}

// 边/关系的方向化描述：明确谁是谁的妈妈 / 爸爸 / 孩子
// 兼容两种入参：原始关系对象(from/to) 与 ECharts edge 数据(source/target)
function relationDesc(rel, nameOf) {
  const from = rel.from != null ? rel.from : rel.source;
  const to = rel.to != null ? rel.to : rel.target;
  const a = from != null ? nameOf(from) : '';
  const b = to != null ? nameOf(to) : '';
  switch (rel.relation) {
    case '母子': return `${a} 是 ${b} 的妈妈`;
    case '父子': return `${a} 是 ${b} 的爸爸`;
    case '兄弟姐妹': return `${a} 与 ${b} 是兄弟姐妹`;
    case '配偶': return `${a} 与 ${b} 是配偶`;
    case '朋友': return `${a} 与 ${b} 是朋友`;
    default: return `${a} ${rel.relation} ${b}`;
  }
}

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

  if (typeof echarts === 'undefined') throw new Error('ECharts 未加载');

  if (currentChart) {
    currentChart.dispose();
    currentChart = null;
  }

  currentChart = echarts.init(container);

  // 节点：性别色圆底 + 圆形头像覆盖（边缘露出 4px 性别色圈）+ 名字
  const nodes = cats.map((cat) => {
    const photo = graphPhoto(cat);
    const genderColor = GENDER_COLOR[cat.gender] || '#9ca3af';
    return {
      id: cat.id,
      name: cat.name,
      cat,
      category: cat.gender === 'male' ? 0 : (cat.gender === 'female' ? 1 : 2),
      symbol: 'circle',
      symbolSize: 56,
      itemStyle: {
        color: genderColor,          // 性别色圆底 = 圈
        borderColor: '#ffffff',
        borderWidth: 2,
      },
      label: {
        show: true,
        position: 'inside',
        formatter: () => `{avatar|${photo ? '' : '🐱'}}\n{name|${cat.name}}`,
        rich: {
          avatar: photo ? {
            width: 48, height: 48,
            borderRadius: 24,
            backgroundColor: { image: new URL(photo, location.href).href },
            align: 'center', lineHeight: 48,
          } : {
            width: 48, height: 48,
            borderRadius: 24,
            backgroundColor: 'rgba(255,255,255,0.92)',
            align: 'center', lineHeight: 48,
            fontSize: 20, color: '#c2410c',
          },
          name: { fontSize: 11, color: '#333', align: 'center', lineHeight: 15, padding: [2, 0, 0, 0] },
        },
      },
    };
  });

  // 猫 id -> 名字
  const nameOf = (id) => {
    const c = cats.find((x) => x.id === id);
    return c ? c.name : (id != null ? String(id) : '未知');
  };

  // 边：按 RELATION_STYLE 取样式，带方向箭头与方向化描述
  // 自动推断的兄弟姐妹（同父或同母），用虚线区分
  const autoSiblings = deriveSiblingRelations(cats, relations).map((rel, i) => {
    const style = RELATION_STYLE[rel.relation] || { color: '#999', width: 1, type: 'solid' };
    return {
      id: 'auto_sib_' + i,
      source: rel.from,
      target: rel.to,
      relation: rel.relation,
      note: rel.note || '',
      auto: true,
      symbol: ['none', 'arrow'],
      symbolSize: 8,
      label: {
        show: true,
        formatter: relationDesc(rel, nameOf),
        fontSize: 10,
        color: '#8a8a8a',
        backgroundColor: 'rgba(255,255,255,0.85)',
        borderRadius: 4,
        padding: [2, 5],
        lineHeight: 14,
      },
      lineStyle: { color: style.color, width: 1, type: 'dashed', curveness: 0.06 },
    };
  });
  const links = relations.map((rel, idx) => {
    const style = RELATION_STYLE[rel.relation] || { color: '#999', width: 1, type: 'solid' };
    return {
      id: `rel_${idx}`,
      source: rel.from,
      target: rel.to,
      relation: rel.relation,
      note: rel.note || '',
      // 关系方向箭头（指向子 / 指向对方）
      symbol: ['none', 'arrow'],
      symbolSize: 9,
      label: {
        show: true,
        formatter: relationDesc(rel, nameOf),
        fontSize: 11,
        color: '#666',
        backgroundColor: 'rgba(255,255,255,0.85)',
        borderRadius: 4,
        padding: [2, 5],
        lineHeight: 15,
      },
      lineStyle: {
        color: style.color,
        width: style.width,
        type: style.type,
        curveness: rel.relation === '配偶' ? 0.1 : 0.05,
      },
    };
  }).concat(autoSiblings);

  const option = {
    legend: {
      show: true,
      bottom: 0,
      left: 'center',
      orient: 'horizontal',
      data: ['公', '母', '未知'],
      itemWidth: 12,
      itemHeight: 12,
    },
    tooltip: {
      trigger: 'item',
      confine: true,
      formatter(params) {
        if (params.dataType === 'node' && params.data.cat) {
          const c = params.data.cat;
          return [
            `<strong>${escapeHtml(c.name)}</strong>`,
            `性别：${genderLabel(c)}`,
            c.color ? `毛色：${escapeHtml(c.color)}` : null,
            c.area ? `区域：${escapeHtml(c.area)}` : null,
            c.status ? `状态：${escapeHtml(c.status)}` : null,
            c.description ? `<br>${escapeHtml(c.description)}` : null,
          ].filter(Boolean).join('<br>');
        }
        if (params.dataType === 'edge') {
          const rel = params.data;
          const desc = relationDesc(rel, nameOf);
          return `<strong>${escapeHtml(desc)}</strong>` +
            (rel.note ? `<br>${escapeHtml(rel.note)}` : '');
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
        categories: [
          { name: '公', itemStyle: { borderColor: '#3b82f6', color: '#fffaf5', borderWidth: 3 } },
          { name: '母', itemStyle: { borderColor: '#ec4899', color: '#fffaf5', borderWidth: 3 } },
          { name: '未知', itemStyle: { borderColor: '#9ca3af', color: '#fffaf5', borderWidth: 3 } },
        ],
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

// ---------- 手机端：平移 / 缩放 / 复位 关系图 ----------
// 通过 graph series 的 center(百分比) / zoom 控制整个视图，适合手机端按钮操作
let _cx = 50, _cy = 50, _zoom = 1;

export function panGraph(dxPct, dyPct) {
  if (!currentChart) return;
  _cx = Math.max(0, Math.min(100, _cx + (dxPct || 0)));
  _cy = Math.max(0, Math.min(100, _cy + (dyPct || 0)));
  currentChart.setOption({ series: [{ center: [_cx + '%', _cy + '%'] }] });
}

export function zoomGraph(factor) {
  if (!currentChart) return;
  _zoom = Math.max(0.2, Math.min(5, _zoom * (factor || 1)));
  currentChart.setOption({ series: [{ zoom: _zoom }] });
}

export function resetGraphView() {
  if (!currentChart) return;
  _cx = 50; _cy = 50; _zoom = 1;
  currentChart.setOption({ series: [{ center: ['50%', '50%'], zoom: 1 }] });
}


