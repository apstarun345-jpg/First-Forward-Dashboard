/* v3.83 — KPI cards: same size in every row + auto-fit text.
   Har .kpi-grid (tablet/desktop, >=768px) me:
     1. sab cards ki natural height naapo, grid ki row height = median height (zyada-tar cards bina badlav fit),
     2. jo card zyada lamba hai (jaise "Expected in month", "Run Rate", "Today Highest Issued")
        uske content ko CSS zoom se itna chhota karo ki wahi height me poora aa jaye (min 60%).
   Phone (<768px) par kuch nahi badalta. Card ka design / colours / alignment same rehte hain. */
(function () {
  'use strict';
  var MQ = window.matchMedia ? window.matchMedia('(min-width: 768px)') : { matches: true };
  var MIN_ZOOM = 0.6, MIN_ROW = 120;
  var queued = false;

  function cardsOf(grid) {
    var out = [];
    for (var i = 0; i < grid.children.length; i++) {
      var el = grid.children[i];
      if (el.classList && el.classList.contains('kpi') && el.offsetParent !== null) out.push(el);
    }
    return out;
  }
  function inflow(card) {   // zoom sirf normal content par — absolute decorative rings/badges ko nahi
    var out = [];
    for (var i = 0; i < card.children.length; i++) {
      var c = card.children[i];
      var pos = window.getComputedStyle(c).position;
      if (pos !== 'absolute' && pos !== 'fixed') out.push(c);
    }
    return out;
  }
  function setZoom(card, z) {
    var kids = inflow(card);
    for (var i = 0; i < kids.length; i++) kids[i].style.zoom = z === 1 ? '' : String(z);
    card.dataset.kpiZoom = z === 1 ? '' : String(z);
  }
  function natural(card) {
    card.style.height = 'auto';
    card.style.alignSelf = 'start';
    var h = card.offsetHeight;
    card.style.height = '';
    card.style.alignSelf = '';
    return h;
  }
  function reset(grid) {
    grid.style.gridAutoRows = '';
    grid.classList.remove('kpi-fit');
    cardsOf(grid).forEach(function (c) { setZoom(c, 1); });
  }
  function fitGrid(grid) {
    var cards = cardsOf(grid);
    if (cards.length < 2) { reset(grid); return; }
    cards.forEach(function (c) { setZoom(c, 1); });
    grid.classList.remove('kpi-fit');
    grid.style.gridAutoRows = '';
    var hs = cards.map(natural);
    var sorted = hs.slice().sort(function (a, b) { return a - b; });
    // row = median height, par itni zaroor ki sabse lamba card bhi MIN_ZOOM par bina kate aa jaye
    var row = Math.ceil(Math.max(MIN_ROW, sorted[Math.floor((sorted.length - 1) / 2)], sorted[sorted.length - 1] * MIN_ZOOM));
    grid.style.gridAutoRows = row + 'px';
    grid.classList.add('kpi-fit');
    cards.forEach(function (card, i) {
      var h = hs[i];
      if (h <= row + 1) return;
      var z = 1;
      for (var k = 0; k < 4 && h > row + 1; k++) {
        z = Math.max(MIN_ZOOM, Math.floor(z * (row / h) * 100) / 100);
        setZoom(card, z);
        h = natural(card);
        if (z === MIN_ZOOM) break;
      }
    });
  }
  function fitAll() {
    queued = false;
    var grids = document.querySelectorAll('.kpi-grid');
    for (var i = 0; i < grids.length; i++) {
      try { if (MQ.matches) fitGrid(grids[i]); else reset(grids[i]); } catch (e) { /* ek grid fail ho to baaki chalein */ }
    }
  }
  function queue() {
    if (queued) return;
    queued = true;
    (window.requestAnimationFrame || setTimeout)(function () { setTimeout(fitAll, 30); });
  }
  function start() {
    queue();
    try {
      new MutationObserver(function (list) {
        for (var i = 0; i < list.length; i++) {
          var t = list[i].target;
          var el = t && t.nodeType === 1 ? t : (t && t.parentElement);
          if (el && el.closest && (el.closest('.kpi-grid') || el.querySelector && el.querySelector('.kpi-grid'))) { queue(); return; }
        }
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    } catch (e) { /* old browser */ }
    window.addEventListener('resize', queue);
    if (MQ.addEventListener) MQ.addEventListener('change', queue);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(queue);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.FF = window.FF || {};
  window.FF.kpiFit = { refit: queue };
})();
