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

// ---- EIR (width 78, like the live tab): the app reads it by column letter (FF.config.eir) ----------
const letterIdx = (ref) => { let n = 0; for (const ch of ref.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
const EIR_AT = { tagId: 'A', vrn: 'B', cls: 'D', type: 'P', status: 'Z', date: 'AA', agentId: 'J', agentName: 'L', masterId: 'AU', tlId: 'AV', gvId: 'AW', gvName: 'AX', gvTl: 'AZ', tlName: 'BA', vrnType: 'BC', monthName: 'BD', regNumber: 'BH' };
const EIR_LABELS = { A: 'TAG_ID', B: 'VRN', D: 'TAG_CLASS', P: 'TAG_TYPE', Z: 'STATUS', AA: 'ISSUE_DATE', J: 'AGENT_ID', L: 'AGENT_NAME', AU: 'MASTER_ID', AV: 'TL_ID', AW: 'GV_ID', AX: 'GV_NAME', AZ: 'GV_TL', BA: 'TL_NAME', BC: 'VRN_TYPE', BD: 'MONTH', BH: 'REG_NUMBER' };
const EIR = { cols: new Array(78).fill(0).map((_, i) => ({ id: L(i), label: EIR_LABELS[L(i)] || '', type: L(i) === 'AA' ? 'date' : 'string' })), rows: [] };
const eirRow = (vals) => { const r = new Array(EIR.cols.length).fill(''); Object.entries(vals).forEach(([k, v]) => { if (EIR_AT[k]) r[letterIdx(EIR_AT[k])] = v; }); return r; };
let tagSeq = 100000;
for (let back = 75; back >= 0; back--) {
  const d = new Date(today); d.setDate(d.getDate() - back);
  for (const a of AGENTS) {
    const n = Math.max(0, Math.round(a.rate * (0.5 + rnd()) * (d.getDay() === 0 ? 0.4 : 1) * (back < 30 ? 1.15 : 1)));
    for (let k = 0; k < n; k++) {
      const cls = pick(CLASSES);
      EIR.rows.push(eirRow({
        tagId: `34161FA82032${tagSeq++}`, vrn: `RJ14${Math.floor(rnd() * 9000 + 1000)}`, cls, type: TYPES[cls],
        status: rnd() < 0.96 ? 'ACTIVE' : 'PENDING', date: dstr(d), agentId: a.id, agentName: a.name,
        masterId: a.gv ? '5845036' : '', tlId: a.tlId, gvId: a.gv ? 'GV001' : '', gvName: a.gv ? 'GV PARTNER LTD' : '',
        gvTl: a.gv ? 'ApnaPayment Pvt. Ltd.' : '', tlName: a.tlName,
        vrnType: rnd() < 0.9 ? 'REGULAR' : 'CHASSIS', monthName: `${MONTHS[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`, regNumber: 'RJ14'
      }));
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
// GV channel ka stock jo FF StockDataa me GV master ID 5845036 (agent) ke naam parked hai —
// Executive Cockpit ise FF field stock se exclude karta hai (GV side Tag Assignment se aati hai).
for (let k = 0; k < 500; k++) {
  const cls = pick(CLASSES);
  STOCK.rows.push(['5845036', 'APNA PAYEMENT', `34161FA82032${tagSeq++}`, `BC${tagSeq}`, cls, TYPES[cls], '11-07-2025 18:38:03 IST', '5845036', 'APNA PAYEMENT', '12-07-2025 10:00:00 IST', 'ApnaPayment Pvt. Ltd.', 'TLGV', 'ApnaPayment Pvt. Ltd.']);
}
// ---- REPORT (gid 242489821): 2 header rows + data ---------------------------------------------
const curM = MONTHS[today.getMonth()], lastM = MONTHS[(today.getMonth() + 11) % 12];
const R1 = new Array(80).fill(''); const R2 = new Array(80).fill('');
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
// 🆕 v3.7 — commission columns (heading discovery + rate × tags fallback yahin se test hote hain)
sec(78, 'Commission (FF)', ['Commission Rate', 'Earned Commission']);
const PRIO = ['🔴 High', '🟡 Medium', '🟢 Low'];
const STATUS = ['🚀 High Growth', '🟢 Growth', '🟡 Slight Low', '🔻 High De-Growth', '🔴 Inactive In Current Month'];
const REPORT = { cols: new Array(80).fill(0).map((_, i) => ({ id: L(i), label: '', type: 'string' })), rows: [R1, R2] };
const monthKey = (d) => `${d.getFullYear()}-${d.getMonth()}`;
const curKey = monthKey(today), lastKey = monthKey(new Date(today.getFullYear(), today.getMonth() - 1, 1));
const tlAgg = new Map();
const agentRows = AGENTS.map((a) => {
  // EIR me agent ID column J (index 9) aur issue date column AA (index 26) hai — isse hi REPORT ka
  // "current month" hissa banta hai (pehle galti se VRN column padha jata tha, isliye sab 0 aata tha).
  const mine = EIR.rows.filter((r) => r[9] === a.id);
  const dt = (r) => { const m = String(r[26] || '').match(/\d+/g); return m && m.length >= 3 ? new Date(+m[0], +m[1], +m[2]) : new Date(0); };
  const cur = mine.filter((r) => monthKey(dt(r)) === curKey), last = mine.filter((r) => monthKey(dt(r)) === lastKey);
  const vc4 = (rows) => rows.filter((r) => r[2] === '4').length;
  const st = STOCK.rows.filter((r) => r[7] === a.id);
  const sc = (c) => st.filter((r) => r[4] === c).length;
  const week = dayLabels.map((lab, i) => { const d = new Date(today); d.setDate(d.getDate() - (6 - i)); return mine.filter((r) => dt(r).getTime() === d.getTime()).length; });
  const g = last.length ? Math.round(((cur.length - last.length) / last.length) * 100) : 0;
  const row = new Array(80).fill('');
  row[0] = a.id; row[1] = a.id; row[2] = a.name; row[3] = a.gv ? 'APS09129' : 'NOT FOUND'; row[4] = a.tlId; row[5] = a.tlMobile; row[6] = a.tlName;
  row[7] = sc('4'); row[8] = sc('5'); row[9] = sc('6'); row[10] = sc('7'); row[11] = sc('12'); row[12] = sc('16'); row[13] = st.length; row[14] = st.length - sc('4');
  row[22] = new Set(last.map((r) => dt(r).getTime())).size; row[23] = vc4(last); row[24] = last.length - vc4(last); row[25] = last.length;
  row[26] = Math.floor(rnd() * 3); row[27] = ''; row[28] = vc4(cur); row[29] = cur.filter((r) => r[2] === '5').length; row[30] = cur.filter((r) => r[2] === '6').length; row[31] = cur.filter((r) => r[2] === '7').length; row[32] = cur.filter((r) => r[2] === '12').length; row[33] = cur.filter((r) => r[2] === '16').length; row[34] = cur.length - vc4(cur); row[35] = cur.length; row[36] = Math.round(cur.length * 30 / Math.max(1, today.getDate())); row[37] = (vc4(cur) / Math.max(1, today.getDate())).toFixed(1); row[38] = ((cur.length - vc4(cur)) / Math.max(1, today.getDate())).toFixed(1); row[39] = (cur.length / Math.max(1, today.getDate())).toFixed(1);
  row[40] = `${g >= 0 ? '▲ +' : '▼ '}${g}%`; row[41] = week[6] ? '🟢 Active' : `🔴 ${1 + Math.floor(rnd() * 6)} days inactive`; row[42] = cur.length === 0 ? STATUS[4] : g > 20 ? STATUS[0] : g >= 0 ? STATUS[1] : g > -20 ? STATUS[2] : STATUS[3];
  row[43] = new Set(cur.map((r) => dt(r).getTime())).size; week.forEach((v, i) => { row[44 + i] = v; });
  row[65] = row[39]; row[66] = Math.round(sc('4') / Math.max(0.1, Number(row[37]))); row[67] = row[66] < 10 ? PRIO[0] : row[66] < 25 ? PRIO[1] : PRIO[2];
  // Commission rate per tag + earned amount (kuch rows me earned blank rehta hai — wo case bhi cover hota hai)
  const rate = [0, 2.5, 3, 3.5, 4, 5][Math.floor(rnd() * 6)];
  row[78] = rate ? rate : '';
  row[79] = rate && rnd() > 0.25 ? Math.round(rate * cur.length * 100) / 100 : '';
  row[72] = rnd() < 0.6 ? 'YES' : 'NO'; row[73] = a.gv ? 120 : ''; row[74] = a.gv ? 30 : ''; row[75] = a.gv ? 40 : ''; row[76] = a.gv ? 55 : '';
  const t = tlAgg.get(a.tlId) || { curVc4: 0, curN: 0, lastVc4: 0, lastN: 0, sVc4: 0, sN: 0 };
  t.curVc4 += vc4(cur); t.curN += cur.length; t.lastVc4 += vc4(last); t.lastN += last.length; t.sVc4 += sc('4'); t.sN += st.length - sc('4'); tlAgg.set(a.tlId, t);
  return row;
});
// 🎯 cover-days ka realistic spread (tercile) — High/Medium/Low dispatch priority + 🎯 sug card coverage
{
  const ranked = [...agentRows].sort((x, y) => Number(x[66]) - Number(y[66]));
  const third = ranked.length / 3;
  ranked.forEach((row, i) => {
    if (i < third) { row[67] = PRIO[0]; row[66] = 3 + (i % 12); }            // 🔴 High · cover < 15 din
    else if (i < third * 2) { row[67] = PRIO[1]; row[66] = 16 + (i % 30); }   // 🟡 Medium
    else { row[67] = PRIO[2]; row[66] = 90 + i; }                             // 🟢 Low
  });
}
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
const total = new Array(80).fill(''); total[0] = '5845036'; total[1] = '5845036'; total[2] = 'APNA PAYEMENT'; total[4] = '5845036'; total[6] = 'ApnaPayment Pvt. Ltd.';
REPORT.rows.push(total, ...agentRows);

// ---- GV Partner sheet (second spreadsheet) ------------------------------------------------------
// GV Master: issuance log — A unique_id, B agent, C supervisor_id, D supervisor, E vrn, F class,
// G cch, H serial, I tag_id, J amount, K customer, L product, M commission, N status, O pay status,
// P date, Q time, R gv tl id, S master cch, T month name, U tag type, W/X gv ids, Y length
const GVM_COLS = ['unique_id', 'agent_name', 'supervisor_agent_id', 'supervisor_name', 'vno', 'vclass', 'cch', 'sno', 'tag_id_number', 'amount', 'name', 'product_id', 'commission', 'status', 'commission_status', 'Date', 'Time', 'GV TL ID', 'Master CCH', 'Month Name', 'Tag Type', 'x', 'GV Unique ID', 'GV Unique Name', 'lenth'];
const GV_MASTER = { cols: GVM_COLS.map((l, i) => ({ id: L(i), label: l, type: i === 15 ? 'date' : i === 9 || i === 12 ? 'number' : 'string' })), rows: [] };
const GV_TYPES = ['VRN', 'VRN', 'VRN', 'Chassis'];
const GV_STATUS = ['Completed', 'Completed', 'Completed', 'Replacement'];
let gvSeq = 700000;
for (let back = 60; back >= 0; back--) {
  const d = new Date(today); d.setDate(d.getDate() - back);
  for (const a of AGENTS) {
    if (rnd() > (a.gv ? 0.85 : 0.35)) continue;               // GV partner has fewer agents
    const n = Math.max(1, Math.round(a.rate * (a.gv ? 1.1 : 0.5) * (0.6 + rnd())));
    for (let k = 0; k < n; k++) {
      const cls = pick(CLASSES);
      const superA = (a.tlName && a.tlName !== 'APS') ? TLS.find((t) => t.name === a.tlName) || TLS[0] : null;
      // 🧍 GV direct-agent rule: TL ID + TL Name dono blank. Deterministic subset — preview/tests
      // isi se "Direct Agents (no TL)" wala path cover karte hain (self-supervised se pehle).
      const directGv = !!a.gv && k % 4 === 3;
      const supId = directGv ? '' : (superA ? superA.id : a.id);
      const supName = directGv ? '' : (superA ? superA.name : a.name);
      GV_MASTER.rows.push([a.id, a.name, supId, supName, `RJ14GV${gvSeq}`, cls, `VC${cls}`, `608116-0${30 + (gvSeq % 9)}-0${gvSeq % 999999}`, `34161FA82GV${gvSeq++}`, 500, `GV CUST ${k}`, '100000005715', 200, pick(GV_STATUS), 'Paid', dstr(d), '12:53:56', supId, `VC${cls}`, `${MONTHS[d.getMonth()]}${String(d.getFullYear()).slice(2)}`, pick(GV_TYPES), '', a.gv ? 'APS09129' : '', a.gv ? 'Akash Mansingh Thakur' : '', String(cls).length]);
    }
  }
}
// Tag Assignment: stock — A class, B tag id, C serial, D status, E agent id, F agent name, G tl id, H tl name, L/M gv ids
const GVA_COLS = ['VEHICLE_CLASS', 'TAG_ID', 'SERIAL_NUMBER', 'TAG_STATUS', 'AGENT_ID', 'AGENT_NAME', 'SUPERVISOR_ID', 'SUPERVISOR_NAME', 'x1', 'x2', 'x3', 'GV Unique ID', 'GV Unique Name', 'x4'];
const GV_ASSIGN = { cols: GVA_COLS.map((l, i) => ({ id: L(i), label: l, type: 'string' })), rows: [] };
for (const a of AGENTS) {
  const superA = (a.tlName && a.tlName !== 'APS') ? TLS.find((t) => t.name === a.tlName) || TLS[0] : null;
  const n = 5 + Math.floor(rnd() * 70);
  for (let k = 0; k < n; k++) {
    const cls = pick(CLASSES);
    // A handful of deterministic dual-channel rows exercise the production identity join:
    // Tag Assignment serial ↔ StockDataa barcode, plus REPORT "GV ID Found" ↔ GV Unique ID.
    const ffBarcode = a.gv && k === 0 ? ((STOCK.rows.find((r) => r[7] === a.id) || [])[3] || '') : '';
    const noTl = !!a.gv && k % 6 === 4;
    GV_ASSIGN.rows.push([cls, `34161FA82GVS${gvSeq++}`, ffBarcode || `608116-037-0${gvSeq % 999999}`, 'In Stock', a.id, a.name, noTl ? '' : (superA ? superA.id : ''), noTl ? '' : (superA ? superA.name : ''), '', '', '', a.gv ? 'APS09129' : '', a.gv ? 'Akash Mansingh Thakur' : '', '']);
  }
}
// GV REPORT: header row 4 (A…BE), data from row 5 — same shape as the live sheet
const GVR_COLS = ['Mobile Number', 'AGENT_ID', 'AGENT_NAME', 'TL ID', 'TL Name', 'VC12', 'VC16', 'VC4', 'VC5', 'VC6', 'VC7', 'Grand Total', 'Total CV', 'Minimum Required Inventory', 'Suggested Dispatch Quantity', 'Priority Level', 'TL Total Stock (VC4)', 'TL Total Stock (NVC4)', 'TL Total Stock', 'Issuance Days', 'Last Month  (VC4)', 'Last Month (Comm.)', 'Total Last Month', 'Percent', 'AGENT  Status', 'Agent Performance', 'Today Issued', 'Issuance Days', 'Replace', 'Chassis', 'VC4', 'VC5', 'VC6', 'VC7', 'VC12', 'VC16', 'TOTAL CV CURRENT MONTH', 'Total Issunce', 'Expacted In Month', 'Runrate (VC4)', 'Runrate (NVC4)', 'Runrate', 'TL Last Month (VC4)', 'TL Last Month (Comm.)', 'TL Last Month Total', 'VC4 Issuance', 'NVC4 Issuance', 'TL Total Activation(Current Month)', 'Average Runrate (VC4)', 'Average Runrate (NVC4)', 'eRunrate', 'SUPERVISER ID'];
const GV_REPORT = { cols: GVR_COLS.map((l, i) => ({ id: L(i), label: l, type: 'string' })), rows: [] };
GV_REPORT.rows.push(new Array(GVR_COLS.length).fill(''), new Array(GVR_COLS.length).fill(''), new Array(GVR_COLS.length).fill(''), GVR_COLS.slice());
const gvMonthKey = (d) => `${d.getFullYear()}-${d.getMonth()}`;
for (const a of AGENTS) {
  const mine = GV_MASTER.rows.filter((r) => r[0] === a.id);
  if (!mine.length) continue;
  const dt = (r) => { const m = String(r[15]).match(/Date\((\d+),(\d+),(\d+)/); return m ? new Date(+m[1], +m[2], +m[3]) : null; };
  const cur = mine.filter((r) => dt(r) && gvMonthKey(dt(r)) === curKey), last = mine.filter((r) => dt(r) && gvMonthKey(dt(r)) === lastKey);
  const vc4 = (rows) => rows.filter((r) => r[5] === '4').length;
  const st = GV_ASSIGN.rows.filter((r) => r[4] === a.id);
  const sc = (c) => st.filter((r) => r[0] === c).length;
  const g = last.length ? Math.round(((cur.length - last.length) / last.length) * 100) : 0;
  const days = Math.max(1, today.getDate());
  const row = new Array(GVR_COLS.length).fill('');
  row[0] = `98${10000000 + GV_REPORT.rows.length}`; row[1] = a.id; row[2] = a.name;
  const gvDirect = !!a.gv && GV_MASTER.rows.some((r) => r[0] === a.id && !r[2] && !r[3]);
  // 🧍 GV direct: TL ID + TL Name dono blank (warna self/real TL)
  row[3] = gvDirect ? '' : ((a.tlName && a.tlName !== 'APS') ? a.tlId : a.id);
  row[4] = gvDirect ? '' : ((a.tlName && a.tlName !== 'APS') ? a.tlName : a.name);
  row[5] = sc('12'); row[6] = sc('16'); row[7] = sc('4'); row[8] = sc('5'); row[9] = sc('6'); row[10] = sc('7');
  row[11] = st.length; row[12] = st.length - sc('4'); row[13] = Math.round(sc('4') / 8); row[14] = Math.round(Math.max(0, sc('4') / 8 - sc('4')));
  row[15] = sc('4') / days < 8 ? '🔴 High' : sc('4') / days < 20 ? '🟡 Medium' : '🟢 Low';
  row[19] = new Set(last.map((r) => r[15])).size; row[20] = vc4(last); row[21] = last.length - vc4(last); row[22] = last.length;
  row[23] = `${g >= 0 ? '▲ +' : '▼ '}${g}%`; row[24] = cur.length ? '🟢 Active Today' : 'Inactive In Month';
  row[25] = g > 20 ? '🚀 High Growth' : g >= 0 ? '🟢 Growth' : 'De-Growth';
  row[26] = cur.filter((r) => dt(r) && dt(r).getDate() === today.getDate()).length;
  row[27] = new Set(cur.map((r) => r[15])).size; row[28] = cur.filter((r) => /replacement/i.test(r[13])).length; row[29] = cur.filter((r) => /chassis/i.test(r[20])).length;
  row[30] = vc4(cur); row[31] = cur.filter((r) => r[5] === '5').length; row[32] = cur.filter((r) => r[5] === '6').length; row[33] = cur.filter((r) => r[5] === '7').length;
  row[34] = cur.filter((r) => r[5] === '12').length; row[35] = cur.filter((r) => r[5] === '16').length; row[36] = cur.length - vc4(cur); row[37] = cur.length;
  row[38] = Math.round(cur.length * 30 / days); row[39] = (vc4(cur) / days).toFixed(1); row[40] = ((cur.length - vc4(cur)) / days).toFixed(1); row[41] = (cur.length / days).toFixed(1);
  row[42] = vc4(last); row[43] = last.length - vc4(last); row[44] = last.length;
  row[45] = vc4(cur); row[46] = cur.length - vc4(cur); row[47] = cur.length;
  row[48] = (vc4(cur) / days).toFixed(1); row[49] = ((cur.length - vc4(cur)) / days).toFixed(1); row[50] = (cur.length / days).toFixed(1);
  row[51] = row[3];
  GV_REPORT.rows.push(row);
}

// Optional unified movement ledger used by stock-balance reconciliation.
const STOCK_MOVEMENTS = { cols: ['Date', 'Channel', 'Type', 'Quantity', 'Class', 'From', 'To', 'Reference', 'Note'].map((l, i) => ({ id: L(i), label: l, type: i === 0 ? 'date' : i === 3 ? 'number' : 'string' })), rows: [] };
for (let back = 55; back >= 0; back -= 5) {
  const d = new Date(today); d.setDate(d.getDate() - back);
  STOCK_MOVEMENTS.rows.push([dstr(d), 'First Forward', 'IN', 90 + (back % 17), back % 10 ? 'VC4' : 'VC20', 'Warehouse', 'FF Field', `FF-GRN-${back}`, 'Mock received stock']);
  STOCK_MOVEMENTS.rows.push([dstr(d), 'GV Partner', 'IN', 45 + (back % 11), 'VC4', 'Warehouse', 'GV Field', `GV-GRN-${back}`, 'Mock received stock']);
  if (back % 10 === 0) STOCK_MOVEMENTS.rows.push([dstr(d), 'First Forward', 'TRANSFER', 12, 'VC4', 'Agent A', 'Agent B', `TR-${back}`, 'Internal transfer']);
}
// Payout sheet: har class ka commission rate + penalty (user ki real FF sheet jaisi structure).
const PAYOUT = {
  cols: ['Particulars', 'Vehicle Class', 'Commission Per Tag', 'Penalty', 'Note'].map((l, i) => ({ id: L(i), label: l, type: i === 2 || i === 3 ? 'number' : 'string' })),
  rows: [
    ['FASTag issuance · Car / Jeep / Van', 'VC4', 3.5, '', 'per tag'],
    ['FASTag issuance · LCV', 'VC20', 5, '', ''],
    ['FASTag issuance · Bus 2 axle', 'VC5', 8, '', ''],
    ['FASTag issuance · Truck 3 axle', 'VC6', 10, '', ''],
    ['FASTag issuance · Truck 4-6 axle', 'VC7', 12, '', ''],
    ['FASTag issuance · Truck 7+ axle', 'VC12', 15, '', ''],
    ['FASTag issuance · HCM / EME', 'VC16', 18, '', ''],
    ['Commercial fallback (any CV)', 'VC5+', 12, '', 'jab exact class row na ho'],
    ['Wrong VRN penalty', '', '', 50, 'per wrong VRN'],
    ['Replacement charges', '', '', 25, 'per replacement']
  ]
};
const SHEETS = { EIR, StockDataa: STOCK, REPORT, 'GV Master': GV_MASTER, 'Tag Assignment': GV_ASSIGN, 'GV REPORT': GV_REPORT, 'Stock Movements': STOCK_MOVEMENTS, Payout: PAYOUT, payout: PAYOUT };
const GIDS = { '242489821': 'REPORT', '0': 'EIR', '1284424234': 'GV REPORT' };

/** gviz `range=A4:BE` → labels from the range's first row, data from the next row. */
function applyRange(sheet, range) {
  const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d*))?$/i.exec(String(range || '').trim());
  if (!m) return sheet;
  const c1 = colIdx(m[1]), r1 = Number(m[2]) - 1;
  const c2 = m[3] ? colIdx(m[3]) : sheet.cols.length - 1;
  const r2 = (m[4] !== undefined && m[4] !== '') ? Number(m[4]) : sheet.rows.length;
  const rows = sheet.rows.slice(r1, r2);
  const head = rows[0] || [];
  const cols = [];
  for (let c = c1; c <= c2; c++) {
    const label = head[c] !== undefined && head[c] !== null && head[c] !== '' ? String(head[c]).trim() : (sheet.cols[c] ? sheet.cols[c].label : '');
    cols.push({ id: sheet.cols[c] ? sheet.cols[c].id : L(c), label, type: sheet.cols[c] ? sheet.cols[c].type : 'string' });
  }
  const data = rows.slice(1).map((r) => { const out = []; for (let c = c1; c <= c2; c++) out.push(r[c] === undefined ? '' : r[c]); return out; });
  return { cols, rows: data };
}


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
    if (/^(lower|upper|todate)$/i.test(col)) { fn = col.toLowerCase(); i++; col = tokens[i++]; i++; }
    const ci = colIdx(col);
    const op = peek();
    if (op === 'is') { i++; if (peek() === 'not') { i += 2; return (r) => r[ci] !== null && r[ci] !== undefined && r[ci] !== ''; } i++; return (r) => r[ci] === null || r[ci] === undefined || r[ci] === ''; }
    i++;
    // date 'yyyy-mm-dd' literal (used with toDate(col) comparisons)
    if (peek() === 'date') {
      i++;
      const dl = tokens[i++].replace(/^['"]|['"]$/g, '');
      const [yy, mm, dd] = dl.split('-').map(Number);
      const lim = new Date(yy, mm - 1, dd).getTime();
      const dv = (r) => { const d = toDate(r[ci]); return d ? d.getTime() : NaN; };
      const cmpD = { '=': (a) => a === lim, '!=': (a) => a !== lim, '<>': (a) => a !== lim, '>': (a) => a > lim, '>=': (a) => a >= lim, '<': (a) => a < lim, '<=': (a) => a <= lim }[op];
      if (!cmpD) throw new Error(`Unsupported date operator ${op}`);
      return (r) => { const a = dv(r); return Number.isFinite(a) && cmpD(a); };
    }
    let lit = tokens[i++]; lit = lit.replace(/^['"]|['"]$/g, '');
    if (['>', '>=', '<', '<='].includes(op)) {
      const n = Number(lit);
      const f = { '>': (a, b) => a > b, '>=': (a, b) => a >= b, '<': (a, b) => a < b, '<=': (a, b) => a <= b }[op];
      return (r) => { const v = r[ci]; if (v === null || v === undefined || v === '') return false; return Number.isFinite(n) ? f(Number(v), n) : f(String(v), lit); };
    }
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
  let sheet = SHEETS[sheetName];
  let body;
  try {
    const range = url.searchParams.get('range');
    if (range) sheet = applyRange(sheet, range);
    const table = runQuery(sheet, url.searchParams.get('tq') || '');
    body = `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify({ version: '0.6', reqId: '0', status: 'ok', sig: '1', table })});`;
  } catch (err) {
    body = `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify({ version: '0.6', status: 'error', errors: [{ reason: 'invalid_query', message: 'INVALID_QUERY', detailed_message: err.message }] })});`;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}).listen(PORT, () => console.log(`mock gviz on :${PORT} · EIR ${EIR.rows.length} · StockDataa ${STOCK.rows.length} · REPORT ${REPORT.rows.length} · GV Master ${GV_MASTER.rows.length} · Tag Assignment ${GV_ASSIGN.rows.length} · GV REPORT ${GV_REPORT.rows.length}`));
