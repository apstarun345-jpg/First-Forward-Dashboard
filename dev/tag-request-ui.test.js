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
  assert.ok(html.includes('🖨️ Print') && html.includes('id="pdfbtn"') && html.includes('Download PDF'), 'print + direct PDF buttons');
  assert.ok(!/<script>/.test(html), 'inline script CSP se block hota hai — buttons opener se bind');
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
  for (const group of ['core', 'comm', 'total']) {
    const pair = FF.util.suggestPair(n[group].rate, n[group].stock);
    assert.deepEqual(n[group].suggest, { net: pair.net, gross: pair.gross }, `${group}: gross suggestion is not reduced by stock`);
  }
  assert.ok(n.total.suggest.gross >= n.total.suggest.net);
  const fresh = TR._test.metricNumbers({ core: { stock: 0, last: 0, cur: 5 }, comm: { stock: 0, last: 0, cur: 0 }, days: 5, ym: '2026-10' });
  assert.equal(fresh.core.growth, null, 'last month 0 → "new"');
  assert.equal(fresh.comm.growth, 0);
});

test('🧾 employee class hints — har class ka stock, last month aur current MTD; zero bhi visible', () => {
  const rec = { channel: 'ff', stock: { VC4: 12, VC5: 8, VC6: 0, VC7: 1, VC12: 0, VC16: 3 }, last: { VC4: 20, VC5: 9, VC6: 0, VC7: 2, VC12: 0, VC16: 4 }, cur: { VC4: 5, VC5: 3, VC6: 0, VC7: 1, VC12: 0, VC16: 2 }, priority: '' };
  assert.match(TR._test.hintText(rec, 'VC4'), /Stock 12 · Last 20 · MTD 5/);
  assert.match(TR._test.hintText(rec, 'VC6'), /Stock 0 · Last 0 · MTD 0/, 'zero stock/issuance class still gets a visible hint');
  for (const cls of ['VC4', 'VC5', 'VC6', 'VC7', 'VC12', 'VC16']) assert.ok(TR._test.hintText(rec, cls), `${cls} has a stock + issuance hint`);
  const groups = TR._test.agentGroupSummaryHtml({
    channel: 'ff', name: 'A', stock: rec.stock, last: rec.last, cur: rec.cur,
    grp: { core: { stock: 14, last: 25, cur: 8 }, comm: { stock: 17, last: 15, cur: 6 } }
  });
  // v3.52 — ek box-strip (stock · last · MTD · suggested · priority) + EK class table; 🚗/🚚 group rows gayi
  assert.ok(groups.includes('tr-boxes') && groups.includes('VC4 + VC20 group'), 'boxes + VC20 note');
  assert.ok(/📦 Stock<\/small><b>31<\/b><em>VC4 12 · VC20 2 · VC5\+ 17/.test(groups), 'stock box: total + class mix');
  assert.ok(/Last month[^<]*<\/small><b>40<\/b><em>VC4 20 · VC20 5 · VC5\+ 15/.test(groups), 'last month box');
  assert.ok(/Current MTD[^<]*<\/small><b>14<\/b><em>VC4 5 · VC20 3 · VC5\+ 6/.test(groups), 'MTD box');
  assert.ok(groups.includes('🎯 Suggested qty') && groups.includes('🚦 Priority'), 'suggested + priority boxes');
  assert.ok(!groups.includes('tr-qty-group"'), 'purane 🚗/🚚 duplicate group rows nahi');
});

test('🧭 admin source filter — Both / First Forward / GV only; hidden from employees', () => {
  const rows = TR._test.displayRows([rahul, legacy]);
  assert.equal(rows.length, 3);
  assert.equal(TR._test.filterRows(rows, { status: 'all', channel: 'both', q: '' }).length, 3);
  assert.deepEqual(TR._test.filterRows(rows, { status: 'all', channel: 'ff', q: '' }).map((x) => x.agent.channel), ['ff', 'ff']);
  assert.deepEqual(TR._test.filterRows(rows, { status: 'all', channel: 'gv', q: '' }).map((x) => x.agent.channel), ['gv']);
  const controls = TR._test.channelFilterHtml(rows);
  for (const key of ['both', 'ff', 'gv']) assert.ok(controls.includes(`data-tr-channel="${key}"`));
  const adminShell = TR._test.requestsShellHtml();
  assert.match(adminShell, /colspan="19"/);   // + 🚚 Courier column (v3.51)
  const keep = FF.auth.user;
  FF.auth.user = { role: 'user', username: 'member' };
  try {
    assert.equal(TR._test.filterRows(rows, { status: 'all', channel: 'gv', q: '' }).length, 3, 'source filtering is admin-only');
    assert.equal(TR._test.channelFilterHtml(rows), '');
    assert.match(TR._test.requestsShellHtml(), /colspan="17"/);
    assert.doesNotMatch(TR._test.requestsShellHtml(), /data-tr-channel=/);
  } finally { FF.auth.user = keep; }
});

