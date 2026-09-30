# What's New — v3.25.0

## 🔊 Chrome website sound fix (app me chal rahi thi, site par nahi)
- **Root cause:** `notifications.js` ka AudioContext pehli beep ke andar banta tha — jo hamesha
  background polling callback me aati hai (bina user gesture ke). Chrome autoplay policy me aisa
  context `suspended` paida hota hai aur bina gesture ke kabhi resume nahi hota. Installed PWA me
  gesture mil jaata tha, isliye app me awaaz aati thi; Chrome website par hamesha silent.
- **Fix (notifications.js + officeBell.js):**
  - AudioContext ab pehle click/keypress/touch ke **andar** banta + resume hota hai (`bindAudioUnlock`
    module load par hi lag jaata hai — login se pehle ka click bhi unlock kar deta hai).
  - Gesture se pehle aaye beeps **queue** me jaate hain aur unlock hote hi baj uthte hain.
  - Office Bell ka unlock ab notifications ke beep-context ko bhi usi gesture me unlock karta hai
    (dono alag AudioContext hain — ek ka unlock doosre ke liye kaafi nahi tha).
- **"Enable sound" popup ab baar-baar nahi aayega:**
  - Ek baar **Enable sound** dabaya → permanent flag, kabhi dobara popup nahi.
  - ✕ se dismiss → **24 ghante** tak koi popup nahi (pehle sirf 10 minute tha).
  - Is session me awaaz ek baar bhi aa chuki ho, ya sound/voice khud OFF kiya ho, ya tab background
    me ho → popup aata hi nahi.

## 🏷️ Tag Request — employees ke liye link + naya fast form
- **🔗 Employee link:** page header me naya button — link copy ya WhatsApp se bhejo. Employee link
  kholte hi seedha form par pahunchta hai (`#/tagRequest?view=form`). Login + `tagRequest`
  permission chahiye (admin: Settings → Users & Access → employee → "Management · Tag Request" ON).
- **Naam search → dropdown me agents + TL dono:**
  - Type karte hi matching **agents** (naam · ID · TL · FF/GV) aur **TLs** dono dikhte hain.
  - Agent chunte hi **ID + TL naam + channel** khud bhar jaata hai.
  - TL chunte hi dropdown us TL ke agents tak filter ho jaata hai — phir agent chuno.
  - Keyboard (↑ ↓ Enter Esc) + touch dono supported.
- **Class-wise qty boxes:** har agent row me saari 6 classes (VC4·VC5·VC6·VC7·VC12·VC16) ke aage
  blank box — jitni tags chahiye likho. **0 ya khaali = us class ki request nahi.** Koi chip
  toggle nahi, seedha number bharo.
- **Multiple agents ek saath:** ➕ Ek aur agent — ek hi request me kai agents ki class-wise demand.
- **Fast + responsive:** qty typing par re-render nahi (focus kabhi nahi tootta), agent select par
  sirf wahi row refresh hoti hai; mobile par class boxes 3/2 column grid me stack hote hain.
- **System check → submit:** 🔍 check sheet se stock/issuance/priority/cover nikaalta hai (sab
  editable), 📤 submit par admin ko notification + request milti hai — rows **TL-wise grouped**
  (TL naam ho to), warna agent-wise.
- **Admin drawer me grouping toggle:** TL-wise ↔ Agent-wise; ✏️ Edit se qty/status/note — sab waise hi.

## 📗 Google Sheet me direct entry (admin)
Tag Requests (admin) view me naya **📗 Google Sheet sync** card:
- **Tab naam** — sheet ke andar kaunsa tab (na ho to ban jaata hai; pehli entry par header row
  apne aap likhi jaati hai).
- **Sheet link** — reference ke liye + "↗ Sheet kholo" button.
- **Kaunsi rows:** har agent × class ki alag row (default) / har agent ki ek row / har request ki
  ek total row.
- **Kaunse columns:** 22 fields me se choose karo (Date, By, Agent, TL, Class, Stock, MTD, Priority,
  Approved, Remark, Status, Note…) — checkbox order hi column order.
- **Kab:** nayi request par aur/ya status change (approved/dispatched) par.
- Entries connected **Apps Script** wali sheet me SEEDHI padti hain (wahi setup jo Settings → Backup
  me hai: `APPS_SCRIPT_URL` + `APPS_SCRIPT_SECRET`). Sync fail ho to request kabhi nahi rukti —
  status badge (📗 / 📗!) dikha deta hai.
- Har request drawer me **📗 Sheet me push** — manual entry kabhi bhi.
- ⚠️ **Apps Script redeploy zaroori:** `google-apps-script/Code.gs` me naya `appendrows` action
  aaya hai — purana deployment sirf ping/read/write/mail jaanta hai. Extensions → Apps Script →
  naya Code.gs paste → Deploy → Manage deployments → Edit → **New version**.

## Baaki
- Version bumps: app shell `?v=48`, service worker cache `apnapayment-v54`, package `3.25.0`.
- Naye regression tests: `dev/tag-sheet-sync.test.js` (config → auto append → status append →
  manual push → row modes → sync OFF), mock Apps Script me `appendrows` support.
