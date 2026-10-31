import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../kpiDetail.js', import.meta.url), 'utf8');
const model = fs.readFileSync(new URL('../model.js', import.meta.url), 'utf8');
const drawers = [];
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const ymKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const prevMonthKey = (k) => { const [y, m] = k.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`; };
const cur = ymKey(now), last = prevMonthKey(cur);
const kycOf = vm.runInNewContext(`${/const kycOf = [^\n]+/.exec(model)[0]}; kycOf`);
const FF = {
  util: { esc: (v) => String(v ?? ''), fmt: (n) => String(n), ymKey, prevMonthKey, labelYM: (k) => k, spinner: () => 'spin', errorBox: (e) => String(e), stamp: () => 'x', downloadCsv() {} },
  config: {}, pages: {}, auth: { can: () => true },
  app: { openDrawer: (o) => drawers.push(o) },
  model: { loadKycPeople: async () => [
    { name: 'A One', tlName: 'TL1', channel: 'First Forward', ym: cur, group: 'VC4', kyc: 'not', n: 90 },
    { name: 'A One', tlName: 'TL1', channel: 'First Forward', ym: cur, group: 'VC4', kyc: 'full', n: 10 },
    { name: 'B Two', tlName: 'TL2', channel: 'GV Partner', ym: cur, group: 'VC20', kyc: 'full', n: 30 },
    { name: 'B Two', tlName: 'TL2', channel: 'GV Partner', ym: cur, group: 'VC20', kyc: 'not', n: 10 },
    { name: 'B Two', tlName: 'TL2', channel: 'GV Partner', ym: cur, group: 'VC5+', kyc: 'other', n: 25 },
    { name: 'B Two', tlName: 'TL2', channel: 'GV Partner', ym: last, group: 'VC5+', kyc: 'full', n: 5 },
  ] }
};
const sandbox = { window: { FF }, FF, console, Map, Set, URLSearchParams, Date, document: { addEventListener() {}, querySelectorAll: () => [] }, location: { hash: '#/' } };
vm.runInNewContext(src, sandbox, { filename: 'kpiDetail.js' });

test('KYC detail renders class table, callouts, pending and agent/TL lists worst-first', async () => {
  assert.equal(kycOf('TRUE'), 'full'); assert.equal(kycOf('false'), 'not'); assert.equal(kycOf(''), 'other');
  await FF.kycDetail.open({ title: 'T' });
  const d = drawers[drawers.length - 1];
  assert.ok(d.replace && d.wide);
  const html = d.body;
  assert.match(html, /Class-wise KYC/);
  assert.match(html, /Sabse zyada KYC %<\/small><b class="kyc-ok">VC20 · 75\.0%/);
  assert.match(html, /Sabse kam KYC %<\/small><b class="kyc-bad">VC4 · 10\.0%/);
  assert.match(html, /blank 25/);           // current month pending (blank KYC) shown separately (class tiles)
  // agent list: A One (90 not KYC) ranks above B Two (10)
  assert.ok(html.indexOf('A One') < html.indexOf('B Two'));
  assert.match(html, /data-kyc-by="agent"/); assert.match(html, /data-kyc-by="tl"/);
  assert.match(d.actions, /data-kyc-csv/);
});

test('KYC detail scoped to one agent hides the agent and TL lists', async () => {
  await FF.kycDetail.open({ title: 'Agent', filter: { agent: 'A One' } });
  const d = drawers[drawers.length - 1];
  assert.doesNotMatch(d.body, /data-kyc-by=/);
  assert.match(d.body, /Class-wise KYC/);
});
