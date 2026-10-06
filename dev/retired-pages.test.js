/* 🧹 v3.62 — "simple dashboard" lock.
   Client ne kaha tha: Operations Control Tower · Executive Cockpit · TV Mode · GV & FF Commission
   Intelligence · Charts · Stock Forecasting · TL Scorecard · Stock Radar · poora Workspace group
   aur poora Wow Zone group hata do — taaki site halki rahe aur phone par smooth chale.

   Ye test wapas aa jaane se rokta hai:
     • sidebar (app.js PAGES) me na hon,
     • lazy GROUPS me na hon (warna background me 1 MB+ JS parse hota hai),
     • purana link khule to RETIRED_PAGES se safe page par jaaye (blank/dead route nahi),
     • server ki permission list + default user perms me na hon,
     • jo modules ab kisi page se bind nahi (wow/wowzone/chartExplorer…) unhe warm list me na daala jaaye.
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const app = src('app.js');
const lazy = src('lazy.js');
const server = src('server.js');
const settings = src('settings.js');

const RETIRED = {
  controlTower: 'home', executive: 'home', tv: 'home',
  ffCommission: 'home', gvCommission: 'gvDashboard',
  charts: 'home', forecast: 'stock', tlScorecard: 'performance', stockRadar: 'stock',
  savedViews: 'home', reportStudio: 'home', followups: 'home',
  arena: 'home', fame: 'home', warRoom: 'home', activity: 'home', network: 'home',
  radar: 'home', reportCards: 'home', sprints: 'home'
};

test('sidebar me retired pages nahi hain (aur naya page add karne par bhi ye lock rehta hai)', () => {
  const block = app.slice(app.indexOf('const PAGES = ['), app.indexOf('const GROUP_ICON'));
  const ids = [...block.matchAll(/\{ id: '([\w]+)'/g)].map((m) => m[1]);
  assert.ok(ids.length >= 20, `PAGES parse hue (${ids.length})`);
  for (const page of Object.keys(RETIRED)) {
    assert.ok(!ids.includes(page), `retired page "${page}" sidebar se hatna chahiye`);
  }
  // 👀 jo bache hain wo bache rehne chahiye (galti se kuch zyada na kat jaaye)
  for (const keep of ['home', 'tagIssued', 'targets', 'tagRequest', 'masterSearch', 'rangeReport', 'teamMap',
    'dashboard', 'trend', 'performance', 'stock', 'gvDashboard', 'gvTrend', 'gvPerformance', 'gvStock',
    'gvStockReport', 'dualChannel', 'masterStock', 'compare', 'dataQuality', 'dispatchPlan', 'directAgents',
    'newAgents', 'unusual', 'fastagChampions', 'ffAgentSummary', 'gvAgentSummary']) {
    assert.ok(ids.includes(keep), `"${keep}" sidebar me rehna chahiye`);
  }
  assert.ok(!/group: 'Wow Zone'/.test(block), 'Wow Zone group gaya');
  assert.ok(!/group: 'Workspace'/.test(block), 'Workspace group gaya');
});

test('retired page ka purana link safe page par redirect hota hai (dead route nahi)', () => {
  for (const [page, target] of Object.entries(RETIRED)) {
    assert.ok(new RegExp(`\\b${page}: '${target}'`).test(app), `${page} → ${target} mapping`);
  }
  assert.match(app, /const retiredTarget = /, 'resolvePage/renderCurrent dono yahi use karte hain');
  assert.match(app, /const retired = retiredTarget\(page\);/, 'renderCurrent safety net');
  assert.match(app, /const retired = retiredTarget\(id\);/, 'resolvePage direct redirect');
});

test('retired pages ka module background me download/parse nahi hota', () => {
  const groups = lazy.slice(lazy.indexOf('const GROUPS = {'), lazy.indexOf('const WARM ='));
  for (const page of Object.keys(RETIRED)) {
    assert.ok(!new RegExp(`^\\s{4}${page}: \\[`, 'm').test(groups), `lazy GROUPS me "${page}" nahi hona chahiye`);
  }
  // Bache hue pages ka module map intact hai.
  for (const keep of ['home', 'dashboard', 'stock', 'performance', 'gvDashboard', 'dispatchPlan', 'settings']) {
    assert.ok(new RegExp(`^\\s{4}${keep}: \\[`, 'm').test(groups), `lazy GROUPS me "${keep}" hona chahiye`);
  }
  // 🌃 wowzone (~66 KB) ab kisi page ki dependency nahi aur warm list me bhi nahi.
  assert.ok(!/WARM = \[[^\]]*wowzone/.test(lazy), 'wowzone warm list me nahi');
  assert.ok(!/dashboard: \[.*wow/.test(lazy), 'dashboard wow modules nahi kheenchta');
  assert.match(app, /bindThemePackButton/, '🎨 button click par hi wowzone load karta hai');
  assert.match(app, /if \(savedThemePack\(\) === 'default' && touchShell\(\)\) return;/, 'phone par wowzone auto-load nahi');
});

test('server permissions + settings me retired pages nahi bachte', () => {
  const perms = server.slice(server.indexOf('export const PAGE_PERMISSIONS = ['), server.indexOf('// Sheet-tab registry defaults'));
  for (const page of Object.keys(RETIRED)) {
    assert.ok(!new RegExp(`key: '${page}'`).test(perms), `PAGE_PERMISSIONS me "${page}" nahi`);
    assert.ok(!new RegExp(`'${page}'`).test(server.slice(server.indexOf('const DEFAULT_USER_PERMS'), server.indexOf('const DEFAULT_USER_PERMS') + 900)), `DEFAULT_USER_PERMS me "${page}" nahi`);
  }
  // Retired pages ke feature toggles (tv mode / heatmap / report cards) settings se hat gaye.
  for (const flag of ['tvMode', 'heatmap', 'networkGraph', 'reportCards', 'anomalyRadar', 'levelUp', 'memoryLane']) {
    assert.ok(!new RegExp(`c\\('${flag}'`).test(settings), `Settings me "${flag}" toggle nahi rehna chahiye`);
  }
});

test('hataayi gayi pages ka koi reachable link ya voice shortcut nahi bachta', () => {
  for (const page of Object.keys(RETIRED)) {
    const re = new RegExp(`href="#/${page}\\b`);
    for (const file of ['home.js', 'stock.js', 'cockpit.js', 'settings.js', 'assistant.js', 'gv.js', 'app.js', 'dashboard.js', 'performance.js', 'tagIssued.js', 'trend.js']) {
      assert.ok(!re.test(src(file)), `${file} me #/${page} ka dead link bacha hua hai`);
    }
  }
});

test('retired pages ka render code bhi inherit nahi hota (module halka rehta hai)', () => {
  const insights = src('insights.js');
  const cockpit = src('cockpit.js');
  // Page-level renderers + registrations insights.js se hat gaye (module ab sirf live pages ke liye).
  for (const gone of ['renderExecutive', 'renderGvCommission', 'renderFfCommission', 'renderForecast',
    'renderForecastAccuracy', 'renderStockBalance', 'renderSavedViews', 'renderReportStudio', 'renderFollowups']) {
    assert.ok(!new RegExp(`function ${gone}\\b`).test(insights), `insights.js me ${gone} nahi hona chahiye`);
  }
  for (const page of ['executive', 'gvCommission', 'ffCommission', 'forecast', 'savedViews', 'reportStudio', 'followups']) {
    assert.ok(!new RegExp(`FF\\.pages\\.${page}\\s*=`).test(insights), `insights.js me FF.pages.${page} registration nahi`);
  }
  assert.ok(!/#\/(forecast|savedViews|reportStudio|followups)\b/.test(insights), 'insights.js me retired page ka link nahi');
  assert.ok(!/FF\.workspace\s*=/.test(insights), 'Saved Views workspace API ka client hook bhi gaya');
  // cockpit.js ke sirf retired pages wale renderers hata diye (agent360 / dispatch / alerts data intact).
  for (const gone of ['renderTlScorecard', 'mountFfTools', 'renderAlertsCard']) {
    assert.ok(!new RegExp(`function ${gone}\\b`).test(cockpit), `cockpit.js me ${gone} nahi hona chahiye`);
  }
  assert.ok(!/FF\.pages\.tlScorecard\s*=/.test(cockpit), 'cockpit.js TL scorecard page register nahi karta');
  assert.match(cockpit, /agent360/, 'agent360 (Master Search / Profile drawer) intact hai');
  assert.match(cockpit, /dispatchPlan/, 'dispatch planner intact hai');
});

test('shell me retired page ka assets/UI bacha hua nahi hai', () => {
  const idx = src('index.html');
  assert.ok(!/controlTower\.css/.test(idx), 'controlTower.css har page par load nahi hota');
  assert.ok(!/save-view-btn/.test(idx), '☆ save-view button gaya');
  assert.ok(!/save-view-btn|FF\.workspace/.test(app), 'app.js me save-view wiring nahi');
  const client = server.slice(server.indexOf('const CLIENT_PAGES'), server.indexOf('const CLIENT_PAGES') + 700);
  for (const gone of ['charts', 'tlScorecard', 'executive', 'forecast', 'tv']) {
    assert.ok(!new RegExp(`'${gone}'`).test(client), `notification route whitelist me ${gone} nahi`);
  }
  const smoke = src('dev/smoke.js');
  for (const gone of ['pages.executive', 'pages.tv', 'pages.ffCommission', 'pages.gvCommission',
    'pages.forecast', 'pages.savedViews', 'pages.reportStudio', 'pages.followups', 'pages.stockRadar',
    'pages.sprints', 'pages.arena', 'pages.fame', 'pages.warRoom', 'pages.activity', 'pages.network', 'pages.radar', 'pages.reportCards']) {
    assert.ok(!smoke.includes(gone), `smoke harness me ${gone} call nahi bachna chahiye`);
  }
});
