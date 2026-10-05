# WHAT'S NEW — v3.24.0 (🏷️ Tag Request form · notification par poora data · voice fix)

> 🎯 Is release me teen complaints fix hui + ek naya panel option:
> **"voice ab bilkul nahi aati"**, **"notification par click karne par data nahi dikhta"**,
> **"Tag Request ka form chahiye jisme system khud data check kare"** — aur site pehle jaisi fast.

## 🏷️ 1. Naya panel option — "Tag Request" (IDFC Agents Tag Request Form)

Panel → Management → **🏷️ Tag Request** (lazy page: pehla load halka hi rehta hai).

**Flow (bilkul waisa hi jaisa maanga gaya tha):**

1. **📝 Form bharo** — `IDFC Agents Tag Request Form`:
   - **Agent ID / Naam** (ID ya naam likho, system khud naam + TL + channel bhar deta hai),
   - **Tag Class** chips → **VC4 · VC5 · VC6 · VC7 · VC12 · VC16**,
   - ek hi agent ke **kai classes** + **kai agents** ek saath (➕ Ek aur agent / ✕ row hatao),
   - Qty optional (khaali chhodo to system suggestion lagata hai), + admin ke liye note.
2. **🔍 System check karo** — system khud Google Sheet ka data dekhta hai: har agent × class ke liye
   **last month + current month (MTD) issuance, stock, cover days, growth level, priority** aur
   **suggested dispatch qty** — do tareeke se: **stock ke baad (stock −)** aur **bina stock ghataye**.
   TL rollup bhi: **TL stock · TL issuance · TL priority · TL suggested qty**.
3. **✏️ Editable** — result table me **Approved qty** aur **remark** har row me badal sakte ho
   (total apne aap update hota hai; note bhi edit ho jaata hai).
4. **📤 Admin ko submit** — request admin ke paas chali jaati hai (notification ke saath) aur
   **📥 Tag Requests** tab me dikhti hai — status: pending / approved / dispatched / rejected.
5. **⬇ Excel · ⬇ CSV · 📋 Copy · 💬 WhatsApp · 🖨 Print** — sab result par.
6. **Admin edit** — admin request kholkar qty/remark badal sakta hai, status set karta hai,
   admin-note likh sakta hai (requester ko uske status ka notification chala jaata hai).

Data source me koi naya bhaari query nahi: page pehle se load hone wale datasets
(EIR class-month + REPORT + GV REPORT) se index banata hai, 60s cache ke saath — **speed par koi asar nahi**.

## 🔊 2. Voice announcement — "koi voice nahi aati" ka asli bug fix

**Bug:** office bell me `voiceOn` ek **getter (boolean)** hai, function nahi. Notification layer usse
`bell.voiceOn()` call kar raha tha → **`bell.voiceOn is not a function`** TypeError har alert par,
jisse poora alert pipeline (aur uske saath voice) beech me hi marr jaata tha — notification aati thi,
**awaaz kabhi nahi**. (Ye tab se chal raha tha jab se ye code add hua.)

**Fix:**
- `bellVoiceOn()` helper — getter / function / boolean, **teeno shapes** support karta hai
  (+ `FF.officeBell.isVoiceOn()`), aur voice ka poora kaam `try/catch` me — voice fail ho to
  notification/UI par koi asar nahi.
- **Server se aayi notification par bhi ab voice** (`speakServerItem`): report · alert · digest · request
  — pehle sirf toast hota tha. Guards: prefs ON, sound ON, bell voice ON, mute nahi, aur **dedupe**
  (75s me ek awaaz; data-update par 5 min) taaki bell aur sync notification ek hi khabar do baar na bolein.
- `lastSpokeAt` — sirf **asli announcement** par set hota hai (pehle koi bhi log entry, chahe silent
  ting ho, 75s tak voice ko daba deti thi).

## 📊 3. Notification par click → drawer me poora data (class-wise · chassis · replace · wrong VRN)

**Complaint:** "notification par click karne par data nahi dikhta tha" — kyunki office bell ke
notification me sirf ek page link tha, **koi number/breakdown nahi**.

**Ab har data-update notification ke saath:**
- **Class-wise snapshot** (pehle → ab → change) + **naye tags class-wise** (VC4 +5, VC5 +2 …),
- **🔎 Class × tag type table** — EIR ledger se: **Naye issue · Replace · Chassis · Wrong VRN · kitne agents**
  (aur "sabse zyada issue" karne wale agents),
- FF/GV channel-wise split + 🏆 top issuers,
- **➡️ Tag Issued page** ka deep link (wahi din filter ke saath).
- Bell panel me hi notification expand karne par bhi chhota class-wise table dikh jaata hai.

## 🔧 Version / cache

- App `3.24.0` · sw.js cache `apnapayment-v53` · assets `?v=47` (purana cache auto-bust — sabko fix milega).
- **Koi naya storage kind nahi** — Tag Requests `notify` kind ke andar save hoti hain, isliye
  **Apps Script / Sheets storage me kuch redeploy karne ki zaroorat nahi**; restart ke baad bhi bachi rehti hain.

## 🧪 Tests

- `dev/tag-request.test.js` (naya) — submit → admin feed notification (route + deep link) → admin edit
  (qty/status/total) → permissions (bina grant 403, user ko sirf apni requests) → **restart ke baad durability** → delete.
- `dev/office-bell.test.js` — class-wise counts (`countsToday`) + poll ke notification meta me
  snapshot/previous/delta (drawer data).
- `dev/data-update-alerts.test.js` — voiceOn **getter** bug lock, voice throw hone par bhi notification alive,
  class-wise meta source lock.
- `dev/smoke.js` — 🏷️ Tag Request page (form chips + system check + result editability + requests view + sidebar entry).
- **253/253 unit tests pass** · smoke me wahi 3 purane mock-data failures (is release se pehle bhi the).
