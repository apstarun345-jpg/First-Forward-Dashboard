/* 🧠 AI Business Analyst — First Forward aur GV Partner ka alag-alag + side-by-side business review.
   • FF = EIR (master ID ≠ 5845036) · GV = GV Master sheet (rows seedha GV Master se). Dono kabhi mix nahi hote;
     har channel ka apna "data tak" din use hota hai (EIR ek din late ho sakta hai); "combined" sirf alag-alag numbers ka jod hai.
   • Har number / card / row / bar clickable hai → wahi data table me khulta hai (search + CSV). Agent row → poori profile.
   • Basis: current month ka run-rate (ab tak ÷ din × mahine ke din) vs pichhla poora mahina. Rule-based, koi bahari AI API nahi. */
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
  function peopleFromFf(agents, cur, last, isFfRow) {
    const map = new Map();
    (agents || []).filter((r) => isFfRow(r) && (r.ym === cur || r.ym === last)).forEach((r) => {
      const key = clean(r.id) ? 'I' + norm(r.id) : 'N' + norm(r.name);
      if (!map.has(key)) map.set(key, { key, name: r.name, id: clean(r.id), tl: '', cur: 0, last: 0, tlCurN: 0 });
      const o = map.get(key);
      if (r.ym === cur) { o.cur += r.n; if (r.n >= o.tlCurN) { o.tlCurN = r.n; o.tl = r.tlName; } } else { o.last += r.n; if (!o.tl) o.tl = r.tlName; }
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
      if (!map.has(k)) map.set(k, { name: k, cur: 0, last: 0, proj: 0, delta: 0, agents: 0, active: 0, members: [] });
      const t = map.get(k); t.cur += r.cur; t.last += r.last; t.proj += r.proj; t.delta += r.delta; t.agents++; if (r.cur > 0) t.active++; t.members.push(r);
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
  function gvPeople(idx, cur, last) {
    const map = new Map();
    const add = (ym, f) => (idx.byYm.get(ym) || []).forEach((r) => {
      const id = clean(r.agentId), key = id ? 'I' + norm(id) : 'N' + norm(r.agentName);
      if (!map.has(key)) map.set(key, { key, name: r.agentName, id, tl: r.tlName || '', cur: 0, last: 0, direct: false, directAll: true });
      const o = map.get(key); o[f]++; if (!isDirectGv(r)) o.directAll = false; if (r.tlName && (f === 'cur' || !o.tl)) o.tl = r.tlName;
    });
    add(cur, 'cur'); add(last, 'last');
    return [...map.values()].map((o) => ({ ...o, direct: o.directAll }));
  }

  async function analyse(monthParam) {
    const [dailyR, agentsR, stockR, masterR, gvStockR] = await Promise.allSettled([S.need('daily'), S.need('agents'), S.need('stock'), G.need('master'), G.need('stockClass')]);
    const out = { errors: [], gvId: GV_ID() };
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
    out.dimCur = U.daysInMonth(out.cur); out.dimLast = U.daysInMonth(out.last);
    out.day = out.isCurrent ? latest.getDate() : out.dimCur;
    out.latest = latest;
    out.channels = {};
    const stockRows = { ff: stockR.status === 'fulfilled' ? stockR.value : [], gv: gvStockR.status === 'fulfilled' ? gvStockR.value : [] };
    const build = (ch) => {
      const isFf = ch === 'ff';
      if (isFf ? !ffDaily : !gvOk) return null;
      // har channel ka apna "data tak" din — FF EIR ek din late aa sakta hai, uski wajah se FF ki projection na giray
      const chLatest = isFf ? ffLatest : gvLatest;
      const day = chLatest && U.ymKey(chLatest) === out.cur ? chLatest.getDate() : (out.isCurrent && chLatest && U.ymKey(chLatest) < out.cur ? 0 : out.day);
      const sum = (ym, d) => (isFf ? M.summary(ffDaily, ym, d) : gvSummary(gvIdx, ym, d));
      const cur = sum(out.cur), last = sum(out.last), lastMtd = day ? sum(out.last, day) : last;
      const people = isFf ? peopleFromFf(agents, out.cur, out.last, isFfRow) : gvPeople(gvIdx, out.cur, out.last);
      const d = drivers(people, day || out.day, out.dimCur);
      const proj = out.isCurrent ? (day ? (cur.total / day) * out.dimCur : cur.total) : cur.total;
      const ser = (ym) => { try { return isFf ? (M.dailySeries(ffDaily, ym).totals || []) : gvSeries(gvIdx, ym); } catch { return []; } };
      const curSeries = ser(out.cur).slice(0, day || out.day), lastSeries = ser(out.last);
      while (curSeries.length > 1 && !curSeries[curSeries.length - 1]) curSeries.pop();
      const mo = momentum(lastSeries, curSeries, day || out.day);
      const avg = cur.activeDays ? cur.total / cur.activeDays : 0;
      const stock = U.sum(stockRows[ch], (r) => r.n);
      const mon = out.months.slice(-6).map((ym) => { const x = sum(ym); return { ym, total: x.total, vc4: x.vc4, vc20: x.vc20, vc5p: x.vc5p, comm: x.comm, repl: x.replacement, wrong: x.wrongVrn }; });
      return { ch, day, latest: chLatest, source: isFf ? 'EIR' : 'GV Master', cur, last, lastMtd, proj, projGrowth: last.total ? pct(proj, last.total) : null, mtdGrowth: pct(cur.total, lastMtd.total), d,
        tls: tlRoll(d.rows), conc: concentration(d.rows, cur.total), mo, curSeries, lastSeries, stock, stockRows: stockRows[ch], cover: avg ? stock / avg : 0, avg, mon, noLast: !last.total,
        vc4Share: cur.total ? (cur.vc4 / cur.total) * 100 : 0, vc4ShareLast: last.total ? (last.vc4 / last.total) * 100 : 0,
        replShare: cur.total ? (cur.replacement / cur.total) * 100 : 0, wrongShare: cur.total ? (cur.wrongVrn / cur.total) * 100 : 0 };
    };
    out.channels.ff = build('ff'); out.channels.gv = build('gv');
    // EIR hisaab: total = master ID 5845036 wali rows + baaki (FF) — sirf proof ke liye
    try { if (eirOnly) { let t = 0, g = 0, f = 0; eirOnly.forEach((r) => { if (r.ym !== out.cur) return; t += r.n; if (isFfRow(r)) f += r.n; else g += r.n; }); out.eir = { total: t, ff: f, gvId: g }; } } catch { /* ignore */ }
    // EIR reconciliation: poore EIR ledger me master-ID ke hisaab se FF/GV split (sirf proof ke liye)
    return out;
  }

  // ---------------------------------------------------------------- narrative (har line ke saath drill key)
  function narrative(a) {
    const lines = [], actions = [];
    const ff = a.channels.ff, gv = a.channels.gv, all = [ff, gv].filter(Boolean);
    const lastLbl = U.labelYM(a.last), curLbl = U.labelYM(a.cur);
    if (ff && gv) {
      const dFf = ff.proj - ff.last.total, dGv = gv.proj - gv.last.total;
      const lead = Math.abs(dFf) >= Math.abs(dGv) ? ['First Forward', dFf] : ['GV Partner', dGv];
      lines.push({ k: tone(dFf + dGv), drill: 'cmp', t: `<b>Channel-wise asar</b> (alag-alag, mix nahi): FF <b class="aa-d ${tone(dFf)}">${sgn(dFf)}</b> · GV <b class="aa-d ${tone(dGv)}">${sgn(dGv)}</b> tags vs ${lastLbl}. Sabse bada asar <b>${lead[0]}</b> ka (${sgn(lead[1])}).` });
    }
    all.forEach((c) => {
      const L = CH[c.ch].label, [h] = healthOf(c.projGrowth);
      const topUp = c.d.up[0], topDown = c.d.down[0];
      lines.push({ k: tone(c.projGrowth || 0), drill: `${c.ch}:proj`, t: `<b>${CH[c.ch].icon} ${L} — ${h}:</b> ${curLbl} ab tak ${fmt(c.cur.total)} · ${a.isCurrent ? 'projected' : 'poora mahina'} <b>${fmt(c.proj)}</b> vs ${lastLbl} ${fmt(c.last.total)} (<b class="aa-d ${tone(c.projGrowth || 0)}">${pctTxt(c.projGrowth)}</b>).` });
      if (topUp) lines.push({ k: 'up', drill: `${c.ch}:up`, t: `<b>${L} growth driver:</b> <b>${esc(topUp.name)}</b> (${sgn(topUp.delta)})${c.d.up[1] ? `, ${esc(c.d.up[1].name)} (${sgn(c.d.up[1].delta)})` : ''}${c.d.up[2] ? `, ${esc(c.d.up[2].name)} (${sgn(c.d.up[2].delta)})` : ''} — total ${fmt(c.d.up.length)} agents badhe.` });
      if (topDown) lines.push({ k: 'down', drill: `${c.ch}:down`, t: `<b>${L} girawat:</b> <b>${esc(topDown.name)}</b> (${sgn(topDown.delta)})${c.d.down[1] ? `, ${esc(c.d.down[1].name)} (${sgn(c.d.down[1].delta)})` : ''}${c.d.down[2] ? `, ${esc(c.d.down[2].name)} (${sgn(c.d.down[2].delta)})` : ''} — total ${fmt(c.d.down.length)} agents ghate.` });
      if (c.d.lost.length) {
        const lostTags = c.d.lost.reduce((s, r) => s + r.last, 0);
        lines.push({ k: 'down', drill: `${c.ch}:lost`, t: `<b>${L}:</b> ${fmt(c.d.lost.length)} agents jo ${lastLbl} me chal rahe the abhi <b>zero</b> hain (pichhle mahine ${fmt(lostTags)} tags).` });
        actions.push({ drill: `${c.ch}:lost`, t: `${L}: ${fmt(c.d.lost.length)} zero-activity agents ko call karo — pehle top 5: ${c.d.lost.slice(0, 5).map((r) => esc(r.name)).join(', ')}.` });
      }
      const tlDown = c.tls.filter((t) => t.delta < 0).sort((x, y) => x.delta - y.delta)[0];
      if (tlDown && tlDown.delta <= -20) actions.push({ drill: `${c.ch}:tl:${tlDown.name}`, t: `${L}: TL <b>${esc(tlDown.name)}</b> ki team ${sgn(tlDown.delta)} tags gir rahi hai (${tlDown.active}/${tlDown.agents} active) — review meeting karo.` });
      if (c.mo.hasPrev && c.mo.growth !== null && Math.abs(c.mo.growth) >= 10) {
        lines.push({ k: tone(c.mo.growth), drill: `${c.ch}:daily`, t: `<b>${L} momentum:</b> pichhle 7 din ${fmt(c.mo.week)} vs usse pehle 7 din ${fmt(c.mo.prev)} (${pctTxt(c.mo.growth)}).` });
        if (c.mo.growth <= -10) actions.push({ drill: `${c.ch}:down`, t: `${L}: haftawar raftaar ${pctTxt(c.mo.growth)} gir rahi hai — top decliners se isi hafte baat karo.` });
      }
      if (c.conc.top5Share >= 50) actions.push({ drill: `${c.ch}:top5`, t: `${L}: top 5 agents hi ${c.conc.top5Share.toFixed(0)}% issuance de rahe hain — dependency risk, mid-level agents ko push karo.` });
      if (c.cover && c.cover < 7) actions.push({ drill: `${c.ch}:stock`, t: `${L}: stock cover sirf ${c.cover.toFixed(0)} din — dispatch jaldi plan karo (Dispatch Planner).` });
      else if (c.cover && c.cover > 60) actions.push({ drill: `${c.ch}:stock`, t: `${L}: stock cover ${c.cover.toFixed(0)} din (bahut zyada) — idle stock wale agents/TLs se redistribute karo.` });
      if (c.vc4Share < c.vc4ShareLast - 3) actions.push({ drill: `${c.ch}:class`, t: `${L}: VC4 mix ${c.vc4ShareLast.toFixed(0)}% → ${c.vc4Share.toFixed(0)}% gira — payable class par focus badhao.` });
      if (c.wrongShare >= 3) actions.push({ drill: '', t: `${L}: Wrong-VRN ${c.wrongShare.toFixed(1)}% hai — Unusual Activity page me flagged agents dekho.` });
    });
    if (!actions.length) actions.push({ drill: '', t: 'Koi bada risk nahi dikha — current raftaar banaye rakho.' });
    return { lines, actions };
  }

  // ---------------------------------------------------------------- drill registry (click → same data)
  const personRow = (r, a) => [r.name, r.id, r.direct ? 'Direct' : (clean(r.tl) || '—'), fmt(r.last), fmt(r.cur), fmt(r.proj), sgn(r.delta), r.growth === null ? 'new' : pctTxt(r.growth), r.kind === 'lost' ? 'Gaya/zero' : r.kind === 'new' ? 'Naya' : 'Regular'];
  function drillFor(a, key) {
    const [ch, what, extra] = String(key).split(':');
    const lastLbl = U.labelYM(a.last), curLbl = U.labelYM(a.cur);
    const PH = ['Agent', 'Agent ID', 'TL', `${lastLbl} (poora)`, `${curLbl} ab tak`, 'Projected', 'Change', 'Change %', 'Type'];
    const mk = (title, list, stats) => ({ title, headers: PH, rows: list.map((r) => personRow(r, a)), persons: list.map((r) => ({ ch, name: r.name, id: r.id })), stats: stats || [], ch });
    if (ch === 'cmp') {
      const rows = [], f = a.channels.ff, g = a.channels.gv;
      const add = (l, x, y) => rows.push([l, x, y]);
      add(`${curLbl} ab tak`, f ? fmt(f.cur.total) : '—', g ? fmt(g.cur.total) : '—'); add('Projected / poora', f ? fmt(f.proj) : '—', g ? fmt(g.proj) : '—');
      add(`${lastLbl} poora`, f ? fmt(f.last.total) : '—', g ? fmt(g.last.total) : '—'); add('Change tags', f ? sgn(f.proj - f.last.total) : '—', g ? sgn(g.proj - g.last.total) : '—');
      add('Change %', f ? pctTxt(f.projGrowth) : '—', g ? pctTxt(g.projGrowth) : '—'); add('VC4 mix', f ? f.vc4Share.toFixed(0) + '%' : '—', g ? g.vc4Share.toFixed(0) + '%' : '—');
      add('Stock cover (din)', f ? f.cover.toFixed(0) : '—', g ? g.cover.toFixed(0) : '—'); add('Zero-activity agents', f ? fmt(f.d.lost.length) : '—', g ? fmt(g.d.lost.length) : '—');
      return { title: 'First Forward vs GV Partner', headers: ['Metric', 'First Forward', 'GV Partner'], rows, stats: [`GV = master ID ${a.gvId}`] };
    }
    const c = a.channels[ch]; if (!c) return null;
    const L = CH[ch].label;
    switch (what) {
      case 'cur': return mk(`${L} · ${curLbl} ab tak — sab agents`, [...c.d.rows].filter((r) => r.cur > 0).sort((x, y) => y.cur - x.cur), [`${fmt(c.cur.total)} tags`, `${fmt(c.conc.active)} active agents`]);
      case 'proj': return mk(`${L} · projected — sab agents`, [...c.d.rows].filter((r) => r.proj > 0 || r.last > 0).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)), [`projected ${fmt(c.proj)}`, `${lastLbl} ${fmt(c.last.total)}`]);
      case 'up': return mk(`${L} · growth kiski wajah se`, c.d.up, [`net ${sgn(c.d.net)}`, `${fmt(c.d.up.length)} agents badhe`]);
      case 'down': return mk(`${L} · kaun down hai`, c.d.down, [`${fmt(c.d.down.length)} agents ghate`]);
      case 'lost': return mk(`${L} · gaye / zero-activity`, c.d.lost, [`${fmt(c.d.lost.reduce((s, r) => s + r.last, 0))} tags pichhle mahine`]);
      case 'fresh': return mk(`${L} · naye / pehli baar active`, c.d.fresh, [`${fmt(c.d.fresh.reduce((s, r) => s + r.cur, 0))} tags ab tak`]);
      case 'tlup': return { title: `${L} · TL growth`, headers: ['TL', 'Active', 'Agents', lastLbl, 'Projected', 'Change', '%'], rows: c.tls.filter((t) => t.delta > 0).sort((x, y) => y.delta - x.delta).map((t) => [t.name, t.active, t.agents, fmt(t.last), fmt(t.proj), sgn(t.delta), pctTxt(t.growth)]), tlKeys: c.tls.filter((t) => t.delta > 0).sort((x, y) => y.delta - x.delta).map((t) => t.name), ch };
      case 'tldown': return { title: `${L} · TL down`, headers: ['TL', 'Active', 'Agents', lastLbl, 'Projected', 'Change', '%'], rows: c.tls.filter((t) => t.delta < 0).sort((x, y) => x.delta - y.delta).map((t) => [t.name, t.active, t.agents, fmt(t.last), fmt(t.proj), sgn(t.delta), pctTxt(t.growth)]), tlKeys: c.tls.filter((t) => t.delta < 0).sort((x, y) => x.delta - y.delta).map((t) => t.name), ch };
      case 'tl': { const name = key.split(':').slice(2).join(':'); const t = c.tls.find((x) => x.name === name); return t ? mk(`${L} · TL ${t.name} ki team`, [...t.members].sort((x, y) => y.cur - x.cur), [`${t.active}/${t.agents} active`, `change ${sgn(t.delta)}`]) : null; }
      case 'class': return { title: `${L} · class mix (last 6 mahine)`, headers: ['Month', 'Total', 'VC4', 'VC20', 'VC5+', 'Commercial', 'VC4 %', 'Replacement', 'Wrong VRN'], rows: [...c.mon].reverse().map((m) => [U.labelYM(m.ym), fmt(m.total), fmt(m.vc4), fmt(m.vc20), fmt(m.vc5p), fmt(m.comm), m.total ? (m.vc4 / m.total * 100).toFixed(0) + '%' : '—', fmt(m.repl), fmt(m.wrong)]) };
      case 'daily': { const n = Math.max(c.curSeries.length, c.lastSeries.length); const rows = []; for (let i = 0; i < n; i++) rows.push([`Day ${i + 1}`, i < c.curSeries.length ? fmt(c.curSeries[i]) : '—', i < c.lastSeries.length ? fmt(c.lastSeries[i]) : '—']); return { title: `${L} · daily issuance`, headers: ['Din', curLbl, lastLbl], rows: rows.reverse(), stats: [`7 din: ${fmt(c.mo.week)} vs pehle ${fmt(c.mo.prev)}`] }; }
      case 'stock': { const g = U.groupSum(c.stockRows, (r) => r.cls || 'NA', (r) => r.n); const ents = Object.entries(g instanceof Map ? Object.fromEntries(g) : g).sort((x, y) => y[1] - x[1]); return { title: `${L} · class-wise stock`, headers: ['Class', 'Stock tags', 'Share'], rows: ents.map(([k, v]) => [k, fmt(v), c.stock ? (v / c.stock * 100).toFixed(0) + '%' : '—']), stats: [`${fmt(c.stock)} tags`, `cover ${c.cover.toFixed(0)} din`] }; }
      case 'top5': return { title: `${L} · top agents ka share`, headers: ['Agent', 'Agent ID', 'TL', curLbl, 'Share', 'Cumulative'], rows: (() => { let run = 0; return c.conc.sorted.slice(0, 50).map((r) => { run += r.cur; return [r.name, r.id, r.direct ? 'Direct' : (clean(r.tl) || '—'), fmt(r.cur), (r.cur / c.cur.total * 100).toFixed(1) + '%', (run / c.cur.total * 100).toFixed(0) + '%']; }); })(), persons: c.conc.sorted.slice(0, 50).map((r) => ({ ch, name: r.name, id: r.id })), stats: [`top 5 = ${c.conc.top5Share.toFixed(0)}%`, `80% ke liye ${c.conc.n80} agents`], ch };
      case 'active': return mk(`${L} · active agents`, c.conc.sorted, [`${fmt(c.conc.active)} agents`]);
      default: return null;
    }
  }

  function openDrill(root, a, key) {
    const spec = drillFor(a, key); if (!spec) return;
    const old = document.getElementById('aa-drill'); if (old) old.remove();
    const dlg = document.createElement('dialog'); dlg.id = 'aa-drill'; dlg.className = 'aa-dialog';
    const PAGE = 300; let shown = PAGE, filtered = spec.rows.map((r, i) => i);
    dlg.innerHTML = `<div class="aa-dh"><h3>${esc(spec.title)}</h3><button class="btn small" data-x>✕ Close</button></div>
      <div class="aa-ds">${(spec.stats || []).map((s) => `<span class="ins-pill">${esc(s)}</span>`).join('')}<span class="ins-pill" data-count></span></div>
      <div class="aa-dt"><input type="search" placeholder="Is table me search — naam, ID, TL…" data-q><button class="btn small" data-csv>⬇ CSV</button></div>
      <div class="table-wrap"><table class="data-table ins-table"><thead><tr>${spec.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody data-b></tbody></table></div>
      <div class="aa-more" data-more hidden><button class="btn small" data-m>⬇ Aur ${PAGE} dikhao</button></div>
      ${spec.persons || spec.tlKeys ? '<p class="dim small">Row par click → ' + (spec.tlKeys ? 'us TL ki team' : 'agent ki poori profile') + '.</p>' : ''}`;
    document.body.append(dlg);
    const tb = dlg.querySelector('[data-b]');
    const paint = () => {
      tb.innerHTML = filtered.slice(0, shown).map((i) => `<tr ${spec.persons || spec.tlKeys ? `class="clickable" data-i="${i}"` : ''}>${spec.rows[i].map((v) => `<td>${esc(v ?? '—')}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${spec.headers.length}">Koi row nahi</td></tr>`;
      dlg.querySelector('[data-count]').textContent = `${fmt(filtered.length)} rows`;
      dlg.querySelector('[data-more]').hidden = filtered.length <= shown;
    };
    paint();
    dlg.querySelector('[data-q]').addEventListener('input', U.debounce ? U.debounce((e) => { const q = e.target.value.toLowerCase().trim(); filtered = spec.rows.map((r, i) => i).filter((i) => !q || spec.rows[i].join(' ').toLowerCase().includes(q)); shown = PAGE; paint(); }, 120) : () => {});
    dlg.querySelector('[data-m]').addEventListener('click', () => { shown += PAGE; paint(); });
    dlg.querySelector('[data-x]').addEventListener('click', () => dlg.close ? dlg.close() : dlg.remove());
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.querySelector('[data-csv]').addEventListener('click', () => U.downloadCsv(`ai-analyst-${U.slug(spec.title)}-${U.stamp()}.csv`, spec.headers, filtered.map((i) => spec.rows[i])));
    tb.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-i]'); if (!tr) return; const i = Number(tr.dataset.i);
      if (spec.tlKeys) { const k = `${spec.ch}:tl:${spec.tlKeys[i]}`; dlg.close(); openDrill(root, a, k); return; }
      const p = spec.persons && spec.persons[i]; if (!p) return;
      dlg.close();
      if (FF.masterProfile && FF.masterProfile.open) FF.masterProfile.open({ kind: `${p.ch}-agent`, name: p.name, sub: p.id, tlSet: new Set(), classMap: new Map(), bars: new Set() });
    });
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }

  // ---------------------------------------------------------------- UI pieces
  const D = (key, inner, cls) => `<button type="button" class="aa-click ${cls || ''}" data-drill="${esc(key)}">${inner}</button>`;
  const chip = (g) => { const [t, k] = healthOf(g); return `<span class="aa-chip ${k}">${t}</span>`; };
  const gcell = (p) => `<span class="aa-d ${p === null ? 'flat' : tone(p)}">${pctTxt(p)}</span>`;
  function spark(cur, last, color) {
    const W = 260, H = 54, n = Math.max(cur.length, last.length, 2);
    const max = Math.max(1, ...cur, ...last);
    const pts = (arr) => arr.map((v, i) => `${(i / (n - 1)) * W},${H - 4 - ((v || 0) / max) * (H - 10)}`).join(' ');
    return `<svg class="aa-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts(last)}" fill="none" stroke="currentColor" stroke-opacity=".28" stroke-width="1.6" stroke-dasharray="3 3"/><polyline points="${pts(cur)}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }
  function scorecard(c, a) {
    const m = CH[c.ch], [h, k] = healthOf(c.projGrowth);
    return `<div class="aa-score ${c.ch}" style="--ac:${m.color}">
      <div class="aa-score-top"><span class="aa-score-name">${m.icon} ${m.label}</span>${chip(c.projGrowth)}</div>
      ${D(`${c.ch}:proj`, `<span class="aa-big">${fmt(c.proj)}</span><span class="aa-sub">${a.isCurrent ? 'month-end projection' : 'poora mahina'} · <b class="aa-d ${k}">${pctTxt(c.projGrowth)}</b> vs ${esc(U.labelYM(a.last))} (${fmt(c.last.total)})</span>`, 'aa-bigbtn')}
      ${D(`${c.ch}:daily`, spark(c.curSeries, c.lastSeries, m.color), 'aa-sparkbtn')}
      <div class="aa-trio">
        ${D(`${c.ch}:cur`, `<small>Ab tak</small><b>${fmt(c.cur.total)}</b>`)}
        ${D(`${c.ch}:class`, `<small>VC4 mix</small><b>${c.vc4Share.toFixed(0)}%</b>`)}
        ${D(`${c.ch}:stock`, `<small>Stock cover</small><b>${c.cover ? c.cover.toFixed(0) + 'd' : '—'}</b>`)}
      </div></div>`;
  }
  const dTable = (list, ch, key, mode, n) => {
    if (!list.length) return '<div class="empty-state compact">Is list me koi nahi.</div>';
    const rows = list.slice(0, n || 10).map((r, i) => `<tr class="clickable" data-prof="${ch}|${esc(r.name)}|${esc(r.id)}"><td><b>${esc(r.name || r.id || '—')}</b>${r.id ? `<small class="cell-sub">${esc(r.id)}</small>` : ''}</td><td>${esc(r.direct ? 'Direct' : (clean(r.tl) || '—'))}</td><td class="num">${fmt(r.last)}</td><td class="num">${fmt(r.cur)}</td><td class="num"><b class="aa-d ${tone(r.delta)}">${sgn(r.delta)}</b></td><td class="num">${mode === 'lost' ? '<span class="aa-d down">zero</span>' : gcell(r.growth)}</td></tr>`).join('');
    return `<div class="table-wrap"><table class="data-table ins-table"><thead><tr><th>Agent</th><th>TL</th><th class="num">Pichhla</th><th class="num">Ab tak</th><th class="num">Change</th><th class="num">%</th></tr></thead><tbody>${rows}</tbody></table></div>${list.length > (n || 10) ? `<div class="aa-all">${D(key, `Sab ${fmt(list.length)} dekho →`, 'btn small')}</div>` : ''}`;
  };
  const tTable = (c, which) => {
    const list = c.tls.filter((t) => (which === 'up' ? t.delta > 0 : t.delta < 0)).sort((x, y) => (which === 'up' ? y.delta - x.delta : x.delta - y.delta));
    if (!list.length) return '<div class="empty-state compact">Koi TL nahi.</div>';
    return `<div class="table-wrap"><table class="data-table ins-table"><thead><tr><th>TL</th><th class="num">Active</th><th class="num">Change</th><th class="num">%</th></tr></thead><tbody>${list.slice(0, 8).map((t) => `<tr class="clickable" data-drill="${c.ch}:tl:${esc(t.name)}"><td><b>${esc(t.name)}</b></td><td class="num">${t.active}/${t.agents}</td><td class="num"><b class="aa-d ${tone(t.delta)}">${sgn(t.delta)}</b></td><td class="num">${gcell(t.growth)}</td></tr>`).join('')}</tbody></table></div>${list.length > 8 ? `<div class="aa-all">${D(`${c.ch}:tl${which}`, `Sab ${fmt(list.length)} TL →`, 'btn small')}</div>` : ''}`;
  };
  const card = (title, body, cls) => `<section class="card aa-card ${cls || ''}"><div class="card-head"><h3>${title}</h3></div><div class="card-body">${body}</div></section>`;
  function barList(c) {
    const items = [...c.d.up.slice(0, 6).map((r) => ({ r, v: r.delta })), ...c.d.down.slice(0, 6).map((r) => ({ r, v: r.delta }))];
    if (!items.length) return '';
    const max = Math.max(...items.map((i) => Math.abs(i.v)), 1);
    return `<div class="aa-bars">${items.map((i) => `<div class="aa-bar clickable" data-prof="${c.ch}|${esc(i.r.name)}|${esc(i.r.id)}"><span class="aa-bn">${esc(i.r.name)}</span><span class="aa-bt"><i class="${i.v >= 0 ? 'up' : 'down'}" style="width:${Math.max(3, Math.abs(i.v) / max * 100)}%"></i></span><b class="aa-d ${tone(i.v)}">${sgn(i.v)}</b></div>`).join('')}</div>`;
  }
  function channelSection(c, a) {
    const m = CH[c.ch];
    return `<div class="aa-chan" id="aa-${c.ch}" style="--ac:${m.color}">
      <h2 class="aa-h2">${m.icon} ${m.label} — detail ${chip(c.projGrowth)}</h2>
      <div class="aa-mini">
        ${D(`${c.ch}:cur`, `<small>Ab tak (${esc(U.labelYM(a.cur))})</small><b>${fmt(c.cur.total)}</b><span>${c.mtdGrowth === null ? '—' : pctTxt(c.mtdGrowth) + ' vs pichhle mahine ka same period'}</span>`)}
        ${D(`${c.ch}:proj`, `<small>Projection</small><b>${fmt(c.proj)}</b><span>${pctTxt(c.projGrowth)} vs ${fmt(c.last.total)}</span>`)}
        ${D(`${c.ch}:class`, `<small>VC4 mix</small><b>${c.vc4Share.toFixed(0)}%</b><span>pichhle mahine ${c.vc4ShareLast.toFixed(0)}%</span>`)}
        ${D(`${c.ch}:daily`, `<small>Avg / active din</small><b>${fmt(c.avg)}</b><span>${c.cur.activeDays} active din · 7 din ${pctTxt(c.mo.growth)}</span>`)}
        ${D(`${c.ch}:stock`, `<small>Stock cover</small><b>${c.cover ? c.cover.toFixed(0) + ' din' : '—'}</b><span>${fmt(c.stock)} tags stock</span>`)}
        ${D(`${c.ch}:top5`, `<small>Top-5 share</small><b>${c.conc.top5Share.toFixed(0)}%</b><span>80% ke liye ${c.conc.n80} agents</span>`)}
        ${D(`${c.ch}:active`, `<small>Active agents</small><b>${fmt(c.conc.active)}</b><span>${fmt(c.d.fresh.length)} naye · ${fmt(c.d.lost.length)} gaye</span>`)}
      </div>
      <div class="grid g-2">${card('📈 Growth kiski wajah se', dTable(c.d.up, c.ch, `${c.ch}:up`))}${card('📉 Kaun down hai', dTable(c.d.down, c.ch, `${c.ch}:down`))}</div>
      <div class="grid g-2">${card('🏢 TL — growth', tTable(c, 'up'))}${card('🏢 TL — down', tTable(c, 'down'))}</div>
      <div class="grid g-2">${card(`🚪 Gaye / zero-activity <span class="dim">${fmt(c.d.lost.length)}</span>`, dTable(c.d.lost, c.ch, `${c.ch}:lost`, 'lost'))}${card(`🆕 Naye / pehli baar active <span class="dim">${fmt(c.d.fresh.length)}</span>`, dTable(c.d.fresh, c.ch, `${c.ch}:fresh`))}</div>
      ${card('⚖️ Top gainers vs decliners (projected Δ tags)', barList(c))}
    </div>`;
  }
  function compareTable(a) {
    const f = a.channels.ff, g = a.channels.gv; if (!f || !g) return '';
    const row = (label, fv, gv, kf, kg) => `<tr><td>${label}</td><td class="num">${kf ? D(kf, fv, 'aa-cell') : fv}</td><td class="num">${kg ? D(kg, gv, 'aa-cell') : gv}</td></tr>`;
    return card('⚖️ First Forward vs GV Partner (alag-alag, mix nahi)', `<div class="table-wrap"><table class="data-table ins-table"><thead><tr><th>Metric</th><th class="num">🟦 First Forward</th><th class="num">🟩 GV Partner</th></tr></thead><tbody>
      ${row(`${esc(U.labelYM(a.cur))} ab tak`, fmt(f.cur.total), fmt(g.cur.total), 'ff:cur', 'gv:cur')}
      ${row(a.isCurrent ? 'Projected month-end' : 'Poora mahina', fmt(f.proj), fmt(g.proj), 'ff:proj', 'gv:proj')}
      ${row(`${esc(U.labelYM(a.last))} poora`, fmt(f.last.total), fmt(g.last.total))}
      ${row('Change vs pichhla mahina', `<span class="aa-d ${tone(f.proj - f.last.total)}">${sgn(f.proj - f.last.total)} (${pctTxt(f.projGrowth)})</span>`, `<span class="aa-d ${tone(g.proj - g.last.total)}">${sgn(g.proj - g.last.total)} (${pctTxt(g.projGrowth)})</span>`, 'ff:up', 'gv:up')}
      ${row('VC4 mix', f.vc4Share.toFixed(0) + '%', g.vc4Share.toFixed(0) + '%', 'ff:class', 'gv:class')}
      ${row('Active agents', fmt(f.conc.active), fmt(g.conc.active), 'ff:active', 'gv:active')}
      ${row('Zero-activity agents', fmt(f.d.lost.length), fmt(g.d.lost.length), 'ff:lost', 'gv:lost')}
      ${row('Stock cover', f.cover ? f.cover.toFixed(0) + ' din' : '—', g.cover ? g.cover.toFixed(0) + ' din' : '—', 'ff:stock', 'gv:stock')}
      ${row('Top-5 share', f.conc.top5Share.toFixed(0) + '%', g.conc.top5Share.toFixed(0) + '%', 'ff:top5', 'gv:top5')}
    </tbody></table></div>`);
  }
  function csvOf(a) {
    const rows = [];
    ['ff', 'gv'].forEach((ch) => { const c = a.channels[ch]; if (!c) return; c.d.rows.forEach((r) => rows.push([CH[ch].label, r.name, r.id, r.direct ? 'Direct' : r.tl, r.last, r.cur, Math.round(r.proj), Math.round(r.delta), r.growth === null ? 'new' : r.growth.toFixed(1) + '%', r.kind])); });
    rows.sort((x, y) => Math.abs(y[7]) - Math.abs(x[7]));
    return [['Channel', 'Agent', 'ID', 'TL', `${a.last} total`, `${a.cur} MTD`, 'Projected', 'Change', 'Change %', 'Type'], rows];
  }

  // ---------------------------------------------------------------- page
  async function render(root, params) {
    const p = params || {};
    const sel = ['ff', 'gv'].includes(p.ch) ? p.ch : 'all';
    root.innerHTML = `<div class="aa-hero"><div class="aa-hero-main"><div class="aa-hero-ico">🧠</div><div><h1>AI Business Analyst</h1><p>First Forward aur GV Partner ka alag-alag + side-by-side review — growth kiski wajah se, kaun down, kaun gaya, TL asar, momentum, stock aur <b>ab kya karein</b>. Har number par click karo → wahi data khulta hai.</p></div></div>
      <div class="aa-hero-actions" id="aa-actions"></div></div>
      <div id="aa-body">${U.spinner('Analyst poora data padh raha hai…')}</div>`;
    const body = U.$('#aa-body', root);
    let a;
    try { a = await analyse(p.month); } catch (err) { body.innerHTML = U.errorBox(err); return; }
    if (!root.isConnected) return;
    if (a.empty) { body.innerHTML = '<div class="empty-state">Abhi analysis ke liye data nahi mila.</div>'; return; }
    const n = narrative(a);
    const ff = a.channels.ff, gv = a.channels.gv, all = [ff, gv].filter(Boolean);
    const shown = sel === 'all' ? all : all.filter((c) => c.ch === sel);
    const monthOpts = a.months.slice().reverse().map((m) => `<option value="${m}" ${m === a.cur ? 'selected' : ''}>${esc(U.labelYM(m, true))}</option>`).join('');
    U.$('#aa-actions', root).innerHTML = `<label class="aa-month">📅 <select id="aa-month" class="input">${monthOpts}</select></label><button class="btn small" id="aa-csv">⬇ CSV</button><button class="btn small primary" id="aa-refresh">↻ Refresh</button>`;
    const comb = all.reduce((s, c) => ({ cur: s.cur + c.cur.total, proj: s.proj + c.proj, last: s.last + c.last.total }), { cur: 0, proj: 0, last: 0 });
    const dl = (d) => (d ? U.labelDate(d) : '—');
    const recon = a.eir ? `<span class="aa-pill ok" title="EIR report ka total, master ID ke hisaab se tod kar">EIR ${esc(U.labelYM(a.cur))}: total ${fmt(a.eir.total)} − ID ${esc(a.gvId)} ${fmt(a.eir.gvId)} = FF ${fmt(a.eir.ff)}</span>` : '';
    const tabs = [['all', '🌐 Side by side'], ['ff', '🟦 First Forward'], ['gv', '🟩 GV Partner']].map(([k, l]) => `<button class="btn small ${sel === k ? 'primary' : ''}" data-aa-ch="${k}">${l}</button>`).join('');
    body.innerHTML = `${a.errors.length ? `<div class="alert warn">${a.errors.map(esc).join(' · ')}</div>` : ''}
      <div class="aa-basis"><span class="aa-pill">🟦 FF = EIR (master ID ≠ ${esc(a.gvId)}) · data ${esc(dl(a.ffLatest))} tak</span><span class="aa-pill">🟩 GV = GV Master · data ${esc(dl(a.gvLatest))} tak</span>${recon}${gv && gv.noLast ? '<span class="aa-pill warn">⚠ GV Master me pichhle mahine ka data nahi — GV comparison limited</span>' : ''}<span class="aa-pill soft">Dono milakar: ${fmt(comb.cur)} ab tak · ${fmt(comb.proj)} projected (alag IDs, overlap nahi)</span></div>
      <div class="aa-scores">${shown.map((c) => scorecard(c, a)).join('')}</div>
      <div class="aa-switch">${tabs}</div>
      <div class="grid g-2 aa-top">
        ${card('🧠 Analyst ka nichod <span class="dim">click → data</span>', `<ul class="aa-lines">${n.lines.filter((l) => sel === 'all' || !l.drill || l.drill === 'cmp' || l.drill.startsWith(sel)).filter((l) => sel === 'all' || l.drill !== 'cmp').map((l) => `<li class="${l.k}" ${l.drill ? `data-drill="${esc(l.drill)}"` : ''}>${l.t}</li>`).join('')}</ul>`)}
        ${card('✅ Ab kya karein <span class="dim">click → data</span>', `<ol class="aa-actions">${n.actions.filter((x) => sel === 'all' || !x.drill || x.drill.startsWith(sel)).map((x) => `<li ${x.drill ? `data-drill="${esc(x.drill)}"` : ''}>${x.t}</li>`).join('')}</ol>`)}
      </div>
      ${sel === 'all' ? compareTable(a) : ''}
      ${shown.map((c) => channelSection(c, a)).join('')}
      <p class="foot-note">Projected = ab tak ÷ din × mahine ke din (purane mahine ke liye poora total). "Gaye" = pichhle mahine tags the, is mahine 0. FF = EIR (master ID ≠ 5845036), GV = GV Master — alag sources, isliye koi tag do baar nahi gina jata. Har channel ki projection uska apna "data tak" din use karti hai.</p>`;
    if (C && C.mount) { try { C.mount(body); } catch { /* ignore */ } }
    if (root.__aaClick) root.removeEventListener('click', root.__aaClick);
    root.__aaClick = (e) => {
      const prof = e.target.closest('[data-prof]');
      if (prof && !e.target.closest('[data-drill]')) { const [ch, name, id] = prof.dataset.prof.split('|'); if (FF.masterProfile && FF.masterProfile.open) FF.masterProfile.open({ kind: `${ch}-agent`, name, sub: id, tlSet: new Set(), classMap: new Map(), bars: new Set() }); return; }
      const d = e.target.closest('[data-drill]'); if (d) openDrill(root, a, d.dataset.drill);
    };
    root.addEventListener('click', root.__aaClick);
    body.querySelectorAll('[data-aa-ch]').forEach((b) => b.addEventListener('click', () => FF.app.updateParams({ ch: b.dataset.aaCh === 'all' ? '' : b.dataset.aaCh, month: p.month || '' })));
    U.$('#aa-month', root).addEventListener('change', (e) => FF.app.updateParams({ month: e.target.value, ch: p.ch || '' }));
    U.$('#aa-refresh', root).addEventListener('click', () => { if (FF.app.refresh) FF.app.refresh(); else render(root, params); });
    U.$('#aa-csv', root).addEventListener('click', () => { const [h, r] = csvOf(a); U.downloadCsv(`ai-analyst-${U.stamp()}.csv`, h, r); });
  }

  FF.aiAnalyst = { analyse, narrative, drivers, drillFor };
  FF.pages.aiAnalyst = { title: 'AI Business Analyst', render };
})(window.FF);
