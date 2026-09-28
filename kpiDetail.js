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
  const state = { spec: null, rows: null, raw: null, rawQuery: '' };

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
    if (!G || !G.rows) return [];
    return G.rows().filter((r) => r.date).map((r) => ({ key: U.dateKey(r.date), d: r.date, ym: r.ym, day: r.day, cls: r.cls, group: r.group, type: /replace/i.test(r.status) ? 'REPLACEMENT' : 'ISSUANCE', vrnType: r.tagType || '', channel: 'GV Partner', n: 1, raw: r }));
  }
  async function issuanceRows(src) {
    const out = [];
    if (src === 'ff' || src === 'both') {
      let daily = FF.store.get('daily');
      if (!daily) { try { daily = await FF.store.need('daily'); } catch { daily = []; } }
      (daily || []).forEach((r) => { if (src === 'both' && r.channel === 'GV Partner') return; out.push(r); });
    }
    if (src === 'gv' || src === 'both') {
      if (FF.gv && FF.gv.need) { try { await FF.gv.need('master'); } catch { /* shown as empty */ } }
      out.push(...gvIssuanceRows());
    }
    return out;
  }
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
      ${sorted.map((k) => { const v = cur.get(k) || 0, pv = prev ? (prev.get(k) || 0) : null; return `<tr><td><b>${esc(k)}</b></td><td class="num"><b>${U.fmt(v)}</b></td><td class="num">${pct(v, totalCur)}</td>${prev ? `<td class="num">${U.fmt(pv)}</td><td class="num">${U.deltaHtml(U.growth(v, pv), { decimals: 0 })}</td>` : ''}<td class="kd-bar-col"><span class="kd-bar" style="width:${(v / max) * 100}%"></span></td></tr>`; }).join('')}
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
      ${rk.map((r) => { const vals = ck.map((c) => cell.get(`${r}\u0001${c}`) || 0); return `<tr><td><b>${esc(r)}</b></td>${vals.map((v) => `<td class="num">${v ? U.fmt(v) : '<span class="dim">0</span>'}</td>`).join('')}<td class="num"><b>${U.fmt(vals.reduce((a, b) => a + b, 0))}</b></td></tr>`; }).join('')}
      <tr class="kd-total"><td>Total</td>${colTot.map((v) => `<td class="num">${U.fmt(v)}</td>`).join('')}<td class="num">${U.fmt(colTot.reduce((a, b) => a + b, 0))}</td></tr></tbody></table></div></section>`;
  }
  const stat = (label, value, sub, cls) => `<div class="kd-stat ${cls || ''}"><span>${esc(label)}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;

  // ---- issuance drill-down ---------------------------------------------------------------------
  async function issuanceDetail(spec) {
    const all = await issuanceRows(spec.src);
    const p = period(spec, all);
    const pp = previousPeriod(p);
    const filt = filterOf(spec.f);
    const pick = (per) => all.filter((r) => inP(r, per) && (!filt || filt.fn(r)));
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
    const srcLabel = spec.src === 'gv' ? 'GV Partner (GV Master)' : spec.src === 'ff' ? 'First Forward sheet (EIR — FF + GV channel)' : 'First Forward (EIR, GV ID excluded) + GV Partner (GV Master)';
    const byClass = tally(cur, (r) => r.cls), byClassPrev = tally(prev, (r) => r.cls);
    const byChannel = tally(cur, (r) => r.channel), byChannelPrev = tally(prev, (r) => r.channel);
    const byType = tally(cur, (r) => (r.type === 'REPLACEMENT' ? 'Replacement' : 'New issuance')), byTypePrev = tally(prev, (r) => (r.type === 'REPLACEMENT' ? 'Replacement' : 'New issuance'));
    const byVrn = tally(cur, (r) => vrnBucket(r.vrnType)), byVrnPrev = tally(prev, (r) => vrnBucket(r.vrnType));
    const byGroup = tally(cur, (r) => r.group), byGroupPrev = tally(prev, (r) => r.group);
    const dayTable = days.length > 1 ? `<section class="kd-sec"><h4>📅 Day-wise (${days.length} days)</h4><div class="table-wrap kd-scroll"><table class="tbl compact kd-tbl"><thead><tr><th>Date</th><th class="num">Total</th><th class="num">VC4</th><th class="num">Commercial</th><th class="num">First Forward</th><th class="num">GV</th><th class="num">Replacement</th><th class="num">Chassis</th></tr></thead><tbody>${days.slice().reverse().map((k) => { const rs = cur.filter((r) => r.key === k); const t = total(rs), v = total(rs.filter((r) => r.group === 'VC4')), g = total(rs.filter((r) => r.channel === 'GV Partner')); return `<tr class="clickable" data-kd-day="${k}"><td><b>${esc(U.labelDateKey(k))}</b> <small class="dim">${esc(U.weekday(U.fromDateKey(k)))}</small></td><td class="num"><b>${U.fmt(t)}</b></td><td class="num">${U.fmt(v)}</td><td class="num">${U.fmt(t - v)}</td><td class="num">${U.fmt(t - g)}</td><td class="num">${U.fmt(g)}</td><td class="num">${U.fmt(total(rs.filter((r) => r.type === 'REPLACEMENT')))}</td><td class="num">${U.fmt(total(rs.filter((r) => /chassis/i.test(r.vrnType))))}</td></tr>`; }).join('')}</tbody></table></div><p class="dim small">Kisi bhi din par click karo → us din ka poora breakdown.</p></section>` : '';
    const gvPeople = spec.src !== 'ff' ? peopleFromGv(cur) : '';
    const body = `<div class="kd-hero"><div><span class="kd-kicker">${esc(srcLabel)}</span><div class="kd-big">${U.fmt(tot)} <small>tags</small></div><div class="kd-sub">${esc(periodLabel)}${filt ? ` · filter: <b>${esc(filt.label)}</b>` : ''}</div></div><div class="kd-vs">${U.deltaHtml(U.growth(tot, ptot), { decimals: 0 })}<small>vs ${esc(pp.label)}: <b>${U.fmt(ptot)}</b></small></div></div>
      <div class="kd-stats">${stat('VC4 (payable)', U.fmt(vc4), pct(vc4, tot), 'blue')}${stat('Commercial', U.fmt(comm), pct(comm, tot), 'violet')}${stat('First Forward', U.fmt(ff), pct(ff, tot), 'indigo')}${stat('GV Partner', U.fmt(gv), pct(gv, tot), 'teal')}${stat('New issuance', U.fmt(tot - repl), pct(tot - repl, tot), 'green')}${stat('Replacement', U.fmt(repl), pct(repl, tot), 'amber')}${stat('Chassis', U.fmt(chassis), pct(chassis, tot), 'orange')}${stat('New / VRN', U.fmt(Math.max(0, newVrn)), pct(Math.max(0, newVrn), tot), 'sky')}</div>
      <div class="kd-grid">
        ${breakdownTable('🤝 Kis channel se — GV ya First Forward', byChannel, byChannelPrev, tot, { head: 'Channel', prevLabel: pp.label })}
        ${breakdownTable('🚗 Class group', byGroup, byGroupPrev, tot, { head: 'Group', prevLabel: pp.label, sortCls: true })}
      </div>
      ${breakdownTable('🏷️ Class-wise (har class kitne)', byClass, byClassPrev, tot, { head: 'Class', prevLabel: pp.label, sortCls: true })}
      <div class="kd-grid">
        ${breakdownTable('🔁 New issuance vs Replacement', byType, byTypePrev, tot, { head: 'Type', prevLabel: pp.label })}
        ${breakdownTable('🧩 Chassis / New VRN / Wrong VRN', byVrn, byVrnPrev, tot, { head: 'VRN type', prevLabel: pp.label })}
      </div>
      ${matrix('🧮 Class × Issuance / Replacement', cur, (r) => r.cls, (r) => (r.type === 'REPLACEMENT' ? 'Replacement' : 'Issuance'), { head: 'Class', sortCls: true })}
      ${matrix('🧮 Class × Chassis / VRN', cur, (r) => r.cls, (r) => vrnBucket(r.vrnType).replace(/^New \/ VRN.*/, 'New / VRN'), { head: 'Class', sortCls: true })}
      ${matrix('🧮 Class × Channel', cur, (r) => r.cls, (r) => r.channel, { head: 'Class', sortCls: true })}
      ${dayTable}
      ${gvPeople}
      <section class="kd-sec" id="kd-raw"><h4>📄 Poora data — sab ${U.fmt(tot)} tags (tag-level list)</h4>
        <p class="dim small">Har tag ki row: Tag ID, VRN, class, type, VRN type, status, agent, TL, channel. ${spec.src === 'gv' ? '' : 'First Forward rows Google Sheet (EIR) se abhi on-demand aayengi.'}</p>
        <div class="btn-row"><button class="btn primary" data-kd-raw>📄 Load all ${U.fmt(tot)} rows</button></div><div id="kd-raw-body"></div></section>`;
    return { kicker: `KPI detail · ${spec.page || ''}`, title: spec.title || 'KPI detail', sub: `${esc(periodLabel)} · <b>${U.fmt(tot)}</b> tags${filt ? ` · ${esc(filt.label)}` : ''}`, body, exportable: true };
  }
  function peopleFromGv(cur) {
    const gvRows = cur.filter((r) => r.raw);
    if (!gvRows.length) return '';
    const byTl = tally(gvRows, (r) => r.raw.tlName), byAgent = tally(gvRows, (r) => r.raw.agentName);
    const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const list = (entries) => `<table class="tbl compact kd-tbl"><tbody>${entries.map(([k, v], i) => `<tr><td class="dim">${i + 1}</td><td><b>${esc(k)}</b></td><td class="num"><b>${U.fmt(v)}</b></td></tr>`).join('')}</tbody></table>`;
    return `<div class="kd-grid"><section class="kd-sec"><h4>👥 GV · top TLs</h4>${list(top(byTl))}</section><section class="kd-sec"><h4>🧑‍💼 GV · top agents</h4>${list(top(byAgent))}</section></div>`;
  }

  // ---- raw tag-level rows ---------------------------------------------------------------------
  const RAW_HEAD = ['Date', 'Tag ID', 'VRN', 'Class', 'Type', 'VRN type', 'Status', 'Agent', 'Agent ID', 'TL', 'Channel'];
  async function loadRaw() {
    const spec = state.spec, p = state.period;
    const out = [];
    const filt = filterOf(spec.f);
    if (spec.src === 'ff' || spec.src === 'both') {
      const e = FF.config.eir;
      const cols = [e.date, e.tagId, e.vrn, e.cls, e.type, e.vrnType, e.status, e.agentName, e.agentId, e.tlName, e.masterId, e.gvName];
      const tq = `select ${cols.join(', ')} where toDate(${e.date}) >= date '${p.from}' and toDate(${e.date}) <= date '${p.to}' order by ${e.date} desc limit 60000`;
      const t = await FF.data.query(e.sheet, tq, {});
      const D = FF.data;
      for (const r of t.rows) {
        const d = D.cellDate(r[0]);
        const cls = (() => { const c = D.cellText(r[3]).toUpperCase().trim(); return /^\d+$/.test(c) ? `VC${c}` : c || 'NA'; })();
        const channel = FF.model.channelOf(D.cellText(r[10]), D.cellText(r[9]));
        if (spec.src === 'both' && channel === 'GV Partner') continue;
        const row = { key: d ? U.dateKey(d) : '', cls, group: FF.model.classGroup(cls), type: D.cellText(r[4]).toUpperCase() || 'ISSUANCE', vrnType: D.cellText(r[5]), channel, n: 1 };
        if (filt && !filt.fn(row)) continue;
        out.push([row.key, D.cellText(r[1]), D.cellText(r[2]), cls, row.type, row.vrnType, D.cellText(r[6]), D.cellText(r[7]) || D.cellText(r[11]), D.cellText(r[8]), D.cellText(r[9]), channel]);
      }
    }
    if (spec.src === 'gv' || spec.src === 'both') {
      for (const r of state.rows.filter((x) => x.raw)) {
        const g = r.raw;
        out.push([r.key, g.tagId, g.vrn, g.cls, r.type, g.tagType, g.status, g.agentName, g.agentId, g.tlName, 'GV Partner']);
      }
    }
    out.sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
    state.raw = out;
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
    el.innerHTML = `<div class="kd-raw-tools"><input class="input" id="kd-raw-q" placeholder="Search: tag / VRN / agent / TL / class…" value="${esc(filter || '')}">${FF.auth.can('export') ? '<button class="btn small" data-kd-xlsx>⬇ Excel (all rows)</button><button class="btn small" data-kd-csv>⬇ CSV</button>' : ''}</div>
      <div class="kd-chips"><span class="dim small">Top TLs:</span>${top(byTl)}</div><div class="kd-chips"><span class="dim small">Top agents:</span>${top(byAgent)}</div>
      <p class="dim small">${U.fmt(rows.length)} rows${q ? ` (search "${esc(q)}")` : ''}${rows.length > show.length ? ` · pehli ${show.length} dikh rahi hain — sab ke liye Excel download karo` : ''}.</p>
      <div class="table-wrap kd-scroll tall"><table class="tbl compact kd-tbl"><thead><tr>${RAW_HEAD.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${show.map((r) => `<tr>${r.map((v, i) => `<td${i === 0 ? ' class="nowrap"' : ''}>${esc(v || '')}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${RAW_HEAD.length}" class="empty">Koi row nahi mili.</td></tr>`}</tbody></table></div>`;
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
        ${breakdownTable('TL-wise stock', tally(rows, (r) => r.tlName), null, tot, { head: 'TL' })}
        ${matrix('TL × class', rows, (r) => r.tlName, (r) => r.cls, { head: 'TL' })}
        ${breakdownTable('Top 30 agents (stock)', new Map([...byAgent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)), null, tot, { head: 'Agent · TL' })}`);
    }
    if (spec.src === 'gv' || spec.src === 'both') {
      const G = FF.gv; let cls = [], tls = [], agents = [];
      try { cls = await G.need('stockClass'); } catch { /* */ }
      try { tls = await G.need('stockTl'); } catch { /* */ }
      try { agents = await G.need('stockAgent'); } catch { /* */ }
      const tot = total(cls || []); grand += tot;
      parts.push(`<h3 class="kd-h">🟩 GV Partner stock (Tag Assignment) · <b>${U.fmt(tot)}</b></h3>
        <div class="kd-grid">${breakdownTable('Class-wise', tally(cls || [], (r) => r.cls), null, tot, { head: 'Class', sortCls: true })}${breakdownTable('TL-wise', tally(tls || [], (r) => r.tlName), null, total(tls || []), { head: 'TL' })}</div>
        ${breakdownTable('Top 30 agents (stock)', new Map((agents || []).slice(0, 30).map((a) => [`${a.agentName} · ${a.tlName || '—'}`, a.n])), null, tot, { head: 'Agent · TL' })}`);
    }
    return { kicker: 'KPI detail · Stock', title: spec.title || 'Stock in field', sub: `Total <b>${U.fmt(grand)}</b> tags in field`, body: parts.join('') || '<div class="empty">Stock data nahi mila.</div>' };
  }
  async function stockReportDetail(spec) {
    if (FF.pages.performance && FF.pages.performance.ensureLoaded) { try { await FF.pages.performance.ensureLoaded(); } catch (err) { console.warn('stock report', err); } }
    const agents = (FF.pages.performance && FF.pages.performance.agents ? FF.pages.performance.agents() : []).filter((a) => !a.isMaster);
    if (!agents.length) return stockDetail({ ...spec, src: 'ff' });
    const keys = [['VC4', 'stockVc4'], ['VC5', 'stockC1'], ['VC6', 'stockC2'], ['VC7', 'stockC3'], ['VC12', 'stockC4'], ['VC16', 'stockC5']];
    const cls = new Map(keys.map(([l, k]) => [l, U.sum(agents, (a) => a[k] || 0)]));
    const tot = U.sum(agents, (a) => a.stockTotal || 0);
    const byTl = new Map(); agents.forEach((a) => byTl.set(a.tlExcluded ? 'Direct (no TL)' : (a.tlName || '—'), (byTl.get(a.tlExcluded ? 'Direct (no TL)' : (a.tlName || '—')) || 0) + (a.stockTotal || 0)));
    const alerts = new Map(); agents.forEach((a) => { const k = String(a.tlStockAlert || '—').replace(/^[^\w]+/u, ''); alerts.set(k, (alerts.get(k) || 0) + 1); });
    const prio = new Map(); agents.forEach((a) => { const k = a.priority || '—'; prio.set(k, (prio.get(k) || 0) + 1); });
    const topAgents = new Map([...agents].sort((a, b) => (b.stockTotal || 0) - (a.stockTotal || 0)).slice(0, 30).map((a) => [`${a.name} · ${a.tlExcluded ? 'Direct' : a.tlName}`, a.stockTotal || 0]));
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
      const per = new Map(); cur.forEach((r) => { const k = r.raw.agentId; const x = per.get(k) || { name: r.raw.agentName, tl: r.raw.tlName, n: 0 }; x.n += 1; per.set(k, x); });
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

  // ---- open ------------------------------------------------------------------------------------
  async function open(cardOrSpec) {
    const spec = cardOrSpec && cardOrSpec.nodeType ? specFrom(cardOrSpec) : { ...(cardOrSpec || {}) };
    if (!spec.src) spec.src = PAGE_SRC[currentPage()] || 'both';
    if (!spec.scope) spec.scope = 'mtd';
    FF.app.openDrawer({ kicker: 'KPI detail', title: spec.title || 'KPI detail', sub: 'Breakdown taiyaar ho raha hai…', body: U.spinner('Detail calculate ho rahi hai…'), wide: true });
    if (FF.notifications && FF.notifications.track) FF.notifications.track('kpi', `KPI opened: ${spec.title || spec.scope}`);
    try {
      const view = spec.scope === 'stock' ? await stockDetail(spec)
        : spec.scope === 'stockreport' ? await stockReportDetail(spec)
          : spec.scope === 'agents' ? await agentsDetail(spec)
            : spec.scope === 'status' ? await statusDetail(spec)
              : await issuanceDetail(spec);
      const cardInfo = spec.foot ? `<div class="kd-card-foot">Card: ${esc(spec.foot)}</div>` : '';
      FF.app.openDrawer({ kicker: view.kicker, title: view.title, sub: view.sub, body: cardInfo + view.body, wide: true, actions: view.exportable && FF.auth.can('export') ? '<button class="btn small" data-kd-summary-xlsx>⬇ Breakdown Excel</button>' : '' });
    } catch (err) {
      FF.app.openDrawer({ kicker: 'KPI detail', title: spec.title || 'KPI detail', body: U.errorBox(err), wide: true });
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
    const day = e.target.closest('[data-kd-day]');
    if (day && state.spec) { open({ ...state.spec, scope: 'day', date: day.dataset.kdDay, title: `${state.spec.title} · ${U.labelDateKey(day.dataset.kdDay)}` }); }
  });

  FF.kpiDetail = { open, specFrom };
})(window.FF);
