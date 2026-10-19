#!/usr/bin/env node
/* Generates themes.css (theme packs) — run: node dev/gen-themes.js
 * Every pack restyles: page, cards, text, tables, buttons, topbar, sidebar, KPI cards, login screen.
 * `mode` decides data-theme (light|dark) — ui-boot.js sets it before first paint. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PACKS = {
  desk: { name: 'Royal Blue Desk', icon: '💙', mode: 'light', desc: 'Blue hero cards, rounded white panels (default)',
    bg: '#f1f5fd', card: '#ffffff', ink: '#0e1a3a', muted: '#62728f', line: '#e3eaf8',
    brand: '#1d4ed8', brand2: '#0ea5e9', sideBg: '#0c2a80', sideBg2: '#2458e6', sideInk: '#e3ecff',
    surface2: '#ffffff', head: '#eef3fe', topbar: 'rgba(241,245,253,.86)', soft: '#eaf1ff',
    palette: ['#1d4ed8', '#0ea5e9', '#10b981', '#6366f1', '#f59e0b', '#0891b2', '#2563eb', '#14b8a6'],
    auth: ['#0a1f5c', '#1741b8', '#3b82f6'], vivid: true },
  navy: { name: 'Navy & White', icon: '🧭', mode: 'light', desc: 'Clean white workspace with deep navy accents',
    bg: '#f3f6fc', card: '#ffffff', ink: '#0b1f3a', muted: '#5b6b86', line: '#dbe4f3',
    brand: '#1e3a8a', brand2: '#2563eb', sideBg: '#08183a', sideBg2: '#13307a', sideInk: '#dbe7ff',
    surface2: '#ffffff', head: '#eaf0fb', topbar: 'rgba(255,255,255,.92)', soft: '#e8effc',
    palette: ['#1e3a8a', '#2563eb', '#0ea5e9', '#0f766e', '#334155', '#4f46e5', '#0369a1', '#1d4ed8'],
    auth: ['#0a1f4d', '#13307a', '#2563eb'] },
  ocean: { name: 'Ocean', icon: '🌊', mode: 'light', desc: 'Fresh teal and aqua tones',
    bg: '#effafb', card: '#ffffff', ink: '#08303a', muted: '#4f7480', line: '#cfe9ee',
    brand: '#0e7490', brand2: '#06b6d4', sideBg: '#06323d', sideBg2: '#0e6f86', sideInk: '#d6f6fb',
    surface2: '#ffffff', head: '#e3f5f8', topbar: 'rgba(255,255,255,.92)', soft: '#e0f4f8',
    palette: ['#0e7490', '#0891b2', '#0d9488', '#0369a1', '#14b8a6', '#2563eb', '#0f766e', '#0ea5e9'],
    auth: ['#06323d', '#0e6f86', '#06b6d4'] },
  forest: { name: 'Forest', icon: '🌿', mode: 'light', desc: 'Calm natural greens',
    bg: '#f2f9f3', card: '#ffffff', ink: '#10281a', muted: '#58705f', line: '#d3e7d8',
    brand: '#166534', brand2: '#16a34a', sideBg: '#0c2a17', sideBg2: '#1b6a3a', sideInk: '#dcfce7',
    surface2: '#ffffff', head: '#e5f4e8', topbar: 'rgba(255,255,255,.92)', soft: '#e3f4e7',
    palette: ['#166534', '#16a34a', '#0f766e', '#4d7c0f', '#15803d', '#0d9488', '#65a30d', '#047857'],
    auth: ['#0c2a17', '#1b6a3a', '#22c55e'] },
  sunset: { name: 'Sunset', icon: '🌅', mode: 'light', desc: 'Warm orange and rose',
    bg: '#fff7f2', card: '#ffffff', ink: '#2b1408', muted: '#7d6252', line: '#f4dccd',
    brand: '#c2410c', brand2: '#f43f5e', sideBg: '#3a1408', sideBg2: '#9a3412', sideInk: '#ffe9dc',
    surface2: '#ffffff', head: '#fdeee4', topbar: 'rgba(255,255,255,.92)', soft: '#fdeadf',
    palette: ['#c2410c', '#ea580c', '#e11d48', '#d97706', '#be123c', '#f97316', '#db2777', '#b45309'],
    auth: ['#3a1408', '#9a3412', '#f43f5e'] },
  royal: { name: 'Royal Purple', icon: '👑', mode: 'light', desc: 'Rich violet and magenta',
    bg: '#f6f3fd', card: '#ffffff', ink: '#1d1235', muted: '#6a5d88', line: '#e3dbf4',
    brand: '#6d28d9', brand2: '#c026d3', sideBg: '#1d0f3d', sideBg2: '#5b21b6', sideInk: '#efe6ff',
    surface2: '#ffffff', head: '#eee8fb', topbar: 'rgba(255,255,255,.92)', soft: '#ece5fa',
    palette: ['#6d28d9', '#7c3aed', '#c026d3', '#4f46e5', '#9333ea', '#a21caf', '#5b21b6', '#db2777'],
    auth: ['#1d0f3d', '#5b21b6', '#c026d3'] },
  gold: { name: 'Gold Corporate', icon: '🥇', mode: 'light', desc: 'Warm executive reporting',
    bg: '#f8f5ee', card: '#fffdf7', ink: '#2a2416', muted: '#7a7052', line: '#e8dfc8',
    brand: '#b45309', brand2: '#d97706', sideBg: '#2a1c07', sideBg2: '#7c4a0a', sideInk: '#fdf0d4',
    surface2: '#fffdf7', head: '#f3ecda', topbar: 'rgba(255,253,247,.93)', soft: '#f5ecd6',
    palette: ['#b45309', '#d97706', '#92400e', '#a16207', '#c2410c', '#854d0e', '#ca8a04', '#9a3412'],
    auth: ['#2a1c07', '#7c4a0a', '#d97706'] },
  mono: { name: 'Mono', icon: '🖤', mode: 'light', desc: 'Minimal, print-friendly greys',
    bg: '#f4f5f7', card: '#ffffff', ink: '#111827', muted: '#6b7280', line: '#e3e6ea',
    brand: '#334155', brand2: '#64748b', sideBg: '#0f172a', sideBg2: '#334155', sideInk: '#e5e7eb',
    surface2: '#ffffff', head: '#eceef2', topbar: 'rgba(255,255,255,.93)', soft: '#eceff3',
    palette: ['#334155', '#475569', '#64748b', '#1f2937', '#52525b', '#3f3f46', '#57534e', '#0f172a'],
    auth: ['#0f172a', '#1e293b', '#475569'] },
  glass: { name: 'Glass', icon: '🧊', mode: 'light', desc: 'Soft frosted indigo and sky',
    bg: '#eef1f9', card: '#ffffff', ink: '#111a2e', muted: '#5b6785', line: '#dbe3f2',
    brand: '#4f46e5', brand2: '#06b6d4', sideBg: '#1b1a4e', sideBg2: '#3b3aa8', sideInk: '#e4e6ff',
    surface2: '#ffffff', head: '#e8ecf8', topbar: 'rgba(255,255,255,.80)', soft: '#e6e9fb',
    palette: ['#4f46e5', '#0ea5e9', '#06b6d4', '#6366f1', '#2563eb', '#0891b2', '#7c3aed', '#3b82f6'],
    auth: ['#1b1a4e', '#3b3aa8', '#06b6d4'] },
  midnight: { name: 'Midnight Navy', icon: '🌌', mode: 'dark', desc: 'Dark navy for night work',
    bg: '#07101f', card: '#0f1b32', ink: '#e8eefb', muted: '#92a6c6', line: '#1f3152',
    brand: '#38bdf8', brand2: '#818cf8', sideBg: '#050c19', sideBg2: '#10234a', sideInk: '#d6e4ff',
    surface2: '#0b1629', head: '#13233f', topbar: 'rgba(7,16,31,.88)', soft: '#12223e',
    palette: ['#1d4ed8', '#0284c7', '#4f46e5', '#0f766e', '#0369a1', '#6d28d9', '#1e40af', '#0e7490'],
    auth: ['#050c19', '#10234a', '#2563eb'] },
  neon: { name: 'Neon', icon: '🌃', mode: 'dark', desc: 'Dark, high-energy TV mode',
    bg: '#0a0a12', card: '#13131f', ink: '#eef0ff', muted: '#8a93b8', line: '#2a2a44',
    brand: '#00e5ff', brand2: '#ff2bd6', sideBg: '#07070f', sideBg2: '#1a1038', sideInk: '#e6e9ff',
    surface2: '#0e0e19', head: '#1a1a2c', topbar: 'rgba(10,10,18,.88)', soft: '#1a1a2e',
    palette: ['#0891b2', '#c026d3', '#059669', '#7c3aed', '#db2777', '#0284c7', '#16a34a', '#9333ea'],
    auth: ['#07070f', '#1a1038', '#c026d3'] },
  diwali: { name: 'Diwali Festive', icon: '🪔', mode: 'dark', desc: 'Warm festive lights',
    bg: '#180d05', card: '#2a170a', ink: '#fff6e2', muted: '#d0a982', line: '#4a2c12',
    brand: '#ff8c00', brand2: '#ffd000', sideBg: '#100803', sideBg2: '#5a2a07', sideInk: '#ffeccc',
    surface2: '#21120a', head: '#38200d', topbar: 'rgba(24,13,5,.9)', soft: '#33200e',
    palette: ['#c2410c', '#b45309', '#a16207', '#be123c', '#92400e', '#d97706', '#9a3412', '#854d0e'],
    auth: ['#100803', '#5a2a07', '#ff8c00'] }
};

// ---- colour helpers ---------------------------------------------------------------------------
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function rgb2hsl([r, g, b]) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2; if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; } return [h, s, l]; }
function hsl2hex([h, s, l]) { const f = (n) => { const k = (n + h / 30) % 12; const a = s * Math.min(l, 1 - l); const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(c * 255).toString(16).padStart(2, '0'); }; return '#' + f(0) + f(8) + f(4); }
const shade = (hex, dl, maxL) => { const [h, s, l] = rgb2hsl(hex2rgb(hex)); return hsl2hex([h, s, Math.max(.12, Math.min(maxL == null ? .95 : maxL, l + dl))]); };
const rgba = (hex, a) => { const [r, g, b] = hex2rgb(hex); return `rgba(${r}, ${g}, ${b}, ${a})`; };

function kpiBlock(sel, pal) {
  const n = pal.length; const out = [];
  for (let i = 1; i <= 13; i++) {
    const c2 = shade(pal[(i - 1) % n], 0, 0.46);
    const c3 = shade(pal[(i + 1) % n], 0, 0.50);
    const c1 = shade(c2, -0.10);
    out.push(`${sel} .g${i} { --k1: ${c1}; --k2: ${c2}; --k3: ${c3}; --kglow: ${rgba(c2, .5)}; }`);
  }
  return out.join('\n');
}

function chartPal(p) { const l = p.mode === 'dark' ? 0.16 : 0; return p.palette.map((c) => shade(c, l)).concat([p.brand2]).slice(0, 9).join(', '); }
function packCss(key, p) {
  const s = `html[data-theme-pack="${key}"]`;
  const dark = p.mode === 'dark';
  return `/* ---------- ${p.name} (${p.mode}) ---------- */
