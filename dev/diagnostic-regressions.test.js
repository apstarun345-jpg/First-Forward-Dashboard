import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (name) => fs.readFileSync(new URL(`../${name}.js`, import.meta.url), 'utf8');
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('combined FF/GV report paints the ready channel before the other finishes', async () => {
  const ff = deferred(), gv = deferred(), late = {};
  const pane = { isConnected: true, innerHTML: '' };
  const ctx = vm.createContext({
    channelsOf: () => ['ff', 'gv'], loadingHtml: () => 'loading',
    MP: () => ({ _buildSoon: (p, onLate) => { late[p.kind] = onLate; return p.kind === 'ff' ? ff.promise : gv.promise; } }),
    combinedHtml: (_g, prs) => JSON.stringify(prs), esc: (s) => s
  });
  const src = read('searchReport');
  vm.runInContext(src.slice(src.indexOf('  async function fillCombined('), src.indexOf('  /** `slot`')) + '\nthis.fill = fillCombined;', ctx);
  const job = ctx.fill(pane, { name: 'Agent', ff: { kind: 'ff' }, gv: { kind: 'gv' } });
  ff.resolve({ name: 'FF ready', total: 11 }); await tick();
  assert.match(pane.innerHTML, /FF ready/, 'ready FF data must not stay behind a spinner');
  assert.match(pane.innerHTML, /"gv":null/);
  assert.match(pane.innerHTML, /combined totals abhi partial/);
  gv.resolve({ name: 'GV ready', total: 22 }); await job;
  assert.match(pane.innerHTML, /GV ready/);
  late.ff({ name: 'FF upgraded', total: 12 });
  assert.match(pane.innerHTML, /FF upgraded/);
  pane.isConnected = false;
  const previous = pane.innerHTML;
  late.gv({ name: 'closed view' });
  assert.equal(pane.innerHTML, previous);
});

test('issuance-only report does not inherit an in-flight stock-prefetch wait', async () => {
  const stock = deferred();
  const ctx = vm.createContext({
    REPORT_CTX: { cache: new Map() },
    FF: { stockAge: {}, kpiDetail: { rawRowsFor: async () => [['issuance']] } },
    stockTagsFor: () => stock.promise, ageScopeOfPr: () => ({}),
    reportSpecs: () => ({ spec: 'issuance', isTl: false }), setTimeout: () => 0
  });
  const src = read('masterSearch');
  vm.runInContext(src.slice(src.indexOf('  function reportData('), src.indexOf('  function prefetchReport(')) + '\nthis.report = reportData;', ctx);
  const person = { name: 'Agent', id: 'A1' };
  const full = ctx.report('ff', person, true);
  const issue = ctx.report('ff', person, false);
  let ready = null;
  issue.then((data) => { ready = data; });
  await tick();
  assert.ok(ready, 'issuance finishes while the stock promise is still unresolved');
  assert.equal(ready.issue.length, 1); assert.equal(ready.stock.length, 0);
  stock.resolve([{ barcode: 'test' }]);
  assert.equal((await full).stock.length, 1);
});

test('GV live polling continues after Master loads, recovers without an initial feed, and coalesces polls', async () => {
  let now = 0, poll;
  const response = deferred(), calls = [];
  const ctx = vm.createContext({
    Date: { now: () => now }, root: { isConnected: true }, document: { hidden: false }, canGv: true,
    liveFromFeed: null, liveState: { source: 'master' },
    FF: { config: {}, data: { gvToday: () => { calls.push('feed'); return response.promise; } }, gv: { syncApiToday: async () => { calls.push('details'); return true; } } },
    setInterval: (fn) => { poll = fn; return 1; }, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, liveTimer: null,
    feedMatchesCurrentClassMap: () => true,
    handleQuick: (_q, refreshing) => { assert.equal(refreshing, true); calls.push('paint-feed'); },
    applyMasterSnapshot: () => calls.push('paint-details')
  });
  const src = read('home');
  const block = src.slice(src.indexOf('    let liveLast = Date.now()'), src.indexOf('    // 30-day history is background only'));
  vm.runInContext(block, ctx);
  now = 61000; poll(); poll();
  assert.deepEqual(calls, ['feed', 'details'], 'only one refresh in flight, even with Master as the current source');
  response.resolve({ gv: { total: 12 } }); await tick();
  assert.ok(calls.includes('paint-feed')); assert.ok(calls.includes('paint-details'));
  ctx.document.hidden = true; now = 122000; poll();
  assert.equal(calls.filter((c) => c === 'feed').length, 1, 'hidden tabs do not poll');
});

test('fresh GV response upgrades Master totals; late initial or stale feeds do not regress them', () => {
  const ctx = vm.createContext({
    root: { isConnected: true }, liveState: { source: 'master', total: 10, highest: { VC4: { n: 10 } } },
    liveFromFeed: null, feedLiveRows: [], liveRows: [], liveSourceReady: false, liveTry: 0,
    ui: { ready: false }, feedMatchesCurrentClassMap: () => true, liveRowsFromFeed: () => [],
    paintLive() {}, liveSaveLast() {}, retryLive() {}, expectedFromWeekdaySeries: () => null, todayK: () => '2026-11-25'
  });
  const src = read('home');
  vm.runInContext(src.slice(src.indexOf('    function handleQuick('), src.indexOf('    liveP.then(handleQuick)')) + '\nthis.handle = handleQuick;', ctx);
  ctx.handle({ gv: { total: 4 } });
  assert.equal(ctx.liveState.total, 10);
  ctx.handle({ gv: { total: 15, stale: true } }, true);
  assert.equal(ctx.liveState.total, 10);
  ctx.handle({ gv: { total: 15, vc4: 15, expected: 20 } }, true);
  assert.equal(ctx.liveState.total, 15);
  assert.equal(ctx.liveState.highest, null, 'old highest-issuer details must not be presented as part of a newer aggregate');
});

test('hung GV detail fetch aborts, releases its timer, and allows the next refresh', async () => {
  let abortTimer, cleared = 0;
  const ctx = vm.createContext({
    AbortController, state: { apiToday: null },
    setTimeout: (fn, ms) => { assert.equal(ms, 15000); abortTimer = fn; return 1; },
    clearTimeout: () => cleared++,
    fetch: (_url, opts) => new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(new Error('aborted'))))
  });
  const src = read('gv');
  vm.runInContext(src.slice(src.indexOf('  async function syncApiToday('), src.indexOf('  // v3.125.505 — masterTodayRows')) + '\nthis.sync = syncApiToday;', ctx);
  const first = ctx.sync(); abortTimer();
  assert.equal(await first, false); assert.equal(cleared, 1);
  ctx.fetch = async () => ({ ok: true, json: async () => ({ ok: true, at: 1, day: '2026-11-25', rows: [] }) });
  assert.equal(await ctx.sync(), true);
  assert.equal(await ctx.sync(), false, 'unchanged snapshot does not request a repaint');
  ctx.fetch = async () => ({ ok: true, json: async () => ({ ok: true, at: 1, day: '2026-11-26', rows: [] }) });
  assert.equal(await ctx.sync(), true, 'day rollover is a change even if the timestamp is unchanged');
  assert.equal(cleared, 4);
});
