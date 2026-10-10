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
  let inbox = '', rejectData = false;
  const srv = net.createServer((sock) => {
    let buf = '', inData = false, authStage = 0;
    sock.write('220 mock-ESMTP ready\r\n');
    sock.on('data', (d) => {
      const s = d.toString('utf8');
      if (inData) {
        inbox += s;
        if (/\r?\n\.\r?\n/.test(s)) { inData = false; sock.write(rejectData ? '550 message rejected\r\n' : '250 queued\r\n'); }
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
  return new Promise((resolve) => { srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port, get inbox() { return inbox; }, setRejectData(v) { rejectData = !!v; } })); });
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
    const notifyDefaults = await call('/api/notifications/prefs', 'GET', null, memberCookie);
    assert.equal(notifyDefaults.json.prefs.tone, 'classic', 'notification/update tone defaults to Classic');
    const toneSaved = await call('/api/notifications/prefs', 'PUT', { prefs: { tone: 'chime' } }, memberCookie);
    assert.equal(toneSaved.json.prefs.tone, 'chime', 'selected beep tone persists per user');
    const invalidTone = await call('/api/notifications/prefs', 'PUT', { prefs: { tone: 'made-up-tone' } }, memberCookie);
    assert.equal(invalidTone.json.prefs.tone, 'chime', 'invalid tone cannot overwrite a valid preference');

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

    // 2b) Admin commission slabs save hote hain; invalid rates are rejected.
    const slabs = [
      { min: 1, max: 50, rate: '2.5' }, { min: 51, max: 100, rate: '3' },
      { min: 101, max: 150, rate: '4' }, { min: 151, max: 250, rate: '5' },
      { min: 251, max: null, rate: '6' }
    ];
    const slabPut = await call('/api/settings', 'PUT', { settings: { commissionSlabs: { enabled: true, model: 'agentTier', channels: { ff: slabs, gv: slabs } } } }, adminCookie);
    assert.equal(slabPut.res.status, 200, `valid FF/GV commission slabs save hone chahiye — ${JSON.stringify(slabPut.json)}`);
    const savedSlabs = (await call('/api/settings', 'GET', null, adminCookie)).json.settings.commissionSlabs;
    assert.equal(savedSlabs.channels.ff[0].rate, 2.5);
    assert.equal(savedSlabs.channels.gv[4].rate, 6);
    const badSlabs = slabs.map((x) => ({ ...x })); badSlabs[0].rate = '-1';
    const invalidSlabs = await call('/api/settings', 'PUT', { settings: { commissionSlabs: { channels: { ff: badSlabs } } } }, adminCookie);
    assert.equal(invalidSlabs.res.status, 400, 'negative slab rate reject hona chahiye');

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
    const shell = await fetch(server.base + '/');
    assert.match(shell.headers.get('permissions-policy') || '', /microphone=\(self\)/, 'voice-search mic same-origin ke liye allowed');
    assert.doesNotMatch(shell.headers.get('permissions-policy') || '', /microphone=\(\)/, 'mic globally blocked nahi');
    assert.match(shell.headers.get('content-security-policy') || '', /tile\.openstreetmap\.org/, 'real team-map tiles CSP me allowed');

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
    // SMTP DATA ke baad 550 de to UI/API ko jhootha success nahi dikhna chahiye.
    smtp.setRejectData(true);
    const rejected = await call('/api/notifications/email/test', 'POST', {}, adminCookie);
    assert.equal(rejected.res.status, 502, `DATA rejection 502 hona chahiye — ${JSON.stringify(rejected.json)}`);
    assert.match(rejected.json.error || '', /550 message rejected/, 'actual SMTP rejection admin ko samajh aaye');
    smtp.setRejectData(false);
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

test('📧 email provider settings: validation, secrets redacted, status + diagnose (admin only)', async () => {
  const smtp = await startSmtp();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-featmail2-'));
  const upstream = http.createServer((req, res) => { res.end('google.visualization.Query.setResponse({\"status\":\"ok\",\"table\":{\"cols\":[{\"id\":\"A\",\"type\":\"number\"}],\"rows\":[]}});'); });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  let server;
  const call = async (route, method = 'GET', body, cookie = '') => {
    const res = await fetch(server.base + route, { method, headers: { cookie, 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' }, body: body ? JSON.stringify(body) : undefined });
    return { res, json: await res.json().catch(() => ({})), setCookie: res.headers.get('set-cookie') };
  };
  try {
    server = await startServer(dir, `http://127.0.0.1:${upstream.address().port}`);
    const adminCookie = (await call('/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' })).setCookie.split(';')[0];
    const bad = await call('/api/settings', 'PUT', { settings: { email: { provider: 'pigeon' } } }, adminCookie);
    assert.equal(bad.res.status, 400, 'unknown provider reject');
    const ok = await call('/api/settings', 'PUT', { settings: { email: { provider: 'auto', host: '127.0.0.1', port: smtp.port, user: 'mailer', pass: 'secret-1', from: 'a@example.test', to: 'b@example.test', resendKey: 're_secret_key', brevoKey: 'xkeysib-secret' } } }, adminCookie);
    assert.equal(ok.res.status, 200);
    const status = await call('/api/notifications/email/status', 'GET', undefined, adminCookie);
    assert.equal(status.res.status, 200);
    assert.equal(status.json.providers.smtp, true); assert.equal(status.json.providers.resend, true); assert.equal(status.json.providers.brevo, true);
    assert.equal(status.json.order[0], 'smtp');
    const diag = await call('/api/notifications/email/diagnose', 'POST', {}, adminCookie);
    assert.equal(diag.res.status, 200);
    assert.ok(diag.json.checks.some((c) => /TCP 127\.0\.0\.1/.test(c.name) && c.ok), 'mock SMTP port reachable');
    await call('/api/users', 'POST', { username: 'mailz', name: 'M', password: 'mail-pass-1', role: 'user' }, adminCookie);
    const mc = (await call('/api/auth/login', 'POST', { username: 'mailz', password: 'mail-pass-1' })).setCookie.split(';')[0];
    const member = await call('/api/settings', 'GET', undefined, mc);
    assert.equal(member.json.settings.email.resendKey, '', 'Resend key member ko nahi');
    assert.equal(member.json.settings.email.brevoKey, '', 'Brevo key member ko nahi');
    assert.equal(member.json.settings.email.pass, '');
    assert.ok((await call('/api/notifications/email/diagnose', 'POST', {}, mc)).res.status >= 400, 'non-admin diagnose nahi');
    assert.ok((await call('/api/notifications/email/status', 'GET', undefined, mc)).res.status >= 400, 'non-admin status nahi');
  } finally {
    if (server) await server.stop();
    await new Promise((r) => upstream.close(r));
    await new Promise((r) => smtp.srv.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// Round 2: 🔐 OTP (2FA on new IP) — 428 flow + email code + audit + admin ON/OFF toggle
// ---------------------------------------------------------------------------------------------
test('🔐 OTP 2FA: naye IP par 428 + email code verify, audit log, feature OFF = seedha login', async () => {
  const smtp = await startSmtp();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-feat-otp-'));
  const upstream = http.createServer((req, res) => {
    res.end('google.visualization.Query.setResponse({"status":"ok","table":{"cols":[{"id":"A","type":"number"}],"rows":[]}});');
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
    const mk = await call('/api/users', 'POST', { username: 'otpuser', name: 'OTP User', email: 'otp@example.test', password: 'otp-pass-1', role: 'user' }, adminCookie);
    assert.equal(mk.res.status, 200, `user create — ${JSON.stringify(mk.json)}`);
    const save = await call('/api/settings', 'PUT', { settings: { email: { host: '127.0.0.1', port: smtp.port, secure: false, user: 'mailer', pass: 'secret-1', from: 'alerts@example.test', to: 'boss@example.test' } } }, adminCookie);
    assert.equal(save.res.status, 200, `SMTP save — ${JSON.stringify(save.json)}`);
    // pehla login (history khali) → seedha
    const l1 = await call('/api/auth/login', 'POST', { username: 'otpuser', password: 'otp-pass-1' });
    assert.equal(l1.res.status, 200, `pehla login seedha — ${JSON.stringify(l1.json)}`);
    // naye IP se login → 428 OTP
    const l2 = await call('/api/auth/login', 'POST', { username: 'otpuser', password: 'otp-pass-1' }, '', { 'X-Forwarded-For': '203.0.113.9' });
    assert.equal(l2.res.status, 428, `naye IP par 428 OTP chahiye — ${JSON.stringify(l2.json)}`);
    assert.ok(l2.json.otpRequired && l2.json.ticket && l2.json.hint, 'otpRequired + ticket + hint milna chahiye');
    // code email me
    await new Promise((r) => setTimeout(r, 250));
    const bodyB64 = (smtp.inbox.split(/\r?\n\r?\n/) || []).slice(1).join('').replace(/\r?\n/g, '').replace(/\.$/, '');
    const bodyTxt = Buffer.from(bodyB64, 'base64').toString('utf8');
    const code = (bodyTxt.match(/code: (\d{6})/) || [])[1];
    assert.ok(code, `OTP code mail ke body me milna chahiye — ${bodyTxt.slice(0, 220)}`);
    // galat code → 401, sahi → session
    const bad = await call('/api/auth/otp', 'POST', { ticket: l2.json.ticket, code: '000000' });
    assert.equal(bad.res.status, 401, `galat OTP 401 — ${JSON.stringify(bad.json)}`);
    const ok = await call('/api/auth/otp', 'POST', { ticket: l2.json.ticket, code });
    assert.equal(ok.res.status, 200, `sahi OTP se login — ${JSON.stringify(ok.json)}`);
    const otpCookie = (ok.setCookie || '').split(';')[0];
    assert.ok(otpCookie, 'OTP login session cookie chahiye');
    const me = await call('/api/auth/me', 'GET', undefined, otpCookie);
    assert.equal(me.json.user && me.json.user.username, 'otpuser', 'OTP ke baad session chal raha hai');
    // 📜 audit me otp_sent + otp_fail (admin only)
    const audit = await call('/api/audit', 'GET', undefined, adminCookie);
    assert.equal(audit.res.status, 200, `admin audit 200 — ${JSON.stringify(audit.json).slice(0, 160)}`);
    const acts = (audit.json.entries || []).map((e) => e.action);
    assert.ok(acts.includes('otp_sent') && acts.includes('otp_fail'), `audit me otp_sent + otp_fail chahiye — ${acts.join(',')}`);
    // 🔐 admin toggle OFF → naye IP par bhi seedha login
    const off = await call('/api/settings', 'PUT', { settings: { features: { otp2fa: false } } }, adminCookie);
    assert.equal(off.json.settings && off.json.settings.features.otp2fa, false, `features.otp2fa false save hua — ${JSON.stringify(off.json).slice(0, 200)}`);
    const l3 = await call('/api/auth/login', 'POST', { username: 'otpuser', password: 'otp-pass-1' }, '', { 'X-Forwarded-For': '198.51.100.4' });
    assert.equal(l3.res.status, 200, `otp2fa OFF = naye IP par bhi seedha login — ${JSON.stringify(l3.json)}`);
  } finally {
    if (server) await server.stop();
    await new Promise((r) => upstream.close(r));
    await new Promise((r) => smtp.srv.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// Round 2: 📢 announcements + 📜 audit + 📬 weekly auto digest + 📊 report email (CSV attach)
// ---------------------------------------------------------------------------------------------
test('📢 announcement broadcast, 📜 audit log, 📬 weekly digest + 📊 report email force (HTML+CSV)', async () => {
  const smtp = await startSmtp();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-feat-round2-'));
  const pad = (n) => String(n).padStart(2, '0');
  // 🔧 FIX: server IST (UTC+5:30) calendar par chalta hai (istNow/dateKeyNow) — fixtures bhi usi
  // basis par banao. UTC dates se 18:30–24:00 UTC (IST 00:00–05:30) window aur month-boundary
  // (1–3 tareekh) par MTD expectations toot jaati thin.
  const istNow = new Date(Date.now() + 5.5 * 3600e3);
  const dcell = (d) => `Date(${d.getUTCFullYear()},${d.getUTCMonth()},${d.getUTCDate()})`;
  const istDayBack = (i) => new Date(istNow.getTime() - i * 86400e3);
  const rowsFF = [{ c: [{ v: dcell(istDayBack(0)) }, { v: '1' }, { v: '999' }, { v: 40 }] }, { c: [{ v: dcell(istDayBack(1)) }, { v: '1' }, { v: '999' }, { v: 35 }] }, { c: [{ v: dcell(istDayBack(2)) }, { v: '1' }, { v: '999' }, { v: 0 }] }, { c: [{ v: dcell(istDayBack(3)) }, { v: '1' }, { v: '999' }, { v: 0 }] }];
  const rowsGV = [{ c: [{ v: dcell(istDayBack(0)) }, { v: '1' }, { v: 12 }] }, { c: [{ v: dcell(istDayBack(1)) }, { v: '1' }, { v: 9 }] }, { c: [{ v: dcell(istDayBack(2)) }, { v: '1' }, { v: 5 }] }, { c: [{ v: dcell(istDayBack(3)) }, { v: '1' }, { v: 0 }] }];
  // The GV live card/watcher reads individual GV Master rows, unlike the grouped 90-day history.
  const rowsGVLive = Array.from({ length: 12 }, (_, i) => ({ c: [
    { v: dcell(istDayBack(0)) }, { v: 'VC4' }, { v: `GV-${i + 1}` }, { v: 'Active' }, { v: 'RFID' }
  ] }));
  // Expected MTD: server ke sourceAwareDigestSummary ko hi mirror karo — IST current month me
  // jo rows aati hain utni hi (month boundary par bhi sahi).
  const ymIst = `${istNow.getUTCFullYear()}-${pad(istNow.getUTCMonth() + 1)}`;
  const ffVals = [40, 35, 0, 0], gvVals = [12, 9, 5, 0];
  let expFf = 0, expGv = 0, expActive = 0, expZero = 0;
  for (let i = 0; i < 4; i++) {
    const d = istDayBack(i);
    if (`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}` !== ymIst) continue;
    expFf += ffVals[i]; expGv += gvVals[i];
    if (ffVals[i] + gvVals[i] > 0) expActive++; else expZero++;
  }
  const upstream = http.createServer((req, res) => {
    const tq = new URL(req.url, 'http://x').searchParams.get('tq') || '';
    let rows = [];
    const liveMasterQuery = /select P, G, (?:F, )?I, N, U/i.test(tq);
    const groupedMasterQuery = /group by P, G(?:, F)?/i.test(tq);
    if (/group by AA/.test(tq)) rows = rowsFF;                         // FF EIR snapshot (date, class, master, count)
    else if (liveMasterQuery) rows = rowsGVLive;                      // live GV Master rows (date, CCH, optional VCLASS, tag, status, type)
    else if (groupedMasterQuery) rows = rowsGV;                       // GV 90-day history (date, CCH, optional VCLASS, count)
    const headerCols = Array.from({ length: 23 }, (_, i) => ({ id: String.fromCharCode(65 + i), label: '' }));
    headerCols[5].label = 'VCLASS'; headerCols[6].label = 'CCH'; headerCols[8].label = 'TAG_ID_NUMBER';
    headerCols[13].label = 'STATUS'; headerCols[15].label = 'ISSUE_DATE'; headerCols[20].label = 'TAG_TYPE';
    const useVClass = /select P, G, F,|group by P, G, F/i.test(tq);
    const cols = /^select \* limit 1$/i.test(tq) ? headerCols
      : liveMasterQuery
        ? (useVClass
          ? [{ id: 'P', type: 'date' }, { id: 'G', type: 'string' }, { id: 'F', type: 'string' }, { id: 'I', type: 'string' }, { id: 'N', type: 'string' }, { id: 'U', type: 'string' }]
          : [{ id: 'P', type: 'date' }, { id: 'G', type: 'string' }, { id: 'I', type: 'string' }, { id: 'N', type: 'string' }, { id: 'U', type: 'string' }])
        : useVClass
          ? [{ id: 'P', type: 'date' }, { id: 'G', type: 'string' }, { id: 'F', type: 'string' }, { id: 'count-I', type: 'number' }]
          : [{ id: 'P', type: 'date' }, { id: 'G', type: 'string' }, { id: 'count-I', type: 'number' }];
    if (liveMasterQuery && useVClass) rows = rows.map((row) => ({ c: [row.c[0], row.c[1], { v: '' }, ...row.c.slice(2)] }));
    else if (groupedMasterQuery && useVClass) rows = rows.map((row) => ({ c: [row.c[0], row.c[1], { v: '' }, row.c[2]] }));
    res.end(`google.visualization.Query.setResponse(${JSON.stringify({ status: 'ok', table: { cols, rows } })});`);
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
  const decodeMails = () => smtp.inbox.split(/\r?\n\.\r?\n/).filter(Boolean).map((seg) => {
    const parts = seg.split(/\r?\n\r?\n/);
    const body = (parts.slice(1).join('\n\n')).replace(/\r?\n/g, '');
    return Buffer.from(body, 'base64').toString('utf8');
  });
  try {
    server = await startServer(dir, `http://127.0.0.1:${upstream.address().port}`);
    const adminCookie = (await call('/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' })).setCookie.split(';')[0];
    await call('/api/users', 'POST', { username: 'annuser', name: 'Ann User', password: 'ann-pass-1', role: 'user' }, adminCookie);
    const memberCookie = (await call('/api/auth/login', 'POST', { username: 'annuser', password: 'ann-pass-1' })).setCookie.split(';')[0];

    // 📢 announcement → sab users ke bell me broadcast
    const an = await call('/api/announcements', 'POST', { text: 'Kal 11 AM sabka monthly meeting — attendance zaroori.' }, adminCookie);
    assert.equal(an.res.status, 200, `announcement bhej di — ${JSON.stringify(an.json).slice(0, 200)}`);
    const list = await call('/api/notifications', 'GET', undefined, memberCookie);
    const found = (list.json.items || []).find((n) => n.meta && n.meta.announce);
    assert.ok(found, 'member ke bell panel me announcement dikhni chahiye');
    assert.match(found.body || '', /monthly meeting/, 'announcement text sahi hai');

    // SMTP on + forces
    await call('/api/settings', 'PUT', { settings: { email: { host: '127.0.0.1', port: smtp.port, secure: false, user: 'mailer', pass: 'secret-1', from: 'alerts@example.test', to: 'boss@example.test' } } }, adminCookie);
    const digest = await call('/api/notifications/digest', 'POST', {}, adminCookie);
    assert.equal(digest.res.status, 200, `digest force — ${JSON.stringify(digest.json).slice(0, 220)}`);
    assert.equal(digest.json.ok, true, `digest bell payload bana — ${JSON.stringify(digest.json).slice(0, 260)}`);
    const digestItem = digest.json.item || {};
    // Mahine ki 1-3 tareekh par pichhle mahine ki rows month boundary ke bahar hoti hain, aur
    // IST-UTC midnight window me din alag padta tha — expectation IST month membership se ginna.
    const expTotal = expFf + expGv;
    assert.match(digestItem.body || '', new RegExp(`MTD FF ${expFf} \\+ GV ${expGv} = ${expTotal}`), 'digest me FF + GV combined MTD sahi hai');
    assert.equal(digestItem.meta && digestItem.meta.ffMtd, expFf, 'digest meta FF MTD source snapshot se aaya');
    assert.equal(digestItem.meta && digestItem.meta.gvMtd, expGv, 'digest meta GV MTD source snapshot se aaya');
    assert.equal(digestItem.meta && digestItem.meta.mtdDays, expActive, 'GV-only/FF-only ko active days me saath count karta hai');
    assert.equal(digestItem.meta && digestItem.meta.zeroDays, expZero, 'explicit zero snapshot ko zero day ke roop me rakhta hai');
    const wk = await call('/api/notifications/weekly-email', 'POST', {}, adminCookie);
    assert.equal(wk.res.status, 200, `weekly force — ${JSON.stringify(wk.json).slice(0, 200)}`);
    assert.equal(wk.json.ok, true, `weekly email bheji — ${JSON.stringify(wk.json)}`);
    const rp = await call('/api/notifications/report-email', 'POST', {}, adminCookie);
    assert.equal(rp.res.status, 200, `report force — ${JSON.stringify(rp.json).slice(0, 200)}`);
    assert.equal(rp.json.ok, true, `report email bheji (daily rows ke saath) — ${JSON.stringify(rp.json)}`);
    await new Promise((r) => setTimeout(r, 250));
    const mails = decodeMails();
    assert.ok(mails.some((t) => /Weekly digest/.test(t)), `weekly mail body me "Weekly digest" — ${mails.map((t) => t.slice(0, 60)).join(' | ')}`);
    // report mail multipart hoti hai — subject decode karke check karo (body MIME-structured hai)
    const subjects = [...smtp.inbox.matchAll(/Subject: =\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g)].map((m) => Buffer.from(m[1], 'base64').toString('utf8'));
    assert.ok(subjects.some((t) => /Daily report/.test(t)), `report mail subject me "Daily report" — ${subjects.join(' | ')}`);
    assert.ok(subjects.some((t) => /Weekly digest/.test(t)), `weekly mail subject bhi encoded — ${subjects.join(' | ')}`);
    assert.ok(smtp.inbox.includes('Content-Type: multipart/mixed'), 'report mail multipart (CSV attach) hai');
    assert.ok(smtp.inbox.includes('Content-Type: text/csv') && smtp.inbox.includes('filename="report-'), 'CSV attachment header hai');

    // 📜 audit: announcement + email sends + admin-only access
    const audit = await call('/api/audit', 'GET', undefined, adminCookie);
    const acts = (audit.json.entries || []).map((e) => e.action);
    for (const need of ['announcement', 'weekly_email_sent', 'report_email_sent', 'login']) {
      assert.ok(acts.includes(need), `audit me "${need}" chahiye — ${acts.join(',')}`);
    }
    const denied = await call('/api/audit', 'GET', undefined, memberCookie);
    assert.ok(denied.res.status >= 400, `member audit nahi dekh sakta (${denied.res.status})`);

    // 🔁 feature toggles persist (admin on/off — jaise weekly digest email ka control)
    const on = await call('/api/settings', 'PUT', { settings: { features: { weeklyEmail: true, emailReport: true, announcements: false } } }, adminCookie);
    const onF = (on.json.settings || {}).features || {};
    assert.equal(onF.weeklyEmail, true, `weeklyEmail ON save — ${JSON.stringify(onF).slice(0, 200)}`);
    assert.equal(onF.emailReport, true, 'emailReport ON save');
    assert.equal(onF.announcements, false, 'announcements OFF save');
    const off = await call('/api/settings', 'PUT', { settings: { features: { weeklyEmail: false, emailReport: false, announcements: true } } }, adminCookie);
    const offF = (off.json.settings || {}).features || {};
    assert.equal(offF.weeklyEmail, false, 'weeklyEmail OFF wapas');
    assert.equal(offF.emailReport, false, 'emailReport OFF wapas');
  } finally {
    if (server) await server.stop();
    await new Promise((r) => upstream.close(r));
    await new Promise((r) => smtp.srv.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// Round 3: 🔗 personal links (agent + TL), 🗺 team location, 🏆 TL/agent anomaly force, flags
// ---------------------------------------------------------------------------------------------
test('🔗 personal links (agent+TL) /p/ pages, 🗺 team location, 🏆 anomaly force (agent+TL)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-feat-r3-'));
  const pad = (n) => String(n).padStart(2, '0');
  // 🔧 FIX: server IST calendar (dateKeyNow) par chalta hai — fixture dates bhi usi basis par,
  // warna 18:30–24:00 UTC me snapshot "aaj" nahi lagta tha → sheetToday false → anomaly skip.
  const dcell = (d) => `Date(${d.getUTCFullYear()},${d.getUTCMonth()},${d.getUTCDate()})`;
  const dayBack = (i) => new Date(Date.now() + 5.5 * 3600e3 - i * 86400e3);
  // personal daily rows: aaj se 12 din (7,7,…) + pichhle mahine ke 5 din
  const personalRows = [];
  for (let i = 0; i < 12; i++) personalRows.push({ c: [{ v: dcell(dayBack(i)) }, { v: '1' }, { v: 7 }] });
  const pm = new Date(Date.now() + 5.5 * 3600e3); pm.setUTCMonth(pm.getUTCMonth() - 1);
  for (let d = 1; d <= 5; d++) personalRows.push({ c: [{ v: dcell(new Date(Date.UTC(pm.getUTCFullYear(), pm.getUTCMonth(), d))) }, { v: '1' }, { v: 5 }] });
  // anomaly rows: prev7 full, aaj ZERO (row hi nahi)
  const agentRows = [];
  for (let i = 1; i <= 7; i++) agentRows.push({ c: [{ v: 'Rahul Dravid' }, { v: dcell(dayBack(i)) }, { v: 10 }] });
  const tlRows = [];
  for (let i = 1; i <= 7; i++) tlRows.push({ c: [{ v: 'Zoya Khan' }, { v: dcell(dayBack(i)) }, { v: 20 }] });
  // TL team rows (personal TL page)
  const teamRows = [];
  for (let i = 1; i <= 7; i++) teamRows.push({ c: [{ v: 'Team Member One' }, { v: dcell(dayBack(i)) }, { v: 9 }] });
  teamRows.push({ c: [{ v: 'Team Member One' }, { v: dcell(dayBack(0)) }, { v: 6 }] });
  const snapRows = [{ c: [{ v: dcell(dayBack(0)) }, { v: '1' }, { v: '999' }, { v: 40 }] }, { c: [{ v: dcell(dayBack(1)) }, { v: '1' }, { v: '999' }, { v: 35 }] }];
  const gvRows = [{ c: [{ v: dcell(dayBack(0)) }, { v: '1' }, { v: 12 }] }];
  const upstream = http.createServer((req, res) => {
    const tq = new URL(req.url, 'http://x').searchParams.get('tq') || '';
    let rows = [];
    if (/group by AA, D, AU/.test(tq)) rows = snapRows;
    else if (/group by L, AA/.test(tq) && /(where|and) BA = /.test(tq)) rows = teamRows;      // personal TL team
    else if (/group by L, AA/.test(tq)) rows = agentRows;                            // agent anomaly
    else if (/group by BA, AA/.test(tq)) rows = tlRows;                              // TL anomaly
    else if (/group by AA, D/.test(tq)) rows = personalRows;                         // personal daily
    else if (/group by P, G/.test(tq)) rows = gvRows;
    res.end(`google.visualization.Query.setResponse(${JSON.stringify({ status: 'ok', table: { cols: [{ id: 'A', type: 'date' }, { id: 'B', type: 'string' }, { id: 'C', type: 'number' }, { id: 'D', type: 'number' }], rows } })});`);
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
    const text = await res.text().catch(() => '');
    return { res, json, setCookie, text };
  };
  try {
    server = await startServer(dir, `http://127.0.0.1:${upstream.address().port}`);
    const adminCookie = (await call('/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' })).setCookie.split(';')[0];
    await call('/api/users', 'POST', { username: 'r3user', name: 'R3 User', password: 'r3-pass-1', role: 'user' }, adminCookie);
    const memberCookie = (await call('/api/auth/login', 'POST', { username: 'r3user', password: 'r3-pass-1' })).setCookie.split(';')[0];

    // ---- 🔗 agent link: admin credentials are mandatory and the initial HTML is data-free ----
    const missingCredentials = await call('/api/personal-links', 'POST', { kind: 'agent', name: 'Rahul Dravid' }, adminCookie);
    assert.equal(missingCredentials.res.status, 400, 'link ko admin-configured ID + mobile ke bina create nahi kar sakte');
    const ca = await call('/api/personal-links', 'POST', { kind: 'agent', name: 'Rahul Dravid', personId: 'AG-1001', mobile: '9876543210' }, adminCookie);
    assert.equal(ca.res.status, 200, `agent link create — ${JSON.stringify(ca.json).slice(0, 180)}`);
    const agentToken = ca.json.link.token;
    const pageA = await fetch(`${server.base}/p/${agentToken}`);
    assert.equal(pageA.status, 200, `agent verification page 200 — ${pageA.status}`);
    const gateA = await pageA.text();
    assert.ok(gateA.includes('Verification Required') && gateA.includes('pl-auth-form'), 'unauthenticated link shows a verification form');
    assert.doesNotMatch(gateA, /Rahul Dravid|MTD issued|Class-wise Stock|Performance &amp; Growth|data-pl-csv/, 'no person name, report data, or exports are sent before verification');
    const wrongAgentId = await call('/api/public/personal-link/verify', 'POST', { token: agentToken, personId: 'Rahul Dravid', mobile: '9876543210' });
    assert.equal(wrongAgentId.res.status, 403, 'a name/partial ID is not accepted as the configured Agent ID');
    assert.equal(wrongAgentId.setCookie, null, 'failed verification cannot create a session');
    const wrongAgentMobile = await call('/api/public/personal-link/verify', 'POST', { token: agentToken, personId: 'AG-1001', mobile: '9876543211' });
    assert.equal(wrongAgentMobile.res.status, 403, 'registered mobile must match exactly');
    const verifiedA = await call('/api/public/personal-link/verify', 'POST', { token: agentToken, personId: ' ag 1001 ', mobile: '987-654-3210' });
    assert.equal(verifiedA.res.status, 200, 'normalized exact ID and 10-digit mobile verify');
    assert.equal(verifiedA.json.name, undefined, 'verify endpoint returns no report or identity data');
    assert.match(verifiedA.setCookie || '', /HttpOnly/, 'verification grants an HttpOnly session cookie');
    const agentCookie = (verifiedA.setCookie || '').split(';')[0];
    const pageAAuth = await fetch(`${server.base}/p/${agentToken}`, { headers: { cookie: agentCookie } });
    assert.equal(pageAAuth.status, 200, `verified agent report 200 — ${pageAAuth.status}`);
    const htmlA = await pageAAuth.text();
    assert.ok(htmlA.includes('Rahul Dravid'), 'verified page contains agent name');
    assert.ok(htmlA.includes('Welcome Back, <b>Rahul Dravid</b>'), 'verified personal report greets the authenticated agent');
    assert.ok(htmlA.includes('Daily Issuance · Last 14 Days'), 'daily issuance graph has an explicit title');
    assert.ok(htmlA.includes('pl-tbl-date-matrix') && htmlA.includes('Agent Name') && htmlA.includes('14-Day Total'), 'date matrix uses agent rows and date columns');
    assert.ok(htmlA.includes('pl-exp-stock-csv'), 'stock CSV action is available when stock and export are permitted');
    assert.ok(htmlA.includes('MTD issued') && htmlA.includes('Last'), 'overview KPI and 14-day chart render');
    assert.ok(htmlA.includes('Class-wise Stock') && htmlA.includes('Date-wise Issuance') && htmlA.includes('Performance &amp; Growth'), 'all allowed report sections are included');
    assert.ok(htmlA.includes('data-pl-csv') && htmlA.includes('data-pl-pdf') && htmlA.includes('pl-exp-all-pdf'), 'section and full CSV/PDF export actions are available');
    assert.ok(!/personalLinks|password/i.test(htmlA), 'page me koi server secret nahi');
    const denyAll = await call(`/api/personal-links/${ca.json.link.id}`, 'PUT', { personId: 'AG-1001', mobile: '9876543210', sections: ['export'] }, adminCookie);
    assert.equal(denyAll.res.status, 200, 'admin can revoke every report section');
    assert.deepEqual(denyAll.json.link.sections, [], 'server will not grant exports without at least one visible report section');
    const sectionRevoked = await fetch(`${server.base}/p/${agentToken}`, { headers: { cookie: agentCookie } });
    const sectionGateHtml = await sectionRevoked.text();
    assert.ok(sectionGateHtml.includes('Verification Required') && !sectionGateHtml.includes('Rahul Dravid'), 'changing section permissions revokes existing personal-link sessions');
    const verifyEmpty = await call('/api/public/personal-link/verify', 'POST', { token: agentToken, personId: 'AG-1001', mobile: '9876543210' });
    assert.equal(verifyEmpty.res.status, 200);
    const emptySectionsPage = await fetch(`${server.base}/p/${agentToken}`, { headers: { cookie: verifyEmpty.setCookie.split(';')[0] } });
    const emptySectionsHtml = await emptySectionsPage.text();
    assert.ok(emptySectionsHtml.includes('No report sections enabled'), 'empty allow-list renders a locked/empty portal, not the global defaults');
    assert.doesNotMatch(emptySectionsHtml, /MTD issued|Class-wise Stock|Date-wise Issuance|Performance &amp; Growth|data-pl-csv|data-pl-pdf|pl-exp-all-pdf/, 'no report values or exports leak when every section is revoked');
    const logoutA = await call('/api/public/personal-link/logout', 'POST', { token: agentToken }, verifyEmpty.setCookie.split(';')[0]);
    assert.equal(logoutA.res.status, 200);
    const lockedAgain = await fetch(`${server.base}/p/${agentToken}`);
    const lockedHtml = await lockedAgain.text();
    assert.ok(lockedHtml.includes('Verification Required') && !lockedHtml.includes('Rahul Dravid'), 'logout removes the server session and report HTML');

    // ---- 🔗 TL link (team + goal section) ----
    const ct = await call('/api/personal-links', 'POST', { kind: 'tl', name: 'Zoya Khan', personId: 'TL-220', mobile: '9123456780' }, adminCookie);
    assert.equal(ct.res.status, 200, `TL link create — ${JSON.stringify(ct.json).slice(0, 180)}`);
    const pageT = await fetch(`${server.base}/p/${ct.json.link.token}`);
    const gateT = await pageT.text();
    assert.ok(gateT.includes('Verification Required') && !gateT.includes('Zoya Khan'), 'TL report is not rendered before verification either');
    const verifyT = await call('/api/public/personal-link/verify', 'POST', { token: ct.json.link.token, personId: 'TL220', mobile: '9123456780' });
    assert.equal(verifyT.res.status, 200);
    const pageTAuth = await fetch(`${server.base}/p/${ct.json.link.token}`, { headers: { cookie: verifyT.setCookie.split(';')[0] } });
    assert.equal(pageTAuth.status, 200, 'verified TL report 200');
    const htmlT = await pageTAuth.text();
    assert.ok(htmlT.includes('Zoya Khan'), 'verified TL name appears');
    assert.ok(htmlT.includes('Welcome Back, <b>Zoya Khan</b>'), 'verified TL report greets the authenticated team leader');
    assert.ok(htmlT.includes('pl-tbl-date-matrix') && htmlT.includes('Agent Name'), 'TL report includes the agent-by-date issuance matrix');
    assert.ok(htmlT.includes('Team · agent-wise issuance'), 'TL agent-wise issuance is included');
    assert.ok(htmlT.includes('Team (is mahine)'), 'TL team performance list included');

    // ---- 🟩 GV source + restrictive sections: only server-emitted stock section, no issuance/export ----
    const cg = await call('/api/personal-links', 'POST', { source: 'gv', kind: 'agent', name: 'GV Agent One', personId: 'GV-77', mobile: '9012345678', sections: ['stock'] }, adminCookie);
    assert.equal(cg.res.status, 200, `GV link create — ${JSON.stringify(cg.json).slice(0, 180)}`);
    assert.equal(cg.json.link.source, 'gv', 'link source durable payload me GV');
    const pageG = await fetch(`${server.base}/p/${cg.json.link.token}`);
    const gateG = await pageG.text();
    assert.ok(gateG.includes('Verification Required') && !gateG.includes('GV Agent One'), 'restricted link still returns only the auth gate first');
    const verifyG = await call('/api/public/personal-link/verify', 'POST', { token: cg.json.link.token, personId: 'GV-77', mobile: '9012345678' });
    assert.equal(verifyG.res.status, 200);
    const pageGAuth = await fetch(`${server.base}/p/${cg.json.link.token}`, { headers: { cookie: verifyG.setCookie.split(';')[0] } });
    assert.equal(pageGAuth.status, 200, 'verified GV stock-only page 200');
    const htmlG = await pageGAuth.text();
    assert.ok(htmlG.includes('GV Agent One') && htmlG.includes('GV Partner'), 'GV name + source badge in verified stock section');
    assert.ok(htmlG.includes('Class-wise Stock'), 'admin-granted stock section is available');
    assert.doesNotMatch(htmlG, /MTD issued|Date-wise Issuance|Performance &amp; Growth|Stock ageing|data-pl-csv|data-pl-pdf|pl-exp-all-pdf/, 'forbidden issuance, performance, ageing, and export markup is not emitted');
    const linkList = await call('/api/personal-links', 'GET', undefined, adminCookie);
    assert.equal((linkList.json.links || []).find((l) => l.id === cg.json.link.id).source, 'gv', 'GET list source preserve karta hai');

    // ---- member ko link management chahiye hi nahi ----
    const mList = await call('/api/personal-links', 'GET', undefined, memberCookie);
    assert.ok(mList.res.status >= 400, `member personal-links list nahi dekh sakta (${mList.res.status})`);
    const me = await call('/api/auth/me', 'GET', undefined, memberCookie);
    assert.equal(me.json.settings && me.json.settings.personalLinks, undefined, 'member settings me personalLinks (tokens) nahi aate');

    // ---- revoke → 404 ----
    const del = await call(`/api/personal-links/${ca.json.link.id}`, 'DELETE', undefined, adminCookie);
    assert.equal(del.res.status, 200, 'revoke ok');
    const gone = await fetch(`${server.base}/p/${agentToken}`);
    assert.equal(gone.status, 404, `revoked link 404 (${gone.status})`);
    assert.doesNotMatch(await gone.text(), />undefined</, 'error page par literal undefined subtitle nahi');

    // ---- feature OFF → TL link bhi 404 + create 403 ----
    await call('/api/settings', 'PUT', { settings: { features: { personalLinks: false } } }, adminCookie);
    const offPage = await fetch(`${server.base}/p/${ct.json.link.token}`);
    assert.equal(offPage.status, 404, `feature off = 404 (${offPage.status})`);
    const offCreate = await call('/api/personal-links', 'POST', { kind: 'agent', name: 'Anyone' }, adminCookie);
    assert.ok(offCreate.res.status >= 400, `feature off = create blocked (${offCreate.res.status})`);
    await call('/api/settings', 'PUT', { settings: { features: { personalLinks: true } } }, adminCookie);

    // ---- 🗺 team location ----
    const loc = await call('/api/auth/location', 'POST', { latitude: 26.9124, longitude: 75.7873, accuracy: 12 }, memberCookie);
    assert.equal(loc.res.status, 200, `location save — ${JSON.stringify(loc.json).slice(0, 160)}`);
    const mLoc = await call('/api/team-location', 'GET', undefined, memberCookie);
    assert.ok(mLoc.res.status >= 400, `member team-location nahi dekh sakta (${mLoc.res.status})`);
    const aLoc = await call('/api/team-location', 'GET', undefined, adminCookie);
    assert.equal(aLoc.res.status, 200, 'admin team-location 200');
    const mePerson = (aLoc.json.people || []).find((p) => p.username === 'r3user');
    assert.ok(mePerson && Math.abs(mePerson.lat - 26.9124) < 0.001, `user ki location mili — ${JSON.stringify(mePerson)}`);

    // ---- 🏆 anomaly force: agent + TL dono alert ----
    const an = await call('/api/notifications/anomaly', 'POST', {}, adminCookie);
    assert.equal(an.res.status, 200, `anomaly force — ${JSON.stringify(an.json).slice(0, 220)}`);
    assert.equal(an.json.ok, true, `dono anomalies mile — ${JSON.stringify(an.json)}`);
    assert.ok(/Agent anomaly/.test(an.json.agent || ''), `agent title — ${an.json.agent}`);
    assert.ok(/TL anomaly/.test(an.json.tl || ''), `TL title — ${an.json.tl}`);
    const nlist = await call('/api/notifications', 'GET', undefined, adminCookie);
    const titles = (nlist.json.items || []).map((i) => i.title);
    assert.ok(titles.some((t) => /Agent anomaly/.test(t)), `notifications me agent anomaly — ${titles.slice(0, 6).join(' | ')}`);
    assert.ok(titles.some((t) => /TL anomaly/.test(t)), 'notifications me TL anomaly');
    // sirf TL ON ho to sirf TL
    await call('/api/settings', 'PUT', { settings: { features: { alerts: { anomaly: false }, tlAnomaly: true } } }, adminCookie);
    const onlyTl = await call('/api/notifications/anomaly', 'POST', {}, adminCookie);
    assert.equal(onlyTl.json.ok, true, 'tlAnomaly ON = TL alert still works');
    assert.equal(onlyTl.json.agent, null, 'alerts.anomaly OFF = agent alert nahi');
    assert.ok(/TL anomaly/.test(onlyTl.json.tl || ''), 'TL alert aa raha hai');
    await call('/api/settings', 'PUT', { settings: { features: { alerts: { anomaly: true }, tlAnomaly: false } } }, adminCookie);

    // ---- 🔁 round-3 flags persist ----
    const flags = await call('/api/settings', 'PUT', { settings: { features: { badges: false, voiceSummary: false, askBox: false, teamMap: false } } }, adminCookie);
    const ff = (flags.json.settings || {}).features || {};
    assert.equal(ff.badges, false, 'badges OFF save');
    assert.equal(ff.voiceSummary, false, 'voiceSummary OFF save');
    assert.equal(ff.askBox, false, 'askBox OFF save');
    assert.equal(ff.teamMap, false, 'teamMap OFF save');
    await call('/api/settings', 'PUT', { settings: { features: { badges: true, voiceSummary: true, askBox: true, teamMap: true, tlAnomaly: true } } }, adminCookie);

    // ---- 📜 audit me link + anomaly entries ----
    const audit = await call('/api/audit', 'GET', undefined, adminCookie);
    const acts = (audit.json.entries || []).map((e) => e.action);
    for (const need of ['link_create', 'link_revoke', 'agent_anomaly', 'tl_anomaly']) {
      assert.ok(acts.includes(need), `audit me ${need} — ${acts.join(',')}`);
    }
  } finally {
    if (server) await server.stop();
    await new Promise((r) => upstream.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// Round 4: 🗓 custom alert scheduler · 🥇 champion certificate email · ⏰ follow-up tracker
//          · 🚗 4-way feature flags (dispatchPlan / suggestDays …)
// ---------------------------------------------------------------------------------------------
test('🗓 scheduler force-fire, 🥇 champion email (SMTP), ⏰ follow-up list+alert, round-4 flags', async () => {
  const smtp = await startSmtp();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-feat-r4-'));
  const pad = (n) => String(n).padStart(2, '0');
  const dcell = (d) => `Date(${d.getFullYear()},${d.getMonth()},${d.getDate()})`;
  const dayBack = (i) => new Date(Date.now() - i * 86400e3);
  const pm = new Date(); pm.setMonth(pm.getMonth() - 1);
  // 🥇 champions: prev-month rows (pinned to actual previous month, month-start safe)
  // ⏰ follow-up: Silent Sam (8 din silent · window me), Fresh Fiza (aaj), Old Ollie (40 din = bahar)
  const chRows = [];
  for (let d = 1; d <= 6; d++) chRows.push({ c: [{ v: 'Virat Kohli' }, { v: dcell(new Date(pm.getFullYear(), pm.getMonth(), d)) }, { v: 100 }] });
  for (let d = 1; d <= 3; d++) chRows.push({ c: [{ v: 'Rohit Sharma' }, { v: dcell(new Date(pm.getFullYear(), pm.getMonth(), d)) }, { v: 50 }] });
  chRows.push({ c: [{ v: 'Silent Sam' }, { v: dcell(dayBack(8)) }, { v: 12 }] });
  chRows.push({ c: [{ v: 'Silent Sam' }, { v: dcell(dayBack(20)) }, { v: 9 }] });
  chRows.push({ c: [{ v: 'Fresh Fiza' }, { v: dcell(dayBack(0)) }, { v: 7 }] });
  chRows.push({ c: [{ v: 'Old Ollie' }, { v: dcell(dayBack(40)) }, { v: 5 }] });
  const upstream = http.createServer((req, res) => {
    const tq = new URL(req.url, 'http://x').searchParams.get('tq') || '';
    let rows = [];
    if (/group by L, AA/.test(tq) && !/where BA/.test(tq)) rows = chRows; // champion + follow-up query
    res.end(`google.visualization.Query.setResponse(${JSON.stringify({ status: 'ok', table: { cols: [{ id: 'A', type: 'string' }, { id: 'AA', type: 'date' }, { id: 'B', type: 'number' }], rows } })});`);
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
    await call('/api/users', 'POST', { username: 'r4user', name: 'R4 User', password: 'r4-pass-1', role: 'user' }, adminCookie);
    const memberCookie = (await call('/api/auth/login', 'POST', { username: 'r4user', password: 'r4-pass-1' })).setCookie.split(';')[0];

    // ---- 🚗 round-4 flags: defaults + admin round-trip ----
    const def = await call('/api/settings', 'GET', undefined, adminCookie);
    assert.equal(def.json.defaults.features.suggestDays, 15, 'default suggestDays=15');
    assert.equal(def.json.defaults.features.dispatchPlan, true, 'default dispatchPlan ON');
    assert.equal(def.json.defaults.features.championEmail, false, 'default championEmail OFF (auto band)');
    assert.equal(def.json.defaults.notificationRoutes.lowStock, 'admin', 'low stock default → admin');
    assert.equal(def.json.defaults.notificationRoutes.champion, 'both', 'champion default → admin + users');
    assert.deepEqual(new Set(Object.values(def.json.defaults.notificationRoutes)), new Set(['admin', 'both']), 'default routes only valid audience values');
    const fput = await call('/api/settings', 'PUT', { settings: { features: { customAlerts: true, championEmail: false, followupTracker: true, dispatchPlan: true, championHour: 10, championTop: 3, followupDays: 5, followupHour: 10, suggestDays: 20 } } }, adminCookie);
    assert.equal(fput.res.status, 200, 'flags PUT 200');
    const ff = fput.json.settings.features;
    for (const [k, v] of Object.entries({ customAlerts: true, championEmail: false, followupTracker: true, dispatchPlan: true, championHour: 10, championTop: 3, followupDays: 5, followupHour: 10, suggestDays: 20 })) {
      assert.equal(ff[k], v, `features.${k} round-trip = ${v} (got ${ff[k]})`);
    }

    // ---- 🥇 champion force = 403 jab tak feature ON nahi ----
    const champOff = await call('/api/notifications/champion-email', 'POST', {}, adminCookie);
    assert.equal(champOff.res.status, 403, `champion OFF = 403 (got ${champOff.res.status})`);

    // ---- 🗓 schedule create + force fire → notification + audit ----
    const sput = await call('/api/settings', 'PUT', { schedules: [{ id: 's4', title: 'Subah check-in', text: 'Aaj {date} · today {today} · mtd {mtd}', kind: 'daily', hour: 9, target: 'broadcast', enabled: true, type: 'info' }] }, adminCookie);
    assert.equal(sput.res.status, 200, `schedule save — ${JSON.stringify(sput.json).slice(0, 160)}`);
    assert.equal((sput.json.settings.schedules || []).length, 1, 'schedule saved');
    const admSet = (await call('/api/settings', 'GET', undefined, adminCookie)).json.settings;
    assert.equal((admSet.schedules || []).length, 1, 'admin GET me schedules');
    const memSet = (await call('/api/settings', 'GET', undefined, memberCookie)).json.settings;
    assert.equal(memSet.schedules, undefined, 'member ko schedules nahi dikhte');
    const memFire = await call('/api/schedules/s4/fire', 'POST', {}, memberCookie);
    assert.ok(memFire.res.status >= 400, `member schedule fire blocked (${memFire.res.status})`);
    const fire = await call('/api/schedules/s4/fire', 'POST', {}, adminCookie);
    assert.equal(fire.res.status, 200, `force fire — ${JSON.stringify(fire.json).slice(0, 200)}`);
    assert.equal(fire.json.ok, true, 'schedule fired');
    assert.match(fire.json.item.title, /^🗓 Subah check-in/, `notification title — ${fire.json.item.title}`);
    assert.match(fire.json.item.body, /\d{4}-\d{2}-\d{2}/, '{date} token render hua');
    assert.match(fire.json.item.body, /today \d+/, '{today} token render hua');
    const nlist = await call('/api/notifications', 'GET', undefined, adminCookie);
    assert.ok((nlist.json.items || []).some((i) => /Subah check-in/.test(i.title)), 'notifications me schedule entry');
    // feature OFF → fire 403, wapas ON
    await call('/api/settings', 'PUT', { settings: { features: { customAlerts: false } } }, adminCookie);
    const fireOff = await call('/api/schedules/s4/fire', 'POST', {}, adminCookie);
    assert.equal(fireOff.res.status, 403, `customAlerts OFF = 403 (${fireOff.res.status})`);
    await call('/api/settings', 'PUT', { settings: { features: { customAlerts: true } } }, adminCookie);
    const fire404 = await call('/api/schedules/nope/fire', 'POST', {}, adminCookie);
    assert.equal(fire404.res.status, 404, 'unknown schedule 404');

    // ---- 🥇 champion email: SMTP configure + force → mail + audit ----
    const esave = await call('/api/settings', 'PUT', { settings: { email: { host: '127.0.0.1', port: smtp.port, secure: false, user: 'mailer', pass: 'secret-1', from: 'alerts@example.test', to: 'boss@example.test' } } }, adminCookie);
    assert.equal(esave.res.status, 200, 'email settings save');
    await call('/api/settings', 'PUT', { settings: { features: { championEmail: true } } }, adminCookie);
    const champ = await call('/api/notifications/champion-email', 'POST', {}, adminCookie);
    assert.equal(champ.res.status, 200, `champion force — ${JSON.stringify(champ.json).slice(0, 240)}`);
    assert.equal(champ.json.ok, true, 'champion mail bheja');
    assert.match(champ.json.month || '', /^\d{4}-\d{2}$/, `prev month — ${champ.json.month}`);
    assert.ok(champ.json.top.some((t) => t.startsWith('Virat Kohli:')), `Virat top par — ${champ.json.top.join(', ')}`);
    assert.ok(champ.json.top.some((t) => t.startsWith('Rohit Sharma:')), `Rohit list me — ${champ.json.top.join(', ')}`);
    await new Promise((r) => setTimeout(r, 250));
    assert.ok(smtp.inbox.includes('Subject: =?UTF-8?B?'), 'DATA me encoded subject');
    const subjB64 = (smtp.inbox.match(/Subject: =\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/) || [])[1] || '';
    assert.match(Buffer.from(subjB64, 'base64').toString('utf8'), /Champions/i, 'subject me "Champions"');
    const bodyB64 = (smtp.inbox.split(/\r?\n\r?\n/) || []).slice(1).join('').replace(/\r?\n/g, '').replace(/\.$/, '');
    const html = Buffer.from(bodyB64, 'base64').toString('utf8');
    assert.match(html, /Hall of Fame/, 'certificate HTML body');
    assert.match(html, /Virat Kohli/, 'certificate me champion naam');
    const memberChampionFeed = await call('/api/notifications', 'GET', undefined, memberCookie);
    const championItem = (memberChampionFeed.json.items || []).find((i) => i.routeKey === 'champion');
    assert.ok(championItem, 'champion ka routed in-app notification member ko mila');
    assert.equal(championItem.audience, 'both', 'champion audience = both');
    const audit = await call('/api/audit', 'GET', undefined, adminCookie);
    const acts = (audit.json.entries || []).map((e) => e.action);
    for (const need of ['schedule_fired', 'champion_email_sent']) assert.ok(acts.includes(need), `audit me ${need} — ${acts.join(',')}`);

    // ---- ⏰ follow-up: list (silent agents) + ?fire=1 notification ----
    const fu = await call('/api/followup', 'GET', undefined, adminCookie);
    assert.equal(fu.res.status, 200, `followup list — ${JSON.stringify(fu.json).slice(0, 200)}`);
    assert.equal(fu.json.days, 5, 'followupDays=5 apply hua');
    const names = (fu.json.list || []).map((x) => x.name);
    assert.ok(names.includes('Silent Sam'), `Sam silent — ${names.join(', ')}`);
    assert.ok(!names.includes('Fresh Fiza'), 'Fiza aaj active = silent nahi');
    assert.ok(!names.includes('Old Ollie'), 'Ollie 40 din purana = 30-din window se bahar');
    const sam = (fu.json.list || []).find((x) => x.name === 'Silent Sam');
    assert.ok(sam.days >= 5, `Sam ka days count — ${sam.days}`);
    const memFu = await call('/api/followup', 'GET', undefined, memberCookie);
    assert.ok(memFu.res.status >= 400, `member followup nahi dekh sakta (${memFu.res.status})`);
    const fuFire = await call('/api/followup?fire=1', 'GET', undefined, adminCookie);
    assert.equal(fuFire.res.status, 200, 'followup fire 200');
    assert.equal(fuFire.json.fired, true, 'notification fired');
    const nlist2 = await call('/api/notifications', 'GET', undefined, adminCookie);
    const fuItem = (nlist2.json.items || []).find((i) => /Follow-up · \d+ agent/.test(i.title));
    assert.ok(fuItem, `follow-up notification — ${(nlist2.json.items || []).map((i) => i.title).slice(0, 6).join(' | ')}`);
    assert.equal(fuItem.meta && fuItem.meta.link, '#/performance?view=alerts', 'notification meta.link alerts view par');
    assert.equal(fuItem.audience, 'both', 'default follow-up admin + users dono ko');

    // ---- 🔔 route matrix: users-only admin feed/push visibility ko bypass nahi kar sakta ----
    const routeUsers = await call('/api/settings', 'PUT', { settings: { notificationRoutes: { followup: 'users', champion: 'not-valid', unknownEvent: 'both' } } }, adminCookie);
    assert.equal(routeUsers.res.status, 200, 'notification route settings save');
    assert.equal(routeUsers.json.settings.notificationRoutes.followup, 'users', 'follow-up → users-only round-trip');
    assert.equal(routeUsers.json.settings.notificationRoutes.champion, 'both', 'invalid champion route ignored / normalized');
    assert.equal(routeUsers.json.settings.notificationRoutes.unknownEvent, undefined, 'unknown event key server ne drop ki');
    const memberBefore = new Set(((await call('/api/notifications', 'GET', undefined, memberCookie)).json.items || []).map((i) => i.id));
    const usersFire = await call('/api/followup?fire=1', 'GET', undefined, adminCookie);
    assert.equal(usersFire.json.fired, true, 'users-only routed follow-up create hua');
    const memberAfter = ((await call('/api/notifications', 'GET', undefined, memberCookie)).json.items || []);
    const userOnlyItem = memberAfter.find((i) => !memberBefore.has(i.id) && i.routeKey === 'followup');
    assert.ok(userOnlyItem, 'users-only follow-up member feed me visible');
    assert.equal(userOnlyItem.audience, 'users', 'stored audience users');
    const adminAfterUsers = ((await call('/api/notifications', 'GET', undefined, adminCookie)).json.items || []);
    assert.ok(!adminAfterUsers.some((i) => i.id === userOnlyItem.id), 'users-only item admin feed me leak nahi hua');
    await call('/api/settings', 'PUT', { settings: { notificationRoutes: { followup: 'off' } } }, adminCookie);
    const offFire = await call('/api/followup?fire=1', 'GET', undefined, adminCookie);
    assert.equal(offFire.json.fired, false, 'off route notification create nahi karta');
    await call('/api/settings', 'PUT', { settings: { notificationRoutes: { followup: 'both' } } }, adminCookie);

    const audit2 = await call('/api/audit', 'GET', undefined, adminCookie);
    assert.ok((audit2.json.entries || []).map((e) => e.action).includes('followup_alert'), `audit me followup_alert — ${(audit2.json.entries || []).map((e) => e.action).slice(0, 8).join(',')}`);
    // feature OFF → ?fire=1 blocked
    await call('/api/settings', 'PUT', { settings: { features: { followupTracker: false } } }, adminCookie);
    const fuOff = await call('/api/followup?fire=1', 'GET', undefined, adminCookie);
    assert.equal(fuOff.res.status, 403, `followup OFF = 403 (${fuOff.res.status})`);
    const fuListStill = await call('/api/followup', 'GET', undefined, adminCookie);
    assert.equal(fuListStill.res.status, 200, 'list (read-only) feature OFF par bhi chalti hai');
    await call('/api/settings', 'PUT', { settings: { features: { followupTracker: true, followupDays: 3, championTop: 3, suggestDays: 15 } } }, adminCookie);
    const fin = (await call('/api/settings', 'GET', undefined, adminCookie)).json.settings.features;
    assert.equal(fin.dispatchPlan, true, 'dispatchPlan persist');
    assert.equal(fin.suggestDays, 15, 'suggestDays wapas default par');
  } finally {
    if (server) await server.stop();
    await new Promise((r) => upstream.close(r));
    await new Promise((r) => smtp.srv.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
