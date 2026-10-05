// Synthetic Google Sheets API, used only by tests. Never enables production network overrides.
export const emptyWorkbook = () => ({ sheets: [{ properties: { title: 'EIR', sheetId: 0, gridProperties: { rowCount: 1000, columnCount: 60 } } }], rows: [] });
export function mockSheetsFetch({ read, write, failWrites = async () => false, calls = [] }) {
  return async (url, options = {}) => {
    const address = new URL(url);
    const body = options.body ? parseBody(options.body, address.hostname) : null;
    calls.push({ url, method: options.method || 'GET', body });
    const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    if (address.hostname === 'oauth2.googleapis.com') return response({ access_token: 'synthetic-test-token', expires_in: 3600 });
    if (address.hostname !== 'sheets.googleapis.com') throw new Error('Unexpected mock host');
    const state = await read();
    if (options.method === 'POST' && await failWrites()) return response({ error: 'Simulated denied write' }, 403);
    if (address.pathname.endsWith('/values:batchUpdate')) {
      const rows = structuredClone(state.rows);
      for (const item of body.data) {
        const index = Number(item.range.match(/!A(\d+):/)[1]) - 1;
        // Mimic real Sheets: cells after a shortened write remain, but chunk count excludes them.
        const old = rows[index] || [];
        rows[index] = [...item.values[0], ...old.slice(item.values[0].length)];
      }
      state.rows = rows; await write(state); return response({ totalUpdatedRows: body.data.length });
    }
    if (address.pathname.endsWith(':batchUpdate')) {
      const replies = [];
      for (const request of body.requests) {
        if (request.addSheet) {
          const properties = { ...request.addSheet.properties, sheetId: 99 };
          state.sheets.push({ properties }); replies.push({ addSheet: { properties } });
        } else if (request.updateSheetProperties) {
          Object.assign(state.sheets.find(s => s.properties.sheetId === request.updateSheetProperties.properties.sheetId).properties, request.updateSheetProperties.properties);
          replies.push({});
        }
      }
      await write(state); return response({ replies });
    }
    if (address.pathname.includes('/values/')) return response({ values: state.rows });
    return response({ sheets: state.sheets });
  };
}
// Private local helper, not a global JSON modification.
const parseBody = (body, host) => host === 'oauth2.googleapis.com' ? Object.fromEntries(new URLSearchParams(body)) : JSON.parse(body);
