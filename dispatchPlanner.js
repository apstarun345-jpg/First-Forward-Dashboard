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
  // v3.18 — MULTIPLE SELECTION: ch / type / prio / need ab Sets hain. Khaali set = "All" (koi rok nahi),
  // isliye ek saath 2+ channels / priorities / needs choose ho sakte hain. Purane string values
  // (state.ch = 'ff' jaisa) bhi kaam karte hain — U.asValueSet normalise kar deta hai.
  const LS_STATE = 'ff-dispatch-planner-state';
  const emptySet = () => new Set();
  const state = {
    view: 'agents', ch: emptySet(), type: emptySet(), prio: emptySet(), basis: 'total', need: emptySet(),
    tl: [], q: '', limit: 100,
    sort: { agents: { key: 'net', dir: 'desc' }, tls: { key: 'net', dir: 'desc' } }
  };
  // Row multi-select — ticked agents/TLs (uid) for bulk WhatsApp / CSV / Excel / summary.
  const picked = new Set();
  const FILTER_KEYS = ['view', 'ch', 'type', 'prio', 'basis', 'need', 'tl', 'q'];
  const SET_DIMS = ['ch', 'type', 'prio', 'need'];

  /** Remember the chosen filters so the planner looks the same on the next visit. */
  function saveState() {
    try {
      localStorage.setItem(LS_STATE, JSON.stringify({
        view: state.view, ch: [...U.asValueSet(state.ch)], type: [...U.asValueSet(state.type)],
        prio: [...U.asValueSet(state.prio)], need: [...U.asValueSet(state.need)],
        basis: state.basis, tl: [...U.asValueSet(state.tl)], q: state.q
      }));
    } catch { /* private mode */ }
  }
  function loadState() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(LS_STATE) || 'null'); } catch { s = null; }
    if (!s || typeof s !== 'object') return;
    SET_DIMS.forEach((k) => { state[k] = U.asValueSet(s[k]); });
    state.tl = [...U.asValueSet(s.tl)];
    if (['agents', 'tls'].includes(s.view)) state.view = s.view;
    if (['total', 'vc4', 'comm'].includes(s.basis)) state.basis = s.basis;
    if (typeof s.q === 'string') state.q = s.q;
  }

  // ---- data ---------------------------------------------------------------------------------------------
  const gvOn = () => !!(FF.gv && (FF.gv.enabled ? FF.gv.enabled() : true));
  const trio = (vc4, comm, total) => ({ vc4: n0(vc4), comm: n0(comm), total: n0(total) || n0(vc4) + n0(comm) });

  async function loadSources() {
    const jobs = [];
    if (FF.pages.performance && FF.pages.performance.ensureLoaded) jobs.push(safe(() => FF.pages.performance.ensureLoaded()));
    if (FF.store && FF.store.need) {
      jobs.push(safe(() => FF.store.need('daily')));
      jobs.push(safe(() => FF.store.need('agentClass')));
    }
    if (gvOn() && FF.gv.need) jobs.push(safe(() => FF.gv.need('report')));
    await Promise.all(jobs);
  }

  /** EIR GV rollup used by dispatch; GV REPORT contributes stock/priority only. */
  function gvEirRollups() {
    const G = FF.gv;
    const empty = { cur: new Map(), last: new Map(), ready: false };
    if (!G || typeof G.issuanceRows !== 'function') return empty;
    const daily = FF.store && FF.store.get ? FF.store.get('daily') : undefined;
    const ready = Array.isArray(daily);
    const rows = G.issuanceRows() || [];
    if (!ready) return { ...empty, ready: false };
    const latest = typeof G.latestDate === 'function' ? G.latestDate() : null;
    const curYm = latest ? U.ymKey(latest) : U.ymKey(new Date());
    const lastYm = U.prevMonthKey(curYm);
    const make = () => new Map();
    const cur = make(), last = make();
    const add = (map, r) => {
      const key = clean(r.agentId) ? `id:${norm(r.agentId)}` : `name:${norm(r.agentName)}`;
      if (!key) return;
      const a = map.get(key) || { total: 0, vc4: 0, comm: 0, vc20: 0, vc5p: 0 };
      const n = Number(r.n) || 1;
      a.total += n;
      if (r.group === 'VC4') a.vc4 += n;
      else { a.comm += n; if (r.group === 'VC20') a.vc20 += n; else a.vc5p += n; }
      map.set(key, a);
      const nameKey = `name:${norm(r.agentName)}`;
      if (nameKey !== key) map.set(nameKey, a);
    };
    rows.forEach((r) => { if (r.ym === curYm) add(cur, r); else if (r.ym === lastYm) add(last, r); });
    return { cur, last, ready: true };
  }
  const gvEirKey = (r) => clean(r.agentId) ? `id:${norm(r.agentId)}` : `name:${norm(r.agentName)}`;

  /** Sab agents (FF EIR + GV REPORT operational fields) ek hi shape me. */
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
      const eir = gvEirRollups();
      const findEir = (map, r) => map.get(gvEirKey(r)) || map.get(`name:${norm(r.agentName)}`) || null;
      gv.forEach((r) => {
        const direct = !!FF.config.isDirectAgent(r, 'gv');
        const current = findEir(eir.cur, r), previous = findEir(eir.last, r);
        // In a real load, an empty EIR result is a real zero—not permission to resurrect REPORT
        // issuance. The fallback is only for isolated legacy adapters/tests that never loaded daily.
        const cur = eir.ready ? trio(current?.vc4, current?.comm, current?.total) : trio(r.curVc4, r.curComm, r.curTotal);
        const last = eir.ready ? trio(previous?.vc4, previous?.comm, previous?.total) : trio(r.lastVc4, r.lastComm, r.lastTotal);
        out.push({
          kind: 'agent', ch: 'gv', name: clean(r.agentName || r.agentId), id: clean(r.agentId),
          tl: direct ? '' : clean(r.tlName), tlId: clean(r.tlId), direct,
          directLabel: direct ? FF.config.directLabel(r, 'gv') : '', priority: prioOf(r.priority), status: clean(r.agentStatus),
          cur, last, stock: trio(r.stockVc4, r.stockComm, r.stockTotal),
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
  // Har DIM ek value par test karta hai; `passes` set ke kisi bhi value par OR kar deta hai
  // (multi-select). Khaali set = sab pass.
  const DIMS = {
    ch: (r, v) => v === 'all' || r.ch === v,
    type: (r, v) => v === 'all' || (v === 'direct' ? r.direct : !r.direct),
    prio: (r, v) => v === 'all' || (v === 'other' ? !KNOWN_PRIORITIES.has(r.priority) : r.priority === v),
    need: (r, v) => v === 'all' || (v === 'need' ? !r.direct && r.net > 0 : v === 'low' ? r.cover != null && r.cover < 7 : v === 'zero' ? r.stockV <= 0 : true),
    tl: (r, v) => !v || (r.kind === 'tl' ? norm(r.name) === norm(v) : norm(r.tl) === norm(v)),
    q: (r, v) => { const q = clean(v).toLowerCase(); return !q || [r.name, r.id, r.tl, r.directLabel, r.ch === 'gv' ? 'gv' : 'ff first forward', r.priority].join(' ').toLowerCase().includes(q); }
  };
  /** Multi-select aware filter test. `skip` = ek dim mat lagao (chip counters ke liye). */
  const passes = (r, skip) => Object.keys(DIMS).every((k) => {
    if (k === skip) return true;
    if (k === 'tl') return [...U.asValueSet(state.tl)].some((v) => DIMS.tl(r, v)) || U.asValueSet(state.tl).size === 0;
    const set = U.asValueSet(state[k]);
    if (!set.size) return true;                       // khaali = All
    return [...set].some((v) => DIMS[k](r, v));        // koi bhi chosen value match kare
  });
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
    return `<thead><tr><th class="dp2-pick"><input type="checkbox" data-dp-pick-all title="Visible rows select karo" aria-label="Select visible rows"></th><th class="dp2-idx">#</th>${columns(view).map((c) => {
      const on = c.k && s.key === c.k;
      return `<th class="${c.num ? 'num ' : ''}${c.k ? 'dp2-sort ' : ''}${on ? 'on ' : ''}${c.hot ? `hot${c.hot}` : ''}" ${c.k ? `data-dp-sort="${c.k}"` : ''}><span>${esc(c.t)}${c.k ? `<i>${on ? (s.dir === 'asc' ? '▲' : '▼') : '↕'}</i>` : ''}</span>${c.sub ? `<small>${esc(c.sub)}</small>` : ''}</th>`;
    }).join('')}</tr></thead>`;
  }
  function rowHtml(r, i, view) {
    const tlCell = r.direct ? typeLabel(r) : r.tl ? `<a class="dp2-tl" data-dp-tl="${esc(r.ch)}|${esc(r.tl)}" title="TL ka poora summary">${esc(r.tl)}</a>` : '<span class="dim">—</span>';
    const nameCell = `<div class="dp2-name"><b>${esc(r.name)}</b><small>${chBadge(r.ch)}${r.id ? ` <span>${esc(r.id)}</span>` : ''}${r.direct && view === 'tls' ? ` <span class="direct-chip">🚫 direct</span>` : ''}</small></div>`;
    const on = picked.has(r.uid);
    return `<tr class="dp2-row ${r.direct ? 'is-direct' : ''} ${r.cover != null && r.cover < 7 && !r.direct ? 'is-low' : ''} ${on ? 'is-picked' : ''}" data-dp-open="${r.uid}">
      <td class="dp2-pick"><input type="checkbox" data-dp-pick="${r.uid}" ${on ? 'checked' : ''} aria-label="Select ${esc(r.name)}"></td><td class="dp2-idx">${i + 1}</td><td>${nameCell}</td>${view === 'tls' ? `<td class="num">${fmt(r.agents)}</td>` : `<td>${tlCell}</td>`}<td>${prioBadge(r.priority)}</td>
      <td class="num">${fmt(r.lastV)}</td><td class="num"><b>${fmt(r.curV)}</b>${growthChip(r.c.growth)}</td><td class="num">${fmt(r.rate, true)}</td><td class="num">${fmt(r.required)}</td><td class="num">${fmt(r.stockV)}</td>
      <td class="num dp2-hot1"><b>${fmt(r.net)}</b></td><td class="num dp2-hot2"><b>${fmt(r.gross)}</b></td><td class="num">${coverCell(r.cover)}</td>
      <td><span class="dp2-act ${r.action.cls}">${r.action.t}</span></td></tr>`;
  }
  function tableHtml(list, view) {
    const shown = list.slice(0, state.limit);
    const t = agg(list);
    const label = view === 'tls' ? 'TLs' : 'agents';
    const foot = list.length ? `<tfoot><tr class="row-total"><td></td><td></td><td colspan="${view === 'tls' ? 1 : 1}">Total · ${fmt(list.length)} ${label}</td><td class="num">${view === 'tls' ? fmt(U.sum(list, (r) => r.agents)) : ''}</td><td></td><td class="num">${fmt(t.last)}</td><td class="num">${fmt(t.cur)}</td><td class="num">${fmt(t.rate, true)}</td><td class="num">${fmt(t.required)}</td><td class="num">${fmt(t.stock)}</td><td class="num dp2-hot1">${fmt(t.net)}</td><td class="num dp2-hot2">${fmt(t.gross)}</td><td class="num">${coverCell(t.cover)}</td><td></td></tr></tfoot>` : '';
    const body = shown.map((r, i) => rowHtml(r, i, view)).join('') || `<tr><td colspan="15"><div class="empty-state">Is filter par koi ${label === 'TLs' ? 'TL' : 'agent'} nahi mila<br><span class="dim small">Filters clear karke dekho</span></div></td></tr>`;
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

  // ---- filter chips (MULTIPLE SELECTION) ---------------------------------------------------------------
  // Ek saath kai values ON ho sakti hain — "All" pill poora set clear kar deta hai.
  const FILTER_OPTIONS = {
    ch: { label: 'Channel', icon: '🌐', all: '🌐 Both', opts: [['ff', '🟦 First Forward', 'ff'], ['gv', '🟩 GV Partner', 'gv']] },
    type: { label: 'Type', icon: '👥', all: '👥 All', opts: [['managed', '🧑‍💼 TL-managed', ''], ['direct', '🚫 Direct agents', 'violet']] },
    prio: { label: 'Priority', icon: '🎚️', all: 'All', opts: [['High', '🔴 High', 'red'], ['Medium', '🟠 Medium', 'amber'], ['Low', '🟢 Low', 'green'], ['other', '📄 Other / source', 'gray']] },
    basis: { label: 'Tags', icon: '🏷️', all: '🏷️ All tags', opts: [['vc4', '🚗 VC4', ''], ['comm', '🚛 Commercial', '']], single: true },
    need: { label: 'Need', icon: '🚚', all: 'All', opts: [['need', '🚚 Dispatch chahiye', ''], ['low', '🚨 Cover < 7 din', 'red'], ['zero', '0 stock', '']] }
  };
  function chipsHtml(all) {
    const grp = (dim) => {
      const def = FILTER_OPTIONS[dim];
      const set = dim === 'basis' ? U.asValueSet(state.basis === 'total' ? '' : state.basis) : U.asValueSet(state[dim]);
      const items = def.opts.map(([v, text, cls]) => {
        // 'basis' (All tags / VC4 / Commercial) single-select hai — uska count nahi dikhate.
        const n = def.single ? null : all.filter((r) => passes(r, dim) && DIMS[dim](r, v)).length;
        const on = set.has(v);
        return `<button type="button" class="dp2-pill ${cls || ''} ${on ? 'on' : ''}" data-dp-f="${dim}:${v}" aria-pressed="${on ? 'true' : 'false'}" title="${def.single ? '' : (on ? 'Click to remove' : 'Click to add') + ' — multiple select ho sakta hai'}">${text}${n == null ? '' : ` <b>${fmt(n)}</b>`}</button>`;
      }).join('');
      const allOn = !set.size;
      const allPill = def.single
        ? `<button type="button" class="dp2-pill ${allOn ? 'on' : ''}" data-dp-f="${dim}:all" aria-pressed="${allOn ? 'true' : 'false'}" title="Poore ${def.label} par wapas jao">${def.all}</button>`
        : `<button type="button" class="dp2-pill ${allOn ? 'on' : ''}" data-dp-f="${dim}:all" aria-pressed="${allOn ? 'true' : 'false'}" title="Poora ${def.label} filter hatao">${def.all} <b>${fmt(all.filter((r) => passes(r, dim)).length)}</b></button>`;
      const multi = !def.single && set.size > 1 ? `<span class="dp2-multi" title="${esc([...set].join(' + '))}">+${set.size} selected</span>` : '';
      return `<div class="dp2-grp"><span class="dp2-lbl">${def.label}${multi}</span><div class="dp2-pills">${allPill}${items}</div></div>`;
    };
    return Object.keys(FILTER_OPTIONS).map(grp).join('');
  }
  /** Filter chips ke liye option list (multiSelect popover ke liye bhi yahi use hota hai). */
  function filterOptions(dim, all) {
    const def = FILTER_OPTIONS[dim];
    if (!def || def.single || typeof DIMS[dim] !== 'function') return [];
    return def.opts.map(([v, text, cls]) => ({ value: v, label: text, cls, count: all.filter((r) => passes(r, dim) && DIMS[dim](r, v)).length }));
  }

  // ---- export / share -----------------------------------------------------------------------------------
  const CSV_HEAD = (view) => [view === 'tls' ? 'TL' : 'Agent', 'ID', 'Channel', 'Type', view === 'tls' ? 'Agents' : 'TL', 'Priority', 'Last month', 'This month', 'Run-rate / day', `Required (× ${U.suggestDays()} din)`, 'Stock', 'Dispatch WITH stock', 'Dispatch W/O stock', 'Cover (din)', 'Status'];
  const csvRow = (r, view) => [r.name, r.id, CH[r.ch].label, r.direct ? 'Direct' : 'TL-managed', view === 'tls' ? r.agents : (r.direct ? r.directLabel : r.tl), r.priority, r.lastV, r.curV, Number(r.rate.toFixed(2)), r.required, r.stockV, r.net, r.gross, r.cover == null ? '' : Number(r.cover.toFixed(1)), r.action.t.replace(/^\S+\s/, '')];
  /** Channel filter ka readable label — multi-select ke saath "First Forward + GV Partner". */
  function channelLabel() {
    const set = U.asValueSet(state.ch);
    if (!set.size) return 'FF + GV';
    return [...set].map((v) => (CH[v] || {}).label || v).join(' + ');
  }
  function waText(list, view) {
    const t = agg(list);
    const lines = [`*🚚 Dispatch plan · ${U.suggestDays()} din* (${new Date().toLocaleDateString('en-IN')})`,
      `${channelLabel()} · ${BASIS[state.basis]} · ${fmt(t.count)} ${view === 'tls' ? 'TLs' : 'agents'}`,
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
    const body = openDrawer({ kicker: `🚚 Dispatch Planner · ${view === 'tls' ? 'TL-wise' : 'Agent-wise'} summary`, title: `${icon} ${title}`, sub: esc(`${channelLabel()} · ${BASIS[state.basis]} · run-rate = issue ÷ ${el} din · required = run-rate × ${days} din`), body: '<div id="dp2-drawer-slot"></div>', actions: '' });
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

  /** ✅ Multi-select ka summary drawer — jo rows tick kiye unka combined plan. */
  function selectionDrawer(rows, ctx) {
    if (!rows || !rows.length) return;
    const t = agg(rows);
    const days = U.suggestDays(), el = U.runRateDays();
    const boxes = Math.ceil(t.net / Math.max(1, Number((FF.config.dispatch || {}).tagsPerBox) || 25));
    const body = openDrawer({
      kicker: '🚚 Dispatch Planner · selected rows', title: `✅ ${fmt(rows.length)} selected`,
      sub: esc(`${channelLabel()} · ${BASIS[state.basis]} · run-rate = issue ÷ ${el} din · required = run-rate × ${days} din`),
      body: '<div id="dp2-drawer-slot"></div>', actions: ''
    });
    if (!body) return;
    const slot = U.$('#dp2-drawer-slot', body) || body;
    const needy = sortRows(rows.filter((r) => !r.direct && r.net > 0), { key: 'net', dir: 'desc' });
    slot.innerHTML = `<div class="mp"><div class="mp-kpis">
      <div class="mp-kpi k1"><small>Rows selected</small><b>${fmt(t.count)}</b><em>${fmt(t.ff)} FF · ${fmt(t.gv)} GV</em></div>
      <div class="mp-kpi k2"><small>This month</small><b>${fmt(t.cur)}</b><em>last ${fmt(t.last)} ${t.growth == null ? '' : U.pctHtml(t.growth)}</em></div>
      <div class="mp-kpi k3"><small>Run-rate / day</small><b>${fmt(t.rate, true)}</b><em>÷ ${fmt(el)} din</em></div>
      <div class="mp-kpi k4"><small>Required · ${fmt(days)} din</small><b>${fmt(t.required)}</b><em>stock ${fmt(t.stock)}</em></div>
      <div class="mp-kpi k5"><small>WITH stock</small><b>${fmt(t.net)}</b><em>≈ ${fmt(boxes)} box</em></div>
      <div class="mp-kpi k6"><small>W/O stock</small><b>${fmt(t.gross)}</b><em>cover ${t.cover == null ? '—' : `${fmt(t.cover, true)} din`}</em></div></div>
      ${aggTable('🌐 Channel-wise', [['🟦 First Forward', rows.filter((r) => r.ch === 'ff')], ['🟩 GV Partner', rows.filter((r) => r.ch === 'gv')], ['Total', rows]])}
      ${aggTable('🧑‍💼 Type', [['TL-managed', rows.filter((r) => !r.direct)], ['Direct agents (tags only)', rows.filter((r) => r.direct)]])}
      ${topTable(`🚚 Dispatch list · ${fmt(needy.length)} ko chahiye`, needy.slice(0, 200), [['This month', (x) => fmt(x.curV)], ['Run-rate', (x) => fmt(x.rate, true)], ['Stock', (x) => fmt(x.stockV)], ['WITH stock', (x) => `<b class="sug-chip">${fmt(x.net)}</b>`], ['W/O stock', (x) => fmt(x.gross)], ['Cover', (x) => coverCell(x.cover)]])}</div>`;
    bindDrawer(body, ctx);
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
    loadState();                       // pichli baar ke filters (multi-select) wapas lao
    // URL / assistant se aaye params
    const legacy = { channel: 'ch', pool: '' };
    const incoming = {};
    FILTER_KEYS.forEach((k) => { if (params[k] !== undefined && params[k] !== '') incoming[k] = params[k]; });
    if (params.channel && ['ff', 'gv', 'all'].includes(params.channel)) incoming.ch = params.channel;
    if (params.pool === 'direct') incoming.type = 'direct';
    if (params.priority) incoming.prio = params.priority;
    if (Object.keys(incoming).length) {
      // URL/assistant params string ya comma-separated list ho sakte hain — Set bana do.
      const toSet = (v) => (typeof v === 'string' ? U.asValueSet(v.split(/[,+]/)) : U.asValueSet(v));
      SET_DIMS.forEach((k) => { if (incoming[k] !== undefined) incoming[k] = toSet(incoming[k]); });
      if (incoming.tl !== undefined) incoming.tl = [...toSet(incoming.tl)];
      Object.assign(state, incoming, { limit: 100 });
    }
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
          <label class="fld"><span>Channel <small>(multiple select)</small></span><button type="button" class="btn small" id="dp2-email-channel">🌐 Both channels</button></label>
          <label class="fld"><span>Tag basis</span><select class="select" id="dp2-email-basis">${opt('total', 'All tags', savedMail.basis || 'total')}${opt('vc4', 'VC4', savedMail.basis || 'total')}${opt('comm', 'Commercial', savedMail.basis || 'total')}</select></label>
          <label class="fld"><span>Priority filter <small>(multiple select)</small></span><button type="button" class="btn small" id="dp2-email-priority">🎚️ All priorities</button></label>
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
        channel: mailChannel.length ? mailChannel.join(',') : 'all',
        basis: U.$('#dp2-email-basis', root).value,
        priority: mailPriority.length ? mailPriority.join(',') : 'all',
        maxRows: Number(U.$('#dp2-email-rows', root).value),
        kind: kindEl.value,
        hour: Number(U.$('#dp2-email-hour', root).value),
        weekday: Number(U.$('#dp2-email-weekday', root).value),
        day: Number(U.$('#dp2-email-day', root).value)
      });
      // 🔠 multiple selection — ek saath kai channel / priority email me bheje ja sakte hain.
      const splitList = (v) => String(v || '').split(/[,+]/).map((x) => x.trim()).filter((x) => x && x !== 'all');
      let mailChannel = splitList(savedMail.channel);
      let mailPriority = splitList(savedMail.priority);
      U.multiSelect(U.$('#dp2-email-channel', root), {
        title: 'Channel', icon: '🌐', allLabel: 'Both channels', noneLabel: 'Clear', searchable: false,
        options: () => [{ value: 'ff', label: '🟦 First Forward' }, { value: 'gv', label: '🟩 GV Partner' }],
        selected: () => mailChannel, onChange: (v) => { mailChannel = v; }
      });
      U.multiSelect(U.$('#dp2-email-priority', root), {
        title: 'Priority', icon: '🎚️', allLabel: 'All priorities', noneLabel: 'Clear', searchable: false,
        options: () => [{ value: 'High', label: '🔴 High' }, { value: 'Medium', label: '🟠 Medium' }, { value: 'Low', label: '🟢 Low' }, { value: 'other', label: '📄 Other / source value' }],
        selected: () => mailPriority, onChange: (v) => { mailPriority = v; }
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

    const tlNames = () => {
      const chSet = U.asValueSet(state.ch);       // live padho — channel filter multi-select hai
      return [...new Set(agents.filter((a) => !a.direct && a.tl && (!chSet.size || chSet.has(a.ch))).map((a) => a.tl))].sort((a, b) => a.localeCompare(b));
    };
    U.$('#dp2-body', root).innerHTML = `
      <section class="dp2-panel">
        <div class="dp2-tabs" id="dp2-tabs"></div>
        <div id="dp2-chips" class="dp2-chips"></div>
        <div class="dp2-search"><span>🔎</span><input class="input" id="dp2-q" placeholder="Agent / TL / ID search…" value="${esc(state.q)}">
          <button type="button" class="btn small" id="dp2-tl" title="Ek se zyada TL chuno">👥 TL</button>
          <button type="button" class="btn small" id="dp2-prio" title="Ek se zyada priority chuno">🎚️ Priority</button>
          <button type="button" class="btn small" id="dp2-need" title="Ek se zyada condition chuno">🚚 Need</button>
          <button type="button" class="btn small" id="dp2-ch" title="Channel chuno">🌐 Channel</button>
          <button class="btn small" id="dp2-clear">✕ Clear</button></div>
      </section>
      <div id="dp2-selbar" class="dp2-selbar" hidden></div>
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
    // ---- 🔠 multi-select controls (TL / priority / need / channel) — ek saath kai values -------------
    const multiCtrls = {};
    function tlOptions() {
      const names = tlNames();
      const all = currentRows();
      const chosen = U.asValueSet(state.tl);
      // Jo TL ab list me nahi hai (channel badalne par) usko filter se hata do.
      [...chosen].forEach((n) => { if (!names.some((t) => norm(t) === norm(n))) chosen.delete(n); });
      state.tl = [...chosen];
      return names.map((n) => ({ value: n, label: n, count: all.filter((r) => (r.kind === 'tl' ? norm(r.name) === norm(n) : norm(r.tl) === norm(n))).length }));
    }
    function bindMulti(id, dim, title, icon, optsFn, apply) {
      const btn = U.$(id, root);
      if (!btn) return null;
      multiCtrls[id] = U.multiSelect(btn, {
        title, icon, allLabel: `All ${title}`, noneLabel: 'Clear',
        options: optsFn,
        selected: () => (dim === 'tl' ? state.tl : state[dim]),
        onChange: (vals) => { apply(vals); saveState(); state.limit = 100; drawResults(); }
      });
      return multiCtrls[id];
    }
    bindMulti('#dp2-tl', 'tl', 'TL', '👥', tlOptions, (vals) => { state.tl = vals; });
    bindMulti('#dp2-prio', 'prio', 'Priority', '🎚️', () => filterOptions('prio', currentRows()), (vals) => { state.prio = U.asValueSet(vals); });
    bindMulti('#dp2-need', 'need', 'Need', '🚚', () => filterOptions('need', currentRows()), (vals) => { state.need = U.asValueSet(vals); });
    bindMulti('#dp2-ch', 'ch', 'Channel', '🌐', () => filterOptions('ch', currentRows()), (vals) => { state.ch = U.asValueSet(vals); state.tl = []; });

    // ---- ✅ row multi-select + bulk actions -----------------------------------------------------------
    const pickedRows = () => ctx.list.filter((r) => picked.has(r.uid));
    /** Header ka "select all" box visible rows ke hisaab se sync rakho. */
    function syncPickAll() {
      const box = U.$('[data-dp-pick-all]', root);
      if (!box) return;
      const visible = ctx.list.slice(0, state.limit);
      const n = visible.filter((r) => picked.has(r.uid)).length;
      box.checked = visible.length > 0 && n === visible.length;
      box.indeterminate = n > 0 && n < visible.length;
      box.title = box.checked ? 'Sab unselect karo' : 'Visible rows select karo';
    }
    /** Ek row tick/untick — poori table dobara render mat karo (scroll position bacha rahe). */
    function paintPick(uid, on) {
      const tr = U.$(`tr[data-dp-open="${uid}"]`, root);
      if (tr) tr.classList.toggle('is-picked', !!on);
      const sub = U.$('#dp2-sub', root);
      if (sub) sub.textContent = `${fmt(ctx.list.length)} ${state.view === 'tls' ? 'TLs' : 'agents'} · ${BASIS[state.basis]} · sorted by ${state.sort[state.view].key} ${state.sort[state.view].dir}${picked.size ? ` · ${fmt(picked.size)} selected` : ''}`;
      drawSelBar();
      syncPickAll();
    }
    function drawSelBar() {
      const bar = U.$('#dp2-selbar', root);
      if (!bar) return;
      // Doosre view me chhupi hui selection mat dikhao.
      const visible = ctx.list.filter((r) => picked.has(r.uid));
      if (!visible.length) { picked.clear(); }
      if (!picked.size) { bar.hidden = true; bar.innerHTML = ''; return; }
      const rows = pickedRows();
      const t = agg(rows);
      bar.hidden = false;
      bar.innerHTML = `<span class="dp2-sel-count"><b>${fmt(picked.size)}</b> selected</span>
        <span class="dp2-sel-sum">Required <b>${fmt(t.required)}</b> · WITH stock <b>${fmt(t.net)}</b> · W/O <b>${fmt(t.gross)}</b></span>
        <span class="dp2-sel-actions">
          <button class="btn small" data-dp-sel="all">☑ Visible select</button>
          <button class="btn small" data-dp-sel="needy">🚚 Jinko dispatch chahiye</button>
          <button class="btn small" data-dp-sel="csv">⬇ CSV</button>
          <button class="btn small" data-dp-sel="xlsx">⬇ Excel</button>
          <button class="btn small" data-dp-sel="wa">📲 WhatsApp</button>
          <button class="btn small primary" data-dp-sel="sum">🧾 Summary</button>
          <button class="btn small" data-dp-sel="none">✕ Clear</button>
        </span>`;
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
      U.$('#dp2-sub', root).textContent = `${fmt(sorted.length)} ${state.view === 'tls' ? 'TLs' : 'agents'} · ${BASIS[state.basis]} · sorted by ${state.sort[state.view].key} ${state.sort[state.view].dir}${picked.size ? ` · ${fmt(picked.size)} selected` : ''}`;
      U.$('#dp2-table', root).innerHTML = tableHtml(sorted, state.view);
      drawSelBar();
      syncPickAll();
      if (FF.app && FF.app.translateDom) { try { FF.app.translateDom(root); } catch { /* optional */ } }
    }
    const refreshMulti = () => Object.values(multiCtrls).forEach((c) => { try { c.refresh(); } catch { /* detached */ } });
    const redraw = () => { drawTabs(); refreshMulti(); drawResults(); saveState(); };
    redraw();

    // --- events (root par ek hi listener)
    root.addEventListener('click', (e) => {
      const pickAll = e.target.closest('[data-dp-pick-all]');
      if (pickAll) {
        const want = pickAll.checked;
        ctx.list.slice(0, state.limit).forEach((r) => { if (want) picked.add(r.uid); else picked.delete(r.uid); });
        U.$$(`tr[data-dp-open]`, root).slice(0, state.limit).forEach((tr) => tr.classList.toggle('is-picked', picked.has(tr.dataset.dpOpen)));
        const sub = U.$('#dp2-sub', root);
        if (sub) sub.textContent = `${fmt(ctx.list.length)} ${state.view === 'tls' ? 'TLs' : 'agents'} · ${BASIS[state.basis]} · sorted by ${state.sort[state.view].key} ${state.sort[state.view].dir}${picked.size ? ` · ${fmt(picked.size)} selected` : ''}`;
        drawSelBar(); syncPickAll(); return;
      }
      const pickOne = e.target.closest('[data-dp-pick]');
      if (pickOne) {
        e.stopPropagation();
        const uid = pickOne.dataset.dpPick;
        if (pickOne.checked) picked.add(uid); else picked.delete(uid);
        paintPick(uid, pickOne.checked); return;
      }
      const sel = e.target.closest('[data-dp-sel]');
      if (sel) { bulkAction(sel.dataset.dpSel, ctx); return; }
      const f = e.target.closest('[data-dp-f]');
      if (f) {
        const [dim, val] = f.dataset.dpF.split(':');
        // Tag basis single-select hai (formula badal jaata hai) — baaki sab multi-select.
        if (dim === 'basis') { state.basis = (val === 'all' || !val) ? 'total' : val; }
        else if (val === 'all') { state[dim] = U.asValueSet([]); }        // "All" pill = poora set clear
        else {                                                            // toggle — multiple selection
          const set = U.asValueSet(state[dim]);
          if (set.has(val)) set.delete(val); else set.add(val);
          state[dim] = set;
        }
        state.limit = 100;
        if (dim === 'ch') state.tl = [];
        redraw(); refreshMulti(); return;
      }
      const tab = e.target.closest('[data-dp-view]');
      if (tab) { state.view = tab.dataset.dpView; state.limit = 100; if (state.view === 'tls') state.tl = []; picked.clear(); redraw(); refreshMulti(); return; }
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
    q.addEventListener('input', U.debounce(() => { state.q = q.value; state.limit = 100; drawResults(); saveState(); }, 180));
    U.$('#dp2-clear', root).addEventListener('click', () => {
      Object.assign(state, { ch: U.asValueSet([]), type: U.asValueSet([]), prio: U.asValueSet([]), need: U.asValueSet([]), tl: [], q: '', limit: 100 });
      picked.clear(); q.value = ''; redraw(); refreshMulti();
    });

    // ---- ✅ bulk actions on the selected rows --------------------------------------------------------
    function bulkAction(act, context) {
      const rows = pickedRows();
      if (act === 'none') { picked.clear(); drawResults(); return; }
      if (!rows.length) { U.toast('Pehle row select karo (☑)', 'warn'); return; }
      if (act === 'all') { ctx.list.slice(0, state.limit).forEach((r) => picked.add(r.uid)); drawResults(); U.toast(`${fmt(picked.size)} rows selected`, 'ok'); return; }
      if (act === 'needy') {
        picked.clear();
        ctx.list.forEach((r) => { if (!r.direct && r.net > 0) picked.add(r.uid); });
        drawResults();
        U.toast(picked.size ? `${fmt(picked.size)} rows jinhe dispatch chahiye selected` : 'Is view me kisi ko dispatch nahi chahiye', picked.size ? 'ok' : 'warn');
        return;
      }
      if (act === 'csv') { U.downloadCsv(`dispatch-selection-${state.view}-${U.stamp()}.csv`, CSV_HEAD(state.view), rows.map((r) => csvRow(r, state.view))); U.toast(`${fmt(rows.length)} selected rows → CSV`, 'ok'); return; }
      if (act === 'xlsx') {
        FF.xlsx.download(`dispatch-selection-${U.stamp()}.xlsx`, [{ name: state.view === 'tls' ? 'Selected TLs' : 'Selected agents', header: CSV_HEAD(state.view), rows: rows.map((r) => csvRow(r, state.view)) }]);
        U.toast(`${fmt(rows.length)} selected rows → Excel`, 'ok'); return;
      }
      if (act === 'wa') { if (FF.app && FF.app.shareWhatsApp) FF.app.shareWhatsApp(waText(rows, state.view)); return; }
      if (act === 'sum') { selectionDrawer(rows, context); }
    }

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

  FF.dispatchPlanner = {
    collectAgents, collectTls, withCalc, agg, state, prioOf, passes, sortRows, columns, tableHtml, chipsHtml, kpiHtml,
    // v3.18 — multiple selection
    filterOptions, channelLabel, FILTER_OPTIONS,
    get picked() { return picked; }, get pickedCount() { return picked.size; },
    togglePick(uid) { if (picked.has(uid)) picked.delete(uid); else picked.add(uid); return picked.has(uid); },
    clearPicks() { picked.clear(); },
    saveState, loadState
  };
  FF.pages.dispatchPlan = { title: 'Dispatch Planner', render };
})(window.FF);
