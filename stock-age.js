/* 🧓 STOCK AGEING — server side (v3.31).
 *
 * Kyun server par: StockDataa (~1 lakh rows) + GV Tag Assignment (~60k rows) ki har row browser me
 * download karke index banana bahut bhaari tha (pehli baar drawer kholte hi 20-30 MB JSON → loader
 * atka hua lagta tha). Ab server dono tabs ek baar padhta hai (gviz proxy cache), har agent / TL /
 * network ke bucket counts compact JSON me deta hai, aur tag-level list sirf click par.
 *
 * FF  (StockDataa): umr = Agent Allocated At (J) — khaali ho to BC Allocated At (G).
 * GV  (Tag Assignment): sheet me allocation date column nahi hai (Settings → gv.assignment.allocatedAt
 *     set ho to wahi). Warna GV tag ko StockDataa me TAG_ID / BARCODE (= GV serial) se match karke
 *     uski allocation date (J, phir G = BC/master ko allocate hone ki date) li jaati hai.
 *
 * Buckets cumulative hain (v3.28 jaise): ≥ 1 mahina (30 din) · ≥ 3 (90) · ≥ 5 (150) · ≥ 6 (180).
 * Groups: 0 = VC4 + VC20 (car) · 1 = VC5+ (commercial).
 * Pure functions — dev/stock-age.test.js inhe seedha test karta hai. */

export const AGE_THRESH = [30, 90, 150, 180];
export const AGE_MONTHS = [1, 3, 5, 6];
const DAY_MS = 86400e3;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const str = (v) => (v === null || v === undefined ? '' : String(v)).trim();
export const digits = (v) => str(v).replace(/\D/g, '');
export const normName = (v) => str(v).toUpperCase().replace(/\s+/g, ' ');
function expandSciDigits(raw) {
  const m = raw.match(/^([+-]?)(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/);
  if (!m) return raw;
  const sign = m[1] || '', whole = m[2], frac = m[3] || '', exp = Number(m[4]);
  const all = whole + frac, at = whole.length + exp;
  if (at <= 0) return sign + '0.' + '0'.repeat(Math.min(1000, -at)) + all;
  if (at >= all.length) return sign + all + '0'.repeat(Math.min(1000, at - all.length));
  return sign + all.slice(0, at) + '.' + all.slice(at);
}
export function normBarcode(v) {
  const raw = str(v);
  if (!raw || /^0+$/.test(raw)) return '';
  const expanded = expandSciDigits(raw).replace(/\.0+$/, '');
  return expanded.replace(/\D/g, '').replace(/^0+/, '');
}

/** Sheet ke date formats → UTC day number: Date(2026,4,12,…) · 2026-05-12 · 12-05-2026 18:38:03 IST · 12/05/26 · 12-May-2026. */
export function parseStockDay(value) {
  const x = str(value);
  if (!x) return 0;
  let m = x.match(/^Date\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})/);
  if (m) return Date.UTC(+m[1], +m[2], +m[3]) / DAY_MS;
  m = x.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS;
  m = x.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; if (+m[2] >= 1 && +m[2] <= 12) return Date.UTC(y, +m[2] - 1, +m[1]) / DAY_MS; }
  m = x.match(/^(\d{1,2})[\s/-]+([A-Za-z]{3})[a-z]*[\s/-]+(\d{2,4})/);
  if (m) { const mi = MONTHS.indexOf(m[2].toLowerCase()); const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; if (mi >= 0) return Date.UTC(y, mi, +m[1]) / DAY_MS; }
  return 0;
}
/** VC4 / VC20 → 0 (core) · baaki sab → 1 (VC5+). */
export function groupOf(cls) {
  const c = str(cls).toUpperCase().replace(/^VC/, '').replace(/\.0+$/, '');
  return c === '4' || c === '20' ? 0 : 1;
}
export function normCls(value) {
  const d = digits(value);
  if (/^(4|5|6|7|12|16|20)$/.test(d)) return `VC${d}`;
  return str(value).toUpperCase() || 'NA';
}
const isHeaderTag = (tagId, cls) => /^(TAG[_ ]?ID|TAGID)$/i.test(str(tagId)) || /^(TAG[_ ]?CLASS|VEHICLE[_ ]?CLASS|CLASS)$/i.test(str(cls));

