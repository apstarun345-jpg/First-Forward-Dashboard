import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await fs.readFile(path.join(ROOT, 'insights.js'), 'utf8');

function load(config = {}) {
  const app = {
    config: {
      gvCommissionRates: {
        enabled: true,
        classes: {
          VC4: { source: 'master', rate: '' },
          VC20: { source: 'manual', rate: '' },
          VC5: { source: 'manual', rate: '' },
          VC6: { source: 'manual', rate: '' },
          VC7: { source: 'manual', rate: '' },
          VC12: { source: 'manual', rate: '' }
        },
        ...config
      },
      isDirectAgent: (row) => row.directAgent === true
    },
    pages: {},
    gv: { normClass: (raw) => { const s = String(raw ?? '').toUpperCase().replace(/\s+/g, ''); return /^\d+$/.test(s) ? `VC${s}` : s; } },
    util: {
      clean: (v) => String(v ?? '').replace(/\s+/g, ' ').trim(),
      ymKey: (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      esc: (v) => String(v ?? ''),
      fmt: (v) => String(v ?? ''),
      colLetter: (i) => String(i),
      colIndex: () => 0,
      dateKey: (v) => v instanceof Date ? v.toISOString().slice(0, 10) : String(v),
      parseDate: () => null,
      labelYM: (v) => String(v),
      labelDate: (v) => String(v),
      labelDateKey: (v) => String(v),
      fromDateKey: (v) => v,
      ymParts: () => [],
      U: undefined
    },
    data: {},
    store: {},
    charts: {}
  };
  vm.runInNewContext(source, { window: { FF: app }, FF: app, console, Date, Map, Set, Promise, Intl, Math, Number, String, Object, Array, RegExp });
  return app.insights;
}

const rows = [
  // Current month rows for A: VC4 comes directly from the same agent ID + class.
  { ym: '2026-09', agentId: 'A-1', agentName: 'Agent A', tlName: 'TL 1', cls: '4', commission: 2.5, commissionHasValue: true },
  { ym: '2026-09', agentId: 'A-1', agentName: 'Agent A', tlName: 'TL 1', cls: 'VC4', commission: 2.5, commissionHasValue: true },
  // Explicit blank source cell is not a real zero-rate commission value.
  { ym: '2026-09', agentId: 'A-1', agentName: 'Agent A', tlName: 'TL 1', cls: 'VC4', commission: 0, commissionHasValue: false },
  // Manual class is not changed until an admin sets its rate.
  { ym: '2026-09', agentId: 'A-1', agentName: 'Agent A', tlName: 'TL 1', cls: '5', commission: 99, commissionHasValue: true },
  // B has a different ID but the same name: it must stay a separate person.
  { ym: '2026-09', agentId: 'B-1', agentName: 'Agent A', tlName: 'TL 2', cls: '4', commission: 4, commissionHasValue: true },
  // Mixed source rates are shown as an exact sum, never averaged.
  { ym: '2026-09', agentId: 'C-1', agentName: 'Agent C', tlName: 'TL 2', cls: '4', commission: 1, commissionHasValue: true },
  { ym: '2026-09', agentId: 'C-1', agentName: 'Agent C', tlName: 'TL 2', cls: '4', commission: 3, commissionHasValue: true },
  // Previous month must not leak into current-month payout.
  { ym: '2026-08', agentId: 'A-1', agentName: 'Agent A', tlName: 'TL 1', cls: '4', commission: 100, commissionHasValue: true }
];

test('GV personal commission: current month, exact agent ID + class, VC4 master source', () => {
  const build = load().gvPersonalCommissionFromRows;
  const out = build(rows, '2026-09');
  assert.equal(out.agents.length, 3);
  const a = out.byId.get('A1');
  assert.equal(a.classes.VC4.tags, 3);
  assert.equal(a.classes.VC4.rate, 2.5);
  assert.equal(a.classes.VC4.personalCommission, 5, 'blank source row does not add a guessed zero payout');
  assert.equal(a.classes.VC4.source, 'GV Master · exact row rate');
  assert.equal(a.classes.VC5.personalCommission, null, 'blank manual setting unresolved, sheet value is not silently substituted');
  assert.equal(a.classes.VC5.sheetCommission, 99, 'source value stays visible for audit');
  assert.equal(out.byId.get('B1').classes.VC4.personalCommission, 4, 'same name does not merge different agent IDs');
  assert.equal(out.byId.get('A1').classes.VC4.sheetCommission, 5, 'previous month and blank row did not leak');
});

test('GV add-ons: daily trend, TL summary and agent payout ranking stay source-aware', () => {
  const insights = load({ classes: { VC5: { source: 'manual', rate: 7 } } });
  const out = insights.gvPersonalCommissionFromRows(rows, '2026-09');
  const tl = insights.gvCommissionTlSummary(out.agents);
  const tl1 = tl.find((r) => r.label === 'TL 1');
  assert.equal(tl1.tags, 4);
  assert.equal(tl1.personalCommission, 12, 'VC4 exact 5 + one configured VC5 tag × ₹7');
  assert.equal(tl1.coveragePct, 75, 'blank GV Master source row lowers coverage without changing exact paid total');
  const ranking = insights.gvCommissionAgentRanking(out.agents);
  assert.equal(ranking[0].agentId, 'A-1');
  assert.equal(ranking[0].personalCommission, 12);
  const trendRows = [
    { date: new Date('2026-09-01T10:00:00'), agentId: 'A-1', agentName: 'Agent A', cls: 'VC4', commission: 2.5, commissionHasValue: true },
    { date: new Date('2026-09-01T11:00:00'), agentId: 'A-1', agentName: 'Agent A', cls: 'VC5', commission: 99, commissionHasValue: true },
    { date: new Date('2026-09-02T10:00:00'), agentId: 'B-1', agentName: 'Agent B', cls: 'VC4', commission: 4, commissionHasValue: true }
  ];
  const trend = insights.gvCommissionDailyTrend(trendRows, out.settings);
  assert.equal(trend.days.length, 2);
  assert.equal(trend.days[0].sheetCommission, 101.5);
  assert.equal(trend.days[0].personalCommission, 9.5, 'daily configured line keeps manual rate separate from sheet amount');
  assert.equal(trend.days[0].unresolvedRows, 0);
});

test('GV personal commission: manual class setting and mixed GV Master rates remain explicit', () => {
  const build = load({ classes: { VC5: { source: 'manual', rate: 7 } } }).gvPersonalCommissionFromRows;
  const out = build(rows, '2026-09');
  const a = out.byId.get('A1');
  assert.equal(a.classes.VC5.personalCommission, 7, 'one VC5 tag × configured manual rate');
  assert.equal(a.classes.VC5.rate, 7);
  const c = out.byId.get('C1');
  assert.equal(c.classes.VC4.rate, null, 'mixed rates are not averaged');
  assert.equal(c.classes.VC4.personalCommission, 4, 'mixed rows retain exact sheet sum');
  assert.match(c.classes.VC4.status, /Mixed rates/);
});
