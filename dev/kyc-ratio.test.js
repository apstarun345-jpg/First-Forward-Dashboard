import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('config maps EIR CUSTOMER_FULL_KYC to column AK', () => {
  assert.match(read('config.js'), /kyc: 'AK'/);
});

test('model exposes loadKycMonthly and kycRatio', () => {
  const m = read('model.js');
  assert.match(m, /async function loadKycMonthly\(/);
  assert.match(m, /FF\.model = \{[^}]*loadKycMonthly[^}]*kycRatio/s);
  assert.match(m, /kycOf[\s\S]{0,200}'true'[\s\S]{0,80}'full'/);
});

test('kycRatio computes full ÷ (full + not), ignores other', () => {
  const src = read('model.js');
  const fnSrc = /function kycRatio[\s\S]*?\n  \}\n/.exec(src)[0];
  const kycRatio = new Function(`${fnSrc}; return kycRatio;`)();
  const rows = [
    { ym: '2026-10', group: 'VC4', kyc: 'full', n: 3 },
    { ym: '2026-10', group: 'VC4', kyc: 'not', n: 1 },
    { ym: '2026-10', group: 'VC5+', kyc: 'other', n: 9 },
    { ym: '2026-09', group: 'VC4', kyc: 'not', n: 4 },
  ];
  const cur = kycRatio(rows, (r) => r.ym === '2026-10');
  assert.strictEqual(cur.full, 3); assert.strictEqual(cur.not, 1); assert.strictEqual(cur.total, 4);
  assert.strictEqual(cur.pct, 75);
  const none = kycRatio([], () => true);
  assert.strictEqual(none.pct, null);
  assert.strictEqual(kycRatio(rows, (r) => r.group === 'VC4').total, 8);
});

test('Home shows KYC section with class-wise card and two overall cards', () => {
  const h = read('home.js');
  assert.match(h, /\['home-kyc', '🪪 FASTag KYC ratio'\]/);
  assert.match(h, /id="home-kyc"/);
  assert.match(h, /M\.loadKycMonthly\(\{\}\)/);
  assert.match(h, /KYC % · class-wise \(VC4 \/ VC20 \/ VC5\+\)/);
  assert.match(h, /overall\(last, lbl\.last\)[\s\S]{0,60}overall\(cur, lbl\.cur\)/);
});

test('Master Search has KYC box filtered by agent or TL, filled async', () => {
  const m = read('masterSearch.js');
  assert.match(m, /function kycBoxHtml\(/);
  assert.match(m, /\$\{kycBoxHtml\(pr, isTl\)\}/);
  assert.match(m, /fillKycBoxes\(host\);/);
  assert.match(m, /isTl \? \{ tl: pr\.name \} : \{ agent: pr\.name \}/);
});
