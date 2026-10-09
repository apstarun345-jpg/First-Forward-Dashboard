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
  const kpi = (cls, title, icon, value, foot, spec) => `<div class="kpi ${cls}"${spec ? ` data-kpi="${esc(spec)}"` : ''} data-kpi-title="${esc(title)}" role="button" tabindex="0"><div class="kpi-top"><span class="kpi-title">${esc(title)}</span><span class="kpi-icon">${icon}</span></div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot || ''}</div></div>`;
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
    classes: [['VC4', '🚗 VC4'], ['VC20', '🛻 VC20'], ['VC5+', '🚚 VC5+']]
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
        `🚗 VC4: <b>${U.fmt(daily.byClass.VC4[i] || 0)}</b>`,
        `🛻 VC20: <b>${U.fmt(daily.byClass.VC20[i] || 0)}</b>`,
        `🚚 VC5+: <b>${U.fmt(daily.byClass['VC5+'][i] || 0)}</b>`,
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
      const cur = maps[group].get(key) || { name: String(r.agentName || r.agentId || '—').trim() || '—', n: 0 };
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
    const cards = [
      kpi('g11', 'Aaj Total (GV live)', '🏷️', U.fmt(live.total),
        `${expected != null ? `expected <b>${U.fmt(expected)}</b> · ` : ''}pace ${pace != null ? U.fmt(pace) : '—'} day-end`,
        `src=gv&scope=day&date=${tk}`),
      kpi('g3', 'VC4', '🚗', U.fmt(live.vc4), live.total ? `${U.fmtPct(U.pctOf(live.vc4, live.total), 0)} share` : '—', `src=gv&scope=day&date=${tk}&f=vc4`),
      kpi('g8', 'VC20', '🛻', U.fmt(live.vc20), live.total ? `${U.fmtPct(U.pctOf(live.vc20, live.total), 0)} share` : '—', `src=gv&scope=day&date=${tk}&f=vc20`),
      kpi('g6', 'VC5+', '🚚', U.fmt(live.vc5p), live.total ? `${U.fmtPct(U.pctOf(live.vc5p, live.total), 0)} share` : '—', `src=gv&scope=day&date=${tk}&f=vc5p`),
      kpi('g5', 'Replacement', '🔁', U.fmt(live.replacement), live.total ? `${U.fmtPct(U.pctOf(live.replacement, live.total), 0)} of today` : '—', `src=gv&scope=day&date=${tk}&f=repl`),
      kpi('g7', 'Chassis', '🔧', U.fmt(live.chassis), live.total ? `${U.fmtPct(U.pctOf(live.chassis, live.total), 0)} of today` : '—', `src=gv&scope=day&date=${tk}&f=chassis`),
      kpi('g2', 'Expected Today', '🎯', expected != null ? U.fmt(expected) : '—',
        live.weekdayNote ? esc(live.weekdayNote) : 'pichhle same-weekday ka average',
        `src=gv&scope=day&date=${tk}`),
      kpi('g10', 'Today Highest Issued', '🏆',
        live.highest ? `<div class="hm-highest-list">
          <div><span>VC4</span><b>${esc(live.highest.VC4 ? live.highest.VC4.name : '—')}</b><strong>${U.fmt(live.highest.VC4 ? live.highest.VC4.n : 0)}</strong></div>
          <div><span>VC20</span><b>${esc(live.highest.VC20 ? live.highest.VC20.name : '—')}</b><strong>${U.fmt(live.highest.VC20 ? live.highest.VC20.n : 0)}</strong></div>
          <div><span>VC5+</span><b>${esc(live.highest['VC5+'] ? live.highest['VC5+'].name : '—')}</b><strong>${U.fmt(live.highest['VC5+'] ? live.highest['VC5+'].n : 0)}</strong></div>
        </div>` : '—',
        live.highest ? 'Class-wise highest issuer · Today' : 'GV Master load hone par class-wise highest dikhega',
        `src=gv&scope=day&date=${tk}&f=highest`)
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

  function monthKpiHtml(ctx, sf, sg, sc, lastRows) {
    const { curKey, prevKey, observedDay, compareDay, daysInMonth } = ctx;
    const reportDay = Math.max(0, observedDay);
    const lastSum = M.summary(lastRows, prevKey, compareDay, '');
    const lastFull = M.summary(lastRows, prevKey);
    const lastTotalFull = lastFull.total;
    // Expected uses only complete/report-available days. Today's live GV row is excluded
    // when FF/EIR is T+1, so today's partial day never inflates the monthly run-rate.
    const reportedRows = (sf.rows || []).filter((r) => r.ym !== curKey || Number(r.day) <= reportDay);
    const reportedSc = M.summary(reportedRows, curKey);
    const rate = observedDay ? reportedSc.total / observedDay : 0;
    const commercialRate = observedDay ? reportedSc.comm / observedDay : 0;
    const expected = observedDay ? Math.round(rate * daysInMonth) : 0;
    const expectedCommercial = observedDay ? Math.round(commercialRate * daysInMonth) : 0;
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
    const cards = [
      kpi('g9', `Last day · ${U.labelDate(y)}`, '🗓️', U.fmt(lastDayNow),
        `${momChip(lastDayNow, lastDayPrev, `${prevLabel} ${Math.min(yDay, U.daysInMonth(prevKey))}`)}<br>${splitFoot(yFf, yGv)}`,
        `src=both&scope=day&date=${yKey}`),
      kpi('g1', `${monthLabel} total (MTD)`, '🏷️', U.fmt(sc.total),
        `${momChip(sc.total, lastSum.total, `${prevLabel} ${observedDay} din`)}<br>${splitFoot(sf.ff ? M.summary(sf.ff, curKey).total : 0, sf.gv ? M.summary(sf.gv, curKey).total : 0)}`,
        `src=both&scope=mtd&ym=${curKey}`),
      kpi('g3', 'VC4', '🚗', U.fmt(sc.vc4), `${momChip(sc.vc4, lastSum.vc4)}<br>${splitFoot(M.summary(sf.ff, curKey).vc4, M.summary(sf.gv, curKey).vc4)}`, `src=both&scope=mtd&ym=${curKey}&f=vc4`),
      kpi('g8', 'VC20', '🛻', U.fmt(sc.vc20), `${momChip(sc.vc20, lastSum.vc20)}<br>${splitFoot(M.summary(sf.ff, curKey).vc20, M.summary(sf.gv, curKey).vc20)}`, `src=both&scope=mtd&ym=${curKey}&f=vc20`),
      kpi('g6', 'VC5+', '🚚', U.fmt(sc.vc5p), `${momChip(sc.vc5p, lastSum.vc5p)}<br>${splitFoot(M.summary(sf.ff, curKey).vc5p, M.summary(sf.gv, curKey).vc5p)}`, `src=both&scope=mtd&ym=${curKey}&f=vc5p`),
      kpi('g12', 'All Commercial · VC20 + VC5+', '🚛', U.fmt(sc.comm), `${momChip(sc.comm, lastSum.comm, `${prevLabel} · same ${Math.min(compareDay, U.daysInMonth(prevKey))} reported din`)}<br>Last month full <b>${U.fmt(lastFull.comm)}</b> · Expected this month <b>${U.fmt(expectedCommercial)}</b> <span class="dim">(report till ${observedDay ? esc(U.labelDateKey(`${curKey}-${String(observedDay).padStart(2,'0')}`)) : '—'})</span>`, `src=both&scope=mtd&ym=${curKey}&f=comm`),
      kpi('g5', 'Replacement', '🔁', U.fmt(sc.replacement), `${momChip(sc.replacement, lastSum.replacement)}<br>${splitFoot(M.summary(sf.ff, curKey).replacement, M.summary(sf.gv, curKey).replacement)}`, `src=both&scope=mtd&ym=${curKey}&f=repl`),
      kpi('g7', 'Chassis', '🔧', U.fmt(sc.chassis), `${momChip(sc.chassis, lastSum.chassis)}<br>${splitFoot(M.summary(sf.ff, curKey).chassis, M.summary(sf.gv, curKey).chassis)}`, `src=both&scope=mtd&ym=${curKey}&f=chassis`),
      kpi('g2', `Expected in ${U.labelYM(curKey)}`, '🎯',
        `<div class="hm-runrate-list hm-expected-list"><div><span>VC4</span><b>${U.fmt(observedDay ? Math.round((reportedSc.vc4 / observedDay) * daysInMonth) : 0)}</b></div><div><span>VC20</span><b>${U.fmt(observedDay ? Math.round((reportedSc.vc20 / observedDay) * daysInMonth) : 0)}</b></div><div><span>VC5+</span><b>${U.fmt(observedDay ? Math.round((reportedSc.vc5p / observedDay) * daysInMonth) : 0)}</b></div><div class="is-total"><span>Total Expected</span><b>${U.fmt(expected)}</b></div></div>`,
        `EIR forecast · ${observedDay}/${daysInMonth} reported days · today excluded<br><span class="dim">Report till <b>${observedDay ? esc(U.labelDateKey(`${curKey}-${String(observedDay).padStart(2,'0')}`)) : '—'}</b> · last month full <b>${U.fmt(lastTotalFull)}</b> · expected <b>${U.fmt(lastExpected)}</b></span>`,
        `src=both&scope=mtd&ym=${curKey}`),
      kpi('g13', 'Run Rate · Per Day', '⚡',
        `<div class="hm-runrate-list"><div><span>VC4</span><b>${U.fmt(observedDay ? reportedSc.vc4 / observedDay : 0, true)}</b></div><div><span>VC20</span><b>${U.fmt(observedDay ? reportedSc.vc20 / observedDay : 0, true)}</b></div><div><span>VC5+</span><b>${U.fmt(observedDay ? reportedSc.vc5p / observedDay : 0, true)}</b></div><div class="is-total"><span>Total Run Rate</span><b>${U.fmt(rate, true)}</b></div></div>`,
        `Daily average · EIR till ${esc(ctx.receivedDate ? U.labelDate(ctx.receivedDate, true) : '—')} · 1 day lag`,
        `src=both&scope=mtd&ym=${curKey}`)
    ];
    return card(`📅 ${esc(monthLabel)} · KPI cards <span class="dim">· issuance EIR se (GV = master ID ${esc(FF.config.eir.gvMasterId || '5845036')}, baaki FF)${sg.liveToday ? ' · GV aaj GV Master se live' : ''} · har card ke andar last month vs current month + %</span>`,
      `<div class="kpi-grid mini hm-month-grid">${cards.join('')}</div>`,
      `<a class="btn small" href="#/tagIssued?period=month">🏷️ Tag Issued →</a><a class="btn small" href="#/trend">📈 Trend →</a>`);
  }

  // 🎯 Class-wise target achievement. Actual counts are scoped to agents who have a target for that class.
  const TARGET_CLASSES = [{ key: 'vc4', label: 'VC4', group: 'VC4', icon: '🚗', color: 'g3', gvField: 'vc4' }, { key: 'vc20', label: 'VC20', group: 'VC20', icon: '🛻', color: 'g8', gvField: 'vc20' }, { key: 'vc5p', label: 'VC5+', group: 'VC5+', icon: '🚚', color: 'g6', gvField: 'vc5p' }];
  const targetAgentKey = (source, name) => `${source}|${U.clean(name).toUpperCase().replace(/\\s+/g, ' ')}`;
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
    return { classes: stats, totalTarget, totalIssued, totalRemaining: Math.max(0, totalTarget - totalIssued), totalPct: totalTarget > 0 ? (totalIssued / totalTarget) * 100 : null, configured: totalTarget > 0 };
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
  async function render(root) {
    const u = FF.auth.user || {};
    const avatar = u.avatar ? `<img class="home-avatar" src="${esc(u.avatar)}" alt="">` : `<div class="home-avatar mono-logo">${esc((u.name || u.username || 'U').slice(0, 1).toUpperCase())}</div>`;
    const canFf = FF.auth.can('dashboard') || FF.auth.can('trend') || FF.auth.can('stock') || FF.auth.can('performance');
    const canGv = FF.auth.can('gvDashboard') || FF.auth.can('gvTrend') || FF.auth.can('gvStock') || FF.auth.can('gvPerformance');

    root.innerHTML = `<div class="home-hero v2">
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
          <button class="btn" id="home-morning-card" title="Boss ke liye WhatsApp Good-Morning card (PNG)">📲 Morning Card</button>
          <a class="btn" href="#/tagIssued">🏷️ Tag Issued →</a>
        </div>
      </div>
      <div id="home-gv-live">${U.spinner('GV aaj ka live data aaya ja raha hai…')}</div>
      <div id="home-month">${U.spinner('EIR se month KPI cards ban rahe hain…')}</div>
      <div id="home-target-achievement">${U.spinner('Class-wise target achievement calculate ho raha hai…')}</div>
      <div id="home-pulse"></div>
      <div id="home-charts">${U.spinner('Charts…')}</div>
      <div id="home-stock">${U.spinner('Stock (StockDataa + Tag Assignment)…')}</div>
      <p class="foot-note">🟩 GV aaj = <b>GV Master sheet</b> (live) · 🧾 Issuance history = <b>EIR</b> (GV = master ID ${esc(FF.config.eir.gvMasterId || '5845036')}, baaki FF) · 📦 Stock = <b>StockDataa</b> (FF) + <b>Tag Assignment</b> (GV) · 🟦 FF ka issuance T+1 aata hai · 🔎 Global search top bar par hai · full profile/results Management → Master Search me.</p>`;

    const quick = U.$('#home-quick', root);
    if (quick) quick.innerHTML = `<div class="chip-row"><span class="chip on">🟩 GV aaj · GV Master (live)</span><span class="chip">🧾 EIR: FF + GV history</span><span class="chip dim">📦 Stock: StockDataa + Tag Assignment</span></div>`;

    const gvLiveMount = U.$('#home-gv-live', root);
    const monthMount = U.$('#home-month', root);
    const chartMount = U.$('#home-charts', root);
    const pulseMount = U.$('#home-pulse', root);
    const targetAchievementMount = U.$('#home-target-achievement', root);
    const stockMount = U.$('#home-stock', root);

    // ⚡ Home first paint: GV-only today endpoint is intentionally separate from the heavier
    // FF+GV history feed. This makes "AAJ KA LIVE" visible even when 30-day history is slow.
    const liveP = canGv
      ? FF.data.gvToday().catch((err) => ({ requestError: err && err.message ? err.message : 'GV today feed request failed' }))
      : Promise.resolve(null);
    const feedP = (canFf || canGv)
      ? FF.data.today().catch((err) => ({ requestError: err && err.message ? err.message : 'today feed request failed' }))
      : Promise.resolve(null);
    const dailyP = (canFf || canGv) ? S.need('daily').catch(() => null) : Promise.resolve(null);
    const stockP = canFf ? S.need('stock').catch(() => null) : Promise.resolve(null);
    const gvStockP = canGv ? G.need('stockClass').catch(() => null) : Promise.resolve(null);
    const gvMasterP = canGv ? G.need('master').catch(() => null) : Promise.resolve(null);
    const currentTargetYm = U.ymKey(TODAY());
    const savedTargetsForMonth = ((FF.auth.settings && FF.auth.settings.targets) || []).filter((t) => t && t.ym === currentTargetYm && classTargetsConfigured(t) && ((targetSource(t) === 'ff' && canFf) || (targetSource(t) === 'gv' && canGv)));
    const needsFfTargetData = savedTargetsForMonth.some((t) => targetSource(t) === 'ff');
    const needsGvTargetData = savedTargetsForMonth.some((t) => targetSource(t) === 'gv');
    const targetClassDataP = savedTargetsForMonth.length ? Promise.all([
      S.need('agentClass').then((rows) => ({ rows: Array.isArray(rows) ? rows : [], error: '' })).catch((err) => ({ rows: null, error: err && err.message || 'Agent class data unavailable' })),
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
      total: 0, vc4: 0, vc20: 0, vc5p: 0, replacement: 0, chassis: 0, highest: null,
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
      const wdNote = wdBars ? `pichhle ${wdBars.labels.length} same-weekday (${wdBars.labels.map((l) => `${l} = ${U.fmt(wdBars.values[wdBars.labels.indexOf(l)])}`).join(' · ')}) ka average` : '';
      gvLiveMount.innerHTML = gvLiveHtml({ ...liveState, pace, weekdayNote: wdNote, weekdayBars: wdBars });
    }
    // 🧩 Merge fix: yeh teen painter main me call hote the par define nahi the (Home render
    //    ReferenceError: paintMonth is not defined → poore KPI cards gayab). Base v3.47 se wapas.
    function paintMonth() {
      if (!monthMount || !monthMount.isConnected || !ui.ready) return;
      monthMount.innerHTML = monthKpiHtml(ui.ctx, ui.sf, { liveToday: ui.liveToday }, ui.sc, ui.sf.rows);
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
    function paintPulse(stock) {
      if (!pulseMount || !pulseMount.isConnected || !ui.ready) return;
      pulseMount.innerHTML = managementPulseHtml(ui.ctx, ui.sf, liveState, stock || null);
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
        replacement: snap.replacement, chassis: snap.chassis, highest: gvTodayHighest(snap.rows),
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
    ui.ready = true; ui.sf = sf; ui.ctx = ctx; ui.sc = sc; ui.liveToday = st.gvLiveAdded;
    paintMonth();
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
    if (canGv) {
      G.need('stockAgent').then((rows) => {
        if (!rows || !stockMount.isConnected) return;
        const top = [...rows].sort((a, b) => (b.n || 0) - (a.n || 0)).slice(0, 5).map((r) => ({ name: r.agentName || r.agentId || '—', n: r.n }));
        const host = stockMount.querySelectorAll('.hm-toplist')[1];
        if (host && top.length) host.innerHTML = top.map((r, i) => `<div class="hm-toprow"><span class="rank">${i + 1}</span><b>${esc(r.name)}</b><span class="tag gv">GV</span><strong>${U.fmt(r.n)}</strong></div>`).join('');
      }).catch(() => {});
    }

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
  }

  FF.pages.home = {
    title: 'Home', render, monthKpiHtml, streams, liveRowsFromFeed, targetAchievementSummary, targetAchievementHtml,
    explorer: {
      state: explorerFilters, filterRows: filterExplorerRows, totals: explorerTotals, daily: explorerDaily, html: explorerHtml,
      dateKey: explorerDateKey, rangePreset: explorerRangePreset, reset: resetExplorerFilters,
      loadFilters: loadExplorerFilters, saveFilters: saveExplorerFilters
    }
  };
})(window.FF);
