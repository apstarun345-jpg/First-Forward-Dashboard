/* 🌐 SITE-WIDE LANGUAGE (v3.20) — English · Hinglish · हिंदी.
   Covered: FF.i18n dictionary, phrase matcher, DOM walker (text + title/placeholder/aria-label),
            source-language passthrough, numbers/names untouched, app.js wiring. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const src = read('i18n.js');

// i18n.js browser IIFE ko chalaate hain — chhota sa fake window.
const sandbox = {};
const win = { FF: {} };
sandbox.window = win;
new Function('window', 'document', 'localStorage', 'NodeFilter', src)(win, undefined, {
  getItem: () => null, setItem: () => {}
}, { SHOW_TEXT: 4 });
const i18n = win.FF.i18n;

test('i18n module load hota hai aur teen languages deta hai', () => {
  assert.ok(i18n, 'FF.i18n missing');
  assert.equal(i18n.SOURCE, 'hinglish', 'source language Hinglish hona chahiye');
  assert.deepEqual(i18n.langs.map((l) => l[0]), ['en', 'hinglish', 'hi']);
  assert.ok(i18n.size() > 300, `dictionary bahut chhoti: ${i18n.size()}`);
});

test('Hinglish = source (kuch translate nahi hota)', () => {
  assert.equal(i18n.t('Total', 'hinglish'), 'Total');
  assert.equal(i18n.t('Expected month-end', 'hinglish'), 'Expected month-end');
  assert.equal(i18n.has('Total', 'hinglish'), false);
});

test('English: shabd table headers, KPI labels aur buttons translate hote hain', () => {
  assert.equal(i18n.t('Total', 'en'), 'Total');
  assert.equal(i18n.t('Expected month-end', 'en'), 'Expected month-end');
  assert.equal(i18n.t('Tag required', 'en'), 'Tag required');
  assert.equal(i18n.t('Dispatch ready', 'en'), 'Dispatch ready');
  assert.equal(i18n.t('Performance', 'en'), 'Performance');
  assert.equal(i18n.t('Stock Forecasting', 'en'), 'Stock Forecasting');
  // sentence ke andar bhi replace ho jata hai (longest phrase first)
  const s = i18n.t('VC4 Commercial ke liye Total', 'en');
  assert.ok(/Total/.test(s));
});

test('हिंदी: shabd Devanagari me translate hote hain', () => {
  assert.ok(/[ऀ-ॿ]/.test(i18n.t('Performance', 'hi')), 'performance Devanagari me aana chahiye');
  assert.ok(/[ऀ-ॿ]/.test(i18n.t('Dispatch ready', 'hi')));
  assert.ok(/[ऀ-ॿ]/.test(i18n.t('aaj ka data kal aata hai', 'hi')));
  assert.equal(i18n.t('VC4', 'hi'), 'VC4', 'class code (VC4) change na ho');
  assert.equal(i18n.t('First Forward', 'hi'), 'फर्स्ट फॉरवर्ड');
});

test('numbers, dates aur agent names untouched rehte hain', () => {
  for (const s of ['VC4', '2026-09-29', '₹1,23,456', 'AJAY SINGH', 'TO2 Corporation', 'ApnaPayment Pvt. Ltd.', '1234']) {
    assert.equal(i18n.t(s, 'en'), s, `english me " + s + " badal na jaaye`);
    assert.equal(i18n.t(s, 'hi'), s, `hindi me "${s}" badal na jaaye`);
  }
});

test('unknown shabd source (Hinglish) hi wapas deta hai — kuch khoota nahi', () => {
  const odd = 'zzzqqq wwxyy123';
  assert.equal(i18n.t(odd, 'en'), odd);
  assert.equal(i18n.t(odd, 'hi'), odd);
});

test('DOM walker: text nodes + title/placeholder/aria-label sab translate', () => {
  // ---- minimal fake DOM
  const mk = (tag, attrs = {}, kids = []) => ({
    tagName: tag.toUpperCase(), attrs, children: kids, _text: '',
    get textContent() { return this._text + this.children.map((c) => c.textContent || '').join(''); },
    getAttribute(a) { return Object.prototype.hasOwnProperty.call(this.attrs, a) ? this.attrs[a] : null; },
    setAttribute(a, v) { this.attrs[a] = v; },
    querySelectorAll: () => [],
    ownerDocument: null
  });
  const doc = { createTreeWalker: () => ({ nextNode: null }) };
  const mkText = (v) => ({ nodeValue: v, textContent: v });
  const h1 = mk('h1', {}, [mkText('Performance')]);
  const btn = mk('button', { title: 'Refresh', 'aria-label': 'Search' }, [mkText('Export')]);
  const inp = mk('input', { placeholder: 'Search koi bhi agent' });
  const table = mk('table', {}, [mk('td', {}, [mkText('Total')]), mk('th', {}, [mkText('Stock')])]);
  const root = mk('main', {}, [h1, btn, inp, table]);
  root.ownerDocument = doc;

  // text-node walk: h1/button/table ke text nodes walk karne wale walker se
  const texts = [];
  const collect = (el) => { if (el.nodeValue !== undefined) texts.push(el); (el.children || []).forEach(collect); };
  collect(root);
  const walker = (() => { let i = 0; return { nextNode: () => (i < texts.length ? texts[i++] : null) }; })();
  doc.createTreeWalker = () => walker;

  // 🔤 Hindi me pakda jata hai (Hinglish se asal me alag)
  const h1b = mk('h1', {}, [mkText('Performance')]);
  const btnB = mk('button', { title: 'Dispatch ready', 'aria-label': 'Search' }, [mkText('Export')]);
  const tblB = mk('table', {}, [mk('td', {}, [mkText('Total')]), mk('th', {}, [mkText('Stock')])]);
  const inpB = mk('input', { placeholder: 'aaj ka data kal aata hai' });
  const rootB = mk('main', {}, [h1b, btnB, inpB, tblB]);
  rootB.ownerDocument = doc;
  const texts2 = [];
  const collect2 = (el) => { if (el.nodeValue !== undefined) texts2.push(el); (el.children || []).forEach(collect2); };
  collect2(rootB);
  let j = 0;
  doc.createTreeWalker = () => ({ nextNode: () => (j < texts2.length ? texts2[j++] : null) });
  rootB.querySelectorAll = () => [h1b, btnB, inpB, tblB, ...tblB.children];

  const changed = i18n.translateTree(rootB, 'hi');
  assert.equal(changed, true, 'walker ne change report kiya');
  assert.match(h1b.children[0].nodeValue, /[ऀ-ॿ]/, 'h1 heading translate hui');
  assert.equal(btnB.children[0].nodeValue, 'निर्यात', 'button text translate hua');
  assert.equal(tblB.children[0].children[0].nodeValue, 'कुल', 'table cell translate hua');
  assert.equal(tblB.children[1].children[0].nodeValue, 'स्टॉक', 'table header translate hua');
  assert.equal(btnB.getAttribute('title'), 'डिस्पैच के लिए तैयार', 'title attribute translate hua');
  assert.equal(btnB.getAttribute('aria-label'), 'खोजें', 'aria-label translate hua');
  assert.equal(inpB.getAttribute('placeholder'), 'आज का डेटा कल आता है', 'placeholder translate hua');
});

test('Hinglish me walker kuch nahi badalta (no-op)', () => {
  const el = { attrs: { title: 'Refresh' }, getAttribute(a) { return this.attrs[a]; }, setAttribute() { throw new Error('Hinglish me write nahi hona chahiye'); }, querySelectorAll: () => [] };
  assert.equal(i18n.translateTree(el, 'hinglish'), false);
});

test('app.js translateDom ab poora tree walk karta hai, sirf page-head nahi', () => {
  const app = read('app.js');
  const m = app.match(/function translateDom\(root\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(m, 'translateDom not found');
  assert.ok(/FF\.i18n\.translateTree\(/.test(m[0]), 'poora tree walk call hona chahiye');
  assert.ok(!/\.page-head h1, \.page-head \.sub, \.btn, \.seg-btn/.test(m[0]), 'purana limited selector hatana hai');
  // index.html me i18n.js load ho raha hai
  const html = read('index.html');
  assert.ok(/src="i18n\.js\?v=/.test(html), 'index.html me i18n.js include hona chahiye');
  assert.ok(html.indexOf('i18n.js') < html.indexOf('src="app.js'), 'i18n app.js se pehle load hona chahiye');
});
