/* 🎯 Targets page: FF + GV agents ko short-list karke monthly targets do (Top N, low issuance,
   VC4-wise, commercial-wise, last vs current growth), progress track karo aur Excel download karo.
   Tabs: 🎯 Targets · 🏅 Achievement history · 👥 TL-wise rollup.
   Targets settings.targets me save hote hain (server + Google Sheet APP_STORAGE backup). */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  let lastTargetRows = { rows: [], withT: [], achievedRows: [], ym: '' };
  function registerTargetLists() {
    if (!FF.kpiDetail || !FF.kpiDetail.registerList || registerTargetLists.done) return;
    registerTargetLists.done = true;
    const U = FF.util, e = (v) => U.esc(v);
    const tgt = (r) => (typeof targetDrafts !== 'undefined' && targetDrafts.get ? targetDrafts.get(r.key) || 0 : 0);
    const cols = [['Agent / TL', (r) => `<b>${e(r.name || r.key)}</b>`], ['Source', (r) => e(r.source || r.ch || '—')], ['Last month', (r) => U.fmt(r.last || 0), 1], ['Issuance', (r) => `<b>${U.fmt(r.cur || 0)}</b>`, 1], ['Target', (r) => U.fmt(tgt(r)), 1], ['Achievement', (r) => (tgt(r) ? `${Math.round(((r.cur || 0) / tgt(r)) * 100)}%` : '—'), 1]];
    const make = (name, pick, kicker) => FF.kpiDetail.registerList(name, () => {
      const rows = [...pick()].sort((a, b) => (b.cur || 0) - (a.cur || 0));
      return { kicker, unit: 'rows', rows, columns: cols, agent: (r) => (r.kind === 'tl' ? null : { name: r.name, id: r.id || '', ch: r.ch || (/gv/i.test(r.source || '') ? 'gv' : 'ff') }), sub: `Issuance <b>${U.fmt(U.sum(rows, (r) => r.cur || 0))}</b> · target <b>${U.fmt(U.sum(rows, (r) => tgt(r)))}</b> · ${e(U.labelYM(lastTargetRows.ym || U.ymKey(new Date())))}` };
    });
    make('tg.rows', () => lastTargetRows.rows, 'Targets · agents (filter)');
    make('tg.with', () => lastTargetRows.withT, 'Targets · target set');
    make('tg.achieved', () => lastTargetRows.achievedRows, 'Targets · achieved');
  }
  const U = FF.util, M = FF.model, S = FF.store, G = FF.gv, C = FF.charts;
  const esc = U.esc;
  const norm = (s) => U.clean(s).toUpperCase().replace(/\s+/g, ' ');
  const keyOf = (source, name) => `${source}|${norm(name)}`;

  const view = { ym: '', source: 'all', sort: 'cur', q: '', onlyWithTarget: false, tab: 'targets', tlSort: 'cur' };
  let list = [];            // unified agent rows
  let selected = new Set(); // keys
  let targetDrafts = new Map(); // legacy overall target per agent (unsaved)
  let classTargetDrafts = new Map(); // key → { vc4, vc20, vc5p } (unsaved)
  let savedTargets = [];    // settings.targets (current month)
  const CLASS_TARGETS = [{ key: 'vc4', label: 'VC4' }, { key: 'vc20', label: 'VC20' }, { key: 'vc5p', label: 'VC5+' }];
  const normalizedClassTargets = (value) => Object.fromEntries(CLASS_TARGETS.map((c) => [c.key, Math.max(0, Math.floor(Number(value && value[c.key]) || 0))]));
  const classTargetsFor = (key) => normalizedClassTargets(classTargetDrafts.get(key));
  const hasClassTargets = (key) => CLASS_TARGETS.some((c) => classTargetsFor(key)[c.key] > 0);
  const hasAnyTarget = (key) => (Number(targetDrafts.get(key)) || 0) > 0 || hasClassTargets(key);

  const card = (title, body, right) => `<section class="card"><div class="card-head"><h3>${title}</h3>${right ? `<div class="card-right">${right}</div>` : ''}</div><div class="card-body">${body}</div></section>`;
  const pct = (a, b) => (b ? (a / b) * 100 : null);
  const allSavedTargets = () => ((FF.auth.settings && FF.auth.settings.targets) || []).filter((t) => t && t.ym && t.key && ((Number(t.target) || 0) > 0 || CLASS_TARGETS.some((c) => Number(t.classTargets && t.classTargets[c.key]) > 0)));

  // ---- data prep ---------------------------------------------------------------------------------
  async function prep() {
    const [dailyR, agentsR, agentClassR, masterR] = await Promise.allSettled([
      S.need('daily'), S.need('agents'), S.need('agentClass'), G.enabled() ? G.need('master') : Promise.resolve([])
    ]);
    const daily = dailyR.status === 'fulfilled' ? dailyR.value : [];
    const agents = agentsR.status === 'fulfilled' ? agentsR.value : [];
    const agentClass = agentClassR.status === 'fulfilled' ? agentClassR.value : [];
    const ffLatest = M.latestDate(daily);
    const gvLatest = masterR.status === 'fulfilled' ? G.latestDate() : null;
    const latest = ffLatest && gvLatest ? (ffLatest > gvLatest ? ffLatest : gvLatest) : (ffLatest || gvLatest);
    const cur = latest ? U.ymKey(latest) : '';
    const months = U.uniq([...M.months(daily), ...(masterR.status === 'fulfilled' ? G.months() : [])]).sort();
    if (!view.ym || !months.includes(view.ym)) view.ym = cur;
    const last = U.prevMonthKey(view.ym);

    // FF agents (EIR, First Forward channel only)
    const ffCur = new Map(), ffLast = new Map(), ffTl = new Map();
    for (const a of agents) {
      if (a.channel !== 'First Forward') continue;
      const k = keyOf('ff', a.name);
      if (a.ym === view.ym) ffCur.set(k, (ffCur.get(k) || 0) + a.n);
      if (a.ym === last) ffLast.set(k, (ffLast.get(k) || 0) + a.n);
      if (a.tlName && FF.config.isRealTl(a.tlName) && !ffTl.has(k)) ffTl.set(k, a.tlName);
    }
    const ffVc4 = new Map(), ffVc20 = new Map(), ffVc5p = new Map();
    for (const r of agentClass) {
      if (r.ym !== view.ym) continue;
      const k = keyOf('ff', r.name);
      if (r.group === 'VC4') ffVc4.set(k, (ffVc4.get(k) || 0) + r.n);
      else if (r.group === 'VC20') ffVc20.set(k, (ffVc20.get(k) || 0) + r.n);
      else ffVc5p.set(k, (ffVc5p.get(k) || 0) + r.n);
    }
    // GV agents (GV Master)
    const gvCur = masterR.status === 'fulfilled' ? new Map(G.agentRollup(view.ym).map((a) => [keyOf('gv', a.agentName), a])) : new Map();
    const gvLast = masterR.status === 'fulfilled' ? new Map(G.agentRollup(last).map((a) => [keyOf('gv', a.agentName), a])) : new Map();

    const rows = [];
    // 4-way split: VC4 | VC20 | VC5+ · All Comm = VC20 + VC5+ (NVC4)
    const push = (source, name, tl, curN, lastN, vc4, vc20, vc5p) => {
      const comm = (vc20 || 0) + (vc5p || 0);
      rows.push({ key: keyOf(source, name), source, name, tl: tl || '—', cur: curN || 0, last: lastN || 0, vc4: vc4 || 0, vc20: vc20 || 0, vc5p: vc5p || 0, comm, growth: U.growth(curN || 0, lastN || 0) });
    };
    for (const [k, n] of ffCur) { const name = k.split('|')[1]; push('ff', name, ffTl.get(k), n, ffLast.get(k) || 0, ffVc4.get(k) || 0, ffVc20.get(k) || 0, ffVc5p.get(k) || 0); }
    for (const [k, n] of ffLast) { if (!ffCur.has(k)) push('ff', k.split('|')[1], ffTl.get(k), 0, n, 0, 0, 0); }
    for (const [k, a] of gvCur) push('gv', a.agentName, a.tlName, a.total, (gvLast.get(k) || {}).total || 0, a.vc4, a.vc20 || 0, a.vc5p || 0);
    for (const [k, a] of gvLast) { if (!gvCur.has(k)) push('gv', a.agentName, a.tlName, 0, a.total, 0, 0, 0); }

    // saved targets for this month
    savedTargets = allSavedTargets().filter((t) => t.ym === view.ym);
    targetDrafts = new Map(savedTargets.map((t) => [t.key, Number(t.target) || 0]));
    classTargetDrafts = new Map(savedTargets.map((t) => [t.key, normalizedClassTargets(t.classTargets)]));
    return { rows, months, cur, last, latest, gvOk: masterR.status === 'fulfilled' };
  }

  // ---- short-lists -------------------------------------------------------------------------------
  function filteredRows() {
    let r = list;
    if (view.source !== 'all') r = r.filter((x) => x.source === view.source);
    if (view.onlyWithTarget) r = r.filter((x) => hasAnyTarget(x.key));
    const q = norm(view.q);
    if (q) r = r.filter((x) => norm(x.name).includes(q) || norm(x.tl).includes(q));
    const sorters = {
      cur: (a, b) => b.cur - a.cur,
      last: (a, b) => b.last - a.last,
      growth: (a, b) => (b.growth === null ? -999 : b.growth) - (a.growth === null ? -999 : a.growth),
      vc4: (a, b) => b.vc4 - a.vc4,
      vc20: (a, b) => b.vc20 - a.vc20,
      vc5p: (a, b) => b.vc5p - a.vc5p,
      comm: (a, b) => b.comm - a.comm,
      name: (a, b) => a.name.localeCompare(b.name)
    };
    return [...r].sort(sorters[view.sort] || sorters.cur);
  }
  function quickList(kind) {
    const r = filteredRows().filter((x) => x.cur > 0 || x.last > 0);
    if (kind === 'top') return r.slice(0, 10);
    if (kind === 'low') return [...r].sort((a, b) => a.cur - b.cur).filter((x) => x.last > 0).slice(0, 15);
    if (kind === 'vc4') return [...r].filter((x) => x.vc4 > 0).sort((a, b) => b.vc4 - a.vc4).slice(0, 15);
    if (kind === 'comm') return [...r].filter((x) => x.comm > 0).sort((a, b) => b.comm - a.comm).slice(0, 15);
    if (kind === 'up') return r.filter((x) => x.growth !== null && x.growth > 0).sort((a, b) => b.growth - a.growth).slice(0, 20);
    if (kind === 'down') return r.filter((x) => x.growth !== null && x.growth < 0).sort((a, b) => a.growth - b.growth).slice(0, 20);
    return [];
  }

  // ---- excel --------------------------------------------------------------------------------------
  function exportExcel() {
    if (!FF.auth.can('export')) { U.toast('Download permission nahi hai', 'err'); return; }
    const rows = filteredRows();
    const header = ['Source', 'Agent', 'TL', 'Overall target', 'VC4 target', 'VC20 target', 'VC5+ target', `${U.labelYM(view.ym)} issuance`, 'Last month', 'VC4 (4-wheeler payable)', 'VC20', 'VC5+', 'All Commercial (VC20+VC5+)', 'VC4 %', 'Growth %', 'Overall progress %', 'Status'];
    const body = rows.map((r) => {
      const t = targetDrafts.get(r.key) || 0;
      const p = pct(r.cur, t);
      const status = !t ? 'No target' : p >= 100 ? '✅ Achieved' : p >= 70 ? '🟢 On track' : p >= 40 ? '🟠 Behind' : '🔴 Far behind';
      const ct = classTargetsFor(r.key);
      return [r.source === 'ff' ? 'First Forward' : 'GV Partner', r.name, r.tl, t || '', ct.vc4 || '', ct.vc20 || '', ct.vc5p || '', r.cur, r.last, r.vc4, r.vc20, r.vc5p, r.comm, r.cur ? Number(((r.vc4 / r.cur) * 100).toFixed(1)) : 0, r.growth === null ? '' : Number(r.growth.toFixed(1)), p === null ? '' : Math.round(p), status];
    });
    const withT = rows.filter((r) => (targetDrafts.get(r.key) || 0) > 0);
    const achieved = withT.filter((r) => r.cur >= (targetDrafts.get(r.key) || 0)).length;
    const summary = {
      name: 'Summary', filterRows: 7,
      header: ['Metric', 'Value'],
      rows: [
        ['Report', `${FF.config.brand} · Agent targets`], ['Month', U.labelYM(view.ym, true)],
        ['Source filter', view.source === 'all' ? 'FF + GV' : view.source === 'ff' ? 'First Forward' : 'GV Partner'],
        ['Agents in list', rows.length], ['Agents with target', withT.length], ['Targets achieved', achieved],
        ['Total target', U.sum(withT, (r) => targetDrafts.get(r.key) || 0)], ['Issuance so far', U.sum(withT, (r) => r.cur)],
        ['Generated', new Date().toLocaleString('en-IN')]
      ]
    };
    FF.xlsx.download(`targets-${view.ym}-${U.stamp()}.xlsx`, [summary, { name: 'Targets', header, rows: body }]);
    U.toast(`Excel ready · ${rows.length} agents`, 'ok');
    if (FF.notifications && FF.notifications.logClick) FF.notifications.logClick('Targets Excel', `${view.ym} · ${rows.length} agents`);
  }

  // ---- save ---------------------------------------------------------------------------------------
  async function saveTargets() {
    if (!FF.auth.isAdmin()) { U.toast('Targets sirf admin save kar sakta hai', 'err'); return; }
    const allBefore = allSavedTargets();
    const byKey = new Map(savedTargets.map((t) => [t.key, t]));
    const rowsByKey = new Map(list.map((r) => [r.key, r]));
    const editedKeys = new Set([...targetDrafts.keys(), ...classTargetDrafts.keys()]);
    for (const key of editedKeys) {
      const target = Math.max(0, Math.floor(Number(targetDrafts.get(key)) || 0));
      const classTargets = classTargetsFor(key);
      const hasClass = CLASS_TARGETS.some((c) => classTargets[c.key] > 0);
      if (!target && !hasClass) { byKey.delete(key); continue; }
      const row = rowsByKey.get(key), prev = byKey.get(key) || {};
      byKey.set(key, {
        ...prev, key, ym: view.ym,
        source: row ? row.source : prev.source || (key.split('|')[0] === 'gv' ? 'gv' : 'ff'),
        agent: row ? row.name : prev.agent || key.split('|')[1],
        tl: row ? row.tl : prev.tl || '',
        target, classTargets,
        by: FF.auth.user.username, at: new Date().toISOString()
      });
    }
    const others = allBefore.filter((t) => t.ym !== view.ym);
    try {
      const out = await FF.auth.api('/api/settings', 'PUT', { settings: { targets: [...others, ...byKey.values()] } });
      FF.auth.applySettings(out.settings);
      U.toast('Targets save ho gaye ✓ (overall + VC4 / VC20 / VC5+ · Google Sheet backup ke saath)', 'ok');
      savedTargets = allSavedTargets().filter((t) => t.ym === view.ym);
      targetDrafts = new Map(savedTargets.map((t) => [t.key, Number(t.target) || 0]));
      classTargetDrafts = new Map(savedTargets.map((t) => [t.key, normalizedClassTargets(t.classTargets)]));
      draw();
    } catch (err) { U.toast(err.message, 'err'); }
  }

  // ---- render -------------------------------------------------------------------------------------
  let draw = () => {};
  async function render(root, params) {
    if (params.month) view.ym = params.month;
    if (params.tab) view.tab = params.tab;
    if (!['targets', 'achieve', 'tl'].includes(view.tab)) view.tab = 'targets';
    root.innerHTML = `<div class="page-head"><div><h1>🎯 Agent Targets</h1><p class="sub">Targets do · progress track karo · achievement history aur TL-wise rollup dekho · Excel download karo</p></div>
      <div class="head-actions"><button class="btn primary" data-action="refresh">↻ Refresh</button></div></div>
      <div class="seg page-tabs" id="tg-tab">
        <button class="seg-btn" data-tab="targets">🎯 Targets</button>
        <button class="seg-btn" data-tab="achieve">🏅 Achievement history</button>
        <button class="seg-btn" data-tab="tl">👥 TL rollup</button>
      </div>
      <div id="tg-body">${U.spinner('Load ho raha hai…')}</div>`;
    const seg = U.$('#tg-tab', root);
    const paintSeg = () => U.$$('[data-tab]', seg).forEach((b) => b.classList.toggle('on', b.dataset.tab === view.tab));
    paintSeg();
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b || b.dataset.tab === view.tab) return;
      view.tab = b.dataset.tab; paintSeg(); mount(root);
      if (FF.notifications && FF.notifications.logClick) FF.notifications.logClick(`Targets tab: ${b.textContent.trim()}`);
    });
    await mount(root);
  }
  async function mount(root) {
    const body = U.$('#tg-body', root);
    if (!body) return;
    body.innerHTML = U.spinner('Load ho raha hai…');
    try {
      if (view.tab === 'achieve') await mountAchieve(root);
      else if (view.tab === 'tl') await mountTl(root);
      else await mountTargets(root);
    } catch (err) { body.innerHTML = U.errorBox(err, 'data-action="refresh"'); }
  }

  // ================================ 🎯 TAB 1: targets ================================================
  async function mountTargets(root) {
    const body = U.$('#tg-body', root);
    body.innerHTML = `<div class="card controls">
        <div class="finder-row">
          <label>📅 Month <select class="input" id="tg-ym"></select></label>
          <div class="seg" id="tg-source"><button class="seg-btn ${view.source === 'all' ? 'on' : ''}" data-src="all">All</button><button class="seg-btn ${view.source === 'ff' ? 'on' : ''}" data-src="ff">🟦 First Forward</button><button class="seg-btn ${view.source === 'gv' ? 'on' : ''}" data-src="gv">🟩 GV Partner</button></div>
          <label>Sort <select class="input" id="tg-sort"><option value="cur">Issuance (high → low)</option><option value="last">Last month</option><option value="growth">Growth %</option><option value="vc4">VC4 tags</option><option value="vc20">VC20 tags</option><option value="vc5p">VC5+ tags</option><option value="comm">All Comm tags</option><option value="name">Name (A-Z)</option></select></label>
          <div class="finder-input"><span class="finder-ico">🔎</span><input class="input" id="tg-q" placeholder="Agent ya TL search…" value="${esc(view.q)}"><button class="btn mic-btn" id="tg-mic" title="🗣 Bol ke search karo" type="button">🎤</button></div>
        </div>
        <div class="chip-row" id="tg-quick"><span class="dim small">Quick select:</span>
          <button class="chip" data-quick="top">🏆 Top 10</button><button class="chip" data-quick="low">🐢 Low issuance</button><button class="chip vc4" data-quick="vc4">🚗 VC4 heroes</button><button class="chip comm" data-quick="comm">🚚 Commercial players</button><button class="chip" data-quick="up">📈 Growth +</button><button class="chip" data-quick="down">📉 Growth −</button>
          <span class="dim small" id="tg-sel-count"></span></div>
        <div class="finder-row">
          <span class="dim small">Bulk:</span><input class="input" type="number" id="tg-bulk" min="0" placeholder="Target (tags)" style="max-width:130px">
          <button class="btn small" id="tg-bulk-apply">Selected par apply</button>
          <button class="btn small" id="tg-bulk-all">Poori list par apply</button>
          <label class="check" style="margin-left:auto"><input type="checkbox" id="tg-only" ${view.onlyWithTarget ? 'checked' : ''}> Sirf target wale</label>
        </div>
        <div class="finder-row tg-class-bulk">
          <b class="small">Class-wise bulk:</b>
          <input class="input tgt-input" type="number" min="0" id="tg-bulk-vc4" placeholder="VC4 target">
          <input class="input tgt-input" type="number" min="0" id="tg-bulk-vc20" placeholder="VC20 target">
          <input class="input tgt-input" type="number" min="0" id="tg-bulk-vc5p" placeholder="VC5+ target">
          <button class="btn small" id="tg-bulk-class-apply">Selected par apply</button>
          <button class="btn small" id="tg-bulk-class-all">Filtered list par apply</button>
          <small class="dim">Blank class unchanged rahegi · 0 se clear kar sakte ho</small>
        </div>
      </div>
      <div id="tg-inner">${U.spinner('Agents aggregate ho rahe hain…')}</div>`;
    const inner = U.$('#tg-inner', root);

    let P = null;
    try { P = await prep(); } catch (err) { inner.innerHTML = U.errorBox(err, 'data-action="refresh"'); return; }
    if (!root.isConnected) return;
    list = P.rows;

    const ymSel = U.$('#tg-ym', root);
    ymSel.innerHTML = P.months.slice().reverse().map((m) => `<option value="${m}" ${m === view.ym ? 'selected' : ''}>${U.labelYM(m, true)}</option>`).join('');

    draw = () => {
      const rows = filteredRows();
      const srcLbl = view.source === 'ff' ? 'First Forward' : view.source === 'gv' ? 'GV Partner' : 'FF + GV';
      const isCurMonth = view.ym === P.cur;
      const withT = rows.filter((r) => (targetDrafts.get(r.key) || 0) > 0);
      const totalTarget = U.sum(withT, (r) => targetDrafts.get(r.key) || 0);
      const totalCur = U.sum(withT, (r) => r.cur);
      const achieved = withT.filter((r) => r.cur >= (targetDrafts.get(r.key) || 0)).length;
      // 📋 v3.31 — KPI par click = wahi rows (filter + target ke saath)
      lastTargetRows = { rows, withT, achievedRows: withT.filter((r) => r.cur >= (targetDrafts.get(r.key) || 0)), ym: view.ym };
      registerTargetLists();
      const kpis = `<div class="kpi-grid">
        <div class="kpi g9" data-kpi="scope=list&list=tg.rows&src=both"><div class="kpi-top"><span class="kpi-title">Agents (filter me)</span><span class="kpi-icon">🧑‍💼</span></div><div class="kpi-value">${U.fmt(rows.length)}</div><div class="kpi-foot">${esc(srcLbl)} · ${esc(U.labelYM(view.ym))}</div></div>
        <div class="kpi g1" data-kpi="scope=list&list=tg.with&src=both"><div class="kpi-top"><span class="kpi-title">Targets set</span><span class="kpi-icon">🎯</span></div><div class="kpi-value">${U.fmt(withT.length)}</div><div class="kpi-foot">Total target <b>${U.fmt(totalTarget)}</b> tags</div></div>
        <div class="kpi g6" data-kpi="scope=list&list=tg.with&src=both"><div class="kpi-top"><span class="kpi-title">Issuance (with target)</span><span class="kpi-icon">🏷️</span></div><div class="kpi-value">${U.fmt(totalCur)}</div><div class="kpi-foot">${totalTarget ? `<b>${U.fmtPct((totalCur / totalTarget) * 100, 0)}</b> of target · ${isCurMonth ? 'MTD' : 'full month'}` : 'Target set karo'}</div></div>
        <div class="kpi g5" data-kpi="scope=list&list=tg.achieved&src=both"><div class="kpi-top"><span class="kpi-title">Achieved</span><span class="kpi-icon">✅</span></div><div class="kpi-value">${U.fmt(achieved)}</div><div class="kpi-foot">${withT.length ? `${U.fmtPct(U.pctOf(achieved, withT.length), 0)} of targets` : '—'}</div></div>
      </div>`;
      const rowHtml = (r) => {
        const t = targetDrafts.get(r.key) || 0;
        const ct = classTargetsFor(r.key);
        const p = t ? Math.min(150, Math.round((r.cur / t) * 100)) : 0;
        const bar = t ? `<div class="tgt-track"><div class="tgt-fill ${p >= 100 ? 'ok' : p >= 60 ? 'mid' : 'low'}" style="width:${Math.min(100, p)}%"></div></div><small class="dim">${p}%</small>` : '<span class="dim">—</span>';
        const g = r.growth === null ? '<span class="dim">new</span>' : U.deltaHtml(r.growth, { decimals: 0 });
        return `<tr data-key="${esc(r.key)}">
          <td><label class="check"><input type="checkbox" data-pick ${selected.has(r.key) ? 'checked' : ''}></label></td>
          <td><b>${esc(r.name)}</b><br><small class="dim">${esc(r.tl)}</small></td>
          <td>${r.source === 'ff' ? '<span class="badge indigo">FF</span>' : '<span class="badge teal">GV</span>'}</td>
          <td class="num">${U.fmt(r.last)}</td>
          <td class="num"><b>${U.fmt(r.cur)}</b></td>
          <td class="num">${U.fmt(r.vc4)} <small class="dim">(${r.cur ? U.fmtPct(U.pctOf(r.vc4, r.cur), 0) : '0%'})</small></td>
          <td class="num">${U.fmt(r.vc20)}</td>
          <td class="num">${U.fmt(r.vc5p)}</td>
          <td class="num"><b>${U.fmt(r.comm)}</b> <small class="dim">(V20+V5+)</small></td>
          <td class="num">${g}</td>
          <td class="num"><input class="input tgt-input" type="number" min="0" data-target="${esc(r.key)}" value="${t || ''}" placeholder="0" aria-label="Overall target for ${esc(r.name)}"></td>
          <td class="num"><input class="input tgt-input" type="number" min="0" data-class-target="vc4" data-class-target-key="${esc(r.key)}" value="${ct.vc4 || ''}" placeholder="0" aria-label="VC4 target for ${esc(r.name)}"></td>
          <td class="num"><input class="input tgt-input" type="number" min="0" data-class-target="vc20" data-class-target-key="${esc(r.key)}" value="${ct.vc20 || ''}" placeholder="0" aria-label="VC20 target for ${esc(r.name)}"></td>
          <td class="num"><input class="input tgt-input" type="number" min="0" data-class-target="vc5p" data-class-target-key="${esc(r.key)}" value="${ct.vc5p || ''}" placeholder="0" aria-label="VC5+ target for ${esc(r.name)}"></td>
          <td style="min-width:110px">${bar}</td></tr>`;
      };
      inner.innerHTML = `${kpis}
        ${card(`🎯 Target table <span class="dim">· ${U.fmt(rows.length)} agents · ${esc(srcLbl)} · ${esc(U.labelYM(view.ym))}${isCurMonth ? ' (MTD)' : ''}</span>`,
        rows.length ? `<div class="table-wrap tall"><table class="tbl sticky-first"><thead><tr><th><label class="check"><input type="checkbox" id="tg-all" ${rows.length && rows.every((r) => selected.has(r.key)) ? 'checked' : ''}></label></th><th>Agent / TL</th><th>Source</th><th class="num">Last month</th><th class="num">${esc(U.labelYM(view.ym))}</th><th class="num">VC4</th><th class="num">VC20</th><th class="num">VC5+</th><th class="num" title="All Commercial = VC20 + VC5+ (NVC4)">All Comm</th><th class="num">Growth</th><th class="num">Overall target</th><th class="num">VC4 target</th><th class="num">VC20 target</th><th class="num">VC5+ target</th><th>Progress</th></tr></thead><tbody>${rows.slice(0, 400).map(rowHtml).join('')}</tbody></table></div>${rows.length > 400 ? '<p class="dim small">Pehle 400 rows — filter/search se list chhoti karo.</p>' : ''}` : '<div class="empty-state">Koi agent match nahi hua — filter badlo.</div>',
        `<button class="btn small" id="tg-select-page">☑ Visible select</button><button class="btn small" id="tg-clear-sel">✕ Selection clear</button><button class="btn small primary" id="tg-save" ${FF.auth.isAdmin() ? '' : 'disabled title="Admin only"'}>💾 Save targets</button><button class="btn small" id="tg-xlsx">⬇ Excel</button>`)}
        <p class="dim small">🚗 <b>VC4</b> = 4-wheeler (payable) · 🛻 <b>VC20</b> / <b>VC5+</b> = bade commercial vehicles · <b>All Comm = VC20 + VC5+ (NVC4)</b>. Targets month <b>${esc(U.labelYM(view.ym, true))}</b> ke liye save hote hain (settings me — Google Sheet storage backup ke saath). Progress = issuance ÷ target. ${FF.auth.isAdmin() ? '' : '<b>Save sirf admin kar sakta hai.</b>'}</p>`;
      const cnt = U.$('#tg-sel-count', body);
      if (cnt) cnt.textContent = selected.size ? `${selected.size} selected` : '';
    };
    draw();

    // ---- events ----
    ymSel.addEventListener('change', () => { view.ym = ymSel.value; selected.clear(); FF.app.navigate('targets', { month: view.ym, tab: view.tab }); });
    U.$('#tg-sort', body).value = view.sort;
    U.$('#tg-sort', body).addEventListener('change', (e) => { view.sort = e.target.value; draw(); });
    U.$('#tg-q', body).addEventListener('input', U.debounce((e) => { view.q = e.target.value; draw(); }, 220));
    const mic = U.$('#tg-mic', body);
    if (mic && U.voiceInput) mic.addEventListener('click', () => U.voiceInput((text) => { view.q = text; const q = U.$('#tg-q', body); if (q) q.value = text; draw(); }, 'Agent ya TL ka naam bolo…', { button: mic }));
    const onlyChk = U.$('#tg-only', body);
    if (onlyChk) onlyChk.addEventListener('change', () => { view.onlyWithTarget = onlyChk.checked; draw(); });
    body.addEventListener('click', (e) => {
      const src = e.target.closest('[data-src]');
      if (src) { view.source = src.dataset.src; U.$$('[data-src]', body).forEach((b) => b.classList.toggle('on', b === src)); draw(); return; }
      const q = e.target.closest('[data-quick]');
      if (q) {
        const picks = quickList(q.dataset.quick);
        selected = new Set(picks.map((r) => r.key));
        U.toast(`${picks.length} agents select hue ✓ — ab bulk target apply karo`, 'ok');
        draw(); return;
      }
      if (e.target.closest('#tg-all')) { const on = e.target.closest('#tg-all').checked; filteredRows().forEach((r) => { if (on) selected.add(r.key); else selected.delete(r.key); }); draw(); return; }
      if (e.target.closest('#tg-select-page')) { filteredRows().forEach((r) => selected.add(r.key)); draw(); return; }
      if (e.target.closest('#tg-clear-sel')) { selected.clear(); draw(); return; }
      const saveBtn = e.target.closest('#tg-save');
      if (saveBtn) { U.withButtonBusy(saveBtn, saveTargets, 'Saving targets…'); return; }
      if (e.target.closest('#tg-xlsx')) { exportExcel(); return; }
      const apply = e.target.closest('#tg-bulk-apply');
      if (apply) {
        const v = Number(U.$('#tg-bulk', body).value) || 0;
        if (!selected.size) return U.toast('Pehle agents select karo (Quick select ya checkbox)', 'err');
        if (!v) return U.toast('Target value daalo', 'err');
        selected.forEach((k) => targetDrafts.set(k, v));
        U.toast(`${selected.size} agents ko overall target ${U.fmt(v)} set hua — Save dabana mat bhoolna`, 'ok');
        draw(); return;
      }
      if (e.target.closest('#tg-bulk-all')) {
        const v = Number(U.$('#tg-bulk', body).value) || 0;
        if (!v) return U.toast('Target value daalo', 'err');
        filteredRows().forEach((r) => targetDrafts.set(r.key, v));
        draw(); return;
      }
      const applyClassBulk = (rows) => {
        const values = CLASS_TARGETS.map((c) => {
          const input = U.$(`#tg-bulk-${c.key}`, body);
          return { key: c.key, value: input && input.value !== '' ? Math.max(0, Math.floor(Number(input.value) || 0)) : null };
        }).filter((x) => x.value !== null);
        if (!values.length) { U.toast('VC4 / VC20 / VC5+ me kam se kam ek target daalo', 'err'); return; }
        rows.forEach((r) => {
          const ct = classTargetsFor(r.key);
          values.forEach((x) => { ct[x.key] = x.value; });
          classTargetDrafts.set(r.key, ct);
        });
        U.toast(`${values.map((x) => x.key.toUpperCase() + ' ' + U.fmt(x.value)).join(' · ')} targets ${rows.length} agents par apply hue — Save dabana mat bhoolna`, 'ok');
        draw();
      };
      if (e.target.closest('#tg-bulk-class-apply')) {
        if (!selected.size) return U.toast('Pehle agents select karo (Quick select ya checkbox)', 'err');
        applyClassBulk(list.filter((r) => selected.has(r.key))); return;
      }
      if (e.target.closest('#tg-bulk-class-all')) { applyClassBulk(filteredRows()); return; }
      const pick = e.target.closest('[data-pick]');
      if (pick) {
        const tr = pick.closest('tr'); const key = tr && tr.dataset.key;
        if (key) { if (pick.checked) selected.add(key); else selected.delete(key); const cnt = U.$('#tg-sel-count', body); if (cnt) cnt.textContent = selected.size ? `${selected.size} selected` : ''; }
      }
    });
    body.addEventListener('change', (e) => {
      const inp = e.target.closest('[data-target]');
      if (inp) { const v = Math.max(0, Math.floor(Number(inp.value) || 0)); targetDrafts.set(inp.dataset.target, v); return; }
      const classInp = e.target.closest('[data-class-target]');
      if (classInp) {
        const key = classInp.dataset.classTargetKey, cls = classInp.dataset.classTarget;
        if (!key || !CLASS_TARGETS.some((c) => c.key === cls)) return;
        const ct = classTargetsFor(key);
        ct[cls] = Math.max(0, Math.floor(Number(classInp.value) || 0));
        classTargetDrafts.set(key, ct);
      }
    });
  }

  // ================================ 🏅 TAB 2: achievement history ======================================
  async function mountAchieve(root) {
    const body = U.$('#tg-body', root);
    body.innerHTML = U.spinner('Achievement history ban rahi hai…');
    const all = allSavedTargets();
    if (!all.length) {
      body.innerHTML = `<div class="empty-state">🏅 Abhi koi saved target nahi hai.<br><span class="dim small">🎯 Targets tab me jaake agents ko targets do — phir yahan month-by-month achievement history dikhegi.</span></div>`;
      return;
    }
    const [agentsR, masterR] = await Promise.allSettled([S.need('agents'), G.enabled() ? G.need('master') : Promise.resolve([])]);
    if (!root.isConnected) return;
    const agents = agentsR.status === 'fulfilled' ? agentsR.value : [];
    const gvOk = masterR.status === 'fulfilled';

    // FF actuals: ym → Map(key → n)
    const ffByYm = new Map();
    for (const a of agents) {
      if (a.channel !== 'First Forward') continue;
      let m = ffByYm.get(a.ym); if (!m) { m = new Map(); ffByYm.set(a.ym, m); }
      const k = keyOf('ff', a.name); m.set(k, (m.get(k) || 0) + a.n);
    }
    // GV actuals per target month
    const gvByYm = new Map();
    const yms = U.uniq(all.map((t) => t.ym)).sort().reverse();
    if (gvOk) for (const ym of yms) gvByYm.set(ym, new Map(G.agentRollup(ym).map((a) => [keyOf('gv', a.agentName), a.total])));

    const rows = [];
    for (const t of all) {
      const src = t.key.startsWith('gv|') ? 'gv' : 'ff';
      const actual = src === 'ff' ? ((ffByYm.get(t.ym) || new Map()).get(t.key) || 0) : ((gvByYm.get(t.ym) || new Map()).get(t.key) || 0);
      const target = Number(t.target) || 0;
      rows.push({ ym: t.ym, src, agent: t.agent || t.key.split('|')[1], tl: t.tl || '—', target, actual, p: pct(actual, target) });
    }
    rows.sort((a, b) => b.ym.localeCompare(a.ym) || (b.p === null ? -1 : b.p) - (a.p === null ? -1 : a.p));

    const achieved = rows.filter((r) => r.p !== null && r.p >= 100);
    const totTarget = U.sum(rows, (r) => r.target), totActual = U.sum(rows, (r) => r.actual);
    const monthSum = yms.map((ym) => {
      const mr = rows.filter((r) => r.ym === ym);
      const got = mr.filter((r) => r.p !== null && r.p >= 100).length;
      return `<button class="chip ${ym === view.ym ? 'on' : ''}" data-go-month="${ym}" title="Targets tab kholo">${got}/${mr.length} achieved · ${esc(U.labelYM(ym))}</button>`;
    }).join(' ');

    const excel = () => {
      if (!FF.auth.can('export')) { U.toast('Download permission nahi hai', 'err'); return; }
      const sum = {
        name: 'Summary', filterRows: 7, header: ['Metric', 'Value'],
        rows: [
          ['Report', `${FF.config.brand} · Target achievement history`], ['Months covered', yms.length],
          ['Total targets', rows.length], ['Achieved', achieved.length],
          ['Achievement rate', rows.length ? `${Math.round((achieved.length / rows.length) * 100)}%` : '—'],
          ['Total target tags', totTarget], ['Total actual tags', totActual],
          ['Overall attainment', totTarget ? `${Math.round((totActual / totTarget) * 100)}%` : '—'],
          ['Generated', new Date().toLocaleString('en-IN')]
        ]
      };
      const hist = { name: 'Achievements', header: ['Month', 'Source', 'Agent', 'TL', 'Target', 'Actual', 'Achievement %', 'Status'], rows: rows.map((r) => [U.labelYM(r.ym, true), r.src === 'ff' ? 'First Forward' : 'GV Partner', r.agent, r.tl, r.target, r.actual, r.p === null ? '' : Math.round(r.p), r.p !== null && r.p >= 100 ? '✅ Achieved' : '❌ Not achieved']) };
      FF.xlsx.download(`achievement-history-${U.stamp()}.xlsx`, [sum, hist]);
      U.toast('Achievement history Excel ready ✓', 'ok');
      if (FF.notifications && FF.notifications.logClick) FF.notifications.logClick('Achievement history Excel', `${rows.length} rows`);
    };

    body.innerHTML = `<div class="kpi-grid">
        <div class="kpi g9"><div class="kpi-top"><span class="kpi-title">Months covered</span><span class="kpi-icon">📅</span></div><div class="kpi-value">${U.fmt(yms.length)}</div><div class="kpi-foot">${U.fmt(rows.length)} targets total</div></div>
        <div class="kpi g5" data-kpi="scope=list&list=tg.achieved&src=both"><div class="kpi-top"><span class="kpi-title">Achieved</span><span class="kpi-icon">✅</span></div><div class="kpi-value">${U.fmt(achieved.length)}</div><div class="kpi-foot">${rows.length ? U.fmtPct((achieved.length / rows.length) * 100, 0) : '0%'} of all targets</div></div>
        <div class="kpi g6"><div class="kpi-top"><span class="kpi-title">Overall attainment</span><span class="kpi-icon">🏷️</span></div><div class="kpi-value">${totTarget ? U.fmtPct((totActual / totTarget) * 100, 0) : '—'}</div><div class="kpi-foot">${U.fmt(totActual)} / ${U.fmt(totTarget)} tags</div></div>
        <div class="kpi g1"><div class="kpi-top"><span class="kpi-title">Best month</span><span class="kpi-icon">🏆</span></div><div class="kpi-value">${(() => { const best = yms.map((ym) => { const mr = rows.filter((r) => r.ym === ym); return { ym, got: mr.filter((r) => r.p >= 100).length, n: mr.length }; }).filter((x) => x.n).sort((a, b) => (b.got / b.n) - (a.got / a.n))[0]; return best ? esc(U.labelYM(best.ym)) : '—'; })()}</div><div class="kpi-foot">Achievement rate ke hisaab se</div></div>
      </div>
      <div class="chip-row"><span class="dim small">Month-wise:</span>${monthSum}</div>
      ${card(`🏅 Achievement history <span class="dim">· month-by-month, target vs actual</span>`,
        `<div class="table-wrap tall"><table class="tbl sticky-first"><thead><tr><th>Month</th><th>Agent / TL</th><th>Source</th><th class="num">Target</th><th class="num">Actual</th><th class="num">Achievement</th><th>Status</th></tr></thead><tbody>${rows.map((r) => {
          const ok = r.p !== null && r.p >= 100;
          const bar = `<div class="tgt-track"><div class="tgt-fill ${ok ? 'ok' : (r.p || 0) >= 60 ? 'mid' : 'low'}" style="width:${Math.min(100, r.p || 0)}%"></div></div>`;
          return `<tr><td><b>${esc(U.labelYM(r.ym, true))}</b></td><td><b>${esc(r.agent)}</b><br><small class="dim">${esc(r.tl)}</small></td><td>${r.src === 'ff' ? '<span class="badge indigo">FF</span>' : '<span class="badge teal">GV</span>'}</td><td class="num">${U.fmt(r.target)}</td><td class="num"><b>${U.fmt(r.actual)}</b></td><td style="min-width:120px">${bar}<small class="dim">${r.p === null ? '—' : Math.round(r.p)}%</small></td><td>${ok ? '<b>✅ Achieved</b>' : '<span class="dim">❌ Missed</span>'}</td></tr>`;
        }).join('')}</tbody></table></div>`,
        `<button class="btn small" id="ach-xlsx">⬇ Excel</button>`)}
      <p class="dim small">Achievement = actual issuance ÷ target. Current month MTD hai — baaki months full-month. Naye targets save karne par history apne aap update hoti hai.</p>`;
    U.$('#ach-xlsx', body).addEventListener('click', excel);
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-go-month]');
      if (b) { view.ym = b.dataset.goMonth; view.tab = 'targets'; FF.app.navigate('targets', { month: view.ym, tab: 'targets' }); }
    });
  }

  // ================================ 👥 TAB 3: TL-wise rollup ======================================
  async function mountTl(root) {
    const body = U.$('#tg-body', root);
    body.innerHTML = `<div class="card controls">
        <div class="finder-row">
          <label>📅 Month <select class="input" id="tl-ym"></select></label>
          <div class="seg" id="tl-source"><button class="seg-btn ${view.source === 'all' ? 'on' : ''}" data-tlsrc="all">All</button><button class="seg-btn ${view.source === 'ff' ? 'on' : ''}" data-tlsrc="ff">🟦 First Forward</button><button class="seg-btn ${view.source === 'gv' ? 'on' : ''}" data-tlsrc="gv">🟩 GV Partner</button></div>
          <label>Sort <select class="input" id="tl-sort"><option value="cur">Issuance (high → low)</option><option value="pct">Achievement %</option><option value="growth">Growth %</option><option value="target">Target size</option><option value="agents">Agents count</option></select></label>
        </div>
      </div>
      <div id="tl-inner">${U.spinner('TL-wise rollup ban raha hai…')}</div>`;
    let P = null;
    try { P = await prep(); } catch (err) { U.$('#tl-inner', body).innerHTML = U.errorBox(err, 'data-action="refresh"'); return; }
    if (!root.isConnected) return;
    list = P.rows;

    const ymSel = U.$('#tl-ym', body);
    ymSel.innerHTML = P.months.slice().reverse().map((m) => `<option value="${m}" ${m === view.ym ? 'selected' : ''}>${U.labelYM(m, true)}</option>`).join('');

    const drawTl = () => {
      const inner = U.$('#tl-inner', body);
      const srcLbl = view.source === 'ff' ? 'First Forward' : view.source === 'gv' ? 'GV Partner' : 'FF + GV';
      let r = list;
      if (view.source !== 'all') r = r.filter((x) => x.source === view.source);
      const groups = new Map();
      for (const x of r) {
        const tl = x.tl && x.tl !== '—' && FF.config.isRealTl(x.tl) ? x.tl : `🚫 ${FF.config.directLabel({ tlName: x.tl }, x.channel === 'GV Partner' ? 'gv' : 'ff')}`;
        let g = groups.get(tl);
        if (!g) { g = { tl, agents: 0, withTarget: 0, achieved: 0, target: 0, cur: 0, last: 0, vc4: 0, vc20: 0, vc5p: 0 }; groups.set(tl, g); }
        g.agents++;
        const t = targetDrafts.get(x.key) || 0;
        if (t) { g.withTarget++; g.target += t; if (x.cur >= t) g.achieved++; }
        g.cur += x.cur; g.last += x.last; g.vc4 += x.vc4; g.vc20 += (x.vc20 || 0); g.vc5p += (x.vc5p || 0);
      }
      let arr = [...groups.values()].map((g) => ({ ...g, growth: U.growth(g.cur, g.last), p: pct(g.cur, g.target) }));
      // 🎯 TL monthly goals (admin set karta hai; feature tlGoals ON ho to dikhenge)
      const goalsOn = FF.config.features ? FF.config.features.tlGoals !== false : true;
      const goalMap = new Map(goalsOn ? (((FF.auth.settings && FF.auth.settings.tlTargets) || []).filter((t) => t && t.ym === view.ym && Number(t.target) >= 0)).map((t) => [t.tl, Number(t.target)]) : []);
      if (goalsOn) arr.forEach((g) => { g.goal = goalMap.get(g.tl) || 0; });
      const goalCell = (g) => {
        if (!goalsOn) return '';
        if (FF.auth.isAdmin()) return `<input class="input" type="number" min="0" style="width:96px" data-tlgoal="${esc(g.tl)}" value="${g.goal || ''}" title="TL ka is mahine ka goal (0 = none)">`;
        return g.goal ? `<b>${U.fmt(g.goal)}</b><br><small class="dim">${U.fmtPct((g.cur / g.goal) * 100, 0)}</small>` : '<span class="dim">—</span>';
      };
      const sorters = {
        cur: (a, b) => b.cur - a.cur,
        pct: (a, b) => (b.p === null ? -1 : b.p) - (a.p === null ? -1 : a.p),
        growth: (a, b) => (b.growth === null ? -999 : b.growth) - (a.growth === null ? -999 : a.growth),
        target: (a, b) => b.target - a.target,
        agents: (a, b) => b.agents - a.agents
      };
      arr.sort(sorters[view.tlSort] || sorters.cur);
      const medals = ['🥇', '🥈', '🥉'];
      const totCur = U.sum(arr, (g) => g.cur), totTarget = U.sum(arr, (g) => g.target);
      inner.innerHTML = `<div class="kpi-grid">
          <div class="kpi g9"><div class="kpi-top"><span class="kpi-title">TLs</span><span class="kpi-icon">👥</span></div><div class="kpi-value">${U.fmt(arr.length)}</div><div class="kpi-foot">${esc(srcLbl)} · ${esc(U.labelYM(view.ym))}</div></div>
          <div class="kpi g6"><div class="kpi-top"><span class="kpi-title">Team issuance</span><span class="kpi-icon">🏷️</span></div><div class="kpi-value">${U.fmt(totCur)}</div><div class="kpi-foot">${totTarget ? `${U.fmtPct((totCur / totTarget) * 100, 0)} of total target ${U.fmt(totTarget)}` : 'Target set nahi hai'}</div></div>
          <div class="kpi g5"><div class="kpi-top"><span class="kpi-title">Team targets achieved</span><span class="kpi-icon">✅</span></div><div class="kpi-value">${U.fmt(U.sum(arr, (g) => g.achieved))}</div><div class="kpi-foot">${U.fmt(U.sum(arr, (g) => g.withTarget))} targets set the</div></div>
          <div class="kpi g1"><div class="kpi-top"><span class="kpi-title">Top TL</span><span class="kpi-icon">🏆</span></div><div class="kpi-value" style="font-size:18px">${arr.length ? esc(arr.sort((a, b) => b.cur - a.cur)[0].tl) : '—'}</div><div class="kpi-foot">Issuance leaderboard</div></div>
        </div>
        ${card(`👥 TL-wise rollup <span class="dim">· ${esc(U.labelYM(view.ym))}${view.ym === P.cur ? ' (MTD)' : ''}</span>`,
        arr.length ? `<div class="table-wrap tall"><table class="tbl sticky-first"><thead><tr><th>#</th><th>Team Leader</th><th class="num">Agents</th><th class="num">Target</th><th class="num">Issuance</th><th style="min-width:130px">Achievement</th><th class="num">Last month</th><th class="num">Growth</th><th class="num">Targets achieved</th>${goalsOn ? '<th class="num">🎯 TL goal</th>' : ''}</tr></thead><tbody>${(() => { const sorted = [...arr].sort((a, b) => b.cur - a.cur); return arr.map((g) => { const rank = sorted.indexOf(g); const bar = g.target ? `<div class="tgt-track"><div class="tgt-fill ${(g.p || 0) >= 100 ? 'ok' : (g.p || 0) >= 60 ? 'mid' : 'low'}" style="width:${Math.min(100, g.p || 0)}%"></div></div><small class="dim">${Math.round(g.p || 0)}%</small>` : '<span class="dim">no target</span>'; const gr = g.growth === null ? '<span class="dim">new</span>' : U.deltaHtml(g.growth, { decimals: 0 }); return `<tr><td>${rank < 3 ? medals[rank] : rank + 1}</td><td><b>${esc(g.tl)}</b></td><td class="num">${U.fmt(g.agents)}</td><td class="num">${g.target ? U.fmt(g.target) : '<span class="dim">—</span>'}</td><td class="num"><b>${U.fmt(g.cur)}</b><br><small class="dim" title="VC4 · VC20 · VC5+ (All Comm = VC20 + VC5+)">V4 ${U.fmt(g.vc4)} · V20 ${U.fmt(g.vc20)} · V5+ ${U.fmt(g.vc5p)}</small></td><td>${bar}</td><td class="num">${U.fmt(g.last)}</td><td class="num">${gr}</td><td class="num">${g.withTarget ? `${g.achieved}/${g.withTarget}` : '<span class="dim">—</span>'}</td>${goalsOn ? `<td class="num">${goalCell(g)}</td>` : ''}</tr>`; }).join(''); })()}</tbody></table></div>` : '<div class="empty-state">Is month me koi data nahi mila.</div>',
        `${FF.auth.isAdmin() && goalsOn ? '<button class="btn small primary" id="tl-goal-save" title="Upar goal column me numbers daal ke yahan Save karo">💾 Save TL goals</button>' : ''}<button class="btn small" id="tl-xlsx">⬇ Excel</button>`)}
        <p class="dim small">Jo agents kisi TL ke under nahi hain wo <b>🚫 Direct Agent</b> group me dikhte hain (FF rule: TL Name APS · GV rule: TL ID + TL Name blank). Leaderboard issuance ke hisaab se ranked hai.</p>`;
    };
    drawTl();

    ymSel.addEventListener('change', () => { view.ym = ymSel.value; FF.app.navigate('targets', { month: view.ym, tab: view.tab }); });
    U.$('#tl-sort', body).value = view.tlSort;
    U.$('#tl-sort', body).addEventListener('change', (e) => { view.tlSort = e.target.value; drawTl(); });
    body.addEventListener('click', (e) => {
      const src = e.target.closest('[data-tlsrc]');
      if (src) { view.source = src.dataset.tlsrc; U.$$('[data-tlsrc]', body).forEach((b) => b.classList.toggle('on', b === src)); drawTl(); return; }
      if (e.target.closest('#tl-goal-save')) {
        if (!FF.auth.isAdmin()) return;
        const inputs = U.$$('[data-tlgoal]', body);
        const entries = [];
        inputs.forEach((inp) => { const v = Math.max(0, Math.floor(Number(inp.value) || 0)); if (v > 0) entries.push({ ym: view.ym, tl: inp.dataset.tlgoal, target: v }); });
        const others = (((FF.auth.settings && FF.auth.settings.tlTargets) || []).filter((t) => t && t.ym && t.ym !== view.ym));
        const next = others.concat(entries);
        const btn = e.target.closest('#tl-goal-save');
        U.withButtonBusy(btn, async () => {
          try {
            await FF.auth.api('/api/settings', 'PUT', { tlTargets: next });
            FF.auth.settings.tlTargets = next;
            U.toast('🎯 TL goals save ho gaye ✓', 'ok');
            drawTl();
          } catch (err) { U.toast(err.message, 'err'); }
        }, 'Saving goals…');
        return;
      }
      if (e.target.closest('#tl-xlsx')) {
        if (!FF.auth.can('export')) { U.toast('Download permission nahi hai', 'err'); return; }
        let r = list; if (view.source !== 'all') r = r.filter((x) => x.source === view.source);
        const groups = new Map();
        for (const x of r) {
          const tl = x.tl && x.tl !== '—' && FF.config.isRealTl(x.tl) ? x.tl : `🚫 ${FF.config.directLabel({ tlName: x.tl }, x.channel === 'GV Partner' ? 'gv' : 'ff')}`;
          let g = groups.get(tl);
          if (!g) { g = { tl, agents: 0, withTarget: 0, achieved: 0, target: 0, cur: 0, last: 0 }; groups.set(tl, g); }
          g.agents++;
          const t = targetDrafts.get(x.key) || 0;
          if (t) { g.withTarget++; g.target += t; if (x.cur >= t) g.achieved++; }
          g.cur += x.cur; g.last += x.last;
        }
        const arr = [...groups.values()].sort((a, b) => b.cur - a.cur);
        const sheet = { name: 'TL rollup', header: ['Rank', 'Team Leader', 'Agents', 'Target', 'Issuance', 'VC4', 'VC20', 'VC5+', 'All Commercial', 'Achievement %', 'Last month', 'Targets achieved'], rows: arr.map((g, i) => [i + 1, g.tl, g.agents, g.target || '', g.cur, g.vc4, g.vc20, g.vc5p, (g.vc20 || 0) + (g.vc5p || 0), g.target ? Math.round((g.cur / g.target) * 100) : '', g.last, g.withTarget ? `${g.achieved}/${g.withTarget}` : '']) };
        const sum = { name: 'Summary', filterRows: 7, header: ['Metric', 'Value'], rows: [['Report', `${FF.config.brand} · TL-wise rollup`], ['Month', U.labelYM(view.ym, true)], ['TLs', arr.length], ['Total issuance', U.sum(arr, (g) => g.cur)], ['Total target', U.sum(arr, (g) => g.target)], ['Generated', new Date().toLocaleString('en-IN')]] };
        FF.xlsx.download(`tl-rollup-${view.ym}-${U.stamp()}.xlsx`, [sum, sheet]);
        U.toast('TL rollup Excel ready ✓', 'ok');
        if (FF.notifications && FF.notifications.logClick) FF.notifications.logClick('TL rollup Excel', view.ym);
      }
    });
  }

  FF.pages.targets = { title: 'Targets', render };
})(window.FF);
