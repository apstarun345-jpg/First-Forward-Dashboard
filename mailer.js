// 📧 Mail transport for the dashboard (OTP login codes, daily/weekly digest, champion certificates, test mail).
//
// Why this file exists: many hosts — Render free web services since 26 Sep 2025 — BLOCK outbound SMTP
// ports 25 / 465 / 587 at the firewall, so plain SMTP just "times out" there. The dashboard therefore
// supports four transports and (in "auto" mode) falls back from one to the next:
//   smtp        — classic SMTP (host/port/user/pass in Settings). Needs the SMTP port to be open.
//   appsscript  — Gmail through the SAME Google Apps Script web app already used for storage
//                 (APPS_SCRIPT_URL + APPS_SCRIPT_SECRET). HTTPS only → works everywhere, free.
//   resend      — Resend HTTPS API (RESEND_API_KEY or Settings → Resend key).
//   brevo       — Brevo (ex-Sendinblue) HTTPS API (BREVO_API_KEY or Settings → Brevo key).
// No new dependency: SMTP is a tiny hand-written client, the others use global fetch().
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns/promises';
import { AppsScriptStore } from './apps-script-storage.js';

export const MAIL_PROVIDERS = ['auto', 'smtp', 'appsscript', 'resend', 'brevo'];
const CONNECT_TIMEOUT_MS = 8000;   // TCP connect — a blocked port never answers, so fail fast
const IO_TIMEOUT_MS = 20000;       // whole SMTP dialogue
const BLOCK_MEMO_MS = 10 * 60e3;   // remember "SMTP port is unreachable" for 10 min in auto mode
let smtpBlockedUntil = 0;

const EMAIL_RE = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
export const mailbox = (raw) => {
  const clean = String(raw || '').replace(/[\r\n]/g, '').trim();
  const angled = clean.match(/<([^<>]+)>/);
  return (angled ? angled[1] : clean).trim();
};
const displayName = (raw) => {
  const m = String(raw || '').replace(/[\r\n]/g, '').match(/^\s*"?([^"<]*?)"?\s*<[^<>]+>\s*$/);
  return m ? m[1].trim() : '';
};
export const splitRecipients = (to) => String(to || '').split(/[,;]/).map(mailbox).filter(Boolean);

/** Gmail app passwords are shown as "abcd efgh ijkl mnop" — the spaces are not part of the password. */
export const normalizePassword = (host, pass) => (/gmail|googlemail|google\.com/i.test(String(host || '')) ? String(pass || '').replace(/\s+/g, '') : String(pass || ''));

function smtpError(message, code) { const e = new Error(message); e.code = code || 'SMTP'; return e; }

/**
 * Minimal SMTP client: EHLO → optional STARTTLS → AUTH (LOGIN / PLAIN) → RCPT → DATA.
 * cfg = { host, port, secure, user, pass, from, to }. Self-signed certs are accepted (internal relays).
 */
