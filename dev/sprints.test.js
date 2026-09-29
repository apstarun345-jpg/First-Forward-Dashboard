/* Hourly Sprints: date + identity matching and clickable today performer class breakdowns. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
const clean = (v) => String(v === null || v === undefined ? '' : v).trim();
const escape = (v) => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = dateKey(new Date());
const ffRows = [
  { agentId: 'FF-1', id: 'FF-1', agentName: 'Same Person', name: 'Same Person', dateKey: today, channel: 'First Forward', cls: 'VC4', type: 'ISSUANCE', vrnType: 'New Tag', n: 2 },
  { agentId: 'FF-1', id: 'FF-1', agentName: 'Same Person', name: 'Same Person', dateKey: today, channel: 'First Forward', cls: 'VC5', type: 'REPLACEMENT', vrnType: 'Replacement Tag', n: 1 },
  { agentId: 'FF-2', id: 'FF-2', agentName: 'Same Person', name: 'Same Person', dateKey: today, channel: 'First Forward', cls: 'VC6', type: 'ISSUANCE', vrnType: 'New Tag', n: 8 },
  { agentId: 'FF-3', id: 'FF-3', agentName: 'Old Day', name: 'Old Day', dateKey: '2001-01-01', channel: 'First Forward', cls: 'VC4', type: 'ISSUANCE', vrnType: 'New Tag', n: 20 }
];
const gvRows = [
  { date: new Date(), agentId: 'GV-1', agentName: 'GV Person', tlName: 'GV TL', cls: 'VC4', status: 'Active', tagType: 'NEW', time: '09:15:00' },
  { date: new Date(), agentId: 'GV-1', agentName: 'GV Person', tlName: 'GV TL', cls: 'VC20', status: 'Replacement', tagType: 'REPLACEMENT', time: '09:35:00' }
];
let opened = null;
const U = { clean, esc: escape, fmt: (v) => String(v), dateKey, spinner: () => '', errorBox: () => '' };
globalThis.FF = {
  util: U,
  gv: { rows: () => gvRows, need: async () => gvRows },
  store: { get: (k) => k === 'agentDailyClass' ? ffRows : k === 'daily' ? [] : [] , need: async () => [] },
  config: { isDirectAgent: (r) => !!r.directAgent, directLabel: () => 'Direct Agent' },
  charts: { bars: () => '<svg></svg>', mount: () => {} },
  app: { openDrawer: (value) => { opened = value; } },
  pages: {}
};
require(path.join(ROOT, 'sprints.js'));
const Sprint = globalThis.FF.sprints;

test('top performers group by source ID and current date rows only', () => {
  const top = Sprint.topAgentsForToday(ffRows.filter((r) => r.dateKey === today));
  assert.deepEqual(top.map((r) => [r.agentId, r.agentName, r.n]), [['FF-2', 'Same Person', 8], ['FF-1', 'Same Person', 3]]);
  assert.equal(Sprint.hourOf('12:53:56'), 12);
  assert.equal(Sprint.hourOf('12:05 am'), 0);
  assert.equal(Sprint.hourOf('12:05 pm'), 12);
});

test('FF class drill-down uses ID as authoritative when duplicate names exist', () => {
  Sprint.openTodayAgent('ff', 'FF-1', 'Same Person');
  assert.equal(opened.title, 'Same Person');
  assert.match(opened.sub, /3 total tags/);
  assert.match(opened.body, /VC4/);
  assert.match(opened.body, /VC5/);
  assert.doesNotMatch(opened.body, /VC6/);
  assert.match(opened.body, /Replacement Tag/);
  assert.match(opened.body, /<b>2<\/b>/);
});

test('GV class drill-down uses today GV master rows and separates classes', () => {
  Sprint.openTodayAgent('gv', 'GV-1', 'GV Person');
  assert.match(opened.kicker, /GV PARTNER/);
  assert.match(opened.sub, /2 total tags/);
  assert.match(opened.body, /VC4/);
  assert.match(opened.body, /VC20/);
  assert.match(opened.body, /REPLACEMENT/);
});

test('Today top-performer rows render as keyboard-accessible clickable drill-downs', () => {
  const d = {
    nowH: 9, today, hourTotal: 0, totalToday: gvRows.length, withTime: gvRows.length,
    todayGvTop: Sprint.topAgentsForToday(gvRows), todayFfTop: Sprint.topAgentsForToday(ffRows.filter((r) => r.dateKey === today)),
    tlNow: [], agentNow: [], past: [], byHour: new Array(24).fill(0)
  };
  const listeners = {};
  const root = { innerHTML: '', dataset: {}, querySelector: () => null, contains: () => true, addEventListener: (type, fn) => { listeners[type] = fn; } };
  Sprint.renderBars(root, d);
  assert.match(root.innerHTML, /data-sprint-channel="ff"/);
  assert.match(root.innerHTML, /data-sprint-id="FF-2"/);
  assert.match(root.innerHTML, /role="button" tabindex="0"/);
  const clicked = { dataset: { sprintChannel: 'ff', sprintId: 'FF-1', sprintAgent: 'Same Person' } };
  listeners.click({ target: { closest: () => clicked } });
  assert.match(opened.body, /VC5/);
});
