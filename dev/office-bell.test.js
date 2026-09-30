/* Office Bell regression: FF.data.query returns array rows (not {c:...}), and GV must not be double-counted from EIR. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
globalThis.FF = {
  util: {
    clean: (v) => String(v === null || v === undefined ? '' : v).trim(),
    dateKey: () => '2026-09-29',
    fmt: (n) => String(n),
    $: () => null,
    h: () => null,
    toast: () => {}
  },
  config: {
    eir: { sheet: 'EIR', agentName: 'L', gvName: 'AX', masterId: 'AU', tlName: 'BA', cls: 'D', tagId: 'A', date: 'AA', gvMasterId: '5845036', gvChannelTl: 'ApnaPayment Pvt. Ltd.' },
    gv: { master: { agentName: 'B', uniqueId: 'A', vClass: 'F', date: 'P' } },
    gvSheetId: 'gv-sheet',
    features: {}
  },
  assistant: { getLang: () => 'hi' }
};
const cell = (v) => ({ v });
const table = (rows) => ({ rows: rows.map((r) => r.map(cell)) });
let failSource = '';
const calls = [];
globalThis.FF.model = { channelOf: (masterId, tlName) => String(masterId).replace(/\.0+$/, '') === '5845036' || String(tlName).toLowerCase() === 'apnapayment pvt. ltd.' ? 'GV Partner' : 'First Forward' };
globalThis.FF.data = {
  cellText: (c) => c && c.v !== undefined && c.v !== null ? String(c.v) : '',
  cellNumber: (c) => c && c.v !== undefined && c.v !== null ? Number(c.v) : null,
  query: async (sheet, tq) => {
    calls.push({ sheet, tq });
    if (failSource === sheet) throw new Error('mock gviz failure');
    if (sheet === 'EIR') return table([
      ['FF Agent', '', '', 'Team FF', '4', 4],
      ['GV Agent', '', '5845036', 'Team GV', 'VC4', 3],
      ['Legacy GV', '', '', 'ApnaPayment Pvt. Ltd.', '5', 2]
    ]);
    return table([['GV Agent', 'G1', '4', 3], ['Second GV', 'G2', 'VC16', 2]]);
  }
};
require(path.join(ROOT, 'officeBell.js'));
const bell = globalThis.FF.officeBell;

test('countsToday parses normalized query arrays and separates FF from GV', async () => {
  const result = await bell.countsToday();
  assert.equal(result.ff, 4);
  assert.equal(result.gv, 5);
  assert.deepEqual([...result.agents.entries()].sort(), [['FF|FF Agent', 4], ['GV|GV Agent', 3], ['GV|Second GV', 2]]);
  assert.deepEqual(result.ok, { ff: true, gv: true });
  // 🏷️ class-wise counts (notification drawer ka "class-wise kitna update hua" isi par chalta hai)
  assert.deepEqual(result.classes.FF, { VC4: 4 });
  assert.deepEqual(result.classes.GV, { VC4: 3, VC16: 2 });
  assert.match(calls.find((x) => x.sheet === 'EIR').tq, /count\(A\).*group by/);
  assert.match(calls.find((x) => x.sheet === 'EIR').tq, /group by.*BA.*, D/, 'EIR query me class column bhi group-by hona chahiye');
  assert.match(calls.find((x) => x.sheet === 'GV Master').tq, /F.*group by|group by.*F/, 'GV Master query me vClass group-by hona chahiye');
});

test('countsToday flags a failed source instead of resetting its count to zero', async () => {
  failSource = 'EIR';
  try {
    const result = await bell.countsToday();
    assert.equal(result.ok.ff, false);
    assert.equal(result.ok.gv, true);
    assert.equal(result.ff, 0);
    assert.equal(result.gv, 5);
  } finally { failSource = ''; }
});

test('voice announcements identify First Forward vs GV Partner and tolerate no named mover', () => {
  const ff = bell.announceText([{ ch: 'FF', agent: 'Ravi Kumar', n: 4 }], 4);
  const gv = bell.announceText([{ ch: 'GV', agent: 'Priya Sharma', n: 3 }], 3);
  const both = bell.announceText([{ ch: 'FF', agent: 'Ravi', n: 4 }, { ch: 'GV', agent: 'Priya', n: 2 }], 6);
  assert.match(ff, /Ravi.*First Forward/);
  assert.match(gv, /Priya.*GV Partner/);
  assert.match(both, /First Forward/);
  assert.match(both, /GV Partner/);
  assert.match(bell.announceText([], 2), /2/);
});

/* 🔔 notification → drawer: data-update alert ke meta me class-wise snapshot/delta hona chahiye,
   warna notification par click karne par drawer me sirf title dikhta hai ("data nahi aata").
   Ye test poll() ke do chakkar chalata hai (baseline + growth) aur localAlert ka meta check karta hai. */
test('poll ke data-update notification me class-wise snapshot / previous / delta aata hai', async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
  const alerts = [];
  globalThis.FF.notifications = { localAlert: (o) => { alerts.push(o); return o; } };
  globalThis.FF.app = { syncNow: () => Promise.resolve() };
  globalThis.document = { hidden: true };
  let ff4 = 4, ff6 = 1, gv4 = 3, gv16 = 2;
  globalThis.FF.data.query = async (sheet) => {
    if (sheet === 'EIR') return table([
      ['FF Agent', '', '', 'Team FF', '4', ff4],
      ['FF Agent', '', '', 'Team FF', 'VC6', ff6],
      ['GV Agent', '', '5845036', 'Team GV', 'VC4', gv4]
    ]);
    return table([['GV Agent', 'G1', '4', gv4], ['Second GV', 'G2', 'VC16', gv16]]);
  };
  await bell.poll();                       // baseline — chup-chaap, koi alert nahi
  assert.equal(alerts.length, 0, 'pehla poll baseline hai — alert nahi aani chahiye');
  ff4 = 9; ff6 = 3; gv4 = 5; gv16 = 4;     // naye tags
  await bell.poll();
  assert.equal(alerts.length, 1, 'doosre poll par data-update alert aani chahiye');
  const meta = alerts[0].meta || {};
  assert.equal(alerts[0].type, 'report');
  assert.equal(meta.delta.total, 11, 'delta = naye FF (7) + naye GV (4)');
  assert.equal(meta.delta.classes.VC4, 7, 'FF+GV VC4 ke naye tags (5 FF + 2 GV)');
  assert.equal(meta.delta.classes.VC6, 2, 'FF VC6 ke naye tags');
  assert.equal(meta.delta.classes.VC16, 2, 'GV VC16 ke naye tags');
  assert.equal(meta.ffClasses.VC6, 2);
  assert.equal(meta.gvClasses.VC16, 2);
  assert.ok(meta.snapshot && meta.snapshot.date && meta.snapshot.classes.VC4 >= 5, 'snapshot me aaj ka class-wise total chahiye');
  assert.ok(meta.previous && meta.previous.classes.VC4 < meta.snapshot.classes.VC4, 'previous snapshot chhota hona chahiye');
  assert.equal(meta.link, '#/tagIssued');
});
