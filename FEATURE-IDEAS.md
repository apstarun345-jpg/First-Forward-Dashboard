# 🧭 Poori site ka analysis + kya-kya naya add ho sakta hai

> Ye document **v3.27** tak ki site padh kar banaya gaya hai (pages, server routes, sheets, storage,
> notifications, tag-request flow). Har idea ke saath likha hai: **kya**, **kaise** (is repo me kahan),
> **kitna kaam** (🟢 chhota · 🟡 medium · 🔴 bada) aur **fayda**.

---

## 1️⃣ Abhi site me kya-kya hai (inventory)

| Area | Jo already hai |
| --- | --- |
| **Auth & access** | Login / signup (approval), forgot-password (admin code), OTP 2FA (naye IP par email), per-user **permission matrix**, per-sheet access, session cookie, audit log, login history, device/IP tracking. |
| **FF pages** | Home, Dashboard, Trend, Performance, Stock, Stock Report, Commission Intelligence, Tag Issued, Range Report, Targets, Executive Cockpit, TV mode, Team map. |
| **GV pages** | GV Dashboard, GV Trend, GV Performance, GV Stock, GV Stock Report, GV Commission. |
| **Cross-channel** | GV vs FF compare, Charts, Dual-channel agents, Master stock reconciliation, Stock forecasting, Data Quality Center, Dispatch planner, TL scorecard, Direct agents, New agents & TL changes, FASTag Champions, Stock Radar. |
| **Wow zone** | Agent Arena, Wall of Fame, War Room, Activity calendar, Team network, Anomaly radar, Report cards, Hourly sprints. |
| **Workspace** | Saved views, Report studio (scheduled email/CSV/PDF), Notes & follow-ups, Notifications (in-app + web push + voice), Office bell, Live assist (consented voice/video), Personal read-only pages `/p/<token>`. |
| **Tag Request (v3.24–v3.27)** | Agent×class request form → system check (last/current issuance, stock, cover, growth, priority, suggested qty) → admin edit/approve/dispatch/reject → **Google Sheet sync** (any sheet) → **public employee link (bina login)** + status check. |
| **Data** | 2 Google Sheets (FF: EIR · StockDataa · REPORT; GV: GV Master · Tag Assignment · GV REPORT), server-side gviz cache + warm queries + perf diagnostics, all aggregation on Google. |
| **Storage** | Durable via Apps Script/Sheets (`APP_STORAGE` encrypted) ya files + optional persistent disk; settings/users/sessions/notifications sab persistent. |
| **Ops** | Health/diagnostics endpoints, push diagnostics, storage banners, `/api/perf`, service worker (offline shell + data cache), PWA install, i18n (English/हिंदी/Hinglish), dark mode, accessibility mode, focus mode. |

**Kamzoriyan / dhyan dene layak cheezein (abhi):**

1. Tag requests sirf **last 120–200** ke liye rakhi jaati hain (notify blob halka rakhne ke liye) — purani history nahi milti.
2. Rate limiting sirf memory me hai (server restart par reset), aur public link par captcha nahi.
3. Public link ka koi **expiry / per-employee token / geofence** nahi — link jiske paas hai wo bhej sakta hai.
4. Dispatch tracking **manual status** hai — "kitne tag actually gaye, kaunsa courier, kya proof" ka record nahi.
5. Google Sheet → app sync **poll/manual** hai (koi webhook nahi) — sheet me change karke app turant update nahi hoti.
6. Koi **audit trail of approvals** (kisne kab qty badli, kisne approve kiya) request drawer me timeline ke roop me nahi hai (notification me hai).

---

## 2️⃣ Tag Request + Employee flow (aapke sabse kareeb)

