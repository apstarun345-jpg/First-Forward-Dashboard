/* 📅 Custom date-range report: koi bhi from → to range chuno (ya preset), FF + GV dono ka
   combined report — KPIs, daily FF vs GV chart, GV agent/TL tables, FF class split, Excel. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, S = FF.store, G = FF.gv, C = FF.charts;
  const esc = U.esc;
  const card = (title, body, right) => `<section class="card"><div class="card-head"><h3>${title}</h3>${right ? `<div class="card-right">${right}</div>` : ''}</div><div class="card-body">${body}</div></section>`;

  const view = { from: '', to: '', weekly: false };
  const todayKey = () => U.dateKey(new Date());
  const monthStart = (d) => U.dateKey(new Date(d.getFullYear(), d.getMonth(), 1));

  function defaultRange() {
    const now = new Date();
    return { from: monthStart(now), to: todayKey() };
  }
  function presets() {
    const now = new Date();
    const back = (days) => { const d = new Date(now); d.setDate(d.getDate() - days + 1); return U.dateKey(d); };
    const lastM = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    return [
      { id: 'today', label: 'Aaj', from: todayKey(), to: todayKey() },
      { id: '7', label: 'Last 7 din', from: back(7), to: todayKey() },
      { id: 'month', label: 'Is mahine', from: monthStart(now), to: todayKey() },
      { id: 'lastmonth', label: 'Pichla mahina', from: U.dateKey(lastM), to: U.dateKey(lastEnd) },
      { id: '30', label: 'Last 30 din', from: back(30), to: todayKey() }
    ];
  }
  function normalize() {
    if (!view.from || !view.to || view.from > view.to) { const d = defaultRange(); if (!view.from) view.from = d.from; if (!view.to || view.from > view.to) view.to = d.to; }
    const days = Math.round((U.fromDateKey(view.to) - U.fromDateKey(view.from)) / 86400e3) + 1;
    return days;
  }

  async function render(root, params) {
    if (params.from) view.from = params.from;
    if (params.to) view.to = params.to;
    if (!view.from || !view.to) Object.assign(view, defaultRange());
    normalize();
    root.innerHTML = `<div class="page-head"><div><h1>📅 Custom Range Report</h1><p class="sub">Koi bhi date range chuno → First Forward + GV ka combined report: KPIs, daily chart, agent & TL tables, Excel</p></div>
      <div class="head-actions"><button class="btn primary" data-action="refresh">↻ Refresh</button></div></div>
      <div class="card controls">
        <div class="finder-row">
          <label>From <input class="input" type="date" id="rr-from" value="${esc(view.from)}"></label>
          <label>To <input class="input" type="date" id="rr-to" value="${esc(view.to)}"></label>
          <button class="btn primary" id="rr-go">📊 Report banao</button>
          <button class="btn" id="rr-xlsx">⬇ Excel</button>
        </div>
        <div class="chip-row" id="rr-presets">${presets().map((p) => `<button class="chip ${p.from === view.from && p.to === view.to ? 'on' : ''}" data-preset-from="${p.from}" data-preset-to="${p.to}">${p.label}</button>`).join('')}<button class="chip" id="rr-all">🗓 Poora data</button></div>
      </div>
      <div id="rr-body">${U.spinner('Range report ban raha hai…')}</div>`;
    const body = U.$('#rr-body', root);

    let R = null;
    try { R = await build(); } catch (err) { body.innerHTML = U.errorBox(err, 'data-action="refresh"'); return; }
    if (!root.isConnected) return;

    const days = R.days;
    const fromIn = U.$('#rr-from', root), toIn = U.$('#rr-to', root);
    if (R.minKey) { fromIn.min = R.minKey; toIn.min = R.minKey; }
    if (R.maxKey) { fromIn.max = R.maxKey; toIn.max = R.maxKey; }

    const kpi = (title, value, icon, foot) => `<div class="kpi"><div class="kpi-top"><span class="kpi-title">${title}</span><span class="kpi-icon">${icon}</span></div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot || ''}</div></div>`;
    const ff = R.ff, gv = R.gv;
    body.innerHTML = `<p class="dim small">Range: <b>${esc(U.labelDateKey(view.from, true))}</b> → <b>${esc(U.labelDateKey(view.to, true))}</b> · ${U.fmt(days)} din${view.weekly ? ' · weekly chart (range lambi hai)' : ''}</p>
      <div class="kpi-grid">
        ${kpi('First Forward tags', U.fmt(ff.issuance), '🟦', `${U.fmt(ff.replacement)} replacement · avg ${U.fmt(Math.round(ff.issuance / Math.max(1, ff.activeDays)))}/day`)}
        ${kpi('GV tags', U.fmt(gv.total), '🟩', `${U.fmt(gv.replacement)} replacement · avg ${U.fmt(Math.round(gv.total / Math.max(1, gv.activeDays)))}/day`)}
        ${kpi('Combined', U.fmt(ff.issuance + gv.total), '🏷️', `${esc(U.labelDateKey(view.from))} → ${esc(U.labelDateKey(view.to))}`)}
        ${kpi('VC4 tags (GV)', U.fmt(gv.vc4), '🚗', gv.total ? `${U.fmtPct((gv.vc4 / gv.total) * 100, 1)} of GV` : '')}
        ${kpi('Commercial (GV)', U.fmt(gv.comm), '🚚', gv.total ? `${U.fmtPct((gv.comm / gv.total) * 100, 1)} of GV` : '')}
        ${kpi('GV commission', `₹${U.fmt(Math.round(gv.amount))}`, '💰', `${U.fmt(gv.rows)} entries`)}
      </div>
      ${card(`📈 Daily trend <span class="dim">· FF vs GV · ${U.fmt(days)} din</span>`,
        days ? C.lines({ labels: R.labels, tipLabels: R.tipLabels, height: 260, series: [
          { name: 'First Forward', values: R.ffSeries },
          { name: 'GV Partner', values: R.gvSeries, color: '#10b981' }
        ] }) : '<div class="empty-state">Is range me koi data nahi mila.</div>')}
      <div class="grid g-2">
        ${card(`🧑‍💼 GV agents <span class="dim">· range me top ${Math.min(100, R.gvAgents.length)}</span>`,
          R.gvAgents.length ? `<div class="table-wrap tall"><table class="tbl sticky-first"><thead><tr><th>#</th><th>Agent / TL</th><th class="num">Tags</th><th class="num">VC4</th><th class="num">Comm</th><th class="num">Repl.</th><th class="num">Active din</th></tr></thead><tbody>${R.gvAgents.slice(0, 100).map((a, i) => `<tr><td>${i + 1}</td><td><b>${esc(a.agentName)}</b><br><small class="dim">${esc(a.tlName)}</small></td><td class="num"><b>${U.fmt(a.total)}</b></td><td class="num">${U.fmt(a.vc4)}</td><td class="num">${U.fmt(a.comm)}</td><td class="num">${U.fmt(a.replacement)}</td><td class="num">${U.fmt(a.activeDays)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">GV data nahi mila.</div>')}
        ${card(`👥 GV TL-wise <span class="dim">· range me</span>`,
          R.gvTls.length ? `<div class="table-wrap tall"><table class="tbl sticky-first"><thead><tr><th>#</th><th>Team Leader</th><th class="num">Tags</th><th class="num">VC4</th><th class="num">Agents</th></tr></thead><tbody>${R.gvTls.map((t, i) => `<tr><td>${i + 1}</td><td><b>${esc(t.tlName)}</b></td><td class="num"><b>${U.fmt(t.total)}</b></td><td class="num">${U.fmt(t.vc4)}</td><td class="num">${U.fmt(t.agents)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">GV data nahi mila.</div>')}
      </div>
      ${card(`🟦 First Forward class split <span class="dim">· range me</span>`,
        R.ffCls.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Class</th><th>Group</th><th class="num">Issuance</th><th class="num">Replacement</th><th class="num">Total</th></tr></thead><tbody>${R.ffCls.map((c) => `<tr><td><b>${esc(c.cls)}</b></td><td>${esc(c.group)}</td><td class="num">${U.fmt(c.issuance)}</td><td class="num">${U.fmt(c.replacement)}</td><td class="num"><b>${U.fmt(c.total)}</b></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">FF data nahi mila.</div>',
        `<button class="btn small" id="rr-print">🖨 Print / PDF</button>`)}
      <p class="dim small">FF numbers EIR daily sheet se (date-accurate) · GV numbers GV Master se (date-accurate) · Commission sirf GV entries ke liye available hai.</p>`;
    C.mount(body);

    function go() {
      view.from = fromIn.value || view.from;
      view.to = toIn.value || view.to;
      normalize();
      FF.app.navigate('rangeReport', { from: view.from, to: view.to });
      if (FF.notifications && FF.notifications.logClick) FF.notifications.logClick('Range report', `${view.from} → ${view.to}`);
    }
    U.$('#rr-go', root).addEventListener('click', go);
    [fromIn, toIn].forEach((el) => el.addEventListener('change', go));
    root.addEventListener('click', (e) => {
      const p = e.target.closest('[data-preset-from]');
      if (p) { fromIn.value = p.dataset.presetFrom; toIn.value = p.dataset.presetTo; go(); return; }
      if (e.target.closest('#rr-all')) { if (R.minKey && R.maxKey) { fromIn.value = R.minKey; toIn.value = R.maxKey; go(); } return; }
      if (e.target.closest('#rr-xlsx')) { exportExcel(R); return; }
      if (e.target.closest('#rr-print')) {
        U.printReport({ title: `${FF.config.brand} — Custom range report`, subtitle: `${U.labelDateKey(view.from, true)} → ${U.labelDateKey(view.to, true)} (${R.days} din)`, html: (U.$('#rr-body', root) || root).innerHTML });
        return;
      }
    });
  }

  // ---- aggregate -----------------------------------------------------------------------------------
  async function build() {
    const [dailyR, masterR] = await Promise.allSettled([S.need('daily'), G.enabled() ? G.need('master') : Promise.resolve([])]);
    const daily = dailyR.status === 'fulfilled' ? dailyR.value : [];
    const master = masterR.status === 'fulfilled' ? G.rows() : [];
    const from = view.from, to = view.to;
    const fromD = U.fromDateKey(from), toEnd = new Date(U.fromDateKey(to).getTime() + 86399e3);
    const days = Math.round((U.fromDateKey(to) - fromD) / 86400e3) + 1;

    const allKeys = daily.map((r) => r.key).concat(master.filter((r) => r.date).map((r) => U.dateKey(r.date)));
    const minKey = allKeys.length ? allKeys.reduce((a, b) => (a < b ? a : b)) : '';
    const maxKey = allKeys.length ? allKeys.reduce((a, b) => (a > b ? a : b)) : '';

    // FF side (EIR daily rows are pre-aggregated by date)
    const ff = { issuance: 0, replacement: 0, vc4: 0, days: new Set(), rows: 0 };
    const ffByDay = new Map(), ffClsMap = new Map();
    for (const r of daily) {
      if (r.key < from || r.key > to || r.channel === 'GV Partner') continue;
      ff.rows++;
      if (r.type === 'REPLACEMENT') ff.replacement += r.n; else ff.issuance += r.n;
      if (r.group === 'VC4') ff.vc4 += r.n;
      ff.days.add(r.key);
      ffByDay.set(r.key, (ffByDay.get(r.key) || 0) + r.n);
      const c = ffClsMap.get(r.cls) || { cls: r.cls, group: r.group, issuance: 0, replacement: 0 };
      if (r.type === 'REPLACEMENT') c.replacement += r.n; else c.issuance += r.n;
      ffClsMap.set(r.cls, c);
    }
    ff.activeDays = ff.days.size;

    // GV side (row-level from GV Master)
    const gv = { total: 0, vc4: 0, comm: 0, replacement: 0, amount: 0, rows: 0, days: new Set() };
    const gvByDay = new Map();
    const agMap = new Map(), tlMap = new Map();
    for (const r of master) {
      if (!r.date || r.date < fromD || r.date > toEnd) continue;
      const k = U.dateKey(r.date);
      gv.rows++; gv.total++;
      if (r.group === 'VC4') gv.vc4++; else gv.comm++;
      if (/replacement/i.test(r.status)) gv.replacement++;
      gv.amount += r.commission || 0;
      gv.days.add(k);
      gvByDay.set(k, (gvByDay.get(k) || 0) + 1);
      const ak = r.agentId || r.agentName;
      const a = agMap.get(ak) || { agentName: r.agentName, tlName: r.tlName || 'Direct', total: 0, vc4: 0, comm: 0, replacement: 0, days: new Set() };
      a.total++; if (r.group === 'VC4') a.vc4++; else a.comm++;
      if (/replacement/i.test(r.status)) a.replacement++;
      a.days.add(k); agMap.set(ak, a);
      const tk = r.tlName || 'Direct';
      const t = tlMap.get(tk) || { tlName: tk, total: 0, vc4: 0, agents: new Set() };
      t.total++; if (r.group === 'VC4') t.vc4++; t.agents.add(ak); tlMap.set(tk, t);
    }
    gv.activeDays = gv.days.size;
    const gvAgents = [...agMap.values()].map((a) => ({ ...a, activeDays: a.days.size })).sort((a, b) => b.total - a.total);
    const gvTls = [...tlMap.values()].map((t) => ({ ...t, agents: t.agents.size })).sort((a, b) => b.total - a.total);

    // daily series (weekly buckets when the range is long)
    view.weekly = days > 62;
    const keys = [];
    for (let d = new Date(fromD); U.dateKey(d) <= to; d = new Date(d.getTime() + 86400e3)) keys.push(U.dateKey(d));
    let labels = [], ffSeries = [], gvSeries = [], tipLabels = [];
    if (!view.weekly) {
      labels = keys.map((k) => U.labelDateKey(k));
      tipLabels = keys.map((k) => U.labelDateKey(k, true));
      ffSeries = keys.map((k) => ffByDay.get(k) || 0);
      gvSeries = keys.map((k) => gvByDay.get(k) || 0);
    } else {
      const wk = (k) => U.weekStart(U.fromDateKey(k));
      const buckets = new Map();
      for (const k of keys) {
        const w = U.dateKey(wk(k));
        let b = buckets.get(w);
        if (!b) { b = { ff: 0, gv: 0 }; buckets.set(w, b); }
        b.ff += ffByDay.get(k) || 0; b.gv += gvByDay.get(k) || 0;
      }
      const ws = [...buckets.keys()].sort();
      labels = ws.map((w) => `wk ${U.labelDateKey(w)}`);
      tipLabels = ws.map((w) => `Week of ${U.labelDateKey(w, true)}`);
      ffSeries = ws.map((w) => buckets.get(w).ff);
      gvSeries = ws.map((w) => buckets.get(w).gv);
    }

    const ffCls = [...ffClsMap.values()].map((c) => ({ ...c, total: c.issuance + c.replacement })).sort((a, b) => b.total - a.total);
    return { days, from, to, ff, gv, ffCls, gvAgents, gvTls, labels, tipLabels, ffSeries, gvSeries, minKey, maxKey, dailyRows: keys.map((k) => ({ key: k, ff: ffByDay.get(k) || 0, gv: gvByDay.get(k) || 0 })) };
  }

  // ---- excel ----------------------------------------------------------------------------------------
  function exportExcel(R) {
    if (!FF.auth.can('export')) { U.toast('Download permission nahi hai', 'err'); return; }
    const { ff, gv } = R;
    const summary = {
      name: 'Summary', filterRows: 7, header: ['Metric', 'Value'],
      rows: [
        ['Report', `${FF.config.brand} · Custom range report`],
        ['Range', `${U.labelDateKey(view.from, true)} → ${U.labelDateKey(view.to, true)} (${R.days} din)`],
        ['First Forward issuance', ff.issuance], ['FF replacement', ff.replacement], ['FF VC4', ff.vc4],
        ['GV total', gv.total], ['GV VC4', gv.vc4], ['GV commercial', gv.comm], ['GV replacement', gv.replacement],
        ['GV commission (₹)', Math.round(gv.amount)],
        ['Combined issuance', ff.issuance + gv.total],
        ['Generated', new Date().toLocaleString('en-IN')]
      ]
    };
    const dailySheet = { name: 'Daily', header: ['Date', 'Weekday', 'FF tags', 'GV tags', 'Combined'], rows: R.dailyRows.map((d) => [U.labelDateKey(d.key, true), U.weekday(U.fromDateKey(d.key)), d.ff, d.gv, d.ff + d.gv]) };
    const agents = { name: 'GV Agents', header: ['Rank', 'Agent', 'TL', 'Tags', 'VC4', 'Commercial', 'Replacement', 'Active days'], rows: R.gvAgents.map((a, i) => [i + 1, a.agentName, a.tlName, a.total, a.vc4, a.comm, a.replacement, a.activeDays]) };
    const tls = { name: 'GV TLs', header: ['Rank', 'Team Leader', 'Tags', 'VC4', 'Agents'], rows: R.gvTls.map((t, i) => [i + 1, t.tlName, t.total, t.vc4, t.agents]) };
    const cls = { name: 'FF Classes', header: ['Class', 'Group', 'Issuance', 'Replacement', 'Total'], rows: R.ffCls.map((c) => [c.cls, c.group, c.issuance, c.replacement, c.total]) };
    FF.xlsx.download(`range-report-${view.from}-to-${view.to}.xlsx`, [summary, dailySheet, agents, tls, cls]);
    U.toast('Range report Excel ready ✓ (5 sheets)', 'ok');
    if (FF.notifications && FF.notifications.logClick) FF.notifications.logClick('Range report Excel', `${view.from} → ${view.to}`);
  }

  FF.pages.rangeReport = { title: 'Range Report', render };
})(window.FF);
