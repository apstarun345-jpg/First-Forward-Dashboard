/* ============================================================================
   WOWZONE (v3.11) — naye visual + smart features. Sab kuch preloaded data se.

     📅 Activity Calendar  — GitHub-style heatmap (FF / GV / combined), streak + weekday stats
     🕸️ Team Network       — TL centre me, agents orbit karte hue (animated SVG constellation)
     📈 Sparklines         — kisi bhi series ka mini trend (KPI cards + pages)
     🚨 Anomaly Radar      — spike · crash · naya star · wrong-VRN burst · stale data · dup tags
     🧾 Agent Report Card  — school report-card style monthly card (grades + auto remarks + sign)
     🎖️ Level-Up Ceremony  — promotion par fullscreen golden ceremony + trumpet + confetti
     📅 Aaj Ka Din         — "pichhle saal/mahine isi din" memories
     🎨 Theme Packs        — Neon · Glass · Diwali · Gold · Mono (ek click)
     🟢 Live Tab Heartbeat — tab title me live pulse, doosre tab me kaam karte hue bhi
     💬 Chat Charts        — assistant se "last 7 days ka graph" → chat me hi chart
   ============================================================================ */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, S = FF.store, G = FF.gv, M = FF.model, C = FF.charts;
  const esc = U.esc, clean = U.clean;
  const sum = (list, fn) => (list || []).reduce((a, r) => a + (Number(fn ? fn(r) : r) || 0), 0);
  const normName = (v) => clean(v).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }
  };
  /** Feature flag — Settings → Features se on/off (default ON). */
  const featOn = (key) => !(FF.config && FF.config.feat && FF.config.feat(key) === false);
  const disabled = (key, label) => `<div class="empty-state">\u{1F512} ${esc(label)} abhi Settings → 🎛 Features me band hai.<br><small class="dim">Admin wahan se ON kar sakta hai (key: <code>${esc(key)}</code>).</small></div>`;
  const head = (icon, title, sub, actions) => `<div class="page-head"><div><h1>${icon} ${esc(title)}</h1><p class="sub">${sub || ''}</p></div><div class="head-actions">${actions || ''}<button class="btn primary" data-action="refresh">↻ Refresh</button></div></div>`;
  const card = (title, body, right) => `<section class="card"><div class="card-head"><h3>${title}</h3>${right ? `<div class="card-right">${right}</div>` : ''}</div><div class="card-body">${body}</div></section>`;
  const metric = (label, value, foot, tone, icon) => `<div class="ins-metric" ${tone ? `data-tone="${tone}"` : ''}>${icon ? `<span class="ins-metric-icon">${icon}</span>` : ''}<small>${esc(label)}</small><b>${value}</b><span>${foot || '&nbsp;'}</span><span class="ins-metric-tap">🔎 Full data ↗</span></div>`;
  const metrics = (list) => `<div class="ins-metrics">${(list || []).map((m) => metric(m.label, m.value, m.foot, m.tone, m.icon)).join('')}</div>`;

  // ==========================================================================
  // 📈 SPARKLINES
  // ==========================================================================
  /** Inline line-sparkline. values: number[]; opts: { w, h, color, fill, up } */
  function sparkline(values, opts) {
    const o = opts || {};
    const vals = (values || []).map((v) => Number(v) || 0);
    if (vals.length < 2) return '<span class="dim small">—</span>';
    const w = o.w || 170, h = o.h || 34, pad = 3;
    const min = Math.min(...vals), max = Math.max(...vals), span = (max - min) || 1;
    const x = (i) => pad + (i / (vals.length - 1)) * (w - pad * 2);
    const y = (v) => h - pad - ((v - min) / span) * (h - pad * 2);
    let d = '';
    vals.forEach((v, i) => { d += `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `; });
    const up = vals[vals.length - 1] >= vals[0];
    const tone = o.up === undefined ? (up ? 'up' : 'down') : (o.up ? 'up' : 'down');
    const stroke = o.color || (tone === 'up' ? 'var(--green)' : 'var(--red)');
    const area = `${d}L${x(vals.length - 1).toFixed(1)},${h - pad} L${x(0).toFixed(1)},${h - pad} Z`;
    return `<span class="spark kpi-sparkline ${tone}" title="${esc(vals.map((v) => U.fmt(v)).join(' → '))}">
      <svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none">
        <path class="area" d="${area}" style="fill:${stroke}"></path>
        <path class="line" d="${d.trim()}" style="stroke:${stroke}"></path>
      </svg></span>`;
  }
  const sparkRow = (label, sub, values, valueLabel) => `<div class="spark-row">
    <div class="s-label">${esc(label)}<small>${esc(sub || '')}</small></div>
    <div>${sparkline(values)}</div>
    <div class="s-value">${valueLabel || U.fmt(values[values.length - 1] || 0)}</div></div>`;

  // ==========================================================================
  // 📅 ACTIVITY HEATMAP
  // ==========================================================================
  const heatLevel = (n, max) => (!n ? 0 : n >= max * 0.75 ? 4 : n >= max * 0.45 ? 3 : n >= max * 0.2 ? 2 : 1);

  /** Build a GitHub-style calendar grid. dayFn(date) → count. */
  function heatmapGrid(dayFn, year) {
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);
    // Monday-first columns, like GitHub
    const firstMonday = U.weekStart(start);
    const cols = [];
    let cursor = new Date(firstMonday);
    const counts = new Map();
    let max = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const n = Number(dayFn(new Date(d))) || 0;
      counts.set(U.dateKey(d), n);
      if (n > max) max = n;
    }
    const todayKey = U.dateKey(new Date());
    while (cursor <= end) {
      const col = [];
      for (let i = 0; i < 7; i++) {
        const dk = U.dateKey(cursor);
        const inRange = cursor >= start && cursor <= end;
        const n = inRange ? (counts.get(dk) || 0) : null;
        const lvl = n === null ? -1 : heatLevel(n, Math.max(1, max));
        col.push(`<div class="heat-cell ${n === null ? 'out' : `l${lvl}`} ${dk === todayKey ? 'today' : ''}" ${n === null ? '' : `data-heat-date="${dk}" data-heat-n="${n}" title="${esc(U.labelDate(cursor, true))}: ${U.fmt(n)} tags"`}></div>`);
        cursor.setDate(cursor.getDate() + 1);
      }
      cols.push(`<div class="heat-col">${col.join('')}</div>`);
    }
    const monthLabels = [];
    let seen = -1;
    for (let w = 0; w < cols.length; w++) {
      const d = new Date(firstMonday); d.setDate(d.getDate() + w * 7);
      if (d.getMonth() !== seen && d.getDate() <= 7) { seen = d.getMonth(); monthLabels.push(U.DAYS[1] && new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('en-IN', { month: 'short' })); }
      else monthLabels.push('');
    }
    return { html: `<div class="heat-wrap"><div class="heat-months">${monthLabels.map((m) => `<span>${esc(m || '')}</span>`).join('')}</div><div class="heat-cols">${cols.join('')}</div></div>
      <div class="heat-legend">Kam <i class="heat-cell l0"></i><i class="heat-cell l1"></i><i class="heat-cell l2"></i><i class="heat-cell l3"></i><i class="heat-cell l4"></i> Zyada <span class="dim" style="margin-left:8px">max ${U.fmt(max)} tags/din</span></div>`, max, counts };
  }

  async function renderActivity(root, params) {
    if (!featOn('heatmap')) { root.innerHTML = head('🔒', 'Activity Calendar', 'Feature flag off') + disabled('heatmap', 'Activity Calendar'); return; }
    const [dailyR, masterR] = await Promise.allSettled([S.need('daily'), G.need('master').catch(() => [])]);
    if (!root.isConnected) return;
    const daily = dailyR.status === 'fulfilled' ? (dailyR.value || []) : [];
    const master = masterR.status === 'fulfilled' ? (masterR.value || []) : [];
    const ffDaily = daily.filter((r) => r.channel !== 'GV Partner');
    const years = U.uniq([...ffDaily.map((r) => (r.key || '').slice(0, 4)), ...master.map((r) => r.ym ? r.ym.slice(0, 4) : '')].filter(Boolean)).sort();
    const year = /^\d{4}$/.test(params.year || '') ? Number(params.year) : Number(years[years.length - 1] || new Date().getFullYear());
    const mode = ['ff', 'gv', 'both'].includes(params.mode) ? params.mode : 'both';
    const ffMap = new Map(), gvMap = new Map();
    ffDaily.forEach((r) => { if (r.key) ffMap.set(r.key, (ffMap.get(r.key) || 0) + (Number(r.n) || 0)); });
    master.forEach((r) => { if (r.date) { const k = U.dateKey(r.date); gvMap.set(k, (gvMap.get(k) || 0) + 1); } });
    const dayFn = (d) => {
      const k = U.dateKey(d);
      const f = ffMap.get(k) || 0, g = gvMap.get(k) || 0;
      return mode === 'ff' ? f : mode === 'gv' ? g : f + g;
    };
    const grid = heatmapGrid(dayFn, year);
    const dayVals = [...grid.counts.entries()].filter(([k]) => k.startsWith(String(year))).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const total = sum(dayVals, ([, n]) => n);
    const activeDays = dayVals.filter(([, n]) => n > 0).length;
    const best = dayVals.slice().sort((a, b) => b[1] - a[1])[0] || ['', 0];
    // streak (current, up to today within the year)
    let streak = 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let d = new Date(today); ; d.setDate(d.getDate() - 1)) {
      if (String(d.getFullYear()) !== String(year)) break;
      if (dayFn(d) > 0) streak++; else break;
      if (streak > 400) break;
    }
    const longest = (() => { let run = 0, bestRun = 0; dayVals.forEach(([, n]) => { run = n > 0 ? run + 1 : 0; if (run > bestRun) bestRun = run; }); return bestRun; })();
    const wd = Array.from({ length: 7 }, () => ({ sum: 0, days: 0 }));
    dayVals.forEach(([k, n]) => { const idx = new Date(`${k}T00:00:00`).getDay(); wd[idx].sum += n; wd[idx].days += 1; });
    const monthlyVals = Array.from({ length: 12 }, (_, m) => sum(dayVals.filter(([k]) => Number(k.slice(5, 7)) === m + 1), ([, n]) => n));

    root.innerHTML = head('📅', 'Activity Calendar', `Poore saal ka tag activity map — FF · GV · combined. Har box ek din, gehra rang = zyada tags.`,
      ['ff', 'gv', 'both'].map((m) => `<button class="btn small ${m === mode ? 'primary' : ''}" data-param="mode" data-value="${m}">${m === 'ff' ? '🟦 First Forward' : m === 'gv' ? '🟩 GV Partner' : '🔗 Combined'}</button>`).join('') +
      (years.length > 1 ? `<select class="input" data-param="year" style="width:110px">${years.map((y) => `<option value="${y}" ${Number(y) === year ? 'selected' : ''}>${y}</option>`).join('')}</select>` : '')) + `
      ${metrics([
      { label: `${year} total tags`, value: U.fmt(total), foot: `${U.fmt(activeDays)} active din · avg ${U.fmt(activeDays ? total / activeDays : 0)}/din`, tone: 'g1', icon: '🏷️' },
      { label: 'Best day', value: U.fmt(best[1]), foot: best[0] ? `${U.labelDateKey(best[0], true)} · ${U.weekday(U.fromDateKey(best[0]))}` : '—', tone: 'g4', icon: '🥇' },
      { label: 'Current streak', value: `${U.fmt(streak)} <small>din</small>`, foot: streak ? 'lagatar active din (aaj se peeche)' : 'aaj koi activity nahi', tone: streak ? 'g9' : 'g7', icon: '🔥' },
      { label: 'Longest streak', value: `${U.fmt(longest)} <small>din</small>`, foot: `${year} ka sabse lamba active run`, tone: 'g6', icon: '⚡' },
      { label: 'Quiet days', value: U.fmt(dayVals.length - activeDays), foot: `${U.fmt(dayVals.length)} din ka calendar`, tone: 'g8', icon: '😴' },
      { label: 'Channel split', value: `${U.fmt(sum(ffDaily.filter((r) => (r.key || '').startsWith(String(year))), (r) => r.n))} <small>/ ${U.fmt(master.filter((r) => r.ym && r.ym.startsWith(String(year))).length)}</small>`, foot: 'FF tags / GV tags', tone: 'g11', icon: '🔗' }
    ])}
      ${card(`🗓️ ${year} activity map · ${mode === 'ff' ? 'First Forward' : mode === 'gv' ? 'GV Partner' : 'FF + GV combined'}`, grid.html, `<span class="dim small">box par hover → us din ka total</span>`)}
      <div class="grid g-2">
        ${card('📆 Month-wise activity', C.bars({ labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], height: 210, series: [{ name: `${year} tags`, values: monthlyVals, color: '#6366f1' }], showValues: true }))}
        ${card('📅 Weekday pattern', C.bars({ labels: [1, 2, 3, 4, 5, 6, 0].map((i) => U.DAYS[i]), height: 210, series: [{ name: 'Avg / day', values: [1, 2, 3, 4, 5, 6, 0].map((i) => (wd[i].days ? Math.round(wd[i].sum / wd[i].days) : 0)), color: '#0d9488' }], showValues: true }))}
      </div>
      ${card('📈 Sparkline board <span class="dim">· month-wise trend</span>', [
      sparkRow('Combined tags', `${year} month-wise`, monthlyVals, U.fmt(total)),
      sparkRow('First Forward', 'EIR issuance', Array.from({ length: 12 }, (_, m) => sum(ffDaily.filter((r) => (r.key || '').startsWith(`${year}-${String(m + 1).padStart(2, '0')}`)), (r) => r.n))),
      sparkRow('GV Partner', 'GV Master issuance', Array.from({ length: 12 }, (_, m) => master.filter((r) => r.ym === `${year}-${String(m + 1).padStart(2, '0')}`).length)),
      sparkRow('Active days', 'jitne din activity hui', Array.from({ length: 12 }, (_, m) => dayVals.filter(([k, n]) => Number(k.slice(5, 7)) === m + 1 && n > 0).length))
    ].join(''))}
      <p class="foot-note">Source: EIR daily issuance (FF) + GV Master (GV) · year ${year} · box click karne par us din ka Tag Issued page khulta hai.</p>`;
    C.mount(root);
    root.addEventListener('click', (e) => {
      const cell = e.target.closest('[data-heat-date]');
      if (cell) { FF.app.navigate('tagIssued', { date: cell.dataset.heatDate }); }
    });
    return { total, activeDays };
  }

  // ==========================================================================
  // 🕸️ TEAM NETWORK GRAPH
  // ==========================================================================
  /** Animated constellation: TL centre + agent orbit. Rows: {name, tlName, n}. */
  function networkGraph(items, opts) {
    const o = opts || {};
    const W = 1000, H = o.h || 520;
    const tls = new Map();
    items.forEach((r) => {
      if (!r || !r.name) return;
      const tl = clean(r.tlName) || 'Direct';
      if (!tls.has(tl)) tls.set(tl, []);
      tls.get(tl).push(r);
    });
    const tlList = [...tls.entries()].sort((a, b) => sum(b[1], (r) => r.n) - sum(a[1], (r) => r.n));
    const tlPos = new Map();
    const R = Math.min(W, H) * 0.34;
    tlList.forEach(([tl], i) => {
      const a = (i / Math.max(1, tlList.length)) * Math.PI * 2 - Math.PI / 2;
      tlPos.set(tl, { x: W / 2 + R * Math.cos(a), y: H / 2 + R * Math.sin(a), a });
    });
    const parts = [`<circle class="net-orbit" cx="${W / 2}" cy="${H / 2}" r="${R}" />`];
    const maxN = Math.max(1, ...items.map((r) => Number(r.n) || 0));
    tlList.forEach(([tl, agents]) => {
      const p = tlPos.get(tl);
      const tlTags = sum(agents, (r) => r.n);
      agents.slice(0, o.maxAgents || 16).forEach((ag, j) => {
        const spread = Math.min(58, 300 / Math.max(1, agents.length));
        const a = p.a + (j - (Math.min(agents.length, o.maxAgents || 16) - 1) / 2) * (spread * Math.PI / 180);
        const dist = 74 + (1 - Math.min(1, (Number(ag.n) || 0) / maxN)) * 42;
        const ax = p.x + dist * Math.cos(a), ay = p.y + dist * Math.sin(a);
        const r = 5 + Math.min(9, ((Number(ag.n) || 0) / maxN) * 12);
        const color = ag.channel === 'GV Partner' ? '#0d9488' : '#6366f1';
        parts.push(`<path class="net-link" d="M${p.x.toFixed(1)},${p.y.toFixed(1)} Q${((p.x + ax) / 2 + 12).toFixed(1)},${((p.y + ay) / 2 - 12).toFixed(1)} ${ax.toFixed(1)},${ay.toFixed(1)}" style="stroke:${color}66;stroke-dasharray:220;stroke-dashoffset:220;animation:netDraw 1.1s ease-out ${(j * 40)}ms forwards"></path>`);
        parts.push(`<g class="net-node" data-net-agent="${esc(ag.name)}" data-tip="${esc(`<b>${ag.name}</b><br>TL ${tl} · ${U.fmt(ag.n)} tags${ag.channel ? ` · ${ag.channel}` : ''}`)}"><circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="${r.toFixed(1)}" fill="${color}" stroke="#fff" stroke-width="1.6"></circle></g>`);
      });
      parts.push(`<g class="net-node net-spin" data-net-tl="${esc(tl)}" data-tip="${esc(`<b>${tl}</b><br>${agents.length} agents · ${U.fmt(tlTags)} tags`)}"><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="17" fill="url(#netTlGrad)" stroke="#fff" stroke-width="2.4"></circle><text x="${p.x.toFixed(1)}" y="${(p.y + 4).toFixed(1)}" text-anchor="middle" fill="#fff" font-size="11" font-weight="800">${esc(String(tl).slice(0, 3))}</text></g>`);
      parts.push(`<text x="${p.x.toFixed(1)}" y="${(p.y - 26).toFixed(1)}" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor" opacity="0.85">${esc(String(tl).slice(0, 18))}</text>`);
    });
    return `<div class="net-wrap" id="net-wrap">
      <div class="net-tip" id="net-tip"></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Team network graph">
        <defs>
          <radialGradient id="netTlGrad"><stop offset="0%" stop-color="#a855f7"/><stop offset="100%" stop-color="#4f46e5"/></radialGradient>
          <radialGradient id="netHub"><stop offset="0%" stop-color="#fff" stop-opacity=".9"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/></radialGradient>
        </defs>
        <circle cx="${W / 2}" cy="${H / 2}" r="70" fill="url(#netHub)" opacity="0.35"></circle>
        ${parts.join('')}
      </svg>
      <div class="net-legend"><span><i style="background:#4f46e5"></i> TL</span><span><i style="background:#6366f1"></i> First Forward agent</span><span><i style="background:#0d9488"></i> GV Partner agent</span><span class="dim">node par hover karo → details · click → profile</span></div>
    </div>`;
  }
  function bindNetwork(root) {
    const wrap = root.querySelector('#net-wrap');
    if (!wrap) return;
    const tip = wrap.querySelector('#net-tip');
    wrap.addEventListener('mouseover', (e) => {
      const n = e.target.closest('[data-tip]');
      if (!n || !tip) return;
      tip.innerHTML = n.dataset.tip;
      tip.classList.add('on');
      const r = n.getBoundingClientRect(), w = wrap.getBoundingClientRect();
      tip.style.left = `${Math.max(6, Math.min(r.left - w.left, w.width - 190))}px`;
      tip.style.top = `${Math.max(6, r.top - w.top - 46)}px`;
    });
    wrap.addEventListener('mouseout', () => tip && tip.classList.remove('on'));
    wrap.addEventListener('click', (e) => {
      const ag = e.target.closest('[data-net-agent]');
      if (ag && FF.cockpit && FF.cockpit.agent360) { FF.cockpit.agent360({ name: ag.dataset.netAgent }).catch(() => {}); return; }
      const tl = e.target.closest('[data-net-tl]');
      if (tl) FF.app.navigate('performance', { tl: tl.dataset.netTl });
    });
  }

  async function renderNetwork(root, params) {
    if (!featOn('networkGraph')) { root.innerHTML = head('🔒', 'Team Network', 'Feature flag off') + disabled('networkGraph', 'Team Network'); return; }
    const [agentsR, masterR] = await Promise.allSettled([S.need('agents'), G.need('master').catch(() => [])]);
    if (!root.isConnected) return;
    const agents = agentsR.status === 'fulfilled' ? (agentsR.value || []) : [];
    const master = masterR.status === 'fulfilled' ? (masterR.value || []) : [];
    const months = U.uniq([...agents.map((a) => a.ym), ...master.map((a) => a.ym)].filter(Boolean)).sort();
    const ym = months.includes(params.month) ? params.month : (months[months.length - 1] || U.ymKey(new Date()));
    const channel = ['all', 'ff', 'gv'].includes(params.channel) ? params.channel : 'all';
    const rows = [];
    if (channel !== 'gv') agents.filter((a) => a.ym === ym && a.channel !== 'GV Partner').forEach((a) => rows.push({ name: a.name, tlName: a.tlName, n: a.n, channel: 'First Forward' }));
    if (channel !== 'ff') {
      const gvAgg = new Map();
      master.filter((r) => r.ym === ym).forEach((r) => { const k = `${r.agentName}|${r.tlName}`; const cur = gvAgg.get(k) || { name: r.agentName, tlName: r.tlName, n: 0, channel: 'GV Partner' }; cur.n += 1; gvAgg.set(k, cur); });
      gvAgg.forEach((v) => rows.push(v));
    }
    const tlCount = U.uniq(rows.map((r) => clean(r.tlName) || 'Direct')).length;
    root.innerHTML = head('🕸️', 'Team Network', `TL centre me, agents orbit karte hue — team structure ek nazar me. ${esc(U.labelYM(ym, true))} · ${rows.length} agents · ${tlCount} TLs`,
      ['all', 'ff', 'gv'].map((c) => `<button class="btn small ${c === channel ? 'primary' : ''}" data-param="channel" data-value="${c}">${c === 'ff' ? '🟦 FF' : c === 'gv' ? '🟩 GV' : '🔗 Both'}</button>`).join('') +
      (months.length > 1 ? `<select class="input" data-param="month" style="width:150px">${months.slice().reverse().map((m) => `<option value="${m}" ${m === ym ? 'selected' : ''}>${U.labelYM(m, true)}</option>`).join('')}</select>` : '')) + `
      ${metrics([
      { label: 'Agents in network', value: U.fmt(rows.length), foot: `${U.fmt(tlCount)} TL groups`, tone: 'g1', icon: '🧑‍💼' },
      { label: 'Total tags', value: U.fmt(sum(rows, (r) => r.n)), foot: esc(U.labelYM(ym, true)), tone: 'g2', icon: '🏷️' },
      { label: 'Biggest TL', value: esc(([...new Map(rows.map((r) => [clean(r.tlName) || 'Direct', 0])).keys()].sort((a, b) => sum(rows.filter((r) => (clean(r.tlName) || 'Direct') === b), (r) => r.n) - sum(rows.filter((r) => (clean(r.tlName) || 'Direct') === a), (r) => r.n))[0]) || '—'), foot: 'team tags ke hisaab se', tone: 'g6', icon: '👑' },
      { label: 'Direct (no TL)', value: U.fmt(rows.filter((r) => !clean(r.tlName) || /direct/i.test(r.tlName)).length), foot: 'apne dum par kaam karne wale agents', tone: 'g4', icon: '🚫' }
    ])}
      ${card('🌌 Team constellation', networkGraph(rows, { maxAgents: 16 }), `<span class="dim small">TL par click → performance · agent par click → Agent 360</span>`)}
      ${card('🏅 TL-wise strength <span class="dim">(node size = tags)</span>', C.hbars({ items: [...U.groupSum(rows, (r) => clean(r.tlName) || 'Direct', (r) => r.n).entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([label, value]) => ({ label, value, sub: `${rows.filter((r) => (clean(r.tlName) || 'Direct') === label).length} agents`, attr: `data-link="#/performance?tl=${encodeURIComponent(label)}"` })), valueLabel: 'Tags' }))}
      <p class="foot-note">Data: EIR agent-month rollup (FF) + GV Master issuance (GV) · ${esc(U.labelYM(ym, true))} · orbit distance = activity share (zyada tags = centre ke paas).</p>`;
    C.mount(root);
    bindNetwork(root);
  }

  // ==========================================================================
  // 🚨 ANOMALY RADAR
  // ==========================================================================
  async function anomalyFindings() {
    const out = [];
    const [agentsR, masterR, classR, dailyR] = await Promise.allSettled([S.need('agents'), G.need('master').catch(() => []), S.need('agentClass').catch(() => []), S.need('daily')]);
    const agents = agentsR.status === 'fulfilled' ? (agentsR.value || []) : [];
    const master = masterR.status === 'fulfilled' ? (masterR.value || []) : [];
    const agentClass = classR.status === 'fulfilled' ? (classR.value || []) : [];
    const daily = dailyR.status === 'fulfilled' ? (dailyR.value || []) : [];
    const months = U.uniq([...agents.map((a) => a.ym), ...master.map((a) => a.ym)].filter(Boolean)).sort();
    const cur = months[months.length - 1] || U.ymKey(new Date());
    const prev = U.prevMonthKey(cur);

    // 1) Spike / crash / new star (agent month-over-month, FF + GV combined)
    const byKey = new Map();
    const add = (name, tl, ym, n, channel) => {
      if (!name) return;
      const k = `${normName(name)}|${clean(tl)}`;
      const o = byKey.get(k) || { name, tl, months: new Map(), byChannel: new Map() };
      o.months.set(ym, (o.months.get(ym) || 0) + n);
      o.byChannel.set(channel, (o.byChannel.get(channel) || 0) + n);
      byKey.set(k, o);
    };
    agents.forEach((a) => add(a.name, a.tlName, a.ym, Number(a.n) || 0, a.channel || 'First Forward'));
    master.forEach((r) => add(r.agentName, r.tlName, r.ym, 1, 'GV Partner'));
    const spikes = [], crashes = [], stars = [], records = [];
    byKey.forEach((o) => {
      const now = o.months.get(cur) || 0, before = o.months.get(prev) || 0;
      const history = [...o.months.entries()].filter(([m]) => m !== cur).map(([, n]) => n);
      const best = history.length ? Math.max(...history) : 0;
      if (before >= 10 && now >= before * 3) spikes.push({ name: o.name, tl: o.tl, now, before, pct: Math.round(((now - before) / before) * 100) });
      if (before >= 25 && now <= Math.max(2, before * 0.5)) crashes.push({ name: o.name, tl: o.tl, now, before, drop: Math.round(((before - now) / before) * 100) });
      if (!history.length && now >= 15) stars.push({ name: o.name, tl: o.tl, now });
      if (now > best && best >= 10) records.push({ name: o.name, tl: o.tl, now, best });
    });
    const fmtRows = (list, fn) => list.sort((a, b) => fn(b) - fn(a)).slice(0, 40).map((r) => `${r.name} (${r.tl || 'Direct'}) · ${fn(r)}`);
    if (spikes.length) out.push({ id: 'spike', severity: 'medium', icon: '🚀', title: 'Sudden spike — issuance 3× se zyada', count: spikes.length, detail: `Pichhle mahine ke muqable is mahine 3 guna+ tags. Naye order / naya stock / bulk issuance ho sakti hai — verify karo.`, samples: fmtRows(spikes, (r) => r.pct), route: '#/performance' });
    if (crashes.length) out.push({ id: 'crash', severity: 'high', icon: '📉', title: 'Activity crash — 50%+ drop', count: crashes.length, detail: 'Ye agents pichhle mahine active the, is mahine aadhe se bhi kam. Stock-out, chhutti ya churn ho sakta hai.', samples: fmtRows(crashes, (r) => r.drop).map((s, i) => `${s} · −${crashes.slice().sort((a, b) => b.drop - a.drop)[i].drop}%`), route: '#/dispatchPlan' });
    if (stars.length) out.push({ id: 'star', severity: 'low', icon: '🌟', title: 'Naya dhamaka — pehli baar active', count: stars.length, detail: 'In agents ka koi past record nahi tha, is mahine seedha 15+ tags — welcome aur training follow-up.', samples: fmtRows(stars, (r) => r.now), route: '#/arena' });
    if (records.length) out.push({ id: 'record', severity: 'low', icon: '🏆', title: 'Personal best todte hue', count: records.length, detail: 'Apne best month se aage nikal chuke hain — inko celebrate karo (Arena / Wall of Fame).', samples: fmtRows(records, (r) => r.now - r.best), route: '#/fame' });

    // 2) Wrong VRN burst (FF agent-class: vrnType WRONG)
    const wrongBy = new Map();
    agentClass.filter((r) => r.ym === cur && /wrong/i.test(r.vrnType || '')).forEach((r) => wrongBy.set(normName(r.name), (wrongBy.get(normName(r.name)) || 0) + r.n));
    const wrongTop = [...wrongBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).filter(([, n]) => n >= 3);
    if (wrongTop.length) out.push({ id: 'wrongvrn', severity: wrongTop.length >= 5 ? 'high' : 'medium', icon: '🧩', title: 'Wrong VRN burst', count: wrongTop.length, detail: 'In agents ke wrong-VRN tags count-worthy hain — data entry ya fitment issue ho sakta hai.', samples: wrongTop.map(([n, v]) => `${n} · ${v} wrong VRN`), route: '#/fastagChampions?metric=wrongVrn' });

    // 3) Chassis share (fitment heavy cases)
    const chasBy = new Map();
    agentClass.filter((r) => r.ym === cur && /chassis/i.test(r.type || '')).forEach((r) => chasBy.set(normName(r.name), (chasBy.get(normName(r.name)) || 0) + r.n));
    const chasTop = [...chasBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).filter(([, n]) => n >= 10);
    if (chasTop.length) out.push({ id: 'chassis', severity: 'low', icon: '🔧', title: 'Chassis issuance high', count: chasTop.length, detail: 'Chassis tags (fitment) 10+ — vehicle onboarding ke naye cases, ops ko inform karo.', samples: chasTop.map(([n, v]) => `${n} · ${v} chassis`), route: '#/tagIssued' });

    // 4) GV side: zero stock but high priority (dispatch risk) + commission zero
    if (master.length) {
      const rep = G.get('report') || [];
      const risk = rep.filter((r) => /high/i.test(r.priority || '') && Number(r.stockVc4) === 0);
      if (risk.length) out.push({ id: 'gv-risk', severity: 'high', icon: '🚨', title: 'GV high-priority agents with ZERO VC4 stock', count: risk.length, detail: 'Priority High hai par VC4 stock 0 — dispatch turant chahiye warna issuance rukega.', samples: risk.slice(0, 40).map((r) => `${r.agentName} (${r.tlName}) · MTD ${U.fmt(r.curTotal)}`), route: '#/gvStockReport?view=dispatch' });
    }

    // 5) Stale data — latest record kitne din purana
    const latestFf = daily.reduce((acc, r) => (r.key && (!acc || r.key > acc) ? r.key : acc), '');
    const latestGv = master.reduce((acc, r) => { const k = r.date ? U.dateKey(r.date) : ''; return k && (!acc || k > acc) ? k : acc; }, '');
    const today = U.dateKey(new Date());
    const daysOld = (k) => (k ? Math.round((new Date(`${today}T00:00:00`) - new Date(`${k}T00:00:00`)) / 864e5) : null);
    const oldFf = daysOld(latestFf), oldGv = daysOld(latestGv);
    if ((oldFf !== null && oldFf >= 2) || (oldGv !== null && oldGv >= 2)) {
      out.push({ id: 'stale', severity: (oldFf >= 3 || oldGv >= 3) ? 'high' : 'medium', icon: '🕒', title: 'Data stale — sheet sync check karo', count: 2, detail: 'Latest record 2+ din purana hai. Sheet me entry ruk gayi ho sakti hai.', samples: [`FF latest: ${latestFf || '—'} (${oldFf === null ? '—' : `${oldFf} din`})`, `GV latest: ${latestGv || '—'} (${oldGv === null ? '—' : `${oldGv} din`})`], route: '#/dataQuality' });
    }

    // 6) Weekly pattern break — is hafte ka pace pichhle 4 hafte ke average se 35%+ neeche
    const cutoff = new Date(); cutoff.setHours(0, 0, 0, 0);
    const weekStart = U.weekStart(cutoff);
    const thisWeek = sum(daily.filter((r) => r.key && U.fromDateKey(r.key) >= weekStart && r.channel !== 'GV Partner'), (r) => r.n);
    const last4 = [1, 2, 3, 4].map((w) => {
      const st = new Date(weekStart); st.setDate(st.getDate() - 7 * w);
      const en = new Date(st); en.setDate(en.getDate() + 6);
      return sum(daily.filter((r) => { if (!r.key || r.channel === 'GV Partner') return false; const d = U.fromDateKey(r.key); return d >= st && d <= en; }), (r) => r.n);
    });
    const avg4 = last4.length ? sum(last4, (v) => v) / 4 : 0;
    if (avg4 >= 50 && thisWeek < avg4 * 0.65) {
      out.push({ id: 'pace', severity: 'medium', icon: '🐌', title: 'Is hafte ka pace slow', count: 1, detail: `Is hafte ${U.fmt(thisWeek)} tags — pichhle 4 hafte ka average ${U.fmt(avg4)} tha (${Math.round(((thisWeek - avg4) / avg4) * 100)}%).`, samples: [`Week start ${U.labelDate(weekStart, true)}`, `Last 4 weeks: ${last4.map((v) => U.fmt(v)).join(' · ')}`], route: '#/trend' });
    }
    return out.sort((a, b) => ({ high: 3, medium: 2, low: 1 }[b.severity] || 0) - ({ high: 3, medium: 2, low: 1 }[a.severity] || 0));
  }

  async function renderRadar(root) {
    if (!featOn('anomalyRadar')) { root.innerHTML = head('🔒', 'Anomaly Radar', 'Feature flag off') + disabled('anomalyRadar', 'Anomaly Radar'); return; }
    const findings = await anomalyFindings();
    if (!root.isConnected) return;
    const high = findings.filter((f) => f.severity === 'high').length;
    root.innerHTML = head('🚨', 'Anomaly Radar', 'Aaj kuch unusual hua? Spike, crash, naya dhamaka, wrong-VRN burst, stale sheet — sab auto-detect.',
      `<button class="btn" id="radar-csv">⬇ Alerts CSV</button>`) + `
      ${metrics([
      { label: 'Active signals', value: U.fmt(findings.length), foot: `${U.fmt(high)} high severity`, tone: findings.length ? (high ? 'g7' : 'g4') : 'g9', icon: '📡' },
      { label: 'High priority', value: U.fmt(high), foot: high ? 'turant dekho' : 'sab theek', tone: high ? 'g7' : 'g9', icon: '🚨' },
      { label: 'Medium', value: U.fmt(findings.filter((f) => f.severity === 'medium').length), foot: 'is hafte review karo', tone: 'g4', icon: '⚠️' },
      { label: 'Low / FYI', value: U.fmt(findings.filter((f) => f.severity === 'low').length), foot: 'celebrate ya note karo', tone: 'g8', icon: 'ℹ️' }
    ])}
      ${findings.length ? `<div class="radar-grid">${findings.map((f) => `<article class="radar-card ${esc(f.severity)}">
        <div class="radar-head"><span class="radar-count">${f.icon}</span><b>${esc(f.title)}</b><span class="sev-pill ${esc(f.severity)}">${esc(f.severity)}</span></div>
        <p>${esc(f.detail)}</p>
        <div class="radar-samples">${(f.samples || []).slice(0, 6).map((s) => `<code>${esc(s)}</code>`).join('')}</div>
        ${(f.samples || []).length > 6 ? `<p class="dim small">+${U.fmt(f.samples.length - 6)} aur · CSV me poori list</p>` : ''}
        <div class="btn-row" style="margin-top:10px"><a class="btn small" href="${esc(f.route || '#/home')}">🔎 Kholo</a>${f.samples && f.samples.length ? `<button class="btn small" data-radar-samples="${esc(f.id)}">📋 Samples</button>` : ''}</div>
      </article>`).join('')}</div>`
        : `<div class="empty-state">✅ Koi anomaly nahi mili<br><small class="dim">Spike, crash, wrong-VRN burst, stale sheet — sab normal range me hai.</small></div>`}
      <p class="foot-note">Rule engine: month-over-month spike/crash, pehli baar active agent, personal best, wrong-VRN aur chassis burst, GV high-priority zero stock, sheet staleness (2+ din) aur weekly pace break.</p>`;
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-radar-samples]');
      if (btn) {
        const f = findings.find((x) => x.id === btn.dataset.radarSamples);
        if (f) FF.insights.openInsDialog(root, `${f.title} · samples`, ['#', 'Record'], (f.samples || []).map((v, i) => [i + 1, v]), f.detail);
        return;
      }
      const csv = e.target.closest('#radar-csv');
      if (csv) U.downloadCsv(`anomaly-radar-${U.stamp()}.csv`, ['Severity', 'Signal', 'Count', 'Detail', 'Samples'], findings.map((f) => [f.severity, f.title, f.count, f.detail, (f.samples || []).join(' | ')]));
    });
    return findings;
  }

  // ==========================================================================
  // 🧾 AGENT REPORT CARD
  // ==========================================================================
  const gradeOf = (pct) => (pct === null || pct === undefined || !Number.isFinite(pct) ? '—' : pct >= 95 ? 'A+' : pct >= 85 ? 'A' : pct >= 75 ? 'B+' : pct >= 65 ? 'B' : pct >= 50 ? 'C' : pct >= 35 ? 'D' : 'E');
  const gradeTone = (g) => (g === 'A+' || g === 'A' ? 'green' : g === 'B+' || g === 'B' ? 'blue' : g === 'C' ? 'amber' : 'red');

  async function reportCardData(name, ym) {
    const [agentsR, classR, masterR, stockR] = await Promise.allSettled([S.need('agents'), S.need('agentClass'), G.need('master').catch(() => []), S.need('stockAgents').catch(() => [])]);
    const agents = agentsR.status === 'fulfilled' ? (agentsR.value || []) : [];
    const agentClass = classR.status === 'fulfilled' ? (classR.value || []) : [];
    const master = masterR.status === 'fulfilled' ? (masterR.value || []) : [];
    const stock = stockR.status === 'fulfilled' ? (stockR.value || []) : [];
    const key = normName(name);
    const ffRows = agents.filter((a) => normName(a.name) === key);
    const month = ym || U.uniq(ffRows.map((a) => a.ym)).sort().pop() || U.ymKey(new Date());
    const prev = U.prevMonthKey(month);
    const curN = sum(ffRows.filter((a) => a.ym === month), (a) => a.n);
    const prevN = sum(ffRows.filter((a) => a.ym === prev), (a) => a.n);
    const cls = agentClass.filter((r) => normName(r.name) === key && r.ym === month);
    const vc4 = sum(cls.filter((r) => r.group === 'VC4'), (r) => r.n);
    const comm = sum(cls.filter((r) => r.group !== 'VC4' && r.channel !== 'GV Partner'), (r) => r.n);
    const chassis = sum(cls.filter((r) => /chassis/i.test(r.type || '')), (r) => r.n);
    const wrong = sum(cls.filter((r) => /wrong/i.test(r.vrnType || '')), (r) => r.n);
    const repl = sum(cls.filter((r) => /replacement/i.test(r.type || '')), (r) => r.n);
    const days = U.uniq(cls.map(() => '') && cls.length ? cls.map((r) => r.ym) : []); // placeholder (day-level nahi hai)
    const activeMonths = U.uniq(ffRows.filter((a) => (a.n || 0) > 0).map((a) => a.ym)).length;
    const bestMonth = ffRows.slice().sort((a, b) => (b.n || 0) - (a.n || 0))[0] || null;
    const tl = (ffRows[ffRows.length - 1] || {}).tlName || '';
    const gvRows = master.filter((r) => normName(r.agentName) === key && r.ym === month);
    const gvN = gvRows.length, gvComm = sum(gvRows, (r) => r.commission);
    const stockN = sum(stock.filter((r) => normName(r.agentName) === key), (r) => r.n);
    const perDay = curN && curN > 0 ? curN / Math.max(1, new Date(`${month}-01T00:00:00`).getDate()) : 0;
    const vc4Share = curN ? (vc4 / curN) * 100 : 0;
    // subject scores (0-100)
    const target = ((FF.auth.settings && FF.auth.settings.targets) || []).find((t) => t && t.ym === month && normName(t.agent) === key && (t.source || 'ff') === 'ff');
    const targetN = target ? Number(target.target) || 0 : 0;
    const subjects = [
      { subject: 'Issuance volume', value: curN, ref: targetN || (prevN || bestMonth ? (bestMonth ? bestMonth.n : prevN) : 0), refLabel: targetN ? 'target' : 'best month', pct: targetN ? (curN / targetN) * 100 : (bestMonth && bestMonth.n ? (curN / bestMonth.n) * 100 : null) },
      { subject: 'VC4 share', value: `${vc4Share.toFixed(0)}%`, ref: '50% benchmark', refLabel: 'benchmark', pct: curN ? (vc4Share / 50) * 100 : null },
      { subject: 'Commercial mix', value: comm, ref: '—', refLabel: 'volume', pct: curN ? Math.min(100, (comm / Math.max(1, curN)) * 100 * 1.6) : null },
      { subject: 'Growth vs last month', value: U.fmtSigned(U.growth(curN, prevN)), ref: U.fmt(prevN), refLabel: 'last month', pct: prevN ? Math.max(0, Math.min(150, 50 + U.growth(curN, prevN))) : null },
      { subject: 'Consistency (active months)', value: `${activeMonths} months`, ref: '12', refLabel: 'year', pct: Math.min(100, (activeMonths / 12) * 100) },
      { subject: 'Quality (wrong VRN / chassis)', value: `${wrong} / ${chassis}`, ref: `${U.fmt(curN)} total`, refLabel: 'share', pct: curN ? Math.max(0, 100 - ((wrong + chassis * 0.3) / curN) * 260) : null },
      { subject: 'Replacement handling', value: repl, ref: U.fmt(curN), refLabel: 'of total', pct: curN ? Math.max(20, 100 - (repl / curN) * 200) : null },
      { subject: 'Stock in field', value: stockN, ref: perDay ? `${U.fmt(perDay)} / din` : '—', refLabel: 'run-rate', pct: perDay && stockN ? Math.min(150, ((stockN / perDay) / 15) * 100) : null }
    ].map((s) => ({ ...s, grade: gradeOf(s.pct) }));
    const overall = (() => {
      const parts = subjects.map((s) => s.pct).filter((v) => v !== null && Number.isFinite(v));
      return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
    })();
    const remarks = (() => {
      const lines = [];
      if (targetN && curN >= targetN) lines.push(`🎯 Target (${U.fmt(targetN)}) ${Math.round((curN / targetN) * 100)}% complete — shabashi!`);
      else if (targetN) lines.push(`🎯 Target se ${U.fmt(targetN - curN)} tags peeche — month ke bache dino me push karo.`);
      if (prevN && curN > prevN) lines.push(`📈 Pichhle mahine (${U.fmt(prevN)}) se ${U.fmtSigned(U.growth(curN, prevN))} aage.`);
      else if (prevN) lines.push(`📉 Pichhle mahine (${U.fmt(prevN)}) se ${U.fmtSigned(U.growth(curN, prevN))} peeche — reason note karo.`);
      else lines.push('🆕 Pehla active month — base ban gaya, ab consistency par kaam karo.');
      if (vc4Share >= 55) lines.push(`🚗 VC4 mix ${vc4Share.toFixed(0)}% — payable business strong.`);
      else if (vc4Share > 0 && vc4Share < 35) lines.push(`🚚 Commercial-heavy month (VC4 sirf ${vc4Share.toFixed(0)}%) — VC4 focus badhao.`);
      if (wrong >= 3) lines.push(`🧩 ${wrong} wrong-VRN tags — data entry par dhyan do.`);
      if (!stockN) lines.push('📦 Field me stock 0 — dispatch ke liye request do.');
      else if (perDay && stockN / perDay < 5) lines.push(`📦 Stock cover sirf ${(stockN / perDay).toFixed(1)} din — jaldi refill karo.`);
      if (gvN) lines.push(`🟩 GV Partner side: ${U.fmt(gvN)} tags · ₹${U.fmt(gvComm)} commission.`);
      return lines;
    })();
    return { name: (ffRows[0] && ffRows[0].name) || name, tl, month, curN, prevN, vc4, comm, chassis, wrong, repl, stockN, perDay, gvN, gvComm, activeMonths, subjects, overall, overallGrade: gradeOf(overall), remarks, targetN };
  }

  function reportCardHtml(d) {
    return `<article class="report-card" id="report-card">
      <header class="rc-head">
        <div><h2 class="rc-title">📋 Agent Report Card</h2>
          <div class="rc-sub">${esc(FF.config.brand || 'First Forward')} · ${esc(U.labelYM(d.month, true))}</div></div>
        <div class="rc-stamp"><div class="rc-grade">${esc(d.overallGrade)}</div><div>overall grade</div><div>${U.timeLabel(Date.now())} · ${esc(d.name)}</div></div>
      </header>
      <div class="rc-grid">
        <div class="rc-field"><small>Agent</small><b>${esc(d.name)}</b></div>
        <div class="rc-field"><small>Team leader</small><b>${esc(d.tl || 'Direct')}</b></div>
        <div class="rc-field"><small>Month</small><b>${esc(U.labelYM(d.month))}</b></div>
        <div class="rc-field"><small>Tags issued</small><b>${U.fmt(d.curN)}</b></div>
        <div class="rc-field"><small>Last month</small><b>${U.fmt(d.prevN)}</b></div>
        <div class="rc-field"><small>Growth</small><b>${U.deltaHtml(U.growth(d.curN, d.prevN), { decimals: 0 })}</b></div>
        <div class="rc-field"><small>VC4</small><b>${U.fmt(d.vc4)}</b></div>
        <div class="rc-field"><small>Commercial</small><b>${U.fmt(d.comm)}</b></div>
        <div class="rc-field"><small>Field stock</small><b>${U.fmt(d.stockN)}</b></div>
      </div>
      <table class="rc-subjects"><thead><tr><th>Subject</th><th class="num">Score</th><th>Grade</th><th>Benchmark</th></tr></thead>
        <tbody>${d.subjects.map((s) => `<tr><td>${esc(s.subject)}</td><td class="num"><b>${s.value}</b></td><td><span class="badge ${gradeTone(s.grade)}">${esc(s.grade)}</span></td><td class="dim small">${esc(String(s.refLabel || ''))}: ${esc(String(s.ref ?? '—'))}</td></tr>`).join('')}</tbody></table>
      <div class="rc-remarks"><b>Teacher remarks (auto-generated)</b>${d.remarks.map((r) => `<div>${esc(r)}</div>`).join('')}</div>
      <div class="rc-sign"><div>Agent sign</div><div>TL sign — ${esc(d.tl || 'Direct')}</div><div>Management</div></div>
    </article>`;
  }

  async function renderReportCards(root, params) {
    if (!featOn('reportCards')) { root.innerHTML = head('🔒', 'Agent Report Cards', 'Feature flag off') + disabled('reportCards', 'Agent Report Cards'); return; }
    const agents = await S.need('agents').catch(() => []);
    const names = U.uniq((agents || []).map((a) => clean(a.name)).filter(Boolean)).sort();
    const q = clean(params.q || '') || names[0] || '';
    let data = null, error = '';
    if (q) { try { data = await reportCardData(q, params.month || ''); } catch (e) { error = e.message; } }
    if (!root.isConnected) return;
    root.innerHTML = head('🧾', 'Agent Report Cards', 'School report-card style monthly card — subjects, grades, auto remarks aur TL sign block. Print karke agent ko do.',
      `${data ? '<button class="btn" id="rc-print">🖨 Print / PDF</button><button class="btn" id="rc-png">📷 PNG</button><button class="btn" id="rc-csv">⬇ CSV</button>' : ''}`) + `
      <section class="card"><div class="card-body">
        <div class="ctrl-row">
          <label>Agent <span class="finder-input small"><input class="input" id="rc-find" value="${esc(q)}" placeholder="Naam ya ID type karo → select"></span></label>
          ${data ? `<select class="input" data-param="month" style="width:160px">${U.uniq((agents || []).filter((a) => normName(a.name) === normName(data.name)).map((a) => a.ym)).sort().reverse().map((m) => `<option value="${m}" ${m === data.month ? 'selected' : ''}>${U.labelYM(m, true)}</option>`).join('')}</select>` : ''}
          <span class="ctrl-note">${U.fmt(names.length)} agents me se select karo</span>
        </div></div></section>
      ${data ? reportCardHtml(data) : `<div class="empty-state">${error ? esc(error) : 'Agent select karo — report card yahin ban jayega.'}</div>`}
      <p class="foot-note">Data: EIR agent-month (FF), EIR agent-class (VC4 / commercial / chassis / replacement / wrong VRN), StockDataa (field stock), GV Master (GV side), Settings → targets (agar set hain).</p>`;
    const find = U.$('#rc-find', root);
    if (find) U.suggest(find, {
      items: () => names.slice(0, 500).map((n) => ({ kind: 'agent', kindLabel: 'Agent', label: n, sub: '', value: n })),
      onPick: (it) => FF.app.updateParams({ q: it.value, month: '' }),
      onEnter: (v) => { if (clean(v)) FF.app.updateParams({ q: clean(v), month: '' }); }
    });
    const printBtn = U.$('#rc-print', root);
    if (printBtn) printBtn.addEventListener('click', () => window.print());
    const pngBtn = U.$('#rc-png', root);
    if (pngBtn && data) pngBtn.addEventListener('click', () => FF.wow.downloadWinnerCard({ name: data.name, rank: 1, monthLabel: U.labelYM(data.month, true), tags: data.curN, sub: `Report card · grade ${data.overallGrade}`, channel: 'First Forward' }));
    const csvBtn = U.$('#rc-csv', root);
    if (csvBtn && data) csvBtn.addEventListener('click', () => U.downloadCsv(`report-card-${U.slug(data.name)}-${data.month}.csv`,
      ['Subject', 'Score', 'Grade', 'Benchmark label', 'Benchmark value'],
      [['Agent', data.name, '', 'TL', data.tl || 'Direct'], ['Month', U.labelYM(data.month, true), '', 'Overall grade', data.overallGrade],
      ...data.subjects.map((s) => [s.subject, s.value, s.grade, s.refLabel, s.ref]),
      ...data.remarks.map((r) => ['Remark', r, '', '', ''])]));
    return data;
  }

  // ==========================================================================
  // 🎖️ LEVEL-UP CEREMONY
  // ==========================================================================
  function trumpet() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const notes = [[523.25, 0], [659.25, 0.14], [783.99, 0.28], [1046.5, 0.42], [1318.5, 0.6]];
      notes.forEach(([f, t]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sawtooth'; o.frequency.value = f;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
        o.connect(lp); lp.connect(g); g.connect(ctx.destination);
        const at = ctx.currentTime + t;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.13, at + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
        o.start(at); o.stop(at + 0.52);
      });
      setTimeout(() => { try { ctx.close(); } catch { /* ignore */ } }, 2000);
    } catch { /* audio blocked */ }
  }
  /** Fullscreen golden ceremony. opts: { name, icon, from, to, stats:[{label,value}], onClose } */
  function levelUpCeremony(opts) {
    const o = opts || {};
    const prev = U.$('#levelup');
    if (prev) prev.remove();
    const el = U.h(`<div class="levelup" id="levelup" role="dialog" aria-modal="true" aria-label="Level up ceremony">
      <div class="levelup-bg"></div>
      <div class="levelup-inner">
        <div class="levelup-badge">${esc(o.icon || '🎖️')}</div>
        <div class="levelup-kicker">Level up ceremony</div>
        <h2 class="levelup-name">${esc(o.name || 'Champion')}</h2>
        <p class="levelup-sub">${esc(o.from ? `${o.from} → ` : '')}<b>${esc(o.to || 'Next level')}</b> — mubarak ho! 🎉</p>
        <div class="levelup-stats">${(o.stats || []).map((s) => `<div><b>${esc(s.value)}</b><small>${esc(s.label)}</small></div>`).join('')}</div>
        <button class="levelup-btn" type="button">Shukriya, aage badho →</button>
      </div>
    </div>`);
    document.body.appendChild(el);
    trumpet();
    if (FF.wow && FF.wow.confettiBurst) { try { FF.wow.confettiBurst(); } catch { /* ignore */ } }
    const close = () => { el.remove(); if (o.onClose) o.onClose(); };
    el.querySelector('.levelup-btn').addEventListener('click', close);
    el.addEventListener('click', (e) => { if (e.target === el || e.target.classList.contains('levelup-bg')) close(); });
    setTimeout(() => { if (document.body.contains(el)) close(); }, 9000);
    return el;
  }
  /** Level promote hone par ek hi baar ceremony (localStorage guard). Return true agar naya promotion. */
  function celebratePromotion(name, icon, levelName, stats) {
    const seen = LS.get('ff-levelup', {});
    const key = normName(name);
    const before = seen[key];
    seen[key] = levelName;
    LS.set('ff-levelup', seen);
    if (before && before !== levelName) {
      const order = (FF.wow && FF.wow.LEVELS ? FF.wow.LEVELS.map((l) => l.name) : []);
      if (!order.length || order.indexOf(levelName) > order.indexOf(before)) {
        levelUpCeremony({ name, icon, from: before, to: levelName, stats });
        return true;
      }
    }
    return false;
  }

  // ==========================================================================
  // 📅 AAJ KA DIN (memory lane)
  // ==========================================================================
  async function memoryLane() {
    const [dailyR, masterR] = await Promise.allSettled([S.need('daily'), G.need('master').catch(() => [])]);
    const daily = dailyR.status === 'fulfilled' ? (dailyR.value || []) : [];
    const master = masterR.status === 'fulfilled' ? (masterR.value || []) : [];
    const today = new Date();
    const dayOfMonth = today.getDate();
    const out = [];
    // same date, previous months (FF)
    for (let back = 1; back <= 12; back++) {
      const d = new Date(today); d.setMonth(d.getMonth() - back);
      const key = U.dateKey(d);
      const ff = sum(daily.filter((r) => r.key === key && r.channel !== 'GV Partner'), (r) => r.n);
      const gv = master.filter((r) => r.date && U.dateKey(r.date) === key).length;
      if (ff || gv) out.push({ when: back === 12 ? '1 saal pehle' : `${back} mahine pehle`, title: `${U.labelDate(d, true)} — ${U.fmt(ff + gv)} tags`, note: `FF ${U.fmt(ff)} · GV ${U.fmt(gv)} · ${U.weekday(d)}` });
      if (out.length >= 4) break;
    }
    // this month's best day so far + same weekday last week
    const cur = U.ymKey(today);
    const monthDays = daily.filter((r) => r.ym === cur && r.channel !== 'GV Partner');
    const byDay = new Map();
    monthDays.forEach((r) => byDay.set(r.day, (byDay.get(r.day) || 0) + (Number(r.n) || 0)));
    const best = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) out.push({ when: 'is mahine', title: `Best day: ${U.labelDate(new Date(today.getFullYear(), today.getMonth(), best[0]), true)}`, note: `${U.fmt(best[1])} tags — ${U.weekday(new Date(today.getFullYear(), today.getMonth(), best[0]))}` });
    const lastWeek = new Date(today); lastWeek.setDate(lastWeek.getDate() - 7);
    const wkFf = sum(daily.filter((r) => r.key === U.dateKey(lastWeek) && r.channel !== 'GV Partner'), (r) => r.n);
    if (wkFf) out.push({ when: 'pichhle hafte', title: `Isi weekday (${U.weekday(lastWeek)}) — ${U.fmt(wkFf)} tags`, note: `${U.labelDate(lastWeek, true)} ka performance — compare karo` });
    return out;
  }
  function memoryLaneCard(items) {
    if (!items || !items.length) return '';
    return card(`📅 Aaj ka din · ${U.labelDate(new Date(), true)} <span class="dim">memories</span>`,
      `<div class="memory-list">${items.map((m) => `<div class="memory-item"><span class="m-when">${esc(m.when)}</span><div><b>${esc(m.title)}</b><small>${esc(m.note)}</small></div></div>`).join('')}</div>`,
      `<a class="btn small" href="#/trend?mode=compare">📈 Compare karo</a>`);
  }

  // ==========================================================================
  // 🎨 THEME PACKS
  // ==========================================================================
  const PACKS = {
    default: { name: 'Default (brand colours)', swatch: 'default', vars: {} },
    neon: { name: '🌃 Neon', swatch: 'neon', vars: { '--bg': '#0a0a12', '--card': '#13131f', '--ink': '#eef0ff', '--muted': '#7c85a8', '--line': '#2a2a44', '--brand': '#00e5ff', '--brand-2': '#ff2bd6', '--green': '#00ff9c', '--red': '#ff3b6b', '--amber': '#ffd60a' } },
    glass: { name: '🧊 Glass', swatch: 'glass', vars: { '--bg': '#eef1f9', '--card': '#ffffff', '--ink': '#111a2e', '--muted': '#5b6785', '--line': '#dbe3f2', '--brand': '#4f46e5', '--brand-2': '#06b6d4' } },
    diwali: { name: '🪔 Diwali festive', swatch: 'diwali', vars: { '--bg': '#180d05', '--card': '#2a170a', '--ink': '#fff6e2', '--muted': '#d0a982', '--line': '#4a2c12', '--brand': '#ff8c00', '--brand-2': '#ffd000', '--green': '#4ade80', '--red': '#f87171', '--amber': '#ffb703' } },
    gold: { name: '🥇 Gold corporate', swatch: 'gold', vars: { '--bg': '#f7f5ef', '--card': '#fffdf7', '--ink': '#2a2416', '--muted': '#7a7052', '--line': '#e7dfc8', '--brand': '#b45309', '--brand-2': '#d97706' } },
    mono: { name: '🖤 Mono', swatch: 'mono', vars: { '--bg': '#f4f5f7', '--card': '#ffffff', '--ink': '#111827', '--muted': '#6b7280', '--line': '#e5e7eb', '--brand': '#334155', '--brand-2': '#64748b' } }
  };
  function applyThemePack(name) {
    const pack = PACKS[name] ? name : 'default';
    const root = document.documentElement;
    const meta = PACKS[pack];
    // reset previously applied pack vars
    Object.values(PACKS).forEach((p) => Object.keys(p.vars).forEach((k) => root.style.removeProperty(k)));
    Object.entries(meta.vars).forEach(([k, v]) => root.style.setProperty(k, v));
    root.dataset.themePack = pack === 'default' ? '' : pack;
    try { localStorage.setItem('ff_theme_pack', pack); } catch { /* ignore */ }
    if (FF.charts && FF.charts.mount) setTimeout(() => FF.charts.mount(document), 30);
    return pack;
  }
  function currentPack() { try { return localStorage.getItem('ff_theme_pack') || 'default'; } catch { return 'default'; } }
  function mountThemePicker() {
    const actions = U.$('#top-actions');
    if (!actions || U.$('#theme-pack-btn')) return false;
    const wrap = U.h(`<div class="theme-wrap" style="position:relative">
      <button class="icon-btn" id="theme-pack-btn" title="Theme packs — Neon · Glass · Diwali · Gold · Mono" aria-label="Theme packs" aria-haspopup="true">🎨</button>
    </div>`);
    const themeToggle = U.$('#theme-toggle');
    if (themeToggle && themeToggle.parentElement) themeToggle.parentElement.insertBefore(wrap, themeToggle.nextSibling);
    else actions.appendChild(wrap);
    const btn = U.$('#theme-pack-btn', wrap);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const old = U.$('#theme-pop');
      if (old) { old.remove(); return; }
      const cur = currentPack();
      const pop = U.h(`<div class="theme-pop" id="theme-pop"><b>Theme pack</b>${Object.entries(PACKS).map(([k, p]) => `<button type="button" class="theme-opt ${k === cur ? 'on' : ''}" data-pack="${k}"><span class="theme-swatch ${esc(p.swatch)}"></span>${esc(p.name)}${k === cur ? ' ✓' : ''}</button>`).join('')}
        <button type="button" class="theme-opt" data-pack-custom><span class="theme-swatch default"></span>⚙️ Custom (Settings → Branding)</button></div>`);
      wrap.appendChild(pop);
      pop.addEventListener('click', (ev) => {
        const opt = ev.target.closest('[data-pack]');
        if (opt) { applyThemePack(opt.dataset.pack); pop.remove(); U.toast(`Theme: ${PACKS[opt.dataset.pack].name} ✓`, 'ok'); return; }
        if (ev.target.closest('[data-pack-custom]')) { pop.remove(); FF.app.navigate('settings', { tab: 'branding' }); }
      });
      setTimeout(() => document.addEventListener('click', function close() { const p = U.$('#theme-pop'); if (p) p.remove(); document.removeEventListener('click', close); }), 10);
    });
    const saved = currentPack();
    if (saved !== 'default') applyThemePack(saved);
    return true;
  }

  // ==========================================================================
  // 🟢 LIVE TAB HEARTBEAT
  // ==========================================================================
  function startHeartbeat(opts) {
    const o = opts || {};
    const base = `${FF.config.appName || 'Dashboard'}`;
    let timer = null, last = '';
    const render = async () => {
      if (!FF.auth.user) return;
      try {
        const [daily, master] = await Promise.all([S.need('daily').catch(() => []), G.need('master').catch(() => [])]);
        const today = U.dateKey(new Date());
        const ffToday = sum(daily.filter((r) => r.key === today && r.channel !== 'GV Partner'), (r) => r.n);
        const gvToday = master.filter((r) => r.date && U.dateKey(r.date) === today).length;
        const month = U.ymKey(new Date());
        const mtd = sum(daily.filter((r) => r.ym === month && r.channel !== 'GV Partner'), (r) => r.n) + master.filter((r) => r.ym === month).length;
        const top = (() => {
          const m = new Map();
          daily.filter((r) => r.key === today && r.channel !== 'GV Partner').forEach((r) => m.set(r.name, (m.get(r.name) || 0) + (Number(r.n) || 0)));
          master.filter((r) => r.date && U.dateKey(r.date) === today).forEach((r) => m.set(r.agentName, (m.get(r.agentName) || 0) + 1));
          return [...m.entries()].sort((a, b) => b[1] - a[1])[0];
        })();
        const total = ffToday + gvToday;
        const dot = document.hidden ? '⚪' : total ? '🟢' : '🟡';
        const title = `${dot} ${U.fmt(total)} tags today${top ? ` · ${top[0]}` : ''} · MTD ${U.fmt(mtd)} · ${base}`;
        if (title !== last) { last = title; document.title = title; }
        if (o.onTick) o.onTick({ ffToday, gvToday, total, mtd, top });
      } catch { /* offline */ }
    };
    const schedule = () => {
      clearInterval(timer);
      timer = setInterval(render, document.hidden ? 180000 : (o.interval || 45000));
    };
    document.addEventListener('visibilitychange', () => { render(); schedule(); });
    render(); schedule();
    return { stop: () => clearInterval(timer), refresh: render, get current() { return last; } };
  }

  // ==========================================================================
  // 💬 CHAT CHARTS (assistant integration)
  // ==========================================================================
  const CHART_PATTERNS = [
    { re: /(7|saat|seven)\s*(din|day|days)|last week|pichhle hafte|hafte ka/i, kind: 'days7' },
    { re: /30\s*(din|day|days)|mahine ka|month ka|monthly|month-wise|mahine-wise/i, kind: 'monthly' },
    { re: /(14|chaudah|fourteen)\s*(din|day)/i, kind: 'days14' },
    { re: /vc4.*(vs|aur|and).*(commercial|vc20|vc5)|commercial.*(vs|aur).*vc4|class mix|class-wise/i, kind: 'class' },
    { re: /(gv).*(vs|aur|and).*(ff|first forward)|ff.*(vs|aur).*gv|dono channel/i, kind: 'channel' },
    { re: /(channel|ff vs gv|gv vs ff)/i, kind: 'channel' },
    { re: /(trend|graph|chart|graphh|graphic|dekhao|dikhao|plot)/i, kind: 'trend' }
  ];
  async function chatChart(query, bubbleEl) {
    if (!query) return null;
    const q = String(query);
    if (!/(graph|chart|trend|plot|dikha|dekha|show)/i.test(q) && !/vs|aur|and/i.test(q)) return null;
    const hit = CHART_PATTERNS.find((p) => p.re.test(q));
    if (!hit) return null;
    const daily = await S.need('daily').catch(() => []);
    const master = await G.need('master').catch(() => []);
    if (!daily.length && !master.length) return null;
    const ffDaily = daily.filter((r) => r.channel !== 'GV Partner');
    const latest = ffDaily.reduce((acc, r) => (r.key && (!acc || r.key > acc) ? r.key : acc), '') || U.dateKey(new Date());
    const end = U.fromDateKey(latest);
    let title = '', body = '', foot = [], kind = hit.kind;
    if (kind === 'trend') kind = 'days7';
    if (kind === 'days7' || kind === 'days14') {
      const n = kind === 'days7' ? 7 : 14;
      const labels = [], ff = [], gv = [];
      for (let i = n - 1; i >= 0; i--) {
        const d = new Date(end); d.setDate(d.getDate() - i);
        const k = U.dateKey(d);
        labels.push(`${d.getDate()} ${U.labelDate(d).split(' ')[1]}`);
        ff.push(sum(ffDaily.filter((r) => r.key === k), (r) => r.n));
        gv.push(master.filter((r) => r.date && U.dateKey(r.date) === k).length);
      }
      title = `Last ${n} days trend`;
      body = C.lines({ labels, height: 190, series: [{ name: 'First Forward', values: ff, color: '#6366f1' }, { name: 'GV Partner', values: gv, color: '#0d9488' }] });
      foot = [`FF total ${U.fmt(sum(ff, (v) => v))}`, `GV total ${U.fmt(sum(gv, (v) => v))}`, `Latest ${U.labelDateKey(latest, true)}`];
    } else if (kind === 'monthly') {
      const months = U.uniq([...ffDaily.map((r) => r.ym), ...master.map((r) => r.ym)].filter(Boolean)).sort().slice(-8);
      const labels = months.map((m) => U.labelYM(m));
      body = C.bars({ labels, height: 200, legendAlways: true, series: [
        { name: 'First Forward', values: months.map((m) => sum(ffDaily.filter((r) => r.ym === m), (r) => r.n)), color: '#6366f1' },
        { name: 'GV Partner', values: months.map((m) => master.filter((r) => r.ym === m).length), color: '#0d9488' }
      ] });
      title = 'Month-wise issuance';
      foot = [`${U.fmt(months.length)} months`, `Latest ${U.labelYM(months[months.length - 1])}`];
    } else if (kind === 'class') {
      const month = U.ymKey(end);
      const ffS = M.summary(ffDaily, month);
      body = C.donut({ items: [{ label: 'VC4', value: ffS.vc4 }, { label: 'VC20', value: ffS.vc20 }, { label: 'VC5+', value: ffS.vc5p }], subtitle: 'FF MTD' });
      title = `FF class mix · ${U.labelYM(month)}`;
      foot = [`VC4 ${U.fmt(ffS.vc4)}`, `Commercial ${U.fmt(ffS.comm)}`, `Total ${U.fmt(ffS.total)}`];
    } else {
      const month = U.ymKey(end);
      const ffS = M.summary(ffDaily, month);
      const gvS = G.summary ? G.summary(month) : { total: 0 };
      body = C.bars({ labels: ['FF', 'GV'], height: 190, series: [{ name: U.labelYM(month), values: [ffS.total, gvS.total], color: '#6366f1' }], showValues: true });
      title = `First Forward vs GV · ${U.labelYM(month)}`;
      foot = [`FF ${U.fmt(ffS.total)}`, `GV ${U.fmt(gvS.total)}`, `Combined ${U.fmt(ffS.total + gvS.total)}`];
    }
    if (!body) return null;
    const html = `<div class="ask-chart"><div class="ask-chart-head">📊 ${esc(title)} <small>· ${esc(U.labelDateKey(latest, true))} tak ka data</small></div>
      <div class="ask-chart-body">${body}</div>
      <div class="ask-chart-foot">${foot.map((f) => `<span class="ins-pill">${esc(f)}</span>`).join('')}<a class="btn tiny" href="#/trend">Full trend →</a></div></div>`;
    if (bubbleEl) {
      bubbleEl.insertAdjacentHTML('beforeend', html);
      if (C.mount) C.mount(bubbleEl);
    }
    return html;
  }

  // ==========================================================================
  // PAGE REGISTRATION
  // ==========================================================================
  FF.pages.activity = { title: 'Activity Calendar', render: renderActivity };
  FF.pages.network = { title: 'Team Network', render: renderNetwork };
  FF.pages.radar = { title: 'Anomaly Radar', render: renderRadar };
  FF.pages.reportCards = { title: 'Agent Report Cards', render: renderReportCards };

  FF.wowzone = {
    sparkline, sparkRow, heatmapGrid, networkGraph, bindNetwork, anomalyFindings,
    reportCardData, reportCardHtml, levelUpCeremony, celebratePromotion, trumpet,
    memoryLane, memoryLaneCard, PACKS, applyThemePack, mountThemePicker, currentPack,
    startHeartbeat, chatChart
  };
})(window.FF);
