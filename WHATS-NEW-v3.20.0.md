# 🎉 v3.20.0 — Dispatch-ready TL summary · Growth "where from" · Live GV · पूरी साइट की भाषा

Pehle v3.19.0 REPORT-basis par tha. Is version me poora scope complete hai:
naye Performance/TL tools, Trend me "Expected this month", channel-wise data basis,
aur language switch ab sach me **poori site** par chalta hai.

---

## 1. 🚚 TL drawer me "Dispatch ready" summary

TL drawer (aur agent drawer dono) me ab ek poora dispatch summary aata hai:

| Kya | Detail |
|---|---|
| Har agent ki suggested quantity | VC4 + Commercial, TL ke stock aur run-rate se |
| Totals | Har agent ka jod + **TL total (net)** |
| Cover | `stock ÷ run-rate` din |
| **Stock khatam** | 📅 projected stock-out date — stock kab khatam hogi |
| Risk band | 🔴 `< 7 din` · 🟠 `7–15 din` · 🟢 Covered |
| Share | WhatsApp 📲 aur CSV ⬇ — dono drawer me |

> Suggested dispatch **agent drawer aur TL drawer dono** me available hai.

---

## 2. 📈 Growth "kahan se aa raha hai" breakdown

Growth % ab ek number nahi, ek **kahani** hai. Har drawer me:

- **VC4** (payable)
- **Commercial** (VC20 + VC5+)
- **Total** (all tags)
- **Replacement** — alag, taaki asli commercial growth dikhe
- **Bina replacement** wala clean view
- Har row par "Expected month-end" — run-rate se aage ka andaza
- `Calculated` vs `Sheet` ka gap bhi — transparency ke liye

---

## 3. 📉 TL-wise de-growth list

- **Alerts view** me ab poori TL de-growth list hai — kis TL ka growth gir raha hai
- TL drawer me bhi de-growth section
- Growth girne waale agents alag highlight

---

## 4. 🔭 Cover-days forecast + projected stock-out date

```
cover      = stock ÷ run-rate
stock-out  = aaj + cover din
```

Har stock figure ke saath ab projected stock-out date bhi aata hai — `stockOutDate(stock, rate)`.

---

## 5. 📅 Data basis — channel-wise, poori site par

Yeh sabse zaroori change hai.

### FF (First Forward)
- FF ka daily report **kal ka data** laata hai — aaj ka data kal aata hai.
- Isliye run-rate, expected-month, growth, dispatch — **sab** usi report-day par ginne hain.
- Jaise sheet par 29 Sep ka data hai → 29 din ka basis.

### GV (GV Partner)
- GV ka data **live** hai — aaj ka data aaj.
- Isliye GV apna basis khud banata hai: `channelBasis('gv')` → aaj tak ke din.

### Kahan kahan laga
- `util.js` → naya `dayBasis(ch, opts)` + `channelBasis(ch)` + `basisText(ch, b)`
- `masterProfile.js` → profile growth / projection / drawer copy
- `performance.js` → KPIs, dispatch, stock-out, de-growth
- `trend.js` → Expected-this-month forecast
- `masterSearch.js` → kundli snapshot (REPORT ka apna growth + usi ki report date)

> ⚠️ `U.runRateDays()` ka purana contract (`max(1, today.getDate() - 1)`) **bilkul nahi badla** —
> uske upar bane hue tests safe hain. GV ke liye naya channel-aware layer upar hai.

### 🗣️ UI me "T-1" nahi — simple bhasha

Ab kahin bhi technical "T-1" nahi likha. Jaise:

- **FF** → `Data till 29 Sep — aaj ka data kal aata hai`
- **GV** → `Live data — aaj tak ka data`

---

## 6. 🎯 Trend me "Expected this month"

Trend page me naya mode: **🎯 Expected this month** (Daily / Weekly / Monthly / Last vs Current ke saath).

Har channel (FF, GV, ya dono) ke liye run-rate se poore month ka andaza:

| Row | Kya hai |
|---|---|
| VC4 | payable VC4 |
| VC20 | VC20 |
| VC5+ | VC5+ |
| All Commercial | VC20 + VC5+ |
| **Commercial · bina replacement** | asli commercial growth |
| Replacement | replacement alag |
| Total | all tags |
| Total · bina replacement | clean total |

Columns: Issued ab tak · Run-rate/day · **Expected month-end** · Aage aur kitna · Share %
Saath me bar chart, TL/agent filter, aur CSV export. Har channel ka **apna data basis** alag dikhta hai.

---

## 7. 🌐 Language switch — ab poori site par

Pehle sirf page headings aur buttons translate hote the. Ab **har jagah**:

- ✅ Tables ke headers, rows, cell values
- ✅ KPI cards, mini-grids, stat tiles
- ✅ Cards, badges, chips, pills
- ✅ Drawers (agent / TL profile)
- ✅ Notifications, toasts, alerts
- ✅ Buttons, labels, placeholders, `title`, `aria-label`
- ✅ Dynamic messages jo data se aate hain
- ✅ Mहीने/din ke naam (`U.labelYM`, `U.labelDate`, weekday)

### Kaise kaam karta hai
- **Hinglish** = source (codebase Hinglish me hai) — koi extra kaam nahi
- **English / हिंदी** ke liye ek phrase dictionary (`i18n.js`, 684 entries)
- Har render ke baad poora DOM walk hota hai — text nodes + attributes
- Matching: pehle poora text exact, phir **longest-phrase-first** substring
- Company/brand ke asli naam, VC4/VC20 jaise codes, numbers aur dates **kabhi nahi** badalte
- Koi shabd na mile to Hinglish hi rehta hai — kuch kabhi khoota nahi

Naya shabd add karna ho: `i18n.js` me `EN` / `HI` me key add karo, baaki automatic.

---

## ✅ Testing

| Suite | Result |
|---|---|
| `npm run check` (sab files syntax) | ✅ pass |
| `npm test` (dev/*.test.js) | ✅ **207 / 207 pass** |
| `node dev/smoke.js` | ✅ pass (1 pre-existing unrelated failure) |

Naye tests:
- `dev/i18n.test.js` — 9 tests: dictionary, matcher, DOM walker, proper-noun protection, app.js wiring
- `dev/t1-basis.test.js` — 12 tests: channel basis (FF vs GV), plain-language copy, no "T-1" in UI
- `dev/smoke.js` — Expected-this-month, dispatch-ready, de-growth, cover/stock-out, site-wide language

---

## 📦 Files changed

| File | Kya badla |
|---|---|
| `i18n.js` | **NEW** — dictionary + DOM walker + matcher |
| `util.js` | `dayBasis` / `channelBasis` / `basisText`; Hindi month & weekday names |
| `app.js` | `translateDom` ab poori DOM walk; lang switch shell bhi re-render karta hai |
| `trend.js` | Expected-this-month mode + CSV |
| `performance.js` | Dispatch-ready, growth breakdown, de-growth TL, stock-out, WhatsApp/CSV |
| `masterProfile.js` | Channel basis + simple bhasha copy |
| `masterSearch.js` | "T-1" hata, plain report-date labels |
| `index.html` | `i18n.js` load (app.js se pehle), `?v=41` |
| `sw.js` | cache `apnapayment-v47`, i18n precache |
| `dev/i18n-coverage.js` | **NEW** — real coverage measure karta hai |
| `server.js` | version 3.20.0 |

---

## 🔄 Upgrade note

Language switch pehle bhi tha. Ab koi user action nahi chahiye — jaise hi page render hoga,
poora content naye language me aa jayega. Bas ek **refresh** kar lo.
