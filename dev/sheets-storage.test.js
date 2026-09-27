import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { EncryptedSheetsStore, STORAGE_KINDS } from '../sheets-storage.js';
import { emptyWorkbook, mockSheetsFetch } from './mock-sheets-api.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const credentials = { type: 'service_account', client_email: 'test@synthetic-project.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const encryptionKey = crypto.randomBytes(32).toString('base64');
const seed = () => ({
  users: [{ username: 'owner', name: 'Private Owner', role: 'admin', approved: true, password: 'salt:secure-hash', permissions: ['home'] }],
  sessions: { tokenDigest: { username: 'owner', expiresAt: Date.now() + 86400000 } },
  settings: { sheetId: 'existing-main-sheet', brand: 'Private Brand', theme: { accent: '#123456' } },
  resets: [], notify: { items: [], watch: {} }
});
function fixture() {
  let workbook = emptyWorkbook(); let fail = false;
  const calls = [];
  const fetchImpl = mockSheetsFetch({ read: async () => structuredClone(workbook), write: async value => { workbook = structuredClone(value); }, failWrites: async () => fail, calls });
  const create = (overrides = {}) => new EncryptedSheetsStore({ sheetId: 'existing-main-sheet', credentials, encryptionKey, fetchImpl, batchDelay: 0, wait: async () => {}, ...overrides });
  return { create, calls, fetchImpl, get workbook() { return workbook; }, set fail(value) { fail = value; } };
}

test('same-sheet init encrypts all records, preserves business tabs, and reloads with no local files', async () => {
  const f = fixture(), store = f.create(), data = seed();
  await store.initialize(data);
  assert.equal(f.workbook.sheets[0].properties.title, 'EIR');
  assert.equal(f.workbook.sheets[1].properties.title, 'APP_STORAGE');
  assert.equal(f.workbook.sheets[1].properties.hidden, true);
  const stored = JSON.stringify(f.workbook);
  for (const secret of ['Private Owner', 'Private Brand', 'salt:secure-hash', 'tokenDigest', '#123456']) assert.ok(!stored.includes(secret));
  assert.deepEqual(await f.create().read(), data);
  assert.equal(f.calls.filter(c => c.url.endsWith('/values:batchUpdate')).length, 1, 'all five records initialized in one atomic batch');
  const auth = f.calls.find(c => c.url.includes('oauth2')).body.assertion.split('.');
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from(auth.slice(0, 2).join('.')), publicKey, Buffer.from(auth[2], 'base64url')), true);
  assert.equal(JSON.parse(Buffer.from(auth[1], 'base64url')).scope, 'https://www.googleapis.com/auth/spreadsheets');
});

test('AES-GCM random nonces, chunking and tamper/wrong-key/cross-sheet protection', () => {
  const f = fixture(), store = f.create();
  const value = { logo: 'large-image-'.repeat(10000) };
  const first = store.encode('settings', value), second = store.encode('settings', value);
  assert.notDeepEqual(first, second, 'fresh nonce for every write');
  assert.ok(Number(first[2]) > 1);
  assert.ok(first.slice(3).every(c => c.length <= 40000));
  assert.deepEqual(store.decode('settings', [...first, 'ignored-old-trailing-cell']), value);
  const corrupted = structuredClone(first); corrupted[3] = (corrupted[3][0] === 'A' ? 'B' : 'A') + corrupted[3].slice(1);
  assert.throws(() => store.decode('settings', corrupted), /Cannot decrypt/);
  assert.throws(() => f.create({ encryptionKey: crypto.randomBytes(32).toString('base64') }).decode('settings', first), /Cannot decrypt/);
  assert.throws(() => f.create({ sheetId: 'different-sheet' }).decode('settings', first), /Cannot decrypt/);
  assert.throws(() => store.decode('sessions', first), /Missing\/invalid/);
  assert.throws(() => store.decode('settings', first.slice(0, 3)), /Incomplete/);
  assert.throws(() => f.create({ encryptionKey: 'weak-key' }), /32-byte/);
});

test('coalesced saves wait for Google, failed writes reject and next save recovers', async () => {
  const f = fixture(), store = f.create(); await store.initialize(seed());
  const before = f.calls.length;
  await Promise.all([store.save('settings', { brand: 'Updated' }), store.save('sessions', { nextToken: { username: 'owner' } })]);
  assert.equal(f.calls.slice(before).filter(c => c.url.endsWith('/values:batchUpdate')).length, 1);
  const reloaded = await f.create().read();
  assert.equal(reloaded.settings.brand, 'Updated'); assert.ok(reloaded.sessions.nextToken);
  f.fail = true;
  await assert.rejects(store.save('settings', { brand: 'Not saved' }), /HTTP 403/);
  assert.equal((await f.create().read()).settings.brand, 'Updated');
  f.fail = false; await store.save('settings', { brand: 'Recovered' });
  assert.equal((await f.create().read()).settings.brand, 'Recovered');
});

