/**
 * 🛣️ TOLL TAGS — EToll 2.0 "All Transactions Report" daily mail → Google Sheet (tag-wise unique)
 *
 * Sheet : "Toll Tags — Daily Import (EToll 2.0)"  (tabs: "Toll Tags" + "Toll Debit Daily" + "IMPORT_LOG")
 * Mail  : etoll.newer.teams@idfcfirstbank.com · subject "EToll 2.0 - All Transactions Report for ApnaPayment"
 *         (mail me CSV ka download link hota hai — file ~220 MB, isliye Range se tukdon me padhte hain)
 *
 * Rules
 *   • Sirf TOLL DEBIT rows: TRANSACTION_TYPE "NETC-TOLL-PASS*" (recharge / issuance wali rows nahi) aur success.
 *   • Sheet me TAG ID ke hisaab se ek hi row. Nayi tag → nayi row. Purani tag par agle din toll aaye →
 *     naya row NAHI; usi row me Toll Amount + Toll Txns badhte hain, Last Toll Date update hoti hai.
 *   • Ek report-date do baar import nahi hoti (IMPORT_LOG se check) — same mail dobara chale to bhi count double nahi.
 *   • Import ke baad IMPORT_LOG me 1 row + dashboard ko webhook (site notification + Home "last update" time).
 *
 * SETUP (ek baar)
 *   1. Is spreadsheet me Extensions → Apps Script → ye file paste karo.
 *   2. Project Settings → Script properties: DASH_SECRET = (Render me jo APPS_SCRIPT_SECRET hai wahi).
 *   3. tollSetup() run karo (permissions allow) — har 5 minute ka trigger lag jayega.
 *   4. Pehli baar kal ki mail abhi import karni ho: tollImportCheck() run karo.
 */
var TOLL_CFG = {
  SHEET_TAB: 'Toll Tags',
  LOG_TAB: 'IMPORT_LOG',
  MAIL_QUERY: 'from:etoll.newer.teams@idfcfirstbank.com subject:"All Transactions Report" newer_than:3d',
  BACKFILL_QUERY: 'from:etoll.newer.teams@idfcfirstbank.com subject:"All Transactions Report" newer_than:7d',
  DASH_URL: 'https://first-forward-dashboard.onrender.com',
  CHUNK: 8 * 1024 * 1024,            // UrlFetch max 50 MB; byte[] memory ke liye 8 MB ke tukde
  BUDGET_MS: 4 * 60 * 1000,          // 6 min limit se pehle checkpoint save karke ruk jao (download agle run me wahin se aage badhta hai)
  TYPE_PREFIX: 'NETC-TOLL-PASS',
  TZ: 'Asia/Kolkata'
};

/** Trigger: har 5 minute (tollSetup se lagta hai). */
function tollImportCheck() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10 * 1000)) return;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
    var runStart = Date.now();
    var done = tollDoneDates_(ss);
    var props = PropertiesService.getScriptProperties(), backfill = props.getProperty('BACKFILL_7D') === '1';   // ek baar ka 7 din import
    var threads = GmailApp.search(backfill ? TOLL_CFG.BACKFILL_QUERY : TOLL_CFG.MAIL_QUERY, 0, 20);
    var jobs = [];
    threads.forEach(function (th) {
      th.getMessages().forEach(function (m) {
        var info = tollParseMail_(m.getBody());
        if (info && !done[info.reportDate]) jobs.push({ id: m.getId(), reportDate: info.reportDate, url: info.url, at: m.getDate().getTime() });
      });
    });
    jobs.sort(function (a, b) { return a.reportDate < b.reportDate ? -1 : 1; });   // purani date pehle (ek din chhoot gaya ho to bhi)
    var seen = {};
    jobs = jobs.filter(function (j) { if (seen[j.reportDate]) return false; seen[j.reportDate] = 1; return true; });
    if (backfill && !jobs.length) { props.deleteProperty('BACKFILL_7D'); console.log('7 din ka backfill poora — ab sirf nayi mail dhundhi jayegi.'); }
    for (var i = 0; i < jobs.length; i++) {
      if (i > 0 && Date.now() - runStart > 150 * 1000) break;   // 6 min limit — baaki din agle trigger (5 min) me
      var r = tollImportOne_(ss, jobs[i], runStart);
      if (!r.ok) break;                       // fail → agla trigger dobara try karega
    }
  } finally { lock.releaseLock(); }
}