| # | Idea | Kya hoga | Kaise | Effort |
| --- | --- | --- | --- | --- |
| 1 | **QR code wala link** | Employee link ka QR — office/chart par chipka do, phone se scan → form khul jaata hai | Client par chhota QR generator (zero dependency, canvas), admin card me "🖼 QR download" | 🟢 |
| 2 | **Request print / PDF slip** | Submit ke baad employee ek slip print/save kar sake (naam, agent rows, ID) — ya admin ke liye **pick-list PDF** (TL-wise, box-wise) | `tagRequest.js` me `window.print()` ka print-CSS + dispatch planner ke print pattern ka reuse | 🟢 |
| 3 | **Duplicate request warning** | Same employee ne 24 ghante me same agent×class dobara bheja → "pehle se pending hai" warning + admin ko merge option | Submit se pehle client-side check (last requests API) + server par soft warning | 🟡 |
| 4 | **Approval timeline** | Request drawer me timeline: kisne kab banayi, qty kisne badli, kisne approve/dispatch kiya (pehle-baad values ke saath) | Request object me `timeline[]` (server already `updatedBy` rakhta hai) + drawer me chhoti list | 🟢 |
| 5 | **Dispatch tracking (v2)** | Approved → Dispatched ke beech: courier/transportar, docket number, dispatch date, kitne tag bheje, **proof photo/attachment** | Request object me `dispatch: { at, by, boxes, courier, docket, proof }` + drawer form; proof ko Apps Script/Drive ya base64 (size limit) | 🟡 |
| 6 | **Partial approval + reason** | Admin row-wise approve kam kar sake aur reason likhe; employee ko wahi dikhe | `rows[].approved` already editable; `rows[].adminReason` add + employee status page par dikhao | 🟢 |
| 7 | **Employee directory** | Naam ke bajaye **employee ID / mobile se auto-detect** (HR/employee master sheet se) — typo naam nahi | Ek naya tab (`Employees`) ya `FF.config` mapping; public form me ID se naam verify | 🟡 |
| 8 | **Employee ka apna mini dashboard** | Employee apna request history (ID, agents, status, kya dispatch hua) dekh sake — **mobile number + OTP** se, bina account | Public endpoint: mobile + 4-digit OTP (ya last 4 digits of mobile + name match) → uske requests | 🟡 |
| 9 | **Auto-escalation** | Request 24 ghante pending rahe to TL/admin ko reminder, 48h par TL ko CC | Server me interval job (already notification watcher pattern hai) | 🟢 |
| 10 | **WhatsApp par status** | Approve/dispatch hone par employee ke mobile par WhatsApp/SMS | WhatsApp Cloud API (ya Apps Script `MailApp` + SMS gateway) — env based, opt-in | 🔴 |
| 11 | **Public link ki security badhao** | Per-link token (`/tag-request?k=…`) + expiry + max submissions + admin revoke; optional "sirf office network" | Workspace config me `publicTagForm.tokens[]` + server validation | 🟡 |
| 12 | **Sheet sync audit** | Kis request ka kaunsa row kis sheet me gaya, ek "Sync log" panel | `row.sheetSync` ko history array banao + Tag Request page par chhota log card | 🟢 |

---

## 2.5️⃣ 🔥 Site ke asli data par based smart add-ons (issuance · stock · agents)

> Har idea ke saath likha hai wo **kaunse tab/column** se banega — isliye ye seedhe aapki sheets par
> lag sakta hai (EIR · StockDataa · REPORT · GV Master · Tag Assignment · GV REPORT · Stock Movements · Payout).

### 📈 A. Issuance (EIR `TAG_ID/VRN/TAG_CLASS/STATUS/ISSUE_DATE/AGENT_ID/TL_NAME/VRN_TYPE`, GV Master `unique_id/agent/supervisor/vrn/class`)

