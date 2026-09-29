# 🎉 What's new — v3.18.0

**Multiple selection · Office Bell voice FIX · full-circle profile photos · app/PWA view fixes**

---

## 1. 🔠 Multiple selection (ek saath kai values)

Pehle har filter me sirf **ek** value chun sakte the. Ab **kai** values ek saath chun sakte ho —
khaali selection ka matlab "All" hota hai.

### 🚚 Dispatch Planner
| Filter | Ab kya kar sakte ho |
|---|---|
| **Channel** | 🟦 First Forward **+** 🟩 GV Partner dono ek saath |
| **Type** | TL-managed **+** Direct agents |
| **Priority** | 🔴 High **+** 🟠 Medium ek saath (ya + 🟢 Low / 📄 Other) |
| **Need** | 🚚 Dispatch chahiye **+** 🚨 Cover < 7 din **+** 0 stock |
| **Tags** | All tags / VC4 / Commercial (single — formula badalta hai) |

- Har pill par **count** dikhta hai aur selected pills `aria-pressed` ke saath highlight hote hain.
- `+N selected` badge batata hai ki kitni values ON hain.
- **"All"** pill poora filter clear kar deta hai.
- **👥 TL button** → searchable multi-select popover: ek saath 3–4 TL chuno.
- Filters **localStorage me save** hote hain — page band karke wapas aao, wahi filters milenge.
- URL / assistant params bhi multi accept karte hain: `#/dispatchPlan?ch=ff,gv&prio=High,Medium`

### ✅ Row multi-select + bulk actions
Table me har row par **☑ checkbox** aur header par **select-all**:

- `☑ Visible select` — jo dikh rahe hain sab
- `🚚 Jinko dispatch chahiye` — ek click me sirf needy rows
- `⬇ CSV` / `⬇ Excel` / `📲 WhatsApp` — **sirf selected rows** ka export
- `🧾 Summary` — selected rows ka combined drawer: channel-wise, type-wise, dispatch list aur **≈ kitne box** banenge
- Sticky selection bar me live total: Required · WITH stock · W/O stock

### 🏆 Performance
**TL filter** ab multi-select hai — kai TL (aur 🚫 Direct Agents) ek saath compare karo.

### 📧 Dispatch email schedule
Admin ab schedule me **kai channel** (`ff,gv`) aur **kai priority** (`High,Medium`) select kar sakta hai.
Server validation back-compatible hai: purane `'all' / 'ff' / 'High'` values waise hi chalte hain.

### Reusable component
`FF.util.multiSelect(button, opts)` — body-portalled checkbox popover (search, Select all / Clear,
count badges, keyboard `Esc`). Kisi bhi page par 6 line me lag jaata hai.
Saath me `FF.util.asValueSet()` aur `FF.util.valueSetLabel()`.

---

## 2. 🔊 Voice notification FIX — naye tags ab bol kar sunayi denge

**Problem:** Chrome / Edge ki **autoplay policy** bina user gesture ke `speechSynthesis.speak()`
ko `not-allowed` error deti hai. Office Bell background me poll karta hai, isliye awaaz
**chup-chaap fail** ho jaati thi — bell on tha, tags aa rahe the, par awaaz kabhi nahi aayi.

**Ab:**
1. **Auto unlock** — pehle click / tap / keypress par `AudioContext.resume()` + ek silent utterance.
   Uske baad background me bolna allowed hai.
2. **Queue, drop nahi** — unlock se pehle aayi khabar queue me jaati hai aur unlock hote hi boli jaati hai.
3. **Fail hone par pata chalta hai** — speak fail ho to WebAudio **ting** bajta hai **aur** ek
   `🔊 Enable sound` nudge dikhta hai (10 minute me ek baar). Ab silent failure nahi.
4. **Background tab** — tab hidden ho to bhi poll chalta hai; awaaz tab visible hote hi nikalti hai.
5. **Diagnostics** — `FF.officeBell.unlocked` aur `FF.officeBell.lastError` se exact reason milta hai.

### 🔊 Naya options menu (topbar 🔊 par click)
- 🎙️ Voice announcer on/off · 🔔 Ting on/off
- 🟦 FF tags / 🟩 GV tags alag-alag band karo
- 🏷️ **Kam se kam kitne tags par bolo** (1 / 2 / 5 / 10 / 25) — chhote bursts par chup
- **🔊 Test voice** — turant check karo ki awaaz aa rahi hai ya nahi
- **🔕 Mute 30 min** — meeting ke time
- **↻ Check now** — baseline reset
- **🕘 Aaj ki khabar** — aaj ke saare announcements ka log (time, FF/GV split, top agents)

Sab kuch **Settings → 🔊 Sound & voice** me bhi hai (test + mute + log + poora explanation).

---

## 3. 🟣 Profile photo — poora circle

Har jagah avatar ab **full circle** (`border-radius: 50%`) hai — pehle kuch jagah rounded-square tha:
`.av.lg` (16px), user menu (22px), home hero (22px), settings preview (24px), master search (13px),
user card (16px). Sab `--avatar-radius: 50%` se chalte hain, isliye aage ek hi line se badal sakte ho.
Photo `object-fit: cover` se centre-crop hoti hai — stretch nahi hoti.

---

## 4. 📱 App / PWA view fixes

- **`.top` → `.topbar` bug fix** — PWA media query ek aise class ko target kar rahi thi jo exist
  hi nahi karti, isliye iPhone/Android par **safe-area padding kabhi apply nahi hoti thi**
  (notch/status bar ke neeche header chhup jaata tha).
- **Topbar overflow fix** — 10 buttons phone ki ek line me fit nahi hote the. Ab topbar wrap karta hai
  aur ≤1000px par kam zaroori buttons (🌐 language, 🌙 theme, ☆ save view, 🔍 search) ek **"⋯" more**
  menu me chale jaate hain. Zaroori buttons (↻ refresh, 🔔, 🔊, notifications, profile) hamesha dikhte hain.
- **Safe-area insets** — topbar, main, drawer aur assistant FAB ab `env(safe-area-inset-*)` respect karte hain.
- **No horizontal scroll** — `html, body { overflow-x: hidden }` + topbar/title `min-width: 0`.
- Service worker cache `apnapayment-v45`, assets `?v=39` — purana cache khud clear ho jaayega.

---

## 🧪 Verification

```
npm run check     → syntax ok (server + 46 browser modules)
npm test          → 186 tests pass  (pehle 165 the, +21 naye)
node dev/smoke.js → ALL OK          (poora headless app + har page render)
```

Naye tests:
- `dev/multiselect.test.js` (12) — `asValueSet` / `valueSetLabel`, multi channel+priority+TL filters,
  back-compat single strings, chips `aria-pressed`, table column counts, row picks, filter persistence
- `dev/voice-unlock.test.js` (6) — blocked speak → `false` + `lastError`, unlock ke baad success,
  hidden-tab queue → flush, prefs defaults, announcement log
- `dev/dispatch-email.test.js` (+3) — multi channel/priority normalization, filtered rows, email labels
