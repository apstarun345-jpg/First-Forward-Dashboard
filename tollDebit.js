/* 🛣 Toll Debit (v3.125.172) — Reports → Toll Debit
   Data: "Toll Debit Daily" tab (GV workbook). Wo tab Apps Script (TollDebitDaily.gs) roz IDFC ki
   "EToll 2.0 - All Transactions Report" mail se bharti hai: date-wise + class-wise (TVC) toll debit
   ki ginti aur ₹. Ye page sirf wahi summary padhta hai — poora report site par nahi aata. */
(function (FF) {
  'use strict';
  const U = FF.util, esc = U.esc, fmt = U.fmt;
  const GID = '734237361', TAB = 'Toll Debit Daily';
  const state = { at: 0, days: [], classes: [], basis: '', promise: null, err: '' };
  const num = (v) => { const n = Number(String(v == null ? '' : v).replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };
  const rs = (v) => `₹${fmt(Math.round(v))}`;
  const rsShort = (v) => (v >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(2)} L` : rs(v));
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function iso(cell) {
    if (!cell) return '';
    const v = cell.v, f = String(cell.f || '');
    let m = /^Date\((\d+),(\d+),(\d+)/.exec(String(v || ''));
    if (m) return `${m[1]}-${String(Number(m[2]) + 1).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(f || String(v || ''));
    if (m && MON[m[2].toLowerCase()]) return `${m[3]}-${String(MON[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f || String(v || ''));
    return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
  }
  function parse(t) {
    // header: gviz labels (headers=1) — "VC4 Txn", "VC4 ₹", …
    const labels = (t.cols || []).map((c) => String(c.label || '').trim());
    const at = (name) => labels.findIndex((l) => l.toLowerCase() === name.toLowerCase());
    const cTxn = at('Toll Debit Txn'), cAmt = at('Toll Debit ₹'), cVeh = at('Unique Vehicles'), cSt = at('Status');
    const classes = [];
    labels.forEach((l, i) => { const m = /^(.+) Txn$/.exec(l); if (m && m[1] !== 'Toll Debit') { const a = labels.findIndex((x) => x === `${m[1]} ₹`); classes.push({ k: m[1], n: i, a }); } });
    const days = [];
    (t.rows || []).forEach((r) => {
      const d = iso(r[0]); if (!d) return;
      const st = cSt >= 0 && r[cSt] ? String(r[cSt].v == null ? (r[cSt].f || '') : r[cSt].v) : '';
      const o = { date: d, day: Number(d.slice(8, 10)), ym: d.slice(0, 7), txn: num(r[cTxn] && r[cTxn].v), amt: num(r[cAmt] && r[cAmt].v), veh: cVeh >= 0 ? num(r[cVeh] && r[cVeh].v) : 0, cls: {}, status: st, ok: /✅/.test(st) };
      classes.forEach((c) => { const n = num(r[c.n] && r[c.n].v), a = c.a >= 0 ? num(r[c.a] && r[c.a].v) : 0; if (n || a) o.cls[c.k] = { n, amt: a }; });
      days.push(o);
    });
    days.sort((a, b) => (a.date < b.date ? -1 : 1));
    const okDays = days.filter((d) => d.ok);
    const isTvc = (d) => /^✅\s*TVC/i.test(d.status);
    const basis = okDays.length && okDays.every(isTvc) ? 'TVC' : okDays.some(isTvc) ? 'TVC + CCH (purane din)' : 'CCH';
    return { days, classes: classes.map((c) => c.k), basis };
  }
  async function load(fresh) {
    if (!fresh && state.days.length && Date.now() - state.at < 10 * 60e3) return state;
    if (state.promise) return state.promise;
    state.promise = (async () => {
      const p = new URLSearchParams({ tqx: 'out:json', gid: GID, range: 'A1:AK400', headers: '1' });
      if (FF.config && FF.config.gvSheetId) p.set('id', FF.config.gvSheetId);
      if (fresh) p.set('fresh', '1');
      const res = await fetch(`${(FF.config && FF.config.proxyPath) || '/api/gviz'}?${p.toString()}`, { credentials: 'same-origin' });
      const text = await res.text();
      if (!res.ok) { let m = `Toll Debit sheet nahi mili (${res.status})`; try { m = JSON.parse(text).error || m; } catch { /* text */ } throw new Error(m); }
      const out = parse(FF.data.parseGviz(text));
      Object.assign(state, out, { at: Date.now(), err: '' });
      return state;
    })();
    try { return await state.promise; } finally { state.promise = null; }
  }
  /** Ek mahine ka nichod — Gems aur page dono yahi use karte hain. */
  function month(ym) {
    const all = state.days.filter((d) => d.ok);
    const m = ym || (all.length ? all[all.length - 1].ym : '');
    const days = all.filter((d) => d.ym === m);
    const cls = {}; let txn = 0, amt = 0;
    days.forEach((d) => { txn += d.txn; amt += d.amt; Object.entries(d.cls).forEach(([k, v]) => { const o = cls[k] || (cls[k] = { k, n: 0, amt: 0 }); o.n += v.n; o.amt += v.amt; }); });
    const best = days.slice().sort((a, b) => b.amt - a.amt)[0] || null, last = days[days.length - 1] || null;
    const missing = state.days.filter((d) => d.ym === m && !d.ok);
    return { ym: m, days, txn, amt, avgTxn: days.length ? txn / days.length : 0, avgAmt: days.length ? amt / days.length : 0, best, last, missing, classes: Object.values(cls).sort((a, b) => b.amt - a.amt), basis: state.basis };
  }
  const dLabel = (d) => { const dt = new Date(`${d}T00:00:00`); return `${Number(d.slice(8, 10))} ${dt.toLocaleString('en-IN', { month: 'short' })} · ${dt.toLocaleString('en-IN', { weekday: 'short' })}`; };

  function paint(root) {
    const M = month(), mx = Math.max(1, ...M.days.map((d) => d.amt));
    const mName = M.ym ? new Date(`${M.ym}-01T00:00:00`).toLocaleString('en-IN', { month: 'long', year: 'numeric' }) : '';
    const kpi = (icon, title, value, sub) => `<div class="kpi"><div class="kpi-top"><span class="kpi-title">${esc(title)}</span><span class="kpi-icon">${icon}</span></div><div class="kpi-value">${value}</div><div class="kpi-sub dim small">${sub || ''}</div></div>`;
    const clsCols = M.classes.map((c) => c.k);
    root.innerHTML = `
      <section class="card">
        <div class="card-head"><div><h3>🛣 Toll Debit — ${esc(mName)}</h3><span class="dim small">Source: "${esc(TAB)}" tab · IDFC "EToll 2.0 – All Transactions Report" · class basis: <b>${esc(M.basis)}</b> · ${M.days.length} din ka data</span></div>
          <div class="card-actions"><button type="button" class="btn small" data-td="csv">⬇ CSV</button> <button type="button" class="btn small" data-td="refresh">↻ Refresh</button></div></div>
        <div class="kpi-grid">
          ${kpi('💸', 'Total toll debit', rsShort(M.amt), `${rs(M.amt)}`)}
          ${kpi('🧾', 'Transactions', fmt(M.txn), `roz ${fmt(Math.round(M.avgTxn))}`)}
          ${kpi('📅', 'Roz ka average', rsShort(M.avgAmt), M.last ? `kal/aakhri din (${esc(dLabel(M.last.date))}): ${rsShort(M.last.amt)}` : '')}
          ${kpi('🏆', 'Sabse bada din', M.best ? rsShort(M.best.amt) : '—', M.best ? esc(dLabel(M.best.date)) : '')}
        </div>
        ${M.missing.length ? `<div class="notice warn small">⚠ ${M.missing.length} din ka data nahi aaya: ${M.missing.map((d) => `${esc(dLabel(d.date))} (${esc(d.status.replace(/^⚠\s*/, '') || 'pending')})`).join(' · ')}</div>` : ''}
      </section>
      <section class="card">
        <div class="card-head"><div><h3>🚗 Class-wise (${esc(M.basis)})</h3><span class="dim small">${esc(mName)} · ₹ ke hisaab se</span></div></div>
        <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Class</th><th class="num">Transactions</th><th class="num">Txn %</th><th class="num">Toll ₹</th><th class="num">₹ %</th><th class="num">Avg ₹ / txn</th><th style="width:28%">Share</th></tr></thead><tbody>
          ${M.classes.map((c) => `<tr><td><b>${esc(c.k)}</b></td><td class="num">${fmt(c.n)}</td><td class="num">${M.txn ? (c.n / M.txn * 100).toFixed(1) : 0}%</td><td class="num"><b>${rs(c.amt)}</b></td><td class="num">${M.amt ? (c.amt / M.amt * 100).toFixed(1) : 0}%</td><td class="num">${c.n ? rs(c.amt / c.n) : '—'}</td><td><div class="td-bar"><i style="width:${M.amt ? Math.max(1, c.amt / M.amt * 100) : 0}%"></i></div></td></tr>`).join('')}
          <tr class="total"><td><b>Total</b></td><td class="num"><b>${fmt(M.txn)}</b></td><td class="num">100%</td><td class="num"><b>${rs(M.amt)}</b></td><td class="num">100%</td><td class="num">${M.txn ? rs(M.amt / M.txn) : '—'}</td><td></td></tr>
        </tbody></table></div>
      </section>
      <section class="card">
        <div class="card-head"><div><h3>📆 Date-wise</h3><span class="dim small">Har din ki ginti + ₹ · class-wise transactions</span></div></div>
        <div class="table-wrap tall"><table class="tbl compact"><thead><tr><th>Date</th><th class="num">Txn</th><th class="num">Toll ₹</th><th style="min-width:120px">₹ trend</th><th class="num">Vehicles</th>${clsCols.map((k) => `<th class="num">${esc(k)}</th>`).join('')}</tr></thead><tbody>
          ${M.days.slice().reverse().map((d) => `<tr><td><b>${esc(dLabel(d.date))}</b></td><td class="num">${fmt(d.txn)}</td><td class="num"><b>${rs(d.amt)}</b></td><td><div class="td-bar"><i style="width:${Math.max(1, d.amt / mx * 100)}%"></i></div></td><td class="num">${d.veh ? fmt(d.veh) : '—'}</td>${clsCols.map((k) => `<td class="num" title="${d.cls[k] ? rs(d.cls[k].amt) : ''}">${d.cls[k] ? fmt(d.cls[k].n) : '—'}</td>`).join('')}</tr>`).join('')}
        </tbody></table></div>
      </section>`;
    root.querySelector('[data-td="refresh"]').addEventListener('click', async (e) => { e.target.disabled = true; try { await load(true); paint(root); } catch (err) { U.toast(String(err.message || err), 'error'); e.target.disabled = false; } });
    root.querySelector('[data-td="csv"]').addEventListener('click', () => {
      const head = ['Date', 'Txn', 'Toll Rs', 'Unique Vehicles', ...clsCols.flatMap((k) => [`${k} Txn`, `${k} Rs`])];
      U.downloadCsv(`toll-debit-${M.ym}.csv`, head, M.days.map((d) => [d.date, d.txn, Math.round(d.amt), d.veh || '', ...clsCols.flatMap((k) => [d.cls[k] ? d.cls[k].n : 0, d.cls[k] ? Math.round(d.cls[k].amt) : 0])]));
    });
  }
  async function render(root) {
    root.innerHTML = U.spinner('Toll debit data aa raha hai…');
    try { await load(false); } catch (err) { root.innerHTML = U.errorBox(err); return; }
    if (!state.days.length) { root.innerHTML = `<section class="card"><p>"${esc(TAB)}" tab me abhi koi data nahi. Sheet me Apps Script (TollDebitDaily.gs) chala kar dekho.</p></section>`; return; }
    paint(root);
  }
  FF.tollDebit = { load, month, parse, rs, rsShort, dLabel, _state: state };
  FF.pages.tollDebit = { title: 'Toll Debit', render };
})(window.FF);
