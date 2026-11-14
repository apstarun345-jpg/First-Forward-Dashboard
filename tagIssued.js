/* GV & FF Tag Issued — redesigned (v198)
   Upar date shortcuts (Today / Yesterday / Last 7 / This month …) + custom From–To.
   KPI cards: Total · VC4 · VC20 · VC5+ · VC20+VC5+ (Commercial) — har card me FF aur GV dono ka count, % share,
   combined sum, kaun aage / kaun down (previous period ke mukable). Neeche charts, head-to-head table, insights.
   Data rules: totals = EIR sheet dono channel ke liye (GV = EIR me master ID 5845036 wali rows, FF = baaki). EIR T+1 hai —
   aaj ka data kal aata hai, isliye growth like-for-like. Top agents / teams (GV) GV Master sheet se. */
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
    { key: 'vc4', label: 'VC4', short: 'VC4', icon: '🚗', accent: '#2563eb', f: 'vc4' },
    { key: 'vc20', label: 'VC20', short: 'VC20', icon: '🚚', accent: '#f59e0b', f: 'vc20' },
    { key: 'vc5p', label: 'VC5+', short: 'VC5+', icon: '🚛', accent: '#ea580c', f: 'vc5p' },
    { key: 'comm', label: 'VC20 + VC5+', short: 'Commercial', icon: '🏭', accent: '#f97316', f: 'comm', sub: 'Commercial (NVC4)' }
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
    // 🧾 Totals: EIR daily rows. Channel EIR master ID se tay hota hai (5845036 = GV Partner) — model.channelOf.
    const ffRows = dailyRows.filter((r) => r.channel !== 'GV Partner');
    const gvRows = dailyRows.filter((r) => r.channel === 'GV Partner');
    let gvLatest = '';
    for (const r of gvRows) { const k = r.key || (r.date ? U.dateKey(r.date) : ''); if (k > gvLatest) gvLatest = k; }
    // 👥 Top agents / teams: GV Master sheet (row-level, agent + TL names ke saath).
    const masterReady = !!(G && G.get && Array.isArray(G.get('master')));
    const gvMasterRows = masterReady && typeof G.issuanceRows === 'function'
      ? (G.issuanceRows() || []).filter((r) => r.channel === 'GV Partner') : [];
    let ffLatest = '';
    for (const r of ffRows) { const k = r.key || (r.date ? U.dateKey(r.date) : ''); if (k > ffLatest) ffLatest = k; }
    // 🔎 Raw GV Master (ek row = ek tag) — sirf data-check ke liye; totals me use nahi hota.
    const rawMaster = (G && typeof G.masterRows === 'function' ? G.masterRows() : null) || [];
    const masterRows = rawMaster.filter((r) => r && r.date).map((r) => ({
      key: U.dateKey(r.date), group: r.group || (M.classGroup ? M.classGroup(r.cls) : 'VC4'), cls: r.cls, n: 1,
      type: /replacement/i.test(`${r.status || ''} ${r.tagType || ''}`) ? 'REPLACEMENT' : 'ISSUANCE'
    }));
    let masterLatest = '';
    for (const r of masterRows) if (r.key > masterLatest) masterLatest = r.key;
    return { ffRows, gvRows, gvLatest, ffLatest, masterRows, masterLatest, gvMasterRows, dailyRows };
  }

  const personKey = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  /** Unique channel-specific agent/TL names that have rows inside the selected date range. */
  function personSearchOptions(rows, from, to, channel) {
    const found = new Map();
    for (const r of rows || []) {
      const key = r.key || (r.date ? U.dateKey(r.date) : '');
      if (!key || key < from || key > to) continue;
      for (const [type, rawName] of [['agent', r.agentName || r.agentId], ['tl', r.tlName]]) {
        const name = String(rawName || '').trim().replace(/\s+/g, ' ');
        const norm = personKey(name);
        if (!norm || norm === 'unknown' || norm === 'unassigned') continue;
        const ch = channel === 'ff' ? 'ff' : 'gv';
        const id = `${ch}:${type}:${norm}`;
        if (!found.has(id)) found.set(id, { channel: ch, type, name });
      }
    }
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.channel.localeCompare(b.channel) || a.type.localeCompare(b.type));
  }
  /** 🔎 v3.125.262 — SAARE GV + FF agents / TLs (har date + REPORT lists), sirf selected range wale nahi.
   *  Har naam ke saath range me kitne tags (ranking + dropdown me dikhane ke liye). */
  function personDirectory(src, from, to) {
    const found = new Map();
    const add = (channel, type, rawName, n, inRange, id) => {
      const name = String(rawName || '').trim().replace(/\s+/g, ' ');
      const norm = personKey(name);
      if (!norm || norm === 'unknown' || norm === 'unassigned' || norm === '—' || /^(aps|direct)$/i.test(norm)) return;
      if (/^\d{1,2}[ -][a-z]{3}[ -]\d{4}$|\b1899\b/i.test(name)) return;
      const k = `${channel}:${type}:${norm}`;
      let o = found.get(k);
      if (!o) { o = { channel, type, name, n: 0, ids: new Set() }; found.set(k, o); }
      if (inRange) o.n += Number(n) || 0;
      if (id) o.ids.add(String(id));
    };
    const scanRows = (rows, channel) => {
      for (const r of rows || []) {
        const key = r.key || (r.date ? U.dateKey(r.date) : '');
        const inR = !!key && key >= from && key <= to;
        add(channel, 'agent', r.agentName || r.agentId, r.n || 1, inR, r.agentId);
        add(channel, 'tl', r.tlName, r.n || 1, inR, r.tlId);
      }
    };
    scanRows(src.ffRows, 'ff');
    scanRows(src.gvMasterRows, 'gv');
    scanRows(src.gvRows, 'gv');
    (src.ffAgents || []).forEach((a) => { add('ff', 'agent', a.name, 0, false, a.id); add('ff', 'tl', a.tlName, 0, false); });
    (src.gvReport || []).forEach((a) => { add('gv', 'agent', a.agentName || a.name, 0, false, a.agentId); add('gv', 'tl', a.tlName, 0, false, a.tlId); });
    return [...found.values()].map((o) => ({ channel: o.channel, type: o.type, name: o.name, n: o.n, ids: [...o.ids].slice(0, 3) }))
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  }
  function personSearchSummary(rows, selected, from, to) {
    if (!selected || !selected.name || !['agent', 'tl'].includes(selected.type)) return null;
    const target = personKey(selected.name);
    const matches = (rows || []).filter((r) => {
      const key = r.key || (r.date ? U.dateKey(r.date) : '');
      if (!key || key < from || key > to) return false;
      return personKey(selected.type === 'tl' ? r.tlName : (r.agentName || r.agentId)) === target;
    });
    return { type: selected.type, name: String(selected.name).trim(), rows: matches, totals: scan(matches, from, to) };
  }
  function personCardModel(m, gvRows, ffRows, selected) {
    if (!selected || !selected.name || !['agent', 'tl'].includes(selected.type)) return m;
    const channel = selected.channel === 'ff' ? 'ff' : 'gv';
    const sourceRows = channel === 'ff' ? (ffRows || []) : (gvRows || []);
    const target = personKey(selected.name);
    const matches = sourceRows.filter((r) => personKey(selected.type === 'tl' ? r.tlName : (r.agentName || r.agentId || r.name)) === target);
    const empty = (from, to) => scan([], from || '', to || '');
    const withinRange = (from, to) => matches.filter((r) => { const key = r.key || r.dateKey || (r.date ? U.dateKey(r.date) : ''); return !!key && key >= from && key <= to; });
    const current = scan(withinRange(m.from, m.to), m.from, m.to);
    const prevRange = channel === 'ff' ? m.prevFfRange : m.prevGvRange;
    const prev2Range = channel === 'ff' ? m.prevFf2Range : m.prevGv2Range;
    const previous = prevRange ? scan(withinRange(prevRange[0], prevRange[1]), prevRange[0], prevRange[1]) : empty('', '');
    const previous2 = prev2Range ? scan(withinRange(prev2Range[0], prev2Range[1]), prev2Range[0], prev2Range[1]) : empty('', '');
    const blank = empty(m.from, m.to);
    const selectedChannel = channel === 'ff'
      ? { ff: current, ffPrev: previous, ffPrev2: previous2, gv: blank, gvPrev: empty('', ''), gvPrev2: empty('', '') }
      : { ff: blank, ffPrev: empty('', ''), ffPrev2: empty('', ''), gv: current, gvPrev: previous, gvPrev2: previous2 };
    return {
      ...m, ...selectedChannel,
      personFilter: { channel, type: selected.type, name: String(selected.name).trim() },
      ffComparable: true, gvComparable: true, ffPending: false, gvPending: false
    };
  }

  /** Dono channels ka current + previous period (FF T+1: FF like-for-like). */
  function buildModel(rows, from, to) {
    const ffThrough = (FF.filters && FF.filters.isFfPending && FF.filters.ffReportedThrough) ? FF.filters.ffReportedThrough() : to;
    const ffTo = to <= ffThrough ? to : ffThrough;
    const ffPending = ffTo < to;
    const ffComparable = ffTo >= from;
    // GV bhi EIR se aata hai (T+1): agar range aaj/kal tak jaati hai aur GV ki latest EIR date usse pehle hai to GV bhi "pending".
    const yesterday = shiftKey(todayKey(), -1);
    const gvThrough = rows.gvLatest || '';
    const gvTrim = !!gvThrough && to > gvThrough && to >= yesterday;
    const gvTo = gvTrim ? gvThrough : to;
    const gvPending = gvTo < to;
    const gvComparable = gvTo >= from;
    const prevGv = gvComparable ? prevRange(from, gvTo) : prevRange(from, to);
    const prevFf = ffComparable ? prevRange(from, ffTo) : null;
    // v3.125.95 — pichhle se pichhla period bhi (Nov → Oct + Sep)
    const prevGv2 = prevGv ? prevRange(prevGv[0], prevGv[1]) : null;
    const prevFf2 = prevFf ? prevRange(prevFf[0], prevFf[1]) : null;
    return {
      from, to, days: dayCount(from, to), ffTo, ffPending, ffComparable, ffThrough, gvTo, gvPending, gvComparable, gvThrough,
      prevGvRange: prevGv, prevFfRange: prevFf, prevGv2Range: prevGv2, prevFf2Range: prevFf2,
      ff: scan(rows.ffRows, from, to),
      gv: scan(rows.gvRows, from, to),
      ffPrev: prevFf ? scan(rows.ffRows, prevFf[0], prevFf[1]) : scan([], '', ''),
      gvPrev: gvComparable && prevGv ? scan(rows.gvRows, prevGv[0], prevGv[1]) : scan([], '', ''),
      ffPrev2: prevFf2 ? scan(rows.ffRows, prevFf2[0], prevFf2[1]) : scan([], '', ''),
      gvPrev2: gvComparable && prevGv2 ? scan(rows.gvRows, prevGv2[0], prevGv2[1]) : scan([], '', '')
    };
  }

  // ---------------------------------------------------------------- view helpers
  function dirOf(cur, prev) {
    const g = U.growth(cur, prev);
    if (g === null) return prev ? 'flat' : (cur > 0 ? 'new' : 'none');
    return g > 0.5 ? 'up' : g < -0.5 ? 'down' : 'flat';
  }
  function growthBadge(cur, prev, na) {
    if (na) return '<span class="badge gray" title="EIR data T+1 hai — is range ka data kal aayega">T+1</span>';
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
    const pf = m.personFilter;
    if (pf) src = pf.channel;            // searched agent / TL → sirf uska channel
    let base = (m.from === m.to ? `src=${src}&scope=day&date=${m.from}` : `src=${src}&scope=range&from=${m.from}&to=${m.to}`);
    // GV person = GV Master rows (KPI isi se bana) → drill bhi wahi; baaki EIR-only jaise pehle
    if (!(pf && pf.channel === 'gv')) base += '&eir=1';
    if (pf) base += `&${pf.type === 'tl' ? 'tl' : 'agent'}=${encodeURIComponent(pf.name)}&channel=${pf.channel}&pf=1`;
    return f ? `${base}&f=${f}` : base;
  }

  function verdictHtml(ffV, gvV, ffD, gvD, ffNA, gvNA) {
    const sum = ffV + gvV;
    if (!sum) return '<span class="tix-v dim">Is range me data nahi</span>';
    let lead;
    if (ffV === gvV) lead = '⚖️ FF aur GV barabar';
    else if (gvV > ffV) lead = `🏆 <b>GV aage</b> · +${U.fmt(gvV - ffV)} (${U.fmtPct(pct(gvV, sum), 0)} vs ${U.fmtPct(pct(ffV, sum), 0)})`;
    else lead = `🏆 <b>FF aage</b> · +${U.fmt(ffV - gvV)} (${U.fmtPct(pct(ffV, sum), 0)} vs ${U.fmtPct(pct(gvV, sum), 0)})`;
    const downs = [];
    if (!ffNA && ffD === 'down') downs.push('FF');
    if (!gvNA && gvD === 'down') downs.push('GV');
    let trend;
    if (downs.length) trend = `<span class="tix-down">🔻 ${downs.join(' + ')} down</span>`;
    else if ((ffNA || ffD === 'none') && (gvNA || gvD === 'none')) trend = '';
    else trend = '<span class="tix-up">✅ Koi down nahi</span>';
    return `<span class="tix-v">${lead}</span>${trend ? `<span class="tix-v">${trend}</span>` : ''}`;
  }

  function kpiCard(k, m, canDrill) {
    const ffV = m.ff[k.key], gvV = m.gv[k.key];
    const ffP = m.ffPrev[k.key], gvP = m.gvPrev[k.key];
    const sum = ffV + gvV, sumP = ffP + gvP;
    const ffP2 = m.ffPrev2 ? m.ffPrev2[k.key] : 0, gvP2 = m.gvPrev2 ? m.gvPrev2[k.key] : 0, sumP2 = ffP2 + gvP2;
    const ffNA = !m.ffComparable, gvNA = !m.gvComparable;
    const ffShare = pct(ffV, sum), gvShare = pct(gvV, sum);
    const ofTotal = k.key === 'total' ? null : U.pctOf(sum, m.ff.total + m.gv.total);
    const ffD = dirOf(ffV, ffP), gvD = dirOf(gvV, gvP), sumD = dirOf(sum, sumP);
    const row = (cls, name, v, share, prev, d, na, src) => {
      const oldRange = src === 'ff' ? m.prevFf2Range : m.prevGv2Range;
      const oldValue = src === 'ff' ? ffP2 : gvP2;
      const priorRange = src === 'ff' ? m.prevFfRange : m.prevGvRange;
      const prior = priorRange ? rangeLabel(priorRange[0], priorRange[1]) : 'range unavailable';
      const earlier = oldRange ? rangeLabel(oldRange[0], oldRange[1]) : '2 periods ago';
      const notSelected = !!m.personFilter && src !== m.personFilter.channel;
      const filteredName = m.personFilter && src === m.personFilter.channel
        ? `${name} · ${m.personFilter.type === 'tl' ? 'TL' : 'Agent'}: ${m.personFilter.name}` : name;
      const drill = canDrill && !notSelected ? ` data-kpi="${esc(specFor(m, src, k.f))}" data-kpi-title="${esc(`${filteredName} · ${k.short}`)}" data-admin-only="1" role="button" tabindex="0" title="Admin: ${esc(filteredName)} ki rows dekhein"` : '';
      return `<div class="tix-row ${cls}"${drill}>
        <span class="tix-dot"></span><span class="tix-name" title="${esc(filteredName)}">${esc(filteredName)}</span><b class="tix-num">${notSelected ? '—' : U.fmt(v)}</b><span class="tix-pct">${notSelected || !sum ? '—' : U.fmtPct(share, 0)}</span><span class="tix-gr">${notSelected ? '<span class="badge gray">—</span>' : na ? growthBadge(v, prev, na) : drvBadge(growthBadge(v, prev, na), src, k.key, dirOf(v, prev), canDrill && !m.personFilter)}</span>
        <span class="tix-prev">${notSelected ? 'Not applicable to selected channel/person' : na ? 'Previous: —' : `Previous (${esc(prior)}): ${U.fmt(prev)} · Earlier (${esc(earlier)}): ${U.fmt(oldValue)}`}</span></div>`;
    };
    const drill = canDrill ? ` data-kpi="${esc(specFor(m, 'both', k.f))}" data-kpi-title="${esc(`${k.label}${m.personFilter ? ` · ${m.personFilter.name}` : ''} · ${rangeLabel(m.from, m.to)}`)}" data-admin-only="1" role="button" tabindex="0" title="Admin: is number ki rows dekhein"` : '';
    return `<div class="tix-card ${d2(sumD)}${m.personFilter ? ' tix-filtered-card' : ''}" style="--accent:${k.accent}"${drill}>
      <div class="tix-card-top"><span class="tix-title"><span class="tix-ico">${k.icon}</span>${esc(k.label)}${k.sub ? `<small>${esc(k.sub)}</small>` : ''}${m.personFilter ? `<small class="tix-filter-context">${m.personFilter.channel === 'ff' ? 'First Forward' : 'GV'} ${m.personFilter.type === 'tl' ? 'TL' : 'Agent'}: ${esc(m.personFilter.name)}</small>` : ''}</span>${ofTotal === null ? '' : `<span class="tix-chip" title="${m.personFilter ? 'Selected agent/TL ke total me share' : 'Total issuance me is class ka hissa'}">${U.fmtPct(ofTotal, 0)}${m.personFilter ? ' of selected' : ' of total'}</span>`}</div>
      <div class="tix-big"><span class="tix-big-n">${U.fmt(sum)}</span><span class="tix-big-g">${drvBadge(growthBadge(sum, sumP), 'all', k.key, sumD, canDrill && !m.personFilter)}</span></div>
      <div class="tix-bigsub">Current: ${esc(rangeLabel(m.from, m.to))} · Previous: ${U.fmt(sumP)} (${esc(periodRangeLabel(m.prevFfRange, m.prevGvRange))}) · Earlier: ${U.fmt(sumP2)} (${esc(periodRangeLabel(m.prevFf2Range, m.prevGv2Range))})</div>
      <div class="tix-split" title="FF vs GV share">${sum ? `<i class="ff" style="width:${ffShare.toFixed(1)}%"></i><i class="gv" style="width:${gvShare.toFixed(1)}%"></i>` : ''}</div>
      ${row('ff', 'First Forward', ffV, ffShare, ffP, ffD, ffNA, 'ff')}
      ${row('gv', 'GV Partner', gvV, gvShare, gvP, gvD, gvNA, 'gv')}
      <div class="tix-verdict">${m.personFilter ? `<span class="tix-v">Showing ${m.personFilter.channel === 'ff' ? 'First Forward' : 'GV'} ${m.personFilter.type === 'tl' ? 'TL/team' : 'agent'} · <b>${esc(m.personFilter.name)}</b></span>` : verdictHtml(ffV, gvV, ffD, gvD, ffNA, gvNA)}</div>
    </div>`;
  }
  const d2 = (d) => (d === 'up' ? 'is-up' : d === 'down' ? 'is-down' : '');
  const periodRangeLabel = (ffRange, gvRange) => {
    const differs = ffRange && gvRange && (ffRange[0] !== gvRange[0] || ffRange[1] !== gvRange[1]);
    if (differs) return `FF ${rangeLabel(ffRange[0], ffRange[1])} / GV ${rangeLabel(gvRange[0], gvRange[1])}`;
    const r = ffRange || gvRange;
    return r ? rangeLabel(r[0], r[1]) : 'range unavailable';
  };
  const prev2Label = (m) => { const r = m.prevGv2Range || m.prevFf2Range; return r ? rangeLabel(r[0], r[1]) : 'prev-2'; };

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
      { label: 'VC4', value: ff.vc4 + gv.vc4, color: '#2563eb' }, { label: 'VC20', value: ff.vc20 + gv.vc20, color: '#fb923c' }, { label: 'VC5+', value: ff.vc5p + gv.vc5p, color: '#c2410c' }] });
    const [tf, tt] = trendWindow(m);
    const labels = [], ffV = [], gvV = [], totV = [], tipLabels = [];
    for (let k = tf; k <= tt; k = shiftKey(k, 1)) {
      const ffPend = !!(FF.filters && FF.filters.isFfPending && FF.filters.isFfPending(k));
      const a = rows.ffMap.get(k), b = rows.gvMap.get(k);
      const av = a ? a.total : 0, bv = b ? b.total : 0;
      labels.push(lbl(k)); tipLabels.push(lbl(k, true));
      const gvPend = m.gvPending && k > m.gvTo;
      ffV.push(ffPend ? null : av); gvV.push(gvPend ? null : bv); totV.push(ffPend || gvPend ? null : av + bv);
    }
    const trend = C.lines({ labels, tipLabels, height: 240, series: [
      { name: 'Total', values: totV, color: '#f97316', dash: true, area: false },
      { name: 'First Forward', values: ffV, color: FF_COLOR }, { name: 'GV Partner', values: gvV, color: GV_COLOR }] });
    const dailyBars = C.bars({ labels, tipLabels, height: 230, legendAlways: true, series: [
      { name: 'First Forward', values: ffV.map((v) => v || 0), color: FF_COLOR }, { name: 'GV Partner', values: gvV.map((v) => v || 0), color: GV_COLOR }] });
    const cmpLabels = ['Total', 'VC4', 'VC20', 'VC5+', 'Commercial'];
    const keys = ['total', 'vc4', 'vc20', 'vc5p', 'comm'];
    const prevName = m.prevGvRange ? `Prev ${rangeLabel(m.prevGvRange[0], m.prevGvRange[1])}` : 'Prev';
    // v3.125.95 — 3 period (prev-2 · prev · selected) side-by-side horizontal bars (stacked nahi)
    const r2 = m.prevGv2Range || m.prevFf2Range, r1 = m.prevGvRange || m.prevFfRange;
    const pl = [r2 ? rangeLabel(r2[0], r2[1]) : 'Prev-2', r1 ? rangeLabel(r1[0], r1[1]) : 'Prev', rangeLabel(m.from, m.to)];
    const triBars = (sets, colors) => {
      const max = Math.max(1, ...keys.flatMap((k) => sets.map((x) => x[k] || 0)));
      return `<div class="tri-bars"><div class="tri-legend">${pl.map((l, i) => `<span><i style="background:${colors[i]}"></i>${esc(l)}</span>`).join('')}</div>${keys.map((k, ki) => `<div class="tri-row"><span class="tri-lbl">${esc(cmpLabels[ki])}</span><div class="tri-set">${sets.map((x, i) => `<div class="tri-bar"><i style="width:${(((x[k] || 0) / max) * 100).toFixed(1)}%;background:${colors[i]}"></i><b>${U.fmt(x[k] || 0)}</b></div>`).join('')}</div></div>`).join('')}</div>`;
    };
    const ffCmp = triBars([m.ffPrev2 || {}, ffPrev, ff], ['#c7d2fe', '#818cf8', FF_COLOR]);
    const gvCmp = triBars([m.gvPrev2 || {}, gvPrev, gv], ['#99f6e4', '#2dd4bf', GV_COLOR]);
    const growthBars = C.hbars({ valueLabel: 'Selected', compareLabel: 'Prev', items: KPIS.map((k) => ({
      label: k.short, sub: `FF ${U.fmt(ff[k.key])} · GV ${U.fmt(gv[k.key])}`, value: ff[k.key] + gv[k.key], compare: ffPrev[k.key] + gvPrev[k.key], color: k.accent })) });
    return `
      <div class="grid g-2">
        ${card('📊 Class-wise · FF vs GV', clsChart, `<span class="badge indigo">${U.fmt(totalAll)} total</span>`)}
        ${card('🥧 Share · kaun kitna', `<div class="tix-donuts"><div><h4>FF vs GV</h4>${shareDonut}</div><div><h4>Class mix (combined)</h4>${mixDonut}</div></div>`)}
      </div>
      <div class="grid g-2">
        ${card(`📈 Daily trend · ${esc(rangeLabel(tf, tt))}`, trend + (m.ffPending || m.gvPending ? '<p class="dim small">EIR T+1 hai — aaj ka data graph me gap dikhta hai (kal aayega).</p>' : ''))}
        ${card('🗓️ Daily volume · FF + GV', dailyBars)}
      </div>
      <div class="grid g-2">
        ${card(`🔁 Selected vs ${esc(prevName)} · Combined`, growthBars, '<span class="dim small">bar = selected, line = pichhla period</span>')}
        <div class="tix-stack">
          ${card('🟦 First Forward · 3 period', ffCmp, `<span class="badge indigo">${U.fmt(ff.total)} tags</span>`)}
          ${card('🟩 GV Partner · 3 period', gvCmp, `<span class="badge teal">${U.fmt(gv.total)} tags</span>`)}
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
    const gT = g(total, totalP), gF = m.ffComparable ? g(ff.total, ffPrev.total) : null, gG = m.gvComparable ? g(gv.total, gvPrev.total) : null;
    const word = (x) => (x === null ? '—' : `${x > 0.5 ? '▲' : x < -0.5 ? '▼' : '•'} ${U.fmtSigned(x, 0)}`);
    out.push(`Previous period ke mukable: Total <b>${word(gT)}</b> · FF <b>${m.ffComparable ? word(gF) : 'T+1 (kal aayega)'}</b> · GV <b>${m.gvComparable ? word(gG) : 'T+1 (kal aayega)'}</b>.${gG !== null && gG < -0.5 && (gF === null || gF >= 0) ? ' ⚠️ GV down hai.' : ''}${gF !== null && gF < -0.5 && (gG === null || gG >= 0) ? ' ⚠️ FF down hai.' : ''}`);
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
      const gvDays = m.gvComparable ? dayCount(m.from, m.gvTo) : 0;
      out.push(`Daily average: ${gvDays ? `GV <b>${U.fmt(gv.total / gvDays, 1)}</b>/din` : ''}${gvDays && ffDays ? ' · ' : ''}${ffDays ? `FF <b>${U.fmt(ff.total / ffDays, 1)}</b>/din` : ''}.`);
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
      out.push(`Run-rate: ${m.gvComparable ? `GV is raftaar se month-end tak ~<b>${U.fmt(Math.round(gv.total / dayCount(m.from, m.gvTo) * ml))}</b> tags` : ''}${m.ffComparable ? ` · FF ~<b>${U.fmt(Math.round(ff.total / dayCount(m.from, m.ffTo) * ml))}</b>` : ''}.`);
    }
    if (m.ffPending || m.gvPending) out.push(`🧾 EIR sheet T+1 hai — FF <b>${esc(lbl(m.ffThrough, true))}</b> tak, GV <b>${esc(lbl(m.gvThrough || m.gvTo, true))}</b> tak aaya hai; uske baad ka data kal aayega. Growth isi wajah se like-for-like dikhaya gaya hai.`);
    return `<ul class="insight-list">${out.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  }

  function h2hTable(m) {
    const { ff, gv, ffPrev, gvPrev } = m;
    const defs = [['Total', 'total'], ['VC4', 'vc4'], ['VC20', 'vc20'], ['VC5+', 'vc5p'], ['VC20 + VC5+ (Commercial)', 'comm'], ['Issuance', 'issuance'], ['Replacement', 'replacement'], ['Chassis', 'chassis'], ['Wrong VRN', 'wrongVrn']];
    const rowsHtml = defs.map(([label, key]) => {
      const a = ff[key], b = gv[key], s = a + b;
      const lead = !s ? '—' : a === b ? '=' : b > a ? `GV +${U.fmt(b - a)}` : `FF +${U.fmt(a - b)}`;
      const strong = key === 'total' || key === 'comm' ? ' class="tix-strong"' : '';
      return `<tr${strong}><td>${esc(label)}</td><td class="num">${U.fmt(a)}</td><td class="num dim">${s ? U.fmtPct(pct(a, s), 0) : '—'}</td><td class="num">${U.fmt(b)}</td><td class="num dim">${s ? U.fmtPct(pct(b, s), 0) : '—'}</td><td class="num"><b>${U.fmt(s)}</b></td><td>${lead}</td><td>${growthBadge(a, ffPrev[key], !m.ffComparable)}</td><td>${growthBadge(b, gvPrev[key], !m.gvComparable)}</td><td>${growthBadge(s, ffPrev[key] + gvPrev[key])}</td></tr>`;
    }).join('');
    return `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Metric</th><th class="num">FF</th><th class="num">FF %</th><th class="num">GV</th><th class="num">GV %</th><th class="num">Combined</th><th>Lead</th><th>FF vs prev</th><th>GV vs prev</th><th>Total vs prev</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
      <p class="dim small">GV Master me Wrong VRN alag field nahi hai (GV ke liye 0 / unavailable). Chassis = chassis type wale tags.</p>`;
  }

  function classTable(m) {
    const { ff, gv, ffPrev, gvPrev } = m;
    const all = U.uniq([...Object.keys(ff.byClass), ...Object.keys(gv.byClass), ...Object.keys(ffPrev.byClass), ...Object.keys(gvPrev.byClass)]).sort((a, b) => (parseInt(a.replace(/\D/g, ''), 10) || 999) - (parseInt(b.replace(/\D/g, ''), 10) || 999));
    const rows = all.map((c) => {
      const a = ff.byClass[c] || 0, ap = ffPrev.byClass[c] || 0, b = gv.byClass[c] || 0, bp = gvPrev.byClass[c] || 0;
      const a2 = (m.ffPrev2 && m.ffPrev2.byClass[c]) || 0, b2 = (m.gvPrev2 && m.gvPrev2.byClass[c]) || 0;
      return `<tr><td><b>${esc(c)}</b> <small class="dim">${esc(M.classGroup(c))}</small></td>
        <td class="num"><b>${U.fmt(a)}</b></td><td class="num">${m.ffComparable ? U.fmt(ap) : '—'}</td><td class="num dim">${m.ffComparable ? U.fmt(a2) : '—'}</td><td>${growthBadge(a, ap, !m.ffComparable)}</td>
        <td class="num"><b>${U.fmt(b)}</b></td><td class="num">${m.gvComparable ? U.fmt(bp) : '—'}</td><td class="num dim">${m.gvComparable ? U.fmt(b2) : '—'}</td><td>${growthBadge(b, bp, !m.gvComparable)}</td>
        <td class="num"><b>${U.fmt(a + b)}</b></td><td class="num">${U.fmt(ap + bp)}</td><td class="num dim">${U.fmt(a2 + b2)}</td><td>${growthBadge(a + b, ap + bp)}</td></tr>`;
    }).join('');
    return `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Class</th><th class="num">FF</th><th class="num">FF prev</th><th class="num">FF prev-2</th><th>FF Δ</th><th class="num">GV</th><th class="num">GV prev</th><th class="num">GV prev-2</th><th>GV Δ</th><th class="num">Total</th><th class="num">Total prev</th><th class="num">Total prev-2</th><th>Total Δ</th></tr></thead><tbody>${rows || '<tr><td colspan="13" class="empty">Is range me koi data nahi</td></tr>'}</tbody></table></div>`;
  }

  /** 🩺 Kaun si sheet ka data kab tak aaya — EIR T+1 me 1 din purana normal hai. */
  function healthStrip(rows) {
    const today = todayKey();
    const age = (k) => (k ? Math.max(0, dayCount(k, today) - 1) : null);
    const chip = (label, key, hint) => {
      const a = age(key);
      const cls = a === null ? 'gray' : a <= 1 ? 'green' : a === 2 ? 'amber' : 'red';
      const txt = a === null ? 'data nahi' : `${lbl(key, true)} · ${a === 0 ? 'aaj' : `${a} din purana`}`;
      return `<span class="badge ${cls}" title="${esc(hint)}">${esc(label)}: ${esc(txt)}</span>`;
    };
    return `<div class="tix-health"><b>🩺 Data freshness</b>${chip('FF (EIR)', rows.ffLatest, 'EIR sheet T+1 hai — 1 din purana normal')}${chip('GV (EIR)', rows.gvLatest, 'EIR me master ID 5845036 wali rows ki latest date')}${chip('GV Master', rows.masterLatest, 'GV Master sheet live hoti hai')}<span class="dim small">Loaded ${U.timeLabel(S.loadedAt || (G && G.loadedAt) || Date.now())}</span></div>`;
  }

  /** 🔎 GV ka EIR total vs GV Master total — fark ho to din-wise dikhao. EIR hi dashboard ka source hai. */
  function reconHtml(m, rows) {
    if (!rows.masterRows.length) return '<p class="dim">GV Master abhi load nahi hua, isliye match check nahi ho sakta.</p>';
    if (!m.gvComparable) return '<p class="dim">Is range ka GV EIR T+1 hai (kal aayega) — EIR aane ke baad match check dikhega.</p>';
    const to = m.gvTo;
    const eir = scan(rows.gvRows, m.from, to), mas = scan(rows.masterRows, m.from, to);
    const defs = [['Total', 'total'], ['VC4', 'vc4'], ['VC20', 'vc20'], ['VC5+', 'vc5p'], ['Commercial', 'comm']];
    const tbl = defs.map(([label, key]) => {
      const d = mas[key] - eir[key];
      const p = eir[key] ? (d / eir[key]) * 100 : null;
      const badge = d === 0 ? '<span class="badge green">✅ match</span>' : `<span class="badge ${Math.abs(p || 100) > 5 ? 'red' : 'amber'}">⚠️ ${d > 0 ? '+' : ''}${U.fmt(d)}${p === null ? '' : ` (${U.fmtSigned(p, 1)})`}</span>`;
      return `<tr><td>${esc(label)}</td><td class="num"><b>${U.fmt(eir[key])}</b></td><td class="num">${U.fmt(mas[key])}</td><td>${badge}</td></tr>`;
    }).join('');
    const dayKeys = new Set([...eir.byDay.keys(), ...mas.byDay.keys()]);
    const diffs = [...dayKeys].map((k) => ({ k, e: (eir.byDay.get(k) || { total: 0 }).total, a: (mas.byDay.get(k) || { total: 0 }).total })).filter((x) => x.e !== x.a).sort((x, y) => Math.abs(y.a - y.e) - Math.abs(x.a - x.e));
    const dayRows = diffs.slice(0, 10).map((x) => `<tr><td>${esc(lbl(x.k, true))}</td><td class="num">${U.fmt(x.e)}</td><td class="num">${U.fmt(x.a)}</td><td><span class="badge ${x.a > x.e ? 'amber' : 'red'}">${x.a > x.e ? '+' : ''}${U.fmt(x.a - x.e)}</span></td></tr>`).join('');
    const ok = !diffs.length && mas.total === eir.total;
    const banner = ok
      ? `<div class="tix-recon ok">✅ ${esc(rangeLabel(m.from, to, true))} — GV ka EIR total aur GV Master total <b>barabar</b> hai (${U.fmt(eir.total)}).</div>`
      : `<div class="tix-recon warn">⚠️ GV Master EIR se <b>${U.fmt(Math.abs(mas.total - eir.total))} ${mas.total > eir.total ? 'more' : 'less'}</b> than EIR (${diffs.length} days differ). Dashboard totals come from EIR — check Master for late / duplicate / different entries.</div>`;
    return `${banner}<div class="grid g-2"><div class="table-wrap"><table class="tbl compact"><thead><tr><th>Metric</th><th class="num">GV · EIR</th><th class="num">GV · Master</th><th>Fark</th></tr></thead><tbody>${tbl}</tbody></table></div>
      ${diffs.length ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Din (sabse bada fark)</th><th class="num">EIR</th><th class="num">Master</th><th>Fark</th></tr></thead><tbody>${dayRows}</tbody></table></div>` : '<p class="dim">Kisi din me fark nahi.</p>'}</div>
      <p class="dim small">Compare sirf ${esc(lbl(to, true))} tak (EIR ki latest date). Master ke aaj ke live tags EIR me kal aate hain.</p>`;
  }

  function peopleHtml(m, rows) {
    const rankCount = Math.max(5, Math.min(20, Number((function () { try { return localStorage.getItem('ti_chart_limit'); } catch (e) { return 0; } })()) || 10));
    const gvAgentMap = new Map(), gvTlMap = new Map();
    rows.gvMasterRows.forEach((r) => {
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
      <div class="grid g-2">${card('Top GV VC4 agents', hb(top((o) => o.vc4), 'vc4', 'VC4 tags', 0))}${card('Top GV Commercial agents', hb(top((o) => o.comm), 'comm', 'Commercial tags', 3))}</div>
      ${card('🏢 Top GV teams / supervisors', C.hbars({ valueLabel: 'Tags', items: U.topEntries(gvTlMap, rankCount).map(([name, n], i) => ({ label: name, value: n, color: C.PALETTE[(i + 5) % C.PALETTE.length] })) }))}`;
  }


  // ---------------------------------------------------------------- growth drivers (who pushed it up / dragged it down)
  const DRV = { ch: 'all', level: 'agents', scope: 'all', dir: 'down', cls: 'total', status: 'dw', cache: new Map(), lastRows: [] };
  const CLS_LABEL = { total: 'All classes', vc4: 'VC4', vc20: 'VC20', vc5p: 'VC5+', comm: 'Commercial (VC20 + VC5+)' };
  const inCls = (r, k) => k === 'total' || (k === 'vc4' && r.group === 'VC4') || (k === 'vc20' && r.group === 'VC20')
    || (k === 'vc5p' && r.group !== 'VC4' && r.group !== 'VC20') || (k === 'comm' && r.group !== 'VC4');
  const isDirectRow = (r) => {
    if (r.tlName === 'Direct') return true;
    try { return !!FF.config.isDirectAgent({ tlName: r.tlName, tlId: r.tlId, agentName: r.name, agentId: r.id }, r.channel === 'GV Partner' ? 'gv' : 'ff'); } catch (e) { return false; }
  };
  const within = (key, a, b) => !!a && key >= a && key <= b;

  function loadDriverRows(m) {
    const starts = [m.from, m.prevGvRange && m.prevGvRange[0], m.prevFfRange && m.prevFfRange[0], m.prevGv2Range && m.prevGv2Range[0], m.prevFf2Range && m.prevFf2Range[0]].filter(Boolean).sort();
    const from = starts[0], to = m.to, ck = `${from}|${to}`;
    if (!DRV.cache.has(ck) || DRV.cache.get(ck).failed) {
      const pr = M.loadRangePeople(from, to).then((rows) => ({ rows })).catch((err) => ({ rows: [], failed: true, err }));
      DRV.cache.set(ck, pr);
      pr.then((v) => { if (v.failed) DRV.cache.delete(ck); });
    }
    return DRV.cache.get(ck);
  }

  /** rows → one record per agent (or per TL) with current + previous period numbers (like-for-like, same as the KPI cards). */
  function aggregateDrivers(rows, m) {
    const per = {
      ff: { cur: [m.from, m.ffTo], prev: m.prevFfRange, prev2: m.prevFf2Range },
      gv: { cur: [m.from, m.gvTo], prev: m.prevGvRange, prev2: m.prevGv2Range }
    };
    const out = new Map();
    for (const r of rows) {
      const chKey = r.channel === 'GV Partner' ? 'gv' : 'ff';
      if (DRV.ch !== 'all' && DRV.ch !== chKey) continue;
      if (!inCls(r, DRV.cls)) continue;
      const pp = per[chKey];
      const inCur = within(r.dateKey, pp.cur[0], pp.cur[1]);
      const inPrev = pp.prev && within(r.dateKey, pp.prev[0], pp.prev[1]);
      const inPrev2 = pp.prev2 && within(r.dateKey, pp.prev2[0], pp.prev2[1]);
      if (!inCur && !inPrev && !inPrev2) continue;
      const direct = isDirectRow(r);
      let key, name, id, tl;
      if (DRV.level === 'tls') {
        key = `${chKey}|${direct ? '__direct__' : r.tlName}`;
        name = direct ? FF.config.directLabel(r, chKey) : r.tlName; id = direct ? '' : (r.tlId || ''); tl = '';
      } else {
        key = `${chKey}|${r.id || r.name}`; name = r.name; id = r.id || ''; tl = direct ? FF.config.directLabel(r, chKey) : r.tlName;
      }
      const o = out.get(key) || { key, name, id, tl, ch: chKey, direct, cur: 0, prev: 0, prev2: 0, agents: new Set() };
      if (inCur) o.cur += r.n; if (inPrev) o.prev += r.n; if (inPrev2) o.prev2 += r.n;
      o.agents.add(r.id || r.name);
      out.set(key, o);
    }
    return [...out.values()].map((o) => ({ ...o, delta: o.cur - o.prev, growth: U.growth(o.cur, o.prev), agents: o.agents.size }));
  }
  const drvStatus = (o) => {
    if (!o.prev && o.cur) return 'new';
    if (!o.delta) return 'same';
    const g = (o.delta / o.prev) * 100; // within ±2% counts as "same"
    return g > 2 ? 'up' : g < -2 ? 'down' : 'same';
  };
  const typeLabel = (o) => (DRV.level === 'tls' ? (o.direct ? 'Direct agents' : 'TL team') : (o.sourceAdjustment ? 'Source reconciliation' : o.direct ? 'Direct agent' : 'Agent under TL'));

  function drvBadge(html, ch, key, dir, canDrill) {
    if (!canDrill) return html;
    return `<span class="tix-drvlink" data-drv="${ch}" data-drvcls="${key}" data-drvdir="${dir}" role="button" tabindex="0" title="Click — who caused this change (agents / TLs)">${html}</span>`;
  }
  const dsign = (n) => `${n > 0 ? '+' : ''}${U.fmt(n)}`;
  const gtxt = (g) => (g === null ? '—' : `${g > 0 ? '+' : ''}${U.fmtPct(g, 0)}`);
  const tone = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');

  function driversShell(m, preset) {
    const pr = m.prevGvRange || m.prevFfRange;
    const prevL = pr ? rangeLabel(pr[0], pr[1], true) : '—';
    const isMonth = preset === 'thisMonth';
    const head = isMonth ? 'Last month vs This month' : 'Previous period vs Now';
    return `<section class="card tix-drv" id="ti-drv"><div class="card-head"><h3>📊 ${head} · who drove the change</h3>
      <div class="card-right"><span class="badge gray">${esc(prevL)}</span> → <span class="badge indigo">${esc(rangeLabel(m.from, m.to, true))}</span></div></div>
      <div class="card-body" id="ti-drv-body">${U.spinner('Agent / TL data load ho raha hai…')}</div></section>`;
  }

  function driversHtml(m, rows) {
    const all = aggregateDrivers(rows, m);
    // scope filter (Direct agents / TL agents / All)
    const list = all.filter((o) => DRV.scope === 'all' || (DRV.scope === 'direct' ? o.direct : !o.direct));
    const sum = (arr, k) => arr.reduce((n, o) => n + o[k], 0);
    // breakdown matrix: channel × (Direct / TL) — "kiska hai: GV ya FF, direct agents ya TLs"
    const cell = (arr, ch, dir) => {
      const a = arr.filter((o) => (ch === 'all' || o.ch === ch) && (dir === 'all' || (dir === 'direct' ? o.direct : !o.direct)));
      const prev = sum(a, 'prev'), cur = sum(a, 'cur'), d = cur - prev;
      return `<td class="num tix-mx ${tone(d)}" data-mx-ch="${ch}" data-mx-scope="${dir}" role="button" tabindex="0" title="Click — filter by this"><b>${dsign(d)}</b><small>${U.fmt(prev)} → ${U.fmt(cur)} · ${gtxt(U.growth(cur, prev))}</small></td>`;
    };
    const base = all; // matrix ignores the scope filter but respects channel + class
    const mxRow = (label, ch) => `<tr><th>${label}</th>${cell(base, ch, 'direct')}${cell(base, ch, 'tl')}${cell(base, ch, 'all')}</tr>`;
    const chPick = (id, label) => `<button type="button" class="tix-chipbtn ${DRV.ch === id ? 'active' : ''}" data-drv-set="ch:${id}">${label}</button>`;
    const sc = (id, label) => `<button type="button" class="tix-chipbtn ${DRV.scope === id ? 'active' : ''}" data-drv-set="scope:${id}">${label}</button>`;
    const lv = (id, label) => `<button type="button" class="tix-chipbtn ${DRV.level === id ? 'active' : ''}" data-drv-set="level:${id}">${label}</button>`;
    const tb = (id, label) => `<button type="button" class="tix-chipbtn ${DRV.dir === id ? 'active' : ''}" data-drv-set="dir:${id}">${label}</button>`;
    const clsSel = `<select class="input" data-drv-cls aria-label="Class">${Object.entries(CLS_LABEL).map(([k, l]) => `<option value="${k}" ${DRV.cls === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;

    let view, title;
    if (DRV.dir === 'down') { view = list.filter((o) => o.delta < 0).sort((a, b) => a.delta - b.delta); title = '🔻 Biggest drops — who dragged it down'; }
    else if (DRV.dir === 'up') { view = list.filter((o) => o.delta > 0).sort((a, b) => b.delta - a.delta); title = '🔺 Biggest gains — who pushed it up'; }
    else if (DRV.dir === 'last') {
      view = list.filter((o) => o.prev > 0).sort((a, b) => b.prev - a.prev).slice(0, 15);
      if (DRV.status === 'dw') view = view.filter((o) => ['down', 'same'].includes(drvStatus(o)));
      title = '🏅 Top 15 of the previous period — how are they now?';
    } else { view = list.filter((o) => o.cur > 0).sort((a, b) => b.cur - a.cur); title = '🏆 Top 15 now — and how they moved'; }
    view = view.slice(0, 15);
    DRV.lastRows = view;
    const tot = { prev: sum(list, 'prev'), cur: sum(list, 'cur') };
    const stBadge = (o) => { const s = drvStatus(o); return `<span class="badge ${s === 'up' || s === 'new' ? 'green' : s === 'down' ? 'red' : 'gray'}">${s === 'up' ? '▲ Up' : s === 'new' ? '★ New' : s === 'down' ? '▼ Down' : '• Same'}</span>`; };
    const trs = view.map((o, i) => `<tr class="${o.direct && DRV.level === 'tls' ? '' : 'clickable'}" data-drv-open="${esc(o.name)}" data-drv-ch="${o.ch}" ${o.direct && DRV.level === 'tls' ? 'data-nolink="1"' : ''}>
      <td>${i + 1}</td><td><b>${esc(o.name)}</b>${o.id ? ` <small class="mono dim">${esc(o.id)}</small>` : ''}${DRV.level === 'tls' && !o.direct ? ` <small class="dim">${U.fmt(o.agents)} agents</small>` : ''}</td>
      <td><span class="badge ${o.ch === 'gv' ? 'teal' : 'indigo'}">${o.ch === 'gv' ? 'GV' : 'FF'}</span></td>
      <td>${esc(typeLabel(o))}</td><td>${esc(o.tl || '—')}</td>
      <td class="num dim">${U.fmt(o.prev2 || 0)}</td><td class="num">${U.fmt(o.prev)}</td><td class="num"><b>${U.fmt(o.cur)}</b></td>
      <td class="num tix-d ${tone(o.delta)}"><b>${dsign(o.delta)}</b></td><td class="num">${gtxt(o.growth)}</td><td>${stBadge(o)}</td></tr>`).join('');
    const statusChips = DRV.dir === 'last' ? `<span class="tix-drv-sep"></span>${[['dw', 'Down + same'], ['all', 'All 15']].map(([id, l]) => `<button type="button" class="tix-chipbtn ${DRV.status === id ? 'active' : ''}" data-drv-set="status:${id}">${l}</button>`).join('')}` : '';
    return `<div class="tix-drv-bar">
        <div class="tix-drv-group"><span class="dim small">Channel</span>${chPick('all', 'GV + FF')}${chPick('gv', 'GV')}${chPick('ff', 'FF')}</div>
        <div class="tix-drv-group"><span class="dim small">Level</span>${lv('agents', 'Agents')}${lv('tls', 'TLs')}</div>
        <div class="tix-drv-group"><span class="dim small">Show</span>${sc('all', 'All')}${sc('direct', 'Direct agents')}${sc('tl', DRV.level === 'tls' ? 'All TLs' : 'TL agents')}</div>
        <div class="tix-drv-group"><span class="dim small">Class</span>${clsSel}</div>
      </div>
      <div class="tix-drv-sum"><span>${esc(CLS_LABEL[DRV.cls])}</span><b>${U.fmt(tot.prev)} → ${U.fmt(tot.cur)}</b><span class="tix-d ${tone(tot.cur - tot.prev)}"><b>${dsign(tot.cur - tot.prev)}</b> (${gtxt(U.growth(tot.cur, tot.prev))})</span></div>
      <div class="table-wrap"><table class="tbl compact tix-mxtbl"><thead><tr><th>Change</th><th class="num">Direct agents</th><th class="num">TL teams</th><th class="num">Total</th></tr></thead>
        <tbody>${mxRow('GV Partner', 'gv')}${mxRow('First Forward', 'ff')}${mxRow('GV + FF', 'all')}</tbody></table></div>
      <div class="tix-drv-tabs">${tb('down', '🔻 Down')}${tb('up', '🔺 Up')}${tb('last', '🏅 Last period top 15')}${tb('now', '🏆 Now top 15')}${statusChips}
        <button class="btn small" type="button" data-drv-csv style="margin-left:auto">⬇ CSV</button></div>
      <h4 class="tix-drv-title">${title}</h4>
      ${view.length ? `<div class="table-wrap"><table class="tbl compact tix-drvtbl"><thead><tr><th>#</th><th>${DRV.level === 'tls' ? 'TL / team' : 'Agent'}</th><th>Ch</th><th>Type</th><th>TL</th><th class="num" title="Pichhle se pichhla period">Last-2</th><th class="num">Last</th><th class="num">Now</th><th class="num">Change</th><th class="num">%</th><th>Status</th></tr></thead><tbody>${trs}</tbody></table></div>`
        : '<div class="empty">Nothing to show for this filter.</div>'}
      <small class="dim">Source: FF = EIR sheet, GV = GV Master (agent / TL names) — like-for-like days as in the KPI cards. Click a name to open the full summary.</small>`;
  }

  async function paintDrivers(root, m, preset, chRows) {
    const host = root.querySelector('#ti-drv-body');
    if (!host) return;
    const v = await loadDriverRows(m);
    const again = root.querySelector('#ti-drv-body');
    if (!again) return;
    if (v.failed) { again.innerHTML = `<div class="empty">Could not load agent data (${esc((v.err && v.err.message) || 'error')}). <button class="btn small" type="button" data-drv-retry>Retry</button></div>`; return; }
    // GV side: names/TLs come from the GV Master ledger (EIR's GV rows often carry no agent identity) — same source as "Top GV agents".
    const gvMaster = ((chRows && chRows.gvMasterRows) || []).map((r) => ({
      id: r.agentId || '', name: r.agentName || r.agentId || 'Unknown', tlId: r.tlId || '', tlName: r.tlName || '', channel: 'GV Partner',
      cls: r.cls, group: r.group, dateKey: r.key || (r.date ? U.dateKey(r.date) : ''), n: r.n === undefined ? 1 : (Number(r.n) || 0)
    })).filter((r) => r.dateKey);
    const eirGv = v.rows.filter((r) => r.channel === 'GV Partner');
    DRV.model = m; DRV.rows = v.rows.filter((r) => r.channel !== 'GV Partner').concat(gvMaster.length ? gvMaster : eirGv);
    DRV.gvSource = gvMaster.length ? 'GV Master' : 'EIR';
    again.innerHTML = driversHtml(m, DRV.rows);
  }

  // ---------------------------------------------------------------- page
  const store = {
    get(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };

  // ---------------------------------------------------------------- 📥 agent / TL report (Excel + CSV)
  const REPORTS = { gv: ['GV Report', 'GV'], ff: ['First Forward Report', 'FF'], both: ['GV + FF Report', 'GV + FF'] };
  const g3 = (r) => (r.group === 'VC4' ? 'vc4' : r.group === 'VC20' ? 'vc20' : 'vc5');
  const r1 = (v) => Math.round(v * 10) / 10;
  const nid = (v) => String(v == null ? '' : v).replace(/\.0+$/, '').replace(/\s+/g, '').toUpperCase();
  const nname = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toUpperCase();
  const perfPct = (cur, prev) => (prev ? r1(((cur - prev) / prev) * 100) : null);
  /** Plain-words performance next to the % (vs the previous period of the same length). */
  const perfStatus = (cur, prev) => (!prev && !cur ? '—' : !prev ? '★ New' : !cur ? '✖ No issuance now' : cur > prev ? '▲ Up' : cur < prev ? '▼ Down' : '= Same');
  const perfCell = (cur, prev) => { const p = perfPct(cur, prev); return p === null ? '' : p; };

  /**
   * GV agent/TL detail remains sourced from GV Master (one row per tag).
   * EIR daily aggregates are authoritative for the KPI total; the per-date/class
   * difference is displayed as an explicit, unassigned reconciliation row.
   * FF continues to use EIR daily rows, exactly like its KPI.
   */
  function reportInputs(rows, dir) {
    const out = [], daily = rows.dailyRows || [];
    const rawGv = rows.rawGvMaster || ((G && typeof G.masterRows === 'function' ? G.masterRows() : null) || []);

    // First Forward agent details: EIR counts + FF REPORT directory enrichment.
    for (const r of daily) {
      if (!r || r.channel === 'GV Partner') continue;
      const id = U.clean(r.agentId || r.id), name0 = U.clean(r.agentName || r.name);
      const hit = dir.ff(id, name0);
      const name = name0 || (hit && hit.name) || (id ? `Agent ${id}` : '(No agent in EIR)');
      const tlName = hit ? U.clean(hit.tlName) : '', tlId = hit ? U.clean(hit.tlId) : '';
      let direct = !tlName;
      if (!direct) { try { direct = !!FF.config.isDirectAgent({ tlName, tlId, agentName: name, agentId: id }, 'ff'); } catch (e) { /* keep */ } }
      out.push({
        ch: 'ff', id, name,
        tlName: direct ? (hit ? FF.config.directLabel({ tlName, agentName: name, agentId: id }, 'ff') : 'No TL (not in REPORT)') : tlName,
        tlId: direct ? '' : tlId, direct, mobile: (hit && hit.mobile) || '',
        group: r.group, dateKey: r.key || (r.date ? U.dateKey(r.date) : ''),
        n: r.n === undefined ? 1 : (Number(r.n) || 0)
      });
    }

    // GV Master supplies real GV agent/TL rows and TL self-issuance attribution.
    const gvTls = new Map();
    for (const r of rawGv) {
      if (!r) continue;
      for (const t of [r.gvTlId, r.tlId, r.supervisorId]) {
        const k = nid(t);
        if (k && k !== nid(r.agentId) && !gvTls.has(k)) gvTls.set(k, U.clean(r.tlName));
      }
    }
    const gvMasterByDayClass = new Map();
    for (const r of rawGv) {
      if (!r || !r.date) continue;
      const dateKey = U.dateKey(r.date);
      const group = r.group || (M.classGroup ? M.classGroup(r.cls) : 'VC4');
      const bucket = `${dateKey}|${group}`;
      gvMasterByDayClass.set(bucket, (gvMasterByDayClass.get(bucket) || 0) + 1);

      const selfTl = gvTls.has(nid(r.agentId)) ? nid(r.agentId) : '';
      if (selfTl) {
        const name = U.clean(r.agentName) || gvTls.get(selfTl) || `TL ${r.agentId}`;
        out.push({
          ch: 'gv', id: U.clean(r.agentId), name, tlName: gvTls.get(selfTl) || name,
          tlId: U.clean(r.agentId), direct: false, mobile: dir.gv(r.agentId, r.agentName),
          group, dateKey, n: 1, selfTl: true
        });
        continue;
      }
      let direct = false;
      try { direct = !!FF.config.isDirectAgent(r, 'gv'); } catch (e) { /* keep */ }
      const tlName = U.clean(r.tlName);
      if (!tlName) direct = true;
      const name = U.clean(r.agentName) || (r.agentId ? `Agent ${r.agentId}` : '(No agent in GV Master)');
      out.push({
        ch: 'gv', id: U.clean(r.agentId), name,
        tlName: direct ? FF.config.directLabel(r, 'gv') : tlName,
        tlId: direct ? '' : U.clean(r.tlId || r.supervisorId || r.gvTlId || ''),
        direct, mobile: dir.gv(r.agentId, r.agentName), group, dateKey, n: 1
      });
    }

    // Reconcile every GV date × class bucket. Positive = EIR tags missing in Master;
    // negative = Master rows not present in EIR. Never assign this difference to an agent.
    const gvEirByDayClass = new Map();
    for (const r of daily) {
      if (!r || r.channel !== 'GV Partner') continue;
      const dateKey = r.key || (r.date ? U.dateKey(r.date) : '');
      const n = r.n === undefined ? 1 : (Number(r.n) || 0);
      if (!dateKey || !n) continue;
      const group = r.group || 'VC4';
      const bucket = `${dateKey}|${group}`;
      gvEirByDayClass.set(bucket, (gvEirByDayClass.get(bucket) || 0) + n);
    }
    const buckets = new Set([...gvEirByDayClass.keys(), ...gvMasterByDayClass.keys()]);
    for (const bucket of buckets) {
      const [dateKey, group] = bucket.split('|');
      const delta = (gvEirByDayClass.get(bucket) || 0) - (gvMasterByDayClass.get(bucket) || 0);
      if (!delta) continue;
      out.push({
        ch: 'gv', id: `GV-EIR-RECON-${group}`,
        name: `GV source reconciliation · ${group}`,
        tlName: 'Source reconciliation · not an agent', tlId: '',
        direct: true, mobile: '', group, dateKey, n: delta, sourceAdjustment: true
      });
    }
    return out;
  }
  /** Per-agent records (current period = the card's dates; previous = like-for-like range). */
  function buildAgentReport(inputs, m, which) {
    const per = { ff: { cur: [m.from, m.to], prev: m.prevFfRange, prev2: m.prevFf2Range }, gv: { cur: [m.from, m.to], prev: m.prevGvRange, prev2: m.prevGv2Range } };
    const out = new Map(), months = new Set(), first = { ff: '', gv: '' };
    for (const r of inputs) { const k = String(r.dateKey || ''); if (k && (!first[r.ch] || k < first[r.ch])) first[r.ch] = k; }
    for (const r of inputs) {
      if (which !== 'both' && which !== r.ch) continue;
      const pp = per[r.ch];
      const inCur = within(r.dateKey, pp.cur[0], pp.cur[1]);
      const inPrev = !!pp.prev && within(r.dateKey, pp.prev[0], pp.prev[1]);
      const inPrev2 = !!pp.prev2 && within(r.dateKey, pp.prev2[0], pp.prev2[1]);
      if (!inCur && !inPrev && !inPrev2) continue;
      const key = `${r.ch}|${nid(r.id) || nname(r.name)}`;
      const o = out.get(key) || { ch: r.ch, id: r.id, name: r.name, tlName: r.tlName, tlId: r.tlId, direct: r.direct, mobile: r.mobile || '', sourceAdjustment: !!r.sourceAdjustment, vc4: 0, vc20: 0, vc5: 0, total: 0, prev: 0, prev2: 0, mon: {} };
      if (!o.mobile && r.mobile) o.mobile = r.mobile;
      if (inCur) {
        o[g3(r)] += r.n; o.total += r.n;
        // v3.125.97 — month-wise split (custom range me har mahine ka VC4 / VC20 / VC5+)
        const ym = String(r.dateKey).slice(0, 7); months.add(ym);
        const mm = o.mon[ym] || (o.mon[ym] = { vc4: 0, vc20: 0, vc5: 0, total: 0 });
        mm[g3(r)] += r.n; mm.total += r.n;
      }
      if (inPrev) o.prev += r.n;
      if (inPrev2) o.prev2 += r.n;
      out.set(key, o);
    }
    const list = [...out.values()];
    const grandTotal = list.reduce((a, o) => a + o.total, 0);
    for (const o of list) { o.change = o.total - o.prev; o.perf = perfPct(o.total, o.prev); o.status = perfStatus(o.total, o.prev); o.share = grandTotal ? r1((o.total / grandTotal) * 100) : 0; }
    list.sort((a, b) => b.total - a.total || b.prev - a.prev || String(a.name).localeCompare(String(b.name)));
    const chTot = { ff: 0, gv: 0 }; list.forEach((o) => { chTot[o.ch] += o.total; });
    // prev period ka data load hi nahi hua (sabse purani row prev ke shuru se baad ki) → n/a
    const prevNA = { ff: !!(per.ff.prev && (!first.ff || first.ff > per.ff.prev[0])), gv: !!(per.gv.prev && (!first.gv || first.gv > per.gv.prev[0])) };
    return { list, grandTotal, chTot, prevNA, first, months: [...months].filter((x) => /^\d{4}-\d{2}$/.test(x)).sort() };
  }
  const sourceAdjustmentTotal = (rep, ch) => (rep.list || []).reduce((n, o) => n + (o.ch === ch && o.sourceAdjustment ? o.total : 0), 0);

  /** One row per real TL (both channels together), highest → lowest. */
  function tlPivot(list) {
    const map = new Map();
    for (const o of list) {
      if (o.direct) continue;
      const key = `${o.ch}|${nid(o.tlId) || nname(o.tlName)}`;
      const x = map.get(key) || { ch: o.ch, name: o.tlName, id: o.tlId, agents: 0, vc4: 0, vc20: 0, vc5: 0, total: 0, prev: 0, prev2: 0, mon: {} };
      if (!x.id && o.tlId) x.id = o.tlId;
      for (const [ym, v] of Object.entries(o.mon || {})) { const t = x.mon[ym] || (x.mon[ym] = { vc4: 0, vc20: 0, vc5: 0, total: 0 }); t.vc4 += v.vc4; t.vc20 += v.vc20; t.vc5 += v.vc5; t.total += v.total; }
      x.agents += o.total > 0 ? 1 : 0; x.vc4 += o.vc4; x.vc20 += o.vc20; x.vc5 += o.vc5; x.total += o.total; x.prev += o.prev; x.prev2 += o.prev2 || 0;
      map.set(key, x);
    }
    const grand = list.reduce((a, o) => a + o.total, 0);
    return [...map.values()].map((x) => ({ ...x, perf: perfPct(x.total, x.prev), status: perfStatus(x.total, x.prev), share: grand ? r1((x.total / grand) * 100) : 0 }))
      .sort((a, b) => b.total - a.total || b.prev - a.prev || String(a.name).localeCompare(String(b.name)));
  }
  const chName = (ch) => (ch === 'gv' ? 'GV' : 'FF');
  const AGENT_HEAD = ['Rank', 'Agent ID', 'Agent Name', 'Mobile', 'TL Name', 'TL ID', 'Channel', 'VC4', 'VC20', 'VC5+', 'Total', 'Prev-2 total', 'Prev total', 'Change', 'Performance %', 'Performance', 'Share %'];
  const agentRow = (o, i) => [i + 1, o.id, o.name, o.mobile || '', o.tlName, o.tlId, chName(o.ch), o.vc4, o.vc20, o.vc5, o.total, o.prev2 || 0, o.prev, o.change, perfCell(o.total, o.prev), o.status, o.share];
  const sumOf = (list) => list.reduce((a, o) => ({ vc4: a.vc4 + o.vc4, vc20: a.vc20 + o.vc20, vc5: a.vc5 + o.vc5, total: a.total + o.total, prev: a.prev + o.prev, prev2: a.prev2 + (o.prev2 || 0) }), { vc4: 0, vc20: 0, vc5: 0, total: 0, prev: 0, prev2: 0 });
  const totalRow = (label, list, width) => {
    const t = sumOf(list);
    const tail = [t.vc4, t.vc20, t.vc5, t.total, t.prev2, t.prev, t.total - t.prev, perfCell(t.total, t.prev), perfStatus(t.total, t.prev), ''];
    return [...Array(width - tail.length).fill(''), ...tail].map((v, k) => (k === 2 ? label : v));
  };
  // month-wise columns: sirf jab range 2+ mahine ki ho
  const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monLabel = (ym) => `${MON_SHORT[Number(ym.slice(5, 7)) - 1] || ym} ${ym.slice(2, 4)}`;
  const monHead = (months) => months.flatMap((ym) => [`${monLabel(ym)} VC4`, `${monLabel(ym)} VC20`, `${monLabel(ym)} VC5+`, `${monLabel(ym)} Total`]);
  const monCells = (mon, months) => months.flatMap((ym) => { const v = (mon || {})[ym] || {}; return [v.vc4 || 0, v.vc20 || 0, v.vc5 || 0, v.total || 0]; });
  const monSum = (list) => { const t = {}; for (const o of list) for (const [ym, v] of Object.entries(o.mon || {})) { const x = t[ym] || (t[ym] = { vc4: 0, vc20: 0, vc5: 0, total: 0 }); x.vc4 += v.vc4; x.vc20 += v.vc20; x.vc5 += v.vc5; x.total += v.total; } return t; };
  const ymDays = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  const fullMonth = (ym, from, to) => from <= `${ym}-01` && to >= `${ym}-${String(ymDays(ym)).padStart(2, '0')}`;
  /** Report sheets. 2+ months → month-wise layout (Prev columns ki jagah month-over-month analysis), 1 period → classic.
   *  Har sheet par Excel styles: Total / month-total columns rangeen, total rows grey, grand total dark, performance green/red. */
  function reportSheets(rep, m, which) {
    const months = (rep.months && rep.months.length > 1) ? rep.months : [];
    const sheets = months.length ? reportSheetsMonthly(rep, m, which, months) : reportSheets0(rep, m, which);
    if (!months.length) blankMissingPrev(sheets, rep);
    sheets.forEach(styleSheet);
    return sheets;
  }
  /** Prev period ka data load hi nahi (EIR window chhota) → 0 nahi, khaali + "n/a" (galat ▲ New / +5000% nahi). */
  function blankMissingPrev(sheets, rep) {
    const na = rep.prevNA || {};
    if (!na.ff && !na.gv) return;
    for (const sh of sheets) {
      const H = sh.header, ci = H.indexOf('Channel');
      const cols = ['Prev-2 total', 'Prev total', 'Change', 'Performance %'].map((h) => H.indexOf(h)).filter((i) => i >= 0), pi = H.indexOf('Performance');
      if (!cols.length) continue;
      sh.rows.forEach((row) => {
        if (row.every((x) => x === '')) return;
        const ch = ci >= 0 ? String(row[ci]) : '';
        const hit = ch === 'FF' ? na.ff : ch === 'GV' ? na.gv : (na.ff || na.gv);
        if (!hit) return;
        cols.forEach((i) => { row[i] = ''; });
        if (pi >= 0) row[pi] = 'n/a · prev data not loaded';
      });
    }
  }
  function styleSheet(sh) {
    const H = sh.header;
    const isMonCol = (h) => /^[A-Z][a-z]{2} \d{2} (VC4|VC20|VC5\+|Total)$/.test(h);
    const monIdx = (h) => { const k = h.slice(0, 6); return [...new Set(H.filter(isMonCol).map((x) => x.slice(0, 6)))].indexOf(k); };
    const labelCol = 2;
    sh.headStyleOf = (c) => { const h = H[c] || ''; return isMonCol(h) ? (/Total$/.test(h) ? 'hTotal' : 'hMonth') : /^Total$|^Avg/.test(h) ? 'hTotal' : /Performance|vs .* %|^Growth/.test(h) ? 'hPerf' : /^Prev|^Change/.test(h) ? 'hPrev' : ''; };
    sh.styleOf = (ri, c, v) => {
      const row = sh.rows[ri] || [], h = H[c] || '';
      const lab = `${row[labelCol] || ''} ${row[0] || ''}`;
      if (/GRAND TOTAL/.test(lab)) return 'rowGrand';
      if (/TOTAL/.test(lab) || (sh.name === 'Month-wise summary' && row[2] === 'GV + FF')) return 'rowTotal';
      if (h === 'Performance' || /^Growth$/.test(h)) return /Up|New|▲/.test(v) ? 'up' : /Down|No issuance|▼/.test(v) ? 'down' : v ? 'flat' : '';
      if (/Performance %|vs .* %|Growth %/.test(h)) return typeof v === 'number' ? (v > 0 ? 'up' : v < 0 ? 'down' : 'flat') : '';
      if (h === 'Total') return 'total';
      if (/^Avg/.test(h)) return 'total';
      if (isMonCol(h)) return /Total$/.test(h) ? 'monTotal' : (monIdx(h) % 2 ? 'monB' : 'monA');
      if (/^Prev|^Change/.test(h)) return 'prev';
      return typeof v === 'number' ? 'num' : '';
    };
  }
  /** Multi-month report: classes + Total + Avg/month + last full month vs month before + Share, phir har mahine ke columns. */
  function reportSheetsMonthly(rep, m, which, months) {
    const full = months.filter((ym) => fullMonth(ym, m.from, m.to));
    const cmp = full.length >= 2 ? full.slice(-2) : months.slice(-2);   // [B, A]
    const [B, A] = cmp;
    const avgBase = full.length ? full : months;
    const avgOf = (mon) => Math.round(avgBase.reduce((a, ym) => a + (((mon || {})[ym] || {}).total || 0), 0) / avgBase.length);
    const vA = (mon) => (((mon || {})[A] || {}).total || 0), vB = (mon) => (((mon || {})[B] || {}).total || 0);
    const cmpH = `${monLabel(A)} vs ${monLabel(B)} %`, cmpS = 'Performance';
    const tail = (mon, total) => [total, avgOf(mon), perfCell(vA(mon), vB(mon)), perfStatus(vA(mon), vB(mon)), rep.grandTotal ? r1((total / rep.grandTotal) * 100) : 0];
    const tlAgents = rep.list.filter((o) => !o.direct), direct = rep.list.filter((o) => o.direct);
    const piv = tlPivot(rep.list);
    const both = which === 'both';
    const active = (l) => l.filter((o) => o.total > 0).length;
    const TL_HEAD = ['Rank', 'TL ID', 'TL Name', 'Channel', 'Agents (active)', 'VC4', 'VC20', 'VC5+', 'Total', `Avg / month (${avgBase.length})`, cmpH, cmpS, 'Share %', ...monHead(months)];
    const tlLine = (label, list) => { const t = sumOf(list), mon = monSum(list); return ['', '', label, '', active(list), t.vc4, t.vc20, t.vc5, ...tail(mon, t.total), ...monCells(mon, months)]; };
    const tlRows = [...piv.map((x, i) => [i + 1, x.id, x.name, chName(x.ch), x.agents, x.vc4, x.vc20, x.vc5, ...tail(x.mon, x.total), ...monCells(x.mon, months)]),
      Array(TL_HEAD.length).fill(''), tlLine('TOTAL · all TLs (agents under TLs)', tlAgents), tlLine('TOTAL · direct agents', direct), tlLine('GRAND TOTAL', rep.list)];
    const AG_HEAD = ['Rank', 'Agent ID', 'Agent Name', 'Mobile', 'TL Name', 'TL ID', 'Channel', 'VC4', 'VC20', 'VC5+', 'Total', `Avg / month (${avgBase.length})`, cmpH, cmpS, 'Share %', ...monHead(months)];
    const agRows = (list, label) => {
      const rows = list.map((o, i) => [i + 1, o.id, o.name, o.mobile || '', o.tlName, o.tlId, chName(o.ch), o.vc4, o.vc20, o.vc5, ...tail(o.mon, o.total), ...monCells(o.mon, months)]);
      if (list.length) { const t = sumOf(list), mon = monSum(list); rows.push(['', '', label, '', '', '', '', t.vc4, t.vc20, t.vc5, ...tail(mon, t.total), ...monCells(mon, months)]); }
      return rows;
    };
    // Month-wise summary: har mahine × channel, pichhle mahine se change / growth
    const chs = both ? ['ff', 'gv'] : [which];
    const SUM_HEAD = ['Month', 'Period', 'Channel', 'VC4', 'VC20', 'VC5+', 'Total', 'VC4 %', 'Commercial (VC20+VC5+)', 'Change vs prev month', 'Growth %', 'Growth', 'Days', 'Per day'];
    const sumRows = [];
    const per = {}; chs.forEach((ch) => { per[ch] = monSum(rep.list.filter((o) => o.ch === ch)); }); per.all = monSum(rep.list);
    const dOf = (ym) => { const a = m.from > `${ym}-01` ? m.from : `${ym}-01`, last = `${ym}-${String(ymDays(ym)).padStart(2, '0')}`, b = m.to < last ? m.to : last; return [a, b, dayCount(a, b)]; };
    const lineFor = (ym, i, key, chLabel) => {
      const v = per[key][ym] || { vc4: 0, vc20: 0, vc5: 0, total: 0 };
      const pv = i > 0 ? ((per[key][months[i - 1]] || {}).total || 0) : null;
      const [a, b, d] = dOf(ym);
      const partial = !fullMonth(ym, m.from, m.to);
      return [`${monLabel(ym)}${partial ? ' (partial)' : ''}`, `${a} → ${b}`, chLabel, v.vc4, v.vc20, v.vc5, v.total, v.total ? r1((v.vc4 / v.total) * 100) : 0, v.vc20 + v.vc5,
        pv === null ? '' : v.total - pv, pv === null || partial ? '' : perfCell(v.total, pv), pv === null ? '—' : partial ? 'partial month' : perfStatus(v.total, pv), d, d ? r1(v.total / d) : 0];
    };
    months.forEach((ym, i) => {
      chs.forEach((ch) => sumRows.push(lineFor(ym, i, ch, chName(ch))));
      if (both) sumRows.push(lineFor(ym, i, 'all', 'GV + FF'));
    });
    const g = sumOf(rep.list), gd = dayCount(m.from, m.to);
    sumRows.push(Array(SUM_HEAD.length).fill(''), ['GRAND TOTAL', `${m.from} → ${m.to}`, both ? 'GV + FF' : chName(which), g.vc4, g.vc20, g.vc5, g.total, g.total ? r1((g.vc4 / g.total) * 100) : 0, g.vc20 + g.vc5, '', '', '', gd, gd ? r1(g.total / gd) : 0]);
    return [
      { name: 'Month-wise summary', header: SUM_HEAD, rows: sumRows },
      { name: both ? 'TLs (GV + FF)' : `TLs (${REPORTS[which][1]})`, header: TL_HEAD, rows: tlRows, filterRows: piv.length + 1 },
      { name: both ? 'Direct Agents (GV + FF)' : `Direct Agents (${REPORTS[which][1]})`, header: AG_HEAD, rows: agRows(direct, 'TOTAL · direct agents'), filterRows: direct.length + 1 },
      { name: both ? 'Agents under TLs (GV + FF)' : `Agents under TLs (${REPORTS[which][1]})`, header: AG_HEAD, rows: agRows(tlAgents, 'TOTAL · agents under TLs'), filterRows: tlAgents.length + 1 },
      { name: 'Info', header: ['Item', 'Value'], rows: [
        ['Report', REPORTS[which][0]], ['Period', `${m.from} to ${m.to} (${months.length} months: ${months.map(monLabel).join(', ')})`],
        ...(which !== 'gv' ? [['FF total (report)', rep.chTot.ff], ['FF total (Total Issued card)', m.ff.total], ['FF source difference (report − KPI)', rep.chTot.ff - m.ff.total]] : []),
        ...(which !== 'ff' ? [['GV detail total (GV Master)', rep.chTot.gv - sourceAdjustmentTotal(rep, 'gv')], ['GV EIR reconciliation (unassigned)', sourceAdjustmentTotal(rep, 'gv')], ['GV total (report, reconciled to EIR)', rep.chTot.gv], ['GV total (Total Issued card, EIR)', m.gv.total], ['GV source difference (report − KPI)', rep.chTot.gv - m.gv.total]] : []),
        ['Report total − KPI total', rep.grandTotal - (which === 'ff' ? m.ff.total : which === 'gv' ? m.gv.total : m.ff.total + m.gv.total)],
        ['Source alignment', 'GV agent/TL detail comes from GV Master. A per-date/class source-reconciliation row equals GV EIR daily count minus GV Master count, so the GV report total matches the EIR KPI. This adjustment is unassigned and is not attributed to any agent. Today’s GV live replacement is included.'],
        ['Avg / month', `Average of ${avgBase.length} ${full.length ? 'full ' : ''}month(s): ${avgBase.map(monLabel).join(', ')}`],
        [cmpH, `${monLabel(A)} total vs ${monLabel(B)} total (latest ${full.length >= 2 ? 'full ' : ''}month vs the month before) · (${monLabel(A)} − ${monLabel(B)}) ÷ ${monLabel(B)} × 100`],
        ['Performance', '▲ Up · ▼ Down · = Same · ★ New (nothing in the earlier month) · ✖ No issuance now'],
        ['Month columns', 'Every month in the range: VC4 / VC20 / VC5+ / Total (green = month total)'],
        ['Month-wise summary', 'Growth % is vs the previous month; a partial month (range cut) is not compared'],
        ['Share %', 'Share of the report grand total'], ['Sorted', 'Highest to lowest total'],
        ['Sources', 'FF: EIR daily rows (same as KPI); TL + mobile enriched from FF REPORT. GV: GV Master agent/TL detail + visible per-date/class reconciliation to GV EIR KPI; mobile from GV REPORT.'],
        ['Generated', new Date().toLocaleString('en-IN')]] }
    ];
  }
  function reportSheets0(rep, m, which) {
    const tlAgents = rep.list.filter((o) => !o.direct), direct = rep.list.filter((o) => o.direct);
    const piv = tlPivot(rep.list);
    const TL_HEAD = ['Rank', 'TL ID', 'TL Name', 'Channel', 'Agents (active)', 'VC4', 'VC20', 'VC5+', 'Total', 'Prev-2 total', 'Prev total', 'Change', 'Performance %', 'Performance', 'Share %'];
    const tlRows = piv.map((x, i) => [i + 1, x.id, x.name, chName(x.ch), x.agents, x.vc4, x.vc20, x.vc5, x.total, x.prev2 || 0, x.prev, x.total - x.prev, perfCell(x.total, x.prev), x.status, x.share]);
    const line = (label, list, agentsN) => { const t = sumOf(list); return ['', '', label, '', agentsN, t.vc4, t.vc20, t.vc5, t.total, t.prev2, t.prev, t.total - t.prev, perfCell(t.total, t.prev), perfStatus(t.total, t.prev), rep.grandTotal ? r1((t.total / rep.grandTotal) * 100) : 0]; };
    const active = (l) => l.filter((o) => o.total > 0).length;
    const blank = Array(TL_HEAD.length).fill('');
    const tlSheetRows = [...tlRows, blank,
      line('TOTAL · all TLs (agents under TLs)', tlAgents, active(tlAgents)),
      line('TOTAL · direct agents', direct, active(direct)),
      line('GRAND TOTAL', rep.list, active(rep.list))];
    const withTotal = (list, label) => { const rows = list.map(agentRow); if (list.length) rows.push(totalRow(label, list, AGENT_HEAD.length)); return rows; };
    const both = which === 'both';
    return [
      { name: both ? 'TLs (GV + FF)' : `TLs (${REPORTS[which][1]})`, header: TL_HEAD, rows: tlSheetRows },
      { name: both ? 'Direct Agents (GV + FF)' : `Direct Agents (${REPORTS[which][1]})`, header: AGENT_HEAD, rows: withTotal(direct, 'TOTAL · direct agents') },
      { name: both ? 'Agents under TLs (GV + FF)' : `Agents under TLs (${REPORTS[which][1]})`, header: AGENT_HEAD, rows: withTotal(tlAgents, 'TOTAL · agents under TLs') },
      { name: 'Info', header: ['Item', 'Value'], rows: [
        ['Report', REPORTS[which][0]], ['Period', `${m.from} to ${m.to}`],
        ['Previous period (FF)', m.prevFfRange ? `${m.prevFfRange[0]} to ${m.prevFfRange[1]}` : '—'], ['Previous period (GV)', m.prevGvRange ? `${m.prevGvRange[0]} to ${m.prevGvRange[1]}` : '—'],
        ...(which !== 'gv' ? [['FF total (report)', rep.chTot.ff], ['FF total (Total Issued card)', m.ff.total], ['FF source difference (report − KPI)', rep.chTot.ff - m.ff.total]] : []),
        ...(which !== 'ff' ? [['GV detail total (GV Master)', rep.chTot.gv - sourceAdjustmentTotal(rep, 'gv')], ['GV EIR reconciliation (unassigned)', sourceAdjustmentTotal(rep, 'gv')], ['GV total (report, reconciled to EIR)', rep.chTot.gv], ['GV total (Total Issued card, EIR)', m.gv.total], ['GV source difference (report − KPI)', rep.chTot.gv - m.gv.total]] : []),
        ['Report total − KPI total', rep.grandTotal - (which === 'ff' ? m.ff.total : which === 'gv' ? m.gv.total : m.ff.total + m.gv.total)],
        ['Source alignment', 'GV agent/TL detail comes from GV Master. A per-date/class source-reconciliation row equals GV EIR daily count minus GV Master count, so the GV report total matches the EIR KPI. This adjustment is unassigned and is not attributed to any agent. Today’s GV live replacement is included.'],
        ['Performance %', '(Total − Prev total) ÷ Prev total × 100, previous period of the same length'],
        ['Performance', '▲ Up · ▼ Down · = Same · ★ New (nothing in previous period) · ✖ No issuance now'],
        ['Share %', 'Share of the report grand total'], ['Sorted', 'Highest to lowest total'],
        ['Sources', 'FF: EIR daily rows (same as KPI); TL + mobile enriched from FF REPORT. GV: GV Master agent/TL detail + visible per-date/class reconciliation to GV EIR KPI; mobile from GV REPORT.'],
        ['Generated', new Date().toLocaleString('en-IN')]] }
    ];
  }
  /** Flat CSV: every agent (TL agents + direct agents), highest → lowest. */
  function reportCsv(rep) {
    const months = (rep.months && rep.months.length > 1) ? rep.months : [];
    return { head: [...AGENT_HEAD.slice(0, 6), 'Type', ...AGENT_HEAD.slice(6), ...monHead(months)], rows: rep.list.map((o, i) => { const r = agentRow(o, i); if ((rep.prevNA || {})[o.ch]) { r[11] = ''; r[12] = ''; r[13] = ''; r[14] = ''; r[15] = 'n/a · prev data not loaded'; } return [...r.slice(0, 6), o.sourceAdjustment ? 'Source reconciliation' : o.direct ? 'Direct agent' : 'Agent under TL', ...r.slice(6), ...monCells(o.mon, months)]; }) };
  }
  /** FF REPORT (TL / mobile by agent) + GV REPORT (mobile). Best effort, bounded wait. */
  async function reportDirectory() {
    const wait = (p, ms) => Promise.race([Promise.resolve(p).catch(() => null), new Promise((r) => setTimeout(r, ms))]);
    const ffById = new Map(), ffByName = new Map(), gvMob = new Map(), gvMobName = new Map();
    try {
      if (FF.lazy && FF.lazy.ensure) await wait(FF.lazy.ensure('performance'), 8000);
      const P = FF.pages.performance;
      if (P && P.ensureLoaded) await wait(P.ensureLoaded(), 12000);
      if (FF.aliases && FF.aliases.load) await wait(FF.aliases.load(), 5000);
      const ags = (P && P.agents && P.agents()) || [];
      for (const a of ags) {
        const rec = { name: a.name, tlName: a.tlExcluded ? '' : a.tlName, tlId: a.tlExcluded ? '' : a.tlId, mobile: /^na$/i.test(U.clean(a.mobile)) ? '' : U.clean(a.mobile) };
        const ids = [a.agentId, a.id];
        try { const al = FF.aliases && FF.aliases.of && FF.aliases.of(a.agentId || a.id); if (al) ids.push(al.agentId, ...(al.assist || [])); } catch (e) { /* no aliases */ }
        ids.map(nid).filter(Boolean).forEach((k) => { if (!ffById.has(k)) ffById.set(k, rec); });
        const n = nname(a.name); if (n && !ffByName.has(n)) ffByName.set(n, rec);
      }
    } catch (e) { /* FF directory unavailable */ }
    try {
      let gr = G && G.get && G.get('report');
      if (!Array.isArray(gr) && G && G.need) gr = await wait(G.need('report'), 8000);
      for (const r of (Array.isArray(gr) ? gr : [])) {
        const v = U.clean(r.mobile); if (!v || /^na$/i.test(v)) continue;
        if (nid(r.agentId) && !gvMob.has(nid(r.agentId))) gvMob.set(nid(r.agentId), v);
        if (nname(r.agentName) && !gvMobName.has(nname(r.agentName))) gvMobName.set(nname(r.agentName), v);
      }
    } catch (e) { /* GV mobiles unavailable */ }
    return {
      ff(id, name) {
        const k = nid(id);
        let hit = k ? ffById.get(k) : null;
        if (!hit && k && FF.aliases && FF.aliases.map) { const to = nid(FF.aliases.map(id)); if (to) hit = ffById.get(to); }
        return hit || (name ? ffByName.get(nname(name)) : null) || null;
      },
      gv(id, name) { return gvMob.get(nid(id)) || gvMobName.get(nname(name)) || ''; }
    };
  }
  async function render(root, params) {
    params = params || {};
    const admin = !!(FF.auth && FF.auth.isAdmin && FF.auth.isAdmin());
    let selectedPerson = null;
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

    root.innerHTML = `<div class="page-head"><div><h1>🏷️ GV & FF Tag Issued</h1><p class="sub">GV Partner (EIR master ID 5845036) vs First Forward — VC4 · VC20 · VC5+ · Commercial, share %, up/down and graphs</p></div>
      <div class="head-actions"><button class="btn primary" data-action="refresh">↻ Refresh</button></div></div>
      <div class="card tix-toolbar">
        <div class="tix-presets" id="ti-presets" role="group" aria-label="Date shortcuts">${PRESETS.map(([id, label]) => `<button type="button" class="tix-chipbtn" data-preset="${id}">${label}</button>`).join('')}<button type="button" class="tix-chipbtn" data-preset="custom">Custom</button><span class="tix-chipsep" aria-hidden="true"></span>${admin ? Object.entries(REPORTS).map(([k, [label]]) => `<button type="button" class="tix-chipbtn tix-repchip ${k}" data-rep-view="${k}" title="Show this report on screen for the selected dates">${k === 'gv' ? '🟩' : k === 'ff' ? '🟦' : '⚖️'} ${label}</button>`).join('') : ''}</div>
        <div class="tix-dates">
          <label>📅 From <input type="date" class="input" id="ti-from" value="${esc(from)}" max="${todayKey()}"></label>
          <label>To <input type="date" class="input" id="ti-date" value="${esc(to)}" max="${todayKey()}"></label>
          <button class="btn small" type="button" id="ti-apply">Apply</button>
          ${admin ? `<div class="tix-person-search" id="ti-person-search-wrap"><label for="ti-person-search">👥 GV / FF agent / TL</label><div class="tix-person-input-wrap"><input type="search" class="input" id="ti-person-search" placeholder="GV / FF agent ya TL naam search…" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="ti-person-options"><button type="button" class="btn small" id="ti-person-clear" title="Search clear karein" hidden>✕</button><div class="tix-person-options" id="ti-person-options" role="listbox" hidden></div></div></div>` : ''}
          ${admin ? `<div class="tix-report" id="ti-report">
            <button class="btn primary" type="button" id="ti-report-btn" aria-haspopup="true" aria-expanded="false">📥 Report ▾</button>
            <div class="tix-report-menu" id="ti-report-menu" hidden role="menu">
              ${Object.entries(REPORTS).map(([k, [label]]) => `<div class="tix-report-item"><b>${k === 'gv' ? '🟩' : k === 'ff' ? '🟦' : '⚖️'} ${label}</b><span><button type="button" class="btn small" data-rep="${k}" data-fmt="xlsx">Excel</button><button type="button" class="btn small" data-rep="${k}" data-fmt="csv">CSV</button></span></div>`).join('')}
              <p class="dim small">Uses the dates selected above · TL agents and direct agents on separate sheets · highest → lowest.</p>
            </div>
          </div>` : ''}
        </div>
        <div class="tix-rangeinfo" id="ti-info"></div>
      </div>
      <div id="ti-body">${U.spinner('Data load ho raha hai…')}</div>`;

    const body = U.$('#ti-body', root), fromInput = U.$('#ti-from', root), toInput = U.$('#ti-date', root), info = U.$('#ti-info', root), presetBox = U.$('#ti-presets', root);

    try {
      await Promise.all([S.need('daily').catch(() => []), admin ? G.need('master').catch(() => []) : Promise.resolve([])]);
    } catch (e) {
      body.innerHTML = U.errorBox(e, 'data-action="refresh"');
      return;
    }

    function paintPresets() {
      U.$$('[data-preset]', presetBox).forEach((b) => b.classList.toggle('active', b.getAttribute('data-preset') === preset));
    }
    const personInput = admin ? U.$('#ti-person-search', root) : null;
    const personOptionsBox = admin ? U.$('#ti-person-options', root) : null;
    const personClear = admin ? U.$('#ti-person-clear', root) : null;
    let activePersonOptions = [], lastDirRows = null, dirExtraAsked = false;
    /** Dropdown pehli baar khule to GV REPORT + FF REPORT (agents list) bhi laao — jinke is mahine tags nahi, wo bhi mile. */
    function ensureFullDirectory() {
      if (dirExtraAsked || !admin) return; dirExtraAsked = true;
      const jobs = [];
      if (G && G.need && !(G.get && (G.get('report') || []).length)) jobs.push(G.need('report', { only: true }).catch(() => null));
      if (FF.lazy && FF.lazy.need && !(FF.pages.performance && FF.pages.performance.agents)) jobs.push(FF.lazy.need('performance').catch(() => null));
      if (!jobs.length) return;
      Promise.all(jobs).then(async () => {
        try { if (FF.pages.performance && FF.pages.performance.ensureLoaded) await FF.pages.performance.ensureLoaded({ light: true }).catch(() => null); } catch { /* optional */ }
        if (!lastDirRows || !root.isConnected) return;
        activePersonOptions = personDirectory({
          ffRows: lastDirRows.ffRows, gvMasterRows: lastDirRows.gvMasterRows, gvRows: lastDirRows.gvRows,
          ffAgents: (FF.pages.performance && FF.pages.performance.agents) ? (() => { try { return FF.pages.performance.agents() || []; } catch { return []; } })() : [],
          gvReport: (G && G.get) ? (G.get('report') || []) : []
        }, from, to);
        if (personOptionsBox && !personOptionsBox.hidden) paintPersonSuggestions();
      });
    }
    function paintPersonSuggestions() {
      if (!personInput || !personOptionsBox) return;
      const q = personKey(personInput.value);
      const qd = q.replace(/\D/g, '');
      // Khaali box par bhi list (is range ke top naam); likhne par naam / ID se — saare GV + FF agents & TLs
      const matches = (q ? activePersonOptions.filter((o) => personKey(o.name).includes(q) || (qd.length >= 3 && (o.ids || []).some((x) => String(x).replace(/\D/g, '').includes(qd))))
        .sort((a, b) => (personKey(b.name).startsWith(q) - personKey(a.name).startsWith(q)) || b.n - a.n || a.name.localeCompare(b.name)) : activePersonOptions).slice(0, 60);
      const head = `<div class="tix-person-head">${q ? `${matches.length >= 60 ? '60+' : matches.length} match` : `Is range ke top ${matches.length} · likho = saare ${U.fmt(activePersonOptions.length)} GV + FF agents / TLs`}</div>`;
      personOptionsBox.innerHTML = head + (matches.length ? matches.map((o, i) => `<button type="button" role="option" aria-selected="false" class="tix-opt ${o.channel}" data-person-index="${i}" data-person-channel="${esc(o.channel)}" data-person-type="${esc(o.type)}" data-person-name="${esc(o.name)}"><span class="tix-opt-ch ${o.channel}">${o.channel === 'ff' ? '🟦 FF' : '🟩 GV'}</span><span class="tix-opt-main"><b>${esc(o.name)}</b><small>${o.type === 'tl' ? '🧑‍💼 TL / team' : '👤 Agent'}${o.ids && o.ids[0] ? ` · ${esc(o.ids[0])}` : ''}</small></span><span class="tix-opt-n" title="Is range me tags">${o.n ? U.fmt(o.n) : '—'}</span></button>`).join('') : '<div class="tix-person-empty">Koi GV / FF agent ya TL nahi mila.</div>');
      personOptionsBox.hidden = false;
      personInput.setAttribute('aria-expanded', 'true');
    }

    function draw() {
      paintPresets();
      fromInput.value = from; toInput.value = to;
      const rows = channelRows();
      lastDirRows = rows;
      activePersonOptions = admin ? personDirectory({
        ffRows: rows.ffRows, gvMasterRows: rows.gvMasterRows, gvRows: rows.gvRows,
        ffAgents: (FF.pages.performance && FF.pages.performance.agents) ? (() => { try { return FF.pages.performance.agents() || []; } catch { return []; } })() : [],
        gvReport: (G && G.get) ? (G.get('report') || []) : []
      }, from, to) : [];
      if (personClear) personClear.hidden = !selectedPerson;
      rows.ffMap = scanDays(rows.ffRows);
      rows.gvMap = scanDays(rows.gvRows);
      const m = buildModel(rows, from, to);
      const cardModel = admin && selectedPerson ? personCardModel(m, rows.gvMasterRows, rows.ffRows, selectedPerson) : m;
      const prevTxt = m.prevGvRange ? `vs ${esc(rangeLabel(m.prevGvRange[0], m.prevGvRange[1], true))}` : '';
      info.innerHTML = `<span class="badge indigo">${esc(rangeLabel(from, to, true))}</span> <span class="dim">${m.days} din ${prevTxt ? `· ${prevTxt}` : ''}</span> ${m.ffPending || m.gvPending ? `<span class="badge amber" title="The EIR sheet is T+1 — data after ${esc(lbl(m.ffThrough, true))} arrives tomorrow. So growth is shown like-for-like (same number of days).">🧾 EIR T+1 · ${m.ffComparable || m.gvComparable ? 'latest data tak' : 'kal aayega'}</span>` : ''} ${admin && selectedPerson ? `<span class="badge teal">Filtered KPI boxes · ${selectedPerson.channel === 'ff' ? 'First Forward' : 'GV'} ${selectedPerson.type === 'tl' ? 'TL' : 'Agent'}: ${esc(selectedPerson.name)}</span>` : ''} ${admin ? '' : '<span class="dim small">🔒 Agent/TL details aur box drilldown sirf admin ke liye.</span>'}`;
      const total = m.ff.total + m.gv.total;
      const totalP = m.ffPrev.total + m.gvPrev.total;

      body.innerHTML = `
        ${healthStrip(rows)}
        <div class="tix-grid">${KPIS.map((k) => kpiCard(k, cardModel, admin)).join('')}</div>
        ${card(`⚔️ Head-to-head · FF vs GV · ${esc(rangeLabel(from, to, true))}`, h2hTable(m), `<span class="badge indigo">${U.fmt(total)} tags</span> <span class="dim small">prev ${U.fmt(totalP)}</span> <button class="btn small" data-action="export" data-name="tag-issued-${esc(from)}-${esc(to)}">⬇ CSV</button>`)}
        ${admin ? driversShell(m, preset) : ''}
        ${chartsHtml(m, rows)}
        <div class="grid g-2">
          ${card('💡 Insights · data ko dekh kar', insightsHtml(m, rows, preset))}
          ${card('📋 Class-wise detail', classTable(m), '')}
        </div>
        ${card(`🔎 Data check · GV EIR vs GV Master`, reconHtml(m, rows), '<span class="dim small">dashboard totals = EIR</span>')}
        ${admin ? `<details class="tix-people" open><summary>👥 Agents & Teams</summary>${peopleHtml(m, rows)}</details>` : ''}
        <p class="foot-note">Source: EIR sheet (FF + GV = master ID 5845036, T+1) · Top agents: GV Master · ${esc(rangeLabel(from, to, true))} · Data ${U.timeLabel(S.loadedAt || G.loadedAt || Date.now())} · ↻ se fresh data</p>`;
      C.mount(body);
      if (admin) paintDrivers(body, m, preset, rows);

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
      const rv = e.target.closest('[data-rep-view]');
      if (rv) { openReportView(rv.dataset.repView); return; }
      const b = e.target.closest('[data-preset]');
      if (!b) return;
      const id = b.getAttribute('data-preset');
      if (id === 'custom') { preset = 'custom'; paintPresets(); fromInput.focus(); return; }
      preset = id; [from, to] = presetRange(id, new Date());
      store.set('ti_preset', id);
      draw();
    });

    // growth-driver interactions (capture phase so the KPI card's own click handler does not also fire)
    const drvJump = (ch, cls, dir) => {
      DRV.ch = ch; DRV.cls = cls; DRV.dir = dir === 'up' ? 'up' : dir === 'down' ? 'down' : DRV.dir;
      if (dir === 'flat' || dir === 'none' || dir === 'new') DRV.dir = 'now';
      const m = DRV.model; if (m) { const h = body.querySelector('#ti-drv-body'); if (h) h.innerHTML = driversHtml(m, DRV.rows || []); }
      const sec = body.querySelector('#ti-drv'); if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const redraw = () => { const m = DRV.model; const h = body.querySelector('#ti-drv-body'); if (m && h && DRV.rows) h.innerHTML = driversHtml(m, DRV.rows); };
    body.addEventListener('click', (e) => {
      const link = e.target.closest && e.target.closest('[data-drv]');
      if (link) { e.stopPropagation(); e.preventDefault(); drvJump(link.dataset.drv, link.dataset.drvcls || 'total', link.dataset.drvdir); return; }
      const inDrv = e.target.closest && e.target.closest('#ti-drv');
      if (!inDrv) return;
      const set = e.target.closest('[data-drv-set]');
      if (set) { const [k, v] = set.dataset.drvSet.split(':'); DRV[k] = v; if (k === 'level' && v === 'tls' && DRV.scope === 'tl') DRV.scope = 'tl'; redraw(); return; }
      const mx = e.target.closest('[data-mx-ch]');
      if (mx) { DRV.ch = mx.dataset.mxCh; DRV.scope = mx.dataset.mxScope === 'direct' ? 'direct' : mx.dataset.mxScope === 'tl' ? 'tl' : 'all'; redraw(); return; }
      if (e.target.closest('[data-drv-retry]')) { DRV.cache.clear(); const m = DRV.model; if (m) paintDrivers(body, m, preset, channelRows()); return; }
      if (e.target.closest('[data-drv-csv]')) {
        const rowsOut = (DRV.lastRows || []).map((o, i) => [i + 1, o.name, o.id, o.ch === 'gv' ? 'GV' : 'FF', typeLabel(o), o.tl || '', o.prev, o.cur, o.delta, o.growth === null ? '' : Math.round(o.growth * 10) / 10, drvStatus(o)]);
        U.downloadCsv(`growth-drivers-${DRV.dir}-${from}-${to}.csv`, ['#', 'Name', 'ID', 'Channel', 'Type', 'TL', 'Last', 'Now', 'Change', 'Growth %', 'Status'], rowsOut);
        return;
      }
      const tr = e.target.closest('[data-drv-open]');
      if (tr && !tr.dataset.nolink && FF.app && FF.app.navigate) FF.app.navigate(`${tr.dataset.drvCh === 'gv' ? 'gv' : 'ff'}AgentSummary`, { name: tr.dataset.drvOpen });
    }, true);
    body.addEventListener('change', (e) => { const sel = e.target.closest && e.target.closest('[data-drv-cls]'); if (sel) { DRV.cls = sel.value; redraw(); } }, true);

    // 📊 Report on screen (same data as the download)
    async function makeReport(which) {
      if (!admin) throw new Error('Ye detailed report sirf admin ke liye hai.');
      const rows0 = channelRows();
      const m = buildModel(rows0, from, to);
      return { m, rep: buildAgentReport(reportInputs(rows0, await reportDirectory()), m, which) };
    }
    const repCell = (v, k, head) => {
      const h = head[k] || '';
      if (h === 'Performance') { const cls = /Up|New/.test(v) ? 'up' : /Down|No issuance/.test(v) ? 'down' : 'flat'; return `<td class="tix-perf ${cls}">${esc(v)}</td>`; }
      if (h === 'Performance %') return `<td class="num tix-perf ${v === '' ? 'flat' : v > 0 ? 'up' : v < 0 ? 'down' : 'flat'}">${v === '' ? '—' : `${v > 0 ? '+' : ''}${v}%`}</td>`;
      if (h === 'Share %') return `<td class="num">${v === '' ? '' : `${v}%`}</td>`;
      if (typeof v === 'number') return `<td class="num${h === 'Total' ? ' tix-tot' : ''}">${U.fmt(v)}</td>`;
      return `<td>${esc(v == null ? '' : v)}</td>`;
    };
    const repTable = (sh) => `<div class="table-wrap tix-rep-wrap"><table class="tbl compact tix-rep-tbl"><thead><tr>${sh.header.map((h) => `<th${/VC|Total|Prev|Change|Perf.*%|Share|Rank|Agents/.test(h) ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${sh.rows.map((r) => {
      const label = String(r[2] || '');
      const cls = /^GRAND TOTAL/.test(label) ? 'tix-rep-grand' : /^TOTAL/.test(label) ? 'tix-rep-total' : r.every((x) => x === '') ? 'tix-rep-gap' : '';
      return `<tr class="${cls}">${r.map((v, k) => repCell(v, k, sh.header)).join('')}</tr>`;
    }).join('')}</tbody></table></div>`;
    async function openReportView(which) {
      if (!admin) { U.toast('Detailed agent/TL report sirf admin dekh sakta hai.', 'err'); return; }
      const title = `${REPORTS[which][0]} · ${rangeLabel(from, to, true)}`;
      FF.app.openDrawer({ kicker: '📊 Report', title, sub: 'Preparing…', body: U.spinner('Building the report…'), wide: true, loading: true });
      let m, rep;
      try { ({ m, rep } = await makeReport(which)); } catch (err) { FF.app.openDrawer({ kicker: '📊 Report', title, body: U.errorBox(err), wide: true, replace: true }); return; }
      const sheets = reportSheets(rep, m, which);
      const tabs = sheets.map((sh, i) => `<button type="button" class="tix-chipbtn${i === 0 ? ' active' : ''}" data-rep-tab="${i}">${esc(sh.name)}${(sh.name === 'Info' || sh.name === 'Month-wise summary') ? '' : ` <small>${U.fmt(sh.rows.filter((r) => typeof r[0] === 'number').length)}</small>`}</button>`).join('');
      const ch = (k) => (which === 'both' || which === k ? `<span class="badge ${k === 'gv' ? 'green' : 'blue'}">${k === 'gv' ? '🟩 GV' : '🟦 FF'} ${U.fmt(rep.chTot[k])}</span>` : '');
      const kpiTotal = which === 'ff' ? m.ff.total : which === 'gv' ? m.gv.total : m.ff.total + m.gv.total;
      const sourceDelta = rep.grandTotal - kpiTotal;
      const sourceBasis = which === 'ff' ? 'FF EIR report vs FF EIR KPI' : which === 'gv' ? 'GV Master detail + EIR reconciliation vs GV EIR KPI' : 'FF EIR + (GV Master detail + EIR reconciliation) vs FF EIR + GV EIR KPI';
      const body = `<div class="tix-rep" id="tix-rep">
        <div class="tix-rep-top">${ch('ff')}${ch('gv')}<span class="badge indigo">Report total ${U.fmt(rep.grandTotal)}</span><span class="badge">${U.fmt(rep.list.length)} agents</span>
          <input type="search" class="input tix-rep-q" placeholder="Filter: agent, TL, ID, mobile…" aria-label="Filter rows"></div>
        <p class="dim small">Source check · KPI total (EIR): <b>${U.fmt(kpiTotal)}</b> · Report total: <b>${U.fmt(rep.grandTotal)}</b> · Difference (report − KPI): <b>${sourceDelta > 0 ? '+' : ''}${U.fmt(sourceDelta)}</b><br>${esc(sourceBasis)}. GV agent/TL detail comes from GV Master. A visible per-date/class reconciliation line uses GV EIR minus GV Master and is not assigned to an agent, keeping the GV total aligned with the KPI.</p>
        <div class="tix-presets tix-rep-tabs">${tabs}</div>
        ${sheets.map((sh, i) => `<div class="tix-rep-pane" data-rep-pane="${i}"${i ? ' hidden' : ''}>${repTable(sh)}</div>`).join('')}
      </div>`;
      const actions = `<button class="btn small" data-rep-dl="xlsx">⬇ Excel</button><button class="btn small" data-rep-dl="csv">⬇ CSV</button>`;
      FF.app.openDrawer({ kicker: '📊 Report', title, sub: `${esc(rangeLabel(from, to, true))} · highest → lowest · performance vs ${m.prevGvRange ? esc(rangeLabel(m.prevGvRange[0], m.prevGvRange[1], true)) : 'previous period'}`, body, actions, wide: true, replace: true });
      const host = document.getElementById('tix-rep'); if (!host) return;
      host.addEventListener('click', (e) => {
        const t = e.target.closest('[data-rep-tab]'); if (!t) return;
        host.querySelectorAll('[data-rep-tab]').forEach((b) => b.classList.toggle('active', b === t));
        host.querySelectorAll('[data-rep-pane]').forEach((p) => { p.hidden = p.dataset.repPane !== t.dataset.repTab; });
      });
      const q = host.querySelector('.tix-rep-q');
      q.addEventListener('input', () => {
        const v = q.value.trim().toLowerCase();
        host.querySelectorAll('.tix-rep-tbl tbody tr').forEach((tr) => { if (tr.classList.contains('tix-rep-total') || tr.classList.contains('tix-rep-grand') || tr.classList.contains('tix-rep-gap')) return; tr.hidden = !!v && !tr.textContent.toLowerCase().includes(v); });
      });
      const acts = document.getElementById('drawer-actions');
      if (acts) acts.querySelectorAll('[data-rep-dl]').forEach((b) => b.addEventListener('click', () => {
        const base = `${REPORTS[which][0].replace(/[^A-Za-z0-9+]+/g, '-')}_${from}_to_${to}`;
        if (b.dataset.repDl === 'csv') { const c = reportCsv(rep); U.downloadCsv(`${base}.csv`, c.head, c.rows); } else FF.xlsx.download(`${base}.xlsx`, sheets);
      }));
    }

    // 📥 Report dropdown
    const repBtn = U.$('#ti-report-btn', root), repMenu = U.$('#ti-report-menu', root);
    if (admin && repBtn && repMenu) {
      const repClose = () => { repMenu.hidden = true; repBtn.setAttribute('aria-expanded', 'false'); };
      const repPlace = () => { const b = repBtn.getBoundingClientRect(); const w = Math.min(330, window.innerWidth - 16); repMenu.style.width = `${w}px`; repMenu.style.top = `${Math.round(b.bottom + 6)}px`; repMenu.style.left = `${Math.max(8, Math.round(Math.min(b.right - w, window.innerWidth - w - 8)))}px`; };
      repBtn.addEventListener('click', (e) => { e.stopPropagation(); if (repMenu.parentNode !== document.body) { document.querySelectorAll('body > .tix-report-menu').forEach((x) => { if (x !== repMenu) x.remove(); }); document.body.appendChild(repMenu); } repMenu.hidden = !repMenu.hidden; if (!repMenu.hidden) repPlace(); repBtn.setAttribute('aria-expanded', String(!repMenu.hidden)); });
      window.addEventListener('scroll', () => { if (!repMenu.hidden) repClose(); if (!root.isConnected) repMenu.remove(); }, { passive: true });
      window.addEventListener('resize', () => { if (!repMenu.hidden) repPlace(); });
      document.addEventListener('click', (e) => { if (!root.isConnected) { repMenu.remove(); return; } if (!e.target.closest || (!e.target.closest('#ti-report') && !repMenu.contains(e.target))) repClose(); });
      repMenu.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-rep]'); if (!b) return;
        const which = b.dataset.rep, fmt = b.dataset.fmt;
        repClose();
        await U.withButtonBusy(repBtn, async () => {
          try {
            const { m, rep } = await makeReport(which);
            if (!rep.list.length) { U.toast('No agents found for this period.', 'err'); return; }
            const base = `${REPORTS[which][0].replace(/[^A-Za-z0-9+]+/g, '-')}_${from}_to_${to}`;
            if (fmt === 'csv') { const c = reportCsv(rep); U.downloadCsv(`${base}.csv`, c.head, c.rows); }
            else FF.xlsx.download(`${base}.xlsx`, reportSheets(rep, m, which));
            U.toast(`📥 ${REPORTS[which][0]} · ${U.fmt(rep.list.length)} agents · ${U.fmt(rep.grandTotal)} tags`, 'ok');
          } catch (err) { U.toast(err.message || 'Report failed', 'err'); }
        }, 'Preparing…');
      });
    }

    if (personInput && personOptionsBox) {
      personInput.addEventListener('input', paintPersonSuggestions);
      personInput.addEventListener('focus', () => { ensureFullDirectory(); paintPersonSuggestions(); });
      personInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { personOptionsBox.hidden = true; personInput.setAttribute('aria-expanded', 'false'); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          const opts = [...personOptionsBox.querySelectorAll('[data-person-name]')]; if (!opts.length) return;
          e.preventDefault();
          let i = opts.findIndex((o) => o.getAttribute('aria-selected') === 'true');
          i = e.key === 'ArrowDown' ? Math.min(opts.length - 1, i + 1) : Math.max(0, i - 1);
          opts.forEach((o, j) => o.setAttribute('aria-selected', j === i ? 'true' : 'false'));
          opts[i].scrollIntoView({ block: 'nearest' });
          return;
        }
        if (e.key === 'Enter') {
          const option = personOptionsBox.querySelector('[data-person-name][aria-selected="true"]') || personOptionsBox.querySelector('[data-person-name]');
          if (option) { e.preventDefault(); selectedPerson = { channel: option.dataset.personChannel, type: option.dataset.personType, name: option.dataset.personName }; personInput.value = selectedPerson.name; personOptionsBox.hidden = true; personInput.setAttribute('aria-expanded', 'false'); draw(); }
        }
      });
      personOptionsBox.addEventListener('click', (e) => {
        const option = e.target.closest('[data-person-name]'); if (!option) return;
        selectedPerson = { channel: option.dataset.personChannel, type: option.dataset.personType, name: option.dataset.personName };
        personInput.value = selectedPerson.name;
        personOptionsBox.hidden = true; personInput.setAttribute('aria-expanded', 'false');
        draw();
      });
      if (personClear) personClear.addEventListener('click', () => { selectedPerson = null; personInput.value = ''; personClear.hidden = true; personOptionsBox.hidden = true; draw(); personInput.focus(); });
      document.addEventListener('click', (e) => {
        if (!root.isConnected) return;
        if (!e.target.closest || !e.target.closest('#ti-person-search-wrap')) { personOptionsBox.hidden = true; personInput.setAttribute('aria-expanded', 'false'); }
      });
    }
    fromInput.addEventListener('change', applyCustom);
    toInput.addEventListener('change', applyCustom);
    U.$('#ti-apply', root).addEventListener('click', applyCustom);

    draw();
  }

  FF.pages.tagIssued = { title: 'GV & FF Tag Issued', render };
  FF.pages.tagIssued._test = { personDirectory, specFor, buildAgentReport, reportInputs, reportSheets, reportCsv, tlPivot, presetRange, prevRange, detectPreset, scan, buildModel, dayCount, shiftKey, reconHtml, healthStrip, personSearchOptions, personSearchSummary, personCardModel };
})(window.FF);
