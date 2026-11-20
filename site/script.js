// VaultDeck 官网脚本：主题切换 + 进场显现。
// 刻意保持零依赖：不监听 scroll 事件，显现用 IntersectionObserver。

(function () {
  'use strict';

  var root = document.documentElement;
  var toggle = document.getElementById('themeToggle');

  // ---------- 主题 ----------
  // 按钮文案 = 点击后将切过去的主题，与产品顶栏「深色 / 浅色」按钮一致。
  function paintToggle() {
    if (!toggle) return;
    toggle.textContent = root.dataset.theme === 'dark' ? '浅色' : '深色';
  }

  if (toggle) {
    paintToggle();
    toggle.addEventListener('click', function () {
      var next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('vd-theme', next); } catch { /* 隐私模式下存不了就算了 */ }
      paintToggle();
    });
  }

  // ---------- 进场显现 ----------
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var targets = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

  if (reduced || !('IntersectionObserver' in window)) {
    targets.forEach(function (el) { el.classList.add('in'); });
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

  targets.forEach(function (el) { io.observe(el); });
})();
