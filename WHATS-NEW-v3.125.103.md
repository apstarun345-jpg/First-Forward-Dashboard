# v3.125.103 — din me ek baar data

- **KYC ratio** (Master Search) ab browser me EIR ke version ke saath save — EIR me naya data aaye tabhi dobara calculate, warna din bhar wahi.
- **Last dispatch → Issued / Stock** — din ki jagah stock data ke version par save: StockDataa / Tag Assignment badle tabhi naya check.
- **Server jaagta rahe** (Render free 15 min me so jaata tha): har 10 min apna chhota ping, taaki subah sheet update hote hi (koi site khole ya na khole) server naya data utha le. `KEEP_AWAKE=0` se band.
- Sheets ka pichhla version settings me saved — restart ke baad bhi "naya data kab aaya" sahi, aur band rehne ke dauran aaya badlav bhi pakda jaata hai.
- **Home → 🗓️ Site par kis time ka data hai** table: EIR / StockDataa / Tag Assignment — naya data kab aaya, rows, aakhri check; Stock ageing + dispatch status, Last dispatch, KYC, GV Master kis time ka hai.
