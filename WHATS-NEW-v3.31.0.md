# 🎉 What's New — v3.31.0

> **Loader ab atka hua nahi dikhta · run rate bilkul sheet jaisa · jo number click karo, drawer me wahi
> data khulta hai · har drawer me stock ageing.**
> Run rate ka rule wahi hai jo aapki FF / GV Google Sheet use karti hai:
> **total issuance ÷ (aaj ki date − 1)**.

## 1) 🌀 Loaders — hamesha ghoomte hain, alag-alag style me

- **Problem kya tha:** Mac / Windows me *"Reduce motion"* ON ho to global CSS rule
  (`animation-duration .01ms`, `iteration 1`) har spinner ko pehle hi frame par rok deta tha — isliye
  click ke baad "buffering wala gol" ruka hua lagta tha.
- **Ab:** loaders, skeleton shimmer, busy buttons aur top progress bar **reduced-motion me bhi chalte
  hain** (ye zaroori feedback hai ki data aa raha hai). Sirf sajawat wali animations (welcome wave,
  page slide) band rehti hain. Animations sirf `transform` / `opacity` par chalti hain, isliye JS busy
  ho tab bhi smooth rehti hain.
- **6 styles:** Ring · Dots (uchhalte) · Bars (equalizer) · Pulse (radar) · FASTag scan · Orbit.
  Default **Mix** hai, yaani har loader par agla style.
- **♿ Accessibility panel → Loader style** picker, live preview ke saath. Pasand isi browser me yaad
  rehti hai.
- Page badalte hi upar ek patli **route progress bar** chalti hai, aur "Loading…" ke saath chalte dots
  dikhte hain, taaki click ke turant baad feedback mile.
- Bonus fix: ♿ panel ke **Large text / High contrast / Reduce motion** toggles ab sahi CSS class
  lagate hain. Pehle class ka naam galat tha, isliye ye toggles kaam nahi karte the.

## 2) 📐 Run rate + Stock Dispatch qty — Google Sheet jaisa

| Channel | Data | Run rate ka divisor | 1 Oct ko |
|---|---|---|---|
| 🟦 First Forward | T−1 (aaj ka data kal aata hai) | data date ka din = `DAY(TODAY()−1)` | September ÷ **30** |
| 🟩 GV Partner | live | `aaj − 1` din (kam se kam 1) | October ÷ **1** |

- Example (real FF REPORT, 1 Oct): APNA ka September total **14,739 ÷ 30 = 491.3 / din**, expected
  **491.3 × 31 = 15,230**. Ye sheet ke REPORT tab se bilkul match karta hai.
- **Mahine ki 1 tarikh wala bug fix:** pehle 1 tarikh ko FF ka current month khaali hota tha, isliye
  run rate 0 / galat month aata tha aur dispatch qty galat banti thi. Ab har channel apne **data month**
  se calculate hota hai.
- **Stock Dispatch:**
  - **With stock** = ⌈run rate × planning din − stock⌉ (minimum 0)
  - **Without stock** = ⌈run rate × planning din⌉
  - FF aur GV ka run rate alag-alag nikalta hai.
- Dispatch planner ke upar ek **formula bar** hai, jaise `🟦 FF September ÷ 30 din · 🟩 GV October ÷ 1 din`.
  Hover karne par wajah dikhti hai.
- Ye rule **har jagah ek hi helper** (`U.dataBasis` / `U.runRate` / `U.runRateDays`) se chalta hai:
  Dispatch planner, dispatch email, Tag Request metrics, Direct agents, GV pages, Stock radar,
  Master profile, Performance, Stock page aur server ka dispatch overlay.

## 3) 🎯 Jo number click karo — drawer me wahi data

- **"Last month" card** par click karne se ab last month ka hi data khulta hai. Pehle kabhi-kabhi aaj
  ya current month ka data khul jaata tha. Month card / title se samjha jaata hai (`Last month`,
  `Sep 2026`, …), aur har channel ka apna data month use hota hai (FF = T−1).
- Drawer ke upar ek **banner** hai: data kis period / channel / agent / stock filter ka hai, aur card
  ka number kya tha. Isse aap turant match check kar sakte ho.
- **Stock cards** (Total, 🚗 VC4, 🚚 Commercial, holders) wahi class / agent / TL filter ke saath
  exact tags aur holders list kholte hain.
- **List cards** (Agents, Need attention, High stock, Inactive, Direct, New / changed / removed agents,
  Targets, TL risk …) drawer me **wahi list** kholte hain jo card ne gini thi. Agent ya TL ki row par
  click karo to usi period ka scoped drawer khulta hai.
- **Projection cards** me formula line hai: `MTD ÷ din (aaj − 1) × month ke din = …`
- Home ke agent tiles, Dashboard (FF + GV dono), Range report (custom range) aur Targets — sab ke
  apne explicit drill specs hain.
- ⌨️ KPI cards par **Enter / Space** dabane se bhi drawer khulta hai.

## 4) 🧓 Stock ageing — har drawer me (FF + GV)

- Har drawer me apne aap **🧓 Stock ageing** section aata hai: agent, TL, stock card, KPI drawer,
  dispatch, cockpit, sprints, stock radar, master profile aur GV pages.
  - **1 / 3 / 5 / 6+ mahine** purana stock kitna hai
  - 🚗 VC4 + VC20 alag, 🚚 VC5+ alag
  - age-mix bar
  - ⬇ **CSV** (dated tags ki list)
- 🟦 **FF:** StockDataa ki allocation date (`DD-MM-YYYY`) se.
  🟩 **GV:** Tag Assignment ke tags ko StockDataa me tag / barcode se match karke unki date li jaati hai.
- Jin tags ki date nahi milti, wo **"unknown"** me gine jaate hain, isliye total hamesha stock se match
  karta hai.
- Form wale ya loading drawers me ageing nahi aata. Jis drawer me pehle se ageing hai, wahan dobara
  nahi aata.
- Server: naya module **`stock-age.js`** aur do APIs (login zaroori):
  - `GET /api/stock-age` — summary (10 min cache, `?fresh=1` se turant refresh)
  - `GET /api/stock-age/tags` — filter ke hisaab se dated tags (CSV ke liye)
  - `stock-age.js` server-only module hai, isliye browser URL se nahi khulta (`BLOCKED_FILES`)

## 5) 🛠️ Fixes

- 🔗 **Agent personal link (`/p/…`) par 500 error** aata tha, kyunki `personalAgentTl()` call ho raha
  tha par define nahi tha. Ab ye function add ho gaya hai.
- Stock page (FF) ab sirf FF rows aur FF basis use karta hai.
- GV EIR summary me live agents bhi shamil hain, aur GV pages ka MTD live rows se aata hai.
- Cache bump: assets `?v=55`, service worker `apnapayment-v62`. Purana cache apne aap hat jaata hai.

---

**Tests:**
- `dev/stock-age.test.js` — ageing index, FF / GV match, unknown, tags
- `dev/v331-runrate-drill.test.js` — sheet jaisa run rate, 1 tarikh, last-month drill
- `dev/t1-basis.test.js` — rewrite kiya, ab T−1 / month-aware hai
- `dev/features.test.js`, `dev/wow.test.js` aur `dev/smoke.js` — 1 tarikh / T−1 aware kiye
- Mock sheet (`dev/mock-gviz.js`) ab real sheet jaisi hai: FF T−1, `DD-MM-YYYY` dates, GV tags StockDataa me
