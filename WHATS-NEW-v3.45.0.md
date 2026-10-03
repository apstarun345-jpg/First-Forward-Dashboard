# WHAT'S NEW — v3.45.0 · 🧾 GV sheets ka sahi column recognition + 🎨 Agent/TL Summary ka poora naya interface

## 1) 🧾 GV Master aur GV REPORT — ab heading padh kar column pakadte hain (asli fix)

Pehle GV sheets ke numbers **sirf config ke column letters** par padhe jaate the. Sheet me ek column
aage-peeche (ya ek naya column beech me) hone par number **chup-chaap galat** aata tha — isi wajah se
GV page par stock / last month / this month ke aankde match nahi karte the.

- **🧭 Heading-aware mapping:** `gv.js` ab GV Master, Tag Assignment aur GV REPORT ki **heading row**
  padhta hai. Config letter ki heading expected jaisi ho → wahi column; warna **heading se sahi column**
  dhoondha jaata hai (nearest-index preference + typo/abbreviation tolerance — `Expacted In Month`,
  `Total Issunce`, `Suggested Dispatch Quantity` jaise asli headings bhi match hote hain).
- **🚨 Data-row-as-heading trap:** kabhi gviz label me heading ki jagah pehli **data row** aa jaati hai.
  Aise case me app dobara poora pehla page maangti hai; phir bhi headings na milein to **config letters**
  par chalti hai (relocation nahi karti) — chup-chaap galat column padhna band.
- **📦 Stock ka matlab:** Tag Assignment me column D (TAG_STATUS) ke hisaab se **out-of-stock**
  (issued / returned / cancelled…) rows stock me **nahi** ginte, par count kabhi chhupaya nahi jaata —
  `nAll` + `byStatus` se poora hisaab milta hai.
- **🔍 Settings → 🗂️ Sheets & tabs → "🧭 GV column heading check":** har field kis column se padha gaya,
  kaunsi heading se, aur koi warning ho to — sab yahin dikhta hai. "🔎 Ab check karo" se GV data load
  karke turant verify kar sakte ho.

## 2) 🎨 Agent / TL Summary — poora naya interface (GV + FF dono)

- **Gradient hero:** channel (🟩 GV / 🟦 FF), Agent ya TL, ID, TL naam, mobile, direct/priority/activity
  badges, aur export buttons (PDF · Excel · CSV · WhatsApp · Copy — permission ke hisaab se).
- **KPI cards (clickable):** Issuance · Last month · Today · Stock in hand · Expected (month-end) ·
  Active days · Replacement/Chassis · GV REPORT sheet. Har card par **cross-check chip** —
  `GV REPORT sheet 5 (+21)` yani sheet ka number aur final se farq. Card click = us number ke **neeche ki
  asli rows** ek drawer me (GV Master tags: **VRN barcode · TAG_ID · serial · date · class · status**),
  CSV download ke saath.
- **🧭 "Ye numbers kahan se aaye":** teen source cards — GV Master (FINAL), Tag Assignment (FINAL stock),
  GV REPORT (CROSS-CHECK) — kya role hai, kaunse column se aaya, sab likha hua.
- **🧮 Sheet vs Ledger table:** har metric ka final number, sheet ka number aur **farq** (+/-) ek hi
  jagah — kuch bhi chhupa hua nahi.
- **🚗 Class-wise table (colour bars), 📈 6-mahine trend, 👥 TL ke agents ki table** (ledger + stock +
  sheet column), **⏳ stock ageing** (background me aati hai), **🔍 Data check** panel (GV Master /
  GV REPORT / Tag Assignment ki headings, mapping, rows aur differences).
- Search pehle jaisa hi: naam · agent ID · TL ID · mobile · suggestions; FF page bhi wahi naya design
  (EIR + StockDataa final, REPORT sheet cross-check).

> **Truth rule (GV Summary):** final number **GV Master ke tag rows** ka hai (user rule), GV REPORT sirf
> cross-check/explanation. Baaki GV views (Performance / 360 board / Master Search) me sheet-first rule
> barkarar hai — aur farq hote hi note me `sheet X vs tag ledger Y (Δ ±Z)` dikhta hai.

## 3) 🧪 Tests

- Naya **`dev/gv-truth.test.js`** (9 tests): heading se column recognition + column-shift relocation,
  data-row-as-heading fallback, status-aware stock, ledger-final vs sheet cross-check, tag-level drill
  (VRN/TAG_ID/serial), TL ka own + agents stock, team rollup aur placeholder (Unassigned) ordering.
- Smoke me naya **v3.45 · Agent/TL Summary v2** test (dono page render + KPI click + drill rows).
- `npm test` → **437 pass / 0 fail**.
