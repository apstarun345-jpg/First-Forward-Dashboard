/* 🧾 v3.45 — GV Truth Engine + naya Agent/TL Summary.
   Cover:
   1) Heading se column recognition — GV Master me column shift (agent_name B se C) ho to bhi sahi naam.
   2) Tag Assignment: status-aware stock (issued/returned rows stock me nahi ginte) + probe se mapping.
   3) Ledger-final numbers: GV Master tag rows se MTD / last month / today / stock + GV REPORT cross-check.
   4) Tag-level drill: VRN barcode, TAG_ID, serial, date, class — jo number me gine gaye.
   5) TL ka own + agents ka stock split aur team rollup. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.location = { hash: '#/gvAgentSummary', href: '' };
['config', 'util', 'data', 'model', 'store', 'gv', 'gvTruth'].forEach((f) => require(path.join(ROOT, `${f}.js`)));
const FF = globalThis.FF;
const U = FF.util;
FF.auth = { can: () => true, settings: {}, isAdmin: () => true, user: { username: 'u' } };

const ym = U.ymKey(new Date());
const lastYm = U.prevMonthKey(ym);
const today = new Date();
const dstr = (d) => `Date(${d.getFullYear()},${d.getMonth()},${d.getDate()})`;
const dayIn = (month, day) => { const [y, m] = month.split('-').map(Number); return new Date(y, m - 1, day); };
const TODAY = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

const TL = { id: 'APS011919', name: 'Hemalbhai Bhavsar' };
const A1 = { id: 'APS013659', name: 'Taga Ram' };
const A2 = { id: 'APS04505', name: 'KAWARA RAM' };

// ---- GV Master (issuance ledger) -----------------------------------------------------------------
// Column A = agent ID, B = agent name, C = supervisor id, D = supervisor name, E = VRN, F = class,
// H = serial, I = TAG_ID, M = commission, N = status, P = date, R = GV TL ID, U = tag type.
const MASTER_COLS = ['unique_id', 'agent_name', 'supervisor_agent_id', 'supervisor_name', 'vno', 'vclass', 'cch', 'sno', 'tag_id_number', 'amount', 'name', 'product_id', 'commission', 'status', 'commission_status', 'Date', 'Time', 'GV TL ID', 'Master CCH', 'Month Name', 'Tag Type', 'x', 'GV Unique ID', 'GV Unique Name', 'lenth'];
const masterLabelRow = { v: null, f: 'header' };
function masterRow({ who, cls, day, month, tag, vrn, status = 'Completed', type = 'VRN', commission = 200 }) {
  const d = dayIn(month, day);
  return [
    who.id, who.name, TL.id, TL.name, vrn, cls, `VC${cls}`, `608116-0${cls}-0001`, tag, 500, 'CUST', '100000005715',
    commission, status, 'Paid', dstr(d), '12:53:56', TL.id, `VC${cls}`, `${month}`, type, '', 'APS09129', 'Akash M', '7'
  ].map((v) => ({ v, f: String(v) }));
}
const MASTER = [
  // is mahine: A1 = 3 tags (2 VC4 + 1 VC20), A2 = 2 tags (1 VC4 + 1 replacement)
  masterRow({ who: A1, cls: '4', day: 1, month: ym, tag: 'T1', vrn: 'RJ14AA1111' }),
  masterRow({ who: A1, cls: '4', day: 2, month: ym, tag: 'T2', vrn: 'RJ14AA2222' }),
  masterRow({ who: A1, cls: '20', day: 2, month: ym, tag: 'T3', vrn: 'RJ14AA3333' }),
  masterRow({ who: A2, cls: '4', day: 3, month: ym, tag: 'T4', vrn: 'RJ14AA4444' }),
  masterRow({ who: A1, cls: '4', day: 3, month: ym, tag: 'T5', vrn: 'RJ14AA5555', status: 'Replacement', type: 'Chassis' }),
  // pichhla mahina: 6 tags
  ...Array.from({ length: 6 }, (_, i) => masterRow({ who: i % 2 ? A2 : A1, cls: i % 3 ? '4' : '5', day: i + 1, month: lastYm, tag: `L${i + 1}`, vrn: `RJ14LL${i}${i}${i}${i}` }))
];
if (ym === TODAY.slice(0, 7)) {
  MASTER.push(masterRow({ who: A1, cls: '4', day: today.getDate(), month: ym, tag: 'TODAY1', vrn: 'RJ14ZZ9999' }));
}

// ---- Tag Assignment (stock) — ek row = ek tag; D = status ----------------------------------------
const ASSIGN_COLS = ['VEHICLE_CLASS', 'TAG_ID', 'SERIAL_NUMBER', 'TAG_STATUS', 'AGENT_ID', 'AGENT_NAME', 'SUPERVISOR_ID', 'SUPERVISOR_NAME', 'x1', 'x2', 'x3', 'GV Unique ID', 'GV Unique Name', 'x4'];
const ASSIGN_ROWS = [
  // A1 (Taga Ram) ke paas: 2 in-stock + 1 issued (stock me nahi ginega)
  [{ v: '4', f: '4' }, { v: 'S1' }, { v: '608116-037-000001' }, { v: 'In Stock' }, { v: A1.id }, { v: A1.name }, { v: TL.id }, { v: TL.name }, { v: '' }, { v: '' }, { v: '' }, { v: 'APS09129' }, { v: 'Akash M' }, { v: '' }],
  [{ v: '4', f: '4' }, { v: 'S2' }, { v: '608116-037-000002' }, { v: 'In Stock' }, { v: A1.id }, { v: A1.name }, { v: TL.id }, { v: TL.name }, { v: '' }, { v: '' }, { v: '' }, { v: 'APS09129' }, { v: 'Akash M' }, { v: '' }],
  [{ v: '20', f: '20' }, { v: 'S3' }, { v: '608116-037-000003' }, { v: 'Tag Issued' }, { v: A1.id }, { v: A1.name }, { v: TL.id }, { v: TL.name }, { v: '' }, { v: '' }, { v: '' }, { v: 'APS09129' }, { v: 'Akash M' }, { v: '' }],
  // A2 ke paas: 1 in-stock
  [{ v: '4', f: '4' }, { v: 'S4' }, { v: '608116-037-000004' }, { v: 'In Stock' }, { v: A2.id }, { v: A2.name }, { v: TL.id }, { v: TL.name }, { v: '' }, { v: '' }, { v: '' }, { v: 'APS09129' }, { v: 'Akash M' }, { v: '' }],
  // TL ke paas khud: 2 in-stock (agent = TL)
  [{ v: '4', f: '4' }, { v: 'S5' }, { v: '608116-037-000005' }, { v: 'In Stock' }, { v: TL.id }, { v: TL.name }, { v: TL.id }, { v: TL.name }, { v: '' }, { v: '' }, { v: '' }, { v: 'APS09129' }, { v: 'Akash M' }, { v: '' }],
  [{ v: '4', f: '4' }, { v: 'S6' }, { v: '608116-037-000006' }, { v: 'In Stock' }, { v: TL.id }, { v: TL.name }, { v: TL.id }, { v: TL.name }, { v: '' }, { v: '' }, { v: '' }, { v: 'APS09129' }, { v: 'Akash M' }, { v: '' }],
  // GV direct agent (TL ID + naam dono blank) → GV me "Unassigned" bucket, par ye koi asli TL nahi
  [{ v: '4', f: '4' }, { v: 'S7' }, { v: '608116-037-000007' }, { v: 'In Stock' }, { v: '5846999' }, { v: 'DIRECT GUY' }, { v: '' }, { v: '' }, { v: '' }, { v: '' }, { v: '' }, { v: 'APS09129' }, { v: 'Akash M' }, { v: '' }]
];
const cell = (r, i) => (r[i] === undefined ? null : r[i]);

/** Chhota gviz stand-in — sirf wahi queries jo GV loaders chalate hain. */
function serve(sheet, tq) {
  const q = String(tq || '');
  if (sheet === 'GV Master') {
    if (/^select \* limit/i.test(q)) return { cols: MASTER_COLS.map((l, i) => ({ id: U.colLetter(i), label: l })), rows: MASTER.slice(0, 1) };
    return { cols: MASTER_COLS.map((l, i) => ({ id: U.colLetter(i), label: l })), rows: MASTER };
  }
  if (sheet === 'Tag Assignment') {
    if (/^select \* limit 1/i.test(q)) return { cols: ASSIGN_COLS.map((l, i) => ({ id: U.colLetter(i), label: l })), rows: ASSIGN_ROWS.slice(0, 1) };
    const cols = ASSIGN_COLS.map((l, i) => ({ id: U.colLetter(i), label: l }));
    const m = /^select ([A-Z](?:, ?[A-Z])*) *, *count\(([A-Z])\)/i.exec(q);
    if (m) {
      const idxs = m[1].split(',').map((x) => U.colIndex(x.trim()));
      const map = new Map();
      for (const r of ASSIGN_ROWS) {
        const key = idxs.map((i) => FF.data.cellText(cell(r, i))).join('|');
        map.set(key, (map.get(key) || 0) + 1);
      }
      // gviz select order me hi columns deta hai (column letter order me nahi)
      return {
        cols, rows: [...map.entries()].map(([key, n]) => {
          const vals = key.split('|');
          return [...idxs.map((_, k) => ({ v: vals[k], f: vals[k] })), { v: n, f: String(n) }];
        })
      };
    }
    // tag-level filter query (stockTagRows)
    const where = /where (.+?) (?:order by|limit|$)/i.exec(q);
    const idxs = (() => { const s = /^select ([A-Z](?:, ?[A-Z])*)/i.exec(q); return s ? s[1].split(',').map((x) => U.colIndex(x.trim())) : []; })();
    let rows = ASSIGN_ROWS;
    if (where) {
      const conds = where[1].split(/ and /i).map((c) => {
        const mm = /([A-Z]) = '([^']*)'/.exec(c.trim());
        return mm ? { i: U.colIndex(mm[1]), v: mm[2] } : null;
      }).filter(Boolean);
      const orMatch = /\(([A-Z]) = '([^']*)' or ([A-Z]) = '([^']*)'\)/i.exec(where[1]);
      rows = ASSIGN_ROWS.filter((r) => {
        if (orMatch) {
          const [, c1, v1, c2, v2] = orMatch;
          return FF.data.cellText(cell(r, U.colIndex(c1))) === v1 || FF.data.cellText(cell(r, U.colIndex(c2))) === v2;
        }
        return conds.every((c) => FF.data.cellText(cell(r, c.i)) === c.v);
      });
    }
    return { cols, rows: rows.map((r) => idxs.map((i) => cell(r, i))) };
  }
  if (sheet === 'GV REPORT') {
    const header = ['Mobile Number', 'AGENT_ID', 'AGENT_NAME', 'TL ID', 'TL Name', 'VC12', 'VC16', 'VC4', 'VC5', 'VC6', 'VC7', 'Grand Total', 'Total CV', 'Minimum Required Inventory', 'Suggested Dispatch Quantity', 'Priority Level', 'TL Total Stock (VC4)', 'TL Total Stock (NVC4)', 'TL Total Stock', 'Issuance Days', 'Last Month (VC4)', 'Last Month (Comm.)', 'Total Last Month', 'Percent', 'AGENT Status', 'Agent Performance', 'Today Issued', 'Issuance Days', 'Replace', 'Chassis', 'VC4', 'VC5', 'VC6', 'VC7', 'VC12', 'VC16', 'TOTAL CV CURRENT MONTH', 'Total Issunce', 'Expacted In Month', 'Runrate (VC4)', 'Runrate (NVC4)', 'Runrate', 'TL Last Month (VC4)', 'TL Last Month (Comm.)', 'TL Last Month Total', 'VC4 Issuance', 'NVC4 Issuance', 'TL Total Activation(Current Month)', 'Average Runrate (VC4)', 'Average Runrate (NVC4)', 'eRunrate', 'SUPERVISER ID'];
    const rows = [header, ...[[A1, 3, 0, 3, 3, 0, 3], [A2, 1, 0, 1, 1, 0, 1]].map(([who, sc, scomm, stot, cur, ccomm, ctot]) => {
      const r = new Array(header.length).fill(null);
      r[0] = '9800000001'; r[1] = who.id; r[2] = who.name; r[3] = TL.id; r[4] = TL.name;
      r[7] = sc; r[11] = stot; r[12] = scomm; r[16] = 4; r[17] = 1; r[18] = 5;
      r[19] = 30; r[20] = 1; r[21] = 0; r[22] = 1; r[30] = cur; r[36] = ccomm; r[37] = ctot; r[42] = 4; r[43] = 1; r[44] = 5; r[45] = 2; r[46] = 0; r[47] = 2;
      return r.map((v) => (v === null ? null : { v, f: String(v) }));
    })];
    const cols = header.map((l, i) => ({ id: U.colLetter(i), label: l }));
    return { cols, rows: rows.slice(1), headers: 1 };
  }
  return { cols: [], rows: [] };
}

