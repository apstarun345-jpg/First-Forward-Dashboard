# v3.125.104 — notify safety

- **Fix:** deploy ke waqt purana instance band hote hue notify likh raha tha aur naya instance usi waqt padh raha tha → notify record "gayab" mila → push devices, VAPID, notification flags khaali se shuru (4 Nov 13:16). Ab:
  - boot par users hain par notify nahi mila to dobara padhta hai (khaali se start nahi);
  - band hote waqt notify sirf tab likhta hai jab sach me kuch save baaki ho.
- **Admin recovery:** `POST /api/storage/history/restore-notify {at}` — purani save se notify me jo ABHI nahi hai wahi jodta hai (push devices, purani VAPID agar abhi koi device nahi, workspace, watch flags, notifications). Kuch delete / overwrite nahi.
