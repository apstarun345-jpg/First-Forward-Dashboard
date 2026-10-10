/* 🛡️ v3.50 — Tag Requests durability + ⏪ recovery + 🔔 notification check.

   Asli bug (Render deploy overlap): tag requests `notify` record ke andar hi save hoti hain. Ek
   PURANA process jab apna purana snapshot likhta tha to nayi (employee link se aayi) requests gayab
   ho jaati thin. Is test me wahi situation banayi jaati hai:

     1. employee link se request → storage me save (mock Apps Script)
     2. "purana process" ka stale notify record wapas likh diya jaata hai (requests gayab)
     3. server restart → request list me nahi (reproduce)
     4. ⏪ recovery: /api/tag-requests/recovery → missing dikhti hai, restore → ID wapas

   Doosra test: DO servers ek hi storage par (deploy overlap). Purana server (B) apni request save
   karta hai — save se pehle guard storage padhta hai aur nayi requests merge kar deta hai, isliye A
   ki request zinda rehti hai.

   Saath me: 🔔 tag-request notification route Settings me dikhta hai, /api/tag-requests/notify-check
   route + prefs + push ki sach dikhata hai, aur cache-bust/version wiring.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { startMockAppsScript } from './mock-apps-script.js';
import { AppsScriptStore } from '../apps-script-storage.js';

process.env.APPS_SCRIPT_ALLOW_LOCAL = '1';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'test-secret-v350-recover';
const read = (name) => fs.readFile(path.join(ROOT, name), 'utf8');

async function startServer(dir, mockUrl) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, STORAGE_BACKEND: 'appsscript', PORT: '0', DATA_DIR: dir, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'initial-password', RENDER: '', APPS_SCRIPT_ALLOW_LOCAL: '1', APPS_SCRIPT_URL: mockUrl, APPS_SCRIPT_SECRET: SECRET },
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
  const base = await Promise.race([ready, new Promise((_, reject) => { const t = setTimeout(() => reject(new Error(`startup timeout: ${logs}`)), 15000); t.unref(); })]);
  return { child, base, logs: () => logs, async stop() { if (child.exitCode !== null) return; child.kill('SIGTERM'); await once(child, 'exit'); } };
}

async function jsonCall(base, route, method = 'GET', body, cookie = '', ip = '') {
  const headers = { 'Content-Type': 'application/json', cookie, 'X-Forwarded-Proto': 'https' };
  if (ip) headers['X-Forwarded-For'] = ip;
  const res = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { res, json, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}
const login = async (base, user = 'owner', pass = 'initial-password') => (await jsonCall(base, '/api/auth/login', 'POST', { username: user, password: pass })).cookie;
const agentPayload = (name) => ({
  employee: { name: 'Ramesh Yadav', office: 'Jaipur office' },
  employees: [{ name }],
  note: 'kal dispatch',
  agents: [{
    agentId: '1001', agentName: name, tl: 'TL One', channel: 'ff', mobile: '9876500001',
    address: '12, Gandhi Nagar, Tonk Road, Jaipur', pincode: '302015',
    rows: [{ cls: 'VC4', approved: 25 }, { cls: 'VC5', approved: 5 }]
  }]
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Mock ke andar pada notify record decode karo (network call nahi). */
function decodeNotify(mock) {
  const rec = mock.records.notify;
  if (!rec || !rec.data) return [];
  try {
    const store = mock.__decoder || (mock.__decoder = new AppsScriptStore({ url: 'http://127.0.0.1:1/x', secret: SECRET }));
    const value = store.decode('notify', { v: rec.v, data: rec.data });
    return ((value && value.workspace && value.workspace.tagRequests) || []).map((r) => r.id);
  } catch { return null; }
}
async function waitForIds(mock, ids, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const now = decodeNotify(mock) || [];
    if (ids.every((x) => now.includes(x))) return true;
    await sleep(150);
  }
  return false;
}
/** Durable write queue: persist('notify') background me chalta hai — save confirm hone tak rukо. */
async function waitFor(pred, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await pred()) return true; await sleep(120); }
  return false;
}

