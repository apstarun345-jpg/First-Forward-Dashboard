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
    for (const key of ['enabled', 'login', 'signup', 'report', 'monthly', 'activity', 'click', 'search', 'settings', 'user', 'location', 'info', 'sound', 'push']) {
      assert.equal(prefs[key], true, `default prefs me "${key}" ON hona chahiye — false matlab feed + mobile push dono se gayab`);
    }

    // 2) Naya signup → admin feed me type 'signup'.
    await call('/api/auth/signup', 'POST', { username: 'newbie', name: 'New Bee', email: 'newbie@example.test', password: 'newbie-pass-1' });
    let items = (await call('/api/notifications', 'GET', null, adminCookie)).json.items || [];
    const signup = items.find((i) => /Naya signup/.test(i.title));
    assert.ok(signup, 'admin ko naye signup ki notification chahiye');
    assert.equal(signup.type, 'signup', 'signup notification ka type signup hona chahiye (Settings ka toggle isi ko control karta hai)');

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
