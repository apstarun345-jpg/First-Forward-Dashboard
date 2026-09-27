/* 🎯 Targets page: FF + GV agents ko short-list karke monthly targets do (Top N, low issuance,
   VC4-wise, commercial-wise, last vs current growth), progress track karo aur Excel download karo.
   Targets settings.targets me save hote hain (server + Google Sheet APP_STORAGE backup). */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, M = FF.model, S = FF.store, G = FF.gv, C = FF.charts;
  const esc = U.esc;
  const norm = (s) => U.clean(s).toUpperCase().replace(/\s+/g, ' ');
  const keyOf = (source, name) => `${source}|${norm(name)}`;

  const view = { ym: '', source: 'all', sort: 'cur', q: '', onlyWithTarget: false };
  let list = [];            // unified agent rows
  let selected = new Set(); // keys
  let targetDrafts = new Map(); // key → number (unsaved)
  let savedTargets = [];    // settings.targets

  const card = (title, body, right) => `<section class="card"><div class="card-head"><h3>${title}</h3>${right ? `<div class="card-right">${right}</div>` : ''}</div><div class="card-body">${body}</div></section>`;

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
      if (a.tlName && !ffTl.has(k)) ffTl.set(k, a.tlName);
    }
    const ffVc4 = new Map(), ffComm = new Map();
    for (const r of agentClass) {
      if (r.ym !== view.ym) continue;
      const k = keyOf('ff', r.name);
      if (r.group === 'VC4') ffVc4.set(k, (ffVc4.get(k) || 0) + r.n); else ffComm.set(k, (ffComm.get(k) || 0) + r.n);
    }
    // GV agents (GV Master)
    const gvCur = masterR.status === 'fulfilled' ? new Map(G.agentRollup(view.ym).map((a) => [keyOf('gv', a.agentName), a])) : new Map();
    const gvLast = masterR.status === 'fulfilled' ? new Map(G.agentRollup(last).map((a) => [keyOf('gv', a.agentName), a])) : new Map();

    const rows = [];
    const push = (source, name, tl, curN, lastN, vc4, comm) => {
      rows.push({ key: keyOf(source, name), source, name, tl: tl || '—', cur: curN || 0, last: lastN || 0, vc4: vc4 || 0, comm: comm || 0, growth: U.growth(curN || 0, lastN || 0) });
    };
    for (const [k, n] of ffCur) { const name = k.split('|')[1]; push('ff', name, ffTl.get(k), n, ffLast.get(k) || 0, ffVc4.get(k) || 0, ffComm.get(k) || 0); }
    for (const [k, n] of ffLast) { if (!ffCur.has(k)) push('ff', k.split('|')[1], ffTl.get(k), 0, n, 0, 0); }
    for (const [k, a] of gvCur) push('gv', a.agentName, a.tlName, a.total, (gvLast.get(k) || {}).total || 0, a.vc4, a.comm);
    for (const [k, a] of gvLast) { if (!gvCur.has(k)) push('gv', a.agentName, a.tlName, 0, a.total, 0, 0); }

    // saved targets for this month
    savedTargets = ((FF.auth.settings && FF.auth.settings.targets) || []).filter((t) => t && t.ym === view.ym);
    targetDrafts = new Map(savedTargets.map((t) => [t.key, Number(t.target) || 0]));
    return { rows, months, cur, last, latest, gvOk: masterR.status === 'fulfilled' };
  }

  // ---- short-lists -------------------------------------------------------------------------------
  function filteredRows() {
    let r = list;
    if (view.source !== 'all') r = r.filter((x) => x.source === view.source);
    if (view.onlyWithTarget) r = r.filter((x) => (targetDrafts.get(x.key) || 0) > 0);
    const q = norm(view.q);
    if (q) r = r.filter((x) => norm(x.name).includes(q) || norm(x.tl).includes(q));
    const sorters = {
      cur: (a, b) => b.cur - a.cur,
      last: (a, b) => b.last - a.last,
      growth: (a, b) => (b.growth === null ? -999 : b.growth) - (a.growth === null ? -999 : a.growth),
      vc4: (a, b) => b.vc4 - a.vc4,
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
    const header = ['Source', 'Agent', 'TL', 'Target', `${U.labelYM(view.ym)} issuance`, 'Last month', 'VC4', 'Commercial', 'VC4 %', 'Growth %', 'Progress %', 'Status'];
    const body = rows.map((r) => {
      const t = targetDrafts.get(r.key) || 0;
      const pct = t ? Math.round((r.cur / t) * 100) : null;
      const status = !t ? 'No target' : pct >= 100 ? '✅ Achieved' : pct >= 70 ? '🟢 On track' : pct >= 40 ? '🟠 Behind' : '🔴 Far behind';
      return [r.source === 'ff' ? 'First Forward' : 'GV Partner', r.name, r.tl, t || '', r.cur, r.last, r.vc4, r.comm, r.cur ? Number(((r.vc4 / r.cur) * 100).toFixed(1)) : 0, r.growth === null ? '' : Number(r.growth.toFixed(1)), pct === null ? '' : pct, status];
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
    const byKey = new Map(savedTargets.map((t) => [t.key, t]));
    for (const [key, val] of targetDrafts) {
      if (!val) continue;
      const row = list.find((r) => r.key === key);
      byKey.set(key, { key, ym: view.ym, source: row ? row.source : 'ff', agent: row ? row.name : key.split('|')[1], tl: row ? row.tl : '', target: val, by: FF.auth.user.username, at: new Date().toISOString() });
    }
    // drafts set to 0 → remove saved target for this month
    for (const t of savedTargets) { if ((targetDrafts.get(t.key) || 0) === 0 && targetDrafts.has(t.key)) byKey.delete(t.key); }
    const others = ((FF.auth.settings && FF.auth.settings.targets) || []).filter((t) => t && t.ym !== view.ym);
    try {
      const out = await FF.auth.api('/api/settings', 'PUT', { settings: { targets: [...others, ...byKey.values()] } });
      FF.auth.applySettings(out.settings);
      U.toast('Targets save ho gaye ✓ (Google Sheet storage me bhi backup hoga)', 'ok');
      draw();
    } catch (err) { U.toast(err.message, 'err'); }
  }

  // ---- render -------------------------------------------------------------------------------------
  let draw = () => {};
  async function render(root, params) {
    if (params.month) view.ym = params.month;
    root.innerHTML = `<div class="page-head"><div><h1>🎯 Agent Targets</h1><p class="sub">First Forward + GV agents ko short-list karo (Top, Low issuance, VC4, Commercial, Growth) → target do → progress track karo → Excel download karo</p></div>
      <div class="head-actions"><button class="btn primary" data-action="refresh">↻ Refresh</button></div></div>
      <div class="card controls">
        <div class="finder-row">
          <label>📅 Month <select class="input" id="tg-ym"></select></label>
          <div class="seg" id="tg-source"><button class="seg-btn ${view.source === 'all' ? 'on' : ''}" data-src="all">All</button><button class="seg-btn ${view.source === 'ff' ? 'on' : ''}" data-src="ff">🟦 First Forward</button><button class="seg-btn ${view.source === 'gv' ? 'on' : ''}" data-src="gv">🟩 GV Partner</button></div>
          <label>Sort <select class="input" id="tg-sort"><option value="cur">Issuance (high → low)</option><option value="last">Last month</option><option value="growth">Growth %</option><option value="vc4">VC4 tags</option><option value="comm">Commercial tags</option><option value="name">Name (A-Z)</option></select></label>
          <div class="finder-input"><span class="finder-ico">🔎</span><input class="input" id="tg-q" placeholder="Agent ya TL search…" value="${esc(view.q)}"></div>
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
      </div>
      <div id="tg-body">${U.spinner('Agents aggregate ho rahe hain…')}</div>`;
    const body = U.$('#tg-body', root);

    let P = null;
    try { P = await prep(); } catch (err) { body.innerHTML = U.errorBox(err, 'data-action="refresh"'); return; }
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
      const kpis = `<div class="kpi-grid">
        <div class="kpi g9"><div class="kpi-top"><span class="kpi-title">Agents (filter me)</span><span class="kpi-icon">🧑‍💼</span></div><div class="kpi-value">${U.fmt(rows.length)}</div><div class="kpi-foot">${esc(srcLbl)} · ${esc(U.labelYM(view.ym))}</div></div>
        <div class="kpi g1"><div class="kpi-top"><span class="kpi-title">Targets set</span><span class="kpi-icon">🎯</span></div><div class="kpi-value">${U.fmt(withT.length)}</div><div class="kpi-foot">Total target <b>${U.fmt(totalTarget)}</b> tags</div></div>
        <div class="kpi g6"><div class="kpi-top"><span class="kpi-title">Issuance (with target)</span><span class="kpi-icon">🏷️</span></div><div class="kpi-value">${U.fmt(totalCur)}</div><div class="kpi-foot">${totalTarget ? `<b>${U.fmtPct((totalCur / totalTarget) * 100, 0)}</b> of target · ${isCurMonth ? 'MTD' : 'full month'}` : 'Target set karo'}</div></div>
        <div class="kpi g5"><div class="kpi-top"><span class="kpi-title">Achieved</span><span class="kpi-icon">✅</span></div><div class="kpi-value">${U.fmt(achieved)}</div><div class="kpi-foot">${withT.length ? `${U.fmtPct(U.pctOf(achieved, withT.length), 0)} of targets` : '—'}</div></div>
      </div>`;
      const rowHtml = (r) => {
        const t = targetDrafts.get(r.key) || 0;
        const pct = t ? Math.min(150, Math.round((r.cur / t) * 100)) : 0;
        const bar = t ? `<div class="tgt-track"><div class="tgt-fill ${pct >= 100 ? 'ok' : pct >= 60 ? 'mid' : 'low'}" style="width:${Math.min(100, pct)}%"></div></div><small class="dim">${pct}%</small>` : '<span class="dim">—</span>';
        const g = r.growth === null ? '<span class="dim">new</span>' : U.deltaHtml(r.growth, { decimals: 0 });
        return `<tr data-key="${esc(r.key)}">
          <td><label class="check"><input type="checkbox" data-pick ${selected.has(r.key) ? 'checked' : ''}></label></td>
          <td><b>${esc(r.name)}</b><br><small class="dim">${esc(r.tl)}</small></td>
          <td>${r.source === 'ff' ? '<span class="badge indigo">FF</span>' : '<span class="badge teal">GV</span>'}</td>
          <td class="num">${U.fmt(r.last)}</td>
          <td class="num"><b>${U.fmt(r.cur)}</b></td>
          <td class="num">${U.fmt(r.vc4)} <small class="dim">(${r.cur ? U.fmtPct(U.pctOf(r.vc4, r.cur), 0) : '0%'})</small></td>
          <td class="num">${U.fmt(r.comm)}</td>
          <td class="num">${g}</td>
          <td class="num"><input class="input tgt-input" type="number" min="0" data-target="${esc(r.key)}" value="${t || ''}" placeholder="0"></td>
          <td style="min-width:110px">${bar}</td></tr>`;
      };
      body.innerHTML = `${kpis}
        ${card(`🎯 Target table <span class="dim">· ${U.fmt(rows.length)} agents · ${esc(srcLbl)} · ${esc(U.labelYM(view.ym))}${isCurMonth ? ' (MTD)' : ''}</span>`,
        rows.length ? `<div class="table-wrap tall"><table class="tbl sticky-first"><thead><tr><th><label class="check"><input type="checkbox" id="tg-all" ${rows.length && rows.every((r) => selected.has(r.key)) ? 'checked' : ''}></label></th><th>Agent / TL</th><th>Source</th><th class="num">Last month</th><th class="num">${esc(U.labelYM(view.ym))}</th><th class="num">VC4</th><th class="num">Comm</th><th class="num">Growth</th><th class="num">Target</th><th>Progress</th></tr></thead><tbody>${rows.slice(0, 400).map(rowHtml).join('')}</tbody></table></div>${rows.length > 400 ? '<p class="dim small">Pehle 400 rows — filter/search se list chhoti karo.</p>' : ''}` : '<div class="empty-state">Koi agent match nahi hua — filter badlo.</div>',
        `<button class="btn small" id="tg-select-page">☑ Visible select</button><button class="btn small" id="tg-clear-sel">✕ Selection clear</button><button class="btn small primary" id="tg-save" ${FF.auth.isAdmin() ? '' : 'disabled title="Admin only"'}>💾 Save targets</button><button class="btn small" id="tg-xlsx">⬇ Excel</button>`)}
        <p class="dim small">Targets month <b>${esc(U.labelYM(view.ym, true))}</b> ke liye save hote hain (settings me — Google Sheet storage backup ke saath). Progress = issuance ÷ target. ${FF.auth.isAdmin() ? '' : '<b>Save sirf admin kar sakta hai.</b>'}</p>`;
      const cnt = U.$('#tg-sel-count', root);
      if (cnt) cnt.textContent = selected.size ? `${selected.size} selected` : '';
    };
    draw();

    // ---- events ----
    ymSel.addEventListener('change', () => { view.ym = ymSel.value; selected.clear(); FF.app.navigate('targets', { month: view.ym }); });
    U.$('#tg-sort', root).value = view.sort;
    U.$('#tg-sort', root).addEventListener('change', (e) => { view.sort = e.target.value; draw(); });
    U.$('#tg-q', root).addEventListener('input', U.debounce((e) => { view.q = e.target.value; draw(); }, 220));
    const onlyChk = U.$('#tg-only', root);
    if (onlyChk) onlyChk.addEventListener('change', () => { view.onlyWithTarget = onlyChk.checked; draw(); });
    root.addEventListener('click', (e) => {
      const src = e.target.closest('[data-src]');
      if (src) { view.source = src.dataset.src; U.$$('[data-src]', root).forEach((b) => b.classList.toggle('on', b === src)); draw(); return; }
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
      if (e.target.closest('#tg-save')) { saveTargets(); return; }
      if (e.target.closest('#tg-xlsx')) { exportExcel(); return; }
      const apply = e.target.closest('#tg-bulk-apply');
      if (apply) {
        const v = Number(U.$('#tg-bulk', root).value) || 0;
        if (!selected.size) return U.toast('Pehle agents select karo (Quick select ya checkbox)', 'err');
        if (!v) return U.toast('Target value daalo', 'err');
        selected.forEach((k) => targetDrafts.set(k, v));
        U.toast(`${selected.size} agents ko target ${U.fmt(v)} set hua — Save dabana mat bhoolna`, 'ok');
        draw(); return;
      }
      if (e.target.closest('#tg-bulk-all')) {
        const v = Number(U.$('#tg-bulk', root).value) || 0;
        if (!v) return U.toast('Target value daalo', 'err');
        filteredRows().forEach((r) => targetDrafts.set(r.key, v));
        draw(); return;
      }
      const pick = e.target.closest('[data-pick]');
      if (pick) {
        const tr = pick.closest('tr'); const key = tr && tr.dataset.key;
        if (key) { if (pick.checked) selected.add(key); else selected.delete(key); const cnt = U.$('#tg-sel-count', root); if (cnt) cnt.textContent = selected.size ? `${selected.size} selected` : ''; }
      }
    });
    root.addEventListener('change', (e) => {
      const inp = e.target.closest('[data-target]');
      if (inp) { const v = Number(inp.value) || 0; if (v) targetDrafts.set(inp.dataset.target, v); else targetDrafts.set(inp.dataset.target, 0); }
    });
  }

  FF.pages.targets = { title: 'Targets', render };
})(window.FF);
