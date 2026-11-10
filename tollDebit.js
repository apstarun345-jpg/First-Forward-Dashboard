/* 🛣 Toll Debit (v3.125.172) — Reports → Toll Debit
   Data: "Toll Debit Daily" tab (GV workbook). Wo tab Apps Script (TollDebitDaily.gs) roz IDFC ki
   "EToll 2.0 - All Transactions Report" mail se bharti hai: date-wise + class-wise (TVC) toll debit
   ki ginti aur ₹. Ye page sirf wahi summary padhta hai — poora report site par nahi aata. */
(function (FF) {
  'use strict';
  const U = FF.util, esc = U.esc, fmt = U.fmt;
  const GID = '734237361', TAB = 'Toll Debit Daily';
  const state = { at: 0, days: [], classes: [], basis: '', members: {}, promise: null, err: '', cch: false };
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
  const tvcOf = (k) => { try { return (U.tvcClass && /^VC\d+$/i.test(k) && U.tvcClass(k)) || k; } catch { return k; } };
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
      // Sheet CCH-wise hai → site par TVC-wise: Settings ke CCH→TVC group (VC5+VC9 = VC5, VC8+VC11 = VC6 …). VC4 / VC20 alag hi.
      o.cch = {};
      classes.forEach((c) => { const n = num(r[c.n] && r[c.n].v), a = c.a >= 0 ? num(r[c.a] && r[c.a].v) : 0; if (!(n || a)) return; o.cch[c.k] = { n, amt: a }; const k = tvcOf(c.k), g = o.cls[k] || (o.cls[k] = { n: 0, amt: 0 }); g.n += n; g.amt += a; });
      days.push(o);
    });
    days.sort((a, b) => (a.date < b.date ? -1 : 1));
    const members = {}; classes.forEach((c) => { const k = tvcOf(c.k); (members[k] || (members[k] = [])).push(c.k); });
    return { days, classes: classes.map((c) => c.k), basis: 'TVC', members };
  }
  async function load(fresh) {
    if (!fresh && state.days.length && Date.now() - state.at < 10 * 60e3) return state;
    if (state.promise) return state.promise;
    state.promise = (async () => {
      const p = new URLSearchParams({ tqx: 'out:json', gid: GID, range: 'A1:AK400', headers: '1', prio: '1' });
      if (FF.config && FF.config.gvSheetId) p.set('id', FF.config.gvSheetId);
      if (fresh) p.set('fresh', '1');
      const res = await Promise.race([fetch(`${(FF.config && FF.config.proxyPath) || '/api/gviz'}?${p.toString()}`, { credentials: 'same-origin' }), new Promise((_, rej) => setTimeout(() => rej(new Error('Google Sheet abhi busy hai (rate limit) — 1 minute baad ↻ dabao.')), 45000))]);
      const text = await res.text();
      if (!res.ok) { let m = `Toll Debit sheet nahi mili (${res.status})`; try { m = JSON.parse(text).error || m; } catch { /* text */ } throw new Error(m); }
      const out = parse(FF.data.parseGviz(text));
      Object.assign(state, out, { at: Date.now(), err: '' });
      return state;
    })();
    try { return await state.promise; } finally { state.promise = null; }
  }
  /** Ek mahine ka nichod — Gems aur page dono yahi use karte hain. */
  function month(ym, cch) {
    const all = state.days.filter((d) => d.ok);
    const m = ym || (all.length ? all[all.length - 1].ym : '');
    const days = all.filter((d) => d.ym === m);
    const cls = {}; let txn = 0, amt = 0;
    days.forEach((d) => { txn += d.txn; amt += d.amt; Object.entries(cch ? d.cch : d.cls).forEach(([k, v]) => { const o = cls[k] || (cls[k] = { k, n: 0, amt: 0 }); o.n += v.n; o.amt += v.amt; }); });
    const best = days.slice().sort((a, b) => b.amt - a.amt)[0] || null, last = days[days.length - 1] || null;
    const missing = state.days.filter((d) => d.ym === m && !d.ok);
    return { ym: m, days, txn, amt, avgTxn: days.length ? txn / days.length : 0, avgAmt: days.length ? amt / days.length : 0, best, last, missing, classes: Object.values(cls).sort((a, b) => b.amt - a.amt), basis: cch ? 'CCH' : 'TVC', members: state.members || {}, cch: !!cch };
  }
  const dLabel = (d) => { const dt = new Date(`${d}T00:00:00`); return `${Number(d.slice(8, 10))} ${dt.toLocaleString('en-IN', { month: 'short' })} · ${dt.toLocaleString('en-IN', { weekday: 'short' })}`; };

  const TONE = { VC4: '#2563eb', VC20: '#7c3aed', VC5: '#059669', VC6: '#d97706', VC7: '#db2777', VC12: '#dc2626', VC16: '#0891b2' };
  const PAL = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#db2777', '#dc2626', '#0891b2', '#65a30d', '#9333ea', '#ea580c', '#0d9488', '#be123c', '#4f46e5', '#ca8a04', '#475569'];
  const colorOf = (k, i) => TONE[k] || PAL[i % PAL.length];
  function paint(root) {
    const M = month('', state.cch), dc = (d) => (state.cch ? d.cch : d.cls);
    const memb = (k) => (!state.cch && M.members[k] && (M.members[k].length > 1 || M.members[k][0] !== k) ? ` <small class="dim">(CCH ${M.members[k].join(' + ')})</small>` : '');
    const mName = M.ym ? new Date(`${M.ym}-01T00:00:00`).toLocaleString('en-IN', { month: 'long', year: 'numeric' }) : '';
    const kpi = (tone, icon, title, value, foot) => `<div class="kpi ${tone}"><div class="kpi-top"><span class="kpi-title">${esc(title)}</span><span class="kpi-icon">${icon}</span></div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot || ''}</div></div>`;
    // run-rate: jitne din ka data aaya (aakhri din = kal / ek din peeche) uske hisaab se; andaaza = run-rate × mahine ke din
    const dim = M.ym ? new Date(Number(M.ym.slice(0, 4)), Number(M.ym.slice(5, 7)), 0).getDate() : 30, nd = M.days.length || 1;
    const expAmt = M.avgAmt * dim, expTxn = M.avgTxn * dim, lastLbl = M.last ? dLabel(M.last.date) : '';
    const prev = M.days.length > 1 ? M.days[M.days.length - 2] : null, dPct = prev && prev.amt ? Math.round((M.last.amt - prev.amt) / prev.amt * 100) : null;
    const topTxn = M.classes.slice().sort((x, y) => y.n - x.n)[0], topAmt = M.classes[0];
    const order = M.classes.map((c) => c.k), colIdx = (k) => order.indexOf(k);
    // sorting (header par click: ▲ / ▼)
    const sc = state.sortCls || (state.sortCls = { k: 'amt', dir: -1 }), sd = state.sortDay || (state.sortDay = { k: 'date', dir: -1 });
    const clsRows = M.classes.map((c) => ({ ...c, avg: c.n ? c.amt / c.n : 0 })).sort((x, y) => (sc.k === 'k' ? String(x.k).localeCompare(String(y.k), undefined, { numeric: true }) : x[sc.k] - y[sc.k]) * sc.dir);
    const dv = (d, k) => (k === 'date' ? d.date : k === 'txn' ? d.txn : k === 'amt' ? d.amt : k === 'veh' ? d.veh : (dc(d)[k.slice(4)] || { n: 0 }).n);
    const dayRows = M.days.slice().sort((x, y) => { const p = dv(x, sd.k), q = dv(y, sd.k); return (p < q ? -1 : p > q ? 1 : 0) * sd.dir; });
    const th = (grp, key, label, cur, extra) => `<th class="td-sort ${extra || ''}${cur.k === key ? ' on' : ''}" data-td-sort="${grp}:${esc(key)}" title="Click: chhota → bada / bada → chhota">${label} <span class="td-arr">${cur.k === key ? (cur.dir > 0 ? '▲' : '▼') : '↕'}</span></th>`;
    const mxDay = Math.max(1, ...M.days.map((d) => d.amt)), mxCls = {}; order.forEach((k) => { mxCls[k] = Math.max(1, ...M.days.map((d) => (dc(d)[k] || { n: 0 }).n)); });
    const heat = (k, n) => { const a = Math.min(1, n / mxCls[k]); return `background:${colorOf(k, colIdx(k))}${Math.round(18 + a * 70).toString(16).padStart(2, '0')}`; };
    const chipC = (k) => `<span class="td-chip" style="background:${colorOf(k, colIdx(k))}">${esc(k)}</span>`;
    root.innerHTML = `
      <section class="card">
        <div class="card-head"><div><h3>🛣 Toll Debit — ${esc(mName)}</h3><span class="dim small">Source: "${esc(TAB)}" tab · IDFC "EToll 2.0 – All Transactions Report" · class: <b>${esc(M.basis)} wise</b> · ${M.days.length} din ka data${lastLbl ? ` · aakhri din ${esc(lastLbl)} (ek din peeche)` : ''}</span></div>
          <div class="card-actions"><button type="button" class="btn small" data-td="csv">⬇ CSV</button> <button type="button" class="btn small" data-td="refresh">↻ Refresh</button></div></div>
        <div class="kpi-grid">
          ${kpi('g1', '💸', 'Total toll debit', rsShort(M.amt), `${rs(M.amt)} · ${M.days.length} din`)}
          ${kpi('g3', '🧾', 'Transactions', fmt(M.txn), `avg ${M.txn ? rs(M.amt / M.txn) : '—'} / txn`)}
          ${kpi('g5', '⚡', `Run-rate (${esc(lastLbl.split(' · ')[0] || '')} tak)`, `${rsShort(M.avgAmt)}<small>/din</small>`, `${fmt(Math.round(M.avgTxn))} txn/din · ${nd} din ke data se`)}
          ${kpi('g4', '🎯', `${esc(mName.split(' ')[0])} ka andaaza`, rsShort(expAmt), `${fmt(Math.round(expTxn))} txn · run-rate × ${dim} din`)}
          ${kpi('g8', '📅', `Aakhri din · ${esc(lastLbl)}`, M.last ? rsShort(M.last.amt) : '—', M.last ? `${fmt(M.last.txn)} txn${dPct != null ? ` · pichhle din se ${dPct >= 0 ? '▲' : '▼'} ${Math.abs(dPct)}%` : ''}` : '')}
          ${kpi('g2', '🏆', 'Sabse bada din', M.best ? rsShort(M.best.amt) : '—', M.best ? `${esc(dLabel(M.best.date))} · ${fmt(M.best.txn)} txn` : '')}
          ${kpi('g6', '🚗', 'Sabse zyada txn wali class', topTxn ? esc(topTxn.k) : '—', topTxn ? `${fmt(topTxn.n)} txn · ${(topTxn.n / Math.max(1, M.txn) * 100).toFixed(1)}% · ${rsShort(topTxn.amt)}` : '')}
          ${kpi('g7', '💰', 'Sabse zyada ₹ wali class', topAmt ? esc(topAmt.k) : '—', topAmt ? `${rsShort(topAmt.amt)} · ${(topAmt.amt / Math.max(1, M.amt) * 100).toFixed(1)}% · ${fmt(topAmt.n)} txn` : '')}
        </div>
        ${M.missing.length ? `<div class="notice warn small">⚠ ${M.missing.length} din ka data nahi aaya: ${M.missing.map((d) => `${esc(dLabel(d.date))} (${esc(d.status.replace(/^⚠\s*/, '') || 'pending')})`).join(' · ')} — run-rate me ye din nahi gine.</div>` : ''}
      </section>
      <section class="card">
        <div class="card-head"><div><h3>🚗 Class-wise (${esc(M.basis)})</h3><span class="dim small">${esc(mName)}${state.cch ? '' : ' · CCH → TVC group Settings ke hisaab se'} · heading par click karke chhota-bada karo</span></div><div class="card-actions"><button type="button" class="btn small" data-td="mode">${state.cch ? '🔁 TVC wise dekho' : '🔁 CCH wise dekho'}</button></div></div>
        <div class="table-wrap"><table class="tbl compact td-tbl"><thead><tr>${th('c', 'k', 'Class', sc)}${th('c', 'n', 'Transactions', sc, 'num')}<th class="num">Txn %</th>${th('c', 'amt', 'Toll ₹', sc, 'num')}<th class="num">₹ %</th>${th('c', 'avg', 'Avg ₹ / txn', sc, 'num')}<th class="num">Roz ₹ (run-rate)</th><th style="width:22%">Share (₹)</th></tr></thead><tbody>
          ${clsRows.map((c) => { const col = colorOf(c.k, colIdx(c.k)); return `<tr style="background:${col}12"><td>${chipC(c.k)}${memb(c.k)}${topTxn && c.k === topTxn.k ? ' <span class="td-badge">🏆 sabse zyada txn</span>' : ''}</td><td class="num"><b>${fmt(c.n)}</b></td><td class="num">${M.txn ? (c.n / M.txn * 100).toFixed(1) : 0}%</td><td class="num"><b style="color:${col}">${rs(c.amt)}</b></td><td class="num">${M.amt ? (c.amt / M.amt * 100).toFixed(1) : 0}%</td><td class="num">${c.n ? rs(c.avg) : '—'}</td><td class="num">${rsShort(c.amt / nd)}</td><td><div class="td-bar"><i style="width:${M.amt ? Math.max(1, c.amt / M.amt * 100) : 0}%;background:${col}"></i></div></td></tr>`; }).join('')}
          <tr class="total td-total"><td><b>Total</b></td><td class="num"><b>${fmt(M.txn)}</b></td><td class="num">100%</td><td class="num"><b>${rs(M.amt)}</b></td><td class="num">100%</td><td class="num">${M.txn ? rs(M.amt / M.txn) : '—'}</td><td class="num"><b>${rsShort(M.avgAmt)}</b></td><td></td></tr>
        </tbody></table></div>
      </section>
      <section class="card">
        <div class="card-head"><div><h3>📆 Date-wise</h3><span class="dim small">Har din ki ginti + ₹ · class-wise transactions (gehra rang = us class ka bada din) · heading par click karke sort</span></div></div>
        <div class="table-wrap tall"><table class="tbl compact td-tbl"><thead><tr>${th('d', 'date', 'Date', sd)}${th('d', 'txn', 'Txn', sd, 'num')}${th('d', 'amt', 'Toll ₹', sd, 'num')}<th style="min-width:120px">₹ trend</th>${th('d', 'veh', 'Vehicles', sd, 'num')}${order.map((k) => th('d', `cls:${k}`, chipC(k), sd, 'num')).join('')}</tr></thead><tbody>
          ${dayRows.map((d) => { const hi = M.best && d.date === M.best.date, wk = /Sun/.test(dLabel(d.date)); return `<tr${hi ? ' class="td-best"' : ''}><td><b>${esc(dLabel(d.date))}</b>${hi ? ' 🏆' : ''}${wk ? ' <small class="dim">chhutti</small>' : ''}</td><td class="num">${fmt(d.txn)}</td><td class="num"><b>${rs(d.amt)}</b></td><td><div class="td-bar"><i style="width:${Math.max(1, d.amt / mxDay * 100)}%;background:${d.amt >= M.avgAmt ? 'linear-gradient(90deg,#059669,#10b981)' : 'linear-gradient(90deg,#f59e0b,#f97316)'}"></i></div></td><td class="num">${d.veh ? fmt(d.veh) : '—'}</td>${order.map((k) => { const v = dc(d)[k]; return `<td class="num" style="${v ? heat(k, v.n) : ''}" title="${v ? `${esc(k)}: ${rs(v.amt)}` : ''}">${v ? fmt(v.n) : '—'}</td>`; }).join('')}</tr>`; }).join('')}
          <tr class="total td-total"><td><b>Total</b></td><td class="num"><b>${fmt(M.txn)}</b></td><td class="num"><b>${rs(M.amt)}</b></td><td></td><td class="num">—</td>${order.map((k) => `<td class="num"><b>${fmt((M.classes.find((c) => c.k === k) || { n: 0 }).n)}</b></td>`).join('')}</tr>
          <tr class="td-total"><td><b>Run-rate / din</b></td><td class="num">${fmt(Math.round(M.avgTxn))}</td><td class="num"><b>${rs(M.avgAmt)}</b></td><td></td><td class="num">—</td>${order.map((k) => `<td class="num">${fmt(Math.round((M.classes.find((c) => c.k === k) || { n: 0 }).n / nd))}</td>`).join('')}</tr>
        </tbody></table></div>
      </section>`;
    root.querySelector('[data-td="refresh"]').addEventListener('click', async (e) => { e.target.disabled = true; try { await load(true); paint(root); } catch (err) { U.toast(String(err.message || err), 'error'); e.target.disabled = false; } });
    root.querySelector('[data-td="mode"]').addEventListener('click', () => { state.cch = !state.cch; state.sortDay = null; paint(root); });
    root.querySelectorAll('[data-td-sort]').forEach((el) => el.addEventListener('click', () => {
      const [g, ...rest] = el.dataset.tdSort.split(':'), key = rest.join(':'), cur = g === 'c' ? state.sortCls : state.sortDay;
      if (cur.k === key) cur.dir = -cur.dir; else { cur.k = key; cur.dir = key === 'k' || key === 'date' ? 1 : -1; }
      paint(root);
    }));
    root.querySelector('[data-td="csv"]').addEventListener('click', () => {
      const head = ['Date', 'Txn', 'Toll Rs', 'Unique Vehicles', ...order.flatMap((k) => [`${k} Txn`, `${k} Rs`])];
      U.downloadCsv(`toll-debit-${M.basis.toLowerCase()}-${M.ym}.csv`, head, M.days.map((d) => [d.date, d.txn, Math.round(d.amt), d.veh || '', ...order.flatMap((k) => [dc(d)[k] ? dc(d)[k].n : 0, dc(d)[k] ? Math.round(dc(d)[k].amt) : 0])]));
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
