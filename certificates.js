/* 🏆 FASTag Champions — monthly champion certificates.
   Pure HTML builders + print helper (print dialog → "Save as PDF" → certificate PDF).
   insights.js se data aata hai (board rows, category, channel); yahan sirf rendering hai.
   Print CSS self-contained hai — styles.css par depend nahi karta. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';

  const RANKS = [
    { medal: '🥇', title: 'CHAMPION' },
    { medal: '🥈', title: 'RUNNER-UP' },
    { medal: '🥉', title: '2nd RUNNER-UP' }
  ];

  /** Board rows se top-N certificate entries — khud metric par sort karta hai (caller ranked ho ya na ho). */
  function topRows(rows, metric, n) {
    const val = (r) => Number(r[metric] != null ? r[metric] : r.total) || 0;
    return (rows || []).slice().sort((a, b) => val(b) - val(a)).slice(0, n || 3).map((r, i) => ({
      rank: i + 1,
      medal: (RANKS[i] || { medal: `#${i + 1}`, title: `RANK ${i + 1}` }).medal,
      title: (RANKS[i] || { title: `RANK ${i + 1}` }).title,
      name: String(r.name || '—'),
      id: String(r.id || ''),
      tl: String(r.tl || r.tlName || 'Direct'),
      value: val(r)
    }));
  }

  const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  /** Ek certificate ka A4-landscape page. o = { name, id, tl, rank, medal, title, value, category, channel, monthLabel, brand, isTl } */
  function page(o) {
    const rank = RANKS[o.rank - 1] || { medal: `#${o.rank}`, title: `RANK ${o.rank}` };
    const role = o.isTl ? 'Team Leader' : 'Agent';
    return `<section class="cert">
      <div class="cert-frame">
        <div class="cert-brand">${escHtml(o.brand || 'First Forward')} <span>· FASTag Champions</span></div>
        <h1 class="cert-title">Certificate of Achievement</h1>
        <p class="cert-sub">Ye pramaan-patra pradan kiya jata hai</p>
        <div class="cert-name">${escHtml(o.name)}</div>
        <p class="cert-line">${escHtml(role)} · ${escHtml(o.channel || '')} channel · ID <b>${escHtml(o.id || '—')}</b><br>
          ne <b>${escHtml(o.monthLabel || '')}</b> me <b>${escHtml(o.category || 'Top Issuance')}</b> category me<br>
          <b class="cert-count">${Number(o.value || 0).toLocaleString('en-IN')}</b> FASTag issue karke</p>
        <div class="cert-rank"><span class="cert-medal">${rank.medal}</span> RANK #${o.rank} — ${escHtml(rank.title)}</div>
        <p class="cert-line dim">Reporting TL: <b>${escHtml(o.tl || 'Direct')}</b></p>
        <div class="cert-foot">
          <span>Issued: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          <span class="cert-seal">🏆</span>
          <span>Team ${escHtml(o.brand || 'First Forward')}</span>
        </div>
      </div>
    </section>`;
  }

  const CSS = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: A4 landscape; margin: 0; }
    body { background: #e8e4da; font-family: Georgia, 'Times New Roman', serif; }
    .cert { width: 297mm; height: 210mm; padding: 12mm; background: #e8e4da; page-break-after: always; }
    .cert:last-child { page-break-after: auto; }
    .cert-frame { position: relative; width: 100%; height: 100%; background: #fdfaf1; border: 3px solid #b8860b; outline: 1px solid #b8860b; outline-offset: 6px; border-radius: 4mm; padding: 16mm 20mm; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; background-image: radial-gradient(circle at 12% 10%, rgba(184,134,11,.07) 0 18mm, transparent 19mm), radial-gradient(circle at 88% 90%, rgba(184,134,11,.07) 0 18mm, transparent 19mm); }
    .cert-brand { position: absolute; top: 9mm; left: 0; right: 0; letter-spacing: .35em; font-size: 13px; color: #8a6d1d; text-transform: uppercase; }
    .cert-brand span { color: #b0a37f; letter-spacing: .2em; }
    .cert-title { font-size: 42px; color: #1f2a44; margin-bottom: 4mm; }
    .cert-sub { font-size: 15px; color: #6b6350; font-style: italic; margin-bottom: 8mm; }
    .cert-name { font-size: 52px; font-weight: bold; color: #7a5c07; border-top: 2px solid #d9c27a; border-bottom: 2px solid #d9c27a; padding: 4mm 18mm; margin-bottom: 7mm; max-width: 90%; }
    .cert-line { font-size: 17px; color: #3c3a33; line-height: 1.7; }
    .cert-line.dim { color: #7a7466; font-size: 14px; margin-top: 3mm; }
    .cert-count { font-size: 24px; color: #1f2a44; }
    .cert-rank { margin: 7mm 0 2mm; font-size: 20px; letter-spacing: .18em; color: #8a1c1c; background: #f6ecd2; border: 1px solid #d9c27a; border-radius: 999px; padding: 3mm 12mm; }
    .cert-medal { font-size: 26px; }
    .cert-foot { position: absolute; bottom: 9mm; left: 16mm; right: 16mm; display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: #6b6350; border-top: 1px solid #e4d9b8; padding-top: 4mm; }
    .cert-seal { font-size: 30px; filter: drop-shadow(0 1px 1px rgba(0,0,0,.25)); }
    @media print { body { background: #fdfaf1; } .cert { width: auto; height: 100vh; } }`;

  /** Sab certificates ka full printable document. */
  function doc(pages, title) {
    return `<!DOCTYPE html><html lang="hi"><head><meta charset="utf-8"><title>${escHtml(title || 'Champion Certificates')}</title><style>${CSS}</style></head><body>${(pages || []).join('')}</body></html>`;
  }

  /** Print window kholo (popup block ho to hidden iframe fallback) — user "Save as PDF" choose kare. */
  function print(html, title) {
    let w = null;
    try { w = window.open('', '_blank', 'width=1150,height=800'); } catch { w = null; }
    if (w) {
      try {
        w.document.open(); w.document.write(html); w.document.close();
      } catch { /* ignore */ }
      setTimeout(() => { try { w.focus(); w.print(); } catch { /* user prints manually */ } }, 600);
      return 'window';
    }
    try {
      const f = document.createElement('iframe');
      f.setAttribute('aria-hidden', 'true');
      f.title = title || 'Certificate print';
      f.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0;';
      document.body.appendChild(f);
      f.srcdoc = html;
      f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { /* blocked */ } setTimeout(() => f.remove(), 90000); };
      return 'iframe';
    } catch { return null; }
  }

  FF.certificates = { topRows, page, doc, print, RANKS };
})(window.FF);
