const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('Smart Action Center wiring is present', () => {
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const settings = fs.readFileSync(new URL('../settings.js', import.meta.url), 'utf8');
  const config = fs.readFileSync(new URL('../config.js', import.meta.url), 'utf8');
  const notifications = fs.readFileSync(new URL('../notifications.js', import.meta.url), 'utf8');

  assert.match(server, /maybeSmartActionCenter/);
  assert.match(server, /routeKey: 'smartAlert'/);
  assert.match(server, /smartNotifications: true/);
  assert.match(server, /smartAlert: 'admin'/);
  assert.match(settings, /smartNotifications/);
  assert.match(settings, /smartAlert/);
  assert.match(config, /smartCooldownHours/);
  assert.match(notifications, /item\.meta && item\.meta\.smart/);
});
