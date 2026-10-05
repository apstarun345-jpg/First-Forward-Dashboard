/* 📺 TV Mode — office TV / big screen ke liye: Dashboard → Trend → Stock slide-wise rotation.
   Har 30s ek slide, page data har 5 min full refresh, fullscreen button + clock.
   Feature: Settings → 🎛 Features → TV mode (default ON). */
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;
  // Permission login ke baad milta hai — isliye slots render ke time filter hote hain.
  const slotsOf = () => [
    { id: 'dashboard', icon: '📊', label: 'Dashboard' },
    { id: 'trend', icon: '📈', label: 'Trend' },
    { id: 'stock', icon: '📦', label: 'Stock' },
    { id: 'targets', icon: '🎯', label: 'Targets' }
  ].filter((s) => FF.auth.can(s.id));
  const ROTATE_MS = 30000;   // slide rotation
  const REFRESH_MS = 300000; // data refresh (5 min)
  let rotateTimer = null;
  let refreshTimer = null;
  let clockTimer = null;

  function clearAll() {
    if (rotateTimer) { clearInterval(rotateTimer); rotateTimer = null; }
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  }

  function baseUrl() { return location.pathname + location.search; }
  function load(frame, id) { if (frame) frame.src = baseUrl() + '#/' + id; }

  function tickClock() {
    const el = document.getElementById('tv-clock');
    if (!el) { if (clockTimer) { clearInterval(clockTimer); clockTimer = null; } return; }
    const d = new Date();
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
    el.textContent = `${day} ${d.toLocaleDateString('en-GB')} · ${d.toLocaleTimeString('en-GB')}`;
  }

  async function render(root) {
    clearAll();
    const slots = slotsOf().length ? slotsOf() : [{ id: 'dashboard', icon: '📊', label: 'Dashboard' }];
    let slot = 0;
    root.innerHTML = `
      <div class="tv-wrap" id="tv-root">
        <div class="tv-bar">
          <div class="tv-tabs" id="tv-tabs">${slots.map((s, i) => `<button class="tv-tab ${i === 0 ? 'on' : ''}" data-i="${i}">${s.icon} ${esc(s.label)}</button>`).join('')}</div>
          <div class="tv-meta"><span class="tv-brand">${esc(FF.config.brand || 'TV')}</span><span class="tv-clock" id="tv-clock">--:--:--</span>
          <button class="icon-btn" id="tv-fs" title="Fullscreen (F)">⛶</button></div>
        </div>
        <div class="tv-stage"><iframe id="tv-frame" class="tv-frame" title="TV slide" src="${baseUrl()}#/dashboard"></iframe></div>
        <div class="tv-foot"><span>🔄 Slide har ${ROTATE_MS / 1000}s</span><span>♻️ Data har ${REFRESH_MS / 60000} min</span><span>Press <b>F</b> = fullscreen · clicks TV me kaam karte hain</span></div>
      </div>`;
    const frame = U.$('#tv-frame', root);
    const tabsEl = U.$('#tv-tabs', root);
    const show = (i) => {
      slot = (i + slots.length) % slots.length;
      tabsEl.querySelectorAll('.tv-tab').forEach((b, bi) => b.classList.toggle('on', bi === slot));
      load(frame, slots[slot].id);
    };
    tabsEl.addEventListener('click', (e) => {
      const b = e.target.closest('.tv-tab'); if (!b) return;
      show(Number(b.dataset.i));
      if (rotateTimer) { clearInterval(rotateTimer); rotateTimer = setInterval(() => show(slot + 1), ROTATE_MS); }
    });
    U.$('#tv-fs', root).addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen && document.exitFullscreen();
      else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
    });
    const onKey = (e) => { if ((e.key === 'f' || e.key === 'F') && document.getElementById('tv-root')) { document.getElementById('tv-fs').click(); } };
    document.removeEventListener('keydown', onKey); document.addEventListener('keydown', onKey);
    tickClock();
    clockTimer = setInterval(tickClock, 1000);
    rotateTimer = setInterval(() => show(slot + 1), ROTATE_MS);
    refreshTimer = setInterval(() => load(frame, slots[slot].id), REFRESH_MS);
  }

  FF.pages.tv = { title: 'TV Mode', render, unmount: clearAll };
})(window.FF);