/** EK BAAR chalao: pichhle 7 din ki mails import hongi (trigger har 5 min me baaki din karta rahega); poora hote hi band, phir normal. */
function tollBackfill7() {
  PropertiesService.getScriptProperties().setProperty('BACKFILL_7D', '1');
  tollImportCheck();
}

/** Mail body → {reportDate:'YYYY-MM-DD', url}. */
function tollParseMail_(html) {
  html = String(html || '');
  var d = html.match(/covering the period from\s*(?:<[^>]+>\s*)*(\d{2})-(\d{2})-(\d{4})/i);
  var u = html.match(/href="(https:\/\/[^"]+\.csv\?[^"]+)"/i);
  if (!d || !u) return null;
  return { reportDate: d[3] + '-' + d[2] + '-' + d[1], url: u[1].replace(/&amp;/g, '&') };
}

/** IMPORT_LOG me jin report dates ka status OK hai. */
function tollDoneDates_(ss) {
  var out = {}, log = ss.getSheetByName(TOLL_CFG.LOG_TAB);
  if (!log || log.getLastRow() < 2) return out;
  log.getRange(2, 1, log.getLastRow() - 1, 9).getValues().forEach(function (r) {
    if (String(r[8]) === 'OK' && r[2]) out[String(r[2]).slice(0, 10)] = 1;
  });
  return out;
}

/** Ek report: download → aggregate → sheet merge → log → dashboard ko batao. */
function tollImportOne_(ss, job, runStart) {
  var t0 = runStart || Date.now();
  try {
    var agg = tollDownloadAggregate_(job.url, t0, job.reportDate);
    var res = tollMergeIntoSheet_(ss, agg.tags, job.reportDate);
    try { tollDailyUpsert_(ss, job.reportDate, agg); } catch (e3) { console.warn('toll daily fail: ' + e3); }
    var stamp = Utilities.formatDate(new Date(), TOLL_CFG.TZ, 'yyyy-MM-dd HH:mm:ss');
    var log = ss.getSheetByName(TOLL_CFG.LOG_TAB) || ss.insertSheet(TOLL_CFG.LOG_TAB);
    if (log.getLastRow() < 1) log.appendRow(['Tab', 'Time', 'Report Date', 'New Tags', 'Updated Tags', 'Toll Txns', 'Total Tags', 'Amount (₹)', 'Status', 'Mail ID']);
    log.appendRow([TOLL_CFG.SHEET_TAB, stamp, job.reportDate, res.added, res.updated, agg.txns, res.total, Math.round(agg.amount), 'OK', job.id]);
    if (log.getLastRow() > 1500) log.deleteRows(2, log.getLastRow() - 1500);
    tollNotifyDashboard_({ spreadsheetId: ss.getId(), at: new Date().toISOString(), reportDate: job.reportDate, newTags: res.added, updatedTags: res.updated, txns: agg.txns, totalTags: res.total, amount: Math.round(agg.amount), mailId: job.id, status: 'OK' });
    return { ok: true };
  } catch (e) {
    var msg = String(e && e.message || e).slice(0, 180);
    if (msg.indexOf('PARTIAL') === 0) { console.log('Download jaari: ' + msg + ' — agla trigger wahin se aage badhayega.'); return { ok: false, partial: true }; }
    try {
      var lg = ss.getSheetByName(TOLL_CFG.LOG_TAB);
      if (lg) lg.appendRow([TOLL_CFG.SHEET_TAB, Utilities.formatDate(new Date(), TOLL_CFG.TZ, 'yyyy-MM-dd HH:mm:ss'), job.reportDate, '', '', '', '', '', 'ERROR: ' + msg, job.id]);
    } catch (e2) { /* ignore */ }
    console.error('toll import fail ' + job.reportDate + ': ' + msg);
    return { ok: false, error: msg };
  }
}

