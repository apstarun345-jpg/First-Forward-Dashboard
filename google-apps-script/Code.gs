/**
 * ApnaPayment / First Forward Dashboard — permanent storage in Google Sheets.
 *
 * Users, settings, sessions, password-reset requests and notifications are saved in a hidden
 * tab "APP_STORAGE" of the spreadsheet this script is attached to. Data arrives ALREADY ENCRYPTED
 * by the dashboard server, so the cells only contain unreadable text. Do not edit that tab by hand.
 *
 * v3.58 — "Could not save users/notify" fix + easy debugging:
 *   • SECRET AUTO-SETUP (TOFU): agar Script Property APPS_SCRIPT_SECRET abhi set NAHI hai, to
 *     pehli hi server call ka secret (>=16 chars) yahan save ho jata hai — setAppSecretOnce()
 *     bhoolne par bhi save fail nahi hota. (Secret set hone ke BAAD mismatch par pehle jaisa
 *     'unauthorized' hi milta hai — security same rehti hai.)
 *   • WRITE VERIFY: har 'write' ke baad script row ko dobara padh kar confirm karta hai ki data
 *     sach me sheet me utar gaya (response me verified:true) — "save not confirmed" ab sirf
 *     real failure par aayega.
 *   • BUSY RETRY: lock busy hone par script khud thoda ruk kar dobara koshish karta hai, aur
 *     dashboard server bhi 'busy' par ab retry karta hai.
 *   • checkSetup(): editor me ▶ Run karo — poori setup checklist (secret, tabs, mail permission)
 *     Logger me mil jaati hai. Browser me /exec URL kholne par bhi ab status dikhta hai
 *     (secretSet, storage rows, history rows — koi secret leak nahi hota).
 *   ⚠️ Paste karne ke baad: Deploy → Manage deployments → ✏️ Edit → Version: "New version" →
 *   Deploy — nahi to purana code hi chalta rehta hai!
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
const HISTORY_MAX_ROWS = 60; // bounded to 60 snapshots to avoid Google Sheets document size limits
const CODE_VERSION = 'v3.63';

/** Run this ONCE from the Apps Script editor (▶ Run) to grant the "send email" permission. */
function authorizeMail() { Logger.log('Mail quota left today: ' + MailApp.getRemainingDailyQuota()); }

/**
 * 🩺 Editor me ▶ Run karo — poori setup checklist Logger (View → Logs / Execution log) me aati hai.
 * "Could not save … to Google Sheets" dikhe to SABSE PEHLE yahi chalao.
 */
function checkSetup() {
  var lines = ['— ApnaPayment storage checkSetup (' + CODE_VERSION + ') —'];
  var secret = appSecret_();
  lines.push(secret.length >= 16
    ? '✅ APPS_SCRIPT_SECRET set hai (' + secret.length + ' characters). Render ke APPS_SCRIPT_SECRET se EXACT same hona chahiye.'
    : '⚠️ APPS_SCRIPT_SECRET abhi set NAHI hai — ya to setAppSecretOnce(\'...\') chalao, ya kuch mat karo: server ki PEHLI call par ye khud save ho jayega (auto-setup).');
  try {
    var ss = SpreadsheetApp.getActive();
    lines.push('✅ Script is spreadsheet se bandha hai: "' + ss.getName() + '"');
    if (ss.getSheetByName('EIR') || ss.getSheetByName('StockDataa')) {
      lines.push('⚠️ WARNING: Ye Apps Script First Forward ki MAIN business sheet ("' + ss.getName() + '") me laga hai!');
      lines.push('   Main business sheet me bohot zyada rows (60,000+ EIR, 100,000+ StockDataa) hoti hain,');
      lines.push('   jisse Google "The document cannot be modified. Perhaps it has grown too large" error deta hai.');
      lines.push('   👉 FIX: Hamesha ek NAYI, ALAG private Google Sheet banayein aur Apps Script usme deploy karein.');
    }
    var sh = ss.getSheetByName(TAB);
    lines.push(sh
      ? '✅ ' + TAB + ' tab maujood hai (' + Math.max(0, sh.getLastRow() - 1) + ' records).'
      : 'ℹ️ ' + TAB + ' tab abhi nahi hai — pehli save par apne aap ban jayega.');
    var h = ss.getSheetByName(HISTORY_TAB);
    lines.push(h ? '✅ ' + HISTORY_TAB + ' me ' + Math.max(0, h.getLastRow() - 1) + ' purani saves hain.' : 'ℹ️ ' + HISTORY_TAB + ' pehli overwrite par banega.');
  } catch (e) {
    lines.push('❌ Spreadsheet access error: ' + String(e && e.message || e));
  }
  try { lines.push('✅ Mail permission OK — aaj ka quota: ' + MailApp.getRemainingDailyQuota()); }
  catch (e) { lines.push('⚠️ Mail permission missing — authorizeMail() chala kar Allow karo (OTP/digest emails ke liye).'); }
  lines.push('ℹ️ Code paste karne ke baad: Deploy → Manage deployments → ✏️ Edit → Version: "New version" → Deploy. /exec URL wahi rehta hai.');
  lines.push('ℹ️ Web app settings: Execute as: Me · Who has access: Anyone.');
  var out = lines.join('\n');
  Logger.log('\n' + out);
  return out;
}