FF.data.query = async (sheet, tq, opts) => serve(sheet, tq, opts);
FF.data.cellText = (c) => (c && c.v !== undefined && c.v !== null ? String(c.f !== undefined && c.f !== null ? c.f : c.v) : '');
FF.store.get = () => [];
FF.store.need = async () => [];

async function boot() {
  FF.gv.reset();
  await Promise.all([FF.gv.need('master', { only: true }), FF.gv.need('stockAgent', { only: true }), FF.gv.need('stockAgentClass', { only: true }), FF.gv.need('stockTl', { only: true }), FF.gv.need('stockTlClass', { only: true }), FF.gv.need('report', { only: true })]);
}

test('GV Master: heading se column recognition (naam shift hone par bhi sahi) ', async () => {
  await boot();
  const rows = FF.gv.rows();
  assert.ok(rows.length >= 10, 'GV Master rows load hui');
  const first = rows[0];
  assert.equal(first.agentId, A1.id, 'column A = agent ID');
  assert.equal(first.agentName, A1.name, 'agent name header se mapped');
  assert.equal(first.tlId, TL.id, 'GV TL ID (column R)');
  assert.ok(first.vrn.startsWith('RJ14'), 'VRN barcode padha gaya');
  assert.ok(first.tagId, 'TAG_ID padha gaya');
  assert.equal(first.ym, ym === first.ym ? ym : first.ym);

  // Column shift test: agent_name B ki jagah C par ho to header mapping usko pakad le.
  const shiftedCols = MASTER_COLS.slice();
  shiftedCols.splice(2, 0, 'extra_col');
  FF.data.query = async (sheet, tq) => {
    if (sheet !== 'GV Master') return serve(sheet, tq);
    const rows2 = MASTER.map((r) => { const c = r.slice(); c.splice(2, 0, { v: 'x', f: 'x' }); return c; });
    return { cols: shiftedCols.map((l, i) => ({ id: U.colLetter(i), label: l })), rows: rows2 };
  };
  FF.gv.reset();
  await FF.gv.need('master', { only: true });
  const shifted = FF.gv.rows()[0];
  assert.equal(shifted.agentName, A1.name, 'shift hone par bhi agent name sahi (heading se)');
  assert.equal(shifted.agentId, A1.id);
  const warn = FF.gv.mappingWarnings().map((w) => (typeof w === 'string' ? w : w.text)).join(' | ');
  assert.match(warn, /agentName|tlId|date/, 'mapping ne relocation note kiya');
  FF.data.query = async (sheet, tq, opts) => serve(sheet, tq, opts);
  await boot();
});

