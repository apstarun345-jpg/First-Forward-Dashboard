import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('notification inbox supports unread filters, more results, stable search focus and live refresh', () => {
  const notifications = source('notifications.js');
  assert.match(notifications, /centerUnreadOnly: false, centerLimit: 50/);
  assert.match(notifications, /if \(state\.centerUnreadOnly && !itemUnread\(item\)\) return false;/);
  assert.match(notifications, /visibleItems\.map\(centerItemHtml\)/);
  assert.match(notifications, /data-center-more/);
  assert.match(notifications, /searchFocus: true, selectionStart, selectionEnd, listScrollTop/);
  assert.match(notifications, /if \(fresh\.length\) refreshCenterIfOpen\(\);/);
  assert.match(notifications, /\.slice\(-500\)/);
  assert.match(notifications, /setCount\(0\); render\(\); refreshCenterIfOpen\(\);/);
  assert.match(notifications, /Notification detail/);
});

test('mobile navigation exposes active-page semantics and accessible action labels', () => {
  const app = source('app.js');
  assert.match(app, /aria-current="page"/);
  assert.match(app, /aria-haspopup="dialog" title="Open notification inbox"/);
  assert.match(app, /title="Open global search"/);
  assert.match(app, /x\.id === 'more' && !\['home', 'tagIssued', 'performance'\]\.includes\(current\.page\)/, 'More stays highlighted while a secondary page is open');
});

test('notification center and mobile navigation remain touch-friendly in the PWA shell', () => {
  const html = source('index.html');
  const css = source('mobile-fix.css');
  const sw = source('sw.js');
  assert.match(html, /mobile-fix\.css\?v=5/);
  assert.match(css, /html\.mobile-ui #mobile-nav \.mobile-nav-item\[aria-current="page"\]/);
  assert.match(css, /html\.mobile-ui \.notify-center-filters\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /html\.mobile-ui \.notify-center-loadmore\s*\{[\s\S]*?min-height: 48px !important/);
  assert.match(sw, /apnapayment-v127/);
});


test('Smart Home provides permission-filtered shortcuts without new data workflows', () => {
  const home = source('home.js');
  assert.match(home, /home-quick-access/);
  assert.match(home, /\.filter\(\(action\) => FF\.auth\.can\(action\.perm\)\)/);
  assert.match(home, /href="#\/\$\{esc\(action\.id\)\}"/);
  assert.match(home, /Master Search/);
  assert.match(home, /Tag Requests/);
  assert.match(home, /GV Stock/);
});

test('native mobile workspace uses sane text sizes and a six-item bottom navigation', () => {
  const app = source('app.js');
  const css = source('mobile-fix.css');
  const html = source('index.html');
  const sw = source('sw.js');
  assert.match(app, /mobile-nav-action\$\{active \? ' active' : ''\}/);
  assert.match(app, /\$\{active \? ' aria-current="page"' : ''\}/);
  assert.match(css, /grid-template-columns:repeat\(6,minmax\(0,1fr\)\) !important/);
  assert.match(css, /html\.mobile-ui body \{ font-size:17px !important; line-height:1\.45 !important; \}/);
  assert.match(css, /home-launch-tile/);
  assert.match(html, /mobile-fix\.css\?v=5/);
  assert.match(sw, /apnapayment-v127/);
});
