/**
 * ApnaPayment / First Forward Dashboard — permanent storage in Google Sheets.
 *
 * Users, settings, sessions, password-reset requests and notifications are saved in a hidden
 * tab "APP_STORAGE" of the spreadsheet this script is attached to. Data arrives ALREADY ENCRYPTED
 * by the dashboard server, so the cells only contain unreadable text. Do not edit that tab by hand.
 *
 * v3.58 — "Could not save … Save not confirmed" ka asli karan: doPost ek hi global script lock leta tha
 * aur busy hone par sirf { ok:false, error:'busy, retry' } bhejta tha — dashboard ka client us error ko
 * retry-worthy nahi maanta tha, isliye save turant fail ho jaati thi. Ab:
 *   • lock 60s tak slices me maanga jaata hai (LOCK_WAIT_MS / LOCK_SLICE_MS),
 *   • busy hone par { ok:false, code:'busy', retry:true, version } jaata hai,
 *   • read-only actions (ping/health/sheettest/readaddresses) bina lock chalte hain,
 *   • har response me SCRIPT_VERSION aati hai, aur healthOnce() poora diagnosis deta hai.
 * Naya code paste karke Deploy → Manage deployments → Edit → Version: "New version" karna ZAROORI hai.
 *
 * v3.48 — history recovery. The dashboard can now LIST the encrypted saves in APP_STORAGE_HISTORY
 * (action 'history') and bring an older save back (Settings → ☁️ Storage & backup → ⏪ Recovery).
 * Still ciphertext-only: this script never decrypts anything. You MUST paste this file and deploy a
 * NEW VERSION to use recovery — see RECOVERY.md.
 *
 * v3.28 — encrypted APP_STORAGE history backup added. Before any users/settings/sessions/reset/notify record is overwritten, the previous encrypted record is copied to APP_STORAGE_HISTORY. This never decrypts or exposes passwords.
 *
 * v3.27 — tag requests ab kisi BHI Google Sheet me ja sakti hain: dashboard sheet ka link/ID bhejta
 * hai aur ye script SpreadsheetApp.openById() se usi sheet me rows append karta hai (us sheet par
 * is Google account ka edit access hona chahiye). Purane deployments me sirf 'ping'/'appendrows'
 * the — naye 'sheettest' action + openById ke liye ye code dobara paste karke
 * Deploy → Manage deployments → Edit → Version: "New version" → Deploy karo.
 *
 * SETUP (one time, ~5 minutes) — see STORAGE_SETUP.md in the repository:
 *  1. Open the Google Sheet (a new private sheet is best) → Extensions → Apps Script.
 *  2. Delete the sample code, paste this whole file, and set SECRET below to a long random value
 *     (at least 16 characters, e.g. 32 random letters/numbers). Save.
 *  3. Deploy → New deployment → type "Web app" → Execute as: Me → Who has access: Anyone → Deploy.
 *     Allow the permissions. Copy the Web app URL (ends with /exec).
 *  4. Render → your service → Environment: add
 *        APPS_SCRIPT_URL    = <the /exec URL>
 *        APPS_SCRIPT_SECRET = <the same SECRET as below>
 *     Save → Render redeploys. /api/health will show storage.backend = "appsscript".
 *
 * NEVER change SECRET after data is saved (the old records could no longer be decrypted).
 */
// 🔐 Secret is kept in Apps Script Script Properties, NOT in GitHub.
// Set it once by running setAppSecretOnce('YOUR_SECRET') in the Apps Script editor.
function appSecret_() {
  return String(PropertiesService.getScriptProperties().getProperty('APPS_SCRIPT_SECRET') || '').trim();
}

// Final production targets supplied for this dashboard.
const DASHBOARD_BASE_URL = 'https://first-forward-dashboard.onrender.com';
const GV_SPREADSHEET_ID = String(PropertiesService.getScriptProperties().getProperty('GV_SPREADSHEET_ID') || '').trim();
const GV_SHEET_NAME = String(PropertiesService.getScriptProperties().getProperty('GV_SHEET_NAME') || 'GV Master').trim();
const TAG_REQUEST_SPREADSHEET_ID = '13eyCSDnXysQM-nWymBE5yPeKw8fnbVCY-hCTqJSPUsM';
const TAG_REQUEST_DEFAULT_TAB = 'Tag Requests';

const TAB = 'APP_STORAGE';
const CHUNK = 45000; // a Google Sheets cell holds max 50,000 characters
const KINDS = ['users', 'sessions', 'settings', 'resets', 'notify'];
const HISTORY_TAB = 'APP_STORAGE_HISTORY';
const HISTORY_MAX_ROWS = 2000;

