import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FF = { util: { clean: (v) => String(v || '').trim(), growth: (current, previous) => previous ? ((current - previous) / previous) * 100 : null }, pages: {}, config: {} };
const sandbox = { window: { FF }, FF, console, Map, Set, URLSearchParams };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'agentSummary.js'), 'utf8'), sandbox, { filename: 'agentSummary.js' });

const people = [
  { kind: 'ff-agent', name: 'José Alvarez', id: 'FF-ID_1045', altIds: ['ALT/77'], mobile: '9876543210', tl: 'Ritu-Singh', tlId: 'TL/77', tlMobile: '9123456789', cur: 16, stock: 7 },
  { kind: 'ff-tl', name: 'Ritu Singh', id: 'TL/77', altIds: [], mobile: '9123456789', cur: 45, stock: 20 }
];

test('summary search normalizes accented/punctuated names and IDs', () => {
  assert.equal(FF.agentSummary.matchPeople(people, 'jose-alvarez')[0].name, 'José Alvarez');
  assert.equal(FF.agentSummary.matchPeople(people, 'FF ID 1045')[0].name, 'José Alvarez');
  assert.equal(FF.agentSummary.matchPeople(people, 'alt 77')[0].name, 'José Alvarez');
  assert.equal(FF.agentSummary.matchPeople(people, 'TL-77')[0].kind, 'ff-tl');
});

test('summary search resolves agent and TL mobile numbers with +91 prefix', () => {
  assert.equal(FF.agentSummary.matchPeople(people, '+91 98765 43210')[0].name, 'José Alvarez');
  assert.equal(FF.agentSummary.matchPeople(people, '9123456789')[0].kind, 'ff-tl');
});

test('summary top suggestions provide TLs and agents without a query and ranked matches with one', () => {
  const blank = FF.agentSummary.topSuggestions(people, '');
  assert.deepEqual(Array.from(blank, (p) => p.kind), ['ff-tl', 'ff-agent']);
  assert.equal(FF.agentSummary.topSuggestions(people, 'jose')[0].name, 'José Alvarez');
});

test('summary TL suggestions use composed TL-own plus agent stock from the quick profile', async () => {
  const prior = { masterProfile: FF.masterProfile, store: FF.store, pages: FF.pages };
  const agents = [
    { name: 'Agent One', agentId: 'A1', tlName: 'Team One', tlId: 'T1', curTotal: 10, lastTotal: 6, stockTotal: 5, tlStockTotal: 10 },
    { name: 'Agent Two', agentId: 'A2', tlName: 'Team One', tlId: 'T1', curTotal: 8, lastTotal: 3, stockTotal: 5, tlStockTotal: 10 }
  ];
  FF.masterProfile = {
    loadFor: async () => {},
    quick: (p) => p.kind === 'ff-tl' ? { stock: { total: 13 } } : null
  };
  FF.pages = { performance: { ensureLoaded: async () => {}, agents: () => agents } };
  FF.store = { need: async () => [], get: () => [] };
  try {
    const list = await FF.agentSummary.loadPeople('ff');
    const tl = list.find((p) => p.kind === 'ff-tl' && p.name === 'Team One');
    assert.ok(tl);
    assert.equal(tl.stock, 13, 'TL quick profile total should beat the agent-only snapshot sum');
  } finally {
    FF.masterProfile = prior.masterProfile;
    FF.store = prior.store;
    FF.pages = prior.pages;
  }
});

test('summary CSV keeps the human channel label instead of replacing it with the internal source key', async () => {
  const prior = FF.masterProfile;
  FF.masterProfile = {
    build: async () => ({
      channel: 'First Forward', kind: 'ff-agent', name: 'José Alvarez', id: 'FF-ID_1045',
      totals: { curTotal: 1, lastTotal: 0 }, stock: { vc4: 0, comm: 0, total: 0 },
      months: { cur: '2026-10', last: '2026-09' }, classes: [], agents: [],
      calc: { total: { rate: 1 } }, projT1: { total: 1 }
    }),
    csvRows: (profile) => [['Name', profile.name], ['Type', `${profile.channel} Agent`]]
  };
  try {
    const report = await FF.agentSummary.buildReport({ kind: 'ff-agent', name: 'José Alvarez', id: 'FF-ID_1045' });
    assert.equal(report.p.channel, 'First Forward');
    assert.equal(FF.agentSummary.reportCsv(report)[1][1], 'First Forward Agent');
  } finally {
    FF.masterProfile = prior;
  }
});
