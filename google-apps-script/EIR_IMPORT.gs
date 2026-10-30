/***************************************************************
 * ETOLL 2.0 - TAG ISSUANCE REPORT IMPORTER  (FINAL)
 *
 * Target Spreadsheet: 1ZHzmu7xtXl7trZDOXUbFmclJGffy98U4kz2QBSKsfwc
 * Target Sheet: EIR
 *
 * Features:
 * 1. Import today's latest matching Gmail report (CSV and XLSX)
 * 2. Append below existing data; never clear existing data
 * 3. Prevent duplicate TAG_ID values
 * 4. Delete rows older than 65 days using ISSUE_DATE
 * 5. Preserve header row 1
 * 6. Email notification for newly appended rows
 *
 * NEW IN THIS VERSION
 * A. BANK COLUMN ORDER: a column that exists in the bank report but
 *    not in the EIR sheet is inserted right after the previous bank
 *    column (same order as the bank file) - it is no longer pushed
 *    to the far right end of the sheet.
 * B. ISSUE_DATE stays a plain date (dd-mmmm-yyyy). The time of the
 *    bank's ISSUE_DATE is written to a new ISSUE_TIME column placed
 *    immediately after ISSUE_DATE.
 * C. One-time helpers to bring the EXISTING sheet in bank order:
 *      previewEIRLayoutMigration()  -> only logs the plan (safe)
 *      runEIRLayoutMigration()      -> applies the plan
 *
 * The dashboard finds EIR columns by HEADER NAME, so column letters
 * may move freely; it updates its own column settings by itself.
 ***************************************************************/

const EIR_CONFIG = {
  SPREADSHEET_ID: '1ZHzmu7xtXl7trZDOXUbFmclJGffy98U4kz2QBSKsfwc',
  SHEET_NAME: 'EIR',
  EMAIL_SUBJECT: 'Etoll 2.0 - Tag Issuance Report for ApnaPayment',
  NOTIFICATION_EMAIL: 'apstarun345@gmail.com',
  DAYS_TO_KEEP: 65,
  TIME_ZONE: 'Asia/Kolkata',
  DATE_HEADER: 'ISSUE_DATE',
  TIME_HEADER: 'ISSUE_TIME'
};

/**
 * MAIN FUNCTION
 * Run this function manually or through a time-driven trigger.
 */
