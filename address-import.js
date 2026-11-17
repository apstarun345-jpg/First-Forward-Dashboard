/* Agents Address import — kisi bhi file (PDF / xlsx / csv / txt / paste) se Name · Mobile · Address · Pincode (+ID/TL/Channel) nikalta hai.
   Pure functions, no dependencies (Node zlib only) — server.js import karta hai, tests seedhe chalate hain. */
import zlib from 'node:zlib';

const digits = (v) => String(v == null ? '' : v).replace(/\D/g, '');

/* ───────────────────────── PDF text (positions ke saath, 2-column aware) ───────────────────────── */
function parseObjects(buf) {
  const s = buf.toString('latin1');
  const objs = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endobj', start);
    if (end < 0) break;
    const body = s.slice(start, end);
    const si = body.indexOf('stream');
    let dict = body, stream = null;
    if (si >= 0 && /^\s*<<[\s\S]*>>\s*stream/.test(body)) {
      dict = body.slice(0, si);
      let a = start + si + 6;
      if (s[a] === '\r') a++;
      if (s[a] === '\n') a++;
      const e = s.indexOf('endstream', a);
      stream = buf.subarray(a, e < 0 ? end : e);
    }
    objs.set(Number(m[1]), { dict, stream });
    re.lastIndex = end + 6;
  }
  return objs;
}
function inflate(o) {
  if (!o || !o.stream) return null;
  if (!/\/FlateDecode/.test(o.dict)) return o.stream;
  try { return zlib.inflateSync(o.stream); } catch { try { return zlib.inflateSync(o.stream, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); } catch { return null; } }
}
function expandObjStreams(objs) {
  for (const [, o] of [...objs]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict)) continue;
    const data = inflate(o);
    if (!data) continue;
    const n = Number((o.dict.match(/\/N\s+(\d+)/) || [])[1]), first = Number((o.dict.match(/\/First\s+(\d+)/) || [])[1]);
    const txt = data.toString('latin1');
    const head = txt.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const num = head[i * 2], off = head[i * 2 + 1];
      const next = i + 1 < n ? head[(i + 1) * 2 + 1] : txt.length - first;
      if (!Number.isFinite(num)) continue;
      if (!objs.has(num)) objs.set(num, { dict: txt.slice(first + off, first + next), stream: null });
    }
  }
}
const refOf = (txt) => { const m = String(txt || '').match(/(\d+)\s+\d+\s+R/); return m ? Number(m[1]) : 0; };
const refsOf = (txt) => [...String(txt || '').matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
function dictValue(dict, key) {   // /Key <ref | array | inline dict>
  const i = dict.indexOf(key);
  if (i < 0) return '';
  let j = i + key.length;
  while (/\s/.test(dict[j] || '')) j++;
  if (dict.startsWith('<<', j)) { let d = 0, k = j; for (; k < dict.length; k++) { if (dict.startsWith('<<', k)) { d++; k++; } else if (dict.startsWith('>>', k)) { d--; k++; if (!d) { k++; break; } } } return dict.slice(j, k); }
  if (dict[j] === '[') { const k = dict.indexOf(']', j); return dict.slice(j, k + 1); }
  const m = dict.slice(j).match(/^(\d+\s+\d+\s+R|[^\s/<>\[\]]+)/);
  return m ? m[0] : '';
}
function parseCMap(text) {
  const map = new Map();
  let two = false;
  const cs = text.match(/begincodespacerange\s*<([0-9A-Fa-f]+)>/);
  if (cs && cs[1].length >= 4) two = true;
  const u16 = (hex) => { let out = ''; for (let i = 0; i + 3 < hex.length + 1; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16)); return out; };
  for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const m of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map.set(parseInt(m[1], 16), u16(m[2]));
  for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g)) {
      const a = parseInt(m[1], 16), b = parseInt(m[2], 16);
      if (m[3] !== undefined) { const base = parseInt(m[3], 16), len = m[3].length; for (let c = a; c <= b && c - a < 65536; c++) map.set(c, u16((base + c - a).toString(16).padStart(len, '0'))); }
      else if (m[4] !== undefined) { const arr = [...m[4].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => x[1]); for (let c = a; c <= b && c - a < arr.length; c++) map.set(c, u16(arr[c - a])); }
    }
  }
  return { map, two };
}
function decodeLiteral(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch !== '\\') { out.push(str.charCodeAt(i) & 255); continue; }
    const n = str[++i];
    if (n === 'n') out.push(10); else if (n === 'r') out.push(13); else if (n === 't') out.push(9); else if (n === 'b') out.push(8); else if (n === 'f') out.push(12);
    else if (/[0-7]/.test(n)) { let o = n; while (o.length < 3 && /[0-7]/.test(str[i + 1] || '')) o += str[++i]; out.push(parseInt(o, 8) & 255); }
    else if (n === '\r' || n === '\n') { if (n === '\r' && str[i + 1] === '\n') i++; }
    else out.push(n.charCodeAt(0) & 255);
  }
  return out;
}
/** Content stream tokenizer → [{op, args}] (sirf text ke kaam ke operators). */
function* contentOps(s) {
  const args = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c <= ' ') { i++; continue; }
    if (c === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
    if (c === '(') {
      let d = 1, j = i + 1;
      while (j < n && d) { if (s[j] === '\\') j++; else if (s[j] === '(') d++; else if (s[j] === ')') d--; j++; }
      args.push({ t: 's', v: decodeLiteral(s.slice(i + 1, j - 1)) }); i = j; continue;
    }
    if (c === '<' && s[i + 1] === '<') { let d = 1, j = i + 2; while (j < n && d) { if (s.startsWith('<<', j)) { d++; j += 2; } else if (s.startsWith('>>', j)) { d--; j += 2; } else j++; } args.length = 0; i = j; continue; }
    if (c === '<') { const j = s.indexOf('>', i); const hex = s.slice(i + 1, j).replace(/\s+/g, ''); const bytes = []; for (let k = 0; k < hex.length; k += 2) bytes.push(parseInt(hex.slice(k, k + 2).padEnd(2, '0'), 16)); args.push({ t: 's', v: bytes }); i = j + 1; continue; }
    if (c === '[') { const arr = []; i++; const sub = []; // inline array
      while (i < n && s[i] !== ']') {
        const d = s[i];
        if (d <= ' ') { i++; continue; }
        if (d === '(') { let dd = 1, j = i + 1; while (j < n && dd) { if (s[j] === '\\') j++; else if (s[j] === '(') dd++; else if (s[j] === ')') dd--; j++; } arr.push({ t: 's', v: decodeLiteral(s.slice(i + 1, j - 1)) }); i = j; }
        else if (d === '<') { const j = s.indexOf('>', i); const hex = s.slice(i + 1, j).replace(/\s+/g, ''); const bytes = []; for (let k = 0; k < hex.length; k += 2) bytes.push(parseInt(hex.slice(k, k + 2).padEnd(2, '0'), 16)); arr.push({ t: 's', v: bytes }); i = j + 1; }
        else { let j = i; while (j < n && s[j] > ' ' && !'()<>[]'.includes(s[j])) j++; const num = Number(s.slice(i, j)); if (Number.isFinite(num)) arr.push({ t: 'n', v: num }); i = Math.max(j, i + 1); }
      }
      i++; args.push({ t: 'a', v: arr }); void sub; continue;
    }
    if (c === ']' || c === '>' || c === ')') { i++; continue; }
    let j = i;
    while (j < n && s[j] > ' ' && !'()<>[]/%'.includes(s[j])) j++;
    if (c === '/') { j = i + 1; while (j < n && s[j] > ' ' && !'()<>[]/%'.includes(s[j])) j++; args.push({ t: 'name', v: s.slice(i + 1, j) }); i = j; continue; }
    const tok = s.slice(i, j); i = Math.max(j, i + 1);
    const num = Number(tok);
    if (tok !== '' && Number.isFinite(num) && /^[-+.\d]/.test(tok)) args.push({ t: 'n', v: num });
    else { yield { op: tok, args: args.splice(0) }; }
  }
}
function pageList(objs) {
  const cat = [...objs.values()].find((o) => /\/Type\s*\/Catalog/.test(o.dict));
  const pages = [];
  const walk = (num, depth) => {
    const o = objs.get(num);
    if (!o || depth > 12) return;
    if (/\/Type\s*\/Pages/.test(o.dict) || (/\/Kids/.test(o.dict) && !/\/Type\s*\/Page\b/.test(o.dict))) { refsOf(dictValue(o.dict, '/Kids')).forEach((k) => walk(k, depth + 1)); return; }
    pages.push(num);
  };
  if (cat) walk(refOf(dictValue(cat.dict, '/Pages')), 0);
  if (!pages.length) for (const [num, o] of objs) if (/\/Type\s*\/Page\b/.test(o.dict) && !/\/Type\s*\/Pages/.test(o.dict)) pages.push(num);
  return pages;
}
function inheritedResources(objs, pageNum) {
  let o = objs.get(pageNum), guard = 0;
  while (o && guard++ < 8) {
    const r = dictValue(o.dict, '/Resources');
    if (r) return r;
    const parent = refOf(dictValue(o.dict, '/Parent'));
    o = parent ? objs.get(parent) : null;
  }
  return '';
}
/** PDF buffer → [{page, lines:[{x,y,text}]}]  (runs: har Tj/TJ ek run, x,y = text position) */
export function pdfRuns(buf) {
  const objs = parseObjects(buf);
  if (!objs.size) throw new Error('PDF samajh nahi aayi (corrupt?)');
  if ([...objs.values()].some((o) => /\/Type\s*\/Encrypt/.test(o.dict)) || /\/Encrypt\s/.test(buf.subarray(Math.max(0, buf.length - 2000)).toString('latin1'))) throw new Error('PDF password-protected hai — pehle unlock karke upload karo.');
  expandObjStreams(objs);
  const fontCache = new Map();
  const fontInfo = (num) => {
    if (fontCache.has(num)) return fontCache.get(num);
    const o = objs.get(num);
    let info = { map: null, two: false };
    if (o) {
      const tu = refOf(dictValue(o.dict, '/ToUnicode'));
      const sub = /\/Subtype\s*\/Type0/.test(o.dict);
      if (tu && objs.get(tu)) { const data = inflate(objs.get(tu)); if (data) { const cm = parseCMap(data.toString('latin1')); info = { map: cm.map, two: cm.two || sub }; } }
      else info.two = sub;
    }
    fontCache.set(num, info);
    return info;
  };
  const out = [];
  pageList(objs).forEach((pnum, pi) => {
    const po = objs.get(pnum);
    const res = inheritedResources(objs, pnum);
    let fdict = dictValue(res, '/Font');
    if (fdict && !fdict.startsWith('<<')) { const fo = objs.get(refOf(fdict)); fdict = fo ? fo.dict : ''; }
    const fonts = {};
    for (const m of String(fdict).matchAll(/\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g)) fonts[m[1]] = Number(m[2]);
    const cval = dictValue(po.dict, '/Contents');
    const parts = (cval.startsWith('[') ? refsOf(cval) : [refOf(cval)]).map((r) => inflate(objs.get(r))).filter(Boolean);
    const content = Buffer.concat(parts.flatMap((b) => [b, Buffer.from('\n')])).toString('latin1');
    const runs = [];
    let font = { map: null, two: false };
    let tmx = 0, tmy = 0, lmx = 0, lmy = 0, lead = 0, fsize = 10;
    const stack = [];
    const showStr = (bytes) => {
      if (font.map || font.two) {
        let t = '';
        if (font.two) for (let k = 0; k + 1 < bytes.length; k += 2) { const code = (bytes[k] << 8) | bytes[k + 1]; t += font.map ? (font.map.get(code) || '') : String.fromCharCode(code); }
        else for (const b of bytes) t += font.map.has(b) ? font.map.get(b) : String.fromCharCode(b);
        return t;
      }
      return String.fromCharCode(...bytes);
    };
    const push = (text) => { if (text) runs.push({ x: tmx, y: tmy, text, size: fsize }); };
    for (const { op, args } of contentOps(content)) {
      switch (op) {
        case 'q': stack.push([tmx, tmy]); break;
        case 'Q': stack.pop(); break;
        case 'BT': tmx = tmy = lmx = lmy = 0; break;
        case 'Tf': { const nm = args.find((a) => a.t === 'name'); const sz = args.find((a) => a.t === 'n'); if (nm) font = fontInfo(fonts[nm.v]) || { map: null, two: false }; if (sz) fsize = Math.abs(sz.v) || fsize; break; }
        case 'Tm': { const nums = args.filter((a) => a.t === 'n').map((a) => a.v); if (nums.length >= 6) { tmx = lmx = nums[4]; tmy = lmy = nums[5]; } break; }
        case 'Td': case 'TD': { const nums = args.filter((a) => a.t === 'n').map((a) => a.v); if (nums.length >= 2) { lmx += nums[0]; lmy += nums[1]; tmx = lmx; tmy = lmy; if (op === 'TD') lead = -nums[1]; } break; }
        case 'TL': { const a = args.find((x) => x.t === 'n'); if (a) lead = a.v; break; }
        case 'T*': lmy -= lead; tmx = lmx; tmy = lmy; break;
        case 'Tj': { const a = args.find((x) => x.t === 's'); if (a) push(showStr(a.v)); break; }
        case "'": case '"': { lmy -= lead; tmx = lmx; tmy = lmy; const a = [...args].reverse().find((x) => x.t === 's'); if (a) push(showStr(a.v)); break; }
        case 'TJ': { const arr = (args.find((x) => x.t === 'a') || { v: [] }).v; let t = ''; for (const e of arr) { if (e.t === 's') t += showStr(e.v); else if (e.t === 'n' && e.v < -250) t += ' '; } push(t); break; }
        default: break;
      }
    }
    out.push({ page: pi + 1, runs });
  });
  return out;
}
/** Runs → lines. Page ko 2 columns me baanta hai (agar x-positions do alag group me hon), phir upar se neeche padhta hai. */
export function pdfText(buf) {
  const pages = pdfRuns(buf);
  const text = [];
  for (const { runs } of pages) {
    if (!runs.length) continue;
    // 1) line = same y (±2.5pt) ; line ke andar x sorted
    const toLines = (list) => {
      const rows = [];
      [...list].sort((a, b) => b.y - a.y || a.x - b.x).forEach((r) => {
        const row = rows.find((q) => Math.abs(q.y - r.y) <= 2.5);
        if (row) row.items.push(r); else rows.push({ y: r.y, items: [r] });
      });
      return rows.sort((a, b) => b.y - a.y).map((row) => row.items.sort((a, b) => a.x - b.x).map((i) => i.text).join(' ').replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
    };
    // 2) column detection — runs ke start-x ka histogram: do bhaari cluster aur beech me bada gap
    const xs = runs.map((r) => r.x).sort((a, b) => a - b);
    let split = null;
    const lo = xs[0], hi = xs[xs.length - 1];
    if (hi - lo > 150) {
      let best = 0, at = 0;
      for (let i = 1; i < xs.length; i++) { const g = xs[i] - xs[i - 1]; if (g > best) { best = g; at = (xs[i] + xs[i - 1]) / 2; } }
      const left = xs.filter((x) => x < at).length, right = xs.length - left;
      if (best > 40 && left >= 4 && right >= 4) split = at;
    }
    if (split === null) text.push(...toLines(runs));
    else { text.push(...toLines(runs.filter((r) => r.x < split))); text.push(...toLines(runs.filter((r) => r.x >= split))); }
    text.push('');
  }
  return text.join('\n');
}

/* ───────────────────────── XLSX → matrix (sab sheets) ───────────────────────── */
function zipEntries(buf) {
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('xlsx/zip samajh nahi aaya');
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lh = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    files.set(name, () => { const raw = buf.subarray(lh, lh + csize); return method === 0 ? raw : zlib.inflateRawSync(raw); });
    p += 46 + nlen + xlen + clen;
  }
  return files;
}
const xmlText = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const colIndex = (ref) => { let n = 0; for (const ch of String(ref).replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
export function xlsxMatrices(buf) {
  const files = zipEntries(buf);
  const get = (n) => (files.has(n) ? files.get(n)().toString('utf8') : '');
  const shared = [...get('xl/sharedStrings.xml').matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map((m) => xmlText([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')));
  const sheets = [...files.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  return sheets.map((name) => {
    const rows = [];
    for (const rm of get(name).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1], inner = cm[2] || '';
        const ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1];
        const t = (attrs.match(/\bt="(\w+)"/) || [])[1];
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let val = '';
        if (t === 's') val = shared[Number(v)] || '';
        else if (t === 'inlineStr') val = xmlText((inner.match(/<is>([\s\S]*?)<\/is>/) || [])[1]);
        else val = xmlText(v);
        const ci = ref ? colIndex(ref) : row.length;
        while (row.length < ci) row.push('');
        row[ci] = String(val).trim();
      }
      rows.push(row);
    }
    return rows;
  });
}

/* ───────────────────────── CSV ───────────────────────── */
export function csvMatrix(text) {
  const first = String(text).split(/\r?\n/, 1)[0] || '';
  const delim = [',', '\t', ';', '|'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0];
  const d = delim && delim[1] > 1 ? delim[0] : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  const s = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === d) { row.push(cell.trim()); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell.trim()); cell = ''; rows.push(row); row = []; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}

/* ───────────────────────── Text → entries ───────────────────────── */
const NAME_RX = /^\s*(?:n\s*a\s*m\s*e|nmae|naam|nane|nmme)(?:\s*[:\-–—.=]+\s*|\s+|(?=[A-Za-z]))(.*)$/i;
const MOB_LABEL = /(?:m[o0]b(?:ile)?(?:\s*(?:no|number|num)\b)?|ph(?:one)?(?:\s*(?:no|number)\b)?|contact(?:\s*(?:no|number)\b)?|cell|whats\s*app|mo)\s*\.?\s*(?:no\.?|number)?\s*[:\-–—=.]*/i;
const MOBILE_RX = /(?<!\d)(?:\+?91[\s-]?)?0?([6-9](?:[\s-]?\d){9})(?!\d)/;
const PIN_LABEL_RX = /\b(?:pin\s*code|pincode|pin\s*no\.?|pin|zip(?:\s*code)?|postal\s*code)\s*[:\-–—=.]*\s*(\d{3}\s?\d{3})\b/i;
const ADDR_LABEL_RX = /^\s*(?:full\s*)?(?:add(?:ress)?|addr|pata|पता)\s*[:\-–—=.]*\s*/i;
const ID_LABEL_RX = /^\s*(?:agent\s*)?(?:id|code)\s*[:\-–—=]+\s*(\S+)\s*$/i;
const TL_LABEL_RX = /^\s*(?:tl|team\s*leader|supervisor)(?:\s*name)?\s*[:\-–—=]+\s*(.+)$/i;
const CH_LABEL_RX = /^\s*(?:channel|partner)\s*[:\-–—=]+\s*(.+)$/i;

const cleanName = (n) => String(n || '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').replace(/^[\s:\-–—.]+|[\s:\-–—.,]+$/g, '').trim();
const cleanAddr = (a) => String(a || '').replace(/\s+/g, ' ').replace(/\s+([,.;])/g, '$1').replace(/^[\s:\-–—.,]+|[\s,;:\-–—]+$/g, '').trim();
export const normMobile = (v) => { const m = String(v || '').match(MOBILE_RX); return m ? digits(m[1]) : ''; };
const normChannel = (v) => { const t = String(v || '').toLowerCase(); if (/\bgv\b|gv\s*partner|gvpartner/.test(t)) return 'gv'; if (/\bff\b|first\s*forward|idfc/.test(t)) return 'ff'; return ''; };

/** Address saaf: doosre agent ka hissa (2nd pincode ke baad / "Name -" / mobile) hatao, pincode nikalo. */
export function cleanAddressText(addr, pin) {
  let a = String(addr || '').replace(/\s+/g, ' ').trim();
  let cut = false;
  a = a.replace(/\s*\b(?:name|nmae|naam)\s*[-–—:]\s*\S[\s\S]*$/i, () => { cut = true; return ''; });
  a = a.replace(/(?<!\d)(?:\+?91[\s-]?)?0?[6-9](?:[\s-]?\d){9}(?!\d)/g, ' ');
  a = a.replace(/\b(?:mob(?:ile)?|mo|phone|contact|cell)\s*(?:no\.?|number)?\s*[:\-–—.]*\s*(?=$|,)/gi, ' ').replace(/\s+/g, ' ').trim();
  const pins = [...a.matchAll(/(?<!\d)([1-9]\d{2}\s?\d{3})(?!\d)/g)];
  const distinct = [...new Set(pins.map((m) => m[1].replace(/\s/g, '')))];
  if (distinct.length >= 2) { const first = pins[0]; a = a.slice(0, first.index + first[0].length); cut = true; }
  const have = pins.length ? pins[0][1].replace(/\s/g, '') : '';
  let pincode = distinct.length >= 2 || !digits(pin).slice(0, 6) ? have : digits(pin).slice(0, 6);
  if (!/^[1-9]\d{5}$/.test(pincode)) pincode = have || '';
  a = a.replace(/^[\s:\-–—.,]+|[\s,;:\-–—]+$/g, '').replace(/\s+([,.;])/g, '$1').trim();
  return { address: a, pincode, cut };
}
function entryFromLines(name, lines) {
  const e = { name: cleanName(name), mobile: '', address: '', pincode: '', id: '', tl: '', channel: '' };
  const rest = [];
  for (let raw of lines) {
    let line = String(raw).replace(/\u00a0/g, ' ').trim();
    if (!line) continue;
    let m;
    if ((m = line.match(TL_LABEL_RX))) { e.tl = cleanName(m[1]); continue; }
    if ((m = line.match(CH_LABEL_RX))) { e.channel = normChannel(m[1]); continue; }
    if ((m = line.match(ID_LABEL_RX))) { e.id = m[1]; continue; }
    // mobile: label ke saath ya line me akeli
    if (!e.mobile) {
      const lm = line.match(new RegExp('(?:^|\\s)' + MOB_LABEL.source + '\\s*(?:[:\\-–—=.]*)\\s*(.+)$', 'i'));
      const cand = lm ? normMobile(lm[1]) : '';
      if (cand && /^\s*(?:m[o0]|ph|contact|cell|whats)/i.test(line)) { e.mobile = cand; const before = line.slice(0, line.search(MOB_LABEL)).trim(); const tail = line.replace(new RegExp(MOB_LABEL.source + '[\\s\\S]*$', 'i'), '').trim(); if (before || tail) rest.push(tail || before); continue; }
    }
    rest.push(line);
  }
  // address = bachi hui lines ; mobile (agar label nahi mila) address text se nikalo
  let text = rest.join('\n');
  if (!e.mobile) { const m = text.match(MOBILE_RX); if (m) { e.mobile = digits(m[1]); text = text.replace(m[0], ' '); } }
  // pincode: label wala pehle, warna last 6-digit
  const pl = text.match(PIN_LABEL_RX);
  if (pl) { e.pincode = digits(pl[1]); text = text.replace(PIN_LABEL_RX, ' ').replace(/\bpin\s*(?:code)?\s*[:\-–—]*\s*$/i, ' '); }
  text = text.split('\n').map((l) => l.replace(ADDR_LABEL_RX, '')).join(' ');
  if (!e.pincode) { const all = [...text.matchAll(/(?<!\d)([1-9]\d{2}\s?\d{3})(?!\d)/g)]; if (all.length) e.pincode = digits(all[all.length - 1][1]); }
  e.address = cleanAddr(text);
  const cl = cleanAddressText(e.address, e.pincode);
  e.address = cl.address; e.pincode = cl.pincode || e.pincode;
  if (e.pincode && !e.address.replace(/\s/g, '').includes(e.pincode)) e.address = cleanAddr(`${e.address} ${e.pincode}`);
  return e;
}

/** Plain text (PDF/txt/paste) → entries. "Name" line se naya record; agar kahin "Name" label nahi to blank-line blocks. */
export function parseAddressText(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').flatMap((l) => l.split(/\s+(?=(?:Name|nmae|naam)\s*[-–—:]\s*\S)/i));   // line me chipka doosra "Name - ..." alag record
  const starts = [];
  lines.forEach((l, i) => { if (NAME_RX.test(l)) starts.push(i); });
  const out = [];
  if (starts.length) {
    starts.forEach((si, k) => {
      const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
      const m = lines[si].match(NAME_RX);
      let nm = m[1], body = lines.slice(si + 1, end);
      // naam wali line me hi mobile/address ho (e.g. "Name - X Mo. 98..." )
      const inl = nm.match(new RegExp('\\s' + MOB_LABEL.source + '\\s*[\\d+].*$', 'i'));
      if (inl) { body = [nm.slice(inl.index).trim(), ...body]; nm = nm.slice(0, inl.index); }
      out.push(entryFromLines(nm, body));
    });
  } else {
    let cur = [];
    const flush = () => { if (cur.length) { const first = cur.find((l) => /[A-Za-z]{3}/.test(l) && !MOBILE_RX.test(l)) || ''; const body = cur.filter((l) => l !== first); out.push({ ...entryFromLines(first, body), flags: ['noNameLabel'] }); cur = []; } };
    lines.forEach((l) => { if (!l.trim()) flush(); else cur.push(l); });
    flush();
  }
  return finish(out);
}
/** Same mobile (ya bina mobile ke same naam) ek hi agent — baad wali entry jeete, par khaali field purani se bharti hai. */
export function dedupeEntries(list) {
  const map = new Map();
  for (const e of list) {
    const key = e.mobile ? `m:${e.mobile}` : `n:${String(e.name).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const old = map.get(key);
    if (!old) { map.set(key, { ...e, seen: 1 }); continue; }
    const m = { ...old, seen: old.seen + 1 };
    ['name', 'address', 'pincode', 'id', 'tl', 'channel', 'mobile'].forEach((f) => { if (e[f]) m[f] = e[f]; });
    map.set(key, m);
  }
  return [...map.values()].map((e) => { const f = []; if ((e.address || '').length > 220 || (e.address || '').match(/(?<!\d)[6-9]\d{9}(?!\d)/)) f.push('check'); if (!e.mobile) f.push('noMobile'); if (!e.address) f.push('noAddress'); if (!e.pincode) f.push('noPincode'); return { ...e, flags: [...(e.flags || []).filter((x) => x === 'noNameLabel'), ...f] }; });
}
function finish(list) {
  const out = [];
  list.forEach((e) => {
    if (!e.name && !e.mobile && !e.address) return;
    if (!e.mobile && !e.address && !e.pincode) return;   // sirf naam — kaam ka data nahi
    e.flags = [...(e.flags || [])];
    if (!e.mobile) e.flags.push('noMobile');
    if (!e.address) e.flags.push('noAddress');
    if (!e.pincode) e.flags.push('noPincode');
    out.push(e);
  });
  return out;
}

/** Header-wale table (xlsx/csv) → entries. Header na mile to None (caller text parser chalaye). */
export function parseTable(matrix) {
  const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const kinds = {
    name: /^(agent |full |retailer |shop |dispatch )?name$|^agent$/, mobile: /(mobile|mob|phone|contact|whatsapp|cell)( no| number)?$/, address: /^(full |dispatch |delivery |shipping )?address( \d)?$|^addr$|^pata$/, pincode: /^(pin ?code|pin|zip|postal code)$/, id: /^(agent |new agent |user |aps )?(id|code)$|^agent id$/, tl: /^(tl|tl name|team leader|supervisor)$/, channel: /^(channel|partner|type)$/, city: /^(city|district|state)$/
  };
  for (let r = 0; r < Math.min(matrix.length, 12); r++) {
    const row = (matrix[r] || []).map(norm);
    const col = {};
    row.forEach((h, i) => { for (const [k, rx] of Object.entries(kinds)) if (col[k] === undefined && rx.test(h)) col[k] = i; });
    const hits = ['name', 'mobile', 'address'].filter((k) => col[k] !== undefined).length;
    if (hits >= 2 || (hits >= 1 && col.pincode !== undefined)) {
      const out = [];
      for (const cells of matrix.slice(r + 1)) {
        const g = (k) => (col[k] === undefined ? '' : String(cells[col[k]] == null ? '' : cells[col[k]]).trim());
        const addrRaw = g('address');
        const pinCell = digits(g('pincode')).slice(0, 6);
        const e = entryFromLines(g('name'), [addrRaw]);
        e.name = cleanName(g('name'));
        const mob = normMobile(g('mobile')) || e.mobile;
        e.mobile = mob;
        if (pinCell.length === 6) { e.pincode = pinCell; if (!e.address.replace(/\s/g, '').includes(pinCell)) e.address = cleanAddr(`${e.address} ${pinCell}`); }
        e.id = g('id'); e.tl = cleanName(g('tl')); e.channel = normChannel(g('channel'));
        if (!e.address) e.address = cleanAddr(addrRaw);
        out.push(e);
      }
      return finish(out);
    }
  }
  return null;
}

/** Koi bhi file → { entries, kind, note }.  name = file name (extension se type), buf = Buffer. */
export function parseAnyFile(name, buf) {
  const ext = String(name || '').toLowerCase().replace(/^.*\./, '');
  const head = buf.subarray(0, 5).toString('latin1');
  let kind = 'text', entries = [];
  if (head.startsWith('%PDF') || ext === 'pdf') {
    kind = 'pdf';
    entries = parseAddressText(pdfText(buf));
  } else if (head.startsWith('PK') || ext === 'xlsx' || ext === 'xlsm') {
    kind = 'xlsx';
    for (const mat of xlsxMatrices(buf)) { const t = parseTable(mat); entries.push(...(t || parseAddressText(mat.map((r) => r.filter(Boolean).join('\n')).join('\n\n')))); }
  } else if (ext === 'csv' || ext === 'tsv') {
    kind = 'csv';
    const mat = csvMatrix(buf.toString('utf8'));
    entries = parseTable(mat) || parseAddressText(mat.map((r) => r.filter(Boolean).join('\n')).join('\n\n'));
  } else {
    const txt = buf.toString('utf8');
    const mat = /[,\t;|]/.test(txt.split('\n', 1)[0]) ? csvMatrix(txt) : null;
    entries = (mat && parseTable(mat)) || parseAddressText(txt);
  }
  return { kind, entries: dedupeEntries(entries) };
}
