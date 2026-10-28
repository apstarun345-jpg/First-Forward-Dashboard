/* 🎯 Personal team link: set / clear agent targets (Active or number), admin-set conflict, session survives a restart. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function startServer(dir, upstream) {
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, STORAGE_BACKEND: 'files', PORT: '0', DATA_DIR: dir, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'initial-password', GVIZ_BASE: upstream }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stderr.on('data', (d) => { logs += d; });
  const base = await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { logs += d; const m = logs.match(/http:\/\/0\.0\.0\.0:(\d+)/); if (m && m[1] !== '0') resolve(`http://127.0.0.1:${m[1]}`); });
    child.on('exit', (code) => reject(new Error(`exit ${code}: ${logs}`)));
    setTimeout(() => reject(new Error('startup timeout ' + logs)), 10000).unref();
  });
  return { child, base, async stop() { if (child.exitCode !== null) return; child.kill('SIGTERM'); await once(child, 'exit'); } };
}

test('team link: viewers set targets, admin sees them; admin-set targets are protected; session survives restart', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-pltg-'));
  const dcell = (d) => `Date(${d.getUTCFullYear()},${d.getUTCMonth()},${d.getUTCDate()})`;
  const y = new Date(Date.now() + 5.5 * 3600e3 - 86400e3);
  const GV = '5845036';
  const upstream = http.createServer((req, res) => {
    const tq = new URL(req.url, 'http://x').searchParams.get('tq') || '';
    let rows = [];
    const byAgent = /group by (L|AX), AA/.test(tq);
    const ffTl = /BA = 'FF Boss'/.test(tq), gvTl = /AZ = 'GV Boss'/.test(tq);
    const mk = (name, master, n, cls = '4') => (byAgent ? { c: [{ v: name }, { v: dcell(y) }, { v: master }, { v: 'x' }, { v: n }] } : { c: [{ v: dcell(y) }, { v: cls }, { v: master }, { v: 'x' }, { v: n }] });
    if (ffTl) rows = [mk('Agent F1', '1', 4)]; else if (gvTl) rows = [mk('Agent G1', GV, 6)];
    res.end(`google.visualization.Query.setResponse(${JSON.stringify({ status: 'ok', table: { cols: [{ id: 'A', type: 'string' }, { id: 'B', type: 'string' }, { id: 'C', type: 'string' }, { id: 'D', type: 'string' }, { id: 'E', type: 'number' }], rows } })});`);
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  let server = await startServer(dir, `http://127.0.0.1:${upstream.address().port}`);
  const call = async (route, method = 'GET', body, cookie = '') => {
    const res = await fetch(server.base + route, { method, headers: { cookie, 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' }, body: body ? JSON.stringify(body) : undefined });
    return { res, json: await res.json().catch(() => ({})), setCookie: res.headers.get('set-cookie') };
  };
  try {
    const admin = (await call('/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' })).setCookie.split(';')[0];
    const made = await call('/api/personal-links', 'POST', { kind: 'group', source: 'both', name: 'Mixed Team', personId: 'MIX-1', mobile: '9876543210', tls: [{ name: 'FF Boss', source: 'ff' }, { name: 'GV Boss', source: 'gv' }], members: [] }, admin);
    assert.equal(made.res.status, 200, JSON.stringify(made.json).slice(0, 200));
    const token = made.json.link.token;
    const verified = await call('/api/public/personal-link/verify', 'POST', { token, personId: 'MIX-1', mobile: '9876543210' });
    const cookie = verified.setCookie.split(';')[0];

    // no session → rejected
    assert.equal((await call('/api/public/personal-link/target', 'POST', { token, name: 'Agent F1', target: 10 })).res.status, 401);
    // unknown agent
    assert.equal((await call('/api/public/personal-link/target', 'POST', { token, name: 'Nobody', target: 10 }, cookie)).res.status, 404);
    // bad input
    assert.equal((await call('/api/public/personal-link/target', 'POST', { token, name: 'Agent F1' }, cookie)).res.status, 400);
    // number target + Active goal
    const t1 = await call('/api/public/personal-link/target', 'POST', { token, name: 'Agent F1', target: 10 }, cookie);
    assert.equal(t1.res.status, 200); assert.equal(t1.json.tg, 10);
    const t2 = await call('/api/public/personal-link/target', 'POST', { token, name: 'Agent G1', goal: 'active' }, cookie);
    assert.equal(t2.res.status, 200); assert.equal(t2.json.tg, 'A');

    // admin sees them (source link = Mixed Team)
    const st = await call('/api/settings', 'GET', null, admin);
    const targets = (st.json.settings && st.json.settings.targets) || [];
    const f1 = targets.find((t) => /AGENT F1/.test(t.key));
    assert.ok(f1 && f1.via === 'link' && f1.linkName === 'Mixed Team' && f1.target === 10 && f1.ym, 'link target stored for admin Home');
    const g1 = targets.find((t) => /AGENT G1/.test(t.key));
    assert.ok(g1 && g1.goal === 'active' && g1.source === 'gv');

    // the page shows the target + the unified grid hooks
    const html = await (await fetch(`${server.base}/p/${token}`, { headers: { cookie } })).text();
    const sd = JSON.parse(html.match(/id="pl-search-data">([^<]*)</)[1]);
    assert.equal(sd.items.find((i) => i.n === 'Agent F1').tg, 10);
    assert.equal(sd.items.find((i) => i.n === 'Agent G1').tg, 'A');
    assert.equal(sd.tgOk, true); assert.equal(sd.tok, token);
    assert.match(html, /class="pl-aglist"/, 'agent lists are rendered with the unified grid');

    // admin-set target is protected from the link
    const put = await call('/api/settings', 'PUT', { settings: { targets: targets.map((t) => (/AGENT F1/.test(t.key) ? { ...t, via: undefined, linkId: undefined, linkName: undefined, by: 'owner' } : t)) } }, admin);
    assert.equal(put.res.status, 200);
    assert.equal((await call('/api/public/personal-link/target', 'POST', { token, name: 'Agent F1', target: 99 }, cookie)).res.status, 409);

    // clear own target
    const clr = await call('/api/public/personal-link/target', 'POST', { token, name: 'Agent G1', clear: true }, cookie);
    assert.equal(clr.res.status, 200); assert.equal(clr.json.tg, 0);

    // restart: the signed session cookie still opens the report (no login screen)
    await server.stop();
    server = await startServer(dir, `http://127.0.0.1:${upstream.address().port}`);
    const after = await (await fetch(`${server.base}/p/${token}`, { headers: { cookie } })).text();
    assert.doesNotMatch(after, /Verification Required/, 'no login after restart');
    assert.match(after, /id="pl-search-data"/);
  } finally { await server.stop(); upstream.close(); }
});