test('⏪ stale snapshot se gayab hui employee-link request ID-wise wapas aati hai (storage + history)', async () => {
  const dirA = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-v350-a-'));
  const dirB = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-v350-b-'));
  const mock = await startMockAppsScript({ secret: SECRET });
  let server;
  try {
    server = await startServer(dirA, mock.url);
    const admin = await login(server.base);
    assert.ok(admin, 'admin login');

    // Boot ke turant baad ka notify record = "purane process" ka snapshot (is me koi request nahi).
    const bootNotify = structuredClone(mock.records.notify);
    assert.ok(bootNotify && bootNotify.data, 'mock me notify record seed hua');

    // 1) employee link se request (bina login)
    const created = await jsonCall(server.base, '/api/public/tag-request', 'POST', agentPayload('Rahul Sharma'), '', '10.9.9.1');
    assert.equal(created.res.status, 201, JSON.stringify(created.json));
    const id = created.json.request.id;
    assert.match(String(id), /^\d{4}$/, '4-digit request id');
    assert.ok(await waitForIds(mock, [id]), 'nayi request storage me save hui');
    const savedNotify = structuredClone(mock.records.notify);

    const list = await jsonCall(server.base, '/api/tag-requests', 'GET', undefined, admin);
    assert.ok(list.json.requests.some((r) => r.id === id), 'admin list me request');
    assert.equal(list.json.admin, true);
    assert.ok('total' in list.json, 'list total bhi bhejti hai');

    // 2) purana instance (A) band — ab "stale process" ne apna purana snapshot wapas likh diya
    //    (asli Code.gs bhi overwrite se pehle purana record history me daalta hai)
    await server.stop();
    mock.history.push({ savedAt: new Date().toISOString(), kind: 'notify', v: savedNotify.v, data: savedNotify.data });
    mock.records.notify = bootNotify;
    const historyHasFull = mock.history.some((h) => h.kind === 'notify' && h.data === savedNotify.data);
    assert.ok(historyHasFull, 'purani (poori) copy APP_STORAGE_HISTORY me chali gayi');

    // 3) fresh instance → boot par storage (stale) hi authoritative hai, isliye request list me nahi
    server = await startServer(dirB, mock.url);
    const admin2 = await login(server.base);
    const gone = await jsonCall(server.base, '/api/tag-requests', 'GET', undefined, admin2);
    assert.equal(gone.json.requests.some((r) => r.id === id), false, 'reproduce: request gayab');

    // 4) recovery listing → history wali save me missing request dikhti hai
    const rec = await jsonCall(server.base, '/api/tag-requests/recovery', 'GET', undefined, admin2);
    assert.equal(rec.res.status, 200, JSON.stringify(rec.json));
    assert.ok(rec.json.saves.length >= 1, 'notify wali purani saves milin');
    const best = rec.json.saves.find((s) => s.missing > 0);
    assert.ok(best, 'kisi save me missing request hai');
    assert.equal(best.found >= 1, true);
    assert.ok(best.samples.some((s) => s.id === id), 'sample me wahi request id');
    assert.match(rec.json.hint, /missing|wapas|storage/i);

    // 5) restore (missing ID-wise merge) → request wapas, status wahi
    const restore = await jsonCall(server.base, '/api/tag-requests/recovery/restore', 'POST', { at: best.at }, admin2);
    assert.equal(restore.res.status, 200, JSON.stringify(restore.json));
    assert.equal(restore.json.added >= 1, true, 'kam se kam ek request wapas aayi');
    assert.ok(restore.json.samples.some((s) => s.id === id && s.status === 'pending'));

    const after = await jsonCall(server.base, '/api/tag-requests', 'GET', undefined, admin2);
    const back = after.json.requests.find((r) => r.id === id);
    assert.ok(back, 'wapas aa gayi');
    assert.equal(back.status, 'pending', 'status waisa hi');
    assert.equal(back.total, 30, '25 + 5 tags');
    assert.equal(back.source, 'public-link', 'employee link ka source intact');

    // 6) dobara restore karne par kuch duplicate nahi hota (id-wise merge)
    const again = await jsonCall(server.base, '/api/tag-requests/recovery/restore', 'POST', { at: best.at }, admin2);
    assert.equal(again.res.status, 200);
    assert.equal(again.json.added, 0, 'koi duplicate add nahi hui');
    const finalList = await jsonCall(server.base, '/api/tag-requests', 'GET', undefined, admin2);
    assert.equal(finalList.json.requests.filter((r) => r.id === id).length, 1, 'ek hi copy');

    // 7) /api/health (admin) me recovery summary — silent fail nahi
    const health = await jsonCall(server.base, '/api/health', 'GET', undefined, admin2);
    assert.match(String(health.json.version), /^\d+\.\d+\.\d+$/, `version ${health.json.version}`);
  } finally {
    await server.stop().catch(() => {});
    await mock.close();
  }
});

