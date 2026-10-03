/**
 * ApnaPayment / First Forward Dashboard — permanent storage in Google Sheets.
 *
 * Users, settings, sessions, password-reset requests and notifications are saved in a hidden
 * tab "APP_STORAGE" of the spreadsheet this script is attached to. Data arrives ALREADY ENCRYPTED
 * by the dashboard server, so the cells only contain unreadable text. Do not edit that tab by hand.
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
const SECRET = 'PASTE_A_LONG_RANDOM_SECRET_HERE';
const TAB = 'APP_STORAGE';
const CHUNK = 45000; // a Google Sheets cell holds max 50,000 characters
const KINDS = ['users', 'sessions', 'settings', 'resets', 'notify'];
const HISTORY_TAB = 'APP_STORAGE_HISTORY';
const HISTORY_MAX_ROWS = 2000;

/** Run this ONCE from the Apps Script editor (▶ Run) to grant the "send email" permission. */
function authorizeMail() { Logger.log('Mail quota left today: ' + MailApp.getRemainingDailyQuota()); }

function doGet() {
  return json_({ ok: true, service: 'apnapayment-storage', note: 'POST only. Storage is working if you can see this.' });
}

function doPost(e) {
  let body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'invalid JSON' }); }
  if (!SECRET || SECRET.indexOf('PASTE_') === 0 || SECRET.length < 16) return json_({ ok: false, error: 'Set SECRET in Code.gs (min 16 chars) and redeploy.' });
  if (body.secret !== SECRET) return json_({ ok: false, error: 'unauthorized (secret mismatch)' });

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
  if (!lock.tryLock(25000)) return json_({ ok: false, error: 'busy, retry' });
  try {
    const sheet = sheet_();
    if (body.action === 'ping') return json_({ ok: true, tab: TAB, spreadsheet: SpreadsheetApp.getActive().getName(), url: SpreadsheetApp.getActive().getUrl() });
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
      var tabName = String(body.tab || 'Tag Requests').slice(0, 80);
      if (tabName === TAB && !body.spreadsheetId) return json_({ ok: false, error: 'APP_STORAGE tab me likhna allowed nahi — koi doosra tab naam do.' });
      var ss = target_(body.spreadsheetId);
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
      return json_({ ok: true, tab: tabName, added: added, atRow: startRow, spreadsheet: ss.getName(), spreadsheetId: ss.getId(), url: ss.getUrl() });
    }
    if (body.action === 'read') return json_({ ok: true, records: readAll_(sheet) });
    if (body.action === 'write') {
      const records = body.records || {};
      Object.keys(records).forEach(function (kind) {
        if (KINDS.indexOf(kind) < 0) throw new Error('unknown kind ' + kind);
        writeRecord_(sheet, kind, records[kind]);
      });
      SpreadsheetApp.flush();
      return json_({ ok: true, savedAt: new Date().toISOString(), kinds: Object.keys(records) });
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

function historySheet_(ss) {
  let h = ss.getSheetByName(HISTORY_TAB);
  if (!h) {
    h = ss.insertSheet(HISTORY_TAB);
    h.getRange(1, 1, 1, 5).setValues([['savedAt', 'kind', 'version', 'chunks', 'encryptedDataChunks']]);
    try { h.hideSheet(); } catch (e) { /* cosmetic */ }
  }
  return h;
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

function writeRecord_(sh, kind, record) {
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
  range.setValues([[kind, record.v || '', new Date().toISOString(), String(chunks.length)].concat(chunks)]);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
