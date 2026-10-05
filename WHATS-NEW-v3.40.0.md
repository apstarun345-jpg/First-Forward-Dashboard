# ✨ v3.40.0 — 🧮 TL ka stock double count band · own vs agents side-by-side · har number clickable (GV Partner + First Forward)

> Theme: **"TL ka stock aur TL + agents ka stock jod kar ek hi number na bane."**
> Master Search aur Agent / TL Summary — dono channel me TL ka stock ab **ek hi baar** judta hai,
> aur har KPI / card click par **wahi detail** khulti hai jo number par likha hai.

---

## 🐞 Kya bug tha (live site par)

`first-forward-dashboard.onrender.com/#/home` — Master Search aur **Agent/TL Summary** me TL ka stock
phoola hua dikhta tha, aur usi number par click karne par drawer me aur bhi zyada (kabhi poore company ka)
stock aa jaata tha.

Do alag-alag sheet patterns dono channels me asar dikha rahe the — fixture bana kar **reproduce** kiya:

| # | Channel | Root cause | Asar (asli fixture) |
| --- | --- | --- | --- |
| **A** | First Forward | `tlStockComposition()` TL ki **REPORT row** ko "TL ka apna stock" maan kar agents ke jod ke **UPAR add** kar deti thi. Par asli sheet me wo row poore **team ka rollup** hoti hai (`TL's Stock Details` sheet ka total). | own 120 + agents 80 = **200** (asal 120) · `agentCount 3` me TL khud bhi "agent" |
| **B** | GV Partner | `Stock Agent` rows **class-less** hote hain — unhe class map me daalne par sab `Commercial` me girte, phir `fillClassMap()` report ka VC4 **add** kar deta tha | VC4 20 do baar: total **120** (asal 100) · agents table 70 vs class footer 120 |
| **C** | Dono | TL ki apni row `pr.agents` / `agentCount` / `sumAgentVc4*` me shamil rehti thi — UI "TL ke agents" me TL ko hi agent dikhaata, aur WhatsApp / CSV / PDF me wahi ganda number jata | "Agents: 3 · TL One: 120" |
| **D** | Dono | Drawer filter: GV ki `stockAgentClass` rows me **TL column nahi** hota, par drawer `tlName` par filter karta tha → list khaali → fallback **poore company ka stock**. FF me `Own X + agents Y` chips ke koi alag drawer the hi nahi. | card 100, drawer hazaaron |

---

## 🛠 Fix

### 1) Composition — `masterProfile.js · tlStockComposition()`
* `own` (TL ke paas) aur `team/agents` (agents ke paas) ab **priority se** resolve hote hain:
  1. stock **detail** me TL ki APNI rows (`StockDataa` / `Tag Assignment` — class-wise, sabse trusted),
  2. REPORT ki TL self row — **par sirf tab jab wo team ke rollup jaisi na lage** (`rollupOwnRow` guard: self row ≥ agents ka jod),
  3. sheet ka `TL's stock` snapshot − agents ka jod.
* Class map ab **sirf class-bearing rows** se banta hai (`classRowsOnly`) — GV ki class-less rows ko `Commercial`
  bana kar upar se VC4 **add** karne ka raasta band (`fillClassMap` → `fitClassMap`, jo **scale** karta hai, kabhi add nahi).
* Sheet ka total detail se bada ho (rows adhoori / load me) to shortfall **hamesha TEAM** me jaata hai, OWN me nahi.
* Class table `alignClassMap()` se KPI ke VC4 / Commercial totals par laaya jaata hai → **table ka jod == card ka number**.
* Diagnostics return hote hain (`ownFrom`, `membersFrom`, `rollupOwnRow`, `snapshot`) — UI inhi se "hisaab kaise joda" likhta hai.

### 2) TL apni agent list me "agent" nahi
* `splitTlSelfRow()` REPORT / detail rows se TL ki apni row nikaalta hai → `pr.agents` = **sirf agents**,
  `pr.selfAgent` = TL ki apni row, `agentCount` = agents, `teamSize` = sheet ki rows.
* Issuance / run-rate / growth / weekly chart me TL ki apni production **jusi rehti hai** (wo uska kaam hai) —
  sirf *agents ki ginti aur stock ka jod* theek hua hai.

### 3) 🧑‍💼 TL ke agents — ab side-by-side comparison
* **Master Search profile drawer** (`masterProfile.html`) aur **Agent/TL Summary** (`agentSummary.js` ka Team Agents card)
  dono me: TL ki row **sabse upar highlighted** (`👤 TL One · TL · apna stock`), phir agents, phir 3-line footer —
  `🧑‍💼 Agents total (N)` → `👤 TL ke paas (own)` → `= TL TOTAL (own + agents)`.
