import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const FF = { util: { esc: (s) => String(s), fmt: (n) => String(n), timeLabel: () => '' }, app: { PAGES: [{ id: 'tagIssued', label: 'Tag Issued' }] }, auth: {} };
vm.runInNewContext(readFileSync(new URL('../liveView.js', import.meta.url), 'utf8'), { window: { FF, addEventListener() {} }, document: { addEventListener() {}, body: {} }, localStorage: { getItem() { return null; } }, console });
const { intentOf } = FF.liveView;
const now = 1e12;

test('live intent — kya kar raha hai', () => {
  const base = { page: 'tagIssued', online: true, visible: true, lastSeen: now - 2e3, updatedAt: now - 1e3, viewport: { w: 1280, h: 800 }, scroll: { y: 400, h: 2000 }, events: [] };
  assert.match(intentOf({ ...base, visible: false }, now).head, /tab par nahi/);
  assert.match(intentOf({ ...base, events: [{ at: now - 3e3, kind: 'search', label: 'RJ14' }] }, now).head, /RJ14/);
  assert.match(intentOf({ ...base, events: [{ at: now - 3e3, kind: 'click', label: 'Export' }] }, now).head, /Export/);
  assert.match(intentOf({ ...base, lastSeen: now - 90e3 }, now).head, /1m 30s se kuch nahi/);
  assert.match(intentOf({ ...base, overlay: 'Drawer: Stock' }, now).head, /Drawer: Stock/);
  const it = intentOf({ ...base, events: [{ at: now - 50e3, kind: 'page', label: 'home' }, { at: now - 20e3, kind: 'search', label: 'A' }, { at: now - 19e3, kind: 'search', label: 'B' }] }, now);
  assert.equal(it.counts.search, 2); assert.deepEqual([...it.searches], ['B', 'A']); assert.match(it.trail.join('>'), /home>Tag Issued/i);
});
