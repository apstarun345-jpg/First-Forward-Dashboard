/* 📧 mailer.js — SMTP client (STARTTLS / AUTH PLAIN / last-capability-line bug), provider fallback,
   Apps Script relay, Resend + Brevo HTTPS APIs and diagnostics. No network: everything is local mocks. */
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMockAppsScript } from './mock-apps-script.js';
import { smtpSend, sendMail, resolveProviders, availableProviders, mailConfigured, resetMailMemo, diagnoseMail, normalizePassword, mailHint } from '../mailer.js';

process.env.APPS_SCRIPT_ALLOW_LOCAL = '1';

function selfSigned() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmail-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '2', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  return { key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) };
}

/** SMTP mock that speaks STARTTLS. `caps` = EHLO reply lines; the LAST one has no dash (like real servers). */
function startStarttlsSmtp({ authMech = 'PLAIN' } = {}) {
  const { key, cert } = selfSigned();
  const state = { inbox: '', auth: '', sawAuthBeforeTls: false, tlsUp: false };
  const handle = (sock, secure) => {
    let buf = '', inData = false, authStage = 0;
    if (!secure) sock.write('220 mock-starttls ready\r\n');
    sock.on('data', (d) => {
      const s = d.toString('utf8');
      if (inData) { state.inbox += s; if (/\r?\n\.\r?\n/.test(s)) { inData = false; sock.write('250 queued\r\n'); } return; }
      buf += s; let i;
      while ((i = buf.search(/\r?\n/)) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + (buf[i] === '\r' ? 2 : 1));
        if (!line) continue; const cmd = line.toUpperCase();
        if (cmd.startsWith('EHLO')) {
          // plain: STARTTLS is the LAST capability line (regression: it used to be ignored → AUTH over plain text)
          if (!secure) sock.write('250-mock\r\n250-SIZE 100000\r\n250 STARTTLS\r\n');
          else sock.write(`250-mock\r\n250 AUTH ${authMech}\r\n`);
        } else if (cmd === 'STARTTLS') {
          sock.write('220 go ahead\r\n');
          sock.removeAllListeners('data');
          const t = new tls.TLSSocket(sock, { isServer: true, key, cert });
          state.tlsUp = true; handle(t, true);
          return;
        } else if (cmd.startsWith('AUTH')) {
          if (!secure) { state.sawAuthBeforeTls = true; sock.write('530 Must issue a STARTTLS command first\r\n'); continue; }
          if (cmd.startsWith('AUTH PLAIN ')) { state.auth = Buffer.from(line.split(' ')[2], 'base64').toString('utf8'); sock.write('235 ok\r\n'); }
          else if (cmd === 'AUTH LOGIN') { authStage = 1; sock.write('334 VXNlcm5hbWU6\r\n'); }
          else sock.write('504 no\r\n');
        } else if (authStage === 1) { authStage = 2; state.auth = Buffer.from(line, 'base64').toString(); sock.write('334 UGFzc3dvcmQ6\r\n'); }
        else if (authStage === 2) { authStage = 0; state.auth += '|' + Buffer.from(line, 'base64').toString(); sock.write('235 ok\r\n'); }
        else if (cmd.startsWith('MAIL FROM') || cmd.startsWith('RCPT TO')) sock.write('250 ok\r\n');
        else if (cmd === 'DATA') { inData = true; sock.write('354 go\r\n'); }
        else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 ok\r\n');
      }
    });
    sock.on('error', () => {});
  };
  const srv = net.createServer((sock) => handle(sock, false));
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port, state })));
}
const closed = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const base = (extra) => ({ from: 'Dash <alerts@example.test>', to: 'boss@example.test', ...extra });

test('smtpSend — STARTTLS jab "250 STARTTLS" LAST capability line ho + AUTH PLAIN only server', async () => {
  const smtp = await startStarttlsSmtp({ authMech: 'PLAIN' });
  try {
    await smtpSend(base({ host: '127.0.0.1', port: smtp.port, user: 'mailer', pass: 'pw-1' }), 'Hello ✅', 'body text');
    assert.equal(smtp.state.sawAuthBeforeTls, false, 'AUTH plain socket par nahi bhejni chahiye (STARTTLS pehle)');
    assert.equal(smtp.state.tlsUp, true, 'STARTTLS upgrade hua');
    assert.equal(smtp.state.auth, '\0mailer\0pw-1', 'AUTH PLAIN credentials sahi');
    assert.match(smtp.state.inbox, /Subject: =\?UTF-8\?B\?/);
  } finally { smtp.srv.close(); }
});

test('smtpSend — AUTH LOGIN over STARTTLS + Gmail app password ke spaces hat jaate hain', async () => {
  const smtp = await startStarttlsSmtp({ authMech: 'LOGIN PLAIN' });
  try {
    await smtpSend(base({ host: '127.0.0.1', port: smtp.port, user: 'me@gmail.com', pass: 'abcd efgh ijkl mnop' }), 's', 'b');
    assert.equal(smtp.state.auth, 'me@gmail.com|abcd efgh ijkl mnop'.replace('abcd efgh ijkl mnop', 'abcd efgh ijkl mnop'), 'non-gmail host par password jaisa hai waisa (127.0.0.1)');
  } finally { smtp.srv.close(); }
  assert.equal(normalizePassword('smtp.gmail.com', 'abcd efgh ijkl mnop'), 'abcdefghijklmnop');
  assert.equal(normalizePassword('smtp.office365.com', 'a b'), 'a b');
});

test('smtpSend — band port par jaldi SMTP_CONNECT error (blocked-port jaisa), code set', async () => {
  const port = await closed();
  await assert.rejects(() => smtpSend(base({ host: '127.0.0.1', port }), 's', 'b'), (e) => e.code === 'SMTP_CONNECT' && /SMTP/.test(e.message));
});

