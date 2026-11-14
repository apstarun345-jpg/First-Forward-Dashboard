# v3.125.287 — NPCI Status: HTTP 429 fix · live count · beech me download · Excel Summary

- HTTP 429 (API rate limit): server par ek hi queue — 2 call ek saath, beech me gap; 429 aaye to sab ruk ke (Retry-After / 4s→8s→16s) dobara. 6 baar tak try.
- Jo phir bhi fail ho wo "Check fail — dobara karo" (alag), "NPCI me nahi" se mix nahi; ek button se sirf fail wale dobara.
- Live: progress me "X / N check hue · mile · nahi mile · fail"; Total card me kitne baaki. 10-10 ke batch me result turant table me; beech me bhi CSV / Excel / PDF.
- "VRN ke saare tags" checkbox saaf naam ke saath aur sirf tab dikhta hai jab kisi VRN par 1 se zyada tag mile.
- Excel Summary tab: Section · Item · Count · % — total, check hue, baaki, mile / nahi mile / fail, VRN updated / not updated, Active aur har NPCI status.
- Master Search: role shabd (agent / TL) tabhi hatta hai jab poora text kisi ke naam me na ho ("Naya Agent" jaise naam safe).
