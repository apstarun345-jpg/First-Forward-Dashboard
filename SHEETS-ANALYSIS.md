# 📑 REPORT (First Forward) aur GV REPORT (GV Partner) — poora analysis

> Code se verify kiya gaya: `performance.js` (FF REPORT schema) · `gv.js` (GV REPORT_COLS) · `masterProfile.js` (stock / issuance hisaab) ·
> `kpiDetail.js` (drill-down). Column letters FF REPORT me *fallback* offsets hain — asli parsing **header text se** hoti hai
> (`match` regex), isliye sheet me columns khisak jaayen to bhi section sahi pakda jaata hai.

---

## 1) Dono channel ka data-map (kaun sa number kahan se)

| Cheez | 🟦 First Forward | 🟩 GV Partner |
| --- | --- | --- |
| **Issuance (last month / current)** | **EIR** tab (har tag ki row) — *authoritative*. REPORT ke duplicate issuance columns sirf reconcile ke liye | **TL headline:** GV REPORT AQ:AV TL snapshot (deduplicated; period blank ho to GV Master/EIR fallback). **Agent + class/tag detail:** GV Master/EIR ledger; differences are shown, not silently padded |
| **Stock (agent-wise, class-wise)** | **StockDataa** (tag-wise) · REPORT ka *Agent Inventory Summary* snapshot | **Tag Assignment** (tag-wise) · GV REPORT ke `Stock VC12…VC7` columns |
| **Agent / TL operational fields** (priority, status, last active, TL stock, mobile) | **REPORT** tab | **GV REPORT** tab (header row 4) |
| **Data basis** | **T+1** — aaj ka data kal aata hai (1 tareekh ko "current month" = pichhla month) | **Live** — aaj tak ka data |
| **Run-rate** | issued ÷ (aaj − 1) din (data kal tak ka) | issued ÷ (aaj − 1) din (`U.channelBasis('gv')`, data live) |
| **Suggested dispatch** | `avg/day × 15 din − stock` (net) · `avg/day × 15` (gross / w/o stock) — dono dikhte hain | same formula |

> Isliye ek hi naam FF aur GV me alag numbers dikhata hai — ye bug nahi, **do alag sheet / basis** hain. Home search ka naya **⚖ FF + GV**
> tab dono side-by-side aur unka jod dikhata hai.

---

## 2) 🟦 REPORT sheet (First Forward) — section-wise

Sheet ek bada "agent-wise summary" hai: **ek row = ek agent** (TL ki apni row bhi ek agent row hoti hai). Upar section headings hote
hain, neeche sub-headings. Sections (fallback start column ke saath):

| Section (header) | Columns | Kya batata hai |
| --- | --- | --- |
| **Agent Profile** | A Agent ID · B ID · C Agent Name | Agent ki pehchaan |
| **TL's Master Data** | D GV ID Found · E TL ID · F TL Mobile · G TL Name | Agent kis TL ke neeche hai |
| **Agent Inventory Summary** | H VC4 · I VC5 · J VC6 · K VC7 · L VC12 · M VC16 · N **Total Stock** · O **Commercial Stock** | **Agent ke paas stock**, class-wise |
| **Dispatch Details (VC4)** *(TL level)* | P TL VC4 Stock Days · Q TL Projected Issuance · R Dispatch Priority · S Stock Alert | TL ke VC4 stock kitne din chalega |
| **TL's Stock Details** | T TL VC4 · U TL Commercial · V **TL Total Stock** | **TL ka stock** (⚠️ aksar *poore team ka rollup* hota hai — TL ke paas + uske agents) |
| **Performance In – <last month>** | W Active Days · X VC4 · Y Commercial · Z Total | **Last month** issuance |
| **Performance In – <current month>** | AA Wrong VRN · AC VC4 · AD–AH VC5…VC16 · AI Commercial · AJ **Total** · AK Projected · AL/AM per-day · AN Daily Avg | **Current month** issuance |
| **Agent's Performance Status** | AO Last vs Current (growth %) · AP Last Active · AQ Agent Status | Active / inactive, growth |
| **Performance in 7 Days** | AR Active Days · AS–AY 7 din ke counts | Last 7 din ka chart |
| **TL's Last Month Issued** | AZ VC4 · BA Comm · BB Total · BC Daily Avg | TL-level last month |
| **TL's Current Month Issuance** | BD VC4 · BE Comm · BF Total · BG/BH per-day · BI Daily Avg | TL-level current month |
| **TL's Performance Status** | BJ growth · BK Last Active · BL TL Status · BM Projected | TL ka status |
| **Agent Wise (Dispatch)** | BN Daily Avg · BO Stock Days (VC4) · BP Priority Level | Agent ki dispatch priority |
| **Dispatch Details (Commercial)** | BQ…BT | TL ka Commercial stock days / priority / alert |
| **Device** | BU Biometric Device | |
| **GV Stock / GV Issuance (last, current)** | BV–BY | Us agent ke **GV channel** ke numbers (cross-reference) |

