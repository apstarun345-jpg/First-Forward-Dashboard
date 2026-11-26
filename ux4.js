/* v3.125.453 — ux4: Live ticker (sirf admin / barcodeChecker permission). Data: /api/robot/feed (khabrein) + /api/scan-log?limit=12 (employee scans).
   ✕ se aaj ke liye band; html.ff-no-anim me patti chalti nahi, ek-ek khabar badalti hai. */
(function (W) {
  'use strict';
  const D = document, H = D.documentElement;
  W.FF = W.FF || {};
  const KEY = 'ff_ticker_off';
  const today = () => new Date(Date.now() + 19800e3).toISOString().slice(0, 10);
  const hidden = () => { try { return localStorage.getItem(KEY) === today(); } catch { return false; } };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let el = null, rotN = 0, news = [], scans = [], timer = 0, rot = 0, denyFeed = false, denyScan = false, lastKey = '';

  const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - t) / 60e3)); return m < 1 ? 'abhi' : m < 60 ? `${m} min pehle` : `${Math.round(m / 60)} ghante pehle`; };
  function items() {
    const sc = scans.map((s) => ({ html: `📷 <b>${esc(s.name)}</b> ne barcode scan kiya · ${esc(ago(s.t))}`, fresh: Date.now() - s.t < 3 * 60e3 }));
    const nw = news.map((n) => ({ html: n }));
    const out = []; const a = sc.slice(0, 6), b = nw;
    for (let i = 0; i < Math.max(a.length, b.length); i++) { if (b[i]) out.push(b[i]); if (a[i]) out.push(a[i]); }
    return out;
  }
  function paint() {
    if (!el) return;
    const L = items(); const vp = el.querySelector('.vp');
    if (!L.length) { vp.innerHTML = '<span class="it">Live khabrein aa rahi hain…</span>'; return; }
    const noAnim = H.classList.contains('ff-no-anim');
    const html = L.map((x, i) => `<span class="it${x.fresh ? ' new' : ''}${noAnim && i === rotN % L.length ? ' cur' : ''}">${x.html}</span>`).join('');
    const sig = L.map((x) => x.html).join('|') + noAnim + (noAnim ? rotN % L.length : '');
    if (sig === lastKey) return; lastKey = sig;
    vp.innerHTML = noAnim ? html : `<div class="tr" style="--dur:${Math.max(40, Math.round(L.reduce((a, x) => a + x.html.length, 0) * 0.32))}s">${html}${html}</div>`;
  }
  async function api(path) {
    const a = W.FF.auth && W.FF.auth.api; if (!a) return null;
    return a(path);
  }
  async function pull() {
    if (D.hidden || !el) return;
    if (!denyFeed) {
      try {
        const r = await api('/api/robot/feed');
        if (r && Array.isArray(r.items)) news = r.items.filter((x) => x && x.title && !/^srv:todo/.test(String(x.key || ''))).slice(0, 18).map((x) => {
          const t = String(x.title).replace(/^🤖\s*/, ''); const line = String(x.body || '').split('\n').filter(Boolean)[0] || '';
          return `<b>${esc(t)}</b>${line ? ' · ' + esc(line.replace(/^•\s*/, '').slice(0, 90)) : ''}`;
        });
      } catch (e) { if (/403|admin|access/i.test(String(e && e.message))) denyFeed = true; }
    }
    if (news.length < 8) {   // server ki list khaali (restart ke baad) → robot ki aaj ki history se bharo
      try {
        const h = (W.FF.mascot && W.FF.mascot.history && W.FF.mascot.history()) || [];
        const have = new Set(news);
        h.slice(0, 14).forEach((x) => { if (!x || !x.title) return; const s = `<b>${esc(String(x.icon || '') + ' ' + String(x.title).replace(/^🤖\s*/, ''))}</b>${x.head ? ' · ' + esc(String(x.head).slice(0, 90)) : ''}`; if (!have.has(s)) news.push(s); });
      } catch { /* optional */ }
    }
    if (!denyScan) {
      try {
        const r = await api('/api/scan-log?limit=12');
        if (r && Array.isArray(r.rows)) scans = r.rows.filter((x) => x.name && Date.parse(x.at)).map((x) => ({ name: x.name, t: Date.parse(x.at) })).filter((x) => Date.now() - x.t < 6 * 3600e3);
      } catch (e) { if (/403|access/i.test(String(e && e.message))) denyScan = true; }
    }
    if (denyFeed && denyScan) { stop(); return; }
    lastKey = ''; paint();
  }
  function setTop() { const t = D.querySelector('.topbar'); if (t && el) H.style.setProperty('--ux4-top', t.offsetHeight + 'px'); }
  function stop() { clearInterval(timer); clearInterval(rot); if (el) { el.remove(); el = null; } }
  function start() {
    if (el || hidden()) return;
    const bar = D.querySelector('.content > .topbar'); if (!bar) return;
    el = D.createElement('div'); el.id = 'ux4-tick'; el.setAttribute('role', 'marquee'); el.setAttribute('aria-label', 'Live khabrein');
    el.innerHTML = '<div class="lv"><i></i><span>LIVE</span></div><div class="vp"><span class="it">Live khabrein aa rahi hain…</span></div><button class="x" type="button" title="Aaj ke liye band">✕</button>';
    bar.after(el); setTop(); W.addEventListener('resize', setTop);
    // v3.125.522 — topbar ki height load/font/icon ke baad badalti hai; ticker ka top hamesha live topbar ke neeche rahe.
    try { if (W.ResizeObserver && !el.__ro) { el.__ro = new W.ResizeObserver(setTop); el.__ro.observe(bar); } } catch { /* ok */ }
    el.querySelector('.x').addEventListener('click', () => { try { localStorage.setItem(KEY, today()); } catch { /* */ } stop(); });
    pull(); timer = setInterval(pull, 90e3);
    rot = setInterval(() => { if (H.classList.contains("ff-no-anim")) { rotN++; lastKey = ""; paint(); } }, 5000);
  }
  function wait(n) {
    const u = W.FF.auth && W.FF.auth.user;
    if (u && (u.role === 'admin' || (u.permissions || []).includes('barcodeChecker'))) { start(); return; }
    if (n > 40) return; setTimeout(() => wait(n + 1), 1500);
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', () => wait(0)); else wait(0);
  D.addEventListener('visibilitychange', () => { if (!D.hidden && el) pull(); });
  W.FF.ticker = { refresh: pull, hide: () => { try { localStorage.setItem(KEY, today()); } catch { /* */ } stop(); }, show: () => { try { localStorage.removeItem(KEY); } catch { /* */ } start(); } };
})(window);
