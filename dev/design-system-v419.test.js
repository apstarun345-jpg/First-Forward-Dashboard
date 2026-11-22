import test from 'node:test'; import assert from 'node:assert'; import fs from 'node:fs'; import vm from 'node:vm'; import { fileURLToPath } from 'node:url';
const d = fileURLToPath(new URL('..', import.meta.url)); const r = (f) => fs.readFileSync(d + f, 'utf8');
function store(init) { const m = new Map(Object.entries(init)); return { get length() { return m.size; }, key: (i) => [...m.keys()][i], getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; }
test('janitor: stale removed, live kept, other apps untouched', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const ls = store({ ff_sound: '1', ff_recent: '[]', 'ff_stk_alert_2020-01-01': '1', [`ff_stk_alert_${today}`]: '1', ff_totally_removed_feature_xyz: 'x', other_app: 'keep', 'ff_dspst|abc': 'k' });
  const ctx = { window: {}, localStorage: ls, sessionStorage: store({}), caches: { keys: async () => ['apnapayment-v10', 'apnapayment-v12', 'other'], delete: async () => true }, setTimeout: () => 0, console };
  ctx.window = ctx; ctx.FF = {}; vm.createContext(ctx); vm.runInContext(r('janitor.js'), ctx);
  const res = await ctx.FF.janitor.run(true);
  assert.ok(!ls._m.has('ff_stk_alert_2020-01-01') && ls._m.has(`ff_stk_alert_${today}`));
  assert.ok(!ls._m.has('ff_totally_removed_feature_xyz'));
  assert.ok(ls._m.has('ff_sound') && ls._m.has('other_app') && ls._m.has('ff_dspst|abc'));
  assert.strictEqual(res.caches, 1);
});
test('v419 wiring', () => {
  const i = r('index.html'); ['tokens.css', 'revamp.css', 'icons.js', 'styleguide.js', 'janitor.js'].forEach((f) => assert.ok(i.includes(f), f));
  const m = r('ui-motion.js'); ['kpiPrev', 'reveal', 'morph', 'sharedInit', 'microInit', 'railInit', 'profileTabs', 'miniBars'].forEach((f) => assert.ok(m.includes(f), f));
  assert.ok(!r('styles.css').includes('.tbl tbody tr:nth-child(even) { background: rgba(255, 255, 255, .02)'));
});