export function smtpSend(cfg, subject, text, opts = {}) {
  return new Promise((resolve, reject) => {
    const host = String(cfg.host || '').trim();
    const port = Number(cfg.port) || 587;
    const directTls = cfg.secure === true || port === 465;
    const fromHeader = String(cfg.from || cfg.user || '').trim();
    const from = mailbox(fromHeader);
    const toList = splitRecipients(cfg.to);
    const user = String(cfg.user || '').trim();
    const pass = normalizePassword(host, cfg.pass);
    if (!host) return reject(smtpError('SMTP host set nahi hai', 'CONFIG'));
    if (!from) return reject(smtpError('"From" address set nahi hai', 'CONFIG'));
    if (!toList.length) return reject(smtpError('"To" address set nahi hai', 'CONFIG'));
    if (!/^[^\s<>@]+@[^\s<>@]+$/.test(from)) return reject(smtpError('"From" email valid nahi hai', 'CONFIG'));
    if (toList.some((x) => !/^[^\s<>@]+@[^\s<>@]+$/.test(x))) return reject(smtpError('"To" me ek email valid nahi hai', 'CONFIG'));
    let sock = null, buf = '', step = 0, caps = '', done = false, rcptIdx = 0, stage = 'connect';
    const timer = setTimeout(() => fail(stage === 'connect'
      ? `SMTP connect timeout — ${host}:${port} se koi jawab nahi (port block ho sakta hai)`
      : `SMTP timeout (${IO_TIMEOUT_MS / 1000}s) — stage: ${stage}`, stage === 'connect' ? 'SMTP_CONNECT' : 'SMTP_TIMEOUT'), IO_TIMEOUT_MS);
    const connectTimer = setTimeout(() => { if (stage === 'connect') fail(`SMTP connect timeout — ${host}:${port} se ${CONNECT_TIMEOUT_MS / 1000}s me koi jawab nahi (port block ho sakta hai)`, 'SMTP_CONNECT'); }, CONNECT_TIMEOUT_MS);
    const cleanup = () => { clearTimeout(timer); clearTimeout(connectTimer); };
    const fail = (m, code) => { if (done) return; done = true; cleanup(); try { sock && sock.destroy(); } catch { /* ignore */ } reject(smtpError(m, code)); };
    const win = () => { if (done) return; done = true; cleanup(); try { sock && sock.end(); } catch { /* ignore */ } resolve(true); };
    const w = (l) => sock.write(l + '\r\n');
    const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
    function bind(s) {
      sock = s;
      s.on('error', (e) => fail(`SMTP: ${e.message || e}`, /ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/.test(String(e && (e.code || e.message))) && stage === 'connect' ? 'SMTP_CONNECT' : 'SMTP'));
      s.on('data', onData);
    }
    function onData(chunk) {
      // Raw bytes → text ourselves (never socket.setEncoding: it would corrupt the STARTTLS upgrade).
      buf += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      let i;
      while (!done && (i = buf.search(/\r?\n/)) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + (buf[i] === '\r' ? 2 : 1));
        if (!line) continue;
        const code = Number(line.slice(0, 3));
        if (/^\d{3}-/.test(line)) { caps += line + '\n'; continue; } // multiline 250- capability lines
        if (code >= 400) return fail(`SMTP error: ${line}`, 'SMTP_REJECT');
        handle(line, code);
      }
    }
    function afterEhlo() {
      if (!user) { stage = 'envelope'; step = 6; return w(`MAIL FROM:<${from}>`); }
      stage = 'auth';
      const authLine = (caps.match(/^\d{3}[- ]AUTH[ =](.*)$/im) || [])[1] || '';
      if (authLine && !/\bLOGIN\b/i.test(authLine) && /\bPLAIN\b/i.test(authLine)) { step = 53; return w(`AUTH PLAIN ${b64(`\0${user}\0${pass}`)}`); }
      step = 5; return w('AUTH LOGIN');
    }
    function handle(line, code) {
      if (step === 0) { stage = 'ehlo'; step = 1; return w('EHLO localhost'); }
      if (step === 1) { // first EHLO answer (plain). The LAST capability line has no dash — keep it too.
        caps += line + '\n';
        if (!directTls && /^\d{3}[- ]STARTTLS\b/im.test(caps)) { stage = 'starttls'; step = 2; return w('STARTTLS'); }
        return afterEhlo();
      }
      if (step === 2) { // 220 ready to start TLS → wrap this socket
        const plain = sock;
        plain.removeAllListeners('data'); plain.removeAllListeners('error'); plain.removeAllListeners('timeout');
        plain.on('error', () => {});
        const s2 = tls.connect({ socket: plain, servername: host, rejectUnauthorized: false }, () => {
          caps = ''; step = 3; stage = 'ehlo'; bind(s2); w('EHLO localhost');
        });
        s2.on('error', (e) => fail(`TLS: ${e.message || e}`, 'SMTP_TLS'));
        return;
      }
      if (step === 3) { caps += line + '\n'; return afterEhlo(); } // EHLO again after TLS
      if (step === 5) { step = 51; return w(b64(user)); }        // 334 username
      if (step === 51) { step = 52; return w(b64(pass)); }       // 334 password
      if (step === 52 || step === 53) { stage = 'envelope'; step = 6; return w(`MAIL FROM:<${from}>`); } // 235 auth ok
      if (step === 6) { step = 7; return w(`RCPT TO:<${toList[rcptIdx]}>`); }
      if (step === 7) {
        rcptIdx++;
        if (rcptIdx < toList.length) return w(`RCPT TO:<${toList[rcptIdx]}>`);
        step = 8; return w('DATA');
      }
      if (step === 8) {
        step = 9; stage = 'data';
        const b64w = (s) => Buffer.from(String(s), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
        const safeFromHeader = fromHeader.replace(/[\r\n]/g, '') || from;
        const subjHdr = `From: ${safeFromHeader}\r\nTo: ${toList.join(', ')}\r\nSubject: =?UTF-8?B?${b64(subject)}?=\r\nMIME-Version: 1.0\r\nDate: ${new Date().toUTCString()}\r\n`;
        let mime;
        if (opts.attachments && opts.attachments.length) {
          const boundary = `ff-b-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
          const chunks = [`--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64w(text)}`];
          for (const a of opts.attachments) {
            const nm = String(a.name || 'report.csv').replace(/"/g, '');
            chunks.push(`--${boundary}\r\nContent-Type: text/csv; name="${nm}"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${nm}"\r\n\r\n${b64w(a.content)}`);
          }
          chunks.push(`--${boundary}--\r\n`);
          mime = `${subjHdr}Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n${chunks.join('\r\n')}`;
        } else if (opts.html) {
          mime = `${subjHdr}Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64w(opts.html)}`;
        } else {
          mime = `${subjHdr}Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64w(text)}`;
        }
        // DATA terminator: last body line ke baad alag line par "." (warna server kabhi 250 nahi bhejta)
        return w(`${mime.replace(/\r?\n+$/, '')}\r\n.\r\n`);
      }
      if (step === 9) { w('QUIT'); return win(); }
      void code;
    }
    const conn = directTls
      ? tls.connect({ host, port, servername: host, rejectUnauthorized: false }, () => { stage = 'greeting'; clearTimeout(connectTimer); })
      : net.connect({ host, port }, () => { stage = 'greeting'; clearTimeout(connectTimer); });
    bind(conn);
  });
}