// 🧾 v3.58 — is deployed Code.gs ki version. Har response me jaati hai, taaki turant pata chale ki
// naya code deploy hua hai ya purana (dashboard ka /api/tag-request-sheet/test isi ko dikhata hai).
const SCRIPT_VERSION = 'v3.58-storage';
const MAX_SHEET_COLUMNS = 18278; // Google Sheets ka hard limit — isse bade record pe pehle chup-chaap data kat jaata tha
const LOCK_WAIT_MS = 60000;      // pehle 25s tha → "busy, retry" par save fail (client retry nahi karta tha)
const LOCK_SLICE_MS = 8000;      // ek-ek chhoti slice me tryLock — Apps Script me lamba tryLock reliable nahi
const READ_ONLY_ACTIONS = ['ping', 'health', 'sheettest', 'readaddresses']; // lock ke bina — inme koi write nahi
const HEALTH_SCRATCH_TAB = 'APP_STORAGE_HEALTH'; // healthOnce() ka likh-padh (write test) yahin hota hai

/** Run this ONCE from the Apps Script editor (▶ Run) to grant the "send email" permission. */
function authorizeMail() { Logger.log('Mail quota left today: ' + MailApp.getRemainingDailyQuota()); }

/**
 * 🔐 Run ONCE after pasting this file. Do NOT put the secret into GitHub.
 * Example: setAppSecretOnce('your-secret-here');
 */
function setAppSecretOnce(secret) {
  secret = String(secret || '').trim();
  if (secret.length < 16) throw new Error('Secret must be at least 16 characters.');
  PropertiesService.getScriptProperties().setProperty('APPS_SCRIPT_SECRET', secret);
  Logger.log('APPS_SCRIPT_SECRET saved in Script Properties.');
  return 'OK';
}
/**
 * 📡 INSTANT GV MASTER EDIT → SERVER SNAPSHOT → PHONE PUSH
 *
 * Configure the dashboard URL + GV spreadsheet ID, then run setupInstantSheetPush() once.
 * This project can be bound to APP_STORAGE and still watch the separate GV spreadsheet: the
 * account executing this script must have Editor access to that GV spreadsheet.
 * The server verifies the edit by re-reading its live GV Master feed before it sends an alert.
 * Its 15-second server poll remains the fallback for imports, formulas and API/script writes that
 * do not fire Google Sheets onEdit triggers.
 */
function setDashboardPushUrl(url, spreadsheetId, sheetName) {
  url = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(url) || !/\/api\/push\/sheet-update$/i.test(url)) {
    throw new Error('Dashboard URL should end with /api/push/sheet-update and use HTTPS.');
  }
  var props = PropertiesService.getScriptProperties();
  props.setProperty('DASHBOARD_PUSH_URL', url);
  if (spreadsheetId) props.setProperty('DASHBOARD_PUSH_SPREADSHEET_ID', String(spreadsheetId).trim());
  else props.deleteProperty('DASHBOARD_PUSH_SPREADSHEET_ID');
  props.setProperty('DASHBOARD_PUSH_SHEET_NAME', String(sheetName || 'GV Master').trim());
  Logger.log('Dashboard push URL and GV source saved.');
  return url;
}

/** Edit the three placeholders, run this once, then keep/remove this helper as preferred. */
function configureInstantGvPushOnce() {
  if (!GV_SPREADSHEET_ID) throw new Error('GV_SPREADSHEET_ID Script Property missing. Run setGvSourceOnce(gvSpreadsheetId, "GV Master") first.');
  setDashboardPushUrl(DASHBOARD_BASE_URL + '/api/push/sheet-update', GV_SPREADSHEET_ID, GV_SHEET_NAME);
  return setupInstantSheetPush();
}

/** Optional: configure the separate GV Master source for instant edit push. */
function setGvSourceOnce(spreadsheetId, sheetName) {
  spreadsheetId = String(spreadsheetId || '').trim();
  sheetName = String(sheetName || 'GV Master').trim();
  if (!spreadsheetId) throw new Error('GV spreadsheet ID required.');
  PropertiesService.getScriptProperties().setProperty('GV_SPREADSHEET_ID', spreadsheetId);
  PropertiesService.getScriptProperties().setProperty('GV_SHEET_NAME', sheetName);
  Logger.log('GV source saved: ' + spreadsheetId + ' / ' + sheetName);
  return 'OK';
}

function setupInstantSheetPush() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('DASHBOARD_PUSH_URL');
  if (!url) throw new Error('First configure setDashboardPushUrl(url, gvSpreadsheetId, "GV Master").');
  var spreadsheetId = props.getProperty('DASHBOARD_PUSH_SPREADSHEET_ID');
  var sheetName = props.getProperty('DASHBOARD_PUSH_SHEET_NAME') || 'GV Master';
  var ss = spreadsheetId ? SpreadsheetApp.openById(spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('GV spreadsheet nahi mila — setDashboardPushUrl me uska spreadsheet ID do.');
  if (!ss.getSheetByName(sheetName)) throw new Error('GV tab "' + sheetName + '" is spreadsheet me nahi mila.');
  // Replace any prior trigger for this handler, including one installed on the storage workbook.
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'instantSheetEditPush') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('instantSheetEditPush').forSpreadsheet(ss).onEdit().create();
  Logger.log('Instant GV edit push installed: ' + ss.getName() + ' → ' + sheetName);
  return 'OK';
}

