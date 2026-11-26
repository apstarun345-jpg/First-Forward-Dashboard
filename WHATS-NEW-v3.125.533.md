# v3.125.533 — Photo / camera barcode scan FIX (asli wajah mili)
- Bug: scanner apni libraries `vendor/` se mang raha tha (server block karta hai) → photo upload me "barcode nahi mila", camera bhi fail. Ab `libs/`.
- Tedhi / ulti / sidhi photo: har barcode ka angle khud theek hota hai, number ki patti alag kat kar (180° ulta bhi) OCR; 10/10 tag sahi (aapki 2 photos).
- Number me ek digit galat padha ho to prefix / series (middle group) se majority sudhaar.
