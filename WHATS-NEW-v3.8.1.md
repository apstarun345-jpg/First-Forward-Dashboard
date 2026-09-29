# WHAT'S NEW — v3.8.1 🎨🖱🎙 Voice Studio + clickable KPI drill-downs

> Hinglish guide · ye release FASTag Champions / Dual Agents ke KPI cards, mic assistant
> (dictation + advanced engine) aur voice output (default voices + **Meri awaaz** upload/record) par focused hai.

---

## 1. 🎨 KPI cards ab colourful — dark black khatam

**Kahan:** `#/fastagChampions`, `#/dualChannel` (aur har jagah vivid KPI cards — commission, forecast, data quality).

- Bug fix: dark fallback CSS rule zyada specific tha isliye `data-tone="g1…g12"` ke vivid gradients
  kabhi apply hi nahi hote the — cards dark black dikhte the. Ab gradients **sahi me** lagte hain.
- 12 naye multi-stop gradients + matching colour glows, hover lift + glassy shine, icon chip.
- Har card par hover karo to **"🔎 Full data ↗"** pill dikhta hai (mobile par always visible).

## 2. 🖱 KPI cards clickable — click = poora data

**Kahan:** FASTag Champions + Dual Agents ke KPI cards (sab vivid cards).

- Card par click/Enter → dialog me us metric ka **poora dataset** (top-N board nahi — saare agents):
  - FASTag Champions: FF issuance / GV issuance / Chassis / Replacement / Wrong VRN / Champion boards —
    agent-wise rows with Channel, ID, TL, Total, VC4, Commercial, Chassis, Replacement, Wrong VRN.
  - Dual Agents: verified pairs, double-mapped barcodes, FF/GV tags, shared barcodes — waise hi.
- Dialog me ab **live search**, **stats pills**, **CSV download** — aur keyboard accessible.

## 3. ✍️ Mic assistant me bolkar likhne ka option (speak-to-type)

**Kahan:** assistant panel ke form me naya **✍️** button (🎙️ ke saath).

- 🎙️ = bol kar **direct pucho** (turant jawab). ✍️ = **bolkar input box me likho** — live interim
  text dikhta hai, edit karo, phir ➤ se bhejo. Jitni baar chaho dictate karo.

## 4. 🧠 Assistant ab advanced

- **Context memory:** "Rahul ka issuance" ke baad **"iska stock?"**, **"iski commission?"** bhi samajh aata hai.
- Naye commands: `kal ka total`, `week ka total`, `VC4 vs commercial` (class mix), `growth vs last month`,
  `agent list`, `Rahul ka full summary` (360 card), `data kab update hua`, `help`.
- Agent-wise: wrong VRN, replacement, chassis, stock, commission, issuance.
- Har jawab ke baad **follow-up chips** (ek tap me next sawaal), jawab par **📋 Copy**, timestamps.

## 5. 🎛 Voice Studio — default voices + Meri awaaz (upload/record)

**Kahan:** assistant ke **🎛️** button se (Settings → My account me bhi wahi options).

- **🗣 Default voices:** Hindi/English ke liye alag system voice (online 🟣 voices bhi), speed + pitch
  sliders, Hindi/English test buttons, reset.
- **🎤 Meri awaaz:** apni voice ka sample **record** karo (5–15 sec) ya **audio file upload** karo
  (drag & drop supported) → pitch (Hz), speed (syllables/sec) aur tone (warm/bright) analyse kar ke
  assistant **usi style me** bolne lagta hai. Chips me analysis dikhta hai, test bhi kar sakte ho.
- Profile ek tap me hata bhi sakte ho. **Audio file sirf analyse hoti hai — kahin save nahi hoti**
  (localStorage me sirf derived numbers). Ye browser-TTS **tone-match** hai — jaisa browser TTS kar
  sakta hai us hisaab se aapke voice jaisa feel.

## 6. 🌅🗣 Concierge — login greeting + Alexa/Google-style voice conversation

**Kahan:** site login hote hi + assistant panel.

- **Login par voice greeting:** `Good morning Tarun Kumawat! 🙏 Kaise ho aap?` — time-aware
  (Good morning / afternoon / evening / night), user ka naam, Hinglish/English apni language me.
  Phir assistant khud bolta hai: *"Aaj mere se kya janna chahte ho? Boliye — wrong VRN, top VC4,
  top GV agents, total issuance, stock… kuch bhi!"* — saath me wahi suggestion chips.
- **Chit-chat replies:** "main theek hu", "kaise ho", "shukriya", "bye", "tum kaun ho",
  "good morning", "time kya hua", "joke sunao", "acha/nice" (short casual) — sab ka natural jawab,
  aur har chit-chat ke baad wapas "kya janna chahte ho?" suggestions.
- **Metric-aware tops:** *"top VC4 agents"* → VC4 count se ranking · *"top chassis agents"*,
  *"top commercial"*, *"top GV agents"*, *"wrong VRN top"* — sab alag-alag.
- **☀️ Briefing do:** Alexa-style daily brief — kal ka total, aaj ab tak, month-to-date FF+GV,
  stock, wrong VRN, top agent — sab bol kar.
- **🎧 Hands-free mode (unique):** panel ka 🎧 button ya bol kar *"hands free mode on"* — phir
  har jawab ke baad assistant **khud dobara sunne lagta hai** (Alexa jaisa loop). Bolo *"stop
  listening"* to band. 8 turns ke baad safety auto-pause. Mic dabane par bolte waqt TTS turant
  ruk jata hai (barge-in).
- **🔁 Dobara sunao:** jo abhi bola woh repeat. Settings → My account me greeting ON/OFF +
  hands-free toggle bhi hai.

### 🚀 Aage ke unique ideas (agle round ke liye)
1. **Wake word** — "Hey First Forward" bolte hi assistant ready (continuous listening).
2. **Proactive voice nudges** — stock-out risk / anomaly par assistant khud bole: "Rahul ke paas 2 din ka stock bacha hai".
3. **WhatsApp voice notes** — daily brief ka voice note WhatsApp par.
4. **Festival/birthday greetings** — agent ke birthday par personalized voice shout-out + certificate.
5. **TV mode voice control** — TV wallboard par bol kar page change ("next slide", "GV dikhao").
6. **Voice-cloned morning report** — user ki uploaded voice me hi poora daily report auto-generate.

---

## Verification

| Check | Result |
|---|---|
| `npm test` | **93 / 93 pass** (32 naye: voice DSP, profile, matchVoice, assistant intents, concierge greeting/chit-chat + regression locks) |
| `npm run check` | syntax ok |
| `node dev/smoke.js` | FASTag Champions naya render check ✓ · dual-channel ✓ · concierge greeting path ✓ (ek pre-existing payout-timing flake base par bhi fail hota hai) |