test('Tag Assignment: status-aware stock — issued rows stock me nahi ginte, par byStatus me dikhte hain', async () => {
  await boot();
  const stock = FF.gv.get('stockAgent');
  const a1 = stock.find((r) => r.agentId === A1.id);
  assert.ok(a1, 'agent ka stock row mila');
  assert.equal(a1.n, 2, 'in-stock sirf 2 (teesra "Tag Issued" hai)');
  assert.equal(a1.nAll, 3, 'total rows 3 — kuch chhupaya nahi gaya');
  assert.equal(a1.byStatus['Tag Issued'], 1, 'byStatus me issued count dikhta hai');
  const tlRow = FF.gv.get('stockTl').find((r) => r.tlId === TL.id);
  assert.equal(tlRow.n, 5, 'TL-wise stock = 5 in-stock tags');
  assert.equal(tlRow.nAll, 6);
});

test('gvTruth: ledger-final numbers + GV REPORT cross-check + farq', async () => {
  await boot();
  const T = FF.gvTruth;
  const t = T.person({ kind: 'gv-agent', name: A1.name, id: A1.id });
  assert.equal(t.ledger.cur.total, 5, 'is mahine ki tag rows ka jod (TODAY1 included)');
  assert.equal(t.ledger.cur.vc4, 4);
  assert.equal(t.ledger.cur.comm, 1);
  assert.equal(t.ledger.cur.replacement, 1, 'replacement alag gina gaya');
  assert.equal(t.ledger.cur.chassis, 1, 'chassis tag type alag');
  assert.equal(t.ledger.last.total, 3, 'last month = 3 tag rows');
  assert.equal(t.stock.total, 2, 'stock = Tag Assignment in-stock');
  assert.ok(t.sheet && t.sheet.curAvailable, 'GV REPORT sheet cross-check mila');
  assert.equal(t.sheet.cur, 3, 'sheet me us agent ka current month 3 likha hai');
  const curCheck = t.checks.find((c) => /is mahine/i.test(c.metric));
  assert.equal(curCheck.final, t.ledger.cur.total, 'final number ledger ka hai');
  const sheetPart = curCheck.others.find((o) => /GV REPORT/.test(o.label));
  assert.ok(sheetPart, 'sheet ka number saath dikhta hai');
  assert.equal(sheetPart.diff, t.ledger.cur.total - 3, 'farq calculate hota hai');
  assert.ok(t.ledger.cur.daily.length, 'day-wise series bani');
  const todayRows = MASTER.filter((r) => String(cell(r, 0).v) === A1.id).filter((r) => {
    const m = /Date\((\d+),(\d+),(\d+)\)/.exec(String((cell(r, 15) || {}).v || ''));
    if (!m) return false;
    return U.dateKey(new Date(Number(m[1]), Number(m[2]), Number(m[3]))) === U.dateKey(today);
  });
  assert.equal(t.ledger.today.total, todayRows.length, 'aaj ki rows alag se');
});

