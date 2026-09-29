# What's new — v3.11.0 (Master Search + Wow Zone 2.0)

Purani v3.10 (Arena · Fame · War Room) ke upar ye release **search, live view aur visual features** laata hai.

---

## 1. 🔎 Master Search — poori site par ek search bar

**Topbar me hamesha dikhne wali search bar** (har page par) + **Home panel me bada master search bar**.

Type karte hi dropdown suggestions aate hain — aur suggestion box **input ke neeche** khulta hai, kabhi typed
text ke upar overlap nahi karta (body-portal + viewport-aware placement, neeche jagah na ho to upar flip).

**Kya search hota hai (dono channels ek saath):**

| Kya | Example |
|---|---|
| Agent naam | `Ravi Kumar`, `ravi` |
| TL naam | `Komal Singh` |
| Agent ID | `R101`, `5845036` |
| TL ID / Supervisor ID | `TLGV`, `2045` |
| GV unique ID / GV naam | `GVU-1`, `ApnaPayment` |
| Barcode / serial | `34161FA82032001` |
| Tag ID | `TG1`, `BC1021` |

**Do-layer index (fast rehta hai):**

1. **Light (instant)** — EIR agent-month, StockDataa agent rows, GV Master, GV REPORT, Tag Assignment aggregates
   → naam · TL · IDs. Type karte hi suggestions.
2. **Heavy (background)** — FF StockDataa + GV Tag Assignment ke barcode-level rows
   (`FF.insights.loadDetails()`, wahi cache jo Master Stock page use karta hai) → barcode / tag ID / serial.
   Load hone par suggestions apne aap upgrade ho jaate hain.

**Search karne par "poori kundli" khulti hai** (colourful panel, `Ctrl+K` palette se bhi `🔎` items):

- 🏷️ **Tags / barcodes table** — barcode · tag ID · FF holder · FF TL · GV holder · GV TL · GV unique · class ·
  status (Matched / Owner mismatch / GV only / FF only / normal ghost flow) · allocation date
- 🧑‍💼 **Agent & TL kundli cards** — avatar, ID, TL, tags/barcodes count, class pills, last allocation,
  aur seedhe **Agent 360** / **Master Stock register** buttons
- 🆔 **ID matches table**
- ⬇ CSV export (tags + people + IDs ek file me)

Home panel me: type karte hi inline results (debounce), `Try:` chips, aur `🔎 Kholo` se poora panel.

---

## 2. 🧭 Executive Cockpit — combined field stock FIX

**Problem:** StockDataa me GV ka parked stock sirf `agentId = 5845036` wali rows me nahi hota. Kai rows me ID
blank hoti hai aur holder `APNA PAYEMENT` / TL `ApnaPayment Pvt. Ltd.` hota hai — wo rows FF me ginti thi,
isliye **combined field stock** zyada (double count) aa raha tha.

**Fix (v3.11):** ek row **teen signals** me se kisi se bhi match kare to GV-parked maani jaati hai aur FF se
exclude hoti hai —

1. GV master ID (`Settings → Data source → GV Partner → master ID`, default `5845036`)
2. holder naam `Apna Payment…`
3. GV channel TL naam (`ApnaPayment Pvt. Ltd.`)

KPI foot ab yeh detail dikhata hai: `FF <x> (GV-parked <y> tags excluded · <holders>) + GV <z> · GV rows alag register se`.
Wahi rule **Stock Forecasting** ke FF demand/stock me bhi lagta hai (Apna Payment pseudo-agent FF list se hata).

---

## 3. 🔴 War Room — ab detailed

Pehle sirf counters + race the. Ab:

- **📊 Aaj ka detailed breakdown** — Issuance · 🔁 Replacement · 🚗 VC4 tags · 🚚 VC20 tags · 🚛 VC5+ tags ·
  🔧 Chassis · 🧩 Wrong VRN · 🧑‍💼 Active agents (aur VC4 share %, wrong-VRN %)
- **🗓️ Month-to-date detail** — VC4 · VC20 · VC5+ · Replacement · Chassis · Wrong VRN + commercial total,
  projection aur `day N/N`
- **👥 TL-wise aaj ka detail** — FF · GV · VC4 · Commercial · Replacement · Chassis · Total
- Footer me **exact render timestamp (HH:MM:SS)** + FF/GV sheet load times

---

## 4. 👁 Live view — exact instant telemetry

