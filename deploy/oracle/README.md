# 🟠 Oracle Cloud (Always Free) par shift — step by step

**Free me:** ARM server 2 CPU · 12 GB RAM · hamesha ON (Render free = 512 MB, isliye baar-baar restart hota tha).

## 1. Oracle account (aap khud — 10 min)
1. https://signup.cloud.oracle.com → account banao. Home Region **India West (Mumbai)** ya **India South (Hyderabad)** chuno (baad me badal nahi sakte).
2. Card verification hoga (Always Free limit me charge nahi lagta).

## 2. Server banao
1. Console → **Compute → Instances → Create instance**
2. Image: **Canonical Ubuntu 24.04** (ya 22.04)
3. Shape: **Change shape → Ampere → VM.Standard.A1.Flex** → **2 OCPU, 12 GB**
4. Networking: default VCN, **Assign public IPv4 address = Yes**
5. SSH keys: **Save private key** (download) → Create.
   "Out of capacity" aaye to thodi der baad / dusra Availability Domain try karo.
6. Instance → **Subnet → Security List → Add Ingress Rules**: Source `0.0.0.0/0`, TCP, port **80** aur **443** (do rules).

## 3. Server par ek command
Instance ka **Public IP** copy karo. Apne Mac ke Terminal me:
```bash
chmod 600 ~/Downloads/ssh-key-*.key
ssh -i ~/Downloads/ssh-key-*.key ubuntu@<PUBLIC_IP>
curl -fsSL https://raw.githubusercontent.com/apstarun345-jpg/First-Forward-Dashboard/main/deploy/oracle/setup.sh -o setup.sh && bash setup.sh
```
Script beech me `/etc/ffdash.env` bharne ko bolegi → `sudo nano /etc/ffdash.env` →
**Render → first-forward-dashboard → Environment** se saare values copy-paste (ADMIN_*, APPS_SCRIPT_*, GV_TAG_MAPPING_SECRET, VAPID_* …) → save (Ctrl+O, Enter, Ctrl+X) → script me Enter.

Aakhir me link milega: `https://<ip>.sslip.io` (free HTTPS). Apna domain ho to `SITE_DOMAIN=` me daalo aur DNS A record IP par.

## 4. Check karke Render band karo
- Naye link par login → Home, Master Search, GV live check.
- ⚠️ Sab theek ho to **Render service Suspend** karo — dono server ek saath chalenge to complaint mails / push notifications **do baar** jayenge (dono same Google Sheet storage use karte hain).
- Phone par app / bell notifications naye link par dobara install + allow karne honge (naya domain).

## Roz ka kaam
- Auto-deploy: GitHub `main` par push → 2 min me server khud update (`ffdash-update.timer`).
- Logs: `sudo journalctl -u ffdash -f` · Restart: `sudo systemctl restart ffdash` · Deploy abhi: `sudo ffdash-update`
