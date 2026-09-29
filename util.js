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

  // Consistent async button feedback. Cloud-backed saves can take a few seconds; disabling the
  // button + showing a real spinner makes it clear that the request is progressing (not hung).
  const busyButtons = new WeakMap();
  function setButtonBusy(button, busy, label) {
    if (!button) return false;
    if (busy) {
      if (busyButtons.has(button)) return false;
      busyButtons.set(button, { html: button.innerHTML, disabled: button.disabled, aria: button.getAttribute('aria-busy') });
      button.classList.add('is-busy');
      button.setAttribute('aria-busy', 'true');
      button.disabled = true;
      if (label) button.textContent = label;
      return true;
    }
    const old = busyButtons.get(button);
    if (!old) return false;
    button.innerHTML = old.html;
    button.disabled = old.disabled;
    button.classList.remove('is-busy');
    if (old.aria === null) button.removeAttribute('aria-busy'); else button.setAttribute('aria-busy', old.aria);
    busyButtons.delete(button);
    return true;
  }
  async function withButtonBusy(button, action, label) {
    if (!setButtonBusy(button, true, label || 'Please wait…')) return undefined;
    try { return await (typeof action === 'function' ? action() : action); }
    finally { setButtonBusy(button, false); }
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
      Items are matched on label/sub/keywords (case-insensitive); Enter picks the highlighted one, Esc closes.
      The list is portalled to <body> and anchored outside the input, so it can never cover typed text
      or get clipped by a card/table overflow container. */
  let suggestSeq = 0;
  function suggest(input, opts) {
    const o = { min: 1, max: 12, ...opts };
    const box = h('<div class="suggest" hidden role="listbox" aria-label="Search suggestions"></div>');
    const boxId = `ff-suggest-${++suggestSeq}`;
    box.id = boxId;
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-haspopup', 'listbox');
    input.setAttribute('aria-controls', boxId);
    input.setAttribute('aria-expanded', 'false');
    // Body portal avoids stacking/overflow bugs in cards, drawers and horizontally scrolling tables.
    document.body.appendChild(box);
    let list = [], active = -1, destroyed = false;
    const norm = (s) => String(s || '').toLowerCase();

    function place() {
      if (destroyed || !input.isConnected) return;
      const rect = input.getBoundingClientRect();
      const vw = Math.max(240, window.innerWidth || document.documentElement.clientWidth || 1024);
      const vh = Math.max(240, window.innerHeight || document.documentElement.clientHeight || 768);
      const gap = 8, edge = 8;
      const maxWidth = Math.max(220, vw - edge * 2);
      const width = Math.min(Math.max(rect.width || 0, Math.min(280, maxWidth)), maxWidth);
      const left = Math.max(edge, Math.min(rect.left, vw - width - edge));
      const below = vh - rect.bottom - gap - edge;
      const above = rect.top - gap - edge;
      const openAbove = below < 180 && above > below;
      const available = Math.max(88, openAbove ? above : below);
      box.dataset.placement = openAbove ? 'top' : 'bottom';
      box.style.position = 'fixed';
      box.style.left = `${Math.round(left)}px`;
      box.style.width = `${Math.round(width)}px`;
      box.style.maxHeight = `${Math.round(Math.min(360, available))}px`;
      if (openAbove) {
        box.style.top = 'auto';
        box.style.bottom = `${Math.max(edge, Math.round(vh - rect.top + gap))}px`;
      } else {
        box.style.bottom = 'auto';
        box.style.top = `${Math.min(vh - edge, Math.round(rect.bottom + gap))}px`;
      }
    }
    function close() {
      box.hidden = true; active = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
    function show() { box.hidden = false; input.setAttribute('aria-expanded', 'true'); place(); }
    function render() {
      if (!list.length) {
        active = -1;
        box.innerHTML = '<div class="suggest-empty">Koi match nahi</div>';
        input.removeAttribute('aria-activedescendant');
        show(); return;
      }
      box.innerHTML = list.map((it, i) => `<div id="${boxId}-option-${i}" class="suggest-item ${i === active ? 'on' : ''}" data-i="${i}" role="option" aria-selected="${i === active ? 'true' : 'false'}"><span class="suggest-kind ${esc(it.kind || '')}">${esc(it.kindLabel || it.kind || '')}</span><span class="suggest-main"><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>${it.badge ? `<span class="suggest-badge">${esc(it.badge)}</span>` : ''}</div>`).join('');
      if (active >= 0) input.setAttribute('aria-activedescendant', `${boxId}-option-${active}`);
      else input.removeAttribute('aria-activedescendant');
      show();
      if (active >= 0) requestAnimationFrame(() => box.querySelector('.suggest-item.on')?.scrollIntoView({ block: 'nearest' }));
    }
    function compute() {
      if (destroyed || !input.isConnected) { destroy(); return; }
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
    function pick(i) {
      const it = list[i]; if (!it) return;
      input.value = it.inputValue !== undefined ? it.inputValue : it.label;
      close(); o.onPick && o.onPick(it);
    }
    const onInput = debounce(compute, 80);
    const onFocus = () => { if (input.value.trim().length >= o.min) compute(); };
    const onKeydown = (e) => {
      if (box.hidden) { if (e.key === 'Enter' && o.onEnter) { e.preventDefault(); o.onEnter(input.value.trim()); } return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(list.length - 1, active + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0) pick(active); else if (o.onEnter) { close(); o.onEnter(input.value.trim()); } }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') close();
    };
    const onBlur = () => setTimeout(() => { if (!box.contains(document.activeElement)) close(); }, 0);
    const onBoxMouseDown = (e) => { const it = e.target.closest('.suggest-item'); if (it) { e.preventDefault(); pick(Number(it.dataset.i)); } };
    const outsideClick = (e) => {
      if (!input.isConnected) { destroy(); return; }
      if (!box.contains(e.target) && e.target !== input) close();
    };
    const viewportChange = () => { if (!input.isConnected) destroy(); else if (!box.hidden) place(); };
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      document.removeEventListener('click', outsideClick);
      window.removeEventListener('resize', viewportChange);
      window.removeEventListener('scroll', viewportChange, true);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', viewportChange);
        window.visualViewport.removeEventListener('scroll', viewportChange);
      }
      input.removeEventListener('input', onInput);
      input.removeEventListener('focus', onFocus);
      input.removeEventListener('keydown', onKeydown);
      input.removeEventListener('blur', onBlur);
      box.removeEventListener('mousedown', onBoxMouseDown);
      box.remove();
    }
    input.addEventListener('input', onInput);
    input.addEventListener('focus', onFocus);
    input.addEventListener('keydown', onKeydown);
    input.addEventListener('blur', onBlur);
    box.addEventListener('mousedown', onBoxMouseDown);
    document.addEventListener('click', outsideClick);
    window.addEventListener('resize', viewportChange);
    window.addEventListener('scroll', viewportChange, true);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', viewportChange);
      window.visualViewport.addEventListener('scroll', viewportChange);
    }
    return { close, refresh: compute, reposition: place, destroy };
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

  // ---- date-time parsing (Excel export: real dates instead of text) -------------------------
  const MON_IDX = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12 };
  /** Parse dd/mm/yyyy [hh:mm[:ss]] · yyyy-mm-dd[ hh:mm[:ss]] · dd-MMM-yyyy → Date (local). Null if not a date. */
  function parseDateTime(value) {
    const s = String(value ?? '').trim();
    if (!s || s.length < 6 || s.length > 30 || !/\d/.test(s)) return null;
    let y = 0, mo = 0, d = 0, hh = 0, mi = 0, ss = 0;
    let m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
    if (m) {
      d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000;
      if (mo > 12 && d <= 12) { const t = mo; mo = d; d = t; } // tolerate mm/dd
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      hh = +(m[4] || 0); mi = +(m[5] || 0); ss = +(m[6] || 0);
    } else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s))) {
      y = +m[1]; mo = +m[2]; d = +m[3]; hh = +(m[4] || 0); mi = +(m[5] || 0); ss = +(m[6] || 0);
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    } else if ((m = /^(\d{1,2})[\s/-]+([A-Za-z]{3,4})[\s/-]+(\d{2,4})(?:[ T]+(\d{1,2}):(\d{2}))?$/.exec(s))) {
      d = +m[1]; mo = MON_IDX[m[2].toUpperCase()] || 0; y = +m[3]; if (y < 100) y += 2000;
      if (!mo || d < 1 || d > 31) return null;
      hh = +(m[4] || 0); mi = +(m[5] || 0);
    } else if ((m = /^([A-Za-z]{3,4})[\s/-]+(\d{1,2}),?\s+(\d{2,4})$/.exec(s))) {
      mo = MON_IDX[m[1].toUpperCase()] || 0; d = +m[2]; y = +m[3]; if (y < 100) y += 2000;
      if (!mo || d < 1 || d > 31) return null;
    } else return null;
    if (hh > 23 || mi > 59 || ss > 59) return null;
    const dt = new Date(y, mo - 1, d, hh, mi, ss);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return dt;
  }

  // ---- print / PDF report ---------------------------------------------------------------------
  /** Open a clean print-ready window (browser se "Save as PDF" bhi ho sakta hai). */
  function printReport(opts) {
    const o = opts || {};
    const w = window.open('', '_blank');
    if (!w) { toast('Popup block ho gaya — browser se popup allow karo.', 'err'); return; }
    const brand = (FF.config && FF.config.brand) || 'Dashboard';
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(o.title || 'Report')}</title><style>
      body { font-family: Inter, "Segoe UI", system-ui, sans-serif; color: #0f172a; margin: 28px; font-size: 12.5px; }
      h1 { font-size: 19px; margin: 0 0 2px; } h2 { font-size: 14px; margin: 18px 0 6px; }
      .sub { color: #64748b; margin: 0 0 4px; } .meta { color: #94a3b8; font-size: 11px; margin-bottom: 14px; }
      .kpis { display: flex; flex-wrap: wrap; gap: 10px; margin: 12px 0; }
      .kpi { border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px 12px; min-width: 130px; }
      .kpi b { display: block; font-size: 16px; } .kpi small { color: #64748b; }
      table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; page-break-inside: auto; }
      th { background: #4f46e5; color: #fff; text-align: left; }
      th, td { border: 1px solid #e2e8f0; padding: 5px 8px; font-size: 11.5px; }
      tr { page-break-inside: avoid; } .num { text-align: right; }
      .foot { margin-top: 18px; color: #94a3b8; font-size: 10.5px; border-top: 1px solid #e2e8f0; padding-top: 8px; }
      @media print { body { margin: 8mm; } }
    </style></head><body>
      <h1>${esc(o.title || 'Report')}</h1>
      ${o.subtitle ? `<p class="sub">${o.subtitle}</p>` : ''}
      <p class="meta">${esc(brand)} · Generated ${esc(new Date().toLocaleString('en-IN'))}</p>
      ${o.html || ''}
      <div class="foot">${esc(brand)} · ${esc((FF.config && FF.config.appName) || '')} · Print / Save as PDF</div>
      <script>window.onload = function () { setTimeout(function () { window.print(); }, 250); };<\/script>
    </body></html>`);
    w.document.close();
  }

  // ---- recent searches (localStorage) -----------------------------------------------------------
  function recentList(key, max) {
    try { const arr = JSON.parse(localStorage.getItem(`ff_recent_${key}`) || '[]'); return Array.isArray(arr) ? arr.slice(0, max || 5) : []; } catch { return []; }
  }
  function recentAdd(key, item, max) {
    if (!item || !item.label) return recentList(key, max);
    const cap = max || 5;
    const list = recentList(key, cap).filter((x) => !(x && String(x.label).toLowerCase() === String(item.label).toLowerCase()));
    list.unshift({ label: item.label, kind: item.kind || '', value: item.value !== undefined ? item.value : item.label });
    try { localStorage.setItem(`ff_recent_${key}`, JSON.stringify(list.slice(0, cap))); } catch { /* storage full */ }
    return list.slice(0, cap);
  }

  /** 🗣 Voice search — Web Speech API (Indian English). Click again to stop.
   *  opts.onInterim(transcript) → live dictation preview (interimResults on).
   *  opts.dictation → continuous listening, har final phrase onText se aata hai (bolkar likho). */
  let activeVoice = null;
  function voiceInput(onText, hint, opts) {
    const o = opts || {};
    const button = o.button || null;
    if (activeVoice) {
      const same = !button || activeVoice.button === button;
      try { same ? activeVoice.rec.stop() : activeVoice.rec.abort(); } catch { /* already ending */ }
      if (same) return activeVoice.rec;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('🗣 Voice search is browser me supported nahi hai — latest Chrome/Edge try karo.', 'warn'); return null; }
    if (window.isSecureContext === false) { toast('Mic ke liye secure HTTPS connection chahiye.', 'err'); return null; }
    try {
      const rec = new SR();
      let gotResult = false;
      rec.lang = o.lang || 'en-IN';
      rec.interimResults = !!o.onInterim || !!o.dictation;
      rec.continuous = !!o.dictation;
      rec.maxAlternatives = 1;
      const cleanup = () => {
        if (button) {
          button.classList.remove('listening');
          button.setAttribute('aria-pressed', 'false');
          button.removeAttribute('aria-busy');
          button.title = button.dataset.voiceTitle || '🗣 Bol ke search karo';
        }
        if (o.onEnd) { try { o.onEnd(gotResult); } catch { /* listener error */ } }
        if (activeVoice && activeVoice.rec === rec) activeVoice = null;
      };
      if (button) {
        button.dataset.voiceTitle = button.title || '🗣 Bol ke search karo';
        button.classList.add('listening');
        button.setAttribute('aria-pressed', 'true');
        button.setAttribute('aria-busy', 'true');
        button.title = 'Sun raha hoon… dobara dabao to stop';
      }
      activeVoice = { rec, button };
      toast(hint || '🎤 Bolo… sun raha hoon', 'info');
      rec.onresult = (e) => {
        let interim = '', finalText = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i] && e.results[i][0] ? String(e.results[i][0].transcript).trim() : '';
          if (e.results[i].isFinal) finalText += (finalText ? ' ' : '') + t;
          else interim += (interim ? ' ' : '') + t;
        }
        if (interim && o.onInterim) o.onInterim(interim);
        if (finalText) {
          gotResult = true;
          if (o.onInterim) o.onInterim(''); // interim khatam
          if (onText) onText(finalText);
        }
      };
      rec.onerror = (e) => {
        const code = e && e.error;
        if (code === 'not-allowed' || code === 'service-not-allowed') toast('Mic permission blocked hai — address bar ke 🔒 icon se Microphone Allow karo.', 'err');
        else if (code === 'audio-capture') toast('Microphone nahi mila — device/browser mic setting check karo.', 'err');
        else if (code === 'network') toast('Voice service network se connect nahi hui — internet check karke retry karo.', 'warn');
        else if (code === 'no-speech') toast('Kuch sunai nahi diya — dobara try karo.', 'warn');
        else if (code !== 'aborted') toast('Awaaz samajh nahi aayi — dobara try karo.', 'warn');
      };
      rec.onend = () => { cleanup(); if (!gotResult && o.onEmpty) o.onEmpty(); };
      if (!o.dictation) rec.onspeechend = () => { try { rec.stop(); } catch { /* ending */ } };
      rec.start();
      return rec;
    } catch {
      if (button) { button.classList.remove('listening'); button.setAttribute('aria-pressed', 'false'); button.removeAttribute('aria-busy'); }
      activeVoice = null;
      toast('Voice search start nahi ho paya — mic permission check karo.', 'err');
      return null;
    }
  }

  // ---- 🎙 Assistant voice preferences (Settings → My account ↔ assistant.js shared) ----
  const VOICE_PREFS_KEY = 'ff-voice-prefs';
  function voicePrefs() {
    try { const p = JSON.parse(localStorage.getItem(VOICE_PREFS_KEY) || '{}'); return (p && typeof p === 'object') ? p : {}; } catch { return {}; }
  }
  function setVoicePrefs(patch) {
    const p = { ...voicePrefs(), ...(patch || {}) };
    try { localStorage.setItem(VOICE_PREFS_KEY, JSON.stringify(p)); } catch { /* storage full */ }
    try { if (typeof CustomEvent === 'function' && typeof dispatchEvent === 'function') dispatchEvent(new CustomEvent('ff-voice-prefs', { detail: p })); } catch { /* non-browser */ }
    return p;
  }

  // ---- 🎙 "Meri awaaz" voice profile — uploaded/recorded sample se TTS tone-match ----------
  // User apni awaaz ka sample upload/record karta hai → PCM analysis se pitch (Hz), pace
  // (syllables/sec) aur timbre (brightness) nikalta hai → us hisaab se speechSynthesis ka
  // pitch/rate set hota hai + best-matching system voice choose hoti hai. Profile localStorage
  // me sirf derived numbers rakhti hai (audio file store nahi hoti — privacy + size).
  const clampNum = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  /** Box-average decimation — analysis ko fast banane ke liye PCM ko ~8kHz par lao. */
  function resamplePcm(samples, fromRate, toRate) {
    const src = samples || [];
    if (!src.length || !(toRate > 0) || !(fromRate > toRate)) return Float32Array.from(src);
    const ratio = fromRate / toRate;
    const outLen = Math.floor(src.length / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const start = Math.floor(i * ratio), end = Math.min(src.length, Math.floor((i + 1) * ratio) + 1);
      let s = 0;
      for (let j = start; j < end; j++) s += src[j];
      out[i] = s / Math.max(1, end - start);
    }
    return out;
  }

  /** Core DSP (node-testable): Float32 PCM → { hz, pitch, rate, gender, syllPerSec, brightness }.
   *  Pitch = voiced frames ki median autocorrelation F0; pace = energy-envelope ke syllable
   *  nuclei peaks/sec; brightness = zero-crossing rate (warm ↔ sharp voice). */
  function analyzePcm(samples, sampleRate) {
    const sr = Number(sampleRate) > 0 ? Number(sampleRate) : 8000;
    const pcm = Float32Array.from(samples || []);
    const seconds = pcm.length / sr;
    if (pcm.length < sr * 0.4) return { ok: false, reason: 'Sample bahut chhota hai — kam se kam 2–3 second ki awaaz record/upload karo.', seconds };
    const win = Math.max(16, Math.round(sr * 0.04)); // 40 ms
    const hop = Math.max(8, Math.round(sr * 0.02));  // 20 ms hop
    const energies = [];
    for (let start = 0; start + win <= pcm.length; start += hop) {
      let sum2 = 0;
      for (let i = start; i < start + win; i++) sum2 += pcm[i] * pcm[i];
      energies.push(Math.sqrt(sum2 / win));
    }
    const sortedE = energies.slice().sort((a, b) => a - b);
    const medianE = sortedE[Math.floor(sortedE.length / 2)] || 0;
    const peakE = sortedE[Math.floor(sortedE.length * 0.95)] || 0;
    if (peakE < 0.008) return { ok: false, reason: 'Sample me awaaz nahi mili — mic ke paas bol kar record karo ya clear audio file upload karo.', seconds };
    const voiceFloor = Math.max(0.012, peakE * 0.22);

    // ---- pitch: har voiced frame par normalized autocorrelation ----
    const minLag = Math.floor(sr / 400); // 400 Hz max (child/female high)
    const maxLag = Math.floor(sr / 65);  // 65 Hz min (deep male)
    const f0s = [];
    for (let start = 0, fi = 0; start + win <= pcm.length; start += hop, fi++) {
      const rms = energies[fi];
      if (!(rms > voiceFloor)) continue;
      const corr = new Float32Array(maxLag + 2);
      let bestCorr = 0;
      for (let lag = minLag; lag <= Math.min(maxLag, win - 2); lag++) {
        let c = 0, energy = 0;
        for (let i = 0; i + lag < win; i++) {
          const a = pcm[start + i];
          c += a * pcm[start + i + lag];
          energy += a * a;
        }
        corr[lag] = energy > 0 ? c / energy : 0;
        if (corr[lag] > bestCorr) bestCorr = corr[lag];
      }
      if (bestCorr > 0.5) {
        // Sine me har period-multiple par correlation ~1 hoti hai — pehla significant
        // peak lo (>= 85% of best), warna 200Hz galat 66Hz padh jayega.
        let pick = 0;
        const hi = Math.min(maxLag, win - 2);
        for (let lag = minLag + 1; lag < hi; lag++) {
          if (corr[lag] >= bestCorr * 0.85 && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) { pick = lag; break; }
        }
        if (!pick) for (let lag = minLag; lag <= hi; lag++) { if (corr[lag] === bestCorr) { pick = lag; break; } }
        if (pick) f0s.push(clampNum(sr / pick, 60, 420));
      }
    }
    f0s.sort((a, b) => a - b);
    const hz = f0s.length ? f0s[Math.floor(f0s.length / 2)] : 0;

    // ---- pace: energy envelope ke local maxima = syllable nuclei ----
    const smooth = energies.map((e, i) => (energies[i - 1] || e) + e + (energies[i + 1] || e));
    const smoothPeak = Math.max(...smooth, 1);
    let peaks = 0;
    for (let i = 1; i < smooth.length - 1; i++) {
      if (smooth[i] > smooth[i - 1] && smooth[i] >= smooth[i + 1] && smooth[i] > smoothPeak * 0.24 && energies[i] > voiceFloor) peaks++;
    }
    const syllPerSec = clampNum(peaks / Math.max(seconds, 0.5), 1, 8);

    // ---- brightness: zero-crossing rate ----
    let zc = 0;
    for (let i = 1; i < pcm.length; i++) if ((pcm[i - 1] < 0) !== (pcm[i] < 0)) zc++;
    const brightness = (zc / pcm.length) * sr; // crossings per second

    const gender = hz ? (hz < 165 ? 'male' : 'female') : (brightness > 1400 ? 'female' : 'male');
    // speechSynthesis mapping: ~200Hz ≈ pitch 1.0 (typical default awaaz)
    const pitch = clampNum(Math.round((hz ? hz / 200 : gender === 'female' ? 1 : 0.7) * 20) / 20, 0.5, 1.6);
    const rate = clampNum(Math.round((0.82 + (syllPerSec - 3.2) * 0.11) * 20) / 20, 0.75, 1.4);
    return { ok: true, seconds: Math.round(seconds * 10) / 10, hz: Math.round(hz), pitch, rate, gender, syllPerSec: Math.round(syllPerSec * 10) / 10, brightness: Math.round(brightness), voicedFrames: f0s.length, medianEnergy: Math.round(medianE * 1000) / 1000 };
  }

  /** Browser path: audio file/recorded blob → decode → analyzePcm (8kHz analysis rate). */
  async function analyzeVoiceBlob(blob) {
    const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
    if (!AC) throw new Error('Audio decoding is browser me support nahi hai — Chrome/Edge try karo.');
    if (!blob || !blob.size) throw new Error('Audio data khali hai — dobara record/upload karo.');
    const ctx = new AC();
    try {
      // Kuch browsers gesture ke turant baad AudioContext suspended rakhte hain — decode se pehle resume.
      if (ctx.state === 'suspended' && ctx.resume) { try { await ctx.resume(); } catch { /* optional */ } }
      const arr = await blob.arrayBuffer();
      let audio;
      try { audio = await ctx.decodeAudioData(arr); }
      catch (e1) {
        // Purane Safari ka callback-style decode fallback.
        audio = await new Promise((resolve, reject) => {
          try { ctx.decodeAudioData(arr, resolve, reject); } catch (e2) { reject(e2); }
        });
      }
      const ch = audio.getChannelData(0);
      const target = 8000;
      const pcm = resamplePcm(ch, audio.sampleRate, target);
      const res = analyzePcm(pcm, target);
      return { ...res, duration: Math.round((audio.duration || 0) * 10) / 10 };
    } finally { try { if (ctx.close) ctx.close(); } catch { /* optional */ } }
  }

  /** 🎙 Robust voice capture — MediaRecorder (preview blob) ke SAATH raw PCM bhi capture hota hai
   *  (WebAudio ScriptProcessor), taaki analysis ke liye browser ka audio decode pass na chahiye ho.
   *  Pehle recording sirf blob → decodeAudioData se analyse hoti thi jo kuch browsers/formats me
   *  chup-chaap fail ho jaata tha ("kuch kaam nahi kar raha"). Ab PCM direct analyse hota hai.
   *  Returns: { stream, startedAt, stop() → Promise<{ blob, pcm, sampleRate, seconds }> } */
  async function startVoiceCapture() {
    const md = (typeof navigator !== 'undefined') ? navigator.mediaDevices : null;
    if (!md || typeof md.getUserMedia !== 'function') {
      throw new Error((typeof window !== 'undefined' && window.isSecureContext === false)
        ? 'Mic ke liye HTTPS (secure connection) chahiye — site https par kholo.'
        : 'Is browser me mic recording support nahi hai — latest Chrome/Edge try karo.');
    }
    if (typeof window === 'undefined' || typeof window.MediaRecorder !== 'function') throw new Error('MediaRecorder support nahi hai — latest Chrome/Edge/Firefox try karo.');
    const stream = await md.getUserMedia({ audio: true });
    const chunks = [];
    const pcmParts = [];
    let sampleRate = 0, ac = null, proc = null, srcNode = null;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        ac = new AC();
        if (ac.state === 'suspended' && ac.resume) { try { await ac.resume(); } catch { /* optional */ } }
        sampleRate = ac.sampleRate;
        srcNode = ac.createMediaStreamSource(stream);
        proc = ac.createScriptProcessor(4096, 1, 1);
        proc.onaudioprocess = (e) => { try { pcmParts.push(Float32Array.from(e.inputBuffer.getChannelData(0))); } catch { /* optional */ } };
        srcNode.connect(proc); proc.connect(ac.destination);
      }
    } catch { /* PCM capture optional — blob decode fallback rahega */ }
    const mr = new window.MediaRecorder(stream);
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    try { mr.start(); } catch { /* kuch browsers me timeslice chahiye */ try { mr.start(250); } catch { /* phir bhi nahi */ } }
    const startedAt = Date.now();
    return {
      stream, startedAt,
      state: () => mr.state,
      stop() {
        return new Promise((resolve) => {
          const finish = (blob) => {
            stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* already */ } });
            try { if (proc) { proc.onaudioprocess = null; proc.disconnect(); } if (srcNode) srcNode.disconnect(); } catch { /* optional */ }
            try { if (ac && ac.close) ac.close(); } catch { /* optional */ }
            let pcm = null;
            if (pcmParts.length) {
              const total = pcmParts.reduce((n, a) => n + a.length, 0);
              pcm = new Float32Array(total);
              let off = 0; pcmParts.forEach((a) => { pcm.set(a, off); off += a.length; });
            }
            resolve({ blob, pcm, sampleRate, seconds: Math.round((Date.now() - startedAt) / 100) / 10 });
          };
          mr.onstop = () => finish(chunks.length ? new Blob(chunks, { type: mr.mimeType || 'audio/webm' }) : null);
          try { mr.stop(); } catch { finish(chunks.length ? new Blob(chunks, { type: 'audio/webm' }) : null); }
          setTimeout(() => { if (mr.state !== 'inactive') finish(null); }, 4000); // safety net
        });
      }
    };
  }

  /** Capture ka analysis — pehle direct PCM (recording), warna blob decode (upload). */
  async function analyzeVoiceCapture(cap) {
    if (cap && cap.pcm && cap.pcm.length && cap.sampleRate > 0) {
      const target = 8000;
      const res = analyzePcm(resamplePcm(cap.pcm, cap.sampleRate, target), target);
      return { ...res, duration: cap.seconds || res.seconds || 0 };
    }
    if (cap && cap.blob) return analyzeVoiceBlob(cap.blob);
    throw new Error('Recording ka audio data nahi mila — mic permission check kar ke dobara try karo.');
  }

  // ---- 👂 Wake word ("Hey Gems" style) — transcript me fuzzy match ------------------------------
  /** Normalise: lowercase, punctuation hatao, whitespace collapse (Devanagari letters allowed). */
  const wakeNorm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  /** Chhota Levenshtein — ASR ke misheards ("hey gems" → "hey jems" / "age gems") tolerate karne ke liye. */
  function wakeEditDist(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length; if (!b.length) return a.length;
    if (Math.abs(a.length - b.length) > 2) return 99;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  /** True jab transcript me wake word sunai de — exact substring YA token-wise fuzzy (≤ len/3 edits). */
  function wakeWordMatch(transcript, wakeWord) {
    const t = wakeNorm(transcript), w = wakeNorm(wakeWord);
    if (!t || !w) return false;
    if (t.includes(w)) return true;
    const wt = w.split(' ').filter(Boolean), tt = t.split(' ').filter(Boolean);
    if (!wt.length || tt.length < wt.length) return false;
    for (let i = 0; i + wt.length <= tt.length; i++) {
      let ok = true;
      for (let j = 0; j < wt.length; j++) {
        const tol = Math.max(1, Math.floor(wt[j].length / 3));
        if (wakeEditDist(tt[i + j], wt[j]) > tol) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  }

  const VOICE_PROFILE_LIMIT = { minSeconds: 1.5, maxSeconds: 45 };
  /** "Meri awaaz" profile (derived numbers only — audio kabhi store nahi hoti). */
  function voiceProfile() {
    const p = voicePrefs();
    return p && typeof p.profile === 'object' && p.profile && p.profile.pitch ? p.profile : null;
  }
  /** Profile save (apply bhi kar do pitch/rate) ya null se clear. */
  function setVoiceProfile(profile) {
    if (!profile) return setVoicePrefs({ profile: null, pitch: 0, rate: 0 });
    const cleanProfile = {
      pitch: clampNum(Number(profile.pitch) || 1, 0.5, 1.6),
      rate: clampNum(Number(profile.rate) || 1, 0.75, 1.4),
      hz: Number(profile.hz) || 0,
      gender: profile.gender === 'male' ? 'male' : 'female',
      syllPerSec: Number(profile.syllPerSec) || 0,
      brightness: Number(profile.brightness) || 0,
      seconds: Number(profile.seconds) || 0,
      name: String(profile.name || 'Meri awaaz').slice(0, 40),
      at: Date.now()
    };
    return setVoicePrefs({ profile: cleanProfile, pitch: cleanProfile.pitch, rate: cleanProfile.rate });
  }

  /** Best system voice: pehle user ki chosen URI, phir language, phir profile gender hint. */
  function matchVoice(voices, langKey, profile) {
    const vs = voices || [];
    const p = voicePrefs();
    const wantURI = langKey === 'en' ? p.en : p.hi;
    const chosen = wantURI && vs.find((v) => v.voiceURI === wantURI);
    if (chosen) return chosen;
    const langScore = (v) => {
      const l = String(v.lang || '');
      if (langKey === 'en') return /^en[-_]IN/i.test(l) ? 0 : /^en/i.test(l) ? 1 : 2;
      return /^hi[-_]IN/i.test(l) ? 0 : /^hi/i.test(l) ? 1 : 2;
    };
    const gender = (profile && profile.gender) || (voiceProfile() && voiceProfile().gender) || '';
    const genderScore = (v) => {
      if (!gender) return 0;
      const n = String(v.name || '').toLowerCase();
      const fem = /(female|woman|heera|kalpana|neerja|swara|madhur|veena|isha|aditi|samantha|zira|jenny|aria|sonia|google.*हिन्दी)/.test(n);
      const masc = /(male|man[^a-z]|ravi|hemant|prabhat|kumar|amit|rishabh|david|guy|mark|alex)/.test(n);
      if (gender === 'female') return fem ? -3 : masc ? 3 : 0;
      return masc ? -3 : fem ? 3 : 0;
    };
    return vs.slice().sort((a, b) => langScore(a) - langScore(b) || genderScore(a) - genderScore(b) || String(a.name || '').localeCompare(String(b.name || '')))[0] || vs[0] || null;
  }

  FF.util = {
    esc, clean, num, fmt, fmtShort, pctOf, growth, fmtPct, fmtSigned, deltaHtml,
    MONTHS, MONTHS_LONG, DAYS, pad2, parseDate, parseMonthKey, ymKey, dateKey, fromDateKey, ymParts, labelYM, labelDate, labelDateKey,
    weekday, daysInMonth, prevMonthKey, nextMonthKey, weekStart, timeLabel,
    sum, groupSum, topEntries, sortBy, uniq,
    $, $$, h, debounce, setButtonBusy, withButtonBusy, toast, spinner, errorBox, downloadBlob, downloadCsv, tableToRows, slug, stamp, colLetter, colIndex, initTooltip,
    phoneDigits, waLink, mailLink, copyText, suggest,
    parseDateTime, printReport, recentList, recentAdd, voiceInput, voicePrefs, setVoicePrefs,
    resamplePcm, analyzePcm, analyzeVoiceBlob, startVoiceCapture, analyzeVoiceCapture, voiceProfile, setVoiceProfile, matchVoice, VOICE_PROFILE_LIMIT,
    wakeNorm, wakeWordMatch
  };
})(window.FF);
