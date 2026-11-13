# v3.125.251 — Server stability fix

- Payout / mobile directory / address book ka state har API request par naya ban raha tha (handleApi ke andar) aur har request ek background sheet-read schedule kar deti thi → Apps Script lock hamesha busy, memory badhti. Ab state ek hi baar (global), boot timers sirf ek baar.
- Boot par storage read 'busy' ho to 4 baar retry (pehle seedha band).
- Mobile directory: Code.gs v3.78 'readcols' (bina lock, dedupe Apps Script me), disk cache 6 ghante, boot ke 5 min baad.
