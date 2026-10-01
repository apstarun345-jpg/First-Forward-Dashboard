# v3.34.0

## 🛠 Sabse bada fix — "report sirf CSV me download hoti hai, PDF/Share se kuch nahi hota"

**Root cause:** v3.32 me `pdf.js` ka API badal gaya tha (`doc.table(columns, rows)`, `doc.heading()`,
`finish()` → canvases), lekin ye 4 jagah purane API par atki rahi thi → har PDF button chupchaap
`TypeError` maar deta tha, isliye sirf CSV download hota tha:

- **Agent / TL Summary (FF + GV)** — 📄 PDF + 📲 Share PDF/WhatsApp dono fail.
- **Master Profile PDF** — profile page ka PDF button fail.
- **Server personal report** (`/p/<token>` pages) — PDF fallback `window.print()` par chala jata tha.
- **Har drawer ka PDF button** (app.js) — `FF.pdf.download([docApi])` galat type pass karta tha.

**Fix (ek hi jagah, sab repair):** `pdf.js` ka `doc()` builder ab **dono API samajhta hai** —
`section(text, sub)` · `table({ headers, align, rows, foot })` · `footer(text)` legacy names chalte
hain, `doc({ title, subtitle, right, meta })` page-1 header khud banata hai, aur `finish()` ab
seedha **PDF Blob** return karta hai. Naya API (columns/rows) waise ka waisa chalta hai.
Saath me export buttons par busy-state + error toast laga diya — ab kabhi "kuch hota hi nahi" nahi hoga.

## 📊 Agent / TL Summary me naye download formats (pehle sirf CSV tha)

| Button | Kya milta hai |
| --- | --- |
| 📄 PDF | Pehle jaisa A4 report (ab kaam karta hai) + Grand Total |
| 📊 Excel (naya) | **Multi-sheet .xlsx** — Summary · Class-wise · Stock Ageing · Team Agents, sab me Grand Total row, frozen header + filter |
| ⬇ CSV | Pehle jaisa |
| 🧾 JSON (naya) | Poora structured report (totals, class-wise, ageing, team) — automation/API/backup ke liye |
| 📲 Share / WhatsApp | PDF share sheet + text (ab kaam karta hai) |
| 💬 WA Text · 📋 Copy | Pehle jaise |

## ⚡ Speed — Agent / TL Summary ab lag nahi karta

- **List cache (stale-while-revalidate, 3 min)** — pehle har page-open par master + performance +
  stock poora dobara load hota tha; ab pehli baar ke baad page **turant** khulta hai, data background
  me fresh hota hai.
- **Report cache (2 min)** — agent A ↔ agent B ↔ agent A switch karne par summary instant khulti hai.
- **Search debounce (120 ms)** — fast typing par har keystroke par dobara render nahi hota.
- **🔄 Refresh button** — search bar me naya button: cache clear karke list + current report fresh
  laata hai (Search button bhi ab fresh report deta hai).

## 🚀 Add-ons — Agent / TL Summary me naye features

### 📈 6-Month Trend (har agent + TL)
- Summary me naya card — pichhle 6 mahine ka month-wise issuance bars (EIR agentClass ledger se, **koi extra Google query nahi**), current month highlight + 📈/📉 direction.
- Agar trend data available nahi → card apne aap chhup jaata hai.

### 🚨 Alerts & 🌟 Top movers (TL view) / MTD-drop warning (agent view)
- **TL ke liye** — clickable chips: 🔻 *MTD drop −50%+* (last month ke muqable aadhe se kam), 🌟 *Stars +50%+*, 🐌 *Zero issuance par stock held*. Chip click → us agent ka poora summary.
- **Agent ke liye** — khud ke growth par red/green strip (⚠️ drop warning / 🌟 shandaar performance).

### 👥 Team Pack (TL view) — poora team ek hi file me
- **👥 Team Pack PDF** — TL ka summary + har agent ka apna page (KPI cards + class table) — ek combined multi-page PDF, progress ⏳ 12/30… dikhta hai.
- **👥 Team Pack Excel** — Team Summary sheet + Stock Ageing sheet + **har agent ki apni sheet** (sabme Grand Total).
- Cap 50 agents, fail hone par agent skip + toast (silent fail nahi).

### 📲 Per-agent WhatsApp quick-share (TL team table)
- Har agent row me 📲 button — agent ka MTD/Last/Stock/TL one-tap WhatsApp message; mobile number milne par seedha `wa.me/91<number>` par khulta hai.

### 🕘 Generated-at stamp
- Report header me "🕘 HH:MM" — data kis waqt ka hai hamesha dikhta hai (cache ke saath honest).

## 🧾 Drawer PDF

- Drawer export ab structured builder se multi-page PDF banata hai (KPI cards + har table, Grand
  Total bold, 400 rows/page-limit ke saath) — pehle crash hota tha.

## 🧪 Tests + versioning

- Naye tests — `dev/v334-report-formats.test.js` (PDF legacy+naya API, reportXlsx, JSON) + `dev/v334-addons.test.js` (trend month-walk, channel split, TL rollup, alerts, team pack xlsx, WA text) — **10 naye tests, poora suite 309/309 pass**.
- Cache-busting `?v=57 → v=58` (index.html + sw.js + service-worker cache `apnapayment-v65`) —
  warna browsers 1 saal purani JS dikhatе.
