# v3.125.231 — 💰 Payout: memory-safe sheet reads

- Apps Script `readmatch` (Code.gs v3.77, lock-free): returns only the rows of the searched agent / TL — the full APN / FNF tab no longer comes to the server (the earlier full read pushed the server past its memory guard).
- Old Apps Script: chunked fallback with a 3-tab cache, refused when server memory is high (message asks to deploy Code.gs v3.77).
- Agent search: TL / payee FNF row fetched separately; payout box shows the real error if a sheet can't be read.
