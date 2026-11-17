# v3.125.305 — Dispatch Planner email: Direct agents filter + exact time

- **Agent type filter** ("Schedule a dispatch plan email" card): ab chuno 👥 **All agents** / 🧑 **Direct agents (no TL)** / 🧑‍💼 **TL-managed**. "Direct agents" chuno to summary, Agent-wise CSV aur TL-wise CSV teeno me sirf Direct agents aate hain. Mail ke subject aur body me bhi likha aata hai (`· Direct agents (no TL)`). "Send this selection now" bhi yahi filter maanta hai.
- **"Hour (IST)" ki jagah "Time (IST)"**: ab ghante ke saath minute bhi chuno (jaise `18:45`). Mail usi minute par jaata hai.
  - Pehle server saare scheduled checks **30 minute me sirf ek baar** chalata tha, isliye 9 baje wala mail 9:00 se 9:29 ke beech kabhi bhi ja sakta tha. Ab dispatch mail ka check **har minute** hota hai. Yeh sasta check hai: sheet data tabhi load hota hai jab mail bhejne ka time ho.
- **Save karte hi confirm**: status line me dikhta hai `Schedule saved · ON · Direct agents · agla mail: aaj 18:45 IST`.
- **Aaj ka time nikal jaane ke baad save kiya?** To us din turant mail nahi jaata, agle din/slot se jaata hai. Turant chahiye to "Send this selection now" dabao.
  - Aaj ke liye aage ka time set karo (jaise abhi 3 baje hain aur 4 baje set kiya), to mail aaj hi 4 baje jaata hai.
- Mail fail ho jaye (provider ya sheet error) to 10 minute baad dobara try hota hai, har minute nahi.
- Purane schedule bina kuch kiye chalte rahenge: purana "Hour = 9" ab `09:00` maana jaata hai. Aaj ka mail pehle hi ja chuka ho to dobara nahi jaata.
