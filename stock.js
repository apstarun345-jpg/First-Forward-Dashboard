/* Stock page (StockDataa): quick-find (agent / TL / class) → pivot on screen + Excel export
   (Sheet 1 = summary pivot as shown, Sheet 2 = every matching StockDataa row). VC4 vs Commercial everywhere. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, M = FF.model, C = FF.charts, S = FF.store;
  const esc = U.esc;
  const norm = (s) => U.clean(s).toUpperCase().replace(/\s+/g, ' ');
  const clsNum = (c) => parseInt(String(c).replace(/\D/g, ''), 10) || 999;
  const isVc4 = (cls) => M.classGroup(cls) === 'VC4';
  const view = { scope: '', value: '', cls: '', q: '' };

  function coverBadge(days) {
    const t = FF.config.thresholds;
    if (days === null || !Number.isFinite(days)) return '<span class="badge gray">no issuance</span>';
    if (days < t.coverRed) return `<span class="badge red">🔴 ${U.fmt(days)} days</span>`;
    if (days < t.coverOrange) return `<span class="badge orange">🟠 ${U.fmt(days)} days</span>`;
    if (days < t.coverAmber) return `<span class="badge amber">🟡 ${U.fmt(days)} days</span>`;
    return `<span class="badge green">🟢 ${U.fmt(days)} days</span>`;
  }
  const compareBar = (a, b, la, lb, ca, cb) => {
    const t = (a || 0) + (b || 0);
    const pa = t ? (a / t) * 100 : 0;
    return `<div class="cmp"><div class="cmp-head"><span><i style="background:${ca || '#6366f1'}"></i>${esc(la)} <b>${U.fmt(a)}</b> <small class="dim">${U.fmtPct(pa, 0)}</small></span><span><small class="dim">${U.fmtPct(100 - pa, 0)}</small> <b>${U.fmt(b)}</b> ${esc(lb)}<i style="background:${cb || '#f59e0b'}"></i></span></div><div class="cmp-track"><div style="width:${pa}%;background:${ca || '#6366f1'}"></div><div style="width:${100 - pa}%;background:${cb || '#f59e0b'}"></div></div></div>`;
  };
  const kpi = (cls, title, icon, value, foot) => `<div class="kpi ${cls}"><div class="kpi-top"><span class="kpi-title">${esc(title)}</span><span class="kpi-icon">${icon}</span></div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot || ''}</div></div>`;
  const card = (title, body, right, cls) => `<section class="card ${cls || ''}"><div class="card-head"><h3>${title}</h3>${right ? `<div class="card-right">${right}</div>` : ''}</div><div class="card-body">${body}</div></section>`;

  // ---- data prep -------------------------------------------------------------------------------
  function prep() {
    const stock = S.get('stock') || [];
    const stockAgents = S.get('stockAgents') || [];
    const stockTypes = S.get('stockTypes') || [];
    const daily = S.get('daily') || [];
    const issued = S.get('agents') || [];
    const latest = M.latestDate(daily);
    const cur = latest ? U.ymKey(latest) : null;
    const elapsed = latest ? latest.getDate() : 0;
    const classes = U.uniq(stock.map((r) => r.cls)).sort((a, b) => clsNum(a) - clsNum(b));
    const tlIssued = new Map(), agIssued = new Map(), agIssuedVc4 = new Map();
    const agentClass = S.get('agentClass') || [];
    for (const a of issued) { if (a.ym !== cur) continue; tlIssued.set(norm(a.tlName), (tlIssued.get(norm(a.tlName)) || 0) + a.n); agIssued.set(norm(a.name), (agIssued.get(norm(a.name)) || 0) + a.n); }
    for (const a of agentClass) { if (a.ym !== cur || a.group !== 'VC4') continue; agIssuedVc4.set(norm(a.name), (agIssuedVc4.get(norm(a.name)) || 0) + a.n); }
    // agent map
    const agMap = new Map();
    for (const a of stockAgents) {
      const k = norm(a.agentName);
      if (!agMap.has(k)) agMap.set(k, { id: a.agentId, name: a.agentName, tl: a.tlName, total: 0, vc4: 0, comm: 0, byClass: new Map() });
      const o = agMap.get(k); o.total += a.n; if (a.group === 'VC4') o.vc4 += a.n; else o.comm += a.n; o.byClass.set(a.cls, (o.byClass.get(a.cls) || 0) + a.n);
      if (!o.id && a.agentId) o.id = a.agentId;
    }
    const agents = [...agMap.values()].map((a) => { a.iss = agIssued.get(norm(a.name)) || 0; a.issVc4 = agIssuedVc4.get(norm(a.name)) || 0; const perDay = elapsed ? a.iss / elapsed : 0; a.cover = perDay ? a.vc4 / perDay : null; return a; }).sort((a, b) => b.total - a.total);
    // TL map (APS etc. excluded from TL views, but counted in totals)
    const tlMap = new Map();
    for (const r of stock) {
      const k = r.tlName;
      if (!tlMap.has(k)) tlMap.set(k, { name: k, total: 0, vc4: 0, comm: 0, byClass: new Map(), excluded: FF.config.isExcludedTl(k) });
      const o = tlMap.get(k); o.total += r.n; if (r.group === 'VC4') o.vc4 += r.n; else o.comm += r.n; o.byClass.set(r.cls, (o.byClass.get(r.cls) || 0) + r.n);
    }
    const tls = [...tlMap.values()].map((t) => { t.iss = tlIssued.get(norm(t.name)) || 0; const perDay = elapsed ? t.iss / elapsed : 0; t.cover = perDay ? t.vc4 / perDay : null; t.agents = agents.filter((a) => norm(a.tl) === norm(t.name)).length; return t; }).sort((a, b) => b.total - a.total);
    const total = U.sum(stock, (r) => r.n), vc4 = U.sum(stock.filter((r) => r.group === 'VC4'), (r) => r.n);
    const byClass = U.groupSum(stock, (r) => r.cls, (r) => r.n);
    const curS = cur ? M.summary(daily, cur) : null;
    return { stock, stockTypes, classes, agents, tls, total, vc4, comm: total - vc4, byClass, cur, elapsed, curS, latest, agIssued, tlIssued };
  }

  // ---- pivots ---------------------------------------------------------------------------------
  function agentPivot(P, agent) {
    const types = P.stockTypes.filter((r) => norm(r.agentName) === norm(agent.name));
    const typeNames = U.topEntries(U.groupSum(types, (r) => r.tagType, (r) => r.n)).map((e) => e[0]);
    const classes = P.classes.filter((c) => (agent.byClass.get(c) || 0) > 0);
    const header = ['Class', 'Group', ...typeNames, 'Total', 'Share %'];
    const rows = classes.map((c) => {
      const cells = typeNames.map((t) => U.sum(types.filter((r) => r.cls === c && r.tagType === t), (r) => r.n));
      const tot = agent.byClass.get(c) || 0;
      return [c, isVc4(c) ? 'VC4' : 'Commercial', ...cells, tot, agent.total ? Number(((tot / agent.total) * 100).toFixed(1)) : 0];
    });
    rows.push(['Total', '', ...typeNames.map((t) => U.sum(types.filter((r) => r.tagType === t), (r) => r.n)), agent.total, 100]);
    return { header, rows, typeNames };
  }
  function tlPivot(P, tl) {
    const list = P.agents.filter((a) => norm(a.tl) === norm(tl.name));
    const classes = P.classes.filter((c) => (tl.byClass.get(c) || 0) > 0);
    const header = ['Agent ID', 'Agent', ...classes, 'VC4', 'Commercial', 'Total', `MTD issued`, 'VC4 cover (days)'];
    const rows = list.map((a) => [a.id, a.name, ...classes.map((c) => a.byClass.get(c) || 0), a.vc4, a.comm, a.total, a.iss, a.cover === null ? '' : Math.round(a.cover)]);
    rows.push(['', 'Total', ...classes.map((c) => tl.byClass.get(c) || 0), tl.vc4, tl.comm, tl.total, tl.iss, tl.cover === null ? '' : Math.round(tl.cover)]);
    return { header, rows, classes, list };
  }
  function classPivot(P, cls) {
    const rowsTl = P.tls.filter((t) => !t.excluded && (t.byClass.get(cls) || 0) > 0).sort((a, b) => (b.byClass.get(cls) || 0) - (a.byClass.get(cls) || 0));
    const header = ['TL', `${cls} stock`, 'Total stock', `${cls} share %`, 'Agents holding'];
    const rows = rowsTl.map((t) => [t.name, t.byClass.get(cls) || 0, t.total, Number((((t.byClass.get(cls) || 0) / t.total) * 100).toFixed(1)), P.agents.filter((a) => norm(a.tl) === norm(t.name) && (a.byClass.get(cls) || 0) > 0).length]);
    return { header, rows };
  }
  const pivotTable = (pv, opts) => `<div class="table-wrap tall"><table class="tbl sticky-first ${opts && opts.compact ? 'compact' : ''}"><thead><tr>${pv.header.map((h, i) => `<th class="${i >= (opts && opts.numFrom !== undefined ? opts.numFrom : 2) ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${pv.rows.map((r, ri) => `<tr class="${ri === pv.rows.length - 1 && r.includes('Total') ? 'total-row' : ''}" ${opts && opts.rowAttr ? opts.rowAttr(r, ri) : ''}>${r.map((c, i) => `<td class="${typeof c === 'number' ? 'num' : ''}">${typeof c === 'number' ? U.fmt(c, 1) : esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

  // ---- excel export ---------------------------------------------------------------------------
  async function exportExcel(P, sel, pivot, btn) {
    if (!FF.auth.can('export')) { U.toast('Download permission nahi hai', 'err'); return; }
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = '⏳ StockDataa rows la rahe hain…';
    try {
      const filter = sel.scope === 'agent' ? { agent: sel.value } : sel.scope === 'tl' ? { tl: sel.value } : { cls: sel.value };
      const raw = await M.loadStockRows(filter);
      const meta = [['Report', `${FF.config.brand} · Stock report`], ['Scope', `${sel.scope.toUpperCase()}: ${sel.value}`], ['Generated', new Date().toLocaleString('en-IN')], ['Total tags', raw.rows.length], []];
      const summary = { name: 'Summary', header: pivot.header, rows: [...pivot.rows, [], ...meta.map((m) => m.map((x) => x))] };
      const rawRows = raw.rows.map((r) => r.map((v) => (v !== '' && /^-?\d+(\.\d+)?$/.test(v) && v.length < 15 ? Number(v) : v)));
      FF.xlsx.download(`stock-${U.slug(sel.value)}-${U.stamp()}.xlsx`, [summary, { name: 'StockDataa', header: raw.header, rows: rawRows }]);
      U.toast(`Excel ready · ${U.fmt(raw.rows.length)} tag rows`, 'ok');
    } catch (err) { console.error(err); U.toast(`Export fail: ${err.message}`, 'err'); }
    btn.disabled = false; btn.textContent = label;
  }

  // ---- views -----------------------------------------------------------------------------------
  function selectionView(P, el) {
    const sel = view;
    if (sel.scope === 'agent') {
      const agent = P.agents.find((a) => norm(a.name) === norm(sel.value));
      if (!agent) { el.innerHTML = `<div class="empty-state">"${esc(sel.value)}" ke naam par StockDataa me koi stock nahi hai.</div>`; return null; }
      const pv = agentPivot(P, agent);
      const tlName = FF.config.isExcludedTl(agent.tl) ? 'Direct (no TL)' : agent.tl;
      const perDay = P.elapsed ? agent.iss / P.elapsed : 0;
      const text = [`*${FF.config.brand} – Stock – ${agent.name}*`, `TL: ${tlName} · ID ${agent.id || '—'}`, `Total stock: *${U.fmt(agent.total)}* (VC4 ${U.fmt(agent.vc4)} | Commercial ${U.fmt(agent.comm)})`, ...P.classes.filter((c) => agent.byClass.get(c)).map((c) => `• ${c}: ${U.fmt(agent.byClass.get(c))}`), `MTD issued: ${U.fmt(agent.iss)} (VC4 ${U.fmt(agent.issVc4)})`, `VC4 stock cover: ${agent.cover === null ? '—' : `${U.fmt(agent.cover)} days`}`, `— ${FF.config.contacts.signature || ''}`].join('\n');
      el.innerHTML = `<div class="kpi-grid">
          ${kpi('g9', 'Total stock', '📦', U.fmt(agent.total), `${esc(agent.name)} · TL ${esc(tlName)}`)}
          ${kpi('g1', 'VC4 stock', '🚗', U.fmt(agent.vc4), `${U.fmtPct(U.pctOf(agent.vc4, agent.total), 0)} of stock`)}
          ${kpi('g4', 'Commercial stock', '🚚', U.fmt(agent.comm), P.classes.filter((c) => !isVc4(c) && agent.byClass.get(c)).map((c) => `${c} <b>${U.fmt(agent.byClass.get(c))}</b>`).join(' · ') || '—')}
          ${kpi('g6', `MTD issued${P.cur ? ` · ${U.labelYM(P.cur)}` : ''}`, '🏷️', U.fmt(agent.iss), `VC4 <b>${U.fmt(agent.issVc4)}</b> · Comm <b>${U.fmt(agent.iss - agent.issVc4)}</b> · ${perDay ? `${U.fmt(perDay, 1)}/day` : ''} · cover ${coverBadge(agent.cover)}`)}
        </div>
        <div class="grid g-2">
          ${card('⚖️ VC4 vs Commercial', `${compareBar(agent.vc4, agent.comm, 'VC4 stock', 'Commercial stock')}${compareBar(agent.issVc4, agent.iss - agent.issVc4, 'VC4 issued (MTD)', 'Commercial issued (MTD)', '#10b981', '#f97316')}<div class="dim small" style="margin-top:8px">Stock days = stock ÷ avg daily issuance (MTD)</div>`)}
          ${card('🍩 Class share', C.donut({ items: P.classes.map((c) => ({ label: c, value: agent.byClass.get(c) || 0, color: isVc4(c) ? '#6366f1' : undefined })), subtitle: 'tags' }))}
        </div>
        ${card(`🧮 Pivot · Class × Tag type <span class="dim">(${esc(agent.name)})</span>`, pivotTable(pv), `<button class="btn small primary" id="st-xlsx">⬇ Excel (Summary + StockDataa rows)</button><button class="btn small" data-action="export" data-name="stock-${U.slug(agent.name)}">⬇ CSV</button>`)}
        <div class="share-row"><button class="btn" data-share="wa" data-text="${esc(text)}">📲 WhatsApp</button><button class="btn" data-share="mail" data-subject="Stock report · ${esc(agent.name)}" data-text="${esc(text)}">✉️ Email</button><button class="btn" data-share="copy" data-text="${esc(text)}">📋 Copy summary</button><a class="btn" href="#/performance?q=${encodeURIComponent(agent.name)}">🏆 Performance →</a><a class="btn" href="#/trend?agent=${encodeURIComponent(agent.name)}">📈 Trend →</a></div>`;
      return pv;
    }
    if (sel.scope === 'tl') {
      const tl = P.tls.find((t) => norm(t.name) === norm(sel.value));
      if (!tl) { el.innerHTML = `<div class="empty-state">TL "${esc(sel.value)}" ka koi stock nahi mila.</div>`; return null; }
      const pv = tlPivot(P, tl);
      const top = [...pv.list].sort((a, b) => b.total - a.total).slice(0, 12);
      const text = [`*${FF.config.brand} – Stock – TL ${tl.name}*`, `Agents holding stock: ${pv.list.length}`, `Total stock: *${U.fmt(tl.total)}* (VC4 ${U.fmt(tl.vc4)} | Commercial ${U.fmt(tl.comm)})`, ...P.classes.filter((c) => tl.byClass.get(c)).map((c) => `• ${c}: ${U.fmt(tl.byClass.get(c))}`), `MTD issued: ${U.fmt(tl.iss)} · VC4 cover ${tl.cover === null ? '—' : `${U.fmt(tl.cover)} days`}`, '', '*Top agents by stock*', ...top.slice(0, 5).map((a, i) => `${i + 1}. ${a.name} – ${U.fmt(a.total)} (VC4 ${U.fmt(a.vc4)})`), `— ${FF.config.contacts.signature || ''}`].join('\n');
      el.innerHTML = `<div class="kpi-grid">
          ${kpi('g9', 'Total stock', '📦', U.fmt(tl.total), `TL ${esc(tl.name)} · ${pv.list.length} agents holding stock`)}
          ${kpi('g1', 'VC4 stock', '🚗', U.fmt(tl.vc4), `${U.fmtPct(U.pctOf(tl.vc4, tl.total), 0)} of stock · cover ${coverBadge(tl.cover)}`)}
          ${kpi('g4', 'Commercial stock', '🚚', U.fmt(tl.comm), P.classes.filter((c) => !isVc4(c) && tl.byClass.get(c)).map((c) => `${c} <b>${U.fmt(tl.byClass.get(c))}</b>`).join(' · ') || '—')}
          ${kpi('g6', `MTD issued${P.cur ? ` · ${U.labelYM(P.cur)}` : ''}`, '🏷️', U.fmt(tl.iss), `${P.elapsed ? `${U.fmt(tl.iss / P.elapsed, 1)}/day` : ''} · stock turns ${tl.iss && tl.total ? (tl.iss / tl.total).toFixed(2) : '—'}×`)}
        </div>
        <div class="grid g-2">
          ${card('⚖️ VC4 vs Commercial', `${compareBar(tl.vc4, tl.comm, 'VC4 stock', 'Commercial stock')}<div style="margin-top:14px">${C.bars({ labels: P.classes.filter((c) => tl.byClass.get(c)), height: 170, series: [{ name: 'Stock', values: P.classes.filter((c) => tl.byClass.get(c)).map((c) => tl.byClass.get(c)), color: '#14b8a6' }] })}</div>`)}
          ${card('🧑‍💼 Top agents by stock', C.hbars({ items: top.map((a, i) => ({ label: a.name, sub: `VC4 ${U.fmt(a.vc4)} · Comm ${U.fmt(a.comm)}`, value: a.total, color: C.PALETTE[i % C.PALETTE.length], attr: `data-pick-agent="${esc(a.name)}"` })), valueLabel: 'Stock' }))}
        </div>
        ${card(`🧮 Pivot · Agent × Class <span class="dim">(TL ${esc(tl.name)} · ${pv.list.length} agents)</span>`, pivotTable(pv, { rowAttr: (r, ri) => (ri < pv.rows.length - 1 ? `data-pick-agent="${esc(r[1])}" class="clickable"` : '') }), `<button class="btn small primary" id="st-xlsx">⬇ Excel (Summary + StockDataa rows)</button><button class="btn small" data-action="export" data-name="stock-tl-${U.slug(tl.name)}">⬇ CSV</button>`)}
        <div class="share-row"><button class="btn" data-share="wa" data-text="${esc(text)}">📲 WhatsApp</button><button class="btn" data-share="mail" data-subject="Stock report · TL ${esc(tl.name)}" data-text="${esc(text)}">✉️ Email</button><button class="btn" data-share="copy" data-text="${esc(text)}">📋 Copy summary</button><a class="btn" href="#/performance?view=tls&tl=${encodeURIComponent(tl.name)}">🏆 Performance →</a><a class="btn" href="#/trend?tl=${encodeURIComponent(tl.name)}">📈 Trend →</a></div>`;
      return pv;
    }
    if (sel.scope === 'cls') {
      const cls = sel.value;
      const pv = classPivot(P, cls);
      const totalCls = P.byClass.get(cls) || 0;
      const agentsHolding = P.agents.filter((a) => (a.byClass.get(cls) || 0) > 0).sort((a, b) => (b.byClass.get(cls) || 0) - (a.byClass.get(cls) || 0));
      el.innerHTML = `<div class="kpi-grid">
          ${kpi('g9', `${esc(cls)} stock`, '📦', U.fmt(totalCls), `${U.fmtPct(U.pctOf(totalCls, P.total), 1)} of all stock · ${isVc4(cls) ? 'VC4 (payable)' : 'Commercial'}`)}
          ${kpi('g1', 'TLs holding', '👥', U.fmt(pv.rows.length), 'APS / direct excluded from TL list')}
          ${kpi('g4', 'Agents holding', '🧑‍💼', U.fmt(agentsHolding.length), `Top: ${esc(agentsHolding[0] ? agentsHolding[0].name : '—')}`)}
          ${kpi('g6', 'vs VC4', '⚖️', isVc4(cls) ? '—' : U.fmtPct(U.pctOf(totalCls, P.vc4), 1), isVc4(cls) ? 'This is VC4' : `${esc(cls)} ÷ VC4 stock`)}
        </div>
        ${card(`🧮 Pivot · TL × ${esc(cls)}`, pivotTable(pv, { numFrom: 1, rowAttr: (r) => `data-pick-tl="${esc(r[0])}" class="clickable"` }), `<button class="btn small primary" id="st-xlsx">⬇ Excel (Summary + StockDataa rows)</button><button class="btn small" data-action="export" data-name="stock-${U.slug(cls)}">⬇ CSV</button>`)}
        ${card(`🧑‍💼 Agents holding ${esc(cls)} <span class="dim">(top 100)</span>`, `<div class="table-wrap tall"><table class="tbl"><thead><tr><th>Agent</th><th>TL</th><th class="num">${esc(cls)}</th><th class="num">Total stock</th></tr></thead><tbody>${agentsHolding.slice(0, 100).map((a) => `<tr data-pick-agent="${esc(a.name)}" class="clickable"><td>${esc(a.name)}</td><td>${esc(FF.config.isExcludedTl(a.tl) ? 'Direct' : a.tl)}</td><td class="num"><b>${U.fmt(a.byClass.get(cls))}</b></td><td class="num">${U.fmt(a.total)}</td></tr>`).join('')}</tbody></table></div>`, `<button class="btn small" data-action="export" data-name="agents-${U.slug(cls)}">⬇ CSV</button>`)}`;
      return pv;
    }
    return null;
  }

  function overview(P, el) {
    const tls = P.tls.filter((t) => !t.excluded);
    const direct = P.tls.filter((t) => t.excluded);
    const directTotal = U.sum(direct, (t) => t.total);
    const curVc4 = P.curS ? P.curS.vc4 : 0, curComm = P.curS ? P.curS.comm : 0;
    const perDayVc4 = P.elapsed ? curVc4 / P.elapsed : 0, perDayComm = P.elapsed ? curComm / P.elapsed : 0;
    const topTls = tls.slice(0, FF.config.thresholds.topN || 10).map((t, i) => ({ label: t.name, value: t.total, sub: `VC4 ${U.fmt(t.vc4)} · Comm ${U.fmt(t.comm)} · ${t.agents} agents`, color: C.PALETTE[(i + 3) % C.PALETTE.length], attr: `data-pick-tl="${esc(t.name)}"` }));
    const tlTable = `<div class="table-wrap tall"><table class="tbl sticky-first"><thead><tr><th>TL</th><th class="num">Agents</th>${P.classes.map((c) => `<th class="num">${esc(c)}</th>`).join('')}<th class="num">VC4</th><th class="num">Commercial</th><th class="num">Total</th><th class="num">MTD issued</th><th>VC4 cover</th></tr></thead><tbody>${tls.map((t) => `<tr data-pick-tl="${esc(t.name)}" class="clickable"><td><b>${esc(t.name)}</b></td><td class="num">${t.agents}</td>${P.classes.map((c) => `<td class="num">${t.byClass.get(c) ? U.fmt(t.byClass.get(c)) : '<span class="dim">·</span>'}</td>`).join('')}<td class="num">${U.fmt(t.vc4)}</td><td class="num">${U.fmt(t.comm)}</td><td class="num"><b>${U.fmt(t.total)}</b></td><td class="num">${U.fmt(t.iss)}</td><td>${coverBadge(t.cover)}</td></tr>`).join('')}</tbody><tfoot><tr><td><b>TL total</b></td><td class="num">${U.sum(tls, (t) => t.agents)}</td>${P.classes.map((c) => `<td class="num"><b>${U.fmt(U.sum(tls, (t) => t.byClass.get(c) || 0))}</b></td>`).join('')}<td class="num"><b>${U.fmt(U.sum(tls, (t) => t.vc4))}</b></td><td class="num"><b>${U.fmt(U.sum(tls, (t) => t.comm))}</b></td><td class="num"><b>${U.fmt(U.sum(tls, (t) => t.total))}</b></td><td class="num"><b>${U.fmt(U.sum(tls, (t) => t.iss))}</b></td><td></td></tr>${direct.length ? `<tr class="dim"><td>Direct agents (${esc(direct.map((d) => d.name).join(', '))}) — not a TL</td><td class="num">${U.sum(direct, (t) => t.agents)}</td>${P.classes.map((c) => `<td class="num">${U.fmt(U.sum(direct, (t) => t.byClass.get(c) || 0))}</td>`).join('')}<td class="num">${U.fmt(U.sum(direct, (t) => t.vc4))}</td><td class="num">${U.fmt(U.sum(direct, (t) => t.comm))}</td><td class="num">${U.fmt(directTotal)}</td><td class="num">${U.fmt(U.sum(direct, (t) => t.iss))}</td><td></td></tr>` : ''}</tfoot></table></div>`;
    const agentRow = (a) => `<tr data-pick-agent="${esc(a.name)}" class="clickable"><td class="mono">${esc(a.id)}</td><td><b>${esc(a.name)}</b></td><td>${esc(FF.config.isExcludedTl(a.tl) ? 'Direct' : a.tl)}</td><td class="num">${U.fmt(a.vc4)}</td><td class="num">${U.fmt(a.comm)}</td><td class="num"><b>${U.fmt(a.total)}</b></td><td class="num">${U.fmt(a.iss)}</td><td>${coverBadge(a.cover)}</td></tr>`;
    const filtered = view.cls ? P.agents.filter((a) => (view.cls === 'VC4' ? a.vc4 : view.cls === 'COMM' ? a.comm : a.byClass.get(view.cls) || 0) > 0) : P.agents;
    el.innerHTML = `<div class="kpi-grid">
        ${kpi('g9', 'Total stock in field', '📦', U.fmt(P.total), `${tls.length} TLs · ${U.fmt(P.agents.length)} agents holding stock${directTotal ? ` · direct ${U.fmt(directTotal)}` : ''}`)}
        ${kpi('g1', 'VC4 stock', '🚗', U.fmt(P.vc4), `${U.fmtPct(U.pctOf(P.vc4, P.total), 0)} of stock · ${perDayVc4 ? `${U.fmt(P.vc4 / perDayVc4)} days cover @ ${U.fmt(perDayVc4)} VC4/day` : ''}`)}
        ${kpi('g4', 'Commercial stock', '🚚', U.fmt(P.comm), `${U.fmtPct(U.pctOf(P.comm, P.total), 0)} of stock · ${perDayComm ? `${U.fmt(P.comm / perDayComm)} days cover @ ${U.fmt(perDayComm)} comm/day` : ''}`)}
        ${kpi('g6', P.cur ? `${U.labelYM(P.cur)} issued (MTD)` : 'MTD issued', '🏷️', U.fmt(P.curS ? P.curS.total : 0), `VC4 <b>${U.fmt(curVc4)}</b> · Commercial <b>${U.fmt(curComm)}</b> · ${P.elapsed} days`)}
      </div>
      <div class="grid g-3">
        ${card('⚖️ VC4 vs Commercial', `${compareBar(P.vc4, P.comm, 'VC4 stock', 'Commercial stock')}${compareBar(curVc4, curComm, 'VC4 issued MTD', 'Commercial issued MTD', '#10b981', '#f97316')}<table class="tbl compact" style="margin-top:12px"><thead><tr><th></th><th class="num">VC4</th><th class="num">Commercial</th></tr></thead><tbody><tr><td>Stock</td><td class="num"><b>${U.fmt(P.vc4)}</b></td><td class="num"><b>${U.fmt(P.comm)}</b></td></tr><tr><td>Issued MTD</td><td class="num">${U.fmt(curVc4)}</td><td class="num">${U.fmt(curComm)}</td></tr><tr><td>Per day</td><td class="num">${U.fmt(perDayVc4, 1)}</td><td class="num">${U.fmt(perDayComm, 1)}</td></tr><tr><td>Days cover</td><td>${coverBadge(perDayVc4 ? P.vc4 / perDayVc4 : null)}</td><td>${coverBadge(perDayComm ? P.comm / perDayComm : null)}</td></tr><tr><td>Stock turns / month</td><td class="num">${P.vc4 && curVc4 ? (curVc4 / P.vc4).toFixed(2) : '—'}×</td><td class="num">${P.comm && curComm ? (curComm / P.comm).toFixed(2) : '—'}×</td></tr></tbody></table>`)}
        ${card('📊 Stock by class', C.bars({ labels: P.classes, height: 200, series: [{ name: 'Stock', values: P.classes.map((c) => P.byClass.get(c)), color: '#14b8a6' }], onClickAttr: (i) => `data-pick-cls="${esc(P.classes[i])}"` }) + `<div class="chip-row" style="margin-top:10px">${P.classes.map((c) => `<button class="chip ${isVc4(c) ? 'vc4' : 'comm'}" data-pick-cls="${esc(c)}">${esc(c)} <b>${U.fmtShort(P.byClass.get(c))}</b></button>`).join('')}</div>`)}
        ${card('🏬 Top TLs by stock <span class="dim">(APS excluded)</span>', C.hbars({ items: topTls, valueLabel: 'Stock' }))}
      </div>
      ${card('🧮 TL × Class stock matrix <span class="dim">(click TL → pivot + Excel · VC4 cover = VC4 stock ÷ avg daily issuance MTD)</span>', tlTable, `<button class="btn small" data-action="export" data-name="stock-by-tl">⬇ CSV</button>`)}
      ${card(`🧑‍💼 Agent-wise stock <span class="dim">(${U.fmt(filtered.length)} agents${view.cls ? ` · ${esc(view.cls === 'COMM' ? 'Commercial' : view.cls)} only` : ''})</span>`, `<div class="table-wrap tall"><table class="tbl" id="st-agent-table"><thead><tr><th>Agent ID</th><th>Agent</th><th>TL</th><th class="num">VC4</th><th class="num">Commercial</th><th class="num">Total</th><th class="num">MTD issued</th><th>VC4 cover</th></tr></thead><tbody id="st-agent-body">${filtered.slice(0, 200).map(agentRow).join('')}</tbody></table></div><div class="dim small" id="st-agent-note">${filtered.length > 200 ? 'Top 200 dikh rahe hain — upar search karo.' : `${U.fmt(filtered.length)} agents`}</div>`, `<select id="st-cls"><option value="">All classes</option><option value="VC4" ${view.cls === 'VC4' ? 'selected' : ''}>VC4 only</option><option value="COMM" ${view.cls === 'COMM' ? 'selected' : ''}>Commercial only</option>${P.classes.map((c) => `<option value="${esc(c)}" ${view.cls === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select><button class="btn small" data-action="export" data-name="stock-by-agent">⬇ CSV</button>`)}`;
  }

  // ---- page -----------------------------------------------------------------------------------
  async function render(root, params) {
    if (params.agent) { view.scope = 'agent'; view.value = params.agent; } else if (params.tl) { view.scope = 'tl'; view.value = params.tl; } else if (params.cls) { view.scope = 'cls'; view.value = params.cls; } else { view.scope = ''; view.value = ''; }
    root.innerHTML = `<div class="page-head"><div><h1>📦 Stock / Inventory</h1><p class="sub">StockDataa — agent / TL / class wise stock · VC4 vs Commercial · pivot + Excel export</p></div>
      <div class="head-actions"><button class="btn primary" data-action="refresh">↻ Refresh</button>${FF.auth.can('sheet:StockDataa') ? `<a class="btn" href="#/sheet/${encodeURIComponent(FF.config.stock.sheet)}">Full StockDataa sheet →</a>` : ''}</div></div>
      <div class="card controls finder"><div class="finder-row"><div class="finder-input"><span class="finder-ico">🔎</span><input class="input" id="st-q" placeholder="Agent ya TL ka naam type karo… (dropdown se select karo)" value="${esc(view.scope === 'cls' ? '' : view.value)}"></div>
        <label>Criteria <select id="st-scope"><option value="">Agent + TL</option><option value="agent">Agent only</option><option value="tl">TL only</option></select></label>
        <button class="btn small" id="st-clear" ${view.scope ? '' : 'disabled'}>✕ Clear</button>
        <span class="ctrl-note" id="st-note"></span></div>
        <div class="chip-row" id="st-chips"></div></div>
      <div id="st-body">${U.spinner('StockDataa aggregate ho raha hai…')}</div>`;
    const body = U.$('#st-body', root);
    try { await S.need('stock'); await Promise.allSettled([S.need('stockAgents'), S.need('stockTypes'), S.need('daily'), S.need('agents'), S.need('agentClass')]); } catch (err) { body.innerHTML = U.errorBox(err, 'data-action="refresh"'); return; }
    if (!root.isConnected) return;
    const P = prep();
    const noteEl = U.$('#st-note', root);
    noteEl.textContent = view.scope ? `${view.scope === 'cls' ? 'Class' : view.scope === 'tl' ? 'TL' : 'Agent'}: ${view.value}` : `${U.fmt(P.total)} tags · ${U.fmt(P.agents.length)} agents · ${P.tls.filter((t) => !t.excluded).length} TLs`;
    U.$('#st-chips', root).innerHTML = `<span class="dim small">Quick:</span>${P.tls.filter((t) => !t.excluded).slice(0, 8).map((t) => `<button class="chip ${view.scope === 'tl' && norm(view.value) === norm(t.name) ? 'on' : ''}" data-pick-tl="${esc(t.name)}">👥 ${esc(t.name)}</button>`).join('')}<button class="chip vc4 ${view.scope === 'cls' && view.value === 'VC4' ? 'on' : ''}" data-pick-cls="VC4">VC4</button>${P.classes.filter((c) => !isVc4(c)).map((c) => `<button class="chip comm ${view.scope === 'cls' && view.value === c ? 'on' : ''}" data-pick-cls="${esc(c)}">${esc(c)}</button>`).join('')}`;

    let pivot = null;
    if (view.scope) pivot = selectionView(P, body); else overview(P, body);
    C.mount(body);

    // search
    const input = U.$('#st-q', root), scopeSel = U.$('#st-scope', root);
    const items = () => {
      const s = scopeSel.value;
      const list = [];
      if (s !== 'agent') P.tls.filter((t) => !t.excluded).forEach((t) => list.push({ kind: 'tl', kindLabel: 'TL', label: t.name, sub: `${U.fmt(t.total)} tags · ${t.agents} agents`, value: t.name }));
      if (s !== 'tl') P.agents.forEach((a) => list.push({ kind: 'agent', kindLabel: 'Agent', label: a.name, sub: `${FF.config.isExcludedTl(a.tl) ? 'Direct' : a.tl} · ${U.fmt(a.total)} tags`, keywords: a.id, value: a.name }));
      if (!s) P.classes.forEach((c) => list.push({ kind: 'cls', kindLabel: 'Class', label: c, sub: `${U.fmt(P.byClass.get(c))} tags`, value: c }));
      return list;
    };
    const go = (scope, value) => {
      if (FF.notifications && FF.notifications.logClick) {
        FF.notifications.logClick(`Stock ${scope.toUpperCase()}`, value);
      }
      FF.app.navigate('stock', scope === 'agent' ? { agent: value } : scope === 'tl' ? { tl: value } : { cls: value });
    };
    const logStockSearch = U.debounce((q) => {
      if (q && FF.notifications && FF.notifications.logSearch) {
        FF.notifications.logSearch('Stock / Inventory', q);
      }
    }, 600);
    input.addEventListener('input', () => {
      const q = input.value.trim();
      if (q) logStockSearch(q);
    });
    U.suggest(input, { items, onPick: (it) => { if (it.value && FF.notifications && FF.notifications.logSearch) FF.notifications.logSearch('Stock / Inventory', it.value); go(it.kind, it.value); }, onEnter: (q) => { if (q && FF.notifications && FF.notifications.logSearch) FF.notifications.logSearch('Stock / Inventory', q); const all = items(); const hit = all.find((i) => norm(i.label) === norm(q)) || all.find((i) => norm(i.label).includes(norm(q))); if (hit) go(hit.kind, hit.value); else U.toast('Koi agent / TL match nahi hua', 'err'); } });
    U.$('#st-clear', root).addEventListener('click', () => FF.app.navigate('stock', {}));
    root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-pick-agent]'); if (a) { go('agent', a.dataset.pickAgent); return; }
      const t = e.target.closest('[data-pick-tl]'); if (t) { go('tl', t.dataset.pickTl); return; }
      const c = e.target.closest('[data-pick-cls]'); if (c) { go('cls', c.dataset.pickCls); return; }
      const x = e.target.closest('#st-xlsx'); if (x && pivot) exportExcel(P, view, pivot, x);
    });
    root.addEventListener('change', (e) => {
      if (e.target.id === 'st-cls') {
        view.cls = e.target.value;
        if (FF.notifications && FF.notifications.logClick) {
          FF.notifications.logClick('Stock Class Filter', view.cls || 'All classes');
        }
        overview(P, body);
        C.mount(body);
      }
    });
  }

  FF.pages.stock = { title: 'Stock', render };
})(window.FF);