function instantSheetEditPush(e) {
  try {
    if (!e || !e.range) return;
    var props = PropertiesService.getScriptProperties();
    var url = props.getProperty('DASHBOARD_PUSH_URL');
    if (!url) return;
    var range = e.range;
    var sheet = range.getSheet();
    var sheetName = props.getProperty('DASHBOARD_PUSH_SHEET_NAME') || 'GV Master';
    if (sheet.getName() !== sheetName) return;
    var source = e.source || sheet.getParent();
    var spreadsheetId = source && source.getId ? source.getId() : '';
    var configuredId = props.getProperty('DASHBOARD_PUSH_SPREADSHEET_ID') || '';
    if (configuredId && spreadsheetId !== configuredId) return;
    var numRows = range.getNumRows();
    var numCols = range.getNumColumns();
    var payload = {
      secret: appSecret_(),
      title: 'GV Partner live update',
      sheet: sheetName,
      spreadsheetId: spreadsheetId,
      range: range.getA1Notation(),
      changed: numRows === 1 && numCols === 1 ? 'Cell updated' : numRows + ' rows × ' + numCols + ' columns updated',
      editor: (e.user && e.user.getEmail) ? e.user.getEmail() : '',
      at: new Date().toISOString()
    };
    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      console.error('GV live push webhook HTTP ' + code + ': ' + String(response.getContentText() || '').slice(0, 300));
    }
  } catch (err) {
    console.error('instantSheetEditPush:', err && err.message || err);
  }
}

function doGet() {
  return json_({ ok: true, service: 'apnapayment-storage', version: SCRIPT_VERSION, note: 'POST only. Storage is working if you can see this.' });
}

/** 🔓 Read-only actions — ye APP_STORAGE ko kabhi likhte nahi, isliye lock ke bina chalte hain.
 *  Apps Script me keyed lock nahi hota — poora script ek hi lock par hai. Isliye reads ko bahar
 *  nikaalna hi contention kam karne ka asli raasta hai (warna ek save dusre ka wait karwata hai). */
function readOnlyAction_(action, body) {
  if (action === 'ping') {
    const ss = SpreadsheetApp.getActive();
    // Dhyan: ping yahan APP_STORAGE tab BANATA NAHI (ye lock ke bina chalta hai) — sirf batata hai.
    return { ok: true, version: SCRIPT_VERSION, tab: TAB, hasTab: !!ss.getSheetByName(TAB), spreadsheet: ss.getName(), url: ss.getUrl() };
  }
  if (action === 'health') return healthOnce();
  if (action === 'sheettest') {
    var ssT = target_(body.spreadsheetId);
    var tabT = String(body.tab || 'Tag Requests').slice(0, 80);
    return { ok: true, version: SCRIPT_VERSION, spreadsheet: ssT.getName(), spreadsheetId: ssT.getId(), url: ssT.getUrl(), tab: tabT, exists: !!ssT.getSheetByName(tabT) };
  }
  if (action === 'readaddresses') {
    var aTab = String(body.tab || 'Address').slice(0, 80);
    var aSs = target_(body.spreadsheetId);
    var aSh = aSs.getSheetByName(aTab);
    if (!aSh || aSh.getLastRow() < 2) return { ok: true, version: SCRIPT_VERSION, tab: aTab, rows: [], spreadsheet: aSs.getName(), spreadsheetId: aSs.getId(), url: aSs.getUrl() };
    var aLastRow = aSh.getLastRow();
    var aWidth = Math.min(9, Math.max(1, aSh.getLastColumn()));
    var aVals = aSh.getRange(2, 1, aLastRow - 1, aWidth).getValues();
    var aOut = aVals.map(function (r) {
      return {
        key: String(r[0] || '').trim(), agentId: String(r[1] || '').trim(), agent: String(r[2] || '').trim(),
        channel: String(r[3] || '').trim().toLowerCase() === 'gv' ? 'gv' : 'ff',
        mobile: String(r[4] || '').trim(), address: String(r[5] || '').trim(),
        pincode: String(r[6] || '').replace(/\D/g, '').slice(0, 6),
        tl: String(r[7] || '').trim(), updatedAt: r[8] instanceof Date ? r[8].toISOString() : String(r[8] || '')
      };
    }).filter(function (x) { return !!x.key; });
    return { ok: true, version: SCRIPT_VERSION, tab: aTab, rows: aOut.slice(-5000), spreadsheet: aSs.getName(), spreadsheetId: aSs.getId(), url: aSs.getUrl() };
  }
  return { ok: false, error: 'unknown read-only action', action: String(action || ''), version: SCRIPT_VERSION };
}

/** Busy/quota/timeout jaisi transient galtiyan — client ko retry karna chahiye. */
function isBusyError_(err) {
  return /too many|rate limit|quota|exceeded|timeout|timed out|service is unavailable|temporar|try again|later|busy|lock/i.test(String(err && err.message || err) + ' ' + String(err && err.name || ''));
}

