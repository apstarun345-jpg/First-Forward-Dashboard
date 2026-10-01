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
 * Groups: 0 = 🚗 VC4 + VC20 (car) · 1 = 🚚 VC5+ (commercial).
 * Pure functions — dev/stock-age.test.js inhe seedha test karta hai. */

export const AGE_THRESH = [30, 90, 150, 180];
export const AGE_MONTHS = [1, 3, 5, 6];
const DAY_MS = 86400e3;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const str = (v) => (v === null || v === undefined ? '' : String(v)).trim();
export const digits = (v) => str(v).replace(/\D/g, '');
export const normName = (v) => str(v).toUpperCase().replace(/\s+/g, ' ');
export const normBarcode = (v) => digits(v);

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
/** VC4 / VC20 → 0 (🚗 core) · baaki sab → 1 (🚚 VC5+). */
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
 * Index banao.
 *  ffRows: [{ id, tagId, barcode, cls, bcDate, agentId, agentName, agentDate, tl }]
 *  gvRows: [{ cls, tagId, serial, status, agentId, agentName, tlId, tlName, date }]
 *  todayDay: aaj ka UTC day number (IST date) · masterId: GV master ID (5845036) — sirf label ke liye.
 */
export function buildStockAgeIndex({ ffRows = [], gvRows = [], todayDay, masterId = '5845036', parkedTl = 'ApnaPayment Pvt. Ltd.' } = {}) {
  const today = Number.isFinite(todayDay) ? todayDay : Math.floor(Date.now() / DAY_MS);
  const ageOf = (day) => (day ? Math.max(0, Math.round(today - day)) : null);
  const masterDigits = digits(masterId), parkedTlNorm = normName(parkedTl);
  // field = agents ke paas (asli field stock) · parked = master (5845036) / "ApnaPayment Pvt. Ltd." / bina agent (BC + GV ka stock)
  const ff = { all: newNode('First Forward · poora StockDataa'), field: newNode('First Forward · field (agents ke paas)'), parked: newNode('🏬 Master / GV parked (ApnaPayment)'), agents: new Map(), tls: new Map(), raw: [], total: 0, unknown: 0, rows: 0 };
  const byTag = new Map(), byBarcode = new Map();
  for (const r of ffRows) {
    if (!r) continue;
    const tagId = str(r.tagId);
    if (!tagId || isHeaderTag(tagId, r.cls)) continue;
    ff.rows++;
    const aDay = parseStockDay(r.agentDate);
    const day = aDay || parseStockDay(r.bcDate);
    const src = aDay ? 'agent' : day ? 'bc' : '';
    if (day) byTag.set(tagId.toUpperCase(), day);
    const bc = normBarcode(r.barcode);
    if (bc && day) byBarcode.set(bc, day);
    const age = ageOf(day);
    if (age === null) ff.unknown++;
    const g = groupOf(r.cls);
    const agentName = str(r.agentName), agentDigits = digits(r.agentId);
    const aKey = agentDigits ? agentDigits : agentName ? `n:${normName(agentName)}` : '__none__';
    let an = ff.agents.get(aKey);
    if (!an) { an = newNode(agentName || (aKey === '__none__' ? 'Bina agent (BC / master stock)' : str(r.agentId)), agentDigits, str(r.tl)); ff.agents.set(aKey, an); }
    if (!an.tl && r.tl) an.tl = str(r.tl);
    if (!an.n && agentName) an.n = agentName;
    addAge(an, g, age);
    const tKey = normName(r.tl) || '__none__';
    let tn = ff.tls.get(tKey);
    if (!tn) { tn = newNode(str(r.tl) || '— (TL blank)'); ff.tls.set(tKey, tn); }
    addAge(tn, g, age);
    addAge(ff.all, g, age);
    const parked = (masterDigits && agentDigits === masterDigits) || (parkedTlNorm && normName(r.tl) === parkedTlNorm) || (!agentDigits && !agentName);
    addAge(parked ? ff.parked : ff.field, g, age);
    ff.total++;
    ff.raw.push([tagId, str(r.barcode), normCls(r.cls), day, agentName, str(r.agentId), str(r.tl), age, aKey, tKey, src]);
  }
  const gv = { all: newNode('GV Partner · poora network'), agents: new Map(), tls: new Map(), raw: [], total: 0, unknown: 0, matched: 0, own: 0, rows: 0 };
  for (const r of gvRows) {
    if (!r) continue;
    const tagId = str(r.tagId);
    if (!tagId || isHeaderTag(tagId, r.cls)) continue;
    gv.rows++;
    let day = parseStockDay(r.date), src = day ? 'sheet' : '';
    if (day) gv.own++;
    if (!day) { day = byTag.get(tagId.toUpperCase()) || byBarcode.get(normBarcode(r.serial)) || 0; if (day) { src = 'stockdataa'; gv.matched++; } }
    const age = ageOf(day);
    if (age === null) gv.unknown++;
    const g = groupOf(r.cls);
    const agentName = str(r.agentName), agentId = str(r.agentId).toUpperCase();
    const aKey = agentId || (agentName ? `n:${normName(agentName)}` : '__none__');
    let an = gv.agents.get(aKey);
    if (!an) { an = newNode(agentName || agentId || 'Bina agent', agentId, str(r.tlName)); gv.agents.set(aKey, an); }
    if (!an.tl && r.tlName) an.tl = str(r.tlName);
    addAge(an, g, age);
    const tlName = str(r.tlName), tlId = str(r.tlId);
    const tKey = tlName ? normName(tlName) : tlId ? `ID:${tlId.toUpperCase()}` : '__direct__';
    let tn = gv.tls.get(tKey);
    if (!tn) { tn = newNode(tlName || (tlId ? `TL ${tlId}` : 'Direct agents (no TL)')); gv.tls.set(tKey, tn); }
    addAge(tn, g, age);
    addAge(gv.all, g, age);
    gv.total++;
    gv.raw.push([tagId, str(r.serial), normCls(r.cls), day, agentName, str(r.agentId), tlName, age, aKey, tKey, src]);
  }
  return { at: Date.now(), today, masterId: str(masterId), masterDigits, parkedTlNorm, ff, gv };
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
