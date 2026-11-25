import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = (name) => fs.readFileSync(new URL(`../${name}.js`, import.meta.url), 'utf8');
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function setup(t) {
  const timers = new Set();
  const context = vm.createContext({
    console, URLSearchParams,
    setTimeout: (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; },
    clearTimeout: (id) => { clearTimeout(id); timers.delete(id); },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {}, removeEventListener() {},
    document: { documentElement: { dataset: {}, style: {} }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] }
  });
  context.window = context;
  t.after(() => timers.forEach(clearTimeout));
  for (const name of ['config', 'util', 'model']) vm.runInContext(source(name), context, { filename: name + '.js' });
  const FF = context.FF;
  const agent = (id, total) => ({ name: 'Same Name', id, agentId: id, curVc4: total, curTotal: total, stockVc4: 5, stockTotal: 5, week: [], tlExcluded: true });
  const agents = [agent('A1', 10), agent('A2', 20)];
  const ffGate = deferred(), gvGate = deferred(), calls = [];
  FF.auth = { can: () => true };
  FF.pages = { performance: { agents: () => agents, ensureLoaded: async () => { calls.push('performance'); }, daysElapsed: () => 15, dayLabels: () => [] } };
  FF.store = { get: () => [], need: (key) => { calls.push('ff:' + key); return key === 'stockAgents' ? ffGate.promise : Promise.resolve([]); } };
  FF.gv = { enabled: () => true, get: () => [], rows: () => [], normClass: (c) => c,
    need: (key) => { calls.push('gv:' + key); return key === 'master' ? gvGate.promise : Promise.resolve([]); } };
  vm.runInContext(source('masterProfile'), context, { filename: 'masterProfile.js' });
  return { MP: FF.masterProfile, agents, calls, ffGate, gvGate };
}
const person = (kind, sub) => ({ kind, sub, name: 'Same Name' });

test('profile opens from memory without waiting for sheets; shared consumers get the complete late upgrade', async (t) => {
  const { MP, agents, calls, ffGate } = setup(t);
  assert.equal(MP._limits.openSoftMs, 0, 'no intentional 12-second profile wait');
  const late1 = deferred(), late2 = deferred();
  const start = performance.now();
  const pendingDetails = MP.loadFor(person('ff-agent', 'A1'));
  const [kpis, report] = await Promise.all([
    MP._buildSoon(person('ff-agent', 'A1'), late1.resolve),
    MP._buildSoon(person('ff-agent', 'A1'), late2.resolve)
  ]);
  assert.ok(performance.now() - start < 1000, 'memory snapshot does not wait for the blocked sheet');
  assert.equal(kpis, report, 'KPI and report reuse the same in-flight profile snapshot');
  assert.equal(kpis.partial, true);
  assert.equal(kpis.totals.curTotal, 10);
  for (const key of ['performance', 'ff:daily', 'ff:agentClass', 'ff:agents', 'ff:stockAgents']) assert.equal(calls.filter((x) => x === key).length, 1, key + ' only loads once');
  agents[0].curVc4 = agents[0].curTotal = 17;
  ffGate.resolve([]);
  await pendingDetails;
  const [full1, full2] = await Promise.all([late1.promise, late2.promise]);
  assert.equal(full1, full2, 'one complete build shared by subscribers');
  assert.ok(!full1.partial);
  assert.equal(full1.totals.curTotal, 17);
  const reopened = await MP._buildSoon(person('ff-agent', 'A1'));
  assert.equal(reopened.totals.curTotal, 17);
  assert.equal(calls.filter((x) => x === 'ff:stockAgents').length, 2, 'completed jobs do not become an indefinitely stale cache');
});

test('same-name different IDs and channels stay isolated while channel loading is coalesced', async (t) => {
  const { MP, calls, ffGate, gvGate } = setup(t);
  const late = [deferred(), deferred(), deferred()];
  const [a, b, gv] = await Promise.all([
    MP._buildSoon(person('ff-agent', 'A1'), late[0].resolve),
    MP._buildSoon(person('ff-agent', 'A2'), late[1].resolve),
    MP._buildSoon(person('gv-agent', 'A1'), late[2].resolve)
  ]);
  assert.notEqual(a, b); assert.notEqual(a, gv);
  assert.equal(a.totals.curTotal, 10); assert.equal(b.totals.curTotal, 20);
  assert.equal(gv.ch, 'gv');
  assert.equal(calls.filter((x) => x === 'ff:stockAgents').length, 1);
  assert.equal(calls.filter((x) => x === 'gv:master').length, 1);
  ffGate.resolve([]); gvGate.resolve([]);
  await Promise.all(late.map((x) => x.promise));
});

