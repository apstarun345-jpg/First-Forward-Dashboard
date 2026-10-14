/* 📦 PROFILE STOCK — "Stock & dispatch" tab ke andar stock-health block (TL + agent, FF + GV dono).
     • TL profile   : 8 clickable boxes (total stock · stock required · out of stock · high stock · dead stock ·
                      excess tags · balanced · team cover) — click par wahi agents ki list (sort + CSV).
     • TL profile   : Top 10 — high stock · stock required · dead stock.
     • Agent profile: 4 boxes (status · stock split · cover days · required / excess).
     • TL profile   : health bar (balanced / high / required / dead) + ♻️ Rebalance plan (excess tags → short agents) with CSV.
     • Dono me      : "Stock vs need" chart — ALL classes (VC4 · VC5 · VC6 … share bar + bullet rows) aur TL me agent-wise
                      bullet bars (bar = stock, tick = N-din ka need). ⬇ Total stock CSV (agent × class) + 🏷️ tag-level drill-down.
   Rules (same as "Suggested dispatch"): need = run-rate/day × suggestDays; required = need − stock (per class);
   high stock = stock ≥ 2× need (issuance stock ke hisab se nahi); dead stock = stock hai par is month koi issuance nahi.
   Numbers profile ke agent rows (REPORT + stock + issuance) se hi aate hain — alag source nahi. UI English. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;
  const fmt = (n, d) => U.fmt(n, d);
  const num = (v) => Number(v) || 0;
  const HIGH_MULT = 2;                       // stock ≥ 2 × dispatch-window need → "high stock"
  const GROUPS = ['VC4', 'VC20', 'VC5+'];
  const VERDICT = { required: '#ef4444', high: '#f59e0b', dead: '#64748b', ok: '#10b981' };
  const norm = (s) => String(s === null || s === undefined ? '' : s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const normId = (v) => String(v === null || v === undefined ? '' : v).trim().replace(/\.0+$/, '').toUpperCase();
  const MAX_ROWS = 12;
  const REB_ROWS = 10;
  const CLS_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#a855f7', '#14b8a6', '#f97316', '#64748b', '#84cc16'];
  const clsRank = (c) => { const m = /^VC(\d+)/i.exec(String(c)); return m ? Number(m[1]) : 1000; };
  const clsSort = (a, b) => clsRank(a) - clsRank(b) || String(a).localeCompare(String(b), undefined, { numeric: true });

  // ------------------------------------------------------------------ box definitions
  const BOXES = [
    { id: 'total', label: 'Total stock', tone: 'indigo', hint: 'Every agent holding stock (TL own row included)', pick: (a) => a.stock > 0 || a.isSelf },
    { id: 'required', label: 'Stock required', tone: 'red', hint: 'Stock is below the dispatch-window need — tags must be sent', pick: (a) => a.required },
    { id: 'oos', label: 'Out of stock', tone: 'rose', hint: 'Issuing tags but holding zero stock', pick: (a) => a.oos },
    { id: 'high', label: 'High stock', tone: 'amber', hint: 'Stock is 2× or more than what issuance needs', pick: (a) => a.high },
    { id: 'dead', label: 'Dead stock', tone: 'orange', hint: 'Holding stock but no issuance this month', pick: (a) => a.dead },
    { id: 'excess', label: 'Excess tags', tone: 'sky', hint: 'Tags above the dispatch-window need (can be moved to agents who are short)', pick: (a) => a.excess > 0 },
    { id: 'ok', label: 'Balanced', tone: 'green', hint: 'Stock matches issuance — nothing to do', pick: (a) => a.balanced },
    { id: 'cover', label: 'Team cover', tone: 'slate', hint: 'Agents stock ÷ team run-rate per day', pick: null }
  ];
  const BOX_BY_ID = Object.fromEntries(BOXES.map((b) => [b.id, b]));
  const SORTS = {
    name: (a, b) => a.name.localeCompare(b.name),
    stock: (a, b) => b.stock - a.stock,
    cur: (a, b) => b.cur - a.cur,
    rate: (a, b) => b.rate - a.rate,
    cover: (a, b) => (b.cover === null ? 1e9 : b.cover) - (a.cover === null ? 1e9 : a.cover),
    need: (a, b) => b.need - a.need,
    req: (a, b) => b.req - a.req,
    excess: (a, b) => b.excess - a.excess
  };
  const DEFAULT_SORT = { total: 'stock', required: 'req', oos: 'rate', high: 'excess', dead: 'stock', excess: 'excess', ok: 'stock' };

  // ------------------------------------------------------------------ analysis
  const cache = new WeakMap();
  const ui = new Map();        // per profile: { box, sort, chart }
  const keyOf = (pr) => `${pr.kind}|${norm(pr.name)}|${normId(pr.id)}`;
  const uiOf = (pr) => { const k = keyOf(pr); if (!ui.has(k)) ui.set(k, { box: '', sort: '', chart: 'stock', cls: 'stock', rebAll: false }); return ui.get(k); };
  const daysOf = (pr) => Math.max(1, num(pr.dispatch && pr.dispatch.days) || num(FF.config && FF.config.features && FF.config.features.suggestDays) || 15);

  /** One holder (agent / TL-self / the profiled agent) → stock + need + flags. */
  function holder(src, ctx, extra) {
    const sv = num(src.stockVc4), sc = num(src.stockComm);
    const stock = num(src.stockTotal) || sv + sc;
    const reliable = Math.abs(sv + sc - stock) <= 1;           // class split matches the total
    const cur = num(src.cur);
    const rate = cur / ctx.elapsed;
    const gv = num(src.sugVc4Gross), gc = num(src.sugCommGross);
    const need = reliable ? gv + gc : Math.ceil(rate * ctx.days);
    const req = reliable ? num(src.sugVc4) + num(src.sugComm) : Math.max(0, need - stock);
    const excess = reliable ? Math.max(0, sv - gv) + Math.max(0, sc - gc) : Math.max(0, stock - need);
    const cover = rate > 0 ? stock / rate : null;
    const h = Object.assign({
      name: src.name || src.agentName || 'Unknown', id: src.id || src.agentId || '', mobile: src.mobile || '', priority: src.priority || '', status: src.status || '',
      isSelf: false, stockVc4: sv, stockComm: sc, stock, cur, rate, need, req, excess, cover, reliable, classStock: src.classStock || null,
      exVc4: reliable ? Math.max(0, sv - gv) : 0, exComm: reliable ? Math.max(0, sc - gc) : 0,
      reqVc4: reliable ? num(src.sugVc4) : 0, reqComm: reliable ? num(src.sugComm) : 0,
      exAny: reliable ? 0 : excess, reqAny: reliable ? 0 : req,
      required: req > 0,
      oos: stock === 0 && rate > 0,
      dead: stock > 0 && cur === 0,
      high: stock > 0 && rate > 0 && need > 0 && stock >= HIGH_MULT * need
    }, extra || {});
    h.balanced = !h.required && !h.high && !h.dead;
    h.verdict = h.required ? 'required' : h.high ? 'high' : h.dead ? 'dead' : 'ok';
    return h;
  }

  function analyze(pr) {
    const hit = cache.get(pr);
    if (hit) return hit;
    const ch = pr.ch === 'gv' ? 'gv' : 'ff';
    const isTl = /tl$/.test(pr.kind || '');
    const days = daysOf(pr);
    const ctx = { days, elapsed: Math.max(1, Math.min(31, Number(U.runRateDays(undefined, ch)) || new Date().getDate())) };
    const out = { ch, isTl, days, elapsed: ctx.elapsed, team: [], self: null, me: null, counts: {}, sums: {} };
    if (isTl) {
      out.team = (pr.agents || []).filter((a) => a && !a.isSelf).map((a) => holder(a, ctx));
      out.self = pr.selfAgent ? holder(pr.selfAgent, ctx, { isSelf: true }) : null;
      const s = pr.stock || {}, ts = pr.tlStock || {};
      out.sums.total = num(s.total);
      out.sums.own = num((ts.own && ts.own.total) || (out.self && out.self.stock));
      out.sums.agents = num((ts.agents && ts.agents.total)) || out.team.reduce((x, a) => x + a.stock, 0);
      BOXES.forEach((b) => { if (b.pick) out.counts[b.id] = out.team.filter(b.pick).length; });
      out.counts.total = out.team.filter((a) => a.stock > 0).length;
      out.sums.req = out.team.filter((a) => a.required).reduce((x, a) => x + a.req, 0);
      out.sums.excess = out.team.reduce((x, a) => x + a.excess, 0);
      out.sums.highExcess = out.team.filter((a) => a.high).reduce((x, a) => x + a.excess, 0);
      out.sums.deadStock = out.team.filter((a) => a.dead).reduce((x, a) => x + a.stock, 0);
      const rate = out.team.reduce((x, a) => x + a.rate, 0);
      out.sums.rate = rate;
      out.sums.cover = rate > 0 ? out.sums.agents / rate : null;
    } else {
      const s = pr.stock || {}, t = pr.totals || {}, d = pr.dispatch || {};
      out.me = holder({
        name: pr.name, id: pr.id, mobile: pr.mobile, priority: pr.priority,
        stockVc4: s.vc4, stockComm: s.comm, stockTotal: s.total, cur: t.curTotal,
        sugVc4: d.sugVc4, sugComm: d.sugComm, sugVc4Gross: d.sugVc4Gross, sugCommGross: d.sugCommGross
      }, ctx);
      // Direct agents with low priority are intentionally not dispatched to.
      out.noDispatch = !!(pr.direct && !pr.tagRequired);
      if (out.noDispatch) { out.me.required = false; out.me.req = 0; out.me.balanced = !out.me.high && !out.me.dead; out.me.verdict = out.me.high ? 'high' : out.me.dead ? 'dead' : 'ok'; }
    }
    out.classRows = classRows(pr, ctx);
    out.classChart = classChart(pr, ctx);
    if (isTl) {
      out.health = { required: 0, high: 0, dead: 0, ok: 0 };
      out.team.forEach((a) => { out.health[a.verdict] += 1; });
      out.reb = rebalance(out);
    }
    cache.set(pr, out);
    return out;
  }

  /** Every tag class (VC4 · VC5 · VC6 · … · VC20) with stock, this-month issuance and the N-day need. */
  function classChart(pr, ctx) {
    const rows = (pr.classes || []).filter((r) => r && (num(r.stock) || num(r.cur) || num(r.last)));
    const total = rows.reduce((x, r) => x + num(r.stock), 0);
    return rows.map((r) => {
      const stock = num(r.stock), cur = num(r.cur), rate = cur / ctx.elapsed;
      const need = Math.ceil(rate * ctx.days);
      const verdict = need > stock ? 'required' : (stock > 0 && need > 0 && stock >= HIGH_MULT * need) ? 'high' : (stock > 0 && cur === 0) ? 'dead' : 'ok';
      return { label: String(r.cls), stock, cur, last: num(r.last), rate, need, diff: stock - need, verdict, cover: rate > 0 ? stock / rate : null, share: total ? stock / total : 0 };
    }).sort((a, b) => b.stock - a.stock || b.cur - a.cur || a.label.localeCompare(b.label, undefined, { numeric: true }));
  }

  /** ♻️ Greedy plan: tags above an agent's need (excess) move to agents that are short — per class (VC4 / Commercial). */
  function rebalance(an) {
    const pool = (an.self ? [an.self] : []).concat(an.team);
    const moves = [];
    [['VC4', 'exVc4', 'reqVc4'], ['Commercial', 'exComm', 'reqComm'], ['Any class', 'exAny', 'reqAny']].forEach(([cls, exK, reqK]) => {
      const donors = pool.filter((a) => a[exK] > 0).map((a) => ({ a, left: a[exK] })).sort((x, y) => y.left - x.left);
      const recv = an.team.filter((a) => a[reqK] > 0).map((a) => ({ a, left: a[reqK] })).sort((x, y) => y.left - x.left);
      let i = 0;
      for (const r of recv) {
        while (r.left > 0 && i < donors.length) {
          const d = donors[i];
          const q = Math.min(d.left, r.left);
          if (q > 0) { moves.push({ cls, from: d.a, to: r.a, qty: q }); d.left -= q; r.left -= q; }
          if (d.left <= 0) i += 1;
        }
      }
    });
    const short = an.team.reduce((x, a) => x + a.reqVc4 + a.reqComm + a.reqAny, 0);
    const covered = moves.reduce((x, m) => x + m.qty, 0);
    const donors = new Set(moves.map((m) => m.from)).size;
    return { moves, short, covered, remaining: Math.max(0, short - covered), donors, receivers: new Set(moves.map((m) => m.to)).size,
      spare: pool.reduce((x, a) => x + a.exVc4 + a.exComm + a.exAny, 0) };
  }

  /** VC4 · VC20 · VC5+ (or VC4 · Commercial when no class bins): stock vs N-day need. */
  function classRows(pr, ctx) {
    let bins = null;
    try { bins = FF.masterProfile && FF.masterProfile.groupBinsFor ? FF.masterProfile.groupBinsFor(pr) : null; } catch { bins = null; }
    let items;
    if (bins && bins.stock && bins.cur && (num(bins.stock.total) || num(bins.cur.total) || GROUPS.some((g) => num(bins.stock[g]) || num(bins.cur[g])))) {
      items = GROUPS.map((g) => ({ label: g, stock: num(bins.stock[g]), cur: num(bins.cur[g]) }));
    } else {
      const s = pr.stock || {}, t = pr.totals || {};
      items = [{ label: 'VC4', stock: num(s.vc4), cur: num(t.curVc4) }, { label: 'Commercial', stock: num(s.comm), cur: num(t.curComm) }];
    }
    return items.map((it) => {
      const rate = it.cur / ctx.elapsed;
      const need = Math.ceil(rate * ctx.days);
      const diff = it.stock - need;
      const verdict = need > it.stock ? 'required' : (it.stock > 0 && need > 0 && it.stock >= HIGH_MULT * need) ? 'high' : (it.stock > 0 && it.cur === 0) ? 'dead' : 'ok';
      return Object.assign({}, it, { rate, need, diff, verdict, cover: rate > 0 ? it.stock / rate : null });
    }).filter((r) => r.stock || r.cur || r.need);
  }

  // ------------------------------------------------------------------ small html helpers
  const coverText = (c) => (c === null ? '<span class="dim">no issuance</span>' : `${fmt(c, 0)}<small class="dim"> days</small>`);
  const verdictText = (v, row) => (v === 'required' ? `short ${fmt(row.req !== undefined ? row.req : Math.max(0, -row.diff))}`
    : v === 'high' ? `excess ${fmt(row.excess !== undefined ? row.excess : Math.max(0, row.diff))}`
      : v === 'dead' ? 'no issuance' : 'balanced');
  const agentAttrs = (pr, a) => `data-mp-agent="${esc(a.name)}" data-mp-kind="${pr.ch}-agent" data-mp-id="${esc(a.id || '')}"`;
  const chip = (v, text) => `<span class="ps-chip v-${v}">${esc(text)}</span>`;

  // ------------------------------------------------------------------ team boxes + list
  function boxesHtml(pr, an, st) {
    const box = (b) => {
      let value, em;
      const c = an.counts[b.id];
      if (b.id === 'total') { value = fmt(an.sums.total); em = `TL own ${fmt(an.sums.own)} + agents ${fmt(an.sums.agents)} · ${fmt(c)} holders`; }
      else if (b.id === 'required') { value = fmt(c); em = `${fmt(an.sums.req)} tags needed after stock`; }
      else if (b.id === 'oos') { value = fmt(c); em = 'issuing, zero stock'; }
      else if (b.id === 'high') { value = fmt(c); em = `${fmt(an.sums.highExcess)} excess tags · stock ≥ ${HIGH_MULT}× need`; }
      else if (b.id === 'dead') { value = fmt(c); em = `${fmt(an.sums.deadStock)} tags idle · no issuance this month`; }
      else if (b.id === 'excess') { value = fmt(an.sums.excess); em = `above the ${an.days}-day need · ${fmt(c)} agents`; }
      else if (b.id === 'ok') { value = fmt(c); em = 'stock matches issuance'; }
      else { value = an.sums.cover === null ? '—' : `${fmt(an.sums.cover, 0)}<small class="dim"> days</small>`; em = `agents stock ÷ ${fmt(an.sums.rate, 1)} tags/day`; }
      const zero = b.id === 'cover' ? false : !num(b.id === 'excess' ? an.sums.excess : (b.id === 'total' ? an.sums.total : c));
      if (!b.pick) return `<div class="pi-box static t-${b.tone}" title="${esc(b.hint)}"><small>${esc(b.label)}</small><b>${value}</b><em>${em}</em></div>`;
      return `<button type="button" class="pi-box t-${b.tone}${st.box === b.id ? ' on' : ''}${zero ? ' zero' : ''}" data-ps-box="${b.id}" aria-pressed="${st.box === b.id}" title="${esc(b.hint)}"><small>${esc(b.label)}</small><b>${value}</b><em>${em}</em></button>`;
    };
    return `<div class="pi-boxes" role="group" aria-label="Stock health">${BOXES.map(box).join('')}</div>`;
  }

  function listFor(an, boxId, sortKey) {
    const b = BOX_BY_ID[boxId];
    let list = an.team.filter(b.pick);
    if (boxId === 'total' && an.self && an.self.stock > 0) list = [an.self, ...list];
    const [key, dir] = String(sortKey || DEFAULT_SORT[boxId] || 'stock').split('-');
    const fn = SORTS[key] || SORTS.stock;
    list = list.slice().sort((a, b2) => (dir === 'rev' ? -fn(a, b2) : fn(a, b2)) || b2.stock - a.stock || a.name.localeCompare(b2.name));
    return list;
  }

  function panelHtml(pr, an, st) {
    if (!st.box || !BOX_BY_ID[st.box] || !BOX_BY_ID[st.box].pick) return '<div class="pi-panel-empty dim small">👆 Click any box above to see exactly which agents are in it.</div>';
    const box = BOX_BY_ID[st.box];
    const sortKey = st.sort || DEFAULT_SORT[st.box];
    const list = listFor(an, st.box, sortKey);
    const [sk, sd] = String(sortKey).split('-');
    const th = (key, label, cls) => `<th class="${cls || ''} pi-sortable${sk === key ? ' on' : ''}" data-ps-sort="${sk === key ? (sd === 'rev' ? key : `${key}-rev`) : key}" role="button" tabindex="0" title="Sort">${label}${sk === key ? (sd === 'rev' ? ' ▲' : ' ▼') : ''}</th>`;
    const rows = list.map((a, i) => `<tr class="clickable" ${agentAttrs(pr, a)}>
      <td class="dim">${i + 1}</td>
      <td><b>${esc(a.name)}</b>${a.isSelf ? ' <span class="badge">TL own</span>' : ''}<small class="cell-sub">${esc(a.id || '')}${a.priority ? ` · ${esc(a.priority)}` : ''}</small></td>
      <td>${a.mobile ? `<a href="tel:${esc(a.mobile)}" onclick="event.stopPropagation()">📞 ${esc(a.mobile)}</a>` : '<span class="dim">—</span>'}</td>
      <td class="num"><b>${fmt(a.stock)}</b><small class="cell-sub">VC4 ${fmt(a.stockVc4)} · Comm ${fmt(a.stockComm)}</small></td>
      <td class="num">${fmt(a.cur)}</td>
      <td class="num">${fmt(a.rate, 1)}</td>
      <td class="num">${coverText(a.cover)}</td>
      <td class="num">${fmt(a.need)}</td>
      <td class="num">${a.req ? `<b class="ps-neg">${fmt(a.req)}</b>` : '<span class="dim">—</span>'}</td>
      <td class="num">${a.excess ? `<b class="ps-warn">${fmt(a.excess)}</b>` : '<span class="dim">—</span>'}</td>
      <td>${chip(a.verdict, verdictText(a.verdict, a))}</td></tr>`).join('');
    return `<div class="pi-panel-head"><div><b>${esc(box.label)}</b> · ${fmt(list.length)} agent${list.length === 1 ? '' : 's'}<small class="dim"> — ${esc(box.hint)}</small></div>
      <div class="pi-panel-actions"><button type="button" class="btn small" data-ps-csv>⬇ CSV</button><button type="button" class="btn small" data-ps-close>✕ Close</button></div></div>
      ${list.length ? `<div class="table-wrap pi-table no-tools"><table class="tbl compact"><thead><tr><th>#</th>${th('name', 'Agent')}<th>Mobile</th>${th('stock', 'Stock', 'num')}${th('cur', 'Issued (month)', 'num')}${th('rate', 'Run-rate/day', 'num')}${th('cover', 'Cover', 'num')}${th('need', `Need · ${an.days}d`, 'num')}${th('req', 'Required', 'num')}${th('excess', 'Excess', 'num')}<th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="dim small">Need = run-rate/day × ${an.days} days (same rule as Suggested dispatch). Required = need − stock per class. Excess = stock above need. Tap an agent to open the full profile.</p>`
        : '<p class="dim small pi-none">🎉 Nobody here right now.</p>'}`;
  }

  // ------------------------------------------------------------------ top 10
  function topHtml(pr, an) {
    const defs = [
      { id: 'high', title: '🟠 High stock', color: VERDICT.high, list: an.team.filter((a) => a.high || (a.excess > 0 && a.dead)).sort((a, b) => b.excess - a.excess || b.stock - a.stock), val: (a) => a.excess, sub: (a) => `stock ${fmt(a.stock)} · need ${fmt(a.need)}`, label: 'excess' },
      { id: 'required', title: '🔴 Stock required', color: VERDICT.required, list: an.team.filter((a) => a.required).sort((a, b) => b.req - a.req || b.rate - a.rate), val: (a) => a.req, sub: (a) => `stock ${fmt(a.stock)} · need ${fmt(a.need)}`, label: 'short' },
      { id: 'dead', title: '⚫ Dead stock', color: VERDICT.dead, list: an.team.filter((a) => a.dead).sort((a, b) => b.stock - a.stock), val: (a) => a.stock, sub: (a) => `VC4 ${fmt(a.stockVc4)} · Comm ${fmt(a.stockComm)}`, label: 'idle' }
    ];
    const cards = defs.map((d) => {
      const list = d.list.slice(0, 10);
      const max = list.length ? Math.max(1, d.val(list[0])) : 1;
      return `<div class="pi-top" style="--c:${d.color}"><h5><i></i>${d.title} <small class="dim">${fmt(d.list.length)} agent${d.list.length === 1 ? '' : 's'}</small></h5>
        ${list.length ? `<ol>${list.map((a, i) => `<li class="clickable" ${agentAttrs(pr, a)}>
          <span class="pi-rk">${i + 1}</span><span class="pi-nm"><b>${esc(a.name)}</b><small class="dim">${esc(a.id || '')}</small></span>
          <span class="pi-bar"><u style="width:${Math.max(4, Math.round((d.val(a) / max) * 100))}%"></u></span>
          <span class="pi-val"><b>${fmt(d.val(a))}</b><small class="dim">${esc(d.sub(a))}</small></span></li>`).join('')}</ol>`
          : '<p class="dim small pi-none">None — all good here.</p>'}</div>`;
    }).join('');
    return `<div class="pi-top-wrap"><div class="pi-top-head"><h5>🏆 Top 10 by stock health</h5></div><div class="pi-tops">${cards}</div></div>`;
  }

  // ------------------------------------------------------------------ chart (bullet bars: bar = stock, tick = need)
  function bullet(label, sub, stock, need, max, verdict, valText, attrs, dot) {
    const w = (v) => Math.max(0, Math.min(100, (v / max) * 100));
    return `<div class="ps-row${attrs ? ' clickable' : ''} v-${verdict}" ${attrs || ''} title="${esc(`${label}: stock ${fmt(stock)} · need ${fmt(need)}`)}">
      <span class="ps-nm"><b>${dot ? `<i class="ps-dot" style="background:${dot}"></i>` : ''}${esc(label)}</b>${sub ? `<small class="dim">${esc(sub)}</small>` : ''}</span>
      <span class="ps-track"><u class="ps-fill" style="width:${stock ? Math.max(1.5, w(stock)).toFixed(1) : 0}%"></u>${need ? `<i class="ps-need" style="left:${Math.min(99.4, w(need)).toFixed(1)}%"></i>` : ''}</span>
      <span class="ps-val"><b>${fmt(stock)}</b><small>${valText}</small></span></div>`;
  }
  const verdictVal = (v, need, stock) => (v === 'required' ? `need ${fmt(need)} · <b class="ps-neg">short ${fmt(need - stock)}</b>`
    : v === 'high' ? `need ${fmt(need)} · <b class="ps-warn">excess ${fmt(stock - need)}</b>`
      : v === 'dead' ? 'no issuance this month' : `need ${fmt(need)} · ok`);

  /** Class rows used by the chart: every class (pr.classes); falls back to the grouped rows when a profile has none. */
  function chartClasses(an) {
    const rows = an.classChart && an.classChart.length ? an.classChart : an.classRows.map((r) => Object.assign({ last: 0, share: 0 }, r));
    return rows;
  }

  /** 🎯 All classes — stacked share bar + one bullet row per class (bar = stock, tick = need). */
  function classBlockHtml(an, st) {
    const rows = chartClasses(an);
    if (!rows.length) return '<div class="ps-block"><div class="ps-block-head"><h6>🎯 Class-wise stock</h6></div><p class="dim small pi-none">No class-wise stock or issuance yet.</p></div>';
    const mode = ['stock', 'cur', 'short'].includes(st.cls) ? st.cls : 'stock';
    const colorOf = new Map(rows.slice().sort((a, b) => clsSort(a.label, b.label)).map((r, i) => [r.label, CLS_COLORS[i % CLS_COLORS.length]]));
    const total = rows.reduce((x, r) => x + r.stock, 0);
    const needSum = rows.reduce((x, r) => x + r.need, 0);
    const shortSum = rows.reduce((x, r) => x + Math.max(0, r.need - r.stock), 0);
    const stocked = rows.filter((r) => r.stock > 0);
    const bar = total ? `<div class="ps-share" role="img" aria-label="Stock share by class">${stocked.map((r) => `<i style="flex:${r.stock};background:${colorOf.get(r.label)}" title="${esc(`${r.label}: ${fmt(r.stock)} tags (${fmt((r.stock / total) * 100, 1)}%)`)}"></i>`).join('')}</div>
      <div class="ps-share-key">${stocked.map((r) => `<span><i style="background:${colorOf.get(r.label)}"></i>${esc(r.label)} <b>${fmt(r.stock)}</b><small class="dim"> ${fmt((r.stock / total) * 100, 0)}%</small></span>`).join('')}</div>` : '';
    const sorted = rows.slice().sort((a, b) => (mode === 'cur' ? b.cur - a.cur : mode === 'short' ? Math.max(0, b.need - b.stock) - Math.max(0, a.need - a.stock) : b.stock - a.stock) || b.stock - a.stock || clsSort(a.label, b.label));
    const max = Math.max(1, ...rows.map((r) => Math.max(r.stock, r.need)));
    const seg = (id, label) => `<button type="button" class="${mode === id ? 'on' : ''}" data-ps-cls="${id}">${label}</button>`;
    return `<div class="ps-block" data-ps-classblock><div class="ps-block-head"><h6>🎯 Class-wise stock <small class="dim">· ${fmt(rows.length)} classes · ${fmt(total)} tags${needSum ? ` · ${an.days}-day need ${fmt(needSum)}` : ''}${shortSum ? ` · <b class="ps-neg">short ${fmt(shortSum)}</b>` : ''}</small></h6>
      <div class="pi-seg" role="group" aria-label="Sort classes">${seg('stock', 'By stock')}${seg('cur', 'By issuance')}${seg('short', 'Most short')}</div></div>
      ${bar}
      ${sorted.map((r) => bullet(r.label, `${fmt(r.cur)} issued · ${fmt(r.rate, 1)}/day${r.cover === null ? '' : ` · ${fmt(r.cover, 0)}d`}`, r.stock, r.need, max, r.verdict, verdictVal(r.verdict, r.need, r.stock), '', colorOf.get(r.label))).join('')}</div>`;
  }

  function chartHtml(pr, an, st) {
    const legend = `<div class="ps-legend"><span><i class="v-ok"></i>Balanced</span><span><i class="v-high"></i>High stock</span><span><i class="v-required"></i>Short (required)</span><span><i class="v-dead"></i>No issuance</span><span><i class="tick"></i>${an.days}-day need</span></div>`;
    let agentsHtml = '';
    if (an.isTl && an.team.length) {
      const mode = ['stock', 'req', 'excess'].includes(st.chart) ? st.chart : 'stock';
      const pool = (mode === 'req' ? an.team.filter((a) => a.req > 0) : mode === 'excess' ? an.team.filter((a) => a.excess > 0) : an.team.filter((a) => a.stock > 0 || a.need > 0))
        .sort((a, b) => (mode === 'req' ? b.req - a.req : mode === 'excess' ? b.excess - a.excess : b.stock - a.stock) || b.need - a.need)
        .slice(0, MAX_ROWS);
      const amax = Math.max(1, ...pool.map((a) => Math.max(a.stock, a.need)));
      const seg = (id, label) => `<button type="button" class="${mode === id ? 'on' : ''}" data-ps-chart="${id}">${label}</button>`;
      agentsHtml = `<div class="ps-block"><div class="ps-block-head"><h6>🧑‍💼 Agent-wise stock vs need <small class="dim">top ${MAX_ROWS}</small></h6>
        <div class="pi-seg" role="group" aria-label="Sort agents">${seg('stock', 'Highest stock')}${seg('req', 'Most required')}${seg('excess', 'Most excess')}</div></div>
        ${pool.length ? pool.map((a) => bullet(a.name, a.id, a.stock, a.need, amax, a.verdict, a.required ? `need ${fmt(a.need)} · <b class="ps-neg">short ${fmt(a.req)}</b>` : a.excess ? `need ${fmt(a.need)} · <b class="ps-warn">excess ${fmt(a.excess)}</b>` : a.dead ? 'no issuance' : `need ${fmt(a.need)} · ok`, agentAttrs(pr, a))).join('') : '<p class="dim small pi-none">Nobody here.</p>'}</div>`;
    }
    return `<div class="ps-chart-card"><div class="ps-chart-head"><h5>📊 Stock vs need <small class="dim">${an.isTl ? 'whole team incl. TL' : 'this agent'}</small></h5>${legend}</div>
      ${classBlockHtml(an, st)}
      ${agentsHtml}
      <p class="dim small">Bar = stock in hand · tick = what ${an.days} days of issuance needs (run-rate/day × ${an.days}). Bar past the tick = excess, short of the tick = tags required.</p></div>`;
  }

  // ------------------------------------------------------------------ health bar + rebalance plan (TL)
  function healthHtml(an) {
    const n = an.team.length;
    if (!n) return '';
    const defs = [['ok', 'Balanced'], ['high', 'High stock'], ['required', 'Stock required'], ['dead', 'Dead stock']];
    const segs = defs.filter(([id]) => an.health[id] > 0);
    return `<div class="ps-health" role="img" aria-label="Agent stock health"><div class="ps-health-bar">${segs.map(([id, l]) => `<i class="v-${id}" style="flex:${an.health[id]}" title="${esc(`${l}: ${an.health[id]} of ${n} agents`)}"></i>`).join('')}</div>
      <div class="ps-health-key">${defs.map(([id, l]) => `<span class="${an.health[id] ? '' : 'zero'}"><i class="v-${id}"></i>${l} <b>${fmt(an.health[id])}</b><small class="dim"> ${fmt((an.health[id] / n) * 100, 0)}%</small></span>`).join('')}</div></div>`;
  }

  function rebHtml(pr, an, st) {
    const r = an.reb;
    if (!r) return '';
    const who = (a) => `<button type="button" class="ps-who" ${agentAttrs(pr, a)}><b>${esc(a.name)}</b>${a.isSelf ? ' <span class="badge">TL own</span>' : ''}<small class="dim">${esc(a.id || '')}</small></button>`;
    const box = (l, v, em, t) => `<div class="pi-box static t-${t}"><small>${esc(l)}</small><b>${v}</b><em>${em}</em></div>`;
    const kpis = `<div class="pi-boxes pi-boxes-4">${box('Tags short', fmt(r.short), `${fmt(an.counts.required)} agent${an.counts.required === 1 ? '' : 's'} below their ${an.days}-day need`, 'red')}
      ${box('Spare tags', fmt(r.spare), 'above need · TL own + agents', 'sky')}
      ${box('Can be moved', fmt(r.covered), r.covered ? `${fmt(r.donors)} giving → ${fmt(r.receivers)} receiving` : 'no spare to move', 'green')}
      ${box('Still to dispatch', fmt(r.remaining), r.remaining ? 'fresh tags needed after moving' : 'nothing extra needed', r.remaining ? 'amber' : 'green')}</div>`;
    let body;
    if (!r.short) body = '<p class="dim small pi-none">✅ Nobody is short on stock — nothing to rebalance.</p>';
    else if (!r.moves.length) body = `<p class="dim small pi-none">No spare tags above anyone's need — all ${fmt(r.short)} short tags have to be dispatched fresh.</p>`;
    else {
      const list = st.rebAll ? r.moves : r.moves.slice(0, REB_ROWS);
      const spare = (a) => a.exVc4 + a.exComm + a.exAny;
      body = `<div class="ps-moves">${list.map((m) => `<div class="ps-move"><span class="ps-mv-cls">${esc(m.cls)}</span>
        <span class="ps-mv-from"><small class="ps-lbl">From · spare ${fmt(spare(m.from))}</small>${who(m.from)}</span>
        <span class="ps-arrow" aria-hidden="true">→</span>
        <span class="ps-mv-to"><small class="ps-lbl">To · short ${fmt(m.to.req)}</small>${who(m.to)}</span>
        <span class="ps-mv-qty"><b>${fmt(m.qty)}</b><small>tags</small></span></div>`).join('')}</div>
        ${r.moves.length > REB_ROWS ? `<button type="button" class="btn small ps-more" data-ps-reb-all>${st.rebAll ? 'Show top ' + REB_ROWS + ' only' : `Show all ${fmt(r.moves.length)} moves`}</button>` : ''}`;
    }
    return `<div class="ps-reb" data-ps-reb><div class="pi-top-head"><h5>♻️ Rebalance plan <small class="dim">Move spare tags to agents who are short before dispatching new ones</small></h5>
      ${r.moves.length ? '<button type="button" class="btn small" data-ps-reb-csv>⬇ CSV</button>' : ''}</div>${kpis}${body}
      <p class="dim small">Greedy match per class (VC4 / Commercial): biggest spare → biggest shortage. Spare = stock above the ${an.days}-day need; the TL's own stock counts as spare when the TL isn't issuing from it.</p></div>`;
  }

  // ------------------------------------------------------------------ header (downloads)
  function headHtml(pr, an) {
    const isTl = an.isTl;
    const scope = isTl ? `tl=${encodeURIComponent(pr.name)}${pr.stockTlId || pr.id ? `&tlId=${encodeURIComponent(pr.stockTlId || pr.id)}` : ''}`
      : `agent=${encodeURIComponent(pr.name)}${pr.id ? `&agentId=${encodeURIComponent(pr.id)}` : ''}${pr.tl && pr.tl.id ? `&tl=${encodeURIComponent(pr.tl.name || '')}&tlId=${encodeURIComponent(pr.tl.id)}` : ''}`;
    const total = isTl ? an.sums.total : (an.me ? an.me.stock : 0);
    return `<div class="ps-head"><div class="ps-head-sum"><b>${fmt(total)}</b><small class="dim"> tags in stock${isTl ? ` · ${fmt(an.counts.total || 0)} agents + TL own` : ''}</small></div>
      <div class="ps-tools"><button type="button" class="btn small primary" data-ps-total-csv title="Whole stock — ${isTl ? 'every agent × every class' : 'every class'} — as one CSV">⬇ Total stock CSV</button>
      <button type="button" class="btn small" data-kpi="${esc(`src=${pr.ch}&scope=stock&${scope}`)}" role="button" tabindex="0" title="Tag-level stock (class → barcode)">🏷️ Tag-level stock</button></div></div>`;
  }

  // ------------------------------------------------------------------ agent boxes
  function agentBoxesHtml(pr, an) {
    const a = an.me;
    const label = an.noDispatch && !a.high && !a.dead ? 'No dispatch' : { required: a.oos ? 'Out of stock' : 'Stock required', high: 'High stock', dead: 'Dead stock', ok: 'Balanced' }[a.verdict];
    const tone = an.noDispatch && !a.high && !a.dead ? 'slate' : { required: a.oos ? 'rose' : 'red', high: 'amber', dead: 'orange', ok: 'green' }[a.verdict];
    const why = an.noDispatch && !a.high && !a.dead ? `${esc(pr.directLabel || 'Direct agent')} · priority ${esc(pr.priority || 'Low')} — no dispatch needed`
      : a.verdict === 'required' ? `${fmt(a.req)} tags needed to cover ${an.days} days`
        : a.verdict === 'high' ? `stock is ${a.need ? fmt(a.stock / a.need, 1) : '—'}× the ${an.days}-day need`
          : a.verdict === 'dead' ? 'stock in hand but nothing issued this month'
            : `stock covers the ${an.days}-day need`;
    const box = (l, v, em, t, txt) => `<div class="pi-box static t-${t}${txt ? ' txt' : ''}"><small>${esc(l)}</small><b>${v}</b><em>${em}</em></div>`;
    let bins = null;
    try { bins = FF.masterProfile && FF.masterProfile.groupBinsFor ? FF.masterProfile.groupBinsFor(pr) : null; } catch { bins = null; }
    const split = bins && bins.stock && GROUPS.some((g) => num(bins.stock[g]))
      ? GROUPS.map((g) => `${g} ${fmt(bins.stock[g])}`).join(' · ') : `VC4 ${fmt(a.stockVc4)} · Comm ${fmt(a.stockComm)}`;
    const need = a.req > 0 ? box('Required', `<span class="ps-neg">${fmt(a.req)}</span>`, `need ${fmt(a.need)} (${an.days}d) − stock ${fmt(a.stock)}`, 'red')
      : a.excess > 0 ? box('Excess', `<span class="ps-warn">${fmt(a.excess)}</span>`, `stock ${fmt(a.stock)} − need ${fmt(a.need)} (${an.days}d)`, 'amber')
        : box('Required / excess', '0', `need ${fmt(a.need)} (${an.days}d) · stock ${fmt(a.stock)}`, 'green');
    return `<div class="pi-boxes pi-boxes-4">
      ${box('Stock status', esc(label), why, tone, true)}
      ${box('Stock in hand', fmt(a.stock), split, 'indigo')}
      ${box('Cover', a.cover === null ? '—' : `${fmt(a.cover, 0)}<small class="dim"> days</small>`, a.cover === null ? 'no issuance this month' : `run-rate ${fmt(a.rate, 1)}/day`, 'sky')}
      ${need}
    </div>`;
  }

  // ------------------------------------------------------------------ public html
  function html(pr) {
    try {
      if (!pr) return '';
      const an = analyze(pr), st = uiOf(pr);
      const title = an.isTl ? `📦 Stock health <small class="dim">· ${fmt(an.team.length)} agents · ${an.days}-day need</small>` : `📦 Stock health <small class="dim">· ${an.days}-day need</small>`;
      const partial = pr.partial ? '<p class="dim small pi-none" role="status">⏳ Some stock / issuance data is still loading — this section updates automatically.</p>' : '';
      if (an.isTl && !an.team.length && !an.self) {
        return `<section class="mp-sec ps" data-mp-sec="stockhealth" data-ps="${esc(keyOf(pr))}"><h4>${title}</h4>${partial || '<p class="dim small pi-none">No agent rows for this TL yet.</p>'}</section>`;
      }
      return `<section class="mp-sec ps" data-mp-sec="stockhealth" data-ps="${esc(keyOf(pr))}"><h4>${title}</h4>${partial}
        ${headHtml(pr, an)}
        ${an.isTl ? `${healthHtml(an)}${boxesHtml(pr, an, st)}<div class="pi-panel" data-ps-panel>${panelHtml(pr, an, st)}</div>${chartHtml(pr, an, st)}${topHtml(pr, an)}${rebHtml(pr, an, st)}` : `${agentBoxesHtml(pr, an)}${chartHtml(pr, an, st)}`}
      </section>`;
    } catch (e) {
      try { console.warn('profileStock:', e); } catch { /* ignore */ }
      return '';
    }
  }

  // ------------------------------------------------------------------ events
  function csvOf(pr, an, st) {
    const list = listFor(an, st.box, st.sort || DEFAULT_SORT[st.box]);
    const head = ['Agent', 'Agent ID', 'Mobile', 'Priority', 'Stock VC4', 'Stock Comm', 'Stock total', 'Issued this month', 'Run-rate/day', 'Cover (days)', `Need (${an.days} days)`, 'Required', 'Excess', 'Status'];
    return { head, rows: list.map((a) => [a.name + (a.isSelf ? ' (TL own)' : ''), a.id, a.mobile, a.priority, a.stockVc4, a.stockComm, a.stock, a.cur, Math.round(a.rate * 10) / 10, a.cover === null ? '' : Math.round(a.cover), a.need, a.req, a.excess, verdictText(a.verdict, a)]) };
  }

  /** ⬇ Total stock — TL: every holder (TL own first) × every class + totals; agent: one row per class + total. */
  function totalCsv(pr, an) {
    const r1 = (v) => Math.round(num(v) * 10) / 10;
    if (an.isTl) {
      const holders = (an.self ? [an.self] : []).concat(an.team.slice().sort((a, b) => b.stock - a.stock || a.name.localeCompare(b.name)));
      const set = new Set();
      holders.forEach((h) => Object.keys(h.classStock || {}).forEach((c) => { if (num(h.classStock[c]) > 0) set.add(c); }));
      const cols = [...set].sort(clsSort);
      const split = cols.length ? cols.map((c) => `Stock ${c}`) : ['Stock VC4', 'Stock Comm'];
      const head = ['Agent', 'Agent ID', 'Role', 'Mobile', 'Priority', ...split, 'Stock total', 'Issued this month', 'Run-rate/day', 'Cover (days)', `Need (${an.days} days)`, 'Required', 'Excess', 'Status'];
      const splitOf = (h) => (cols.length ? cols.map((c) => num(h.classStock && h.classStock[c])) : [h.stockVc4, h.stockComm]);
      const rows = holders.map((h) => [h.name, h.id, h.isSelf ? 'TL own' : 'Agent', h.mobile, h.priority, ...splitOf(h), h.stock, h.cur, r1(h.rate), h.cover === null ? '' : Math.round(h.cover), h.need, h.req, h.excess, h.isSelf ? '' : verdictText(h.verdict, h)]);
      const sum = (f) => holders.reduce((x, h) => x + num(f(h)), 0);
      rows.push(['TOTAL', '', `${holders.length} holders`, '', '', ...(cols.length ? cols.map((c) => sum((h) => h.classStock && h.classStock[c])) : [sum((h) => h.stockVc4), sum((h) => h.stockComm)]),
        sum((h) => h.stock), sum((h) => h.cur), r1(sum((h) => h.rate)), '', sum((h) => h.need), sum((h) => h.req), sum((h) => h.excess), '']);
      return { head, rows, name: `${U.slug(pr.name)}-total-stock-${U.stamp()}.csv` };
    }
    const m = an.me;
    const cls = chartClasses(an).slice().sort((a, b) => clsSort(a.label, b.label));
    const head = ['Agent', 'Agent ID', 'Class', 'Stock', 'Issued this month', 'Issued last month', 'Run-rate/day', 'Cover (days)', `Need (${an.days} days)`, 'Required', 'Excess', 'Status'];
    const rows = cls.map((c) => [pr.name, pr.id || '', c.label, c.stock, c.cur, c.last || 0, r1(c.rate), c.cover === null ? '' : Math.round(c.cover), c.need, Math.max(0, c.need - c.stock), Math.max(0, c.stock - c.need),
      c.verdict === 'required' ? 'Stock required' : c.verdict === 'high' ? 'High stock' : c.verdict === 'dead' ? 'Dead stock' : 'Balanced']);
    const sum = (f) => cls.reduce((x, c) => x + num(f(c)), 0);
    rows.push(['TOTAL', '', `${cls.length} classes`, m ? m.stock : sum((c) => c.stock), sum((c) => c.cur), sum((c) => c.last), r1(sum((c) => c.rate)), m && m.cover !== null ? Math.round(m.cover) : '', m ? m.need : sum((c) => c.need), m ? m.req : '', m ? m.excess : '', m ? ({ required: 'Stock required', high: 'High stock', dead: 'Dead stock', ok: 'Balanced' })[m.verdict] : '']);
    return { head, rows, name: `${U.slug(pr.name)}-total-stock-${U.stamp()}.csv` };
  }

  function rebCsv(pr, an) {
    const r = an.reb;
    const head = ['Class', 'From agent', 'From ID', 'From mobile', 'To agent', 'To ID', 'To mobile', 'Tags to move'];
    const rows = r.moves.map((m) => [m.cls, m.from.name + (m.from.isSelf ? ' (TL own)' : ''), m.from.id, m.from.mobile, m.to.name, m.to.id, m.to.mobile, m.qty]);
    rows.push(['TOTAL', '', '', '', '', '', '', r.covered]);
    rows.push(['Still to dispatch (fresh)', '', '', '', '', '', '', r.remaining]);
    return { head, rows, name: `${U.slug(pr.name)}-rebalance-plan-${U.stamp()}.csv` };
  }

  function bind(el) {
    if (!el || el.__psBound) return;
    el.__psBound = true;
    const cur = () => el.__mpProfile;
    const refresh = (sec, part) => {
      const pr = cur(); if (!pr || !sec) return;
      const an = analyze(pr), st = uiOf(pr);
      if (part === 'panel') {
        const panel = sec.querySelector('[data-ps-panel]'); if (panel) panel.innerHTML = panelHtml(pr, an, st);
        sec.querySelectorAll('[data-ps-box]').forEach((b) => { const on = b.dataset.psBox === st.box; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      } else if (part === 'chart') {
        const card = sec.querySelector('.ps-chart-card'); if (card) card.outerHTML = chartHtml(pr, an, st);
      } else if (part === 'reb') {
        const card = sec.querySelector('[data-ps-reb]'); if (card) card.outerHTML = rebHtml(pr, an, st);
      }
    };
    el.addEventListener('click', (e) => {
      const sec = e.target.closest('.ps'); if (!sec) return;
      const pr = cur(); if (!pr) return;
      const st = uiOf(pr);
      const box = e.target.closest('[data-ps-box]');
      if (box) {
        st.box = st.box === box.dataset.psBox ? '' : box.dataset.psBox; st.sort = '';
        refresh(sec, 'panel');
        const panel = sec.querySelector('[data-ps-panel]'); if (st.box && panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      if (e.target.closest('[data-ps-close]')) { st.box = ''; refresh(sec, 'panel'); return; }
      const sort = e.target.closest('[data-ps-sort]');
      if (sort) { st.sort = sort.dataset.psSort; refresh(sec, 'panel'); return; }
      const chart = e.target.closest('[data-ps-chart]');
      if (chart) { st.chart = chart.dataset.psChart; refresh(sec, 'chart'); return; }
      const cls = e.target.closest('[data-ps-cls]');
      if (cls) { st.cls = cls.dataset.psCls; refresh(sec, 'chart'); return; }
      if (e.target.closest('[data-ps-reb-all]')) { st.rebAll = !st.rebAll; refresh(sec, 'reb'); return; }
      if (e.target.closest('[data-ps-total-csv]')) {
        const c = totalCsv(pr, analyze(pr));
        U.downloadCsv(c.name, c.head, c.rows);
        return;
      }
      if (e.target.closest('[data-ps-reb-csv]')) {
        const an = analyze(pr); if (!an.reb || !an.reb.moves.length) return;
        const c = rebCsv(pr, an);
        U.downloadCsv(c.name, c.head, c.rows);
        return;
      }
      if (e.target.closest('[data-ps-csv]')) {
        const an = analyze(pr); if (!st.box || !BOX_BY_ID[st.box] || !BOX_BY_ID[st.box].pick) return;
        const c = csvOf(pr, an, st);
        U.downloadCsv(`${U.slug(pr.name)}-stock-${st.box}-${U.stamp()}.csv`, c.head, c.rows);
      }
    });
    el.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('[data-ps-sort]')) { e.preventDefault(); e.target.click(); }
    });
  }

  FF.profileStock = { html, bind, analyze, totalCsv, rebCsv, _boxes: BOXES, _classRows: classRows, HIGH_MULT };
})(window.FF);
