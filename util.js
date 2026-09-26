/* Shared helpers: formatting, dates, DOM, CSV export, toast, tooltip. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';

  const fmtInt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  const fmtDec1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
  const fmtDec2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function clean(text) { return String(text ?? '').trim(); }

  function num(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const text = String(value).replace(/[,\s%₹]/g, '').trim();
    if (!text || text === '-' || text === '—' || /^na$/i.test(text)) return null;
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }
  function fmt(value, decimals) {
    const n = typeof value === 'number' ? value : num(value);
    if (n === null || !Number.isFinite(n)) return '—';
    if (decimals === 2) return fmtDec2.format(n);
    if (decimals) return fmtDec1.format(n);
    return fmtInt.format(n);
  }
  function fmtShort(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e7) return (n / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr';
    if (a >= 1e5) return (n / 1e5).toFixed(2).replace(/\.?0+$/, '') + ' L';
    if (a >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return fmtInt.format(n);
  }
  function pctOf(part, total) {
    if (!total) return null;
    return (part / total) * 100;
  }
  function growth(current, previous) {
    if (previous === null || previous === undefined || !previous) return null;
    return ((current - previous) / Math.abs(previous)) * 100;
  }
  function fmtPct(p, decimals) {
    if (p === null || p === undefined || !Number.isFinite(p)) return '—';
    return `${p.toFixed(decimals === undefined ? 1 : decimals)}%`;
  }
  function fmtSigned(p, decimals) {
    if (p === null || p === undefined || !Number.isFinite(p)) return '—';
    const d = decimals === undefined ? 1 : decimals;
    return `${p > 0 ? '+' : ''}${p.toFixed(d)}%`;
  }
  function deltaHtml(p, opts) {
    const o = opts || {};
    if (p === null || p === undefined || !Number.isFinite(p)) return `<span class="delta flat">— ${esc(o.suffix || '')}</span>`;
    const cls = p > 0.05 ? 'up' : p < -0.05 ? 'down' : 'flat';
    const arrow = cls === 'up' ? '▲' : cls === 'down' ? '▼' : '•';
    return `<span class="delta ${cls}">${arrow} ${fmtSigned(p, o.decimals)} ${esc(o.suffix || '')}</span>`;
  }

  // ---- dates -----------------------------------------------------------------
  const pad2 = (n) => String(n).padStart(2, '0');
  function monthIndex(name) {
    const n = clean(name).toLowerCase().slice(0, 3);
    return MONTHS.findIndex((m) => m.toLowerCase() === n);
  }
  function parseDate(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return isNaN(value) ? null : value;
    const s = clean(value);
    let m;
    if ((m = s.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})/))) return new Date(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/))) return new Date(+m[1], +m[2] - 1, +m[3]);
    if ((m = s.match(/^(\d{1,2})[-/ .]([A-Za-z]{3,9})[-/ .,]*(\d{2,4})?/))) {
      const mi = monthIndex(m[2]);
      if (mi >= 0) {
        let y = m[3] ? +m[3] : new Date().getFullYear();
        if (y < 100) y += 2000;
        return new Date(y, mi, +m[1]);
      }
    }
    if ((m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/))) {
      const mi = monthIndex(m[1]);
      if (mi >= 0) return new Date(+m[3], mi, +m[2]);
    }
    if ((m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})(?:[ T].*)?$/))) {
      let y = +m[3]; if (y < 100) y += 2000;
      return new Date(y, +m[2] - 1, +m[1]); // dd-mm-yyyy (Indian format)
    }
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }
  // "September26" / "Sep-26" / "2026-09" → "2026-09"
  function parseMonthKey(value) {
    const s = clean(value);
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})$/))) return `${m[1]}-${pad2(+m[2])}`;
    if ((m = s.match(/^([A-Za-z]{3,9})[-\s']?(\d{2,4})$/))) {
      const mi = monthIndex(m[1]);
      if (mi < 0) return null;
      let y = +m[2]; if (y < 100) y += 2000;
      return `${y}-${pad2(mi + 1)}`;
    }
    const d = parseDate(s);
    return d ? ymKey(d) : null;
  }
  function ymKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
  function dateKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function fromDateKey(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }
  function ymParts(key) { const [y, m] = key.split('-').map(Number); return { y, m }; }
  function labelYM(key, long) {
    if (!key) return '—';
    const { y, m } = ymParts(key);
    return `${(long ? MONTHS_LONG : MONTHS)[m - 1]} ${y}`;
  }
  function labelDate(d, withYear) {
    if (!d) return '—';
    return `${pad2(d.getDate())} ${MONTHS[d.getMonth()]}${withYear ? ' ' + d.getFullYear() : ''}`;
  }
  function labelDateKey(key, withYear) { return labelDate(fromDateKey(key), withYear); }
  function weekday(d) { return DAYS[d.getDay()]; }
  function daysInMonth(key) { const { y, m } = ymParts(key); return new Date(y, m, 0).getDate(); }
  function prevMonthKey(key) { const { y, m } = ymParts(key); return m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`; }
  function nextMonthKey(key) { const { y, m } = ymParts(key); return m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`; }
  // ISO-week Monday for a date
  function weekStart(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - day);
    return x;
  }
  function timeLabel(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  // ---- collections -----------------------------------------------------------
  function sum(list, getter) {
    let total = 0;
    for (const item of list) { const v = getter ? getter(item) : item; if (typeof v === 'number' && Number.isFinite(v)) total += v; }
    return total;
  }
  function groupSum(list, keyFn, valueFn) {
    const map = new Map();
    for (const item of list) {
      const k = keyFn(item);
      if (k === null || k === undefined || k === '') continue;
      map.set(k, (map.get(k) || 0) + (valueFn ? valueFn(item) : 1));
    }
    return map;
  }
  function topEntries(map, n) {
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n || map.size);
  }
  function sortBy(list, getter, desc) {
    return [...list].sort((a, b) => {
      const x = getter(a), y = getter(b);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x < y ? -1 : 1) * (desc ? -1 : 1);
    });
  }
  function uniq(list) { return [...new Set(list)]; }

  // ---- DOM -------------------------------------------------------------------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return [...(root || document).querySelectorAll(sel)]; }
  function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function debounce(fn, ms) {
    let timer = null;
    return function (...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), ms); };
  }
  function toast(message, kind) {
    let el = $('#toast');
    if (!el) { el = h('<div id="toast" class="toast" hidden></div>'); document.body.appendChild(el); }
    el.textContent = message;
    el.className = `toast ${kind || ''}`;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.hidden = true; }, 3000);
  }
  function spinner(text) {
    return `<div class="loading"><div class="spin"></div><div>${esc(text || 'Loading data from Google Sheet…')}</div></div>`;
  }
  function errorBox(err, retryAttr) {
    const msg = err && err.message ? err.message : String(err);
    return `<div class="error-box"><div class="error-title">⚠️ Data load nahi hua</div><div class="error-msg">${esc(msg)}</div>${retryAttr ? `<button class="btn" ${retryAttr}>Retry</button>` : ''}</div>`;
  }
  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
  }
  function downloadCsv(filename, header, rows) {
    const quote = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [header.map(quote).join(','), ...rows.map((r) => r.map(quote).join(','))].join('\r\n');
    downloadBlob(filename, new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  }
  function tableToRows(table) {
    return [...table.querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => td.textContent.replace(/\s+/g, ' ').trim()));
  }
  function slug(text) { return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export'; }
  function stamp() { return new Date().toISOString().slice(0, 10); }

  // ---- sharing (WhatsApp / email / clipboard) --------------------------------
  function phoneDigits(v) {
    let d = String(v || '').replace(/\D/g, '');
    if (!d || /^na$/i.test(String(v))) return '';
    if (d.length === 10) d = '91' + d;
    if (d.length === 11 && d.startsWith('0')) d = '91' + d.slice(1);
    return d.length >= 11 && d.length <= 15 ? d : '';
  }
  function waLink(text, phone) {
    const p = phoneDigits(phone);
    return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
  }
  function mailLink(subject, body, to) {
    return `mailto:${encodeURIComponent(to || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ } ta.remove(); return ok;
    }
  }

  /** Autocomplete dropdown for a text input.
      suggest(input, { items: () => [{ label, sub, value, kind, badge }], onPick(item), min: 1, max: 12, onClear })
      Items are matched on label/sub/keywords (case-insensitive); Enter picks the highlighted one, Esc closes. */
  function suggest(input, opts) {
    const o = { min: 1, max: 12, ...opts };
    const box = h('<div class="suggest" hidden role="listbox"></div>');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    const holder = input.parentElement;
    if (holder && getComputedStyle(holder).position === 'static') holder.style.position = 'relative';
    (holder || document.body).appendChild(box);
    let list = [], active = -1;
    const norm = (s) => String(s || '').toLowerCase();
    function close() { box.hidden = true; active = -1; }
    function render() {
      if (!list.length) { box.innerHTML = `<div class="suggest-empty">Koi match nahi</div>`; box.hidden = false; return; }
      box.innerHTML = list.map((it, i) => `<div class="suggest-item ${i === active ? 'on' : ''}" data-i="${i}" role="option"><span class="suggest-kind ${esc(it.kind || '')}">${esc(it.kindLabel || it.kind || '')}</span><span class="suggest-main"><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>${it.badge ? `<span class="suggest-badge">${esc(it.badge)}</span>` : ''}</div>`).join('');
      box.hidden = false;
    }
    function compute() {
      const q = norm(input.value.trim());
      if (q.length < o.min) { close(); return; }
      const all = typeof o.items === 'function' ? o.items() : o.items || [];
      const starts = [], contains = [];
      for (const it of all) {
        const hay = norm(`${it.label} ${it.sub || ''} ${it.keywords || ''}`);
        if (!hay.includes(q)) continue;
        (norm(it.label).startsWith(q) ? starts : contains).push(it);
        if (starts.length >= o.max) break;
      }
      list = starts.concat(contains).slice(0, o.max);
      active = list.length ? 0 : -1;
      render();
    }
    function pick(i) { const it = list[i]; if (!it) return; input.value = it.inputValue !== undefined ? it.inputValue : it.label; close(); o.onPick && o.onPick(it); }
    input.addEventListener('input', debounce(compute, 80));
    input.addEventListener('focus', () => { if (input.value.trim().length >= o.min) compute(); });
    input.addEventListener('keydown', (e) => {
      if (box.hidden) { if (e.key === 'Enter' && o.onEnter) { o.onEnter(input.value.trim()); } return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(list.length - 1, active + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0) pick(active); else if (o.onEnter) { close(); o.onEnter(input.value.trim()); } }
      else if (e.key === 'Escape') close();
    });
    box.addEventListener('mousedown', (e) => { const it = e.target.closest('.suggest-item'); if (it) { e.preventDefault(); pick(Number(it.dataset.i)); } });
    document.addEventListener('click', (e) => { if (!box.contains(e.target) && e.target !== input) close(); });
    return { close, refresh: compute, destroy: () => box.remove() };
  }
  function colLetter(index) {
    let s = '';
    let i = index + 1;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }
  function colIndex(letter) {
    let n = 0;
    for (const ch of String(letter).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  // Shared tooltip for elements with data-tip
  function initTooltip() {
    const tip = h('<div class="tip" hidden></div>');
    document.body.appendChild(tip);
    let current = null;
    function move(e) {
      const pad = 14;
      let x = e.clientX + pad, y = e.clientY + pad;
      const r = tip.getBoundingClientRect();
      if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
      if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
      tip.style.left = `${x}px`; tip.style.top = `${y}px`;
    }
    document.addEventListener('mouseover', (e) => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (!t) { if (current) { current = null; tip.hidden = true; } return; }
      if (t !== current) { current = t; tip.innerHTML = t.getAttribute('data-tip'); tip.hidden = false; }
      move(e);
    });
    document.addEventListener('mousemove', (e) => { if (current) move(e); });
    document.addEventListener('mouseout', (e) => {
      if (current && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-tip]') === current)) { current = null; tip.hidden = true; }
    });
  }

  FF.util = {
    esc, clean, num, fmt, fmtShort, pctOf, growth, fmtPct, fmtSigned, deltaHtml,
    MONTHS, MONTHS_LONG, DAYS, pad2, parseDate, parseMonthKey, ymKey, dateKey, fromDateKey, ymParts, labelYM, labelDate, labelDateKey,
    weekday, daysInMonth, prevMonthKey, nextMonthKey, weekStart, timeLabel,
    sum, groupSum, topEntries, sortBy, uniq,
    $, $$, h, debounce, toast, spinner, errorBox, downloadBlob, downloadCsv, tableToRows, slug, stamp, colLetter, colIndex, initTooltip,
    phoneDigits, waLink, mailLink, copyText, suggest
  };
})(window.FF);
