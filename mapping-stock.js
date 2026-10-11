// FASTag Mapping — server-side StockDataa index (v3.71).
// Pehle browser Google gviz se 5000-5000 rows ke pages khud kheenchta tha (4.5 s timeout) aur
// "paged barcode lookup failed near row 5001: signal is aborted" aata tha. Ab server StockDataa ko
// EK baar bade pages me padh kar memory me compact index banata hai (barcode / tag ID / sorted
// barcode range) aur har lookup milliseconds me hota hai. Index stale-while-revalidate hai:
// purana turant serve hota hai, peeche refresh chalta hai; miss par ek forced refresh hota hai
// (taaki abhi-abhi add hui row bhi mile).

const clean = (v) => String(v == null ? '' : v).replace(/\u00a0/g, ' ').trim();

/** "8.9E+15" jaise scientific text ko plain digits me badlo (Number() se round nahi karta). */
export function expandIdentifierNumber(value) {
  const raw = clean(value);
  const m = raw.match(/^([+-]?)(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/);
  if (!m) return raw;
  const sign = m[1] || '', whole = m[2], frac = m[3] || '', exponent = Number(m[4]);
  const digits = whole + frac;
  const decimalAt = whole.length + exponent;
  if (decimalAt <= 0) return sign + '0.' + '0'.repeat(Math.min(1000, -decimalAt)) + digits;
  if (decimalAt >= digits.length) return sign + digits + '0'.repeat(Math.min(1000, decimalAt - digits.length));
  return sign + digits.slice(0, decimalAt) + '.' + digits.slice(decimalAt);
}

/** Lookup key: spaces / commas / hyphens hatao, lowercase, scientific expand. */
export const idKey = (v) => expandIdentifierNumber(clean(v)).replace(/[\s,\u00a0-]/g, '').toLowerCase();
const stripZeros = (k) => (/^\d+$/.test(k) ? (k.replace(/^0+(?=\d)/, '')) : k);
const isDigits = (s) => /^\d+$/.test(s);
const cmpCanon = (a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0);

export function compareBarcode(a, b) {
  const rawX = clean(a), rawY = clean(b);
  const x = rawX.replace(/[,\s-]/g, ''), y = rawY.replace(/[,\s-]/g, '');
  if (isDigits(x) && isDigits(y)) return cmpCanon(stripZeros(x), stripZeros(y));
  return rawX.localeCompare(rawY, undefined, { numeric: true, sensitivity: 'base' });
}

/** gviz cell → identifier-safe text (formatted digits > raw number; scientific expand). */
export function identifierText(cell) {
  if (!cell) return '';
  const display = clean(cell.f);
  if (/^\d[\d,]*$/.test(display)) return display.replace(/,/g, '');
  if (cell.v !== null && cell.v !== undefined && clean(cell.v) !== '') {
    const raw = clean(cell.v);
    if (typeof cell.v === 'number' || /^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(raw)) return expandIdentifierNumber(raw);
    return raw;
  }
  return display;
}
function plainText(cell) {
  if (!cell) return '';
  if (cell.f !== null && cell.f !== undefined && clean(cell.f) !== '') return clean(cell.f);
  return cell.v === null || cell.v === undefined ? '' : clean(cell.v);
}

const FIELDS = ['id', 'name', 'tagId', 'barcode', 'cls', 'tagType', 'bcAt', 'agentId', 'agentName', 'agentAt', 'tl'];
const IDENTIFIER_FIELDS = new Set(['tagId', 'barcode']);
const lowerBound = (arr, key) => { let lo = 0, hi = arr.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (cmpCanon(arr[mid].k, key) < 0) lo = mid + 1; else hi = mid; } return lo; };
const upperBound = (arr, key) => { let lo = 0, hi = arr.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (cmpCanon(arr[mid].k, key) <= 0) lo = mid + 1; else hi = mid; } return lo; };