// ---------------------------------------------------------------- HTTPS providers
const withTimeout = async (url, init, ms = 20000) => {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  catch (err) { throw err && err.name === 'AbortError' ? new Error(`timeout (${ms / 1000}s)`) : err; }
  finally { clearTimeout(t); }
};
const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
const attachmentsOf = (opts) => (opts.attachments || []).map((a) => ({ name: String(a.name || 'report.csv').replace(/"/g, ''), content: b64(a.content), type: a.type || 'text/csv' }));

async function sendResend(key, msg) {
  const res = await withTimeout('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: msg.fromHeader, to: msg.to, subject: msg.subject, text: msg.text, ...(msg.html ? { html: msg.html } : {}), ...(msg.attachments.length ? { attachments: msg.attachments.map((a) => ({ filename: a.name, content: a.content })) } : {}) })
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${body.slice(0, 300)}`);
  return true;
}
async function sendBrevo(key, msg) {
  const res = await withTimeout('https://api.brevo.com/v3/smtp/email', {
    method: 'POST', headers: { 'api-key': key, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { email: msg.from, ...(msg.fromName ? { name: msg.fromName } : {}) }, to: msg.to.map((email) => ({ email })), subject: msg.subject, ...(msg.html ? { htmlContent: msg.html } : {}), textContent: msg.text, ...(msg.attachments.length ? { attachment: msg.attachments.map((a) => ({ name: a.name, content: a.content })) } : {}) })
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Brevo HTTP ${res.status}: ${body.slice(0, 300)}`);
  return true;
}
function appsScriptStore(env) {
  const url = String(env.APPS_SCRIPT_URL || '').trim(), secret = String(env.APPS_SCRIPT_SECRET || '').trim();
  if (!url || !secret) return null;
  try { const s = new AppsScriptStore({ url, secret }); s.label = 'Apps Script mail'; s.attempts = 2; return s; } catch { return null; }
}
async function sendAppsScript(env, msg) {
  const store = appsScriptStore(env);
  if (!store) throw new Error('Apps Script URL/secret set nahi (APPS_SCRIPT_URL + APPS_SCRIPT_SECRET)');
  await store.call('mail', { mail: { to: msg.to.join(','), subject: msg.subject, body: msg.text, htmlBody: msg.html || '', name: msg.fromName || '', attachments: msg.attachments } });
  return true;
}

// ---------------------------------------------------------------- provider resolution + dispatcher
export function availableProviders(cfg = {}, env = process.env) {
  return {
    smtp: !!String(cfg.host || '').trim(),
    appsscript: !!appsScriptStore(env),
    resend: !!String(cfg.resendKey || env.RESEND_API_KEY || '').trim(),
    brevo: !!String(cfg.brevoKey || env.BREVO_API_KEY || '').trim()
  };
}
/** Ordered list of transports to try. auto = SMTP (unless recently unreachable) → Resend → Brevo → Apps Script. */
export function resolveProviders(cfg = {}, env = process.env) {
  const avail = availableProviders(cfg, env);
  const pref = String(cfg.provider || env.MAIL_PROVIDER || 'auto').trim().toLowerCase();
  if (pref !== 'auto' && MAIL_PROVIDERS.includes(pref)) return avail[pref] ? [pref] : [];
  const https = ['resend', 'brevo', 'appsscript'].filter((p) => avail[p]);
  const smtp = avail.smtp ? ['smtp'] : [];
  return Date.now() < smtpBlockedUntil && https.length ? [...https, ...smtp] : [...smtp, ...https];
}
/** True when at least one transport is usable. An env-only Apps Script relay counts only once the admin filled the Email card (To) — so OTP/digests never switch on by surprise. */
export const mailConfigured = (cfg = {}, env = process.env) => {
  const order = resolveProviders(cfg, env);
  if (!order.length) return false;
  const explicit = String(cfg.provider || env.MAIL_PROVIDER || 'auto').trim().toLowerCase() !== 'auto';
  return explicit || order.some((p) => p !== 'appsscript') || !!String(cfg.to || '').trim();
};
export const resetMailMemo = () => { smtpBlockedUntil = 0; };

/** Friendly Hinglish hint for a raw mail error (shown in Settings test + diagnostics). */
export function mailHint(raw) {
  const r = String(raw || '');
  if (/SMTP connect timeout|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ECONNREFUSED/i.test(r)) {
    return ' SMTP port connect hi nahi ho raha — Render FREE plan (26 Sep 2025 se) port 25/465/587 block karta hai. Fix: paid plan, ya Provider = “Google Apps Script (Gmail)” / Resend / Brevo chuno (HTTPS par chalte hain, block nahi hote).';
  }
  if (/535|534|authentication|credentials|username and password/i.test(r)) return ' Gmail ho to normal password nahi chalta — Google Account → 2-Step Verification ON → App passwords se 16-letter password banao (spaces ho to bhi chalega).';
  if (/ENOTFOUND|EAI_AGAIN/i.test(r)) return ' SMTP host ka naam galat hai (jaise smtp.gmail.com).';
  if (/timeout/i.test(r)) return ' Host/port check karo: STARTTLS = 587 + TLS unchecked; implicit TLS = 465 + TLS checked.';
  if (/Apps Script.*(unknown action|mail)/i.test(r) || /unknown action/i.test(r)) return ' Apps Script me purana Code.gs hai — google-apps-script/Code.gs ka naya code paste karke Deploy → Manage deployments → Edit → New version karo (mail permission allow karna).';
  if (/HTTP 403|HTTP 401|Unauthorized|invalid api key|API key/i.test(r)) return ' API key galat/expire hai — provider dashboard se nayi key banao.';
  if (/HTTP 422|domain|verify|sender/i.test(r)) return ' Sender/From address provider me verified hona chahiye (Resend: domain verify · Brevo: sender verify).';
  return '';
}

/**
 * Send one mail. cfg = Settings email block ({ host, port, secure, user, pass, from, to, provider, resendKey, brevoKey }).
 * In auto mode failures fall through to the next configured transport. Resolves { provider, tried }.
 */
export async function sendMail(cfg, subject, text, opts = {}, env = process.env) {
  const order = resolveProviders(cfg, env);
  const pref = String(cfg.provider || env.MAIL_PROVIDER || 'auto').trim().toLowerCase();
  if (!order.length) {
    throw new Error(pref !== 'auto' && MAIL_PROVIDERS.includes(pref)
      ? `Email provider “${pref}” configured nahi hai — Settings → Features → Email me uski details bharo.`
      : 'Email set nahi hai — SMTP host, ya Apps Script / Resend / Brevo me se koi ek Settings → Features → Email me configure karo.');
  }
  const fromHeader = String(cfg.from || cfg.user || '').trim();
  const from = mailbox(fromHeader);
  const to = splitRecipients(cfg.to);
  const errors = [];
  for (const provider of order) {
    try {
      if (provider === 'smtp') await smtpSend(cfg, subject, text, opts);
      else {
        if (!to.length) throw smtpError('"To" address set nahi hai', 'CONFIG');
        if (to.some((x) => !EMAIL_RE.test(x))) throw smtpError('"To" me ek email valid nahi hai', 'CONFIG');
        if (provider !== 'appsscript' && !EMAIL_RE.test(from)) throw smtpError('"From" email valid nahi hai (provider ke liye verified sender chahiye)', 'CONFIG');
        const msg = { from, fromHeader: fromHeader || from, fromName: displayName(fromHeader), to, subject, text, html: opts.html || '', attachments: attachmentsOf(opts) };
        if (provider === 'resend') await sendResend(String(cfg.resendKey || env.RESEND_API_KEY).trim(), msg);
        else if (provider === 'brevo') await sendBrevo(String(cfg.brevoKey || env.BREVO_API_KEY).trim(), msg);
        else await sendAppsScript(env, msg);
      }
      if (provider === 'smtp') smtpBlockedUntil = 0;
      return { provider, tried: [...errors.map((e) => e.provider), provider] };
    } catch (err) {
      if (provider === 'smtp' && err && err.code === 'SMTP_CONNECT') smtpBlockedUntil = Date.now() + BLOCK_MEMO_MS;
      errors.push({ provider, message: String(err && err.message || err) });
    }
  }
  const label = { smtp: 'SMTP', appsscript: 'Apps Script', resend: 'Resend', brevo: 'Brevo' };
  const msg = errors.length === 1 ? errors[0].message : errors.map((e) => `${label[e.provider]}: ${e.message}`).join(' | ');
  const err = new Error(msg);
  err.attempts = errors;
  throw err;
}

// ---------------------------------------------------------------- diagnostics
function tcpProbe(host, port, ms = 5000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const s = net.connect({ host, port });
    const finish = (ok, detail) => { try { s.destroy(); } catch { /* ignore */ } resolve({ ok, ms: Date.now() - started, detail }); };
    s.setTimeout(ms, () => finish(false, 'timeout — koi jawab nahi (port block / firewall)'));
    s.once('connect', () => finish(true, 'connected'));
    s.once('error', (e) => finish(false, e.code || e.message));
  });
}

/** Non-destructive checks: what is configured, can we reach SMTP ports, can we reach the HTTPS relays. */
export async function diagnoseMail(cfg = {}, env = process.env) {
  const avail = availableProviders(cfg, env);
  const order = resolveProviders(cfg, env);
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  add('Recipients (To)', splitRecipients(cfg.to).length > 0, splitRecipients(cfg.to).join(', ') || 'To address khaali hai');
  add('From', EMAIL_RE.test(mailbox(cfg.from || cfg.user || '')), mailbox(cfg.from || cfg.user || '') || 'From khaali (User email use hoga)');
  let smtpReachable = null;
  if (avail.smtp) {
    const host = String(cfg.host).trim();
    let resolved = true;
    try { const a = await dns.lookup(host); add(`DNS ${host}`, true, a.address); } catch (e) { resolved = false; add(`DNS ${host}`, false, e.code || e.message); }
    if (resolved) {
      const ports = [...new Set([Number(cfg.port) || 587, 587, 465])];
      const res = await Promise.all(ports.map((p) => tcpProbe(host, p)));
      ports.forEach((p, i) => add(`TCP ${host}:${p}`, res[i].ok, res[i].ok ? `connected (${res[i].ms} ms)` : res[i].detail));
      smtpReachable = res.some((r) => r.ok);
    }
  }
  let httpsOk = null;
  try { const r = await withTimeout('https://script.google.com/', { method: 'HEAD' }, 6000); httpsOk = r.status < 500; add('HTTPS out (script.google.com)', httpsOk, `HTTP ${r.status}`); } catch (e) { httpsOk = false; add('HTTPS out (script.google.com)', false, String(e.message || e)); }
  if (avail.appsscript) {
    try { const store = appsScriptStore(env); const out = await store.call('mailping'); add('Apps Script mail relay', true, `ready${out.quota !== undefined ? ` · daily quota left ${out.quota}` : ''}${out.account ? ` · ${out.account}` : ''}`); }
    catch (e) { add('Apps Script mail relay', false, `${String(e.message || e)}${mailHint(e.message)}`); }
  }
  const advice = [];
  if (!order.length) advice.push('Koi transport configured nahi. Sabse aasaan: Provider = “Google Apps Script (Gmail)” (storage wala hi Apps Script, extra account nahi) — steps README/STORAGE_SETUP me.');
  if (avail.smtp && smtpReachable === false) advice.push('SMTP server tak connection nahi ban raha. Render FREE web service SMTP ports (25/465/587) block karti hai — paid plan lo, ya Apps Script / Resend / Brevo (HTTPS) use karo.');
  if (avail.smtp && smtpReachable === true) advice.push('SMTP port khula hai ✓. Ab bhi fail ho to user/app-password/From check karo (Gmail: App Password, From = wahi Gmail).');
  if (avail.smtp && !avail.appsscript && !avail.resend && !avail.brevo && smtpReachable === false) advice.push('Backup ke roop me HTTPS transport add karo — tab “auto” mode khud fallback karega.');
  return { providers: avail, order, activeProvider: order[0] || '', preference: String(cfg.provider || env.MAIL_PROVIDER || 'auto'), checks, advice, smtpBlockedMemo: Date.now() < smtpBlockedUntil };
}
