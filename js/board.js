// board.js — 留言墙（弹幕 + 留言列表），挂在首页「评分·留言墙」标签页里
// 数据走后端 likes 函数的留言接口；接口不可用时退回本地缓存 + 官方欢迎语，保证墙不空着。
import { showToast } from './ui.js?v=20260926a';

// 与 ratings.js 同一个后端函数（likes），这里单独写一份地址是为了不动 ratings.js 的版本号
const LIKES_API = (typeof window !== 'undefined' && window.YMCAO_LIKES_API)
  ? window.YMCAO_LIKES_API + '/.netlify/functions/likes'
  : 'https://melodic-crepe-74a890.netlify.app/.netlify/functions/likes';

const CACHE_KEY = 'ymcao_board_v3';   // v3：去掉官方欢迎语，换 key 让老缓存里的欢迎语一并清掉
const MAX_LEN = 60;          // 留言正文上限（与输入框 maxlength 一致）
const NAME_LEN = 12;
const COOLDOWN_MS = 20000;   // 防刷：同一个人 20 秒内只能发一条
const DM_INTERVAL = 3000;    // 弹幕节奏
const DM_SPEED = 68;         // 弹幕速度 px/秒
const LANE_MIN_H = 30;       // 每条轨道最小高度，决定同时能飘几行
const LIST_LIMIT = 3;        // 留言列表默认显示条数

let dm = null;               // 弹幕轨道容器
let listEl = null;
let listCountEl = null;
let moreBtn = null;
let composer = null;
let writeBtn = null;
let blToggle = null;
let blBody = null;
let nameEl = null;
let textEl = null;
let countEl = null;
let sendBtn = null;
let popEl = null;            // 点弹幕弹出的小气泡
let popName = null;
let popText = null;
let popLike = null;
let popLikeN = null;
let wallEmpty = null;        // 墙上还没有留言时显示的引导语

let messages = [];
let listExpanded = false;
let dmOn = true;
let paused = false;
let pausedAt = 0;
let laneFree = {};
let seq = 0;
let dmTimer = null;
let lastSent = 0;
let inited = false;
let picked = null;           // 当前被点开的弹幕元素
let pickedMsg = null;        // 它对应的留言
let pausedByPop = false;     // 这次暂停是不是弹窗引起的（决定关掉弹窗要不要继续飘）
let tapStart = null;         // 用来区分「点一下」和「滑动」
let tapHandledAt = 0;        // pointer 路径刚处理过的时间，避免 click 兜底重复触发
const likeBusy = {};         // 同一条留言防连点

/* ---------- 工具 ---------- */
function fmtTime(ts) {
  const d = Date.now() - ts;
  if (d < 60000) return '刚刚';
  if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
  if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前';
  const dt = new Date(ts);
  return (dt.getMonth() + 1) + ' 月 ' + dt.getDate() + ' 日';
}

function normalize(m) {
  return {
    id: String((m && m.id) || ''),
    name: String((m && m.name) || '匿名猫友').slice(0, NAME_LEN) || '匿名猫友',
    content: String((m && m.content) || '').slice(0, MAX_LEN),
    at: Number(m && m.at) || Date.now(),
    likes: Math.max(0, Number((m && m.likes) || 0)),
    likedByMe: !!(m && m.likedByMe),
    mine: !!(m && m.mine)
  };
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (o && Array.isArray(o.list) && o.list.length) return o.list.map(normalize);
  } catch (e) {}
  return null;
}

function writeCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ list: messages, ts: Date.now() })); } catch (e) {}
}

// 弹幕轮播顺序：新留言优先
function rotation() { return messages.slice(); }

/* ---------- 弹幕 ---------- */
function laneCount() { return Math.max(3, Math.floor(dm.clientHeight / LANE_MIN_H)); }
function laneTop(i) {
  const n = laneCount();
  const h = dm.clientHeight / n;
  return i * h + h / 2;
}
function pickLane() {
  const n = laneCount(), now = Date.now();
  for (let i = 0; i < n; i++) if (!laneFree[i] || laneFree[i] <= now) return i;
  let best = 0;
  for (let i = 1; i < n; i++) if (laneFree[i] < laneFree[best]) best = i;
  return best;
}

// 弹幕内容：正文 + 点赞数（❤️3）
function fillDm(el, m) {
  el.textContent = '';
  const txt = document.createElement('span');
  txt.textContent = m.name + '：' + m.content;
  el.appendChild(txt);
  if (m.likes > 0) {
    const lk = document.createElement('span');
    lk.className = 'dm-like';
    lk.textContent = '❤️' + m.likes;
    el.appendChild(lk);
  }
}

