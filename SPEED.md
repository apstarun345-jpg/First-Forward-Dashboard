# ⚡ SPEED.md — site slow kyun lagti thi, aur ab kya dhyan rakhna hai

Ye file **exact karan** (root cause) + **exact steps** deti hai — generic advice nahi.
Aapke setup ka ek hi data source hai: **Google Sheets (gviz)**. Isliye site ki speed 3 cheezon se
bandhi hai: (1) kitne queries Google par ja rahi hain, (2) ek query me kitni rows/columns scan ho rahi
hain, (3) browser kitna JS download kar raha hai.

---

## 1) SABSE BADA KARAN — login par 16 queries + har 5 minute me wahi 16 queries dobara

Pehle:

| Kya hota tha | Kitna load |
| --- | --- |
| Login par **9 FF datasets + 7 GV datasets** ek saath | 16 gviz queries, jisme StockDataa (5,000+ rows) aur EIR (7,000+ rows) full scan |
| Har **5 minute** me background auto-sync `preloadAll(true)` | wahi 16 queries **fresh** dobara — StockDataa + EIR + REPORT poora |
| Tab warming | jo queries user ko chahiye thi, wo background scans ke peeche ruk jaati thi |

Google Sheets **ek spreadsheet ke andar queries serialise** karta hai. Isliye 16 queries ek saath bhejne
par aapki asli query (jo Home ke liye chahiye) **queue ke aakhir me** chali jaati thi → screen "hang".
5-minute refresh ke chalte ye loop din bhar chalta rehta tha.

**Ab kya hai:**

- `/api/today` — ek **chhoti grouped query** (GV Master tab + EIR tab se sirf aaj ka count) → Home ka pehla
  paint isse hota hai (server par 45s cached, 47 ms me jawab).
- Startup queries **3 workers** ki queue me (pehle `daily`, `report`, phir baaki) — critical query pehle.
- Auto-sync **15 minute**, aur `FF.preloader.lightSync()` se **sirf 3 halki queries** (daily + GV master +
  aaj ka feed). 2G / data-saver par auto-sync band.
- Page ke modules **lazy** — pehla load ~2.4 MB JS ki jagah sirf core.

## 2) Browser ka payload (JS) — 47 files → core + on-demand

Pehle index.html 47 scripts (~2.4 MB JS) ek saath load karta tha. Sabse bhaari: `insights.js` 336 KB,
`settings.js` 204 KB, `gvpages.js` 104 KB, `cockpit.js` 84 KB, `wowzone.js` 68 KB, `dispatchPlanner.js` 64 KB.

**Ab:** `index.html` me sirf **eager core** (shell + Home + Master search + KPI drawer) hai, aur baaki
modules `lazy.js` se **us page ko kholne par** load hote hain. Login ke baad idle me background warm hota
hai, isliye normal navigation me rukavat mehsoos nahi hoti.

> ⚠️ Naya module banate waqt: `index.html` me mat add karo. `lazy.js` ke `GROUPS` me page id ke saath naam
> daalo. Agar module page ke load par hi chahiye (jaise `home.js`), tabhi eager core me daalo.

## 3) Repeat load: cache version + ETag

- JS/CSS par `?v=45` → 1 saal immutable. **JS badalne par `?v=` bump karo** (`index.html` + `sw.js`
  ASSETS + `lazy.js` version — lazy loader apna version `config.js?v=` se padhta hai).
- `index.html` / manifest `no-cache` the, isliye har visit par poora HTML dobara aata tha → ab **ETag**
  hai aur server **304 (0 byte)** bhejta hai. Same gviz response par bhi ETag lagta hai.
- Service worker `apnapayment-v51`: sirf core precache hota hai (2 MB extra install download nahi).

## 4) Sheet ki taraf ke karan (agar phir bhi slow lage)

Ye cheezein **Google Sheets par har query** ko slow karti hain — inhe hi "option add karne ke baad site
slow ho gayi" ke roop me dekha jaata hai:

1. **Volatile formulas** — `NOW()`, `TODAY()`, `RAND()`, `RANDBETWEEN()`, `INDIRECT()`, `OFFSET()`,
   `IMPORTRANGE()` jo app wale tabs (EIR / StockDataa / GV Master / Tag Assignment / REPORT) me hain.
   Google in tabs ko **har query par dobara calculate** karta hai → seconds. Inhe alag "Calc" tab me rakho
   aur sirf values paste karo.
2. **Full-column array formulas** (`A:A`, `A2:A`, `ARRAYFORMULA` poore column par) — scan badh jaata hai.
3. **Naya column beech me add karna** — app column **letter** se padhti hai (`config.js` → `eir`, `stock`,
   `gv.master`, `gv.assignment`). Beech me column daala to mapping shift ho jaati hai → galat data + extra
   bade scans. **Fix:** Settings → 🗂️ Sheets & tabs me us tab ka mapping/range dobara set karo (ya column
   letters `config.js` me update karo).
