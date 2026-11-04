import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../tagIssued.js', import.meta.url), 'utf8');
function load() {
  const U = {
    clean: (v) => String(v == null ? '' : v).trim(), fmt: (n) => String(n), dateKey: (d) => d, ymKey: () => '',
    growth: (a, b) => (b ? ((a - b) / b) * 100 : null), spinner: () => '', pctOf: (a, b) => (b ? (a / b) * 100 : null)
  };
  const FF = { pages: {}, util: U, config: { directLabel: () => 'Direct', isDirectAgent: (a) => /direct/i.test(a.tlName || '') }, store: {}, gv: {}, model: {}, charts: {} };
  const win = { FF, localStorage: { getItem: () => null, setItem() {} }, document: {} };
  win.window = win;
  vm.runInNewContext(src, win);
  return FF.pages.tagIssued._test;
}

/** Oct 2026 — GV Master se aane wali rows (agent + TL ke saath). */
const gvMasterOct = (n, d = '2026-10-05') => Array.from({ length: n }, () => ({
  date: d, group: 'VC4', cls: 'VC4', agentId: 'G1', agentName: 'Gv One', tlName: 'TL A', tlId: 'T1'
}));

test('GV report total = GV Master + EIR rows that GV Master is missing (report vs card mismatch fix)', () => {
  const t = load();
  const m = {
    from: '2026-10-01', to: '2026-10-31', prevFfRange: null, prevGvRange: null, prevFf2Range: null, prevGv2Range: null,
    ff: { total: 0 }, gv: { total: 25 }   // KPI card (= EIR): 20 named + 5 live rows with no agent identity
  };
  const rawGvMaster = gvMasterOct(20);
  // EIR GV rows: 20 jo GV Master me bhi hain + 5 aaj ki live rows jinka agent identity khaali hai
  const gvEirRows = [
    ...Array.from({ length: 20 }, () => ({ channel: 'GV Partner', date: '2026-10-05', group: 'VC4', cls: 'VC4', agentId: '', agentName: '', n: 1 })),
    ...Array.from({ length: 5 }, () => ({ channel: 'GV Partner', date: '2026-10-20', group: 'VC4', cls: 'VC4', agentId: '', agentName: '', n: 1 }))
  ];
  const dir = { ff: () => null, gv: () => '' };
  const inputs = t.reportInputs({ dailyRows: [], rawGvMaster, gvEirRows }, dir);
  const rep = t.buildAgentReport(inputs, m, 'gv');

  // Pehle report 20 dikhata tha (card 25) — ab dono 25.
  assert.equal(rep.chTot.gv, 25, 'report GV total must equal the KPI card total');
  assert.equal(rep.grandTotal, 25);
  assert.equal(rep.noIdent.gv, 5, 'the 5 identity-less rows are reported as a bucket');

  const sheets = t.reportSheets(rep, m, 'gv');
  const sc = sheets.find((s) => s.name === 'Source check');
  assert.ok(sc, 'Source check sheet exists');
  const row = sc.rows.find((r) => r[0] === 'GV');
  assert.equal(row[1], 25, 'KPI total column');
  assert.equal(row[2], 25, 'report total column');
  assert.equal(row[3], 5, 'no-agent column');
  assert.equal(row[5], 0, 'difference must be 0');

  // Bucket agent-wise sheet me nahi jaata (double count nahi), TL sheet ke totals me ginta hai.
  const tl = sheets.find((s) => s.name.startsWith('TLs'));
  assert.ok(tl.rows.some((r) => /no agent in EIR/i.test(String(r[2]))), 'TL sheet shows the bucket as a total line');
  assert.ok(!tl.rows.some((r) => r[2] === '(No agent in EIR)'), 'the bucket is not a ranked TL row');
  const grand = tl.rows.find((r) => /GRAND TOTAL/.test(String(r[2])));
  assert.equal(grand[8], 25, 'GRAND TOTAL still counts the identity-less rows');
});