**Dhyan rakhne wali baatein**

* 🔁 REPORT ke issuance columns *duplicate snapshot* hain — dashboard FF issuance **EIR se** nikalta hai; REPORT se sirf priority /
  status / stock / mobile aate hain (`performance.js` me "EIR-authoritative").
* 🧮 TL ki row = poore team ka rollup ho sakti hai → pehle TL ka stock **double count** hota tha (v3.40 me fix: own + agents = total).
* TL agents ki ginti me khud nahi aata (`agentCount` = sirf agents, TL ki row `selfAgent` me alag).

---

## 3) 🟩 GV REPORT sheet (GV Partner)

Tab **`GV REPORT`**, **header row 4**, configured range `A4:AZ`. Ek row = ek agent. Columns (`gv.js · REPORT_COLS`):

| Group | Columns |
| --- | --- |
| **Pehchaan** | A Mobile · B AGENT_ID · C AGENT_NAME · D TL ID · E TL Name |
| **Agent stock (class-wise)** | F VC12 · G VC16 · H VC4 · I VC5 · J VC6 · K VC7 · L **Stock Grand Total** · M **Stock Commercial** |
| **Dispatch** | N Minimum Required Inventory · O Suggested Dispatch Qty · P Priority Level |
| **TL stock** | Q TL VC4 · R TL NVC4 · S **TL Total Stock** |
| **Last month** | T Issuance Days · U VC4 · V Commercial · W **Total** · X Growth % · Y Agent Status · Z Agent Performance |
| **Current month** | AA Today Issued · AB Issuance Days · AC Replace · AD Chassis · AE VC4 · AF VC5 · AG VC6 · AH VC7 · AI VC12 · AJ VC16 · AK Total CV · AL **Total Issuance** |
| **Projection** | AM Expected In Month · AN Runrate VC4 · AO Runrate NVC4 · AP Runrate |
| **TL issuance** | AQ–AS TL Last Month (VC4 / Comm / Total) · AT–AV TL Current Month (VC4 / NVC4 / Total activation MTD) |
| **Avg run-rate** | AW Avg VC4 · AX Avg NVC4 · AY eRunrate · AZ Supervisor ID |

* **TL issuance precedence:** AQ–AS (`TL Last Month`) aur AT–AV (`TL Current Month`) TL-level snapshot har member row par repeat ho sakta hai. Dashboard un tuples ko **sum nahi** karta; sabse complete / most-common snapshot uthata hai. Snapshot blank ho to us period ke GV Master/EIR totals fallback hote hain.
* **TL snapshot vs class detail:** TL headline last/current figures GV REPORT se aate hain; VC4 / VC20 / VC5+ cards aur tag drill-down GV Master/EIR ledger se. Agar refresh timing se farq ho, Home card source note aur KPI drill reconciliation note dono numbers + difference dikhate hain.
* **GV me "Direct" agent** = `TL Name` aur `TL ID` dono khaali (ya agent == TL) — config rule `isDirectAgent`. TL ki self-supervised report row agent count se alag `selfAgent` me rakhi jaati hai.
* GV Stock Agent rows (Tag Assignment group-by) **class-less** hote hain — unhe `Commercial` maan kar upar se REPORT ka VC4 jodna
  inflation tha (v3.40 me fix).
