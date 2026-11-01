/* Oracle deploy kit: files present, scripts valid bash, service raises the Render memory caps. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const d = (f) => new URL(`../deploy/oracle/${f}`, import.meta.url);
test('oracle deploy kit', () => {
  for (const f of ['setup.sh', 'update.sh', 'ffdash.service', 'ffdash-update.service', 'ffdash-update.timer', 'Caddyfile', 'ffdash.env.example', 'README.md']) assert.ok(fs.existsSync(d(f)), f);
  execFileSync('bash', ['-n', d('setup.sh').pathname]); execFileSync('bash', ['-n', d('update.sh').pathname]);
  const svc = fs.readFileSync(d('ffdash.service'), 'utf8');
  assert.match(svc, /--max-old-space-size=4096/);
  const env = fs.readFileSync(d('ffdash.env.example'), 'utf8');
  assert.match(env, /MEM_HARD_MB=3800/); assert.match(env, /PORT=10000/);
  assert.match(fs.readFileSync(d('Caddyfile'), 'utf8'), /reverse_proxy 127\.0\.0\.1:10000/);
});