function processLatestEtollReports() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log('Another EIR import is already running. Exiting.');
    return;
  }
  try {
    const ss = SpreadsheetApp.openById(EIR_CONFIG.SPREADSHEET_ID);
    let sheet = ss.getSheetByName(EIR_CONFIG.SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(EIR_CONFIG.SHEET_NAME);
    }

    // Always clean expired data, even if today's email is missing.
    deleteOldEIRRows(sheet, EIR_CONFIG.DAYS_TO_KEEP);

    const latestMessage = getLatestTodaysEIRMessage();
    if (!latestMessage) {
      Logger.log('No matching Etoll report email found for today. Expired rows have still been checked.');
      return;
    }

    const downloadUrl = extractEIRDownloadUrl(latestMessage);
    if (!downloadUrl) {
      Logger.log('No CSV/XLSX/download link found in the latest report email.');
      return;
    }

    const importedRowCount = importExcelAndAppend(downloadUrl, sheet, EIR_CONFIG.DAYS_TO_KEEP);

    // Safety cleanup after the import as well.
    deleteOldEIRRows(sheet, EIR_CONFIG.DAYS_TO_KEEP);

    if (importedRowCount > 0) {
      const importedDetails = {};
      importedDetails[EIR_CONFIG.SHEET_NAME] = importedRowCount;
      sendNotificationEmail(importedDetails);
    }
    Logger.log('EIR import completed. New rows appended: ' + importedRowCount);
  } catch (err) {
    Logger.log('EIR MAIN ERROR: ' + (err.stack || err.message || err));
    throw err;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Returns the latest matching email received today.
 */
function getLatestTodaysEIRMessage() {
  const messages = findEIRMessages_();
  const today = Utilities.formatDate(new Date(), EIR_CONFIG.TIME_ZONE, 'yyyy-MM-dd');
  const candidates = messages.filter(message =>
    Utilities.formatDate(message.getDate(), EIR_CONFIG.TIME_ZONE, 'yyyy-MM-dd') === today
  );
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((a, b) => b.getDate().getTime() - a.getDate().getTime());
  return candidates[0];
}

/**
 * All recent messages whose subject matches the Etoll report subject.
 */
function findEIRMessages_() {
  const threads = GmailApp.search('subject:"' + EIR_CONFIG.EMAIL_SUBJECT + '"', 0, 10);
  const expectedSubject = EIR_CONFIG.EMAIL_SUBJECT.toLowerCase();
  const messages = [];
  threads.forEach(thread => {
    thread.getMessages().forEach(message => {
      const messageSubject = String(message.getSubject() || '').toLowerCase();
      if (messageSubject.includes(expectedSubject)) {
        messages.push(message);
      }
    });
  });
  return messages;
}

/**
 * Extract download link from the email HTML or plain URLs.
 */
function extractEIRDownloadUrl(message) {
  let body = message.getBody() || '';
  body = body.replace(/&amp;/gi, '&');

  const urls = [];
  const hrefRegex = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = hrefRegex.exec(body)) !== null) {
    const url = match[1].trim();
    if (/^https?:\/\//i.test(url)) {
      urls.push(url);
    }
  }
  const urlRegex = /https?:\/\/[^\s"'<>]+/gi;
  while ((match = urlRegex.exec(body)) !== null) {
    urls.push(match[0].replace(/[),;]+$/, ''));
  }
  const uniqueUrls = [...new Set(urls)];

  function isCSVOrXLSX(url) {
    const cleanUrl = url.split(/[?#]/)[0].toLowerCase();
    return cleanUrl.endsWith('.csv') || cleanUrl.endsWith('.xlsx');
  }

  // Prefer direct CSV/XLSX links and then download-style URLs.
  let selected = uniqueUrls.find(isCSVOrXLSX);
  if (!selected) {
    selected = uniqueUrls.find(url => url.toLowerCase().includes('download'));
  }
  return selected || null;
}

/**
 * Download the report and return { data, cleanup }.
 * data = 2D array (row 0 = header). cleanup() trashes the temporary file.
 */
function loadEIRReport_(fileUrl) {
  let temporarySpreadsheetId = null;
  const cleanup = function () {
    if (!temporarySpreadsheetId) {
      return;
    }
    try {
      DriveApp.getFileById(temporarySpreadsheetId).setTrashed(true);
    } catch (cleanupError) {
      Logger.log('Temporary file cleanup warning: ' + cleanupError.message);
    }
    temporarySpreadsheetId = null;
  };

  try {
    const response = UrlFetchApp.fetch(fileUrl, { followRedirects: true, muteHttpExceptions: true });
    const statusCode = response.getResponseCode();
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error('Report download failed. HTTP status: ' + statusCode);
    }

    const blob = response.getBlob();
    const contentType = String(
      getEIRHeaderValue(response.getHeaders(), 'content-type') || blob.getContentType() || ''
    ).toLowerCase();
    const urlWithoutQuery = fileUrl.split(/[?#]/)[0].toLowerCase();
    const bytes = blob.getBytes();

    // XLSX files are ZIP containers and normally begin with PK.
    const isZipFile = bytes.length >= 2 && bytes[0] === 80 && bytes[1] === 75;
    const isXLSX = urlWithoutQuery.endsWith('.xlsx') || contentType.includes('spreadsheetml') || isZipFile;

    if (contentType.includes('text/html') && !isZipFile) {
      throw new Error('The report link returned HTML instead of a CSV/XLSX file. Check that the download URL is accessible.');
    }

    let data = [];
    if (isXLSX) {
      // Requires Advanced Google Service: Drive API v3.
      blob.setName('etoll_report_' + Date.now() + '.xlsx');
      const convertedFile = Drive.Files.create(
        { name: 'EIR_TEMP_' + Date.now(), mimeType: 'application/vnd.google-apps.spreadsheet' },
        blob
      );
      temporarySpreadsheetId = convertedFile.id;
      const tempSheet = SpreadsheetApp.openById(temporarySpreadsheetId).getSheets()[0];
      if (tempSheet && tempSheet.getLastRow() > 0) {
        data = tempSheet.getDataRange().getValues();
      }
    } else {
      // CSV support, including download URLs without a .csv extension.
      data = Utilities.parseCsv(blob.getDataAsString('UTF-8'));
    }
    return { data: data, cleanup: cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
}

/**
 * Fetch and append a CSV/XLSX report.
 *
 * Existing data is NOT cleared.
 * New unique TAG_ID records are appended below existing data.
 */
function importExcelAndAppend(fileUrl, sheet, daysToKeep) {
  const report = loadEIRReport_(fileUrl);
  try {
    const data = report.data;
    if (!data || data.length < 1 || !data[0]) {
      Logger.log('The downloaded report is empty.');
      return 0;
    }

    // Normalize header cells.
    const sourceHeaders = data[0].map(value =>
      String(value === null || value === undefined ? '' : value).replace(/^﻿/, '').trim()
    );
    const sourceHeaderMap = buildEIRHeaderMap(sourceHeaders);
    const sourceTagIdIndex = sourceHeaderMap.TAG_ID;
    const sourceDateIndex = sourceHeaderMap[EIR_CONFIG.DATE_HEADER];

    if (sourceTagIdIndex === undefined) {
      throw new Error('TAG_ID column not found in the incoming report.');
    }

    /*
     * The bank header list plus ISSUE_TIME placed right after ISSUE_DATE.
     * Missing columns are inserted in THIS order (bank order), never at
     * the far right of the sheet.
     */
    const plannedHeaders = withEIRTimeHeader(sourceHeaders);
    const targetHeaderMap = ensureEIRHeaders(sheet, plannedHeaders);

    const targetTagIdColumn = targetHeaderMap.TAG_ID;
    const targetDateColumn = targetHeaderMap[EIR_CONFIG.DATE_HEADER];
    const targetTimeColumn = targetHeaderMap[EIR_CONFIG.TIME_HEADER];
    // Fill ISSUE_TIME ourselves only when the bank does not send that column.
    const fillIssueTime = !!targetTimeColumn && sourceHeaderMap[EIR_CONFIG.TIME_HEADER] === undefined && sourceDateIndex !== undefined;

    if (!targetTagIdColumn) {
      throw new Error('TAG_ID column could not be mapped in the EIR sheet.');
    }

    const targetWidth = sheet.getLastColumn();
    if (targetWidth < 1) {
      throw new Error('Destination sheet has no columns.');
    }

    // Read existing TAG_ID values to prevent duplicates.
    const lastRow = sheet.getLastRow();
    const existingTagIds = new Set();
    if (lastRow >= 2) {
      const existingValues = sheet.getRange(2, targetTagIdColumn, lastRow - 1, 1).getDisplayValues();
      existingValues.forEach(item => {
        const tagId = normalizeEIRTagId(item[0]);
        if (tagId) {
          existingTagIds.add(tagId);
        }
      });
    }

    const newData = [];

    // Skip header row; append only records below existing data.
    for (let i = 1; i < data.length; i++) {
      const sourceRow = data[i];
      if (!sourceRow || sourceRow.every(value => value === '' || value === null || value === undefined)) {
        continue;
      }

      const tagId = normalizeEIRTagId(sourceRow[sourceTagIdIndex]);
      if (!tagId) {
        continue;
      }

      // Prevent duplicate IDs already present in the sheet
      // and duplicate IDs within this same report.
      if (existingTagIds.has(tagId)) {
        continue;
      }

      let parsedIssueDate = null;
      let issueTime = '';
      if (sourceDateIndex !== undefined) {
        parsedIssueDate = parseEIRDate(sourceRow[sourceDateIndex]);
        if (fillIssueTime) {
          issueTime = extractEIRTime(sourceRow[sourceDateIndex]);
        }
        // Do not append records whose valid ISSUE_DATE is already older than the retention window.
        if (parsedIssueDate && isEIRDayOlderThan(parsedIssueDate, daysToKeep)) {
          continue;
        }
      }

      const targetRow = new Array(targetWidth).fill('');
      for (let sourceCol = 0; sourceCol < sourceHeaders.length; sourceCol++) {
        const header = normalizeEIRHeader(sourceHeaders[sourceCol]);
        if (!header) {
          continue;
        }
        const targetColumn = targetHeaderMap[header];
        if (!targetColumn) {
          continue;
        }
        let value = sourceRow[sourceCol];
        if (header === EIR_CONFIG.DATE_HEADER && parsedIssueDate) {
          value = parsedIssueDate;   // date only (time goes to ISSUE_TIME)
        }
        targetRow[targetColumn - 1] = value === undefined || value === null ? '' : value;
      }
      if (fillIssueTime) {
        targetRow[targetTimeColumn - 1] = issueTime;
      }

      newData.push(targetRow);
      // Also prevent duplicate TAG_ID values in the same import.
      existingTagIds.add(tagId);
    }

    if (newData.length === 0) {
      Logger.log('No new eligible TAG_ID records. Existing rows preserved.');
      return 0;
    }

    /*
     * IMPORTANT: append directly beneath the last populated row.
     * Existing rows and the header are never cleared.
     */
    const appendStartRow = sheet.getLastRow() + 1;
    sheet.getRange(appendStartRow, 1, newData.length, targetWidth).setValues(newData);

    if (targetDateColumn) {
      sheet.getRange(appendStartRow, targetDateColumn, newData.length, 1).setNumberFormat('dd-mmmm-yyyy');
    }
    if (targetTimeColumn) {
      sheet.getRange(appendStartRow, targetTimeColumn, newData.length, 1).setNumberFormat('hh:mm:ss');
    }

    SpreadsheetApp.flush();
    Logger.log('Appended ' + newData.length + ' new rows starting at row ' + appendStartRow);
    return newData.length;
  } catch (err) {
    Logger.log('EIR IMPORT ERROR: ' + (err.stack || err.message || err));
    throw err;
  } finally {
    // Remove only the temporary converted spreadsheet.
    report.cleanup();
  }
}

/* ===================================================================
 * HEADER LAYOUT (bank order)
 * =================================================================== */

/**
 * Create a normalized header-to-index map (0-based indexes).
 */
function buildEIRHeaderMap(headers) {
  const map = {};
  headers.forEach((header, index) => {
    const normalized = normalizeEIRHeader(header);
    if (normalized && map[normalized] === undefined) {
      map[normalized] = index;
    }
  });
  return map;
}

/**
 * Bank headers + ISSUE_TIME right after ISSUE_DATE (unless the bank
 * already sends ISSUE_TIME).
 */
function withEIRTimeHeader(sourceHeaders) {
  const cleaned = sourceHeaders.map(value => String(value || '').replace(/^﻿/, '').trim());
  const names = cleaned.map(normalizeEIRHeader);
  if (names.indexOf(EIR_CONFIG.TIME_HEADER) !== -1) {
    return cleaned;
  }
  const dateAt = names.indexOf(EIR_CONFIG.DATE_HEADER);
  if (dateAt === -1) {
    return cleaned;
  }
  const out = cleaned.slice();
  out.splice(dateAt + 1, 0, EIR_CONFIG.TIME_HEADER);
  return out;
}

/**
 * PURE: where must missing columns be inserted so the sheet follows the
 * bank order?  Each missing header goes right after the previous planned
 * header that exists in the sheet.
 * Returns { layout: [normalized headers after inserts], inserts: [{ header, col }] }
 * col = 1-based column number at the moment of the insert.
 */
function planEIRInsertions(existingHeaders, plannedHeaders) {
  const layout = existingHeaders.map(normalizeEIRHeader);
  const inserts = [];
  let prevIndex = -1;
  plannedHeaders.forEach(rawHeader => {
    const raw = String(rawHeader || '').replace(/^﻿/, '').trim();
    const name = normalizeEIRHeader(raw);
    if (!name) {
      return;
    }
    const at = layout.indexOf(name);
    if (at !== -1) {
      prevIndex = at;
      return;
    }
    const insertAt = prevIndex + 1;
    layout.splice(insertAt, 0, name);
    inserts.push({ header: raw, col: insertAt + 1 });
    prevIndex = insertAt;
  });
  return { layout: layout, inserts: inserts };
}

/**
 * PURE: moves needed so existing bank columns follow the bank order.
 * Only columns that are out of place are moved; helper/formula columns
 * (Master ID, TL Name, ...) are never moved on their own.
 * Returns { layout, moves: [{ header, from, destination }] }
 * from / destination are 1-based and use Sheet.moveColumns() semantics
 * (destination = column index BEFORE the move).
 */
function planEIRMoves(existingHeaders, plannedHeaders) {
  const layout = existingHeaders.map(normalizeEIRHeader);
  const moves = [];
  let prevName = '';
  plannedHeaders.forEach(rawHeader => {
    const name = normalizeEIRHeader(rawHeader);
    if (!name) {
      return;
    }
    const idx = layout.indexOf(name);
    if (idx === -1) {
      return;
    }
    if (prevName) {
      const prevIdx = layout.indexOf(prevName);
      if (idx !== prevIdx + 1) {
        moves.push({ header: name, from: idx + 1, destination: prevIdx + 2 });
        layout.splice(idx, 1);
        layout.splice(layout.indexOf(prevName) + 1, 0, name);
      }
    }
    prevName = name;
  });
  return { layout: layout, moves: moves };
}

/**
 * Ensure destination headers exist WITHOUT replacing existing ones.
 * Missing bank columns are inserted in bank order.
 * Returns a map: normalized header -> 1-based sheet column.
 */
function ensureEIRHeaders(sheet, plannedHeaders) {
  let lastColumn = sheet.getLastColumn();
  let existingHeaders = [];
  if (lastColumn > 0) {
    existingHeaders = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  }
  const hasHeaders = existingHeaders.some(value => String(value || '').trim() !== '');

  if (!hasHeaders) {
    const cleanedHeaders = plannedHeaders.map(value => String(value || '').replace(/^﻿/, '').trim());
    const neededColumns = cleanedHeaders.length;
    if (sheet.getMaxColumns() < neededColumns) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), neededColumns - sheet.getMaxColumns());
    }
    sheet.getRange(1, 1, 1, neededColumns).setValues([cleanedHeaders]);
    existingHeaders = cleanedHeaders;
  } else {
    const plan = planEIRInsertions(existingHeaders, plannedHeaders);
    plan.inserts.forEach(step => {
      if (step.col <= 1) {
        sheet.insertColumnBefore(1);
      } else {
        sheet.insertColumnAfter(step.col - 1);
      }
      sheet.getRange(1, step.col).setValue(step.header);
    });
    if (plan.inserts.length) {
      Logger.log('EIR columns inserted in bank order: ' +
        plan.inserts.map(s => s.header + ' @col ' + s.col).join(', '));
      SpreadsheetApp.flush();
    }
    existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  }

  const headerMap = {};
  existingHeaders.forEach((header, index) => {
    const normalized = normalizeEIRHeader(header);
    if (normalized && headerMap[normalized] === undefined) {
      headerMap[normalized] = index + 1;
    }
  });
  return headerMap;
}

/**
 * Header normalization for reliable matching.
 */
function normalizeEIRHeader(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/^﻿/, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

/**
 * TAG_ID normalization.
 */
function normalizeEIRTagId(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

/* ===================================================================
 * ONE-TIME MIGRATION OF THE EXISTING SHEET TO BANK ORDER
 * =================================================================== */

/** Safe: only logs what would change. */
function previewEIRLayoutMigration() {
  return migrateEIRLayoutToBankOrder_(true);
}

/** Applies the plan (inserts ISSUE_TIME, moves out-of-order bank columns such as IS_FULL_KYC). */
function runEIRLayoutMigration() {
  return migrateEIRLayoutToBankOrder_(false);
}

function migrateEIRLayoutToBankOrder_(dryRun) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log('Another EIR job is running. Try again in a minute.');
    return null;
  }
  let report = null;
  try {
    const sheet = SpreadsheetApp.openById(EIR_CONFIG.SPREADSHEET_ID).getSheetByName(EIR_CONFIG.SHEET_NAME);
    if (!sheet) {
      throw new Error('EIR sheet not found.');
    }

    // Latest report (any day) gives the bank's current column order.
    const messages = findEIRMessages_().sort((a, b) => b.getDate().getTime() - a.getDate().getTime());
    if (!messages.length) {
      throw new Error('No Etoll report email found to read the bank column order from.');
    }
    const url = extractEIRDownloadUrl(messages[0]);
    if (!url) {
      throw new Error('No download link in the latest report email.');
    }
    report = loadEIRReport_(url);
    if (!report.data.length) {
      throw new Error('The latest report is empty.');
    }
    const planned = withEIRTimeHeader(report.data[0]);

    const lastColumn = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];

    const insertPlan = planEIRInsertions(headers, planned);
    const movePlan = planEIRMoves(insertPlan.layout, planned);

    Logger.log('Bank order (with ISSUE_TIME): ' + planned.join(' | '));
    Logger.log('INSERT ' + insertPlan.inserts.length + ' column(s): ' +
      (insertPlan.inserts.map(s => s.header + ' @col ' + s.col).join(', ') || 'none'));
    Logger.log('MOVE ' + movePlan.moves.length + ' column(s): ' +
      (movePlan.moves.map(m => m.header + ' col ' + m.from + ' -> before col ' + m.destination).join(', ') || 'none'));

    if (dryRun) {
      Logger.log('DRY RUN only - nothing changed. Run runEIRLayoutMigration() to apply.');
      return { inserts: insertPlan.inserts, moves: movePlan.moves };
    }

    // 1) insert missing columns (ISSUE_TIME ...) in bank order
    ensureEIRHeaders(sheet, planned);

    // 2) move out-of-order bank columns; plan again on the real layout
    const realHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    const realMoves = planEIRMoves(realHeaders, planned).moves;
    realMoves.forEach(move => {
      sheet.moveColumns(sheet.getRange(1, move.from, 1, 1), move.destination);
      // positions shift after every move - re-plan so the next step is exact
    });
    SpreadsheetApp.flush();
    Logger.log('Migration applied. Inserted: ' + insertPlan.inserts.length + ', moved: ' + realMoves.length);
    return { inserts: insertPlan.inserts, moves: realMoves };
  } catch (err) {
    Logger.log('EIR MIGRATION ERROR: ' + (err.stack || err.message || err));
    throw err;
  } finally {
    if (report) {
      report.cleanup();
    }
    lock.releaseLock();
  }
}