test('an old profile response cannot overwrite the active profile export context', async () => {
  const pending = new Map(), callbacks = new Map();
  const REPORT_CTX = { name: '', prs: {} };
  const profile = {
    quick: (p) => ({ name: p.name }),
    _buildSoon: (p, onLate) => { const job = deferred(); pending.set(p.name, job); callbacks.set(p.name, onLate); return job.promise; }
  };
  const context = vm.createContext({
    MP: () => profile, FF: {}, U: { $: () => context.activeHost }, REPORT_CTX,
    root: { isConnected: true }, out: {}, current: null, activeHost: null,
    payCanSee: () => false, kpiStripHtml: (pr) => pr.name, kpiLoadingHtml: () => 'loading',
    fillAgeBoxes() {}, fillDispBoxes() {}, fillKycBoxes() {}, fillIssBoxes() {}, paintRank() {}, prefetchReport() {}
  });
  const src = source('masterSearch');
  vm.runInContext(src.slice(src.indexOf('    async function paintKpis('), src.indexOf('    function displayGroupForChannel(')) + '\nthis.paintKpis = paintKpis;', context);
  const group = (name) => ({ key: name, name, ff: { name } });
  const oldHost = { isConnected: true }, newHost = { isConnected: true };
  context.current = group('Old Agent'); context.activeHost = oldHost;
  const oldPaint = context.paintKpis(context.current, oldHost);
  oldHost.isConnected = false;
  context.current = group('New Agent'); context.activeHost = newHost;
  const newPaint = context.paintKpis(context.current, newHost);
  pending.get('New Agent').resolve({ name: 'New Agent full' }); await newPaint;
  pending.get('Old Agent').resolve({ name: 'Old Agent full' }); await oldPaint;
  callbacks.get('Old Agent')({ name: 'Old Agent late' });
  assert.equal(REPORT_CTX.name, 'New Agent');
  assert.equal(REPORT_CTX.prs.ff.name, 'New Agent full');
  assert.equal(newHost.innerHTML, 'New Agent full');
});

test('report download keeps the clicked identity if another name opens during module loading', async () => {
  const modules = deferred(), downloads = [], requested = [], moduleRequests = [];
  const REPORT_CTX = { name: 'Clicked Agent', prs: { ff: { name: 'Clicked Agent', id: 'A1' } } };
  const context = vm.createContext({
    REPORT_CTX, AGE_BUCKETS: [], AGE_HEAD: [],
    U: { slug: (s) => s, stamp: () => 'now', toast() {} },
    FF: { lazy: { shellNeed: (names) => { moduleRequests.push(...names); return modules.promise; } }, xlsx: { download: (...args) => downloads.push(args) } },
    reportData: async (_ch, pr) => { requested.push(pr); return { stock: [], issue: [] }; },
    pivot: () => ({ rows: [], cols: [] })
  });
  const src = source('masterSearch');
  vm.runInContext(src.slice(src.indexOf('  async function downloadFullReport('), src.indexOf('  // ===== 📈 Growth drill')) + '\nthis.download = downloadFullReport;', context);
  const job = context.download(null, ['cur']);
  REPORT_CTX.name = 'Other Agent'; REPORT_CTX.prs = { gv: { name: 'Other Agent', id: 'G2' } };
  modules.resolve(); await job;
  assert.equal(requested[0].id, 'A1');
  assert.deepEqual(moduleRequests, ['kpiDetail'], 'issuance-only export does not load stock ageing');
  assert.equal(downloads.length, 1);
  assert.match(downloads[0][0], /^Clicked Agent-/);
  assert.equal(downloads[0][1][0].rows[0][1], 'Clicked Agent');
});

test('growth drawer and issuance-only reports never wait for stock ageing', async () => {
  const src = source('masterSearch');
  const growth = src.slice(src.indexOf('  async function openGrowth('));
  assert.match(growth, /const d = await reportData\(ch, pr, false\)/);
  const context = vm.createContext({
    REPORT_CTX: { cache: new Map() }, FF: { stockAge: {}, kpiDetail: { rawRowsFor: async () => [['issuance row']] } },
    reportSpecs: () => ({ spec: 'issuance', from: '2026-10-01', to: '2026-11-25' }),
    ageScopeOfPr: () => ({}), stockTagsFor: () => { throw new Error('stock query must not run'); },
    setTimeout: () => 0
  });
  vm.runInContext(src.slice(src.indexOf('  function reportData('), src.indexOf('  function prefetchReport(')) + '\nthis.reportData = reportData;', context);
  const data = await context.reportData('ff', { name: 'Agent', id: 'A1' }, false);
  assert.equal(data.stock.length, 0);
  assert.equal(data.issue.length, 1);
});
