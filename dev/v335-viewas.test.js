import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// v3.35 — 👁 View-as-user (admin preview) — idea #82:
//   • admin startViewAs kare to can()/isAdmin() target user ke permissions par chalein (bypass band).
//   • preview sessionStorage me rahe (tab refresh safe) lekin non-admin login/logout par clear.
//   • settings me Preview button + app.js me exit banner + preview-aware gates wired hain.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const makeStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear()
  };
};

const fakeEl = () => ({
  innerHTML: '', style: {}, hidden: false,
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  appendChild() {}, insertBefore() {}, removeChild() {}, remove() {},
  addEventListener() {}, removeEventListener() {}, focus() {}, select() {},
  setAttribute() {}, removeAttribute() {},
  querySelector: () => null, querySelectorAll: () => []
});

const utilStub = {
  esc: (v) => String(v == null ? '' : v),
  $: () => null,
  $$: () => [],
  h: () => fakeEl(),
  toast() {},
  fmt: (v) => String(v == null ? 0 : v),
  timeLabel: () => ''
};

const adminMe = {
  user: { username: 'boss', name: 'Boss Admin', role: 'admin', permissions: [] },
  permissions: ['home'], settings: null
};
const userMe = {
  user: { username: 'ram', name: 'Ram User', role: 'user', permissions: ['home'] },
  permissions: ['home'], settings: null
};

async function loadAuth(mePayload, session = makeStorage()) {
  const FF = { util: utilStub, pages: {}, config: {}, notifications: null };
  const fetchStub = async () => ({ ok: true, status: 200, json: async () => mePayload });
  const sandbox = {
    window: { FF }, FF, console,
    fetch: fetchStub, AbortController, setTimeout, clearTimeout,
    sessionStorage: session, localStorage: makeStorage(),
    location: { hash: '', pathname: '/', search: '', replace() {}, reload() {} },
    requestAnimationFrame: (f) => f(),
    document: { documentElement: { style: { setProperty() {} } }, title: '', body: { appendChild() {} }, createElement: () => fakeEl() }
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8'), sandbox, { filename: 'auth.js' });
  await FF.auth.init();
  return { FF, session, sandbox };
}

test('startViewAs — admin ka bypass band, can() target permissions par chalta hai', async () => {
  const { FF, session } = await loadAuth(adminMe);
  assert.equal(FF.auth.can('export'), true, 'admin sab kar sakta hai');
  assert.equal(FF.auth.isAdmin(), true);

  const ok = FF.auth.startViewAs({ username: 'ravi', name: 'Ravi Kumar', role: 'user', permissions: ['home', 'agentSummary', 'export'], mobile: '9876543210' });
  assert.equal(ok, true);
  assert.equal(FF.auth.viewingAs().username, 'ravi');
  assert.equal(FF.auth.can('agentSummary'), true, 'target ki permission chalu');
  assert.equal(FF.auth.can('export'), true);
  assert.equal(FF.auth.can('share'), false, 'admin bypass band (share nahi mila)');
  assert.equal(FF.auth.can('contacts'), false);
  assert.equal(FF.auth.isAdmin(), false, 'preview me admin nahi');
  assert.equal(FF.auth.viewAsUser.name, 'Ravi Kumar');
  assert.equal(FF.auth.viewAsUser.mobile, '9876543210');
  assert.ok(session.getItem('ff_viewas'), 'sessionStorage me persist');

  assert.equal(FF.auth.stopViewAs(), true);
  assert.equal(FF.auth.viewingAs(), null);
  assert.equal(FF.auth.can('share'), true, 'exit ke baad wapas admin');
  assert.equal(FF.auth.isAdmin(), true);
  assert.equal(session.getItem('ff_viewas'), null, 'sessionStorage se hat gaya');
});

test('startViewAs — non-admin real account se preview shuru nahi ho sakta', async () => {
  const { FF } = await loadAuth(userMe);
  assert.equal(FF.auth.startViewAs({ username: 'x', role: 'user', permissions: ['home'] }), false);
  assert.equal(FF.auth.viewingAs(), null);
  assert.equal(FF.auth.can('home'), true, 'apni permission waisi hi');
});

test('restore — tab refresh ke baad preview bana, lekin non-admin login par clear', async () => {
  const session = makeStorage();
  session.setItem('ff_viewas', JSON.stringify({ username: 'ravi', name: 'Ravi', role: 'user', permissions: ['home'] }));

  const a = await loadAuth(adminMe, session);
  assert.equal(a.FF.auth.viewingAs().username, 'ravi', 'admin init ke baad preview restore');
  assert.equal(a.FF.auth.can('home'), true);
  assert.equal(a.FF.auth.can('export'), false);

  // Usi tab me kisi non-admin ne login kiya → preview clear.
  const b = await loadAuth(userMe, session);
  assert.equal(b.FF.auth.viewingAs(), null, 'non-admin ko preview nahi milta');
  assert.equal(session.getItem('ff_viewas'), null);
});

test('logout — preview bhi saath me clear', async () => {
  const { FF, session } = await loadAuth(adminMe);
  FF.auth.startViewAs({ username: 'ravi', role: 'user', permissions: ['home'] });
  assert.ok(session.getItem('ff_viewas'));
  await FF.auth.logout();
  assert.equal(FF.auth.viewingAs(), null, 'logout par preview gaya');
  assert.equal(session.getItem('ff_viewas'), null);
});

test('wiring — settings Preview button + app.js banner + preview-aware gates', () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const settings = read('settings.js');
  assert.match(settings, /data-user-viewas/, 'Users card me Preview button');
  assert.match(settings, /A\.startViewAs\(u\)/, 'button handler startViewAs call karta hai');
  assert.match(settings, /location\.hash !== '#\/home'/, 'preview start par home navigate');

  const app = read('app.js');
  assert.match(app, /FF\.auth\.viewingAs \? FF\.auth\.viewingAs\(\) : null/, 'viewAsBanner state read karta hai');
  assert.match(app, /id="viewas-banner"/, 'banner markup');
  assert.match(app, /id="viewas-exit"/, 'exit button');
  assert.match(app, /FF\.auth\.stopViewAs\(\)/, 'exit handler stopViewAs');
  assert.match(app, /function renderCurrent[\s\S]{0,200}viewAsBanner\(\);/, 'renderCurrent har navigation par banner check');
  assert.match(app, /p\.adminOnly && !FF\.auth\.isAdmin\(\)/, 'featOk preview-aware (teamMap jaise adminOnly pages)');
  assert.match(app, /FF\.auth\.viewAsUser \|\| FF\.auth\.user/, 'top-user card target user dikhata hai');
  assert.match(app, /u && !FF\.auth\.isAdmin\(\)/, 'liveShareChip preview-aware');

  const palette = read('palette.js');
  assert.match(palette, /FF\.auth\.isAdmin \? FF\.auth\.isAdmin\(\)/, 'command palette admin items preview-aware');
  const live = read('liveAssist.js');
  assert.match(live, /FF\.auth\.isAdmin \? FF\.auth\.isAdmin\(\)/, 'live assist admin gate preview-aware');
  const tag = read('tagRequest.js');
  assert.match(tag, /FF\.auth\.isAdmin \? FF\.auth\.isAdmin\(\)/, 'tag request isAdmin preview-aware');

  const css = read('styles.css');
  assert.match(css, /\.viewas-banner \{ position: fixed; top: 0;/, 'banner CSS strip');
});
