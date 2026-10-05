# FINAL — First Forward Dashboard v3.51.0 🪶🚚📊📅

> Branch `arena/01a10abb-first-forward-dashboard` · commit **`348f226`** (PR branch ready)
> Docs: `WHATS-NEW-v3.51.0.md` (release note) · `README.md` (v3.51 section) · purana final: `FINAL-v3.48.md`

---

## 🎯 Aapki 7 baatein → 7 fixes

| # | Aapki baat | Wajah (root cause) | Ab kya hota hai |
|---|---|---|---|
| 1 | 🏷️ Sheet export **chhoti** chahiye | Sheet config purani thi: **har agent × har class ki alag row** (17 columns ke saath) — 3 classes = 3 rows | Default `rowMode = 'agent'` — **ek agent = EK row**, saari classes usi cell me (`"VC4 40 · VC6 10"`) + compact column set. Purani config **ek hi baar** me migrate (kuch delete nahi; admin chahe to rowMode wapas class kar sakta hai) |
| 2 | 🔔 Notification box me **data nahi dikhta** | Panel `460×620px` tha aur andar ki list **489px par fix** — header/filters ke baad list ki jagah bachti hi nahi thi, lamba data neeche se cut | Panel `min(520px, screen) × min(86vh, 860px)`, list **poori bachi hui jagah** leti hai (scroll andar), `hidden` attribute fix, mobile par **poora screen**, detail table wrap + horizontal scroll |
| 3 | 👥 TL naam par **TL ka data** nahi aata | Index me TL record banta tha par lookup sirf **agents** me dhoondhta tha — TL ka naam type karne par kuch nahi milta tha | `findTlRecord()` — agent na mile to TL (FF → GV). TL select karte hi **VC4 · VC20 · VC5+** ka **stock / last month / current MTD** + **🎯 dono suggested qty** (`After stock` · `W/o stock`). VC20 = 🚗 core (VC4+VC20) − VC4 |
| 4 | 🚚 Courier naam select ho aur **label par** chhape | Courier field hi nahi thi — na form me, na server par, na label par | Form dropdown (**Delhivery / DTDC** + Settings ki list, last value yaad), naam **print label · colourful label · PDF** teeno par, admin ke **📥 Requests** row me per-request dropdown (approve se pehle badal sakte ho), sheet me alag column, employee link ke liye ON/OFF + list setting |
| 5 | ⚙️ Settings **Google Sheet me save** rahe | Persistence pehle se thi (`APP_STORAGE`, encrypted) — par UI kabhi batata nahi tha ki data kahan gaya | Save karte hi toast: **“Settings saved ✓ · ☁️ Google Sheet me permanent save ✓”**; storage temporary ho to **⚠️ warning** (Render disk) — confusion khatam |
| 6 | 🔎 “Suggested dispatch qty” sab me **0** | Upar ke box `sugCell()` se settings ke mode par chalte the — mode `net` hone par sirf net dikhta tha, aur stock zyada hone par `net = max(0, required − stock) = 0` → **gross (jo neeche table me tha) chhup jaata tha** | Kundli stats + 🏷️ Tags-required box + masterProfile KPI tile — sab me **hamesha dono** number (`After stock` · `W/o stock`), mode se farak nahi |
| 7 | 📅 **Date-wise trend** + search bar + 5-Oct hatao | Master Search me trend code hi nahi tha; FF Trend page dono channel mila kar dikha raha tha aur aaj ki row bhi | Master Search me naya **📅 Date-wise issuance trend** card (apna search bar + suggestions, 🧑‍💼/👥, FF/GV/Dono, mahina, roz ka table + chart, cumulative). Kisi ka profile kholte hi card usi naam par set. **Aaj ki date kabhi nahi** (FF T+1; GV bhi kal tak) — FF Trend page bhi ab **default FF-only** + aaj ki rows excluded |

---

## ✅ Kaise use karein (aapke liye 30 second)

| Kya chahiye | Kahan |
|---|---|
| Sheet chhoti (ek agent = ek row) | **🏷️ Tag Request → 📗 Sheet** card — pehla option hi “🪶 Har agent ki EK row” |
| Courier select / list badalna | **🏷️ Tag Request → 📲 Tag Request (employee link)** card → “🚚 Courier select” checkbox + names list |
| Dispatch par courier chhapana | Form → 🚚 Courier chuno → 🖨️ Print / 🎨 Colorful Label / 📄 PDF |
| Approve se pehle courier badalna | **📥 Tag Requests** row ka 🚚 dropdown (naya column bhi) |
| TL ka poora class-wise data | Employee link par **TL ka naam** type karo (ya TL chip) → 👥 panel me 📊 table |
| Date-wise trend | **🔎 Master Search** → niche **📅 Date-wise issuance trend** — naam likho, mahina chuno |
| Settings safe hain ya nahi | Save karte hi toast padho — ☁️ = Google Sheet me permanent |

---

## 🔧 Files badle

