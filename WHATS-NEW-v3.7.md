# v3.7.0 + v3.8.0 — Kya naya hai (Hinglish quick guide)

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

---

# v3.8.0 — Cockpit tools (payout, Agent 360, alerts, dispatch, TL scorecard)

> PR #20 me hi shamil hai — merge karte hi Render par live. Version `3.8.0` (`/api/health` me bhi dikhega).

## 1. 🧾 Payout-ready reconciliation (FF + GV, ek hi jagah)
FF Commission page par naya card: har agent ke liye **sheet ka earned**, **rate × tags** se bana
computed amount, aur **slab ke hisaab se expected** — teeno side-by-side, difference ke saath.
Status auto: `Ready` / `Review` / `Unresolved`, aur recommended figure ka source likha hota hai
(`REPORT earned` → `Rate × tags` → slab). Ek click me:
- **Payout CSV** / **Payout Excel** (4 sheets: FF Payout, GV Payout, Ready only, Review)
- **Copy for Google Sheets** (tab-separated, seedha paste)

GV ka payout GV Master ke commission column se banta hai; FF ka REPORT ke earned column se,
aur jahan rate hai wahan rate × tags se verify ho jata hai. Sheet me rate khaali chhoda to page
guess nahi karta — `Unresolved` flag lagta hai.

## 2. 👤 Agent 360 drawer
Jahan bhi agent ka naam dikhta hai (FF/GV commission, forecast urgent list, dual-channel tables,
GV class boards) wahan naam **link** ban gaya hai. Click karo → side drawer khulta hai jisme:
FF tags/commission, GV tags/commission, stock + class split, issuance trend (month-wise),
GV class vs median, data-quality findings, cross-channel match (double-mapped tags),
blockers (rate missing, zero commission, stock-out risk) aur **Notes & follow-ups**
(siidha notes save karo). Export: CSV, WhatsApp summary, copy link.

## 3. 🚨 Commission anomaly alerts
Commission page ke top par alert card — severity (`high` / `medium`) aur count ke saath. Rules:
- REPORT/sheet me commission heading hi nahi mil rahi (data source hi gayab)
- Rate missing par issuance maujood (commission ban hi nahi sakta)
- Earned 0 / blank par tags > 0
- Sheet ka earned vs `rate × tags` mismatch (default 5% ya ₹50 se zyada)
- Rate peer median se 25%+ alag (data-entry error pakadta hai)
- GV rate class median (VC4/VC20/VC5+) se 40%+ door
- GV me tags hain par commission 0
- Stock-out wale agents jinki commission risk me hai
Har alert me **Samples dekho** (dialog + CSV), **Alerts CSV**, aur **WhatsApp summary**.
Thresholds Settings → “🚨 Commission alerts & dispatch thresholds” me badal sakte ho
(outlier %, mismatch %, mismatch minimum ₹, alerts on/off). Alert na chahiye to simply off.

## 4. 🚚 Auto Dispatch Planner (naya page)
Forecast engine ke urgent agents se **box-wise dispatch plan** khud ban jata hai:
- Controls: horizon (7 / 15 / 30 din), growth %, safety din, box size, channel (FF / GV / dono), search
- KPI cards: kitne agents, total boxes, critical stock-out, buffer tags (rounding se extra), top need
- Har row me: priority, agent + TL, need (tags), boxes, dispatch tags, class split (VC4 / VC20 / VC5+), risk
- **Printable pick-list** (`🖨 PDF / Print`) — TL-wise slips, warehouse ke liye seedha print
- Exports: **Plan CSV**, **Plan Excel**, **WhatsApp text**, aur **📝 Log plan** (follow-up ban jata hai)

## 5. 🏅 TL Scorecard (naya page)
Har TL ka weighted score: target achievement 30 · active agents 20 · commission completeness 20 ·
stock coverage 15 · data quality 15 (jo component available nahi woh weight se hat jaata hai, score bina
gadbad ke normalise hota hai). Grade `A+ → D`, rank, top-3 medals, **Focus needed** (kamzor component
kyun hai woh likha hota hai), aur `Comm. %` column. Exports: **TL Excel**, **CSV**, **WhatsApp summary**.

## Chhote sudhaar (baki bhi dekh liya)
- Settings me naye thresholds + “kholo” shortcuts; server values ko safe range me clamp karta hai
- Sidebar me dono naye pages apni permissions ke saath (role-wise on/off ho sakte hain)
- Print ke liye alag CSS — dispatch slips par page break sahi aata hai
- `dev/inspect.js` (naya dev tool) se har page headless verify hota hai; smoke me paanchon features cover
- Version `3.8.0`, service-worker cache `apnapayment-v29`

## Baby steps (kya kaise check karein)
1. Merge PR #20 → Render deploy (1–2 min).
2. `/#/ffCommission` → neeche **Payout reconciliation** aur upar **Commission alerts**.
3. Kisi bhi agent ke naam par click → **Agent 360** drawer.
4. `/#/dispatchPlan` → horizon/box size badal ke → **Print** (slip) ya **Excel**.
5. `/#/tlScorecard` → grade + focus list.
6. Settings → 🚨 section me thresholds badal ke Save; alert count turant badal jayega.
