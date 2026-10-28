# v3.113.0 — Complaints mail alerts
- Agents Complaints Summary → ⚙ Settings & Mail alerts (admin): refresh minutes, subjects, your name, TAT hours (moved here from Settings) + mail alerts.
- Mail rules: all complaints / one TL / one agent (name or ID) → recipient emails; events: new complaint (instant at each refresh), bank deducted, reminder digest every N hours (default 4) while pending.
- Editable subject + body templates with placeholders ({case} {agent} {tl} {vrn} {tag} {amount} {link} …), test-mail buttons, recent-mail log.
- A new rule only mails complaints that arrive after it is saved; sent state is persisted so deploys never re-send.
