# ✨ v3.39.0 — 📦 Summary · Master Search · drawers me stock ab hamesha aata hai (spinner nahi atakta)

> Theme: **"Loading…" kabhi hamesha ke liye nahi.** Heavy StockDataa / stock-ageing query slow ya fail ho tab bhi
> Agent Summary, TL Summary, Master Search aur unke drawers jo data aa chuka hai wo turant dikhate hain — baaki
> data aate hi jud jaata hai, aur na aaye to saaf message + **↻ Retry**.

---

## 🐞 Kya bug tha (live site par)

Agent / TL Summary aur Master Search me **stock load hi nahi hota tha** (spinner ghoomta rehta) aur wahan se khulne
wale drawers (Stock in hand, stock ageing, kundli / "Poori report") me data nahi aata tha.

Production-scale mock par (1,500 agents · 120 TLs · EIR 1.7 lakh rows · StockDataa 1.74 lakh · Tag Assignment 59k)
reproduce karke **4 root causes** mile:

| # | Root cause | Asar |
| --- | --- | --- |
| **A** | Summary / drawers **stock-age index ka intezaar** karte the (`/api/stock-age`). Server ek hi **unpaged gviz query** se poora StockDataa + Tag Assignment padhta tha (3.6 s cold, event loop **1.7 s block**, RSS 60 → **417 MB**, chhote heap par **OOM**). Fail hui build **10 min cache** hoti thi, aur browser ke paas **koi deadline nahi** thi. | Summary ka spinner 40–60 s+ (ya hamesha), drawers me ageing khaali |
| **B** | v3.38 follow-up ka per-TL `quick()` **quadratic** tha: FF me `tlStockComposition` TL × rows (2.8 s), GV me har TL par poora issuance rollup dobara (**~15.6 s freeze**), `performance.agents()` har call par reconcile (1.6 s). | Agent / TL list "load ho rahi hai…" par atki, tab freeze |
| **C** | Master Search: `buildFull` ek **4.9 s** ka single task; `buildLight` **sab 8 datasets** ka intezaar karta; dropdown ka placeholder kabhi refresh nahi hota; jinki REPORT row nahi unka kundli **"REPORT load ho raha hai…" hamesha**. | Search me stock numbers nahi / kundli adhura |
| **D** | KPI **stock drawer** 3 datasets **ek ke baad ek** (sequential) await karta, bina deadline ke. | Drawer "Detail calculate ho rahi hai…" par atka |

---

## 🛠 Fix

### Server (`server.js`, `stock-age.js`)
* **Index ab page-by-page banta hai** — 25,000-row pages, 3 pages parallel (in-order process), har page ke baad event loop ko
  saans. `createStockAgeBuilder` (chunked) ≡ purana `buildStockAgeIndex` (wahi buckets, wahi numbers — test se locked).
  FF + GV **saath me**; GV rows FF ke baad jodte hain taaki ageing ka match same rahe.
* **Request latakti nahi:** `/api/stock-age` aur `/api/stock-age/tags` max `STOCK_AGE_WAIT_MS` (20 s) rukte hain, phir
  `{ ok: true, pending: true, retryAfterMs: 3000 }` — build peeche chalta rehta hai, browser poll karta hai.
* **Fail ka 10-min cache khatam:** fail / adhura index sirf `STOCK_AGE_ERROR_RETRY_MS` (30 s) baad khud dobara try hota
  hai. Beech ka page fail ho to **adhura FF kabhi serve nahi hota** — pichla accha data (har channel ka) bacha rehta hai
  aur response me `errors.ff / errors.gv` aata hai. Stale-while-revalidate (10-min TTL) waise hi.
* **Warm-up:** Render par boot ke 12 s baad index peeche se bana leta hai (`STOCK_AGE_WARM=0` se band).
* **`/api/health`** me `stockAge: { ready, building, ageSec, errors, lastError }`.
* **gviz proxy cache par memory cap:** `CACHE_MAX_MB` (default 64) — bytes par LRU; cap ke aadhe se bada akela body cache
  me jaata hi nahi.

### Browser
* **Summary (`agentSummary.js`)**: report **ageing ka intezaar nahi karta** (`age: false`) — stock in hand / issuance / charts
  turant, ageing background me aakar usi page me bhar jaati hai. Na aaye to "ban rahi hai" / "load nahi hui" +
  **Retry** ("Koi ageing nahi 🎉" ab sirf tab jab sach me 0 ho). Exports / Team Pack (ageing chahiye) ab **60 s** tak hi rukte hain.
  20 s ke baad spinner par hint + Retry; render / pick errors par `errorBox` + Retry.
