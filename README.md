# First Forward Dashboard — First Forward + GV Partner (v3.46)

Colourful dashboard website built directly on top of **do Google Sheets**:

| Source | Sheet | Tabs | Kya |
| --- | --- | --- | --- |
| **🟦 First Forward** | "Agent Performance & Stock Report" | EIR · StockDataa · REPORT | issuance log, field stock, agent performance |
| **🟩 GV Partner** | "Tag Issued Report" | GV Master · Tag Assignment · GV REPORT | GV issuance, GV stock, GV agent performance |

Dono brands ke metrics **hamesha alag** dikhte hain (Top VC4, Top Commercial, TL/agent lists alag-alag) —
aur ek **⚖️ GV vs First Forward** page side-by-side comparison deta hai.

Koi database nahi, koi manual upload nahi — website Google Sheet se data padhti hai
(Google Visualization API / `gviz`) through a small Node server that also handles **login, users,
permissions and settings**. Zero npm dependencies.

## ✨ v3.46.0 — 🏠 Home v2 (GV aaj live) + 🔎 Management → Master Search + ⚡ fast Agent/TL Summary

- **🟩 GV aaj live ab pakka:** Home ka GV aaj ka number server feed (`/api/today`) se aata hai —
  **GV Master sheet** ki chhoti grouped query (date × class, 30 din), 45s cache. Saath me VC4 · VC20 ·
  VC5+ · **Replacement · Chassis**, aur **Expected Today** = pichhle 4 same-weekday ka average
  (pichhla mahina bhi shaamil) + aaj ka pace. GV Master load hone par wahi snapshot card ko enrich
  karta hai (chhota snapshot bade number ko replace nahi karta).
- **🗓️ Asli bug fix:** server `serverDate` pehle sirf `Date(y,m,d)` + ISO samajhta tha — jis sheet me
  date text (`03-10-2026`, `3-Oct-2026`) hai wahan GV aaj **0** dikhta tha. Ab sab formats
  (`dev/server-date-formats.test.js`).
- **🏠 Home v2:** (1) GV aaj live cards, (2) **is mahine ke KPI cards — har card ke andar last month vs
  current month ka % + FF/GV split** (Last day · MTD total · VC4 · VC20 · VC5+ · Replacement · Chassis ·
  Expected in month), (3) charts (current vs last month line, class bars, donut, same-weekday run-rate),
  (4) **stock — FF (StockDataa) + GV (Tag Assignment)** charts aur data ke saath.
  **Home se master search hata diya.**
- **🔎 Management → Master Search (naya):** koi results list / box nahi — naam / ID / mobile → click →
  **poora data usi page par** (⚖ FF + GV combined + per-channel profile). Ek se zyada match par sirf
  ek line ke naam-chips. Topbar `/` search aur Ctrl+K palette bhi seedha yahi page kholte hain.
  Permission key **`masterSearch`**.
- **⚡ Agent/TL Summary fast:** list turant (memory se), GV ke bhaari datasets background me; TL search
  par **last · current · today + stock** sync ho jaate hain; dropdown me last/mtd/aaj/stock.
- Tests: smoke **Home v2 + Master Search page + GV TL fast open** · naya `dev/server-date-formats.test.js`
  · docs: [WHATS-NEW-v3.46.0.md](WHATS-NEW-v3.46.0.md).

## ✨ v3.45.0 — 🧾 GV sheets ka sahi column recognition + 🎨 Agent/TL Summary ka naya interface

- **🧭 Heading-aware column mapping (GV Master · Tag Assignment · GV REPORT):** ab config letters par
  andha bharosa nahi — heading row padh kar sahi column chuna jaata hai (typo/abbreviation tolerant),
  column shift hone par **relocate** hota hai, aur kabhi gviz heading ki jagah data row de de to
  re-probe → warna config letters (chup-chaap galat number band). Warnings **Settings → 🗂️ Sheets & tabs →
  🧭 GV column heading check** me dikhti hain.
- **📦 Stock = Tag Assignment ke in-stock tags:** status-aware (issued/returned stock me nahi, par
  `nAll` + `byStatus` se poora hisaab).
- **🎨 Agent/TL Summary v2 (GV + FF):** gradient hero, **clickable KPI cards** (har card par sheet ka
  cross-check chip + farq), **tag-level drill drawer** (VRN barcode · TAG_ID · serial · date · class ·
  status, CSV ke saath), "🧭 Ye numbers kahan se aaye" source cards, 🧮 Sheet-vs-Ledger table,
  class-wise bars, 6-mahine trend, TL agents table, ageing aur 🔍 Data check panel.
- **Truth rule (GV Summary):** final = **GV Master ledger** (tag rows), GV REPORT = cross-check
  (farq har jagah likha aata hai). Baaki GV views me sheet-first barkarar + farq ka note.
- Tests: naya `dev/gv-truth.test.js` (9) + smoke **v3.45 · Agent/TL Summary v2** · `npm test` **437 pass** ·
  docs: [WHATS-NEW-v3.45.0.md](WHATS-NEW-v3.45.0.md).

## ✨ v3.44.0 — 🧾 GV REPORT sheet-first — TL ka "440" band · VC4 · VC20 · VC5+ · TL ID-wise stock

- **🧾 Sheet-first rule (GV):** GV REPORT sheet ka number final; tag-ledger (EIR / GV Master) sirf tab jab
  sheet ka cell **khaali** ho (sheet ka asli 0 bhi 0 rehta hai). Pehle `Math.max(sheet, ledger)` se
  TL **APS011919** app me **440** dikh raha tha jabki sheet me **332** hai — ab har jagah (GV Performance
  agents + TLs, 360 board, Master Search drawer, Agent/TL Summary) **332**; farq ho to note me
  `Last: sheet 332 vs tag ledger 440 (Δ +108)` likha aata hai. TL-wise table me **TL ID** column +
  Last/MTD = GV REPORT ka **TL snapshot** (members ka jod dim me).
- **🎯 VC4 · VC20 · VC5+:** naya **Class group** table (GV + FF) — rows VC4/VC20/VC5+/Total, columns
  **last month · MTD · Stock**, har cell clickable (`&f=vc4|vc20|vc5p`). GV me VC4 + NVC4 sheet se,
  VC20/VC5+ ka batwara sheet ke class columns / tag-ledger mix se (source line me likha rehta hai).
- **🆔 TL ID-wise stock (drawer me sabse neeche):** **Naam · Agent ID · TL ID · Stock VC4 · Stock Comm ·
  Stock total**, footer **agents ke paas / own / = TL TOTAL · 🆔 id** (own + agents = 1054 jaisa sheet).
  Har row click = agent 360 · har stock cell click = us ID ka stock (class → barcode). Nav chip
  **🆔 TL ID stock**.
- Tests: naya `dev/gv-sheet-truth.test.js` (asli APS011919 rows — 332 / 27 / 1054 + group bins + clickable
  TL-ID table) · `npm test` **425 pass** · docs: [WHATS-NEW-v3.44.0.md](WHATS-NEW-v3.44.0.md).

## ✨ v3.43.0 — 📊 REPORT data everywhere — Home search v2 + FF/GV Summary me poori data table (same numbers)

- **🎨 Home Master Search v2:** hero search bar (focus ring, `/`, ✕), **channel chips** (🎯 Sab · 🟦 FF · 🟩 GV),
  live meta line, aur results me sabse upar **📊 REPORT data table** — **Agent · TL · 📦 Stock ·
  🏷️ Total Issuance (MTD) · 📅 Last Month · 📈 Growth** (sortable + filterable + "Aur dikhao").
  Number cell click → detail drawer · row click → usi person ki card + poori report. Kundli cards me
  bhi wahi **data strip** (colour-coded) + channel badges.
- **📋 FF / GV Agent/TL Summary:** search card v2 + **"REPORT data — sabhi agents & TLs"** roster table
  (chips: Sab/Agents/TLs, filter, 250+ rows paging) — row/📂 click → poora summary. Report header v2
  (channel avatar, badges, **📄 REPORT/GV REPORT tab** source chip, TL "own + agents" note), KPI titles
  user-language me (**Total Issuance · Last Month Issuance · Stock in hand**).
