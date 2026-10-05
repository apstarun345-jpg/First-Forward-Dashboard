# WHAT'S NEW — v3.46.0 · 🏠 Home v2 (GV aaj live) + 🔎 Management → Master Search + ⚡ fast Agent/TL Summary

## 1) 🟩 GV ka "aaj ka live" ab pakka dikhta hai (asli bug fix)

Pehle Home par GV ka aaj ka number **client-side GV Master tab** par depend karta tha — poori tab
download hone tak (ya column mapping galat hone par) **khaali / 0** dikhta tha.

- **⚡ `/api/today` (server feed):** GV aaj ka number ab server hi **GV Master sheet** se grouped
  query (date × class, sirf 30 din) se laata hai — sasti query, 45s cache, aur bade full-tab download
  ka intezaar nahi. Feed me aaj ke saath: **VC4 · VC20 · VC5+ · Replacement · Chassis**, pichhle
  30 din ki daily series, **Expected Today** (pichhle 4 same-weekday ka average — **pichhla mahina
  bhi shaamil**), aur pace (aaj ke tags ÷ beete ghante × 24).
- **🗓️ serverDate ab sab formats padhta hai:** pehle sirf gviz `Date(y,m,d)` aur ISO `yyyy-mm-dd`
  chalta tha. Jis sheet me date text hoti hai (`03-10-2026`, `3/10/2026`, `3-Oct-2026`,
  `October 3, 2026`) wahan **har row skip** ho jaati thi → GV aaj 0. Ab dono taraf (server + client)
  ek hi tarah parse hota hai (`dev/server-date-formats.test.js`).
- **🛡️ Double-safe:** GV Master dataset load hone par wahi snapshot card ko enrich karta hai —
  par chhota/adhoora snapshot server ke bade number ko **replace nahi** karta.
- Aaj ki rows sheet me na aayi hon to card par saaf note: "aaj ki rows abhi GV Master me nahi aayi".
- ℹ️ GV ka puraane dino ka issuance EIR se (GV = master ID `5845036`) aur **stock Tag Assignment** se —
  Home par sources har card ke neeche likhe hote hain.

## 2) 🏠 Home v2 — sirf kaam ki cheezein, usi order me

1. **🟩 GV · Aaj ka live** — Aaj Total · VC4 · VC20 · VC5+ · Replacement · Chassis · **Expected Today**
   (har card click → kis agent/TL ne lagaye, tag-level rows).
2. **📅 Is mahine ke KPI cards** — **Last day issuance** · **current month total** · VC4 · VC20 · VC5+ ·
   Replacement · Chassis · **Expected in month** — **har card ke andar last month vs current month ka
   %** (▲/▼) aur FF/GV ka split.
3. **📈 Charts** — current vs last month daily line, MTD class bars (last vs current), class-mix donut,
   GV same-weekday run-rate bars.
4. **📦 Stock** — **First Forward (StockDataa)** + **GV Partner (Tag Assignment)**: total, VC4/Comm,
   cover din, class-wise bars, donuts, top stock holders.

**❌ Home se master search hata diya** — wo ab apne alag page par hai (neeche).

## 3) 🔎 Management → Master Search (naya option)

Purana behaviour (search karo → results ki **list** aa jaaye, ek **box/panel** khule) hata diya.

- **Direct search → click → poora data usi page par:** naam / agent / TL / ID / mobile type karo,
  pehla match **khud khul jaata hai** — `⚖ FF + GV` combined report (last month · current month ·
  stock · class-wise, har number clickable → drawer → class → din → tag/barcode row) aur per-channel
  full profile (KPI, charts, TL ke agents, Agent × Class).
- Ek se zyada log match hon to sirf **ek line ke naam-chips** (list nahi), click karte hi us insaan ka
  data khul jaata hai.
- Upar **GV aaj ka snapshot** (GV Master live) + FF ka aaj (EIR, T+1) — aur 🏷️ tag-level rows ka link.
- Topbar search (`/`) se naam pick karne par seedha **yahi page** khulta hai; palette (Ctrl+K) me bhi
  naam → page. Barcode/tag-ID search purane tag-rows panel me hi jaata hai.
- Permission key: **`masterSearch`** (Settings → Access matrix me "Management · Master Search").

## 4) ⚡ Agent / TL Summary — TL search ab turant khulta hai

- **⚡ Fast open:** page kholte hi list **jo abhi memory me hai** usse turant ban jaati hai; GV ke bhaari
  datasets (GV Master / GV REPORT / Tag Assignment) **background me load** hote hain aur numbers aate
  hi apne aap sync ho jaate hain (pehle page un sabka intezaar karta tha → slow).
- **🧑‍💼 TL search:** TL ka report turant — **issuance last month · current month · today issued** ·
  stock (TL ke paas + agents ke paas) · class-wise · sheet cross-check chips.
- Dropdown/suggestion rows me ab **last · mtd · aaj · stock** — chaar numbers ek nazar me.
- Bhaari **ageing** alag se background me aati hai (report pehle, ageing baad me) — sheet kabhi
  atki hui nahi lagti.

## 5) 🧪 Tests

- Naya: `dev/server-date-formats.test.js` (5 tests — saare sheet date formats).
- Smoke: **Home v2** (GV aaj + month KPI + charts + stock, master search hata hua), **Master Search
  page** (naam → poora report, purana panel khula na ho), **GV TL summary fast open**.
- `npm test` = 442 pass · `npm run check` = syntax ok.
