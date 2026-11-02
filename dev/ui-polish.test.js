/* Clean UI Polish Pack: presentation boundaries, channel identity and accessibility. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gzipSync } from 'node:zlib';

const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const css = read('ui-polish.css');
const html = read('index.html');
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

function contrast(a, b) {
  const luminance = (hex) => {
    const rgb = hex.match(/[a-f\d]{2}/gi).map((c) => parseInt(c, 16) / 255)
      .map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

test('polish is opt-in on the shell and loads after themes and mobile/native repairs', () => {
  assert.match(html, /<html[^>]*data-ui-polish="clean"/);
  const links = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  assert.match(links.at(-1), /^ui-polish\.css\?v=/);
  for (const name of ['styles.css', 'mobile-fix.css', 'native-shell.css', 'themes.css']) {
    assert.ok(links.findIndex((l) => l.startsWith(name + '?')) < links.length - 1);
  }
  assert.match(read('sw.js'), /async function shellAssets\(/, 'service worker discovers the new CSS from the shell');
});

test('polish stays a small, dependency-free stylesheet and does not load fonts or images', () => {
  assert.ok(gzipSync(css).length < 4096, 'keep the compressed polish layer under 4 KiB');
  assert.doesNotMatch(rules, /@import|@font-face|url\(|backdrop-filter:\s*blur|\binfinite\b/);
  const pkg = JSON.parse(read('package.json'));
  assert.equal(Object.keys(pkg.dependencies || {}).length, 0);
  assert.equal(Object.keys(pkg.devDependencies || {}).length, 0);
});

test('every component rule is scoped to the workspace opt-in, not the login/public form', () => {
  // At-rules and variable declarations are the only rules not scoped to the UI flag.
  const selectors = [...rules.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((s) => !s.startsWith('@'));
  for (const selector of selectors) {
    assert.ok(selector === ':root' || selector === 'html[data-theme="dark"]' || selector.includes('html[data-ui-polish="clean"]'), selector);
  }
  assert.doesNotMatch(rules, /\.auth-screen|\.pro-form|\.public-form/);
});

test('FF, GV, Office and danger text have AA contrast in both light and dark modes', () => {
  const light = /:root\s*\{([^}]+)\}/.exec(css)[1];
  const dark = /html\[data-theme="dark"\]\s*\{([^}]+)\}/.exec(css)[1];
  for (const [mode, block] of [['light', light], ['dark', dark]]) {
    for (const channel of ['ff', 'gv', 'office', 'danger']) {
      const fg = new RegExp(`--polish-${channel}: (#[a-f\\d]{6});`).exec(block)[1];
      const bg = new RegExp(`--polish-${channel}-bg: (#[a-f\\d]{6});`).exec(block)[1];
      assert.ok(contrast(fg, bg) >= 4.5, `${mode} ${channel} text contrast`);
    }
  }
});

test('channel badges reuse existing labels and keep Office stock a distinct amber row state', () => {
  assert.match(read('home.js'), /class="chip on channel-badge gv">🟩 GV aaj/);
  assert.match(read('masterSearch.js'), /class="msp-pill \$\{cls\} channel-badge"/);
  assert.match(read('masterSearch.js'), /channel-badge \$\{p\.kind\.startsWith\('gv'\) \? 'gv' : 'ff'\}/);
  assert.match(css, /\.channel-badge\.ff/);
  assert.match(css, /\.channel-badge\.gv/);
  assert.match(css, /\.badge\.office\s*\{/);
  assert.match(css, /tr\.ms-office-row td \{ background: var\(--polish-office-bg\); \}/);
});

test('primary, secondary and destructive actions remain distinguishable with keyboard focus', () => {
  assert.match(css, /\.btn\.primary[\s\S]*?background: var\(--polish-action\) !important; color: #fff !important/);
  assert.match(css, /\.btn:not\(\.primary\):not\(\.danger\)/);
  assert.match(css, /\.btn\.danger\s*\{\s*background: var\(--polish-danger-bg\)/);
  assert.match(css, /:focus-visible\s*\{\s*outline: 2px solid var\(--brand\); outline-offset: 3px;/);
  assert.match(css, /:disabled\s*\{\s*opacity: \.5; cursor: not-allowed;/);
});

test('existing KPI palettes, responsive grid and navigation geometry are not replaced', () => {
  assert.doesNotMatch(rules, /grid-template-columns|position:\s*(?:fixed|sticky)|z-index:|display:\s*none|overflow:\s*hidden/);
  assert.doesNotMatch(rules, /--brand\s*:|--card\s*:|--bg\s*:/, 'theme/branding colours remain authoritative');
  assert.match(css, /\.kpi::after \{ content: none; \}/, 'remove decoration, not KPI data');
  assert.doesNotMatch(rules, /\.kpi[^{}]*\{[^{}]*background:/, 'keep colourful KPI backgrounds');
});

test('Tag Request retains its intentionally light surface inside the dark shell', () => {
  const block = /\.main:has\(\.page-tagRequest\)\s*\{([^}]+)\}/.exec(css)[1];
  assert.match(block, /--polish-soft: color-mix\(in srgb, var\(--ink\) 3%, var\(--card\)\)/, 'recompute the light header surface instead of inheriting a dark computed token');
  assert.match(block, /--polish-ff: #1d4ed8/);
  assert.match(block, /--polish-gv: #047857/);
  assert.match(block, /--polish-danger: #b91c1c/);
  assert.match(read('ui-refresh.css'), /\.main:has\(\.page-tagRequest\)\s*\{\s*--bg: #f3f6fc; --card: #ffffff;/);
});

test('readable numbers, compact density and reduced-motion preferences remain supported', () => {
  assert.match(css, /font-variant-numeric: tabular-nums/);
  assert.match(css, /data-density="compact"/);
  assert.match(css, /data-table-density="compact"/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /transition: none !important; animation: none !important; transform: none !important;/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.doesNotMatch(rules, /btnBusySpin|btnBusySweep|\.spinner|\.is-busy/, 'do not disable async loading feedback');
});
