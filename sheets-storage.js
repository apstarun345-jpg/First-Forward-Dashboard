// Server-only encrypted persistence in a dedicated tab of the EXISTING spreadsheet.
// No credentials, password hashes, session records or profile fields are written in plaintext.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STORAGE_KINDS = ['users', 'sessions', 'settings', 'resets', 'notify'];
const VERSION = 'APNAPAYMENT_ENCRYPTED_V1';
const CHUNK_SIZE = 40000; // Google Sheets cells have a 50,000-character limit.
const COLUMNS = 512;
const MAX_BYTES = 12 * 1024 * 1024;
const TAB = 'APP_STORAGE';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function col(number) {
  let label = '';
  for (let n = number; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + (n - 1) % 26) + label;
  return label;
}
function validate(kind, value) {
  const array = ['users', 'resets'].includes(kind);
  if (value === null || typeof value !== 'object' || Array.isArray(value) !== array) throw new Error(`Invalid ${kind} storage record; refusing to reset stored data.`);
  if (kind === 'users' && !value.some(u => u && u.role === 'admin' && u.approved && typeof u.password === 'string')) throw new Error('Stored users must contain an approved admin. Restore a valid backup.');
}

export class EncryptedSheetsStore {
  constructor({ sheetId, credentials, encryptionKey, fetchImpl = globalThis.fetch, wait = sleep, batchDelay = 200 }) {
    if (!/^[A-Za-z0-9_-]+$/.test(sheetId || '')) throw new Error('STORAGE_SHEET_ID must be the existing spreadsheet ID.');
    if (!credentials || credentials.type !== 'service_account' || !credentials.client_email || !credentials.private_key) throw new Error('Configure a Google service-account JSON secret on the server.');
    if (!/^[A-Za-z0-9+/]{43}=$/.test(encryptionKey || '')) throw new Error('STORAGE_ENCRYPTION_KEY must be a permanent, random 32-byte base64 key.');
    this.key = Buffer.from(encryptionKey, 'base64');
    if (this.key.length !== 32) throw new Error('Invalid STORAGE_ENCRYPTION_KEY.');
    this.sheetId = sheetId;
    this.credentials = credentials;
    this.fetch = fetchImpl;
    this.wait = wait;
    this.batchDelay = batchDelay;
    this.token = null;
    this.tokenJob = null;
    this.tab = null;
    this.pending = new Map();
    this.writing = false;
    this.timer = null;
    this.lastSavedAt = null;
  }
  aad(kind) { return Buffer.from(`${VERSION}:${this.sheetId}:${TAB}:${kind}`); }
  encode(kind, value) {
    if (!STORAGE_KINDS.includes(kind)) throw new Error('Unknown storage record.');
    validate(kind, value);
    const plain = Buffer.from(JSON.stringify(value));
    if (plain.length > MAX_BYTES) throw new Error(`${kind} storage exceeds 12 MB. Reduce uploaded images or archive records.`);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(this.aad(kind));
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    const payload = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
    const chunks = payload.match(new RegExp(`.{1,${CHUNK_SIZE}}`, 'g')) || [];
    return [VERSION, kind, String(chunks.length), ...chunks];
  }
  decode(kind, row) {
    if (!Array.isArray(row) || row[0] !== VERSION || row[1] !== kind) throw new Error(`Missing/invalid ${kind} row in ${TAB}. Restore the tab; it will not be overwritten.`);
    const count = Number(row[2]);
    if (!Number.isInteger(count) || count < 1 || count > COLUMNS - 3 || row.length < count + 3) throw new Error(`Incomplete encrypted ${kind} record.`);
    const chunks = row.slice(3, count + 3);
    if (chunks.some(c => typeof c !== 'string' || c.length > CHUNK_SIZE || !/^[A-Za-z0-9+/=]+$/.test(c))) throw new Error(`Invalid encrypted ${kind} chunks.`);
    try {
      const sealed = Buffer.from(chunks.join(''), 'base64');
      if (sealed.length < 29 || sealed.length > MAX_BYTES + 28) throw new Error('Invalid length');
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, sealed.subarray(0, 12));
      decipher.setAuthTag(sealed.subarray(12, 28));
      decipher.setAAD(this.aad(kind));
      const value = JSON.parse(Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]).toString('utf8'));
      validate(kind, value);
      return value;
    } catch {
      throw new Error(`Cannot decrypt ${kind}. Check the ORIGINAL encryption key and sheet ID, or restore an untampered backup. Nothing was reset.`);
    }
  }
  async timedFetch(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await this.fetch(url, { ...options, signal: controller.signal });
      const text = await response.text();
      let json;
      try { json = JSON.parse(text); } catch { throw new Error('Google returned an invalid storage response. Retry later.'); }
      return { response, json };
    } finally { clearTimeout(timer); }
  }
  async accessToken() {
    if (this.token && this.token.expiresAt > Date.now() + 60000) return this.token.value;
    if (this.tokenJob) return this.tokenJob;
    this.tokenJob = (async () => {
      const now = Math.floor(Date.now() / 1000);
      const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
      const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iss: this.credentials.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: TOKEN_URL, iat: now, exp: now + 3600 })}`;
      const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), this.credentials.private_key).toString('base64url');
      const { response, json } = await this.timedFetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }).toString() });
      if (!response.ok || !json.access_token) throw new Error('Google authentication failed. Check the server service-account secret and enable Google Sheets API.');
      this.token = { value: json.access_token, expiresAt: Date.now() + Math.min(Number(json.expires_in) || 3600, 3600) * 1000 };
      return this.token.value;
    })();
    try { return await this.tokenJob; } finally { this.tokenJob = null; }
  }
  async request(suffix, method = 'GET', body) {
    // All writes used here are idempotent (values batch update / absolute grid size).
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = await this.accessToken();
      const { response, json } = await this.timedFetch(`${API}/${this.sheetId}${suffix}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (response.ok) return json;
      if (response.status === 401 && attempt === 0) { this.token = null; continue; }
      if ((response.status === 429 || response.status >= 500) && attempt < 2 && !body?.requests?.some(r => r.addSheet)) {
        await this.wait(400 * 2 ** attempt + Math.floor(Math.random() * 100)); continue;
      }
      throw new Error(`Google Sheets storage HTTP ${response.status}. ${response.status === 403 ? 'Enable Sheets API and give the service-account email Editor access to the existing sheet.' : 'Save not confirmed; retry. Do not reset the storage tab.'}`);
    }
  }
  async read() {
    const meta = await this.request('?fields=sheets.properties');
    this.tab = (meta.sheets || []).map(s => s.properties).find(p => p.title === TAB) || null;
    if (!this.tab) return null;
    const columns = Math.min(COLUMNS, this.tab.gridProperties?.columnCount || COLUMNS);
    const rowsToRead = Math.min(5, this.tab.gridProperties?.rowCount || 5);
    const result = await this.request(`/values/${encodeURIComponent(`'${TAB}'!A1:${col(columns)}${rowsToRead}`)}`);
    const rows = result.values || [];
    if (!rows.length || rows.every(row => row.every(cell => cell === ''))) return null;
    // Partial/corrupt storage is an error, NEVER a signal to create a new admin.
    return Object.fromEntries(STORAGE_KINDS.map((kind, i) => [kind, this.decode(kind, rows[i])]));
  }
  async prepareTab() {
    if (!this.tab) {
      const result = await this.request(':batchUpdate', 'POST', { requests: [{ addSheet: { properties: { title: TAB, hidden: true, gridProperties: { rowCount: 5, columnCount: COLUMNS } } } }] });
      this.tab = result.replies?.[0]?.addSheet?.properties;
      if (!this.tab) throw new Error('Could not create APP_STORAGE tab.');
    } else if ((this.tab.gridProperties?.columnCount || 0) < COLUMNS || (this.tab.gridProperties?.rowCount || 0) < 5) {
      await this.request(':batchUpdate', 'POST', { requests: [{ updateSheetProperties: { properties: { sheetId: this.tab.sheetId, gridProperties: { rowCount: Math.max(5, this.tab.gridProperties?.rowCount || 0), columnCount: Math.max(COLUMNS, this.tab.gridProperties?.columnCount || 0) } }, fields: 'gridProperties.rowCount,gridProperties.columnCount' } }] });
    }
  }
  async initialize(data) {
    if (await this.read()) throw new Error('APP_STORAGE is already initialized. Refusing to overwrite existing users.');
    const rows = STORAGE_KINDS.map(kind => [kind, this.encode(kind, data[kind])]);
    await this.prepareTab();
    await this.writeRows(rows); // One atomic Sheets batch initializes ALL five records.
    // Verify the saved records before accepting traffic.
    const verified = await this.read();
    if (!verified || STORAGE_KINDS.some(kind => JSON.stringify(verified[kind]) !== JSON.stringify(data[kind]))) throw new Error('Storage initialization verification failed. Keep the source backup; do not switch the live app.');
  }
  async writeRows(rows) {
    const data = rows.map(([kind, values]) => {
      const row = STORAGE_KINDS.indexOf(kind) + 1;
      return { range: `'${TAB}'!A${row}:${col(values.length)}${row}`, majorDimension: 'ROWS', values: [values] };
    });
    await this.request('/values:batchUpdate', 'POST', { valueInputOption: 'RAW', data });
    this.lastSavedAt = new Date().toISOString();
  }
  save(kind, value) {
    if (!this.tab) return Promise.reject(new Error('APP_STORAGE is not initialized.'));
    let row;
    try { row = this.encode(kind, value); } catch (err) { return Promise.reject(err); }
    return new Promise((resolve, reject) => {
      const entry = this.pending.get(kind) || { waiters: [] };
      entry.row = row; entry.waiters.push({ resolve, reject }); this.pending.set(kind, entry);
      this.schedule();
    });
  }
  schedule() {
    if (this.timer || this.writing) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.batchDelay);
  }
  async flush() {
    if (this.writing || !this.pending.size) return;
    this.writing = true;
    const batch = this.pending; this.pending = new Map();
    try {
      await this.writeRows([...batch].map(([kind, e]) => [kind, e.row]));
      for (const e of batch.values()) for (const w of e.waiters) w.resolve();
    } catch (err) {
      for (const e of batch.values()) for (const w of e.waiters) w.reject(err);
    } finally { this.writing = false; if (this.pending.size) this.schedule(); }
  }
}

export async function sheetsStoreFromEnv(defaultSheetId) {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_FILE) {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const secret = path.resolve(process.env.GOOGLE_SERVICE_ACCOUNT_FILE);
    if (secret === root || secret.startsWith(root + path.sep)) throw new Error('Keep the service-account secret OUTSIDE the repository/web root (for example /etc/secrets).');
  }
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || (process.env.GOOGLE_SERVICE_ACCOUNT_FILE ? await fs.readFile(process.env.GOOGLE_SERVICE_ACCOUNT_FILE, 'utf8') : '');
  let credentials;
  try { credentials = JSON.parse(raw); } catch { throw new Error('Configure GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_FILE privately on the server.'); }
  return new EncryptedSheetsStore({ sheetId: process.env.STORAGE_SHEET_ID || defaultSheetId, credentials, encryptionKey: process.env.STORAGE_ENCRYPTION_KEY });
}
