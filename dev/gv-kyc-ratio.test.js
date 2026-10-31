/* v3.125.17 — GV agent/TL KYC: GV Master ke issued TAG IDs → EIR KYC status. */
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
const FF = globalThis.FF, U = FF.util;

test('GV KYC uses GV Master tag IDs and EIR KYC by tag ID', async () => {
  const g = FF.config.gv.master, e = FF.config.eir;
  const now = new Date(), cur = U.ymKey(now), prev = U.prevMonthKey(cur);
  const dCur = { v: `Date(${now.getFullYear()},${now.getMonth()},1)` };
  const [py, pm] = prev.split('-').map(Number);
  const dPrev = { v: `Date(${py},${pm - 1},5)` };
  const sqls = [];
  FF.data.query = async (sheet, sql) => {
    sqls.push({ sheet, sql });
    if (sheet === (g.tab || 'GV Master')) return { rows: [[{ v: 'TAGA1' }, dCur, { v: '4' }], [{ v: 'TAGB2' }, dCur, { v: '4' }], [{ v: 'TAGC3' }, dPrev, { v: '7' }]] };
    return { rows: [[{ v: 'TAGA1' }, { v: 'TRUE' }, { v: '' }], [{ v: 'TAGB2' }, { v: 'FALSE' }, { v: '' }], [{ v: 'TAGC3' }, { v: '' }, { v: 'TRUE' }]] };
  };
  const rows = await FF.model.loadGvKycMonthly({ gv: 1, id: 'APS011961' }, {});
  assert.match(sqls[0].sql, new RegExp(`${g.uniqueId} = 'APS011961'`));
  assert.match(sqls[1].sql, /upper\(\w+\) matches '\(TAGA1\|TAGB2\|TAGC3\)'/);
  const c = FF.model.kycRatio(rows, (r) => r.ym === cur), l = FF.model.kycRatio(rows, (r) => r.ym === prev);
  assert.equal(c.full, 1); assert.equal(c.not, 1); assert.equal(c.pct, 50);
  assert.equal(l.full, 1, 'kyc2 column fallback');
  assert.equal(rows.issued, 3); assert.equal(rows.matched, 3);
  const tl = await FF.model.loadGvKycMonthly({ gv: 1, id: 'APS015349', tl: 1 }, {});
  assert.ok(Array.isArray(tl));
  assert.match(sqls.at(-2).sql, new RegExp(`${g.tlId} = 'APS015349' or ${g.gvTlId} = 'APS015349'`));
});

test('Master Search GV KYC box routes to loadGvKycMonthly', () => {
  const fs = require('node:fs');
  const ms = fs.readFileSync(path.join(ROOT, 'masterSearch.js'), 'utf8');
  assert.match(ms, /kycBoxHtml\(pr, isTl, ch\)/);
  assert.match(ms, /f && f\.gv \? FF\.model\.loadGvKycMonthly\(f\)/);
});
