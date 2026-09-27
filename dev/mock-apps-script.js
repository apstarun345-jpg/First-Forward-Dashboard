// Local stand-in for google-apps-script/Code.gs (tests only).
// Mirrors real Google behaviour: POST /macros/s/<id>/exec → 302 redirect → GET returns the JSON result.
import http from 'node:http';

export function startMockAppsScript({ secret, spreadsheet = 'Mock Sheet' } = {}) {
  const records = {};
  const results = new Map();
  const calls = [];
  let seq = 0;
  let failNext = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/echo') {
      const out = results.get(url.searchParams.get('id'));
      results.delete(url.searchParams.get('id'));
      res.writeHead(out ? 200 : 404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(out || { ok: false, error: 'expired' }));
    }
    if (req.method !== 'POST' || !url.pathname.endsWith('/exec')) { res.writeHead(404); return res.end('nope'); }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (failNext > 0) { failNext--; res.writeHead(503); return res.end('busy'); }
      let body = {}; try { body = JSON.parse(raw); } catch { /* invalid */ }
      calls.push({ action: body.action, kinds: body.records ? Object.keys(body.records) : [] });
      let out;
      if (body.secret !== secret) out = { ok: false, error: 'unauthorized (secret mismatch)' };
      else if (body.action === 'ping') out = { ok: true, tab: 'APP_STORAGE', spreadsheet };
      else if (body.action === 'read') out = { ok: true, records: structuredClone(records) };
      else if (body.action === 'write') { Object.assign(records, body.records || {}); out = { ok: true, savedAt: new Date().toISOString(), kinds: Object.keys(body.records || {}) }; }
      else out = { ok: false, error: 'unknown action' };
      const id = String(++seq);
      results.set(id, out);
      res.writeHead(302, { Location: `/echo?id=${id}` });
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve({ url: `http://127.0.0.1:${port}/macros/s/mock/exec`, records, calls, failWrites(n) { failNext = n; }, close: () => new Promise((r) => server.close(r)) });
  }));
}
