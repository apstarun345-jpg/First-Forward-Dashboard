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

test('Home keeps only the class-wise KYC card (in the month grid), clickable to the detail dashboard', () => {
  const h = read('home.js');
  assert.match(h, /id="home-kyc" class="hm-kyc-slot" style="display:contents"/);
  assert.doesNotMatch(h, /\['home-kyc', /);
  assert.match(h, /M\.loadKycMonthly\(\{\}\)/);
  assert.match(h, /M\.kycClassHtml\(/);
  assert.doesNotMatch(h, /Last month · ' \+ lbl\.last/);
  assert.match(h, /data-kpi-self="1" data-kyc-open="1"/);
  assert.match(h, /FF\.kycDetail\.open\(/);
  assert.match(h, /blank \$\{U\.fmt\(pend\.pending\)\}/);
});

test('kycRatio reports pending (blank CUSTOMER_FULL_KYC) separately from the % base', () => {
  const src = read('model.js');
  const fnSrc = /function kycRatio[\s\S]*?\n  \}\n/.exec(src)[0];
  const kycRatio = new Function(`${fnSrc}; return kycRatio;`)();
  const r = kycRatio([{ kyc: 'full', n: 1 }, { kyc: 'not', n: 3 }, { kyc: 'other', n: 6 }]);
  assert.strictEqual(r.pending, 6); assert.strictEqual(r.total, 4); assert.strictEqual(r.issued, 10); assert.strictEqual(r.pct, 25);
});

test('KYC detail dashboard: class / channel / agent / TL sections, pending, search, Excel', () => {
  const k = read('kpiDetail.js');
  assert.match(k, /FF\.kycDetail = \{ open: kycOpen,/);
  assert.match(k, /loadKycPeople\(filter\)/);
  for (const t of ['Class-wise KYC', 'Channel-wise KYC', 'Sabse zyada KYC %', 'Sabse zyada Not KYC', 'data-kyc-csv', 'data-kyc-q', 'Pending']) assert.ok(k.includes(t), t);
  assert.match(k, /kycPeopleSection\(rows, m, lbl, 'agent'/);
  assert.match(k, /kycPeopleSection\(rows, m, lbl, 'tl'/);
  const m = read('model.js');
  assert.match(m, /async function loadKycPeople\(/);
});

test('Master Search has KYC box filtered by agent or TL, filled async', () => {
  const m = read('masterSearch.js');
  assert.match(m, /function kycBoxHtml\(/);
  assert.match(m, /\$\{kycBoxHtml\(pr, isTl, ch\)\}/);
  assert.match(m, /fillKycBoxes\(host\);/);
  assert.match(m, /FF\.kycDetail\.open\(\{ title: `\$\{sp\.t\} · FASTag KYC`, filter: sp\.f \}\)/);
  assert.match(m, /isTl \? \{ tl: pr\.name \} : \{ agent: pr\.name \}/);
});

test('KYC reads CUSTOMER_FULL_KYC and the bank\'s newer IS_FULL_KYC (first non-blank wins)', () => {
  const cfg = fs.readFileSync(new URL('../config.js', import.meta.url), 'utf8');
  const model = fs.readFileSync(new URL('../model.js', import.meta.url), 'utf8');
  assert.match(cfg, /kyc2:\s*'BJ'/);
  assert.match(model, /kycPick/);
  assert.match(model, /e\.kyc2/);
});
