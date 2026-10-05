/* v3.31 — (1) Stock Dispatch run-rate user ki FF/GV sheet jaisa: total ÷ (aaj − 1) DATE ke hisaab se
   (1 Oct → FF = September ÷ 30, GV live = Oct ÷ 1), WITH / W/O stock qty usi par ·
   (2) drill-down: "last month" / month-name / "VC4 stock" / "Agents with stock" / priority cards apna hi data kholte hain ·
   (3) loaders: alag-alag style + reduced-motion me bhi animate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDispatchPlan, dispatchEmailContent, DEFAULT_DISPATCH_EMAIL } from '../dispatch-email.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
const docListeners = {};
globalThis.document = {
  documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} } }, title: '', hidden: false,
  body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {} }, contains: () => true },
  addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); }, removeEventListener() {},
  createElement: () => ({ style: {}, classList: { add() {} }, setAttribute() {}, appendChild() {}, addEventListener() {}, getContext: () => null }),
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null
};
globalThis.location = { hash: '#/home' };
['config', 'util', 'model', 'gv', 'store', 'charts'].forEach((f) => require(path.join(ROOT, `${f}.js`)));
const FF = globalThis.FF;
const U = FF.util;

// ---- (1) dispatch planner: per-channel divisor -------------------------------------------------------
test('dispatch planner: FF row ÷ FF din (1 Oct = 30, September) · GV row ÷ GV din (aaj − 1 = 1) — pehle dono ÷ 1', () => {
  const realDays = U.runRateDays;
  U.runRateDays = (now, ch) => (ch === 'gv' ? 1 : 30);
  FF.config.features.suggestDays = 15;
  const ffAgents = [{ name: 'Ravi Kumar', agentId: 'R1', tlName: 'TL One', tlId: 'T1', priority: 'High', curVc4: 270, curNvc4: 30, curTotal: 300, lastVc4: 250, lastNvc4: 20, lastTotal: 270, stockVc4: 40, stockNvc4: 10, stockTotal: 50, week: [], tlExcluded: false }];
  const gvRows = [{ agentId: 'G1', agentName: 'GV Ramesh', tlId: 'GT1', tlName: 'GV TL', priority: 'High', stockVc4: 5, stockComm: 0, stockTotal: 5, curVc4: 3, curComm: 0, curTotal: 3, lastVc4: 90, lastComm: 0, lastTotal: 90 }];
  FF.pages = { performance: { ensureLoaded: async () => {}, agents: () => ffAgents } };
  FF.gv.enabled = () => true; FF.gv.need = async () => gvRows; FF.gv.get = (k) => (k === 'report' ? gvRows : []);
  require(path.join(ROOT, 'dispatchPlanner.js'));
  const DP = FF.dispatchPlanner;
  const rows = DP.collectAgents().map((r) => DP.withCalc(r, 'total'));
  const ff = rows.find((r) => r.ch === 'ff'), gv = rows.find((r) => r.ch === 'gv');
  assert.equal(ff.rate, 10, '300 ÷ 30 (sheet: 14739 ÷ 30 = 491.3 jaisa) — pehle 300 ÷ 1 = 300');
  assert.equal(ff.required, 150, '10 × 15 din');
  assert.equal(ff.net, 100, 'WITH stock = 150 − 50');
  assert.equal(ff.gross, 150, 'W/O stock = 150');
  assert.equal(gv.rate, 3, 'GV live: 3 ÷ (1 − 1 → min 1)');
  assert.equal(gv.net, 40, '3 × 15 − 5');
  U.runRateDays = realDays;
});

test('dispatch email (server): per-channel elapsed + months text', () => {
  const sources = [
    { kind: 'agent', ch: 'ff', name: 'Ravi', id: 'R1', tl: 'TL One', priority: 'High', cur: { vc4: 270, comm: 30, total: 300 }, last: { vc4: 0, comm: 0, total: 0 }, stock: { vc4: 40, comm: 10, total: 50 } },
    { kind: 'agent', ch: 'gv', name: 'Ramesh', id: 'G1', tl: 'GV TL', priority: 'High', cur: { vc4: 3, comm: 0, total: 3 }, last: { vc4: 0, comm: 0, total: 0 }, stock: { vc4: 5, comm: 0, total: 5 } }
  ];
  const cfg = { ...DEFAULT_DISPATCH_EMAIL, channel: 'all', basis: 'total', priority: 'all', sections: ['summary', 'agents'] };
  const now = new Date('2026-10-01T06:30:00.000Z');
  const plan = buildDispatchPlan(sources, cfg, { days: 15, now, elapsed: { ff: 30, gv: 1 }, months: { ff: '2026-09', gv: '2026-10' } });
  assert.equal(plan.agents.find((r) => r.ch === 'ff').rate, 10);
  assert.equal(plan.agents.find((r) => r.ch === 'gv').rate, 3);
  assert.deepEqual(plan.elapsed, { ff: 30, gv: 1 });
  const mail = dispatchEmailContent(plan, cfg, 'ApnaPayment', '01 Oct 2026');
  assert.match(mail.text, /FF 30 \(2026-09\) · GV 1 \(2026-10\)/);
  // fallback (overlay basis na ho): 1 Oct ka (aaj − 1) = 30 Sep → 30 din, 1 nahi
  const fb = buildDispatchPlan(sources, cfg, { days: 15, now });
  assert.equal(fb.elapsed, 30, 'DAY(TODAY() − 1) = 30');
});

// ---- (2) kpiDetail drill inference -------------------------------------------------------------------
const opened = [];
FF.app = { openDrawer: (o) => opened.push(o), closeDrawer() {} };
FF.auth = { can: () => true, user: { username: 'admin' } };
FF.store.need = async () => []; FF.store.get = () => undefined;
require(path.join(ROOT, 'kpiDetail.js'));
const K = FF.kpiDetail;
const card = (title, kpi, value) => ({ nodeType: 1, dataset: kpi ? { kpi, kpiTitle: title } : { kpiTitle: title }, querySelector: () => (value ? { textContent: value } : null) });
U.$ = (sel, el) => (el && el.querySelector ? el.querySelector(sel) : null);

test('kpiDetail: ym month-naam normalise (Performance card "September" → YYYY-09)', () => {
  const y = new Date().getFullYear(), mo = new Date().getMonth();
  assert.equal(K.normYm('2026-09'), '2026-09');
  assert.equal(K.normYm('Sep 2026'), '2026-09');
  assert.equal(K.normYm('September-26'), '2026-09');
  const sep = K.normYm('September');
  assert.equal(sep, `${mo >= 8 ? y : y - 1}-09`, 'aaj se aage ka month pichhle saal ka');
  const spec = K.specFrom(card('Sep issued', 'src=ff&scope=mtd&ym=September', '2,624'));
  assert.match(spec.ym, /^\d{4}-09$/);
  assert.equal(spec.cardValue, '2,624', 'card ki value drawer banner ke liye');
});

test('kpiDetail: "last month" / month-name / stock / holders / priority cards ka sahi scope', () => {
  const lm = K.specFrom(card('Issued last month'));
  assert.equal(lm.scope, 'month', 'pehle "mtd" (is mahine) ho jaata tha');
  assert.match(lm.ym, /^\d{4}-\d{2}$/);
  const named = K.specFrom(card('Aug total'));
  assert.ok(['month', 'mtd'].includes(named.scope)); assert.match(named.ym, /-08$/);
  const vs = K.specFrom(card('Projected vs Aug'));
  assert.notEqual(vs.ym, named.ym, '"vs Aug" comparison hai — August nahi kholna');
  const v4 = K.specFrom(card('VC4 stock'));
  assert.equal(v4.scope, 'stock'); assert.equal(v4.f, 'vc4');
  const holders = K.specFrom(card('Agents with Stock'));
  assert.equal(holders.scope, 'stock'); assert.equal(holders.holders, 'agents');
  const tls = K.specFrom(card('TLs with Stock'));
  assert.equal(tls.holders, 'tls');
  const hp = K.specFrom(card('High Priority'));
  assert.equal(hp.scope, 'people'); assert.equal(hp.level, 'High');
  const ina = K.specFrom(card('Inactive'));
  assert.equal(ina.scope, 'people'); assert.equal(ina.state, 'inactive');
  const y = K.specFrom(card('Yesterday tags'));
  assert.equal(y.scope, 'day'); assert.equal(y.date, (() => { const d = new Date(); d.setDate(d.getDate() - 1); return U.dateKey(d); })());
});

test('kpiDetail: list provider — card ki ginti = list ki ginti, rows clickable (agent)', async () => {
  K.registerList('test.rows', () => ({ kicker: 'Test', unit: 'agents', rows: [{ n: 'A', id: '1' }, { n: 'B', id: '2' }], columns: [['Agent', (r) => r.n]], agent: (r) => ({ name: r.n, id: r.id, ch: 'ff' }), headline: { value: 77, unit: 'tags' } }));
  opened.length = 0;
  await K.open({ scope: 'list', list: 'test.rows', src: 'ff', title: 'Test list' });
  const last = opened[opened.length - 1];
  assert.match(last.sub, /<b>77<\/b> tags · 2 agents/);
  assert.match(last.body, /data-kd-agent="A"/);
  assert.equal(last.age && last.age.kind, 'all', 'drawer me stock ageing (network) scope');
});

test('kpiDetail: agent row click usi period (month / range) par — "is mahine" par nahi', async () => {
  opened.length = 0;
  await K.open({ scope: 'month', ym: '2026-08', src: 'ff', title: 'Aug' });
  const handler = (docListeners.click || [])[0];
  assert.ok(handler, 'document click handler');
  const row = { dataset: { kdAgent: 'Ravi', kdAgentId: 'R1', kdAgentChannel: 'ff' } };
  const target = { closest: (sel) => (sel === '[data-kd-agent]' ? row : null) };
  opened.length = 0;
  await handler({ target, preventDefault() {} });
  await new Promise((r) => setTimeout(r, 30));
  const spec = opened.map((o) => o.title).join(' | ');
  assert.match(spec, /Ravi/);
  const final = opened[opened.length - 1];
  assert.match(final.sub || '', /Aug 2026|2026-08|Aug/, `month scope bacha rehna chahiye — ${final.sub}`);
});

// ---- (3) loaders ---------------------------------------------------------------------------------------
test('loader: 6 alag style, mix me har baar agla · spinner role=status + animated dots', () => {
  assert.deepEqual(U.LOADER_STYLES, ['ring', 'dots', 'bars', 'pulse', 'tag', 'orbit']);
  const seen = new Set();
  for (let i = 0; i < 12; i++) seen.add((U.loader().match(/data-ffl="(\w+)"/) || [])[1]);
  assert.equal(seen.size, 6, 'mix mode sab styles ghumata hai');
  localStorage.setItem('ff_loader_style', 'tag');
  assert.match(U.loader(), /ffl-tag/);
  assert.match(U.loader(), /ffl-tag/, 'pasand ka style fixed');
  localStorage.removeItem('ff_loader_style');
  const sp = U.spinner('Data aa raha hai…');
  assert.match(sp, /role="status"/); assert.match(sp, /class="ffl ffl-\w+ ffl-lg"/); assert.match(sp, /ffl-ell/);
  assert.ok(!/…<span class="ffl-ell"/.test(sp), 'text ka apna "…" hata ke animated dots');
});

test('CSS: reduced-motion (OS + app toggle) me bhi loader animate · app toggle class sahi', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*html \.ffl > i[^{]+\{\s*animation-duration: var\(--ffl-dur, 1\.2s\) !important; animation-iteration-count: infinite !important;/);
  assert.match(css, /html\.a11y-motion \.ffl > i/);
  assert.ok(!/\.page-loader-spin, \.skel::after, \.app-boot img \{ animation: none !important; \}/.test(css), 'purana rule jo loader band karta tha hata');
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.match(app, /reducedMotion: 'a11y-motion'/);
  assert.match(app, /function routeProgress/);
});
