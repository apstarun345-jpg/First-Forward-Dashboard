# v3.33.1

## 🛠 Fixes

- **Agent / TL Summary (FF + GV)**
  - Ab dono channels (`#/ffAgentSummary` · `#/gvAgentSummary`) par search / KPI cards / charts / ageing / PDF / CSV / WhatsApp buttons firse kaam karte hain.
  - GV side: `gvpages` module lazy-load ho jata hai (pehle GV Performance report rows nahi milte the → list khali rehti thi).
  - Stock Ageing section ke liye `FF.stockAge.compute(scope)` add kiya — 30+d / 60+d KPI cards, class-wise ageing table, aur drill drawer ab actual tag-level data dikhate hain (pehle method missing hone ki wajah se "pending stock ageing nahi hai" aata tha).
