# What's new — v3.8.2 🧭🎙👂

## 🧭 Executive Cockpit — colourful clickable cards + field stock fix

**Stock fix (double-count hatao).** FF StockDataa me GV master ID **5845036** wali rows
asal me GV channel ka stock hai — wo GV Partner ke **Tag Assignment** me GV agents ke paas
alag se gina jaata hai. Ab Executive Cockpit ka **Combined field stock**:

- **FF side** = StockDataa **minus** ID 5845036 wali rows (excluded tags card me dikhte hain)
- **GV side** = GV agents ke paas jo **combined stock** hai (Tag Assignment)
- Double count nahi — FF + GV combined ab sahi hai. Channel operating summary me bhi note hai.

**Colourful + clickable KPI cards.** Jo 4 black cards the (Projected month-end, Combined
field stock, GV commission, FF commission) ab **vivid gradient cards** hain (icons ke saath)
aur **click karne par poora backing data** khulta hai — search + CSV ke saath:

| Card | Click par kya milta hai |
|---|---|
| 🔭 Projected month-end | FF / GV / Combined — MTD, projection, active days, prev month, growth |
| 📦 Combined field stock | Agent-wise stock (FF + GV), ID/TL ke saath — 5845036 exclude note |
| 💰 GV earned commission | GV agent-wise tags, amount, commission, ₹/tag |
| 💸 FF commission | FF agent-wise earned / rate×tags / best value |

## 🎙 Voice assistant — "Meri awaaz" record/upload FIX

Pehle recording / upload par kuch hota nahi dikhta tha. Root causes fix kiye:

1. **Upload dialog cancel bug** — drop-zone ke andar hidden file input ka synthetic click
   bubble kar ke handler dobara chalta tha aur file picker turant band ho jaata tha.
2. **Recording ab decode-free** — MediaRecorder blob ke saath **raw PCM bhi capture** hota
   hai (WebAudio), isliye analysis browser ke audio-decode par depend nahi karti jo kai
   browsers/formats me silently fail hota tha.
3. **Better errors** — mic permission, HTTPS requirement, silence/chhota sample — sab par
   clear Hinglish messages (chup-chaap fail nahi hota).
4. Same file dobara select karne par bhi `change` fire hota hai; AudioContext suspended
   ho to decode se pehle resume + purane Safari ka callback fallback.

Flow: **⏺ Record karo → ⏹ Stop → analysis chips (pitch/speed/tone) → ✅ Meri awaaz lagao.**
Assistant ab usi pitch/speed/tone me bolta hai. (Settings → My account me bhi same flow.)

## 👂 Wake word — "Hey Gems" bolo, assistant active

- Wake word bolte hi (default **"Hey Gems"**) assistant **khud active** ho jaata hai —
  panel khulta hai, beep hoti hai, aur mic aapka sawaal sunta hai. Alexa/Siri style.
- **Fuzzy matching** — ASR misheards ("hey jems", "hey gem"…) bhi pakad me aate hain.
- **Settings me full control**: Voice Studio me naya **👂 Wake word** tab aur
  Settings → My account me **ON/OFF toggle + apna word** (2–3 shabdon ka rakho).
- Wake listener tabhi chalta hai jab mic free ho (ask/dictate/hands-free ke saath conflict nahi);
  hands-free 🎧 mode me wake khud pause ho jaata hai.
- FAB par **green pulsing dot** = "main sun raha hoon". Test button (🧪) se 10-second live test.
- Chrome/Edge me best; mic permission lagti hai; page par pehli click ke baad start hota hai.

## 🔐 Admin — har panel option ka per-user access

Settings → **Access matrix** me ab **har sidebar option ka apna checkbox** hai. Naye keys:

| Permission | Kya control karta hai |
|---|---|
| `rangeReport` | Range Report (pehle tagIssued ke saath bandha tha) |
| `tv` | TV Mode (pehle home) |
| `teamMap` | Team map |
| `stockReport` | FF Stock Report (pehle performance) |
| `gvStockReport` | GV Stock Report (pehle gvStock) |
| `reportStudio` | Report Studio (pehle savedViews) |
| `charts` | Charts-only GV vs FF view |
| `voiceAssistant` | 🎙️ Assistant panel + 👂 wake word — user ko dena hai ya nahi |

**Existing users ka access lock nahi hota** — server restart par ek migration unhe naye
child permissions auto-grant kar deti hai (jo parent permission thi usi hisaab se). Admin
baad me matrix se tick/untick kar ke **Save access** dabata hai.

## 🧪 Tests

- 8 naye regression tests (`dev/wake-word.test.js`): wake-word exact/fuzzy/negative,
  PCM capture analysis, no-mic friendly error. Total **101/101 pass**.
- Smoke: executive cockpit me colourful cards + 5845036 exclusion ka numeric assertion.
