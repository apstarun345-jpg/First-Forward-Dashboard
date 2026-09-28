import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dateKey = (value) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const shift = (value, days) => { const d = new Date(value); d.setDate(d.getDate() + days); return d; };
function loadInsights() {
  const clean = (value) => String(value ?? '').trim();
  const context = { console, Date, Math, Number, String, Array, Object, Map, Set, Promise, Intl, window: null,
    FF: { pages: {}, util: { clean, esc: clean, dateKey, fmt: String, stamp: () => 'test' }, data: {}, store: {}, gv: {}, model: {}, charts: {}, config: {} } };
  context.window = context;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'insights.js'), 'utf8'), vm.createContext(context), { filename: 'insights.js' });
  return context.FF.insights;
}

test('stock balance applies real movements and separates forecast error from unexplained variance', () => {
  const latest = new Date(2026, 0, 31), opening = shift(latest, -7);
  const rows = [];
  for (let offset = -20; offset <= -7; offset++) rows.push({ date: shift(latest, offset), dateKey: dateKey(shift(latest, offset)), n: 10, channel: 'First Forward' });
  for (let offset = -6; offset <= 0; offset++) rows.push({ date: shift(latest, offset), dateKey: dateKey(shift(latest, offset)), n: 12, channel: 'First Forward' });
  const history = { ff: rows, gv: [] };
  const points = [
    { date: dateKey(opening), ff: { total: 1000, vc4: 800, comm: 200 } },
    { date: dateKey(latest), ff: { total: 996, vc4: 790, comm: 206 } }
  ];
  const movements = { configured: true, rows: [
    { date: shift(latest, -5), channel: 'First Forward', type: 'IN', quantity: 100, impact: 100 },
    { date: shift(latest, -3), channel: 'First Forward', type: 'OUT', quantity: 20, impact: -20 },
    { date: shift(latest, -2), channel: 'First Forward', type: 'TRANSFER', quantity: 50, impact: 0 }
  ], invalid: [] };
  const out = loadInsights().stockBalanceReconciliation(history, points, movements, 7, 14);
  const ff = out.ff;
  assert.equal(ff.ok, true);
  assert.equal(ff.intervalDays, 7);
  assert.equal(ff.openingStock, 1000);
  assert.equal(ff.predictedConsumption, 70);
  assert.equal(ff.actualConsumption, 84);
  assert.equal(ff.movementIn, 100);
  assert.equal(ff.movementOut, 20);
  assert.equal(ff.internalTransfer, 50);
  assert.equal(ff.netMovement, 80);
  assert.equal(ff.impliedNetMovement, 80);
  assert.equal(ff.expectedClosingFromActual, 996);
  assert.equal(ff.unexplainedVariance, 0);
  assert.equal(ff.projectedClosing, 1010);
  assert.equal(ff.closingError, 14);
  assert.ok(Math.abs(ff.closingAccuracy - (100 - 14 / 996 * 100)) < 1e-9);
  assert.equal(out.combined.actualClosing, 996);
});

test('without a ledger, implied movement stays disclosed as unexplained instead of fabricated inward', () => {
  const latest = new Date(2026, 0, 31), opening = shift(latest, -7);
  const rows = [];
  for (let offset = -20; offset <= -7; offset++) rows.push({ date: shift(latest, offset), n: 10, channel: 'First Forward' });
  for (let offset = -6; offset <= 0; offset++) rows.push({ date: shift(latest, offset), n: 12, channel: 'First Forward' });
  const out = loadInsights().stockBalanceReconciliation({ ff: rows, gv: [] }, [
    { date: dateKey(opening), total: 1000, vc4: 800, comm: 200 },
    { date: dateKey(latest), total: 996, vc4: 790, comm: 206 }
  ], { configured: false, rows: [], invalid: [] }, 7, 14).ff;
  assert.equal(out.ok, true);
  assert.equal(out.ledgerConfigured, false);
  assert.equal(out.netMovement, 0);
  assert.equal(out.impliedNetMovement, 80);
  assert.equal(out.unexplainedVariance, 80);
  assert.equal(out.projectedClosing, 930);
  assert.equal(out.closingError, -66);
});
