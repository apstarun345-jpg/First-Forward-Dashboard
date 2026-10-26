# v3.99.0

- **ID aliases from Sheet4**: New Agent ID (col A), Agent ID (col B), Assistant ID (col M) are synced from the Agent master sheet (`GET /api/agent-aliases`).
- **Search by Assistant ID / Agent ID everywhere**: type or paste one in any search box (Master Search, top bar, Ctrl+K, Tag Request, Dispatch, Performance, Agent Summary …) and it is converted to the agent's New ID, so that agent's data opens. A toast shows the conversion. Ambiguous IDs (one assistant under several agents) and real New IDs are never rewritten.
- Master Search hero shows the agent's Agent ID / Assistant ID chips with copy buttons.
- **Settings → Agent master (Sheet4)**: choose sheet link, tab (gid or tab name) and every column (New ID, Agent ID, Assistant ID, Name, TL ID, TL Name) + a "Sync now" test button.
- Sheet4 search (New IDs page) also matches Assistant ID.
