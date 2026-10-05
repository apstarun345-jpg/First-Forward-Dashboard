# ✨ v3.55.0 — Home issuance explorer, global search, and class-wise dispatch stock

## 📊 Home issuance explorer
- Added an FF + GV stacked bar chart for **VC4, VC20, and VC5+** on Home.
- Multi-select filters combine across channel, transaction type (**Replacement / Chassis**), class, and a custom date range.
- Quick date presets include Today, This month, Last month, Last 30 days, and All dates. The selection is remembered in the browser.
- Class totals above the chart show the overall count and FF/GV split; the chart respects the current account’s channel access.

## 🔎 Universal search
- Made the global search input available in the top bar on every page without waiting for sheet data to finish loading.
- Search covers First Forward and GV agents/TLs, IDs, barcodes, and tag IDs. The search icon now focuses the already-mounted input.

## 📦 Dispatch Planner
- Added full stock-by-class counts to Agent-wise rows for both channels, including the FF and GV source class labels.
- Class mix is also included in CSV/Excel exports. TL-wise class mix is explicitly the sum of member-agent stock and is labeled separately from the TL stock snapshot.

## ✅ Verification
- Added regression coverage for Home’s channel/type/class/date combinations, per-class bar values, class-wise dispatch stock, and global search mounting.
- Release wiring uses package/API version **3.55.0**, `config.js?v=107`, `styles.css?v=108`, `home.js?v=88`, `app.js?v=106`, `performance.js?v=105`, `masterSearch.js?v=107`, and service-worker cache `apnapayment-v111`.
