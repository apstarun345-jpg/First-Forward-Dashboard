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
    eir: { sheet: 'EIR', agentName: 'L', gvName: 'AX', masterId: 'AU', tlName: 'BA', tagId: 'A', date: 'AA', gvMasterId: '5845036', gvChannelTl: 'ApnaPayment Pvt. Ltd.' },
    gv: { master: { agentName: 'B', uniqueId: 'A', date: 'P' } },
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
      ['FF Agent', '', '', 'Team FF', 4],
      ['GV Agent', '', '5845036', 'Team GV', 3],
      ['Legacy GV', '', '', 'ApnaPayment Pvt. Ltd.', 2]
    ]);
    return table([['GV Agent', 'G1', 3], ['Second GV', 'G2', 2]]);
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
  assert.match(calls.find((x) => x.sheet === 'EIR').tq, /count\(A\).*group by/);
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