/** Har fail response me action + exception ka naam — "kya fail hua" turant pata chale (pehle sirf message tha). */
function failJson_(err, action) {
  const message = String(err && err.message || err);
  const name = String(err && err.name || 'Error');
  const busy = isBusyError_(err);
  return json_({
    ok: false,
    error: (action ? action + ': ' : '') + message,
    action: String(action || ''),
    errorName: name,
    ...(busy ? { code: 'busy', retry: true } : {}),
    version: SCRIPT_VERSION
  });
}

/** Lock 60s tak nahi mila → saaf "busy, retry" + code/retry + version (client isi par dobara koshish karta hai). */
function busyJson_(action) {
  return json_({
    ok: false,
    error: 'busy, retry — script lock ' + Math.round(LOCK_WAIT_MS / 1000) + 's tak free nahi hua (doosra save chal raha hai)',
    action: String(action || ''),
    code: 'busy',
    retry: true,
    version: SCRIPT_VERSION
  });
}

/** Lock ko chhoti-chhoti slices me maango — ek lamba tryLock(timeout) Apps Script me bharosemand nahi hai. */
function acquireLock_(waitMs, sliceMs) {
  const lock = LockService.getScriptLock();
  const deadline = Date.now() + (waitMs || LOCK_WAIT_MS);
  do {
    const left = Math.max(0, deadline - Date.now());
    if (lock.tryLock(Math.min(sliceMs || LOCK_SLICE_MS, left || 1))) return lock;
    if (Date.now() >= deadline) break;
    Utilities.sleep(250);
  } while (Date.now() < deadline);
  return null;
}