function newNode(name, id, tl) { return { n: name || '', id: id || '', tl: tl || '', t: [0, 0], u: [0, 0], c: [[0, 0, 0, 0], [0, 0, 0, 0]], o: [0, 0], s: [0, 0] }; }
function addAge(node, g, age) {
  node.t[g]++;
  if (age === null || age === undefined || age < 0) { node.u[g]++; return; }
  node.s[g] += age;
  if (age > node.o[g]) node.o[g] = age;
  for (let i = 0; i < AGE_THRESH.length; i++) if (age >= AGE_THRESH[i]) node.c[g][i]++;
}
/** Response ke liye compact shape (sum → avg). */
export function packNode(node) {
  const known = [node.t[0] - node.u[0], node.t[1] - node.u[1]];
  return { n: node.n, id: node.id, tl: node.tl, t: node.t, u: node.u, c: node.c, o: node.o, a: [known[0] ? Math.round(node.s[0] / known[0]) : 0, known[1] ? Math.round(node.s[1] / known[1]) : 0] };
}

/**
 * Index banao — INCREMENTAL builder.
 *
 * Pehle poora StockDataa (~1 lakh+ rows) + Tag Assignment (~60k) ek saath memory me aata tha (gviz JSON ~30 MB →
 * parse ke baad ~200-250 MB heap, measured 1.7 lakh + 59k rows par). Render ke chhote (512 MB) instance par
 * wahi build heap bhar sakta hai / 45 s upstream timeout paar kar sakta hai — tab har drawer + Agent/TL Summary
 * me "stock ageing load ho rahi hai" hamesha ghoomta rehta tha. Ab server page-by-page (25k rows) padhta hai
 * aur har page turant yahan `addFf` / `addGv` se index me mil jaata hai — peak memory sirf ek page + compact index.
 *
 *  Order: pehle saare FF pages (`addFf`), phir GV (`addGv`) — GV tag ki umr StockDataa ke tag ID / barcode
 *  match se aati hai. `finish()` ka output purane `buildStockAgeIndex` jaisa hi hai (same shape / same numbers).
 *
 *  ffRows: [{ id, tagId, barcode, cls, bcDate, agentId, agentName, agentDate, tl }]
 *  gvRows: [{ cls, tagId, serial, status, agentId, agentName, tlId, tlName, date }]
 *  todayDay: aaj ka UTC day number (IST date) · masterId: GV master ID (5845036) — sirf label ke liye.
 */
const NOT_ASSIGNED_RE = /^(not[\s_-]*assigned|unassigned|na|n\/a|none|null|nil|-+|0)$/i;
export const DEFAULT_GV_OUT_WORDS = ['ISSUE', 'SOLD', 'DISPATCH', 'DELIVER', 'RETURN', 'CANCEL', 'DEAD', 'BLOCK', 'LOST', 'DAMAGE', 'REPLAC', 'VOID', 'EXPIRE', 'CLOSED', 'INACTIVE'];
export function isGvOutStatus(status, outWords) {
  const st = str(status);
  if (!st || /not[\s_-]*assigned|unassigned/i.test(st)) return false;
  const words = outWords && outWords.length ? outWords : DEFAULT_GV_OUT_WORDS;
  const up = st.toUpperCase();
  return words.some((w) => up.includes(w));
}
export function isGvInStock(r, outWords) {
  return !!r && !isGvOutStatus(r.status, outWords);
}
/** GV Tag Assignment row tab "assigned" maani jaati hai jab uska GV agent ID / naam ho (not-assigned / blank nahi). */
export function isGvAssigned(r, outWords) {
  const id = str(r.agentId), name = str(r.agentName), st = str(r.status);
  if (/not[\s_-]*assigned|unassigned/i.test(st)) return false;
  if (isGvOutStatus(st, outWords)) return false;   // issued / out status = ab stock nahi
  const ok = (v) => v && !NOT_ASSIGNED_RE.test(v) && !/not[\s_-]*assigned|unassigned/i.test(v);
  return !!(ok(id) || ok(name));
}
export const TAG_TYPE_LABEL = { VC4: 'Car / Jeep / Van', VC5: 'Light Commercial', VC6: 'Three Axle Commercial', VC7: 'Bus / Truck', VC12: '4 to 6 axle', VC16: 'Heavy Construction', VC20: 'Light Goods / Mini LCV' };
const CLS_ORDER = ['VC12', 'VC16', 'VC4', 'VC5', 'VC6', 'VC7', 'VC20'];
/** StockDataa ke har tag ko 4 me se ek bucket: FF (sirf FF agent ID me) · GV (sirf GV ID me) · BOTH (dono) · OFFICE (kahin map nahi).
 *  Match: TAG_ID ya BARCODE (= GV serial). GV "not assigned" rows count nahi hoti. */
