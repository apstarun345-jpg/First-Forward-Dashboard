# What's New — v3.26.0

## 🎙️ Live Assist — admin user ki awaaz / video LIVE sun sakta hai (consent ke saath)

Ek-tarfa live session: **user Allow karta hai tabhi** uski awaaz (+ option me camera) admin ko
WebRTC se seedha stream hoti hai. Ye feature **transparency-first** hai — chup-chaap kuch nahi hota:

### User side (jiski awaaz jaati hai)
- Full-screen **consent popup**: kaun admin hai, kya jayega (awaaz / awaaz + camera), 60s timeout.
  **Allow / Decline** dono haath me — decline par session wahin khatam.
- Browser ki mic/camera permission tabhi maangi jaati hai jab user Allow kare.
- Session chalu rehte screen par hamesha **🔴 LIVE pill** dikhta hai (blink dot + kis admin ko
  ja rahi hai) — **End** button ke saath, kabhi bhi band karo.
- Admin ne band kiya ya timeout → pill apne aap hat jaata hai.

### Admin side
- 🔔 Notifications → **User activity** panel me har user ke aage naya **🎙 Assist** button.
- Mode chuno: **🎙️ Sirf awaaz** ya **🎥 Awaaz + video**.
- Panel dikhata hai: request gayi → user ne allow kiya → connecting → **🔴 LIVE player**
  (video mode me live video + audio, voice mode me audio). Autoplay block ho to ek
  "▶️ Sound chalu karo" button aa jaata hai.
- End kabhi bhi; decline/missed ki wajah bhi dikhti hai.

### Safety & privacy (by design)
- Request/accept/decline/end — sab **audit log** me darj (Settings → 📜 Audit).
- Koi doosra user session accept ya signalling nahi kar sakta (server-side 403).
- Signalling **accept ke baad hi** khulti hai — consent se pehle media setup possible hi nahi.
- Sessions max 1 ghante ki; request 60s me expire.
- Bell me 'assist' notification type — user chahe to Settings se is type ke alerts bhi control
  kar sakta hai (lekin request consent popup inbox poll se aati hai, notification sirf record hai).

### Tech
- Media: `RTCPeerConnection` browser↔browser (server par koi audio/video traffic nahi).
- Signalling: server SDP offer/answer + ICE candidates relay karta hai (`/api/live-assist/*`),
  sessions durable `notify` workspace me — restart ke baad history bachi rehti hai.
- ICE: default Google STUN. Strict NAT/4G me TURN chahiye ho to Render env me
  `LIVE_ASSIST_ICE_JSON` (JSON array, e.g. `[{"urls":"turn:my.turn.server","username":"u","credential":"p"}]`).
- Naya eager module `liveAssist.js` (app shell ke saath load — consent kisi bhi page par aa sakti hai).
- Tests: `dev/live-assist.test.js` — consent lifecycle, privacy guards, signalling echo-filter,
  durability. **Total 256 tests pass.**

## Baaki
- Version bumps: app shell `?v=49`, service worker cache `apnapayment-v55`, package `3.26.0`.
- `package.json check` me liveAssist.js syntax gate add.
