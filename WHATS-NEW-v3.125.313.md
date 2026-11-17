# v3.125.313 — Agents Address: labels, duplicate chooser, delete

- ☑ Rows select karo → **🖨️ Labels print / 📄 Labels PDF**: tag-request wala wahi label (colourful / B&W, auto-fit lamba address, FROM = Settings → Contacts, har agent ka ek label). Item/qty line nahi aati.
- **Duplicate address**: same mobile par alag address aaye (upload se ya tag request se) to dono rehte hain; row par ⚠ badge, aur search karte hi popup — **✅ Yeh sahi** (baaki delete) / **Dono rakho** / **Baad me**.
- **🗑 Delete** (admin / upload access): site + Google Sheet dono se; delete se pehle poori row "Address Deleted" tab me save, backup se wapas nahi aati.
- Code.gs: `deleteaddresses` action (optional redeploy; bina redeploy ke row ki cells khaali hoti hain).
