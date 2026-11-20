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

test('live intent — accuracy: purana signal ho to kuch claim nahi; sharing off ho to saaf bolo', () => {
  const base = { page: 'tagIssued', online: true, visible: true, lastSeen: now - 2e3, updatedAt: now - 1e3, events: [{ at: now - 3e3, kind: 'search', label: 'RJ14' }] };
  const stale = intentOf({ ...base, updatedAt: now - 60e3, online: true }, now);
  assert.match(stale.head, /band \/ tab chhupa/); assert.equal(stale.online, false);
  assert.match(intentOf({ ...base, sharing: false, events: [] }, now).head, /live sharing allow nahi/);
  assert.match(intentOf(base, now).lastAction, /RJ14/);
});
test('server: live events turant notification me', async () => {
  const fs = await import('node:fs');
  const srv = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(srv, /function liveEventNotify/); assert.match(srv, /liveEventNotify\(`u:/); assert.match(srv, /liveEventNotify\(`p:/); assert.match(srv, /userLive: 'admin'/);
});

test('live intent — dusri window / PC lock / idle', () => {
  const base = { page: 'stock', online: true, visible: true, sharing: true, lastSeen: now - 2e3, updatedAt: now - 1e3, events: [] };
  assert.match(intentOf({ ...base, focus: false, awaySince: now - 30e3 }, now).head, /window active nahi.*30s/);
  assert.match(intentOf({ ...base, screenState: 'locked' }, now).head, /PC lock/);
  assert.match(intentOf({ ...base, idleState: 'idle' }, now).head, /PC par 1 min/);
  assert.match(intentOf({ ...base, visible: false, awaySince: now - 125e3 }, now).head, /2m 5s se/);
});
