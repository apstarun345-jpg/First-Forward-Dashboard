/* Apps Script onEdit trigger regression: it must be syntactically valid, target the configured GV
   spreadsheet/tab, and send a server-side snapshot signal rather than a blind push payload. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'test-secret-0123456789-abcdef';

function loadAppsScript() {
  const props = new Map();
  const requests = [];
  const logs = [];
  const staleStorageTrigger = {
    handler: 'instantSheetEditPush', source: 'app_storage',
    getHandlerFunction: () => 'instantSheetEditPush', getTriggerSourceId: () => 'app_storage'
  };
  const triggers = [staleStorageTrigger];
  const sheet = { getName: () => 'GV Master' };
  const spreadsheet = {
    getId: () => 'gv_sheet_id_123',
    getName: () => 'GV Partner Data',
    getSheetByName: (name) => name === 'GV Master' ? sheet : null
  };
  const context = {
    console,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key) => props.get(key) || null,
      setProperty: (key, value) => { props.set(key, String(value)); return this; },
      deleteProperty: (key) => { props.delete(key); return this; }
    }) },
    SpreadsheetApp: {
      openById: (id) => id === spreadsheet.getId() ? spreadsheet : null,
      getActiveSpreadsheet: () => spreadsheet
    },
    ScriptApp: {
      getProjectTriggers: () => triggers,
      deleteTrigger: (trigger) => { const i = triggers.indexOf(trigger); if (i >= 0) triggers.splice(i, 1); },
      newTrigger: (handler) => ({
        forSpreadsheet: (source) => ({
          onEdit: () => ({ create: () => {
            const trigger = { handler, source: source.getId(), getHandlerFunction: () => handler, getTriggerSourceId: () => source.getId() };
            triggers.push(trigger);
            return trigger;
          } })
        })
      })
    },
    UrlFetchApp: { fetch: (url, options) => {
      requests.push({ url, options });
      return { getResponseCode: () => 200, getContentText: () => '{"ok":true}' };
    } },
    Logger: { log: (value) => logs.push(String(value)) },
    console: { error: (...args) => logs.push(args.join(' ')) }
  };
  const source = readFileSync(path.join(ROOT, 'google-apps-script/Code.gs'), 'utf8')
    .replace("'PASTE_A_LONG_RANDOM_SECRET_HERE'", JSON.stringify(SECRET));
  vm.runInNewContext(source, context, { filename: 'Code.gs' });
  return { context, props, requests, logs, triggers, spreadsheet, sheet };
}

test('Apps Script Code.gs parses and installs one edit trigger for the configured GV Master sheet', () => {
  assert.doesNotThrow(() => loadAppsScript(), 'Code.gs must stay deployable by Apps Script');
  const app = loadAppsScript();
  assert.throws(() => app.context.setDashboardPushUrl('http://dashboard.test/api/push/sheet-update', 'gv_sheet_id_123', 'GV Master'), /HTTPS/);
  assert.throws(() => app.context.setDashboardPushUrl('https://dashboard.test/api/notifications', 'gv_sheet_id_123', 'GV Master'), /sheet-update/);
  const saved = app.context.setDashboardPushUrl('https://dashboard.test/api/push/sheet-update/', 'gv_sheet_id_123', 'GV Master');
  assert.equal(saved, 'https://dashboard.test/api/push/sheet-update', 'trailing slash is normalized safely');
  assert.equal(app.context.setupInstantSheetPush(), 'OK');
  assert.equal(app.triggers.length, 1);
  assert.equal(app.triggers[0].handler, 'instantSheetEditPush');
  assert.equal(app.triggers[0].source, app.spreadsheet.getId());
});

test('Apps Script edit webhook only signals GV Master and includes the source spreadsheet ID', () => {
  const app = loadAppsScript();
  app.context.setDashboardPushUrl('https://dashboard.test/api/push/sheet-update', 'gv_sheet_id_123', 'GV Master');
  const range = {
    getSheet: () => app.sheet,
    getA1Notation: () => 'P42',
    getNumRows: () => 1,
    getNumColumns: () => 1
  };
  app.context.instantSheetEditPush({ range, source: app.spreadsheet, user: { getEmail: () => 'editor@example.test' } });
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].url, 'https://dashboard.test/api/push/sheet-update');
  const payload = JSON.parse(app.requests[0].options.payload);
  assert.equal(payload.secret, SECRET);
  assert.equal(payload.sheet, 'GV Master');
  assert.equal(payload.spreadsheetId, 'gv_sheet_id_123');
  assert.equal(payload.range, 'P42');
  assert.equal(payload.editor, 'editor@example.test');

  const otherSheet = { ...app.sheet, getName: () => 'Tag Assignment' };
  app.context.instantSheetEditPush({ range: { ...range, getSheet: () => otherSheet }, source: app.spreadsheet });
  app.context.instantSheetEditPush({ range, source: { getId: () => 'different_sheet' } });
  assert.equal(app.requests.length, 1, 'unrelated tabs/spreadsheets must not wake the GV watcher');
});