/** 🛣️ "Toll Debit Daily" tab — date-wise + class-wise (CCH) toll debit ginti/₹; format purane GV tab jaisa. Roz ek row (upsert). */
var TOLL_DAILY_TAB = 'Toll Debit Daily';
var TOLL_DAILY_CLASSES = ['VC4', 'VC20', 'VC5', 'VC7', 'VC8', 'VC9', 'VC10', 'VC11', 'VC12', 'VC13', 'VC14', 'VC15', 'VC16', 'VC17', 'Other'];
function tollDailyHeader_() {
  var h = ['Date', 'Din', 'Toll Debit Txn', 'Toll Debit ₹', 'Unique Vehicles'];
  TOLL_DAILY_CLASSES.forEach(function (k) { h.push(k + ' Txn', k + ' ₹'); });
  h.push('Status', 'Updated'); return h;
}
function tollDailyUpsert_(ss, reportDate, agg) {
  var sh = ss.getSheetByName(TOLL_DAILY_TAB) || ss.insertSheet(TOLL_DAILY_TAB);
  var H = tollDailyHeader_();
  if (sh.getLastRow() < 1) { sh.getRange(1, 1, 1, H.length).setValues([H]).setFontWeight('bold'); sh.setFrozenRows(1); }
  var d = new Date(reportDate + 'T12:00:00+05:30');
  var ds = Utilities.formatDate(d, TOLL_CFG.TZ, 'dd-MMM-yyyy'), day = Utilities.formatDate(d, TOLL_CFG.TZ, 'EEE');
  var row = [ds, day, agg.txns, Math.round(agg.amount), Object.keys(agg.tags).length];
  TOLL_DAILY_CLASSES.forEach(function (k) { var c = agg.cls[k] || { n: 0, a: 0 }; row.push(c.n, Math.round(c.a)); });
  row.push('✅', Utilities.formatDate(new Date(), TOLL_CFG.TZ, 'dd-MMM HH:mm'));
  var n = Math.max(sh.getLastRow() - 1, 0), at = -1;
  if (n) { var dv = sh.getRange(2, 1, n, 1).getDisplayValues(); for (var i = 0; i < n; i++) { if (dv[i][0] === ds) { at = i + 2; break; } } }
  if (at < 0) at = sh.getLastRow() + 1;
  sh.getRange(at, 1, 1, 1).setNumberFormat('@');
  sh.getRange(at, 1, 1, row.length).setValues([row]);
  tollPushDaily_(sh);
}
/** Poora tab dashboard ko bhejo (sheet private rahe) — manual dobara bhejne ke liye bhi chalao. */
function tollPushDaily_(sh) {
  var n = sh.getLastRow() - 1; if (n < 1) return;
  var vals = sh.getRange(1, 1, n + 1, tollDailyHeader_().length).getDisplayValues();
  var rows = vals.slice(1).map(function (r) { return r.map(function (v, i) { return i >= 2 && i <= vals[0].length - 3 ? Number(String(v).replace(/[^\d.-]/g, '')) || 0 : v; }); });
  var secret = PropertiesService.getScriptProperties().getProperty('DASH_SECRET');
  if (!secret) { console.warn('DASH_SECRET set nahi — toll daily site ko nahi gaya'); return; }
  UrlFetchApp.fetch(TOLL_CFG.DASH_URL + '/api/push/toll-daily', { method: 'post', contentType: 'application/json', payload: JSON.stringify({ secret: secret, header: vals[0], rows: rows }), muteHttpExceptions: true });
}
function tollPushDailyNow() { tollPushDaily_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TOLL_DAILY_TAB)); }

