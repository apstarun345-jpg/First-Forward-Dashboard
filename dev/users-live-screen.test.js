import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('Users tab: live status badge, Live screen button, online strip', () => {
  const s = read('settings.js');
  assert.match(s, /data-user-live/);
  assert.match(s, /data-u-live=/);
  assert.match(s, /u-live-strip/);
  assert.match(s, /FF\.liveView\.watch\(username\)/);
  assert.match(s, /\/api\/presence'\)/);
  assert.match(read('dev/styles-full.css'), /\.u-live-chip/);
});
