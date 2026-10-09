/* 🌐 v3.27 — Public (bina login) employee Tag Request form ka contract lock.
 *
 *   • GET  /api/public/tag-request           → config (login ke bina)
 *   • POST /api/public/tag-request           → employee name MANDATORY, rows chahiye → request ban jaati hai
 *   • GET  /api/public/tag-request/status    → employee Request ID se apna status dekh sakta hai
 *   • admin list me request 'public-link' source + employee details ke saath dikhti hai
 *   • /api/public/gviz                        → sirf scoped public form queries (login wale /api/gviz par asar nahi)
 *   • /api/public-tag-form (admin)            → link ON/OFF + fields config
 *   • sheet sync: alag sheet ka LINK diya jaye to entry usi sheet me (spreadsheetId) jaati hai
 *   • rate limit + disabled link dono handle hote hain
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'test-secret-0123456789abcdef';
const OTHER_SHEET = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const OTHER_LINK = `https://docs.google.com/spreadsheets/d/${OTHER_SHEET}/edit#gid=0`;

async function startServer(dir, mockUrl) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, STORAGE_BACKEND: 'files', PORT: '0', DATA_DIR: dir, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'initial-password', RENDER: '', APPS_SCRIPT_ALLOW_LOCAL: '1', APPS_SCRIPT_URL: mockUrl, APPS_SCRIPT_SECRET: SECRET },
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
  const base = await Promise.race([ready, new Promise((_, reject) => { const t = setTimeout(() => reject(new Error(`startup timeout: ${logs}`)), 10000); t.unref(); })]);
  return { child, base, async stop() { if (child.exitCode !== null) return; child.kill('SIGTERM'); await once(child, 'exit'); } };
}

async function jsonCall(base, route, method = 'GET', body, cookie = '', ip = '') {
  const headers = { 'Content-Type': 'application/json', cookie, 'X-Forwarded-Proto': 'https' };
  if (ip) headers['X-Forwarded-For'] = ip;
  const res = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { res, json, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rows = () => ([
  { agentId: '1001', agentName: 'Rahul Sharma', tl: 'TL One', channel: 'ff', cls: 'VC4', last: 40, cur: 25, stock: 3, cover: 1.4, priority: 'High', growth: -37.5, sugNet: 22, sugGross: 25, approved: 25, remark: 'urgent' },
  { agentId: '2002', agentName: 'Priya Verma', tl: 'TL Two', channel: 'gv', cls: 'VC6', last: 5, cur: 4, stock: 0, cover: 0, priority: 'High', growth: -20, sugNet: 4, sugGross: 4, approved: 6, remark: '' }
]);

test('public employee tag request — bina login submit, status, admin visibility, sheet target', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-pubtag-'));
  const mock = await startMockAppsScript({ secret: SECRET });
  let server;
  try {
    server = await startServer(dir, mock.url);
    const login = await jsonCall(server.base, '/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' });
    const admin = login.cookie;
    assert.ok(admin, 'admin login cookie');

    // 1) config bina login khulta hai + naam mandatory flag
    const cfg = await jsonCall(server.base, '/api/public/tag-request');
    assert.equal(cfg.res.status, 200, JSON.stringify(cfg.json));
    assert.equal(cfg.json.config.enabled, true);
    assert.equal(cfg.json.config.requireEmployeeName, true);
    assert.equal(cfg.json.config.askAddress, true, 'address/pincode by default maange jaate hain');
    assert.equal(cfg.json.config.showCheck, true);

    // 2) login-protected endpoints bina cookie band rehte hain (public whitelist sirf /api/public/* hai)
    const gatedPrivate = await jsonCall(server.base, '/api/tag-requests');
    assert.equal(gatedPrivate.res.status, 401, 'private list bina login 401');
    const gatedGviz = await jsonCall(server.base, '/api/gviz?sheet=REPORT');
    assert.equal(gatedGviz.res.status, 401, 'login wala gviz bina login 401');

    // 3) naam ke bina submit → 400 (mandatory)
    const noName = await jsonCall(server.base, '/api/public/tag-request', 'POST', { rows: rows() }, '', '10.0.0.9');
    assert.equal(noName.res.status, 400);
    assert.match(noName.json.error, /Employee name/i);

    // 4) rows/qty ke bina → 400
    const noRows = await jsonCall(server.base, '/api/public/tag-request', 'POST', { employee: { name: 'Suresh Kumar' }, rows: [] }, '', '10.0.0.9');
    assert.equal(noRows.res.status, 400);

    // 4b) 🏠 address / 📮 pincode mandatory — ek bhi khaali ho to request nahi lagti
    const noAddr = await jsonCall(server.base, '/api/public/tag-request', 'POST', { employee: { name: 'Suresh Kumar', mobile: '9876543210' }, rows: rows() }, '', '10.0.0.9');
    assert.equal(noAddr.res.status, 400);
    assert.match(noAddr.json.error, /address/i);
    const badPin = await jsonCall(server.base, '/api/public/tag-request', 'POST', { employee: { name: 'Suresh Kumar', mobile: '9876543210', address: '24, Shanti Nagar, Sodala, Jaipur', pincode: '3020' }, rows: rows() }, '', '10.0.0.9');
    assert.equal(badPin.res.status, 400);
    assert.match(badPin.json.error, /pincode/i);
    const noMobile = await jsonCall(server.base, '/api/public/tag-request', 'POST', { employee: { name: 'Suresh Kumar', address: '24, Shanti Nagar, Sodala, Jaipur', pincode: '302019' }, rows: rows() }, '', '10.0.0.9');
    assert.equal(noMobile.res.status, 400);
    assert.match(noMobile.json.error, /mobile/i);

    // 5) valid submit (bina login) → 201 + request ID
    const created = await jsonCall(server.base, '/api/public/tag-request', 'POST', {
      employee: { name: 'Suresh Kumar', mobile: '9876543210', office: 'Jaipur', address: '24, Shanti Nagar, Sodala, Jaipur', pincode: '302019' },
      note: 'kal dispatch chahiye', rows: rows(),
      tls: [{ name: 'TL One', channel: 'ff', stockVc4: 12, curVc4: 60, lastVc4: 80, priority: 'High', reqApproved: 25, agents: 1, sugNet: 22, sugGross: 25, cover: 1.4 }]
    }, '', '10.0.0.9');
    assert.equal(created.res.status, 201, JSON.stringify(created.json));
    const id = created.json.request.id;
    assert.ok(id && /^\d{4}$/.test(id), '4-digit numeric request id mila');
    assert.equal(created.json.request.total, 31, '25 + 6');
    assert.equal(created.json.request.byName, 'Suresh Kumar');

    // 5b) 🔁 duplicate check — same naam + same agent×class par warning, alag row par nahi
    const mid = await jsonCall(server.base, '/api/public/tag-request/check', 'POST', { employee: { name: 'Suresh Kumar' }, rows: rows() }, '', '10.0.0.9');
    assert.equal(mid.res.status, 200, JSON.stringify(mid.json));
    assert.equal(mid.json.duplicates.length, 1, 'same naam + same rows par duplicate mila');
    assert.equal(mid.json.duplicates[0].id, id);
    assert.equal(mid.json.duplicates[0].status, 'pending');
    const noDup = await jsonCall(server.base, '/api/public/tag-request/check', 'POST', { employee: { name: 'Koi Naya Banda' }, rows: rows() }, '', '10.0.0.10');
    assert.equal(noDup.json.duplicates.length, 0, 'naya naam → koi duplicate nahi');
    const otherRows = await jsonCall(server.base, '/api/public/tag-request/check', 'POST', { employee: { name: 'Suresh Kumar' }, rows: [{ agentId: '9999', cls: 'VC16', approved: 5 }] }, '', '10.0.0.9');
    assert.equal(otherRows.json.duplicates.length, 0, 'alag agent/class → duplicate nahi');
    // "Phir bhi bhejo" (force) → 201 + warnings + admin list me 🔁 mark
    const again = await jsonCall(server.base, '/api/public/tag-request', 'POST', { employee: { name: 'Suresh Kumar', mobile: '9876543210', address: '24, Shanti Nagar, Sodala, Jaipur', pincode: '302019' }, rows: rows(), note: 'dobara bheji' }, '', '10.0.0.9');
    assert.equal(again.res.status, 201, JSON.stringify(again.json));
    assert.equal(again.json.request.duplicates, 1);
    assert.ok(Array.isArray(again.json.warnings) && again.json.warnings[0].code === 'duplicate');
    const listDup = await jsonCall(server.base, '/api/tag-requests', 'GET', undefined, admin);
    const dupRow = listDup.json.requests.find((r) => r.id === again.json.request.id);
    assert.ok(dupRow && dupRow.dupOf && dupRow.dupOf.includes(id), 'admin list me dupOf mark');

    // 6) employee apna status ID se dekh sakta hai (koi login nahi)
    const status = await jsonCall(server.base, `/api/public/tag-request/status?id=${encodeURIComponent(id)}`);
    assert.equal(status.res.status, 200, JSON.stringify(status.json));
    assert.equal(status.json.request.status, 'pending');
    assert.equal(status.json.request.byName, 'Suresh Kumar');
    assert.equal(status.json.request.employee.pincode, '302019', 'status me employee ka pincode');
    const badId = await jsonCall(server.base, '/api/public/tag-request/status?id=nope');
    assert.equal(badId.res.status, 404);

    // 7) admin ki list me employee-link request dikhti hai (source + employee info)
    const list = await jsonCall(server.base, '/api/tag-requests', 'GET', undefined, admin);
    assert.equal(list.res.status, 200);
    const found = list.json.requests.find((r) => r.id === id);
    assert.ok(found, 'admin list me public request mili');
    assert.equal(found.source, 'public-link');
    assert.equal(found.byName, 'Suresh Kumar');
    assert.equal(found.employee.mobile, '9876543210');
    assert.equal(found.employee.office, 'Jaipur');
    assert.equal(found.employee.address, '24, Shanti Nagar, Sodala, Jaipur', 'full address save hua');
    assert.equal(found.employee.pincode, '302019', 'pincode save hua');
    assert.equal(found.rows[0].approved, 25);

    // 7b) 🔔 admin ko notification milti hai (bell list + push fanout dono ka source)
    const notes = await jsonCall(server.base, '/api/notifications', 'GET', undefined, admin);
    const item = ((notes.json && notes.json.items) || []).find((n) => n.type === 'request' && n.meta && n.meta.requestId === id);
    assert.ok(item, 'admin ke bell me tag request notification aayi');
    assert.equal(item.audience, 'admin');
    assert.equal(item.routeKey, 'tagRequest');
    const dupNote = ((notes.json && notes.json.items) || []).find((n) => n.meta && n.meta.requestId === again.json.request.id);
    assert.ok(dupNote && /🔁/.test(dupNote.title) && dupNote.meta.duplicates === 1, 'duplicate notification 🔁 mark ke saath');

    // 8) admin status badalta hai → employee ko naya status dikhta hai
    const upd = await jsonCall(server.base, `/api/tag-requests/${encodeURIComponent(id)}`, 'PUT', { status: 'approved', adminNote: 'kal dispatch' }, admin);
    assert.equal(upd.res.status, 200, JSON.stringify(upd.json));
    const status2 = await jsonCall(server.base, `/api/public/tag-request/status?id=${encodeURIComponent(id)}`);
    assert.equal(status2.json.request.status, 'approved');
    assert.equal(status2.json.request.adminNote, 'kal dispatch');

    // 9) sheet sync — ALAG sheet ka link diya → entry usi sheet me (spreadsheetId) jaati hai
    const put = await jsonCall(server.base, '/api/tag-request-sheet', 'PUT', {
      config: { enabled: true, tab: 'Tag Dispatch', sheetLink: OTHER_LINK, onSubmit: true, onStatus: false, rowMode: 'class', columns: ['date', 'by', 'empName', 'empMobile', 'empAddress', 'empPincode', 'agent', 'cls', 'approved'] }
    }, admin);
    assert.equal(put.res.status, 200, JSON.stringify(put.json));
    assert.equal(put.json.targetId, OTHER_SHEET, 'link se sheet ID nikal aayi');
    assert.equal(put.json.config.spreadsheetId, OTHER_SHEET);

    const badLink = await jsonCall(server.base, '/api/tag-request-sheet', 'PUT', { config: { sheetLink: 'garbage-link' } }, admin);
    assert.equal(badLink.res.status, 400, 'galat link reject');

    const test = await jsonCall(server.base, '/api/tag-request-sheet/test', 'POST', { sheetLink: OTHER_LINK, tab: 'Tag Dispatch' }, admin);
    assert.equal(test.res.status, 200, JSON.stringify(test.json));
    assert.equal(test.json.targetSpreadsheetId, OTHER_SHEET);
    assert.equal(test.json.codeVersion, 'v3.27', 'naya Code.gs (sheettest) detect hua');

    const created2 = await jsonCall(server.base, '/api/public/tag-request', 'POST', { employee: { name: 'Neha Gupta', mobile: '9812300011', address: '5, MG Road, Jaipur', pincode: '302001' }, rows: rows() }, '', '10.0.0.11');
    assert.equal(created2.res.status, 201, JSON.stringify(created2.json));
    await sleep(600);
    assert.equal(mock.appends.length, 0, 'Pending public request must not append to Google Sheet');
    const approval = await jsonCall(server.base, '/api/tag-requests/' + encodeURIComponent(created2.json.request.id), 'PUT', { status: 'approved' }, admin);
    assert.equal(approval.res.status, 200, JSON.stringify(approval.json));
    await sleep(1500);
    const appended = mock.appends.find((t) => t.tab === 'Tag Dispatch');
    assert.ok(appended, `approval ke baad sheet append hua — got ${JSON.stringify(mock.appends.map((t) => t.tab))}`);
    assert.equal(appended.spreadsheetId, OTHER_SHEET, 'entry alag sheet (link wale ID) me gayi');
    assert.deepEqual(appended.header, ['Date', 'By', 'Employee', 'Employee mobile', 'Employee address', 'Pincode', 'Agent', 'Tag Class', 'Approved qty'], 'employee ki delivery details bhi sheet me jaati hain');
    assert.equal(appended.rows.length, 2);
    assert.equal(appended.rows[0][1], 'Neha Gupta', 'sheet me employee ka naam');
    assert.equal(appended.rows[0][3], '9812300011', 'sheet me employee ka mobile');
    assert.equal(appended.rows[0][4], '5, MG Road, Jaipur', 'sheet me employee ka address');
    assert.equal(appended.rows[0][5], '302001', 'sheet me pincode');

    // 10) public gviz — sirf scoped queries (login wale /api/gviz par koi asar nahi)
    const eirRaw = await jsonCall(server.base, '/api/public/gviz?sheet=EIR&tq=select%20A%2C%20B');
    assert.equal(eirRaw.res.status, 403, 'EIR (customer ledger) par poori row query allowed nahi');
    const eirNoQuery = await jsonCall(server.base, '/api/public/gviz?sheet=EIR');
    assert.equal(eirNoQuery.res.status, 403, 'EIR par khaali query bhi allowed nahi');
    const unknownTab = await jsonCall(server.base, '/api/public/gviz?sheet=SecretTab');
    assert.equal(unknownTab.res.status, 403, 'registry me na ho to allowed nahi');
    const foreignId = await jsonCall(server.base, '/api/public/gviz?sheet=REPORT&id=1SomeOtherSheetId1234567890');
    assert.equal(foreignId.res.status, 403, 'doosri sheet ka ID allowed nahi');
    const eirGrouped = await jsonCall(server.base, '/api/public/gviz?sheet=EIR&tq=select%20D%2C%20count(A)%20group%20by%20D');
    assert.ok([200, 502].includes(eirGrouped.res.status), `aggregated EIR query allowed hai (got ${eirGrouped.res.status})`);
    const gvizLoginStillGated = await jsonCall(server.base, '/api/gviz?sheet=REPORT');
    assert.equal(gvizLoginStillGated.res.status, 401, 'login wala gviz bina login band hi hai');

    // 11) admin public form config → link OFF karne par submit band
    // 8) 🖨️ Dispatch label ka FROM (company address) — Settings me save/reload hota hai
    const fromSet = await jsonCall(server.base, '/api/settings', 'PUT', { settings: { contacts: { fromName: 'Apna Payment Pvt Ltd', fromAddress: 'Plot 12, RIICO Industrial Area, Jaipur, Rajasthan — 302006', fromPhone: '+91 141 400 0000' } } }, admin);
    assert.equal(fromSet.res.status, 200, JSON.stringify(fromSet.json));
    const setGet = await jsonCall(server.base, '/api/settings', 'GET', undefined, admin);
    const cont = (setGet.json.settings && setGet.json.settings.contacts) || {};
    assert.equal(cont.fromName, 'Apna Payment Pvt Ltd', 'FROM company naam save nahi hua');
    assert.match(cont.fromAddress || '', /RIICO Industrial Area/);
    assert.equal(cont.fromPhone, '+91 141 400 0000');

    const addrOff = await jsonCall(server.base, '/api/public-tag-form', 'PUT', { config: { askAddress: false } }, admin);
    assert.equal(addrOff.json.config.askAddress, false, 'admin address/pincode off kar sakta hai');
    const noAddrNow = await jsonCall(server.base, '/api/public/tag-request', 'POST', { employee: { name: 'Bina Address', mobile: '9876500000' }, rows: rows() }, '', '10.0.0.13');
    assert.equal(noAddrNow.res.status, 201, 'askAddress OFF → address ke bina bhi request lag jaati hai');
    await jsonCall(server.base, '/api/public-tag-form', 'PUT', { config: { askAddress: true } }, admin);
    const pubOff = await jsonCall(server.base, '/api/public-tag-form', 'PUT', { config: { enabled: false, askOffice: true } }, admin);
    assert.equal(pubOff.res.status, 200, JSON.stringify(pubOff.json));
    assert.equal(pubOff.json.config.enabled, false);
    assert.equal(pubOff.json.config.askOffice, true);
    const blocked = await jsonCall(server.base, '/api/public/tag-request', 'POST', { employee: { name: 'Test User', mobile: '9800000001', address: '2, Test Street, Bikaner', pincode: '334001' }, rows: rows() }, '', '10.0.0.12');
    assert.equal(blocked.res.status, 403);
    const cfgOff = await jsonCall(server.base, '/api/public/tag-request');
    assert.equal(cfgOff.json.config.enabled, false);

    // 12) rate limit — 15/hour per IP
    await jsonCall(server.base, '/api/public-tag-form', 'PUT', { config: { enabled: true } }, admin);
    let last = null;
    for (let i = 0; i < 18; i++) {
      last = await jsonCall(server.base, '/api/public/tag-request', 'POST', { employee: { name: `Bulk ${i}`, mobile: '9800000000', address: '1, Test Street, Bikaner', pincode: '334001' }, rows: rows() }, '', '10.9.9.9');
      if (last.res.status === 429) break;
    }
    assert.equal(last.res.status, 429, 'ek hi IP se bahut requests par throttle');
  } finally {
    if (server) await server.stop();
    await mock.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

/* 👤 v3.57 — employee link: employee apni requests KHUD dekh sake + 📇 purana address suggest ho.
 *
 *   • GET /api/public/tag-request/employee-status — employee link ke 📝 Form tab par "👤 Meri requests"
 *     panel isi se data leta hai: All / Pending / Approved / Dispatched / Rejected counts + nayi-pehle
 *     request list (panel 10-10 ke page me dikhata hai).
 *   • GET /api/public/tag-request/contact — wahi agent dobara chuno to purana address mil jaaye
 *     (server-side Address book; sirf browser localStorage nahi, isliye doosre device par bhi chalta hai).
 *   • Shared employee link: employee-status me employee/agent ka address-pincode nahi jaata, aur same public
 *     employee link se bani sabhi requests har visitor ko dikhengi (token sirf backwards compatibility hai).
 */