test('existing, missing and partial records are never silently replaced by initialization', async () => {
  const f = fixture(), store = f.create(); await store.initialize(seed());
  await assert.rejects(f.create().initialize(seed()), /already initialized/);
  f.workbook.rows[1] = [];
  const before = f.calls.filter(c => c.method === 'POST' && c.url.includes('sheets.googleapis.com')).length;
  await assert.rejects(f.create().read(), /Missing\/invalid sessions/);
  await assert.rejects(f.create().initialize(seed()), /Missing\/invalid sessions/);
  // OAuth may be requested, but no spreadsheet mutation is attempted.
  assert.equal(f.calls.filter(c => c.method === 'POST' && c.url.includes('sheets.googleapis.com')).length, before);
});

test('quota retry is bounded and successful saves are confirmed only after retry', async () => {
  const f = fixture(); let failures = 0;
  const store = f.create({ fetchImpl: async (url, opts) => {
    if (url.endsWith('/values:batchUpdate') && failures++ < 2) return new Response('{"error":"quota"}', { status: 429 });
    return f.fetchImpl(url, opts);
  } });
  const data = seed(); await store.initialize(data); assert.equal(failures, 3); assert.deepEqual(await store.read(), data);
});

async function startServer(env) {
  const child = spawn(process.execPath, ['--import', './dev/install-storage-mock.js', 'server.js'], { cwd: ROOT, env: { ...process.env, PORT: '0', RENDER: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stderr.on('data', data => { log += data; });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Startup timeout: ' + log)); }, 15000);
    child.stdout.on('data', data => { log += data; const match = log.match(/http:\/\/0\.0\.0\.0:(\d+)/); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); } });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`Exited ${code}: ${log}`)); });
  });
  return { base, child, async stop() { if (child.exitCode !== null) return; child.kill('SIGTERM'); await once(child, 'exit'); } };
}

test('server migration, cookies, users and theme survive a restart with EMPTY ephemeral disk; cloud failure never falls back', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-cloud-'));
  let server;
  try {
    const workbookFile = path.join(dir, 'mock-workbook.json');
    await fs.writeFile(workbookFile, JSON.stringify(emptyWorkbook()));
    const localDir = path.join(dir, 'legacy'); await fs.mkdir(localDir);
    const data = seed(); const salt = 'test-salt';
    data.users[0].password = `${salt}:${crypto.scryptSync('owner-password', salt, 64).toString('hex')}`;
    for (const kind of STORAGE_KINDS) await fs.writeFile(path.join(localDir, `${kind === 'notify' ? 'notifications' : kind}.json`), JSON.stringify(data[kind]));
    const env = { STORAGE_BACKEND: 'sheets', STORAGE_SHEET_ID: 'existing-main-sheet', STORAGE_ENCRYPTION_KEY: encryptionKey, GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(credentials), MOCK_SHEETS_FILE: workbookFile, DATA_DIR: localDir, STORAGE_INITIALIZE: '1', ADMIN_USER: '', ADMIN_PASSWORD: '' };
    server = await startServer(env);
    let cookie = '';
    const call = async (route, method = 'GET', body) => {
      const res = await fetch(server.base + route, { method, headers: { cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { res, json: await res.json() };
    };
    const login = await call('/api/auth/login', 'POST', { username: 'owner', password: 'owner-password' });
    assert.equal(login.res.status, 200); cookie = login.res.headers.get('set-cookie').split(';')[0];
    assert.equal((await call('/api/settings', 'PUT', { settings: { theme: { accent: '#aabbcc' } } })).res.status, 200);
    assert.equal((await call('/api/auth/profile', 'POST', { name: 'Cloud Owner' })).res.status, 200);
    await server.stop();
    await fs.rm(localDir, { recursive: true }); // simulate Render losing its entire ephemeral store
    server = await startServer({ ...env, STORAGE_INITIALIZE: '' });
    const me = (await call('/api/auth/me')).json;
    assert.equal(me.user.name, 'Cloud Owner'); assert.equal(me.settings.theme.accent, '#aabbcc');
    const health = (await call('/api/health')).json;
    assert.equal(health.storage.backend, 'sheets'); assert.equal(health.storage.encrypted, true); assert.equal(health.storage.warning, null);
    assert.equal(await fs.stat(localDir).catch(() => null), null, 'cloud mode does not require/create a local store');
    const rawCloud = await fs.readFile(workbookFile, 'utf8');
    assert.ok(!rawCloud.includes('Cloud Owner')); assert.ok(!rawCloud.includes('owner-password'));
    await fs.writeFile(workbookFile + '.fail', '1');
    const failed = await call('/api/settings', 'PUT', { settings: { brand: 'Lost Edit' } });
    assert.equal(failed.res.status, 503); assert.match(failed.json.error, /Google Sheets/);
    assert.equal((await call('/api/settings')).json.settings.brand, 'Private Brand');
    assert.equal(await fs.stat(localDir).catch(() => null), null, 'failure never writes to ephemeral fallback');
    await fs.unlink(workbookFile + '.fail');
    assert.equal((await call('/api/settings', 'PUT', { settings: { brand: 'Cloud Saved' } })).res.status, 200);
    for (const asset of ['/sheets-storage.js', '/dev/install-storage-mock.js']) assert.equal((await fetch(server.base + asset)).status, 404);
  } finally {
    if (server) await server.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
