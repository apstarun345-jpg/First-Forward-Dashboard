import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// v3.35 — Agent / TL Summary access control:
//   • reportHtml ke buttons sirf admin-granted export/share permission par render hon.
//   • mobile number sirf `contacts` permission par (header / text / JSON / xlsx).
//   • ID / TL ID hamesha visible (v3.35 fix — gradient me ghulne wala .dim).
//   • CSS: .as-head .dim white, .as-drop .dim hardcoded (theme/pack-proof).
//   FF.auth missing ho to default allow — purane tests fixtures safe rahein.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ctxStub = {
  fillStyle: '#000', textBaseline: 'alphabetic', font: '10px x',
  fillRect() {}, fillText() {}, measureText: () => ({ width: 10 }),
  beginPath() {}, rect() {}, fill() {}, roundRect() {}, save() {}, restore() {}
};
const makeCanvas = () => ({
  width: 0, height: 0,
  getContext: () => ctxStub,
  toDataURL: () => 'data:image/jpeg;base64,' + Buffer.alloc(2048, 7).toString('base64')
});

const utilStub = {
  clean: (v) => String(v == null ? '' : v).trim(),
  esc: (v) => String(v == null ? '' : v),
  fmt: (v) => String(v == null ? 0 : v),
  sum: (arr, f) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0),
  growth: (c, p) => (p ? ((c - p) / p) * 100 : null),
  pctHtml: () => '—', slug: (s) => String(s || ''), stamp: () => 'x',
  spinner: () => '…', $: () => null, downloadCsv() {}, downloadBlob() {}, copyText: async () => {}, waLink: () => ''
};

