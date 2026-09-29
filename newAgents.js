/* 🆕 NEW AGENTS & TL CHANGES (v3.14) — FF + GV dono ke liye alag tables:
     1. 🆕 Naye agents      — jinki pehli issuance is period me shuru hui (pehle kabhi issuance nahi thi)
     2. 🔀 TL changes       — agent ka TL badal gaya (A → B)
     3. ❌ TL hata / ➕ TL mila — pehle TL tha, ab nahi (Direct/APS) · pehle Direct tha, ab TL hai
   Row par click → poori profile (FF.masterProfile drawer: mobile, TL, stock, priority, suggested, class-wise issuance, charts).

   Data (koi naya sheet call nahi): FF → FF.store 'agents' (EIR month × agent × TL) · GV → FF.gv 'master' (date-wise).
   TL har month ka "dominant / latest" TL maana jaata hai; do consecutive active months ke TL alag ho to change event banta hai.
   Data-start month ke agents "new" nahi maane jaate (history unke pehle ki available nahi). */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc, clean = U.clean;
  const norm = (s) => clean(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const PLACEHOLDER = /^(—|-|–|na|n\/a|nan|null|none|undefined|0)$/i;
  const TYPES = { new: '🆕 Naya agent', changed: '🔀 TL badla', removed: '❌ TL hata (ab Direct)', added: '➕ TL mila (pehle Direct)' };
  const monthLabel = (ym) => { try { return U.labelYM(ym); } catch { return String(ym || ''); } };
  const shiftYm = (ym, back) => { let k = ym; for (let i = 0; i < back; i++) k = U.prevMonthKey(k); return k; };

  /** TL identity: asli TL ho to naam (ya "TL <id>"), warna '' (= direct / koi TL nahi). */
  function tlKeyOf(tlName, tlId, ch) {
    const name = PLACEHOLDER.test(clean(tlName)) ? '' : clean(tlName);
    const id = PLACEHOLDER.test(clean(tlId)) ? '' : clean(tlId);
    if (name && FF.config && FF.config.isRealTl && !FF.config.isRealTl(name)) return '';
    if (name) return name;
    return id && ch === 'gv' ? `TL ${id}` : '';
  }

  /**
   * Pure analysis. items = [{ id, name, ym, n, tlName, tlId, date? }]
   * opts = { ch, months (period, default 2), curYm?, minYm? }
   * → { curYm, cutoff, rows: [{ ch, id, name, isNew, firstYm, firstDate, ev, curTl, prevTl, curN, lastN, totalN, active:[ym] }] }
   */
  function analyze(items, opts) {
    const o = opts || {};
    const ch = o.ch || 'ff';
    const span = Math.max(1, Number(o.months) || 2);
    const yms = items.map((r) => r.ym).filter(Boolean).sort();
    const minYm = o.minYm || yms[0] || '';
    const curYm = o.curYm || yms[yms.length - 1] || U.ymKey(new Date());
    const cutoff = shiftYm(curYm, span - 1);
    const prevYm = U.prevMonthKey(curYm);
    const byAgent = new Map();
    for (const r of items) {
      if (!r.ym || !(Number(r.n) > 0)) continue;
      const nm = clean(r.name);
      const id = clean(r.id);
      if (!nm && !id) continue;
      const key = id ? `id:${id}` : `nm:${norm(nm)}`;
      let a = byAgent.get(key);
      if (!a) { a = { id, name: nm || id, months: new Map(), firstDate: null }; byAgent.set(key, a); }
      if (nm && (!a.name || a.name === a.id)) a.name = nm;
      const mo = a.months.get(r.ym) || { n: 0, tls: new Map() };
      mo.n += Number(r.n) || 0;
      const tk = tlKeyOf(r.tlName, r.tlId, ch);
      const t = mo.tls.get(tk) || { n: 0, last: 0 };
      t.n += Number(r.n) || 0;
      const ts = r.date instanceof Date ? r.date.getTime() : Number(r.date) || 0;
      if (ts > t.last) t.last = ts;
      mo.tls.set(tk, t);
      a.months.set(r.ym, mo);
      if (ts && (!a.firstDate || ts < a.firstDate)) a.firstDate = ts;
    }
    const rows = [];
    for (const a of byAgent.values()) {
      const active = [...a.months.keys()].sort();
      if (!active.length) continue;
      const tlOfMonth = (ym) => {
        const list = [...a.months.get(ym).tls.entries()];
        const dated = list.some(([, t]) => t.last > 0);
        list.sort((x, y) => (dated ? y[1].last - x[1].last : 0) || y[1].n - x[1].n);
        return list[0][0];
      };
      const firstYm = active[0];
      const isNew = firstYm >= cutoff && firstYm > minYm;
      let ev = null;
      for (let i = 1; i < active.length; i++) {
        const from = tlOfMonth(active[i - 1]), to = tlOfMonth(active[i]);
        if (from === to) continue;
        const kind = from && to ? 'changed' : from && !to ? 'removed' : 'added';
        ev = { ym: active[i], from, to, kind };   // latest event wins
      }
      if (ev && ev.ym < cutoff) ev = null;
      const curTl = tlOfMonth(active[active.length - 1]);
      const gm = a.months.get(curYm), gl = a.months.get(prevYm);
      rows.push({
        ch, id: a.id, name: a.name, isNew, firstYm, firstDate: a.firstDate || null, ev,
        curTl, prevTl: ev ? ev.from : '', curN: gm ? gm.n : 0, lastN: gl ? gl.n : 0,
        totalN: U.sum([...a.months.values()], (m) => m.n), active, lastActiveYm: active[active.length - 1]
      });
    }
    return { curYm, cutoff, minYm, rows };
  }

  /** Dono channels ka analysis (data load ke baad). */
  async function collect(months) {
    const out = { ff: null, gv: null, errors: [] };
    try {
      if (FF.store && FF.store.need) {
        const rows = await FF.store.need('agents');
        const ffItems = (rows || []).filter((r) => !r.channel || /first/i.test(r.channel)).map((r) => ({ id: r.id, name: r.name, ym: r.ym, n: r.n, tlName: r.tlName, tlId: r.tlId }));
        out.ff = analyze(ffItems, { ch: 'ff', months });
      }
    } catch (err) { out.errors.push(`First Forward: ${err.message || err}`); }
    try {
      if (FF.gv && (!FF.gv.enabled || FF.gv.enabled()) && FF.gv.need) {
        await FF.gv.need('master');
        const master = FF.gv.rows ? FF.gv.rows() : [];
        const gvItems = master.map((r) => ({ id: r.agentId, name: r.agentName, ym: r.ym, n: 1, tlName: r.tlName, tlId: r.tlId, date: r.date }));
        out.gv = analyze(gvItems, { ch: 'gv', months });
      }
    } catch (err) { out.errors.push(`GV: ${err.message || err}`); }
    return out;
  }

  const personOf = (r) => ({ kind: `${r.ch}-agent`, name: r.name, sub: r.id, tlSet: new Set(), classMap: new Map(), bars: new Set() });
  function enrich(r) {
    const MP = FF.masterProfile;
    let q = null;
    try { q = MP && MP.quick ? MP.quick(personOf(r)) : null; } catch { q = null; }
    return { ...r, q };
  }

  // ------------------------------------------------------------------ render
  const fmtDate = (ts, ym) => (ts ? U.labelDate ? U.labelDate(new Date(ts)) : new Date(ts).toISOString().slice(0, 10) : monthLabel(ym));
  const prioChip = (p) => (p ? `<span class="badge ${/high/i.test(p) ? 'red' : /medium/i.test(p) ? 'amber' : 'green'}">${esc(p)}</span>` : '<span class="dim">—</span>');
  const tlText = (t) => (t ? esc(t) : '<span class="direct-chip">🚫 Direct (no TL)</span>');
  const chBadge = (ch) => (ch === 'gv' ? '<span class="badge green">GV</span>' : '<span class="badge blue">FF</span>');
  const canContacts = () => { try { return !FF.auth || FF.auth.can('contacts'); } catch { return true; } };

  function detailCells(r) {
    const q = r.q;
    const mobile = !canContacts() ? '🔒' : (q && q.mobile) || '—';
    const stock = q ? U.fmt(q.stock.total) : '—';
    const sug = !q ? '—' : q.tagRequired ? `<b class="sug-chip direct">🏷️ ${U.fmt(q.dispatch.sugVc4 + q.dispatch.sugComm)} tags</b>` : q.direct ? '<span class="dim">No dispatch</span>' : `<b class="sug-chip">${U.fmt(q.dispatch.sugVc4)}</b>`;
    return { mobile, stock, sug, prio: q ? prioChip(q.priority) : '<span class="dim">—</span>', status: q && q.status ? esc(q.status) : '—' };
  }
  const rowAttrs = (r) => `class="clickable" data-na-open="${esc(r.ch)}|${esc(r.name)}|${esc(r.id)}"`;

  function newTable(list) {
    if (!list.length) return '<div class="empty-state compact">Is period me koi naya agent nahi mila.</div>';
    return `<div class="table-wrap tall"><table class="tbl compact"><thead><tr><th>Agent</th><th>Channel</th><th>Mobile</th><th>Pehli issuance</th><th>TL</th><th class="num">Is month</th><th class="num">Last month</th><th class="num">Total issued</th><th class="num">Stock</th><th>Priority</th><th>Suggested</th><th>Status</th></tr></thead><tbody>
      ${list.slice(0, 300).map((r) => { const d = detailCells(r); return `<tr ${rowAttrs(r)}><td><b>${esc(r.name)}</b><small class="cell-sub">${esc(r.id)}</small></td><td>${chBadge(r.ch)}</td><td>${esc(d.mobile)}</td><td>${esc(fmtDate(r.firstDate, r.firstYm))}</td><td>${tlText(r.curTl)}</td><td class="num">${U.fmt(r.curN)}</td><td class="num">${U.fmt(r.lastN)}</td><td class="num">${U.fmt(r.totalN)}</td><td class="num">${d.stock}</td><td>${d.prio}</td><td>${d.sug}</td><td>${d.status}</td></tr>`; }).join('')}
      </tbody></table></div>`;
  }
  function changeTable(list) {
    if (!list.length) return '<div class="empty-state compact">Is period me kisi agent ka TL nahi badla.</div>';
    return `<div class="table-wrap tall"><table class="tbl compact"><thead><tr><th>Agent</th><th>Channel</th><th>Type</th><th>Pehle ka TL</th><th>Ab ka TL</th><th>Kab (month)</th><th>Mobile</th><th class="num">Is month</th><th class="num">Last month</th><th class="num">Stock</th><th>Priority</th><th>Suggested</th></tr></thead><tbody>
      ${list.slice(0, 300).map((r) => { const d = detailCells(r); const e = r.ev; return `<tr ${rowAttrs(r)}><td><b>${esc(r.name)}</b><small class="cell-sub">${esc(r.id)}</small></td><td>${chBadge(r.ch)}</td><td><span class="tag ${e.kind === 'removed' ? 'warn' : 'ok'}">${esc(TYPES[e.kind])}</span></td><td>${tlText(e.from)}</td><td>${tlText(e.to)}</td><td>${esc(monthLabel(e.ym))}</td><td>${esc(d.mobile)}</td><td class="num">${U.fmt(r.curN)}</td><td class="num">${U.fmt(r.lastN)}</td><td class="num">${d.stock}</td><td>${d.prio}</td><td>${d.sug}</td></tr>`; }).join('')}
      </tbody></table></div>`;
  }

  const csvNew = (list) => [['Channel', 'Agent', 'ID', 'Mobile', 'First issuance', 'TL', 'This month', 'Last month', 'Total issued', 'Stock', 'Priority', 'Suggested VC4', 'Suggested Comm'],
    list.map((r) => { const q = r.q; return [r.ch === 'gv' ? 'GV Partner' : 'First Forward', r.name, r.id, canContacts() && q ? q.mobile : '', fmtDate(r.firstDate, r.firstYm), r.curTl || 'Direct (no TL)', r.curN, r.lastN, r.totalN, q ? q.stock.total : '', q ? q.priority : '', q ? q.dispatch.sugVc4 : '', q ? q.dispatch.sugComm : '']; })];
  const csvChange = (list) => [['Channel', 'Agent', 'ID', 'Type', 'Previous TL', 'Current TL', 'Month', 'Mobile', 'This month', 'Last month', 'Stock', 'Priority'],
    list.map((r) => { const q = r.q; return [r.ch === 'gv' ? 'GV Partner' : 'First Forward', r.name, r.id, TYPES[r.ev.kind], r.ev.from || 'Direct (no TL)', r.ev.to || 'Direct (no TL)', r.ev.ym, canContacts() && q ? q.mobile : '', r.curN, r.lastN, q ? q.stock.total : '', q ? q.priority : '']; })];

  const kpi = (label, value, foot, tone, icon) => `<div class="kpi ${tone}"><div class="kpi-top"><span class="kpi-title">${label}</span><span class="kpi-icon">${icon}</span></div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot}</div></div>`;

  async function render(root, params) {
    const p = params || {};
    const months = [1, 2, 3, 6].includes(Number(p.months)) ? Number(p.months) : 2;
    const chSel = ['ff', 'gv'].includes(p.ch) ? p.ch : 'all';
    const typeSel = ['new', 'changed', 'removed', 'added'].includes(p.type) ? p.type : 'all';
    const q = clean(p.q || '').toLowerCase();
    root.innerHTML = U.spinner('Naye agents aur TL changes nikaal rahe hain…');
    let data;
    try {
      data = await collect(months);
      if (FF.masterProfile && FF.masterProfile.load) await FF.masterProfile.load();
    } catch (err) { root.innerHTML = U.errorBox(err); return; }
    const all = [...(data.ff ? data.ff.rows : []), ...(data.gv ? data.gv.rows : [])].filter((r) => chSel === 'all' || r.ch === chSel);
    const search = (r) => !q || [r.name, r.id, r.curTl, r.ev && r.ev.from, r.ev && r.ev.to].join(' ').toLowerCase().includes(q);
    const newRows = all.filter((r) => r.isNew && search(r)).map(enrich).sort((a, b) => (b.firstDate || 0) - (a.firstDate || 0) || b.firstYm.localeCompare(a.firstYm) || b.totalN - a.totalN);
    const evRows = all.filter((r) => r.ev && search(r)).map(enrich).sort((a, b) => b.ev.ym.localeCompare(a.ev.ym) || b.curN - a.curN);
    const showNew = typeSel === 'all' || typeSel === 'new';
    const evList = evRows.filter((r) => typeSel === 'all' || r.ev.kind === typeSel);
    const cnt = (ch, fn) => all.filter((r) => r.ch === ch && fn(r)).length;
    const nNewFf = all.filter((r) => r.ch === 'ff' && r.isNew).length, nNewGv = all.filter((r) => r.ch === 'gv' && r.isNew).length;
    const kind = (k) => all.filter((r) => r.ev && r.ev.kind === k).length;
    const curYm = (data.ff && data.ff.curYm) || (data.gv && data.gv.curYm) || U.ymKey(new Date());
    const cutoff = shiftYm(curYm, months - 1);
    // chart: last 6 months me naye agents (FF + GV alag)
    const six = [5, 4, 3, 2, 1, 0].map((b) => shiftYm(curYm, b));
    const firstCount = (res) => { const map = new Map(); if (res) res.rows.forEach((r) => { if (r.firstYm > res.minYm) map.set(r.firstYm, (map.get(r.firstYm) || 0) + 1); }); return six.map((m) => map.get(m) || 0); };
    const series = { ff: firstCount(data.ff), gv: firstCount(data.gv) };
    const C = FF.charts;
    const chart = C ? C.bars({ labels: six.map(monthLabel), height: 170, showValues: true, series: [{ name: 'First Forward', values: series.ff, color: '#3b82f6' }, { name: 'GV Partner', values: series.gv, color: '#10b981' }] }) : '';
    const filterBtn = (key, val, label, cur) => `<button class="btn small ${cur === val ? 'primary' : ''}" data-na-param="${key}" data-value="${val}">${label}</button>`;
    root.innerHTML = `<div class="page-head"><div><h1>🆕 New Agents &amp; TL Changes</h1><p class="sub">Naye agents (pehli issuance) aur TL badalne / hatne ka alag table — <b>First Forward + GV</b> dono. Row par click karo → agent ki poori profile (mobile · TL · stock · priority · suggested · class-wise issuance · charts).</p></div>
      <div class="head-actions"><button class="btn small" id="na-refresh">↻ Refresh</button></div></div>
      ${data.errors.length ? `<div class="alert warn">${data.errors.map(esc).join(' · ')}</div>` : ''}
      <div class="metric-grid">
        ${kpi('🆕 Naye agents', U.fmt(nNewFf + nNewGv), `${U.fmt(nNewFf)} FF · ${U.fmt(nNewGv)} GV · ${esc(monthLabel(cutoff))} se`, 'g9', '🆕')}
        ${kpi('🔀 TL badla', U.fmt(kind('changed')), `${U.fmt(cnt('ff', (r) => r.ev && r.ev.kind === 'changed'))} FF · ${U.fmt(cnt('gv', (r) => r.ev && r.ev.kind === 'changed'))} GV`, 'g4', '🔀')}
        ${kpi('❌ TL hata (ab Direct)', U.fmt(kind('removed')), 'Pehle TL tha, ab koi TL nahi', 'g7', '❌')}
        ${kpi('➕ TL mila', U.fmt(kind('added')), 'Pehle Direct tha, ab TL ke saath', 'g3', '➕')}
      </div>
      <section class="card"><div class="card-head"><h3>📈 Naye agents · pichhle 6 mahine</h3></div><div class="card-body">${chart}<p class="dim small">Har agent ka pehla issuance-month. Data-start month ke agents count nahi hote (unki pehle ki history available nahi).</p></div></section>
      <section class="card"><div class="card-body">
        <div class="dispatch-filter-bar"><span><b>Channel:</b></span><div class="btn-row">${filterBtn('ch', '', 'Dono', chSel === 'all' ? '' : chSel)}${filterBtn('ch', 'ff', '🟦 First Forward', chSel)}${filterBtn('ch', 'gv', '🟩 GV Partner', chSel)}</div></div>
        <div class="dispatch-filter-bar"><span><b>Type:</b></span><div class="btn-row">${filterBtn('type', '', 'Sab', typeSel === 'all' ? '' : typeSel)}${['new', 'changed', 'removed', 'added'].map((k) => filterBtn('type', k, TYPES[k], typeSel)).join('')}</div></div>
        <div class="dispatch-filter-bar"><span><b>Period:</b></span><div class="btn-row">${[1, 2, 3, 6].map((m) => filterBtn('months', String(m), m === 1 ? 'Is month' : `Pichhle ${m} mahine`, String(months))).join('')}</div></div>
        <form id="na-search" class="ins-search" style="margin-top:10px"><input class="input" name="q" value="${esc(p.q || '')}" placeholder="Agent, ID ya TL naam…"><button class="btn">Search</button></form>
      </div></section>
      ${showNew ? `<section class="card"><div class="card-head"><h3>🆕 Naye agents — FF + GV <span class="dim">${U.fmt(newRows.length)}</span></h3><div class="card-right">${FF.auth.can('export') ? '<button class="btn small" id="na-csv-new">⬇ CSV</button>' : ''}</div></div><div class="card-body">${newTable(newRows)}<p class="dim small">Pehli issuance ${esc(monthLabel(cutoff))} ya uske baad. Click → poori profile.</p></div></section>` : ''}
      ${typeSel === 'new' ? '' : `<section class="card"><div class="card-head"><h3>🔀 TL changes · TL hata / mila <span class="dim">${U.fmt(evList.length)}</span></h3><div class="card-right">${FF.auth.can('export') ? '<button class="btn small" id="na-csv-ev">⬇ CSV</button>' : ''}</div></div><div class="card-body">${changeTable(evList)}<p class="dim small">Kisi agent ka TL do consecutive active months me alag ho to yahan aata hai (latest change). ❌ = pehle TL tha ab Direct/APS/khaali.</p></div></section>`}`;
    if (C && C.mount) { try { C.mount(root); } catch { /* ignore */ } }
    root.querySelectorAll('[data-na-param]').forEach((b) => b.addEventListener('click', () => FF.app.updateParams({ [b.dataset.naParam]: b.dataset.value })));
    const form = U.$('#na-search', root);
    if (form) form.addEventListener('submit', (e) => { e.preventDefault(); FF.app.updateParams({ q: new FormData(form).get('q') || '' }); });
    const rf = U.$('#na-refresh', root);
    if (rf) rf.addEventListener('click', () => { if (FF.app.refresh) FF.app.refresh(); else render(root, params); });
    const dl = (name, [head, rows]) => U.downloadCsv(`${name}-${U.stamp()}.csv`, head, rows);
    const c1 = U.$('#na-csv-new', root), c2 = U.$('#na-csv-ev', root);
    if (c1) c1.addEventListener('click', () => dl('new-agents', csvNew(newRows)));
    if (c2) c2.addEventListener('click', () => dl('tl-changes', csvChange(evList)));
    if (root.__naClick) root.removeEventListener('click', root.__naClick);
    root.__naClick = (e) => {
      const row = e.target.closest('[data-na-open]');
      if (!row || e.target.closest('a,button')) return;
      const [ch, name, id] = row.dataset.naOpen.split('|');
      if (FF.masterProfile && FF.masterProfile.open) FF.masterProfile.open(personOf({ ch, name, id }));
    };
    root.addEventListener('click', root.__naClick);
  }

  FF.newAgents = { analyze, collect, tlKeyOf, render, TYPES };
  FF.pages.newAgents = { title: 'New Agents & TL Changes', render };
})(window.FF);
