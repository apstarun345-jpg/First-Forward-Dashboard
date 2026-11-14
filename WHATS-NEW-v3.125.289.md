# v3.125.289 — "Load all rows" (tag-level list) tez + progress

- EIR sheet bahut badi hai — ek query (1 din ki bhi) ~25-30s, poora mahina ~90s+ leta tha (lagta tha load hi nahi ho raha).
- Ab range 7-7 din ke tukdon me, 3 ek saath — mahina lagbhag 40s me; beech me "2 / 5 hafte aa gaye · 12,345 rows" dikhta hai. Har tukde ka timeout 2 min.