| # | Idea | Data se kaise | Effort |
| --- | --- | --- | --- |
| 51 | **VRN duplicate detector** — ek hi VRN par do tag issue (asli leakage) | EIR ka `VRN` (B) par group → count > 1 wale rows + agent/TL naam | 🟢 |
| 52 | **Issuance Pulse strip (Home)** — aaj ka issuance vs last 7 din ka same-time average + "kitne peeche ho" | EIR `ISSUE_DATE` (AA) hourly/daily bucket | 🟢 |
| 53 | **Naya vs repeat VRN ratio (agent-wise)** — asli naya business kisne laaya | EIR `VRN_TYPE` (BC) / pehli baar dikhne wala VRN | 🟡 |
| 54 | **Silent agent (3+ din issuance nahi)** — TL ki call list | EIR me agent ka last `ISSUE_DATE` → aaj se gap | 🟢 |
| 55 | **Class mix shift** — VC4:VC5:VC6 ka 3-mahine trend, stock planning ke liye | EIR `TAG_CLASS` (D) monthly group | 🟢 |
| 56 | **Issuance vs stock deduction mismatch** — issue hua par stock kam nahi hua (ya ulta) | EIR `TAG_ID` ↔ StockDataa `TAG_ID/BARCODE` daily diff | 🟡 |
| 57 | **TL activation %** — TL ke kitne % agents ne is mahine issue kiya | EIR `TL_NAME` (BA) distinct agents ÷ StockDataa me us TL ke agents | 🟢 |
| 58 | **Month-end projection per class** — "VC4 is mahine ~xxx hoga, last month se +/− y" | run-rate × bache din; last month EIR | 🟢 |
| 59 | **GV ↔ FF cross-issuance audit** — same VRN par GV ne bhi tag diya? | EIR ke `GV_ID/GV_NAME/GV_TL` (AW/AX/AZ) + GV Master | 🟡 |
| 60 | **Hour-of-day issuance heat** — sprint/visit timing optimize karne ke liye | EIR `ISSUE_DATE` time part | 🟢 |

### 📦 B. Stock (StockDataa `TAG_ID/BARCODE/TAG_CLASS/AGENT_ID/AGENT_ALLOCATED_AT/TL`, Tag Assignment `serial/status/agent/tl`, Stock Movements)

| # | Idea | Data se kaise | Effort |
| --- | --- | --- | --- |
| 61 | **Aged / dead stock (30-60-90 din)** — kis agent ke paas kitna purana tag pada hai | StockDataa `AGENT_ALLOCATED_AT` (J) → aaj se din | 🟢 |
| 62 | **Transfer suggestion** — high-issuance/low-stock agent ko dead stock wale se transfer | cover days (issuance ÷ stock) + aging ek saath | 🟢 |
| 63 | **Barcode traceability search** — ek barcode daalo → kahan hai, kisne kab liya, issue hua ya nahi | StockDataa `BARCODE` ↔ Tag Assignment `serial` ↔ EIR `TAG_ID` | 🟡 |
| 64 | **Daily stock reconciliation report (auto)** — expected vs actual, difference rows CSV + alert | teeno tabs ka daily diff (Data Quality center ka daily version) | 🟡 |
| 65 | **Network cover dashboard (TL × class)** — "kal kis TL ko kitne tag chahiye" | stock ÷ run-rate per TL/class (tagRequest ka full-network version) | 🟢 |
| 66 | **Box / weight dispatch plan** — tags-per-box (Settings me hai) se kis TL ke kitne box + pick list print | dispatch planner + approved requests merge | 🟡 |
| 67 | **Stock transfer ledger (app entry)** — agent↔agent, TL↔agent, office return + approval | naya `Stock Movements` tab me likho (mock me tab already hai) | 🟡 |
| 68 | **Missing tag detector** — issue hua, stock se ghata nahi, wapas bhi nahi aaya → 7 din baad list | EIR vs StockDataa vs Movement | 🟡 |
| 69 | **Reorder draft** — low cover + high priority agents ke liye ek click me tag request draft | cover days + tag request (v3.27 flow) | 🟢 |

### 👥 C. Agents / TL (REPORT per-agent issuance, GV REPORT, EIR `AGENT_ID/TL_ID/MASTER_ID`)

| # | Idea | Data se kaise | Effort |
| --- | --- | --- | --- |
| 70 | **Agent 360 card** — 12 mahine issuance, class/VRN mix, stock, cover, commission, requests, notes ek jagah | EIR + StockDataa + REPORT + tag requests | 🟡 |
| 71 | **Churn risk score** — trend gira + stock pada + request nahi → TL ki call list | EIR monthly trend + aging + request history | 🟡 |
| 72 | **New agent 30/60/90 din curve** — pehle 30 din me kaisa ramp-up, training need | EIR first `ISSUE_DATE` se cohort | 🟡 |
| 73 | **TL Scorecard v2** — activation %, avg issuance, dead-stock %, request response time, rank movement | EIR + StockDataa + tag requests | 🟢 |
| 74 | **Rank movement badges** — is mahine ka rank vs last month (+5 / −3) | REPORT/EIR monthly | 🟢 |
| 75 | **Auto-draft requests for silent-but-due agents** — priority High, stock low, request nahi aayi → list + one click | cover days + requests | 🟢 |
| 76 | **Duplicate agent ID / naam merge** — ek hi naam ke do ID, ya 30 din se 0 issuance | StockDataa `AGENT_NAME/ID` + EIR | 🟢 |
| 77 | **Commission slip per agent** — REPORT rate × issuance, `Payout` tab ka penalty bhi, PDF/WhatsApp | REPORT + `Payout` tab | 🟡 |
| 78 | **TL coaching pack** — TL ke underperformers + suggested action (call/visit/transfer) | EIR trend + aging + targets | 🟢 |