/* ===================================================================
 * RETENTION CLEANUP
 * =================================================================== */

/**
 * Delete existing rows whose valid ISSUE_DATE is older than 65 days.
 * Row 1 is always preserved.
 */
function deleteOldEIRRows(sheet, daysToKeep) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 3 || lastColumn < 1) {
    Logger.log('No EIR data rows to clean.');
    return 0;
  }

  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  const headerMap = buildEIRHeaderMap(headers);
  const dateIndex = headerMap[EIR_CONFIG.DATE_HEADER];
  if (dateIndex === undefined) {
    Logger.log('Expired-row cleanup skipped: ISSUE_DATE header not found.');
    return 0;
  }

  const dateColumn = dateIndex + 1;
  const dates = sheet.getRange(3, dateColumn, lastRow - 2, 1).getValues();
  const cutoffDayKey = getEIRCutoffDayKey(daysToKeep);
  const rowsToDelete = [];

  dates.forEach((item, index) => {
    const date = parseEIRDate(item[0]);
    // Leave blank or unrecognized dates untouched for safety.
    if (!date) {
      return;
    }
    if (getEIRDateDayKey(date) < cutoffDayKey) {
      rowsToDelete.push(index + 3);
    }
  });

  if (rowsToDelete.length === 0) {
    Logger.log('No expired EIR data rows found.');
    return 0;
  }

  // Delete contiguous groups from bottom to top (much faster than one row at a time).
  let groupStart = rowsToDelete[rowsToDelete.length - 1];
  let groupEnd = groupStart;
  for (let i = rowsToDelete.length - 2; i >= 0; i--) {
    const row = rowsToDelete[i];
    if (row === groupStart - 1) {
      groupStart = row;
    } else {
      sheet.deleteRows(groupStart, groupEnd - groupStart + 1);
      groupStart = row;
      groupEnd = row;
    }
  }
  sheet.deleteRows(groupStart, groupEnd - groupStart + 1);

  Logger.log('Deleted ' + rowsToDelete.length + ' expired rows from ' + sheet.getName());
  return rowsToDelete.length;
}