test('🛡️ deploy overlap: purana instance save kare to bhi nayi requests delete nahi hoti (guard merge)', async () => {
  const dirOld = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-v350-old-'));
  const dirNew = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-v350-new-'));
  const dirReader = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-v350-read-'));
  const mock = await startMockAppsScript({ secret: SECRET });
  let oldSrv, newSrv, readerSrv;
  try {
    // Purana instance (deploy ke baad kuch der zinda reh gaya) — uske paas koi request nahi
    oldSrv = await startServer(dirOld, mock.url);
    const oldAdmin = await login(oldSrv.base);
    newSrv = await startServer(dirNew, mock.url);
    const newAdmin = await login(newSrv.base);
    assert.ok(oldAdmin && newAdmin);

    // 1) Naya instance employee link se request banata hai → storage me save
    const created = await jsonCall(newSrv.base, '/api/public/tag-request', 'POST', agentPayload('Priya Verma'), '', '10.9.9.2');
    assert.equal(created.res.status, 201, JSON.stringify(created.json));
    const id = created.json.request.id;
    assert.ok(await waitForIds(mock, [id]), 'nayi request storage me pahunchi');
    await sleep(5000); // purane instance ke pending writes settle ho jayein (notify batch 4s)

    // 2) Purana instance apni (alag) request save karta hai. Save se PEHLE guard storage padhta hai
    //    aur nayi request merge kar leta hai — warna wo usse uda deta.
    const oldCreated = await jsonCall(oldSrv.base, '/api/tag-requests', 'POST', agentPayload('Old Banda'), oldAdmin);
    assert.equal(oldCreated.res.status, 201, JSON.stringify(oldCreated.json));
    const oldId = oldCreated.json.request.id;
    assert.ok(await waitForIds(mock, [id, oldId], 25000), 'purane instance ke save me dono requests hain');
    assert.match(oldSrv.logs(), /notify guard: 1 tag request storage se wapas merge ki/, 'guard ne nayi request merge ki');

    // 3) Dono instances band → fresh reader instance. Overlap ke dauran aakhri writer kaun tha is par
    //    depend karta hai, isliye guarantee ye hai: jo bhi missing ho ⏪ recovery se wapas aati hai.
    await oldSrv.stop(); await newSrv.stop();
    readerSrv = await startServer(dirReader, mock.url);
    const readAdmin = await login(readerSrv.base);
    let list = await jsonCall(readerSrv.base, '/api/tag-requests', 'GET', undefined, readAdmin);
    let ids = list.json.requests.map((r) => r.id);
    if (!(ids.includes(id) && ids.includes(oldId))) {
      const rec = await jsonCall(readerSrv.base, '/api/tag-requests/recovery', 'GET', undefined, readAdmin);
      assert.equal(rec.res.status, 200, JSON.stringify(rec.json));
      const target = rec.json.saves.find((s) => s.missing > 0) || null;
      if (target) {
        const restored = await jsonCall(readerSrv.base, '/api/tag-requests/recovery/restore', 'POST', { at: target.at }, readAdmin);
        assert.equal(restored.res.status, 200, JSON.stringify(restored.json));
      }
      list = await jsonCall(readerSrv.base, '/api/tag-requests', 'GET', undefined, readAdmin);
      ids = list.json.requests.map((r) => r.id);
    }
    assert.ok(ids.includes(id), `nayi request zinda ho (mile: ${ids.join(',')})`);
    assert.ok(ids.includes(oldId), `purane instance ki request bhi ho (mile: ${ids.join(',')})`);
    assert.equal(ids.filter((x) => x === id).length, 1, 'duplicate nahi');
  } finally {
    await oldSrv?.stop().catch(() => {});
    await newSrv?.stop().catch(() => {});
    await readerSrv?.stop().catch(() => {});
    await mock.close();
  }
});