### 🧩 D. Roz ka kaam aasan

| # | Idea | Kaise | Effort |
| --- | --- | --- | --- |
| 79 | **"Aaj kya karna hai" action board** — pending requests, low cover, dead stock, mismatches, unapproved dispatch — sab ek list me, har item par jump link | sab tabs ka rules engine | 🟡 |
| 80 | **Sheet change webhook** — Google Sheet me entry hote hi app refresh + alert | Apps Script `onChange` → dashboard endpoint | 🟡 |
| 81 | **Daily 3-number digest** — aaj issuance · stock · 3 sabse bada alert (WhatsApp/email) | digest + alerts | 🟢 |

---

## 3️⃣ Stock, dispatch aur operations

| # | Idea | Kya hoga | Effort |
| --- | --- | --- | --- |
| 13 | **Dispatch planner me Tag Request merge** | Approved requests ko dispatch planner me le jao — agent × class ka required vs available stock, **box plan + weight** (tags per box), printable pick-list me "kis rack se kitne" | 🟡 |
| 14 | **Stock transfer / movement entry (app se)** | Field se wapas aaya stock, TL ↔ agent transfer — app me ek chhota form jo `Stock Movements` tab me likhe | 🟡 |
| 15 | **Stock aging + dead stock** | 30/60/90 din se zyada pade tag ka alert + "kaunse TL ke paas dead stock" list (kuch hissa already hai) | 🟢 |
| 16 | **Threshold alerts** | Per class min stock, per TL cover < 7 din, agent inactive — threshold Settings se set ho, alert me naam ke saath | 🟢 |
| 17 | **Reorder suggestion → auto request** | Low stock/priority agents ke liye ek click me **tag request draft** banao (admin ke naam se) | 🟢 |
| 18 | **Courier/transportar ka daily dispatch sheet** | Roz kitne boxes, kis TL/agent ko, kis docket se gaye — ek daily CSV/WhatsApp summary | 🟡 |
| 19 | **Return/replacement tracking** | Replacement/wrong VRN cases ka alag funnel (EIR me data already hai) — dispatch se link karo | 🟡 |

---

## 4️⃣ Performance, targets, commission

| # | Idea | Kya hoga | Effort |
| --- | --- | --- | --- |
| 20 | **Targets v2** | Target vs achievement ka **month-end projection** aur "kitna daily chahiye" (gap per day), TL-wise cascade | 🟢 |
| 21 | **Commission slip (agent-wise PDF)** | Har agent ka monthly commission slip (rate × tags, slab wise) — print/WhatsApp | 🟡 |
| 22 | **Incentive/slab simulator** | "Agar 200 tag aur kare to kitna commission" — interactive slider | 🟢 |
| 23 | **Agent scorecard auto-remarks** | Report card me AI-ish remarks ("stock kam, issuance strong, TL support chahiye") — rules-based | 🟢 |
| 24 | **TL coaching pack** | TL ke underperformers ka list + unke liye action list (call/visit), Notes se link | 🟡 |
| 25 | **Attendance/activity signal** | Last active days + issuance gap se "inactive agent" alerts (kuch hai) ko TL-wise score me daalo | 🟢 |

---

## 5️⃣ Alerts, WhatsApp, email