/* ===================================================================
 * DATE / TIME HELPERS
 * =================================================================== */

/**
 * Parse supported date types and formats.
 * Returned Date is anchored at noon UTC to avoid midnight timezone shifts.
 */
function parseEIRDate(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  // Google Sheets / Excel date value.
  if (value instanceof Date) {
    if (isNaN(value.getTime())) {
      return null;
    }
    return parseEIRDate(Utilities.formatDate(value, EIR_CONFIG.TIME_ZONE, 'yyyy-MM-dd'));
  }

  // Numeric Excel serial date.
  if (typeof value === 'number') {
    if (value >= 20000 && value <= 80000) {
      const base = Date.UTC(1899, 11, 30);
      const serialDay = Math.floor(value);
      return new Date(base + serialDay * 86400000 + 12 * 60 * 60 * 1000);
    }
    return null;
  }

  const text = String(value).trim();
  let match;

  // ISO yyyy-mm-dd, optionally followed by a time.
  match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (match) {
    return makeValidEIRDate(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  // Indian date: dd/mm/yyyy or dd-mm-yyyy, optionally with time.
  match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:[T\s].*)?$/);
  if (match) {
    let year = Number(match[3]);
    if (year < 100) {
      year += 2000;
    }
    return makeValidEIRDate(year, Number(match[2]), Number(match[1]));
  }

  // dd-MMMM-yyyy or dd-MMM-yyyy.
  match = text.match(/^(\d{1,2})-([A-Za-z]+)-(\d{4})(?:\s.*)?$/);
  if (match) {
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december'];
    const monthText = match[2].toLowerCase();
    const monthIndex = monthNames.findIndex(month => month === monthText || month.substring(0, 3) === monthText);
    if (monthIndex !== -1) {
      return makeValidEIRDate(Number(match[3]), monthIndex + 1, Number(match[1]));
    }
  }

  return null;
}

