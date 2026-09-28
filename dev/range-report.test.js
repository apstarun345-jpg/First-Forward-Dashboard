import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const pad = (n) => String(n).padStart(2, '0');
const U = {
  esc: (v) => String(v ?? ''),
  clean: (v) => String(v ?? '').trim(),
  dateKey: (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
  ymKey: (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
  fromDateKey: (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); },
  weekStart: (d) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; },
  labelDateKey: (k) => k,
  labelDate: (d) => d.toISOString().slice(0, 10),
  weekday: () => 'Mon', fmt: String, fmtPct: String, spinner: () => '', errorBox: () => '', $: () => null
};

test('range report: FF + GV agents/TLs aur VC4/VC20/VC5+ exact split', async () => {
  const daily = [
    { key: '2026-09-01', channel: 'First Forward', type: 'ISSUANCE', cls: 'VC4', group: 'VC4', n: 2 },
    { key: '2026-09-01', channel: 'First Forward', type: 'ISSUANCE', cls: 'VC20', group: 'VC20', n: 1 },
    { key: '2026-09-02', channel: 'First Forward', type: 'REPLACEMENT', cls: 'VC6', group: 'VC5+', n: 1 },
    { key: '2026-09-01', channel: 'GV Partner', type: 'ISSUANCE', cls: 'VC4', group: 'VC4', n: 99 }
  ];
  const gvRows = [
    { date: new Date(2026, 8, 1), group: 'VC4', status: 'Issuance', commission: 10, agentId: 'g1', agentName: 'GV One', tlName: 'GV TL' },
    { date: new Date(2026, 8, 1), group: 'VC20', status: 'Issuance', commission: 20, agentId: 'g1', agentName: 'GV One', tlName: 'GV TL' },
    { date: new Date(2026, 8, 2), group: 'VC5+', status: 'Replacement', commission: 30, agentId: 'g2', agentName: 'GV Two', tlName: 'GV TL' }
  ];
  const ffPeople = [
    { id: 'f1', name: 'FF One', tlName: 'FF TL', channel: 'First Forward', group: 'VC4', type: 'ISSUANCE', dateKey: '2026-09-01', n: 2 },
    { id: 'f1', name: 'FF One', tlName: 'FF TL', channel: 'First Forward', group: 'VC20', type: 'ISSUANCE', dateKey: '2026-09-01', n: 1 },
    { id: 'f2', name: 'FF Two', tlName: 'FF TL', channel: 'First Forward', group: 'VC5+', type: 'REPLACEMENT', dateKey: '2026-09-02', n: 1 },
    { id: 'x', name: 'EIR GV', tlName: 'X', channel: 'GV Partner', group: 'VC4', type: 'ISSUANCE', dateKey: '2026-09-01', n: 50 }
  ];
  let askedRange = null;
  const FF = {
    util: U,
    store: { need: async (key) => { assert.equal(key, 'daily'); return daily; } },
    gv: { enabled: () => true, need: async () => gvRows, rows: () => gvRows },
    model: { loadRangePeople: async (from, to) => { askedRange = [from, to]; return ffPeople; } },
    charts: {}, pages: {}, auth: {}, config: { brand: 'Test' }, xlsx: {}
  };
  const context = vm.createContext({ window: { FF }, FF, console, Date, Intl, setTimeout, clearTimeout });
  const src = await fs.readFile(new URL('../rangeReport.js', import.meta.url), 'utf8');
  vm.runInContext(src, context, { filename: 'rangeReport.js' });
  const R = await FF.pages.rangeReport.build({ from: '2026-09-01', to: '2026-09-02' });

  assert.deepEqual(askedRange, ['2026-09-01', '2026-09-02']);
  assert.deepEqual({ total: R.ff.total, vc4: R.ff.vc4, vc20: R.ff.vc20, vc5p: R.ff.vc5p, comm: R.ff.comm, replacement: R.ff.replacement },
    { total: 4, vc4: 2, vc20: 1, vc5p: 1, comm: 2, replacement: 1 });
  assert.deepEqual({ total: R.gv.total, vc4: R.gv.vc4, vc20: R.gv.vc20, vc5p: R.gv.vc5p, comm: R.gv.comm, replacement: R.gv.replacement },
    { total: 3, vc4: 1, vc20: 1, vc5p: 1, comm: 2, replacement: 1 });
  assert.equal(R.ffAgents.length, 2, 'First Forward agents bhi table me');
  assert.equal(R.gvAgents.length, 2, 'GV agents table me');
  assert.equal(R.ffTls[0].agents, 2, 'FF TL rollup unique agents');
  assert.equal(R.gvTls[0].agents, 2, 'GV TL rollup unique agents');
  assert.equal(R.ffAgents[0].vc20, 1);
  assert.equal(R.gvAgents[0].vc20, 1);
  assert.equal(R.issues.length, 0);
});

test('daily EIR channel split uses GV TL when legacy master ID is blank', async () => {
  let query = '';
  const date = new Date(2026, 8, 1);
  const data = {
    query: async (_sheet, tq) => {
      query = tq;
      return { rows: [
        [date, 'VC4', 'ISSUANCE', '', '', 'ApnaPayment Pvt. Ltd.', 3],
        [date, 'VC20', 'ISSUANCE', '', '', 'First Forward TL', 2]
      ] };
    },
    cellDate: (v) => v instanceof Date ? v : null,
    cellNumber: (v) => Number(v) || 0,
    cellText: (v) => String(v ?? '')
  };
  const FF = {
    util: U,
    data,
    config: {
      eir: { sheet: 'EIR', date: 'AA', cls: 'D', type: 'P', vrnType: 'Q', masterId: 'AU', tlName: 'BA', tagId: 'A', gvMasterId: '5845036', gvChannelTl: 'ApnaPayment Pvt. Ltd.' }
    }
  };
  const context = vm.createContext({ window: { FF }, FF, console, Date, Intl, Map, Set });
  const src = await fs.readFile(new URL('../model.js', import.meta.url), 'utf8');
  vm.runInContext(src, context, { filename: 'model.js' });
  const rows = await FF.model.loadDaily();

  assert.match(query, /AU, BA, count\(A\)/, 'daily grouped query TL column bhi leti hai');
  assert.equal(rows[0].channel, 'GV Partner');
  assert.equal(rows[1].channel, 'First Forward');
  assert.equal(rows[0].n, 3);
});
