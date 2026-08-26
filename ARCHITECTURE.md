# 校园猫咪地图与族谱网站 — 架构设计文档

> 版本：v1.0　|　编写：架构师 (architect)　|　状态：已定稿

## 1. 项目简介与目标

本项目是面向校园场景的**猫咪地图与族谱展示网站**，以广东石油化工学院官渡校区为范围，将校园内的流浪猫以地图形式呈现，并展示猫咪之间的亲缘/社交关系（族谱）。

**核心目标：**

1. **猫咪地图**：在 Leaflet 地图上以标记点呈现每只猫咪的出没位置，点击可查看猫咪详情。
2. **族谱关系图**：使用 ECharts 的关系图（graph）展示猫咪之间的配偶、亲子、兄弟姐妹、朋友等关系网络。
3. **无后端、纯静态**：整个站点由静态文件构成，可直接部署到 GitHub Pages，无需服务器与数据库。
4. **数据驱动**：所有猫咪与关系数据存放于独立 JSON 文件中，改数据即可更新全站，方便维护与扩展。
5. **低门槛**：原生 ES Modules 实现，无框架、无构建步骤，任何现代浏览器均可直接运行。

## 2. 技术选型

| 用途 | 技术 | 说明 |
| --- | --- | --- |
| 地图 | **Leaflet + OpenStreetMap (OSM)** | 轻量、免费、无需密钥的瓦片底图，适合校园范围展示 |
| 关系图 | **ECharts graph** | 内置关系图（graph/force）类型，支持节点与边、力导向布局，展示族谱清晰直观 |
| 模块化 | **原生 ES Modules** | 使用 `import`/`export`，无需打包工具，浏览器原生支持 |
| 数据 | **JSON**（data/cats.json、data/relations.json） | 结构化、易编辑、易校验 |
| 部署 | **GitHub Pages** | 通过 GitHub Actions 自动构建并发布静态站点 |

**为什么不用框架/构建工具？**
- 站点规模小、交互有限，原生 JS 足以胜任。
- 零构建步骤意味着本地双击 index.html 即可预览，也便于 GitHub Pages 直接托管。
- 全部使用相对路径，天然兼容 GitHub Pages 的子路径部署（如 `https://user.github.io/repo/`）。

## 3. 目录结构定义

本项目采用如下固定目录结构，所有模块按此约定组织：

```
.
├── index.html                    # 站点入口页面
├── admin.html                    # 网页数据管理后台（在线编辑+自动部署）
├── style.css                     # 全局样式
├── js/
│   ├── config.js                 # 全局配置与常量（校区中心、缩放级别、关系样式等）
│   ├── admin.js                  # 后台管理逻辑（GitHub API 读/写数据）
│   ├── data.js                   # 数据加载模块（读取 cats.json / relations.json）
│   ├── map.js                    # 地图模块（Leaflet 初始化与标记）
│   ├── graph.js                  # 关系图模块（ECharts graph）
│   ├── ui.js                     # UI 模块（列表渲染、弹窗、标签页、HTML 转义）
│   └── main.js                   # 入口模块（装配并启动应用）
├── data/
│   ├── cats.json                 # 猫咪数据
│   └── relations.json            # 猫咪关系数据
├── images/
│   └── placeholder.svg           # 猫咪照片缺失时的占位图
├── scripts/
│   └── validate.mjs              # 数据校验脚本（Node）
├── package.json                  # npm 脚本（校验、本地预览等）
├── .gitignore                    # git 忽略规则
├── .github/
│   └── workflows/
│       └── deploy-pages.yml      # GitHub Pages 自动部署工作流
├── README.md                     # 项目说明
├── ARCHITECTURE.md               # 本文档（架构设计）
└── REVIEW.md                     # 评审记录
```

## 4. 数据 Schema 说明

### 4.1 data/cats.json

`cats.json` 是一个对象数组，每个元素表示一只猫咪：

```json
{
  "id": "cat_001",
  "name": "大黄",
  "gender": "male",
  "color": "橘白",
  "area": "图书馆后花园",
  "lat": 21.6795,
  "lng": 110.9226,
  "photo": "images/cat_001.jpg",
  "description": "性格温和，喜欢晒太阳。",
  "status": "已绝育",
  "firstSeen": "2022-03",
  "caretaker": "李同学"
}
```

