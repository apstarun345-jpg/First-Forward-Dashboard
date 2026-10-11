# v3.70.5 — 🔗 FASTag Mapping lookup: patli StockDataa sheet par `NO_COLUMN` fix

## Problem

Lookup dabane par ye error aa raha tha:

> **Lookup fail: Invalid query: NO_COLUMN: L** · Inputs queue me wapas aa gaye — dobara Lookup dabayein.

Wajah: gviz query me **columns hardcoded** the — exact-match query `select A,B,…,K,L,M` (13
columns) bhejti thi, jabki StockDataa sheet ab patli ho chuki hai (11 columns, A–K). Google
Visualization API sheet ke bahar wale column par `NO_COLUMN: L` error deti hai aur poora lookup
fail ho jaata tha. (Paging wali queries pehle se A–K select karti thi, isliye sirf pehla step toot raha tha.)

## Fix (`fastagMapping.js`)

1. **Select ab config-driven hai:** `selectClause()` sirf zaroori letters (schema ke id..tlName
   → A–K) select karta hai — extra L/M kabhi nahi bhejte. Sabhi 4 query sites (exact match,
   barcode scan paging, range fast path, range paged fallback) ek hi builder use karti hain.
2. **NO_COLUMN auto-shrink retry:** naya `stockQuery()` wrapper — gviz `NO_COLUMN: X` deta hai
   to select-list us column tak chhoti karke ek retry (aur bhi patli sheet, e.g. TL column
   delete ho gaya, par lookup phir chalti hai; missing fields table me khaali dikhte hain).
   Concurrent page queries ka race bhi handle hai (sibling shrink par doosri call bhi rebuild hoti hai).

## Tests

- `dev/fastag-mapping.lookup.test.js` — do naye regression tests:
  - 11-column sheet par `NO_COLUMN: L` nahi aata, row milti hai, wide select kabhi nahi jaata
  - 10-column sheet par NO_COLUMN: K → shrink-retry se lookup safal
- `dev/fastag-mapping.test.js` — hardcoded `select A…M` / `select A…K where` par ban, naye
  `selectClause()` / `stockQuery()` locks.
- FASTag suite 20/20 pass · poore suite me koi naya failure nahi (sab pre-existing/flaky known).

## Notes

- Service-worker shell cache `apnapayment-v124 → v125` bump — deploy ke baad sab devices ko
  naya lookup code mile (lazy module fingerprints bhi content-based refresh hote hain).
- VC-class normalize (v3.70.4) ke saath milakar: lookup ab patli sheet par bhi chalega aur
  mapping API ko hamesha `VC4…` canonical class jaayegi.
