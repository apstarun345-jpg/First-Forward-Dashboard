# v3.77.0 — Home: exact "last data update" for every sheet

- Every sheet card now shows the exact date + time with seconds (e.g. Sat, 24 Oct 2026, 04:35:12 am) and a visible line saying where that time came from and the last row number.
- Tag Assignment (no date column in the sheet): Apps Script now remembers a fingerprint of the tag / status / agent columns and records when it last changed. The card shows that time. First check only sets a baseline ("Change tracking started"); the exact time appears after the next update.
- Tag Assignment no longer falls back to the spreadsheet's file-level edit time (it is shared with GV Master, so it was misleading).

Setup (one time): paste google-apps-script/Code.gs again → Deploy → Manage deployments → Edit → New version → Deploy.
