# FINAL — First Forward Dashboard v3.52.0 🔍📦📅📲

> Branch `arena/01a10aed-first-forward-dashboard` (base `1695ce0` = live v3.51.0)
> Docs: `WHATS-NEW-v3.52.0.md` (release note) · purana final: `FINAL-v3.51.md`

---

## 🎯 Aapki baatein → fixes

| # | Aapki baat | Wajah (root cause) | Ab kya hota hai |
|---|---|---|---|
| 1 | 🔍 Master Search me word type karte hi **suggest** kare | Input par sirf Enter handler tha, dropdown nahi | `U.suggest` dropdown — agent / TL / barcode, 2 akshar se; click/Enter → profile |
| 2 | 🔍 Search ke baad **boxes me kuch details nahi** | `performance.js` (FF REPORT reader) Master Search par **load hi nahi hota tha** → FF stock 0 / priority — / suggested 0 | lazy deps (`PROFILE_DEPS`, tagRequest group, WARM) + `ensurePerfModule()` self-heal → FF data poora. Plus profile ke neeche **naya KPI card per channel** (stock · MTD · last · priority · 🎯 suggested dono · growth) |
| 3 | 📅 Trend me **VC4 / VC20 / VC5+** | Chart single “Total tags” series tha | Stacked VC4 · VC20 · VC5+ + class-wise total chips (share %, avg/din, best din); header template bug fix |
| 4 | 📲 Employee link par agent/TL ka stock + issuance **boxes me, duplicate nahi** | TL panel: 🚗/🚚 KPI cells + class table + 2 footers = wahi number 3 baar; agent: 🚗/🚚/All rows + table | `personBoxesHtml()` — agent aur TL dono ke liye EK box-strip (Stock · Last · MTD · 🎯 Suggested · 🚦 Priority, har box me VC4 · VC20 · VC5+) + sirf EK class table; footer me total ek baar |
| 5 | 🔍 Agent ya TL search par boxes me **stock · issuance · priority · suggested** | #2 wala root cause + boxes the hi nahi | #2 ka KPI card — TL me own + agents, agent me apna + TL ke under; FF T−1 / GV live basis label ke saath |

Bonus: ⚡ FF “aaj ka snapshot” ab sirf 0 nahi — aakhri din + last 7 din (class-wise).

---

## ✅ Verification (sab chalakar dekha)

| Check | Result |
|---|---|
| `npm run check` | ✅ syntax ok |
| `node --test dev/*.test.js` | **469 pass / 477** — wahi **8 failures pehle se** (clean `HEAD` par bhi same 8: purane wiring/lazy cache-bust tests) — is release se unrelated |
| `dev/v352-master-search-kpis.test.js` (naya, 5 tests) | ✅ lazy deps + self-heal · suggest/KPI/trend wiring · TL panel (footer ek baar, self-row case) · agent boxes · version pins |
| `dev/smoke.js` (mock gviz) | 7 failures — **clean HEAD par bhi wahi 7** (mock data me xlsx/sprints/summary pages) — unrelated |
| jsdom harness `#/masterSearch?q=AMIT KUMAR` | FF card: Stock 44 (VC4 19 · VC20 6 · VC5+ 19), TL stock 688, MTD 3, last 16, priority High (cover 58.7 din), Sug VC4 0/8, Comm 0/4, All 0/12, growth −81% · GV card bhi poora |
| harness `#/masterSearch?q=SUNIL MATALE` (TL) | FF: TL total 688 (own 0 + agents 688), 9 agents, MTD 45, last 339, Sug 0/102 · 0/68 · 0/169 · GV: 327 … |
| harness typing `sunil` in `#msp-q` | 14 suggestions (TL FF/GV + agents with TL + stock) |
| harness trend typing `sunil` | 12 suggestions, trend card stable (RAHUL SHARMA) until pick |
| harness `/tag-request` → TL `SUNIL MATALE` | 5 boxes (688 / 339 / 45 · 11.3/din / 0·169 / High) + 1 class table + agents list, footer **ek** `= TL TOTAL (9 agents ka jod)` |
| harness `/tag-request` → agent `AMIT KUMAR` / `5846001` GV | boxes 44 / 16 / 3 (FF) · 58 / 11 / 1 (GV), ek class table, koi 🚗/🚚 duplicate rows nahi |
| HTTP | `/api/health` → `3.52.0`; `styles.css?v=106`, `config.js?v=104`, `lazy.js?v=103`, `masterSearch.js?v=104`, `performance.js?v=104` → 200 |

> Live site (`first-forward-dashboard.onrender.com`) par `/api/health` = **v3.51.0** (= base commit). Data endpoints login maangte hain, isliye live data sandbox se nahi padha ja saka — verification mock sheet (`dev/mock-gviz.js`) + jsdom par hui. Deploy ke baad ek baar reload (cache `apnapayment-v108`).

## 🔧 Files

`lazy.js` · `masterProfile.js` · `masterSearch.js` · `tagRequest.js` · `styles.css` · `index.html` · `sw.js` · `server.js` · `package.json` · `dev/v352-master-search-kpis.test.js` · test pins (`tag-request-ui`, `v351-tagreq-tl-courier`, `v350-tagreq-recover`, `pwa-mobile-shell`) · `WHATS-NEW-v3.52.0.md` · `FINAL-v3.52.md`
