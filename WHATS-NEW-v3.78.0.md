# v3.78.0 — Home: sheet "last data update" now reads DATA_ARRIVAL_LOG + SHEET_UPDATE_LOG

- Exact time order per sheet: IMPORT_LOG → DATA_ARRIVAL_LOG (markDataArrived) → SHEET_UPDATE_LOG (tracker "Last change detected") → row/date logic.
- Card shows which log the time came from.
- No Apps Script change needed for the site; the log tabs are read through gviz (optional tabs).