* **`stockAge.js`**: server `pending` par poll, `compute(scope, { waitMs })` kabhi nahi latakta, `status()` export.
* **`kpiDetail.js`**: stock drawer ke datasets **parallel** + har ek par hard limit (30 s; optional "Tag type" 4 s) — jo na aaya
  uska notice + Retry, baaki drawer turant.
* **Master Search (`masterSearch.js`)**: slow dataset ke bina bhi index (6 s deadline), dataset aate hi index me jud kar
  dropdown **khud refresh**; barcode 6-gram index hata diya (1.2 s CPU + ~127 MB heap — seedha scan 2–18 ms); `buildFull` chunked.
* **Kundli / profile (`masterProfile.js`)**: 12 s par partial profile + baaki aate hi `onLate` se poora; FF / GV indexes
  (`tlStockComposition`, team / agent issuance rows) — **numbers bit-for-bit wahi**; GV `issuanceRows()` ek data-version par ek hi baar.
* **`gv.js`**: `inputsKey()` + memoized `latestDate()`. **`util.js`**: `U.within`, `U.breathe`. **`performance.js`**:
  `agents()` ka reconcile memoized.

---

## 📏 Measured (production-scale mock)

| | Pehle | Ab |
| --- | --- | --- |
| FF `loadPeople` (Agent / TL list) | 2.8 s | **0.69 s** |
| GV `loadPeople` (browser) | 15.6 s | **0.66 s** |
| `performance.agents()` | 1.6 s | **0.49 s** |
| GV profile equivalence harness | 4.3 s | **0.19 s** |
| Server stock-age build, event-loop block | 1.7 s | **0.15 – 0.46 s** |
| Server stock-age build, memory | 417 MB RSS, OOM @192 MB heap | **112 MB heap me bhi chalta hai** |
| Summary par stock (ageing 40 s slow ho tab bhi) | 57 s+ spinner | **~14 s** |
| Master Search: suggestions + stock | spinner | **~12 s** (cold, bada data) |
| GV TL drawer | khaali | **< 2 s** |

> ⚠️ Google Sheets / live Render site sandbox se reachable nahi the — isliye verify **production-scale mock** (`dev/mock-gviz.js` ka
> bada version, latency / fail rules ke saath) par hua. Merge ke baad Render par ek baar Summary / Master Search khol kar dekho.

---

## ⚙️ Naye (optional) env vars

| Env | Default | Kaam |
| --- | --- | --- |
| `STOCK_AGE_PAGE_ROWS` | `25000` | ek gviz page me rows |
| `STOCK_AGE_PAGE_WINDOW` | `3` (max 6) | ek saath kitne pages in-flight |
| `STOCK_AGE_WAIT_MS` | `20000` | request kitni der rukkar `pending` de |
| `STOCK_AGE_ERROR_RETRY_MS` | `30000` | fail / adhuri build ke baad dobara try |
| `STOCK_AGE_WARM` | Render par ON | boot par index pehle se banao (`0` = band) |
| `CACHE_MAX_MB` | `64` (min 8) | gviz proxy cache ki memory cap |

---

## 🩺 Verify

* `npm run check` — syntax ok
* `npm test` — **378 pass** (354 + **24 naye**):
  * `dev/v339-stock-age-server.test.js` (9) — chunked builder ≡ one-shot · real server paging (limit/offset) · upstream paging ignore kare to
    duplicate nahi · `pending` + health · GV fail → `errors.gv` · beech ka FF page fail → purana data bacha · pehli build fail → adhura FF discard ·
    bina `fresh=1` auto-retry · gviz cache cap
  * `dev/v339-summary-loading.test.js` (10) — `U.within` · stockAge poll / bounded `compute` · Summary `age:false` + ageing states ·
    KPI drawer notice · Master Search slow dataset · profile `buildSoon`
  * `dev/v339-profile-scale.test.js` (5) — awkward id / naam wale GV rows par EXACT totals (purane code par bhi wahi) · issuance memo ·
    `latestDate` memo · 120 TL × 1500 agent GV aur 300 TL × 3000 agent FF par time budget
* Cache bust: `?v=62`, service worker `apnapayment-v70`.
