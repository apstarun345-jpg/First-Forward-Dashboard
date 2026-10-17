import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const meta = JSON.parse(read('theme-packs.json'));
const keys = Object.keys(meta);

test('every theme pack has CSS (vars, KPI palette, chart palette) in themes.css', () => {
  const css = read('themes.css');
  assert.ok(keys.includes('navy'), 'Navy & White pack must exist');
  for (const k of keys) {
    assert.match(css, new RegExp(`html\\[data-theme-pack="${k}"\\] \\{`), k + ' vars block');
    assert.match(css, new RegExp(`html\\[data-theme-pack="${k}"\\] \\.g13 \\{`), k + ' KPI palette');
  }
  assert.equal((css.match(/--chart-pal:/g) || []).length, keys.length);
});

test('ui-boot applies pack + mode before paint and knows every pack', () => {
  const boot = read('ui-boot.js');
  for (const k of keys) assert.match(boot, new RegExp(`${k}: '${meta[k].mode}'`), 'ui-boot mode for ' + k);
  assert.match(boot, /ff_theme_pack/);
  assert.match(boot, /ff_brand_cache/);
  assert.match(read('index.html'), /themes\.css/);
});

test('wowzone picker lists every pack and branding is cached for early paint', () => {
  const wz = read('wowzone.js');
  for (const k of keys) assert.match(wz, new RegExp(`\\n    ${k}: \\{ name:`), 'picker has ' + k);
  const au = read('auth.js');
  assert.match(au, /ff_brand_cache/);
  assert.match(au, /!document\.documentElement\.dataset\.themePack/);
  assert.match(read('charts.js'), /syncPackPalette/);
});

test('FASTag Mapping shows 16-digit barcodes sheet-style with dashes (display only)', () => {
  const fm = read('fastagMapping.js');
  assert.match(fm, /function dashBar/);
  assert.match(fm, /label: dashBar\(it\.barcode\)/);
  assert.match(fm, /inputValue: dashBar\(it\.barcode\)/);
  assert.match(fm, /value: it\.barcode,/, 'raw digits stay in value for lookup');
});

test('🔁 Dual channel — FF TL ApnaPayment => ghost, review flag nahi', () => {
  const src = read('insights.js');
  assert.match(src, /isGvChannelTl\(ffTl\)/);
  assert.match(src, /const isGvChannelTl/);
});

test('⚡ Cross Channel — heavy detail tables lazy, redesign hook, TL ghost on Master Stock', () => {
  assert.match(read('compare.js'), /buildKpiDetails/);
  assert.match(read('insights.js'), /buildMsSets/);
  assert.match(read('insights.js'), /isGvChannelTl\(f\.tlName\)/);
  assert.match(read('app.js'), /dataset\.cc = '1'/);
  assert.match(read('newAgents.js'), /collectCache/);
  assert.match(read('dev/styles-full.css'), /body\[data-cc\] \.ins-metrics/);
});

test('🔢 Barcode har jagah 6-3-7 — DOM safety net + CSV', () => {
  assert.match(read('ui-plus.js'), /FF\.dashBarcodes/);
  assert.match(read('util.js'), /\$1-\$2-\$3/);
});