${s} {
  color-scheme: ${p.mode};
  --bg: ${p.bg}; --card: ${p.card}; --ink: ${p.ink}; --muted: ${p.muted}; --line: ${p.line};
  --brand: ${p.brand}; --brand-2: ${p.brand2}; --brand2: ${p.brand2};
  --side-bg: ${p.sideBg}; --side-bg2: ${p.sideBg2}; --side-ink: ${p.sideInk};
  --pk-surface2: ${p.surface2}; --pk-head: ${p.head}; --pk-topbar: ${p.topbar}; --pk-soft: ${p.soft};
${p.vivid ? '' : `  --chart-pal: ${chartPal(p)};\n`}  --auth-1: ${p.auth[0]}; --auth-2: ${p.auth[1]}; --auth-3: ${p.auth[2]};
  --shadow: ${dark ? '0 8px 26px rgba(0, 0, 0, .5), 0 1px 2px rgba(0, 0, 0, .4)' : `0 6px 24px ${rgba(p.brand, .10)}, 0 1px 2px ${rgba(p.brand, .08)}`};
  --green: ${dark ? '#34d399' : '#10b981'}; --red: ${dark ? '#fb7185' : '#ef4444'}; --amber: ${dark ? '#fbbf24' : '#f59e0b'};
}
${p.vivid ? '/* vivid: KPI cards + charts keep the full multi-colour default palette */' : kpiBlock(s, p.palette)}`;
}

const GENERIC = `
/* ---------- shared pack rules (every non-default pack) ---------- */
html[data-theme-pack]:not([data-theme-pack=""]) body { background: var(--bg); color: var(--ink); }
html[data-theme-pack]:not([data-theme-pack=""]) a:not([class]) { color: var(--brand); }
html[data-theme-pack]:not([data-theme-pack=""]) ::selection { background: var(--brand); color: #fff; }
html[data-theme-pack]:not([data-theme-pack=""]) .topbar { background: var(--pk-topbar); border-bottom-color: var(--line); }
html[data-theme-pack]:not([data-theme-pack=""]) .card { background: var(--card); border-color: var(--line); color: var(--ink); }
html[data-theme-pack]:not([data-theme-pack=""]) .card-head { border-color: var(--line); }
html[data-theme-pack]:not([data-theme-pack=""]) h1, html[data-theme-pack]:not([data-theme-pack=""]) h2, html[data-theme-pack]:not([data-theme-pack=""]) h3, html[data-theme-pack]:not([data-theme-pack=""]) h4 { color: var(--ink); }
html[data-theme-pack]:not([data-theme-pack=""]) .dim, html[data-theme-pack]:not([data-theme-pack=""]) .sub { color: var(--muted); }
html[data-theme-pack]:not([data-theme-pack=""]) .page-home .home-hero, html[data-theme-pack]:not([data-theme-pack=""]) .home-hero.v2 { background: linear-gradient(135deg, var(--pk-soft), var(--card)) !important; border-color: var(--line) !important; }
html[data-theme-pack]:not([data-theme-pack=""]) .home-hero.v2 .home-greeting, html[data-theme-pack]:not([data-theme-pack=""]) .home-hero.v2 .home-greeting-text { color: var(--ink) !important; -webkit-text-fill-color: var(--ink) !important; }
html[data-theme-pack]:not([data-theme-pack=""]) .tbl th { background: var(--pk-head); color: var(--muted); }
html[data-theme-pack]:not([data-theme-pack=""]) .tbl th.section, html[data-theme-pack]:not([data-theme-pack=""]) .tbl th.section:not(.has) { background: var(--pk-soft); color: var(--brand); border-left-color: var(--card); }
html[data-theme-pack]:not([data-theme-pack=""]) .tbl td { border-bottom-color: var(--line); color: var(--ink); }
html[data-theme-pack]:not([data-theme-pack=""]) .tbl tbody tr:hover td { background: var(--pk-soft); }
html[data-theme-pack]:not([data-theme-pack=""]) .input, html[data-theme-pack]:not([data-theme-pack=""]) select, html[data-theme-pack]:not([data-theme-pack=""]) textarea, html[data-theme-pack]:not([data-theme-pack=""]) .ctrl-row input { background: var(--pk-surface2); border-color: var(--line); color: var(--ink); }
html[data-theme-pack]:not([data-theme-pack=""]) .input:focus, html[data-theme-pack]:not([data-theme-pack=""]) select:focus { border-color: var(--brand); outline-color: var(--brand); }
html[data-theme-pack]:not([data-theme-pack=""]) .input::placeholder { color: var(--muted); opacity: .8; }
html[data-theme-pack]:not([data-theme-pack=""]) .btn { background: var(--pk-surface2); border-color: var(--line); color: var(--ink); }
html[data-theme-pack]:not([data-theme-pack=""]) .btn:hover { background: var(--pk-soft); border-color: var(--brand); }
html[data-theme-pack]:not([data-theme-pack=""]) .btn.primary, html[data-theme-pack]:not([data-theme-pack=""]) .btn.primary:hover { background: linear-gradient(135deg, var(--brand), var(--brand-2)); color: #fff; border-color: transparent; }
html[data-theme-pack]:not([data-theme-pack=""]) .icon-btn { background: var(--pk-surface2); border-color: var(--line); color: var(--ink); }
html[data-theme-pack]:not([data-theme-pack=""]) .seg { background: var(--pk-soft); }
html[data-theme-pack]:not([data-theme-pack=""]) .seg-btn { color: var(--muted); }
html[data-theme-pack]:not([data-theme-pack=""]) .seg-btn.on { background: var(--card); color: var(--brand); }
html[data-theme-pack]:not([data-theme-pack=""]) .badge, html[data-theme-pack]:not([data-theme-pack=""]) .chip { border-color: var(--line); }
html[data-theme-pack]:not([data-theme-pack=""]) .nav-item.active { background: linear-gradient(90deg, var(--brand-2), var(--brand)); }
html[data-theme-pack]:not([data-theme-pack=""]) .user-avatar { background: linear-gradient(135deg, var(--brand), var(--brand-2)); }
html[data-theme-pack]:not([data-theme-pack=""]) .theme-pop { background: var(--card); border-color: var(--line); color: var(--ink); }
html[data-theme-pack]:not([data-theme-pack=""]) hr { border-color: var(--line); }
html[data-theme-pack]:not([data-theme-pack=""]) .top-title { background: linear-gradient(90deg, var(--brand), var(--brand-2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
html[data-theme-pack]:not([data-theme-pack=""]) .home-hero.v2::before { background: radial-gradient(600px 300px at 10% 0%, color-mix(in srgb, var(--brand) 14%, transparent), transparent 60%), radial-gradient(500px 260px at 100% 100%, color-mix(in srgb, var(--brand-2) 12%, transparent), transparent 60%) !important; }
html[data-theme-pack]:not([data-theme-pack=""]):not([data-theme-pack="desk"]) .chip.vc4 { border-color: color-mix(in srgb, var(--brand) 35%, var(--line)); background: color-mix(in srgb, var(--brand) 10%, var(--card)); color: var(--brand); }
html[data-theme-pack]:not([data-theme-pack=""]):not([data-theme-pack="desk"]) .chip.vc4.on { background: var(--brand); border-color: var(--brand); color: #fff; }
html[data-theme-pack]:not([data-theme-pack=""]):not([data-theme-pack="desk"]) .chip.comm { border-color: color-mix(in srgb, var(--brand-2) 35%, var(--line)); background: color-mix(in srgb, var(--brand-2) 10%, var(--card)); color: var(--brand-2); }
html[data-theme-pack]:not([data-theme-pack=""]):not([data-theme-pack="desk"]) .chip.comm.on { background: var(--brand-2); border-color: var(--brand-2); color: #fff; }
/* KPI text stays white on the gradient, readable on every pack */
html[data-theme-pack]:not([data-theme-pack=""]) .kpi, html[data-theme-pack]:not([data-theme-pack=""]) .gs-kpi { color: #fff; }
html[data-theme-pack]:not([data-theme-pack=""]) .kpi .kpi-title, html[data-theme-pack]:not([data-theme-pack=""]) .kpi .kpi-value, html[data-theme-pack]:not([data-theme-pack=""]) .kpi .kpi-foot { color: #fff; }
html[data-theme-pack]:not([data-theme-pack=""]) .kpi .kpi-foot b, html[data-theme-pack]:not([data-theme-pack=""]) .kpi .kpi-foot small { color: inherit; }
`;

const DESK = `
/* ---------- 💙 Royal Blue Desk — signature look (v223 default) ---------- */
html[data-theme-pack="desk"] body { background: radial-gradient(1100px 380px at 60% -120px, #dbe7ff 0%, rgba(219, 231, 255, 0) 70%) fixed, #f1f5fd; }
html[data-theme-pack="desk"] .card { border-radius: 22px; border: 1px solid #e6edfb; box-shadow: 0 12px 30px rgba(29, 78, 216, .06), 0 1px 2px rgba(29, 78, 216, .04); }
html[data-theme-pack="desk"] .card-head h3 { font-weight: 800; letter-spacing: -.02em; }
/* page header = blue hero card */
html[data-theme-pack="desk"] .page-head { position: relative; overflow: hidden; padding: 20px 22px; border-radius: 26px; color: #fff;
  background: linear-gradient(145deg, #2458e6 0%, #1741b8 55%, #0f2f8c 100%); box-shadow: 0 18px 40px rgba(23, 65, 184, .24); }
html[data-theme-pack="desk"] .page-head::after { content: ""; position: absolute; right: -80px; bottom: -110px; width: 280px; height: 280px; border-radius: 50%; border: 38px solid rgba(255, 255, 255, .07); pointer-events: none; }
html[data-theme-pack="desk"] .page-head > * { position: relative; z-index: 1; }
html[data-theme-pack="desk"] .page-head h1 { background: none !important; -webkit-text-fill-color: #fff !important; color: #fff !important; font-weight: 800; letter-spacing: -.03em; }
html[data-theme-pack="desk"] .page-head .sub, html[data-theme-pack="desk"] .page-head .dim, html[data-theme-pack="desk"] .page-head small, html[data-theme-pack="desk"] .page-head label { color: rgba(255, 255, 255, .82) !important; }
html[data-theme-pack="desk"] .page-head b, html[data-theme-pack="desk"] .page-head strong { color: #fff; }
html[data-theme-pack="desk"] .page-head .btn, html[data-theme-pack="desk"] .page-head .icon-btn { background: rgba(255, 255, 255, .14) !important; border-color: rgba(255, 255, 255, .3) !important; color: #fff !important; }
html[data-theme-pack="desk"] .page-head .btn:hover { background: rgba(255, 255, 255, .24) !important; }
html[data-theme-pack="desk"] .page-head .btn.primary { background: #fff !important; color: #1d4ed8 !important; border-color: #fff !important; }
html[data-theme-pack="desk"] .page-head .seg { background: rgba(255, 255, 255, .14) !important; border: 1px solid rgba(255, 255, 255, .22); }
html[data-theme-pack="desk"] .page-head .seg-btn { color: rgba(255, 255, 255, .88) !important; -webkit-text-fill-color: currentColor !important; background: transparent !important; border-color: transparent !important; }
html[data-theme-pack="desk"] .page-head .seg-btn.on { background: #fff !important; color: #1d4ed8 !important; }
html[data-theme-pack="desk"] .page-head .input, html[data-theme-pack="desk"] .page-head select { background: #fff !important; color: #0e1a3a !important; border-color: transparent !important; }
html[data-theme-pack="desk"] .page-head .badge, html[data-theme-pack="desk"] .page-head .chip { background: rgba(255, 255, 255, .16); color: #fff; border-color: rgba(255, 255, 255, .3); }
/* popups opened from inside the header keep normal colours */
html[data-theme-pack="desk"] .page-head [class*="pop"], html[data-theme-pack="desk"] .page-head [class*="menu"], html[data-theme-pack="desk"] .page-head [class*="drop"], html[data-theme-pack="desk"] .page-head [class*="suggest"], html[data-theme-pack="desk"] .page-head [role="menu"], html[data-theme-pack="desk"] .page-head [role="listbox"] { color: #0e1a3a; }
html[data-theme-pack="desk"] .page-head [class*="pop"] *, html[data-theme-pack="desk"] .page-head [class*="menu"] *, html[data-theme-pack="desk"] .page-head [class*="drop"] *, html[data-theme-pack="desk"] .page-head [role="menu"] * { color: inherit; }
/* Home hero = same blue card */
html[data-theme-pack="desk"]:not([data-theme-pack=""]) .home-hero.v2, html[data-theme-pack="desk"]:not([data-theme-pack=""]) .page-home .home-hero { background: linear-gradient(145deg, #2458e6 0%, #1741b8 55%, #0f2f8c 100%) !important; border-color: transparent !important; box-shadow: 0 18px 40px rgba(23, 65, 184, .24) !important; color: #fff; }
html[data-theme-pack="desk"]:not([data-theme-pack=""]) .home-hero.v2::before { background: radial-gradient(420px 260px at 92% 120%, rgba(255, 255, 255, .12), transparent 70%) !important; }
html[data-theme-pack="desk"]:not([data-theme-pack=""]) .home-hero.v2 .home-greeting, html[data-theme-pack="desk"]:not([data-theme-pack=""]) .home-hero.v2 .home-greeting-text, html[data-theme-pack="desk"]:not([data-theme-pack=""]) .home-hero.v2 .home-name { color: #fff !important; -webkit-text-fill-color: #fff !important; background: none !important; }
html[data-theme-pack="desk"]:not([data-theme-pack=""]) .home-hero.v2 .sub { color: rgba(255, 255, 255, .8) !important; }
html[data-theme-pack="desk"]:not([data-theme-pack=""]) .home-hero.v2 .chip { background: rgba(255, 255, 255, .14) !important; border-color: rgba(255, 255, 255, .26) !important; color: #fff !important; -webkit-text-fill-color: #fff !important; opacity: 1 !important; box-shadow: none !important; }
html[data-theme-pack="desk"]:not([data-theme-pack=""]) .home-hero.v2 .chip.on { background: #fff !important; color: #1d4ed8 !important; -webkit-text-fill-color: #1d4ed8 !important; }
html[data-theme-pack="desk"]:not([data-theme-pack=""]) .home-hero.v2 .home-stat { background: rgba(255, 255, 255, .14) !important; border: 1px solid rgba(255, 255, 255, .24) !important; color: #fff !important; box-shadow: none !important; }
html[data-theme-pack="desk"]:not([data-theme-pack=""]) .home-hero.v2 .home-stat .dim, html[data-theme-pack="desk"]:not([data-theme-pack=""]) .home-hero.v2 .home-stat b { color: #fff !important; -webkit-text-fill-color: #fff !important; background: none !important; box-shadow: none !important; border: 0 !important; padding: 0 !important; animation: none !important; }
html[data-theme-pack="desk"]:not([data-theme-pack=""]) .home-hero.v2 .home-stat .dim { opacity: .75; }
html[data-theme-pack="desk"]:not([data-theme-pack=""]) .home-hero.v2 .btn { background: rgba(255, 255, 255, .14) !important; border-color: rgba(255, 255, 255, .3) !important; color: #fff !important; box-shadow: none !important; }
html[data-theme-pack="desk"]:not([data-theme-pack=""]) .home-hero.v2 .btn.primary { background: #fff !important; color: #1d4ed8 !important; }
html[data-theme-pack="desk"] .brand-logo:not(.has-img) { background: rgba(255, 255, 255, .16) !important; color: #fff !important; border: 1px solid rgba(255, 255, 255, .3); box-shadow: none !important; }
/* sidebar */
html[data-theme-pack="desk"] .sidebar { background: linear-gradient(170deg, #2458e6 0%, #1741b8 45%, #0c2a80 100%) !important; box-shadow: 8px 0 30px rgba(15, 47, 140, .18); }
html[data-theme-pack="desk"] .nav-item { border-radius: 14px; }
html[data-theme-pack="desk"] .nav-item:hover { background: rgba(255, 255, 255, .12); }
html[data-theme-pack="desk"] .nav-item.active { background: #fff !important; color: #1d4ed8 !important; box-shadow: 0 8px 20px rgba(8, 24, 80, .25) !important; }
html[data-theme-pack="desk"] .nav-item.active small { color: #5d7bc4 !important; }
html[data-theme-pack="desk"] .nav-item.active .nav-ico { background: #eaf1ff; }
html[data-theme-pack="desk"] .side-foot { border-top-color: rgba(255, 255, 255, .16); }
/* topbar */
html[data-theme-pack="desk"] .topbar { background: rgba(241, 245, 253, .82); border-bottom: 1px solid rgba(219, 229, 247, .8); backdrop-filter: blur(12px); }
html[data-theme-pack="desk"] .top-title { background: none; -webkit-text-fill-color: currentColor; color: #0e1a3a; font-weight: 800; letter-spacing: -.02em; }
html[data-theme-pack="desk"] .icon-btn { border-radius: 14px; }
/* controls */
html[data-theme-pack="desk"] .btn { border-radius: 999px; }
html[data-theme-pack="desk"] .btn.primary, html[data-theme-pack="desk"] .btn.primary:hover { background: linear-gradient(135deg, #2a5bea, #1741b8); box-shadow: 0 8px 20px rgba(29, 78, 216, .28); }
html[data-theme-pack="desk"] .input, html[data-theme-pack="desk"] select, html[data-theme-pack="desk"] textarea { border-radius: 12px; background: #f8faff; border-color: #dbe5f7; }
html[data-theme-pack="desk"] .input:focus, html[data-theme-pack="desk"] select:focus, html[data-theme-pack="desk"] textarea:focus { background: #fff; border-color: #6f9cff; box-shadow: 0 0 0 4px rgba(29, 78, 216, .1); }
html[data-theme-pack="desk"] .seg { background: transparent; gap: 6px; padding: 0; }
html[data-theme-pack="desk"] .seg-btn { border-radius: 999px; background: #fff; border: 1px solid #dfe7f7; color: #4a5b7e; }
html[data-theme-pack="desk"] .seg-btn.on { background: #eaf1ff; border-color: #9dbdff; color: #1d4ed8; box-shadow: none; }
html[data-theme-pack="desk"] .badge, html[data-theme-pack="desk"] .chip { border-radius: 999px; }
/* tables */
html[data-theme-pack="desk"] .tbl th { background: #eef3fe; color: #50628a; font-weight: 700; }
html[data-theme-pack="desk"] .tbl thead tr:first-child th:first-child { border-top-left-radius: 12px; }
html[data-theme-pack="desk"] .tbl thead tr:first-child th:last-child { border-top-right-radius: 12px; }
html[data-theme-pack="desk"] .tbl tbody tr:hover td { background: #f3f7ff; }
/* KPI tiles */
html[data-theme-pack="desk"] .kpi { border-radius: 22px; }
/* phone bottom nav */
html[data-theme-pack="desk"] #mobile-nav.mobile-nav { background: rgba(255, 255, 255, .94) !important; border-top: 1px solid #e3eaf8 !important; backdrop-filter: blur(12px); }
html[data-theme-pack="desk"] .mobile-nav-item.active, html[data-theme-pack="desk"] .mobile-nav-item[aria-current="page"] { color: #1d4ed8 !important; }
`;

const LOGIN = `
/* ---------- login screen follows the active pack (and the default look) ---------- */
:root { --auth-1: #0b1020; --auth-2: #14163a; --auth-3: #6366f1; }
.auth-screen:has(.login-only-shell) { background:
  radial-gradient(900px 520px at 8% 0%, color-mix(in srgb, var(--auth-3) 55%, transparent), transparent 60%),
  radial-gradient(800px 520px at 100% 10%, color-mix(in srgb, var(--brand-2) 42%, transparent), transparent 60%),
  radial-gradient(900px 600px at 70% 110%, color-mix(in srgb, var(--brand) 38%, transparent), transparent 60%),
  linear-gradient(160deg, var(--auth-1), var(--auth-2)) !important; }
.login-only-shell .pro-card { background: var(--card) !important; color: var(--ink); }
.login-only-shell .pro-card::before { background: linear-gradient(90deg, var(--brand), var(--brand-2)); }
.login-only-shell .pro-login-header h3 { color: var(--ink); }
.login-only-shell .pro-login-header p, .login-only-shell .pro-note { color: var(--muted); }
.login-only-shell .login-app-brand { background: linear-gradient(120deg, color-mix(in srgb, var(--brand) 10%, var(--card)), var(--card) 60%, color-mix(in srgb, var(--brand-2) 10%, var(--card))) !important; border-color: color-mix(in srgb, var(--brand) 22%, var(--line)) !important; }
.login-only-shell .login-app-name { background: linear-gradient(90deg, var(--brand), var(--brand-2)); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent !important; }
.login-only-shell .auth-tabs { background: color-mix(in srgb, var(--brand) 10%, var(--card)) !important; }
.login-only-shell .auth-tabs .seg-btn { color: var(--brand) !important; }
.login-only-shell .auth-tabs .seg-btn.on { background: linear-gradient(135deg, var(--brand), var(--brand-2)) !important; color: #fff !important; box-shadow: 0 8px 18px color-mix(in srgb, var(--brand) 38%, transparent) !important; }
.login-only-shell .pro-label > span:first-child { color: var(--brand); }
.login-only-shell .pro-input { border-color: color-mix(in srgb, var(--brand) 28%, var(--line)) !important; background: color-mix(in srgb, var(--brand) 4%, var(--card)) !important; color: var(--ink) !important; }
.login-only-shell .pro-input:focus { border-color: var(--brand) !important; box-shadow: 0 0 0 4px color-mix(in srgb, var(--brand) 20%, transparent) !important; background: var(--card) !important; }
.login-only-shell .check { color: var(--ink); }
.login-only-shell .check input { accent-color: var(--brand); }
.login-only-shell .pro-link { color: var(--brand) !important; }
.login-only-shell .pro-submit, .login-only-shell .pro-submit:hover { background: linear-gradient(135deg, var(--brand), var(--brand-2)) !important; box-shadow: 0 12px 26px color-mix(in srgb, var(--brand) 40%, transparent) !important; color: #fff !important; }
.login-only-shell .pro-hint { background: color-mix(in srgb, var(--brand) 9%, var(--card)) !important; color: var(--ink) !important; border-color: color-mix(in srgb, var(--brand) 25%, var(--line)) !important; }
.login-only-shell .pro-info-box { background: linear-gradient(135deg, color-mix(in srgb, var(--brand) 7%, var(--card)), color-mix(in srgb, var(--brand-2) 7%, var(--card))) !important; border-color: color-mix(in srgb, var(--brand) 20%, var(--line)) !important; }
.login-only-shell .pro-info-box b:first-child, .login-only-shell .pro-info-box li b { color: var(--brand); }
.login-only-shell .pro-info-box li { color: var(--muted); }
`;

let css = `/* themes.css — GENERATED by dev/gen-themes.js (do not edit by hand). Theme packs + login screen. */\n`;
css += Object.entries(PACKS).map(([k, p]) => packCss(k, p)).join('\n\n');
css += '\n' + GENERIC + DESK + LOGIN;
fs.writeFileSync(path.join(__dirname, '..', 'themes.css'), css);

// metadata for ui-boot / wowzone picker
const meta = Object.fromEntries(Object.entries(PACKS).map(([k, p]) => [k, { name: p.name, icon: p.icon, mode: p.mode, desc: p.desc, swatch: [p.brand, p.brand2, p.sideBg, p.bg], ...(p.vivid ? { vivid: true } : {}) }]));
fs.writeFileSync(path.join(__dirname, '..', 'theme-packs.json'), JSON.stringify(meta, null, 1));
const wz = path.join(__dirname, '..', 'wowzone.js');
let src = fs.readFileSync(wz, 'utf8');
const lit = ['  const PACKS = {',
  "    default: { name: 'Default (brand colours)', icon: '🎨', mode: '', description: 'Your branding colours · light / dark / auto', contrast: 'Readable baseline', swatch: ['#4f46e5', '#ec4899', '#1e1b4b', '#f3f4fb'] },",
  ...Object.entries(PACKS).map(([k, p]) => `    ${k}: { name: ${JSON.stringify(p.name)}, icon: ${JSON.stringify(p.icon)}, mode: ${JSON.stringify(p.mode)}, description: ${JSON.stringify(p.desc)}, contrast: ${JSON.stringify(p.mode === 'dark' ? 'Light text on dark' : 'Dark text on light')}, swatch: ${JSON.stringify([p.brand, p.brand2, p.sideBg, p.bg])} },`),
  '  };'].join('\n');
src = src.replace(/(\/\/ <packs:begin>[^\n]*\n)[\s\S]*?(\n\s*\/\/ <packs:end>)/, (m, a, b) => a + lit + b);
fs.writeFileSync(wz, src);
console.log('themes.css', css.length, 'B ·', Object.keys(PACKS).length, 'packs');
