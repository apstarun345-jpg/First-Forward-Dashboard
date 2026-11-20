import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const srv = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('v3.125.358 — direct agents + TLs ke updates, TL ke agents chup', () => {
  assert.match(srv, /function entityWatchTick/);
  assert.match(srv, /entityUpdate: 'admin'/);
  assert.match(srv, /robotScopeFilter\(items\)/);
  assert.match(srv, /plScope !== 'tlAgent'/);
  assert.equal((srv.match(/notifyTagReq\(/g) || []).length >= 6, true);   // 1 definition + 5 sites
  // helper logic (registry) — same code ko alag se chalake dekho
  const reg = srv.slice(srv.indexOf('const entNorm'), srv.indexOf('let entityWatchBusy'));
  const ctx = {};
  new Function('ctx', 'recordNotification', `${reg}; ctx.build = entityRegBuild; ctx.scope = entityScope; ctx.filter = robotScopeFilter; ctx.tag = notifyTagReq;`)(ctx, (p) => p);
  ctx.build([
    { ch: 'ff', agentName: 'Ram Singh', agentId: '1001', direct: true },
    { ch: 'ff', agentName: 'Shyam Kumar', agentId: '1002', tlName: 'Mohan Lal', tlId: '9', direct: false },
    { ch: 'gv', agentName: 'Geeta Devi', agentId: '2001', tlName: 'Mohan Lal', tlId: '9', direct: false }
  ]);
  assert.equal(ctx.scope('Ram Singh'), 'direct');
  assert.equal(ctx.scope('Mohan Lal'), 'tl');
  assert.equal(ctx.scope('SHYAM KUMAR'), 'tlAgent');
  assert.equal(ctx.scope('Koi Aur'), '');
  const out = ctx.filter([{ title: 'Top: Shyam Kumar', body: 'x' }, { title: 'Top 10', body: '• Ram Singh — 10\n• Geeta Devi — 5\n• Mohan Lal — 40' }]);
  assert.equal(out.length, 1); assert.equal(out[0].body, '• Ram Singh — 10\n• Mohan Lal — 40');
  assert.equal(ctx.tag(['Shyam Kumar', 'Geeta Devi'], { body: 'a' }), null);
  assert.equal(ctx.tag(['Shyam Kumar', 'Ram Singh'], { body: 'Shyam Kumar 5, Ram Singh 3' }).body, '— 5, Ram Singh 3');
});
