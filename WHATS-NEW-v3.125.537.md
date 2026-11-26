# v3.125.537 — Raat ka save + click-turant rows
- Server: roz IST 01:05 ke baad hot stock/issuance queries ek baar taaza (force) karke gviz Sheet snapshot + disk cache me save — subah/restart ke baad pehla click Google na dekhe.
- Cache restore window 3h/12h → 26h (daily window ke saath): raat ka save din bhar chalta hai, stale-while-revalidate background me taaza karta hai.
- Nav hover/tap par sirf module nahi, us page ka store data bhi warm: Stock · Issuance · Performance · Master Search ke rows click se pehle load hone lagte hain.