export function createMappingStock({ getConfig, loadPages, normalizeVcType = (v) => clean(v).toUpperCase(), ttlMs = 5 * 60e3, minRefreshMs = 20e3, maxPerRange = 20000, now = Date.now, allowRefresh = () => true, onProgress = null } = {}) {
  let index = null;          // { rows, byBarcode, byTag, sorted, builtAt, key }
  let building = null;
  let lastError = '';
  // 📊 Live build progress — client isse "StockDataa index ban raha hai… 1,20,000 rows" dikhata hai.
  let progress = null;       // { startedAt, pages, rows, lastPageAt, doneAt, failedAt }

  async function build(cfg) {
    const L = cfg.letters;
    const letters = [...new Set(FIELDS.map((f) => L[f]).filter(Boolean))];
    if (!L.tagId && !L.barcode) throw new Error('StockDataa me TAG_ID / BARCODE column configure nahi hai.');
    const where = [L.tagId, L.barcode].filter(Boolean).map((c) => `${c} is not null`).join(' or ');
    const rows = [];
    progress = { startedAt: now(), pages: 0, rows: 0, lastPageAt: 0, doneAt: 0, failedAt: 0 };
    await loadPages(cfg.sheetId, cfg.sheet, letters, where, async (pageRows, at) => {
      const ix = Object.fromEntries(FIELDS.map((f) => [f, L[f] ? at(L[f]) : -1]));
      for (const row of pageRows) {
        const cells = row && row.c ? row.c : [];
        const rec = new Array(FIELDS.length);
        for (let i = 0; i < FIELDS.length; i++) {
          const f = FIELDS[i], c = ix[f] >= 0 ? cells[ix[f]] : null;
          rec[i] = IDENTIFIER_FIELDS.has(f) ? identifierText(c) : plainText(c);
        }
        if (rec[2] || rec[3]) rows.push(rec);
      }
      if (progress) {
        progress.pages++;
        progress.rows = rows.length;
        progress.lastPageAt = now();
        if (onProgress) { try { onProgress(progress); } catch { /* progress callback optional */ } }
      }
    });
    const byBarcode = new Map(), byTag = new Map(), sorted = [], text = [];
    const push = (map, key, i) => { if (!key) return; const cur = map.get(key); if (cur) cur.push(i); else map.set(key, [i]); };
    rows.forEach((rec, i) => {
      const bk = idKey(rec[3]), tk = idKey(rec[2]);
      push(byBarcode, bk, i);
      if (bk && stripZeros(bk) !== bk) push(byBarcode, stripZeros(bk), i);
      push(byTag, tk, i);
      if (tk && stripZeros(tk) !== tk) push(byTag, stripZeros(tk), i);
      if (bk && isDigits(bk)) sorted.push({ k: stripZeros(bk), i }); else if (bk) text.push(i);
    });
    sorted.sort((a, b) => cmpCanon(a.k, b.k));
    return { rows, byBarcode, byTag, sorted, text, builtAt: now(), key: JSON.stringify([cfg.sheetId, cfg.sheet, cfg.letters]) };
  }

  function startBuild() {
    if (building) return building;
    const cfg = getConfig();
    building = build(cfg).then((next) => {
      index = next; lastError = '';
      if (progress) { progress.doneAt = now(); progress.failedAt = 0; }
      return next;
    })
      .catch((err) => {
        lastError = (err && err.message) || 'StockDataa index build fail';
        if (progress) progress.failedAt = now();
        throw err;
      })
      .finally(() => { building = null; });
    building.catch(() => {});
    return building;
  }

  /** Index do. Pehli baar build ka intezaar; baad me stale-while-revalidate. fresh=true → naya build. */
  async function ensure({ fresh = false } = {}) {
    const cfg = getConfig();
    const key = JSON.stringify([cfg.sheetId, cfg.sheet, cfg.letters]);
    if (index && index.key !== key) index = null;       // settings badli → purana index galat sheet ka
    if (fresh || !index) return startBuild();
    if (now() - index.builtAt >= ttlMs && !building) startBuild();
    return index;
  }

  const toStock = (rec) => ({
    stockRowId: rec[0], inventoryName: rec[1], tagId: rec[2], barcode: rec[3], serialNo: rec[3],
    vcType: normalizeVcType(rec[4]), tagType: rec[5], barcodeAllocatedAt: rec[6],
    stockAgentId: rec[7], stockAgentName: rec[8], agentAllocatedAt: rec[9], tlName: rec[10]
  });

  function pick(map, value) {
    const k = idKey(value);
    if (!k) return [];
    return map.get(k) || map.get(stripZeros(k)) || [];
  }

  function resolve(ix, item) {
    const type = item.type === 'range' || (item.first && item.last) ? 'range' : (item.tagId ? 'tagId' : 'barcode');
    if (type === 'range') {
      const from = clean(item.first).replace(/[,\s-]/g, ''), to = clean(item.last).replace(/[,\s-]/g, '');
      if (!from || !to) return { rows: [], error: 'First / Last barcode required.' };
      if (compareBarcode(from, to) > 0) return { rows: [], error: 'First barcode last se bada hai.' };
      let idxs = [];
      if (isDigits(from) && isDigits(to)) {
        const lo = lowerBound(ix.sorted, stripZeros(from)), hi = upperBound(ix.sorted, stripZeros(to));
        if (hi - lo > maxPerRange) return { rows: [], error: `Is range me ${hi - lo} tags hain (max ${maxPerRange}). Range ko chhote parts me baant dein.` };
        for (let i = lo; i < hi; i++) idxs.push(ix.sorted[i].i);
      } else {
        for (let i = 0; i < ix.rows.length; i++) {
          const bc = ix.rows[i][3];
          if (bc && compareBarcode(bc, from) >= 0 && compareBarcode(bc, to) <= 0) idxs.push(i);
          if (idxs.length > maxPerRange) return { rows: [], error: `Range me ${maxPerRange}+ tags — chhota karein.` };
        }
      }
      return { rows: idxs.map((i) => toStock(ix.rows[i])), matchedBy: 'Barcode range' };
    }
    const barcodeKey = clean(item.barcode || item.serialNo);
    if (type === 'tagId') {
      let hits = pick(ix.byTag, item.tagId);
      if (hits.length && barcodeKey) { const bk = stripZeros(idKey(barcodeKey)); hits = hits.filter((i) => stripZeros(idKey(ix.rows[i][3])) === bk); }
      return { rows: [...new Set(hits)].map((i) => toStock(ix.rows[i])), matchedBy: 'Tag ID' };
    }
    return { rows: [...new Set(pick(ix.byBarcode, barcodeKey))].map((i) => toStock(ix.rows[i])), matchedBy: 'Barcode' };
  }

  /** items: [{ type, barcode, tagId, first, last }] → [{ index, rows, matchedBy, error? }] */
  async function lookup(items, { fresh = false } = {}) {
    let ix = await ensure({ fresh });
    let refreshed = fresh || (now() - ix.builtAt < 1500);
    const out = items.map((item, index) => ({ index, ...resolve(ix, item) }));
    const missing = out.filter((r) => !r.rows.length && !r.error);
    // Miss par ek baar fresh build (abhi-abhi add hui row ke liye) — par har request par nahi.
    // Google rate limit (cooldown) ke dauran ye rebuild skip hota hai (allowRefresh server se aata hai).
    if (missing.length && !refreshed && now() - ix.builtAt >= minRefreshMs && allowRefresh()) {
      try {
        ix = await startBuild(); refreshed = true;
        for (const r of missing) Object.assign(r, resolve(ix, items[r.index]));
      } catch { /* purana index se jo mila wahi theek */ }
    }
    return { results: out, meta: { rows: ix.rows.length, ageSec: Math.round((now() - ix.builtAt) / 1000), refreshed } };
  }

  const status = () => ({
    ready: !!index, building: !!building,
    rows: index ? index.rows.length : 0,
    ageSec: index ? Math.round((now() - index.builtAt) / 1000) : null,
    error: lastError,
    build: progress ? {
      pages: progress.pages, rows: progress.rows,
      startedAt: progress.startedAt ? new Date(progress.startedAt).toISOString() : '',
      ageSec: Math.round((now() - progress.startedAt) / 1000),
      done: !!progress.doneAt, failed: !!progress.failedAt
    } : null
  });
  return { ensure, lookup, status, _resolve: resolve };
}

/** Google Sheet link / ID se spreadsheet ID nikaalo. */
export function sheetIdFrom(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/) || s.match(/^([A-Za-z0-9_-]{20,})$/);
  return m ? m[1] : '';
}
