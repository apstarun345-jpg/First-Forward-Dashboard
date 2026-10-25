// v3.90 — GV agent / TL latest commission map (GV Master: product_id L → commission M, latest by date P).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const grab = (start, end) => { const a = src.indexOf(start); assert.ok(a >= 0, `missing ${start}`); const b = src.indexOf(end, a); assert.ok(b > a, `missing ${end}`); return src.slice(a, b); };
const mk = (a, r, c, l, m, d) => ({ c: [{ v: a }, { v: r }, { v: c }, { v: l }, { v: m }, { v: d }, { v: 'N-' + a }, { v: 'TN-' + r }, { v: 'VC4' }] });

function loadBuilder(rows, seen) {
  const code = [
    grab('function serverCell(row, index)', 'const SERVER_MONTHS'),
    grab('const SERVER_MONTHS', 'function serverDateFromCell'),
    grab('function serverDateFromCell', '/**\n * 🛡️ Grouped'),
    grab('function gvcSheetId', 'async function gvAgentCommission(force)')
  ].join('\n');
  return new Function('fetchUpstreamCached', 'upstreamUrl', 'parseGvizServer',
    `${code}\nreturn { build: buildGvAgentCommission, sheetId: gvcSheetId };`)(
    async (url) => { seen.push(url); return { body: 'x' }; }, (p) => p.get('tq'), () => ({ rows }));
}
const CFG = { agentCol: 'A', tlCol: 'R', tlFallbackCol: 'C', productCol: 'L', commissionCol: 'M', dateCol: 'P', agentNameCol: 'B', tlNameCol: 'D', classCol: 'G', classFallbackCol: 'F', productId: '100000007832', tab: 'GV Master', label: 'VC4', suffix: '/tag', currency: '₹' };

test('latest commission per agent (by date), zero ignored, TL max via fallback column', async () => {
  const seen = [];
  const rows = [
    mk('APS1', 'TL1', 'TL0', '100000007832', 110, 'Date(2026,7,10)'),
    mk('APS1', 'TL1', 'TL0', '100000007832', 130, 'Date(2026,7,12)'),
    mk('APS1', 'TL1', 'TL0', '100000007832', 90, 'Date(2026,7,5)'),
    mk('APS2', '', 'TL1', '100000007832', 147, 'Date(2026,7,11)'),
    mk('APS3', 'TL2', '', '100000007832', 0, 'Date(2026,7,11)'),
    mk('UNIQUE_ID', 'x', 'x', '100000007832', 1, 'Date(2026,7,11)')
  ];
  const out = await loadBuilder(rows, seen).build(CFG, 'sheetid');
  assert.equal(out.agents.APS1.a, 130);
  assert.equal(out.agents.APS2.a, 147);
  assert.equal(out.agents.APS3, undefined);
  assert.deepEqual(out.tls.TL1, { max: 147, min: 130, n: 2 });
  assert.match(seen[0], /select A, R, C, L, M, P, B, D, G, F where L = '100000007832'/);
});

test('sheet link / ID parsing and columns come from settings', () => {
  const { sheetId } = loadBuilder([], []);
  assert.equal(sheetId({ sheetLink: 'https://docs.google.com/spreadsheets/d/1AbC_dEf-1234567890/edit#gid=0' }, { gvSheetId: 'fallback' }), '1AbC_dEf-1234567890');
  assert.equal(sheetId({ sheetLink: '' }, { gvSheetId: 'fallback-id' }), 'fallback-id');
  assert.match(src, /gvAgentCommission: \{ enabled: true, sheetLink: '', tab: 'GV Master', agentCol: 'A'/);
  assert.match(src, /p === '\/api\/gv-agent-commission'/);
});