- **Freshness dot** — `exact HH:MM:SS.mmm · 0.8s pehle` (green ≤2.5s · amber ≤15s · grey stale), 250ms par tick
- **⚡ Speed selector** — 0.5s (instant) / 1s / 2s / 5s polling
- **Live data clock** panel — FF sheet load · GV sheet load · aaj ke FF/GV/total tags (exact ms)
- Har event (click / page / search / KPI / tab) ke saath **ms-level timestamp** + "kitna pehle"

---

## 5. 🎉 Wow Zone 2.0 (4 naye pages)

| Page | Kya |
|---|---|
| 📅 **Activity Calendar** | Poore saal ka GitHub-style heatmap (FF / GV / combined toggle, year switch), level-4 depth, aaj ka outline; **total · active days · best day · current streak · longest streak · quiet days** cards; month-wise + weekday bars; **sparkline board** |
| 🕸️ **Team Network** | TL centre me, agents orbit karte hue — animated SVG (links draw hote hain), node size = tags, colour = channel (FF/GV), hover tip, TL click → performance, agent click → Agent 360; TL-wise strength bars |
| 🚨 **Anomaly Radar** | Rule engine: spike (3×+) · crash (50%+ drop) · naya dhamaka · personal best · wrong-VRN burst · chassis burst · GV high-priority zero VC4 stock · stale sheet (2+ din) · weekly pace break — severity cards + samples + CSV |
| 🧾 **Agent Report Cards** | School report-card style monthly card: Agent · TL · month, tags/growth/VC4/commercial/stock, **8 subjects** (issuance vs target, VC4 share, commercial mix, growth, consistency, quality, replacement, stock cover) with grades A+…E, **auto-generated teacher remarks**, TL sign block · 🖨 print/PDF · 📷 PNG · ⬇ CSV |

Sabhi naye pages **Settings → 🎛 Features** se on/off ho sakte hain
(`masterSearch`, `tabHeartbeat`, `themePacks`, `heatmap`, `networkGraph`, `sparklines`, `reportCards`,
`anomalyRadar`, `chatCharts`, `levelUp`, `memoryLane`) aur Access matrix me per-user permissions
(`activity`, `network`, `radar`, `reportCards`) ke saath aate hain.

---

## 6. ✨ Chhoti-moti wows

- **📈 KPI sparklines** — Dashboard ke KPI cards ke andar mini trend chart (latest day series, MTD cumulative,
  monthly VC4 / commercial / avg-per-day / replacement).
- **🟢 Live tab heartbeat** — browser tab title live: `🟢 234 tags today · <top agent> · MTD 4,120 · Dashboard`
  (tab hidden ho to polling 4× slow — battery friendly).
- **🎨 Theme packs** — topbar 🎨: Default · 🌃 Neon · 🧊 Glass · 🪔 Diwali festive (diyas + golden glow) · 🥇 Gold · 🖤 Mono.
  Choice localStorage me save hoti hai; charts dobara mount hote hain.
- **🎖️ Level-Up Ceremony** — Agent Arena me promotion detect hone par fullscreen golden ceremony + trumpet +
  confetti (ek baar per level; banner se dobara dekh sakte ho).
- **📅 Aaj ka din** — Home par memories: pichhle mahine/saal ki isi din ki activity, is mahine ka best day,
  pichhle hafte ka same weekday.
- **💬 Chat me charts** — assistant se ("last 7 days ka graph", "monthly trend", "VC4 vs commercial",
  "GV vs FF") pucho → jawab ke saath **chat me hi chart** mount ho jaata hai (trend page par jane ki zaroorat nahi).

---

## 7. Testing

- `npm test` → **121 tests** (13 naye: master search light/heavy index + suggestions, sparkline, heatmap,
  network graph, anomaly rules, report card grades/remarks, theme packs, heartbeat, chat charts, page registry,
  GV-parked exclusion)
- `npm run smoke` → sab pages + **7 naye checks**: War Room detail, Activity Calendar, Team Network, Anomaly Radar,
  Agent Report Cards, Master search (index + suggestions + results markup), topbar bar mount,
  aur executive combined stock ka **naam/TL-based exclusion** assertion.

---

## Upgrade notes

- Naye files: `masterSearch.js`, `wowzone.js` (index.html me `?v=33` ke saath add kiye gaye; `sw.js` cache `v37`).
- Feature flags default **ON** hain; admin Settings → 🎛 Features se band kar sakta hai.
- Access matrix me naye pages default non-admin users ko bhi diye gaye hain — chahо to Settings → Access se hata do.
