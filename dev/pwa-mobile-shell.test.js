import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const bootScript = source('ui-boot.js');
const html = source('index.html');
const css = source('styles.css') + '\n' + source('pwa-premium.css') + '\n' + source('ux-fast.css') + '\n' + source('mobile-fix.css');
const mobileCss = source('mobile-fix.css');
const app = source('app.js');
const sw = source('sw.js');
const server = source('server.js');
const manifest = JSON.parse(source('manifest.webmanifest'));

function runBoot({ standalone = false, touch = 0, screenWidth = 1440, screenHeight = 900, innerWidth = 1440, innerHeight = 900, userAgent = '', dark = false } = {}) {
  const classes = new Set();
  const dataset = {};
  const matchMedia = (query) => ({
    matches: query === '(display-mode: standalone)' ? standalone : query === '(pointer: coarse)' ? touch > 0 : false
  });
  const context = {
    window: { matchMedia, innerWidth, innerHeight },
    navigator: { maxTouchPoints: touch, userAgent, userAgentData: { mobile: /Android|iPhone|iPad|iPod/i.test(userAgent) }, standalone },
    screen: { width: screenWidth, height: screenHeight },
    document: { documentElement: { classList: { add: (name) => classes.add(name) }, dataset } },
    localStorage: { getItem: (key) => key === 'ff_theme' && dark ? 'dark' : null },
    console: { warn() {} }
  };
  vm.runInNewContext(bootScript, context);
  return { classes, dataset };
}