- **🧮 Same-numbers guarantee:** shared `FF.masterProfile.reportDataRow()` + `peopleTableHtml()` —
  table numbers seedha `quick()/build()` profile (REPORT / GV REPORT rows) se; TL rows = **own + agents**
  rollup, footer agents-only (double count nahi). Docs: [WHATS-NEW-v3.43.0.md](WHATS-NEW-v3.43.0.md) ·
  tests: `dev/report-data-table.test.js` (8) + smoke case · `npm test` 417 pass.

## ✨ v3.40.0 — 🧮 TL ka stock double count band · own vs agents side-by-side · har number clickable

- **🐞 Bug:** Master Search aur Agent/TL Summary (GV Partner + First Forward) me TL ka stock phool jaata tha —
  TL ki REPORT row aksar **poore team ka rollup** hoti hai, aur purani composition use agents ke jod ke **upar add**
  kar deti thi (FF: 120 ki jagah **200**). GV me class-less `Stock Agent` rows sab `Commercial` me girte aur upar se
  report ka VC4 jud jaata (100 ki jagah **120**). TL khud apni "agents" list me agent ban kar bhi gin jaata tha.
- **Fix:** `own` (TL ke paas) stock detail ki APNI rows → REPORT self row (rollup na ho) → sheet snapshot − agents,
  isi priority se ek hi baar; class maps sirf class-bearing rows se (`fitClassMap` scale karta hai, add nahi);
  sheet ka extra total hamesha **team** me. `splitTlSelfRow()` TL ki row agents ki list/count/totals se alag karta hai.
- **UI:** TL ke agents table me TL ki row **sabse upar highlighted** + 3-line footer (`Agents total` → `+ TL ke paas (own)`
  → `= TL TOTAL`); KPIs par `Own 40` / `agents 80` **clickable chips** (`part=own|team` drawer filter), Agents/priority
  cells `scope=people&self=0` kholte hain; GV TL stock drawer ka TL filter fix + FF jaisa TL × class matrix (parity);
  WhatsApp / CSV / Excel / PDF / Team Pack me bhi wahi reconcile hisaab.
- Docs: [WHATS-NEW-v3.40.0.md](WHATS-NEW-v3.40.0.md) · tests: `dev/tl-stock-split.test.js` (9) + `dev/master-profile.test.js`

## ✨ v3.39.0 — 📦 Summary · Master Search · drawers me stock ab hamesha aata hai (spinner nahi atakta)

- **🐞 Bug:** Agent / TL Summary aur Master Search me stock load hi nahi hota tha (spinner), aur wahan se khulne wale drawers
  (Stock in hand · ageing · kundli) me data nahi aata tha. **Root causes:** (A) Summary / drawers server ke stock-age index ka
  intezaar karte the, jo ek **unpaged** gviz query se poora StockDataa (1.7 lakh+ rows) padhta tha — 417 MB RSS, event loop 1.7 s
  block, fail hui build 10 min cache, browser par koi deadline nahi; (B) per-TL `quick()` quadratic (FF 2.8 s, GV **~15.6 s**);
  (C) Master Search sab 8 datasets ka intezaar karta aur dropdown kabhi refresh nahi hota; (D) KPI stock drawer 3 datasets sequentially.
- **Server:** stock-age index **25k-row pages** me (3 parallel, in-order), `/api/stock-age` max 20 s rukta hai phir `pending`
  (browser poll karta hai), fail build 30 s baad auto-retry (adhura FF kabhi serve nahi), Render par boot-warm-up,
  `/api/health` me `stockAge`, gviz proxy cache par **byte cap** (`CACHE_MAX_MB`).
- **Browser:** Summary ageing ka intezaar nahi karta (stock turant, ageing peeche se bharti hai, na aaye to Retry);
  KPI drawer parallel + hard limits + notice; Master Search slow dataset ke bina bhi chalta aur dataset aate hi refresh;
  kundli / drawer 12 s par partial + `onLate`. FF / GV indexes se **numbers bit-for-bit wahi**, par TL list ~4× (FF) / ~24× (GV) tez.
- Docs: [WHATS-NEW-v3.39.0.md](WHATS-NEW-v3.39.0.md) · SPEED.md §8 · tests: `dev/v339-stock-age-server.test.js`,
  `dev/v339-summary-loading.test.js`, `dev/v339-profile-scale.test.js` · `npm test` 378 pass.

## ✨ v3.38.0 — 📦 employee link par sabka stock · 👁 Preview FIX · 🔊 Mac voice FIX

- **📦 Employee link (`/tag-request`) — naam likhte hi sabka stock:** search dropdown me har agent/TL ke
  saath `📦 stock · last · MTD` (TL par uske saare agents ka total), aur employee card ke neeche ek
  **📦 "Sabhi agents ka stock · issuance"** board — poora agent list, 🔎 search + 🟦 FF / 🟩 GV filter,
  🚗 VC4+VC20 · 🚚 VC5+ · total stock · last month · MTD · cover din, grand total footer, paging, aur
  **row click → agent seedha form me**. Admin ise Link settings se OFF kar sakta hai.
- **👁 Preview button — CRITICAL FIX:** Settings → Users ka "👁 Preview" click par
  `ReferenceError: u is not defined` throw kar raha tha (map-callback variable, galat scope) — button
  kuch nahi karta tha. Ab card ke username se user record resolve hota hai; preview user ke pehle
  allowed page par jaata hai, 👁 banner dikhta hai, sidebar us user ke hisaab se, Exit se wapas admin.
- **🔊 Voice alert — macOS Chrome FIX:** `speechSynthesis.cancel()` ke turant baad `speak()` ki utterance
  Chrome (khaaskar macOS) me chup-chaap gir jaati hai (na onstart/onend/onerror) — isliye Mac par awaaz
  nahi aa rahi thi. Ab cancel sirf jab kuch already bol raha ho, aur speak 90 ms baad; boot par voice
  list garam (`warmVoices()`) taaki macOS ki async voices ready hon.
- **📥 Admin Tag Requests — colourful total chips:** footer me `rows · approved tags · stock ·
  suggestion (after stock · without stock deduction)`, live data par update hote hain.
- Docs: [WHATS-NEW-v3.38.0.md](WHATS-NEW-v3.38.0.md) · tests: `dev/v338-tag-stock-board.test.js`,
  `dev/v338-mac-voice.test.js` · `npm test` 347 pass.

## ✨ v3.37.0 — 🚨 Unusual Activity: card ka number = drawer ka data · 🚀 server-side scan · 🩺 ek button se sab fix

- **🎯 Card = drawer (root cause fix):** Unusual Activity ke anomaly cards `class="kpi"` hone ki wajah se
  `app.js` ka **global** `.kpi, [data-kpi]` handler bhi chal jaata tha — ek click par **do drawer** khulte
  the aur aakhri wala (card ke title se *inferred*, period/flag ignore) jeet jaata tha. Isliye ♊ card
  **652 tags** bolta tha aur drawer **"Total Issued 2,947"** dikhaata tha. Ab page apne cards
  `data-kpi-self="1"` se mark karta hai aur global handler unhe **skip** karta hai (Agent Summary ke
  `data-as-age` cards bhi). `kpiDetail.js` me ye convention documented hai.
- **Ek hi source of truth — `metricFor(model, flag)`:** card value, drawer headline, drawer ki evidence
  rows, CSV aur PDF sab ek hi function se bante hain. Drawer me upar **✅ "Card = drawer"** chip hai; farq
  ho to **exact reason ke saath ⚠️** (aggregate vs tag-level, ya evidence list capped). Card **0** bolta hai
  to drawer me **0 rows**.
- **🚀 Speed:** tag-level scan ab **server** par hota hai — `GET /api/unusual/scan?from=&to=` EIR + GV Master
  ko **parallel ×4** padh kar compact index deta hai (10-min cache, gzip, permission `unusual`). Page
  **turant** daily numbers se paint hota hai (~5 ms), scan background me aata hai; browser ko 25k-row pages
  sequentially kheenchne nahi padte. Badi tables chunked (ledger 60 · drawer 100 · "↓ Aur N dikhao" 200/step),
  events ek hi baar delegate. Measured: render + scan **99 ms** (3,950 tag rows), cached **8 ms**.
