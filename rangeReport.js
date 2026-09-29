/* 📅 Exact custom date-range report: First Forward + GV, 3-way class split, both agent/TL tables, Excel. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';

  // 🧍 Direct-agent rule helpers — browser me FF.config ka shared rule, warna safe fallback
  // (FF: TL Name APS · GV: TL ID + TL Name dono blank).
  const cfgCall = (name, args, fallback) => {
    const f = FF.config && FF.config[name];
    return typeof f === 'function' ? f.apply(FF.config, args) : fallback;
  };
  const isRealTl = (n) => cfgCall('isRealTl', [n], !!String(n == null ? '' : n).trim());
  const directLabel = (a, ch) => cfgCall('directLabel', [a || {}, ch], ch === 'gv' ? 'Direct Agent (no TL)' : 'Direct Agent (APS)');
  const U = FF.util, S = FF.store, G = FF.gv, M = FF.model, C = FF.charts;
  const esc = U.esc;
  const card = (title, body, right) => `<section class="card"><div class="card-head"><h3>${title}</h3>${right ? `<div class="card-right">${right}</div>` : ''}</div><div class="card-body">${body}</div></section>`;
  const isKey = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

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
    const d = defaultRange();
    if (!isKey(view.from)) view.from = d.from;
    if (!isKey(view.to)) view.to = d.to;
    if (view.from > view.to) [view.from, view.to] = [view.to, view.from];
    return Math.round((U.fromDateKey(view.to) - U.fromDateKey(view.from)) / 86400e3) + 1;
  }
  function classHelp() {
    return `<div class="class-defs" role="note">
      <span><b>🚗 VC4</b> = 4-wheeler (car/jeep/van · payable)</span>
      <span><b>🛻 VC20</b> = vehicle class 20 commercial</span>
      <span><b>🚚 VC5+</b> = baaki commercial classes (VC5/6/7/12/15/16…)</span>
      <span><b>All Commercial / NVC4</b> = VC20 + VC5+</span>
    </div>`;
  }
  function peopleTable(rows, empty) {
    if (!rows.length) return `<div class="empty-state">${esc(empty)}</div>`;
    return `<div class="table-wrap tall"><table class="tbl sticky-first"><thead><tr><th>#</th><th>Agent / TL</th><th class="num">Tags</th><th class="num">VC4</th><th class="num">VC20</th><th class="num">VC5+</th><th class="num">All Comm</th><th class="num">Repl.</th><th class="num">Active din</th></tr></thead><tbody>${rows.slice(0, 100).map((a, i) => `<tr><td>${i + 1}</td><td><b>${esc(a.agentName)}</b><br><small class="dim">${esc(a.tlName)}</small></td><td class="num"><b>${U.fmt(a.total)}</b></td><td class="num">${U.fmt(a.vc4)}</td><td class="num">${U.fmt(a.vc20)}</td><td class="num">${U.fmt(a.vc5p)}</td><td class="num"><b>${U.fmt(a.comm)}</b></td><td class="num">${U.fmt(a.replacement)}</td><td class="num">${U.fmt(a.activeDays)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function tlTable(rows, empty) {
    if (!rows.length) return `<div class="empty-state">${esc(empty)}</div>`;
    return `<div class="table-wrap tall"><table class="tbl sticky-first"><thead><tr><th>#</th><th>Team Leader</th><th class="num">Tags</th><th class="num">VC4</th><th class="num">VC20</th><th class="num">VC5+</th><th class="num">All Comm</th><th class="num">Agents</th><th class="num">Active din</th></tr></thead><tbody>${rows.slice(0, 100).map((t, i) => `<tr><td>${i + 1}</td><td><b>${esc(t.tlName)}</b></td><td class="num"><b>${U.fmt(t.total)}</b></td><td class="num">${U.fmt(t.vc4)}</td><td class="num">${U.fmt(t.vc20)}</td><td class="num">${U.fmt(t.vc5p)}</td><td class="num"><b>${U.fmt(t.comm)}</b></td><td class="num">${U.fmt(t.agents)}</td><td class="num">${U.fmt(t.activeDays)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  async function render(root, params) {
    if (isKey(params.from)) view.from = params.from;
    if (isKey(params.to)) view.to = params.to;
    if (!view.from || !view.to) Object.assign(view, defaultRange());
    normalize();
    root.innerHTML = `<div class="page-head"><div><h1>📅 Custom Range Report</h1><p class="sub">Exact from → to report · First Forward + GV · VC4 / VC20 / VC5+ · agents, TLs, Excel</p></div>
      <div class="head-actions"><button class="btn primary" data-action="refresh">↻ Fresh data</button></div></div>
      <div class="card controls">
        <div class="finder-row">
          <label>From <input class="input" type="date" id="rr-from" value="${esc(view.from)}"></label>
          <label>To <input class="input" type="date" id="rr-to" value="${esc(view.to)}"></label>
          <button class="btn primary" id="rr-go">📊 Report banao</button>
          <button class="btn" id="rr-xlsx">⬇ Excel</button>
        </div>
        <div class="chip-row" id="rr-presets">${presets().map((p) => `<button class="chip ${p.from === view.from && p.to === view.to ? 'on' : ''}" data-preset-from="${p.from}" data-preset-to="${p.to}">${p.label}</button>`).join('')}<button class="chip" id="rr-all">🗓 Poora data</button></div>
      </div>
      <div id="rr-body">${U.spinner('FF + GV range report ban raha hai…')}</div>`;
    const body = U.$('#rr-body', root);

    let R = null;
    try { R = await build(); } catch (err) { body.innerHTML = U.errorBox(err, 'data-action="refresh"'); return; }
    if (!root.isConnected) return;

    const days = R.days;
    const fromIn = U.$('#rr-from', root), toIn = U.$('#rr-to', root);
    if (R.minKey) { fromIn.min = R.minKey; toIn.min = R.minKey; }
    if (R.maxKey) { fromIn.max = R.maxKey; toIn.max = R.maxKey; }

    const kpi = (cls, title, value, icon, foot) => `<div class="kpi ${cls}"><div class="kpi-top"><span class="kpi-title">${title}</span><span class="kpi-icon">${icon}</span></div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot || ''}</div></div>`;
    const ff = R.ff, gv = R.gv;
    const issueWarning = R.issues.length ? `<div class="warn-box">⚠️ ${R.issues.map(esc).join('<br>')}</div>` : '';
    body.innerHTML = `<p class="dim small">Range: <b>${esc(U.labelDateKey(view.from, true))}</b> → <b>${esc(U.labelDateKey(view.to, true))}</b> · ${U.fmt(days)} din${view.weekly ? ' · weekly chart (range lambi hai)' : ''}</p>
      ${issueWarning}
      <div class="kpi-grid">
        ${kpi('g1', 'First Forward tags', U.fmt(ff.total), '🟦', `${U.fmt(ff.issuance)} issuance · ${U.fmt(ff.replacement)} replacement · avg ${U.fmt(Math.round(ff.total / Math.max(1, ff.activeDays)))}/active day`)}
        ${kpi('g2', 'GV tags', U.fmt(gv.total), '🟩', `${U.fmt(gv.total - gv.replacement)} issuance · ${U.fmt(gv.replacement)} replacement · avg ${U.fmt(Math.round(gv.total / Math.max(1, gv.activeDays)))}/active day`)}
        ${kpi('g3', 'Combined', U.fmt(ff.total + gv.total), '🏷️', `FF ${U.fmt(ff.total)} + GV ${U.fmt(gv.total)}`)}
        ${kpi('g4', 'VC4 · combined', U.fmt(ff.vc4 + gv.vc4), '🚗', `FF ${U.fmt(ff.vc4)} · GV ${U.fmt(gv.vc4)}`)}
        ${kpi('g5', 'VC20 · combined', U.fmt(ff.vc20 + gv.vc20), '🛻', `FF ${U.fmt(ff.vc20)} · GV ${U.fmt(gv.vc20)}`)}
        ${kpi('g6', 'VC5+ · combined', U.fmt(ff.vc5p + gv.vc5p), '🚚', `FF ${U.fmt(ff.vc5p)} · GV ${U.fmt(gv.vc5p)}`)}
        ${kpi('g7', 'All Commercial', U.fmt(ff.comm + gv.comm), '🚛', `VC20 + VC5+ · FF ${U.fmt(ff.comm)} · GV ${U.fmt(gv.comm)}`)}
        ${kpi('g8', 'GV commission', `₹${U.fmt(Math.round(gv.amount))}`, '💰', `${U.fmt(gv.rows)} GV entries`)}
      </div>
      ${classHelp()}
      ${card(`📈 Daily trend <span class="dim">· First Forward vs GV · ${U.fmt(days)} din</span>`,
        days ? C.lines({ labels: R.labels, tipLabels: R.tipLabels, height: 260, series: [
          { name: 'First Forward', values: R.ffSeries },
          { name: 'GV Partner', values: R.gvSeries, color: '#10b981' }
        ] }) : '<div class="empty-state">Is range me koi data nahi mila.</div>')}
      <div class="grid g-2">
        ${card(`🟦 First Forward agents <span class="dim">· top ${Math.min(100, R.ffAgents.length)}</span>`, peopleTable(R.ffAgents, R.ffPeopleOk ? 'First Forward agent data nahi mila.' : 'First Forward agent query load nahi hui — Fresh data se retry karo.'))}
        ${card(`🟩 GV agents <span class="dim">· top ${Math.min(100, R.gvAgents.length)}</span>`, peopleTable(R.gvAgents, 'GV agent data nahi mila.'))}
      </div>
      <div class="grid g-2">
        ${card('🟦 First Forward TL-wise <span class="dim">· range me</span>', tlTable(R.ffTls, R.ffPeopleOk ? 'First Forward TL data nahi mila.' : 'First Forward TL query load nahi hui.'))}
        ${card('🟩 GV TL-wise <span class="dim">· range me</span>', tlTable(R.gvTls, 'GV TL data nahi mila.'))}
      </div>
      ${card(`🟦 First Forward exact class split <span class="dim">· range me</span>`,
        R.ffCls.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Class</th><th>Group</th><th class="num">Issuance</th><th class="num">Replacement</th><th class="num">Total</th></tr></thead><tbody>${R.ffCls.map((c) => `<tr><td><b>${esc(c.cls)}</b></td><td>${esc(c.group)}</td><td class="num">${U.fmt(c.issuance)}</td><td class="num">${U.fmt(c.replacement)}</td><td class="num"><b>${U.fmt(c.total)}</b></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">FF data nahi mila.</div>',
        `<button class="btn small" id="rr-print">🖨 Print / PDF</button>`)}
      <p class="dim small">FF = EIR (GV channel excluded) · GV = GV Master · sab counts selected dates ke exact hain. Commission sirf GV Master me available hai.</p>`;
    C.mount(body);

    function go() {
      view.from = fromIn.value || view.from;
      view.to = toIn.value || view.to;
      normalize();
      FF.app.navigate('rangeReport', { from: view.from, to: view.to });
      if (FF.notifications && FF.notifications.logClick) FF.notifications.logClick('Range report', `${view.from} → ${view.to}`);
    }
    U.$('#rr-go', root).addEventListener('click', go);
    [fromIn, toIn].forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }));
    root.addEventListener('click', (e) => {
      const p = e.target.closest('[data-preset-from]');
      if (p) { fromIn.value = p.dataset.presetFrom; toIn.value = p.dataset.presetTo; go(); return; }
      if (e.target.closest('#rr-all')) { if (R.minKey && R.maxKey) { fromIn.value = R.minKey; toIn.value = R.maxKey; go(); } return; }
      if (e.target.closest('#rr-xlsx')) { exportExcel(R); return; }
      if (e.target.closest('#rr-print')) {
        U.printReport({ title: `${FF.config.brand} — Custom range report`, subtitle: `${U.labelDateKey(view.from, true)} → ${U.labelDateKey(view.to, true)} (${R.days} din)`, html: (U.$('#rr-body', root) || root).innerHTML });
      }
    });
  }

  function addClass(o, group, n) {
    if (group === 'VC4') o.vc4 += n;
    else if (group === 'VC20') o.vc20 += n;
    else o.vc5p += n;
    o.comm = o.vc20 + o.vc5p;
  }
  function aggregateFfPeople(rows) {
    const agents = new Map(), tls = new Map();
    for (const r of rows) {
      if (r.channel !== 'First Forward') continue;
      const ak = r.id || r.name;
      const a = agents.get(ak) || { agentName: r.name, tlName: isRealTl(r.tlName) ? r.tlName : directLabel({ tlName: r.tlName }, r.channel === 'GV Partner' ? 'gv' : 'ff'), total: 0, vc4: 0, vc20: 0, vc5p: 0, comm: 0, replacement: 0, days: new Set() };
      a.total += r.n; addClass(a, r.group, r.n); if (r.type === 'REPLACEMENT') a.replacement += r.n; a.days.add(r.dateKey); agents.set(ak, a);
      const tk = isRealTl(r.tlName) ? r.tlName : directLabel({ tlName: r.tlName }, r.channel === 'GV Partner' ? 'gv' : 'ff');
      const t = tls.get(tk) || { tlName: tk, total: 0, vc4: 0, vc20: 0, vc5p: 0, comm: 0, agents: new Set(), days: new Set() };
      t.total += r.n; addClass(t, r.group, r.n); t.agents.add(ak); t.days.add(r.dateKey); tls.set(tk, t);
    }
    return {
      agents: [...agents.values()].map((a) => ({ ...a, activeDays: a.days.size })).sort((a, b) => b.total - a.total),
      tls: [...tls.values()].map((t) => ({ ...t, agents: t.agents.size, activeDays: t.days.size })).sort((a, b) => b.total - a.total)
    };
  }

  // ---- aggregate -----------------------------------------------------------------------------------
  async function build(range) {
    if (range && isKey(range.from) && isKey(range.to)) { view.from = range.from; view.to = range.to; normalize(); }
    const [dailyR, masterR, ffPeopleR] = await Promise.allSettled([
      S.need('daily'),
      G.enabled() ? G.need('master') : Promise.resolve([]),
      M.loadRangePeople(view.from, view.to)
    ]);
    const daily = dailyR.status === 'fulfilled' ? dailyR.value : [];
    const master = masterR.status === 'fulfilled' ? G.rows() : [];
    const ffPeople = ffPeopleR.status === 'fulfilled' ? ffPeopleR.value : [];
    const issues = [];
    if (dailyR.status === 'rejected') issues.push(`First Forward totals load nahi hue: ${dailyR.reason && dailyR.reason.message || 'retry'}`);
    if (masterR.status === 'rejected') issues.push(`GV Master load nahi hua: ${masterR.reason && masterR.reason.message || 'retry'}`);
    if (ffPeopleR.status === 'rejected') issues.push(`First Forward agent/TL split load nahi hua: ${ffPeopleR.reason && ffPeopleR.reason.message || 'retry'}`);
    const from = view.from, to = view.to;
    const fromD = U.fromDateKey(from), toEnd = new Date(U.fromDateKey(to).getTime() + 86399e3);
    const days = Math.round((U.fromDateKey(to) - fromD) / 86400e3) + 1;

    const allKeys = daily.map((r) => r.key).concat(master.filter((r) => r.date).map((r) => U.dateKey(r.date)));
    const minKey = allKeys.length ? allKeys.reduce((a, b) => (a < b ? a : b)) : '';
    const maxKey = allKeys.length ? allKeys.reduce((a, b) => (a > b ? a : b)) : '';

    const ff = { total: 0, issuance: 0, replacement: 0, vc4: 0, vc20: 0, vc5p: 0, comm: 0, days: new Set(), rows: 0 };
    const ffByDay = new Map(), ffClsMap = new Map();
    for (const r of daily) {
      if (r.key < from || r.key > to || r.channel === 'GV Partner') continue;
      ff.rows++; ff.total += r.n;
      if (r.type === 'REPLACEMENT') ff.replacement += r.n; else ff.issuance += r.n;
      addClass(ff, r.group, r.n);
      ff.days.add(r.key);
      ffByDay.set(r.key, (ffByDay.get(r.key) || 0) + r.n);
      const c = ffClsMap.get(r.cls) || { cls: r.cls, group: r.group, issuance: 0, replacement: 0 };
      if (r.type === 'REPLACEMENT') c.replacement += r.n; else c.issuance += r.n;
      ffClsMap.set(r.cls, c);
    }
    ff.activeDays = ff.days.size;
    const ffRollup = aggregateFfPeople(ffPeople);

    const gv = { total: 0, vc4: 0, vc20: 0, vc5p: 0, comm: 0, replacement: 0, amount: 0, rows: 0, days: new Set() };
    const gvByDay = new Map(), agMap = new Map(), tlMap = new Map();
    for (const r of master) {
      if (!r.date || r.date < fromD || r.date > toEnd) continue;
      const k = U.dateKey(r.date);
      gv.rows++; gv.total++; addClass(gv, r.group, 1);
      if (/replacement/i.test(r.status)) gv.replacement++;
      gv.amount += r.commission || 0; gv.days.add(k); gvByDay.set(k, (gvByDay.get(k) || 0) + 1);
      const ak = r.agentId || r.agentName;
      const a = agMap.get(ak) || { agentName: r.agentName, tlName: isRealTl(r.tlName) ? r.tlName : directLabel({ tlName: r.tlName }, r.channel === 'GV Partner' ? 'gv' : 'ff'), total: 0, vc4: 0, vc20: 0, vc5p: 0, comm: 0, replacement: 0, days: new Set() };
      a.total++; addClass(a, r.group, 1); if (/replacement/i.test(r.status)) a.replacement++; a.days.add(k); agMap.set(ak, a);
      const tk = isRealTl(r.tlName) ? r.tlName : directLabel({ tlName: r.tlName }, r.channel === 'GV Partner' ? 'gv' : 'ff');
      const t = tlMap.get(tk) || { tlName: tk, total: 0, vc4: 0, vc20: 0, vc5p: 0, comm: 0, agents: new Set(), days: new Set() };
      t.total++; addClass(t, r.group, 1); t.agents.add(ak); t.days.add(k); tlMap.set(tk, t);
    }
    gv.activeDays = gv.days.size;
    const gvAgents = [...agMap.values()].map((a) => ({ ...a, activeDays: a.days.size })).sort((a, b) => b.total - a.total);
    const gvTls = [...tlMap.values()].map((t) => ({ ...t, agents: t.agents.size, activeDays: t.days.size })).sort((a, b) => b.total - a.total);

    view.weekly = days > 62;
    const keys = [];
    for (let d = new Date(fromD); U.dateKey(d) <= to; d.setDate(d.getDate() + 1)) keys.push(U.dateKey(d));
    let labels = [], ffSeries = [], gvSeries = [], tipLabels = [];
    if (!view.weekly) {
      labels = keys.map((k) => U.labelDateKey(k)); tipLabels = keys.map((k) => U.labelDateKey(k, true));
      ffSeries = keys.map((k) => ffByDay.get(k) || 0); gvSeries = keys.map((k) => gvByDay.get(k) || 0);
    } else {
      const buckets = new Map();
      for (const k of keys) {
        const w = U.dateKey(U.weekStart(U.fromDateKey(k)));
        const b = buckets.get(w) || { ff: 0, gv: 0 };
        b.ff += ffByDay.get(k) || 0; b.gv += gvByDay.get(k) || 0; buckets.set(w, b);
      }
      const ws = [...buckets.keys()].sort();
      labels = ws.map((w) => `wk ${U.labelDateKey(w)}`); tipLabels = ws.map((w) => `Week of ${U.labelDateKey(w, true)}`);
      ffSeries = ws.map((w) => buckets.get(w).ff); gvSeries = ws.map((w) => buckets.get(w).gv);
    }

    const ffCls = [...ffClsMap.values()].map((c) => ({ ...c, total: c.issuance + c.replacement })).sort((a, b) => b.total - a.total);
    return { days, from, to, ff, gv, ffCls, ffAgents: ffRollup.agents, ffTls: ffRollup.tls, ffPeopleOk: ffPeopleR.status === 'fulfilled', gvAgents, gvTls, labels, tipLabels, ffSeries, gvSeries, minKey, maxKey, issues, dailyRows: keys.map((k) => ({ key: k, ff: ffByDay.get(k) || 0, gv: gvByDay.get(k) || 0 })) };
  }

  // ---- excel ----------------------------------------------------------------------------------------
  function exportExcel(R) {
    if (!FF.auth.can('export')) { U.toast('Download permission nahi hai', 'err'); return; }
    const { ff, gv } = R;
    const summary = { name: 'Summary', filterRows: 7, header: ['Metric', 'Value'], rows: [
      ['Report', `${FF.config.brand} · Custom range report`], ['Range', `${U.labelDateKey(view.from, true)} → ${U.labelDateKey(view.to, true)} (${R.days} din)`],
      ['First Forward total', ff.total], ['FF issuance', ff.issuance], ['FF replacement', ff.replacement], ['FF VC4', ff.vc4], ['FF VC20', ff.vc20], ['FF VC5+', ff.vc5p], ['FF all commercial', ff.comm],
      ['GV total', gv.total], ['GV replacement', gv.replacement], ['GV VC4', gv.vc4], ['GV VC20', gv.vc20], ['GV VC5+', gv.vc5p], ['GV all commercial', gv.comm], ['GV commission (₹)', Math.round(gv.amount)],
      ['Combined total', ff.total + gv.total], ['Definition · VC4', '4-wheeler (car/jeep/van)'], ['Definition · VC20', 'Vehicle class 20 commercial'], ['Definition · VC5+', 'Other commercial classes'], ['Generated', new Date().toLocaleString('en-IN')]
    ] };
    const dailySheet = { name: 'Daily', header: ['Date', 'Weekday', 'FF tags', 'GV tags', 'Combined'], rows: R.dailyRows.map((d) => [U.labelDateKey(d.key, true), U.weekday(U.fromDateKey(d.key)), d.ff, d.gv, d.ff + d.gv]) };
    const agentSheet = (name, rows) => ({ name, header: ['Rank', 'Agent', 'TL', 'Tags', 'VC4', 'VC20', 'VC5+', 'All Commercial', 'Replacement', 'Active days'], rows: rows.map((a, i) => [i + 1, a.agentName, a.tlName, a.total, a.vc4, a.vc20, a.vc5p, a.comm, a.replacement, a.activeDays]) });
    const tlSheet = (name, rows) => ({ name, header: ['Rank', 'Team Leader', 'Tags', 'VC4', 'VC20', 'VC5+', 'All Commercial', 'Agents', 'Active days'], rows: rows.map((t, i) => [i + 1, t.tlName, t.total, t.vc4, t.vc20, t.vc5p, t.comm, t.agents, t.activeDays]) });
    const cls = { name: 'FF Classes', header: ['Class', 'Group', 'Issuance', 'Replacement', 'Total'], rows: R.ffCls.map((c) => [c.cls, c.group, c.issuance, c.replacement, c.total]) };
    FF.xlsx.download(`range-report-${view.from}-to-${view.to}.xlsx`, [summary, dailySheet, agentSheet('FF Agents', R.ffAgents), agentSheet('GV Agents', R.gvAgents), tlSheet('FF TLs', R.ffTls), tlSheet('GV TLs', R.gvTls), cls]);
    U.toast('Range report Excel ready ✓ (7 sheets)', 'ok');
    if (FF.notifications && FF.notifications.logClick) FF.notifications.logClick('Range report Excel', `${view.from} → ${view.to}`);
  }

  FF.pages.rangeReport = { title: 'Range Report', render, build };
})(window.FF);
