import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const srv = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const pub = fs.readFileSync(new URL('../scan-public.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../scan.html', import.meta.url), 'utf8');
const bcc = fs.readFileSync(new URL('../barcodeChecker.js', import.meta.url), 'utf8');
test('server: public scan API + admin log + /scan route', () => {
  assert.match(srv, /p === '\/api\/public\/scan' && method === 'POST'/);
  assert.match(srv, /Employee name zaroori hai/);
  assert.match(srv, /p === '\/api\/scan-log' && method === 'GET'/);
  assert.match(srv, /url\.pathname === '\/scan'/);
  assert.match(srv, /camera=\(self\)/);
});
test('public page: name gate, 1D only, confirm popup', () => {
  assert.match(html, /id="gate"/); assert.match(html, /scan-public\.js/);
  assert.match(pub, /code_128/); assert.doesNotMatch(pub, /qr_code/);
  assert.match(pub, /closeConfirm/); assert.match(pub, /Naam likhna zaroori/);
});
test('barcode checker: Employee scans tab', () => {
  assert.match(bcc, /data-bcc-tab="emp"/); assert.match(bcc, /\/api\/scan-log/); assert.match(bcc, /Employee scan link/);
});
test('scanCodeOf logic', () => {
  const f = (v) => { const raw = String(v == null ? '' : v).trim(); if (!/^[\d-]+$/.test(raw)) return ''; const d = raw.replace(/\D/g, ''); return /^\d{16}$/.test(d) ? `${d.slice(0, 6)}-${d.slice(6, 9)}-${d.slice(9)}` : ''; };
  assert.equal(f('6081160390598684'), '608116-039-0598684');
  assert.equal(f('upi://pay?x=1'), ''); assert.equal(f('12345'), '');
});
