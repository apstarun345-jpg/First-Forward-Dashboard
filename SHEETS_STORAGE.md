# Save accounts and settings in the SAME Google Sheet

No new spreadsheet is needed. The app can use a dedicated **`APP_STORAGE`** tab inside the
existing **First Forward / main spreadsheet**. It does not modify EIR, REPORT, StockDataa,
or the GV workbook. The storage tab is not added to dashboard navigation.

**Status:** implementation and mocked Google API/restart tests are complete. Live Google
writing requires the owner's Google service-account access and Render secret configuration.
Nothing in this repository has connected to or modified the real spreadsheet yet.

## Why the records are encrypted

The current business spreadsheet is publicly readable for its Visualization queries. Hidden
tabs are **not private**. Never store readable usernames, password hashes, personal details or
session records in that workbook. The storage adapter encrypts each complete record with
**AES-256-GCM**, a random nonce and a permanent server-only 32-byte key. Passwords remain
salted scrypt hashes **inside** the encrypted users record; raw passwords are never saved.
Sessions contain token hashes rather than login-cookie values.

Only dataset labels and encrypted chunks are visible in APP_STORAGE. Edits must be made through
the dashboard; cells are not a human-editable users table. Encryption detects forged/corrupt
records, but cannot prevent spreadsheet editors from deleting or restoring an older version.
Keep public access **Viewer only**, limit Editor access to trusted administrators and the
service account, and keep backups. Hiding the tab is only to reduce accidental edits.

## 1. Back up the current app FIRST

Before changing Render environment variables or deploying (both may restart the service),
securely back up its current runtime directory. The previous live health response reported
`/opt/render/project/src/data`. Preserve `users.json`, `sessions.json`, `settings.json`,
`resets.json`, and `notifications.json` where present. Pause user/settings edits during the
final migration. Settings → Backup downloads only settings, not accounts or sessions.

Store the backup privately, outside this repository. Do not paste it into chat or commit it.
If an earlier deploy already lost the accounts, they must be restored from a backup; Sheets
cannot recover them retroactively. Migration refuses to seed an empty/new default account store.

## 2. Allow server-side Google writes

1. In an owner-controlled Google Cloud project, enable **Google Sheets API**.
2. Create a service account. Download its JSON key privately.
3. In the **same existing main spreadsheet**, use Share to give the service account's
   `client_email` **Editor** access. Leave ordinary public access at Viewer. Do not make the
   workbook publicly editable. Grant this account access only to the necessary workbook.
4. Keep the JSON in a Render **Secret File** (e.g. `/etc/secrets/google-service-account.json`)
   or a secret environment value. Do not put it in the browser, repository, or chat.

## 3. Generate and KEEP the encryption key

On your own trusted machine, `openssl rand -base64 32` generates a suitable key. Save that
value privately in a password manager and Render's `STORAGE_ENCRYPTION_KEY` secret. Never
share the output in chat or commit it. **Use the exact same key for migration and the app.**

Do not generate a new key on each deployment. Losing/changing it makes the existing encrypted
records unreadable. Rotation requires a planned decrypt/re-encrypt migration; changing the
environment variable alone is not rotation. The app deliberately stops instead of resetting users.

## 4. One-time migration BEFORE switching the running app

Use a trusted machine with this code and the private JSON backup. Configure these environment
variables privately (do not include secret values in shell history):

| Variable | Value |
| --- | --- |
| `DATA_DIR` | Absolute path to the existing private backup directory |
| `STORAGE_SHEET_ID` | ID of the **existing main sheet**, matching Settings → Data source |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | Absolute path to the downloaded key file **outside the repo** |
| `STORAGE_ENCRYPTION_KEY` | The permanent 32-byte base64 secret generated above |

Then run:

```sh
npm run storage:migrate
```

This command creates APP_STORAGE only if necessary and saves all five datasets as encrypted
records in one Google batch, then reads/decrypts them to verify the migration. It refuses to
overwrite an initialized, partially populated, or corrupt storage tab. It leaves the local
backup untouched. Stop if verification fails; do not switch the live service yet.

