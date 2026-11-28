/* 🧠 AI Business Analyst (v3.125.599 — naya, table-first) — sirf TL aur Direct agents dikhte hain, TL ke agents kabhi alag nahi.
   • TL ka number = TL ka khud ka kaam + uski poori team ka total (issuance, stock, replacement/chassis/wrong VRN). Direct agent alag.
   • Tables: Growth / De-growth / High de-growth · Quality (replacement, chassis, wrong VRN) · Inactive 7+ din (poora group ruka ho) · Stock jyada, issuance kam.
   • FF = EIR (master ID ≠ 5845036) · GV = GV Master sheet — dono kabhi mix nahi hote. Basis: current month ka run-rate vs pichhla poora mahina. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, M = FF.model, S = FF.store, G = FF.gv, C = FF.charts;
  const esc = U.esc;
  const clean = (v) => U.clean(v);
  const norm = (v) => clean(v).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const fmt = (n) => U.fmt(Math.round(Number(n) || 0));
  const sgn = (n) => (Math.round(n) > 0 ? '+' : Math.round(n) < 0 ? '−' : '') + fmt(Math.abs(n));
  const pct = (a, b) => (b > 0 ? ((a - b) / b) * 100 : null);
  const pctTxt = (p) => (p === null ? 'new' : (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p).toFixed(0) + '%');
  const tone = (n) => (n > 0.5 ? 'up' : n < -0.5 ? 'down' : 'flat');
  const GV_ID = () => clean((FF.config.eir && FF.config.eir.gvMasterId) || '5845036');
  const CH = { ff: { label: 'First Forward', short: 'FF', icon: '🟦', color: '#6366f1' }, gv: { label: 'GV Partner', short: 'GV', icon: '🟩', color: '#0d9488' } };
  const healthOf = (g) => (g === null ? ['Naya', 'flat'] : g >= 5 ? ['Growing', 'up'] : g <= -5 ? ['Declining', 'down'] : ['Stable', 'flat']);

  // ---------------------------------------------------------------- analysis core
  function peopleFromFf(agents, cur, last, isFfRow, m2, m3) {
    const map = new Map();
    (agents || []).filter((r) => isFfRow(r) && (r.ym === cur || r.ym === last || r.ym === m2 || r.ym === m3)).forEach((r) => {
      const key = clean(r.id) ? 'I' + norm(r.id) : 'N' + norm(r.name);
      if (!map.has(key)) map.set(key, { key, name: r.name, id: clean(r.id), tl: '', cur: 0, last: 0, m2: 0, m3: 0, tlCurN: 0 });
      const o = map.get(key);
      if (r.ym === cur) { o.cur += r.n; if (r.n >= o.tlCurN) { o.tlCurN = r.n; o.tl = r.tlName; } } else if (r.ym === last) { o.last += r.n; if (!o.tl) o.tl = r.tlName; } else { if (r.ym === m2) o.m2 += r.n; else o.m3 += r.n; if (!o.tl) o.tl = r.tlName; }
    });
    return [...map.values()].map((o) => ({ ...o, direct: FF.config.isDirectAgent ? !!FF.config.isDirectAgent({ tlName: o.tl, name: o.name, agentName: o.name }, 'ff') : false }));
  }
  function drivers(people, day, dimCur) {
    const rows = people.map((p) => {
      const proj = day ? (p.cur / day) * dimCur : p.cur;
      const delta = proj - p.last;
      const kind = p.cur === 0 && p.last > 0 ? 'lost' : p.last === 0 && p.cur > 0 ? 'new' : 'regular';
      return { ...p, proj, delta, kind, growth: pct(proj, p.last) };
    });
    return { rows, net: rows.reduce((s, r) => s + r.delta, 0),
      up: rows.filter((r) => r.delta > 0.5).sort((a, b) => b.delta - a.delta),
      down: rows.filter((r) => r.delta < -0.5).sort((a, b) => a.delta - b.delta),
      lost: rows.filter((r) => r.kind === 'lost').sort((a, b) => b.last - a.last),
      fresh: rows.filter((r) => r.kind === 'new').sort((a, b) => b.cur - a.cur) };
  }
  function tlRoll(rows) {
    const map = new Map();
    rows.forEach((r) => {
      if (r.direct) return;
      const k = clean(r.tl) || 'Unknown TL';
      if (!map.has(k)) map.set(k, { name: k, cur: 0, last: 0, proj: 0, delta: 0, agents: 0, active: 0, stock: 0, idleN: 0, idleStock: 0, members: [] });
      const t = map.get(k); t.cur += r.cur; t.last += r.last; t.proj += r.proj; t.delta += r.delta; t.agents++; if (r.cur > 0) t.active++; t.stock += r.stock || 0; if (r.risk === 'zero' || r.risk === 'inactive') { t.idleN++; t.idleStock += r.stock || 0; } t.members.push(r);
    });
    return [...map.values()].map((t) => ({ ...t, growth: pct(t.proj, t.last) }));
  }
  function concentration(rows, total) {
    const sorted = rows.filter((r) => r.cur > 0).sort((a, b) => b.cur - a.cur);
    const top5 = sorted.slice(0, 5).reduce((s, r) => s + r.cur, 0);
    let run = 0, n80 = 0; for (const r of sorted) { run += r.cur; n80++; if (run >= total * 0.8) break; }
    return { top5Share: total ? (top5 / total) * 100 : 0, n80, active: sorted.length, sorted };
  }
  function momentum(lastTotals, curTotals, day) {
    const series = [...(lastTotals || []), ...(curTotals || []).slice(0, day)];
    const a = series.slice(-7), b = series.slice(-14, -7);
    const s = (x) => x.reduce((t, v) => t + (v || 0), 0);
    return { week: s(a), prev: s(b), growth: pct(s(a), s(b)), hasPrev: b.length >= 7 };
  }


  // ---- stock / inactive-days (Performance watchlist se — Telegram report jaisa wahi source) ----
  const isOwn = (r) => /apna\s*pay/i.test(String(r.n || r.name || '')) || clean(r.id) === '5845036';
  async function watchOf(ch) {
    const job = (async () => {
      if (ch === 'ff') {
        await FF.lazy.ensure('performance'); await FF.pages.performance.ensureLoaded();
        if (FF.pages.performance.agents) FF.pages.performance.agents();
        return FF.perfWatch.prepRows('ff', FF.pages.performance.watchRows());
      }
      if (!(FF.gv && FF.gv.enabled && FF.gv.enabled())) return [];
      await FF.lazy.ensure('gvPerformance'); await FF.gv.need('report');
      return FF.perfWatch.prepRows('gv', FF.pages.gvPerformance.watchRows());
    })();
    try { return await Promise.race([job, new Promise((res) => setTimeout(() => res(null), 25000))]); } catch { return null; }
  }
  /** v3.125.601 — jo naam kisi aur ke TL ke roop me aata hai wo TL hai (direct nahi): "TL = khud" ya TL ID khaali wali rows ko direct na gino. */
  function promoteTls(people) {
    const names = new Set();
    people.forEach((p) => { if (!p.direct && clean(p.tl) && norm(p.tl) !== norm(p.name)) names.add(norm(p.tl)); });
    people.forEach((p) => { if (p.direct && names.has(norm(p.name))) { p.direct = false; p.tl = p.name; p.promoted = true; } });
  }
  /** people + watch rows → stock / inactive days / dormant (stock hai par pichhle 2 mahine kuch nahi) */
  function enrich(people, watch) {
    if (!watch) return { people, hasStock: false };
    const byId = new Map(), byName = new Map(), used = new Set();
    watch.forEach((w) => { if (isOwn(w)) return; if (clean(w.id)) byId.set(norm(w.id), w); if (!byName.has(norm(w.n))) byName.set(norm(w.n), w); });
    const out = people.filter((p) => !isOwn(p)).map((p) => {
      const w = (clean(p.id) && byId.get(norm(p.id))) || byName.get(norm(p.name));
      if (w) used.add(w);
      return { ...p, stock: w ? w.stock : 0, inact: w ? w.inact : (p.cur > 0 ? 0 : 99), wpri: w ? w.pri : '' };
    });
    watch.forEach((w) => {
      if (used.has(w) || isOwn(w) || !(w.stock > 0)) return;
      out.push({ key: 'W' + norm(w.id || w.n), name: w.n, id: clean(w.id), tl: w.tl || '', cur: 0, last: 0, direct: !!w.direct, stock: w.stock, inact: 99, wpri: w.pri, dormant: true });
    });
    return { people: out, hasStock: true };
  }
  /** risk: stock hai par kaam nahi — zero (is mahine 0) / inactive (7+ din) / down (proj ≥30% kam) */
  function riskOf(r, enabled) {
    if (!enabled || !(r.stock > 0)) return '';
    if (r.cur === 0) return 'zero';
    if (r.inact >= 7 && r.inact < 99) return 'inactive';
    if (r.last > 0 && r.delta <= -5 && r.proj <= r.last * 0.7) return 'down';
    return '';
  }
  const RISK_TXT = { zero: 'Is mahine 0', inactive: '7+ din inactive', down: 'Kaafi down' };
  const riskTxt = (r) => (r.risk === 'inactive' ? `${r.inact} din inactive` : r.risk === 'down' ? `Down ${Math.abs(Math.round(r.growth || 0))}%` : r.dormant ? 'Koi issuance nahi' : RISK_TXT[r.risk] || '');
  function stockViews(rows, day, enabled) {
    rows.forEach((r) => { r.risk = riskOf(r, enabled); });
    const sum = (l) => l.reduce((t, r) => t + (r.stock || 0), 0);
    const idle = rows.filter((r) => r.risk === 'zero' || r.risk === 'inactive').sort((a, b) => b.stock - a.stock);
    const down = rows.filter((r) => r.risk === 'down').sort((a, b) => b.stock - a.stock);
    const need = enabled ? rows.filter((r) => r.cur >= 3 && r.inact < 7 && (r.stock / Math.max(0.1, r.cur / Math.max(1, day))) < 7).map((r) => ({ ...r, cover: r.stock / Math.max(0.1, r.cur / Math.max(1, day)) })).sort((a, b) => b.cur - a.cur) : [];
    const stockAll = sum(rows);
    return { idle, down, need, idleStock: sum(idle), downStock: sum(down), stockAll, idleShare: stockAll ? (sum(idle) / stockAll) * 100 : 0 };
  }
  function segStats(rows) {
    const act = rows.filter((r) => r.cur > 0);
    return { n: rows.length, active: act.length, cur: rows.reduce((t, r) => t + r.cur, 0), last: rows.reduce((t, r) => t + r.last, 0), proj: rows.reduce((t, r) => t + r.proj, 0), stock: rows.reduce((t, r) => t + (r.stock || 0), 0), idleN: rows.filter((r) => r.risk === 'zero' || r.risk === 'inactive').length, idleStock: rows.filter((r) => r.risk === 'zero' || r.risk === 'inactive').reduce((t, r) => t + r.stock, 0), rows };
  }

  // ---- GV Master based aggregation (GV ka har number seedha GV Master rows se — EIR se nahi) ----
  const gvRows = () => { try { return (G.rows && G.rows()) || []; } catch { return []; } };
  const isDirectGv = (r) => r.directAgent === true || (FF.config.isDirectAgent ? !!FF.config.isDirectAgent(r, 'gv') : false);
  function gvMasterIndex() {
    const rows = gvRows(), byYm = new Map(); let latest = null;
    rows.forEach((r) => { if (!r.ym) return; if (!byYm.has(r.ym)) byYm.set(r.ym, []); byYm.get(r.ym).push(r); const d = r.date || r.d; if (d && (!latest || d > latest)) latest = d; });
    return { byYm, latest, months: [...byYm.keys()].sort() };
  }
  function gvSummary(idx, ym, upTo) {
    const s = { ym, total: 0, vc4: 0, vc20: 0, vc5p: 0, comm: 0, replacement: 0, wrongVrn: 0, days: new Set() };
    (idx.byYm.get(ym) || []).forEach((r) => {
      if (upTo && r.day > upTo) return;
      s.total++; if (r.group === 'VC4') s.vc4++; else if (r.group === 'VC20') s.vc20++; else s.vc5p++;
      if (/replacement/i.test(r.status || '')) s.replacement++;
      if (r.day) s.days.add(r.day);
    });
    s.comm = s.vc20 + s.vc5p; s.activeDays = s.days.size; s.avgPerDay = s.activeDays ? s.total / s.activeDays : 0;
    return s;
  }
  function gvSeries(idx, ym) {
    const n = U.daysInMonth(ym), t = new Array(n).fill(0);
    (idx.byYm.get(ym) || []).forEach((r) => { if (r.day) t[r.day - 1]++; });
    return t;
  }
  function gvPeople(idx, cur, last, m2, m3) {
    const map = new Map();
    const add = (ym, f) => (idx.byYm.get(ym) || []).forEach((r) => {
      const id = clean(r.agentId), key = id ? 'I' + norm(id) : 'N' + norm(r.agentName);
      if (!map.has(key)) map.set(key, { key, name: r.agentName, id, tl: r.tlName || '', cur: 0, last: 0, m2: 0, m3: 0, direct: false, directAll: true });
      const o = map.get(key); o[f]++; if (!isDirectGv(r)) o.directAll = false; if (r.tlName && (f === 'cur' || !o.tl)) o.tl = r.tlName;
    });
    add(cur, 'cur'); add(last, 'last'); add(m2, 'm2'); add(m3, 'm3');
    return [...map.values()].map((o) => ({ ...o, direct: o.directAll }));
  }

  async function analyse(monthParam, segParam) {
    const seg = segParam === 'tl' || segParam === 'direct' ? segParam : 'all';
    const [dailyR, agentsR, stockR, masterR, gvStockR, ffWatchR, gvWatchR] = await Promise.allSettled([S.need('daily'), S.need('agents'), S.need('stock'), G.need('master'), G.need('stockClass'), watchOf('ff'), watchOf('gv')]);
    const watchRes = { ff: ffWatchR.status === 'fulfilled' ? ffWatchR.value : null, gv: gvWatchR.status === 'fulfilled' ? gvWatchR.value : null };
    const out = { errors: [], gvId: GV_ID(), seg };
    const dailyAll = dailyR.status === 'fulfilled' ? dailyR.value : null;
    // FF = EIR me master ID 5845036 ke ALAWA har row (blank ID bhi FF); GV master-ID wali EIR rows FF me kabhi nahi.
    const gvIdNorm = out.gvId.replace(/\.0+$/, '');
    const isFfRow = (r) => (r.masterId !== undefined ? clean(r.masterId).replace(/\.0+$/, '') !== gvIdNorm : r.channel !== 'GV Partner');
    const eirOnly = dailyAll ? (M.eirOnlyDaily ? M.eirOnlyDaily(dailyAll) : dailyAll) : null;
    const ffDaily = dailyAll ? dailyAll.filter(isFfRow) : null;
    if (!dailyAll) out.errors.push('First Forward EIR data load nahi hua');
    if (masterR.status !== 'fulfilled') out.errors.push('GV Master data load nahi hua');
    const gvOk = masterR.status === 'fulfilled';
    const agents = agentsR.status === 'fulfilled' ? agentsR.value : [];
    const gvIdx = gvOk ? gvMasterIndex() : { byYm: new Map(), latest: null, months: [] };
    out.gvMonths = gvIdx.months;
    const ffLatest = ffDaily ? M.latestDate(ffDaily) : null, gvLatest = gvIdx.latest;
    out.ffLatest = ffLatest; out.gvLatest = gvLatest;
    const latest = ffLatest && gvLatest ? (ffLatest > gvLatest ? ffLatest : gvLatest) : (ffLatest || gvLatest);
    if (!latest) return { ...out, empty: true };
    const latestYM = U.ymKey(latest);
    out.months = U.uniq([...(ffDaily ? M.months(ffDaily) : []), ...gvIdx.months]).sort();
    out.cur = out.months.includes(monthParam) ? monthParam : latestYM;
    out.isCurrent = out.cur === latestYM;
    out.last = U.prevMonthKey(out.cur);
    out.m2 = U.prevMonthKey(out.last); out.m3 = U.prevMonthKey(out.m2);
    out.dimCur = U.daysInMonth(out.cur); out.dimLast = U.daysInMonth(out.last);
    out.day = out.isCurrent ? latest.getDate() : out.dimCur;
    out.latest = latest;
    out.channels = {};
    // 🧪 v3.125.599 — quality (replacement / chassis / wrong VRN) har agent par: FF = EIR daily rows, GV = GV Master rows
    const qKey = (id, name) => (clean(id) ? 'I' + norm(id) : 'N' + norm(name));
    const qualMap = { ff: new Map(), gv: new Map() };
    const qAdd = (m, k, f, n) => { let o = m.get(k); if (!o) m.set(k, o = { repl: 0, chassis: 0, wrong: 0 }); o[f] += n; };
    if (ffDaily) ffDaily.forEach((r) => {
      if (r.ym !== out.cur) return; const k = qKey(r.agentId, r.agentName);
      if (r.type === 'REPLACEMENT') qAdd(qualMap.ff, k, 'repl', r.n);
      if (/chassis/i.test(r.vrnType || '')) qAdd(qualMap.ff, k, 'chassis', r.n);
      if (/wrong/i.test(r.vrnType || '')) qAdd(qualMap.ff, k, 'wrong', r.n);
    });
    if (gvOk) (gvIdx.byYm.get(out.cur) || []).forEach((r) => {
      const k = qKey(r.agentId, r.agentName), vt = (FF.config.vrnStatus ? FF.config.vrnStatus(r.vrn) : '') || r.tagType || '';
      if (/replacement/i.test(r.status || '')) qAdd(qualMap.gv, k, 'repl', 1);
      if (/chassis/i.test(vt)) qAdd(qualMap.gv, k, 'chassis', 1);
      if (/wrong/i.test(vt)) qAdd(qualMap.gv, k, 'wrong', 1);
    });
    // 📅 weekday pattern: har agent ke last ~3 mahine (cur, last, m2) ke tags weekday-wise (0=Sun..6=Sat)
    const wdMap = { ff: new Map(), gv: new Map() };
    const wdAdd = (m, k, date) => { if (!date || !date.getDay) return; let o = m.get(k); if (!o) m.set(k, o = [0, 0, 0, 0, 0, 0, 0]); o[date.getDay()]++; };
    const wdAddN = (m, k, date, n) => { if (!date || !date.getDay) return; let o = m.get(k); if (!o) m.set(k, o = [0, 0, 0, 0, 0, 0, 0]); o[date.getDay()] += n; };
    const wdMonths = new Set([out.cur, out.last, out.m2]);
    if (ffDaily) ffDaily.forEach((r) => { if (wdMonths.has(r.ym)) wdAddN(wdMap.ff, qKey(r.agentId, r.agentName), r.d || r.date, r.n); });
    if (gvOk) wdMonths.forEach((ym) => (gvIdx.byYm.get(ym) || []).forEach((r) => wdAdd(wdMap.gv, qKey(r.agentId, r.agentName), r.date)));
    const wdOcc = (chLatest) => {
      const n = [0, 0, 0, 0, 0, 0, 0]; if (!chLatest) return n;
      [out.m2, out.last, out.cur].forEach((ym) => {
        const [y, m] = ym.split('-').map(Number); const lim = U.ymKey(chLatest) === ym ? chLatest.getDate() : (ym > U.ymKey(chLatest) ? 0 : U.daysInMonth(ym));
        for (let d = 1; d <= lim; d++) n[new Date(y, m - 1, d).getDay()]++;
      });
      return n;
    };
    const stockRows = { ff: stockR.status === 'fulfilled' ? stockR.value : [], gv: gvStockR.status === 'fulfilled' ? gvStockR.value : [] };
    const build = (ch) => {
      const isFf = ch === 'ff';
      if (isFf ? !ffDaily : !gvOk) return null;
      // har channel ka apna "data tak" din — FF EIR ek din late aa sakta hai, uski wajah se FF ki projection na giray
      const chLatest = isFf ? ffLatest : gvLatest;
      const day = chLatest && U.ymKey(chLatest) === out.cur ? chLatest.getDate() : (out.isCurrent && chLatest && U.ymKey(chLatest) < out.cur ? 0 : out.day);
      const sum = (ym, d) => (isFf ? M.summary(ffDaily, ym, d) : gvSummary(gvIdx, ym, d));
      const cur = sum(out.cur), last = sum(out.last), lastMtd = day ? sum(out.last, day) : last;
      const people0 = isFf ? peopleFromFf(agents, out.cur, out.last, isFfRow, out.m2, out.m3) : gvPeople(gvIdx, out.cur, out.last, out.m2, out.m3);
      const en = enrich(people0, watchRes[ch]);
      promoteTls(en.people);
      const dd = day || out.day;
      const dAll = drivers(en.people, dd, out.dimCur);
      dAll.rows.forEach((r) => { const q = qualMap[ch].get(r.key) || qualMap[ch].get(qKey(r.id, r.name)) || {}; r.repl = q.repl || 0; r.chassis = q.chassis || 0; r.wrong = q.wrong || 0; r.wd = wdMap[ch].get(r.key) || wdMap[ch].get(qKey(r.id, r.name)) || null; });
      const stockOn = en.hasStock && out.isCurrent;
      const sv = stockViews(dAll.rows, dd, stockOn);
      const split = { tl: segStats(dAll.rows.filter((r) => !r.direct)), direct: segStats(dAll.rows.filter((r) => r.direct)) };
      const inSeg = (r) => seg === 'all' || (seg === 'direct' ? r.direct : !r.direct);
      const d = seg === 'all' ? dAll : drivers(dAll.rows.filter(inSeg), dd, out.dimCur);
      const sw = seg === 'all' ? sv : stockViews(d.rows, dd, stockOn);
      let curS = cur, lastS = last, lastMtdS = lastMtd;
      if (seg !== 'all') {
        const ss = segStats(d.rows);
        curS = { ...cur, total: ss.cur, activeDays: cur.activeDays }; lastS = { ...last, total: ss.last }; lastMtdS = { ...lastMtd, total: 0 };
      }
      const proj = seg !== 'all' ? (out.isCurrent ? d.rows.reduce((t, r) => t + r.proj, 0) : curS.total) : (out.isCurrent ? (day ? (cur.total / day) * out.dimCur : cur.total) : cur.total);
      const ser = (ym) => { try { return isFf ? (M.dailySeries(ffDaily, ym).totals || []) : gvSeries(gvIdx, ym); } catch { return []; } };
      const curSeries = seg === 'all' ? ser(out.cur).slice(0, day || out.day) : [], lastSeries = seg === 'all' ? ser(out.last) : [];
      while (curSeries.length > 1 && !curSeries[curSeries.length - 1]) curSeries.pop();
      const mo = seg === 'all' ? momentum(lastSeries, curSeries, day || out.day) : { week: 0, prev: 0, growth: null, hasPrev: false };
      const avg = curS.activeDays ? curS.total / curS.activeDays : 0;
      const stock = seg === 'all' ? U.sum(stockRows[ch], (r) => r.n) : (stockOn ? sw.stockAll : 0);
      const mon = out.months.slice(-6).map((ym) => { const x = sum(ym); return { ym, total: x.total, vc4: x.vc4, vc20: x.vc20, vc5p: x.vc5p, comm: x.comm, repl: x.replacement, wrong: x.wrongVrn }; });
      const whole = seg === 'all';
      return { ch, seg, day, latest: chLatest, source: isFf ? 'EIR' : 'GV Master', cur: curS, last: lastS, lastMtd: lastMtdS, proj, projGrowth: lastS.total ? pct(proj, lastS.total) : null, mtdGrowth: whole ? pct(cur.total, lastMtd.total) : null, d,
        tls: tlRoll(d.rows), conc: concentration(d.rows, curS.total), mo, curSeries, lastSeries, stock, stockRows: stockRows[ch], cover: avg ? stock / avg : 0, avg, mon, noLast: !lastS.total,
        hasStock: stockOn, sv: sw, split, whole, wdN: wdOcc(chLatest),
        vc4Share: whole && cur.total ? (cur.vc4 / cur.total) * 100 : 0, vc4ShareLast: whole && last.total ? (last.vc4 / last.total) * 100 : 0,
        replShare: cur.total ? (cur.replacement / cur.total) * 100 : 0, wrongShare: whole && cur.total ? (cur.wrongVrn / cur.total) * 100 : 0 };
    };
    out.channels.ff = build('ff'); out.channels.gv = build('gv');
    // EIR hisaab: total = master ID 5845036 wali rows + baaki (FF) — sirf proof ke liye
    try { if (eirOnly) { let t = 0, g = 0, f = 0; eirOnly.forEach((r) => { if (r.ym !== out.cur) return; t += r.n; if (isFfRow(r)) f += r.n; else g += r.n; }); out.eir = { total: t, ff: f, gvId: g }; } } catch { /* ignore */ }
    // EIR reconciliation: poore EIR ledger me master-ID ke hisaab se FF/GV split (sirf proof ke liye)
    return out;
  }

  // ---------------------------------------------------------------- v3.125.599 — nayi Analyst: sirf TL aur Direct agents, sab table me
  // TL = TL ka khud ka kaam + uski team ka total (agents alag se kabhi nahi dikhte). Direct agent = apna.
  // Inactive = TL ke poore group (TL + agents) me 7+ din koi issuance nahi — ek agent inactive ho to TL inactive nahi gina jaata.
  const DEG = -5, HIGH = -30, GROW = 5, COVER_HIGH = 30, MIN_STOCK = 10;
  const ST = {
    growth: { label: 'Growth', icon: '🟢', rank: 6 }, new: { label: 'Naya', icon: '✨', rank: 7 }, stable: { label: 'Stable', icon: '🔵', rank: 5 },
    degrowth: { label: 'De-growth', icon: '🟠', rank: 4 }, high: { label: 'High de-growth', icon: '🔴', rank: 3 },
    inact1: { label: 'Is mahine inactive', icon: '⏸️', rank: 2 }, inact2: { label: 'Inactive 2 mahine', icon: '💤', rank: 1 }, inact3: { label: 'Inactive 3 mahine', icon: '🪦', rank: 0 }
  };
  function statusOf(cur, last, proj, m2, m3) {
    if (!cur) { if (last > 0) return { k: 'inact1', g: -100 }; if (m2 > 0) return { k: 'inact2', g: null }; if (m3 > 0) return { k: 'inact3', g: null }; return { k: 'stable', g: null }; }
    if (!last) return { k: 'new', g: null };
    const g = pct(proj, last);
    return { k: g >= GROW ? 'growth' : g > DEG ? 'stable' : g > HIGH ? 'degrowth' : 'high', g };
  }
  function mkEntity(ch, type, name, id, rows, c) {
    const sum = (f) => rows.reduce((t, r) => t + (Number(r[f]) || 0), 0);
    const cur = sum('cur'), last = sum('last'), proj = sum('proj'), stock = sum('stock'), m2 = sum('m2'), m3 = sum('m3');
    const inacts = rows.map((r) => r.inact).filter((x) => x !== undefined && x !== null);
    const inact = c.hasStock && inacts.length ? Math.min(...inacts) : null;
    const st = statusOf(cur, last, proj, m2, m3), day = Math.max(1, c.day || 1);
    const avg = cur / day, cover = avg > 0 ? stock / avg : (stock > 0 ? Infinity : 0);
    const wd = [0, 0, 0, 0, 0, 0, 0]; rows.forEach((r) => { if (r.wd) for (let i = 0; i < 7; i++) wd[i] += r.wd[i]; });
    if (type === 'tl') { const own = rows.find((r) => norm(r.name) === norm(name)); id = own ? own.id : ''; }
    return { ch, type, name, id, wd, wdN: c.wdN || [1, 1, 1, 1, 1, 1, 1], agents: type === 'tl' ? rows.filter((r) => r.cur > 0 || r.last > 0 || r.stock > 0).length : 1, cur, last, m2, m3, proj, delta: proj - last, g: st.g, st: st.k,
      stock, inact, avg, cover, repl: sum('repl'), chassis: sum('chassis'), wrong: sum('wrong'), day: c.day, hasStock: !!c.hasStock };
  }
  function entitiesOf(a) {
    const out = [];
    ['gv', 'ff'].forEach((ch) => {
      const c = a.channels[ch]; if (!c) return;
      const groups = new Map();
      c.d.rows.forEach((r) => {
        if (r.direct) { out.push(mkEntity(ch, 'direct', r.name, r.id, [r], c)); return; }
        const k = clean(r.tl) || 'Unknown TL'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r);
      });
      groups.forEach((rows, k) => out.push(mkEntity(ch, 'tl', k, '', rows, c)));
    });
    return out.filter((e) => e.cur > 0 || e.last > 0 || e.m2 > 0 || e.m3 > 0 || e.stock > 0);
  }

  let AX = { key: '', a: null, at: 0 };
  const UIKEY = 'ff-ax-ui-v2';
  const defUi = () => ({ old: false, ch: 'all', seg: 'all', q: '', gst: 'all', t: { g: { sort: 'proj', dir: 'desc' }, q: { sort: 'wrong', dir: 'desc' }, i: { sort: 'stock', dir: 'desc' }, s: { sort: 'stock', dir: 'desc' }, w: { sort: 'tot', dir: 'desc' } } });
  function loadUi() {
    const u = defUi();
    try {
      const s = JSON.parse(localStorage.getItem(UIKEY) || '{}');
      if (['gv', 'ff'].includes(s.ch)) u.ch = s.ch; if (['tl', 'direct'].includes(s.seg)) u.seg = s.seg;
      if (typeof s.q === 'string') u.q = s.q.slice(0, 60); if (typeof s.gst === 'string' && (s.gst === 'all' || ST[s.gst])) u.gst = s.gst; u.old = s.old === true;
      ['g', 'q', 'i', 's', 'w'].forEach((k) => { const t = s.t && s.t[k]; if (t && typeof t.sort === 'string') u.t[k] = { sort: t.sort.slice(0, 12), dir: t.dir === 'asc' ? 'asc' : 'desc', all: t.all === true }; });
    } catch { /* default */ }
    return u;
  }
  const saveUi = (u) => { try { localStorage.setItem(UIKEY, JSON.stringify({ ch: u.ch, seg: u.seg, q: u.q, gst: u.gst, old: u.old, t: u.t })); } catch { /* optional */ } };
  function scroller(el) {
    try { for (let n = el; n && n !== document.body; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n; } } catch { /* ignore */ }
    return document.scrollingElement || document.documentElement;
  }
  // 📞 mobile (sirf admin / 'contacts' permission) — Agent Details sheet + Address book se; TL ka bhi (naam / ID se)
  const canMob = () => { try { return !!(FF.auth && (FF.auth.isAdmin() || FF.auth.can('contacts'))); } catch { return false; } };
  function mobOf(e) {
    if (!canMob()) return '';
    let m = '';
    try { if (FF.masterProfile && FF.masterProfile.mobileFor) m = FF.masterProfile.mobileFor(e.name, e.id, '') || ''; } catch { /* optional */ }
    if (!m) try { m = (FF.agentMobiles && FF.agentMobiles.of && FF.agentMobiles.of({ id: e.id, name: e.name })) || ''; } catch { /* optional */ }
    m = clean(m); return /^na$/i.test(m) ? '' : m;
  }
  const mobCell = (e) => { const m = mobOf(e); return m ? `<a class="ax-mob" href="tel:${esc(m)}" title="Call ${esc(e.name)}">📞 ${esc(m)}</a>` : '<span class="dim">—</span>'; };
  const C_MOB = () => (canMob() ? [{ k: 'mob', h: '📞 Mobile', t: (e) => mobOf(e), c: (e) => mobCell(e), cls: 'c' }] : []);
  const TBL = {};   // har table ka poora (filtered + sorted) data CSV ke liye
  const WD = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
  const wdAvg = (e, d) => (e.wdN[d] ? e.wd[d] / e.wdN[d] : 0);
  const plain = (html) => { try { const t = document.createElement('div'); t.innerHTML = html; return (t.textContent || '').replace(/\s+/g, ' ').trim(); } catch { return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); } };
  function csvTable(id) {
    const t = TBL[id]; if (!t) return;
    const cols = t.cols.filter((c) => c.k !== '#');
    const head = ['Channel', 'Type', ...cols.map((c) => plain(c.h))];
    const rows = t.rows.map((e) => [e.ch.toUpperCase(), e.type === 'tl' ? 'TL' : 'Direct', ...cols.map((c) => (c.t ? c.t(e, t.ctx) : plain(c.c(e, t.ctx))))]);
    U.downloadCsv(`ai-analyst-${t.name}-${U.stamp()}.csv`, head, rows);
  }
  const cnt0 = (arr, k) => arr.filter((e) => e.st === k).length;
  const badge = (e) => `<span class="ax-b ${e.ch}">${e.ch === 'gv' ? 'GV' : 'FF'}</span><span class="ax-b ${e.type}">${e.type === 'tl' ? 'TL' : 'Direct'}</span>`;
  const nameCell = (e) => `<button type="button" class="ax-name" data-drill="${esc(e.name)}">${esc(e.name)}</button>${badge(e)}`;
  const stChip = (k) => `<span class="ax-chip ${k}">${ST[k].icon} ${ST[k].label}</span>`;
  const gTxt = (e) => (e.g === null ? (e.st === 'new' ? 'new' : '—') : (e.g > 0 ? '+' : e.g < 0 ? '−' : '') + Math.abs(e.g).toFixed(0) + '%');
  const bar = (v, max, cls) => `<span class="ax-bar ${cls || ''}"><i style="width:${Math.max(0, Math.min(100, max ? (v / max) * 100 : 0)).toFixed(0)}%"></i></span>`;
  const inactTxt = (d) => (d === null ? '—' : d >= 99 ? '60+ din' : d + ' din');
  const coverTxt = (c) => (c === Infinity ? '∞ (issuance 0)' : c >= 365 ? '365+ din' : c.toFixed(0) + ' din');
  const pctOf = (n, t) => (t ? ((n / t) * 100).toFixed(1) + '%' : '0%');

  // ---- generic table: columns [{k, h, v(e) value for sort, c(e,ctx) cell html, cls}]
  function tableHtml(id, cols, rows, st, ctx, limit) {
    const sorted = rows.slice();
    const sc = cols.find((c) => c.k === st.sort) || cols.find((c) => c.v);
    if (sc && sc.v) { const dir = st.dir === 'asc' ? 1 : -1; sorted.sort((x, y) => { const a = sc.v(x), b = sc.v(y); return (a === b ? 0 : a > b ? 1 : -1) * dir || (y.cur - x.cur); }); }
    TBL[id] = { cols, rows: sorted, ctx, name: ({ g: 'growth', q: 'quality', i: 'inactive', s: 'stock', w: 'weekday' })[id] || id };
    const shown = st.all ? sorted : sorted.slice(0, limit || 15);
    const head = cols.map((c) => `<th class="${c.cls || ''} ${c.v ? 'ax-sortable' : ''} ${sc && sc.k === c.k ? 'on ' + (st.dir === 'asc' ? 'asc' : 'desc') : ''}" ${c.v ? `data-sort="${id}|${c.k}"` : ''}>${c.h}</th>`).join('');
    const body = shown.map((e, i) => `<tr>${cols.map((c) => `<td class="${c.cls || ''}">${c.k === '#' ? i + 1 : c.c(e, ctx)}</td>`).join('')}</tr>`).join('');
    const more = sorted.length > (limit || 15) ? `<button type="button" class="ax-more" data-more="${id}">${st.all ? '▲ Kam dikhao' : `▼ Sab ${sorted.length} dikhao`}</button>` : '';
    return `<div class="ax-scroll"><table class="ax-table"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${cols.length}" class="ax-empty">Is filter me koi nahi 🎉</td></tr>`}</tbody></table></div>${more}`;
  }
  const C_NAME = { k: 'name', h: 'Naam', v: (e) => e.name.toLowerCase(), t: (e) => e.name, c: (e) => nameCell(e), cls: 'l' };
  const C_NUM = (k, h, f, extra) => ({ k, h, v: f, c: (e) => fmt(f(e)), cls: 'r', ...(extra || {}) });

  function sections(a, ent, ui) {
    const chs = ui.ch === 'all' ? ['gv', 'ff'] : [ui.ch];
    let list = ent.filter((e) => chs.includes(e.ch) && (ui.seg === 'all' || e.type === ui.seg));
    const q = norm(ui.q); if (q) list = list.filter((e) => norm(e.name).includes(q));
    const hasStockAll = chs.some((ch) => a.channels[ch] && a.channels[ch].hasStock);
    const maxCur = Math.max(1, ...list.map((e) => e.cur));
    const cnt = (k) => act.filter((e) => e.st === k).length;
    const tot = (f) => list.reduce((t, e) => t + f(e), 0);
    const act = list.filter((e) => e.cur > 0 || e.last > 0 || e.m2 > 0 || e.m3 > 0);   // pichhle 4 mahine me kabhi kaam kiya (sirf stock wale dormant alag)
    const inactN = cnt0(act, 'inact1') + cnt0(act, 'inact2') + cnt0(act, 'inact3');
    const inactiveL = hasStockAll ? list.filter((e) => e.inact !== null && e.inact >= 7 && (ui.old || e.inact < 99)) : [];
    const stockL = hasStockAll ? list.filter((e) => e.stock >= MIN_STOCK && e.cover >= COVER_HIGH) : [];
    const kpis = [
      ['k1', '📈', 'Is mahine (projection)', fmt(tot((e) => e.proj)), `pichhla mahina ${fmt(tot((e) => e.last))} · ${(() => { const g = pct(tot((e) => e.proj), tot((e) => e.last)); return g === null ? 'new' : (g >= 0 ? '+' : '−') + Math.abs(g).toFixed(0) + '%'; })()}`],
      ['k2', '🟢', 'Growth', cnt('growth') + cnt('new'), 'TL / Direct badh rahe'],
      ['k3', '🟠', 'De-growth', cnt('degrowth'), '5% se 30% tak gire'],
      ['k4', '🔴', 'High de-growth', cnt('high'), '30%+ gire (abhi chal rahe)'],
      ['k7', '⏸️', 'Issuance band (0)', inactN, `is mahine ${cnt('inact1')} · 2 mahine ${cnt('inact2')} · 3 mahine ${cnt('inact3')}`],
      ['k5', '🕒', 'Inactive 7+ din', hasStockAll ? inactiveL.length : '—', hasStockAll ? 'poora group ruka hua' : 'sirf current month'],
      ['k6', '📦', 'Stock jyada, issuance kam', hasStockAll ? stockL.length : '—', hasStockAll ? `${fmt(stockL.reduce((t, e) => t + e.stock, 0))} tags phase hue` : 'stock data nahi']
    ];
    const kHtml = `<div class="ax-kpis">${kpis.map(([c, i, t, v, s]) => `<div class="ax-kpi ${c}"><div class="ax-kpi-i">${i}</div><div><small>${t}</small><b>${v}</b><em>${s}</em></div></div>`).join('')}</div>`;

    // 1) Growth
    const gSt = ui.gst || 'all';
    const gList = act.filter((e) => gSt === 'all' || e.st === gSt || (gSt === 'growth' && e.st === 'new'));
    const gChips = [['all', 'Sab', act.length], ['growth', '🟢 Growth', cnt('growth') + cnt('new')], ['stable', '🔵 Stable', cnt('stable')], ['degrowth', '🟠 De-growth', cnt('degrowth')], ['high', '🔴 High de-growth', cnt('high')], ['inact1', '⏸️ Inactive — is mahine', cnt('inact1')], ['inact2', '💤 Inactive 2 mahine', cnt('inact2')], ['inact3', '🪦 Inactive 3 mahine', cnt('inact3')]]
      .map(([k, l, n]) => `<button type="button" class="ax-fchip ${gSt === k ? 'on' : ''}" data-gst="${k}">${l} <b>${n}</b></button>`).join('');
    const gCols = [{ k: '#', h: '#', cls: 'c' }, C_NAME, ...C_MOB(), { k: 'agents', h: 'Agents', v: (e) => e.agents, c: (e) => (e.type === 'tl' ? e.agents : '—'), cls: 'r' },
      C_NUM('m3', U.labelYM(a.m3), (e) => e.m3), C_NUM('m2', U.labelYM(a.m2), (e) => e.m2), C_NUM('last', 'Pichhla mahina', (e) => e.last), C_NUM('cur', 'Ab tak', (e) => e.cur), { k: 'proj', h: 'Projection', v: (e) => e.proj, c: (e) => `<b>${fmt(e.proj)}</b>`, cls: 'r' },
      { k: 'delta', h: 'Farak', v: (e) => e.delta, c: (e) => `<span class="ax-d ${tone(e.delta)}">${sgn(e.delta)}</span>`, cls: 'r' },
      { k: 'g', h: 'Growth %', v: (e) => (e.g === null ? (e.st === 'new' ? 1e6 : 0) : e.g), c: (e) => `<span class="ax-gcell ${e.st}">${gTxt(e)}</span>`, cls: 'r' },
      { k: 'st', h: 'Status', v: (e) => ST[e.st].rank, c: (e) => stChip(e.st), cls: 'c' }];
    const s1 = `<section class="ax-sec s-growth"><header><button type="button" class="ax-csvb" data-csv="g">⬇ CSV</button><h3>📈 Growth · De-growth</h3><p>TL = TL + uski poori team ka total · Direct agent alag · "Inactive" = jinka issuance 0 hai (is mahine / 2 / 3 mahine se)</p></header><div class="ax-filters">${gChips}</div>${tableHtml('g', gCols, gList, ui.t.g, null, 20)}</section>`;

    // 2) Quality
    const qMax = (f) => Math.max(1, ...list.map(f));
    const mxR = qMax((e) => e.repl), mxC = qMax((e) => e.chassis), mxW = qMax((e) => e.wrong);
    const qCell = (e, f, mx, cls) => `<div class="ax-qc"><b>${fmt(f(e))}</b><em>${pctOf(f(e), e.cur)}</em>${bar(f(e), mx, cls)}</div>`;
    const qCols = [{ k: '#', h: '#', cls: 'c' }, C_NAME, ...C_MOB(), C_NUM('cur', 'Total tags', (e) => e.cur),
      { k: 'repl', h: '♻️ Replacement', v: (e) => e.repl, c: (e) => qCell(e, (x) => x.repl, mxR, 'amber'), cls: 'q' },
      { k: 'chassis', h: '🚗 Chassis', v: (e) => e.chassis, c: (e) => qCell(e, (x) => x.chassis, mxC, 'violet'), cls: 'q' },
      { k: 'wrong', h: '❌ Wrong VRN', v: (e) => e.wrong, c: (e) => qCell(e, (x) => x.wrong, mxW, 'rose'), cls: 'q' }];
    const qL = list.filter((e) => e.cur > 0);
    const qPick = [['repl', '♻️ Replacement'], ['chassis', '🚗 Chassis'], ['wrong', '❌ Wrong VRN']].map(([k, l]) => `<button type="button" class="ax-fchip ${ui.t.q.sort === k ? 'on' : ''}" data-qsort="${k}">${l} ↓</button>`).join('');
    const s2 = `<section class="ax-sec s-quality"><header><button type="button" class="ax-csvb" data-csv="q">⬇ CSV</button><h3>🧪 Quality — kiske Replacement · Chassis · Wrong VRN jyada</h3><p>Is mahine ke tags me se (count + % of total)</p></header><div class="ax-filters">${qPick}</div>${tableHtml('q', qCols, qL, ui.t.q, null, 15)}</section>`;

    // 3) Inactive
    const iCols = [{ k: '#', h: '#', cls: 'c' }, C_NAME, ...C_MOB(), { k: 'agents', h: 'Agents', v: (e) => e.agents, c: (e) => (e.type === 'tl' ? e.agents : '—'), cls: 'r' },
      { k: 'inact', h: 'Inactive', v: (e) => e.inact, c: (e) => `<span class="ax-days ${e.inact >= 30 ? 'hot' : e.inact >= 14 ? 'warm' : ''}">${inactTxt(e.inact)}</span>`, cls: 'c' },
      C_NUM('stock', '📦 Stock', (e) => e.stock), C_NUM('last', 'Pichhla mahina', (e) => e.last), C_NUM('cur', 'Is mahine', (e) => e.cur)];
    const s3 = `<section class="ax-sec s-inactive"><header><button type="button" class="ax-csvb" data-csv="i">⬇ CSV</button><h3>⏸️ Inactive — 7+ din se koi issuance nahi</h3><p>Poora group (TL + uske agents) ruka ho tabhi gina jaata hai · pichhle 2 mahine me jo chal rahe the</p></header>${hasStockAll ? `<div class="ax-filters"><button type="button" class="ax-fchip ${ui.old ? 'on' : ''}" data-old="1">60+ din purane (dormant) bhi dikhao</button></div>` : ''}${hasStockAll ? tableHtml('i', iCols, inactiveL, ui.t.i, null, 15) : '<div class="ax-note">Inactive din sirf current month me aur stock data load hone par dikhte hain.</div>'}</section>`;

    // 4) Stock vs issuance
    const mxS = Math.max(1, ...stockL.map((e) => e.stock));
    const sCols = [{ k: '#', h: '#', cls: 'c' }, C_NAME, ...C_MOB(),
      { k: 'stock', h: '📦 Stock', v: (e) => e.stock, c: (e) => `<div class="ax-qc"><b>${fmt(e.stock)}</b>${bar(e.stock, mxS, 'amber')}</div>`, cls: 'q' },
      C_NUM('cur', 'Is mahine issuance', (e) => e.cur), { k: 'avg', h: 'Roz ka average', v: (e) => e.avg, c: (e) => e.avg.toFixed(1), cls: 'r' },
      { k: 'cover', h: 'Stock kitne din ka', v: (e) => (e.cover === Infinity ? 1e9 : e.cover), c: (e) => `<span class="ax-days ${e.cover >= 90 ? 'hot' : 'warm'}">${coverTxt(e.cover)}</span>`, cls: 'c' },
      { k: 'inact', h: 'Inactive', v: (e) => (e.inact === null ? -1 : e.inact), c: (e) => inactTxt(e.inact), cls: 'c' }];
    const s4 = `<section class="ax-sec s-stock"><header><button type="button" class="ax-csvb" data-csv="s">⬇ CSV</button><h3>📦 Stock jyada · issuance kam</h3><p>Stock ${COVER_HIGH}+ din ka (roz ke average se) · kam se kam ${MIN_STOCK} tags ka stock — stock hai par kaam nahi</p></header>${hasStockAll ? tableHtml('s', sCols, stockL, ui.t.s, null, 15) : '<div class="ax-note">Stock data load nahi hua.</div>'}</section>`;
    // 5) Weekday pattern — kis din kitne tags (roz ka average, pichhle ~3 mahine)
    const wL = act.filter((e) => e.wd.some((x) => x > 0));
    const tAvg = WD.map(([d]) => wL.reduce((t, e) => t + wdAvg(e, d), 0));
    const tMax = Math.max(1, ...tAvg), tMean = tAvg.reduce((x, y) => x + y, 0) / 7 || 1;
    const bestI = tAvg.indexOf(Math.max(...tAvg)), weakI = tAvg.indexOf(Math.min(...tAvg));
    const wCards = `<div class="ax-wd">${WD.map(([d, l], i) => `<div class="ax-wd-c ${i === bestI ? 'best' : i === weakI ? 'weak' : ''}"><small>${l}</small><b>${fmt(tAvg[i])}</b><em>${tAvg[i] >= tMean ? '+' : '−'}${Math.abs(((tAvg[i] - tMean) / tMean) * 100).toFixed(0)}% vs avg</em><span class="ax-wd-bar"><i style="height:${((tAvg[i] / tMax) * 100).toFixed(0)}%"></i></span></div>`).join('')}</div>`;
    const heat = (v, mx) => `style="background:rgba(99,102,241,${(0.06 + 0.5 * (mx ? v / mx : 0)).toFixed(2)})"`;
    const wCols = [{ k: '#', h: '#', cls: 'c' }, C_NAME, ...C_MOB(),
      ...WD.map(([d, l]) => ({ k: 'd' + d, h: l, v: (e) => wdAvg(e, d), t: (e) => wdAvg(e, d).toFixed(1), c: (e) => { const row = WD.map(([x]) => wdAvg(e, x)); return `<span class="ax-hc" ${heat(wdAvg(e, d), Math.max(...row))}>${wdAvg(e, d).toFixed(1)}</span>`; }, cls: 'c' })),
      { k: 'best', h: '🔥 Best din', v: (e) => Math.max(...WD.map(([d]) => wdAvg(e, d))), t: (e) => WD.reduce((b, x) => (wdAvg(e, x[0]) > wdAvg(e, b[0]) ? x : b))[1], c: (e) => `<span class="ax-days hot2">${WD.reduce((b, x) => (wdAvg(e, x[0]) > wdAvg(e, b[0]) ? x : b))[1]}</span>`, cls: 'c' },
      { k: 'weak', h: '🧊 Weak din', t: (e) => WD.reduce((b, x) => (wdAvg(e, x[0]) < wdAvg(e, b[0]) ? x : b))[1], c: (e) => `<span class="ax-days">${WD.reduce((b, x) => (wdAvg(e, x[0]) < wdAvg(e, b[0]) ? x : b))[1]}</span>`, cls: 'c' },
      { k: 'tot', h: 'Hafte ka avg', v: (e) => WD.reduce((t, [d]) => t + wdAvg(e, d), 0), t: (e) => WD.reduce((t, [d]) => t + wdAvg(e, d), 0).toFixed(1), c: (e) => `<b>${WD.reduce((t, [d]) => t + wdAvg(e, d), 0).toFixed(1)}</b>`, cls: 'r' }];
    const s5 = `<section class="ax-sec s-weekday"><header><button type="button" class="ax-csvb" data-csv="w">⬇ CSV</button><h3>📅 Weekday pattern — kis din kitne tags</h3><p>Roz ka average tags (pichhle ~3 mahine ka data) · 🔥 sabse strong din, 🧊 sabse weak din</p></header>${wCards}${tableHtml('w', wCols, wL, ui.t.w, null, 15)}</section>`;
    return { kHtml, html: `${s1}${s2}<div class="ax-two">${s3}${s4}</div>${s5}`, list, inactiveL, stockL };
  }

  function csvOf(list) {
    const h = ['Channel', 'Type', 'Naam', 'Agents', 'Pichhla mahina', 'Ab tak', 'Projection', 'Growth %', 'Status', 'Stock', 'Inactive din', 'Cover din', 'Replacement', 'Chassis', 'Wrong VRN'];
    return [h, list.map((e) => [e.ch.toUpperCase(), e.type === 'tl' ? 'TL' : 'Direct', e.name, e.agents, e.last, e.cur, Math.round(e.proj), e.g === null ? '' : Math.round(e.g), ST[e.st].label, e.stock, e.inact === null ? '' : e.inact, e.cover === Infinity ? '' : Math.round(e.cover), e.repl, e.chassis, e.wrong])];
  }
  /** row click → us naam ki poori profile / search */
  function openDrill(name) { try { location.hash = `#/masterSearch?q=${encodeURIComponent(name)}`; } catch { /* ignore */ } }

  async function render(root, params) {
    const p = params || {};
    const sc0 = scroller(root), keepTop = sc0 ? sc0.scrollTop : 0;   // refresh/re-render par jagah wahi rahe
    const ui = loadUi();
    if (['ff', 'gv'].includes(p.ch)) ui.ch = p.ch;
    if (['tl', 'direct'].includes(p.seg)) ui.seg = p.seg;
    root.innerHTML = `<div class="ax-hero"><div class="ax-hero-t"><span class="ax-hero-ico">🧠</span><div><h1>AI Business Analyst</h1><p>TL aur Direct agents ka seedha scorecard — growth, quality, inactive aur stock</p></div></div><div class="ax-hero-a" id="ax-actions"></div></div><div id="ax-body">${U.spinner('Analyst poora data padh raha hai…')}</div>`;
    const body = U.$('#ax-body', root);
    const key = String(p.month || '');
    let firstPaint = true, redraw = null, mobTried = false;
    const paint = (a) => {
    if (!root.isConnected) return;
    if (a.empty) { body.innerHTML = '<div class="empty-state">Abhi analysis ke liye data nahi mila.</div>'; return; }
    const top = firstPaint ? keepTop : (scroller(root) || {}).scrollTop || 0; firstPaint = false;
    const ent = entitiesOf(a);
    const monthOpts = a.months.slice().reverse().map((m) => `<option value="${m}" ${m === a.cur ? 'selected' : ''}>${esc(U.labelYM(m, true))}</option>`).join('');
    U.$('#ax-actions', root).innerHTML = `<label class="ax-month">📅 <select id="ax-month" class="input">${monthOpts}</select></label><button class="btn small" id="ax-csv">⬇ CSV</button><button class="btn small" id="ax-refresh">↻</button>`;
    const dl = (d) => (d ? U.labelDate(d) : '—');
    body.innerHTML = `${a.errors.length ? `<div class="alert warn">${a.errors.map(esc).join(' · ')}</div>` : ''}
      <div class="ax-bar-top">
        <div class="ax-seg" id="ax-ch">${[['all', '🌐 GV + FF'], ['gv', '🟩 GV Partner'], ['ff', '🟦 First Forward']].map(([k, l]) => `<button type="button" data-ch="${k}">${l}</button>`).join('')}</div>
        <div class="ax-seg" id="ax-seg">${[['all', '👥🧍 TL + Direct'], ['tl', '👥 Sirf TL'], ['direct', '🧍 Sirf Direct']].map(([k, l]) => `<button type="button" data-seg="${k}">${l}</button>`).join('')}</div>
        <input id="ax-q" class="input ax-search" type="search" value="${esc(ui.q)}" placeholder="🔎 TL / agent ka naam…">
        <span class="ax-fresh">🟩 GV ${esc(dl(a.gvLatest))} · 🟦 FF ${esc(dl(a.ffLatest))} tak</span>
      </div>
      <div id="ax-main"></div>
      <p class="foot-note">Projection = ab tak ÷ din × mahine ke din. Growth ≥ +5%, Stable −5% se +5%, De-growth −5% se −30%, High de-growth −30% se neeche (ya is mahine 0). TL ka number = TL + uski poori team. FF = EIR (master ID ≠ ${esc(a.gvId)}), GV = GV Master.</p>`;
    let cur = null;
    const draw = () => {
      saveUi(ui);
      cur = sections(a, ent, ui);
      U.$('#ax-main', root).innerHTML = cur.kHtml + cur.html;
      body.querySelectorAll('[data-ch]').forEach((b) => b.classList.toggle('on', b.dataset.ch === ui.ch));
      body.querySelectorAll('[data-seg]').forEach((b) => b.classList.toggle('on', b.dataset.seg === ui.seg));
    };
    draw(); redraw = draw; if (!mobTried) { mobTried = true; loadMob(); }
    if (root.__axClick) root.removeEventListener('click', root.__axClick);
    root.__axClick = (e) => {
      const t = e.target;
      const cb = t.closest('[data-csv]'); if (cb) { csvTable(cb.dataset.csv); return; }
      const dr = t.closest('[data-drill]'); if (dr) { openDrill(dr.dataset.drill); return; }
      const so = t.closest('[data-sort]'); if (so) { const [id, k] = so.dataset.sort.split('|'), s = ui.t[id]; s.dir = s.sort === k && s.dir === 'desc' ? 'asc' : 'desc'; s.sort = k; draw(); return; }
      const mo = t.closest('[data-more]'); if (mo) { const s = ui.t[mo.dataset.more]; s.all = !s.all; draw(); return; }
      const gs = t.closest('[data-gst]'); if (gs) { ui.gst = gs.dataset.gst; const g = ui.t.g; if (ui.gst === 'degrowth' || ui.gst === 'high') { g.sort = 'delta'; g.dir = 'asc'; } else if (ui.gst === 'inact1') { g.sort = 'last'; g.dir = 'desc'; } else if (ui.gst === 'inact2') { g.sort = 'm2'; g.dir = 'desc'; } else if (ui.gst === 'inact3') { g.sort = 'm3'; g.dir = 'desc'; } else if (ui.gst === 'growth') { g.sort = 'delta'; g.dir = 'desc'; } else { g.sort = 'proj'; g.dir = 'desc'; } g.all = false; draw(); return; }
      const od = t.closest('[data-old]'); if (od) { ui.old = !ui.old; draw(); return; }
      const qs = t.closest('[data-qsort]'); if (qs) { ui.t.q.sort = qs.dataset.qsort; ui.t.q.dir = 'desc'; draw(); return; }
      const ch = t.closest('[data-ch]'); if (ch) { ui.ch = ch.dataset.ch; draw(); return; }
      const sg = t.closest('[data-seg]'); if (sg) { ui.seg = sg.dataset.seg; draw(); }
    };
    root.addEventListener('click', root.__axClick);
    U.$('#ax-q', root).addEventListener('input', (e) => { ui.q = e.target.value; draw(); });
    U.$('#ax-month', root).addEventListener('change', (e) => FF.app.updateParams({ month: e.target.value, ch: p.ch || '' }));
    U.$('#ax-refresh', root).addEventListener('click', () => { AX = { key: '', a: null, at: 0 }; if (FF.app.refresh) FF.app.refresh(); else render(root, params); });
    U.$('#ax-csv', root).addEventListener('click', () => { const [h, r] = csvOf(cur ? cur.list : ent); U.downloadCsv(`ai-analyst-${U.stamp()}.csv`, h, r); });
    const sc = scroller(root); if (sc && top) { sc.scrollTop = top; setTimeout(() => { sc.scrollTop = top; }, 120); }
    };
    const loadMob = () => { if (!canMob()) return; Promise.resolve(FF.lazy && FF.lazy.ensure ? FF.lazy.ensure('kpiDetail') : null).then(() => (FF.agentMobiles && FF.agentMobiles.load ? FF.agentMobiles.load() : null)).then(() => { if (root.isConnected && redraw) redraw(); }).catch(() => {}); };
    // pehle cache se turant (spinner nahi, filter + scroll wahi), phir peeche se taaza data
    const hit = AX.a && AX.key === key ? AX.a : null;
    if (hit) paint(hit);
    if (!hit || Date.now() - AX.at > 120000) {
      try { const a = await analyse(p.month, 'all'); AX = { key, a, at: Date.now() }; paint(a); } catch (err) { if (!hit) body.innerHTML = U.errorBox(err); }
    }
  }

  FF.aiAnalyst = { analyse, entitiesOf, statusOf, drivers, promoteTls };
  FF.pages.aiAnalyst = { title: 'AI Business Analyst', render };
})(window.FF);
