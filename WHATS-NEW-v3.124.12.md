# v3.124.12 — Animated New Joiners on Home

- Home now shows a continuously animated welcome strip for agents whose first recorded EIR issuance was in the current or previous month, following the existing new-agent detection rule. Each card shows name, agent ID, channel and current-month EIR issuance. A full list is available underneath, with a pause/resume control for the animation and support for reduced-motion settings.
- The earliest month in the available channel history is excluded because earlier history is unknown. An agent without an EIR issuance cannot be identified by this rule; missing or changed IDs can affect matching. The count is EIR only and may be delayed; it does not include live GV Master issuance.
- The feature runs in the background without blocking Home, shows clear loading/error/retry states, respects FF/GV issuance permissions, and can be reordered or hidden in Home customization.
