import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const sb = { console, setTimeout, performance, URL }; vm.createContext(sb); sb.globalThis = sb;
vm.runInContext(fs.readFileSync(new URL('../scanVision.js', import.meta.url), 'utf8'), sb);
const V = sb.FF.scanVision;
test('parse16: 16 digit barcode, extra digit tolerance', () => {
  assert.equal(V.parse16('6081160350611445'), '608116-035-0611445');
  assert.equal(V.parse16('608116-035-0611445'), '608116-035-0611445');
  assert.equal(V.parse16('12345'), '');
  assert.equal(V.parse16('06081160350611445'), '608116-035-0611445');
});
test('textCodes: OCR text (space / kachra) se number', () => {
  assert.deepEqual(V.textCodes('-\n608116-035-0611 445\n'), ['608116-035-0611445']);
  assert.deepEqual(V.textCodes('1116-0290465177'), []);
  assert.deepEqual(V.textCodes('608116-029-0465177 x 608116-021-0355380'), ['608116-029-0465177', '608116-021-0355380']);
});
test('libs shipped + CSP allows wasm', () => {
  for (const f of ['zbar-wasm.js', 'tesseract.min.js', 'ocr-worker.min.js', 'tesseract-core-simd-lstm.wasm.js', 'eng.traineddata.gz', 'zxing.min.js']) assert.ok(fs.statSync(new URL('../libs/' + f, import.meta.url)).size > 50000, f);
  assert.match(fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8'), /script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:/);
});
