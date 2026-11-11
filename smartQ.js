/* ❓ SMART SAWAAL (v3.125.68) — Master Search me type karte hi sawaal suggest hote hain
   ("Inactive this month · GV", "Top 10 agents · FF", "High growth · GV", "Dispatch need · Direct agents · FF",
   "Top VC4 / VC20 / VC5 agents" …). Pick karte hi jawab table ke saath — site ke already-loaded data se (instant).
   Sources: FF = FF.pages.performance.agents() · GV = FF.gv report rows. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc, clean = U.clean;
  const fmt = (n) => U.fmt(Number(n) || 0);
  const num = (v) => Number(v) || 0;

  // ------------------------------------------------------------------ data → unified rows
  function ffRows() {
    const P = FF.pages && FF.pages.performance;
    let list = [];
    try { list = (P && P.agents && P.agents()) || []; } catch { list = []; }
    const sd = (FF.config && FF.config.features && Number(FF.config.features.suggestDays)) || 15;
    return list.filter((a) => a && !a.isMaster).map((a) => {
      const bins = a.curBins || {};
      const rate = num(a.avgTotal) || (a.activeDays ? num(a.curTotal) / a.activeDays : 0);
      return {
        ch: 'FF', name: clean(a.name) || clean(a.agentId), id: clean(a.agentId || a.id), tl: clean(a.tlName),
        direct: !!a.tlExcluded, cur: num(a.curTotal), last: num(a.lastTotal),
        vc4: num(a.curVc4), vc20: num(bins.VC20), vc5: num(bins['VC5+']) || Math.max(0, num(a.curNvc4) - num(bins.VC20)),
        stock: num(a.stockTotal), rate,
        growth: a.growthNum == null ? null : a.growthNum,
        status: clean(a.perfStatus), high: /high growth/i.test(a.perfStatus || ''), de: /de-?growth/i.test(a.perfStatus || ''),
        proj: num(a.curProjected) || (a.activeDays ? 0 : 0), lastActive: clean(a.lastActive), need: Math.max(0, Math.ceil(rate * sd - num(a.stockTotal)))
      };
    });
  }
  function gvRows() {
    let list = [];
    try { list = (FF.gv && FF.gv.get && FF.gv.get('report')) || []; } catch { list = []; }
    const sd = (FF.config && FF.config.features && Number(FF.config.features.suggestDays)) || 15;
    return list.filter((r) => r && (clean(r.agentName) || clean(r.agentId))).map((r) => {
      const c = r.curByClass || {};
      const rate = num(r.runrate);
      const perf = clean(r.agentPerf);
      return {
        ch: 'GV', name: clean(r.agentName) || clean(r.agentId), id: clean(r.agentId), tl: clean(r.tlName),
        direct: !!r.directAgent, cur: num(r.curTotal), last: num(r.lastTotal),
        vc4: num(r.curVc4 != null ? r.curVc4 : c.VC4), vc20: num(c.VC20),
        vc5: num(c.VC5) + num(c.VC6) + num(c.VC7) + num(c.VC12) + num(c.VC16),
        stock: num(r.stockTotal), rate,
        growth: r.growth == null || r.growth === '' ? null : num(r.growth),
        status: perf.replace(/^[^A-Za-z]+/, ''), high: /high growth/i.test(perf), de: /de-?growth/i.test(perf),
        proj: num(r.expected),
        lastActive: num(r.curTotal) > 0 ? 'Active' : (num(r.lastTotal) > 0 ? 'Inactive in month' : 'No issuance'),
        need: Math.max(0, Math.ceil(rate * sd - num(r.stockTotal)))
      };
    });
  }
  const rowsFor = (ch) => (ch === 'ff' ? ffRows() : ch === 'gv' ? gvRows() : [...ffRows(), ...gvRows()]);

  // ------------------------------------------------------------------ columns
  const C = {
    ch: { k: 'ch', l: 'Ch' }, name: { k: 'name', l: 'Agent' }, id: { k: 'id', l: 'ID' }, tl: { k: 'tl', l: 'TL' },
    cur: { k: 'cur', l: 'This month', n: 1 }, last: { k: 'last', l: 'Last month', n: 1 },
    vc4: { k: 'vc4', l: 'VC4', n: 1 }, vc20: { k: 'vc20', l: 'VC20', n: 1 }, vc5: { k: 'vc5', l: 'VC5+', n: 1 },
    stock: { k: 'stock', l: 'Stock', n: 1 }, rate: { k: 'rate', l: '/day', n: 1, d: 1 }, need: { k: 'need', l: 'Dispatch need', n: 1 },
    growth: { k: 'growth', l: 'Growth %', n: 1, p: 1 }, proj: { k: 'proj', l: 'Expected', n: 1 }, ratio: { k: 'ratio', l: 'Issue / stock', n: 1, p: 1 }, agents: { k: 'agents', l: 'Agents', n: 1 }, active: { k: 'active', l: 'Active agents', n: 1 }, inact: { k: 'inact', l: 'Inactive agents', n: 1 }, cover: { k: 'cover', l: 'Cover days', n: 1, d: 1 }, drop: { k: 'drop', l: 'Drop vs last', n: 1 }, status: { k: 'status', l: 'Status' }, lastActive: { k: 'lastActive', l: 'Last active' }
  };

  // ------------------------------------------------------------------ question catalog
  const CH_LABEL = { ff: 'FF', gv: 'GV', all: 'FF + GV' };
  const Q = [];
  function add(def) { ['ff', 'gv', 'all'].forEach((ch) => { if (def.only && !def.only.includes(ch)) return; Q.push({ ...def, ch, id: `${def.key}|${ch}` }); }); }

  add({ key: 'inactive', title: 'Inactive this month', kw: 'inactive nahi chala band zero issuance no issuance dormant is month', n: false, tone: 'down',
    run: (rows) => rows.filter((r) => r.cur === 0 && (r.last > 0 || r.stock > 0)).sort((a, b) => b.last - a.last || b.stock - a.stock),
    cols: ['name', 'id', 'tl', 'last', 'stock', 'lastActive'], note: 'This month me 0 issuance — last month ya stock wale agents (last month ke hisaab se)' });
  add({ key: 'top', title: 'Top agents (issuance)', kw: 'top best highest zyada total issuance agents', n: true, tone: 'up',
    run: (rows, n) => rows.filter((r) => r.cur > 0).sort((a, b) => b.cur - a.cur).slice(0, n),
    cols: ['name', 'id', 'tl', 'cur', 'last', 'vc4', 'vc20', 'vc5', 'stock'], note: 'Is month ke total issuance ke hisaab se' });
  add({ key: 'high', title: 'High growth agents', kw: 'high growth badhat growth badh rahe improving', n: true, tone: 'up',
    run: (rows, n) => rows.filter((r) => r.high).sort((a, b) => (b.growth ?? -1e9) - (a.growth ?? -1e9) || b.cur - a.cur).slice(0, n),
    cols: ['name', 'id', 'tl', 'cur', 'last', 'growth', 'stock'], note: 'Expected month-end vs last month' });
  add({ key: 'degrowth', title: 'De-growth agents', kw: 'de growth degrowth girawat kam ghat decline falling low', n: true, tone: 'down',
    run: (rows, n) => rows.filter((r) => r.de && r.cur > 0).sort((a, b) => (a.growth ?? 1e9) - (b.growth ?? 1e9) || b.last - a.last).slice(0, n),
    cols: ['name', 'id', 'tl', 'last', 'cur', 'proj', 'growth', 'stock'], note: 'Is speed se month-end last month se neeche rahega (is month issuance chal rahi hai)' });
  add({ key: 'lowissue', title: 'Stock hai, speed kam', kw: 'low issuance stock hai speed kam slow dheemi stock zyada issue kam', n: true, tone: 'down',
    run: (rows, n) => rows.filter((r) => r.stock >= 20 && r.cur > 0).map((r) => ({ ...r, ratio: Math.round((r.cur / r.stock) * 100) })).filter((r) => r.ratio < 50).sort((a, b) => a.ratio - b.ratio || b.stock - a.stock).slice(0, n),
    cols: ['name', 'id', 'tl', 'stock', 'last', 'cur', 'ratio'], note: 'Stock ≥ 20 par is month issuance stock ka 50% se bhi kam' });
  add({ key: 'dispatchDirect', title: 'Dispatch need · Direct agents', kw: 'dispatch need direct agents tag bhejne chahiye aps no tl', n: true, tone: 'warn',
    run: (rows, n) => rows.filter((r) => r.direct && r.need > 0).sort((a, b) => b.need - a.need).slice(0, n),
    cols: ['name', 'id', 'cur', 'rate', 'stock', 'need'], note: 'Direct agents: run-rate × Settings days − stock' });
  add({ key: 'dispatch', title: 'Dispatch need · All agents', kw: 'dispatch need tag bhejne chahiye required kitne tag', n: true, tone: 'warn',
    run: (rows, n) => rows.filter((r) => r.need > 0).sort((a, b) => b.need - a.need).slice(0, n),
    cols: ['name', 'id', 'tl', 'cur', 'rate', 'stock', 'need'], note: 'Run-rate × Settings days − stock' });
  add({ key: 'vc4', title: 'Top VC4 agents', kw: 'top vc4 car jeep van agents', n: true, tone: 'up',
    run: (rows, n) => rows.filter((r) => r.vc4 > 0).sort((a, b) => b.vc4 - a.vc4).slice(0, n),
    cols: ['name', 'id', 'tl', 'vc4', 'cur', 'stock'], note: 'VC4 issuance (this month)' });
  add({ key: 'vc20', title: 'Top VC20 agents', kw: 'top vc20 agents', n: true, tone: 'up',
    run: (rows, n) => rows.filter((r) => r.vc20 > 0).sort((a, b) => b.vc20 - a.vc20).slice(0, n),
    cols: ['name', 'id', 'tl', 'vc20', 'cur', 'stock'], note: 'VC20 issuance (this month)' });
  add({ key: 'vc5', title: 'Top VC5 agents', kw: 'top vc5 vc6 vc7 vc12 vc16 commercial agents', n: true, tone: 'up',
    run: (rows, n) => rows.filter((r) => r.vc5 > 0).sort((a, b) => b.vc5 - a.vc5).slice(0, n),
    cols: ['name', 'id', 'tl', 'vc5', 'cur', 'stock'], note: 'VC5+ (VC5/6/7/12/16) issuance (this month)' });
  add({ key: 'nostock', title: 'Issuing but stock zero', kw: 'zero stock stock khatam out of stock no stock khali', n: true, tone: 'down',
    run: (rows, n) => rows.filter((r) => r.cur > 0 && r.stock <= 0).sort((a, b) => b.cur - a.cur).slice(0, n),
    cols: ['name', 'id', 'tl', 'cur', 'rate', 'need'], note: 'Issuance chal rahi hai par stock 0' });
  add({ key: 'direct', title: 'Direct agents list', kw: 'direct agents aps no tl list', n: true,
    run: (rows, n) => rows.filter((r) => r.direct).sort((a, b) => b.cur - a.cur).slice(0, n),
    cols: ['name', 'id', 'cur', 'last', 'stock', 'need'], note: 'Bina TL ke direct agents' });
  // ---- TL level: agents ko TL ke hisaab se jodo (direct agents TL nahi gine jaate)
  function tlRows(rows) {
    const m = new Map();
    rows.filter((r) => r.tl && !r.direct).forEach((r) => {
      const k = `${r.ch}|${r.tl}`; let o = m.get(k);
      if (!o) { o = { ch: r.ch, name: r.tl, id: '', tl: '', cur: 0, last: 0, proj: 0, stock: 0, need: 0, vc4: 0, vc20: 0, vc5: 0, agents: 0, active: 0, inact: 0 }; m.set(k, o); }
      o.cur += r.cur; o.last += r.last; o.proj += (r.proj || r.cur); o.stock += r.stock; o.need += r.need;
      o.vc4 += r.vc4; o.vc20 += r.vc20; o.vc5 += r.vc5; o.agents++;
      if (r.cur > 0) o.active++; else o.inact++;
    });
    const out = [...m.values()];
    out.forEach((o) => { o.growth = o.last > 0 ? Math.round((o.proj / o.last - 1) * 100) : null; o.drop = o.last - o.cur; });
    return out;
  }
  const tlAdd = (def) => add({ ...def, tl: true, run: (rows, n) => def.run(tlRows(rows), n) });
  const TLC = ['name', 'agents', 'active', 'inact', 'cur', 'last', 'growth', 'stock'];

  tlAdd({ key: 'toptl', title: 'Top TLs (issuance)', kw: 'top tl tls team leader best issuance zyada', n: true, tone: 'up',
    run: (t, n) => t.filter((x) => x.cur > 0).sort((a, b) => b.cur - a.cur).slice(0, n), cols: TLC, note: 'TL ke agents ka total (this month)' });
  tlAdd({ key: 'inactivetl', title: 'Inactive TLs', kw: 'inactive tl tls team leader nahi chala zero issuance band', n: true, tone: 'down',
    run: (t, n) => t.filter((x) => x.cur === 0).sort((a, b) => b.last - a.last || b.stock - a.stock).slice(0, n), cols: ['name', 'agents', 'last', 'stock'], note: 'TL ke saare agents ka is month 0 issuance' });
  tlAdd({ key: 'degrowthtl', title: 'De-growth TLs', kw: 'de growth degrowth tl tls team leader girawat kam decline', n: true, tone: 'down',
    run: (t, n) => t.filter((x) => x.growth != null && x.growth < 0).sort((a, b) => a.growth - b.growth).slice(0, n), cols: ['name', 'agents', 'cur', 'last', 'proj', 'growth', 'stock'], note: 'Expected month-end last month se neeche' });
  tlAdd({ key: 'highgrowthtl', title: 'High growth TLs', kw: 'high growth tl tls team leader badhat improving', n: true, tone: 'up',
    run: (t, n) => t.filter((x) => x.growth != null && x.growth >= 20).sort((a, b) => b.growth - a.growth).slice(0, n), cols: ['name', 'agents', 'cur', 'last', 'proj', 'growth', 'stock'], note: 'Expected month-end last month se 20%+ upar' });
  tlAdd({ key: 'stocktl', title: 'Highest stock TLs', kw: 'highest stock tl tls team leader zyada stock maal', n: true,
    run: (t, n) => t.sort((a, b) => b.stock - a.stock).slice(0, n), cols: ['name', 'agents', 'stock', 'cur', 'last'], note: 'TL ke agents ka total stock' });
  tlAdd({ key: 'dispatchtl', title: 'Dispatch need · TLs', kw: 'dispatch need tl tls team leader tag bhejne chahiye required', n: true, tone: 'warn',
    run: (t, n) => t.filter((x) => x.need > 0).sort((a, b) => b.need - a.need).slice(0, n), cols: ['name', 'agents', 'cur', 'stock', 'need'], note: 'Agents ke dispatch need ka jod' });
  tlAdd({ key: 'inactagentstl', title: 'TLs with most inactive agents', kw: 'most inactive agents tl tls team leader zyada inactive', n: true, tone: 'down',
    run: (t, n) => t.filter((x) => x.inact > 0).sort((a, b) => b.inact - a.inact).slice(0, n), cols: ['name', 'agents', 'active', 'inact', 'cur', 'last'], note: 'Jinke zyada agents is month inactive hain' });
  tlAdd({ key: 'lasttl', title: 'Top TLs (last month)', kw: 'top tl tls last month pichla month previous', n: true,
    run: (t, n) => t.filter((x) => x.last > 0).sort((a, b) => b.last - a.last).slice(0, n), cols: ['name', 'agents', 'last', 'cur', 'growth'], note: 'Last month ke total ke hisaab se' });
  tlAdd({ key: 'vc4tl', title: 'Top VC4 TLs', kw: 'top vc4 tl tls team leader', n: true, tone: 'up',
    run: (t, n) => t.filter((x) => x.vc4 > 0).sort((a, b) => b.vc4 - a.vc4).slice(0, n), cols: ['name', 'agents', 'vc4', 'cur', 'stock'], note: 'VC4 issuance (this month)' });
  tlAdd({ key: 'vc20tl', title: 'Top VC20 TLs', kw: 'top vc20 tl tls team leader', n: true, tone: 'up',
    run: (t, n) => t.filter((x) => x.vc20 > 0).sort((a, b) => b.vc20 - a.vc20).slice(0, n), cols: ['name', 'agents', 'vc20', 'cur', 'stock'], note: 'VC20 issuance (this month)' });
  tlAdd({ key: 'vc5tl', title: 'Top VC5 TLs', kw: 'top vc5 vc6 vc7 vc12 vc16 commercial tl tls team leader', n: true, tone: 'up',
    run: (t, n) => t.filter((x) => x.vc5 > 0).sort((a, b) => b.vc5 - a.vc5).slice(0, n), cols: ['name', 'agents', 'vc5', 'cur', 'stock'], note: 'VC5+ issuance (this month)' });
  tlAdd({ key: 'bigtl', title: 'Biggest teams (most agents)', kw: 'biggest teams most agents tl tls team leader zyada agents team size', n: true,
    run: (t, n) => t.sort((a, b) => b.agents - a.agents).slice(0, n), cols: ['name', 'agents', 'active', 'inact', 'cur', 'stock'], note: 'TL ke neeche agents ki ginti' });

  // ---- more agent questions
  add({ key: 'stockhigh', title: 'Highest stock agents', kw: 'highest stock zyada stock maal most stock agents', n: true, tone: 'info',
    run: (rows, n) => rows.filter((r) => r.stock > 0).sort((a, b) => b.stock - a.stock).slice(0, n),
    cols: ['name', 'id', 'tl', 'stock', 'cur', 'rate'], note: 'Total stock ke hisaab se' });
  add({ key: 'deadstock', title: 'Stock but inactive (dead stock)', kw: 'dead stock inactive stock pada hua sleeping idle stock but no issuance', n: true, tone: 'warn',
    run: (rows, n) => rows.filter((r) => r.stock > 0 && r.cur === 0).sort((a, b) => b.stock - a.stock).slice(0, n),
    cols: ['name', 'id', 'tl', 'stock', 'last', 'lastActive'], note: 'Stock hai par is month issuance 0' });
  add({ key: 'lowcover', title: 'Low stock cover (< 5 days)', kw: 'low stock cover khatam hone wala running out kam stock urgent critical', n: true, tone: 'warn',
    run: (rows, n) => rows.filter((r) => r.rate > 0 && r.stock / r.rate < 5).map((r) => ({ ...r, cover: r.stock / r.rate })).sort((a, b) => a.cover - b.cover || b.rate - a.rate).slice(0, n),
    cols: ['name', 'id', 'tl', 'stock', 'rate', 'cover', 'need'], note: 'Stock / run-rate 5 din se kam' });
  add({ key: 'lastmonth', title: 'Top agents (last month)', kw: 'top last month pichla month previous best agents', n: true,
    run: (rows, n) => rows.filter((r) => r.last > 0).sort((a, b) => b.last - a.last).slice(0, n),
    cols: ['name', 'id', 'tl', 'last', 'cur', 'growth'], note: 'Last month ke total ke hisaab se' });
  add({ key: 'biggestdrop', title: 'Biggest drop vs last month', kw: 'biggest drop girawat sabse zyada gira ghata decline vs last month', n: true, tone: 'down',
    run: (rows, n) => rows.map((r) => ({ ...r, drop: r.last - r.cur })).filter((r) => r.drop > 0).sort((a, b) => b.drop - a.drop).slice(0, n),
    cols: ['name', 'id', 'tl', 'last', 'cur', 'drop', 'stock'], note: 'Last month − this month (abhi tak)' });
  add({ key: 'newagents', title: 'New / reactivated agents', kw: 'new agents naye reactivated restart shuru last month zero', n: true, tone: 'up',
    run: (rows, n) => rows.filter((r) => r.cur > 0 && r.last === 0).sort((a, b) => b.cur - a.cur).slice(0, n),
    cols: ['name', 'id', 'tl', 'cur', 'vc4', 'stock'], note: 'Last month 0, is month issuance' });
  add({ key: 'runrate', title: 'Highest run-rate (per day)', kw: 'highest run rate runrate per day daily speed fast', n: true, tone: 'up',
    run: (rows, n) => rows.filter((r) => r.rate > 0).sort((a, b) => b.rate - a.rate).slice(0, n),
    cols: ['name', 'id', 'tl', 'rate', 'cur', 'stock', 'need'], note: 'Roz ka average issuance' });
  add({ key: 'noissue2', title: 'No issuance last + this month', kw: 'dead agents 2 months inactive both months no issuance sleeping', n: true, tone: 'down',
    run: (rows, n) => rows.filter((r) => r.cur === 0 && r.last === 0 && r.stock > 0).sort((a, b) => b.stock - a.stock).slice(0, n),
    cols: ['name', 'id', 'tl', 'stock'], note: 'Dono months 0 par stock pada hai' });

  add({ key: 'summary', title: 'Total issuance (this vs last month)', kw: 'total issuance kitna hua summary overall count this month last month', n: false, sum: true,
    run: (rows) => [{ ch: '', name: 'TOTAL', id: '', tl: '', cur: U.sum(rows, (r) => r.cur), last: U.sum(rows, (r) => r.last), vc4: U.sum(rows, (r) => r.vc4), vc20: U.sum(rows, (r) => r.vc20), vc5: U.sum(rows, (r) => r.vc5), stock: U.sum(rows, (r) => r.stock) },
      { ch: '', name: 'Active agents', cur: rows.filter((r) => r.cur > 0).length, last: rows.filter((r) => r.last > 0).length },
      { ch: '', name: 'Inactive this month', cur: rows.filter((r) => r.cur === 0 && r.last > 0).length },
      { ch: '', name: 'Direct agents', cur: rows.filter((r) => r.direct).length },
      { ch: '', name: 'Dispatch need (total)', cur: U.sum(rows, (r) => r.need) }],
    cols: ['name', 'cur', 'last', 'vc4', 'vc20', 'vc5', 'stock'], note: '' });

  // ------------------------------------------------------------------ suggestions
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const TRIGGER = /(sawaal|sawal|questions?|help|all|highest|biggest|dead|low|new|last|run ?rate|inactive|nahi|top|best|high|growth|degrowth|de growth|dispatch|need|direct|vc4|vc20|vc5|vc6|vc7|zero|stock|total|kitna|sawaal|question|\?|tl|summary|bhejne|agents?)/;
  function parseN(q) { const m = /\b(\d{1,3})\b/.exec(q); const n = m ? Number(m[1]) : 0; return n >= 1 && n <= 500 ? n : 10; }
  function chOf(q) {
    const t = ` ${norm(q)} `;
    if (/ gv /.test(t)) return 'gv';
    if (/ (ff|first forward) /.test(t)) return 'ff';
    return '';
  }
  function suggest(q, max) {
    const t = norm(q);
    if (t.length < 2 || /^\d[\d\s-]*$/.test(t)) return [];
    if (!TRIGGER.test(t)) return [];
    const words = t.split(' ').filter((w) => w.length >= 2 && !/^(gv|ff|agents?|tls?|teams?|ke|ka|ki|me|ho|hai|of|the|and|aur|all)$/.test(w) && !/^\d+$/.test(w));
    const wantCh = chOf(q);
    const n = parseN(t);
    const wantTl = /\b(tls?|team leaders?|teams?)\b/.test(t);
    if (/^(sawaal|sawal|questions?|help|all questions?|saare sawaal|\?)$/.test(t)) return [{ kind: 'cls', kindLabel: '❓ Sawaal', q: '__catalog', label: 'Saare sawaal dekho (list)', sub: 'Agents · TLs · Stock · Growth — sab ek jagah', value: q }];
    const scored = [];
    Q.forEach((d) => {
      if (wantCh && d.ch !== wantCh) return;
      if (wantTl !== !!d.tl) return;
      const hay = `${norm(d.title)} ${d.kw} ${d.ch}`;
      let s = 0;
      if (!words.length) s = 1;
      else {
        let hit = 0;
        words.forEach((w) => { if (hay.includes(w)) hit++; else if (norm(d.title).split(' ').some((x) => x.startsWith(w))) hit += 0.5; });
        if (!hit || hit < Math.min(words.length, 2) * 0.5) return;
        s = hit * 10 + (norm(d.title).startsWith(words[0]) ? 5 : 0);
      }
      if (!wantCh && d.ch === 'all') s -= 3;
      scored.push({ d, s });
    });
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, max || 8).map(({ d }) => ({
      kind: 'cls', kindLabel: '❓ Sawaal', q: d.id, qn: d.n ? n : 0,
      label: `${d.n && n !== 10 ? d.title.replace(/^Top /, `Top ${n} `) : d.title} · ${CH_LABEL[d.ch]}`,
      sub: 'Enter dabao → turant jawab · ' + (d.note || ''), value: q
    }));
  }

  // ------------------------------------------------------------------ run + render
  function find(id) { return Q.find((d) => d.id === id); }
  function answer(id, n) {
    const d = find(id);
    if (!d) return null;
    const rows = rowsFor(d.ch);
    const lim = n === 'all' || n === 0 || n === Infinity ? Infinity : (n || 10); // 'all' → poori list
    const out = d.run(rows, lim);
    return { def: d, n: lim, rows: out, total: rows.length };
  }
  const cell = (c, v, r) => {
    if (c.k === 'ratio') return v == null ? '<span class="dim">—</span>' : `<span class="delta ${v >= 20 ? 'up' : 'down'}">${fmt(v)}%</span>`;
    if (c.p) return v == null || v === '' ? '<span class="dim">—</span>' : `<span class="${v >= 0 ? 'delta up' : 'delta down'}">${v > 0 ? '+' : ''}${fmt(v)}%</span>`;
    if (c.k === 'cur' && r && r.last > 0) return `<b class="sq-cur ${v >= r.last ? 'ok' : 'bad'}">${fmt(v)}</b>`;
    if (c.k === 'last') return `<span class="sq-last">${fmt(v)}</span>`;
    if (c.k === 'stock') return `<b class="sq-stock">${fmt(v)}</b>`;
    if (c.n) return c.d ? U.fmt(v, true) : `<b>${fmt(v)}</b>`;
    return esc(v == null ? '' : v);
  };
  function tableHtml(a) {
    const cols = (a.def.cols || []).map((k) => C[k]).filter(Boolean);
    const showCh = a.def.ch === 'all' && !a.def.sum;
    if (!a.rows.length) return '<div class="dim" style="padding:14px">Koi agent nahi mila — ya data abhi load ho raha hai (thodi der baad dobara try karo).</div>';
    const head = `<tr><th>#</th>${showCh ? '<th>Ch</th>' : ''}${cols.map((c) => `<th${c.n ? ' class="num"' : ''}>${esc(c.l)}</th>`).join('')}</tr>`;
    const tn = a.def.tone ? ` sq-t-${a.def.tone}` : '';
    const body = a.rows.map((r, i) => `<tr class="sq-row${tn}"><td>${i + 1}</td>${showCh ? `<td><span class="badge ${r.ch === 'GV' ? 'gv' : 'ff'}">${esc(r.ch)}</span></td>` : ''}${cols.map((c) => {
      if (c.k === 'name' && !a.def.sum && r.name) return `<td><a href="#" data-sq-open="${esc(r.name)}"><b>${esc(r.name)}</b></a></td>`;
      return `<td${c.n ? ' class="num"' : ''}>${cell(c, r[c.k], r)}</td>`;
    }).join('')}</tr>`).join('');
    return `<div class="msp-dtable-wrap" style="overflow:auto"><table class="tbl compact sq-tbl"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  }
  function csv(a) {
    const cols = (a.def.cols || []).map((k) => C[k]).filter(Boolean);
    const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    return [['#', 'Ch', ...cols.map((c) => c.l)].map(q).join(','), ...a.rows.map((r, i) => [i + 1, r.ch, ...cols.map((c) => r[c.k])].map(q).join(','))].join('\n');
  }
  // 📊 v3.125.152 — Excel (rangeen header, number column number hi rahen, % growth ▲▼)
  function xlsxSheet(a, title) {
    const cols = (a.def.cols || []).map((k) => C[k]).filter(Boolean);
    const num = (v) => (v === null || v === undefined || v === '' ? '' : Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : v);
    const rows = a.rows.map((r, i) => [i + 1, r.ch || '', ...cols.map((c) => (c.n || c.p ? num(r[c.k]) : (r[c.k] == null ? '' : String(r[c.k]))))]);
    return { name: String(title).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31), header: ['#', 'Ch', ...cols.map((c) => (c.p ? `${c.l} %` : c.l))], rows };
  }

  let panel = null;
  function close() { if (panel && panel.parentNode) panel.parentNode.removeChild(panel); panel = null; document.body.classList.remove('no-scroll'); }
  async function open(id, n) {
    close();
    const d = find(id);
    if (!d) return;
    let mode = n === 'all' ? 'all' : (n || 10); // robot se → 'all' (poori list)
    const baseN = n === 'all' ? 10 : (n || 10);
    const titleOf = () => `${mode === 'all' ? d.title.replace(/^Top /, 'Sab ') : d.n && mode !== 10 ? d.title.replace(/^Top /, `Top ${mode} `) : d.title} · ${CH_LABEL[d.ch]}`;
    const title = titleOf();
    panel = U.h(`<div class="ms-panel" id="sq-panel" role="dialog" aria-modal="true">
      <div class="ms-panel-backdrop" data-sq-close></div>
      <div class="ms-panel-box"><div class="ms-panel-head"><div><span class="ms-panel-kicker">❓ Sawaal · jawab</span><h2 data-sq-title>${esc(title)}</h2><small class="dim" data-sq-state>loading…</small></div>
        <div class="btn-row"><button class="btn small" data-sq-all title="Top ${baseN} ↔ poori list">${mode === 'all' ? `🔝 Top ${baseN}` : '📜 Poori list'}</button><button class="btn small primary" data-sq-xlsx title="Excel (rangeen, numbers ke saath)">⬇ Excel</button><button class="btn small" data-sq-csv>⬇ CSV</button><button class="btn small" data-sq-close>✕ Close</button></div></div>
        <div class="ms-panel-body" data-sq-body></div></div></div>`);
    document.body.appendChild(panel);
    document.body.classList.add('no-scroll');
    const body = panel.querySelector('[data-sq-body]'), state = panel.querySelector('[data-sq-state]');
    let cur = null;
    const paint = () => {
      if (!panel || !panel.isConnected) return;
      cur = answer(id, mode);
      if (!cur) return;
      const top = body.scrollTop;
      state.textContent = `${fmt(cur.rows.length)} result${mode === 'all' ? ' · poori list (scroll karo)' : ''}${cur.def.note ? ' · ' + cur.def.note : ''}`;
      body.innerHTML = tableHtml(cur);
      body.scrollTop = top;
      const h = panel.querySelector('[data-sq-title]'); if (h) h.textContent = titleOf();
      const b = panel.querySelector('[data-sq-all]'); if (b) b.textContent = mode === 'all' ? `🔝 Top ${baseN}` : '📜 Poori list';
    };
    paint();
    // Data abhi aa raha ho to ensure karo, phir dobara paint (instant jab already loaded).
    try {
      const jobs = [];
      if (d.ch !== 'gv' && FF.lazy && FF.lazy.need) jobs.push(FF.lazy.need('performance'));
      if (d.ch !== 'ff' && FF.gv && FF.gv.need) jobs.push(FF.gv.need('report'));
      if (jobs.length) Promise.allSettled(jobs).then(paint);
    } catch { /* paint already shown */ }
    const onData = () => paint();
    document.addEventListener('ff:data-fresh', onData);
    panel.addEventListener('click', (e) => {
      if (e.target.closest('[data-sq-close]')) { document.removeEventListener('ff:data-fresh', onData); close(); return; }
      if (e.target.closest('[data-sq-all]')) { mode = mode === 'all' ? baseN : 'all'; body.scrollTop = 0; paint(); return; }
      if (e.target.closest('[data-sq-xlsx]') && cur) {
        const t = titleOf(), file = `${t.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '')}_${U.stamp ? U.stamp() : Date.now()}.xlsx`;
        if (FF.xlsx && FF.xlsx.download) { FF.xlsx.download(FF.util && FF.util.niceFileName ? FF.util.niceFileName(file) : file, [xlsxSheet(cur, t.split(' · ')[0])]); if (U.toast) U.toast(`Excel download — ${fmt(cur.rows.length)} rows ✓`, 'ok'); }
        return;
      }
      if (e.target.closest('[data-sq-csv]') && cur) {
        const title = titleOf();
        const blob = new Blob(['﻿' + csv(cur)], { type: 'text/csv;charset=utf-8' });
        const aEl = document.createElement('a'); aEl.href = URL.createObjectURL(blob); aEl.download = ((window.FF && FF.util && FF.util.niceFileName) ? FF.util.niceFileName(`${title.replace(/[^\w]+/g, '_')}.csv`) : `${title.replace(/[^\w]+/g, '_')}.csv`); aEl.click();
        setTimeout(() => URL.revokeObjectURL(aEl.href), 4000);
        return;
      }
      const op = e.target.closest('[data-sq-open]');
      if (op) {
        e.preventDefault();
        document.removeEventListener('ff:data-fresh', onData); close();
        try { FF.masterSearch.openSearchPage(op.dataset.sqOpen); } catch { /* ignore */ }
      }
    });
  }

  function openCatalog() {
    close();
    const groups = new Map();
    Q.forEach((d) => { if (!groups.has(d.key)) groups.set(d.key, { d, chs: [] }); groups.get(d.key).chs.push(d); });
    const sect = (label, pred) => {
      const items = [...groups.values()].filter((g) => pred(g.d));
      return items.length ? `<h3 style="margin:14px 0 6px">${label}</h3>${items.map((g) => `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:5px 0;border-bottom:1px solid var(--line,#e5e7eb)"><span style="flex:1 1 220px"><b>${esc(g.d.title)}</b><br><small class="dim">${esc(g.d.note || '')}</small></span>${g.chs.map((c) => `<button class="btn small" data-sq-run="${esc(c.id)}">${CH_LABEL[c.ch]}</button>`).join('')}</div>`).join('')}` : '';
    };
    const html = sect('👤 Agents', (d) => !d.tl && !d.sum) + sect('👥 TLs', (d) => d.tl) + sect('📊 Totals', (d) => d.sum);
    panel = U.h(`<div class="ms-panel" id="sq-panel" role="dialog" aria-modal="true"><div class="ms-panel-backdrop" data-sq-close></div>
      <div class="ms-panel-box"><div class="ms-panel-head"><div><span class="ms-panel-kicker">❓ Sawaal</span><h2>Saare sawaal</h2><small class="dim">Button dabao → turant jawab. Search box me "top 20 vc4 gv" jaisa bhi likh sakte ho.</small></div>
      <div class="btn-row"><button class="btn small" data-sq-close>✕ Close</button></div></div><div class="ms-panel-body">${html}</div></div></div>`);
    document.body.appendChild(panel);
    document.body.classList.add('no-scroll');
    panel.addEventListener('click', (e) => {
      if (e.target.closest('[data-sq-close]')) { close(); return; }
      const b = e.target.closest('[data-sq-run]');
      if (b) open(b.dataset.sqRun, 10);
    });
  }

  FF.smartQ = { suggest, answer, open, openCatalog, close, list: () => Q.map((d) => ({ id: d.id, title: d.title, ch: d.ch })), _rows: { ffRows, gvRows } };
})(window.FF);
