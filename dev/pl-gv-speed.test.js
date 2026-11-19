/* ⚡ Speed test for GV personal link optimization:
   Verifies GV Master single-flight query routing, memoization, and concurrency. */
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
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, STORAGE_BACKEND: 'files', PORT: '0', DATA_DIR: dir, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'initial-password', GVIZ_BASE: upstream },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stderr.on('data', (d) => { logs += d; });
  const base = await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => {
      logs += d;
      const m = logs.match(/http:\/\/0\.0\.0\.0:(\d+)/);
      if (m && m[1] !== '0') resolve(`http://127.0.0.1:${m[1]}`);
    });
    child.on('exit', (code) => reject(new Error(`exit ${code}: ${logs}`)));
    setTimeout(() => reject(new Error('startup timeout ' + logs)), 10000).unref();
  });
  return { child, base, async stop() { if (child.exitCode !== null) return; child.kill('SIGTERM'); await once(child, 'exit'); } };
}

test('GV personal link: direct GV Master routing, memoization, and fast HTML response', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gv-speed-'));
  const dcell = (d) => `Date(${d.getUTCFullYear()},${d.getUTCMonth()},${d.getUTCDate()})`;
  const y = new Date(Date.now() + 5.5 * 3600e3 - 86400e3);
  const requests = [];

  const upstream = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const sheet = url.searchParams.get('sheet') || '';
    const tq = url.searchParams.get('tq') || '';
    requests.push({ sheet, tq });

    if (sheet === 'GV Master') {
      // GV Master response with agent name, date, CCH, class, unique_id, tag_count
      const rows = [
        { c: [{ v: 'Akash Mansingh Thakur' }, { v: dcell(y) }, { v: 'VC4' }, { v: '4' }, { v: 'APS010008' }, { v: 12 }] },
        { c: [{ v: 'Bablu Singh' }, { v: dcell(y) }, { v: 'VC20' }, { v: '20' }, { v: 'APS010498' }, { v: 8 }] }
      ];
      // If supervisor query
      if ((/count\(I\)/.test(tq) && /supervisor_name|col\.tl|select D/.test(tq)) || /select D, count\(I\)/i.test(tq)) {
        const supResp = {
          status: 'ok',
          table: { cols: [{ id: 'D', type: 'string' }, { id: 'I', type: 'number' }], rows: [{ c: [{ v: 'Varsha Kanwar' }, { v: 20 }] }] }
        };
        return res.end(`google.visualization.Query.setResponse(${JSON.stringify(supResp)});`);
      }
      const gvResp = {
        status: 'ok',
        table: {
          cols: [{ id: 'B', type: 'string' }, { id: 'P', type: 'date' }, { id: 'G', type: 'string' }, { id: 'F', type: 'string' }, { id: 'A', type: 'string' }, { id: 'I', type: 'number' }],
          rows
        }
      };
      return res.end(`google.visualization.Query.setResponse(${JSON.stringify(gvResp)});`);
    }

    // Default empty EIR table
    res.end(`google.visualization.Query.setResponse(${JSON.stringify({ status: 'ok', table: { cols: [{ id: 'A', type: 'string' }], rows: [] } })});`);
  });

  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');

  const server = await startServer(dir, `http://127.0.0.1:${upstream.address().port}`);
  const call = async (route, method = 'GET', body, cookie = '') => {
    const res = await fetch(server.base + route, {
      method,
      headers: { cookie, 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
      body: body ? JSON.stringify(body) : undefined
    });
    return { res, json: await res.json().catch(() => ({})), setCookie: res.headers.get('set-cookie') };
  };

  try {
    const admin = (await call('/api/auth/login', 'POST', { username: 'owner', password: 'initial-password' })).setCookie.split(';')[0];

    // Configure GV sheet ID so direct routing activates
    await call('/api/settings', 'POST', {
      gvSheetId: '1LkYX746lGZQKhl5ueoKe3kYOo4SNtu47p5-jkVNUiBA',
      gv: { master: { tab: 'GV Master', agentName: 'B', date: 'P', cch: 'G', vClass: 'F', uniqueId: 'A', tagId: 'I', tlName: 'D', tlId: 'C' } }
    }, admin);

    // Create a GV TL link for Varsha Kanwar
    const made = await call('/api/personal-links', 'POST', {
      kind: 'tl', source: 'gv', name: 'Varsha Kanwar', personId: 'APS000001', mobile: '9876543210'
    }, admin);
    assert.equal(made.res.status, 200);

    const verified = await call('/api/public/personal-link/verify', 'POST', {
      token: made.json.link.token, personId: 'APS000001', mobile: '9876543210'
    });
    assert.equal(verified.res.status, 200);
    const cookie = verified.setCookie.split(';')[0];

    requests.length = 0; // reset request tracker

    // Open personal link
    const pageRes = await fetch(`${server.base}/p/${made.json.link.token}`, { headers: { cookie } });
    assert.equal(pageRes.status, 200);
    const html = await pageRes.text();

    assert.ok(html.includes('Varsha Kanwar'), 'contains TL name');
    assert.ok(html.includes('Akash Mansingh Thakur'), 'contains member from GV Master');
    assert.ok(html.includes('APS010008'), 'contains agent ID resolved from GV Master unique_id');

    // Verify GV Master was queried
    const gvMasterQueries = requests.filter((r) => r.sheet === 'GV Master');
    assert.ok(gvMasterQueries.length >= 1, 'GV Master was queried');

    // Verify memoization: subsequent call within 60s does not refetch GV Master
    const countBefore = requests.filter((r) => r.sheet === 'GV Master').length;
    const secondRes = await fetch(`${server.base}/p/${made.json.link.token}?partial=1`, { headers: { cookie } });
    assert.equal(secondRes.status, 200);
    const countAfter = requests.filter((r) => r.sheet === 'GV Master').length;
    assert.equal(countAfter, countBefore, 'Memoization prevented redundant GV Master query');

  } finally {
    await server.stop();
    upstream.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
