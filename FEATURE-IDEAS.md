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
