# v3.125.527 — Full data list instant (pehli baar bhi)
- Server ka EIR din-wise raw cache ab Google Sheet (CACHE_EIRRAW) me durable save; deploy/restart ke baad boot par wapas.
- `/api/eir-raw?fast=1`: sirf saved din turant; missing din background me bharte hain.
- KPI drawer "Full data" pehle fast path try karta hai, poora na ho to purana full load.
