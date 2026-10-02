# v3.36.0

## 🔊 App / web band hone par bhi voice + text notification

Sawal tha: *"app ya web close hone par bhi voice aur text notification ON rahe."* Ab dono cheezein
alag-alag khatam ho gayi hain — aur dono ka raasta documented hai:

| App ki halat | Text notification | Awaaz (voice) |
|---|---|---|
| App khuli (ya background tab) | ✅ OS panel + in-app bell | ✅ **turant** boli jaati hai (sw.js → page message) |
| App poora band / phone locked | ✅ OS panel me **text + sound + vibration** (Web Push) | 🕐 app dobara khulte hi **voice catch-up** (12 ghante tak) |
| Phone off / internet nahi | ✅ phone on hote hi (TTL 24h) | 🕐 app khulte hi |

**Ye kyun aise hai (technical sach):** Web Speech API **service worker me available nahi hoti**, aur
OS notification me sirf device ka system sound hota hai — koi custom "bolne wali" awaaz Web Push se
possible nahi hai (wo native app/FCM ka kaam hai). Isliye design ye hai: **text + sound + vibration
turant** (app band hone par bhi), aur **awaaz** sabse pehle jab browser audio bajaa sakta hai —
app khuli ho to turant, band tha to app dobara khulte hi.

### Kya-kya joda gaya

- **`sw.js`** — push payload me `voice` (bolne wali line), `speak`, `user`, `badge`, `lang` aur
  important types ke `actions` (📊 Kholo / ✅ Theek hai) aate hain. Push aate hi:
  1. OS notification turant (text + tone-matched vibration + app icon unread `badge`),
  2. bolne wali line `ff-voice-v1` queue me (12h TTL, max 8 lines),
  3. khuli hui app windows ko `ff-speak-push` message,
  4. "✅ Theek hai" dabane par line queue se hat jaati hai (dobara nahi bolegi).
- **`pushVoice.js` (naya)** — "closed-app voice" ka bridge: queue padhta hai, sab switches
  (master · sound · 🎙 Office Bell voice · 🔇 mute · `voice` pref) check karta hai, phir Office Bell
  ke speaker path (assistant ki chuni hui voice + autoplay unlock + queue) se bolta hai.
  Autoplay block ho to job **delete nahi** hoti — pehle tap/visibility par dobara try hoti hai aur
  ek chhota "tap karo" nudge dikhta hai. Shared device par dusre user ke alerts usi user ke liye
  queue me rehte hain (`user` field).
- **`server.js`** — har push me saaf bolne-layak line (`pushVoiceLine`, emoji/HTML hatakar),
  app-icon `badge` (unread count), `user`, `lang: hi-IN`, aur important alerts par actions.
  Naya pref **`voice`** (default ON) — OFF karne par **text push phir bhi aata hai**, sirf awaaz band.
  `/api/push/test` bhi ab voice line bhejta hai (Settings → Push diagnostics → 🛰 Server push test).
- **Bell panel (🔔)** — naya switch **"🔊 Alert voice (band ho tab bhi)"**, aur
  **Settings → 👤 My account → 🔔 Notifications** me wahi switch detail + **🔊 Closed-app voice test**
  button (jo exact wahi awaaz bajata hai jo catch-up me bajegi).
- **App icon badge** — unread count `setAppBadge` se (Chromium PWA); support na ho to skip.

## 📲 Zaroori setup (ek baar) — warna "app band" wale push nahi aayenge

1. **Phone par app install karo** (Android Chrome: ⋮ → "Install app"; iPhone: Safari → Share →
   "Add to Home Screen"). iOS 16.4+ me push **sirf installed** app me chalta hai.
2. App kholo → 🔔 bell → **Notifications ON/OFF** ON karo → browser permission **Allow**.
3. Settings → 👤 My account → 🔔 Notifications → **🛰 Server push test** dabao: phone lock karke
   dekh lo — panel me alert aana chahiye (aur app dobara khulte hi awaaz).
4. **Render ka server so na jaye:** free plan par service ~15 min inactivity ke baad sleep ho
   jaati hai — tab koi push nahi ja sakta. Ek free cron (cron-job.org / UptimeRobot) lagao:
   `GET https://first-forward-dashboard.onrender.com/api/version` **har 10 minute** — isse
   scheduled alerts/digest bhi apne time par fire hote rahenge.

## 🧪 Tests

- `dev/sw-push.test.js` — push payload → notification + voice queue + live page message + badge +
  dismiss action.
- `dev/push-voice.test.js` (naya) — catch-up, per-user jobs, sab switches, autoplay block par
  job safe rehna, live push, `test()`.
- `dev/closed-app-voice.test.js` (naya) — asli server se push payload decrypt kar ke check:
  `voice`/`speak`/`badge`/`user`/`actions` sahi jaate hain aur `voice:false` par text push phir
  bhi aata hai.
