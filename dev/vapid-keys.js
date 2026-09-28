#!/usr/bin/env node
/* 📲 VAPID keypair generator (zero dependencies).

   Push notifications ko PERMANENTLY stable rakhne ka sabse pakka tareeka: keys ek baar generate karo
   aur Render ke environment variables me pin kar do. Isse redeploy / restart / storage failure par
   bhi applicationServerKey kabhi nahi badlega — matlab phone ki purani subscriptions kabhi 403 nahi
   khaayengi.

   Usage:
     npm run push:keys            # nayi keypair banao + Render instructions
     node dev/vapid-keys.js       # same

   Output `npx web-push generate-vapid-keys` jaisa hi hota hai:
     VAPID_PUBLIC_KEY  = 65-byte uncompressed P-256 point (0x04||X||Y), base64url
     VAPID_PRIVATE_KEY = 32-byte raw P-256 scalar, base64url
   Server dono formats samajhta hai (raw scalar ya PKCS8 DER), aur public key hamesha private key se
   derive karta hai — isliye sirf private key bhi sahi ho to kaam chal jaata hai.

   ⚠️ Private key ko Git me commit mat karo. Sirf Render → Environment me paste karo.
*/
import crypto from 'node:crypto';

function generate() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const d = Buffer.from(jwk.d, 'base64url');
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  if (d.length !== 32 || x.length !== 32 || y.length !== 32) throw new Error('unexpected key size');
  const publicKey = Buffer.concat([Buffer.from([4]), x, y]).toString('base64url'); // browser-ready
  return { publicKey, privateKey: d.toString('base64url') };
}

/** Banaye hue pair ko wahi verify karo jo push service karegi (ES256 JWT round-trip). */
function verify({ publicKey, privateKey }) {
  const raw = Buffer.from(publicKey, 'base64url');
  if (raw.length !== 65 || raw[0] !== 4) throw new Error('public key 65-byte raw point nahi hai');
  const keyObject = crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33, 65).toString('base64url'), d: privateKey },
    format: 'jwk'
  });
  const b64url = (v) => Buffer.from(v).toString('base64url');
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64url(JSON.stringify({ aud: 'https://fcm.googleapis.com', exp: Math.floor(Date.now() / 1000) + 3600, sub: 'mailto:admin@example.com' }));
  const sig = crypto.createSign('sha256').update(`${header}.${payload}`).sign({ key: keyObject, dsaEncoding: 'ieee-p1363' });
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33, 65).toString('base64url') }, format: 'jwk' });
  if (!crypto.verify('sha256', Buffer.from(`${header}.${payload}`), { key: pub, dsaEncoding: 'ieee-p1363' }, sig)) throw new Error('JWT signature verify nahi hui');
  // RFC 8292 scheme ka header shape bhi check kar lo.
  const auth = `vapid t=${header}.${payload}.${b64url(sig)}, k=${publicKey}`;
  if (!/^vapid t=[^,]+, k=.{80,}$/.test(auth)) throw new Error('Authorization header shape galat hai');
  return true;
}

const keys = generate();
verify(keys);
console.log('✅ Naya VAPID keypair ready (ES256 JWT round-trip verify ho gaya)\n');
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
console.log(`\n(public key ${Buffer.from(keys.publicKey, 'base64url').length} bytes · private key ${Buffer.from(keys.privateKey, 'base64url').length} bytes)\n`);
console.log('Ab kya karna hai — Render par ek baar:');
console.log('  1. Render dashboard → tumhara Web Service → Environment');
console.log('  2. VAPID_PUBLIC_KEY  = upar wali public key paste karo');
console.log('  3. VAPID_PRIVATE_KEY = upar wali private key paste karo');
console.log('  4. (optional) VAPID_SUBJECT = mailto:tumhara@email  — push service ke liye contact');
console.log('  5. Save Changes → deploy hone do');
console.log('\nVerify:');
console.log('  curl https://<tumhara-app>/api/health   →  push.selfTest.ok = true, push.durable = true');
console.log('  Settings → 👤 My account → 📲 Push diagnostics → "🛰 Server push test" → phone ka panel dekho');
console.log('\n⚠️  Private key Git me commit mat karna. Key pair badalna = sabhi devices ko dobara subscribe karna padega.');
