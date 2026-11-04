# v3.125.101 — daily data, kam load

- **EIR · StockDataa · Tag Assignment** — din me ek baar data aata hai, isliye server ab inka cache tab tak rakhta hai jab tak sheet me naya data na aaye. Har 10 min sirf ek chhota "kitni rows" check; rows badli → us tab ki queries peeche se naye data se bhar di jaati hain (max 26 h purana).
- **Stock index** (ageing, dispatch status) — pehle har 30 min poora StockDataa + Tag Assignment scan; ab sirf jab stock sheet badle (ya 26 h). Memory spikes / crash kam.
- **GV Master + baaki tabs** — pehle jaisa 10 min cache.
- **Home → ⚡ Force refresh** (refresh permission): server ka poora sheet cache, stock index aur dispatch data dobara + browser ke saved sheets saaf, phir saari sheets fresh. 2 min me ek baar.
