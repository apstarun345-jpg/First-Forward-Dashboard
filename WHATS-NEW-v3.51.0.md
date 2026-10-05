# v3.51.0 — 🪶 chhoti sheet + 🚚 courier naam + 📊 TL ka class-wise data + 📅 master search trend

Aapki 7 baatein, sab is release me. Har ek ka **problem → kya hua tha → ab kya hota hai** neeche hai.

---

## 1. 🏷️ Tag Request → Google Sheet ab bahut CHHOTI rehti hai (ek agent = ek row)

**Problem:** ek agent ki VC4 · VC6 · VC12 … sab alag-alag rows me jaati thin (aur saath me 17 columns)
— sheet bahut lambi aur chaudi ho jaati thi.

**Ab:**
- Naya **default `rowMode = agent`**: ek agent ki **saari classes usi ek row** me ek hi cell me —
  `"VC4 40 · VC6 10"` — aur qty (approved), stock, current, courier, status usi row me.
- **Compact column set** default: `Date · Time · Request ID · By · Agent · Agent ID · Agent Mobile ·
  Agent Pincode · TL · Channel · Classes · Stock · Current · Approved · 🚚 Courier · Status`
  (pehle wale lamba `remark` / `priority` / `agentAddress` jaise columns default list me nahi —
  chahein to **📗 Sheet card** se wapas ON kar lo).
- **Ek hi baar ka migration:** purani installs (jinki config class-wise rows + lambe columns par thi)
  apne aap naye chhote default par aa jaati hain — kuch delete nahi hota, admin chahe to **rowMode**
  badal kar purana behaviour wapas laga sakta hai (`Har agent × class ki alag row`).
- Sheet card par pehla option hi ab wahi hai: **“🪶 Har agent ki EK row — saari classes usi row me
  (default, sheet chhoti rehti hai)”**.

## 2. Notifications ka box — data poora dikhne laga

**Problem:** 🔔 notification panel chhota tha (`460px` × `620px`, andar ki list `490px` par fix) —
lamba data neeche se cut ho jaata tha aur "data dikh hi nahi raha" lagta tha.

**Ab:** panel `min(520px, screen)` chauda aur `min(86vh, 860px)` uncha, andar ki list **poori bachi
jagah** leti hai (scroll usi ke andar), `hidden` attribute ko CSS override nahi karta, aur entry ki
detail table (kd-tbl) apne aap wrap + horizontal-scroll karti hai. **Mobile par poora screen** —
`top:58px → bottom:8px` (pehle sirf right:10px tha, isliye chhote phone par cut hota tha).

## 3. 👥 Employee link — TL naam likhte hi TL ka poora class-wise data

**Problem:** TL ka naam type karne par sirf agent-level data aata tha; TL ka **class-wise**
(VC4 · VC20 · VC5+) stock / last month / current month aur suggested qty kahin nahi dikhta tha.

**Ab:**
- `findTlRecord()` — agent nahi mila to **TL naam** se TL record pakda jaata hai (FF pehle, phir GV;
  channel chuna ho to wahi). Ye `findAgent` + `exactAgent` dono me laga hai, isliye typing aur
  submit dono me TL ka data turant aata hai.
- TL select karte hi 👥 panel me naya **📊 class-wise table**
  (`VC4 · VC20 · VC5+ · Total` × `Stock · Last month · Current MTD`) + **🎯 dono suggested qty**
  chips — **“After stock”** aur **“W/o stock”** (bina stock ghataye).
- **VC20 = 🚗 core (VC4+VC20) − VC4** — kyunki EIR me VC20 ki apni class-row nahi hoti; isliye dono
  number sahi dikhte hain, koi class chhupti nahi.
- Wahi table agent ke summary me bhi (pehle sirf 3 jodi hui lines thi).

## 4. 🚚 Courier naam (Delhivery / DTDC) — select karo, label par chhape

**Problem:** dispatch label par courier ka naam nahi aata tha.

**Ab:**
- **Form me dropdown:** 🚚 Courier (settings ki list + default **Delhivery / DTDC**; select kiya hua
  naam yaad rehta hai, dobara select karne ki zarurat nahi).
- **Label par**: normal print + 🎨 Colourful Courier Label + 📄 Download PDF — teeno me courier naam
  (PDF me PIN Code ke baad `Courier - DTDC` line).