* Rows ka jod composition se alag ho (sheet beech me load ho rahi ho) to note chhupata nahi, **explain** karta hai.
* GV me `agentName === tlName` wali row pehle se *self-supervised / Direct* gin jaati hai (config rule) — wahan
  TL ka own stock stock-detail rows se aata hai aur footer composition se reconcile karta hai.

### 4) Har KPI / detail click = usi number ki drawer
* `TL stock (total)` card ke neeche **do clickable chips**: `Own 40` → `scope=stock&…&part=own`, `agents 80` → `part=team`
  (`kpiDetail.js` me naya `part` filter — dono channel). Agent profile ke `TL stock` card par bhi wahi chips.
* `Dispatch priority` (TL) aur `Agents` count ab `scope=people&tl=…&self=0&sort=stock` kholte hain —
  **people drawer me TL ki apni row count me nahi** ginti jaati, drawer ke neeche `= TL TOTAL — agents 80 + TL ka apna stock 40`
  reconcile row + TL ki row highlighted.
* Priority chip click → `…&level=High` (usi priority wale agents). Kundli card ke stock / Agents blocks
  (`masterSearch.js`) bhi clickable ho gaye (`ms-stat-click`).
* **GV TL stock drawer ka filter fix**: TL ke agents ka set `Stock Agent` (agent × TL) rows se nikaal kar
  `Stock Agent Class` rows filter hoti hain → card 100 = drawer 100.
* GV drawer me FF jaisa **TL × class matrix** bhi aata hai (parity).

### 5) Parity + exports (dono channel)
* `agentSummary.js`: Team Agents card naya `teamAgentsCard()` — TL row, footer, chips; `reportHtml` ke neeche
  `📦 Stock ka hisaab` note; `monthRows` / people list ka TL stock ab **ek hi composition** se (`quick().stock`).
* Exports same hisaab: `reportText` (WhatsApp) · `reportCsv` · `reportXlsx` · `makePdf` · **Team Pack** PDF/Excel —
  sab me `TL ke paas (own) X + agents ke paas Y = TL total Z` aur TL ki row marked (`👤 … (TL — apna stock)`).
* `masterProfile` ke CSV / WA / PDF me bhi `AGENTS TOTAL` → `+ TL KE PAAS (OWN)` → `= TL TOTAL` rows.
* `tagRequest.js` (public tag request) ke `👥 <TL> ke agents` panel me TL ki row marked + 3-row reconcile footer,
  aur "Agents" chip ab `N + TL` dikhata hai.

---

## 🧪 Tests

* **Naya:** `dev/tl-stock-split.test.js` (9 tests) — FF rollup + FF own-rows + GV class-less fixtures par
  `own + agents == stock.total`, `agentCount` me TL nahi, class table == KPI, drawer ke `part=own|team`,
  people drawer `self=0`, aur Summary page (agentSummary) ka card + CSV/WA.
  Bug wale numbers par regression lock: **FF 200 → 120**, **GV 120 → 100**.
* Updated: `dev/master-profile.test.js` — `Own 8 + agents 70` ab chips ke roop me assert hota hai
  (`part=own` / `part=team` + `= TL TOTAL (own + agents)` footer), CSV me `= TL TOTAL` row.
* `npm test` → **387 pass / 0 fail** · `npm run check` → syntax ok.

## 📦 Files

`masterProfile.js` · `agentSummary.js` · `kpiDetail.js` · `masterSearch.js` · `tagRequest.js` · `styles.css` ·
`dev/tl-stock-split.test.js` · `dev/master-profile.test.js` · `index.html` + `sw.js` (`?v=63`, `apnapayment-v71`) ·
`package.json` (3.40.0) · `server.js` (`/api/health` ka stale `version` ab 3.40.0)

## 👀 Kaise dikhega

1. **Home → Master Search** me kisi TL ka naam daalo → kundli card me `TL stock (own + agents) 120` aur neeche
   `TL ke paas 40 · agents 80` chips → chip par click → drawer me **sirf** wahi hissa.
2. **Agent/TL Summary** (`#/ffAgentSummary` / `#/gvAgentSummary`) → TL pick karo → `Stock in hand` card par chips,
   `🧑‍💼 Team Agents (2)` me sabse upar `👤 <TL> · TL · apna stock`, footer me 3-line reconcile.
3. Profile drawer (`📊 Poori report`) → `📦 Stock ka hisaab` note batata hai own kis source se aaya aur
   "sheet me TL ki row team ka rollup thi — alag se nahi joda gaya".
