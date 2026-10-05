/* Tiny dependency-free chart kit: vertical bars (stacked), horizontal bars, line charts (SVG), donuts (SVG). */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;
  const PALETTE = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#0ea5e9', '#8b5cf6', '#f97316', '#14b8a6', '#ef4444', '#84cc16', '#06b6d4', '#d946ef', '#64748b'];
  const COLORS = {
    VC4: '#6366f1', VC20: '#ec4899', 'VC5+': '#f59e0b', NVC4: '#f59e0b', Commercial: '#f59e0b',
    ISSUANCE: '#10b981', REPLACEMENT: '#f97316',
    'First Forward': '#8b5cf6', 'GV Partner': '#0ea5e9',
    current: '#6366f1', last: '#ec4899',
    ACTIVATED: '#10b981', HOTLISTED: '#ef4444', 'LOW BALANCE': '#f59e0b', ISSUED: '#0ea5e9',
    'With Max': '#6366f1', 'Without max': '#0ea5e9', Chassis: '#f59e0b', 'Wrong VRN': '#ef4444'
  };
  let seq = 0;
  const specs = new Map();

  function color(name, i) { return COLORS[name] || PALETTE[i % PALETTE.length]; }
  function fmtVal(v, f) { return f ? f(v) : U.fmt(v); }
  function niceMax(max) {
    if (!max || max <= 0) return 1;
    const exp = Math.pow(10, Math.floor(Math.log10(max)));
    const n = max / exp;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return step * exp;
  }
  function legend(series) {
    return `<div class="legend">${series.map((s, i) => `<span class="legend-item"><i style="background:${s.color || color(s.name, i)}"></i>${esc(s.name)}</span>`).join('')}</div>`;
  }

  /** Vertical (stacked) bars. opts: { labels, series:[{name, values, color}], height, format, showValues, labelEvery, tips } */
  function bars(opts) {
    const { labels } = opts;
    const series = opts.series.map((s, i) => ({ ...s, color: s.color || color(s.name, i) }));
    const totals = labels.map((_, i) => U.sum(series, (s) => s.values[i] || 0));
    const max = niceMax(Math.max(...totals, 0));
    const height = opts.height || 220;
    const n = labels.length;
    const every = opts.labelEvery || (n > 40 ? 5 : n > 20 ? 2 : 1);
    const showValues = opts.showValues !== undefined ? opts.showValues : n <= 16;
    const cols = labels.map((label, i) => {
      const total = totals[i];
      const segs = series.map((s) => {
        const v = s.values[i] || 0;
        if (v <= 0) return '';
        return `<div class="vseg" style="flex:0 0 ${(v / total) * 100}%;background:${s.color}"></div>`;
      }).join('');
      const tip = opts.tips && opts.tips[i] ? opts.tips[i] : `<b>${esc(opts.tipLabels ? opts.tipLabels[i] : label)}</b><br>${series.length > 1 ? series.map((s) => `<i style="background:${s.color}"></i>${esc(s.name)}: <b>${fmtVal(s.values[i] || 0, opts.format)}</b>`).join('<br>') + '<br>' : ''}Total: <b>${fmtVal(total, opts.format)}</b>`;
      const hl = opts.highlight === i ? ' hl' : '';
      return `<div class="vcol${hl}" data-tip="${esc(tip)}" ${opts.onClickAttr ? opts.onClickAttr(i) : ''}>
        <div class="vcol-bars">${showValues && total > 0 ? `<div class="vcol-val">${U.fmtShort(total)}</div>` : ''}<div class="vcol-stack" style="height:${max ? Math.max(total > 0 ? 1.5 : 0, (total / max) * 100) : 0}%">${segs}</div></div>
        <div class="vcol-label">${i % every === 0 ? esc(label) : ''}</div></div>`;
    }).join('');
    const grid = [1, 0.75, 0.5, 0.25, 0].map((f) => `<div class="vgrid-line"><span>${U.fmtShort(max * f)}</span></div>`).join('');
    const cid = `ch${++seq}`;
    specs.set(cid, { kind: 'bars', opts: { ...opts, series } });
    return `<div class="chart-shot" data-cid="${cid}"><div class="vbars" style="--h:${height}px"><div class="vbars-plot"><div class="vgrid">${grid}</div><div class="vbars-cols">${cols}</div></div>${series.length > 1 || opts.legendAlways ? legend(series) : ''}</div></div>`;
  }

  /** Horizontal bars. opts: { items:[{label, sub, value, compare, color, tip, attr}], max, format, compareLabel } */
  function hbars(opts) {
    const items = opts.items || [];
    const max = opts.max || Math.max(1, ...items.map((it) => Math.max(it.value || 0, it.compare || 0)));
    const html = `<div class="hbars">${items.map((it, i) => {
      const c = it.color || PALETTE[i % PALETTE.length];
      const w = Math.max(0, ((it.value || 0) / max) * 100);
      const cw = it.compare !== undefined && it.compare !== null ? Math.max(0, (it.compare / max) * 100) : null;
      const g = cw !== null ? U.growth(it.value || 0, it.compare) : null;
      const tip = it.tip || `<b>${esc(it.label)}</b><br>${esc(opts.valueLabel || 'Value')}: <b>${fmtVal(it.value || 0, opts.format)}</b>${cw !== null ? `<br>${esc(opts.compareLabel || 'Compare')}: <b>${fmtVal(it.compare, opts.format)}</b>` : ''}`;
      return `<div class="hbar-row" data-tip="${esc(tip)}" ${it.attr || ''}>
        <div class="hbar-rank">${i + 1}</div>
        <div class="hbar-main"><div class="hbar-head"><span class="hbar-label" title="${esc(it.label)}">${esc(it.label)}</span>${it.sub ? `<span class="hbar-sub">${esc(it.sub)}</span>` : ''}<span class="hbar-value">${fmtVal(it.value || 0, opts.format)}${g !== null ? ` ${U.deltaHtml(g, { decimals: 0 })}` : ''}</span></div>
        <div class="hbar-track">${cw !== null ? `<div class="hbar-compare" style="width:${cw}%"></div>` : ''}<div class="hbar-fill" style="width:${w}%;background:${c}"></div></div></div></div>`;
    }).join('')}${items.length === 0 ? '<div class="empty">No data</div>' : ''}</div>`;
    const cid = `ch${++seq}`;
    specs.set(cid, { kind: 'hbars', opts });
    return `<div class="chart-shot" data-cid="${cid}">${html}</div>`;
  }

  /** Donut. opts: { items:[{label, value, color}], size, title, subtitle, format } */
  function donut(opts) {
    const items = (opts.items || []).filter((it) => it.value > 0);
    const total = U.sum(items, (it) => it.value);
    const size = opts.size || 170;
    const r = 42, cx = 50, cy = 50, circ = 2 * Math.PI * r;
    let offset = 0;
    const segs = items.map((it, i) => {
      const frac = total ? it.value / total : 0;
      const len = frac * circ;
      const seg = `<circle r="${r}" cx="${cx}" cy="${cy}" fill="none" stroke="${it.color || color(it.label, i)}" stroke-width="14" stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" data-tip="${esc(`<b>${it.label}</b><br>${fmtVal(it.value, opts.format)} · ${U.fmtPct(frac * 100)}`)}" ${it.attr || ''}></circle>`;
      offset += len;
      return seg;
    }).join('');
    const legendHtml = items.map((it, i) => `<div class="donut-leg" ${it.attr || ''}><i style="background:${it.color || color(it.label, i)}"></i><span class="donut-leg-label">${esc(it.label)}</span><b>${fmtVal(it.value, opts.format)}</b><span class="donut-leg-pct">${U.fmtPct(total ? (it.value / total) * 100 : 0)}</span></div>`).join('');
    const cid = `ch${++seq}`;
    specs.set(cid, { kind: 'donut', opts: { ...opts, items, total } });
    return `<div class="chart-shot" data-cid="${cid}"><div class="donut"><div class="donut-ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 100 100" width="${size}" height="${size}" style="transform:rotate(-90deg)"><circle r="${r}" cx="${cx}" cy="${cy}" fill="none" stroke="#eef0f6" stroke-width="14"></circle>${segs}</svg>
      <div class="donut-center"><b>${esc(opts.title !== undefined ? opts.title : U.fmtShort(total))}</b><span>${esc(opts.subtitle || 'Total')}</span></div></div>
      <div class="donut-legend">${legendHtml || '<div class="empty">No data</div>'}</div></div></div>`;
  }

  /** Line chart placeholder; drawn by mount() with real width. opts: { labels, series:[{name, values, color, dash, area}], height, format, tipLabels } */
  function lines(opts) {
    const id = `ch${++seq}`;
    specs.set(id, { kind: 'lines', opts });
    return `<div class="chart-shot chart-line" data-cid="${id}" data-chart="${id}" style="height:${(opts.height || 240) + (opts.series.length > 1 ? 28 : 0)}px"></div>`;
  }
  function drawLine(el, opts) {
    const W = Math.max(280, el.clientWidth || 640);
    const H = opts.height || 240;
    const L = 46, R = 14, T = 14, B = 26;
    const series = opts.series.map((s, i) => ({ ...s, color: s.color || color(s.name, i) }));
    const n = opts.labels.length;
    const allVals = series.flatMap((s) => s.values.filter((v) => v !== null && v !== undefined));
    const max = niceMax(Math.max(...allVals, 0));
    const x = (i) => L + (n > 1 ? (i / (n - 1)) * (W - L - R) : (W - L - R) / 2);
    const y = (v) => T + (H - T - B) * (1 - v / max);
    const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${y(max * f).toFixed(1)}" y2="${y(max * f).toFixed(1)}" class="grid"></line><text x="${L - 6}" y="${(y(max * f) + 4).toFixed(1)}" class="ylab" text-anchor="end">${U.fmtShort(max * f)}</text>`).join('');
    const every = n > 40 ? 5 : n > 20 ? 2 : 1;
    const xlabels = opts.labels.map((lab, i) => (i % every === 0 ? `<text x="${x(i).toFixed(1)}" y="${H - 8}" class="xlab" text-anchor="middle">${esc(lab)}</text>` : '')).join('');
    let defs = '';
    const paths = series.map((s, si) => {
      const pts = s.values.map((v, i) => (v === null || v === undefined ? null : [x(i), y(v)]));
      let d = '', started = false;
      pts.forEach((p) => { if (!p) { started = false; return; } d += `${started ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)} `; started = true; });
      const gid = `g${seq}_${si}`;
      defs += `<linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="${s.color}" stop-opacity="0.28"></stop><stop offset="100%" stop-color="${s.color}" stop-opacity="0"></stop></linearGradient>`;
      const valid = pts.filter(Boolean);
      const area = s.area !== false && valid.length > 1 ? `<path d="M${valid[0][0].toFixed(1)},${(H - B).toFixed(1)} ${valid.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} L${valid[valid.length - 1][0].toFixed(1)},${(H - B).toFixed(1)} Z" fill="url(#${gid})"></path>` : '';
      const dots = pts.map((p, i) => (p ? `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${n > 40 ? 2.2 : 3.4}" fill="#fff" stroke="${s.color}" stroke-width="2" data-tip="${esc(`<b>${(opts.tipLabels || opts.labels)[i]}</b><br>${series.map((ss) => `<i style="background:${ss.color}"></i>${ss.name}: <b>${ss.values[i] === null || ss.values[i] === undefined ? '—' : fmtVal(ss.values[i], opts.format)}</b>`).join('<br>')}`)}"></circle>` : '')).join('');
      return `${area}<path d="${d.trim()}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? 'stroke-dasharray="6 5"' : ''}></path>${dots}`;
    }).join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="linesvg"><defs>${defs}</defs>${grid}${xlabels}${paths}</svg>${series.length > 1 ? legend(series) : ''}`;
  }
  function mount(root) {
    U.$$('[data-chart]', root || document).forEach((el) => {
      const spec = specs.get(el.getAttribute('data-chart'));
      if (spec) drawLine(el, spec.opts || spec);
    });
  }
  window.addEventListener('resize', U.debounce(() => mount(document), 150));

  /** Sparkline (inline svg) */
  function spark(values, colorHex) {
    const max = Math.max(1, ...values);
    const w = 6, gap = 1.5, hgt = 22;
    return `<svg class="spark" viewBox="0 0 ${values.length * (w + gap)} ${hgt}" width="${values.length * (w + gap)}" height="${hgt}">${values.map((v, i) => `<rect x="${i * (w + gap)}" y="${(hgt - Math.max(1.5, (v / max) * hgt)).toFixed(1)}" width="${w}" height="${Math.max(1.5, (v / max) * hgt).toFixed(1)}" rx="1.2" fill="${colorHex || '#6366f1'}" opacity="${i === values.length - 1 ? 1 : 0.55}"></rect>`).join('')}</svg>`;
  }

  // ---- PNG export (canvas re-render, white background, 2x for crisp sharing) --------------------
  function pngCanvas(W, H) {
    const c = document.createElement('canvas');
    c.width = W * 2; c.height = H * 2;
    const ctx = c.getContext('2d');
    ctx.scale(2, 2);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    return { c, ctx };
  }
  const PNG_INK = '#334155', PNG_DIM = '#94a3b8', PNG_GRID = '#e2e8f0';
  function truncText(ctx, text, max) {
    let t = String(text ?? '');
    while (t.length > 2 && ctx.measureText(t).width > max) t = t.slice(0, -2);
    return t.length < String(text ?? '').length ? `${t}…` : t;
  }
  function pngBars(ctx, opts, W, H) {
    const series = opts.series || [];
    const labels = opts.labels || [];
    const totals = labels.map((_, i) => U.sum(series, (s) => s.values[i] || 0));
    const max = niceMax(Math.max(...totals, 0));
    const L = 46, R = 12, T = 16, B = 30, LH = series.length > 1 ? 22 : 0;
    const pw = W - L - R, ph = H - T - B - LH;
    ctx.font = '10px Inter, sans-serif'; ctx.fillStyle = PNG_DIM;
    [1, 0.75, 0.5, 0.25, 0].forEach((f) => {
      const y = T + ph * (1 - f);
      ctx.strokeStyle = PNG_GRID; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - R, y); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(U.fmtShort(max * f), L - 5, y + 3);
    });
    const n = Math.max(1, labels.length);
    const bw = Math.min(46, (pw / n) * 0.62);
    const every = opts.labelEvery || (n > 40 ? 5 : n > 20 ? 2 : 1);
    labels.forEach((label, i) => {
      const x = L + (pw / n) * (i + 0.5);
      let yBase = T + ph;
      series.forEach((s) => {
        const v = s.values[i] || 0;
        if (v <= 0) return;
        const hpx = (v / max) * ph;
        ctx.fillStyle = s.color;
        ctx.fillRect(x - bw / 2, yBase - hpx, bw, hpx);
        yBase -= hpx;
      });
      if (i % every === 0) { ctx.fillStyle = PNG_DIM; ctx.textAlign = 'center'; ctx.fillText(truncText(ctx, label, pw / n + 8), x, T + ph + 14); }
    });
    if (LH) {
      let lx = L; const ly = H - 8;
      ctx.textAlign = 'left';
      series.forEach((s) => {
        ctx.fillStyle = s.color; ctx.fillRect(lx, ly - 8, 9, 9);
        ctx.fillStyle = PNG_INK; ctx.fillText(s.name, lx + 13, ly);
        lx += 13 + ctx.measureText(s.name).width + 16;
      });
    }
  }
  function pngLines(ctx, opts, W, H) {
    const series = opts.series || [];
    const labels = opts.labels || [];
    const n = labels.length;
    const L = 46, R = 14, T = 14, B = 26;
    const allVals = series.flatMap((s) => s.values.filter((v) => v !== null && v !== undefined));
    const max = niceMax(Math.max(...allVals, 0));
    const x = (i) => L + (n > 1 ? (i / (n - 1)) * (W - L - R) : (W - L - R) / 2);
    const y = (v) => T + (H - T - B) * (1 - v / max);
    ctx.font = '10px Inter, sans-serif';
    [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
      ctx.strokeStyle = PNG_GRID; ctx.beginPath(); ctx.moveTo(L, y(max * f)); ctx.lineTo(W - R, y(max * f)); ctx.stroke();
      ctx.fillStyle = PNG_DIM; ctx.textAlign = 'right'; ctx.fillText(U.fmtShort(max * f), L - 5, y(max * f) + 3);
    });
    const every = n > 40 ? 5 : n > 20 ? 2 : 1;
    labels.forEach((lab, i) => { if (i % every === 0) { ctx.fillStyle = PNG_DIM; ctx.textAlign = 'center'; ctx.fillText(truncText(ctx, lab, (W - L - R) / Math.max(1, n / every) + 6), x(i), H - 8); } });
    series.forEach((s) => {
      ctx.strokeStyle = s.color; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.beginPath();
      let started = false;
      s.values.forEach((v, i) => {
        if (v === null || v === undefined) { started = false; return; }
        if (!started) { ctx.moveTo(x(i), y(v)); started = true; } else ctx.lineTo(x(i), y(v));
      });
      ctx.stroke();
      s.values.forEach((v, i) => {
        if (v === null || v === undefined) return;
        ctx.beginPath(); ctx.arc(x(i), y(v), 2.6, 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = s.color; ctx.lineWidth = 1.8; ctx.stroke();
      });
    });
    if (series.length > 1) {
      let lx = L; const ly = H - 24;
      series.forEach((s) => { ctx.fillStyle = s.color; ctx.fillRect(lx, ly - 8, 9, 3); ctx.fillStyle = PNG_INK; ctx.textAlign = 'left'; ctx.fillText(s.name, lx + 13, ly - 3); lx += 13 + ctx.measureText(s.name).width + 18; });
    }
  }
  function pngDonut(ctx, opts, W, H) {
    const items = opts.items || [];
    const total = opts.total || U.sum(items, (it) => it.value);
    const cx = 110, cy = H / 2, r = Math.min(86, H / 2 - 18);
    ctx.lineWidth = 26; ctx.strokeStyle = '#eef0f6';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    let angle = -Math.PI / 2;
    items.forEach((it, i) => {
      const frac = total ? it.value / total : 0;
      if (frac <= 0) return;
      ctx.strokeStyle = it.color || color(it.label, i);
      ctx.beginPath(); ctx.arc(cx, cy, r, angle, angle + frac * Math.PI * 2); ctx.stroke();
      angle += frac * Math.PI * 2;
    });
    ctx.fillStyle = PNG_INK; ctx.textAlign = 'center'; ctx.font = '700 22px Inter, sans-serif';
    ctx.fillText(opts.title !== undefined ? String(opts.title) : U.fmtShort(total), cx, cy + 2);
    ctx.font = '11px Inter, sans-serif'; ctx.fillStyle = PNG_DIM;
    ctx.fillText(opts.subtitle || 'Total', cx, cy + 18);
    let ly = Math.max(24, cy - items.length * 11);
    ctx.textAlign = 'left';
    items.forEach((it, i) => {
      ctx.fillStyle = it.color || color(it.label, i); ctx.fillRect(230, ly - 9, 10, 10);
      ctx.fillStyle = PNG_INK; ctx.font = '12px Inter, sans-serif';
      ctx.fillText(truncText(ctx, it.label, W - 380), 246, ly);
      ctx.font = '700 12px Inter, sans-serif';
      const val = fmtVal(it.value, opts.format);
      ctx.fillText(val, W - 130, ly);
      ctx.font = '11px Inter, sans-serif'; ctx.fillStyle = PNG_DIM;
      ctx.fillText(U.fmtPct(total ? (it.value / total) * 100 : 0), W - 62, ly);
      ly += 22;
    });
  }
  function pngHbars(ctx, opts, W, H) {
    const items = opts.items || [];
    const max = opts.max || Math.max(1, ...items.map((it) => Math.max(it.value || 0, it.compare || 0)));
    const rowH = Math.min(38, (H - 12) / Math.max(1, items.length));
    items.forEach((it, i) => {
      const y = 8 + i * rowH;
      ctx.font = '10px Inter, sans-serif'; ctx.fillStyle = PNG_DIM; ctx.textAlign = 'left';
      ctx.fillText(String(i + 1), 8, y + rowH / 2 + 3);
      ctx.font = '12px Inter, sans-serif'; ctx.fillStyle = PNG_INK;
      ctx.fillText(truncText(ctx, it.label, 180), 24, y + rowH / 2 + 4);
      const trackX = 214, trackW = W - trackX - 120;
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(trackX, y + rowH / 2 - 5, trackW, 10);
      if (it.compare !== undefined && it.compare !== null) {
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(trackX, y + rowH / 2 - 5, trackW * Math.max(0, it.compare / max), 10);
      }
      ctx.fillStyle = it.color || PALETTE[i % PALETTE.length];
      ctx.fillRect(trackX, y + rowH / 2 - 5, trackW * Math.max(0, (it.value || 0) / max), 10);
      ctx.font = '700 12px Inter, sans-serif'; ctx.textAlign = 'right'; ctx.fillStyle = PNG_INK;
      ctx.fillText(fmtVal(it.value || 0, opts.format), W - 12, y + rowH / 2 + 4);
    });
  }
  /** Render chart `cid` to a PNG and download it. */
  function download(cid, filename) {
    const spec = specs.get(cid);
    if (!spec) return;
    const opts = spec.opts || spec;
    let W = 760, H = 400;
    if (spec.kind === 'bars') H = Math.max(260, (opts.height || 220) + 70);
    if (spec.kind === 'lines') H = Math.max(260, (opts.height || 240) + 60);
    if (spec.kind === 'hbars') H = Math.max(120, (opts.items || []).length * 38 + 20);
    if (spec.kind === 'donut') { W = 560; H = Math.max(200, Math.max(170, (opts.size || 170) + 30), ((opts.items || []).length * 22) + 40); }
    const { c, ctx } = pngCanvas(W, H);
    ctx.fillStyle = PNG_INK; ctx.font = '700 13px Inter, sans-serif'; ctx.textAlign = 'left';
    try {
      if (spec.kind === 'bars') pngBars(ctx, opts, W, H);
      else if (spec.kind === 'lines') pngLines(ctx, opts, W, H);
      else if (spec.kind === 'donut') pngDonut(ctx, opts, W, H);
      else if (spec.kind === 'hbars') pngHbars(ctx, opts, W, H);
      else return;
    } catch (err) { console.error('chart png', err); if (U.toast) U.toast('Chart PNG nahi ban paya', 'err'); return; }
    const name = `${filename || 'chart'}.png`;
    if (c.toBlob) c.toBlob((b) => U.downloadBlob(name, b), 'image/png');
    else U.downloadBlob(name, new Blob([c.toDataURL('image/png')], { type: 'image/png' }));
  }

  FF.charts = { PALETTE, COLORS, color, bars, hbars, donut, lines, mount, legend, spark, download };
})(window.FF);
