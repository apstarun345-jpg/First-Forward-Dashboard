# v3.74.0 — Bandwidth diet (Render free 5 GB/month quota)

Render ne service "Monthly Quota Exceeded" (5.31 GB / 5 GB) par suspend ki. Ye release aage ka kharch ghatata hai
(is mahine ka use waapas nahi hota — resume ke liye Render Billing me card ya 1 Nov reset).

Server
- JSON APIs ab brotli/gzip me (notifications 7.3 KB → 1.6 KB); pehle sirf gviz/static compress hote the.
- GV watcher 15 s → 60 s, FF 150 s → 300 s (sheet-edit webhook abhi bhi turant).
- FASTag Mapping index: boot par ready index ko 3× zabardasti dobara banana band (har wake par 4× poora StockDataa).
  Index TTL 5 → 30 min, miss-refresh gap 20 s → 60 s.
- Stock ageing index TTL 10 → 30 min.

App
- Auto sync 5 → 10 min, aur pehle sirf /api/today (~2 KB) — data na badla to EIR/REPORT/GV Master dobara nahi
  (har 30 min me ek poora sync phir bhi). App par lautne wala sync bhi isi rule se.
- Notifications poll 15 s → 30 s (background 60 s → 5 min); Live Assist inbox 20 s → 45 s.
- Office bell 30 s → 45 s, background tab me poll nahi (2 min+ baad lautne par purani ghanti burst nahi).

Measured (mock data, phone idle ~5.5 min): 109 req / 167 KB → 54 req / 41 KB. Server idle 2 min: 1.86 MB → 39 KB.