* GV ke 'Commercial' stock me VC20 / VC5+ ek lump me aate hain jab sirf class-less row ho; class-wise table me isiliye kabhi
  "COMMERCIAL" ek alag row dikhti hai.

---

## 4) 🔎 Home search → "andar se andar" drill-down (barcode tak)

```
Home → Master Search  (naam / TL / agent ID / TL ID / GV ID / mobile / barcode)
 └─ Result: Search Report  [ ⚖ FF + GV ] [ 🟦 First Forward ] [ 🟩 GV Partner ]          ← v3.41
     ├─ Person card: colorful Last Month · Current MTD · VC4 · VC20 · VC5+ cards; each class also shows month-end run-rate projection
     ├─ ⚖ FF + GV   : Last month · Current · Stock (own / agents / TL total) · Class-wise  — FF | GV | jod
     └─ 🟦 / 🟩     : KPI cards → Last vs Current → Class-wise → TL ke agents → Agent × Class → Charts
         └─ koi bhi number (data-kpi) par click  →  KPI drawer
             ├─ Issuance (last month / MTD):  VC4 vs Commercial · class × type · FF vs GV · day-wise table · TL / agent table
             │   ├─ class par click  → us class ki rows
             │   ├─ din (date) par click → us din ka detail
             │   ├─ agent / TL par click → unki apni drawer (same chain)
             │   └─ tag row par click → 🏷️ Tag record: sheet ki asli row (barcode, VRN, class, status, GV unique ID, amount…)
             └─ Stock:  class-wise · TL-wise · TL × class · top agents → last level: asli sheet rows (barcode / serial)
```

Back button drawer me history rakhta hai — kisi bhi level se wapas.

---

## 5) Analysis — kya theek tha, kya kami thi (v3.40 tak) aur ab kya hua

| # | Cheez | Pehle | v3.41 |
| --- | --- | --- | --- |
| 1 | Naam search → poori report | Sirf tab khulti thi jab result me **exactly 1** person ho. Same naam FF + GV me ho to 2 card, kuch inline nahi | Same naam = **1 group**, auto inline, **⚖ / 🟦 / 🟩** toggle. Alag-alag log match hon to har card par **📂 Yahin poori report** |
| 2 | FF + GV ek saath | Alag-alag report, jod khud karna padta | **⚖ tab**: last month · current · stock (own/agents/total) · class-wise — FF · GV · jod |
| 3 | TL ke agents table | Stock VC4/Comm + Last + This (sirf total) | **Stock · Last month · This month — har ek VC4 / Comm / Total**, har cell clickable (agent → month → class → din → tag) |
| 4 | Agent-wise class stock | Sirf VC4 / Comm | **Agent × Class stock matrix** (TL + har agent), cell click → us agent+class ke barcode tak |
| 5 | Report me navigation | Lamba scroll | **Section chips** (Stock · Last vs Current · Class · Agents · Agent × Class · Charts) |
| 6 | Agent / TL Summary | FF aur GV alag pages, manual switch | **"🟩 GV Partner me dekho 👉" / "🟦 First Forward me dekho 👉"** chip — same naam dusre channel me khulta hai; naam na mile to saaf toast |

## 6) Abhi bhi dhyan rakhne wali limitations

* **FF ≠ GV numbers** by design (T+1 vs live, EIR vs GV Master).
* GV class-less stock rows → class table me `COMMERCIAL` lump (VC20 / VC5+ alag nahi) jab tak Tag Assignment class-wise rows na ho.
* TL ki REPORT row rollup ho to "TL ke paas (own)" = *sheet total − agents* (derived) — footer / note me `snapshot-team` likha aata hai.
* ⚖ jod column sirf sum hai (clickable nahi) — FF aur GV ke alag basis ki wajah se ek drawer me milana galat hota.
