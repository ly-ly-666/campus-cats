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
