// lightbox.js — 通用图片放大查看器（桌面 + 手机）
// 点击头像 / 相册图 / 事件截图 / 故事图都会用它，保证图片始终在可视范围内居中显示。
// 性能：先立即显示已缓存的缩略图（秒开），原图后台加载完成后淡入替换，避免"点开黑屏等待"。

export function openLightbox(src, caption, thumbSrc) {
  if (!src) return;
  let box = document.getElementById('lightbox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'lightbox';
    box.className = 'lightbox';
    box.innerHTML = '<div class="lightbox-backdrop"></div><div class="lightbox-body"><button class="lightbox-close" aria-label="关闭">×</button><div class="lightbox-loading"><span></span></div><img class="lightbox-img" alt=""><div class="lightbox-caption"></div></div>';
    document.body.appendChild(box);
  }
  const img = box.querySelector('.lightbox-img');
  const loadEl = box.querySelector('.lightbox-loading');
  // 不把小图放得比原始尺寸大；用 visualViewport 取真实可视区域（手机浏览器地址栏会改变 innerHeight）
  const fit = () => {
    if (!img.naturalWidth || !img.naturalHeight) return;
    const vv = (window.visualViewport && window.visualViewport.width) ? window.visualViewport : window;
    const vw = vv.width * 0.92;
    const vh = vv.height * 0.84;
    img.style.maxWidth = Math.min(vw, img.naturalWidth) + 'px';
    img.style.maxHeight = Math.min(vh, img.naturalHeight) + 'px';
  };
  const isFull = !thumbSrc || thumbSrc === src;
  loadEl.style.display = isFull ? 'none' : 'flex';
  img.style.opacity = 0;
  // 1) 先显示缩略图（通常已缓存，立即出现）
  img.onload = () => { img.style.opacity = 1; fit(); };
  img.src = thumbSrc || src;
  if (img.complete && img.naturalWidth) img.onload();
  // 2) 原图后台加载完成后淡入替换
  if (!isFull) {
    const full = new Image();
    full.onload = () => {
      img.src = src;
      loadEl.style.display = 'none';
      fit();
    };
    full.onerror = () => { loadEl.style.display = 'none'; };
    full.src = src;
  }
  const cap = box.querySelector('.lightbox-caption');
  cap.textContent = caption || '';
  cap.style.display = caption ? '' : 'none';
  box.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  var box = document.getElementById('lightbox');
  if (!box) return;
  box.classList.remove('open');
  document.body.style.overflow = '';
}

export function initLightbox() {
  document.addEventListener('click', function (e) {
    if (e.target.closest('.lightbox-backdrop') || e.target.closest('.lightbox-close')) closeLightbox();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeLightbox();
  });
}
