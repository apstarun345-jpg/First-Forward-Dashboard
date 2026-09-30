# 🎉 What's new — v3.19.0

**T-1 basis · Master search me TL growth % · Performance TL drawer me suggested dispatch · T-1 month-end projection**

---

## 0. 🕐 Sabse pehle — FF ka data T-1 hai

**Pehle:** har jagah "aaj" ka hisaab hota tha — is month ka issue ÷ (aaj), aur sheet ka projected bhi
usi basis par. Par **FF ka REPORT kal ka data laata hai**, to aaj ka adhoora din kabhi calculation me
nahi aana chahiye.

**Ab:** ek nayi shared helper — `FF.util.reportBasis()` — poori site par **"jis din tak ka data aaya
hai"** ko ek hi jagah decide karti hai:

| | |
|---|---|
| Report day | REPORT tab ke **"Performance In 7 Days"** header se padha jaata hai (d7 ka date) |
| Safety cap | Hamesha `aaj − 1` se **zyada kabhi nahi** — aaj ka adhoora data count nahi hoga, chahe sheet me aa jaye |
| Fallback | REPORT load nahi hua / header nahi mila → site default `aaj − 1` |
| `days` | Divisor (run-rate, dispatch, projection sab isi par gin-te hain) |
| `label` | `2026-09-29 (Tue)` — har card par "till 29 Sep" ke saath dikhta hai |

`U.dispatchCalc({ …, elapsed })` ab explicit divisor leta hai — purana behaviour (bina `elapsed` diye)
poori tarah safe hai.

---

## 1. 🔎 Master search → drawer me **TL growth %**

Master search bar me TL search karo → **Poori report** drawer kholo. Pehle growth cell khaali
(`—`) rehta tha. Ab:

- 📈 **Growth %** cell — REPORT tab ka apna **"TL Performance Status · Percent"**, colour ke saath
  (`▲ +14%` hara / `▼ -4%` laal), aur niche **"till 29 Sep · proj 368"**.
- Naya section **📈 Growth % & month-end projection · T-1 basis** — VC4 / Commercial / Total rows:
  last month · this month (till date ke saath) · growth · **T-1 projection**.
- Footnotes: **report day**, **run-rate (T-1)**, **sheet ka projected** (purane basis par — comparison
  ke liye) aur **growth % source** (REPORT tab ya totals se calculated).
- 🧮 **Dispatch calculation** card ka heading ab saaf likhta hai: *"REPORT tab 2026-09-29 (Tue) tak ka
  data deta hai, isliye run-rate = issue ÷ 29 din (report day, na ki aaj)"*.

**Search results ki kundli cards** (jo list me dikhti hain) me bhi ab growth % + T-1 projection cell
aa gaya — drawer kholne se pehle hi pata chal jata hai.

Agent profile me bhi wahi growth % + T-1 projection aa gaya (pehle sirf raw text tha).

---

## 2. 🚚 Performance → search karne par drawer me **suggested dispatch qty**

Performance page ke **quick-find** se agent **ya TL** search karke drawer kholo:

### Agent drawer (pehle se tha, ab T-1 par)
- Run-rate ab `issue ÷ report day` par — sheet ke "aaj" wale basis se **1 din peeche**.
- Card ke andar 3 naye lines: **run-rate VC4/Comm**, **month-end projection (T-1)**, **cover (all tags)**.
- Saath mein sheet ka apna projected bhi dikhta hai taaki farq samajh aaye.

### 👥 TL drawer me **naya card** — pehle bilkul nahi tha
`🚚 Suggested dispatch quantity · TL level · 15 days`

| Row | After stock | Without subtracting stock |
|---|---|---|
| VC4 | TL run-rate × 15 − TL stock | full requirement |
| Commercial | TL run-rate × 15 − TL stock | full requirement |
| **All tags** | total net | total gross |

Neeche 4 lines: **run-rate VC4 · Comm · Total**, **month-end projection (T-1)**, **agents ka jod**
(har agent ka apna stock minus karke), aur **cover**.

Dono drawers ke growth KPI ab **"Growth · T-1"** hain — "till 29 Sep · REPORT T-1" label ke saath.

---

## 3. 🔮 Month-end projection T-1 basis par

`U.projectMonthEnd(issued, elapsed, ym)` = `(issue ÷ report day) × is month ke din`.

Sheet ka `Projected (month end)` aaj ke basis par banta hai, isliye woh hamesha thoda **kam** padta tha.
Ab dono side-by-side dikhte hain — T-1 wala thoda upar hota hai (kam din pe zyada tags).
Master search ke WhatsApp text aur CSV export me bhi growth % + basis + projection aa gaya.

---

## 4. 🧭 Ek chhoti si clarity

Drawer me **⚖️ Class split** **EIR** se aati hai (live — aaj tak ka data), jabki upar ke KPI aur
dispatch **REPORT** se (T-1). Ye dono alag sources hain, isliye card ke neeche ab ek line saaf likhti
hai: *"Class split EIR se aati hai (live, aaj tak ka data) — upar ke KPI / dispatch REPORT T-1 basis
(29 Sep) par hain."*

---

## 🧪 Verification

```
npm run check     → syntax ok (server + 46 browser modules)
npm test          → 196 tests pass  (pehle 186 the, +10 naye)
node dev/smoke.js → naya "T-1 basis" check ✓
```

Naye tests — `dev/t1-basis.test.js` (10):
- `reportBasis` — report day, date/label, sheet header
- **T-1 cap** — sheet me aaj aa jaye to bhi `aaj − 1` par cap
- fallback (REPORT load nahi hua) → site default, aur wapas aane par real day
- `projectMonthEnd` formula + 0-issue edge case
- `dispatchCalc(elapsed)` + `elapsed` na dene par purana default
- TL profile: `▼ -4%` sign parsing, T-1 projection, T-1 dispatch
- drawer HTML: growth section, till-date, `pct neg`, koi `undefined`/`NaN` nahi
- agent profile: growth + T-1 projection ≠ sheet projection
- kundli `quick()` snapshot me growth + projection
- WhatsApp + CSV export me growth / basis / projection

> Note: `dev/smoke.js` me ek **pehle se fail** hua test hai — *"professional page forecast accuracy
> backtest"* (`forecast history coverage is zero`). Ye is change se related nahi hai, `main` par bhi
> fail hota hai.