test('gvTruth.drill: KPI ke neeche ki tag rows (VRN barcode, TAG_ID, serial, date, class)', async () => {
  await boot();
  const T = FF.gvTruth;
  const t = T.person({ kind: 'gv-agent', name: A1.name, id: A1.id });
  const d = await T.drill({ kind: 'gv-agent', name: A1.name, id: A1.id, scope: 'cur', truth: t });
  assert.equal(d.rows.length, t.ledger.cur.rowCount, 'drill rows = KPI ke rows');
  for (const col of ['DATE', 'VRN / BARCODE', 'TAG_ID', 'SERIAL', 'CLASS', 'STATUS']) assert.ok(d.columns.includes(col), `column ${col}`);
  const flat = d.rows.flat().join(' ');
  assert.match(flat, /RJ14AA1111/, 'VRN barcode dikhta hai');
  assert.match(flat, /T1\b/, 'TAG_ID dikhta hai');
  const stock = await T.drill({ kind: 'gv-agent', name: A1.name, id: A1.id, scope: 'stock', truth: t });
  assert.equal(stock.rows.length, 3, 'stock drill me 3 rows (1 out-of-stock grey)');
  assert.equal(stock.rowFlags.filter((f) => f === 'out').length, 1, 'out-of-stock row mark hoti hai');
  assert.match(stock.rows.flat().join(' '), /608116-037-000001/, 'serial/barcode stock drill me');
});