/** S3 CSV ko Range se tukdon me padho; sirf toll rows tag-wise jodo. */
function tollDownloadAggregate_(url, t0, key) {
  var ck = tollLoadCk_(key);                                   // pichhle run ka checkpoint (220 MB ek run me nahi hota)
  var state = ck ? ck.state : { idx: null, tags: {}, cls: {}, txns: 0, amount: 0 };
  var pos = ck ? ck.pos : 0, total = ck ? ck.total : -1, carry = ck && ck.carry ? Utilities.base64Decode(ck.carry) : [];
  while (total < 0 || pos < total) {
    if (Date.now() - t0 > TOLL_CFG.BUDGET_MS) {
      tollSaveCk_(key, { pos: pos, total: total, carry: carry.length ? Utilities.base64Encode(carry) : '', state: state });
      throw new Error('PARTIAL ' + (total > 0 ? Math.round(pos * 100 / total) : 0) + '%');
    }
    var end = pos + TOLL_CFG.CHUNK - 1;
    var resp = UrlFetchApp.fetch(url, { headers: { Range: 'bytes=' + pos + '-' + end }, muteHttpExceptions: true });
    var code = resp.getResponseCode();
    if (code !== 206 && code !== 200) throw new Error('download HTTP ' + code);
    var cr = String(resp.getHeaders()['Content-Range'] || resp.getHeaders()['content-range'] || '').match(/\/(\d+)$/);
    var bytes = resp.getContent();
    if (code === 200) { total = bytes.length; pos = total; }                 // server ne Range nahi maani — poori file
    else { total = cr ? parseInt(cr[1], 10) : pos + bytes.length; pos += bytes.length; }
    var buf = carry.length ? carry.concat(bytes) : bytes;
    var last = pos >= total ? buf.length - 1 : -1;
    if (last < 0) { for (var i = buf.length - 1; i >= 0; i--) { if (buf[i] === 10) { last = i; break; } } }
    if (last < 0) { carry = buf; continue; }
    carry = last + 1 < buf.length ? buf.slice(last + 1) : [];
    var text = Utilities.newBlob(buf.slice(0, last + 1)).getDataAsString('UTF-8');
    tollParseText_(text, state);
    bytes = null; buf = null; text = null;
  }
  tollDelCk_(key);
  return state;
}

/** Checkpoint = Drive me chhoti JSON file (state + position). */
function tollCkName_(key) { return 'toll_checkpoint_' + key + '.json'; }
function tollLoadCk_(key) {
  var it = DriveApp.getFilesByName(tollCkName_(key));
  if (!it.hasNext()) return null;
  try { return JSON.parse(it.next().getBlob().getDataAsString()); } catch (e) { return null; }
}
function tollSaveCk_(key, obj) {
  var it = DriveApp.getFilesByName(tollCkName_(key)), s = JSON.stringify(obj);
  if (it.hasNext()) it.next().setContent(s); else DriveApp.createFile(tollCkName_(key), s, MimeType.PLAIN_TEXT);
}
function tollDelCk_(key) { var it = DriveApp.getFilesByName(tollCkName_(key)); while (it.hasNext()) it.next().setTrashed(true); }

/** Text (poori lines) ko parse karke state.tags me jodo. Pure function — Node test me bhi chalta hai. */
function tollParseText_(text, state) {
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
    if (!line) continue;
    var f = line.indexOf('"') < 0 ? line.split(',') : tollCsvLine_(line);
    if (!state.idx) {                                           // header
      var ix = {}; f.forEach(function (h, k) { ix[String(h).trim().replace(/^﻿/, '')] = k; });
      ['TAG_ID', 'TRANSACTION_TYPE', 'TRANSACTION_AMOUNT', 'TRANSACTION_SUCCESS_STATUS', 'VRN', 'TAG_ISSUING_AGENT_NAME', 'TAG_ISSUING_AGENT_ID'].forEach(function (k) { if (ix[k] == null) throw new Error('CSV me column nahi mila: ' + k); });
      state.idx = ix; continue;
    }
    var X = state.idx;
    var ty = f[X.TRANSACTION_TYPE] || '';
    if (ty.indexOf(TOLL_CFG.TYPE_PREFIX) !== 0) continue;
    if (String(f[X.TRANSACTION_SUCCESS_STATUS]).toLowerCase() === 'false') continue;
    var tag = String(f[X.TAG_ID] || '').trim().toUpperCase();
    if (!tag) continue;
    var amt = parseFloat(f[X.TRANSACTION_AMOUNT]); if (!isFinite(amt)) amt = 0;
    var cc = String(f[X.CCH] || '').trim().toUpperCase(); if (!/^VC\d+$/.test(cc)) cc = 'Other';
    var dc = state.cls[cc] || (state.cls[cc] = { n: 0, a: 0 }); dc.n += 1; dc.a += amt;   // 🛣️ class-wise (CCH) ginti + ₹
    var t = state.tags[tag];
    if (!t) { t = state.tags[tag] = { vrn: '', an: '', ai: '', cc: '', amt: 0, n: 0 }; }
    t.amt += amt; t.n += 1; state.txns += 1; state.amount += amt;
    if (!t.cc && /^VC\d+$/.test(cc)) t.cc = cc;                  // tag ki class (CCH)
    if (!t.vrn) t.vrn = String(f[X.VRN] || '').trim().toUpperCase();
    if (!t.an) t.an = String(f[X.TAG_ISSUING_AGENT_NAME] || '').trim();
    if (!t.ai) t.ai = String(f[X.TAG_ISSUING_AGENT_ID] || '').trim().replace(/^'+/, '');
  }
}

