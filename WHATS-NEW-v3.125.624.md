# v3.125.624
- Tag Request: ek request ki sheet push ek waqt me ek hi (lock) — auto + manual saath chalne se duplicate/"failed" band.
- Manual sheet push 30 s me jawab deta hai (peeche chalta rehta hai), 45 s timeout error nahi.
- Approve/status ab durable save ke baad reply; timeout par UI purana pending wapas nahi dikhata, server se asli status leta hai.
- Sheet outbox: manual sheet push aur address save turant queue me jate hain (local me turant dikhta hai), Google par bhejna peeche, auto retry 5s/20s/1m/3m; sweeper har 1 min.
- Duplicate rows ka asli kaaran: Apps Script call timeout par 4 baar blind retry hoti thi aur har retry row dobara append karti thi (FF + GV dono). Ab appendrows timeout par retry nahi karta: pehle Google sheet me check (aaj ki date + agent + class), mili to synced maano, nahi mili to retry; verify na ho paye to auto-resend nahi, admin ko alert.
