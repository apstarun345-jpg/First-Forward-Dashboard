# WHAT'S NEW — v3.23.0 (Final fix: panel clicks · instant sheet sync · data-update voice · Meri awaaz)

> 🎯 Is release me 5 badi complaints fix hui — "panel ke option click par nahi khulte",
> "data update ki notification nahi aati", "sheet ka data instant update nahi hota",
> "data update aate hi voice se batao" aur "'Meri awaaz' wala function kaam nahi karta".

## 🧭 1. Panel ke options ab HAMESHA khulte hain — pehle click par hi (CRITICAL FIX)

**Bug:** `parseHash()` har lazy page (Settings, War Room, Executive Cockpit, GV pages, Commission…
— 40+ pages) ko uska module load hone se **pehle** chup-chaap **Home par redirect** kar deta tha.
Module background warm hone tak click kaam hi nahi karta tha, aur uske baad **same link dobara
click karne par hash same hone se kuch hota hi nahi tha** — "click karne par khulta hi nahi".

**Fix:**
- Page id ab app ke **PAGES registry** se resolve hota hai (module load hone se pehle bhi valid) —
  lazy module `FF.lazy.ensure()` aage se load ho jaata hai.
- **Hover/tap par prefetch**: nav link par mouse le jaate ya tap karte hi us page ka module download
  shuru — pehla click bina ruke khulta hai.
- **Same-page link dobara click** → page refresh (pehle dead click hota tha).

## 📊 2. "Data update ki notification" — ab har jagah

- **🔔 Client-side alerts (naya):** office bell har 30s me sheet check karta hai — naya data aate hi
  bell notification + toast + (tab background ho to) phone/desktop panel. 60s me merge = spam nahi.
- **📲 Server watcher fast:** report-update watcher ab **2.5 min** me check karta hai (pehle 5 min)
  aur **corrections** (class-wise badlaav, total same) par bhi notification aata hai.
- **👥 Admin + users dono** ko data-update notification (route `reportUpdate: 'both'`) — Settings →
  Notifications me band kar sakte ho.
- **🔗 Deep link:** notification par click → seedha `#/tagIssued` page.

## ⚡ 3. Google Sheet ka data ab "instant" update

- **Auto light-sync 5 min** (pehle 15 min) — daily + REPORT + GV Master + aaj ka feed.
- **Office bell ko naye tags dikhte hi** turant light sync + current page re-render (throttled 2.5 min).
- **Tab wapas kholte hi** turant sync (agar data 90s se purana ho).
- Manual ↻ bhi ab change-detect karta hai.

## 🔊 4. "Data update aate hi voice se batao"

- Naya data detect hote hi (office bell 30s poll ya 5-min sync) — **voice announcement**: *"Data
  update! Aaj ke 1,352 tags ho gaye — +45 naye."* (Hinglish/English, aapki language setting ke hisaab se)
- Office Bell ka per-agent announcer waisa hi ("Rahul ne 5 naye tags issue kiye") — dono me **dedupe**
  (double awaaz nahi). Bell voice OFF/muted ho to sirf notification aata hai.
- 🔊 button (topbar) → options: voice on/off · min tags · FF/GV · mute · test.

## 🎤 5. "Meri awaaz" — RECORD FLOW FIX (Voice Studio)

**Bug:** Stop dabane par recording ka handle (jisme audio hota hi nahi tha) analyze ko jaata tha —
`startVoiceCapture()` ka `stop()` kabhi call hi nahi hota tha. Isliye **"Meri awaaz" record
hamesha fail** hota tha ("Recording ka audio data nahi mila") aur mic indicator bhi jalata rehta tha.

**Fix:**
- Stop par `handle.stop()` se **asli audio (blob + raw PCM)** liya jaata hai, phir pitch/speed/tone
  analyze hoke profile lagti hai.
- Dialog band karte hi active recording ruk jaati hai (mic privacy fix).
- `U.analyzeVoiceCapture` ab handle ya result — dono accept karta hai (defensive).
- Chrome ki async voices list load hone par dropdown khud bharta hai (pehle sirf "Auto" dikhta tha).

## 🧪 Tests — 247 pass (19 naye)

- `dev/panel-nav.test.js` — parseHash/resolvePage lazy-page fix, aliases, prefetch/same-link source
  locks, checkFeedChange (baseline chup → change par alert + voice text), analyzeVoiceCapture handle fix.
- `dev/data-update-alerts.test.js` — localAlert (item/unread/toast/dedupe/prefs/voice routing/queue),
  officeBell hook, server watcher (route 'both', deep link, corrections, 2.5-min throttle).

## 🔧 Version

- `3.23.0` · sw.js cache `apnapayment-v52` · assets `?v=46` (purana cache auto-bust — sab ko fix milega).
