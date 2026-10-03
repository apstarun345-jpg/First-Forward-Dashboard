/* KPI drill-down: click ANY KPI card → full breakdown of that number in a wide drawer.
   Example: "Latest day 1,000 tags" → kitne VC4 / VC5 / VC20…, GV Partner vs First Forward, Issuance vs
   Replacement, Chassis vs New VRN, class × type matrix, day-wise table, top TLs / agents, and the
   complete tag-level list (all 1,000 rows) with search + Excel download.

   Cards can describe themselves with data-kpi="src=ff&scope=day&date=2026-09-26&f=vc4":
     src   ff | gv | both            (which sheet(s))
     scope day | mtd | month | range | stock | agents | status | stockreport
     date  YYYY-MM-DD (day)   ym YYYY-MM (mtd/month)   from/to YYYY-MM-DD (range)
     f     vc4 | comm | vc20 | vc5p | repl | chassis | wrong | gv | ff
   Cards without data-kpi are understood from their title + the page they are on.

   🚨 CONVENTION (v3.37): pages that handle a card click THEMSELVES must mark the card with
   data-kpi-self="1".  app.js has one global delegated click handler for `.kpi, [data-kpi]`; without
   that marker a single click opens TWO drawers — the page's own drawer and this inferred one — and
   because this drawer is inferred from the card TITLE it ignores the page's period/flag, the last
   drawer wins and shows data unrelated to the card number.  The global handler skips any element
   inside `[data-kpi-self]`, so the page stays the single owner of that click.
   Existing examples: unusual.js anomaly cards (data-ua-flag) and agentSummary.js stock-age cards
   (data-as-age).  Settings → 🩺 Site diagnostics detects missing markers and can repair them
   site-wide (persisted attribute rules in localStorage `ff_diag_attr_repairs`). */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;
  const PAGE_SRC = { dashboard: 'ff', trend: 'ff', stock: 'ff', performance: 'ff', stockReport: 'ff', gvDashboard: 'gv', gvTrend: 'gv', gvStock: 'gv', gvStockReport: 'gv', gvPerformance: 'gv', home: 'both', tagIssued: 'both', compare: 'both', charts: 'both' };
  const malformedVrn = (r) => {
    if (/chassis/i.test(String(r && r.vrnType || ''))) return false;
    const value = String(r && r.vrn || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return !value || value.length < 6 || value.length > 13 || /^(0+|1+|9+|TEST|NA|NULL|NONE|UNKNOWN|UNAVAILABLE|XXXX|AAAA)/.test(value) || /(\d)\1{4,}/.test(value);
  };
  const FILTERS = {
    vc4: { label: 'VC4', fn: (r) => r.group === 'VC4' },
    comm: { label: 'Commercial (NVC4)', fn: (r) => r.group !== 'VC4' },
    vc20: { label: 'VC20', fn: (r) => r.group === 'VC20' },
    vc5p: { label: 'VC5+', fn: (r) => r.group === 'VC5+' },
    repl: { label: 'Replacement', fn: (r) => r.type === 'REPLACEMENT' },
    chassis: { label: 'Chassis', fn: (r) => /chassis/i.test(r.vrnType) },
    wrong: { label: 'Wrong / Invalid VRN', fn: (r) => /wrong/i.test(r.vrnType) || malformedVrn(r) },
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

  // ---- 📅 month helpers (v3.31) -------------------------------------------------------------
  /** "Sep" · "September" · "Sep 2026" · "September-26" · "2026-09" · "2026-09-30" → "YYYY-MM".
      Saal na ho to sabse naya saal jisme month aaj se aage na ho. Pehle Performance card ym=September bhejta
      tha → drawer me "NaN undefined NaN" + 0 tags dikhte the. */
  function normYm(value) {
    const t = String(value || '').trim();
    if (!t) return '';
    let m = t.match(/^(\d{4})-(\d{1,2})/);
    if (m) return `${m[1]}-${U.pad2(+m[2])}`;
    const viaUtil = U.parseMonthKey ? U.parseMonthKey(t) : null;
    if (viaUtil && /^\d{4}-\d{2}$/.test(viaUtil)) return viaUtil;
    m = t.match(/^([A-Za-z]{3,9})\.?$/);
    if (m) {
      const mi = U.MONTHS.findIndex((x) => x.toLowerCase() === m[1].slice(0, 3).toLowerCase());
      if (mi < 0) return '';
      const now = new Date();
      let y = now.getFullYear();
      if (mi > now.getMonth()) y -= 1;
      return `${y}-${U.pad2(mi + 1)}`;
    }
    return '';
  }
  /** Channel ka DATA month (FF kal tak ka data · GV live) — "is month" / "last month" isi se. */
  function dataYm(src) {
    try {
      const ff = U.channelBasis ? U.channelBasis('ff').ym : U.ymKey(new Date());
      const gv = U.channelBasis ? U.channelBasis('gv').ym : U.ymKey(new Date());
      return src === 'ff' ? ff : src === 'gv' ? gv : (ff > gv ? ff : gv);
    } catch { return U.ymKey(new Date()); }
  }
  const LAST_MONTH_RE = /\b(last|prev(ious)?|pichh?l[ae]|pichhle)\s+(full\s+)?(month|mahin[ae])\b|\blast\s+full\b|\bLM\b/i;
  /** Title me month ka naam (shuru me, ya "<month> issued / total / MTD") → YYYY-MM. "vs Aug" jaisa comparison nahi. */
  function monthFromTitle(title) {
    const t = String(title || '');
    const names = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
    const m = t.match(new RegExp(`^\\s*(?:[^\\w\\s]+\\s*)?(${names})\\b[\\s'-]*(\\d{4})?`, 'i'))
      || t.match(new RegExp(`(?<!vs\\.?\\s)\\b(${names})\\b[\\s'-]*(\\d{4})?\\s+(?:issued|issuance|total|mtd|tags)\\b`, 'i'));
    if (!m) return '';
    return normYm(m[2] ? `${m[1].slice(0, 3)} ${m[2]}` : m[1]);
  }
  const todayKey = () => U.dateKey(new Date());
  const yesterdayKey = () => { const d = new Date(); d.setDate(d.getDate() - 1); return U.dateKey(d); };

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
    const stockPage = /^(stock|gvStock|stockReport|gvStockReport)$/.test(page);
    const issuanceWord = /issued|issuance|\bmtd\b|today|aaj|tags issued|activation/i.test(t);
    const monthHit = monthFromTitle(title);
    if (/stock|inventory|cover/i.test(t) || (stockPage && !issuanceWord && /class|tl|agent|stock|cover|days/i.test(t))) {
      spec.scope = page === 'stockReport' || page === 'performance' ? 'stockreport' : 'stock';
      // "Agents with Stock" / "TLs with Stock" → ginti = itne holders · list wahi
      if (/agents?\s+(with|holding)\s+stock|agents?\s+holding/i.test(t)) { spec.scope = 'stock'; spec.holders = 'agents'; }
      else if (/\btls?\s+(with|holding)\s+stock/i.test(t)) { spec.scope = 'stock'; spec.holders = 'tls'; }
    } else if (/\b(high|medium|low)\b[^·]*priority|priority\s*(high|level)?\b/i.test(t)) {
      spec.scope = 'people'; const lv = t.match(/\b(high|medium|low)\b/i); spec.level = lv ? lv[1][0].toUpperCase() + lv[1].slice(1).toLowerCase() : 'High';
    } else if (/\binactive\b/i.test(t)) { spec.scope = 'people'; spec.state = 'inactive'; }
    else if (/\bdirect\b/i.test(t) && /agent/i.test(t)) { spec.scope = 'people'; spec.state = 'direct'; }
    else if (/agents?\s*\((gv\s+)?report\)|report\)\s*$/i.test(t) && /agent/i.test(t)) { spec.scope = 'people'; }
    else if (LAST_MONTH_RE.test(t) && !/\bvs\b|growth|compare|same period/i.test(title)) { spec.scope = 'month'; spec.ym = U.prevMonthKey(dataYm(spec.src)); }
    else if (monthHit) { spec.ym = monthHit; spec.scope = monthHit === dataYm(spec.src) ? 'mtd' : 'month'; }
    else if (/agents?/i.test(t) && !/top agent/i.test(t)) spec.scope = 'agents';
    else if (/activated|hotlist|status/i.test(t)) spec.scope = 'status';
    else if (/\byesterday\b|\bkal\b/i.test(t)) { spec.scope = 'day'; spec.date = yesterdayKey(); }
    else if (/\btoday\b|\baaj\b/i.test(t)) { spec.scope = 'day'; spec.date = todayKey(); }
    else if (/\b(mon|tue|wed|thu|fri|sat|sun)\w*\s+vs\s+last\s+week/i.test(t)) spec.scope = 'day';
    else if (/latest|last day|selected day|\b\d{1,2}\s?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(t)) spec.scope = 'day';
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
    if (base.ym) base.ym = normYm(base.ym) || base.ym;
    // 📌 card ki apni value — drawer ke top par wahi number dikhta hai (derived numbers ke liye bhi)
    const valueEl = U.$('.kpi-value', card) || card.querySelector('strong, b');
    base.cardValue = (card.dataset.kpiValue || (valueEl ? valueEl.textContent : '') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
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
    let rows = (daily || []).filter((r) => src === 'both' || (src === 'gv' ? r.channel === 'GV Partner' : r.channel !== 'GV Partner'));
    // 🩹 GV ka ledger = gv layer (EIR + GV Master ka per-tag supplement). Store ke GV rows usi layer se
    // bante hain, tab bhi Master ka jo hissa EIR me missing tha wo sirf `gv.issuanceRows()` me milta hai —
    // isliye GV rows ko wahin se lo, warna KPI ka number (GV Master) aur drill (sirf EIR) alag-alag dikhte hain.
    if ((src === 'gv' || src === 'both') && FF.gv && typeof FF.gv.issuanceRows === 'function') {
      const gvRows = FF.gv.issuanceRows();
      if (Array.isArray(gvRows) && gvRows.length) {
        const mapGv = (r) => ({
          key: r.key || (r.date ? U.dateKey(r.date) : ''), ym: r.ym, day: r.day, cls: r.cls, group: r.group,
          type: r.type || 'ISSUANCE', status: r.status || '', tagType: r.tagType || r.vrnType || '', vrnType: r.vrnType || r.tagType || '',
          channel: 'GV Partner', agentName: r.agentName || '', agentId: r.agentId || '', tlName: r.tlName || '', tlId: r.tlId || '',
          tagId: r.tagId || '', vrn: r.vrn || '', n: r.n || 1
        });
        rows = rows.filter((r) => r.channel !== 'GV Partner').concat(gvRows.map(mapGv));
      }
    }
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
    if (spec.scope === 'month') {
      const ym = spec.ym || U.prevMonthKey(dataYm(spec.src));
      return { from: `${ym}-01`, to: `${ym}-${U.pad2(U.daysInMonth(ym))}` };
    }
    const ym = spec.ym || ((spec.tl || spec.tlId || spec.agent || spec.agentId) ? dataYm(spec.src) : (latest ? latest.slice(0, 7) : U.ymKey(new Date())));
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
    if (spec.vrn && String(r.vrn || '').toUpperCase().replace(/[^A-Z0-9]/g, '') !== String(spec.vrn).toUpperCase().replace(/[^A-Z0-9]/g, '')) return false;
    const wantedGroup = String(spec.group || '').trim().toUpperCase();
    if (wantedGroup === 'VC4' && r.group !== 'VC4') return false;
    if (/^(COMM|COMMERCIAL|NVC4)$/.test(wantedGroup) && r.group === 'VC4') return false;
    if (spec.cls && classKey(r.cls) !== classKey(spec.cls)) return false;
    if (spec.type === 'REPLACEMENT' && r.type !== 'REPLACEMENT') return false;
    if (spec.type === 'NOT_REPLACEMENT' && r.type === 'REPLACEMENT') return false;
    if (spec.vrnBucket && vrnBucket(r.vrnType) !== spec.vrnBucket) return false;
    if ((spec.tl || spec.tlId) && !(spec.agent || spec.agentId)) {
      const wantTl = personKey(spec.tl);
      const wantId = personKey(spec.tlId);
      const matchName = wantTl && (personKey(r.tlName) === wantTl || personKey(r.agentName) === wantTl);
      const matchId = wantId && (personKey(r.tlId) === wantId || personKey(r.agentId) === wantId);
      if (!matchName && !matchId) return false;
    } else if (spec.tl && String(r.tlName || '').trim() && !/^direct$/i.test(String(r.tlName || '').trim())) {
      const wantTl = personKey(spec.tl);
      const wantId = personKey(spec.tlId);
      const matchName = wantTl && (personKey(r.tlName) === wantTl || personKey(r.agentName) === wantTl);
      const matchId = wantId && (personKey(r.tlId) === wantId || personKey(r.agentId) === wantId);
      if (!matchName && !matchId) return false;
    }
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
  const stat = (label, value, sub, cls, drill) => `<div class="kd-stat ${cls || ''}${drill ? ' clickable kpi-clickable' : ''}"${drill ? ` data-kd-spec='${specAttr(drill)}' title="Click to open ${esc(label)} details"` : ''}><span>${esc(label)}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;

  // ---- issuance drill-down ---------------------------------------------------------------------
  function gvSheetContext(spec, p, ledgerTot) {
    if (!spec || !(spec.src === 'gv' || spec.channel === 'gv')) return null;
    if (['day', 'range', 'week', 'all'].includes(spec.scope)) return null;
    const isTl = !!(spec.tl || spec.tlId) && !(spec.agent || spec.agentId);
    const isAgent = !!(spec.agent || spec.agentId);
    if (!isTl && !isAgent) return null;
    const MP = FF.masterProfile;
    if (!MP || typeof MP.quick !== 'function') return null;
    const name = (isTl ? spec.tl : spec.agent) || '';
    const id = (isTl ? spec.tlId : spec.agentId) || '';
    let prof = null;
    try {
      prof = MP.quick({ kind: isTl ? 'gv-tl' : 'gv-agent', name, sub: id, id, tlSet: new Set(), classMap: new Map(), bars: new Set() });
    } catch { prof = null; }
    if (!prof || !prof.found) return null;
    const ym = (p && p.from ? p.from.slice(0, 7) : '') || spec.ym || U.ymKey(new Date());
    const nowYm = (prof.months && prof.months.cur) || U.ymKey(new Date());
    const prevYm = (prof.months && prof.months.last) || U.prevMonthKey(nowYm);
    const periodKey = ym === nowYm ? 'cur' : ym === prevYm ? 'last' : '';
    if (!periodKey) return null;
    const bins = prof.groupBins && prof.groupBins[periodKey];
    const prevBins = periodKey === 'cur' && prof.groupBins ? prof.groupBins.last : null;
    const snapshots = isTl && MP.gvTlSnapshot ? MP.gvTlSnapshot(spec.tl || prof.name, spec.tlId || prof.id) : null;
    const reportSnap = snapshots && snapshots[periodKey];
    const prevSnap = periodKey === 'cur' && snapshots ? snapshots.last : null;
    const hasSheet = (bins && bins.source === 'GV REPORT sheet') || !!(reportSnap && reportSnap.total !== null && reportSnap.total !== undefined);
    if (!hasSheet) return null;
    const fullVc4 = reportSnap && reportSnap.vc4 != null ? Number(reportSnap.vc4) : Number((bins && bins.VC4) ?? 0);
    const fullVc20 = Number((bins && bins.VC20) ?? 0);
    const fullVc5p = Number((bins && bins['VC5+']) ?? 0);
    const fullComm = reportSnap && reportSnap.comm != null ? Number(reportSnap.comm) : Number((bins && (bins.VC20 + bins['VC5+'])) ?? (fullVc20 + fullVc5p));
    const fullTotal = reportSnap && reportSnap.total != null ? Number(reportSnap.total) : Number((bins && bins.total) ?? (fullVc4 + fullComm));
    const hasPrevSheet = (prevBins && prevBins.source === 'GV REPORT sheet') || !!(prevSnap && prevSnap.total !== null && prevSnap.total !== undefined);
    const pFullVc4 = hasPrevSheet ? (prevSnap && prevSnap.vc4 != null ? Number(prevSnap.vc4) : Number((prevBins && prevBins.VC4) ?? 0)) : null;
    const pFullVc20 = hasPrevSheet ? Number((prevBins && prevBins.VC20) ?? 0) : null;
    const pFullVc5p = hasPrevSheet ? Number((prevBins && prevBins['VC5+']) ?? 0) : null;
    const pFullComm = hasPrevSheet ? (prevSnap && prevSnap.comm != null ? Number(prevSnap.comm) : Number((prevBins && (prevBins.VC20 + prevBins['VC5+'])) ?? 0)) : null;
    const pFullTotal = hasPrevSheet ? (prevSnap && prevSnap.total != null ? Number(prevSnap.total) : Number((prevBins && prevBins.total) ?? 0)) : null;

    const hasAttrFilter = !!(spec.type || spec.vrnBucket || spec.tagId || spec.vrn || ['repl', 'chassis', 'wrong'].includes(spec.f));
    const clsFilter = spec.cls ? classKey(spec.cls) : '';
    const grpFilter = String(spec.group || '').trim().toUpperCase();
    let headlineTotal = null, headlineVc4 = null, headlineComm = null, prevTotal = null, filterKind = '';
    if (!hasAttrFilter) {
      if (spec.f === 'vc4' || clsFilter === 'VC4' || (grpFilter === 'VC4' && !clsFilter)) {
        headlineTotal = fullVc4; headlineVc4 = fullVc4; headlineComm = 0; prevTotal = pFullVc4; filterKind = 'VC4';
      } else if (spec.f === 'vc20' || clsFilter === 'VC20') {
        headlineTotal = fullVc20; headlineVc4 = 0; headlineComm = fullVc20; prevTotal = pFullVc20; filterKind = 'VC20';
      } else if (spec.f === 'vc5p' || clsFilter === 'VC5+') {
        headlineTotal = fullVc5p; headlineVc4 = 0; headlineComm = fullVc5p; prevTotal = pFullVc5p; filterKind = 'VC5+';
      } else if (spec.f === 'comm' || (/^(COMM|COMMERCIAL|NVC4)$/.test(grpFilter) && !clsFilter)) {
        headlineTotal = fullComm; headlineVc4 = 0; headlineComm = fullComm; prevTotal = pFullComm; filterKind = 'COMM';
      } else if (!clsFilter && !grpFilter && !spec.f) {
        headlineTotal = fullTotal; headlineVc4 = fullVc4; headlineComm = fullComm; prevTotal = pFullTotal; filterKind = 'ALL';
      }
    }
    const rawCardVal = String(spec.cardValue || '').replace(/,/g, '').trim();
    const clickedInt = /^\d+$/.test(rawCardVal) ? Number(rawCardVal) : null;
    if (clickedInt !== null && Number.isFinite(ledgerTot) && clickedInt === ledgerTot && headlineTotal !== null && clickedInt !== headlineTotal) {
      headlineTotal = ledgerTot;
    }
    const rawMembers = isTl ? [...(prof.selfAgent ? [prof.selfAgent] : []), ...(prof.agents || [])] : [];
    const members = rawMembers.map((m) => {
      const mVc4 = Number(periodKey === 'last' ? m.lastVc4 : m.curVc4) || 0;
      const mComm = Number(periodKey === 'last' ? m.lastComm : m.curComm) || 0;
      const mTot = Number(periodKey === 'last' ? m.last : m.cur) || (mVc4 + mComm);
      const sheetVc4 = filterKind === 'COMM' || filterKind === 'VC20' || filterKind === 'VC5+' ? 0 : mVc4;
      const sheetComm = filterKind === 'VC4' ? 0 : mComm;
      const sheetN = filterKind === 'VC4' ? mVc4 : (filterKind === 'COMM' || filterKind === 'VC20' || filterKind === 'VC5+') ? mComm : mTot;
      return { name: m.name || '', id: m.id || '', isSelf: !!m.isSelf, tl: prof.name || spec.tl || '', sheetN, sheetVc4, sheetComm, fullTot: mTot, fullVc4: mVc4, fullComm: mComm };
    });
    return {
      isTl, isAgent, prof, periodKey, ym, nowYm, prevYm,
      fullVc4, fullVc20, fullVc5p, fullComm, fullTotal,
      pFullVc4, pFullVc20, pFullVc5p, pFullComm, pFullTotal,
      headlineTotal, headlineVc4, headlineComm, prevTotal, filterKind,
      reportSnap, members
    };
  }
  function applySheetBreakdowns(sheetCtx, byChannel, byGroup, byClass, ledgerTot, displayTot) {
    if (!sheetCtx || sheetCtx.headlineTotal === null || ledgerTot === displayTot) return;
    byChannel.clear();
    if (displayTot > 0) byChannel.set('GV Partner', displayTot);
    byGroup.clear();
    const fk = sheetCtx.filterKind;
    if (fk === 'VC4') {
      if (displayTot > 0) byGroup.set('VC4', displayTot);
    } else if (fk === 'VC20') {
      if (displayTot > 0) byGroup.set('VC20', displayTot);
    } else if (fk === 'VC5+') {
      if (displayTot > 0) byGroup.set('VC5+', displayTot);
    } else if (fk === 'COMM') {
      if (sheetCtx.fullVc20 > 0) byGroup.set('VC20', sheetCtx.fullVc20);
      if (sheetCtx.fullVc5p > 0) byGroup.set('VC5+', sheetCtx.fullVc5p);
      if (!byGroup.size && displayTot > 0) byGroup.set('VC5+', displayTot);
    } else {
      if (sheetCtx.fullVc4 > 0 || (!sheetCtx.fullComm && displayTot === 0)) byGroup.set('VC4', sheetCtx.fullVc4);
      if (sheetCtx.fullVc20 > 0) byGroup.set('VC20', sheetCtx.fullVc20);
      if (sheetCtx.fullVc5p > 0) byGroup.set('VC5+', sheetCtx.fullVc5p);
      else if (sheetCtx.fullComm > 0 && !sheetCtx.fullVc20) byGroup.set('VC5+', sheetCtx.fullComm);
    }
    byClass.clear();
    for (const [k, v] of byGroup.entries()) byClass.set(k, v);
  }
  async function issuanceDetail(spec) {
    const all = await issuanceRows(spec.src);
    const p = period(spec, all);
    const pp = previousPeriod(p);
    const filt = filterOf(spec.f);
    const pick = (per) => all.filter((r) => inP(r, per) && (!filt || filt.fn(r)) && rowMatchesSpec(r, spec));
    const cur = pick(p), prev = pick(pp);
    state.rows = cur; state.period = p; state.spec = spec; state.raw = null;
    const ledgerTot = total(cur), ledgerPtot = total(prev);
    const ledgerVc4 = total(cur.filter((r) => r.group === 'VC4')), ledgerComm = ledgerTot - ledgerVc4;
    const sheetCtx = gvSheetContext(spec, p, ledgerTot);
    const useSheet = !!(sheetCtx && sheetCtx.headlineTotal !== null);
    const tot = useSheet ? sheetCtx.headlineTotal : ledgerTot;
    const ptot = useSheet && sheetCtx.prevTotal !== null && sheetCtx.prevTotal !== undefined ? sheetCtx.prevTotal : ledgerPtot;
    const prevLabel = useSheet && sheetCtx.prevTotal !== null && sheetCtx.prevTotal !== undefined ? `${U.labelYM(sheetCtx.prevYm)}` : pp.label;
    const vc4 = useSheet ? sheetCtx.headlineVc4 : ledgerVc4;
    const comm = useSheet ? sheetCtx.headlineComm : ledgerComm;
    const gv = useSheet ? tot : total(cur.filter((r) => r.channel === 'GV Partner')), ff = useSheet ? 0 : (tot - gv);
    const repl = total(cur.filter((r) => r.type === 'REPLACEMENT'));
    const chassis = total(cur.filter((r) => /chassis/i.test(r.vrnType)));
    const newVrn = Math.max(0, tot - chassis - total(cur.filter((r) => /wrong/i.test(r.vrnType))));
    const days = [...new Set(cur.map((r) => r.key))].sort();
    const periodLabel = p.from === p.to ? `${U.labelDateKey(p.from, true)} (${U.weekday(U.fromDateKey(p.from))})` : `${U.labelDateKey(p.from, true)} → ${U.labelDateKey(p.to, true)}`;
    // 🟩 GV aaj = GV Master sheet (live) · 🟦 FF = EIR (T+1). Purane dinon ke liye EIR ledger.
    const srcLabel = useSheet ? 'GV Partner · GV REPORT sheet + GV Master (live)' : spec.src === 'gv' ? 'GV Partner · GV Master sheet (live)' : spec.src === 'ff' ? 'First Forward issuance · EIR sheet (T+1)' : 'First Forward (EIR) + GV Partner (GV Master)';
    let reconciliationNote = '';
    if (sheetCtx && sheetCtx.isTl) {
      const reportTotal = sheetCtx.fullTotal;
      const difference = ledgerTot - reportTotal;
      const memberBreakdown = (sheetCtx.members || [])
        .filter((m) => m.fullTot > 0)
        .map((m) => `${esc(m.name)}${m.isSelf ? ' (TL own)' : ''} <b>${U.fmt(m.fullTot)}</b>`)
        .join(' + ');
      reconciliationNote = `<div class="kd-reconciliation"><b>GV REPORT ↔ tag-ledger reconciliation</b><span>GV REPORT TL snapshot: <b>${U.fmt(reportTotal)}</b> (VC4 <b>${U.fmt(sheetCtx.fullVc4)}</b> · Commercial <b>${U.fmt(sheetCtx.fullComm)}</b>) · GV Master / EIR detail: <b>${U.fmt(ledgerTot)}</b> · Difference: <b>${difference > 0 ? '+' : ''}${U.fmt(difference)}</b>.</span><small>${memberBreakdown ? `GV REPORT team breakdown: ${memberBreakdown}. ` : ''}${difference ? 'The headline TL card uses the dedicated GV REPORT TL value; class and tag details show the live issuance ledger. A refresh or source-coverage gap can explain the difference.' : 'TL snapshot and tag-level detail currently reconcile.'}</small></div>`;
    } else if (spec.src === 'gv' && spec.tl && !filt && FF.masterProfile && FF.masterProfile.gvTlSnapshot) {
      const ym = p.from.slice(0, 7), nowYm = U.ymKey(new Date());
      const snapshots = FF.masterProfile.gvTlSnapshot(spec.tl, spec.tlId);
      const report = ym === nowYm ? snapshots.cur : ym === U.prevMonthKey(nowYm) ? snapshots.last : null;
      if (report) {
        const difference = ledgerTot - report.total;
        reconciliationNote = `<div class="kd-reconciliation"><b>GV REPORT ↔ tag-ledger reconciliation</b><span>GV REPORT TL snapshot: <b>${U.fmt(report.total)}</b> · GV Master / EIR detail: <b>${U.fmt(ledgerTot)}</b> · Difference: <b>${difference > 0 ? '+' : ''}${U.fmt(difference)}</b>.</span><small>${difference ? 'The headline TL card uses the dedicated GV REPORT TL value; class and tag details show the live issuance ledger. A refresh or source-coverage gap can explain the difference.' : 'TL snapshot and tag-level detail currently reconcile.'}</small></div>`;
      }
    }
    const byClass = tally(cur, (r) => r.cls), byClassPrev = tally(prev, (r) => r.cls);
    const byChannel = tally(cur, (r) => r.channel), byChannelPrev = tally(prev, (r) => r.channel);
    const byType = tally(cur, (r) => (r.type === 'REPLACEMENT' ? 'Replacement' : 'New issuance')), byTypePrev = tally(prev, (r) => (r.type === 'REPLACEMENT' ? 'Replacement' : 'New issuance'));
    const byVrn = tally(cur, (r) => vrnBucket(r.vrnType)), byVrnPrev = tally(prev, (r) => vrnBucket(r.vrnType));
    const byGroup = tally(cur, (r) => r.group), byGroupPrev = tally(prev, (r) => r.group);
    applySheetBreakdowns(sheetCtx, byChannel, byGroup, byClass, ledgerTot, tot);
    const dayTable = days.length > 1 ? `<section class="kd-sec"><h4>📅 Day-wise (${days.length} days)</h4><div class="table-wrap kd-scroll"><table class="tbl compact kd-tbl"><thead><tr><th>Date</th><th class="num">Total</th><th class="num">VC4</th><th class="num">Commercial</th><th class="num">First Forward</th><th class="num">GV</th><th class="num">Replacement</th><th class="num">Chassis</th></tr></thead><tbody>${days.slice().reverse().map((k) => { const rs = cur.filter((r) => r.key === k); const t = total(rs), v = total(rs.filter((r) => r.group === 'VC4')), g = total(rs.filter((r) => r.channel === 'GV Partner')); return `<tr class="clickable" data-kd-day="${k}"><td><b>${esc(U.labelDateKey(k))}</b> <small class="dim">${esc(U.weekday(U.fromDateKey(k)))}</small></td><td class="num"><b>${U.fmt(t)}</b></td><td class="num">${U.fmt(v)}</td><td class="num">${U.fmt(t - v)}</td><td class="num">${U.fmt(t - g)}</td><td class="num">${U.fmt(g)}</td><td class="num">${U.fmt(total(rs.filter((r) => r.type === 'REPLACEMENT')))}</td><td class="num">${U.fmt(total(rs.filter((r) => /chassis/i.test(r.vrnType))))}</td></tr>`; }).join('')}<tr class="kd-total"><td><b>Grand Total</b></td><td class="num"><b>${U.fmt(ledgerTot)}</b></td><td class="num"><b>${U.fmt(ledgerVc4)}</b></td><td class="num"><b>${U.fmt(ledgerComm)}</b></td><td class="num"><b>${U.fmt(ledgerTot - total(cur.filter((r) => r.channel === 'GV Partner')))}</b></td><td class="num"><b>${U.fmt(total(cur.filter((r) => r.channel === 'GV Partner')))}</b></td><td class="num"><b>${U.fmt(repl)}</b></td><td class="num"><b>${U.fmt(chassis)}</b></td></tr></tbody></table></div><p class="dim small">Kisi bhi din par click karo → us din ka poora breakdown.</p></section>` : '';
    // 📐 Projection / expected card → wahi formula (aaj − 1 basis) jisse card ka number bana
    let formula = '';
    if (/projected|expected|month-?end/i.test(`${spec.title || ''}`) && p.from.endsWith('-01')) {
      const ym = p.from.slice(0, 7), md = U.daysInMonth(ym);
      const b = U.channelBasis ? U.channelBasis(spec.src === 'ff' ? 'ff' : 'gv') : null;
      const fb = U.channelBasis ? U.channelBasis('ff') : null;
      const bb = spec.src === 'both' && fb && b && fb.ym === ym && b.ym !== ym ? fb : b;
      const projDays = bb && bb.ym === ym ? bb.days : Math.round((U.fromDateKey(p.to) - U.fromDateKey(p.from)) / 86400e3) + 1;
      formula = `<div class="kd-formula">📐 Month-end projection = ${U.fmt(tot)} ÷ ${U.fmt(projDays)} din (aaj − 1) × ${U.fmt(md)} din = <b>${U.fmt(U.projectMonthEnd(tot, projDays, ym))}</b></div>`;
    }
    const body = `<div class="kd-hero"><div><span class="kd-kicker">${esc(srcLabel)}</span><div class="kd-big">${U.fmt(tot)} <small>tags</small></div><div class="kd-sub">${esc(periodLabel)}${filt ? ` · filter: <b>${esc(filt.label)}</b>` : ''}</div>${formula}</div><div class="kd-vs">${U.deltaHtml(U.growth(tot, ptot), { decimals: 0 })}<small>vs ${esc(prevLabel)}: <b>${U.fmt(ptot)}</b></small></div></div>
      ${reconciliationNote}
      <div class="kd-stats">${stat('VC4 (payable)', U.fmt(vc4), pct(vc4, tot), 'blue', { f: 'vc4', cls: '', title: `${spec.title || 'Detail'} · VC4` })}${stat('Commercial', U.fmt(comm), pct(comm, tot), 'violet', { f: 'comm', cls: '', title: `${spec.title || 'Detail'} · Commercial` })}${stat('First Forward', U.fmt(ff), pct(ff, tot), 'indigo', { src: 'ff', channel: '', title: `${spec.title || 'Detail'} · First Forward` })}${stat('GV Partner', U.fmt(gv), pct(gv, tot), 'teal', { src: 'gv', channel: '', title: `${spec.title || 'Detail'} · GV Partner` })}${stat('New issuance', U.fmt(Math.max(0, tot - repl)), pct(Math.max(0, tot - repl), tot), 'green', { type: 'NOT_REPLACEMENT', title: `${spec.title || 'Detail'} · New issuance` })}${stat('Replacement', U.fmt(repl), pct(repl, tot), 'amber', { type: 'REPLACEMENT', title: `${spec.title || 'Detail'} · Replacement` })}${stat('Chassis', U.fmt(chassis), pct(chassis, tot), 'orange', { f: 'chassis', title: `${spec.title || 'Detail'} · Chassis` })}${stat('New / VRN', U.fmt(Math.max(0, newVrn)), pct(Math.max(0, newVrn), tot), 'sky', { vrnBucket: 'New / VRN (New)', title: `${spec.title || 'Detail'} · New / VRN` })}</div>
      <div class="kd-chips">
        ${[['both', 'FF + GV'], ['ff', '🟦 First Forward only'], ['gv', '🟩 GV Partner only']].map(([s, label]) => `<button class="kd-chip ${spec.src === s ? 'green' : ''}" data-kd-spec='${specAttr({ src: s, f: '', agent: '', channel: '', title: `${spec.title || 'Detail'} · ${label}` })}'>${label}</button>`).join('')}
        ${[['vc4', 'VC4'], ['comm', 'Commercial'], ['vc20', 'VC20'], ['vc5p', 'VC5+'], ['repl', 'Replacement'], ['chassis', 'Chassis']].map(([fl, label]) => `<button class="kd-chip ${spec.f === fl ? 'green' : ''}" data-kd-spec='${specAttr({ f: fl, agent: '', channel: '', title: `${spec.title || 'Detail'} · ${label}` })}'>${label}</button>`).join('')}
        ${(spec.f || spec.agent || spec.channel) ? `<button class="kd-chip" data-kd-spec='${specAttr({ f: '', agent: '', channel: '', src: spec.src, title: spec.title })}'>↺ Clear</button>` : ''}
      </div>
      <div class="kd-grid">
        ${breakdownTable('🤝 Kis channel se — GV ya First Forward', byChannel, useSheet ? null : byChannelPrev, tot, { head: 'Channel', prevLabel: pp.label, drill: (key) => ({ src: /GV Partner/i.test(key) ? 'gv' : 'ff', channel: '', f: '', cls: '', type: '', vrnBucket: '', agent: '', agentId: '', title: `${spec.title || 'Detail'} · ${key}` }) })}
        ${breakdownTable('🚗 Class group', byGroup, useSheet ? null : byGroupPrev, tot, { head: 'Group', prevLabel: pp.label, sortCls: true, drill: (key) => ({ f: key === 'VC4' ? 'vc4' : key === 'VC20' ? 'vc20' : 'vc5p', cls: '', type: '', vrnBucket: '', title: `${spec.title || 'Detail'} · ${key}` }) })}
      </div>
      ${agentSection(cur, spec, tot, sheetCtx, ledgerTot)}
      ${breakdownTable('🏷️ Class-wise (har class kitne)', byClass, useSheet ? null : byClassPrev, tot, { head: 'Class', prevLabel: pp.label, sortCls: true, drill: (key) => ({ cls: key, f: '', type: '', vrnBucket: '', title: `${spec.title || 'Detail'} · ${key}` }) })}
      <div class="kd-grid">
        ${breakdownTable('🔁 New issuance vs Replacement', byType, byTypePrev, ledgerTot, { head: 'Type', prevLabel: pp.label, drill: (key) => ({ type: key === 'Replacement' ? 'REPLACEMENT' : 'NOT_REPLACEMENT', cls: '', f: '', vrnBucket: '', title: `${spec.title || 'Detail'} · ${key}` }) })}
        ${breakdownTable('🧩 Chassis / New VRN / Wrong VRN', byVrn, byVrnPrev, ledgerTot, { head: 'VRN type', prevLabel: pp.label, drill: (key) => ({ vrnBucket: key, cls: '', f: '', type: '', title: `${spec.title || 'Detail'} · ${key}` }) })}
      </div>
      ${matrix('🧮 Class × Issuance / Replacement', cur, (r) => r.cls, (r) => (r.type === 'REPLACEMENT' ? 'Replacement' : 'Issuance'), { head: 'Class', sortCls: true, drillRow: (key) => ({ cls: key, f: '', type: '', vrnBucket: '' }), drillCell: (cls, type) => ({ cls, f: '', type: type === 'Replacement' ? 'REPLACEMENT' : 'NOT_REPLACEMENT', vrnBucket: '' }) })}
      ${matrix('🧮 Class × Chassis / VRN', cur, (r) => r.cls, (r) => vrnBucket(r.vrnType).replace(/^New \/ VRN.*/, 'New / VRN'), { head: 'Class', sortCls: true, drillRow: (key) => ({ cls: key, f: '', type: '', vrnBucket: '' }), drillCell: (cls, bucket) => ({ cls, f: '', type: '', vrnBucket: bucket }) })}
      ${matrix('🧮 Class × Channel', cur, (r) => r.cls, (r) => r.channel, { head: 'Class', sortCls: true, drillRow: (key) => ({ cls: key, f: '', type: '', vrnBucket: '' }), drillCell: (cls, channel) => ({ cls, src: /GV Partner/i.test(channel) ? 'gv' : 'ff', channel: '', f: '', type: '', vrnBucket: '' }) })}
      ${dayTable}
      ${ffPendingNote()}
      <section class="kd-sec" id="kd-raw"><h4>📄 Poora data — sab ${U.fmt(ledgerTot || tot)} tags (tag-level list)</h4>
        <p class="dim small">Har tag ki row: Tag ID, VRN, class, type, VRN type, status, agent, TL, channel. ${spec.src === 'gv' ? '' : 'First Forward rows Google Sheet (EIR) se abhi on-demand aayengi.'}</p>
        <div class="btn-row"><button class="btn primary" data-kd-raw>📄 Load all ${U.fmt(ledgerTot || tot)} rows</button></div><div id="kd-raw-body"></div></section>`;
    return { kicker: `KPI detail · ${spec.page || ''}`, title: spec.title || 'KPI detail', sub: `${esc(periodLabel)} · <b>${U.fmt(tot)}</b> tags${filt ? ` · ${esc(filt.label)}` : ''}`, body, exportable: true };
  }
  /** 👥 "Kisne lagaye" — agent-wise (GV agent ya FF agent), poori clickable list.
      Har row par click → us agent ka poora detail (day-wise, class-wise, tags) usi drawer me. */
  function agentSection(cur, spec, tot, sheetCtx, ledgerTot) {
    const useSheetTeam = !!(sheetCtx && sheetCtx.isTl && sheetCtx.headlineTotal !== null && Array.isArray(sheetCtx.members) && sheetCtx.members.length);
    if (!cur.length && !useSheetTeam) return '';
    const map = new Map();
    cur.forEach((r) => {
      const name = r.agentName || r.agentId || 'Unknown';
      const key = `${r.channel}|${personKey(r.agentId || name)}`;
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
    if (useSheetTeam && ledgerTot !== tot) {
      const sheetMap = new Map();
      sheetCtx.members.forEach((m) => {
        const key = `GV Partner|${personKey(m.id || m.name)}`;
        const existing = map.get(key) || map.get(`GV Partner|${personKey(m.name)}`);
        sheetMap.set(key, {
          name: m.name, channel: 'GV Partner', tl: m.tl || (existing && existing.tl) || '', id: m.id || (existing && existing.id) || '',
          isSelf: m.isSelf, n: m.sheetN, vc4: m.sheetVc4, comm: m.sheetComm,
          ledgerN: existing ? existing.n : 0,
          repl: existing ? existing.repl : 0, chassis: existing ? existing.chassis : 0,
          days: existing ? existing.days : new Set()
        });
      });
      map.clear();
      for (const [k, v] of sheetMap.entries()) map.set(k, v);
    }
    const all = [...map.values()].sort((a, b) => b.n - a.n);
    const gv = all.filter((a) => a.channel === 'GV Partner');
    const ff = all.filter((a) => a.channel !== 'GV Partner');
    const top = all.slice(0, 60);
    const rows = top.map((a, i) => `<tr class="clickable" data-kd-agent="${esc(a.name)}" data-kd-agent-id="${esc(a.id || '')}" data-kd-agent-channel="${a.channel === 'GV Partner' ? 'gv' : 'ff'}" title="Click → ${esc(a.name)} ka poora detail">
      <td class="dim">${i + 1}</td>
      <td><b>${esc(a.name)}</b>${a.isSelf ? ' <span class="badge purple">TL own</span>' : ''}${a.id ? ` <small class="dim">${esc(a.id)}</small>` : ''}</td>
      <td><span class="kd-badge ${a.channel === 'GV Partner' ? 'gv' : 'ff'}">${a.channel === 'GV Partner' ? '🟩 GV' : '🟦 FF'}</span></td>
      <td>${esc(a.tl || (a.channel === 'GV Partner' ? 'Direct' : '—'))}</td>
      <td class="num"><b>${U.fmt(a.n)}</b>${a.ledgerN !== undefined && a.ledgerN !== a.n ? ` <small class="dim">(ledger ${U.fmt(a.ledgerN)})</small>` : ''}</td>
      <td class="num">${pct(a.n, tot)}</td>
      <td class="num">${U.fmt(a.vc4)}</td>
      <td class="num">${U.fmt(a.comm)}</td>
      <td class="num">${U.fmt(a.repl)}</td>
      <td class="num">${U.fmt(a.chassis)}</td>
      <td class="num">${U.fmt(a.days.size)}</td>
    </tr>`).join('');
    const tlTally = useSheetTeam && ledgerTot !== tot
      ? new Map([[`${sheetCtx.prof.name || spec.tl || 'Direct'} · GV`, tot]])
      : tally(cur, (r) => `${r.tlName || 'Direct'} · ${r.channel === 'GV Partner' ? 'GV' : 'FF'}`);
    return `<section class="kd-sec"><h4>👥 Kisne lagaye — agent-wise (GV agent ya FF agent) <span class="dim small">· ${all.length} agents · ${gv.length} GV · ${ff.length} FF</span></h4>
      <p class="dim small">Kisi bhi agent par click karo → uski day-wise, class-wise aur tag-level detail usi drawer me khulegi (andar tak click hota rahega).</p>
      <div class="table-wrap kd-scroll tall"><table class="tbl compact kd-tbl"><thead><tr><th>#</th><th>Agent</th><th>Channel</th><th>TL</th><th class="num">Tags</th><th class="num">Share</th><th class="num">VC4</th><th class="num">Comm.</th><th class="num">Repl.</th><th class="num">Chassis</th><th class="num">Days</th></tr></thead><tbody>${rows}<tr class="kd-total"><td colspan="4"><b>Grand Total (${all.length} agents)</b></td><td class="num"><b>${U.fmt(tot)}</b></td><td class="num">100%</td><td class="num"><b>${U.fmt(useSheetTeam && ledgerTot !== tot ? (sheetCtx.headlineVc4 ?? U.sum(all, (a) => a.vc4)) : U.sum(all, (a) => a.vc4))}</b></td><td class="num"><b>${U.fmt(useSheetTeam && ledgerTot !== tot ? (sheetCtx.headlineComm ?? U.sum(all, (a) => a.comm)) : U.sum(all, (a) => a.comm))}</b></td><td class="num"><b>${U.fmt(U.sum(all, (a) => a.repl))}</b></td><td class="num"><b>${U.fmt(U.sum(all, (a) => a.chassis))}</b></td><td class="num">—</td></tr></tbody></table></div>
      ${all.length > top.length ? `<p class="dim small">Top ${top.length} dikhaye — poore ${all.length} agents ka Excel "⬇ Breakdown Excel" se milta hai.</p>` : ''}
      ${breakdownTable('🧑‍💼 TL-wise (channel ke saath)', tlTally, null, tot, { head: 'TL · channel', drill: (key) => { const [tlPart, chPart] = String(key).split(' · '); return { tl: tlPart === 'Direct' ? '' : tlPart, src: chPart === 'GV' ? 'gv' : 'ff', title: `TL ${tlPart}` }; } })}
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
    const ledgerTot = total(inRange);
    const channel = inRange.length ? inRange[0].channel : (spec.channel === 'gv' || spec.src === 'gv' ? 'GV Partner' : 'First Forward');
    const sheetCtx = gvSheetContext(spec, p, ledgerTot);
    const useSheet = !!(sheetCtx && sheetCtx.headlineTotal !== null);
    const tot = useSheet ? sheetCtx.headlineTotal : ledgerTot;
    // TL naam — issuance rows se; na mile to stock ageing index / performance list se (v3.28: drawer me TL hamesha dikhe).
    let tl = inRange.reduce((t, r) => t || r.tlName, '') || (sheetCtx && sheetCtx.prof && sheetCtx.prof.tl && sheetCtx.prof.tl.name) || '';
    const id = inRange.reduce((t, r) => t || r.agentId, '') || spec.agentId || (sheetCtx && sheetCtx.prof && sheetCtx.prof.id) || '';
    if (!tl) {
      const node = FF.stockAge && FF.stockAge.forAgent(spec.agentId || name);
      if (node && node.tl) tl = node.tl;
      if (!tl && FF.pages.performance && FF.pages.performance.agents) {
        const a = (FF.pages.performance.agents() || []).find((x) => personKey(x.name) === personKey(name) || (spec.agentId && String(x.id) === String(spec.agentId)));
        if (a && a.tlName) tl = a.tlName;
      }
    }
    const byDay = tally(inRange, (r) => r.key);
    const byCls = tally(inRange, (r) => r.cls);
    const byGroup = tally(inRange, (r) => r.group);
    const byChannel = tally(inRange, (r) => r.channel);
    applySheetBreakdowns(sheetCtx, byChannel, byGroup, byCls, ledgerTot, tot);
    const byType = tally(inRange, (r) => (r.type === 'REPLACEMENT' ? 'Replacement' : 'New issuance'));
    const byVrn = tally(inRange, (r) => vrnBucket(r.vrnType));
    const days = [...byDay.keys()].sort();
    const periodLabel = p.from === p.to ? U.labelDateKey(p.from, true) : `${U.labelDateKey(p.from, true)} → ${U.labelDateKey(p.to, true)}`;
    const otherRows = (await issuanceRows('both')).filter((r) => (r.agentName || '') !== name);
    const rank = [...tally(otherRows.concat(inRange), (r) => r.agentName || r.agentId || '—').entries()].sort((a, b) => b[1] - a[1]).findIndex(([k]) => k === name) + 1;
    state.rows = inRange; state.period = p; state.spec = spec; state.raw = null;
    const ledgerVc4 = total(inRange.filter((r) => r.group === 'VC4'));
    const ledgerComm = total(inRange.filter((r) => r.group !== 'VC4'));
    const totVc4 = useSheet ? sheetCtx.headlineVc4 : ledgerVc4;
    const totComm = useSheet ? sheetCtx.headlineComm : ledgerComm;
    const totChassis = total(inRange.filter((r) => /chassis/i.test(r.vrnType)));
    const totRepl = total(inRange.filter((r) => r.type === 'REPLACEMENT'));
    let reconciliationNote = '';
    if (sheetCtx) {
      const difference = ledgerTot - sheetCtx.fullTotal;
      reconciliationNote = `<div class="kd-reconciliation"><b>GV REPORT ↔ tag-ledger reconciliation</b><span>GV REPORT agent snapshot: <b>${U.fmt(sheetCtx.fullTotal)}</b> (VC4 <b>${U.fmt(sheetCtx.fullVc4)}</b> · Commercial <b>${U.fmt(sheetCtx.fullComm)}</b>) · GV Master / EIR detail: <b>${U.fmt(ledgerTot)}</b> · Difference: <b>${difference > 0 ? '+' : ''}${U.fmt(difference)}</b>.</span><small>${difference ? 'Headline & summary cards show the GV REPORT sheet value; day-wise & tag-level tables below come from the GV Master / EIR tag ledger.' : 'GV REPORT snapshot and tag-level detail currently reconcile.'}</small></div>`;
    }
    const body = `<div class="kd-hero"><div><span class="kd-kicker">${esc(channel === 'GV Partner' ? '🟩 GV Partner agent' : '🟦 First Forward agent')}</span><div class="kd-big">${U.fmt(tot)} <small>tags</small></div><div class="kd-sub">${esc(periodLabel)} · TL <b>${esc(tl || '—')}</b>${id ? ` · ID ${esc(id)}` : ''}${rank > 0 ? ` · rank #${rank}` : ''}</div></div>
      <div class="kd-acts"><a class="btn small" href="#/performance?agent=${encodeURIComponent(name)}">🏆 Performance →</a><a class="btn small" href="#/masterSearch?q=${encodeURIComponent(name)}">🔎 Master profile →</a></div></div>
      ${reconciliationNote}
      <div class="kd-stats">${stat('VC4 (payable)', U.fmt(totVc4), pct(totVc4, tot), 'blue', { f: 'vc4', cls: '', title: `${name} · VC4` })}${stat('Commercial', U.fmt(totComm), pct(totComm, tot), 'violet', { f: 'comm', cls: '', title: `${name} · Commercial` })}${stat('Chassis', U.fmt(totChassis), '', 'orange', { f: 'chassis', title: `${name} · Chassis` })}${stat('Replacement', U.fmt(totRepl), '', 'amber', { type: 'REPLACEMENT', title: `${name} · Replacement` })}${stat('Active days', U.fmt(days.length), days.length ? `${U.fmt(Math.round(tot / days.length))}/day` : '', 'green')}</div>
      <div class="kd-grid">${breakdownTable('🚗 Class group', byGroup, null, tot, { head: 'Group', sortCls: true, drill: (key) => ({ f: key === 'VC4' ? 'vc4' : key === 'VC20' ? 'vc20' : 'vc5p', cls: '', type: '', vrnBucket: '' }) })}${breakdownTable('🔁 Type', byType, null, ledgerTot, { head: 'Type', drill: (key) => ({ type: key === 'Replacement' ? 'REPLACEMENT' : 'NOT_REPLACEMENT', cls: '', f: '', vrnBucket: '' }) })}</div>
      ${breakdownTable('🏷️ Class-wise', byCls, null, tot, { head: 'Class', sortCls: true, drill: (key) => ({ cls: key, f: '', type: '', vrnBucket: '' }) })}
      ${breakdownTable('🧩 VRN type', byVrn, null, ledgerTot, { head: 'VRN type', drill: (key) => ({ vrnBucket: key, cls: '', f: '', type: '' }) })}
      <section class="kd-sec"><h4>📅 Day-wise (${days.length} din)</h4><div class="table-wrap kd-scroll"><table class="tbl compact kd-tbl"><thead><tr><th>Date</th><th class="num">Tags</th><th class="num">VC4</th><th class="num">Commercial</th></tr></thead><tbody>${days.slice().reverse().map((k) => { const rs = inRange.filter((r) => r.key === k); const t = total(rs), v = total(rs.filter((r) => r.group === 'VC4')); return `<tr class="clickable" data-kd-agent-day="${k}"><td><b>${esc(U.labelDateKey(k))}</b> <small class="dim">${esc(U.weekday(U.fromDateKey(k)))}</small></td><td class="num"><b>${U.fmt(t)}</b></td><td class="num">${U.fmt(v)}</td><td class="num">${U.fmt(t - v)}</td></tr>`; }).join('')}<tr class="kd-total"><td><b>Grand Total</b></td><td class="num"><b>${U.fmt(ledgerTot)}</b></td><td class="num"><b>${U.fmt(ledgerVc4)}</b></td><td class="num"><b>${U.fmt(ledgerComm)}</b></td></tr></tbody></table></div></section>
      <section class="kd-sec" id="kd-raw"><h4>📄 Poora data — sab ${U.fmt(ledgerTot || tot)} tags (tag-level list)</h4>
        <p class="dim small">Har tag ki row: Tag ID, VRN, class, type, VRN type, status, agent, TL, channel.</p>
        <div class="btn-row"><button class="btn primary" data-kd-raw>📄 Load all ${U.fmt(ledgerTot || tot)} rows</button></div><div id="kd-raw-body"></div></section>`;
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
        agentName: r.agentName || '', agentId: r.agentId || '', tlName: r.tlName || '', tlId: r.tlId || '',
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
  /** Stock rows ka class filter (card "VC4 stock" / "Commercial stock" / class chip) — total wahi jo card par. */
  function stockClassFn(spec) {
    const f = String(spec.f || '').split(',').map((x) => x.trim()).find((x) => ['vc4', 'comm', 'vc20', 'vc5p'].includes(x));
    const cls = spec.cls ? classKey(spec.cls) : '';
    if (!f && !cls) return null;
    const groupOf = (r) => r.group || FF.model.classGroup(classKey(r.cls));
    return {
      label: cls || { vc4: 'VC4', comm: 'Commercial (NVC4)', vc20: 'VC20', vc5p: 'VC5+' }[f],
      fn: (r) => (cls ? classKey(r.cls) === cls : true) && (!f || (f === 'vc4' ? groupOf(r) === 'VC4' : f === 'comm' ? groupOf(r) !== 'VC4' : f === 'vc20' ? groupOf(r) === 'VC20' : groupOf(r) === 'VC5+'))
    };
  }
  const SOFT = { stock: 30000, types: 4000 };   // ek dataset ke liye max intezaar (phir drawer jo hai wahi dikhata hai) · optional "Tag type" table ka dataset (tests chhota karte hain)
  const MISSING = { missing: true };
  async function stockDetail(spec) {
    const parts = [];
    const lost = [];   // jo datasets deadline tak nahi aaye
    let grand = 0, holdersN = null;
    const cf = stockClassFn(spec);
    const keep = (r) => !cf || cf.fn(r);
    const tlWanted = U.clean(spec.tl || spec.tlName).toUpperCase();
    const agentWanted = [spec.agent, spec.agentId].map(personKey).filter(Boolean);
    const agentOk = (r) => !agentWanted.length || [r.agentName, r.agentId].map(personKey).some((k) => agentWanted.includes(k));
    const tlOk = (r) => !tlWanted || U.clean(r.tlName).toUpperCase() === tlWanted;
    // 🧩 v3.40 — TL profile ke 'Own 40' / 'agents 80' chips: drawer me bhi wahi hissa dikhe, poora nahi.
    // `part=own` → sirf TL ki APNI stock rows; `part=team` → agents ki rows (TL ki row aur direct agents aside).
    const part = U.clean(spec.part || '').toLowerCase();
    const selfNameOfTl = U.clean(spec.tlName || spec.tl || '');
    const partOk = (r, chKey) => {
      if (!tlWanted || (part !== 'own' && part !== 'team')) return true;
      const isSelf = !!selfNameOfTl && U.clean(r.agentName).toUpperCase() === selfNameOfTl.toUpperCase();
      if (part === 'own') return isSelf;
      if (isSelf) return false;
      try { return !(FF.config && FF.config.isDirectAgent && FF.config.isDirectAgent(r, chKey)); } catch { return true; }
    };
    const partLabel = part === 'own' ? ' · TL ke paas (own)' : part === 'team' ? ' · agents ke paas' : '';
    const holdersTable = (title, map, unit) => {
      const list = [...map.entries()].sort((a, b) => b[1].n - a[1].n);
      holdersN = (holdersN || 0) + list.length;
      return `<section class="kd-sec"><h4>${title} · <b>${U.fmt(list.length)}</b></h4><div class="table-wrap kd-scroll tall"><table class="tbl compact kd-tbl"><thead><tr><th>#</th><th>${esc(unit)}</th><th>TL / channel</th><th class="num">Stock</th><th class="num">VC4</th><th class="num">Commercial</th></tr></thead><tbody>${list.map(([k, v], i) => `<tr${v.agent ? ` class="clickable" data-kd-agent="${esc(v.agent)}" data-kd-agent-id="${esc(v.id || '')}" data-kd-agent-channel="${v.ch}"` : ''}><td class="dim">${i + 1}</td><td><b>${esc(v.name || k)}</b>${v.id ? ` <small class="dim">${esc(v.id)}</small>` : ''}</td><td class="dim">${esc(v.tl || '—')}</td><td class="num"><b>${U.fmt(v.n)}</b></td><td class="num">${U.fmt(v.vc4)}</td><td class="num">${U.fmt(v.n - v.vc4)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Koi nahi</td></tr>'}</tbody></table></div></section>`;
    };
    if (spec.src === 'ff' || spec.src === 'both') {
      let stock = FF.store.get('stock'), agents = FF.store.get('stockAgents'), types = FF.store.get('stockTypes');
      // Teeno datasets parallel (pehle ek ke baad ek — latency jod ke) aur har ek par hard limit: koi slow Google query
      // poore drawer ko "Detail calculate ho rahi hai…" par nahi rokti. Jo na aaye uska saaf notice + Retry.
      const soft = (key, cur, ms) => (cur !== undefined && cur !== null ? Promise.resolve(cur) : U.within(FF.store.need(key), ms || SOFT.stock, MISSING));
      // `stockTypes` (agent × type, sabse bhaari query) sirf optional "Tag type" table ke liye hai — uske liye thoda hi ruko.
      [stock, agents, types] = await Promise.all([soft('stock', stock), soft('stockAgents', agents), soft('stockTypes', types, SOFT.types)]);
      if (stock === MISSING) { stock = []; lost.push('class × TL stock'); }
      if (agents === MISSING) { agents = []; lost.push('agent-wise stock'); }
      if (types === MISSING) types = [];   // sirf "Tag type" table optional hai
      const agentRows = (agents || []).filter((r) => keep(r) && agentOk(r) && tlOk(r) && partOk(r, 'ff'));
      // agent / TL filter ho to class-wise bhi agent rows se (stock store TL × class hai, agent nahi)
      const rows = agentWanted.length || tlWanted ? agentRows.map((r) => ({ cls: r.cls, group: r.group, tlName: r.tlName, n: r.n })) : (stock || []).filter(keep).map((r) => ({ ...r, n: r.n }));
      const tot = total(rows); grand += tot;
      const byType = new Map(); (types || []).filter((r) => !cf || cf.fn(r)).forEach((r) => byType.set(r.tagType || '—', (byType.get(r.tagType || '—') || 0) + r.n));
      const byAgent = new Map(); agentRows.forEach((r) => byAgent.set(`${r.agentName} · ${r.tlName}`, (byAgent.get(`${r.agentName} · ${r.tlName}`) || 0) + r.n));
      let holders = '';
      if (spec.holders === 'agents' || spec.holders === 'tls') {
        const map = new Map();
        agentRows.forEach((r) => {
          const key = spec.holders === 'tls' ? (U.clean(r.tlName) || '—') : (U.clean(r.agentId) || U.clean(r.agentName) || '—');
          const v = map.get(key) || { name: spec.holders === 'tls' ? r.tlName : r.agentName, id: spec.holders === 'tls' ? '' : r.agentId, tl: spec.holders === 'tls' ? 'First Forward' : r.tlName, agent: spec.holders === 'tls' ? '' : r.agentName, ch: 'ff', n: 0, vc4: 0 };
          v.n += r.n; if (r.group === 'VC4') v.vc4 += r.n; map.set(key, v);
        });
        holders = holdersTable(spec.holders === 'tls' ? '👥 TLs jinke paas stock hai' : '🧑‍💼 Agents jinke paas stock hai', map, spec.holders === 'tls' ? 'TL' : 'Agent');
      }
      parts.push(`<h3 class="kd-h">🟦 First Forward stock (StockDataa)${cf ? ` · ${esc(cf.label)}` : ''}${spec.agent ? ` · ${esc(spec.agent)}` : tlWanted ? ` · TL ${esc(spec.tl || spec.tlName)}${partLabel}` : ''} · <b>${U.fmt(tot)}</b></h3>${holders}
        <div class="kd-grid">${breakdownTable('Class-wise', tally(rows, (r) => r.cls), null, tot, { head: 'Class', sortCls: true, drill: (key) => ({ cls: key, f: '', title: `${spec.title || 'Stock'} · ${key}` }) })}${byType.size && !agentWanted.length && !tlWanted ? breakdownTable('Tag type', byType, null, total([...byType.values()].map((n) => ({ n }))), { head: 'Tag type' }) : ''}</div>
        ${breakdownTable('TL-wise stock', tally(rows, (r) => (FF.config.isDirectAgent(r, 'gv') ? FF.config.directLabel(r, 'gv') : r.tlName)), null, tot, { head: 'TL', drill: (key) => ({ tl: key, src: 'ff', scope: 'stock', title: `TL ${key} · FF Stock` }) })}
        ${agentWanted.length ? '' : matrix('TL × class', rows, (r) => (FF.config.isDirectAgent(r, 'gv') ? FF.config.directLabel(r, 'gv') : r.tlName), (r) => r.cls, { head: 'TL', drillRow: (tl) => ({ tl, src: 'ff', scope: 'stock', title: `TL ${tl} · FF Stock` }), drillCell: (tl, cls) => ({ tl, cls, src: 'ff', scope: 'stock', title: `TL ${tl} · ${cls} Stock` }) })}
        ${breakdownTable('Top 30 agents (stock)', new Map([...byAgent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)), null, tot, { head: 'Agent · TL', drill: (key) => { const ag = String(key).split(' · ')[0]; return { agent: ag, src: 'ff', scope: 'stock', title: `${ag} · FF Stock` }; } })}`);
    }
    if (spec.src === 'gv' || spec.src === 'both') {
      const G = FF.gv; let cls = [], tls = [], agents = [], agentCls = [];
      const gsoft = (key) => { const cur = G.get && G.get(key); return cur !== undefined && cur !== null ? Promise.resolve(cur) : U.within(G.need(key), SOFT.stock, MISSING); };
      const got = await Promise.all(['stockClass', 'stockTl', 'stockAgent', 'stockAgentClass'].map(gsoft));
      const pickG = (v, label) => { if (v === MISSING) { if (label) lost.push(label); return []; } return v || []; };
      cls = pickG(got[0], 'GV class-wise stock'); tls = pickG(got[1], 'GV TL-wise stock'); agents = pickG(got[2], 'GV agent-wise stock'); agentCls = pickG(got[3], '');
      // GV ki 'Stock Agent Class' rows me TL ka column NAHI hota (sirf agentName × class). Isliye TL filter
      // seedha wahan lagane par list khaali reh jaati aur (purana behaviour) poore GV ka stock dikh jaata —
      // card 34, drawer hazaaron. Ab TL ke agents ka set 'Stock Agent' (agent × TL) rows se banata hai.
      const agentRowsGv = (agents || []).filter((r) => keep(r) && agentOk(r) && tlOk(r) && partOk(r, 'gv'));
      const tlAgentKeys = new Set();
      if (tlWanted || agentWanted.length) (agents || []).filter((r) => agentOk(r) && tlOk(r)).forEach((r) => {
        const nm = U.clean(r.agentName).toUpperCase(); if (nm) tlAgentKeys.add(nm);
        const id = U.clean(r.agentId).toUpperCase(); if (id) tlAgentKeys.add('#' + id);
      });
      const clsTlOk = (r) => !tlWanted && !agentWanted.length ? true
        : tlAgentKeys.has(U.clean(r.agentName).toUpperCase()) || (!!U.clean(r.agentId).toUpperCase() && tlAgentKeys.has('#' + U.clean(r.agentId).toUpperCase()));
      const filteredAgentCls = (agentCls || []).filter((r) => keep(r) && agentOk(r) && (tlWanted || agentWanted.length ? (clsTlOk(r) && partOk(r, 'gv')) : (tlOk(r) && partOk(r, 'gv'))));
      const useAgentRows = !!(cf || agentWanted.length || tlWanted || part) && filteredAgentCls.length;
      const clsRows = useAgentRows ? filteredAgentCls : (tlWanted || agentWanted.length || part) ? agentRowsGv : (cls || []).filter(keep);
      const tot = total(clsRows); grand += tot;
      const agentTotals = new Map();
      (useAgentRows ? filteredAgentCls : agentRowsGv).forEach((a) => {
        // Card "Agents with Stock" Tag Assignment ki (agent, TL) rows ginta hai — list bhi usi granularity par
        const key = useAgentRows ? (U.clean(a.agentId) || U.clean(a.agentName)) : [a.agentId, a.agentName, a.tlId, a.tlName].map((x) => U.clean(x)).join('|');
        const v = agentTotals.get(key) || { name: a.agentName, id: a.agentId, tl: a.tlName || '—', agent: a.agentName, ch: 'gv', n: 0, vc4: 0 };
        const n = Number(a.n) || 0; v.n += n; if (useAgentRows ? classKey(a.cls) === 'VC4' : false) v.vc4 += n; agentTotals.set(key, v);
      });
      // v3.40 — GV me bhi FF jaisa "TL × class" matrix: class rows me TL column nahi hota, isliye TL ka
      // mapping 'Stock Agent' (agent × TL) rows se jodte hain (FF drawer ke barabar detail).
      const tlOfAgent = new Map();
      (agents || []).forEach((r) => {
        const k = U.clean(r.agentName).toUpperCase(); if (!k || tlOfAgent.has(k)) return;
        tlOfAgent.set(k, r.directAgent === true || !FF.config.isRealTl(r.tlName) ? FF.config.directLabel({ tlName: r.tlName, channel: 'GV Partner' }, 'gv') : (U.clean(r.tlName) || '—'));
      });
      const gvTlClsRows = filteredAgentCls.map((r) => ({ ...r, tlName: r.tlName || tlOfAgent.get(U.clean(r.agentName).toUpperCase()) || (tlWanted ? U.clean(spec.tl || spec.tlName) : '—') }));
      let holders = '';
      if (spec.holders === 'agents') holders = holdersTable('🧑‍💼 GV agents jinke paas stock hai', agentTotals, 'Agent');
      else if (spec.holders === 'tls') {
        const map = new Map();
        (tls || []).filter((t) => FF.config.isRealTl(t.tlName) && t.directAgent !== true).forEach((t) => map.set(t.tlName, { name: t.tlName, tl: 'GV Partner', ch: 'gv', n: Number(t.n) || 0, vc4: 0 }));
        holders = holdersTable('👥 GV TLs jinke paas stock hai', map, 'TL');
      }
      parts.push(`<h3 class="kd-h">🟩 GV Partner stock (Tag Assignment)${cf ? ` · ${esc(cf.label)}` : ''}${spec.agent ? ` · ${esc(spec.agent)}` : tlWanted ? ` · TL ${esc(spec.tl || spec.tlName)}${partLabel}` : ''} · <b>${U.fmt(tot)}</b></h3>${holders}
        <div class="kd-grid">${breakdownTable('Class-wise', tally(clsRows, (r) => r.cls), null, tot, { head: 'Class', sortCls: true, drill: (key) => ({ cls: key, f: '', title: `${spec.title || 'Stock'} · ${key}` }) })}${useAgentRows ? '' : breakdownTable('TL-wise', tally(tls || [], (r) => (r.directAgent === true || !FF.config.isRealTl(r.tlName) ? FF.config.directLabel({ tlName: r.tlName, channel: 'GV Partner' }, 'gv') : r.tlName)), null, total(tls || []), { head: 'TL', drill: (key) => ({ tl: key, src: 'gv', scope: 'stock', title: `TL ${key} · GV Stock` }) })}</div>
        ${breakdownTable('Top 30 agents (stock)', new Map([...agentTotals.values()].sort((a, b) => b.n - a.n).slice(0, 30).map((a) => [`${a.name} · ${a.tl || '—'}`, a.n])), null, tot, { head: 'Agent · TL', drill: (key) => { const ag = String(key).split(' · ')[0]; return { agent: ag, src: 'gv', channel: 'gv', scope: 'stock', title: `${ag} · GV Stock` }; } })}
        ${agentWanted.length || !gvTlClsRows.length ? '' : matrix('TL × class', gvTlClsRows, (r) => r.tlName, (r) => r.cls, { head: 'TL', drillRow: (tl) => ({ tl, src: 'gv', scope: 'stock', title: `TL ${tl} · GV Stock` }), drillCell: (tl, cls) => ({ tl, cls, src: 'gv', scope: 'stock', title: `TL ${tl} · ${cls} Stock` }) })}`);
    }
    const btn = (kind, label) => `<button class="btn primary" data-kd-sheetrows="${kind}">📄 ${label}</button>`;
    const rawBtns = [];
    if (spec.src === 'ff' || spec.src === 'both') rawBtns.push(btn('ff-stock', 'StockDataa rows load karo'));
    if (spec.src === 'gv' || spec.src === 'both') rawBtns.push(btn('gv-stock', 'Tag Assignment rows load karo'));
    if (rawBtns.length) {
      parts.push(`<section class="kd-sec"><h4>📄 Poora data — sheet ki tag-level rows</h4>
        <p class="dim small">Last level: yahan se seedha us sheet tab ki asli rows (barcode/serial ke saath) load hongi${spec.agent ? ` · filter: <b>${esc(spec.agent)}</b>` : ''}${cf ? ` · class: <b>${esc(cf.label)}</b>` : ''}.</p>
        <div class="btn-row">${rawBtns.join('')}</div><div id="kd-rows"><div class="empty">Abhi load nahi hua.</div></div></section>`);
    }
    state.spec = spec; state.rows = null; state.raw = null;
    const headline = holdersN !== null ? `<b>${U.fmt(holdersN)}</b> ${spec.holders === 'tls' ? 'TLs' : 'agents'} · ${U.fmt(grand)} tags` : `Total <b>${U.fmt(grand)}</b> tags in field${cf ? ` · ${esc(cf.label)}` : ''}`;
    const notice = lost.length ? `<div class="kd-notice" role="status">⚠️ <b>${esc([...new Set(lost)].join(' · '))}</b> abhi load nahi hua (Google Sheet slow / fail) — neeche ke numbers adhure ho sakte hain. <button type="button" class="btn small" data-kd-retry>↻ Retry</button></div>` : '';
    return { kicker: 'KPI detail · Stock', title: spec.title || 'Stock in field', sub: headline, body: notice + (parts.join('') || '<div class="empty">Stock data nahi mila.</div>') };
  }
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
    return { kicker: 'KPI detail · Stock Report', title: spec.title || 'Stock Report', sub: `REPORT → Agent Inventory Summary · <b>${U.fmt(tot)}</b> tags · ${agents.length} agents`, body: `<div class="kd-grid">${breakdownTable('Class-wise stock', cls, null, tot, { head: 'Class', sortCls: true, drill: (key) => ({ scope: 'stock', src: 'ff', cls: key, title: `Stock · ${key}` }) })}${breakdownTable('Dispatch priority (agents)', prio, null, agents.length, { head: 'Priority', drill: (key) => ({ scope: 'people', src: 'ff', level: key, title: `${key} priority agents` }) })}</div>${breakdownTable('TL stock alert (agents)', alerts, null, agents.length, { head: 'Alert' })}${breakdownTable('TL-wise stock', byTl, null, tot, { head: 'TL', drill: (key) => ({ scope: 'stock', src: 'ff', tl: key, title: `TL ${key} · Stock` }) })}${breakdownTable('Top 30 agents by stock', topAgents, null, tot, { head: 'Agent · TL', drill: (key) => { const ag = String(key).split(' · ')[0]; return { scope: 'stock', src: 'ff', agent: ag, title: `${ag} · Stock` }; } })}` };
  }
  async function agentsDetail(spec) {
    if (spec.list === 'report') return peopleDetail(spec);
    const out = [];
    let ffCount = null, gvCount = null;
    // v3.31: har channel apne DATA month par (FF kal tak · GV live) — pehle 'both' ka latest (aaj, GV) FF par
    // lagta tha → 1 tareekh ko FF active agents 0 dikhte the jabki card September ka number dikhata tha.
    const ffYm = spec.ym || dataYm('ff'), gvYm = spec.ym || dataYm('gv');
    if (spec.src === 'ff' || spec.src === 'both') {
      let agents = FF.store.get('agents'); try { agents = agents || await FF.store.need('agents'); } catch { agents = []; }
      const ym = ffYm;
      const cur = (agents || []).filter((a) => a.ym === ym && (spec.src === 'ff' ? a.channel !== 'GV Partner' : true));
      const per = new Map(); cur.forEach((a) => { const k = a.key; const x = per.get(k) || { name: a.name, tl: a.tlName, channel: a.channel, n: 0 }; x.n += a.n; per.set(k, x); });
      const list = [...per.values()].sort((a, b) => b.n - a.n);
      ffCount = list.length;
      const byCh = new Map(); list.forEach((a) => byCh.set(a.channel, (byCh.get(a.channel) || 0) + 1));
      const byTl = new Map(); list.forEach((a) => byTl.set(a.tl, (byTl.get(a.tl) || 0) + 1));
      out.push(`<h3 class="kd-h">${spec.src === 'ff' ? '🟦 First Forward' : '🟦 EIR (FF + GV)'} · active agents ${esc(U.labelYM(ym))}: <b>${U.fmt(list.length)}</b></h3><div class="kd-grid">${breakdownTable('Channel', byCh, null, list.length, { head: 'Channel', drill: (key) => ({ ...spec, src: /GV Partner/i.test(key) ? 'gv' : 'ff', title: `${spec.title || 'Active agents'} · ${key}` }) })}${breakdownTable('Agents per TL', new Map([...byTl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)), null, list.length, { head: 'TL', drill: (tl) => ({ scope: 'mtd', src: spec.src || 'ff', ym, tl, title: `TL ${tl} · ${U.labelYM(ym)}` }) })}</div>
        <section class="kd-sec"><h4>All active agents (${list.length})</h4><div class="table-wrap kd-scroll tall"><table class="tbl compact kd-tbl"><thead><tr><th>#</th><th>Agent</th><th>TL</th><th>Channel</th><th class="num">Tags</th></tr></thead><tbody>${list.map((a, i) => `<tr class="clickable" data-kd-agent="${esc(a.name)}" data-kd-agent-channel="${a.channel === 'GV Partner' ? 'gv' : 'ff'}"><td class="dim">${i + 1}</td><td><b>${esc(a.name)}</b></td><td>${esc(a.tl)}</td><td>${esc(a.channel)}</td><td class="num"><b>${U.fmt(a.n)}</b></td></tr>`).join('')}<tr class="kd-total"><td colspan="4"><b>Grand Total (${list.length} agents)</b></td><td class="num"><b>${U.fmt(U.sum(list, (a) => a.n))}</b></td></tr></tbody></table></div></section>`);
    }
    if (spec.src === 'gv') {
      const rows = gvIssuanceRows();
      const gym = gvYm;
      const cur = rows.filter((r) => r.ym === gym);
      const per = new Map(); cur.forEach((r) => { const k = r.agentId || r.agentName; const x = per.get(k) || { name: r.agentName || r.agentId, id: r.agentId || '', tl: r.tlName || 'Direct', n: 0 }; x.n += Number(r.n) || 1; per.set(k, x); });
      const list = [...per.values()].sort((a, b) => b.n - a.n);
      gvCount = list.length;
      out.push(`<h3 class="kd-h">🟩 GV Partner · active agents ${esc(U.labelYM(gym))}: <b>${U.fmt(list.length)}</b></h3><section class="kd-sec"><div class="table-wrap kd-scroll tall"><table class="tbl compact kd-tbl"><thead><tr><th>#</th><th>Agent</th><th>TL</th><th class="num">Tags</th></tr></thead><tbody>${list.map((a, i) => `<tr class="clickable" data-kd-agent="${esc(a.name)}" data-kd-agent-id="${esc(a.id)}" data-kd-agent-channel="gv"><td class="dim">${i + 1}</td><td><b>${esc(a.name)}</b></td><td>${esc(a.tl)}</td><td class="num"><b>${U.fmt(a.n)}</b></td></tr>`).join('')}<tr class="kd-total"><td colspan="3"><b>Grand Total (${list.length} agents)</b></td><td class="num"><b>${U.fmt(U.sum(list, (a) => a.n))}</b></td></tr></tbody></table></div></section>`);
    }
    state.spec = { ...spec, scope: spec.scope, ym: spec.ym || (spec.src === 'gv' ? gvYm : ffYm) };
    const n = (ffCount || 0) + (gvCount || 0);
    return { kicker: 'KPI detail · Agents', title: spec.title || 'Active agents', sub: `<b>${U.fmt(n)}</b> active agents · ${esc(U.labelYM(spec.src === 'gv' ? gvYm : ffYm))} (kam se kam 1 tag issue kiya) · agent par click = uska detail`, body: out.join('') };
  }
  async function statusDetail(spec) {
    let status = FF.store.get('status'); try { status = status || await FF.store.need('status'); } catch { status = []; }
    const ym = spec.ym || dataYm('ff');
    const cur = (status || []).filter((s) => s.ym === ym), prev = (status || []).filter((s) => s.ym === U.prevMonthKey(ym));
    const m = tally(cur, (s) => s.status), pm = tally(prev, (s) => s.status);
    return { kicker: 'KPI detail · Tag status', title: spec.title || 'Tag status', sub: `${esc(U.labelYM(ym))} · <b>${U.fmt(total(cur))}</b> tags`, body: breakdownTable('Status-wise', m, pm, total(cur), { head: 'Status', prevLabel: U.labelYM(U.prevMonthKey(ym)) }) };
  }

  // ---- 👥 people lists (v3.31) — "GV Agents (REPORT) 60", "High Priority 12", "Inactive", "Direct agents" ----
  // Card ki ginti = list ki ginti. Har row par click → us agent ka issuance detail (same period).
  function reportPeople(src) {
    const out = [];
    if (src === 'ff' || src === 'both') {
      const list = (FF.pages.performance && FF.pages.performance.agents ? FF.pages.performance.agents() : []).filter((a) => !a.isMaster);
      list.forEach((a) => out.push({ ch: 'ff', name: a.name, id: a.agentId || a.id || '', tl: a.tlExcluded ? FF.config.directLabel(a, 'ff') : a.tlName, direct: !!a.tlExcluded, priority: a.priority || '', status: U.clean(a.agentStatus || ''), active: a.hasIssuance, cur: a.curTotal || 0, last: a.lastTotal || 0, stock: a.stockTotal || 0 }));
    }
    if (src === 'gv' || src === 'both') {
      const gvp = FF.pages.gvPerformance;
      const rows = (gvp && gvp.sourceRows && gvp.sourceRows()) || (FF.gv && FF.gv.get ? FF.gv.get('report') || [] : []);
      rows.forEach((r) => out.push({ ch: 'gv', name: r.agentName, id: r.agentId || '', tl: FF.config.isDirectAgent(r, 'gv') ? FF.config.directLabel(r, 'gv') : r.tlName, direct: !!FF.config.isDirectAgent(r, 'gv'), priority: r.priority || '', status: U.clean(r.agentStatus || ''), active: (Number(r.curTotal) || 0) > 0, cur: Number(r.curTotal) || 0, last: Number(r.lastTotal) || 0, stock: Number(r.stockTotal) || 0 }));
    }
    return out;
  }
  const num2 = (v) => (Number(v) || 0);
  async function peopleDetail(spec) {
    const src = spec.src === 'gv' || spec.src === 'ff' ? spec.src : 'both';
    if ((src === 'ff' || src === 'both') && FF.pages.performance && FF.pages.performance.ensureLoaded) { try { await FF.pages.performance.ensureLoaded(); } catch { /* */ } }
    if ((src === 'gv' || src === 'both') && FF.gv && FF.gv.need) { try { await FF.gv.need('report'); } catch { /* */ } }
    let list = reportPeople(src);
    const lvl = String(spec.level || '');
    if (lvl) list = list.filter((p) => new RegExp(`\\b${lvl}\\b`, 'i').test(p.priority));
    if (spec.state === 'inactive') list = list.filter((p) => /inactive/i.test(p.status));
    if (spec.state === 'direct') list = list.filter((p) => p.direct);
    if (spec.state === 'active') list = list.filter((p) => p.active);
    if (spec.tl) list = list.filter((p) => U.clean(p.tl).toUpperCase() === U.clean(spec.tl).toUpperCase());
    // v3.40 — TL ke "Agents" card ka count = sirf agents (TL ki APNI row bahar; asli sheets me wo usi ki
    // team me ek row bankar aati hai). `self=1` par wo row dikhi degi (drawer me TL ka apna stock bhi).
    const SELF0 = spec.tl && String(spec.self == null ? '0' : spec.self) === '0';
    let selfRow = null;
    if (SELF0) { const tn = U.clean(spec.tl).toUpperCase(); selfRow = list.find((p) => U.clean(p.name).toUpperCase() === tn) || null; list = list.filter((p) => U.clean(p.name).toUpperCase() !== tn); }
    if (spec.sort === 'stock') list.sort((a, b) => b.stock - a.stock || b.cur - a.cur);
    else list.sort((a, b) => b.cur - a.cur || b.stock - a.stock);
    const label = lvl ? `${lvl} priority` : spec.state === 'inactive' ? 'Inactive' : spec.state === 'direct' ? 'Direct (no TL)' : spec.tl ? `TL ${spec.tl} agents` : 'All agents (REPORT)';
    const byTl = tally(list.map((p) => ({ n: 1, tl: p.tl })), (r) => r.tl || '—');
    state.spec = spec; state.rows = null; state.raw = null;
    const stockSum = U.sum(list, (p) => p.stock), curSum = U.sum(list, (p) => p.cur), lastSum = U.sum(list, (p) => p.last);
    const plain = (v) => esc(String(v == null ? '' : v).replace(/^[^\w]+/u, '') || '—');
    // TL ki APNI row (agents ki list se bahar) — list ke neeche highlight karke dikhti hai, taaki
    // "TL ke paas vs agents ke paas" side-by-side padha ja sake aur number match kare.
    const selfRowHtml = selfRow ? `<tr class="kd-selfrow"><td class="dim">👤</td><td><b>${esc(selfRow.name)}</b><span class="kd-self-tag">TL · apna stock</span>${selfRow.id ? ` <small class="dim">${esc(selfRow.id)}</small>` : ''}</td><td>${selfRow.ch === 'gv' ? '🟩 GV' : '🟦 FF'}</td><td>${esc(selfRow.tl || '—')}</td><td>${plain(selfRow.priority)}</td><td class="dim">${plain(selfRow.status)}</td><td class="num">${U.fmt(selfRow.last)}</td><td class="num"><b>${U.fmt(selfRow.cur)}</b></td><td class="num"><b>${U.fmt(selfRow.stock)}</b></td></tr>` : '';
    const selfFoot = selfRow ? `<tr class="kd-total"><td colspan="8"><b>= TL TOTAL — agents ${U.fmt(stockSum)} + TL ka apna stock ${U.fmt(selfRow.stock)}</b></td><td class="num"><b>${U.fmt(stockSum + num2(selfRow.stock))}</b></td></tr>` : '';

    const big = spec.sort === 'stock' ? `${U.fmt(stockSum)} <small>tags stock · ${U.fmt(list.length)} agents</small>` : `${U.fmt(list.length)} <small>agents</small>`;
    const body = `<div class="kd-hero"><div><span class="kd-kicker">${src === 'gv' ? '🟩 GV REPORT' : src === 'ff' ? '🟦 FF REPORT' : 'REPORT (FF + GV)'}</span><div class="kd-big">${big}</div><div class="kd-sub">${esc(label)} · current ${U.fmt(curSum)} · stock ${U.fmt(stockSum)}</div></div></div>
      ${breakdownTable('👥 TL-wise', new Map([...byTl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)), null, list.length, { head: 'TL', drill: (tl) => ({ ...spec, tl, title: `TL ${tl} · ${label}` }) })}
      <section class="kd-sec"><h4>🧑‍💼 ${esc(label)} · ${U.fmt(list.length)}</h4><div class="table-wrap kd-scroll tall"><table class="tbl compact kd-tbl"><thead><tr><th>#</th><th>Agent</th><th>Ch</th><th>TL</th><th>Priority</th><th>Status</th><th class="num">Last month</th><th class="num">This month</th><th class="num">Stock</th></tr></thead><tbody>${list.map((p, i) => `<tr class="clickable" data-kd-agent="${esc(p.name)}" data-kd-agent-id="${esc(p.id)}" data-kd-agent-channel="${p.ch}"><td class="dim">${i + 1}</td><td><b>${esc(p.name)}</b>${p.id ? ` <small class="dim">${esc(p.id)}</small>` : ''}</td><td>${p.ch === 'gv' ? '🟩 GV' : '🟦 FF'}</td><td>${esc(p.tl || '—')}</td><td>${esc(String(p.priority).replace(/^[^\w]+/u, '') || '—')}</td><td class="dim">${esc(String(p.status).replace(/^[^\w]+/u, '') || '—')}</td><td class="num">${U.fmt(p.last)}</td><td class="num"><b>${U.fmt(p.cur)}</b></td><td class="num">${U.fmt(p.stock)}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">Koi agent nahi</td></tr>'}${list.length ? `<tr class="kd-total"><td colspan="6"><b>Agents total (${list.length} agents)</b></td><td class="num"><b>${U.fmt(lastSum)}</b></td><td class="num"><b>${U.fmt(curSum)}</b></td><td class="num"><b>${U.fmt(stockSum)}</b></td></tr>${selfRowHtml}${selfFoot}` : selfRowHtml}</tbody></table></div></section>`;
    return { kicker: 'KPI detail · Agents list', title: spec.title || label, sub: spec.sort === 'stock' ? `<b>${U.fmt(stockSum)}</b> tags stock · ${U.fmt(list.length)} agents` : `<b>${U.fmt(list.length)}</b> agents · ${esc(label)}`, body };
  }
  // ---- 📋 page-registered lists — kisi bhi page ka number usi page ki exact rows kholta hai -----------
  const LISTS = new Map();
  /** FF.kpiDetail.registerList(name, (spec) => ({ title, sub, unit, columns: [[label, (row) => html, num?]], rows, agent: (row) => ({ name, id, ch }) })) */
  function registerList(name, fn) { if (name && typeof fn === 'function') LISTS.set(String(name), fn); }
  async function listDetail(spec) {
    const fn = LISTS.get(String(spec.list || ''));
    if (!fn) return peopleDetail(spec);
    const out = (await fn(spec)) || {};
    const rows = out.rows || [], cols = out.columns || [];
    state.spec = spec; state.rows = null; state.raw = null;
    const agentOf = out.agent || (() => null);
    const tlOf = out.tl || (() => null);
    const head = out.headline ? `${U.fmt(out.headline.value)} <small>${esc(out.headline.unit || '')} · ${U.fmt(rows.length)} ${esc(out.unit || 'rows')}</small>` : `${U.fmt(rows.length)} <small>${esc(out.unit || 'rows')}</small>`;
    const body = `<div class="kd-hero"><div><span class="kd-kicker">${esc(out.kicker || 'List')}</span><div class="kd-big">${head}</div><div class="kd-sub">${out.sub || ''}</div></div></div>
      ${out.top || ''}<section class="kd-sec"><div class="table-wrap kd-scroll tall"><table class="tbl compact kd-tbl"><thead><tr><th>#</th>${cols.map((c) => `<th class="${c[2] ? 'num' : ''}">${esc(c[0])}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) => { const a = agentOf(r), t = a ? null : tlOf(r); return `<tr${a ? ` class="clickable" data-kd-agent="${esc(a.name)}" data-kd-agent-id="${esc(a.id || '')}" data-kd-agent-channel="${esc(a.ch || '')}"` : t ? ` class="clickable" data-kd-tl="${esc(t.name)}" data-kd-tl-channel="${esc(t.ch || '')}"` : ''}><td class="dim">${i + 1}</td>${cols.map((c) => `<td class="${c[2] ? 'num' : ''}">${c[1](r)}</td>`).join('')}</tr>`; }).join('') || `<tr><td colspan="${cols.length + 1}" class="empty">Koi row nahi</td></tr>`}</tbody></table></div></section>${out.note ? `<p class="dim small">${out.note}</p>` : ''}`;
    return { kicker: `KPI detail · ${out.kicker || 'List'}`, title: spec.title || out.title || 'List', sub: out.headline ? `<b>${U.fmt(out.headline.value)}</b> ${esc(out.headline.unit || '')} · ${U.fmt(rows.length)} ${esc(out.unit || 'rows')}` : `<b>${U.fmt(rows.length)}</b> ${esc(out.unit || 'rows')}${out.subShort ? ` · ${out.subShort}` : ''}`, body };
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

  /** 🧓 Drawer ka stock-ageing scope — jo number khola usi agent / TL / channel ka. */
  function ageScopeOf(spec) {
    const ch = spec.channel === 'gv' || spec.src === 'gv' ? 'gv' : spec.channel === 'ff' || spec.src === 'ff' ? 'ff' : '';
    if (spec.agent) return { kind: 'agent', key: spec.agentId || spec.agent, keys: [spec.agent].filter(Boolean), ch, title: spec.agent };
    if (spec.tl || spec.tlName) return { kind: 'tl', key: spec.tl || spec.tlName, ch, title: spec.tl || spec.tlName };
    return { kind: 'all', key: 'all', ch, open: spec.scope === 'stock' || spec.scope === 'stockreport' };
  }

  // ---- open ------------------------------------------------------------------------------------
  async function open(cardOrSpec, opts = {}) {
    const spec = cardOrSpec && cardOrSpec.nodeType ? specFrom(cardOrSpec) : { ...(cardOrSpec || {}) };
    const drawerOpen = !!(U.$('#drawer') && U.$('#drawer').classList.contains('open'));
    const parentSnap = drawerOpen && !state.spec && FF.app && FF.app.currentDrawerSnapshot ? FF.app.currentDrawerSnapshot() : null;
    const nested = opts.nested !== undefined ? opts.nested : (drawerOpen && (!!state.spec || !!parentSnap));
    if (nested && !opts.fromHistory) {
      if (state.spec) state.history.push({ ...state.spec });
      else if (parentSnap) state.history.push({ __restoreSnapshot: parentSnap });
    } else if (!nested && !opts.fromHistory) {
      state.history = [];
    }
    if (!spec.src) spec.src = PAGE_SRC[currentPage()] || 'both';
    if (!spec.scope) spec.scope = 'mtd';
    if (spec.ym) spec.ym = normYm(spec.ym) || spec.ym;
    FF.app.openDrawer({ kicker: 'KPI detail', title: spec.title || 'KPI detail', sub: 'Breakdown taiyaar ho raha hai…', body: U.spinner('Detail calculate ho rahi hai…'), wide: true, loading: true });
    if (FF.notifications && FF.notifications.track) FF.notifications.track('kpi', `KPI opened: ${spec.title || spec.scope}`);
    try {
      const view = spec.tagId ? await tagDetail(spec)
        : spec.agent && spec.scope === 'stock' && (spec.channel === 'gv' || spec.src === 'gv') ? await agentStockDetail(spec)
          : spec.scope === 'stock' ? await stockDetail(spec)
          : spec.agent ? await agentDetail(spec)
          : spec.scope === 'stockreport' ? await stockReportDetail(spec)
            : spec.scope === 'list' ? await listDetail(spec)
            : spec.scope === 'people' ? await peopleDetail(spec)
            : spec.scope === 'agents' ? await agentsDetail(spec)
              : spec.scope === 'status' ? await statusDetail(spec)
                : await issuanceDetail(spec);
      const cardInfo = (spec.cardValue || spec.foot) ? `<div class="kd-card-foot">📌 <b>${esc(spec.title || 'Card')}</b>${spec.cardValue ? ` = <b class="kd-card-val">${esc(spec.cardValue)}</b>` : ''}${spec.foot ? ` · <span class="dim">${esc(spec.foot.replace(/\s+/g, ' ').trim())}</span>` : ''}</div>` : '';
      // 🧓 v3.31 — har KPI drawer me stock ageing (app.js openDrawer lagata hai): agent → us agent ka,
      // TL → us TL ka, baaki → us channel ka poora network (VC4+VC20 / VC5+, 1/3/5/6+ mahine, ⬇ CSV).
      const back = state.history.length ? '<button class="btn small" data-kd-back>← Back</button>' : '';
      const exportBtn = FF.auth.can('export')
        ? `${view.exportable ? '<button class="btn small" data-kd-summary-xlsx>⬇ Breakdown Excel</button>' : ''}<button class="btn small" data-drawer-csv>⬇ CSV</button><button class="btn small" data-drawer-pdf>📄 PDF</button>`
        : '';
      FF.app.openDrawer({ kicker: view.kicker, title: view.title, sub: view.sub, body: cardInfo + view.body, wide: true, actions: back + exportBtn, age: ageScopeOf(spec), replace: true });
    } catch (err) {
      const back = state.history.length ? '<button class="btn small" data-kd-back>← Back</button>' : '';
      FF.app.openDrawer({ kicker: 'KPI detail', title: spec.title || 'KPI detail', body: U.errorBox(err), wide: true, actions: back, replace: true });
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
  function resetHistory() {
    state.history = [];
    state.spec = null;
  }

  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-kd-retry]')) {
      if (state.spec) open({ ...state.spec }, { nested: state.history.length > 0, fromHistory: true });
      return;
    }
    const back = e.target.closest('[data-kd-back]');
    if (back) {
      const previous = state.history.pop();
      if (previous && previous.__restoreSnapshot && FF.app && FF.app.restoreDrawerSnapshot) {
        state.spec = null;
        FF.app.restoreDrawerSnapshot(previous.__restoreSnapshot);
      } else if (previous) {
        open(previous, { nested: state.history.length > 0, fromHistory: true });
      }
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
      // v3.31: jis period ka number tha (din / mahina / range / last month) usi period ka agent detail —
      // pehle month / range se click par 'mtd' (is mahine) ho jaata tha.
      const keep = ['day', 'month', 'range', 'mtd'].includes(base.scope) ? base.scope : 'mtd';
      const ch = agentRow.dataset.kdAgentChannel || '';
      open({ ...base, agent: name, agentId: agentRow.dataset.kdAgentId || '', channel: ch, src: ch === 'gv' ? 'gv' : ch === 'ff' ? 'ff' : (base.src || 'both'), scope: keep, date: keep === 'day' ? base.date : '', list: '', level: '', state: '', holders: '', cardValue: '', foot: '', title: `${name} · ${ch === 'gv' ? 'GV' : 'FF'} agent` });
      return;
    }
    // 👥 TL row → us TL ka issuance detail (usi period ka)
    const tlRow = e.target.closest('[data-kd-tl]');
    if (tlRow) {
      const base = state.spec || {};
      const ch = tlRow.dataset.kdTlChannel || '';
      const keep = ['day', 'month', 'range', 'mtd'].includes(base.scope) ? base.scope : 'mtd';
      open({ ...base, tl: tlRow.dataset.kdTl, agent: '', agentId: '', src: ch === 'gv' ? 'gv' : ch === 'ff' ? 'ff' : (base.src || 'both'), scope: keep, list: '', level: '', state: '', holders: '', cardValue: '', foot: '', title: `TL ${tlRow.dataset.kdTl}` });
      return;
    }
    const agentDay = e.target.closest('[data-kd-agent-day]');
    if (agentDay && state.spec && state.spec.agent) { open({ ...state.spec, scope: 'day', date: agentDay.dataset.kdAgentDay, title: `${state.spec.agent} · ${U.labelDateKey(agentDay.dataset.kdAgentDay)}` }); return; }
    // Quick spec chips (channel / class / type) — drawer ke andar se filter badlo, naya drawer khulta hai.
    const chip = e.target.closest('[data-kd-spec]');
    if (chip && state.spec) { open({ ...state.spec, ...JSON.parse(chip.dataset.kdSpec || '{}') }); return; }
  });

  FF.kpiDetail = { open, specFrom, registerList, normYm, resetHistory, _infer: inferSpec, _rowMatchesSpec: rowMatchesSpec, _stockDetail: stockDetail, _peopleDetail: peopleDetail, _issuanceDetail: issuanceDetail, _agentDetail: agentDetail, _limits: SOFT };
})(window.FF);
