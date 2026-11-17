# v3.125.306 — Dispatch email me GV bhi + FF / GV agents ke mobile number

- **Bug fix: FF + GV dono chune the, phir bhi mail me sirf FF ka data jaata tha.**
  - Wajah: page priority **stock cover** se banata hai (cover 7 din se kam = High, 15 din se kam = Medium). Lekin mail sheet ka "Priority Level" column padhta tha, aur GV REPORT me woh column lagbhag hamesha "Low" rehta hai. Isliye "High + Medium" filter lagate hi saare GV agents mail se kat jaate the.
  - Ab mail bhi bilkul page wala hisaab lagata hai: cover-based priority, aur All tags par dispatch = VC4/VC20 + VC5+. Mail aur screen ke numbers ab same aayenge.
  - Mail ke summary me ab channel-wise ginti bhi likhi aati hai: `First Forward X · GV Partner Y`, taaki turant dikh jaaye ki dono aaye.
- **📞 Mobile number (FF + GV)**
  - **Page table**: Agent-wise view me naya **Mobile** column hai (click karke call). Search box me mobile number se bhi dhoondh sakte ho. CSV / Excel export me bhi Mobile column aata hai.
  - **Mail**: Agent-wise CSV me **Mobile** column.
  - Number kahan se aata hai: GV REPORT (column A) / FF REPORT ka 10-digit ID. Wahan na mile to Agent Details sheet + Address book + tag requests (mobile directory) se.
  - Mobile sirf admin aur "contacts" permission wale users ko dikhta hai.
- Mail ke CSV me naye columns: `Mobile`, `Sheet priority` (sirf tab bhara jab sheet ki value cover wali priority se alag ho), `Dispatch VC4/VC20`, `Dispatch VC5+`.