/** Ek StockDataa raw row ka bucket + GV info. */
export function mapBucketOf(r, gvMap, { masterDigits = '', parkedTlNorm = '' } = {}) {
  const tagU = str(r[0]).toUpperCase(), bc = normBarcode(r[1]);
  const agentName = str(r[4]), agentDigits = digits(r[5]), tlName = str(r[6]);
  const parked = (masterDigits && agentDigits === masterDigits) || (parkedTlNorm && normName(tlName) === parkedTlNorm) || (!agentDigits && !agentName);
  const ffMapped = !parked;
  const gvTag = gvMap.tags.has(tagU) ? tagU : (bc && gvMap.bcs.get(bc)) || '';
  const gvInfo = gvTag ? gvMap.tags.get(gvTag) : null;
  const bucket = ffMapped && gvInfo ? 'both' : ffMapped ? 'ff' : gvInfo ? 'gv' : 'office';
  return { bucket, gvInfo, ffMapped, tagU, bc };
}
export function buildMapSummary(ffRaw, gvMap, opts = {}) {
  const byCls = new Map();
  const slot = (c) => { let x = byCls.get(c); if (!x) { x = { cls: c, ff: 0, gv: 0, both: 0, office: 0, total: 0 }; byCls.set(c, x); } return x; };
  const seenTags = new Set();
  const tl = new Map();
  for (const r of ffRaw || []) {
    const { bucket, gvInfo, ffMapped, tagU } = mapBucketOf(r, gvMap, opts);
    seenTags.add(tagU);
    const c = slot(r[2] || 'NA');
    c.total++; c[bucket]++;
    if (ffMapped) { const k = str(r[6]) || '— (TL blank)'; const t = tl.get(k) || { tl: k, ff: 0, both: 0 }; t.ff++; if (gvInfo) t.both++; tl.set(k, t); }
  }
  const rows = [...byCls.values()].sort((a, b) => (CLS_ORDER.indexOf(a.cls) + 1 || 99) - (CLS_ORDER.indexOf(b.cls) + 1 || 99)).map((x) => ({ ...x, type: TAG_TYPE_LABEL[x.cls] || '' }));
  const total = rows.reduce((t, x) => ({ ff: t.ff + x.ff, gv: t.gv + x.gv, both: t.both + x.both, office: t.office + x.office, total: t.total + x.total }), { ff: 0, gv: 0, both: 0, office: 0, total: 0 });
  let gvNotInStock = 0;
  gvMap.tags.forEach((_, t) => { if (!seenTags.has(t)) gvNotInStock++; });
  return { rows, total, gv: { rows: gvMap.rows, assigned: gvMap.assigned, notAssigned: gvMap.notAssigned, outStatus: gvMap.outStatus || 0, notInStockData: gvNotInStock }, ffRows: (ffRaw || []).length, topTl: [...tl.values()].sort((a, b) => b.ff - a.ff).slice(0, 10) };
}
export const MAP_BUCKET_LABEL = { ff: 'First Forward', gv: 'GV Partner', both: 'GV + FF', office: 'Office stock', all: 'All stock', gvonly: 'GV only (not in FF stock)' };
export const GVONLY_REMARK_NONE = 'Not In FF Stock';
export const GVONLY_REMARK_UNASSIGNED = 'Not In FF Stock (GV Not Assigned)';
export const GVONLY_REMARK_OFFICE = 'In FF Office Stock (not in field)';
const rowGvUnassigned = (r) => {
  if (r[11] === 2) return true;
  if (r[11] === 1) return false;
  return !isGvAssigned({ agentId: r[5], agentName: r[4], status: '' }, null);
};
const isHeaderBarcode = (v) => /^(BARCODE|SERIAL[_ ]?NUMBER|SERIAL|SNO)$/i.test(str(v));
/** GV Tag Assignment ke sabhi in-stock tags (Assigned + Not Assigned dono, issued/out chhod kar)
 *  jinka Barcode FF StockDataa ke Barcode column me bilkul nahi hai. Index par memoized. */
