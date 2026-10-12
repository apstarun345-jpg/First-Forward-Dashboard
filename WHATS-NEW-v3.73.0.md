# v3.73.0 — Notification Inbox + Mobile Navigation

- Notification Center keeps up to 500 recent alerts in the active session and reveals the filtered results in 50-item batches.
- Added an unread-only toggle, corrected matching-result counts, and reset pagination when filters change.
- Inbox search restores focus and caret after results update, so typing does not get interrupted by re-rendering.
- Mark-all-read and incoming alerts refresh the open inbox without stealing focus from active search.
- Notifications without a destination page now open a readable detail drawer instead of appearing to do nothing.
- Mobile navigation now announces the active page to assistive technology; Search and Alerts actions expose useful accessible labels.
- The mobile inbox gets responsive filter controls, readable alert cards, keyboard focus rings, dark-theme styling, and larger touch targets.
- PWA shell cache and mobile stylesheet version were refreshed. Existing login, settings, tag requests, data storage, and route destinations are not intentionally changed.

Validation: regression assertions added. Production deployment is intentionally not triggered from this feature branch.
