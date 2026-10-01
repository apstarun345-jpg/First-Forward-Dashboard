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
  const view = { scope: '', value: '', cls: '', q: '', direct: false };

  function coverBadge(days) {
    const t = FF.config.thresholds;
    if (days === null || !Number.isFinite(days)) return '<span class="badge gray">no issuance</span>';
    if (days < t.coverRed) return `<span class="badge red">🔴 ${U.fmt(days)} days</span>`;
    if (days < t.coverOrange) return `<span class="badge orange">🟠 ${U.fmt(days)} days</span>`;
    if (days < t.coverAmber) return `<span class="badge amber">🟡 ${U.fmt(days)} days</span>`;
    return `<span class="badge green">🟢 ${U.fmt(days)} days</span>`;
  }
  // 🚗 4-way class helpers — VC4 | VC20 | VC5+ · All Comm = VC20 + VC5+ (NVC4)
  const binsFromByClass = (byClass) => { const b = { VC4: 0, VC20: 0, 'VC5+': 0 }; if (byClass) for (const [c, n] of byClass) { const g = FF.model.classGroup(c); b[g] = (b[g] || 0) + n; } return b; };
  const classDefine = '<div class="dim small" style="margin-top:8px">🚗 <b>VC4</b> = 4-wheeler (payable) · 🛻 <b>VC20</b> / <b>VC5+</b> = bade commercial vehicles · <b>All Comm = VC20 + VC5+ (NVC4)</b></div>';
  function classTable(stBins, isBins, elapsed) {
    const st = [stBins.VC4, stBins.VC20, stBins['VC5+'], (stBins.VC20 || 0) + (stBins['VC5+'] || 0)];
    const is = [isBins.VC4 || 0, isBins.VC20 || 0, isBins['VC5+'] || 0, (isBins.VC20 || 0) + (isBins['VC5+'] || 0)];
    const heads = ['VC4', 'VC20', 'VC5+', 'All Comm'];
    const per = is.map((v) => (elapsed ? v / elapsed : 0));
    const cell = (i) => per[i] ? coverBadge(st[i] / per[i]) : '<span class="dim">—</span>';
    return `<table class="tbl compact" style="margin-top:12px"><thead><tr><th></th>${heads.map((h) => `<th class="num" ${h === 'All Comm' ? 'title="VC20 + VC5+"' : ''}>${h}</th>`).join('')}</tr></thead>
      <tbody>
        <tr><td>Stock</td>${st.map((v) => `<td class="num"><b>${U.fmt(v)}</b></td>`).join('')}</tr>
        <tr><td>Issued MTD</td>${is.map((v) => `<td class="num">${U.fmt(v)}</td>`).join('')}</tr>
        <tr><td>Per day</td>${per.map((v) => `<td class="num">${U.fmt(v, 1)}</td>`).join('')}</tr>
        <tr><td>Days cover</td>${heads.map((_, i) => `<td>${cell(i)}</td>`).join('')}</tr>
      </tbody></table>`;
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
    // v3.31: FF Stock page = FF ka issuance (StockDataa FF stock hai). Pehle `daily` me GV live rows bhi thi →
    // 1 tareekh ko "Oct MTD 34" (GV ke aaj ke tags) aur cover 1 din par. Ab FF rows + FF data basis
    // (kal tak · 1 tareekh = pichhle month ke poore din), user ki sheet jaisa.
    const isFfRow = (r) => r && r.channel !== 'GV Partner' && (!FF.filters || typeof FF.filters.ffVisible !== 'function' || FF.filters.ffVisible(r));
    const daily = (S.get('daily') || []).filter(isFfRow);
    const issued = (S.get('agents') || []).filter((a) => a.channel !== 'GV Partner');
    const fb = U.channelBasis ? U.channelBasis('ff') : null;
    const latest = M.latestDate(daily) || (fb ? fb.date : null);
    const cur = fb ? fb.ym : (latest ? U.ymKey(latest) : null);
    const elapsed = fb ? fb.days : (latest ? latest.getDate() : 0);
    const classes = U.uniq(stock.map((r) => r.cls)).sort((a, b) => clsNum(a) - clsNum(b));
    const tlIssued = new Map(), agIssued = new Map(), agIssuedVc4 = new Map();
    const agentClass = (S.get('agentClass') || []).filter((a) => a.channel !== 'GV Partner');
    for (const a of issued) { if (a.ym !== cur) continue; tlIssued.set(norm(a.tlName), (tlIssued.get(norm(a.tlName)) || 0) + a.n); agIssued.set(norm(a.name), (agIssued.get(norm(a.name)) || 0) + a.n); }
    for (const a of agentClass) { if (a.ym !== cur || a.group !== 'VC4') continue; agIssuedVc4.set(norm(a.name), (agIssuedVc4.get(norm(a.name)) || 0) + a.n); }
    // 🚗 MTD issued ka 4-way bins (VC4 / VC20 / VC5+) — agent + TL dono ke liye
    const agBins = new Map(), tlBins = new Map();
    const emptyBins = () => ({ VC4: 0, VC20: 0, 'VC5+': 0 });
    for (const a of agentClass) {
      if (a.ym !== cur) continue;
      const g = a.group === 'VC4' || a.group === 'VC20' ? a.group : 'VC5+';
      const kb = norm(a.name); const ab = agBins.get(kb) || emptyBins(); ab[g] += a.n; agBins.set(kb, ab);
      const kt = norm(a.tlName); const tb = tlBins.get(kt) || emptyBins(); tb[g] += a.n; tlBins.set(kt, tb);
    }
    // agent map
    const agMap = new Map();
    for (const a of stockAgents) {
      const k = norm(a.agentName);
      if (!agMap.has(k)) agMap.set(k, { id: a.agentId, name: a.agentName, tl: a.tlName, total: 0, vc4: 0, comm: 0, byClass: new Map() });
      const o = agMap.get(k); o.total += a.n; if (a.group === 'VC4') o.vc4 += a.n; else o.comm += a.n; o.byClass.set(a.cls, (o.byClass.get(a.cls) || 0) + a.n);
      if (!o.id && a.agentId) o.id = a.agentId;
    }
    const agents = [...agMap.values()].map((a) => { a.iss = agIssued.get(norm(a.name)) || 0; a.issVc4 = agIssuedVc4.get(norm(a.name)) || 0; a.issBins = agBins.get(norm(a.name)) || { VC4: 0, VC20: 0, 'VC5+': 0 }; const perDay = elapsed ? a.iss / elapsed : 0; a.cover = perDay ? a.vc4 / perDay : null; return a; }).sort((a, b) => b.total - a.total);
    // TL map (APS etc. excluded from TL views, but counted in totals)
    const tlMap = new Map();
    for (const r of stock) {
      const k = r.tlName;
      if (!tlMap.has(k)) tlMap.set(k, { name: k, total: 0, vc4: 0, comm: 0, byClass: new Map(), excluded: FF.config.isExcludedTl(k) });
      const o = tlMap.get(k); o.total += r.n; if (r.group === 'VC4') o.vc4 += r.n; else o.comm += r.n; o.byClass.set(r.cls, (o.byClass.get(r.cls) || 0) + r.n);
    }
    const tls = [...tlMap.values()].map((t) => { t.iss = tlIssued.get(norm(t.name)) || 0; t.issBins = tlBins.get(norm(t.name)) || { VC4: 0, VC20: 0, 'VC5+': 0 }; const perDay = elapsed ? t.iss / elapsed : 0; t.cover = perDay ? t.vc4 / perDay : null; t.agents = agents.filter((a) => norm(a.tl) === norm(t.name)).length; return t; }).sort((a, b) => b.total - a.total);
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
      // filterRows = header + pivot rows only → Excel/WPS ka header filter meta rows (Report/Scope/…) ko include nahi karega.
      const summary = { name: 'Summary', header: pivot.header, rows: [...pivot.rows, [], ...meta.map((m) => m.map((x) => x))], filterRows: pivot.rows.length + 1 };
      // Date-like columns (ALLOCATED AT / DATE / TIME…) → real Excel dates; baaki numeric-looking text → numbers.
      const dateCol = raw.header.map((h) => /(allocated|date|time|\bat\b)/i.test(String(h)));
      const rawRows = raw.rows.map((r) => r.map((v, ci) => {
        if (v === '' || v === null || v === undefined) return v;
        if (dateCol[ci]) { const d = U.parseDateTime(v); if (d) return d; }
        return /^-?\d+(\.\d+)?$/.test(v) && v.length < 15 ? Number(v) : v;
      }));
      FF.xlsx.download(`stock-${U.slug(sel.value)}-${U.stamp()}.xlsx`, [summary, { name: 'StockDataa', header: raw.header, rows: rawRows }]);
      U.toast(`Excel ready · ${U.fmt(raw.rows.length)} tag rows`, 'ok');
    } catch (err) { console.error(err); U.toast(`Export fail: ${err.message}`, 'err'); }
    btn.disabled = false; btn.textContent = label;
  }

  // ---- print / PDF report ------------------------------------------------------------------------
  function printStockReport(P, sel, pivot) {
    if (!FF.auth.can('export')) { U.toast('Download permission nahi hai', 'err'); return; }
    const esc = U.esc;
    const scopeLabel = sel.scope === 'agent' ? `Agent: ${sel.value}` : sel.scope === 'tl' ? `TL: ${sel.value}` : `Class: ${sel.value}`;
    const src = sel.scope === 'agent' ? P.agents.find((a) => norm(a.name) === norm(sel.value))
      : sel.scope === 'tl' ? P.tls.find((t) => norm(t.name) === norm(sel.value)) : null;
    const kpiBox = (label, value, sub) => `<div class="kpi"><small>${esc(label)}</small><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    let kpis = '';
    if (src) {
      const tlLabel = sel.scope === 'agent' ? `TL ${FF.config.isExcludedTl(src.tl) ? FF.config.directLabel({ tlName: src.tl, channel: 'First Forward' }, 'ff') : src.tl}` : `${(pivot.list || []).length} agents holding stock`;
      kpis = `<div class="kpis">${kpiBox('Total stock', U.fmt(src.total), tlLabel)}${kpiBox('VC4 stock', U.fmt(src.vc4), `${U.fmtPct(U.pctOf(src.vc4, src.total), 0)} of stock`)}${kpiBox('Commercial stock', U.fmt(src.comm))}${kpiBox('MTD issued', U.fmt(src.iss), P.cur ? U.labelYM(P.cur) : '')}${kpiBox('VC4 cover', src.cover === null ? '—' : `${U.fmt(src.cover)} days`, 'stock ÷ avg daily issuance')}</div>`;
    } else if (sel.scope === 'cls') {
      const totalCls = P.byClass.get(sel.value) || 0;
      kpis = `<div class="kpis">${kpiBox(`${sel.value} stock`, U.fmt(totalCls), `${U.fmtPct(U.pctOf(totalCls, P.total), 1)} of all stock`)}${kpiBox('Total stock (all classes)', U.fmt(P.total))}${kpiBox('VC4 stock', U.fmt(P.vc4))}</div>`;
    }
    const table = `<table><thead><tr>${pivot.header.map((hd) => `<th>${esc(hd)}</th>`).join('')}</tr></thead><tbody>${pivot.rows.map((r, ri) => `<tr${ri === pivot.rows.length - 1 && r.includes('Total') ? ' style="font-weight:700"' : ''}>${r.map((c) => `<td class="${typeof c === 'number' ? 'num' : ''}">${typeof c === 'number' ? U.fmt(c, 1) : esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    U.printReport({ title: `${FF.config.brand} — Stock Report`, subtitle: `${scopeLabel} · pivot + summary`, html: `${kpis}<h2>🧮 Pivot</h2>${table}<p class="sub">Full StockDataa rows ke liye dashboard se Excel (Summary + StockDataa rows) download karo.</p>` });
    if (FF.notifications && FF.notifications.logClick) FF.notifications.logClick('Stock Print/PDF', scopeLabel);
  }

  // ---- views -----------------------------------------------------------------------------------
  function selectionView(P, el) {
    const sel = view;
    if (sel.scope === 'agent') {
      const agent = P.agents.find((a) => norm(a.name) === norm(sel.value));
      if (!agent) { el.innerHTML = `<div class="empty-state">"${esc(sel.value)}" ke naam par StockDataa me koi stock nahi hai.</div>`; return null; }
      const pv = agentPivot(P, agent);
      const tlName = FF.config.isExcludedTl(agent.tl) ? FF.config.directLabel({ tlName: agent.tl, channel: 'First Forward' }, 'ff') : agent.tl;
      const perDay = P.elapsed ? agent.iss / P.elapsed : 0;
      const text = [`*${FF.config.brand} – Stock – ${agent.name}*`, `TL: ${tlName} · ID ${agent.id || '—'}`, `Total stock: *${U.fmt(agent.total)}* (VC4 ${U.fmt(agent.vc4)} | Commercial ${U.fmt(agent.comm)})`, ...P.classes.filter((c) => agent.byClass.get(c)).map((c) => `• ${c}: ${U.fmt(agent.byClass.get(c))}`), `MTD issued: ${U.fmt(agent.iss)} (VC4 ${U.fmt(agent.issVc4)})`, `VC4 stock cover: ${agent.cover === null ? '—' : `${U.fmt(agent.cover)} days`}`, `— ${FF.config.contacts.signature || ''}`].join('\n');
      el.innerHTML = `<div class="kpi-grid">
          ${kpi('g9', 'Total stock', '📦', U.fmt(agent.total), `${esc(agent.name)} · TL ${esc(tlName)}`)}
          ${kpi('g1', 'VC4 stock', '🚗', U.fmt(agent.vc4), `${U.fmtPct(U.pctOf(agent.vc4, agent.total), 0)} of stock`)}
          ${kpi('g4', 'Commercial stock', '🚚', U.fmt(agent.comm), P.classes.filter((c) => !isVc4(c) && agent.byClass.get(c)).map((c) => `${c} <b>${U.fmt(agent.byClass.get(c))}</b>`).join(' · ') || '—')}
          ${kpi('g6', `MTD issued${P.cur ? ` · ${U.labelYM(P.cur)}` : ''}`, '🏷️', U.fmt(agent.iss), `VC4 <b>${U.fmt(agent.issBins.VC4)}</b> · VC20 <b>${U.fmt(agent.issBins.VC20)}</b> · VC5+ <b>${U.fmt(agent.issBins['VC5+'])}</b> · ${perDay ? `${U.fmt(perDay, 1)}/day` : ''} · cover ${coverBadge(agent.cover)}`)}
        </div>
        <div class="grid g-2">
          ${card('⚖️ Class split <span class="dim">· stock vs MTD issued</span>', `${classTable(binsFromByClass(agent.byClass), agent.issBins, P.elapsed)}${classDefine}<div class="dim small" style="margin-top:6px">Stock days = stock ÷ avg daily issuance (MTD)</div>`)}
          ${card('🍩 Class share', C.donut({ items: P.classes.map((c) => ({ label: c, value: agent.byClass.get(c) || 0, color: isVc4(c) ? '#6366f1' : undefined })), subtitle: 'tags' }))}
        </div>
        ${card(`🧮 Pivot · Class × Tag type <span class="dim">(${esc(agent.name)})</span>`, pivotTable(pv), `<button class="btn small primary" id="st-xlsx">⬇ Excel (Summary + StockDataa rows)</button><button class="btn small" data-action="export" data-name="stock-${U.slug(agent.name)}">⬇ CSV</button>`)}
        <div class="share-row"><button class="btn" data-share="wa" data-text="${esc(text)}">📲 WhatsApp</button><button class="btn" data-share="mail" data-subject="Stock report · ${esc(agent.name)}" data-text="${esc(text)}">✉️ Email</button><button class="btn" data-share="copy" data-text="${esc(text)}">📋 Copy summary</button><button class="btn" data-print>🖨 PDF / Print</button><a class="btn" href="#/performance?q=${encodeURIComponent(agent.name)}">🏆 Performance →</a><a class="btn" href="#/trend?agent=${encodeURIComponent(agent.name)}">📈 Trend →</a></div>`;
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
          ${card('⚖️ Class split <span class="dim">· stock vs MTD issued</span>', `${classTable(binsFromByClass(tl.byClass), tl.issBins, P.elapsed)}${classDefine}<div style="margin-top:14px">${C.bars({ labels: P.classes.filter((c) => tl.byClass.get(c)), height: 170, series: [{ name: 'Stock', values: P.classes.filter((c) => tl.byClass.get(c)).map((c) => tl.byClass.get(c)), color: '#14b8a6' }] })}</div>`)}
          ${card('🧑‍💼 Top agents by stock', C.hbars({ items: top.map((a, i) => ({ label: a.name, sub: `VC4 ${U.fmt(a.vc4)} · Comm ${U.fmt(a.comm)}`, value: a.total, color: C.PALETTE[i % C.PALETTE.length], attr: `data-pick-agent="${esc(a.name)}"` })), valueLabel: 'Stock' }))}
        </div>
        ${card(`🧮 Pivot · Agent × Class <span class="dim">(TL ${esc(tl.name)} · ${pv.list.length} agents)</span>`, pivotTable(pv, { rowAttr: (r, ri) => (ri < pv.rows.length - 1 ? `data-pick-agent="${esc(r[1])}" class="clickable"` : '') }), `<button class="btn small primary" id="st-xlsx">⬇ Excel (Summary + StockDataa rows)</button><button class="btn small" data-action="export" data-name="stock-tl-${U.slug(tl.name)}">⬇ CSV</button>`)}
        <div class="share-row"><button class="btn" data-share="wa" data-text="${esc(text)}">📲 WhatsApp</button><button class="btn" data-share="mail" data-subject="Stock report · TL ${esc(tl.name)}" data-text="${esc(text)}">✉️ Email</button><button class="btn" data-share="copy" data-text="${esc(text)}">📋 Copy summary</button><button class="btn" data-print>🖨 PDF / Print</button><a class="btn" href="#/performance?view=tls&tl=${encodeURIComponent(tl.name)}">🏆 Performance →</a><a class="btn" href="#/trend?tl=${encodeURIComponent(tl.name)}">📈 Trend →</a></div>`;
      return pv;
    }
    if (sel.scope === 'cls') {
      const cls = sel.value;
      const pv = classPivot(P, cls);
      const totalCls = P.byClass.get(cls) || 0;
      const agentsHolding = P.agents.filter((a) => (a.byClass.get(cls) || 0) > 0).sort((a, b) => (b.byClass.get(cls) || 0) - (a.byClass.get(cls) || 0));
      el.innerHTML = `<div class="kpi-grid">
          ${kpi('g9', `${esc(cls)} stock`, '📦', U.fmt(totalCls), `${U.fmtPct(U.pctOf(totalCls, P.total), 1)} of all stock · ${isVc4(cls) ? 'VC4 (payable)' : 'Commercial'}`)}
          ${kpi('g1', 'TLs holding', '👥', U.fmt(pv.rows.length), 'Direct agents (TL Name APS) TL list se alag')}
          ${kpi('g4', 'Agents holding', '🧑‍💼', U.fmt(agentsHolding.length), `Top: ${esc(agentsHolding[0] ? agentsHolding[0].name : '—')}`)}
          ${kpi('g6', 'vs VC4', '⚖️', isVc4(cls) ? '—' : U.fmtPct(U.pctOf(totalCls, P.vc4), 1), isVc4(cls) ? 'This is VC4' : `${esc(cls)} ÷ VC4 stock`)}
        </div>
        ${card(`🧮 Pivot · TL × ${esc(cls)}`, pivotTable(pv, { numFrom: 1, rowAttr: (r) => `data-pick-tl="${esc(r[0])}" class="clickable"` }), `<button class="btn small primary" id="st-xlsx">⬇ Excel (Summary + StockDataa rows)</button><button class="btn small" data-action="export" data-name="stock-${U.slug(cls)}">⬇ CSV</button><button class="btn small" data-print>🖨 PDF / Print</button>`)}
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
    const agentRow = (a) => `<tr data-pick-agent="${esc(a.name)}" class="clickable"><td class="mono">${esc(a.id)}</td><td><b>${esc(a.name)}</b></td><td>${esc(FF.config.isExcludedTl(a.tl) ? FF.config.directLabel({ tlName: a.tl, channel: 'First Forward' }, 'ff') : a.tl)}</td><td class="num">${U.fmt(a.vc4)}</td><td class="num">${U.fmt(a.comm)}</td><td class="num"><b>${U.fmt(a.total)}</b></td><td class="num">${U.fmt(a.iss)}</td><td>${coverBadge(a.cover)}</td><td class="age-cell" data-age-chip="${esc(a.id || a.name)}" data-age-kind="agent" title="Purana stock — 3 mahine / 6 mahine se purane tags (VC4+VC20 + VC5+) · row kholo poora aging table + CSV ke liye">🧓 …</td></tr>`;
    // 🚫 Direct agents (TL Name APS / excluded) — TL-wise table se alag, demand par filterable.
    const directAgents = P.agents.filter((a) => FF.config.isExcludedTl(a.tl));
    const filtered = view.direct ? directAgents : view.cls ? P.agents.filter((a) => (view.cls === 'VC4' ? a.vc4 : view.cls === 'COMM' ? a.comm : a.byClass.get(view.cls) || 0) > 0) : P.agents;
    el.innerHTML = `<div class="kpi-grid">
        ${kpi('g9', 'Total stock in field', '📦', U.fmt(P.total), `${tls.length} TLs · ${U.fmt(P.agents.length)} agents holding stock · 🚫 ${U.fmt(directAgents.length)} direct (${U.fmt(directTotal)} tags)`)}
        ${kpi('g1', 'VC4 stock', '🚗', U.fmt(P.vc4), `${U.fmtPct(U.pctOf(P.vc4, P.total), 0)} of stock · ${perDayVc4 ? `${U.fmt(P.vc4 / perDayVc4)} days cover @ ${U.fmt(perDayVc4)} VC4/day` : ''}`)}
        ${kpi('g4', 'Commercial stock', '🚚', U.fmt(P.comm), `${U.fmtPct(U.pctOf(P.comm, P.total), 0)} of stock · ${perDayComm ? `${U.fmt(P.comm / perDayComm)} days cover @ ${U.fmt(perDayComm)} comm/day` : ''}`)}
        ${kpi('g6', P.cur ? `${U.labelYM(P.cur)} issued (MTD)` : 'MTD issued', '🏷️', U.fmt(P.curS ? P.curS.total : 0), `VC4 <b>${U.fmt(curVc4)}</b> · VC20 <b>${U.fmt(P.curS ? P.curS.vc20 : 0)}</b> · VC5+ <b>${U.fmt(P.curS ? P.curS.vc5p : 0)}</b> · ${P.elapsed} days`)}
      </div>
      <div class="grid g-3">
        ${card('⚖️ Class split · stock vs issued <span class="dim">· VC4 / VC20 / VC5+ / All Comm</span>', `${compareBar(P.vc4, P.comm, 'VC4 stock', 'Commercial stock')}${classTable(binsFromByClass(P.byClass), { VC4: curVc4, VC20: P.curS ? P.curS.vc20 : 0, 'VC5+': P.curS ? P.curS.vc5p : 0 }, P.elapsed)}${classDefine}`)}
        ${card('📊 Stock by class', C.bars({ labels: P.classes, height: 200, series: [{ name: 'Stock', values: P.classes.map((c) => P.byClass.get(c)), color: '#14b8a6' }], onClickAttr: (i) => `data-pick-cls="${esc(P.classes[i])}"` }) + `<div class="chip-row" style="margin-top:10px">${P.classes.map((c) => `<button class="chip ${isVc4(c) ? 'vc4' : 'comm'}" data-pick-cls="${esc(c)}">${esc(c)} <b>${U.fmtShort(P.byClass.get(c))}</b></button>`).join('')}</div>`)}
        ${card('🏬 Top TLs by stock <span class="dim">(APS excluded)</span>', C.hbars({ items: topTls, valueLabel: 'Stock' }))}
      </div>
      ${!FF.config.feat || FF.config.feat('stockTrend') !== false ? `<div id="st-trend-card">${card('📉 Stock trend <span class="dim">(server snapshots · last 30 din)</span>', `<div id="st-trend"><div class="dim small">History load ho rahi hai…</div></div>`, `<span class="dim small" id="st-trend-cover"></span>`)}</div>` : ''}
      ${!FF.config.feat || FF.config.feat('recon') !== false ? `<div id="st-recon-card">${card('🧾 FF stock balance <span class="dim">(is mahine · implied movement)</span>', `<div id="st-recon"><div class="dim small">Reconciliation load ho raha hai…</div></div>`, '<a class="btn small" href="#/forecast?view=balance">Full stock balance →</a>')}</div>` : ''}
      ${!FF.config.feat || FF.config.feat('agedStock') !== false ? `<div id="st-aged-card">${card('🧓 Stock ageing · kitna stock kitna purana <span class="dim">(StockDataa <b>Agent Allocated At</b> se · 1 / 3 / 5 / 6+ mahine · 🚗 VC4+VC20 alag, 🚚 VC5+ alag · month ke saath ⬇ CSV)</span>', `<div id="st-aged"><div class="dim small">Stock ageing load ho rahi hai…</div></div>`, `<span class="dim small" id="st-aged-note"></span>`)}</div>` : ''}
      ${!FF.config.feat || FF.config.feat('tlCover') !== false ? card(`📈 TL-wise cover <span class="dim">(sabse kam cover upar · VC4 stock ÷ avg daily issuance MTD)</span>`, `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>TL</th><th class="num">VC4 stock</th><th class="num">MTD issued</th><th class="num">Avg / din</th><th>Cover</th></tr></thead><tbody>${(() => {
        const sorted = [...tls].sort((a, b) => (a.cover === null ? 1 : b.cover === null ? -1 : a.cover - b.cover)).slice(0, 14);
        return sorted.map((t) => `<tr data-pick-tl="${esc(t.name)}" class="clickable"><td><b>${esc(t.name)}</b></td><td class="num">${U.fmt(t.vc4)}</td><td class="num">${U.fmt(t.iss)}</td><td class="num">${P.elapsed ? U.fmt(t.iss / P.elapsed, 1) : '—'}</td><td>${coverBadge(t.cover)}</td></tr>`).join('');
      })()}</tbody></table></div>`) : ''}
      ${card('🧮 TL × Class stock matrix <span class="dim">(click TL → pivot + Excel · VC4 cover = VC4 stock ÷ avg daily issuance MTD)</span>', tlTable, `<button class="btn small" data-action="export" data-name="stock-by-tl">⬇ CSV</button>`)}
      ${card(`🧑‍💼 Agent-wise stock <span class="dim">(${U.fmt(filtered.length)} agents${view.cls ? ` · ${esc(view.cls === 'COMM' ? 'Commercial' : view.cls)} only` : ''})</span>`, `<div class="table-wrap tall"><table class="tbl" id="st-agent-table"><thead><tr><th>Agent ID</th><th>Agent</th><th>TL</th><th class="num">VC4</th><th class="num">Commercial</th><th class="num">Total</th><th class="num">MTD issued</th><th>VC4 cover</th><th title="Purana stock (Agent Allocated At se) — ≥3 mahine / ≥6 mahine, VC4+VC20 aur VC5+">🧓 Purana stock</th></tr></thead><tbody id="st-agent-body">${filtered.slice(0, 200).map(agentRow).join('')}</tbody></table></div><div class="dim small" id="st-agent-note">${view.direct ? '🚫 Direct agents (FF rule: TL Name APS) — inko stock dispatch nahi hota · ' : ''}${filtered.length > 200 ? 'Top 200 dikh rahe hain — upar search karo.' : `${U.fmt(filtered.length)} agents`}</div>`, `<select id="st-cls"><option value="">All classes</option><option value="VC4" ${view.cls === 'VC4' ? 'selected' : ''}>VC4 only</option><option value="COMM" ${view.cls === 'COMM' ? 'selected' : ''}>Commercial only</option>${P.classes.map((c) => `<option value="${esc(c)}" ${view.cls === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select><button class="btn small" data-action="export" data-name="stock-by-agent">⬇ CSV</button>`)}`;
  }

  // ---- 📉 stock trend + 🧾 in-vs-issued (server ke snapshots, ek hi fetch) ------------------------
  function loadStockExtras(body) {
    const box = U.$('#st-trend', body);
    const reconBox = U.$('#st-recon', body);
    const agedBox = U.$('#st-aged', body);
    if ((!box && !reconBox && !agedBox) || !FF.auth || !FF.auth.api) return;
    // 🧓 Aged stock (features.agedStock) — stock row ki allocation date se buckets (alag query, fail-safe)
    // 🧓 v3.28 — primary: Agent Allocated At se mahine-wise ageing (VC4+VC20 / VC5+ groups + CSV)
    if (agedBox && FF.stockAge) {
      agedBox.innerHTML = FF.stockAge.hostHtml({ kind: 'all', key: 'all', ch: 'ff' }, { title: 'Poora network' }) + '<div id="st-aged-bc" class="dim small"></div>';
      FF.stockAge.decorate(agedBox);
      FF.stockAge.ready().then((idx) => {
        const note = U.$('#st-aged-note', body);
        const ff = idx && idx.data && idx.data.ff;
        if (!note || !ff) return;
        note.textContent = `total ${U.fmt(ff.total)} tags${ff.unknown ? ` · ${U.fmt(ff.unknown)} rows me date nahi` : ''}`;
      });
    }
    const bcBox = U.$('#st-aged-bc', body);
    if (bcBox && FF.model && FF.model.loadStockAging) {
      const agedNote = U.$('#st-aged-note', body);
      FF.model.loadStockAging().then((res) => {
        if (!bcBox.isConnected) return;
        if (res.error) { bcBox.innerHTML = `<div class="dim small">⚠️ BC-allocated buckets: ${esc(res.error)}</div>`; return; }
        if (!res.total) { bcBox.innerHTML = '<div class="dim small">Stock rows nahi mile.</div>'; return; }
        const items = [
          ['🌱 0-15 din', res.buckets['0-15'], '#10b981'],
          ['🟡 16-30 din', res.buckets['16-30'], '#f59e0b'],
          ['🟠 31-60 din', res.buckets['31-60'], '#f97316'],
          ['🔴 60+ din', res.buckets['60+'], '#ef4444'],
          ['❔ Unknown date', res.unknown, '#94a3b8']
        ];
        const max = Math.max(1, ...items.map((i) => i[1]));
        bcBox.innerHTML = `<p class="dim small" style="margin-top:10px">BC-allocation (warehouse) buckets: ${items.map(([label, n]) => `${label} <b>${U.fmt(n)}</b>`).join(' · ')}</p>`;
        if (agedNote) agedNote.textContent = `${res.oldest ? `sabse purana: ${res.oldest} din · ` : ''}total ${U.fmt(res.total)} tags`;
      }).catch((err) => { if (bcBox.isConnected) bcBox.innerHTML = `<p class="dim small">⚠️ BC buckets load nahi hui — ${esc(err.message || 'error')}</p>`; });
    }
    FF.auth.api('/api/stock-history').then((out) => {
      // 📉 Trend chart (features.stockTrend)
      if (box && box.isConnected) {
        const pts = ((out && out.points) || []).slice(-30);
        const coverEl = U.$('#st-trend-cover', body);
        if (coverEl && out && out.cover && out.cover.cover) {
          const b = out.cover.band;
          coverEl.innerHTML = `Abhi cover ≈ <b>${U.fmt(out.cover.cover)}</b> din ${b === 'red' ? '🔴' : b === 'orange' ? '🟠' : b === 'amber' ? '🟡' : b === 'green' ? '🟢' : ''}`;
        }
        if (pts.length < 2) {
          box.innerHTML = `<div class="dim small">Stock history abhi store ho rahi hai — server jab bhi snapshot lega (30 min me ek baar), yahan last-30-din ka chart dikhega.</div>`;
        } else {
          const labels = pts.map((p) => `${p.date.slice(8)}/${p.date.slice(5, 7)}`);
          box.innerHTML = C.lines({
            labels,
            tipLabels: pts.map((p) => p.date),
            height: 210,
            series: [
              { name: 'Total stock', values: pts.map((p) => p.total), color: '#6366f1' },
              { name: 'VC4', values: pts.map((p) => p.vc4), color: '#10b981', area: false }
            ]
          });
          C.mount(body);
        }
      }
      // 🧾 FF stock balance: legacy snapshots are FF, so only exact FF issuance belongs in this equation.
      if (reconBox && reconBox.isConnected) {
        const ym = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
        const monthPts = ((out && out.points) || []).filter((p) => String(p.date).startsWith(ym));
        if (monthPts.length < 2) {
          reconBox.innerHTML = `<div class="dim small">Recompile ho raha hai — is mahine ke ≥2 stock snapshots ke baad yahan dikhega (server 30 min me snapshot leta hai).</div>`;
        } else {
          const first = monthPts[0], last = monthPts[monthPts.length - 1];
          const issueDays = ((out && out.issuance) || []).filter((p) => p.date > first.date && p.date <= last.date);
          const issued = issueDays.reduce((n,p)=>n+(Number(p.ff)||0),0);
          const change = last.total - first.total;
          const added = change + issued; // implied net movement from the stock balance identity
          reconBox.innerHTML = `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Kya</th><th class="num">Tags</th><th>Detail</th></tr></thead><tbody>
            <tr><td>📤 FF issued (out)</td><td class="num"><b>${U.fmt(issued)}</b></td><td class="dim">Exact FF issuance · opening snapshot ke baad · ${issueDays.length} recorded din</td></tr>
            <tr><td>📦 Net stock change</td><td class="num">${change >= 0 ? '+' : ''}${U.fmt(change)}</td><td class="dim">${first.date.slice(8)}/${first.date.slice(5, 7)} (${U.fmt(first.total)}) → ${last.date.slice(8)}/${last.date.slice(5, 7)} (${U.fmt(last.total)})</td></tr>
            <tr><td>📥 Implied net movement</td><td class="num"><b>${U.fmt(added)}</b></td><td class="dim">issued + net change (opening snapshot ke baad)</td></tr>
          </tbody></table></div><p class="dim small" style="margin-top:6px">Ye residual estimate hai, actual inward nahi. Exact IN/OUT/transfer reconciliation ke liye <a href="#/forecast?view=balance">Stock Balance</a> me movement ledger connect karein.</p>`;
        }
      }
    }).catch(() => {
      if (box && box.isConnected) box.innerHTML = `<div class="dim small">History load nahi hui (offline?) — Refresh karke dekho.</div>`;
      if (reconBox && reconBox.isConnected) reconBox.innerHTML = `<div class="dim small">History load nahi hui — Refresh karke dekho.</div>`;
    });
  }

  // ---- page -----------------------------------------------------------------------------------
  async function render(root, params) {
    if (params.agent) { view.scope = 'agent'; view.value = params.agent; } else if (params.tl) { view.scope = 'tl'; view.value = params.tl; } else if (params.cls) { view.scope = 'cls'; view.value = params.cls; } else { view.scope = ''; view.value = ''; }
    const shareOn = !FF.config.feat || FF.config.feat('share') !== false;
    root.innerHTML = `<div class="page-head"><div><h1>📦 Stock / Inventory</h1><p class="sub">StockDataa — agent / TL / class wise stock · VC4 vs Commercial · pivot + Excel export</p></div>
      <div class="head-actions">${shareOn ? '<button class="btn" id="st-wa" title="Stock summary WhatsApp par bhejo">📤 WhatsApp</button>' : ''}<button class="btn primary" data-action="refresh">↻ Refresh</button>${FF.auth.can('sheet:StockDataa') ? `<a class="btn" href="#/sheet/${encodeURIComponent(FF.config.stock.sheet)}">Full StockDataa sheet →</a>` : ''}</div></div>
      <div class="card controls finder"><div class="finder-row"><div class="finder-input"><span class="finder-ico">🔎</span><input class="input" id="st-q" placeholder="Agent ya TL ka naam type karo… (dropdown se select karo)" value="${esc(view.scope === 'cls' ? '' : view.value)}"><button class="btn mic-btn" id="st-mic" title="🗣 Bol ke search karo" type="button">🎤</button></div>
        <label>Criteria <select id="st-scope"><option value="">Agent + TL</option><option value="agent">Agent only</option><option value="tl">TL only</option><option value="direct">🚫 Direct agents only</option></select></label>
        <button class="btn small" id="st-clear" ${view.scope ? '' : 'disabled'}>✕ Clear</button>
        <span class="ctrl-note" id="st-note"></span></div>
        <div class="chip-row" id="st-chips"></div>
        <div class="chip-row recent" id="st-recent" hidden></div></div>
      <div id="st-body">${U.spinner('StockDataa aggregate ho raha hai…')}</div>`;
    const body = U.$('#st-body', root);
    try { await S.need('stock'); await Promise.allSettled([S.need('stockAgents'), S.need('stockTypes'), S.need('daily'), S.need('agents'), S.need('agentClass')]); } catch (err) { body.innerHTML = U.errorBox(err, 'data-action="refresh"'); return; }
    if (!root.isConnected) return;
    const P = prep();
    const waSt = U.$('#st-wa', root);
    if (waSt) waSt.addEventListener('click', () => {
      const perDayVc4 = P.elapsed ? (P.curS ? P.curS.vc4 : 0) / P.elapsed : 0;
      const text = [`*${FF.config.brand} – Stock summary*`, `📅 ${new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`, `Total stock: *${U.fmt(P.total)}* (VC4 ${U.fmt(P.vc4)} | Commercial ${U.fmt(P.comm)})`, `MTD issued: ${U.fmt(P.curS ? P.curS.total : 0)}${P.cur ? ` · ${U.labelYM(P.cur)}` : ''}`, `VC4 cover: ${perDayVc4 ? `${U.fmt(P.vc4 / perDayVc4)} din` : '—'}`, `— ${FF.config.contacts.signature || ''}`].join('\n');
      FF.app.shareWhatsApp(text);
    });
    const noteEl = U.$('#st-note', root);
    noteEl.textContent = view.scope ? `${view.scope === 'cls' ? 'Class' : view.scope === 'tl' ? 'TL' : 'Agent'}: ${view.value}` : `${U.fmt(P.total)} tags · ${U.fmt(P.agents.length)} agents · ${P.tls.filter((t) => !t.excluded).length} TLs`;
    U.$('#st-chips', root).innerHTML = `<span class="dim small">Quick:</span>${P.tls.filter((t) => !t.excluded).slice(0, 8).map((t) => `<button class="chip ${view.scope === 'tl' && norm(view.value) === norm(t.name) ? 'on' : ''}" data-pick-tl="${esc(t.name)}">👥 ${esc(t.name)}</button>`).join('')}<button class="chip direct-chip ${view.direct ? 'on' : ''}" data-pick-direct="1">🚫 Direct agents (${U.fmt(P.agents.filter((a) => FF.config.isExcludedTl(a.tl)).length)})</button><button class="chip vc4 ${view.scope === 'cls' && view.value === 'VC4' ? 'on' : ''}" data-pick-cls="VC4">VC4</button>${P.classes.filter((c) => !isVc4(c)).map((c) => `<button class="chip comm ${view.scope === 'cls' && view.value === c ? 'on' : ''}" data-pick-cls="${esc(c)}">${esc(c)}</button>`).join('')}`;

    let pivot = null;
    if (view.scope) pivot = selectionView(P, body); else overview(P, body);
    C.mount(body);
    if (!view.scope) loadStockExtras(body); // overview par trend chart + in-vs-issued (ek fetch)
    if (FF.stockAge) FF.stockAge.decorate(root); // 🧓 agent table ka 'purana stock' column (index ready hone par bhar jaata hai)

    // search
    const input = U.$('#st-q', root), scopeSel = U.$('#st-scope', root);
    const items = () => {
      const s = scopeSel.value;
      const list = [];
      if (s !== 'agent') P.tls.filter((t) => !t.excluded).forEach((t) => list.push({ kind: 'tl', kindLabel: 'TL', label: t.name, sub: `${U.fmt(t.total)} tags · ${t.agents} agents`, value: t.name }));
      if (s !== 'tl') P.agents.filter((a) => (s === 'direct' ? FF.config.isExcludedTl(a.tl) : true)).forEach((a) => list.push({ kind: 'agent', kindLabel: FF.config.isExcludedTl(a.tl) ? '🚫 Direct Agent' : 'Agent', label: a.name, sub: `${FF.config.isExcludedTl(a.tl) ? FF.config.directLabel({ tlName: a.tl, channel: 'First Forward' }, 'ff') : a.tl} · ${U.fmt(a.total)} tags`, keywords: a.id, value: a.name }));
      if (!s) P.classes.forEach((c) => list.push({ kind: 'cls', kindLabel: 'Class', label: c, sub: `${U.fmt(P.byClass.get(c))} tags`, value: c }));
      return list;
    };
    const drawRecent = () => {
      const box = U.$('#st-recent', root);
      if (!box) return;
      if (view.scope) { box.hidden = true; box.innerHTML = ''; return; }
      const recents = U.recentList('stock', 5);
      if (!recents.length) { box.hidden = true; box.innerHTML = ''; return; }
      box.hidden = false;
      box.innerHTML = `<span class="dim small">🕘 Recent:</span>${recents.map((r) => `<button class="chip recent" data-recent-kind="${esc(r.kind)}" data-recent-value="${esc(r.value)}">${r.kind === 'tl' ? '👥' : r.kind === 'cls' ? '🏷️' : '🧑‍💼'} ${esc(r.label)}</button>`).join('')}<button class="chip ghost" data-recent-clear>✕ Clear</button>`;
    };
    const go = (scope, value) => {
      if (FF.notifications && FF.notifications.logClick) {
        FF.notifications.logClick(`Stock ${scope.toUpperCase()}`, value);
      }
      U.recentAdd('stock', { kind: scope, value, label: value });
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
    drawRecent();
    // 🗣 voice search — bol ke agent/TL kholo
    const mic = U.$('#st-mic', root);
    if (mic && U.voiceInput) mic.addEventListener('click', () => U.voiceInput((text) => {
      input.value = text;
      const all = items();
      const hit = all.find((i) => norm(i.label) === norm(text)) || all.find((i) => norm(i.label).includes(norm(text)));
      if (hit) { U.toast(`🗣 "${text}" → ${hit.label}`, 'ok'); go(hit.kind, hit.value); }
      else { U.toast(`"${text}" ka koi match nahi mila — dropdown se select karo`, 'warn'); input.dispatchEvent(new Event('input', { bubbles: true })); }
    }, 'Agent ya TL ka naam bolo…', { button: mic }));
    U.$('#st-clear', root).addEventListener('click', () => FF.app.navigate('stock', {}));
    root.addEventListener('click', (e) => {
      const rc = e.target.closest('[data-recent-clear]'); if (rc) { try { localStorage.removeItem('ff_recent_stock'); } catch {} drawRecent(); return; }
      const r = e.target.closest('[data-recent]'); if (r && r.dataset.recentKind) { go(r.dataset.recentKind, r.dataset.recentValue); return; }
      const a = e.target.closest('[data-pick-agent]'); if (a) { go('agent', a.dataset.pickAgent); return; }
      const t = e.target.closest('[data-pick-tl]'); if (t) { go('tl', t.dataset.pickTl); return; }
      const dchip = e.target.closest('[data-pick-direct]'); if (dchip) { view.direct = !view.direct; dchip.classList.toggle('on', view.direct); if (!view.scope) { overview(P, body); C.mount(body); } return; }
      const c = e.target.closest('[data-pick-cls]'); if (c) { go('cls', c.dataset.pickCls); return; }
      const x = e.target.closest('#st-xlsx'); if (x && pivot) exportExcel(P, view, pivot, x);
      const pr = e.target.closest('[data-print]'); if (pr && pivot) printStockReport(P, view, pivot);
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