/**
 * Time of day of the bank's ISSUE_DATE value, as a Sheets time value
 * (fraction of a day, e.g. 0.5 = 12:00:00). '' when the source has no time.
 * Understands: "29-10-2026 21:17:40 IST", "2026-10-29T21:17:40", "9:05 PM",
 * Date objects (XLSX) and Excel serial numbers with a fractional part.
 */
function extractEIRTime(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  if (value instanceof Date) {
    if (isNaN(value.getTime())) {
      return '';
    }
    const parts = Utilities.formatDate(value, EIR_CONFIG.TIME_ZONE, 'HH:mm:ss').split(':').map(Number);
    return eirTimeToFraction(parts[0], parts[1], parts[2], '');
  }
  if (typeof value === 'number') {
    const fraction = value - Math.floor(value);
    return fraction > 0.0000005 ? Math.round(fraction * 86400) / 86400 : '';
  }
  const match = String(value).match(/(?:^|[\sT])(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(AM|PM)?/i);
  if (!match) {
    return '';
  }
  return eirTimeToFraction(Number(match[1]), Number(match[2]), Number(match[3] || 0), match[4] || '');
}

/**
 * h/m/s (+ optional AM/PM) -> fraction of a day. 00:00:00 means "no time".
 */
function eirTimeToFraction(hours, minutes, seconds, meridiem) {
  let h = Number(hours), m = Number(minutes), s = Number(seconds);
  const ap = String(meridiem || '').toUpperCase();
  if (ap === 'PM' && h < 12) {
    h += 12;
  }
  if (ap === 'AM' && h === 12) {
    h = 0;
  }
  if (!(h >= 0 && h < 24 && m >= 0 && m < 60 && s >= 0 && s < 60)) {
    return '';
  }
  if (h === 0 && m === 0 && s === 0) {
    return '';
  }
  return (h * 3600 + m * 60 + s) / 86400;
}

/**
 * Validate date and return a Date anchored at noon UTC.
 */
function makeValidEIRDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

/**
 * Integer day key for a parsed date.
 */
function getEIRDateDayKey(date) {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000);
}

