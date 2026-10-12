/* 📱 v3.73 — Native Android shell: wiring + guards. Layout/gestures Playwright se phone par check hue;
   ye test sirf woh contract lock karta hai jo toote to app phir browser jaisa lagne lage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFile(path.join(ROOT, f), 'utf8');

test('native shell loads last: CSS after mobile-fix, JS after app.js', async () => {
  const idx = await read('index.html');
  const pos = (s) => idx.indexOf(s);
  assert.ok(pos('native-shell.css') > pos('mobile-fix.css'), 'native-shell.css mobile-fix ke baad');
  assert.ok(pos('native-app.js') > pos('app.js?v='), 'native-app.js app.js ke baad');
  // Fingerprint map basename par chalta hai — CSS aur JS ka naam alag hona chahiye (warna cache-bust share hota).
  assert.doesNotMatch(idx, /native-app\.css/);
});

test('native-app.js does nothing on desktop (no html.mobile-ui)', async () => {
  const src = await read('native-app.js');
  const classes = new Set();
  const html = { classList: { contains: (c) => classes.has(c), add: (c) => classes.add(c), toggle() {}, remove() {} } };
  const sandbox = { window: {}, document: { documentElement: html, readyState: 'complete', querySelector: () => { throw new Error('desktop par DOM chhoona nahi'); } } };
  sandbox.window.FF = {};
  vm.runInNewContext(src, sandbox);
  assert.equal(classes.has('native-shell'), false);
  assert.equal(sandbox.window.FF.nativeApp, undefined);
});

test('back button closes overlays before leaving the page, and tabs do not pile up history', async () => {
  const src = await read('native-app.js');
  assert.match(src, /history\.pushState\(Object\.assign\(\{\}, history\.state \|\| \{\}, \{ ffOverlay: 1 \}\)/, 'overlay sentinel');
  assert.match(src, /window\.addEventListener\('popstate'/);
  for (const sel of ['#drawer', 'side-open', '#user-menu', '#notification-pop', '#palette-backdrop', 'nab-search-open', '#onboarding-tour', '#ff-saved-views']) {
    assert.ok(src.includes(sel), `overlay handled: ${sel}`);
  }
  assert.match(src, /if \(cur === 'home'\) history\.pushState\(\{ ffFromHome: 1 \}/, 'Home → tab push');
  assert.match(src, /else history\.replaceState\(/, 'tab → tab replace');
});

test('overflow sheet reuses the real topbar buttons instead of duplicating features', async () => {
  const src = await read('native-app.js');
  assert.match(src, /\$\$\('#top-actions button, #top-actions a\[href\]'\)/);
  assert.match(src, /it\.el\.click\(\)/);
  const css = await read('native-shell.css');
  // Topbar ka will-change/transform fixed popovers ko kaid kar leta tha (theme packs screen ke upar chala jaata tha).
  assert.match(css, /will-change: auto !important/);
  assert.match(css, /#top-actions > #master-search \{ display: none !important; \}|#top-actions > #master-search\s*\{\s*display: none/);
});

test('service worker cache bumped so installed apps pick up the new shell', async () => {
  const sw = await read('sw.js');
  const n = Number((sw.match(/apnapayment-v(\d+)/) || [])[1]);
  assert.ok(n >= 126, `CACHE_NAME v${n}`);
});
