/* ============================================================================================================
   🧑‍💼 agentBoard.js — v3.42 · Agent / TL 360 board (GV + FF dono ke liye EK hi format)

   Kyun: GV aur FF ke drawer alag-alag the aur GV me TL ka naam/ID/mobile, TL ka issuance/stock, class-wise
   agent-vs-TL comparison aur „TL ke saare agents ka issuance + stock“ missing tha. Yahan sab ek jagah aata hai
   taaki ek hi drawer se PDF / WhatsApp share ho jaye.

   Structure (dono channel same):
     1. Hero            — status, ID, mobile, priority, aaj/last active + last/MTD/stock ka snapshot
     2. TL block        — TL ka naam · ID · mobile + TL ke last month / MTD / growth / stock (own + agents) / dispatch
     3. Agent KPIs      — last month · current month (MTD) · growth · suggested dispatch · stock · expected month-end
     4. Class-wise      — Agent (ya TL) ke numbers aur TL ke numbers SIDE-BY-SIDE (last · MTD · stock) + Grand Total
     5. TL ke agents    — har agent ka last / MTD / growth / stock (VC4 · Comm · total); niche own + agents = TL TOTAL
     6. Matrix          — Agent × Class stock (TL ke saare agents + TL ki apni row)
     7. Dispatch        — kis agent ko kitna dispatch chahiye (after stock + without stock)
     8. Charts          — class split (MTD), last-vs-MTD, stock donut (agent + TL)
     9. Note            — source + timestamp (PDF/CSV ke liye)

   Har number clickable hai (`data-kpi` → FF.kpiDetail ka drill drawer: class → din → tag/barcode).
   Har naam clickable hai (`data-ab-open` → nested board, Back se wapas).

   Data: FF.masterProfile (GV REPORT/GV Master/EIR/StockDataa ka canonical merge) — yahi ek source hai,
   isliye board ka KPI aur usi ka drill-down ek hi hisaab dikhate hain.
   ============================================================================================================ */
