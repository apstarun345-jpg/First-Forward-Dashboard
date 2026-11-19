# v3.125.356
- 🛣️ Toll Tags sheet me ab **"Toll Debit Daily"** tab bhi hai (date-wise + class-wise ginti aur ₹) — purani history copy ho gayi, roz ka import use khud update karta hai (`TOLL_TAGS_IMPORT.gs`).
- Reports → Toll Debit page ab isi tab ka data dikhata hai (webhook `/api/push/toll-daily`, sheet private rehti hai); purani tarikhon ke liye purana GV tab fallback.
- Setup: Apps Script me naya `TOLL_TAGS_IMPORT.gs` paste karo, ek baar `tollPushDailyNow()` chalao (history site tak pahunch jaaye).