function shoot(m) {
  if (!dmOn || !dm || !dm.clientWidth || !m) return;
  const el = document.createElement('div');
  el.className = 'dm' + (m.mine ? ' mine' : '');
  el.dataset.mid = m.id || '';
  // 先摘掉动画名：下面要读 offsetWidth 强制布局，而此刻 animation-duration 还是默认的 0s，
  // 若挂着动画，浏览器会判定动画「已结束」并立刻派发 animationend，元素当场被移除（弹幕全没了）。
  el.style.animationName = 'none';
  fillDm(el, m);
  dm.appendChild(el);

  const cw = dm.clientWidth;
  const w = el.offsetWidth;
  const dur = (cw + w) / DM_SPEED;
  const lane = pickLane();
  el.style.top = Math.max(0, laneTop(lane) - el.offsetHeight / 2) + 'px';
  el.style.setProperty('--cw', cw + 'px');
  el.style.animationDuration = dur + 's';
  if (paused) el.style.animationPlayState = 'paused';
  el.style.animationName = '';   // 恢复 CSS 里的 dm-move，动画从此刻才开始跑

  laneFree[lane] = Date.now() + dur * (w / (cw + w)) * 1000 + 320;
  el.addEventListener('animationend', () => { if (el.parentNode) el.parentNode.removeChild(el); });
}

function clearDanmaku() {
  closePop();
  if (!dm) return;
  while (dm.firstChild) dm.removeChild(dm.firstChild);
  laneFree = {};
}

function tick() {
  if (!dmOn || paused || !dm || !dm.clientWidth) return; // 标签页没显示时不发，省性能
  const rot = rotation();
  if (!rot.length) return;
  // 已经飘在墙上的那条不要再发一遍，否则留言少时会出现多条一模一样的内容
  const onWall = new Set();
  dm.querySelectorAll('.dm').forEach((el) => { if (el.dataset.mid) onWall.add(el.dataset.mid); });
  for (let i = 0; i < rot.length; i++) {
    const idx = (seq + i) % rot.length;
    const m = rot[idx];
    if (onWall.has(m.id)) continue;
    seq = idx + 1;
    shoot(m);
    return;
  }
}

// 切到本标签页时先放一小串，避免刚打开墙上空着
function burst() {
  if (!dm || !dm.clientWidth) return;
  clearDanmaku();
  const rot = rotation();
  const n = Math.min(3, rot.length);
  for (let i = 0; i < n; i++) setTimeout(() => shoot(rot[i]), i * 280);
  seq = n;
}

function setPaused(p) {
  paused = p;
  if (!dm) return;
  dm.querySelectorAll('.dm').forEach((el) => { el.style.animationPlayState = p ? 'paused' : 'running'; });
  if (p) { pausedAt = Date.now(); }
  else if (pausedAt) {
    const delta = Date.now() - pausedAt;
    Object.keys(laneFree).forEach((k) => { laneFree[k] += delta; });
    pausedAt = 0;
  }
  const btn = document.getElementById('dm-pause');
  if (btn) {
    btn.textContent = p ? '▶ 继续' : '⏸ 暂停';
    btn.classList.toggle('off', p);
  }
}

/* ---------- 点赞（列表按钮和弹幕气泡共用同一套） ---------- */
async function postLike(id, on) {
  try {
    const r = await fetch(LIKES_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'like-message', id: id, toggle: on })
    });
    const j = await r.json().catch(() => null);
    if (j && j.ok) return { ok: true, likes: Number(j.likes) || 0, liked: !!j.liked };
  } catch (e) {}
  return { ok: false };
}

function syncPopLike(m) {
  if (!popLike || !m) return;
  popLike.classList.toggle('on', m.likedByMe);
  popLike.setAttribute('aria-pressed', String(m.likedByMe));
  if (popLikeN) popLikeN.textContent = String(m.likes);
}