test('🧠 AI Business Analyst — page registered everywhere', () => {
  assert.match(read('app.js'), /id: 'aiAnalyst'/);
  assert.match(read('lazy.js'), /aiAnalyst: \[/);
  assert.match(read('server.js'), /key: 'aiAnalyst'/);
  assert.match(read('home.js'), /#\/aiAnalyst/);
  assert.match(read('aiAnalyst.js'), /FF\.pages\.aiAnalyst/);
});

test('🧠 AI Analyst — FF/GV master-ID separation + clickable drill', () => {
  const src = read('aiAnalyst.js');
  assert.match(src, /r\.channel !== 'GV Partner'/);
  assert.match(src, /function openDrill/);
  assert.match(src, /data-drill/);
});

test('🏷️ Tag Request label — Deliver To + sender sirf naam, Req/Emp/TL meta aur #ID nahi', () => {
  const src = read('tagRequest.js');
  assert.doesNotMatch(src, /Req #\$\{/);
  assert.doesNotMatch(src, /Emp: \$\{/);
  assert.doesNotMatch(src, /<span class="lbl-id">/);
  assert.match(src, /FROM: Name - \$\{f\.name\}`/);
  assert.doesNotMatch(src, /\(RECEIVER\)|\(SENDER\)/);
});

test('📗 FASTag Mapping — Sheet pending finder: agent/class wise + single/group/all map', () => {
  const src = read('fastagMapping.js');
  assert.match(src, /function pendingModel/);
  assert.match(src, /id="fm-gs-pending"/);
  assert.match(src, /data-fm-pm-all/);
  assert.match(src, /data-fm-pm-agent/);
  assert.match(src, /data-fm-pm-class/);
  assert.match(src, /data-fm-pm-one/);
  assert.match(src, /id="fm-pending"/);
});

test('🤖 v177 — Gems assistant: animated robot FAB, states, overlap-free header, mobile nav safe', () => {
  const src = read('assistant.js'), css = read('dev/styles-full.css');
  assert.match(src, /const robotSvg/);
  assert.match(src, /function setState/);
  assert.match(src, /setState\('listening'\)/);
  assert.match(src, /setState\('speaking'\)/);
  assert.doesNotMatch(src, /fab\.innerHTML = '🎙️'/);
  assert.match(css, /\.ask-title b \{[^}]*text-overflow: ellipsis/);
  assert.match(css, /bottom: calc\(76px \+ env\(safe-area-inset-bottom/);
  assert.match(css, /prefers-reduced-motion/);
});

test('👤 v177 — public Tag Request open notification carries employee name (form / remembered / IP)', () => {
  const srv = read('server.js'), pf = read('publicForm.js'), tr = read('tagRequest.js');
  assert.match(srv, /function visitorNameFor/);
  assert.match(srv, /ne Tag Request form open kiya/);
  assert.match(srv, /body\.name/);
  assert.match(pf, /ff-employee-name/);
  assert.match(pf, /name: rememberedName/);
  assert.match(tr, /dispatchEvent\(new CustomEvent\('ff-employee-name'/);
});

test('⚡ v177 — GV liveDailyRows memoized', () => {
  assert.match(read('gv.js'), /liveDailyMemo/);
});

test('🕒 v178 — Home: Sheets last data update card (EIR · StockDataa · GV Master · Tag Assignment)', () => {
  const src = read('home.js');
  assert.match(src, /id="home-freshness"/);
  assert.match(src, /home-freshness', '🕒/);
  for (const t of ["'EIR'", "'StockDataa'", "'GV Master'", "'Tag Assignment'"]) assert.ok(src.includes(t), t);
  assert.match(src, /max\(\$\{l\}\)/);
  assert.match(src, /sirf date/);
});

test('🕒 v179 — Sheets freshness: last filled row + Drive edit history via Apps Script sheetmeta', () => {
  const gs = read('google-apps-script/Code.gs'), srv = read('server.js'), home = read('home.js');
  assert.match(gs, /body\.action === 'sheetmeta'/);
  assert.match(gs, /getLastUpdated\(\)/);
  assert.match(gs, /Drive\.Revisions\.list/);
  assert.match(gs, /CODE_VERSION = 'v3\.73'/);
  assert.match(srv, /\/api\/sheet-freshness/);
  assert.match(home, /serverCompute/);
  assert.match(home, /Last filled row/);
  assert.match(home, /DATE\b|\+ \$\{tc\.h\}/);
});

test('👥 v180 — custom team personal link + last active date in agent/TL summary', () => {
  const srv = read('server.js'), st = read('settings.js'), ms = read('masterSearch.js'), sa = read('stock-age.js');
  assert.match(srv, /kind === 'group'/);
  assert.match(srv, /personalNameFilter/);
  assert.match(srv, /isTeamLink/);
  assert.match(sa, /kind === 'group'/);
  assert.match(st, /id="pg-create"/);
  assert.match(st, /kind: 'group'/);
  assert.match(ms, /lastActiveHtml/);
  assert.match(ms, /Last active/);
});

test('✏️ v183 — team link edit: add/remove agents + TL name in drawer', () => {
  const st = read('settings.js');
  assert.match(st, /id="ple-agent"/);
  assert.match(st, /payload\.members/);
  assert.match(st, /payload\.tlLabel/);
});

test('🧠 v184 — personal link Insights tab (inactive, growth, de-growth, dead stock)', () => {
  const srv = read('server.js'), st = read('settings.js');
  assert.match(srv, /data-pl-pane="insights"/);
  assert.match(srv, /Inactive agents/);
  assert.match(srv, /High growth/);
  assert.match(srv, /De-growth/);
  assert.match(srv, /data-ins-days/);
  assert.match(srv, /Stock hai par issuance nahi/);
  assert.match(st, /key: 'insights'/);
});

test('🧠 v186 — old personal links with Performance get Insights unless admin saved sections (secV)', () => {
  const srv = read('server.js');
  assert.match(srv, /plBackfill/);
  assert.match(srv, /link\.secV = 2/);
  assert.match(srv, /effSecs/);
});

test('⚡ v187 — personal page never hangs: 3s time-box loading page + prewarm on verify', () => {
  const srv = read('server.js');
  assert.match(srv, /Report taiyar ho rahi hai/);
  assert.match(srv, /Aapka report load ho raha hai/);
  assert.match(srv, /sheet data background me garam karo/);
});

test('🚪 v189 — common /portal login (ID + password) + settings copy card', () => {
  const srv = read('server.js'), st = read('settings.js');
  assert.match(srv, /\/api\/public\/portal-login/);
  assert.match(srv, /pathname === '\/portal'/);
  assert.match(st, /id="pt-copy"/);
});

test('🔥 v192 — Tag Request dispatch priority computed from need (stock cover + run-rate + growth), filter + sort', () => {
  const tr = read('tagRequest.js'), srv = read('server.js');
  assert.match(tr, /function needFromNumbers/);
  assert.match(tr, /needBadgeHtml\(dr\)/);
  assert.match(tr, /data-tr-need-filter/);
  assert.match(tr, /data-tr-need-sort/);
  assert.doesNotMatch(tr, /data-tr-dprio/);
  assert.doesNotMatch(srv, /bulk-priority/);
});
