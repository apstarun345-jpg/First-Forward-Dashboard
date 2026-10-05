# v3.50.0 — 🏷️ Tag Requests wapas lao + 🛡️ durable save + 🔔 notification check

**Problem:** employee link (`/tag-request`) se lagayi hui kuch tag requests admin ke **📥 Tag Requests**
list me nazar nahi aa rahin thi — baaki data theek tha.

## Kyun hua tha

Tag requests alag table me nahi, **`notify` record ke andar** (`db.notify.workspace.tagRequests`) save
hoti hain — isliye notifications ke saath hi durable rehti hain. Deploy/restart ke waqt kuch second ke
liye **do process saath chalte hain**. Purana process jo abhi bhi apna purana snapshot jaanta hai, agar
nayi requests ke baad likh de, to wo requests mit jaati thin (history me sirf **encrypted** copies
rehti hain, koi auto-merge nahi tha). Server restart/rollback par bhi wahi ho sakta tha.

## Ab kya hota hai

- **🛡️ Save se pehle merge:** `notify` save hone se pehle app check karti hai ki storage me is waqt
  kaun-kaun si requests hain. Jo is process ke paas nahi hain wo **ID-wise wapas merge** ho jaati hain
  — **kuch bhi delete nahi hota**. Nayi tag request create hone par, ya 3 minute me ek baar, ya jab
  process ke paas requests kam dikhein — teeno me ye check chalta hai. Doosre process ke aakhir me likhe
  hone ka pata history metadata (sasta call) se lagta hai, aur tab hi poora record padha jaata hai.
- **⏪ Wapas lao (naya, one-click):** **🏷️ Tag Request → 📥 Tag Requests → ⏪ Wapas lao** (ya
  **Settings → ☁️ Storage & backup → ⏪ Purana data wapas lao → 🏷️ Tag Requests recovery**).
  Do source check hote hain:
  1. **abhi ka storage record** (sabse fast — storage me requests zyada hain to seedha wahan se),
  2. **`APP_STORAGE_HISTORY` ki purani saves** (har save batati hai kitni requests missing hain,
     employee/agent/tags ke saath).
  Sirf missing requests judti hain; maujooda requests, unka status aur admin notes waisi hi rehti hain,
  aur dobara dabane par duplicate nahi banta.
- **🔔 Notification check (naya):** **📥 Tag Requests → 🔔 Notification check** ek click me batata hai
  nayi request par 🔔 feed + mobile push ban raha hai ya nahi — `tagRequest` route ki value, har admin
  ka master switch / “🏷️ Tag Request” preference / push device, last push error, VAPID self-test aur
  recent tag-request notifications.
- **Settings me route bhi aaya:** **Settings → 🔔 Notification audience** me ab **🏷️ Tag Request**
  row dikhti hai (pehle sirf code me thi — admin usse dekh hi nahi sakta tha). Route **OFF** ho to
  request save hoti thi par notification **bilkul nahi** banta tha; ab ye check panel me saaf likha
  aata hai.
- **Health:** admin ke `/api/health` me `tagRequestRecovery` summary (kitni missing, kaunsa source,
  kab check hua) — silent fail nahi.
- Users/settings wali purani-save restore aur “doosri sheet se data lao” dono ab **us save ke
  `notify` record se tag requests bhi merge** karti hain.

## Cache / version

- Deploy ke baad ek baar app reload kar lo (ya phone me app band khol ke) — **service worker cache
  `apnapayment-v106`** bump kiya gaya hai, aur lazy modules `?v=102` se aa rahe hain, isliye
  ⏪/🔔 wale naye buttons turant dikhenge.
- Poora guide: **[RECOVERY.md](RECOVERY.md)** → **1b. 🏷️ Tag Requests wapas lao**.

## Tests

- `dev/v350-tagreq-recover.test.js` — stale snapshot se gayab request ki recovery, do-process
  (deploy overlap) guard merge, notification route/check panel, cache-bust wiring.
- `dev/v332-features.test.js` — summary lazy-group wiring theek ki gayi.