/**
 * 🧹 "The document cannot be modified. Perhaps it has grown too large" fix:
 * Editor me ye function chuno aur ▶ Run dabao.
 * Ye APP_STORAGE_HISTORY tab ko clean/trim karta hai aur empty rows/columns hatata hai.
 */
function cleanStorageHistory() {
  var ss = SpreadsheetApp.getActive();
  var log = [];
  try {
    var h = ss.getSheetByName(HISTORY_TAB);
    if (h) {
      var last = h.getLastRow();
      if (last > 20) {
        h.deleteRows(2, last - 20);
        log.push('APP_STORAGE_HISTORY trimmed to latest 20 rows.');
      } else {
        log.push('APP_STORAGE_HISTORY already has only ' + Math.max(0, last - 1) + ' rows.');
      }
    }
    var sh = ss.getSheetByName(TAB);
    if (sh) {
      if (sh.getMaxRows() > 20) {
        sh.deleteRows(21, sh.getMaxRows() - 20);
        log.push('APP_STORAGE unused rows deleted.');
      }
      if (sh.getMaxColumns() > 15) {
        sh.deleteColumns(16, sh.getMaxColumns() - 15);
        log.push('APP_STORAGE unused columns deleted.');
      }
    }
  } catch (e) {
    log.push('cleanStorageHistory error: ' + (e && e.message || e));
  }
  var msg = log.join('\n');
  Logger.log(msg);
  return msg;
}

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
  // 🩺 Browser me /exec URL kholo → ye status dikhta hai (koi secret/ciphertext leak nahi hota).
  var out = { ok: true, service: 'apnapayment-storage', version: CODE_VERSION, time: new Date().toISOString(), note: 'Storage is working if you can see this. Saves happen via POST only.' };
  try {
    out.secretSet = appSecret_().length >= 16;
    if (!out.secretSet) out.hint = 'Secret abhi set nahi — server ki pehli call par auto-set hoga, ya editor me setAppSecretOnce(\'...\') chalao.';
  } catch (e) { out.secretSet = false; }
  try {
    var ss = SpreadsheetApp.getActive();
    out.spreadsheet = ss.getName();
    var sh = ss.getSheetByName(TAB);
    out.storageTab = !!sh;
    if (sh && sh.getLastRow() >= 2) {
      var meta = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
      out.records = meta
        .filter(function (r) { return KINDS.indexOf(String(r[0] || '')) >= 0; })
        .map(function (r) { return { kind: String(r[0]), updatedAt: String(r[2] || ''), chunks: Number(r[3]) || 0 }; });
    }
    var h = ss.getSheetByName(HISTORY_TAB);
    out.historyRows = h ? Math.max(0, h.getLastRow() - 1) : 0;
  } catch (e) { out.sheetError = String(e && e.message || e); }
  try { out.mailQuota = MailApp.getRemainingDailyQuota(); } catch (e) { out.mailQuota = 'permission missing — run authorizeMail()'; }
  return json_(out);
}