test('gvTruth: TL ka stock = TL ke paas + agents ke paas · team rollup ledger se', async () => {
  await boot();
  const T = FF.gvTruth;
  const tl = T.person({ kind: 'gv-tl', name: TL.name, id: TL.id });
  assert.equal(tl.stock.own, 2, 'TL ke paas 2');
  assert.equal(tl.stock.agentsTotal, 3, 'agents ke paas 3 in-stock');
  assert.equal(tl.stock.total, 5, 'TL total 5');
  assert.equal(tl.ledger.cur.total, 6, 'TL ledger me poore team ke 6 tag (is mahine)');
  const team = T.team({ kind: 'gv-tl', name: TL.name, id: TL.id });
  assert.equal(team.filter((a) => !a.isSelf).length, 2, 'team me 2 agents (TL khud alag row)');
  assert.equal(team.filter((a) => a.isSelf).length, 1, 'TL ki khud ki row isSelf mark hoti hai');
  const a1 = team.find((a) => a.id === A1.id);
  assert.equal(a1.cur, 5);
  assert.equal(a1.stock, 2);
  assert.equal(a1.sheetCur, 3, 'sheet ka number bhi saath');
});

test('Tag Assignment TL/agent totals and drill-down prefer exact IDs when display names collide', async () => {
  const originalLength = ASSIGN_ROWS.length;
  const assignmentRow = ({ cls = '4', tag, status = 'In Stock', agentId, agentName, tlId, tlName }) => [
    cls, tag, `SER-${tag}`, status, agentId, agentName, tlId, tlName, '', '', '', 'GVU', 'GV User', ''
  ].map((v) => ({ v: String(v), f: String(v) }));
  ASSIGN_ROWS.push(
    assignmentRow({ tag: 'TA-1', agentId: 'AG-A', agentName: 'Same Agent', tlId: 'TL-A', tlName: 'Shared TL' }),
    assignmentRow({ tag: 'TA-2', agentId: 'AG-A', agentName: 'Same Agent', tlId: 'TL-A', tlName: 'Shared TL' }),
    assignmentRow({ tag: 'TA-OUT', status: 'Tag Issued', agentId: 'AG-A', agentName: 'Same Agent', tlId: 'TL-A', tlName: 'Shared TL' }),
    assignmentRow({ cls: '20', tag: 'TB-1', agentId: 'AG-B', agentName: 'Same Agent', tlId: 'TL-B', tlName: 'Shared TL' }),
    assignmentRow({ cls: '20', tag: 'TB-2', agentId: 'AG-B', agentName: 'Same Agent', tlId: 'TL-B', tlName: 'Shared TL' }),
    assignmentRow({ cls: '20', tag: 'TB-3', agentId: 'AG-B', agentName: 'Same Agent', tlId: 'TL-B', tlName: 'Shared TL' })
  );
  try {
    await boot();
    const T = FF.gvTruth;
    const tlA = T.stockFor({ kind: 'gv-tl', name: 'Shared TL', id: 'TL-A' });
    const tlB = T.stockFor({ kind: 'gv-tl', name: 'Shared TL', id: 'TL-B' });
    assert.deepEqual([tlA.total, tlA.vc4, tlA.comm], [2, 2, 0]);
    assert.deepEqual([tlB.total, tlB.vc4, tlB.comm], [3, 0, 3]);
    assert.equal(T.stockFor({ kind: 'gv-agent', name: 'Same Agent', id: 'AG-A' }).total, 2);
    assert.equal(T.stockFor({ kind: 'gv-agent', name: 'Same Agent', id: 'AG-B' }).total, 3);
    const detail = await T.drill({ kind: 'gv-tl', name: 'Shared TL', id: 'TL-A', scope: 'stock' });
    assert.equal(detail.rows.length, 3, 'exact TL ID detail includes its 2 in-stock + 1 issued row');
    assert.equal(detail.rowFlags.filter((flag) => flag === 'out').length, 1);
    assert.ok(detail.raw.every((row) => row.tlId === 'TL-A'), 'same-name TL B rows do not leak into TL A detail');
  } finally {
    ASSIGN_ROWS.length = originalLength;
    await boot();
  }
});

