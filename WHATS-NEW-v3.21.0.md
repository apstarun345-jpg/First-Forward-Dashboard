# ✨ v3.21.0 — Fast load · kaam karta workspace filter · FF T+1 (GV live) · agent drill-down · voice · diagnostics

Ye release un saari cheezon ko theek karta hai jo aapne batayi thi — dashboard ka hang, Home ka filter,
voice ka "block" wala message, diagnose, aur KPI card ke andar-tak detail.

---

## 1) ⚡ Dashboard ab fast — hang ka asli karan

Pehle pehli baar khulte hi browser **~3.3 MB (bina compress)** JS/CSS + multi-MB Google data download karta tha,
aur tab-warming ki 6 parallel queries page ki apni zaroori queries ko peeche dhakel deti thi.

Ab:

| Fix | Asar |
| --- | --- |
| **brotli/gzip** (HTML + JS + CSS + gviz data) | StockDataa 5000 rows: **1.39 MB → 30 KB** |
| `?v=43` assets par **1 saal immutable cache** | dobara khulte hi ~0 network (pehle har page load par 45 files) |
| gviz proxy **stale-while-revalidate** | TTL khatam hone par bhi purana data **turant**, naya background me |
| **hot-query cache warmer** | jo queries sach me use hoti hain wo server par warm — pehla user bhi instant |
| preload **2 workers** + already-loaded tabs skip | page ki critical queries ko connection pool milta hai |

## 2) 🧭 Workspace filter — ab sach me kaam karta hai

Pehle Home par filter bar badalne ka **koi asar nahi** hota tha (page sirf URL param likhta tha, padhta koi nahi).

- Naya `filters.js` → **`FF.filters`**: period / month / channel / TL / agent / class ka ek hi resolver.
- **Home** poora filter-aware: hero chips, Today at a glance, GV aaj, FF/GV charts, champions, 14-din trend.
- Same page par filter badlo → turant re-render (pehle chup-chaap kuch nahi hota tha) + bar me **active chips / FF lag note / offline badge** + **Aaj / Kal** quick buttons.
- Tag Issued page, KPI drawer aur baaki pages apne params isi resolver se lete hain.

## 3) 🔁 FF ka data T+1 — GV live

Niyam: **First Forward (EIR) ka issuance ek din late** aata hai, **GV Partner live** chalta hai.

- **TODAY view → GV ka live number, FF = 0** (saaf note: *"FF data T+1 · kal aayega"*).
- **YESTERDAY view → GV + FF dono**.
- Config: `config.js` → `ffIssuanceLagDays: 1` (`0` kar dene par purana behaviour).
- Lag **Home**, **Tag Issued page** (badge + "aaj FF 0" warning) aur **KPI drawer** (day view + tag-level raw rows) par lagta hai.
- GV rows (EIR me master ID **5845036**) **kabhi** lag se nahi hatti.

## 4) 👥 KPI card click → "kisne lagaye" → us agent ka poora detail

Har KPI card (GV/FF, Replacement, Chassis, VC4, VC20, VC5+, Commercial) par click:

1. **Drawer** — total/VC4/commercial/replacement/chassis, day-wise table, class × matrix.
2. **👥 Kisne lagaye** — agent-wise list: GV agent ya FF agent (🟩/🟦 badge), TL, tags, share, days.
3. **Agent par click** → us agent ki day-wise, class-wise, type, VRN detail + rank + Performance/Master profile links.
4. **Din par click** → us din ka breakdown · **chips** se channel/class/type filter.
5. **📄 Tag-level rows** — search ke saath poori row (Tag ID, VRN, class, agent, TL, channel) + Excel/CSV.

## 5) 🔊 Voice announcer — "voice block" fix

- Chrome ka `interrupted` / `canceled` error ab **block nahi** maana jaata (sirf asli `not-allowed`), ek baar auto-retry.
- Nudge aur menu me **"🔊 Enable sound"** button — click ke andar unlock + test bolta hai, phir har naya tag bol kar sunata hai.
- Status pill saaf: **SOUND READY ✓ / EK TAP ME CHALU / BROWSER BLOCK** (pehle galat "BLOCKED" dikhata tha).
- Menu me **Test voice** + mute 30 min + kam-se-kam tags ka control.

## 6) 🩺 Diagnostics — ab fix sach me tikta hai

- Safe fix ab **site-wide persist** hota hai (localStorage `ff_diag_repairs` + inject ki gayi stylesheet) — page badlo ya reload karo, fix laga rehta hai. **"Clear all repairs"** se sab hata sakte ho.
- Naya **🌐 Scan every page** — pehle scan sirf current page + shell dekhta tha (isliye lagta tha "kuch nahi milta");
  ab har permitted page render karke check hota hai aur route render errors bhi finding banti hain.
- Naye checks: module contracts, FF lag config sanity, `data-kpi` spec validity.

## 7) 🐞 Bug fixes

- **GV Commission → per-class boards** aur **Cockpit → Agent 360 drawer** me `ReferenceError: s is not defined` (page crash) — fix.
- Home ke GV aaj grid me **"Aaj ki Rate"** wapas.
- Filter reset ab `from/to/date` bhi saaf karta hai (purane date chips chipke nahi rehte).

---

## 🧪 Verify kaise karein

- `npm run check` → syntax ok
- `npm test` → **217 tests pass** (naya `dev/filters.test.js`: lag + filter semantics)
- `npm run mock` + `npm run dev:mock` (dusre terminal me) + `node dev/smoke.js` → poora app render, KPI drill, T+1 aur diagnostics checks.

> Note: `dev/smoke.js` ke do failure sirf mock data ki wajah se hote hain (mock EIR me hourly timestamp nahi,
> aur forecast history fresh server par zero hoti hai) — ye baseline par bhi wahi the.

## ⚙️ Deploy ke baad ek baar

Purana service-worker cache hata dene ke liye app khud "🔄 Naya version aaya — Reload" toast dikhayega;
ek baar **Reload** dabane par naya build (v3.21.0) aa jayega.
