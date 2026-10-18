/* GV & FF Tag Issued — redesigned (v198)
   Upar date shortcuts (Today / Yesterday / Last 7 / This month …) + custom From–To.
   KPI cards: Total · VC4 · VC20 · VC5+ · VC20+VC5+ (Commercial) — har card me FF aur GV dono ka count, % share,
   combined sum, kaun aage / kaun down (previous period ke mukable). Neeche charts, head-to-head table, insights.
   Data rules: FF = EIR daily (T+1 — aaj ka FF kal aata hai, isliye FF growth like-for-like), GV = GV Master (live). */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, M = FF.model, S = FF.store, G = FF.gv, C = FF.charts;
  const esc = U.esc;

  const FF_COLOR = '#6366f1', GV_COLOR = '#0d9488';
  const PRESETS = [
    ['today', 'Today'], ['yesterday', 'Yesterday'], ['last7', 'Last 7 days'], ['last14', 'Last 14 days'],
    ['last30', 'Last 30 days'], ['thisWeek', 'This week'], ['thisMonth', 'This month'], ['lastMonth', 'Last month']
  ];
  const KPIS = [
    { key: 'total', label: 'Total Issued', short: 'Total', icon: '🏷️', accent: '#6366f1', f: '' },
    { key: 'vc4', label: 'VC4', short: 'VC4', icon: '🚗', accent: '#10b981', f: 'vc4' },
    { key: 'vc20', label: 'VC20', short: 'VC20', icon: '🚚', accent: '#f59e0b', f: 'vc20' },
    { key: 'vc5p', label: 'VC5+', short: 'VC5+', icon: '🚛', accent: '#ec4899', f: 'vc5p' },
    { key: 'comm', label: 'VC20 + VC5+', short: 'Commercial', icon: '🏭', accent: '#0ea5e9', f: 'comm', sub: 'Commercial (NVC4)' }
  ];

  const card = (title, body, right, cls) => `<section class="card ${cls || ''}"><div class="card-head"><h3>${title}</h3>${right ? `<div class="card-right">${right}</div>` : ''}</div><div class="card-body">${body}</div></section>`;

  // ---------------------------------------------------------------- date helpers (local, string keys)
  const keyOf = (d) => `${d.getFullYear()}-${U.pad2(d.getMonth() + 1)}-${U.pad2(d.getDate())}`;
  const todayKey = () => keyOf(new Date());
  const toDate = (key) => { const [y, m, d] = String(key).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
  const shiftKey = (key, days) => { const d = toDate(key); d.setDate(d.getDate() + days); return keyOf(d); };
  const dayCount = (from, to) => Math.round((toDate(to) - toDate(from)) / 86400000) + 1;
  const monthLen = (y, m0) => new Date(y, m0 + 1, 0).getDate();
  const lbl = (key, withYear) => U.labelDate(toDate(key), withYear);
  const rangeLabel = (from, to, withYear) => (from === to ? lbl(from, withYear) : `${lbl(from)} – ${lbl(to, withYear)}`);

  function presetRange(id, now) {
    const t = keyOf(now || new Date());
    const d = toDate(t);
    switch (id) {
      case 'today': return [t, t];
      case 'yesterday': { const y = shiftKey(t, -1); return [y, y]; }
      case 'last7': return [shiftKey(t, -6), t];
      case 'last14': return [shiftKey(t, -13), t];
      case 'last30': return [shiftKey(t, -29), t];
      case 'thisWeek': { const wd = (d.getDay() + 6) % 7; return [shiftKey(t, -wd), t]; }
      case 'thisMonth': return [keyOf(new Date(d.getFullYear(), d.getMonth(), 1)), t];
      case 'lastMonth': { const a = new Date(d.getFullYear(), d.getMonth() - 1, 1); return [keyOf(a), keyOf(new Date(d.getFullYear(), d.getMonth(), 0))]; }
      default: return [shiftKey(t, -6), t];
    }
  }
  function detectPreset(from, to, now) {
    for (const [id] of PRESETS) { const r = presetRange(id, now); if (r[0] === from && r[1] === to) return id; }
    return 'custom';
  }
  /** Previous comparable period. Month-aligned range (1st se) → pichhle mahine ke utne hi din; warna barabar length ka pichhla range. */
  function prevRange(from, to) {
    if (!from || !to || from > to) return null;
    const f = toDate(from), t = toDate(to);
    if (f.getDate() === 1 && f.getFullYear() === t.getFullYear() && f.getMonth() === t.getMonth()) {
      const pm = new Date(f.getFullYear(), f.getMonth() - 1, 1);
      const len = Math.min(t.getDate(), monthLen(pm.getFullYear(), pm.getMonth()));
      return [keyOf(pm), keyOf(new Date(pm.getFullYear(), pm.getMonth(), len))];
    }
    const n = dayCount(from, to);
    return [shiftKey(from, -n), shiftKey(from, -1)];
  }

  // ---------------------------------------------------------------- data
  /** Ek hi pass me total / class / ops / per-day numbers. */
  function scan(rows, from, to) {
    const out = { total: 0, vc4: 0, vc20: 0, vc5p: 0, comm: 0, issuance: 0, replacement: 0, chassis: 0, wrongVrn: 0, byClass: {}, byDay: new Map() };
    if (!from || !to || from > to) return out;
    for (const r of rows) {
      const key = r.key || (r.date ? U.dateKey(r.date) : '');
      if (!key || key < from || key > to) continue;
      const n = r.n === undefined ? 1 : (Number(r.n) || 0);
      if (!n) continue;
      out.total += n;
      if (r.group === 'VC4') out.vc4 += n; else if (r.group === 'VC20') out.vc20 += n; else out.vc5p += n;
      if (/replacement/i.test(r.type || r.status || '')) out.replacement += n; else out.issuance += n;
      if (/chassis/i.test(r.vrnType || r.tagType || '')) out.chassis += n;
      if (/wrong/i.test(r.vrnType || '')) out.wrongVrn += n;
      const cls = r.cls || '—';
      out.byClass[cls] = (out.byClass[cls] || 0) + n;
      const dd = out.byDay.get(key) || { total: 0, vc4: 0, comm: 0 };
      dd.total += n; if (r.group === 'VC4') dd.vc4 += n; else dd.comm += n;
      out.byDay.set(key, dd);
    }
    out.comm = out.vc20 + out.vc5p;
    return out;
  }

  function channelRows() {
    const rawDaily = S.get('daily') || [];
    const dailyRows = FF.filters ? FF.filters.dropLaggedFf(rawDaily) : rawDaily;
    const masterReady = !!(G && G.get && Array.isArray(G.get('master')));
    const gvTodayRows = (G && typeof G.masterTodayRows === 'function') ? (G.masterTodayRows() || [])
      : ((G && typeof G.issuanceRows === 'function') ? (G.issuanceRows() || []).filter((r) => r.channel === 'GV Partner' && r.key === todayKey()) : []);
    const gvAuthoritative = masterReady && typeof G.issuanceRows === 'function'
      ? (G.issuanceRows() || []).filter((r) => r.channel === 'GV Partner')
      : dailyRows.filter((r) => r.channel === 'GV Partner');
    const gvRows = gvAuthoritative.filter((r) => r.key !== todayKey()).concat(gvTodayRows).filter((r) => r.channel === 'GV Partner');
    const ffRows = dailyRows.filter((r) => r.channel !== 'GV Partner');
    return { ffRows, gvRows, dailyRows };
  }

  /** Dono channels ka current + previous period (FF T+1: FF like-for-like). */
  function buildModel(rows, from, to) {
    const ffThrough = (FF.filters && FF.filters.isFfPending && FF.filters.ffReportedThrough) ? FF.filters.ffReportedThrough() : to;
    const ffTo = to <= ffThrough ? to : ffThrough;
    const ffPending = ffTo < to;
    const ffComparable = ffTo >= from;
    const prevGv = prevRange(from, to);
    const prevFf = ffComparable ? prevRange(from, ffTo) : null;
    const m = {
      from, to, days: dayCount(from, to), ffTo, ffPending, ffComparable, ffThrough,
      prevGvRange: prevGv, prevFfRange: prevFf,
      ff: scan(rows.ffRows, from, to),
      gv: scan(rows.gvRows, from, to),
      ffPrev: prevFf ? scan(rows.ffRows, prevFf[0], prevFf[1]) : scan([], '', ''),
      gvPrev: prevGv ? scan(rows.gvRows, prevGv[0], prevGv[1]) : scan([], '', '')
    };
    return m;
  }

  // ---------------------------------------------------------------- view helpers
  function dirOf(cur, prev) {
    const g = U.growth(cur, prev);
    if (g === null) return prev ? 'flat' : (cur > 0 ? 'new' : 'none');
    return g > 0.5 ? 'up' : g < -0.5 ? 'down' : 'flat';
  }
  function growthBadge(cur, prev, na) {
    if (na) return '<span class="badge gray" title="FF ka data T+1 — is range ka FF kal aayega">T+1</span>';
    const d = dirOf(cur, prev);
    if (d === 'none') return '<span class="badge gray">—</span>';
    if (d === 'new') return '<span class="badge green">▲ new</span>';
    const g = U.growth(cur, prev);
    if (g === null) return '<span class="badge gray">—</span>';
    const cls = d === 'up' ? 'green' : d === 'down' ? 'red' : 'gray';
    return `<span class="badge ${cls}">${d === 'up' ? '▲' : d === 'down' ? '▼' : '•'} ${U.fmtSigned(g, 0)}</span>`;
  }
  const pct = (part, total) => { const p = U.pctOf(part, total); return p === null ? 0 : p; };

  function specFor(m, src, f) {
    const base = m.from === m.to ? `src=${src}&scope=day&date=${m.from}` : `src=${src}&scope=range&from=${m.from}&to=${m.to}`;
    return f ? `${base}&f=${f}` : base;
  }

  function verdictHtml(ffV, gvV, ffD, gvD, ffNA) {
    const sum = ffV + gvV;
    if (!sum) return '<span class="tix-v dim">Is range me data nahi</span>';
    let lead;
    if (ffV === gvV) lead = '⚖️ FF aur GV barabar';
    else if (gvV > ffV) lead = `🏆 <b>GV aage</b> · +${U.fmt(gvV - ffV)} (${U.fmtPct(pct(gvV, sum), 0)} vs ${U.fmtPct(pct(ffV, sum), 0)})`;
    else lead = `🏆 <b>FF aage</b> · +${U.fmt(ffV - gvV)} (${U.fmtPct(pct(ffV, sum), 0)} vs ${U.fmtPct(pct(gvV, sum), 0)})`;
    const downs = [];
    if (!ffNA && ffD === 'down') downs.push('FF');
    if (gvD === 'down') downs.push('GV');
    let trend;
    if (downs.length) trend = `<span class="tix-down">🔻 ${downs.join(' + ')} down</span>`;
    else if ((ffNA || ffD === 'none') && gvD === 'none') trend = '';
    else trend = '<span class="tix-up">✅ Koi down nahi</span>';
    return `<span class="tix-v">${lead}</span>${trend ? `<span class="tix-v">${trend}</span>` : ''}`;
  }

  function kpiCard(k, m) {
    const ffV = m.ff[k.key], gvV = m.gv[k.key];
    const ffP = m.ffPrev[k.key], gvP = m.gvPrev[k.key];
    const sum = ffV + gvV, sumP = ffP + gvP;
    const ffNA = !m.ffComparable;
    const ffShare = pct(ffV, sum), gvShare = pct(gvV, sum);
    const ofTotal = k.key === 'total' ? null : U.pctOf(sum, m.ff.total + m.gv.total);
    const ffD = dirOf(ffV, ffP), gvD = dirOf(gvV, gvP), sumD = dirOf(sum, sumP);
    const row = (cls, name, v, share, prev, d, na, src) => `<div class="tix-row ${cls}" data-kpi="${esc(specFor(m, src, k.f))}" data-kpi-title="${esc(`${name} · ${k.short}`)}" role="button" tabindex="0" title="Click karo — ${esc(name)} ki rows">
        <span class="tix-dot"></span><span class="tix-name">${name}</span><b class="tix-num">${U.fmt(v)}</b><span class="tix-pct">${sum ? U.fmtPct(share, 0) : '—'}</span><span class="tix-gr">${growthBadge(v, prev, na)}</span>
        <span class="tix-prev">prev ${na ? '—' : U.fmt(prev)}</span></div>`;
    return `<div class="tix-card ${d2(sumD)}" style="--accent:${k.accent}" data-kpi="${esc(specFor(m, 'both', k.f))}" data-kpi-title="${esc(`${k.label} · ${rangeLabel(m.from, m.to)}`)}" role="button" tabindex="0" title="Click karo — is number ki rows">
      <div class="tix-card-top"><span class="tix-title"><span class="tix-ico">${k.icon}</span>${esc(k.label)}${k.sub ? `<small>${esc(k.sub)}</small>` : ''}</span>${ofTotal === null ? '' : `<span class="tix-chip" title="Total issuance me is class ka hissa">${U.fmtPct(ofTotal, 0)} of total</span>`}</div>
      <div class="tix-big"><span class="tix-big-n">${U.fmt(sum)}</span><span class="tix-big-g">${growthBadge(sum, sumP)}</span></div>
      <div class="tix-bigsub">FF + GV combined · prev ${U.fmt(sumP)}</div>
      <div class="tix-split" title="FF vs GV share">${sum ? `<i class="ff" style="width:${ffShare.toFixed(1)}%"></i><i class="gv" style="width:${gvShare.toFixed(1)}%"></i>` : ''}</div>
      ${row('ff', 'First Forward', ffV, ffShare, ffP, ffD, ffNA, 'ff')}
      ${row('gv', 'GV Partner', gvV, gvShare, gvP, gvD, false, 'gv')}
      <div class="tix-verdict">${verdictHtml(ffV, gvV, ffD, gvD, ffNA)}</div>
    </div>`;
  }
  const d2 = (d) => (d === 'up' ? 'is-up' : d === 'down' ? 'is-down' : '');

  // ---------------------------------------------------------------- sections
  function trendWindow(m) {
    let from = m.from, to = m.to;
    if (dayCount(from, to) < 7) { from = shiftKey(to, -13); }
    if (dayCount(from, to) > 120) from = shiftKey(to, -119);
    return [from, to];
  }

  function chartsHtml(m, rows) {
    const { ff, gv, ffPrev, gvPrev } = m;
    const classLabels = ['VC4', 'VC20', 'VC5+', 'Commercial'];
    const vals = (o) => [o.vc4, o.vc20, o.vc5p, o.comm];
    const clsChart = C.bars({ labels: classLabels, height: 240, legendAlways: true, series: [
      { name: 'First Forward', values: vals(ff), color: FF_COLOR }, { name: 'GV Partner', values: vals(gv), color: GV_COLOR }] });
    const totalAll = ff.total + gv.total;
    const shareDonut = C.donut({ size: 150, title: U.fmtShort(totalAll), subtitle: 'Total tags', items: [
      { label: 'First Forward', value: ff.total, color: FF_COLOR }, { label: 'GV Partner', value: gv.total, color: GV_COLOR }] });
    const mixDonut = C.donut({ size: 150, title: U.fmtShort(totalAll), subtitle: 'Class mix', items: [
      { label: 'VC4', value: ff.vc4 + gv.vc4, color: '#10b981' }, { label: 'VC20', value: ff.vc20 + gv.vc20, color: '#f59e0b' }, { label: 'VC5+', value: ff.vc5p + gv.vc5p, color: '#ec4899' }] });
    const [tf, tt] = trendWindow(m);
    const labels = [], ffV = [], gvV = [], totV = [], tipLabels = [];
    for (let k = tf; k <= tt; k = shiftKey(k, 1)) {
      const ffPend = !!(FF.filters && FF.filters.isFfPending && FF.filters.isFfPending(k));
      const a = rows.ffMap.get(k), b = rows.gvMap.get(k);
      const av = a ? a.total : 0, bv = b ? b.total : 0;
      labels.push(lbl(k)); tipLabels.push(lbl(k, true));
      ffV.push(ffPend ? null : av); gvV.push(bv); totV.push(ffPend ? null : av + bv);
    }
    const trend = C.lines({ labels, tipLabels, height: 240, series: [
      { name: 'Total', values: totV, color: '#f97316', dash: true, area: false },
      { name: 'First Forward', values: ffV, color: FF_COLOR }, { name: 'GV Partner', values: gvV, color: GV_COLOR }] });
    const dailyBars = C.bars({ labels, tipLabels, height: 230, legendAlways: true, series: [
      { name: 'First Forward', values: ffV.map((v) => v || 0), color: FF_COLOR }, { name: 'GV Partner', values: gvV, color: GV_COLOR }] });
    const cmpLabels = ['Total', 'VC4', 'VC20', 'VC5+', 'Commercial'];
    const keys = ['total', 'vc4', 'vc20', 'vc5p', 'comm'];
    const prevName = m.prevGvRange ? `Prev ${rangeLabel(m.prevGvRange[0], m.prevGvRange[1])}` : 'Prev';
    const ffCmp = C.bars({ labels: cmpLabels, height: 220, legendAlways: true, series: [
      { name: m.ffComparable ? 'Prev' : 'Prev (T+1)', values: keys.map((k) => ffPrev[k]), color: '#c7d2fe' }, { name: 'Selected', values: keys.map((k) => ff[k]), color: FF_COLOR }] });
    const gvCmp = C.bars({ labels: cmpLabels, height: 220, legendAlways: true, series: [
      { name: 'Prev', values: keys.map((k) => gvPrev[k]), color: '#99f6e4' }, { name: 'Selected', values: keys.map((k) => gv[k]), color: GV_COLOR }] });
    const growthBars = C.hbars({ valueLabel: 'Selected', compareLabel: 'Prev', items: KPIS.map((k) => ({
      label: k.short, sub: `FF ${U.fmt(ff[k.key])} · GV ${U.fmt(gv[k.key])}`, value: ff[k.key] + gv[k.key], compare: ffPrev[k.key] + gvPrev[k.key], color: k.accent })) });
    return `
      <div class="grid g-2">
        ${card('📊 Class-wise · FF vs GV', clsChart, `<span class="badge indigo">${U.fmt(totalAll)} total</span>`)}
        ${card('🥧 Share · kaun kitna', `<div class="tix-donuts"><div><h4>FF vs GV</h4>${shareDonut}</div><div><h4>Class mix (combined)</h4>${mixDonut}</div></div>`)}
      </div>
      <div class="grid g-2">
        ${card(`📈 Daily trend · ${esc(rangeLabel(tf, tt))}`, trend + (FF.filters && FF.filters.isFfPending && FF.filters.isFfPending(tt) ? '<p class="dim small">FF T+1 hai — aaj ka FF graph me gap dikhta hai (kal aayega).</p>' : ''))}
        ${card('🗓️ Daily volume · FF + GV', dailyBars)}
      </div>
      <div class="grid g-2">
        ${card(`🔁 Selected vs ${esc(prevName)} · Combined`, growthBars, '<span class="dim small">bar = selected, line = pichhla period</span>')}
        <div class="tix-stack">
          ${card('🟦 First Forward · prev vs selected', ffCmp, `<span class="badge indigo">${U.fmt(ff.total)} tags</span>`)}
          ${card('🟩 GV Partner · prev vs selected', gvCmp, `<span class="badge teal">${U.fmt(gv.total)} tags</span>`)}
        </div>
      </div>`;
  }

  function insightsHtml(m, rows, presetId) {
    const { ff, gv, ffPrev, gvPrev } = m;
    const total = ff.total + gv.total, totalP = ffPrev.total + gvPrev.total;
    const out = [];
    if (!total) return '<p class="dim">Is range me koi issuance data nahi mila.</p>';
    const leadName = gv.total === ff.total ? null : gv.total > ff.total ? 'GV' : 'FF';
    out.push(`Total <b>${U.fmt(total)}</b> tags · FF <b>${U.fmt(ff.total)}</b> (${U.fmtPct(pct(ff.total, total), 0)}) · GV <b>${U.fmt(gv.total)}</b> (${U.fmtPct(pct(gv.total, total), 0)})${leadName ? ` — <b>${leadName}</b> ${U.fmt(Math.abs(gv.total - ff.total))} se aage.` : ' — dono barabar.'}`);
    const g = (c, p) => U.growth(c, p);
    const gT = g(total, totalP), gF = m.ffComparable ? g(ff.total, ffPrev.total) : null, gG = g(gv.total, gvPrev.total);
    const word = (x) => (x === null ? '—' : `${x > 0.5 ? '▲' : x < -0.5 ? '▼' : '•'} ${U.fmtSigned(x, 0)}`);
    out.push(`Previous period ke mukable: Total <b>${word(gT)}</b> · FF <b>${m.ffComparable ? word(gF) : 'T+1 (kal aayega)'}</b> · GV <b>${word(gG)}</b>.${gG !== null && gG < -0.5 && (gF === null || gF >= 0) ? ' ⚠️ GV down hai.' : ''}${gF !== null && gF < -0.5 && (gG === null || gG >= 0) ? ' ⚠️ FF down hai.' : ''}`);
    const mix = (o, key) => pct(o[key], o.total);
    out.push(`VC4 mix: FF <b>${U.fmtPct(mix(ff, 'vc4'), 0)}</b> vs GV <b>${U.fmtPct(mix(gv, 'vc4'), 0)}</b> — ${mix(gv, 'vc4') > mix(ff, 'vc4') ? 'GV ka VC4 (payable) mix behtar hai' : mix(gv, 'vc4') < mix(ff, 'vc4') ? 'FF ka VC4 (payable) mix behtar hai' : 'dono barabar'}.`);
    out.push(`Commercial (VC20 + VC5+) <b>${U.fmt(ff.comm + gv.comm)}</b> — FF ${U.fmt(ff.comm)} (VC20 ${U.fmt(ff.vc20)} + VC5+ ${U.fmt(ff.vc5p)}) vs GV ${U.fmt(gv.comm)} (VC20 ${U.fmt(gv.vc20)} + VC5+ ${U.fmt(gv.vc5p)}).`);
    const leaders = ['vc4', 'vc20', 'vc5p'].map((k) => ({ k: k === 'vc5p' ? 'VC5+' : k.toUpperCase(), lead: gv[k] === ff[k] ? '=' : gv[k] > ff[k] ? 'GV' : 'FF' }));
    out.push(`Class leader: ${leaders.map((x) => `${x.k} → <b>${x.lead}</b>`).join(' · ')}.`);
    // best / lowest day
    const days = new Map();
    ff.byDay.forEach((v, k) => days.set(k, (days.get(k) || 0) + v.total));
    gv.byDay.forEach((v, k) => days.set(k, (days.get(k) || 0) + v.total));
    const arr = [...days].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (arr.length > 1) {
      out.push(`Best din <b>${esc(lbl(arr[0][0], true))}</b> (${U.fmt(arr[0][1])}) · sabse kam <b>${esc(lbl(arr[arr.length - 1][0], true))}</b> (${U.fmt(arr[arr.length - 1][1])}).`);
    }
    if (m.days > 1) {
      const ffDays = m.ffComparable ? dayCount(m.from, m.ffTo) : 0;
      out.push(`Daily average: GV <b>${U.fmt(gv.total / m.days, 1)}</b>/din${ffDays ? ` · FF <b>${U.fmt(ff.total / ffDays, 1)}</b>/din` : ''}.`);
    }
    // biggest class movement (combined)
    const cls = U.uniq([...Object.keys(ff.byClass), ...Object.keys(gv.byClass), ...Object.keys(ffPrev.byClass), ...Object.keys(gvPrev.byClass)]);
    const moves = cls.map((c) => { const cur = (ff.byClass[c] || 0) + (gv.byClass[c] || 0); const pv = (ffPrev.byClass[c] || 0) + (gvPrev.byClass[c] || 0); return { c, cur, diff: cur - pv }; }).filter((x) => x.diff !== 0).sort((a, b) => b.diff - a.diff);
    if (moves.length) {
      const up = moves[0], dn = moves[moves.length - 1];
      out.push(`Class movement: ${up.diff > 0 ? `<b>${esc(up.c)}</b> sabse zyada up (+${U.fmt(up.diff)})` : ''}${up.diff > 0 && dn.diff < 0 ? ' · ' : ''}${dn.diff < 0 ? `<b>${esc(dn.c)}</b> sabse zyada down (${U.fmt(dn.diff)})` : ''}.`);
    }
    // month projection
    const nowKey = todayKey();
    const t = toDate(m.to);
    if (m.from.slice(8) === '01' && m.from.slice(0, 7) === m.to.slice(0, 7) && m.to.slice(0, 7) === nowKey.slice(0, 7) && m.days >= 3) {
      const ml = monthLen(t.getFullYear(), t.getMonth());
      out.push(`Run-rate: GV is raftaar se month-end tak ~<b>${U.fmt(Math.round(gv.total / m.days * ml))}</b> tags${m.ffComparable ? ` · FF ~<b>${U.fmt(Math.round(ff.total / dayCount(m.from, m.ffTo) * ml))}</b>` : ''}.`);
    }
    if (m.ffPending) out.push(`🟦 FF data T+1 hai — <b>${esc(lbl(m.ffThrough, true))}</b> tak ka FF aaya hai; uske baad ka FF kal aayega. FF growth isi wajah se like-for-like dikhaya gaya hai.`);
    return `<ul class="insight-list">${out.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  }

  function h2hTable(m) {
    const { ff, gv, ffPrev, gvPrev } = m;
    const defs = [['Total', 'total'], ['VC4', 'vc4'], ['VC20', 'vc20'], ['VC5+', 'vc5p'], ['VC20 + VC5+ (Commercial)', 'comm'], ['Issuance', 'issuance'], ['Replacement', 'replacement'], ['Chassis', 'chassis'], ['Wrong VRN', 'wrongVrn']];
    const rowsHtml = defs.map(([label, key]) => {
      const a = ff[key], b = gv[key], s = a + b;
      const lead = !s ? '—' : a === b ? '=' : b > a ? `GV +${U.fmt(b - a)}` : `FF +${U.fmt(a - b)}`;
      const strong = key === 'total' || key === 'comm' ? ' class="tix-strong"' : '';
      return `<tr${strong}><td>${esc(label)}</td><td class="num">${U.fmt(a)}</td><td class="num dim">${s ? U.fmtPct(pct(a, s), 0) : '—'}</td><td class="num">${U.fmt(b)}</td><td class="num dim">${s ? U.fmtPct(pct(b, s), 0) : '—'}</td><td class="num"><b>${U.fmt(s)}</b></td><td>${lead}</td><td>${growthBadge(a, ffPrev[key], !m.ffComparable)}</td><td>${growthBadge(b, gvPrev[key])}</td><td>${growthBadge(s, ffPrev[key] + gvPrev[key])}</td></tr>`;
    }).join('');
    return `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Metric</th><th class="num">FF</th><th class="num">FF %</th><th class="num">GV</th><th class="num">GV %</th><th class="num">Combined</th><th>Lead</th><th>FF vs prev</th><th>GV vs prev</th><th>Total vs prev</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
      <p class="dim small">GV Master me Wrong VRN alag field nahi hai (GV ke liye 0 / unavailable). Chassis = chassis type wale tags.</p>`;
  }

  function classTable(m) {
    const { ff, gv, ffPrev, gvPrev } = m;
    const all = U.uniq([...Object.keys(ff.byClass), ...Object.keys(gv.byClass), ...Object.keys(ffPrev.byClass), ...Object.keys(gvPrev.byClass)]).sort((a, b) => (parseInt(a.replace(/\D/g, ''), 10) || 999) - (parseInt(b.replace(/\D/g, ''), 10) || 999));
    const rows = all.map((c) => {
      const a = ff.byClass[c] || 0, ap = ffPrev.byClass[c] || 0, b = gv.byClass[c] || 0, bp = gvPrev.byClass[c] || 0;
      return `<tr><td><b>${esc(c)}</b> <small class="dim">${esc(M.classGroup(c))}</small></td>
        <td class="num"><b>${U.fmt(a)}</b></td><td class="num">${m.ffComparable ? U.fmt(ap) : '—'}</td><td>${growthBadge(a, ap, !m.ffComparable)}</td>
        <td class="num"><b>${U.fmt(b)}</b></td><td class="num">${U.fmt(bp)}</td><td>${growthBadge(b, bp)}</td>
        <td class="num"><b>${U.fmt(a + b)}</b></td><td class="num">${U.fmt(ap + bp)}</td><td>${growthBadge(a + b, ap + bp)}</td></tr>`;
    }).join('');
    return `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Class</th><th class="num">FF</th><th class="num">FF prev</th><th>FF Δ</th><th class="num">GV</th><th class="num">GV prev</th><th>GV Δ</th><th class="num">Total</th><th class="num">Total prev</th><th>Total Δ</th></tr></thead><tbody>${rows || '<tr><td colspan="10" class="empty">Is range me koi data nahi</td></tr>'}</tbody></table></div>`;
  }

  function peopleHtml(m, rows) {
    const rankCount = Math.max(5, Math.min(20, Number((function () { try { return localStorage.getItem('ti_chart_limit'); } catch (e) { return 0; } })()) || 10));
    const gvAgentMap = new Map(), gvTlMap = new Map();
    rows.gvRows.forEach((r) => {
      const key = r.key || '';
      if (key < m.from || key > m.to) return;
      const n = r.n === undefined ? 1 : (Number(r.n) || 0);
      const k = r.agentName || r.agentId || 'Unknown';
      const o = gvAgentMap.get(k) || { total: 0, vc4: 0, comm: 0 };
      o.total += n; if (r.group === 'VC4') o.vc4 += n; else o.comm += n; gvAgentMap.set(k, o);
      const tl = FF.config.isDirectAgent(r, 'gv') ? FF.config.directLabel(r, 'gv') : (r.tlName || 'Unassigned');
      gvTlMap.set(tl, (gvTlMap.get(tl) || 0) + n);
    });
    const top = (sel) => [...gvAgentMap].sort((a, b) => sel(b[1]) - sel(a[1])).slice(0, rankCount);
    const ffMonths = new Set(rows.ffRows.filter((r) => (r.key || '') >= m.from && (r.key || '') <= m.to).map((r) => r.ym));
    const ffAgentTotals = new Map();
    (S.get('agents') || []).forEach((a) => { if (a.channel === 'First Forward' && ffMonths.has(a.ym)) ffAgentTotals.set(a.name, (ffAgentTotals.get(a.name) || 0) + a.n); });
    const topFf = U.topEntries(ffAgentTotals, rankCount);
    const hb = (list, sel, valueLabel, off) => C.hbars({ valueLabel, items: list.map(([name, o], i) => ({ label: name, sub: sel === 'total' ? `VC4 ${U.fmt(o.vc4)} · Commercial ${U.fmt(o.comm)}` : '', value: o[sel], color: C.PALETTE[(i + off) % C.PALETTE.length] })) });
    return `<div class="grid g-2">${card('🏆 Top GV agents', hb(top((o) => o.total), 'total', 'Tags', 0))}${card('⭐ Top First Forward agents', `${C.hbars({ valueLabel: 'Tags', items: topFf.map(([name, n], i) => ({ label: name, value: n, color: C.PALETTE[i % C.PALETTE.length] })) })}<small class="dim">FF agent source month-level hai — partial month me poora month judta hai.</small>`)}</div>
      <div class="grid g-2">${card('🚗 Top GV VC4 agents', hb(top((o) => o.vc4), 'vc4', 'VC4 tags', 0))}${card('🚚 Top GV Commercial agents', hb(top((o) => o.comm), 'comm', 'Commercial tags', 3))}</div>
      ${card('🏢 Top GV teams / supervisors', C.hbars({ valueLabel: 'Tags', items: U.topEntries(gvTlMap, rankCount).map(([name, n], i) => ({ label: name, value: n, color: C.PALETTE[(i + 5) % C.PALETTE.length] })) }))}`;
  }

  // ---------------------------------------------------------------- page
  const store = {
    get(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };

  async function render(root, params) {
    params = params || {};
    const now = new Date();
    let from, to, preset;
    if (params.from || params.to || params.date) {
      to = params.to || params.date || params.from; from = params.from || to;
      preset = detectPreset(from, to, now);
    } else {
      preset = PRESETS.some(([id]) => id === store.get('ti_preset', '')) ? store.get('ti_preset', 'last7') : 'last7';
      [from, to] = presetRange(preset, now);
    }
    if (from > to) { const t = from; from = to; to = t; }

    root.innerHTML = `<div class="page-head"><div><h1>🏷️ GV & FF Tag Issued</h1><p class="sub">GV Partner vs First Forward — VC4 · VC20 · VC5+ · Commercial, share %, up/down aur graphs</p></div>
      <div class="head-actions"><button class="btn primary" data-action="refresh">↻ Refresh</button></div></div>
      <div class="card tix-toolbar">
        <div class="tix-presets" id="ti-presets" role="group" aria-label="Date shortcuts">${PRESETS.map(([id, label]) => `<button type="button" class="tix-chipbtn" data-preset="${id}">${label}</button>`).join('')}<button type="button" class="tix-chipbtn" data-preset="custom">Custom</button></div>
        <div class="tix-dates">
          <label>📅 From <input type="date" class="input" id="ti-from" value="${esc(from)}" max="${todayKey()}"></label>
          <label>To <input type="date" class="input" id="ti-date" value="${esc(to)}" max="${todayKey()}"></label>
          <button class="btn small" type="button" id="ti-apply">Apply</button>
        </div>
        <div class="tix-rangeinfo" id="ti-info"></div>
      </div>
      <div id="ti-body">${U.spinner('Data load ho raha hai…')}</div>`;

    const body = U.$('#ti-body', root), fromInput = U.$('#ti-from', root), toInput = U.$('#ti-date', root), info = U.$('#ti-info', root), presetBox = U.$('#ti-presets', root);

    try {
      await Promise.all([S.need('daily').catch(() => []), G.need('master').catch(() => [])]);
    } catch (e) {
      body.innerHTML = U.errorBox(e, 'data-action="refresh"');
      return;
    }

    function paintPresets() {
      U.$$('[data-preset]', presetBox).forEach((b) => b.classList.toggle('active', b.getAttribute('data-preset') === preset));
    }

    function draw() {
      paintPresets();
      fromInput.value = from; toInput.value = to;
      const rows = channelRows();
      rows.ffMap = scanDays(rows.ffRows);
      rows.gvMap = scanDays(rows.gvRows);
      const m = buildModel(rows, from, to);
      const prevTxt = m.prevGvRange ? `vs ${esc(rangeLabel(m.prevGvRange[0], m.prevGvRange[1], true))}` : '';
      info.innerHTML = `<span class="badge indigo">${esc(rangeLabel(from, to, true))}</span> <span class="dim">${m.days} din ${prevTxt ? `· ${prevTxt}` : ''}</span> ${m.ffPending ? `<span class="badge amber" title="First Forward ka issuance T+1 aata hai — ${esc(lbl(m.ffThrough, true))} ke baad ka FF kal aayega. GV live hai.">🟦 FF T+1 · ${m.ffComparable ? `FF ${esc(lbl(m.ffThrough))} tak` : 'FF kal aayega'}</span>` : ''}`;
      const total = m.ff.total + m.gv.total;
      const totalP = m.ffPrev.total + m.gvPrev.total;

      body.innerHTML = `
        <div class="tix-grid">${KPIS.map((k) => kpiCard(k, m)).join('')}</div>
        ${card(`⚔️ Head-to-head · FF vs GV · ${esc(rangeLabel(from, to, true))}`, h2hTable(m), `<span class="badge indigo">${U.fmt(total)} tags</span> <span class="dim small">prev ${U.fmt(totalP)}</span> <button class="btn small" data-action="export" data-name="tag-issued-${esc(from)}-${esc(to)}">⬇ CSV</button>`)}
        ${chartsHtml(m, rows)}
        <div class="grid g-2">
          ${card('💡 Insights · data ko dekh kar', insightsHtml(m, rows, preset))}
          ${card('📋 Class-wise detail', classTable(m), '')}
        </div>
        <details class="tix-people" open><summary>👥 Agents & Teams</summary>${peopleHtml(m, rows)}</details>
        <p class="foot-note">Source: EIR (FF, T+1) + GV Master (GV, live) · ${esc(rangeLabel(from, to, true))} · Data ${U.timeLabel(S.loadedAt || G.loadedAt || Date.now())} · ↻ se fresh data</p>`;
      C.mount(body);

      const newHash = `#/tagIssued?from=${from}&to=${to}&date=${to}`;
      if (location.hash !== newHash) { try { history.replaceState(null, '', newHash); } catch (e) { /* ignore */ } }
    }

    function scanDays(list) {
      const map = new Map();
      for (const r of list) {
        const key = r.key || (r.date ? U.dateKey(r.date) : '');
        if (!key) continue;
        const n = r.n === undefined ? 1 : (Number(r.n) || 0);
        const o = map.get(key) || { total: 0 };
        o.total += n; map.set(key, o);
      }
      return map;
    }

    function applyCustom() {
      let f = fromInput.value || toInput.value || todayKey(), t = toInput.value || f;
      if (f > t) { const x = f; f = t; t = x; }
      from = f; to = t;
      preset = detectPreset(from, to, new Date());
      if (preset !== 'custom') store.set('ti_preset', preset);
      draw();
    }

    presetBox.addEventListener('click', (e) => {
      const b = e.target.closest('[data-preset]');
      if (!b) return;
      const id = b.getAttribute('data-preset');
      if (id === 'custom') { preset = 'custom'; paintPresets(); fromInput.focus(); return; }
      preset = id; [from, to] = presetRange(id, new Date());
      store.set('ti_preset', id);
      draw();
    });
    fromInput.addEventListener('change', applyCustom);
    toInput.addEventListener('change', applyCustom);
    U.$('#ti-apply', root).addEventListener('click', applyCustom);

    draw();
  }

  FF.pages.tagIssued = { title: 'GV & FF Tag Issued', render };
  FF.pages.tagIssued._test = { presetRange, prevRange, detectPreset, scan, buildModel, dayCount, shiftKey };
})(window.FF);
