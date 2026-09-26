#!/usr/bin/env node
/* Local stand-in for Google's gviz endpoint so the dashboard can be run/tested without internet.
   Serves synthetic EIR / StockDataa / REPORT tabs and understands the subset of the gviz query
   language the app uses (select cols / count / year / month, where, group by, order by, limit).

   Usage:  node dev/mock-gviz.js            (port 9099)
           GVIZ_BASE=http://localhost:9099 DATA_DIR=/tmp/ffdata node server.js
*/
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 9099);
const rnd = (() => { let s = 42; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; })();
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const L = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

// ---- synthetic people ------------------------------------------------------------------------
const TLS = [
  { id: 'APN2354', name: 'AJAY SINGH M', mobile: '9696497390' }, { id: 'APN2405', name: 'SUNIL MATALE', mobile: '9822011122' },
  { id: 'APN2401', name: 'TO2 Corporation', mobile: '9811122233' }, { id: 'APN2410', name: 'ASHOK SEN', mobile: '9898989898' },
  { id: 'APN2420', name: 'KOMAL SINGH', mobile: '9797979797' }
];
const FIRST = ['RAHUL', 'AMIT', 'PRIYA', 'SUNITA', 'VIKAS', 'NEHA', 'RAJESH', 'POOJA', 'MANOJ', 'KIRAN', 'DEEPAK', 'ANITA', 'SANJAY', 'MEENA', 'ARUN', 'SEEMA'];
const LAST = ['SHARMA', 'VERMA', 'GUPTA', 'SINGH', 'YADAV', 'PATEL', 'JAIN', 'KUMAR', 'MISHRA', 'CHOUDHARY'];
const AGENTS = [];
for (let i = 0; i < 60; i++) {
  const direct = i % 4 === 0; // every 4th agent is independent → TL Name "APS"
  const tl = direct ? null : TLS[i % TLS.length];
  const id = String(5846000 + i);
  AGENTS.push({ id, name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}${i >= 32 ? ' ' + (i - 31) : ''}`, tlId: direct ? id : tl.id, tlName: direct ? 'APS' : tl.name, tlMobile: direct ? '' : tl.mobile, gv: i % 9 === 0, rate: 0.3 + rnd() * 2.5 });
}
const CLASSES = ['4', '4', '4', '4', '4', '4', '20', '5', '6', '7', '12', '16'];
const TYPES = { '4': 'CAR/JEEP/VAN', '20': 'LCV', '5': 'BUS 2 AXLE', '6': 'TRUCK 3 AXLE', '7': 'TRUCK 4-6 AXLE', '12': 'TRUCK 7+ AXLE', '16': 'HCM/EME' };
const today = new Date(); today.setHours(0, 0, 0, 0);
const dstr = (d) => `Date(${d.getFullYear()},${d.getMonth()},${d.getDate()})`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---- EIR: TAG_ID A, VRN B, CLASS C, TYPE D, STATUS E, DATE F, AGENT_ID G, AGENT_NAME H, MASTER_ID I, TL_ID J, GV_ID K, GV_NAME L, GV_TL M, TL_NAME N, VRN_TYPE O, MONTH P, REG_NO Q
const EIR = { cols: ['TAG_ID', 'VRN', 'TAG_CLASS', 'TAG_TYPE', 'STATUS', 'ISSUE_DATE', 'AGENT_ID', 'AGENT_NAME', 'MASTER_ID', 'TL_ID', 'GV_ID', 'GV_NAME', 'GV_TL', 'TL_NAME', 'VRN_TYPE', 'MONTH', 'REG_NUMBER'].map((l, i) => ({ id: L(i), label: l, type: i === 5 ? 'date' : 'string' })), rows: [] };
let tagSeq = 100000;
for (let back = 75; back >= 0; back--) {
  const d = new Date(today); d.setDate(d.getDate() - back);
  for (const a of AGENTS) {
    const n = Math.max(0, Math.round(a.rate * (0.5 + rnd()) * (d.getDay() === 0 ? 0.4 : 1) * (back < 30 ? 1.15 : 1)));
    for (let k = 0; k < n; k++) {
      const cls = pick(CLASSES);
      EIR.rows.push([`34161FA82032${tagSeq++}`, `RJ14${Math.floor(rnd() * 9000 + 1000)}`, cls, TYPES[cls], rnd() < 0.96 ? 'ACTIVE' : 'PENDING', dstr(d), a.id, a.name, a.gv ? 'GV001' : null, a.tlId, a.gv ? 'GV001' : null, a.gv ? 'GV PARTNER LTD' : null, a.gv ? a.tlName : null, a.tlName, rnd() < 0.9 ? 'REGULAR' : 'CHASSIS', `${MONTHS[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`, `RJ14`]);
    }
  }
}
// ---- StockDataa: A ID, B Name, C TAG_ID, D BARCODE, E TAG_CLASS, F TAG_TYPE, G BC_ALLOCATED_AT, H AGENT_ID, I AGENT_NAME, J AGENT_ALLOCATED_AT, K TL Name, L ID, M Name
const STOCK = { cols: ['ID', 'Name', 'TAG_ID', 'BARCODE', 'TAG_CLASS', 'TAG_TYPE', 'BC_ALLOCATED_AT', 'AGENT_ID', 'AGENT_NAME', 'AGENT_ALLOCATED_AT', 'TL Name', 'ID', 'Name'].map((l, i) => ({ id: L(i), label: l, type: 'string' })), rows: [] };
for (const a of AGENTS) {
  const n = 20 + Math.floor(rnd() * 120);
  for (let k = 0; k < n; k++) {
    const cls = pick(CLASSES);
    STOCK.rows.push(['5845036', 'APNA PAYEMENT', `34161FA82032${tagSeq++}`, `BC${tagSeq}`, cls, TYPES[cls], '11-07-2025 18:38:03 IST', a.id, a.name, '12-07-2025 10:00:00 IST', a.tlName, a.tlId, a.tlName]);
  }
}
// ---- REPORT (gid 242489821): 2 header rows + data ---------------------------------------------
const curM = MONTHS[today.getMonth()], lastM = MONTHS[(today.getMonth() + 11) % 12];
const R1 = new Array(78).fill(''); const R2 = new Array(78).fill('');
const sec = (i, title, labels) => { R1[i] = title; labels.forEach((l, k) => { R2[i + k] = l; }); };
sec(0, 'Agent Profile Details', ['Agent ID', 'ID', 'Name']);
sec(3, "TL's Master Data", ['GV ID Found', 'TL ID', 'Mo. Number', 'TL Name']);
sec(7, 'Agent Inventory Summary', ['VC4', 'VC5', 'VC6', 'VC7', 'VC12', 'VC16', 'Total', 'NVC4']);
sec(15, 'Fastag Dispatch Details (VC4)', ['Stock Days', 'Projected', 'Priority Level', 'Stock Alert']);
sec(19, "TL's Stock Details", ['VC4', 'NVC4', 'Total']);
sec(22, `Performance In - ${lastM}`, ['Active Days', 'VC4', 'NVC4', 'Total']);
sec(26, `Performance In - ${curM}`, ['Wrong VRN', 'X', 'VC4', 'VC5', 'VC6', 'VC7', 'VC12', 'VC16', 'NVC4', 'Total', 'Projected', 'Avg VC4', 'Avg NVC4', 'Avg Total']);
sec(40, 'Agents Performance Status', ['Last vs Current', 'Last Active', 'Agent Status']);
const dayLabels = []; for (let i = 6; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); dayLabels.push(`${d.getDate()}/${MONTHS[d.getMonth()]}`); }
sec(43, 'Performance In 7 Days', ['Active Days', ...dayLabels]);
sec(51, "TL's Last Month Issued", ['VC4', 'NVC4', 'Total', 'Daily Avg']);
sec(55, "TL's Current Month Issuance", ['VC4', 'NVC4', 'Total', 'Avg VC4', 'Avg NVC4', 'Avg Total']);
sec(61, "TL's Performance Status", ['Percent', 'TL Last Active', 'TL Status', 'Projected']);
sec(65, 'Agent Wise', ['Daily Avg', 'Stock Days', 'Priority Level']);
sec(68, 'Fastag Dispatch Details (Commercial)', ['Stock Days', 'Projected', 'Priority Level', 'Stock Alert']);
sec(72, 'Device', ['Biomatric Device']);
sec(73, 'GV STOCK', ['VC4', 'NVC4']);
sec(75, 'GV Issuance Last Month', ['Total']);
sec(76, 'GV Issuance Current Month', ['Total']);
const PRIO = ['🔴 High', '🟡 Medium', '🟢 Low'];
const STATUS = ['🚀 High Growth', '🟢 Growth', '🟡 Slight Low', '🔻 High De-Growth', '🔴 Inactive In Current Month'];
const REPORT = { cols: new Array(78).fill(0).map((_, i) => ({ id: L(i), label: '', type: 'string' })), rows: [R1, R2] };
const monthKey = (d) => `${d.getFullYear()}-${d.getMonth()}`;
const curKey = monthKey(today), lastKey = monthKey(new Date(today.getFullYear(), today.getMonth() - 1, 1));
const tlAgg = new Map();
const agentRows = AGENTS.map((a) => {
  const mine = EIR.rows.filter((r) => r[6] === a.id);
  const dt = (r) => { const m = r[5].match(/\d+/g); return new Date(+m[0], +m[1], +m[2]); };
  const cur = mine.filter((r) => monthKey(dt(r)) === curKey), last = mine.filter((r) => monthKey(dt(r)) === lastKey);
  const vc4 = (rows) => rows.filter((r) => r[2] === '4').length;
  const st = STOCK.rows.filter((r) => r[7] === a.id);
  const sc = (c) => st.filter((r) => r[4] === c).length;
  const week = dayLabels.map((lab, i) => { const d = new Date(today); d.setDate(d.getDate() - (6 - i)); return mine.filter((r) => dt(r).getTime() === d.getTime()).length; });
  const g = last.length ? Math.round(((cur.length - last.length) / last.length) * 100) : 0;
  const row = new Array(78).fill('');
  row[0] = a.id; row[1] = a.id; row[2] = a.name; row[3] = a.gv ? 'APS09129' : 'NOT FOUND'; row[4] = a.tlId; row[5] = a.tlMobile; row[6] = a.tlName;
  row[7] = sc('4'); row[8] = sc('5'); row[9] = sc('6'); row[10] = sc('7'); row[11] = sc('12'); row[12] = sc('16'); row[13] = st.length; row[14] = st.length - sc('4');
  row[22] = new Set(last.map((r) => r[5])).size; row[23] = vc4(last); row[24] = last.length - vc4(last); row[25] = last.length;
  row[26] = Math.floor(rnd() * 3); row[27] = ''; row[28] = vc4(cur); row[29] = cur.filter((r) => r[2] === '5').length; row[30] = cur.filter((r) => r[2] === '6').length; row[31] = cur.filter((r) => r[2] === '7').length; row[32] = cur.filter((r) => r[2] === '12').length; row[33] = cur.filter((r) => r[2] === '16').length; row[34] = cur.length - vc4(cur); row[35] = cur.length; row[36] = Math.round(cur.length * 30 / Math.max(1, today.getDate())); row[37] = (vc4(cur) / Math.max(1, today.getDate())).toFixed(1); row[38] = ((cur.length - vc4(cur)) / Math.max(1, today.getDate())).toFixed(1); row[39] = (cur.length / Math.max(1, today.getDate())).toFixed(1);
  row[40] = `${g >= 0 ? '▲ +' : '▼ '}${g}%`; row[41] = week[6] ? '🟢 Active' : `🔴 ${1 + Math.floor(rnd() * 6)} days inactive`; row[42] = cur.length === 0 ? STATUS[4] : g > 20 ? STATUS[0] : g >= 0 ? STATUS[1] : g > -20 ? STATUS[2] : STATUS[3];
  row[43] = new Set(cur.map((r) => r[5])).size; week.forEach((v, i) => { row[44 + i] = v; });
  row[65] = row[39]; row[66] = Math.round(sc('4') / Math.max(0.1, Number(row[37]))); row[67] = row[66] < 10 ? PRIO[0] : row[66] < 25 ? PRIO[1] : PRIO[2];
  row[72] = rnd() < 0.6 ? 'YES' : 'NO'; row[73] = a.gv ? 120 : ''; row[74] = a.gv ? 30 : ''; row[75] = a.gv ? 40 : ''; row[76] = a.gv ? 55 : '';
  const t = tlAgg.get(a.tlId) || { curVc4: 0, curN: 0, lastVc4: 0, lastN: 0, sVc4: 0, sN: 0 };
  t.curVc4 += vc4(cur); t.curN += cur.length; t.lastVc4 += vc4(last); t.lastN += last.length; t.sVc4 += sc('4'); t.sN += st.length - sc('4'); tlAgg.set(a.tlId, t);
  return row;
});
for (const row of agentRows) {
  const t = tlAgg.get(row[4]); const days = Math.max(1, today.getDate());
  const vc4Days = Math.round(t.sVc4 / Math.max(0.1, t.curVc4 / days)), nDays = Math.round(t.sN / Math.max(0.1, (t.curN - t.curVc4) / days));
  row[15] = vc4Days; row[16] = Math.round(t.curVc4 * 30 / days); row[17] = vc4Days < 10 ? PRIO[0] : vc4Days < 25 ? PRIO[1] : PRIO[2]; row[18] = vc4Days > 50 ? '🔴 Over Stocked (>50 days)' : vc4Days < 10 ? '🔴 Risk' : '🟢 Stock OK';
  row[19] = t.sVc4; row[20] = t.sN; row[21] = t.sVc4 + t.sN;
  row[51] = t.lastVc4; row[52] = t.lastN - t.lastVc4; row[53] = t.lastN; row[54] = (t.lastN / 30).toFixed(1);
  row[55] = t.curVc4; row[56] = t.curN - t.curVc4; row[57] = t.curN; row[58] = (t.curVc4 / days).toFixed(1); row[59] = ((t.curN - t.curVc4) / days).toFixed(1); row[60] = (t.curN / days).toFixed(1);
  const g = t.lastN ? Math.round(((t.curN - t.lastN) / t.lastN) * 100) : 0;
  row[61] = `${g >= 0 ? '▲ +' : '▼ '}${g}%`; row[62] = '🟢 Active'; row[63] = g > 10 ? '🚀 High Growth' : g >= 0 ? '🟢 Growth' : '🔻 De-Growth'; row[64] = Math.round(t.curN * 30 / days);
  row[68] = nDays; row[69] = Math.round((t.curN - t.curVc4) * 30 / days); row[70] = nDays < 10 ? PRIO[0] : nDays < 25 ? PRIO[1] : PRIO[2]; row[71] = nDays > 50 ? '🔴 Over Stocked (>50 days)' : '🟢 Stock OK';
}
const total = new Array(78).fill(''); total[0] = '5845036'; total[1] = '5845036'; total[2] = 'APNA PAYEMENT'; total[4] = '5845036'; total[6] = 'ApnaPayment Pvt. Ltd.';
REPORT.rows.push(total, ...agentRows);

const SHEETS = { EIR, StockDataa: STOCK, REPORT };
const GIDS = { '242489821': 'REPORT', '0': 'EIR' };

// ---- tiny gviz query engine ---------------------------------------------------------------------
function colIdx(ref) { let n = 0; for (const ch of ref.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
function toDate(v) { const m = typeof v === 'string' && v.match(/^Date\((\d+),(\d+),(\d+)/); return m ? new Date(+m[1], +m[2], +m[3]) : null; }
function tokenize(s) { return s.match(/\(|\)|'[^']*'|"[^"]*"|[^\s()]+/g) || []; }
function parseWhere(tokens) {
  let i = 0;
  const peek = () => (tokens[i] || '').toLowerCase();
  function primary() {
    if (peek() === '(') { i++; const e = orExpr(); i++; return e; }
    let fn = null, col = tokens[i++];
    if (/^(lower|upper)$/i.test(col)) { fn = col.toLowerCase(); i++; col = tokens[i++]; i++; }
    const ci = colIdx(col);
    const op = peek();
    if (op === 'is') { i++; if (peek() === 'not') { i += 2; return (r) => r[ci] !== null && r[ci] !== undefined && r[ci] !== ''; } i++; return (r) => r[ci] === null || r[ci] === undefined || r[ci] === ''; }
    i++;
    let lit = tokens[i++]; lit = lit.replace(/^['"]|['"]$/g, '');
    const val = (r) => { let v = r[ci]; v = v === null || v === undefined ? '' : String(v); if (fn === 'lower') v = v.toLowerCase(); if (fn === 'upper') v = v.toUpperCase(); return v; };
    if (op === '=') return (r) => val(r) === lit;
    if (op === '!=' || op === '<>') return (r) => val(r) !== lit;
    if (op === 'contains') return (r) => val(r).includes(lit);
    if (op === 'starts') { i++; return (r) => val(r).startsWith(lit); }
    if (op === 'matches') { const re = new RegExp(`^${lit}$`, 'i'); return (r) => re.test(val(r)); }
    throw new Error(`Unsupported operator ${op}`);
  }
  function andExpr() { let l = primary(); while (peek() === 'and') { i++; const r = primary(); const ll = l; l = (row) => ll(row) && r(row); } return l; }
  function orExpr() { let l = andExpr(); while (peek() === 'or') { i++; const r = andExpr(); const ll = l; l = (row) => ll(row) || r(row); } return l; }
  return orExpr();
}
function runQuery(sheet, tq) {
  const q = (tq || '').trim();
  const kw = /\b(select|where|group by|order by|limit|offset|label|format)\b/gi;
  const parts = {}; let m, lastKw = null, lastEnd = 0;
  while ((m = kw.exec(q))) { if (lastKw) parts[lastKw] = q.slice(lastEnd, m.index).trim(); lastKw = m[1].toLowerCase(); lastEnd = m.index + m[0].length; }
  if (lastKw) parts[lastKw] = q.slice(lastEnd).trim();
  let rows = sheet.rows;
  if (parts.where) { const pred = parseWhere(tokenize(parts.where)); rows = rows.filter(pred); }
  const select = (parts.select || '*').trim();
  let cols, outRows;
  if (select === '*') { cols = sheet.cols; outRows = rows; }
  else {
    const items = select.split(',').map((s) => s.trim()).map((s) => {
      let mm;
      if ((mm = s.match(/^count\((\w+)\)$/i))) return { kind: 'count', ci: colIdx(mm[1]), label: `count ${mm[1]}`, type: 'number' };
      if ((mm = s.match(/^year\((\w+)\)$/i))) return { kind: 'year', ci: colIdx(mm[1]), label: `year(${mm[1]})`, type: 'number' };
      if ((mm = s.match(/^month\((\w+)\)$/i))) return { kind: 'month', ci: colIdx(mm[1]), label: `month(${mm[1]})`, type: 'number' };
      if ((mm = s.match(/^sum\((\w+)\)$/i))) return { kind: 'sum', ci: colIdx(mm[1]), label: `sum ${mm[1]}`, type: 'number' };
      return { kind: 'col', ci: colIdx(s), label: sheet.cols[colIdx(s)].label, type: sheet.cols[colIdx(s)].type };
    });
    const keyOf = (it, r) => { const v = r[it.ci]; if (it.kind === 'col') return v; const d = toDate(v); if (it.kind === 'year') return d ? d.getFullYear() : null; if (it.kind === 'month') return d ? d.getMonth() : null; return null; };
    const aggs = items.filter((it) => it.kind === 'count' || it.kind === 'sum');
    if (aggs.length) {
      const groups = new Map();
      for (const r of rows) {
        const key = items.filter((it) => it.kind !== 'count' && it.kind !== 'sum').map((it) => String(keyOf(it, r))).join('\u0001');
        let g = groups.get(key); if (!g) { g = { r, vals: items.map(() => 0) }; groups.set(key, g); }
        items.forEach((it, k) => { if (it.kind === 'count') { if (r[it.ci] !== null && r[it.ci] !== '' && r[it.ci] !== undefined) g.vals[k] += 1; } else if (it.kind === 'sum') g.vals[k] += Number(r[it.ci]) || 0; });
      }
      outRows = [...groups.values()].map((g) => items.map((it, k) => (it.kind === 'count' || it.kind === 'sum' ? g.vals[k] : keyOf(it, g.r))));
    } else outRows = rows.map((r) => items.map((it) => keyOf(it, r)));
    cols = items.map((it, k) => ({ id: it.kind === 'col' ? sheet.cols[it.ci].id : `${it.kind}-${L(it.ci)}`, label: it.label, type: it.type }));
    if (parts['order by']) {
      const [ref, dir] = parts['order by'].split(/\s+/);
      const k = items.findIndex((it) => (it.kind === 'col' ? L(it.ci) === ref.toUpperCase() : `${it.kind}(${L(it.ci)})`.toLowerCase() === ref.toLowerCase()));
      if (k >= 0) outRows.sort((a, b) => { const x = a[k], y = b[k]; const dx = toDate(x), dy = toDate(y); const cmp = dx && dy ? dx - dy : typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)); return (dir || '').toLowerCase() === 'desc' ? -cmp : cmp; });
    }
  }
  if (parts.offset) outRows = outRows.slice(Number(parts.offset));
  if (parts.limit) outRows = outRows.slice(0, Number(parts.limit));
  const table = { cols, rows: outRows.map((r) => ({ c: r.map((v, k) => (v === null || v === undefined || v === '' ? null : cols[k].type === 'date' ? { v, f: v } : cols[k].type === 'number' ? { v: Number(v) } : { v: String(v) })) })) };
  return table;
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.includes('/gviz/tq')) { res.writeHead(404); return res.end('not found'); }
  const gid = url.searchParams.get('gid'), name = url.searchParams.get('sheet');
  const sheetName = gid ? GIDS[gid] || 'EIR' : SHEETS[name] ? name : 'EIR'; // Google falls back to the first tab on unknown names
  const sheet = SHEETS[sheetName];
  let body;
  try {
    const table = runQuery(sheet, url.searchParams.get('tq') || '');
    body = `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify({ version: '0.6', reqId: '0', status: 'ok', sig: '1', table })});`;
  } catch (err) {
    body = `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify({ version: '0.6', status: 'error', errors: [{ reason: 'invalid_query', message: 'INVALID_QUERY', detailed_message: err.message }] })});`;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}).listen(PORT, () => console.log(`mock gviz on :${PORT} · EIR ${EIR.rows.length} rows · StockDataa ${STOCK.rows.length} · REPORT ${REPORT.rows.length}`));