- **`unusual-scan.js` (naya, shared):** ek hi isomorphic scan/index/evidence lib server aur browser dono
  chalate hain — duplicate logic do jagah nahi, numbers drift nahi karte. Counts **hamesha exact**, sirf
  evidence lists cap hoti hain (`meta.truncated` me dikhta hai). Duplicate = `n ≥ 2` VRN groups (VRN normalize,
  chassis/blank/placeholder exempt), Wrong = `union(wrong-type, malformed)` = `w + i − b`.
- **🩺 Settings → Site diagnostics v2 ("sab fix yahin se"):** naya **🃏 KPI card click detector** (page-owned
  card par `data-kpi-self` missing → ⛔ High finding) + **🛠 site-wide attribute repair** (`ff_diag_attr_repairs`
  me save; `app.js` boot par aur har page render ke baad lagata hai, MutationObserver re-render par dobara).
  Saath me **🔬 Card ↔ drawer parity test** (har card ko asli me click karke verify), **🐢 per-page render ms /
  DOM nodes / HTML KB**, **🗂 data health** (store snapshot, scan error/adhoora/offset issue/purana),
  findings me **filter · search · grouping · ⬇ CSV · ⬇ JSON · 📋 Copy · 🧾 history**, aur **⚡ Speed doctor**
  prefs (`ff-no-anim`, `ff-lite`, Unusual fast scan) jo boot par lagte hain.
- **🩺 Unusual Activity ke andar bhi Diagnose** (page-level drawer): scan health, har flag ka hisaab (kahan se
  number aaya), data quality, aur actions — ↻ Deep scan · 🔬 probe · 🩺 site diagnostics yahin · ⚡ Fast mode ·
  📋 Copy · ⬇ CSV.
- **🐛 Fixed:** drawer ka KPI strip saaton flags ke liye same tha; 📄 PDF `FF.lazy.loadScript` (exist hi nahi
  karta tha) call karta tha → ab `ensure()`; spike card "tags" label ke saath peak-day sum dikhata tha (ab unit
  `peak-day tags`); cards `scopedRows` aur ledger/CSV `filteredRows` se bante the (ab sab ek metric se).
- Docs + tests: [WHATS-NEW-v3.37.0.md](WHATS-NEW-v3.37.0.md) · `dev/v337-unusual-parity.test.js` (10 tests,
  `/api/unusual/scan` integration samet) · `dev/smoke.js` me card↔drawer parity case · `npm test` 340 pass.

## ✨ v3.27.0 — 🌐 Employee link (bina login) · 📗 tag request kisi bhi sheet me

- **🌐 `/tag-request` (employee link) — login/signup ki zaroorat nahi:** employees ke liye ek clean
  public link. Kholte hi form — upar **Employee name mandatory**, phir agent search → class-wise qty →
  system check → submit. Request admin ke Tag Request section me **employee link** badge + naam/mobile/IP
  ke saath aati hai; employee **Request ID** se apna status dekh sakta hai. Dashboard ka koi doosra page
  public link se nahi khulta (scoped + throttled `/api/public/gviz`).
- **📗 Sheet sync ab kisi bhi sheet me:** Tag Request page par **alag sheet ka link + tab naam** do →
  entries usi sheet me (`SpreadsheetApp.openById`, naya Code.gs v3.27). **🔌 Sheet check karo** galat
  sheet detection + purane Code.gs ki warning deta hai.
- **Admin control:** link ON/OFF, title/message, mobile/branch fields, "system check dikhao" toggle;
  per-IP throttle + validation se spam control. Public link par bhi Google Sheet sync chalti hai.
- **🧓 Stock ageing:** stockDataa ke **Agent Allocated At** se har agent/TL ka stock **1 / 3 / 5 / 6+ mahine**
  purana kitna hai — **🚗 VC4+VC20 alag, 🚚 VC5+ alag** — har month ke saath **⬇ CSV** (sab dated tags ki
  list). Stock page, KPI drawer, request drawer, tag-request result — sab jagah.
- **🖨️ Dispatch label Print/PDF/Share:** employee link wali (address wali) request me drawer se A4 label
  print — same address **left + right dono taraf poori page pe** (8/10/12 copies) · FROM company (Settings →
  Contacts me set karo) · TO employee (PIN bada) · text size chhota/bada · 📋 copy + 📤 WhatsApp share.
- **🔁 Duplicate warning (employee):** same naam + same agent × class ki request pehle se pending/approved ho
  to submit se pehle amber warning — *"Ye entry pehle se hai"* + 🔎 status · 🔁 phir bhi bhejo · ✏️ edit.
  Aise bheji gayi request admin list/notification me **🔁 duplicate** mark ho jaati hai.
- **🏠 Employee form me poora address (mandatory):** name + mobile + full address + pincode — ek bhi adhoora ho
  to request submit hi nahi hoti. Admin ko request me pincode, notification/delivery copy aur Google Sheet sync
  ke columns (Employee / mobile / address / Pincode) me poori delivery details milti hain.
- **Perf:** public form sirf 4 chhoti aggregate queries karta hai (login wala poora preload nahi).
- Docs: [WHATS-NEW-v3.27.0.md](WHATS-NEW-v3.27.0.md) · ideas: [FEATURE-IDEAS.md](FEATURE-IDEAS.md)

## ✨ v3.23.0 — 🧭 panel clicks FIXED · 📊 data-update notification + 🔊 voice · ⚡ instant sheet sync · 🎤 Meri awaaz fix

- **🧭 Panel ke options ab hamesha khulte hain (CRITICAL FIX):** lazy pages (Settings, War Room, GV/FF
  commission…) ka module load hone se pehle hash router unhe Home par redirect kar deta tha — isliye
  click par page khulta hi nahi tha, aur same link dobara click dead tha. Ab PAGES registry se resolve +
  hover/tap par **module prefetch** + same-link click par refresh.
- **📊 Data update ki notification:** client-side alerts (office bell 30s poll + 5-min sync) — bell
  notification + toast + phone panel; server watcher 2.5 min (corrections bhi); `reportUpdate: 'both'`
  (admin + users); notification click → `#/tagIssued` deep link.
- **⚡ Instant sheet updates:** auto light-sync 5 min (pehle 15), tab visible par turant sync, naye tags
  detect hote hi page re-render.
- **🔊 Data update voice:** naya data aate hi bol kar announce ("Data update! Aaj ke N tags ho gaye…")
  — Hinglish/English, office bell voice toggle + mute respect, dedupe (double awaaz nahi).
- **🎤 "Meri awaaz" record fix:** Stop par `handle.stop()` se asli audio analyze hoti hai (pehle handle
  hi analyze ko jaata tha — record flow hamesha fail), dialog close par mic band, async voices refill.
- **🧪 Tests:** 247 pass (19 naye: `dev/panel-nav.test.js`, `dev/data-update-alerts.test.js`).
- Docs: [WHATS-NEW-v3.23.0.md](WHATS-NEW-v3.23.0.md)

## ✨ v3.22.0 highlights — GV aaj = GV Master sheet, FF aaj = EIR, lazy+fast load

- GV ka "aaj" ab GV Master tab se (live), FF ka "aaj" EIR se (T+1); lazy page modules + fast first load;
  dashed barcodes; sheet rows at the last drill level.

## ✨ v3.21.0 — ⚡ Fast load · 🧭 page-local filters · 🔁 FF T+1 (GV live) · 👥 nested agent drill · 🔊 voice · 🩺 diagnostics

