# ApnaPayment: safe production update

> **Recommended (free, 5 min): [STORAGE_SETUP.md](STORAGE_SETUP.md)** — Apps Script web app +
> `APPS_SCRIPT_URL` / `APPS_SCRIPT_SECRET` on Render. The in-app wizard (Settings → ☁️ Storage &
> backup) copies current users/settings into the sheet before you set the variables.

> **Updated storage choice:** accounts and settings can now live encrypted in `APP_STORAGE`
> inside the SAME existing Google Sheet. Follow [SHEETS_STORAGE.md](SHEETS_STORAGE.md) for
> that setup; no new spreadsheet or persistent disk is needed for that mode. Back up the
> existing runtime files first. The disk checklist below applies only to `STORAGE_BACKEND=files`.

## Finding on 27 September 2026

The live `https://first-forward-dashboard.onrender.com/api/health` response reported
`dataDir: /opt/render/project/src/data` (version 3.1.0). This is the application directory,
not the `/data` persistent disk configured in this repository's Render Blueprint. Updating
`render.yaml` does **not** automatically attach a disk to a separately created Web Service.

These code changes have been tested locally; they do not provision a Render disk or deploy
this branch to the existing service.

## Before restarting or deploying the existing service

1. **Back up the current runtime store before any configuration change that restarts the service.**
   Use authorized Render Shell/SSH access to securely download all JSON files from the current
   health endpoint's `dataDir`: `users.json`, `sessions.json`, `settings.json`, `resets.json`,
   and `notifications.json` (some may not exist). Pause account/settings edits during backup.
   Settings → Backup exports **settings only**, not accounts or sessions.
2. Keep the backup encrypted/private. Do not paste its contents into chat, commit it to Git,
   or put it in a public download URL. It contains password hashes and sensitive account data.
3. Select an instance that supports persistent disks (the Blueprint uses Starter). In the
   existing Render service, attach a 1 GB persistent disk with mount path **`/data`** and set
   **`DATA_DIR=/data`**. This is a paid hosting change: the service owner must approve it.
   Setting the environment variable alone does not create a persistent disk.
4. Restore the backup into `/data` before normal traffic resumes, with read/write access for
   the Node process. Do not merge a newly bootstrapped account store over the old backup.
   Restart the app after restoring. The app can migrate `./data/*.json` only if those files
   still exist in the same runtime and the target is empty; it cannot recover files Render
   has already discarded. Keep the external backup until verification is complete.
5. Deploy the reviewed code from this session's branch through your normal review/deploy flow.
   Do not put `GVIZ_BASE` on the production service; it is only for local mock testing.
6. Check `/api/health`: `storage.dataDir` should point to `/data`,
   `storage.persistentDiskMounted` should be `true`, and `storage.error` / `storage.warning`
   should be `null`. Admins also see a storage warning in the app when storage is unsafe.
7. Log in, change a harmless theme colour/profile field, refresh the browser, then restart
   the Render service. Confirm that the session, colour, profile, users and changed admin
   password are unchanged. Test explicit logout separately. Sessions remain valid for the
   configured `SESSION_DAYS` (default 30), unless revoked or browser cookies are cleared.

## Mobile push notifications (OS notification panel)

Alerts must reach the phone's notification panel even when the app is closed. That path is
web push, and it breaks in exactly two ways — both were live bugs here and both are now fixed:

1. **The VAPID keypair changed between deploys.** A browser subscription is bound to the
   `applicationServerKey` it was created with, so a new keypair makes the push service reject
   every message with `403`.
2. **The VAPID auth headers were wrong.** The server used the legacy draft-01 scheme
   (`Authorization: WebPush <jwt>`) *without* the mandatory
   `Crypto-Key: p256ecdsa=<public key>` header, so FCM answered every delivery with
   `403 permission denied: crypto-key header had no public application server key specified`.

The symptom of both is easy to misread — the in-app 🔔 feed keeps working (it polls) while the
phone panel goes completely silent, and the app says *"Permission mil gayi hai par push
subscription active nahi"* because the old code also deleted the subscription on any `403`.

Today the server sends **RFC 8292** credentials (`Authorization: vapid t=<jwt>, k=<public key>`,
no `Crypto-Key` needed) and automatically falls back to the legacy pair
(`WebPush <jwt>` + `Crypto-Key: p256ecdsa=<key>`) for a push service that only understands that
scheme; whichever scheme succeeds becomes the default for the rest of the process lifetime
(`PUSH_AUTH_SCHEME=legacy` forces the other starting point). A `401/403` now only deletes a
subscription when the message really is about that subscription (key mismatch / expired /
unregistered); a server-side credential problem keeps every subscription intact and is reported
as `configError` in `/api/push/status` and `/api/health`.

Keys are therefore resolved in this order:

1. `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` environment variables (explicit pin). Optional —
   the durable store below keeps keys stable without them — but this is the *permanent* option:
   keys can then never change, no matter what happens to storage. Generate a pair with
   `npm run push:keys` (zero dependencies; same output shape as
   `npx web-push generate-vapid-keys`), paste both values into Render → Environment, deploy.
   Never commit the private key. The server also accepts its own internal PKCS8/SPKI formats and
   always derives the browser-ready public point from the private key. Optionally set
   `VAPID_SUBJECT` (`mailto:` or `https:` contact; localhost-style values get `403 BadJwtToken`).
2. Durable storage — `notify.vapid` in the same Apps Script / Sheets record as the users and
   notification feed. This is what makes push survive a redeploy on a service with no disk.
3. `DATA_DIR/vapid.json` (local `files` backend, or a within-boot cache on a container disk).
4. Generated once, then written to both the durable store and the file.

