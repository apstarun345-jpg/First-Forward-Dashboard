# v3.37.0

## 🚨 Unusual Activity — card ka number = drawer ka data, aur option ab fast

Sawal tha (live site par latest data ke saath):

1. *"Unusual Activity ke KPI cards apna related data nahi dikhate — card click karne par drawer me
   wahi data aana chahiye."*
2. *"Option lag karta hai — fast karo."* (sabse bura lag: **card click → drawer khulna**)
3. *"Diagnose option improve karo"* — aur clarify kiya: **"Setting me diagnose button se sab fix."**

Teeno cheezein is release me hain. Neeche pehle **asli wajah** (root cause), phir fix.

---

### 🐞 Root cause — card par click do jagah jaata tha

Unusual Activity ke anomaly cards `<div class="kpi ua-kpi-card" data-ua-flag="double">…` hain.
`app.js` me ek **global** click handler hai jo `.kpi, [data-kpi]` par `FF.kpiDetail.open(card)`
chalata hai. Iska matlab ek hi click par **do drawer** khulte the:

| # | Handler | Kya karta tha |
|---|---|---|
| 1 | page ka apna (`data-ua-flag`) | sahi flag ka forensic drawer |
| 2 | global `FF.kpiDetail` | drawer ko spinner se **replace** karke card ke **title se inferred** spec kholta tha — period/flag dono ignore |

Aakhri jeet-ta tha, isliye drawer me **card se unrelated** data dikhta tha:

| Card | Card ka number (Sept, mock/live-shape data) | Purana drawer headline |
|---|---|---|
| ♊ Double / Duplicate VRN | **652 tags** | ❌ "Total Issued 2,947" (poore MTD ke saare tags) |
| 🔩 Excessive Chassis | **8 tags** | ❌ "Total Issued 41" |
| 🛡️ All flagged | 53 agents | (agents detail, MTD) |

Do drawer + poora `renderBody` (~91 KB innerHTML + `enhanceTables`) + `wireEvents()` click par
**dobara** chalte the — isi liye click "atka hua" lagta tha.

Wahi bug **Agent Summary** ke `30+d old stock` / `60+d critical` cards par bhi tha (`data-as-age`).

### ✅ Fix 1 — `data-kpi-self`: page ka card, page ka click

- `app.js` ka global handler ab `[data-kpi-self]` wale cards ko **skip** karta hai:
  `if (kpi && !e.target.closest('a,button:not(.kpi)') && !kpi.closest('[data-kpi-self]'))`.
- `unusual.js` ke saaton anomaly cards aur `agentSummary.js` ke dono age cards par
  `data-kpi-self="1"` hai → ek click = ek drawer = **usi card ka data**.
- `kpiDetail.js` ke header me ye convention document kar diya hai, taaki aage koi naya page
  apna card banaye to usse pata ho ki `data-kpi-self` lagana zaroori hai.

### ✅ Fix 2 — ek hi source of truth: `metricFor(model, flag)`

Pehle card `scopedRows` se banta tha, ledger/CSV/PDF `filteredRows` se, aur drawer ka headline
"Total Issued" tha — teen jagah teen number. Ab:

```
card value  ==  drawer headline  ==  drawer ki evidence rows  ==  CSV  ==  PDF
                          ↑
              sab metricFor(model, flag) se
```

| Flag | Card ka unit | Drawer me kya dikhta hai |
|---|---|---|
| 🛡️ All flagged | **agents** | wahi flagged agents ka ledger |
| 🚨 Multi-flag | **agents** | 2+ anomaly wale agents |
| ♊ Double VRN | **tags** | **tag-level duplicate register** (har duplicate tag ki row: date · tag ID · VRN · class · agent) |
| 🚫 Wrong VRN | **tags** | wrong + malformed VRN ki tag rows (problem type ke saath) |
| 🔁 Replacement | **tags** | replacement tag rows (type · status) |
| 🔩 Chassis | **tags** | chassis tag rows |
| ⚡ Spike | **peak-day tags** | peak date · peak day tags · own avg · spike × |

- Drawer ke sabse upar ek **✅ "Card = drawer" reconciliation chip** hai. Number match hone par ✅,
  aur kabhi farq ho (jaise kuch Wrong-VRN tags sirf daily EIR aggregate me count hote hain, ya
  evidence list cap hui ho) to **exact reason ke saath ⚠️** — chhupa hua farq nahi.
- Drawer me card ka number ek **hero tile** me bhi hai (`107 tags · This Month`), phir flag-specific
  evidence table, phir agent breakdown.
- **Card 0 bolta hai to drawer me 0 rows** — pehle khali selection ka matlab "poora index" ho jaata
  tha (0 card ke drawer me saare tags dikhne ka risk). Ye regression test me locked hai.

### ✅ Fix 3 — 🚀 speed: tag-level scan ab SERVER par