export function gvOnlyList(index) {
  if (!index || !index.gv) return [];
  if (index._gvOnly && index._gvOnlyAt === index.at) return index._gvOnly;
  const ffAnyBc = new Set((index.ff && index.ff.extraBarcodes) || []);
  for (const r of (index.ff && index.ff.raw) || []) {
    const b = normBarcode(r[1]);
    if (b) ffAnyBc.add(b);
  }
  const out = [], seen = new Set(), remarks = new Map();
  const scan = (list) => {
    for (const r of list || []) {
      if (r[11] === 0) continue;                   // issued / out-of-stock GV row → GV Partner Stock in field me nahi
      const b = normBarcode(r[1]);
      if (b && ffAnyBc.has(b)) continue;           // FF StockDataa me ye barcode maujood hai → count nahi
      const tu = str(r[0]).toUpperCase();
      const key = b ? `B:${b}` : tu ? `T:${tu}` : '';
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(r);
      remarks.set(r, rowGvUnassigned(r) ? GVONLY_REMARK_UNASSIGNED : GVONLY_REMARK_NONE);
    }
  };
  scan(index.gv.raw);
  scan(index.gv.extraInStock);
  index._gvOnly = out; index._gvOnlyAt = index.at; index._gvOnlyRemark = remarks;
  return out;
}
export function gvOnlyRemark(index, r) {
  if (index && (!index._gvOnly || index._gvOnlyAt !== index.at)) gvOnlyList(index);
  return (index && index._gvOnlyRemark && index._gvOnlyRemark.get(r)) || (rowGvUnassigned(r) ? GVONLY_REMARK_UNASSIGNED : GVONLY_REMARK_NONE);
}
export function gvOnlySummary(index) {
  const list = gvOnlyList(index);
  const by = new Map();
  let assigned = 0, unassigned = 0;
  for (const r of list) {
    const cls = r[2] || 'NA';
    by.set(cls, (by.get(cls) || 0) + 1);
    if (rowGvUnassigned(r)) unassigned++; else assigned++;
  }
  const rows = [...by].map(([cls, n]) => ({ cls, n, type: TAG_TYPE_LABEL[cls] || '' })).sort((a, b) => (CLS_ORDER.indexOf(a.cls) + 1 || 99) - (CLS_ORDER.indexOf(b.cls) + 1 || 99));
  const total = list.length;
  return { total, rows, notIn: total, assigned, unassigned, office: 0 };
}
/** Tag-level rows ek bucket (ff|gv|both|office|all|gvonly) + optional class ke liye. */
export function mapRows(index, { bucket = 'all', cls = '', q = '' } = {}) {
  const out = [];
  if (!index) return out;
  const want = str(cls) ? normCls(cls) : '';
  const needle = str(q).toLowerCase();
  if (bucket === 'gvonly') {
    for (const r of gvOnlyList(index)) {
      if (want && r[2] !== want) continue;
      const unassigned = rowGvUnassigned(r);
      const gvAg = str(r[4]) || (unassigned ? 'Not Assigned' : '');
      const gvAgId = unassigned && /^(not[\s_-]*assigned|unassigned)$/i.test(str(r[5])) ? '' : str(r[5]);
      const row = { tagId: str(r[0]), barcode: str(r[1]), cls: r[2], type: TAG_TYPE_LABEL[r[2]] || '', bucket: MAP_BUCKET_LABEL.gvonly, ffAgent: '', ffAgentId: '', ffTl: '', gvAgent: gvAg, gvAgentId: gvAgId, gvTl: str(r[6]), age: r[7] === null || r[7] === undefined ? '' : r[7], remark: gvOnlyRemark(index, r) };
      if (needle && !Object.values(row).some((v) => String(v).toLowerCase().includes(needle))) continue;
      out.push(row);
    }
    return out;
  }
  if (!index.ff || !index.mapGv) return out;
  for (const r of index.ff.raw || []) {
    if (want && r[2] !== want) continue;
    const m = mapBucketOf(r, index.mapGv, index.mapOpts);
    if (bucket !== 'all' && m.bucket !== bucket) continue;
    const g = m.gvInfo || ['', '', ''];
    const row = { tagId: str(r[0]), barcode: str(r[1]), cls: r[2], type: TAG_TYPE_LABEL[r[2]] || '', bucket: MAP_BUCKET_LABEL[m.bucket], ffAgent: str(r[4]), ffAgentId: str(r[5]), ffTl: str(r[6]), gvAgent: g[0], gvAgentId: g[1], gvTl: g[2], age: r[7] === null || r[7] === undefined ? '' : r[7] };
    if (needle && !Object.values(row).some((v) => String(v).toLowerCase().includes(needle))) continue;
    out.push(row);
  }
  return out;
}
export function createStockAgeBuilder({ todayDay, masterId = '5845036', parkedTl = 'ApnaPayment Pvt. Ltd.', gvOutWords = null } = {}) {
  const outWords = Array.isArray(gvOutWords) ? gvOutWords.map((w) => str(w).toUpperCase()).filter(Boolean) : null;
  const today = Number.isFinite(todayDay) ? todayDay : Math.floor(Date.now() / DAY_MS);
  const ageOf = (day) => (day ? Math.max(0, Math.round(today - day)) : null);
  const masterDigits = digits(masterId), parkedTlNorm = normName(parkedTl);
  // Agent / TL / class naam hazaaron rows me repeat hote hain — ek hi string copy share karo (raw list halki rehti hai).
  const pool = new Map();
  const same = (s) => {
    if (!s || s.length > 48) return s;
    const hit = pool.get(s);
    if (hit !== undefined) return hit;
    pool.set(s, s);
    return s;
  };
  // field = agents ke paas (asli field stock) · parked = master (5845036) / "ApnaPayment Pvt. Ltd." / bina agent (BC + GV ka stock)
  const ff = { all: newNode('First Forward · poora StockDataa'), field: newNode('First Forward · field (agents ke paas)'), parked: newNode('🏬 Master / GV parked (ApnaPayment)'), agents: new Map(), tls: new Map(), raw: [], extraBarcodes: new Set(), total: 0, unknown: 0, rows: 0 };
  const byTag = new Map(), byBarcode = new Map();
  const gvMap = { tags: new Map(), bcs: new Map(), assigned: 0, notAssigned: 0, outStatus: 0, rows: 0 };   // 🗺️ mapping summary ke liye (finish par saaf)
  const gv = { all: newNode('GV Partner · poora network'), agents: new Map(), tls: new Map(), raw: [], extraInStock: [], total: 0, unknown: 0, matched: 0, own: 0, rows: 0 };
  /** FF (StockDataa) rows ka ek page / chunk. */
  function addFf(rows) {
    for (const r of rows || []) {
      if (!r) continue;
      const tagId = str(r.tagId);
      if (isHeaderTag(tagId, r.cls) || isHeaderBarcode(r.barcode)) continue;
      const bc = normBarcode(r.barcode);
      if (!tagId) { if (bc) ff.extraBarcodes.add(bc); continue; }
      ff.rows++;
      const aDay = parseStockDay(r.agentDate);
      const day = aDay || parseStockDay(r.bcDate);
      const src = aDay ? 'agent' : day ? 'bc' : '';
      if (day) byTag.set(tagId.toUpperCase(), day);
      if (bc && day) byBarcode.set(bc, day);
      const age = ageOf(day);
      if (age === null) ff.unknown++;
      const g = groupOf(r.cls);
      const agentName = same(str(r.agentName)), agentDigits = same(digits(r.agentId));
      const aKey = agentDigits ? agentDigits : agentName ? same(`n:${normName(agentName)}`) : '__none__';
      let an = ff.agents.get(aKey);
      if (!an) { an = newNode(agentName || (aKey === '__none__' ? 'Bina agent (BC / master stock)' : str(r.agentId)), agentDigits, str(r.tl)); ff.agents.set(aKey, an); }
      if (!an.tl && r.tl) an.tl = str(r.tl);
      if (!an.n && agentName) an.n = agentName;
      addAge(an, g, age);
      const tKey = same(normName(r.tl)) || '__none__';
      let tn = ff.tls.get(tKey);
      if (!tn) { tn = newNode(str(r.tl) || '— (TL blank)'); ff.tls.set(tKey, tn); }
      addAge(tn, g, age);
      addAge(ff.all, g, age);
      const parked = (masterDigits && agentDigits === masterDigits) || (parkedTlNorm && normName(r.tl) === parkedTlNorm) || (!agentDigits && !agentName);
      addAge(parked ? ff.parked : ff.field, g, age);
      ff.total++;
      ff.raw.push([tagId, str(r.barcode), same(normCls(r.cls)), day, agentName, same(str(r.agentId)), same(str(r.tl)), age, aKey, tKey, src]);
    }
  }
  /** GV (Tag Assignment) rows — saare FF rows add hone ke BAAD (umr StockDataa match se aati hai). */
  function addGv(rows) {
    for (const r of rows || []) {
      if (!r) continue;
      const tagId = str(r.tagId);
      if (isHeaderTag(tagId, r.cls) || isHeaderBarcode(r.serial)) continue;
      const outSt = isGvOutStatus(r.status, outWords);
      const assigned = !outSt && isGvAssigned(r, outWords);
      const inStockFlag = outSt ? 0 : (assigned ? 1 : 2);
      if (!tagId) {
        const sb = normBarcode(r.serial);
        if (sb && inStockFlag > 0) {
          const day = parseStockDay(r.date) || byBarcode.get(sb) || 0;
          gv.extraInStock.push(['', str(r.serial), same(normCls(r.cls)), day, same(str(r.agentName)), same(str(r.agentId)), same(str(r.tlName)), ageOf(day), '', '', '', inStockFlag]);
        }
        continue;
      }
      gv.rows++;
      gvMap.rows++;
      if (assigned) {
        gvMap.assigned++;
        const tu = tagId.toUpperCase();
        gvMap.tags.set(tu, [same(str(r.agentName)), same(str(r.agentId)), same(str(r.tlName))]);
        const sb = normBarcode(r.serial); if (sb) gvMap.bcs.set(sb, tu);
      } else if (outSt) gvMap.outStatus++;
      else gvMap.notAssigned++;
      let day = parseStockDay(r.date), src = day ? 'sheet' : '';
      if (day) gv.own++;
      if (!day) { day = byTag.get(tagId.toUpperCase()) || byBarcode.get(normBarcode(r.serial)) || 0; if (day) { src = 'stockdataa'; gv.matched++; } }
      const age = ageOf(day);
      if (age === null) gv.unknown++;
      const g = groupOf(r.cls);
      const agentName = same(str(r.agentName)), agentId = same(str(r.agentId).toUpperCase());
      const aKey = agentId || (agentName ? same(`n:${normName(agentName)}`) : '__none__');
      let an = gv.agents.get(aKey);
      if (!an) { an = newNode(agentName || agentId || 'Bina agent', agentId, str(r.tlName)); gv.agents.set(aKey, an); }
      if (!an.tl && r.tlName) an.tl = str(r.tlName);
      addAge(an, g, age);
      const tlName = same(str(r.tlName)), tlId = str(r.tlId);
      const tKey = tlName ? same(normName(tlName)) : tlId ? `ID:${tlId.toUpperCase()}` : '__direct__';
      let tn = gv.tls.get(tKey);
      if (!tn) { tn = newNode(tlName || (tlId ? `TL ${tlId}` : 'Direct agents (no TL)')); gv.tls.set(tKey, tn); }
      addAge(tn, g, age);
      addAge(gv.all, g, age);
      gv.total++;
      gv.raw.push([tagId, str(r.serial), same(normCls(r.cls)), day, agentName, same(str(r.agentId)), tlName, age, aKey, tKey, src, inStockFlag]);
    }
  }
  function finish() {
    byTag.clear(); byBarcode.clear(); pool.clear();
    const mapOpts = { masterDigits, parkedTlNorm };
    const map = buildMapSummary(ff.raw, gvMap, mapOpts);
    const idx = { at: Date.now(), today, masterId: str(masterId), masterDigits, parkedTlNorm, ff, gv, map, mapGv: gvMap, mapOpts };
    map.gv.notInStockData = gvOnlySummary(idx).total;
    return idx;
  }
  return { addFf, addGv, finish, get today() { return today; } };
}

