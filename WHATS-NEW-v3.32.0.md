# v3.32.0

## 🏷️ Tag Request
- **Admin print fix** — print popup ke Print / size / per-page buttons site ki CSP (`script-src 'self'`) se block ho jaate the (inline `<script>`). Ab buttons opener se bind hote hain → kaam karte hain.
- **📄 Download PDF** — Tag Requests table me bulk `📄 Download PDF` + har row par `📄`, aur print popup me bhi. PDF me wahi address label format (FROM · TO naam/mobile/address/PIN · class qty). `pdf.js` = bina library ka canvas→PDF writer.
- **Employee link** — dropdown me ab **TL** pehle aate hain; TL chunte hi uska poora data (🚗 VC4+VC20 / 🚚 VC5+ stock · last · MTD + saare agents, click karke agent chuno). TL ke naam par request ban sakti hai.
- **Dispatch name** — har block me alag "Dispatch name" (label par yahi naam jata hai; TL request me zaroori). Agent ka naam alag ho to label par "Agent: …" line.

## 🔎 Master Search
- Old / alt agent ID (REPORT `ID` column), TL ID, agent + TL **mobile number** se bhi search (FF + GV; mobile sirf `contacts` permission waalon ko).

## 🔗 Personal links
- Agent link: stock (VC4+VC20 / VC5+), last month total, ageing. TL link: agent-wise table (stock · last · MTD) + ageing.

## 🔁 Sheet loading
- Har gviz query 3 baar auto-retry (0.7s, 1.8s backoff); jo sheets phir bhi fail hon unhe background me 4s·10s·20s·40s·75s par dobara load (FF + GV). Sab load hote hi page refresh + toast. Status bar "auto-retry chal raha hai" dikhata hai.

## 🚨 Unusual Activity (new page)
- High Wrong VRN · High Replacement · High Chassis · Single-day spike — channel average ke multiple (1.5×–5×) + minimum count; KPI cards = filter; row click → agent detail; CSV.

## 🗄️ Master Stock
- KPI detail dialog dark-on-white bug fix (pehla column ghayab tha); ab light colourful dialog, **saari rows** (500 + "Aur dikhao / Sab dikhao"), CSV filtered rows ki.
- Naye KPI: FF/GV agents holding stock, match rate, avg stock age; colourful hero.

## 🧍 Direct Agents
- Click par hang: GV issuance par `find()` loop O(n×m) tha → O(n); roster load par 45s timeout + error box.

## 📄 Agent / TL Summary (FF + GV)
- Sidebar me First Forward + GV Partner dono me. Agent/TL search → stock, issuance (last + current), growth, ageing; **PDF / Share / WhatsApp / Copy / CSV**.
