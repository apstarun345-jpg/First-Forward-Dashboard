/* 📖 Story mode (v218) — subah ka summary Instagram-story jaisa: full screen, upar progress bars,
   khud aage badhta hai (5.5 s), right tap = aage · left tap = peeche · daba ke rakho = ruko · neeche swipe / ✕ = band.
   Slides: Kal ka issuance · MTD + projection · Top agents · Low stock TLs · Purana stock (6M+) · Aaj expected.
   Data: morningCard ke wahi helpers (koi extra sheet download nahi). Mobile par din me ek baar khud khulta hai
   (Home khulte hi, data aane ke baad) — last slide se band kar sakte ho. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;
  const AUTO_KEY = 'ff_story_auto', SEEN_KEY = 'ff_story_seen';
  const DUR = 5500;
  const LS = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* private */ } } };
  const noAnim = () => document.documentElement.classList.contains('ff-no-anim') || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  const css = `
.ffs{position:fixed;inset:0;z-index:5000;background:#05070d;color:#fff;display:flex;align-items:center;justify-content:center;touch-action:none;user-select:none;-webkit-user-select:none;animation:ffsIn .25s ease}
.ffs-frame{position:relative;width:min(100vw,460px);height:min(100dvh,860px);overflow:hidden;border-radius:0}
@media (min-width:600px){.ffs-frame{border-radius:22px;box-shadow:0 30px 80px rgba(0,0,0,.6)}}
.ffs-bars{position:absolute;top:calc(env(safe-area-inset-top,0px) + 10px);left:10px;right:10px;display:flex;gap:4px;z-index:3}
.ffs-bars i{flex:1;height:3px;border-radius:3px;background:rgba(255,255,255,.3);overflow:hidden}
.ffs-bars i b{display:block;height:100%;width:0;background:#fff}
.ffs-bars i.done b{width:100%}
.ffs-top{position:absolute;top:calc(env(safe-area-inset-top,0px) + 22px);left:14px;right:10px;display:flex;align-items:center;gap:8px;z-index:3;font-size:13px;font-weight:700}
.ffs-top img{width:30px;height:30px;border-radius:50%;background:#111;object-fit:contain}
.ffs-top span{opacity:.8;font-weight:500}
.ffs-x{margin-left:auto;background:none;border:0;color:#fff;font-size:26px;line-height:1;padding:4px 8px;cursor:pointer}
.ffs-slide{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:90px 26px 70px;gap:14px;opacity:0;transform:scale(1.03);transition:opacity .35s ease,transform .45s ease}
.ffs-slide.on{opacity:1;transform:none}
.ffs-k{font-size:13px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;opacity:.85}
.ffs-big{font-size:clamp(64px,22vw,104px);font-weight:900;line-height:1;letter-spacing:-.03em}
.ffs-sub{font-size:17px;font-weight:600;opacity:.92;line-height:1.45}
.ffs-pill{display:inline-block;padding:5px 12px;border-radius:99px;background:rgba(255,255,255,.18);font-weight:800;font-size:14px;margin-right:6px}
.ffs-list{display:grid;gap:10px;margin-top:6px}
.ffs-row{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:16px;background:rgba(255,255,255,.14);backdrop-filter:blur(6px);font-weight:700;font-size:16px;animation:ffsUp .5s ease both}
.ffs-row:nth-child(2){animation-delay:.12s}.ffs-row:nth-child(3){animation-delay:.24s}.ffs-row:nth-child(4){animation-delay:.36s}.ffs-row:nth-child(5){animation-delay:.48s}
.ffs-row em{font-style:normal;font-size:22px}
.ffs-row b{margin-left:auto;font-size:20px}
.ffs-split{display:flex;gap:10px}.ffs-split>div{flex:1;padding:12px;border-radius:16px;background:rgba(255,255,255,.14)}
.ffs-split small{display:block;opacity:.8;font-weight:700}.ffs-split b{font-size:28px}
.ffs-meter{height:12px;border-radius:99px;background:rgba(255,255,255,.2);overflow:hidden}.ffs-meter i{display:block;height:100%;width:0;border-radius:99px;background:#fff;transition:width 1.2s cubic-bezier(.2,.8,.2,1) .2s}
.ffs-slide.on .ffs-meter i{width:var(--w)}
.ffs-foot{position:absolute;bottom:calc(env(safe-area-inset-bottom,0px) + 16px);left:0;right:0;text-align:center;font-size:12px;opacity:.75;z-index:3}
.ffs-end{display:flex;flex-direction:column;gap:10px;margin-top:10px}
.ffs-end button{padding:13px;border-radius:14px;border:0;font-weight:800;font-size:15px;cursor:pointer}
.ffs-paused .ffs-bars i b{animation-play-state:paused!important}
@keyframes ffsIn{from{opacity:0}}@keyframes ffsUp{from{opacity:0;transform:translateY(14px)}}
@keyframes ffsBar{from{width:0}to{width:100%}}`;
  let styled = false;
  const ensureCss = () => { if (styled) return; styled = true; const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); };

  const BG = ['linear-gradient(160deg,#4f46e5,#7c3aed 55%,#db2777)', 'linear-gradient(160deg,#0ea5e9,#2563eb 60%,#1e1b4b)', 'linear-gradient(160deg,#f59e0b,#ea580c 55%,#9f1239)', 'linear-gradient(160deg,#ef4444,#b91c1c 55%,#450a0a)', 'linear-gradient(160deg,#64748b,#334155 55%,#0f172a)', 'linear-gradient(160deg,#10b981,#059669 55%,#064e3b)', 'linear-gradient(160deg,#111827,#1f2937)'];

  // ---- 📊 data ------------------------------------------------------------------------------------------
  async function gather() {
    if (FF.lazy && FF.lazy.shellNeed && !FF.morningCard) await FF.lazy.shellNeed(['morningCard']);
    const M = FF.morningCard;
    await Promise.allSettled([FF.store.need('daily'), FF.gv && FF.gv.need ? FF.gv.need('master') : null]);
    const out = { yest: M.yesterdayStats(), mtd: M.mtdStats(), top: [], risks: [], expect: null, old6: null };
    try { out.top = M.topAgents ? M.topAgents() : []; } catch { /* optional */ }
    try { out.expect = M.expectedToday(); } catch { /* optional */ }
    try { out.risks = M.risks ? await U.within(M.risks(), 4000, []) : []; } catch { /* optional */ }
    try {
      if (FF.stockAge) {
        await U.within(FF.stockAge.ready(), 3000, null);
        const n = FF.stockAge.nodeFor({ kind: 'all', key: 'all', ch: '' });
        if (n) out.old6 = { n: (n.counts.core[6] || 0) + (n.counts.comm[6] || 0), total: (n.total.core || 0) + (n.total.comm || 0) };
      }
    } catch { /* optional */ }
    return out;
  }
  const delta = (a, b) => { if (!b) return ''; const p = Math.round(((a - b) / b) * 100); return `<span class="ffs-pill">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}% vs previous day</span>`; };
  function slides(d) {
    const s = [];
    const ydate = new Date(); ydate.setDate(ydate.getDate() - 1);
    s.push(`<div class="ffs-k">☀️ Good morning · ${esc(new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }))}</div>
      <div class="ffs-sub">Yesterday's total issuance · ${esc(ydate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }))}</div><div class="ffs-big" data-ffs-count="${d.yest.yestTotal}">0</div>
      <div>${delta(d.yest.yestTotal, d.yest.prevTotal)}</div>
      <div class="ffs-split"><div><small>🟦 First Forward</small><b>${U.fmt(d.yest.yestFf)}</b></div><div><small>🟩 GV Partner</small><b>${U.fmt(d.yest.yestGv)}</b></div></div>`);
    const pct = d.mtd.daysInMonth ? Math.round((d.mtd.daysElapsed / d.mtd.daysInMonth) * 100) : 0;
    s.push(`<div class="ffs-k">📅 This month so far</div><div class="ffs-big" data-ffs-count="${d.mtd.total}">0</div>
      <div class="ffs-sub">FF ${U.fmt(d.mtd.ffTotal)} · GV ${U.fmt(d.mtd.gvTotal)}</div>
      <div class="ffs-sub">🎯 Month-end projection <b>${U.fmt(d.mtd.projected)}</b></div>
      <div class="ffs-meter" style="--w:${pct}%"><i></i></div><div class="ffs-sub" style="font-size:13px">${d.mtd.daysElapsed} / ${d.mtd.daysInMonth} days passed</div>`);
    if (d.top && d.top.length) {
      const medal = ['🥇', '🥈', '🥉'];
      s.push(`<div class="ffs-k">🏆 Top agents this month</div><div class="ffs-list">${d.top.map((a, i) => `<div class="ffs-row"><em>${medal[i] || '⭐'}</em><span>${esc(a.name)} <small style="opacity:.75">${esc(a.ch)}</small></span><b>${U.fmt(a.n)}</b></div>`).join('')}</div>`);
    }
    s.push(d.risks && d.risks.length
      ? `<div class="ffs-k">⚠️ Stock running out</div><div class="ffs-sub">VC4 stock of these TLs will last less than 7 days</div><div class="ffs-list">${d.risks.map((r) => `<div class="ffs-row"><em>🔻</em><span>${esc(r.name)}</span><b>~${U.fmt(Math.round(r.cover))} days</b></div>`).join('')}</div>`
      : `<div class="ffs-k" data-ffs-bg="5">✅ Stock is healthy</div><div class="ffs-big">👍</div><div class="ffs-sub">No TL has less than 7 days of VC4 stock.</div>`);
    if (d.old6 && d.old6.total) s.push(`<div class="ffs-k">🧓 Old stock</div><div class="ffs-big" data-ffs-count="${d.old6.n}">0</div><div class="ffs-sub">tags older than 6 months — <b>${Math.round((d.old6.n / d.old6.total) * 100)}%</b> of total stock ${U.fmt(d.old6.total)}</div><div class="ffs-meter" style="--w:${Math.min(100, Math.round((d.old6.n / d.old6.total) * 100))}%"><i></i></div>`);
    if (d.expect) s.push(`<div class="ffs-k">🔮 Today's estimate</div><div class="ffs-big" data-ffs-count="${d.expect}">0</div><div class="ffs-sub">GV — average of the last 4 same weekdays. Let's go! 💪</div>`);
    const auto = LS.get(AUTO_KEY) !== 'off';
    s.push(`<div class="ffs-k">✨ That's all</div><div class="ffs-big">🚀</div><div class="ffs-sub">Have a great day!</div>
      <div class="ffs-end"><button type="button" data-ffs-close style="background:#fff;color:#111">🏠 Go to Home</button>
      <button type="button" data-ffs-auto style="background:rgba(255,255,255,.16);color:#fff">${auto ? '🔕 Don\'t open automatically' : '🔔 Open automatically every morning'}</button></div>`);
    return s;
  }

  // ---- 🎬 player ----------------------------------------------------------------------------------------
  let open = null;
  function countUp(el) {
    const target = Number(el.dataset.ffsCount) || 0;
    if (noAnim() || target < 5) { el.textContent = U.fmt(target); return; }
    const t0 = performance.now(), dur = 900;
    const tick = (now) => { const k = Math.min(1, (now - t0) / dur); el.textContent = U.fmt(Math.round(target * (1 - Math.pow(1 - k, 3)))); if (k < 1 && el.isConnected) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  async function show() {
    if (open) return;
    ensureCss();
    const wrap = document.createElement('div');
    wrap.className = 'ffs'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-label', "Today's story");
    wrap.innerHTML = `<div class="ffs-frame" style="background:${BG[0]}"><div class="ffs-slide on" style="align-items:center;text-align:center"><div class="ffs-big">📖</div><div class="ffs-sub">Preparing today's story…</div></div></div>`;
    document.body.appendChild(wrap);
    document.body.classList.add('no-scroll');
    open = { wrap, i: 0, timer: 0, paused: false, left: DUR, started: 0 };
    let data;
    try { data = await gather(); } catch (err) { close(); U.toast('Story failed: ' + ((err && err.message) || err), 'err'); return; }
    if (!open) return;
    const list = slides(data);
    const frame = wrap.querySelector('.ffs-frame');
    frame.innerHTML = `<div class="ffs-bars">${list.map(() => '<i><b></b></i>').join('')}</div>
      <div class="ffs-top"><img src="icon-192.png" alt=""><b>ApnaPayment</b><span>· today's story</span><button type="button" class="ffs-x" data-ffs-close aria-label="Close">✕</button></div>
      ${list.map((h) => `<div class="ffs-slide">${h}</div>`).join('')}<div class="ffs-foot">tap → next · tap left ← back · hold = pause</div>`;
    open.n = list.length;
    go(0);
    bind(wrap);
  }
  function go(i) {
    const o = open; if (!o) return;
    if (i >= o.n) { close(); return; }
    o.i = Math.max(0, i);
    const frame = o.wrap.querySelector('.ffs-frame');
    frame.style.background = BG[o.i % BG.length];
    if (o.i === o.n - 1) frame.style.background = BG[BG.length - 1];
    const curS = o.wrap.querySelectorAll('.ffs-slide')[o.i]; const ov = curS && curS.querySelector('[data-ffs-bg]'); if (ov) frame.style.background = BG[Number(ov.dataset.ffsBg)];
    o.wrap.querySelectorAll('.ffs-slide').forEach((s, k) => s.classList.toggle('on', k === o.i));
    const cur = o.wrap.querySelectorAll('.ffs-slide')[o.i];
    if (cur) cur.querySelectorAll('[data-ffs-count]').forEach(countUp);
    o.wrap.querySelectorAll('.ffs-bars i').forEach((bar, k) => {
      bar.classList.toggle('done', k < o.i);
      const b = bar.firstElementChild;
      b.style.animation = 'none'; void b.offsetWidth;
      b.style.animation = k === o.i && o.i < o.n - 1 ? `ffsBar ${DUR}ms linear forwards` : '';
      if (k === o.i && o.i === o.n - 1) b.style.width = '100%';
    });
    clearTimeout(o.timer);
    o.left = DUR; o.started = Date.now();
    if (o.i < o.n - 1) o.timer = setTimeout(() => go(o.i + 1), DUR);   // aakhri slide khud band nahi hoti
  }
  function pause(on) {
    const o = open; if (!o || o.paused === on || o.i >= o.n - 1) return;
    o.paused = on;
    o.wrap.classList.toggle('ffs-paused', on);
    if (on) { clearTimeout(o.timer); o.left = Math.max(300, o.left - (Date.now() - o.started)); }
    else { o.started = Date.now(); o.timer = setTimeout(() => go(o.i + 1), o.left); }
  }
  function close() {
    if (!open) return;
    clearTimeout(open.timer);
    open.wrap.remove(); open = null;
    document.body.classList.remove('no-scroll');
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (!open) return; if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight' || e.key === ' ') go(open.i + 1); else if (e.key === 'ArrowLeft') go(open.i - 1); }
  function bind(wrap) {
    let downAt = 0, x0 = 0, y0 = 0, held = 0;
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      downAt = Date.now(); x0 = e.clientX; y0 = e.clientY;
      held = setTimeout(() => pause(true), 220);
    });
    wrap.addEventListener('pointerup', (e) => {
      clearTimeout(held);
      if (e.target.closest('button')) return;
      const wasHeld = open && open.paused;
      if (wasHeld) { pause(false); return; }
      if (e.clientY - y0 > 80 && Math.abs(e.clientX - x0) < 60) { close(); return; }   // neeche swipe = band
      if (Date.now() - downAt > 600) return;
      const r = wrap.querySelector('.ffs-frame').getBoundingClientRect();
      if (e.clientX - r.left < r.width * 0.3) go(open.i - 1); else go(open.i + 1);
    });
    wrap.addEventListener('pointercancel', () => { clearTimeout(held); pause(false); });
    wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-ffs-close]')) { close(); return; }
      const a = e.target.closest('[data-ffs-auto]');
      if (a) { const off = LS.get(AUTO_KEY) !== 'off'; LS.set(AUTO_KEY, off ? 'off' : 'on'); a.textContent = off ? '🔔 Open automatically every morning' : '🔕 Don\'t open automatically'; U.toast(off ? 'OK — story will not open automatically (use the 📖 Story button on Home)' : 'Story will open automatically every morning', 'ok'); }
    });
  }
  /** Mobile par din me ek baar (Home pehli baar khulne par). */
  function maybeAuto() {
    try {
      if (LS.get(AUTO_KEY) === 'off') return;
      if (!document.documentElement.classList.contains('mobile-ui')) return;
      const today = U.dateKey(new Date());
      if (LS.get(SEEN_KEY) === today) return;
      LS.set(SEEN_KEY, today);
      setTimeout(() => { if (/^#\/(home)?$|^$/.test(location.hash.split('?')[0])) show(); }, 1500);
    } catch { /* optional */ }
  }

  FF.story = { show, close, maybeAuto, _slides: slides };
})(window.FF);
