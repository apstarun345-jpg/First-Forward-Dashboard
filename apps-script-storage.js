// Durable storage through a Google Apps Script web app bound to a Google Sheet.
// Why: Render (free / no disk) wipes the app folder on every deploy / restart / sleep, so users,
// settings, sessions and notifications went back to defaults. This backend needs NO Google Cloud
// project or service account — just paste google-apps-script/Code.gs into the sheet
// (Extensions → Apps Script), deploy it as a web app and set two Render environment variables:
//   APPS_SCRIPT_URL     = https://script.google.com/macros/s/…/exec
//   APPS_SCRIPT_SECRET  = the same long random secret written in Code.gs
// Every record is encrypted (AES-256-GCM, key derived from the secret) BEFORE it leaves this
// server, so even a publicly viewable workbook never exposes usernames, password hashes or sessions.
import crypto from 'node:crypto';

export const APPS_SCRIPT_KINDS = ['users', 'sessions', 'settings', 'resets', 'notify'];
const VERSION = 'APNAPAYMENT_AS_V1';
const MAX_BYTES = 12 * 1024 * 1024;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class AppsScriptStore {
  constructor({ url, secret, fetchImpl = globalThis.fetch, wait = sleep, batchDelay = 350, slowKinds = { notify: 4000 } } = {}) {
    const allowLocal = process.env.APPS_SCRIPT_ALLOW_LOCAL === '1'; // tests / local mock only
    if (!/^https:\/\/script\.google(usercontent)?\.com\/.+/.test(url || '') && !(allowLocal && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url || ''))) {
      throw new Error('APPS_SCRIPT_URL must be the deployed Apps Script web-app URL (https://script.google.com/macros/s/…/exec).');
    }
    if (typeof secret !== 'string' || secret.length < 16) throw new Error('APPS_SCRIPT_SECRET must be at least 16 characters (use a long random value).');
    this.url = url;
    this.secret = secret;
    this.key = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.from('apnapayment-app-storage'), Buffer.from('aes-256-gcm-v1'), 32));
    this.fetch = fetchImpl;
    this.wait = wait;
    this.batchDelay = batchDelay;
    this.slowKinds = slowKinds;
    this.pending = new Map(); // kind → { value, waiters: [] }
    this.timer = null;
    this.timerAt = 0;
    this.flushing = null;
    this.lastSavedAt = null;
    this.lastError = null;
  }

  aad(kind) { return Buffer.from(`${VERSION}:${kind}`); }
  encode(kind, value) {
    if (!APPS_SCRIPT_KINDS.includes(kind)) throw new Error('Unknown storage record.');
    const plain = Buffer.from(JSON.stringify(value));
    if (plain.length > MAX_BYTES) throw new Error(`${kind} storage exceeds 12 MB. Reduce uploaded images or archive records.`);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(this.aad(kind));
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    return { v: VERSION, data: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64') };
  }
  decode(kind, record) {
    if (!record || record.v !== VERSION || typeof record.data !== 'string') throw new Error(`Invalid ${kind} record in APP_STORAGE.`);
    try {
      const sealed = Buffer.from(record.data, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, sealed.subarray(0, 12));
      decipher.setAuthTag(sealed.subarray(12, 28));
      decipher.setAAD(this.aad(kind));
      return JSON.parse(Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]).toString('utf8'));
    } catch {
      throw new Error(`Cannot decrypt ${kind} from APP_STORAGE. APPS_SCRIPT_SECRET changed? Use the ORIGINAL secret. Nothing was reset.`);
    }
  }

  async call(action, extra = {}) {
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await this.fetch(this.url, {
          method: 'POST', redirect: 'follow', signal: controller.signal,
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ secret: this.secret, action, ...extra })
        });
        const text = await response.text();
        if (response.status === 429 || response.status >= 500) throw Object.assign(new Error(`Apps Script HTTP ${response.status}`), { retry: true });
        let json;
        try { json = JSON.parse(text); } catch {
          throw new Error(/<html/i.test(text)
            ? 'Apps Script returned an HTML page. Deploy it as Web app → Execute as: Me, Who has access: Anyone, and use the /exec URL.'
            : 'Apps Script returned an invalid response.');
        }
        if (!json.ok) throw new Error(`Apps Script storage: ${json.error || 'request failed'}`);
        this.lastError = null;
        return json;
      } catch (err) {
        lastErr = err.name === 'AbortError' ? Object.assign(new Error('Apps Script storage timeout'), { retry: true }) : err;
        const retry = lastErr.retry || /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket/i.test(String(lastErr.message) + String(lastErr.cause || ''));
        if (!retry || attempt === 3) break;
        await this.wait(500 * 2 ** attempt + Math.floor(Math.random() * 200));
      } finally { clearTimeout(timer); }
    }
    this.lastError = lastErr ? lastErr.message : 'Apps Script storage failed';
    throw lastErr;
  }

  async ping() { return this.call('ping'); }

  /** Returns null when the storage tab is still empty (first run), else { users, sessions, … }. */
  async read() {
    const out = await this.call('read');
    const records = out.records || {};
    const present = APPS_SCRIPT_KINDS.filter((k) => records[k]);
    if (!present.length) return null;
    if (!records.users) throw new Error('APP_STORAGE has records but no users row. Restore the APP_STORAGE tab; refusing to reset accounts.');
    const data = {};
    for (const kind of present) data[kind] = this.decode(kind, records[kind]);
    return data;
  }

  /** Queue a save. Nearby saves are batched into ONE Apps Script call. Resolves when confirmed. */
  save(kind, value) {
    return new Promise((resolve, reject) => {
      const entry = this.pending.get(kind) || { value: null, waiters: [] };
      entry.value = value;
      entry.waiters.push({ resolve, reject });
      this.pending.set(kind, entry);
      this.schedule(this.slowKinds[kind] ?? this.batchDelay);
    });
  }
  schedule(delay) {
    const at = Date.now() + delay;
    if (this.timer && this.timerAt <= at) return;
    clearTimeout(this.timer);
    this.timerAt = at;
    this.timer = setTimeout(() => { this.timer = null; this.flush().catch(() => {}); }, delay);
    if (this.timer.unref && delay > 1000) this.timer.unref();
  }
  async flush() {
    if (this.flushing) { await this.flushing.catch(() => {}); }
    if (!this.pending.size) return;
    const batch = new Map(this.pending);
    this.pending.clear();
    const records = {};
    const job = (async () => {
      for (const [kind, entry] of batch) records[kind] = this.encode(kind, entry.value);
      await this.call('write', { records });
      this.lastSavedAt = new Date().toISOString();
    })();
    this.flushing = job;
    try {
      await job;
      for (const entry of batch.values()) entry.waiters.forEach((w) => w.resolve());
    } catch (err) {
      for (const entry of batch.values()) entry.waiters.forEach((w) => w.reject(err));
      throw err;
    } finally { if (this.flushing === job) this.flushing = null; }
  }
  /** Flush everything now (used on shutdown). */
  async drain() { clearTimeout(this.timer); this.timer = null; await this.flush().catch(() => {}); }
}

export function appsScriptStoreFromEnv() {
  return new AppsScriptStore({ url: (process.env.APPS_SCRIPT_URL || '').trim(), secret: (process.env.APPS_SCRIPT_SECRET || '').trim() });
}
