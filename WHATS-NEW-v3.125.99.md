# v3.125.99 — speed

- **Notify save kam baar:** user ka kaam (tag requests, workspace, push, watch) turant save hota hai. Auto notifications / audit / activity log ab har 5 min me ek baar save hote hain (pehle ~har minute ~0.8 MB Apps Script write → storage timeouts). Deploy/shutdown par pending notify turant save. `NOTIFY_LAZY_MS` env se badal sakte ho.
- **Dispatch snapshot:** full dispatch scan (raat 1 baje + boot par) ke baad compact snapshot storage spreadsheet ke `CACHE_SNAPSHOT` tab me save. Restart/deploy par pehle ~7 min scan hota tha, ab snapshot se seconds me wapas.
