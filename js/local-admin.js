// local-admin.js — 本地文件管理端（浏览器直接读写本地项目文件夹）
(function () {
  'use strict';

  var CATS_PATH = 'data/cats.json';
  var RELS_PATH = 'data/relations.json';
  var IMAGES_DIR = 'images';

  var dirHandle = null;
  var cats = [];
  var relations = [];
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
      var isMissingAny = isMissing || isMissingOld;
      var color = c.leftAt ? '#9ca3af' : (isMissingAny ? '#dc2626' : (isAdopted ? '#10b981' : (c.gender === 'male' ? '#3b82f6' : (c.gender === 'female' ? '#ec4899' : '#9ca3af'))));
      var size = isMissing ? 32 : (isMissingOld ? 28 : 24);
      var pulse = isMissing ? 'animation:cat-missing-pulse 1.5s infinite;' : '';
      var icon = L.divIcon({
        className: '',
        html: '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + color + ';border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);' + pulse + '"></div>',
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
    renderCats();
    ensureMap();
    renderMarkers();
  }

  async function saveAll() {
    if (!dirHandle) { log('❌ 请先选择项目文件夹', 'err'); return; }
    try {
      await writeTextFile(CATS_PATH, JSON.stringify(cats, null, 2) + '\n');
      await writeTextFile(RELS_PATH, JSON.stringify(relations, null, 2) + '\n');
      log('✅ 已保存到本地文件', 'ok');
    } catch (e) {
      log('❌ 保存失败：' + e.message, 'err');
    }
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
    if (!cats.length) { box.innerHTML = '<p class="hint">还没有猫咪，点右上角「添加猫咪」。</p>'; return; }
    box.innerHTML = cats.map(function (c, i) {
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
        '<div class="th"><img src="' + photo + '" alt="" onerror="this.style.display=\'none\'">' + fallback + '</div>' +
        '<div class="bd">' +
        '<div class="nm">' + esc(c.name) + (c.nickname ? '<span class="nick">（' + esc(c.nickname) + '）</span>' : '') + past + statusBadge(c) + '</div>' +
        '<div class="meta">' + (c.gender === 'male' ? '公' : (c.gender === 'female' ? '母' : '未知')) + ' · 绝育:' + esc(c.status || '未知') + ' · ' + esc(c.life || '在校') + ' · 📍 ' + esc(c.area || '') + '</div>' +
        '<div class="meta">' + (c.firstSeen ? '出现于 ' + c.firstSeen : '') + '</div>' +
        '<div class="ops"><button class="btn btn-sm" data-edit="' + i + '">编辑</button>' +
        '<button class="btn btn-sm btn-danger" data-del="' + i + '">删除</button></div>' +
        '</div></div>';
    }).join('');
    box.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () { openCatModal(Number(b.dataset.edit)); });
    });
    box.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!confirm('确定删除「' + cats[Number(b.dataset.del)].name + '」？')) return;
        cats.splice(Number(b.dataset.del), 1);
        renderCats();
        log('🗑️ 已删除猫咪', 'info');
      });
    });
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
    $('f-gender').value = c ? (c.gender || '') : '';
    $('f-color').value = c ? (c.color || '') : '';
    $('f-area').value = c ? (c.area || '') : '';
    $('f-status').value = c ? (c.status || '') : '';
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
    if (map && c) {
      pendingLatLng = { lat: c.lat, lng: c.lng };
      moveTempMarker(pendingLatLng);
    }
    var statusBanner = '';
    if (c) {
      if (c.life === '失踪') statusBanner = '<div style="background:#dc2626;color:#fff;padding:10px 14px;border-radius:10px;margin-bottom:10px;font-weight:600;">⚠️ 这只猫失踪了！如果你见过它，请尽快联系猫协（抖音/小红书/B 站搜「这里油只喵」）。任何线索都可能是它回家的希望。</div>';
      else if (c.life === '失踪已久') statusBanner = '<div style="background:#9f1239;color:#fff;padding:10px 14px;border-radius:10px;margin-bottom:10px;font-weight:600;">⚠️ 这只猫已失踪很久了。若你还见过它，请给猫协留言（抖音/小红书/B 站「这里油只喵」），任何线索都很宝贵。</div>';
      else if (c.life === '已领养') statusBanner = '<div style="background:#10b981;color:#fff;padding:8px 14px;border-radius:10px;margin-bottom:10px;">🏠 这只猫已被领养，开启新生活啦～</div>';
    }
    var banner = $('cat-status-banner');
    if (banner) { banner.innerHTML = statusBanner; banner.style.display = statusBanner ? '' : 'none'; }
    openModal('cat-modal');
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
      var ext = (f.name.split('.').pop() || 'jpg').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'jpg';
      var name = c.id + '_album_' + Date.now() + '_' + i + '.' + ext;
      var path = IMAGES_DIR + '/' + name;
      await writeImageFile(path, dataUrl);
      c.album.push(path);
      log('✅ 已添加相册照片：' + path, 'ok');
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
        var ext = (file.name.split('.').pop() || 'png').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'png';
        var name = c.id + '_album_' + Date.now() + '.' + ext;
        var path = IMAGES_DIR + '/' + name;
        await writeImageFile(path, dataUrl);
        c.album.push(path);
        renderAlbum(c.album);
        log('📋 已粘贴截图到相册：' + path, 'ok');
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
  async function saveCat() {
    if (!dirHandle) { log('❌ 请先选择项目文件夹', 'err'); return; }
    var name = $('f-name').value.trim();
    var lat = parseFloat($('f-lat').value);
    var lng = parseFloat($('f-lng').value);
    if (!name || isNaN(lat) || isNaN(lng)) { log('❌ 名字、纬度、经度必填', 'err'); return; }
    var isAdd = editIdx < 0;
    var id = isAdd ? nextId() : cats[editIdx].id;
    var photo = isAdd ? 'images/placeholder.svg' : (cats[editIdx].photo || 'images/placeholder.svg');

    if (pendingAvatar) {
      var ext = (pendingAvatarName.split('.').pop() || 'jpg').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'jpg';
      var path = IMAGES_DIR + '/' + id + '.' + ext;
      await writeImageFile(path, pendingAvatar);
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
      age: $('f-age').value.trim()
    };
    if (isAdd) cats.push(cat); else cats[editIdx] = cat;
    await saveAll();
    closeModal('cat-modal');
    renderCats();
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
  async function pushToGitHub() {
    if (!dirHandle) { log('❌ 请先选择项目文件夹', 'err'); return; }
    var repo = $('cfg-repo').value.trim();
    var branch = $('cfg-branch').value.trim() || 'main';
    var token = $('cfg-token').value.trim();
    if (!repo) { try { var c = JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); if (c.repo) { $('cfg-repo').value = c.repo; repo = c.repo; } if (c.token) { $('cfg-token').value = c.token; token = c.token; } if (c.branch) { $('cfg-branch').value = c.branch; branch = c.branch; } } catch (e) {} }
    if (!repo) { log('❌ 请先填写仓库名（如 ly-ly-666/campus-cats）', 'err'); return; }
    if (!token) { log('❌ 请填写 Token', 'err'); return; }

    log('⏳ 开始推送到 GitHub…', 'info');
    try {
      var q = '?ref=' + encodeURIComponent(branch);
      // 获取当前 sha（如果存在）
      var catsSha = await getFileSha(repo, branch, CATS_PATH, token);
      var relsSha = await getFileSha(repo, branch, RELS_PATH, token);

      // 推送 JSON（GitHub 要求 content 是二进制的 base64 编码）
      var catsText = await readTextFile(CATS_PATH);
      var relsText = await readTextFile(RELS_PATH);
      await githubPut(repo, branch, CATS_PATH, utf8ToB64(catsText), token, catsSha);
      await githubPut(repo, branch, RELS_PATH, utf8ToB64(relsText), token, relsSha);

      // 推送图片
      for (var i = 0; i < cats.length; i++) {
        var c = cats[i];
        var photos = [c.photo].concat(c.album || []).filter(function (p) { return p && p.indexOf('placeholder') < 0; });
        for (var j = 0; j < photos.length; j++) {
          var path = photos[j];
          if (await fileExists(path)) {
            var dataUrl = await readImageAsDataURL(path);
            var sha = await getFileSha(repo, branch, path, token);
            await githubPut(repo, branch, path, dataUrlToBase64(dataUrl), token, sha);
          }
        }
      }
      log('✅ 已全部推送到 GitHub，公开站点将自动更新', 'ok');
    } catch (e) {
      log('❌ 推送失败：' + e.message, 'err');
    }
  }

  async function getFileSha(repo, branch, path, token) {
    try {
      var res = await fetch('https://api.github.com/repos/' + repo + '/contents/' + path + '?ref=' + encodeURIComponent(branch), {
        headers: { 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' }
      });
      if (!res.ok) return null;
      var j = await res.json();
      return j.sha || null;
    } catch (e) { return null; }
  }

  async function githubPut(repo, branch, path, content, token, sha) {
    // content 已经是 GitHub API 要求的 base64 编码的二进制内容（由 dataUrlToBase64 或 utf8ToB64 处理过）
    var body = {
      message: 'data: 本地管理端更新 ' + path,
      content: content,
      branch: branch
    };
    if (sha) body.sha = sha;
    var res = await fetch('https://api.github.com/repos/' + repo + '/contents/' + path, {
      method: 'PUT',
      headers: { 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      var j = await res.json().catch(function () { return {}; });
      throw new Error(path + ' -> ' + (j.message || res.status));
    }
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
    $('f-save').addEventListener('click', saveCat);
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