- **⚡ Speed:** server ab HTML/JS/CSS ko **brotli/gzip** me bhejta hai aur `?v=43` wale assets **1 saal immutable** cache hote hain (repeat visit par 45 scripts ek baar hi download). Gviz proxy **stale-while-revalidate** ho gaya — purana data turant, naya peeche se; jo queries sach me use hoti hain wo server cache me **warm** rakhi jaati hain. Preload ab 2 workers + jo tab pehle se load hai use dobara download nahi karta. Net asar: pehla load ~3.3 MB → ~1.5 MB (brotli), dobara visit ~0 network.
- **📅 Report-local filters:** each report applies only its own URL/page filters; no persisted cross-page workspace filter can silently hide rows. Legacy `ff_global_filters` device state is ignored and cleared.
- **🔁 FF T+1 rule (GV live):** First Forward ka issuance data ek din late aata hai, GV live. Isliye **TODAY view → GV ka live number, FF = 0** (saaf "kal aayega" note), **YESTERDAY → GV + FF dono**. Rule `FF.config.ffIssuanceLagDays` (default 1, `0` = off) se configurable hai aur Home, Tag Issued page, KPI drawer ke day-view aur raw tag list — sab par lagta hai. GV rows (EIR master ID `5845036`) kabhi lag se nahi hatti.
- **👥 KPI drill-down "andar se andar tak":** KPI breakdown rows, class/channel matrices, day rows and individual tag rows are clickable; the drawer keeps a back path. Agent click opens day/class detail and raw EIR tags; GV agent profile KPIs and class charts open issuance or stock, stock-by-class opens the matching Tag Assignment rows.
- **🔊 Voice announcer fix:** browser ka `interrupted`/`canceled` error ab **block nahi** maana jaata (sirf asli `not-allowed`), ek baar auto-retry hota hai, aur nudge/menu me **"🔊 Enable sound"** button hai jo click ke andar unlock + test bolta hai. Status pill "SOUND READY ✓ / EK TAP ME CHALU / BROWSER BLOCK" saaf batata hai. `dev/voice-unlock.test.js` + `dev/office-bell.test.js` cover karte hain.
- **🩺 Diagnostics ab sach me fix karta hai:** safe fixes **site-wide persist** hote hain (localStorage `ff_diag_repairs` + inject ki gayi stylesheet) — page change / reload ke baad bhi lagu, aur "Clear all repairs" se hata sakte ho. Naya **🌐 Scan every page** button har permitted page ko render karke check karta hai (pehle sirf current page dekhta tha), aur scan me module contracts, FF lag config aur `data-kpi` spec validity bhi check hoti hai.
- **🐞 Bug fixes:** GV Commission ke per-class boards aur Cockpit Agent 360 drawer me `ReferenceError: s is not defined` (crash) fix; Home GV aaj grid me "Aaj ki Rate" wapas; tagIssued par FF T+1 note.
- **🧪 Tests:** naya `dev/filters.test.js` (lag + filter semantics), smoke me T+1, workspace-filter aur agent-drill checks. `npm test` = 217 pass.

## ✨ v3.15.0 — 🎯 Suggested dispatch: DONO criteria (stock − aur bina stock), har jagah
- Har suggestion ab **do figures** dikhata hai — **stock ke baad** (avg/day × din − stock) aur **bina stock ghataye** (avg/day × din): master search (TLS + agents), profile drawer, Performance dispatch plan, GV dashboard + GV Stock Report, Direct Agents, New Agents.
- ⚙️ Settings → Features me naya **🎯 Suggested dispatch / tags** card: kitne din ka suggest (`suggestDays`) + kaise dikhaye (`suggestMode`: dono / sirf net / sirf gross).
- 🔎 Topbar search: **✕ Clear** button + **📅 From→To date-range** popover (Range Report kholta hai); suggestions me dono criteria.
- 🎨 Site-wide **% rule**: − red, + green bold (KPI cards ke andar bhi) · panel/kundli text bold + bada · **War Room colourful** (dark background removed) · Dashboard ka hidden g13 KPI fix · Performance KPI cards click → full breakdown drawer.
- Docs: [WHATS-NEW-v3.15.0.md](WHATS-NEW-v3.15.0.md)

## ✨ v3.14.0 — 🆕 New Agents & TL Changes
- Naya page `#/newAgents` (Cross Channel): FF + GV ke **naye agents** aur **TL badla / TL hata / TL mila** ke alag tables, KPIs, 6-month chart, CSV. Row click → poori profile drawer.

## ✨ v3.13.0 highlights — 🧾 Master profile · 🏷️ Direct tag-required · ✉️ SMTP fix

- **Master search = poori kundli**: agent/TL par click → drawer me naam, mobile, TL (naam/ID/mobile), agent + TL stock, dispatch priority, suggested VC4/Commercial qty, class-wise issuance (last vs this month + stock), TL totals, agents table aur charts. Ek hi match ho to inline khulta hai. CSV + WhatsApp share.
- **🏷️ Direct · High/Medium · Tag required**: FF + GV dispatch plan, GV Stock Report, Direct Agents page aur Dispatch Planner me alag option — direct agents ko stock nahi, par High/Medium priority ko tags dikhte hain ("No stock" nahi).
- **✉️ Email/SMTP**: STARTTLS bug fix + Apps Script / Resend / Brevo HTTPS fallback + Settings → Email → Diagnose. Render free plan par SMTP ports blocked hote hain.
- Docs: [WHATS-NEW-v3.13.0.md](WHATS-NEW-v3.13.0.md) · `dev/master-profile.test.js` · `dev/mail.test.js`.

## ✨ v3.12.0 highlights — 🧍 Direct Agents & TLs (ek hi rule, poori site par)

- **Rule (configured, Settings → 🧍 Direct Agents):** GV direct = **TL ID + TL Name dono khaali** · FF direct = **TL Name APS**.
- **Ek hi classifier** poore app me: `FF.config.isDirectAgent(row, channel)` + `FF.direct` helpers — dispatch filters, TL dropdowns, TL rollups, ranking, search suggestions, network graph, war room, commission, certificates sab isi rule par.
- **GV Stock Report dispatch** me 🚫 **Direct Agents — alag list (no dispatch)** + TL/Dispatch filter me direct option; **FF Performance** me `🚫 Direct Agents · APS` filter; **Dispatch Planner** me alag direct pool.
- **Naya page** `#/directAgents` — dono channel ke direct agents ka roster (reason, stock, MTD issuance) + CSV + rule cards.
- Docs + tests: [WHATS-NEW-v3.12.0.md](WHATS-NEW-v3.12.0.md) · `dev/direct-agent.test.js` · smoke me v3.12 checks.

## ✨ v3.11.0 highlights — Master Search + Wow Zone 2.0 🔎

- **🔎 Master Search (har page par)** — topbar search bar + Home panel master search. Naam, TL naam,
  agent ID, TL ID, GV ID, barcode, tag ID — sab ek search me (dropdown suggestions input ke **neeche**,
  overlap nahi). Search karne par **poori kundli**: colourful profile cards + barcode/tag tables + CSV.
- **🧭 Executive Cockpit stock fix** — GV-parked StockDataa rows (master ID · "Apna Payment" naam ·
  GV channel TL) **teeno signals** se exclude — combined field stock ab sahi (double count khatam).
- **🔴 War Room detailed** — aaj + MTD ka VC4 / VC20 / VC5+ / chassis / replacement / wrong-VRN breakdown,
  TL-wise table, exact render timestamp.
- **👁 Live view instant** — ms-level `exact HH:MM:SS.mmm`, freshness dot, 0.5s–5s speed selector,
  live data clock (sheet load times + aaj ke tags).
- **🎉 Naye Wow pages** — 📅 Activity Calendar (GitHub-style heatmap + streak), 🕸️ Team Network
  (animated TL↔agent constellation), 🚨 Anomaly Radar, 🧾 Agent Report Cards (grades + auto remarks + print).
- **✨ Aur bhi** — 📈 KPI sparklines, 🟢 live tab heartbeat, 🎨 theme packs (Neon · Glass · 🪔 Diwali · Gold · Mono),
  🎖️ Level-Up Ceremony, 📅 "Aaj ka din" memories, 💬 chat me charts.
- Full notes: [WHATS-NEW-v3.11.0.md](WHATS-NEW-v3.11.0.md)

## ✨ v3.10.0 highlights — WOW ZONE 🎉

- **🎮 Agent Arena** — levels & XP, 11 badges, monthly challenges, badge-unlock par
  🎊 confetti + fanfare, badge gallery, medals leaderboard.