test('gvTruth.people: list me agents + TL dono, ledger aur stock ke saath', async () => {
  await boot();
  const list = FF.gvTruth.people();
  const agent = list.find((p) => p.kind === 'gv-agent' && p.id === A1.id);
  const tl = list.find((p) => p.kind === 'gv-tl' && p.id === TL.id);
  assert.ok(agent && tl, 'agent aur TL dono list me');
  assert.equal(agent.cur, 5, 'agent ka MTD ledger se');
  assert.equal(agent.stock, 2, 'agent ka stock');
  assert.equal(agent.sheetCur, 3, 'sheet ka number list me cross-check ke liye');
  assert.equal(tl.stock, 5, 'TL ka stock (own + agents)');
  assert.ok(agent.mobile, 'mobile number bhi mila (GV REPORT se)');
});

test('Tag Assignment: labels me heading ki jagah pehli data row aaye to re-probe → sahi headings', async () => {
  // gviz kabhi kabhi range ke pehle row ko hi label bana deta hai. App tab doosri baar poora pehla
  // page maangti hai; headings mil jaayein to mapping wahi se hoti hai (config letters par bharosa nahi).
  const badCols = ASSIGN_ROWS[0].map((c, i) => ({ id: U.colLetter(i), label: c && c.v !== undefined ? String(c.v) : '' }));
  FF.data.query = async (sheet, tq, opts) => {
    if (sheet !== 'Tag Assignment') return serve(sheet, tq, opts);
    if (/^select \* limit 1$/i.test(String(tq || '').trim())) return { cols: badCols, rows: ASSIGN_ROWS.slice(0, 1) };
    return serve(sheet, tq, opts);
  };
  FF.gv.reset();
  await boot();
  const map = FF.gv.mapping('assignment');
  assert.equal(map.hasLabels, true, 're-probe ke baad asli headings mil gayi');
  assert.equal(map.info.agentId.letter, 'E', 'config letter hi sahi tha');
  const a1 = FF.gv.get('stockAgent').find((r) => r.agentId === A1.id);
  assert.ok(a1 && a1.n === 2, 'stock phir bhi sahi gina gaya');
  FF.data.query = async (sheet, tq, opts) => serve(sheet, tq, opts);
  await boot();
});

