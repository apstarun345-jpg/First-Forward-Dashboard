/* 🚚 Dispatch Planner v2 — poori tarah naya page (GV + First Forward ek saath).

   Filters : Channel (All / FF / GV) · Type (All / TL-managed / Direct agents) · Priority (High / Medium / Low)
             · Tags (All / VC4 / Commercial) · Need (All / dispatch chahiye / low cover) · TL · search
   Views   : 🧑‍💼 Agent-wise  ·  👥 TL-wise (same format)
   Columns : Agent / TL name · TL · Priority · Last month issuance · Current month issuance ·
             Run-rate/day (= issue ÷ (aaj − 1)) · Required (= run-rate × Settings ke din, e.g. 25) ·
             Stock · Dispatch WITH stock (Required − stock) · Dispatch W/O stock (Required) · Cover din
   Sort    : har column header par click (asc / desc)
   Click   : har row / TL naam / KPI card par click → drawer (summary + poori profile + dispatch calculation)

   Formula ek hi jagah: FF.util.dispatchCalc (util.js) — Home search drawer, Performance, GV Stock Report sab wahi use karte hain. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc, clean = U.clean, fmt = (n, d) => U.fmt(n, d);
  const n0 = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  const norm = (s) => clean(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const safe = async (fn) => { try { return await fn(); } catch { return null; } };

  const PRIO_RANK = { High: 0, Medium: 1, Low: 2 };
  const KNOWN_PRIORITIES = new Set(['High', 'Medium', 'Low']);
  // Normalize only the sheet's recognizable priority wording; keep every other source value intact.
  const prioOf = (t) => {
    const raw = clean(t);
    const s = raw.toLowerCase();
    if (/high|urgent|critical/.test(s)) return 'High';
    if (/medium|slight/.test(s)) return 'Medium';
    if (/\blow\b/.test(s)) return 'Low';
    return raw;
  };
  const BASIS = { total: 'All tags', vc4: 'VC4', comm: 'Commercial' };
  const CH = { ff: { label: 'First Forward', short: 'FF', icon: '🟦' }, gv: { label: 'GV Partner', short: 'GV', icon: '🟩' } };

  // ---- state (page se bahar jaake wapas aane par filters yaad rehte hain) -------------------------------
  const state = {
    view: 'agents', ch: 'all', type: 'all', prio: 'all', basis: 'total', need: 'all', tl: '', q: '', limit: 100,
    sort: { agents: { key: 'net', dir: 'desc' }, tls: { key: 'net', dir: 'desc' } }
  };
  const FILTER_KEYS = ['view', 'ch', 'type', 'prio', 'basis', 'need', 'tl', 'q'];

  // ---- data ---------------------------------------------------------------------------------------------
  const gvOn = () => !!(FF.gv && (FF.gv.enabled ? FF.gv.enabled() : true));
  const trio = (vc4, comm, total) => ({ vc4: n0(vc4), comm: n0(comm), total: n0(total) || n0(vc4) + n0(comm) });

  async function loadSources() {
    const jobs = [];
    if (FF.pages.performance && FF.pages.performance.ensureLoaded) jobs.push(safe(() => FF.pages.performance.ensureLoaded()));
    if (gvOn() && FF.gv.need) jobs.push(safe(() => FF.gv.need('report')));
    await Promise.all(jobs);
  }

  /** Sab agents (FF REPORT + GV REPORT) ek hi shape me. */
  function collectAgents() {
    const out = [];
    const ff = (FF.pages.performance && FF.pages.performance.agents && FF.pages.performance.agents()) || [];
    ff.forEach((a) => {
      if (a.isMaster) return;
      const direct = !!a.tlExcluded;
      out.push({
        kind: 'agent', ch: 'ff', name: clean(a.name || a.agentId), id: clean(a.agentId || a.id),
        tl: direct ? '' : clean(a.tlName), tlId: clean(a.tlId), direct,
        directLabel: direct ? FF.config.directLabel(a, 'ff') : '', priority: prioOf(a.agentPriority || a.priority),
        status: clean(a.agentStatus),
        cur: trio(a.curVc4, a.curNvc4, a.curTotal), last: trio(a.lastVc4, a.lastNvc4, a.lastTotal), stock: trio(a.stockVc4, a.stockNvc4, a.stockTotal),
        tlStock: a.tlStockTotal != null || a.tlStockVc4 != null ? trio(a.tlStockVc4, a.tlStockNvc4, a.tlStockTotal) : null,
        tlPriority: clean(a.tlPriority)
      });
    });
    if (gvOn()) {
      const gv = (FF.gv.get && FF.gv.get('report')) || [];
      gv.forEach((r) => {
        const direct = !!FF.config.isDirectAgent(r, 'gv');
        out.push({
          kind: 'agent', ch: 'gv', name: clean(r.agentName || r.agentId), id: clean(r.agentId),
          tl: direct ? '' : clean(r.tlName), tlId: clean(r.tlId), direct,
          directLabel: direct ? FF.config.directLabel(r, 'gv') : '', priority: prioOf(r.priority), status: clean(r.agentStatus),
          cur: trio(r.curVc4, r.curComm, r.curTotal), last: trio(r.lastVc4, r.lastComm, r.lastTotal), stock: trio(r.stockVc4, r.stockComm, r.stockTotal),
          tlStock: r.tlStockTotal != null ? trio(r.tlStockVc4, r.tlStockComm, r.tlStockTotal) : null, tlPriority: ''
        });
      });
    }
    out.forEach((r, i) => { r.uid = `a${i}`; });
    return out;
  }

  const sumTrio = (list, key) => ({ vc4: U.sum(list, (r) => r[key].vc4), comm: U.sum(list, (r) => r[key].comm), total: U.sum(list, (r) => r[key].total) });

  /** TL-wise rows: asli TL (TL-managed agents ka jod) + har channel ka "Direct Agents" group. */
  function collectTls(agents) {
    const map = new Map();
    agents.forEach((a) => {
      const key = a.direct ? `${a.ch}|__direct__` : `${a.ch}|${norm(a.tl) || '__unmapped__'}`;
      if (!map.has(key)) map.set(key, { ch: a.ch, direct: a.direct, name: a.direct ? a.directLabel || 'Direct Agents' : (a.tl || 'Unmapped (TL blank)'), list: [] });
      map.get(key).list.push(a);
    });
    const out = [];
    map.forEach((g) => {
      const list = g.list;
      const cur = sumTrio(list, 'cur'), last = sumTrio(list, 'last'), agentStock = sumTrio(list, 'stock');
      const src = list.find((a) => a.tlStock);
      const stock = !g.direct && src ? src.tlStock : agentStock;          // TL stock: sheet ki value, warna agents ka jod (profile drawer jaisa)
      const sourceTlPrios = !g.direct ? U.uniq(list.map((a) => clean(a.tlPriority)).filter(Boolean)) : [];
      const sheetPrio = sourceTlPrios.length === 1 ? prioOf(sourceTlPrios[0]) : sourceTlPrios.map(prioOf).join(' / ');
      out.push({
        kind: 'tl', ch: g.ch, name: g.name, id: (list.find((a) => a.tlId) || {}).tlId || '', tl: g.direct ? '' : g.name, direct: g.direct,
        directLabel: g.direct ? g.name : '', priority: sheetPrio, status: '', agents: list.length, members: list,
        cur, last, stock, tlStock: null
      });
    });
    out.forEach((r, i) => { r.uid = `t${i}`; });
    return out;
  }

  /** Row + calc (selected tag basis). */
  function withCalc(r, basis) {
    const c = U.dispatchCalc({ cur: r.cur[basis], last: r.last[basis], stock: r.stock[basis] });
    const tagged = r.direct && (r.priority === 'High' || r.priority === 'Medium');
    let action;
    if (r.direct) action = tagged ? { t: '🏷️ Tags chahiye', cls: 'violet' } : { t: 'No dispatch', cls: 'gray' };
    else if (c.net > 0) action = { t: '🚚 Dispatch', cls: c.cover != null && c.cover < 7 ? 'red' : 'amber' };
    else action = { t: '✅ Covered', cls: 'green' };
    return { ...r, c, tagged, action, rate: c.rate, required: c.required, net: c.net, gross: c.gross, cover: c.cover, curV: c.cur, lastV: c.last, stockV: c.stock };
  }

  // ---- filtering / sorting ------------------------------------------------------------------------------
  const DIMS = {
    ch: (r, v) => v === 'all' || r.ch === v,
    type: (r, v) => v === 'all' || (v === 'direct' ? r.direct : !r.direct),
    prio: (r, v) => v === 'all' || (v === 'other' ? !KNOWN_PRIORITIES.has(r.priority) : r.priority === v),
    need: (r, v) => v === 'all' || (v === 'need' ? !r.direct && r.net > 0 : v === 'low' ? r.cover != null && r.cover < 7 : v === 'zero' ? r.stockV <= 0 : true),
    tl: (r, v) => !v || (r.kind === 'tl' ? norm(r.name) === norm(v) : norm(r.tl) === norm(v)),
    q: (r, v) => { const q = clean(v).toLowerCase(); return !q || [r.name, r.id, r.tl, r.directLabel, r.ch === 'gv' ? 'gv' : 'ff first forward', r.priority].join(' ').toLowerCase().includes(q); }
  };
  const passes = (r, skip) => Object.keys(DIMS).every((k) => k === skip || DIMS[k](r, state[k]));
  const SORTERS = {
    name: (r) => clean(r.name).toLowerCase(), tl: (r) => clean(r.direct ? r.directLabel : r.tl).toLowerCase(), prio: (r) => PRIO_RANK[r.priority],
    last: (r) => r.lastV, cur: (r) => r.curV, rate: (r) => r.rate, required: (r) => r.required, stock: (r) => r.stockV, net: (r) => r.net, gross: (r) => r.gross, cover: (r) => r.cover,
    agents: (r) => r.agents || 0, growth: (r) => (r.c.growth == null ? -Infinity : r.c.growth)
  };
  function sortRows(list, s) {
    const f = SORTERS[s.key] || SORTERS.net, dir = s.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = f(a), y = f(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;            // cover khaali (rate 0) hamesha neeche
      if (y == null) return -1;
      if (typeof x === 'string') return x.localeCompare(y) * dir;
      return (x - y) * dir || (b.net - a.net);
    });
  }

  function agg(list) {
    const cur = U.sum(list, (r) => r.curV), last = U.sum(list, (r) => r.lastV), stock = U.sum(list, (r) => r.stockV), rate = U.sum(list, (r) => r.rate);
    return {
      count: list.length, cur, last, stock, rate, required: U.sum(list, (r) => r.required), net: U.sum(list, (r) => r.net), gross: U.sum(list, (r) => r.gross),
      cover: rate > 0 ? stock / rate : null, growth: last > 0 ? ((cur - last) / last) * 100 : null,
      lowCover: list.filter((r) => r.cover != null && r.cover < 7).length, needy: list.filter((r) => !r.direct && r.net > 0).length,
      direct: list.filter((r) => r.direct).length, tagged: list.filter((r) => r.tagged).length,
      ff: list.filter((r) => r.ch === 'ff').length, gv: list.filter((r) => r.ch === 'gv').length
    };
  }

  // ---- small html helpers -------------------------------------------------------------------------------
  const prioBadge = (p) => {
    const value = clean(p) || '—';
    const tone = value === 'High' ? 'red' : value === 'Medium' ? 'amber' : value === 'Low' ? 'green' : 'gray';
    return `<span class="badge ${tone}" title="Priority from source sheet">${esc(value)}</span>`;
  };
  const chBadge = (ch) => `<span class="dp2-ch ${ch}">${CH[ch].icon} ${CH[ch].short}</span>`;
  const coverCell = (c) => {
    if (c == null) return '<span class="dim">—</span>';
    const tone = c < 7 ? 'red' : c < 15 ? 'amber' : 'green';
    return `<span class="dp2-cover ${tone}">${fmt(c, true)} <small>din</small></span>`;
  };
  const growthChip = (g) => (g == null ? '' : `<small class="dp2-gr ${g >= 0 ? 'up' : 'down'}">${g >= 0 ? '▲' : '▼'} ${Math.abs(g).toFixed(0)}%</small>`);
  const typeLabel = (r) => (r.direct ? `<span class="direct-chip">🚫 ${esc(r.directLabel || 'Direct')}</span>` : esc(r.tl || '—'));

  // ---- table --------------------------------------------------------------------------------------------
  function columns(view) {
    const days = U.suggestDays(), el = U.runRateDays();
    const c = [
      { k: 'name', t: view === 'tls' ? 'TL' : 'Agent' },
      ...(view === 'tls' ? [{ k: 'agents', t: 'Agents', num: 1 }] : [{ k: 'tl', t: 'TL' }]),
      { k: 'prio', t: 'Priority' },
      { k: 'last', t: 'Last month', num: 1, sub: 'issuance' },
      { k: 'cur', t: 'This month', num: 1, sub: 'issuance' },
      { k: 'rate', t: 'Run-rate', num: 1, sub: `/day · ÷ ${el} din` },
      { k: 'required', t: 'Required', num: 1, sub: `rate × ${days} din` },
      { k: 'stock', t: 'Stock', num: 1, sub: 'in field' },
      { k: 'net', t: 'Dispatch', num: 1, sub: 'WITH stock', hot: 1 },
      { k: 'gross', t: 'Dispatch', num: 1, sub: 'W/O stock', hot: 2 },
      { k: 'cover', t: 'Cover', num: 1, sub: 'din' },
      { k: '', t: 'Status' }
    ];
    return c;
  }
  function head(view) {
    const s = state.sort[view];
    return `<thead><tr><th class="dp2-idx">#</th>${columns(view).map((c) => {
      const on = c.k && s.key === c.k;
      return `<th class="${c.num ? 'num ' : ''}${c.k ? 'dp2-sort ' : ''}${on ? 'on ' : ''}${c.hot ? `hot${c.hot}` : ''}" ${c.k ? `data-dp-sort="${c.k}"` : ''}><span>${esc(c.t)}${c.k ? `<i>${on ? (s.dir === 'asc' ? '▲' : '▼') : '↕'}</i>` : ''}</span>${c.sub ? `<small>${esc(c.sub)}</small>` : ''}</th>`;
    }).join('')}</tr></thead>`;
  }
  function rowHtml(r, i, view) {
    const tlCell = r.direct ? typeLabel(r) : r.tl ? `<a class="dp2-tl" data-dp-tl="${esc(r.ch)}|${esc(r.tl)}" title="TL ka poora summary">${esc(r.tl)}</a>` : '<span class="dim">—</span>';
    const nameCell = `<div class="dp2-name"><b>${esc(r.name)}</b><small>${chBadge(r.ch)}${r.id ? ` <span>${esc(r.id)}</span>` : ''}${r.direct && view === 'tls' ? ` <span class="direct-chip">🚫 direct</span>` : ''}</small></div>`;
    return `<tr class="dp2-row ${r.direct ? 'is-direct' : ''} ${r.cover != null && r.cover < 7 && !r.direct ? 'is-low' : ''}" data-dp-open="${r.uid}">
      <td class="dp2-idx">${i + 1}</td><td>${nameCell}</td>${view === 'tls' ? `<td class="num">${fmt(r.agents)}</td>` : `<td>${tlCell}</td>`}<td>${prioBadge(r.priority)}</td>
      <td class="num">${fmt(r.lastV)}</td><td class="num"><b>${fmt(r.curV)}</b>${growthChip(r.c.growth)}</td><td class="num">${fmt(r.rate, true)}</td><td class="num">${fmt(r.required)}</td><td class="num">${fmt(r.stockV)}</td>
      <td class="num dp2-hot1"><b>${fmt(r.net)}</b></td><td class="num dp2-hot2"><b>${fmt(r.gross)}</b></td><td class="num">${coverCell(r.cover)}</td>
      <td><span class="dp2-act ${r.action.cls}">${r.action.t}</span></td></tr>`;
  }
  function tableHtml(list, view) {
    const shown = list.slice(0, state.limit);
    const t = agg(list);
    const label = view === 'tls' ? 'TLs' : 'agents';
    const foot = list.length ? `<tfoot><tr class="row-total"><td></td><td colspan="${view === 'tls' ? 1 : 1}">Total · ${fmt(list.length)} ${label}</td><td class="num">${view === 'tls' ? fmt(U.sum(list, (r) => r.agents)) : ''}</td><td></td><td class="num">${fmt(t.last)}</td><td class="num">${fmt(t.cur)}</td><td class="num">${fmt(t.rate, true)}</td><td class="num">${fmt(t.required)}</td><td class="num">${fmt(t.stock)}</td><td class="num dp2-hot1">${fmt(t.net)}</td><td class="num dp2-hot2">${fmt(t.gross)}</td><td class="num">${coverCell(t.cover)}</td><td></td></tr></tfoot>` : '';
    const body = shown.map((r, i) => rowHtml(r, i, view)).join('') || `<tr><td colspan="14"><div class="empty-state">Is filter par koi ${label === 'TLs' ? 'TL' : 'agent'} nahi mila<br><span class="dim small">Filters clear karke dekho</span></div></td></tr>`;
    return `<div class="table-wrap dp2-wrap"><table class="dp2-table">${head(view)}<tbody>${body}</tbody>${foot}</table></div>
      ${list.length > shown.length ? `<div class="dp2-more"><button class="btn small" data-dp-more="1">⬇ Aur dikhao (${fmt(list.length - shown.length)} baaki)</button><span class="dim small">Showing ${fmt(shown.length)} / ${fmt(list.length)} · sort karne par poori list sort hoti hai</span></div>` : ''}`;
  }

  // ---- KPI cards ----------------------------------------------------------------------------------------
  function kpiHtml(t, view) {
    const days = U.suggestDays(), el = U.runRateDays();
    const card = (key, tone, icon, title, value, foot) => `<button class="dp2-kpi ${tone}" data-dp-kpi="${key}" title="Click → summary drawer"><span class="dp2-kpi-top"><em>${title}</em><i>${icon}</i></span><b>${value}</b><small>${foot}</small></button>`;
    return [
      card('count', 'k1', view === 'tls' ? '👥' : '🧑‍💼', view === 'tls' ? 'TLs in view' : 'Agents in view', fmt(t.count), `${fmt(t.ff)} FF · ${fmt(t.gv)} GV · ${fmt(t.direct)} direct`),
      card('issued', 'k2', '🏷️', 'Issued this month', fmt(t.cur), `last month ${fmt(t.last)} ${t.growth == null ? '' : growthChip(t.growth)}`),
      card('rate', 'k3', '⚡', 'Run-rate / day', fmt(t.rate, true), `issue ÷ ${fmt(el)} din (aaj − 1)`),
      card('required', 'k4', '🎯', `Required · ${fmt(days)} din`, fmt(t.required), `run-rate × ${fmt(days)} · stock ${fmt(t.stock)}`),
      card('net', 'k5', '🚚', 'Dispatch WITH stock', fmt(t.net), `Required − stock · ${fmt(t.needy)} ko chahiye`),
      card('gross', 'k6', '📦', 'Dispatch W/O stock', fmt(t.gross), `bina stock ghataye · ${fmt(t.tagged)} direct ko tags`),
      card('low', 'k7', '🚨', 'Cover < 7 din', fmt(t.lowCover), `overall cover ${t.cover == null ? '—' : `${fmt(t.cover, true)} din`}`)
    ].join('');
  }

  // ---- filter chips -------------------------------------------------------------------------------------
  function chipsHtml(all) {
    const grp = (dim, label, opts) => {
      const items = opts.map(([v, text, cls]) => {
        const n = all.filter((r) => passes(r, dim) && (dim === 'basis' ? true : DIMS[dim] ? DIMS[dim](r, v) : true)).length;
        const on = state[dim] === v;
        return `<button class="dp2-pill ${cls || ''} ${on ? 'on' : ''}" data-dp-f="${dim}:${v}">${text}${dim === 'basis' ? '' : ` <b>${fmt(n)}</b>`}</button>`;
      }).join('');
      return `<div class="dp2-grp"><span class="dp2-lbl">${label}</span><div class="dp2-pills">${items}</div></div>`;
    };
    return [
      grp('ch', 'Channel', [['all', '🌐 Both'], ['ff', '🟦 First Forward', 'ff'], ['gv', '🟩 GV Partner', 'gv']]),
      grp('type', 'Type', [['all', '👥 All'], ['managed', '🧑‍💼 TL-managed'], ['direct', '🚫 Direct agents', 'violet']]),
      grp('prio', 'Priority', [['all', 'All'], ['High', '🔴 High', 'red'], ['Medium', '🟠 Medium', 'amber'], ['Low', '🟢 Low', 'green'], ['other', '📄 Other / source', 'gray']]),
      grp('basis', 'Tags', [['total', '🏷️ All tags'], ['vc4', '🚗 VC4'], ['comm', '🚛 Commercial']]),
      grp('need', 'Need', [['all', 'All'], ['need', '🚚 Dispatch chahiye'], ['low', '🚨 Cover < 7 din', 'red'], ['zero', '0 stock']])
    ].join('');
  }

  // ---- export / share -----------------------------------------------------------------------------------
  const CSV_HEAD = (view) => [view === 'tls' ? 'TL' : 'Agent', 'ID', 'Channel', 'Type', view === 'tls' ? 'Agents' : 'TL', 'Priority', 'Last month', 'This month', 'Run-rate / day', `Required (× ${U.suggestDays()} din)`, 'Stock', 'Dispatch WITH stock', 'Dispatch W/O stock', 'Cover (din)', 'Status'];
  const csvRow = (r, view) => [r.name, r.id, CH[r.ch].label, r.direct ? 'Direct' : 'TL-managed', view === 'tls' ? r.agents : (r.direct ? r.directLabel : r.tl), r.priority, r.lastV, r.curV, Number(r.rate.toFixed(2)), r.required, r.stockV, r.net, r.gross, r.cover == null ? '' : Number(r.cover.toFixed(1)), r.action.t.replace(/^\S+\s/, '')];
  function waText(list, view) {
    const t = agg(list);
    const lines = [`*🚚 Dispatch plan · ${U.suggestDays()} din* (${new Date().toLocaleDateString('en-IN')})`,
      `${state.ch === 'all' ? 'FF + GV' : CH[state.ch].label} · ${BASIS[state.basis]} · ${fmt(t.count)} ${view === 'tls' ? 'TLs' : 'agents'}`,
      `Run-rate ${fmt(t.rate, true)}/day (÷ ${U.runRateDays()} din) · Required ${fmt(t.required)}`,
      `WITH stock *${fmt(t.net)}* · W/O stock *${fmt(t.gross)}*`, ''];
    [...list].filter((r) => r.net > 0).sort((a, b) => b.net - a.net).slice(0, 15).forEach((r, i) => lines.push(`${i + 1}. ${r.name} (${CH[r.ch].short}${r.direct ? ' · direct' : r.tl && view !== 'tls' ? ` · ${r.tl}` : ''}) — ${fmt(r.net)} · w/o ${fmt(r.gross)} · cover ${r.cover == null ? '—' : fmt(r.cover, true)} din`));
    return lines.join('\n');
  }

  // ---- drawers ------------------------------------------------------------------------------------------
  const TBL_HEAD = ['', 'Count', 'This month', 'Run-rate/day', 'Required', 'Stock', 'WITH stock', 'W/O stock', 'Cover'];
  const aggRow = (label, list) => { const t = agg(list); return `<tr><td><b>${label}</b></td><td class="num">${fmt(t.count)}</td><td class="num">${fmt(t.cur)}</td><td class="num">${fmt(t.rate, true)}</td><td class="num">${fmt(t.required)}</td><td class="num">${fmt(t.stock)}</td><td class="num"><b class="sug-chip">${fmt(t.net)}</b></td><td class="num"><b class="sug-chip wo">${fmt(t.gross)}</b></td><td class="num">${coverCell(t.cover)}</td></tr>`; };
  const aggTable = (title, groups) => `<section class="mp-sec"><h4>${title}</h4><div class="table-wrap"><table class="tbl compact"><thead><tr>${TBL_HEAD.map((h, i) => `<th class="${i ? 'num' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${groups.map(([l, list]) => aggRow(l, list)).join('')}</tbody></table></div></section>`;
  const topTable = (title, list, cols) => `<section class="mp-sec"><h4>${title}</h4><div class="table-wrap tall"><table class="tbl compact"><thead><tr><th>Name</th><th>Prio</th>${cols.map((c) => `<th class="num">${c[0]}</th>`).join('')}</tr></thead><tbody>${list.map((r) => `<tr class="clickable" data-dp-open="${r.uid}"><td><b>${esc(r.name)}</b><small class="cell-sub">${CH[r.ch].short}${r.direct ? ' · direct' : r.tl ? ` · ${esc(r.tl)}` : ''}</small></td><td>${prioBadge(r.priority)}</td>${cols.map((c) => `<td class="num">${c[1](r)}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="9" class="empty">Koi row nahi</td></tr>'}</tbody></table></div></section>`;

  function openDrawer(opts) {
    if (!FF.app || !FF.app.openDrawer) return null;
    FF.app.openDrawer({ ...opts, wide: true });
    return U.$('#drawer-body');
  }

  function summaryDrawer(key, ctx) {
    const list = ctx.list, view = ctx.view, days = U.suggestDays(), el = U.runRateDays();
    const t = agg(list);
    const meta = {
      count: ['👥', `${fmt(t.count)} ${view === 'tls' ? 'TLs' : 'agents'} in view`, 'cur', [['This month', (r) => fmt(r.curV)], ['WITH stock', (r) => fmt(r.net)], ['Cover', (r) => coverCell(r.cover)]]],
      issued: ['🏷️', `Issued this month · ${fmt(t.cur)}`, 'cur', [['Last month', (r) => fmt(r.lastV)], ['This month', (r) => fmt(r.curV)], ['Growth', (r) => (r.c.growth == null ? '—' : U.pctHtml(r.c.growth))]]],
      rate: ['⚡', `Run-rate · ${fmt(t.rate, true)} / day`, 'rate', [['This month', (r) => fmt(r.curV)], ['Run-rate/day', (r) => fmt(r.rate, true)], ['Required', (r) => fmt(r.required)]]],
      required: ['🎯', `Required · ${fmt(t.required)} (× ${fmt(days)} din)`, 'required', [['Run-rate/day', (r) => fmt(r.rate, true)], ['Required', (r) => fmt(r.required)], ['Stock', (r) => fmt(r.stockV)]]],
      net: ['🚚', `Dispatch WITH stock · ${fmt(t.net)}`, 'net', [['Required', (r) => fmt(r.required)], ['Stock', (r) => fmt(r.stockV)], ['WITH stock', (r) => `<b class="sug-chip">${fmt(r.net)}</b>`], ['W/O stock', (r) => fmt(r.gross)]]],
      gross: ['📦', `Dispatch W/O stock · ${fmt(t.gross)}`, 'gross', [['Run-rate/day', (r) => fmt(r.rate, true)], ['W/O stock', (r) => `<b class="sug-chip wo">${fmt(r.gross)}</b>`], ['Stock', (r) => fmt(r.stockV)]]],
      low: ['🚨', `Cover < 7 din · ${fmt(t.lowCover)}`, 'cover', [['Stock', (r) => fmt(r.stockV)], ['Run-rate/day', (r) => fmt(r.rate, true)], ['Cover', (r) => coverCell(r.cover)], ['WITH stock', (r) => fmt(r.net)]]]
    }[key] || ['📊', 'Summary', 'net', []];
    const [icon, title, sortKey, cols] = meta;
    const asc = sortKey === 'cover';
    let top = list;
    if (key === 'low') top = list.filter((r) => r.cover != null && r.cover < 7);
    if (key === 'net') top = list.filter((r) => r.net > 0);
    top = sortRows(top, { key: sortKey, dir: asc ? 'asc' : 'desc' }).slice(0, 25);
    const body = openDrawer({ kicker: `🚚 Dispatch Planner · ${view === 'tls' ? 'TL-wise' : 'Agent-wise'} summary`, title: `${icon} ${title}`, sub: esc(`${state.ch === 'all' ? 'FF + GV' : CH[state.ch].label} · ${BASIS[state.basis]} · run-rate = issue ÷ ${el} din · required = run-rate × ${days} din`), body: '<div id="dp2-drawer-slot"></div>', actions: '' });
    if (!body) return;
    const slot = U.$('#dp2-drawer-slot', body) || body;
    slot.innerHTML = `<div class="mp">
      <div class="mp-kpis">
        <div class="mp-kpi k1"><small>${view === 'tls' ? 'TLs' : 'Agents'}</small><b>${fmt(t.count)}</b><em>${fmt(t.ff)} FF · ${fmt(t.gv)} GV</em></div>
        <div class="mp-kpi k2"><small>This month · last</small><b>${fmt(t.cur)}</b><em>last ${fmt(t.last)} ${t.growth == null ? '' : U.pctHtml(t.growth)}</em></div>
        <div class="mp-kpi k3"><small>Run-rate / day</small><b>${fmt(t.rate, true)}</b><em>÷ ${fmt(el)} din</em></div>
        <div class="mp-kpi k4"><small>Required · ${fmt(days)} din</small><b>${fmt(t.required)}</b><em>stock ${fmt(t.stock)}</em></div>
        <div class="mp-kpi k5"><small>WITH stock</small><b>${fmt(t.net)}</b><em>${fmt(t.needy)} ko dispatch</em></div>
        <div class="mp-kpi k6"><small>W/O stock</small><b>${fmt(t.gross)}</b><em>cover ${t.cover == null ? '—' : `${fmt(t.cover, true)} din`}</em></div>
      </div>
      <p class="mp-note">Run-rate = is month ke issue ÷ <b>(aaj − 1) = ${fmt(el)} din</b> · Required = run-rate × <b>${fmt(days)}</b> din · <b>WITH stock</b> = Required − stock · <b>W/O stock</b> = Required · Cover = stock ÷ run-rate</p>
      ${aggTable('🌐 Channel-wise', [['🟦 First Forward', list.filter((r) => r.ch === 'ff')], ['🟩 GV Partner', list.filter((r) => r.ch === 'gv')], ['Total', list]])}
      ${aggTable('🎚️ Priority-wise', [['🔴 High', list.filter((r) => r.priority === 'High')], ['🟠 Medium', list.filter((r) => r.priority === 'Medium')], ['🟢 Low', list.filter((r) => r.priority === 'Low')]])}
      ${aggTable('🧑‍💼 TL-managed vs 🚫 Direct', [['TL-managed', list.filter((r) => !r.direct)], ['Direct agents (tags only)', list.filter((r) => r.direct)]])}
      ${topTable(`🏆 Top ${fmt(top.length)} · ${esc(title)}`, top, cols)}
    </div>`;
    bindDrawer(body, ctx);
  }

  function groupDrawer(r, ctx) {
    const members = ctx.calc(r.members);
    const t = agg(members);
    const body = openDrawer({ kicker: '🚚 Dispatch Planner · Direct group', title: `🚫 ${r.name}`, sub: esc(`${CH[r.ch].label} · ${fmt(members.length)} agents · TL nahi — stock dispatch exempt, High/Medium ko tags`), body: '<div id="dp2-drawer-slot"></div>', actions: '' });
    if (!body) return;
    const slot = U.$('#dp2-drawer-slot', body) || body;
    slot.innerHTML = `<div class="mp"><div class="mp-kpis">
      <div class="mp-kpi k1"><small>Agents</small><b>${fmt(t.count)}</b><em>${fmt(t.tagged)} High/Medium</em></div>
      <div class="mp-kpi k2"><small>This month</small><b>${fmt(t.cur)}</b><em>last ${fmt(t.last)}</em></div>
      <div class="mp-kpi k3"><small>Run-rate / day</small><b>${fmt(t.rate, true)}</b><em>÷ ${fmt(U.runRateDays())} din</em></div>
      <div class="mp-kpi k5"><small>Tags WITH stock</small><b>${fmt(t.net)}</b><em>Required − stock</em></div>
      <div class="mp-kpi k6"><small>Tags W/O stock</small><b>${fmt(t.gross)}</b><em>cover ${t.cover == null ? '—' : `${fmt(t.cover, true)} din`}</em></div></div>
      ${topTable('🧑‍💼 Agents', sortRows(members, { key: 'net', dir: 'desc' }).slice(0, 200), [['This month', (x) => fmt(x.curV)], ['Run-rate', (x) => fmt(x.rate, true)], ['Stock', (x) => fmt(x.stockV)], ['WITH stock', (x) => `<b class="sug-chip">${fmt(x.net)}</b>`], ['W/O stock', (x) => fmt(x.gross)], ['Cover', (x) => coverCell(x.cover)]])}</div>`;
    bindDrawer(body, ctx);
  }

  function bindDrawer(body, ctx) {
    body.onclick = (e) => {
      const row = e.target.closest('[data-dp-open]');
      if (row) openRow(row.dataset.dpOpen, ctx);
    };
  }

  function personOf(r) {
    return { kind: `${r.ch}-${r.kind}`, name: r.name, sub: r.id, tlSet: new Set(r.tl ? [r.tl] : []), classMap: new Map(), bars: new Set(), direct: r.direct, directLabel: r.directLabel, kicker: `🚚 Dispatch Planner · ${CH[r.ch].label} ${r.kind === 'tl' ? 'TL' : 'agent'}` };
  }
  function openRow(uid, ctx) {
    const r = ctx.byUid.get(uid);
    if (!r) return;
    if (r.kind === 'tl' && r.direct) return groupDrawer(r, ctx);
    if (FF.masterProfile && FF.masterProfile.supports(personOf(r))) FF.masterProfile.open(personOf(r));
  }
  function openTl(chName, ctx) {
    const [ch, name] = chName.split('|');
    const r = ctx.allTls.find((x) => x.ch === ch && norm(x.name) === norm(name) && !x.direct);
    if (r) openRow(r.uid, ctx);
  }

  // ---- page ---------------------------------------------------------------------------------------------
  async function render(root, params) {
    params = params || {};
    // URL / assistant se aaye params
    const legacy = { channel: 'ch', pool: '' };
    const incoming = {};
    FILTER_KEYS.forEach((k) => { if (params[k] !== undefined && params[k] !== '') incoming[k] = params[k]; });
    if (params.channel && ['ff', 'gv', 'all'].includes(params.channel)) incoming.ch = params.channel;
    if (params.pool === 'direct') incoming.type = 'direct';
    if (params.priority) incoming.prio = params.priority;
    if (Object.keys(incoming).length) Object.assign(state, incoming, { limit: 100 });
    if (!['agents', 'tls'].includes(state.view)) state.view = 'agents';
    void legacy;

    const canSchedule = !!(FF.auth && FF.auth.isAdmin && FF.auth.isAdmin());
    const authSettings = (FF.auth && FF.auth.settings) || {};
    const savedMail = authSettings.dispatchEmail || {};
    const mailSections = Array.isArray(savedMail.sections) ? savedMail.sections : ['summary', 'agents'];
    const mailHour = Number.isInteger(Number(savedMail.hour)) ? Number(savedMail.hour) : 9;
    const mailWeekday = Number.isInteger(Number(savedMail.weekday)) ? Number(savedMail.weekday) : 1;
    const mailDay = Number.isInteger(Number(savedMail.day)) ? Number(savedMail.day) : 1;
    const opt = (value, label, selected) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`;
    const mailScheduleHtml = canSchedule ? `<section class="card dp-mail-card" id="dp2-mail-card">
      <div class="card-head"><div><h3>📧 Schedule a dispatch plan email</h3><small class="dim">Choose the data, recipients and delivery time · server par save hota hai</small></div><span class="badge ${savedMail.enabled ? 'green' : 'gray'}">${savedMail.enabled ? 'SCHEDULE ON' : 'SCHEDULE OFF'}</span></div>
      <div class="dp-mail-body">
        <div class="dp-mail-grid">
          <label class="fld dp-mail-recipients"><span>Recipients <small>(comma / semicolon separated)</small></span><input class="input" id="dp2-email-to" type="text" value="${esc(savedMail.recipients || authSettings.email?.to || '')}" maxlength="1200" placeholder="manager@example.com, ops@example.com"></label>
          <label class="fld"><span>Delivery</span><select class="select" id="dp2-email-kind">${opt('daily', 'Every day', savedMail.kind || 'daily')}${opt('weekly', 'Weekly', savedMail.kind || 'daily')}${opt('monthly', 'Monthly', savedMail.kind || 'daily')}</select></label>
          <label class="fld"><span>Hour (IST)</span><input class="input" id="dp2-email-hour" type="number" min="0" max="23" value="${mailHour}"></label>
          <label class="fld dp-mail-weekday" data-dp-mail-weekday ${savedMail.kind === 'weekly' ? '' : 'hidden'}><span>Weekday</span><select class="select" id="dp2-email-weekday">${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => opt(String(i), d, String(mailWeekday))).join('')}</select></label>
          <label class="fld dp-mail-monthday" data-dp-mail-monthday ${savedMail.kind === 'monthly' ? '' : 'hidden'}><span>Day of month</span><select class="select" id="dp2-email-day">${Array.from({ length: 28 }, (_, i) => opt(String(i + 1), `${i + 1}`, String(mailDay))).join('')}</select></label>
          <label class="fld"><span>Channel</span><select class="select" id="dp2-email-channel">${opt('all', 'First Forward + GV', savedMail.channel || 'all')}${opt('ff', 'First Forward only', savedMail.channel || 'all')}${opt('gv', 'GV Partner only', savedMail.channel || 'all')}</select></label>
          <label class="fld"><span>Tag basis</span><select class="select" id="dp2-email-basis">${opt('total', 'All tags', savedMail.basis || 'total')}${opt('vc4', 'VC4', savedMail.basis || 'total')}${opt('comm', 'Commercial', savedMail.basis || 'total')}</select></label>
          <label class="fld"><span>Priority filter</span><select class="select" id="dp2-email-priority">${opt('all', 'All priorities', savedMail.priority || 'all')}${opt('High', 'High', savedMail.priority || 'all')}${opt('Medium', 'Medium', savedMail.priority || 'all')}${opt('Low', 'Low', savedMail.priority || 'all')}${opt('other', 'Other / source value', savedMail.priority || 'all')}</select></label>
          <label class="fld"><span>Maximum rows per CSV</span><select class="select" id="dp2-email-rows">${[50, 100, 250, 500].map((n) => opt(String(n), `${n} rows`, String(savedMail.maxRows || 250))).join('')}</select></label>
        </div>
        <div class="dp-mail-sections"><b>Data to send</b><label class="check"><input type="checkbox" data-dp-mail-section="summary" ${mailSections.includes('summary') ? 'checked' : ''}> Summary</label><label class="check"><input type="checkbox" data-dp-mail-section="agents" ${mailSections.includes('agents') ? 'checked' : ''}> Agent-wise CSV</label><label class="check"><input type="checkbox" data-dp-mail-section="tls" ${mailSections.includes('tls') ? 'checked' : ''}> TL-wise CSV</label></div>
        <div class="dp-mail-actions"><label class="check dp-mail-enable"><input type="checkbox" id="dp2-email-enabled" ${savedMail.enabled === true ? 'checked' : ''}> Enable recurring email</label><button class="btn primary" id="dp2-email-save">💾 Save schedule</button><button class="btn" id="dp2-email-send">📨 Send this selection now</button><a class="btn" href="#/settings?tab=features">⚙️ Email provider settings</a></div>
        <p class="dp-mail-note">Uses the existing dashboard email provider (SMTP / Apps Script / Resend / Brevo). Schedule runs on the server, even if this page is closed. Source-sheet priorities are preserved.</p><div class="dim small" id="dp2-email-status" aria-live="polite"></div>
      </div>
    </section>` : `<section class="card dp-mail-card" id="dp2-mail-card"><div class="card-head"><div><h3>📧 Dispatch plan email</h3><small class="dim">Admin can select report data, recipients and a recurring IST schedule.</small></div></div><p class="dp-mail-note">Email scheduling is managed by an administrator · existing provider settings are in Settings → Features.</p></section>`;

    root.innerHTML = `<div class="dp2">
      <section class="dp2-hero">
        <div class="dp2-hero-main"><span class="dp2-hero-ico">🚚</span><div><h1>Dispatch Planner</h1><p>GV + First Forward · agent &amp; TL-wise · ek formula, har jagah</p></div></div>
        <div class="dp2-formula" id="dp2-formula"></div>
        <div class="dp2-hero-actions">${canSchedule ? '<button class="btn small" id="dp2-mail-jump">📧 Mail schedule</button>' : ''}<button class="btn small" id="dp2-csv">⬇ CSV</button><button class="btn small" id="dp2-xlsx">⬇ Excel</button><button class="btn small" id="dp2-wa">📲 WhatsApp</button><button class="btn small primary" data-action="refresh">↻ Refresh</button></div>
      </section>
      ${mailScheduleHtml}
      <div id="dp2-body">${U.spinner('GV + FF REPORT load ho raha hai…')}</div></div>`;
    await loadSources();
    if (!root.isConnected) return null;

    const mailJump = U.$('#dp2-mail-jump', root);
    if (mailJump) mailJump.addEventListener('click', () => U.$('#dp2-mail-card', root)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    if (canSchedule) {
      const kindEl = U.$('#dp2-email-kind', root);
      const updateMailFrequency = () => {
        const kind = kindEl.value;
        const weekday = U.$('[data-dp-mail-weekday]', root), monthday = U.$('[data-dp-mail-monthday]', root);
        if (weekday) weekday.hidden = kind !== 'weekly';
        if (monthday) monthday.hidden = kind !== 'monthly';
      };
      kindEl.addEventListener('change', updateMailFrequency);
      updateMailFrequency();
      const readMailForm = () => ({
        enabled: U.$('#dp2-email-enabled', root).checked,
        recipients: U.$('#dp2-email-to', root).value.trim(),
        sections: U.$$('[data-dp-mail-section]:checked', root).map((el) => el.dataset.dpMailSection),
        channel: U.$('#dp2-email-channel', root).value,
        basis: U.$('#dp2-email-basis', root).value,
        priority: U.$('#dp2-email-priority', root).value,
        maxRows: Number(U.$('#dp2-email-rows', root).value),
        kind: kindEl.value,
        hour: Number(U.$('#dp2-email-hour', root).value),
        weekday: Number(U.$('#dp2-email-weekday', root).value),
        day: Number(U.$('#dp2-email-day', root).value)
      });
      const statusEl = U.$('#dp2-email-status', root);
      const saveBtn = U.$('#dp2-email-save', root);
      saveBtn.addEventListener('click', async () => {
        U.setButtonBusy(saveBtn, true, 'Saving…');
        try {
          const out = await FF.auth.api('/api/settings', 'PUT', { settings: { dispatchEmail: readMailForm() } });
          if (out.settings) FF.auth.applySettings(out.settings);
          const enabled = U.$('#dp2-email-enabled', root).checked;
          const badgeEl = U.$('.card-head .badge', U.$('#dp2-mail-card', root));
          if (badgeEl) { badgeEl.className = `badge ${enabled ? 'green' : 'gray'}`; badgeEl.textContent = enabled ? 'SCHEDULE ON' : 'SCHEDULE OFF'; }
          if (statusEl) statusEl.textContent = enabled ? 'Schedule saved · recurring delivery is ON.' : 'Schedule saved · recurring delivery is OFF.';
          U.toast('📧 Dispatch email schedule saved ✓', 'ok');
        } catch (err) { if (statusEl) statusEl.textContent = err.message; U.toast(err.message, 'err'); }
        finally { U.setButtonBusy(saveBtn, false); }
      });
      const sendBtn = U.$('#dp2-email-send', root);
      sendBtn.addEventListener('click', async () => {
        U.setButtonBusy(sendBtn, true, 'Sending…');
        try {
          const out = await FF.auth.api('/api/dispatch-email/test', 'POST', { schedule: readMailForm() });
          const detail = out.detail || {};
          if (statusEl) statusEl.textContent = `Sent to ${detail.recipients || 0} recipient(s) · ${detail.agents || 0} agent(s) · ${detail.provider || 'email provider'}.`;
          U.toast(`📨 Dispatch plan email sent · ${detail.provider || 'provider'} ✓`, 'ok');
        } catch (err) { if (statusEl) statusEl.textContent = err.message; U.toast(err.message, 'err'); }
        finally { U.setButtonBusy(sendBtn, false); }
      });
    }

    const agents = collectAgents();
    const allTls = collectTls(agents);
    const days = U.suggestDays(), el = U.runRateDays();
    U.$('#dp2-formula', root).innerHTML = `<span><b>Run-rate</b> = issue ÷ (aaj − 1) = <em>${fmt(el)} din</em></span><span><b>Required</b> = run-rate × <em>${fmt(days)} din</em></span><span><b>WITH stock</b> = Required − stock</span><span><b>W/O stock</b> = Required</span><a href="#/settings" title="Kitne din — Settings → Alert modify">⚙️ ${fmt(days)} din</a>`;

    const tlNames = () => [...new Set(agents.filter((a) => !a.direct && a.tl && (state.ch === 'all' || a.ch === state.ch)).map((a) => a.tl))].sort((a, b) => a.localeCompare(b));
    U.$('#dp2-body', root).innerHTML = `
      <section class="dp2-panel">
        <div class="dp2-tabs" id="dp2-tabs"></div>
        <div id="dp2-chips" class="dp2-chips"></div>
        <div class="dp2-search"><span>🔎</span><input class="input" id="dp2-q" placeholder="Agent / TL / ID search…" value="${esc(state.q)}"><label>TL <select class="select" id="dp2-tl"></select></label><button class="btn small" id="dp2-clear">✕ Clear</button></div>
      </section>
      <div id="dp2-kpis" class="dp2-kpis"></div>
      <section class="card dp2-card"><div class="card-head"><h3 id="dp2-title"></h3><span class="dim small" id="dp2-sub"></span></div><div id="dp2-table"></div></section>
      <p class="foot-note">Direct agents (GV: TL ID + TL Name khaali · FF: TL Name APS) ko stock nahi jaata — unki qty <b>tags</b> me hai (High/Medium ko chahiye). Row / TL naam / KPI par click karo → drawer.</p>`;

    const ctx = { byUid: new Map(), allTls, list: [], view: state.view, calc: (list) => list.map((r) => withCalc(r, state.basis)) };
    [...agents, ...allTls].forEach((r) => ctx.byUid.set(r.uid, r));

    function currentRows() {
      const src = state.view === 'tls' ? allTls : agents;
      const all = src.map((r) => withCalc(r, state.basis));
      all.forEach((r) => ctx.byUid.set(r.uid, r));   // calc-wale row drawer/summary me bhi chalein
      return all;
    }
    function drawTabs() {
      U.$('#dp2-tabs', root).innerHTML = [['agents', '🧑‍💼 Agent-wise'], ['tls', '👥 TL-wise']].map(([k, l]) => `<button class="dp2-tab ${state.view === k ? 'on' : ''}" data-dp-view="${k}">${l}</button>`).join('');
    }
    function drawTlSelect() {
      const sel = U.$('#dp2-tl', root);
      const names = tlNames();
      if (state.tl && !names.some((t) => norm(t) === norm(state.tl))) state.tl = '';
      sel.innerHTML = `<option value="">All TLs (${fmt(names.length)})</option>${names.map((t) => `<option value="${esc(t)}" ${norm(t) === norm(state.tl) ? 'selected' : ''}>${esc(t)}</option>`).join('')}`;
    }
    function drawResults() {
      const all = currentRows();
      ctx.view = state.view;
      U.$('#dp2-chips', root).innerHTML = chipsHtml(all);
      const filtered = all.filter((r) => passes(r));
      const sorted = sortRows(filtered, state.sort[state.view]);
      ctx.list = sorted;
      const t = agg(sorted);
      U.$('#dp2-kpis', root).innerHTML = kpiHtml(t, state.view);
      U.$('#dp2-title', root).textContent = state.view === 'tls' ? '👥 TL-wise dispatch' : '🧑‍💼 Agent-wise dispatch';
      U.$('#dp2-sub', root).textContent = `${fmt(sorted.length)} ${state.view === 'tls' ? 'TLs' : 'agents'} · ${BASIS[state.basis]} · sorted by ${state.sort[state.view].key} ${state.sort[state.view].dir}`;
      U.$('#dp2-table', root).innerHTML = tableHtml(sorted, state.view);
      if (FF.app && FF.app.translateDom) { try { FF.app.translateDom(root); } catch { /* optional */ } }
    }
    const redraw = () => { drawTabs(); drawTlSelect(); drawResults(); };
    redraw();

    // --- events (root par ek hi listener)
    root.addEventListener('click', (e) => {
      const f = e.target.closest('[data-dp-f]');
      if (f) { const [dim, val] = f.dataset.dpF.split(':'); state[dim] = state[dim] === val && dim !== 'basis' && val !== 'all' ? 'all' : val; state.limit = 100; if (dim === 'ch') state.tl = ''; redraw(); return; }
      const tab = e.target.closest('[data-dp-view]');
      if (tab) { state.view = tab.dataset.dpView; state.limit = 100; if (state.view === 'tls') state.tl = ''; redraw(); return; }
      const sortTh = e.target.closest('[data-dp-sort]');
      if (sortTh) {
        const s = state.sort[state.view], k = sortTh.dataset.dpSort;
        if (s.key === k) s.dir = s.dir === 'asc' ? 'desc' : 'asc'; else { s.key = k; s.dir = ['name', 'tl', 'prio', 'cover'].includes(k) ? 'asc' : 'desc'; }
        drawResults(); return;
      }
      if (e.target.closest('[data-dp-more]')) { state.limit += 200; drawResults(); return; }
      const kpi = e.target.closest('[data-dp-kpi]');
      if (kpi) { summaryDrawer(kpi.dataset.dpKpi, ctx); return; }
      const tl = e.target.closest('[data-dp-tl]');
      if (tl) { e.stopPropagation(); openTl(tl.dataset.dpTl, ctx); return; }
      const row = e.target.closest('[data-dp-open]');
      if (row) openRow(row.dataset.dpOpen, ctx);
    });
    const q = U.$('#dp2-q', root);
    q.addEventListener('input', U.debounce(() => { state.q = q.value; state.limit = 100; drawResults(); }, 180));
    U.$('#dp2-tl', root).addEventListener('change', (e) => { state.tl = e.target.value; state.limit = 100; drawResults(); });
    U.$('#dp2-clear', root).addEventListener('click', () => { Object.assign(state, { ch: 'all', type: 'all', prio: 'all', need: 'all', tl: '', q: '', limit: 100 }); q.value = ''; redraw(); });

    const list = () => ctx.list;
    U.$('#dp2-csv', root).addEventListener('click', () => { U.downloadCsv(`dispatch-planner-${state.view}-${U.stamp()}.csv`, CSV_HEAD(state.view), list().map((r) => csvRow(r, state.view))); U.toast('Dispatch CSV ready', 'ok'); });
    U.$('#dp2-xlsx', root).addEventListener('click', () => {
      const v = state.view;
      const other = v === 'agents' ? 'tls' : 'agents';
      FF.xlsx.download(`dispatch-planner-${U.stamp()}.xlsx`, [
        { name: v === 'tls' ? 'TL-wise' : 'Agent-wise', header: CSV_HEAD(v), rows: list().map((r) => csvRow(r, v)) },
        { name: other === 'tls' ? 'TL-wise (all)' : 'Agent-wise (all)', header: CSV_HEAD(other), rows: sortRows((other === 'tls' ? allTls : agents).map((r) => withCalc(r, state.basis)).filter((r) => passes(r)), { key: 'net', dir: 'desc' }).map((r) => csvRow(r, other)) }
      ]);
      U.toast('Dispatch Excel ready', 'ok');
    });
    U.$('#dp2-wa', root).addEventListener('click', () => { if (FF.app && FF.app.shareWhatsApp) FF.app.shareWhatsApp(waText(list(), state.view)); });
    return { agents: agents.length, tls: allTls.length };
  }

  FF.dispatchPlanner = { collectAgents, collectTls, withCalc, agg, state, prioOf, passes, sortRows, columns, tableHtml, chipsHtml, kpiHtml };
  FF.pages.dispatchPlan = { title: 'Dispatch Planner', render };
})(window.FF);