- **🔮 Crystal Ball** — month-end projection + confidence, record-watch agents.
- **🏆 Wall of Fame** — 6-month champion gallery + shareable **Winner Card PNG** (WhatsApp-ready).
- **🔴 War Room** — fullscreen live pulse: count-up counters, FF vs GV race, live ticker,
  🚨 lead-change celebration, 30s auto-refresh.
- **🌅 Morning auto-briefing** — din ke pehle login par assistant khud daily briefing sunata hai
  (voice: "briefing band/chalu karo").
- Full notes: [WHATS-NEW-v3.10.0.md](WHATS-NEW-v3.10.0.md)

## v3.9.0 highlights

- **🗄 Master Stock (naya page)** — barcode / agent / TL / GV name / GV TL search karo →
  StockDataa ↔ Tag Assignment ki total information; kitne Tag Assignment barcodes StockDataa me
  **missing** hain; overlap donut + class charts; ⏰ aged-stock alerts (30–60 / 60+ din).
- **🔗 Dual-channel ghost rule** — barcode double-mapped sirf tab jab FF holder Apna Payment
  (master 5845036) NA ho aur GV side not-assigned ke alawa asli ID ho.
- **🎯 GV dispatch** — dispatch plan + **Direct agents ki alag list** (GV Stock Report → Dispatch tab).
- **🌈 Clickable KPIs everywhere** — compare / charts / dispatch planner / TL scorecard / forecast /
  data quality: har KPI colorful gradient + click → full data dialog (search + CSV).
- **⚡ Commission pages instant open** + FF **Payout Excel** (gross / penalty / net, 5 sheets).
- **🎙 Voice navigation** — "master stock kholo", "open data quality" — 19 pages, permission-aware.
- Full notes: [WHATS-NEW-v3.9.0.md](WHATS-NEW-v3.9.0.md) · previous: [v3.8.2](WHATS-NEW-v3.8.2.md)

## Login & access

* Site **login ke bina nahi khulti**. Pehli baar server start hote hi ek admin ban jaata hai:
  * Render / env me `ADMIN_USER` + `ADMIN_PASSWORD` set ho → first setup par admin create hota hai; existing account/password restart par overwrite nahi hota.
  * Nahi to **`admin` / `admin123`** (pehle login par password badalne ko kaha jaayega — Settings → My account).
* **Login page**: animated split-screen design, "Login ho raha hai…" progress animation, remember-me
  (username yaad rehta hai), password show/hide, aur login ke baad **"Welcome back, <name>!"** splash animation.
* **Forgot password?**(login page) → 2-step flow: (1) request bhejo (admin ko WhatsApp/email shortcut bhi),
  (2) admin Settings → **Access matrix → Password reset requests** me se **6-digit code** generate karta hai
  (30 min valid) → user code + naya password daal ke reset kar leta hai. Email service ki zaroorat nahi.
* **Sign up** (login page par) → account "pending" banta hai → admin **Settings → Users & access** me
  Active tick karke **per-user, per-feature permissions** deta hai.
* **Per-item access, do jagah se:**
  * **Settings → 👥 Users & access** — har user ka card (role, permissions, reset password, delete).
  * **Settings → 🔐 Access matrix** — users × har permission ka ek hi grid (checkbox), per-user quick
    buttons **All / FF / GV / None**, aur ek click me sab non-admin users ke liye presets
    (All · sirf First Forward · sirf GV Partner · read-only), saath me **password reset requests** panel.
* **Settings → 🗂️ Sheets & tabs** — har sheet tab ka registry: **Show on/off** (untick = wo sheet poore app se
  hide, nav + sheets page + permission sab se hat jaata hai), label, sidebar group, spreadsheet (FF/GV), exact
  Google tab name, gid, description — aur naya tab add karne ka option. Har tab ka apna permission
  `sheet:<Tab id>` banta hai jo Access matrix me checkbox ban jaata hai.
* Top-right corner me user menu: **photo upload/change**, naam, email, role (👑 Admin / User), last login, aur **logout**.
* Sign up band karna ho: Settings → Thresholds → "Sign up allow karo" untick.

### 🌐 Employee link — Tag Request **bina login** (v3.27)

Poore dashboard ke liye login zaroori hai, **sirf ek cheez ke liye nahi**: employee tag-request form.

* Admin Tag Request page par **🔗 Employee link** button dabata hai → link milta hai **`https://<site>/tag-request`**.
  (Purana `#/tagRequest?public=1` bhi chalta hai.)
* Employee link kholta hai → **koi login, koi signup nahi** → upar **Employee name (mandatory)** likhna hai
  (mobile optional; branch/office optional — admin Settings se on/off) → agent search → class-wise qty →
  🔍 system check (stock / issuance / priority / suggestion) → 📤 submit.
* Request admin ke **🏷️ Tag Request → 📥 Tag Requests** me **🌐 employee link** badge ke saath aati hai —
  naam, mobile, IP, rows, agents, total ke saath. Admin wahin se qty/status edit karta hai.
* Employee apna **Request ID** (submit ke baad milta hai) daal ke **🔎 Status** tab se status dekh sakta hai
  (⏳ Pending → ✅ Approved → 🚚 Dispatched / ⛔ Rejected + admin note) — isi ke liye usko login ki zaroorat nahi.
* Employee ko **dashboard ka koi doosra page nahi dikhta** — public link par sirf yehi form khulta hai.
* Data usi sheet se aata hai, par server ke **scoped public endpoint** `/api/public/gviz` se — sirf
  form ke kaam ke tabs (EIR · REPORT · GV REPORT), EIR par **sirf aggregated (group-by) queries**,
  aur per-IP throttle. Baaki `/api/gviz` (poora dashboard data) pehle jaisa login-protected hai.
* Admin control (Tag Request page ka **🌐 Employee link** card): link **ON/OFF**, form title, upar ka
  message, mobile/branch field, aur "system check dikhao" toggle (OFF = form me sirf qty table).
* Spam protection: per-IP throttle (15 requests/hour), row limits, naamo ka validation. Har submit
  admin ko notification bhi bhejta hai.

### 📗 Tag requests → Google Sheet (kisi bhi sheet me, v3.27)

* Tag Request page (admin) → **📗 Google Sheet me direct entry** card: **alag sheet ka link** paste karo
  + **tab ka naam** → us sheet ke us tab me har request ki entry chali jaati hai (tab na ho to ban jaata hai;
  pehli entry par header row khud likhi jaati hai).
* Kaunsi rows jaayein (per class / per agent / per request), kaunse columns, aur kab (nayi request /
  status change) — sab wahin choose hota hai. **🔌 Sheet check karo** button bata deta hai ki entry usi
  sheet me ja rahi hai ya nahi (galat sheet me chup-chaap likhne se bachne ke liye).
* Zaroori: (1) us alag sheet par Apps Script wale Google account ka **Editor** access ho (Sheet → Share),
  (2) Apps Script me **naya `google-apps-script/Code.gs` (v3.27)** paste karke
  **Deploy → Manage deployments → Edit → New version** karo (isi me openById + `sheettest` action hai).
  Link khaali chhodo to purana behaviour — jis sheet me Apps Script hai usi me entry.
* Har request me bubble: 📗 entry ho gayi / 📗! fail (reason ke saath). Drawer me **📗 Sheet me push**
  se manual dobara bhej sakte ho.

Docs: [WHATS-NEW-v3.27.0.md](WHATS-NEW-v3.27.0.md) · feature ideas: [FEATURE-IDEAS.md](FEATURE-IDEAS.md)

## Pages