test('Tag Assignment: headings kahin na milein to config letters (chup-chaap galat column nahi)', async () => {
  // Worst case: probe aur re-probe dono me data row hi labels ban ke aaye. Tab relocation nahi hoti —
  // config letters hi chalte hain, aur Data check me "headings nahi mili" dikhta hai.
  const badCols = ASSIGN_ROWS[0].map((c, i) => ({ id: U.colLetter(i), label: c && c.v !== undefined ? String(c.v) : '' }));
  FF.data.query = async (sheet, tq, opts) => {
    if (sheet !== 'Tag Assignment') return serve(sheet, tq, opts);
    if (/^select \* limit/i.test(String(tq || '').trim())) return { cols: badCols, rows: ASSIGN_ROWS.slice(0, 2) };
    return serve(sheet, tq, opts);
  };
  FF.gv.reset();
  await boot();
  const map = FF.gv.mapping('assignment');
  assert.equal(map.hasLabels, false, 'data-row labels ko heading nahi maana gaya');
  for (const [field, i] of Object.entries(map.info)) {
    if (!/^[A-Z]{1,2}$/.test(String(i.configLetter))) continue;
    assert.ok(['no-headers', 'config'].includes(i.how), `${field} config letter par hi raha (${i.how})`);
  }
  const a1 = FF.gv.get('stockAgent').find((r) => r.agentId === A1.id);
  assert.ok(a1 && a1.n === 2, 'config letters se stock sahi gina gaya');
  FF.data.query = async (sheet, tq, opts) => serve(sheet, tq, opts);
  await boot();
});

test('gvTruth.people: placeholder TL (Unassigned/Direct) list ke aakhir me, default pick asli banda', async () => {
  // Tag Assignment me jinke TL blank hain unka bucket "Unassigned" banta hai — uski stock badi hoti hai,
  // par usse page ka default person nahi banna chahiye.
  await boot();
  const list = FF.gvTruth.people();
  const last = list[list.length - 1];
  assert.equal(last.isPlaceholder, true, 'placeholder TL sabse aakhir me');
  assert.match(last.name, /unassigned|direct/i);
  assert.ok(list.length >= 3, 'asli agent + TL bhi list me');
  assert.equal(list[0].isPlaceholder, false, 'pehla banda asli hai');
});
