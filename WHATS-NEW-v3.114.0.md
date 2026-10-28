# v3.114.0 — Complaints mail: multi-select TL / agents + attachments
- Mail rules now pick several TLs and several agents (name or ID, chips with suggestions) or "All complaints".
- New / deducted mails carry the complaint mail's screenshots & files (option per rule). Needs the updated Code.gs (`complaintfiles` action) deployed as New version.
- Mailer: binary attachments supported (already-base64 content).
