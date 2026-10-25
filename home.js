/* Home page — "GV aaj live" + month KPI cards (EIR) + charts + GV/FF stock.
   • 🟩 GV aaj ka number pehle /api/today (server par GV Master ki chhoti grouped query) se aata hai,
     phir GV Master dataset load hone par usi snapshot se enrich ho jaata hai — bada full-tab download
     kabhi Home ko block nahi karta.
   • 🧾 Saara issuance EIR (First Forward sheet) se: GV channel = master ID 5845036, baaki FF.
     GV ka AAJ ka data EIR me nahi hota (T+1) — isliye aaj sirf GV Master sheet se aata hai.
   • 📦 Stock: FF = StockDataa, GV = Tag Assignment.
   • 🔎 Global search lives in the top bar on every page; the full Master Search page remains under Management.
   Sources are always spelled out under every card. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, M = FF.model, S = FF.store, G = FF.gv, C = FF.charts;
  const F = () => FF.filters;
  const esc = U.esc;

  function greeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }
  // `plain` = card ki value ka saaf text (complex cards: Expected / Run Rate) — drawer ke "📌 card = …" line me wahi aata hai.
  /** VC4 · VC20 · VC5+ split chips (bold counts) — Replacement / Chassis / Wrong VRN cards. */
  const clsSplit = (by) => {
    const o = by || {};
    const n = (k) => Number(o[k]) || 0;
    return `<div class="kpi-clsplit">${[['VC4', 'VC4'], ['VC20', 'VC20'], ['VC5+', 'VC5+']].map(([k, l]) => `<span class="${n(k) ? '' : 'zero'}">${l} <b>${U.fmt(n(k))}</b></span>`).join('')}</div>`;
  };
  const kpi = (cls, title, icon, value, foot, spec, plain, spark) => `<div class="kpi ${cls}"${spec ? ` data-kpi="${esc(spec)}"` : ''}${plain ? ` data-kpi-value="${esc(plain)}"` : ''} data-kpi-title="${esc(title)}" role="button" tabindex="0"><div class="kpi-top"><span class="kpi-title">${esc(title)}</span><span class="kpi-icon">${icon}</span></div><div class="kpi-value">${value}</div>${spark || ''}<div class="kpi-foot">${foot || ''}</div></div>`;
  /** 📈 v3.88 — din-wise sparkline (current month, report wale din tak). rows = daily rows (ym, day, n, group, type, vrnType). */
  const dailySeries = (rows, ym, upTo, pick) => {
    const out = Array(Math.max(0, upTo | 0)).fill(0);
    (rows || []).forEach((r) => { if (r.ym !== ym || r.day < 1 || r.day > out.length) return; out[r.day - 1] += pick ? pick(r) : (Number(r.n) || 0); });
    return out;
  };
  /** Har din par hover → tooltip me us din ka exact number (rect hit-area + <title>). */
  const sparkSvg = (vals, tone, ym) => {
    if (!vals.length || vals.every((v) => !v)) return '';
    const w = 100, h = 20, max = Math.max(1, ...vals);
    const step = vals.length > 1 ? w / (vals.length - 1) : w;
    const pts = vals.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(' ');
    const hit = vals.map((v, i) => {
      const dk = `${ym}-${String(i + 1).padStart(2, '0')}`;
      return `<rect x="${(i * step - step / 2).toFixed(1)}" y="0" width="${step.toFixed(1)}" height="${h}"><title>${esc(`${U.labelDateKey(dk)}: ${U.fmt(v)}`)}</title></rect>`;
    }).join('');
    return `<svg class="kpi-spark ${tone || ''}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}"/>${hit}</svg>`;
  };
  /** Actual vs expected progress bar (card ke andar). */
  const progBar = (actual, exp) => {
    if (!exp || exp <= 0) return '';
    const p = Math.max(0, Math.round(((actual || 0) / exp) * 100));
    return `<div class="kpi-prog" title="Actual ${U.fmt(actual || 0)} / Expected ${U.fmt(exp)} · ${p}%"><span style="width:${Math.min(100, p)}%"></span><em>${p}%</em></div>`;
  };
  const card = (title, body, right) => `<section class="card"><div class="card-head"><div><h3>${title}</h3></div>${right ? `<div class="card-right">${right}</div>` : ''}</div><div class="card-body">${body}</div></section>`;
  const dayKey = (d) => U.dateKey(d);
  const TODAY = () => new Date();
  const todayK = () => dayKey(TODAY());
  const sumN = (rows, fn) => U.sum(rows || [], fn || ((r) => Number(r.n) || 0));
  /** "+12% vs last" (green) / "−8% vs last" (red) — kabhi bhi null ho to "—". */
  const momChip = (cur, last, label) => {
    const g = U.growth(cur, last);
    if (g === null || g === undefined || !Number.isFinite(g)) return `<span class="dim">${esc(label || 'last month')}: ${U.fmt(last || 0)}</span>`;
    return `<span class="dim">${esc(label || 'last month')} <b>${U.fmt(last)}</b></span> · <span class="pct-inline ${g > 0 ? 'pos' : g < 0 ? 'neg' : 'flat'}">${g > 0 ? '▲' : g < 0 ? '▼' : '•'} ${Math.abs(g).toFixed(0)}%</span>`;
  };
  const splitFoot = (ff, gv) => `<span class="hm-split"><span class="ff">🟦 FF <b>${U.fmt(ff)}</b></span><span class="gv">🟩 GV <b>${U.fmt(gv)}</b></span></span>`;

  // ---------------------------------------------------------------- interactive cross-channel issuance explorer
  const EXPLORER_STORAGE_KEY = 'ff-home-issuance-explorer-v1';
  const EXPLORER_CLASSES = ['VC4', 'VC20', 'VC5+'];
  const EXPLORER_FILTERS = {
    channels: [['ff', '🟦 First Forward'], ['gv', '🟩 GV Partner']],
    types: [['replacement', '🔁 Replacement'], ['chassis', '🔧 Chassis']],
    classes: [['VC4', 'VC4'], ['VC20', 'VC20'], ['VC5+', 'VC5+']]
  };
  const cleanSet = (values, options) => new Set([...U.asValueSet(values)].filter((v) => options.includes(String(v))));
  function explorerDateKey(value) {
    if (value === null || value === undefined || value === '') return '';
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : U.dateKey(value);
    const raw = String(value).trim();
    const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    const parsed = U.parseDate(value);
    return parsed ? U.dateKey(parsed) : '';
  }
  function defaultExplorerRange(now) {
    const d = now instanceof Date ? new Date(now) : new Date();
    return { from: `${U.ymKey(d)}-01`, to: U.dateKey(d) };
  }
  function validExplorerDate(value) {
    const key = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
    const date = U.parseDate(key);
    return date && U.dateKey(date) === key ? key : '';
  }
  function loadExplorerFilters() {
    const defaults = defaultExplorerRange();
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(EXPLORER_STORAGE_KEY) || 'null'); } catch { saved = null; }
    if (!saved || typeof saved !== 'object') saved = {};
    const hasSavedRange = Object.prototype.hasOwnProperty.call(saved, 'from') && Object.prototype.hasOwnProperty.call(saved, 'to');
    const savedDate = (value, fallback) => value === '' && hasSavedRange ? '' : validExplorerDate(value) || fallback;
    return {
      channels: cleanSet(saved.channels, EXPLORER_FILTERS.channels.map(([value]) => value)),
      types: cleanSet(saved.types, EXPLORER_FILTERS.types.map(([value]) => value)),
      classes: cleanSet(saved.classes, EXPLORER_CLASSES),
      from: hasSavedRange ? savedDate(saved.from, defaults.from) : defaults.from,
      to: hasSavedRange ? savedDate(saved.to, defaults.to) : defaults.to
    };
  }
  const explorerFilters = loadExplorerFilters();
  function saveExplorerFilters() {
    try {
      localStorage.setItem(EXPLORER_STORAGE_KEY, JSON.stringify({
        channels: [...explorerFilters.channels], types: [...explorerFilters.types], classes: [...explorerFilters.classes],
        from: explorerFilters.from, to: explorerFilters.to
      }));
    } catch { /* private mode */ }
  }
  function resetExplorerFilters(now) {
    const range = defaultExplorerRange(now);
    explorerFilters.channels.clear(); explorerFilters.types.clear(); explorerFilters.classes.clear();
    explorerFilters.from = range.from; explorerFilters.to = range.to;
    return explorerFilters;
  }
  function explorerRangePreset(preset, now) {
    const d = now instanceof Date ? new Date(now) : new Date();
    const today = U.dateKey(d);
    const monthStart = U.dateKey(new Date(d.getFullYear(), d.getMonth(), 1));
    if (preset === 'today') return { from: today, to: today };
    if (preset === 'month') return { from: monthStart, to: today };
    if (preset === 'last-month') {
      const end = new Date(d.getFullYear(), d.getMonth(), 0);
      return { from: U.dateKey(new Date(end.getFullYear(), end.getMonth(), 1)), to: U.dateKey(end) };
    }
    if (preset === '30d') {
      const start = new Date(d); start.setDate(start.getDate() - 29);
      return { from: U.dateKey(start), to: today };
    }
    if (preset === 'all') return { from: '', to: '' };
    return { from: monthStart, to: today };
  }
  function explorerChannel(row) {
    const value = String(row && row.channel || (row && row.gvName ? 'GV Partner' : '')).trim().toLowerCase();
    return /^(gv|green)|gv partner/.test(value) ? 'gv' : 'ff';
  }
  function explorerClass(row) {
    const group = String(row && row.group || '').trim().toUpperCase();
    if (EXPLORER_CLASSES.includes(group)) return group;
    const cls = String(row && row.cls || '').trim();
    return cls && M && typeof M.classGroup === 'function' ? M.classGroup(cls) : '';
  }
  function explorerHasType(row, kind) {
    const typeText = `${row && row.type || ''} ${row && row.status || ''} ${row && row.tagType || ''}`;
    if (kind === 'replacement') return /replace/i.test(typeText);
    if (kind === 'chassis') return /chassis/i.test(`${typeText} ${row && row.vrnType || ''}`);
    return false;
  }
  function filterExplorerRows(rows, filters, allowedChannels) {
    const f = filters || {};
    const allowed = new Set((allowedChannels || ['ff', 'gv']).map((v) => /^(gv|green)/i.test(String(v)) ? 'gv' : 'ff'));
    const channels = cleanSet(f.channels || f.ch, ['ff', 'gv']);
    const types = cleanSet(f.types || f.type, EXPLORER_FILTERS.types.map(([value]) => value));
    const classes = cleanSet(f.classes || f.class, EXPLORER_CLASSES);
    let from = validExplorerDate(f.from) || '', to = validExplorerDate(f.to) || '';
    if (from && to && from > to) [from, to] = [to, from];
    return (rows || []).filter((row) => {
      const channel = explorerChannel(row);
      if (!allowed.has(channel) || (channels.size && !channels.has(channel))) return false;
      const key = explorerDateKey(row.key || row.dateKey || row.date || row.d);
      if (from && (!key || key < from)) return false;
      if (to && (!key || key > to)) return false;
      if (classes.size && !classes.has(explorerClass(row))) return false;
      if (types.size && ![...types].some((kind) => explorerHasType(row, kind))) return false;
      return true;
    });
  }
  function explorerTotals(rows) {
    const empty = () => ({ VC4: 0, VC20: 0, 'VC5+': 0 });
    const byChannel = { ff: empty(), gv: empty() };
    let total = 0;
    for (const row of rows || []) {
      const channel = explorerChannel(row), group = explorerClass(row);
      if (!EXPLORER_CLASSES.includes(group)) continue;
      const n = Math.max(0, Number(row.n) || 0);
      byChannel[channel][group] += n;
      total += n;
    }
    return { byChannel, total, rows: (rows || []).length, byClass: Object.fromEntries(EXPLORER_CLASSES.map((group) => [group, byChannel.ff[group] + byChannel.gv[group]])) };
  }
  function explorerDaily(rows, filters, allowedChannels) {
    const f = filters || {};
    const keys = (rows || []).map((row) => explorerDateKey(row.key || row.dateKey || row.date || row.d)).filter(Boolean).sort();
    if (!keys.length) return {
      keys: [], labels: [], tipLabels: [],
      byChannel: { ff: [], gv: [] },
      byClass: { VC4: [], VC20: [], 'VC5+': [] },
      byType: { replacement: [], chassis: [] },
      from: '', to: '', capped: false, undated: (rows || []).length, total: 0
    };
    let from = validExplorerDate(f.from) || keys[0], to = validExplorerDate(f.to) || keys[keys.length - 1];
    if (from > to) [from, to] = [to, from];
    const fullFrom = from, fullTo = to;
    const dayNumber = (key) => { const [y, m, d] = key.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 86400e3); };
    const dayCount = dayNumber(to) - dayNumber(from) + 1;
    const capped = dayCount > 366;
    if (capped) {
      const end = U.fromDateKey(to); end.setDate(end.getDate() - 365);
      from = U.dateKey(end);
    }
    const dateKeys = [];
    const cursor = U.fromDateKey(from), end = U.fromDateKey(to);
    while (cursor <= end) { dateKeys.push(U.dateKey(cursor)); cursor.setDate(cursor.getDate() + 1); }

    const daily = {
      ff: new Map(dateKeys.map((key) => [key, 0])),
      gv: new Map(dateKeys.map((key) => [key, 0]))
    };
    const dailyClass = {
      VC4: new Map(dateKeys.map((key) => [key, 0])),
      VC20: new Map(dateKeys.map((key) => [key, 0])),
      'VC5+': new Map(dateKeys.map((key) => [key, 0]))
    };
    const dailyType = {
      replacement: new Map(dateKeys.map((key) => [key, 0])),
      chassis: new Map(dateKeys.map((key) => [key, 0]))
    };
    let total = 0, datedCount = 0;
    for (const row of rows || []) {
      const key = explorerDateKey(row.key || row.dateKey || row.date || row.d);
      if (!key) continue;
      const channel = explorerChannel(row);
      if (!daily[channel] || key < from || key > to) continue;
      const n = Math.max(0, Number(row.n) || 0);
      daily[channel].set(key, (daily[channel].get(key) || 0) + n);
      const group = explorerClass(row);
      if (EXPLORER_CLASSES.includes(group)) dailyClass[group].set(key, (dailyClass[group].get(key) || 0) + n);
      if (explorerHasType(row, 'replacement')) dailyType.replacement.set(key, (dailyType.replacement.get(key) || 0) + n);
      if (explorerHasType(row, 'chassis')) dailyType.chassis.set(key, (dailyType.chassis.get(key) || 0) + n);
      total += n; datedCount++;
    }
    const allowed = new Set((allowedChannels || ['ff', 'gv']).map((v) => /^(gv|green)/i.test(String(v)) ? 'gv' : 'ff'));
    return {
      keys: dateKeys,
      labels: dateKeys.map((key) => U.labelDateKey(key, false)),
      tipLabels: dateKeys.map((key) => `${U.labelDateKey(key, true)} · ${key}`),
      byChannel: {
        ff: dateKeys.map((key) => allowed.has('ff') ? daily.ff.get(key) || 0 : 0),
        gv: dateKeys.map((key) => allowed.has('gv') ? daily.gv.get(key) || 0 : 0)
      },
      byClass: Object.fromEntries(EXPLORER_CLASSES.map((group) => [group, dateKeys.map((key) => dailyClass[group].get(key) || 0)])),
      byType: Object.fromEntries([['replacement', 'replacement'], ['chassis', 'chassis']].map(([k, src]) => [k, dateKeys.map((key) => dailyType[src].get(key) || 0)])),
      from, to, fullFrom, fullTo, capped, undated: Math.max(0, (rows || []).length - datedCount), total
    };
  }
  function explorerHtml(rows, allowedChannels) {
    const allowed = [...new Set((allowedChannels || ['ff', 'gv']).map((v) => /^(gv|green)/i.test(String(v)) ? 'gv' : 'ff'))];
    const accessibleFilters = { ...explorerFilters, channels: new Set([...explorerFilters.channels].filter((ch) => allowed.includes(ch))) };
    const matched = filterExplorerRows(rows, accessibleFilters, allowed);
    const totals = explorerTotals(matched);
    const activeChannels = accessibleFilters.channels.size ? allowed.filter((ch) => accessibleFilters.channels.has(ch)) : allowed;
    const daily = explorerDaily(matched, accessibleFilters, allowed);
    const series = activeChannels.map((ch) => ({
      name: ch === 'ff' ? 'First Forward · FF' : 'GV Partner · GV',
      values: daily.byChannel[ch] || [],
      color: ch === 'ff' ? '#6366f1' : '#0d9488'
    }));
    const labelEvery = daily.keys.length > 180 ? 21 : daily.keys.length > 90 ? 14 : daily.keys.length > 45 ? 7 : daily.keys.length > 20 ? 3 : 1;
    const plotWidth = Math.max(640, daily.keys.length * 23 + 56);
    const chartTips = daily.keys.map((key, i) => {
      const total = [...daily.byChannel.ff, ...daily.byChannel.gv].length ? (daily.byChannel.ff[i] || 0) + (daily.byChannel.gv[i] || 0) : 0;
      const rows = [
        `<b>${esc(daily.tipLabels[i] || key)}</b>`,
        `🟦 First Forward: <b>${U.fmt(daily.byChannel.ff[i] || 0)}</b>`,
        `🟩 GV Partner: <b>${U.fmt(daily.byChannel.gv[i] || 0)}</b>`,
        `VC4: <b>${U.fmt(daily.byClass.VC4[i] || 0)}</b>`,
        `VC20: <b>${U.fmt(daily.byClass.VC20[i] || 0)}</b>`,
        `VC5+: <b>${U.fmt(daily.byClass['VC5+'][i] || 0)}</b>`,
        `🔧 Chassis: <b>${U.fmt(daily.byType.chassis[i] || 0)}</b>`,
        `🔁 Replacement: <b>${U.fmt(daily.byType.replacement[i] || 0)}</b>`,
        `🏷️ Total: <b>${U.fmt(total)}</b>`
      ];
      return rows.join('<br>');
    });
    const bars = series.length && daily.keys.length ? C.bars({
      labels: daily.labels, tipLabels: daily.tipLabels, tips: chartTips, height: 220, series,
      showValues: daily.keys.length <= 14, labelEvery, legendAlways: true,
      minPlotWidth: plotWidth
    }) : '';
    const groupButtons = (dim, options) => {
      const active = accessibleFilters[dim];
      const all = `<button type="button" class="home-exp-chip ${active.size ? '' : 'on'}" data-home-exp-filter="${dim}:all" aria-pressed="${active.size ? 'false' : 'true'}">All</button>`;
      return all + options.filter(([value]) => dim !== 'channels' || allowed.includes(value)).map(([value, label]) => {
        const on = active.has(value);
        return `<button type="button" class="home-exp-chip ${on ? 'on' : ''}" data-home-exp-filter="${dim}:${esc(value)}" aria-pressed="${on ? 'true' : 'false'}">${label}</button>`;
      }).join('');
    };
    const rangeLabel = accessibleFilters.from || accessibleFilters.to
      ? `${accessibleFilters.from ? U.labelDateKey(accessibleFilters.from, true) : 'Start'} → ${accessibleFilters.to ? U.labelDateKey(accessibleFilters.to, true) : 'Today'}`
      : 'All available dates';
    const channelSplit = (group) => allowed.map((ch) => `${ch === 'ff' ? 'FF' : 'GV'} ${U.fmt(totals.byChannel[ch][group])}`).join(' · ');
    const summary = EXPLORER_CLASSES.map((group) => `<div class="home-exp-stat"><span>${group}</span><b>${U.fmt(totals.byClass[group])}</b><small>${channelSplit(group)}</small></div>`).join('');
    const emptyMessage = !matched.length
      ? '<div class="home-exp-empty">Is date / filter selection ke liye koi issuance nahi mila.</div>'
      : '<div class="home-exp-empty">Filtered rows me valid issuance date nahi mili; date-wise bars nahi ban sake.</div>';
    const chartNote = daily.capped
      ? 'Date range 366 days se lamba hai; chart me latest 366 daily bars dikhte hain.'
      : `${U.fmt(daily.keys.length)} daily bars · ${U.fmt(daily.total)} dated tags`;
    const undatedNote = daily.undated ? ` · ${U.fmt(daily.undated)} rows bina date ke chart me nahi dikhte` : '';
    return `<section class="card home-exp-card"><div class="card-head"><div><h3>📊 Issuance mix · date-wise</h3><span class="dim small">FF + GV · ${esc(rangeLabel)} · ${U.fmt(totals.total)} tags</span></div><div class="card-right"><button type="button" class="btn small" data-home-exp-reset title="Current month ke default filters lagao">↺ Reset</button></div></div>
      <div class="card-body home-exp-body">
        <div class="home-exp-controls">
          <div class="home-exp-filter"><span>Channel · multi-select</span><div>${groupButtons('channels', EXPLORER_FILTERS.channels)}</div></div>
          <div class="home-exp-filter"><span>Type · multi-select</span><div>${groupButtons('types', EXPLORER_FILTERS.types)}</div></div>
          <div class="home-exp-filter"><span>Class · multi-select</span><div>${groupButtons('classes', EXPLORER_FILTERS.classes)}</div></div>
          <div class="home-exp-filter home-exp-date-filter"><span>Date range</span><div class="home-exp-dates">
            <label>From <input class="input" type="date" id="home-exp-from" data-home-exp-date="from" value="${esc(accessibleFilters.from)}"></label>
            <label>To <input class="input" type="date" id="home-exp-to" data-home-exp-date="to" value="${esc(accessibleFilters.to)}"></label>
          </div><div class="home-exp-presets">${[['today', 'Today'], ['month', 'This month'], ['last-month', 'Last month'], ['30d', 'Last 30 days'], ['all', 'All dates']].map(([key, label]) => `<button type="button" class="chip" data-home-exp-range="${key}">${label}</button>`).join('')}</div></div>
        </div>
        <div class="home-exp-summary" aria-label="Class totals">${summary}</div>
        <div class="home-exp-chart">${bars || emptyMessage}</div>
        <p class="dim small home-exp-note">Daily FF / GV issuance bars hain; type, class, channel aur date filters sab apply hote hain. Upar class-wise totals hain. ${esc(chartNote + undatedNote)}</p>
      </div></section>`;
  }

  /** Month KPI context.
   * FF EIR report T+1 aati hai, isliye October ka expected/run-rate 1 din piche ke
   * received data par based rahega: 3 Oct ko basis 2 Oct tak. GV live rows ko
   * month total me include karna continue rahega, lekin denominator received/report
   * cutoff par rahega taaki current day ko prematurely full day na maana jaye.
   */
  function monthContext(rows) {
    const curKey = U.ymKey(TODAY());
    const prevKey = U.prevMonthKey(curKey);
    const today = TODAY();
    const lagDays = Math.max(1, Number(
      FF.config && FF.config.ffIssuanceLagDays != null
        ? FF.config.ffIssuanceLagDays
        : 1
    ) || 1);

    // Bank/EIR received-through date: today - 1 by default.
    const receivedDate = new Date(today);
    receivedDate.setDate(receivedDate.getDate() - lagDays);

    // For current month, the number of reportable/received calendar days is the
    // received date's day. On month boundaries this naturally becomes the prior
    // month's full-day count (e.g. 1 Oct -> 30 Sep).
    const observedDay = receivedDate.getFullYear() === today.getFullYear() &&
      receivedDate.getMonth() === today.getMonth()
      ? Math.max(1, receivedDate.getDate())
      : Math.max(1, U.daysInMonth(U.ymKey(receivedDate)));

    const daysInMonth = U.daysInMonth(curKey);
    const compareDay = Math.max(1, observedDay);
    return {
      curKey,
      prevKey,
      observedDay,
      compareDay,
      daysInMonth,
      receivedDate,
      lagDays
    };
  }

  /** Convert the small server feed's class totals into month-summary rows until full GV Master loads. */
  function feedMatchesCurrentClassMap(live) {
    const current = FF.config && typeof FF.config.gvClassMapVersion === 'function'
      ? FF.config.gvClassMapVersion()
      : '';
    return !!(live && current && live.classMapVersion && live.classMapVersion === current);
  }
  // Expected Today fallback: server feed me expected kabhi transiently missing ho to bhi
  // recent same-weekday GV series se value turant calculate ho jaye.
  function expectedFromWeekdaySeries(series, dayKey) {
    const src = series && typeof series === 'object' ? series : {};
    const day = String(dayKey || todayK());
    const keys = Object.keys(src).filter((k) => k < day).sort().reverse();
    if (!keys.length) return null;
    const parsed = new Date(day + 'T00:00:00Z');
    if (Number.isNaN(parsed.getTime())) return null;
    const wd = parsed.getUTCDay();
    const same = keys.filter((k) => {
      const d = new Date(k + 'T00:00:00Z');
      return !Number.isNaN(d.getTime()) && d.getUTCDay() === wd;
    }).slice(0, 4);
    if (!same.length) return null;
    return Math.round(same.reduce((n, k) => n + (Number(src[k]) || 0), 0) / same.length);
  }

  function liveRowsFromFeed(live) {
    if (!live) return null;
    const key = live.date || todayK();
    const d = U.fromDateKey(key);
    const classes = live.classes && Object.keys(live.classes).length ? live.classes : {
      VC4: live.vc4 || 0, VC20: live.vc20 || 0, 'VC5+': live.vc5p || 0
    };
    return Object.entries(classes).map(([cls, quantity]) => ({
      key, date: d, d, ym: key.slice(0, 7), day: Number(key.slice(8, 10)) || d.getDate(),
      cls, group: M.classGroup(cls), type: 'ISSUANCE', vrnType: '', channel: 'GV Partner',
      n: Math.max(0, Number(quantity) || 0), live: true, source: 'gv-today-feed'
    })).filter((row) => row.n > 0);
  }
  /** Pichhle 4 same-weekday ke GV din (EIR se: master ID 5845036 wali rows) — Expected Today ka average + unke din.
   *  null = EIR rows nahi mili. Card aur click ka drawer (eir=1&dow=…) yahi din dikhate hain. */
  function eirWeekdays(dayKeyNow, rows) {
    const series = {};
    for (const r of rows || []) { if (r.channel === 'GV Partner' && r.key && r.key < dayKeyNow) series[r.key] = (series[r.key] || 0) + (Number(r.n) || 0); }
    const wd = U.fromDateKey(dayKeyNow).getDay();
    const keys = Object.keys(series).filter((k) => U.fromDateKey(k).getDay() === wd).sort().reverse().slice(0, 4).reverse();
    if (!keys.length) return null;
    return { keys, bars: { labels: keys.map((k) => U.labelDateKey(k)), values: keys.map((k) => series[k]) }, expected: expectedFromWeekdaySeries(series, dayKeyNow) };
  }
  /** Today's GV Master/live-feed rows replace today's EIR GV rows (never add a partial duplicate). */
  function streams(daily, gvTodayRows, replaceGvToday) {
    let rows = (daily || []).slice();
    const tk = todayK();
    const replace = !!replaceGvToday && Array.isArray(gvTodayRows);
    if (replace) rows = rows.filter((r) => !(r.channel === 'GV Partner' && r.key === tk));
    const added = replace ? gvTodayRows.length : 0;
    if (added) rows.push(...gvTodayRows);
    return {
      rows,
      gvLiveAdded: replace,
      ff: rows.filter((r) => r.channel !== 'GV Partner'),
      gv: rows.filter((r) => r.channel === 'GV Partner')
    };
  }

  // GV today ke har class ka highest issuer — live GV Master rows se directly calculate hota hai.
  function gvTodayHighest(rows) {
    const maps = { VC4: new Map(), VC20: new Map(), 'VC5+': new Map() };
    for (const r of rows || []) {
      const group = r.group === 'VC4' ? 'VC4' : r.group === 'VC20' ? 'VC20' : 'VC5+';
      const key = String(r.agentId || r.agentName || '—').trim() || '—';
      const cur = maps[group].get(key) || { name: String(r.agentName || r.agentId || '—').trim() || '—', id: String(r.agentId || '').trim(), n: 0 };
      cur.n += 1;
      maps[group].set(key, cur);
    }
    const best = {};
    for (const group of Object.keys(maps)) {
      best[group] = [...maps[group].values()].sort((a, b) => b.n - a.n || String(a.name).localeCompare(String(b.name)))[0] || null;
    }
    return best;
  }

  // ---------------------------------------------------------------- cards
  function gvLiveHtml(live) {
    const tk = todayK();
    const pace = live.pace;
    const expected = live.expected;
    const sourceNote = live.source === 'master'
      ? 'GV Master sheet (live, abhi load hua)'
      : `GV Master sheet (live${live.stale ? ' · stale fallback' : live.cached ? ' · recent cache' : ''}, server feed)`;
    // Expected Today = pichhle 4 same-weekday ka average → drawer wahi 4 din (aaj ke weekday wale) dikhata hai, aaj ki rows nahi.
    const expectedTodaySpec = () => {
      const t = TODAY(), from = new Date(t), to = new Date(t);
      from.setDate(from.getDate() - 28); to.setDate(to.getDate() - 1);
      const ks = Array.isArray(live.weekdayKeys) && live.weekdayKeys.length ? live.weekdayKeys.slice().sort() : null;
      return `src=gv&scope=range&from=${ks ? ks[0] : dayKey(from)}&to=${dayKey(to)}&dow=${t.getDay()}&view=weekday&eir=1`;
    };
    const cards = [
      kpi('g11', 'Aaj Total (GV live)', '🏷️', U.fmt(live.total),
        `${expected != null ? `expected <b>${U.fmt(expected)}</b> · ` : ''}pace ${pace != null ? U.fmt(pace) : '—'} day-end`,
        `src=gv&scope=day&date=${tk}`),
      kpi('g3', 'VC4', '🚗', U.fmt(live.vc4), live.total ? `${U.fmtPct(U.pctOf(live.vc4, live.total), 0)} share` : '—', `src=gv&scope=day&date=${tk}&f=vc4`),
      kpi('g8', 'VC20', '🛻', U.fmt(live.vc20), live.total ? `${U.fmtPct(U.pctOf(live.vc20, live.total), 0)} share` : '—', `src=gv&scope=day&date=${tk}&f=vc20`),
      kpi('g6', 'VC5+', '🚚', U.fmt(live.vc5p), live.total ? `${U.fmtPct(U.pctOf(live.vc5p, live.total), 0)} share` : '—', `src=gv&scope=day&date=${tk}&f=vc5p`),
      kpi('g5', 'Replacement', '🔁', U.fmt(live.replacement), `${live.total ? `${U.fmtPct(U.pctOf(live.replacement, live.total), 0)} of today` : '—'}${clsSplit(live.replacementBy)}`, `src=gv&scope=day&date=${tk}&f=repl`),
      kpi('g7', 'Chassis', '🔧', U.fmt(live.chassis), `${live.total ? `${U.fmtPct(U.pctOf(live.chassis, live.total), 0)} of today` : '—'}${clsSplit(live.chassisBy)}`, `src=gv&scope=day&date=${tk}&f=chassis`),
      kpi('g-red', 'Wrong VRN', '⚠️', U.fmt(live.wrongVrn || 0), live.total ? `${U.fmtPct(U.pctOf(live.wrongVrn || 0, live.total), 0)} of today${clsSplit(live.wrongVrnBy)}` : 'VRN length rule', `src=gv&scope=day&date=${tk}&f=wrong`),
      kpi('g2', 'Expected Today', '🎯', expected != null ? U.fmt(expected) : '—',
        live.weekdayNote ? esc(live.weekdayNote) : 'pichhle same-weekday ka average',
        expectedTodaySpec(), expected != null ? `Expected ${U.fmt(expected)}` : ''),
      kpi('g10', 'Today Highest Issued', '🏆',
        live.highest ? `<div class="hm-highest-list">
          ${[['VC4', 'vc4'], ['VC20', 'vc20'], ['VC5+', 'vc5p']].map(([group, f]) => {
            const best = live.highest[group];
            // Har class ki row apne top issuer ki aaj ki rows kholti hai (pehle card ek nakli filter naam se poora din kholta tha).
            const rowSpec = best && best.n ? ` data-kpi="${esc(`src=gv&scope=day&date=${tk}&f=${f}&agent=${encodeURIComponent(best.name)}${best.id ? `&agentId=${encodeURIComponent(best.id)}` : ''}`)}" data-kpi-title="${esc(`Highest ${group} today · ${best.name}`)}" role="button" tabindex="0" title="${esc(`${best.name} ki aaj ki ${group} rows`)}"` : '';
            return `<div${rowSpec}><span>${group}</span><b>${esc(best ? best.name : '—')}</b><strong>${U.fmt(best ? best.n : 0)}</strong></div>`;
          }).join('')}
        </div>` : '—',
        live.highest ? 'Class-wise highest issuer · Today — row par click = uski rows' : 'GV Master load hone par class-wise highest dikhega',
        `src=gv&scope=day&date=${tk}`)
    ];
    const errorNote = live.error
      ? `<p class="hm-warn">⚠️ GV live feed error: ${esc(live.error)}. Connection / sheet mapping check karo; GV Master refresh hote hi snapshot update hoga.</p>`
      : '';
    const zeroNote = live.total === 0 && !live.error
      ? `<p class="hm-warn">⚠️ Aaj ki rows abhi GV Master sheet me nahi aayi (ya sirf naye tags bank feed me pending hain) — sheet me aate hi ye number apne aap update ho jayega. ↻ Refresh bhi daba sakte ho.</p>`
      : '';
    return card(`🟩 GV · Aaj ka live <span class="dim">· ${esc(U.labelDate(TODAY(), true))} (${esc(U.weekday(TODAY()))}) · ${esc(sourceNote)}</span>`,
      `<div class="kpi-grid mini gv-aaj-grid">${cards.join('')}</div>
       ${errorNote}${zeroNote}
       <p class="dim small" style="margin:10px 0 0">🎯 <b>Expected Today</b> = pichhle 4 same-weekday ka average (pichhla mahina bhi shaamil)${live.weekdayNote ? ` — ${esc(live.weekdayNote)}` : ''}. ⚡ Pace = ab tak ke tags ÷ ab tak ke ghante × 24. Har card par click → kis agent/TL ne lagaye, tag-level rows.</p>`,
      `<a class="btn small" href="#/gvDashboard">🚀 GV Dashboard →</a>`);
  }

  function monthKpiHtml(ctx, sf, sg, sc, lastRows, wrong) {
    const { curKey, prevKey, observedDay, compareDay, daysInMonth } = ctx;
    const reportDay = Math.max(0, observedDay);
    const lastSum = M.summary(lastRows, prevKey, compareDay, '');
    const lastFull = M.summary(lastRows, prevKey);
    const lastTotalFull = lastFull.total;
    // Expected uses only complete/report-available days. Today's live GV row is excluded
    // when FF/EIR is T+1, so today's partial day never inflates the monthly run-rate.
    const reportedRows = (sf.rows || []).filter((r) => r.ym !== curKey || Number(r.day) <= reportDay);
    const reportedSc = M.summary(reportedRows, curKey);
    // Use the same report-cutoff snapshot for totals AND the FF/GV breakdown cards.
    // This prevents live GV / future-dated EIR rows from making card splits exceed MTD totals.
    // 🟦/🟩 Card ke neeche FF / GV split = wahi rows jinse upar ka number (sc) bana — warna 1,323 ke neeche 1,121 + 172 = 1,293 dikhta tha.
    const curFf = M.summary(sf.ff || [], curKey);
    const curGv = M.summary(sf.gv || [], curKey);
    // Expected / Run Rate drawer: report-cutoff tak ka period (aaj ka adhura din shaamil nahi) — card ke formula jaisa.
    const cutKey = reportDay ? `${curKey}-${String(reportDay).padStart(2, '0')}` : '';
    const fcSpec = (view) => (cutKey ? `src=both&scope=range&from=${curKey}-01&to=${cutKey}&view=${view}&eir=1` : `src=both&scope=mtd&ym=${curKey}&eir=1`);
    const rate = observedDay ? reportedSc.total / observedDay : 0;
    const commercialRate = observedDay ? reportedSc.comm / observedDay : 0;
    const expected = observedDay ? Math.round(rate * daysInMonth) : 0;
    const expectedCommercial = observedDay ? Math.round(commercialRate * daysInMonth) : 0;
    // Expected month-end class counts vs the previous full month.
    const expectedByClass = {
      vc4: observedDay ? Math.round((reportedSc.vc4 / observedDay) * daysInMonth) : 0,
      vc20: observedDay ? Math.round((reportedSc.vc20 / observedDay) * daysInMonth) : 0,
      vc5p: observedDay ? Math.round((reportedSc.vc5p / observedDay) * daysInMonth) : 0
    };
    const forecastVsLast = (current, previous) => {
      if (!previous) return '<span class="hm-expected-change flat">— vs last month</span>';
      const pct = ((current - previous) / previous) * 100;
      const state = pct > 0 ? 'pos' : pct < 0 ? 'neg' : 'flat';
      const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '•';
      return `<span class="hm-expected-change ${state}">${arrow} ${Math.abs(pct).toFixed(1)}% vs last month</span>`;
    };
    const expectedClassRow = (label, current, previous) =>
      `<div class="hm-expected-row"><span class="hm-expected-current"><b>${label}</b><strong>${U.fmt(current)}</strong>${forecastVsLast(current, previous)}</span><span class="hm-expected-previous"><small>Last month</small><b>${U.fmt(previous)}</b></span></div>`;
    const lastExpected = lastSum.total ? Math.round((lastSum.total / Math.min(compareDay, U.daysInMonth(prevKey))) * U.daysInMonth(prevKey)) : 0;
    // Kal ka issuance (last complete day) + pichhle mahine ka wahi tareekh
    const y = new Date(TODAY()); y.setDate(y.getDate() - 1);
    const yKey = dayKey(y);
    const yDay = y.getDate();
    const lastDayNow = sumN(sf.rows.filter((r) => r.key === yKey));
    const lastDayPrev = sumN(lastRows.filter((r) => r.ym === prevKey && r.day === Math.min(yDay, U.daysInMonth(prevKey))));
    const yFf = sumN(sf.ff.filter((r) => r.key === yKey));
    const yGv = sumN(sf.gv.filter((r) => r.key === yKey));
    const monthLabel = U.labelYM(curKey, true);
    const prevLabel = U.labelYM(prevKey, true);
    // ⚠️ Wrong VRN = VRN length rules (same as GV today live) on EIR VRN column — FF + GV, class-wise. wrong = {cur, last} | 'loading' | null
    const wrongVrnCard = (() => {
      if (wrong && wrong.cur) {
        const c = wrong.cur, l = wrong.last;
        const tot = c.ff.total + c.gv.total, lt = l ? l.ff.total + l.gv.total : 0;
        const by = { VC4: c.ff.by.VC4 + c.gv.by.VC4, VC20: c.ff.by.VC20 + c.gv.by.VC20, 'VC5+': c.ff.by['VC5+'] + c.gv.by['VC5+'] };
        const chCls = (lab, o) => `<div class="kpi-chrow"><b>${lab}</b> · VC4 <b>${U.fmt(o.by.VC4)}</b> · VC20 <b>${U.fmt(o.by.VC20)}</b> · VC5+ <b>${U.fmt(o.by['VC5+'])}</b></div>`;
        return { value: U.fmt(tot), plain: `${U.fmt(tot)} · FF ${U.fmt(c.ff.total)} · GV ${U.fmt(c.gv.total)} · VC4 ${U.fmt(by.VC4)} · VC20 ${U.fmt(by.VC20)} · VC5+ ${U.fmt(by['VC5+'])}`, foot: `${l ? momChip(tot, lt, `Last month (${new Date(`${prevKey}-01T00:00:00`).toLocaleString('en', { month: 'short' })} 1–${observedDay})`) : ''}<br>${splitFoot(c.ff.total, c.gv.total)}${clsSplit(by)}${chCls('FF', c.ff)}${chCls('GV', c.gv)}` };
      }
      return { value: wrong === 'loading' ? '…' : '—', foot: wrong === 'loading' ? 'Calculating from VRN length rules…' : 'VRN length rule off / data not available' };
    })();
    const spk = (pick, tone) => sparkSvg(dailySeries(sf.rows, curKey, observedDay, pick), tone, curKey);
    const notCore = (r) => r.group !== 'VC4' && r.group !== 'VC20';
    const sparkFor = {
      g1: spk(null, 'tone-total') + progBar(sc.total, expected), g3: spk((r) => (r.group === 'VC4' ? r.n : 0), 'tone-vc4') + progBar(sc.vc4, expectedByClass.vc4), g8: spk((r) => (r.group === 'VC20' ? r.n : 0), 'tone-vc20') + progBar(sc.vc20, expectedByClass.vc20),
      g6: spk((r) => (notCore(r) ? r.n : 0), 'tone-vc5p') + progBar(sc.vc5p, expectedByClass.vc5p), g12: spk((r) => (r.group !== 'VC4' ? r.n : 0), 'tone-comm'),
      g5: spk((r) => (r.type === 'REPLACEMENT' ? r.n : 0), 'tone-repl'), g7: spk((r) => (/chassis/i.test(r.vrnType) ? r.n : 0), 'tone-chassis'),
      'g-red': spk((r) => (/wrong/i.test(r.vrnType) ? r.n : 0), 'tone-wrong')
    };
    const cards = [
      kpi('g9', `Last day · ${U.labelDate(y)}`, '🗓️', U.fmt(lastDayNow),
        `${momChip(lastDayNow, lastDayPrev, `${prevLabel} ${Math.min(yDay, U.daysInMonth(prevKey))}`)}<br>${splitFoot(yFf, yGv)}`,
        `src=both&scope=day&date=${yKey}&eir=1`),
      kpi('g1', `${monthLabel} total (MTD)`, '🏷️', U.fmt(sc.total),
        `${momChip(sc.total, lastSum.total, `${prevLabel} ${observedDay} din`)}<br>${splitFoot(curFf.total, curGv.total)}`,
        `src=both&scope=mtd&ym=${curKey}&eir=1`, undefined, sparkFor.g1),
      kpi('g3', 'VC4', '🚗', U.fmt(sc.vc4), `${momChip(sc.vc4, lastSum.vc4)}<br>${splitFoot(curFf.vc4, curGv.vc4)}`, `src=both&scope=mtd&ym=${curKey}&f=vc4&eir=1`, undefined, sparkFor.g3),
      kpi('g8', 'VC20', '🛻', U.fmt(sc.vc20), `${momChip(sc.vc20, lastSum.vc20)}<br>${splitFoot(curFf.vc20, curGv.vc20)}`, `src=both&scope=mtd&ym=${curKey}&f=vc20&eir=1`, undefined, sparkFor.g8),
      kpi('g6', 'VC5+', '🚚', U.fmt(sc.vc5p), `${momChip(sc.vc5p, lastSum.vc5p)}<br>${splitFoot(curFf.vc5p, curGv.vc5p)}`, `src=both&scope=mtd&ym=${curKey}&f=vc5p&eir=1`, undefined, sparkFor.g6),
      kpi('g12', 'All Commercial · VC20 + VC5+', '🚛', U.fmt(sc.comm), `${momChip(sc.comm, lastSum.comm, `${prevLabel} · same ${Math.min(compareDay, U.daysInMonth(prevKey))} reported din`)}<br>Last month full <b>${U.fmt(lastFull.comm)}</b> · Expected this month <b>${U.fmt(expectedCommercial)}</b> <span class="dim">(report till ${observedDay ? esc(U.labelDateKey(`${curKey}-${String(observedDay).padStart(2,'0')}`)) : '—'})</span>`, `src=both&scope=mtd&ym=${curKey}&f=comm&eir=1`, undefined, sparkFor.g12),
      kpi('g5', 'Replacement', '🔁', U.fmt(sc.replacement), `${momChip(sc.replacement, lastSum.replacement)}<br>${splitFoot(curFf.replacement, curGv.replacement)}${clsSplit(sc.replacementBy)}`, `src=both&scope=mtd&ym=${curKey}&f=repl&eir=1`, undefined, sparkFor.g5),
      kpi('g7', 'Chassis', '🔧', U.fmt(sc.chassis), `${momChip(sc.chassis, lastSum.chassis)}<br>${splitFoot(curFf.chassis, curGv.chassis)}${clsSplit(sc.chassisBy)}`, `src=both&scope=mtd&ym=${curKey}&f=chassis&eir=1`, undefined, sparkFor.g7),
      kpi('g-red', 'Wrong VRN', '⚠️', wrongVrnCard.value, wrongVrnCard.foot, `src=both&scope=mtd&ym=${curKey}&f=wrong&eir=1`, wrongVrnCard.plain, sparkFor['g-red']),
      kpi('g2', `Expected in ${U.labelYM(curKey)}`, '🎯',
        `<div class="hm-expected-compare">${expectedClassRow('VC4', expectedByClass.vc4, lastFull.vc4)}${expectedClassRow('VC20', expectedByClass.vc20, lastFull.vc20)}${expectedClassRow('VC5+', expectedByClass.vc5p, lastFull.vc5p)}<div class="hm-expected-total"><span>Total Expected</span><b>${U.fmt(expected)}</b></div></div>`,
        `EIR forecast · ${observedDay}/${daysInMonth} reported days · today excluded<br><span class="dim">Report till <b>${observedDay ? esc(U.labelDateKey(`${curKey}-${String(observedDay).padStart(2,'0')}`)) : '—'}</b> · last month full <b>${U.fmt(lastTotalFull)}</b> · expected <b>${U.fmt(lastExpected)}</b></span>`,
        fcSpec('expected'), `Expected ${U.fmt(expected)}`),
      kpi('g13', 'Run Rate · Per Day', '⚡',
        `<div class="hm-runrate-list"><div><span>VC4</span><b>${U.fmt(observedDay ? reportedSc.vc4 / observedDay : 0, true)}</b></div><div><span>VC20</span><b>${U.fmt(observedDay ? reportedSc.vc20 / observedDay : 0, true)}</b></div><div><span>VC5+</span><b>${U.fmt(observedDay ? reportedSc.vc5p / observedDay : 0, true)}</b></div><div class="is-total"><span>Total Run Rate</span><b>${U.fmt(rate, true)}</b></div></div>`,
        `Daily average · EIR till ${esc(ctx.receivedDate ? U.labelDate(ctx.receivedDate, true) : '—')} · 1 day lag`,
        fcSpec('runrate'), `${U.fmt(rate, true)} / day`)
    ];
    // 📸 Snapshot strip — last report day + MTD + expected + run-rate ek line me.
    const snapHtml = `<div class="hm-snap" aria-label="Snapshot"><span class="hm-snap-i">🗓️ Last report <b>${esc(U.labelDate(y, true))}</b> · <b>${U.fmt(lastDayNow)}</b> <small class="dim">(FF ${U.fmt(yFf)} · GV ${U.fmt(yGv)})</small></span><span class="hm-snap-i">🏷️ MTD <b>${U.fmt(sc.total)}</b></span><span class="hm-snap-i">🎯 Expected <b>${U.fmt(expected)}</b></span><span class="hm-snap-i">⚡ Run rate <b>${U.fmt(rate, true)}</b>/din</span><span class="hm-snap-i">📅 Report till <b>${observedDay ? esc(U.labelDateKey(`${curKey}-${String(observedDay).padStart(2, '0')}`)) : '—'}</b></span></div>`;
    return card(`📅 ${esc(monthLabel)} · KPI cards <span class="dim">· issuance from the EIR sheet only (GV = master ID ${esc(FF.config.eir.gvMasterId || '5845036')} rows, everything else FF) · last month vs this month + %</span>`,
      `${snapHtml}<div class="kpi-grid mini hm-month-grid">${cards.join('')}</div>`,
      `<a class="btn small" href="#/tagIssued?period=month">🏷️ Tag Issued →</a><a class="btn small" href="#/trend">📈 Trend →</a>`);
  }

  // 🎯 Class-wise target achievement. Actual counts are scoped to agents who have a target for that class.
  const TARGET_CLASSES = [{ key: 'vc4', label: 'VC4', group: 'VC4', icon: '🚗', color: 'g3', gvField: 'vc4' }, { key: 'vc20', label: 'VC20', group: 'VC20', icon: '🛻', color: 'g8', gvField: 'vc20' }, { key: 'vc5p', label: 'VC5+', group: 'VC5+', icon: '🚚', color: 'g6', gvField: 'vc5p' }];
  const targetAgentKey = (source, name) => `${source}|${U.clean(name).toUpperCase().replace(/\s+/g, ' ')}`;
  const targetSource = (t) => { const raw = String(t && t.source || String(t && t.key || '').split('|')[0]).toLowerCase(); return /gv/.test(raw) ? 'gv' : 'ff'; };
  const classTargetsConfigured = (t) => TARGET_CLASSES.some((c) => Number(t && t.classTargets && t.classTargets[c.key]) > 0);
  function targetAchievementSummary(targets, ym, ffClassRows, gvAgentRows, allowedChannels) {
    const allowed = new Set(allowedChannels || ['ff', 'gv']);
    const stats = Object.fromEntries(TARGET_CLASSES.map((c) => [c.key, { key: c.key, label: c.label, icon: c.icon, target: 0, issued: 0, remaining: 0, pct: null }]));
    const eligible = Object.fromEntries(TARGET_CLASSES.map((c) => [c.key, new Set()]));
    for (const t of targets || []) {
      if (!t || t.ym !== ym) continue;
      const source = targetSource(t); if (!allowed.has(source)) continue;
      const name = t.agent || String(t.key || '').split('|').slice(1).join('|');
      const key = targetAgentKey(source, name);
      for (const c of TARGET_CLASSES) {
        const target = Math.max(0, Number(t.classTargets && t.classTargets[c.key]) || 0);
        if (!target) continue;
        stats[c.key].target += target; eligible[c.key].add(key);
      }
    }
    const add = (source, name, group, value) => {
      const cls = TARGET_CLASSES.find((c) => c.group === String(group || '').toUpperCase());
      if (!cls || !eligible[cls.key].has(targetAgentKey(source, name))) return;
      stats[cls.key].issued += Math.max(0, Number(value) || 0);
    };
    for (const row of ffClassRows || []) {
      if (!row || row.ym !== ym || String(row.channel || '').toLowerCase() !== 'first forward') continue;
      add('ff', row.name || row.agentName, row.group, row.n);
    }
    for (const row of gvAgentRows || []) {
      if (!row) continue;
      add('gv', row.agentName || row.name, 'VC4', row.vc4);
      add('gv', row.agentName || row.name, 'VC20', row.vc20);
      add('gv', row.agentName || row.name, 'VC5+', row.vc5p);
    }
    for (const c of TARGET_CLASSES) {
      const row = stats[c.key]; row.remaining = Math.max(0, row.target - row.issued);
      row.pct = row.target > 0 ? (row.issued / row.target) * 100 : null;
    }
    const totalTarget = TARGET_CLASSES.reduce((sum, c) => sum + stats[c.key].target, 0);
    const totalIssued = TARGET_CLASSES.reduce((sum, c) => sum + stats[c.key].issued, 0);
    return { classes: stats, totalTarget, totalIssued, totalRemaining: TARGET_CLASSES.reduce((sum, c) => sum + stats[c.key].remaining, 0), totalPct: totalTarget > 0 ? (totalIssued / totalTarget) * 100 : null, configured: totalTarget > 0 };
  }
  function targetAchievementHtml(summary, ym) {
    const metric = (cls, title, icon, row) => kpi(cls, title, icon, row.pct === null ? '—' : `${Math.round(row.pct)}%`,
      row.target > 0 ? `Target <b>${U.fmt(row.target)}</b> · Issued <b>${U.fmt(row.issued)}</b><br>Remaining <b>${U.fmt(row.remaining)}</b>` : 'Class-wise target set nahi hai');
    if (!summary || !summary.configured) return card('🎯 Target Achievement · VC4 / VC20 / VC5+',
      '<div class="hm-target-empty"><b>Class-wise targets abhi set nahi hain.</b><p>Agent Targets page par VC4, VC20 aur VC5+ ke targets save karo. Purana overall target alag se preserve rahega.</p><a class="btn small primary" href="#/targets">🎯 Set class-wise targets</a></div>', '');
    const cards = TARGET_CLASSES.map((c) => metric(c.color, `${c.label} Achievement`, c.icon, summary.classes[c.key])).join('');
    const total = { target: summary.totalTarget, issued: summary.totalIssued, remaining: summary.totalRemaining, pct: summary.totalPct };
    return card(`🎯 Target Achievement <span class="dim">· ${esc(U.labelYM(ym, true))}</span>`,
      `<div class="kpi-grid mini hm-target-grid">${cards}${metric('g1', 'Total Achievement', '🏆', total)}</div><p class="dim small hm-target-note">Issued count sirf un agents ka hai jinke us class ke liye target set hain. Actual class counts existing EIR / GV Master data se calculate hote hain; extra target API call nahi hoti.</p>`,
      '<a class="btn small" href="#/targets">⚙️ Manage targets →</a>');
  }

  // ---------------------------------------------------------------- management pulse (uses already-loaded data; no extra API call)
  function managementPulseHtml(ctx, sf, liveState, stock) {
    const reportDay = Math.max(1, Number(ctx && ctx.observedDay) || 1);
    const dim = Number(ctx && ctx.daysInMonth) || 30;
    const rows = (sf && sf.rows) || [];
    const reportedRows = rows.filter((r) => r.ym !== (ctx && ctx.curKey) || Number(r.day) <= reportDay);
    const total = sumN(reportedRows);
    const expected = reportDay ? Math.round((total / reportDay) * dim) : 0;
    const live = Number(liveState && liveState.total) || 0;
    const stockTotal = Number(stock && stock.total) || 0;
    const stockRate = reportDay ? total / reportDay : 0;
    const cover = stockRate > 0 ? (stockTotal / stockRate) : null;
    const fresh = liveState && liveState.stale ? '⚠️ Live snapshot stale' : liveState && liveState.error ? '⚠️ Live feed needs check' : '🟢 Live feed healthy';
    const coverText = cover == null ? '—' : U.fmt(cover, true) + ' days';
    return card('🧭 Management Pulse <span class="dim">· existing data se · extra API call nahi</span>',
      '<div class="hm-pulse-grid">' +
      '<div class="hm-pulse-item"><span>🟢 Live today</span><b>' + U.fmt(live) + '</b><small>' + esc(fresh) + '</small></div>' +
      '<div class="hm-pulse-item"><span>🎯 Month expected</span><b>' + U.fmt(expected) + '</b><small>' + reportDay + '/' + dim + ' reported days · current day excluded</small></div>' +
      '<div class="hm-pulse-item"><span>📦 Stock cover</span><b>' + esc(coverText) + '</b><small>' + U.fmt(stockTotal) + ' total stock · run-rate basis</small></div>' +
      '<div class="hm-pulse-actions"><a class="btn small primary" href="#/performance">🏆 Performance</a><a class="btn small" href="#/stock">📦 Stock</a><a class="btn small" href="#/dispatchPlan">🚚 Dispatch</a><a class="btn small" href="#/dataQuality">🧪 Data Quality</a></div>' +
      '</div>');
  }

  // ---------------------------------------------------------------- charts
  function monthCharts(ctx, sf, sc, lastRows, gvLive) {
    const { curKey, prevKey, observedDay } = ctx;
    const cur = M.dailySeries(sf.rows, curKey);
    const prev = M.dailySeries(lastRows, prevKey);
    const labels = cur.days.length ? cur.days.map(String) : ['1'];
    const curVals = cur.totals;
    const prevVals = prev.totals.slice(0, labels.length);
    const line = C.lines({
      labels,
      height: 230,
      series: [
        { name: `${U.labelYM(curKey)} (is mahine)`, values: curVals, color: '#6366f1' },
        { name: `${U.labelYM(prevKey)} (last month)`, values: prevVals, color: '#c7d2fe', dash: true, area: false }
      ]
    });
    const lastSum = M.summary(lastRows, prevKey, observedDay, '');
    const cmp = C.bars({
      labels: ['VC4', 'VC20', 'VC5+', 'Replacement', 'Chassis'],
      height: 210,
      series: [
        { name: U.labelYM(curKey), values: [sc.vc4, sc.vc20, sc.vc5p, sc.replacement, sc.chassis], color: '#6366f1' },
        { name: `${U.labelYM(prevKey)} (till day ${observedDay})`, values: [lastSum.vc4, lastSum.vc20, lastSum.vc5p, lastSum.replacement, lastSum.chassis], color: '#0d9488' }
      ],
      legendAlways: true
    });
    const donut = C.donut({ items: [{ label: 'VC4', value: sc.vc4 }, { label: 'VC20', value: sc.vc20 }, { label: 'VC5+', value: sc.vc5p }], subtitle: U.labelYM(curKey, true) });
    // same-weekday run-rate (GV) — Expected Today ka basis
    const wdSeries = gvLive && gvLive.weekdayBars ? gvLive.weekdayBars : null;
    const wdChart = wdSeries && wdSeries.labels.length
      ? C.bars({ labels: wdSeries.labels, height: 190, series: [{ name: 'GV same-weekday', values: wdSeries.values, color: '#0d9488' }] })
      : '';
    return `<div class="grid g-2">
        ${card(`📈 ${esc(U.labelYM(curKey, true))} vs ${esc(U.labelYM(prevKey, true))} <span class="dim">· daily issuance (FF + GV, EIR)</span>`, line, '')}
        ${card('🍩 Class mix (MTD)', donut, '')}
      </div>
      <div class="grid g-2">
        ${card('📊 Month-to-date · last vs current', cmp, '')}
        ${wdChart ? card(`🎯 GV same-weekday run-rate <span class="dim">· Expected Today isi se</span>`, wdChart, '') : ''}
      </div>`;
  }

  function stockHtml(ffStock, gvStock, sf) {
    const ff = ffStock || { total: 0, vc4: 0, comm: 0, rows: [] };
    const gv = gvStock || { total: 0, vc4: 0, comm: 0, rows: [] };
    const ffRate = M.summary(sf.ff, U.ymKey(TODAY())).avgPerDay || 0;
    const gvRate = M.summary(sf.gv, U.ymKey(TODAY())).avgPerDay || 0;
    const cover = (total, rate) => (rate > 0 ? U.fmt(total / rate, true) : '—');
    const bars = C.bars({
      labels: ['VC4', 'Commercial'],
      height: 190,
      series: [
        { name: 'First Forward · StockDataa', values: [ff.vc4, ff.comm], color: '#6366f1' },
        { name: 'GV Partner · Tag Assignment', values: [gv.vc4, gv.comm], color: '#0d9488' }
      ],
      legendAlways: true
    });
    const ffDonut = C.donut({ items: [{ label: 'VC4', value: ff.vc4 }, { label: 'Commercial', value: ff.comm }], subtitle: 'FF stock' });
    const gvDonut = C.donut({ items: [{ label: 'VC4', value: gv.vc4 }, { label: 'Commercial', value: gv.comm }], subtitle: 'GV stock' });
    const topList = (rows, cls) => {
      const list = (rows || []).slice(0, 5);
      if (!list.length) return '<p class="dim small">Koi stock row nahi mili.</p>';
      return `<div class="hm-toplist">${list.map((r, i) => `<div class="hm-toprow"><span class="rank">${i + 1}</span><b>${esc(r.name)}</b><span class="tag ${cls}">${cls === 'gv' ? 'GV' : 'FF'}</span><strong>${U.fmt(r.n)}</strong></div>`).join('')}</div>`;
    };
    return `<div class="kpi-grid mini hm-stock-grid">
        ${kpi('g1', 'First Forward · Stock in field', '📦', U.fmt(ff.total), `VC4 <b>${U.fmt(ff.vc4)}</b> · Comm <b>${U.fmt(ff.comm)}</b> · cover <b>${esc(cover(ff.total, ffRate))}</b> din`, 'src=ff&scope=stock')}
        ${kpi('g2', 'GV Partner · Stock in field', '📦', U.fmt(gv.total), `VC4 <b>${U.fmt(gv.vc4)}</b> · Comm <b>${U.fmt(gv.comm)}</b> · cover <b>${esc(cover(gv.total, gvRate))}</b> din`, 'src=gv&scope=stock')}
      </div>
      <div class="grid g-2" style="margin-top:12px">
        ${card('📊 Stock · FF vs GV <span class="dim">(class-wise)</span>', bars, '')}
        ${card('🍩 Stock split', `<div class="hm-donuts">${ffDonut}${gvDonut}</div>`, '')}
      </div>
      <div class="grid g-2">
        ${card('🟦 First Forward · top stock holders <span class="dim">· StockDataa</span>', topList(ff.rows, 'ff'), '<a class="btn small" href="#/stock">📦 Stock →</a>')}
        ${card('🟩 GV Partner · top stock holders <span class="dim">· Tag Assignment</span>', topList(gv.rows, 'gv'), '<a class="btn small" href="#/gvStock">📦 GV Stock →</a>')}
      </div>`;
  }

  // ---------------------------------------------------------------- render
  // renderCtx.bootGate (app.js splash): true ho to render apne SAARE sections ke data paint karne
  // ke baad hi resolve hota hai — "Opening your workspace" animation hatate hi Home poora bhara dikhe.

  // ===== 🕒 v178 — Sheets ka "last data update" (GV Master · Tag Assignment · EIR · StockDataa) =====
  // Sheet ka asli "last edited" Google se gviz me nahi milta; isliye har sheet ke sabse naye record ka
  // date + time dikhate hain (EIR: issue date · StockDataa: allocation time · GV Master: date + time
  // column · Tag Assignment: allocation/date column). Time column na ho to sirf date aur saaf note.
  const freshness = (() => {
    let memo = null, memoAt = 0, inflight = null;
    const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    function fromParts(y, mo, d, hh, mi, ss, hasTimeHint) {
      const dt = new Date(+y, +mo, +d, +(hh || 0), +(mi || 0), +(ss || 0));
      if (isNaN(dt)) return null;
      return { d: dt, hasTime: hasTimeHint !== undefined ? hasTimeHint : !!(+hh || +mi || +ss) };
    }
    function parseText(str) {
      const t = String(str == null ? '' : str).trim();
      if (!t) return null;
      let m = t.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})(?:,(\d{1,2}),(\d{1,2})(?:,(\d{1,2}))?)?/);
      if (m) return fromParts(m[1], m[2], m[3], m[4], m[5], m[6]);
      m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
      if (m) return fromParts(m[1], +m[2] - 1, m[3], m[4], m[5], m[6]);
      m = t.match(/^(\d{1,2})[-/. ](\d{1,2}|[A-Za-z]{3,9})[-/. ,]+(\d{2,4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?/);
      if (m) {
        let mo = /^\d+$/.test(m[2]) ? +m[2] - 1 : MONTHS[m[2].slice(0, 3).toLowerCase()];
        if (mo === undefined || isNaN(mo)) return null;
        let y = +m[3]; if (y < 100) y += 2000;
        let hh = +(m[4] || 0); const ap = (m[7] || '').toLowerCase();
        if (ap === 'pm' && hh < 12) hh += 12; if (ap === 'am' && hh === 12) hh = 0;
        return fromParts(y, mo, m[1], hh, m[5], m[6], m[4] !== undefined);
      }
      return null;
    }
    const cellDT = (cell) => (!cell || cell.v == null || cell.v === '' ? null : (parseText(cell.v) || parseText(cell.f)));
    const timeOfDay = (v) => {   // "14:32:10" / "2:32 PM" / gviz Date(1899,11,30,14,32,10)
      const t = String(v == null ? '' : v).trim();
      let m = t.match(/^Date\(\d+,\d+,\d+,(\d{1,2}),(\d{1,2})(?:,(\d{1,2}))?/);
      if (!m) m = t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?/);
      if (!m) return null;
      let hh = +m[1]; const ap = (m[4] || '').toLowerCase();
      if (ap === 'pm' && hh < 12) hh += 12; if (ap === 'am' && hh === 12) hh = 0;
      return hh * 3600 + (+m[2]) * 60 + (+(m[3] || 0));
    };
    const later = (a, b) => (a && (!b || a.d > b.d) ? a : b);
    async function maxOf(sheet, letters) {
      let best = null;
      const t = await D().query(sheet, `select ${letters.map((l) => `max(${l})`).join(', ')}`, { fresh: true });
      const row = (t.rows || [])[0] || [];
      let textCol = false;
      row.forEach((c) => { best = later(cellDT(c), best); if (c && c.v != null && !/^Date\(/.test(String(c.v))) textCol = true; });
      // 🛡️ v220 — text dates ("31/12/2025 …") ka max() alphabet ke hisab se hota hai = galat. Aisa column ho to aakhri 400 rows se asli max nikalo.
      if (textCol) {
        try {
          const k = await D().query(sheet, `select count(${letters[0]})`, { fresh: true });
          const n = Number((((k.rows || [])[0] || [])[0] || {}).v) || 0;
          if (n) {
            const tail = await D().query(sheet, `select ${letters.join(', ')} offset ${Math.max(0, n - 400)}`, { fresh: true });
            let tb = null;
            (tail.rows || []).forEach((r) => (r || []).forEach((c) => { const x = cellDT(c); if (x && x.d.getFullYear() >= 2015 && x.d.getTime() <= Date.now() + 36 * 3600e3) tb = later(x, tb); }));
            if (tb) return tb;
          }
        } catch { /* max() par hi rehne do */ }
      }
      return best;
    }
    const D = () => FF.data;
    // ---- Apps Script (sheetmeta): last filled row + Drive edit history — sabse sahi source ----
    const plausible = (x) => x && x.d && x.d.getFullYear() >= 2015 && x.d.getTime() <= Date.now() + 36 * 3600e3;
    const HDR_RX = /time|date|(^|[^a-z])at([^a-z]|$)|allocat|issue|created|updated/i;
    function rowTimeOf(cells) {
      let best = null, bestScore = -1;
      (cells || []).forEach((c) => {
        const x = parseText(c.v);
        if (!plausible(x)) return;
        const score = (HDR_RX.test(c.h || '') ? 2 : 0) + (x.hasTime ? 1 : 0);
        if (score > bestScore || (score === bestScore && best && x.d > best.d)) { best = { ...x, col: c.h || '' }; bestScore = score; }
      });
      // GV Master jaisi sheets: DATE aur TIME alag columns me → dono jod do
      if (best && !best.hasTime) {
        const tc = (cells || []).find((c) => /time/i.test(c.h || '') && /^\d{1,2}:\d{2}/.test(String(c.v || '').trim()));
        const sec = tc ? timeOfDay(tc.v) : null;
        if (sec != null) {
          const d = new Date(best.d.getFullYear(), best.d.getMonth(), best.d.getDate(), 0, 0, sec);
          best = { d, hasTime: true, col: `${best.col} + ${tc.h}` };
        }
      }
      return best;
    }
    async function serverCompute() {
      const cfgE = FF.config.eir, cfgS = FF.config.stock, gvc = FF.config.gv || {};
      const tabOf = (n) => { const t = FF.config.sheetByName && FF.config.sheetByName(n); return (t && t.tab) || n; };
      const items = [
        { key: 'ff-eir', source: 'ff', tab: tabOf(cfgE.sheet), keyCol: cfgE.tagId || 'A' },
        { key: 'ff-stock', source: 'ff', tab: tabOf(cfgS.sheet), keyCol: cfgS.tagId || 'C' },
        { key: 'gv-master', source: 'gv', tab: tabOf('GV Master'), keyCol: (gvc.master && gvc.master.tagId) || 'I' },
        // Tag Assignment me date/time column hai hi nahi → Apps Script har check par tag/status/agent columns ka fingerprint
        // mila kar "content kab badla" yaad rakhta hai (file-level edit time GV Master ke saath shared hota hai, isliye wo galat padta).
        { key: 'gv-assign', source: 'gv', tab: tabOf('Tag Assignment'), keyCol: (gvc.assignment && gvc.assignment.tagId) || 'B', sigCols: [(gvc.assignment && gvc.assignment.status) || 'D', (gvc.assignment && gvc.assignment.agentId) || 'E'] }
      ];
      const res = await fetch('/api/sheet-freshness', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'FF-Dashboard' }, body: JSON.stringify({ items }) });
      let json = {}; try { json = await res.json(); } catch { /* ignore */ }
      if (!res.ok || !json.ok) throw new Error(json.unavailable || json.error || `HTTP ${res.status}`);
      const parseFile = (f) => { const x = f && f.updated ? parseText(f.updated) : null; return { updated: plausible(x) ? x : null, by: (f && f.by) || '', error: (f && (f.error || f.note)) || '', revisions: ((f && f.revisions) || []).map((r) => ({ at: parseText(r.time), by: r.by })).filter((r) => plausible(r.at)) }; };
      const meta = [['ff-eir', '🟦', 'First Forward', 'EIR', 'ff'], ['ff-stock', '🟦', 'First Forward', 'StockDataa', 'ff'], ['gv-master', '🟩', 'GV Partner', 'GV Master', 'gv'], ['gv-assign', '🟩', 'GV Partner', 'Tag Assignment', 'gv']];
      return meta.map(([key, icon, title, tabName, src]) => {
        const t = (json.tabs || {})[key] || {};
        const file = parseFile((json.files || {})[src]);
        const rowTime = t.cells ? rowTimeOf(t.cells) : null;
        // 🕒 v209 — nayi rows aayi (purani date ki ho tab bhi) = server ka row-count change time; pehli baar → file ka last edit
        const tracked = t.trackedMs ? { d: new Date(t.trackedMs), hasTime: true, col: 'change tracking', tracked: true } : null;
        const tracking = !!(t.trackBaseline && !tracked);   // pehli baar dekha: asli time agle badlav par dikhega
        const changed = tracked || (t.changedMs ? { d: new Date(t.changedMs), hasTime: true, col: 'new rows' } : (t.changedMs === 0 && !t.trackBaseline && t.trackedMs === undefined ? file.updated : null));
        // 📥 v211 — IMPORT_LOG (import script ka asli run time) mile to wahi final
        const imp = t.importAt ? parseText(t.importAt) : null;
        if (plausible(imp)) { const x = { ...imp, hasTime: true, col: String(t.importFrom || 'import log').toLowerCase().replace(/_/g, ' '), imported: true }; return { key, icon, title, tab: tabName, exact: true, value: x, rowTime: x, importAt: x, file, lastRow: t.lastRow || 0, totalRows: t.totalRows || 0, err: t.error || '' }; }
        const value = later(rowTime, changed) || (tracking ? null : file.updated) || null;
        return { key, icon, title, tab: tabName, exact: true, value, tracking, rowTime: later(rowTime, changed), file, lastRow: t.lastRow || 0, totalRows: t.totalRows || 0, err: t.error || '' };
      });
    }
    async function gvizCompute() {
      const cfgE = FF.config.eir, cfgS = FF.config.stock;
      const out = [];
      const add = (key, icon, title, tab, fn, note) => out.push({ key, icon, title, tab, run: fn, note });
      add('ff-eir', '🟦', 'First Forward', 'EIR', async () => {
        try { const v = await maxOf(cfgE.sheet, [cfgE.date]); if (v) return v; } catch { /* loaded data se fallback */ }
        const daily = S.get && S.get('daily');
        const last = Array.isArray(daily) && M.latestDate ? M.latestDate(daily) : null;
        return last ? { d: last, hasTime: false } : null;
      }, 'Sabse naya issue date (EIR)');
      add('ff-stock', '🟦', 'First Forward', 'StockDataa', async () => maxOf(cfgS.sheet, [cfgS.bcAllocatedAt, cfgS.agentAllocatedAt].filter(Boolean)), 'Sabse nayi tag / agent allocation');
      add('gv-master', '🟩', 'GV Partner', 'GV Master', async () => {
        const G = FF.gv;
        try { if (G && G.need) await G.need('master'); } catch { /* sheet load fail */ }
        const rows = G && G.rows ? G.rows() : [];
        let best = null;
        for (const r of rows) {
          if (!r.date) continue;
          if (best && r.date < best.date) continue;
          const sec = timeOfDay(r.time);
          const cand = { date: r.date, sec };
          if (!best || r.date > best.date || (sec != null && (best.sec == null || sec > best.sec))) best = cand;
        }
        if (!best) return null;
        const dt = new Date(best.date.getFullYear(), best.date.getMonth(), best.date.getDate(), 0, 0, best.sec || 0);
        return { d: dt, hasTime: best.sec != null };
      }, 'Sabse naya issuance (date + time column)');
      add('gv-assign', '🟩', 'GV Partner', 'Tag Assignment', async () => {
        const G = FF.gv; if (G && G.ensureAssignmentMap) { try { await G.ensureAssignmentMap({}); } catch { /* optional */ } }
        const labels = (G && G.labels && G.labels.assignment) || [];
        const idx = labels.findIndex((l) => /allocat|assign.*(date|time|at)|updated|modified|(^|[^a-z])(date|time)([^a-z]|$)/i.test(String(l || '')));
        if (idx < 0) return { none: true };
        return maxOf('Tag Assignment', [FF.util.colLetter(idx)]);
      }, 'Sabse nayi allocation / date column');
      const res = await Promise.all(out.map(async (x) => {
        let v = null, err = '';
        try { v = await x.run(); } catch (e) { err = String((e && e.message) || e); }
        return { key: x.key, icon: x.icon, title: x.title, tab: x.tab, note: x.note, value: v && !v.none ? v : null, noCol: !!(v && v.none), err };
      }));
      return res;
    }
    const KEYS = ['ff-eir', 'ff-stock', 'gv-master', 'gv-assign'];
    /** Server (Apps Script last-row) + poore column ka MAX (gviz) — jo bhi LATER ho wahi "last update".
     *  Last row hamesha sabse naya nahi hoti (unsorted / backfilled rows), column max kabhi galat nahi hota. */
    function mergeList(server, g, svErr) {
      return KEYS.map((key) => {
        const sv = server && server.find((x) => x.key === key);
        const gv = (g || []).find((x) => x.key === key);
        const base = sv || gv || { key };
        const best = sv && sv.importAt ? sv.importAt : later(sv && sv.rowTime, gv && gv.value);
        const value = best || (sv && sv.value) || null;
        const fromCol = !!(best && gv && gv.value && best === gv.value);
        const out = { ...base, value, colMax: fromCol, approx: !sv, svErr: sv ? '' : svErr };
        if (gv) { out.tab = out.tab || gv.tab; out.note = out.note || gv.note; out.noCol = !value && !!gv.noCol; if (!out.err) out.err = gv.err || ''; }
        return out;
      });
    }
    async function compute(onPartial) {
      const gP = gvizCompute().catch(() => []);
      const sP = serverCompute().then((list) => ({ list }), (e) => ({ err: String((e && e.message) || e) }));
      const g = await gP;
      // v220 — gviz ka andaza pehle nahi dikhate (galat ho sakta hai); pakka server data aate hi dikhate hain
      const s = await sP;
      return mergeList(s.list || null, g, s.err || '');
    }
    /** Update "nahi aaya" = date-only sheet ka latest data kal se purana, ya time wali sheet 24 ghante se purani. */
    const isStaleVal = (x) => !!(x && x.d && (x.hasTime ? (Date.now() - x.d.getTime()) / 3600000 > 24 : dayDiff(x.d) >= 2));
    const dayDiff = (dt) => { const a = new Date(); a.setHours(0, 0, 0, 0); const b = new Date(dt); b.setHours(0, 0, 0, 0); return Math.round((a - b) / 86400000); };
    function ago(x) {
      if (!x.hasTime) { const n = dayDiff(x.d); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`; }
      const mins = Math.max(0, Math.round((Date.now() - x.d.getTime()) / 60000));
      if (mins < 1) return 'just now';
      if (mins < 60) return `${mins} min ago`;
      const h = Math.floor(mins / 60);
      if (h < 48) return `${h} h${mins % 60 ? ` ${mins % 60} min` : ''} ago`;
      return `${Math.floor(h / 24)} days ago`;
    }
    function tone(x) {
      if (!x.hasTime) { const n = dayDiff(x.d); return n <= 1 ? 'ok' : n <= 3 ? 'warn' : 'bad'; }
      const h = (Date.now() - x.d.getTime()) / 3600000; return h <= 6 ? 'ok' : h <= 30 ? 'warn' : 'bad';
    }
    const fmtDT = (x) => x.d.toLocaleString('en-IN', x.hasTime ? { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true } : { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
    /** Time kahan se aaya — saaf English line (card par dikhta hai, tooltip me nahi chhupta). */
    function sourceLine(r) {
      const v = r.value; if (!v) return '';
      const how = v.imported ? 'Import log time' : v.tracked ? 'Detected by change tracking (checked about every 15 min)' : v.col === 'new rows' ? 'Detected when new rows arrived' : v.col ? `From column: ${v.col}` : 'From the latest row';
      return `${how}${r.lastRow ? ` · last row #${U.fmt(r.lastRow)}` : ''}`;
    }
    function html(list, loading) {
      const rows = list.map((r) => {
        let val;
        if (!r.value) val = r.tracking ? '<span class="dim">Change tracking started — exact time appears after the next update</span>' : r.noCol ? '<span class="dim">No date/time column in this sheet</span>' : `<span class="dim" title="${esc(r.err || '')}">${loading ? 'checking…' : (r.err ? 'could not read' : '—')}</span>`;
        else val = `<b>${esc(fmtDT(r.value))}</b>${r.value.hasTime ? '' : ' <small class="dim">(date only)</small>'}`;
        const pill = r.value ? `<span class="fresh-pill ${tone(r.value)}">${esc(ago(r.value))}</span>` : '';
        // 🟢 v228 — tech notes ki jagah ek saaf status line; poori detail row ke tooltip me
        const tips = [];
        if (r.lastRow) tips.push(`Last filled row #${U.fmt(r.lastRow)}`);
        if (r.rowTime) tips.push(`Row time: ${fmtDT(r.rowTime)}`);
        if (r.file && r.file.updated) tips.push(`Sheet file last edit: ${fmtDT(r.file.updated)}${r.file.by ? ` · ${r.file.by}` : ''}`);
        if (r.value && r.value.imported) tips.push('Source: import log');
        const tn = r.value ? tone(r.value) : '';
        const status = !r.value ? (loading ? '' : ((r.noCol || r.tracking) ? '' : '<span class="fresh-status bad">✕ Could not read this sheet</span>'))
          : tn === 'ok' ? `<span class="fresh-status ok">✓ Up to date — ${esc(ago(r.value))}</span>`
            : tn === 'warn' ? `<span class="fresh-status warn">⚠ A bit old — ${esc(ago(r.value))}</span>`
              : `<span class="fresh-status bad">⚠ Old data — ${esc(ago(r.value))}. Check the import.</span>`;
        const srcTxt = sourceLine(r);
        const extra = (status || srcTxt) ? `<div class="fresh-extra">${srcTxt ? `<small class="dim fresh-how">${esc(srcTxt)}</small>` : ''}${status}</div>` : '';
        const titleAttr = tips.length ? ` title="${esc(tips.join('\n'))}"` : '';
        return `<div class="fresh-row"${titleAttr}><div class="fresh-src"><span class="fresh-ic">${r.icon}</span><div><b>${esc(r.tab)}</b><small class="dim">${esc(r.title)}${r.note ? ' · ' + esc(r.note) : ''}</small></div></div><div class="fresh-val">${val}${pill}</div>${extra}</div>`;
      }).join('');
      return `<section class="card fresh-card"><div class="card-head"><div><h3>🕒 Sheets — last data update</h3><p class="dim small">When each sheet last received data. Site loaded this data at <b>${esc(U.timeLabel(S.loadedAt || G.loadedAt || Date.now()))}</b></p></div><div class="head-actions"><button class="btn small" data-fresh-refresh="1">↻ Check again</button></div></div><div class="card-body fresh-grid">${rows}</div></section>`;
    }
    const DISMISS_KEY = 'ff_fresh_alert_dismiss';
    // 🛡️ v217 — alert sirf pakke (server / import-log) data par; gviz column-max (text dates ka max galat ho sakta hai) par nahi
    const isAlertStale = (r) => !r.approx && isStaleVal(r.value);
    const staleSig = (list) => list.filter(isAlertStale).map((r) => `${r.key}:${r.value.d.getTime()}`).join('|');
    function alertHtml(list) {
      const stale = list.filter(isAlertStale);
      if (!stale.length) return '';
      const sig = staleSig(list);
      try { const d = JSON.parse(localStorage.getItem(DISMISS_KEY) || 'null'); if (d && d.sig === sig && Date.now() - d.at < 3 * 3600e3) return ''; } catch { /* ignore */ }
      const li = stale.map((r) => `<li><b>${esc(r.icon)} ${esc(r.tab)}</b> <span class="dim">(${esc(r.title)})</span> — last data: <b>${esc(fmtDT(r.value))}</b> · <span class="fresh-pill bad">${esc(ago(r.value))}</span></li>`).join('');
      return `<div class="fresh-alert" role="alert" data-fresh-sig="${esc(sig)}"><div class="fresh-alert-ic">⚠️</div>
        <div class="fresh-alert-body"><b>${stale.length === 1 ? 'Ek sheet' : stale.length + ' sheets'} me naya data nahi aaya</b><ul>${li}</ul><small class="dim">Apps Script import chala ya nahi check karo — dashboard abhi purana data dikha raha hai.</small></div>
        <div class="fresh-alert-act"><button class="btn small" data-fresh-refresh>↻ Dobara check</button><button class="btn small" data-fresh-dismiss title="3 ghante ke liye chhupao">✕</button></div></div>`;
    }
    let alertToasted = '';
    function paintAlert(root, list, final) {
      const slot = U.$('#home-fresh-alert', root); if (!slot) return;
      const html = alertHtml(list);
      slot.innerHTML = html;
      const sig = staleSig(list);
      if (final && html && alertToasted !== sig) { alertToasted = sig; try { U.toast('⚠️ Kisi sheet me naya data nahi aaya — Home ke upar dekho', 'warn'); } catch { /* ignore */ } }
    }
    function dismiss(root) {
      const el = U.$('.fresh-alert', root);
      try { localStorage.setItem(DISMISS_KEY, JSON.stringify({ sig: (el && el.dataset.freshSig) || '', at: Date.now() })); } catch { /* ignore */ }
      const slot = U.$('#home-fresh-alert', root); if (slot) slot.innerHTML = '';
    }
    async function mount(root, force) {
      const host = U.$('#home-freshness', root);   // section hide ho tab bhi alert ke liye check chalta hai
      const skeleton = [['ff-eir', '🟦', 'First Forward', 'EIR', 'Sabse naya issue date (EIR)'], ['ff-stock', '🟦', 'First Forward', 'StockDataa', 'Sabse nayi tag / agent allocation'], ['gv-master', '🟩', 'GV Partner', 'GV Master', 'Sabse naya issuance (date + time column)'], ['gv-assign', '🟩', 'GV Partner', 'Tag Assignment', 'Sabse nayi allocation / date column']].map(([key, icon, title, tab, note]) => ({ key, icon, title, tab, note, value: null }));
      const paint = (list, loading, final) => { if (host && host.isConnected) host.innerHTML = html(list, loading); if (final) paintAlert(root, list, final); };
      if (!force && memo && Date.now() - memoAt < 90000) { paint(memo, false, true); return; }
      paint(memo || skeleton, true, false);
      if (!inflight) inflight = compute((partial) => { if (!memo || force) paint(partial, true, false); }).finally(() => { inflight = null; });
      try { memo = await inflight; memoAt = Date.now(); paint(memo, false, true); } catch { paint(memo || skeleton, false, false); }
    }
    return { mount, dismiss, parseText, timeOfDay, mergeList, isStaleVal, alertHtml, html };
  })();
  FF.homeFreshness = freshness;

  // ---- 🗺️ Stock mapping: StockDataa ka poora stock → FF / GV / GV+FF / Office (server index se) ----
  const SMAP_BUCKETS = [['ff', '🟦 First Forward', 'FF agents ke IDs me map', 'smap-ff'], ['gv', '🟩 GV Partner', 'sirf GV IDs me map', 'smap-gv'], ['both', '🟪 GV + FF', 'dono IDs me map', 'smap-both'], ['office', '🟧 Office stock', 'kisi ID me map nahi', 'smap-office']];
  const smapPct = (v, t) => (t ? Math.round((v / t) * 1000) / 10 : 0);
  function stockMapHtml(data) {
    const m = data && data.map;
    if (!m || !m.rows || !m.rows.length) return `<section class="card smap"><div class="card-head"><h3>🗺️ Stock mapping</h3></div><div class="card-body"><div class="empty">Mapping data abhi available nahi — StockDataa index ban raha hai ya sheet khali hai.</div></div></section>`;
    const T = m.total, fmt = (n) => U.fmt(n);
    const tiles = SMAP_BUCKETS.map(([k, label, sub, cls]) => `<button type="button" class="smap-tile ${cls}" data-smap-b="${k}" title="Click → ${esc(label)} ke tags"><span class="smap-tl">${label}</span><b>${fmt(T[k])}</b><em>${smapPct(T[k], T.total)}% · ${sub}</em></button>`).join('')
      + `<button type="button" class="smap-tile smap-total" data-smap-b="all" title="Click → saare tags"><span class="smap-tl">📦 Grand total</span><b>${fmt(T.total)}</b><em>StockDataa ke saare tags</em></button>`;
    const bar = SMAP_BUCKETS.map(([k, label, , cls]) => (T[k] ? `<i class="${cls}" style="flex:${T[k]}" title="${esc(label)} ${fmt(T[k])} (${smapPct(T[k], T.total)}%)"></i>` : '')).join('');
    const rows = m.rows.map((r) => `<tr><td><b>${esc(String(r.cls).replace(/^VC/, ''))}</b></td><td>${esc(r.type || '')}</td>${SMAP_BUCKETS.map(([k, , , cls]) => `<td class="num"><button type="button" class="smap-cell ${cls}" data-smap-b="${k}" data-smap-c="${esc(r.cls)}" title="${esc(r.cls)} · click → tags">${fmt(r[k])}</button></td>`).join('')}<td class="num"><button type="button" class="smap-cell smap-total" data-smap-b="all" data-smap-c="${esc(r.cls)}" title="${esc(r.cls)} · saare tags">${fmt(r.total)}</button></td></tr>`).join('');
    const foot = `<tr class="smap-foot"><td colspan="2"><b>Grand total</b></td>${SMAP_BUCKETS.map(([k]) => `<td class="num"><button type="button" class="smap-link" data-smap-b="${k}">${fmt(T[k])}</button></td>`).join('')}<td class="num"><button type="button" class="smap-link" data-smap-b="all">${fmt(T.total)}</button></td></tr>`;
    const g = m.gv || {};
    const tl = (m.topTl || []).slice(0, 6).map((t) => `<span class="chip">${esc(t.tl)} <b>${fmt(t.ff)}</b>${t.both ? ` <small class="dim">(${fmt(t.both)} GV+FF)</small>` : ''}</span>`).join('');
    const warn = data.errors ? `<p class="dim small">⚠️ Sheet read adhura (${esc(Object.keys(data.errors).join(', '))}) — numbers purane/adhure ho sakte hain.</p>` : '';
    return `<section class="card smap"><div class="card-head"><div><h3>🗺️ Stock mapping · FF vs GV vs Office</h3><span class="dim small">StockDataa ka har tag Tag ID / Barcode se GV Tag Assignment se milaya gaya · GV "not assigned" count nahi</span></div><div class="card-right"><button class="btn small" data-smap-refresh title="Index dobara padho">↻ Refresh</button></div></div>
      <div class="card-body">${warn}<div class="smap-tiles">${tiles}</div><div class="smap-bar" aria-hidden="true">${bar}</div>
      <div class="table-wrap"><table class="tbl compact smap-tbl"><thead><tr><th>Class</th><th>Tag type</th>${SMAP_BUCKETS.map(([, l, , cls]) => `<th class="num ${cls}-h">${l}</th>`).join('')}<th class="num">Grand total</th></tr></thead><tbody>${rows}${foot}</tbody></table></div>
      <div class="smap-notes"><span>🟩 GV Tag Assignment: <b>${fmt(g.assigned || 0)}</b> in-stock assigned · <b>${fmt(g.notAssigned || 0)}</b> not assigned${g.outStatus ? ` · <b>${fmt(g.outStatus)}</b> issued/out` : ''} (count nahi)</span>${g.notInStockData ? `<span>🔎 GV assigned par StockDataa me nahi: <b>${fmt(g.notInStockData)}</b></span>` : ''}<span class="dim">Office = StockDataa me hai par na FF agent ID me, na GV me</span></div>
      ${tl ? `<div class="chip-row smap-tls"><span class="dim small">Top FF TLs (mapped):</span> ${tl}</div>` : ''}</div></section>`;
  }
  /** Office stock limit se niche wali classes (Settings → Stock mapping warning). */
  function stockMapWarnings(data) {
    const cfg = (FF.auth.settings && FF.auth.settings.stockMapAlert) || {};
    const m = data && data.map;
    if (cfg.enabled === false || !m || !m.rows) return [];
    const out = [];
    m.rows.forEach((r) => { const lim = Number((cfg.limits || {})[r.cls]); if ((cfg.limits || {})[r.cls] !== '' && (cfg.limits || {})[r.cls] != null && Number.isFinite(lim) && lim > 0 && r.office < lim) out.push({ cls: r.cls, type: r.type, office: r.office, limit: lim }); });
    return out;
  }
  function stockWarnHtml(list) {
    if (!list.length) return '';
    const chips = list.map((w) => `<button type="button" class="smap-warn-chip" data-smap-b="office" data-smap-c="${esc(w.cls)}" title="Office stock ke tags dekho"><b>${esc(w.cls)}</b> ${esc(w.type || '')} · <b>${U.fmt(w.office)}</b> <small>/ limit ${U.fmt(w.limit)}</small></button>`).join('');
    return `<section class="smap-warn" role="alert"><div class="smap-warn-head"><b>⚠️ Office stock kam hai</b><span class="dim small">${list.length} class limit se niche · click = tags dekho / download</span>${FF.auth.can && FF.auth.can('settings') ? '<a class="btn small" href="#/settings">⚙ Limit</a>' : ''}</div><div class="smap-warn-chips">${chips}</div></section>`;
  }
  const SMAP_LABEL = { ff: '🟦 First Forward', gv: '🟩 GV Partner', both: '🟪 GV + FF', office: '🟧 Office stock', all: '📦 All stock' };
  async function openStockMapDrawer(bucket, cls) {
    if (!FF.app || !FF.app.openDrawer) return;
    const title = `${SMAP_LABEL[bucket] || bucket}${cls ? ` · ${cls}` : ''}`;
    const qs = (extra) => `bucket=${encodeURIComponent(bucket)}${cls ? `&cls=${encodeURIComponent(cls)}` : ''}${extra || ''}`;
    const body = FF.app.openDrawer({ kicker: '🗺️ Stock mapping', title, sub: 'StockDataa tags · FF / GV mapping', body: U.spinner('Tags load ho rahe hain…'), wide: true });
    const host = body && body.querySelector ? body : U.$('#drawer-body');
    const state = { q: '', rows: [], total: 0 };
    const fetchPage = async (offset, limit, all) => {
      for (let i = 0; i < 40; i++) {
        const d = await FF.auth.api(`/api/stock-map/tags?${qs(`&offset=${offset}&limit=${limit}${all ? '&all=1' : ''}${state.q ? `&q=${encodeURIComponent(state.q)}` : ''}`)}`);
        if (d && d.pending) { await new Promise((r) => setTimeout(r, 2500)); continue; }
        return d;
      }
      throw new Error('Server index abhi ready nahi — thodi der baad try karo');
    };
    const paint = () => {
      const canExp = FF.auth.can('export');
      host.innerHTML = `<div class="btn-row smap-dr-bar"><input class="input" id="smap-q" placeholder="Search tag / barcode / agent / TL…" value="${esc(state.q)}">${canExp ? `<button class="btn small primary" id="smap-xlsx">⬇ Excel (all)</button><a class="btn small" id="smap-csv" href="/api/stock-map/csv?${qs(state.q ? `&q=${encodeURIComponent(state.q)}` : '')}" download>⬇ CSV</a>` : ''}<a class="btn small" href="#/stock">📦 Stock page</a><span class="dim small">${U.fmt(state.total)} tags · pehle ${U.fmt(state.rows.length)} dikh rahe</span></div>
        <div class="table-wrap kd-scroll tall"><table class="tbl compact"><thead><tr><th>#</th><th>Tag ID</th><th>Barcode</th><th>Class</th><th>Bucket</th><th>FF agent</th><th>FF TL</th><th>GV agent</th><th>GV TL</th><th class="num">Age</th></tr></thead><tbody>${state.rows.map((r, i) => `<tr><td class="dim">${i + 1}</td><td class="mono">${esc(r.tagId)}</td><td class="mono">${esc(r.barcode)}</td><td>${esc(r.cls)}</td><td>${esc(r.bucket)}</td><td>${esc(r.ffAgent)}${r.ffAgentId ? ` <small class="dim">${esc(r.ffAgentId)}</small>` : ''}</td><td>${esc(r.ffTl)}</td><td>${esc(r.gvAgent)}${r.gvAgentId ? ` <small class="dim">${esc(r.gvAgentId)}</small>` : ''}</td><td>${esc(r.gvTl)}</td><td class="num">${r.age === '' ? '—' : esc(r.age)}</td></tr>`).join('') || '<tr><td colspan="10" class="empty">Koi tag nahi.</td></tr>'}</tbody></table></div>
        ${state.rows.length < state.total ? '<div class="btn-row"><button class="btn small" id="smap-more">⬇ Aur dikhao</button></div>' : ''}`;
      const q = host.querySelector('#smap-q');
      let tm = null;
      if (q) q.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { state.q = q.value.trim(); load(); }, 350); });
      const more = host.querySelector('#smap-more');
      if (more) more.addEventListener('click', async () => { more.disabled = true; try { const d = await fetchPage(state.rows.length, 300); state.rows = state.rows.concat(d.rows || []); state.total = d.total; paint(); } catch (e) { U.toast(e.message || 'Load nahi hua', 'err'); more.disabled = false; } });
      const x = host.querySelector('#smap-xlsx');
      if (x) x.addEventListener('click', async () => {
        x.disabled = true; const old = x.textContent; x.textContent = 'Excel ban raha hai…';
        try {
          const d = await fetchPage(0, 1000, true);
          const rows = (d.rows || []).map((r) => [r.tagId, r.barcode, r.cls, r.type, r.bucket, r.ffAgent, r.ffAgentId, r.ffTl, r.gvAgent, r.gvAgentId, r.gvTl, r.age]);
          FF.xlsx.download(`stock-map-${bucket}${cls ? `-${cls}` : ''}-${U.stamp()}.xlsx`, [{ name: 'Tags', header: ['Tag ID', 'Barcode', 'Class', 'Tag type', 'Bucket', 'FF agent', 'FF agent ID', 'FF TL', 'GV agent', 'GV agent ID', 'GV TL', 'Age (days)'], rows }]);
        } catch (e) { U.toast(e.message || 'Excel nahi bana', 'err'); }
        x.disabled = false; x.textContent = old;
      });
    };
    const load = async () => {
      try { const d = await fetchPage(0, 300); state.rows = d.rows || []; state.total = d.total || 0; paint(); const q = host.querySelector('#smap-q'); if (q && state.q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
      catch (e) { host.innerHTML = U.errorBox ? U.errorBox(e) : esc(e.message); }
    };
    load();
  }
  async function mountStockMap(el, allowed) {
    if (!el || !allowed || !FF.auth || typeof FF.auth.api !== 'function') return;
    const load = async (force) => {
      el.innerHTML = `<section class="card smap"><div class="card-body">${U.spinner('Stock mapping (StockDataa × GV Tag Assignment) calculate ho raha hai…')}</div></section>`;
      const began = Date.now();
      try {
        let data = null;
        for (;;) {
          data = await FF.auth.api(`/api/stock-map`);
          if (!(data && data.pending)) break;
          if (Date.now() - began > 4 * 60e3) throw new Error('Server abhi bhi stock index bana raha hai — thodi der baad Refresh karo');
          await new Promise((r) => setTimeout(r, Math.min(8000, Math.max(1000, Number(data.retryAfterMs) || 3000))));
          if (!el.isConnected) return;
        }
        if (!el.isConnected) return;
        el.innerHTML = stockMapHtml(data);
        const warnEl = document.getElementById('home-stock-warn');
        if (warnEl) warnEl.innerHTML = stockWarnHtml(stockMapWarnings(data));
      } catch (err) {
        if (el.isConnected) el.innerHTML = `<section class="card smap"><div class="card-body">${U.errorBox ? U.errorBox(err) : esc(err.message || err)}<button class="btn small" data-smap-refresh>↻ Retry</button></div></section>`;
      }
    };
    el.addEventListener('click', (e) => { if (e.target.closest('[data-smap-refresh]')) { load(true); return; } const t = e.target.closest('[data-smap-b]'); if (t) openStockMapDrawer(t.dataset.smapB, t.dataset.smapC || ''); });
    const warnHost = document.getElementById('home-stock-warn');
    if (warnHost) warnHost.addEventListener('click', (e) => { const t = e.target.closest('[data-smap-b]'); if (t) openStockMapDrawer(t.dataset.smapB, t.dataset.smapC || ''); });
    load(false);
  }
  const homeLayout = (() => {
    const SECTIONS = [
      ['home-todo', "✅ Today's work"],
      ['home-gv-live', '🟩 GV live today'],
      ['home-month', '📅 Month KPI cards'],
      ['home-target-achievement', '🎯 Target achievement'],
      ['home-pulse', '📡 Management pulse'],
      ['home-charts', '📊 Charts'],
      ['home-stock', '📦 Stock'],
      ['home-stock-map', '🗺️ Stock mapping (FF · GV · Office)'],
      ['home-freshness', '🕒 Sheets last update']
    ];
    const ids = SECTIONS.map((x) => x[0]);
    const label = (id) => (SECTIONS.find((x) => x[0] === id) || [id, id])[1];
    const key = () => `ff_home_layout:${(FF.auth.user && (FF.auth.user.username || FF.auth.user.name)) || 'user'}`;
    const read = () => {
      let v = null;
      try { v = JSON.parse(localStorage.getItem(key()) || 'null'); } catch { v = null; }
      const order = (v && Array.isArray(v.order) ? v.order.filter((id) => ids.includes(id)) : []);
      ids.forEach((id) => { if (!order.includes(id)) order.splice(Math.min(ids.indexOf(id), order.length), 0, id); });
      const hidden = new Set(v && Array.isArray(v.hidden) ? v.hidden.filter((id) => ids.includes(id)) : []);
      return { order, hidden };
    };
    const write = (layout) => {
      try {
        const isDefault = !layout.hidden.size && layout.order.every((id, i) => id === ids[i]);
        if (isDefault) localStorage.removeItem(key());
        else localStorage.setItem(key(), JSON.stringify({ order: layout.order, hidden: [...layout.hidden] }));
      } catch { /* private mode */ }
    };
    function apply(root, layout) {
      const L = layout || read();
      const foot = root.querySelector(':scope > .foot-note');
      L.order.forEach((id) => {
        const el = root.querySelector(`:scope > #${id}`);
        if (!el) return;
        if (foot) root.insertBefore(el, foot); else root.appendChild(el);
        el.classList.toggle('home-sec-hidden', L.hidden.has(id));
      });
    }
    function panelHtml(L) {
      return `<div class="card-head"><div><h3>⚙ Customize Home</h3><span class="dim small">Drag or use ↑ ↓ to reorder · untick to hide · saved on this device</span></div><div class="card-right"><button class="btn small" data-hl-reset>Reset</button><button class="btn small primary" data-hl-done>Done</button></div></div>
        <ol class="hl-list">${L.order.map((id, i) => `<li class="hl-item${L.hidden.has(id) ? ' off' : ''}" draggable="true" data-hl-id="${id}"><span class="hl-grip" aria-hidden="true">⋮⋮</span><label><input type="checkbox" data-hl-show="${id}"${L.hidden.has(id) ? '' : ' checked'}> ${esc(label(id))}</label><span class="hl-move"><button class="btn small" data-hl-up="${id}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button class="btn small" data-hl-down="${id}" ${i === L.order.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button></span></li>`).join('')}</ol>`;
    }
    function toggle(root, btn) {
      let panel = root.querySelector(':scope > .hl-panel');
      if (panel) { panel.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
      const L = read();
      panel = document.createElement('section');
      panel.className = 'card hl-panel';
      const hero = root.querySelector(':scope > .home-hero');
      if (hero && hero.nextSibling) root.insertBefore(panel, hero.nextSibling); else root.prepend(panel);
      btn.setAttribute('aria-expanded', 'true');
      const paint = () => { panel.innerHTML = panelHtml(L); };
      const commit = () => { write(L); apply(root, L); paint(); };
      const move = (id, delta) => {
        const i = L.order.indexOf(id), j = i + delta;
        if (i < 0 || j < 0 || j >= L.order.length) return;
        L.order.splice(i, 1); L.order.splice(j, 0, id); commit();
        const b = panel.querySelector(`[data-hl-${delta < 0 ? 'up' : 'down'}="${id}"]`); if (b && !b.disabled) b.focus();
      };
      panel.addEventListener('click', (e) => {
        const t = e.target.closest('button'); if (!t) return;
        if (t.dataset.hlUp) move(t.dataset.hlUp, -1);
        else if (t.dataset.hlDown) move(t.dataset.hlDown, 1);
        else if (t.hasAttribute('data-hl-reset')) { L.order = ids.slice(); L.hidden.clear(); commit(); U.toast('Home layout reset', 'ok'); }
        else if (t.hasAttribute('data-hl-done')) { panel.remove(); btn.setAttribute('aria-expanded', 'false'); }
      });
      panel.addEventListener('change', (e) => {
        const id = e.target.dataset && e.target.dataset.hlShow; if (!id) return;
        if (e.target.checked) L.hidden.delete(id); else L.hidden.add(id);
        commit();
      });
      let dragId = null;
      panel.addEventListener('dragstart', (e) => { const li = e.target.closest && e.target.closest('[data-hl-id]'); if (!li) return; dragId = li.dataset.hlId; li.classList.add('dragging'); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); } catch { /* ignore */ } });
      panel.addEventListener('dragover', (e) => { if (dragId) e.preventDefault(); });
      panel.addEventListener('drop', (e) => {
        const li = e.target.closest && e.target.closest('[data-hl-id]');
        if (!dragId || !li || li.dataset.hlId === dragId) return;
        e.preventDefault();
        const to = L.order.indexOf(li.dataset.hlId);
        L.order.splice(L.order.indexOf(dragId), 1); L.order.splice(to, 0, dragId); dragId = null; commit();
      });
      panel.addEventListener('dragend', () => { dragId = null; panel.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging')); });
      paint();
    }
    return { apply, toggle, read };
  })();

  async function render(root, params, renderCtx) {
    const u = FF.auth.user || {};
    const avatar = u.avatar ? `<img class="home-avatar" src="${esc(u.avatar)}" alt="">` : `<div class="home-avatar mono-logo">${esc((u.name || u.username || 'U').slice(0, 1).toUpperCase())}</div>`;
    const canFf = FF.auth.can('dashboard') || FF.auth.can('trend') || FF.auth.can('stock') || FF.auth.can('performance');
    const canGv = FF.auth.can('gvDashboard') || FF.auth.can('gvTrend') || FF.auth.can('gvStock') || FF.auth.can('gvPerformance');

    root.innerHTML = `<div id="home-stock-warn"></div><div id="home-fresh-alert"></div><div class="home-hero v2">
        <div class="home-hero-main">
          ${avatar}
          <div>
            <h1 class="home-greeting"><span class="home-greeting-text">${esc(greeting())}</span>, <span class="home-name">${esc(u.name || u.username || 'there')}</span> <span class="home-wave" aria-hidden="true">👋</span></h1>
            <p class="sub">GV ka aaj ka live data · ${esc(U.labelYM(U.ymKey(TODAY()), true))} ke KPI cards · charts · GV &amp; FF stock</p>
            <div class="home-quick-stats" id="home-quick"></div>
          </div>
        </div>
        <div class="home-hero-side">
          <div class="home-stat"><span class="dim">Data loaded</span><b id="home-loaded">${S.loadedAt || G.loadedAt ? U.timeLabel(S.loadedAt || G.loadedAt) : '—'}</b></div>
          <div class="home-stat"><span class="dim">Sync</span><b id="home-sync">${FF.preloader && FF.preloader.done ? 'All sheets ready ✓' : 'Background sync…'}</b></div>
          <button class="btn primary" data-action="refresh">↻ Refresh</button>
          ${FF.auth.can('aiAnalyst') ? '<a class="btn aa-home-btn" href="#/aiAnalyst" title="GV + FF poora review — growth, down, kya karein">🧠 AI Business Analyst</a>' : ''}
          <button class="btn" id="home-morning-card" title="Boss ke liye WhatsApp Good-Morning card (PNG)">📲 Morning Card</button>
          <a class="btn" href="#/tagIssued">🏷️ Tag Issued →</a>
          <button class="btn" id="home-customize" title="Reorder or hide Home sections" aria-expanded="false">⚙ Customize</button>
        </div>
      </div>
      <div id="home-todo"></div>
      <div id="home-gv-live">${U.spinner('GV aaj ka live data aaya ja raha hai…')}</div>
      <div id="home-month">${U.spinner('Building month KPI cards from the EIR sheet…')}</div>
      <div id="home-target-achievement">${U.spinner('Class-wise target achievement calculate ho raha hai…')}</div>
      <div id="home-pulse"></div>
      <div id="home-charts">${U.spinner('Charts…')}</div>
      <div id="home-stock">${U.spinner('Stock (StockDataa + Tag Assignment)…')}</div>
      <div id="home-stock-map"></div>
      <div id="home-freshness"></div>
      <p class="foot-note">🟩 GV aaj = <b>GV Master sheet</b> (live) · 🧾 Issuance history = <b>EIR</b> (GV = master ID ${esc(FF.config.eir.gvMasterId || '5845036')}, baaki FF) · 📦 Stock = <b>StockDataa</b> (FF) + <b>Tag Assignment</b> (GV) · 🟦 FF ka issuance T+1 aata hai · 🔎 Global search top bar par hai · full profile/results Management → Master Search me.</p>`;

    // ⚙ v3.79 — Customize Home: reorder / hide sections, saved per user on this device.
    homeLayout.apply(root);
    freshness.mount(root, false);
    root.addEventListener('click', (ev) => { const b = ev.target && ev.target.closest && ev.target.closest('[data-fresh-refresh]'); if (b) { freshness.mount(root, true); return; } const d = ev.target && ev.target.closest && ev.target.closest('[data-fresh-dismiss]'); if (d) freshness.dismiss(root); });
    const custBtn = U.$('#home-customize', root);
    if (custBtn) custBtn.addEventListener('click', () => homeLayout.toggle(root, custBtn));

    const quick = U.$('#home-quick', root);
    if (quick) quick.innerHTML = `<div class="chip-row"><span class="chip on">🟩 GV aaj · GV Master (live)</span><span class="chip">🧾 EIR: FF + GV history</span><span class="chip dim">📦 Stock: StockDataa + Tag Assignment</span></div>`;

    // ✅ v3.78 — "Today's work" card: pending Tag Requests + one-click shortcuts (cheap: one small API call).
    const todoMount = U.$('#home-todo', root);
    if (todoMount) {
      const canReq = FF.auth.can('tagRequest') || (u.role === 'admin');
      const link = (href, icon, label, n, tone) => `<a class="todo-item ${tone || ''}" href="${href}"><span class="todo-ic">${icon}</span><span class="todo-tx"><b>${n == null ? '' : esc(U.fmt(n))}</b> ${esc(label)}</span><span class="todo-go">→</span></a>`;
      // `info` = summary of the tag-request list (null while loading). Extra rows only appear when they are non-zero.
      const paint = (info) => {
        lastInfo = info;
        const items = [];
        if (canReq) {
          const pending = info ? info.pending : null;
          items.push(pending == null ? link('#/tagRequest', '📝', 'Tag requests — open', null) : link('#/tagRequest', pending ? '⏳' : '✅', pending ? `pending tag request${pending === 1 ? '' : 's'}` : 'No pending tag requests', pending || null, pending ? 'warn' : 'ok'));
          if (info && info.late) items.push(link('#/tagRequest', '🔥', `request${info.late === 1 ? '' : 's'} waiting 2+ days (oldest ${info.lateDays}d)`, info.late, 'warn'));
          if (info && info.toDispatch) items.push(link('#/tagRequest', '🚚', `approved — dispatch pending`, info.toDispatch, 'warn'));
          if (info && info.sheetFail) items.push(link('#/tagRequest', '📗', `Google Sheet entry failed — resend`, info.sheetFail, 'warn'));
        }
        if (FF.auth.can('newIds') && newIdsN != null) items.push(newIdsN ? link('#/newIds', '🆕', `new agent${newIdsN === 1 ? '' : 's'} — Sheet4 me entry baaki`, newIdsN, 'warn') : link('#/newIds', '✅', 'No new agents pending for Sheet4', null, 'ok'));
        if (FF.auth.can('stock')) items.push(link('#/stock', '📦', 'Check low-stock agents', null));
        if (FF.auth.can('performance')) items.push(link('#/performance', '🏁', 'Agent performance', null));
        if (FF.auth.can('fastagMapping')) items.push(link('#/fastagMapping', '🔗', 'FASTag Mapping — map & report', null));
        todoMount.innerHTML = items.length ? `<section class="card todo-card"><div class="card-head"><h3>✅ Today's work</h3></div><div class="todo-row">${items.join('')}</div></section>` : '';
      };
      const summarize = (list) => {
        const now = Date.now(), DAY = 24 * 3600e3;
        let pending = 0, late = 0, lateDays = 0, toDispatch = 0, sheetFail = 0;
        list.forEach((r) => {
          const st = String((r && r.status) || 'pending').toLowerCase();
          const t = Date.parse((r && (r.at || r.updatedAt)) || '') || 0;
          if (st === 'pending') {
            pending++;
            const days = t ? Math.floor((now - t) / DAY) : 0;
            if (days >= 2) { late++; lateDays = Math.max(lateDays, days); }
          }
          if (st === 'approved') toDispatch++;
          if (st === 'approved' && r.sheetSync && r.sheetSync.error && !(r.sheetApprovalSync && r.sheetApprovalSync.at)) sheetFail++;
        });
        return { pending, late, lateDays, toDispatch, sheetFail };
      };
      let newIdsN = null, lastInfo = null;
      paint(null);
      if (FF.auth.can('newIds') && FF.auth.api) FF.auth.api('/api/new-ids?summary=1').then((o) => { if (o && o.summary) { newIdsN = o.summary.count; paint(lastInfo); } }).catch(() => {});
      if (canReq && FF.auth.api) {
        FF.auth.api('/api/tag-requests').then((out) => {
          const list = (out && out.requests) || [];
          paint(summarize(list));
        }).catch(() => {});
      }
    }

    const gvLiveMount = U.$('#home-gv-live', root);
    const monthMount = U.$('#home-month', root);
    const chartMount = U.$('#home-charts', root);
    const pulseMount = U.$('#home-pulse', root);
    const targetAchievementMount = U.$('#home-target-achievement', root);
    const stockMount = U.$('#home-stock', root);
    mountStockMap(U.$('#home-stock-map', root), canFf);

    // ⚡ Home first paint: GV-only today endpoint is intentionally separate from the heavier
    // FF+GV history feed. This makes "AAJ KA LIVE" visible even when 30-day history is slow.
    const liveP = canGv
      ? FF.data.gvToday().catch((err) => ({ requestError: err && err.message ? err.message : 'GV today feed request failed' }))
      : Promise.resolve(null);
    const feedP = (canFf || canGv)
      ? FF.data.today().catch((err) => ({ requestError: err && err.message ? err.message : 'today feed request failed' }))
      : Promise.resolve(null);
    const dailyP = (canFf || canGv) ? S.need('daily', { only: true }).catch(() => null) : Promise.resolve(null);
    const stockP = canFf ? S.need('stock', { only: true }).catch(() => null) : Promise.resolve(null);
    const gvStockP = canGv ? G.need('stockClass', { only: true }).catch(() => null) : Promise.resolve(null);
    const gvMasterP = canGv ? G.need('master', { only: true }).catch(() => null) : Promise.resolve(null);
    const currentTargetYm = U.ymKey(TODAY());
    const savedTargetsForMonth = ((FF.auth.settings && FF.auth.settings.targets) || []).filter((t) => t && t.ym === currentTargetYm && classTargetsConfigured(t) && ((targetSource(t) === 'ff' && canFf) || (targetSource(t) === 'gv' && canGv)));
    const needsFfTargetData = savedTargetsForMonth.some((t) => targetSource(t) === 'ff');
    const needsGvTargetData = savedTargetsForMonth.some((t) => targetSource(t) === 'gv');
    const targetAchievementDataP = savedTargetsForMonth.length ? Promise.all([
      needsFfTargetData
        ? S.need('agentClass', { only: true }).then((rows) => ({ rows: Array.isArray(rows) ? rows : [], error: '' })).catch((err) => ({ rows: null, error: err && err.message || 'Agent class data unavailable' }))
        : Promise.resolve({ rows: [], error: '' }),
      needsGvTargetData ? gvMasterP.then((ok) => ({ ok: !!ok, error: G.error && G.error('master') || '' })).catch((err) => ({ ok: false, error: err && err.message || 'GV Master unavailable' })) : Promise.resolve({ ok: true, error: '' })
    ]).then(([ffData, gvData]) => {
      let gvRows = [];
      if (needsGvTargetData && gvData.ok && G.agentRollup) { try { gvRows = G.agentRollup(currentTargetYm) || []; } catch { gvRows = []; } }
      const error = (needsFfTargetData && ffData.error) || (needsGvTargetData && (!gvData.ok || gvData.error) ? (gvData.error || 'GV Master data unavailable') : '');
      return { ffRows: ffData.rows || [], gvRows, error };
    }) : Promise.resolve(null);

    // Repaint kit (GV Master load hone par month cards dobara banti hain — aaj ke live rows ke saath).
    const ui = { ready: false, sf: null, ctx: null, sc: null, wdBars: null, liveToday: false };
    let targetAchievementData = { ready: !savedTargetsForMonth.length, ffRows: [], gvRows: [], error: '' };
    let liveFromFeed = null;
    let feedLiveRows = [];
    let liveRows = [];
    let liveSourceReady = false;

    let liveState = {
      total: 0, vc4: 0, vc20: 0, vc5p: 0, replacement: 0, chassis: 0, wrongVrn: 0, highest: null,
      expected: null, pace: null, cached: false, stale: false,
      error: canGv ? 'GV aaj ka live data aa raha hai…' : '',
      source: 'feed', liveToday: false
    };

    let wdBars = null;
    const hoursGone = Math.max(1, (Date.now() - new Date().setHours(0, 0, 0, 0)) / 3600000);

    function applyHistoryFeed(feed) {
      if (!feed) return;
      const historyLive = feed.gv || null;
      if (historyLive && !liveFromFeed && feedMatchesCurrentClassMap(historyLive)) {
        liveFromFeed = { ...historyLive, cached: !!(historyLive.cached || feed.cached), stale: !!historyLive.stale };
        feedLiveRows = liveRowsFromFeed(liveFromFeed);
        if (!liveSourceReady) liveRows = feedLiveRows || [];
      }
      const series = (historyLive && historyLive.series) || {};
      const tk = todayK(), wd = TODAY().getDay();
      const keys = Object.keys(series).filter((k) => k < tk).sort().reverse()
        .filter((k) => U.fromDateKey(k).getDay() === wd).slice(0, 4).reverse();
      wdBars = keys.length ? { labels: keys.map((k) => U.labelDateKey(k)), values: keys.map((k) => series[k]) } : null;
      ui.wdBars = wdBars;
      if (historyLive) {
        liveState = {
          ...liveState,
          expected: historyLive.expected != null
            ? historyLive.expected
            : (expectedFromWeekdaySeries(historyLive.series, tk) ?? liveState.expected),
          cached: !!(historyLive.cached || feed.cached),
          stale: !!historyLive.stale,
          error: historyLive.total === undefined ? liveState.error : ''
        };
      }
      paintLive();
      if (ui.ready && liveRows.length) {
        const st2 = streams(ui.sf.rows, liveRows, liveSourceReady);
        ui.sf = { rows: st2.rows, ff: st2.ff, gv: st2.gv };
        ui.sc = M.summary(st2.rows, ui.ctx.curKey);
        ui.liveToday = st2.gvLiveAdded;
        paintMonth();
        paintCharts();
      }
    }

    function paintLive() {
      if (!gvLiveMount || !gvLiveMount.isConnected) return;
      const pace = liveState.total > 0 ? Math.round((liveState.total / hoursGone) * 24) : null;
      liveState.pace = pace;
      // Expected Today: pichhle same-weekday EIR (GV = master ID wali rows) se — card aur click ka drawer ek hi din / total dikhayein.
      const wdEir = ui.daily ? eirWeekdays(todayK(), ui.daily) : null;
      const bars = wdEir ? wdEir.bars : wdBars;
      const wdKeys = wdEir ? wdEir.keys : null;
      const expectedNow = wdEir && wdEir.expected != null ? wdEir.expected : liveState.expected;
      const wdNote = bars ? `pichhle ${bars.labels.length} same-weekday (${bars.labels.map((l) => `${l} = ${U.fmt(bars.values[bars.labels.indexOf(l)])}`).join(' · ')}) ka average` : '';
      gvLiveMount.innerHTML = gvLiveHtml({ ...liveState, expected: expectedNow, pace, weekdayNote: wdNote, weekdayBars: bars, weekdayKeys: wdKeys });
    }
    // 🧩 Merge fix: yeh teen painter main me call hote the par define nahi the (Home render
    //    ReferenceError: paintMonth is not defined → poore KPI cards gayab). Base v3.47 se wapas.
    function paintMonth() {
      if (!monthMount || !monthMount.isConnected || !ui.ready) return;
      // 📅 Month KPI cards = sirf EIR (GV = master ID 5845036 wali rows). GV Master / live rows card me plus nahi hote (double count).
      const eir = ui.daily || [];
      const eirSf = { rows: eir, ff: eir.filter((r) => r.channel !== 'GV Partner'), gv: eir.filter((r) => r.channel === 'GV Partner') };
      if (ui.wrong === undefined && !ui.wrongReq) {
        ui.wrongReq = true;
        const cx = ui.ctx, day = Math.max(1, cx.observedDay);
        Promise.all([M.loadWrongVrn(cx.curKey, day), M.loadWrongVrn(cx.prevKey, Math.min(day, U.daysInMonth(cx.prevKey)))])
          .then(([cur, last]) => { ui.wrong = cur ? { cur, last } : null; }).catch(() => { ui.wrong = null; }).then(() => paintMonth());
      }
      monthMount.innerHTML = monthKpiHtml(ui.ctx, eirSf, { liveToday: false }, M.summary(eir, ui.ctx.curKey), eir, ui.wrong === undefined ? 'loading' : ui.wrong);
    }
    function paintTargetAchievement() {
      if (!targetAchievementMount || !targetAchievementMount.isConnected) return;
      const targets = ((FF.auth.settings && FF.auth.settings.targets) || []).filter((t) => t && t.ym === currentTargetYm && classTargetsConfigured(t) && ((targetSource(t) === 'ff' && canFf) || (targetSource(t) === 'gv' && canGv)));
      if (!targets.length) { targetAchievementMount.innerHTML = targetAchievementHtml({ configured: false }, currentTargetYm); return; }
      if (!targetAchievementData.ready) { targetAchievementMount.innerHTML = U.spinner('Saved class-wise targets ke against issuance calculate ho raha hai…'); return; }
      if (targetAchievementData.error) { targetAchievementMount.innerHTML = card('🎯 Target Achievement · VC4 / VC20 / VC5+', `<div class="hm-target-empty">Class-wise issuance load nahi ho paaya: ${esc(targetAchievementData.error)}<br><a class="btn small" href="#/targets">Targets check karo</a></div>`, ''); return; }
      const summary = targetAchievementSummary(targets, currentTargetYm, targetAchievementData.ffRows, targetAchievementData.gvRows, [canFf ? 'ff' : '', canGv ? 'gv' : ''].filter(Boolean));
      targetAchievementMount.innerHTML = targetAchievementHtml(summary, currentTargetYm);
    }
    let lastStockPulse = null; // stock total ek baar aane ke baad repaints (live/master paintAll) me bana rahe
    function paintPulse(stock) {
      if (stock) lastStockPulse = stock;
      if (!pulseMount || !pulseMount.isConnected || !ui.ready) return;
      pulseMount.innerHTML = managementPulseHtml(ui.ctx, ui.sf, liveState, lastStockPulse);
    }
    function paintCharts() {
      if (!chartMount || !chartMount.isConnected || !ui.ready) return;
      const allowedChannels = [canFf ? 'ff' : '', canGv ? 'gv' : ''].filter(Boolean);
      const explorer = explorerHtml(ui.sf.rows, allowedChannels);
      chartMount.innerHTML = `${explorer}${monthCharts(ui.ctx, ui.sf, ui.sc, ui.sf.rows, { weekdayBars: ui.wdBars })}`;
      C.mount(chartMount);
    }
    function bindExplorerEvents() {
      if (!chartMount || chartMount.__homeExplorerBound) return;
      chartMount.__homeExplorerBound = true;
      chartMount.addEventListener('click', (event) => {
        const filterButton = event.target.closest('[data-home-exp-filter]');
        if (filterButton) {
          const [dim, value] = filterButton.dataset.homeExpFilter.split(':');
          if (!Object.prototype.hasOwnProperty.call(EXPLORER_FILTERS, dim)) return;
          const choices = dim === 'channels' ? ['ff', 'gv'] : EXPLORER_FILTERS[dim].map(([v]) => v);
          if (value === 'all') explorerFilters[dim].clear();
          else if (choices.includes(value)) {
            if (explorerFilters[dim].has(value)) explorerFilters[dim].delete(value);
            else explorerFilters[dim].add(value);
          }
          saveExplorerFilters(); paintCharts(); return;
        }
        const preset = event.target.closest('[data-home-exp-range]');
        if (preset) {
          Object.assign(explorerFilters, explorerRangePreset(preset.dataset.homeExpRange));
          saveExplorerFilters(); paintCharts(); return;
        }
        if (event.target.closest('[data-home-exp-reset]')) {
          resetExplorerFilters(); saveExplorerFilters(); paintCharts();
        }
      });
      chartMount.addEventListener('change', (event) => {
        const input = event.target.closest('[data-home-exp-date]');
        if (!input) return;
        const fromInput = U.$('#home-exp-from', chartMount), toInput = U.$('#home-exp-to', chartMount);
        const from = validExplorerDate(fromInput && fromInput.value), to = validExplorerDate(toInput && toInput.value);
        if (from && to && from > to) {
          U.toast('From date, To date se pehle chuniye', 'warn');
          if (fromInput) fromInput.value = explorerFilters.from;
          if (toInput) toInput.value = explorerFilters.to;
          return;
        }
        explorerFilters.from = from; explorerFilters.to = to;
        saveExplorerFilters(); paintCharts();
      });
    }
    bindExplorerEvents();
    function paintAll() { paintLive(); paintMonth(); paintTargetAchievement(); paintPulse(); paintCharts(); }
    targetAchievementDataP.then((result) => {
      if (result) targetAchievementData = { ready: true, ...result };
      paintTargetAchievement();
    }).catch((err) => {
      targetAchievementData = { ready: true, ffRows: [], gvRows: [], error: err && err.message || 'Class-wise target data unavailable' };
      paintTargetAchievement();
    });

    // 🟢 First visible live source: only GV Master + today, no FF/history wait.
    paintLive();
    liveP.then((quick) => {
      if (!quick || !quick.gv) {
        liveState = { ...liveState, error: quick && quick.requestError ? quick.requestError : 'GV today live feed unavailable.' };
        paintLive();
        return;
      }
      // A service worker may briefly serve an older snapshot after a Settings mapping change.
      // Keep the loading shell rather than painting categories from a different CCH map; the
      // client GV Master snapshot below is already classified with the current settings.
      if (!feedMatchesCurrentClassMap(quick.gv)) return;
      liveFromFeed = { ...quick.gv, cached: !!(quick.gv.cached || quick.cached), stale: !!quick.gv.stale };
      feedLiveRows = liveRowsFromFeed(liveFromFeed);
      liveRows = feedLiveRows || [];
      liveSourceReady = true;
      liveState = {
        ...liveState,
        total: Number(liveFromFeed.total) || 0,
        vc4: Number(liveFromFeed.vc4) || 0,
        vc20: Number(liveFromFeed.vc20) || 0,
        vc5p: Number(liveFromFeed.vc5p) || 0,
        replacement: Number(liveFromFeed.replacement) || 0,
        chassis: Number(liveFromFeed.chassis) || 0,
        wrongVrn: Number(liveFromFeed.wrongVrn) || 0,
        replacementBy: liveFromFeed.replacementBy || null, chassisBy: liveFromFeed.chassisBy || null, wrongVrnBy: liveFromFeed.wrongVrnBy || null,
        expected: liveFromFeed.expected != null
          ? liveFromFeed.expected
          : expectedFromWeekdaySeries(liveFromFeed.series, todayK()),
        cached: !!liveFromFeed.cached,
        stale: !!liveFromFeed.stale,
        error: '',
        source: 'feed', liveToday: true
      };
      paintLive();
      if (ui.ready) {
        const st2 = streams(ui.sf.rows, liveRows, true);
        ui.sf = { rows: st2.rows, ff: st2.ff, gv: st2.gv };
        ui.sc = M.summary(st2.rows, ui.ctx.curKey);
        ui.liveToday = true;
        paintMonth();
        paintCharts();
      }
    }).catch((err) => {
      liveState = { ...liveState, error: err && err.message ? err.message : 'GV today feed failed.' };
      paintLive();
    });

    // 30-day history is background only — it supplies Expected Today / same-weekday bars and
    // must never delay the initial GV live card.
    feedP.then(applyHistoryFeed).catch(() => {});

    // GV Master load hone par usi snapshot se aaj ka poora detail (replacement/chassis/agent-wise)
    gvMasterP.then((ok) => {
      const masterError = (G.error && G.error('master')) || '';
      if (!ok || masterError || !G.gvToday) {
        if (!liveFromFeed && canGv) liveState = { ...liveState, error: masterError || 'GV Master sheet load failed.' };
        paintLive();
        return;
      }
      const snap = G.gvToday();
      if (!snap || !snap.loaded) {
        if (!liveFromFeed && canGv) liveState = { ...liveState, error: 'GV Master snapshot load nahi hua.' };
        paintLive();
        return;
      }
      // Incomplete client snapshot ko server ke full live total par prefer na karo.
      // Server class totals interim month rows ke liye kaam karte hain; full Master replaces them here.
      const feedTotal = liveFromFeed ? Number(liveFromFeed.total) || 0 : 0;
      const useSnap = snap.total >= feedTotal || !liveFromFeed;
      liveRows = useSnap ? (snap.rows || []) : (feedLiveRows || []);
      liveSourceReady = true;
      liveState = useSnap ? {
        ...liveState,
        total: snap.total, vc4: snap.vc4, vc20: snap.vc20, vc5p: snap.vc5p,
        replacement: snap.replacement, chassis: snap.chassis, wrongVrn: snap.wrongVrn || 0,
        replacementBy: snap.replacementBy, chassisBy: snap.chassisBy, wrongVrnBy: snap.wrongVrnBy, highest: gvTodayHighest(snap.rows),
        error: '', stale: false, source: 'master', liveToday: true
      } : { ...liveState, error: '', liveToday: true };
      if (ui.ready) {
        // `st` is the already-built stream object, so pass its rows (not the wrapper) back in.
        const st2 = streams(st.rows, liveRows, liveSourceReady);
        ui.sf = { rows: st2.rows, ff: st2.ff, gv: st2.gv };
        ui.sc = M.summary(st2.rows, ui.ctx.curKey);
        ui.liveToday = st2.gvLiveAdded;
        paintAll();
      } else paintLive();
    }).catch((err) => {
      if (!liveFromFeed && canGv) liveState = { ...liveState, error: err && err.message ? err.message : 'GV Master load failed.' };
      paintLive();
    });

    const daily = await dailyP;
    if (!root.isConnected) return;
    const st = streams(daily || [], liveRows, liveSourceReady);
    const ctx = monthContext(st.rows);
    const sf = { rows: st.rows, ff: st.ff, gv: st.gv };
    const sc = M.summary(st.rows, ctx.curKey);
    ui.ready = true; ui.daily = M.eirOnlyDaily(daily || []); ui.sf = sf; ui.ctx = ctx; ui.sc = sc; ui.liveToday = st.gvLiveAdded;
    paintMonth();
    paintLive();   // Expected Today ab EIR weekdays se
    paintTargetAchievement();
    paintPulse();
    paintCharts();
    // ---- 📦 Stock (FF = StockDataa · GV = Tag Assignment) ----------------------------------------
    const [stockR, gvStockR] = await Promise.all([stockP, gvStockP]);
    if (!root.isConnected || !stockMount) return;
    const ffStockRows = stockR ? (F() ? F().stock(stockR, { src: 'ff' }) : stockR) : [];
    const ffStock = {
      total: sumN(ffStockRows),
      vc4: sumN(ffStockRows.filter((r) => r.group === 'VC4')),
      comm: sumN(ffStockRows.filter((r) => r.group !== 'VC4')),
      rows: (() => {
        const byTl = new Map();
        for (const r of ffStockRows) byTl.set(r.tlName || '—', (byTl.get(r.tlName || '—') || 0) + (Number(r.n) || 0));
        return [...byTl.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
      })()
    };
    const gvStockRows = gvStockR || [];
    const gvStock = {
      total: sumN(gvStockRows),
      vc4: sumN(gvStockRows.filter((r) => r.group === 'VC4')),
      comm: sumN(gvStockRows.filter((r) => r.group !== 'VC4')),
      rows: []
    };
    stockMount.innerHTML = stockHtml(ffStock, gvStock, sf);
    paintPulse({ total: ffStock.total + gvStock.total });
    // GV agent-wise stock (agar permission/load ho to) — top holders
    const gvStockAgentP = canGv ? G.need('stockAgent', { only: true }).catch(() => null) : Promise.resolve(null);
    gvStockAgentP.then((rows) => {
      if (!rows || !stockMount.isConnected) return;
      const top = [...rows].sort((a, b) => (b.n || 0) - (a.n || 0)).slice(0, 5).map((r) => ({ name: r.agentName || r.agentId || '—', n: r.n }));
      const host = stockMount.querySelectorAll('.hm-toplist')[1];
      if (host && top.length) host.innerHTML = top.map((r, i) => `<div class="hm-toprow"><span class="rank">${i + 1}</span><b>${esc(r.name)}</b><span class="tag gv">GV</span><strong>${U.fmt(r.n)}</strong></div>`).join('');
    }).catch(() => {});

    const morningBtn = U.$('#home-morning-card', root);
    // 📲 Morning card module first paint ke baad load hota hai — click par load karke bana do.
    if (morningBtn) morningBtn.addEventListener('click', () => {
      if (FF.morningCard) { FF.morningCard.generate(root); return; }
      if (FF.lazy && FF.lazy.shellNeed) FF.lazy.shellNeed(['morningCard']).then(() => { if (FF.morningCard) FF.morningCard.generate(root); });
    });

    // Sync pill — chhota live status
    const syncPoll = setInterval(() => {
      const el = U.$('#home-sync', root);
      const loaded = U.$('#home-loaded', root);
      if (!root.isConnected) { clearInterval(syncPoll); return; }
      if (document.hidden) return;   // background tab me DOM update bekaar
      if (loaded) loaded.textContent = U.timeLabel(S.loadedAt || G.loadedAt || Date.now());
      if (!el) return;
      if (FF.preloader && FF.preloader.done) { el.textContent = 'All sheets ready ✓'; el.className = 'sync-fast'; }
      else if (FF.preloader && FF.preloader.running) { const p = FF.preloader.state.progress; el.textContent = `Preloading ${p.loaded}/${p.total}…`; }
      else if (FF.preloader && FF.preloader.state.errors.length) { el.textContent = 'Some sheets unavailable · retry ↻'; }
      else el.textContent = 'Background sync…';
    }, 4000);
    // 🧹 v3.60 — poore <body> par subtree MutationObserver hata diya. App har second DOM mutate karti
    // hai (toasts, polls, tables), isliye ye observer har mutation par `document.body.contains(root)`
    // chalata tha = scroll/paint ke waqt lagatar main-thread kaam (scroll leg ka ek bada karan).
    // Interval ke andar `root.isConnected` check hi kaafi hai — kaam wahi, cost zero.

    // ⚡ v3.73 — boot gate (client request): "Opening your workspace" animation hatne se pehle Home
    // ke SAARE sections (GV live · month KPIs · target achievement · charts · stock) apne real
    // numbers paint kar chuke hone chahiye — Home par spinner-filled screen nahi, poora data instant.
    // Saare handlers upar paint karte hain; yahan sirf unke settle hone ka intezaar hai (4.2s soft
    // cap — uske baad bhi background paint chalta rehta hai, par renderCurrent block nahi rehta).
    if (renderCtx && renderCtx.bootGate) {
      const pending = [liveP, feedP, dailyP, stockP, gvStockP, gvMasterP, targetAchievementDataP, gvStockAgentP];
      await Promise.race([
        Promise.allSettled(pending),
        new Promise((resolve) => setTimeout(resolve, 1800))
      ]);
    }
  }

  FF.pages.home = {
    title: 'Home', render, monthKpiHtml, streams, eirWeekdays, liveRowsFromFeed, targetAchievementSummary, targetAchievementHtml,
    explorer: {
      state: explorerFilters, filterRows: filterExplorerRows, totals: explorerTotals, daily: explorerDaily, html: explorerHtml,
      dateKey: explorerDateKey, rangePreset: explorerRangePreset, reset: resetExplorerFilters,
      loadFilters: loadExplorerFilters, saveFilters: saveExplorerFilters
    }
  };
})(window.FF);
