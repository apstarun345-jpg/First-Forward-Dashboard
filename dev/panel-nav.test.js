/* 🧭 Panel navigation + 📊 data-update alerts + 🎤 "Meri awaaz" record — v3.23 regression lock.
   Ye bug production me tha: parseHash() har lazy page (settings, warRoom, executive, gv* …) ko
   uska module load hone se PEHLE chup-chaap firstAllowedPage (Home) par bhej deta tha — isliye
   panel ke options click par khulte hi nahi the, aur same link dobara click karne par hash same
   hone se kuch hota hi nahi tha.

   Locks karta hai:
     • FF.app.resolvePage / parseHash — lazy module bina load ke bhi PAGES registry se valid page
       resolve karte hain (warRoom, settings, gvStockReport … Home par redirect NAHI),
     • alias map (gvPartner→gvDashboard, comparison→compare, gv-ff→tagIssued) + unknown → fallback,
     • same-hash link dobara click par page re-render + hover/tap par lazy module prefetch,
     • checkFeedChange: pehla snapshot chup-chaap baseline, totals badalne par localAlert
       (title/body/meta + voiceText) — hi aur en dono me,
     • U.analyzeVoiceCapture — startVoiceCapture() ka live handle accept karta hai aur khud
       stop() karke uska result analyse karta hai ("Meri awaaz" record flow). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// ---- minimal browser globals (app.js ko load karne ke liye) ----
const ls = new Map();
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, String(v)),
  removeItem: (k) => ls.delete(k)
};
globalThis.location = { hash: '', search: '', href: 'http://localhost/', pathname: '/' };
globalThis.window = globalThis;
globalThis.window.top = globalThis.window;      // embed-live check
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.document = {
  title: '',
  visibilityState: 'visible',
  hidden: false,
  documentElement: { dataset: {}, classList: { toggle() {}, remove() {} } },
  body: { classList: { add() {}, remove() {}, toggle() {} } },
  addEventListener: () => {},
  removeEventListener: () => {}
};

globalThis.FF = {
  util: {
    esc: (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    fmt: (n) => Number(n || 0).toLocaleString('en-IN'),
    $: () => null,
    $$: () => [],
    h: () => ({ remove() {} }),
    toast: () => {}
  },
  config: { appName: 'Test Dashboard', features: {} },
  auth: {
    user: { username: 'boss', role: 'admin' },
    can: () => true,
    isAdmin: () => true,
    api: async () => ({})
  }
};

require(path.join(ROOT, 'util.js'));   // analyzeVoiceCapture fix ke liye (FF.util real)
require(path.join(ROOT, 'app.js'));
const FF = globalThis.FF;

// ================= 1) parseHash / resolvePage — lazy pages kabhi Home par redirect nahi =================
test('resolvePage — lazy page (module load se pehle bhi) valid: warRoom / settings / gvStockReport', () => {
  // FF.pages me abhi kuch nahi — jaisa cold start par hota hai (lazy modules load nahi hue)
  assert.ok(!FF.pages || !FF.pages.warRoom, 'precondition: warRoom module abhi load nahi');
  assert.equal(FF.app.resolvePage('warRoom'), 'warRoom');
  assert.equal(FF.app.resolvePage('settings'), 'settings');
  assert.equal(FF.app.resolvePage('gvStockReport'), 'gvStockReport');
  assert.equal(FF.app.resolvePage('executive'), 'executive');
  assert.equal(FF.app.resolvePage('stockRadar'), 'stockRadar');
});

test('resolvePage — aliases map hote hain; unknown id par first-allowed fallback', () => {
  assert.equal(FF.app.resolvePage('gvPartner'), 'gvDashboard');
  assert.equal(FF.app.resolvePage('comparison'), 'compare');
  assert.equal(FF.app.resolvePage('gvd'), 'gvDashboard');
  assert.equal(FF.app.resolvePage('gv-ff'), 'tagIssued');
  assert.equal(FF.app.resolvePage('nonsense-page-xyz'), 'home'); // auth.can stub true → home
  assert.equal(FF.app.resolvePage(''), 'home');
});

test('parseHash — #/warRoom?x=1 seedha warRoom khola (Home redirect nahi)', () => {
  globalThis.location.hash = '#/warRoom?x=1';
  const r = FF.app.parseHash();
  assert.equal(r.page, 'warRoom');
  assert.equal(r.params.x, '1');
});

test('parseHash — sheet deep-link + settings params + alias hash', () => {
  globalThis.location.hash = '#/sheet/StockDataa';
  let r = FF.app.parseHash();
  assert.equal(r.page, 'sheet');
  assert.equal(r.params.name, 'StockDataa');

  globalThis.location.hash = '#/settings?tab=account';
  r = FF.app.parseHash();
  assert.equal(r.page, 'settings');
  assert.equal(r.params.tab, 'account');

  globalThis.location.hash = '#/comparison';
  assert.equal(FF.app.parseHash().page, 'compare');
});

// ================= 2) Panel clicks instant — prefetch + same-link re-click =================
test('app.js — nav hover/tap par lazy prefetch + same-link click par re-render (dead click fix)', async () => {
  const src = await fs.readFile(path.join(ROOT, 'app.js'), 'utf8');
  assert.match(src, /prefetchFrom/, 'nav links par module prefetch handler hai');
  assert.match(src, /mouseover/, 'hover par prefetch');
  assert.match(src, /pointerdown', \(e\) => prefetchFrom/, 'tap (pointerdown) par bhi prefetch');
  assert.match(src, /sameLink[\s\S]{0,240}renderCurrent\(\)/, 'current page ka link dobara click → re-render');
  assert.match(src, /await FF\.lazy\.ensure\(page\)/, 'renderCurrent page module ensure karta hai');
});

// ================= 3) checkFeedChange — data update notification + voice =================
test('checkFeedChange — baseline chup, totals change par localAlert (voice text ke saath)', async () => {
  const alerts = [];
  globalThis.localStorage.removeItem('ff_feed_sig'); // clean baseline
  FF.notifications = {
    localAlert: (o) => { alerts.push(o); return o; }
  };
  FF.data = {
    today: async () => ({ ok: true, ff: { total: 10, series: { '2026-09-29': 10 } }, gv: { total: 5, series: { '2026-09-29': 5 } } })
  };
  // 1) pehla snapshot = baseline (koi alert nahi)
  const first = await FF.app.checkFeedChange(true);
  assert.equal(first.ff, 10);
  assert.equal(first.gv, 5);
  assert.equal(alerts.length, 0, 'baseline par koi notification nahi');

  // 2) totals same → koi alert nahi
  await FF.app.checkFeedChange(true);
  assert.equal(alerts.length, 0, 'same data par koi notification nahi');

  // 3) naya data (FF 10→14, GV 5→6) → ek alert, details ke saath
  FF.data.today = async () => ({ ok: true, ff: { total: 14, series: { '2026-09-29': 14 } }, gv: { total: 6, series: { '2026-09-29': 6 } } });
  await FF.app.checkFeedChange(true);
  assert.equal(alerts.length, 1, 'data change par notification aata hai');
  const a = alerts[0];
  assert.equal(a.type, 'report');
  assert.match(a.title, /Data update/);
  assert.match(a.body, /\+?4|\+?5/, 'delta body me hai');
  assert.ok(a.voiceText && a.voiceText.length > 5, 'voice announcement text hai');
  assert.equal(a.meta.link, '#/tagIssued');
});

test('checkFeedChange — backdated correction (series change, totals same) par bhi alert', async () => {
  const alerts = [];
  globalThis.localStorage.removeItem('ff_feed_sig'); // clean baseline
  FF.notifications = { localAlert: (o) => { alerts.push(o); return o; } };
  FF.data = { today: async () => ({ ok: true, ff: { total: 20, series: { '2026-09-28': 8, '2026-09-29': 12 } }, gv: { total: 3, series: {} } }) };
  await FF.app.checkFeedChange(true); // baseline
  FF.data = { today: async () => ({ ok: true, ff: { total: 20, series: { '2026-09-28': 9, '2026-09-29': 11 } }, gv: { total: 3, series: {} } }) };
  await FF.app.checkFeedChange(true);
  assert.equal(alerts.length, 1, 'series (recent days) change par bhi notification');
});

test('announceDataUpdate — English mode me English voice text', () => {
  const alerts = [];
  FF.notifications = { localAlert: (o) => { alerts.push(o); return o; } };
  FF.assistant = { getLang: () => 'en' };
  FF.app.announceDataUpdate({ ff: 10, gv: 2 }, { ff: 13, gv: 2, s: '' });
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].voiceText, /Data update!/);
  assert.match(alerts[0].body, /Today's total/);
  FF.assistant = { getLang: () => 'hi' };
  FF.app.announceDataUpdate({ ff: 10, gv: 2 }, { ff: 13, gv: 2, s: '' });
  assert.match(alerts[1].voiceText, /Data update!/);
  assert.match(alerts[1].body, /Aaj ka total/);
});

// ================= 4) Meri awaaz — analyzeVoiceCapture live handle ko khud stop karta hai =================
function sinePcm(hz, seconds, sampleRate, amp = 0.35) {
  const n = Math.floor(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

test('analyzeVoiceCapture — startVoiceCapture() ka handle: stop() khud call hota hai, result analyse', async () => {
  let stopped = 0;
  const handle = {
    startedAt: Date.now(),
    state: () => 'recording',
    stop: async () => {
      stopped++;
      return { blob: null, pcm: sinePcm(150, 2.2, 48000), sampleRate: 48000, seconds: 2.2 };
    }
  };
  const res = await FF.util.analyzeVoiceCapture(handle);
  assert.equal(stopped, 1, 'handle.stop() call hua (warna mic band hi nahi hota tha)');
  assert.equal(res.ok, true);
  assert.ok(Math.abs(res.hz - 150) <= 12, `hz ${res.hz} ~150`);
  assert.equal(res.gender, 'male');
});

test('analyzeVoiceCapture — stop() ka result (legacy form) bhi chalta hai; khali par friendly error', async () => {
  const res = await FF.util.analyzeVoiceCapture({ pcm: sinePcm(200, 2.2, 8000), sampleRate: 8000, seconds: 2.2 });
  assert.equal(res.ok, true);
  assert.equal(res.gender, 'female');
  await assert.rejects(() => FF.util.analyzeVoiceCapture({}), /dobara|nahi/i);
});