After deploying, verify:

0. `GET /api/push/vapid` → `publicKey` must decode (base64url) to **65 bytes starting with
   `0x04`** — the raw uncompressed P-256 point browsers require as `applicationServerKey`.
   A 91-byte value was the old SPKI-DER bug that made Chrome throw
   *"The provided applicationServerKey is not valid"*; the server now always derives the raw
   point from the private key, heals any stored/env key in the old format automatically, and
   re-saves the healed copy, so signing keys (and existing subscriptions) stay unchanged.
1. `GET /api/health` → `push.enabled` is `true`, `push.durable` is `true`, `push.warning` is
   `null`, `push.ttl` is `86400`, `push.scheme` is `vapid`, and **`push.selfTest.ok` is `true`**.
   The self-test signs a JWT and verifies it with the server's own public key, checks the 65-byte
   raw-point format and the `sub` claim — i.e. it proves the credentials are sendable before any
   phone is involved. Admins also see a 📲 banner in the app when `push.warning` is set. If
   `durable` is `false`, set the two `VAPID_*` variables (or attach a disk) — otherwise the next
   deploy silently breaks every registered phone. The server retries the durable save every 60 s
   until it succeeds.
2. Restart the service once and confirm `GET /api/push/vapid` returns **the same** `publicKey`.
3. On the phone: install the app (Android Chrome menu → Install app; iOS 16.4+ → Add to Home
   Screen) and sign in. The 🔔 panel has a single **Notifications ON/OFF** switch — turn it on and
   allow the browser prompt (it is also requested automatically on the first click after login).
   Then, as admin, open **Settings → 👤 My account → 📲 Push diagnostics** and tap
   **🛰 Server push test**. The alert should appear in the OS panel with the app closed.
   `GET /api/push/status` shows the registered device count plus `lastOk` / `lastError` /
   `configError` for that account.
4. Existing devices that subscribed under an older (now lost) key heal themselves: on the next app
   open the client compares the server key with its subscription and re-subscribes when they differ.
   `sw.js` also handles `pushsubscriptionchange`, and stashes the new subscription if the session
   had expired so the page can flush it on the next open.

### Push troubleshooting

| Symptom (in `/api/push/status` → `lastError.error`, or the boot log) | Cause | Fix |
| --- | --- | --- |
| `403 permission denied: crypto-key header had no public application server key specified` | Legacy `Authorization: WebPush` scheme sent without the `Crypto-Key: p256ecdsa=` header (the old bug) | Fixed in code — deliveries now use `Authorization: vapid t=…, k=…`. Redeploy; the subscription is kept, so the phone recovers on its own |
| `403 BadJwtToken` / `invalid JWT` | `sub` claim is a localhost-style address, server clock is skewed, or the keypair is corrupt | Set `VAPID_SUBJECT` to a real `mailto:`; check the container clock; `push.selfTest` in `/api/health` names the exact problem |
| `403 …does not match the application server key of the subscription` | The VAPID keypair changed after the phone subscribed | Pin `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (`npm run push:keys`). Stale subscriptions are pruned at boot and every client re-subscribes on next open |
| `push.durable: false` / `push.warning` set | Keys live only on the ephemeral container disk | Set the two `VAPID_*` env vars, or configure Apps Script/Sheets storage, or attach a Render disk |
| `404` / `410` | The browser/push service retired that subscription | Automatic: the subscription is dropped and the device re-subscribes on next open |
| Nothing at all, `subs: 0` | No device ever subscribed (permission not granted, or iOS without an installed PWA) | Flip the 🔔 switch on (or Settings → My account → 🔔 Notifications); on iOS install to the home screen first |
| `configError` set, deliveries rejected | Server-side credentials rejected | Open Settings → 👤 My account → 📲 Push diagnostics (admin) and read the self-test line; subscriptions are *not* deleted in this state |

Every delivery attempt is logged (`db.notify.pushLog`, last 40) with its status, scheme, host and
verdict, so "the phone is silent" is never a guessing game again.

If current data was already lost on an earlier deployment, the code cannot reconstruct it;
restore a known backup or recreate the missing accounts/settings. If sessions were lost,
one new login is necessary after durable storage is configured.

## Loading and app icons

- Normal startup uses the server cache, not forced Google refresh. All permitted sheet
  previews preload in parallel with FF/GV datasets; ready pages do not await unrelated queries.
- Large inventories warm their first page and count, keeping memory and Google traffic bounded.
  New searches/filters/later pages still fetch on demand. Initial uncached Google requests and
  an actual sleeping Render instance still take time; no loading animation can remove that.
- The greeting is non-blocking and dismissible, with reduced-motion support. It does not delay
  authentication or sheet requests.
- The v5 app shell, favicon and PWA icons use ApnaPayment's A/dot/yellow-triangle identity.
  Existing installed PWAs may update the home-screen icon later according to their browser/OS;
  if it stays old after a successful deployment and browser reload, remove and reinstall the
  home-screen shortcut. Do **not** clear site cookies merely to update the icon.
- Service-worker caches contain app assets only, never auth/API responses. An offline or
  failed session check shows Retry rather than pretending the user is logged out.

## Validation completed locally

`npm run check`, `npm test`, and `npm run smoke` pass. Regression tests start/stop real Node
servers and verify persistence and disk failure handling. Chromium checks using the local
mock Google Sheets confirmed session restoration on browser refresh, no JavaScript page
errors, theme colour auto-save surviving reload, and zero extra gviz requests when opening the five preloaded sheet tabs. These are
local functional checks, not a production Google Sheets latency benchmark.