Pehle page khulte hi browser **25,000 rows/page** ke hisaab se EIR ko sequentially kheenchta tha
(20 pages tak) — first paint tak ruk jaata tha. Ab:

- **`unusual-scan.js` (naya, shared)** — ek hi isomorphic scan/index/evidence library jo **server aur
  browser dono** chalate hain (`globalThis.FFunusualScan` + `FF.unusualScan`). Duplicate logic do
  jagah nahi, isliye numbers kabhi drift nahi karte.
- **`GET /api/unusual/scan?from=&to=`** — server EIR + GV Master ko **parallel (×4)** padhta hai
  (25k rows/page, max 20 pages), compact index banata hai aur gzip karke deta hai. 10-min server
  cache + inflight-dedupe; `fresh=1` sirf admin ke liye. Auth: login zaroori, permission `unusual`
  (ya admin). Range ≤ 366 din.
- Index chhota rakha hai (short keys): per-agent counts + evidence lists. **Counts hamesha exact**,
  sirf **lists** cap hoti hain (dup groups 4000 · dup rows/bad/rep/cha 12000 · agents 8000) aur cap
  lagne par `meta.truncated` me saaf dikhta hai.
- Page ab **turant** daily aggregates se paint hota hai (~5 ms), tag scan background me aata hai aur
  cards ko exact tag numbers se update kar deta hai (tab tak card par `ua-kpi-pending` sweep chalti
  hai). `sessionStorage` me 30-min scan cache bhi hai (≤4 MB).
- Scan fail ho to purana **browser fallback** chal jaata hai (same shared lib) — page kabhi blank nahi.
- Badi tables **chunked** hain: ledger 60 rows, drawer 100 rows, "↓ Aur N dikhao" par 200 ke step me
  (drawer freeze nahi hota). Events ek hi baar **delegate** hote hain (har paint par re-wire nahi).

**Measured (mock gviz, Sept 2026, 3,950 tag rows):** page render + scan **99 ms** (paint 5 ms,
server scan 80 ms, cached 8 ms) — aur saaton cards ka number drawer se exact match.

| Check | Pehle | Ab |
|---|---|---|
| ♊ Double card → drawer | 652 tags → "Total Issued 2,947" ❌ | 652 tags → 652 tag rows ✅ |
| 🔩 Chassis card → drawer | 8 tags → "Total Issued 41" ❌ | 8 tags → 8 tag rows ✅ |
| Card click par drawer | 2 drawer, full re-render | 1 drawer, cached metric ✅ |
| First paint | 25k-row pages ka wait | instant (daily), scan background ✅ |
| 📄 PDF | `FF.lazy.loadScript` exist hi nahi karta tha → "PDF module load nahi hua" | `FF.lazy.ensure('unusual')` → PDF banta hai ✅ |

---

### 🩺 Diagnose — "Settings ke diagnose button se sab fix"

**Settings → 🩺 Site diagnostics** ab ek hi jagah se detect + fix karta hai:

- **🃏 KPI card click detector (naya, root-cause wala):** poore DOM me `.kpi, [data-kpi]` cards scan
  hote hain; jinke paas page ka apna handler (`data-ua-flag`, `data-as-age`) hai par
  `data-kpi-self` **nahi** — wo ⛔ High finding bante hain, poore explanation ke saath.
- **🛠 Fix = site-wide attribute repair.** Fix dabate hi card par `data-kpi-self="1"` lag jaata hai
  **aur** rule `localStorage ff_diag_attr_repairs` me save hota hai:
  - `app.js` use **boot par** aur **har page render ke baad** lagata hai (settings.js lazy load hota
    hai, isliye ye chhota hook eager side me hai),
  - settings.js ka MutationObserver re-render par dobara laga deta hai.
  Matlab reload/page-change ke baad fix gayab nahi hota. (Purane CSS repairs `ff_diag_repairs`
  jaise hi kaam karte hain; **Clear all repairs** dono saaf karta hai.)
- **🔬 Card ↔ drawer parity test:** ek button Unusual Activity kholta hai, **har KPI card ko asli me
  click** karta hai aur verify karta hai ki drawer ka title/value/unit card se milta hai. Mismatch
  ho to per-card ⛔ finding ban jaati hai. (Wahi check page ke 🩺 Diagnose me bhi hai.)
- **🐢 Page speed & DOM weight:** "🌐 Scan every page" ab har page ka **render ms · DOM nodes ·
  HTML KB** measure karta hai, table me dikhata hai, aur bhaari pages (2500 ms / 5000 nodes /
  400 KB se zyada) par finding banata hai — "site slow kyun hai" ka page-level jawab.
- **🗂 Data health:** store snapshot khali/purana, `/api/unusual/scan` error, adhoora scan
  (`meta.complete=false`), gviz **offset issue** (rows repeat), purana scan, aur 400 ms se upar ka
  page paint — sab findings me.
