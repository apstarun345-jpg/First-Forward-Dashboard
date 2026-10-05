# ✨ v3.57.0 — 📋 "Meri requests" quick chip employee link ke Form tab par

## 🌐 Employee tracking ab form ke upar se hi dikhta hai

- Employee link (bina login wala form) ke **📝 Form tab** ke sabse upar naya **📋 Meri requests** chip —
  jis device se pehle request lagi hai wahan turant **⏳ pending · ✅ approved · 🚚 dispatched · ⛔ rejected · 📋 total**
  counts dikhte hain. Counts background me load hote hain aur **bina page reload** chip par update ho jaate hain
  (typing/focus safe — poora form re-render nahi hota).
- Chip par click = seedha **🔎 Status** tab — jahan v3.54.0 wali poori history hai:
  **📋 All requests + ⏳ Pending / ✅ Approved / 🚚 Dispatched / ⛔ Rejected** clickable filters (live counts ke saath),
  **10-10 request ke pages** aur **← Previous / Next →** controls ("Page X of Y" ke saath).
- Admin/login mode me chip nahi aata; bina employee token (naya device/browser) ke bhi nahi — privacy wahi token-scoped
  rule jo pehle se tha.

## 📇 Address suggestion (pehle se live — dobara confirm)

- Ek baar request lagane ke baad **wahi agent** dobara chunte hi pichhla **mobile / address / pincode auto-suggest**
  hota hai — device ki Address book + server-side Address book dono se (doosre browser/device par bhi), saath me
  "📇 pichli request se auto-fill hua" note verification ke liye.

## ✅ Regression coverage

- `dev/tag-request-ui.test.js`: quick chip ka render (counts, loading text), sirf public + token hone par dikhe,
  admin mode / bina token me na aaye — saath me v3.54.0 ke filters/pagination tests pass.

## 🔧 Cache/version

`package.json` / `/api/health`: **3.57.0**; `config.js?v=109` (saare lazy modules isi se refresh — tagRequest.js
samet), `styles.css?v=110`, service-worker cache `apnapayment-v113`. Purane device par ek baar hard-refresh
(Ctrl/Cmd+Shift+R) ya app band karke dobara kholo — naya UI turant aa jayega.
