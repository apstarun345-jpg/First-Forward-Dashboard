import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pad2 = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const prevMonthKey = (ym) => {
  const [year, month] = String(ym).split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 2, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
};
const daysInMonth = (ym) => {
  const [year, month] = String(ym).split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
};
const makeDashboard = (queryImpl) => {
  const FF = {
    util: {
      clean: (v) => String(v || '').trim(),
      dateKey,
      fromDateKey: (key) => key ? new Date(`${key}T00:00:00Z`) : null,
      prevMonthKey,
      daysInMonth,
      pad2,
      labelDateKey: (key) => key,
      labelYM: (key) => key,
      fmt: (v) => Number(v || 0).toLocaleString('en-IN'),
      sum: (rows, fn) => (rows || []).reduce((total, row) => total + Number(fn(row) || 0), 0),
      uniq: (rows) => [...new Set(rows)]
    },
    store: {}, gv: { rows: () => [] }, charts: {}, pages: {},
    config: { eir: { sheet: 'EIR', date: 'AA', tagId: 'A', vrn: 'B', cls: 'D', vrnType: 'BC', agentName: 'L', agentId: 'J', tlName: 'BA', masterId: 'AU', gvName: 'AX', gvId: 'AW' } },
    model: { channelOf: () => 'First Forward' },
    data: {
      cellDate: (v) => v instanceof Date ? v : (v ? new Date(`${v}T00:00:00Z`) : null),
      cellText: (v) => v == null ? '' : String(v),
      query: queryImpl
    }
  };
  const sandbox = { window: { FF }, FF, console, Map, Set, Date, Promise };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'unusual.js'), 'utf8'), sandbox, { filename: 'unusual.js' });
  return FF;
};

const row = (id) => [new Date('2026-09-01T00:00:00Z'), `tag-${id}`, `RJ14CA${String(id).padStart(4, '0')}`, 'VC4', 'Regular', 'Agent One', 'A1', 'TL One', '', '', ''];

 test('Unusual Activity advances EIR Gviz offsets and indexes distinct pages', async () => {
  const offsets = [];
  const FF = makeDashboard(async (_sheet, query) => {
    const limit = Number(query.match(/\blimit\s+(\d+)/i)[1]);
    const offset = Number(query.match(/\boffset\s+(\d+)/i)[1]);
    offsets.push(offset);
    const start = Math.min(offset, 25000);
    const total = 25001;
    return { rows: Array.from({ length: Math.max(0, Math.min(limit, total - start)) }, (_, i) => row(start + i + 1)) };
  });
  const records = await FF.unusual.loadVrnRecords('2026-09-01', '2026-09-30');
  assert.deepEqual(offsets, [0, 25000]);
  assert.equal(records.length, 25001);
  assert.equal(FF.unusual.vrnFetchInfo.offsetVerified, true);
  assert.equal(FF.unusual.vrnFetchInfo.rowsRead, 25001);
});

test('Unusual Activity stops and records an offset paging warning when Gviz repeats page one', async () => {
  const FF = makeDashboard(async (_sheet, query) => {
    const limit = Number(query.match(/\blimit\s+(\d+)/i)[1]);
    return { rows: Array.from({ length: limit }, (_, i) => row(i + 1)) };
  });
  const records = await FF.unusual.loadVrnRecords('2026-09-01', '2026-09-30');
  assert.equal(records.length, 25000);
  assert.equal(FF.unusual.vrnFetchInfo.offsetIssue, true);
  assert.equal(FF.unusual.vrnFetchInfo.complete, false);
});

test('Unusual Activity keeps empty non-chassis VRNs in the tag-level index for invalid-VRN analysis', async () => {
  let queryText = '';
  const FF = makeDashboard(async (_sheet, query) => {
    queryText = query;
    return { rows: [[new Date('2026-09-03T00:00:00Z'), 'tag-empty', '', 'VC4', 'New', 'Agent One', 'A1', 'TL One', '', '', '']] };
  });
  const records = await FF.unusual.loadVrnRecords('2026-09-03', '2026-09-03');
  assert.equal(records.length, 1);
  assert.equal(records[0].vrn, '');
  assert.doesNotMatch(queryText, /is not null/i, 'the EIR query must include blank VRN rows');
});

test('Unusual Activity resolves calendar presets from the supplied date', () => {
  const FF = makeDashboard(async () => ({ rows: [] }));
  const today = FF.unusual.resolveRange([], { period: 'today', today: '2026-10-01' });
  assert.deepEqual([today.from, today.to, today.label], ['2026-10-01', '2026-10-01', 'Today (2026-10-01)']);
  const yesterday = FF.unusual.resolveRange([], { period: 'yesterday', today: '2026-10-01' });
  assert.deepEqual([yesterday.from, yesterday.to, yesterday.label], ['2026-09-30', '2026-09-30', 'Yesterday (2026-09-30)']);
  const lastMonth = FF.unusual.resolveRange([], { period: 'last', today: '2026-10-01' });
  assert.deepEqual([lastMonth.from, lastMonth.to, lastMonth.label], ['2026-09-01', '2026-09-30', 'Last Month (2026-09)']);
});

