import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('Home no longer renders or loads the animated new joiners section', async () => {
  const home = await fs.readFile(new URL('../home.js', import.meta.url), 'utf8');
  const styles = await fs.readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(home, /home-joiners|homeJoiner|mountHomeJoiners|data-hj-/);
  assert.doesNotMatch(styles, /\.hj-card|@keyframes hj-scroll/);
  assert.match(home, /home-target-alerts/);
  assert.match(home, /GV tags · not in FF stock/);
  const server = await fs.readFile(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /data-pl-welcome/, 'personal link welcome remains available');
});
