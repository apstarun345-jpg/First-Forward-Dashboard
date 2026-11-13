/* 🧠 v3.125.221 — Gems AI Operations Manager (robot ka dimaag)
 * Detect → Analyze → Recommend → Remind → Measure. Sab kuch site ke ASLI data se:
 *   • agent rows  : FF.smartQ._rows (FF performance agents + GV REPORT) — issuance, stock, run-rate, TL
 *   • daily series: FF.store 'daily' (EIR, class-wise) + FF.gv.issuanceRows() — same-days comparison
 *   • mobiles     : FF.agentMobiles (Agent Details sheet + Address book + requests)
 * Koi operational action apne aap nahi hota — robot sirf sujhata hai, user click kare tab hi kuch khulta hai.
 * Follow-ups / feedback / control-tower counters: browser ka localStorage (har device apna).
 */
(function (FF) {
  'use strict';
  if (!FF || FF.ops) return;
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Math.round(num(n)).toLocaleString('en-IN');
  const r1 = (n) => (Math.round(num(n) * 10) / 10).toLocaleString('en-IN');
  const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);
  const sgn = (p) => (p == null ? '—' : `${p >= 0 ? '▲ +' : '▼ '}${p}%`);
  const NK = (s) => clean(s).toUpperCase();
  const istNow = () => new Date(Date.now() + 5.5 * 3600e3);
  const istToday = () => istNow().toISOString().slice(0, 10);
  const isoOf = (ym, d) => `${ym}-${String(d).padStart(2, '0')}`;
  const prevYm = (ym) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7); };
  const dim = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
  const dLbl = (iso) => { const d = new Date(`${iso}T00:00:00Z`); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : iso; };
  const LS = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage band */ } }
  };
  const K = { seen: 'ffOps.seen', follow: 'ffOps.follow', fb: 'ffOps.fb', tower: 'ffOps.tower', ctx: 'ffOps.ctx' };
  const tower = LS.get(K.tower, {});
  const bump = (k, n) => { tower[k] = num(tower[k]) + (n == null ? 1 : n); LS.set(K.tower, tower); };
  const mark = (k, v) => { tower[k] = v == null ? new Date().toISOString() : v; LS.set(K.tower, tower); };
  const suggestDays = () => num(FF.config && FF.config.features && FF.config.features.suggestDays) || 15;

  // ================================================================ DATA
  const cache = { ag: null, agAt: 0, s: null, sAt: 0 };
  /** Har agent: ch, name, id, tl, direct, cur, last, vc4, vc20, vc5, stock, rate (/din), cover (din), need … */
  function agents() {
    if (cache.ag && Date.now() - cache.agAt < 60e3) return cache.ag;
    const R = FF.smartQ && FF.smartQ._rows;
    if (!R) return [];
    let L = [];
    try { L = [...R.ffRows(), ...R.gvRows()]; } catch { L = []; }
    L = L.filter((a) => a && a.name).map((a) => {
      const rate = num(a.rate), stock = num(a.stock);
      return { ...a, ch: String(a.ch || '').toLowerCase() === 'gv' ? 'gv' : 'ff', key: `${String(a.ch || '').toLowerCase() === 'gv' ? 'gv' : 'ff'}|${NK(a.name)}`,
        tl: clean(a.tl) || (a.direct ? 'Direct' : '—'), rate, stock, cover: rate > 0 ? stock / rate : (stock > 0 ? Infinity : 0) };
    });
    if (L.length) { cache.ag = L; cache.agAt = Date.now(); }
    return L;
  }
  const agentMap = () => { const m = new Map(); agents().forEach((a) => { m.set(a.key, a); if (a.id) m.set(`${a.ch}#${NK(a.id)}`, a); }); return m; };

  /** Daily class-wise series (FF + GV). site: iso → {n, vc4, com}; ag: key → {name, ch, days: Map(iso → {n, vc4, com})} */
  function series() {
    if (cache.s && Date.now() - cache.sAt < 3 * 60e3) return cache.s;
    const ag = new Map(), site = new Map(), chSite = { ff: new Map(), gv: new Map() };
    const add = (m, iso, n, v4) => { const o = m.get(iso) || { n: 0, vc4: 0, com: 0 }; o.n += n; if (v4) o.vc4 += n; else o.com += n; m.set(iso, o); };
    const scan = (rows, ch) => rows.forEach((r) => {
      if (!r || !r.ym || !r.day) return;
      const q = num(r.n); if (!q) return;
      const name = r.agentName || r.agentId; if (!name) return;
      const iso = isoOf(r.ym, r.day), cls = String(r.cls || r.group || '').toUpperCase(), v4 = cls === 'VC4' || /^VC4\b/.test(cls) && !/20/.test(cls);
      const k = `${ch}|${NK(name)}`;
      let o = ag.get(k); if (!o) { o = { name: clean(name), ch, id: clean(r.agentId), days: new Map() }; ag.set(k, o); }
      add(o.days, iso, q, v4); add(site, iso, q, v4); add(chSite[ch], iso, q, v4);
    });
    try { let ff = (FF.store && FF.store.get('daily')) || []; if (FF.filters && FF.filters.dropLaggedFf) ff = FF.filters.dropLaggedFf(ff); scan(ff.filter((r) => r.channel !== 'GV Partner'), 'ff'); } catch { /* data nahi */ }
    try { scan((FF.gv && FF.gv.issuanceRows && FF.gv.issuanceRows()) || [], 'gv'); } catch { /* data nahi */ }
    if (!site.size) return null;
    const last = [...site.keys()].sort().pop();
    cache.s = { ag, site, chSite, last, cur: last.slice(0, 7), prev: prevYm(last.slice(0, 7)), d: Number(last.slice(8, 10)) };
    cache.sAt = Date.now();
    mark('lastScan');
    return cache.s;
  }
  /** days Map ka jodh — month ym, din 1..d */
  function sumWin(days, ym, d) {
    const o = { n: 0, vc4: 0, com: 0, work: 0 };
    for (let i = 1; i <= d; i++) { const v = days.get(isoOf(ym, i)); if (v && v.n) { o.n += v.n; o.vc4 += v.vc4; o.com += v.com; o.work++; } }
    return o;
  }

  // ================================================================ ROOT CAUSE (same days)
  /** scope: {ch?:'ff'|'gv', tl?:string, agentKey?:string}. Is mahine 1..d vs pichhle mahine 1..d (same days). */
  function rootCause(scope) {
    const S = series(); if (!S) return null;
    const sc = scope || {}, A = agentMap();
    const pick = (k, o) => {
      if (sc.agentKey && k !== sc.agentKey) return false;
      if (sc.ch && o.ch !== sc.ch) return false;
      if (sc.tl) { const a = A.get(k); if (!a || NK(a.tl) !== NK(sc.tl)) return false; }
      return true;
    };
    const tot = { cur: { n: 0, vc4: 0, com: 0 }, prev: { n: 0, vc4: 0, com: 0 } };
    let activeCur = 0, activePrev = 0;
    const lost = [], dropped = [];
    const workC = new Set(), workP = new Set();
    for (const [k, o] of S.ag) {
      if (!pick(k, o)) continue;
      const c = sumWin(o.days, S.cur, S.d), p = sumWin(o.days, S.prev, S.d);
      ['n', 'vc4', 'com'].forEach((f) => { tot.cur[f] += c[f]; tot.prev[f] += p[f]; });
      if (c.n > 0) activeCur++; if (p.n > 0) activePrev++;
      for (let i = 1; i <= S.d; i++) { if ((o.days.get(isoOf(S.cur, i)) || {}).n) workC.add(i); if ((o.days.get(isoOf(S.prev, i)) || {}).n) workP.add(i); }
      const a = A.get(k);
      if (p.n > 0 && c.n === 0) lost.push({ name: o.name, ch: o.ch, prev: p.n, stock: a ? a.stock : null, key: k, a });
      else if (p.n >= 20 && c.n < p.n * 0.6) dropped.push({ name: o.name, ch: o.ch, prev: p.n, cur: c.n, stock: a ? a.stock : null, key: k, a });
    }
    if (!tot.cur.n && !tot.prev.n) return null;
    lost.sort((x, y) => y.prev - x.prev); dropped.sort((x, y) => (y.prev - y.cur) - (x.prev - x.cur));
    const lostTags = lost.reduce((s, x) => s + x.prev, 0);
    const stockOut = [...lost, ...dropped].filter((x) => x.stock != null && x.stock <= 0);
    const g = pct(tot.cur.n, tot.prev.n), g4 = pct(tot.cur.vc4, tot.prev.vc4), gc = pct(tot.cur.com, tot.prev.com);
    const lines = [];
    lines.push(`Same ${S.d} din: ${fmt(tot.cur.n)} vs ${fmt(tot.prev.n)} (${sgn(g)})`);
    lines.push(`VC4: ${fmt(tot.cur.vc4)} vs ${fmt(tot.prev.vc4)} (${sgn(g4)}) · Commercial (VC20+VC5+): ${fmt(tot.cur.com)} vs ${fmt(tot.prev.com)} (${sgn(gc)})`);
    lines.push(`Active agents: ${fmt(activeCur)} vs ${fmt(activePrev)} — ${fmt(lost.length)} agent is baar band (pichhle mahine inke ${fmt(lostTags)} tags the)`);
    lines.push(`Kaam ke din: ${workC.size} vs ${workP.size}`);
    if (stockOut.length) lines.push(`Stock ki kami: ${stockOut.length} band / giraawat wale agents ke paas stock 0 hai`);
    // sabse bada kaaran
    const drivers = [];
    if (lostTags > 0 && tot.prev.n > tot.cur.n) drivers.push({ w: lostTags, t: `${lost.length} agents ka band hona (${fmt(lostTags)} tags ka nuksaan)` });
    const dropTags = dropped.reduce((s, x) => s + (x.prev - x.cur), 0);
    if (dropTags > 0) drivers.push({ w: dropTags, t: `${dropped.length} bade agents ki speed giri (${fmt(dropTags)} tags kam)` });
    if (stockOut.length) drivers.push({ w: stockOut.reduce((s, x) => s + x.prev, 0) * 0.5, t: `${stockOut.length} agents ke paas stock nahi` });
    if (workP.size - workC.size >= 2) drivers.push({ w: (workP.size - workC.size) * (tot.prev.n / Math.max(1, workP.size)), t: `${workP.size - workC.size} din kam kaam hua` });
    drivers.sort((a, b) => b.w - a.w);
    // growth badhi ho to kaaran = badhne wale (sabse zyada badhe agents + class)
    if (tot.cur.n >= tot.prev.n) {
      const gain = [];
      for (const [k, o] of S.ag) { if (!pick(k, o)) continue; const c = sumWin(o.days, S.cur, S.d).n, p = sumWin(o.days, S.prev, S.d).n; if (c > p) gain.push({ name: o.name, d: c - p }); }
      gain.sort((x, y) => y.d - x.d);
      const cls = tot.cur.vc4 - tot.prev.vc4 >= tot.cur.com - tot.prev.com ? `VC4 +${fmt(tot.cur.vc4 - tot.prev.vc4)}` : `Commercial +${fmt(tot.cur.com - tot.prev.com)}`;
      drivers.length = 0;
      drivers.push({ w: 1, t: `badhat ${cls}; sabse zyada badhe: ${gain.slice(0, 3).map((x) => `${x.name} (+${fmt(x.d)})`).join(', ')}${lost.length ? ` · dhyan: ${lost.length} agents band (${fmt(lostTags)} tags)` : ''}` });
    }
    return { S, d: S.d, cur: tot.cur, prev: tot.prev, g, g4, gc, activeCur, activePrev, lost, dropped, lostTags, stockOut, workCur: workC.size, workPrev: workP.size, lines, mainCause: drivers[0] ? drivers[0].t : '' };
  }

  // ================================================================ TL INTELLIGENCE
  function tlStats() {
    const S = series(), L = agents(); if (!L.length) return [];
    const by = new Map();
    for (const a of L) {
      const t = a.direct ? 'Direct' : (a.tl && a.tl !== '—' ? a.tl : 'No TL');
      const o = by.get(t) || { tl: t, agents: 0, active: 0, inactive: 0, cur: 0, last: 0, stock: 0, dead: 0, need: 0, low: 0, sdCur: 0, sdPrev: 0, list: [] };
      o.agents++; o.cur += a.cur; o.last += a.last; o.stock += a.stock; o.need += num(a.need); o.list.push(a);
      if (a.cur > 0) o.active++; else { o.inactive++; o.dead += a.stock; }
      if (a.rate >= 1 && a.cover < 5) o.low++;
      if (S) { const s = S.ag.get(a.key); if (s) { o.sdCur += sumWin(s.days, S.cur, S.d).n; o.sdPrev += sumWin(s.days, S.prev, S.d).n; } }
      by.set(t, o);
    }
    return [...by.values()].filter((o) => o.tl !== 'No TL' || o.agents > 2).map((o) => {
      o.growth = pct(o.sdCur, o.sdPrev);
      o.activeRate = o.agents ? Math.round((o.active / o.agents) * 100) : 0;
      // manage score: active %, growth, dead stock kam
      o.score = Math.round(o.activeRate * 0.5 + Math.max(-50, Math.min(50, o.growth || 0)) * 0.6 + (o.stock ? Math.max(0, 30 - (o.dead / o.stock) * 60) : 15));
      const rec = [];
      if (o.inactive >= 3) rec.push(`${o.inactive} inactive agents ko call (dead stock ${fmt(o.dead)})`);
      if (o.low) rec.push(`${o.low} agents ka stock 5 din se kam — dispatch`);
      if (o.growth != null && o.growth <= -20) rec.push(`growth ${o.growth}% — top agents se baat karo`);
      if (o.dead > 300 && o.inactive) rec.push('dead stock active agents ko shift karo');
      o.rec = rec.length ? rec.join(' · ') : 'Sab theek — team ko shabaashi do';
      return o;
    });
  }
  function tlInsights() {
    const T = tlStats().filter((o) => o.tl !== 'Direct' && o.tl !== '—' && o.agents >= 1); if (!T.length) return null;
    const by = (f, dir) => T.slice().sort((a, b) => (dir || -1) * (num(f(a)) - num(f(b))))[0];
    return {
      drop: by((o) => (o.sdPrev >= 50 ? o.growth : 999), 1),
      inactive: by((o) => o.inactive), dead: by((o) => o.dead), dispatch: by((o) => o.need), best: by((o) => o.score), all: T
    };
  }

  // ================================================================ DISPATCH PREDICTOR
  function dispatchPlan() {
    const L = agents(); if (!L.length) return null;
    const sd = suggestDays();
    const r5 = (n) => Math.max(5, Math.ceil(n / 5) * 5);
    const send = [], hold = [], excess = [];
    for (const a of L) {
      if (a.rate >= 0.5) {
        const need = Math.ceil(a.rate * sd - a.stock);
        if (need > 0 && a.cover < sd * 0.6) {
          const tot = Math.max(1, a.vc4 + a.vc20 + a.vc5);
          const parts = [['VC4', a.vc4 / tot], ['VC20', a.vc20 / tot], ['VC5+', a.vc5 / tot]].filter(([, s]) => s >= 0.08).map(([c, s]) => [c, r5(need * s)]);
          send.push({ a, need: r5(need), parts: parts.length ? parts : [['VC4', r5(need)]], urgent: a.cover <= 3, cover: a.cover });
        }
        if (a.cover > 60) excess.push({ a, days: Math.round(a.cover) });
      } else if (a.stock >= 30) {
        (a.cur === 0 ? hold : excess).push({ a, days: a.rate > 0 ? Math.round(a.cover) : null });
      }
    }
    send.sort((x, y) => (y.urgent - x.urgent) || (x.cover - y.cover) || (y.need - x.need));
    hold.sort((x, y) => y.a.stock - x.a.stock); excess.sort((x, y) => y.a.stock - x.a.stock);
    return { sd, send, urgent: send.filter((x) => x.urgent), hold, excess, totalNeed: send.reduce((s, x) => s + x.need, 0) };
  }

  // ================================================================ PREDICTION
  function predict() {
    const S = series(); if (!S) return null;
    const dates = [...S.site.keys()].filter((d) => d.startsWith(S.cur) && d <= S.last).sort();
    const vals = dates.map((d) => S.site.get(d).n);
    const last7 = vals.slice(-7);
    const avg = last7.reduce((s, v) => s + v, 0) / Math.max(1, last7.length);
    const sd = Math.sqrt(last7.reduce((s, v) => s + (v - avg) ** 2, 0) / Math.max(1, last7.length));
    const mtd = vals.reduce((s, v) => s + v, 0), left = dim(S.cur) - S.d;
    const exp = Math.round(mtd + avg * left), band = Math.round(sd * Math.sqrt(Math.max(1, left)) * 1.3);
    const cv = avg ? sd / avg : 1;
    const conf = last7.length >= 7 && cv < 0.25 ? 'High' : last7.length >= 5 && cv < 0.45 ? 'Medium' : 'Low';
    const prevFull = [...S.site.entries()].filter(([d]) => d.startsWith(S.prev)).reduce((s, [, v]) => s + v.n, 0);
    // 7 din me inactive ho sakte hain: is mahine active, pichhle 5 din 0, usse pehle ke 10 din me kaam
    const risk = [];
    const iso = (back) => { const d = new Date(`${S.last}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - back); return d.toISOString().slice(0, 10); };
    const A = agentMap();
    for (const [k, o] of S.ag) {
      let r5 = 0, p10 = 0, act10 = 0;
      for (let i = 0; i < 5; i++) r5 += (o.days.get(iso(i)) || {}).n || 0;
      for (let i = 5; i < 15; i++) { const n = (o.days.get(iso(i)) || {}).n || 0; p10 += n; if (n) act10++; }
      const a = A.get(k);
      if (p10 >= 10 && act10 >= 3 && r5 <= p10 * 0.1) risk.push({ name: o.name, ch: o.ch, p10, r5, a, conf: act10 >= 6 && r5 === 0 ? 'High' : 'Medium' });
    }
    risk.sort((x, y) => y.p10 - x.p10);
    const stockOut = agents().filter((a) => a.rate >= 2 && a.cover <= 7).sort((x, y) => x.cover - y.cover)
      .map((a) => ({ a, days: Math.max(0, Math.floor(a.cover)), conf: a.rate >= 5 ? 'High' : 'Medium' }));
    return { S, mtd, avg, exp, lo: Math.max(mtd, exp - band), hi: exp + band, conf, prevFull, vsPrev: pct(exp, prevFull), left, risk, stockOut };
  }

  // ================================================================ ALERTS (Critical / Warning / Info)
  const SEV = { critical: { lbl: 'Critical', ic: '🚨', mood: 'alert', rank: 3 }, warning: { lbl: 'Warning', ic: '⚠️', mood: 'sad', rank: 2 }, info: { lbl: 'Info', ic: 'ℹ️', mood: 'happy', rank: 1 } };
  function fbMuted(type) { const f = LS.get(K.fb, {})[type]; return !!f && num(f.down) - num(f.up) >= 3; }
  function alertsAll() {
    const L = agents(), S = series(), out = [];
    const push = (x) => { if (!fbMuted(x.type)) out.push(x); };
    for (const a of L) {
      const who = { name: a.name, id: a.id, ch: a.ch, tl: a.tl };
      if (a.stock <= 0 && a.rate >= 1) push({ id: `nostock:${a.key}`, sev: 'critical', type: 'nostock', a: who, ag: a, title: 'Stock khatam', text: `${a.name}: stock 0, roz ~${r1(a.rate)} tags lagta hai — turant dispatch`, act: 'dispatch' });
      else if (a.rate >= 3 && a.cover <= 2) push({ id: `cover:${a.key}`, sev: 'critical', type: 'lowcover', a: who, ag: a, title: 'Stock 2 din ka', text: `${a.name}: stock ${fmt(a.stock)}, roz ~${r1(a.rate)} → ~${Math.max(0, Math.floor(a.cover))} din ka bacha`, act: 'dispatch' });
      else if (a.cur === 0 && a.stock >= 20) push({ id: `dead:${a.key}`, sev: 'warning', type: 'deadstock', a: who, ag: a, title: 'Stock pada, issuance 0', text: `${a.name} ke paas ${fmt(a.stock)} tags, is mahine 0 issuance — call karo`, act: 'call' });
      else if (a.stock >= 100 && a.rate > 0 && a.rate < 1) push({ id: `slow:${a.key}`, sev: 'warning', type: 'lowissue', a: who, ag: a, title: 'Stock zyada, speed kam', text: `${a.name}: ${fmt(a.stock)} stock, roz sirf ${r1(a.rate)} — ${Math.round(a.cover)} din ka maal`, act: 'call' });
    }
    if (S) {
      // achanak bhaari girawat: pichhle 3 din ≪ usse pehle ke 14 din ka average
      // aaj ka din adhoora ho sakta hai → sirf poore din (S.last aaj hai to kal se ginti)
      const off = S.last >= istToday() ? 1 : 0;
      const iso = (back) => { const d = new Date(`${S.last}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - back - off); return d.toISOString().slice(0, 10); };
      const A = agentMap();
      for (const [k, o] of S.ag) {
        let r3 = 0, p14 = 0;
        for (let i = 0; i < 3; i++) r3 += (o.days.get(iso(i)) || {}).n || 0;
        for (let i = 3; i < 17; i++) p14 += (o.days.get(iso(i)) || {}).n || 0;
        const pAvg = p14 / 14, rAvg = r3 / 3;
        if (pAvg >= 4 && rAvg < pAvg * 0.3) {
          const a = A.get(k);
          push({ id: `crash:${k}`, sev: 'critical', type: 'crash', a: { name: o.name, id: o.id || (a && a.id), ch: o.ch, tl: a && a.tl }, ag: a, title: 'Achanak bhaari girawat', text: `${o.name}: pichhle 3 din roz ~${r1(rAvg)}, pehle roz ~${r1(pAvg)} (${Math.round((1 - rAvg / pAvg) * 100)}% neeche)${a && a.stock <= 0 ? ' — stock bhi 0' : ''}`, act: 'call' });
        }
      }
      // data refresh nahi hua
      const ageD = Math.round((Date.parse(istToday()) - Date.parse(S.last)) / 864e5);
      if (ageD >= 2) push({ id: `stale:${S.last}`, sev: 'critical', type: 'stale', title: 'Data purana hai', text: `Issuance data ${dLbl(S.last)} tak hi hai (${ageD} din purana) — sheet refresh / import check karo`, act: 'data' });
      // de-growth (same days)
      for (const x of (rootCause() || { dropped: [] }).dropped.slice(0, 15)) push({ id: `degrow:${x.key}`, sev: 'warning', type: 'degrowth', a: { name: x.name, id: x.a && x.a.id, ch: x.ch, tl: x.a && x.a.tl }, ag: x.a, title: 'Growth giri', text: `${x.name}: same ${S.d} din ${fmt(x.cur)} vs ${fmt(x.prev)} (${sgn(pct(x.cur, x.prev))})`, act: 'call' });
    }
    // info: high growth
    for (const a of L.filter((x) => x.cur >= 50 && x.growth != null && x.growth >= 50).sort((x, y) => y.cur - x.cur).slice(0, 5)) {
      push({ id: `grow:${a.key}`, sev: 'info', type: 'growth', a: { name: a.name, id: a.id, ch: a.ch, tl: a.tl }, ag: a, title: 'Growth star', text: `${a.name}: ${fmt(a.cur)} tags, ${sgn(Math.round(a.growth))} — shabaashi do`, act: 'wa' });
    }
    out.sort((x, y) => SEV[y.sev].rank - SEV[x.sev].rank || num(y.ag && y.ag.rate) - num(x.ag && x.ag.rate));
    // ek agent = ek alert (sabse gambhir wala) — ek hi samasya baar-baar alag naam se na aaye
    const seenAg = new Set();
    return out.filter((x) => { if (!x.a) return true; const k = `${x.a.ch}|${NK(x.a.name)}`; if (seenAg.has(k)) return false; seenAg.add(k); return true; });
  }
  /** Duplicate rokna: jo alert critical 3 ghante / baaki 8 ghante me dikh chuka (same id), dobara nahi.
   *  Chunna (peek) aur "dikh gaya" (commit — robot ne sach me dikhaya) alag — rotation me sirf dekhne se seen nahi hota. */
  function nextAlert(sev) {
    const seen = LS.get(K.seen, {}), now = Date.now();
    for (const x of alertsAll()) {
      if (sev && x.sev !== sev) continue;
      const s = seen[x.id];
      if (s && (num(s.snooze) > now || now - num(s.t) < (x.sev === 'critical' ? 3 : 8) * 3600e3)) continue;
      return x;
    }
    return null;
  }
  function commitAlert(x) {
    const seen = LS.get(K.seen, {}), now = Date.now();
    Object.keys(seen).forEach((k) => { if (now - num(seen[k].t) > 3 * 864e5) delete seen[k]; });
    // jitne same-type alerts abhi bhi chal rahe par pehle dikh chuke — wo roke gaye
    const dup = alertsAll().filter((y) => y.id !== x.id && seen[y.id] && now - num(seen[y.id].t) < 8 * 3600e3).length;
    if (dup) bump('dupPrevented', dup);
    seen[x.id] = { t: now, n: num((seen[x.id] || {}).n) + 1 }; LS.set(K.seen, seen);
    bump('delivered'); bump(`del_${x.sev}`);
  }

  // ================================================================ ACTIONS (sirf user ke click par)
  const mobOf = (a) => { try { return (a && FF.agentMobiles && FF.agentMobiles.of({ id: a.id, name: a.name })) || ''; } catch { return ''; } };
  const waText = (x) => {
    const a = x.ag || {};
    if (x.type === 'growth') return `Namaste ${x.a.name} ji 🙏 Is mahine aapne ${fmt(a.cur)} FASTag lagaye — bahut badhiya! Aise hi aage badhte rahiye. — ApnaPayment`;
    if (x.type === 'nostock' || x.type === 'lowcover') return `Namaste ${x.a.name} ji 🙏 Aapka FASTag stock khatam hone wala hai (abhi ${fmt(a.stock)}). Kitne tags chahiye, class-wise bata dijiye, turant bhej dete hain. — ApnaPayment`;
    return `Namaste ${x.a.name} ji 🙏 Aapke paas ${fmt(a.stock || 0)} FASTag stock hai par is mahine issuance kam hai. Koi dikkat ho to batayein, hum madad karenge. — ApnaPayment`;
  };
  function actionsHtml(x) {
    const id = esc(x.id), m = mobOf(x.a);
    const b = (k, t, ttl) => `<button type="button" class="ops-btn" data-mc="ops:${k}:${id}" title="${esc(ttl || t)}">${t}</button>`;
    const btns = [];
    if (x.a) {
      if (m) btns.push(`<a class="ops-btn" href="tel:${esc(m)}" data-ops-log="call:${id}">📞 ${esc(m)}</a>`);
      btns.push(b('profile', '👤 Profile', 'Agent ki profile kholo'));
      if (m) btns.push(`<a class="ops-btn" target="_blank" rel="noopener" href="https://wa.me/91${esc(String(m).slice(-10))}?text=${encodeURIComponent(waText(x))}" data-ops-log="wa:${id}">💬 WhatsApp</a>`);
      else btns.push(b('copy', '💬 Message copy', 'WhatsApp message copy karo (mobile nahi mila)'));
      btns.push(b('follow', '📌 Follow-up', 'Follow-up banao — kal yaad dilaunga'));
    }
    if (x.act === 'dispatch') btns.push(b('plan', '🚚 Dispatch plan', 'Dispatch Planner kholo'));
    if (x.act === 'data') btns.push(b('fresh', '🕒 Data check', 'Home par data freshness'));
    btns.push(b('up', '👍', 'Useful')); btns.push(b('down', '👎', 'Useful nahi'));
    return `<div class="ops-acts">${btns.join('')}</div>`;
  }
  function itemFor(x) {
    const s = SEV[x.sev];
    return { key: `ops:${x.sev}:${x.id}`, opsId: x.id, mood: s.mood, icon: s.ic, title: `${s.lbl} · ${x.title}`, view: 'html', head: x.text,
      html: `${x.a && x.a.tl && x.a.tl !== '—' ? `<div class="ops-sub">${x.a.ch === 'gv' ? 'GV' : 'FF'} · TL ${esc(x.a.tl)}</div>` : ''}${actionsHtml(x)}`,
      say: x.text.replace(/—/g, ','), stay: x.sev === 'critical' ? 16000 : 12000, text: x.text };
  }
  const byId = new Map();
  function remember(x) { byId.set(x.id, x); if (byId.size > 300) byId.delete(byId.keys().next().value); return x; }

  // ---------------------------------------------------------------- follow-ups (Remind + Measure)
  const follows = () => LS.get(K.follow, []);
  function addFollow(x, action) {
    const L = follows();
    if (L.some((f) => f.alertId === x.id && f.status === 'open')) return L.find((f) => f.alertId === x.id && f.status === 'open');
    const due = new Date(Date.now() + 24 * 3600e3).toISOString();
    const me = (FF.auth && FF.auth.user && (FF.auth.user.name || FF.auth.user.username)) || 'me';
    const f = { id: `f${Date.now().toString(36)}`, alertId: x.id, type: x.type, agent: x.a || null, action: action || x.act || 'call', owner: me, at: new Date().toISOString(), due, status: 'open',
      base: x.ag ? { cur: num(x.ag.cur), stock: num(x.ag.stock), rate: num(x.ag.rate) } : null, note: x.text };
    L.unshift(f); LS.set(K.follow, L.slice(0, 200)); bump('followCreated');
    return f;
  }
  function closeFollow(id) { const L = follows(); const f = L.find((x) => x.id === id); if (f) { f.status = 'done'; f.doneAt = new Date().toISOString(); LS.set(K.follow, L); bump('followDone'); } return f; }
  function measure(f) {
    if (!f || !f.base || !f.agent) return '';
    const a = agents().find((x) => NK(x.name) === NK(f.agent.name) && x.ch === f.agent.ch); if (!a) return '';
    const dCur = a.cur - f.base.cur, dStock = a.stock - f.base.stock;
    return `Follow-up ke baad: +${fmt(Math.max(0, dCur))} tags issue${dStock ? ` · stock ${dStock > 0 ? '+' : ''}${fmt(dStock)}` : ''}${a.rate > f.base.rate ? ` · speed ${r1(f.base.rate)} → ${r1(a.rate)}/din` : ''}`;
  }

  function act(kind, id, btn) {
    const x = byId.get(id);
    const go = (h) => { location.hash = h; };
    const toast = (t) => { try { (FF.util && FF.util.toast) ? FF.util.toast(t) : (FF.ui && FF.ui.toast ? FF.ui.toast(t) : null); } catch { /* ignore */ } if (btn) { btn.textContent = t; btn.disabled = true; } };
    if (kind === 'up' || kind === 'down') {
      const fb = LS.get(K.fb, {}); const t = (x && x.type) || (id === 'dq' ? 'dataquality' : 'other');
      fb[t] = fb[t] || { up: 0, down: 0 }; fb[t][kind] = num(fb[t][kind]) + 1; LS.set(K.fb, fb);
      bump(kind === 'up' ? 'fbUp' : 'fbDown');
      if (kind === 'down' && x) { const seen = LS.get(K.seen, {}); seen[x.id] = { ...(seen[x.id] || {}), t: Date.now(), snooze: Date.now() + 3 * 864e5 }; LS.set(K.seen, seen); }
      return toast(kind === 'up' ? '👍 Shukriya!' : '👎 Theek, ye kam dikhaunga');
    }
    if (!x && !/^(fdone|fsnooze)$/.test(kind)) return toast('Ye alert ab purana hai');
    if (kind === 'profile') { const q = new URLSearchParams({ q: x.a.name, id: x.a.id || '', ch: x.a.ch }); return go(`#/masterSearch?${q}`); }
    if (kind === 'plan') return go('#/dispatchPlan');
    if (kind === 'fresh') return go('#/home');
    if (kind === 'copy') { try { navigator.clipboard.writeText(waText(x)); } catch { /* ignore */ } return toast('📋 Copy ho gaya'); }
    if (kind === 'follow') { const f = addFollow(x); return toast(`📌 Follow-up bana (kal ${new Date(f.due).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })})`); }
    if (kind === 'fdone') { const f = closeFollow(id); return toast(f ? `✅ Ho gaya${measure(f) ? ' · ' + measure(f) : ''}` : 'Mila nahi'); }
    if (kind === 'fsnooze') { const L = follows(); const f = L.find((z) => z.id === id); if (f) { f.due = new Date(Date.now() + 24 * 3600e3).toISOString(); LS.set(K.follow, L); } return toast('⏰ Kal phir yaad dilaunga'); }
    return null;
  }
  document.addEventListener('click', (e) => {
    const l = e.target.closest && e.target.closest('[data-ops-log]'); if (!l) return;
    const [k, id] = String(l.dataset.opsLog).split(/:(.*)/s);
    bump(k === 'call' ? 'calls' : 'whatsapps');
    const x = byId.get(id); if (x && !follows().some((f) => f.alertId === x.id && f.status === 'open')) addFollow(x, k);
  }, true);

  // ================================================================ ROBOT ITEMS (builders)
  const listRows = (L, f) => L.map((z) => f(z));
  function itAlert(sev) { return () => { const x = nextAlert(sev); if (!x) return null; const it = itemFor(remember(x)); it.onShow = () => commitAlert(x); return it; }; }
  function itFollowDue() {
    const now = Date.now(), f = follows().find((z) => z.status === 'open' && Date.parse(z.due) <= now);
    if (!f) return null;
    const m = measure(f);
    return { key: `ops:follow:${f.id}:${istToday()}`, mood: 'alert', icon: '📌', title: 'Follow-up pending', view: 'html',
      head: `${f.agent ? f.agent.name : 'Kaam'} — ${f.action === 'wa' ? 'WhatsApp' : f.action === 'dispatch' ? 'dispatch' : 'call'} (${dLbl(f.at.slice(0, 10))} ko bana). ${m}`,
      html: `<div class="ops-acts"><button type="button" class="ops-btn" data-mc="ops:fdone:${esc(f.id)}">✅ Ho gaya</button><button type="button" class="ops-btn" data-mc="ops:fsnooze:${esc(f.id)}">⏰ Kal yaad dilao</button></div>`,
      say: `${f.agent ? f.agent.name : ''} ka follow-up abhi baaki hai.` };
  }
  function itRootCause() {
    const R = rootCause(); if (!R || R.g == null) return null;
    return { key: `ops:root:${R.S.last}`, mood: R.g < 0 ? 'sad' : 'happy', icon: '🔬', title: `Growth ${sgn(R.g)} — kyun?`, view: 'list', head: R.mainCause ? `${R.g >= 0 ? 'Kyun badhi' : 'Sabse bada kaaran'}: ${R.mainCause}` : R.lines[0],
      rows: R.lines.slice(0, 5).map((t) => ({ name: t, val: '' })),
      say: `इस महीने उतने ही दिनों में ${R.g >= 0 ? 'बढ़त' : 'गिरावट'} ${Math.abs(R.g)} प्रतिशत। ${R.mainCause ? 'सबसे बड़ा कारण: ' + R.mainCause.replace(/\(.*?\)/g, '') : ''}` };
  }
  function itTl() {
    const I = tlInsights(); if (!I) return null;
    const rows = [];
    if (I.drop && I.drop.growth != null && I.drop.growth < 0) rows.push({ name: `📉 Sabse zyada giri: ${I.drop.tl}`, sub: `same din ${sgn(I.drop.growth)} · ${I.drop.rec}`, val: sgn(I.drop.growth), tone: 'down' });
    if (I.inactive && I.inactive.inactive) rows.push({ name: `😴 Sabse zyada inactive: ${I.inactive.tl}`, sub: `${I.inactive.inactive}/${I.inactive.agents} agents band · dead stock ${fmt(I.inactive.dead)}`, val: fmt(I.inactive.inactive), tone: 'down' });
    if (I.dead && I.dead.dead) rows.push({ name: `🪦 Dead stock: ${I.dead.tl}`, sub: `${fmt(I.dead.dead)} tags band agents ke paas`, val: fmt(I.dead.dead), tone: 'warn' });
    if (I.dispatch && I.dispatch.need) rows.push({ name: `🚚 Dispatch chahiye: ${I.dispatch.tl}`, sub: `${fmt(I.dispatch.need)} tags (${I.dispatch.low} agents ka stock < 5 din)`, val: fmt(I.dispatch.need), tone: 'warn' });
    if (I.best) rows.push({ name: `🏅 Best managed: ${I.best.tl}`, sub: `${I.best.activeRate}% active · growth ${sgn(I.best.growth)}`, val: `${I.best.score}`, tone: 'up' });
    if (!rows.length) return null;
    return { key: `ops:tl:${istToday()}:${rows.length}`, mood: 'info', icon: '🧭', title: 'TL intelligence', view: 'list', head: 'TL-wise haal aur kya karna hai', rows, q: 'toptl|all',
      say: `टी एल रिपोर्ट: ${rows[0].name.replace(/^\S+\s/, '')}।` };
  }
  function itDispatch() {
    const P = dispatchPlan(); if (!P || !P.send.length) return null;
    const top = P.send.slice(0, 5);
    return { key: `ops:disp:${istToday()}:${P.urgent.length}`, mood: P.urgent.length ? 'alert' : 'info', icon: '🚚', title: `Aaj dispatch: ${P.send.length} agents`, view: 'list',
      head: `${P.urgent.length} urgent (≤3 din stock) · kul ~${fmt(P.totalNeed)} tags · ${P.hold.length} ko abhi mat bhejo (stock pada) · ${P.excess.length} ke paas zyada stock`,
      rows: top.map((x) => ({ name: x.a.name, sub: `${x.a.ch === 'gv' ? 'GV' : 'FF'} · stock ${fmt(x.a.stock)} · ~${Number.isFinite(x.cover) ? Math.floor(x.cover) : '∞'} din · ${x.parts.map(([c, n]) => `${c} ${n}`).join(' + ')}`, val: fmt(x.need), tone: x.urgent ? 'down' : 'warn' })),
      say: `आज ${P.send.length} एजेंट्स को डिस्पैच चाहिए, ${P.urgent.length} अर्जेंट।`, q: '#/dispatchPlan' };
  }
  function itPredict() {
    const P = predict(); if (!P) return null;
    const rows = [{ name: `Mahine ka end: ~${fmt(P.exp)}`, sub: `range ${fmt(P.lo)}–${fmt(P.hi)} · pichhla mahina ${fmt(P.prevFull)} (${sgn(P.vsPrev)}) · confidence ${P.conf}`, val: P.conf, tone: P.vsPrev >= 0 ? 'up' : 'down' }];
    P.risk.slice(0, 2).forEach((r) => rows.push({ name: `😴 ${r.name} inactive ho sakta`, sub: `pehle 10 din ${fmt(r.p10)} · pichhle 5 din ${fmt(r.r5)} · confidence ${r.conf}`, val: '7 din', tone: 'down' }));
    P.stockOut.slice(0, 2).forEach((s) => rows.push({ name: `⏳ ${s.a.name} ka stock`, sub: `~${s.days} din me khatam (${fmt(s.a.stock)} / roz ${r1(s.a.rate)}) · confidence ${s.conf}`, val: `${s.days} din`, tone: 'warn' }));
    return { key: `ops:pred:${P.S.last}`, mood: 'curious', icon: '🔮', title: 'Aage kya hoga (prediction)', view: 'list', head: `Pichhle 7 din ki speed ~${fmt(P.avg)}/din, ${P.left} din baaki`, rows,
      say: `इस रफ़्तार से महीने के अंत तक लगभग ${fmt(P.exp)} टैग्स, कॉन्फ़िडेंस ${P.conf === 'High' ? 'हाई' : P.conf === 'Medium' ? 'मीडियम' : 'लो'}।` };
  }
  // ---------------------------------------------------------------- morning briefing (roz ek baar, 8 baje ke baad)
  function briefing(force) {
    const S = series(); if (!S) return null;
    const t = istToday();
    if (!force && (istNow().getUTCHours() < 8 || LS.get('ffOps.brief', '') === t)) return null;
    const y = S.site.get(S.last) || { n: 0 };
    const R = rootCause() || {}, P = dispatchPlan() || { urgent: [], send: [] }, crit = alertsAll().filter((x) => x.sev === 'critical');
    const topAg = [...S.ag.values()].map((o) => ({ name: o.name, ch: o.ch, n: (o.days.get(S.last) || {}).n || 0 })).filter((x) => x.n).sort((a, b) => b.n - a.n).slice(0, 5);
    const tls = tlStats().filter((o) => o.tl !== 'Direct').sort((a, b) => b.sdCur - a.sdCur).slice(0, 3);
    const rows = [
      { name: `📅 ${dLbl(S.last)}: ${fmt(y.n)} tags`, sub: `VC4 ${fmt(y.vc4)} · Commercial ${fmt(y.com)}`, val: fmt(y.n), tone: 'up' },
      { name: `📈 MTD same din ${sgn(R.g)}`, sub: `${fmt((R.cur || {}).n)} vs ${fmt((R.prev || {}).n)}`, val: sgn(R.g), tone: R.g >= 0 ? 'up' : 'down' },
      { name: `🏆 Top: ${topAg.map((x) => `${x.name} (${x.n})`).join(', ') || '—'}`, val: '' },
      { name: `👑 Top TL: ${tls.map((o) => `${o.tl} (${fmt(o.sdCur)})`).join(', ') || '—'}`, val: '' },
      { name: `🚚 Dispatch: ${P.send.length} agents (${P.urgent.length} urgent)`, val: fmt(P.send.length), tone: 'warn' },
      { name: `🚨 Critical alerts: ${crit.length}`, sub: crit.slice(0, 2).map((x) => x.text).join(' · '), val: fmt(crit.length), tone: crit.length ? 'down' : 'up' }
    ];
    return { onShow: () => LS.set('ffOps.brief', t), key: `ops:brief:${t}`, mood: 'excited', cls: 'greet', icon: '🗞️', title: 'AI Morning Briefing', view: 'list', head: `Good morning! Kal (${dLbl(S.last)}) ka poora haal`, rows, stay: 20000,
      say: `सुप्रभात! कल ${fmt(y.n)} टैग्स लगे। महीने की ग्रोथ ${R.g == null ? '' : (R.g >= 0 ? 'प्लस ' : 'माइनस ') + Math.abs(R.g) + ' प्रतिशत'}। ${P.urgent.length} एजेंट्स को अर्जेंट डिस्पैच चाहिए और ${crit.length} क्रिटिकल अलर्ट हैं।` };
  }

  // ================================================================ CONTROL TOWER
  function towerData() {
    const S = series(), all = alertsAll(), f = follows();
    const fresh = {};
    if (S) ['ff', 'gv'].forEach((ch) => { const d = [...S.chSite[ch].keys()].sort().pop(); fresh[ch] = d || null; });
    return {
      lastBrain: tower.lastBrain || null, lastScan: tower.lastScan || null, nextScan: tower.nextScan || null,
      pending: { critical: all.filter((x) => x.sev === 'critical').length, warning: all.filter((x) => x.sev === 'warning').length, info: all.filter((x) => x.sev === 'info').length },
      delivered: num(tower.delivered), failed: num(tower.failed), dup: num(tower.dupPrevented), calls: num(tower.calls), was: num(tower.whatsapps),
      fbUp: num(tower.fbUp), fbDown: num(tower.fbDown), follows: { open: f.filter((x) => x.status === 'open').length, overdue: f.filter((x) => x.status === 'open' && Date.parse(x.due) < Date.now()).length, done: f.filter((x) => x.status === 'done').length },
      dq: { at: tower.lastDq || null, n: dq.issues ? dq.issues.length : null, hi: dq.issues ? dq.issues.filter((x) => x.severity === 'high').length : null, err: dq.err },
      fresh, muted: Object.entries(LS.get(K.fb, {})).filter(([, v]) => num(v.down) - num(v.up) >= 3).map(([k]) => k)
    };
  }
  function openTower() {
    const T = towerData();
    const ago = (iso) => { if (!iso) return '—'; const m = Math.round((Date.now() - Date.parse(iso)) / 60e3); return m < 1 ? 'abhi' : m < 60 ? `${m} min pehle` : `${Math.round(m / 60)} ghante pehle`; };
    const fage = (d) => { if (!d) return '<span class="ops-bad">data nahi</span>'; const n = Math.round((Date.parse(istToday()) - Date.parse(d)) / 864e5); return `${dLbl(d)} <span class="${n >= 2 ? 'ops-bad' : 'ops-ok'}">(${n === 0 ? 'aaj' : n + ' din'})</span>`; };
    const row = (k, v) => `<tr><td>${k}</td><td><b>${v}</b></td></tr>`;
    const html = `<div class="ops-tower"><div class="ops-tw-h"><b>🛰 Robot Control Tower</b><button type="button" class="ops-x" data-ops-close>✕</button></div>
      <table>${row('🧠 Last brain run', ago(T.lastBrain))}${row('🔍 Last data scan', ago(T.lastScan))}${row('⏭ Next scan', T.nextScan ? new Date(T.nextScan).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '—')}
      ${row('🚨 Pending alerts', `Critical ${T.pending.critical} · Warning ${T.pending.warning} · Info ${T.pending.info}`)}
      ${row('📣 Delivered (robot ne dikhaye)', fmt(T.delivered))}${row('❌ Failed', fmt(T.failed))}${row('♻️ Duplicate alerts roke', fmt(T.dup))}
      ${row('📞 Calls / 💬 WhatsApp', `${fmt(T.calls)} / ${fmt(T.was)}`)}${row('📌 Follow-ups', `Open ${T.follows.open} · Overdue ${T.follows.overdue} · Done ${T.follows.done}`)}
      ${row('👍 / 👎 Feedback', `${fmt(T.fbUp)} / ${fmt(T.fbDown)}${T.muted.length ? ` · kam dikhaye: ${esc(T.muted.join(', '))}` : ''}`)}
      ${row('🕵️ Data quality scan', T.dq.n == null ? (T.dq.err ? `<span class="ops-bad">${esc(T.dq.err)}</span>` : 'abhi nahi chala') : `${ago(T.dq.at)} · ${T.dq.n} problems (${T.dq.hi} high)`)}${row('🟦 FF data', fage(T.fresh.ff))}${row('🟩 GV data', fage(T.fresh.gv))}</table>
      <div class="ops-tw-f"><button type="button" class="ops-btn" data-ops-run>▶ Abhi scan karo</button><button type="button" class="ops-btn" data-ops-follow>📌 Follow-ups</button><button type="button" class="ops-btn" data-ops-brief>🗞 Briefing</button></div>
      <small>Counters is browser ke hain. Robot koi kaam apne aap nahi karta — sirf sujhaata hai.</small></div>`;
    let ov = document.getElementById('ops-tower');
    if (!ov) { ov = document.createElement('div'); ov.id = 'ops-tower'; ov.className = 'ops-ov'; document.body.appendChild(ov); }
    ov.innerHTML = html; ov.hidden = false;
    ov.onclick = (e) => {
      if (e.target === ov || e.target.closest('[data-ops-close]')) { ov.hidden = true; return; }
      if (e.target.closest('[data-ops-run]')) { cache.ag = null; cache.s = null; run(); openTower(); refreshDq(true).then(() => { if (!ov.hidden) openTower(); }); }
      if (e.target.closest('[data-ops-brief]')) { ov.hidden = true; const it = briefing(true); if (it && FF.mascot && FF.mascot._show) FF.mascot._show(it); }
      if (e.target.closest('[data-ops-follow]')) { ov.hidden = true; showFollowList(); }
    };
  }
  function showFollowList() {
    const L = follows().filter((f) => f.status === 'open').slice(0, 8);
    const it = { key: `ops:flist:${Date.now()}`, fun: true, mood: 'info', icon: '📌', title: `Follow-ups (${L.length} open)`, view: 'html', stay: 20000,
      head: L.length ? 'Jo kaam baaki hain:' : 'Koi follow-up baaki nahi 👍',
      html: L.map((f) => `<div class="ops-fl"><b>${esc(f.agent ? f.agent.name : '—')}</b> <small>${esc(f.action)} · due ${dLbl(f.due.slice(0, 10))}${Date.parse(f.due) < Date.now() ? ' <span class="ops-bad">overdue</span>' : ''}</small><div class="ops-acts"><button type="button" class="ops-btn" data-mc="ops:fdone:${esc(f.id)}">✅ Ho gaya</button><button type="button" class="ops-btn" data-mc="ops:fsnooze:${esc(f.id)}">⏰ Kal</button></div></div>`).join('') };
    if (FF.mascot && FF.mascot._show) FF.mascot._show(it);
  }

  // ================================================================ PAGE TIPS (expansion)
  const PAGE = {
    dispatchPlan() { const P = dispatchPlan(); if (!P) return null; return { key: `dp:${P.urgent.length}:${P.send.length}`, icon: '🚚', title: 'Dispatch Planner', mood: P.urgent.length ? 'alert' : 'info', head: `${P.urgent.length} agents ko URGENT dispatch (≤3 din stock), kul ${P.send.length} agents ~${fmt(P.totalNeed)} tags. ${P.hold.length} ko abhi mat bhejo — stock pada hai, issuance 0.` }; },
    stock() { const L = agents(); const dead = L.filter((a) => a.cur === 0 && a.stock > 0); const ds = dead.reduce((s, a) => s + a.stock, 0); return ds ? { key: `st:${dead.length}:${ds}`, icon: '📦', title: 'Stock', mood: 'curious', head: `${fmt(ds)} tags ${dead.length} aise agents ke paas pade hain jinki is mahine issuance 0 hai — inhe call karo ya stock shift karo.` } : null; },
    gvStock() { return PAGE.stock(); },
    stockReport() { return PAGE.stock(); },
    gvStockReport() { return PAGE.stock(); },
    tlScorecard() { const I = tlInsights(); return I && I.best ? { key: `tls:${I.best.tl}`, icon: '🧭', title: 'TL Scorecard', mood: 'info', head: `Best managed: ${I.best.tl} (${I.best.activeRate}% active). Sabse zyada inactive: ${I.inactive ? I.inactive.tl + ' (' + I.inactive.inactive + ')' : '—'}. Dead stock: ${I.dead ? I.dead.tl + ' ' + fmt(I.dead.dead) : '—'}.` } : null; },
    performance() { const R = rootCause({ ch: 'ff' }); return R ? { key: `pf:${R.S.last}`, icon: '🔬', title: 'FF Performance', mood: R.g < 0 ? 'sad' : 'happy', head: `FF same ${R.d} din ${sgn(R.g)}. ${R.mainCause ? 'Kaaran: ' + R.mainCause : ''}` } : null; },
    gvPerformance() { const R = rootCause({ ch: 'gv' }); return R ? { key: `gpf:${R.S.last}`, icon: '🔬', title: 'GV Performance', mood: R.g < 0 ? 'sad' : 'happy', head: `GV same ${R.d} din ${sgn(R.g)}. ${R.mainCause ? 'Kaaran: ' + R.mainCause : ''}` } : null; },
    barcodeChecker() { return { key: `bc:${istToday()}`, icon: '🔢', title: 'Barcode Checker', mood: 'curious', head: 'Range daalo (pehla → aakhri barcode) — har barcode ka status: issued / stock / Not Assigned. Dispatch ke baad "Not Assigned" zaroor check karo.' }; },
    fastagMapping() { return { key: `fm:${istToday()}`, icon: '🗺️', title: 'FASTag Mapping', mood: 'curious', head: 'Mapping sheet ka data purana ho to pehle refresh karo — galat TL mapping se TL report galat aati hai.' }; },
    complaints() { return { key: `cp:${istToday()}`, icon: '📮', title: 'Complaints', mood: 'curious', head: 'Jis agent ki complaint zyada hai uski issuance bhi check karo — aksar wahi agents inactive hote hain.' }; },
    bulkTagStatus() { return { key: `ts:${istToday()}`, icon: '🏷️', title: 'Tag Status', mood: 'curious', head: 'Bahut saare VRN / Tag ID / barcode ek saath paste karo — sabka status ek list me.' }; }
  };
  PAGE.ffAgentSummary = PAGE.tlScorecard; PAGE.gvAgentSummary = PAGE.tlScorecard; delete PAGE.tlScorecard;
  PAGE.dataQuality = () => { const D = dq.issues; if (!D) return null; const hi = D.filter((x) => x.severity === 'high'); return { key: `dq:${D.length}:${hi.length}`, icon: '🕵️', title: 'Data Quality', mood: hi.length ? 'alert' : 'happy', head: D.length ? `${D.length} data problems mile (${hi.length} high). Sabse bada: ${D[0].title} — ${fmt(D[0].count)} rows.` : 'Saare data checks pass ✅' }; };

  // ================================================================ CONVERSATION CONTEXT (memory)
  const ctx = LS.get(K.ctx, {});
  function rememberAgent(a) { if (!a || !a.name) return; ctx.agent = { name: a.name, id: a.id || '', ch: a.ch || '' }; ctx.at = Date.now(); LS.set(K.ctx, ctx); }
  /** "isko kitna bhejna chahiye", "stock kitna hai" — naam nahi hai to pichhla agent */
  function contextAnswer(q) {
    const t = ` ${String(q || '').toLowerCase()} `;
    const A = agents(); if (!A.length) return null;
    // naam mila? → yaad rakho
    const hit = A.filter((a) => a.name.length >= 4 && t.includes(` ${a.name.toLowerCase()} `)).sort((x, y) => y.name.length - x.name.length)[0];
    let a = hit;
    const pron = /\b(isko|isse|iska|iski|iske|usko|uska|uski|uske|ise|use|unka|inka|inko|unko)\b/.test(t) || /^\s*(stock|kitna|kitne|bhejna|dispatch|growth|mobile|number|call)\b/.test(t.trim());
    if (!a && pron && ctx.agent && Date.now() - num(ctx.at) < 30 * 60e3) a = A.find((x) => NK(x.name) === NK(ctx.agent.name) && (!ctx.agent.ch || x.ch === ctx.agent.ch));
    if (!a) return null;
    rememberAgent(a);
    const base = { key: `ans:${Date.now()}`, fun: true, mood: 'info', stay: 16000, icon: '🧠' };
    if (/(bhej|dispatch|kitna chahiye|kitne chahiye|recommend)/.test(t)) {
      const P = dispatchPlan(); const x = P && P.send.find((s) => s.a.key === a.key);
      if (x) return { ...base, title: `${a.name} — dispatch`, view: 'text', head: `${x.parts.map(([c, n]) => `${c} ${n}`).join(' + ')} = ${fmt(x.need)} tags bhejne ki salah (stock ${fmt(a.stock)}, roz ~${r1(a.rate)}, ${suggestDays()} din ke hisaab se).`, say: `${a.name} को ${fmt(x.need)} टैग्स भेजने की सलाह है।` };
      const h = P && (P.hold.find((s) => s.a.key === a.key) || P.excess.find((s) => s.a.key === a.key));
      return { ...base, title: `${a.name} — dispatch`, view: 'text', head: h ? `Abhi mat bhejo — stock ${fmt(a.stock)} pada hai (roz ~${r1(a.rate)}).` : `Abhi zaroorat nahi — stock ${fmt(a.stock)} ~${Number.isFinite(a.cover) ? Math.floor(a.cover) : '∞'} din chalega.`, say: 'अभी भेजने की ज़रूरत नहीं है।' };
    }
    if (/(stock|maal)/.test(t)) return { ...base, title: `${a.name} — stock`, view: 'text', head: `${fmt(a.stock)} tags stock · roz ~${r1(a.rate)} → ~${Number.isFinite(a.cover) ? Math.floor(a.cover) : '∞'} din ka.`, say: `${a.name} के पास ${fmt(a.stock)} टैग्स हैं।` };
    if (/(mobile|number|call|phone)/.test(t)) { const m = mobOf(a); return { ...base, title: `${a.name} — mobile`, view: 'text', head: m ? `📞 ${m}` : 'Mobile nahi mila (Address tab / Agent Details me nahi).', say: m ? `नंबर है ${m.split('').join(' ')}` : 'नंबर नहीं मिला।' }; }
    if (/(growth|kyu|kyon|kyun|kaaran|reason)/.test(t)) { const R = rootCause({ agentKey: a.key }); if (R) return { ...base, title: `${a.name} — kyun?`, view: 'list', head: R.lines[0], rows: R.lines.slice(1, 4).map((x) => ({ name: x, val: '' })), say: R.lines[0] }; }
    if (/(issu|tag|kitne lage|performance)/.test(t)) return { ...base, title: `${a.name} — issuance`, view: 'text', head: `Is mahine ${fmt(a.cur)} tags (pichhla mahina ${fmt(a.last)}) · VC4 ${fmt(a.vc4)} · VC20 ${fmt(a.vc20)} · VC5+ ${fmt(a.vc5)} · TL ${a.tl}.`, say: `${a.name} ने इस महीने ${fmt(a.cur)} टैग्स किए।` };
    return null;
  }

  // ================================================================ DATA QUALITY (Anomaly Detective ke checks robot me)
  const dq = { at: 0, issues: null, busy: false, err: '' };
  async function refreshDq(force) {
    if (dq.busy || (!force && dq.issues && Date.now() - dq.at < 60 * 60e3)) return dq;
    dq.busy = true;
    try {
      if (!FF.insights && FF.lazy && FF.lazy.inject) await FF.lazy.inject('insights');
      if (!FF.insights || !FF.insights.qualityIssues) throw new Error('insights module nahi');
      const r = await FF.insights.qualityIssues();
      dq.issues = (r && r.issues) || []; dq.at = Date.now(); dq.err = ''; mark('lastDq');
    } catch (e) { dq.err = String(e && e.message || e).slice(0, 120); bump('failed'); }
    finally { dq.busy = false; }
    return dq;
  }
  function itDataQuality() {
    const D = dq.issues; if (!D || !D.length) return null;
    const seen = LS.get('ffOps.dqSeen', {});
    const x = D.find((i) => !seen[`${i.title}:${i.count}`] || Date.now() - seen[`${i.title}:${i.count}`] > 864e5);
    if (!x) { bump('dupPrevented'); return null; }
    return { onShow: () => { seen[`${x.title}:${x.count}`] = Date.now(); LS.set('ffOps.dqSeen', seen); bump('delivered'); }, key: `ops:dq:${x.title}:${x.count}`,
      mood: x.severity === 'high' ? 'alert' : 'curious', icon: '🕵️', title: `Data galti · ${x.severity === 'high' ? 'Critical' : x.severity === 'medium' ? 'Warning' : 'Info'}`, view: 'html',
      head: `${x.title} — ${fmt(x.count)} rows (${x.source || x.category})`,
      html: `<div class="ops-sub">${esc((x.samples || []).slice(0, 4).join(' · '))}${x.sampleTotal > 4 ? ' …' : ''}</div>${x.action ? `<div class="ops-sub">👉 ${esc(x.action)}</div>` : ''}<div class="ops-acts"><a class="ops-btn" href="#/dataQuality">🔎 Affected rows dekho</a><button type="button" class="ops-btn" data-mc="ops:up:dq">👍</button><button type="button" class="ops-btn" data-mc="ops:down:dq">👎</button></div>`,
      say: `डेटा में गलती: ${x.title}, ${fmt(x.count)} रोज़।` };
  }

  // ================================================================ RUN + robot se jodna
  let started = false;
  function run() {
    try { series(); agents(); mark('lastBrain'); mark('nextScan', new Date(Date.now() + 10 * 60e3).toISOString()); } catch { bump('failed'); }
  }
  function attach() {
    const M = FF.mascot;
    if (!M || !M.addBuilder) return false;
    if (started) return true;
    started = true;
    const safe = (fn) => () => { try { return fn(); } catch { bump('failed'); return null; } };
    [itFollowDue, itAlert('critical'), itAlert('warning'), itDataQuality, itDispatch, itRootCause, itTl, itPredict, itAlert('info')].forEach((fn) => M.addBuilder(safe(fn)));
    // 🗞 morning briefing: queue me sabse aage (din me ek baar, 8 baje ke baad)
    const brief = () => { try { const it = briefing(); if (it && M.push) M.push(it); } catch { bump('failed'); } };
    setTimeout(brief, 25e3); setInterval(brief, 15 * 60e3);
    // 🕵️ data quality — page load ke 2 min baad (idle me), phir har ghante
    const dqRun = () => { (window.requestIdleCallback || setTimeout)(() => refreshDq(), 3000); };
    setTimeout(dqRun, 120e3); setInterval(dqRun, 60 * 60e3);
    if (M.addPageTips) M.addPageTips(PAGE);
    if (M.addContext) M.addContext(contextAnswer);
    run(); setInterval(run, 10 * 60e3);
    return true;
  }

  FF.ops = { item: (x) => itemFor(remember(x)), commitAlert, refreshDq, dataQuality: () => dq, agents, series, rootCause, tlStats, tlInsights, dispatchPlan, predict, alerts: alertsAll, nextAlert, briefing, tower: towerData, openTower, follows, showFollowList, act, contextAnswer, rememberAgent, pageTips: PAGE, attach };
  if (!attach()) { const t = setInterval(() => { if (attach()) clearInterval(t); }, 2000); setTimeout(() => clearInterval(t), 120e3); }
})(window.FF);
