/* v202 — compression memo + ETag correctness.
   Locks:
     • static JS/CSS: br / gzip / plain teeno sahi bytes dete hain, dobara request par byte-identical (memo),
     • gviz proxy: ETag poori body ka hash hai — beech ki same-length value badle to naya ETag (pehle purana
       ETag → client ko 304 = purana data), compressed copy naye entry ke saath badalti hai,
     • sendMaybeCompressed ka memo "kabhi purana body nahi dikhata" (entry/slot ke saath jeeta hai). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function startServer(dir, upstream) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, STORAGE_BACKEND: 'files', PORT: '0', DATA_DIR: dir, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'initial-password', GVIZ_BASE: upstream, RENDER: '' },
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
  const base = await Promise.race([ready, new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('Startup timeout: ' + logs)), 10000); t.unref(); })]);
  return { child, base, async stop() { if (child.exitCode !== null) return; child.kill('SIGTERM'); await once(child, 'exit'); } };
}

/** Raw HTTP GET — body ko decompress NAHI karta (fetch auto-decode kar deta hai). */
function rawGet(base, route, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(route, base);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

function gvizBody(cell) {
  // >1 KB, head/tail same rakhte hain — sirf beech ka ek cell badalta hai (same length).
  const rows = Array.from({ length: 60 }, (_, i) => `{"c":[{"v":"row-${String(i).padStart(3, '0')}"},{"v":${i === 30 ? cell : 1000 + i}}]}`).join(',');
  return `/*O_o*/\ngoogle.visualization.Query.setResponse({"version":"0.6","reqId":"0","status":"ok","sig":"1","table":{"cols":[{"id":"A","label":"k","type":"string"},{"id":"B","label":"v","type":"number"}],"rows":[${rows}]}});`;
}

test('static assets: br/gzip/plain correct + repeat request byte-identical (memo)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ff-memo-'));
  const server = await startServer(dir, 'http://127.0.0.1:9');
  try {
    const disk = await fs.readFile(path.join(ROOT, 'styles.css'));
    const br1 = await rawGet(server.base, '/styles.css?v=1', { 'Accept-Encoding': 'br, gzip' });
    assert.equal(br1.status, 200);
    assert.equal(br1.headers['content-encoding'], 'br');
    assert.match(String(br1.headers.vary || ''), /Accept-Encoding/i);
    assert.ok(br1.body.length < disk.length / 3, 'brotli kaafi chhota hona chahiye');
    assert.deepEqual(zlib.brotliDecompressSync(br1.body), disk);
    // Dobara + parallel — wahi bytes (memo / in-flight dedupe), content-length sahi.
    const [br2, br3] = await Promise.all([
      rawGet(server.base, '/styles.css?v=1', { 'Accept-Encoding': 'br' }),
      rawGet(server.base, '/styles.css?v=1', { 'Accept-Encoding': 'br' })
    ]);
    assert.ok(br1.body.equals(br2.body) && br2.body.equals(br3.body), 'memoized br bytes identical');
    assert.equal(Number(br2.headers['content-length']), br2.body.length);
    // gzip client ko br nahi jaana chahiye.
    const gz = await rawGet(server.base, '/styles.css?v=1', { 'Accept-Encoding': 'gzip' });
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.deepEqual(zlib.gunzipSync(gz.body), disk);
    // Koi encoding nahi → plain, memo ne plain ko compressed se replace nahi kiya.
    const plain = await rawGet(server.base, '/styles.css?v=1', {});
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.deepEqual(plain.body, disk);
    // ETag/304 path abhi bhi chalta hai.
    const again = await rawGet(server.base, '/styles.css?v=1', { 'Accept-Encoding': 'br', 'If-None-Match': br1.headers.etag });
    assert.equal(again.status, 304);
    // Immutable cache header (versioned URL) intact.
    assert.match(String(br1.headers['cache-control']), /immutable/);
  } finally {
    await server.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('gviz proxy: full-body ETag (same-length middle edit → new ETag) + memoized br matches body', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ff-memo-'));
  let current = gvizBody(5555);
  const upstream = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(current); });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = await startServer(dir, `http://127.0.0.1:${upstream.address().port}`);
  try {
    const login = await fetch(`${server.base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
      body: JSON.stringify({ username: 'owner', password: 'initial-password' })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const route = '/api/gviz?sheet=EIR&tq=select%20A%2CB';

    const first = await rawGet(server.base, route, { cookie, 'Accept-Encoding': 'br' });
    assert.equal(first.status, 200);
    assert.equal(first.headers['content-encoding'], 'br');
    assert.equal(zlib.brotliDecompressSync(first.body).toString('utf8'), current);

    // Cache HIT: wahi ETag + wahi compressed bytes.
    const hit = await rawGet(server.base, route, { cookie, 'Accept-Encoding': 'br' });
    assert.equal(hit.headers.etag, first.headers.etag);
    assert.ok(hit.body.equals(first.body));
    const nm = await rawGet(server.base, route, { cookie, 'Accept-Encoding': 'br', 'If-None-Match': first.headers.etag });
    assert.equal(nm.status, 304);

    // Sheet me ek cell badla (5555 → 5556): length, head aur tail bilkul same — ETag fir bhi badalna chahiye.
    const next = gvizBody(5556);
    assert.equal(next.length, current.length);
    current = next;
    const fresh = await rawGet(server.base, `${route}&fresh=1`, { cookie, 'Accept-Encoding': 'br' });
    assert.equal(fresh.status, 200);
    assert.notEqual(fresh.headers.etag, first.headers.etag, 'same-length edit ko naya ETag milna chahiye');
    assert.equal(zlib.brotliDecompressSync(fresh.body).toString('utf8'), next, 'compressed copy naye body ki hai, purane ki nahi');
    // Purana ETag ab 304 nahi, poora naya data milta hai.
    const stale = await rawGet(server.base, route, { cookie, 'Accept-Encoding': 'br', 'If-None-Match': first.headers.etag });
    assert.equal(stale.status, 200);
    assert.equal(zlib.brotliDecompressSync(stale.body).toString('utf8'), next);
  } finally {
    await server.stop();
    upstream.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('source wiring: memo passed to sendMaybeCompressed for static + gviz, async warm for static', async () => {
  const src = await fs.readFile(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(src, /sendMaybeCompressed\(req, res, 200, type, slot\.raw, extraHeaders, slot\.enc\)/);
  assert.match(src, /await warmEncoding\(req, slot\.raw, slot\.enc\)/);
  assert.match(src, /'X-FF-Age': String\(Math\.round\(\(Date\.now\(\) - entry\.at\) \/ 1000\)\)\s*\n\s*\}, entry\.enc\)/);
  assert.match(src, /function entryEtag\(entry\)/);
  assert.doesNotMatch(src, /const key = `\$\{body\.length\}:\$\{body\.slice\(0, 64\)\}/, 'weak ETag key hata diya');
});
