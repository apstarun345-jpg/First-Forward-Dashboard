/* 📷 v3.125.533 — scanVision: photo / screenshot / camera-frame se FASTag barcode nikalo (ek photo me kai tag bhi).
 *
 * Seedhe barcode decoder halke, tedhe, dhundhle (WhatsApp photo, screen par photo) barcode par fail hota tha. Ab 4 tareeke, tez se dheere:
 *   1. Browser ka native BarcodeDetector (saare barcode ek saath)          2. zbar-wasm poori photo par
 *   3. Barcode ki JAGAH dhoondh kar (gradient coherence) seedha ghuma ke crop → zbar            4. Barcode ke NEECHE likha number (OCR, Tesseract) —
 *      jab patti dhundhli ho par number saaf dikhta ho (608116-035-0611445). Sab libraries sirf zarurat par load hoti hain (libs/).
 * Kisi bhi tareeke se mila number server se check hoga + user confirm karega, isliye galat OCR chupchap add nahi hota.
 */
(function (root) {
  'use strict';
  const FF = (root.FF = root.FF || {});
  const env = { mk: null, zbar: null, ocr: null, native: undefined, base: '' };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function mk(w, h) {
    if (env.mk) return env.mk(w, h);
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c;
  }
  const ctx2 = (c) => c.getContext('2d', { willReadFrequently: true });
  const fmt16 = (d) => `${d.slice(0, 6)}-${d.slice(6, 9)}-${d.slice(9)}`;
  /** raw text → '608116-035-0611445' ya '' (sirf poora 16 digit; 17-20 digit me '6' se shuru 16 ka tukda) */
  function parse16(raw) {
    const s = String(raw || ''); const d = s.replace(/\D/g, '');
    if (/^[\d-]+$/.test(s.trim()) && d.length === 16) return fmt16(d);
    if (d.length > 16 && d.length <= 20 && /^[\d-\s]+$/.test(s)) for (let i = 0; i + 16 <= d.length; i++) if (d[i] === '6') return fmt16(d.slice(i, i + 16));
    return '';
  }
  /** OCR text me se 6-3-7 wala number (aage peeche kachra ho to bhi) */
  function textCodes(text) {
    const out = []; const t = String(text || '').split(/\n/).map((l) => l.replace(/(\d)[ \t]+(?=\d)/g, '$1')).join('\n');
    const re = /(?<!\d)(\d{6})\s?[-–—_.]?\s?(\d{3})\s?[-–—_.]?\s?(\d{7})(?!\d)/g; let m;
    while ((m = re.exec(t))) out.push(`${m[1]}-${m[2]}-${m[3]}`);
    return out;
  }

  const ham = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
  /** OCR text (kachra / spaces / aadhe digit) se lenient (g1-g2-g3) — g3 pehle 7 digit, g1 aakhri 6 */
  function lenientCodes(text) {
    const out = [];
    String(text || '').split(/\n/).forEach((line) => {
      const l = line.replace(/\s+/g, '').replace(/[–—_.]/g, '-'); const re = /(\d{2,9})-(\d{3})-(\d{6,9})/g; let m;
      while ((m = re.exec(l))) { const g3 = m[3].slice(0, 7); if (g3.length < 7) continue; out.push({ g1: m[1], g2: m[2], g3 }); re.lastIndex = m.index + 1; }
    });
    return out;
  }
  function fixPrefix(d, known) {
    if (d.length === 6 && known.includes(d)) return d;
    let best = '', bh = 9;
    for (const p of known) for (let i = 0; i + 6 <= d.length; i++) { const h = ham(d.slice(i, i + 6), p); if (h < bh) { bh = h; best = p; } }
    if (bh <= 2) return best;
    if (d.length >= 3 && d.length < 6) for (const p of known) if (p.endsWith(d)) return p;
    return d.length >= 6 ? d.slice(-6) : '';
  }

  // ---------- libraries (lazy) ----------
  const loadScript = (src) => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('lib ' + src)); document.head.appendChild(s); });
  const baseUrl = () => env.base || new URL('libs/', document.baseURI).href;
  let zP = null, oP = null, ocrWorker = null;
  async function zbarLib() {
    if (env.zbar) return env.zbar;
    if (!zP) zP = (async () => { if (!root.zbarWasm) await loadScript(baseUrl() + 'zbar-wasm.js?v=1'); env.zbar = root.zbarWasm; return env.zbar; })().catch((e) => { zP = null; throw e; });
    return zP;
  }
  async function ocrLib() {
    if (env.ocr) return env.ocr;
    if (!oP) oP = (async () => {
      if (!root.Tesseract) await loadScript(baseUrl() + 'tesseract.min.js?v=1');
      const b = baseUrl();
      const w = await root.Tesseract.createWorker('eng', 1, { workerPath: b + 'ocr-worker.min.js?v=1', corePath: b + 'tesseract-core-simd-lstm.wasm.js', langPath: b, gzip: true, workerBlobURL: false, cacheMethod: 'none' });
      await w.setParameters({ tessedit_char_whitelist: '0123456789-', tessedit_pageseg_mode: '6', user_defined_dpi: '200' });
      ocrWorker = w; env.ocr = { recognize: async (c, psm) => { if (psm) await w.setParameters({ tessedit_pageseg_mode: String(psm) }); return (await w.recognize(c)).data.text; } };
      return env.ocr;
    })().catch((e) => { oP = null; throw e; });
    return oP;
  }
  async function nativeDet() {
    if (env.native !== undefined) return env.native;
    env.native = null;
    try { if (root.BarcodeDetector) { const sup = await root.BarcodeDetector.getSupportedFormats(); const fm = ['code_128', 'code_39', 'code_93', 'itf', 'codabar'].filter((f) => sup.includes(f)); if (fm.length) env.native = new root.BarcodeDetector({ formats: fm }); } } catch { env.native = null; }
    return env.native;
  }

  // ---------- image helpers ----------
  /** source → working canvas (max 2600 px lambi side) */
  function toWork(src, sw, sh) {
    const S = Math.min(1, 2600 / Math.max(sw, sh)), c = mk(sw * S, sh * S), x = ctx2(c);
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(src, 0, 0, c.width, c.height); return c;
  }
  function enhance(c, mode) {
    const x = ctx2(c), im = x.getImageData(0, 0, c.width, c.height), d = im.data, n = c.width * c.height;
    const g = new Uint8Array(n), hist = new Uint32Array(256);
    for (let i = 0, j = 0; i < n; i++, j += 4) { const v = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8; g[i] = v; hist[v]++; }
    let lo = 0, hi = 255, acc = 0; const cut = n * 0.01;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= cut) { lo = v; break; } }
    acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= cut) { hi = v; break; } }
    const span = Math.max(20, hi - lo);
    for (let i = 0, j = 0; i < n; i++, j += 4) { const v = Math.max(0, Math.min(255, ((g[i] - lo) * 255) / span)); d[j] = d[j + 1] = d[j + 2] = v; d[j + 3] = 255; }
    x.putImageData(im, 0, 0); return c;
  }

  /** Barcode jaisi (seedhi, ek hi disha ki) lakeeron wali jagah — gradient coherence se. Return: [{n, ang, cx, cy, pts, w, h}] (work-canvas px) */
  function locate(work, opt) {
    opt = opt || {};
    // bada photo / collage: 1000px ke overlapping tukdon me (barcode ki lakeeren chhoti na hon), phir milte-julte regions ek
    const T = 1000, STEP = 750, W0 = work.width, H0 = work.height;
    if (Math.max(W0, H0) <= 1300) return locateTile(work, 0, 0, opt);
    const all = [];
    for (let y = 0; y < H0; y += STEP) for (let x = 0; x < W0; x += STEP) {
      const tw = Math.min(T, W0 - x), th = Math.min(T, H0 - y); if (tw < 200 || th < 200) continue;
      const c = mk(tw, th), cx = ctx2(c); cx.drawImage(work, x, y, tw, th, 0, 0, tw, th);
      all.push(...locateTile(c, x, y, opt));
      if (x + T >= W0) break;
    }
    const out = []; all.sort((a, b) => b.n - a.n);
    for (const r of all) if (!out.some((o) => Math.hypot(o.cx - r.cx, o.cy - r.cy) < Math.max(70, 0.35 * Math.max(o.w, r.w)))) out.push(r);
    return out;
  }
  function locateTile(work, ox, oy, opt) {
    opt = opt || {}; const ALT = opt.alt != null ? opt.alt : 2.5, COH = opt.coh != null ? opt.coh : 0.78, MINB = opt.minBlocks != null ? opt.minBlocks : 8;
    const S = Math.min(1, 1000 / Math.max(work.width, work.height)), w = Math.round(work.width * S), h = Math.round(work.height * S);
    const c = mk(w, h), x = ctx2(c); x.drawImage(work, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data;
    const g = new Float32Array(w * h); for (let i = 0; i < w * h; i++) g[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) / 256;
    const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let xx = 1; xx < w - 1; xx++) { const i = y * w + xx; gx[i] = g[i + 1] - g[i - 1]; gy[i] = g[i + w] - g[i - w]; }
    const B = 14, bw = Math.floor(w / B), bh = Math.floor(h / B), blk = [];
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      let jxx = 0, jyy = 0, jxy = 0;
      for (let y = by * B; y < by * B + B; y++) for (let xx = bx * B; xx < bx * B + B; xx++) { const i = y * w + xx; jxx += gx[i] * gx[i]; jyy += gy[i] * gy[i]; jxy += gx[i] * gy[i]; }
      const e = jxx + jyy; const bang = 0.5 * Math.atan2(2 * jxy, jxx - jyy);
      // v3.125.560 — "lakeeron ki ginti": barcode me ek block (14 px) me kai ulte-seedhe kinare aate hain; card ka kinara / haath me 1-2 hi.
      // Gradient ke dishaa (bang) me projection ka sign-change count — bars = zyada, kinara = kam.
      const cA = Math.cos(bang), sA = Math.sin(bang); let alt = 0, rows = 0;
      const dirsX = Math.abs(cA) >= Math.abs(sA);
      for (let q = 0; q < B; q += 2) {
        let last = 0, ch = 0, mx = 0;
        for (let t = 0; t < B; t++) { const xx2 = dirsX ? bx * B + t : bx * B + q, yy2 = dirsX ? by * B + q : by * B + t, i2 = yy2 * w + xx2; const v = gx[i2] * cA + gy[i2] * sA; if (Math.abs(v) > mx) mx = Math.abs(v); }
        const th2 = Math.max(10, mx * 0.3);
        for (let t = 0; t < B; t++) { const xx2 = dirsX ? bx * B + t : bx * B + q, yy2 = dirsX ? by * B + q : by * B + t, i2 = yy2 * w + xx2; const v = gx[i2] * cA + gy[i2] * sA; const sg = v > th2 ? 1 : v < -th2 ? -1 : 0; if (sg && last && sg !== last) ch++; if (sg) last = sg; }
        alt += ch; rows++;
      }
      blk.push({ e: e / (B * B), coh: e > 0 ? Math.sqrt((jxx - jyy) ** 2 + 4 * jxy * jxy) / e : 0, ang: bang, alt: rows ? alt / rows : 0 });
    }
    const en = blk.map((b) => b.e).sort((a, b) => a - b), thr = Math.max(300, en[Math.floor(en.length * 0.6)] || 0);
    blk.forEach((b) => { b.ok = b.coh > COH && b.e > thr && b.alt >= ALT; });
    const lab = new Int32Array(bw * bh).fill(-1), comps = [];
    for (let i = 0; i < blk.length; i++) {
      if (!blk[i].ok || lab[i] >= 0) continue;
      const st = [i], m = []; lab[i] = comps.length;
      while (st.length) {
        const k = st.pop(); m.push(k); const bx = k % bw, by = (k / bw) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = bx + dx, ny = by + dy; if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
          const j = ny * bw + nx; if (lab[j] >= 0 || !blk[j].ok) continue;
          let da = Math.abs(blk[j].ang - blk[k].ang); da = Math.min(da, Math.PI - da); if (da > 0.35) continue;
          lab[j] = comps.length; st.push(j);
        }
      }
      comps.push(m);
    }
    return comps.filter((m) => m.length >= MINB).map((m) => {
      let sx = 0, sy = 0; m.forEach((k) => { sx += Math.cos(2 * blk[k].ang); sy += Math.sin(2 * blk[k].ang); });
      const ang = 0.5 * Math.atan2(sy, sx), pts = m.map((k) => [((k % bw) * B + B / 2) / S + ox, (((k / bw) | 0) * B + B / 2) / S + oy]);
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      const cs = Math.cos(-ang), sn = Math.sin(-ang), P = pts.map(([px, py]) => [(px - cx) * cs - (py - cy) * sn, (px - cx) * sn + (py - cy) * cs]);
      const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
      const rw = Math.max(...xs) - Math.min(...xs) + B / S, rh = Math.max(...ys) - Math.min(...ys) + B / S;
      return { n: m.length, ang, cx, cy, pts, w: rw, h: rh };
    }).sort((a, b) => b.n - a.n);
  }
  /** region ko seedha (bars khade) karke crop. part: 'bars' | 'text' (neeche likha number ki patti) */
  function cropRegion(work, comp, dAng, sc, part, flip) {
    const a = -(comp.ang + dAng) + (flip ? Math.PI : 0), cos = Math.cos(a), sin = Math.sin(a);
    const P = comp.pts.map(([px, py]) => { const dx = px - comp.cx, dy = py - comp.cy; return [dx * cos - dy * sin, dx * sin + dy * cos]; });
    const minx0 = Math.min(...P.map((p) => p[0])), maxx0 = Math.max(...P.map((p) => p[0])), miny0 = Math.min(...P.map((p) => p[1])), maxy0 = Math.max(...P.map((p) => p[1])), hh = Math.max(20, maxy0 - miny0);
    let minx, maxx, miny, maxy;
    if (part === 'wide') { minx = minx0 - 40; maxx = maxx0 + 40; miny = miny0 - hh * 0.35; maxy = maxy0 + hh * 0.95; } else if (part === 'text') { minx = minx0 - 24; maxx = maxx0 + 24; miny = maxy0 - hh * 0.1; maxy = maxy0 + hh * 0.75; } else { minx = minx0 - 34; maxx = maxx0 + 34; miny = miny0 - 24; maxy = maxy0 + 24; }
    const s = Math.min(sc, 1900 / Math.max(1, maxx - minx), 1500 / Math.max(1, maxy - miny));
    const c = mk((maxx - minx) * s, (maxy - miny) * s), x = ctx2(c);
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.scale(s, s); x.translate(-minx, -miny); x.rotate(a); x.translate(-comp.cx, -comp.cy); x.drawImage(work, 0, 0);
    return c;
  }


  // ---------- v3.125.533: tedhe / ulte photo me barcode + neeche ka number SAHI ghuma kar seedha karna ----------
  const grayOf = (c) => { const w = c.width, h = c.height, d = ctx2(c).getImageData(0, 0, w, h).data, g = new Float32Array(w * h); for (let i = 0; i < w * h; i++) g[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) / 256; return { g, w, h }; };
  /** region ka angle theek karo: jis ghumav par lakeeren sabse "tez" (column-profile ka variation sabse zyada) wahi seedha */
  function refineAngle(work, r) {
    const score = (da) => {
      const { g, w, h } = grayOf(cropRegion(work, r, da, 0.9, 'wide')); const col = new Float32Array(w);
      for (let x = 0; x < w; x++) { let s = 0; for (let y = 0; y < h; y++) s += g[y * w + x]; col[x] = s / h; }
      let e = 0; for (let x = 1; x < w; x++) { const d = col[x] - col[x - 1]; e += d * d; } return e;
    };
    let best = 0, bs = -1;
    for (let da = -0.3; da <= 0.3001; da += 0.03) { const sc = score(da); if (sc > bs) { bs = sc; best = da; } }
    const c0 = best; for (let da = c0 - 0.028; da <= c0 + 0.0281; da += 0.007) { const sc = score(da); if (sc > bs) { bs = sc; best = da; } }
    return best;
  }
  /** seedha kiye gaye crop (bars khade) me barcode ka dibba + neeche likhe number ki patti dhoondho. Return { bars:{x0,x1,y0,y1}, text:{y0,y1} } */
  function layoutOf(c) {
    const { g, w, h } = grayOf(c); const e = new Float32Array(h);
    for (let y = 0; y < h; y++) { let s = 0; for (let x = Math.floor(w * 0.2); x < w * 0.8; x++) s += Math.abs(g[y * w + x] - g[y * w + x - 1]); e[y] = s; }
    const es = e.map((_, y) => { let s = 0, n = 0; for (let k = -3; k <= 3; k++) if (e[y + k] !== undefined) { s += e[y + k]; n++; } return s / n; });
    let am = 0; for (let y = 1; y < h; y++) if (es[y] > es[am]) am = y;
    let y0 = am, y1 = am; while (y0 > 0 && es[y0 - 1] > 0.5 * es[am]) y0--; while (y1 < h - 1 && es[y1 + 1] > 0.5 * es[am]) y1++;
    const H = y1 - y0 + 1;
    // bars ka x-range: in rows ki column-energy
    const ce = new Float32Array(w); for (let x = 1; x < w; x++) { let s = 0; for (let y = y0; y <= y1; y++) s += Math.abs(g[y * w + x] - g[y * w + x - 1]); ce[x] = s / H; }
    const cs = Array.from(ce).sort((a, b) => a - b), thr = Math.max(4, cs[Math.floor(w * 0.9)] * 0.35); let xa = -1, xb = -1;
    for (let x = 0; x < w; x++) if (ce[x] > thr) { if (xa < 0) xa = x; xb = x; }
    if (xa < 0) { xa = 0; xb = w - 1; }
    // number ki patti: bars ke turant neeche, jahan upar-neeche (akshar) ka "tez" badlav ho
    let t0 = y1 + 2, t1 = y1 + Math.round(H * 0.4);
    const lim = Math.min(h - 1, y1 + Math.round(H * 0.75)), te = [];
    for (let y = y1 + 1; y <= lim; y++) { let s = 0; for (let x = xa + 1; x <= xb; x++) s += Math.abs(g[y * w + x] - g[y * w + x - 1]); te.push(s); }
    if (te.length > 6) {
      const sm = te.map((_, i) => { let s = 0, n = 0; for (let k = -2; k <= 2; k++) if (te[i + k] !== undefined) { s += te[i + k]; n++; } return s / n; });
      let bi = 0; for (let i = 1; i < sm.length; i++) if (sm[i] > sm[bi]) bi = i;
      if (sm[bi] > 0) { let a2 = bi, b2 = bi; while (a2 > 0 && sm[a2 - 1] > 0.4 * sm[bi]) a2--; while (b2 < sm.length - 1 && sm[b2 + 1] > 0.4 * sm[bi]) b2++; t0 = y1 + 1 + a2; t1 = y1 + 1 + b2; }
    }
    return { bars: { x0: xa, x1: xb, y0, y1 }, text: { y0: t0, y1: t1 }, w, h };
  }
  /** number ki patti ka saaf, bada, kaala-safed crop (OCR ke liye) — r region, da angle, flip = 180° ulta */
  function textStrip(work, r, da, flip, th0) {
    const c = cropRegion(work, r, da, 3, 'wide', flip), L = layoutOf(c), pad = Math.max(6, Math.round((L.text.y1 - L.text.y0) * 0.35));
    const x0 = Math.max(0, L.bars.x0 - 12), x1 = Math.min(c.width, L.bars.x1 + 12), y0 = Math.max(0, L.text.y0 - pad), y1 = Math.min(c.height, L.text.y1 + pad);
    const w = Math.max(10, x1 - x0), h = Math.max(10, y1 - y0), th = th0 || 56, s = th / Math.max(12, h), o = mk(Math.max(10, w * s), th), x = ctx2(o);
    x.fillStyle = '#fff'; x.fillRect(0, 0, o.width, o.height); x.drawImage(c, x0, y0, w, h, 0, 0, o.width, o.height);
    return { canvas: o, layout: L };
  }

  function thumbOf(work, r, da) { try { return cropRegion(work, r, da || 0, 0.8, 'wide').toDataURL('image/jpeg', 0.55); } catch { return ''; } }
  async function zbarScan(c) {
    const z = await zbarLib(); const id = ctx2(c).getImageData(0, 0, c.width, c.height);
    const res = await z.scanImageData(id), out = [];
    res.forEach((r) => { if (/QR/i.test(r.typeName || '')) return; const k = parse16(r.decode()); if (k) out.push({ code: k, pts: r.points || [] }); });
    return out;
  }

  /**
   * Photo se barcode nikalo.
   * src: ImageBitmap | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement, sw/sh = uski pixel size.
   * opt: { onFound(code, how), budgetMs (default 14000), ocr (default true), quick (sirf tez tareeke) }
   * Return: [{ code, how: 'barcode'|'text', votes }]
   */
  async function read(src, sw, sh, opt = {}) {
    const budget = opt.budgetMs || 14000, t0 = now(), left = () => budget - (now() - t0);
    const found = new Map(); const boxes = [];
    const add = (code, how, pts) => {
      if (!code) return; const f = found.get(code);
      if (f) { f.votes++; if (how === 'barcode') f.how = 'barcode'; return; }
      found.set(code, { code, how, votes: 1 }); if (pts && pts.length) boxes.push(pts);
      try { opt.onFound && opt.onFound(code, how); } catch { /* ui */ }
    };
    const work = toWork(src, sw, sh);
    // 1) native detector — saare barcode
    try { const det = await nativeDet(); if (det) for (const f of await det.detect(work)) { const k = parse16(f.rawValue); if (k) add(k, 'barcode', f.cornerPoints ? f.cornerPoints.map((p) => [p.x, p.y]) : null); } } catch { /* */ }
    // 2) zbar poori photo (+ contrast)
    try { for (const r of await zbarScan(work)) add(r.code, 'barcode', r.pts.map((p) => [p.x, p.y])); } catch { /* lib nahi */ }
    await tick();
    if (opt.quick) return [...found.values()];
    // 3) jagah dhoondh kar seedha crop + zbar ; 4) number ka OCR
    let regions = []; try { regions = locate(work); } catch { regions = []; }
    const inBox = (r) => boxes.some((b) => { const xs = b.map((p) => p[0]), ys = b.map((p) => p[1]); return r.cx >= Math.min(...xs) - 40 && r.cx <= Math.max(...xs) + 40 && r.cy >= Math.min(...ys) - 60 && r.cy <= Math.max(...ys) + 60; });
    const cand = regions.filter((r) => r.w > 60 && r.w / Math.max(1, r.h) >= 0.9 && r.w / Math.max(1, r.h) <= 9 && !inBox(r)).slice(0, 10);
    const ocrJobs = [];
    for (const r of cand) {
      if (left() < 0) break;
      let hit = false; try { r.da = refineAngle(work, r); } catch { r.da = 0; }
      for (const [da, sc, md] of [[0, 1, ''], [0, 1.7, 'e'], [0.05, 1.3, ''], [-0.05, 1.3, '']]) {
        let c = cropRegion(work, r, (r.da || 0) + da, sc, 'bars'); if (md) c = enhance(c, md);
        try { const rs = await zbarScan(c); if (rs.length) { rs.forEach((q) => { add(q.code, 'barcode', null); const f2 = found.get(q.code); if (f2 && !f2.thumb) f2.thumb = thumbOf(work, r); }); hit = true; break; } } catch { break; }
      }
      if (!hit) ocrJobs.push(r);
      await tick();
    }
    if (opt.ocr !== false && ocrJobs.length && left() > 1500) {
      let ocr = null; try { ocr = await ocrLib(); } catch { ocr = null; }
      const known = (opt.prefixes && opt.prefixes.length ? opt.prefixes : ['608116']).slice();
      for (const f of found.values()) { const p = f.code.slice(0, 6); if (!known.includes(p)) known.push(p); }
      const reads = [];   // { reg, g1, g2, g3 }
      const VARS = [[7, 2, 0], [7, 3, 0], [6, 2, 0], [7, 2, 0.06], [7, 4, 0], [6, 3, -0.06], [7, 3, 0.06], [7, 2, -0.06]];
      if (ocr) for (const r of ocrJobs) {
        if (left() < 600) break;
        const votes = new Map(); let flip = false, tried = 0, da0 = 0;
        // v3.125.533 — pehle angle theek karo, number ki patti alag kaato (seedhi + ulti), OCR line mode
        da0 = r.da || 0;
        for (const fl of [false, true]) {
          if (left() < 500) break;
          for (const [th, dd] of [[56, 0], [72, 0.012], [48, -0.012]]) {
            if (left() < 400) break;
            let txt = ''; try { const st = textStrip(work, r, da0 + dd, fl, th); if (st.canvas.width < 80) break; txt = await ocr.recognize(st.canvas, 7); } catch { break; }
            lenientCodes(txt).forEach((x) => { const g1 = fixPrefix(x.g1, known); if (!g1) return; const k = `${g1}-${x.g2}-${x.g3}`; votes.set(k, (votes.get(k) || 0) + 1); reads.push({ reg: r, g1, g2: x.g2, g3: x.g3 }); });
            if (!votes.size) break;   // is disha me number hi nahi — ulti taraf dekho
            if ([...votes.values()].some((v) => v >= 2)) break;
          }
          if (votes.size) break;
        }
        const run = async (cfg, fl) => {
          const c = cropRegion(work, r, cfg[2], cfg[1], 'text', fl); let txt = '';
          try { txt = await ocr.recognize(c, cfg[0]); } catch { return; }
          lenientCodes(txt).forEach((x) => { const g1 = fixPrefix(x.g1, known); if (!g1) return; const k = `${g1}-${x.g2}-${x.g3}`; votes.set(k, (votes.get(k) || 0) + 1); reads.push({ reg: r, g1, g2: x.g2, g3: x.g3 }); });
        };
        if (!votes.size) for (const cfg of VARS) {
          if (left() < 400) break;
          await run(cfg, flip); tried++;
          if ([...votes.values()].some((v) => v >= 2)) break;
          if (tried === 2 && !votes.size && !flip) { flip = true; }   // ulta (180°) photo — dusri taraf ki patti
          await tick();
        }
        if (!votes.size && left() > 800) {   // kuch nahi mila — poore region (upar-neeche-tedha) par, dono disha me
          for (const [fl, da] of [[false, 0], [true, 0], [false, 0.15], [false, -0.15], [true, 0.15], [true, -0.15]]) {
            if (left() < 400) break;
            let txt = ''; try { txt = await ocr.recognize(cropRegion(work, r, da, 1.6, 'wide', fl), 11); } catch { break; }
            lenientCodes(txt).forEach((x) => { const g1 = fixPrefix(x.g1, known); if (!g1) return; const k = `${g1}-${x.g2}-${x.g3}`; votes.set(k, (votes.get(k) || 0) + 1); reads.push({ reg: r, g1, g2: x.g2, g3: x.g3 }); });
            if ([...votes.values()].some((v) => v >= 2)) break;
            await tick();
          }
        }
        let ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
        if (ranked.length >= 2 && ranked[0][1] < 2) {   // pakki jodi nahi — har digit par bahumat (character-level)
          const mine = reads.filter((x) => x.reg === r), pos = (fn, len) => { let s = ''; for (let i = 0; i < len; i++) { const c = {}; mine.forEach((x) => { const d = fn(x)[i]; if (d) c[d] = (c[d] || 0) + 1; }); const b2 = Object.entries(c).sort((p, q) => q[1] - p[1])[0]; s += b2 ? b2[0] : '0'; } return s; };
          const g1 = ranked[0][0].slice(0, 6), mix = `${g1}-${pos((x) => x.g2, 3)}-${pos((x) => x.g3, 7)}`;
          if (!ranked.some((x) => x[0] === mix)) ranked.unshift([mix, 1]); else ranked.sort((a, b) => (a[0] === mix ? -1 : b[0] === mix ? 1 : b[1] - a[1]));
        }
        if (ranked[0]) { add(ranked[0][0], 'text'); const f = found.get(ranked[0][0]); if (f) { f.alts = ranked.slice(1).map((x) => x[0]).filter((c) => known.includes(c.slice(0, 6))); f.thumb = thumbOf(work, r, r.da); } }
      }
      // photo ke andar sabka common middle group (jaise 039): ek-do digit ka farak ho to sahi wala alt me daalo
      const tx = [...found.values()].filter((f) => f.how === 'text'); const g2c = new Map(); tx.forEach((f) => { const g = f.code.slice(7, 10); g2c.set(g, (g2c.get(g) || 0) + 1); });
      const topG2 = [...g2c.entries()].sort((a, b) => b[1] - a[1])[0];
      if (topG2 && tx.length >= 2) tx.forEach((f) => { const g = f.code.slice(7, 10); if (g !== topG2[0] && ham(g, topG2[0]) <= 1) { const alt = `${f.code.slice(0, 7)}${topG2[0]}${f.code.slice(10)}`; f.alts = [f.code, ...(f.alts || []).filter((x) => x !== alt && x !== f.code)]; if (topG2[1] >= 3) { found.delete(f.code); f.code = alt; found.set(alt, f); } else f.alts = [alt, ...f.alts.filter((x) => x !== f.code)]; } });
      // photo ke tag aksar ek series me hote hain — aakhri 7 digit ke pehle 4 digit sabke same; ek-do digit ka farak ho to majority wala
    }
    // 5) kuch bhi na mila — poori photo par OCR (sirf number likha ho / barcode kata ho)
    if (!found.size && opt.ocr !== false && left() > 2500) {
      try { const ocr = await ocrLib(); const c = enhance(toWork(src, sw, sh), 'stretch'); textCodes(await ocr.recognize(c, 11)).forEach((k) => add(k, 'text')); } catch { /* */ }
    }
    return [...found.values()];
  }


  /**
   * 🎥 LIVE camera: video par barcode / number ko TURANT pakadna.
   *  har cycle: native BarcodeDetector → zbar (frame) → agar kuch nahi: number ki patti (locate → angle → strip → OCR line) — OCR worker pehle se garam (warm).
   *  barcode (checksum wala) = turant onFound; number (OCR) = 2 baar ek jaisa padha jaye to (≈0.4 s) — ya known prefix + server-valid ho to.
   * opt: { isActive(), hold(), onFound(code, how), onStatus(msg), prefixes }  → return stop()
   */
  function live(video, opt) {
    let stop = false, busy = false, misses = 0; const seen = new Map(), cv = mk(2, 2);
    warmAll();
    function warmAll() { zbarLib().catch(() => {}); ocrLib().catch(() => {}); }
    const known = (opt.prefixes && opt.prefixes.length ? opt.prefixes : ['608116']).slice();
    const frame = () => {
      const vw = video.videoWidth, vh = video.videoHeight; if (!vw || !vh) return null;
      const S = Math.min(1, 1400 / Math.max(vw, vh)), c = mk(vw * S, vh * S), x = ctx2(c); x.drawImage(video, 0, 0, c.width, c.height); return c;
    };
    async function cycle() {
      const c = frame(); if (!c) return;
      let hit = false;
      try { const det = opt.skipNative ? null : await nativeDet(); if (det) for (const f of await det.detect(c)) { const k = parse16(f.rawValue); if (k) { hit = true; opt.onFound(k, 'barcode'); } } } catch { /* */ }
      if (hit) { misses = 0; return; }
      try { const z = env.zbar || (zP ? null : await zbarLib()); if (z) for (const r of await zbarScan(c)) { hit = true; opt.onFound(r.code, 'barcode'); } } catch { /* */ }
      if (hit) { misses = 0; return; }
      misses++;
      if (!env.ocr) { opt.onStatus && opt.onStatus('🔤 Number padhne wala tayyar ho raha hai…'); return; }
      let regs = []; try { regs = locate(c); } catch { regs = []; }
      const cx = c.width / 2, cy = c.height / 2;
      regs = regs.filter((r) => r.w > 40 && r.w / Math.max(1, r.h) >= 0.9 && r.w / Math.max(1, r.h) <= 9).sort((a, b) => Math.hypot(a.cx - cx, a.cy - cy) - Math.hypot(b.cx - cx, b.cy - cy)).slice(0, 2);
      for (const r of regs) {
        if (stop) return;
        let da = 0; try { da = refineAngle(c, r); } catch { da = 0; }
        for (const fl of [false, true]) {
          let txt = ''; try { const st = textStrip(c, r, da, fl, 56); if (st.canvas.width < 80) break; txt = await env.ocr.recognize(st.canvas, 7); } catch { break; }
          const got = [...new Set(lenientCodes(txt).map((x) => { const g1 = fixPrefix(x.g1, known); return g1 ? `${g1}-${x.g2}-${x.g3}` : ''; }).filter(Boolean))];
          if (!got.length) { if (!fl) continue; else break; }
          for (const k of got) { const n = (seen.get(k) || 0) + 1; seen.set(k, n); opt.onStatus && opt.onStatus('🔎 ' + k); if (n >= 2) { seen.clear(); hit = true; opt.onFound(k, 'text'); } }
          break;
        }
        if (hit) break;
      }
      if (seen.size > 40) seen.clear();
    }
    (async function loop() {
      while (!stop && !(opt.isActive && !opt.isActive())) {
        if (!busy && !(opt.hold && opt.hold()) && video.readyState >= 2 && !(typeof document !== 'undefined' && document.hidden)) { busy = true; try { await cycle(); } catch { /* frame skip */ } busy = false; }
        await new Promise((r) => setTimeout(r, 60));
      }
    })();
    return () => { stop = true; };
  }

  FF.scanVision = { _dbg: () => ({ toWork, zbarScan, enhance, ocrLib, zbarLib, nativeDet }), read, parse16, textCodes, lenientCodes, fixPrefix, locate, cropRegion, refineAngle, layoutOf, textStrip, _env: env, warm: () => { zbarLib().catch(() => {}); ocrLib().catch(() => {}); }, live };
  if (typeof module !== 'undefined' && module.exports) module.exports = FF.scanVision;
})(typeof window !== 'undefined' ? window : globalThis);
