# v3.125.32
- Server RAM: Stock ageing index ki ~2.5 lakh tag rows ab compact JSON string me (pehle JS arrays — ~3x zyada heap). Drill / CSV / personal link par 60 sec ke liye parse, phir chhod diya jaata hai. Off karna ho: STOCK_AGE_COMPACT=0.
