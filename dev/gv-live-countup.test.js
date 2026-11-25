import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const motion = fs.readFileSync(new URL('../ui-motion.js', import.meta.url), 'utf8');
const home = fs.readFileSync(new URL('../home.js', import.meta.url), 'utf8');
function harness() {
  const frames = [];
  const context = vm.createContext({
    REDUCE: false, document: { documentElement: { classList: { contains: () => false } } },
    location: { hash: '#/home' }, performance: { now: () => 0 },
    requestAnimationFrame: (fn) => frames.push(fn), setTimeout: () => {}
  });
  vm.runInContext(motion.slice(motion.indexOf('  const kpiPrev = new Map();'), motion.indexOf('  function barGrow(')) + '\nthis.run = countUp;', context);
  return { run: context.run, frames };
}
function value(n, spec, { live = false, title = 'VC4' } = {}) {
  const card = {
    querySelector: () => ({ textContent: title }), getAttribute: () => spec,
    classList: { add() {}, remove() {} }
  };
  return {
    textContent: String(n), dataset: {}, children: [], isConnected: true,
    matches: () => true, closest: (selector) => selector === '.kpi' ? card : live ? {} : null,
    classList: { add() {}, remove() {} }
  };
}

test('GV live panel opts out of interpolation for an exact snapshot', () => {
  assert.match(home, /class="kpi-grid mini gv-aaj-grid" data-countup="off"/);
  const h = harness();
  h.run(value(24679, 'src=gv&scope=mtd&f=vc4'));
  h.frames.length = 0;
  const today = [value(317, 'scope=day', { live: true, title: 'Total' }), value(260, 'scope=day&f=vc4', { live: true }), value(53, 'scope=day&f=repl', { live: true, title: 'Replacement' })];
  today.forEach(h.run);
  assert.equal(h.frames.length, 0, 'live numbers must not animate from monthly numbers or from zero');
  assert.deepEqual(today.map((el) => el.textContent), ['317', '260', '53']);
});

test('same title across different periods never reuses previous count', () => {
  const h = harness();
  h.run(value(24679, 'src=gv&scope=mtd&f=vc4'));
  h.frames.length = 0;
  const today = value(260, 'src=gv&scope=day&f=vc4');
  h.run(today);
  assert.equal(h.frames.length, 1);
  h.frames.shift()(0);
  assert.equal(today.textContent, '0', 'first animation starts from zero, not the monthly total');
});

test('same metric can animate a real update, then settles on the exact target', () => {
  const h = harness();
  const spec = 'src=gv&scope=mtd&f=vc4';
  h.run(value(260, spec));
  h.frames.length = 0;
  const updated = value(270, spec);
  h.run(updated);
  const step = h.frames.shift();
  step(0);
  assert.equal(updated.textContent, '260');
  step(1000);
  assert.equal(updated.textContent, '270');
});
