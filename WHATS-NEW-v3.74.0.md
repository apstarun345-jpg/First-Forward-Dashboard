# v3.74.0 — Smart Home + Native Mobile Layout

- Added a Quick access section near the top of Home so common workflows are immediately reachable.
- Shortcuts are filtered by the signed-in user's existing page permissions and point to existing routes; no new request, data or API workflow is introduced.
- Reworked phone/PWA typography and controls to sensible native app sizes after reviewing legacy rules that inflated body text to 30px and headings up to 46px.
- Fixed the mobile bottom navigation to use six columns for its six items and made More visibly active/accessibly announced on secondary pages.
- Kept mobile topbar uncluttered; secondary controls remain available through the existing More control. Added safe-area-aware bottom navigation, dark theme details and visible keyboard focus.
- Bumped the stylesheet and service-worker cache versions.

Validation: regression coverage added for role-aware Home shortcuts, the six-item navigation and native-scale sizing. Existing login, settings, tag requests, APIs and data flows remain unchanged. This stays on the feature branch until CI passes and the PR is reviewed; no Render production deployment is triggered.
