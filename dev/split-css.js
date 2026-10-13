#!/usr/bin/env node
/* Splits styles.css: rules that only matter to ONE lazy page module move to styles-<module>.css, which
 * lazy.js loads together with that module. Source of truth is dev/styles-full.css.
 *   node dev/split-css.js          → writes styles.css + styles-<module>.css
 *   node dev/split-css.js --dry    → prints a size report only
 * A class/id token is "owned" by a module when it appears in that module's source and in NO other
 * client/server file; classes built dynamically (not found anywhere) always stay in core. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dry = process.argv.includes('--dry');
const fullPath = path.join(root, 'dev/styles-full.css');
if (!fs.existsSync(fullPath)) fs.copyFileSync(path.join(root, 'styles.css'), fullPath);
const css = fs.readFileSync(fullPath, 'utf8');

const lazySrc = fs.readFileSync(path.join(root, 'lazy.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const eagerNames = new Set([...indexHtml.matchAll(/<script[^>]*\ssrc="\/?([^"?]+)\.js/g)].map((m) => m[1]));
const jsFiles = fs.readdirSync(root).filter((f) => f.endsWith('.js') && !/^i18n|\.test\./.test(f));
const lazyNames = new Set(jsFiles.map((f) => f.replace(/\.js$/, '')).filter((n) => new RegExp(`'${n}'`).test(lazySrc) && !eagerNames.has(n) && n !== 'lazy'));
const sources = Object.fromEntries(jsFiles.map((f) => [f.replace(/\.js$/, ''), fs.readFileSync(path.join(root, f), 'utf8')]));
sources.__index = indexHtml;
for (const f of fs.readdirSync(root)) if (f.endsWith('.css') && f !== 'styles.css' && !/^styles-/.test(f)) sources['__' + f] = fs.readFileSync(path.join(root, f), 'utf8');
sources.__sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

// token → owning module (or null)
const ownerMemo = new Map();
function ownerOf(token) {
  if (ownerMemo.has(token)) return ownerMemo.get(token);
  const re = new RegExp(`(?<![\\w-])${token.replace(/[-]/g, '\\-')}(?![\\w-])`);
  const hits = Object.keys(sources).filter((k) => re.test(sources[k]));
  const o = hits.length === 1 && lazyNames.has(hits[0]) ? hits[0] : null;
  ownerMemo.set(token, o);
  return o;
}
function selectorOwner(sel) {
  if (/:(?:is|where|has)\(/.test(sel)) return null;
  const clean = sel.replace(/:not\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '');
  const toks = [...clean.matchAll(/[.#]([A-Za-z_][\w-]*)/g)].map((m) => m[1]);
  let owner = null;
  for (const t of toks) { const o = ownerOf(t); if (o) { if (owner && owner !== o) return null; owner = o; } }
  return owner;
}
function splitSelectors(sel) { const out = []; let d = 0, cur = ''; for (const ch of sel) { if (ch === '(' || ch === '[') d++; if (ch === ')' || ch === ']') d--; if (ch === ',' && !d) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((s) => s.trim()).filter(Boolean); }

// tiny top-level / one-level-nested block parser (string/comment aware)
function parseBlock(text) {
  const items = []; let i = 0; const n = text.length;
  while (i < n) {
    const m = /\S/.exec(text.slice(i)); if (!m) break; i += m.index;
    if (text.startsWith('/*', i)) { const e = text.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; items.push({ type: 'comment', text: text.slice(i, end) }); i = end; continue; }
    let j = i, depth = 0, q = null, headEnd = -1;
    for (; j < n; j++) {
      const ch = text[j];
      if (q) { if (ch === '\\') j++; else if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'") { q = ch; continue; }
      if (text.startsWith('/*', j)) { j = text.indexOf('*/', j + 2); if (j < 0) { j = n; break; } j++; continue; }
      if (ch === '{') { if (!depth) headEnd = j; depth++; }
      else if (ch === '}') { depth--; if (depth === 0) { j++; break; } }
      else if (ch === ';' && !depth) { j++; break; }
    }
    const raw = text.slice(i, j); i = j;
    if (headEnd < 0 || raw.indexOf('{') < 0) { items.push({ type: 'raw', text: raw }); continue; }
    const head = raw.slice(0, raw.indexOf('{')).trim();
    const body = raw.slice(raw.indexOf('{') + 1, raw.lastIndexOf('}'));
    if (head.startsWith('@')) items.push({ type: 'at', head, body, text: raw, inner: /^@(media|supports)/.test(head) ? parseBlock(body) : null });
    else items.push({ type: 'rule', head, body, text: raw });
  }
  return items;
}
// ---- cascade safety ---------------------------------------------------------------------------
// A moved rule loads AFTER all of styles.css. That is only safe if no rule that used to come later could
// have overridden it. So a rule stays in core when a later rule (core, or another module's chunk) sets an
// overlapping property and could hit the same element — same class, tag-only/universal selector, or two
// classes that occur together in a class string somewhere in the code.
const coPairs = new Set();
for (const text of Object.values(sources)) {
  for (const m of text.matchAll(/["'`]([A-Za-z_][\w-]*(?:[ \t]+[A-Za-z_$][\w${}-]*)+)["'`]/g)) {
    const toks = m[1].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean);
    for (const x of toks) for (const y of toks) if (x !== y) coPairs.add(x + '\u0000' + y);
  }
}
const rootProp = (p) => (p.startsWith('--') ? p : p.replace(/^-(?:webkit|moz|ms)-/, '').split('-')[0]);
const propsOf = (body) => new Set(body.replace(/\/\*[\s\S]*?\*\//g, '').split(';').map((d) => d.slice(0, d.indexOf(':')).trim().toLowerCase()).filter(Boolean).map(rootProp));
function rightmost(sel) {
  const clean = sel.replace(/:not\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '');
  let depth = 0, cut = 0;
  for (let i = 0; i < clean.length; i++) { const ch = clean[i]; if (ch === '(') depth++; else if (ch === ')') depth--; else if (!depth && /[\s>+~]/.test(ch)) cut = i + 1; }
  const last = clean.slice(cut).trim() || clean.trim();
  return { toks: [...last.matchAll(/[.#]([A-Za-z_][\w-]*)/g)].map((m) => m[1]), tag: (/^[a-z][a-z0-9]*/i.exec(last) || [''])[0].toLowerCase(), any: /^\*|^$/.test(last) };
}
function ruleOwner(r) { const sels = splitSelectors(r.head); if (!sels.length) return null; let o = null; for (const s of sels) { const so = selectorOwner(s); if (!so || (o && o !== so)) return null; o = so; } return o; }
function specOf(sel) {
  const c = sel.replace(/:(?:not|is|where|has)\(([^)]*)\)/g, ' $1 ').replace(/"[^"]*"|'[^']*'/g, '');
  const ids = (c.match(/#[\w-]+/g) || []).length;
  const cls = (c.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):(?!:)[\w-]+/g) || []).length;
  const tags = (c.replace(/\[[^\]]*\]/g, '').split(/[\s>+~]+/).filter((p) => /^[a-z][\w-]*/i.test(p.replace(/^[.#:\[].*/, ''))).length) + (c.match(/::[\w-]+/g) || []).length;
  return ids * 10000 + cls * 100 + tags;
}
const flat = [];
function addRule(r, wrapper) {
  const sels = splitSelectors(r.head);
  flat.push({ r, wrapper, owner: ruleOwner(r), props: propsOf(r.body), rm: sels.map(rightmost), spec: sels.map(specOf) });
}
const topItems = parseBlock(css);
for (const it of topItems) {
  if (it.type === 'rule') addRule(it, '');
  else if (it.type === 'at' && it.inner) for (const r of it.inner) if (r.type === 'rule') addRule(r, it.head);
}
function mayHit(A, B, SA, SB) {    // could one element match both rightmost-compounds A and B at equal specificity?
  for (let a = 0; a < A.length; a++) for (let b = 0; b < B.length; b++) {
    const x = A[a], y = B[b];
    if (SA[a] !== SB[b]) continue;      // different specificity → the winner never depended on order
    if (x.any || y.any) return true;
    if (!x.toks.length && !y.toks.length) return true;
    if (!x.toks.length || !y.toks.length) { if (!x.tag || !y.tag || x.tag === y.tag) return true; else continue; }
    for (const t of x.toks) for (const u of y.toks) if (t === u || coPairs.has(t + '\u0000' + u)) return true;
  }
  return false;
}
const byProp = new Map();
flat.forEach((f, i) => f.props.forEach((p) => { if (!byProp.has(p)) byProp.set(p, []); byProp.get(p).push(i); }));
let demoted = 1, rounds = 0;
while (demoted && rounds++ < 20) {
  demoted = 0;
  flat.forEach((f, i) => {
    if (!f.owner) return;
    let bad = false;
    for (const p of f.props) {
      for (const j of byProp.get(p) || []) {
        if (j === i) continue;
        const g = flat[j];
        const sameChunk = g.owner === f.owner;
        if (g.owner && !sameChunk) { if (!mayHit(f.rm, g.rm, f.spec, g.spec)) continue; bad = true; break; }   // other chunk: load order unknown (earlier or later)
        if (!g.owner && j < i) continue;                                                       // earlier core rule: still loses to us
        if (sameChunk) continue;                                                               // order kept inside the chunk
        if (mayHit(f.rm, g.rm, f.spec, g.spec)) { bad = true; break; }                                          // later core rule could override us
      }
      if (bad) break;
    }
    if (bad) { f.owner = null; demoted++; }
  });
}
const movedSet = new Map(flat.filter((f) => f.owner).map((f) => [f.r, f.owner]));
const chunks = {}; const core = [];
const put = (mod, s) => { (chunks[mod] = chunks[mod] || []).push(s); };
function ruleOwner2(r) { return movedSet.get(r) || null; }
for (const it of topItems) {
  if (it.type === 'rule') { const o = ruleOwner2(it); if (o) put(o, it.text); else core.push(it.text); }
  else if (it.type === 'at' && it.inner) {
    const perMod = {}; const keep = [];
    for (const r of it.inner) {
      if (r.type === 'rule') { const o = ruleOwner2(r); if (o) (perMod[o] = perMod[o] || []).push(r.text); else keep.push(r.text); }
      else keep.push(r.text);
    }
    for (const [m, arr] of Object.entries(perMod)) put(m, `${it.head} {\n${arr.join('\n')}\n}`);
    if (keep.some((t) => !/^\/\*/.test(t.trim())) || !Object.keys(perMod).length) core.push(`${it.head} {\n${keep.join('\n')}\n}`);
  } else core.push(it.text);
}
const coreCss = core.join('\n') + '\n';
const sz = (s) => Buffer.byteLength(s);
console.log(`core ${sz(coreCss)} B (was ${sz(css)} B) · ${Object.keys(chunks).length} chunks · moved ${sz(css) - sz(coreCss)} B`);
if (dry) { for (const [m, a] of Object.entries(chunks).sort((x, y) => sz(y[1].join('')) - sz(x[1].join(''))).slice(0, 12)) console.log(' ', m, sz(a.join('\n'))); process.exit(0); }
for (const f of fs.readdirSync(root)) if (/^styles-.+\.css$/.test(f)) fs.unlinkSync(path.join(root, f));
fs.writeFileSync(path.join(root, 'styles.css'), coreCss);
for (const [m, a] of Object.entries(chunks)) fs.writeFileSync(path.join(root, `styles-${m}.css`), `/* generated by dev/split-css.js — rules only used by ${m}.js (source: dev/styles-full.css) */\n${a.join('\n')}\n`);