function doPost(e) {
  let body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'invalid JSON', errorName: 'SyntaxError', version: SCRIPT_VERSION }); }
  const SECRET = appSecret_();
  if (!SECRET || SECRET.length < 16) return json_({ ok: false, error: 'APPS_SCRIPT_SECRET missing — run setAppSecretOnce(secret) once, then deploy a new version.', errorName: 'SecretMissing', version: SCRIPT_VERSION });
  if (body.secret !== SECRET) return json_({ ok: false, error: 'unauthorized (secret mismatch)', errorName: 'Unauthorized', version: SCRIPT_VERSION });
  const action = String(body.action || '');

  // 📧 Mail relay (HTTPS) — Render free blocks SMTP ports, so the dashboard can send its emails
  // (login OTP, daily digest, champion certificates, test mail) THROUGH this script via Gmail.
  // First time: after pasting this code, run any function once (e.g. authorizeMail) OR redeploy
  // as "New version" and click Allow when Google asks for the "send email" permission.
  if (action === 'mailping') {
    try { return json_({ ok: true, quota: MailApp.getRemainingDailyQuota(), account: Session.getEffectiveUser().getEmail(), version: SCRIPT_VERSION }); }
    catch (err) { return json_({ ok: false, error: 'mail permission missing — Deploy → Manage deployments → Edit → New version, then Allow email permission (' + String(err && err.message || err) + ')', errorName: String(err && err.name || 'Error'), version: SCRIPT_VERSION }); }
  }
  if (action === 'mail') {
    try {
      const m = body.mail || {};
      const to = String(m.to || '').split(/[,;]/).map(function (x) { return x.trim(); }).filter(Boolean);
      if (!to.length || to.length > 20) return json_({ ok: false, error: 'invalid recipients', action: action, errorName: 'MailRejected', version: SCRIPT_VERSION });
      if (!m.subject || String(m.subject).length > 300) return json_({ ok: false, error: 'invalid subject', action: action, errorName: 'MailRejected', version: SCRIPT_VERSION });
      const opts = { to: to.join(','), subject: String(m.subject), body: String(m.body || ' '), name: String(m.name || '') || 'Dashboard' };
      if (m.htmlBody) opts.htmlBody = String(m.htmlBody);
      const files = (m.attachments || []).slice(0, 5).map(function (a) {
        return Utilities.newBlob(Utilities.base64Decode(String(a.content || '')), String(a.type || 'text/csv'), String(a.name || 'report.csv'));
      });
      if (files.length) opts.attachments = files;
      MailApp.sendEmail(opts);
      return json_({ ok: true, sent: to.length, quota: MailApp.getRemainingDailyQuota(), version: SCRIPT_VERSION });
    } catch (err) {
      return failJson_(err, action);
    }
  }

  // 🔓 Read-only actions lock ke bina — jab koi save lock hold kar raha ho tab bhi ye jawab dete hain.
  if (READ_ONLY_ACTIONS.indexOf(action) >= 0) {
    try { return json_(readOnlyAction_(action, body)); }
    catch (err) { return failJson_(err, action); }
  }

  const lock = acquireLock_(LOCK_WAIT_MS, LOCK_SLICE_MS);
  if (!lock) return busyJson_(action);
  try {
    const sheet = sheet_();
    // 📗 Tag Request (v3.27) — dashboard se aayi rows ko kisi bhi NORMAL tab me direct append karo.
    // body: { tab: 'Tag Requests', header: [...], rows: [[...], ...], spreadsheetId?: '<alag sheet ka ID>' }
    // Tab na ho to ban jaata hai; tab khaali ho to pehle header row likhi jaati hai.
    // spreadsheetId diya ho to entry US sheet me hoti hai (us sheet par is Google account ka edit access
    // hona chahiye — Sheet → Share). Nahi diya to script jis sheet se bandha hai usi me.
    if (action === 'appendrows') {
      var tabName = String(body.tab || TAG_REQUEST_DEFAULT_TAB).slice(0, 80);
      if (tabName === TAB && !body.spreadsheetId) return json_({ ok: false, error: 'APP_STORAGE tab me likhna allowed nahi — koi doosra tab naam do.', action: action, version: SCRIPT_VERSION });
      var ss = target_(body.spreadsheetId || TAG_REQUEST_SPREADSHEET_ID);
      var sh = ss.getSheetByName(tabName);
      if (!sh) sh = ss.insertSheet(tabName);
      var header = Array.isArray(body.header) ? body.header.map(function (h) { return String(h == null ? '' : h); }) : [];
      var rows = Array.isArray(body.rows) ? body.rows.slice(0, 500) : [];
      rows.forEach(function (r) { if (!Array.isArray(r)) throw new Error('rows must be arrays of values'); });
      var startRow = sh.getLastRow() + 1;
      if (startRow <= 1 && header.length) {
        if (sh.getMaxColumns() < header.length) sh.insertColumnsAfter(sh.getMaxColumns(), header.length - sh.getMaxColumns());
        sh.getRange(1, 1, 1, header.length).setValues([header]);
        try { sh.getRange(1, 1, 1, header.length).setFontWeight('bold'); } catch (e) { /* cosmetic */ }
        startRow = 2;
      }
      var added = 0;
      if (rows.length) {
        var width = header.length;
        rows.forEach(function (r) { if (r.length > width) width = r.length; });
        if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
        var padded = rows.map(function (r) {
          var c = r.slice(0, width).map(function (v) { return typeof v === 'object' && v !== null ? JSON.stringify(v) : v; });
          while (c.length < width) c.push('');
          return c;
        });
        sh.getRange(startRow, 1, padded.length, width).setValues(padded);
        added = padded.length;
      }
      SpreadsheetApp.flush();
      return json_({ ok: true, tab: tabName, added: added, atRow: startRow, spreadsheet: ss.getName(), spreadsheetId: ss.getId(), url: ss.getUrl(), version: SCRIPT_VERSION });
    }

    // 📇 Agent Address Book — central sheet tab, automatically created and de-duplicated.
    // body: { tab: 'Address', rows: [{key,agentId,agent,channel,mobile,address,pincode,tl,updatedAt}], spreadsheetId?: '<sheet id>' }
    if (action === 'upsertaddresses') {
      var uTab = String(body.tab || 'Address').slice(0, 80);
      var uRows = Array.isArray(body.rows) ? body.rows.slice(0, 500) : [];
      var uSs = target_(body.spreadsheetId);
      var uSh = uSs.getSheetByName(uTab);
      if (!uSh) uSh = uSs.insertSheet(uTab);
      var uHeader = ['Key', 'Agent ID', 'Agent', 'Channel', 'Mobile', 'Address', 'Pincode', 'TL', 'Updated At'];
      if (uSh.getMaxColumns() < uHeader.length) uSh.insertColumnsAfter(uSh.getMaxColumns(), uHeader.length - uSh.getMaxColumns());
      if (uSh.getLastRow() < 1) uSh.getRange(1, 1, 1, uHeader.length).setValues([uHeader]);
      else {
        var hNow = uSh.getRange(1, 1, 1, uHeader.length).getValues()[0];
        var hEmpty = hNow.every(function (v) { return !String(v || '').trim(); });
        if (hEmpty) uSh.getRange(1, 1, 1, uHeader.length).setValues([uHeader]);
      }

      var existing = {};
      var dupRows = {};
      var last = uSh.getLastRow();
      if (last >= 2) {
        var vals = uSh.getRange(2, 1, last - 1, uHeader.length).getValues();
        vals.forEach(function (r, idx) {
          var key = String(r[0] || '').trim();
          if (!key) return;
          var rowNo = idx + 2;
          if (existing[key]) {
            if (!dupRows[key]) dupRows[key] = [];
            dupRows[key].push(rowNo);
          } else existing[key] = rowNo;
        });
      }

      var added = 0, updated = 0, deduped = 0;
      uRows.forEach(function (x) {
        if (!x || typeof x !== 'object') return;
        var key = String(x.key || '').trim();
        if (!key) return;
        var valsOut = [[
          key,
          String(x.agentId || '').trim(),
          String(x.agent || '').trim(),
          String(x.channel || '').trim().toLowerCase() === 'gv' ? 'gv' : 'ff',
          String(x.mobile || '').trim(),
          String(x.address || '').trim(),
          String(x.pincode || '').replace(/\D/g, '').slice(0, 6),
          String(x.tl || '').trim(),
          String(x.updatedAt || new Date().toISOString())
        ]];

        if (existing[key]) {
          var rowNo = existing[key];
          uSh.getRange(rowNo, 1, 1, uHeader.length).setValues(valsOut);
          updated++;
          var ds = dupRows[key] || [];
          for (var di = ds.length - 1; di >= 0; di--) {
            uSh.deleteRow(ds[di]);
            deduped++;
          }
          delete dupRows[key];
        } else {
          var nr = Math.max(2, uSh.getLastRow() + 1);
          uSh.getRange(nr, 1, 1, uHeader.length).setValues(valsOut);
          existing[key] = nr;
          added++;
        }
      });
      try { uSh.getRange(1, 1, 1, uHeader.length).setFontWeight('bold'); } catch (e) { /* cosmetic */ }
      try { uSh.setFrozenRows(1); } catch (e) { /* cosmetic */ }
      SpreadsheetApp.flush();
      return json_({ ok: true, tab: uTab, added: added, updated: updated, deduped: deduped, spreadsheet: uSs.getName(), spreadsheetId: uSs.getId(), url: uSs.getUrl(), version: SCRIPT_VERSION });
    }

    if (action === 'read') return json_({ ok: true, records: readAll_(sheet), version: SCRIPT_VERSION });
    if (action === 'write') {
      const records = body.records || {};
      // Ek hi save-batch ke sabhi records ka timestamp same hona chahiye — tabhi dashboard
      // unhe ek "snapshot" (purani save) ke roop me group kar ke wapas la sakta hai.
      const nowIso = new Date().toISOString();
      Object.keys(records).forEach(function (kind) {
        if (KINDS.indexOf(kind) < 0) throw new Error('unknown kind ' + kind);
        writeRecord_(sheet, kind, records[kind], nowIso);
      });
      SpreadsheetApp.flush();
      return json_({ ok: true, savedAt: nowIso, kinds: Object.keys(records), version: SCRIPT_VERSION });
    }
    // ⏪ Recovery (v3.48) — APP_STORAGE_HISTORY ke purane encrypted records ki list.
    //   body: { rows?: [rowNumbers], withData?: true }
    //   Sirf metadata (row, savedAt, kind, size) bhejta hai; `data` tabhi jab withData + rows diye hon.
    //   Ye kabhi decrypt nahi karta — ciphertext hi aata/jaata hai.
    if (action === 'history') {
      const h = historySheet_(sheet.getParent());
      const want = Array.isArray(body.rows) ? body.rows.map(Number).filter(function (n) { return n >= 2; }) : null;
      const hist = readHistory_(h, want, !!body.withData && !!want);
      return json_({ ok: true, tab: HISTORY_TAB, entries: hist.entries, truncated: hist.truncated, version: SCRIPT_VERSION });
    }
    return json_({ ok: false, error: 'unknown action', action: action, errorName: 'UnknownAction', version: SCRIPT_VERSION });
  } catch (err) {
    return failJson_(err, action);
  } finally {
    lock.releaseLock();
  }
}

