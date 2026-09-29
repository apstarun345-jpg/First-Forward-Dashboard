# v3.13.0

## 1. Master search — rich profile (`masterProfile.js`)
* Suggestions me ab phone · stock · TL stock · priority · suggested qty bhi dikhta hai (REPORT load hote hi).
* Suggestion pick → wide drawer: header (naam, ID, mobile, TL naam/ID/mobile, status, last active, priority), KPI strip (agent stock, TL stock, priority, suggested VC4/Commercial, issued this/last month), class-wise table (Class | Last month | This month | Growth | Stock), VC4/Commercial/Total summary, charts (class donut, last-vs-this bars, stock donut, monthly trend, last-7-days, agent-wise bars for TLs).
* TL profile: TL totals, TL-level suggestion vs sum of agent suggestions, agents table (click → agent profile).
* Sirf ek match ho to home/panel me profile inline khulta hai. Har card par **📊 Poori report** button.
* Mobile fallback: `mobile` → 10-digit agent ID → GV REPORT (ID/naam) → "—". `contacts` permission na ho to 🔒 (CSV/WhatsApp me bhi hide).
* Suggested qty = `ceil(avg/day × suggestDays − stock)` (default 15 din). GV agents: sheet ka *Suggested Dispatch Qty* pehle.

## 2. 🏷️ Direct agents · High/Medium · Tag required
* Root cause: dispatch plans me `direct ? 0 : calculated` tha, isliye direct High/Medium agents "No stock / Not required" dikhte the.
* Ab: FF Performance + GV Dashboard dispatch plan me alag filter **🏷️ Direct · High/Medium · Tag required**, "🏷️ N tags" chip; GV Stock Report me alag card + dropdown option; Direct Agents page me `Tag required` filter, KPI, "Tag required?" + "Suggested tags" columns; Dispatch Planner pool = "🏷️ Direct agents · tag required (no stock)".
* Direct + Low = "No dispatch" (pehle jaisa).

## 3. ✉️ SMTP / Email (`mailer.js`)
* Bug: EHLO ki aakhri line (`250 STARTTLS`) drop ho jaati thi → AUTH STARTTLS se pehle → `530 Must issue a STARTTLS command first`. Fixed.
* Render **free plan** outbound SMTP (25/465/587) block karta hai → HTTPS transport: Google Apps Script `MailApp` (Code.gs `mail`), Resend (`RESEND_API_KEY`), Brevo (`BREVO_API_KEY`); `MAIL_PROVIDER=auto|smtp|apps-script|resend|brevo`.
* Settings → Email → **Diagnose** (DNS/port/TLS/AUTH step-by-step) + status; Gmail app-password ke spaces auto-strip.
* Apps Script: naya `Code.gs` paste → `authorizeMail_` run + Allow → Deploy → Manage deployments → Edit → New version.
