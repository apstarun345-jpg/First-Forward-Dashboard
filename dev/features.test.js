/* 🎛 Feature-control regression — "har cheez ka option admin ke paas".
   Locks:
     • /api/settings me features (flags + modify numbers) + email SMTP secrets non-admin ko NA dikhe,
     • admin PUT se feature on/off hota hai aur nested deep-merge safe hai (alerts.lowCover false karne
       par baaki alerts true rehte hain), member PUT 4xx,
     • /api/version sw.js ke CACHE_NAME se match karta hai (update toast isi par chalta hai),
     • lastBackupAt PUT par "Settings changed" notification NA aaye (backup reminder silently tick kare),
     • 🔐 naye IP se login par admin ko alert (aur features.alerts.newLoginIp=false par band),
     • 📧 email/test endpoint mock SMTP par actually mail deliver karta hai. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
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
  child.stderr.on('data', (d) => { logs += d; });
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => {
      logs += d;
      const m = logs.match(/http:\/\/0\.0\.0\.0:(\d+)/);
      if (m && m[1] !== '0') resolve(`http://127.0.0.1:${m[1]}`);
    });
    child.on('exit', (code) => reject(new Error(`Server exited ${code}: ${logs}`)));
  });
  const base = await Promise.race([ready, new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('Startup timeout: ' + logs)), 10000); t.unref(); })]);
  return { child, base, async stop() { if (child.exitCode !== null) return; child.kill('SIGTERM'); await once(child, 'exit'); } };
}

/** Minimal SMTP mock — EHLO/AUTH/MAIL/RCPT/DATA/QUIT; DATA capture karta hai. */
function startSmtp() {
  let inbox = '';
  const srv = net.createServer((sock) => {
    let buf = '', inData = false, authStage = 0;
    sock.write('220 mock-ESMTP ready\r\n');
    sock.on('data', (d) => {
      const s = d.toString('utf8');
      if (inData) {
        inbox += s;
        if (/\r?\n\.\r?\n/.test(s)) { inData = false; sock.write('250 queued\r\n'); }
        return;
      }
      buf += s;
      let i;
      while ((i = buf.search(/\r?\n/)) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + (buf[i] === '\r' ? 2 : 1));
        if (!line) continue;
        const cmd = line.toUpperCase();
        if (cmd.startsWith('EHLO')) sock.write('250-mock\r\n250 AUTH LOGIN PLAIN\r\n');
        else if (cmd.startsWith('HELO')) sock.write('250 mock\r\n');
        else if (cmd === 'AUTH LOGIN') { authStage = 1; sock.write('334 VXNlcm5hbWU6\r\n'); }
        else if (authStage === 1) { authStage = 2; sock.write('334 UGFzc3dvcmQ6\r\n'); }
        else if (authStage === 2) { authStage = 0; sock.write('235 2.7.0 accepted\r\n'); }
        else if (cmd.startsWith('AUTH ')) sock.write('235 ok\r\n');
        else if (cmd.startsWith('MAIL FROM')) sock.write('250 ok\r\n');
        else if (cmd.startsWith('RCPT TO')) sock.write('250 ok\r\n');
        else if (cmd === 'DATA') { inData = true; sock.write('354 end with dot\r\n'); }
        else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else if (cmd === 'STARTTLS') sock.write('454 TLS not available in mock\r\n');
        else sock.write('250 ok\r\n');
      }
    });
    sock.on('error', () => { /* test teardown */ });
  });
  return new Promise((resolve) => { srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port, get inbox() { return inbox; } })); });
}

