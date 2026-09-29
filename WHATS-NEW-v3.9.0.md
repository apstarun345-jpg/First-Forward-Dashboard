# 🎉 v3.9.0 — Master Stock, Smart Dual-channel & Clickable Everything

> Aapke saare requested changes ek saath — ghost-holder rule, GV dispatch direct-agent list,
> naya **Master Stock** page, instant commission pages, aur har cross-channel KPI ab colorful + clickable.

---

## 🗄️ NEW: Master Stock page (Cross Channel)

Sidebar → **Cross Channel → Master Stock**. Ek hi jagah par FF **StockDataa** + GV **Tag Assignment** ka poora register:

- **Universal search** — barcode / agent naam / TL naam / GV unique name / GV ID / GV TL — kuch bhi type karo:
  - Tag match → FF holder, GV holder, dono TL, class, status pill (**Matched / Owner alag / GV flow · Apna Payment / GV-only · StockDataa missing / FF-only**)
  - Person match → uske unique barcodes, class split, TL(s), last allocation
- **Reconciliation KPIs (colorful + clickable)**:
  - StockDataa unique barcodes · Tag Assignment unique serials · Matched in both
  - 🚨 **Tag Assignment NOT in StockDataa** — kitne GV barcodes StockDataa me missing hain (full list + CSV click par)
  - StockDataa only · ⚖️ Owner mismatch (ghost excluded) · Top GV-only holder
- **Charts**: barcode overlap donut, class-wise FF vs GV bars, GV-only tags ke top holders
- ⏰ **Aged stock alerts**: 30–60 din aur 60+ din se parked FF stock ki list (click → full barcode list)
- Class filter dropdown (All / VC4 / VC20 / VC5+)

## 🔗 Dual-channel: ghost-holder rule

Ab barcode **double-mapped TAB HI maana jaata hai** jab:

1. FF holder **Apna Payment / master ID 5845036 NAHI** hai, aur
2. GV side ke paas **not-assigned / blank ke alawa asli ID** hai.

Apna-Payment FF rows (GV channel ka parked stock) aur GV "not assigned" matches **ghost holders** hain —
normal channel flow, double count nahi. Page par count + exclude note dono dikhte hain.

## 🎯 GV stock dispatch — alag views

GV Stock Report → **Dispatch / Direct** tab ab do alag cards me hai:

- 📦 **GV Dispatch plan — stock chahiye**: sirf dispatch-worthy agents, suggested qty + total suggested
- 🚫 **Direct Agents — alag list**: Direct/APS agents ki separate table (stock, MTD, status "No dispatch required")

## 🌈 Cross-channel KPIs — colorful + clickable

Har cross-channel page ke KPI cards ab **gradient-colorful + click karo to full data dialog** (search + CSV andar):

| Page | Kya naya |
|---|---|
| ⚖️ GV vs FF (compare) | Saare 11 KPI clickable — month-wise FF vs GV tables, daily series, class stock, top agents, high-priority agents |
| 📊 Charts | Naya KPI strip (FF / GV / combined / avg-day / replacements / top GV agent) + click par daily table |
| 🚚 Dispatch Planner | 6 KPI clickable — plan rows, critical-only, TL groups |
| 🏅 TL Scorecard | 6 KPI clickable — sorted TL scorecard tables |
| 🔭 Stock Forecast | Field-stock detail + cover stats add hue |
| 🧪 Data Quality | Checks passed / Latest FF / Latest GV cards ab clickable with source health tables |

Tables pehle se colorful headers/pills ke saath hain; ab KPI → dialog → search → CSV ka full flow hai.

## ⚡ Commission Intelligence — instant open

- FF + GV commission pages click karte hi **header turant paint** hota hai (blank/hang nahi)
- FF commission analysis **cache** hota hai — doosri baar instant; fresh sync / data-clear par auto invalidate
- Dono data parallel load hote hain (report + payout rates)
- **⬇ Payout Excel** (FF commission): agent-wise gross / penalty / net expected, class-wise lines, penalties, payout rates, totals — 5-sheet workbook

## 🎙️ Voice navigation

Assistant ab pages khol sakta hai — bolo:
*"master stock kholo", "open data quality", "dispatch page kholo", "executive cockpit open karo"*…
19 pages supported · permission-check ke saath (jiska access nahi, use bataya jata hai).

---

### 🔧 Backend / admin

- New permission key `masterStock` (Access matrix me) — existing users ko **auto-migrate** (dualChannel parent se)
- Versions: app 3.9.0 · cache `apnapayment-v35` · assets `?v=31`
- Tests: **102/102** unit + smoke ALL OK (naye: Master Stock render+search, ghost-holder exclusion, clickable cross-channel KPIs, voice navigation)

### 📝 Abhi scope se bahar (external setup chahiye)

Real voice cloning / WhatsApp bot / offline wake word / regional TTS — inke liye third-party API keys ya native app chahiye;
TV leaderboard (`tv.js`) aur daily executive summary (**Report Studio** scheduled reports) already available hain.