/** Entry kis sheet me jaani hai — ID diya ho to wahi (alag sheet), warna wahi sheet jisme ye
 *  script bana hai. Alag sheet par is Google account ka EDIT access hona chahiye. */
function target_(ssId) {
  var id = String(ssId || '').trim();
  if (!id) return SpreadsheetApp.getActive();
  try { return SpreadsheetApp.openById(id); }
  catch (err) {
    throw new Error('Sheet ID ' + id + ' nahi khuli — us sheet ko is Google account (jo Apps Script chala raha hai) ke saath Share → Editor karke add karo. (' + String(err && err.message || err) + ')');
  }
}

function sheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(TAB);
  if (!sh) {
    sh = ss.insertSheet(TAB);
    sh.getRange(1, 1, 1, 4).setValues([['kind', 'version', 'updatedAt', 'chunks']]);
    try { sh.hideSheet(); } catch (e) { /* the only sheet cannot be hidden */ }
  }
  return sh;
}

function readAll_(sh) {
  const out = {};
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 4) return out;
  const values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  values.forEach(function (row) {
    const kind = String(row[0] || '');
    if (KINDS.indexOf(kind) < 0) return;
    const count = Number(row[3]) || 0;
    const parts = [];
    for (let i = 0; i < count; i++) parts.push(String(row[4 + i] || '').replace(/^~/, ''));
    out[kind] = { v: String(row[1] || ''), data: parts.join(''), updatedAt: row[2] ? String(row[2]) : '' };
  });
  return out;
}

function historySheet_(ss) {
  let h = ss.getSheetByName(HISTORY_TAB);
  if (!h) {
    h = ss.insertSheet(HISTORY_TAB);
    h.getRange(1, 1, 1, 5).setValues([['savedAt', 'kind', 'version', 'chunks', 'encryptedDataChunks']]);
    try { h.hideSheet(); } catch (e) { /* cosmetic */ }
  }
  return h;
}

/** Sheet me date auto-format ho jaaye to bhi ISO string hi mile — recovery isi par snapshots group karti hai. */
function isoOf_(v) {
  if (v instanceof Date) return v.toISOString();
  const s = String(v == null ? '' : v);
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toISOString();
}

/**
 * ⏪ Recovery (v3.48) — APP_STORAGE_HISTORY ke purane encrypted records.
 * Default: sirf metadata (row, savedAt, kind, size). `withData` + `rows` dene par ciphertext bhi.
 * Ye kabhi decrypt nahi karta — data hamesha encrypted rehta hai.
 */
