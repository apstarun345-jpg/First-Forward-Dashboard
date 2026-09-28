# v3.7.0 — Kya naya hai (Hinglish quick guide)

> Sab kuch `main` me jaane ke liye PR #20 merge karna hai → Render khud deploy kar dega.
> Live site: https://first-forward-dashboard.onrender.com

## 1. FF Commission — ab kyun chalega (asli bug ki 3 layer fix)

Maine live REPORT tab (gid `242489821`) dobara fetch kiya — us snapshot me **78 columns (A–BZ)** thay aur
`Commission Rate` heading kahin nahi mili, isliye dashboard commission dikha hi nahi sakta tha.
Ab code har wajah handle karta hai:

| Wajah | Fix |
|---|---|
| Settings me **heading ka naam** likha (letter nahi) | Server + app dono ab heading naam accept karte hain — `Commission Rate`, `Earned Commission` bhi valid |
| Sheet me extra spaces / chhote-bade letters (`Earned   Commission`) | Matching whitespace + case insensitive |
| Commission column REPORT me **sabse right** me hai, range chhota set hai | Page khud wider range (A1:BA → A1:CF) maangta hai, khaali columns trim karta hai; values range ke bahar hon to **“🔧 REPORT range poora karo (one click)”** card |
| Sheet me column abhi add hua, purana snapshot load tha | **🔄 Fresh sync** button (page head + warning card) — `fresh=1` se server cache bypass hokar Google se naya REPORT |

Extra: **🔍 REPORT commission column finder** table me har column ka letter + section + heading dikhta hai,
green row = dashboard wahi use kar raha hai, aur admin ek click me **₹ Rate / ₹ Earned / Category / Date** map kar sakta hai.

👉 Agar aaj bhi commission blank dikhe: Commission page kholo → **🔄 Fresh sync** dabao → phir finder me `Commission Rate`
column par **₹ Rate** aur `Earned Commission` par **₹ Earned** set kar do. Koi guessed rate se payout calculate nahi hota.

## 2. GV Commission — class-wise (VC4 · VC20 · VC5+)
Har class ka **apna table**: class board (tags, agents, amount, commission, ₹/tag, effective rate %) + agent-wise
commission table (ya rate × tags) + apna **CSV** button. Upar class-wise summary table, neeche slab review.

## 3. Cross Channel → Dual-channel Agents
- **Agent ka naam + TL ka naam** — FF aur GV dono channel se
- **FF tags** aur **GV tags** (stock bhi) alag columns me
- Shared barcodes, evidence (barcode / GV unique-ID), GV commission, class mix
- **⬇ Double-mapped barcodes CSV** (page head + table ke upar) aur “Saari shared barcodes CSV”
- `Double-mapped? = YES` jab: FF aur GV me alag agent, ya ek hi source me ek se zyada rows/owners
- Sirf **verified joins** — naam se guess kabhi nahi

## 4. Data Quality Center
6 colourful KPI cards, source health grid, category-wise check summary, severity/category/source/search filters,
findings table (row click → **sample rows dialog**), sample rows table, CSV + Excel export.

## 5. Stock Forecasting
Scenario sliders (growth / safety), risk strip (Critical / High / Medium / Covered / No run-rate),
urgent dispatch **top 25 + CSV**, channel summary, TL rollup, agent-level forecast table, Excel (4 sheets).

## 6. Look & feel
Naye **colourful KPI cards** (`data-tone g1…g12` + icons), proper colourful sticky-head tables,
tone utilities, `.class-board`, `.risk-strip`, `.sev-pill` etc.

---

## Verify kaise hua
- `npm run check` → syntax OK
- `npm test` → **53/53 pass**
- `node dev/smoke.js` (mock gviz + server) → **ALL OK**, naye tests ke saath:
  - FF commission heading-name mapping (chhote letters, extra spaces, galat naam par warning)
  - FF commission wide-range fallback (chhota range → wide re-fetch → `needsWiderRange` card)
  - GV commission per-class boards, dual-channel columns + CSV ids, forecast risk strip, DQ tables + sample dialog
- `dev/mock-gviz.js` me REPORT ab 80 columns (CA = Commission Rate, CB = Earned Commission) aur REPORT ke
  current-month totals bhi fix (EIR ka agent-ID column J aur issue date AA se link hota hai)

## Commits
- `2b36747` — heading-name mapping, whitespace matching, wide-range fallback, one-click range fix, v3.7.0
- `153023b` — FF commission page: one-click fresh sync
- `605efe3` — showModal guard + shared sample dialog export + smoke test
