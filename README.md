# 🐱 校园猫咪地图与族谱

一个面向校园场景的**猫咪地图与族谱展示网站**，以广东石油化工学院官渡校区为范围，将校园流浪猫以地图形式呈现，并展示猫咪之间的亲缘/社交关系网络。

> 纯静态、无后端、无构建步骤，原生 ES Modules 实现，任何现代浏览器均可直接运行，可一键部署到 GitHub Pages / Cloudflare Pages / Vercel。

---

## ✨ 功能说明

- 🗺️ **猫咪地图**：Leaflet + OpenStreetMap 底图，标记每只猫咪的出没位置，点击查看详情。
- 🌳 **族谱关系图**：ECharts 关系图（graph）展示猫咪之间的配偶、父子、母子、兄弟姐妹、朋友等关系。
- 📋 **猫咪列表**：侧边栏按区域列出所有猫咪，点击可定位并查看信息。
- 🖼️ **详情弹窗**：展示猫咪照片、性别、毛色、出没区域、绝育状态、照料人及人际关系。
- 📊 **数据驱动**：所有数据存于独立 JSON 文件，改数据即可更新全站。

## 📁 目录结构

```
.
├── index.html                    # 站点入口页面
├── style.css                     # 全局样式
├── js/
│   ├── config.js                 # 全局配置与常量（校区中心、缩放级别、关系样式）
│   ├── data.js                   # 数据加载模块（读取 cats.json / relations.json）
│   ├── map.js                    # 地图模块（Leaflet 初始化与标记）
│   ├── graph.js                  # 关系图模块（ECharts graph）
│   ├── ui.js                     # UI 模块（列表渲染、弹窗、标签页）
│   └── main.js                   # 入口模块（装配并启动应用）
├── data/
│   ├── cats.json                 # 猫咪数据
│   └── relations.json            # 猫咪关系数据
├── images/
│   └── placeholder.svg           # 猫咪照片缺失时的占位图
├── scripts/
│   └── validate.mjs              # 数据校验脚本（Node）
├── package.json                  # npm 脚本（本地预览、校验等）
├── .gitignore                    # git 忽略规则
├── .github/
│   └── workflows/
│       └── deploy-pages.yml      # GitHub Pages 自动部署工作流
├── README.md                     # 本文档
├── ARCHITECTURE.md               # 架构设计文档
└── docs/
    └── DEPLOYMENT.md             # 详细部署/更新/回滚/自定义域名说明
```

## 🚀 本地运行

