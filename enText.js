// Server-side English for text that never reaches the browser's DOM translator
// (push notifications, emails, stored notification items, API messages).
// Re-uses the exact same dictionaries as the browser: i18n.js + i18n-en.js.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
let T = null;
function load() {
  if (T) return T;
  try {
    const sandbox = { window: {}, console };
    sandbox.window.window = sandbox.window;
    vm.createContext(sandbox);
    for (const f of ['i18n.js', 'i18n-en.js']) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), sandbox, { filename: f });
    const fn = sandbox.window.FF && sandbox.window.FF.i18n && sandbox.window.FF.i18n.t;
    T = typeof fn === 'function' ? (s) => fn(s, 'en') : (s) => s;
  } catch { T = (s) => s; }
  return T;
}
/** English version of a Hinglish string (unknown text comes back unchanged). */
export function en(str) {
  if (typeof str !== 'string' || !str) return str;
  try { return load()(str); } catch { return str; }
}
/** Translate the human-readable string fields of a shallow object. */
export function enFields(obj, fields) {
  if (!obj || typeof obj !== 'object') return obj;
  for (const f of fields) if (typeof obj[f] === 'string') obj[f] = en(obj[f]);
  return obj;
}
