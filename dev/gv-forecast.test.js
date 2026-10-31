/* v3.125.27 — GV Expected Today forecast (weekday × level + intraday pace + backtest). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.location = { hash: '#/home', href: '' };
globalThis.document = { documentElement: { dataset: {}, style: { setProperty() {} } }, hidden: false, body: { appendChild() {}, classList: { add() {}, remove() {} } }, addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, classList: { add() {} }, setAttribute() {}, appendChild() {}, addEventListener() {} }), querySelector: () => null, querySelectorAll: () => [], getElementById: () => null };
['config', 'util', 'data', 'model'].forEach((f) => require(path.join(ROOT, `${f}.js`)));
const M = globalThis.FF.model;

// Deterministic PRNG
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const WD = [0.45, 1.1, 1.05, 1.0, 1.0, 1.05, 1.15];   // Sun low
// Intraday: tags between 07:00 and 21:00, peak midday (triangular-ish)
const drawMin = () => { const a = rnd(), b = rnd(); return Math.round(420 + ((a + b) / 2) * 840); };
function makeHistory(days, endKey, level) {
  const rows = []; const end = new Date(`${endKey}T00:00:00Z`);
  for (let i = days; i >= 1; i--) {
    const d = new Date(end); d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const n = Math.round(level * WD[d.getUTCDay()] * (0.9 + rnd() * 0.2));
    for (let j = 0; j < n; j++) rows.push({ key, mins: drawMin() });
  }
  return rows;
}

test('timeToMins parses 24h and AM/PM', () => {
  assert.equal(M.timeToMins('18:28:20'), 1108);
  assert.equal(M.timeToMins('7:07:42'), 427);
  assert.equal(M.timeToMins('6:28 PM'), 1108);
  assert.equal(M.timeToMins('12:05 AM'), 5);
  assert.equal(M.timeToMins(''), null);
});

test('forecast lands close to the real day total, using the sheet cut-off time', () => {
  const todayKey = '2026-10-31';   // Saturday
  const hist = makeHistory(60, todayKey, 500);
  // Today's true total and rows up to 18:28 (sheet lag)
  const trueTotal = Math.round(500 * WD[6]);
  const mins = Array.from({ length: trueTotal }, drawMin).sort((a, b) => a - b);
  const sofar = mins.filter((m) => m <= 1108);
  sofar.forEach((m) => hist.push({ key: todayKey, mins: m }));
  const f = M.gvDayForecast(hist, todayKey, {});
  assert.ok(f, 'forecast');
  assert.equal(f.cutoffMins, sofar[sofar.length - 1]);
  assert.equal(f.soFar, sofar.length);
  const err = Math.abs(f.expected - trueTotal) / trueTotal;
  console.log('FC', JSON.stringify({ exp: f.expected, trueTotal, soFar: f.soFar, base: f.base, intraday: f.intraday, frac: +f.frac.toFixed(3), acc: +f.accuracy.toFixed(1), low: f.low, high: f.high }));
  assert.ok(err < 0.06, `error ${(err * 100).toFixed(1)}% (exp ${f.expected} vs ${trueTotal})`);
  assert.ok(f.accuracy > 90, `backtest accuracy ${f.accuracy}`);
  assert.ok(f.low <= f.expected && f.high >= f.expected);
  assert.ok(f.expected >= f.soFar);
});

test('early morning (no rows yet) → base from weekday × level', () => {
  const todayKey = '2026-11-01';   // Sunday (low day)
  const hist = makeHistory(60, todayKey, 500);
  const f = M.gvDayForecast(hist, todayKey, { cutoffMins: 360 });
  const want = 500 * WD[0];
  assert.ok(Math.abs(f.expected - want) / want < 0.12, `sunday base ${f.expected} vs ${want}`);
});

test('home wires the forecast into Expected Today', () => {
  const fs = require('node:fs');
  const home = fs.readFileSync(path.join(ROOT, 'home.js'), 'utf8');
  assert.match(home, /function gvForecastNow\(liveTotal\)/);
  assert.match(home, /M\.gvDayForecast\(hist, tk, \{ liveTotal, cutoffMins \}\)/);
  assert.match(home, /function forecastSub\(f\)/);
});