/**
 * Today's India-local date minus retention days.
 */
function getEIRCutoffDayKey(daysToKeep) {
  const todayText = Utilities.formatDate(new Date(), EIR_CONFIG.TIME_ZONE, 'yyyy-MM-dd');
  const parts = todayText.split('-').map(Number);
  return Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2] - daysToKeep) / 86400000);
}

/**
 * Check whether a valid date is older than the retention cutoff.
 */
function isEIRDayOlderThan(date, daysToKeep) {
  return getEIRDateDayKey(date) < getEIRCutoffDayKey(daysToKeep);
}

/**
 * Case-insensitive response header lookup.
 */
function getEIRHeaderValue(headers, requestedName) {
  if (!headers) {
    return '';
  }
  const target = requestedName.toLowerCase();
  for (const name in headers) {
    if (name.toLowerCase() === target) {
      return headers[name];
    }
  }
  return '';
}

/**
 * Send a summary only when new rows were appended.
 */
function sendNotificationEmail(importedDetails) {
  let total = 0;
  let body = 'Etoll Report Import Summary\n\nNew unique FASTag records appended to EIR:\n\n';
  for (const sheetName in importedDetails) {
    const count = importedDetails[sheetName];
    total += count;
    body += 'Sheet: ' + sheetName + '\nNew rows appended: ' + count + '\n\n';
  }
  body += 'TOTAL NEW ROWS: ' + total + '\nTime: ' +
    Utilities.formatDate(new Date(), EIR_CONFIG.TIME_ZONE, 'dd-MMMM-yyyy HH:mm:ss');
  MailApp.sendEmail(EIR_CONFIG.NOTIFICATION_EMAIL, 'Etoll Tag Issuance Summary', body);
}

