/* 🏷️ v3.125.374 — Issued barcode register (Last dispatch → "Issued" rows ka asli data).
 *
 * Problem: dispatch range ke jo barcode stock list se nikal chuke (issued), unka Tag ID / VRN / agent / date kahin nahi dikhta tha —
 *   StockDataa me sirf stock wale barcode rehte hain aur EIR me barcode column hi nahi hai (sirf TAG_ID).
 * Solution (roz raat ek baar):
 *   1. Stock list ka snapshot (barcode → Tag ID, class) yaad rakho.
 *   2. Agle din jo barcode stock se nikal gaye → "left" list.
 *   3. Left barcode ka Tag ID se pehle GV Master (agar wahan mile to GV ka hi data), warna EIR me dhundo → save.
 *   4. Dispatch list ab seedha is register se instant (GV Master serial se bhi, barcode seedha).
 * Yeh file sirf store + diff logic hai (pure, testable) — Google queries server.js me hain.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const digits = (v) => String(v == null ? '' : v).replace(/\D/g, '');
const MAX_RESOLVED = 250000, MAX_PENDING = 20000, PENDING_DAYS = 10;

export function createIssuedStore({ dir, now = () => Date.now() }) {
  const file = path.join(dir, 'issued-barcodes.json.gz');
  const prevFile = path.join(dir, 'stock-barcodes-prev.json.gz');
  let st = { resolved: {}, pending: {}, lastRun: 0, lastRunDay: '', lastStats: null, snapAt: 0 };
  let dirty = false, timer = null;
  const readGz = (f) => { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8')); } catch { return null; } };
  const writeGz = (f, obj) => { fs.mkdirSync(dir, { recursive: true }); const tmp = `${f}.tmp`; fs.writeFileSync(tmp, zlib.gzipSync(Buffer.from(JSON.stringify(obj)))); fs.renameSync(tmp, f); };
  const load = () => { const j = readGz(file); if (j && typeof j === 'object') st = { ...st, ...j, resolved: j.resolved || {}, pending: j.pending || {} }; return st; };
  const save = () => { try { writeGz(file, st); dirty = false; } catch { /* disk optional */ } };
  const saveSoon = () => { dirty = true; if (timer) return; timer = setTimeout(() => { timer = null; if (dirty) save(); }, 3000); if (timer.unref) timer.unref(); };

  /** rec: { t tagId, c cls, v vrn, d 'YYYY-MM-DD', tm 'h:mm:ss AM', a agent, ai agentId, tl, s 'gv'|'eir' } */
  const setResolved = (bc, rec) => {
    const k = digits(bc); if (!k) return;
    st.resolved[k] = { ...rec, at: now() };
    delete st.pending[k];
    const keys = Object.keys(st.resolved);
    if (keys.length > MAX_RESOLVED) keys.sort((a, b) => (st.resolved[a].at || 0) - (st.resolved[b].at || 0)).slice(0, keys.length - MAX_RESOLVED).forEach((x) => { delete st.resolved[x]; });
    saveSoon();
  };
  const get = (bc) => st.resolved[digits(bc)] || null;
  const getPending = (bc) => st.pending[digits(bc)] || null;
  const addPending = (bc, tagId, cls, ch) => {
    const k = digits(bc); if (!k || st.resolved[k]) return;
    if (!st.pending[k]) st.pending[k] = { t: String(tagId || '').toUpperCase(), c: cls || '', ch, since: now() };
    saveSoon();
  };
  const dropOldPending = () => {
    const cut = now() - PENDING_DAYS * 864e5;
    Object.keys(st.pending).forEach((k) => { if ((st.pending[k].since || 0) < cut) delete st.pending[k]; });
    const keys = Object.keys(st.pending);
    if (keys.length > MAX_PENDING) keys.slice(0, keys.length - MAX_PENDING).forEach((k) => { delete st.pending[k]; });
    saveSoon();
  };
  const loadPrev = () => readGz(prevFile);
  const savePrev = (obj) => { try { writeGz(prevFile, obj); } catch { /* optional */ } };
  return {
    load, save, get, getPending, setResolved, addPending, dropOldPending, loadPrev, savePrev,
    meta: (patch) => { if (patch) { Object.assign(st, patch); saveSoon(); } return { lastRun: st.lastRun, lastRunDay: st.lastRunDay, lastStats: st.lastStats, resolved: Object.keys(st.resolved).length, pending: Object.keys(st.pending).length, snapAt: st.snapAt }; },
    pendingList: () => Object.entries(st.pending).map(([bc, p]) => ({ bc, ...p })),
    flush: () => { if (timer) { clearTimeout(timer); timer = null; } if (dirty) save(); }
  };
}

/** prev / cur: { [barcodeDigits]: 'TAGID|CLS|ch' } → jo prev me the aur cur me nahi (stock se nikle). */
export function diffLeft(prev, cur) {
  const left = [];
  if (!prev) return left;
  for (const k of Object.keys(prev)) {
    if (cur[k] !== undefined) continue;
    const [t, c, ch] = String(prev[k]).split('|');
    left.push({ bc: k, t, c, ch });
  }
  return left;
}

/** Ek dispatch-status row ko register ke data se bharo (sirf khaali fields). Returns true agar kuch bhara. */
export function applyResolved(row, rec) {
  if (!row || !rec) return false;
  row.tagId = row.tagId || rec.t || '';
  row.cls = row.cls || rec.c || '';
  row.vrn = row.vrn || rec.v || '';
  row.agent = row.agent || rec.a || '';
  row.agentId = row.agentId || rec.ai || '';
  row.tl = row.tl || rec.tl || '';
  row.date = row.date || rec.d || '';
  row.time = row.time || rec.tm || '';
  row.src = rec.s || '';
  row.note = rec.s === 'gv' ? 'GV Master · issued' : 'EIR · issued';
  return true;
}

/** Tag ID barcode ke saath seedhi ginti me badhta hai (har barcode par +32 = 0x20).
 *  Paas ke known (barcode, tagId) se kisi bhi barcode ka Tag ID nikalo. Pehle 9 digit (prefix + batch) same hone chahiye. */
export function deriveTagId(refBarcode, refTagId, barcode, maxGap = 6000) {
  const rb = digits(refBarcode), b = digits(barcode), tag = String(refTagId || '').trim().toUpperCase();
  if (rb.length < 12 || rb.length !== b.length || !/^[0-9A-F]{12,}$/.test(tag)) return '';
  if (rb.slice(0, -7) !== b.slice(0, -7)) return '';
  const gap = BigInt(b.slice(-7)) - BigInt(rb.slice(-7));
  const abs = gap < 0n ? -gap : gap;
  if (abs > BigInt(maxGap)) return '';
  const out = BigInt('0x' + tag) + gap * 32n;
  return out < 0n ? '' : out.toString(16).toUpperCase().padStart(tag.length, '0');
}
