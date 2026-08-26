// data.js — 数据加载模块（读取 data/cats.json / data/relations.json）
// 全部使用相对路径，保证在 GitHub Pages 子路径部署下也能正确加载。

/**
 * 异步加载猫咪与关系数据。
 * @returns {Promise<{cats: Array, relations: Array}>} 包含 cats 与 relations 的对象
 */
export async function loadData() {
  let cats, relations, siteConfig = {};

  try {
    const cfgResp = await fetch('./data/site-config.json');
    if (cfgResp.ok) siteConfig = await cfgResp.json();
  } catch (e) {
    siteConfig = {};
  }

  try {
    const catResp = await fetch('./data/cats.json');
    if (!catResp.ok) {
      throw new Error(`猫咪数据加载失败（HTTP ${catResp.status}）`);
    }
    cats = await catResp.json();
  } catch (e) {
    throw new Error(`无法加载 data/cats.json：${e.message}`);
  }

  try {
    const relResp = await fetch('./data/relations.json');
    if (!relResp.ok) {
      throw new Error(`关系数据加载失败（HTTP ${relResp.status}）`);
    }
    relations = await relResp.json();
  } catch (e) {
    throw new Error(`无法加载 data/relations.json：${e.message}`);
  }

  return { cats, relations, siteConfig };
}