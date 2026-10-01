# 🎉 What's New — v3.28.0

> **Employee ke request form me delivery address (mandatory), aur ab poore dashboard me ye bhi dikhta
> hai ki stock KITNA PURANA hai — 1 / 3 / 5 / 6+ mahine, 🚗 VC4+VC20 alag, 🚚 VC5+ alag, har month ke
> saath CSV button. Aur agent ke saath TL naam ab har jagah dikhta hai.**

## 1) 🏠 Employee link form — name + mobile + full address + pincode = SAB mandatory

- Employee link ka form ab upar **👤 Aapki details** card dikhata hai:
  - **Employee name** ✱, **Mobile number** ✱ (10 digit), **Full address** ✱ (house/street/area/city), **Pincode** ✱ (6 digit)
- **Ek bhi adhoora ho to request submit nahi hoti** — page us field par scroll karke focus karta hai aur
  batata hai kya missing hai (mobile/pincode gaalt type pe red card).
- Admin ko request drawer me **🏠 Delivery address** dikhta hai (📋 Address copy — courier ko WhatsApp karo),
  list me **📮 pincode** dikhta hai, aur Google Sheet sync ke columns me **Employee / Employee mobile /
  Employee address / Pincode** badhe hain.
- Notifications me bhi delivery details: `🏷️ Tag request (employee link) · Ramesh Yadav — 1 agents · 25 tags · 📱 9812345678 · 📮 302019 · 🏠 24, Shanti Nagar…`
- Admin Settings → "🌐 Employee link (bina login)" card me "📍 Address + pincode maango" toggle;
  **mobile ab default zaroori** hai (OFF kar sakta hai).

## 2) 🧓 Stock ageing — kitna stock kitne MAHINE purana hai (Agent Allocated At se)

Har jagah jahan agent ya TL ka stock dikhta hai (Stock page, agent/TL KPI drawer, request drawer,
tag-request result) ab agging ka table:
- **Buckets:** ≥ 1 mahina · ≥ 3 mahine · ≥ 5 mahine · ≥ 6 mahine (cumulative — 6+ mahine ke saare tags
  3-mahine me bhi shaamil)
- **Groups:** 🚗 **VC4 + VC20** ek saath · 🚚 **VC5+** (commercial sab: VC5/6/7/12/16/…) ek saath
- **Source:** StockDataa tab ka **Agent Allocated At** (khaali ho to BC Allocated At fallback)
- **⬇ CSV har month ke saath:** 1M / 3M / 5M / 6M ke header me CSV button — click karo aur us se purane
  **har tag ki poori list** (Tag ID, Barcode, Class, Group, Agent, Agent ID, TL, Allocated date, Age din,
  age bucket) download ho jaati hai
- Number par click karo to card ke andar hi top-40 list bhi dikh jaati hai

**Kahan-kahan:** 📦 Stock page ke overview card + agent table me "🧓 Purana stock" column · 🎯 KPI
drawer (agent ya TL kho.lo) · 🏷️ Tag Request ke result aur request drawer me har agent ka ageing ·
personal link page ab agent ka **TL naam bhi** dikhata hai.

## 3) 🧑‍💼 Personal link par TL ka naam

Agent ka secret performance link (`/p/…`) ab TL naam ke saath dikhta hai — sirf naam ki jagah
"Rahul Sharma · TL Ramesh Yadav" (EIR ke saath wala TL, sabse zyada tags wale se).

---
<!-- v3.27.1: admin notification mark + 🔁 duplicate warning (employee ko) — neeche wahi hai
woh jo pichhe generated tha -->