各字段含义与约束：

| 字段 | 类型 | 必填 | 约束与说明 |
| --- | --- | --- | --- |
| `id` | string | ✅ | **唯一标识**，全站唯一，不得重复；其他模块及 relations 均引用此值 |
| `name` | string | ✅ | 猫咪昵称 |
| `gender` | string | ✅ | 性别，**仅限** `male`（公）或 `female`（母） |
| `color` | string | ✅ | 毛色描述，如 "橘白"、"三花" |
| `area` | string | ✅ | 常出没区域，如 "图书馆后花园" |
| `lat` | number | ✅ | 纬度，**数值**，范围约 21.6–21.8 |
| `lng` | number | ✅ | 经度，**数值**，范围约 110.9–111.0 |
| `photo` | string | ❌ | 照片路径；**可选**，缺省时默认使用 `images/placeholder.svg` 占位图 |
| `description` | string | ✅ | 简介/特征描述 |
| `status` | string | ✅ | 绝育状态，**仅限** `已绝育` 或 `未绝育` |
| `firstSeen` | string | ✅ | 首次发现时间，格式 **YYYY-MM**（如 "2022-03"） |
| `caretaker` | string | ❌ | 投喂人/照料人，可选 |

### 4.2 data/relations.json

`relations.json` 是一个对象数组，每个元素表示一条猫咪之间的关系：

```json
{
  "from": "cat_001",
  "to": "cat_002",
  "relation": "父子",
  "note": "2023 年春在图书馆后花园发现"
}
```

各字段含义与约束：

| 字段 | 类型 | 必填 | 约束与说明 |
| --- | --- | --- | --- |
| `from` | string | ✅ | 关系发起方 id，**必须是 `cats.json` 中存在的 id** |
| `to` | string | ✅ | 关系接收方 id，**必须是 `cats.json` 中存在的 id**（`from` 与 `to` 不应相同） |
| `relation` | string | ✅ | 关系类型，**仅限**：`配偶`、`父子`、`母子`、`兄弟姐妹`、`朋友` |
| `note` | string | ❌ | 备注/说明，可选 |

**校验规则（由 scripts/validate.mjs 强制执行）：**
- `id` 全站唯一；
- `gender` 与 `status` 取值受限；
- `lat`/`lng` 为数值且在合理范围内；
- `firstSeen` 符合 YYYY-MM 格式；
- `relations` 中 `from`/`to` 均须引用存在的猫咪 id；
- `relation` 取值受限。

## 5. 模块接口约定

项目采用原生 ES Modules，各模块通过 `export` 暴露约定接口，`main.js` 负责装配。

### 5.1 js/config.js

全局配置与常量：

| 导出 | 值 | 说明 |
| --- | --- | --- |
| `CAMPUS_CENTER` | `[21.6795, 110.9226]` | 校区中心坐标（广东石油化工学院官渡校区），Leaflet 使用 [lat, lng] 顺序 |
| `DEFAULT_ZOOM` | `17` | 地图初始缩放级别 |
| `MAX_ZOOM` | `20` | 地图最大缩放级别（超出瓦片原始清晰度后自动放大） |
| `DEFAULT_PHOTO` | `'images/placeholder.svg'` | 照片缺失时的默认占位图路径 |
| `RELATION_STYLE` | 对象 | 各关系类型对应的边样式（颜色/线宽/线型），供 graph.js 使用 |

`RELATION_STYLE` 示例结构：

```js
export const RELATION_STYLE = {
  配偶:     { color: '#e74c3c', width: 3,   type: 'solid' },
  父子:     { color: '#3498db', width: 2,   type: 'solid' },
  母子:     { color: '#e91e63', width: 2,   type: 'solid' },
  兄弟姐妹: { color: '#2ecc71', width: 1.5, type: 'dashed' },
  朋友:     { color: '#95a5a6', width: 1,   type: 'dotted' },
};
```

### 5.2 js/data.js

| 导出 | 签名 | 说明 |
| --- | --- | --- |
| `loadData` | `loadData() → { cats, relations }` | 异步加载 `data/cats.json` 与 `data/relations.json`，返回包含 `cats`（猫咪数组）与 `relations`（关系数组）的对象 |

### 5.3 js/map.js

