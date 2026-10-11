# v3.71.0 — FASTag Mapping: fast server lookup + Google Sheet mapping

## Fix
- `StockDataa paged barcode lookup failed near row 5001: signal is aborted` — ab nahi aayega.
  Pehle browser gviz se 5000-5000 rows ke pages 4.5 s timeout ke saath khud kheenchta tha. Ab server
  StockDataa ko ek baar bade pages me padh kar memory index banata hai (barcode / tag ID / sorted range)
  aur lookup milliseconds me hota hai. Upload file (First+Last barcode ya alag-alag barcode), Quick Map,
  manual range — sab isi se chalte hain.
- Index 5 min stale-while-revalidate; miss par ek forced refresh (abhi add hui row bhi mile); Render par boot ke
  25 s baad pehle se garam. Leading zero hata hua barcode (Excel), spaces/commas, 8.9E+15 — sab match hote hain.

## New — 📗 Google Sheet se mapping (FASTag Mapping page)
- Sheet link/ID, tab name, start row, type (First+Last range / alag barcode / alag Tag ID),
  First / Last / Barcode / Agent ID / Done column letters — sab select karein.
- `📥 Sheet se load + lookup` (review ke liye) ya `⚡ Turant map karo + done likho`.
- Mapping ke baad jis sheet row ke saare tags map ho gaye, uske Done column me "done" (text badal sakte hain) likha jata hai.
  Pehle se "done" wali rows skip hoti hain, isliye dobara run safe hai. Settings browser me yaad rehti hain.

## Speed / UI
- Mapping API batches 2 parallel (server 10 rows parallel), table pehli 300 rows render karti hai (+ "Aur dikhao"),
  result limit 3,000 → 20,000.

## Deploy steps
1. Repo update + Render deploy (koi naya env var nahi).
2. Sheet feature ke liye: `google-apps-script/Code.gs` (v3.71) Apps Script me paste → Deploy → Manage deployments →
   Edit → Version: New version → Deploy.
3. Jis Google Sheet me done likhna hai use Apps Script chalane wale Google account ke saath Editor share karein.