/** Purana one-shot API (tests / chhote data) — builder ke upar hi bana hai. */
export function buildStockAgeIndex({ ffRows = [], gvRows = [], todayDay, masterId = '5845036', parkedTl = 'ApnaPayment Pvt. Ltd.', gvOutWords = null } = {}) {
  const builder = createStockAgeBuilder({ todayDay, masterId, parkedTl, gvOutWords });
  builder.addFf(ffRows);
  builder.addGv(gvRows);
  return builder.finish();
}

/** Ageing for follow-up: GV excludes issued / not-assigned rows; unknown dates are not treated as young. */
export function followupAgeByAgent(index, ch) {
  const src = index && index[ch];
  if (!src) return [];
  const groups = new Map();
  const rows = ch === 'gv' ? [...(src.raw || []), ...(src.extraInStock || [])] : (src.raw || []);
  for (const r of rows) {
    if (ch === 'gv' && r[11] !== 1) continue;
    if (ch === 'ff' && index.mapGv && !mapBucketOf(r, index.mapGv, index.mapOpts || {}).ffMapped) continue;
    const id = str(r[5]).toUpperCase().replace(/\.0+$/, ''), name = str(r[4]);
    const key = id ? `I:${id}` : name ? `N:${normName(name)}` : '';
    if (!key) continue;
    const group = groups.get(key) || { id, name, age90: 0, known: 0, unknown: 0 };
    const age = r[7];
    if (age === null || age === undefined || age === '' || !Number.isFinite(Number(age))) group.unknown++;
    else { group.known++; if (Number(age) >= 90) group.age90++; }
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Summary response (sab agents / TLs ke compact nodes). */
export function summaryOf(index, opts = {}) {
  const pack = (ch) => {
    const c = index[ch];
    if (!c) return null;
    const obj = (map) => { const o = {}; map.forEach((node, key) => { o[key] = packNode(node); }); return o; };
    return { total: c.total, unknown: c.unknown, rows: c.rows, matched: c.matched || 0, own: c.own || 0, all: packNode(c.all), field: c.field ? packNode(c.field) : null, parked: c.parked ? packNode(c.parked) : null, agents: obj(c.agents), tls: obj(c.tls) };
  };
  const out = { ok: true, at: new Date(index.at).toISOString(), today: new Date(index.today * DAY_MS).toISOString().slice(0, 10), thresholds: AGE_THRESH, months: AGE_MONTHS };
  if (opts.ff !== false) out.ff = pack('ff');
  if (opts.gv !== false) out.gv = pack('gv');
  if (index.errors) out.errors = index.errors;
  return out;
}

/** 🔗 Personal link: ek agent / TL ka stock (VC4+VC20 · VC5+) + ageing + class-wise stock, aur TL ke saare agents ka stock.
 *  → { t:[core,comm], c, o, agents:[packNode…], byCls:{VC4:{t,c,o}}, personId } ya null (index me nahi mila). */
export function personalStock(index, ch, kind, name) {
  const c = index && index[ch === 'gv' ? 'gv' : 'ff'];
  const names = (Array.isArray(name) ? name : [name]).filter((x) => str(x));
  if (!c || !names.length) return null;
  const isTl = kind === 'tl';
  const isGroup = kind === 'group';   // v180 — admin ke chune hue agents ka custom team
  const map = isTl ? c.tls : c.agents;
  const keys = [...resolveKeys(c, ch === 'gv' ? 'gv' : 'ff', isTl ? 'tl' : 'agent', names)];
  if (!keys.length) return null;
  const keySet = new Set(keys);
  const nodes = keys.map((k) => map.get(k)).filter(Boolean);
  const out = { t: [0, 0], c: [[0, 0, 0, 0], [0, 0, 0, 0]], o: [0, 0], agents: [], byCls: {}, personId: '' };
  nodes.forEach((n) => {
    if (!out.personId && n.id) out.personId = n.id;
    for (let g = 0; g < 2; g++) { out.t[g] += n.t[g]; out.o[g] = Math.max(out.o[g], n.o[g]); for (let i = 0; i < 4; i++) out.c[g][i] += n.c[g][i]; }
  });
  for (const r of c.raw || []) {
    const matchKey = isTl ? r[9] : r[8];
    if (!keySet.has(matchKey)) continue;
    const cls = r[2] || 'VC4';
    const age = r[7];
    if (!out.personId && !isTl && r[5]) out.personId = String(r[5]).trim();
    const ce = out.byCls[cls] || (out.byCls[cls] = { t: 0, c: [0, 0, 0, 0], o: 0 });
    ce.t++;
    if (age !== null && age !== undefined && age >= 0) {
      if (age > ce.o) ce.o = age;
      for (let i = 0; i < AGE_THRESH.length; i++) if (age >= AGE_THRESH[i]) ce.c[i]++;
    }
  }
  if (isGroup) {
    nodes.forEach((n) => out.agents.push(packNode(n)));
    out.agents.sort((a, b) => (b.t[0] + b.t[1]) - (a.t[0] + a.t[1]));
  }
  if (isTl) {
    const want = normName(name);
    c.agents.forEach((n) => { if (normName(n.tl) === want) out.agents.push(packNode(n)); });
    out.agents.sort((a, b) => (b.t[0] + b.t[1]) - (a.t[0] + a.t[1]));
  }
  return out;
}

/** Per-agent class-wise stock counts for a TL's agents or a custom group: Map(normName(agent) → { VC4, VC20, 'VC5+' }). */
export function personalClassStockByAgent(index, ch, kind, name) {
  const out = new Map();
  const c = index && index[ch === 'gv' ? 'gv' : 'ff'];
  if (!c) return out;
  const bucket = (x) => { const u = String(x || 'VC4').toUpperCase().replace(/\s+/g, ''); if (/^\d+$/.test(u)) return `VC${u}`; return /^VC\d+\+?$/.test(u) ? u : (u.slice(0, 12) || 'VC4'); };
  let keySet;
  if (kind === 'tl') {
    const want = normName(name);
    keySet = new Set();
    c.agents.forEach((n, k) => { if (normName(n.tl) === want) keySet.add(k); });
  } else {
    keySet = resolveKeys(c, ch === 'gv' ? 'gv' : 'ff', 'agent', (Array.isArray(name) ? name : [name]).filter((x) => str(x)));
  }
  if (!keySet.size) return out;
  for (const r of c.raw || []) {
    const k = r[8];
    if (!keySet.has(k)) continue;
    const node = c.agents.get(k);
    const nm = normName(node ? node.n : '');
    if (!nm) continue;
    const e = out.get(nm) || {};
    const bk = bucket(r[2]); e[bk] = (e[bk] || 0) + 1;
    out.set(nm, e);
  }
  return out;
}

/** Agent key resolution: digits / ID / naam — client jo bhi bheje. */
function resolveKeys(chIndex, ch, kind, keyList) {
  const map = kind === 'tl' ? chIndex.tls : chIndex.agents;
  const out = new Set();
  for (const raw of keyList) {
    const k = str(raw);
    if (!k) continue;
    if (map.has(k)) { out.add(k); continue; }
    if (kind === 'tl') {
      const nk = normName(k);
      if (map.has(nk)) { out.add(nk); continue; }
      continue;
    }
    const d = digits(k), up = k.toUpperCase();
    if (ch === 'ff' && d && map.has(d)) { out.add(d); continue; }
    if (ch === 'gv' && map.has(up)) { out.add(up); continue; }
    const nk = `n:${normName(k)}`;
    if (map.has(nk)) { out.add(nk); continue; }
    const want = normName(k);
    for (const [key, node] of map) if (normName(node.n) === want) { out.add(key); break; }
  }
  return out;
}

/** Tag-level list (drill / CSV). months: 0 = sab · 1/3/5/6 = utne mahine se purane · group: 'core'|'comm'|'' · unknown: true = sirf date-nahi. */
export function tagsFor(index, q = {}) {
  const ch = q.ch === 'gv' ? 'gv' : 'ff';
  const c = index[ch];
  if (!c) return { total: 0, rows: [] };
  const kind = ['agent', 'tl', 'agents', 'all', 'field', 'parked'].includes(q.kind) ? q.kind : 'all';
  const parkedOf = (r) => (index.masterDigits && digits(r[5]) === index.masterDigits) || (index.parkedTlNorm && r[9] === index.parkedTlNorm) || r[8] === '__none__';
  const keyList = [...(Array.isArray(q.keys) ? q.keys : []), ...(q.key ? [q.key] : [])].slice(0, 400);
  const tlList = (Array.isArray(q.tls) ? q.tls : []).slice(0, 100);
  const agentKeys = kind === 'agent' || kind === 'agents' ? resolveKeys(c, ch, 'agent', keyList) : null;
  const tlKeys = kind === 'tl' ? resolveKeys(c, ch, 'tl', keyList) : (tlList.length ? resolveKeys(c, ch, 'tl', tlList) : null);
  const mi = AGE_MONTHS.indexOf(Number(q.months));
  const minAge = mi >= 0 ? AGE_THRESH[mi] : 0;
  const g = q.group === 'core' ? 0 : q.group === 'comm' ? 1 : -1;
  const onlyUnknown = q.unknown === true || q.unknown === '1';
  const rows = [];
  for (const r of c.raw) {
    if (kind === 'agent' && !agentKeys.has(r[8])) continue;
    if (kind === 'agents' && !(agentKeys.has(r[8]) || (tlKeys && tlKeys.has(r[9])))) continue;
    if (kind === 'tl' && !tlKeys.has(r[9])) continue;
    if (kind === 'field' && (ch !== 'ff' || parkedOf(r))) continue;
    if (kind === 'parked' && (ch !== 'ff' || !parkedOf(r))) continue;
    if (g >= 0 && groupOf(r[2]) !== g) continue;
    if (onlyUnknown) { if (r[7] !== null) continue; }
    else if (minAge && (r[7] === null || r[7] < minAge)) continue;
    rows.push(r);
  }
  rows.sort((a, b) => (b[7] ?? -1) - (a[7] ?? -1));
  const limit = Math.max(1, Math.min(150000, Number(q.limit) || 2000));
  const iso = (day) => (day ? new Date(day * DAY_MS).toISOString().slice(0, 10) : '');
  return {
    ch, total: rows.length,
    rows: rows.slice(0, limit).map((r) => ({ tagId: r[0], barcode: r[1], cls: r[2], date: iso(r[3]), agent: r[4], agentId: r[5], tl: r[6], age: r[7], source: r[10] || '' }))
  };
}
