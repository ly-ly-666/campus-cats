// admin.js — 网页端数据管理后台（地图可视化编辑 + GitHub API 保存部署）
(function () {
  'use strict';

  var CFG_KEY = 'campus-cats-admin-cfg';
  var API = 'https://api.github.com';
  var REL_TYPES = ['配偶', '父子', '母子', '兄弟姐妹', '朋友'];
  var GENDERS = ['male', 'female'];
  var STATUSES = ['已绝育', '未绝育'];
  var CAMPUS_CENTER = [21.6795, 110.9226];
  var TILES = [
    { name: '高德', url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', att: '© 高德地图', max: 20, native: 18, subs: ['1', '2', '3', '4'] },
    { name: 'OSM', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', att: '© OpenStreetMap contributors', max: 20, native: 19, subs: null }
  ];

  var state = { repo: '', branch: 'main', token: '', cats: [], relations: [], catsSha: null, relsSha: null };
  var map = null, markerLayer = null, tempMarker = null, tileIdx = 0, tileErrors = 0;
  var editIndex = -1; // -1 = 添加模式

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
    state.repo = $('cfg-repo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
    state.branch = $('cfg-branch').value.trim() || 'main';
    state.token = $('cfg-token').value.trim();
  }
  function fillConfig() {
    $('cfg-repo').value = state.repo; $('cfg-branch').value = state.branch; $('cfg-token').value = state.token;
  }
  function loadConfig() {
    try { var c = JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); if (c.repo) state.repo = c.repo; if (c.branch) state.branch = c.branch; if (c.token) state.token = c.token; } catch (e) {}
    fillConfig();
  }
  function saveConfig() {
    readConfig();
    try { localStorage.setItem(CFG_KEY, JSON.stringify({ repo: state.repo, branch: state.branch, token: state.token })); log('✅ 设置已保存到本浏览器', 'ok'); }
    catch (e) { log('⚠️ 保存设置失败：' + e.message, 'err'); }
  }

  // ---------- GitHub API ----------
  function headers() {
    var h = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (state.token) h['Authorization'] = 'Bearer ' + state.token;
    return h;
  }
  function apiGet(p) {
    return fetch(API + p, { headers: headers() }).then(function (r) {
      if (!r.ok) return r.json().then(function (j) { throw new Error(j.message || ('HTTP ' + r.status)); });
      return r.json();
    });
  }
  function apiPut(p, body) {
    return fetch(API + p, { method: 'PUT', headers: headers(), body: JSON.stringify(body) }).then(function (r) {
      if (!r.ok) return r.json().then(function (j) { throw new Error(j.message || ('HTTP ' + r.status)); });
      return r.json();
    });
  }
  function b64ToUtf8(b64) { var bin = atob(b64); var b = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return new TextDecoder().decode(b); }
  function utf8ToB64(s) { var b = new TextEncoder().encode(s); var bin = ''; for (var i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]); return btoa(bin); }

  function testConn() {
    readConfig();
    if (!state.repo) { log('❌ 请先填写仓库名（用户名/仓库名）', 'err'); return; }
    apiGet('/repos/' + state.repo).then(function (r) { log('✅ 连接成功：' + (r.full_name || state.repo) + ' @ ' + state.branch, 'ok'); })
      .catch(function (e) { log('❌ 连接失败：' + e.message, 'err'); });
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
      state.cats = JSON.parse(b64ToUtf8(res[0].content)); state.catsSha = res[0].sha || null;
      state.relations = JSON.parse(b64ToUtf8(res[1].content)); state.relsSha = res[1].sha || null;
      renderAll();
      log('✅ 已拉取：' + state.cats.length + ' 只猫、' + state.relations.length + ' 条关系。现在可以在地图上点位置添加猫咪了！', 'ok');
    }).catch(function (e) { log('❌ 拉取失败：' + e.message, 'err'); });
  }

  // ---------- 地图 ----------
  function ensureMap() {
    if (map) return;
    if (typeof L === 'undefined') { log('❌ Leaflet 未加载（CDN 不可达）', 'err'); return; }
    map = L.map('admin-map', { zoomControl: true }).setView(CAMPUS_CENTER, 16);
    addTileLayer();
    markerLayer = L.layerGroup().addTo(map);
    map.on('click', function (e) { openForm(-1, e.latlng); });
  }

  function addTileLayer() {
    if (!map) return;
    var t = TILES[tileIdx];
    var opts = { maxZoom: t.max, maxNativeZoom: t.native, attribution: t.att };
    if (t.subs) opts.subdomains = t.subs;
    var layer = L.tileLayer(t.url, opts);
    layer.on('tileerror', function () {
      tileErrors++;
      if (tileErrors >= 6 && tileIdx < TILES.length - 1) {
        tileErrors = 0; tileIdx++;
        map.removeLayer(layer); addTileLayer();
        log('网络原因，地图瓦片已切换为「' + TILES[tileIdx].name + '」', 'info');
      }
    });
    layer.addTo(map);
  }

  function renderMarkers() {
    if (!markerLayer) return;
    markerLayer.clearLayers();
    state.cats.forEach(function (c, i) {
      if (typeof c.lat !== 'number' || typeof c.lng !== 'number') return;
      var color = c.gender === 'male' ? '#3b82f6' : '#ec4899';
      var m = L.circleMarker([c.lat, c.lng], { radius: 12, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 })
        .addTo(markerLayer);
      m.options.catIndex = i;
      m.bindTooltip(c.name, { permanent: false, direction: 'top' });
      m.on('click', function () { openForm(i, m.getLatLng()); });
      m.dragging.enable();
      m.on('dragend', function () {
        var idx = m.options.catIndex;
        var ll = m.getLatLng();
        state.cats[idx].lat = +ll.lat.toFixed(6);
        state.cats[idx].lng = +ll.lng.toFixed(6);
        updateRaw(); renderMiniList();
        if (editIndex === idx && !$('cat-form').classList.contains('hidden')) {
          $('f-lat').value = state.cats[idx].lat; $('f-lng').value = state.cats[idx].lng;
        }
      });
    });
  }

  // ---------- 猫咪表单 ----------
  function openForm(index, latlng) {
    if (!map) { log('❌ 地图未就绪，请刷新后重试', 'err'); return; }
    editIndex = index;
    var isAdd = index < 0;
    var c = isAdd
      ? { id: nextId(), name: '', gender: 'male', color: '', area: '', lat: latlng ? +latlng.lat.toFixed(6) : 21.6795, lng: latlng ? +latlng.lng.toFixed(6) : 110.9226, photo: 'images/placeholder.svg', description: '', status: '已绝育', firstSeen: '' }
      : state.cats[index];

    $('form-title').textContent = isAdd ? '📍 添加猫咪' : '✏️ 编辑猫咪';
    $('f-name').value = c.name || '';
    $('f-gender').value = c.gender || 'male';
    $('f-status').value = c.status || '未绝育';
    $('f-color').value = c.color || '';
    $('f-area').value = c.area || '';
    $('f-desc').value = c.description || '';
    $('f-photo').value = c.photo || 'images/placeholder.svg';
    $('f-lat').value = c.lat; $('f-lng').value = c.lng;
    $('f-del').classList.toggle('hidden', isAdd);
    $('cat-form').classList.remove('hidden');

    if (tempMarker) markerLayer.removeLayer(tempMarker);
    tempMarker = L.marker([c.lat, c.lng], { draggable: true }).addTo(markerLayer);
    tempMarker.on('dragend', function () {
      var ll = tempMarker.getLatLng();
      $('f-lat').value = +ll.lat.toFixed(6); $('f-lng').value = +ll.lng.toFixed(6);
    });
    map.setView([c.lat, c.lng], Math.max(map.getZoom(), 16));
  }

  function closeForm() {
    $('cat-form').classList.add('hidden');
    if (tempMarker) { markerLayer.removeLayer(tempMarker); tempMarker = null; }
    editIndex = -1;
  }

  function saveForm() {
    var name = $('f-name').value.trim();
    if (!name) { log('❌ 请填写猫咪名字', 'err'); return; }
    var lat = parseFloat($('f-lat').value), lng = parseFloat($('f-lng').value);
    if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lng) || lng < -180 || lng > 180) {
      log('❌ 经纬度无效', 'err'); return;
    }
    var isAdd = editIndex < 0;
    var cat = {
      id: isAdd ? nextId() : state.cats[editIndex].id,
      name: name,
      gender: $('f-gender').value,
      color: $('f-color').value.trim(),
      area: $('f-area').value.trim(),
      lat: +lat.toFixed(6),
      lng: +lng.toFixed(6),
      photo: $('f-photo').value.trim() || 'images/placeholder.svg',
      description: $('f-desc').value.trim(),
      status: $('f-status').value,
      firstSeen: isAdd ? currentMonth() : (state.cats[editIndex].firstSeen || currentMonth()),
      caretaker: isAdd ? '' : (state.cats[editIndex].caretaker || '')
    };
    if (isAdd) { state.cats.push(cat); } else { state.cats[editIndex] = cat; }
    closeForm(); renderAll();
    log('✅ 已保存猫咪「' + name + '」到本地（记得点下方 ⑤ 保存到 GitHub 部署）', 'ok');
  }

  function deleteFormCat() {
    if (editIndex < 0) return;
    var name = state.cats[editIndex].name;
    var removedId = state.cats[editIndex].id;
    state.cats.splice(editIndex, 1);
    state.relations = state.relations.filter(function (r) { return r.from !== removedId && r.to !== removedId; });
    closeForm(); renderAll();
    log('🗑️ 已删除猫咪「' + name + '」及其关联关系', 'info');
  }

  function nextId() {
    var n = state.cats.length + 1, id = 'cat' + pad(n, 3);
    while (state.cats.some(function (c) { return c.id === id; })) { n++; id = 'cat' + pad(n, 3); }
    return id;
  }
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function currentMonth() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2); }

  // ---------- 渲染汇总 ----------
  function renderAll() {
    renderCats(); renderRelations(); renderMiniList(); renderMarkers(); updateRaw();
  }

  function renderCats() {
    var box = $('cats-editor'); if (!box) return;
    var html = '';
    state.cats.forEach(function (c, i) {
      html += '<div class="cat-row" data-i="' + i + '">' +
        '<label>ID<input data-f="id" value="' + esc(c.id) + '"></label>' +
        '<label>名字<input data-f="name" value="' + esc(c.name) + '"></label>' +
        '<label>性别<select data-f="gender">' + opt(GENDERS, c.gender, { male: '公', female: '母' }) + '</select></label>' +
        '<label>毛色<input data-f="color" value="' + esc(c.color) + '"></label>' +
        '<label>区域<input data-f="area" value="' + esc(c.area) + '"></label>' +
        '<label>纬度<input data-f="lat" type="number" step="0.0001" value="' + esc(c.lat) + '"></label>' +
        '<label>经度<input data-f="lng" type="number" step="0.0001" value="' + esc(c.lng) + '"></label>' +
        '<label>照片<input data-f="photo" value="' + esc(c.photo || 'images/placeholder.svg') + '"></label>' +
        '<label>状态<select data-f="status">' + opt(STATUSES, c.status) + '</select></label>' +
        '<label>首次发现<input data-f="firstSeen" value="' + esc(c.firstSeen || '') + '"></label>' +
        '<label>照料人<input data-f="caretaker" value="' + esc(c.caretaker || '') + '"></label>' +
        '<label class="wide">描述<textarea data-f="description" rows="2">' + esc(c.description || '') + '</textarea></label>' +
        '<button type="button" class="row-del" data-del="' + i + '">删除</button></div>';
    });
    box.innerHTML = html || '<p class="admin-tip">暂无猫咪。</p>';
    box.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () { state.cats.splice(Number(b.dataset.del), 1); renderAll(); });
    });
  }

  function opt(values, sel, labels) {
    var s = '';
    values.forEach(function (v) { s += '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(labels ? (labels[v] || v) : v) + '</option>'; });
    return s;
  }

  function renderRelations() {
    var box = $('rels-editor'); if (!box) return;
    var idOpts = ''; state.cats.forEach(function (c) { idOpts += '<option value="' + esc(c.id) + '">' + esc(c.id) + ' ' + esc(c.name) + '</option>'; });
    var relOpts = ''; REL_TYPES.forEach(function (rt) { relOpts += '<option value="' + esc(rt) + '">' + esc(rt) + '</option>'; });
    var html = '';
    state.relations.forEach(function (r, i) {
      html += '<div class="rel-row" data-i="' + i + '">' +
        '<label>从<select data-f="from">' + markSel(idOpts, r.from) + '</select></label>' +
        '<label>到<select data-f="to">' + markSel(idOpts, r.to) + '</select></label>' +
        '<label>关系<select data-f="relation">' + markSel(relOpts, r.relation) + '</select></label>' +
        '<label class="wide">备注<input data-f="note" value="' + esc(r.note || '') + '"></label>' +
        '<button type="button" class="row-del" data-del="' + i + '">删除</button></div>';
    });
    box.innerHTML = html || '<p class="admin-tip">暂无关系。</p>';
    box.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () { state.relations.splice(Number(b.dataset.del), 1); renderAll(); });
    });
  }

  function markSel(options, val) {
    if (val == null || val === '') return options;
    return options.replace('value="' + esc(val) + '"', 'value="' + esc(val) + '" selected');
  }

  function addRelation() {
    state.relations.push({ from: state.cats[0] ? state.cats[0].id : '', to: state.cats[1] ? state.cats[1].id : (state.cats[0] ? state.cats[0].id : ''), relation: '朋友', note: '' });
    renderAll();
  }
  function addCat() {
    state.cats.push({ id: nextId(), name: '新猫咪', gender: 'male', color: '', area: '', lat: 21.6795, lng: 110.9226, photo: 'images/placeholder.svg', description: '', status: '未绝育', firstSeen: currentMonth(), caretaker: '' });
    renderAll();
  }

  function renderMiniList() {
    var box = $('mini-list'); if (!box) return;
    var html = '';
    state.cats.forEach(function (c, i) {
      html += '<div class="mini-item"><span class="nm">' + esc(c.name) + '</span><span class="ar">📍 ' + esc(c.area || '') + ' · ' + (c.gender === 'male' ? '公' : '母') + ' · ' + esc(c.status || '') + '</span>' +
        '<button data-edit="' + i + '">编辑</button><button class="del" data-del="' + i + '">删除</button></div>';
    });
    box.innerHTML = html || '<p class="admin-tip">暂无猫咪。</p>';
    box.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = Number(b.dataset.edit);
        ensureMap(); openForm(i, { lat: state.cats[i].lat, lng: state.cats[i].lng });
      });
    });
    box.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () { state.cats.splice(Number(b.dataset.del), 1); renderAll(); });
    });
  }

  function updateRaw() { var pre = $('raw-pre'); if (pre) pre.textContent = JSON.stringify({ cats: state.cats, relations: state.relations }, null, 2); }

  function syncFromEditors() {
    var box = $('cats-editor'); if (!box) return;
    var rows = box.querySelectorAll('.cat-row');
    if (rows.length) {
      var arr = Array.prototype.map.call(rows, function (row) {
        var c = {}; row.querySelectorAll('[data-f]').forEach(function (el) { c[el.dataset.f] = el.value.trim(); });
        c.lat = parseFloat(c.lat); c.lng = parseFloat(c.lng);
        if (!c.photo) c.photo = 'images/placeholder.svg';
        return c;
      });
      state.cats = arr;
    } else {
      // 表格为空但有数据，保留 state
    }
    var rbox = $('rels-editor'); if (!rbox) return;
    var rrows = rbox.querySelectorAll('.rel-row');
    if (rrows.length) {
      var arr2 = Array.prototype.map.call(rrows, function (row) {
        var r = {}; row.querySelectorAll('[data-f]').forEach(function (el) { r[el.dataset.f] = el.value.trim(); });
        return r;
      });
      state.relations = arr2;
    }
  }

  function validateData(cats, relations) {
    var errors = [];
    if (!Array.isArray(cats) || !cats.length) errors.push('cats 不能为空');
    var ids = {};
    cats.forEach(function (c, i) {
      var p = 'cats[' + i + '] ';
      ['id', 'name', 'gender', 'color', 'area', 'lat', 'lng', 'description', 'status', 'firstSeen'].forEach(function (f) {
        if (c[f] === undefined || c[f] === null || c[f] === '') errors.push(p + '缺少必填字段：' + f);
      });
      if (c.id) { if (ids[c.id]) errors.push(p + 'id 重复：' + c.id); ids[c.id] = true; }
      if (GENDERS.indexOf(c.gender) < 0) errors.push(p + 'gender 无效');
      if (STATUSES.indexOf(c.status) < 0) errors.push(p + 'status 无效');
      if (isNaN(c.lat) || c.lat < -90 || c.lat > 90) errors.push(p + '纬度无效');
      if (isNaN(c.lng) || c.lng < -180 || c.lng > 180) errors.push(p + '经度无效');
      if (c.firstSeen && !/^\d{4}-\d{2}$/.test(c.firstSeen)) errors.push(p + 'firstSeen 格式应为 YYYY-MM');
    });
    (relations || []).forEach(function (r, i) {
      var p = 'relations[' + i + '] ';
      ['from', 'to', 'relation'].forEach(function (f) { if (!r[f]) errors.push(p + '缺少必填字段：' + f); });
      if (r.from && !ids[r.from]) errors.push(p + 'from 引用不存在：' + r.from);
      if (r.to && !ids[r.to]) errors.push(p + 'to 引用不存在：' + r.to);
      if (r.from && r.from === r.to) errors.push(p + 'from=to 相同');
      if (REL_TYPES.indexOf(r.relation) < 0) errors.push(p + 'relation 无效');
    });
    return { ok: !errors.length, errors: errors };
  }

  function doValidate() {
    syncFromEditors(); renderAll();
    var v = validateData(state.cats, state.relations);
    if (v.ok) log('✅ 校验通过：' + state.cats.length + ' 只猫、' + state.relations.length + ' 条关系', 'ok');
    else v.errors.forEach(function (e) { log('❌ ' + e, 'err'); });
  }

  function prettyJSON(a) { return JSON.stringify(a, null, 2) + '\n'; }

  function saveToGitHub() {
    syncFromEditors(); renderAll();
    var v = validateData(state.cats, state.relations);
    if (!v.ok) { v.errors.forEach(function (e) { log('❌ ' + e, 'err'); }); log('⚠️ 校验未通过，已阻止保存', 'err'); return; }
    if (!state.token) { log('❌ 请先填写 Token', 'err'); return; }
    var m = 'data: 通过网页后台更新猫咪数据';
    log('⏳ 正在提交到 GitHub…', 'info');
    apiPut('/repos/' + state.repo + '/contents/data/cats.json', { message: m, content: utf8ToB64(prettyJSON(state.cats)), sha: state.catsSha || undefined, branch: state.branch })
      .then(function (rc) {
        state.catsSha = rc.content.sha;
        return apiPut('/repos/' + state.repo + '/contents/data/relations.json', { message: m, content: utf8ToB64(prettyJSON(state.relations)), sha: state.relsSha || undefined, branch: state.branch });
      })
      .then(function (rr) {
        state.relsSha = rr.content.sha;
        log('✅ 已提交成功（commit ' + String(rr.commit.sha).slice(0, 7) + '），GitHub Pages / Cloudflare 将自动更新', 'ok');
        log('🔗 https://github.com/' + state.repo + '/commits/' + encodeURIComponent(state.branch), 'info');
      })
      .catch(function (e) { log('❌ 保存失败：' + e.message, 'err'); });
  }

  function downloadBackup() {
    syncFromEditors(); renderAll();
    var files = [{ name: 'cats.json', data: prettyJSON(state.cats) }, { name: 'relations.json', data: prettyJSON(state.relations) }];
    files.forEach(function (f) {
      var blob = new Blob([f.data], { type: 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = f.name;
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
    log('📦 已生成 JSON 备份下载', 'ok');
  }

  // ---------- 事件 ----------
  function bind() {
    $('btn-save-config').addEventListener('click', saveConfig);
    $('btn-test').addEventListener('click', testConn);
    $('btn-load').addEventListener('click', function () { ensureMap(); loadData(); });
    $('btn-add-cat').addEventListener('click', addCat);
    $('btn-add-rel').addEventListener('click', addRelation);
    $('btn-validate').addEventListener('click', doValidate);
    $('btn-save').addEventListener('click', saveToGitHub);
    $('btn-download').addEventListener('click', downloadBackup);
    $('f-save').addEventListener('click', saveForm);
    $('f-cancel').addEventListener('click', closeForm);
    $('f-del').addEventListener('click', deleteFormCat);
    $('advanced-toggle').addEventListener('change', function () {
      $('advanced-box').classList.toggle('hidden', !this.checked);
      $('raw-pre').classList.toggle('hidden', !this.checked);
      if (this.checked) updateRaw();
    });
  }

  loadConfig();
  bind();
  log('👋 欢迎：填好仓库与 Token → 从 GitHub 拉取数据 → 在地图上点位置添加猫咪 → 保存到 GitHub 自动部署', 'info');
})();