function readHistory_(h, rows, withData) {
  const out = [];
  const lastRow = h.getLastRow(), lastCol = h.getLastColumn();
  if (lastRow < 2 || lastCol < 5) return { entries: out, truncated: false };
  const want = rows && rows.length ? rows.slice(0, 40) : null;
  const maxChars = 6 * 1000 * 1000; // ek response me kitna ciphertext bhej sakte hain (safety)
  let used = 0, truncated = false;
  // Metadata (savedAt/kind/version/chunks) EK hi call me padho — 2000 rows par bhi turant chalta hai.
  const meta = h.getRange(2, 1, lastRow - 1, 4).getValues();
  for (let i = 0; i < meta.length; i++) {
    const r = i + 2;
    const row = meta[i];
    const kind = String(row[1] || '');
    if (KINDS.indexOf(kind) < 0) continue;
    if (want && want.indexOf(r) < 0) continue;
    const chunks = Number(row[3]) || 0;
    const entry = { row: r, savedAt: isoOf_(row[0]), kind: kind, version: String(row[2] || ''), chunks: chunks, bytes: chunks * CHUNK };
    if (withData) {
      const width = Math.max(1, Math.min(lastCol, 4 + chunks) - 4);
      const dataRow = h.getRange(r, 5, 1, width).getValues()[0];
      const parts = [];
      for (let j = 0; j < chunks; j++) parts.push(String(dataRow[j] || '').replace(/^~/, ''));
      const data = parts.join('');
      if (used + data.length > maxChars) truncated = true;
      else { entry.data = data; used += data.length; }
    }
    out.push(entry);
  }
  out.reverse(); // nayi save pehle
  return { entries: out, truncated: truncated };
}

/**
 * Keep the previous encrypted record before it is replaced.
 * IMPORTANT: this copies ciphertext only. It never decrypts passwords/settings.
 */
function backupPreviousRecord_(sh, rowIndex, kind) {
  if (rowIndex < 2) return;
  const lastCol = sh.getLastColumn();
  if (lastCol < 5) return;
  const row = sh.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  if (String(row[0] || '') !== kind) return;
  const chunkCount = Number(row[3]) || 0;
  if (!chunkCount) return;
  const h = historySheet_(sh.getParent());
  const chunks = row.slice(4, 4 + chunkCount);
  const next = h.getLastRow() + 1;
  h.getRange(next, 1, 1, 1).setNumberFormat('@'); // savedAt hamesha TEXT rahe (date auto-format se bachao)
  h.getRange(next, 1, 1, 4 + chunks.length).setValues([[
    new Date().toISOString(),
    String(row[0] || ''),
    String(row[1] || ''),
    String(row[3] || ''),
  ].concat(chunks)]);
  // Keep the history bounded so this protection cannot grow forever.
  const excess = h.getLastRow() - HISTORY_MAX_ROWS;
  if (excess > 0) h.deleteRows(2, excess);
}

function writeRecord_(sh, kind, record, nowIso) {
  if (!record || typeof record.data !== 'string') throw new Error('bad record for ' + kind);
  const chunks = [];
  for (let i = 0; i < record.data.length; i += CHUNK) chunks.push('~' + record.data.slice(i, i + CHUNK));
  if (!chunks.length) chunks.push('~');
  const width = 4 + chunks.length;
  // 🛑 v3.58 — Google Sheets me max 18278 columns hote hain. Isse bada record pehle chup-chaap
  // adhoora likha jaata tha (ya insertColumnsAfter par ulta error aata tha). Ab saaf error.
  if (width > MAX_SHEET_COLUMNS) {
    throw new Error('record for "' + kind + '" needs ' + width + ' columns, but a Google Sheet can hold only ' + MAX_SHEET_COLUMNS + '. Record too big (' + Math.round(record.data.length / 1048576) + ' MB) — ise chhota karo (images/attachments kam karo), warna data adhoora likha jayega.');
  }
  if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
  let rowIndex = -1;
  const lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    const kinds = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < kinds.length; i++) if (String(kinds[i][0]) === kind) { rowIndex = i + 2; break; }
  }
  if (rowIndex < 0) rowIndex = Math.max(2, lastRow + 1);
  // Preserve the existing encrypted record BEFORE clearing/replacing it.
  backupPreviousRecord_(sh, rowIndex, kind);
  const lastCol = Math.max(sh.getLastColumn(), width);
  sh.getRange(rowIndex, 1, 1, lastCol).clearContent();
  const range = sh.getRange(rowIndex, 1, 1, width);
  range.setNumberFormat('@');
  range.setValues([[kind, record.v || '', String(nowIso || new Date().toISOString()), String(chunks.length)].concat(chunks)]);
}

