/* KPI drill-down: click ANY KPI card → full breakdown of that number in a wide drawer.
   Example: "Latest day 1,000 tags" → kitne VC4 / VC5 / VC20…, GV Partner vs First Forward, Issuance vs
   Replacement, Chassis vs New VRN, class × type matrix, day-wise table, top TLs / agents, and the
   complete tag-level list (all 1,000 rows) with search + Excel download.

   Cards can describe themselves with data-kpi="src=ff&scope=day&date=2026-09-26&f=vc4":
     src   ff | gv | both            (which sheet(s))
     scope day | mtd | month | range | stock | agents | status | stockreport
     date  YYYY-MM-DD (day)   ym YYYY-MM (mtd/month)   from/to YYYY-MM-DD (range)
     f     vc4 | comm | vc20 | vc5p | repl | chassis | wrong | gv | ff
   Cards without data-kpi are understood from their title + the page they are on. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;
  const PAGE_SRC = { dashboard: 'ff', trend: 'ff', stock: 'ff', performance: 'ff', stockReport: 'ff', gvDashboard: 'gv', gvTrend: 'gv', gvStock: 'gv', gvStockReport: 'gv', gvPerformance: 'gv', home: 'both', tagIssued: 'both', compare: 'both', charts: 'both' };
  const FILTERS = {
    vc4: { label: 'VC4', fn: (r) => r.group === 'VC4' },
    comm: { label: 'Commercial (NVC4)', fn: (r) => r.group !== 'VC4' },
    vc20: { label: 'VC20', fn: (r) => r.group === 'VC20' },
    vc5p: { label: 'VC5+', fn: (r) => r.group === 'VC5+' },
    repl: { label: 'Replacement', fn: (r) => r.type === 'REPLACEMENT' },
    chassis: { label: 'Chassis', fn: (r) => /chassis/i.test(r.vrnType) },
    wrong: { label: 'Wrong VRN', fn: (r) => /wrong/i.test(r.vrnType) },
    gv: { label: 'GV Partner', fn: (r) => r.channel === 'GV Partner' },
    ff: { label: 'First Forward', fn: (r) => r.channel !== 'GV Partner' }
  };
  const clsNum = (c) => parseInt(String(c).replace(/\D/g, ''), 10) || 999;
  /** f can be a comma list, e.g. "ff,vc4" = First Forward channel AND VC4. */
  function filterOf(f) {
    const list = String(f || '').split(',').map((x) => x.trim()).filter((x) => FILTERS[x]);
    if (!list.length) return null;
    return { label: list.map((x) => FILTERS[x].label).join(' + '), fn: (r) => list.every((x) => FILTERS[x].fn(r)) };
  }
  const state = { spec: null, rows: null, raw: null, rawQuery: '', history: [] };

  // ---- spec -----------------------------------------------------------------------------------
  function currentPage() { const m = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]; return m || 'home'; }
  function inferSpec(card) {
    const page = currentPage();
    const title = (card.dataset.kpiTitle || (U.$('.kpi-title', card) || {}).textContent || '').trim();
    const foot = (U.$('.kpi-foot', card) || {}).textContent || '';
    const t = `${title} ${card.dataset.kpiScope || ''}`;
    const spec = { src: PAGE_SRC[page] || 'both', title, page };
    if (/\bGV\b/i.test(title) && !/vs|share|compare/i.test(title) && spec.src === 'both') spec.src = 'gv';
    if (/\bFF\b|first forward/i.test(title) && !/vs|share|compare/i.test(title) && spec.src === 'both') spec.src = 'ff';
    if (/stock|inventory|cover/i.test(t)) spec.scope = page === 'stockReport' || page === 'performance' ? 'stockreport' : 'stock';
    else if (/agents?/i.test(t) && !/top agent/i.test(t)) spec.scope = 'agents';
    else if (/activated|hotlist|status/i.test(t)) spec.scope = 'status';
    else if (/latest|today|last day|yesterday|kal|selected day|\b\d{1,2}\s?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(t)) spec.scope = 'day';
    else spec.scope = 'mtd';
    const dm = t.match(/(\d{1,2})\s?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s?(\d{4})?/i);
    if (spec.scope === 'day' && dm) {
      const y = dm[3] ? Number(dm[3]) : new Date().getFullYear();
      const m = U.MONTHS.findIndex((x) => x.toLowerCase() === dm[2].slice(0, 3).toLowerCase());
      if (m >= 0) spec.date = `${y}-${U.pad2(m + 1)}-${U.pad2(Number(dm[1]))}`;
    }
    if (/replacement/i.test(title)) spec.f = 'repl';
    else if (/chassis/i.test(title)) spec.f = 'chassis';
    else if (/wrong vrn/i.test(title)) spec.f = 'wrong';
    else if (/commercial|nvc4/i.test(title) && !/vc4 vs|vs commercial/i.test(title)) spec.f = 'comm';
    else if (/\bVC4\b/i.test(title) && !/commercial/i.test(title)) spec.f = 'vc4';
    else if (/\bVC20\b/i.test(title)) spec.f = 'vc20';
    spec.foot = foot;
    return spec;
  }
  function specFrom(card) {
    const base = inferSpec(card);
    if (card.dataset.kpi) {
      const p = new URLSearchParams(card.dataset.kpi);
      p.forEach((v, k) => { base[k] = v; });
    }
    if (FF.pages.tagIssued && currentPage() === 'tagIssued' && FF.pages.tagIssued.selection) {
      const sel = FF.pages.tagIssued.selection();
      if (sel && !card.dataset.kpi) { if (sel.from && sel.to && sel.from !== sel.to) { base.scope = base.scope === 'day' || base.scope === 'mtd' ? 'range' : base.scope; base.from = sel.from; base.to = sel.to; } else if (sel.date) { if (base.scope === 'mtd' || base.scope === 'day') base.scope = 'day'; base.date = sel.date; } }
    }
    return base;
  }

  // ---- data -----------------------------------------------------------------------------------
  function gvIssuanceRows() {
    const G = FF.gv;
    if (!G || !G.issuanceRows) return [];
    return G.issuanceRows().map((r) => ({ ...r, raw: null }));
  }
  async function issuanceRows(src) {
    let daily = FF.store.get('daily');
    if (!daily) { try { daily = await FF.store.need('daily'); } catch { daily = []; } }
    // 🟩 GV ka aaj ka data GV Master se aata hai (model/gv layer ise already splice karta hai),
    // 🟦 FF ka data EIR se. Isliye yahan sirf channel split aur T+1 lag filter hota hai.
    const rows = (daily || []).filter((r) => src === 'both' || (src === 'gv' ? r.channel === 'GV Partner' : r.channel !== 'GV Partner'));
    // 🔁 FF issuance T+1 — jo FF date abhi reported nahi hai (aaj) wo FF/both counts me nahi.
    //    GV rows live rehti hain, isliye lag sirf First Forward par lagta hai.
    if (FF.filters && FF.filters.ffLagOn && FF.filters.ffLagOn()) return rows.filter((r) => FF.filters.ffVisible(r));
    return rows;
  }
  /** Kis date tak FF reported hai — note ke liye. */
  const ffPendingNote = () => (FF.filters && FF.filters.ffLagOn && FF.filters.ffLagOn())
    ? `<p class="dim small">🔁 <b>Sources:</b> First Forward ka aaj ka issuance <b>EIR</b> se (T+1 — kal aata hai), GV Partner ka aaj ka issuance <b>GV Master</b> sheet se (live). Purane dinon ka ledger EIR hai.</p>` : '';
  function latestKey(rows) { return rows.reduce((m, r) => (r.key > m ? r.key : m), ''); }
  function period(spec, rows) {
    const latest = latestKey(rows);
    if (spec.scope === 'range' && spec.from && spec.to) return { from: spec.from, to: spec.to };
    if (spec.scope === 'day') { const d = spec.date || latest; return { from: d, to: d }; }
    if (spec.scope === 'month' && spec.ym) return { from: `${spec.ym}-01`, to: `${spec.ym}-${U.pad2(U.daysInMonth(spec.ym))}` };
    const ym = spec.ym || (latest ? latest.slice(0, 7) : U.ymKey(new Date()));
    const lastDay = latest && latest.startsWith(ym) ? latest : `${ym}-${U.pad2(U.daysInMonth(ym))}`;
    return { from: `${ym}-01`, to: lastDay };
  }
  function previousPeriod(p) {
    const a = U.fromDateKey(p.from), b = U.fromDateKey(p.to);
    const days = Math.round((b - a) / 86400e3) + 1;
    if (p.from.endsWith('-01') && days > 1) {
      // month-to-date → last month same period
      const ym = U.prevMonthKey(p.from.slice(0, 7));
      const endDay = Math.min(Number(p.to.slice(8)), U.daysInMonth(ym));
      return { from: `${ym}-01`, to: `${ym}-${U.pad2(endDay)}`, label: `${U.labelYM(ym)} same period` };
    }
    const pa = new Date(a); pa.setDate(pa.getDate() - days);
    const pb = new Date(b); pb.setDate(pb.getDate() - days);
    return { from: U.dateKey(pa), to: U.dateKey(pb), label: days === 1 ? `previous day (${U.labelDate(pa)})` : `previous ${days} days` };
  }
  const inP = (r, p) => r.key >= p.from && r.key <= p.to;
  const classKey = (value) => { const text = String(value || '').toUpperCase().replace(/\s+/g, ''); return /^\d+$/.test(text) ? `VC${text}` : text; };
  const personKey = (value) => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  function rowMatchesSpec(r, spec) {
    const groupFilter = filterOf(spec.f);
    if (groupFilter && !groupFilter.fn(r)) return false;
    if (spec.tagId && String(r.tagId || '').trim().toUpperCase() !== String(spec.tagId).trim().toUpperCase()) return false;
    if (spec.cls && classKey(r.cls) !== classKey(spec.cls)) return false;
    if (spec.type === 'REPLACEMENT' && r.type !== 'REPLACEMENT') return false;
    if (spec.type === 'NOT_REPLACEMENT' && r.type === 'REPLACEMENT') return false;
    if (spec.vrnBucket && vrnBucket(r.vrnType) !== spec.vrnBucket) return false;
    if (spec.tl && String(r.tlName || '').trim().toUpperCase() !== String(spec.tl).trim().toUpperCase()) return false;
    if (spec.channel === 'gv' && r.channel !== 'GV Partner') return false;
    if (spec.channel === 'ff' && r.channel === 'GV Partner') return false;
    return true;
  }
  function tally(rows, keyFn) {
    const m = new Map();
    rows.forEach((r) => { const k = keyFn(r) || '—'; m.set(k, (m.get(k) || 0) + r.n); });
    return m;
  }
  const total = (rows) => rows.reduce((a, r) => a + r.n, 0);
  const vrnBucket = (v) => { const s = String(v || '').trim(); if (!s) return 'Not given'; if (/chassis/i.test(s)) return 'Chassis'; if (/wrong/i.test(s)) return 'Wrong VRN'; if (/new|vrn|regist/i.test(s)) return `New / VRN (${s})`; return s; };

  // ---- html helpers ---------------------------------------------------------------------------
  const pct = (v, t) => U.fmtPct(U.pctOf(v, t), v && t && v / t < 0.01 ? 2 : 1);
  function breakdownTable(title, cur, prev, totalCur, opts = {}) {
    const keys = [...new Set([...cur.keys(), ...(prev ? prev.keys() : [])])];
    const sorted = opts.sortCls ? keys.sort((a, b) => clsNum(a) - clsNum(b)) : keys.sort((a, b) => (cur.get(b) || 0) - (cur.get(a) || 0));
    if (!sorted.length) return '';
    const max = Math.max(1, ...sorted.map((k) => cur.get(k) || 0));
    return `<section class="kd-sec"><h4>${title}</h4><table class="tbl compact kd-tbl"><thead><tr><th>${esc(opts.head || 'Item')}</th><th class="num">Count</th><th class="num">Share</th>${prev ? `<th class="num">${esc(opts.prevLabel || 'Previous')}</th><th class="num">Change</th>` : ''}<th class="kd-bar-col"></th></tr></thead><tbody>
      ${sorted.map((k) => { const v = cur.get(k) || 0, pv = prev ? (prev.get(k) || 0) : null; const drill = opts.drill && opts.drill(k); return `<tr${drill ? ` class="clickable" data-kd-spec='${specAttr(drill)}' title="Click to open ${esc(k)} details"` : ''}><td><b>${esc(k)}</b></td><td class="num"><b>${U.fmt(v)}</b></td><td class="num">${pct(v, totalCur)}</td>${prev ? `<td class="num">${U.fmt(pv)}</td><td class="num">${U.deltaHtml(U.growth(v, pv), { decimals: 0 })}</td>` : ''}<td class="kd-bar-col"><span class="kd-bar" style="width:${(v / max) * 100}%"></span></td></tr>`; }).join('')}
      <tr class="kd-total"><td>Total</td><td class="num">${U.fmt(totalCur)}</td><td class="num">100%</td>${prev ? `<td class="num">${U.fmt([...prev.values()].reduce((a, b) => a + b, 0))}</td><td></td>` : ''}<td></td></tr></tbody></table></section>`;
  }
  function matrix(title, rows, rowFn, colFn, opts = {}) {
    const rk = [...new Set(rows.map(rowFn))].sort((a, b) => (opts.sortCls ? clsNum(a) - clsNum(b) : String(a).localeCompare(String(b))));
    const ck = [...new Set(rows.map(colFn))].sort();
    if (!rk.length || !ck.length) return '';
    const cell = new Map();
    rows.forEach((r) => { const k = `${rowFn(r)}\u0001${colFn(r)}`; cell.set(k, (cell.get(k) || 0) + r.n); });
    const colTot = ck.map((c) => rows.filter((r) => colFn(r) === c).reduce((a, r) => a + r.n, 0));
    return `<section class="kd-sec"><h4>${title}</h4><div class="table-wrap"><table class="tbl compact kd-tbl"><thead><tr><th>${esc(opts.head || '')}</th>${ck.map((c) => `<th class="num">${esc(c)}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>
      ${rk.map((r) => { const vals = ck.map((c) => cell.get(`${r}\u0001${c}`) || 0); const drill = opts.drillRow && opts.drillRow(r); return `<tr${drill ? ` class="clickable" data-kd-spec='${specAttr(drill)}' title="Click to open ${esc(r)} details"` : ''}><td><b>${esc(r)}</b></td>${vals.map((v, i) => { const cellDrill = opts.drillCell && opts.drillCell(r, ck[i]); return `<td class="num"${cellDrill ? ` data-kd-spec='${specAttr(cellDrill)}' title="Click to open this breakdown"` : ''}>${v ? U.fmt(v) : '<span class="dim">0</span>'}</td>`; }).join('')}<td class="num"><b>${U.fmt(vals.reduce((a, b) => a + b, 0))}</b></td></tr>`; }).join('')}
      <tr class="kd-total"><td>Total</td>${colTot.map((v) => `<td class="num">${U.fmt(v)}</td>`).join('')}<td class="num">${U.fmt(colTot.reduce((a, b) => a + b, 0))}</td></tr></tbody></table></div></section>`;
  }
  /** data-kd-spec ke liye safe JSON (single quote escape) — drawer ke andar se filter badalne ke liye. */
  const specAttr = (obj) => esc(JSON.stringify(obj)).replace(/'/g, '&#39;');
  const stat = (label, value, sub, cls) => `<div class="kd-stat ${cls || ''}"><span>${esc(label)}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;

  // ---- issuance drill-down ---------------------------------------------------------------------
  async function issuanceDetail(spec) {
    const all = await issuanceRows(spec.src);
    const p = period(spec, all);
    const pp = previousPeriod(p);
    const filt = filterOf(spec.f);
    const pick = (per) => all.filter((r) => inP(r, per) && (!filt || filt.fn(r)) && rowMatchesSpec(r, spec));
    const cur = pick(p), prev = pick(pp);
    state.rows = cur; state.period = p; state.spec = spec; state.raw = null;
    const tot = total(cur), ptot = total(prev);
    const vc4 = total(cur.filter((r) => r.group === 'VC4')), comm = tot - vc4;
    const gv = total(cur.filter((r) => r.channel === 'GV Partner')), ff = tot - gv;
    const repl = total(cur.filter((r) => r.type === 'REPLACEMENT'));
    const chassis = total(cur.filter((r) => /chassis/i.test(r.vrnType)));
    const newVrn = tot - chassis - total(cur.filter((r) => /wrong/i.test(r.vrnType)));
    const days = [...new Set(cur.map((r) => r.key))].sort();
    const periodLabel = p.from === p.to ? `${U.labelDateKey(p.from, true)} (${U.weekday(U.fromDateKey(p.from))})` : `${U.labelDateKey(p.from, true)} → ${U.labelDateKey(p.to, true)}`;
    // 🟩 GV aaj = GV Master sheet (live) · 🟦 FF = EIR (T+1). Purane dinon ke liye EIR ledger.
    const srcLabel = spec.src === 'gv' ? 'GV Partner · GV Master sheet (live)' : spec.src === 'ff' ? 'First Forward issuance · EIR sheet (T+1)' : 'First Forward (EIR) + GV Partner (GV Master)';
    const byClass = tally(cur, (r) => r.cls), byClassPrev = tally(prev, (r) => r.cls);
    const byChannel = tally(cur, (r) => r.channel), byChannelPrev = tally(prev, (r) => r.channel);
    const byType = tally(cur, (r) => (r.type === 'REPLACEMENT' ? 'Replacement' : 'New issuance')), byTypePrev = tally(prev, (r) => (r.type === 'REPLACEMENT' ? 'Replacement' : 'New issuance'));
    const byVrn = tally(cur, (r) => vrnBucket(r.vrnType)), byVrnPrev = tally(prev, (r) => vrnBucket(r.vrnType));
    const byGroup = tally(cur, (r) => r.group), byGroupPrev = tally(prev, (r) => r.group);
    const dayTable = days.length > 1 ? `<section class="kd-sec"><h4>📅 Day-wise (${days.length} days)</h4><div class="table-wrap kd-scroll"><table class="tbl compact kd-tbl"><thead><tr><th>Date</th><th class="num">Total</th><th class="num">VC4</th><th class="num">Commercial</th><th class="num">First Forward</th><th class="num">GV</th><th class="num">Replacement</th><th class="num">Chassis</th></tr></thead><tbody>${days.slice().reverse().map((k) => { const rs = cur.filter((r) => r.key === k); const t = total(rs), v = total(rs.filter((r) => r.group === 'VC4')), g = total(rs.filter((r) => r.channel === 'GV Partner')); return `<tr class="clickable" data-kd-day="${k}"><td><b>${esc(U.labelDateKey(k))}</b> <small class="dim">${esc(U.weekday(U.fromDateKey(k)))}</small></td><td class="num"><b>${U.fmt(t)}</b></td><td class="num">${U.fmt(v)}</td><td class="num">${U.fmt(t - v)}</td><td class="num">${U.fmt(t - g)}</td><td class="num">${U.fmt(g)}</td><td class="num">${U.fmt(total(rs.filter((r) => r.type === 'REPLACEMENT')))}</td><td class="num">${U.fmt(total(rs.filter((r) => /chassis/i.test(r.vrnType))))}</td></tr>`; }).join('')}</tbody></table></div><p class="dim small">Kisi bhi din par click karo → us din ka poora breakdown.</p></section>` : '';
    const body = `<div class="kd-hero"><div><span class="kd-kicker">${esc(srcLabel)}</span><div class="kd-big">${U.fmt(tot)} <small>tags</small></div><div class="kd-sub">${esc(periodLabel)}${filt ? ` · filter: <b>${esc(filt.label)}</b>` : ''}</div></div><div class="kd-vs">${U.deltaHtml(U.growth(tot, ptot), { decimals: 0 })}<small>vs ${esc(pp.label)}: <b>${U.fmt(ptot)}</b></small></div></div>
      <div class="kd-stats">${stat('VC4 (payable)', U.fmt(vc4), pct(vc4, tot), 'blue')}${stat('Commercial', U.fmt(comm), pct(comm, tot), 'violet')}${stat('First Forward', U.fmt(ff), pct(ff, tot), 'indigo')}${stat('GV Partner', U.fmt(gv), pct(gv, tot), 'teal')}${stat('New issuance', U.fmt(tot - repl), pct(tot - repl, tot), 'green')}${stat('Replacement', U.fmt(repl), pct(repl, tot), 'amber')}${stat('Chassis', U.fmt(chassis), pct(chassis, tot), 'orange')}${stat('New / VRN', U.fmt(Math.max(0, newVrn)), pct(Math.max(0, newVrn), tot), 'sky')}</div>
      <div class="kd-chips">
        ${[['both', 'FF + GV'], ['ff', '🟦 First Forward only'], ['gv', '🟩 GV Partner only']].map(([s, label]) => `<button class="kd-chip ${spec.src === s ? 'green' : ''}" data-kd-spec='${specAttr({ src: s, f: '', agent: '', channel: '', title: `${spec.title || 'Detail'} · ${label}` })}'>${label}</button>`).join('')}
        ${[['vc4', 'VC4'], ['comm', 'Commercial'], ['vc20', 'VC20'], ['vc5p', 'VC5+'], ['repl', 'Replacement'], ['chassis', 'Chassis']].map(([fl, label]) => `<button class="kd-chip ${spec.f === fl ? 'green' : ''}" data-kd-spec='${specAttr({ f: fl, agent: '', channel: '', title: `${spec.title || 'Detail'} · ${label}` })}'>${label}</button>`).join('')}
        ${(spec.f || spec.agent || spec.channel) ? `<button class="kd-chip" data-kd-spec='${specAttr({ f: '', agent: '', channel: '', src: spec.src, title: spec.title })}'>↺ Clear</button>` : ''}
      </div>
      <div class="kd-grid">
        ${breakdownTable('🤝 Kis channel se — GV ya First Forward', byChannel, byChannelPrev, tot, { head: 'Channel', prevLabel: pp.label, drill: (key) => ({ src: /GV Partner/i.test(key) ? 'gv' : 'ff', channel: '', f: '', cls: '', type: '', vrnBucket: '', agent: '', agentId: '', title: `${spec.title || 'Detail'} · ${key}` }) })}
        ${breakdownTable('🚗 Class group', byGroup, byGroupPrev, tot, { head: 'Group', prevLabel: pp.label, sortCls: true, drill: (key) => ({ f: key === 'VC4' ? 'vc4' : key === 'VC20' ? 'vc20' : 'vc5p', cls: '', type: '', vrnBucket: '', title: `${spec.title || 'Detail'} · ${key}` }) })}
      </div>
      ${agentSection(cur, spec, tot)}
      ${breakdownTable('🏷️ Class-wise (har class kitne)', byClass, byClassPrev, tot, { head: 'Class', prevLabel: pp.label, sortCls: true, drill: (key) => ({ cls: key, f: '', type: '', vrnBucket: '', title: `${spec.title || 'Detail'} · ${key}` }) })}
      <div class="kd-grid">
        ${breakdownTable('🔁 New issuance vs Replacement', byType, byTypePrev, tot, { head: 'Type', prevLabel: pp.label, drill: (key) => ({ type: key === 'Replacement' ? 'REPLACEMENT' : 'NOT_REPLACEMENT', cls: '', f: '', vrnBucket: '', title: `${spec.title || 'Detail'} · ${key}` }) })}
        ${breakdownTable('🧩 Chassis / New VRN / Wrong VRN', byVrn, byVrnPrev, tot, { head: 'VRN type', prevLabel: pp.label, drill: (key) => ({ vrnBucket: key, cls: '', f: '', type: '', title: `${spec.title || 'Detail'} · ${key}` }) })}
      </div>
      ${matrix('🧮 Class × Issuance / Replacement', cur, (r) => r.cls, (r) => (r.type === 'REPLACEMENT' ? 'Replacement' : 'Issuance'), { head: 'Class', sortCls: true, drillRow: (key) => ({ cls: key, f: '', type: '', vrnBucket: '' }), drillCell: (cls, type) => ({ cls, f: '', type: type === 'Replacement' ? 'REPLACEMENT' : 'NOT_REPLACEMENT', vrnBucket: '' }) })}
      ${matrix('🧮 Class × Chassis / VRN', cur, (r) => r.cls, (r) => vrnBucket(r.vrnType).replace(/^New \/ VRN.*/, 'New / VRN'), { head: 'Class', sortCls: true, drillRow: (key) => ({ cls: key, f: '', type: '', vrnBucket: '' }), drillCell: (cls, bucket) => ({ cls, f: '', type: '', vrnBucket: bucket }) })}
      ${matrix('🧮 Class × Channel', cur, (r) => r.cls, (r) => r.channel, { head: 'Class', sortCls: true, drillRow: (key) => ({ cls: key, f: '', type: '', vrnBucket: '' }), drillCell: (cls, channel) => ({ cls, src: /GV Partner/i.test(channel) ? 'gv' : 'ff', channel: '', f: '', type: '', vrnBucket: '' }) })}
      ${dayTable}
      ${ffPendingNote()}
      <section class="kd-sec" id="kd-raw"><h4>📄 Poora data — sab ${U.fmt(tot)} tags (tag-level list)</h4>
        <p class="dim small">Har tag ki row: Tag ID, VRN, class, type, VRN type, status, agent, TL, channel. ${spec.src === 'gv' ? '' : 'First Forward rows Google Sheet (EIR) se abhi on-demand aayengi.'}</p>
        <div class="btn-row"><button class="btn primary" data-kd-raw>📄 Load all ${U.fmt(tot)} rows</button></div><div id="kd-raw-body"></div></section>`;
    return { kicker: `KPI detail · ${spec.page || ''}`, title: spec.title || 'KPI detail', sub: `${esc(periodLabel)} · <b>${U.fmt(tot)}</b> tags${filt ? ` · ${esc(filt.label)}` : ''}`, body, exportable: true };
  }
  /** 👥 "Kisne lagaye" — agent-wise (GV agent ya FF agent), poori clickable list.
      Har row par click → us agent ka poora detail (day-wise, class-wise, tags) usi drawer me. */
  function agentSection(cur, spec, tot) {
    if (!cur.length) return '';
    const map = new Map();
    cur.forEach((r) => {
      const name = r.agentName || r.agentId || 'Unknown';
      const key = `${r.channel}|${name}`;
      const a = map.get(key) || { name, channel: r.channel, tl: r.tlName || '', id: r.agentId || '', n: 0, vc4: 0, comm: 0, repl: 0, chassis: 0, days: new Set() };
      a.n += r.n; a.days.add(r.key);
      if (r.group === 'VC4') a.vc4 += r.n;
      if (r.group !== 'VC4') a.comm += r.n;
      if (r.type === 'REPLACEMENT') a.repl += r.n;
      if (/chassis/i.test(r.vrnType || '')) a.chassis += r.n;
      if (!a.tl && r.tlName) a.tl = r.tlName;
      if (!a.id && r.agentId) a.id = r.agentId;
      map.set(key, a);
    });
    const all = [...map.values()].sort((a, b) => b.n - a.n);
    const gv = all.filter((a) => a.channel === 'GV Partner');
    const ff = all.filter((a) => a.channel !== 'GV Partner');
    const top = all.slice(0, 60);
    const rows = top.map((a, i) => `<tr class="clickable" data-kd-agent="${esc(a.name)}" data-kd-agent-id="${esc(a.id || '')}" data-kd-agent-channel="${a.channel === 'GV Partner' ? 'gv' : 'ff'}" title="Click → ${esc(a.name)} ka poora detail">
      <td class="dim">${i + 1}</td>
      <td><b>${esc(a.name)}</b>${a.id ? ` <small class="dim">${esc(a.id)}</small>` : ''}</td>
      <td><span class="kd-badge ${a.channel === 'GV Partner' ? 'gv' : 'ff'}">${a.channel === 'GV Partner' ? '🟩 GV' : '🟦 FF'}</span></td>
      <td>${esc(a.tl || (a.channel === 'GV Partner' ? 'Direct' : '—'))}</td>
      <td class="num"><b>${U.fmt(a.n)}</b></td>
      <td class="num">${pct(a.n, tot)}</td>
      <td class="num">${U.fmt(a.vc4)}</td>
      <td class="num">${U.fmt(a.comm)}</td>
      <td class="num">${U.fmt(a.repl)}</td>
      <td class="num">${U.fmt(a.chassis)}</td>
      <td class="num">${U.fmt(a.days.size)}</td>
    </tr>`).join('');
    const tlTally = tally(cur, (r) => `${r.tlName || 'Direct'} · ${r.channel === 'GV Partner' ? 'GV' : 'FF'}`);
    return `<section class="kd-sec"><h4>👥 Kisne lagaye — agent-wise (GV agent ya FF agent) <span class="dim small">· ${all.length} agents · ${gv.length} GV · ${ff.length} FF</span></h4>
      <p class="dim small">Kisi bhi agent par click karo → uski day-wise, class-wise aur tag-level detail usi drawer me khulegi (andar tak click hota rahega).</p>
      <div class="table-wrap kd-scroll tall"><table class="tbl compact kd-tbl"><thead><tr><th>#</th><th>Agent</th><th>Channel</th><th>TL</th><th class="num">Tags</th><th class="num">Share</th><th class="num">VC4</th><th class="num">Comm.</th><th class="num">Repl.</th><th class="num">Chassis</th><th class="num">Days</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${all.length > top.length ? `<p class="dim small">Top ${top.length} dikhaye — poore ${all.length} agents ka Excel "⬇ Breakdown Excel" se milta hai.</p>` : ''}
      ${breakdownTable('🧑‍💼 TL-wise (channel ke saath)', tlTally, null, tot, { head: 'TL · channel' })}
    </section>`;
  }

  /** Ek agent ka poora detail — drawer ke andar se dobara drawer (deep click-through). */
  async function agentDetail(spec) {
    const name = spec.agent;
    const src = spec.src === 'ff' || spec.src === 'gv' ? spec.src : 'both';
    const wanted = [spec.agent, spec.agentId].map(personKey).filter(Boolean);
    const all = (await issuanceRows(src)).filter((r) => {
      if (!wanted.length || ![r.agentName, r.agentId].map(personKey).some((key) => wanted.includes(key))) return false;
      return rowMatchesSpec(r, spec);
    });
    const p = period(spec, all);
    const inRange = all.filter((r) => inP(r, p));
    const tot = total(inRange);
    const channel = inRange.length ? inRange[0].channel : (spec.channel === 'gv' ? 'GV Partner' : 'First Forward');
    const tl = inRange.reduce((t, r) => t || r.tlName, '');
    const id = inRange.reduce((t, r) => t || r.agentId, '');
    const byDay = tally(inRange, (r) => r.key);
    const byCls = tally(inRange, (r) => r.cls);
    const byGroup = tally(inRange, (r) => r.group);
    const byType = tally(inRange, (r) => (r.type === 'REPLACEMENT' ? 'Replacement' : 'New issuance'));
    const byVrn = tally(inRange, (r) => vrnBucket(r.vrnType));
    const days = [...byDay.keys()].sort();
    const periodLabel = p.from === p.to ? U.labelDateKey(p.from, true) : `${U.labelDateKey(p.from, true)} → ${U.labelDateKey(p.to, true)}`;
    const otherRows = (await issuanceRows('both')).filter((r) => (r.agentName || '') !== name);
    const rank = [...tally(otherRows.concat(inRange), (r) => r.agentName || r.agentId || '—').entries()].sort((a, b) => b[1] - a[1]).findIndex(([k]) => k === name) + 1;
    state.rows = inRange; state.period = p; state.spec = spec; state.raw = null;
    const body = `<div class="kd-hero"><div><span class="kd-kicker">${esc(channel === 'GV Partner' ? '🟩 GV Partner agent' : '🟦 First Forward agent')}</span><div class="kd-big">${U.fmt(tot)} <small>tags</small></div><div class="kd-sub">${esc(periodLabel)}${tl ? ` · TL <b>${esc(tl)}</b>` : ''}${id ? ` · ID ${esc(id)}` : ''}${rank > 0 ? ` · rank #${rank}` : ''}</div></div>
      <div class="kd-acts"><a class="btn small" href="#/performance?agent=${encodeURIComponent(name)}">🏆 Performance →</a><a class="btn small" href="#/masterSearch?q=${encodeURIComponent(name)}">🔎 Master profile →</a></div></div>
      <div class="kd-stats">${stat('VC4 (payable)', U.fmt(total(inRange.filter((r) => r.group === 'VC4'))), pct(total(inRange.filter((r) => r.group === 'VC4')), tot), 'blue')}${stat('Commercial', U.fmt(total(inRange.filter((r) => r.group !== 'VC4'))), pct(total(inRange.filter((r) => r.group !== 'VC4')), tot), 'violet')}${stat('Chassis', U.fmt(total(inRange.filter((r) => /chassis/i.test(r.vrnType)))), '', 'orange')}${stat('Replacement', U.fmt(total(inRange.filter((r) => r.type === 'REPLACEMENT'))), '', 'amber')}${stat('Active days', U.fmt(days.length), days.length ? `${U.fmt(Math.round(tot / days.length))}/day` : '', 'green')}</div>
      <div class="kd-grid">${breakdownTable('🚗 Class group', byGroup, null, tot, { head: 'Group', sortCls: true, drill: (key) => ({ f: key === 'VC4' ? 'vc4' : key === 'VC20' ? 'vc20' : 'vc5p', cls: '', type: '', vrnBucket: '' }) })}${breakdownTable('🔁 Type', byType, null, tot, { head: 'Type', drill: (key) => ({ type: key === 'Replacement' ? 'REPLACEMENT' : 'NOT_REPLACEMENT', cls: '', f: '', vrnBucket: '' }) })}</div>
      ${breakdownTable('🏷️ Class-wise', byCls, null, tot, { head: 'Class', sortCls: true, drill: (key) => ({ cls: key, f: '', type: '', vrnBucket: '' }) })}
      ${breakdownTable('🧩 VRN type', byVrn, null, tot, { head: 'VRN type', drill: (key) => ({ vrnBucket: key, cls: '', f: '', type: '' }) })}
      <section class="kd-sec"><h4>📅 Day-wise (${days.length} din)</h4><div class="table-wrap kd-scroll"><table class="tbl compact kd-tbl"><thead><tr><th>Date</th><th class="num">Tags</th><th class="num">VC4</th><th class="num">Commercial</th></tr></thead><tbody>${days.slice().reverse().map((k) => { const rs = inRange.filter((r) => r.key === k); const t = total(rs), v = total(rs.filter((r) => r.group === 'VC4')); return `<tr class="clickable" data-kd-agent-day="${k}"><td><b>${esc(U.labelDateKey(k))}</b> <small class="dim">${esc(U.weekday(U.fromDateKey(k)))}</small></td><td class="num"><b>${U.fmt(t)}</b></td><td class="num">${U.fmt(v)}</td><td class="num">${U.fmt(t - v)}</td></tr>`; }).join('')}</tbody></table></div></section>`;
    return { kicker: 'KPI detail · Agent', title: `${name} · ${channel === 'GV Partner' ? 'GV' : 'FF'} agent`, sub: `${esc(periodLabel)} · <b>${U.fmt(tot)}</b> tags`, body, exportable: true, agent: name, period: p, spec };
  }

  // ---- raw tag-level rows ---------------------------------------------------------------------
  // 📄 Last level = sheet ki asli rows. GV rows GV Master tab se (serial/barcode ke saath),
  //    FF rows EIR tab se — dono LIVE sheet se nikalkar dikhaye jaate hain.
  const RAW_HEAD = ['Date', 'Tag ID', 'VRN', 'Class', 'Type', 'VRN type', 'Status', 'Agent', 'Agent ID', 'TL', 'Channel', 'Barcode / serial'];
  /** 🟩 GV Master sheet ki live rows (date range + spec filter) — asli sheet data, koi extra query nahi. */
  function gvMasterRawRows(spec, p) {
    const G = FF.gv;
    if (!G || typeof G.rows !== 'function') return [];
    const filt = filterOf(spec.f);
    const wanted = [spec.agent, spec.agentId].map(personKey).filter(Boolean);
    const out = [];
    for (const r of G.rows()) {
      const key = r.date ? U.dateKey(r.date) : '';
      if (!key || key < p.from || key > p.to) continue;
      const type = /replacement/i.test(r.status || '') ? 'REPLACEMENT' : 'ISSUANCE';
      const row = {
        key, tagId: r.tagId || '', vrn: r.vrn || '', cls: r.cls, group: r.group, type,
        vrnType: r.tagType || '', status: r.status || '', channel: 'GV Partner',
        agentName: r.agentName || '', agentId: r.agentId || '', tlName: r.tlName || '',
        barcode: r.serial || '', amount: Number(r.amount) || 0, commission: Number(r.commission) || 0, n: 1
      };
      if (filt && !filt.fn(row)) continue;
      if (wanted.length && ![row.agentName, row.agentId].map(personKey).some((k) => wanted.includes(k))) continue;
      if (!rowMatchesSpec(row, spec)) continue;
      out.push([row.key, row.tagId, row.vrn, row.cls, row.type, row.vrnType, row.status, row.agentName, row.agentId, row.tlName, row.channel, row.barcode]);
    }
    return out;
  }

  async function loadRaw() {
    const spec = state.spec, p = state.period;
    const out = [];
    const wantGv = spec.src === 'gv' || spec.src === 'both';
    const wantFf = spec.src === 'ff' || spec.src === 'both';
    // 🟩 GV side — GV Master tab se (live). Master load ho chuka hai to Google par dobara query nahi.
    const gvRows = wantGv ? gvMasterRawRows(spec, p) : [];
    const gvFromMaster = !!(FF.gv && typeof FF.gv.get === 'function' && Array.isArray(FF.gv.get('master')));
    out.push(...gvRows);
    // 🟦 FF side (aur GV ka fallback jab GV Master load na hua ho) — EIR tab se.
    const needsEir = wantFf || (wantGv && !gvFromMaster);
    if (needsEir) {
      const e = FF.config.eir;
      const cols = [e.date, e.tagId, e.vrn, e.cls, e.type, e.vrnType, e.status, e.agentName, e.agentId, e.tlName, e.masterId, e.gvName, e.gvId];
      const tq = `select ${cols.join(', ')} where toDate(${e.date}) >= date '${p.from}' and toDate(${e.date}) <= date '${p.to}' order by ${e.date} desc limit 60000`;
      const t = await FF.data.query(e.sheet, tq, {});
      const D = FF.data;
      const filt = filterOf(spec.f);
      for (const r of t.rows) {
        const d = D.cellDate(r[0]);
        const cls = (() => { const c = D.cellText(r[3]).toUpperCase().trim(); return /^\d+$/.test(c) ? `VC${c}` : c || 'NA'; })();
        const channel = FF.model.channelOf(D.cellText(r[10]), D.cellText(r[9]));
        // GV rows sirf tab jab master available na ho (warna GV Master hi authority hai).
        if (channel === 'GV Partner' ? !wantGv || gvFromMaster : !wantFf) continue;
        // 🔁 FF T+1: jo FF rows abhi reported nahi (aaj) wo FF/both list me bhi nahi aati.
        if (channel !== 'GV Partner' && FF.filters && FF.filters.ffLagOn && FF.filters.ffLagOn() && !FF.filters.ffVisible({ key: d ? U.dateKey(d) : '', channel })) continue;
        const agentName = channel === 'GV Partner' ? (D.cellText(r[11]) || D.cellText(r[7])) : (D.cellText(r[7]) || D.cellText(r[11]));
        const agentId = channel === 'GV Partner' ? (D.cellText(r[12]) || D.cellText(r[8])) : (D.cellText(r[8]) || D.cellText(r[12]));
        const wanted = [spec.agent, spec.agentId].map(personKey).filter(Boolean);
        if (wanted.length && ![agentName, agentId].map(personKey).some((key) => wanted.includes(key))) continue;
        const row = { key: d ? U.dateKey(d) : '', tagId: D.cellText(r[1]), cls, group: FF.model.classGroup(cls), type: D.cellText(r[4]).toUpperCase() || 'ISSUANCE', vrnType: D.cellText(r[5]), channel, agentName, agentId, tlName: D.cellText(r[9]), n: 1, barcode: '' };
        if (filt && !filt.fn(row)) continue;
        if (!rowMatchesSpec(row, spec)) continue;
        out.push([row.key, D.cellText(r[1]), D.cellText(r[2]), cls, row.type, row.vrnType, D.cellText(r[6]), agentName, agentId, D.cellText(r[9]), channel, '']);
      }
    }
    out.sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
    state.raw = out;
    state.rawGv = gvRows.length;
    state.rawSrc = gvFromMaster && wantGv ? (wantFf ? 'EIR (FF) + GV Master (GV)' : 'GV Master') : (wantGv && wantFf ? 'EIR (FF + GV)' : wantFf ? 'EIR' : 'EIR');
    return out;
  }
  function renderRaw(filter) {
    const el = U.$('#kd-raw-body');
    if (!el || !state.raw) return;
    const q = String(filter || '').trim().toLowerCase();
    const rows = q ? state.raw.filter((r) => r.join(' ').toLowerCase().includes(q)) : state.raw;
    const show = rows.slice(0, 500);
    const byAgent = new Map(), byTl = new Map();
    rows.forEach((r) => { byAgent.set(r[7] || '—', (byAgent.get(r[7] || '—') || 0) + 1); byTl.set(r[9] || '—', (byTl.get(r[9] || '—') || 0) + 1); });
    const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `<span class="kd-chip">${esc(k)} <b>${U.fmt(v)}</b></span>`).join('');
    el.innerHTML = `<div class="kd-raw-tools"><input class="input" id="kd-raw-q" placeholder="Search: tag / VRN / barcode / agent / TL / class…" value="${esc(filter || '')}">${FF.auth.can('export') ? '<button class="btn small" data-kd-xlsx>⬇ Excel (all rows)</button><button class="btn small" data-kd-csv>⬇ CSV</button>' : ''}</div>
      <div class="kd-chips"><span class="dim small">Top TLs:</span>${top(byTl)}</div><div class="kd-chips"><span class="dim small">Top agents:</span>${top(byAgent)}</div>
      <p class="dim small">${U.fmt(rows.length)} rows${q ? ` (search "${esc(q)}")` : ''}${rows.length > show.length ? ` · pehli ${show.length} dikh rahi hain — sab ke liye Excel download karo` : ''} · Source: <b>${esc(state.rawSrc || 'sheet')}</b> (ye rows seedha Google Sheet se aayi hain).</p>
      <div class="table-wrap kd-scroll tall"><table class="tbl compact kd-tbl"><thead><tr>${RAW_HEAD.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${show.map((r) => `<tr class="clickable" data-kd-tag="${esc(r[1] || '')}" data-kd-tag-date="${esc(r[0] || '')}" title="Click for this tag’s details">${r.map((v, i) => `<td${i === 0 ? ' class="nowrap"' : ''}>${esc(i === 11 ? U.barcode(v) : (v || ''))}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${RAW_HEAD.length}" class="empty">Koi row nahi mili.</td></tr>`}</tbody></table></div>`;
    const input = U.$('#kd-raw-q');
    if (input) { input.addEventListener('input', U.debounce(() => { renderRaw(input.value); const again = U.$('#kd-raw-q'); if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); } }, 300)); }
  }

  // ---- stock / agents / status drill-downs ------------------------------------------------------
  async function stockDetail(spec) {
    const parts = [];
    let grand = 0;
    if (spec.src === 'ff' || spec.src === 'both') {
      let stock = FF.store.get('stock'), agents = FF.store.get('stockAgents'), types = FF.store.get('stockTypes');
      try { stock = stock || await FF.store.need('stock'); } catch { stock = []; }
      try { agents = agents || await FF.store.need('stockAgents'); } catch { agents = []; }
      try { types = types || await FF.store.need('stockTypes'); } catch { types = []; }
      const rows = (stock || []).map((r) => ({ ...r, n: r.n }));
      const tot = total(rows); grand += tot;
      const byType = new Map(); (types || []).forEach((r) => byType.set(r.tagType || '—', (byType.get(r.tagType || '—') || 0) + r.n));
      const byAgent = new Map(); (agents || []).forEach((r) => byAgent.set(`${r.agentName} · ${r.tlName}`, (byAgent.get(`${r.agentName} · ${r.tlName}`) || 0) + r.n));
      parts.push(`<h3 class="kd-h">🟦 First Forward stock (StockDataa) · <b>${U.fmt(tot)}</b></h3>
        <div class="kd-grid">${breakdownTable('Class-wise', tally(rows, (r) => r.cls), null, tot, { head: 'Class', sortCls: true })}${breakdownTable('Tag type', byType, null, total([...byType.values()].map((n) => ({ n }))), { head: 'Tag type' })}</div>
        ${breakdownTable('TL-wise stock', tally(rows, (r) => (FF.config.isDirectAgent(r, 'gv') ? FF.config.directLabel(r, 'gv') : r.tlName)), null, tot, { head: 'TL' })}
        ${matrix('TL × class', rows, (r) => (FF.config.isDirectAgent(r, 'gv') ? FF.config.directLabel(r, 'gv') : r.tlName), (r) => r.cls, { head: 'TL' })}
        ${breakdownTable('Top 30 agents (stock)', new Map([...byAgent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)), null, tot, { head: 'Agent · TL' })}`);
    }
    if (spec.src === 'gv' || spec.src === 'both') {
      const G = FF.gv; let cls = [], tls = [], agents = [];
      try { cls = await G.need('stockClass'); } catch { /* */ }
      try { tls = await G.need('stockTl'); } catch { /* */ }
      try { agents = await G.need('stockAgent'); } catch { /* */ }
      const tot = total(cls || []); grand += tot;
      parts.push(`<h3 class="kd-h">🟩 GV Partner stock (Tag Assignment) · <b>${U.fmt(tot)}</b></h3>
        <div class="kd-grid">${breakdownTable('Class-wise', tally(cls || [], (r) => r.cls), null, tot, { head: 'Class', sortCls: true })}${breakdownTable('TL-wise', tally(tls || [], (r) => (r.directAgent === true || !FF.config.isRealTl(r.tlName) ? FF.config.directLabel({ tlName: r.tlName, channel: 'GV Partner' }, 'gv') : r.tlName)), null, total(tls || []), { head: 'TL' })}</div>
        ${breakdownTable('Top 30 agents (stock)', new Map((agents || []).slice(0, 30).map((a) => [`${a.agentName} · ${a.tlName || '—'}`, a.n])), null, tot, { head: 'Agent · TL' })}`);
    }
    const btn = (kind, label) => `<button class="btn primary" data-kd-sheetrows="${kind}">📄 ${label}</button>`;
    const rawBtns = [];
    if (spec.src === 'ff' || spec.src === 'both') rawBtns.push(btn('ff-stock', 'StockDataa rows load karo'));
    if (spec.src === 'gv' || spec.src === 'both') rawBtns.push(btn('gv-stock', 'Tag Assignment rows load karo'));
    if (rawBtns.length) {
      parts.push(`<section class="kd-sec"><h4>📄 Poora data — sheet ki tag-level rows</h4>
        <p class="dim small">Last level: yahan se seedha us sheet tab ki asli rows (barcode/serial ke saath) load hongi${spec.agent ? ` · filter: <b>${esc(spec.agent)}</b>` : ''}.</p>
        <div class="btn-row">${rawBtns.join('')}</div><div id="kd-rows"><div class="empty">Abhi load nahi hua.</div></div></section>`);
    }
    return { kicker: 'KPI detail · Stock', title: spec.title || 'Stock in field', sub: `Total <b>${U.fmt(grand)}</b> tags in field`, body: parts.join('') || '<div class="empty">Stock data nahi mila.</div>' };
  }
  // ---- 🗂️ Sheet rows (leaf level): stock tabs ki asli tag-level rows --------------------------------
  //  Har stock KPI drawer ke aakhir me "sheet ki asli rows" — StockDataa (FF) ya Tag Assignment (GV).
  //  Barcode/serial display format me (608116-011-0558601) aur Excel/CSV download bhi.
  function sheetRowsHtml(title, header, rows, note) {
    const bcCols = [];
    header.forEach((h, i) => { if (/barcode|serial/i.test(String(h || ''))) bcCols.push(i); });
    const show = rows.slice(0, 800);
    const cell = (v, i) => esc(bcCols.includes(i) ? U.barcode(v) : (v || ''));
    return `<section class="kd-sec"><h4>📄 ${esc(title)} — <span class="dim">${U.fmt(rows.length)} rows (${esc(note)})</span></h4>
      <div class="btn-row">${FF.auth.can('export') ? '<button class="btn small" data-kd-sheetrows-xlsx>⬇ Excel (all rows)</button><button class="btn small" data-kd-sheetrows-csv>⬇ CSV</button>' : ''}<span class="dim small">Ye rows seedha sheet tab se aayi hain${rows.length > show.length ? ` · pehli ${U.fmt(show.length)} dikh rahi hain` : ''}.</span></div>
      <div class="table-wrap kd-scroll tall"><table class="tbl compact kd-tbl"><thead><tr>${header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${show.map((r) => `<tr>${r.map((v, i) => `<td>${cell(v, i)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${header.length}" class="empty">Koi row nahi mili.</td></tr>`}</tbody></table></div></section>`;
  }
  /** FF StockDataa / GV Tag Assignment ki tag-level rows (spec ke agent/tl/cls filter ke saath). */
  async function loadStockSheetRows(kind, spec) {
    const D = FF.data;
    const A = FF.config.gv.assignment || {};
    const S = FF.config.stock;
    const agent = U.clean(spec.agent);
    if (kind === 'gv-stock') {
      const cols = [...new Set([A.cls, A.tagId, A.serial, A.status, A.agentId, A.agentName, A.tlId, A.tlName, A.gvUniqueId, A.gvUniqueName].filter(Boolean))];
      const where = agent ? ` where lower(${A.agentName}) = ${D.lit(agent.toLowerCase())}` : '';
      const t = await D.query(A.tab || 'Tag Assignment', `select ${cols.join(', ')}${where} limit 50000`, {});
      return { header: t.cols.map((c) => c.label || c.id), rows: D.textRows(t), title: `${A.tab || 'Tag Assignment'} (GV stock)` };
    }
    const cols = [...new Set([S.tagId, S.barcode, S.cls, S.tagType, S.agentId, S.agentName, S.tlName, S.bcAllocatedAt, S.agentAllocatedAt].filter(Boolean))];
    const where = [];
    if (agent) where.push(`lower(${S.agentName}) = ${D.lit(agent.toLowerCase())}`);
    if (spec.cls) where.push(`${S.cls} = ${D.lit(String(spec.cls).replace(/^VC/i, ''))}`);
    const t = await D.query(S.sheet || 'StockDataa', `select ${cols.join(', ')}${where.length ? ` where ${where.join(' and ')}` : ''} limit 50000`, {});
    return { header: t.cols.map((c) => c.label || c.id), rows: D.textRows(t), title: `${S.sheet || 'StockDataa'} (FF stock)` };
  }
  async function stockSheetRowsSection(host, kind, spec) {
    if (!host) return;
    host.innerHTML = U.spinner('Google Sheet se tag-level rows aa rahi hain…');
    try {
      const out = await loadStockSheetRows(kind, spec);
      state.sheetRows = out;
      host.innerHTML = sheetRowsHtml(out.title, out.header, out.rows, 'Google Sheet se live');
    } catch (err) {
      host.innerHTML = U.errorBox(err);
    }
  }

  async function stockReportDetail(spec) {
    if (FF.pages.performance && FF.pages.performance.ensureLoaded) { try { await FF.pages.performance.ensureLoaded(); } catch (err) { console.warn('stock report', err); } }
    const agents = (FF.pages.performance && FF.pages.performance.agents ? FF.pages.performance.agents() : []).filter((a) => !a.isMaster);
    if (!agents.length) return stockDetail({ ...spec, src: 'ff' });
    const keys = [['VC4', 'stockVc4'], ['VC5', 'stockC1'], ['VC6', 'stockC2'], ['VC7', 'stockC3'], ['VC12', 'stockC4'], ['VC16', 'stockC5']];
    const cls = new Map(keys.map(([l, k]) => [l, U.sum(agents, (a) => a[k] || 0)]));
    const tot = U.sum(agents, (a) => a.stockTotal || 0);
    const byTl = new Map(); agents.forEach((a) => { const k = a.tlExcluded ? FF.config.directLabel(a, 'ff') : (a.tlName || '—'); byTl.set(k, (byTl.get(k) || 0) + (a.stockTotal || 0)); });
    const alerts = new Map(); agents.forEach((a) => { const k = String(a.tlStockAlert || '—').replace(/^[^\w]+/u, ''); alerts.set(k, (alerts.get(k) || 0) + 1); });
    const prio = new Map(); agents.forEach((a) => { const k = a.priority || '—'; prio.set(k, (prio.get(k) || 0) + 1); });
    const topAgents = new Map([...agents].sort((a, b) => (b.stockTotal || 0) - (a.stockTotal || 0)).slice(0, 30).map((a) => [`${a.name} · ${a.tlExcluded ? FF.config.directLabel(a, 'ff') : a.tlName}`, a.stockTotal || 0]));
    return { kicker: 'KPI detail · Stock Report', title: spec.title || 'Stock Report', sub: `REPORT → Agent Inventory Summary · <b>${U.fmt(tot)}</b> tags · ${agents.length} agents`, body: `<div class="kd-grid">${breakdownTable('Class-wise stock', cls, null, tot, { head: 'Class', sortCls: true })}${breakdownTable('Dispatch priority (agents)', prio, null, agents.length, { head: 'Priority' })}</div>${breakdownTable('TL stock alert (agents)', alerts, null, agents.length, { head: 'Alert' })}${breakdownTable('TL-wise stock', byTl, null, tot, { head: 'TL' })}${breakdownTable('Top 30 agents by stock', topAgents, null, tot, { head: 'Agent · TL' })}` };
  }
  async function agentsDetail(spec) {
    const out = [];
    let ym = spec.ym;
    if (spec.src === 'ff' || spec.src === 'both') {
      let agents = FF.store.get('agents'); try { agents = agents || await FF.store.need('agents'); } catch { agents = []; }
      const daily = FF.store.get('daily') || [];
      ym = ym || (FF.model.latestDate(daily) ? U.ymKey(FF.model.latestDate(daily)) : U.ymKey(new Date()));
      const cur = (agents || []).filter((a) => a.ym === ym && (spec.src === 'ff' || a.channel !== 'GV Partner'));
      const per = new Map(); cur.forEach((a) => { const k = a.key; const x = per.get(k) || { name: a.name, tl: a.tlName, channel: a.channel, n: 0 }; x.n += a.n; per.set(k, x); });
      const list = [...per.values()].sort((a, b) => b.n - a.n);
      const byCh = new Map(); list.forEach((a) => byCh.set(a.channel, (byCh.get(a.channel) || 0) + 1));
      const byTl = new Map(); list.forEach((a) => byTl.set(a.tl, (byTl.get(a.tl) || 0) + 1));
      out.push(`<h3 class="kd-h">🟦 First Forward · active agents ${esc(U.labelYM(ym))}: <b>${U.fmt(list.length)}</b></h3><div class="kd-grid">${breakdownTable('Channel', byCh, null, list.length, { head: 'Channel' })}${breakdownTable('Agents per TL', new Map([...byTl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)), null, list.length, { head: 'TL' })}</div>
        <section class="kd-sec"><h4>All active agents (${list.length})</h4><div class="table-wrap kd-scroll tall"><table class="tbl compact kd-tbl"><thead><tr><th>#</th><th>Agent</th><th>TL</th><th>Channel</th><th class="num">Tags</th></tr></thead><tbody>${list.map((a, i) => `<tr><td class="dim">${i + 1}</td><td><b>${esc(a.name)}</b></td><td>${esc(a.tl)}</td><td>${esc(a.channel)}</td><td class="num"><b>${U.fmt(a.n)}</b></td></tr>`).join('')}</tbody></table></div></section>`);
    }
    if (spec.src === 'gv' || spec.src === 'both') {
      const rows = gvIssuanceRows();
      const gym = ym || (latestKey(rows) || U.dateKey(new Date())).slice(0, 7);
      const cur = rows.filter((r) => r.ym === gym);
      const per = new Map(); cur.forEach((r) => { const k = r.agentId || r.agentName; const x = per.get(k) || { name: r.agentName || r.agentId, tl: r.tlName || 'Direct', n: 0 }; x.n += Number(r.n) || 1; per.set(k, x); });
      const list = [...per.values()].sort((a, b) => b.n - a.n);
      out.push(`<h3 class="kd-h">🟩 GV Partner · active agents ${esc(U.labelYM(gym))}: <b>${U.fmt(list.length)}</b></h3><section class="kd-sec"><div class="table-wrap kd-scroll tall"><table class="tbl compact kd-tbl"><thead><tr><th>#</th><th>Agent</th><th>TL</th><th class="num">Tags</th></tr></thead><tbody>${list.map((a, i) => `<tr><td class="dim">${i + 1}</td><td><b>${esc(a.name)}</b></td><td>${esc(a.tl)}</td><td class="num"><b>${U.fmt(a.n)}</b></td></tr>`).join('')}</tbody></table></div></section>`);
    }
    return { kicker: 'KPI detail · Agents', title: spec.title || 'Active agents', sub: 'Month-to-date active agents (kam se kam 1 tag issue kiya)', body: out.join('') };
  }
  async function statusDetail(spec) {
    let status = FF.store.get('status'); try { status = status || await FF.store.need('status'); } catch { status = []; }
    const daily = FF.store.get('daily') || [];
    const ym = spec.ym || (FF.model.latestDate(daily) ? U.ymKey(FF.model.latestDate(daily)) : U.ymKey(new Date()));
    const cur = (status || []).filter((s) => s.ym === ym), prev = (status || []).filter((s) => s.ym === U.prevMonthKey(ym));
    const m = tally(cur, (s) => s.status), pm = tally(prev, (s) => s.status);
    return { kicker: 'KPI detail · Tag status', title: spec.title || 'Tag status', sub: `${esc(U.labelYM(ym))} · <b>${U.fmt(total(cur))}</b> tags`, body: breakdownTable('Status-wise', m, pm, total(cur), { head: 'Status', prevLabel: U.labelYM(U.prevMonthKey(ym)) }) };
  }

  // ---- GV agent stock drill-down ----------------------------------------------------------------
  async function agentStockDetail(spec) {
    const G = FF.gv, agent = String(spec.agent || '');
    let rows = G.get('stockAgentClass');
    if (!rows) { try { rows = await G.need('stockAgentClass'); } catch { rows = []; } }
    let matches = (rows || []).filter((r) => personKey(r.agentName) === personKey(agent));
    if (!matches.length && spec.agentId) {
      try {
        const a = (FF.config.gv || {}).assignment || {};
        const q = `select ${a.agentId || 'E'}, ${a.cls || 'A'}, count(${a.tagId || 'B'}) where ${a.agentId || 'E'} = ${FF.data.lit(spec.agentId)} group by ${a.agentId || 'E'}, ${a.cls || 'A'}`;
        const table = await FF.data.query('Tag Assignment', q, {});
        matches = table.rows.map((r) => ({ agentName: agent, cls: classKey(FF.data.cellText(r[1])), n: FF.data.cellNumber(r[2]) || 0 })).filter((r) => r.n > 0);
      } catch { /* fall back to the name-based summary */ }
    }
    const selected = matches.filter((r) => !spec.cls || classKey(r.cls) === classKey(spec.cls));
    const n = U.sum(selected, (r) => Number(r.n) || 0);
    let content;
    if (!spec.cls) {
      const byClass = new Map(matches.map((r) => [r.cls, Number(r.n) || 0]));
      content = breakdownTable('Agent stock by class', byClass, null, n, { head: 'Class', sortCls: true, drill: (cls) => ({ ...spec, cls, title: `${agent} · ${cls} stock` }) });
    } else {
      const a = (FF.config.gv || {}).assignment || {};
      const tagId = a.tagId || 'B', serial = a.serial || 'C', status = a.status || 'D', agentId = a.agentId || 'E', agentName = a.agentName || 'F', tlName = a.tlName || 'H';
      const whoCol = spec.agentId && a.agentId ? a.agentId : agentName;
      const whoValue = spec.agentId && a.agentId ? spec.agentId : agent;
      const query = `select ${a.cls || 'A'}, ${tagId}, ${serial}, ${status}, ${agentId}, ${agentName}, ${tlName} where ${whoCol} = ${FF.data.lit(whoValue)} limit 5000`;
      try {
        const table = await FF.data.query('Tag Assignment', query, {});
        const columns = table.cols.map((col) => col.label || col.id), dataRows = FF.data.textRows(table).filter((r) => classKey(r[0]) === classKey(spec.cls));
        content = `<p class="dim small">Tag Assignment source · ${dataRows.length} ${esc(spec.cls)} rows (agent query limited to 5,000).</p><div class="table-wrap kd-scroll tall"><table class="tbl compact kd-tbl"><thead><tr>${columns.map((col) => `<th>${esc(col)}</th>`).join('')}</tr></thead><tbody>${dataRows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${columns.length}" class="empty">${esc(agent)} ke ${esc(spec.cls)} stock ki row nahi mili.</td></tr>`}</tbody></table></div>`;
      } catch (err) { content = U.errorBox(err); }
    }
    state.spec = spec; state.rows = null; state.raw = null;
    return { kicker: 'KPI detail · GV agent stock', title: `${agent} · stock`, sub: `${spec.cls ? `${esc(spec.cls)} · ` : ''}<b>${U.fmt(n)}</b> tags in Tag Assignment`, body: content || '<div class="empty">Is agent ka stock data nahi mila.</div>' };
  }
  async function tagDetail(spec) {
    const available = await issuanceRows(spec.src || 'both');
    state.spec = spec; state.period = period(spec, available); state.rows = null; state.raw = null;
    const matches = await loadRaw();
    const row = matches[0];
    // 🏷️ Barcode yahin visibly dashed format me dikhta hai (sheet me 16 digit number ho to bhi).
    const cells = RAW_HEAD.map((label, i) => `<tr><th>${esc(label)}</th><td>${esc(i === 11 ? U.barcode(row[i]) : (row[i] || ''))}</td></tr>`);
    if (row && FF.gv && typeof FF.gv.rows === 'function') {
      const hit = FF.gv.rows().find((g) => U.clean(g.tagId) === U.clean(spec.tagId) && (!spec.date || !g.date || U.dateKey(g.date) === spec.date));
      if (hit) {
        cells.push(`<tr><th>GV unique ID</th><td>${esc(hit.gvUniqueId || '—')}</td></tr>`);
        cells.push(`<tr><th>Amount</th><td>${esc(U.money ? U.money(hit.amount) : hit.amount)}</td></tr>`);
        cells.push(`<tr><th>Commission</th><td>${esc(U.money ? U.money(hit.commission) : hit.commission)}</td></tr>`);
      }
    }
    const body = row ? `<p class="dim small">Source: ${esc(state.rawSrc || row[10] || '')} · sheet ki asli row · click back to return to the full list.</p><div class="table-wrap"><table class="tbl compact kd-tbl"><tbody>${cells.join('')}</tbody></table></div>` : '<div class="empty">Is Tag ID ke liye source row nahi mili.</div>';
    const bar = row ? U.barcode(row[11]) : '';
    return { kicker: 'KPI detail · Tag record', title: `Tag ${spec.tagId}`, sub: `${bar ? `🏷️ ${esc(bar)} · ` : ''}${esc(spec.date || '')} · ${esc(spec.agent || '')}`, body };
  }

  // ---- open ------------------------------------------------------------------------------------
  async function open(cardOrSpec, opts = {}) {
    const spec = cardOrSpec && cardOrSpec.nodeType ? specFrom(cardOrSpec) : { ...(cardOrSpec || {}) };
    const drawerOpen = !!(U.$('#drawer') && U.$('#drawer').classList.contains('open'));
    const nested = opts.nested !== undefined ? opts.nested : (drawerOpen && !!state.spec);
    if (nested && state.spec && !opts.fromHistory) state.history.push({ ...state.spec });
    else if (!nested && !opts.fromHistory) state.history = [];
    if (!spec.src) spec.src = PAGE_SRC[currentPage()] || 'both';
    if (!spec.scope) spec.scope = 'mtd';
    FF.app.openDrawer({ kicker: 'KPI detail', title: spec.title || 'KPI detail', sub: 'Breakdown taiyaar ho raha hai…', body: U.spinner('Detail calculate ho rahi hai…'), wide: true });
    if (FF.notifications && FF.notifications.track) FF.notifications.track('kpi', `KPI opened: ${spec.title || spec.scope}`);
    try {
      const view = spec.tagId ? await tagDetail(spec)
        : spec.agent && spec.scope === 'stock' ? await agentStockDetail(spec)
          : spec.agent ? await agentDetail(spec)
          : spec.scope === 'stock' ? await stockDetail(spec)
          : spec.scope === 'stockreport' ? await stockReportDetail(spec)
            : spec.scope === 'agents' ? await agentsDetail(spec)
              : spec.scope === 'status' ? await statusDetail(spec)
                : await issuanceDetail(spec);
      const cardInfo = spec.foot ? `<div class="kd-card-foot">Card: ${esc(spec.foot)}</div>` : '';
      const back = nested && state.history.length ? '<button class="btn small" data-kd-back>← Back</button>' : '';
      const exportBtn = view.exportable && FF.auth.can('export') ? '<button class="btn small" data-kd-summary-xlsx>⬇ Breakdown Excel</button>' : '';
      FF.app.openDrawer({ kicker: view.kicker, title: view.title, sub: view.sub, body: cardInfo + view.body, wide: true, actions: back + exportBtn });
    } catch (err) {
      const back = nested && state.history.length ? '<button class="btn small" data-kd-back>← Back</button>' : '';
      FF.app.openDrawer({ kicker: 'KPI detail', title: spec.title || 'KPI detail', body: U.errorBox(err), wide: true, actions: back });
    }
  }
  function summaryExport() {
    if (!state.rows) return;
    const cur = state.rows, tot = total(cur);
    const sheet = (name, m) => ({ name, header: [name, 'Count', 'Share %'], rows: [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v, Math.round((v / (tot || 1)) * 1000) / 10]) });
    FF.xlsx.download(`kpi-breakdown-${state.period.from}_${state.period.to}.xlsx`, [
      sheet('Class', tally(cur, (r) => r.cls)), sheet('Channel', tally(cur, (r) => r.channel)), sheet('Type', tally(cur, (r) => r.type)), sheet('VRN type', tally(cur, (r) => vrnBucket(r.vrnType))),
      { name: 'Day-wise', header: ['Date', 'Total', 'VC4', 'Commercial', 'GV', 'Replacement'], rows: [...new Set(cur.map((r) => r.key))].sort().map((k) => { const rs = cur.filter((r) => r.key === k); const t = total(rs), v = total(rs.filter((r) => r.group === 'VC4')); return [k, t, v, t - v, total(rs.filter((r) => r.channel === 'GV Partner')), total(rs.filter((r) => r.type === 'REPLACEMENT'))]; }) }
    ]);
  }

  document.addEventListener('click', async (e) => {
    const back = e.target.closest('[data-kd-back]');
    if (back) {
      const previous = state.history.pop();
      if (previous) open(previous, { nested: state.history.length > 0, fromHistory: true });
      return;
    }
    if (e.target.closest('[data-kd-sheetrows]')) {
      const btn = e.target.closest('[data-kd-sheetrows]');
      const host = U.$('#kd-rows');
      if (host) { U.setButtonBusy(btn, true, 'Loading…'); stockSheetRowsSection(host, btn.dataset.kdSheetrows, state.spec || {}).finally(() => U.setButtonBusy(btn, false)); }
      return;
    }
    if (e.target.closest('[data-kd-sheetrows-csv]') || e.target.closest('[data-kd-sheetrows-xlsx]')) {
      const out = state.sheetRows;
      if (!out) return;
      if (e.target.closest('[data-kd-sheetrows-xlsx]')) FF.xlsx.download(`sheet-rows-${U.stamp()}.xlsx`, [{ name: 'Sheet rows', header: out.header, rows: out.rows.map((r) => r.map((v) => (/^-?\d+(\.\d+)?$/.test(v) && v.length < 15 ? Number(v) : v))) }]);
      else U.downloadCsv(`sheet-rows-${U.stamp()}.csv`, out.header, out.rows);
      return;
    }
    if (e.target.closest('[data-kd-raw]')) {
      const btn = e.target.closest('[data-kd-raw]');
      btn.disabled = true; btn.textContent = 'Loading…';
      const el = U.$('#kd-raw-body'); if (el) el.innerHTML = U.spinner('Google Sheet se tag-level rows aa rahi hain…');
      try { await loadRaw(); btn.remove(); renderRaw(''); } catch (err) { if (el) el.innerHTML = U.errorBox(err); btn.disabled = false; btn.textContent = '↻ Retry'; }
      return;
    }
    if (e.target.closest('[data-kd-xlsx]') && state.raw) { FF.xlsx.download(`kpi-tags-${state.period.from}_${state.period.to}.xlsx`, [{ name: 'Tags', header: RAW_HEAD, rows: state.raw }]); return; }
    if (e.target.closest('[data-kd-csv]') && state.raw) { U.downloadCsv(`kpi-tags-${state.period.from}_${state.period.to}.csv`, RAW_HEAD, state.raw); return; }
    if (e.target.closest('[data-kd-summary-xlsx]')) { summaryExport(); return; }
    const tagRow = e.target.closest('[data-kd-tag]');
    if (tagRow && state.spec) { open({ ...state.spec, tagId: tagRow.dataset.kdTag, scope: 'day', date: tagRow.dataset.kdTagDate, title: `Tag ${tagRow.dataset.kdTag}` }); return; }
    const day = e.target.closest('[data-kd-day]');
    if (day && state.spec) { open({ ...state.spec, scope: 'day', date: day.dataset.kdDay, title: `${state.spec.title} · ${U.labelDateKey(day.dataset.kdDay)}` }); return; }
    // 👥 agent row par click → us agent ka poora detail (GV agent ya FF agent) usi drawer me.
    const agentRow = e.target.closest('[data-kd-agent]');
    if (agentRow) {
      const base = state.spec || {};
      const name = agentRow.dataset.kdAgent;
      open({ ...base, agent: name, agentId: agentRow.dataset.kdAgentId || '', channel: agentRow.dataset.kdAgentChannel || '', scope: base.scope === 'day' ? 'day' : 'mtd', date: base.scope === 'day' ? base.date : '', title: `${name} · ${agentRow.dataset.kdAgentChannel === 'gv' ? 'GV' : 'FF'} agent` });
      return;
    }
    const agentDay = e.target.closest('[data-kd-agent-day]');
    if (agentDay && state.spec && state.spec.agent) { open({ ...state.spec, scope: 'day', date: agentDay.dataset.kdAgentDay, title: `${state.spec.agent} · ${U.labelDateKey(agentDay.dataset.kdAgentDay)}` }); return; }
    // Quick spec chips (channel / class / type) — drawer ke andar se filter badlo, naya drawer khulta hai.
    const chip = e.target.closest('[data-kd-spec]');
    if (chip && state.spec) { open({ ...state.spec, ...JSON.parse(chip.dataset.kdSpec || '{}') }); return; }
  });

  FF.kpiDetail = { open, specFrom };
})(window.FF);
