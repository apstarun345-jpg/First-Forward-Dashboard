/* 🧩 Team link combining TLs + agents from GV and First Forward: API normalization, de-duplication of
   agents already under a selected TL, and the combined report page. */
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

test('team link: TLs + agents from GV and FF are combined without double counting', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-combo-'));
  const dcell = (d) => `Date(${d.getUTCFullYear()},${d.getUTCMonth()},${d.getUTCDate()})`;
  const y = new Date(Date.now() + 5.5 * 3600e3 - 86400e3);
  const GV = '5845036';
  const seen = [];
  const upstream = http.createServer((req, res) => {
    const tq = new URL(req.url, 'http://x').searchParams.get('tq') || '';
    seen.push(tq);
    let rows = [];
    const byAgent = /group by (L|AX), AA/.test(tq);
    const ffTl = /BA = 'FF Boss'/.test(tq), gvTl = /AZ = 'GV Boss'/.test(tq), gvSolo = /AX = 'GV Solo'/.test(tq), ffMem = /L = 'Agent F1'/.test(tq);
    const mk = (name, master, n, cls = '4') => (byAgent ? { c: [{ v: name }, { v: dcell(y) }, { v: master }, { v: 'x' }, { v: n }] } : { c: [{ v: dcell(y) }, { v: cls }, { v: master }, { v: 'x' }, { v: n }] });
    if (ffTl) rows = [mk('Agent F1', '1', 4)];
    else if (gvTl) rows = [mk('Agent G1', GV, 6)];
    else if (gvSolo) rows = [mk('GV Solo', GV, 3)];
    else if (ffMem) rows = [mk('Agent F1', '1', 4)];
    res.end(`google.visualization.Query.setResponse(${JSON.stringify({ status: 'ok', table: { cols: [{ id: 'A', type: 'string' }, { id: 'B', type: 'string' }, { id: 'C', type: 'string' }, { id: 'D', type: 'string' }, { id: 'E', type: 'number' }], rows } })});`);
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const server = await startServer(dir, `http://127.0.0.1:${upstream.address().port}`);
  const call = async (route, method = 'GET', body, cookie = '') => {
    const res = await fetch(server.base + route, { method, headers: { cookie, 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' }, body: body ? JSON.stringify(body) : undefined });
    return { res, json: await res.json().catch(() => ({})), setCookie: res.headers.get('set-cookie') };
  };
  try {
    const admin = (await call('/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' })).setCookie.split(';')[0];
    const bad = await call('/api/personal-links', 'POST', { kind: 'group', source: 'both', name: 'Empty', personId: 'T-1', mobile: '9876543210' }, admin);
    assert.equal(bad.res.status, 400, 'needs at least one TL or agent');
    const made = await call('/api/personal-links', 'POST', {
      kind: 'group', source: 'both', name: 'Mixed Team', personId: 'MIX-1', mobile: '9876543210',
      tls: [{ name: 'FF Boss', source: 'ff' }, { name: 'GV Boss', source: 'gv' }],
      members: [{ name: 'GV Solo', source: 'gv' }, { name: 'Agent F1', source: 'ff' }]
    }, admin);
    assert.equal(made.res.status, 200, JSON.stringify(made.json).slice(0, 200));
    assert.equal(made.json.link.source, 'both');
    assert.equal(made.json.link.tls.length, 2);
    assert.deepEqual(made.json.link.members.map((m) => `${m.source}|${m.name}`), ['gv|GV Solo', 'ff|Agent F1']);
    const verified = await call('/api/public/personal-link/verify', 'POST', { token: made.json.link.token, personId: 'MIX-1', mobile: '9876543210' });
    assert.equal(verified.res.status, 200);
    const cookie = verified.setCookie.split(';')[0];
    const html = await (await fetch(`${server.base}/p/${made.json.link.token}`, { headers: { cookie } })).text();
    assert.match(html, /GV Partner \+ First Forward/, 'heading shows both channels');
    assert.match(html, /2 TLs \+ 2 agents/, 'TL + agent counts');
    for (const name of ['Agent F1', 'Agent G1', 'GV Solo']) assert.ok(html.includes(name), `${name} is in the combined report`);
    // v280: Today Live tab, donut charts, full-width layout
    assert.match(html, /data-pl-tab="live"/, 'Today Live tab button');
    assert.match(html, /data-pl-pane="live"/, 'Today Live pane');
    assert.match(html, /Today Live/, 'Today Live heading');
    assert.match(html, /class="pb-donut"/, 'donut charts are rendered');
    assert.match(html, /Issuance · class mix/, 'issuance donut card');
    assert.match(html, /\.pb-wrap,\.pb-wrap\{max-width:none/, 'dashboard is full width');
    // v283: GV | FF switch, channel split, scoped search
    assert.match(html, /class="pl-chbar"/, 'channel switch bar');
    assert.match(html, /href="\?ch=gv"/); assert.match(html, /href="\?ch=ff"/);
    assert.match(html, /Channel split/, 'GV vs FF split card in All view');
    assert.match(html, /id="pl-search-q"/, 'scoped search bar');
    const sd = JSON.parse(html.match(/id="pl-search-data">([^<]*)</)[1]);
    const names = sd.items.map((i) => i.n);
    for (const n of ['Agent F1', 'Agent G1', 'GV Solo', 'FF Boss', 'GV Boss']) assert.ok(names.includes(n), `search covers ${n}`);
    assert.ok(!names.includes('Somebody Else'), 'search only has people from this link');
    const gvHtml = await (await fetch(`${server.base}/p/${made.json.link.token}?ch=gv`, { headers: { cookie } })).text();
    assert.match(gvHtml, /class="pl-ch on gv"/, 'GV chip active ' + (gvHtml.match(/<p>([^<]{0,200})<\/p>/) || [])[1]);
    assert.ok(gvHtml.includes('Agent G1') && gvHtml.includes('GV Solo'), 'GV view has GV agents');
    assert.ok(!gvHtml.includes('Agent F1') && !gvHtml.includes('FF Boss'), 'GV view has no FF people');
    const ffHtml = await (await fetch(`${server.base}/p/${made.json.link.token}?ch=ff`, { headers: { cookie } })).text();
    assert.ok(ffHtml.includes('Agent F1') && !ffHtml.includes('Agent G1') && !ffHtml.includes('GV Solo'), 'FF view has only FF people');
    const portalJs = await (await fetch(`${server.base}/p-portal.js`)).text();
    assert.doesNotThrow(() => new Function(portalJs), 'portal client JS parses');
    assert.match(portalJs, /pl-search-data/); assert.match(portalJs, /data-pl-ch/);
    // Agent F1 is under the selected FF TL → not queried again as a manual member
    assert.ok(!seen.some((q) => /L = 'Agent F1'/.test(q)), 'agents already under a selected TL are not queried twice');
    // edit: drop a TL, keep members
    const put = await call(`/api/personal-links/${made.json.link.id}`, 'PUT', { personId: 'MIX-1', mobile: '9876543210', tls: [{ name: 'GV Boss', source: 'gv' }], source: 'both' }, admin);
    assert.equal(put.res.status, 200);
    assert.equal(put.json.link.tls.length, 1);
  } finally { await server.stop(); upstream.close(); }
});
