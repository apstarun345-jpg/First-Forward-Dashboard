# v3.125.304 — NPCI Status: rate-limit par speed kam girti hai + live API diagnosis

- **429 par speed ek hi baar katti hai**: pehle jo calls 429 se pehle nikal chuki thi, unke 429 bhi baad me aake speed dobara kaat dete the — "per minute" limit wali API par speed 40% tak gir jaati thi. Ab ek 429 episode = ek kat; lagataar 429 me sirf ruk lamba hota hai (1s → 15s). Simulation: per-minute limit par **44% → ~100%** of API limit, baaki cases barabar ya thoda behtar, kisi me ek bhi fail nahi.
- **Concurrency ki chhat bhi seekhta hai** ("ek saath max N" wali API): probe ke baad 429 aaye to sirf concurrency −1, speed nahi kat-ti.
- **API rate-limit headers** (`RateLimit-*` / `X-RateLimit-*` / `Retry-After`) bheje to unhi se pace — remaining 0 = reset tak ruko, policy = pakki chhat.
- **Naya check turant shuru** — history (Google Sheet) load ka intezaar nahi; bina naye rows ke checkpoint skip.
- **Live diagnosis**: progress me `⚡ X/s · API Y/s · jawab ~Zms · ek saath N · rate-limit K× (khud sambhala)`; server log me har job ke baad API ke rate-limit headers (agar bheje).
- Note: ApnaPayment admin "Bulk Vehicle Status" bhi same API par *ek-ek karke (1-3 per second)* chalta hai. Dono ek saath chalao to dono ek hi limit baant-te hain — dono slow.