| Page | Kya dikhata hai |
| --- | --- |
| **Home** | Greeting + status, phir: **🟩 GV · Aaj ka live** (Aaj Total · VC4 · VC20 · VC5+ · Replacement · Chassis · **Expected Today** = pichhle 4 same-weekday ka average, pichhla mahina bhi), **📅 is mahine ke KPI cards** (Last day · MTD total · VC4 · VC20 · VC5+ · Replacement · Chassis · Expected in month — **har card me last month vs current ka % + FF/GV split**), **📈 charts** (current vs last month line, class bars, donut, same-weekday run-rate) aur **📦 stock** (FF · StockDataa + GV · Tag Assignment, class-wise bars + donuts + top holders). Master search Home par **nahi** — wo Management → 🔎 Master Search page hai. |
| **🔎 Master Search** (Management) | Koi list/box nahi — **naam / agent / TL / ID / mobile type karo → click → poora data usi page par**: ⚖ FF + GV combined (last month · current month · stock · class-wise, har number clickable → class → din → tag/barcode row) + per-channel full profile (KPI, charts, TL ke agents, Agent × Class) + 🟩 GV aaj snapshot (GV Master live). Ek se zyada match par sirf ek line ke naam-chips. |
| **Dashboard** | KPI cards + charts (daily line current vs last month, class mix, monthly by class, **VC4 vs Commercial** compare card (MTD vs last month same period), top TLs (APS excluded), top agents, stock by class/TL, tag status, weekday pattern…). |
| **Trend** | Daily / Weekly / Monthly / **Last vs Current** — dimension: Total, Class (VC4 / VC20 / VC5+), Type, Channel, VRN type. TL select + **agent/TL quick-find with dropdown suggestions**. |
| **Stock** | StockDataa: **search bar (agent-wise / TL-wise / class criteria, dropdown suggestions)**. Agent → pivot Class × Tag type; TL → pivot Agent × Class; Class → pivot TL. Har view me **VC4 vs Commercial** compare, **⬇ Excel** (Sheet 1 = Summary/pivot, Sheet 2 = us agent/TL ki saari raw StockDataa rows), CSV, WhatsApp / Email share. Overview me KPIs, TL × class matrix, agent table. |
| **Performance** | REPORT sheet: top **quick-find** (agent / TL naam → click → full profile drawer: VC4 vs Commercial, VC4 / VC20 / VC5+ last month vs current month, stock, 7-day chart, poora 78-column detail). **Shortcut chips**: Priority High / Medium / Low (agent, TL VC4, TL Commercial), Status, Activity. Overview, Agents, TLs (APS excluded), Alerts, Columns views. CSV / Excel export, WhatsApp / Email share (TL mobile REPORT se). |
| **GV Partner Dashboard** | GV Master + Tag Assignment + GV REPORT se: GV KPIs (MTD, VC4, Commercial, agents, stock days), GV daily line (current vs last month), class mix, **GV VC4 vs Commercial** MTD vs last month same period, monthly GV issuance by class / type / tag, top GV TLs & agents, GV stock by class + top TLs, weekday pattern, last-14-days table, dispatch/priority watch. |
| **GV Trend** | GV Master: Daily / Weekly / Monthly / **Last vs Current** (per-class same-period compare), dimension = Total / Class / Type / Status, TL filter + agent quick-find. |
| **GV Stock** | Tag Assignment: search (agent / TL / class), overview KPIs, TL × class matrix, agent table, class mix, aur agent/TL drill-down me raw rows ka **⬇ Excel** export. |
| **GV Performance** | GV REPORT: agent quick-find, agent profile drawer (VC4 vs Commercial, MTD vs last month, stock by class, priority, runrate/eRunrate), rankings & alerts, GV REPORT (A–AZ) column view, CSV/Excel + share. |
| **GV Commission Intelligence** | GV Master ka exact transaction amount, earned commission, commission/tag aur effective rate — agent, TL/direct, class, date aur Monday–Sunday breakdown; CSV/Excel/PDF. Current month me **Personal agent commission** table exact `Agent ID + class + rate` dikhata hai; VC4 default GV Master ke commission column se aata hai, aur Settings → Data source me VC4 / VC20 / VC5 / VC6 / VC7 / VC12 ke manual class rates set ho sakte hain. Saath me daily commission trend, TL-wise personal payout summary aur agent performance ranking (coverage/status ke saath) bhi available hai. |
| **FF Commission Intelligence** | REPORT headings se dynamically detected rate aur earned commission; Direct Agent / TL-managed / real sheet category split. Missing source par explicit mapping state — guessed payout kabhi nahi. |
| **Dual-channel Agents** | StockDataa barcode ↔ Tag Assignment serial aur REPORT `GV ID Found` ↔ GV unique ID se verified overlap; FF/GV issuance, stock, class mix aur separate/combined summary. Name-only join nahi. |
| **Stock Forecasting** | Live stock-out/replenishment projection; rolling 7/15/30-day forecast-accuracy backtests with WAPE/bias; and FF/GV stock-balance reconciliation: opening + exact movement ledger − predicted/actual consumption vs observed closing stock, with unexplained variance, source coverage and CSV/Excel/PDF. |
| **Data Quality Center** | Duplicate tags/barcodes, missing agent/TL, unassigned stock, invalid/stale dates and cross-sheet mismatches with samples and recommended correction. |
| **Executive Cockpit** | Combined management pulse: MTD/projected issuance, stock, reported earnings, 14-day channel trend and key operational exceptions. |
| **Saved Views / Report Studio / Notes** | Exact filter-route bookmarks and shareable links; scheduled daily HTML+CSV and weekly SMTP reports; export/PDF/WhatsApp controls; collaborative agent/TL note and follow-up timeline. |
| **⚖️ GV vs First Forward** | 12 head-to-head KPIs, insights list, daily issuance lines (FF vs GV), MTD class bars, head-to-head leader table, monthly bars, stock-by-class compare, aur dono taraf ke top agents (click → us brand ka performance page). |
| **Sidebar / Sheets** | Permission-safe accordion: ek waqt me Management, First Forward, GV Partner, Cross Channel ya Workspace section khulta hai; unrelated channel options hidden rehte hain. Registered sheet tabs apne channel ke andar hi dikhte hain. |
| **Settings** | Neeche dekho — sab kuch yahin se badlo. |

**Refresh policy:** koi dashboard auto-refresh nahi. Data site khulte hi ek baar poora preload hota hai (aggregates), phir
sirf **↻ button** ya browser reload par dobara aata hai. Preloaded dashboard options click karne par network call nahi;
exact custom-date reports, forecast-accuracy backtests aur raw-row Excel exports zarurat par on-demand query karte hain. Server bhi Google responses cache karta hai
(`cacheSeconds`, default 10 min) taaki page reload fast rahe; ↻ hamesha Google se fresh laata hai (permission "Force refresh").

**Comparison correction:** EIR me GV Partner ka `master ID 5845036` aata hai. **GV vs First Forward** page First Forward side se `5845036` (aur configured GV TL marker) ko pehle exclude karta hai, phir GV Master ke against compare karta hai — isliye GV double-count nahi hota. Admin Settings → Data source me ID/marker badal sakta hai.

**Forecast-accuracy methodology:** selected 7/15/30-day holdout se immediately pehle ke 14 ya 28 calendar days ka agent-wise daily run-rate historical prediction banta hai. Prediction ko subsequent exact EIR (First Forward) aur GV Master issuance/replacement se compare kiya jata hai. Headline accuracy `max(0, 100 − WAPE)` hai; bias positive ho to over-forecast aur negative ho to under-forecast. Stock transfers/inward movement ko consumption nahi maana jata, aur zero-history rows ko accurate score nahi diya jata.

**Stock-balance reconciliation:** server daily FF `StockDataa` aur GV `Tag Assignment` closing snapshots rakhta hai. Optional `Stock Movements` tab (Settings → Data source) me Date, Channel, Type, Quantity, Class, From, To, Reference aur Note map kiye ja sakte hain. Equation `opening + recorded net movement − consumption = closing` hai. `IN` positive, `OUT` negative, internal `TRANSFER` net zero aur `ADJUSTMENT` signed hota hai. Ledger absent ho to dashboard sirf **implied net movement/residual** dikhata hai—use actual inward label nahi karta.

**Notifications:** top-right 🔔 feed me non-admin user login/page-open, consented location share aur Google Sheet ke newest-day grouped report changes aate hain.

