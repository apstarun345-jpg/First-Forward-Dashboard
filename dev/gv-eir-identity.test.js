import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
require(path.join(ROOT, 'config.js'));
require(path.join(ROOT, 'util.js'));
const FF = globalThis.FF;
const today = new Date();
const cell = (v) => ({ v });
const eirDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
const gvDaily = [
  eirDate, '4', 'ISSUANCE', 'NEW VRN', '5845036', 'GV Team', 3,
  'FF-AGENT-9', 'First Forward Alias', 'GV-AGENT-9', 'GV Agent Nine', 'TL-9'
].map(cell);
const gvMonthly = [
  'FF-AGENT-9', 'First Forward Alias', 'GV-AGENT-9', 'GV Agent Nine', 'TL-9', 'GV Team', '5845036',
  today.getFullYear(), today.getMonth(), 3
].map(cell);
const gvToday = [
  'FF-AGENT-9', 'First Forward Alias', 'GV-AGENT-9', 'GV Agent Nine', eirDate, '4', 'ISSUANCE', 'NEW VRN',
  '5845036', 'TL-9', 'GV Team', 3
].map(cell);
const text = (x) => x && x.v != null ? String(x.v) : '';
const number = (x) => x && x.v != null ? Number(x.v) : null;
FF.data = {
  query: async (_sheet, tq) => ({ rows: tq.includes('year(') ? [gvMonthly] : tq.includes("date '") ? [gvToday] : [gvDaily] }),
  cellText: text,
  cellNumber: number,
  cellDate: (x) => x && x.v instanceof Date ? x.v : null,
  lit: (x) => `"${String(x)}"`
};
require(path.join(ROOT, 'model.js'));

test('GV daily and agent datasets use GV IDs/names for GV REPORT joins', async () => {
  const [daily, agents, todayRows] = await Promise.all([
    FF.model.loadDaily(), FF.model.loadAgents(), FF.model.loadAgentDailyClass()
  ]);
  assert.equal(daily[0].channel, 'GV Partner');
  assert.equal(daily[0].agentId, 'GV-AGENT-9', 'GV ID wins over populated FF ID');
  assert.equal(daily[0].agentName, 'GV Agent Nine', 'GV display name wins over FF alias');
  assert.equal(agents[0].id, 'GV-AGENT-9');
  assert.equal(agents[0].name, 'GV Agent Nine');
  assert.equal(todayRows[0].agentId, 'GV-AGENT-9');
  assert.equal(todayRows[0].name, 'GV Agent Nine');
  assert.equal(todayRows[0].n, 3);
});
