# v3.125.145 — GV issuance double count fix
- EIR me GV rows bina agent naam / ID ke aati hain (sirf "ApnaPayment Pvt. Ltd."), isliye site GV Master ke tags ko "EIR me nahi" maan kar dobara jod deti thi — GV issuance ~2 guna dikhti thi (7 Nov: 2,187 dikh raha tha, sahi 1,439 = FF 688 + GV 751).
- Ab: jis din GV Master ke naam wale tags hain, us din EIR ke bina-naam GV rows hata kar sirf bacha hua farak (EIR total − GV Master) "naam nahi" row me — GV ka total EIR jitna hi, aur agent / TL naam GV Master se. GV pages, GV agents, robot, sab jagah.
