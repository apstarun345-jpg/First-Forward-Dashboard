import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const security = fs.readFileSync(path.join(ROOT, 'native-security.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'native-security.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const auth = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const data = fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8');

test('native device security is restricted to the mobile shell and is loaded by the app', () => {
  assert.match(security, /classList\.contains\('mobile-ui'\)/);
  assert.match(html, /native-security\.js/);
  assert.match(html, /native-security\.css/);
  assert.match(css, /\.nsec-lock-screen/);
});

test('device enrolment requires HTTPS, a platform authenticator and user verification', () => {
  assert.match(security, /window\.isSecureContext/);
  assert.match(security, /isUserVerifyingPlatformAuthenticatorAvailable/);
  assert.match(security, /authenticatorAttachment:\s*'platform'/);
  assert.match(security, /userVerification:\s*'required'/);
  assert.match(security, /getPublicKey\(\)/);
  assert.match(security, /algorithm:\s*'ES256'/);
});

test('local unlock verifies challenge, origin, relying-party hash, UV flag and ES256 signature', () => {
  assert.match(security, /data\.origin !== location\.origin/);
  assert.match(security, /data\.challenge !== base64url\(challenge\)/);
  assert.match(security, /digest\(new TextEncoder\(\)\.encode\(config\.rpId\)\)/);
  assert.match(security, /flags & 0x04/);
  assert.match(security, /crypto\.subtle\.verify/);
  assert.match(security, /derToP1363/);
});

test('device public key and credential ID are stored locally, not posted to the backend', () => {
  assert.match(security, /ff-native-device-lock/);
  assert.match(security, /credentialId:\s*base64url/);
  assert.match(security, /publicKey:\s*base64url/);
  assert.doesNotMatch(security, /\/api\/.*(?:biometric|webauthn)/);
});

test('restored authenticated sessions are gated before the app login flow continues', () => {
  assert.match(security, /const original = FF\.auth\.init\.bind\(FF\.auth\)/);
  assert.match(security, /prepareRestoredSession\(FF\.auth\.user\)/);
  assert.match(auth, /async function init\(\)/);
  assert.match(app, /await FF\.auth\.init\(\)/);
});

test('offline mobile mode blocks writes and keeps existing per-user snapshots available', () => {
  assert.match(security, /OfflineWriteBlockedError/);
  assert.match(security, /navigator\.onLine === false/);
  assert.match(security, /readOnlyPost/);
  assert.match(data, /persistent sheet snapshot \(IndexedDB, per user\)/);
  assert.match(data, /MAX_AGE_MS:\s*36 \* 3600e3/);
});

test('device lock has password recovery and configurable relock timing', () => {
  assert.match(security, /Use password instead/);
  assert.match(security, /TIMEOUTS/);
  assert.match(security, /visibilitychange/);
  assert.match(security, /lockAfterMs/);
});