The default main sheet in this repository is
`1ZHzmu7xtXl7trZDOXUbFmclJGffy98U4kz2QBSKsfwc`. Use the actual ID from the existing app settings
if the data source was changed. Do not create another spreadsheet.

## 5. Enable Sheets persistence on Render

After successful migration, configure the existing service with:

| Variable | Value |
| --- | --- |
| `STORAGE_BACKEND` | `sheets` |
| `STORAGE_SHEET_ID` | The same ID used for migration |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | `/etc/secrets/google-service-account.json` (your Render Secret File) |
| `STORAGE_ENCRYPTION_KEY` | The exact same secret used for migration |

Alternatively use secret `GOOGLE_SERVICE_ACCOUNT_JSON` instead of the file variable. No
service-account credentials or encryption keys are read from dashboard settings or sent to
the browser. Existing Google Visualization business-data queries remain unchanged.

Deploy the reviewed code. In Sheets mode, a persistent Render disk is **not required for app
accounts/settings/sessions**. Do not delete an existing disk until migration has been verified
and its private backup is safe. `render.yaml` retains the original file-storage disk to avoid
destructive infrastructure changes; for an existing service, use the environment settings above.

Verify `/api/health` reports `storage.backend: "sheets"`, `encrypted: true`, `tab: "APP_STORAGE"`,
and no storage error. Change a theme colour/profile, refresh, restart the service, and confirm
the values and login remain. Settings → Backup shows the active backend.

An advanced alternative is `STORAGE_INITIALIZE=1` for one startup with the existing files still
in DATA_DIR. It refuses an empty users store. **Remove that flag immediately after successful
initialization.** The separate migration command above is safer for an ephemeral existing service.

## Runtime behaviour and limitations

- A single Node instance loads/decrypts the store at startup and serves reads from memory.
  Normal navigation and `/api/auth/me` do not call Google. Confirmed updates are saved to Sheets;
  nearby writes are batched to reduce requests. Startup while Google is unavailable fails safely.
- Login confirms the session and login timestamp before returning its persistent cookie.
  Sessions still expire after `SESSION_DAYS` (30 days by default), or on explicit revocation.
- Google 429/5xx responses have bounded retries. A failed save returns HTTP 503 and is **not**
  reported as Saved; there is no unsafe fallback to temporary files in Sheets mode.
- If Google accepts a write but its reply is lost, the client sees "Save not confirmed". Retry
  or restart to reconcile; Google Sheets is not a transactional authentication database.
- Use **one writer/one service instance** for this storage tab. Do not run production, preview,
  autoscaled replicas or overlapping deployments writing the same tab concurrently. Sheets has
  no compare-and-swap transaction for the in-memory snapshots used here. Plan a short controlled
  stop/start cutover for deployments, not overlapping old/new writers.
- Manual spreadsheet edits are not synchronized into the running server. Do not edit encrypted
  cells. Deleting/moving rows, the tab, or changing the encryption key can prevent startup.
- Google API quotas still apply; this is intended for a small dashboard, not high-volume auth.
  Encrypted records are chunked below the 50k-character cell limit; each dataset is limited to
  12 MB plaintext. Large avatars/settings images can reach that limit; downsize them.
- Back up both encrypted APP_STORAGE and the encryption key separately. A settings JSON export
  is not an account backup. Public ciphertext may also remain in Google revision history.
- Free Render idle cold-start delay and uncached business-sheet latency are separate from data
  persistence; cloud storage does not remove those hosting delays.

## Tests

`npm test` includes encryption/tamper/chunk tests, mocked Google authentication and batch writes,
quota retries, preserving business tabs, rejecting damaged storage, and restarting a real Node
server after deleting its local DATA_DIR. The cookie, saved user and theme survive from the
mocked encrypted Google Sheet. Live credentials/access are not available in this workspace,
so no real Google write is claimed.
