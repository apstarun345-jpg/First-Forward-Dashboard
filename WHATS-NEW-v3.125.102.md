# v3.125.102 — stock snapshot

- Stock index (ageing, dispatch status, mapping) ka snapshot: har safal full scan ke baad StockDataa + Tag Assignment ki zaroori columns gzip karke /tmp aur storage sheet ke `CACHE_STOCK` tab me. Deploy / restart par index snapshot se seconds me (pehle kai minute ka scan). Snapshot 26 h tak; stock sheet badalne par naya scan + naya snapshot.
