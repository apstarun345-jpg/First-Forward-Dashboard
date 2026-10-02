# WHAT'S NEW — v3.43.0 · 📊 REPORT data everywhere — Home search + Agent/TL Summary (FF + GV)

**Rule:** Home search, FF Agent/TL Summary aur GV Agent/TL Summary — teeno jagah numbers
**SAME** (agent, TL, stock, total issuance, last month) aur sab seedha **REPORT tab (FF)** /
**GV REPORT tab (GV)** se.

## 🎨 Home — naya Master Search bar + 📊 REPORT data table

- **Search bar v2:** bada hero input (focus ring), `/` shortcut, ✕ clear, **channel filter chips**
  (🎯 Sab · 🟦 First Forward · 🟩 GV Partner) + live meta line ("N log · X agents · Y TLs · Z tags").
- **📊 REPORT data — ek nazar me:** search results me sabse upar sortable + filterable data table —
  **🧑‍💼 Agent / TL · 👥 TL · 📦 Stock · 🏷️ Total Issuance (MTD) · 📅 Last Month · 📈 Growth**.
  - Har number cell click → wahi detail drawer (scope=stock / scope=mtd / scope=month).
  - Row click → neeche us person ki card + poori report auto-open.
  - TL rows me stock/issuance = **own + agents** (rollup), agent rows = apna data + TL naam.
  - Footer = agents-only grand total (TL rollup dobara nahi judta).
- **Kundli cards v2:** channel-coloured avatar (🟦 FF / 🟩 GV), badge row, upar **data strip**
  (Stock · Total Issuance · Last Month · Growth) + detailed stats (mobile, priority, TL ke under
  stock, sug dispatch, run-rate, cover, growth, expected month-end).
- **Topbar suggestions** me ab `🏷️ Total · 📅 last month` bhi.

## 📋 Agent / TL Summary (FF + GV pages)

- **📊 REPORT data — sabhi agents & TLs** list card: poori roster ek table me (same 6 columns),
  chips (🎯 Sab · 🧑‍💼 Agents · 👥 TLs) + table filter + "Aur dikhao" paging (250+ rows safe).
  Row / 📂 click → usi person ka poora summary neeche paint hota hai.
- **Report header v2:** channel-gradient avatar, badges (channel · role · priority · activity ·
  **📄 REPORT tab / GV REPORT tab** source chip), ID/TL/mobile line, TL report par
  "own + agents" note. KPI titles ab user-language me: **🏷️ Total Issuance · 📅 Last Month
  Issuance · 📦 Stock in hand** (TL par "own + agents" foot).

## 🧮 Ek hi numbers — kaise guarantee

- Nayi shared layer **`FF.masterProfile.reportDataRow(person)`** + **`peopleTableHtml(rows, opts)`**
  (+ `personFromRow`) — table rows numbers **`quick()`/`build()` profile se** nikalte hain (wahi
  jo Summary KPI cards render karte hain) — kahin dobara calculate nahi, isliye drift nahi.
  quick() me row na ho to list ka fallback (`found:false` chip ke saath).
- Tests: `dev/report-data-table.test.js` (8) — FF agent/TL + GV agent/TL parity, TL rollup,
  agents-only footer, dataset round-trip, summary-list consistency.
- Smoke: `dev/smoke.js` me naya case — FF + GV Summary pages ka search + table + report header.

`npm test` → 417 pass · `npm run check` ok · smoke: sirf wahi 2 pre-existing mock-data failures
(Hourly Sprints timing, T-1 pct fixture) jo main par bhi fail hote the.
