/* 📒 DISPATCH LEDGER — barcode → kab aur kisko dispatch hua.
 *
 * Source: IDFC Stock Sheet (FF) aur GV Stock Sheet — har row = ek dispatch, jisme FIRST aur LAST barcode likha hota hai
 * (pura series). Hum har range ko prefix + serial number me todte hain aur sorted interval index banate hain, taaki
 * koi bhi barcode (ya hazaaron) turant us row se mil jaye — "Series Expand" tab ki jagah code se expand.
 *
 *  Barcode shape: 608116-039-0541048  →  prefix "608116039" + serial 541048 (aakhri 7 digit).
 *  Galat ends (alag prefix / end < start) ho to QNT se start..start+QNT-1 maana jaata hai (approx=true).
 *  Pure functions — dev/dispatch-ledger.test.js seedha test karta hai. */

const str = (v) => (v === null || v === undefined ? '' : String(v)).trim();
const MAX_RANGE = 200000;

/** "608116-039-0541048" / "6081160390541048" → { pfx, n } ya null. */
export function parseBarcode(value) {
  const t = str(value);
  if (!t) return null;
  const parts = t.split(/[^0-9]+/).filter(Boolean);
  if (parts.length >= 3) {
    const serial = parts[parts.length - 1], pfx = parts.slice(0, -1).join('');
    if (serial.length >= 4 && pfx.length >= 3) return { pfx, n: Number(serial) };
  }
  const d = t.replace(/\D/g, '');
  if (d.length >= 11) return { pfx: d.slice(0, -7), n: Number(d.slice(-7)) };
  return null;
}

/** Layouts: column index (0 = A) of each field per sheet type. */
export const LAYOUTS = {
  ff: { date: 0, agent: 1, agentId: 2, cls: 3, qty: 4, first: 5, last: 6, result: 7, actual: 8, status: 9, note1: 10, note2: 11 },
  gv: { date: 0, agentId: 1, agent: 2, mobile: 3, cls: 4, qty: 5, first: 6, last: 7, actual: 8, status: 9, note1: 10, note2: 11 }
};
export const LAYOUT_LETTERS = (layout) => {
  const L = LAYOUTS[layout] || LAYOUTS.ff;
  const max = Math.max(...Object.values(L));
  return Array.from({ length: max + 1 }, (_, i) => String.fromCharCode(65 + i));
};

const normCls = (v) => { const d = str(v).replace(/\D/g, ''); return d ? `VC${d}` : str(v).toUpperCase(); };

/** Ek sheet row (array of cell texts) → entry ya null. `dateOf` = date normaliser (server me serverDate). */
export function rowToEntry(cells, layout, ch, rowNo, dateOf = (x) => str(x)) {
  const L = LAYOUTS[layout] || LAYOUTS.ff;
  const g = (k) => (L[k] === undefined ? '' : str(cells[L[k]]));
  const a = parseBarcode(g('first'));
  if (!a) return null;
  const b = parseBarcode(g('last'));
  const qty = Number(String(g('actual')).replace(/[^\d]/g, '')) || Number(String(g('qty')).replace(/[^\d]/g, '')) || 0;
  let lo = a.n, hi = b && b.pfx === a.pfx ? b.n : NaN, approx = false;
  if (!(hi >= lo)) {
    const q = Number(String(g('qty')).replace(/[^\d]/g, '')) || 0;
    if (q > 0) { hi = lo + q - 1; approx = true; } else { hi = lo; approx = true; }
  }
  if (hi - lo + 1 > MAX_RANGE) return null;
  const agent = g('agent');
  return {
    ch, row: rowNo, pfx: a.pfx, lo, hi, approx,
    date: dateOf(cells[L.date]) || '', agent, agentId: g('agentId'), cls: normCls(g('cls')), qty,
    first: g('first'), last: g('last'), status: g('status'), result: g('result'),
    note: [g('note1'), g('note2')].filter((x) => x && x !== agent).join(' · ').slice(0, 120)
  };
}

/** Entries → lookup index. */
export function buildLedgerIndex(entries) {
  const byPfx = new Map();
  for (const e of entries) { const l = byPfx.get(e.pfx); if (l) l.push(e); else byPfx.set(e.pfx, [e]); }
  for (const list of byPfx.values()) {
    list.sort((x, y) => x.lo - y.lo || x.hi - y.hi);
    let m = -1; list.runMax = new Array(list.length);
    for (let i = 0; i < list.length; i++) { m = Math.max(m, list[i].hi); list.runMax[i] = m; }
  }
  return { byPfx, count: entries.length };
}

/** Barcode ke saare matching ledger rows (latest date pehle). */
export function lookupBarcode(index, barcode) {
  const p = parseBarcode(barcode);
  if (!p || !index) return [];
  const list = index.byPfx.get(p.pfx);
  if (!list || !list.length) return [];
  // last i jahan lo <= n
  let l = 0, r = list.length - 1, pos = -1;
  while (l <= r) { const mid = (l + r) >> 1; if (list[mid].lo <= p.n) { pos = mid; l = mid + 1; } else r = mid - 1; }
  const out = [];
  for (let i = pos; i >= 0 && list.runMax[i] >= p.n; i--) if (list[i].hi >= p.n) out.push(list[i]);
  return out.sort((x, y) => (y.date || '').localeCompare(x.date || '') || y.row - x.row);
}

/** API shape — ek barcode ke liye ff[] / gv[] (har channel ke max 3). */
export function dispatchFor(indexes, barcode) {
  const pack = (e) => ({ date: e.date, agent: e.agent, agentId: e.agentId, cls: e.cls, qty: e.qty, first: e.first, last: e.last, status: e.status, note: e.note, row: e.row, approx: e.approx || undefined, src: e.src });
  const out = { barcode: str(barcode), ff: [], gv: [] };
  for (const ch of ['ff', 'gv']) {
    const hits = lookupBarcode(indexes[ch], barcode);
    out[ch + 'Count'] = hits.length;
    out[ch] = hits.slice(0, 3).map(pack);
  }
  return out;
}
