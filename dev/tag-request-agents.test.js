/* 🧑‍🤝‍🧑 v3.30 — Tag Request: har AGENT ki alag request (employee link + login form) ka contract lock.
 *
 *   • Form = upar employee (office wala) + neeche har agent ka block: naam · mobile · full address ·
 *     pincode · class-wise qty. POST { employee, agents: [...] } → har agent ki ALAG request (batch ID).
 *   • Validation agent-wise (mobile 10 digit, address ≥ 8, pincode 6 digit — form config ke hisaab se).
 *   • 🔎 Public status: agent ke MOBILE se search (address/IP kabhi nahi jaata) + ID wala raasta.
 *   • 🔁 Duplicate agent-wise — doosra employee wahi agent + class daale to bhi warning.
 *   • ✏️ Admin table row me class-wise edit (classQty) — original `requested` safe, nayi class jud sakti hai.
 *   • 📗 Sheet: ek submit = ek appendrows call (order bana rahe) + agent mobile/address/pincode columns.
 *   • Purana rows[] payload pehle jaisa ek request (purane cached client) — alag tests me lock hai.
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

const rahul = (patch) => ({
  agentId: '1001', agentName: 'Rahul Sharma', tl: 'TL One', channel: 'ff',
  mobile: '9876500001', address: '12, Gandhi Nagar, Tonk Road, Jaipur', pincode: '302015',
  metrics: { core: { stock: 14, last: 60, cur: 22 }, comm: { stock: 3, last: 9, cur: 4 }, days: 9, ym: '2026-10' },
  rows: [{ cls: 'VC4', requested: 25, approved: 25, last: 40, cur: 18, stock: 12 }, { cls: 'VC5', requested: 5, approved: 5 }],
  ...(patch || {})
});
const priya = (patch) => ({
  agentId: '2002', agentName: 'Priya Verma', tl: 'TL Two', channel: 'gv',
  mobile: '+91 98765 00002', address: '7, Station Road, Ajmer', pincode: '305001',
  rows: [{ cls: 'VC6', approved: 6 }],
  ...(patch || {})
});

test('v3.30 per-agent tag requests — split, validation, mobile status, duplicates, inline class edit, sheet', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-tagagents-'));
  const mock = await startMockAppsScript({ secret: SECRET });
  let server;
  try {
    server = await startServer(dir, mock.url);
    const admin = (await jsonCall(server.base, '/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' })).cookie;
    // sheet sync ON (agent delivery columns ke saath) — batch = ek appendrows call
    const sheetPut = await jsonCall(server.base, '/api/tag-request-sheet', 'PUT', {
      config: { enabled: true, tab: 'Agent Requests', onSubmit: true, onStatus: false, rowMode: 'class', columns: ['empName', 'agent', 'agentMobile', 'agentAddress', 'agentPincode', 'cls', 'requested', 'approved'] }
    }, admin);
    assert.equal(sheetPut.res.status, 200, JSON.stringify(sheetPut.json));
    const sheetGet = await jsonCall(server.base, '/api/tag-request-sheet', 'GET', undefined, admin);
    assert.ok(sheetGet.json.fields.agentMobile && sheetGet.json.fields.agentAddress && sheetGet.json.fields.agentPincode, 'naye agent columns fields list me');
    const appendCallsBefore = mock.calls.filter((c) => c.action === 'appendrows').length;
    // Pehle se empty lookup cache karo — nayi agent request ke baad contact cache ko turant refresh hona chahiye.
    const oldContact = await jsonCall(server.base, '/api/public/tag-request/contact?agentId=1001&agentName=Rahul%20Sharma&channel=ff');
    assert.equal(oldContact.json.found, false);

    // 1) validation — agent-wise messages
    const noEmp = await jsonCall(server.base, '/api/public/tag-request', 'POST', { employee: { name: 'R' }, agents: [rahul()] }, '', '10.1.0.1');
    assert.equal(noEmp.res.status, 400, 'employee name zaroori');
    const noMob = await jsonCall(server.base, '/api/public/tag-request', 'POST', { employee: { name: 'Ramesh Yadav' }, agents: [rahul({ mobile: '98765' })] }, '', '10.1.0.1');
    assert.equal(noMob.res.status, 400);
    assert.match(noMob.json.error, /Rahul Sharma.*mobile/i, 'error me agent ka naam + mobile');
    const noAddr = await jsonCall(server.base, '/api/public/tag-request', 'POST', { employee: { name: 'Ramesh Yadav' }, agents: [rahul(), priya({ address: 'Ajmer' })] }, '', '10.1.0.1');
    assert.equal(noAddr.res.status, 400);
    assert.match(noAddr.json.error, /Priya Verma.*address/i);
    const badPin = await jsonCall(server.base, '/api/public/tag-request', 'POST', { employee: { name: 'Ramesh Yadav' }, agents: [rahul({ pincode: '30201' })] }, '', '10.1.0.1');
    assert.equal(badPin.res.status, 400);
    assert.match(badPin.json.error, /pincode/i);
    const noQty = await jsonCall(server.base, '/api/public/tag-request', 'POST', { employee: { name: 'Ramesh Yadav' }, agents: [rahul({ rows: [{ cls: 'VC4', approved: 0 }] })] }, '', '10.1.0.1');
    assert.equal(noQty.res.status, 400);
    assert.match(noQty.json.error, /qty/i);

    // 2) public submit — 2 agents → 2 alag requests (ek batch), agent ka contact har request me
    const created = await jsonCall(server.base, '/api/public/tag-request', 'POST', {
      employee: { name: 'Ramesh Yadav', office: 'Jaipur office' }, note: 'agent ne phone par maanga', agents: [rahul(), priya(), { agentName: '', mobile: '', rows: [] }]
    }, '', '10.1.0.2');
    assert.equal(created.res.status, 201, JSON.stringify(created.json));
    assert.equal(created.json.requests.length, 2, 'khaali block skip, har agent ki alag request');
    assert.equal(created.json.batch.total, 36, '25 + 5 + 6');
    assert.equal(created.json.batch.agents, 2);
    const [rq1, rq2] = created.json.requests;
    assert.equal(rq1.agentName, 'Rahul Sharma'); assert.equal(rq1.total, 30); assert.equal(rq1.mobile, '9876500001');
    assert.equal(rq2.agentName, 'Priya Verma'); assert.equal(rq2.total, 6); assert.equal(rq2.pincode, '305001');
    assert.equal(created.json.request.id, rq1.id, 'request = pehla agent (purane client ke liye)');
    assert.notEqual(rq1.id, rq2.id);
    const employeeToken = created.json.employeeToken;
    assert.match(employeeToken, /^[A-Za-z0-9_-]{24,120}$/, 'employee status ke liye private token mila');

    // 🌐 Employee apne token se apni saari requests/status dekhe — address aur IP public summary me nahi.
    const employeeStatus = await jsonCall(server.base, `/api/public/tag-request/employee-status?token=${encodeURIComponent(employeeToken)}`);
    assert.equal(employeeStatus.res.status, 200, JSON.stringify(employeeStatus.json));
    assert.equal(employeeStatus.json.totalRequests, 2);
    assert.equal(employeeStatus.json.pending, 2);
    assert.equal(employeeStatus.json.requestedTags, 36);
    assert.equal(employeeStatus.json.requests.length, 2);
    assert.ok(employeeStatus.json.requests.some((r) => r.agentName === 'Rahul Sharma'));
    assert.ok(!JSON.stringify(employeeStatus.json).includes('Gandhi Nagar'), 'employee summary me address expose nahi hota');
    assert.ok(!JSON.stringify(employeeStatus.json).includes('10.1.0.2'), 'employee summary me submitter IP expose nahi hota');
    const otherEmployeeStatus = await jsonCall(server.base, `/api/public/tag-request/employee-status?token=${'x'.repeat(32)}`);
    assert.equal(otherEmployeeStatus.json.totalRequests, 0, 'doosre employee ka token alag history deta hai');

    // 📇 Request submit hone ke turant baad purana mobile/address public lookup se suggest ho.
    const savedContact = await jsonCall(server.base, '/api/public/tag-request/contact?agentId=1001&agentName=Rahul%20Sharma&channel=ff');
    assert.equal(savedContact.json.found, true);
    assert.equal(savedContact.json.contact.address, '12, Gandhi Nagar, Tonk Road, Jaipur');
    assert.equal(savedContact.json.contact.pincode, '302015');

    // 📗 Pending submit must not append rows; only each admin approval syncs its request.
    await sleep(500);
    assert.equal(mock.calls.filter((c) => c.action === 'appendrows').length - appendCallsBefore, 0, 'Pending public submit → no Tag Requests appendrows');
    await jsonCall(server.base, `/api/tag-requests/${encodeURIComponent(rq1.id)}`, 'PUT', { status: 'approved' }, admin);
    await jsonCall(server.base, `/api/tag-requests/${encodeURIComponent(rq2.id)}`, 'PUT', { status: 'approved' }, admin);
    await sleep(1400);
    const tab = mock.appends.find((t) => t.tab === 'Agent Requests');
    assert.ok(tab, 'sheet tab approval ke baad bana');
    assert.equal(mock.calls.filter((c) => c.action === 'appendrows').length - appendCallsBefore, 2, 'har approved agent request ki ek appendrows call');
    assert.deepEqual(tab.header, ['Employee', 'Agent', 'Agent mobile', 'Agent address', 'Agent pincode', 'Tag Class', 'Requested qty', 'Approved qty']);
    assert.equal(tab.rows.length, 3, 'Rahul VC4 + VC5, Priya VC6');
    assert.deepEqual(tab.rows[0], ['Ramesh Yadav', 'Rahul Sharma', '9876500001', '12, Gandhi Nagar, Tonk Road, Jaipur', '302015', 'VC4', 25, 25]);
    assert.equal(tab.rows[2][1], 'Priya Verma');
    assert.equal(tab.rows[2][4], '305001');

    // 3) admin list — per-agent rows + batch + metrics snapshot + employee
    const list = await jsonCall(server.base, '/api/tag-requests', 'GET', undefined, admin);
    const a1 = list.json.requests.find((r) => r.id === rq1.id);
    const a2 = list.json.requests.find((r) => r.id === rq2.id);
    assert.ok(a1 && a2, 'dono requests admin list me');
    assert.equal(a1.batch, a2.batch, 'ek submit = ek batch');
    assert.equal(a1.source, 'public-link');
    assert.equal(a1.employee.name, 'Ramesh Yadav');
    assert.equal(a1.employee.office, 'Jaipur office');
    assert.equal(a1.agent.address, '12, Gandhi Nagar, Tonk Road, Jaipur');
    assert.equal(a1.agent.tl, 'TL One');
    assert.deepEqual(a1.metrics.core, { stock: 14, last: 60, cur: 22 }, 'submit ke waqt ka 🚗 VC4+VC20 snapshot');
    assert.equal(a1.rows.length, 2);
    assert.equal(a1.rows[0].requested, 25);
    assert.equal(a2.agent.channel, 'gv');
    assert.equal(a2.agent.mobile, '+919876500002');

    // 4) 🔎 status by agent mobile — sirf us agent ki request, address/IP nahi
    const st = await jsonCall(server.base, '/api/public/tag-request/status?mobile=98765-00001');
    assert.equal(st.res.status, 200, JSON.stringify(st.json));
    assert.equal(st.json.count, 1);
    assert.equal(st.json.requests[0].id, rq1.id);
    assert.equal(st.json.requests[0].agentName, 'Rahul Sharma');
    assert.deepEqual(st.json.requests[0].classes.map((c) => [c.cls, c.requested, c.approved]), [['VC4', 25, 25], ['VC5', 5, 5]]);
    assert.ok(!JSON.stringify(st.json).includes('Gandhi Nagar'), 'status search me address leak nahi');
    assert.ok(!JSON.stringify(st.json).includes('10.1.0.2'), 'status search me IP leak nahi');
    const st91 = await jsonCall(server.base, '/api/public/tag-request/status?mobile=%2B919876500002');
    assert.equal(st91.json.count, 1, '+91 wala number bhi last 10 digit se match');
    const stNone = await jsonCall(server.base, '/api/public/tag-request/status?mobile=9000000000');
    assert.equal(stNone.res.status, 200); assert.equal(stNone.json.count, 0);
    const stBad = await jsonCall(server.base, '/api/public/tag-request/status?mobile=12345');
    assert.equal(stBad.res.status, 400);
    const byId = await jsonCall(server.base, `/api/public/tag-request/status?id=${encodeURIComponent(rq2.id)}`);
    assert.equal(byId.res.status, 200);
    assert.equal(byId.json.request.agentName, 'Priya Verma');
    assert.equal(byId.json.request.classes[0].cls, 'VC6');

    // 5) 🔁 duplicate agent-wise — DOOSRA employee, wahi agent + class → warning; alag class → nahi
    const dup = await jsonCall(server.base, '/api/public/tag-request/check', 'POST', { employee: { name: 'Suresh Kumar' }, agents: [{ agentName: 'Rahul Sharma', agentId: '1001', mobile: '9876500001', rows: [{ cls: 'VC4', approved: 10 }] }] }, '', '10.1.0.3');
    assert.equal(dup.res.status, 200, JSON.stringify(dup.json));
    assert.equal(dup.json.mode, 'agent');
    assert.equal(dup.json.duplicates.length, 1);
    assert.equal(dup.json.duplicates[0].id, rq1.id);
    assert.equal(dup.json.duplicates[0].byName, 'Ramesh Yadav');
    const byMobile = await jsonCall(server.base, '/api/public/tag-request/check', 'POST', { employee: { name: 'Suresh Kumar' }, agents: [{ agentName: 'R. Sharma (naya naam)', mobile: '9876500001', rows: [{ cls: 'VC5', approved: 2 }] }] }, '', '10.1.0.3');
    assert.equal(byMobile.json.duplicates.length, 1, 'naam alag ho par mobile same → bhi duplicate');
    const otherCls = await jsonCall(server.base, '/api/public/tag-request/check', 'POST', { employee: { name: 'Suresh Kumar' }, agents: [{ agentName: 'Rahul Sharma', agentId: '1001', rows: [{ cls: 'VC16', approved: 2 }] }] }, '', '10.1.0.3');
    assert.equal(otherCls.json.duplicates.length, 0, 'alag class → duplicate nahi');
    const resubmit = await jsonCall(server.base, '/api/public/tag-request', 'POST', {
      employee: { name: 'Ramesh Yadav', office: 'Jaipur office' }, employeeToken,
      agents: [rahul({ address: '99, New Road, Jaipur', pincode: '302016', rows: [{ cls: 'VC16', requested: 2, approved: 2 }] })]
    }, '', '10.1.0.30');
    assert.equal(resubmit.res.status, 201, JSON.stringify(resubmit.json));
    assert.equal(resubmit.json.employeeToken, employeeToken, 'same employee ko wahi private history token re-use hota hai');
    const updatedContact = await jsonCall(server.base, '/api/public/tag-request/contact?agentId=1001&agentName=Rahul%20Sharma&channel=ff');
    assert.equal(updatedContact.json.contact.address, '99, New Road, Jaipur', 'repeat request me naya address Address book ko update karta hai');
    assert.equal(updatedContact.json.contact.pincode, '302016');
    const again = await jsonCall(server.base, '/api/public/tag-request', 'POST', { employee: { name: 'Suresh Kumar' }, agents: [rahul({ rows: [{ cls: 'VC4', approved: 8 }] })] }, '', '10.1.0.4');
    assert.equal(again.res.status, 201, JSON.stringify(again.json));
    assert.equal(again.json.requests[0].duplicates, 1);
    assert.equal(again.json.warnings[0].code, 'duplicate');

    // 🔒 Retry safety: identical submit key returns the original batch; changed payload cannot reuse it.
    const idemKey = 'idem_test_submission_key_20261010';
    const idemBody = {
      employee: { name: 'Idempotency QA', office: 'Jaipur office' },
      submissionId: idemKey,
      agents: [rahul({ agentName: 'Idempotency Test Agent', agentId: '99887766', mobile: '9812345678', address: '99, Idempotency Road, Jaipur', pincode: '302016', rows: [{ cls: 'VC7', requested: 4, approved: 4 }] })]
    };
    const idemFirst = await jsonCall(server.base, '/api/public/tag-request', 'POST', idemBody, '', '10.1.0.50');
    assert.equal(idemFirst.res.status, 201, JSON.stringify(idemFirst.json));
    const idemRetry = await jsonCall(server.base, '/api/public/tag-request', 'POST', idemBody, '', '10.1.0.51');
    assert.equal(idemRetry.res.status, 201, JSON.stringify(idemRetry.json));
    assert.equal(idemRetry.json.requests[0].id, idemFirst.json.requests[0].id, 'retry must return the original request, not create another');
    const changedIdem = await jsonCall(server.base, '/api/public/tag-request', 'POST', {
      ...idemBody, agents: [rahul({ agentName: 'Idempotency Test Agent', agentId: '99887766', mobile: '9812345678', address: '99, Idempotency Road, Jaipur', pincode: '302016', rows: [{ cls: 'VC7', requested: 5, approved: 5 }] })]
    }, '', '10.1.0.52');
    assert.equal(changedIdem.res.status, 409, 'same key with changed payload must be rejected');
    const list2 = await jsonCall(server.base, '/api/tag-requests', 'GET', undefined, admin);
    const dupRow = list2.json.requests.find((r) => r.id === again.json.request.id);
    assert.deepEqual(dupRow.dupOf, [rq1.id], 'admin list me 🔁 dupOf');

    // 6) ✏️ admin inline class edit — VC4 25→20, VC5 5→0, nayi VC7 4 (classData snapshot) + approve
    const edit = await jsonCall(server.base, `/api/tag-requests/${encodeURIComponent(rq1.id)}`, 'PUT', {
      classQty: { VC4: 20, VC5: 0, VC7: 4, BAD: 9 }, classData: { VC7: { stock: 2, last: 6, cur: 1 } }, adminNote: 'VC5 abhi stock me nahi'
    }, admin);
    assert.equal(edit.res.status, 200, JSON.stringify(edit.json));
    const er = edit.json.request;
    assert.equal(er.total, 24, '20 + 0 + 4');
    const vc4 = er.rows.find((x) => x.cls === 'VC4'), vc5 = er.rows.find((x) => x.cls === 'VC5'), vc7 = er.rows.find((x) => x.cls === 'VC7');
    assert.equal(vc4.approved, 20); assert.equal(vc4.requested, 25, 'agent ka original qty safe');
    assert.equal(vc5.approved, 0); assert.equal(vc5.requested, 5);
    assert.equal(vc7.approved, 4); assert.equal(vc7.requested, 0); assert.equal(vc7.stock, 2); assert.equal(vc7.agentName, 'Rahul Sharma');
    assert.ok(!er.rows.some((x) => x.cls === 'BAD'), 'galat class ignore');
    const tooMuch = await jsonCall(server.base, `/api/tag-requests/${encodeURIComponent(rq1.id)}`, 'PUT', { classQty: { VC4: 100000, VC6: 100000 } }, admin);
    assert.equal(tooMuch.res.status, 400);
    const badStatus = await jsonCall(server.base, `/api/tag-requests/${encodeURIComponent(rq1.id)}`, 'PUT', { classQty: { VC4: 1 }, status: 'nope' }, admin);
    assert.equal(badStatus.res.status, 400);
    const after = (await jsonCall(server.base, '/api/tag-requests', 'GET', undefined, admin)).json.requests.find((r) => r.id === rq1.id);
    assert.equal(after.total, 24, 'fail hui edit se request nahi badli');
    const appr = await jsonCall(server.base, `/api/tag-requests/${encodeURIComponent(rq1.id)}`, 'PUT', { status: 'approved' }, admin);
    assert.equal(appr.json.request.status, 'approved');
    const st2 = await jsonCall(server.base, '/api/public/tag-request/status?mobile=9876500001');
    const mine = st2.json.requests.find((r) => r.id === rq1.id);
    assert.equal(mine.status, 'approved');
    assert.equal(mine.adminNote, 'VC5 abhi stock me nahi');
    assert.deepEqual(mine.classes.find((c) => c.cls === 'VC4'), { cls: 'VC4', requested: 25, approved: 20 });
    const rej = await jsonCall(server.base, `/api/tag-requests/${encodeURIComponent(rq2.id)}`, 'PUT', { status: 'rejected', adminNote: 'Pincode detail confirm karein' }, admin);
    assert.equal(rej.json.request.status, 'rejected');
    const employeeStatusUpdated = await jsonCall(server.base, `/api/public/tag-request/employee-status?token=${encodeURIComponent(employeeToken)}`);
    assert.equal(employeeStatusUpdated.json.totalRequests, 3);
    assert.equal(employeeStatusUpdated.json.pending, 1, 'repeat submission remains pending');
    assert.equal(employeeStatusUpdated.json.approved, 1);
    assert.equal(employeeStatusUpdated.json.rejected, 1);
    assert.equal(employeeStatusUpdated.json.requests.find((r) => r.id === rq1.id).adminNote, 'VC5 abhi stock me nahi');
    assert.equal(employeeStatusUpdated.json.requests.find((r) => r.id === rq2.id).adminNote, 'Pincode detail confirm karein');

    // 7) login form (member) — same agents format → split; owner pending edit kar sakta hai, status nahi
    await jsonCall(server.base, '/api/users', 'POST', { username: 'member', name: 'Member One', password: 'member-pass-1', role: 'user', permissions: ['home', 'tagRequest'] }, admin);
    const member = (await jsonCall(server.base, '/api/auth/login', 'POST', { username: 'member', password: 'member-pass-1' })).cookie;
    const mc = await jsonCall(server.base, '/api/tag-requests', 'POST', {
      employee: { name: 'Member One' }, agents: [rahul({ agentId: '3003', agentName: 'Neha Gupta', mobile: '9811100003' }), priya({ agentId: '4004', agentName: 'Vikas Jain', mobile: '9811100004' })]
    }, member);
    assert.equal(mc.res.status, 201, JSON.stringify(mc.json));
    assert.equal(mc.json.requests.length, 2);
    assert.equal(mc.json.request.agent.name, 'Neha Gupta');
    assert.equal(mc.json.batch.total, 36);
    const ownEdit = await jsonCall(server.base, `/api/tag-requests/${encodeURIComponent(mc.json.requests[1].id)}`, 'PUT', { classQty: { VC6: 9 } }, member);
    assert.equal(ownEdit.res.status, 200, 'owner apni pending request edit kar sakta hai');
    assert.equal(ownEdit.json.request.total, 9);
    const selfApprove = await jsonCall(server.base, `/api/tag-requests/${encodeURIComponent(mc.json.requests[1].id)}`, 'PUT', { status: 'approved' }, member);
    assert.equal(selfApprove.res.status, 403, 'owner khud approve nahi kar sakta');
    const notMine = await jsonCall(server.base, `/api/tag-requests/${encodeURIComponent(rq2.id)}`, 'PUT', { classQty: { VC6: 1 } }, member);
    assert.equal(notMine.res.status, 403, 'doosre ki request edit nahi');
    const memberList = await jsonCall(server.base, '/api/tag-requests', 'GET', undefined, member);
    assert.equal(memberList.json.requests.length, 2, 'member ko sirf apni requests');
    // login form par bhi agent ka address mandatory (same form)
    const memberNoAddr = await jsonCall(server.base, '/api/tag-requests', 'POST', { employee: { name: 'Member One' }, agents: [rahul({ address: '' })] }, member);
    assert.equal(memberNoAddr.res.status, 400);

    // 8) askAddress OFF → address/pincode optional, par diya to format sahi chahiye
    await jsonCall(server.base, '/api/public-tag-form', 'PUT', { config: { askAddress: false } }, admin);
    const noAddrOk = await jsonCall(server.base, '/api/public/tag-request', 'POST', { employee: { name: 'Ramesh Yadav' }, agents: [rahul({ agentId: '5005', agentName: 'Amit Kumar', mobile: '9811100005', address: '', pincode: '' })] }, '', '10.1.0.5');
    assert.equal(noAddrOk.res.status, 201, JSON.stringify(noAddrOk.json));
    await jsonCall(server.base, '/api/public-tag-form', 'PUT', { config: { askAddress: true } }, admin);

    // 9) admin notification — ek submit = ek batch notification (saare request IDs ke saath)
    const notes = await jsonCall(server.base, '/api/notifications', 'GET', undefined, admin);
    const batchNote = ((notes.json && notes.json.items) || []).find((n) => n.meta && n.meta.batch === a1.batch);
    assert.ok(batchNote, 'batch notification mila');
    assert.deepEqual(batchNote.meta.requestIds, [rq1.id, rq2.id]);
    assert.match(batchNote.body, /2 agents · 36 tags/);
  } finally {
    if (server) await server.stop();
    await mock.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
