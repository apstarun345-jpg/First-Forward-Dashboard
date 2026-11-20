// v3.125.379 — Agents full-screen map: Leaflet local (CSP self), pins + filters + near-me list (jsdom smoke).
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
let JSDOM = null;
try { JSDOM = createRequire(import.meta.url)('jsdom').JSDOM; } catch { try { JSDOM = createRequire(process.env.JSDOM_FROM || '/tmp/jd/x.js')('jsdom').JSDOM; } catch { JSDOM = null; } }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('CSP allows map tiles; vendor files present; server module blocked', () => {
  const s = read('server.js');
  assert.match(s, /img-src 'self' data: blob: https:\/\/tile\.openstreetmap\.org https:\/\/server\.arcgisonline\.com;/);
  assert.match(s, /script-src 'self'/, 'bahar ki script nahi');
  assert.match(s, /BLOCKED_FILES = new Set\(\['server\.js', 'issuedBarcodes\.js'/);
  ['vendor-leaflet.js', 'vendor-leaflet-cluster.js', 'vendor-leaflet.css'].forEach((f) => assert.ok(fs.statSync(path.join(ROOT, f)).size > 500, f));
});

test('full-screen map opens with clustered pins, filters and geolocation', { skip: !JSDOM && 'jsdom nahi hai' }, async () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://x.test/' });
  const w = dom.window;
  w.SVGSVGElement.prototype.createSVGRect = () => ({}); w.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });
  w.eval(read('vendor-leaflet.js')); w.eval(read('vendor-leaflet-cluster.js'));
  let watched = null;
  Object.defineProperty(w.navigator, 'geolocation', { value: { watchPosition: (ok) => { watched = ok; return 1; }, clearWatch() {} } });
  const toasts = [];
  w.FF = { util: { esc: (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])), fmt: (n) => String(n), spinner: (t) => t, toast: (m) => toasts.push(m) },
    auth: { api: async (u) => { assert.match(u, /geo=1/); return { rows: [
      { key: 'a', name: 'Rahul Sahu', id: '32603407', mobile: '8305115480', tl: 'APS', address: 'Korba', pincode: '495445', channel: 'ff' },
      { key: 'b', name: 'Mukesh Yadav', id: 'APS011961', mobile: '7347809270', tl: 'TL Two', address: 'Jaunpur', pincode: '222136', channel: 'gv' },
      { key: 'c', name: 'Bad Pin', id: '1', mobile: '9999999999', tl: 'APS', address: 'x', pincode: '000000', channel: 'ff' }],
      pins: { 495445: [22.3, 82.6, 'Korba', 'Chhattisgarh'], 222136: [25.7, 82.7, 'Jaunpur', 'Uttar Pradesh'] } }; } } };
  w.eval(read('addressMap.js'));
  const act = new Map([['ff|32603407', { status: 'active', lastActive: 'Active today' }]]);
  await w.FF.addressMap.open({ channel: 'all', q: '', fields: ['name'], kf: '', loadActivity: async () => act, actOf: (m, r) => m.get(`${r.channel}|${r.id}`) || null });
  const doc = w.document;
  assert.ok(doc.getElementById('amx'), 'overlay khula');
  assert.match(doc.getElementById('amx-sub').textContent, /2 agents map par · 2 pincode · 1 ka pincode galat/);
  assert.match(doc.getElementById('amx-chips').textContent, /Active 1/);
  assert.ok(doc.querySelector('.leaflet-control-zoom'), 'zoom +/-');
  assert.ok(doc.querySelector('.leaflet-control-layers'), 'layer switcher');
  // TL filter
  const tl = doc.getElementById('amx-tl'); assert.match(tl.innerHTML, /TL Two/);
  tl.value = 'TL Two'; tl.onchange();
  assert.match(doc.getElementById('amx-sub').textContent, /^1 agents/);
  tl.value = ''; tl.onchange();
  // bad pincode tab
  doc.querySelector('[data-tab="bad"]').click();
  assert.match(doc.getElementById('amx-list').textContent, /Bad Pin/);
  // my location → near list sorted by km
  doc.getElementById('amx-me').onclick();
  watched({ coords: { latitude: 25.6, longitude: 82.6, accuracy: 30 } });
  assert.match(doc.getElementById('amx-me').textContent, /Live/);
  const near = doc.getElementById('amx-list').textContent;
  assert.ok(near.indexOf('Mukesh Yadav') > -1 && near.indexOf('Mukesh Yadav') < near.indexOf('Rahul Sahu'), 'paas wala pehle');
  assert.match(near, /km/);
  // Esc closes
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(doc.getElementById('amx'), null);
});
