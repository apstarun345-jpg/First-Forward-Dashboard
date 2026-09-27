// Explicit, one-time migration. Run privately with a secure backup directory and server secrets.
// Does not start the website, print account records, or remove the source backup.
import fs from 'node:fs/promises';
import path from 'node:path';
import { sheetsStoreFromEnv } from '../sheets-storage.js';
async function main() {
  if (!process.env.DATA_DIR || !process.env.STORAGE_SHEET_ID) throw new Error('Set DATA_DIR to the private existing backup directory and STORAGE_SHEET_ID to the same main Google Sheet ID.');
  const read = async (filename, fallback) => {
    try { return JSON.parse(await fs.readFile(path.join(process.env.DATA_DIR, filename), 'utf8')); }
    catch (err) { if (err.code === 'ENOENT' && fallback !== undefined) return fallback; throw new Error(`Cannot read ${filename}. Restore a valid private backup before migrating.`); }
  };
  const data = {
    users: await read('users.json'), sessions: await read('sessions.json', {}),
    settings: await read('settings.json', {}), resets: await read('resets.json', []),
    notify: await read('notifications.json', { items: [], watch: {} })
  };
  if (data.settings.sheetId && data.settings.sheetId !== process.env.STORAGE_SHEET_ID) throw new Error('STORAGE_SHEET_ID does not match the main sheet ID in the backup settings. Use the existing main sheet.');
  const store = await sheetsStoreFromEnv(process.env.STORAGE_SHEET_ID);
  await store.initialize(data);
  console.log('Migration verified: encrypted users, sessions, settings, resets and notifications saved in APP_STORAGE on the existing spreadsheet.');
  console.log('Now configure the website with STORAGE_BACKEND=sheets and the SAME service-account secret, spreadsheet ID and encryption key. Keep the private backup.');
}
main().catch(err => { console.error('Migration stopped:', err.message); process.exitCode = 1; });
