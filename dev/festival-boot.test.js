/* 🪔 v197 — festival splash: tareekh ke hisaab se sahi tyohaar chunta hai (aane se pehle countdown, din par greeting, baad me tail),
   kuch na ho to kuch inject nahi karta, ?fest= preview + ff_fest=off band karta hai, index.html me sync script paint se pehle. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = await fs.readFile(path.join(ROOT, 'festival-boot.js'), 'utf8');

function run(today, { search = '', ls = {} } = {}) {
  const injected = { style: '', html: '', attr: '' };
  const boot = { querySelector: () => ({ nextSibling: null }), firstChild: null, insertBefore: (el) => { injected.html = el.innerHTML; } };
  const document = {
    getElementById: (id) => (id === 'app-boot' ? boot : null),
    createElement: () => ({ set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, set textContent(v) { injected.style = v; } }),
    head: { appendChild: () => {} },
    documentElement: { setAttribute: (k, v) => { injected.attr = v; } }
  };
  const win = { __FF_FEST_TODAY: today, matchMedia: () => ({ matches: false }) };
  vm.runInNewContext(src, { window: win, document, location: { search }, localStorage: { getItem: (k) => ls[k] || null }, Date, Math }, { filename: 'festival-boot.js' });
  return { fest: win.FF_FEST, injected };
}

test('aaj (17 Oct 2026): Navratri chal rahi hai → Navratri greeting, aage Dussehra + Diwali', () => {
  const { fest, injected } = run('2026-10-17');
  assert.equal(fest.key, 'navratri');
  assert.match(injected.html, /Shubh Navratri/);
  assert.match(injected.html, /Dussehra · 20 Oct \(3 din\)/);
  assert.match(injected.html, /Diwali · 8 Nov \(22 din\)/, 'bada tyohaar (Diwali) hamesha "Aage" me');
  assert.equal(injected.attr, 'navratri');
  assert.match(injected.style, /@keyframes festRise/);
});

test('Dussehra → Diwali countdown → Dhanteras → Diwali → Govardhan → Bhai Dooj → Chhath', () => {
  const pick = (d) => (run(d).fest || {}).key;
  assert.equal(pick('2026-10-20'), 'dussehra');
  assert.equal(pick('2026-10-21'), 'dussehra', 'tail 1 din');
  assert.equal(pick('2026-10-22'), 'diwali', 'Diwali 30 din pehle se countdown');
  assert.equal(pick('2026-10-29'), 'karwa');
  assert.equal(pick('2026-11-06'), 'dhanteras');
  assert.equal(pick('2026-11-07'), 'diwali');
  assert.equal(pick('2026-11-08'), 'diwali');
  assert.equal(pick('2026-11-09'), 'govardhan');
  assert.equal(pick('2026-11-11'), 'bhaidooj');
  assert.equal(pick('2026-11-15'), 'chhath');
  const soon = run('2026-10-22');
  assert.equal(soon.fest.kind, 'soon');
  assert.match(soon.injected.html, /8 Nov · 17 din baaki/);
  assert.match(run('2026-11-08').injected.html, /Aaj hai!/);
});

test('fixed-date festivals har saal (Christmas, New Year, Independence Day) + 2027/2028 lunar dates', () => {
  const pick = (d) => (run(d).fest || {}).key;
  assert.equal(pick('2026-12-25'), 'christmas');
  assert.equal(pick('2027-01-01'), 'newyear');
  assert.equal(pick('2029-08-15'), 'independence');
  assert.equal(pick('2027-03-22'), 'holi');
  assert.equal(pick('2027-10-28'), 'diwali');
  assert.equal(pick('2028-10-17'), 'diwali');
  assert.equal(pick('2026-09-20'), 'ganesh', 'Ganesh utsav 10 din');
});

test('koi tyohaar paas nahi → kuch inject nahi (splash bilkul normal, zero cost)', () => {
  const r = run('2026-06-10');
  assert.equal(r.fest, undefined);
  assert.equal(r.injected.html, '');
  assert.equal(r.injected.style, '');
});

test('?fest=holi preview force karta hai; localStorage ff_fest=off band karta hai', () => {
  assert.equal(run('2026-06-10', { search: '?fest=holi' }).fest.key, 'holi');
  assert.equal(run('2026-10-17', { ls: { ff_fest: 'off' } }).fest, undefined);
});

test('index.html: festival-boot.js sync, #app-boot ke turant baad (CSP-safe external script), motion-off respect', async () => {
  const html = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
  const bootEnd = html.indexOf('<div class="boot-progress"></div>');
  const tag = html.indexOf('<script src="/festival-boot.js');
  assert.ok(bootEnd > 0 && tag > bootEnd && tag < html.indexOf('<aside class="sidebar"'), 'splash ke baad, sidebar se pehle');
  assert.doesNotMatch(html.slice(tag - 5, tag + 80), /async|defer/, 'sync — paint se pehle');
  assert.match(src, /prefers-reduced-motion/);
  assert.match(src, /ff-no-anim/);
  assert.ok(src.length < 22000, 'chhota rakho (fast): ' + src.length);
});