test('Unusual Activity treats an empty non-chassis VRN as invalid but exempts explicit chassis rows', () => {
  const FF = makeDashboard(async () => ({ rows: [] }));
  const daily = [
    { key: '2026-09-03', channel: 'First Forward', agentId: 'A1', agentName: 'Blank VRN Agent', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 10 },
    { key: '2026-09-03', channel: 'First Forward', agentId: 'A2', agentName: 'Peer Agent', tlName: 'TL Two', cls: 'VC4', group: 'VC4', n: 100 }
  ];
  const vrnRecords = [
    { ch: 'ff', key: '2026-09-03', tagId: 'blank-1', vrn: '', vrnType: 'New', agentId: 'A1', agentName: 'Blank VRN Agent', tlName: 'TL One' },
    { ch: 'ff', key: '2026-09-03', tagId: 'chassis-1', vrn: '', vrnType: 'Chassis', agentId: 'A1', agentName: 'Blank VRN Agent', tlName: 'TL One' }
  ];
  const model = FF.unusual.analyze(daily, { period: 'custom', from: '2026-09-03', to: '2026-09-03', min: 1, vrnRecords });
  const agent = model.rows.find((r) => r.id === 'A1');
  assert.equal(agent.invalidVrn, 1);
  assert.equal(agent.wrong, 1);
  assert.equal(agent.invalidList[0].vrn, '');
});

test('Unusual Activity flags wrong, malformed, replacement, chassis and duplicate VRNs without double-counting malformed wrong tags', () => {
  const FF = makeDashboard(async () => ({ rows: [] }));
  const daily = [
    { key: '2026-09-03', channel: 'First Forward', agentId: 'A1', agentName: 'Flagged Agent', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 9 },
    { key: '2026-09-03', channel: 'First Forward', agentId: 'A1', agentName: 'Flagged Agent', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 3, vrnType: 'Wrong VRN' },
    { key: '2026-09-03', channel: 'First Forward', agentId: 'A1', agentName: 'Flagged Agent', tlName: 'TL One', cls: 'VC4', group: 'VC4', n: 4, type: 'REPLACEMENT' },
    { key: '2026-09-03', channel: 'First Forward', agentId: 'A1', agentName: 'Flagged Agent', tlName: 'TL One', cls: 'VC20', group: 'VC20', n: 4, vrnType: 'Chassis' },
    { key: '2026-09-03', channel: 'First Forward', agentId: 'A2', agentName: 'Peer Agent', tlName: 'TL Two', cls: 'VC4', group: 'VC4', n: 100 }
  ];
  const vrnRecords = [
    ...[1, 2, 3].map((id) => ({ ch: 'ff', key: '2026-09-03', tagId: `wrong-${id}`, vrn: `BAD${id}`, vrnType: 'Wrong VRN', agentId: 'A1', agentName: 'Flagged Agent', tlName: 'TL One' })),
    { ch: 'ff', key: '2026-09-03', tagId: 'dup-1', vrn: 'RJ14AB1234', vrnType: 'New', agentId: 'A1', agentName: 'Flagged Agent', tlName: 'TL One' },
    { ch: 'ff', key: '2026-09-03', tagId: 'dup-2', vrn: 'RJ14AB1234', vrnType: 'New', agentId: 'A2', agentName: 'Peer Agent', tlName: 'TL Two' },
    { ch: 'ff', key: '2026-09-03', tagId: 'placeholder-1', vrn: '000000', vrnType: 'New', agentId: 'A1', agentName: 'Flagged Agent', tlName: 'TL One' },
    { ch: 'ff', key: '2026-09-03', tagId: 'placeholder-2', vrn: '000000', vrnType: 'New', agentId: 'A2', agentName: 'Peer Agent', tlName: 'TL Two' }
  ];
  const model = FF.unusual.analyze(daily, { ch: 'all', period: 'custom', from: '2026-09-03', to: '2026-09-03', min: 3, mult: 2, vrnRecords });
  const agent = model.rows.find((r) => r.id === 'A1');
  assert.equal(agent.wrongType, 3);
  assert.equal(agent.wrong, 4, 'EIR aggregate and tag-level Wrong VRN marks are deduplicated; the extra invalid placeholder is counted once');
  assert.equal(agent.invalidVrn, 4);
  assert.equal(agent.replace, 4);
  assert.equal(agent.chassis, 4);
  assert.ok(['wrong', 'replace', 'chassis', 'double', 'multi'].every((flag) => agent.flags.includes(flag)));
  assert.equal(model.duplicateVrns.length, 1, 'malformed repeated placeholders are not presented as duplicate vehicles');
  assert.equal(model.duplicateVrns[0].vrn, 'RJ14AB1234');
  assert.equal(model.totals.wrongTot, 5, 'three wrong tags plus two malformed tags across the flagged and peer agents');
  assert.equal(model.totals.invalidTot, 5);
});