test('📥 request row — ek hi row me sab (koi Kholo nahi): stock 🚗/🚚, issuance, class-wise, approve, address', () => {
  const [dr] = TR._test.displayRows([rahul]);
  const html = TR._test.reqRowHtml(dr);
  assert.ok(!/Kholo|data-tr-open/.test(html), 'drawer / Kholo button nahi');
  for (const s of ['data-tr-sel="tagreq_aaa111::agent"', 'Ramesh Yadav', 'Jaipur office', 'Rahul Sharma', '#1001', 'TL TL One', '☏ 9876500001', 'Gandhi Nagar', '📮 302015']) assert.ok(html.includes(s), `row me "${s}"`);
  for (const m of ['stock', 'core', 'comm', 'last', 'cur', 'rate', 'exp', 'growth', 'suggest']) assert.ok(html.includes(`data-tr-m="${m}"`), `metric cell ${m}`);
  assert.match(html, /data-tr-m="stock"><i class="tr-src snap"[^>]*><\/i><b>17<\/b>/, 'stock total (snapshot)');
  assert.match(html, /data-tr-m="core"><b>14<\/b>/);
  assert.match(html, /data-tr-m="comm"><b>3<\/b>/);
  assert.match(html, /data-tr-m="exp"><b>81<\/b>/);
  assert.match(html, /▲ \+17\.4%/);
  const suggestions = TR._test.metricNumbers(rahul.metrics);
  const suggestionCell = html.match(/<td class="num tr-m tr-c-suggest"[\s\S]*?<\/td>/);
  assert.ok(suggestionCell, 'admin gets a suggestion cell');
  assert.ok(suggestionCell[0].includes('After stock') && suggestionCell[0].includes('Without stock deduction'));
  assert.ok(suggestionCell[0].includes(`<b>${suggestions.total.suggest.net}</b>`));
  assert.ok(suggestionCell[0].includes(`<b>${suggestions.total.suggest.gross}</b>`));
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
    assert.ok(!uh.includes('data-tr-m="suggest"'), 'admin-only suggestion column hidden for employees');
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

test('👤 employee link request history — ALL/status filters and 10-request previous/next pages', () => {
  const statuses = ['pending', 'approved', 'dispatched', 'rejected'];
  const requests = Array.from({ length: 23 }, (_, i) => ({
    id: `tagreq_${String(i + 1).padStart(4, '0')}`,
    at: '2026-10-02T05:00:00.000Z',
    status: statuses[i % statuses.length],
    total: i + 1,
    agentName: `Agent ${i + 1}`,
    classes: [{ cls: 'VC4', requested: i + 2, approved: i + 1 }],
    adminNote: i === 0 ? 'Pincode verify karein' : ''
  }));
  const counts = requests.reduce((out, request) => {
    out[request.status]++;
    return out;
  }, { pending: 0, approved: 0, dispatched: 0, rejected: 0 });
  const summary = { totalRequests: requests.length, ...counts, requestedTags: 299, approvedTags: 276, requests };

  const first = TR._test.employeeStatusPage(summary, 'all', 1);
  assert.equal(first.pageSize, 10);
  assert.equal(first.total, 23);
  assert.equal(first.pageCount, 3);
  assert.equal(first.start, 1);
  assert.equal(first.end, 10);
  assert.equal(first.requests.length, 10);
  assert.equal(first.requests[0].id, requests[0].id, 'newest-first order preserved');
  const last = TR._test.employeeStatusPage(summary, 'all', 99);
  assert.equal(last.page, 3, 'out-of-range page clamps to last page');
  assert.equal(last.requests.length, 3);
  assert.equal(last.start, 21);
  assert.equal(last.end, 23);

  const approved = TR._test.employeeStatusPage(summary, 'approved', 1);
  assert.equal(approved.total, counts.approved);
  assert.ok(approved.requests.every((request) => request.status === 'approved'));
  assert.equal(TR._test.employeeStatusPage(summary, 'rejected', 1).total, counts.rejected);
  assert.equal(TR._test.employeeStatusPage(summary, 'unknown', 1).filter, 'all');

  const firstHtml = TR._test.employeeStatusHistoryHtml(summary, 'all', 1).html;
  for (const key of ['all', 'pending', 'approved', 'dispatched', 'rejected']) {
    assert.ok(firstHtml.includes(`data-tr-emp-filter="${key}"`), `${key} filter is available`);
  }
  assert.equal((firstHtml.match(/class="tr-st-card /g) || []).length, 10, 'first page renders exactly 10 requests');
  assert.match(firstHtml, /1–10 \/ 23/);
  assert.match(firstHtml, /data-tr-emp-page="prev" disabled/);
  assert.match(firstHtml, /data-tr-emp-page="next"/);
  assert.ok(firstHtml.includes('Pincode verify karein'), 'employee can see the admin note on a request');

  const lastHtml = TR._test.employeeStatusHistoryHtml(summary, 'all', 3).html;
  assert.equal((lastHtml.match(/class="tr-st-card /g) || []).length, 3);
  assert.match(lastHtml, /data-tr-emp-page="prev"/);
  assert.match(lastHtml, /data-tr-emp-page="next" disabled/);
  const filteredHtml = TR._test.employeeStatusHistoryHtml(summary, 'rejected', 1).html;
  assert.ok(filteredHtml.includes('aria-pressed="true"'), 'selected status filter is visibly and accessibly active');
  assert.equal((filteredHtml.match(/class="tr-st-card /g) || []).length, counts.rejected);
});

/* 🌐 v3.57 — employee link ke 📝 Form tab par "👤 Meri requests" + 📇 purana address suggestion.
 *
 *   • Employee ko apni requests dekhne ke liye 🔎 Status tab kholna NAHI padta — wahi Form page par
 *     panel hai: All / Pending / Approved / Dispatched / Rejected chips (band panel me bhi counts
 *     dikhte hain), andar wahi 10-10 ke page + ← Previous / Next →.
 *   • Wahi agent dobara chuno (kabhi bhi) to purana mobile · address · pincode chip me dikhta hai aur
 *     ek click me bhar jaata hai — chip tab bhi dikhta hai jab employee ne khud kuch type kiya ho.
 */
test('🌐 employee link Form tab — "👤 Meri requests" panel: All + status filters, 10-10 ke page, prev/next', () => {
  const statuses = ['pending', 'approved', 'dispatched', 'rejected'];
  const requests = Array.from({ length: 23 }, (_, i) => ({
    id: `tagreq_${String(i + 1).padStart(4, '0')}`, at: '2026-10-02T05:00:00.000Z',
    status: statuses[i % statuses.length], total: i + 1, agentName: `Agent ${i + 1}`,
    classes: [{ cls: 'VC4', requested: i + 2, approved: i + 1 }]
  }));
  const counts = requests.reduce((o, r) => { o[r.status]++; return o; }, { pending: 0, approved: 0, dispatched: 0, rejected: 0 });
  const summary = { totalRequests: requests.length, ...counts, requestedTags: 100, approvedTags: 80, requests };

  try {
    TR._test.setPublic({ brand: 'First Forward', enabled: true });
    TR._test.setEmployee({ token: 'tok_0123456789abcdefghij', summary, filter: 'all', page: 1 });

    const panel = TR._test.employeeHistoryPanelHtml();
    assert.ok(panel.includes('id="tr-emp-history-panel"'), 'panel Form tab par render hota hai');
    assert.ok(panel.includes('👤 Meri requests'), 'employee ko apni requests ka section dikhta hai');
    for (const key of ['all', 'pending', 'approved', 'dispatched', 'rejected']) {
      assert.ok(panel.includes(`data-tr-emp-filter="${key}"`), `${key} filter Form tab par bhi hai`);
    }
    assert.equal((panel.match(/class="tr-st-card /g) || []).length, 10, 'pehla page = exactly 10 requests');
    assert.match(panel, /1–10 \/ 23/);
    assert.match(panel, /data-tr-emp-page="prev" disabled/, 'page 1 par Previous disabled');
    assert.match(panel, /data-tr-emp-page="next"/);
    assert.ok(panel.includes('↻ Refresh'), 'employee khud refresh kar sakta hai');

    // Band panel me bhi status counts dikhne chahiye — employee ko ek nazar me pata chale.
    for (const [key, n] of [['pending', counts.pending], ['approved', counts.approved], ['dispatched', counts.dispatched], ['rejected', counts.rejected]]) {
      const chip = new RegExp(`tr-emp-chip-${key}">[^<]*<b>${n}</b>`);
      assert.match(panel, chip, `${key} count collapsed summary me dikhta hai`);
    }

    // Page 3 (aakhri) — Next disabled, baaki 3 requests.
    TR._test.setEmployee({ token: 'tok_0123456789abcdefghij', summary, filter: 'all', page: 3 });
    const lastPanel = TR._test.employeeHistoryPanelHtml();
    assert.equal((lastPanel.match(/class="tr-st-card /g) || []).length, 3);
    assert.match(lastPanel, /data-tr-emp-page="next" disabled/);
    assert.match(lastPanel, /data-tr-emp-page="prev"/);

    // Status filter — sirf wahi status ki requests.
    TR._test.setEmployee({ token: 'tok_0123456789abcdefghij', summary, filter: 'rejected', page: 1 });
    const rejectedPanel = TR._test.employeeHistoryPanelHtml();
    assert.equal((rejectedPanel.match(/class="tr-st-card /g) || []).length, counts.rejected);
    assert.match(rejectedPanel, /data-tr-emp-filter="rejected"[^>]*aria-pressed="true"/);
  } finally {
    TR._test.setPublic(null);
    TR._test.setEmployee({});
  }
});

test('🌐 Meri requests panel — bina token / login form par nahi dikhta (koi data leak nahi)', () => {
  try {
    TR._test.setPublic({ brand: 'First Forward', enabled: true });
    TR._test.setEmployee({ token: '' });
    assert.equal(TR._test.employeeHistoryPanelHtml(), '', 'token na ho (pehle kabhi request nahi lagi) → panel nahi');
    TR._test.setEmployee({ token: 'tok_0123456789abcdefghij', summary: null });
    assert.ok(TR._test.employeeHistoryPanelHtml().includes('load ho rahi hai'), 'summary load hote waqt loading state');
    TR._test.setPublic(null); // login wala form
    TR._test.setEmployee({ token: 'tok_0123456789abcdefghij', summary: { totalRequests: 1, pending: 1, approved: 0, dispatched: 0, rejected: 0, requestedTags: 5, approvedTags: 0, requests: [] } });
    assert.equal(TR._test.employeeHistoryPanelHtml(), '', 'login form par panel nahi (wahan 📥 Meri requests tab hai)');
  } finally {
    TR._test.setPublic(null);
    TR._test.setEmployee({});
  }
});

test('📇 purana address suggestion — same agent dobara chuno to purana mobile/address/pincode ek click me', () => {
  const saved = { mobile: '9876500001', address: '24, Shanti Nagar, Sodala, Jaipur', pincode: '302019', source: 'Address' };
  const chip = TR._test.contactSuggestHtml({ id: 'r1', suggest: saved, mobile: '', address: '', pincode: '' });
  assert.match(chip, /data-tr-fill-old="r1"/, 'chip par click handler hai');
  assert.ok(chip.includes('9876500001'), 'purana mobile dikhta hai');
  assert.ok(chip.includes('24, Shanti Nagar, Sodala, Jaipur'), 'purana address dikhta hai');
  assert.ok(chip.includes('302019'), 'purana pincode dikhta hai');
  assert.ok(chip.includes('Address book'), 'source batata hai ki address kahan se aaya');

  // Employee ne khud alag address type kiya → suggestion chhupni NAHI chahiye (wohi maang thi).
  const typed = TR._test.contactSuggestHtml({ id: 'r2', suggest: saved, mobile: '9000000000', address: 'Naya address, Jaipur', pincode: '302001' });
  assert.match(typed, /data-tr-fill-old="r2"/, 'khud type kiya ho tab bhi purana address suggest hota hai');

  // Purana address pehle se same bhara hua → chip bekaar, dikhegi nahi.
  assert.equal(TR._test.contactSuggestHtml({ id: 'r3', suggest: saved, mobile: '9876500001', address: '24, Shanti Nagar, Sodala, Jaipur', pincode: '302019' }), '');
  // Koi purana record nahi / khaali record → chip nahi.
  assert.equal(TR._test.contactSuggestHtml({ id: 'r4', mobile: '', address: '', pincode: '' }), '');
  assert.equal(TR._test.contactSuggestHtml({ id: 'r5', suggest: { mobile: '', address: '', pincode: '' } }), '');
  // Purani request (device book) se aaya ho to source wahi dikhe.
  assert.ok(TR._test.contactSuggestHtml({ id: 'r6', suggest: { ...saved, source: 'Request' }, mobile: '', address: '', pincode: '' }).includes('Pichli request'));
});
