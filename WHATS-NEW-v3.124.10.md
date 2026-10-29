# v3.124.10 — Personal Link Welcome Journey

- Verified agent and team links with Overview or Issuance access now have a welcome journey: earliest activity recorded in the link-scoped EIR, current-month EIR issuance through yesterday, and shortcuts only to sections enabled for that link. Team views highlight recent first recorded activity (90 days) and explicitly selected agents without an EIR record.
- The first recorded EIR activity is **not** a verified joining date. It can omit history outside the selected TL or EIR, including GV Master. EIR data may be cached. Same-name records can merge, and overlapping team parts use their highest count to avoid double counting.
- On a cold open the verified report shell appears quickly while sheet data loads; recent cached reports open immediately with a refresh indicator. Retry states keep loading or failed data distinct from an empty report. New agents without issuance or stock can still open the report.
- Updated the personal-link header with a teal palette and styled name. Channel filters, link permissions, verification, and revoked sessions remain enforced.
