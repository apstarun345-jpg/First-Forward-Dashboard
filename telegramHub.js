/* ✈️ v3.125.577 — Telegram Hub: reports banao (browser ke full data se), turant bhejo, schedule karo (daily / ghante-wise),
   aur har page par chhota ✈️ button. Server sirf bhejta + schedule chalata hai (/api/telegram/*). Sirf admin. */
(function () {
  'use strict';
  const FF = (window.FF = window.FF || {});
  const U = () => FF.util, esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => { try { return FF.util.fmt(Number(n) || 0); } catch { return String(Math.round(Number(n) || 0)); } };
  const isAdmin = () => !!(FF.auth && FF.auth.user && FF.auth.isAdmin && FF.auth.isAdmin());
  const api = (path, method, body) => FF.auth.api(path, method, body);
  const clsNum = (c) => { const m = String(c).match(/(\d+)/); return m ? Number(m[1]) : 999; };
  const badCls = (c) => !c || /VEHICLE|^CLASS$/i.test(c);

  // ------------------------------------------------------------------ reports
  const REPORTS = [
    { id: 'issuance', ic: '🏷️', t: 'Issuance (FF + GV)', d: 'Aaj / MTD / pichhle mahine ke barabar din / projected', pages: ['home', 'dashboard', 'compare', 'tagIssued', 'trend'] },
    { id: 'stock', ic: '📦', t: 'Stock · class-wise', d: 'VC4, VC5, VC6, VC7, VC12, VC16 — FF aur GV', pages: ['stock', 'gvStock', 'compare'] },
    { id: 'priority', ic: '🚚', t: 'Dispatch priority', d: 'High / Medium priority agents (FF + GV) — jinhe tag chahiye', pages: ['dispatchPlanner', 'performance', 'gvPerformance', 'targets'] },
    { id: 'inactive', ic: '😴', t: 'Inactive agents (FF + GV)', d: '7+ din se issuance nahi — naam ke saath', pages: ['performance', 'gvPerformance', 'agentsOverview'] },
    { id: 'direct', ic: '🧍', t: 'Direct agents', d: 'Bina TL ke agents: MTD, inactive, priority', pages: ['directAgents'] },
    { id: 'degrowth', ic: '📉', t: 'De-growth agents', d: 'Pichhle mahine se sabse zyada gire agents', pages: ['performance', 'gvPerformance'] },
    { id: 'top', ic: '🏆', t: 'Top agents (MTD)', d: 'Is mahine ke top 10 FF + GV', pages: ['performance', 'gvPerformance', 'champions'] }
  ];
  const head = (t) => `<b>${t}</b>`;
  const stamp = () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  async function watch(ch) {
    try {
      if (ch === 'ff') {
        await FF.lazy.ensure('performance'); await FF.pages.performance.ensureLoaded();
        if (FF.pages.performance.agents) FF.pages.performance.agents();
        return FF.perfWatch.prepRows('ff', FF.pages.performance.watchRows());
      }
      if (!(FF.gv && FF.gv.enabled && FF.gv.enabled())) return [];
      await FF.lazy.ensure('gvPerformance'); await FF.gv.need('report');
      return FF.perfWatch.prepRows('gv', FF.pages.gvPerformance.watchRows());
    } catch (e) { return []; }
  }
  const own = (r) => /apna\s*pay/i.test(String(r.n || '')) || String(r.id || '') === '5845036';   // company ki apni master ID agent nahi
  const nm = (r) => `${r.n}${r.id ? ` (${r.id})` : ''}`;
  const lines = (list, f, n) => list.slice(0, n || 10).map((r, i) => `${i + 1}. ${f(r)}`).join('\n');

  const BUILD = {
    async issuance() {
      const S = FF.store, M = FF.model, G = FF.gv, Ut = FF.util;
      const out = [];
      try {
        const daily = (await S.need('daily')).filter((r) => r.channel !== 'GV Partner');
        const latest = M.latestDate(daily), cur = latest ? Ut.ymKey(latest) : null;
        if (cur) {
          const last = Ut.prevMonthKey(cur), day = latest.getDate(), s = M.summary(daily, cur), l = M.summary(daily, last, day);
          const today = daily.filter((r) => { const d = r.date || r.d; const dd = d instanceof Date ? d : Ut.parseDate(d); return dd && Ut.dateKey(dd) === Ut.dateKey(latest); }).reduce((t, r) => t + (Number(r.n) || 1), 0);
          out.push(`🟦 <b>First Forward</b> · ${Ut.labelDateKey ? Ut.labelDateKey(Ut.dateKey(latest)) : ''}\nAakhri din: <b>${fmt(today)}</b> · MTD: <b>${fmt(s.total)}</b> (pichhle mahine same din tak ${fmt(l.total)})\nProjected: ${fmt(s.projected)}`);
        }
      } catch (e) { /* FF skip */ }
      try {
        if (G && G.enabled && G.enabled()) {
          await G.need('master');
          const latest = G.latestDate(), cur = latest ? Ut.ymKey(latest) : null;
          if (cur) { const s = G.summary(cur), l = G.summary(Ut.prevMonthKey(cur), latest.getDate()); out.push(`🟩 <b>GV Partner</b>\nMTD: <b>${fmt(s.total)}</b> (pichhle mahine same din tak ${fmt(l.total)})\nProjected: ${fmt(s.projected)}`); }
        }
      } catch (e) { /* GV skip */ }
      return out.length ? { title: '🏷️ Issuance', text: out.join('\n\n') } : null;
    },
    async stock() {
      const S = FF.store, G = FF.gv, out = [];
      const sumBy = (rows) => { const m = new Map(); rows.forEach((r) => { if (badCls(r.cls)) return; m.set(r.cls, (m.get(r.cls) || 0) + (Number(r.n) || 0)); }); return [...m.entries()].sort((a, b) => clsNum(a[0]) - clsNum(b[0])); };
      try { const ff = sumBy(await S.need('stock')); if (ff.length) out.push(`🟦 <b>First Forward stock</b> — total <b>${fmt(ff.reduce((t, x) => t + x[1], 0))}</b>\n${ff.map(([c, n]) => `${esc(c)}: ${fmt(n)}`).join(' · ')}`); } catch (e) { /* skip */ }
      try { if (G && G.enabled && G.enabled()) { await G.need('stockClass'); const gv = sumBy(G.get('stockClass') || []); if (gv.length) out.push(`🟩 <b>GV stock</b> — total <b>${fmt(gv.reduce((t, x) => t + x[1], 0))}</b>\n${gv.map(([c, n]) => `${esc(c)}: ${fmt(n)}`).join(' · ')}`); } } catch (e) { /* skip */ }
      return out.length ? { title: '📦 Stock (class-wise)', text: out.join('\n\n') } : null;
    },
    async priority() {
      const out = [];
      for (const [ch, lab] of [['ff', '🟦 FF'], ['gv', '🟩 GV']]) {
        const rows = (await watch(ch)).filter((r) => !own(r));
        const hi = rows.filter((r) => r.pri === 'High').sort((a, b) => b.cur - a.cur), md = rows.filter((r) => r.pri === 'Medium');
        if (!rows.length) continue;
        out.push(`${lab} · 🔴 High <b>${hi.length}</b> · 🟠 Medium <b>${md.length}</b>\n${lines(hi, (r) => `${esc(nm(r))} — stock ${fmt(r.stock)}, MTD ${fmt(r.cur)}`, 10)}${hi.length > 10 ? `\n… +${hi.length - 10} aur` : ''}`);
      }
      return out.length ? { title: '🚚 Dispatch priority', text: out.join('\n\n') } : null;
    },
    async inactive() {
      const out = [];
      for (const [ch, lab] of [['ff', '🟦 FF'], ['gv', '🟩 GV']]) {
        const rows = (await watch(ch)).filter((r) => r.inact >= 7 && r.stock > 0 && !own(r)).sort((a, b) => b.stock - a.stock);
        if (!rows.length) continue;
        out.push(`${lab} · 7+ din inactive: <b>${rows.length}</b> agents\n${lines(rows, (r) => `${esc(nm(r))} — ${r.inact >= 99 ? 'is mahine 0' : r.inact + 'd'} · stock ${fmt(r.stock)}`, 12)}${rows.length > 12 ? `\n… +${rows.length - 12} aur` : ''}`);
      }
      return out.length ? { title: '😴 Inactive agents', text: out.join('\n\n') } : null;
    },
    async direct() {
      const out = [];
      for (const [ch, lab] of [['ff', '🟦 FF'], ['gv', '🟩 GV']]) {
        const rows = (await watch(ch)).filter((r) => r.direct);
        if (!rows.length) continue;
        const act = rows.filter((r) => r.cur > 0), ina = rows.filter((r) => r.inact >= 7), hi = rows.filter((r) => r.pri === 'High');
        out.push(`${lab} Direct agents: <b>${rows.length}</b> · MTD <b>${fmt(rows.reduce((t, r) => t + r.cur, 0))}</b> · active ${act.length} · 7+d inactive ${ina.length} · High priority ${hi.length}\n${lines(rows.sort((a, b) => b.cur - a.cur), (r) => `${esc(nm(r))} — MTD ${fmt(r.cur)} · stock ${fmt(r.stock)}`, 8)}`);
      }
      return out.length ? { title: '🧍 Direct agents', text: out.join('\n\n') } : null;
    },
    async degrowth() {
      const out = [];
      for (const [ch, lab] of [['ff', '🟦 FF'], ['gv', '🟩 GV']]) {
        const rows = (await watch(ch)).filter((r) => r.g !== null && r.last >= 20 && r.g < 0).sort((a, b) => a.g - b.g);
        if (rows.length) out.push(`${lab} · De-growth: <b>${rows.length}</b>\n${lines(rows, (r) => `${esc(nm(r))} — ${Math.round(r.g)}% (${fmt(r.last)} → ${fmt(r.cur)})`, 8)}`);
      }
      return out.length ? { title: '📉 De-growth agents', text: out.join('\n\n') } : null;
    },
    async top() {
      const out = [];
      for (const [ch, lab] of [['ff', '🟦 FF'], ['gv', '🟩 GV']]) {
        const rows = (await watch(ch)).filter((r) => r.cur > 0).sort((a, b) => b.cur - a.cur);
        if (rows.length) out.push(`${lab} · Top 10 (MTD)\n${lines(rows, (r) => `${esc(nm(r))} — <b>${fmt(r.cur)}</b>${r.g === null ? '' : ` (${r.g > 0 ? '+' : ''}${Math.round(r.g)}%)`}`, 10)}`);
      }
      return out.length ? { title: '🏆 Top agents', text: out.join('\n\n') } : null;
    }
  };

  async function build(id) {
    const f = BUILD[id]; if (!f) return null;
    try { const r = await f(); return r ? { id, title: r.title, text: `${r.text}\n\n🕒 ${stamp()}` } : null; } catch (e) { return null; }
  }
  async function buildMany(ids) {
    const out = [];
    for (const id of ids) { const r = await build(id); if (r) out.push(r); }
    return out;
  }
  const toMsg = (r) => `${head(esc(r.title))}\n${r.text}`;

  /** Reports ko abhi Telegram par bhejo (server sirf bhejta hai). */
  async function sendNow(ids, note) {
    const rep = await buildMany(ids);
    if (!rep.length) return { ok: false, error: 'Report ke liye data abhi nahi mila — thodi der baad try karo' };
    try { const r = await api('/api/telegram/send', 'POST', { items: rep.map((x) => ({ id: x.id, title: x.title, text: toMsg(x) })) }); return { ok: !!(r && r.ok), sent: rep.length, error: r && r.error }; } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  }
  /** Schedule ke liye taaza snapshot server ko do (browser band hone par bhi server ye hi bhejta hai). */
  async function pushSnapshots(ids) {
    const rep = await buildMany(ids);
    if (!rep.length) return 0;
    const reports = {}; rep.forEach((x) => { reports[x.id] = { title: x.title, text: toMsg(x) }; });
    try { await api('/api/telegram/snapshot', 'POST', { reports }); } catch (e) { return 0; }
    return rep.length;
  }

  // ------------------------------------------------------------------ Settings tab
  async function mount(host) {
    if (!host) return;
    host.innerHTML = '<div class="dim">✈️ Telegram settings load ho rahe hain…</div>';
    let st;
    try { st = await api('/api/telegram/config', 'GET'); } catch (e) { host.innerHTML = `<div class="empty-state">Telegram settings load nahi hui — thodi der baad dobara kholo.</div>`; return; }
    const cfg = st.cfg || {}, auto = st.auto || { enabled: false, routes: {} }, labels = st.routeLabels || {};
    const sel = new Set(cfg.reports || []);
    const hrs = [1, 2, 3, 4, 6, 8, 12];
    host.innerHTML = `
      <div class="card" style="padding:14px">
        <h3 style="margin:0 0 6px">✈️ Telegram</h3>
        <div class="dim small">${st.configured ? '✅ Bot connected' : '⚠️ Render me TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID set nahi hain'} · <b>bina admin allow ke koi alert / report nahi jati</b>. Neeche pehle auto alerts allow karo, reports abhi ya schedule se bhejo.</div>
        <h4 style="margin:14px 0 6px">🔐 Auto alerts — admin allow</h4>
        <label class="card" style="padding:10px;display:flex;gap:10px;align-items:center;cursor:pointer"><input type="checkbox" id="tg-auto-on" ${auto.enabled ? 'checked' : ''}><span><b>Auto alerts allow karo</b> <span class="dim small">(band = koi bhi site-alert Telegram par nahi jayegi)</span></span></label>
        <div class="grid g-2" style="gap:8px;margin-top:8px">${Object.entries(labels).map(([k, l]) => `<label class="card" style="padding:8px 10px;display:flex;gap:10px;align-items:center;cursor:pointer"><input type="checkbox" data-tg-route="${k}" ${auto.routes && auto.routes[k] ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div>
        <div class="btn-row" style="margin:8px 0"><button class="btn primary" data-tg="saveauto">💾 Alerts save</button></div>
        <div class="btn-row" style="margin:10px 0"><button class="btn" data-tg="test">🧪 Test message</button><button class="btn primary" data-tg="sendsel">📤 Selected abhi bhejo</button><button class="btn" data-tg="sendall">📤 Sab abhi bhejo</button></div>
        <div id="tg-msg" class="dim small" style="min-height:18px"></div>
        <h4 style="margin:14px 0 6px">📋 Kaun si report</h4>
        <div class="grid g-2" style="gap:8px">${REPORTS.map((r) => `<label class="card" style="padding:10px;display:flex;gap:10px;align-items:flex-start;cursor:pointer"><input type="checkbox" data-tg-rep="${r.id}" ${sel.has(r.id) ? 'checked' : ''}><span><b>${r.ic} ${esc(r.t)}</b><br><span class="dim small">${esc(r.d)}</span><br><button type="button" class="btn small" data-tg-one="${r.id}" style="margin-top:6px">✈️ Abhi bhejo</button></span></label>`).join('')}</div>
        <h4 style="margin:14px 0 6px">⏰ Schedule</h4>
        <div class="ctrl-row" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <label>Mode <select class="input" id="tg-mode"><option value="off" ${cfg.mode === 'off' ? 'selected' : ''}>Band</option><option value="daily" ${cfg.mode === 'daily' ? 'selected' : ''}>Roz ek baar</option><option value="hourly" ${cfg.mode === 'hourly' ? 'selected' : ''}>Har kuch ghante</option></select></label>
          <label>Roz ka time (IST) <input class="input" type="time" id="tg-time" value="${esc(cfg.time || '09:00')}"></label>
          <label>Har <select class="input" id="tg-every">${hrs.map((h) => `<option value="${h}" ${Number(cfg.everyHours) === h ? 'selected' : ''}>${h} ghante</option>`).join('')}</select></label>
          <label>Se <input class="input" type="time" id="tg-from" value="${esc(cfg.from || '09:00')}"> Tak <input class="input" type="time" id="tg-to" value="${esc(cfg.to || '21:00')}"></label>
          <button class="btn primary" data-tg="save">💾 Save</button>
        </div>
        <div class="dim small" style="margin-top:8px">Schedule ki report wahi data bhejti hai jo site ne aakhri baar (admin ke khulne par) taaza kiya. ${st.snapAt ? `Aakhri snapshot: ${esc(new Date(st.snapAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))}.` : 'Abhi snapshot nahi bana — "Save" dabane par ban jayega.'} ${st.lastSent ? `Aakhri schedule send: ${esc(new Date(st.lastSent).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))}.` : ''}</div>
      </div>`;
    const msg = (t, bad) => { const m = host.querySelector('#tg-msg'); if (m) { m.textContent = t; m.style.color = bad ? '#b91c1c' : '#15803d'; } };
    const picked = () => [...host.querySelectorAll('[data-tg-rep]:checked')].map((x) => x.dataset.tgRep);
    host.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-tg],button[data-tg-one]'); if (!b) return;
      b.disabled = true;
      try {
        if (b.dataset.tg === 'test') { msg('Bhej raha hu…'); const r = await api('/api/notifications/telegram/test', 'POST', {}); msg(r && r.ok ? '✅ Test message chala gaya' : `❌ ${(r && r.results && r.results[0] && r.results[0].error) || 'fail'}`, !(r && r.ok)); }
        else if (b.dataset.tg === 'sendsel' || b.dataset.tg === 'sendall' || b.dataset.tgOne) {
          const ids = b.dataset.tgOne ? [b.dataset.tgOne] : b.dataset.tg === 'sendall' ? REPORTS.map((r) => r.id) : picked();
          if (!ids.length) { msg('Pehle koi report chuno', true); return; }
          msg('Report bana kar bhej raha hu…'); const r = await sendNow(ids); msg(r.ok ? `✅ ${r.sent} report bhej di` : `❌ ${r.error || 'nahi gayi'}`, !r.ok);
        } else if (b.dataset.tg === 'saveauto') {
          const routes = {}; host.querySelectorAll('[data-tg-route]').forEach((x) => { routes[x.dataset.tgRoute] = x.checked; });
          await api('/api/telegram/auto', 'POST', { enabled: host.querySelector('#tg-auto-on').checked, routes }); msg('✅ Auto alerts setting save ho gayi');
        } else if (b.dataset.tg === 'save') {
          const body = { reports: picked(), mode: host.querySelector('#tg-mode').value, time: host.querySelector('#tg-time').value, everyHours: Number(host.querySelector('#tg-every').value), from: host.querySelector('#tg-from').value, to: host.querySelector('#tg-to').value };
          await api('/api/telegram/config', 'POST', body); msg('Save ho gaya — taaza snapshot bana raha hu…'); const n = body.reports.length ? await pushSnapshots(body.reports) : 0; msg(`✅ Save ho gaya${n ? ` · ${n} report ka snapshot ready` : ''}`);
        }
      } catch (err) { msg(`❌ ${String((err && err.message) || err)}`, true); } finally { b.disabled = false; }
    });
  }

  // ------------------------------------------------------------------ har page par ✈️ button (sirf admin)
  const PAGE_MAP = {};
  REPORTS.forEach((r) => r.pages.forEach((p) => { (PAGE_MAP[p] = PAGE_MAP[p] || []).push(r.id); }));
  function pageKey() { return String(location.hash || '').replace(/^#\/?/, '').split(/[?&/]/)[0] || 'home'; }
  let pill = null, menu = null;
  function ensurePill() {
    if (!isAdmin()) { if (pill) pill.hidden = true; return; }
    if (!pill) {
      pill = document.createElement('button'); pill.type = 'button'; pill.id = 'tg-pill'; pill.title = 'Telegram par bhejo'; pill.textContent = '✈️';
      pill.style.cssText = 'position:fixed;left:14px;bottom:70px;z-index:900;width:38px;height:38px;border-radius:50%;border:1px solid #bae6fd;background:#e0f2fe;font-size:18px;cursor:pointer;box-shadow:0 4px 14px rgba(2,132,199,.25)';
      pill.addEventListener('click', toggleMenu); document.body.appendChild(pill);
    }
    pill.hidden = false;
  }
  function toggleMenu() {
    if (menu) { menu.remove(); menu = null; return; }
    const here = PAGE_MAP[pageKey()] || [];
    const list = [...here.map((id) => REPORTS.find((r) => r.id === id)), ...REPORTS.filter((r) => !here.includes(r.id))].filter(Boolean);
    menu = document.createElement('div');
    menu.style.cssText = 'position:fixed;left:14px;bottom:116px;z-index:901;background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 10px 30px rgba(15,23,42,.18);padding:8px;width:min(300px,86vw);max-height:60vh;overflow:auto;font-size:13px';
    menu.innerHTML = `<div style="font-weight:800;padding:4px 6px">✈️ Telegram par bhejo</div>${list.map((r) => `<button type="button" class="btn small" data-tgp="${r.id}" style="display:block;width:100%;text-align:left;margin:3px 0">${r.ic} ${esc(r.t)}${here.includes(r.id) ? ' ⭐' : ''}</button>`).join('')}<div id="tg-pill-msg" class="dim small" style="padding:4px 6px"></div>`;
    menu.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-tgp]'); if (!b) return; const m = menu.querySelector('#tg-pill-msg'); b.disabled = true; m.textContent = 'Bhej raha hu…';
      const r = await sendNow([b.dataset.tgp]); m.textContent = r.ok ? '✅ Bhej diya' : `❌ ${r.error || 'nahi gayi'}`; b.disabled = false;
    });
    document.body.appendChild(menu);
  }
  function closeMenu() { if (menu) { menu.remove(); menu = null; } }

  // schedule on ho to admin ke browser se taaza snapshot (har 30 min) — server isi ko schedule par bhejta hai
  let snapTimer = 0;
  async function snapTick() {
    try {
      if (!isAdmin() || document.hidden) return;
      const st = await api('/api/telegram/config', 'GET'); const cfg = st && st.cfg;
      if (!cfg || cfg.mode === 'off' || !(cfg.reports || []).length) return;
      if (st.snapAt && Date.now() - new Date(st.snapAt).getTime() < 25 * 60e3) return;
      await pushSnapshots(cfg.reports);
    } catch (e) { /* best-effort */ }
  }
  function boot() {
    // ✈️ floating button hata diya (user ki request) — Telegram sirf Settings → ✈️ Telegram se.
    try { const old = document.getElementById('tg-pill'); if (old) old.remove(); } catch (e) { /* ignore */ }
    setTimeout(snapTick, 90e3);
    snapTimer = setInterval(snapTick, 10 * 60e3);
    void snapTimer;
  }
  FF.telegram = { REPORTS, build, buildMany, sendNow, pushSnapshots, mount };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 3000)); else setTimeout(boot, 3000);
})();
