/* v3.32 — PDF container, tag-request label PDF + TL record, retry wiring. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { documentElement: { dataset: {}, style: {} }, body: { classList: { add() {}, remove() {} } }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, getContext: () => null }) };
globalThis.addEventListener = () => {};
['config', 'util', 'pdf'].forEach((f) => require(path.join(ROOT, `${f}.js`)));
const FF = globalThis.FF;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const d = (key, agent, n, extra) => ({ key, ym: key.slice(0, 7), channel: 'First Forward', agentId: agent, agentName: agent, tlName: 'TL1', n, type: 'ISSUANCE', vrnType: 'New', ...(extra || {}) });

test('pdf: build() makes a valid multi-object PDF container from canvases', () => {
  const fake = { width: 10, height: 10, toDataURL: () => 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' };
  const blob = FF.pdf.build([fake, fake]);
  assert.equal(blob.type, 'application/pdf');
  return blob.arrayBuffer().then((buf) => {
    const txt = Buffer.from(buf).toString('latin1');
    assert.match(txt, /^%PDF-1\.4/);
    assert.match(txt, /\/Count 2/);
    assert.match(txt, /startxref\n\d+\n%%EOF$/);
    assert.equal((txt.match(/\/DCTDecode/g) || []).length, 2);
  });
});

test('wiring: print popup no longer relies on inline script (CSP), PDF buttons + TL/dispatch name exist', () => {
  const tr = read('tagRequest.js'), srv = read('server.js'), lazy = read('lazy.js'), app = read('app.js');
  assert.ok(!/<script>\(function\(\)\{\s*var H=/.test(tr), 'inline script must be gone');
  assert.match(tr, /wireLabelWindow/);
  assert.match(tr, /data-tr-bulk="pdf"/);
  assert.match(tr, /data-tr-a="dispatchName"/);
  assert.match(srv, /dispatchName/);
  assert.match(lazy, /ffAgentSummary: \[[^\]]*'agentSummary'[^\]]*\]/, 'FF summary group me agentSummary ho');
  assert.match(lazy, /gvAgentSummary: \[[^\]]*'gvpages'[^\]]*'agentSummary'[^\]]*\]/, 'GV summary group me legacy + naya UI dono');
  assert.match(lazy, /gvAgentSummary: \[[^\]]*'gvTruth'[^\]]*'summaryUI'[^\]]*\]/, 'GV summary ka naya engine + UI wired ho');
  assert.match(lazy, /ffAgentSummary: \[[^\]]*'gvTruth'[^\]]*'summaryUI'[^\]]*\]/, 'FF summary bhi naya UI use kare');
  assert.match(app, /id: 'gvAgentSummary'/);
  assert.match(srv, /key: 'agentSummary'/);
  assert.match(read('store.js'), /scheduleRetry/); assert.match(read('gv.js'), /scheduleRetry/); assert.match(read('data.js'), /Auto-retry/);
});
