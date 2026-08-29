// lightbox.js — 通用图片放大查看器（桌面 + 手机）
// 点击头像 / 相册图 / 事件截图 / 故事图都会用它，保证图片始终在可视范围内居中显示

export function openLightbox(src, caption) {
  if (!src) return;
  let box = document.getElementById('lightbox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'lightbox';
    box.className = 'lightbox';
    box.innerHTML = '<div class="lightbox-backdrop"></div><div class="lightbox-body"><button class="lightbox-close" aria-label="关闭">×</button><img class="lightbox-img" alt=""><div class="lightbox-caption"></div></div>';
    document.body.appendChild(box);
  }
  const img = box.querySelector('.lightbox-img');
  // 不把小图放得比原始尺寸大；用 visualViewport 取真实可视区域（手机浏览器地址栏会改变 innerHeight）
  const fit = () => {
    if (!img.naturalWidth || !img.naturalHeight) return;
    const vv = (window.visualViewport && window.visualViewport.width) ? window.visualViewport : window;
    const vw = vv.width * 0.92;
    const vh = vv.height * 0.84;
    img.style.maxWidth = Math.min(vw, img.naturalWidth) + 'px';
    img.style.maxHeight = Math.min(vh, img.naturalHeight) + 'px';
  };
  img.onload = fit;
  img.src = src;
  if (img.complete && img.naturalWidth) fit();
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
