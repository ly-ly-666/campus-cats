// admin.js — 卡片式数据管理后台（地图添加、照片上传、关系编辑、GitHub 保存部署）
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
  var editIndex = -1;          // 当前编辑的猫咪索引；-1 = 添加
  var pendingLatLng = null;    // 添加/编辑时选中的地图位置
  var pendingImage = null;     // 待上传的照片 dataURL
  var pendingImageName = '';   // 待上传照片文件名

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function log(msg, kind) {
    var box = $('log'); if (!box) return;
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
  function fillConfig() { $('cfg-repo').value = state.repo; $('cfg-branch').value = state.branch; $('cfg-token').value = state.token; }
  function loadConfig() {
    try {
      var c = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
      if (c.repo) state.repo = c.repo; if (c.branch) state.branch = c.branch; if (c.token) state.token = c.token;
    } catch (e) {}
    fillConfig();
  }
  function saveConfig() {
    readConfig();
    try { localStorage.setItem(CFG_KEY, JSON.stringify({ repo: state.repo, branch: state.branch, token: state.token })); log('✅ 设置已保存到本浏览器（Token 只存本地）', 'ok'); }
    catch (e) { log('⚠️ 保存设置失败：' + e.message, 'err'); }
    refreshSaveHint();
  }
  function hasConfig() { return !!(state.repo && state.token); }

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
    if (!state.repo) { log('❌ 请先填仓库名', 'err'); return; }
    apiGet('/repos/' + state.repo).then(function (r) { log('✅ 连接成功：' + (r.full_name || state.repo) + ' @ ' + state.branch, 'ok'); refreshSaveHint(); })
      .catch(function (e) { log('❌ 连接失败：' + e.message + '（若为 404 请检查仓库名 / Token 权限）', 'err'); });
  }

  function loadData() {
    readConfig();
    if (!state.repo) { log('❌ 请先填仓库名（如 ly-ly-666/campus-cats）', 'err'); return; }
    var q = '?ref=' + encodeURIComponent(state.branch);
    log('⏳ 正在从 GitHub 拉取数据…', 'info');
    Promise.all([
      apiGet('/repos/' + state.repo + '/contents/data/cats.json' + q),
      apiGet('/repos/' + state.repo + '/contents/data/relations.json' + q)
    ]).then(function (res) {
      state.cats = JSON.parse(b64ToUtf8(res[0].content)); state.catsSha = res[0].sha || null;
      state.relations = JSON.parse(b64ToUtf8(res[1].content)); state.relsSha = res[1].sha || null;
      ensureMap(); renderAll();
      log('✅ 已拉取：' + state.cats.length + ' 只猫、' + state.relations.length + ' 条关系。现在可以点地图或添加猫咪了！', 'ok');
      refreshSaveHint();
    }).catch(function (e) { log('❌ 拉取失败：' + e.message, 'err'); });
  }

  // ---------- 地图 ----------
  function ensureMap() {
    if (map) return;
    if (typeof L === 'undefined') { log('❌ Leaflet 未加载（CDN 不可达）', 'err'); return; }
    map = L.map('admin-map', { zoomControl: true }).setView(CAMPUS_CENTER, 16);
    addTileLayer();
    markerLayer = L.layerGroup().addTo(map);
    map.on('click', function (e) {
      pendingLatLng = { lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) };
      moveTempMarker(pendingLatLng);
      // 若正在编辑/添加猫咪，则更新弹窗位置
      if (!$('cat-modal').classList.contains('open')) {
        openCatModal(-1);
      } else {
        $('loc-line').textContent = '📍 位置已选：' + pendingLatLng.lat + ', ' + pendingLatLng.lng + '（可再点别处调整）';
      }
    });
  }

  function addTileLayer() {
    if (!map) return;
    var t = TILES[tileIdx];
    var opts = { maxZoom: t.max, maxNativeZoom: t.native, attribution: t.att };
    if (t.subs) opts.subdomains = t.subs;
    var layer = L.tileLayer(t.url, opts);
    layer.on('tileerror', function () {
      tileErrors++;
      if (tileErrors >= 6 && tileIdx < TILES.length - 1) { tileErrors = 0; tileIdx++; map.removeLayer(layer); addTileLayer(); log('网络原因，地图已切换为「' + TILES[tileIdx].name + '」', 'info'); }
    });
    layer.addTo(map);
  }

  function renderMarkers() {
    if (!markerLayer) return;
    markerLayer.clearLayers();
    state.cats.forEach(function (c, i) {
      if (typeof c.lat !== 'number' || typeof c.lng !== 'number') return;
      var color = c.leftAt ? '#9ca3af' : (c.gender === 'male' ? '#3b82f6' : '#ec4899');
      var m = L.circleMarker([c.lat, c.lng], { radius: 12, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).addTo(markerLayer);
      m.options.catIndex = i;
      m.bindTooltip(c.name + (c.leftAt ? '（过往）' : ''), { direction: 'top' });
      m.on('click', function () { openCatModal(i); });
      m.dragging.enable();
      m.on('dragend', function () {
        var idx = m.options.catIndex; var ll = m.getLatLng();
        state.cats[idx].lat = +ll.lat.toFixed(6); state.cats[idx].lng = +ll.lng.toFixed(6);
        updateRaw(); renderCats();
      });
    });
  }

  function moveTempMarker(latlng) {
    if (!markerLayer || !map) return;
    if (tempMarker) markerLayer.removeLayer(tempMarker);
    tempMarker = L.marker([latlng.lat, latlng.lng], { draggable: true }).addTo(markerLayer);
    tempMarker.on('dragend', function () { var ll = tempMarker.getLatLng(); pendingLatLng = { lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6) }; updateLocLine(); });
    if (map.getZoom() < 16) map.setView([latlng.lat, latlng.lng], 16);
  }
  function updateLocLine() {
    if (pendingLatLng) $('loc-line').textContent = '📍 位置：' + pendingLatLng.lat + ', ' + pendingLatLng.lng + '（可点地图或拖动圆点调整）';
  }

  // ---------- 猫咪弹窗 ----------
  function openCatModal(index) {
    editIndex = index;
    var isAdd = index < 0;
    var c = isAdd ? null : state.cats[index];
    // 选择位置：编辑用猫的位置，添加用 pendingLatLng（或默认校园中心）
    var ll = c ? { lat: c.lat, lng: c.lng } : (pendingLatLng || { lat: CAMPUS_CENTER[0], lng: CAMPUS_CENTER[1] });
    pendingLatLng = ll;
    pendingImage = null; pendingImageName = '';
    $('cat-modal-title').textContent = isAdd ? '📝 添加猫咪' : '✏️ 编辑猫咪';
    $('f-name').value = c ? (c.name || '') : '';
    $('f-nickname').value = c ? (c.nickname || '') : '';
    $('f-gender').value = c ? (c.gender || 'male') : 'male';
    $('f-color').value = c ? (c.color || '') : '';
    $('f-area').value = c ? (c.area || '') : '';
    $('f-status').value = c ? (c.status || '未绝育') : '未绝育';
    $('f-firstSeen').value = c ? (c.firstSeen || '') : '';
    $('f-leftAt').value = c ? (c.leftAt || '') : '';
    $('f-caretaker').value = c ? (c.caretaker || '') : '';
    $('f-desc').value = c ? (c.description || '') : '';
    $('f-photo').value = c ? (c.photo || '') : '';
    // 预览当前照片
    if (c && c.photo) {
      $('f-preview').src = c.photo; $('f-preview').classList.add('show');
    } else {
      $('f-preview').classList.remove('show');
    }
    $('f-del').style.display = isAdd ? 'none' : '';
    updateLocLine();
    moveTempMarker(ll);
    openModal('cat-modal');
  }

  // 照片文件选择 → 打开裁剪弹窗
  function onFileChange() {
    var f = $('f-file').files && $('f-file').files[0];
    if (!f) return;
    startCrop(f);
  }
  function onCameraChange() {
    var f = $('f-camera').files && $('f-camera').files[0];
    if (!f) return;
    startCrop(f);
  }
  function startCrop(file) {
    pendingImageName = file.name;
    var reader = new FileReader();
    reader.onload = function (ev) { openCropModal(ev.target.result); };
    reader.readAsDataURL(file);
  }
  function openCropModal(dataUrl) {
    var box = $('crop-box');
    box.innerHTML = '';
    var img = document.createElement('img');
    img.id = 'crop-img';
    img.style.maxWidth = '100%';
    img.style.maxHeight = '280px';
    img.style.width = 'auto';
    img.style.height = 'auto';
    img.style.display = 'block';
    img.style.margin = '0 auto';
    img.src = dataUrl;
    box.appendChild(img);
    openModal('crop-modal');
    setTimeout(function () {
      if (typeof Cropper !== 'undefined') {
        if (cropInstance) cropInstance.destroy();
        cropInstance = new Cropper(img, { aspectRatio: 1, viewMode: 1, autoCropArea: 0.9 });
      } else {
        var hint = document.createElement('p');
        hint.style.cssText = 'font-size:13px;color:#b45309;background:#fef3c7;border-radius:8px;padding:8px;margin:8px 0;';
        hint.textContent = '⚠️ 裁剪组件未能加载，将直接使用原图（可稍后刷新重试裁剪）';
        box.parentNode.insertBefore(hint, box.nextSibling);
      }
    }, 100);
  }
  function confirmCrop() {
    if (cropInstance) {
      var canvas = cropInstance.getCroppedCanvas({ width: 480, height: 480 });
      pendingImage = canvas.toDataURL('image/jpeg', 0.85);
      $('f-preview').src = pendingImage; $('f-preview').classList.add('show');
      log('✂️ 已裁剪照片，点「保存」时自动上传到 images/ 并显示', 'ok');
      cropInstance.destroy(); cropInstance = null;
    } else {
      // 组件未加载：直接使用原图
      var img0 = $('crop-img');
      if (img0 && img0.src) {
        pendingImage = img0.src;
        $('f-preview').src = pendingImage; $('f-preview').classList.add('show');
        log('📷 已选择照片（原图，未裁剪）', 'ok');
      } else {
        pendingImage = null;
        log('⚠️ 照片未选择，请重试', 'err');
      }
    }
    closeModal('crop-modal');
  }
  function cancelCrop() {
    if (cropInstance) { cropInstance.destroy(); cropInstance = null; }
    closeModal('crop-modal');
    pendingImage = null;
  }

  async function saveCat() {
    var name = $('f-name').value.trim();
    if (!name) { log('❌ 请填猫咪名字', 'err'); return; }
    var isAdd = editIndex < 0;
    var id = isAdd ? nextId() : state.cats[editIndex].id;
    var lat = pendingLatLng ? pendingLatLng.lat : 21.6795;
    var lng = pendingLatLng ? pendingLatLng.lng : 110.9226;
    var photo = $('f-photo').value.trim() || 'images/placeholder.svg';

    // 先上传裁剪好的照片（有则），拿到最终路径，保证保存后立即可见
    if (pendingImage) {
      if (state.token) {
        var uploaded = await uploadPhoto(id, pendingImage, pendingImageName);
        if (uploaded) photo = uploaded;
      } else {
        log('⚠️ 未配置 Token：照片未上传。先保存猫咪，配好 Token 后再编辑补传', 'err');
      }
    }
    pendingImage = null;

    var cat = {
      id: id, name: name,
      nickname: $('f-nickname').value.trim() || '',
      gender: $('f-gender').value,
      color: $('f-color').value.trim(),
      area: $('f-area').value.trim(),
      lat: +lat.toFixed(6), lng: +lng.toFixed(6),
      photo: photo,
      description: $('f-desc').value.trim(),
      status: $('f-status').value,
      firstSeen: $('f-firstSeen').value.trim() || currentMonth(),
      leftAt: $('f-leftAt').value.trim() || '',
      caretaker: $('f-caretaker').value.trim()
    };
    if (isAdd) state.cats.push(cat); else state.cats[editIndex] = cat;

    closeModal('cat-modal');
    renderAll();
    log('✅ 已保存猫咪「' + name + '」' + (photo.indexOf('images/') === 0 ? '（照片：' + photo + '）' : '') + '，别忘了点 ⑤ 保存到 GitHub', 'ok');
  }

  function uploadPhoto(id, dataUrl, fileName) {
    var ext = (fileName.split('.').pop() || 'jpg').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'jpg';
    var path = 'images/' + id + '.' + ext;
    var base64 = dataUrl.split(',')[1];
    log('⏳ 正在上传照片 → ' + path + ' …', 'info');
    return apiPut('/repos/' + state.repo + '/contents/' + path, { message: 'data: 上传照片 ' + fileName, content: base64, branch: state.branch })
      .then(function () { log('✅ 照片已上传：' + path, 'ok'); return path; })
      .catch(function (e) { log('❌ 照片上传失败：' + e.message + '（检查 Token 是否有 Contents 写权限）', 'err'); return null; });
  }

  function deleteCat() {
    if (editIndex < 0) return;
    var removedId = state.cats[editIndex].id;
    var name = state.cats[editIndex].name;
    state.cats.splice(editIndex, 1);
    state.relations = state.relations.filter(function (r) { return r.from !== removedId && r.to !== removedId; });
    closeModal('cat-modal'); renderAll();
    log('🗑️ 已删除猫咪「' + name + '」及其关联关系', 'info');
  }

  function nextId() { var n = state.cats.length + 1, id = 'cat' + pad(n, 3); while (state.cats.some(function (c) { return c.id === id; })) { n++; id = 'cat' + pad(n, 3); } return id; }
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }

  // ---------- 渲染 ----------
  function renderAll() { renderCats(); renderRels(); renderMarkers(); updateRaw(); refreshSaveHint(); }

  function renderCats() {
    var box = $('cats-list'); if (!box) return;
    var html = '';
    state.cats.forEach(function (c, i) {
      var photo = c.photo || 'images/placeholder.svg';
      var past = c.leftAt ? '<span class="tag tag-past">过往</span>' : '';
      html += '<div class="catcard">' +
        '<div class="th"><img src="' + esc(photo) + '" alt="" onerror="this.style.display=\'none\'"><span style="font-size:40px;">🐱</span></div>' +
        '<div class="bd">' +
        '<div class="nm">' + esc(c.name) + (c.nickname ? '<span class="nick">（' + esc(c.nickname) + '）</span>' : '') + '</div>' +
        '<div class="meta">' + past + ' ' + (c.gender === 'male' ? '公' : '母') + ' · ' + esc(c.status || '') + '</div>' +
        '<div class="meta">📍 ' + esc(c.area || '') + (c.firstSeen ? ' · 出现于 ' + esc(c.firstSeen) : '') + (c.leftAt ? ' · 离开 ' + esc(c.leftAt) : '') + '</div>' +
        '<div class="ops">' +
        '<button class="btn btn-sm" data-edit="' + i + '">编辑</button>' +
        '<button class="btn btn-sm btn-danger" data-del="' + i + '">删除</button>' +
        '</div></div></div>';
    });
    box.innerHTML = html || '<p class="hint">还没有猫咪，点地图或「＋ 添加猫咪」。</p>';
    box.querySelectorAll('[data-edit]').forEach(function (b) { b.addEventListener('click', function () { ensureMap(); openCatModal(Number(b.dataset.edit)); }); });
    box.querySelectorAll('[data-del]').forEach(function (b) { b.addEventListener('click', function () { state.cats.splice(Number(b.dataset.del), 1); renderAll(); }); });
  }

  function renderRels() {
    var box = $('rels-list'); if (!box) return;
    var byId = {}; state.cats.forEach(function (c) { byId[c.id] = c; });
    var html = '';
    state.relations.forEach(function (r, i) {
      var a = byId[r.from] ? byId[r.from].name : r.from;
      var b = byId[r.to] ? byId[r.to].name : r.to;
      html += '<div class="relcard"><span>' + esc(a) + '</span><span class="t">『' + esc(r.relation) + '』</span><span>' + esc(b) + '</span>' +
        (r.note ? '<span class="note">（' + esc(r.note) + '）</span>' : '<span class="note"></span>') +
        '<button class="btn btn-sm btn-danger" data-del="' + i + '">删除</button></div>';
    });
    box.innerHTML = html || '<p class="hint">还没有关系。不是每只猫都有亲戚，需要时点「＋ 添加关系」。</p>';
    box.querySelectorAll('[data-del]').forEach(function (b) { b.addEventListener('click', function () { state.relations.splice(Number(b.dataset.del), 1); renderAll(); }); });
  }

  // ---------- 关系弹窗 ----------
  function openRelModal() {
    if (!state.cats.length) { log('❌ 请先添加猫咪，再添加关系', 'err'); return; }
    var opts = '';
    state.cats.forEach(function (c) { opts += '<option value="' + esc(c.id) + '">' + esc(c.name) + (c.nickname ? '（' + esc(c.nickname) + '）' : '') + '</option>'; });
    $('r-from').innerHTML = opts;
    $('r-to').innerHTML = opts;
    if (state.cats.length > 1) $('r-to').value = state.cats[1].id;
    $('r-note').value = '';
    openModal('rel-modal');
  }
  function saveRel() {
    var from = $('r-from').value, to = $('r-to').value, type = $('r-type').value, note = $('r-note').value.trim();
    if (from === to) { log('❌ 两只猫不能相同', 'err'); return; }
    state.relations.push({ from: from, to: to, relation: type, note: note });
    closeModal('rel-modal'); renderAll();
    log('✅ 已添加关系（记得点 ⑤ 保存到 GitHub）', 'ok');
  }

  // ---------- 弹窗通用 ----------
  function openModal(id) { $(id).classList.add('open'); }
  function closeModal(id) { $(id).classList.remove('open'); }

  // ---------- 校验 / 保存 ----------
  function validateData(cats, relations) {
    var errors = [];
    if (!Array.isArray(cats) || !cats.length) errors.push('cats 不能为空（先添加至少一只猫）');
    var ids = {};
    cats.forEach(function (c, i) {
      var p = 'cats[' + i + '] ';
      ['id', 'name', 'gender', 'lat', 'lng', 'status'].forEach(function (f) {
        if (c[f] === undefined || c[f] === null || c[f] === '') errors.push(p + '缺必填：' + f);
      });
      if (c.id) { if (ids[c.id]) errors.push(p + 'id 重复：' + c.id); ids[c.id] = true; }
      if (GENDERS.indexOf(c.gender) < 0) errors.push(p + 'gender 无效');
      if (STATUSES.indexOf(c.status) < 0) errors.push(p + 'status 无效');
      if (isNaN(c.lat) || c.lat < -90 || c.lat > 90) errors.push(p + '纬度无效');
      if (isNaN(c.lng) || c.lng < -180 || c.lng > 180) errors.push(p + '经度无效');
      if (c.firstSeen && !/^\d{4}(-\d{2})?$/.test(c.firstSeen)) errors.push(p + 'firstSeen 格式：YYYY 或 YYYY-MM');
      if (c.leftAt && !/^\d{4}-\d{2}$/.test(c.leftAt)) errors.push(p + 'leftAt 应为 YYYY-MM');
    });
    (relations || []).forEach(function (r, i) {
      var p = 'relations[' + i + '] ';
      ['from', 'to', 'relation'].forEach(function (f) { if (!r[f]) errors.push(p + '缺必填：' + f); });
      if (r.from && !ids[r.from]) errors.push(p + 'from 引用不存在：' + r.from);
      if (r.to && !ids[r.to]) errors.push(p + 'to 引用不存在：' + r.to);
      if (r.from && r.from === r.to) errors.push(p + 'from=to 相同');
      if (REL_TYPES.indexOf(r.relation) < 0) errors.push(p + 'relation 无效');
    });
    return { ok: !errors.length, errors: errors };
  }

  function refreshSaveHint() {
    var el = $('save-warn'); if (!el) return;
    if (!state.repo || !state.token) { el.textContent = '⚠️ 还没设置 Token 或仓库：请先完成 ①（填仓库/分支/Token → 保存设置 → 拉取数据）。'; el.style.display = ''; }
    else if (!state.cats.length) { el.textContent = 'ℹ️ 还没数据：点 ① 的「拉取数据」（不需要 Token 也能拉），或直接在地图上添加猫咪。'; el.style.display = ''; }
    else { el.style.display = 'none'; }
  }

  function doValidate() {
    var v = validateData(state.cats, state.relations);
    if (v.ok) log('✅ 校验通过：' + state.cats.length + ' 只猫、' + state.relations.length + ' 条关系', 'ok');
    else v.errors.forEach(function (e) { log('❌ ' + e, 'err'); });
  }

  function prettyJSON(a) { return JSON.stringify(a, null, 2) + '\n'; }

  function saveToGitHub() {
    var v = validateData(state.cats, state.relations);
    if (!v.ok) { v.errors.forEach(function (e) { log('❌ ' + e, 'err'); }); log('⚠️ 校验未通过，已阻止保存', 'err'); return; }
    if (!state.repo) { log('❌ 请先填仓库名', 'err'); return; }
    if (!state.token) { log('❌ 请先填 Token（见 ① 的 3 步教程）', 'err'); return; }
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
    var files = [{ name: 'cats.json', data: prettyJSON(state.cats) }, { name: 'relations.json', data: prettyJSON(state.relations) }];
    files.forEach(function (f) {
      var blob = new Blob([f.data], { type: 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = f.name;
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
    log('📦 已生成 JSON 备份下载', 'ok');
  }
  function toggleRaw() {
    var pre = $('raw-pre'); pre.textContent = JSON.stringify({ cats: state.cats, relations: state.relations }, null, 2);
    pre.classList.toggle('hidden');
  }

  // ---------- 事件 ----------
  function bind() {
    $('btn-save-config').addEventListener('click', saveConfig);
    $('btn-test').addEventListener('click', testConn);
    $('btn-load').addEventListener('click', function () { ensureMap(); loadData(); });
    $('btn-add-cat').addEventListener('click', function () { ensureMap(); openCatModal(-1); });
    $('btn-add-rel').addEventListener('click', openRelModal);
    $('btn-validate').addEventListener('click', doValidate);
    $('btn-save').addEventListener('click', saveToGitHub);
    $('btn-download').addEventListener('click', downloadBackup);
    $('btn-raw').addEventListener('click', toggleRaw);
    $('f-save').addEventListener('click', saveCat);
    $('f-del').addEventListener('click', deleteCat);
    $('f-cancel').addEventListener('click', function () { closeModal('cat-modal'); });
    $('cat-close').addEventListener('click', function () { closeModal('cat-modal'); });
    $('f-file').addEventListener('change', onFileChange);
    $('f-camera').addEventListener('change', onCameraChange);
    $('btn-pick-photo').addEventListener('click', function () { $('f-file').click(); });
    $('btn-camera').addEventListener('click', function () { $('f-camera').click(); });
    $('crop-ok').addEventListener('click', confirmCrop);
    $('crop-cancel').addEventListener('click', cancelCrop);
    $('crop-close').addEventListener('click', cancelCrop);
    $('r-save').addEventListener('click', saveRel);
    $('r-cancel').addEventListener('click', function () { closeModal('rel-modal'); });
    $('rel-close').addEventListener('click', function () { closeModal('rel-modal'); });
    // 点遮罩关闭
    $('cat-modal').addEventListener('click', function (e) { if (e.target === $('cat-modal')) closeModal('cat-modal'); });
    $('rel-modal').addEventListener('click', function (e) { if (e.target === $('rel-modal')) closeModal('rel-modal'); });
  }

  loadConfig();
  bind();
  refreshSaveHint();
  log('👋 使用步骤：① 填仓库/Token并拉取数据 → ② 点地图加猫咪 → ③ 编辑信息/上传照片 → ④ 加关系 → ⑤ 保存到 GitHub 自动部署', 'info');
})();