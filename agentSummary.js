/* 📋 AGENT / TL SUMMARY (v3.33) — First Forward + GV Partner
 * Dedicated page per channel: search ANY Agent or TL by Name, Agent Name, TL Name, Agent ID, TL ID,
 * or Mobile Number, with instant top-of-screen suggested names, visual Class-wise Issuance & Stock charts,
 * Stock Ageing, clickable KPI cards & rows (opening exact data with CSV/PDF), and full Grand Totals
 * across UI tables, PDF, Copy, WhatsApp Share, and CSV.
 */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc, clean = U.clean, fmt = U.fmt;
  const norm = (s) => clean(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const digits = (s) => String(s || '').replace(/\D/g, '');
  const mob10 = (s) => { const d = digits(s); return d.length >= 10 ? d.slice(-10) : d; };
  const MP = () => FF.masterProfile;

  async function loadPeople(channel) {
    const isGv = channel === 'gv';
    if (MP() && MP().load) await MP().load().catch(() => {});
    if (isGv && FF.gv) await Promise.all([FF.gv.need('report'), FF.gv.need('stockAgent'), FF.gv.need('stockTl'), FF.gv.need('master')].map((p) => p && p.catch ? p.catch(() => {}) : p));
    else await Promise.all([
      FF.pages.performance && FF.pages.performance.ensureLoaded ? FF.pages.performance.ensureLoaded() : null,
      FF.store.need('agents'), FF.store.need('stockAgents'), FF.store.need('daily'), FF.store.need('agentClass')
    ].map((p) => p && p.catch ? p.catch(() => {}) : p));

    const map = new Map();
    const add = (kind, name, id, tl, mobile, cur, stock, extra = {}) => {
      const nm = clean(name);
      if (!nm || /^(—|na|unknown|unassigned|direct)$/i.test(nm)) return;
      if (kind.endsWith('tl') && FF.config.isRealTl && !FF.config.isRealTl(nm)) return;
      const k = `${kind}|${norm(nm)}`;
      const curMob = clean(mobile) || (MP() && MP().mobileFor ? MP().mobileFor(nm, id, '') : '');
      const e = map.get(k) || {
        kind, name: nm, id: clean(id), altIds: new Set(), tl: clean(tl), tlId: clean(extra.tlId),
        mobile: curMob, tlMobile: clean(extra.tlMobile), cur: 0, stock: 0, last: 0
      };
      if (!e.id && id) e.id = clean(id);
      if (id) e.altIds.add(clean(id));
      if (extra.altId) e.altIds.add(clean(extra.altId));
      if (!e.tl && tl) e.tl = clean(tl);
      if (!e.tlId && extra.tlId) e.tlId = clean(extra.tlId);
      if (!e.mobile && curMob) e.mobile = curMob;
      if (!e.tlMobile && extra.tlMobile) e.tlMobile = clean(extra.tlMobile);
      e.cur = Math.max(e.cur, Number(cur) || 0);
      e.stock = Math.max(e.stock, Number(stock) || 0);
      e.last = Math.max(e.last, Number(extra.last) || 0);
      map.set(k, e);
    };

    if (isGv) {
      const gvP = FF.pages && FF.pages.gvPerformance;
      const rep = (gvP && gvP.sourceRows && gvP.sourceRows()) || (gvP && gvP.rows && gvP.rows()) || (FF.gv && FF.gv.get('report')) || [];
      const tlSum = new Map();
      for (const r of rep) {
        add('gv-agent', r.agentName, r.agentId, r.tlName, r.mobile, r.curTotal, r.stockTotal, { tlId: r.tlId, tlMobile: r.tlMobile, last: r.lastTotal, altId: r.supervisorId });
        if (clean(r.tlName) && (!FF.config.isDirectAgent || !FF.config.isDirectAgent(r, 'gv'))) {
          const tk = norm(r.tlName);
          const t = tlSum.get(tk) || { name: r.tlName, id: r.tlId, mobile: r.tlMobile || '', cur: 0, stock: 0, last: 0 };
          t.cur += Number(r.curTotal) || 0;
          t.stock = Math.max(t.stock, Number(r.tlStockTotal) || 0) || (t.stock + (Number(r.stockTotal) || 0));
          t.last += Number(r.lastTotal) || 0;
          if (!t.id && r.tlId) t.id = r.tlId;
          if (!t.mobile && r.tlMobile) t.mobile = r.tlMobile;
          tlSum.set(tk, t);
        }
      }
      for (const t of tlSum.values()) add('gv-tl', t.name, t.id, '', t.mobile, t.cur, t.stock, { tlId: t.id, last: t.last });
      for (const s of (FF.gv && FF.gv.get('stockAgent')) || []) {
        add('gv-agent', s.agentName, s.agentId, s.tlName, '', 0, s.n, { tlId: s.tlId });
      }
      for (const m of (FF.gv && FF.gv.get('master')) || []) {
        add('gv-agent', m.agentName, m.agentId, m.tlName, '', 0, 0, { tlId: m.tlId, altId: m.gvUniqueId });
        if (clean(m.tlName)) add('gv-tl', m.tlName, m.tlId, '', '', 0, 0, { tlId: m.tlId });
      }
    } else {
      const ags = (FF.pages.performance && FF.pages.performance.agents && FF.pages.performance.agents()) || [];
      const tlSum = new Map();
      for (const a of ags) {
        add('ff-agent', a.name, a.agentId || a.id, a.tlName, a.mobile, a.curTotal, a.stockTotal, {
          tlId: a.tlId, tlMobile: a.tlMobile, last: a.lastTotal, altId: a.id
        });
        if (clean(a.tlName) && !a.tlExcluded) {
          const tk = norm(a.tlName);
          const t = tlSum.get(tk) || { name: a.tlName, id: a.tlId, mobile: a.tlMobile, cur: 0, stock: Number(a.tlStockTotal) || 0, last: 0 };
          t.cur += Number(a.curTotal) || 0;
          t.last += Number(a.lastTotal) || 0;
          if (!t.stock) t.stock += Number(a.stockTotal) || 0;
          if (!t.id && a.tlId) t.id = a.tlId;
          if (!t.mobile && a.tlMobile) t.mobile = a.tlMobile;
          tlSum.set(tk, t);
        }
      }
      for (const t of tlSum.values()) add('ff-tl', t.name, t.id, '', t.mobile, t.cur, t.stock, { tlId: t.id, last: t.last });
      for (const a of FF.store.get('agents') || []) {
        if (!a.channel || /first/i.test(a.channel)) {
          add('ff-agent', a.name, a.id, a.tlName, '', a.n, 0, { tlId: a.tlId });
          if (clean(a.tlName)) add('ff-tl', a.tlName, a.tlId, '', '', 0, 0, { tlId: a.tlId });
        }
      }
      for (const s of FF.store.get('stockAgents') || []) {
        add('ff-agent', s.agentName, s.agentId, s.tlName, '', 0, s.n);
      }
    }
    return [...map.values()].map((p) => ({ ...p, altIds: [...(p.altIds || [])] })).sort((a, b) => (b.cur + b.stock) - (a.cur + a.stock));
  }

  // ---- v3.34 speed: caches (stale-while-revalidate) ------------------------------------------------
  // Pehle har page-open par loadPeople() poori master + performance + stock data series ko dobara
  // await karta tha → page lag karta tha. Ab list 3 min tak cache hoti hai; TTL ke baad purani list
  // turant dikhti hai aur naya data background me aa jata hai (agle open par).
  const peopleCache = { ff: null, gv: null }; // channel → { at, list }
  const PEOPLE_TTL = 3 * 60 * 1000;
  function loadPeopleCached(channel) {
    const slot = peopleCache[channel];
    if (slot && slot.list && Date.now() - slot.at < PEOPLE_TTL) return slot.list;
    const p = loadPeople(channel).then((list) => { peopleCache[channel] = { at: Date.now(), list }; return list; });
    if (slot && slot.list) { p.catch(() => {}); return slot.list; } // stale abhi, refresh background me
    return p;
  }

  // Report bhi 2 min cache — aage-peeche agent switch karne par summary turant khulti hai.
  const reportCache = new Map(); // `${kind}|${name}|${id}` → { at, report }
  const REPORT_TTL = 2 * 60 * 1000;
  function buildReportCached(person, opts) {
    const key = `${person.kind}|${norm(person.name)}|${person.id || ''}`;
    const hit = reportCache.get(key);
    if (hit && Date.now() - hit.at < REPORT_TTL && !(opts && opts.fresh)) return hit.report;
    return buildReport(person).then((rep) => {
      reportCache.set(key, { at: Date.now(), report: rep });
      while (reportCache.size > 24) reportCache.delete(reportCache.keys().next().value);
      return rep;
    });
  }
  function clearCaches() { peopleCache.ff = null; peopleCache.gv = null; reportCache.clear(); }

  function matchPeople(list, q) {
    const raw = clean(q);
    if (!raw) return list.slice(0, 30);
    const s = norm(raw);
    const dq = digits(raw);
    const wantMob = dq.length >= 4 ? mob10(raw) : '';
    const scored = [];
    for (const p of list) {
      const pName = norm(p.name);
      const pId = norm(p.id);
      const pTl = norm(p.tl);
      const pTlId = norm(p.tlId);
      const pMob = mob10(p.mobile);
      const pTlMob = mob10(p.tlMobile);
      const altIds = (p.altIds || []).map(norm);

      let score = 0;
      if (pName === s || pId === s || (pTlId && pTlId === s && p.kind.endsWith('tl'))) score = 1000;
      else if (wantMob && wantMob.length === 10 && (pMob === wantMob || (p.kind.endsWith('tl') && pTlMob === wantMob))) score = 950;
      else if (altIds.includes(s)) score = 920;
      else if (pName.startsWith(s) || (pId && pId.startsWith(s))) score = 800;
      else if (wantMob && ((pMob && pMob.includes(wantMob)) || (pTlMob && pTlMob.includes(wantMob)) || (digits(p.id).includes(dq)))) score = 700;
      else if (pName.includes(s) || (pId && pId.includes(s)) || altIds.some((x) => x.includes(s))) score = 600;
      else if ((pTl && pTl.includes(s)) || (pTlId && pTlId.includes(s))) score = p.kind.endsWith('tl') ? 750 : 450;

      if (score > 0) scored.push({ p, score: score + Math.min(99, (p.cur + p.stock) / 100) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 35).map((x) => x.p);
  }

  /** Top suggested TLs & Agents shown immediately at the top of the screen. */
  function topSuggestions(list, q) {
    if (clean(q)) return matchPeople(list, q).slice(0, 12);
    const tls = list.filter((p) => p.kind.endsWith('tl')).slice(0, 5);
    const ags = list.filter((p) => !p.kind.endsWith('tl')).slice(0, 7);
    return [...tls, ...ags];
  }

  async function buildReport(person) {
    const raw = await MP().build({
      kind: person.kind, name: person.name, sub: person.id || '',
      tlSet: new Set(person.tl ? [person.tl] : []), classMap: new Map(), bars: new Set()
    });
    const ch = /^gv/.test(person.kind) ? 'gv' : 'ff';
    const isTl = /tl$/.test(person.kind);
    const t = raw.totals || {}, s = raw.stock || {}, m = raw.months || {};
    const p = {
      ...raw, kind: isTl ? 'tl' : 'agent', rawKind: person.kind, channel: raw.channel || (ch === 'gv' ? 'GV Partner' : 'First Forward'),
      tlName: (raw.tl && raw.tl.name) || person.tl || '',
      tlId: (raw.tl && raw.tl.id) || person.tlId || '',
      tlMobile: (raw.tl && raw.tl.mobile) || person.tlMobile || '',
      curYm: m.cur || '', lastYm: m.last || '',
      expected: (raw.projT1 && raw.projT1.total) || 0,
      runRate: (raw.calc && raw.calc.total && raw.calc.total.rate) || 0,
      totals: {
        ...t,
        curVc4: t.curVc4 || 0, curComm: t.curComm || 0, curTotal: t.curTotal || 0,
        lastVc4: t.lastVc4 || 0, lastComm: t.lastComm || 0, lastTotal: t.lastTotal || 0,
        stockVc4: s.vc4 || 0, stockComm: s.comm || 0, stockTotal: s.total || 0,
        growth: raw.growthNum != null ? raw.growthNum : U.growth(t.curTotal || 0, t.lastTotal || 0)
      },
      classTable: (raw.classes || []).map((c) => ({ ...c, growth: c.last ? ((c.cur - c.last) / c.last) * 100 : null })),
      agents: (raw.agents || []).map((a) => ({
        ...a,
        curTotal: a.cur || 0, lastTotal: a.last || 0,
        curVc4: a.curVc4 || 0, curComm: a.curComm || 0,
        stockTotal: a.stockTotal || ((a.stockVc4 || 0) + (a.stockComm || 0)),
        growth: U.growth(a.cur || 0, a.last || 0)
      }))
    };
    let age = null;
    if (FF.stockAge && FF.stockAge.compute) {
      const scope = isTl
        ? { kind: 'tl', key: person.name, ch, title: person.name }
        : { kind: 'agent', key: person.id || person.name, keys: [person.name, person.id].filter(Boolean), ch, title: person.name };
      const res = await FF.stockAge.compute(scope).catch(() => null);
      age = res && (res[ch] || res.ff || res.gv) || null;
    }
    return { person, p, age, ch, isTl };
  }

  function reportText(r) {
    const p = r.p, t = p.totals || {}, age = r.age;
    const chLabel = r.ch === 'gv' ? 'GV Partner' : 'First Forward';
    const lines = [
      `*📋 ${p.name}* (${chLabel} · ${r.isTl ? 'Team Leader' : 'Agent'}${p.id ? ` · ID: ${p.id}` : ''})`,
      `${p.mobile ? `📞 Mobile: ${p.mobile}` : ''}${!r.isTl && p.tlName ? ` · 👥 TL: ${p.tlName}${p.tlId ? ` (${p.tlId})` : ''}` : ''}`.replace(/^ · /, ''),
      `Priority: ${p.priority || '—'}${p.status ? ` · Status: ${p.status}` : ''}`,
      '',
      `*📊 KPI Summary:*`,
      `• Current Month (${p.curYm || 'MTD'}): *${fmt(t.curTotal)}* (VC4: ${fmt(t.curVc4)} · Comm: ${fmt(t.curComm)})`,
      `• Last Month (${p.lastYm || 'Prev'}): *${fmt(t.lastTotal)}* (VC4: ${fmt(t.lastVc4)} · Comm: ${fmt(t.lastComm)})`,
      `• Growth: *${t.growth == null ? '—' : `${t.growth >= 0 ? '+' : ''}${t.growth.toFixed(1)}%`}* · Expected Month-End: *${fmt(p.expected)}* (Run-rate: ${fmt(p.runRate, true)}/day)`,
      `• Stock in Hand: *${fmt(t.stockTotal)}* (VC4: ${fmt(t.stockVc4)} · Comm: ${fmt(t.stockComm)})`
    ].filter((x, i) => i !== 1 || Boolean(x));

    if ((p.classTable || []).length) {
      lines.push('', `*🚗 Class-wise Issuance & Stock (${p.lastYm || 'Last'} → ${p.curYm || 'MTD'}):*`);
      p.classTable.forEach((c) => {
        lines.push(`• ${c.cls}: Last ${fmt(c.last)} → MTD *${fmt(c.cur)}* | Stock: *${fmt(c.stock)}*`);
      });
      lines.push(`*∑ Class Grand Total: Last ${fmt(t.lastTotal)} → MTD ${fmt(t.curTotal)} | Stock ${fmt(t.stockTotal)}*`);
    }

    if (age && age.total) {
      lines.push('', `*⏳ Stock Ageing (Total ${fmt(age.total)} tags):*`);
      lines.push(`• Buckets: ${age.buckets.filter((b) => b.n > 0).map((b) => `${b.label}: ${fmt(b.n)}`).join(' · ')}`);
      if ((age.byClass || []).length) {
        age.byClass.forEach((c) => lines.push(`  - ${c.cls}: Total ${fmt(c.total)} (30+d: ${fmt(c.old30)} · 60+d: ${fmt(c.old60)})`));
      }
      lines.push(`*∑ Ageing Grand Total: ${fmt(age.total)} tags (0–30d: ${fmt(age.total - age.old30)} · 30+d Old: ${fmt(age.old30)} · 60+d Critical: ${fmt(age.old60)})*`);
    }

    if (r.isTl && (p.agents || []).length) {
      const sumLast = U.sum(p.agents, (a) => a.lastTotal);
      const sumCur = U.sum(p.agents, (a) => a.curTotal);
      const sumVc4 = U.sum(p.agents, (a) => a.curVc4);
      const sumComm = U.sum(p.agents, (a) => a.curComm);
      const sumStock = U.sum(p.agents, (a) => a.stockTotal);
      lines.push('', `*🧑‍💼 Team Agents (${fmt(p.agents.length)}):*`);
      p.agents.slice(0, 30).forEach((a) => {
        lines.push(`• ${a.name}${a.id ? ` (${a.id})` : ''}: Last ${fmt(a.lastTotal)} · MTD *${fmt(a.curTotal)}* · Stock ${fmt(a.stockTotal)}`);
      });
      lines.push(`*∑ Team Grand Total (${fmt(p.agents.length)} Agents): Last ${fmt(sumLast)} · MTD ${fmt(sumCur)} (VC4 ${fmt(sumVc4)} · Comm ${fmt(sumComm)}) · Stock ${fmt(sumStock)}*`);
    }

    lines.push('', `*🏁 GRAND TOTAL SUMMARY: Last ${fmt(t.lastTotal)} | MTD ${fmt(t.curTotal)} | Expected ${fmt(p.expected)} | Stock ${fmt(t.stockTotal)}${age ? ` | 30+d Old ${fmt(age.old30)}` : ''}*`);
    return lines.join('\n');
  }

  function reportCsv(r) {
    const p = r.p, t = p.totals || {}, age = r.age;
    const rows = MP().csvRows(p).map((row) => [...row]);
    if (age && age.total) {
      rows.push([]);
      rows.push(['Stock Ageing Class', ...age.buckets.map((b) => b.label), '30+d Old', '60+d Critical', 'Total Stock']);
      for (const c of age.byClass || []) {
        rows.push([c.cls, ...age.buckets.map((b) => c[b.key] || 0), c.old30, c.old60, c.total]);
      }
      rows.push(['STOCK AGEING GRAND TOTAL', ...age.buckets.map((b) => b.n || 0), age.old30, age.old60, age.total]);
    }
    rows.push([]);
    rows.push(['FINAL GRAND TOTAL SUMMARY', `Last Month: ${t.lastTotal}`, `Current MTD: ${t.curTotal}`, `Expected: ${p.expected}`, `Stock Total: ${t.stockTotal}`, age ? `30+d Old: ${age.old30}` : '']);
    return rows;
  }

  /** v3.34 — multi-sheet Excel workbook: Summary / Class-wise / Stock Ageing / Team Agents. */
  function reportXlsx(r) {
    const p = r.p, t = p.totals || {}, age = r.age;
    const chLabel = r.ch === 'gv' ? 'GV Partner' : 'First Forward';
    const sheets = [];
    sheets.push({
      name: 'Summary',
      header: ['Field', 'Value'],
      rows: [
        ['Report', `${chLabel} · ${r.isTl ? 'Team Leader' : 'Agent'} Summary`],
        ['Name', p.name], ['ID', p.id || ''], ['Mobile', p.mobile || ''],
        ...(r.isTl ? [] : [['TL', p.tlName || ''], ['TL ID', p.tlId || '']]),
        ['Priority', p.priority || ''],
        ['Current Month', p.curYm || ''],
        [`Issuance ${p.curYm || '(MTD)'}`, t.curTotal],
        ['VC4 (MTD)', t.curVc4], ['Comm (MTD)', t.curComm],
        ['Last Month', p.lastYm || ''],
        [`Issuance ${p.lastYm || '(Last)'}`, t.lastTotal],
        ['VC4 (Last)', t.lastVc4], ['Comm (Last)', t.lastComm],
        ['Growth %', t.growth == null ? '' : Number(t.growth.toFixed(1))],
        ['Expected Month-End', p.expected], ['Run-rate / day', p.runRate],
        ['Stock in Hand', t.stockTotal], ['VC4 Stock', t.stockVc4], ['Comm Stock', t.stockComm],
        ['30+d Old Stock', age ? age.old30 : ''],
        ['60+d Critical Stock', age ? age.old60 : ''],
        ['Generated', new Date().toLocaleString('en-IN')]
      ]
    });
    sheets.push({
      name: 'Class-wise',
      header: ['Class', p.lastYm || 'Last Month', p.curYm || 'Current (MTD)', 'Growth %', 'Stock in Hand'],
      rows: (p.classTable || []).map((c) => [c.cls, c.last, c.cur, c.growth == null ? '' : Number(c.growth.toFixed(1)), c.stock])
        .concat([['GRAND TOTAL', t.lastTotal, t.curTotal, t.growth == null ? '' : Number(t.growth.toFixed(1)), t.stockTotal]])
    });
    if (age && age.total) {
      sheets.push({
        name: 'Stock Ageing',
        header: ['Class', ...age.buckets.map((b) => b.label), '30+d Old', '60+d Critical', 'Total Stock'],
        rows: (age.byClass || []).map((c) => [c.cls, ...age.buckets.map((b) => c[b.key] || 0), c.old30, c.old60, c.total])
          .concat([['STOCK AGEING GRAND TOTAL', ...age.buckets.map((b) => b.n || 0), age.old30, age.old60, age.total]])
      });
    }
    if (r.isTl && (p.agents || []).length) {
      sheets.push({
        name: 'Team Agents',
        header: ['Agent Name', 'ID', p.lastYm || 'Last Month', p.curYm || 'Current (MTD)', 'VC4', 'Comm', 'Growth %', 'Stock'],
        rows: p.agents.map((a) => [a.name, a.id || '', a.lastTotal, a.curTotal, a.curVc4, a.curComm, a.growth == null ? '' : Number(a.growth.toFixed(1)), a.stockTotal])
          .concat([['GRAND TOTAL', `${p.agents.length} Agents`, U.sum(p.agents, (a) => a.lastTotal), U.sum(p.agents, (a) => a.curTotal), U.sum(p.agents, (a) => a.curVc4), U.sum(p.agents, (a) => a.curComm), '', U.sum(p.agents, (a) => a.stockTotal)]])
      });
    }
    return sheets;
  }

  /** v3.34 — structured JSON backup (API / automation ke liye). */
  function reportJson(r) {
    const p = r.p, t = p.totals || {};
    return JSON.stringify({
      generatedAt: new Date().toISOString(),
      channel: r.ch === 'gv' ? 'gv' : 'ff',
      person: { kind: r.isTl ? 'tl' : 'agent', name: p.name, id: p.id || '', mobile: p.mobile || '', tlName: p.tlName || '', tlId: p.tlId || '' },
      months: { current: p.curYm || '', last: p.lastYm || '' },
      totals: t,
      expectedMonthEnd: p.expected, runRatePerDay: p.runRate,
      classWise: (p.classTable || []).map((c) => ({ cls: c.cls, last: c.last, current: c.cur, growthPct: c.growth, stock: c.stock })),
      stockAgeing: r.age ? { total: r.age.total, old30: r.age.old30, old60: r.age.old60, buckets: r.age.buckets, byClass: r.age.byClass } : null,
      teamAgents: r.isTl ? (p.agents || []) : undefined,
      grandTotalText: reportText(r)
    }, null, 2);
  }

  function makePdf(r) {
    const p = r.p, age = r.age, t = p.totals || {};
    const chLabel = r.ch === 'gv' ? 'GV Partner' : 'First Forward';
    const doc = FF.pdf.doc({
      title: `${chLabel} · ${r.isTl ? 'Team Leader' : 'Agent'} Summary`,
      subtitle: `${p.name}${p.id ? ` (ID: ${p.id})` : ''}${p.tlName && !r.isTl ? ` · TL: ${p.tlName}` : ''}${p.mobile ? ` · ${p.mobile}` : ''}`,
      right: `${new Date().toLocaleDateString('en-IN')} · ${p.curYm || ''}`
    });
    doc.kpis([
      { label: `This Month (${p.curYm || 'MTD'})`, value: fmt(t.curTotal), sub: `VC4 ${fmt(t.curVc4)} · Comm ${fmt(t.curComm)}`, color: '#2563eb' },
      { label: `Last Month (${p.lastYm || 'Prev'})`, value: fmt(t.lastTotal), sub: `VC4 ${fmt(t.lastVc4)} · Comm ${fmt(t.lastComm)}`, color: '#7c3aed' },
      { label: 'Growth / Expected', value: t.growth === null || t.growth === undefined ? '—' : `${t.growth >= 0 ? '+' : ''}${t.growth.toFixed(0)}%`, sub: `Expected ${fmt(p.expected)} · ${fmt(p.runRate, true)}/d`, color: (t.growth || 0) >= 0 ? '#16a34a' : '#dc2626' },
      { label: 'Stock in Hand', value: fmt(t.stockTotal), sub: `VC4 ${fmt(t.stockVc4)} · Comm ${fmt(t.stockComm)}`, color: '#0891b2' },
      { label: '30+d Old Stock', value: age ? fmt(age.old30) : '—', sub: age ? `60+d: ${fmt(age.old60)} · 90+d: ${fmt((age.buckets[4] && age.buckets[4].n) || 0)}` : 'Ageing', color: age && age.old60 ? '#dc2626' : '#d97706' }
    ]);

    doc.section(`Class-wise Issuance (${p.lastYm || 'Last'} vs ${p.curYm || 'MTD'}) & Stock in Hand`);
    const clsRows = (p.classTable || []).filter((x) => x.cur || x.last || x.stock);
    doc.table({
      headers: ['Class', p.lastYm || 'Last Month', p.curYm || 'Current (MTD)', 'Growth %', 'Stock in Hand'],
      align: ['left', 'right', 'right', 'right', 'right'],
      rows: clsRows.map((x) => [x.cls, fmt(x.last), fmt(x.cur), x.growth === null || x.growth === undefined ? '—' : `${x.growth >= 0 ? '+' : ''}${x.growth.toFixed(0)}%`, fmt(x.stock)]),
      foot: ['GRAND TOTAL', fmt(t.lastTotal), fmt(t.curTotal), t.growth === null || t.growth === undefined ? '—' : `${t.growth >= 0 ? '+' : ''}${t.growth.toFixed(0)}%`, fmt(t.stockTotal)]
    });

    if (age && age.total) {
      doc.section(`Stock Ageing — ${fmt(age.total)} tags (30+d: ${fmt(age.old30)} · 60+d: ${fmt(age.old60)})`);
      doc.table({
        headers: ['Class', ...age.buckets.map((b) => b.label), '30+d Old', '60+d Critical', 'Total'],
        align: ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
        rows: (age.byClass || []).map((c) => [c.cls, ...age.buckets.map((b) => fmt(c[b.key] || 0)), fmt(c.old30), fmt(c.old60), fmt(c.total)]),
        foot: ['GRAND TOTAL', ...age.buckets.map((b) => fmt(b.n || 0)), fmt(age.old30), fmt(age.old60), fmt(age.total)]
      });
    }

    if (r.isTl && (p.agents || []).length) {
      const sumLast = U.sum(p.agents, (a) => a.lastTotal);
      const sumCur = U.sum(p.agents, (a) => a.curTotal);
      const sumVc4 = U.sum(p.agents, (a) => a.curVc4);
      const sumComm = U.sum(p.agents, (a) => a.curComm);
      const sumStock = U.sum(p.agents, (a) => a.stockTotal);
      const teamGrowth = U.growth(sumCur, sumLast);
      doc.section(`Team Agents (${fmt(p.agents.length)}) — Issuance & Stock`);
      doc.table({
        headers: ['Agent Name', 'ID', 'Last Month', 'Current (MTD)', 'VC4', 'Comm', 'Growth %', 'Stock'],
        align: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right'],
        rows: p.agents.slice(0, 65).map((a) => [a.name, a.id || '—', fmt(a.lastTotal), fmt(a.curTotal), fmt(a.curVc4), fmt(a.curComm), a.growth === null || a.growth === undefined ? '—' : `${a.growth >= 0 ? '+' : ''}${a.growth.toFixed(0)}%`, fmt(a.stockTotal)]),
        foot: [`GRAND TOTAL (${fmt(p.agents.length)} Agents)`, '', fmt(sumLast), fmt(sumCur), fmt(sumVc4), fmt(sumComm), teamGrowth === null ? '—' : `${teamGrowth >= 0 ? '+' : ''}${teamGrowth.toFixed(0)}%`, fmt(sumStock)]
      });
    }

    doc.footer(`${FF.config.brand || 'ApnaPayment'} · ${chLabel} · Grand Total: Last ${fmt(t.lastTotal)} | MTD ${fmt(t.curTotal)} | Stock ${fmt(t.stockTotal)}`);
    return doc.finish();
  }

  function chartsSectionHtml(r) {
    const C = FF.charts;
    if (!C) return '';
    const p = r.p;
    const cls = (p.classTable || []).filter((x) => x.cur || x.last || x.stock);
    const stockCls = cls.filter((x) => x.stock > 0);
    const scopeParam = r.isTl ? `tl=${encodeURIComponent(p.name)}` : `agent=${encodeURIComponent(p.name)}${p.id ? `&agentId=${encodeURIComponent(p.id)}` : ''}`;
    const curSpec = `src=${r.ch}&scope=mtd&ym=${encodeURIComponent(p.curYm || '')}&${scopeParam}`;
    const stockSpec = `src=${r.ch}&scope=stock&${scopeParam}`;

    const issuanceChart = cls.length
      ? C.bars({
          labels: cls.map((x) => x.cls),
          height: 190,
          series: [
            { name: p.lastYm || 'Last Month', values: cls.map((x) => x.last || 0), color: '#c7d2fe' },
            { name: p.curYm || 'This Month (MTD)', values: cls.map((x) => x.cur || 0), color: '#4f46e5' }
          ],
          showValues: true,
          onClickAttr: (i) => `data-kpi="${esc(`${curSpec}&cls=${encodeURIComponent(cls[i].cls)}`)}"`
        })
      : '<div class="empty">Class-wise issuance data abhi nahi hai</div>';

    const stockChart = stockCls.length
      ? `<div class="grid g-2" style="gap:12px;align-items:center">
          <div>${C.bars({
            labels: stockCls.map((x) => x.cls),
            height: 180,
            series: [{ name: 'Stock in Hand', values: stockCls.map((x) => x.stock || 0), color: '#0d9488' }],
            showValues: true,
            onClickAttr: (i) => `data-kpi="${esc(`${stockSpec}&cls=${encodeURIComponent(stockCls[i].cls)}`)}"`
          })}</div>
          <div>${C.donut({
            items: stockCls.map((x) => ({ label: x.cls, value: x.stock, attr: `data-kpi="${esc(`${stockSpec}&cls=${encodeURIComponent(x.cls)}`)}"` })),
            subtitle: 'Stock',
            size: 150
          })}</div>
        </div>`
      : '<div class="empty">Is waqt stock in hand 0 hai</div>';

    return `<div class="as-two" style="margin-bottom:14px">
      <div class="card card-primary">
        <div class="card-head"><h3>📊 Class-wise Issuance Chart (${esc(p.lastYm || 'Last')} vs ${esc(p.curYm || 'MTD')})</h3><span class="dim small">Bar par click karke class details dekhein</span></div>
        <div class="card-body">${issuanceChart}</div>
      </div>
      <div class="card card-teal">
        <div class="card-head"><h3>📦 Class-wise Stock in Hand Chart</h3><span class="dim small">Total Stock: <b>${fmt((p.totals && p.totals.stockTotal) || 0)}</b></span></div>
        <div class="card-body">${stockChart}</div>
      </div>
    </div>`;
  }

  function openAgeingDrill(r, minDays, filterCls) {
    const age = r.age;
    const p = r.p;
    if (!age || !FF.app || !FF.app.openDrawer) {
      U.toast('Stock ageing data load ho raha hai…', 'info');
      return;
    }
    const chLabel = r.ch === 'gv' ? 'GV Partner' : 'First Forward';
    const rows = (age.byClass || []).filter((c) => (!filterCls || c.cls === filterCls) && (minDays === 60 ? c.old60 > 0 : minDays === 30 ? c.old30 > 0 : c.total > 0));
    const title = `${p.name} · ${filterCls ? `${filterCls} ` : ''}${minDays ? `${minDays}+ Days Old ` : ''}Stock Ageing`;
    const tot30 = U.sum(rows, (c) => c.old30), tot60 = U.sum(rows, (c) => c.old60), totAll = U.sum(rows, (c) => c.total);
    const body = `<div class="dsec">
      <div class="mini-grid">
        <div class="mini-kpi c1"><span class="mini-label">Total Stock</span><b class="mini-value">${fmt(totAll)}</b><span class="mini-foot">${esc(chLabel)}</span></div>
        <div class="mini-kpi c4"><span class="mini-label">30+d Old Stock</span><b class="mini-value">${fmt(tot30)}</b><span class="mini-foot">Needs attention</span></div>
        <div class="mini-kpi c6"><span class="mini-label">60+d Critical</span><b class="mini-value">${fmt(tot60)}</b><span class="mini-foot">Urgent action</span></div>
      </div>
      <div class="table-wrap"><table class="tbl compact">
        <thead><tr><th>Class</th>${age.buckets.map((b) => `<th class="num">${esc(b.label)}</th>`).join('')}<th class="num">30+d</th><th class="num">60+d</th><th class="num">Total</th></tr></thead>
        <tbody>${rows.map((c) => `<tr class="clickable" data-kpi="${esc(`src=${r.ch}&scope=stock&${r.isTl ? `tl=${encodeURIComponent(p.name)}` : `agent=${encodeURIComponent(p.name)}${p.id ? `&agentId=${encodeURIComponent(p.id)}` : ''}`}&cls=${encodeURIComponent(c.cls)}`)}"><td><b>${esc(c.cls)}</b></td>${age.buckets.map((b) => `<td class="num">${fmt(c[b.key] || 0)}</td>`).join('')}<td class="num"><b>${fmt(c.old30)}</b></td><td class="num"><b class="${c.old60 ? 'bad' : ''}">${fmt(c.old60)}</b></td><td class="num"><b>${fmt(c.total)}</b></td></tr>`).join('') || '<tr><td colspan="9" class="empty">Is bucket me koi stock nahi hai 🎉</td></tr>'}</tbody>
        <tfoot><tr class="row-total"><td>GRAND TOTAL</td>${age.buckets.map((b) => `<td class="num">${fmt(U.sum(rows, (c) => c[b.key] || 0))}</td>`).join('')}<td class="num">${fmt(tot30)}</td><td class="num">${fmt(tot60)}</td><td class="num">${fmt(totAll)}</td></tr></tfoot>
      </table></div>
    </div>`;
    FF.app.openDrawer({
      kicker: `⏳ ${chLabel} · Stock Ageing Drill-down`,
      title,
      sub: esc(`${r.isTl ? 'Team Leader' : 'Agent'}${p.id ? ` · ID ${p.id}` : ''} — kisi bhi class row par click karke tag/barcode details dekhein`),
      actions: `<button class="btn small" data-drawer-csv="${esc(title)}">⬇ CSV</button><button class="btn small primary" data-drawer-pdf="${esc(title)}">📄 PDF</button>`,
      body,
      wide: true,
      age: false
    });
  }

  function reportHtml(r) {
    const p = r.p, t = p.totals || {}, age = r.age;
    const chLabel = r.ch === 'gv' ? 'GV Partner' : 'First Forward';
    const scopeParam = r.isTl ? `tl=${encodeURIComponent(p.name)}` : `agent=${encodeURIComponent(p.name)}${p.id ? `&agentId=${encodeURIComponent(p.id)}` : ''}`;
    const curSpec = `src=${r.ch}&scope=mtd&ym=${encodeURIComponent(p.curYm || '')}&${scopeParam}`;
    const lastSpec = `src=${r.ch}&scope=month&ym=${encodeURIComponent(p.lastYm || '')}&${scopeParam}`;
    const stockSpec = `src=${r.ch}&scope=stock&${scopeParam}`;

    const clsRows = (p.classTable || []).filter((x) => x.cur || x.last || x.stock);
    const sumAgentsLast = r.isTl ? U.sum(p.agents || [], (a) => a.lastTotal) : 0;
    const sumAgentsCur = r.isTl ? U.sum(p.agents || [], (a) => a.curTotal) : 0;
    const sumAgentsVc4 = r.isTl ? U.sum(p.agents || [], (a) => a.curVc4) : 0;
    const sumAgentsComm = r.isTl ? U.sum(p.agents || [], (a) => a.curComm) : 0;
    const sumAgentsStock = r.isTl ? U.sum(p.agents || [], (a) => a.stockTotal) : 0;
    const teamGrowth = r.isTl ? U.growth(sumAgentsCur, sumAgentsLast) : null;

    return `<div class="as-report">
      <div class="as-head">
        <div class="as-ava">${r.isTl ? '👥' : '🧑‍💼'}</div>
        <div class="as-who">
          <div class="badge-row"><span class="badge ${r.ch === 'gv' ? 'green' : 'blue'}">${chLabel}</span><span class="badge purple">${r.isTl ? 'Team Leader' : 'Agent'}</span>${p.priority ? `<span class="badge ${/high/i.test(p.priority) ? 'red' : /med/i.test(p.priority) ? 'amber' : 'green'}">${esc(p.priority)}</span>` : ''}</div>
          <h2>${esc(p.name)}</h2>
          <p class="dim">${p.id ? `ID: <b>${esc(p.id)}</b> · ` : ''}${p.tlName && !r.isTl ? `TL: <b>${esc(p.tlName)}</b>${p.tlId ? ` (${esc(p.tlId)})` : ''} · ` : ''}${p.mobile ? `📞 <a href="tel:${esc(p.mobile)}">${esc(p.mobile)}</a>` : ''}</p>
        </div>
        <div class="as-actions">
          <button class="btn primary" data-as-act="pdf">📄 PDF</button>
          <button class="btn" data-as-act="excel">📊 Excel</button>
          <button class="btn" data-as-act="csv">⬇ CSV</button>
          <button class="btn" data-as-act="json">🧾 JSON</button>
          <button class="btn" data-as-act="share">📲 Share / WhatsApp</button>
          <button class="btn" data-as-act="wa">💬 WA Text</button>
          <button class="btn" data-as-act="copy">📋 Copy</button>
        </div>
      </div>

      <div class="kpi-grid six">
        <div class="kpi g1" data-kpi="${esc(curSpec)}" title="Click karke ${esc(p.curYm || 'is mahine')} ka exact issuance data dekhein"><div class="kpi-top"><span class="kpi-title">${esc(p.curYm || 'This month')} · MTD</span><span class="kpi-icon">🏷️</span></div><div class="kpi-value">${fmt(t.curTotal)}</div><div class="kpi-foot">VC4 <b>${fmt(t.curVc4)}</b> · Comm <b>${fmt(t.curComm)}</b></div></div>
        <div class="kpi g3" data-kpi="${esc(lastSpec)}" title="Click karke ${esc(p.lastYm || 'pichhle mahine')} ka exact issuance data dekhein"><div class="kpi-top"><span class="kpi-title">${esc(p.lastYm || 'Last month')}</span><span class="kpi-icon">📅</span></div><div class="kpi-value">${fmt(t.lastTotal)}</div><div class="kpi-foot">VC4 <b>${fmt(t.lastVc4)}</b> · Comm <b>${fmt(t.lastComm)}</b></div></div>
        <div class="kpi g2" data-kpi="${esc(curSpec)}" title="Click karke growth aur run-rate data dekhein"><div class="kpi-top"><span class="kpi-title">Expected</span><span class="kpi-icon">🎯</span></div><div class="kpi-value">${fmt(p.expected)}</div><div class="kpi-foot">${U.pctHtml(t.growth)} · <b>${fmt(p.runRate, true)}</b>/day</div></div>
        <div class="kpi g5" data-kpi="${esc(stockSpec)}" title="Click karke exact stock in hand aur barcodes dekhein"><div class="kpi-top"><span class="kpi-title">Stock in hand</span><span class="kpi-icon">📦</span></div><div class="kpi-value">${fmt(t.stockTotal)}</div><div class="kpi-foot">VC4 <b>${fmt(t.stockVc4)}</b> · Comm <b>${fmt(t.stockComm)}</b></div></div>
        <div class="kpi g4" data-as-age="30" title="Click karke 30+ din purana stock dekhein"><div class="kpi-top"><span class="kpi-title">30+d old stock</span><span class="kpi-icon">⏳</span></div><div class="kpi-value">${age ? fmt(age.old30) : '—'}</div><div class="kpi-foot">0–30d fresh: <b>${age ? fmt(age.total - age.old30) : '—'}</b></div></div>
        <div class="kpi g7" data-as-age="60" title="Click karke 60+ din critical stock dekhein"><div class="kpi-top"><span class="kpi-title">60+d critical</span><span class="kpi-icon">🚨</span></div><div class="kpi-value">${age ? fmt(age.old60) : '—'}</div><div class="kpi-foot">90+d: <b>${age ? fmt((age.buckets[4] && age.buckets[4].n) || 0) : '—'}</b></div></div>
      </div>

      ${chartsSectionHtml(r)}

      <div class="as-two">
        <div class="card">
          <div class="card-head"><h3>🚗 Class-wise Issuance &amp; Stock</h3><span class="dim small">${esc(p.lastYm || 'Last')} → ${esc(p.curYm || 'MTD')} · Row par click karke details kholein</span></div>
          <div class="table-wrap"><table class="tbl compact">
            <thead><tr><th>Class</th><th class="num">${esc(p.lastYm || 'Last')}</th><th class="num">${esc(p.curYm || 'MTD')}</th><th class="num">Growth</th><th class="num">Stock</th></tr></thead>
            <tbody>${clsRows.map((c) => `<tr class="clickable" data-kpi="${esc(`${c.cur > 0 ? curSpec : lastSpec}&cls=${encodeURIComponent(c.cls)}`)}"><td><b>${esc(c.cls)}</b></td><td class="num">${fmt(c.last)}</td><td class="num"><b>${fmt(c.cur)}</b></td><td class="num">${U.pctHtml(c.growth)}</td><td class="num">${fmt(c.stock)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No class rows</td></tr>'}</tbody>
            <tfoot><tr class="row-total"><td><b>Grand Total</b></td><td class="num"><b>${fmt(t.lastTotal)}</b></td><td class="num"><b>${fmt(t.curTotal)}</b></td><td class="num">${U.pctHtml(t.growth)}</td><td class="num"><b>${fmt(t.stockTotal)}</b></td></tr></tfoot>
          </table></div>
        </div>
        <div class="card">
          <div class="card-head"><h3>⏳ Stock Ageing · ${age ? fmt(age.total) : 0} tags</h3><span class="dim small">30+d: <b>${age ? fmt(age.old30) : 0}</b> · 60+d: <b class="bad">${age ? fmt(age.old60) : 0}</b></span></div>
          ${age && age.total ? `<div class="table-wrap"><table class="tbl compact">
            <thead><tr><th>Class</th>${age.buckets.map((b) => `<th class="num">${esc(b.label)}</th>`).join('')}<th class="num">30+d</th><th class="num">60+d</th><th class="num">Total</th></tr></thead>
            <tbody>${(age.byClass || []).map((c) => `<tr class="clickable" data-as-age-cls="${esc(c.cls)}"><td><b>${esc(c.cls)}</b></td>${age.buckets.map((b) => `<td class="num">${fmt(c[b.key] || 0)}</td>`).join('')}<td class="num"><b>${fmt(c.old30)}</b></td><td class="num"><b class="${c.old60 ? 'bad' : ''}">${fmt(c.old60)}</b></td><td class="num"><b>${fmt(c.total)}</b></td></tr>`).join('')}</tbody>
            <tfoot><tr class="row-total"><td><b>Grand Total</b></td>${age.buckets.map((b) => `<td class="num"><b>${fmt(b.n || 0)}</b></td>`).join('')}<td class="num"><b>${fmt(age.old30)}</b></td><td class="num"><b class="${age.old60 ? 'bad' : ''}">${fmt(age.old60)}</b></td><td class="num"><b>${fmt(age.total)}</b></td></tr></tfoot>
          </table></div>` : '<div class="card-body empty">Is waqt koi pending stock ageing nahi hai 🎉</div>'}
        </div>
      </div>

      ${r.isTl && (p.agents || []).length ? `<div class="card" style="margin-top:14px">
        <div class="card-head"><h3>🧑‍💼 Team Agents (${fmt(p.agents.length)}) — click any agent to open their summary</h3></div>
        <div class="table-wrap"><table class="tbl compact">
          <thead><tr><th>Agent</th><th>ID</th><th class="num">${esc(p.lastYm || 'Last')}</th><th class="num">${esc(p.curYm || 'MTD')}</th><th class="num">VC4</th><th class="num">Comm</th><th class="num">Growth</th><th class="num">Stock</th></tr></thead>
          <tbody>${p.agents.map((a) => `<tr class="clickable" data-as-pick="${esc(`${r.ch}-agent|${a.name}`)}"><td><b>${esc(a.name)}</b></td><td class="mono">${esc(a.id || '—')}</td><td class="num">${fmt(a.lastTotal)}</td><td class="num"><b>${fmt(a.curTotal)}</b></td><td class="num">${fmt(a.curVc4)}</td><td class="num">${fmt(a.curComm)}</td><td class="num">${U.pctHtml(a.growth)}</td><td class="num">${fmt(a.stockTotal)}</td></tr>`).join('')}</tbody>
          <tfoot><tr class="row-total"><td colspan="2"><b>Grand Total (${fmt(p.agents.length)} Agents)</b></td><td class="num"><b>${fmt(sumAgentsLast)}</b></td><td class="num"><b>${fmt(sumAgentsCur)}</b></td><td class="num"><b>${fmt(sumAgentsVc4)}</b></td><td class="num"><b>${fmt(sumAgentsComm)}</b></td><td class="num">${U.pctHtml(teamGrowth)}</td><td class="num"><b>${fmt(sumAgentsStock)}</b></td></tr></tfoot>
        </table></div>
      </div>` : ''}
    </div>`;
  }

  function makePage(channel) {
    const isGv = channel === 'gv';
    const state = { list: [], picked: null, report: null, q: '' };
    async function render(root, params) {
      const chLabel = isGv ? 'GV Partner' : 'First Forward';
      root.innerHTML = `<div class="page">
        <div class="page-head"><div><h1>${isGv ? '🟩' : '🟦'} ${chLabel} · Agent / TL Summary</h1><p class="sub">Search by <b>Name · Agent Name · TL Name · Agent ID · TL ID · Mobile Number</b> — poora summary + charts + ageing + Grand Total PDF / Excel / CSV / JSON / WhatsApp</p></div></div>
        <div class="card card-primary"><div class="card-body">
          <div class="as-search-bar">
            <div class="as-search">
              <input id="as-q" class="input" type="search" placeholder="🔎 Search Agent Name, TL Name, Agent ID, TL ID, ya 10-digit Mobile Number…" value="${esc((params && params.q) || state.q || '')}" autocomplete="off">
              <button class="btn primary" id="as-search-btn" type="button">🔎 Search</button>
              <button class="btn" id="as-refresh-btn" type="button" title="Data refresh — cache clear karke dobara load">🔄</button>
              <div id="as-drop" class="as-drop" hidden></div>
            </div>
          </div>
          <div class="as-quick-wrap" style="margin-top:10px">
            <div class="as-quick-head"><span class="dim small">⚡ <b>Suggested TLs &amp; Agents</b> (click to open):</span></div>
            <div id="as-top-suggest" class="as-top-suggest"></div>
          </div>
        </div></div>
        <div id="as-body">${U.spinner(`${chLabel} agents & TLs load ho rahe hain…`)}</div>
      </div>`;
      const qEl = U.$('#as-q', root), drop = U.$('#as-drop', root), body = U.$('#as-body', root);
      const topSug = U.$('#as-top-suggest', root), searchBtn = U.$('#as-search-btn', root);
      state.list = await loadPeople(channel);

      const renderTopChips = (q) => {
        if (!topSug) return;
        const hits = topSuggestions(state.list, q);
        if (!hits.length) {
          topSug.innerHTML = '<span class="dim small">Koi matching naam/ID/mobile nahi mila</span>';
          return;
        }
        topSug.innerHTML = hits.map((p) => {
          const isTl = p.kind.endsWith('tl');
          const active = state.picked && state.picked.kind === p.kind && norm(state.picked.name) === norm(p.name);
          return `<button type="button" class="chip as-sug-chip ${active ? 'on' : ''}" data-as-opt="${esc(`${p.kind}|${p.name}`)}">
            <span class="badge ${isTl ? 'purple' : 'blue'}">${isTl ? 'TL' : 'Agent'}</span>
            <b>${esc(p.name)}</b>
            ${p.id ? `<small class="mono">(${esc(p.id)})</small>` : ''}
            ${p.mobile ? `<small class="dim">📞${esc(mob10(p.mobile))}</small>` : ''}
            <small class="dim">· MTD ${fmt(p.cur)}</small>
          </button>`;
        }).join('');
      };

      const showDrop = (q) => {
        const hits = matchPeople(state.list, q);
        if (!hits.length) {
          drop.innerHTML = `<div class="as-opt dim"><span>"${esc(q)}" ke liye koi Agent / TL / ID / Mobile nahi mila</span></div>`;
          drop.hidden = false;
          return;
        }
        drop.innerHTML = hits.map((p) => {
          const isTl = p.kind.endsWith('tl');
          return `<button type="button" class="as-opt" data-as-opt="${esc(`${p.kind}|${p.name}`)}">
            <span>
              <span class="badge ${isTl ? 'purple' : 'blue'}">${isTl ? 'TL' : 'Agent'}</span>
              <b>${esc(p.name)}</b>
              ${p.id ? `<small class="mono">· ID ${esc(p.id)}</small>` : ''}
              ${!isTl && p.tl ? `<small class="dim">· TL ${esc(p.tl)}${p.tlId ? ` (${esc(p.tlId)})` : ''}</small>` : ''}
              ${p.mobile ? `<small class="dim">· 📞 ${esc(mob10(p.mobile))}</small>` : ''}
            </span>
            <span class="dim small">MTD <b>${fmt(p.cur)}</b> · Stock <b>${fmt(p.stock)}</b></span>
          </button>`;
        }).join('');
        drop.hidden = false;
      };

      const pick = async (person, opts) => {
        if (!person) return;
        drop.hidden = true;
        state.picked = person;
        state.q = person.name;
        qEl.value = person.name;
        renderTopChips('');
        body.innerHTML = U.spinner(`${person.name} ka poora summary ban raha hai…`);
        state.report = await buildReportCached(person, opts);
        body.innerHTML = reportHtml(state.report);
        if (FF.charts && FF.charts.mount) FF.charts.mount(body);
        if (FF.app && FF.app.enhanceTables) FF.app.enhanceTables(body);
      };

      renderTopChips(qEl.value);

      qEl.addEventListener('focus', () => showDrop(qEl.value));
      let qTimer = 0;
      qEl.addEventListener('input', () => {
        state.q = qEl.value;
        clearTimeout(qTimer);
        qTimer = setTimeout(() => { showDrop(qEl.value); renderTopChips(qEl.value); }, 120); // v3.34 debounce — fast typing par render storm nahi
      });
      qEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const hits = matchPeople(state.list, qEl.value);
          if (hits[0]) pick(hits[0]);
        } else if (e.key === 'Escape') {
          drop.hidden = true;
        }
      });
      if (searchBtn) {
        searchBtn.addEventListener('click', () => {
          const hits = matchPeople(state.list, qEl.value);
          if (hits[0]) pick(hits[0], { fresh: true }); // Search = fresh report (cache bypass)
          else U.toast('Koi matching Agent ya TL nahi mila', 'warn');
        });
      }
      const refreshBtn = U.$('#as-refresh-btn', root);
      if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
          refreshBtn.disabled = true;
          try {
            clearCaches();
            state.list = await loadPeople(channel);
            renderTopChips(qEl.value);
            const target = (state.picked && matchPeople(state.list, state.picked.name)[0]) || (qEl.value && matchPeople(state.list, qEl.value)[0]);
            if (target) await pick(target, { fresh: true });
            U.toast('Data refresh ho gaya ✓', 'ok');
          } catch (err) {
            U.toast((err && err.message) || 'Refresh fail hua', 'err');
          } finally {
            refreshBtn.disabled = false;
          }
        });
      }

      if (root.__asSummaryClick) root.removeEventListener('click', root.__asSummaryClick);
      root.__asSummaryClick = async (e) => {
        const opt = e.target.closest('[data-as-opt],[data-as-pick]');
        if (opt) {
          const [kind, name] = (opt.dataset.asOpt || opt.dataset.asPick).split('|');
          const found = state.list.find((x) => x.kind === kind && norm(x.name) === norm(name)) || { kind, name };
          pick(found);
          return;
        }
        const ageCard = e.target.closest('[data-as-age]');
        if (ageCard && state.report) {
          openAgeingDrill(state.report, Number(ageCard.dataset.asAge) || 30, '');
          return;
        }
        const ageCls = e.target.closest('[data-as-age-cls]');
        if (ageCls && state.report) {
          openAgeingDrill(state.report, 0, ageCls.dataset.asAgeCls);
          return;
        }
        const act = e.target.closest('[data-as-act]');
        if (act && state.report) {
          const r = state.report, fname = `${r.ch}-${r.isTl ? 'tl' : 'agent'}-${U.slug(r.p.name)}-${U.stamp()}`;
          const k = act.dataset.asAct;
          act.disabled = true;
          try {
            await new Promise((res) => setTimeout(res, 30)); // busy paint
            if (k === 'pdf' || k === 'share') {
              if (!FF.pdf && FF.lazy && FF.lazy.loadScript) await FF.lazy.loadScript('pdf.js').catch(() => {});
              if (!FF.pdf || !FF.pdf.doc) throw new Error('PDF module load nahi hua — page refresh karo');
              const bytes = makePdf(r);
              if (k === 'share') await FF.pdf.share(bytes, `${fname}.pdf`, `${r.p.name} — Summary`, reportText(r));
              else FF.pdf.download(bytes, `${fname}.pdf`);
              U.toast(k === 'share' ? 'Share ready ✓' : 'PDF downloaded ✓', 'ok');
            } else if (k === 'wa') window.open(U.waLink(reportText(r)), '_blank', 'noopener');
            else if (k === 'copy') { await U.copyText(reportText(r)); U.toast('Summary copied (with Grand Total) ✓', 'ok'); }
            else if (k === 'csv') {
              const rows = reportCsv(r);
              U.downloadCsv(`${fname}.csv`, rows[0] || ['Field', 'Value'], rows.slice(1));
              U.toast('CSV downloaded (with Grand Total) ✓', 'ok');
            } else if (k === 'excel') {
              FF.xlsx.download(`${fname}.xlsx`, reportXlsx(r));
              U.toast('Excel downloaded (multi-sheet, Grand Total) ✓', 'ok');
            } else if (k === 'json') {
              U.downloadBlob(`${fname}.json`, new Blob([reportJson(r)], { type: 'application/json' }));
              U.toast('JSON downloaded ✓', 'ok');
            }
          } catch (err) {
            console.error('[agentSummary] export failed:', err);
            U.toast(`${(err && err.message) || 'Export fail hua'}`, 'err');
          } finally {
            act.disabled = false;
          }
          return;
        }
        if (!e.target.closest('.as-search')) drop.hidden = true;
      };
      root.addEventListener('click', root.__asSummaryClick);

      const initial = (params && params.name && matchPeople(state.list, params.name)[0])
        || (params && params.q && matchPeople(state.list, params.q)[0])
        || state.picked
        || state.list.find((p) => p.kind.endsWith('tl'))
        || state.list[0];
      if (initial) await pick(initial);
      else body.innerHTML = '<div class="card"><div class="card-body empty">Koi agent / TL data nahi mila.</div></div>';
    }
    // ⚠️ Shell har page ko { title, render } object ke roop me call karta hai (app.js → FF.pages[page].render).
    // Pehle yahan bare function return ho raha tha → "FF.pages[page].render is not a function" crash.
    return { title: 'Agent / TL Summary', render };
  }

  FF.pages.ffAgentSummary = makePage('ff');
  FF.pages.gvAgentSummary = makePage('gv');
  FF.agentSummary = { loadPeople, matchPeople, topSuggestions, buildReport, makePdf, reportText, reportCsv, reportXlsx, reportJson, clearCaches };
})(window.FF);
