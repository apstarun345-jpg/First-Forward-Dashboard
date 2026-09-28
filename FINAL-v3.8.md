# FINAL — First Forward Dashboard v3.8.0 ✅ LIVE

> Live: **https://first-forward-dashboard.onrender.com** · `/api/health` → `"version":"3.8.0"` (deploy ho gaya, PR #20 merged)
> Full Hinglish guide: `WHATS-NEW-v3.7.md` (neeche **v3.8.0 section**)

---

## Aapke chune hue 5 items — status: sab LIVE

| # | Item | Kahan milega | Kya karta hai |
|---|---|---|---|
| 1 | 🧾 **Payout-ready reconciliation** | `#/ffCommission` → “Payout reconciliation” card | Har agent ke liye **sheet earned** vs **rate × tags** vs **slab expected**, difference + status (`Ready`/`Review`/`Unresolved`) aur recommended figure ka source. Ek click: **Payout CSV**, **Payout Excel (4 sheets)**, **Google Sheets copy** (TSV paste). |
| 2 | 👤 **Agent 360 drawer** | Har agent naam par click (FF/GV commission, forecast, dual-channel, GV class boards) | FF+GV tags & commission, stock + class split, month-wise trend, GV class vs median, data-quality findings, cross-channel double-mapped tags, **blockers**, **Notes & follow-ups** (save ho jaate hain) + CSV / WhatsApp / copy-link. |
| 3 | 🚨 **Commission anomaly alerts** | `#/ffCommission` sabse upar | 9 rules: heading hi nahi mili · rate missing par issuance · earned 0 · sheet vs computed mismatch (5% / ₹50) · rate peer-median se 25%+ door · %-rate bina base · GV rate class-median se 40%+ door · GV commission 0 · stock-out se commission risk. Har alert me **Samples dekho** dialog, **Alerts CSV**, **WhatsApp summary**. Thresholds Settings me. |
| 5 | 🚚 **Auto Dispatch Planner** | `#/dispatchPlan` (naya page, sidebar “Cross Channel”) | Forecast urgent agents se box-wise plan: horizon 7/15/30, growth %, safety din, box size, channel filter. KPI cards (agents, boxes, critical, buffer, top need) + class split (VC4/VC20/VC5+) + **TL-wise printable pick-list** (warehouse ke liye print) + CSV / Excel / WhatsApp / **Log plan** (follow-up). |
| 6 | 🏅 **TL Scorecard** | `#/tlScorecard` (naya page) | Weighted score: target 30 · active agents 20 · commission completeness 20 · stock coverage 15 · data-quality 15 (jo component na ho wo weight se hat jaata hai). Grade `A+→D`, rank, top-3 medals, **Focus needed**, `Comm. %` column, Excel + CSV + WhatsApp. |

Saath me (v3.7 se, pehle se live-is-PR me): FF commission ka **row-2 header** aware resolver + self-check card + one-click range fix + fresh sync,
GV commission **VC4 / VC20 / VC5+** alag tables + per-class CSV, dual-channel agents (agent + TL + FF/GV tags + double-mapped barcode CSV),
Data Quality Center & Stock Forecasting ke colourful KPI cards + detail tables, cross-channel comparison ke verified joins.

---

## Verification (bina browser bhi pura check)

| Check | Result |
|---|---|
| `npm test` | **53 / 53 pass** (server auth, sheets, notifications, sync, workspace + naye settings keys) |
| `node dev/smoke.js` | **ALL OK** — 5 naye cockpit tests: payout math, alerts rule engine, Agent 360 drawer, dispatch box math (need → boxes → tags), TL scorecard sort/grade |
| `PAGE=… node dev/inspect.js` (20 pages) | Koi **render error nahi**. `ffCommission` 7 tables/164 rows/6 CSV · `gvCommission` 9/469/6 · `dualChannel` 12/63/3 · `dataQuality` 6/101/3 · `forecast` 7/189/2 · `dispatchPlan` 8/45/1 · `tlScorecard` 4/58/1 |
| Live health | `version 3.8.0`, storage durable+encrypted, push devices 2 |
| Permissions | Dono naye pages role-permission list + notification deep-links (CLIENT_PAGES) me jode gaye — admin on/off kar sakta hai |

---

## “Baki or dekh lena” — jo maine iss pass me badla / sudhaara