| File | Change |
|---|---|
| `server.js` | `PUBLIC_TAG_DEFAULTS.askCourier`/`couriers` + `courierList()`; courier POST/PUT/list/dono config PUTs me; `TAG_SHEET_DEFAULT_COLUMNS` (compact, courier ke saath) + `rowMode 'agent'` default + **v1 → v2 migration**; `tagSheetRows()` agent mode me classes/qty/sums merge (`"VC4 25 · VC6 4"`); `APP_VERSION` fallback 3.51.0 |
| `tagRequest.js` | `findTlRecord()` (+ `findAgent`/`exactAgent` me fallback), `classBreakdownRows()`/`classBreakdownHtml()` (VC20 = core − VC4) — TL panel + agent summary me; 🚚 courier: `courierOptions()`/`loadCourier()`/`saveCourier()`, form select (optional, khaali = label par nahi), label/colorful/PDF me courier, admin table `<th>🚚 Courier</th>` + badge + per-row select → `PUT /api/tag-requests/:id {courier}`, `requestColumnCount()` = 17 + admin?2, sheet card agent-first + public card `askCourier`/`couriers` |
| `masterSearch.js` | Suggested dispatch ke saare boxes me **dono** number (After stock · W/o stock) + 🏷️ tags-required box; naya **📅 date-wise trend card** (search bar + suggestions, agent/TL, FF/GV/Dono, mahina, chart, roz ka table, cumulative footer) — aaj ki rows excluded; profile khulte hi trend card usi par |
| `masterProfile.js` | `sugPairHtml()` ab **hamesha dono** (net + gross) dikhata hai (KPI tile me 0 wala confusion khatam) |
| `trend.js` | FF Trend page: 🟦 **default FF-only** (pehle FF+GV mila hua tha), channel selector, **aaj ki rows kabhi nahi** (+ “aaj ki N rows hatayi” note) |
| `settings.js` | Save ke baad toast/message me storage jagah — ☁️ Google Sheet vs ⚠️ server disk |
| `styles.css` | Notification panel sizing (desktop + mobile) + detail table wrap; `.tr-class-tbl`/`.tr-class-head`/`.sug-chip`/`.tr-form-extra`/`.tr-c-courier`; `.sug-pair-tight`; master search trend card CSS |
| `index.html` · `sw.js` · `package.json` | v3.51.0 · sw cache **`apnapayment-v107`** · `styles.css?v=105` · `config.js?v=103` · sw ASSETS me masterProfile/masterSearch `?v=99` |
| `dev/v351-tagreq-sheet-courier.test.js` · `dev/v351-tagreq-tl-courier.test.js` | **Naye regression tests** (neeche) |
| `dev/tag-request-ui.test.js` · `dev/v350-tagreq-recover.test.js` · `dev/pwa-mobile-shell.test.js` | colspan 19 + version/cache pins |
| `WHATS-NEW-v3.51.0.md` · `README.md` | Release note + README v3.51 section |

---

## 🧪 Verification

| Check | Result |
|---|---|
| `npm run check` | ✅ `syntax ok` (server + saare 60+ browser modules) |
| `node --test dev/*.test.js` | **464 pass / 472** — 8 failures **pehle se** (clean `HEAD` worktree par bhi same 8) fail hote hain — is release se unrelated (purane wiring/lazy cache-bust tests) |
| `dev/v351-tagreq-sheet-courier.test.js` | ✅ **2/2** — default `rowMode=agent` + compact columns, ek agent ki 2 classes **ek hi row** me (`VC4 25 · VC6 4`, approved 29), courier sheet column + admin change/clear, employee-link courier list, purani **v1 config ka migration** |
| `dev/v351-tagreq-tl-courier.test.js` | ✅ **2/2** — TL naam se TL record, class-wise numbers (**VC20 = core − VC4**, Total = core + comm, dono suggested chips), courier ka payload / print label / admin row dropdown |
| Tag-request family (7 files) | ✅ **21/21** (sheet sync, UI, agents, public link, recovery, stock board) |
| Wiring tests (naye version ke saath) | ✅ `pwa-mobile-shell` · `v350-tagreq-recover` — version + cache pins pass |
| E2E smoke (mock Sheets + mock Apps Script, live preview) | ✅ Tag Request (form + sheet card + labels), Public link, Master Search, Trend, Notification, ageing, drills — sab render. Ek purana smoke-step `outerHTML` getter par girta hai (**HEAD par bhi same**) → unrelated |
| HTTP checks (chalte server par) | ✅ `/api/health` → `version 3.51.0` · `styles.css?v=105` → 200 · `masterSearch.js` → 200 · `GET /api/tag-request-sheet` → `rowMode agent`, `v 2`, `courier` column · `GET /api/public/tag-request` → `askCourier true`, `['Delhivery','DTDC']` |

---

## 🚀 Deploy (Render)

1. Branch `arena/01a10abb-first-forward-dashboard` → `main` me merge → Render auto-deploy.
2. Deploy ke baad **ek baar reload** (phone par app band khol ke) — cache bump `apnapayment-v107`
   hai, isliye naye courier dropdown, TL ka class-wise table aur master search ka trend card turant aa
   jayenge.
3. Pehli baar **🏷️ Tag Request → 📗 Sheet** kholein — config apne aap chhote (agent) mode me
   migrate hui dikhegi. Purana behaviour chahiye to **rowMode** wahin se badal dein.
4. Google Sheet wale exports me ab `🚚 Courier` column bhi aayega — pehli entry par header apne aap
   likha jaata hai (purane tab me bhi).

---

## 🔖 Commit

| Commit | Kya |
|---|---|
| **`348f226`** | v3.51 — chhoti sheet + courier + TL class-wise + date-wise trend + notification box fix (14 files, +394/−66, 2 naye test files) |
| `25f9deb` | Is branch ka base (main ka aakhri commit) |

---

### Ek line me

**Sheet ab chhoti (ek agent = ek row), courier label par chhapta hai, TL ka poora class-wise data aata hai, “0” wala bug gaya, master search me date-wise trend aa gaya (aaj ki date ke bina), aur notification box poora data dikhata hai — settings Google Sheet me pehle se safe hain, ab screen bhi bolti hai.**
