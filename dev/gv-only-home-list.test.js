import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Expose these private functions only inside the test VM.
const src = fs.readFileSync(new URL('../home.js', import.meta.url), 'utf8')
  .replace('  FF.pages.home = {', '  FF.testGvOnly = { stockHtml, paintGvOnlyChip, openStockMapDrawer };\n  FF.pages.home = {');
function setup(canExport = true) {
  const calls = [], drawers = [];
  const tags = Array.from({ length: 5631 }, (_, i) => ({ tagId: `TAG-${i}`, barcode: String(900000 + i), cls: 'VC4', bucket: 'GV only', gvAgent: 'Agent', age: '', remark: 'Not In FF Stock' }));
  const host = { innerHTML: '', querySelector: () => null, addEventListener() {} };
  const FF = {
    util: { esc: (v) => String(v ?? ''), fmt: (v) => Number(v).toLocaleString('en-IN'), ymKey: () => '2026-10', dateKey: () => '2026-10-29', asValueSet: (v) => new Set(v || []), spinner: () => 'loading', toast() {} },
    model: { summary: () => ({}) }, store: {}, gv: {}, charts: { bars: () => '', donut: () => '' },
    auth: { can: (p) => p === 'export' && canExport, api: async (url) => { calls.push(url); return { total: tags.length, rows: tags }; } },
    app: { openDrawer: (opts) => { drawers.push(opts); return host; } }, pages: {}
  };
  vm.runInNewContext(src, { window: { FF }, FF, setTimeout, clearTimeout, console });
  return { FF, calls, drawers, host };
}
function el() { return { handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; } }; }
function chip() {
  const nodes = { '.kpi-value': {}, '.kpi-foot': {}, '.hm-gvonly-actions': { hidden: true }, '.hm-gvonly-open': el(), '[data-gvo-list]': el(), '[data-gvo-summary]': el() };
  return { isConnected: true, nodes, querySelector: (s) => nodes[s] };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('GV-only Home card exposes direct list and CSV, respecting export permission', () => {
  for (const canExport of [true, false]) {
    const { FF } = setup(canExport);
    const html = FF.testGvOnly.stockHtml(null, null, { ff: [], gv: [] });
    assert.match(html, /data-gvo-list/);
    assert.match(html, /data-gvo-summary/);
    assert.equal(html.includes('/api/stock-map/csv?bucket=gvonly'), canExport);
  }
});

test('GV-only card loads all 5,631 matching tags separately with CSV, while class summary remains accessible', async () => {
  const { FF, calls, drawers, host } = setup();
  const c = chip();
  FF.testGvOnly.paintGvOnlyChip(c, { gvOnly: { total: 5631, assigned: 5000, unassigned: 631, rows: [{ cls: 'VC4', type: 'Car', n: 5631 }] } });
  assert.equal(c.nodes['.kpi-value'].textContent, '5,631');
  assert.equal(c.nodes['.hm-gvonly-actions'].hidden, false);
  c.nodes['.hm-gvonly-open'].handlers.click();
  await tick();
  assert.match(calls[0], /bucket=gvonly.*all=1/);
  assert.match(host.innerHTML, /TAG-0/);
  assert.match(host.innerHTML, /TAG-5630/);
  assert.match(host.innerHTML, /5,631 tags/);
  assert.match(host.innerHTML, /\/api\/stock-map\/csv\?bucket=gvonly/);
  assert.doesNotMatch(host.innerHTML, /smap-more/);
  c.nodes['[data-gvo-summary]'].handlers.click();
  assert.match(drawers.at(-1).sub, /GV Not Assigned: 631/);
  assert.match(drawers.at(-1).body, /VC4/);
});

test('GV-only list keeps pagination when more than 10,000 tags exist', async () => {
  const { FF, host } = setup();
  FF.auth.api = async () => ({ total: 10001, rows: Array.from({ length: 10001 }, (_, i) => ({ tagId: `TAG-${i}`, barcode: '', cls: 'VC4', age: '' })) });
  FF.testGvOnly.openStockMapDrawer('gvonly', '');
  await tick();
  assert.match(host.innerHTML, /TAG-9999/);
  assert.doesNotMatch(host.innerHTML, /TAG-10000/);
  assert.match(host.innerHTML, /smap-more/);
});
