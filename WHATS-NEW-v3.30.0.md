# 🎉 What's New — v3.30.0

> **Har agent ki request alag — address agent ka, print ek baar.** Employee link par upar sirf employee
> ka naam, neeche har agent ka block (naam · mobile · full address · pincode · class-wise qty). Admin ko
> 📥 Tag Requests me har request **ek hi row** me poore data ke saath milti hai — ☑ select karo, 🖨️ print
> karo (har label sirf ek baar), ✅ approve karo.

## 1) 🌐 Employee link (/tag-request) — sirf Form + Status

- Upar ab sirf **📝 Form** aur **🔎 Status** tab hain — "📊 Result" tab hata diya (system check ab
  submit ke saath chup-chaap hota hai).
- **👤 Employee details** — sirf **Employee name** (office ka employee jo request laga raha hai).
  Branch/Office optional (admin ON kare to). Naam isi phone par yaad rehta hai.
- **🧑 Agent block** (har agent ka alag):
  - **Agent ID / Naam** search — dropdown me agents + TL; chunte hi ID, TL, channel (🟦 FF / 🟩 GV) khud bhar jaata hai
  - **📱 Agent mobile number** · **📮 Pincode** · **🏠 Full address** (tags isi address par jayenge)
  - **Class-wise qty — VERTICAL list** (VC4 · VC5 · VC6 · VC7 · VC12 · VC16, har class ek line me) +
    har class ke aage chhota hint: `stock · MTD · 💡 suggestion` (admin chahe to OFF)
  - Agent ka total turant dikhta hai
- **➕ Add new agent** — naya block khulta hai; ek submit me max 40 agents.
- Agent data me na mile to bhi request jaati hai (🆕 "data me nahi mila" — admin verify karega);
  milta-julta naam ho to "Kya ye agent hai?" chip se ek click me sahi agent.
- **📇 Pichla address yaad** — wahi agent dobara chuno to uska pichla mobile/address/pincode khud bhar
  jaata hai (isi phone par; edit kar sakte ho).
- **Validation agent-wise** — submit par jo field adhoori hai wahi laal hoti hai (Agent 2 ka mobile
  missing → sirf wahi), pehli galti par scroll + focus. Ek hi agent do baar daala to bhi batata hai.
- Submit ke baad **✅ Done screen** — har agent ki line: naam · mobile · classes · tags · **Request ID** (📋 copy).

## 2) 🔎 Status — agent ke mobile number se

- Status tab me **agent ka 10 digit mobile** (jo request ke waqt diya tha) ya Request ID daalo.
- Us agent ki saari requests (nayi upar) — status badge, ⏳ → ✅ → 🚚 progress, class-wise
  **maanga → approved** qty, date, kisne entry ki, admin note.
- Privacy: status me **address / IP kabhi nahi** dikhta. Search rate-limited hai.

## 3) 📥 Admin — Tag Requests tab: har request EK ROW me (koi "Kholo" nahi)

Tabs ab: **📝 Form** (sirf form) · **📥 Tag Requests** (sirf requests) · **⚙️ Link & Sheet** (employee
link + Google Sheet settings — pehle ye requests ke neeche chipke hote the).

Har row me ek saath:

| Column | Kya dikhta hai |
|---|---|
| Date · ID | kab aayi + short Request ID |
| Employee | kisne request lagayi (🌐 link badge) |
| Agent | naam · ID · TL · 🟦 FF / 🟩 GV |
| 📍 Mobile · Address | agent ka ☏ mobile, poora address, 📮 PIN |
| 📦 Stock | **Total**, **🚗 VC4/VC20**, **🚚 VC5+** alag-alag |
| 📈 Issuance | **Last month**, **Current (MTD)**, **Run rate / din**, **Expected (month-end)**, **Growth %** — har ek me 🚗/🚚 split bhi |
| 🏷️ Requested | class-wise qty (agent ka maanga ~~50~~ → approved 40) |
| Total · Status | total tags, status badge, **✅ Approve** button, status dropdown, admin note |

- **✏️ Edit wahin row me** — class-wise qty badlo, nayi class jodo, admin note likho → 💾 Save
  (Enter = save, Esc = cancel). Agent ka original maanga hua qty safe rehta hai.
- Data: admin ke liye **live sheet data** (exact stock: StockDataa / Tag Assignment se VC20 alag);
  agent na mile to **submit ke waqt ka snapshot** (🟢 live · ⚪ snapshot dot).
- Growth = expected month-end vs last month (MTD vs poora mahina wali galat tulna nahi).
- Status chips (Sab / Pending / Approved / Dispatched / Rejected — counts ke saath) + search
  (agent / employee / mobile / PIN / ID).

## 4) ☑ Select & 🖨️ Print — har label sirf EK baar

- Upar toolbar: **Select all** · "N selected" · **🖨️ Print selected** · **✅ Approve selected** · **⬇ CSV**.
- Print page par **sirf chuni hui requests**, har request ka label **ek hi baar** (pehle ek hi label
  8/10/12 baar repeat hota tha). A4, 2 columns; per page **8 / 10 / 12** aur text size buttons.
- Label: **FROM** (Settings → Contacts) · **TO** = agent ka naam, mobile, address, **bada PIN** ·
  classes × approved qty = total · Request ID, date, employee, TL.
- Row ke 🖨️ / 📋 buttons se ek request ka label print / copy.
- CSV: selected rows (ya kuch select na ho to saari dikhti rows) — sab metrics + class-wise maanga/approved.

## 5) 🛠️ Server / data

- Naya payload `agents[]` → **har agent ki alag request** (apna ID / status / edit / label), ek submit
  ke saare agents ek `batch` ID se jude. Admin ko ek hi notification (saare agents ke saath).
- 🔁 Duplicate check ab **agent-wise** — kisi bhi employee ne wahi agent (ID / naam / mobile) + wahi
  class 30 din me daali ho aur wo pending/approved ho to warning ("🔁 Phir bhi bhejo" ka option).
- 📗 Google Sheet: naye columns **Agent mobile / Agent address / Agent pincode / Requested qty**;
  ek submit ki saari rows ek hi call me (order bana rehta hai). Purane config me agent columns na hon
  to ⚙️ Link & Sheet tab me hint aata hai.
- Security: non-admin owner apni pending request ki qty edit kar sakta hai, par **khud approve nahi** kar sakta.
- Request storage 500 tak; jagah chahiye ho to pehle purani dispatched/rejected hatti hain.
- Purane (cached) app se aayi `rows[]` wali request bilkul pehle jaisi chalti hai — wo table me har
  agent ki alag row me dikhti hai, label employee ke address par.

---

**Tests:** `dev/tag-request-agents.test.js` (server contract — split, validation, status by mobile,
agent-wise duplicate, inline edit, permissions, sheet) + `dev/tag-request-ui.test.js` (print ek baar,
row layout, metrics, form validation/payload). Purane tag-request tests bina badlaav pass.