1. **Settings → naya section “🚨 Commission alerts & dispatch thresholds”** — alert outlier %, mismatch %, mismatch minimum ₹, tags/box, horizon, minimum need; saath me dono naye pages ke shortcut buttons. (Pehle ye sirf code me the, ab UI se badal sakte ho.)
2. **Server side clamping** — naye thresholds API se aate hi safe range me clamp hote hain (galat value se dashboard tootega nahi), aur non-number par 400 error. Workspace test me cover kiya.
3. **TL scorecard me `Comm. %` column** — pata chalta hai kis TL ke agents ki commission data adhoori hai (varna score bina wajah neeche lagta).
4. **Alert buttons ka poora wiring** — `Alerts CSV`, `WhatsApp summary`, aur har alert ka **Samples dekho** dialog (pehle sirf card render hota tha).
5. **Chrome/consistency** — dono naye pages baaki professional pages jaisa hi head + source chips + KPI strip + export row use karte hain (`FF.insights.ui` shared kit se), taaki koi bhi page “adhoora” na lage.
6. **Print CSS** — dispatch slips print par sahi page-break ke saath aate hain.
7. **Dev tooling** — `dev/inspect.js` (naya) har page headless render karke tone/tables/csv/bytes deta hai; smoke me 5 naye tests; version `3.8.0` + service-worker cache `apnapayment-v29`.
8. **Purane items dobara check** — FF commission 2-header detection (live layout), GV per-class tables, dual-channel joins, DQ findings, forecast sliders — sabhi pages me render + CSV buttons verify hue.

### Ek nazar daalne wali baat (candid)
FF commission live sheet par **exact letter** deploy ke baad hi confirm hoga — page ka **self-check card** us letter + populated values + range dikhata hai.
Agar wahan “heading nahi mili” dikhe to Settings me letter/heading naam set karna 10 second ka kaam hai (ya 🔄 fresh sync).
Payout reconciliation tabhi “Ready” bolta hai jab source pakka ho — warna ye **guess nahi karta**, `Unresolved` flag lagata hai.

---

## Aage kya add kar sakte hain — “bahut jyada useful” (impact ke hisaab se ranked)

| Pri | Feature | Kyun bahut useful | Effort |
|---|---|---|---|
| ⭐1 | **Payout approval workflow (lock → approve → paid)** | Reconciliation ke baad ek month ka payout **lock** karo, TL-wise approve/reject, “paid” mark karo — next month recon me pending dues apne aap carry forward. Finance sign-off ke liye monthly **Payout voucher PDF** + audit log. Ye money loop band kar deta hai. | Medium |
| ⭐2 | **Target & slab-gap planner** | Month-end “target ke liye roz kitne tags chahiye”, TL-wise run-rate needed, aur **slab upgrade gap** (“12 tags aur → agli slab, ₹X extra”) — field team ko roz ka actionable number mil jaata hai. | Small-Med |
| ⭐3 | **Stock aging + internal transfer suggestion** | Tag-wise aging buckets (0–30/31–60/61–90/90+) se **dead stock** aur near-expiry recall list; ek agent surplus (60+ din cover) aur doosra stock-out → pehle **internal transfer** suggest karo, phir naya dispatch. Direct paisa bachta hai. | Medium |
| ⭐4 | **Scheduled auto digests (push + email)** | Server me scheduler + Web-push already hai — subah “aaj kis-kis ko kitna dispatch”, shaam “target status”, Monday “TL scorecard”. Bina app kholne action shuru ho jaayega. | Small |
| ⭐5 | **Issuance pattern anomaly (fraud/mistake pakadna)** | Ek din me ek agent ko bulk tags, duplicate tag ID dono channel me, agent inactive + stock in hand, issuance vs activation gap — data-entry error aur misuse dono pakadta hai. | Medium |
| ⭐6 | **Tag activation / first-toll-use tracking** | Tags issue hue par use nahi hue = asli revenue leakage; isse commission clawback aur “issuance hi sab kuch nahi hai” wali sachchai dikhti hai. | Medium |
| 7 | **Agent self-service login (mobile)** | Agent khud apna stock, target, commission dekhe (OTP/mobile login) — TL ke phone calls kam, adoption zyada. | Medium-Large |
| 8 | **Two-way sheet sync** | Approve kiye dispatch/payout rows seedha Google Sheet me likho — double entry khatam, sheet hi single source of truth rehti hai. | Medium-Large |
| 9 | **Auto target suggestion** | 3-month run-rate + stock cover se agent-wise next-month target suggest (manual target setting ka kaam khatam). | Small |
| 10 | **Accounting export (Tally/Zoho) + webhook** | Payout file seedha accounting tool ko, monthly compliance PDF ke saath. | Medium |

Bolo kis par chalun — mera order: **1 → 4 → 2 → 3** (pehle payout approval + auto digests, kyunki dono seedha daily kaam bachate hain, phir planner + stock aging).
