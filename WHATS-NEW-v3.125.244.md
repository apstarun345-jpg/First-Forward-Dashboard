# v3.125.244 — Payout box hamesha instant

- Payout snapshot ab browser (IndexedDB) me bhi save — search par turant, network slow ya 429 ho tab bhi.
- Server se background me ghante me ek baar check (ETag); naya refresh hone par khud update.
- Error par box 30 sec me khud dobara try karta hai; 429 par 3 baar retry.