/***** DATA ARRIVAL STAMP — import script data daalte hi time likh deti hai *****/
function markDataArrived(tab, note, spreadsheetId) {
  const TZ = 'Asia/Kolkata';
  const ss = spreadsheetId ? SpreadsheetApp.openById(spreadsheetId) : SpreadsheetApp.getActive();
  const now = new Date();
  const stamp = Utilities.formatDate(now, TZ, 'dd MMM yyyy, hh:mm:ss a');
  const dataSh = ss.getSheetByName(tab);
  const rows = dataSh ? Math.max(0, dataSh.getLastRow() - 1) : '';

  // 1) Latest status: har tab ki ek row
  let log = ss.getSheetByName('DATA_ARRIVAL_LOG') || ss.insertSheet('DATA_ARRIVAL_LOG');
  if (log.getLastRow() === 0) {
    log.appendRow(['Tab', 'Last data arrived', 'Data rows', 'Note', 'Timestamp (ms)']);
    log.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#1a73e8').setFontColor('#fff');
    log.setFrozenRows(1);
  }
  const tabs = log.getRange(1, 1, log.getLastRow(), 1).getValues().map(r => r[0]);
  let r = tabs.indexOf(tab) + 1;
  if (r < 1) r = log.getLastRow() + 1;
  log.getRange(r, 1, 1, 5).setValues([[tab, stamp, rows, note || '', now.getTime()]]);

  // 2) History: har baar ek nayi row (poora record)
  let hist = ss.getSheetByName('DATA_ARRIVAL_HISTORY') || ss.insertSheet('DATA_ARRIVAL_HISTORY');
  if (hist.getLastRow() === 0) hist.appendRow(['Tab', 'Arrived at', 'Data rows', 'Note']);
  hist.appendRow([tab, stamp, rows, note || '']);
  if (hist.getLastRow() > 5000) hist.deleteRows(2, 1000);   // sheet bhari na ho

  PropertiesService.getScriptProperties().setProperty('ARRIVED|' + tab, String(now.getTime()));
}