function load(file, util = {}, ffExtra = {}) {
  const FF = { util, pages: {}, config: {}, ...ffExtra };
  const sandbox = {
    window: { FF }, FF, console, Blob, atob, Uint8Array, setTimeout, clearTimeout,
    TextEncoder, TextDecoder, requestAnimationFrame: (f) => f(),
    document: { createElement: () => makeCanvas(), body: { appendChild() {} } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    navigator: {}, File: class { constructor() {} }
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
  return { FF, sandbox };
}

const mockProfile = {
  channel: 'First Forward', kind: 'ff-agent', name: 'José Alvarez', id: 'FF-ID_1045',
  priority: 'High', mobile: '9876543210',
  tl: { name: 'Ramesh Kumar', id: 'TL-77', mobile: '9111111111' },
  totals: { curTotal: 10, curVc4: 4, curComm: 6, lastTotal: 5, lastVc4: 2, lastComm: 3, growth: 100 },
  stock: { vc4: 1, comm: 2, total: 3 },
  months: { cur: '2026-10', last: '2026-09' },
  classes: [{ cls: 'VC4', last: 2, cur: 4, stock: 1 }, { cls: 'Comm', last: 3, cur: 6, stock: 2 }],
  agents: [],
  calc: { total: { rate: 2 } }, projT1: { total: 20 }
};
const mockTlProfile = {
  ...mockProfile, kind: 'ff-tl', name: 'Ramesh Kumar', id: 'TL-77', tl: undefined,
  agents: [{ name: 'José Alvarez', id: 'FF-ID_1045', cur: 10, last: 5, stockVc4: 1, stockComm: 2 }]
};

// perms: Set of granted permissions. undefined → FF.auth hi nahi (default allow).
async function reportWith(perms, profile = mockProfile, person = { kind: 'ff-agent', name: 'José Alvarez', id: 'FF-ID_1045', tl: '' }) {
  const auth = perms == null ? undefined : { can: (p) => perms.includes(p) };
  const ffExtra = auth ? { auth } : {};
  const { FF } = load('agentSummary.js', utilStub, ffExtra);
  FF.masterProfile = {
    build: async () => profile,
    csvRows: () => [['Name', profile.name]]
  };
  const report = await FF.agentSummary.buildReport(person);
  return { FF, report };
}

test('reportHtml — FF.auth missing ho to sab kuch dikhe (default allow, legacy/tests safe)', async () => {
  const { FF, report } = await reportWith(null);
  const html = FF.agentSummary.reportHtml(report);
  for (const k of ['pdf', 'excel', 'csv', 'json', 'share', 'wa', 'copy']) {
    assert.ok(html.includes(`data-as-act="${k}"`), `data-as-act="${k}" default par visible`);
  }
  assert.ok(html.includes('href="tel:9876543210"'), 'mobile link default par visible');
  assert.ok(html.includes('ID: <b>FF-ID_1045</b>'), 'Agent ID default par visible');
  assert.ok(html.includes('TL-77'), 'TL ID default par visible');
  assert.equal(typeof FF.agentSummary.reportHtml, 'function', 'reportHtml export');
});

test('reportHtml — export ke bina pdf/excel/csv/json aur Team Pack gayab, share chalu', async () => {
  const { FF, report } = await reportWith(['share', 'contacts']);
  const html = FF.agentSummary.reportHtml(report);
  for (const k of ['pdf', 'excel', 'csv', 'json']) {
    assert.ok(!html.includes(`data-as-act="${k}"`), `data-as-act="${k}" export-free user ko nahi`);
  }
  assert.ok(html.includes('data-as-act="share"') && html.includes('data-as-act="wa"') && html.includes('data-as-act="copy"'), 'share buttons visible');
  assert.ok(html.includes('href="tel:9876543210"'), 'contacts hai → mobile visible');

  const tl = await reportWith(['share'], mockTlProfile, { kind: 'ff-tl', name: 'Ramesh Kumar', id: 'TL-77' });
  const tlHtml = tl.FF.agentSummary.reportHtml(tl.report);
  assert.ok(!tlHtml.includes('data-as-pack'), 'Team Pack buttons export permission ke bina nahi');
  assert.ok(tlHtml.includes('data-as-wa'), 'per-agent WA share permission par hai');
});

test('reportHtml — share ke bina share/wa/copy + per-agent WA gayab, export chalu', async () => {
  const { FF, report } = await reportWith(['export', 'refresh']);
  const html = FF.agentSummary.reportHtml(report);
  for (const k of ['share', 'wa', 'copy']) {
    assert.ok(!html.includes(`data-as-act="${k}"`), `data-as-act="${k}" share-free user ko nahi`);
  }
  for (const k of ['pdf', 'excel', 'csv', 'json']) {
    assert.ok(html.includes(`data-as-act="${k}"`), `data-as-act="${k}" export user ko visible`);
  }
  assert.ok(!html.includes('href="tel:'), 'contacts nahi → header me mobile nahi');

  const tl = await reportWith(['export', 'refresh'], mockTlProfile, { kind: 'ff-tl', name: 'Ramesh Kumar', id: 'TL-77' });
  const tlHtml = tl.FF.agentSummary.reportHtml(tl.report);
  assert.ok(tlHtml.includes('data-as-pack'), 'Team Pack export par visible');
  assert.ok(!tlHtml.includes('data-as-wa'), 'per-agent WA share ke bina nahi');
});

test('reportHtml — na export na share → actions row hi gayab; IDs phir bhi visible', async () => {
  const { FF, report } = await reportWith([]);
  const html = FF.agentSummary.reportHtml(report);
  assert.ok(!html.includes('class="as-actions"'), 'actions row tab nahi jab koi permission hi nahi');
  assert.ok(html.includes('ID: <b>FF-ID_1045</b>'), 'Agent ID permission se independent hai (task-1 fix)');
  assert.ok(html.includes('TL-77'), 'TL ID permission se independent hai');
});

test('contacts permission — mobile sirf tab: header link / reportText / reportJson / reportXlsx', async () => {
  const off = await reportWith(['export', 'share']);
  const offHtml = off.FF.agentSummary.reportHtml(off.report);
  assert.ok(!offHtml.includes('href="tel:'), 'header me tel link nahi (contacts off)');
  assert.ok(!off.FF.agentSummary.reportText(off.report).includes('📞 Mobile:'), 'reportText me mobile line nahi');
  const offJson = JSON.parse(off.FF.agentSummary.reportJson(off.report));
  assert.equal(offJson.person.mobile, '', 'reportJson me mobile empty');
  const offSum = off.FF.agentSummary.reportXlsx(off.report).find((s) => s.name === 'Summary');
  assert.ok(offSum.rows.some((r) => r[0] === 'Mobile' && r[1] === ''), 'xlsx Mobile row khali');
  assert.ok(off.FF.agentSummary.reportText(off.report).includes('TL-77'), 'TL ID text me visible rehta hai');
  assert.ok(!off.FF.agentSummary.reportJson(off.report).includes('9111111111'), 'TL mobile bhi gated (csvRows jaisa)');

  const on = await reportWith(['export', 'share', 'contacts']);
  const onHtml = on.FF.agentSummary.reportHtml(on.report);
  assert.ok(onHtml.includes('href="tel:9876543210"'), 'contacts on → header tel link wapas');
  assert.ok(on.FF.agentSummary.reportText(on.report).includes('📞 Mobile: 9876543210'), 'reportText me mobile wapas');
  const onJson = JSON.parse(on.FF.agentSummary.reportJson(on.report));
  assert.equal(onJson.person.mobile, '9876543210', 'reportJson me mobile wapas');
  const onSum = on.FF.agentSummary.reportXlsx(on.report).find((s) => s.name === 'Summary');
  assert.ok(onSum.rows.some((r) => r[0] === 'Mobile' && r[1] === '9876543210'), 'xlsx Mobile row wapas');
});

test('render-time gates source me hain — refresh / ageing drawer / click handlers', () => {
  const src = fs.readFileSync(path.join(ROOT, 'agentSummary.js'), 'utf8');
  assert.match(src, /can\('refresh'\)\s*\?\s*`<button class="btn" id="as-refresh-btn"/, 'refresh button can(refresh) par');
  assert.match(src, /actions: can\('export'\)\s*\?/, 'ageing drawer CSV/PDF export par');
  assert.match(src, /\['pdf', 'excel', 'csv', 'json'\]\.includes\(k\) && !can\('export'\)/, 'click handler export guard');
  assert.match(src, /\['share', 'wa', 'copy'\]\.includes\(k\) && !can\('share'\)/, 'click handler share guard');
  assert.match(src, /if \(!can\('share'\)\) \{ U\.toast\('Share permission nahi hai'/, 'per-agent WA guard');
  assert.match(src, /if \(!can\('export'\)\) \{ U\.toast\('Download permission nahi hai'/, 'Team Pack guard');
  assert.match(src, /canContacts\(\) && MP\(\) && MP\(\)\.mobileFor/, 'WA link me mobile sirf contacts ke saath');
});

test('CSS fix — .as-head .dim white (gradient par readable) + .as-drop .dim hardcoded', () => {
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  assert.match(css, /\.as-head \.dim \{ color: rgba\(255, 255, 255, \.9\); \}/, 'header dim ko white kiya');
  assert.match(css, /\.as-drop \.dim \{ color: #475569; \}/, 'dropdown dim hardcoded (theme/pack-proof)');
});