test('👤 employee-status — apni requests + counts, admin approve par status badalta hai, 📇 purana address milta hai', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-empst-'));
  const mock = await startMockAppsScript({ secret: SECRET });
  let server;
  try {
    server = await startServer(dir, mock.url);
    const login = await jsonCall(server.base, '/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' });
    const admin = login.cookie;
    assert.ok(admin, 'admin login cookie');

    const emp = { name: 'Ramesh Yadav', mobile: '9876543210', address: '24, Shanti Nagar, Sodala, Jaipur', pincode: '302019' };
    // Form jo shape bhejta hai wahi — har agent ka apna mobile/address/pincode + class-wise rows.
    const rahul = { agentId: '1001', agentName: 'Rahul Sharma', tl: 'TL One', channel: 'ff', mobile: '9876500001', address: '12, Gandhi Nagar, Tonk Road, Jaipur', pincode: '302015', rows: [{ cls: 'VC4', approved: 25, stock: 3, last: 40, cur: 25 }] };
    const first = await jsonCall(server.base, '/api/public/tag-request', 'POST', { employee: emp, agents: [rahul] }, '', '10.7.7.7');
    assert.equal(first.res.status, 201, JSON.stringify(first.json));
    const token = first.json.employeeToken || (first.json.request && first.json.request.employeeToken);
    assert.ok(/^[A-Za-z0-9_-]{24,120}$/.test(String(token || '')), 'submit par employee token milta hai (device par save hota hai)');
    const firstId = first.json.request.id;

    // 1) employee apni request khud dekhta hai — Status tab kholne ki zaroorat nahi
    const one = await jsonCall(server.base, '/api/public/tag-request/employee-status?token=' + encodeURIComponent(token));
    assert.equal(one.res.status, 200, JSON.stringify(one.json));
    assert.equal(one.json.totalRequests, 1, 'ek request lagayi → ek hi dikhti hai');
    assert.equal(one.json.pending, 1);
    assert.equal(one.json.approved, 0);
    assert.equal(one.json.dispatched, 0);
    assert.equal(one.json.rejected, 0);
    assert.equal(one.json.requestedTags, 25);
    assert.equal(one.json.approvedTags, 0, 'admin ne abhi approve nahi kiya → approved tags 0 (pehle yahan 25 dikhta tha)');
    assert.equal(one.json.requests.length, 1);
    assert.equal(one.json.requests[0].agentName, 'Rahul Sharma', 'agent ka naam employee ko dikhta hai');
    assert.equal(one.json.requests[0].classes[0].cls, 'VC4');

    // privacy — address/pincode employee-status response me nahi jaate
    const body = JSON.stringify(one.json);
    assert.ok(!body.includes('Shanti Nagar'), 'employee ka address response me nahi jaata');
    assert.ok(!body.includes('302019'), 'employee ka pincode response me nahi jaata');
    assert.ok(!body.includes('Gandhi Nagar'), 'agent ka address bhi nahi jaata');

    // 2) ek aur request → counts badhte hain (panel me "All" isi ko dikhata hai)
    const second = await jsonCall(server.base, '/api/public/tag-request', 'POST', { employee: emp, employeeToken: token, agents: [{ agentId: '2002', agentName: 'Priya Verma', tl: 'TL Two', channel: 'gv', mobile: '9876500002', address: '7, Malviya Nagar, Jaipur', pincode: '302017', rows: [{ cls: 'VC6', approved: 6 }] }] }, '', '10.7.7.8');
    assert.equal(second.res.status, 201, JSON.stringify(second.json));
    const two = await jsonCall(server.base, '/api/public/tag-request/employee-status?token=' + encodeURIComponent(token));
    assert.equal(two.json.totalRequests, 2, 'doosri request bhi isi token par jud gayi');
    assert.equal(two.json.pending, 2);
    assert.equal(two.json.requestedTags, 31, '25 + 6');
    assert.equal(two.json.requests[0].agentName, 'Priya Verma', 'nayi request sabse upar (panel isi order me dikhata hai)');

    // 3) admin approve karta hai → employee ke panel me status turant Approved me chala jaata hai
    const approved = await jsonCall(server.base, `/api/tag-requests/${firstId}`, 'PUT', { status: 'approved' }, admin);
    assert.equal(approved.res.status, 200, JSON.stringify(approved.json));
    const three = await jsonCall(server.base, '/api/public/tag-request/employee-status?token=' + encodeURIComponent(token));
    assert.equal(three.json.approved, 1, 'approve hui request Approved count me');
    assert.equal(three.json.pending, 1, 'baaki abhi pending');
    assert.equal(three.json.totalRequests, 2);
    assert.equal(three.json.approvedTags, 25, 'approved tags ka total');

    // 4) 📇 wahi agent dobara → purana address server se mil jaata hai (doosre device par bhi)
    const contact = await jsonCall(server.base, '/api/public/tag-request/contact?agentId=1001&agentName=Rahul%20Sharma&channel=ff');
    assert.equal(contact.res.status, 200, JSON.stringify(contact.json));
    assert.equal(contact.json.found, true, 'pichli request ka contact mila');
    assert.equal(contact.json.contact.address, '12, Gandhi Nagar, Tonk Road, Jaipur', 'purana address suggest hota hai');
    assert.equal(contact.json.contact.pincode, '302015');
    assert.ok(contact.json.contact.lastRequestAt, 'last public request date is returned with contact suggestion');
    assert.equal(contact.json.contact.lastRequestAt, first.json.request.at, 'lastRequestAt points to the latest matching request');

    // 5) doosre employee ka request — same shared Employee Link par sabko dikhna chahiye.
    const other = await jsonCall(server.base, '/api/public/tag-request', 'POST', { employee: { name: 'Koi Doosra', mobile: '9800001111', address: '9, Other Nagar, Jaipur', pincode: '302020' }, agents: [{ agentId: '3003', agentName: 'Anil Kumar', channel: 'ff', mobile: '9800002222', address: '3, Another Nagar, Jaipur', pincode: '302021', rows: [{ cls: 'VC5', approved: 4 }] }] }, '', '10.7.7.9');
    assert.equal(other.res.status, 201, JSON.stringify(other.json));
    const otherToken = other.json.employeeToken || (other.json.request && other.json.request.employeeToken);
    assert.ok(otherToken && otherToken !== token, 'doosre employee ka legacy token alag reh sakta hai');
    const sharedFromFirstToken = await jsonCall(server.base, '/api/public/tag-request/employee-status?token=' + encodeURIComponent(token));
    assert.equal(sharedFromFirstToken.json.totalRequests, 3, 'same link ki sabhi public requests ek saath dikhni chahiye');
    assert.ok(sharedFromFirstToken.json.requests.some((x) => x.employeeName === 'Koi Doosra'), 'doosre employee ki request bhi dikhe');
    assert.ok(sharedFromFirstToken.json.requests.some((x) => x.agentName === 'Anil Kumar'), 'doosre employee ka agent bhi dikhe');
    const sharedFromOtherToken = await jsonCall(server.base, '/api/public/tag-request/employee-status?token=' + encodeURIComponent(otherToken));
    assert.equal(sharedFromOtherToken.json.totalRequests, 3, 'token badalne par bhi shared list wahi rahe');
    assert.equal(sharedFromOtherToken.json.requests[0].employeeName, 'Koi Doosra', 'nayi request sabse upar');

    // 6) token optional — naya device/browser bina token ke bhi shared list dekh sakta hai.
    const noToken = await jsonCall(server.base, '/api/public/tag-request/employee-status');
    assert.equal(noToken.res.status, 200, JSON.stringify(noToken.json));
    assert.equal(noToken.json.totalRequests, 3, 'bina token bhi same shared list');
    assert.equal(noToken.json.shared, true);
  } finally {
    if (server) await server.stop();
    await mock.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('public Tag Request live share — opt-in, admin-only preview, request association and revocation', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-public-live-'));
  const mock = await startMockAppsScript({ secret: SECRET });
  let server;
  try {
    server = await startServer(dir, mock.url);
    const login = await jsonCall(server.base, '/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' });
    const admin = login.cookie;
    assert.ok(admin, 'admin login cookie');

    const missingConsent = await jsonCall(server.base, '/api/public/live-presence/start', 'POST', { consent: false }, '', '10.2.0.1');
    assert.equal(missingConsent.res.status, 400, 'live-share opt-in mandatory');
    const privateList = await jsonCall(server.base, '/api/public/live-presence');
    assert.equal(privateList.res.status, 403, 'public visitors cannot list live sessions');

    const started = await jsonCall(server.base, '/api/public/live-presence/start', 'POST', { consent: true }, '', '10.2.0.1');
    assert.equal(started.res.status, 201, JSON.stringify(started.json));
    const { sessionId, token } = started.json;
    assert.ok(sessionId && token, 'session ID + private token issued');
    assert.ok(!JSON.stringify(started.json.person).includes(token), 'preview data must not leak the token');

    const pulse = await jsonCall(server.base, '/api/public/live-presence', 'POST', {
      sessionId, token, page: 'tag-request', visible: true, engaged: true,
      pointer: { x: 18, y: 42 }, viewport: { w: 390, h: 844 }, scroll: { y: 140, h: 1800 },
      events: [{ kind: 'focus', label: 'Form field: Employee name' }, { kind: 'click', label: 'Submit request' }]
    }, '', '10.2.0.1');
    assert.equal(pulse.res.status, 200, JSON.stringify(pulse.json));

    const submit = await jsonCall(server.base, '/api/public/tag-request', 'POST', {
      employee: { name: 'Live Share Employee', mobile: '9876501122', address: '9, Live Share Road, Jaipur', pincode: '302019' },
      agents: [{ agentId: '1001', agentName: 'Rahul Sharma', channel: 'ff', mobile: '9876501123', address: '12, Gandhi Nagar, Jaipur', pincode: '302015', rows: [{ cls: 'VC4', approved: 5 }] }],
      liveShare: { sessionId, token }
    }, '', '10.2.0.1');
    assert.equal(submit.res.status, 201, JSON.stringify(submit.json));

    const list = await jsonCall(server.base, '/api/public/live-presence', 'GET', undefined, admin);
    assert.equal(list.res.status, 200, JSON.stringify(list.json));
    const item = list.json.sessions.find((x) => x.sessionId === sessionId);
    assert.ok(item, 'opted-in public session shown to admin');
    assert.equal(item.name, 'Live Share Employee', 'employee name linked only after form submit');
    assert.deepEqual(item.requestIds, [String(submit.json.request.id)]);
    assert.ok(item.lastEvent && /submitted/i.test(item.lastEvent.label));
    assert.ok(!JSON.stringify(list.json).includes(token), 'admin list excludes private session tokens');

    const detail = await jsonCall(server.base, '/api/public/live-presence?sessionId=' + encodeURIComponent(sessionId), 'GET', undefined, admin);
    assert.equal(detail.res.status, 200);
    assert.equal(detail.json.person.pointer.x, 18);
    assert.equal(detail.json.person.events.some((x) => x.label === 'Form field: Employee name'), true);
    assert.ok(!JSON.stringify(detail.json).includes(token), 'session detail excludes private session token');

    const wrongStop = await jsonCall(server.base, '/api/public/live-presence/stop', 'POST', { sessionId, token: 'incorrect-token' });
    assert.equal(wrongStop.res.status, 200);
    const stillThere = await jsonCall(server.base, '/api/public/live-presence?sessionId=' + encodeURIComponent(sessionId), 'GET', undefined, admin);
    assert.ok(stillThere.json.person, 'wrong token cannot revoke session');

    const stopped = await jsonCall(server.base, '/api/public/live-presence/stop', 'POST', { sessionId, token });
    assert.equal(stopped.res.status, 200);
    const gone = await jsonCall(server.base, '/api/public/live-presence?sessionId=' + encodeURIComponent(sessionId), 'GET', undefined, admin);
    assert.equal(gone.json.person, null, 'employee can end live share and revoke admin preview');
  } finally {
    if (server) await server.stop();
    await mock.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
