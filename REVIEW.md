# 评审记录（REVIEW）

> 评审人：reviewer（评审员）｜评审时间：2025-08-26｜版本：v1.0 终审
> 评审方式：全项目代码走查 + `node scripts/validate.mjs` 数据校验 + 模块/引用交叉核对

## 一、评审结论

**✅ 通过（PASS）**

- 数据校验脚本 `node scripts/validate.mjs` 全部通过（退出码 0）：8 只猫咪、9 条关系，无报错。
- 全部 6 个 JS 模块通过 ESM 语法检查（`node --input-type=module --check`）。
- 相对路径、模块 import/export、HTML id-JS 引用、CSS 类、CDN 引用均核对一致。
- 发现 5 处小问题，已全部直接修复（见修改列表）；**无重大/阻断性问题**。

## 二、检查项与结果

| # | 检查项 | 结果 | 说明 |
|---|--------|------|------|
| 1 | 数据校验（validate.mjs） | ✅ | cats.json 8 条、relations.json 9 条，全部合法；id 唯一、from/to 引用均存在、字段取值受限 |
| 2 | 相对路径 | ✅ | index.html→./style.css、./js/main.js；data.js fetch ./data/cats.json、./data/relations.json；DEFAULT_PHOTO 与 cats.json 中 photo 均为 images/placeholder.svg（文件存在）；全部兼容 GitHub Pages 子路径部署 |
| 3 | JS 模块 import/export 匹配 | ✅ | main.js↔map/graph/ui/data 各导出齐全；graph.js↔config.js（RELATION_STYLE）、ui.js↔config.js（DEFAULT_PHOTO）；无死链、无循环依赖 |
| 4 | HTML id 与 JS 引用一致 | ✅ | #map、#graph、#cat-list、#modal、#loading、#map-view/#graph-view、.tab-bar/[data-tab] 全部匹配；修复：#cat-count 原先无 JS 更新，始终显示 0，已修复 |
| 5 | images/placeholder.svg 存在 | ✅ | 存在于 images/，1842 字节，为有效 SVG |
| 6 | CSS 类与 HTML/JS 一致 | ✅ | cat-item/tag/modal/relation/marker 等类全部有定义；补充：.modal-info-val 原本无样式规则，已补充 |
| 7 | CDN 引用正确 | ✅ | Leaflet 1.9.4（CSS/JS + SRI 哈希为官方值）、ECharts 5.5.1（unpkg、UMD 全局）版本有效 |
| 8 | 文档与实现一致 | ✅（修复后） | ARCHITECTURE.md 的 RELATION_STYLE 示例与 bindTabs 签名原与实现不符，已订正 |
| 9 | CI 工作流 | ✅（修复后） | 原工作流未执行校验，与 README/架构文档"自动校验并部署"不符，已补 setup-node + validate 步骤 |
| 10 | package.json | ✅ | start/dev/validate/build 脚本均可执行；dev 委托给 start 有效 |

## 三、修改列表（评审期间直接修复的小问题）

1. `js/ui.js` — 修复 #cat-count 猫咪数量不更新：renderCatList 末尾更新计数（原 HTML 中该 span 恒为 0）。
2. `js/ui.js` — 删除未使用的死代码 RELATION_REVERSE_LABEL 常量。
3. `js/graph.js` — 复用 ui.js 导出的 escapeHtml，删除本地重复实现（消除重复代码）。
4. `style.css` — 补充 `.modal-info-val { flex: 1 }` 样式规则（弹窗信息行此前缺该类的样式定义）。
5. `.github/workflows/deploy-pages.yml` — 增加 actions/setup-node@v4（node 20）与 `node scripts/validate.mjs` 校验步骤，使 CI 真正"先校验后部署"，与 README/ARCHITECTURE 文档一致。
6. `ARCHITECTURE.md` — 订正 RELATION_STYLE 示例结构（原为颜色/标签，实为颜色/线宽/线型）、bindTabs 签名（补 opts 参数）、§5.1 描述文字。

## 四、备注（非阻断）

- 已知行为（非缺陷）：关系图容器初始为 display:none，ECharts 以零尺寸初始化，切换标签页时已通过 onClick→resizeGraph()（延迟 100ms）自动修正。
- 可选项：validate.mjs 未校验 from≠to 自引用（架构文档有约束，当前数据无自引用，不阻断）；未校验 photo 文件是否存在（当前数据 photo 均为存在的 placeholder.svg，人工已核对）。
- 浏览器共享环境不可用（缺少 Electron），未能做端到端页面渲染验证；建议部署后人工抽查地图/关系图两个标签页。

## 五、验证脚本输出（原始）

```
✅ data/cats.json 解析成功，共 8 条记录
✅ data/relations.json 解析成功，共 9 条记录
✅ 数据校验通过
EXIT=0
```
