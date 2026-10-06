#!/usr/bin/env node
/* dev/visual-mobile.mjs — mobile/PWA layout regression check (real headless Chromium).
   Server + mock sheet khud start karta hai, login karta hai, 320/390/768px par pages kholta hai aur check karta hai:
     • horizontal overflow nahi    • topbar ≤ 72px, title dikhe, koi control screen ya topbar ke bahar nahi
     • mobile nav content ko dhakta nahi (padding ≥ nav)    • desktop par sirf EK footer
   Screenshots: dev/visual-out/*.png       Exit code 1 = layout toota.
   Setup (zero-dep app me add nahi kiya):  npm i --no-save puppeteer-core @sparticuz/chromium
   Ya apna Chrome:  CHROME_PATH=/usr/bin/google-chrome node dev/visual-mobile.mjs
   Run:  npm run test:visual                                                                         */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dev', 'visual-out');
const PORT = Number(process.env.VISUAL_PORT || 8181), MOCK = PORT + 1;
const BASE = `http://localhost:${PORT}`;
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const VIEWPORTS = [[320, 640], [390, 844], [768, 1024]];
const PAGES = ['home', 'dashboard', 'tagIssued'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const skip = (msg) => { console.log(`visual-mobile: SKIP — ${msg}`); process.exit(process.env.REQUIRE_VISUAL === '1' ? 1 : 0); };

let puppeteer, launchOpts;
try { puppeteer = (await import('puppeteer-core')).default; } catch { skip('puppeteer-core nahi mila (npm i --no-save puppeteer-core @sparticuz/chromium)'); }
if (process.env.CHROME_PATH) launchOpts = { executablePath: process.env.CHROME_PATH, headless: 'shell', args: ['--no-sandbox'] };
else {
  try { const c = (await import('@sparticuz/chromium')).default; launchOpts = { executablePath: await c.executablePath(), headless: 'shell', args: c.args }; }
  catch { skip('Chrome nahi mila — CHROME_PATH do ya npm i --no-save @sparticuz/chromium'); }
}

fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-visual-'));
const procs = [
  spawn('node', ['dev/mock-gviz.js'], { cwd: ROOT, env: { ...process.env, PORT: String(MOCK), MOCK_PORT: String(MOCK) }, stdio: 'ignore' }),
  spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: tmp, GVIZ_BASE: `http://localhost:${MOCK}` }, stdio: 'ignore' })
];
const stop = () => procs.forEach((p) => { try { p.kill(); } catch { /* ignore */ } });
process.on('exit', stop);

const failures = [];
const check = (ok, msg) => { if (!ok) { failures.push(msg); console.log('  ✗', msg); } };

try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* wait */ } await sleep(500); }
  const browser = await puppeteer.launch(launchOpts);

  async function login(page) {
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input[name="username"]', { timeout: 60000 });
    await page.type('input[name="username"]', 'admin'); await page.type('input[name="password"]', 'admin123');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.topbar', { visible: true, timeout: 60000 });
    await sleep(2500);
    await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /^skip$/i.test(b.textContent.trim())).forEach((b) => b.click()));
    await sleep(500);
  }
  async function fresh(w, h, mobile) {
    const page = await browser.newPage();
    const cdp = await page.createCDPSession();
    await cdp.send('Network.clearBrowserCookies'); await cdp.send('Storage.clearDataForOrigin', { origin: BASE, storageTypes: 'all' });
    if (mobile) await page.setUserAgent(UA);
    await page.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile });
    return page;
  }

  for (const [w, h] of VIEWPORTS) {
    console.log(`▶ mobile ${w}×${h}`);
    const page = await fresh(w, h, true);
    await login(page);
    for (const pg of PAGES) {
      await page.evaluate((p) => { location.hash = '#/' + p; }, pg);
      await sleep(2500);
      await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /^skip$/i.test(b.textContent.trim())).forEach((b) => b.click()));
      const m = await page.evaluate(() => {
        const W = innerWidth, tb = document.querySelector('.topbar'), title = document.querySelector('.top-title');
        const ctl = [...tb.querySelectorAll('button,.notification-wrap,.user-wrap')].filter((e) => e.getClientRects().length);
        const nav = document.querySelector('#mobile-nav'); const main = document.querySelector('#main');
        return {
          hOverflow: document.documentElement.scrollWidth - W,
          topbarH: Math.round(tb.getBoundingClientRect().height),
          titleW: Math.round(title.getBoundingClientRect().width),
          offscreen: ctl.filter((e) => { const r = e.getBoundingClientRect(); return r.right > W + 1 || r.bottom > tb.getBoundingClientRect().bottom + 1; }).map((e) => e.id || String(e.className)),
          navH: nav && !nav.hidden ? Math.round(nav.getBoundingClientRect().height) : 0,
          padB: main ? parseFloat(getComputedStyle(main).paddingBottom) : 0
        };
      });
      const tag = `${w}px ${pg}`;
      check(m.hOverflow <= 1, `${tag}: horizontal overflow ${m.hOverflow}px`);
      check(m.topbarH <= 72, `${tag}: topbar ${m.topbarH}px (max 72)`);
      check(m.titleW >= 80, `${tag}: topbar title sirf ${m.titleW}px`);
      check(m.offscreen.length === 0, `${tag}: topbar controls screen/topbar ke bahar nikle: ${m.offscreen.join(', ')}`);
      check(m.navH === 0 || m.padB >= m.navH, `${tag}: content padding ${m.padB}px < bottom nav ${m.navH}px`);
      await page.screenshot({ path: path.join(OUT, `${w}-${pg}.png`) });
    }
    await page.close();
  }

  console.log('▶ desktop 1280×800');
  const d = await fresh(1280, 800, false);
  await login(d);
  const vis = await d.evaluate(() => ['.app-footer', '.site-footer'].filter((s) => { const e = document.querySelector(s); return e && getComputedStyle(e).display !== 'none'; }));
  check(vis.length <= 1, `desktop: ek se zyada footer dikh rahe hain (${vis.join(', ')})`);
  await d.screenshot({ path: path.join(OUT, 'desktop-home.png') });
  await browser.close();
} catch (err) {
  failures.push('script error: ' + (err && err.message || err));
} finally { stop(); fs.rmSync(tmp, { recursive: true, force: true }); }

if (failures.length) { console.log(`\nvisual-mobile: ${failures.length} problem(s)`); process.exit(1); }
console.log('\nvisual-mobile: OK — layout checks pass ✓  (screenshots: dev/visual-out/)');
