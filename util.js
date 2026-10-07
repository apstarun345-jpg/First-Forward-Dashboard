/* Shared helpers: formatting, dates, DOM, CSV export, toast, tooltip. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';

  const fmtInt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  const fmtDec1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
  const fmtDec2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function clean(text) { return String(text ?? '').trim(); }

  function num(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const text = String(value).replace(/[,\s%₹]/g, '').trim();
    if (!text || text === '-' || text === '—' || /^na$/i.test(text)) return null;
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }
  function fmt(value, decimals) {
    const n = typeof value === 'number' ? value : num(value);
    if (n === null || !Number.isFinite(n)) return '—';
    if (decimals === 2) return fmtDec2.format(n);
    if (decimals) return fmtDec1.format(n);
    return fmtInt.format(n);
  }
  function fmtShort(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e7) return (n / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr';
    if (a >= 1e5) return (n / 1e5).toFixed(2).replace(/\.?0+$/, '') + ' L';
    if (a >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return fmtInt.format(n);
  }
  function pctOf(part, total) {
    if (!total) return null;
    return (part / total) * 100;
  }
  function growth(current, previous) {
    if (previous === null || previous === undefined || !previous) return null;
    return ((current - previous) / Math.abs(previous)) * 100;
  }
  function fmtPct(p, decimals) {
    if (p === null || p === undefined || !Number.isFinite(p)) return '—';
    return `${p.toFixed(decimals === undefined ? 1 : decimals)}%`;
  }
  function fmtSigned(p, decimals) {
    if (p === null || p === undefined || !Number.isFinite(p)) return '—';
    const d = decimals === undefined ? 1 : decimals;
    return `${p > 0 ? '+' : ''}${p.toFixed(d)}%`;
  }
  function deltaHtml(p, opts) {
    const o = opts || {};
    if (p === null || p === undefined || !Number.isFinite(p)) return `<span class="delta flat">— ${esc(o.suffix || '')}</span>`;
    const cls = p > 0.05 ? 'up' : p < -0.05 ? 'down' : 'flat';
    const arrow = cls === 'up' ? '▲' : cls === 'down' ? '▼' : '•';
    return `<span class="delta ${cls}">${arrow} ${fmtSigned(p, o.decimals)} ${esc(o.suffix || '')}</span>`;
  }
  /** Signed % with colour — minus RED, plus GREEN + bold (site-wide rule). */
  function pctHtml(p, opts) {
    const o = opts || {};
    if (p === null || p === undefined || !Number.isFinite(p)) return '<span class="dim">—</span>';
    const d = o.decimals === undefined ? 1 : o.decimals;
    const cls = p > 0 ? 'pos' : p < 0 ? 'neg' : 'flat';
    const arrow = o.arrows === false ? '' : (p > 0 ? '▲ ' : p < 0 ? '▼ ' : '');
    return `<span class="pct ${cls}">${arrow}${p > 0 ? '+' : ''}${p.toFixed(d)}%</span>`;
  }

  // ---- 🎯 suggested dispatch (run-rate based) ---------------------------------
  /** Kitne din ka suggestion banana hai — Settings → ⚙️ Alert modify me set hota hai. */
  function suggestDays() {
    try { return Number(FF.config && FF.config.features && FF.config.features.suggestDays) || 15; } catch { return 15; }
  }
  /** Kaise dikhaye — 'both' (default: stock − aur bina stock dono) | 'net' | 'gross'. */
  function suggestMode() {
    try {
      const m = FF.config && FF.config.features && FF.config.features.suggestMode;
      return m === 'net' || m === 'gross' ? m : 'both';
    } catch { return 'both'; }
  }
  /** Net requirement = avg/day × din − stock (stock ghatane ke baad). */
  function suggestNet(avg, stock, days) {
    const d = days || suggestDays();
    return Math.max(0, Math.ceil((Number(avg) || 0) * d - (Number(stock) || 0)));
  }
  /** Gross requirement = avg/day × din (bina stock ghataye — pure run-rate need). */
  function suggestGross(avg, days) {
    const d = days || suggestDays();
    return Math.max(0, Math.ceil((Number(avg) || 0) * d));
  }
  /** 📐 RUN-RATE (poori site ka ek hi formula) — user ki FF + GV Google Sheet jaisa:
        run-rate = (data wale) month ka total issue ÷ (aaj ki date − 1)
      ⚠️ v3.31 fix: "aaj − 1" ab ek DATE hai, sirf din ka number nahi. Pehle `max(1, aaj.getDate() − 1)` tha —
      1 tareekh ko 1 − 1 = 0 → 1 din, jabki FF sheet (kal = 30 Sep tak ka data) pura September ÷ 30 karti hai.
      Isliye 1 tareekh ko run-rate, Required, WITH / W/O stock dispatch sab ~30× bade aate the.
        FF (T+1 data) → din = jis din tak FF ka data aaya (EIR latest / REPORT ka 7-day header), kabhi
                        (aaj − 1) se aage nahi. 1 Oct → 30 Sep → 30 din, data month = September.
        GV (live)     → data month = is month → max(1, aaj − 1) (GV sheet jaisa) · aaj abhi GV data nahi aaya
                        aur pichhla month hi latest hai (1 tareekh subah) → us month ke poore din.
      runRateDays(now?, ch?) · runRate(issued, ch?) — ch: 'ff' (default) | 'gv'. */
  const DAY_MS = 86400e3;
  const sod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const isGvCh = (ch) => /^gv/i.test(String(ch || '').trim());
  function ffLagCfg() {
    const raw = typeof FF !== 'undefined' && FF.config ? FF.config.ffIssuanceLagDays : undefined;
    const n = Number(raw);
    return raw === undefined || raw === null || raw === '' || !Number.isFinite(n) || n < 0 ? 1 : Math.floor(n);
  }
  /** FF ka data kis din tak ho sakta hai: aaj − lag (kam se kam 1 — sheet bhi DAY(TODAY()−1) se ginti hai). */
  function ffCapDate(now) { return addDays(sod(now instanceof Date ? now : new Date()), -Math.max(1, ffLagCfg())); }
  /** REPORT "Performance In 7 Days" header (e.g. "30/Sep", "30-Sep-2026", "Sep 30", "30/09", Date(2026,8,30))
      → Date. Saal na ho to sabse naya saal jisme date `ref` se aage na jaaye (1 Jan ko "31/Dec" = pichhla saal). */
  function parseDayLabel(label, ref) {
    const t = clean(label);
    if (!t) return null;
    let mt = t.match(/Date\((\d{4}),(\d{1,2}),(\d{1,2})/);
    if (mt) return new Date(+mt[1], +mt[2], +mt[3]);
    mt = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (mt) return new Date(+mt[1], +mt[2] - 1, +mt[3]);
    let d = 0, m = -1, y = null;
    if ((mt = t.match(/(\d{1,2})[\s/.\-]*([A-Za-z]{3,})\.?(?:[\s/.\-,]+(\d{2,4}))?/))) { d = +mt[1]; m = monthIndex(mt[2]); y = mt[3] ? +mt[3] : null; }
    else if ((mt = t.match(/([A-Za-z]{3,})\.?[\s/.\-]*(\d{1,2})(?:[\s/.\-,]+(\d{2,4}))?/))) { m = monthIndex(mt[1]); d = +mt[2]; y = mt[3] ? +mt[3] : null; }
    else if ((mt = t.match(/^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?$/))) { d = +mt[1]; m = +mt[2] - 1; y = mt[3] ? +mt[3] : null; }
    if (!(d >= 1 && d <= 31) || !(m >= 0 && m <= 11)) return null;
    if (y !== null && y < 100) y += 2000;
    const base = ref instanceof Date ? ref : new Date();
    if (y === null) { y = base.getFullYear(); if (new Date(y, m, d) > addDays(sod(base), 1)) y -= 1; }
    const out = new Date(y, m, d);
    return out.getMonth() === m ? out : null;
  }
  /** Sirf din ka number (label me month nahi) → `cap` ke month me; cap se aage ho to pichhle month me. */
  function dayOnOrBefore(cap, day) {
    let d = new Date(cap.getFullYear(), cap.getMonth(), day);
    if (d > cap || d.getMonth() !== cap.getMonth()) {
      const pm = new Date(cap.getFullYear(), cap.getMonth() - 1, 1);
      d = new Date(pm.getFullYear(), pm.getMonth(), Math.min(day, new Date(pm.getFullYear(), pm.getMonth() + 1, 0).getDate()));
    }
    return d;
  }
  /** FF EIR (authoritative ledger) ka latest din ≤ cap — performance isi se current month chunta hai. */
  const eirLatestCache = { ref: null, len: -1, cap: '', value: null };
  function ffEirLatest(cap) {
    const S = typeof FF !== 'undefined' ? FF.store : null;
    if (!S || typeof S.get !== 'function') return null;
    let daily = null;
    try { daily = S.get('daily'); } catch { daily = null; }
    if (!Array.isArray(daily) || !daily.length) return null;
    const capKey = cap ? dateKey(cap) : '9999-12-31';
    const c = eirLatestCache;
    if (c.ref === daily && c.len === daily.length && c.cap === capKey) return c.value;
    let best = '';
    for (const r of daily) {
      if (!r || r.channel === 'GV Partner') continue;
      const k = r.key || (r.d instanceof Date ? dateKey(r.d) : '');
      if (k && k > best && k <= capKey) best = k;
    }
    c.ref = daily; c.len = daily.length; c.cap = capKey; c.value = best ? fromDateKey(best) : null;
    return c.value;
  }
  /** GV data ka latest din (live GV Master / EIR) — 15s cache (har agent par dobara scan na ho). */
  const gvLatestCache = { at: 0, value: null };
  function gvLatest(force) {
    if (!force && Date.now() - gvLatestCache.at < 15000) return gvLatestCache.value;
    let v = null;
    try { const G = typeof FF !== 'undefined' ? FF.gv : null; v = G && typeof G.latestDate === 'function' ? G.latestDate() : null; } catch { v = null; }
    gvLatestCache.at = Date.now(); gvLatestCache.value = v instanceof Date && !isNaN(v) ? sod(v) : null;
    return gvLatestCache.value;
  }
  /** Basis object — { ch, day, days, date, key, ym, monthDays, back, label, shortLabel, live, fromReport, fromEir, fromData, capped, sheetLabel }. */
  function mkBasis(now, date, extra) {
    const e = extra || {};
    const days = Math.max(1, Number(e.days) || date.getDate());
    const back = Math.max(0, Math.round((sod(now) - sod(date)) / DAY_MS));
    return {
      live: false, sheetLabel: '', fromReport: false, fromEir: false, fromData: false, capped: false, ...e,
      day: date.getDate(), days, back, date, key: dateKey(date), ym: ymKey(date), monthDays: daysInMonth(ymKey(date)),
      label: `${dateKey(date)} (${weekday(date)})`, shortLabel: labelDate(date)
    };
  }
  function ffBasis(now) {
    const cap = ffCapDate(now);
    const P = (typeof FF !== 'undefined' && FF.pages && FF.pages.performance) || null;
    let sheetLabel = '', sheetDay = 0;
    try { const labels = (P && P.dayLabels && P.dayLabels()) || []; sheetLabel = clean(labels[labels.length - 1]); } catch { sheetLabel = ''; }
    try { sheetDay = Number(P && P.daysElapsed && P.daysElapsed()) || 0; } catch { sheetDay = 0; }
    let date = null, src = '';
    const eir = ffEirLatest(cap);
    if (eir) { date = eir; src = 'eir'; }
    if (!date) { const d = parseDayLabel(sheetLabel, cap); if (d) { date = d; src = 'report'; } }
    if (!date && sheetDay >= 1 && sheetDay <= 31) { date = dayOnOrBefore(cap, sheetDay); src = 'report'; }
    const fromData = !!date;
    if (!date) date = cap;
    let capped = false;
    if (date > cap) { date = cap; capped = true; }                    // aaj ka adhoora data kabhi count nahi
    return mkBasis(now, sod(date), { ch: 'ff', live: false, sheetLabel, fromReport: src === 'report', fromEir: src === 'eir', fromData, capped, days: date.getDate() });
  }
  function gvBasis(now, force) {
    const today = sod(now);
    const latest = gvLatest(force);
    const date = latest && latest <= today ? latest : today;
    const sameMonth = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth();
    const days = sameMonth ? Math.max(1, today.getDate() - 1) : date.getDate();
    return mkBasis(now, sameMonth ? today : date, { ch: 'gv', live: true, fromData: !!latest, days });
  }
  const basisCache = { ff: null, gv: null };
  function basisSig(gv) {
    if (gv) return `gv|${(gvLatest() || '').toString()}`;
    const P = (typeof FF !== 'undefined' && FF.pages && FF.pages.performance) || null;
    let lab = '', day = '', len = 0;
    try { const l = (P && P.dayLabels && P.dayLabels()) || []; lab = l[l.length - 1] || ''; day = String((P && P.daysElapsed && P.daysElapsed()) || ''); } catch { /* */ }
    try { const d = FF.store && FF.store.get && FF.store.get('daily'); len = Array.isArray(d) ? d.length : 0; } catch { len = 0; }
    return `ff|${lab}|${day}|${len}`;
  }
  /** 📅 Channel-wise data basis (ek hi jagah) — opts: { now: Date, force: true }. */
  function dataBasis(ch, opts) {
    const o = opts || {};
    const gv = isGvCh(ch);
    const k = gv ? 'gv' : 'ff';
    const custom = o.now instanceof Date;
    const now = custom ? o.now : new Date();
    const sig = custom ? '' : basisSig(gv);
    const c = basisCache[k];
    if (!o.force && !custom && c && Date.now() - c.at < 30000 && c.sig === sig && c.day === dateKey(now)) return c.value;
    const value = gv ? gvBasis(now, custom || !!o.force) : ffBasis(now);
    if (!custom) basisCache[k] = { at: Date.now(), sig, day: dateKey(now), value };
    return value;
  }
  function runRateDays(now, ch) {
    if (typeof now === 'string' && ch === undefined) { ch = now; now = undefined; }
    return dataBasis(ch, { now: now instanceof Date ? now : undefined }).days;
  }
  /** runRate(issued) · runRate(issued, 'gv') · runRate(issued, date) · runRate(issued, date, 'gv') */
  function runRate(issued, a, b) {
    let now, ch;
    if (typeof a === 'string') ch = a; else { now = a; ch = b; }
    const days = Number(((FF.util && FF.util.runRateDays) || runRateDays)(now, ch)) || 1;
    return (Number(issued) || 0) / Math.max(1, days);
  }
  /** 📅 FF basis (REPORT / EIR) — purana naam; ab month-aware. */
  function reportBasis(opts) { return channelBasis('ff', opts); }
  /** 📅 Channel-wise basis — 'gv' (ya 'GV Partner') = LIVE · baaki sab (FF) = kal tak ka data. */
  function channelBasis(ch, opts) {
    const o = opts || {};
    const b = dataBasis(ch, o);
    // Tests / special pages `U.runRateDays` ko stub karte hain — tab bhi sab jagah ek hi divisor rahe.
    const fn = typeof FF !== 'undefined' && FF.util && FF.util.runRateDays;
    if (fn && fn !== runRateDays) { const d = Number(fn(o.now, isGvCh(ch) ? 'gv' : 'ff')); if (d > 0 && d !== b.days) return { ...b, days: d }; }
    return b;
  }
  /** 🗣️ Basis ki line — simple bhasha me, "T-1" jaisa technical shabd nahi. */
  function basisText(ch, b) {
    const live = b ? !!b.live : isGvCh(ch);
    const bb = b || channelBasis(live ? 'gv' : 'ff');
    const thisMonth = bb.ym === ymKey(new Date());
    return live
      ? `Live data — aaj tak ka data (${esc(bb.shortLabel)}) · run-rate ÷ ${bb.days} din (aaj − 1)${thisMonth ? '' : ` · ${esc(labelYM(bb.ym))} ka poora data`}`
      : `Data till ${esc(bb.shortLabel)} — aaj ka data kal aata hai, isliye run-rate ${bb.days} din ka${thisMonth ? '' : ` (${esc(labelYM(bb.ym))} ka poora mahina)`}`;
  }
  /** 🔮 Month-end projection: (issued ÷ basis din) × us month ke din. */
  function projectMonthEnd(issued, elapsed, ym) {
    const n = Number(issued) || 0;
    if (n <= 0) return 0;
    const days = Number(elapsed) > 0 ? Number(elapsed) : reportBasis().days;
    const total = ym && /^\d{4}-\d{2}$/.test(String(ym)) ? daysInMonth(ym) : 30;
    return Math.round((n / days) * total);
  }
  /** 🚚 Dispatch calculation ek jagah: rate = cur ÷ (today−1) · required = rate × suggestDays ·
      net (WITH stock) = required − stock · gross (W/O stock) = required · cover = stock ÷ rate din.
      `elapsed` diya ho to usi basis par; warna `ch` ('ff' | 'gv') ka basis (runRateDays). */
  function dispatchCalc(o) {
    o = o || {};
    const days = o.days || suggestDays();
    const cur = Number(o.cur) || 0, last = Number(o.last) || 0, stock = Number(o.stock) || 0;
    const elapsed = Number(o.elapsed) > 0 ? Number(o.elapsed) : (((FF.util && FF.util.runRateDays) || runRateDays)(undefined, o.ch));
    const rate = cur / elapsed;
    const required = Math.max(0, Math.ceil(rate * days));
    return {
      days, elapsed, cur, last, stock, rate, required,
      net: Math.max(0, Math.ceil(rate * days - stock)),
      gross: required,
      cover: rate > 0 ? stock / rate : null,
      growth: last > 0 ? ((cur - last) / last) * 100 : null
    };
  }
  /** Dono criteria ek saath: { days, mode, net (stock −), gross (bina stock) }. */
  function suggestPair(avg, stock) {
    const days = suggestDays();
    return { days, mode: suggestMode(), net: suggestNet(avg, stock, days), gross: suggestGross(avg, days) };
  }
  /** Inline dispatch quantities — gross is explicitly labelled and visually prominent. */
  function sugCell(net, gross, chipClass) {
    const mode = suggestMode();
    const chip = (n, cls) => `<b class="sug-chip${cls ? ` ${cls}` : ''}${chipClass ? ` ${chipClass}` : ''}">${fmt(n)}</b>`;
    const grossBlock = `<span class="sug-result gross" title="Run-rate × target days; stock is not subtracted"><small>Without subtracting stock</small>${chip(gross, 'wo')}</span>`;
    const netBlock = `<span class="sug-result net" title="Required quantity after subtracting stock"><small>After stock</small>${chip(net)}</span>`;
    if (mode === 'net') return netBlock;
    if (mode === 'gross') return grossBlock;
    return `<span class="sug-pair">${netBlock}${grossBlock}</span>`;
  }
  /** Compact inline text (suggestions / kundli ke liye) — "net · w/o gross". */
  function sugText(net, gross) {
    const mode = suggestMode();
    if (mode === 'net') return fmt(net);
    if (mode === 'gross') return `w/o ${fmt(gross)}`;
    return `${fmt(net)} · w/o ${fmt(gross)}`;
  }

  // ---- dates -----------------------------------------------------------------
  const pad2 = (n) => String(n).padStart(2, '0');
  function monthIndex(name) {
    const n = clean(name).toLowerCase().slice(0, 3);
    return MONTHS.findIndex((m) => m.toLowerCase() === n);
  }
  function parseDate(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return isNaN(value) ? null : value;
    const s = clean(value);
    let m;
    if ((m = s.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})/))) return new Date(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/))) return new Date(+m[1], +m[2] - 1, +m[3]);
    if ((m = s.match(/^(\d{1,2})[-/ .]([A-Za-z]{3,9})[-/ .,]*(\d{2,4})?/))) {
      const mi = monthIndex(m[2]);
      if (mi >= 0) {
        let y = m[3] ? +m[3] : new Date().getFullYear();
        if (y < 100) y += 2000;
        return new Date(y, mi, +m[1]);
      }
    }
    if ((m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/))) {
      const mi = monthIndex(m[1]);
      if (mi >= 0) return new Date(+m[3], mi, +m[2]);
    }
    if ((m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})(?:[ T].*)?$/))) {
      let y = +m[3]; if (y < 100) y += 2000;
      return new Date(y, +m[2] - 1, +m[1]); // dd-mm-yyyy (Indian format)
    }
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }
  // "September26" / "Sep-26" / "2026-09" → "2026-09"
  function parseMonthKey(value) {
    const s = clean(value);
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})$/))) return `${m[1]}-${pad2(+m[2])}`;
    if ((m = s.match(/^([A-Za-z]{3,9})[-\s']?(\d{2,4})$/))) {
      const mi = monthIndex(m[1]);
      if (mi < 0) return null;
      let y = +m[2]; if (y < 100) y += 2000;
      return `${y}-${pad2(mi + 1)}`;
    }
    const d = parseDate(s);
    return d ? ymKey(d) : null;
  }
  function ymKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
  function dateKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function fromDateKey(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }
  function ymParts(key) { const [y, m] = key.split('-').map(Number); return { y, m }; }
  // 🌐 महीने / दिन के नाम भी भाषा के हिसाब से (Hinglish = source, English / हिंदी local)
  const MONTHS_HI = ['जन', 'फ़र', 'मार्च', 'अप्रै', 'मई', 'जून', 'जुल', 'अग', 'सित', 'अक्तू', 'नव', 'दिस'];
  const MONTHS_LONG_HI = ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्तूबर', 'नवंबर', 'दिसंबर'];
  const DAYS_HI = ['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि'];
  const monthList = (long) => (uiLang() === 'hi' ? (long ? MONTHS_LONG_HI : MONTHS_HI) : (long ? MONTHS_LONG : MONTHS));
  const dayList = () => (uiLang() === 'hi' ? DAYS_HI : DAYS);
  /** फ़िल्टर/चार्ट की भाषा पकड़ो ताकि नया label सही भाषा में बने. */
  function uiLang() {
    try {
      const l = localStorage.getItem('ff_lang');
      return l === 'hi' || l === 'en' ? l : 'hinglish';
    } catch { return 'hinglish'; }
  }
  function labelYM(key, long) {
    if (!key) return '—';
    const { y, m } = ymParts(key);
    return `${monthList(long)[m - 1]} ${y}`;
  }
  function labelDate(d, withYear) {
    if (!d) return '—';
    return `${pad2(d.getDate())} ${monthList(false)[d.getMonth()]}${withYear ? ' ' + d.getFullYear() : ''}`;
  }
  function labelDateKey(key, withYear) { return labelDate(fromDateKey(key), withYear); }
  function weekday(d) { return dayList()[d.getDay()]; }
  function daysInMonth(key) { const { y, m } = ymParts(key); return new Date(y, m, 0).getDate(); }
  function prevMonthKey(key) { const { y, m } = ymParts(key); return m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`; }
  function nextMonthKey(key) { const { y, m } = ymParts(key); return m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`; }
  // ISO-week Monday for a date
  function weekStart(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - day);
    return x;
  }
  function timeLabel(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  // ---- 🏷️ Barcode / serial (dash symbol ke saath) ------------------------------------------------
  // Sheet me barcode ek 16-digit number hota hai (6000000110000000 jaisa). Field me padhne,
  // bolne aur scan karne me aasaani ke liye use hamesha 6-3-7 me dikhate hain:
  //   608116-011-0558601
  // Search hamesha dono format me chalti hai (clean() dash hata deta hai), sirf display format hai.
  const digitsOnly = (v) => String(v ?? '').replace(/\D/g, '');
  /** 16-digit barcode ko 6-3-7 me dikhao (608116-011-0558601). Baaki values waise hi rehti hain. */
  function barcode(v) {
    const raw = clean(v);
    if (!raw) return '';
    // Sheet me kabhi number, kabhi text — dono handle karo:
    //   • 6081160110558601      → 608116-011-0558601
    //   • 608116-011-0558601    → wahi (normalise ho kar)
    //   • 6.08116E+15 (number format) → exact digits
    //   • "BC123" / tag ID jaise alphanumeric → chhoo mat
    let text = raw;
    const sci = /^-?\d(?:\.\d+)?e\+?\d+$/i.test(text);
    if (sci) { const n = Number(text); if (Number.isFinite(n)) text = BigInt(Math.round(n)).toString(); }
    if (!/^[\d\s.-]+$/.test(text)) return raw;
    const d = digitsOnly(text.replace(/\.\d+$/, '')); // trailing .0 hata do
    if (!d) return raw;
    const grouped = (x) => `${x.slice(0, 6)}-${x.slice(6, 9)}-${x.slice(9)}`;
    if (d.length === 16) return grouped(d);
    // 17-20 digit bhi 6-3-rest group me — sheet me kabhi kabhi extra digit hota hai.
    if (d.length >= 17 && d.length <= 20) return grouped(d);
    return raw;
  }
  /** Barcode ko comparison/search ke liye normalize karo — sirf digits/alnum (dash, space hata do). */
  const barcodeKey = (v) => clean(v).toUpperCase().replace(/[^A-Z0-9]/g, '');

  // ---- collections -----------------------------------------------------------
  function sum(list, getter) {
    let total = 0;
    for (const item of list) { const v = getter ? getter(item) : item; if (typeof v === 'number' && Number.isFinite(v)) total += v; }
    return total;
  }
  function groupSum(list, keyFn, valueFn) {
    const map = new Map();
    for (const item of list) {
      const k = keyFn(item);
      if (k === null || k === undefined || k === '') continue;
      map.set(k, (map.get(k) || 0) + (valueFn ? valueFn(item) : 1));
    }
    return map;
  }
  function topEntries(map, n) {
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n || map.size);
  }
  function sortBy(list, getter, desc) {
    return [...list].sort((a, b) => {
      const x = getter(a), y = getter(b);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x < y ? -1 : 1) * (desc ? -1 : 1);
    });
  }
  function uniq(list) { return [...new Set(list)]; }

  // ---- DOM -------------------------------------------------------------------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return [...(root || document).querySelectorAll(sel)]; }
  function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function debounce(fn, ms) {
    let timer = null;
    return function (...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), ms); };
  }

  // Consistent async button feedback. Cloud-backed saves can take a few seconds; disabling the
  // button + showing a real spinner makes it clear that the request is progressing (not hung).
  const busyButtons = new WeakMap();
  function setButtonBusy(button, busy, label) {
    if (!button) return false;
    if (busy) {
      if (busyButtons.has(button)) return false;
      busyButtons.set(button, { html: button.innerHTML, disabled: button.disabled, aria: button.getAttribute('aria-busy') });
      button.classList.add('is-busy');
      button.setAttribute('aria-busy', 'true');
      button.disabled = true;
      if (label) button.textContent = label;
      return true;
    }
    const old = busyButtons.get(button);
    if (!old) return false;
    button.innerHTML = old.html;
    button.disabled = old.disabled;
    button.classList.remove('is-busy');
    if (old.aria === null) button.removeAttribute('aria-busy'); else button.setAttribute('aria-busy', old.aria);
    busyButtons.delete(button);
    return true;
  }
  async function withButtonBusy(button, action, label) {
    if (!setButtonBusy(button, true, label || 'Please wait…')) return undefined;
    try { return await (typeof action === 'function' ? action() : action); }
    finally { setButtonBusy(button, false); }
  }
  function toast(message, kind) {
    let el = $('#toast');
    if (!el) { el = h('<div id="toast" class="toast" hidden></div>'); document.body.appendChild(el); }
    el.textContent = message;
    el.className = `toast ${kind || ''}`;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.hidden = true; }, 3000);
  }
  // ---- 🌀 loaders (v3.31) — alag-alag style, hamesha animate (Reduce motion me bhi; CSS dekho) ----------
  const LOADER_STYLES = ['ring', 'dots', 'bars', 'pulse', 'tag', 'orbit'];
  const LOADER_LABELS = { mix: 'Mix — har baar naya style', ring: 'Ring (do ghoomte arcs)', dots: 'Dots (uchhalte)', bars: 'Bars (equalizer)', pulse: 'Pulse (radar)', tag: 'FASTag scan', orbit: 'Orbit (satellites)' };
  const LOADER_INNER = {
    ring: '<i></i><i></i>',
    dots: '<i></i><i></i><i></i>',
    bars: '<i></i><i></i><i></i><i></i><i></i>',
    pulse: '<i></i><i></i><b></b>',
    tag: '<span><b></b><em></em></span><i></i>',
    orbit: '<b></b><i></i><i></i>'
  };
  let loaderTurn = Math.floor(Math.random() * LOADER_STYLES.length);
  /** User ki pasand (♿ Accessibility panel) — 'mix' (default) = har loader par agla style. */
  function loaderPref() {
    try { const v = localStorage.getItem('ff_loader_style'); return v && (v === 'mix' || LOADER_STYLES.includes(v)) ? v : 'mix'; } catch { return 'mix'; }
  }
  function loaderStyle(style) {
    const want = style && (style === 'mix' || LOADER_STYLES.includes(style)) ? style : loaderPref();
    if (want !== 'mix') return want;
    loaderTurn = (loaderTurn + 1) % LOADER_STYLES.length;
    return LOADER_STYLES[loaderTurn];
  }
  /** Sirf animation (inline) — size: 'sm' | 'md' | 'lg'. */
  function loader(style, opts) {
    const o = opts || {};
    const s = loaderStyle(style);
    const size = o.size === 'sm' || o.size === 'md' || o.size === 'lg' ? ` ffl-${o.size}` : '';
    return `<span class="ffl ffl-${s}${size}" data-ffl="${s}" aria-hidden="true">${LOADER_INNER[s]}</span>`;
  }
  /** Blinking "…" (3 dots) — loading text ke saath. */
  const ellipsis = () => '<span class="ffl-ell" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>';
  function spinner(text, opts) {
    const o = opts || {};
    const t = String(text || 'Loading data from Google Sheet…').replace(/(\.\.\.|…)\s*$/, '');
    return `<div class="loading" role="status" aria-live="polite">${loader(o.style, { size: o.size || 'lg' })}<div class="loading-text">${esc(t)}${ellipsis()}</div>${o.hint ? `<div class="loading-hint">${esc(o.hint)}</div>` : ''}</div>`;
  }
  function errorBox(err, retryAttr) {
    const msg = err && err.message ? err.message : String(err);
    return `<div class="error-box"><div class="error-title">⚠️ Data load nahi hua</div><div class="error-msg">${esc(msg)}</div>${retryAttr ? `<button class="btn" ${retryAttr}>Retry</button>` : ''}</div>`;
  }
  /** Promise ka intezaar sirf `ms` tak: value mili to value, deadline/reject par `fallback`. Kabhi latakta ya throw nahi karta —
   *  underlying kaam peeche chalta rehta hai. "Loading" spinner ko hamesha ek hard limit dene ke liye (stock / ageing / drawers). */
  function within(promise, ms, fallback) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; clearTimeout(timer); resolve(v); };
      const timer = setTimeout(() => finish(fallback), Math.max(0, Number(ms) || 0));
      Promise.resolve(promise).then(finish, () => finish(fallback));
    });
  }
  /** Event loop ko ek baar saans do — lambe loops (lakh rows indexing) ke beech UI freeze na ho.
   *  MessageChannel background tab me bhi 1 s throttle nahi hota (setTimeout hota hai). */
  const breathe = (() => {
    if (typeof MessageChannel === 'function') {
      try {
        const channel = new MessageChannel(), waiting = [];
        channel.port1.onmessage = () => { const next = waiting.shift(); if (next) next(); };
        if (typeof channel.port1.unref === 'function') channel.port1.unref();   // Node (tests): open port process ko zinda na rakhe
        return () => new Promise((resolve) => { waiting.push(resolve); channel.port2.postMessage(0); });
      } catch { /* niche setTimeout fallback */ }
    }
    return () => new Promise((resolve) => setTimeout(resolve, 0));
  })();
  // ---- instant file download UI -----------------------------------------------------------------
  // One download engine for PDF / CSV / XLSX / any Blob. The click itself stays synchronous so
  // mobile browsers have the best chance of honoring it, while the UI animation starts immediately.
  let downloadUi = null;
  let downloadUiTimer = 0;
  function getDownloadUi() {
    if (downloadUi && document.body.contains(downloadUi)) return downloadUi;
    const host = document.createElement('div');
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('role', 'status');
    host.style.cssText = [
      'position:fixed','left:50%','top:50%','transform:translate(-50%,-50%)',
      'z-index:2147483647','display:none','width:min(330px,calc(100vw - 32px))',
      'padding:18px 20px','border-radius:18px','background:rgba(15,23,42,.96)',
      'box-shadow:0 18px 55px rgba(2,6,23,.32)','border:1px solid rgba(255,255,255,.12)',
      'color:#fff','font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'backdrop-filter:blur(14px)','-webkit-backdrop-filter:blur(14px)'
    ].join(';');
    host.innerHTML = [
      '<div style="display:flex;align-items:center;gap:12px">',
      '<div data-dl-spin style="width:24px;height:24px;border:3px solid rgba(255,255,255,.22);border-top-color:#60a5fa;border-radius:50%;flex:0 0 auto"></div>',
      '<div style="min-width:0;flex:1">',
      '<div data-dl-title style="font-weight:800;font-size:15px;line-height:1.2">Downloading…</div>',
      '<div data-dl-file style="margin-top:4px;font-size:11px;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>',
      '</div>',
      '</div>',
      '<div data-dl-track style="height:4px;background:rgba(255,255,255,.12);border-radius:999px;overflow:hidden;margin-top:13px">',
      '<div data-dl-bar style="height:100%;width:26%;background:linear-gradient(90deg,#22c55e,#38bdf8,#a78bfa);border-radius:999px"></div>',
      '</div>'
    ].join('');
    document.body.appendChild(host);
    downloadUi = host;

    const spin = host.querySelector('[data-dl-spin]');
    if (spin && typeof spin.animate === 'function') spin.animate(
      [{ transform:'rotate(0deg)' }, { transform:'rotate(360deg)' }],
      { duration:850, iterations:Infinity }
    );
    const bar = host.querySelector('[data-dl-bar]');
    if (bar && typeof bar.animate === 'function') bar.animate(
      [{ transform:'translateX(-140%)' }, { transform:'translateX(400%)' }],
      { duration:1050, iterations:Infinity, easing:'ease-in-out' }
    );
    return host;
  }
  function downloadStart(filename, title) { downloadStatus(title || 'Preparing download…', filename, false); }
  function downloadFail(filename, message) {
    try {
      const ui = getDownloadUi();
      const titleEl = ui.querySelector('[data-dl-title]');
      const fileEl = ui.querySelector('[data-dl-file]');
      const spin = ui.querySelector('[data-dl-spin]');
      const bar = ui.querySelector('[data-dl-bar]');
      if (titleEl) titleEl.textContent = 'Download failed ✕';
      if (fileEl) fileEl.textContent = String(message || filename || 'Please try again');
      if (spin) { spin.style.borderTopColor = '#ef4444'; spin.style.borderColor = 'rgba(239,68,68,.20)'; }
      if (bar) { bar.style.background = '#ef4444'; bar.style.width = '100%'; }
      ui.style.display = 'block';
      clearTimeout(downloadUiTimer);
      downloadUiTimer = setTimeout(() => { if (downloadUi) downloadUi.style.display = 'none'; }, 1800);
    } catch { /* feedback must never break export */ }
  }
  function downloadStatus(title, filename, done) {
    try {
      const ui = getDownloadUi();
      const titleEl = ui.querySelector('[data-dl-title]');
      const fileEl = ui.querySelector('[data-dl-file]');
      const spin = ui.querySelector('[data-dl-spin]');
      const bar = ui.querySelector('[data-dl-bar]');
      if (titleEl) titleEl.textContent = done ? 'Downloaded ✓' : (title || 'Downloading…');
      if (fileEl) fileEl.textContent = String(filename || 'File');
      if (spin) {
        spin.style.borderTopColor = done ? '#22c55e' : '#60a5fa';
        spin.style.borderColor = done ? 'rgba(34,197,94,.20)' : 'rgba(255,255,255,.22)';
      }
      if (bar) {
        bar.style.background = done ? '#22c55e' : 'linear-gradient(90deg,#22c55e,#38bdf8,#a78bfa)';
        if (done) bar.style.width = '100%';
      }
      ui.style.display = 'block';
      clearTimeout(downloadUiTimer);
      if (done) downloadUiTimer = setTimeout(() => { if (downloadUi) downloadUi.style.display = 'none'; }, 900);
    } catch { /* download must never fail because UI feedback failed */ }
  }
  function downloadBlob(filename, blob) {
    const name = String(filename || 'download');
    if (!blob) throw new Error('Download file data nahi mila');
    downloadStatus('Downloading…', name, false);

    // URL.createObjectURL accepts Blob/File; coerce other common binary values safely.
    let file = blob;
    if (!(file instanceof Blob)) {
      if (typeof file === 'string' && /^data:[^,]*,/i.test(file)) {
        const comma = file.indexOf(',');
        const meta = file.slice(5, comma);
        const body = file.slice(comma + 1);
        const mime = (meta.split(';')[0] || 'application/octet-stream');
        const bin = /;base64/i.test(meta) ? atob(body) : decodeURIComponent(body);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        file = new Blob([bytes], { type: mime });
      } else if (file instanceof ArrayBuffer || ArrayBuffer.isView(file)) file = new Blob([file]);
      else file = new Blob([String(file)], { type: 'application/octet-stream' });
    }

    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.style.position = 'fixed';
    a.style.left = '-9999px';
    a.style.width = '1px';
    a.style.height = '1px';
    a.setAttribute('aria-hidden', 'true');
    document.body.appendChild(a);

    try {
      // Synchronous click: no setTimeout / promise before the browser download trigger.
      a.click();
    } catch (err) {
      // Secondary path for WebView-like browsers where HTMLElement.click() is unreliable.
      try { a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); }
      catch { /* surfaced below */ }
      if (!document.body.contains(a)) throw err;
    }

    // Keep the object URL alive long enough for slower mobile download managers.
    setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch {}
      try { a.remove(); } catch {}
    }, 6000);

    // The browser owns the actual transfer; mark the hand-off as complete immediately.
    downloadStatus('Downloaded ✓', name, true);
    return true;
  }
  function downloadCsv(filename, header, rows) {
    const quote = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [header.map(quote).join(','), ...rows.map((r) => r.map(quote).join(','))].join('\r\n');
    downloadBlob(filename, new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  }
  function tableToRows(table) {
    return [...table.querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => td.textContent.replace(/\s+/g, ' ').trim()));
  }
  function slug(text) { return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export'; }
  function stamp() { return new Date().toISOString().slice(0, 10); }

  // ---- sharing (WhatsApp / email / clipboard) --------------------------------
  function phoneDigits(v) {
    let d = String(v || '').replace(/\D/g, '');
    if (!d || /^na$/i.test(String(v))) return '';
    if (d.length === 10) d = '91' + d;
    if (d.length === 11 && d.startsWith('0')) d = '91' + d.slice(1);
    return d.length >= 11 && d.length <= 15 ? d : '';
  }
  function waLink(text, phone) {
    const p = phoneDigits(phone);
    return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
  }
  function mailLink(subject, body, to) {
    return `mailto:${encodeURIComponent(to || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ } ta.remove(); return ok;
    }
  }

  /** Autocomplete dropdown for a text input.
      suggest(input, { items: () => [{ label, sub, value, kind, badge }], onPick(item), min: 1, max: 12, onClear })
      Items are matched on label/sub/keywords (case-insensitive); Enter picks the highlighted one, Esc closes.
      The list is portalled to <body> and anchored outside the input, so it can never cover typed text
      or get clipped by a card/table overflow container. */
  let suggestSeq = 0;
  function suggest(input, opts) {
    const o = { min: 1, max: 12, ...opts };
    const box = h('<div class="suggest" hidden role="listbox" aria-label="Search suggestions"></div>');
    const boxId = `ff-suggest-${++suggestSeq}`;
    box.id = boxId;
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-haspopup', 'listbox');
    input.setAttribute('aria-controls', boxId);
    input.setAttribute('aria-expanded', 'false');
    // Body portal avoids stacking/overflow bugs in cards, drawers and horizontally scrolling tables.
    document.body.appendChild(box);
    let list = [], active = -1, destroyed = false;
    const norm = (s) => String(s || '').toLowerCase();

    function place() {
      if (destroyed || !input.isConnected) return;
      const rect = input.getBoundingClientRect();
      const vw = Math.max(240, window.innerWidth || document.documentElement.clientWidth || 1024);
      const vh = Math.max(240, window.innerHeight || document.documentElement.clientHeight || 768);
      const gap = 8, edge = 8;
      const maxWidth = Math.max(220, vw - edge * 2);
      const width = Math.min(Math.max(rect.width || 0, Math.min(280, maxWidth)), maxWidth);
      const left = Math.max(edge, Math.min(rect.left, vw - width - edge));
      const below = vh - rect.bottom - gap - edge;
      const above = rect.top - gap - edge;
      const openAbove = below < 180 && above > below;
      const available = Math.max(88, openAbove ? above : below);
      box.dataset.placement = openAbove ? 'top' : 'bottom';
      box.style.position = 'fixed';
      box.style.left = `${Math.round(left)}px`;
      box.style.width = `${Math.round(width)}px`;
      box.style.maxHeight = `${Math.round(Math.min(360, available))}px`;
      if (openAbove) {
        box.style.top = 'auto';
        box.style.bottom = `${Math.max(edge, Math.round(vh - rect.top + gap))}px`;
      } else {
        box.style.bottom = 'auto';
        box.style.top = `${Math.min(vh - edge, Math.round(rect.bottom + gap))}px`;
      }
    }
    function close() {
      box.hidden = true; active = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
    function show() { box.hidden = false; input.setAttribute('aria-expanded', 'true'); place(); }
    function render() {
      if (!list.length) {
        active = -1;
        box.innerHTML = '<div class="suggest-empty">Koi match nahi</div>';
        input.removeAttribute('aria-activedescendant');
        show(); return;
      }
      box.innerHTML = list.map((it, i) => `<div id="${boxId}-option-${i}" class="suggest-item ${i === active ? 'on' : ''}" data-i="${i}" role="option" aria-selected="${i === active ? 'true' : 'false'}"><span class="suggest-kind ${esc(it.kind || '')}">${esc(it.kindLabel || it.kind || '')}</span><span class="suggest-main"><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>${it.badge ? `<span class="suggest-badge">${esc(it.badge)}</span>` : ''}</div>`).join('');
      if (active >= 0) input.setAttribute('aria-activedescendant', `${boxId}-option-${active}`);
      else input.removeAttribute('aria-activedescendant');
      show();
      if (active >= 0) requestAnimationFrame(() => box.querySelector('.suggest-item.on')?.scrollIntoView({ block: 'nearest' }));
    }
    function compute() {
      if (destroyed || !input.isConnected) { destroy(); return; }
      const q = norm(input.value.trim());
      if (q.length < o.min) { close(); return; }
      const all = typeof o.items === 'function' ? o.items() : o.items || [];
      const starts = [], contains = [];
      for (const it of all) {
        const hay = norm(`${it.label} ${it.sub || ''} ${it.keywords || ''}`);
        if (!hay.includes(q)) continue;
        (norm(it.label).startsWith(q) ? starts : contains).push(it);
        if (starts.length >= o.max) break;
      }
      list = starts.concat(contains).slice(0, o.max);
      active = list.length ? 0 : -1;
      render();
    }
    function pick(i) {
      const it = list[i]; if (!it) return;
      input.value = it.inputValue !== undefined ? it.inputValue : it.label;
      close(); o.onPick && o.onPick(it);
    }
    const onInput = debounce(compute, 80);
    const onFocus = () => { if (input.value.trim().length >= o.min) compute(); };
    const onKeydown = (e) => {
      if (box.hidden) { if (e.key === 'Enter' && o.onEnter) { e.preventDefault(); o.onEnter(input.value.trim()); } return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(list.length - 1, active + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0) pick(active); else if (o.onEnter) { close(); o.onEnter(input.value.trim()); } }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') close();
    };
    const onBlur = () => setTimeout(() => { if (!box.contains(document.activeElement)) close(); }, 0);
    const onBoxMouseDown = (e) => { const it = e.target.closest('.suggest-item'); if (it) { e.preventDefault(); pick(Number(it.dataset.i)); } };
    const outsideClick = (e) => {
      if (!input.isConnected) { destroy(); return; }
      if (!box.contains(e.target) && e.target !== input) close();
    };
    // ⚡ v3.60 — ye listener window par CAPTURE me lagta hai, matlab page ke kisi bhi scrollable
    // hisse (tables, drawers) par scroll hote hi chalta hai. Pehle har event par place() →
    // getBoundingClientRect() (forced layout) hota tha: jitne suggest/multiselect filter utna zyada
    // scroll leg. Ab: popup band ho to kuch nahi, khula ho to ek frame me ek baar reposition.
    let vpQueued = false;
    const viewportChange = () => {
      if (destroyed || !input.isConnected) { destroy(); return; }
      if (box.hidden || vpQueued) return;
      vpQueued = true;
      const run = () => { vpQueued = false; if (!destroyed && input.isConnected && !box.hidden) place(); };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else run();
    };
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      document.removeEventListener('click', outsideClick);
      window.removeEventListener('resize', viewportChange);
      window.removeEventListener('scroll', viewportChange, true);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', viewportChange);
        window.visualViewport.removeEventListener('scroll', viewportChange);
      }
      input.removeEventListener('input', onInput);
      input.removeEventListener('focus', onFocus);
      input.removeEventListener('keydown', onKeydown);
      input.removeEventListener('blur', onBlur);
      box.removeEventListener('mousedown', onBoxMouseDown);
      box.remove();
    }
    input.addEventListener('input', onInput);
    input.addEventListener('focus', onFocus);
    input.addEventListener('keydown', onKeydown);
    input.addEventListener('blur', onBlur);
    box.addEventListener('mousedown', onBoxMouseDown);
    document.addEventListener('click', outsideClick);
    window.addEventListener('resize', viewportChange);
    window.addEventListener('scroll', viewportChange, true);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', viewportChange);
      window.visualViewport.addEventListener('scroll', viewportChange);
    }
    return { close, refresh: compute, reposition: place, destroy };
  }

  // ---- 🔠 MULTI-SELECT popover (multiple selection anywhere) ------------------------------------
  /** Normalise any filter value — Set / Array / string / 'all' / '' — into a Set of values.
      An EMPTY set means "All" (no restriction), which is what every multi-select filter uses. */
  function asValueSet(value) {
    const drop = (x) => { const s = clean(x); return s && s !== 'all' && s !== '*'; };
    if (value instanceof Set) return new Set([...value].filter(drop));
    if (Array.isArray(value)) return new Set(value.filter(drop));
    const one = clean(value);
    return drop(one) ? new Set([one]) : new Set();
  }
  /** Human label for a multi-select: "All", "High", or "High + Medium" (max 2 shown, then +N). */
  function valueSetLabel(values, options, allLabel) {
    const set = asValueSet(values);
    const all = clean(allLabel) || 'All';
    if (!set.size) return all;
    const names = [...set].map((v) => {
      const o = (options || []).find((x) => String(x.value) === String(v));
      return (o && (o.label || o.value)) || v;
    });
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} + ${names[1]}`;
    return `${names[0]} +${names.length - 1}`;
  }

  /**
   * multiSelect(button, opts) → { open, close, refresh, destroy, selected }
   * Body-portalled checkbox popover so it can never be clipped by a card / table overflow.
   * opts: {
   *   title: 'Priority',                       popover heading
   *   allLabel: 'All', noneLabel: 'Clear',
   *   options: () => [{ value, label, icon, cls, count, disabled }],
   *   selected: () => ['High','Medium'],       current values (array / Set / string)
   *   onChange(valuesArray),                   called after every tick (live filtering)
   *   searchable: true, placeholder: 'Search…',
   *   allowEmpty: true                         false = at least one value must stay ticked
   * }
   * The button gets a `.msel-btn` look + a `.msel-count` badge + a summary label.
   */
  function multiSelect(button, opts) {
    const o = { title: '', allLabel: 'All', noneLabel: 'Clear', searchable: true, placeholder: 'Search…', allowEmpty: true, icon: '', ...opts };
    if (!button) return null;
    const pop = h(`<div class="msel-pop" hidden role="dialog" aria-label="${esc(o.title || 'Select')}"><div class="msel-head"><b>${esc(o.title || 'Select')}</b><button type="button" class="msel-x" aria-label="Close">✕</button></div><div class="msel-body"></div><div class="msel-foot"></div></div>`);
    document.body.appendChild(pop);
    button.classList.add('msel-btn');
    if (!button.hasAttribute('aria-haspopup')) button.setAttribute('aria-haspopup', 'dialog');
    let destroyed = false, q = '';

    const options = () => (typeof o.options === 'function' ? o.options() : o.options) || [];
    const selected = () => asValueSet(typeof o.selected === 'function' ? o.selected() : o.selected);

    function label() {
      const set = selected(), all = options();
      const text = valueSetLabel(set, all, o.allLabel);
      button.innerHTML = `${o.icon ? `<span class="msel-ico">${esc(o.icon)}</span>` : ''}<span class="msel-label">${esc(text)}</span>${set.size ? `<b class="msel-count">${set.size}</b>` : ''}<span class="msel-chev">▾</span>`;
      button.classList.toggle('on', set.size > 0);
      button.setAttribute('aria-expanded', pop.hidden ? 'false' : 'true');
      button.title = set.size ? `${o.title || 'Filter'}: ${text}` : `${o.title || 'Filter'}: ${o.allLabel}`;
    }
    function place() {
      if (destroyed || !button.isConnected || pop.hidden) return;
      const rect = button.getBoundingClientRect();
      const vw = Math.max(240, window.innerWidth || document.documentElement.clientWidth || 1024);
      const vh = Math.max(240, window.innerHeight || document.documentElement.clientHeight || 768);
      const gap = 8, edge = 8;
      const width = Math.min(340, Math.max(240, rect.width + 60, vw - edge * 2));
      const left = Math.max(edge, Math.min(rect.left, vw - width - edge));
      const below = vh - rect.bottom - gap - edge;
      const above = rect.top - gap - edge;
      const openAbove = below < 240 && above > below;
      const available = Math.max(140, openAbove ? above : below);
      pop.style.position = 'fixed';
      pop.style.left = `${Math.round(left)}px`;
      pop.style.width = `${Math.round(width)}px`;
      pop.style.maxHeight = `${Math.round(Math.min(440, available))}px`;
      if (openAbove) { pop.style.top = 'auto'; pop.style.bottom = `${Math.max(edge, Math.round(vh - rect.top + gap))}px`; }
      else { pop.style.bottom = 'auto'; pop.style.top = `${Math.min(vh - edge, Math.round(rect.bottom + gap))}px`; }
    }
    function paint() {
      const set = selected(), all = options();
      const list = all.filter((it) => {
        if (!q) return true;
        return `${it.label} ${it.value} ${it.icon || ''}`.toLowerCase().includes(q);
      });
      const body = pop.querySelector('.msel-body');
      const foot = pop.querySelector('.msel-foot');
      body.innerHTML = `${o.searchable ? `<input class="input msel-q" type="search" placeholder="${esc(o.placeholder)}" value="${esc(q)}" aria-label="Search options">` : ''}<div class="msel-list">${list.length ? list.map((it) => {
        const v = String(it.value);
        const on = set.has(v);
        return `<label class="msel-item ${esc(it.cls || '')} ${on ? 'on' : ''}"><input type="checkbox" value="${esc(v)}" ${on ? 'checked' : ''}><span class="msel-ico">${esc(it.icon || '')}</span><span class="msel-txt">${esc(it.label)}</span>${it.count != null ? `<b class="msel-n">${esc(fmt(it.count))}</b>` : ''}</label>`;
      }).join('') : '<div class="msel-empty">Koi option nahi mila</div>'}</div>`;
      foot.innerHTML = `<button type="button" class="msel-mini" data-msel="all">✓ ${esc(o.allLabel === 'All' ? 'Select all' : o.allLabel)}</button><button type="button" class="msel-mini" data-msel="none">✕ ${esc(o.noneLabel)}</button><button type="button" class="btn small primary" data-msel="done">Done</button>`;
      const input = body.querySelector('.msel-q');
      if (input && document.activeElement !== input) {
        input.addEventListener('input', (e) => { q = e.target.value.toLowerCase().trim(); paint(); const el = pop.querySelector('.msel-q'); if (el) { el.focus(); try { el.setSelectionRange(q.length, q.length); } catch { /* search inputs */ } } });
      }
      place();
    }
    function commit(values) {
      const next = asValueSet(values);
      if (!next.size && !o.allowEmpty) return;
      if (typeof o.onChange === 'function') o.onChange([...next]);
      label(); paint();
    }
    function close() { if (pop.hidden) return; pop.hidden = true; button.setAttribute('aria-expanded', 'false'); }
    function open() {
      if (pop.hidden === false) { close(); return; }
      pop.hidden = false; q = ''; paint(); label();
      requestAnimationFrame(place);
    }
    const onClick = (e) => {
      const box = e.target.closest('input[type="checkbox"]');
      if (box) {
        e.preventDefault();
        const set = selected(), v = String(box.value);
        if (set.has(v)) set.delete(v); else set.add(v);
        commit(set);
        return;
      }
      const act = e.target.closest('[data-msel]');
      if (act) {
        const a = act.dataset.msel;
        if (a === 'done') { close(); return; }
        if (a === 'none') { commit([]); return; }
        if (a === 'all') { commit(options().map((it) => it.value)); return; }
      }
      if (e.target.closest('.msel-x')) close();
    };
    const onBtnClick = (e) => { e.preventDefault(); e.stopPropagation(); open(); };
    const outside = (e) => { if (destroyed) return; if (!pop.hidden && !pop.contains(e.target) && e.target !== button && !button.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape' && !pop.hidden) { close(); button.focus(); } };
    let vpQueued = false;   // ⚡ v3.60 — scroll par forced layout ek frame me ek baar hi (see suggest)
    const viewportChange = () => {
      if (destroyed) { destroy(); return; }
      if (pop.hidden || vpQueued) return;
      vpQueued = true;
      const run = () => { vpQueued = false; if (!destroyed && !pop.hidden) place(); };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else run();
    };
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      pop.remove();
      button.removeEventListener('click', onBtnClick);
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', viewportChange);
      window.removeEventListener('scroll', viewportChange, true);
    }
    button.addEventListener('click', onBtnClick);
    pop.addEventListener('click', onClick);
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', viewportChange);
    window.addEventListener('scroll', viewportChange, true);
    label();
    return { open, close, refresh: () => { label(); if (!pop.hidden) paint(); }, destroy, get selected() { return [...selected()]; } };
  }

  function colLetter(index) {
    let s = '';
    let i = index + 1;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }
  function colIndex(letter) {
    let n = 0;
    for (const ch of String(letter).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  // Shared tooltip for elements with data-tip
  function initTooltip() {
    // 📱 v3.60 — touch device par tooltip dikhta hi nahi (hover nahi hota), phir bhi document par
    // mouseover/mousemove listeners lagte the: har tap/scroll par closest() + getBoundingClientRect()
    // = bekaar ka main-thread kaam. Phone par poora tooltip layer hi skip.
    // `(pointer: coarse)` = primary input touch (phone/tablet). Touch-capable desktop par tooltips
    // chalte rehne chahiye, isliye maxTouchPoints ko yahan vote nahi diya.
    const coarse = (() => {
      try {
        if (window.matchMedia) return !!window.matchMedia('(pointer: coarse)').matches;
        return Number(navigator.maxTouchPoints || 0) > 0 && !/Windows NT|Mac OS X|Linux x86_64/i.test(String(navigator.userAgent || ''));
      } catch { return false; }
    })();
    if (coarse) return;
    const tip = h('<div class="tip" hidden></div>');
    document.body.appendChild(tip);
    let current = null;
    let moveQueued = false, lastEvent = null;
    function paint() {
      moveQueued = false;
      const e = lastEvent;
      if (!e || !current || tip.hidden) return;
      const pad = 14;
      let x = e.clientX + pad, y = e.clientY + pad;
      const r = tip.getBoundingClientRect();
      if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
      if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
      tip.style.left = `${x}px`; tip.style.top = `${y}px`;
    }
    // ⚡ mousemove par har baar layout read (getBoundingClientRect) hota tha — ab ek frame me ek baar.
    function move(e) {
      lastEvent = e;
      if (moveQueued) return;
      moveQueued = true;
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(paint);
      else paint();
    }
    document.addEventListener('mouseover', (e) => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (!t) { if (current) { current = null; tip.hidden = true; } return; }
      if (t !== current) { current = t; tip.innerHTML = t.getAttribute('data-tip'); tip.hidden = false; }
      move(e);
    });
    document.addEventListener('mousemove', (e) => { if (current) move(e); });
    document.addEventListener('mouseout', (e) => {
      if (current && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-tip]') === current)) { current = null; tip.hidden = true; }
    });
  }

  // ---- date-time parsing (Excel export: real dates instead of text) -------------------------
  const MON_IDX = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12 };
  /** Parse dd/mm/yyyy [hh:mm[:ss]] · yyyy-mm-dd[ hh:mm[:ss]] · dd-MMM-yyyy → Date (local). Null if not a date. */
  function parseDateTime(value) {
    const s = String(value ?? '').trim();
    if (!s || s.length < 6 || s.length > 30 || !/\d/.test(s)) return null;
    let y = 0, mo = 0, d = 0, hh = 0, mi = 0, ss = 0;
    let m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
    if (m) {
      d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000;
      if (mo > 12 && d <= 12) { const t = mo; mo = d; d = t; } // tolerate mm/dd
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      hh = +(m[4] || 0); mi = +(m[5] || 0); ss = +(m[6] || 0);
    } else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s))) {
      y = +m[1]; mo = +m[2]; d = +m[3]; hh = +(m[4] || 0); mi = +(m[5] || 0); ss = +(m[6] || 0);
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    } else if ((m = /^(\d{1,2})[\s/-]+([A-Za-z]{3,4})[\s/-]+(\d{2,4})(?:[ T]+(\d{1,2}):(\d{2}))?$/.exec(s))) {
      d = +m[1]; mo = MON_IDX[m[2].toUpperCase()] || 0; y = +m[3]; if (y < 100) y += 2000;
      if (!mo || d < 1 || d > 31) return null;
      hh = +(m[4] || 0); mi = +(m[5] || 0);
    } else if ((m = /^([A-Za-z]{3,4})[\s/-]+(\d{1,2}),?\s+(\d{2,4})$/.exec(s))) {
      mo = MON_IDX[m[1].toUpperCase()] || 0; d = +m[2]; y = +m[3]; if (y < 100) y += 2000;
      if (!mo || d < 1 || d > 31) return null;
    } else return null;
    if (hh > 23 || mi > 59 || ss > 59) return null;
    const dt = new Date(y, mo - 1, d, hh, mi, ss);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return dt;
  }

  // ---- print / PDF report ---------------------------------------------------------------------
  /** Open a clean print-ready window (browser se "Save as PDF" bhi ho sakta hai). */
  function printReport(opts) {
    const o = opts || {};
    const w = window.open('', '_blank');
    if (!w) { toast('Popup block ho gaya — browser se popup allow karo.', 'err'); return; }
    const brand = (FF.config && FF.config.brand) || 'Dashboard';
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(o.title || 'Report')}</title><style>
      body { font-family: Inter, "Segoe UI", system-ui, sans-serif; color: #0f172a; margin: 28px; font-size: 12.5px; }
      h1 { font-size: 19px; margin: 0 0 2px; } h2 { font-size: 14px; margin: 18px 0 6px; }
      .sub { color: #64748b; margin: 0 0 4px; } .meta { color: #94a3b8; font-size: 11px; margin-bottom: 14px; }
      .kpis { display: flex; flex-wrap: wrap; gap: 10px; margin: 12px 0; }
      .kpi { border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px 12px; min-width: 130px; }
      .kpi b { display: block; font-size: 16px; } .kpi small { color: #64748b; }
      table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; page-break-inside: auto; }
      th { background: #4f46e5; color: #fff; text-align: left; }
      th, td { border: 1px solid #e2e8f0; padding: 5px 8px; font-size: 11.5px; }
      tr { page-break-inside: avoid; } .num { text-align: right; }
      .foot { margin-top: 18px; color: #94a3b8; font-size: 10.5px; border-top: 1px solid #e2e8f0; padding-top: 8px; }
      @media print { body { margin: 8mm; } }
    </style></head><body>
      <h1>${esc(o.title || 'Report')}</h1>
      ${o.subtitle ? `<p class="sub">${o.subtitle}</p>` : ''}
      <p class="meta">${esc(brand)} · Generated ${esc(new Date().toLocaleString('en-IN'))}</p>
      ${o.html || ''}
      <div class="foot">${esc(brand)} · ${esc((FF.config && FF.config.appName) || '')} · Print / Save as PDF</div>
      <script>window.onload = function () { setTimeout(function () { window.print(); }, 250); };<\/script>
    </body></html>`);
    w.document.close();
  }

  // ---- recent searches (localStorage) -----------------------------------------------------------
  function recentList(key, max) {
    try { const arr = JSON.parse(localStorage.getItem(`ff_recent_${key}`) || '[]'); return Array.isArray(arr) ? arr.slice(0, max || 5) : []; } catch { return []; }
  }
  function recentAdd(key, item, max) {
    if (!item || !item.label) return recentList(key, max);
    const cap = max || 5;
    const list = recentList(key, cap).filter((x) => !(x && String(x.label).toLowerCase() === String(item.label).toLowerCase()));
    list.unshift({ label: item.label, kind: item.kind || '', value: item.value !== undefined ? item.value : item.label });
    try { localStorage.setItem(`ff_recent_${key}`, JSON.stringify(list.slice(0, cap))); } catch { /* storage full */ }
    return list.slice(0, cap);
  }

  /** 🗣 Voice search — Web Speech API (Indian English). Click again to stop.
   *  opts.onInterim(transcript) → live dictation preview (interimResults on).
   *  opts.dictation → continuous listening, har final phrase onText se aata hai (bolkar likho). */
  let activeVoice = null;
  function voiceInput(onText, hint, opts) {
    const o = opts || {};
    const button = o.button || null;
    if (activeVoice) {
      const same = !button || activeVoice.button === button;
      try { same ? activeVoice.rec.stop() : activeVoice.rec.abort(); } catch { /* already ending */ }
      if (same) return activeVoice.rec;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('🗣 Voice search is browser me supported nahi hai — latest Chrome/Edge try karo.', 'warn'); return null; }
    if (window.isSecureContext === false) { toast('Mic ke liye secure HTTPS connection chahiye.', 'err'); return null; }
    try {
      const rec = new SR();
      let gotResult = false;
      rec.lang = o.lang || 'en-IN';
      rec.interimResults = !!o.onInterim || !!o.dictation;
      rec.continuous = !!o.dictation;
      rec.maxAlternatives = 1;
      const cleanup = () => {
        if (button) {
          button.classList.remove('listening');
          button.setAttribute('aria-pressed', 'false');
          button.removeAttribute('aria-busy');
          button.title = button.dataset.voiceTitle || '🗣 Bol ke search karo';
        }
        if (o.onEnd) { try { o.onEnd(gotResult); } catch { /* listener error */ } }
        if (activeVoice && activeVoice.rec === rec) activeVoice = null;
      };
      if (button) {
        button.dataset.voiceTitle = button.title || '🗣 Bol ke search karo';
        button.classList.add('listening');
        button.setAttribute('aria-pressed', 'true');
        button.setAttribute('aria-busy', 'true');
        button.title = 'Sun raha hoon… dobara dabao to stop';
      }
      activeVoice = { rec, button };
      toast(hint || '🎤 Bolo… sun raha hoon', 'info');
      rec.onresult = (e) => {
        let interim = '', finalText = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i] && e.results[i][0] ? String(e.results[i][0].transcript).trim() : '';
          if (e.results[i].isFinal) finalText += (finalText ? ' ' : '') + t;
          else interim += (interim ? ' ' : '') + t;
        }
        if (interim && o.onInterim) o.onInterim(interim);
        if (finalText) {
          gotResult = true;
          if (o.onInterim) o.onInterim(''); // interim khatam
          if (onText) onText(finalText);
        }
      };
      rec.onerror = (e) => {
        const code = e && e.error;
        if (code === 'not-allowed' || code === 'service-not-allowed') toast('Mic permission blocked hai — address bar ke 🔒 icon se Microphone Allow karo.', 'err');
        else if (code === 'audio-capture') toast('Microphone nahi mila — device/browser mic setting check karo.', 'err');
        else if (code === 'network') toast('Voice service network se connect nahi hui — internet check karke retry karo.', 'warn');
        else if (code === 'no-speech') toast('Kuch sunai nahi diya — dobara try karo.', 'warn');
        else if (code !== 'aborted') toast('Awaaz samajh nahi aayi — dobara try karo.', 'warn');
      };
      rec.onend = () => { cleanup(); if (!gotResult && o.onEmpty) o.onEmpty(); };
      if (!o.dictation) rec.onspeechend = () => { try { rec.stop(); } catch { /* ending */ } };
      rec.start();
      return rec;
    } catch {
      if (button) { button.classList.remove('listening'); button.setAttribute('aria-pressed', 'false'); button.removeAttribute('aria-busy'); }
      activeVoice = null;
      toast('Voice search start nahi ho paya — mic permission check karo.', 'err');
      return null;
    }
  }

  // ---- 🎙 Assistant voice preferences (Settings → My account ↔ assistant.js shared) ----
  const VOICE_PREFS_KEY = 'ff-voice-prefs';
  function voicePrefs() {
    try { const p = JSON.parse(localStorage.getItem(VOICE_PREFS_KEY) || '{}'); return (p && typeof p === 'object') ? p : {}; } catch { return {}; }
  }
  function setVoicePrefs(patch) {
    const p = { ...voicePrefs(), ...(patch || {}) };
    try { localStorage.setItem(VOICE_PREFS_KEY, JSON.stringify(p)); } catch { /* storage full */ }
    try { if (typeof CustomEvent === 'function' && typeof dispatchEvent === 'function') dispatchEvent(new CustomEvent('ff-voice-prefs', { detail: p })); } catch { /* non-browser */ }
    return p;
  }

  // ---- 🎙 "Meri awaaz" voice profile — uploaded/recorded sample se TTS tone-match ----------
  // User apni awaaz ka sample upload/record karta hai → PCM analysis se pitch (Hz), pace
  // (syllables/sec) aur timbre (brightness) nikalta hai → us hisaab se speechSynthesis ka
  // pitch/rate set hota hai + best-matching system voice choose hoti hai. Profile localStorage
  // me sirf derived numbers rakhti hai (audio file store nahi hoti — privacy + size).
  const clampNum = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  /** Box-average decimation — analysis ko fast banane ke liye PCM ko ~8kHz par lao. */
  function resamplePcm(samples, fromRate, toRate) {
    const src = samples || [];
    if (!src.length || !(toRate > 0) || !(fromRate > toRate)) return Float32Array.from(src);
    const ratio = fromRate / toRate;
    const outLen = Math.floor(src.length / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const start = Math.floor(i * ratio), end = Math.min(src.length, Math.floor((i + 1) * ratio) + 1);
      let s = 0;
      for (let j = start; j < end; j++) s += src[j];
      out[i] = s / Math.max(1, end - start);
    }
    return out;
  }

  /** Core DSP (node-testable): Float32 PCM → { hz, pitch, rate, gender, syllPerSec, brightness }.
   *  Pitch = voiced frames ki median autocorrelation F0; pace = energy-envelope ke syllable
   *  nuclei peaks/sec; brightness = zero-crossing rate (warm ↔ sharp voice). */
  function analyzePcm(samples, sampleRate) {
    const sr = Number(sampleRate) > 0 ? Number(sampleRate) : 8000;
    const pcm = Float32Array.from(samples || []);
    const seconds = pcm.length / sr;
    if (pcm.length < sr * 0.4) return { ok: false, reason: 'Sample bahut chhota hai — kam se kam 2–3 second ki awaaz record/upload karo.', seconds };
    const win = Math.max(16, Math.round(sr * 0.04)); // 40 ms
    const hop = Math.max(8, Math.round(sr * 0.02));  // 20 ms hop
    const energies = [];
    for (let start = 0; start + win <= pcm.length; start += hop) {
      let sum2 = 0;
      for (let i = start; i < start + win; i++) sum2 += pcm[i] * pcm[i];
      energies.push(Math.sqrt(sum2 / win));
    }
    const sortedE = energies.slice().sort((a, b) => a - b);
    const medianE = sortedE[Math.floor(sortedE.length / 2)] || 0;
    const peakE = sortedE[Math.floor(sortedE.length * 0.95)] || 0;
    if (peakE < 0.008) return { ok: false, reason: 'Sample me awaaz nahi mili — mic ke paas bol kar record karo ya clear audio file upload karo.', seconds };
    const voiceFloor = Math.max(0.012, peakE * 0.22);

    // ---- pitch: har voiced frame par normalized autocorrelation ----
    const minLag = Math.floor(sr / 400); // 400 Hz max (child/female high)
    const maxLag = Math.floor(sr / 65);  // 65 Hz min (deep male)
    const f0s = [];
    for (let start = 0, fi = 0; start + win <= pcm.length; start += hop, fi++) {
      const rms = energies[fi];
      if (!(rms > voiceFloor)) continue;
      const corr = new Float32Array(maxLag + 2);
      let bestCorr = 0;
      for (let lag = minLag; lag <= Math.min(maxLag, win - 2); lag++) {
        let c = 0, energy = 0;
        for (let i = 0; i + lag < win; i++) {
          const a = pcm[start + i];
          c += a * pcm[start + i + lag];
          energy += a * a;
        }
        corr[lag] = energy > 0 ? c / energy : 0;
        if (corr[lag] > bestCorr) bestCorr = corr[lag];
      }
      if (bestCorr > 0.5) {
        // Sine me har period-multiple par correlation ~1 hoti hai — pehla significant
        // peak lo (>= 85% of best), warna 200Hz galat 66Hz padh jayega.
        let pick = 0;
        const hi = Math.min(maxLag, win - 2);
        for (let lag = minLag + 1; lag < hi; lag++) {
          if (corr[lag] >= bestCorr * 0.85 && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) { pick = lag; break; }
        }
        if (!pick) for (let lag = minLag; lag <= hi; lag++) { if (corr[lag] === bestCorr) { pick = lag; break; } }
        if (pick) f0s.push(clampNum(sr / pick, 60, 420));
      }
    }
    f0s.sort((a, b) => a - b);
    const hz = f0s.length ? f0s[Math.floor(f0s.length / 2)] : 0;

    // ---- pace: energy envelope ke local maxima = syllable nuclei ----
    const smooth = energies.map((e, i) => (energies[i - 1] || e) + e + (energies[i + 1] || e));
    const smoothPeak = Math.max(...smooth, 1);
    let peaks = 0;
    for (let i = 1; i < smooth.length - 1; i++) {
      if (smooth[i] > smooth[i - 1] && smooth[i] >= smooth[i + 1] && smooth[i] > smoothPeak * 0.24 && energies[i] > voiceFloor) peaks++;
    }
    const syllPerSec = clampNum(peaks / Math.max(seconds, 0.5), 1, 8);

    // ---- brightness: zero-crossing rate ----
    let zc = 0;
    for (let i = 1; i < pcm.length; i++) if ((pcm[i - 1] < 0) !== (pcm[i] < 0)) zc++;
    const brightness = (zc / pcm.length) * sr; // crossings per second

    const gender = hz ? (hz < 165 ? 'male' : 'female') : (brightness > 1400 ? 'female' : 'male');
    // speechSynthesis mapping: ~200Hz ≈ pitch 1.0 (typical default awaaz)
    const pitch = clampNum(Math.round((hz ? hz / 200 : gender === 'female' ? 1 : 0.7) * 20) / 20, 0.5, 1.6);
    const rate = clampNum(Math.round((0.82 + (syllPerSec - 3.2) * 0.11) * 20) / 20, 0.75, 1.4);
    return { ok: true, seconds: Math.round(seconds * 10) / 10, hz: Math.round(hz), pitch, rate, gender, syllPerSec: Math.round(syllPerSec * 10) / 10, brightness: Math.round(brightness), voicedFrames: f0s.length, medianEnergy: Math.round(medianE * 1000) / 1000 };
  }

  /** Browser path: audio file/recorded blob → decode → analyzePcm (8kHz analysis rate). */
  async function analyzeVoiceBlob(blob) {
    const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
    if (!AC) throw new Error('Audio decoding is browser me support nahi hai — Chrome/Edge try karo.');
    if (!blob || !blob.size) throw new Error('Audio data khali hai — dobara record/upload karo.');
    const ctx = new AC();
    try {
      // Kuch browsers gesture ke turant baad AudioContext suspended rakhte hain — decode se pehle resume.
      if (ctx.state === 'suspended' && ctx.resume) { try { await ctx.resume(); } catch { /* optional */ } }
      const arr = await blob.arrayBuffer();
      let audio;
      try { audio = await ctx.decodeAudioData(arr); }
      catch (e1) {
        // Purane Safari ka callback-style decode fallback.
        audio = await new Promise((resolve, reject) => {
          try { ctx.decodeAudioData(arr, resolve, reject); } catch (e2) { reject(e2); }
        });
      }
      const ch = audio.getChannelData(0);
      const target = 8000;
      const pcm = resamplePcm(ch, audio.sampleRate, target);
      const res = analyzePcm(pcm, target);
      return { ...res, duration: Math.round((audio.duration || 0) * 10) / 10 };
    } finally { try { if (ctx.close) ctx.close(); } catch { /* optional */ } }
  }

  /** 🎙 Robust voice capture — MediaRecorder (preview blob) ke SAATH raw PCM bhi capture hota hai
   *  (WebAudio ScriptProcessor), taaki analysis ke liye browser ka audio decode pass na chahiye ho.
   *  Pehle recording sirf blob → decodeAudioData se analyse hoti thi jo kuch browsers/formats me
   *  chup-chaap fail ho jaata tha ("kuch kaam nahi kar raha"). Ab PCM direct analyse hota hai.
   *  Returns: { stream, startedAt, stop() → Promise<{ blob, pcm, sampleRate, seconds }> } */
  async function startVoiceCapture() {
    const md = (typeof navigator !== 'undefined') ? navigator.mediaDevices : null;
    if (!md || typeof md.getUserMedia !== 'function') {
      throw new Error((typeof window !== 'undefined' && window.isSecureContext === false)
        ? 'Mic ke liye HTTPS (secure connection) chahiye — site https par kholo.'
        : 'Is browser me mic recording support nahi hai — latest Chrome/Edge try karo.');
    }
    if (typeof window === 'undefined' || typeof window.MediaRecorder !== 'function') throw new Error('MediaRecorder support nahi hai — latest Chrome/Edge/Firefox try karo.');
    const stream = await md.getUserMedia({ audio: true });
    const chunks = [];
    const pcmParts = [];
    let sampleRate = 0, ac = null, proc = null, srcNode = null;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        ac = new AC();
        if (ac.state === 'suspended' && ac.resume) { try { await ac.resume(); } catch { /* optional */ } }
        sampleRate = ac.sampleRate;
        srcNode = ac.createMediaStreamSource(stream);
        proc = ac.createScriptProcessor(4096, 1, 1);
        proc.onaudioprocess = (e) => { try { pcmParts.push(Float32Array.from(e.inputBuffer.getChannelData(0))); } catch { /* optional */ } };
        srcNode.connect(proc); proc.connect(ac.destination);
      }
    } catch { /* PCM capture optional — blob decode fallback rahega */ }
    const mr = new window.MediaRecorder(stream);
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    try { mr.start(); } catch { /* kuch browsers me timeslice chahiye */ try { mr.start(250); } catch { /* phir bhi nahi */ } }
    const startedAt = Date.now();
    return {
      stream, startedAt,
      state: () => mr.state,
      stop() {
        return new Promise((resolve) => {
          const finish = (blob) => {
            stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* already */ } });
            try { if (proc) { proc.onaudioprocess = null; proc.disconnect(); } if (srcNode) srcNode.disconnect(); } catch { /* optional */ }
            try { if (ac && ac.close) ac.close(); } catch { /* optional */ }
            let pcm = null;
            if (pcmParts.length) {
              const total = pcmParts.reduce((n, a) => n + a.length, 0);
              pcm = new Float32Array(total);
              let off = 0; pcmParts.forEach((a) => { pcm.set(a, off); off += a.length; });
            }
            resolve({ blob, pcm, sampleRate, seconds: Math.round((Date.now() - startedAt) / 100) / 10 });
          };
          mr.onstop = () => finish(chunks.length ? new Blob(chunks, { type: mr.mimeType || 'audio/webm' }) : null);
          try { mr.stop(); } catch { finish(chunks.length ? new Blob(chunks, { type: 'audio/webm' }) : null); }
          setTimeout(() => { if (mr.state !== 'inactive') finish(null); }, 4000); // safety net
        });
      }
    };
  }

  /** Capture ka analysis — pehle direct PCM (recording), warna blob decode (upload).
   *  Dono forms accept karta hai: startVoiceCapture() ka HANDLE (stop() khud call hota hai) ya
   *  stop() ka RESULT ({ blob, pcm, sampleRate, seconds }) — "Meri awaaz" record flow robust rahe. */
  async function analyzeVoiceCapture(cap) {
    if (cap && typeof cap.stop === 'function') cap = await cap.stop();
    if (cap && cap.pcm && cap.pcm.length && cap.sampleRate > 0) {
      const target = 8000;
      const res = analyzePcm(resamplePcm(cap.pcm, cap.sampleRate, target), target);
      return { ...res, duration: cap.seconds || res.seconds || 0 };
    }
    if (cap && cap.blob) return analyzeVoiceBlob(cap.blob);
    throw new Error('Recording ka audio data nahi mila — mic permission check kar ke dobara try karo.');
  }

  // ---- 👂 Wake word ("Hey Gems" style) — transcript me fuzzy match ------------------------------
  /** Normalise: lowercase, punctuation hatao, whitespace collapse (Devanagari letters allowed). */
  const wakeNorm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  /** Chhota Levenshtein — ASR ke misheards ("hey gems" → "hey jems" / "age gems") tolerate karne ke liye. */
  function wakeEditDist(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length; if (!b.length) return a.length;
    if (Math.abs(a.length - b.length) > 2) return 99;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  /** True jab transcript me wake word sunai de — exact substring YA token-wise fuzzy (≤ len/3 edits). */
  function wakeWordMatch(transcript, wakeWord) {
    const t = wakeNorm(transcript), w = wakeNorm(wakeWord);
    if (!t || !w) return false;
    if (t.includes(w)) return true;
    const wt = w.split(' ').filter(Boolean), tt = t.split(' ').filter(Boolean);
    if (!wt.length || tt.length < wt.length) return false;
    for (let i = 0; i + wt.length <= tt.length; i++) {
      let ok = true;
      for (let j = 0; j < wt.length; j++) {
        const tol = Math.max(1, Math.floor(wt[j].length / 3));
        if (wakeEditDist(tt[i + j], wt[j]) > tol) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  }

  const VOICE_PROFILE_LIMIT = { minSeconds: 1.5, maxSeconds: 45 };
  /** "Meri awaaz" profile (derived numbers only — audio kabhi store nahi hoti). */
  function voiceProfile() {
    const p = voicePrefs();
    return p && typeof p.profile === 'object' && p.profile && p.profile.pitch ? p.profile : null;
  }
  /** Profile save (apply bhi kar do pitch/rate) ya null se clear. */
  function setVoiceProfile(profile) {
    if (!profile) return setVoicePrefs({ profile: null, pitch: 0, rate: 0 });
    const cleanProfile = {
      pitch: clampNum(Number(profile.pitch) || 1, 0.5, 1.6),
      rate: clampNum(Number(profile.rate) || 1, 0.75, 1.4),
      hz: Number(profile.hz) || 0,
      gender: profile.gender === 'male' ? 'male' : 'female',
      syllPerSec: Number(profile.syllPerSec) || 0,
      brightness: Number(profile.brightness) || 0,
      seconds: Number(profile.seconds) || 0,
      name: String(profile.name || 'Meri awaaz').slice(0, 40),
      at: Date.now()
    };
    return setVoicePrefs({ profile: cleanProfile, pitch: cleanProfile.pitch, rate: cleanProfile.rate });
  }

  /** Best system voice: pehle user ki chosen URI, phir language, phir profile gender hint. */
  function matchVoice(voices, langKey, profile) {
    const vs = voices || [];
    const p = voicePrefs();
    const wantURI = langKey === 'en' ? p.en : p.hi;
    const chosen = wantURI && vs.find((v) => v.voiceURI === wantURI);
    if (chosen) return chosen;
    const langScore = (v) => {
      const l = String(v.lang || '');
      if (langKey === 'en') return /^en[-_]IN/i.test(l) ? 0 : /^en/i.test(l) ? 1 : 2;
      return /^hi[-_]IN/i.test(l) ? 0 : /^hi/i.test(l) ? 1 : 2;
    };
    const gender = (profile && profile.gender) || (voiceProfile() && voiceProfile().gender) || '';
    const genderScore = (v) => {
      if (!gender) return 0;
      const n = String(v.name || '').toLowerCase();
      const fem = /(female|woman|heera|kalpana|neerja|swara|madhur|veena|isha|aditi|samantha|zira|jenny|aria|sonia|google.*हिन्दी)/.test(n);
      const masc = /(male|man[^a-z]|ravi|hemant|prabhat|kumar|amit|rishabh|david|guy|mark|alex)/.test(n);
      if (gender === 'female') return fem ? -3 : masc ? 3 : 0;
      return masc ? -3 : fem ? 3 : 0;
    };
    return vs.slice().sort((a, b) => langScore(a) - langScore(b) || genderScore(a) - genderScore(b) || String(a.name || '').localeCompare(String(b.name || '')))[0] || vs[0] || null;
  }

  FF.util = {
    esc, clean, num, fmt, fmtShort, pctOf, growth, fmtPct, fmtSigned, deltaHtml, pctHtml,
    suggestDays, suggestMode, runRateDays, runRate, reportBasis, channelBasis, dataBasis, parseDayLabel, ffCapDate, basisText, projectMonthEnd, dispatchCalc, suggestNet, suggestGross, suggestPair, sugCell, sugText,
    MONTHS, MONTHS_LONG, DAYS, pad2, parseDate, parseMonthKey, ymKey, dateKey, fromDateKey, ymParts, labelYM, labelDate, labelDateKey,
    weekday, daysInMonth, prevMonthKey, nextMonthKey, weekStart, timeLabel,
    barcode, barcodeKey,
    sum, groupSum, topEntries, sortBy, uniq,
    $, $, h, debounce, within, breathe, setButtonBusy, withButtonBusy, toast, spinner, loader, loaderStyle, loaderPref, ellipsis, LOADER_STYLES, LOADER_LABELS, errorBox, downloadBlob, downloadStart, downloadFail, downloadCsv, tableToRows, slug, stamp, colLetter, colIndex, initTooltip,
    phoneDigits, waLink, mailLink, copyText, suggest,
    parseDateTime, printReport, recentList, recentAdd, voiceInput, voicePrefs, setVoicePrefs,
    multiSelect, asValueSet, valueSetLabel,
    resamplePcm, analyzePcm, analyzeVoiceBlob, startVoiceCapture, analyzeVoiceCapture, voiceProfile, setVoiceProfile, matchVoice, VOICE_PROFILE_LIMIT,
    wakeNorm, wakeWordMatch
  };
})(window.FF);
