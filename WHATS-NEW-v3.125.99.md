# v3.125.99

- **Report vs site ka farak (GV):** GV & FF Tag Issued ke kaard par Oct ka GV `15,899` tha, par download report me `15,674` aa raha tha. Wajah — report sirf GV Master se banti thi, jabki card EIR se ginta hai, aur EIR ki wo GV rows jinka agent GV Master me nahi milta (aaj ki live rows / blank identity) report se chhoot jaati thi (`13,970 + 15,674 = 29,644` vs card `29,869`).
  - Ab report = **GV Master + GV Master me na mili EIR GV rows**. Report grand total card se match karta hai.
  - Jin rows ka koi agent nahi hota wo kisi agent ke naam par nahi chadhaayi jaati — ek saaf bucket **"(No agent in EIR)"** banti hai (TL sheet ki total line + agents chart me), aur agent-wise sheet me nahi jaati, isliye double count nahi hota.
  - FF me bhi EIR ki blank-agent rows pehle chhoot jaati thi (card ke total se kam) — ab ginti me hain.
- **Naya "Source check" sheet (Excel/CSV + on-screen drawer):** channel-wise KPI card total · report total · "of which no agent in EIR" · named-agent total · difference. Difference 0 = card aur report bilkul same. Info sheet aur drawer ki source line bhi yehi sach batati hai.
- **Month-wise summary (2+ months ki range):** partial mahine (jaise `Nov 26 (partial)` 1–3 din) ko poore pichhle mahine se compare karke `−26,604` dikhaya jaata tha. Ab:
  - `Change` / `Growth %` partial mahine ke liye **pichhle mahine ke same dinon** (Oct 1–3) se hota hai, aur naye **"Compared with" / "Comparison total"** columns me wahi range saaf likhi hoti hai.
  - Partial month ki row me `1–3` din aur `Per day` usi hisaab se — "Days" column ab hamesha range ke din dikhata hai.
  - Poora mahina pehle jaise pichhle poore mahine se compare hota hai.
