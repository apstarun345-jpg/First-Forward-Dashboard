/* v198 — GV & FF Tag Issued redesign: date shortcuts, previous-period logic, KPI structure */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'tagIssued.js'), 'utf8');

function load() {
  const U = {
    esc: (s) => String(s), pad2: (n) => String(n).padStart(2, '0'),
    dateKey: (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    labelDate: (d) => String(d), growth: (c, p) => (p ? ((c - p) / Math.abs(p)) * 100 : null)
  };
  const ctx = { FF: { util: U, model: {}, store: {}, gv: {}, charts: {}, filters: null }, localStorage: {}, location: {}, history: {} };
  ctx.window = ctx;
  vm.runInNewContext(src, ctx);
  return ctx.FF.pages.tagIssued._test;
}
const T = load();
const at = (y, m, d) => new Date(y, m - 1, d);

test('presets: today / yesterday / last7 / thisMonth / lastMonth', () => {
  const now = at(2026, 10, 18);
  assert.equal(JSON.stringify(T.presetRange('today', now)), JSON.stringify(['2026-10-18', '2026-10-18']));
  assert.equal(JSON.stringify(T.presetRange('yesterday', now)), JSON.stringify(['2026-10-17', '2026-10-17']));
  assert.equal(JSON.stringify(T.presetRange('last7', now)), JSON.stringify(['2026-10-12', '2026-10-18']));
  assert.equal(JSON.stringify(T.presetRange('last30', now)), JSON.stringify(['2026-09-19', '2026-10-18']));
  assert.equal(JSON.stringify(T.presetRange('thisMonth', now)), JSON.stringify(['2026-10-01', '2026-10-18']));
  assert.equal(JSON.stringify(T.presetRange('lastMonth', now)), JSON.stringify(['2026-09-01', '2026-09-30']));
  assert.equal(JSON.stringify(T.presetRange('thisWeek', now)), JSON.stringify(['2026-10-12', '2026-10-18'])); // Sunday → Monday start
  assert.equal(T.detectPreset('2026-10-12', '2026-10-18', now), 'last7');
  assert.equal(T.detectPreset('2026-10-03', '2026-10-09', now), 'custom');
});

test('previous period: equal length, month-aligned for month ranges', () => {
  assert.equal(JSON.stringify(T.prevRange('2026-10-12', '2026-10-18')), JSON.stringify(['2026-10-05', '2026-10-11']));
  assert.equal(JSON.stringify(T.prevRange('2026-10-18', '2026-10-18')), JSON.stringify(['2026-10-17', '2026-10-17']));
  assert.equal(JSON.stringify(T.prevRange('2026-10-01', '2026-10-18')), JSON.stringify(['2026-09-01', '2026-09-18']));
  assert.equal(JSON.stringify(T.prevRange('2026-03-01', '2026-03-31')), JSON.stringify(['2026-02-01', '2026-02-28']));
  assert.equal(T.prevRange('2026-10-19', '2026-10-18'), null);
});

test('GV name suggestions and agent/TL summaries obey the selected date range', () => {
  const rows = [
    { key: '2026-10-10', agentName: '  Asha   Singh  ', tlName: 'TL Neha', group: 'VC4', n: 2 },
    { key: '2026-10-11', agentName: 'Asha Singh', tlName: 'TL Neha', group: 'VC20', n: 3 },
    { key: '2026-10-10', agentName: 'Ravi Kumar', tlName: 'TL Neha', group: 'VC5+', n: 4 },
    { key: '2026-10-12', agentName: 'Asha Singh', tlName: 'TL Other', group: 'VC5+', n: 99 }
  ];
  const options = T.personSearchOptions(rows, '2026-10-10', '2026-10-11');
  assert.deepEqual(JSON.parse(JSON.stringify(options)), [
    { channel: 'gv', type: 'agent', name: 'Asha Singh' }, { channel: 'gv', type: 'agent', name: 'Ravi Kumar' }, { channel: 'gv', type: 'tl', name: 'TL Neha' }
  ]);
  const agent = T.personSearchSummary(rows, { type: 'agent', name: 'asha singh' }, '2026-10-10', '2026-10-11');
  assert.equal(agent.totals.total, 5); assert.equal(agent.totals.vc4, 2); assert.equal(agent.totals.vc20, 3);
  const tl = T.personSearchSummary(rows, { type: 'tl', name: 'TL Neha' }, '2026-10-10', '2026-10-11');
  assert.equal(tl.totals.total, 9); assert.equal(tl.totals.vc5p, 4);
  assert.equal(T.personSearchSummary(rows, { type: 'agent', name: 'Asha Singh' }, '2026-10-12', '2026-10-12').totals.total, 99);
  const base = T.buildModel({ ffRows: [], gvRows: [], gvLatest: '2026-10-11' }, '2026-10-10', '2026-10-11');
  const inCards = T.personCardModel(base, rows, [], { channel: 'gv', type: 'agent', name: 'Asha Singh' });
  assert.equal(inCards.gv.total, 5, 'searched agent total is routed into the existing GV KPI cards');
  assert.equal(inCards.gv.vc4, 2); assert.equal(inCards.gv.vc20, 3); assert.equal(inCards.ff.total, 0);
  assert.equal(inCards.personFilter.name, 'Asha Singh');
  const ffRows = [{ key: '2026-10-10', agentName: 'FF Agent One', tlName: 'FF TL', group: 'VC4', n: 7 }];
  const ffModel = T.personCardModel(base, rows, ffRows, { channel: 'ff', type: 'agent', name: 'FF Agent One' });
  assert.equal(ffModel.ff.total, 7, 'First Forward person rows populate the same cards too');
  assert.equal(ffModel.gv.total, 0);
  assert.equal(JSON.stringify(T.personSearchOptions(ffRows, '2026-10-10', '2026-10-11', 'ff')[0]), JSON.stringify({ channel: 'ff', type: 'agent', name: 'FF Agent One' }));
});

test('non-admin Tag Issued-only access does not preload GV Master rows', () => {
  const gv = fs.readFileSync(path.join(root, 'gv.js'), 'utf8');
  assert.match(gv, /anyGvDataPage = pages\.some\(\(page\) => page !== 'tagIssued' && can\(page\)\)/);
  assert.match(gv, /if \(isAdmin \|\| anyGvDataPage \|\| can\('sheet:GV Master'\)\) list\.push\('master'\)/);
});

test('non-admin page markup hides person-level details and KPI drilldown; app globally guards admin-only KPI clicks', () => {
  assert.match(src, /admin \? `.*GV \/ FF agent \/ TL/s);
  assert.match(src, /\$\{admin \? driversShell\(m, preset\) : ''\}/);
  assert.match(src, /\$\{admin \? `<details class="tix-people"/);
  assert.match(src, /cardModel = admin && selectedPerson \? personCardModel\(/);
  assert.match(src, /kpiCard\(k, cardModel, admin\)/);   // v3.125.262 — search ke baad bhi boxes clickable
  assert.ok(!src.includes('personSearchHtml'), 'search result should live inside the existing KPI cards, not in a separate card');
  assert.match(src, /data-admin-only="1"/);
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(app, /kpi\.dataset\.adminOnly === '1'.*FF\.auth\.isAdmin\(\)/s);
});

test('scan sums VC4 / VC20 / VC5+ / commercial and per-day totals inside the range only', () => {
  const rows = [
    { key: '2026-10-10', group: 'VC4', cls: 'VC4', n: 5 }, { key: '2026-10-10', group: 'VC20', cls: 'VC20', n: 2 },
    { key: '2026-10-11', group: 'VC5+', cls: 'VC5', n: 3, type: 'REPLACEMENT' }, { key: '2026-10-12', group: 'VC4', cls: 'VC4', n: 99 }
  ];
  const r = T.scan(rows, '2026-10-10', '2026-10-11');
  assert.equal(r.total, 10); assert.equal(r.vc4, 5); assert.equal(r.vc20, 2); assert.equal(r.vc5p, 3);
  assert.equal(r.comm, 5); assert.equal(r.replacement, 3); assert.equal(r.byDay.get('2026-10-10').total, 7);
});

test('page source: shortcuts, five KPI cards, share, charts and insights are wired', () => {
  for (const id of ['today', 'yesterday', 'last7', 'last30', 'thisMonth', 'lastMonth']) assert.match(src, new RegExp(`\\['${id}'`));
  for (const k of ["key: 'total'", "key: 'vc4'", "key: 'vc20'", "key: 'vc5p'", "key: 'comm'"]) assert.ok(src.includes(k), k);
  for (const needle of ['tix-split', 'tix-row ff', 'verdictHtml', 'C.donut(', 'C.lines(', 'C.bars(', 'C.hbars(', 'insightsHtml', 'h2hTable', 'FF T+1']) assert.ok(src.includes(needle) || src.includes(needle.replace('tix-row ff', 'tix-row ${cls}')), needle);
  assert.match(src, /FF\.pages\.tagIssued = \{ title: 'GV & FF Tag Issued', render \}/);
});

test('GV totals come from the EIR sheet (master ID 5845036 rows); top agents from GV Master', () => {
  assert.match(src, /const gvRows = dailyRows\.filter\(\(r\) => r\.channel === 'GV Partner'\)/, 'GV totals = EIR daily rows');
  assert.match(src, /gvMasterRows = masterReady/, 'GV Master sirf agents/teams ke liye');
  assert.match(src, /rows\.gvMasterRows\.forEach/, 'top agents GV Master se');
  assert.ok(!/masterTodayRows/.test(src), 'GV Master ka today override totals me nahi');
  assert.match(src, /&eir=1'/, 'drill bhi EIR rows kholta hai (count match)');
});

test('GV pending (EIR T+1) is trimmed to the latest EIR date for like-for-like growth', () => {
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = new Date(); const y = new Date(now); y.setDate(y.getDate() - 1); const old = new Date(now); old.setDate(old.getDate() - 20);
  const today = key(now), yest = key(y);
  const rows = { ffRows: [], gvRows: [{ key: yest, group: 'VC4', cls: 'VC4', n: 4 }], gvLatest: yest };
  const m = T.buildModel(rows, today, today);
  assert.equal(m.gvPending, true); assert.equal(m.gvComparable, false, 'sirf aaj: GV kal aayega');
  const w = T.buildModel(rows, key(old), today);
  assert.equal(w.gvPending, true); assert.equal(w.gvComparable, true); assert.equal(w.gvTo, yest);
  const past = T.buildModel(rows, key(old), key(old));
  assert.equal(past.gvPending, false, 'purani date trim nahi hoti');
});

test('data check: freshness strip + EIR vs GV Master reconciliation are wired and never feed totals', () => {
  assert.match(src, /function healthStrip\(rows\)/);
  assert.match(src, /function reconHtml\(m, rows\)/);
  assert.match(src, /\$\{healthStrip\(rows\)\}/);
  assert.match(src, /reconHtml\(m, rows\)/);
  assert.match(src, /G\.masterRows\(\)/, 'raw GV Master rows');
  // masterRows sirf recon me use hota hai, buildModel/totals me nahi
  const buildModel = src.slice(src.indexOf('function buildModel'), src.indexOf('// ---------------------------------------------------------------- view helpers'));
  assert.ok(!/masterRows/.test(buildModel), 'totals me GV Master nahi');
});

test('v201: top search bar watchdog re-mounts #master-search when the module failed to load once', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(app, /function ensureSearchTopbar\(\)/);
  assert.match(app, /ensureShell\(\['masterSearch'\]\)\.then\(/, 'module dobara load hota hai');
  assert.match(app, /window\.addEventListener\('hashchange'/);
  assert.match(app, /setInterval\(\(\) => \{ if \(document\.visibilityState !== 'hidden'\) ensureSearchTopbar\(\); \}, 6000\)/);
  assert.match(app, /shellExtrasStarted = true;\n    startSearchWatchdog\(\);/);
});

test('v3.125.262 — search me saare GV + FF agents / TLs (range ke bahar bhi) + filtered box drill spec', () => {
  const dir = T.personDirectory({
    ffRows: [{ key: '2026-09-01', agentName: 'Old FF Agent', tlName: 'FF TL A', n: 3 }, { key: '2026-10-10', agentName: 'Live FF', tlName: 'FF TL A', n: 2 }],
    gvMasterRows: [{ key: '2026-10-10', agentName: 'GV One', tlName: 'GV TL', n: 4 }],
    ffAgents: [{ name: 'Report Only Agent', id: '123', tlName: 'FF TL B' }],
    gvReport: [{ agentName: 'GV Report Agent', agentId: 'APS1', tlName: 'APS' }]
  }, '2026-10-10', '2026-10-11');
  const names = dir.map((o) => `${o.channel}:${o.type}:${o.name}`);
  for (const n of ['ff:agent:Old FF Agent', 'ff:agent:Report Only Agent', 'ff:tl:FF TL B', 'gv:agent:GV Report Agent', 'gv:tl:GV TL']) assert.ok(names.includes(n), n);
  assert.ok(!names.includes('gv:tl:APS'), 'APS (direct) TL nahi');
  assert.equal(dir[0].name, 'GV One', 'range me zyada tags wale upar');
  const spec = T.specFor({ from: '2026-10-10', to: '2026-10-10', personFilter: { channel: 'ff', type: 'agent', name: 'Live FF' } }, 'both', 'VC4');
  assert.match(spec, /src=ff/); assert.match(spec, /agent=Live%20FF/); assert.match(spec, /pf=1/); assert.match(spec, /eir=1/);
  const gvSpec = T.specFor({ from: '2026-10-10', to: '2026-10-11', personFilter: { channel: 'gv', type: 'tl', name: 'GV TL' } }, 'both', '');
  assert.match(gvSpec, /src=gv/); assert.match(gvSpec, /tl=GV%20TL/); assert.doesNotMatch(gvSpec, /eir=1/);
});