test('features flags: defaults, admin modify (deep-merge), member se 4xx, SMTP secrets redacted, /api/version', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-feat-'));
  const upstream = http.createServer((req, res) => {
    res.end('google.visualization.Query.setResponse({\"status\":\"ok\",\"table\":{\"cols\":[{\"id\":\"A\",\"type\":\"number\"}],\"rows\":[]}});');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  let server;
  const call = async (route, method = 'GET', body, cookie = '', headers = {}) => {
    const res = await fetch(server.base + route, {
      method,
      headers: { cookie, 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https', ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    const setCookie = res.headers.get('set-cookie');
    const json = await res.json().catch(() => ({}));
    return { res, json, setCookie };
  };
  try {
    server = await startServer(dir, `http://127.0.0.1:${upstream.address().port}`);
    const adminCookie = (await call('/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' })).setCookie.split(';')[0];
    await call('/api/users', 'POST', { username: 'staff', name: 'Staff', password: 'staff-pass-1', role: 'user' }, adminCookie);
    const memberCookie = (await call('/api/auth/login', 'POST', { username: 'staff', password: 'staff-pass-1' })).setCookie.split(';')[0];

    // 1) Bina login settings nahi (global gate) — member ko features milte hain, par email secrets redacted.
    const unauth = await call('/api/settings');
    assert.ok(unauth.res.status >= 400, 'bina login /api/settings 401 chahiye');
    const mem = (await call('/api/settings', 'GET', null, memberCookie)).json.settings;
    assert.ok(mem && mem.features && mem.features.alerts, 'member ko features.alerts chahiye (defaults)');
    assert.equal(mem.features.search, true, 'default feature ON');
    assert.ok(mem.email, 'email config block present (shape) — par secrets khaali');
    assert.equal(mem.email.pass || '', '', 'SMTP password non-admin ko redacted hona chahiye');
    assert.equal(mem.email.user || '', '', 'SMTP user bhi redacted');

    // 2) Admin ko poora config milta hai + PUT modify kar sakta hai (nested deep-merge safe).
    const adm = (await call('/api/settings', 'GET', null, adminCookie)).json.settings;
    assert.equal(typeof adm.email.host, 'string', 'admin ko email config chahiye');
    const put = await call('/api/settings', 'PUT', { settings: { features: { search: false, alerts: { lowCover: false } } } }, adminCookie);
    assert.equal(put.res.status, 200, `admin PUT 200 — ${JSON.stringify(put.json)}`);
    const after = (await call('/api/settings', 'GET', null, adminCookie)).json.settings;
    assert.equal(after.features.search, false, 'search OFF save hua');
    assert.equal(after.features.alerts.lowCover, false, 'lowCover alert OFF save hua');
    assert.equal(after.features.alerts.midMonth, true, 'deep-merge: baaki alerts untouched rehne chahiye');
    assert.equal(after.features.share, true, 'deep-merge: baaki feature flags untouched');

    // 3) Member feature PUT nahi kar sakta.
    const denied = await call('/api/settings', 'PUT', { settings: { features: { search: true } } }, memberCookie);
    assert.ok(denied.res.status >= 400, 'non-admin feature modify nahi kar sakta');

    // 4) /api/version = sw.js CACHE_NAME (update-toast isi ko poll karta hai).
    const ver = await call('/api/version');
    assert.equal(ver.res.status, 200, 'version endpoint public 200');
    const sw = await fs.readFile(path.join(ROOT, 'sw.js'), 'utf8');
    const cache = (sw.match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/) || [])[1];
    assert.ok(cache, 'sw.js CACHE_NAME milna chahiye');
    assert.equal(ver.json.version, cache, '/api/version sw.js ke CACHE_NAME ke barabar hona chahiye');

    // 5) lastBackupAt save — par "Settings changed" notification NA aaye (silently track).
    let items = (await call('/api/notifications', 'GET', null, adminCookie)).json.items || [];
    const beforeN = items.length;
    const bk = await call('/api/settings', 'PUT', { settings: { lastBackupAt: new Date().toISOString() } }, adminCookie);
    assert.equal(bk.res.status, 200, 'lastBackupAt PUT 200');
    items = (await call('/api/notifications', 'GET', null, adminCookie)).json.items || [];
    assert.equal(items.length, beforeN, 'backup timestamp par koi nayi notification nahi (changeList skip)');
    assert.ok((await call('/api/settings', 'GET', null, adminCookie)).json.settings.lastBackupAt, 'admin settings me lastBackupAt saved');

    // 6) 🔐 Naye IP se login → admin alert; wahi IP dobara → nahi; flag OFF → bilkul nahi.
    await call('/api/auth/login', 'POST', { username: 'staff', password: 'staff-pass-1' }, '', { 'X-Forwarded-For': '203.0.113.7' }); // pehla login already hua (127.0.0.1) — ye naya IP
    items = (await call('/api/notifications', 'GET', null, adminCookie)).json.items || [];
    const ipAlerts = () => items.filter((i) => /Naye IP/.test(i.title));
    assert.equal(ipAlerts().length, 1, `naye IP par 1 alert chahiye — got: ${ipAlerts().map((i) => i.title).join(', ')}`);
    assert.equal(ipAlerts()[0].type, 'alert', 'naye IP alert ka type alert hona chahiye (Critical alerts toggle)');
    assert.equal(ipAlerts()[0].meta && ipAlerts()[0].meta.link, '#/settings?tab=users', 'redirect link → Users tab');
    await call('/api/auth/login', 'POST', { username: 'staff', password: 'staff-pass-1' }, '', { 'X-Forwarded-For': '203.0.113.7' }); // wahi IP dobara
    items = (await call('/api/notifications', 'GET', null, adminCookie)).json.items || [];
    assert.equal(ipAlerts().length, 1, 'known IP dobara login par dobara alert nahi');
    await call('/api/settings', 'PUT', { settings: { features: { alerts: { newLoginIp: false } } } }, adminCookie);
    await call('/api/auth/login', 'POST', { username: 'staff', password: 'staff-pass-1' }, '', { 'X-Forwarded-For': '198.51.100.20' });
    items = (await call('/api/notifications', 'GET', null, adminCookie)).json.items || [];
    assert.equal(ipAlerts().length, 1, 'features.alerts.newLoginIp=false par naya IP alert nahi aana chahiye');
  } finally {
    if (server) await server.stop();
    await new Promise((r) => upstream.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('📧 email test endpoint mock SMTP par mail deliver karta hai (AUTH + DATA)', async () => {
  const smtp = await startSmtp();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-featmail-'));
  const upstream = http.createServer((req, res) => {
    res.end('google.visualization.Query.setResponse({\"status\":\"ok\",\"table\":{\"cols\":[{\"id\":\"A\",\"type\":\"number\"}],\"rows\":[]}});');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  let server;
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
    const adminCookie = (await call('/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' })).setCookie.split(';')[0];
    const save = await call('/api/settings', 'PUT', { settings: { email: { host: '127.0.0.1', port: smtp.port, secure: false, user: 'mailer', pass: 'secret-1', from: 'alerts@example.test', to: 'boss@example.test, team@example.test' } } }, adminCookie);
    assert.equal(save.res.status, 200, `email settings save 200 — ${JSON.stringify(save.json)}`);
    const test1 = await call('/api/notifications/email/test', 'POST', {}, adminCookie);
    assert.equal(test1.res.status, 200, `email test 200 chahiye — ${JSON.stringify(test1.json)}`);
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(smtp.inbox.includes('Subject: =?UTF-8?B?'), 'DATA me encoded subject hona chahiye');
    const bodyB64 = (smtp.inbox.split(/\r?\n\r?\n/) || []).slice(1).join('').replace(/\r?\n/g, '').replace(/\.$/, '');
    const bodyTxt = Buffer.from(bodyB64, 'base64').toString('utf8');
    assert.match(bodyTxt, /test email/i, 'mail body decode hokar "test email" dikhna chahiye');
    assert.ok(smtp.inbox.includes('To: boss@example.test, team@example.test'), 'multiple recipients RCPT ke saath DATA header me');
    // member ko yeh endpoint chahiye hi nahi
    await call('/api/users', 'POST', { username: 'mailr', name: 'M', password: 'mail-pass-1', role: 'user' }, adminCookie);
    const mc = (await call('/api/auth/login', 'POST', { username: 'mailr', password: 'mail-pass-1' })).setCookie.split(';')[0];
    const denied = await call('/api/notifications/email/test', 'POST', {}, mc);
    assert.ok(denied.res.status >= 400, 'non-admin email test nahi bhej sakta');
  } finally {
    if (server) await server.stop();
    await new Promise((r) => upstream.close(r));
    await new Promise((r) => smtp.srv.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
