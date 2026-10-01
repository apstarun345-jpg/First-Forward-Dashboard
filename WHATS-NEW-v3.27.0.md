# What's new — v3.27.0 🌐 Employee link (bina login) · 📗 Tag request kisi bhi Google Sheet me

Aapki do requests — dono ho gayi hain.

---

## 1) 🌐 Employee link — ab login/signup ki zaroorat NAHI

Pehle: employee link kholne par login screen aata tha, account chahiye tha, permission chahiye thi.
Ab: link kholte hi **seedha form**.

**Link:** `https://<aapki-site>/tag-request`  (purana `#/tagRequest?public=1` bhi chalta hai)

Link Tag Request page par **🔗 Employee link** button se copy hota hai (ya
📥 Tag Requests tab ke **🌐 Employee link** card se) — WhatsApp button bhi wahin hai.

### Employee kya dekhta hai

1. **👤 Aapka naam (zaroori)** — card sabse upar, mandatory. (Mobile optional; Branch/Office optional —
   admin chahe to on/off kare.) Naam ek baar bharne ke baad browser yaad rakhta hai, agli baar apne aap
   bhar jaata hai.
2. 📝 **Form** — agent ID/naam search (dropdown me agents + TL), class-wise qty (VC4 · VC5 · VC6 · VC7 ·
   VC12 · VC16), ek saath kai agents.
3. 🔍 **System check** — sheet se last month + current MTD issuance, stock, cover days, growth, priority
   aur suggested qty — bilkul jaisa logged-in form me hota hai.
4. 📤 **Request submit karo** → success screen par **Request ID** (copy button ke saath).
5. 🔎 **Status tab** — Request ID daalo → ⏳ Pending / ✅ Approved / 🚚 Dispatched / ⛔ Rejected + admin note.

Employee ko **dashboard ka koi doosra page nahi dikhta** — na sidebar, na Home, na stock/performance.

### Admin ko kya milta hai

- Request **🏷️ Tag Request → 📥 Tag Requests** me aati hai: **🌐 employee link** badge, employee ka naam,
  mobile, office, IP, rows/agents/total qty, status.
- Notification (bell + phone push, agar ON ho) + audit log entry (`tag_request_public_created`).
- Request drawer me **📗 Sheet me push**, status/qty edit, delete — sab pehle jaisa.
- **Employee link card** (Tag Requests tab me, admin only):
  - link **ON/OFF** (OFF karte hi link par "ye form band hai" dikhta hai),
  - form ka **title** aur upar ka **message**,
  - **mobile** / **branch** field on-off,
  - **"System check dikhao"** toggle — OFF karne par employee ko sirf agent + class + qty ka simple table
    dikhta hai (stock/issuance/suggestion columns chhup jaate hain).
- Employee ka **status** wahin se badalta hai — jo status admin set karega, employee ko Request ID se dikhega.

### Security / galti se bachav

- Public link ke liye alag **scoped** endpoint: `/api/public/gviz` — sirf EIR · REPORT · GV REPORT tabs,
  EIR (customer-level VRN/tag ledger) par **sirf aggregated (group-by) queries** — poori row dump kabhi nahi.
  Poora dashboard wala `/api/gviz` **pehle jaisa login-protected** hai.
- Per-IP throttle: form submit 15/hour, data queries 120/10 min. Rows ≤ 60 (configurable), qty limits,
  naam validation, request ID random.
- Public link se dashboard ka koi protected page/endpoint nahi khulta (sab bina-cookie par 401).

---

## 2) 📗 Tag request → **alag Google Sheet** me direct entry

Ab aap **kisi bhi Google Sheet** ka **link + tab ka naam** dekar entries wahin bhej sakte ho.

**Tag Request page → 📥 Tag Requests tab → 📗 Google Sheet me direct entry card**

| Field | Matlab |
| --- | --- |
| Alag Google Sheet ka link | `https://docs.google.com/spreadsheets/d/…` (ya seedha sheet ID). Khaali chhodo = jis sheet me Apps Script hai usi me entry. |
| Sheet ke andar ka tab | e.g. `Tag Requests` — tab na ho to pehli entry par ban jaata hai (header row bhi likhi jaati hai). |
| Kaunsi rows | Har agent × class / har agent ki ek row / har request ki ek total row |
| Kab entry | Nayi request par · status change par (approved/dispatched) |
| Columns | 21 columns me se jo chahiye (Date, By, Agent, TL, Class, Stock, Approved, Status…) |

Extra:

- **🔌 Sheet check karo** — batata hai ki Apps Script zinda hai, target sheet ka naam kya hai, tab hai ya
  nahi, aur **purana Code.gs** deploy hai to warning deta hai. Entry galat sheet me chup-chaap na jaye —
  response ka sheet URL verify hota hai, mismatch par request me **📗! fail** reason ke saath dikhta hai.
- **Employee link se aayi requests bhi** usi sheet me jaati hain.

### Do zaroori cheezein (ek baar ka kaam)

1. **Apps Script ka naya code deploy karo:** `google-apps-script/Code.gs` (v3.27) copy karo → Apps Script
   editor me paste → **Deploy → Manage deployments → Edit → Version: New version → Deploy**.
   (Settings → Backup se bhi code copy ho jaata hai.) Isi me `openById` + `sheettest` action hai.
2. **Us alag sheet par Apps Script wale Google account ko Editor access do** (Sheet → Share).
   Warna Apps Script "Sheet ID nahi khuli" error dega.

---

## Iske alawa (chhote sudhaar)

- Employee share drawer ka text ab "login zaroori hai" nahi kehta — "naam likho, bas".
- Public form mobile par halka hai: sirf 4 chhoti aggregate queries (poora preload nahi), isliye slow
  network par bhi jaldi khulta hai.
- `sw.js` cache version bump (`apnapayment-v57`) + asset `?v=51` — purana cached code confuse nahi karega.
- Naye tests: `dev/public-tag-request.test.js` (public submit · status · admin visibility · scoped gviz ·
  link ON/OFF · per-IP throttle · alag sheet me entry) + smoke test me public form/result/status render.

Poore site ke liye **kya-kya naya add ho sakta hai** — dekho [FEATURE-IDEAS.md](FEATURE-IDEAS.md).

---

## 🔔 v3.27.1 — admin notification + 🔁 duplicate warning (employee ko)

**1) Form submit hote hi admin ko notification** — pehle se hi aata tha (bell + toast + phone push), ab
verify + upgrade bhi ho gaya:

- Bell list me item: **🏷️ Tag request (employee link) · <naam>** — body me rows, agents, tags, mobile/branch.
- Notification par click → seedha **Tag Request → 📥 Tag Requests** (`#/tagRequest?view=requests`).
- 📱 Phone push bhi jaata hai (agar admin ne push ON kiya ho: 🔔 → "Mobile push ON").
- Android/Chrome me alerts ke liye: 🔔 Bell → **Mobile push ON** karo (ek baar).
- Purani requests ke liye bell me "request" type ON hona chahiye (Settings → Notifications me default ON hai).

**2) 🔁 Duplicate entry par employee ko warning (aur admin ko mark)** — naya:

- Employee "Request submit karo" dabata hai → app pehle **check** karta hai: isi naam se 30 din me koi
  **active (pending/approved/dispatched)** request hai jisme **same agent + class** ho?
- Mili to submit ruk jaata hai aur upar amber warning card aata hai:
  *"🔁 Ye entry pehle se hai"* — purani request ka **Request ID, status, total, kitne din purani** + same
  row ka detail. Saath me 3 button:
  - **🔎 Status dekho** → usi Request ID ka status view khul jaata hai,
  - **🔁 Phir bhi bhejo** → aapki marzi, nayi request fir bhi jaati hai (admin ko 🔁 mark ke saath dikhegi),
  - **✏️ Form me wapas** → rows badal lo.
- Warning me **rejected/cancelled** requests count nahi hoti (dobara maangna sahi hai) aur 30 din purani
  requests bhi ignore hoti hain.
- Naam case/space se compare hota hai (`Ramesh yadav` = `Ramesh Yadav`), aur IP limit 90 checks / 10 min.
- Phir bhi bheji gayi request par admin ke bell notification ka title **🔁 duplicate** ho jaata hai, aur
  📥 Tag Requests list/folder me **🔁 duplicate** badge + *"Duplicate mark: milti-julti active request pehle
  se thi — tagreq_…"* line dikhti hai (taki admin usko merge/ignore kar sake).

**Naya endpoint:** `POST /api/public/tag-request/check` → `{ employee, rows }` →
`{ ok, duplicates: [{ id, at, status, total, rows, matched }] }` (bina login, throttled).
POST `/api/public/tag-request` ki response me bhi ab `warnings: [{ code:'duplicate', ... }]` aata hai.

Aage kya-kya ban sakta hai (issuance · stock · agents ke asli columns ke hisab se) — dekho
[FEATURE-IDEAS.md](FEATURE-IDEAS.md) ka naya section **2.5️⃣**.
