/* 📡 Personal link activity: admin notifications, live presence + mirror, instant channel views (partial JSON). */
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

test('personal link: activity feed, alerts, live presence and partial views', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apna-plact-'));
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
    const curKey = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7);
    if (/^select \w+, \w+, \w+, count\(/.test(tq.trim())) {
      const n = tq.includes(`>= date '${curKey}-01'`) ? 3 : 5;
      const who = ffTl ? ['Agent F1', '1'] : (gvTl ? ['Agent G1', GV] : null);
      rows = who ? [{ c: [{ v: who[0] }, { v: '4' }, { v: who[1] }, { v: n }] }, { c: [{ v: who[0] }, { v: '6' }, { v: who[1] }, { v: n - 2 }] }] : [];
    } else if (ffTl) rows = [mk('Agent F1', '1', 4)];
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
    const made = await call('/api/personal-links', 'POST', {
      kind: 'group', source: 'both', name: 'Watch Team', personId: 'W-1', mobile: '9876543210',
      tls: [{ name: 'FF Boss', source: 'ff' }, { name: 'GV Boss', source: 'gv' }]
    }, admin);
    assert.equal(made.res.status, 200);
    const { token, id } = made.json.link;
    const SID = 'testsid_abcdefghijklmnop1234';
    // 1) opening the link (login screen) is logged
    await fetch(`${server.base}/p/${token}`);
    // 2) wrong ID, then correct login
    const bad = await call('/api/public/personal-link/verify', 'POST', { token, personId: 'NOPE', mobile: '9876543210', sid: SID });
    assert.equal(bad.res.status, 403);
    const ok = await call('/api/public/personal-link/verify', 'POST', { token, personId: 'W-1', mobile: '9876543210', sid: SID });
    assert.equal(ok.res.status, 200);
    const cookie = ok.setCookie.split(';')[0];
    // 3) events need the verified session
    const anon = await call('/api/public/personal-link/event', 'POST', { token, sid: SID, kind: 'search', label: 'x' });
    assert.equal(anon.res.status, 401, 'anonymous event rejected');
    const ev = await call('/api/public/personal-link/event', 'POST', { token, sid: SID, kind: 'search', label: 'Searched "agent f1" · 1 match', ch: 'ff', tab: 'overview', q: 'agent f1' }, cookie);
    assert.equal(ev.res.status, 200);
    await call('/api/public/personal-link/event', 'POST', { token, sid: SID, kind: 'tab', label: 'Opened tab "Stock"', ch: 'ff', tab: 'stock' }, cookie);
    await call('/api/public/personal-link/ping', 'POST', { token, sid: SID, ch: 'ff', tab: 'stock', q: 'agent f1' }, cookie);
    // 4) admin feed
    const feed = await call(`/api/personal-links/activity?linkId=${encodeURIComponent(id)}`, 'GET', null, admin);
    assert.equal(feed.res.status, 200);
    const kinds = feed.json.events.map((e) => e.kind);
    for (const k of ['link_open', 'login_failed', 'login', 'search', 'tab']) assert.ok(kinds.includes(k), `feed has ${k}: ${kinds}`);
    assert.ok(feed.json.live.some((l) => l.sessionId === SID && l.mirror.includes('embed=live') && l.mirror.includes('ch=ff') && l.mirror.endsWith('#stock')), 'live session carries the mirror url');
    assert.equal(feed.json.stats.online, true);
    assert.ok([401, 403].includes((await call('/api/personal-links/activity', 'GET', null)).res.status), 'feed is admin only');
    // 5) bell notifications (+ watch-live id) for login / search; tab switches are off by default
    const notes = await call('/api/notifications', 'GET', null, admin);
    const titles = (notes.json.items || notes.json.notifications || []).map((n) => n.title).join(' | ');
    assert.match(titles, /Watch Team · Failed login/); assert.match(titles, /Watch Team · Logged in/); assert.match(titles, /Watch Team · Searched/);
    assert.doesNotMatch(titles, /Switched tab/, 'tab switches are logged but not notified by default');
    const searchNote = (notes.json.items || notes.json.notifications || []).find((n) => /Searched/.test(n.title));
    assert.equal(searchNote.meta.publicSessionId, SID, 'notification can open the live view');
    // 6) alert settings
    const off = await call('/api/personal-links/alerts', 'PUT', { search: false, tab: true }, admin);
    assert.equal(off.json.alerts.search, false); assert.equal(off.json.alerts.tab, true);
    await call('/api/public/personal-link/event', 'POST', { token, sid: SID, kind: 'search', label: 'Searched "zzz"', q: 'zzz' }, cookie);
    await call('/api/public/personal-link/event', 'POST', { token, sid: SID, kind: 'channel', label: 'Switched to GV Partner', ch: 'gv' }, cookie);
    const notes2 = await call('/api/notifications', 'GET', null, admin);
    const t2 = (notes2.json.items || notes2.json.notifications || []).map((n) => n.title + ' ' + n.body).join(' | ');
    assert.doesNotMatch(t2, /zzz/, 'search alert can be switched off');
    assert.match(t2, /Switched channel/, 'channel alert can be switched on');
    // 7) instant switch: partial JSON per channel (no full page)
    const part = await fetch(`${server.base}/p/${token}?ch=gv&partial=1`, { headers: { cookie } });
    assert.equal(part.status, 200);
    const pj = await part.json();
    assert.equal(pj.ok, true); assert.equal(pj.view, 'gv');
    assert.match(pj.body, /class="pl-ch on gv"/); assert.ok(!pj.body.includes('<!doctype'), 'partial has no page shell');
    // 7b) search data carries class-wise numbers + priority inputs
    const fullHtml = await (await fetch(`${server.base}/p/${token}`, { headers: { cookie } })).text();
    const sd = JSON.parse(fullHtml.match(/id="pl-search-data">([^<]*)</)[1]);
    for (const k of ['days', 'elapsed', 'red', 'orange', 'ym', 'prevYm']) assert.ok(sd[k] !== undefined, `search data has ${k}`);
    const f1 = sd.items.find((i) => i.n === 'Agent F1' && i.k === 'a');
    assert.ok(f1 && f1.c, 'agent has class-wise data');
    assert.deepEqual(f1.c.VC4.slice(0, 2), [5, 3], 'VC4 last month / MTD from the class query');
    assert.deepEqual(f1.c.VC6.slice(0, 2), [3, 1], 'actual class VC6 is kept (not folded into VC5+)');
    assert.ok(!f1.c.VC20, 'no VC20 issuance → no VC20 key'); assert.ok(sd.classes.includes('VC4') && sd.classes.includes('VC20') && sd.classes.includes('VC6'), 'class list');
    const tlF = sd.items.find((i) => i.k === 't' && i.n === 'FF Boss');
    assert.deepEqual(tlF.c.VC4.slice(0, 2), [5, 3], 'TL class totals are the sum of its agents');
    // 8) admin live preview opens the report without the visitor session, read-only
    const pre = await fetch(`${server.base}/p/${token}?embed=live&ch=ff`, { headers: { cookie: admin } });
    const preHtml = await pre.text();
    assert.match(preHtml, /id="pl-search-q"/, 'admin preview shows the report');
    const nonAdmin = await fetch(`${server.base}/p/${token}?embed=live`);
    assert.match(await nonAdmin.text(), /Verification Required/, 'embed flag alone does not bypass login');
    // 9) client JS
    const js = await (await fetch(`${server.base}/p-portal.js`)).text();
    assert.doesNotThrow(() => new Function(js));
    for (const needle of ['Stock by class', 'Issuance · MTD by class', 'personal-link/event', 'personal-link/ping', 'fetchView', 'partial=1']) assert.ok(js.includes(needle), needle);
    // 10) link list carries activity stats
    const list = await call('/api/personal-links', 'GET', null, admin);
    assert.ok(list.json.links[0].activity.lastActivity, 'link list has last activity');
    assert.equal(list.json.alerts.search, false);
  } finally { await server.stop(); upstream.close(); }
});