| # | Idea | Kya hoga | Effort |
| --- | --- | --- | --- |
| 26 | **WhatsApp Cloud API** | Official WhatsApp template messages: daily summary, tag request status, dispatch update, target reminder | 🔴 |
| 27 | **Digest customization** | Kis ko kis waqt kaunsi report — user-wise weekly schedule (server me `schedules` already hai) | 🟡 |
| 28 | **Email par Excel attachment** | Reports email me CSV ki jagah XLSX (mailer me attachment support hai) | 🟢 |
| 29 | **Sheet change webhook** | Google Sheet me change → app ko turant pata (Apps Script `onChange` trigger → dashboard endpoint) | 🟡 |
| 30 | **Escalation matrix** | Koi KPI red ho to kis ko alert jaye (TL → manager → owner) — Settings me matrix | 🟡 |

---

## 6️⃣ Admin, security, data quality

| # | Idea | Kya hoga | Effort |
| --- | --- | --- | --- |
| 31 | **Role-based presets** | "TL" role banao jo sirf apne TL ke agents/stock/target dekhe (abhi per-permission hai, per-TL scope nahi) | 🟡 |
| 32 | **Row-level scope** | User ko sirf uske TL/region ka data (server-side filter) | 🔴 |
| 33 | **2FA sabke liye** | OTP 2FA optional per user (abhi naye IP par automatic) — TOTP authenticator app support | 🟡 |
| 34 | **Session management UI** | Admin dekh sake kis user ke kaunse devices active hain, ek click me logout | 🟢 |
| 35 | **Data Quality v2** | Auto-fix suggestions (duplicate barcode merge, missing TL fill from REPORT), weekly DQ report | 🟡 |
| 36 | **Archive / retention** | Tag requests + notifications ka archive (Sheet me separate tab) — purani history permanently | 🟡 |
| 37 | **Soft-delete + restore** | Delete ki gayi request/settings ko 30 din tak wapas laana | 🟢 |
| 38 | **Audit log export + filters** | Audit log ka CSV + filter (user/action/date) | 🟢 |

---

## 7️⃣ Mobile, UI, UX

| # | Idea | Kya hoga | Effort |
| --- | --- | --- | --- |
| 39 | **Employee form offline draft** | Internet na ho to form draft save ho, online hone par submit (localStorage + SW) | 🟢 |
| 40 | **Photo se agent search** | Agent ke visiting card/board ka photo → naam/ID detect (OCR) — ya barcode scan | 🔴 |
| 41 | **Barcode/QR scan** | Phone camera se tag barcode scan → stock/agent detail turant | 🟡 |
| 42 | **Bottom sheet navigation** | Mobile par TL-wise quick actions (Home/Tag Request/Stock/Notifications) | 🟢 |
| 43 | **Voice input (Hindi)** | "Ramesh ko VC4 ke 20 tag" bol kar row bhar jaye (Web Speech API, already voice modules hain) | 🟡 |
| 44 | **Dark/light + theme packs v2** | Brand-wise (FF/GV) auto theme jab us channel ka page khule | 🟢 |
| 45 | **Print packs** | TL scorecard / request / dispatch pick-list / commission slip ka ek "Print Center" | 🟡 |

---

## 8️⃣ Analytics aur AI

| # | Idea | Kya hoga | Effort |
| --- | --- | --- | --- |
| 46 | **Forecast v2** | Class-wise + TL-wise demand forecast (moving average + seasonality), auto dispatch suggestion | 🟡 |
| 47 | **Anomaly explanations** | "Aaj VC5 40% kam hai — kyunki TL X ne 3 din se issue nahi kiya" (jump-to-detail links) | 🟡 |
| 48 | **Assistant upgrades** | Hindi/Hinglish sawaal-jawaab (kuch hai) + "export ye chart" + "ye report WhatsApp kar do" actions | 🟡 |
| 49 | **Custom KPI builder** | Admin apna KPI card banaye (formula: EIR/StockDataa columns se) | 🔴 |
| 50 | **Cohort / behaviour analysis** | Naye agent ka pehla 30-din curve, churn risk, TL ka onboarding quality | 🟡 |

---

## 9️⃣ Meri recommendation — is order me karo

