/* 👥🚚 v3.51 — Tag Request employee link: TL naam par poora class-wise data + courier naam.
 *
 *   • TL naam type karte hi `findTlRecord` us TL ko pakadta hai aur 👥 panel me
 *     VC4 · VC20 · VC5+ ka stock / last month / current MTD + 🎯 suggested (stock ke baad aur
 *     bina stock ghataye) dikhta hai. VC20 ki apni class row nahi hoti — wo 🚗 core − VC4 hai.
 *   • 🚚 Courier form me select hota hai, label (print/PDF) par chhapta hai, admin row me
 *     badge + per-request dropdown dikhta hai, aur payload ke saath server tak jaata hai.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ls = new Map();
globalThis.window = globalThis;
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
require(path.join(ROOT, 'config.js'));
require(path.join(ROOT, 'util.js'));
require(path.join(ROOT, 'tagRequest.js'));
const FF = globalThis.FF;
const TR = FF.pages.tagRequest;
FF.auth = { user: { role: 'admin', username: 'owner', name: 'Owner' }, can: () => true, settings: {} };
const grp = (core, comm) => ({ core, comm });

// TL: core (VC4+VC20) = stock 12 / last 90 / cur 100 · comm (VC5+) = stock 2 / last 10 / cur 4
// VC4 alone = stock 4 / last 60 / cur 40 → VC20 = 8 / 30 / 60 (core − VC4)
const tlIdx = {
  at: Date.now(), cur: '2026-10', last: '2026-09',
  byKey: new Map(),
  tls: new Map([
    ['ff|TL ONE', {
      key: 'ff|TL ONE', name: 'TL One', channel: 'ff', priority: 'High', agents: new Set(['ff|RAHUL SHARMA']),
      stock: { VC4: 4, VC6: 2 }, cur: { VC4: 40, VC6: 4 }, last: { VC4: 60, VC6: 10 },
      grp: grp({ stock: 12, last: 90, cur: 100 }, { stock: 2, last: 10, cur: 4 })
    }]
  ]),
  list: [
    { key: 'ff|RAHUL SHARMA', channel: 'ff', name: 'RAHUL SHARMA', agentId: '1001', tlName: 'TL One', priority: 'High', stock: 12, last: 90, cur: 100, core: { stock: 12, last: 90, cur: 100 }, comm: { stock: 2, last: 10, cur: 4 } }
  ]
};

test('👥 TL naam — class-wise stock / last / MTD (VC4 · VC20 · VC5+) + 🎯 dono suggested qty', () => {
  TR._test.setIndex(tlIdx);
  // TL naam type kiya → TL record milta hai (pehle sirf agents dhoondhe jaate the)
  const rec = TR._test.findTlRecord('tl one', '');
  assert.ok(rec && rec.isTl, 'TL naam se TL record mila');
  assert.equal(rec.name, 'TL One');

  const panel = TR._test.tlPanelHtml({ isTl: true, name: 'TL One', channel: 'ff' });
  assert.match(panel, /tr-tl-panel/, 'TL panel render hua');
  assert.match(panel, /class-wise \(VC4 · VC20 · VC5\+\)/);
  assert.match(panel, /tr-class-tbl/, 'class-wise table');
  for (const s of ['VC4', 'VC20', 'VC5+', 'Total', 'Stock', 'Last month', 'Current MTD', 'After stock', 'W/o stock']) assert.ok(panel.includes(s), `table me "${s}"`);

  const rows = TR._test.classBreakdownRows(rec);
  const by = (k) => rows.find(([label]) => label === k)[1];
  assert.deepEqual([by('VC4').stock, by('VC4').last, by('VC4').cur], [4, 60, 40], 'VC4 apni row');
  assert.deepEqual([by('VC20').stock, by('VC20').last, by('VC20').cur], [8, 30, 60], 'VC20 = core − VC4');
  assert.deepEqual([by('VC5+').stock, by('VC5+').last, by('VC5+').cur], [2, 10, 4], 'VC5+ = comm group');
  assert.deepEqual([by('Total').stock, by('Total').last, by('Total').cur], [14, 100, 104], 'Total = core + comm');
  for (const k of ['VC4', 'VC20', 'VC5+', 'Total']) {
    assert.ok(Number.isFinite(by(k).net) && Number.isFinite(by(k).gross), `${k}: dono suggested numbers`);
    assert.ok(by(k).gross >= by(k).net, `${k}: w/o stock >= after stock`);
  }
  assert.ok(panel.includes('sug-chip wo'), 'bina stock wala chip bhi dikhta hai');
  assert.ok(!/undefined|NaN/.test(panel), 'koi undefined/NaN nahi');
  TR._test.setIndex(null);
});

test('🚚 courier — form payload, label (print) aur admin row me dropdown', () => {
  const req = {
    id: 'tagreq_courier1', at: '2026-10-01T05:00:00.000Z', status: 'approved', batch: 'b1', byName: 'Ramesh Yadav', by: 'public:ramesh',
    employee: { name: 'Ramesh Yadav', office: 'Jaipur' }, courier: 'DTDC',
    agent: { name: 'Rahul Sharma', agentId: '1001', tl: 'TL One', channel: 'ff', mobile: '9876500001', address: '12, Gandhi Nagar, Jaipur', pincode: '302015' },
    rows: [{ agentId: '1001', agentName: 'Rahul Sharma', tl: 'TL One', channel: 'ff', cls: 'VC4', requested: 5, approved: 5 }],
    total: 5
  };
  const html = TR.labelsHtml([req], { size: 12, rows: 4 });
  assert.match(html, /🚚 Courier: <b>DTDC<\/b>/, 'label par courier chip');
  assert.ok(TR.labelText(TR._test.labelItem(req)).includes('🚚 Courier: DTDC'), 'plain text label me courier');

  const [dr] = TR._test.displayRows([req]);
  const row = TR._test.reqRowHtml(dr);
  assert.ok(row.includes('data-tr-courier'), 'admin per-request courier dropdown');
  assert.match(row, /🚚 DTDC/, 'row me courier badge');
  const keep = FF.auth.user;
  FF.auth.user = { role: 'user', username: 'public:ramesh' };
  try {
    const uh = TR._test.reqRowHtml(TR._test.displayRows([req])[0]);
    assert.ok(!uh.includes('data-tr-courier'), 'employee ko courier dropdown nahi milta');
  } finally { FF.auth.user = keep; }
  assert.ok(TR._test.requestColumnCount() >= 17);

  // form select ke options — Settings se + default Delhivery / DTDC
  const opts = TR._test.courierOptions();
  for (const c of ['Delhivery', 'DTDC']) assert.ok(opts.includes(c), `courier option ${c}`);
  const out = TR._test.payload([{ name: 'Rahul Sharma', mobile: '9876500001', address: '12, Gandhi Nagar, Jaipur', pincode: '302015', q: { VC4: '5' } }], { name: 'R' });
  assert.equal(typeof out.payload.courier, 'string', 'payload me courier key');
});