| 导出 | 签名 | 说明 |
| --- | --- | --- |
| `initMap` | `initMap(containerId, cats, onCatClick)` | 在指定容器内初始化 Leaflet 地图；`cats` 为猫咪数组；`onCatClick(cat)` 为点击标记时的回调 |

### 5.4 js/graph.js

| 导出 | 签名 | 说明 |
| --- | --- | --- |
| `initGraph` | `initGraph(containerId, cats, relations)` | 在指定容器内初始化 ECharts 关系图 |
| `resizeGraph` | `resizeGraph()` | 窗口尺寸变化时重新调整关系图尺寸（配合 resize 事件调用） |

### 5.5 js/ui.js

| 导出 | 签名 | 说明 |
| --- | --- | --- |
| `renderCatList` | `renderCatList(cats, onSelect)` | 渲染猫咪列表；点击某一项时调用 `onSelect(cat)` |
| `showModal` | `showModal(cat, cats, relations)` | 弹出猫咪详情弹窗，展示信息及其关系 |
| `bindTabs` | `bindTabs(views, opts)` | 绑定"地图/关系图"等标签页切换；`views` 为各视图容器映射，`opts` 可选（如 `{ onGraphShow }` 回调） |
| `escapeHtml` | `escapeHtml(str) → string` | 对字符串进行 HTML 转义，防止 XSS |

### 5.6 js/main.js

**入口模块**。职责：

1. `import` 各模块（config、data、map、graph、ui）；
2. 调用 `loadData()` 加载数据；
3. 初始化地图与关系图；
4. 渲染列表、绑定标签页与点击交互；
5. 启动应用。

## 6. 设计决策

1. **全部使用相对路径**：站点内所有资源引用（js、css、data、images）均为相对路径，保证在 GitHub Pages 子路径部署（`/repo/`）下也能正确加载，不依赖绝对根路径。
2. **无构建步骤**：使用原生 ES Modules 与静态 JSON，无需 webpack/vite 等打包工具；本地直接打开 index.html 即可预览（部分浏览器对本地 `fetch` 有限制，推荐本地预览用 `npx serve` 或 `python -m http.server`，正式部署走 GitHub Pages）。
3. **照片缺失回退占位图**：当猫咪未提供 `photo` 或照片无法加载时，统一使用 `images/placeholder.svg` 作为占位，避免页面出现破图。
4. **数据校验脚本**：`scripts/validate.mjs` 在提交/部署前校验 cats.json 与 relations.json 的数据合法性（id 唯一、字段取值、关系引用存在等），从源头保证数据质量。
5. **数据与逻辑分离**：数据存于 `data/`，展示逻辑存于 `js/`，改数据不需改代码，改代码不需动数据。
6. **GitHub Actions 自动部署**：push 到主分支后自动执行校验、构建并发布到 GitHub Pages，实现 CI/CD。
7. **CDN 多源回退**：Leaflet / ECharts 由 jsdelivr → unpkg → cdnjs 三级回退加载，提升国内访问稳定性。
8. **地图瓦片源自动回退**：默认首选高德（国内直连），失败时自动切换 OSM / CARTO（见 `js/config.js` 的 `TILE_PROVIDERS`），并给出右下角 toast 提示；支持按注释接入天地图（官方免费，需 Key）。

## 7. 后期扩展点

本项目预留了清晰的扩展空间，后续可按需增强：

1. **热力图**：根据猫咪出现频率/投喂记录，在地图上叠加 Leaflet 热力图（如 leaflet.heat），直观展示活动密集区域。
2. **照片墙**：新增猫咪照片墙视图，按区域/状态分类展示所有猫咪图片。
3. **自定义底图**：替换/叠加 OSM 之外的底图（如校园平面图、自定义瓦片服务），提升美观与信息量。
4. **数据在线编辑**：接入简单后端或 GitHub 数据源，实现在线新增/编辑猫咪与关系数据，替代手动编辑 JSON。
5. **喂食打卡**：增加投喂打卡功能，记录每次喂食时间、位置与猫咪，形成照料记录与热力图数据来源。
6. **猫咪个体页面**：为每只猫咪生成独立详情页/锚点，便于分享。
7. **多校区支持**：将 `CAMPUS_CENTER` 等配置参数化，支持切换不同校区。
