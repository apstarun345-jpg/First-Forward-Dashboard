/* ⚡ v3.73 — "Opening your workspace" boot contract (client request):
     1. Splash (3-4s) ke DAURAN hi saara data background me load ho — preload renderCurrent se PEHLE.
     2. Return visitor par data warm-up /api/auth/me ke PARALLEL me.
     3. Home render (bootGate) apne SAARE sections paint karne ke baad hi resolve — Home par
        spinner nahi, poora data instant dikhe.
     4. Public /tag-request form: module download config fetch ke parallel me (site loading fast).
   Har check ka reason comment me — warna koi "chhoti si" clean-up inhe wapas tod deta hai. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFile(path.join(ROOT, f), 'utf8');

test('🚀 splash ke DAURAN data load: critical warm-up + preload renderCurrent se pehle start', async () => {
  const app = await read('app.js');
  // Main (non-embed) login path — EMBED_LIVE mirror ka apna alag flow hai.
  const onLogin = app.slice(app.indexOf("bootSetMessage('Loading your workspace…'"));
  assert.ok(onLogin.length > 500, 'onLogin ka main path mila');
  const warmAt = onLogin.indexOf('warmCriticalData(false)');
  const preloadAt = onLogin.indexOf('const preloadPromise = FF.preloader ? FF.preloader.preloadAll(false)');
  const renderAt = onLogin.indexOf('await renderCurrent({ bootGate: true })');
  const releaseAt = onLogin.indexOf('await releaseWorkspaceBoot()');
  assert.ok(warmAt >= 0 && preloadAt >= 0 && renderAt >= 0 && releaseAt >= 0, 'warm-up + preload + bootGate render + release sab hain');
  assert.ok(warmAt < preloadAt, 'home ke critical datasets (daily/stock/report/GV master/feeds) sabse pehle start');
  assert.ok(preloadAt < renderAt, 'preloadAll renderCurrent se PEHLE — splash ke 3-4 second bekaar nahi jaate');
  assert.ok(renderAt < releaseAt, 'renderCurrent ke baad hi splash release (bootGate = poora data paint)');
  assert.match(app, /function warmCriticalData\(preAuth\)/, 'warm-up helper defined hai');
  // 3-4s animation window wahi raha (client ne isi ko describe kiya tha).
  assert.match(app, /const WORKSPACE_BOOT_MIN_MS = 3000/);
  assert.match(app, /const WORKSPACE_BOOT_MAX_MS = 3900/);
});

test('⚡ return visitor par data warm-up auth check ke parallel me', async () => {
  const app = await read('app.js');
  const init = app.slice(app.indexOf('async function init()'));
  assert.match(init, /const returning = !!\(localStorage\.getItem\('ff_user'\) \|\| localStorage\.getItem\('ff_feed_sig'\)\)/, 'return-visitor hint check hota hai');
  const warmAt = init.indexOf('warmCriticalData(true)');
  const authAt = init.indexOf('await FF.auth.init()');
  assert.ok(warmAt >= 0 && authAt >= 0, 'warm-up + auth init dono init() me hain');
  assert.ok(warmAt < authAt, 'warm-up /api/auth/me ke saath parallel chalta hai (splash window me data bhi load)');
});

test('🏠 Home bootGate: splash hatne se pehle saare sections ke data ka intezaar', async () => {
  const home = await read('home.js');
  assert.match(home, /async function render\(root, params, renderCtx\)/, 'render ko boot context milta hai');
  const gateAt = home.indexOf('if (renderCtx && renderCtx.bootGate)');
  assert.ok(gateAt > 0, 'bootGate await block hai');
  const gate = home.slice(gateAt, gateAt + 900);
  assert.match(gate, /Promise\.allSettled\(pending\)/, 'saare data promises settle hone ka intezaar');
  assert.match(gate, /setTimeout\(resolve, 4200\)/, 'soft cap — hung fetch renderCurrent ko hamesha ke liye block nahi karta');
  for (const p of ['liveP', 'feedP', 'dailyP', 'stockP', 'gvStockP', 'gvMasterP', 'targetAchievementDataP', 'gvStockAgentP']) {
    assert.ok(gate.includes(p), `bootGate await list me ${p}`);
  }
});

test('🌐 public /tag-request: module download config fetch ke parallel me (site loading fast)', async () => {
  const pf = await read('publicForm.js');
  const boot = pf.slice(pf.indexOf('async function boot()'));
  const moduleAt = boot.indexOf("FF.lazy.ensure('tagRequest')");
  const configAt = boot.indexOf("api('/api/public/tag-request')");
  assert.ok(moduleAt >= 0 && configAt >= 0, 'module ensure + config fetch dono boot() me hain');
  assert.ok(moduleAt < configAt, 'lazy module download config round-trip ke saath parallel chalta hai');
  assert.match(boot, /await moduleP/, 'render se pehle module load ka intezaar hota hai');
});

test('🧼 splash-skip flag external script me (CSP script-src self inline script block karta hai)', async () => {
  const idx = await read('index.html');
  const boot = await read('ui-boot.js');
  assert.doesNotMatch(idx, /<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/, 'index.html me koi inline script nahi');
  assert.match(boot, /ff_skip_workspace_boot_once/, 'skip-splash logic ui-boot.js me hai');
  assert.match(boot, /skip-workspace-boot/, 'html class body-parse se pehle lagti hai (splash flash nahi)');
});
