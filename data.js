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

  function cellText(cell, col) {
    if (!cell || cell.v === null || cell.v === undefined) return '';
    // 🔢 Barcode/16-digit serial: sheet ka "formatted" text (6.08E+15) dikhta tha — us se digits hi
    // gum ho jaate the. Bade integer ke liye exact value do, display format util.barcode() banata hai.
    const v0 = cell.v;
    if (typeof v0 === 'number' && Number.isInteger(v0) && Math.abs(v0) >= 1e15) return String(v0);
    if (typeof v0 === 'string' && /^-?\d(?:\.\d+)?e\+?\d+$/i.test(v0.trim())) {
      const num = Number(v0);
      if (Number.isFinite(num)) return BigInt(Math.round(num)).toString();
    }
    if (cell.f !== null && cell.f !== undefined) return String(cell.f);
    const v = cell.v;
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
    if (FF.config.proxyPath && FF.config.proxy !== false) attempts.push(buildUrl(FF.config.proxyPath, sheetName, tq, gid, extra));
    if (FF.config.directFallback !== false) attempts.push(buildUrl(directBase(sheetName), sheetName, tq, gid, range ? { range } : null));

    const promise = (async () => {
      let lastErr = null;
      // 🔁 Auto-retry (v3.32): network hiccup / Google 429-5xx / timeout par chup-chaap 3 try (backoff 0.7s, 1.8s).
      //    QueryError (galat query) aur login-expiry par retry nahi — wo dobara bhi fail hote.
      const delays = o.retries === 0 ? [] : [700, 1800];
      for (let round = 0; round <= delays.length; round++) {
        let fatal = false;
        for (const url of attempts) {
          try {
            const { text, source } = await fetchText(url, o.timeoutMs);
            const table = parseGviz(text);
            table.source = source;
            table.sheet = sheetName;
            lastLoadAt = Date.now();
            lastSource = source;
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

  function clearCache() { cache.clear(); }

  /** ⚡ Aaj ka live feed (chhoti server query): GV = GV Master sheet, FF = EIR. */
  function today(opts) {
    const o = opts || {};
    const base = FF.config.todayPath || '/api/today';
    const url = `${base}${o.fresh ? '?fresh=1' : ''}`;
    return fetch(url, { credentials: 'same-origin', cache: 'no-store', headers: { 'X-Requested-With': 'FF-Dashboard' } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`today feed HTTP ${res.status}`))))
      .then((json) => { if (json && json.ok === false) throw new Error(json.error || 'today feed unavailable'); return json; });
  }

  // Escape a literal for the gviz query language (double-quoted string).
  function lit(value) { return `"${String(value).replace(/["\\]/g, '')}"`; }

  FF.data = { query, today, clearCache, parseGviz, cellText, cellNumber, cellDate, textRows, looksLikeEIR, lit, QueryError,
    get lastLoadAt() { return lastLoadAt; }, get lastSource() { return lastSource; } };
})(window.FF);