test('FF rows with no agent identity are counted, not dropped', () => {
  const t = load();
  const m = { from: '2026-10-01', to: '2026-10-31', prevFfRange: null, prevGvRange: null, ff: { total: 3 }, gv: { total: 0 } };
  const dailyRows = [
    { channel: 'First Forward', agentId: '', agentName: '', key: '2026-10-04', group: 'VC4', n: 3 }
  ];
  const rep = t.buildAgentReport(t.reportInputs({ dailyRows, rawGvMaster: [] }, { ff: () => null, gv: () => '' }), m, 'ff');
  assert.equal(rep.chTot.ff, 3);
  assert.equal(rep.noIdent.ff, 3);
  const sheets = t.reportSheets(rep, m, 'ff');
  const sc = sheets.find((s) => s.name === 'Source check');
  assert.equal(sc.rows.find((r) => r[0] === 'FF')[3], 3);
});

test('month-wise summary: partial month is compared with the same days last month, never with a full month', () => {
  const t = load();
  const m = { from: '2026-09-01', to: '2026-11-04', prevFfRange: null, prevGvRange: null, ff: { total: 0 }, gv: { total: 0 } };
  const dailyRows = [
    { channel: 'First Forward', agentId: 'F1', agentName: 'Ff One', key: '2026-09-10', group: 'VC4', n: 100 },
    { channel: 'First Forward', agentId: 'F1', agentName: 'Ff One', key: '2026-10-05', group: 'VC4', n: 200 },
    { channel: 'First Forward', agentId: 'F1', agentName: 'Ff One', key: '2026-11-02', group: 'VC4', n: 10 }
  ];
  const rep = t.buildAgentReport(t.reportInputs({ dailyRows, rawGvMaster: [] }, { ff: () => ({ name: 'Ff One', tlName: 'TL B', tlId: 'T9' }), gv: () => '' }), m, 'ff');
  const sheets = t.reportSheets(rep, m, 'ff');
  const sum = sheets.find((s) => s.name === 'Month-wise summary');
  const H = sum.header;
  assert.ok(!H.includes('Change vs prev month'), 'header no longer implies a full-month comparison');
  const nov = sum.rows.find((r) => /^Nov 26/.test(String(r[0])) && r[2] === 'FF');
  assert.match(String(nov[0]), /partial · 1–4/, 'partial month is labelled with its day span');
  assert.equal(nov[H.indexOf('Days')], 4, 'Nov row counts only the days in the range');
  assert.equal(nov[H.indexOf('Per day')], 2.5, 'per day uses the days actually in the range');
  // Comparison = Oct 1–4 (same days), NOT the full October.
  assert.equal(nov[H.indexOf('Compared with')], 'Oct 26 · 1–4');
  assert.equal(nov[H.indexOf('Comparison total')], 0);
  assert.equal(nov[H.indexOf('Change')], 10, 'change vs same days last month (10 − 0)');
  const oct = sum.rows.find((r) => /^Oct 26/.test(String(r[0])) && r[2] === 'FF');
  assert.equal(oct[H.indexOf('Change')], 100, 'full month compared with the previous full month');
  assert.equal(oct[H.indexOf('Compared with')], 'Sep 26');
});

test('TL sheet separates the no-agent bucket from the ranked TL list', () => {
  const t = load();
  const m = { from: '2026-10-01', to: '2026-10-31', prevFfRange: null, prevGvRange: null, ff: { total: 0 }, gv: { total: 0 } };
  const dailyRows = [{ channel: 'First Forward', agentId: 'F1', agentName: 'Ff One', key: '2026-10-06', group: 'VC4', n: 4 }];
  const rep = t.buildAgentReport(t.reportInputs({ dailyRows, rawGvMaster: [] }, { ff: () => ({ name: 'Ff One', tlName: 'TL B', tlId: 'T9' }), gv: () => '' }), m, 'ff');
  const piv = t.tlPivot(rep.list);
  assert.equal(piv.length, 1);
  assert.equal(piv[0].name, 'TL B');
});