1. **QR + Print slip** (#1, #2) — employee flow instantly professional lagne lagega, kaam bahut kam.
2. **Dispatch tracking v2 + timeline** (#5, #4) — Tag Request ka poora lifecycle ek jagah, admin ko proof/heeadcount.
3. **Public link security upgrade** (#11) — token + expiry, kyunki link ab bahar ja raha hai.
4. **Dispatch planner me request merge** (#13) — request → box plan → pick-list, ek hi jagah.
5. **Escalation + reminders** (#9, #30) — pending request ka khud pata chal jayega.
6. **WhatsApp Cloud API** (#26) — sabse bada UX jump (status/updates WhatsApp par), par setup time lagega.
7. **Employee mini dashboard** (#8) — employee khud apna status/history dekh lega, admin ke calls kam.
8. **Archive/retention** (#36) — 120 requests ki limit khatam, poore saal ka record.

---

## 🔟 Aap decide karo (in par jawab do, main bana dunga)

1. Employee link **fixed** rahe ya **per-TL/per-office alag link** (har link ka apna sheet/tab + apna intro)?
2. Tag request ke saath **dispatch tracking** chahiye (courier + docket + tag count + proof photo)?
3. Employee ko status **WhatsApp** par bhejna hai (Cloud API) ya app/web hi theek hai?
4. Sheet sync **turant** chahiye (webhook) ya abhi ka automatic-on-submit theek hai?
5. Tag requests ki **purani history** (1 saal) chahiye → archive tab banau?
6. Public form me **agent list** poora dikhe ya sirf employee ke TL ke agents (uska naam/TL se match karke)?

---

### Note — jo aaj hi ho sakta hai (koi naya setup nahi chahiye)

- QR code + print slip, timeline, partial approval + reason, duplicate warning, sync log,
  escalation reminder, stock aging alert, reorder → draft request, agent-wise commission slip,
  target gap-per-day, session management, audit CSV, offline draft, voice input — inme se koi bhi
  1-2 din ka kaam hai aur koi naya external service nahi chahiye. Bas batao kaunsa pehle karna hai. 🚀

---

## 1️⃣1️⃣ v3.35 ke baad — naye ideas (v3.34 shipped cheezein aur upar ki #1–81 exclude karke)

> Access-control ka kaam (v3.35) ho gaya — ab wo ideas jo uske baad naturally aage badhte hain.

| # | Idea | Kaise | Effort |
|---|---|---|---|
| 82 | ✅ **SHIPPED v3.35** — **👁 View-as-user (admin preview)** — admin kisi bhi user jaisa dashboard dekh sake (kaunse buttons/pages chhup hain) | Settings → Users → 👁 Preview; permission overlay + exit banner | ✅ |
| 83 | **Export watermark** — non-admin ke PDF/Excel me chhupa `username · timestamp` footer/ghost-text | pdf.js / xlsx writer me optional footer; leak trace banta hai | 🟢 |
| 84 | **Access-change history** — "Rahul ko kab export mila, kab gaya" user card me timeline | permission save par diff log (audit-log ka hi extension) + Users card me read-only list | 🟢 |
| 85 | **Agent-vs-agent side-by-side compare** — do agents ki MTD/growth/stock/ageing ek table me | summary page par "Compare" picker → naya drawer (channel-compare ka agent version) | 🟡 |
| 86 | **Pin favourite agents/TLs** — search bar ke upar apne 5-6 regular log hamesha chips me | localStorage me pinnned list; `topSuggestions` se pehle dikhao | 🟢 |
| 87 | **Stale-data indicator** — card/head par "⏱ 8 min purana" badge + auto-refresh interval option | `generatedAt`/store timestamp se age; 10-min par soft nudge (refresh perm wale ko auto) | 🟢 |
| 88 | **Bulk multi-select WhatsApp** — TL team table me checkboxes → ek WA message me sab agents ka snapshot | row selection state + team-pack jaisa combined text; share permission par gated | 🟡 |
| 89 | **Report QR code** — summary drawer/PDF me QR jo live report khol de (office me print ke liye) | QR gen (tiny inline ya CDN-free lib) → `#`-link wala canvas draw | 🟡 |
| 90 | **Role-aware home / landing** — user sirf uske permissions wale widgets dekhe, baaki placeholders | home.js render par `FF.auth.can()` filters; naye user ko uske hisaab ka dashboard | 🟢 |
| 91 | **Exports ki apni language** — report text/PDF/WhatsApp template Hindi/English toggle | reportText/reportHtml me 2 template dicts + user pref (i18n system ka extension) | 🟡 |

Quick-win jo abhi bina kisi naye service ke ho sakte hain: **83, 84, 86, 87, 90**.
