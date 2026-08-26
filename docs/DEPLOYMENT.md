# 部署指南（DEPLOYMENT）

> 详细说明本项目的部署、更新、回滚与自定义域名配置。本仓库是**纯静态站点**（无后端、无构建），可部署到 GitHub Pages、Cloudflare Pages 或 Vercel，**三者任选其一即可，互不冲突**。

---

## 1. 部署前准备

1. 将代码推送到 GitHub 仓库（默认分支 `main`）。
2. 本地确认数据合法：`npm run validate`。
3. 选择下面的任一平台按步骤部署。

---

## 2. GitHub Pages 部署

### 2.1 方式一：GitHub Actions 自动部署（推荐）

仓库已内置工作流 `.github/workflows/deploy-pages.yml`：

1. 打开仓库 **Settings → Pages**。
2. 在 **Build and deployment → Source** 处选择 **GitHub Actions**。
3. 之后每次 push 到 `main`，工作流会自动执行：

   - `actions/checkout@v4` 检出代码；
   - `actions/configure-pages@v5` 配置 Pages；
   - `actions/upload-pages-artifact@v3`（`path: "."`）打包站点；
   - `actions/deploy-pages@v4` 发布。

4. 工作流在 **Actions** 页可见；运行成功后访问：

   `https://<用户名>.github.io/<仓库名>/`

**权限说明：** 工作流已声明 `permissions: { pages: write, id-token: write, contents: read }`，无需额外配置 Secrets。若部署被拒绝，请确认仓库 **Settings → Actions → General → Workflow permissions** 允许写入（Read and write）。

### 2.2 方式二：直接发布 main 分支（无需 Actions）

1. 仓库 **Settings → Pages**。
2. **Source** 选择 **Deploy from a branch**。
3. **Branch** 选 `main`，**directory** 选 `/ (root)`。
4. 点击 **Save**。首次部署需等待约 1 分钟。

> 注意：本方式与 Actions 方式**二选一**，不要在 Pages 设置中同时使用两种 Source。

### 2.3 部署到项目站点（Project site）路径

若仓库名为 `<用户名>.github.io`（用户/组织主页），站点直接部署在根路径 `https://<用户名>.github.io/`；否则部署在子路径 `/仓库名/` 下。本项目全部使用相对路径，天然兼容子路径部署，无需额外配置。

---

## 3. Cloudflare Pages 部署

### 3.1 连接 GitHub 仓库

1. 注册/登录 [Cloudflare Dashboard](https://dash.cloudflare.com)。
2. 左侧菜单选择 **Workers & Pages** → **Create** → **Pages** → **Connect to Git**。
3. 授权 Cloudflare 访问你的 GitHub 账号，并选择本项目仓库。

### 3.2 配置构建

在 **Set up builds and deployments** 页面：

- **Framework preset**：选择 **None**（或 **Static**）。
- **Build command**：**留空**（本项目无构建步骤）。
- **Output directory**：填 **`.`**（站点文件位于仓库根目录）。

> 如需在构建时跑数据校验，可在 Build command 填 `npm run validate`；但这不是必须的，因为本项目不产出构建产物，`Output directory: .` 直接发布整个仓库。

### 3.3 首次部署

点击 **Save and Deploy**。构建完成后会得到：

`https://<项目名>.pages.dev`

每次 push 到 `main` 会自动触发重新构建并更新。

### 3.4 免费额度说明

Cloudflare Pages 免费版：

- **不限带宽、不限请求数**；
- 每月 **500 次构建**（对校园项目完全够用）。

### 3.5 国内访问说明

- **免费版**：不一定接入京东云合作节点，中国大陆访问速度与稳定性因网络环境而异，整体可用但可能不如境外节点快。
- **企业版 / 已备案域名**：可接入中国网络（Cloudflare 与京东云合作，覆盖国内 30+ 城市），获得更稳定、更快的国内访问。

### 3.6 自定义域名（Cloudflare）

1. Cloudflare Pages 项目 → **Custom domains** → **Add custom domain**。
2. 输入域名并按提示添加 CNAME 记录（如 `www` → `<项目名>.pages.dev`）。
3. 等待 DNS 生效（Cloudflare 会自动签发 HTTPS 证书）。

---

## 4. Vercel 部署

1. 注册/登录 [Vercel](https://vercel.com) → **Add New → Project** → 导入 GitHub 仓库。
2. **Framework Preset** 选 **Other**；**Build Command** 留空（或填 `npm run build`，其仅打印提示）；**Output Directory** 填 **`.`**。
3. 点击 **Deploy**，得到 `<项目名>.vercel.app` 地址。
4. 每次 push 自动重新部署。

**自定义域名（Vercel）：** 项目 → **Settings → Domains** → 添加域名并按提示配置 DNS（Vercel 自动托管证书）。

---

## 5. 更新站点

任何平台均只需**修改数据/代码后推送**即可自动更新：

1. 编辑 `data/cats.json`、`data/relations.json`（新增/修改猫咪或关系）。
2. 本地运行 `npm run validate` 确认数据合法。
3. `git add . && git commit -m "更新数据" && git push`。

- **GitHub Pages（Actions 方式）**：push 后工作流自动部署。
- **Cloudflare Pages / Vercel**：push 后平台自动重新构建。

---

## 6. 回滚

### GitHub Pages

- **Actions 方式**：在 **Actions** 页找到最近一次成功的运行 → **Re-run**；若要回退到旧版本，可在仓库 **Commits** 中回退到某个旧提交并 push（`git revert` 或 `git reset` + 强制推送）。
- **分支方式**：在 **Settings → Pages** 的 Source 中临时切换到旧提交所在分支，或直接回退 main 分支。

### Cloudflare Pages

在 **Deployments** 列表中找到目标历史版本 → 点击 **···** → **Rollback to this deployment**（免费版支持）。

### Vercel

在 **Deployments** 页找到历史部署 → **···** → **Promote to Production**（回滚到该版本）。

---

## 7. 自定义域名通用说明

无论用哪个平台，绑定自定义域名前，需先到域名注册商/DNS 服务商处把域名解析指向对应平台提供的记录：

| 平台 | 记录类型 | 目标 |
| --- | --- | --- |
| GitHub Pages | CNAME（或 A 记录） | `<用户名>.github.io`（或用官方指定 IP） |
| Cloudflare Pages | CNAME | `<项目名>.pages.dev` |
| Vercel | CNAME | `cname.vercel-dns.com`（按项目设置为准） |

绑定后在平台设置中添加域名并等待 HTTPS 证书签发即可。

---

## 8. 常见问题

**Q：GitHub Pages 与 Cloudflare Pages 冲突吗？**
不冲突。两者是独立的静态托管服务，可同时部署同一仓库（作为主站与备份），或只用一个。

**Q：为什么要用相对路径？**
保证站点在 GitHub Pages 子路径（`/仓库名/`）部署时资源也能正确加载。请勿在代码中写死以 `/` 开头的绝对路径。

**Q：本地预览和线上效果不一致？**
请用 `npm start`（http 服务）而非直接双击 index.html；线上请强制刷新清缓存。

**Q：改了数据没生效？**
确认 JSON 合法并通过 `npm run validate`；确认 push 成功且对应平台构建成功；清理浏览器缓存。
