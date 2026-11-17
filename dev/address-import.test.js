import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { parseAddressText, parseTable, csvMatrix, parseAnyFile, dedupeEntries, pdfText, normMobile } from '../address-import.js';

test('text: labels, mixed order, spaced mobile, pincode label', () => {
  const t = `Name – Pushpak Singade\nMo. - 8975505302\nShree Gajanan Shop 10 Nashik 422003\n\nNAME - Kumar Rajak\nAdd- Madai Toll Plaza Seoni\nPin Code 480886\nMo. No. 88393 42142\n\nName -TAHIR ALI\nMOBILE NUMBER – 9012474646\nAdd- Village Milak Rampur 244901`;
  const e = parseAddressText(t);
  assert.equal(e.length, 3);
  assert.deepEqual([e[0].name, e[0].mobile, e[0].pincode], ['Pushpak Singade', '8975505302', '422003']);
  assert.equal(e[1].mobile, '8839342142'); assert.equal(e[1].pincode, '480886'); assert.match(e[1].address, /Madai Toll Plaza Seoni/);
  assert.equal(e[2].mobile, '9012474646'); assert.equal(e[2].address.startsWith('Village Milak'), true);
});
test('text: typo label and glued next record', () => {
  const e = parseAddressText('Name - A Kumar Mo - 9111111111 Add - Road 1 110001 nmae – B Singh mo - 9222222222 Add - Lane 2 220002');
  assert.equal(e.length, 2);
  assert.equal(e[1].name, 'B Singh'); assert.equal(e[1].mobile, '9222222222');
});
test('text: no Name labels → blank-line blocks', () => {
  const e = parseAddressText('Ravi Kumar\n9876543210\nHouse 4 Delhi 110045\n\nSita Devi\n9123456789\nVillage X 226001');
  assert.equal(e.length, 2); assert.equal(e[0].name, 'Ravi Kumar'); assert.equal(e[1].pincode, '226001');
});
test('table: header columns, any order', () => {
  const csv = 'Agent ID,Agent Name,Mobile No,Address,Pincode,TL,Channel\nA1,Ravi,98765 43210,"H 4, Delhi",110045,Tl One,GV Partner\nB2,Sita,9123456789,Lane 2,226001,,FF';
  const e = parseTable(csvMatrix(csv));
  assert.equal(e.length, 2);
  assert.deepEqual([e[0].id, e[0].name, e[0].mobile, e[0].pincode, e[0].tl, e[0].channel], ['A1', 'Ravi', '9876543210', '110045', 'Tl One', 'gv']);
  assert.equal(e[1].channel, 'ff');
});
test('dedupe: same mobile merges, later wins, blanks filled', () => {
  const d = dedupeEntries([{ name: 'A', mobile: '9111111111', address: 'old addr 110001', pincode: '110001', flags: [] }, { name: 'A', mobile: '9111111111', address: '', pincode: '', tl: 'T', flags: [] }, { name: 'A', mobile: '9111111111', address: 'new addr 220002', pincode: '220002', flags: [] }]);
  assert.equal(d.length, 1); assert.equal(d[0].address, 'new addr 220002'); assert.equal(d[0].tl, 'T'); assert.equal(d[0].seen, 3);
});
test('mobile normaliser', () => { assert.equal(normMobile('+91 98765-43210'), '9876543210'); assert.equal(normMobile('12345'), ''); });

function tinyPdf(runs) {   // 1 page, Helvetica, runs = [x,y,text]
  const body = runs.map(([x, y, t]) => `BT /F1 10 Tf 1 0 0 1 ${x} ${y} Tm (${t}) Tj ET`).join('\n');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const stream = zlib.deflateSync(Buffer.from(body));
  let out = '%PDF-1.4\n';
  objs.forEach((o, i) => { out += o === null ? `${i + 1} 0 obj\n<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n` : `${i + 1} 0 obj\n${o}\nendobj\n`; if (o === null) out = Buffer.concat([Buffer.from(out, 'latin1'), stream, Buffer.from('\nendstream\nendobj\n')]).toString('latin1'); });
  return Buffer.from(out + 'trailer\n<< /Root 1 0 R >>\n%%EOF', 'latin1');
}
test('pdf: 2 columns read column by column, not row by row', () => {
  const runs = [];
  [['Name - Left One', 'Mo. - 9111111111', 'Add- Left Road 110001'], ['Name - Left Two', 'Mo. - 9222222222', 'Add- Left Lane 220002']].forEach((blk, k) => blk.forEach((t, i) => runs.push([50, 780 - k * 90 - i * 14, t])));
  [['Name - Right One', 'Mo. - 9333333333', 'Add- Right Road 330003'], ['Name - Right Two', 'Mo. - 9444444444', 'Add- Right Lane 440004']].forEach((blk, k) => blk.forEach((t, i) => runs.push([320, 780 - k * 90 - i * 14, t])));
  const buf = tinyPdf(runs);
  assert.match(pdfText(buf), /Left One[\s\S]*Left Two[\s\S]*Right One/);
  const { kind, entries } = parseAnyFile('x.pdf', buf);
  assert.equal(kind, 'pdf');
  assert.deepEqual(entries.map((e) => e.mobile), ['9111111111', '9222222222', '9333333333', '9444444444']);
  assert.equal(entries[2].address, 'Right Road 330003');
});
test('any file: txt and csv routes', () => {
  assert.equal(parseAnyFile('a.txt', Buffer.from('Name: X Y\nMo: 9555555555\nAdd: Z 100001')).entries[0].mobile, '9555555555');
  assert.equal(parseAnyFile('a.csv', Buffer.from('name,mobile,address\nQ,9666666666,Road 5 200002')).entries[0].pincode, '200002');
});