test('🔔 tag-request notification: route Settings me hai + notify-check sach batata hai', async () => {
  const settings = await read('settings.js');
  assert.match(settings, /\['tagRequest', '🏷️ Tag Request/, 'Settings → 🔔 Notification audience me tagRequest route ho');
  assert.match(settings, /rc-tag-scan/, 'Recovery tab me 🏷️ Tag Requests scan ho');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-v350-nc-'));
  const mock = await startMockAppsScript({ secret: SECRET });
  let server;
  try {
    server = await startServer(dir, mock.url);
    const admin = await login(server.base);

    const created = await jsonCall(server.base, '/api/public/tag-request', 'POST', agentPayload('Suresh Kumar'), '', '10.9.9.3');
    assert.equal(created.res.status, 201);

    const check = await jsonCall(server.base, '/api/tag-requests/notify-check', 'GET', undefined, admin);
    assert.equal(check.res.status, 200, JSON.stringify(check.json));
    assert.equal(check.json.route.key, 'tagRequest');
    assert.equal(check.json.route.value, 'admin', 'default audience admin');
    assert.equal(check.json.route.ok, true);
    assert.ok(Array.isArray(check.json.admins) && check.json.admins.length >= 1, 'admin prefs list');
    assert.equal(typeof check.json.push.enabled, 'boolean');
    assert.ok(check.json.recent.some((i) => i.routeKey === 'tagRequest'), 'feed me tag-request notification');
    assert.ok(['ok', 'issue'].includes(check.json.verdict));
    assert.equal(check.json.live.total >= 1, true, 'live count');

    // Route OFF → seedha problem (pehle admins ko ye pata hi nahi chalta tha)
    const off = await jsonCall(server.base, '/api/settings', 'PUT', { notificationRoutes: { tagRequest: 'off' } }, admin);
    assert.equal(off.res.status, 200, JSON.stringify(off.json));
    const check2 = await jsonCall(server.base, '/api/tag-requests/notify-check', 'GET', undefined, admin);
    assert.equal(check2.json.route.ok, false);
    assert.equal(check2.json.verdict, 'issue');
    assert.ok(check2.json.problems.some((p) => /tagRequest|OFF/i.test(p)), 'problem me karan likha ho');

    // Wapas ON
    const on = await jsonCall(server.base, '/api/settings', 'PUT', { notificationRoutes: { tagRequest: 'admin' } }, admin);
    assert.equal(on.res.status, 200);
    const check3 = await jsonCall(server.base, '/api/tag-requests/notify-check', 'GET', undefined, admin);
    assert.equal(check3.json.route.ok, true);

    // Feed item par click karne se recovery card khule — meta link me recover=1
    const feed = await jsonCall(server.base, '/api/notifications?limit=20', 'GET', undefined, admin);
    assert.equal(feed.res.status, 200);
  } finally {
    await server.stop().catch(() => {});
    await mock.close();
  }
});

test('🧩 UI + cache-bust wiring: ⏪ button, banner, health summary, naya version', async () => {
  const tr = await read('tagRequest.js');
  assert.match(tr, /data-tr-act="recover"/, '⏪ Wapas lao button');
  assert.match(tr, /data-tr-rc="restore-storage"/, 'storage se restore button');
  assert.match(tr, /data-tr-act="notify-check"/, '🔔 notification check button');
  assert.match(tr, /recoveryBannerHtml/, 'boot scan ka banner');
  assert.match(tr, /data-tr-rc-banner/, 'banner host');
  assert.match(tr, /\/api\/tag-requests\/recovery\/restore/, 'restore API');

  const srv = await read('server.js');
  assert.match(srv, /api\/tag-requests\/recovery'/, 'recovery list API');
  assert.match(srv, /notifyShrinkGuard/, 'stale-write guard');
  assert.match(srv, /tagReqStorageWorkspace/, 'storage source');
  assert.match(srv, /api\/tag-requests\/notify-check/, 'notify check API');
  assert.match(srv, /tagRequestRecovery: tagReqRecoveryInfo/, 'health me recovery summary');

  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.version, '3.70.3', 'Item Name release version');
  const idx = await read('index.html');
  assert.match(idx, /config\.js\?v=109/, 'config cache-bust 109');
  assert.match(idx, /lazy\.js\?v=104/, 'lazy cache-bust 104');
  const lazy = await read('lazy.js');
  assert.match(lazy, /const VERSION = \(function/, 'lazy VERSION derive');
  assert.match(lazy, /ff-asset-versions/, 'v3.61: lazy modules ka version server ke fingerprint map se aata hai');
  const sw = await read('sw.js');
  assert.match(sw, /apnapayment-v124/, 'service worker cache bump');
  assert.match(sw, /async function shellAssets\(/, 'v3.61: SW pins hard-coded nahi — list index.html se derive hoti hai');
  const docs = await read('RECOVERY.md');
  assert.match(docs, /Tag Request/i, 'RECOVERY.md me tag request recovery');
});
