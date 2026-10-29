/* Incremental same-sheet duplicate detection. Cross-sheet matches are expected, not duplicates. */
import { normBarcode } from './stock-age.js';

export function createDuplicateBarcodeCollector() {
  const first = new Map(), duplicates = new Map();
  let scanned = 0, ignored = 0;
  return {
    add(row) {
      scanned++;
      const text = String(row.barcode ?? '').trim();
      // Placeholder strings with digits must not be converted into apparent barcodes.
      if (!text || (!/^[\d\s.,/-]+$/.test(text) && !/^\d+(?:\.\d+)?e[+-]?\d+$/i.test(text))) { ignored++; return; }
      const key = normBarcode(text);
      if (!key) { ignored++; return; }
      const item = { barcode: text, tagId: String(row.tagId ?? '').trim(), cls: String(row.cls ?? '').trim(), status: String(row.status ?? '').trim(), agentId: String(row.agentId ?? '').trim(), agentName: String(row.agentName ?? '').trim(), tl: String(row.tl ?? '').trim() };
      const group = duplicates.get(key);
      if (group) group.push(item);
      else if (first.has(key)) { duplicates.set(key, [first.get(key), item]); first.delete(key); }
      else first.set(key, item);
    },
    finish() {
      const groups = [...duplicates].map(([key, rows]) => ({ key, count: rows.length, rows })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
      return { scanned, ignored, groups, duplicateBarcodes: groups.length, duplicateRows: groups.reduce((n, g) => n + g.count, 0) };
    }
  };
}
