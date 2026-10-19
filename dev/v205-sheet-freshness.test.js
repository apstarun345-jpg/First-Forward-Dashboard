/* v205 — Home "Sheets last data update": poore column ka latest date + stale alert banner. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.document = { documentElement: { dataset: {}, style: { setProperty() {} } }, title: '', hidden: false, body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {} } }, addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, classList: { add() {} }, setAttribute() {}, appendChild() {}, addEventListener() {} }), querySelector: () => null, querySelectorAll: () => [], getElementById: () => null };
['config', 'util', 'model', 'gv', 'store', 'charts'].forEach((f) => require(path.join(ROOT, `${f}.js`)));
FF.auth = { can: () => true, user: { username: 't' }, settings: {} };
require(path.join(ROOT, 'home.js'));
const F = FF.homeFreshness;

const at = (hoursAgo, hasTime = true) => ({ d: new Date(Date.now() - hoursAgo * 3600e3), hasTime });
const day = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return { d, hasTime: false }; };

test('mergeList: server last-row aur column MAX me se LATER value jeet-ti hai', () => {
  const server = [{ key: 'ff-eir', tab: 'EIR', title: 'First Forward', icon: '🟦', exact: true, rowTime: day(3), value: day(3), file: { updated: day(0) }, lastRow: 100 }];
  const g = [{ key: 'ff-eir', tab: 'EIR', title: 'First Forward', value: day(1) }, { key: 'ff-stock', tab: 'StockDataa', title: 'First Forward', value: at(2) }];
  const out = F.mergeList(server, g, '');
  const eir = out.find((r) => r.key === 'ff-eir');
  assert.equal(eir.value, g[0].value, 'column max (1 din pehle) last-row (3 din pehle) se naya');
  assert.equal(eir.colMax, true);
  assert.equal(eir.exact, true, 'server ka extra data (last row / file edit) bacha rehta hai');
  const stock = out.find((r) => r.key === 'ff-stock');
  assert.ok(stock.value && stock.approx, 'server na ho to bhi gviz value dikhti hai');
  assert.equal(out.length, 4);
  // server naya ho to server hi
  const newer = F.mergeList([{ ...server[0], rowTime: at(1) }], g, '').find((r) => r.key === 'ff-eir');
  assert.equal(newer.value, newer.rowTime);
  assert.equal(newer.colMax, false);
});

test('isStaleVal: date-only kal tak theek, 2+ din purana stale; time wali 24h+ stale', () => {
  assert.equal(F.isStaleVal(day(0)), false);
  assert.equal(F.isStaleVal(day(1)), false);
  assert.equal(F.isStaleVal(day(2)), true);
  assert.equal(F.isStaleVal(at(5)), false);
  assert.equal(F.isStaleVal(at(23)), false);
  assert.equal(F.isStaleVal(at(26)), true);
  assert.equal(F.isStaleVal(null), false);
});

test('alertHtml: sirf stale sheets, dismiss 3 ghante tak chhupata hai, naya stale data dobara dikhata hai', () => {
  ls.clear();
  const list = [
    { key: 'ff-eir', icon: '🟦', tab: 'EIR', title: 'First Forward', value: day(4) },
    { key: 'ff-stock', icon: '🟦', tab: 'StockDataa', title: 'First Forward', value: at(1) },
    { key: 'gv-master', icon: '🟩', tab: 'GV Master', title: 'GV Partner', value: at(30) },
    { key: 'gv-assign', icon: '🟩', tab: 'Tag Assignment', title: 'GV Partner', value: null }
  ];
  const html = F.alertHtml(list);
  assert.match(html, /fresh-alert/);
  assert.match(html, /EIR/); assert.match(html, /GV Master/);
  assert.doesNotMatch(html, /StockDataa/, 'taaza sheet alert me nahi');
  assert.doesNotMatch(html, /Tag Assignment/, 'value na mile (check fail) to "stale" nahi maana');
  assert.equal(F.alertHtml([{ key: 'a', icon: '', tab: 'A', title: '', value: at(1) }]), '');
  // dismiss
  const sig = /data-fresh-sig="([^"]*)"/.exec(html)[1];
  ls.set('ff_fresh_alert_dismiss', JSON.stringify({ sig: sig.replace(/&#39;/g, "'"), at: Date.now() }));
  assert.equal(F.alertHtml(list), '', 'dismiss ke baad 3 ghante tak nahi');
  ls.set('ff_fresh_alert_dismiss', JSON.stringify({ sig: 'old', at: Date.now() }));
  assert.match(F.alertHtml(list), /fresh-alert/, 'sig badli to dobara dikhta hai');
});

test('wiring: Home template me alert slot, server freshness parallel', () => {
  const home = fs.readFileSync(path.join(ROOT, 'home.js'), 'utf8');
  assert.match(home, /<div id="home-fresh-alert"><\/div><div class="home-hero v2">/);
  assert.match(home, /data-fresh-dismiss/);
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(server, /const metaP = Promise\.all\(\['ff', 'gv'\]\.map\(async \(src\)/);
});
