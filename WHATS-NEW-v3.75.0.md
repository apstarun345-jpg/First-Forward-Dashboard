# v3.75.0 — UI refresh + site-wide diagnosis fixes

Diagnosis: saare 30 pages × (desktop, phone) × (light, dark) = 120 views automated check
(JS errors, failed API calls, overflow, contrast, tap targets). JS errors / failed requests / overflow: 0.

KPI cards (rangeen hi)
- Har rang (g1–g13) ka 3-shade palette, ek jaise mel khaate; upar-baayen halki roshni, glass icon, rang ke hisaab se glow.
- Numbers tabular (ek seedh me), saaf title/foot typography; sparkline rangeen card par safed.

Fixes (diagnosis se)
- Direct Agents / New Agents / Control Tower: KPI cards poori width me ek ke neeche ek → 4 across (`.metric-grid` ka CSS hi nahi tha).
- Tables: column 1 akshar tak patla ho kar naam/ID akshar-akshar neeche likhe jaate the (FASTag Champions, phone tables) → shabd nahi tootte, table scroll hoti hai.
- Trend page dark mode: title, card headings, table numbers gayab (Tag Request ka "light page" CSS `#tr-body` id se Trend par bhi lag raha tha).
- Tag Request dark mode: canvas light par cards dark + text kaala → poora page sahi light.
- Selected chip ka count safed-par-safed (har page ke filter chips).
- Dark mode: table header/footer, sticky first column, mini cards, pills, Bulk Tag Status, Settings location box.
- Phone: "12 active days" jaisa text number se bada (24px) → normal; header buttons ek line; tabs saare dikhte hain; checkbox bade.
- Dispatch Planner amber/sky numbers thode gehre (safed par padhne layak).
