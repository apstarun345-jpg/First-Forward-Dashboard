# v3.52.0 — 🔍 Master Search boxes + suggestions + 📅 VC4·VC20·VC5+ trend + 📲 employee link ke boxes

Aapki 5 baatein (Master Search + Tag Request employee link), har ek ka **problem → wajah → ab kya hota hai**.

---

## 0. 🧩 Asli wajah (root cause) — ek hi bug teen jagah dikh raha tha

**Problem:** Master Search me agent search karo to FF wale boxes me **stock 0, priority —, suggested 0,
"REPORT me row nahi mili"**. Employee link par bhi FF agent ka stock/issuance adhoora.

**Wajah:** FF ka stock · priority · suggested dispatch **`performance.js`** (FF REPORT sheet ka reader)
se aata hai — aur ye module **lazy** hai: sirf *Performance* page kholne par load hota tha. Master
Search / Tag Request / public form par wo load hi nahi hota tha → `FF.pages.performance` undefined →
profile khaali.

**Ab:**
- `lazy.js` → `PROFILE_DEPS` me `agentBoard` + `performance`; `tagRequest` group me `performance`;
  login ke baad warm list me bhi.
- `masterProfile.js` → `ensurePerfModule()` — profile banane se pehle module khud laata hai (self-heal).
- `tagRequest.js` → `buildIndex()` bhi index se pehle `FF.lazy.need('performance')`.

Verified (mock data): AMIT KUMAR (FF agent) — pehle `perf:false`, stock 0 → ab **stock 44 (VC4 19 ·
Comm 25), TL stock 688, priority High, cover 58.7 din, Sug VC4 0/8, Sug Comm 0/4, MTD 3, last month 16**.

## 1. 🔍 Master Search — type karte hi suggestions

**Problem:** word type karo to kuch suggest nahi hota tha; sirf Enter par search.

**Ab:** `#msp-q` par `U.suggest` dropdown — 2 akshar se hi **agent / TL / barcode** ke suggestions
(naam + ID + TL + channel + stock), ↑↓ Enter se chuno, click → seedha profile. Index ready hote hi
list refresh. Enter ab bhi kaam karta hai.

## 2. 📦 Master Search — upar ke boxes me poora data (stock · issuance · priority · suggested)

**Problem:** result ke upar boxes me kuch details nahi aati thin.

**Ab:** profile ke turant neeche **har channel (🟦 FF / 🟩 GV) ka ek KPI card** — pehle quick (turant),
phir poora data aate hi upgrade:

| Box | Kya |
|---|---|
| 📦 Stock | total + **VC4 · VC20 · VC5+** (TL: own + agents) |
| 📦 TL ke under stock / 🧑‍💼 Agents | agent → uske TL ka total; TL → agents count (click → list) |
| 🏷️ Issued this month | MTD + class mix |
| 📅 Last month | total + class mix |
| 🚦 Priority | chip + cover din + run-rate basis (FF T−1 / GV live) |
| 🎯 Sug. VC4 · 🎯 Sug. Commercial · 🎯 All tags | **dono numbers** (After stock · W/o stock) + formula |
| 📈 Growth | % + expected month-end |

Direct agent (APS) ho to “🏷️ Tags required” box; har box click → wahi drawer jo pehle `mp-kpi` par tha.

## 3. 📅 Date-wise issuance trend — VC4 / VC20 / VC5+

**Problem:** chart sirf “Total tags” dikhata tha.

**Ab:** chart **stacked VC4 · VC20 · VC5+** (legend ke saath), upar class-wise **total chips** (share %,
avg/din, ⭐ best din). Table pehle se class-wise thi. Trend ka search bar bhi: type karte hi
suggestions, pick/Enter par apply (har key par poora card repaint nahi hota → dropdown zinda rehta hai).
Header me ab “Sab (FF + GV · kul N rows)” sahi aata hai (pehle literal `${…}` chhap raha tha).

## 4. ⚡ FF “aaj ka snapshot” — sirf 0 nahi

FF ka data T+1 aata hai, isliye “FF aaj 0” se kuch pata nahi chalta tha. Ab saath me **📅 aakhri din
(jo data me hai)** aur **🗓️ last 7 din ka jod** (VC4 · VC20 · VC5+).

## 5. 📲 Tag Request employee link — agent / TL ke boxes, bina duplicate

**Problem:** TL chuno to 🚗/🚚/Total KPI cells, phir class table, phir agents table ke **do footers** —
wahi stock/last/MTD **3 baar**. Agent me bhi 🚗/🚚/All rows + class table (double).

**Ab:** agent aur TL dono ke liye **ek jaisa box-strip** — `📦 Stock · 📅 Last month · ▶ Current MTD
(+ run-rate) · 🎯 Suggested (After stock · W/o stock) · 🚦 Priority (+ cover, agents)` — har box me
total + **VC4 · VC20 · VC5+** mix; neeche **sirf EK class table** (VC4 · VC20 · VC5+ · Total). Agents
table ke footer me total **ek hi baar** (TL ki apni row ho tabhi agents + own + total teeno). Per-class
qty hints (Stock · Last · MTD) jaise the waise hi.

---

## 🔧 Files

`lazy.js` · `masterProfile.js` · `masterSearch.js` · `tagRequest.js` · `styles.css` · `index.html`
(`config.js?v=104` → saare lazy modules fresh, `styles.css?v=106`, `lazy.js?v=103`) · `sw.js`
(`apnapayment-v108`) · `server.js`/`package.json` 3.52.0 · tests: `dev/v352-master-search-kpis.test.js`
(naya) + `tag-request-ui` / `v351-tagreq-tl-courier` / `v350-tagreq-recover` / `pwa-mobile-shell` pins.
