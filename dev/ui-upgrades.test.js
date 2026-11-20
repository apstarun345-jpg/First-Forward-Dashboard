import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Pincode public API endpoint and geo lookup', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-upgrades-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, STORAGE_BACKEND: 'files', PORT: '0', DATA_DIR: dir, ADMIN_USER: 'owner', ADMIN_PASSWORD: 'initial-password', RENDER: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let logs = '';
  child.stderr.on('data', (d) => { logs += d; });

  try {
    const base = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(logs || 'timeout')), 15000);
      timeout.unref();
      child.stdout.on('data', (d) => {
        logs += d;
        const m = logs.match(/http:\/\/0\.0\.0\.0:(\d+)/);
        if (m && m[1] !== '0') {
          clearTimeout(timeout);
          resolve(`http://127.0.0.1:${m[1]}`);
        }
      });
      child.on('exit', (code) => reject(new Error(`server exited ${code}: ${logs}`)));
    });

    // Valid pincode: 302019 (Jaipur, Rajasthan)
    const res1 = await fetch(`${base}/api/public/pincode?pin=302019`);
    assert.equal(res1.status, 200);
    const json1 = await res1.json();
    assert.equal(json1.ok, true);
    assert.match(json1.district, /jaipur/i);
    assert.match(json1.state, /rajasthan/i);

    // Invalid / short pincode: 123
    const res2 = await fetch(`${base}/api/public/pincode?pin=123`);
    assert.equal(res2.status, 200);
    const json2 = await res2.json();
    assert.equal(json2.ok, false);

    // Non-existent pincode: 999999
    const res3 = await fetch(`${base}/api/public/pincode?pin=999999`);
    assert.equal(res3.status, 200);
    const json3 = await res3.json();
    assert.equal(json3.ok, false);
  } finally {
    child.kill('SIGTERM');
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

test('NPCI FASTag class badges and skeleton loaders exist in stylesheets', async () => {
  const css = await fs.readFile(path.join(root, 'styles.css'), 'utf8');

  // NPCI class badges
  assert.match(css, /\.badge-vc\.vc4/);
  assert.match(css, /\.badge-vc\.vc5/);
  assert.match(css, /\.badge-vc\.vc6/);
  assert.match(css, /\.badge-vc\.vc7/);
  assert.match(css, /\.badge-vc\.vc12/);
  assert.match(css, /\.badge-vc\.vc16/);
  assert.match(css, /\.badge-vc\.vc20/);
  assert.match(css, /\.badge-vc\.vc5p/);

  // Shimmer skeleton loaders
  assert.match(css, /polishShimmer/);
  assert.match(css, /\.sk-kpis/);
  assert.match(css, /\.sk-line/);
  assert.match(css, /\.sk-tbl-wrap/);

  // Responsive card mode and desktop sticky columns
  assert.match(css, /\.tbl-responsive-cards/);
  assert.match(css, /\.tbl-sticky-first/);

  // Mobile bottom sheet & dark mode drawer contrast
  assert.match(css, /html\[data-theme="dark"\] \.drawer-head/);
  assert.match(css, /@media \(max-width: 768px\) \{\s*\.drawer/);

  // Toast mobile nav safe positioning
  assert.match(css, /@media \(max-width: 768px\) \{\s*\.toast/);

  // Modern empty state
  assert.match(css, /\.empty-state \.empty-icon/);
  assert.match(css, /\.empty-state \.empty-title/);
});

test('Tag Request form has progress stepper, quick quantity shortcuts, and pincode geo auto-fill', async () => {
  const tr = await fs.readFile(path.join(root, 'tagRequest.js'), 'utf8');

  // Progress stepper
  assert.match(tr, /tr-form-stepper/);
  assert.match(tr, /tr-step/);
  assert.match(tr, /updateStepper/);

  // Quick quantity buttons
  assert.match(tr, /tr-qadd/);
  assert.match(tr, /tr-qall/);
  assert.match(tr, /tr-qclear/);
  assert.match(tr, /badge-vc/);

  // Pincode auto-fill
  assert.match(tr, /tr-pin-geo/);
  assert.match(tr, /\/api\/public\/pincode/);
  assert.match(tr, /tr-pin-append/);
});

test('Personal links include gamified target progress, streaks, and dark mode toggle', async () => {
  const srv = await fs.readFile(path.join(root, 'server.js'), 'utf8');

  // Gamification target card & streak
  assert.match(srv, /pb-gamify/);
  assert.match(srv, /pb-gtag/);
  assert.match(srv, /pb-btn-wa/);
  assert.match(srv, /daysRemaining/);

  // Dark mode toggle in personalShell
  assert.match(srv, /pl-theme-toggle/);
  assert.match(srv, /data-theme="dark"/);

  // Shimmer skeleton in loading shell
  assert.match(srv, /pb-sk-kpis/);
  assert.match(srv, /pb-sk-line/);
});

test('util.js exports skeleton loaders and class badge helpers', async () => {
  const util = await fs.readFile(path.join(root, 'util.js'), 'utf8');
  assert.match(util, /function skeletonKpis/);
  assert.match(util, /function skeletonTable/);
  assert.match(util, /function classBadge/);
  assert.match(util, /function emptyState/);
  assert.match(util, /FASTAG_CLASSES/);
});