**📱 Mobile / OS notification panel (web push):** bell panel (top-right 🔔) me ab **sirf ek switch** hai — **🔔 Notifications ON/OFF**, uske neeche **📅 Monthly report ON/OFF**. Bas. ON karte hi browser permission maangi jaati hai aur web push subscription khud ban jaati hai — uske baad alerts **phone ke notification panel** me aate hain, **app band ho tab bhi** (Android Chrome / Edge / Samsung Internet; iOS 16.4+ par pehle "Add to Home Screen" se install karna zaroori hai). Login ke baad pehli click par permission **ek hi baar khud** maang li jaati hai, isliye koi button dhoondhna nahi padta. OFF karte hi subscription hat jaati hai aur koi toast / alert / sound nahi aata (feed ki list bell me padh sakte ho).

Baaki fine-tuning **Settings → 👤 My account → 🔔 Notifications** me chali gayi hai: sound / vibration, **🔊 Alert voice (app band ho tab bhi)**, monthly report, aur type-wise alerts (login, report update, signup, activity…). Admin ko wahan **📲 Push diagnostics** bhi dikhta hai — VAPID key source + durable, auth scheme, self-test result, registered devices, aakhri delivery/error, plus **📳 Panel test**, **🛰 Server push test**, **🔁 Force re-subscribe** aur **🔑 Public key copy** buttons.

**🔊 Voice — app band hone par bhi (v3.36):** har push me ek saaf "bolne wali" line jaati hai (`voice`), saath me `speak`, `user` aur unread `badge`. Push aate hi **text + sound + vibration turant** OS panel me aata hai (app band / phone locked ho tab bhi), aur wo line `ff-voice-v1` queue me rakhi jaati hai:
* **app khuli hai (chahe background tab)** → `sw.js` page ko `ff-speak-push` message bhejta hai → **turant bolti hai** (Office Bell ka unlock/voice/mute path),
* **app poora band tha** → app dobara khulte hi `pushVoice.js` wo line bol kar suna deta hai (12 ghante tak catch-up; "✅ Theek hai" action dabane par line queue se hat jaati hai),
* Web Speech API **service worker me nahi chalti** aur OS notification me custom awaaz nahi hoti — isliye app band halat me text+sound turant, awaaz app khulte hi. Autoplay block ho to job delete nahi hoti, pehle tap par boli jaati hai (chhota "tap karo" nudge ke saath).
* Sab switches respect hote hain: master · sound · 🎙 Office Bell voice · 🔇 mute · per-user **`voice`** pref (OFF karo to **text push phir bhi aata hai**, sirf awaaz band). `voice` pref server-side per-user save hota hai (`/api/notifications/prefs`).
* App icon par unread **badge** (`setAppBadge`, Chromium PWA).
* ⚠️ Render free plan par service ~15 min inactivity me sleep ho jaati hai — tab koi push/scheduled alert fire nahi hota. Free cron (cron-job.org / UptimeRobot) se `GET /api/version` har 10 min karwao, tab hi "app band" wale alerts aur daily digest apne time par nikalte rahenge.

Push health API: `GET /api/push/status` (apne devices, `lastOk` / `lastError`, `configError`, `selfTest`) aur `GET /api/health` → `push` (`scheme`, `subject`, `selfTest`, `durable`, `devices`, `ttl`, `warning`).

> 🔴 **"403 — permission denied: crypto-key header had no public application server key specified" ka permanent fix.** Push bhejte waqt server purana (draft-01) auth scheme use kar raha tha: `Authorization: WebPush <jwt>`. Is scheme me public application server key `Crypto-Key: p256ecdsa=<key>` header me bhejna **zaroori** hai — wo nahi bheja ja raha tha, isliye FCM (Android Chrome ke saare endpoints) har message 403 se reject kar deta tha. Aur 403 ko "dead subscription" maan kar server use delete kar deta tha → app "Permission mil gayi hai par push subscription active nahi" loop me phans jaati thi aur phone ka panel hamesha silent rehta tha. Ab:
> * Delivery **RFC 8292** scheme se hoti hai — `Authorization: vapid t=<jwt>, k=<public key>` (public key header me hi, Crypto-Key ki zaroorat nahi).
> * Koi push service sirf legacy scheme samajhti ho to **automatic fallback**: `WebPush <jwt>` + `Crypto-Key: p256ecdsa=<key>`. Jo scheme kaam kar jaati hai, server wahi yaad rakhta hai.
> * **401/403 par subscription tab hi drop hoti hai jab wo sach me kharab ho** (key mismatch / expired). Server-side config problem ho to subscription **barkaraar** rehti hai, `configError` record hota hai aur admin ko banner + diagnostics me dikhta hai — chup-chaap tootna band.
> * Har subscription ke saath wo **VAPID key save** hoti hai jis se wo bani thi; key rotate ho jaaye to purani subscriptions boot par hi hata di jaati hain (device app khulte hi re-subscribe kar leta hai).
> * Boot par **VAPID self-test** chalta hai (JWT sign → apni public key se verify, key 65-byte raw point, `sub` claim mailto/https) aur result `/api/health` me aata hai.
> * `sub` claim ab `mailto:admin@apnapayment.local` nahi — `VAPID_SUBJECT` env se set hota hai (default `mailto:admin@apnapayment.com`); FCM/Apple localhost-style subjects ko `403 BadJwtToken` dete hain.

> ⚠️ **VAPID keys hamesha durable rehni chahiye.** Browser subscription us `applicationServerKey` se bandhi hoti hai jis se wo bani thi — keypair badalte hi push service har message reject kar deta hai: in-app bell chalta rehta hai par **phone ka panel silent** ho jaata hai. Keys is order me resolve hoti hain: `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` env → durable store (`notify.vapid`, Apps Script / Sheets ke saath) → `DATA_DIR/vapid.json` → generate once + dono jagah save. Render par container disk har deploy/spin-down par mit jaati hai, isliye durable store zaroori hai; save fail ho to server har 60 second me retry karta hai aur `/api/health` + admin banner par warning dikhata hai. Sabse pakka tareeka: `npm run push:keys` chalao aur dono values Render → Environment me pin kar do (ek baar ka kaam). Client bhi self-heal karta hai: server ki key badli ho ya subscription drop hui ho to app khulte hi nayi subscription ban jaati hai. Server FF (GV ID excluded) aur GV ko har 5 minutes check karta hai; feed kholte waqt bhi check hota hai. Dashboard data khud auto-refresh nahi hota; notification aane par ↻ dabao.

**Location privacy:** location automatic/silent tracking nahi hai. User Settings → My account → “Share my location” par browser permission de to sirf latest coordinates/accuracy save hoti hai, aur admin Users & access me Maps link dekh sakta hai.

## Settings (admin)

| Tab | Kya badal sakte ho |
| --- | --- |
| My account | Naam, mobile, email, password, **profile photo upload/remove**; apna access dekho (sab users) |
| Branding & images | App name, sidebar brand, tagline, **logo upload**, **login page image upload**, login animation on/off, sidebar background colours (top/bottom gradient), sidebar text colour, accent colours (incl. GV teal) — live preview |
| Sheets & tabs | Har tab ka Show/Hide, label, group, spreadsheet (FF ya GV), **exact Google tab name**, gid, description + naya tab add karo (isi se permission `sheet:<id>` banta hai) |
| Access matrix | Users × permissions grid, quick presets (All / FF / GV / read-only), per-user All/FF/GV/None, **password reset requests** (code generate karo, reset karo, dismiss karo) |
| Data source | **First Forward sheet**: Sheet ID, EIR / StockDataa tab names, REPORT gid, EIR & StockDataa **column letters** · **GV Partner sheet**: GV Sheet ID, GV Master / Tag Assignment / GV REPORT tab names + gids, GV REPORT header row (4) aur last column (AZ) · excluded TL names (default `APS`) · server cache seconds |
| Thresholds | Stock-cover red/orange/amber days, inactive days, Top N, rows per page, sign-up on/off |
| Contacts & sharing | Team WhatsApp number, team email, WhatsApp group link, message signature |
| Users & access | Approve / role / per-feature permissions / reset password / delete / create user |
| Storage & backup | ☁️ Google Sheet storage wizard (permanent save), settings JSON export / import, clear cache, reset |

