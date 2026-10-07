/* 📄 PDF (v3.32) — bina kisi library / CDN ke, seedha browser me PDF banao.
 *
 *   Kyun canvas → JPEG → PDF?  Site ki CSP `script-src 'self'` hai (CDN lib load nahi hoti) aur
 *   canvas se Hindi / emoji / ₹ jaise characters bhi bilkul sahi aate hain (standard PDF fonts me nahi aate).
 *   Print window ke inline script bhi CSP se block hote the — isliye ab PDF direct download hota hai.
 *
 *   API
 *     FF.pdf.build(canvases[, { wMm, hMm }])  → Blob (application/pdf)  · har canvas = ek page
 *     FF.pdf.download(blob, filename)         → browser download
 *     FF.pdf.share(blob, filename, text)      → Web Share (file) → na ho to download + WhatsApp text link
 *     FF.pdf.page(wMm, hMm, dpi)              → { canvas, ctx, px(mm) }  (mm coordinates)
 *     FF.pdf.wrap(ctx, text, maxW)            → lines[]
 *     FF.pdf.doc(opts)                        → report layout builder (title/heading/section/kpis/table/text → finish() = PDF Blob)
 *       · v3.34 compat: doc({ title, subtitle, right, meta }) khud page-1 header banata hai,
 *         section(text, sub) + footer(text) legacy names chalte hain, aur table() dono form leta hai —
 *         table(columns, rows, topt)  YA  table({ headers, align, rows, foot }).
 *       · finish(footerText) ab **Blob** return karta hai → FF.pdf.download(doc.finish(), name) seedha chalega.
 */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const DPI = 170;
  const MM = (dpi) => dpi / 25.4;
  const FONT = '"Segoe UI", Roboto, Arial, "Noto Sans", "Noto Sans Devanagari", sans-serif';

  function page(wMm, hMm, dpi) {
    const k = MM(dpi || DPI);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(wMm * k); canvas.height = Math.round(hMm * k);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textBaseline = 'alphabetic';
    return { canvas, ctx, k, wMm, hMm, px: (mm) => mm * k };
  }
  function wrap(ctx, text, maxW) {
    const out = [];
    String(text == null ? '' : text).split(/\r?\n/).forEach((para) => {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(''); return; }
      let line = '';
      words.forEach((w) => {
        const t = line ? `${line} ${w}` : w;
        if (ctx.measureText(t).width <= maxW || !line) {
          if (!line && ctx.measureText(w).width > maxW) {
            // lamba shabd — akshar-akshar tod do
            let cur = '';
            for (const ch of w) { if (ctx.measureText(cur + ch).width > maxW && cur) { out.push(cur); cur = ch; } else cur += ch; }
            line = cur;
          } else line = t;
        } else { out.push(line); line = w; }
      });
      if (line) out.push(line);
    });
    return out;
  }

  // ---- PDF container -----------------------------------------------------------------------------
  const enc = (s) => { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255; return a; };
  function dataUrlBytes(url) {
    const b64 = url.slice(url.indexOf(',') + 1);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function build(canvases, opts) {
    const o = opts || {};
    const wPt = (Number(o.wMm) || 210) * 72 / 25.4, hPt = (Number(o.hMm) || 297) * 72 / 25.4;
    const parts = []; const offsets = []; let len = 0;
    const push = (u8) => { parts.push(u8); len += u8.length; };
    const pushS = (s) => push(enc(s));
    const begin = (n) => { offsets[n] = len; pushS(`${n} 0 obj\n`); };
    const list = (canvases || []).filter(Boolean);
    const nPages = list.length;
    // Object ids: 1 catalog · 2 pages · per page i: page=3+3i, content=4+3i, image=5+3i
    pushS('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    begin(1); pushS('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    begin(2); pushS(`<< /Type /Pages /Count ${nPages} /Kids [${list.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] >>\nendobj\n`);
    list.forEach((cv, i) => {
      const jpg = dataUrlBytes(cv.toDataURL('image/jpeg', 0.9));
      const pid = 3 + 3 * i, cid = 4 + 3 * i, iid = 5 + 3 * i;
      begin(pid); pushS(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt.toFixed(2)} ${hPt.toFixed(2)}] /Resources << /XObject << /Im0 ${iid} 0 R >> >> /Contents ${cid} 0 R >>\nendobj\n`);
      const content = `q ${wPt.toFixed(2)} 0 0 ${hPt.toFixed(2)} 0 0 cm /Im0 Do Q`;
      begin(cid); pushS(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
      begin(iid); pushS(`<< /Type /XObject /Subtype /Image /Width ${cv.width} /Height ${cv.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
      push(jpg); pushS('\nendstream\nendobj\n');
    });
    const total = 3 + 3 * nPages;
    const xref = len;
    let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let n = 1; n < total; n++) x += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
    pushS(`${x}trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(parts, { type: 'application/pdf' });
  }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename || 'report.pdf'; a.rel = 'noopener';
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
  }
  /** Mobile par seedha share sheet (PDF file) · desktop par download + WhatsApp text. */
  async function share(blob, filename, text) {
    try {
      const file = new File([blob], filename || 'report.pdf', { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: filename, text: text || '' }); return 'shared'; }
    } catch (err) { if (err && err.name === 'AbortError') return 'cancel'; }
    download(blob, filename);
    if (text) { try { window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener'); } catch { /* popup block */ } }
    return 'downloaded';
  }

  // ---- report layout (A4 portrait, multi-page) ---------------------------------------------------
  function doc(opts) {
    const o = opts || {};
    const W = 210, H = 297, M = 11;
    const pages = [];
    let cur = null, y = 0;
    let storedFooter = '';
    const brand = o.brand || 'First Forward';
    const newPage = () => {
      cur = page(W, H); pages.push(cur); y = M;
      const { ctx, px } = cur;
      ctx.fillStyle = o.accent || '#2563eb'; ctx.fillRect(0, 0, px(W), px(5));
      y = M + 2;
      if (pages.length > 1) { ctx.fillStyle = '#64748b'; ctx.font = `${px(3)}px ${FONT}`; ctx.fillText(`${o.title || ''}`, px(M), px(y + 2)); y += 6; }
    };
    const need = (h) => { if (!cur || y + h > H - 12) newPage(); };
    const font = (sizeMm, weight) => { cur.ctx.font = `${weight || 400} ${cur.px(sizeMm)}px ${FONT}`; };
    const api = {
      title(text, sub) {
        need(22);
        const { ctx, px } = cur;
        ctx.fillStyle = '#0f172a'; font(7.2, 800); ctx.fillText(text, px(M), px(y + 7));
        y += 10;
        if (sub) { ctx.fillStyle = '#64748b'; font(3.4, 500); wrap(ctx, sub, px(W - 2 * M)).forEach((l) => { ctx.fillText(l, px(M), px(y + 3)); y += 4.6; }); }
        y += 2; return api;
      },
      heading(text, color) {
        need(14);
        const { ctx, px } = cur;
        ctx.fillStyle = color || '#1e3a8a'; ctx.fillRect(px(M), px(y), px(1.3), px(6));
        font(4.4, 800); ctx.fillText(text, px(M + 3), px(y + 4.8));
        y += 8.5; return api;
      },
      /** v3.34 — legacy alias: section(title, sub) = heading + chhoti grey sub-line. */
      section(text, sub) {
        api.heading(text);
        if (sub != null && sub !== '') {
          need(6);
          const { ctx, px } = cur;
          ctx.fillStyle = '#64748b'; font(2.8, 500);
          ctx.fillText(String(sub).slice(0, 90), px(M + 3), px(y + 0.2));
          y += 4;
        }
        return api;
      },
      text(text, optsT) {
        const t = optsT || {};
        const { ctx, px } = cur || (newPage(), cur);
        font(t.size || 3.4, t.bold ? 700 : 400); ctx.fillStyle = t.color || '#334155';
        wrap(ctx, text, px(W - 2 * M)).forEach((l) => { need(5.5); cur.ctx.fillStyle = t.color || '#334155'; font(t.size || 3.4, t.bold ? 700 : 400); cur.ctx.fillText(l, cur.px(M), cur.px(y + 3.4)); y += (t.size || 3.4) * 1.4; });
        y += 1.5; return api;
      },
      /** [{ label, value, sub, color }] — ek row me 4 cards tak. */
      kpis(cards, perRow) {
        const n = perRow || 4, gap = 3, cw = (W - 2 * M - gap * (n - 1)) / n, ch = 20;
        for (let i = 0; i < cards.length; i += n) {
          need(ch + 3);
          const { ctx, px } = cur;
          cards.slice(i, i + n).forEach((c, j) => {
            const x = M + j * (cw + gap);
            ctx.fillStyle = (c.color || '#2563eb') + '18'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(px(x), px(y), px(cw), px(ch), px(2)) : ctx.rect(px(x), px(y), px(cw), px(ch)); ctx.fill();
            ctx.fillStyle = c.color || '#2563eb'; ctx.fillRect(px(x), px(y + 2), px(1), px(ch - 4));
            ctx.fillStyle = '#475569'; font(2.8, 600); ctx.fillText(String(c.label || '').slice(0, 26), px(x + 3), px(y + 5));
            ctx.fillStyle = '#0f172a'; font(6.4, 800); ctx.fillText(String(c.value == null ? '—' : c.value), px(x + 3), px(y + 12.5));
            if (c.sub) { ctx.fillStyle = '#64748b'; font(2.5, 500); ctx.fillText(String(c.sub).slice(0, 38), px(x + 3), px(y + 17)); }
          });
          y += ch + 3;
        }
        return api;
      },
      /** columns: [{ h, w (relative), align }] · rows: string[][]
       *  v3.34 — legacy form bhi chalega: table({ headers: [], align: [], rows: [[]], foot: [] }) */
      table(columns, rows, topt) {
        if (columns && !Array.isArray(columns) && Array.isArray(columns.headers)) {
          const legacy = columns;
          const align = Array.isArray(legacy.align) ? legacy.align : [];
          const cols = legacy.headers.map((h, i) => ({ h, align: align[i] === 'right' ? 'right' : 'left', bold: i === 0 && !!legacy.boldFirst }));
          const lrows = (legacy.rows || []).map((r) => (Array.isArray(r) ? r : [r]));
          if (legacy.foot && legacy.foot.length) { const footRow = legacy.foot.map((v) => (v == null ? '' : v)); footRow.bold = true; lrows.push(footRow); }
          return api.table(cols, lrows, { headColor: legacy.headColor, boldLast: false });
        }
        const t = topt || {};
        const avail = W - 2 * M, tot = columns.reduce((s, c) => s + (c.w || 1), 0);
        const xs = []; let acc = M;
        columns.forEach((c) => { xs.push(acc); acc += avail * (c.w || 1) / tot; });
        const widths = columns.map((c) => avail * (c.w || 1) / tot);
        const rh = 6.2;
        const head = () => {
          need(rh * 2); const { ctx, px } = cur;
          ctx.fillStyle = t.headColor || '#1e3a8a'; ctx.fillRect(px(M), px(y), px(avail), px(rh));
          ctx.fillStyle = '#fff'; font(2.9, 700);
          columns.forEach((c, i) => { const txt = String(c.h || ''); const w = ctx.measureText(txt).width; const x = c.align === 'right' ? xs[i] + widths[i] - 1.5 - w / px(1) : xs[i] + 1.5; ctx.fillText(txt, px(x), px(y + 4.2)); });
          y += rh;
        };
        head();
        rows.forEach((r, ri) => {
          if (y + rh > H - 12) { newPage(); head(); }
          const { ctx, px } = cur;
          if (ri % 2) { ctx.fillStyle = '#f1f5f9'; ctx.fillRect(px(M), px(y), px(avail), px(rh)); }
          const bold = r.bold || (t.boldLast && ri === rows.length - 1);
          ctx.fillStyle = '#0f172a'; font(2.9, bold ? 800 : 500);
          columns.forEach((c, i) => {
            let txt = String(r[i] == null ? '' : r[i]);
            const maxW = px(widths[i] - 3);
            const lines = wrap(ctx, txt, maxW).slice(0, 2);
            const lineH = 3.0;
            lines.forEach((line, li) => {
              const w = ctx.measureText(line).width;
              const x = c.align === 'right' ? xs[i] + widths[i] - 1.5 - w / px(1) : xs[i] + 1.5;
              ctx.fillText(line, px(x), px(y + 3.0 + li * lineH));
            });
          });
          y += rh;
        });
        y += 3; return api;
      },
      gap(mm) { y += mm || 3; return api; },
      /** v3.34 — legacy alias: footer(text) finish() ke footer me chala jata hai. */
      footer(text) { storedFooter = String(text || ''); return api; },
      finish(footer) {
        if (!pages.length) newPage();
        const foot = footer || storedFooter || brand;
        pages.forEach((p, i) => {
          const { ctx, px } = p;
          ctx.fillStyle = '#94a3b8'; ctx.font = `400 ${px(2.7)}px ${FONT}`;
          ctx.fillText(`${foot} · page ${i + 1}/${pages.length}`, px(M), px(H - 6));
        });
        // v3.34 — Blob seedha return (pehle canvases array aata tha; purane callers FF.pdf.download(doc.finish()) karte hain)
        return build(pages.map((p) => p.canvas));
      }
    };
    newPage();
    // v3.34 — opts me title/subtitle/right/meta diye hain to page 1 par khud render karo
    // (legacy callers doc({ title, subtitle, right }) dete hain aur title() method khud nahi call karte).
    if (o.title) {
      const subBits = [o.subtitle, o.meta, o.right].filter(Boolean).map(String);
      api.title(String(o.title), subBits.join(' · '));
    }
    return api;
  }

  FF.pdf = { build, download, share, page, wrap, doc, FONT };
})(window.FF || (window.FF = {}));