/**
 * 🩺 v3.58 — ek hi jagah poora diagnosis: secret set hai + lamba hai?, kaun user chal raha hai,
 * kaunsi spreadsheet, APP_STORAGE me kitne rows/columns, kaunse kinds ke records hain aur kaunse
 * MISSING, history tab, aur ek scratch cell par likh-padh kar write permission confirm.
 * Lock ke bina chalta hai (Read-only actions me hai) — jab saves lock ke liye wait kar rahe hon
 * tab bhi jawab de deta hai. Chalane ka tarika: Apps Script editor me ▶ Run, ya doPost
 * { secret, action: 'health' }, ya dashboard se.
 */
function healthOnce() {
  const out = {
    ok: true, version: SCRIPT_VERSION, at: new Date().toISOString(),
    secret: { set: false, length: 0, ok: false },
    effectiveUser: '', spreadsheet: { name: '', id: '', url: '' },
    appStorage: { exists: false, rows: 0, columns: 0, hidden: false },
    kinds: { present: [], missing: KINDS.slice(), counts: {} },
    history: { exists: false, rows: 0, latest: '' },
    writable: { ok: false, detail: '' },
    notes: []
  };
  try {
    const secret = appSecret_();
    out.secret = { set: !!secret, length: secret.length, ok: secret.length >= 16 };
    if (!out.secret.set) out.notes.push('APPS_SCRIPT_SECRET Script Property me set nahi hai — setAppSecretOnce(secret) run karo.');
    else if (!out.secret.ok) out.notes.push('APPS_SCRIPT_SECRET 16 characters se chhota hai — lamba secret set karo (dashboard ke APPS_SCRIPT_SECRET se bilkul same).');
  } catch (err) { out.notes.push('secret read fail: ' + String(err && err.message || err)); }
  try { out.effectiveUser = Session.getEffectiveUser().getEmail(); }
  catch (err) { out.notes.push('Session.getEffectiveUser() nahi mila: ' + String(err && err.message || err)); }
  try {
    const ss = SpreadsheetApp.getActive();
    out.spreadsheet = { name: ss.getName(), id: ss.getId(), url: ss.getUrl() };
    const sh = ss.getSheetByName(TAB);
    const hist = ss.getSheetByName(HISTORY_TAB);
    if (sh) {
      out.appStorage = { exists: true, rows: sh.getLastRow(), columns: sh.getLastColumn(), hidden: !!sh.isSheetHidden() };
      const records = readAll_(sh);
      out.kinds.present = Object.keys(records);
      out.kinds.missing = KINDS.filter(function (k) { return !records[k]; });
      KINDS.forEach(function (k) {
        out.kinds.counts[k] = records[k]
          ? { version: records[k].v, updatedAt: records[k].updatedAt, bytes: String(records[k].data || '').length }
          : null;
      });
      if (!out.kinds.present.length) out.notes.push('APP_STORAGE khaali hai (sirf header ya bilkul blank) — pehli save par bhar jayega.');
      if (out.kinds.missing.length) out.notes.push('APP_STORAGE me in kinds ka record nahi hai: ' + out.kinds.missing.join(', ') + ' — dashboard us kind ko save karne par ban jayega.');
    } else {
      out.notes.push('APP_STORAGE tab abhi nahi hai — pehli save par ye script khud bana lega.');
    }
    if (hist) {
      const lastRow = hist.getLastRow();
      out.history = { exists: true, rows: lastRow, latest: lastRow >= 2 ? isoOf_(hist.getRange(lastRow, 1).getValue()) : '' };
    } else {
      out.notes.push('APP_STORAGE_HISTORY tab nahi hai — purani saves tabhi dikhengi jab naya Code.gs deploy ho aur koi record overwrite ho.');
    }
    // ✍️ write test — scratch tab ke A1 par likh kar wapas padho (data tab me kuch nahi likha jaata).
    try {
      let scratch = ss.getSheetByName(HEALTH_SCRATCH_TAB);
      if (!scratch) {
        try { scratch = ss.insertSheet(HEALTH_SCRATCH_TAB); scratch.hideSheet(); }
        catch (race) { scratch = ss.getSheetByName(HEALTH_SCRATCH_TAB); }
      }
      if (!scratch) throw new Error('scratch tab nahi bana');
      const token = 'health-' + new Date().getTime();
      const cell = scratch.getRange('A1');
      cell.setNumberFormat('@');
      cell.setValue(token);
      SpreadsheetApp.flush();
      const back = String(scratch.getRange('A1').getValue() || '');
      cell.clearContent();
      out.writable = { ok: back === token, detail: HEALTH_SCRATCH_TAB + '!A1 par likha aur padha' + (back === token ? '' : ' — wapas "' + back + '" mila') };
      if (back !== token) out.notes.push('Scratch cell me likha par wahi value wapas nahi mili — sheet/script ki write permission check karo.');
    } catch (err) {
      out.writable = { ok: false, detail: String(err && err.message || err) };
      out.notes.push('Likhne ka test fail: ' + String(err && err.message || err));
    }
  } catch (err) {
    out.ok = false;
    out.notes.push('SpreadsheetApp.getActive() fail: ' + String(err && err.message || err) + ' — script kisi sheet se BANDHA hona chahiye (Sheet → Extensions → Apps Script se kholo).');
  }
  return out;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
