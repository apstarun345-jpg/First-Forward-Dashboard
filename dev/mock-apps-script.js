// Local stand-in for google-apps-script/Code.gs (tests only).
// Mirrors real Google behaviour: POST /macros/s/<id>/exec → 302 redirect → GET returns the JSON result.
import http from 'node:http';

export function startMockAppsScript({ secret, spreadsheet = 'Mock Sheet' } = {}) {
  const records = {};
  const history = []; // ⏪ APP_STORAGE_HISTORY — har overwrite se pehle purana encrypted record (row = index + 2)
  const results = new Map();
  const calls = [];
  const mails = [];
  const appends = []; // 📗 appendrows (tag request sheet sync) — { tab, header, rows, atRow }
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
      else if (body.action === 'ping') out = { ok: true, tab: 'APP_STORAGE', spreadsheet, url: 'https://docs.google.com/spreadsheets/d/mock/edit' };
      else if (body.action === 'read') out = { ok: true, records: structuredClone(records) };
      else if (body.action === 'write') {
        const at = new Date().toISOString();
        // Real Code.gs ki tarah: overwrite se pehle purana record history me chala jaata hai.
        for (const [kind, rec] of Object.entries(body.records || {})) {
          if (records[kind]) history.push({ savedAt: at, kind, v: records[kind].v, data: records[kind].data });
          records[kind] = rec;
        }
        out = { ok: true, savedAt: at, kinds: Object.keys(body.records || {}) };
      }
      else if (body.action === 'history') {
        const want = Array.isArray(body.rows) ? body.rows.map(Number) : null;
        const entries = history.map((h, i) => ({
          row: i + 2, savedAt: h.savedAt, kind: h.kind, version: h.v,
          chunks: Math.max(1, Math.ceil(String(h.data || '').length / 45000)),
          bytes: Math.max(1, Math.ceil(String(h.data || '').length / 45000)) * 45000
        })).filter((e) => !want || want.includes(e.row));
        if (body.withData) for (const e of entries) e.data = history[e.row - 2].data;
        entries.reverse(); // nayi pehle
        out = { ok: true, tab: 'APP_STORAGE_HISTORY', entries, truncated: false };
      }
      else if (body.action === 'mailping') out = { ok: true, quota: 99, account: 'owner@example.test' };
      else if (body.action === 'mail') { mails.push(body.mail); out = { ok: true, sent: String((body.mail || {}).to || '').split(',').length, quota: 98 }; }
      else if (body.action === 'sheettest') {
        const tab = String(body.tab || 'Tag Requests');
        const id = String(body.spreadsheetId || 'mock-own-sheet-id');
        out = { ok: true, spreadsheet, spreadsheetId: id, url: `https://docs.google.com/spreadsheets/d/${id}/edit`, tab, exists: false };
      }
      else if (body.action === 'appendrows') {
        const tab = String(body.tab || 'Tag Requests');
        const targetId = String(body.spreadsheetId || 'mock-own-sheet-id');
        if (tab === 'APP_STORAGE' && !body.spreadsheetId) out = { ok: false, error: 'APP_STORAGE tab me likhna allowed nahi' };
        else {
          const rows = Array.isArray(body.rows) ? body.rows : [];
          const key = `${targetId}|${tab}`;
          const tabState = appends.find((t) => t.key === key) || { key, tab, spreadsheetId: body.spreadsheetId || '', header: null, rows: [] };
          if (!appends.includes(tabState)) appends.push(tabState);
          if (!tabState.header && Array.isArray(body.header) && body.header.length) tabState.header = body.header.slice();
          const atRow = tabState.rows.length + (tabState.header ? 2 : 1);
          tabState.rows.push(...rows);
          out = { ok: true, tab, added: rows.length, atRow, spreadsheet, spreadsheetId: targetId, url: `https://docs.google.com/spreadsheets/d/${targetId}/edit` };
        }
      }
      else out = { ok: false, error: 'unknown action' };
      const id = String(++seq);
      results.set(id, out);
      res.writeHead(302, { Location: `/echo?id=${id}` });
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve({ url: `http://127.0.0.1:${port}/macros/s/mock/exec`, records, history, calls, mails, appends, failWrites(n) { failNext = n; }, close: () => new Promise((r) => server.close(r)) });
  }));
}