4. **Naya tab / rename** — Settings → Sheets & tabs me tab name aur range update karo; tab ka **fixed range**
   (`A1:CZ` jaisa) do, taaki app poori sheet scan na kare.
5. **Sheet public na ho** ("Anyone with the link → Viewer") — tab har query fail hoti hai aur retry loop
   lagta hai. `/api/health` aur Settings → 🔌 Data source se check karo.
6. **Conditional formatting / 50k+ rows** — sirf zaroori columns wala tab rakho; purani rows archive tab me
   move karo.

## 5) Exact check kaise karein (koi guess nahi)

- **Settings → 🩺 Site diagnostics → ⚡ Speed** card: slowest Google queries (avg ms / max ms), cache hit
  rate, kitni queries warm hain. **Sabse upar wali row = sabse slow query = asli bottleneck.**
- **`GET /api/perf`** (admin login) → raw JSON: `slowest[]`, `queries[]`, `cacheEntries`, `cacheSeconds`.
- **`GET /api/health`** → `cacheSeconds`, `cached`, `storage`.
- Server env **`CACHE_SECONDS`** (default 600): badhao → Google par kam load, data thoda purana;
  ghatao → fresh, par slow. 300–900 ke beech rakho (Render blueprint me 600 set hai).

## 5.5) 🚨 Unusual Activity ka tag-level scan — browser se server par (v3.37)

**Pehle:** page khulte hi browser EIR ko **25,000 rows/page** ke hisaab se **sequentially** kheenchta tha
(20 pages tak = 5 lakh rows) aur poora tag-level scan browser me chalta tha. First paint tak ruk jaata tha,
aur har period change par wahi dobara. Isi liye "option lag karta hai" sabse zyada yahan dikhta tha.

**Ab:**

- **`GET /api/unusual/scan?from=&to=`** — server EIR + GV Master ko **parallel ×4** padhta hai
  (`UA_PAGE=25000`, `UA_MAX_PAGES=20`, `UPSTREAM_TIMEOUT_MS=45s`), compact index banata hai aur
  **gzip** karke deta hai. Server par **10-min TTL cache + inflight dedupe**; `fresh=1` sirf admin.
  Auth: login + permission `unusual`. Range ≤ 366 din (warna 400). Fail hone par `200 {ok:false,error}`
  → browser apna **fallback paging scan** chala leta hai (page kabhi blank nahi).
- **`unusual-scan.js`** — ek hi **shared/isomorphic** scan-index-evidence lib (server + browser). Logic do
  jagah nahi, isliye server aur browser fallback ke numbers **kabhi drift nahi karte**.
- **Page turant paint** hota hai daily aggregates se (~5 ms), tag scan **background** me aata hai aur cards
  ko exact tag numbers se update kar deta hai. `sessionStorage` me **30-min scan cache** (≤4 MB) bhi hai.
- Index me **counts hamesha exact**, sirf evidence **lists** cap hoti hain (dup groups 4000 · dup rows /
  bad / rep / cha 12000 · agents 8000) aur cap lagne par `meta.truncated` me saaf dikhta hai.
- Badi tables **chunked** hain: ledger 60 rows · drawer 100 rows · "↓ Aur N dikhao" 200/step. Events
  **ek hi baar delegate** hote hain (har paint par `wireEvents()` dobara nahi) — click → drawer isi se fast hua.

**Measured** (mock gviz, Sept 2026 = 3,950 tag rows): page render + scan **99 ms** (paint 5 ms · server scan
80 ms · cached scan **8 ms**). Endpoint ka JSON ~124 KB (gzip ke baad bahut chhota).

> ⚠️ Naya page banate waqt yahi pattern use karo: **bhaari sheet scan server par**, browser ko **compact index**
> do, page ko **pehle available data se paint** karo aur scan background me merge karo.

## 6) Numbers jo is release me badle

| Cheez | Pehle | Ab |
| --- | --- | --- |
| Login par JS | ~2.4 MB (47 files) | core only + page par on-demand |
| Pehla paint (Home) | sab datasets ka intezaar | `/api/today` chhoti query se turant |
| Auto-refresh | har 5 min × 16 queries | har 15 min × 3 queries (+ 2G par band) |
| Repeat visit | poora HTML dobara | ETag → **304, 0 byte** |
| Startup query order | 16 parallel | 3 workers, priority `daily` pehle |
| Unusual Activity tag scan (v3.37) | browser me 25k-row pages **sequentially**, first paint blocked | **server** par parallel ×4 + 10-min cache; page **instant** paint, scan background (~99 ms total) |
| Card click → drawer (v3.37) | 2 drawer + poora `renderBody` (~91 KB) + `wireEvents()` | 1 drawer (page-owned, `data-kpi-self`), cached metric, chunked tables |
