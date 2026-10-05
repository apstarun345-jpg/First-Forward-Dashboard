# ✨ v3.56.0 — Class-wise stock summary in Dispatch Planner (PR #100 follow-up)

PR #100 ke teen features (Home issuance explorer · top-bar universal search · class-wise dispatch stock)
yahin **final** rahenge — ye release unke upar ek chhota par saaf follow-up hai. Revert PR #101 ko merge
nahi karna hai; uska kaam is release me supersede ho jaata hai.

## 📦 Dispatch Planner — "kis class ka kitna stock hai"
- Agent-wise aur TL-wise dono views me KPI cards ke neeche naya **Stock · class-wise** panel.
- Har class ka **total stock** dikhta hai, FF aur GV ka split ke saath (`VC4 585 · FF 580 · GV 5`).
- Numbers poore **filtered view** ka jod hote hain — TL chahte ho, priority chahte ho, search chahte ho,
  chips ke saath jo bhi list banti hai wahi aggregate hota hai.
- TL view me har class member-agents ka sum hai (jaise table ka class mix), aur TL sheet total alag rahe to
  **Other / unmapped** bucket us farak ko dikhata hai — chhupti nahi.
- Source sheet me class columns (VC4 · VC5 · VC6 · VC7 · VC12 · VC16) na hon to panel saaf likhta hai
  "source sheet me class columns nahi" — bina jhootha 0 dikhaye.
- Row-level class mix (`All stock · class-wise mix` column) aur CSV/Excel export pehle jaise hi kaam karte hain.

## 🏠 Home issuance explorer
- Class totals ab **sirf accessible channel ka split** dikhate hain — sirf FF ka access hai to `FF 4` dikhega,
  doosre channel ka number leak nahi hoga (chart pehle se hi sirf allowed channel ka tha).

## ✅ Verification
- `dev/dispatch-planner.test.js`: class-wise summary (FF/GV split, class order, unmapped bucket, TL rows,
  empty state) + HTML rendering ke naye tests.
- `dev/home-explorer.test.js`: channel-access split test (permission leak nahi).
- Regression wiring is release ke saath: package/API **3.56.0**, `config.js?v=108`, `styles.css?v=109`,
  `home.js?v=89`, `app.js?v=107`, service-worker cache `apnapayment-v112`.

## 🧾 Note on PR #101
PR **#100** (Home explorer + universal search + class-wise dispatch stock) merged hai aur is release ka base hai.
Open revert PR **#101** usi kaam ko hataata hai — is follow-up PR ke merge hone ke baad use band kar dena
chahiye, warna aapke features dobara hat jayenge.
