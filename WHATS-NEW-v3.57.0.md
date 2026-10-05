# ✨ v3.57.0 — 👤 Meri requests employee link ke Form tab par + 📇 purana address suggestion

Revert PR **#104** ne pichhla v3.57.0 ("Meri requests quick chip employee link Form tab par") hata diya tha.
Ye release wahi kaam **dobara, poora** karta hai — sirf chip nahi, balki employee link par ek proper
request-history panel, aur saath me 📇 purana address suggestion.

## 🌐 Employee link — ab employee apni requests KHUD dekh sakta hai
Pehle employee link kholte hi sirf **📝 Form** dikhta tha; apni requests dekhne ke liye employee ko
**🔎 Status** tab kholna padta tha (aur wahan bhi agent ka mobile number ya Request ID likhna padta tha).
Ab **wahi Form page par**, employee details ke neeche, **"👤 Meri requests"** panel hai:

- **Band panel me hi status counts** dikhte hain — `📋 All 12 · ⏳ Pending 3 · ✅ Approved 5 · 🚚 Dispatched 3 · ⛔ Rejected 1`.
  Ek nazar me pata chal jaata hai kitni request kis stage me hai.
- **Kholne par poori list**: `All / Pending / Approved / Dispatched / Rejected` — jis par click karo, sirf wahi
  status ki requests dikhti hain (har filter par apna count).
- **10-10 ke batch** me list, `← Previous` / `Next →` ke saath, aur `1–10 / 23` jaisa page indicator.
  Aakhri page par **Next** apne aap disabled, pehle page par **Previous** disabled.
- **↻ Refresh** — admin ne status badla ho to employee khud taaza status le sakta hai.
- Har request card par: status badge · ⏳→✅→🚚 progress steps · class-wise qty (admin ne qty badli ho to
  `25 → 20` strikethrough ke saath) · date · Request ID · 💬 **admin note**.
- Request submit karte hi panel **apne aap khul jaata hai** aur nayi request sabse upar dikhti hai.
- Filter/page badalne par **sirf panel** dobara banta hai — form ke bhare hue fields aur cursor ki jagah
  chhute nahi (poora form re-render nahi hota).

### Kya nahi badla / privacy
- Ye panel **sirf employee link** (`/tag-request`) par hai, aur **sirf tab** jab us device ne pehle kabhi
  request lagayi ho (device par ek private token save hota hai). Login wale form par ye nahi dikhta — wahan
  admin ke liye **📥 Tag Requests** tab pehle jaisa hi hai.
- Ek employee ka token **doosre employee ki request nahi** dikhata (test me lock kiya gaya hai).
- Response me employee/agent ka **address · pincode · IP kabhi nahi** jaata — sirf status · classes · qty ·
  admin note.

## 📇 Purana address suggestion — same agent dobara chuno to address khud suggest
Ek baar request lagane ke baad, **wahi agent** kabhi bhi dobara chuno to uska **purana mobile · address ·
pincode** suggest hota hai:

- Agent card me ek **dashed chip** dikhta hai: `📇 Address book se purana address mila — 📱 98765… · 🏠 12, Gandhi Nagar… · 📮 302015`.
  **Chip par click** karte hi teeno fields bhar jaate hain.
- Do sources: **isi device** ki address book (turant, offline bhi) + **server-side Address book**
  (`/api/public/tag-request/contact`) — isliye **doosre device / doosre browser** par bhi purana address
  milta hai, sirf localStorage tak seemit nahi.
- Chip **tab bhi dikhta hai jab employee ne khud kuch type kiya ho** — purana address dekh kar khud decide
  kare. **Auto-fill sirf khaali fields me** hota hai; bhara hua kuch chup-chaap overwrite nahi hota.
- Purana address pehle se same bhara ho to chip khud hat jaata hai (bekar chip nahi dikhta).

## 🐛 Fix — "✅ Approved tags" galat number dikha raha tha
`GET /api/public/tag-request/employee-status` ka `approvedTags` **sabhi** requests ka `approved` qty jodta
tha. Submit par `approved = requested` hota hai, isliye **bina approve hue bhi** "31 approved tags" dikhta
tha. Ab ye **sirf un requests** ka jod hai jinka status sach me `approved` ya `dispatched` hai.
(Test pehle is endpoint ke liye tha hi nahi — isliye bug pakda gaya jab test likha.)

## ✅ Verification
- `dev/tag-request-ui.test.js` — 3 naye tests: Form tab par panel (All + 4 status filters, exactly 10 rows
  per page, `1–10 / 23`, prev disabled / next disabled, collapsed summary me counts), bina token / login
  form par panel **nahi** (leak nahi), aur 📇 purana address chip (khud type kiya ho tab bhi dikhe, same
  address bhara ho to chhupe, khaali record par na dikhe).
- `dev/public-tag-request.test.js` — 1 naya **end-to-end** test (asli server + mock Apps Script):
  submit → `employeeToken` → employee-status counts → doosri request → admin `PUT /api/tag-requests/:id`
  approve → counts badalte hain → 📇 purana address `/api/public/tag-request/contact` se milta hai →
  doosra employee apni hi request dekhta hai → bina/galat token `400`.
- `npm run check` → **syntax ok** · `npm test` → **498 pass / 0 fail** (baseline 494).
- Wiring: package/API **3.57.0**, `config.js?v=109` (lazy `tagRequest.js` isi se load hota hai),
  `styles.css?v=110`, service-worker cache `apnapayment-v113`.
