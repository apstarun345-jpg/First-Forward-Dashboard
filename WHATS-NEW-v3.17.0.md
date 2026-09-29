# v3.17.0 — Dispatch Planner v2 + ek hi run-rate formula (GV + FF)

## 🚚 Dispatch Planner — poori tarah naya
- **GV + First Forward ek saath**, agent-wise aur **TL-wise** (same format) — tabs se switch.
- **Filters**: Channel (Both / FF / GV) · Type (All / TL-managed / Direct agents) · Priority (High / Medium / Low) · Tags (All / VC4 / Commercial) · Need (dispatch chahiye / cover < 7 din / 0 stock) · TL dropdown · search. Har chip par live count.
- **Columns** (har header par click = sort asc/desc): Agent / TL naam · TL · Priority · Last month issuance · This month issuance · Run-rate/day · Required · Stock · **Dispatch WITH stock** · **Dispatch W/O stock** · Cover din · Status.
- **Sab kuch clickable**: row → drawer (poori profile + 🧮 Dispatch calculation), TL naam → TL drawer, KPI card → summary drawer (channel-wise / priority-wise / TL-managed vs direct + top 25), Direct group → agents list.
- Export CSV / Excel / WhatsApp (current filter ke hisaab se). Naya colourful theme (dark mode ready).

## 📐 Ek formula, poori site par
```
Run-rate     = is month ke issue ÷ (aaj ki date − 1)
Required     = Run-rate × Settings ke din (e.g. 25)
WITH stock   = Required − stock
W/O stock    = Required
Cover (din)  = stock ÷ Run-rate
```
Code: `FF.util.runRate / runRateDays / dispatchCalc` (util.js). Ab yahi formula use hota hai:
- Home / topbar **master search** → suggestions + drawer (run-rate, cover, dispatch WITH / W/O stock, VC4 · Commercial · Total)
- **Performance** → Suggested dispatch plan (last / this month, run-rate, cover)
- **GV Stock Report** dispatch, **Direct Agents**, **Stock Radar**
- Sheet ki "Suggested Dispatch Qty" / `avgVc4` ab override nahi karti — sab jagah ek jaisa number.
