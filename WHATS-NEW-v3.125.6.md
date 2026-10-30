# v3.125.6
- EIR columns are now found by **header name** (server auto-detect, on boot + every 10 min). Settings → EIR columns has an auto toggle and a "Detect now" button; changed letters are saved automatically.
- KYC ratio reads `CUSTOMER_FULL_KYC` and the bank's newer `IS_FULL_KYC` (first non-blank), so recent "pending" rows drop.
- Settings: Issue time, KYC mode, KYC, KYC 2 letters added.
- New importer script `google-apps-script/EIR_IMPORT.gs`: bank column order, `ISSUE_TIME` right after `ISSUE_DATE`, one-time layout migration.
