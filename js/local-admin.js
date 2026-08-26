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

  function $(id) { return document.getElementById(id); }
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
      await loadProject();
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
  function renderCats() {
    var box = $('cats-list');
    if (!cats.length) { box.innerHTML = '<p class="hint">还没有猫咪，点右上角「添加猫咪」。</p>'; return; }
    box.innerHTML = cats.map(function (c, i) {
      var photo = c.photo || 'images/placeholder.svg';
      var fallback = photo.indexOf('placeholder') >= 0 ? '' : '<span class="fallback">🐱</span>';
      var past = c.leftAt ? '<span style="color:#9ca3af">（过往）</span>' : '';
      return '<div class="catcard">' +
        '<div class="th"><img src="' + photo + '" alt="" onerror="this.style.display=\'none\'">' + fallback + '</div>' +
        '<div class="bd">' +
        '<div class="nm">' + esc(c.name) + (c.nickname ? '<span class="nick">（' + esc(c.nickname) + '）</span>' : '') + past + '</div>' +
        '<div class="meta">' + (c.gender === 'male' ? '公' : '母') + ' · ' + esc(c.status || '') + ' · 📍 ' + esc(c.area || '') + '</div>' +
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
    $('f-gender').value = c ? (c.gender || 'male') : 'male';
    $('f-color').value = c ? (c.color || '') : '';
    $('f-area').value = c ? (c.area || '') : '';
    $('f-status').value = c ? (c.status || '未绝育') : '未绝育';
    $('f-lat').value = c ? c.lat : '';
    $('f-lng').value = c ? c.lng : '';
    $('f-firstSeen').value = c ? (c.firstSeen || '') : '';
    $('f-leftAt').value = c ? (c.leftAt || '') : '';
    $('f-caretaker').value = c ? (c.caretaker || '') : '';
    $('f-desc').value = c ? (c.description || '') : '';
    $('f-story').value = c ? (c.story || '') : '';
    $('f-tags').value = c ? ((c.tags || []).join(', ')) : '';
    if (c && c.photo) { $('f-preview').src = c.photo; $('f-preview').classList.add('show'); }
    else { $('f-preview').src = ''; $('f-preview').classList.remove('show'); }
    pendingAvatar = null; pendingAvatarName = '';
    renderAlbum(c ? c.album : []);
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
      tags: $('f-tags').value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(function (s) { return s; }),
      status: $('f-status').value,
      firstSeen: $('f-firstSeen').value.trim() || currentMonth(),
      leftAt: $('f-leftAt').value.trim(),
      caretaker: $('f-caretaker').value.trim()
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

  // ---------- GitHub 推送 ----------
  async function pushToGitHub() {
    if (!dirHandle) { log('❌ 请先选择项目文件夹', 'err'); return; }
    var repo = $('cfg-repo').value.trim();
    var branch = $('cfg-branch').value.trim() || 'main';
    var token = $('cfg-token').value.trim();
    if (!repo || !token) { log('❌ 请填写仓库名和 Token', 'err'); return; }

    log('⏳ 开始推送到 GitHub…', 'info');
    try {
      var q = '?ref=' + encodeURIComponent(branch);
      // 获取当前 sha（如果存在）
      var catsSha = await getFileSha(repo, branch, CATS_PATH, token);
      var relsSha = await getFileSha(repo, branch, RELS_PATH, token);

      // 推送 JSON
      var catsText = await readTextFile(CATS_PATH);
      var relsText = await readTextFile(RELS_PATH);
      await githubPut(repo, branch, CATS_PATH, catsText, token, catsSha);
      await githubPut(repo, branch, RELS_PATH, relsText, token, relsSha);

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
    var body = {
      message: 'data: 本地管理端更新 ' + path,
      content: (typeof content === 'string' && content.indexOf('data:image') === 0) ? content.split(',')[1] : btoa(unescape(encodeURIComponent(content))),
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
    return dataUrl.split(',')[1];
  }

  // ---------- 事件绑定 ----------
  function bind() {
    $('btn-pick').addEventListener('click', pickFolder);
    $('btn-save-all').addEventListener('click', saveAll);
    $('btn-push').addEventListener('click', pushToGitHub);
    $('btn-add').addEventListener('click', function () { openCatModal(-1); });
    $('f-save').addEventListener('click', saveCat);
    $('f-cancel').addEventListener('click', function () { closeModal('cat-modal'); });
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
    $('f-album').addEventListener('change', onAlbumAdd);
    $('crop-ok').addEventListener('click', confirmCrop);
    $('crop-cancel').addEventListener('click', cancelCrop);
    $('crop-close').addEventListener('click', cancelCrop);
    $('cat-modal').addEventListener('click', function (e) { if (e.target === $('cat-modal')) closeModal('cat-modal'); });
    $('crop-modal').addEventListener('click', function (e) { if (e.target === $('crop-modal')) cancelCrop(); });
  }

  bind();
  log('👋 请先选择项目文件夹，然后就可以编辑猫咪和相册了', 'info');
})();