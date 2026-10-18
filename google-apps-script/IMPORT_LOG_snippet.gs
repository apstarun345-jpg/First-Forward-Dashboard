/**
 * 📥 Dashboard "last import time" — har import script ke END me ek line call karo:
 *     logImport_('StockDataa');            // ya 'EIR', 'GV Master', 'Tag Assignment'
 * Same spreadsheet me "IMPORT_LOG" tab bana deta hai (A = Tab, B = Time, C = Rows) aur 1 row jodta hai.
 * Dashboard home isi tab se asli import time padhta hai.
 */
function logImport_(tabName, spreadsheetId) {
  try {
    var ss = spreadsheetId ? SpreadsheetApp.openById(spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
    var log = ss.getSheetByName('IMPORT_LOG');
    if (!log) { log = ss.insertSheet('IMPORT_LOG'); log.appendRow(['Tab', 'Time', 'Rows']); log.hideSheet(); }
    var sh = ss.getSheetByName(tabName);
    log.appendRow([tabName, new Date(), sh ? sh.getLastRow() : '']);
    var n = log.getLastRow();
    if (n > 2000) log.deleteRows(2, n - 2000);   // purani entries saaf
  } catch (e) { console.log('logImport_ fail: ' + e); }
}