test('mobile/PWA bootstrap is external so the self-only CSP does not block it', () => {
  assert.match(html, /<script src="\/ui-boot\.js\?v=\d+"><\/script>/);
  assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/);
  // v3.61: SW apni precache list khud index.html se padhta hai (ui-boot.js?v=… wahan se aata hai).
  // Hard-coded pins index.html se drift kar jaate the → phone par purana shell cache me phans jaata tha.
  assert.match(sw, /async function shellAssets\(/);
  assert.match(sw, /fetch\('\.\/index\.html'/);
  assert.match(sw, /apnapayment-v\d+/);
});

test('bottom bar uses uniform inline SVG icons (emoji icons broke per-phone alignment)', () => {
  assert.match(app, /const NAV_ICONS = \{/, 'icon set defined');
  assert.match(app, /class="mnav-ico"/, 'icons render as svg');
  const navPart = app.slice(app.indexOf('function renderMobileNav'), app.indexOf('function updateFocusMode'));
  assert.doesNotMatch(navPart, /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u, 'bottom bar must not use emoji glyphs');
  assert.match(mobileCss, /html\.mobile-ui #mobile-nav \.mnav-ico\s*\{[\s\S]*?width:\s*25px !important;[\s\S]*?height:\s*25px !important;/, 'effective CSS uses one consistent mobile icon size');
  assert.match(mobileCss, /html\.mobile-ui #mobile-nav \.mobile-nav-item small\s*\{[\s\S]*?text-align:\s*center !important;/, 'labels share one centred baseline');
  assert.match(mobileCss, /grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/, 'six app actions fit the mobile bar');
  assert.match(css, /@media \(min-width: 600px\) and \(pointer: coarse\)[\s\S]*?width: min\(560px, calc\(100vw - 24px\)\)/, 'tablets get a capped, centred bar');
  assert.match(css, /@media \(max-height: 480px\) and \(pointer: coarse\)/, 'landscape gets a slim bar');
});

test('installed PWA launches from the root, and legacy /api/pwa start URLs return the app shell', () => {
  assert.equal(manifest.start_url, '/#/home');
  assert.equal(manifest.scope, '/');
  assert.match(html, /<base href="\/">/, 'legacy nested launch URLs resolve every relative app asset from the origin root');
  assert.match(app, /serviceWorker\.register\('\/sw\.js'/, 'service worker is registered at the origin root');
  assert.match(server, /start_url:\s*'\/#\/home',\s*scope:\s*'\/'/, 'API manifest uses root-absolute launch URL and scope');
  const legacyRoute = server.indexOf("if ((p === '/api/pwa' || p === '/api/pwa/') && (method === 'GET' || method === 'HEAD'))");
  const publicPwaRoutes = server.indexOf("if (p === '/api/pwa/icon/192'");
  assert.ok(legacyRoute >= 0 && publicPwaRoutes > legacyRoute, 'legacy shell route runs before the auth-protected API fallback');
  assert.match(server.slice(legacyRoute, publicPwaRoutes), /serveStatic\(req, res, '\/index\.html', url\.search\)/);
  assert.match(html, /\/api\/pwa\/manifest\?v=\d+/, 'manifest is refetched by installed clients');
});

test('mobile UI detection survives Android desktop-site wide viewports and standalone PWAs', () => {
  const androidDesktopSite = runBoot({ touch: 1, screenWidth: 393, screenHeight: 852, innerWidth: 980, userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/140.0.0.0' });
  const standalone = runBoot({ standalone: true, screenWidth: 1440, screenHeight: 900 });
  const desktop = runBoot();

  assert.equal(androidDesktopSite.classes.has('mobile-ui'), true);
  assert.equal(standalone.classes.has('mobile-ui'), true);
  assert.equal(desktop.classes.has('mobile-ui'), false);
  assert.equal(runBoot({ dark: true }).dataset.theme, 'dark');
});

test('PWA More menu can open the off-canvas sidebar and close on navigation', () => {
  assert.match(css, /html\.mobile-ui \.sidebar\s*\{[^}]*display:\s*flex !important/s);
  assert.match(css, /html\.mobile-ui body\.side-open \.sidebar\s*\{[^}]*transform:\s*translateX\(0\) !important/s);
  assert.match(css, /html\.mobile-ui body\.side-open \.side-backdrop\s*\{\s*display:\s*block !important/s);
  assert.match(app, /U\.\$\('#menu-btn'\)\.addEventListener\('click', toggleSidebar\)/);
  assert.match(app, /if \(action === 'more'\) \{ U\.\$\('#menu-btn'\)\?\.click\(\); return; \}/);
  assert.match(app, /function closeSidebar\(\)[\s\S]*?setAttribute\('aria-expanded', 'false'\)/);
});

test('fixed bottom nav stays hidden before login and above-app sheets layer above it', () => {
  assert.match(html, /id="mobile-nav" class="mobile-nav"[^>]*hidden/);
  assert.match(css, /html\.mobile-ui #mobile-nav\.mobile-nav\[hidden\]\s*\{\s*display:\s*none !important/);
  assert.match(css, /html\.mobile-ui \.side-backdrop\s*\{\s*z-index:\s*10000 !important/);
  assert.match(css, /html\.mobile-ui \.drawer\s*\{\s*z-index:\s*10003 !important/);
  assert.match(app, /document\.body\.classList\.add\('has-mobile-nav'\)/);
  assert.match(app, /document\.body\.classList\.remove\('has-mobile-nav'\)/);
});

test('mobile layout stylesheet is loaded after premium and UX overrides', () => {
  const mobileLink = html.indexOf('href="mobile-fix.css?');
  const premiumLink = html.indexOf('href="pwa-premium.css?');
  const uxLink = html.indexOf('href="ux-fast.css?');
  assert.ok(mobileLink > premiumLink && mobileLink > uxLink, 'mobile-fix must be the last stylesheet so app controls/layout fixes win');
});

test('mobile PWA typography and touch controls remain readable', () => {
  const readableRules = mobileCss.slice(mobileCss.lastIndexOf('v3.72'));
  assert.match(readableRules, /html\.mobile-ui body\s*\{[^}]*font-size:\s*17px !important/s);
  assert.match(readableRules, /html\.mobile-ui \.kpi-title,[\s\S]*?font-size:\s*13px !important/);
  assert.match(readableRules, /html\.mobile-ui \.kpi-foot \{ font-size:\s*12px !important/);
  assert.match(readableRules, /html\.mobile-ui #mobile-nav \.mobile-nav-item small\s*\{[\s\S]*?font-size:\s*11px !important/);
  assert.match(readableRules, /min-height:\s*48px !important/);
});

test('mobile nav exposes Search and the first search click loads the lazy palette', () => {
  const navPart = app.slice(app.indexOf('function renderMobileNav'), app.indexOf('function updateFocusMode'));
  assert.match(navPart, /id: 'search', icon: 'search', label: 'Search'/);
  assert.match(app, /const globalSearchBtn = U\.\$\('#global-search-btn'\)/);
  assert.match(app, /ensureShell\(\['palette', 'masterSearch'\]\)\.then\(/);
  assert.match(app, /if \(FF\.palette && typeof FF\.palette\.toggle === 'function'\) \{/);
});
