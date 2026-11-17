# v3.125.312 — 📍 Agents Address (Management)

- Naya page **Management → Agents Address**: FF / GV channel filter, **Search in** dropdown (Name · Mobile · Pincode · ID · Address · TL — kai fields ek saath tick) + ek saath **kai search values** (comma / nayi line), CSV download, address copy.
- Lookup priority: **pehle tag-request ka address**, phir **Address tab**.
- Admin access: Users → Permissions me `Agents Address (page)`, `… First Forward`, `… GV Partner`, `… file upload`. Jise jo channel ka access diya wahi address dikhega.
- **Upload (kisi bhi format me)**: PDF (2-column bhi) · Excel · CSV · text · paste. Pehle preview, phir save. ID / TL / channel mobile number se nikalte hain (tag requests → Address tab → Agent mobile sheet → REPORT).
- Safety: import sirf khaali jagah bharta hai (maujooda address/mobile nahi mitta; replace sirf tick karne par), site me + gzip backup me turant save, Address tab me chunk-wise sync (fail ho to pending rehta hai, "Sheet me sync karo"), aur har import ki poori rows alag **Address Import Log** tab me append-only.
- Code.gs: readaddresses ab 20,000 rows tak (optional redeploy).
