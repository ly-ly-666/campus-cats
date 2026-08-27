// relations-util.js — 关系派生工具（无依赖，纯函数）
// 根据父母关系（母子/父子）自动推断「兄弟姐妹」关系，供关系图、详情卡、档案页、本地管理复用。
// 规则：两只猫共享至少一位父母（同母或同父）即视为兄弟姐妹；已在数据里手写的兄弟姐妹不重复。
// 推出来的关系带 auto:true 标记（自动推断），可据此在界面上标注。

/**
 * @param {Array} cats 猫咪数组（含 id）
 * @param {Array} relations 关系数组（含 from/to/relation）
 * @returns {Array} 派生的兄弟姐妹关系 [{ from, to, relation:'兄弟姐妹', auto:true }]
 */
export function deriveSiblingRelations(cats, relations) {
  const catIds = new Set((cats || []).map((c) => c.id));
  const rels = Array.isArray(relations) ? relations : [];

  // 数据里已手写的兄弟姐妹对（去重键），避免重复生成
  const explicit = new Set();
  rels.forEach((r) => {
    if (r.relation !== '兄弟姐妹') return;
    const a = String(r.from), b = String(r.to);
    explicit.add(a < b ? a + '_' + b : b + '_' + a);
  });

  // child -> Set(parents)：收集每只猫的父母
  const parents = new Map();
  const addP = (child, parent) => {
    if (!catIds.has(child) || !catIds.has(parent)) return;
    if (!parents.has(child)) parents.set(child, new Set());
    parents.get(child).add(parent);
  };
  rels.forEach((r) => {
    if (r.relation === '母子' || r.relation === '父子') addP(r.to, r.from);
  });

  const children = [...parents.keys()];
  const result = [];
  const done = new Set(explicit);
  for (let i = 0; i < children.length; i++) {
    for (let j = i + 1; j < children.length; j++) {
      const a = children[i], b = children[j];
      const ps = parents.get(a);
      const shared = [...ps].some((p) => parents.get(b) && parents.get(b).has(p));
      if (!shared) continue;
      const key = a < b ? a + '_' + b : b + '_' + a;
      if (done.has(key)) continue;
      done.add(key);
      result.push({ from: a, to: b, relation: '兄弟姐妹', auto: true });
    }
  }
  return result;
}
