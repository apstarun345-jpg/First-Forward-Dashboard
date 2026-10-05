# ✨ v3.54.0 — Employee request tracking + remembered agent addresses

## 🌐 Employees can track their own requests

- The public employee link now shows an **All requests** view plus clickable **Pending**, **Approved**, **Dispatched**, and **Rejected** filters with live counts.
- Request history is easier to scan: **10 requests per page** with **Previous / Next** controls; each card keeps the request ID, agent, class quantities, current status, and admin note.
- The private employee token still scopes history to the requests submitted from that employee link/browser. No address or submitter IP is included in the status summary.

## 📇 Previous agent address is suggested again

- Agent mobile, full address, and pincode are saved to the server-side Address book after a per-agent request, so a repeat request can suggest the prior details even from another browser/device.
- Fresh submissions immediately invalidate the lookup cache and the newest contact wins. The employee can verify the suggested details before sending.

## ✅ Regression coverage

- Added UI coverage for status filtering, request counts, 10-row pagination, and admin-note rendering.
- Added server integration coverage for employee-token history, private summary fields, and address lookup/update after repeat requests.

## 🔧 Cache/version

`package.json` / `/api/health`: `3.54.0`; `config.js?v=106` refreshes lazy modules, `styles.css?v=107`, and service-worker cache `apnapayment-v110`.
