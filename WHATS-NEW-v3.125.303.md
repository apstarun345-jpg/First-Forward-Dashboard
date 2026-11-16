# v3.125.303 — NPCI Status: history hamesha dikhe, chalta check bhi save, bulk check tez

- **History kabhi khaali nahi**: server restart ke baad history Google Sheet se aane me der lage to "⏳ load ho rahi hai" dikhta hai aur page apne aap dobara poochta hai; fail ho to error + "↻ Dobara" button. Pehle chup-chaap kuch nahi dikhta tha.
- **Purani history safe**: sheet se history load fail ho to ab naya check sheet ki purani 5 runs ko overwrite NAHI karta — sheet theek hote hi purani + nayi dono jud jaati hain.
- **Chalta check bhi history me**: Check dabate hi upar "⏳ chal raha — X baaki" row; har 10s disk par aur ~3 min me Google Sheet par save. Pichhli 5 + chalta = 6 rows.
- **Server restart / deploy par run nahi udta**: page kholte hi (ya chalte check ke beech restart ho to apne aap) bache hue items wahin se **resume** — jo check ho chuke wo dobara nahi. "Ruko" dabaya ho to "▶ Baaki N resume" button.
- **Tez bulk check (bina 429 error)**: naya rate gate — "ek saath 3-8" ki jagah API ki requests/second seekhta hai (429 par us rate ke 90% par tikta hai, 25s ka lamba ruk khatam), ek saath kitni calls = rate × API latency. Seekha hua rate disk par yaad — agla check seedha tez speed se shuru. Progress me ⚡ speed/s dikhti hai.
- History ke CSV / Excel download ab chalte check ko chhede bina (kisi bhi run ka), "👁 Live" se chalta run.
- Server: NPCI engine alag module `npci-engine.js` (pehle har request par dobara banta tha) + tests (`dev/npci-engine.test.js`).
