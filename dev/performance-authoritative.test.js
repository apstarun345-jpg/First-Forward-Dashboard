import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../performance.js', import.meta.url), 'utf8');
const clean = (v) => String(v ?? '').trim();
const norm = (v) => clean(v).toUpperCase().replace(/\s+/g, ' ');
const ymKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const prevMonthKey = (ym) => {
  const [y, m] = String(ym).split('-').map(Number);
  const d = new Date(y, (m || 1) - 2, 1);
  return ymKey(d);
};
const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const FF = {
  pages: {},
  util: {
    clean, num: (v) => Number(v) || 0, esc: (v) => String(v ?? ''),
    sum: (list, fn) => (list || []).reduce((n, x) => n + (Number(fn(x)) || 0), 0),
    ymKey, prevMonthKey, dateKey, labelDate: (d) => dateKey(d), labelYM: (ym) => ym,
    channelBasis: () => ({ days: 29 }), projectMonthEnd: (n) => Number(n) || 0,
    fmt: (v) => String(v), pctOf: () => 0, growth: () => 0, runRate: () => 0,
    U: null
  },
  data: {},
  charts: {},
  auth: { can: () => true },
  config: { contacts: {}, thresholds: {}, features: {}, isRealTl: (v) => !!v && !/^APS$/i.test(String(v)) },
  model: { latestDate: (rows) => (rows || []).reduce((latest, r) => (!latest || r.d > latest ? r.d : latest), null) },
  store: { get: () => undefined }
};
FF.FF = FF;
vm.runInNewContext(source, { window: FF, FF, console, Date, Map, Set, Number, String, Object, Array, Math, RegExp, JSON });

test('FF Performance authoritative index uses EIR totals and excludes GV rows', () => {
  const d = new Date(2026, 8, 29);
  const classRows = [
    { name: 'Agent One', tlName: 'TL One', channel: 'First Forward', ym: '2026-09', group: 'VC4', n: 965 },
    { name: 'Agent One', tlName: 'TL One', channel: 'First Forward', ym: '2026-09', group: 'VC20', n: 4 },
    { name: 'Agent One', tlName: 'TL One', channel: 'First Forward', ym: '2026-09', group: 'VC5+', n: 2 },
    // A same-name GV row must not leak into the FF total or commission surfaces.
    { name: 'Agent One', tlName: 'TL One', channel: 'GV Partner', ym: '2026-09', group: 'VC4', n: 500 }
  ];
  const dailyRows = [{ key: dateKey(d), d, ym: '2026-09', channel: 'First Forward', n: 971 }, { key: dateKey(d), d, ym: '2026-09', channel: 'GV Partner', n: 500 }];
  const idx = FF.pages.performance.authoritativeIndex(classRows, dailyRows);
  assert.equal(idx.cur, '2026-09');
  assert.equal(idx.byName.get(norm('Agent One')).cur.total, 971);
  assert.equal(idx.byTl.get(norm('TL One')).cur.total, 971);
  assert.equal(idx.daily.reduce((n, row) => n + row.n, 0), 971);
});
