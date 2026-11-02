import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
global.window = global;
global.document = { body: { classList: { add() {}, remove() {} }, appendChild() {} }, addEventListener() {} };
const U = { esc: (s) => String(s), clean: (s) => String(s == null ? '' : s).trim(), fmt: (n) => String(Math.round(Number(n) || 0)), sum: (a, f) => a.reduce((t, x) => t + f(x), 0), h: () => null };
global.FF = { util: U, config: { features: { suggestDays: 10 } },
  pages: { performance: { agents: () => [
    { name: 'A', agentId: '1', tlName: 'T1', curTotal: 50, lastTotal: 20, curVc4: 30, curBins: { VC20: 10, 'VC5+': 10 }, stockTotal: 5, avgTotal: 5, perfStatus: 'High Growth', growthNum: 150 },
    { name: 'B', agentId: '2', tlName: 'APS', tlExcluded: true, curTotal: 0, lastTotal: 40, curVc4: 0, stockTotal: 3, avgTotal: 0, perfStatus: 'Inactive' },
    { name: 'C', agentId: '3', tlName: 'APS', tlExcluded: true, curTotal: 20, lastTotal: 30, curVc4: 20, stockTotal: 0, avgTotal: 4, perfStatus: 'De-Growth', growthNum: -20 } ] } },
  gv: { get: () => [{ agentName: 'G1', agentId: 'g1', tlName: 'TL', curTotal: 9, lastTotal: 3, curVc4: 9, curByClass: { VC4: 9 }, stockTotal: 0, runrate: 1, agentPerf: '🚀 High Growth', growth: 100, directAgent: false }] } };
require(path.join(ROOT, 'smartQ.js'));
const Q = FF.smartQ;
test('suggest: sawaal type karte hi milte hain', () => {
  assert.ok(Q.suggest('inactive').some((x) => x.q === 'inactive|ff'));
  assert.ok(Q.suggest('inactive gv').every((x) => x.q.endsWith('|gv')));
  assert.ok(Q.suggest('top 20 vc4')[0].label.startsWith('Top 20') || Q.suggest('top 20 vc4')[0].qn === 20);
  assert.equal(Q.suggest('608116-039-0119730').length, 0);
  assert.equal(Q.suggest('rathod').length, 0);
});
test('answers: inactive / top / dispatch / direct', () => {
  assert.deepEqual(Q.answer('inactive|ff').rows.map((r) => r.name), ['B']);
  assert.deepEqual(Q.answer('top|all', 2).rows.map((r) => r.name), ['A', 'C']);
  assert.deepEqual(Q.answer('dispatchDirect|ff').rows.map((r) => r.name), ['C']);   // 4*10-0
  assert.equal(Q.answer('dispatchDirect|ff').rows[0].need, 40);
  assert.deepEqual(Q.answer('high|gv').rows.map((r) => r.name), ['G1']);
  assert.deepEqual(Q.answer('vc20|ff').rows.map((r) => r.name), ['A']);
  assert.equal(Q.answer('summary|all').rows[0].cur, 79);
});
