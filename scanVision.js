/* 📷 v3.125.531 — scanVision: photo / screenshot / camera-frame se FASTag barcode nikalo (ek photo me kai tag bhi).
 *
 * Seedhe barcode decoder halke, tedhe, dhundhle (WhatsApp photo, screen par photo) barcode par fail hota tha. Ab 4 tareeke, tez se dheere:
 *   1. Browser ka native BarcodeDetector (saare barcode ek saath)          2. zbar-wasm poori photo par
 *   3. Barcode ki JAGAH dhoondh kar (gradient coherence) seedha ghuma ke crop → zbar            4. Barcode ke NEECHE likha number (OCR, Tesseract) —
 *      jab patti dhundhli ho par number saaf dikhta ho (608116-035-0611445). Sab libraries sirf zarurat par load hoti hain (vendor/).
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

  // ---------- libraries (lazy) ----------
  const loadScript = (src) => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('lib ' + src)); document.head.appendChild(s); });
  const baseUrl = () => env.base || new URL('vendor/', document.baseURI).href;
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
  function locate(work) {
    // bada photo / collage: 1000px ke overlapping tukdon me (barcode ki lakeeren chhoti na hon), phir milte-julte regions ek
    const T = 1000, STEP = 750, W0 = work.width, H0 = work.height;
    if (Math.max(W0, H0) <= 1300) return locateTile(work, 0, 0);
    const all = [];
    for (let y = 0; y < H0; y += STEP) for (let x = 0; x < W0; x += STEP) {
      const tw = Math.min(T, W0 - x), th = Math.min(T, H0 - y); if (tw < 200 || th < 200) continue;
      const c = mk(tw, th), cx = ctx2(c); cx.drawImage(work, x, y, tw, th, 0, 0, tw, th);
      all.push(...locateTile(c, x, y));
      if (x + T >= W0) break;
    }
    const out = []; all.sort((a, b) => b.n - a.n);
    for (const r of all) if (!out.some((o) => Math.hypot(o.cx - r.cx, o.cy - r.cy) < Math.max(70, 0.35 * Math.max(o.w, r.w)))) out.push(r);
    return out;
  }
  function locateTile(work, ox, oy) {
    const S = Math.min(1, 1000 / Math.max(work.width, work.height)), w = Math.round(work.width * S), h = Math.round(work.height * S);
    const c = mk(w, h), x = ctx2(c); x.drawImage(work, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data;
    const g = new Float32Array(w * h); for (let i = 0; i < w * h; i++) g[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) / 256;
    const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let xx = 1; xx < w - 1; xx++) { const i = y * w + xx; gx[i] = g[i + 1] - g[i - 1]; gy[i] = g[i + w] - g[i - w]; }
    const B = 14, bw = Math.floor(w / B), bh = Math.floor(h / B), blk = [];
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      let jxx = 0, jyy = 0, jxy = 0;
      for (let y = by * B; y < by * B + B; y++) for (let xx = bx * B; xx < bx * B + B; xx++) { const i = y * w + xx; jxx += gx[i] * gx[i]; jyy += gy[i] * gy[i]; jxy += gx[i] * gy[i]; }
      const e = jxx + jyy; blk.push({ e: e / (B * B), coh: e > 0 ? Math.sqrt((jxx - jyy) ** 2 + 4 * jxy * jxy) / e : 0, ang: 0.5 * Math.atan2(2 * jxy, jxx - jyy) });
    }
    const en = blk.map((b) => b.e).sort((a, b) => a - b), thr = Math.max(300, en[Math.floor(en.length * 0.6)] || 0);
    blk.forEach((b) => { b.ok = b.coh > 0.78 && b.e > thr; });
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
    return comps.filter((m) => m.length >= 8).map((m) => {
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
  function cropRegion(work, comp, dAng, sc, part) {
    const a = -(comp.ang + dAng), cos = Math.cos(a), sin = Math.sin(a);
    const P = comp.pts.map(([px, py]) => { const dx = px - comp.cx, dy = py - comp.cy; return [dx * cos - dy * sin, dx * sin + dy * cos]; });
    const minx0 = Math.min(...P.map((p) => p[0])), maxx0 = Math.max(...P.map((p) => p[0])), miny0 = Math.min(...P.map((p) => p[1])), maxy0 = Math.max(...P.map((p) => p[1])), hh = Math.max(20, maxy0 - miny0);
    let minx, maxx, miny, maxy;
    if (part === 'text') { minx = minx0 - 24; maxx = maxx0 + 24; miny = maxy0 - hh * 0.1; maxy = maxy0 + hh * 0.75; } else { minx = minx0 - 34; maxx = maxx0 + 34; miny = miny0 - 24; maxy = maxy0 + 24; }
    const s = Math.min(sc, 1900 / Math.max(1, maxx - minx), 1500 / Math.max(1, maxy - miny));
    const c = mk((maxx - minx) * s, (maxy - miny) * s), x = ctx2(c);
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.scale(s, s); x.translate(-minx, -miny); x.rotate(a); x.translate(-comp.cx, -comp.cy); x.drawImage(work, 0, 0);
    return c;
  }

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
    const cand = regions.filter((r) => r.w > 60 && r.w / Math.max(1, r.h) >= 1.3 && r.w / Math.max(1, r.h) <= 9 && !inBox(r)).slice(0, 10);
    const ocrJobs = [];
    for (const r of cand) {
      if (left() < 0) break;
      let hit = false;
      for (const [da, sc, md] of [[0, 1, ''], [0, 1.7, 'e'], [0.05, 1.3, ''], [-0.05, 1.3, '']]) {
        let c = cropRegion(work, r, da, sc, 'bars'); if (md) c = enhance(c, md);
        try { const rs = await zbarScan(c); if (rs.length) { rs.forEach((q) => add(q.code, 'barcode', null)); hit = true; break; } } catch { break; }
      }
      if (!hit) ocrJobs.push(r);
      await tick();
    }
    if (opt.ocr !== false && ocrJobs.length && left() > 1500) {
      let ocr = null; try { ocr = await ocrLib(); } catch { ocr = null; }
      if (ocr) for (const r of ocrJobs) {
        if (left() < 600) break;
        const votes = new Map();
        for (const da of [0, 0.12, -0.12]) {
          const c = cropRegion(work, r, da, 2, 'text');
          try { textCodes(await ocr.recognize(c, 6)).forEach((k) => votes.set(k, (votes.get(k) || 0) + 1)); } catch { /* */ }
          if ([...votes.values()].some((v) => v >= 2)) break;
          await tick();
        }
        const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
        if (ranked[0]) { add(ranked[0][0], 'text'); const f = found.get(ranked[0][0]); if (f) f.alts = ranked.slice(1).map((x) => x[0]); }
      }
    }
    // 5) kuch bhi na mila — poori photo par OCR (sirf number likha ho / barcode kata ho)
    if (!found.size && opt.ocr !== false && left() > 2500) {
      try { const ocr = await ocrLib(); const c = enhance(toWork(src, sw, sh), 'stretch'); textCodes(await ocr.recognize(c, 11)).forEach((k) => add(k, 'text')); } catch { /* */ }
    }
    return [...found.values()];
  }

  FF.scanVision = { read, parse16, textCodes, locate, cropRegion, _env: env, warm: () => { zbarLib().catch(() => {}); } };
  if (typeof module !== 'undefined' && module.exports) module.exports = FF.scanVision;
})(typeof window !== 'undefined' ? window : globalThis);
