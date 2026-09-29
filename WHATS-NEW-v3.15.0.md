# 🆕 WHATS NEW — v3.15.0 (Suggested Dispatch · Dono Criteria Edition)

## 🎯 Suggested tags/dispatch — ab DONO criteria, har jagah
Ab jahan-jahan bhi dispatch/tag suggestion dikhta hai, wahan **do figures** milte hain:

| Criteria | Formula | Matlab |
|---|---|---|
| **Stock ke baad (net)** | avg/day × din − current stock | Stock ghatane ke baad kitna bhejna hai |
| **Bina stock ghataye (gross)** | avg/day × din | Run-rate ke hisaab se pure din ki requirement |

Ye dono milte hain:
- 🔎 **Master search** — topbar dropdown suggestions + kundli cards (TLS aur agents dono ke liye)
- 🧾 **Profile drawer** (Master Profile) — KPI cards, formula note, TL ke agents table (net + w/o stock columns), CSV + WhatsApp share
- 🏆 **Performance → Alerts** — Suggested dispatch plan table (har row me net + w/o stock)
- 🟩 **GV Dashboard + GV Stock Report → Dispatch** — same dono columns, totals bhi dono
- 🧍 **Direct Agents** — tag required (net + w/o stock), roster table + CSV
- 🆕 **New Agents** — suggested column

## ⚙️ Settings me control (Settings → 🎛 Features)
Naya card **🎯 Suggested dispatch / tags**:
- **Kitne din ka suggest kare** (`suggestDays`, default 15 — 30 karoge to 30 din ke liye dikhega)
- **Kaise dikhaye** (`suggestMode`):
  - `Dono dikhao` (default) — net + w/o stock
  - `Sirf stock ke baad (net)`
  - `Sirf bina stock ghataye (gross)`

Example: avg 10/day · stock 40 · 30 din → stock ke baad **260** · bina stock **300**.

## 🔎 Topbar master search upgrades
- **✕ Clear button** — input ke andar, ek click me search khali + dropdown band
- **📅 Date-range button** — From/To dates + presets (Aaj · Last 7 din · Is mahine · Pichla mahina · Last 30 din) → seedha **Custom Range Report** khulta hai
- Suggested dropdown pehle se tha — ab suggestions me bhi dono criteria dikhte hain
- Home ke bade search bar me bhi ✕ Clear

## 🎨 Visual fixes
- **% rule site-wide**: minus (−) **RED**, plus (+) **GREEN + bold** — KPI cards ke andar bhi (pehle white dikhta tha). Growth columns (Master Profile, Compare, Assistant answers) ab colored ▲/▼ %
- **Panel text bold + thoda bada** — Master search results panel, kundli cards, suggestion dropdown, card headings
- **🔴 War Room colourful** — dark background hata diya; ab light multi-colour gradient + har counter/panel ka apna colour (FF indigo · GV teal · Total amber · Month pink), detail cards bhi colourful
- **Dashboard ka hidden KPI fix** — "weekday vs last week" KPI (g13) ka background hi nahi tha, text dikhta nahi tha; ab proper gradient
- **KPI cards clickable** — Performance ke 6 KPI cards ab click karte hi full breakdown drawer kholte hain (agents / MTD / latest day / stock report), dashboard + home pehle se the

## 🔧 Technical
- `util.js`: naye helpers — `suggestDays()`, `suggestMode()`, `suggestNet/Gross/Pair()`, `sugCell()`, `sugText()`, `pctHtml()`
- Server default me `features.suggestMode: 'both'`
- Master Profile CSV/WhatsApp exports me dono figures
- GV Stock Report Excel → Dispatch sheet me dono columns
- 141/141 unit tests + full smoke suite pass
