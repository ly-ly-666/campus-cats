import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

let exitCode = 0;
function error(msg) {
  console.error("❌", msg);
  exitCode = 1;
}
function ok(msg) {
  console.log("✅", msg);
}

// ---------- helpers ----------
const VALID_GENDERS = new Set(["male", "female"]);
const VALID_STATUSES = new Set(["已绝育", "未绝育"]);
const VALID_RELATIONS = new Set(["配偶", "父子", "母子", "兄弟姐妹", "朋友"]);
const REQUIRED_CAT_FIELDS = ["id", "name", "gender", "color", "area", "lat", "lng", "description", "status", "firstSeen"];
const REQUIRED_RELATION_FIELDS = ["from", "to", "relation"];

// ---------- load ----------
let cats, relations;

try {
  const catsRaw = readFileSync(join(ROOT, "data", "cats.json"), "utf-8");
  cats = JSON.parse(catsRaw);
  if (!Array.isArray(cats)) throw new Error("cats.json 顶层不是数组");
  ok("data/cats.json 解析成功，共 " + cats.length + " 条记录");
} catch (e) {
  error("data/cats.json 读取/解析失败: " + e.message);
  process.exit(1);
}

try {
  const relsRaw = readFileSync(join(ROOT, "data", "relations.json"), "utf-8");
  relations = JSON.parse(relsRaw);
  if (!Array.isArray(relations)) throw new Error("relations.json 顶层不是数组");
  ok("data/relations.json 解析成功，共 " + relations.length + " 条记录");
} catch (e) {
  error("data/relations.json 读取/解析失败: " + e.message);
  process.exit(1);
}

// ---------- validate cats ----------
const catIds = new Set();

for (let i = 0; i < cats.length; i++) {
  const c = cats[i];
  const idx = "cats[" + i + "]";

  // 必填字段
  for (const f of REQUIRED_CAT_FIELDS) {
    if (c[f] === undefined || c[f] === null || c[f] === "") {
      error(idx + " 缺少必填字段: " + f);
    }
  }

  // id 唯一
  if (c.id) {
    if (catIds.has(c.id)) {
      error(idx + " id 重复: " + c.id);
    }
    catIds.add(c.id);
  }

  // lat / lng 数值范围
  if (typeof c.lat !== "number" || c.lat < -90 || c.lat > 90) {
    error(idx + " lat 无效 (应为 -90~90 数值): " + JSON.stringify(c.lat));
  }
  if (typeof c.lng !== "number" || c.lng < -180 || c.lng > 180) {
    error(idx + " lng 无效 (应为 -180~180 数值): " + JSON.stringify(c.lng));
  }

  // gender
  if (c.gender !== undefined && !VALID_GENDERS.has(c.gender)) {
    error(idx + " gender 无效 (应为 male/female): " + c.gender);
  }

  // status
  if (c.status !== undefined && !VALID_STATUSES.has(c.status)) {
    error(idx + " status 无效 (应为 已绝育/未绝育): " + c.status);
  }

  // firstSeen YYYY-MM
  if (c.firstSeen && !/^\d{4}-\d{2}$/.test(c.firstSeen)) {
    error(idx + " firstSeen 格式无效 (应为 YYYY-MM): " + c.firstSeen);
  }

  // nickname 可选字符串
  if (c.nickname !== undefined && c.nickname !== null && typeof c.nickname !== "string") {
    error(idx + " nickname 应为字符串: " + JSON.stringify(c.nickname));
  }

  // leftAt 可选（离开时间，YYYY-MM；填了即标记为“过往”猫咪）
  if (c.leftAt && !/^\d{4}-\d{2}$/.test(c.leftAt)) {
    error(idx + " leftAt 格式无效 (应为 YYYY-MM): " + c.leftAt);
  }

  // photo 为相对路径字符串（可选字段）
  if (c.photo !== undefined && c.photo !== null && c.photo !== "" && typeof c.photo !== "string") {
    error(idx + " photo 应为字符串路径: " + JSON.stringify(c.photo));
  }
}

// ---------- validate relations ----------
for (let i = 0; i < relations.length; i++) {
  const r = relations[i];
  const idx = "relations[" + i + "]";

  for (const f of REQUIRED_RELATION_FIELDS) {
    if (r[f] === undefined || r[f] === null || r[f] === "") {
      error(idx + " 缺少必填字段: " + f);
    }
  }

  // from / to 必须存在于 cats
  if (r.from && !catIds.has(r.from)) {
    error(idx + " from 引用不存在的猫咪 id: " + r.from);
  }
  if (r.to && !catIds.has(r.to)) {
    error(idx + " to 引用不存在的猫咪 id: " + r.to);
  }

  // relation 取值
  if (r.relation !== undefined && !VALID_RELATIONS.has(r.relation)) {
    error(idx + " relation 无效 (应为 配偶/父子/母子/兄弟姐妹/朋友): " + r.relation);
  }
}

// ---------- summary ----------
if (exitCode === 0) {
  ok("数据校验通过");
} else {
  console.error("\n⚠️  校验未通过，请修正上述错误后重新运行");
}

process.exitCode = exitCode;