test('sendMail auto — SMTP fail → Apps Script relay se mail nikalti hai (+ block memo)', async () => {
  resetMailMemo();
  const as = await startMockAppsScript({ secret: 'x'.repeat(20) });
  const port = await closed();
  const env = { APPS_SCRIPT_URL: as.url, APPS_SCRIPT_SECRET: 'x'.repeat(20) };
  try {
    const cfg = base({ host: '127.0.0.1', port, to: 'boss@example.test, team@example.test' });
    assert.deepEqual(resolveProviders(cfg, env), ['smtp', 'appsscript']);
    const out = await sendMail(cfg, 'Digest', 'plain body', { html: '<b>hi</b>', attachments: [{ name: 'r.csv', content: 'a,b\n1,2' }] }, env);
    assert.equal(out.provider, 'appsscript');
    assert.deepEqual(out.tried, ['smtp', 'appsscript']);
    assert.equal(as.mails.length, 1);
    assert.equal(as.mails[0].to, 'boss@example.test,team@example.test');
    assert.equal(as.mails[0].name, 'Dash');
    assert.equal(as.mails[0].htmlBody, '<b>hi</b>');
    assert.equal(Buffer.from(as.mails[0].attachments[0].content, 'base64').toString(), 'a,b\n1,2');
    // SMTP unreachable yaad rakha → ab HTTPS pehle
    assert.deepEqual(resolveProviders(cfg, env), ['appsscript', 'smtp']);
    resetMailMemo();
    assert.deepEqual(resolveProviders(cfg, env), ['smtp', 'appsscript']);
  } finally { await as.close(); resetMailMemo(); }
});

test('sendMail — explicit provider fallback nahi karta; configured na ho to saaf error', async () => {
  const cfg = base({ provider: 'resend' });
  await assert.rejects(() => sendMail(cfg, 's', 'b', {}, {}), /provider “resend” configured nahi/);
  await assert.rejects(() => sendMail(base({}), 's', 'b', {}, {}), /Email set nahi hai/);
  assert.equal(mailConfigured(base({}), {}), false);
  assert.equal(mailConfigured(base({ host: 'smtp.x.test' }), {}), true);
  // env-only Apps Script relay tab tak "configured" nahi jab tak admin ne To na bhara ho
  const env = { APPS_SCRIPT_URL: 'https://script.google.com/macros/s/abc/exec', APPS_SCRIPT_SECRET: 'y'.repeat(20) };
  assert.equal(mailConfigured({ provider: 'auto', to: '' }, env), false);
  assert.equal(mailConfigured({ provider: 'auto', to: 'a@b.co' }, env), true);
  assert.equal(mailConfigured({ provider: 'appsscript', to: '' }, env), true);
});

test('Resend + Brevo HTTPS APIs — sahi endpoint, headers aur body', async () => {
  const realFetch = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify({ id: 'ok' }), { status: 200 }); };
  try {
    const r = await sendMail(base({ provider: 'resend', resendKey: 're_key' }), 'Sub', 'Body', { html: '<i>x</i>', attachments: [{ name: 'a.csv', content: 'q' }] }, {});
    assert.equal(r.provider, 'resend');
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer re_key');
    const rb = JSON.parse(calls[0].init.body);
    assert.deepEqual(rb.to, ['boss@example.test']); assert.equal(rb.from, 'Dash <alerts@example.test>'); assert.equal(rb.attachments[0].filename, 'a.csv');
    const b = await sendMail(base({ provider: 'brevo' }), 'Sub', 'Body', {}, { BREVO_API_KEY: 'xkeysib-1' });
    assert.equal(b.provider, 'brevo');
    assert.equal(calls[1].url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(calls[1].init.headers['api-key'], 'xkeysib-1');
    const bb = JSON.parse(calls[1].init.body);
    assert.deepEqual(bb.sender, { email: 'alerts@example.test', name: 'Dash' }); assert.deepEqual(bb.to, [{ email: 'boss@example.test' }]);
    // provider ka error saaf dikhe
    globalThis.fetch = async () => new Response('{"message":"API key is invalid"}', { status: 401 });
    await assert.rejects(() => sendMail(base({ provider: 'resend', resendKey: 'bad' }), 's', 'b', {}, {}), /Resend HTTP 401/);
  } finally { globalThis.fetch = realFetch; }
});

test('diagnoseMail — band SMTP port + HTTPS relay ready par sahi salah', async () => {
  resetMailMemo();
  const as = await startMockAppsScript({ secret: 'z'.repeat(20) });
  const port = await closed();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).startsWith('https://script.google.com') ? new Response('', { status: 200 }) : realFetch(url, init));
  try {
    const d = await diagnoseMail(base({ host: '127.0.0.1', port }), { APPS_SCRIPT_URL: as.url, APPS_SCRIPT_SECRET: 'z'.repeat(20) });
    assert.equal(d.providers.smtp, true); assert.equal(d.providers.appsscript, true);
    assert.ok(d.checks.some((c) => /TCP 127\.0\.0\.1/.test(c.name) && c.ok === false), 'band port fail dikhe');
    assert.ok(d.checks.some((c) => /Apps Script mail relay/.test(c.name) && c.ok === true && /quota/.test(c.detail)));
    assert.ok(d.advice.some((t) => /SMTP ports/i.test(t)), 'Render block wali advice');
  } finally { globalThis.fetch = realFetch; await as.close(); }
  assert.match(mailHint('SMTP connect timeout — x'), /Render FREE/);
  assert.match(mailHint('535 5.7.8 Username and Password not accepted'), /App password|App Password|App passwords/i);
});
