/* Data layer: Google Visualization (gviz) queries against the public sheet.
   Flow: /api/gviz (server.js proxy, cached) → direct Google fetch (static hosting fallback).
   Queries use the gviz query language (select / where / group by / order by / limit / offset), so even
   1-lakh-row tabs (EIR, StockDataa) are aggregated / paged by Google — the browser never downloads them fully. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const TTL_MS = Infinity; // no auto expiry — data stays until the ↻ button / browser reload
  const cache = new Map(); // key → { t, promise }
  // Tiny live endpoints are shared across pages/preloader so multiple renders don't hit Google twice.
  const todayCache = { at: 0, value: null, promise: null };
  const gvTodayCache = { at: 0, value: null, promise: null };
  const TODAY_TTL = 25e3;
  let lastLoadAt = null;
  let lastSource = '';
  // 🚦 Rate limit state (v3.72): Google 429 ("Too Many Requests") dete hi browser se direct Google
  // calls band ho jaati hain (warna wahi HTML page + slow lookups bante rehte hain) aur thodi der
  // ke liye sab apne server proxy se hi jaata hai.
  const rateLimitState = { until: 0, directUntil: 0, hits: 0, lastAt: 0 };
  function markRateLimited(retryAfterMs) {
    const wait = Math.max(5000, Math.min(120000, Number(retryAfterMs) || 30e3));
    rateLimitState.until = Math.max(rateLimitState.until, Date.now() + wait);
    rateLimitState.directUntil = Math.max(rateLimitState.directUntil, Date.now() + Math.max(wait, 120000));
    rateLimitState.hits++; rateLimitState.lastAt = Date.now();
  }
  const directAllowed = () => FF.config.directFallback !== false && FF.config.gvizDirect !== false && Date.now() >= rateLimitState.directUntil;
  const rateLimitStatus = () => ({
    hits: rateLimitState.hits, lastAt: rateLimitState.lastAt, active: Date.now() < rateLimitState.until,
    blockedSec: Math.max(0, Math.ceil((rateLimitState.until - Date.now()) / 1000)),
    directBlockedSec: Math.max(0, Math.ceil((rateLimitState.directUntil - Date.now()) / 1000))
  });

  function directBase(sheet) {
    const cfg = FF.config.sheetByName(sheet);
    const id = cfg && cfg.source === 'gv' ? FF.config.gvSheetId : FF.config.sheetId;
    return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq`;
  }

  /** Sheet tab config for a name — falls back to a synthetic entry so unknown tabs still load. */
  function cfgFor(sheet) { return FF.config.sheetByName(sheet) || { id: sheet, tab: sheet, source: 'main', gid: '' }; }

  function buildUrl(base, sheet, tq, gid, extra) {
    const p = new URLSearchParams();
    p.set('tqx', 'out:json');
    if (gid) p.set('gid', gid); else p.set('sheet', sheet);
    if (tq) p.set('tq', tq);
    if (extra) Object.entries(extra).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); });
    const cfg = cfgFor(sheet);
    if (cfg.source === 'gv' && FF.config.gvSheetId && !base.startsWith('https://docs.google.com')) p.set('id', FF.config.gvSheetId);
    return `${base}?${p.toString()}`;
  }

  class QueryError extends Error {
    constructor(message, detail) { super(message); this.name = 'QueryError'; this.detail = detail; }
  }
  /** v3.72 — Google ka "Too Many Requests" / HTML page. Ye kabhi screen par nahi dikhna chahiye:
   *  user ko saaf message milta hai aur apne server ke cache se data aata rehta hai. */
  class RateLimitError extends Error {
    constructor(message, retryAfterMs, detail) { super(message); this.name = 'RateLimitError'; this.retryAfterMs = Math.max(0, Number(retryAfterMs) || 0); this.detail = detail; }
  }
  function rateLimitPage(text) {
    const body = String(text || '');
    if (!body || body.includes('setResponse')) return false;
    if (/too many requests/i.test(body)) return true;
    return /<html/i.test(body) && !/^[\s]*\{/.test(body) && /normalize\.css|rate.?limit|429/i.test(body);
  }
  const rateLimitMessage = (retryAfterMs) => {
    const sec = Math.max(1, Math.ceil((Number(retryAfterMs) || 0) / 1000));
    return 'Google Sheets ne rate limit kar diya (429 Too Many Requests). ' + (retryAfterMs ? '~' + sec + ' second me apne aap dobara try hoga. ' : '') + 'Purana/cache data dikh raha hai — thodi der baad phir try karein.';
  };
  /** Google ke HTML page se sirf chhota, saaf text nikaalo (UI me raw HTML kabhi nahi). */
  function htmlHint(text) {
    const body = String(text || '');
    const title = (body.match(/<title[^>]*>([^<]{1,120})<\/title>/i) || [])[1];
    if (title) return title.replace(/\s+/g, ' ').trim();
    return body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  function parseGviz(text) {
    if (rateLimitPage(text)) throw new RateLimitError(rateLimitMessage(0), 0, 'html');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < 0) {
      if (/^\s*</.test(String(text || ''))) throw new Error('Google ne HTML page bheja ("' + htmlHint(text) + '") — JSON nahi mila. Sheet public hai?');
      throw new Error('Google Sheet se galat response aaya (JSON nahi mila). Sheet public hai?');
    }
    let json;
    try { json = JSON.parse(text.slice(start, end + 1)); } catch (e) { throw new Error('Response parse nahi hua: ' + e.message); }
    if (json.status === 'error') {
      const msg = (json.errors || []).map((e) => e.detailed_message || e.message).join('; ') || 'Query error';
      throw new QueryError(msg.replace(/<[^>]+>/g, ''), json.errors);
    }
    const table = json.table || { cols: [], rows: [] };
    const cols = (table.cols || []).map((c) => ({ id: c.id, label: c.label || '', type: c.type || 'string', pattern: c.pattern || '' }));
    const rows = (table.rows || []).map((r) => (r.c || []).map((c) => (c ? { v: c.v, f: c.f } : null)));
    return { cols, rows, headers: table.parsedNumHeaders || 0, warnings: json.warnings || [] };
  }

  function expandScientificIdentifier(value) {
    const raw = String(value == null ? '' : value).trim();
    const m = raw.match(/^([+-]?)(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/);
    if (!m) return raw;
    const sign = m[1] || '', whole = m[2], fraction = m[3] || '';
    const digits = whole + fraction;
    const decimalAt = whole.length + Number(m[4]);
    if (decimalAt <= 0) return sign + '0.' + '0'.repeat(Math.min(1000, -decimalAt)) + digits;
    if (decimalAt >= digits.length) return sign + digits + '0'.repeat(Math.min(1000, decimalAt - digits.length));
    return sign + digits.slice(0, decimalAt) + '.' + digits.slice(decimalAt);
  }

  function identifierText(cell) {
    if (!cell) return '';
    const raw = cell.v === null || cell.v === undefined ? '' : String(cell.v).trim();
    const formatted = cell.f === null || cell.f === undefined ? '' : String(cell.f).trim();
    // Sheets may return barcode/serial display values with commas, spaces or separators.
    // Preserve leading zeroes from a digit-formatted cell, but remove presentation separators.
    if (formatted && /^\d[\d,\s-]*$/.test(formatted)) return formatted.replace(/[,\s-]/g, '');
    if (!raw) return /^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(formatted) ? expandScientificIdentifier(formatted) : formatted;
    if (/^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(raw)) return expandScientificIdentifier(raw);
    // Text values stay text; only remove a trailing numeric-cell .0 (not meaningful in an ID).
    if (/^\d+\.0+$/.test(raw)) return raw.replace(/\.0+$/, '');
    if (typeof cell.v === 'number' && Number.isFinite(cell.v)) return String(cell.v);
    return raw;
  }

  function isIdentifierColumn(col) {
    const label = String(col && (col.label || col.id) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return /^(?:TAGID(?:NUMBER|NO)?|TAGNUMBER|BARCODE(?:ID|NO|NUMBER)?|SERIAL(?:NO|NUMBER|ID)?|SNO|FASTAGID|FASTAGTAGID|TAGBARCODE(?:ID)?)$/.test(label);
  }

  function cellText(cell, col) {
    if (!cell) return '';
    // Some gviz cells carry a usable formatted identifier without a raw v field.
    if (isIdentifierColumn(col)) return identifierText(cell);
    if (cell.v === null || cell.v === undefined) return '';
    const v = cell.v;
    // Identifier columns must never display Google Sheets' 6.08E+15 / comma-formatted version.
    // This single path feeds the EIR / StockDataa sheet grid and other tables using D.textRows().
    // Keep exact integer digits when gviz returns a numeric barcode without a recognized header.
    if (typeof v === 'number' && Number.isInteger(v) && Math.abs(v) >= 1e15) return String(v);
    if (typeof v === 'string' && /^-?\d(?:\.\d+)?e\+?\d+$/i.test(v.trim())) return expandScientificIdentifier(v);
    if (cell.f !== null && cell.f !== undefined) return String(cell.f);
    if (typeof v === 'string' && /^Date\(/.test(v)) {
      const d = U.parseDate(v);
      return d ? U.labelDate(d, true) : v;
    }
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return String(v);
  }
  function cellNumber(cell) {
    if (!cell || cell.v === null || cell.v === undefined) return null;
    if (typeof cell.v === 'number') return Number.isFinite(cell.v) ? cell.v : null;
    return U.num(cell.f !== undefined && cell.f !== null ? cell.f : cell.v);
  }
  function cellDate(cell) {
    if (!cell || cell.v === null || cell.v === undefined) return null;
    return U.parseDate(cell.v) || U.parseDate(cell.f);
  }
  // String matrix (formatted values) of a table
  function textRows(table) { return table.rows.map((r) => table.cols.map((c, i) => cellText(r[i], c))); }
  function looksLikeEIR(table) {
    const labels = table.cols.slice(0, 3).map((c) => U.clean(c.label).toUpperCase());
    return labels[0] === 'TAG_ID' && labels[1] === 'VRN';
  }

  async function fetchText(url, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 55000);
    try {
      const res = await fetch(url, { 
        signal: ctrl.signal, 
        cache: 'no-cache',   // revalidate every time (ETag → 304 = no body when the sheet is unchanged)
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'FF-Dashboard' }
      });
      const text = await res.text();
      const retryAfterMs = (Number(res.headers.get('retry-after') || 0) || 0) * 1000;
      const limited = res.status === 429 || res.headers.get('x-ff-rate-limited') === '1';
      if (limited || (!res.ok && rateLimitPage(text))) {
        // Apne server ka 429 apna saaf message bhejta hai (JSON error) — wahi use karo, warna
        // generic rate-limit message. Google ka HTML kabhi message me nahi jaata.
        let detail = '';
        try { detail = JSON.parse(text).error || ''; } catch { /* HTML / plain text */ }
        if (/^\s*</.test(String(text || ''))) detail = '';
        markRateLimited(retryAfterMs || 30e3);
        throw new RateLimitError(String(detail || rateLimitMessage(retryAfterMs || 30e3)).slice(0, 300), retryAfterMs, url.startsWith('http') ? 'direct' : 'proxy');
      }
      if (!res.ok) {
        let detail = '';
        try { detail = JSON.parse(text).error || ''; } catch (e) { /* ignore */ }
        if (res.status === 401 && !url.startsWith('http')) { const e = new Error('Login required'); e.name = 'AuthError'; throw e; }
        // 5xx bhi HTML ke saath aa sakta hai — kabhi raw page screen par nahi.
        if (/^\s*</.test(String(text || ''))) detail = detail || htmlHint(text);
        throw new Error(`HTTP ${res.status}${detail ? ' – ' + detail : ''}`);
      }
      if (/^\s*<|<\/html>/i.test(String(text || ''))) {
        if (rateLimitPage(text)) { markRateLimited(retryAfterMs || 30e3); throw new RateLimitError(rateLimitMessage(retryAfterMs || 30e3), retryAfterMs, url.startsWith('http') ? 'direct' : 'proxy'); }
        throw new Error('Google ne HTML page bheja (' + htmlHint(text) + ') — JSON nahi mila.');
      }
      return { text, source: res.headers.get('x-ff-source') || (url.startsWith('http') ? 'direct' : 'proxy'), cached: res.headers.get('x-cache') === 'HIT' };
    } finally { clearTimeout(timer); }
  }

  /** Run a gviz query. Returns { cols, rows, headers, source }. */
  async function query(sheetName, tq, opts) {
    const o = opts || {};
    const cfg = FF.config.sheetByName(sheetName);
    const gid = o.gid !== undefined ? o.gid : (cfg && cfg.gid) || '';
    const configuredRange = (cfg && (cfg.range || (cfg.startCol || cfg.startRow || cfg.endCol || cfg.endRow ? (FF.config.formatRange ? FF.config.formatRange(cfg.startCol, cfg.startRow, cfg.endCol, cfg.endRow) : `${cfg.startCol || 'A'}${cfg.startRow || 1}:${cfg.endCol || ''}${cfg.endRow || ''}`) : ''))) || '';
    let range = o.range !== undefined ? o.range : configuredRange;
    if (/^[A-Z]+[0-9]+:$/i.test(range)) range = range.toUpperCase() === 'A1:' ? '' : `${range}ZZZ`;
    const sourceId = cfg && cfg.source === 'gv' ? FF.config.gvSheetId : FF.config.sheetId;
    const key = `${sourceId}|${sheetName}|${gid}|${range || ''}|${tq || ''}|${o.headers !== undefined ? o.headers : ''}`;
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && (hit.pending || (!o.fresh && now - hit.t < TTL_MS))) return hit.promise;

    const extra = { ...(o.fresh ? { fresh: '1' } : {}), ...(range ? { range } : {}), ...(o.headers !== undefined ? { headers: String(o.headers) } : {}) };
    const attempts = [];
    const proxyUrl = FF.config.proxyPath && FF.config.proxy !== false
      ? buildUrl(FF.config.proxyPath, sheetName, tq, gid, extra) : '';
    // Browser se Google direct call: sirf tab jab mapping flag allow kare aur rate limit na ho.
    // (Yehi direct call 429 "Too Many Requests" HTML page laati thi — ab cooldown par band.)
    const directUrl = directAllowed()
      ? buildUrl(directBase(sheetName), sheetName, tq, gid, (range || o.headers !== undefined) ? { ...(range ? { range } : {}), ...(o.headers !== undefined ? { headers: String(o.headers) } : {}) } : null) : '';
    // Large inventory exact-match lookups may be faster against Google directly. Mapping opts in
    // per request; all other dashboard requests retain the normal proxy/cache-first behavior.
    if (o.directFirst) {
      if (directUrl) attempts.push(directUrl);
      if (proxyUrl) attempts.push(proxyUrl);
    } else {
      if (proxyUrl) attempts.push(proxyUrl);
      if (directUrl) attempts.push(directUrl);
    }
    if (!attempts.length && (proxyUrl || directUrl)) attempts.push(proxyUrl || directUrl);
    if (!attempts.length) throw new Error('Sheet source configure nahi hai (proxy/direct dono band hain).');

    const promise = (async () => {
      let lastErr = null;
      let limitRetried = false;
      // 🔁 Auto-retry (v3.32): network hiccup / Google 429-5xx / timeout par chup-chaap 3 try (backoff 0.7s, 1.8s).
      //    QueryError (galat query) aur login-expiry par retry nahi — wo dobara bhi fail hote.
      const delays = o.retries === 0 ? [] : [700, 1800];
      for (let round = 0; round <= delays.length; round++) {
        let fatal = false;
        for (const url of attempts) {
          try {
            // Direct-first inventory lookups get a short direct attempt, then enough time for
            // the server proxy (whose upstream timeout is 45s) to return a response cleanly.
            const attemptTimeout = o.directFirst && url === directUrl
              ? Math.max(1000, Number(o.directTimeoutMs || 12000))
              : o.timeoutMs;
            const { text, source } = await fetchText(url, attemptTimeout);
            const table = parseGviz(text);
            table.source = source;
            table.sheet = sheetName;
            lastLoadAt = Date.now();
            lastSource = source;
            try { window.dispatchEvent(new CustomEvent('ff:data-loaded', { detail: { sheet: sheetName, source, at: lastLoadAt, cached: false } })); } catch { /* optional */ }
            return table;
          } catch (err) {
            lastErr = err;
            if (err instanceof QueryError) { fatal = true; break; } // same query would fail directly too
            if (err.name === 'AuthError') { if (FF.auth && FF.auth.onExpired) FF.auth.onExpired(); fatal = true; break; }
          }
        }
        if (fatal) break;
        // ⏳ Rate limit par ek chhota sa intezaar kar ke proxy se ek aur koshish (jitter ke saath) —
        //    parallel requests ek saath wapas na jaayein.
        if (!limitRetried && lastErr && lastErr.name === 'RateLimitError') {
          limitRetried = true;
          // Retry-After ko respect karo; cap FF.config.gvizRateLimitRetryMs se (tests chhota rakh sakte hain).
          const base = Math.max(600, Number(lastErr.retryAfterMs) || 1500);
          const cap = Math.max(1, Number((FF.config && FF.config.gvizRateLimitRetryMs) || 6000));
          const wait = Math.min(cap, base) * (0.8 + Math.random() * 0.4) + 250;
          await new Promise((r) => setTimeout(r, wait));
          const retryUrl = proxyUrl || attempts[attempts.length - 1];
          if (retryUrl) {
            try {
              const { text, source } = await fetchText(retryUrl, o.timeoutMs);
              const table = parseGviz(text);
              table.source = source; table.sheet = sheetName;
              lastLoadAt = Date.now(); lastSource = source;
              try { window.dispatchEvent(new CustomEvent('ff:data-loaded', { detail: { sheet: sheetName, source, at: lastLoadAt, cached: false } })); } catch { /* optional */ }
              return table;
            } catch (err) { lastErr = err; }
          }
        }
        if (round >= delays.length) break;
        await new Promise((r) => setTimeout(r, delays[round]));
      }
      throw lastErr || new Error('Fetch failed');
    })();
    const entry = { t: now, promise, pending: true };
    cache.set(key, entry);
    promise.then(() => { entry.pending = false; }, () => { entry.pending = false; });
    promise.catch(() => { if (cache.get(key) && cache.get(key).promise === promise) cache.delete(key); });
    return promise;
  }

  function status() {
    let pending = 0;
    cache.forEach((v) => { if (v && v.pending) pending++; });
    return { lastLoadAt, lastSource, cacheEntries: cache.size, pending };
  }

  function clearCache() {
    cache.clear();
    todayCache.at = 0; todayCache.value = null; todayCache.promise = null;
    gvTodayCache.at = 0; gvTodayCache.value = null; gvTodayCache.promise = null;
  }

  function endpointJson(path, cacheState, opts) {
    const o = opts || {};
    const fresh = !!o.fresh;
    const now = Date.now();
    if (!fresh && cacheState.value && now - cacheState.at < TODAY_TTL) return Promise.resolve({ ...cacheState.value, cached: true });
    if (cacheState.promise && !fresh) return cacheState.promise;
    const base = path || '';
    const url = `${base}${fresh ? '?fresh=1' : ''}`;
    const promise = fetch(url, { credentials: 'same-origin', cache: 'no-store', headers: { 'X-Requested-With': 'FF-Dashboard' } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`live feed HTTP ${res.status}`))))
      .then((json) => {
        if (json && json.ok === false) throw new Error(json.error || 'live feed unavailable');
        cacheState.value = json; cacheState.at = Date.now();
        return json;
      })
      .finally(() => { if (cacheState.promise === promise) cacheState.promise = null; });
    cacheState.promise = promise;
    return promise;
  }

  /** ⚡ Combined today feed: FF + GV + 30-day context. Shared so Home/preloader don't duplicate it. */
  function today(opts) {
    const base = FF.config.todayPath || '/api/today';
    return endpointJson(base, todayCache, opts);
  }

  /** 🟢 Fast GV-only today feed: GV Master current-day data without FF/history scans. */
  function gvToday(opts) {
    const base = FF.config.gvTodayPath || '/api/gv-today';
    return endpointJson(base, gvTodayCache, opts);
  }

  // Escape a literal for the gviz query language (double-quoted string).
  function lit(value) { return `"${String(value).replace(/["\\]/g, '')}"`; }

  /** 📒 Barcode → dispatch date / name (IDFC Stock Sheet + GV Stock Sheet ranges, server-side expand). Map(digits → {ff[],gv[]}). */
  async function dispatchLookup(barcodes) {
    const list = [...new Set((barcodes || []).map((b) => String(b || '').trim()).filter(Boolean))];
    const out = new Map(); let meta = null;
    if (!list.length || !FF.auth || typeof FF.auth.api !== 'function') return { map: out, meta };
    for (let i = 0; i < list.length; i += 5000) {
      const part = list.slice(i, i + 5000);
      let data = null;
      for (let attempt = 0; attempt < 40; attempt++) {
        data = await FF.auth.api('/api/dispatch-lookup', 'POST', { barcodes: part });
        if (!(data && data.pending)) break;
        await new Promise((r) => setTimeout(r, 2500));
      }
      if (!data || !data.ok || data.pending) throw new Error('Dispatch ledger abhi ready nahi');
      meta = data.meta || meta;
      (data.results || []).forEach((r) => out.set(String(r.barcode).replace(/\D/g, '').replace(/^0+/, ''), r));
    }
    return { map: out, meta };
  }
  FF.data = { dispatchLookup, query, today, gvToday, clearCache, status, parseGviz, cellText, identifierText, isIdentifierColumn, cellNumber, cellDate, textRows, looksLikeEIR, lit, QueryError, RateLimitError, rateLimitPage, rateLimitStatus, markRateLimited,
    get lastLoadAt() { return lastLoadAt; }, get lastSource() { return lastSource; } };
})(window.FF);
