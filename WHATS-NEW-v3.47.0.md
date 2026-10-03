# WHAT'S NEW — v3.47.0 · 🟩 GV Master sach (column R) + ⚡ GV aaj live + 🏠 Home KPI text

## 1) 🟩 GV Master — TL ID ka sahi column (asli data bug)

GV Master me **do** TL ID columns hote hain: **C = SUPERVISOR_AGENT_ID** (report/purana crosswalk ID) aur
**R = GV TL ID** (live unique ID). Pehle code `tlId = supervisorId || gvTlId` leta tha, isliye:

- jab C aur R alag hote the → TL ke saare numbers **galat TL** ke under ya **0** dikhte the,
- Master Search me TL ka naam/stock/issuance match hi nahi hota tha.

Ab:

- `tlId = gvTlId || supervisorId` (**R canonical**), C sirf crosswalk/audit ke liye (us par bhi lookup chalta hai).
- `masterTlIdentity()` aur `masterIssuanceRow()` bhi R-first — legacy rows (R khaali) me C fallback.
- **GV agent months ka rule**: naam (normalised) **YA exact id (case-sensitive)** — `g001` vs `G001` jaise
  case farq par doosre agent ki rows nahi judti (pehle jud jaati thi → number inflated).
- `masterProfile.gvCanonicalIssuanceRows()`: **EIR-authoritative `issuanceRows()`** pehle (GV Master khaali/adhoora
  hone par bhi TL team + agent totals sahi), `masterRows()` sirf legacy adapters ke liye. `rows()`-only
  compatibility snapshot se exact month totals **nahi** bante — GV REPORT ke bhare hue numbers 0 nahi hote.

## 2) ⚡ GV ka "aaj" live — `toDate()` retry fix

- Sheet me date column **text** me ho (jaise `03-10-2026`) to pehli plain-date query `successful-but-empty` aata hai.
  Ab `serverDateFromCell` live-query block ke andar hai, isliye **`toDate()` retry** hamesha chalta hai aur
  GV aaj ka number 0 nahi rehta.
- `resolveGvServerColumns`: configured letter pehle **header se verify** hota hai, warna header probe ka column
  (column shift / galat mapping safe), fallback chain `cfg.date || pick('date') || default`.
- Home ka GV card + `/api/today` (45s cache) → aaj Total · VC4 · VC20 · VC5+ · Replacement · Chassis ·
  Expected Today (pichhle 4 same-weekday ka average) — aur har card click par tag-level rows.

## 3) 🏠 Home KPI cards — `paintMonth is not defined` crash fix 🐞

Main branch (PR #72 ke merge ke baad) me `home.js` ke andar **`paintMonth()` / `paintCharts()` / `paintAll()`
sirf CALL hote the, define nahi the** → Home page render hote hi:

```
ReferenceError: paintMonth is not defined   (home.js:431)
```

…aur **poore mahine ke KPI cards + charts gayab** ho jaate the. Yehi asli wajah thi ki Home par
"KPI cards me text/numbers nahi dikh rahe" lag raha tha (stylesheet ke saath-saath yeh runtime crash).
Ab teenon definitions wapas add hain (monthMount/chartMount + `ui.sf` / `ui.ctx` / `ui.sc` / `ui.liveToday` par).

## 3b) 🏠 Home KPI cards me text dikhna

- `homeKpiFix.css` ab `index.html` me load hota hai aur service worker me precache hota hai
  (`.page-home .kpi` ke title/value/foot/icon par z-index + white text force) — white text colored card
  par gayab nahi hota.
- **`CACHE_NAME = 'apnapayment-v80'`** aur saare assets **`?v=72`** — purane cached PWA shell wale users ko
  naya CSS/JS + nayi Home milti hai (yehi wajah thi ki "text nahi dikh raha / purane cards" jaise lagta tha).

## 4) 🚛 All Commercial KPI (VC20 + VC5+)

Home ke **Is mahine ke KPI cards** grid me:

- **All Commercial · VC20 + VC5+** = current MTD ka commercial total,
  foot me: **last month (same din tak) + % ▲▼**, **Last month full**, aur **Expected this month**
  (commercial run-rate × mahine ke din).
- Cards: Last day · Current month MTD · VC4 · VC20 · VC5+ · **All Commercial** · Replacement · Chassis ·
  Expected in month — har card par FF/GV split + click → kis agent/TL ne lagaye.

## 5) 🔎 Master Search — agent / TL dono

- **Agent** search → uski poori details (KPI, class-wise, stock, TL, mobile, priority, drill) + linked TL ka team
  stock/issuance.
- **TL** search → TL khud ka **issuance + stock (own)**, aur uske **saare agents ka stock + issuance**
  (own + agents split chips, har number clickable → class → din → tag/barcode row).
- GV me ye sab **GV Master column R** ke usi tag-set se aata hai — headline, click-detail aur sheet cross-check
  teeno same source par (v3.47 test: 332 / 28 ka reconciliation).

## 6) 🧪 Verify (merged state, main ke saath)

- `npm test` → **451 / 451 pass** · `origin/main` par wahi suite **440/451 (11 fail)** thi
  (GV Master truth, column-R attribution, EIR month totals, toDate retry, TL profile exact, issuanceRows
  memo, 120×1500 perf) — ye sab is branch me green hain.
- **jsdom smoke** (`node dev/smoke.js`): `origin/main` ke client files = **10 FAILED**
  (Home `paintMonth` crash + KPI cards ke 3 tests); is branch par = **7 FAILED**, aur wo 7
  bilkul wahi hain jo is kaam se pehle bhi the (stash-baseline se byte-identical proven) — matlab
  **koi naya toota nahi**.
- Live proof (mock gviz): `/api/gv-today` → `GV Master · live`, aaj **34** (VC4 17 · VC20 2 · VC5+ 15,
  Replacement 7 · Chassis 6) aur `/api/today` me bhi wahi + FF EIR **T+1** (`throughYesterday: true`).
- `npm run check` → syntax ok.
