# v3.112.0 — Agents Complaints Summary
- New page **Management → Agents Complaints Summary**: bank POS-complaint mails from Gmail as a colourful table (Case, VRN, Tag Id, Description, BC Name, Agent, Agent ID) + TL name / TL ID fetched from the Agent master.
- Status: Pending · Solved by <you> (you replied) · Solved by Bank (bank debited / refunded / closed, deducted ₹ shown) · Solved by Team. TAT-breached flag.
- Filters: date range (+ quick chips), status, TL, agent, search; tabs By agent / By TL; Excel export.
- Server refreshes the current month in the background (Settings → Agents Complaints Summary: refresh minutes, multiple subjects, your name, TAT hours) — page opens with data ready.
- One-time setup: paste the new `google-apps-script/Code.gs`, run `authorizeComplaints()` once, Deploy → New version.