window.FF = window.FF || {};
(function (FF) {
  'use strict';

  const U = FF.util;
  const esc = U.esc;
  const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);
  const fmt = (v) => U.fmt(num(v));
  const clean = (v) => String(v === null || v === undefined || v === '' ? '' : v).trim();
  const norm = (v) => clean(v).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  // ---- channel helpers --------------------------------------------------------------------------------------
  const channelOf = (kind) => (/^gv/.test(String(kind || '')) ? 'gv' : 'ff');
  const isTlKind = (kind) => /tl$/.test(String(kind || ''));
  const kindFor = (ch, tl) => `${ch}-${tl ? 'tl' : 'agent'}`;
  const chLabel = (ch) => (ch === 'gv' ? 'GV Partner' : 'First Forward');
  const chIcon = (ch) => (ch === 'gv' ? '🟩' : '🟦');
  const directLabel = (ch) => (ch === 'gv' ? 'Direct GV agent' : 'Direct FF agent');

  const CLS_ORDER = ['VC4', 'VC20', 'VC5', 'VC6', 'VC7', 'VC12', 'VC16'];
  const clsRank = (c) => { const i = CLS_ORDER.indexOf(String(c || '').toUpperCase()); return i < 0 ? (/^COMM/i.test(c) ? 50 : 90) : i; };
  const classLabel = (c) => clean(c).replace(/^COMMERCIAL$/i, 'Commercial') || '—';

  const canContacts = () => { try { return !FF.auth || !FF.auth.can || FF.auth.can('contacts'); } catch { return true; } };
  const canExport = () => { try { return !FF.auth || !FF.auth.can || FF.auth.can('export'); } catch { return true; } };

  // ---- data model -------------------------------------------------------------------------------------------
  const MP = () => FF.masterProfile || null;

  /** Master profile (canonical merge) — GV aur FF dono ke liye yahi pipe. */
  function profileOf(person) {
    const mod = MP();
    if (!mod || !mod.buildNow) return null;
    try { return mod.buildNow(person); } catch { return null; }
  }
  const growthPct = (cur, last) => (num(last) > 0 ? ((num(cur) - num(last)) / num(last)) * 100 : null);

  /** Profile ki team row ko board ke ek hi shape me laao (cur/last → curTotal/lastTotal included). */
  function teamRow(a, isSelf) {
    const r = { ...a, isSelf: !!isSelf || !!a.isSelf };
    r.curTotal = num(a.curTotal !== undefined ? a.curTotal : a.cur);
    r.lastTotal = num(a.lastTotal !== undefined ? a.lastTotal : a.last);
    r.curVc4 = num(a.curVc4); r.curComm = num(a.curComm !== undefined ? a.curComm : a.curNvc4);
    r.lastVc4 = num(a.lastVc4); r.lastComm = num(a.lastComm !== undefined ? a.lastComm : a.lastNvc4);
    r.stockVc4 = num(a.stockVc4); r.stockComm = num(a.stockComm !== undefined ? a.stockComm : a.stockNvc4);
    r.stockTotal = num(a.stockTotal);
    r.sugVc4 = num(a.sugVc4); r.sugComm = num(a.sugComm);
    r.sugVc4Gross = num(a.sugVc4Gross); r.sugCommGross = num(a.sugCommGross);
    r.growth = (a.growth === undefined || a.growth === null) ? growthPct(r.curTotal, r.lastTotal) : a.growth;
    return r;
  }
  /** TL ki poori team: agents + TL ki apni row (own) — own ko agents me DOBARA nahi jodte. */
  function teamOf(pr) {
    if (!pr) return { agents: [], own: null, all: [], tl: null };
    const agents = (pr.agents || []).map((a) => teamRow(a, false));
    let own = pr.selfAgent ? teamRow(pr.selfAgent, true) : null;
    const splitOwn = pr.tlStock && pr.tlStock.own;
    // Sheet me TL ki apni row na ho par apna stock ho — tab bhi dikhao (warna own + agents = TL ka hisaab chhupta hai).
    if (!own && splitOwn && num(splitOwn.total) > 0) {
      own = teamRow({ name: pr.name, id: pr.id, isSelf: true, stockVc4: splitOwn.vc4, stockComm: splitOwn.comm, stockTotal: splitOwn.total, cur: 0, last: 0, growth: null }, true);
    }
    return { agents, own, all: own ? [own, ...agents] : agents.slice(), tl: own };
  }
  /** Class rows — profile ke `classes`, aur agar khaali ho to VC4/Comm se bana do (dono channel me safe). */
  function classRowsOf(pr) {
    const t = (pr && pr.totals) || {}, s = (pr && pr.stock) || {};
    let list = (pr && pr.classes ? pr.classes : []).map((c) => ({ cls: c.cls, last: num(c.last), cur: num(c.cur), stock: num(c.stock) }));
    list = list.filter((c) => c.last || c.cur || c.stock);
    if (!list.length && (num(t.curTotal) || num(t.lastTotal) || num(s.total))) {
      list = [
        { cls: 'VC4', last: num(t.lastVc4), cur: num(t.curVc4), stock: num(s.vc4) },
        { cls: 'Commercial', last: num(t.lastComm), cur: num(t.curComm), stock: num(s.comm) }
      ].filter((c) => c.last || c.cur || c.stock);
    }
    return list.sort((a, b) => clsRank(a.cls) - clsRank(b.cls));
  }
  const sumBy = (list, key) => (list || []).reduce((n, r) => n + num(r[key]), 0);

  /** 🎯 VC4 · VC20 · VC5+ bins — masterProfile se (GV me sheet-first, FF me tag-ledger). */
  function groupsOf(pr) {
    const mod = MP();
    if (mod && mod.groupBinsFor) { const g = mod.groupBinsFor(pr); if (g) return g; }
    const bins = pr && pr.classBins;
    if (!bins) return null;
    const usable = (b) => !!(b && (num(b.total) || num(b.VC4) || num(b.VC20) || num(b['VC5+'])));
    if (!usable(bins.last) && !usable(bins.cur)) return null;
    const to = (b) => ({ VC4: num(b.VC4), VC20: num(b.VC20), 'VC5+': num(b['VC5+']), total: num(b.total), source: 'tag ledger', mix: 'ledger' });
    return { last: usable(bins.last) ? to(bins.last) : null, cur: usable(bins.cur) ? to(bins.cur) : null, stock: null };
  }

  /** GV ka class-wise stock asli source = Tag Assignment (GV REPORT ke columns me VC20 chhup jaata hai).
   *  Detail rows mil jayein to class table ka stock column unse hi banao — warna jod aur total me farq rehta hai. */
  function stockDetailMap(ch, name, id) {
    const out = new Map();
    if (ch !== 'gv' || !FF.gv || typeof FF.gv.get !== 'function') return out;
    const rows = FF.gv.get('stockAgentClass');
    if (!Array.isArray(rows) || !rows.length) return out;
    const n = norm(name), i = clean(id).toUpperCase();
    for (const r of rows) {
      const rn = norm(r.agentName || r.name), ri = clean(r.agentId || r.id).toUpperCase();
      const mine = (n && rn === n) || (i && ri && ri === i);
      if (!mine) continue;
      const cls = String(r.cls || '').toUpperCase() || 'NA';
      out.set(cls, (out.get(cls) || 0) + num(r.n));
    }
    return out;
  }
  function withStockDetail(classes, ch, name, id, key, stockTotal) {
    const map = key === 'stock' ? stockDetailMap(ch, name, id) : new Map();
    if (!map.size) return classes;
    const mapSum = [...map.values()].reduce((n, v) => n + num(v), 0);
    const nowSum = sumBy(classes, 'stock');
    // Detail rows sirf tab lagao jab wo sheet ke total ke zyada kareeb hon (TL profile me classes already
    // uske saare agents + own ka jod hoti hain — wahan overlay ulta nuksan karta hai).
    if (Math.abs(mapSum - num(stockTotal)) >= Math.abs(nowSum - num(stockTotal))) return classes;
    const list = classes.map((c) => ({ ...c }));
    map.forEach((n, cls) => {
      const hit = list.find((c) => String(c.cls).toUpperCase() === cls);
      if (hit) hit.stock = n;
      else list.push({ cls, last: 0, cur: 0, stock: n });
    });
    return list.filter((c) => c.last || c.cur || c.stock);
  }

  // ---- small html helpers -----------------------------------------------------------------------------------
  function kpiAttr(spec, title) {
    const q = new URLSearchParams();
    Object.entries(spec || {}).forEach(([k, v]) => { if (v !== '' && v !== null && v !== undefined) q.set(k, String(v)); });
    return ` data-kpi="${esc(q.toString())}" role="button" tabindex="0" title="${esc(title || 'Click → detail (class → din → tag)')}"`;
  }
  function openAttr(name, kind, id) {
    return ` data-ab-open="${esc(clean(name))}" data-ab-kind="${esc(kind)}" data-ab-id="${esc(clean(id))}"`;
  }
  const toneOf = (i) => `g${(i % 12) + 1}`;
  /** KPI tile — `.mp-kpi` class jaan-boojh kar: app.js ka extractDrawerData() isi ko PDF/CSV me uthata hai. */
  function tile({ label, value, foot, spec, title, tone, open, sub }) {
    const click = spec ? kpiAttr(spec, title || label) : (open ? openAttr(open.name, open.kind, open.id) : '');
    return `<div class="mp-kpi ab-kpi kpi-clickable ${tone || 'g1'}"${click}>
      <small class="ab-kpi-l">${label}</small>
      <b class="ab-kpi-v">${value}</b>
      ${foot ? `<span class="ab-kpi-f">${foot}</span>` : ''}
      ${sub || ''}
    </div>`;
  }
  const badgeTone = (v) => (/(high|red|de-?growth|inactive|critical)/i.test(String(v)) ? 'red' : /(medium|amber|warn|slow)/i.test(String(v)) ? 'amber' : /(low|green|active|growth|ok)/i.test(String(v)) ? 'green' : 'gray');
  const badge = (text) => { const t = clean(String(text || '').replace(/^[\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]+/u, '')); return t ? `<span class="badge ${badgeTone(text)}">${esc(t)}</span>` : ''; };
  const mobileChip = (m) => (canContacts() && clean(m) && !/^na$/i.test(clean(m)) ? `<a class="ab-chip ab-tel" href="tel:${esc(clean(m))}">📞 ${esc(clean(m))}</a>` : '');
  const delta = (v) => (v === null || v === undefined ? '<span class="delta flat">—</span>' : U.deltaHtml(v, { decimals: 0 }));
  const sec = (id, title, inner, cls) => `<section class="ab-sec ${cls || ''}" id="${id}"><h4>${title}</h4>${inner}</section>`;

  // ---- TL ka mobile -----------------------------------------------------------------------------------------
  /** TL mobile kahin se bhi: (1) usi channel ke rows ka tlMobile, (2) TL ki apni row ka mobile,
   *  (3) doosre channel ka wahi TL (FF REPORT me TL mobile hota hai), (4) masterProfile.mobileFor(). */
  function tlMobileFor(ch, tlName, tlId) {
    const n = norm(tlName);
    if (!n) return '';
    const ok = (m) => (clean(m) && !/^na$/i.test(clean(m)) ? clean(m) : '');
    const rowsFor = (c) => (c === 'gv'
      ? ((FF.pages && FF.pages.gvPerformance && FF.pages.gvPerformance.sourceRows && FF.pages.gvPerformance.sourceRows()) || (FF.gv && FF.gv.get && FF.gv.get('report')) || [])
      : ((FF.pages && FF.pages.performance && FF.pages.performance.agents && FF.pages.performance.agents()) || []));
    for (const c of (ch === 'gv' ? ['gv', 'ff'] : ['ff', 'gv'])) {
      const rows = rowsFor(c);
      for (const r of rows) if (norm(r.tlName || r.tl) === n) { const m = ok(r.tlMobile); if (m) return m; }
      for (const r of rows) if (norm(r.agentName || r.name) === n) { const m = ok(r.mobile); if (m) return m; }
    }
    const mod = MP();
    return mod && mod.mobileFor ? ok(mod.mobileFor(tlName, tlId, '')) : '';
  }

  // ---- sections ---------------------------------------------------------------------------------------------
  function context(person, extra = {}) {
    const ch = channelOf(person.kind);
    const tlView = isTlKind(person.kind);
    const person2 = { kind: person.kind, name: person.name, sub: person.sub || person.id || '' };
    const pr = profileOf(person2);
    if (!pr || !pr.found) return { missing: true, ch, tlView, person: person2 };
    const tlName = tlView ? clean(pr.name) : clean(extra.tlName || (pr.tl && pr.tl.name) || '');
    const direct = !!pr.direct || /^(direct|direct gv|direct ff|aps|🚫)/i.test(tlName);
    // TL ka profile sirf tab build karo jab real TL ho (direct/blank par nahi).
    let tlPr = null;
    if (tlView) tlPr = pr;
    else if (tlName && !direct && (!FF.config.isRealTl || FF.config.isRealTl(tlName))) tlPr = profileOf({ kind: kindFor(ch, true), name: tlName, sub: (pr.tl && pr.tl.id) || '' });
    const row = rowOf(pr);
    let tlRow = tlPr && tlPr.found ? rowOf(tlPr) : null;
    if (!tlView && tlRow) {
      if (!row.tl.id && tlRow.id) row.tl.id = tlRow.id;
      if (!row.tl.mobile) row.tl.mobile = tlRow.mobile || tlMobileFor(ch, tlName, tlRow.id);
      if (!tlRow.mobile) tlRow.mobile = tlMobileFor(ch, tlName, tlRow.id) || row.tl.mobile;
    } else if (tlView) {
      if (!row.mobile) row.mobile = tlMobileFor(ch, row.name, row.id);
      row.tl = { name: row.name, id: row.id, mobile: row.mobile };
    }
    const team = teamOf(tlPr && tlPr.found ? tlPr : null);
    const ymCur = (pr.months && pr.months.cur) || U.ymKey(new Date());
    const ymLast = (pr.months && pr.months.last) || U.prevMonthKey(ymCur);
    return {
      missing: false, ch, tlView, person: person2, pr, tlPr, row, tlRow, tlName, direct, team,
      ymCur, ymLast, ymCurLabel: U.labelYM(ymCur), ymLastLabel: U.labelYM(ymLast),
      days: (pr.dispatch && pr.dispatch.days) || (MP() && MP().suggestDays) || 15,
      plain: !!extra.plain
    };
  }
  /** Profile → board row (dono channel ek hi shape). */
  function rowOf(pr) {
    const t = pr.totals || {}, s = pr.stock || {}, d = pr.dispatch || {};
    const tl = pr.tl || {};
    return {
      name: clean(pr.name), id: clean(pr.id), mobile: clean(pr.mobile), status: clean(pr.status), lastActive: clean(pr.lastActive),
      priority: clean(pr.priority), commPriority: clean(pr.commPriority), direct: !!pr.direct, directLabel: clean(pr.directLabel),
      tagRequired: !!pr.tagRequired, kind: clean(pr.kind),
      tl: { name: clean(tl.name), id: clean(tl.id), mobile: clean(tl.mobile) },
      last: { vc4: num(t.lastVc4), comm: num(t.lastComm), total: num(t.lastTotal) },
      cur: { vc4: num(t.curVc4), comm: num(t.curComm), total: num(t.curTotal) },
      stock: { vc4: num(s.vc4), comm: num(s.comm), total: num(s.total) },
      stockOwn: num(pr.tlStock && pr.tlStock.own && pr.tlStock.own.total),
      stockAgents: num(pr.tlStock && pr.tlStock.agents && pr.tlStock.agents.total),
      dispatch: d, growth: pr.growthNum !== undefined && pr.growthNum !== null ? pr.growthNum : growthPct(num(t.curTotal), num(t.lastTotal)),
      proj: num(pr.projT1 && pr.projT1.total), projBasis: (pr.projT1 && pr.projT1.basis) || null,
      classes: withStockDetail(classRowsOf(pr), pr.ch, pr.name, pr.id, 'stock', num(s.total)),
      agentCount: num(pr.agentCount), hasTlStock: !!(pr.tlStock && pr.tlStock.has)
    };
  }

  /** 1 · hero — status + pehchaan + last/MTD/stock ka snapshot. */
  function heroSection(c) {
    const r = c.row, tl = r.tl;
    const initials = clean(r.name).split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '—';
    const chips = [
      badge(r.status), badge(r.priority),
      r.tagRequired ? '<span class="badge amber">🏷️ tag required</span>' : '',
      r.lastActive ? `<span class="ab-chip">🕒 ${esc(r.lastActive)}</span>` : '',
      mobileChip(r.mobile)
    ].filter(Boolean).join('');
    const showTl = !c.tlView && tl.name && !c.direct;
    const tlBar = showTl ? `<div class="ab-tlbar">
        <span class="ab-tlbar-lbl">👥 TL</span>
        <span class="ab-chip ab-strong"${openAttr(tl.name, kindFor(c.ch, true), tl.id)}>${esc(tl.name)}</span>
        ${tl.id ? `<span class="ab-chip">🆔 ${esc(tl.id)}</span>` : ''}
        ${mobileChip(tl.mobile) || (canContacts() ? '<span class="ab-chip dim">📞 mobile sheet me nahi</span>' : '')}
        <span class="ab-chip ab-cta"${openAttr(tl.name, kindFor(c.ch, true), tl.id)}>TL ki poori report →</span>
      </div>` : '';
    return `<section class="ab-hero" data-ch="${c.ch}">
      <span class="ab-ava">${esc(initials)}</span>
      <div class="ab-idbox">
        <b class="ab-name">${esc(r.name || '—')}</b>
        <small class="ab-sub">${chIcon(c.ch)} ${esc(chLabel(c.ch))} · <b>${c.tlView ? 'Team Leader' : 'Agent'}</b>${r.id ? ` · ID ${esc(r.id)}` : ''}${c.direct ? ` · 🚫 ${esc(r.directLabel || directLabel(c.ch))}` : ''}</small>
        <div class="ab-chips">${chips || '<span class="dim small">status sheet me nahi</span>'}</div>
      </div>
      <div class="ab-hero-right">
        <span class="ab-hero-num" title="Current month (MTD) issuance — tags ka count, agents ka nahi">${fmt(r.cur.total)}</span>
        <small>MTD issuance</small>
        <span class="ab-hero-sub">Last ${fmt(r.last.total)} · Stock ${fmt(r.stock.total)}</span>
      </div>
    </section>${tlBar}`;
  }

  /** 🎯 VC4 · VC20 · VC5+ — last month · MTD · stock, har cell apni detail kholta hai. */
  function groupSection(c, target, whoAm) {
    const r = target || c.row;
    const bins = groupsOf(whoAm === 'tl' ? c.tlPr : c.pr);
    if (!bins || (!bins.last && !bins.cur && !(bins.stock && num(bins.stock.total)))) return '';
    const stock = bins.stock || (r && r.stock ? { VC4: r.stock.vc4, VC20: null, 'VC5+': null, total: r.stock.total } : null);
    const spec = (scope, f) => ({ src: c.ch, channel: c.ch, scope, ...(scope === 'month' ? { ym: c.ymLast } : scope === 'stock' ? {} : { ym: c.ymCur }), ...(whoAm === 'tl' ? { tl: r.name } : { agent: r.name, agentId: r.id }), f });
    const cell = (value, sp, title) => value === null || value === undefined
      ? '<td class="num dim">—</td>'
      : `<td class="num ab-cellclick"${kpiAttr(sp, title)}>${fmt(value)}</td>`;
    const value = (period, key) => (bins[period] ? num(bins[period][key]) : null);
    const totalOf = (period) => {
      const b = bins[period];
      if (!b) return null;
      if (num(b.total)) return num(b.total);
      const sum = ['VC4', 'VC20', 'VC5+'].reduce((n, k) => n + num(b[k]), 0);
      return sum || null;
    };
    const who = whoAm === 'tl' ? `TL ${r.name}` : r.name;
    const rows = ['VC4', 'VC20', 'VC5+'].map((group) => {
      const f = group === 'VC4' ? 'vc4' : group === 'VC20' ? 'vc20' : 'vc5p';
      return `<tr><td class="ab-cls"><b>${group}</b></td>${cell(value('last', group), spec('month', f), `${who} · ${group} · last month (din → tag)`)}${cell(value('cur', group), spec('mtd', f), `${who} · ${group} · MTD (din → tag)`)}${cell(stock ? stock[group] : null, spec('stock', f), `${who} · ${group} · stock (barcode tak)`)}</tr>`;
    }).join('');
    const stockTotal = stock ? num(stock.total) : 0;
    const src = (period) => {
      const b = bins[period];
      if (!b) return '—';
      if (b.source === 'GV REPORT sheet') return b.mix === 'ledger-mix' ? 'GV REPORT sheet (VC4 + NVC4), VC20/VC5+ ka batwara tag-ledger mix se' : 'GV REPORT sheet';
      return b.source || 'tag ledger';
    };
    const recon = ['last', 'cur'].map((period) => {
      const b = bins[period];
      if (!b || !b.ledger || !b.sheet || !b.ledger.total || b.ledger.total === b.sheet.total) return '';
      const delta = b.ledger.total - b.sheet.total;
      return `${period === 'cur' ? 'MTD' : 'Last'}: sheet ${fmt(b.sheet.total)} vs tag ledger ${fmt(b.ledger.total)} (Δ ${delta > 0 ? '+' : ''}${fmt(delta)})`;
    }).filter(Boolean).join(' · ');
    return sec(`ab-group-${whoAm}`, `🎯 Class group · VC4 · VC20 · VC5+ <span class="dim small">· ${esc(who)}</span>`, `
      <div class="table-wrap"><table class="tbl compact ab-tbl">
        <thead><tr><th class="ab-th-cls">Group</th><th class="num">Last <small>(${esc(c.ymLastLabel)})</small></th><th class="num">MTD <small>(${esc(c.ymCurLabel)})</small></th><th class="num">Stock</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="row-total"><td><b>Total</b></td><td class="num"><b>${fmt(totalOf('last'))}</b></td><td class="num"><b>${fmt(totalOf('cur'))}</b></td><td class="num"><b>${fmt(stockTotal)}</b></td></tr></tfoot>
      </table></div>
      <p class="ab-mini">Source — Last: ${esc(src('last'))} · MTD: ${esc(src('cur'))} · Stock: Tag Assignment / StockDataa.${recon ? ` <span class="mp-recon">${recon}</span>` : ''}</p>`);
  }

  /** 🆔 TL ID-wise stock — TL ka apna + har agent ka stock, ID ke saath, sab clickable. */
  function stockIdSection(c) {
    if (!c.tlRow && c.ch !== 'gv') return '';
    const tl = c.tlRow || c.row;
    const tlId = clean(tl.id || c.row.id);
    const own = c.team.own;
    const agents = c.team.agents.slice().sort((a, b) => b.stockTotal - a.stockTotal);
    if (!own && !agents.length) return '';
    const stockCells = (a) => {
      const spec = { src: c.ch, channel: c.ch, scope: 'stock', agent: a.name, agentId: a.id };
      return `<td class="num ab-cellclick"${kpiAttr(spec, `${a.name} · VC4 stock`)}>${fmt(a.stockVc4)}</td>
        <td class="num ab-cellclick"${kpiAttr(spec, `${a.name} · commercial stock`)}>${fmt(a.stockComm)}</td>
        <td class="num ab-cellclick"${kpiAttr(spec, `${a.name} · total stock`)}><b>${fmt(a.stockTotal)}</b></td>`;
    };
    const rowOf = (a, isSelf) => `<tr class="clickable${isSelf || a.isSelf ? ' ab-self' : ''}"${openAttr(a.name, kindFor(c.ch, !!a.isSelf && !isSelf ? true : false), a.id)}>
      <td class="ab-cellname">${a.isSelf || isSelf ? '👤 ' : ''}<b>${esc(a.name)}</b>${a.isSelf || isSelf ? ' <span class="ab-tag">TL apna</span>' : ''}</td>
      <td><small class="dim">${esc(a.id || '—')}</small></td>
      <td><small class="dim">${esc(tlId || '—')}</small></td>
      ${stockCells(a)}</tr>`;
    const agentsStock = { vc4: sumBy(agents, 'stockVc4'), comm: sumBy(agents, 'stockComm'), total: sumBy(agents, 'stockTotal') };
    return sec('ab-stockid', `🆔 TL ID-wise stock · ${esc(tlId || tl.name)} <span class="dim small">— TL apna + har agent alag-alag</span>`, `
      <div class="table-wrap"><table class="tbl compact ab-tbl">
        <thead><tr><th>Naam</th><th>Agent ID</th><th>TL ID</th><th class="num">Stock VC4</th><th class="num">Stock Comm</th><th class="num">Stock total</th></tr></thead>
        <tbody>${own ? rowOf(own, true) : ''}${agents.map((a) => rowOf(a, false)).join('')}</tbody>
        <tfoot>
          ${agents.length ? `<tr class="row-total"><td colspan="3"><b>🧑‍💼 Agents ke paas (${fmt(agents.length)})</b></td><td class="num">${fmt(agentsStock.vc4)}</td><td class="num">${fmt(agentsStock.comm)}</td><td class="num"><b>${fmt(agentsStock.total)}</b></td></tr>` : ''}
          ${own ? `<tr class="ab-ownrow"><td colspan="3"><b>👤 TL ke paas (own)</b></td><td class="num">${fmt(own.stockVc4)}</td><td class="num">${fmt(own.stockComm)}</td><td class="num"><b>${fmt(own.stockTotal)}</b></td></tr>` : ''}
          <tr class="row-total ab-tltotal"><td colspan="3"><b>= TL TOTAL · 🆔 ${esc(tlId || '—')}</b></td><td class="num"><b>${fmt(tl.stock.vc4)}</b></td><td class="num"><b>${fmt(tl.stock.comm)}</b></td><td class="num"><b>${fmt(tl.stock.total)}</b></td></tr>
        </tfoot></table></div>
      <p class="ab-mini">Har row par click = us agent ka apna 360 board · stock cell par click = us ID ka stock (class → barcode tak). TL total = own + agents (koi double count nahi).</p>`);
  }

  /** 3 · issuance summary — last month, current month, growth, dispatch, stock, expected. */
  function kpiSection(c, target) {
    const r = target || c.row;
    const ch = c.ch;
    const d = r.dispatch || {};
    const who = target && target !== c.row ? `TL ${r.name}` : (c.tlView ? 'TL' : 'Agent');
    const p = c.tlView ? 'TL ' : '';
    const base = { src: ch, channel: ch };
    const specFor = (scope, who_, extra) => ({ ...base, scope, ...(scope === 'month' ? { ym: c.ymLast } : scope === 'stock' ? {} : { ym: c.ymCur }), ...(who_ === 'tl' ? { tl: r.name } : { agent: r.name, agentId: r.id }), ...extra });
    const whoAm = target && target !== c.row ? 'tl' : (c.tlView ? 'tl' : 'agent');
    return `<div class="ab-kpis">
      ${tile({ label: `${p}Last month · ${esc(c.ymLastLabel)}`, value: fmt(r.last.total), foot: `VC4 <b>${fmt(r.last.vc4)}</b> · Comm <b>${fmt(r.last.comm)}</b>`, tone: 'g5', spec: specFor('month', whoAm), title: `${who} ${r.name} · ${c.ymLastLabel} issuance (tag-level)` })}
      ${tile({ label: `${p}Current month · ${esc(c.ymCurLabel)} <span class="ab-tag">MTD</span>`, value: fmt(r.cur.total), foot: `VC4 <b>${fmt(r.cur.vc4)}</b> · Comm <b>${fmt(r.cur.comm)}</b>`, tone: 'g2', spec: specFor('mtd', whoAm), title: `${who} ${r.name} · ${c.ymCurLabel} issuance (tag-level)` })}
      ${tile({ label: `${p}Growth`, value: delta(r.growth), foot: `${fmt(r.last.total)} → ${fmt(r.cur.total)}`, tone: 'g3', spec: specFor('mtd', whoAm), title: `${who} ${r.name} · growth split (class → din)` })}
      ${tile({ label: `${p}Suggested dispatch · ${fmt(c.days)} din`, value: `<span class="ab-sug">${fmt(d.sugVc4)}<small>VC4</small></span><span class="ab-sug">${fmt(d.sugComm)}<small>Comm</small></span>`, foot: `bina stock: VC4 <b>${fmt(d.sugVc4Gross)}</b> · Comm <b>${fmt(d.sugCommGross)}</b>`, tone: 'g4', spec: specFor('mtd', whoAm), title: `${who} ${r.name} · dispatch calculation` })}
      ${tile({ label: `${p}Stock in hand`, value: fmt(r.stock.total), foot: `VC4 <b>${fmt(r.stock.vc4)}</b> · Comm <b>${fmt(r.stock.comm)}</b>`, tone: 'g1', spec: specFor('stock', whoAm), title: `${who} ${r.name} · stock (class → tag/barcode)` })}
      ${c.tlView ? tile({ label: 'TL ke agents', value: fmt(c.team.agents.length), foot: '<span class="ab-cta-inline" data-ab-scroll="ab-team">poori list neeche ↓</span>', tone: 'g7', spec: { src: ch, channel: ch, scope: 'people', tl: r.name, sort: 'stock' }, title: `TL ${r.name} · agents list` }) : ''}
      ${tile({ label: `${p}Expected month-end`, value: fmt(r.proj), foot: r.projBasis && r.projBasis.shortLabel ? `basis ${esc(r.projBasis.shortLabel)}` : `${fmt(d.avgVc4, true)}/day VC4`, tone: 'g6', spec: specFor('mtd', whoAm), title: `${who} ${r.name} · expected month-end` })}
    </div>`;
  }

  /** 2 · TL block — TL ka apna issuance/stock + uske agents ka jod (own + agents = TL total). */
  function tlSection(c) {
    if (c.tlView || !c.tlRow || c.direct) return '';
    const t = c.tlRow, team = c.team;
    const tlSpec = (scope, extra) => ({ src: c.ch, channel: c.ch, scope: scope === 'month' ? 'month' : scope === 'stock' ? 'stock' : 'mtd', ...(scope === 'month' ? { ym: c.ymLast } : scope === 'stock' ? {} : { ym: c.ymCur }), tl: t.name, ...extra });
    const agentsTotal = sumBy(team.agents, 'stockTotal');
    const ownTotal = team.own ? num(team.own.stockTotal) : num(t.stockOwn);
    const foot = `apna <b>${fmt(ownTotal)}</b> + agents <b>${fmt(agentsTotal)}</b> = <b>${fmt(t.stock.total)}</b>`;
    return sec('ab-tl', `👥 Team Leader ${esc(t.name)} — TL ka issuance, stock aur dispatch`, `
      <div class="ab-kpis">
        ${tile({ label: `TL last month · ${esc(c.ymLastLabel)}`, value: fmt(t.last.total), foot: `VC4 <b>${fmt(t.last.vc4)}</b> · Comm <b>${fmt(t.last.comm)}</b>`, tone: 'g5', spec: tlSpec('month'), title: `TL ${t.name} · ${c.ymLastLabel} issuance` })}
        ${tile({ label: `TL current month · ${esc(c.ymCurLabel)}`, value: fmt(t.cur.total), foot: `VC4 <b>${fmt(t.cur.vc4)}</b> · Comm <b>${fmt(t.cur.comm)}</b>`, tone: 'g2', spec: tlSpec('mtd'), title: `TL ${t.name} · ${c.ymCurLabel} issuance` })}
        ${tile({ label: 'TL growth', value: delta(t.growth), foot: `${fmt(t.last.total)} → ${fmt(t.cur.total)}`, tone: 'g3', spec: tlSpec('mtd'), title: `TL ${t.name} · growth` })}
        ${tile({ label: 'TL stock (total)', value: fmt(t.stock.total), foot, tone: 'g1', spec: tlSpec('stock'), title: `TL ${t.name} · stock (class → barcode)` })}
        ${tile({ label: 'TL ke agents', value: fmt(team.agents.length), foot: `<span class="ab-cta-inline" data-ab-scroll="ab-team">poori list neeche ↓</span>`, tone: 'g7', spec: { src: c.ch, channel: c.ch, scope: 'people', tl: t.name, sort: 'stock' }, title: `TL ${t.name} · agents list` })}
        ${tile({ label: `TL dispatch · ${fmt(c.days)} din`, value: `<span class="ab-sug">${fmt(t.dispatch.sugVc4)}<small>VC4</small></span><span class="ab-sug">${fmt(t.dispatch.sugComm)}<small>Comm</small></span>`, foot: `bina stock: VC4 <b>${fmt(t.dispatch.sugVc4Gross)}</b> · Comm <b>${fmt(t.dispatch.sugCommGross)}</b>`, tone: 'g4', spec: tlSpec('mtd'), title: `TL ${t.name} · dispatch` })}
      </div>
      <p class="ab-mini">TL ka number = uske <b>saare agents</b> + TL ki apni (own) issuance/stock. Row par click = us agent/TL ka apna 360 board.</p>`);
  }

  /** 4 · class-wise — Agent aur TL ka last · MTD · stock SIDE-BY-SIDE. */
  function classSection(c) {
    const mine = c.row.classes;
    const tlCls = c.tlView || c.direct || !c.tlRow ? [] : c.tlRow.classes;
    if (!mine.length && !tlCls.length) return '';
    const keys = [...new Set([...mine, ...tlCls].map((x) => String(x.cls).toUpperCase()))].sort((a, b) => clsRank(a) - clsRank(b));
    const pick = (list, cls, key) => num((list.find((x) => String(x.cls).toUpperCase() === cls) || {})[key]);
    const cell = (v, spec, title) => `<td class="num ab-cellclick"${kpiAttr(spec, title)}>${fmt(v)}</td>`;
    const specA = (scope, cls) => ({ src: c.ch, channel: c.ch, scope, ...(scope === 'month' ? { ym: c.ymLast } : scope === 'stock' ? {} : { ym: c.ymCur }), agent: c.row.name, agentId: c.row.id, cls, group: /^VC4$/i.test(cls) ? 'VC4' : 'COMM' });
    const specT = (scope, cls) => ({ src: c.ch, channel: c.ch, scope, ...(scope === 'month' ? { ym: c.ymLast } : scope === 'stock' ? {} : { ym: c.ymCur }), tl: c.tlRow.name, cls, group: /^VC4$/i.test(cls) ? 'VC4' : 'COMM' });
    const mineTot = { last: sumBy(mine, 'last'), cur: sumBy(mine, 'cur'), stock: sumBy(mine, 'stock') };
    const tlTot = { last: sumBy(tlCls, 'last'), cur: sumBy(tlCls, 'cur'), stock: sumBy(tlCls, 'stock') };
    // Neeche ke total ko KPI se hi lo (sheet ka row) — class rows ke jod se mismatch ho to bhi ek hi hisaab dikhe.
    const aTot = { last: num(c.row.last.total), cur: num(c.row.cur.total), stock: num(c.row.stock.total) };
    const tTot = c.tlRow ? { last: num(c.tlRow.last.total), cur: num(c.tlRow.cur.total), stock: num(c.tlRow.stock.total) } : null;
    const head = c.tlView ? 'TL' : 'Agent';
    return sec('ab-class', `🎯 Class-wise · ${head} ${esc(c.row.name)}${tlCls.length ? ` <span class="dim small">vs TL ${esc(c.tlRow.name)}</span>` : ''}`, `
      <div class="table-wrap"><table class="tbl compact ab-tbl">
        <thead>
          <tr><th rowspan="2" class="ab-th-cls">Class</th><th colspan="3" class="ab-th-group ab-th-agent">${head} · ${esc(c.row.name)}</th>${tlCls.length ? `<th colspan="3" class="ab-th-group ab-th-tl">TL · ${esc(c.tlRow.name)}</th>` : ''}</tr>
          <tr><th class="num">Last <small>(${esc(c.ymLastLabel)})</small></th><th class="num">MTD <small>(${esc(c.ymCurLabel)})</small></th><th class="num">Stock</th>${tlCls.length ? '<th class="num">Last</th><th class="num">MTD</th><th class="num">Stock</th>' : ''}</tr>
        </thead>
        <tbody>${keys.map((cls) => `<tr>
          <td class="ab-cls"><b>${esc(classLabel(cls))}</b></td>
          ${cell(pick(mine, cls, 'last'), specA('month', cls), `${c.row.name} · ${cls} · last month tags`)}
          ${cell(pick(mine, cls, 'cur'), specA('mtd', cls), `${c.row.name} · ${cls} · MTD tags`)}
          ${cell(pick(mine, cls, 'stock'), specA('stock', cls), `${c.row.name} · ${cls} · stock (barcode level)`)}
          ${tlCls.length ? `${cell(pick(tlCls, cls, 'last'), specT('month', cls), `TL ${c.tlRow.name} · ${cls} · last month`)}
          ${cell(pick(tlCls, cls, 'cur'), specT('mtd', cls), `TL ${c.tlRow.name} · ${cls} · MTD`)}
          ${cell(pick(tlCls, cls, 'stock'), specT('stock', cls), `TL ${c.tlRow.name} · ${cls} · stock`)}` : ''}
        </tr>`).join('')}</tbody>
        <tfoot><tr class="row-total"><td><b>Grand Total</b></td>
          <td class="num"><b>${fmt(aTot.last)}</b></td><td class="num"><b>${fmt(aTot.cur)}</b></td><td class="num"><b>${fmt(aTot.stock)}</b></td>
          ${tTot ? `<td class="num"><b>${fmt(tTot.last)}</b></td><td class="num"><b>${fmt(tTot.cur)}</b></td><td class="num"><b>${fmt(tTot.stock)}</b></td>` : ''}
        </tr></tfoot></table></div>
      <p class="ab-mini">Agent ka stock sheet ke class columns se, TL ka stock uske saare agents + own se. Har cell clickable — class → din → tag / barcode tak.${mine.length && (mineTot.cur !== aTot.cur || mineTot.stock !== aTot.stock) ? ' <span class="dim">(jod aur total me farq ho to total sheet ka authoritative number hai.)</span>' : ''}</p>`);
  }

  /** 5 · TL ke saare agents — har agent ka last / MTD / growth / stock + own aur TL TOTAL. */
  function teamSection(c) {
    if (!c.tlRow || !c.team.agents.length) return '';
    const t = c.tlRow, team = c.team;
    const agents = team.agents.slice().sort((a, b) => b.curTotal - a.curTotal || b.stockTotal - a.stockTotal);
    const rowHtml = (a) => {
      const spec = (scope) => ({ src: c.ch, channel: c.ch, scope, ...(scope === 'month' ? { ym: c.ymLast } : scope === 'stock' ? {} : { ym: c.ymCur }), agent: a.name, agentId: a.id });
      return `<tr class="clickable${a.isSelf ? ' ab-self' : ''}"${openAttr(a.name, kindFor(c.ch, false), a.id)}>
        <td class="ab-cellname"><b>${esc(a.name)}</b>${a.isSelf ? ' <span class="ab-tag">👤 TL apna</span>' : ''}</td>
        <td><small class="dim">${esc(a.id || '—')}</small></td>
        <td>${badge(a.status) || '<span class="dim">—</span>'}</td>
        <td>${badge(a.priority) || '<span class="dim">—</span>'}</td>
        <td class="num ab-cellclick"${kpiAttr(spec('month'), `${a.name} · last month`)}>${fmt(a.lastTotal)}</td>
        <td class="num ab-cellclick"${kpiAttr(spec('mtd'), `${a.name} · MTD`)}><b>${fmt(a.curTotal)}</b></td>
        <td class="num">${delta(a.growth)}</td>
        <td class="num ab-cellclick"${kpiAttr(spec('stock'), `${a.name} · VC4 stock`)}>${fmt(a.stockVc4)}</td>
        <td class="num ab-cellclick"${kpiAttr(spec('stock'), `${a.name} · Comm stock`)}>${fmt(a.stockComm)}</td>
        <td class="num ab-cellclick"${kpiAttr(spec('stock'), `${a.name} · total stock`)}><b>${fmt(a.stockTotal)}</b></td>
      </tr>`;
    };
    const sums = {
      last: sumBy(agents, 'lastTotal'), cur: sumBy(agents, 'curTotal'),
      vc4: sumBy(agents, 'stockVc4'), comm: sumBy(agents, 'stockComm'), stock: sumBy(agents, 'stockTotal')
    };
    const own = team.own;
    const ownLast = own ? own.lastTotal : num(t.stockOwn ? 0 : 0);
    return sec('ab-team', `🧑‍💼 TL ${esc(t.name)} ke agents <span class="ab-count">${fmt(agents.length)}</span> — har agent ka issuance + stock`, `
      <div class="table-wrap tall"><table class="tbl compact ab-tbl">
        <thead><tr><th>Agent</th><th>ID</th><th>Status</th><th>Priority</th><th class="num">Last <small>(${esc(c.ymLastLabel)})</small></th><th class="num">MTD <small>(${esc(c.ymCurLabel)})</small></th><th class="num">Growth</th><th class="num">Stock VC4</th><th class="num">Stock Comm</th><th class="num">Stock total</th></tr></thead>
        <tbody>${agents.map(rowHtml).join('')}</tbody>
        <tfoot>
          <tr class="row-total"><td colspan="4"><b>Agents total (${fmt(agents.length)})</b></td><td class="num"><b>${fmt(sums.last)}</b></td><td class="num"><b>${fmt(sums.cur)}</b></td><td></td><td class="num"><b>${fmt(sums.vc4)}</b></td><td class="num"><b>${fmt(sums.comm)}</b></td><td class="num"><b>${fmt(sums.stock)}</b></td></tr>
          ${own ? `<tr class="ab-ownrow"${openAttr(own.name, kindFor(c.ch, true), own.id)}><td colspan="4"><b>👤 TL ka apna (own)</b></td><td class="num"><b>${fmt(own.lastTotal)}</b></td><td class="num"><b>${fmt(own.curTotal)}</b></td><td></td><td class="num"><b>${fmt(own.stockVc4)}</b></td><td class="num"><b>${fmt(own.stockComm)}</b></td><td class="num"><b>${fmt(own.stockTotal)}</b></td></tr>` : ''}
          <tr class="row-total ab-tltotal"><td colspan="4"><b>= TL TOTAL${own ? ' (own + agents)' : ''}</b></td><td class="num"><b>${fmt(t.last.total)}</b></td><td class="num"><b>${fmt(t.cur.total)}</b></td><td></td><td class="num"><b>${fmt(t.stock.vc4)}</b></td><td class="num"><b>${fmt(t.stock.comm)}</b></td><td class="num"><b>${fmt(t.stock.total)}</b></td></tr>
        </tfoot></table></div>
      <p class="ab-mini">Row par click = us agent ka poora 360 board (Back se wapas). TL ki apni row agents ke jod me <b>dobara nahi</b> judti — <b>own + agents = TL total</b>${ownLast ? '' : ''}.</p>`, 'ab-team-sec');
  }

  /** 6 · Agent × Class stock matrix — TL ke saare agents + TL ki apni row. */
  function matrixSection(c) {
    const rows = c.team.all.filter((a) => a.classStock && Object.keys(a.classStock).length);
    if (rows.length < 2) return '';
    const classes = [...new Set(rows.flatMap((a) => Object.keys(a.classStock)))].sort((a, b) => clsRank(a) - clsRank(b));
    const cellOf = (a, cls) => num((a.classStock || {})[cls]);
    const colTot = classes.map((cls) => rows.reduce((n, a) => n + cellOf(a, cls), 0));
    const grand = rows.reduce((n, a) => n + a.stockTotal, 0);
    return sec('ab-matrix', `📦 Agent × Class stock matrix · TL ${esc(c.tlRow.name)}`, `
      <div class="table-wrap"><table class="tbl compact ab-tbl">
        <thead><tr><th>Agent</th>${classes.map((cls) => `<th class="num">${esc(classLabel(cls))}</th>`).join('')}<th class="num">Total</th></tr></thead>
        <tbody>${rows.map((a) => `<tr class="clickable${a.isSelf ? ' ab-self' : ''}"${openAttr(a.name, kindFor(c.ch, a.isSelf ? true : false), a.id)}>
          <td class="ab-cellname"><b>${esc(a.name)}</b>${a.isSelf ? ' <span class="ab-tag">👤 own</span>' : ''}</td>
          ${classes.map((cls) => `<td class="num">${cellOf(a, cls) ? fmt(cellOf(a, cls)) : '<span class="dim">·</span>'}</td>`).join('')}
          <td class="num"><b>${fmt(a.stockTotal)}</b></td></tr>`).join('')}</tbody>
        <tfoot><tr class="row-total"><td><b>Total (${fmt(rows.length)})</b></td>${colTot.map((v) => `<td class="num"><b>${fmt(v)}</b></td>`).join('')}<td class="num"><b>${fmt(grand)}</b></td></tr></tfoot>
      </table></div>
      <p class="ab-mini">Har cell = us agent ka us class ka stock. TL total = own + agents (upar wali table me detail).</p>`);
  }

  /** 7 · dispatch — kis agent ko kitna (after stock aur without stock). */
  function dispatchSection(c) {
    const rows = c.team.all.filter((a) => num(a.sugVc4) || num(a.sugComm) || num(a.sugVc4Gross) || num(a.sugCommGross) || num(a.stockTotal));
    if (rows.length < 2) return '';
    const list = rows.slice().sort((a, b) => (num(b.sugVc4) + num(b.sugComm)) - (num(a.sugVc4) + num(a.sugComm)) || b.stockTotal - a.stockTotal);
    const s = (k) => sumBy(list, k);
    return sec('ab-dispatch', `🚚 Kis agent ko kitna dispatch chahiye · ${fmt(c.days)} din`, `
      <div class="table-wrap"><table class="tbl compact ab-tbl">
        <thead><tr><th>Agent</th><th class="num">VC4 stock</th><th class="num">Comm stock</th><th class="num">Sug VC4 <small>after stock</small></th><th class="num">Sug Comm <small>after stock</small></th><th class="num">W/o stock VC4</th><th class="num">W/o stock Comm</th><th class="num">Total sugg.</th></tr></thead>
        <tbody>${list.map((a) => `<tr class="clickable${a.isSelf ? ' ab-self' : ''}"${openAttr(a.name, kindFor(c.ch, a.isSelf ? true : false), a.id)}>
          <td class="ab-cellname"><b>${esc(a.name)}</b>${a.isSelf ? ' <span class="ab-tag">👤 own</span>' : ''} ${badge(a.priority)}</td>
          <td class="num">${fmt(a.stockVc4)}</td><td class="num">${fmt(a.stockComm)}</td>
          <td class="num"><b>${fmt(a.sugVc4)}</b></td><td class="num"><b>${fmt(a.sugComm)}</b></td>
          <td class="num dim">${fmt(a.sugVc4Gross)}</td><td class="num dim">${fmt(a.sugCommGross)}</td>
          <td class="num"><b>${fmt(num(a.sugVc4) + num(a.sugComm))}</b></td></tr>`).join('')}</tbody>
        <tfoot><tr class="row-total"><td><b>Total (${fmt(list.length)})</b></td><td class="num">${fmt(s('stockVc4'))}</td><td class="num">${fmt(s('stockComm'))}</td><td class="num"><b>${fmt(s('sugVc4'))}</b></td><td class="num"><b>${fmt(s('sugComm'))}</b></td><td class="num">${fmt(s('sugVc4Gross'))}</td><td class="num">${fmt(s('sugCommGross'))}</td><td class="num"><b>${fmt(s('sugVc4') + s('sugComm'))}</b></td></tr></tfoot></table></div>
      <p class="ab-mini">„After stock“ = run-rate × ${fmt(c.days)} din − agent ka apna stock · „W/o stock“ = bina ghataaye (gross).</p>`);
  }

  /** 8 · charts — class split, last vs MTD, stock donut (agent + TL). */
  function chartSection(c) {
    const C = FF.charts;
    if (!C || !C.bars) return '';
    const spec = (cls, scope, who) => ({ src: c.ch, channel: c.ch, scope, ...(scope === 'month' ? { ym: c.ymLast } : scope === 'stock' ? {} : { ym: c.ymCur }), ...(who === 'tl' ? { tl: c.tlRow.name } : { agent: c.row.name, agentId: c.row.id }), cls, group: /^VC4$/i.test(cls) ? 'VC4' : 'COMM' });
    const blocks = [];
    const mine = c.row.classes;
    if (mine.length) {
      blocks.push(`<div class="ab-chart-card"><h5>${c.tlView ? 'TL' : 'Agent'} MTD class split · ${esc(c.row.name)}</h5>${C.bars({ labels: mine.map((x) => classLabel(x.cls)), height: 170, series: [{ name: 'MTD', values: mine.map((x) => num(x.cur)), color: '#0d9488' }], showValues: true, onClickAttr: (i) => kpiAttr(spec(mine[i].cls, 'mtd', c.tlView ? 'tl' : 'agent'), `${c.row.name} · ${mine[i].cls} MTD`) })}</div>`);
      blocks.push(`<div class="ab-chart-card"><h5>Last (${esc(c.ymLastLabel)}) vs MTD (${esc(c.ymCurLabel)})</h5>${C.bars({ labels: mine.map((x) => classLabel(x.cls)), height: 170, series: [{ name: `Last ${c.ymLastLabel}`, values: mine.map((x) => num(x.last)), color: '#c7d2fe' }, { name: `MTD ${c.ymCurLabel}`, values: mine.map((x) => num(x.cur)), color: '#6366f1' }], legendAlways: true, onClickAttr: (i) => kpiAttr(spec(mine[i].cls, 'mtd', c.tlView ? 'tl' : 'agent'), `${c.row.name} · ${mine[i].cls}`) })}</div>`);
      if (C.donut) blocks.push(`<div class="ab-chart-card"><h5>Stock by class · ${esc(c.row.name)}</h5>${C.donut({ items: mine.filter((x) => num(x.stock)).map((x) => ({ label: classLabel(x.cls), value: num(x.stock), attr: kpiAttr(spec(x.cls, 'stock', c.tlView ? 'tl' : 'agent'), `${c.row.name} · ${x.cls} stock`) })), subtitle: 'stock' })}</div>`);
    }
    if (!c.tlView && c.tlRow && c.tlRow.classes.length && C.bars) {
      const tc = c.tlRow.classes;
      blocks.push(`<div class="ab-chart-card"><h5>TL ${esc(c.tlRow.name)} MTD class split</h5>${C.bars({ labels: tc.map((x) => classLabel(x.cls)), height: 170, series: [{ name: 'TL MTD', values: tc.map((x) => num(x.cur)), color: '#f59e0b' }], showValues: true, onClickAttr: (i) => kpiAttr({ src: c.ch, channel: c.ch, scope: 'mtd', ym: c.ymCur, tl: c.tlRow.name, cls: tc[i].cls }, `TL ${c.tlRow.name} · ${tc[i].cls} MTD`) })}</div>`);
    }
    return blocks.length ? sec('ab-charts', '📈 Charts', `<div class="ab-chart-grid">${blocks.join('')}</div>`) : '';
  }

  function noteSection(c) {
    const src = c.ch === 'gv'
      ? '<b>GV REPORT</b> (agent + TL columns) · <b>GV Master</b> (issuance ledger) · <b>Tag Assignment</b> (stock by class)'
      : '<b>REPORT</b> (agent + TL columns) · <b>EIR</b> (issuance ledger) · <b>StockDataa</b> (stock by class)';
    const user = FF.auth && FF.auth.user ? clean(FF.auth.user.name || FF.auth.user.username) : '';
    return `<p class="ab-note">🔎 Source: ${src} · ${esc(chLabel(c.ch))} · last-month = ${esc(c.ymLastLabel)} · current = ${esc(c.ymCurLabel)} · ${esc(new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}${user ? ` · ${esc(user)}` : ''} · 📄 PDF/CSV upar ke buttons se.</p>`;
  }

  // ---- assembly ---------------------------------------------------------------------------------------------
  /** Board ke saare hisse — jo chahiye wahi use karo (`performance.js` embed karta hai). */
  function sections(person, extra = {}) {
    const c = context(person, extra);
    if (c.missing) return { missing: true, ch: c.ch, isTl: c.tlView, row: null, tlRow: null, team: { agents: [], own: null, all: [] }, html: '' };
    const parts = {
      hero: heroSection(c),
      kpis: kpiSection(c),
      tlBlock: tlSection(c),
      groupBlock: groupSection(c, c.row, c.tlView ? 'tl' : 'agent'),
      tlGroupBlock: c.tlView || c.direct || !c.tlRow ? '' : groupSection(c, c.tlRow, 'tl'),
      classBlock: classSection(c),
      teamBlock: teamSection(c),
      matrixBlock: matrixSection(c),
      dispatchBlock: dispatchSection(c),
      chartBlock: chartSection(c),
      stockIdBlock: stockIdSection(c),
      note: noteSection(c)
    };
    parts.html = [parts.hero, '<div class="ab-kpi-h">📊 Issuance &amp; dispatch summary</div>', parts.kpis, parts.tlBlock, parts.groupBlock, parts.tlGroupBlock, parts.classBlock, parts.teamBlock, parts.matrixBlock, parts.dispatchBlock, parts.chartBlock, parts.stockIdBlock, extra.extraHtml || '', parts.note].filter(Boolean).join('');
    return { missing: false, ch: c.ch, isTl: c.tlView, pr: c.pr, tlPr: c.tlPr, row: c.row, tlRow: c.tlRow, team: c.team, ctx: c, ...parts };
  }

  function body(person, extra = {}) {
    const s = sections(person, extra);
    if (s.missing) {
      const ch = s.ch;
      return `<div class="ab-wrap ab-${ch}"><section class="ab-hero" data-ch="${ch}"><span class="ab-ava">—</span><div class="ab-idbox"><b class="ab-name">${esc(person.name || '—')}</b><small class="ab-sub">${chIcon(ch)} ${esc(chLabel(ch))}</small></div></section>
        <div class="empty-state">😶 Is naam/ID ka data ${esc(chLabel(ch))} me nahi mila.<br><small class="dim">Naam / ID check karo, ya Settings → Data source me sheet dekho.</small></div></div>`;
    }
    return `<div class="ab-wrap ab-${s.ch}${s.isTl ? ' ab-istl' : ''}">${s.html}</div>`;
  }

  /** WhatsApp / Copy ke liye text — TL + agents + class-wise sab kuch. */
  function shareText(person, extra = {}) {
    const c = context(person, extra);
    if (c.missing) return `${person.name || ''} — koi data nahi mila`;
    const r = c.row, t = c.tlRow, L = [];
    L.push(`*${c.tlView ? '👥 TL' : '🧑‍💼 Agent'}: ${r.name}*${r.id ? ` (${r.id})` : ''} · ${chLabel(c.ch)}`);
    if (!c.tlView && t) L.push(`TL: *${t.name}*${t.id ? ` (${t.id})` : ''}${canContacts() && t.mobile ? ` · 📞 ${t.mobile}` : ''}`);
    L.push(`Status: ${r.status || '—'} · Priority: ${r.priority || '—'}`);
    L.push('', `*Last month (${c.ymLastLabel})*: ${fmt(r.last.total)} (VC4 ${fmt(r.last.vc4)} · Comm ${fmt(r.last.comm)})`);
    L.push(`*Current month (${c.ymCurLabel})*: ${fmt(r.cur.total)} (VC4 ${fmt(r.cur.vc4)} · Comm ${fmt(r.cur.comm)})`);
    L.push(`Growth: ${r.growth === null || r.growth === undefined ? '—' : `${r.growth >= 0 ? '+' : ''}${Number(r.growth).toFixed(1)}%`} · Expected: ${fmt(r.proj)}`);
    L.push(`Stock: ${fmt(r.stock.total)} (VC4 ${fmt(r.stock.vc4)} · Comm ${fmt(r.stock.comm)}) · Suggested dispatch (${c.days} din): VC4 ${fmt(r.dispatch.sugVc4)} · Comm ${fmt(r.dispatch.sugComm)}`);
    if (t && !c.tlView) {
      L.push('', `*TL ${t.name}* — last ${fmt(t.last.total)} · MTD ${fmt(t.cur.total)} · stock ${fmt(t.stock.total)} (own ${fmt(t.stockOwn)} + agents ${fmt(t.stockAgents)})`);
      L.push(`TL ke agents: ${fmt(c.team.agents.length)}`);
    }
    if (c.team.agents.length) {
      L.push('', `*TL ke saare agents (MTD · stock)*:`);
      c.team.agents.slice().sort((a, b) => b.curTotal - a.curTotal).forEach((a) => L.push(`• ${a.name} — last ${fmt(a.lastTotal)} · MTD ${fmt(a.curTotal)} · stock ${fmt(a.stockTotal)} (VC4 ${fmt(a.stockVc4)} · Comm ${fmt(a.stockComm)})`));
    }
    L.push('', `Class-wise (last · MTD · stock): ${r.classes.map((x) => `${classLabel(x.cls)} ${fmt(x.last)}·${fmt(x.cur)}·${fmt(x.stock)}`).join(' | ') || '—'}`);
    L.push('', 'Generated by First Forward & GV Partner Dashboard');
    return L.join('\n');
  }

  // ---- drawer + click wiring ---------------------------------------------------------------------------------
  let opened = null;              // abhi khula board (share/copy ke liye)
  let bound = false;

  function drawerActions(person) {
    const btns = [];
    if (canExport()) {
      btns.push(`<button class="btn small" data-ab-share title="WhatsApp par bhejo">🟢 WhatsApp</button>`);
      btns.push(`<button class="btn small" data-ab-copy title="Poori report copy karo">📋 Copy</button>`);
    }
    const ch = channelOf(person.kind), tl = isTlKind(person.kind), q = encodeURIComponent(person.name || '');
    btns.push(`<a class="btn small" href="#/${ch === 'gv' ? 'gvStock' : 'stock'}?${tl ? `tl=${q}` : `agent=${q}`}">📦 Stock</a>`);
    btns.push(`<a class="btn small" href="#/trend?${tl ? `tl=${q}` : `agent=${q}`}">📈 Trend</a>`);
    return btns.join('');
  }

  function bind() {
    if (bound || !document || !document.addEventListener) return;
    bound = true;
    document.addEventListener('click', (e) => {
      const el = e.target;
      if (!el || !el.closest) return;
      const openEl = el.closest('[data-ab-open]');
      if (openEl && clean(openEl.getAttribute('data-ab-open'))) {
        e.preventDefault();
        open({ kind: openEl.getAttribute('data-ab-kind') || 'ff-agent', name: openEl.getAttribute('data-ab-open'), sub: openEl.getAttribute('data-ab-id') || '' });
        return;
      }
      const scrollEl = el.closest('[data-ab-scroll]');
      if (scrollEl) {
        e.preventDefault();
        const target = U.$('#' + scrollEl.getAttribute('data-ab-scroll'));
        if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const share = el.closest('[data-ab-share]');
      const copy = el.closest('[data-ab-copy]');
      if (share || copy) {
        e.preventDefault();
        const cur = opened || { person: { kind: 'ff-agent', name: '' }, extra: {} };
        const text = shareText(cur.person, cur.extra || {});
        if (U.copyText) U.copyText(text);
        if (copy) { if (U.toast) U.toast('Poori report copy ho gayi ✓', 'ok'); return; }
        const mob = clean(cur.extra && cur.extra.tlMobile) || clean((cur.extra && cur.extra.raw && cur.extra.raw.tlMobile) || '');
        const fallback = (FF.config && FF.config.contacts && FF.config.contacts.teamWhatsapp) || '';
        if (window.open && U.waLink) window.open(U.waLink(text, mob || fallback), '_blank', 'noopener');
        return;
      }
    });
  }

  /** Drawer kholo — GV/FF ka agent ya TL (nested bhi, Back se wapas). */
  async function open(person, extra = {}) {
    if (!FF.app || !FF.app.openDrawer) return null;
    const mod = MP();
    if (mod && mod.loadFor) { try { await mod.loadFor({ kind: person.kind, name: person.name, sub: person.sub || person.id || '' }); } catch { /* offline */ } }
    bind();
    opened = { person, extra };
    const ch = channelOf(person.kind), tl = isTlKind(person.kind);
    const board = sections({ ...person, sub: person.sub || person.id || '' }, extra);
    const row = board.missing ? null : board.ctx.row;
    const tlName = row && !tl ? clean((row.tl && row.tl.name) || extra.tlName || '') : '';
    const title = clean(person.name) || '—';
    const kicker = clean(person.kicker) || `${tl ? '👥 TL 360' : '🧑‍💼 Agent 360'} · ${chLabel(ch)}${tlName ? ` · TL ${tlName}` : ''}`;
    const subParts = [];
    if (row) {
      subParts.push(`ID ${esc(row.id || person.sub || '—')}`);
      if (tlName) subParts.push(`TL <b>${esc(tlName)}</b>${row.tl.id ? ` (${esc(row.tl.id)})` : ''}${canContacts() && row.tl.mobile ? ` · 📞 <a href="tel:${esc(row.tl.mobile)}">${esc(row.tl.mobile)}</a>` : ''}`);
      if (tl && canContacts() && row.mobile) subParts.push(`📞 <a href="tel:${esc(row.mobile)}">${esc(row.mobile)}</a>`);
      subParts.push(`Last <b>${fmt(row.last.total)}</b> · MTD <b>${fmt(row.cur.total)}</b> · Stock <b>${fmt(row.stock.total)}</b>`);
      if (row.priority) subParts.push(`Priority <b>${esc(row.priority)}</b>`);
    }
    const age = tl
      ? { kind: 'tl', key: person.name, ch, title: person.name }
      : { kind: 'agent', key: person.sub || person.id || person.name, keys: [person.name, person.sub || person.id].filter(Boolean), ch, title: person.name };
    FF.app.openDrawer({
      kicker, title, sub: subParts.join(' · '),
      body: body({ ...person, sub: person.sub || person.id || '' }, extra),
      actions: drawerActions(person), wide: true, age
    });
    return true;
  }

  const openAgent = (name, sub = '', extra = {}) => open({ kind: 'ff-agent', name, sub }, extra);
  const openTl = (name, sub = '', extra = {}) => open({ kind: 'ff-tl', name, sub }, extra);

  FF.agentBoard = { open, body, sections, shareText, kindFor, channelOf, isTlKind, openAgent, openTl, _row: rowOf, _team: teamOf };
})(window.FF);
