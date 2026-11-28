#!/usr/bin/env node
/* 🤖 JARVIS Helper — Mac par chalta hai. Dashboard ke JARVIS ke tasks uthata hai, portal se report download karta hai.
   node jarvis-helper.mjs login <recipe>   → Chrome window kholta hai, aap khud login karo (session yaad rehta hai)
   node jarvis-helper.mjs                  → har 30 sec pending tasks dekhta hai aur recipe se chalata hai
   Password kahin save nahi hota. Sirf Chrome ka apna profile (~/.jarvis-helper/profile) session rakhta hai. */
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.JARVIS_URL || 'https://first-forward-dashboard.onrender.com').replace(/\/$/, '');
const TOKEN = process.env.JARVIS_HELPER_TOKEN || '';
const OUT = process.env.JARVIS_OUT || path.join(os.homedir(), 'JARVIS-Reports');
const PROFILE = path.join(os.homedir(), '.jarvis-helper', 'profile');
const CHROME = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p));
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toLocaleTimeString('en-IN'), ...a);

const recipes = () => fs.readdirSync(path.join(HERE, 'recipes')).filter((f) => f.endsWith('.json') && !f.startsWith('_'))
  .map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(HERE, 'recipes', f), 'utf8')) }));
const findRecipe = (text) => { const t = text.toLowerCase(); return recipes().find((r) => (r.keywords || [r.name]).some((k) => t.includes(String(k).toLowerCase()))); };

async function api(p, method = 'GET', body) {
  const r = await fetch(BASE + p, { method, headers: { 'x-jarvis-token': TOKEN, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${p} → HTTP ${r.status}`);
  return r.json();
}
async function launch(headless) {
  if (!CHROME) throw new Error('Chrome nahi mila — CHROME_PATH set karo');
  return puppeteer.launch({ executablePath: CHROME, headless, userDataDir: PROFILE, defaultViewport: null, args: ['--no-first-run', '--disable-blink-features=AutomationControlled'] });
}
const newest = (dir, since) => fs.readdirSync(dir).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).filter((x) => x.t >= since && !x.f.endsWith('.crdownload') && !x.f.startsWith('.')).sort((a, b) => b.t - a.t)[0];
const fillDate = (s) => { const d = new Date(Date.now() - 864e5 * (s.includes('{yesterday') ? 1 : 0)); const p2 = (n) => String(n).padStart(2, '0'); return String(s).replace(/\{(today|yesterday)(?::([^}]+))?\}/g, (_, _k, f) => (f || 'YYYY-MM-DD').replace('YYYY', d.getFullYear()).replace('MM', p2(d.getMonth() + 1)).replace('DD', p2(d.getDate()))); };

/** recipe steps: goto · click · type · select · press · wait · waitFor · download(click) · loginCheck */
async function run(recipe) {
  const browser = await launch(recipe.headless !== false && !process.env.SHOW);
  const since = Date.now();
  try {
    const page = await browser.newPage();
    const cdp = await page.createCDPSession(); await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT });
    page.setDefaultTimeout(30000);
    for (const st of recipe.steps) {
      if (st.goto) await page.goto(fillDate(st.goto), { waitUntil: 'networkidle2' });
      else if (st.loginCheck) { if (!(await page.$(st.loginCheck))) { const e = new Error('login chahiye'); e.code = 'LOGIN'; throw e; } }
      else if (st.click) { await page.waitForSelector(st.click, { visible: true }); await page.click(st.click); }
      else if (st.type) { await page.waitForSelector(st.type, { visible: true }); await page.type(st.type, fillDate(st.text || ''), { delay: 30 }); }
      else if (st.select) await page.select(st.select, fillDate(st.value || ''));
      else if (st.press) await page.keyboard.press(st.press);
      else if (st.waitFor) await page.waitForSelector(st.waitFor, { visible: true });
      else if (st.wait) await sleep(st.wait);
      else if (st.download) { await page.waitForSelector(st.download, { visible: true }); await page.click(st.download); }
    }
    for (let i = 0; i < 40; i++) { const f = newest(OUT, since); if (f) { const dest = recipe.saveAs ? path.join(OUT, fillDate(recipe.saveAs)) : null; const src = path.join(OUT, f.f); if (dest && dest !== src) fs.renameSync(src, dest); return dest || src; } await sleep(1500); }
    throw new Error('download file nahi aayi');
  } finally { await browser.close().catch(() => {}); }
}

async function loginMode(name) {
  const r = recipes().find((x) => x.name === name) || findRecipe(name || '');
  if (!r) { console.log('Recipe nahi mili. Available:', recipes().map((x) => x.name).join(', ')); process.exit(1); }
  const browser = await launch(false); const page = await browser.newPage();
  await page.goto(r.loginUrl || r.steps.find((s) => s.goto).goto);
  log(`🔑 "${r.name}" me login karo (OTP/CAPTCHA khud). Ho jaye to ye Chrome window band kar do.`);
  await new Promise((res) => browser.on('disconnected', res)); log('✅ Session save ho gaya.');
}

async function loop() {
  if (!TOKEN) { console.log('JARVIS_HELPER_TOKEN set nahi hai (README dekho)'); process.exit(1); }
  log(`🤖 JARVIS Helper chalu · ${BASE} · downloads: ${OUT}`);
  for (;;) {
    try {
      const { tasks } = await api('/api/jarvis/helper/tasks');
      for (const t of tasks) {
        const r = findRecipe(t.text);
        if (!r) { await api('/api/jarvis/helper/done', 'POST', { id: t.id, status: 'needs_recipe', note: 'is kaam ki recipe nahi hai (helper/recipes)' }); log('🧩 recipe nahi:', t.text); continue; }
        log('▶', t.text, '→', r.name);
        try { const f = await run(r); await api('/api/jarvis/helper/done', 'POST', { id: t.id, status: 'done', file: path.basename(f), note: 'download ho gaya: ' + path.basename(f) }); log('✅', f); }
        catch (e) { await api('/api/jarvis/helper/done', 'POST', { id: t.id, status: e.code === 'LOGIN' ? 'needs_login' : 'failed', note: String(e.message).slice(0, 200) }); log('❌', e.message); }
      }
    } catch (e) { log('⚠️', e.message); }
    await sleep(30000);
  }
}
if (process.argv[2] === 'login') loginMode(process.argv.slice(3).join(' ')); else loop();