> ✅ **Easiest fix for "settings / users reset after deploy": [STORAGE_SETUP.md](STORAGE_SETUP.md)** —
> Settings → ☁️ Storage & backup wizard + Apps Script web app + 2 Render env vars
> (`APPS_SCRIPT_URL`, `APPS_SCRIPT_SECRET`). No service account or disk needed.
>
> **Production storage is required, not optional.** Render's application directory is ephemeral.
> The app now supports **encrypted storage in `APP_STORAGE` inside the SAME main Google Sheet**:
> see [same-sheet setup and migration](SHEETS_STORAGE.md). Set `STORAGE_BACKEND=sheets` only after
> private Google credentials, the permanent encryption key and the one-time migration are ready.
> This mode does not need a persistent disk for accounts/settings/sessions. Never put readable
> credentials in the public workbook; a hidden tab is not a security boundary.
>
> File mode remains the default for safe compatibility: use a paid persistent disk at `/data`
> and `DATA_DIR=/data` if keeping that mode. Environment admin credentials only bootstrap a
> missing account, not a backup. Settings JSON export does NOT include users or sessions.
> Back up existing records before any deployment or storage switch.

## Requirements

* Dono Google Sheets **"Anyone with the link can view"** hone chahiye.
* GV sheet: `1LkYX746lGZQKhl5ueoKe3kYOo4SNtu47p5-jkVNUiBA` (tabs: `GV Master`, `Tag Assignment`, `GV REPORT` gid `1284424234`).
* Node.js 18+ (Render par default 20).

## Local run

```bash
npm start                                # http://localhost:8080  (login admin / admin123)
ADMIN_USER=me ADMIN_PASSWORD=secret npm start
```

Bina internet ke test karna ho (synthetic data):

```bash
node dev/mock-gviz.js &                                    # fake Google gviz on :9099
GVIZ_BASE=http://localhost:9099 DATA_DIR=/tmp/ffdata npm start
node dev/smoke.js                                          # headless smoke test of every page
```

## Render par deploy

**Option A – Blueprint:** Render → *New +* → *Blueprint* → repo select karo (`render.yaml`) → `ADMIN_USER` / `ADMIN_PASSWORD` bharo → Apply.

**Option B – Manual:** Render → *New +* → *Web Service* → repo connect karo →

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build Command | *(blank)* — koi dependency nahi hai |
| Start Command | `npm start` |
| Instance type | Starter (persistent disk support; avoids free-service idle cold starts) |
| Disk mount | `/data` · 1 GB |
| Environment | `DATA_DIR=/data` |
| Health check path | `/api/health` |

For **same-sheet encrypted storage**, follow [SHEETS_STORAGE.md](SHEETS_STORAGE.md) instead of provisioning a new disk. Do not remove an existing disk before backing up and verifying migration.

### Environment variables

| Variable | Default | Kaam |
| --- | --- | --- |
| `APPS_SCRIPT_URL` | – | Apps Script web-app `/exec` URL → storage backend `appsscript` (see STORAGE_SETUP.md) |
| `APPS_SCRIPT_SECRET` | – | Same secret as in Code.gs (≥16 chars). Never change it after setup |
| `STORAGE_BACKEND` | `appsscript` if `APPS_SCRIPT_URL` set, else `files` | `sheets` = encrypted APP_STORAGE tab via service account |
| `STORAGE_SHEET_ID` | Main `SHEET_ID` | Pin to the existing main spreadsheet ID; set explicitly for migration |
| `GOOGLE_SERVICE_ACCOUNT_FILE` / `GOOGLE_SERVICE_ACCOUNT_JSON` | – | Server-only Google write credential; never in browser/settings/Git |
| `STORAGE_ENCRYPTION_KEY` | – | Permanent random 32-byte base64 secret; back it up privately |
| `PORT` | `8080` (Render khud set karta hai) | Server port |
| `ADMIN_USER` / `ADMIN_PASSWORD` | – | First-time bootstrap only; saved credentials win on restart. Na ho to `admin` / `admin123` |
| `DATA_DIR` | Local: `./data`; production: set `/data` | Users / sessions / settings JSON folder (persistent disk ho to wahan) |
| `SHEET_ID` | sheet ki current ID | Default Google Sheet ID (Settings me bhi badal sakte ho) |
| `CACHE_SECONDS` | `600` | Server cache default (Settings → Data source override karta hai) |
| `CACHE_MAX_MB` | `64` (min `8`) | gviz proxy cache ki memory cap (bytes par LRU; cap ke aadhe se bada akela body cache nahi hota) |
| `STOCK_AGE_PAGE_ROWS` / `STOCK_AGE_PAGE_WINDOW` | `25000` / `3` (max 6) | stock-ageing index ke gviz pages ka size / ek saath kitne pages |
| `STOCK_AGE_WAIT_MS` | `20000` | `/api/stock-age` itni der rukkar `pending` deta hai (build peeche chalta rehta hai) |
| `STOCK_AGE_ERROR_RETRY_MS` | `30000` | fail / adhuri stock-ageing build ke baad dobara koshish |
| `STOCK_AGE_WARM` | Render par on | boot ke 12 s baad stock-ageing index pehle se banao (`0` = band) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | – (auto, durable store me save) | Web-push keys ko explicitly pin karo. Set na karo to server khud banata hai aur **durable storage** (Apps Script / Sheets / `DATA_DIR`) me save karta hai |
| `PUSH_TTL_SECONDS` | `86400` | Push message kitni der tak retry-window me rahe (phone off/doze ho to drop na ho) |
| `VAPID_SUBJECT` | `mailto:admin@apnapayment.com` | VAPID JWT ka `sub` (contact) claim — `mailto:` ya `https:`. localhost/.local mat dena, FCM/Apple 403 dete hain |
| `PUSH_AUTH_SCHEME` | `vapid` | `vapid` = RFC 8292 (default, recommended) · `legacy` = `WebPush` + `Crypto-Key: p256ecdsa=`. Dono me automatic fallback hai |
| `FRAME_PROTECTION` | – | `1` = site ko kisi aur website ke iframe mein khulne se roko |
| `GVIZ_BASE` | `https://docs.google.com` | Sirf local testing (mock server). Production mein set mat karo |

## Files

* `server.js` – static files + `/api/gviz` proxy (cache) + auth/users/settings API (JSON store in `DATA_DIR`)
* `config.js` – defaults (sheets, column letters, thresholds); server settings run-time par merge hote hain
* `store.js` – ek baar preload hone wala data store (daily, agents, class-month, stock, REPORT)
* `auth.js` – login / signup screen, permissions, theme apply
* `dashboard.js` · `trend.js` · `stock.js` · `performance.js` · `sheets.js` · `settings.js` – pages
* `charts.js` (SVG charts) · `xlsx.js` (Excel writer, no deps) · `util.js` (helpers + suggestion dropdown)
* `dev/mock-gviz.js`, `dev/smoke.js` – offline test tooling

## Regression checks (v3.2)

- `npm run check` — server, service worker and all browser scripts.
- `npm test` — real server restart/session persistence, saved profiles/users/theme/password,
  failed disk-write rollback, corrupt-store protection, query deduplication, unbounded ranges,
  per-dataset readiness and parallel permission-aware preloading.
- `npm run smoke` — against a running local mock server (above): all page render paths,
  including **zero new gviz requests when opening all preloaded sheet tabs**.

Normal opens reuse the authenticated server cache. FF, GV and permitted sheet previews start
loading together; each page waits only for the datasets it needs. Large sheets preload count +
first 100 rows, not the entire lakh-row inventory. Small sheets also warm their full view.
Searches, later pages and previously unused filters still need their own queries. First uncached
loads depend on Google/network latency; loading a whole account's data cannot be instantaneous.
Manual refresh bypasses the server cache without blanking already displayed data.

### Same-sheet storage checks

`npm test` also verifies encrypted storage against a mock Google Sheets API, including a real
server restart with the entire ephemeral DATA_DIR removed, session/theme persistence,
authenticated encryption, chunking, API failure rollback and quota retries. No real Google
credentials are used by tests. `npm run storage:migrate` is an explicit, one-time command;
read SHEETS_STORAGE.md and supply secrets privately before using it.
