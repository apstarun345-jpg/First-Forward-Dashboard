# v3.125.463 — Sheets last data update (permanent fix)
- StockDataa / Tag Assignment ka time ab sirf import-log se; server na mile to galat "6 days ago" nahi, pichhla pakka time (last known) ya "checking".
- Server: import-log mil jaye to Apps Script ka 15s intezaar nahi; last-good cache; client 3 baar retry.
