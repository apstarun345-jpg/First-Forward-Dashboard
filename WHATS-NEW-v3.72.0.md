# v3.72.0 — 🚦 "Too Many Requests" fix + 📊 FASTag Mapping ke live counters

## 🐞 Fix — Google ka "Too Many Requests" HTML page screen par dikhta tha
Puri HTML error page (`Too Many Requests` + `normalize.css`) JSON ki jagah UI/table me aa jaati thi, aur
StockDataa wale lookup bahut time lete the / fail hote the.

- **Server (gviz proxy):** Google ka 429 / rate-limit page ab **kabhi client tak nahi jaata**. Proxy saaf
  JSON `429` deta hai (`Retry-After` + `X-FF-Rate-Limited` header ke saath) aur jahan purana cache hai
  wahan **purana data serve karta hai** (stale-while-revalidate), taaki page khaali na dikhe.
  200 ke saath aaya HTML page bhi ab JSON error banta hai.
- **Browser (data.js):** HTML/429 response ab `RateLimitError` banta hai — saaf Hindi message, koi raw
  HTML nahi. Rate limit ke baad **browser se Google direct calls band** (circuit breaker ~2 min): sab
  kuch apne server proxy se jaata hai (wahi dedupe/cache karta hai). Ek chhota auto-retry `Retry-After`
  ke hisaab se hota hai.
- **Rate-limit gate (naya):** ek saath sirf `GVIZ_CONCURRENCY` (default 6) upstream requests jaati hain;
  429 par badhta hua cooldown lag jaata hai aur us dauran **background refresh / warm-up / forced rebuild
  nahi** hote. Env: `GVIZ_CONCURRENCY`, `GVIZ_COOLDOWN_MS`, `GVIZ_GATE_WAIT_MS` (optional).
- **Apps Script (sheet read/write):** rate-limit HTML par saaf message + retry; pehle jaisa HTML page
  wala message bhi bana hua hai.

## ⚡ StockDataa / sheet load
- **Index pehle se garam:** boot ke 25 s ke bajaye 6 s baad build shuru; fail hone par 30 s / 2 min /
  5 min par dobara koshish (rate limit me chup-chaap skip).
- **Live status:** page ke top par badge — `✅ StockDataa index ready · 2,45,000 rows · 3m purana`,
  `⏳ index ban raha hai… 1,20,000 rows · 5 pages`, ya `⏳ Google rate limit · 42s`. Naya
  `🔄 Index refresh` button (index dobara ban jaata hai, peeche-pardey).
- **Lookup chhote chunks me (400 items):** screen par counter lagataar badhta hai aur ek chunk fail
  hone par poora kaam nahi girta. Rate limit par heavy client-side scan turant rukta hai (429 par 429
  nahi).

## 📊 Live counters (jo maanga gaya tha)
- **Naya progress panel** StockDataa lookup & mapping queue card me: `42 / 1,200 rows · 3%`,
  `✅ Mapped / done`, `❌ Failed`, `⏳ Bachhe`, `⏱ elapsed + ETA`, `⚡ rows/s` — aur 1 second ka tick,
  yaani run ke dauraan live badhta rehta hai.
- **Mapping ab 25-row batches (3 parallel)** me bhejta hai (pehle 100 × 2) — har batch ke baad counter
  turant update. Rate limit/network se fail hui rows **retry pass** me dobara chali jaati hain
  (mapped rows chhoote nahi). Sheet me "done" likhne ka step bhi panel me dikhta hai.
- **Fail hone par panel me hi `🔁 Dobara try` button** (lookup / sheet load / adhoori mapping rows).

## 🧪 Tests
- Naya `dev/fastag-mapping-ratelimit.test.js` — real server + fake Google upstream: 429 HTML → JSON 429,
  cooldown me extra upstream calls nahi, index error saaf, limit hatne par lookup theek.
- Naya `dev/fastag-mapping-progress.test.js` — live counters, 25-row batches, mapping 429 retry pass,
  rate-limit message + retry button.
- Naya `dev/data-ratelimit.test.js` — HTML kabhi UI me nahi, direct-Google circuit breaker, saaf error.
- `dev/mock-gviz.js` me rate-limit drill: `MOCK_RL_SHEET=StockDataa MOCK_RL_COUNT=3 node dev/mock-gviz.js`.

## Deploy steps
1. Repo update + Render deploy (koi naya env var zaroori nahi).
2. Sheet feature (done likhna) ke liye: `google-apps-script/Code.gs` (v3.71) Apps Script me paste →
   Deploy → Manage deployments → Edit → Version: New version → Deploy.
3. Agar bahut zyada users ek saath StockDataa padhte hain to `GVIZ_CONCURRENCY` (default 6) thoda kam
   kar sakte hain, ya `GVIZ_COOLDOWN_MS` (default 45s) badha sakte hain.
