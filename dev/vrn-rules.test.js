import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

async function loadConfig() {
  const window = { FF: {} };
  const context = vm.createContext({ window, FF: window.FF, console });
  const source = await fs.readFile(new URL('../config.js', import.meta.url), 'utf8');
  vm.runInContext(source, context, { filename: 'config.js' });
  return window.FF.config;
}

test('VRN length rules: 11–15 wrong · 16–20 chassis · 21+ wrong · ≤10 valid (spaces / - ignored)', async () => {
  const c = await loadConfig();
  assert.equal(c.vrnStatus('RJ14 AB 1234'), 'VRN', '10 chars = valid');
  assert.equal(c.vrnStatus('RJ14AB12345'), 'Wrong VRN', '11 = wrong');
  assert.equal(c.vrnStatus('RJ14-AB-1234567'), 'Wrong VRN', '15 = wrong');
  assert.equal(c.vrnStatus('MA3EWDE1S00123456'), 'Chassis', '17 = chassis');
  assert.equal(c.vrnStatus('A'.repeat(20)), 'Chassis', '20 = chassis');
  assert.equal(c.vrnStatus('A'.repeat(21)), 'Wrong VRN', '21 = wrong');
  assert.equal(c.vrnStatus(''), '', 'no VRN → sheet tag type decides');
  c.apply({ vrnRules: { enabled: true, bands: [{ min: 17, max: 17, status: 'chassis' }] } });
  assert.equal(c.vrnStatus('A'.repeat(18)), 'VRN', 'admin rules replace defaults');
  c.apply({ vrnRules: { enabled: false, bands: [] } });
  assert.equal(c.vrnStatus('A'.repeat(17)), '', 'rules off');
});

test('VRN rules wired: server default + validation + live feed, Settings section, red Home card', async () => {
  const read = (f) => fs.readFile(new URL(`../${f}`, import.meta.url), 'utf8');
  const [server, settings, home, gv] = await Promise.all([read('server.js'), read('settings.js'), read('home.js'), read('gv.js')]);
  assert.match(server, /vrnRules: \{ enabled: true, bands: \[\{ min: 11, max: 15, status: 'wrong' \}, \{ min: 16, max: 20, status: 'chassis' \}, \{ min: 21, max: 999, status: 'wrong' \}\] \}/);
  assert.match(server, /patch\.vrnRules !== undefined/);
  assert.match(server, /wrongVrn: vrnCounts \? vrnCounts\.wrong : 0/);
  assert.match(settings, /VRN length rules · GV live/);
  assert.match(home, /kpi\('g-red', 'Wrong VRN'/);
  assert.match(gv, /wrongVrn: count\(\(r\) => \/wrong\/i\.test\(r\.vrnType/);
});
