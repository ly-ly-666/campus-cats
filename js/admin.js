// admin.js — 网页端数据管理后台（GitHub API 在线编辑 + 自动部署）
(function () {
  'use strict';

  var CFG_KEY = 'campus-cats-admin-cfg';
  var API = 'https://api.github.com';
  var REL_TYPES = ['配偶', '父子', '母子', '兄弟姐妹', '朋友'];
  var GENDERS = ['male', 'female'];
  var STATUSES = ['已绝育', '未绝育'];

  var state = { repo: '', branch: 'main', token: '', cats: [], relations: [], catsSha: null, relsSha: null };

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function log(msg, kind) {
    var box = $('log');
    if (!box) return;
    var div = document.createElement('div');
    div.className = kind || 'info';
    div.textContent = msg;
    box.insertBefore(div, box.firstChild);
  }

  // ---------- 配置 ----------
  function readConfig() {
    var repo = $('cfg-repo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
    state.repo = repo;
    state.branch = $('cfg-branch').value.trim() || 'main';
    state.token = $('cfg-token').value.trim();
  }

  function fillConfig() {
    $('cfg-repo').value = state.repo;
    $('cfg-branch').value = state.branch;
    $('cfg-token').value = state.token;
  }

  function loadConfig() {
    try {
      var c = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
      if (c.repo) state.repo = c.repo;
      if (c.branch) state.branch = c.branch;
      if (c.token) state.token = c.token;
    } catch (e) { /* 忽略损坏的本地配置 */ }
    fillConfig();
  }

  function saveConfig() {
    readConfig();
    try {
      localStorage.setItem(CFG_KEY, JSON.stringify({ repo: state.repo, branch: state.branch, token: state.token }));
      log('✅ 设置已保存到本浏览器（localStorage）', 'ok');
    } catch (e) {
      log('⚠️ 保存设置失败：' + e.message, 'err');
    }
  }

  // ---------- GitHub API ----------
  function headers() {
    var h = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (state.token) h['Authorization'] = 'Bearer ' + state.token;
    return h;
  }

  function apiGet(path) {
    return fetch(API + path, { headers: headers() }).then(function (r) {
      if (!r.ok) return r.json().then(function (j) { throw new Error(j.message || ('HTTP ' + r.status)); });
      return r.json();
    });
  }

  function apiPut(path, body) {
    return fetch(API + path, { method: 'PUT', headers: headers(), body: JSON.stringify(body) }).then(function (r) {
      if (!r.ok) return r.json().then(function (j) { throw new Error(j.message || ('HTTP ' + r.status)); });
      return r.json();
    });
  }

  function b64ToUtf8(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function utf8ToB64(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function testConn() {
    readConfig();
    if (!state.repo) { log('❌ 请先填写仓库名（用户名/仓库名）', 'err'); return; }
    apiGet('/repos/' + state.repo).then(function (r) {
      log('✅ 连接成功：' + (r.full_name || state.repo) + ' @ ' + state.branch, 'ok');
    }).catch(function (e) {
      log('❌ 连接失败：' + e.message + '（请检查仓库名 / Token 权限 / 网络）', 'err');
    });
  }

  function loadData() {
    readConfig();
    if (!state.repo) { log('❌ 请先填写仓库名', 'err'); return; }
    var q = '?ref=' + encodeURIComponent(state.branch);
    log('⏳ 正在从 GitHub 拉取数据…', 'info');
    Promise.all([
      apiGet('/repos/' + state.repo + '/contents/data/cats.json' + q),
      apiGet('/repos/' + state.repo + '/contents/data/relations.json' + q)
    ]).then(function (res) {
      state.cats = JSON.parse(b64ToUtf8(res[0].content));
      state.catsSha = res[0].sha || null;
      state.relations = JSON.parse(b64ToUtf8(res[1].content));
      state.relsSha = res[1].sha || null;
      render();
      log('✅ 已拉取：cats.json（' + state.cats.length + ' 只猫）、relations.json（' + state.relations.length + ' 条关系）', 'ok');
    }).catch(function (e) {
      log('❌ 拉取失败：' + e.message, 'err');
    });
  }

  // ---------- 渲染 ----------
  function render() { renderCats(); renderRelations(); updateRaw(); }

  function genderOptions(sel) {
    var s = '';
    GENDERS.forEach(function (g) {
      s += '<option value="' + g + '"' + (g === sel ? ' selected' : '') + '>' + (g === 'male' ? '公' : '母') + '</option>';
    });
    return s;
  }

  function statusOptions(sel) {
    var s = '';
    STATUSES.forEach(function (st) {
      s += '<option value="' + esc(st) + '"' + (st === sel ? ' selected' : '') + '>' + esc(st) + '</option>';
    });
    return s;
  }

  function renderCats() {
    var box = $('cats-editor');
    var html = '';
    state.cats.forEach(function (c, i) {
      html += '<div class="cat-row" data-i="' + i + '">' +
        '<label>ID<input data-f="id" value="' + esc(c.id) + '"></label>' +
        '<label>名字<input data-f="name" value="' + esc(c.name) + '"></label>' +
        '<label>性别<select data-f="gender">' + genderOptions(c.gender) + '</select></label>' +
        '<label>毛色<input data-f="color" value="' + esc(c.color) + '"></label>' +
        '<label>区域<input data-f="area" value="' + esc(c.area) + '"></label>' +
        '<label>纬度<input data-f="lat" type="number" step="0.0001" value="' + esc(c.lat) + '"></label>' +
        '<label>经度<input data-f="lng" type="number" step="0.0001" value="' + esc(c.lng) + '"></label>' +
        '<label>照片路径<input data-f="photo" value="' + esc(c.photo || 'images/placeholder.svg') + '"></label>' +
        '<label>绝育状态<select data-f="status">' + statusOptions(c.status) + '</select></label>' +
        '<label>首次发现<input data-f="firstSeen" placeholder="2025-01" value="' + esc(c.firstSeen || '') + '"></label>' +
        '<label>照料人<input data-f="caretaker" value="' + esc(c.caretaker || '') + '"></label>' +
        '<label class="wide">描述<textarea data-f="description" rows="2">' + esc(c.description || '') + '</textarea></label>' +
        '<button type="button" class="row-del" data-del="' + i + '">删除</button>' +
        '</div>';
    });
    box.innerHTML = html || '<p class="admin-tip">暂无猫咪，点下方「+ 新增猫咪」添加。</p>';

    box.querySelectorAll('[data-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.cats.splice(Number(btn.dataset.del), 1);
        render();
      });
    });
  }

  function renderRelations() {
    var box = $('rels-editor');
    var idOpts = '';
    state.cats.forEach(function (c) { idOpts += '<option value="' + esc(c.id) + '">' + esc(c.id) + ' ' + esc(c.name) + '</option>'; });
    var relOpts = '';
    REL_TYPES.forEach(function (rt) { relOpts += '<option value="' + esc(rt) + '">' + esc(rt) + '</option>'; });

    var html = '';
    state.relations.forEach(function (r, i) {
      html += '<div class="rel-row" data-i="' + i + '">' +
        '<label>从<select data-f="from">' + idOpts.replace('value="' + esc(r.from) + '"', 'value="' + esc(r.from) + '" selected') + '</select></label>' +
        '<label>到<select data-f="to">' + idOpts.replace('value="' + esc(r.to) + '"', 'value="' + esc(r.to) + '" selected') + '</select></label>' +
        '<label>关系<select data-f="relation">' + relOpts.replace('value="' + esc(r.relation) + '"', 'value="' + esc(r.relation) + '" selected') + '</select></label>' +
        '<label class="wide">备注<input data-f="note" value="' + esc(r.note || '') + '"></label>' +
        '<button type="button" class="row-del" data-del="' + i + '">删除</button>' +
        '</div>';
    });
    box.innerHTML = html || '<p class="admin-tip">暂无关系，点下方「+ 新增关系」添加。</p>';

    box.querySelectorAll('[data-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.relations.splice(Number(btn.dataset.del), 1);
        render();
      });
    });
  }

  // ---------- 收集 ----------
  function collectCats() {
    var rows = document.querySelectorAll('#cats-editor .cat-row');
    return Array.prototype.map.call(rows, function (row) {
      var c = {};
      row.querySelectorAll('[data-f]').forEach(function (el) { c[el.dataset.f] = el.value.trim(); });
      c.lat = parseFloat(c.lat);
      c.lng = parseFloat(c.lng);
      if (!c.photo) c.photo = 'images/placeholder.svg';
      return c;
    });
  }

  function collectRelations() {
    var rows = document.querySelectorAll('#rels-editor .rel-row');
    return Array.prototype.map.call(rows, function (row) {
      var r = {};
      row.querySelectorAll('[data-f]').forEach(function (el) { r[el.dataset.f] = el.value.trim(); });
      return r;
    });
  }

  function collectAll() {
    state.cats = collectCats();
    state.relations = collectRelations();
  }

  // ---------- 校验 ----------
  function validateData(cats, relations) {
    var errors = [];
    if (!Array.isArray(cats) || !cats.length) errors.push('cats.json 不能为空');
    var ids = {};
    cats.forEach(function (c, i) {
      var p = 'cats[' + i + '] ';
      ['id', 'name', 'gender', 'color', 'area', 'lat', 'lng', 'description', 'status', 'firstSeen'].forEach(function (f) {
        if (c[f] === undefined || c[f] === null || c[f] === '') errors.push(p + '缺少必填字段：' + f);
      });
      if (c.id) { if (ids[c.id]) errors.push(p + 'id 重复：' + c.id); ids[c.id] = true; }
      if (GENDERS.indexOf(c.gender) < 0) errors.push(p + 'gender 无效：' + c.gender);
      if (STATUSES.indexOf(c.status) < 0) errors.push(p + 'status 无效：' + c.status);
      if (isNaN(c.lat) || c.lat < -90 || c.lat > 90) errors.push(p + '纬度无效：' + c.lat);
      if (isNaN(c.lng) || c.lng < -180 || c.lng > 180) errors.push(p + '经度无效：' + c.lng);
      if (c.firstSeen && !/^\d{4}-\d{2}$/.test(c.firstSeen)) errors.push(p + 'firstSeen 格式应为 YYYY-MM：' + c.firstSeen);
    });
    if (!Array.isArray(relations)) relations = [];
    relations.forEach(function (r, i) {
      var p = 'relations[' + i + '] ';
      ['from', 'to', 'relation'].forEach(function (f) {
        if (!r[f]) errors.push(p + '缺少必填字段：' + f);
      });
      if (r.from && !ids[r.from]) errors.push(p + 'from 引用不存在的猫咪：' + r.from);
      if (r.to && !ids[r.to]) errors.push(p + 'to 引用不存在的猫咪：' + r.to);
      if (r.from && r.to && r.from === r.to) errors.push(p + 'from 与 to 不能相同：' + r.from);
      if (REL_TYPES.indexOf(r.relation) < 0) errors.push(p + 'relation 无效：' + r.relation);
    });
    return { ok: !errors.length, errors: errors };
  }

  function doValidate() {
    collectAll();
    var v = validateData(state.cats, state.relations);
    if (v.ok) { log('✅ 校验通过：' + state.cats.length + ' 只猫、' + state.relations.length + ' 条关系', 'ok'); }
    else { v.errors.forEach(function (e) { log('❌ ' + e, 'err'); }); }
  }

  // ---------- 保存 / 下载 ----------
  function prettyJSON(arr) { return JSON.stringify(arr, null, 2) + '\n'; }

  function saveToGitHub() {
    collectAll();
    var v = validateData(state.cats, state.relations);
    if (!v.ok) {
      v.errors.forEach(function (e) { log('❌ ' + e, 'err'); });
      log('⚠️ 校验未通过，已阻止保存', 'err');
      return;
    }
    if (!state.token) { log('❌ 请先填写 Token', 'err'); return; }

    var m = 'data: 通过网页后台更新猫咪数据';
    var repo = state.repo;
    var branch = state.branch;
    log('⏳ 正在提交到 GitHub：' + repo + '@' + branch + ' …', 'info');

    apiPut('/repos/' + repo + '/contents/data/cats.json', {
      message: m,
      content: utf8ToB64(prettyJSON(state.cats)),
      sha: state.catsSha || undefined,
      branch: branch
    }).then(function (resCats) {
      state.catsSha = resCats.content.sha;
      return apiPut('/repos/' + repo + '/contents/data/relations.json', {
        message: m,
        content: utf8ToB64(prettyJSON(state.relations)),
        sha: state.relsSha || undefined,
        branch: branch
      });
    }).then(function (resRels) {
      state.relsSha = resRels.content.sha;
      log('✅ 已提交成功（commit ' + String(resRels.commit.sha).slice(0, 7) + '）', 'ok');
      log('🚀 自动部署已触发：GitHub Pages / Cloudflare 将在 1~3 分钟内更新（无需其他操作）', 'info');
      log('🔗 可在仓库 Commits 页查看：https://github.com/' + repo + '/commits/' + encodeURIComponent(branch), 'info');
    }).catch(function (e) {
      log('❌ 保存失败：' + e.message, 'err');
    });
  }

  function downloadBackup() {
    collectAll();
    var files = [
      { name: 'cats.json', data: prettyJSON(state.cats) },
      { name: 'relations.json', data: prettyJSON(state.relations) }
    ];
    files.forEach(function (f) {
      var blob = new Blob([f.data], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
    log('📦 已生成 JSON 备份下载', 'ok');
  }

  function updateRaw() {
    var pre = $('raw-pre');
    if (pre) pre.textContent = JSON.stringify({ cats: state.cats, relations: state.relations }, null, 2);
  }

  // ---------- 新增 ----------
  function addCat() {
    var last = state.cats[state.cats.length - 1] || {};
    state.cats.push({
      id: 'cat' + String(state.cats.length + 1).padStart(3, '0'),
      name: '新猫咪',
      gender: 'male',
      color: '',
      area: '',
      lat: last.lat != null ? last.lat : 21.6795,
      lng: last.lng != null ? last.lng : 110.9226,
      photo: 'images/placeholder.svg',
      description: '',
      status: '未绝育',
      firstSeen: '2025-01',
      caretaker: ''
    });
    render();
  }

  function addRelation() {
    state.relations.push({
      from: state.cats[0] ? state.cats[0].id : '',
      to: state.cats[1] ? state.cats[1].id : (state.cats[0] ? state.cats[0].id : ''),
      relation: '朋友',
      note: ''
    });
    render();
  }

  // ---------- 事件 ----------
  function bind() {
    $('btn-save-config').addEventListener('click', saveConfig);
    $('btn-test').addEventListener('click', testConn);
    $('btn-load').addEventListener('click', loadData);
    $('btn-add-cat').addEventListener('click', addCat);
    $('btn-add-rel').addEventListener('click', addRelation);
    $('btn-validate').addEventListener('click', doValidate);
    $('btn-save').addEventListener('click', saveToGitHub);
    $('btn-download').addEventListener('click', downloadBackup);
    $('advanced-toggle').addEventListener('change', function () {
      $('raw-pre').classList.toggle('hidden', !this.checked);
      if (this.checked) updateRaw();
    });
  }

  loadConfig();
  bind();
  log('👋 欢迎使用网页数据后台：填好仓库与 Token → 测试连接 → 拉取数据 → 编辑 → 保存部署', 'info');
})();