function doPost(e) {
  let body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'invalid JSON' }); }
  let SECRET = appSecret_();
  if (!SECRET || SECRET.length < 16) {
    // 🔓 v3.58 AUTO-SETUP (trust-on-first-use): secret abhi set nahi hai, isliye pehli authorized
    // call ka secret yahan save kar lo — setAppSecretOnce() bhoolne par bhi saves fail nahi hote.
    // Ek baar set hone ke baad mismatch par hamesha 'unauthorized' hi milta hai.
    const candidate = String(body.secret || '').trim();
    if (candidate.length >= 16) {
      PropertiesService.getScriptProperties().setProperty('APPS_SCRIPT_SECRET', candidate);
      SECRET = candidate;
      console.log('APPS_SCRIPT_SECRET was empty — saved from the first authorized call (auto-setup).');
    } else {
      return json_({ ok: false, error: 'APPS_SCRIPT_SECRET missing — run setAppSecretOnce(secret) once (or simply retry: the first server call sets it automatically), then deploy a new version.' });
    }
  }
  if (body.secret !== SECRET) return json_({ ok: false, error: 'unauthorized (secret mismatch) — Render env APPS_SCRIPT_SECRET aur yahan Script Property APPS_SCRIPT_SECRET exact same hone chahiye. Editor me checkSetup() chalao.' });

  // 📧 Mail relay (HTTPS) — Render free blocks SMTP ports, so the dashboard can send its emails
  // (login OTP, daily digest, champion certificates, test mail) THROUGH this script via Gmail.
  // First time: after pasting this code, run any function once (e.g. authorizeMail) OR redeploy
  // as "New version" and click Allow when Google asks for the "send email" permission.
  if (body.action === 'mailping') {
    try { return json_({ ok: true, quota: MailApp.getRemainingDailyQuota(), account: Session.getEffectiveUser().getEmail() }); }
    catch (err) { return json_({ ok: false, error: 'mail permission missing — Deploy → Manage deployments → Edit → New version, then Allow email permission (' + String(err && err.message || err) + ')' }); }
  }
  if (body.action === 'mail') {
    try {
      const m = body.mail || {};
      const to = String(m.to || '').split(/[,;]/).map(function (x) { return x.trim(); }).filter(Boolean);
      if (!to.length || to.length > 20) return json_({ ok: false, error: 'invalid recipients' });
      if (!m.subject || String(m.subject).length > 300) return json_({ ok: false, error: 'invalid subject' });
      const opts = { to: to.join(','), subject: String(m.subject), body: String(m.body || ' '), name: String(m.name || '') || 'Dashboard' };
      if (m.htmlBody) opts.htmlBody = String(m.htmlBody);
      const files = (m.attachments || []).slice(0, 5).map(function (a) {
        return Utilities.newBlob(Utilities.base64Decode(String(a.content || '')), String(a.type || 'text/csv'), String(a.name || 'report.csv'));
      });
      if (files.length) opts.attachments = files;
      MailApp.sendEmail(opts);
      return json_({ ok: true, sent: to.length, quota: MailApp.getRemainingDailyQuota() });
    } catch (err) {
      return json_({ ok: false, error: String(err && err.message || err) });
    }
  }

  const lock = LockService.getScriptLock();
  // v3.58 — lock busy ho to turant give-up mat karo: thoda ruk kar ek aur koshish (total ~26s).
  if (!lock.tryLock(18000)) {
    Utilities.sleep(1500 + Math.floor(Math.random() * 1500));
    if (!lock.tryLock(5000)) return json_({ ok: false, error: 'busy, retry' });
  }
  try {
    const sheet = sheet_();
    if (body.action === 'ping') return json_({ ok: true, version: CODE_VERSION, tab: TAB, spreadsheet: SpreadsheetApp.getActive().getName(), url: SpreadsheetApp.getActive().getUrl() });
    // 📗 Tag Request (v3.27) — dashboard se aayi rows ko kisi bhi NORMAL tab me direct append karo.
    // body: { tab: 'Tag Requests', header: [...], rows: [[...], ...], spreadsheetId?: '<alag sheet ka ID>' }
    // Tab na ho to ban jaata hai; tab khaali ho to pehle header row likhi jaati hai.
    // spreadsheetId diya ho to entry US sheet me hoti hai (us sheet par is Google account ka edit access
    // hona chahiye — Sheet → Share). Nahi diya to script jis sheet se bandha hai usi me.
    if (body.action === 'sheettest') {
      var ssT = target_(body.spreadsheetId);
      var tabT = String(body.tab || 'Tag Requests').slice(0, 80);
      return json_({ ok: true, spreadsheet: ssT.getName(), spreadsheetId: ssT.getId(), url: ssT.getUrl(), tab: tabT, exists: !!ssT.getSheetByName(tabT) });
    }
    if (body.action === 'appendrows') {
      var tabName = String(body.tab || TAG_REQUEST_DEFAULT_TAB).slice(0, 80);
      if (tabName === TAB && !body.spreadsheetId) return json_({ ok: false, error: 'APP_STORAGE tab me likhna allowed nahi — koi doosra tab naam do.' });
      var ss = target_(body.spreadsheetId || TAG_REQUEST_SPREADSHEET_ID);
      var sh = ss.getSheetByName(tabName);
      if (!sh) sh = ss.insertSheet(tabName);
      var header = Array.isArray(body.header) ? body.header.map(function (h) { return String(h == null ? '' : h); }) : [];
      var rows = Array.isArray(body.rows) ? body.rows.slice(0, 500) : [];
      rows.forEach(function (r) { if (!Array.isArray(r)) throw new Error('rows must be arrays of values'); });
      var startRow = sh.getLastRow() + 1;

      // 🧩 Tag Requests: Agent groups are separated by exactly one blank row.
      // This works even when Admin changes the column order, because the Agent column
      // is located from the actual header rather than a fixed position.
      if (/^tag requests$/i.test(tabName) && header.length && rows.length) {
        var agentCol = -1;
        for (var hi = 0; hi < header.length; hi++) {
          if (/^agent(?:\s+name)?$/i.test(String(header[hi] || '').trim())) { agentCol = hi; break; }
        }
        if (agentCol >= 0) {
          var firstIncoming = null;
          for (var ri = 0; ri < rows.length; ri++) {
            var rv = rows[ri] || [];
            var rowHas = rv.some(function (v) { return String(v == null ? '' : v).trim() !== ''; });
            if (rowHas) { firstIncoming = rv; break; }
          }
          var lastDataRow = sh.getLastRow();
          if (firstIncoming && lastDataRow >= 2) {
            var widthCheck = Math.max(header.length, agentCol + 1);
            if (sh.getMaxColumns() < widthCheck) sh.insertColumnsAfter(sh.getMaxColumns(), widthCheck - sh.getMaxColumns());
            var prevVals = sh.getRange(lastDataRow, 1, 1, widthCheck).getDisplayValues()[0];
            var prevHasData = prevVals.some(function (v) { return String(v || '').trim() !== ''; });
            var prevAgent = String(prevVals[agentCol] || '').trim().replace(/\s+/g, ' ').toUpperCase();
            var firstAgent = String(firstIncoming[agentCol] || '').trim().replace(/\s+/g, ' ').toUpperCase();
            var spacerAlreadyThere = false;
            if (lastDataRow > 2) {
              var beforeVals = sh.getRange(lastDataRow - 1, 1, 1, widthCheck).getDisplayValues()[0];
              spacerAlreadyThere = beforeVals.every(function (v) { return String(v || '').trim() === ''; });
            }
            if (prevHasData && prevAgent && firstAgent && prevAgent !== firstAgent && !spacerAlreadyThere) {
              sh.insertRowsAfter(lastDataRow, 1);
              startRow = lastDataRow + 2;
            }
          }
        }
      }

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
      return json_({ ok: true, tab: tabName, added: added, atRow: startRow, spreadsheet: ss.getName(), spreadsheetId: ss.getId(), url: ss.getUrl() });
    }

    // 📇 Agent Address Book — central sheet tab, automatically created and de-duplicated.
    // body: { tab: 'Address', rows: [{key,agentId,agent,channel,mobile,address,pincode,tl,updatedAt}], spreadsheetId?: '<sheet id>' }
    if (body.action === 'readaddresses') {
      var aTab = String(body.tab || 'Address').slice(0, 80);
      var aSs = target_(body.spreadsheetId);
      var aSh = aSs.getSheetByName(aTab);
      if (!aSh || aSh.getLastRow() < 2) return json_({ ok: true, tab: aTab, rows: [], spreadsheet: aSs.getName(), spreadsheetId: aSs.getId(), url: aSs.getUrl() });
      var aLastRow = aSh.getLastRow();
      var aWidth = Math.min(9, Math.max(1, aSh.getLastColumn()));
      var aVals = aSh.getRange(2, 1, aLastRow - 1, aWidth).getValues();
      var aOut = aVals.map(function (r) {
        return {
          key: String(r[0] || '').trim(), agentId: String(r[1] || '').trim(), agent: String(r[2] || '').trim(),
          channel: String(r[3] || '').trim().toLowerCase() === 'gv' ? 'gv' : 'ff',
          mobile: String(r[4] || '').trim(), address: String(r[5] || '').trim(),
          pincode: String(r[6] || '').replace(/\\D/g, '').slice(0, 6),
          tl: String(r[7] || '').trim(), updatedAt: r[8] instanceof Date ? r[8].toISOString() : String(r[8] || '')
        };
      }).filter(function (x) { return !!x.key; });
      return json_({ ok: true, tab: aTab, rows: aOut.slice(-5000), spreadsheet: aSs.getName(), spreadsheetId: aSs.getId(), url: aSs.getUrl() });
    }

    if (body.action === 'upsertaddresses') {
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
          String(x.pincode || '').replace(/\\D/g, '').slice(0, 6),
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
      return json_({ ok: true, tab: uTab, added: added, updated: updated, deduped: deduped, spreadsheet: uSs.getName(), spreadsheetId: uSs.getId(), url: uSs.getUrl() });
    }

    if (body.action === 'read') return json_({ ok: true, records: readAll_(sheet) });
    if (body.action === 'write') {
      const records = body.records || {};
      const kinds = Object.keys(records);
      if (!kinds.length) return json_({ ok: false, error: 'write me koi record nahi diya.' });
      kinds.forEach(function (kind) { if (KINDS.indexOf(kind) < 0) throw new Error('unknown kind ' + kind); });

      // 🔐 Transactional save:
      // old rows → encrypted history backup → replace → exact verify → rollback on ANY failure.
      // Isse partial/half-saved Settings ya users kabhi active state nahi bante.
      const originals = captureRows_(sheet, kinds);
      const nowIso = new Date().toISOString();
      try {
        kinds.forEach(function (kind) { writeRecord_(sheet, kind, records[kind], nowIso); });
        SpreadsheetApp.flush();
        verifyWrite_(sheet, records, nowIso);
        return json_({ ok: true, savedAt: nowIso, kinds: kinds, verified: true, transactional: true });
      } catch (err) {
        try {
          restoreCapturedRows_(sheet, originals);
          SpreadsheetApp.flush();
        } catch (rollbackErr) {
          throw new Error('write failed AND rollback failed: ' + String(err && err.message || err) + ' | ' + String(rollbackErr && rollbackErr.message || rollbackErr));
        }
        throw err;
      }
    }
    // ⏪ Recovery (v3.48) — APP_STORAGE_HISTORY ke purane encrypted records ki list.
    //   body: { rows?: [rowNumbers], withData?: true }
    //   Sirf metadata (row, savedAt, kind, size) bhejta hai; `data` tabhi jab withData + rows diye hon.
    //   Ye kabhi decrypt nahi karta — ciphertext hi aata/jaata hai.
    if (body.action === 'history') {
      const h = historySheet_(sheet.getParent());
      const want = Array.isArray(body.rows) ? body.rows.map(Number).filter(function (n) { return n >= 2; }) : null;
      const hist = readHistory_(h, want, !!body.withData && !!want);
      return json_({ ok: true, tab: HISTORY_TAB, entries: hist.entries, truncated: hist.truncated });
    }
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
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

function captureRows_(sh, kinds) {
  const wanted = new Set(kinds);
  const lastRow = sh.getLastRow();
  const lastCol = Math.max(4, sh.getLastColumn());
  const rows = [];
  if (lastRow >= 2) {
    const values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    for (let i = 0; i < values.length; i++) {
      const kind = String(values[i][0] || '');
      if (wanted.has(kind)) rows.push({ row: i + 2, values: values[i].slice() });
    }
  }
  return { lastRow: lastRow, lastCol: lastCol, kinds: kinds.slice(), rows: rows };
}

function restoreCapturedRows_(sh, snap) {
  const wanted = new Set((snap.kinds || snap.rows.map(function (x) {
    return x && x.values ? String(x.values[0] || '') : '';
  })).filter(Boolean));
  // Roll back ONLY the record kinds in this transaction. Never clear unrelated APP_STORAGE rows.
  const lastRow = sh.getLastRow();
  const lastCol = Math.max(4, sh.getLastColumn());
  if (lastRow >= 2 && wanted.size) {
    const values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    for (let i = 0; i < values.length; i++) {
      if (wanted.has(String(values[i][0] || ''))) {
        sh.getRange(i + 2, 1, 1, lastCol).clearContent();
      }
    }
  }
  // Restore the exact previous row contents for each affected kind.
  snap.rows.forEach(function (item) {
    if (item.row < 2 || !item.values || !item.values.length) return;
    const width = Math.max(4, item.values.length);
    if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
    sh.getRange(item.row, 1, 1, width).setValues([item.values]);
  });
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
  try {
    if (rowIndex < 2) return;
    // sessions change constantly on every single login and have no recovery value.
    if (kind === 'sessions') return;
    const lastCol = sh.getLastColumn();
    if (lastCol < 5) return;
    const row = sh.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
    if (String(row[0] || '') !== kind) return;
    const chunkCount = Number(row[3]) || 0;
    if (!chunkCount) return;
    const h = historySheet_(sh.getParent());
    const chunks = row.slice(4, 4 + chunkCount);
    // Trim BEFORE append so the journal stays bounded.
    const keepBeforeAppend = Math.max(1, HISTORY_MAX_ROWS - 1);
    const excessBefore = h.getLastRow() - 1 - keepBeforeAppend;
    if (excessBefore > 0) h.deleteRows(2, excessBefore);
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
  } catch (err) {
    // 🔐 Fail closed for every durable record except transient sessions.
    if (kind !== 'sessions') throw new Error('history backup failed for "' + kind + '": ' + String(err && err.message || err));
    Logger.log('backupPreviousRecord_ non-fatal error: ' + (err && err.message || err));
  }
}

function writeRecord_(sh, kind, record, nowIso) {
  if (!record || typeof record.data !== 'string') throw new Error('bad record for ' + kind);
  const chunks = [];
  for (let i = 0; i < record.data.length; i += CHUNK) chunks.push('~' + record.data.slice(i, i + CHUNK));
  if (!chunks.length) chunks.push('~');
  const width = 4 + chunks.length;
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
 * v3.58 — write ke turant baad sheet ko dobara padh kar confirm karo ki har record sach me
 * utar gaya: kind row mile, timestamp wahi ho jo abhi likha, aur chunk count expected se match kare.
 * Mismatch par throw — server ko saaf error milta hai (silent data-loss nahi).
 */
function verifyWrite_(sh, records, nowIso) {
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 5) throw new Error('write verify failed: ' + TAB + ' tab is empty after save');
  const values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  Object.keys(records).forEach(function (kind) {
    const source = records[kind] || {};
    const expectedData = String(source.data || '');
    const expectedChunks = Math.max(1, Math.ceil(expectedData.length / CHUNK));
    let found = null;
    for (let i = 0; i < values.length; i++) if (String(values[i][0]) === kind) { found = values[i]; break; }
    if (!found) throw new Error('write verify failed: row for "' + kind + '" not found after save');
    if (String(found[2]) !== String(nowIso)) throw new Error('write verify failed: "' + kind + '" timestamp mismatch after save');
    if ((Number(found[3]) || 0) !== expectedChunks) throw new Error('write verify failed: "' + kind + '" chunk count ' + found[3] + ' ≠ expected ' + expectedChunks);
    const parts = [];
    for (let j = 0; j < expectedChunks; j++) parts.push(String(found[4 + j] || '').replace(/^~/, ''));
    if (parts.join('') !== expectedData) throw new Error('write verify failed: "' + kind + '" encrypted payload mismatch after save');
  });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
