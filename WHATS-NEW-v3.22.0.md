# ✨ v3.22.0 — GV aaj = GV Master sheet · FF aaj = EIR · sab kuch halka & fast · barcode dashed · aakhri tak data

Is release me wahi cheezein theek ki gayi hain jo aapne batayi thi.

---

## 1) 🟩 "Aaj ka live" GV ab **GV Master sheet** se (EIR se nahi)

Pehle GV ka aaj ka number EIR se aa raha tha (jo late/partial hota hai). Ab niyam saaf hai:

| Channel | Aaj ka issuance kis sheet se | Note |
| --- | --- | --- |
| 🟩 **GV Partner** | **GV Master** tab (GV sheet) — live | `gv.js → masterTodayRows() / gvToday()` |
| 🟦 **First Forward** | **EIR** (FF sheet) | T+1: aaj ka FF kal confirm hota hai |

- Ye **replace** hai, add nahi — ek hi tag dobara nahi ginta (`liveDailyRows()`).
- Aaj ka GV number **Home**, `/api/today` feed, GV pages, Tag Issued, sprints, Trends aur KPI drawer —
  sab jagah GV Master se aata hai.
- Kal se pichhle dinon ke liye **EIR hi ledger** rehta hai (jaisa tha).
- FF ka live EIR count ab Home par note me dikhta hai: *"T+1 — kal aayega · EIR me abhi N rows"*.

## 2) 🏷️ Barcode ab **dash ke saath** — `608116-011-0558601`

- Naya `util.barcode()`: `6081160110558601`, `608116-011-0558601`, `6081160110558601.0`, aur numeric
  cell — **sab ka same dashed format**. Alphanumeric tag ID ("BC1234") waisa hi rehta hai.
- Sab jagah apply: KPI drawer ka tag-level table + tag detail, **Master Search** (suggestion, tags table,
  CSV), cross-channel/double-mapped tables, GV raw export, aur **har table jiska header** `barcode/serial`
  ho — `app.js → polishBarcodes()` automatically format kar deta hai (naya column/table add karo, apne
  aap dash format aa jayega).
- Search bina dash bhi chalti hai (`barcodeKey()` dash/space hata deta hai).
- Bonus fix: sheet me barcode agar **number** format me ho (display `6.08E+15`) to ab poori 16 digits
  aati hain — pehle digits hi gum ho jaate the.

## 3) ⚡ Site **halki aur superfast** — asli karan bhi documented

`SPEED.md` dekh lo (exact karan + steps). Short me:

| Kyun slow tha | Ab |
| --- | --- |
| Login par **16 gviz queries** ek saath (StockDataa/EIR full scan) → aapki zaroori query queue me peeche | 3 workers + priority `daily`, aur pehla paint **`/api/today`** (chhoti grouped query, server par 45s cache) se |
| Har **5 minute** me wahi 16 queries **fresh** (poora din network bhara) | har 15 min, sirf **3 halki queries** (`lightSync`), 2G/data-saver par band |
| **47 scripts ~2.4 MB** JS ek saath | **lazy.js**: sirf core + page kholne par us page ka module (insights 336 KB, settings 204 KB, gvpages 104 KB… ab on-demand) |
| Har visit par poora `index.html` dobara | **ETag → 304 (0 byte)**, gviz par bhi ETag |
| Purana SW precache 43 files | `apnapayment-v51` — sirf core precache, `?v=45` bump |

Naya diagnostic: **Settings → 🩺 Site diagnostics → ⚡ Speed card** (slowest queries avg/max ms, cache hit
rate, warm queries) + admin API **`/api/perf`**.

## 4) 📄 Drill-down ka **aakhri level = sheet ki asli rows**

Kisi bhi KPI/option par click → breakdown → **"📄 Poora data"** → **Load all rows**:

- **GV rows** ab **GV Master tab** se aate hain (serial/barcode, amount, commission, status ke saath).
- **FF rows** EIR tab se (T+1 lag-aware).
- **Stock drawers** me naya **"📄 StockDataa / Tag Assignment rows load karo"** — seedha us sheet tab ki
  tag-level list, barcode dashed format me, search + Excel/CSV ke saath.
- Tag detail (row click) me barcode + GV amount/commission bhi.

## 5) 🧪 Tests aur roll-back

- Naya test file `dev/speed-today.test.js` (8 tests): barcode format, GV Master-today niyam, lazy rollup
  coverage, `/api/today` + `/api/perf` + ETag, light auto-sync. Total suite: **227 tests**.
- `npm run check` (sab JS syntax) + `npm test` + `npm run dev:mock` + `npm run smoke` chalao.
- Wapas purana behaviour chahiye (GV aaj EIR se): `gv.js → issuanceRows()` / `liveDailyRows()` me
  `masterTodayRows()` splice hata do — sirf wahi ek jagah hai.
