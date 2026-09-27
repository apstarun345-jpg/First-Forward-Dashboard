// node --import fixture for server integration tests; never loaded by npm start.
import fs from 'node:fs/promises';
import { mockSheetsFetch } from './mock-sheets-api.js';
if (!process.env.MOCK_SHEETS_FILE) throw new Error('This preload is for tests only.');
const realFetch = globalThis.fetch;
const mock = mockSheetsFetch({
  read: async () => JSON.parse(await fs.readFile(process.env.MOCK_SHEETS_FILE, 'utf8')),
  write: async value => fs.writeFile(process.env.MOCK_SHEETS_FILE, JSON.stringify(value)),
  failWrites: async () => !!await fs.stat(process.env.MOCK_SHEETS_FILE + '.fail').catch(() => null)
});
globalThis.fetch = (url, options) => /^https:\/\/(sheets|oauth2)\.googleapis\.com\//.test(String(url)) ? mock(url, options) : realFetch(url, options);
