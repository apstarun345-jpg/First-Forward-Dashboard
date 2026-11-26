# v3.125.531 — Scan: ek photo se kai barcode + number OCR + confirm
- Tag request → Scan → "🖼️ Photo se scan" (+ Ctrl+V / drag-drop): photo me barcode ki jagah dhoondh kar seedha karke zbar se padhta hai; dhundhla ho to neeche likha number (OCR). Ek photo ke saare tag.
- Mile hue numbers review card me — server check (Stock / Issued / Not found) ke saath; edit karo, tick/untick, "Confirm" par add.
- Bug fix: ZXing (vendor/ blocked tha) ab libs/ se load hota hai — jin browsers me native BarcodeDetector nahi (iPhone) wahan live camera scan ab chalega.
- CSP: wasm-unsafe-eval + worker-src (zbar/OCR ke liye).
