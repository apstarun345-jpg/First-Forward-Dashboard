# ✨ v3.41.0 — 🔎 Home search = poori report (⚖ FF + GV toggle) · TL agents table · Agent × Class stock · Summary channel switch

> Theme: **"Naam search karo — last month, current, TL ke agents, stock (own / agents / total), class-wise — FF aur GV dono, aur har number se barcode tak."**
> Analysis: [`SHEETS-ANALYSIS.md`](SHEETS-ANALYSIS.md) (REPORT + GV REPORT sheet describe + drill-down map).

## Kya naya

1. **`searchReport.js` (naya)** — Home / Master Search me same naam ke FF + GV log ek **group**.
   * Ek hi insaan ho to poori report **auto inline** (pehle sirf *exactly 1 person* par).
   * Upar toggle: **⚖ FF + GV** · **🟦 First Forward** · **🟩 GV Partner**.
   * **⚖ tab:** Last month (VC4 / Comm / Total) · Current month · Growth · Stock (VC4 / Comm / total) · **TL ke paas (own) + agents ke paas = TL total** ·
     Agents ginti · **Class-wise** (last · current · stock) — FF, GV aur jod. FF / GV ka har number clickable → drawer → class → din → tag / barcode.
   * Kai alag log match hon to har card par **📂 Yahin poori report** (card ke neeche inline, Home aur search panel dono me).
2. **TL ke agents table (`masterProfile.js`)** — **Stock · Last month · This month**, har ek **VC4 / Comm / Total**; har cell
   `scope=month|mtd|stock` + `agent` + `group` ka drawer kholta hai. Footer: Agents total → TL own → = TL total (issuance ke saath).
3. **📦 Agent-wise × Class stock matrix** (FF + GV TL) — TL + har agent ka class-wise stock; cell → agent + class ka stock (barcode rows). FF: `StockDataa` rows,
   GV: `Stock Agent Class` rows; rows na hon to REPORT row ke class columns. TL ki rollup row ke liye composition ka `own` use hota hai (double count nahi).
4. **Section nav chips** — Stock · Last vs Current · Class-wise · Agents · Agent × Class · Charts (smooth scroll).
5. **Agent / TL Summary** — `🟩 GV Partner me dekho 👉` / `🟦 First Forward me dekho 👉` (permission + GV enabled ho to). Naam dusre channel me na mile to toast.
6. **Home search header** ab batata hai ki naam par kya-kya milta hai.

## Files
`searchReport.js` (new) · `masterSearch.js` · `masterProfile.js` · `agentSummary.js` · `styles.css` · `index.html` + `sw.js` (`?v=64`, `apnapayment-v72`) ·
`package.json` (3.41.0, `npm run check` me searchReport) · `server.js` (health version) · `dev/search-report.test.js` (9 tests) · `dev/smoke.js` · `SHEETS-ANALYSIS.md`

## Tests
`npm test` → **396 pass / 0 fail** · `npm run check` → syntax ok · `dev/smoke.js` — naye checks pass (2 purane date-based smoke failures baseline par bhi hain).
