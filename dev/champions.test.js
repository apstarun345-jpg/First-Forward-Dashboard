import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src = fs.readFileSync(new URL('../champions.js', import.meta.url), 'utf8');
function run(highestSeq) {
  const store = {}; const pushed = [];
  const ctx = { window: {}, localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } }, document: { querySelector: () => null }, Date, JSON, Object, String, Math, console };
  ctx.window.FF = { mascot: { push: (i) => pushed.push(i) } };
  Object.defineProperty(ctx.localStorage, 'length', { get: () => Object.keys(store).length });
  ctx.Object = Object; vm.createContext(ctx);
  vm.runInContext(src.replace(/Object\.keys\(localStorage\)/, 'Object.keys(store0)').replace('window.FF = window.FF', 'window.FF = window.FF'), Object.assign(ctx, { store0: store }));
  for (const h of highestSeq) ctx.window.FF.champions.update(h);
  return pushed;
}
test('champion announced at 5, 10, 15 once each, per class', () => {
  const mk = (a, b, c) => ({ VC4: a && { name: 'RAM', n: a }, VC20: b && { name: 'SHYAM', n: b }, 'VC5+': c && { name: 'MOHAN', n: c } });
  const p = run([mk(4, 2, 0), mk(5, 2, 0), mk(7, 5, 0), mk(10, 5, 5), mk(10, 5, 5), mk(16, 5, 5)]);
  const keys = p.map((x) => x.title + ':' + x.big);
  assert.deepEqual(keys, ['🏆 Aaj ka VC4 champion:5', '🏆 Aaj ka VC20 champion:5', '🏆 Aaj ka VC4 champion:10', '🏆 Aaj ka VC5+ champion:5', '🏆 Aaj ka VC4 champion:16'].map((k) => k));
  assert.match(p[0].say, /चैंपियन/);
});
test('new leader overtaking within same tier is announced', () => {
  const p = run([{ VC4: { name: 'RAM', n: 6 } }, { VC4: { name: 'SITA', n: 8 } }]);
  assert.equal(p.length, 2); assert.match(p[1].head, /SITA/);
});
