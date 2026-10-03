# WHAT'S NEW — v3.44.0 · 🧾 GV REPORT sheet-first — TL ka "440" band, VC4 · VC20 · VC5+ aur TL ID-wise stock

## 🧾 Sheet-first rule (GV) — jo sheet me hai wahi final

- **GV REPORT = GV ka live performance sheet.** Ab har jagah uska number final hai; tag-ledger
  (EIR / GV Master) **sirf tab** chalta hai jab sheet ka wo cell **khaali** ho. Sheet ka asli
  **0 bhi 0** hi rehta hai (pehle `Math.max(sheet, ledger)` aur `|| 0` dono se 0 "blank" ban jaata tha).
- **User ne jo pakda:** TL **APS011919** ka last month app me **440** dikh raha tha, jabki GV REPORT
  sheet me **332** hai (uska stock **1054** = 657 VC4 + 397 commercial). Wajah:
  - `gvpages.overlayGvReportWithEir()` ledger (EIR) aur sheet ka `Math.max` le raha tha → 440 jeet gaya,
  - `masterProfile.applyExactGvAgentMonths()` bhi ledger se agent months overwrite kar raha tha,
  - 360 drawer ke **class-wise total** row me ledger ka jod (440) dikhta tha.
- Ab **GV Performance (Agents + TLs), Agent/TL 360 board, Master Search drawer, Agent/TL Summary** —
  sab me sheet ka hi number. Farq ho to drawer me saaf likha aata hai:
  `Last: sheet 332 vs tag ledger 440 (Δ +108)` — aur koi number chhupaya nahi jaata.
- TL-wise table me ab **TL ID** column bhi hai, aur `Last month` / `MTD` = **GV REPORT ka TL snapshot**
  (`TL Last Month Issued` / `TL Issuance In Current Month`); members ka jod chhote dim number me dikhta hai.

## 🎯 VC4 · VC20 · VC5+ — last month + current month + stock

- Naya **Class group** table (GV + FF, drawer + 360 board): rows **VC4 · VC20 · VC5+ · Total**,
  columns **last month · MTD · Stock** — har cell clickable (`&f=vc4|vc20|vc5p`), stock cell barcode tak.
- GV me **VC4 + NVC4 (commercial) sheet se**; **VC20 / VC5+ ka batwara** current month me sheet ke class
  columns (VC5…VC16) se, aur last month me tag-ledger ke mix se — `Source` line me likha rehta hai
  (`GV REPORT sheet (VC4 + NVC4) · VC20/VC5+ ka batwara tag-ledger mix se`). FF par poora table tag-ledger se.

## 🆔 TL ID-wise stock — drawer me sabse neeche, har line clickable

- Naya **🆔 TL ID-wise stock** section (Master Search drawer + Agent/TL 360 board):
  columns **Naam · Agent ID · TL ID · Stock VC4 · Stock Comm · Stock total**.
- Footer: **🧑‍💼 Agents ke paas** · **👤 TL ke paas (own)** · **= TL TOTAL · 🆔 &lt;TL ID&gt;** —
  own + agents = TL total (koi double count nahi).
- Har **row click** → us agent ka 360 board · har **stock cell click** → us ID ka stock
  (class → din → tag / barcode tak). Nav me naya chip **🆔 TL ID stock**.

## 🧪 Tests

- Naya **`dev/gv-sheet-truth.test.js` (5 tests)** — asli GV REPORT rows (TL APS011919 + uska 5-agent
  team) daal kar poori chain check karta hai: blank-vs-zero flags, `overlayGvReportWithEir`,
  TL totals (**332 / 27**), TL stock (**1054**), group bins (**311 · 11 · 10** last, **25 · 2 · 0** MTD),
  aur drawer/board ka TL-ID stock table (clickable drills ke saath).
- `dev/agent-board.test.js` me FF + GV parity assertions (group table + TL ID stock dono channel me).
- `npm test` **425 pass** · `npm run check` syntax ok · cache bust **v68 / v76**.
