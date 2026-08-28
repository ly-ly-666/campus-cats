// local-admin.js — 本地文件管理端（浏览器直接读写本地项目文件夹）
(function () {
  'use strict';

  var CATS_PATH = 'data/cats.json';
  var RELS_PATH = 'data/relations.json';
  var SITE_CFG_PATH = 'data/site-config.json';
  var IMAGES_DIR = 'images';

  var dirHandle = null;
  var cats = [];
  var relations = [];
  var siteConfig = {};
  var editIdx = -1;
  var pendingAvatar = null;
  var pendingAvatarName = '';
  var cropInstance = null;
  var map = null, markerLayer = null, tempMarker = null;
  var CAMPUS_CENTER = [21.6795, 110.9226];
  var pendingLatLng = null;
  var TILES = [
    { name: '高德', url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', att: '© 高德地图', max: 20, native: 18, subs: ['1', '2', '3', '4'] },
    { name: 'OSM', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', att: '© OpenStreetMap', max: 20, native: 19, subs: null }
  ];
  var tileIdx = 0, tileErrors = 0;

  function $(id) { return document.getElementById(id); }

  // ---------- 配置（仓库/分支/Token）记忆 ----------
  var CFG_KEY = 'campus-cats-local-cfg';
  function saveCfg() {
    try {
      localStorage.setItem(CFG_KEY, JSON.stringify({
        repo: $('cfg-repo').value.trim(),
        branch: $('cfg-branch').value.trim() || 'main',
        token: $('cfg-token').value.trim()
      }));
    } catch (e) {}
  }
  function loadCfg() {
    try {
      var c = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
      if (c.repo) $('cfg-repo').value = c.repo;
      if (c.branch) $('cfg-branch').value = c.branch;
      if (c.token) $('cfg-token').value = c.token;
    } catch (e) {}
  }
  

  // ---------- IndexedDB 持久化目录句柄 ----------
  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('campus-cats-db', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('handles'); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function saveDirHandle(handle) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(handle, 'projectDir');
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function loadDirHandle() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('handles', 'readonly');
        var req = tx.objectStore('handles').get('projectDir');
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    }).catch(function () { return null; });
  }
  async function autoConnect() {
    var handle = await loadDirHandle();
    if (!handle) {
      log('👋 请先点「📁 选择项目文件夹」授权一次，之后会自动记忆', 'info');
      return;
    }
    try {
      var perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        dirHandle = handle;
        $('folder-path').textContent = handle.name + '（✅ 已自动关联）';
        $('btn-pick').textContent = '📁 更换文件夹';
        log('✅ 已自动关联文件夹：' + handle.name, 'ok');
        await loadProject();
        ensureMap();
        renderMarkers();
      } else {
        log('ℹ️ 检测到上次文件夹「' + (handle.name || '') + '」，点下方「📁 一键重新连接」可自动恢复', 'info');
        $('btn-pick').textContent = '📁 一键重新连接「' + (handle.name || '') + '」';
        $('btn-pick').onclick = async function () {
          try {
            var p2 = await handle.requestPermission({ mode: 'readwrite' });
            if (p2 === 'granted') {
              dirHandle = handle;
              $('folder-path').textContent = handle.name + '（✅ 已关联）';
              $('btn-pick').textContent = '📁 更换文件夹';
              $('btn-pick').onclick = pickFolder;
              log('✅ 已恢复文件夹：' + handle.name, 'ok');
              await loadProject();
              ensureMap();
              renderMarkers();
            }
          } catch (e) { log('❌ 恢复失败：' + e.message, 'err'); }
        };
      }
    } catch (e) {
      log('⚠️ 自动关联失败：' + e.message, 'err');
    }
  }

  // ---------- 地图 ----------
  function ensureMap() {
    if (map) return;
    if (typeof L === 'undefined') { log('❌ Leaflet 未加载（vendor/leaflet.min.js 缺失？）', 'err'); return; }
    // 默认 marker 图标不需要（用 circleMarker 和 divIcon）
    map = L.map('admin-map', { zoomControl: true }).setView(CAMPUS_CENTER, 16);
    addTileLayer();
    markerLayer = L.layerGroup().addTo(map);
    map.on('click', function (e) {
      pendingLatLng = { lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) };
      moveTempMarker(pendingLatLng);
      if (!$('cat-modal').classList.contains('open')) {
        openCatModal(-1);
      }
      if ($('f-lat') && pendingLatLng) $('f-lat').value = pendingLatLng.lat;
      if ($('f-lng') && pendingLatLng) $('f-lng').value = pendingLatLng.lng;
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
  function moveTempMarker(latlng) {
    if (!markerLayer || !map) return;
    if (tempMarker) markerLayer.removeLayer(tempMarker);
    var tempIcon = L.divIcon({ className: '', html: '<div style="width:20px;height:20px;border-radius:50%;background:#f59e0b;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);"></div>', iconSize: [20, 20], iconAnchor: [10, 10] });
    tempMarker = L.marker([latlng.lat, latlng.lng], { icon: tempIcon, draggable: true }).addTo(markerLayer);
    tempMarker.on('dragend', function () {
      var ll = tempMarker.getLatLng();
      pendingLatLng = { lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6) };
      if ($('f-lat')) $('f-lat').value = pendingLatLng.lat;
      if ($('f-lng')) $('f-lng').value = pendingLatLng.lng;
    });
    if (map.getZoom() < 16) map.setView([latlng.lat, latlng.lng], 16);
  }
  function renderMarkers() {
    if (!map || !markerLayer) return;
    markerLayer.clearLayers();
    cats.forEach(function (c, i) {
      if (typeof c.lat !== 'number' || typeof c.lng !== 'number') return;
      var isMissing = c.life === '失踪';
      var isMissingOld = c.life === '失踪已久';
      var isAdopted = c.life === '已领养';
      var ring = isMissing ? 'box-shadow:0 0 0 3px #fff,0 0 0 5px #dc2626,0 0 0 8px rgba(220,38,38,.3);animation:cat-missing-pulse 1.5s infinite;' : (isMissingOld ? 'box-shadow:0 0 0 3px #fff,0 0 0 5px #9f1239;' : (isAdopted ? 'box-shadow:0 0 0 3px #fff,0 0 0 5px #10b981;' : 'box-shadow:0 0 0 3px #fff,0 0 0 4px #e5e0d8;'));
      var size = 44;
      var photo = (c.photo && c.photo.indexOf('placeholder') < 0) ? c.photo : '';
      var imgHtml = photo
        ? '<img src="' + photo + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;" onerror="this.style.opacity=0">'
        : '<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:24px;">🐱</span>';
      var icon = L.divIcon({
        className: '',
        html: '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;overflow:hidden;position:relative;background:#ffd9a8;' + ring + '">' + imgHtml + '</div>',
        iconSize: [size, size],
        iconAnchor: [size/2, size/2]
      });
      var m = L.marker([c.lat, c.lng], { icon: icon, draggable: true }).addTo(markerLayer);
      m.options.catIndex = i;
      m.bindTooltip(c.name + (c.leftAt ? '（过往）' : ''), { direction: 'top' });
      m.on('click', function () { openCatModal(i); });
      m.on('dragend', function () {
        var idx = m.options.catIndex; var ll = m.getLatLng();
        cats[idx].lat = +ll.lat.toFixed(6); cats[idx].lng = +ll.lng.toFixed(6);
        renderMarkers();
      });
    });
  }
  function log(msg, kind) {
    var box = $('log'); if (!box) return;
    var div = document.createElement('div');
    div.className = kind || 'info';
    div.textContent = msg;
    box.insertBefore(div, box.firstChild);
  }

  // ---------- 文件系统 ----------
  async function pickFolder() {
    try {
      dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      $('folder-path').textContent = dirHandle.name;
      log('✅ 已选择文件夹：' + dirHandle.name, 'ok');
      await saveDirHandle(dirHandle);
      $('btn-pick').textContent = '📁 更换文件夹';
      await loadProject();
      ensureMap();
      renderMarkers();
    } catch (e) {
      if (e.name !== 'AbortError') log('❌ 选择文件夹失败：' + e.message, 'err');
    }
  }

  async function getDir(parts) {
    var cur = dirHandle;
    for (var i = 0; i < parts.length; i++) {
      cur = await cur.getDirectoryHandle(parts[i], { create: true });
    }
    return cur;
  }

  async function readTextFile(path) {
    var parts = path.split('/');
    var name = parts.pop();
    var d = await getDir(parts);
    var fh = await d.getFileHandle(name);
    var file = await fh.getFile();
    return await file.text();
  }

  async function writeTextFile(path, text) {
    var parts = path.split('/');
    var name = parts.pop();
    var d = await getDir(parts);
    var fh = await d.getFileHandle(name, { create: true });
    var w = await fh.createWritable();
    await w.write(text);
    await w.close();
  }

  // 图片压缩：最长边超过 1600px 缩到 1600，统一转 JPEG(0.85)，透明背景填白。失败回退原图。
  function compressImage(dataUrl, maxSide, quality) {
    maxSide = maxSide || 1600;
    quality = typeof quality === 'number' ? quality : 0.85;
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          if (!w || !h) { resolve(dataUrl); return; }
          var longest = Math.max(w, h);
          var scale = longest > maxSide ? maxSide / longest : 1;
          var tw = Math.max(1, Math.round(w * scale));
          var th = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement('canvas');
          canvas.width = tw;
          canvas.height = th;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, tw, th);
          ctx.drawImage(img, 0, 0, tw, th);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (e) { resolve(dataUrl); }
      };
      img.onerror = function () { resolve(dataUrl); };
      img.src = dataUrl;
    });
  }

  async function writeImageFile(path, dataUrl) {
    var parts = path.split('/');
    var name = parts.pop();
    var d = await getDir(parts);
    var fh = await d.getFileHandle(name, { create: true });
    var base64 = dataUrl.split(',')[1];
    var bin = atob(base64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var w = await fh.createWritable();
    await w.write(bytes);
    await w.close();
  }

  // 保存图片 + 自动生成缩略图（images/thumb/同名.jpg），前端预览立即有头像/相册小图
  async function writeImageFileWithThumb(path, dataUrl) {
    await writeImageFile(path, dataUrl);
    try {
      var parts = path.split('/');
      var name = parts.pop();
      var thumbName = name.replace(/\.[^.]+$/, '') + '.jpg';
      var thumbData = await compressImage(dataUrl, 160, 0.78);
      await writeImageFile('images/thumb/' + thumbName, thumbData);
    } catch (e) {
      log('⚠️ 缩略图生成失败（不影响原图保存）：' + e.message, 'warn');
    }
  }

  async function fileExists(path) {
    try {
      var parts = path.split('/');
      var name = parts.pop();
      var d = await getDir(parts);
      await d.getFileHandle(name);
      return true;
    } catch (e) { return false; }
  }

  // ---------- 数据加载/保存 ----------
  async function loadProject() {
    if (!dirHandle) return;
    try {
      cats = JSON.parse(await readTextFile(CATS_PATH));
      log('✅ 已读取 ' + cats.length + ' 只猫', 'ok');
    } catch (e) {
      cats = [];
      log('ℹ️ cats.json 不存在或为空，将新建', 'info');
    }
    try {
      relations = JSON.parse(await readTextFile(RELS_PATH));
    } catch (e) {
      relations = [];
    }
    try {
      var cfgText = await readTextFile(SITE_CFG_PATH);
      siteConfig = JSON.parse(cfgText) || {};
    } catch (e) {
      siteConfig = {};
    }
    renderCats();
    ensureMap();
    renderMarkers();
    renderRelSelects();
    renderRelList();
    updateRelLabels();
    renderStoryOrder();
  }

  async function saveAll() {
    if (!dirHandle) { log('❌ 请先选择项目文件夹', 'err'); return; }
    try {
      await writeTextFile(CATS_PATH, JSON.stringify(cats, null, 2) + '\n');
      await writeTextFile(RELS_PATH, JSON.stringify(relations, null, 2) + '\n');
      if (siteConfig && typeof siteConfig === 'object') {
        await writeTextFile(SITE_CFG_PATH, JSON.stringify(siteConfig, null, 2) + '\n');
      }
      log('✅ 已保存到本地文件', 'ok');
    } catch (e) {
      log('❌ 保存失败：' + e.message, 'err');
    }
  }
  // ---------- 故事集展示顺序 ----------
  function catHasStories(c) {
    return (Array.isArray(c.stories) && c.stories.length) || (c.story && String(c.story).trim());
  }
  function catStoryCount(c) {
    return Array.isArray(c.stories) && c.stories.length ? c.stories.length : (String(c.story || '').trim() ? 1 : 0);
  }
  function renderStoryOrder() {
    var box = $('story-order-list');
    if (!box) return;
    var storyCats = (cats || []).filter(catHasStories);
    if (!storyCats.length) { box.innerHTML = '<p class="hint" style="margin:0;">还没有任何故事，先给猫咪添加故事后再来调整顺序。</p>'; return; }
    // 建立 id -> cat 的映射
    var catById = {};
    storyCats.forEach(function (c) { catById[c.id] = c; });
    var existingOrder = Array.isArray(siteConfig.storyOrder) ? siteConfig.storyOrder.slice() : [];
    var inOrder = {};
    existingOrder.forEach(function (id) { inOrder[id] = true; });
    // 组合顺序：已有 storyOrder（仅保留有故事的） + 其余有故事但未列入的猫（按 cats 顺序）
    var order = existingOrder.filter(function (id) { return catById[id]; });
    storyCats.forEach(function (c) { if (!inOrder[c.id]) order.push(c.id); });
    siteConfig.storyOrder = order;

    function swap(i, j) { var t = order[i]; order[i] = order[j]; order[j] = t; siteConfig.storyOrder = order.slice(); renderStoryOrder(); }
    box.innerHTML = order.map(function (id, i) {
      var c = catById[id];
      var n = catStoryCount(c);
      var up = i > 0 ? '<button type="button" class="btn btn-sm so-up" data-i="' + i + '" title="上移">▲</button>' : '';
      var down = i < order.length - 1 ? '<button type="button" class="btn btn-sm so-down" data-i="' + i + '" title="下移">▼</button>' : '';
      return '<div class="so-item" style="display:flex;align-items:center;gap:10px;padding:6px 8px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;">'
        + '<span style="font-weight:700;color:#b45309;min-width:26px;">#' + (i + 1) + '</span>'
        + '<img src="' + esc((c.photo || '').indexOf('placeholder') >= 0 ? '' : c.photo) + '" style="width:32px;height:32px;border-radius:50%;object-fit:cover;background:#ffd9a8;" alt="" onerror="this.style.visibility=\'hidden\'">'
        + '<span style="flex:1;font-size:14px;font-weight:600;">' + esc(c.name) + '</span>'
        + '<span style="font-size:12px;color:var(--muted);">' + n + ' 篇</span>'
        + '<span style="display:flex;gap:4px;">' + up + down + '</span>'
        + '</div>';
    }).join('');
    box.querySelectorAll('.so-up').forEach(function (b) { b.addEventListener('click', function () { var i = Number(b.dataset.i); if (i > 0) swap(i, i - 1); }); });
    box.querySelectorAll('.so-down').forEach(function (b) { b.addEventListener('click', function () { var i = Number(b.dataset.i); if (i < order.length - 1) swap(i, i + 1); }); });
  }


  // ---------- 渲染 ----------
  function normalizeCats() {
    (cats || []).forEach(function (c) {
      if (!c.life) {
        if (c.status === '已领养') { c.life = '已领养'; c.status = '未绝育'; }
        else if (c.status === '失踪') { c.life = '失踪'; c.status = '未绝育'; }
        else c.life = '在校';
      }
    });
  }
  function renderCats() {
    var box = $('cats-list');
    if (!box) return;

    function renderFiltered(kw) {
      kw = (kw || '').trim().toLowerCase();
      var filtered = kw
        ? cats.filter(function (c) {
            var hay = [c.name, c.nickname, c.color, c.area, c.caretaker, c.age, (c.tags || []).join(' ')].join(' ').toLowerCase();
            return hay.indexOf(kw) >= 0;
          })
        : cats;

      if (!filtered.length) {
        box.innerHTML = '<p class="hint">' + (kw ? '没找到匹配「' + esc(kw) + '」的猫咪。' : '还没有猫咪，点右上角「添加猫咪」。') + '</p>';
        return;
      }

      box.innerHTML = filtered.map(function (c) {
        var photo = c.photo || 'images/placeholder.svg';
        var fallback = photo.indexOf('placeholder') >= 0 ? '' : '<span class="fallback">🐱</span>';
        var past = c.leftAt ? '<span style="color:#9ca3af">（过往）</span>' : '';
        function statusBadge(c) {
          if (c.life === '失踪') return ' <span style="background:#dc2626;color:#fff;font-size:11px;padding:1px 6px;border-radius:6px;font-weight:700;">⚠️ 失踪</span>';
          if (c.life === '失踪已久') return ' <span style="background:#9f1239;color:#fff;font-size:11px;padding:1px 6px;border-radius:6px;font-weight:700;">⚠️ 失踪已久</span>';
          if (c.life === '已领养') return ' <span style="background:#10b981;color:#fff;font-size:11px;padding:1px 6px;border-radius:6px;font-weight:700;">🏠 已领养</span>';
          return '';
        }
        return '<div class="catcard">' +
          '<div class="th"><img src="' + photo + '" alt="" onerror="this.style.opacity=0">' + fallback + '</div>' +
          '<div class="bd">' +
          '<div class="nm">' + esc(c.name) + ' <span style="color:#94a3b8;font-size:12px;font-weight:400">#' + esc(c.id) + '</span>' + (c.nickname ? '<span class="nick">（' + esc(c.nickname) + '）</span>' : '') + past + statusBadge(c) + '</div>' +
          '<div class="meta">' + (c.gender === 'male' ? '公' : (c.gender === 'female' ? '母' : '未知')) + ' · 绝育:' + esc(c.status || '未知') + ' · ' + esc(c.life || '在校') + ' · 📍 ' + esc(c.area || '') + '</div>' +
          '<div class="meta">' + (c.firstSeen ? '出现于 ' + c.firstSeen : '') + '</div>' +
          '<div class="ops"><button class="btn btn-sm" data-edit-id="' + c.id + '">编辑</button>' +
          '<button class="btn btn-sm btn-danger" data-del-id="' + c.id + '">删除</button></div>' +
          '</div></div>';
      }).join('');

      box.querySelectorAll('[data-edit-id]').forEach(function (b) {
        b.addEventListener('click', function () {
          var idx = cats.findIndex(function (x) { return x.id === b.dataset.editId; });
          if (idx >= 0) openCatModal(idx);
        });
      });
      box.querySelectorAll('[data-del-id]').forEach(function (b) {
        b.addEventListener('click', function () {
          var idx = cats.findIndex(function (x) { return x.id === b.dataset.delId; });
          if (idx < 0) return;
          if (!confirm('确定删除「' + cats[idx].name + '」？')) return;
          cats.splice(idx, 1);
          renderCats();
          renderMarkers();
          log('🗑️ 已删除猫咪', 'info');
        });
      });
    }

    renderFiltered('');

    var searchEl = $('admin-cat-search');
    if (searchEl && !searchEl._bound) {
      searchEl._bound = true;
      searchEl.addEventListener('input', function () { renderFiltered(searchEl.value); });
    }
  }

  // ---------- 关系管理 ----------
  // 生成「名称 (id)」显示串，避免重名歧义
  function relDisplay(c) {
    return c.name + ' (' + c.id + ')';
  }
  function relParse(display) {
    var m = (display || '').match(/\(([^)]*)\)\s*$/);
    if (m) return m[1];
    // 回退：直接按名称匹配
    var c = cats.find(function (x) { return (x.name === display); });
    return c ? c.id : '';
  }

  function renderRelSelects() {
    var from = $('rel-from');
    var to = $('rel-to');
    if (!from || !to) return;
    var opts = cats.map(function (c) {
      return '<option value="' + esc(relDisplay(c)) + '">' + esc(relDisplay(c)) + '</option>';
    }).join('');
    var dlFrom = $('rel-from-list');
    var dlTo = $('rel-to-list');
    if (dlFrom) dlFrom.innerHTML = opts;
    if (dlTo) dlTo.innerHTML = opts;
    from.value = '';
    to.value = '';
  }

  // 自动推断兄弟姐妹（同父或同母），供关系列表展示
  function deriveSiblingRelations() {
    var explicit = new Set();
    relations.forEach(function (r) {
      if (r.relation !== '兄弟姐妹') return;
      var a = String(r.from), b = String(r.to);
      explicit.add(a < b ? a + '_' + b : b + '_' + a);
    });
    var parents = new Map();
    function addP(child, parent) {
      if (!parents.has(child)) parents.set(child, new Set());
      parents.get(child).add(parent);
    }
    relations.forEach(function (r) {
      if (r.relation === '母子' || r.relation === '父子') addP(r.to, r.from);
    });
    var children = Array.from(parents.keys());
    var result = [];
    var done = new Set(explicit);
    for (var i = 0; i < children.length; i++) {
      for (var j = i + 1; j < children.length; j++) {
        var a = children[i], b = children[j];
        var shared = Array.from(parents.get(a)).some(function (pp) {
          return parents.get(b) && parents.get(b).has(pp);
        });
        if (!shared) continue;
        var key = a < b ? a + '_' + b : b + '_' + a;
        if (done.has(key)) continue;
        done.add(key);
        result.push({ from: a, to: b, relation: '兄弟姐妹', auto: true });
      }
    }
    return result;
  }

  function renderRelList() {
    var box = $('rel-list');
    if (!box) return;
    if (!relations.length) {
      box.innerHTML = '<p class="hint" style="margin:0;">还没有关系记录，用上面选择两只猫建立关系。</p>';
      return;
    }
    var nameOf = function (id) {
      var c = cats.find(function (x) { return x.id === id; });
      return c ? c.name : id;
    };
    box.innerHTML = relations.map(function (r, i) {
      return '<div class="rel-item">' +
        '<span class="rel-a">' + esc(nameOf(r.from)) + '</span>' +
        '<span class="rel-type">' + esc(r.relation || '关系') + '</span>' +
        '<span class="rel-a">' + esc(nameOf(r.to)) + '</span>' +
        (r.note ? '<span class="rel-note">（' + esc(r.note) + '）</span>' : '') +
        '<button class="btn btn-sm btn-danger rel-del" data-rel-idx="' + i + '">删除</button>' +
        '</div>';
    }).join('');
    // 自动推断的兄弟姐妹（只读展示，标注"自动推断"）
    var sibs = deriveSiblingRelations();
    if (sibs.length) {
      box.innerHTML += sibs.map(function (r) {
        return '<div class="rel-item" style="opacity:.75">' +
          '<span class="rel-a">' + esc(nameOf(r.from)) + '</span>' +
          '<span class="rel-type">兄弟姐妹</span>' +
          '<span class="rel-a">' + esc(nameOf(r.to)) + '</span>' +
          '<span class="rel-note">（自动推断）</span>' +
          '<button class="btn btn-sm" disabled style="opacity:.4">自动</button>' +
          '</div>';
      }).join('');
    }

    box.querySelectorAll('[data-rel-idx]').forEach(function (b) {
      b.addEventListener('click', function () {
        relations.splice(Number(b.dataset.relIdx), 1);
        renderRelList();
        log('🗑️ 已删除关系', 'info');
      });
    });
  }

  function addRelation() {
    var fromDisplay = $('rel-from') ? $('rel-from').value.trim() : '';
    var toDisplay = $('rel-to') ? $('rel-to').value.trim() : '';
    var from = relParse(fromDisplay);
    var to = relParse(toDisplay);
    var type = $('rel-type') ? $('rel-type').value : '';
    var note = $('rel-note') ? $('rel-note').value.trim() : '';
    if (!from || !to || !type) { log('❌ 请选择两只猫和关系类型', 'err'); return; }
    if (from === to) { log('❌ 不能选同一只猫', 'err'); return; }
    var dup = relations.some(function (r) {
      return (r.from === from && r.to === to && r.relation === type) || (r.from === to && r.to === from && r.relation === type);
    });
    if (dup) { log('⚠️ 这两只猫已经存在这个关系了', 'err'); return; }
    relations.push({ from: from, to: to, relation: type, note: note });
    renderRelList();
    if ($('rel-note')) $('rel-note').value = '';
    if ($('rel-from')) $('rel-from').value = '';
    if ($('rel-to')) $('rel-to').value = '';
    log('✅ 已添加关系，记得点「💾 保存到本地」', 'ok');
  }

  // 根据关系类型动态更新 A/B 的方向提示
  function updateRelLabels() {
    var type = $('rel-type') ? $('rel-type').value : '';
    var la = $('rel-label-a');
    var lb = $('rel-label-b');
    if (!la || !lb) return;
    if (type === '父子') { la.textContent = '爸爸（父）'; lb.textContent = '孩子'; }
    else if (type === '母子') { la.textContent = '妈妈（母）'; lb.textContent = '孩子'; }
    else if (type === '兄弟姐妹') { la.textContent = '猫咪 A'; lb.textContent = '猫咪 B'; }
    else if (type === '配偶') { la.textContent = '猫咪 A'; lb.textContent = '猫咪 B'; }
    else { la.textContent = '朋友 A'; lb.textContent = '朋友 B'; }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---------- 弹窗 ----------
  function openModal(id) { $(id).classList.add('open'); }
  function closeModal(id) { $(id).classList.remove('open'); }

  function openCatModal(idx) {
    editIdx = idx;
    var c = idx < 0 ? null : cats[idx];
    $('modal-title').textContent = c ? '编辑猫咪' : '添加猫咪';
    $('f-name').value = c ? (c.name || '') : '';
    $('f-nickname').value = c ? (c.nickname || '') : '';
    $('f-gender').value = c ? (c.gender || '') : 'unknown';
    $('f-color').value = c ? (c.color || '') : '';
    $('f-area').value = c ? (c.area || '') : '';
    $('f-status').value = c ? (c.status || '') : '未知';
    $('f-life').value = c ? (c.life || '在校') : '在校';
    $('f-lat').value = c ? c.lat : '';
    $('f-lng').value = c ? c.lng : '';
    var fs = c ? (c.firstSeen || '') : '';
    var m = fs.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
    $('f-firstY').value = m ? m[1] : '';
    $('f-firstM').value = m && m[2] ? String(parseInt(m[2])) : '';
    $('f-firstD').value = m && m[3] ? String(parseInt(m[3])) : '';
    $('f-leftAt').value = c ? (c.leftAt || '') : '';
    $('f-caretaker').value = c ? (c.caretaker || '') : '';
    $('f-age').value = c ? (c.age || '') : '';
    $('f-desc').value = c ? (c.description || '') : '';
    $('f-story').value = c ? (c.story || '') : '';
    renderTagChips(c ? (c.tags || []) : []);
    if (c && c.photo) { $('f-preview').src = c.photo; $('f-preview').classList.add('show'); }
    else { $('f-preview').src = ''; $('f-preview').classList.remove('show'); }
    pendingAvatar = null; pendingAvatarName = '';
    renderAlbum(c ? c.album : []);
    renderEvents(c ? (c.events || []) : []);
    renderStories(c ? (c.stories || []) : []);
    if (map && c) {
      pendingLatLng = { lat: c.lat, lng: c.lng };
      moveTempMarker(pendingLatLng);
    }
    var statusBanner = '';
    if (c) {
      if (c.life === '失踪') statusBanner = '<div style="background:#dc2626;color:#fff;padding:10px 14px;border-radius:10px;margin-bottom:10px;font-weight:600;">⚠️ 这只猫失踪了！如果你见过它，请尽快联系猫协（抖音/小红书/B 站搜「这里油只喵」）。任何线索都可能是它回家的希望。</div>';
      else if (c.life === '失踪已久') statusBanner = '<div style="background:#9f1239;color:#fff;padding:10px 14px;border-radius:10px;margin-bottom:10px;font-weight:600;">⚠️ 这只猫已失踪很久了。若你还见过它，请给猫协留言（抖音/小红书/B 站「这里油只喵」），任何线索都很宝贵。</div>';
      else if (c.life === '已领养') statusBanner = '<div style="background:#10b981;color:#fff;padding:8px 14px;border-radius:10px;margin-bottom:10px;">🏠 这只猫已被领养，开启新生活啦～</div>';
      else if (c.life === '去喵星了') statusBanner = '<div style="background:#57534e;color:#fff;padding:8px 14px;border-radius:10px;margin-bottom:10px;">🕊️ 这只猫已去喵星了。它的照片和故事我们会一直保留纪念。</div>';
    }
    var banner = $('cat-status-banner');
    if (banner) { banner.innerHTML = statusBanner; banner.style.display = statusBanner ? '' : 'none'; }
    openModal('cat-modal');
    validateCatForm();
  }

  function renderAlbum(album) {
    album = album || [];
    $('album-list').innerHTML = album.map(function (src, idx) {
      return '<div class="album-item"><img src="' + esc(src) + '" alt="" onerror="this.style.display=\'none\'">' +
        '<button class="del" data-idx="' + idx + '">×</button></div>';
    }).join('');
    $('album-list').querySelectorAll('.del').forEach(function (b) {
      b.addEventListener('click', function () {
        var c = cats[editIdx];
        c.album.splice(Number(b.dataset.idx), 1);
        renderAlbum(c.album);
      });
    });
  }

  // ---------- 最近事件 ----------
  var _pendingEvents = [];   // 当前编辑的事件数组；图片可能是 {dataUrl,ext} 待落盘
  var _evtImgTarget = -1;    // 当前要往哪个事件里加图（索引）
  var _pendingStories = [];
  var _storyImgTarget = -1;

  function renderEvents(events) {
    _pendingEvents = (events || []).map(function (ev) {
      return {
        date: ev.date || '',
        text: ev.text || '',
        images: (ev.images || []).map(function (img) {
          // 已是落盘路径
          return { path: img };
        })
      };
    });
    refreshEvents();
  }

  function refreshEvents() {
    var box = $('events-list');
    if (!box) return;
    if (!_pendingEvents.length) {
      box.innerHTML = '<p class="hint" style="margin:4px 0 0 0;">还没有事件，点下方「添加事件」记录（如：绝育、救助、新照）。</p>';
      return;
    }
    box.innerHTML = _pendingEvents.map(function (ev, i) {
      var imgs = (ev.images || []).map(function (im, j) {
        var src = im.path || im.dataUrl || '';
        return '<div class="thumb-wrap"><img class="thumb" src="' + esc(src) + '" alt="" onerror="this.style.display=\'none\'">' +
          '<button class="del" data-ev="' + i + '" data-img="' + j + '">×</button></div>';
      }).join('');
      return '<div class="event-item">' +
        '<div class="ev-row"><input class="ev-date" type="date" data-ev="' + i + '" value="' + esc(ev.date) + '">' +
        '<input class="ev-text" type="text" placeholder="事件描述，如：5月12日在图书馆绝育、打了疫苗" data-ev="' + i + '" value="' + esc(ev.text) + '">' +
        '<button class="btn btn-sm btn-danger ev-del" data-ev="' + i + '">删除</button></div>' +
        '<div class="ev-row"><button class="btn btn-sm" data-ev-img="' + i + '">🖼️ 加截图</button>' +
          '<button class="btn btn-sm" data-ev-paste="' + i + '" style="margin-left:4px">📋 粘贴截图</button></div>' +
        '<div class="ev-imgs">' + imgs + '</div>' +
        '</div>';
    }).join('');

    // 绑定日期/文字 input
    box.querySelectorAll('.ev-date').forEach(function (ip) {
      ip.addEventListener('input', function () { _pendingEvents[Number(ip.dataset.ev)].date = ip.value; });
    });
    box.querySelectorAll('.ev-text').forEach(function (ip) {
      ip.addEventListener('input', function () { _pendingEvents[Number(ip.dataset.ev)].text = ip.value; });
    });
    // 删除事件
    box.querySelectorAll('.ev-del').forEach(function (b) {
      b.addEventListener('click', function () { _pendingEvents.splice(Number(b.dataset.ev), 1); refreshEvents(); });
    });
    // 加截图（文件选择）
    box.querySelectorAll('[data-ev-img]').forEach(function (b) {
      b.addEventListener('click', function () { _evtImgTarget = Number(b.dataset.evImg); $('f-event-img').click(); });
    });
    // 粘贴截图到事件
    box.querySelectorAll('[data-ev-paste]').forEach(function (b) {
      b.addEventListener('click', function () { _evtImgTarget = Number(b.dataset.evPaste); setPasteMode(3); });
    });
    // 删除某张截图
    box.querySelectorAll('.del[data-img]').forEach(function (b) {
      b.addEventListener('click', function () {
        _pendingEvents[Number(b.dataset.ev)].images.splice(Number(b.dataset.img), 1);
        refreshEvents();
      });
    });
  }


  // ---------- 多篇故事 ----------
  function renderStories(stories) {
    var hostId = (editIdx >= 0 && cats[editIdx]) ? cats[editIdx].id : '';
    _pendingStories = (stories || []).map(function (s) {
      return {
        id: s.id || ('s_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
        date: s.date || '',
        title: s.title || '',
        content: s.content || '',
        images: (s.images || []).map(function (img) { return { path: img }; }),
        cats: (Array.isArray(s.cats) && s.cats.length) ? s.cats.slice() : (hostId ? [hostId] : [])
      };
    });
    refreshStories();
  }
  // 故事排序时间：优先用 date 字段（YYYY-MM[-DD]），否则回退到 id 里的时间戳
  function storyTs(s) {
    var d = String((s && s.date) || '').replace(/-/g, '');
    if (/^\d{6,8}$/.test(d)) return Number(d + '000000'.slice(0, 8 - d.length));
    var m = String((s && s.id) || '').match(/_?(\d{10,13})/);
    return m ? Number(m[1]) : 0;
  }
  function daysAgoDate(n) {
    var d = new Date(); d.setDate(d.getDate() - n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  // ---------- 关联猫咪：搜索栏 ----------
  function catById(id) {
    for (var i = 0; i < cats.length; i++) if (cats[i].id === id) return cats[i];
    return null;
  }
  function storiesResultsBox(si) {
    var box = $('stories-editor');
    return box ? box.querySelector('.story-cat-results[data-si="' + si + '"]') : null;
  }
  function toggleStoryCat(siRaw, cid) {
    var si = Number(siRaw);
    var arr = _pendingStories[si].cats || [];
    var k = arr.indexOf(cid);
    if (k >= 0) arr.splice(k, 1); else arr.push(cid);
    if (!arr.length && editIdx >= 0 && cats[editIdx]) arr.push(cats[editIdx].id);
    refreshStories();
    if (_pendingStories[si] && _pendingStories[si]._search) renderStoryCatResults(si);
  }
  function renderStoryCatResults(si) {
    var box = storiesResultsBox(si);
    if (!box) return;
    var s = _pendingStories[si];
    var q = String((s && s._search) || '').trim().toLowerCase();
    if (!q) { box.innerHTML = ''; return; }
    var arr = (s && s.cats) || [];
    var matches = (cats || []).filter(function (cc) {
      return (cc.name || '').toLowerCase().indexOf(q) >= 0 || (cc.nickname || '').toLowerCase().indexOf(q) >= 0 || (cc.id || '').toLowerCase().indexOf(q) >= 0;
    });
    if (!matches.length) { box.innerHTML = '<div class="hint" style="margin:4px 0;">没有找到匹配的猫</div>'; return; }
    box.innerHTML = matches.slice(0, 8).map(function (cc) {
      var on = arr.indexOf(cc.id) >= 0;
      return '<button type="button" class="story-cat-result' + (on ? ' on' : '') + '" data-si="' + si + '" data-cat="' + esc(cc.id) + '" title="' + (on ? '取消关联' : '关联') + '「' + esc(cc.name) + '」">' + (on ? '✓ ' : '＋ ') + esc(cc.name) + (cc.nickname ? '（' + esc(cc.nickname) + '）' : '') + '</button>';
    }).join('');
    box.querySelectorAll('.story-cat-result').forEach(function (b) {
      b.addEventListener('click', function () { toggleStoryCat(b.dataset.si, b.dataset.cat); });
    });
  }
  function refreshStories() {
    var box = $('stories-editor');
    if (!box) return;
    if (!_pendingStories.length) { box.innerHTML = '<p class="hint" style="margin:4px 0 0 0;">还没有多篇故事，点下方「添加故事」来创建。</p>'; return; }
    box.innerHTML = '<div class="story-sort-row" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><button type="button" class="btn btn-sm" id="btn-story-sort" title="按故事日期先后自动排序（早的在前）">⏰ 按时间排序</button><span class="hint" style="margin:0;">▲▼ 也可手动拖动顺序</span></div>' + _pendingStories.map(function (s, i) {
      var imgs = (s.images || []).map(function (im, j) {
        var src = im.path || im.dataUrl || '';
        return '<div class="thumb-wrap"><img class="thumb" src="' + esc(src) + '" alt="" onerror="this.style.display=\'none\'"><button class="del" data-si="' + i + '" data-img="' + j + '">×</button></div>';
      }).join('');
      var selChips = (s.cats || []).map(function (cid) {
        var cc = catById(cid);
        if (!cc) return '';
        return '<span class="story-cat-chip on" data-si="' + i + '" data-cat="' + esc(cid) + '" title="点击取消关联「' + esc(cc.name) + '」">' + esc(cc.name) + ' <b class="chip-x">×</b></span>';
      }).join('');
      return '<div class="story-edit-item" data-story-idx="' + i + '"><div class="story-header"><span class="story-num">#' + (i + 1) + '</span><div class="story-move-btns">' + (i > 0 ? '<button type="button" class="btn-story-up" data-si="' + i + '" title="上移">▲</button>' : '') + (i < _pendingStories.length - 1 ? '<button type="button" class="btn-story-down" data-si="' + i + '" title="下移">▼</button>' : '') + '</div><button type="button" class="btn btn-sm btn-danger btn-del-story" data-si="' + i + '">删除</button></div>' +
        '<div class="field" style="margin-top:4px;"><label>日期（选填）</label><div class="story-date-row"><input type="date" class="story-date" data-si="' + i + '" value="' + esc(s.date || '') + '"><button type="button" class="btn btn-sm btn-story-quick" data-si="' + i + '" data-off="0">今天</button><button type="button" class="btn btn-sm btn-story-quick" data-si="' + i + '" data-off="1">昨天</button><button type="button" class="btn btn-sm btn-story-quick" data-si="' + i + '" data-off="2">前天</button><button type="button" class="btn btn-sm btn-story-quick-clear" data-si="' + i + '">清空</button></div></div>' +
        '<div class="field" style="margin-top:4px;"><label>标题（选填）</label><input type="text" class="story-title" data-si="' + i + '" placeholder="故事标题" value="' + esc(s.title) + '"></div>' +
        '<div class="field" style="margin-top:4px;"><label>内容</label><textarea class="story-content" data-si="' + i + '" rows="3" placeholder="故事内容（纯文本）">' + esc(s.content) + '</textarea></div>' +
        '<div class="field" style="margin-top:4px;"><label>关联猫咪（一个故事可关联多只，搜索后点击结果添加/取消）</label>' +
          '<div class="story-cat-selected">' + selChips + '</div>' +
          '<div class="story-cat-search-row"><input type="text" class="story-cat-search" data-si="' + i + '" placeholder="🔍 输入猫名 / 外号搜索…" value="' + esc(s._search || '') + '" autocomplete="off"></div>' +
          '<div class="story-cat-results" data-si="' + i + '"></div>' +
        '</div>' +
        '<div class="field" style="margin-top:4px;"><label>配图</label><button type="button" class="btn btn-sm" data-story-img="' + i + '">🖼️ 加截图</button><button type="button" class="btn btn-sm" data-story-paste="' + i + '" style="margin-left:4px">📋 粘贴截图</button></div>' +
        '<div class="story-imgs">' + imgs + '</div></div>';
    }).join('');
    box.querySelectorAll('.story-date').forEach(function (ip) { ip.addEventListener('input', function () { _pendingStories[Number(ip.dataset.si)].date = ip.value; }); });
    box.querySelectorAll('.btn-story-quick').forEach(function (b) { b.addEventListener('click', function () { var si = Number(b.dataset.si); _pendingStories[si].date = daysAgoDate(Number(b.dataset.off)); refreshStories(); }); });
    box.querySelectorAll('.btn-story-quick-clear').forEach(function (b) { b.addEventListener('click', function () { var si = Number(b.dataset.si); _pendingStories[si].date = ''; refreshStories(); }); });
    box.querySelectorAll('.story-cat-chip').forEach(function (b) {
      b.addEventListener('click', function () { toggleStoryCat(b.dataset.si, b.dataset.cat); });
    });
    box.querySelectorAll('.story-cat-search').forEach(function (ip) {
      ip.addEventListener('input', function () {
        var si = Number(ip.dataset.si);
        _pendingStories[si]._search = ip.value;
        renderStoryCatResults(si);
      });
    });
    box.querySelectorAll('.story-title').forEach(function (ip) { ip.addEventListener('input', function () { _pendingStories[Number(ip.dataset.si)].title = ip.value; }); });
    box.querySelectorAll('.story-content').forEach(function (ip) { ip.addEventListener('input', function () { _pendingStories[Number(ip.dataset.si)].content = ip.value; }); });
    box.querySelectorAll('.btn-del-story').forEach(function (b) { b.addEventListener('click', function () { _pendingStories.splice(Number(b.dataset.si), 1); refreshStories(); }); });
    box.querySelectorAll('.btn-story-up').forEach(function (b) { b.addEventListener('click', function () { var idx = Number(b.dataset.si); if (idx <= 0) return; var tmp = _pendingStories[idx]; _pendingStories[idx] = _pendingStories[idx - 1]; _pendingStories[idx - 1] = tmp; refreshStories(); }); });
    box.querySelectorAll('.btn-story-down').forEach(function (b) { b.addEventListener('click', function () { var idx = Number(b.dataset.si); if (idx >= _pendingStories.length - 1) return; var tmp = _pendingStories[idx]; _pendingStories[idx] = _pendingStories[idx + 1]; _pendingStories[idx + 1] = tmp; refreshStories(); }); });
    box.querySelectorAll('[data-story-img]').forEach(function (b) { b.addEventListener('click', function () { _storyImgTarget = Number(b.dataset.storyImg); $('f-story-img').click(); }); });
    box.querySelectorAll('[data-story-paste]').forEach(function (b) { b.addEventListener('click', function () { _storyImgTarget = Number(b.dataset.storyPaste); setPasteMode(4); }); });
    box.querySelectorAll('.del[data-img]').forEach(function (b) { b.addEventListener('click', function () { _pendingStories[Number(b.dataset.si)].images.splice(Number(b.dataset.img), 1); refreshStories(); }); });
    var sortBtn = box.querySelector('#btn-story-sort');
    if (sortBtn) sortBtn.addEventListener('click', function () {
      _pendingStories.sort(function (a, b) { return storyTs(a) - storyTs(b); });
      refreshStories();
      log('⏰ 已按时间先后排序（早的在前）', 'info');
    });
    // 重新渲染后恢复各故事的搜索词与结果列表
    for (var ri = 0; ri < _pendingStories.length; ri++) {
      if (_pendingStories[ri]._search) renderStoryCatResults(ri);
    }
  }
  function getStories() {
    return _pendingStories.map(function (s) {
      return { id: s.id || '', date: s.date || '', title: s.title || '', content: s.content || '', cats: (Array.isArray(s.cats) ? s.cats : []).filter(Boolean), images: (s.images || []).map(function (im) { return im.path || im.dataUrl || ''; }).filter(Boolean) };
    }).filter(function (s) { return s.title || s.content || s.images.length; });
  }
  // 跨猫同步故事：每个故事在它关联的每只猫的 stories 里各保留一份（同 id 同内容），
  // 不再关联的猫自动移除该故事；prefIdx 指定当前编辑的猫，其数据作为权威版本。
  function syncStoryLinks(prefIdx) {
    if (!Array.isArray(cats)) return;
    var hostIds = {}, linkMap = {};
    var order = cats.map(function (_, i) { return i; });
    if (prefIdx >= 0) { order = order.filter(function (i) { return i !== prefIdx; }); order.push(prefIdx); }
    order.forEach(function (i) {
      var c = cats[i];
      (c.stories || []).forEach(function (s) {
        if (!s || !s.id) return;
        hostIds[s.id] = s;
        if (!linkMap[s.id]) linkMap[s.id] = [];
        if (linkMap[s.id].indexOf(c.id) < 0) linkMap[s.id].push(c.id);
        (Array.isArray(s.cats) ? s.cats : []).forEach(function (cid) {
          if (cid && linkMap[s.id].indexOf(cid) < 0) linkMap[s.id].push(cid);
        });
      });
    });
    (cats || []).forEach(function (c) {
      var kept = {}, arr = [];
      (c.stories || []).forEach(function (s) {
        if (s && s.id && linkMap[s.id] && linkMap[s.id].indexOf(c.id) >= 0) { kept[s.id] = true; arr.push(hostIds[s.id]); }
      });
      Object.keys(hostIds).forEach(function (sid) {
        if (!kept[sid] && linkMap[sid] && linkMap[sid].indexOf(c.id) >= 0) arr.push(hostIds[sid]);
      });
      c.stories = arr;
    });
  }
  async function onStoryImgChange() {
    var files = $('f-story-img').files;
    if (!files || !files.length) return;
    if (_storyImgTarget < 0) return;
    if (!_pendingStories[_storyImgTarget]) { $('f-story-img').value = ''; return; }
    var s = _pendingStories[_storyImgTarget];
    if (!s.images) s.images = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i]; var dataUrl = await readFileAsDataURL(f); var compressed = await compressImage(dataUrl, 1600, 0.85);
      if (editIdx >= 0 && cats[editIdx]) { var name = cats[editIdx].id + '_story_' + Date.now() + '_' + i + '.jpg'; var path = IMAGES_DIR + '/' + name; await writeImageFileWithThumb(path, compressed); s.images.push({ path: path }); log('✅ 已保存故事截图：' + path, 'ok'); }
      else { s.images.push({ dataUrl: compressed, ext: 'jpg' }); }
    }
    refreshStories(); $('f-story-img').value = '';
  }

  function getEvents() {
    return _pendingEvents.map(function (ev) {
      return {
        date: ev.date || '',
        text: ev.text || '',
        images: (ev.images || []).map(function (im) { return im.path || im.dataUrl || ''; }).filter(Boolean)
      };
    }).filter(function (ev) { return ev.date || ev.text || ev.images.length; });
  }

  async function onEventImgChange() {
    var files = $('f-event-img').files;
    if (!files || !files.length) return;
    if (_evtImgTarget < 0) return;
    if (!_pendingEvents[_evtImgTarget]) { $('f-event-img').value = ''; return; }
    var ev = _pendingEvents[_evtImgTarget];
    if (!ev.images) ev.images = [];

    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var dataUrl = await readFileAsDataURL(f);
      var compressed = await compressImage(dataUrl, 1600, 0.85);
      // 若已有 id，直接落盘；否则暂存 dataUrl，saveCat 时落盘
      if (editIdx >= 0 && cats[editIdx]) {
        var name = cats[editIdx].id + '_event_' + Date.now() + '_' + i + '.jpg';
        var path = IMAGES_DIR + '/' + name;
        await writeImageFileWithThumb(path, compressed);
        ev.images.push({ path: path });
        log('✅ 已保存事件截图：' + path, 'ok');
      } else {
        ev.images.push({ dataUrl: compressed, ext: 'jpg' });
      }
    }
    refreshEvents();
    $('f-event-img').value = '';
  }

  // ---------- 图片上传 ----------
  function onAvatarChange() {
    var f = $('f-avatar').files && $('f-avatar').files[0];
    if (!f) return;
    pendingAvatarName = f.name;
    var r = new FileReader();
    r.onload = function (e) { openCropModal(e.target.result); };
    r.readAsDataURL(f);
  }

  async function onAlbumAdd() {
    var files = $('f-album').files;
    if (!files || !files.length) return;
    if (!dirHandle) { log('❌ 请先选择项目文件夹', 'err'); return; }
    var c = cats[editIdx];
    if (!c.album) c.album = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var dataUrl = await readFileAsDataURL(f);
      log('  压缩中：' + f.name + ' ...', 'info');
      var compressed = await compressImage(dataUrl, 1600, 0.85);
      var name = c.id + '_album_' + Date.now() + '_' + i + '.jpg';
      var path = IMAGES_DIR + '/' + name;
      await writeImageFileWithThumb(path, compressed);
      c.album.push(path);
      log('✅ 已添加相册照片（已压缩）：' + path, 'ok');
    }
    renderAlbum(c.album);
    $('f-album').value = '';
  }

  function readFileAsDataURL(file) {
    return new Promise(function (resolve) {
      var r = new FileReader();
      r.onload = function (e) { resolve(e.target.result); };
      r.readAsDataURL(file);
    });
  }

  // ---------- 粘贴截图支持（Ctrl+V） ----------
  // 0 = 未激活；1 = 粘贴到头像（走裁剪）；2 = 粘贴到相册
  var pasteTarget = 0;
  function setPasteMode(mode) {
    pasteTarget = mode;
    var hint = $('paste-hint');
    var btn = $('btn-paste');
    if (mode === 1) {
      if (hint) { hint.innerHTML = '已就绪，按 <b>Ctrl + V</b> 把截图粘成<b>头像</b>（会弹出裁剪）'; hint.style.display = ''; }
      if (btn) { btn.textContent = '🎯 准备粘头像'; btn.style.background = '#dbeafe'; }
    } else if (mode === 2) {
      if (hint) { hint.innerHTML = '已就绪，按 <b>Ctrl + V</b> 把截图粘到<b>相册</b>（直接保存）'; hint.style.display = ''; }
      if (btn) { btn.textContent = '🖼️ 准备粘相册'; btn.style.background = '#dcfce7'; }
    } else if (mode === 3) {
      if (hint) { hint.innerHTML = '已就绪，按 <b>Ctrl + V</b> 把截图粘到<b>事件</b>（直接保存）'; hint.style.display = ''; }
      if (btn) { btn.textContent = '📋 准备粘事件'; btn.style.background = '#fef3c7'; }
    } else if (mode === 4) {
      if (hint) { hint.innerHTML = '已就绪，按 <b>Ctrl + V</b> 把截图粘到<b>故事</b>（直接保存）'; hint.style.display = ''; }
      if (btn) { btn.textContent = '📖 准备粘故事'; btn.style.background = '#fef3c7'; }
    } else {
      if (hint) hint.style.display = 'none';
      if (btn) { btn.textContent = '📋 粘贴截图'; btn.style.background = ''; }
    }
  }
  function handlePastedImage(blob) {
    if (!blob || !blob.type || blob.type.indexOf('image') !== 0) {
      log('❌ 剪贴板里没找到图片', 'err');
      return;
    }
    var file = new File([blob], 'pasted-' + Date.now() + '.png', { type: blob.type });
    var reader = new FileReader();
    reader.onload = async function (e) {
      var dataUrl = e.target.result;
      if (pasteTarget === 1) {
        pendingAvatarName = file.name;
        openCropModal(dataUrl);
        log('📋 已粘贴截图，请裁剪后点「确认」', 'ok');
      } else if (pasteTarget === 2) {
        if (!dirHandle) { log('❌ 请先选择项目文件夹', 'err'); setPasteMode(0); return; }
        var c = cats[editIdx];
        if (!c) { log('❌ 请先打开一只猫的编辑弹窗', 'err'); setPasteMode(0); return; }
        if (!c.album) c.album = [];
        var compressed = await compressImage(dataUrl, 1600, 0.85);
        var name = c.id + '_album_' + Date.now() + '.jpg';
        var path = IMAGES_DIR + '/' + name;
        await writeImageFileWithThumb(path, compressed);
        c.album.push(path);
        renderAlbum(c.album);
        log('📋 已粘贴截图到相册：' + path, 'ok');
      } else if (pasteTarget === 3) {
        if (!dirHandle) { log('❌ 请先选择项目文件夹', 'err'); setPasteMode(0); return; }
        var ev = _pendingEvents[_evtImgTarget];
        if (!ev) { log('❌ 请先添加一个事件', 'err'); setPasteMode(0); return; }
        if (!ev.images) ev.images = [];
        var compressed = await compressImage(dataUrl, 1600, 0.85);
        var name = cats[editIdx].id + '_event_' + Date.now() + '.jpg';
        var path = IMAGES_DIR + '/' + name;
        await writeImageFileWithThumb(path, compressed);
        ev.images.push({ path: path });
        refreshEvents();
        log('📋 已粘贴截图到事件：' + path, 'ok');
      } else if (pasteTarget === 4) {
        if (!dirHandle) { log('❌ 请先选择项目文件夹', 'err'); setPasteMode(0); return; }
        var sv = _pendingStories[_storyImgTarget]; if (!sv) { log('❌ 请先添加一个故事', 'err'); setPasteMode(0); return; }
        if (!sv.images) sv.images = [];
        var compressed = await compressImage(dataUrl, 1600, 0.85);
        var name = cats[editIdx].id + '_story_' + Date.now() + '.jpg'; var path = IMAGES_DIR + '/' + name;
        await writeImageFileWithThumb(path, compressed); sv.images.push({ path: path }); refreshStories();
        log('📋 已粘贴截图到故事：' + path, 'ok');
      }
      setPasteMode(0);
    };
    reader.readAsDataURL(blob);
  }

  function openCropModal(dataUrl) {
    var box = $('crop-box');
    box.innerHTML = '';
    var img = document.createElement('img');
    img.id = 'crop-img';
    img.style.maxWidth = '100%';
    img.style.maxHeight = '280px';
    img.style.display = 'block';
    img.style.margin = '0 auto';
    img.onload = function () {
      openModal('crop-modal');
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (typeof Cropper !== 'undefined') {
            if (cropInstance) cropInstance.destroy();
            cropInstance = new Cropper(img, {
              aspectRatio: 1, viewMode: 1, autoCropArea: 0.9,
              dragMode: 'move', background: false, responsive: true
            });
          }
        });
      });
    };
    img.onerror = function () { log('❌ 图片加载失败', 'err'); };
    box.appendChild(img);
    img.src = dataUrl;
  }

  function confirmCrop() {
    if (cropInstance) {
      pendingAvatar = cropInstance.getCroppedCanvas({ width: 480, height: 480 }).toDataURL('image/jpeg', 0.85);
      $('f-preview').src = pendingAvatar;
      $('f-preview').classList.add('show');
      cropInstance.destroy(); cropInstance = null;
    }
    closeModal('crop-modal');
  }

  function cancelCrop() {
    if (cropInstance) { cropInstance.destroy(); cropInstance = null; }
    closeModal('crop-modal');
  }

  // ---------- 保存猫咪 ----------
  // 必填项与 scripts/validate.mjs 保持一致
  var REQUIRED_CAT_FORM = [
    { id: 'f-name', label: '名字' },
    { id: 'f-gender', label: '性别' },
    { id: 'f-lat', label: '纬度' },
    { id: 'f-lng', label: '经度' },
    { id: 'f-status', label: '绝育状态' }
  ];
  // 实时校验：高亮缺失项并在保存按钮上方提示；返回 true=全部通过
  function validateCatForm() {
    var missing = [];
    REQUIRED_CAT_FORM.forEach(function (r) {
      var el = $(r.id);
      var val = el ? String(el.value || '').trim() : '';
      var ok = false;
      if (r.id === 'f-lat' || r.id === 'f-lng') {
        ok = val !== '' && !isNaN(parseFloat(val));
      } else {
        ok = val !== '';
      }
      if (el) el.classList.toggle('invalid', !ok);
      if (!ok) missing.push(r.label);
    });
    var hint = $('form-valid-hint');
    if (hint) {
      hint.classList.remove('ok');
      if (missing.length) {
        hint.className = 'form-valid-hint show';
        hint.innerHTML = '⚠️ 还有 <b>' + missing.join('、') + '</b> 没填（必填），保存会被校验拦下。';
      } else {
        hint.className = 'form-valid-hint show ok';
        hint.textContent = '✅ 必填项都填好啦，可以保存。';
      }
    }
    return missing.length === 0;
  }
  async function saveCat() {
    if (!dirHandle) { log('❌ 请先选择项目文件夹', 'err'); return; }
    if (!validateCatForm()) {
      var hint = $('form-valid-hint');
      if (hint) { hint.className = 'form-valid-hint show'; hint.innerHTML = '❌ 没填的必填项已高亮：<b>' + REQUIRED_CAT_FORM.filter(function (r) { return $(r.id) && $(r.id).classList.contains('invalid'); }).map(function (r) { return r.label; }).join('、') + '</b>'; }
      log('❌ 有必填项没填，请补全后再保存（已高亮标出）', 'err');
      return;
    }
    var name = $('f-name').value.trim();
    var lat = parseFloat($('f-lat').value);
    var lng = parseFloat($('f-lng').value);
    if (!name || isNaN(lat) || isNaN(lng)) { log('❌ 名字、纬度、经度必填', 'err'); return; }
    var isAdd = editIdx < 0;
    var id = isAdd ? nextId() : cats[editIdx].id;
    var photo = isAdd ? 'images/placeholder.svg' : (cats[editIdx].photo || 'images/placeholder.svg');

    if (pendingAvatar) {
      // 优先从 dataUrl 的 MIME 推断真实格式，避免「.png 装着 JPEG」导致图片不显示
      var mimeExt = (pendingAvatar.match(/^data:image\/(png|jpeg|gif|webp);/i) || [])[1] || '';
      mimeExt = mimeExt === 'jpeg' ? 'jpg' : mimeExt;
      var ext = mimeExt || (pendingAvatarName.split('.').pop() || 'jpg').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'jpg';
      var path = IMAGES_DIR + '/' + id + '.' + ext;
      await writeImageFileWithThumb(path, pendingAvatar);
      photo = path;
      log('✅ 已保存头像：' + path, 'ok');
    }

    var cat = {
      id: id, name: name,
      nickname: $('f-nickname').value.trim(),
      gender: $('f-gender').value,
      color: $('f-color').value.trim(),
      area: $('f-area').value.trim(),
      lat: +lat.toFixed(6), lng: +lng.toFixed(6),
      photo: photo,
      album: isAdd ? [] : (cats[editIdx].album || []),
      description: $('f-desc').value.trim(),
      story: $('f-story').value.trim(),
      tags: getCurrentTags(),
      status: $('f-status').value || '未知',
      life: $('f-life').value,
      firstSeen: buildDate($('f-firstY').value, $('f-firstM').value, $('f-firstD').value),
      leftAt: $('f-leftAt').value.trim(),
      caretaker: $('f-caretaker').value.trim(),
      age: $('f-age').value.trim(),
      events: getEvents(),
      stories: getStories()
    };

    // 故事截图落盘
    if (cat.stories && cat.stories.length) {
      for (var si = 0; si < cat.stories.length; si++) {
        var sv = cat.stories[si]; if (!sv.images || !sv.images.length) continue;
        var finalImgs = [];
        for (var sj = 0; sj < sv.images.length; sj++) {
          var sim = sv.images[sj];
          if (sim.indexOf('data:') === 0) { var ext = (sim.match(/^data:image\/([a-zA-Z0-9]+);/) || [])[1] || 'png'; var p = IMAGES_DIR + '/' + id + '_story_' + Date.now() + '_' + sj + '.' + ext; await writeImageFileWithThumb(p, sim); finalImgs.push(p); log('✅ 已保存故事截图：' + p, 'ok'); }
          else { finalImgs.push(sim); }
        }
        sv.images = finalImgs;
      }
    }
    if (!cat.stories || !cat.stories.length) delete cat.stories;
    // 事件截图落盘（dataUrl 形式的图片保存为文件，路径形式的保持不变）
    if (cat.events && cat.events.length) {
      for (var ei = 0; ei < cat.events.length; ei++) {
        var ev = cat.events[ei];
        if (!ev.images || !ev.images.length) continue;
        var finalImgs = [];
        for (var ej = 0; ej < ev.images.length; ej++) {
          var im = ev.images[ej];
          if (im.indexOf('data:') === 0) {
            var ext = (im.match(/^data:image\/([a-zA-Z0-9]+);/) || [])[1] || 'png';
            var p = IMAGES_DIR + '/' + id + '_event_' + Date.now() + '_' + ej + '.' + ext;
            await writeImageFileWithThumb(p, im);
            finalImgs.push(p);
            log('✅ 已保存事件截图：' + p, 'ok');
          } else {
            finalImgs.push(im);
          }
        }
        ev.images = finalImgs;
      }
    }
    if (isAdd) cats.push(cat); else cats[editIdx] = cat;
    syncStoryLinks(isAdd ? -1 : editIdx);
    await saveAll();
    closeModal('cat-modal');
    renderCats();
    renderMarkers();
    renderRelSelects();
    renderRelList();
    pendingAvatar = null;
  }

  function nextId() {
    var n = cats.length + 1, id = 'cat' + pad(n, 3);
    while (cats.some(function (c) { return c.id === id; })) { n++; id = 'cat' + pad(n, 3); }
    return id;
  }
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function currentMonth() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  // ---------- 档案标签 chips ----------
  var _currentTags = [];
  function renderTagChips(tags) {
    _currentTags = (tags || []).slice();
    var box = $('f-tags-chips');
    box.innerHTML = _currentTags.map(function (t, i) {
      return '<span class="tag-chip">' + esc(t) + '<button type="button" data-i="' + i + '" aria-label="删除">×</button></span>';
    }).join('');
    box.querySelectorAll('button[data-i]').forEach(function (b) {
      b.addEventListener('click', function () {
        _currentTags.splice(Number(b.dataset.i), 1);
        renderTagChips(_currentTags);
      });
    });
  }
  function addTag(text) {
    text = String(text || '').trim();
    if (!text) return;
    if (_currentTags.indexOf(text) >= 0) return;
    _currentTags.push(text);
    renderTagChips(_currentTags);
  }
  function getCurrentTags() {
    var input = $('f-tags-input');
    if (input && input.value.trim()) addTag(input.value);
    if (input) input.value = '';
    return _currentTags.slice();
  }
  function initTagInput() {
    var input = $('f-tags-input');
    if (!input) return;
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        addTag(input.value);
        input.value = '';
      } else if (e.key === 'Backspace' && !input.value && _currentTags.length) {
        _currentTags.pop();
        renderTagChips(_currentTags);
      }
    });
    input.addEventListener('blur', function () {
      if (input.value.trim()) { addTag(input.value); input.value = ''; }
    });
  }
  function buildDate(y, m, d) {
    y = String(y || '').trim();
    m = String(m || '').trim();
    d = String(d || '').trim();
    if (!y) return '';
    if (!/^\d{4}$/.test(y)) return '';
    if (!m) return y;
    if (!/^\d{1,2}$/.test(m) || +m < 1 || +m > 12) return y;
    m = String(+m).padStart(2, '0');
    if (!d) return y + '-' + m;
    if (!/^\d{1,2}$/.test(d) || +d < 1 || +d > 31) return y + '-' + m;
    d = String(+d).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  // ---------- GitHub 拉取 ----------
  async function pullFromGitHub() {
    if (!dirHandle) { log('❌ 请先选择项目文件夹', 'err'); return; }
    // 拉取前检查：本地有未保存的修改时先警告
    if (!confirm('⚠️ 拉取操作会用 GitHub 上的数据覆盖本地文件（cats.json/relations.json/图片）。\n\n如果本地有未推送的修改，请先点「推送到 GitHub」，否则这些修改会丢失！\n\n确定要继续吗？')) {
      log('ℹ️ 已取消拉取', 'info');
      return;
    }
    var repo = $('cfg-repo').value.trim();
    var branch = $('cfg-branch').value.trim() || 'main';
    var token = $('cfg-token').value.trim();
    // 如果输入框是空的，尝试从 localStorage 读
    if (!repo) { try { var c = JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); if (c.repo) { $('cfg-repo').value = c.repo; repo = c.repo; } if (c.token) { $('cfg-token').value = c.token; token = c.token; } if (c.branch) { $('cfg-branch').value = c.branch; branch = c.branch; } } catch (e) {} }
    if (!repo) { log('❌ 请先填写仓库名（如 ly-ly-666/campus-cats）', 'err'); return; }
    log('⏳ 正在从 GitHub 拉取最新数据…', 'info');
    try {
      var headers = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      var q = '?ref=' + encodeURIComponent(branch);

      // 拉取 cats.json
      var r1 = await fetch('https://api.github.com/repos/' + repo + '/contents/' + CATS_PATH + q, { headers: headers });
      if (!r1.ok) throw new Error('拉取 cats.json 失败: HTTP ' + r1.status);
      var j1 = await r1.json();
      var catsText = decodeBase64Utf8(j1.content || '');
      await writeTextFile(CATS_PATH, catsText);
      // 同步图片
      var remoteCats = JSON.parse(catsText);
      await syncImages(remoteCats, repo, branch, headers);
      // 重写 cats.json 用本地 LF
      await writeTextFile(CATS_PATH, JSON.stringify(remoteCats, null, 2) + '\n');

      // 拉取 relations.json
      var r2 = await fetch('https://api.github.com/repos/' + repo + '/contents/' + RELS_PATH + q, { headers: headers });
      if (r2.ok) {
        var j2 = await r2.json();
        await writeTextFile(RELS_PATH, decodeBase64Utf8(j2.content || ''));
      } else {
        await writeTextFile(RELS_PATH, '[]\n');
      }

      cats = remoteCats;
      try { relations = JSON.parse(await readTextFile(RELS_PATH)); } catch (e) { relations = []; }
      renderCats();
      if (typeof L !== 'undefined') { ensureMap(); renderMarkers(); }
      log('✅ 已从 GitHub 拉取最新数据并写入本地文件（' + cats.length + ' 只猫）', 'ok');
    } catch (e) {
      log('❌ 拉取失败：' + e.message, 'err');
    }
  }
  function decodeBase64Utf8(b64) {
    var bin = atob(b64.replace(/\n/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }
  async function syncImages(remoteCats, repo, branch, headers) {
    var q = '?ref=' + encodeURIComponent(branch);
    var paths = [];
    remoteCats.forEach(function (c) {
      [c.photo].concat(c.album || []).forEach(function (p) {
        if (p && p.indexOf('placeholder') < 0 && p.indexOf('http') !== 0) paths.push(p);
      });
    });
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i];
      if (await fileExists(p)) continue;
      try {
        var r = await fetch('https://api.github.com/repos/' + repo + '/contents/' + p + q, { headers: headers });
        if (!r.ok) continue;
        var j = await r.json();
        var bin = atob((j.content || '').replace(/\n/g, ''));
        var bytes = new Uint8Array(bin.length);
        for (var k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
        var parts = p.split('/');
        var name = parts.pop();
        var d = await getDir(parts);
        var fh = await d.getFileHandle(name, { create: true });
        var w = await fh.createWritable();
        await w.write(bytes);
        await w.close();
        log('📥 已下载图片：' + p, 'info');
      } catch (e) { /* 忽略单张图片失败 */ }
    }
  }

  // ---------- GitHub 推送 ----------
  // 用 Git Data API 一次提交所有有变化的文件（比逐个 PUT 快得多），并并行创建 blob。
  async function pushToGitHub() {
    if (!dirHandle) { log('❌ 请先选择项目文件夹', 'err'); return; }
    var repo = $('cfg-repo').value.trim();
    var branch = $('cfg-branch').value.trim() || 'main';
    var token = $('cfg-token').value.trim();
    if (!repo) { try { var c = JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); if (c.repo) { $('cfg-repo').value = c.repo; repo = c.repo; } if (c.token) { $('cfg-token').value = c.token; token = c.token; } if (c.branch) { $('cfg-branch').value = c.branch; branch = c.branch; } } catch (e) {} }
    if (!repo) { log('❌ 请先填写仓库名（如 ly-ly-666/campus-cats）', 'err'); return; }
    if (!token) { log('❌ 请填写 Token', 'err'); return; }

    log('⏳ 开始推送到 GitHub（批量单次提交）…', 'info');
    try {
      var headers = { 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' };
      var api = 'https://api.github.com/repos/' + repo + '/git/';
      var useSha = typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest;

      // 1. 取当前分支指向的 commit 与树
      var refRes = await fetchWithTimeout(api + 'ref/heads/' + encodeURIComponent(branch), { headers: headers });
      if (!refRes.ok) throw new Error('无法读取分支 ' + branch + '（' + refRes.status + '），请检查仓库名/分支/Token');
      var baseCommitSha = (await refRes.json()).object.sha;
      var commitRes = await fetchWithTimeout(api + 'commits/' + baseCommitSha, { headers: headers });
      var baseTreeSha = (await commitRes.json()).tree.sha;

      // 2. 拉取当前整棵树的 path→sha 映射（一次请求替代逐个文件的 GET）
      var remoteSha = {};
      var treeRes = await fetchWithTimeout(api + 'trees/' + baseTreeSha + '?recursive=1', { headers: headers });
      if (treeRes.ok) {
        (await treeRes.json()).tree.forEach(function (t) { if (t.type === 'blob') remoteSha[t.path] = t.sha; });
      }

      // 3. 收集要推送的本地文件（JSON + 头像/相册/事件/故事图片 + 对应缩略图）
      var files = [], seen = {};
      function pushFile(path, b64) { if (!seen[path]) { seen[path] = 1; files.push({ path: path, localB64: b64 }); } }
      pushFile(CATS_PATH, utf8ToB64(await readTextFile(CATS_PATH)));
      pushFile(RELS_PATH, utf8ToB64(await readTextFile(RELS_PATH)));
      for (var i = 0; i < cats.length; i++) {
        var c = cats[i];
        var imgs = [c.photo].concat(c.album || []);
        (c.events || []).forEach(function (ev) { (ev.images || []).forEach(function (im) { imgs.push(im); }); });
        (c.stories || []).forEach(function (st) { (st.images || []).forEach(function (im) { imgs.push(im); }); });
        imgs = imgs.filter(function (p) { return p && p.indexOf('placeholder') < 0; });
        for (var j = 0; j < imgs.length; j++) {
          var path = imgs[j];
          if (!(await fileExists(path))) continue;
          pushFile(path, dataUrlToBase64(await readImageAsDataURL(path)));
          // 顺带推送对应缩略图（images/thumb/同名.jpg），保证前端预览有图
          var thumbName = path.replace(/^.*\//, '').replace(/\.[^.]+$/, '') + '.jpg';
          var thumbPath = 'images/thumb/' + thumbName;
          if (await fileExists(thumbPath)) pushFile(thumbPath, dataUrlToBase64(await readImageAsDataURL(thumbPath)));
        }
      }

      // 4. 比对本地 blob sha 与远端，未变化的跳过；变化/新增的并行创建 blob
      var newTree = [], putCount = 0, skipCount = 0, cursor = 0;
      async function pushWorker() {
        while (cursor < files.length) {
          var f = files[cursor++];
          if (useSha) {
            var localSha = await gitBlobSha(atob(f.localB64));
            if (remoteSha[f.path] === localSha) { skipCount++; log('  ⏭ 跳过（未变化）：' + f.path, 'info'); continue; }
          }
          var blobRes = await fetchWithTimeout(api + 'blobs', {
            method: 'POST',
            headers: Object.assign({}, headers, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ content: f.localB64, encoding: 'base64' })
          });
          if (!blobRes.ok) { var bj = await blobRes.json().catch(function () { return {}; }); throw new Error(f.path + ' -> ' + (bj.message || blobRes.status)); }
          newTree.push({ path: f.path, mode: '100644', type: 'blob', sha: (await blobRes.json()).sha });
          putCount++;
          log('  ⏫ 上传中：' + f.path + ' …', 'info');
        }
      }
      var workers = [];
      for (var w = 0; w < 6; w++) workers.push(pushWorker());
      await Promise.all(workers);

      if (!newTree.length) { log('✅ 没有需要更新的文件（' + skipCount + ' 个文件均未变化）', 'ok'); return; }

      // 5. 创建新树（未变文件沿用 base_tree）
      var newTreeRes = await fetchWithTimeout(api + 'trees', {
        method: 'POST', headers: Object.assign({}, headers, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ base_tree: baseTreeSha, tree: newTree })
      });
      if (!newTreeRes.ok) throw new Error('创建树失败（' + newTreeRes.status + '）');
      var newTreeSha = (await newTreeRes.json()).sha;

      // 6. 创建一次提交（所有文件在一个 commit 里）
      var commitRes2 = await fetchWithTimeout(api + 'commits', {
        method: 'POST', headers: Object.assign({}, headers, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ message: 'data: 本地管理端批量更新 ' + putCount + ' 个文件', tree: newTreeSha, parents: [baseCommitSha] })
      });
      if (!commitRes2.ok) throw new Error('创建提交失败（' + commitRes2.status + '）');
      var newCommitSha = (await commitRes2.json()).sha;

      // 7. 把分支引用指向新提交（force:false，避免覆盖别人的提交）
      var refRes2 = await fetchWithTimeout(api + 'refs/heads/' + encodeURIComponent(branch), {
        method: 'PATCH', headers: Object.assign({}, headers, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ sha: newCommitSha, force: false })
      });
      if (!refRes2.ok) throw new Error('更新分支失败（' + refRes2.status + '），可能是远端有新提交，请先拉取再推');

      log('🎉 推送完成！本次单次提交更新 ' + putCount + ' 个文件，跳过 ' + skipCount + ' 个未变化文件', 'ok');
    } catch (e) {
      var msg = e.message || '';
      if (msg.indexOf('AbortError') >= 0 || msg.indexOf('abort') >= 0) {
        log('❌ 网络超时：连不上 GitHub，请检查网络后重试', 'err');
      } else if (msg.indexOf('Failed to fetch') >= 0 || msg.indexOf('network') >= 0) {
        log('❌ 网络错误：连不上 GitHub（可能被墙或断网），请换网络重试', 'err');
      } else {
        log('❌ 推送失败：' + msg, 'err');
      }
    }
  }

  // 计算 Git blob 的 SHA-1（"blob <长度>\0<内容>"），用于跳过未变化文件
  async function gitBlobSha(binStr) {
    var bytes = new Uint8Array(binStr.length);
    for (var i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i) & 0xff;
    var prefix = new TextEncoder().encode('blob ' + bytes.length + '\0');
    var all = new Uint8Array(prefix.length + bytes.length);
    all.set(prefix, 0); all.set(bytes, prefix.length);
    var buf = await crypto.subtle.digest('SHA-1', all);
    var arr = new Uint8Array(buf), hex = '';
    for (var k = 0; k < arr.length; k++) hex += arr[k].toString(16).padStart(2, '0');
    return hex;
  }

  function fetchWithTimeout(url, opts, ms) {
    ms = ms || 20000; // 默认 20 秒超时
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, ms);
    return fetch(url, Object.assign({}, opts, { signal: ctrl.signal })).finally(function () { clearTimeout(t); });
  }

  async function readImageAsDataURL(path) {
    var parts = path.split('/');
    var name = parts.pop();
    var d = await getDir(parts);
    var fh = await d.getFileHandle(name);
    var file = await fh.getFile();
    return new Promise(function (resolve) {
      var r = new FileReader();
      r.onload = function (e) { resolve(e.target.result); };
      r.readAsDataURL(file);
    });
  }

  function dataUrlToBase64(dataUrl) {
    // GitHub API 的 content 字段要求是「二进制」的 base64 编码
    // dataURL 已经是 base64 文本，需要先 atob 解码成二进制字符串再 btoa 重编码
    var raw = atob(dataUrl.split(',')[1]);
    return btoa(raw);
  }
  function utf8ToB64(str) {
    // 把 UTF-8 文本转成 base64 编码的二进制（GitHub API content 字段要求）
    return btoa(unescape(encodeURIComponent(str)));
  }

  // ---------- 事件绑定 ----------
  function bind() {
    initTagInput();
    loadCfg();
    ['cfg-repo', 'cfg-branch', 'cfg-token'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('input', saveCfg);
      el.addEventListener('change', saveCfg);
    });
    $('btn-pick').addEventListener('click', pickFolder);
    $('btn-save-all').addEventListener('click', saveAll);
    $('btn-pull').addEventListener('click', pullFromGitHub);
    $('btn-preview').addEventListener('click', function () {
      // 打开本地 index.html（用当前本地数据预览，不推 GitHub）
      var base = window.location.href.replace(/local-admin\.html.*$/, '');
      window.open(base + 'index.html?preview=1&t=' + Date.now(), '_blank');
      log('👀 已在新标签打开预览（基于当前本地数据，不用推 GitHub）', 'info');
    });
    $('btn-push').addEventListener('click', pushToGitHub);
    $('btn-add').addEventListener('click', function () { openCatModal(-1); });
    if ($('btn-rel-add')) $('btn-rel-add').addEventListener('click', function () { addRelation(); });
    if ($('rel-type')) $('rel-type').addEventListener('change', updateRelLabels);
    $('f-save').addEventListener('click', saveCat);
    // 实时校验：必填项一变就重新提示
    REQUIRED_CAT_FORM.forEach(function (r) {
      var el = $(r.id);
      if (!el) return;
      el.addEventListener('input', validateCatForm);
      el.addEventListener('change', validateCatForm);
    });
    $('f-cancel').addEventListener('click', function () { closeModal('cat-modal'); setPasteMode(0); });
    $('cat-close').addEventListener('click', function () { closeModal('cat-modal'); });
    $('f-del').addEventListener('click', function () {
      if (editIdx < 0) { closeModal('cat-modal'); return; }
      if (!confirm('确定删除「' + cats[editIdx].name + '」？')) return;
      cats.splice(editIdx, 1);
      saveAll();
      closeModal('cat-modal');
      renderCats();
    });
    $('btn-avatar').addEventListener('click', function () { $('f-avatar').click(); });
    $('f-avatar').addEventListener('change', onAvatarChange);
    $('btn-album-add').addEventListener('click', function () { $('f-album').click(); });
    $('btn-story-add').addEventListener('click', function () {
      if (!dirHandle) { log('❌ 请先选择项目文件夹', 'err'); return; }
      _pendingStories.push({ id: 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), title: '', content: '', images: [], cats: (editIdx >= 0 && cats[editIdx]) ? [cats[editIdx].id] : [] });
      refreshStories();
    });
    $('f-story-img').addEventListener('change', onStoryImgChange);
    $('btn-event-add').addEventListener('click', function () {
      if (!dirHandle) { log('❌ 请先选择项目文件夹', 'err'); return; }
      _pendingEvents.push({ date: '', text: '', images: [] });
      refreshEvents();
    });
    $('f-event-img').addEventListener('change', onEventImgChange);

    // 粘贴截图按钮：循环 0→头像→相册→0
    $('btn-paste').addEventListener('click', function () {
      if (!$('cat-modal').classList.contains('open')) {
        log('❌ 请先打开一只猫的编辑弹窗', 'err');
        return;
      }
      if (pasteTarget === 0) setPasteMode(1);
      else if (pasteTarget === 1) setPasteMode(2);
      else setPasteMode(0);
    });

    // 全局监听 Ctrl+V
    document.addEventListener('paste', function (e) {
      if (pasteTarget === 0) return;
      if (!$('cat-modal').classList.contains('open')) { log('❌ 请先打开一只猫的编辑弹窗', 'err'); return; }
      var items = (e.clipboardData || window.clipboardData).items || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && items[i].type.indexOf('image') === 0) {
          handlePastedImage(items[i].getAsFile());
          e.preventDefault();
          return;
        }
      }
      log('❌ 剪贴板里没图片（先截图再用 Ctrl+V）', 'err');
    });
    $('f-album').addEventListener('change', onAlbumAdd);
    $('crop-ok').addEventListener('click', confirmCrop);
    $('crop-cancel').addEventListener('click', cancelCrop);
    $('crop-close').addEventListener('click', cancelCrop);
    $('cat-modal').addEventListener('click', function (e) { if (e.target === $('cat-modal')) closeModal('cat-modal'); });
    $('crop-modal').addEventListener('click', function (e) { if (e.target === $('crop-modal')) cancelCrop(); });
  }

  bind();
  ensureMap();
  autoConnect();
})();