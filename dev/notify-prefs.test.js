/* Notification pipeline regression — "admin ko har notification chahiye: signup, search, click,
   page open, reset request … app ke andar BHI aur mobile panel BHI (app band ho tab bhi)".

   Ye test server ke recordNotification → feed (visibleNotifications) chain ko lock karta hai:
     • naya signup     → admin feed me type 'signup',
     • forgot password → admin feed me password-reset request,
     • user ka search  → admin feed me type 'search',
     • user ka click   → admin feed me type 'click',
     • admin prefs     → sabhi types DEFAULT par ON (ek bhi type silently OFF nahi hona chahiye,
                          warna wo feed + Web Push dono se filter ho jaati thi).
   Mobile panel tak delivery pushFanout() se hoti hai (VAPID ke bina wo no-op hai — yahan chain
   lock kar rahe hain, transport dev/push.test.js cover karta hai). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function startServer(dir, upstream) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, STORAGE_BACKEND: 'files', PORT: '0', DATA_DIR: dir, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'initial-password', GVIZ_BASE: upstream, RENDER: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stderr.on('data', (data) => { logs += data; });
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (data) => {
      logs += data;
      const m = logs.match(/http:\/\/0\.0\.0\.0:(\d+)/);
      if (m && m[1] !== '0') resolve(`http://127.0.0.1:${m[1]}`);
    });
    child.on('exit', (code) => reject(new Error(`Server exited ${code}: ${logs}`)));
  });
  const base = await Promise.race([ready, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Startup timeout: ' + logs)), 10000); timer.unref(); })]);
  return { child, base, async stop() { if (child.exitCode !== null) return; child.kill('SIGTERM'); await once(child, 'exit'); } };
}

test('signup / reset request / user search / user click sab admin ki feed me aate hain; prefs sab ON', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-notify-'));
  const upstream = http.createServer((req, res) => {
    res.end('google.visualization.Query.setResponse({"status":"ok","table":{"cols":[{"id":"A","type":"number"}],"rows":[]}});');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  let server;
  let adminCookie = '';
  let userCookie = '';
  const call = async (route, method = 'GET', body, cookie = '') => {
    const res = await fetch(server.base + route, {
      method,
      headers: { cookie, 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
      body: body ? JSON.stringify(body) : undefined
    });
    const setCookie = res.headers.get('set-cookie');
    const json = await res.json().catch(() => ({}));
    return { res, json, setCookie };
  };
  try {
    server = await startServer(dir, `http://127.0.0.1:${upstream.address().port}`);
    adminCookie = (await call('/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' })).setCookie.split(';')[0];

    // 1) Pehle admin ki prefs check karo — SAB types default par ON.
    const prefs = (await call('/api/notifications/prefs', 'GET', null, adminCookie)).json.prefs;
    assert.ok(prefs && typeof prefs === 'object', 'prefs milni chahiye');
    for (const key of ['enabled', 'login', 'signup', 'report', 'monthly', 'digest', 'alert', 'activity', 'click', 'search', 'settings', 'user', 'location', 'info', 'sound', 'push']) {
      assert.equal(prefs[key], true, `default prefs me "${key}" ON hona chahiye — false matlab feed + mobile push dono se gayab`);
    }

    // 1b) Health (public): public response me pendingSignups leak nahi hona chahiye.
    const healthPublic = (await call('/api/health', 'GET')).json;
    assert.equal(healthPublic.pendingSignups, undefined, 'public health me pendingSignups nahi aana chahiye');

    // 2) Naya signup → admin feed me type 'signup' + deep link (tap → seedha Users tab).
    await call('/api/auth/signup', 'POST', { username: 'newbie', name: 'New Bee', email: 'newbie@example.test', password: 'newbie-pass-1' });
    let items = (await call('/api/notifications', 'GET', null, adminCookie)).json.items || [];
    const signup = items.find((i) => /Naya signup/.test(i.title));
    assert.ok(signup, 'admin ko naye signup ki notification chahiye');
    assert.equal(signup.type, 'signup', 'signup notification ka type signup hona chahiye (Settings ka toggle isi ko control karta hai)');
    assert.equal(signup.meta && signup.meta.link, '#/settings?tab=users', 'signup tap par seedha Users (approval) tab khulna chahiye');

    // 2b) Signup ke baad admin health me pending count (sidebar ⏳ badge ke liye).
    const healthAdmin = (await call('/api/health', 'GET', null, adminCookie)).json;
    assert.ok(Number(healthAdmin.pendingSignups) >= 1, `admin health me pendingSignups chahiye — got ${healthAdmin.pendingSignups}`);

    // 3) Forgot-password request → admin feed me reset notification.
    await call('/api/auth/forgot', 'POST', { username: 'newbie' });
    items = (await call('/api/notifications', 'GET', null, adminCookie)).json.items || [];
    assert.ok(items.find((i) => /Password reset request/.test(i.title)), 'admin ko reset request ki notification chahiye');

    // 4) Admin ek user banata hai, wo login karke search / click karta hai → admin ko dono aati hain.
    await call('/api/users', 'POST', { username: 'member', name: 'Staff Member', password: 'member-pass-1', role: 'user' }, adminCookie);
    userCookie = (await call('/api/auth/login', 'POST', { username: 'member', password: 'member-pass-1' })).setCookie.split(';')[0];
    assert.ok(userCookie, 'member login chalna chahiye');
    await call('/api/activity', 'POST', { type: 'search', option: 'Stock / Inventory', query: 'rahul' }, userCookie);
    await call('/api/activity', 'POST', { type: 'click', option: 'Excel Bundle', details: '5 sheets' }, userCookie);
    await call('/api/activity', 'POST', { page: 'stock' }, userCookie);

    items = (await call('/api/notifications', 'GET', null, adminCookie)).json.items || [];
    const titles = items.map((i) => `${i.type}:${i.title}`).join('\n');
    assert.match(titles, /search:.*rahul/s, `admin ko user ki search notification chahiye — got:\n${titles}`);
    assert.match(titles, /click:.*Excel Bundle/s, `admin ko user ki click notification chahiye — got:\n${titles}`);
    assert.match(titles, /activity:.*page khola/s, `admin ko user ke page open ki notification chahiye — got:\n${titles}`);
    assert.match(titles, /user:.*New user created/s, 'admin ko naye user creation ki notification chahiye');
    // Deep links: notification tap (app ya phone panel) seedha sahi page par le jaye.
    const searchItem = items.find((i) => i.type === 'search');
    const clickItem = items.find((i) => i.type === 'click');
    const activityItem = items.find((i) => i.type === 'activity');
    assert.equal(searchItem.meta && searchItem.meta.link, '#/stock', 'Stock search → #/stock deep link');
    assert.equal(clickItem.meta && clickItem.meta.link, '#/dashboard', 'Excel Bundle click → #/dashboard deep link');
    assert.equal(activityItem.meta && activityItem.meta.link, '#/stock', 'page open → usi page ki deep link');

    // 4b) 🌅 Daily digest — admin ka button force bhej sakta hai; feed me type digest aani chahiye.
    const dig = await call('/api/notifications/digest', 'POST', {}, adminCookie);
    assert.equal(dig.res.status, 200, `digest endpoint 200 dena chahiye — ${JSON.stringify(dig.json)}`);
    assert.equal(dig.json.ok, true, 'digest item banna chahiye');
    assert.equal(dig.json.item && dig.json.item.type, 'digest');
    assert.equal(dig.json.item && dig.json.item.target, 'admin', 'digest sirf admin ko jaani chahiye');
    items = (await call('/api/notifications', 'GET', null, adminCookie)).json.items || [];
    assert.ok(items.some((i) => i.type === 'digest'), 'digest feed me dikhni chahiye');
    const digDenied = await call('/api/notifications/digest', 'POST', {}, userCookie);
    assert.ok(digDenied.res.status >= 400, 'non-admin digest nahi bhej sakta');

    // 4c) 🕘 Login history — Users tab ka table (kab, kis login ID se, kis IP se), sirf admin.
    const usersAdmin = (await call('/api/users', 'GET', null, adminCookie)).json.users || [];
    const member = usersAdmin.find((u) => u.username === 'member');
    assert.ok(member && Array.isArray(member.loginHistory), 'publicUser me loginHistory array chahiye (Users tab 🕘 table)');
    assert.ok(member.loginHistory.length >= 1, 'member ke login history me kam se kam 1 entry chahiye');
    const lh = member.loginHistory[member.loginHistory.length - 1];
    assert.ok(lh.at && lh.ip && lh.id, `login entry me at / ip / id chahiye — ${JSON.stringify(lh)}`);
    const usersDenied = await call('/api/users', 'GET', null, userCookie);
    assert.ok(usersDenied.res.status >= 400, 'non-admin /api/users nahi dekh sakta');

    // 4d) 📉 Stock history — Stock page ke 30-din chart ke liye points + cover thresholds.
    const sh = await call('/api/stock-history', 'GET', null, adminCookie);
    assert.equal(sh.res.status, 200, `stock-history 200 dena chahiye — ${JSON.stringify(sh.json)}`);
    assert.ok(Array.isArray(sh.json.points), 'stock-history me points array chahiye');
    assert.ok(sh.json.thresholds && typeof sh.json.thresholds === 'object', 'thresholds chahiye (cover bands)');
    const shUser = await call('/api/stock-history', 'GET', null, userCookie);
    assert.equal(shUser.res.status, 200, 'member ko bhi stock-history chahiye (Stock page par chart)');

    // 5) Notification ki prefs ke saath ek band toggle bhi kaam kare — aur wapas ON karne par
    //    wo type feed me phir dikhne lage (admin setting jo maangi gayi hai).
    await call('/api/notifications/prefs', 'PUT', { prefs: { search: false } }, adminCookie);
    const afterOff = (await call('/api/notifications', 'GET', null, adminCookie)).json.items || [];
    assert.ok(!afterOff.some((i) => i.type === 'search'), 'search OFF karne par feed me search nahi aani chahiye');
    await call('/api/notifications/prefs', 'PUT', { prefs: { search: true } }, adminCookie);
    const afterOn = (await call('/api/notifications', 'GET', null, adminCookie)).json.items || [];
    assert.ok(afterOn.some((i) => i.type === 'search'), 'wapas ON karne par search notification feed me dikhni chahiye');
  } finally {
    if (server) await server.stop();
    await new Promise((r) => upstream.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('client ki DEFAULT prefs bhi sab ON hain (purana click:false/location:false bug wapas na aaye)', async () => {
  const src = await fs.readFile(path.join(ROOT, 'notifications.js'), 'utf8');
  const m = src.match(/const DEFAULT_PREFS = \{([^}]+)\}/);
  assert.ok(m, 'DEFAULT_PREFS milna chahiye');
  const pairs = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  const off = pairs.filter((p) => /:\s*false/.test(p));
  assert.deepEqual(off, [], `client DEFAULT prefs me koi bhi type false nahi hona chahiye — savePrefs pura object server par PUT karta hai: ${off.join(', ')}`);
  // Server default bhi sab ON — warna normalizeNotifyPrefs se hi types gayab ho jati hain.
  const srv = await fs.readFile(path.join(ROOT, 'server.js'), 'utf8');
  const sm = srv.match(/DEFAULT_NOTIFY_PREFS = \{([^}]+)\}/);
  assert.ok(sm, 'server DEFAULT_NOTIFY_PREFS milni chahiye');
  const serverOff = sm[1].split(',').map((s) => s.trim()).filter((s) => /:\s*false/.test(s));
  assert.deepEqual(serverOff, [], `server DEFAULT_NOTIFY_PREFS me koi type false nahi hona chahiye: ${serverOff.join(', ')}`);
});
