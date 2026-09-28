import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

test('shared Direct Agent classifier works for FF exclusions and GV direct/APS classes', async () => {
  const window = { FF: {} };
  const context = vm.createContext({ window, FF: window.FF, console });
  const source = await fs.readFile(new URL('../config.js', import.meta.url), 'utf8');
  vm.runInContext(source, context, { filename: 'config.js' });
  const classify = window.FF.config.isDirectAgent.bind(window.FF.config);

  assert.equal(classify({ tlName: 'APS' }), true, 'configured FF excluded TL is direct');
  assert.equal(classify({ tlName: 'Direct' }), true, 'GV Direct placeholder is direct');
  assert.equal(classify({ tlName: 'Regular TL', agentClass: 'APS' }), true, 'agent class APS is direct');
  assert.equal(classify({ tlName: 'Regular TL', tlClass: 'direct-agent' }), true, 'direct class token is direct');
  assert.equal(classify({ tlName: 'Regular TL', tlClass: 'Partner', stockClass: 'VC4' }), false, 'normal managed agent is dispatch-eligible');
  assert.equal(classify({ agentName: 'No TL assigned' }), true, 'agent without TL/supervisor is treated as direct for safe dispatch');
  assert.equal(classify({ tlExcluded: true }), true, 'existing parsed FF flag remains supported');
});

test('GV Stock Report route and Direct Agent controls stay registered', async () => {
  const [app, pages, settings] = await Promise.all([
    fs.readFile(new URL('../app.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../gvpages.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../settings.js', import.meta.url), 'utf8')
  ]);
  assert.match(app, /id:\s*'gvStockReport'/, 'sidebar route exists');
  assert.match(pages, /FF\.pages\.gvStockReport/, 'GV Stock Report renderer exported');
  assert.match(pages, /Direct Agents · no dispatch|Direct Agents:<\/b>/, 'direct/no-dispatch filter is visible');
  assert.match(settings, /notificationRoutes\.\$\{key\}/, 'Settings renders event audience matrix');
});