/** Quote-aware CSV line (sirf jin lines me " ho). */
function tollCsvLine_(line) {
  var out = [], cur = '', q = false;
  for (var i = 0; i < line.length; i++) {
    var c = line.charAt(i);
    if (q) { if (c === '"') { if (line.charAt(i + 1) === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * Tag-wise merge. Purani tag → Amount/Txns jodo (+ khaali VRN/Agent bharo); nayi tag → neeche nayi row.
 * Returns {added, updated, total}.
 */
function tollMergeIntoSheet_(ss, tags, reportDate) {
  var sh = ss.getSheetByName(TOLL_CFG.SHEET_TAB) || ss.insertSheet(TOLL_CFG.SHEET_TAB);
  if (sh.getLastRow() < 1) sh.appendRow(['Tag ID', 'VRN', 'Agent Name', 'Agent ID', 'Toll Amount (₹ total)', 'Toll Txns', 'First Toll Date', 'Last Toll Date', 'Class']);
  if (sh.getMaxColumns() < 9) sh.insertColumnsAfter(sh.getMaxColumns(), 9 - sh.getMaxColumns());
  if (sh.getLastRow() >= 1 && !sh.getRange(1, 9).getValue()) { sh.getRange(1, 9).setValue('Class'); sh.getRange(1, 8).copyFormatToRange(sh, 9, 9, 1, 1); sh.getRange(2, 9, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@'); }
  var res = tollMergeRows_(sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 9).getValues() : [], tags, reportDate);
  var existing = res.rows.length - res.fresh.length;
  if (res.touched && existing > 0) {
    sh.getRange(2, 5, existing, 4).setValues(res.rows.slice(0, existing).map(function (r) { return [r[4], r[5], r[6], r[7]]; }));
    if (res.filled) { sh.getRange(2, 2, existing, 3).setValues(res.rows.slice(0, existing).map(function (r) { return [r[1], r[2], r[3]]; })); sh.getRange(2, 9, existing, 1).setValues(res.rows.slice(0, existing).map(function (r) { return [r[8] || '']; })); }
  }
  if (res.fresh.length) {
    var start = sh.getLastRow() + 1, need = start + res.fresh.length - 1;
    if (need > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows() + 1000);
    sh.getRange(start, 1, res.fresh.length, 9).setNumberFormats(res.fresh.map(function () { return ['@', '@', '@', '@', '0.00', '0', '@', '@', '@']; }));
    sh.getRange(start, 1, res.fresh.length, 9).setValues(res.fresh);
  }
  SpreadsheetApp.flush();
  return { added: res.fresh.length, updated: res.updated, total: res.rows.length };
}

/** Ek baar chalao: jin purani tags ki Class khaali hai unhe sabse nayi mail se bharo (amount/txns ko haath nahi lagata). */
function tollFillClassNow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), t0 = Date.now(), best = null;
  GmailApp.search(TOLL_CFG.MAIL_QUERY, 0, 20).forEach(function (th) { th.getMessages().forEach(function (m) {
    var i = tollParseMail_(m.getBody()); if (i && (!best || i.reportDate > best.reportDate)) best = i; }); });
  if (!best) { console.warn('mail nahi mili'); return; }
  var agg;
  try { agg = tollDownloadAggregate_(best.url, t0, 'fill_' + best.reportDate); } catch (e) { if (String(e.message).indexOf('PARTIAL') === 0) { console.log('Download aadha hua (' + e.message + ') — tollFillClassNow dobara chalao.'); return; } throw e; }
  var sh = ss.getSheetByName(TOLL_CFG.SHEET_TAB); if (!sh || sh.getLastRow() < 2) return;
  if (sh.getMaxColumns() < 9) sh.insertColumnsAfter(sh.getMaxColumns(), 9 - sh.getMaxColumns());
  if (!sh.getRange(1, 9).getValue()) sh.getRange(1, 9).setValue('Class').setFontWeight('bold');
  var n = sh.getLastRow() - 1, tags = sh.getRange(2, 1, n, 1).getValues(), cur = sh.getRange(2, 9, n, 1).getValues(), c = 0;
  for (var i = 0; i < n; i++) { var t = agg.tags[String(tags[i][0]).trim().toUpperCase()]; if (!cur[i][0] && t && t.cc) { cur[i][0] = t.cc; c++; } }
  sh.getRange(2, 9, n, 1).setNumberFormat('@').setValues(cur);
  console.log('Class bhari: ' + c + ' tags (report ' + best.reportDate + ')');
}

/** Sheet kabhi text date ko Date bana de to bhi 'YYYY-MM-DD' wapas. */
function tollDateStr_(v) {
  if (!v) return '';
  if (v.getFullYear) { var m = v.getMonth() + 1, d = v.getDate(); return v.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d; }
  return String(v).slice(0, 10);
}

/** Pure merge: sheet rows + nayi tags → {rows, fresh, updated, touched, filled}. Node test me bhi chalta hai. */
function tollMergeRows_(rows, tags, reportDate) {
  var pending = {}, k;
  for (k in tags) pending[k] = 1;
  var updated = 0, filled = false, touched = false;
  for (var i = 0; i < rows.length; i++) {
    var tag = String(rows[i][0] || '').trim().toUpperCase();
    var t = tag && tags[tag];
    if (!t) continue;
    delete pending[tag];
    var r = rows[i];
    r[4] = Math.round(((Number(r[4]) || 0) + t.amt) * 100) / 100;
    r[5] = (Number(r[5]) || 0) + t.n;
    var first = tollDateStr_(r[6]), lastD = tollDateStr_(r[7]);
    r[6] = first && first < reportDate ? first : reportDate;      // pehli toll date (purani report baad me aaye to peeche jaati hai)
    r[7] = lastD > reportDate ? lastD : reportDate;               // aakhri toll date sirf aage badhti hai
    if (!r[1] && t.vrn) { r[1] = t.vrn; filled = true; }
    if (!r[2] && t.an) { r[2] = t.an; filled = true; }
    if (!r[3] && t.ai) { r[3] = t.ai; filled = true; }
    if (!r[8] && t.cc) { r[8] = t.cc; filled = true; }
    updated++; touched = true;
  }
  var fresh = [];
  for (k in pending) { var n = tags[k]; fresh.push([k, n.vrn, n.an, n.ai, Math.round(n.amt * 100) / 100, n.n, reportDate, reportDate, n.cc || '']); }
  return { rows: rows.concat(fresh), fresh: fresh, updated: updated, touched: touched, filled: filled };
}

/** Dashboard webhook — site notification + Home "last update" time. Fail ho to import fail nahi hota. */
function tollNotifyDashboard_(payload) {
  try {
    var secret = PropertiesService.getScriptProperties().getProperty('DASH_SECRET');
    if (!secret) { console.warn('DASH_SECRET set nahi — dashboard ko khabar nahi gayi'); return; }
    payload.secret = secret;
    UrlFetchApp.fetch(TOLL_CFG.DASH_URL + '/api/push/toll-import', { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
  } catch (e) { console.warn('dashboard notify fail: ' + e); }
}

/** Ek baar run karo: har 5 minute ka trigger. */
function tollSetup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'tollImportCheck') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('tollImportCheck').timeBased().everyMinutes(5).create();
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', SpreadsheetApp.getActiveSpreadsheet().getId());
  console.log('Toll import trigger set (har 5 min).');
}
