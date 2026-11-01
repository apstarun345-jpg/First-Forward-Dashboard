# v3.125.38 — Master Search: barcode Enter without the wait

- Barcode type, paste or scan karke Enter dabao: latest input par search turant start hoti hai, pending/stale dropdown item select nahi hota.
- Topbar tag panel aur Master Search page result aate hi apne aap update hote hain; dobara Enter ya page refresh ki zarurat nahi.
- Barcode lookup agent/TL/REPORT index ka intezaar nahi karti. Warm server index + short-lived per-barcode cache use hoti hai; slow/cold server par targeted sheet fallback aur late API results dono kaam karte hain.
- Exact barcode/tag match partial matches se pehle; dashed, digits-only, comma-formatted aur scientific-number inputs supported. Failed/partial index ko final “not found” nahi maana jaata.
- Google Sheets/network ya cold server ka actual delay reh sakta hai; poora barcode register browser me download karna zaroori nahi.
