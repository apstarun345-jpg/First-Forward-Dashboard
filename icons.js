/* v3.125.419 — 🧱 line-icon set (24px, stroke = currentColor). FF.icons.get('home', 18) → SVG string. Emoji optional. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const P = {
    home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
    search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5',
    box: 'M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8',
    tag: 'M3 12V4h8l10 10-8 8L3 12zM7.5 8.5h.01',
    users: 'M16 20v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM17 11a3 3 0 100-6M21 20v-1a4 4 0 00-3-3.9',
    chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
    bell: 'M6 9a6 6 0 1112 0c0 6 2 7 2 7H4s2-1 2-7zM10 20a2 2 0 004 0',
    settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 .7a7 7 0 00-1.7-1L15 4h-4l-.3 2.7a7 7 0 00-1.7 1L7 7l-2 4 2 1a7 7 0 000 2l-2 1 2 4 2-.7a7 7 0 001.7 1L11 22h4l.3-2.7a7 7 0 001.7-1L19 19l2-4-2-1a7 7 0 000-2z',
    star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z',
    check: 'M5 12l5 5 9-10',
    alert: 'M12 3l10 18H2L12 3zM12 10v5M12 18h.01',
    arrow: 'M5 12h14M13 6l6 6-6 6',
    download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
    copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
    moon: 'M20 14.5A8.5 8.5 0 119.5 4a7 7 0 0010.5 10.5z',
    sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
    filter: 'M3 5h18l-7 8v6l-4-2v-4L3 5z',
    trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3',
    globe: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
    palette: 'M12 3a9 9 0 100 18c1.5 0 2-1 1.5-2s0-2 1.5-2h2a3 3 0 003-3c0-5-4.5-11-8-11zM7.5 11h.01M10 7.5h.01M14 7.5h.01',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    a11y: 'M12 5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM4 8l8 1.5L20 8M12 9.5V15M9 21l3-6 3 6',
    target: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 16a4 4 0 100-8 4 4 0 000 8zM12 12h.01',
    refresh: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
    dots: 'M5 12h.01M12 12h.01M19 12h.01',
    half: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 3v18M12 3a9 9 0 010 18z'
  };
  const get = (name, size) => {
    const d = P[name]; if (!d) return '';
    const s = Number(size) || 18;
    return `<svg class="ff-ico" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  };
  FF.icons = { get, names: Object.keys(P) };
  // v3.125.509 — topbar: emoji (🌐🎨▦🌙♿🎯↻☆🔍⋯🔔) ki jagah ek jaise line-SVG icons. Emoji text se pehchan (app.js theme glyph ko bhi sambhalta hai).
  const EMOJI_TO_ICON = { '🌐': 'globe', '🎨': 'palette', '▦': 'grid', '≡': 'grid', '☰': 'grid', '🌙': 'moon', '☀️': 'sun', '🌓': 'half', '♿': 'a11y', '🎯': 'target', '↻': 'refresh', '☆': 'star', '🔍': 'search', '⋯': 'dots', '🔔': 'bell' };
  FF.icons.fromEmoji = (txt, size) => { const n = EMOJI_TO_ICON[String(txt || '').trim()]; return n ? get(n, size || 18) : ''; };
  function swapTopbar() {
    try {
      document.querySelectorAll('#top-actions .icon-btn').forEach((b) => {
        if (b.querySelector('svg.ff-ico')) return;
        const first = b.firstChild;
        if (!first || first.nodeType !== 3) return;           // sirf text/emoji wale button (bell ka count span bacha rahega)
        const svg = FF.icons.fromEmoji(first.nodeValue, 18); if (!svg) return;
        const tpl = document.createElement('template'); tpl.innerHTML = svg;
        b.replaceChild(tpl.content.firstChild, first);
        b.classList.add('ico-svg');
      });
    } catch { /* cosmetic only */ }
  }
  FF.icons.swapTopbar = swapTopbar;
  swapTopbar();
})(window.FF);
