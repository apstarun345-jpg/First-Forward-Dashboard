# 🚀 What's New — v3.16.0 (29 Sep 2026)

Char naye dhamake + Home par GV "aaj ka live" KPI board. Sab kuch wahi purana stack — koi naya sheet query nahi (sirf Office Bell ke liye ek halka count query).

## ⏰ Hourly Sprints (`#/sprints`)
- Har ghanta ek sprint: **is hour kaunsa TL / agent sabse zyada tags** issue kar raha hai.
- Live countdown (second-by-second) + hour progress bar.
- TL + Agent leaderboard (gold/silver/bronze bars), aaj ke pichhle sprints ka hour-wise chart + winners table.
- Ghanta palat-te hi **winner celebration** (trophy + fanfare) — page khula ho to apne aap.
- Data: GV Master ke time-stamps se (FF EIR me time nahi milta — FF sirf aaj ka total dikhata hai).

## 🗺️ Stock Radar (`#/stockRadar`)
- Har TL ek **bubble**: size = VC4 stock · colour = cover days.
  - 🔴 <7 din (critical, centre ke paas) · 🟠 <15 · 🟡 <30 · 🟢 30+ (bahar)
- Bubble click → drawer: stock, avg/day, cover + **🎯 suggested qty DONO criteria** (stock ke baad + bina stock ghataye) + links (Performance / Stock Report / Dispatch Planner).
- FF (REPORT) / GV (GV REPORT) / dono — channel switch.
- Upar critical TLs ki dispatch-first table.

## 📲 Good Morning Card (Home → "Morning Card" button)
- Ek click me **1080×1080 PNG** banti hai — WhatsApp par boss ko bhejne ke liye:
  - Kal ka total (FF + GV) aur vs pichhla din delta
  - MTD total + month-end projection
  - Top-3 agents (MTD, FF+GV combined)
  - Stock risks (<7 din cover wale TLs)
  - Aaj ka expected (pichhle 4 same-weekday ki run-rate)
- PNG download + WhatsApp text-summary link ek saath khulta hai.

## 🔔 Office Bell (topbar 🔔)
- Naya tag issue hua → soft **"ting"** + right-bottom me floating "+N 🏷️ FF/GV" ticker.
- Jitne zyada tags ek saath, utna zyada full sound (1 note → 3-note chime).
- Har 30 sec ek halka live count query (sirf aaj ka count — full reload nahi). Tab background me ho to nahi bajta.
- Bell icon se on/off (yaad rehta hai).

## 🟩 Home · GV "Aaj ka live" board
Aath clickable KPI cards — kisi par bhi click karo, poora day-breakdown drawer khulta hai:
| Card | Matlab |
|---|---|
| Aaj Total | aaj ki GV issuance + expected & pace foot me |
| VC4 / VC20 / VC5+ tags | class-wise (+share %) |
| Chassis tags | tagType = Chassis |
| Replacement tags | status = Replacement |
| Expected Today | pichhle **4 same-weekday** ki run-rate ka average |
| Aaj ki Rate (pace) | abhi tak ki speed se din ke end tak ka andaza |

## 🔧 Baaki
- Naye permissions: `sprints`, `stockRadar` (default users ko granted).
- Service worker v42 · asset cache v36 · package 3.16.0.
- Smoke tests: 5 naye v3.16 checks (home board, sprints, radar FF+GV, morning card math, bell query).

---

# 🔔➡️🎙️ v3.16.1 (update)

## Voice Announcer — bell ki jagah ab BOLEGA
- Office Bell ab **agent-wise live query** karta hai — pata chalta hai kis agent ke naye tags aaye.
- Voice ON (🔊) → **"Rahul ne 5 naye tags issue kiye"** bol kar sunata hai (Hindi/Hinglish ya English — assistant language ke hisaab se). Ting ki jagah awaaz.
- Voice OFF (🔇) → purana WebAudio ting.
- Bahut bada burst (40+ tags) → "Zabardast!" announcement. Ticker chip hamesha dikhta hai.
- Topbar me do buttons: 🔔 bell on/off + 🔊 voice on/off (dono yaad rehte hain).

## Settings · My access — sirf aapka access
- Ab "My access" section me **sirf wahi pages/actions/sheets dikhte hain jinka access user ko hai**.
- Band (locked ⛔) cards aur bina-access ke panels ab dikhte hi nahi — clean, confusion-free.
