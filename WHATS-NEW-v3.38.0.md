# ✨ v3.38.0 — 📦 employee link par "sabhi ka stock" · 👁 Preview button FIX · 🔊 Mac voice FIX

> Theme: **jo cheez employee/admin ko sabse zyada chahiye — woh pehle screen par.**

---

## 📦 Tag Request → employee link (`/tag-request`): naam likhte hi sabka stock

**Pehle:** employee naam likh kar agent search karta tha, lekin **stock tab dikhta tha jab agent exactly
select ho jata** — poora agent list dekh ke "kiske paas kitna bacha hai" pata nahi chalta tha.

**Ab (v3.38):**

1. **🔍 Dropdown me hi stock** — agent/TL search karne par har item ke neeche:
   `📦 stock 93 · last 0 · MTD 0`
   (TL item par uske **saare agents ka total**). Naam likhte hi sabka stock + pichhle mahine + is
   mahine (MTD) saamne — employee link par bhi (koi login nahi).
2. **📦 "Sabhi agents ka stock · issuance" board** — employee card ke neeche ek collapsed section:
   * poora agent list (mock me 122 agents) — **🚗 VC4/VC20 · 🚚 VC5+ · total stock · last month · MTD · cover (din)**
   * 🔎 search (agent / ID / TL) + 🟦 First Forward / 🟩 GV chips with counts
   * footer me **grand total** row + "⬇ Aur dikhao" paging (40/step — mobile par fast)
   * **row par click → woh agent seedha form me jud jaata hai** (khaali block reuse / naya block)
   * Admin ise **⚙️ Link & Sheet → "📦 Sabhi agents ka stock board dikhao"** se OFF kar sakta hai
     (naya `showStock` public-form flag, default ON — server + browser dono taraf).
3. **Class hint + group summary** (v3.37 se) waise hi — zero values bhi dikhte hain.

## 📥 Tag Request → admin table: colourful totals + alignment

* Footer me ab **colourful total chips**: `2 rows` · `🏷️ 36 approved (agent ne 30 maanga)` ·
  `📦 stock 138` · `🎯 suggestion 29 after stock · 75 without stock deduction`.
* Ye chips **live data par update** hote hain (index/exact stock aane par `refreshMetrics()` unhe bhi
  refresh karta hai) — pehle snapshot ke 0-dikhte the.
* Table ka colourful header / zebra rows / 🚗🚚 alignment / GV-FF-Both filter / "After stock ·
  Without stock deduction" suggestion pair — sab jaise tha, waisa hi (tests se locked).

## 👁 Settings → Users → "👁 Preview" button — **CRITICAL FIX**

* **Bug:** click handler `u` (jo `usersCache.map((u) => …)` ka callback variable tha) ko use kar raha
  tha, lekin handler `forEach((card) => …)` ke andar tha → **`ReferenceError: u is not defined`** →
  button dabane par kuch nahi hota tha (console me error).
* **Fix:** card ke `data-user` username se `usersCache` se user record nikaalta hai; na mile to
  safe fallback + clear error toast. Sirf asli admin account se preview shuru hota hai (guard pehle
  jaisa).
* Verify (jsdom me asli app): click → hash `#/settings?tab=users` → `#/tagRequest` (user ka pehla
  allowed page), 👁 banner aata hai, sidebar sirf us user ke pages dikhata hai, **↩️ Exit preview** se
  wapas `#/home` + poora admin nav.

## 🔊 Voice alert — macOS Chrome fix

* **Root cause:** `speechSynthesis.cancel()` ke **turant baad** `speak()` ki gayi utterance Chrome
  (khaaskar macOS) me **chup-chaap gir jaati hai** — na `onstart`, na `onend`, na `onerror`. Isliye
  awaaz bilkul nahi aati (mobile Chrome par ye race aksar nahi dikhti → "Mac me hi nahi aa rahi").
* **Fix:** `cancel()` sirf tab jab pehle se kuch `speaking`/`pending` ho, aur `speak()` cancel ke
  **baad** (90 ms) hoti hai — Chrome ko cancel process karne ka mauka milta hai. Queue khaali ho to
  seedha speak (faltu delay nahi).
* **+** Boot par **voice list garam** (`warmVoices()`): `getVoices()` + `voiceschanged` listener —
  macOS/Safari me voices async aati hain, isliye pehli announce par voice pick fail nahi hota.
* Naya regression test: `dev/v338-mac-voice.test.js` — Chrome-jaisa fake synthesis (sync speak after
  cancel = drop) ke against lock kiya hai.

## 🩺 Verify

* `npm run check` — syntax ok
* `npm test` — **347 pass** (344 + 3 naye: `dev/v338-mac-voice.test.js`, 4 naye:
  `dev/v338-tag-stock-board.test.js`)
* Asli app ko jsdom me chalaye: public employee form (board + dropdown + pick), admin requests table
  (filter + suggestion + footer totals), Settings → Preview ON/OFF, FF + GV Agent/TL Summary
  (search 160–250 ms, download = PDF/Excel/CSV/Share — **JSON option nahi**).
