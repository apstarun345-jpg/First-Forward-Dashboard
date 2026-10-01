/* 🧑‍🤝‍🧑 v3.30 — Tag Request UI contract (bina browser — pure generators / helpers):
 *
 *   • 🖨️ Print selected: har request ka label sirf EK baar (pehle ek hi label 8/10/12 baar repeat hota
 *     tha). TO = agent ka naam · mobile · address · PIN; purani request (v3.27) me employee + "Agent:".
 *   • 📥 Admin table: har request EK row — stock total + 🚗 VC4/VC20 + 🚚 VC5+, last month, current,
 *     run rate, expected, growth %, requested class-wise (agent ka original → approved), approve,
 *     address. Koi "Kholo"/drawer nahi. Purani multi-agent request = har agent ki alag row (server
 *     ki agentKey format same — inline edit sahi agent par lage).
 *   • 📝 Form: employee + agent blocks ka validation (agent-wise) aur submit payload.
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
FF.auth = { user: { role: 'admin', username: 'owner', name: 'Owner' }, can: () => true, settings: { contacts: { fromName: 'Apna Payment Pvt Ltd', fromAddress: 'Plot 12, RIICO, Jaipur', fromPhone: '+91 141 400 0000' } } };

const count = (html, re) => (html.match(re) || []).length;
const agentReq = (id, name, mobile, pin, rows, patch) => ({
  id, at: '2026-10-01T05:00:00.000Z', status: 'approved', batch: 'tagbatch_1', byName: 'Ramesh Yadav', by: 'public:ramesh yadav', source: 'public-link',
  employee: { name: 'Ramesh Yadav', office: 'Jaipur office' },
  agent: { name, agentId: '1001', tl: 'TL One', channel: 'ff', mobile, address: '12, Gandhi Nagar, Tonk Road, Jaipur', pincode: pin },
  rows: rows.map((x) => ({ agentId: '1001', agentName: name, tl: 'TL One', channel: 'ff', ...x })),
  total: rows.reduce((s, x) => s + (x.approved || 0), 0),
  ...(patch || {})
});
const rahul = agentReq('tagreq_aaa111', 'Rahul Sharma', '9876500001', '302015', [{ cls: 'VC5', requested: 5, approved: 0 }, { cls: 'VC4', requested: 25, approved: 20 }],
  { metrics: { core: { stock: 14, last: 60, cur: 22 }, comm: { stock: 3, last: 9, cur: 4 }, days: 10, ym: '2026-10' } });
const priya = agentReq('tagreq_bbb222', 'Priya Verma', '9876500002', '305001', [{ cls: 'VC6', requested: 6, approved: 6 }], { status: 'pending' });
const legacy = {
  id: 'tagreq_old333', at: '2026-09-20T05:00:00.000Z', status: 'approved', byName: 'Suresh Kumar', by: 'public:suresh kumar', source: 'public-link',
  employee: { name: 'Suresh Kumar', mobile: '9812345678', address: '24, Shanti Nagar, Sodala, Jaipur', pincode: '302019' },
  rows: [
    { agentId: '', agentName: 'Agent X', tl: 'TL One', channel: 'ff', cls: 'VC4', approved: 10, stock: 5, last: 20, cur: 8 },
    { agentId: '2002', agentName: 'Agent Y', tl: 'TL Two', channel: 'gv', cls: 'VC4', approved: 4 },
    { agentId: '2002', agentName: 'Agent Y', tl: 'TL Two', channel: 'gv', cls: 'VC7', approved: 2 }
  ],
  total: 16
};

test('🖨️ print selected — har request ka label sirf EK baar, TO = agent ka address (purani = employee)', () => {
  const html = TR.labelsHtml([rahul, priya, legacy, rahul, priya], { size: 12, rows: 4 });
  assert.equal(count(html, /class="lbl"/g), 3, '5 selections (2 repeat) → 3 unique labels');
  assert.equal(count(html, /302015/g), 1, 'Rahul ka PIN sirf ek label par');
  assert.equal(count(html, /305001/g), 1);
  assert.equal(count(html, /302019/g), 1, 'purani request = employee ka PIN');
  assert.match(html, /<b class="to-name">Rahul Sharma<\/b><div class="to-mob">☏ 9876500001<\/div>/);
  assert.match(html, /VC4 × 20 = <b>20 tags<\/b>/, 'approved qty; 0 wali class (VC5) label par nahi');
  assert.ok(!/VC5 × 0/.test(html));
  assert.match(html, /Agent: Agent X \+1/, 'purani multi-agent request — employee ke address par, agents line');
  assert.match(html, /VC4 × 14 · VC7 × 2 = <b>16 tags<\/b>/);
  assert.match(html, /FROM:<\/b> Apna Payment Pvt Ltd/);
  assert.ok(html.includes('font-size: 12pt'));
  assert.ok(html.includes('@page { size: A4'));
  for (const n of [4, 5, 6]) assert.ok(html.includes(`data-rows="${n}"`), `per page ${n * 2} button`);
  assert.ok(html.includes('data-sz="14"'));
  assert.ok(html.includes('Print / 📄 Save as PDF'));
  assert.match(html, /3 requests · 42 tags/, 'toolbar: kitni requests + tags');
  assert.ok(!/undefined|NaN/.test(html));
  const one = TR.dispatchLabelHtml(priya, { size: 10.5, rows: 5 });
  assert.equal(count(one, /class="lbl"/g), 1, 'single request = 1 label (pehle 10 copies repeat hoti thi)');
  const none = TR.labelsHtml([], {});
  assert.equal(count(none, /class="lbl"/g), 0);
  assert.match(none, /Koi request select nahi hui/);
});

test('📋 labelText — agent ka mobile/address/PIN; purani request me employee + agent line', () => {
  const t = TR.labelText(rahul);
  for (const s of ['FROM: Apna Payment Pvt Ltd', 'TO: Rahul Sharma', 'Mob: 9876500001', 'Address: 12, Gandhi Nagar', 'Pincode: 302015', 'tagreq_aaa111', '20 tags', 'VC4×20']) assert.ok(t.includes(s), `labelText me "${s}"`);
  assert.ok(!t.includes('VC5×0'));
  const old = TR.labelText(legacy);
  for (const s of ['TO: Suresh Kumar', 'Pincode: 302019', 'Agent: Agent X +1', '16 tags']) assert.ok(old.includes(s), `legacy labelText me "${s}"`);
});

test('📥 table rows — naya request = 1 row, purani multi-agent = har agent row; agentKey server jaisa', () => {
  const rows = TR._test.displayRows([rahul, legacy]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].agent.name, 'Rahul Sharma');
  assert.equal(rows[0].agentKey, '', 'v3.30 request ko agentKey ki zaroorat nahi');
  assert.deepEqual(rows[0].rows.map((x) => x.cls), ['VC4', 'VC5'], 'classes VC4 → VC16 order me');
  assert.equal(rows[0].total, 20); assert.equal(rows[0].requested, 30);
  assert.equal(rows[0].contact.who, 'agent');
  const [x, y] = rows.slice(1);
  assert.equal(x.agentKey, 'ff|n:agent x');
  assert.equal(y.agentKey, 'gv|id:2002');
  assert.equal(y.total, 6); assert.equal(y.siblings, 2);
  assert.equal(x.contact.who, 'employee');
  assert.equal(TR._test.agentKeyOf({ channel: 'gv', agentId: ' 77 ', agentName: 'Z' }), 'gv|id:77');
  assert.equal(TR._test.agentKeyOf({ agentName: '  Rahul   SHARMA ' }), 'ff|n:rahul sharma', 'server tagAgentKeyOf jaisa normalise');
});

test('📈 metrics — run rate · expected (month-end) · growth (expected vs last) · 🚗/🚚 alag', () => {
  const n = TR._test.metricNumbers({ core: { stock: 14, last: 60, cur: 22 }, comm: { stock: 3, last: 9, cur: 4 }, days: 10, ym: '2026-10' });
  assert.equal(n.total.stock, 17); assert.equal(n.core.stock, 14); assert.equal(n.comm.stock, 3);
  assert.equal(n.total.last, 69); assert.equal(n.total.cur, 26);
  assert.equal(n.total.rate, 2.6);
  assert.equal(n.total.exp, 81, '26 ÷ 10 × 31 din');
  assert.equal(n.core.exp, 68); assert.equal(n.comm.exp, 12);
  assert.ok(Math.abs(n.total.growth - 17.39) < 0.01);
  assert.ok(Math.abs(n.comm.growth - 33.33) < 0.01);
  const fresh = TR._test.metricNumbers({ core: { stock: 0, last: 0, cur: 5 }, comm: { stock: 0, last: 0, cur: 0 }, days: 5, ym: '2026-10' });
  assert.equal(fresh.core.growth, null, 'last month 0 → "new"');
  assert.equal(fresh.comm.growth, 0);
});

test('📥 request row — ek hi row me sab (koi Kholo nahi): stock 🚗/🚚, issuance, class-wise, approve, address', () => {
  const [dr] = TR._test.displayRows([rahul]);
  const html = TR._test.reqRowHtml(dr);
  assert.ok(!/Kholo|data-tr-open/.test(html), 'drawer / Kholo button nahi');
  for (const s of ['data-tr-sel="tagreq_aaa111::agent"', 'Ramesh Yadav', 'Jaipur office', 'Rahul Sharma', '#1001', 'TL TL One', '☏ 9876500001', 'Gandhi Nagar', '📮 302015']) assert.ok(html.includes(s), `row me "${s}"`);
  for (const m of ['stock', 'core', 'comm', 'last', 'cur', 'rate', 'exp', 'growth']) assert.ok(html.includes(`data-tr-m="${m}"`), `metric cell ${m}`);
  assert.match(html, /data-tr-m="stock"><i class="tr-src snap"[^>]*><\/i><b>17<\/b>/, 'stock total (snapshot)');
  assert.match(html, /data-tr-m="core"><b>14<\/b>/);
  assert.match(html, /data-tr-m="comm"><b>3<\/b>/);
  assert.match(html, /data-tr-m="exp"><b>81<\/b>/);
  assert.match(html, /▲ \+17\.4%/);
  assert.match(html, /<b>VC4<\/b><span><s class="dim">25<\/s> → <b>20<\/b><\/span>/, 'agent ka maanga → approved');
  assert.match(html, /req 30/, 'total ke neeche requested');
  assert.ok(html.includes('data-tr-op="edit"'), 'admin ✏️ edit');
  assert.ok(!html.includes('data-tr-op="approve"'), 'approved request par Approve button nahi');
  assert.ok(html.includes('🌐 link'));
  const [pdr] = TR._test.displayRows([priya]);
  const ph = TR._test.reqRowHtml(pdr);
  assert.ok(ph.includes('data-tr-op="approve"'), 'pending row me ✅ Approve wahin');
  assert.ok(ph.includes('data-tr-status'), 'status dropdown');
  assert.ok(!/undefined|NaN/.test(html + ph));
  // non-admin: approve/status nahi; apni pending request edit kar sakta hai
  const keep = FF.auth.user;
  FF.auth.user = { role: 'user', username: 'public:ramesh yadav' };
  try {
    const uh = TR._test.reqRowHtml(pdr);
    assert.ok(!uh.includes('data-tr-op="approve"') && !uh.includes('data-tr-status'));
    assert.ok(uh.includes('data-tr-op="edit"'), 'owner apni pending request edit kar sakta hai');
    const other = TR._test.reqRowHtml(TR._test.displayRows([legacy])[0]);
    assert.ok(!other.includes('data-tr-op="edit"') && !other.includes('data-tr-op="del"'), 'doosre ki request par edit/delete nahi');
  } finally { FF.auth.user = keep; }
});

test('📝 form — employee + agent blocks: agent-wise validation aur payload', () => {
  const out = TR._test.payload([
    { name: 'Rahul Sharma', mobile: '98765 00001', address: '12, Gandhi Nagar, Jaipur', pincode: '302015', q: { VC4: '25', VC6: '' } },
    { name: 'Priya', mobile: '123', address: 'abc', pincode: '30', q: {} },
    {},
    { name: 'rahul sharma', mobile: '9876500003', address: '1, Some Road, Jaipur', pincode: '302001', q: { VC5: '2' } }
  ], { name: 'R' });
  assert.deepEqual(out.errors, { rowId: 'employee', field: 'name' }, 'pehli galti = employee name');
  const [r1, r2, r3, r4] = out.ids;
  assert.ok(!out.errs[r1], 'pehla agent theek hai');
  assert.deepEqual(Object.keys(out.errs[r2]).sort(), ['address', 'mobile', 'pincode', 'qty']);
  assert.ok(!out.errs[r3], 'khaali block ignore');
  assert.match(out.errs[r4].agent, /Agent 1/, 'same agent dobara → "upar Agent 1 me pehle se hai"');
  assert.equal(out.payload.agents.length, 3, 'khaali block payload me nahi');
  const a = out.payload.agents[0];
  assert.equal(a.agentName, 'Rahul Sharma');
  assert.equal(a.mobile, '9876500001', 'mobile se spaces hate');
  assert.equal(a.pincode, '302015');
  assert.deepEqual(a.rows, [{ cls: 'VC4', requested: 25, approved: 25 }], 'sirf qty wali class; requested = approved');
  assert.equal(a.unmatched, true, 'index nahi → data me nahi mila flag');
  assert.equal(out.payload.employee.name, 'R');
  const ok = TR._test.payload([{ name: 'Rahul Sharma', mobile: '9876500001', address: '12, Gandhi Nagar, Jaipur', pincode: '302015', q: { VC4: '3' } }], { name: 'Ramesh Yadav' });
  assert.equal(ok.errors, null, 'sab bhara → koi error nahi');
});
