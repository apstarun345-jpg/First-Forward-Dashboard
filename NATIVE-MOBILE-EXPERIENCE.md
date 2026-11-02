# Native mobile experience

## Existing mobile foundation retained

The dashboard already has a Material-style app bar, six-item bottom navigation, full-screen search, Android Back handling, pull-to-refresh, safe-area padding, a service worker, per-user IndexedDB sheet snapshots, reconnect refresh, Web Push and push-subscription recovery. This upgrade keeps those features and adds local device security plus an explicit offline read-only mode.

## Enable device biometric lock

On a supported phone, open **Options → Device security**.

1. Select **Enable device biometric lock**.
2. Approve the phone's platform-authenticator prompt using fingerprint, Face ID or the device screen lock.
3. Choose when the app should lock after it is backgrounded.
4. Use **Lock app now** to test it.

The local lock uses WebAuthn platform authentication with required user verification. On unlock it checks the challenge, origin, relying-party domain hash, user-verification flag and ES256 signature locally. The private key and biometric template stay with the phone authenticator. IndexedDB stores only the public key and credential ID, keyed by the signed-in dashboard username. Nothing biometric is uploaded.

This is an additional local privacy barrier for a session that is already authenticated. It does not replace server login, session expiry, account permissions or server-side access checks. The operating system may ask for the phone PIN/passcode when fingerprint or face verification is unavailable. The feature requires HTTPS, a current supported browser, a platform authenticator and browser access to the authenticator public key. If unsupported, setup displays an explanation and does not enable a fake lock.

If browser data is cleared or the platform credential is removed, choose **Use password instead** while online, sign in normally and configure the device lock again. Do not treat the local lock as device encryption or remote account revocation.

## Offline behaviour

The dashboard already stores successful Google Sheet query snapshots in IndexedDB, separated by signed-in username and limited to 36 hours. In mobile offline mode, the dashboard remains view-only; writes made through the dashboard API client are rejected with an explicit offline message. Read-only report snapshots remain available. On reconnect, the existing foreground sync flow refreshes data. Form submissions are never automatically replayed.

The service worker and backend already support OS Web Push and subscription recovery. Push alerts may arrive while the app is closed when the browser/OS supports Web Push and the device has an active subscription. A full data refresh while the app is closed is not guaranteed across browsers and operating systems; the next foreground/open event refreshes the dashboard.

## Compatibility

- Android: use a current Chrome-based browser and install the PWA from the browser install prompt.
- iPhone/iPad: add the site to the Home Screen and use a current Safari version. Web Push and platform-authenticator availability depend on the OS/browser version.
- Biometrics are not simulated. If a device/browser does not expose a usable platform authenticator and public key, setup fails safely with an explanation.
