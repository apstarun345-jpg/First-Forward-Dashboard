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

test('shared Direct Agent classifier: channel-specific rules (FF = APS, GV = no TL id + no TL name)', async () => {
  const config = await loadConfig();
  const classify = config.isDirectAgent.bind(config);

  // channel-less (back-compat, safe union)
  assert.equal(classify({ tlName: 'APS' }), true, 'configured FF excluded TL is direct');
  assert.equal(classify({ tlName: 'Direct' }), true, 'GV Direct placeholder is direct');
  assert.equal(classify({ tlName: 'Regular TL', agentClass: 'APS' }), true, 'agent class APS is direct');
  assert.equal(classify({ tlName: 'Regular TL', tlClass: 'direct-agent' }), true, 'direct class token is direct');
  assert.equal(classify({ tlName: 'Regular TL', tlClass: 'Partner', stockClass: 'VC4' }), false, 'normal managed agent is not direct');
  assert.equal(classify({ agentName: 'No TL assigned' }), true, 'agent without TL/supervisor is treated as direct for safe dispatch');
  assert.equal(classify({ tlExcluded: true }), true, 'existing parsed FF flag remains supported');

  // First Forward: TL Name "APS" (or excluded/placeholder TL) = direct
  assert.equal(classify({ tlName: 'APS', tlId: 'APN2354', agentId: '5' }, 'ff'), true, 'FF: APS = direct even if an id exists');
  assert.equal(classify({ tlName: 'AJAY SINGH M', tlId: 'APN2354' }, 'ff'), false, 'FF: real TL-managed agent is not direct');
  assert.equal(classify({ tlName: 'UNASSIGNED' }, 'ff'), true, 'FF: placeholder TL name = direct');

  // GV: TL ID AND TL Name both blank = direct
  assert.equal(classify({ agentName: 'Rahul', agentId: '5846001' }, 'gv'), true, 'GV: no TL id + no TL name = direct');
  assert.equal(classify({ agentName: 'Rahul', tlId: 'APN2354' }, 'gv'), false, 'GV: TL id present but name blank is NOT direct');
  assert.equal(classify({ agentName: 'Rahul', tlName: 'AJAY SINGH M', tlId: 'APN2354' }, 'gv'), false, 'GV: managed agent is not direct');
  assert.equal(classify({ agentName: 'Rahul', agentId: '5846001', tlName: 'Rahul', tlId: '5846001' }, 'gv'), true, 'GV: self-supervised = direct');

  // channel auto-detect + labels
  assert.equal(classify({ channel: 'GV Partner', agentName: 'X' }), true, 'auto channel GV');
  assert.equal(classify({ channel: 'First Forward', tlName: 'AJAY', tlId: 'APN1' }), false, 'auto channel FF');
  assert.equal(config.directLabel({}, 'ff'), 'Direct Agent (APS)');
  assert.equal(config.directLabel({}, 'gv'), 'Direct Agent (no TL)');
  assert.equal(config.isExcludedTl('APS'), true);
  assert.equal(config.isExcludedTl('UNASSIGNED'), true);
  assert.equal(config.isExcludedTl('AJAY SINGH M'), false);
  assert.equal(config.isExcludedTl(''), true);
  assert.equal(config.isRealTl('APS'), false);
  assert.equal(config.isRealTl('AJAY SINGH M'), true);
});

test('direct agent rule is wired site-wide (page, GV + FF dispatch filters, settings tab)', async () => {
  const [config, app, gvpages, performance, cockpit, insights, gv, settings, direct, index, server, pkg] = await Promise.all([
    fs.readFile(new URL('../config.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../app.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../gvpages.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../performance.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../cockpit.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../insights.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../gv.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../settings.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../directAgents.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../index.html', import.meta.url), 'utf8'),
    fs.readFile(new URL('../server.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../package.json', import.meta.url), 'utf8')
  ]);
  assert.match(config, /direct:\s*\{/, 'config has the direct rules block');
  assert.match(config, /ffTlNames: \['APS'\]/, 'FF rule default = APS');
  assert.match(app, /id: 'directAgents'/, 'sidebar route exists');
  assert.match(index, /directAgents\.js/, 'directAgents.js is loaded');
  assert.match(server, /key: 'directAgents'/, 'permission registered');
  assert.match(pkg, /wowzone masterSearch directAgents/, 'syntax check covers directAgents.js');
  assert.match(direct, /FF\.pages\.directAgents = /, 'page exported');
  assert.match(direct, /ruleBanner/, 'shared rule banner exported');
  assert.match(gvpages, /__direct__/, 'GV TL filters get a Direct Agents option');
  assert.match(gvpages, /FF\.direct \? FF\.direct\.ruleBanner\('gv'\)/, 'GV Stock Report shows the rule banner');
  assert.match(performance, /__direct__/, 'FF Performance TL filter gets a Direct Agents option');
  assert.match(performance, /directLabel\(a, 'ff'\)/, 'FF labels come from the shared classifier');
  assert.match(cockpit, /Direct agents \(no dispatch\)/, 'Dispatch Planner has a direct pool');
  assert.match(insights, /isDirectAgent\(a, 'ff'\)/, 'forecast marks FF direct agents');
  assert.match(insights, /isDirectAgent\(a, 'gv'\)/, 'forecast marks GV direct agents');
  assert.match(gv, /directAgent: FF\.config\.isDirectAgent/, 'GV Master rows carry the flag');
  assert.match(gv, /function directRollup/, 'GV direct rollup exists');
  assert.match(settings, /\['direct', '🧍 Direct agents'\]/, 'Settings tab exists');
  assert.match(settings, /data-path="direct\.ffTlNames"/, 'FF rule editable');
  assert.match(settings, /check\('direct\.gvNoTl'/, 'GV rule editable');
});

test('GV Stock Report + alerts keep the Direct Agents · no dispatch control', async () => {
  const [pages, settings] = await Promise.all([
    fs.readFile(new URL('../gvpages.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../settings.js', import.meta.url), 'utf8')
  ]);
  assert.match(pages, /Direct Agents · no dispatch|Direct Agents — alag list/, 'direct/no-dispatch filter visible');
  assert.match(pages, /FF\.pages\.gvStockReport/, 'GV Stock Report renderer exported');
  assert.match(settings, /notificationRoutes\.\$\{key\}/, 'Settings renders event audience matrix');
});
