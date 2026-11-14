# v3.125.264 — GV API Report: poora data + clickable boxes

- **Selected date range ka poora data**: koi din GV API se fail ho to server 4 baar retry karta hai (1.5s → 6s), phir browser fail din ek-ek karke 3 round aur laata hai. Poora chunk fail (timeout/502) ho to bhi 3 baar try. "N din ka data nahi aaya" ab sirf tab dikhega jab GV API ne sach me baar-baar mana kiya — saath me "↻ Sirf ye din dobara lao" button.
- **Alag boxes**: Total tags · Issuance · Replacement · VC4 · VC20 · VC5+ · Commission · Amount · Agents · Wrong VRN · Chassis · Avg/day.
- **Har box clickable**: click → usi box ke filtered records (Agents → agent table, Avg/day → day-wise). Upar 📦 bar me CSV / PDF / Box hatao.
- **File name**: `<Agent / TL name> - <Box>` (jaise `RAM KUMAR - Chassis.pdf`, `All agents - Replacement.csv`).
