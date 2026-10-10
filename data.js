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

  function parseGviz(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < 0) throw new Error('Google Sheet se galat response aaya (JSON nahi mila). Sheet public hai?');
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
        cache: 'no-store', 
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'FF-Dashboard' }
      });
      const text = await res.text();
      if (!res.ok) {
        let detail = '';
        try { detail = JSON.parse(text).error || ''; } catch (e) { /* ignore */ }
        if (res.status === 401 && !url.startsWith('http')) { const e = new Error('Login required'); e.name = 'AuthError'; throw e; }
        throw new Error(`HTTP ${res.status}${detail ? ' – ' + detail : ''}`);
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
    const key = `${sourceId}|${sheetName}|${gid}|${range || ''}|${tq || ''}`;
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && (hit.pending || (!o.fresh && now - hit.t < TTL_MS))) return hit.promise;

    const extra = { ...(o.fresh ? { fresh: '1' } : {}), ...(range ? { range } : {}) };
    const attempts = [];
    const proxyUrl = FF.config.proxyPath && FF.config.proxy !== false
      ? buildUrl(FF.config.proxyPath, sheetName, tq, gid, extra) : '';
    const directUrl = FF.config.directFallback !== false
      ? buildUrl(directBase(sheetName), sheetName, tq, gid, range ? { range } : null) : '';
    // Large inventory exact-match lookups may be faster against Google directly. Mapping opts in
    // per request; all other dashboard requests retain the normal proxy/cache-first behavior.
    if (o.directFirst) {
      if (directUrl) attempts.push(directUrl);
      if (proxyUrl) attempts.push(proxyUrl);
    } else {
      if (proxyUrl) attempts.push(proxyUrl);
      if (directUrl) attempts.push(directUrl);
    }

    const promise = (async () => {
      let lastErr = null;
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
        if (fatal || round >= delays.length) break;
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

  FF.data = { query, today, gvToday, clearCache, status, parseGviz, cellText, identifierText, isIdentifierColumn, cellNumber, cellDate, textRows, looksLikeEIR, lit, QueryError,
    get lastLoadAt() { return lastLoadAt; }, get lastSource() { return lastSource; } };
})(window.FF);