- **Findings control:** severity filter · category filter · **search** · grouping (category/page/
  severity) · **⬇ CSV · ⬇ JSON · 📋 Copy** (jo visible hai wahi export hota hai) · **🧾 scan history**
  (last 20 scans, counts ke saath).
- **⚡ Speed doctor (naya section):** teen prefs jo `ff_speed_prefs` me save hote hain aur boot par
  turant lagte hain —
  `🎞 Animations band (ff-no-anim)` · `🪶 Lite mode (ff-lite)` · `🚀 Unusual Activity: Fast scan mode`.

**Unusual Activity ke andar bhi 🩺 Diagnose hai** (page-level, drawer me):

- Tag-level scan health (source · rows · pages · kitne ms me · complete/capHit/offsetIssue · cache age),
- **har flag ka hisaab** — card ka number, kahan se aaya (daily aggregate vs tag scan), drawer rows,
  match ✅/⚠️,
- data quality (blank VRN, placeholder `000000`/`NA`, chassis exemption, duplicate VRN groups),
- **action buttons**: ↻ Deep scan (fresh) · 🔬 Card↔drawer probe · 🩺 Site diagnostics yahin chalao ·
  ⚡ Fast mode toggle · 📋 Copy report · ⬇ CSV,
- kisi agent ke row se khola jaye to us agent ka focus bhi report me aata hai.

---

### 🔢 Numbers ki sachai (semantics jo badle)

- **Duplicate detection** ab `n ≥ 2` wale VRN groups se hi count hota hai — pehle ek-baar wale VRN
  bhi `doubleVrn` me jud jaate the (card bada number bolta, register khali dikhta).
- VRN **normalize** hota hai (`RJ14AB 1234` = `RJ14AB1234` = `rj14ab1234`), aur **chassis / blank /
  chhote (<6) / placeholder** (`NA`, `NULL`, `NONE`, `UNKNOWN`, `UNAVAILABLE`, `TEST`, `XXXX`,
  `AAAA`, `000000`) VRN duplicate alarm nahi banate.
- **Wrong = union(wrong-type, malformed)** = `w + i − b` (`b` = jo tag dono hai) — ek hi tag do baar
  nahi gina jaata.
- Replacement/Chassis: daily aggregate aur tag-level scan me se **bada** number jeetta hai (GV live
  rows / FF T+1 lag ki wajah se aggregate peeche reh jaata hai), aur totals + peer% uske hisaab se
  recompute hote hain.
- Spike rule wahi: ek din ≥ 10 tags **aur** ≥ 3× apna average.

### 🧪 Tests / verification

- `dev/v337-unusual-parity.test.js` (naya, 10 tests): scan lib semantics (normalize, placeholder/
  chassis skip, `n ≥ 2`, `w+i−b` union, caps → counts exact + list truncated), **card = drawer parity
  invariant** har flag par, "card 0 → drawer 0 rows", bina index fallback, **`/api/unusual/scan`
  integration** (401 bina login · 400 bad range · 403 bina `unusual` permission · compact index +
  cache), `data-kpi-self` guard (app.js/unusual.js/agentSummary.js), lazy group order
  (`unusual-scan` → `pdf` → `unusual`), cache-busting `?v=60`, aur diagnostics v2 ka poora surface.
- `dev/smoke.js` me naya case: **unusual · card = drawer parity + server scan + diagnose** (asli
  server + mock gviz ke against render karke `probeCards` chalata hai).
- `npm test` → **340 pass / 0 fail** · `npm run check` → syntax ok (ab `unusual-scan.js` bhi).
- Purane `dev/unusual-paging.test.js` + `dev/v332-features.test.js` ke fixtures bilkul wahi numbers
  dete hain (regression safe).

### 📁 Files

| File | Kya |
|---|---|
| `unusual-scan.js` | **naya** — shared isomorphic scan/index/evidence lib (server + browser) |
| `server.js` | `GET /api/unusual/scan` + parallel EIR/GV Master scan, TTL cache, gzip, auth |
| `unusual.js` | page rewrite — instant paint + background scan, `metricFor`, chunked tables, 🩺 Diagnose, probe |
| `app.js` | global KPI handler `data-kpi-self` skip karta hai; boot par saved prefs/repairs |
| `agentSummary.js` | age cards par `data-kpi-self="1"` |
| `kpiDetail.js` | `data-kpi-self` convention documented |
| `settings.js` | 🩺 Diagnostics v2 — card-click detector, attribute repairs, parity probe, page speed/DOM weight, data health, filters/search/group, exports, history, ⚡ Speed doctor |
| `lazy.js` | `unusual: ['unusual-scan', 'pdf', 'unusual']` |
| `styles.css` | naye UI classes + `ff-no-anim` / `ff-lite` |
| `index.html`, `sw.js` | cache bust `?v=60`, SW cache `apnapayment-v68` |
| `package.json` | 3.37.0 (+ `unusual-scan.js` syntax check) |