// 把某条留言的最新点赞状态刷到所有已渲染的地方：列表按钮 / 墙上的弹幕 / 气泡
function applyLike(id) {
  const m = messages.find((x) => x.id === id);
  if (!m) return;
  if (listEl) {
    listEl.querySelectorAll('.msg-like').forEach((b) => {
      if (b.dataset.mid !== id) return;
      b.classList.toggle('on', m.likedByMe);
      b.setAttribute('aria-pressed', String(m.likedByMe));
      const n = b.querySelector('b');
      if (n) n.textContent = String(m.likes);
    });
  }
  if (dm) {
    dm.querySelectorAll('.dm').forEach((el) => {
      if (el.dataset.mid !== id) return;
      let lk = el.querySelector('.dm-like');
      if (m.likes > 0) {
        if (!lk) { lk = document.createElement('span'); lk.className = 'dm-like'; el.appendChild(lk); }
        lk.textContent = '❤️' + m.likes;
      } else if (lk) {
        lk.remove();
      }
    });
  }
  syncPopLike(m);
}

function toggleLike(id) {
  const m = messages.find((x) => x.id === id);
  if (!m || likeBusy[id]) return;
  likeBusy[id] = 1;
  const on = !m.likedByMe;
  // 先乐观更新，点下去立刻有反馈；后端回来再校正
  m.likedByMe = on;
  m.likes = Math.max(0, m.likes + (on ? 1 : -1));
  applyLike(id);
  writeCache();
  postLike(id, on).then((res) => {
    delete likeBusy[id];
    if (!res.ok) return;   // 后端够不到：保留本机结果，不打扰用户
    if (res.likes !== m.likes || res.liked !== m.likedByMe) {
      m.likes = res.likes;
      m.likedByMe = res.liked;
      applyLike(id);
      writeCache();
    }
  });
}

/* ---------- 点弹幕弹出的小气泡 ---------- */
// 点中某条弹幕：没开就开、已开同一条就收起
function handleTap(el) {
  const id = el && el.dataset.mid;
  const m = id ? messages.find((x) => x.id === id) : null;
  if (!m) return;
  if (picked === el) { closePop(); return; }
  if (picked) picked.classList.remove('picked');
  openPop(el, m);
}

function openPop(el, m) {
  if (!popEl) return;
  picked = el;
  pickedMsg = m;
  el.classList.add('picked');
  if (popName) popName.textContent = m.name;
  if (popText) popText.textContent = m.content;
  syncPopLike(m);
  popEl.hidden = false;
  // 只在「本来没暂停」时才由弹窗暂停；否则关掉弹窗会误把用户手动按的暂停给放了
  if (!paused) { pausedByPop = true; setPaused(true); }
}

function closePop() {
  if (!popEl || popEl.hidden) return;
  popEl.hidden = true;
  if (picked) picked.classList.remove('picked');
  picked = null;
  pickedMsg = null;
  if (pausedByPop) { pausedByPop = false; setPaused(false); }
}

// 列表里每条的 ❤️ 按钮
function makeLikeBtn(m) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'msg-like' + (m.likedByMe ? ' on' : '');
  b.dataset.mid = m.id;
  b.setAttribute('aria-pressed', String(m.likedByMe));
  b.setAttribute('aria-label', '点赞');
  const h = document.createElement('span');
  h.textContent = '❤️';
  const n = document.createElement('b');
  n.textContent = String(m.likes || 0);
  b.appendChild(h);
  b.appendChild(n);
  b.addEventListener('click', () => toggleLike(m.id));
  return b;
}

/* ---------- 留言列表 ---------- */
function renderList() {
  if (!listEl) return;
  listEl.textContent = '';
  const show = listExpanded ? messages.length : Math.min(LIST_LIMIT, messages.length);
  for (let i = 0; i < show; i++) {
    const m = messages[i];
    const row = document.createElement('div');
    row.className = 'msg';

    const av = document.createElement('div');
    av.className = 'msg-avatar';
    av.textContent = (m.name || '匿').charAt(0);

    const body = document.createElement('div');
    body.className = 'msg-body';

    const top = document.createElement('div');
    top.className = 'msg-top';
    const nm = document.createElement('span');
    nm.className = 'msg-name';
    nm.textContent = m.name;
    const tm = document.createElement('span');
    tm.className = 'msg-time';
    tm.textContent = fmtTime(m.at);
    top.appendChild(nm);
    top.appendChild(tm);

    const tx = document.createElement('div');
    tx.className = 'msg-text';
    tx.textContent = m.content;

    body.appendChild(top);
    body.appendChild(tx);
    row.appendChild(av);
    row.appendChild(body);
    row.appendChild(makeLikeBtn(m));
    listEl.appendChild(row);
  }
  if (!messages.length) {
    const p = document.createElement('div');
    p.className = 'msg msg-empty';
    p.textContent = '还没有人留言，来做第一个吧～';
    listEl.appendChild(p);
  }
  // 墙上没留言时给一句引导，别让留言墙空着像坏了
  if (wallEmpty) wallEmpty.hidden = messages.length > 0;
  if (listCountEl) listCountEl.textContent = messages.length ? messages.length + ' 条' : '暂无';
  if (moreBtn) {
    const rest = messages.length - show;
    if (rest > 0) {
      moreBtn.hidden = false;
      moreBtn.textContent = '展开剩余 ' + rest + ' 条 ▾';
    } else if (listExpanded && messages.length > LIST_LIMIT) {
      moreBtn.hidden = false;
      moreBtn.textContent = '收起 ▴';
    } else {
      moreBtn.hidden = true;
    }
  }
}