- **📥 Requests table** me admin ke liye naya **🚚 Courier column** (badge) aur **per-request dropdown**
  — approve/dispatch se pehle hi courier badal sakte ho (khaali karke hata bhi sakte ho).
- **Sheet me column** — `🚚 Courier` (request ke saath jaata hai; rowMode agent me bhi).
- **Employee link ki setting:** 📲 Tag Request card me **“🚚 Courier select (Delhivery / DTDC…) — label
  par chhapta hai”** checkbox + courier names ki list (comma se) — admin kabhi bhi ON/OFF ya list
  badal sakta hai. OFF karne par employee form me dropdown nahi dikhta.

## 5. ☁️ Settings Google Sheet me save — ab saaf dikhta hai

Settings/user/session pehle se hi `notify`/`settings` record ke through **Google Sheet ke
`APP_STORAGE` (encrypted)** me save hote hain (Render disk par nahi). Ab **Save karte hi toast hi
bata deta hai**: “Settings saved ✓ · ☁️ Google Sheet me permanent save ✓” — ya agar storage temporary
(server disk) hai to **⚠️** warning, taaki kabhi confusion na ho ki settings ud gayi. Settings →
**☁️ Storage & backup** tab me status, purani saves aur ⏪ restore pehle se maujood hain.

## 6. 🔎 Master Search — “Suggested dispatch qty” ka 0 vala bug

**Problem:** upar ke box me suggested dispatch sirf **stock ghata kar (net)** number dikha raha tha —
stock zyada hone par wo **0** aata tha, jabki neeche ki table me “without stock deduction” ka number
pada hota tha. Isliye “sab me 0 hai” lagta tha.

**Ab:** ye boxes **hamesha dono number** dikhate hain — **`After stock`** aur **`W/o stock`** — settings
ka mode kuch bhi ho (`Sug. VC4`, `Sug. Comm.`, `🎯 Dispatch all tags` aur 🏷️ Tags-required wala box bhi).
Net ka matlab ab bhi wahi hai (required − stock, 0 se neeche nahi jaata) — par gross chhupa nahi rehta.

## 7. 📅 Master Search me date-wise issuance trend + FF trend se aaj/GV hataya

**Ab naya card:** **🔎 Master Search → 📅 Date-wise issuance trend** — apna **search bar**
(agent ya TL, suggestion dropdown ke saath), 🧑‍💼/👥 toggle, 🟦 FF / 🟩 GV / Dono, mahina selector,
chart aur roz ka table (`VC4 · VC20 · VC5+ · Total · Cumulative`, footer me total). Kisi ka profile
kholte hi ye card **usi naam par set** ho jaata hai.

**Aur:** aaj ki date (jaise 5 Oct) ki koi row **kabhi nahi** dikhti — FF ka data T+1 aata hai aur GV
bhi is trend me kal tak hi. **FF Trend page** ab default **🟦 First Forward only** hai (pehle usme GV ka
data mila hua tha) aur wahan bhi aaj ki rows nahi jaati; GV ka apna ⚙️ GV Trend page alag hai.

---

## Cache / version

- **`package.json` v3.51.0** · `server.js` ka version fallback bhi 3.51.0.
- Service worker cache **`apnapayment-v107`**; `styles.css?v=105`, `config.js?v=103` (lazy modules ke
  liye), `masterProfile.js` / `masterSearch.js` sw ASSETS me `?v=99`.
- Deploy ke baad ek baar reload kar lo (phone par app band khol ke) — naye courier dropdown, TL ka
  class-wise table, master search ka trend card turant dikhenge.

## Tests (naye)

- `dev/v351-tagreq-sheet-courier.test.js` — default `rowMode=agent` + compact columns (courier ke
  saath), ek agent ki do classes **ek hi row** me (`VC4 25 · VC6 4`, approved 29), courier sheet
  column + admin change/clear, employee-link courier list, aur **purani v1 config ka migration**.
- `dev/v351-tagreq-tl-courier.test.js` — TL naam se TL record, class-wise table ke numbers
  (`VC20 = core − VC4`, Total = core + comm, dono suggested qty chips) aur courier ka
  form payload / print label / admin row dropdown.
- `dev/tag-request-ui.test.js` me admin table ka `colspan=19` (🚚 Courier column) update.
- `dev/v350-tagreq-recover.test.js` + `dev/pwa-mobile-shell.test.js` — naya version + cache bump.

Poora suite: `npm test` (8 purane, is release se pehle se fail hone wale wiring/lazy tests chhod kar
sab green).
