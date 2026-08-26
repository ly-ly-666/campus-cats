// config.js — 全局配置与常量

// 校区中心坐标（广东石油化工学院官渡校区），Leaflet 使用 [lat, lng] 顺序
export const CAMPUS_CENTER = [21.6795, 110.9226];

// 地图初始缩放级别
export const DEFAULT_ZOOM = 16;

// 地图最大缩放级别
export const MAX_ZOOM = 19;

// 照片缺失时的默认占位图路径（相对路径，兼容子路径部署）
export const DEFAULT_PHOTO = 'images/placeholder.svg';

// 地图瓦片源列表（按顺序自动回退，网络不佳时会自动切换到下一个可用源）
// 第 0 项为首选；第 3 项为高德（国内访问更稳定，含中文标注），如合规顾虑可移除。
export const TILE_PROVIDERS = [
  { name: 'OpenStreetMap', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors', maxZoom: 19 },
  { name: 'CARTO', url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', attribution: '© OpenStreetMap © CARTO', maxZoom: 19 },
  { name: '高德', url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', attribution: '© 高德地图', maxZoom: 18, subdomains: ['1', '2', '3', '4'] }
];

// 各关系类型对应的边样式（颜色 / 线宽 / 线型），供 graph.js 使用
export const RELATION_STYLE = {
  配偶:     { color: '#e74c3c', width: 3,   type: 'solid' },
  父子:     { color: '#3498db', width: 2,   type: 'solid' },
  母子:     { color: '#e91e63', width: 2,   type: 'solid' },
  兄弟姐妹: { color: '#2ecc71', width: 1.5, type: 'dashed' },
  朋友:     { color: '#95a5a6', width: 1,   type: 'dotted' },
};
