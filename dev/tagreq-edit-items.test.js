import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
const __dirname = new URL('.', import.meta.url).pathname;
const src = fs.readFileSync(__dirname + '/../tagRequest.js', 'utf8');
const srv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
test('edit opens item-specific editors', () => {
  assert.match(src, /editing && !hasItem\('FASTag', dr\.req\.itemName\)/);
  assert.match(src, /data-tr-efield/);
  assert.match(src, /payload\[k\] = clean\(ed\[k\]\)/);
});
test('server PUT accepts serial/device/material', () => {
  assert.match(srv, /\['serialNumber', 100\], \['deviceName', 120\], \['materialDescription', 200\]\]\) if \(body\[k\] !== undefined\)/);
});