/* ---------- 读写留言 ---------- */
async function loadMessages() {
  const cached = readCache();
  messages = cached || [];
  renderList();

  try {
    const r = await fetch(LIKES_API + '?messages=true', { method: 'GET', cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (!j || !j.ok || !Array.isArray(j.messages)) throw new Error('bad payload');
    messages = j.messages.map(normalize);
    writeCache();
    renderList();
    burst();
  } catch (e) {
    // 后端暂时够不到：继续用本地缓存，不打扰用户
  }
}

async function postMessage(name, content) {
  try {
    const r = await fetch(LIKES_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add-message', name: name, content: content })
    });
    const j = await r.json().catch(() => null);
    if (j && j.ok && Array.isArray(j.messages)) {
      messages = j.messages.map(normalize);
      writeCache();
      return { ok: true };
    }
    // 429 是「发太快」这类对用户有意义的提示，透出去；其余（接口未上线、参数不认、5xx）都当后端够不到
    if (r.status === 429 && j && j.error) return { ok: false, error: j.error };
  } catch (e) {}
  // 接口不可用：先留在本机，别让用户白写一场
  messages.unshift({ id: 'local' + Date.now().toString(36), name: name, content: content, at: Date.now(), mine: true });
  writeCache();
  return { ok: true, offline: true };
}

function submit() {
  if (!textEl) return;
  const text = textEl.value.trim();
  if (!text) { showToast('先写点什么再发送吧～'); textEl.focus(); return; }
  const wait = COOLDOWN_MS - (Date.now() - lastSent);
  if (wait > 0) { showToast('发送太快啦，歇 ' + Math.ceil(wait / 1000) + ' 秒再发～'); return; }

  const name = (nameEl && nameEl.value.trim().slice(0, NAME_LEN)) || '匿名猫友';
  lastSent = Date.now();
  sendBtn.disabled = true;
  sendBtn.textContent = '发送中…';

  postMessage(name, text).then((res) => {
    sendBtn.disabled = false;
    sendBtn.textContent = '🚀 发送，让它飘过留言墙';
    if (!res.ok) { showToast(res.error || '发送失败，稍后再试～'); return; }
    const mine = messages.find((m) => m.content === text && m.name === name) || { name: name, content: text, mine: true };
    mine.mine = true;
    listExpanded = false;
    renderList();
    shoot(mine);
    textEl.value = '';
    if (countEl) countEl.textContent = '0';
    showToast(res.offline ? '网络不太顺，留言先存在本机了' : '留言已发布，正在墙上飘～');
  });
}

/* ---------- 两个入口的展开/收起（同一时间只开一个，保持页面短） ---------- */
function setComposerOpen(open) {
  if (!composer || !writeBtn) return;
  composer.hidden = !open;
  writeBtn.setAttribute('aria-expanded', String(open));
  writeBtn.textContent = open ? '✕ 收起输入框' : '✍️ 写一条留言';
  if (!open) return;
  if (blToggle && blBody && !blBody.hidden) setListOpen(false);
  composer.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  textEl.focus();
}

function setListOpen(open) {
  if (!blBody || !blToggle) return;
  blBody.hidden = !open;
  blToggle.setAttribute('aria-expanded', String(open));
  if (open && composer && !composer.hidden) setComposerOpen(false);
}

/* ---------- 初始化 ---------- */
export function initBoard() {
  if (inited) return;
  if (!document.getElementById('board-wall')) return; // 没有留言墙的页面（如档案页）直接跳过
  inited = true;

  dm = document.getElementById('dm-wall');
  listEl = document.getElementById('bl-items');
  listCountEl = document.getElementById('bl-count');
  moreBtn = document.getElementById('bl-more');
  composer = document.getElementById('board-composer');
  writeBtn = document.getElementById('wall-write-btn');
  blToggle = document.getElementById('bl-toggle');
  blBody = document.getElementById('bl-body');
  nameEl = document.getElementById('bc-name');
  textEl = document.getElementById('bc-text');
  countEl = document.getElementById('bc-count');
  sendBtn = document.getElementById('bc-send');
  popEl = document.getElementById('dm-pop');
  popName = document.getElementById('dmp-name');
  popText = document.getElementById('dmp-text');
  popLike = document.getElementById('dmp-like');
  popLikeN = document.getElementById('dmp-like-n');
  wallEmpty = document.getElementById('wall-empty');

  const dmToggle = document.getElementById('dm-toggle');
  const dmPause = document.getElementById('dm-pause');

  // 弹幕开的时候点暂停：先收掉气泡，再切换暂停状态
  if (dmPause) dmPause.addEventListener('click', () => { closePop(); setPaused(!paused); });
  if (dmToggle) dmToggle.addEventListener('click', () => {
    dmOn = !dmOn;
    dmToggle.textContent = '弹幕 ' + (dmOn ? '开' : '关');
    dmToggle.classList.toggle('off', !dmOn);
    if (dmOn) burst(); else clearDanmaku();
  });

  // 点弹幕 -> 暂停并弹出这条留言。用 pointerdown/up 自己判断，
  // 因为弹幕一直在动，直接听 click 会因为手指抬起时元素已经飘走而落空。
  // 再挂一个 click 兜底：键盘/程序触发的点击只有 click 事件，没有 pointer 序列。
  if (dm) {
    dm.addEventListener('pointerdown', (e) => {
      const el = e.target.closest ? e.target.closest('.dm') : null;
      tapStart = el ? { x: e.clientX, y: e.clientY, t: Date.now(), el: el } : null;
    });
    dm.addEventListener('pointerup', (e) => {
      const s = tapStart;
      tapStart = null;
      if (!s) return;
      // 滑动了或者按太久，都当作用户在翻页/长按，不弹
      if (Math.abs(e.clientX - s.x) > 8 || Math.abs(e.clientY - s.y) > 8) return;
      if (Date.now() - s.t > 500) return;
      e.stopPropagation();
      tapHandledAt = Date.now();
      handleTap(s.el);
    });
    dm.addEventListener('pointercancel', () => { tapStart = null; });
    dm.addEventListener('click', (e) => {
      if (Date.now() - tapHandledAt < 400) return;   // pointer 路径已经开过了
      const el = e.target.closest ? e.target.closest('.dm') : null;
      if (el) handleTap(el);
    });
  }

  // 点墙上别的地方（含气泡外）就收起气泡并继续飘；气泡自己内部不关
  if (popEl) {
    popEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    popEl.addEventListener('click', (e) => e.stopPropagation());
  }
  if (popLike) popLike.addEventListener('click', () => { if (pickedMsg) toggleLike(pickedMsg.id); });
  document.addEventListener('pointerdown', (e) => {
    if (!popEl || popEl.hidden) return;
    if (popEl.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.dm')) return;  // 点的是别的弹幕，交给上面换气泡
    closePop();
  });

  if (writeBtn && composer) writeBtn.addEventListener('click', () => setComposerOpen(composer.hidden));
  if (blToggle && blBody) blToggle.addEventListener('click', () => setListOpen(blBody.hidden));
  if (textEl && countEl) {
    textEl.addEventListener('input', () => { countEl.textContent = String(textEl.value.length); });
    textEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
    });
  }
  if (sendBtn) sendBtn.addEventListener('click', submit);
  if (moreBtn) moreBtn.addEventListener('click', () => { listExpanded = !listExpanded; renderList(); });

  // 切到本标签页时补一串弹幕（标签页隐藏时 dm.clientWidth 为 0，弹幕自然停发）
  const rankTab = document.querySelector('.tab-bar [data-tab="rank"]');
  if (rankTab) rankTab.addEventListener('click', () => setTimeout(burst, 80));

  let rzTimer = null;
  window.addEventListener('resize', () => {
    if (rzTimer) clearTimeout(rzTimer);
    rzTimer = setTimeout(() => { if (dmOn) burst(); }, 320);
  });

  loadMessages();
  dmTimer = setInterval(tick, DM_INTERVAL);
  if (dm && dm.clientWidth) burst();
}