需要 [Node.js](https://nodejs.org)（>= 18）或 Python 3。

**方式一：npm（推荐）**

```bash
npm start
# 等价于: npx --yes serve -l 4173
# 然后浏览器访问 http://localhost:4173
```

> 注意：部分浏览器对本地直接 `file://` 打开时的 `fetch` 有限制，因此推荐用本地静态服务器预览。

**方式二：Python**

```bash
python -m http.server 4173
# 浏览器访问 http://localhost:4173
```

## ✏️ 如何编辑数据

所有内容都来自两个 JSON 文件，无需改任何代码：

### data/cats.json（猫咪数据）

每只猫咪一个对象，字段如下：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✅ | 唯一标识（全站唯一），如 `cat001` |
| `name` | ✅ | 昵称 |
| `gender` | ✅ | 仅限 `male`（公）或 `female`（母） |
| `color` | ✅ | 毛色描述 |
| `area` | ✅ | 常出没区域 |
| `lat` / `lng` | ✅ | 经纬度（数值，纬度 -90~90、经度 -180~180） |
| `photo` | ❌ | 照片路径；缺省使用 `images/placeholder.svg` |
| `description` | ✅ | 简介/特征 |
| `status` | ✅ | 仅限 `已绝育` 或 `未绝育` |
| `firstSeen` | ✅ | 首次发现时间，格式 `YYYY-MM` |
| `caretaker` | ❌ | 投喂人/照料人 |

### data/relations.json（关系数据）

每条关系一个对象：`from`、`to`（须为存在的猫咪 id）、`relation`（仅限 `配偶` / `父子` / `母子` / `兄弟姐妹` / `朋友`）、`note`（可选）。

改完后运行校验：

```bash
npm run validate
# 输出 "✅ 数据校验通过" 即合法
```

## 🖼️ 如何添加照片

1. 把照片文件放入 `images/` 目录（建议正方形、体积适中，如 `cat001.jpg`）。
2. 在 `data/cats.json` 中把对应猫咪的 `photo` 字段改为该路径，例如 `"photo": "images/cat001.jpg"`。
3. 若不填 `photo` 或路径无效，站点会自动回退到 `images/placeholder.svg` 占位图。

> 也可以直接替换 `images/placeholder.svg` 为自定义占位图。

## 🌐 部署

本仓库支持三种主流静态托管平台，**任选其一即可**，互不冲突。详细步骤见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

### GitHub Pages

**方式一（推荐）：用 GitHub Actions 工作流**

1. 把代码推送到 GitHub 仓库（默认分支 `main`）。
2. 仓库 **Settings → Pages** → 在 **Build and deployment → Source** 选择 **GitHub Actions**。
3. 之后每次 push 到 `main`，工作流 `.github/workflows/deploy-pages.yml` 会自动校验并部署。
4. 访问 `https://<用户名>.github.io/<仓库名>/`。

**方式二：直接发布 main 分支**

1. 仓库 **Settings → Pages**。
2. **Source** 选择 **Deploy from a branch**，分支选 `main`，目录选 `/(root)`。
3. 保存后即部署，之后手动 push 更新。

### Cloudflare Pages

1. 注册/登录 [Cloudflare](https://dash.cloudflare.com) → 左侧 **Workers & Pages** → **Create** → **Pages** → **Connect to Git**，授权并选择本仓库。
2. **Framework preset** 选择 **None**（或 **Static**）；**Build command** 留空；**Output directory** 填 **`.`**（站点文件在仓库根目录）。
3. 点击 **Save and Deploy**，首次构建完成后会得到一个 `<项目名>.pages.dev` 地址。
4. **免费额度**：不限带宽、不限请求数，每月 500 次构建，对校园项目完全够用。
5. **国内访问说明**：免费版不一定接入京东云合作节点，中国大陆访问速度/稳定性因网络而异；企业版或已备案域名可接入中国网络以获得更稳定的国内访问。

### Vercel

1. 注册/登录 [Vercel](https://vercel.com) → **Add New → Project** → 导入 GitHub 仓库。
2. **Framework Preset** 选择 **Other**；**Build Command** 留空（或填 `npm run build`，其仅打印提示）；**Output Directory** 填 **`.`**。
3. 点击 **Deploy**，完成后得到 `<项目名>.vercel.app` 地址，每次 push 自动更新。

## ✅ 数据校验

```bash
npm run validate
```

校验规则（`scripts/validate.mjs`）：

- `cats` 为数组，且每只猫必填字段齐全；
- `id` 全站唯一；
- `lat` ∈ [-90, 90]、`lng` ∈ [-180, 180]；
- `gender` 仅限 `male`/`female`，`status` 仅限 `已绝育`/`未绝育`；
- `photo` 为相对路径字符串；
- `relations` 的 `from`/`to` 必须引用存在的猫咪 id，`relation` 取值受限。

有错时脚本以退出码 1 结束（CI 中可拦截错误推送）。

## 🗺️ 地图源说明

默认首选**高德地图**瓦片（国内直连、带中文标注、无需 Key），OSM / CARTO 作为境外备用，按顺序自动回退。修改 `js/config.js` 的 `TILE_PROVIDERS` 数组即可调整首选源或顺序。

### 接入天地图（官方免费、合规）

1. 到 [天地图控制台](https://console.tianditu.gov.cn) 免费注册并申请一个浏览器端 Key。
2. 打开 `js/config.js`，在示例注释处填入 Key 并把天地图条目加入 `TILE_PROVIDERS`（可放在第一位）。
3. 保存后刷新即可。

> 说明：高德/腾讯等瓦片为第三方非官方接口，适合应急与演示；正式对外项目建议使用天地图（官方、免费、需 Key）。

## ❓ 常见问题

**Q：为什么本地直接双击 index.html 打不开/不显示数据？**
部分浏览器禁止在 `file://` 下发起 `fetch` 请求。请改用 `npm start` 或 `python -m http.server` 起本地服务。

**Q：改了 JSON 数据不生效？**
确保 JSON 格式正确（无多余逗号、引号闭合），并运行 `npm run validate`。浏览器可能需要强制刷新（Ctrl/Cmd+Shift+R）清除缓存。

**Q：地图不显示？**
按以下顺序排查：
1. **必须用本地服务器预览**：直接双击 `index.html`（file:// 协议）时浏览器会拦截数据请求，地图无法初始化。请改用 `npm start` 或 `python -m http.server 4173`。
2. **检查网络/CDN**：Leaflet 与 ECharts 自 jsdelivr / unpkg / cdnjs 三级回退加载（页面已内置）。若三个 CDN 都不可达（部分校园网/大陆网络环境），页面会给出明确的中文错误提示。必要时可将 `leaflet.css`、`leaflet.js`、`echarts.min.js` 下载到 `vendor/` 目录并改为本地引用。
3. **瓦片源自动回退**：默认 OSM 瓦片加载失败时，地图会自动切换到 CARTO / 高德瓦片（右下角有提示）。也可在 `js/config.js` 的 `TILE_PROVIDERS` 调整首选源或顺序。
4. 校园坐标以广东石油化工学院官渡校区为中心，换校区请改 `js/config.js` 的 `CAMPUS_CENTER` 与 `DEFAULT_ZOOM`。

**Q：GitHub Pages 和 Cloudflare Pages 能同时用吗？**
可以。两者各自独立部署，互不影响，任选其一即可满足托管需求；也可一个作为主站、一个作为备份。

**Q：为什么我的 GitHub Pages 地址是 404？**
首次部署有几分钟生效时间；确认在 **Settings → Pages** 已开启 Pages 且 Source 配置正确；若用 Actions 方式，请确认仓库 Settings 中 Actions 的 Workflow permissions 允许写入。

## 📄 相关文档

- [架构设计文档](ARCHITECTURE.md)
- [详细部署指南](docs/DEPLOYMENT.md)
