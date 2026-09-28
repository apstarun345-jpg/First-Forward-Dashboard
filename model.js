/* Analytics model: aggregated views of EIR (issuance) & StockDataa (inventory) built from gviz group-by queries. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const D = FF.data;

  // Normalise a class cell: EIR has "VC4", StockDataa has "4" → both become "VC4".
  const normClass = (raw) => { const c = U.clean(raw).toUpperCase(); if (!c) return 'NA'; return /^\d+$/.test(c) ? `VC${c}` : c; };
  const classGroup = (cls) => {
    const c = normClass(cls);
    if (c === 'VC4') return 'VC4';
    if (c === 'VC20') return 'VC20';
    return 'VC5+';
  };
  const channelOf = (masterId, tlName) => {
    const e = FF.config.eir;
    const gvId = U.clean(e.gvMasterId || '5845036').replace(/\.0+$/, '');
    const id = U.clean(masterId).replace(/\.0+$/, '');
    if ((gvId && id === gvId) || U.clean(tlName).toLowerCase() === U.clean(e.gvChannelTl || 'ApnaPayment Pvt. Ltd.').toLowerCase()) return 'GV Partner';
    return 'First Forward';
  };

  function whereClause(filter) {
    const e = FF.config.eir;
    const parts = [`${e.date} is not null`];
    if (filter && filter.tl) parts.push(`${e.tlName} = ${D.lit(filter.tl)}`);
    if (filter && filter.agent) parts.push(`(${e.agentName} = ${D.lit(filter.agent)} or ${e.gvName} = ${D.lit(filter.agent)})`);
    if (filter && filter.channel === 'GV Partner') parts.push(`${e.masterId} is not null`);
    if (filter && filter.channel === 'First Forward') parts.push(`${e.masterId} is null`);
    return parts.join(' and ');
  }

  /** Daily rows: [{ key, d, ym, day, cls, group, type, vrnType, channel, n }] */
  async function loadDaily(filter, opts) {
    const e = FF.config.eir;
    // TL name bhi select karo: kuch legacy GV rows me master ID blank hai, lekin GV channel TL
    // present hai. Sirf master ID dekhne se woh galat First Forward totals me jud jaate the.
    const tq = `select ${e.date}, ${e.cls}, ${e.type}, ${e.vrnType}, ${e.masterId}, ${e.tlName}, count(${e.tagId}) where ${whereClause(filter)} group by ${e.date}, ${e.cls}, ${e.type}, ${e.vrnType}, ${e.masterId}, ${e.tlName} order by ${e.date}`;
    const t = await D.query(e.sheet, tq, opts);
    const rows = [];
    for (const r of t.rows) {
      const d = D.cellDate(r[0]);
      const n = D.cellNumber(r[6]);
      if (!d || !n) continue;
      const cls = normClass(D.cellText(r[1]));
      rows.push({
        key: U.dateKey(d), d, ym: U.ymKey(d), day: d.getDate(), cls, group: classGroup(cls),
        type: D.cellText(r[2]).toUpperCase() || 'ISSUANCE', vrnType: D.cellText(r[3]),
        channel: channelOf(D.cellText(r[4]), D.cellText(r[5])), n
      });
    }
    return rows;
  }

  /** Agents by month: [{ id, name, channel, tlId, tlName, gvId, gvName, ym, n }] */
  async function loadAgents(opts) {
    const e = FF.config.eir;
    const tq = `select ${e.agentId}, ${e.agentName}, ${e.gvId}, ${e.gvName}, ${e.tlId}, ${e.tlName}, ${e.masterId}, year(${e.date}), month(${e.date}), count(${e.tagId}) where ${e.date} is not null group by ${e.agentId}, ${e.agentName}, ${e.gvId}, ${e.gvName}, ${e.tlId}, ${e.tlName}, ${e.masterId}, year(${e.date}), month(${e.date})`;
    const t = await D.query(e.sheet, tq, opts);
    const rows = [];
    for (const r of t.rows) {
      const y = D.cellNumber(r[7]), m = D.cellNumber(r[8]), n = D.cellNumber(r[9]);
      if (y === null || m === null || !n) continue;
      const agentId = D.cellText(r[0]), agentName = D.cellText(r[1]);
      const gvId = D.cellText(r[2]), gvName = D.cellText(r[3]);
      const tlName = D.cellText(r[5]);
      const channel = channelOf(D.cellText(r[6]), tlName);
      const id = agentId || gvId;
      const name = agentName || gvName || (id ? `Agent ${id}` : 'Unknown');
      rows.push({ id, name, key: `${channel}|${id}|${name}`, channel, tlId: D.cellText(r[4]), tlName: tlName || '—', gvId, gvName, ym: `${y}-${U.pad2(m + 1)}`, n });
    }
    return rows;
  }

  /** Tag status by month: [{ ym, status, n }] */
  async function loadStatus(opts) {
    const e = FF.config.eir;
    const tq = `select year(${e.date}), month(${e.date}), ${e.status}, count(${e.tagId}) where ${e.date} is not null group by year(${e.date}), month(${e.date}), ${e.status}`;
    const t = await D.query(e.sheet, tq, opts);
    return t.rows.map((r) => {
      const y = D.cellNumber(r[0]), m = D.cellNumber(r[1]);
      return y === null || m === null ? null : { ym: `${y}-${U.pad2(m + 1)}`, status: D.cellText(r[2]).toUpperCase() || 'UNKNOWN', n: D.cellNumber(r[3]) || 0 };
    }).filter(Boolean);
  }

  /** Stock by class × TL: [{ cls, group, tlName, n }] */
  async function loadStock(opts) {
    const s = FF.config.stock;
    const tq = `select ${s.cls}, ${s.tlName}, count(${s.tagId}) where ${s.tagId} is not null group by ${s.cls}, ${s.tlName}`;
    const t = await D.query(s.sheet, tq, opts);
    return t.rows.map((r) => {
      const cls = normClass(D.cellText(r[0]));
      return { cls, group: classGroup(cls), tlName: D.cellText(r[1]) || '—', n: D.cellNumber(r[2]) || 0 };
    });
  }

  /** Stock by agent × class: [{ agentId, agentName, tlName, cls, n }] */
  async function loadStockAgents(opts) {
    const s = FF.config.stock;
    const tq = `select ${s.agentId}, ${s.agentName}, ${s.tlName}, ${s.cls}, count(${s.tagId}) where ${s.tagId} is not null group by ${s.agentId}, ${s.agentName}, ${s.tlName}, ${s.cls}`;
    const t = await D.query(s.sheet, tq, opts);
    return t.rows.map((r) => {
      const raw = D.cellText(r[3]);
      const cls = normClass(raw);
      return { agentId: D.cellText(r[0]), agentName: D.cellText(r[1]) || '—', tlName: D.cellText(r[2]) || '—', cls, group: classGroup(cls), n: D.cellNumber(r[4]) || 0 };
    });
  }

  /** Agent × TL × month × class group: [{ id, name, tlName, channel, ym, group, type, n }] — powers
      the VC4 / VC20 / VC5+ last-vs-current comparison for any agent or TL without extra queries. */
  async function loadAgentClassMonthly(opts) {
    const e = FF.config.eir;
    const tq = `select ${e.agentName}, ${e.gvName}, ${e.tlName}, ${e.masterId}, year(${e.date}), month(${e.date}), ${e.cls}, ${e.type}, count(${e.tagId}) where ${e.date} is not null group by ${e.agentName}, ${e.gvName}, ${e.tlName}, ${e.masterId}, year(${e.date}), month(${e.date}), ${e.cls}, ${e.type}`;
    const t = await D.query(e.sheet, tq, opts);
    const rows = [];
    for (const r of t.rows) {
      const y = D.cellNumber(r[4]), m = D.cellNumber(r[5]), n = D.cellNumber(r[8]);
      if (y === null || m === null || !n) continue;
      const agentName = D.cellText(r[0]), gvName = D.cellText(r[1]), tlName = D.cellText(r[2]) || '—';
      const cls = normClass(D.cellText(r[6]));
      rows.push({ name: agentName || gvName || 'Unknown', tlName, channel: channelOf(D.cellText(r[3]), tlName), ym: `${y}-${U.pad2(m + 1)}`, cls, group: classGroup(cls), type: D.cellText(r[7]).toUpperCase() || 'ISSUANCE', n });
    }
    return rows;
  }

  /**
   * Exact custom-range people rows. Grouping by date keeps active-day counts accurate while Google
   * does the heavy aggregation (the browser never downloads raw EIR rows).
   * [{ id, name, tlName, channel, key, cls, group, type, dateKey, n }]
   */
  async function loadRangePeople(from, to, opts) {
    const iso = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '';
    const start = iso(from), end = iso(to);
    if (!start || !end || start > end) throw new Error('Date range valid nahi hai.');
    const e = FF.config.eir;
    const tq = `select ${e.agentId}, ${e.agentName}, ${e.gvId}, ${e.gvName}, ${e.tlId}, ${e.tlName}, ${e.masterId}, ${e.date}, ${e.cls}, ${e.type}, count(${e.tagId}) where ${e.date} >= date '${start}' and ${e.date} <= date '${end}' and ${e.tagId} is not null group by ${e.agentId}, ${e.agentName}, ${e.gvId}, ${e.gvName}, ${e.tlId}, ${e.tlName}, ${e.masterId}, ${e.date}, ${e.cls}, ${e.type}`;
    const t = await D.query(e.sheet, tq, opts);
    const rows = [];
    for (const r of t.rows) {
      const d = D.cellDate(r[7]);
      const n = D.cellNumber(r[10]);
      if (!d || !n) continue;
      const agentId = D.cellText(r[0]), agentName = U.clean(D.cellText(r[1]));
      const gvId = D.cellText(r[2]), gvName = U.clean(D.cellText(r[3]));
      const tlName = U.clean(D.cellText(r[5])) || 'Direct';
      const channel = channelOf(D.cellText(r[6]), tlName);
      const id = channel === 'GV Partner' ? (gvId || agentId) : (agentId || gvId);
      const name = channel === 'GV Partner' ? (gvName || agentName || id) : (agentName || gvName || id);
      if (!name) continue;
      const cls = normClass(D.cellText(r[8]));
      rows.push({ id, name, tlId: D.cellText(r[4]), tlName, channel, key: `${channel}|${id || name}`, cls, group: classGroup(cls), type: D.cellText(r[9]).toUpperCase() || 'ISSUANCE', dateKey: U.dateKey(d), n });
    }
    return rows;
  }

  /**
   * Optional unified stock-movement ledger (First Forward spreadsheet).
   * Expected columns are configurable: Date, Channel, Type, Quantity, Class, From, To, Reference, Note.
   * Returns signed stock impact without guessing unknown movement types.
   */
  async function loadStockMovements(from, to, opts) {
    const m = FF.config.stockMovement || {};
    if (m.enabled !== true) return { configured: false, rows: [], invalid: [] };
    const iso = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '';
    const start = iso(from), end = iso(to);
    if (!start || !end || start > end) throw new Error('Movement date range valid nahi hai.');
    const required = ['date', 'channel', 'type', 'quantity'];
    if (!m.sheet || required.some((key) => !/^[A-Z]{1,3}$/i.test(String(m[key] || '')))) throw new Error('Stock movement ledger mapping incomplete hai.');
    const selected = [['date', m.date], ['channel', m.channel], ['type', m.type], ['quantity', m.quantity], ['cls', m.cls], ['from', m.from], ['to', m.to], ['reference', m.reference], ['note', m.note]]
      .map(([key, col]) => [key, String(col || '').trim().toUpperCase()]).filter(([, col]) => col);
    const index = Object.fromEntries(selected.map(([key], i) => [key, i]));
    const select = selected.map(([, col]) => col).join(', ');
    const tq = `select ${select} where ${m.date} >= date '${start}' and ${m.date} <= date '${end}' and ${m.quantity} is not null order by ${m.date}`;
    const t = await D.query(m.sheet, tq, opts);
    const normalizeChannel = (value) => {
      const x = U.clean(value).toUpperCase();
      if (/\bGV\b|GV PARTNER/.test(x)) return 'GV Partner';
      if (/\bFF\b|FIRST FORWARD/.test(x)) return 'First Forward';
      return '';
    };
    const signedImpact = (type, quantity) => {
      const x = U.clean(type).toUpperCase().replace(/[_-]+/g, ' '), q = Number(quantity);
      if (!Number.isFinite(q) || q === 0) return null;
      if (/TRANSFER\s*IN|^IN$|INWARD|RECEIPT|RECEIVED|RESTOCK|RETURN\s*IN/.test(x)) return Math.abs(q);
      if (/TRANSFER\s*OUT|^OUT$|OUTWARD|DAMAGE|DAMAGED|LOSS|LOST|WRITE\s*OFF|RETURN\s*OUT/.test(x)) return -Math.abs(q);
      if (/^TRANSFER$|INTERNAL\s*TRANSFER/.test(x)) return 0;
      if (/ADJUST/.test(x)) return q;
      return null;
    };
    const rows = [], invalid = [];
    t.rows.forEach((r, rowIndex) => {
      const at = (key) => index[key] === undefined ? null : r[index[key]];
      const date = D.cellDate(at('date')), channel = normalizeChannel(D.cellText(at('channel'))), type = D.cellText(at('type')), quantity = D.cellNumber(at('quantity'));
      const impact = signedImpact(type, quantity);
      const row = { date, dateKey: date ? U.dateKey(date) : '', channel, type, quantity: Number(quantity) || 0, impact,
        cls: D.cellText(at('cls')) || 'NA', from: D.cellText(at('from')), to: D.cellText(at('to')), reference: D.cellText(at('reference')), note: D.cellText(at('note')), row: rowIndex + 2 };
      if (!date || !channel || impact === null) invalid.push(row); else rows.push(row);
    });
    return { configured: true, rows, invalid, source: m.sheet };
  }

  /** Raw StockDataa rows for one agent / TL / class (used for Excel export). Returns { header, rows } */
  async function loadStockRows(filter, opts) {
    const s = FF.config.stock;
    const parts = [`${s.tagId} is not null`];
    if (filter.agent) parts.push(`${s.agentName} = ${D.lit(filter.agent)}`);
    if (filter.agentId) parts.push(`${s.agentId} = ${D.lit(filter.agentId)}`);
    if (filter.tl) parts.push(`${s.tlName} = ${D.lit(filter.tl)}`);
    if (filter.cls) parts.push(`${s.cls} = ${D.lit(String(filter.cls).replace(/^VC/i, ''))}`);
    const tq = `select * where ${parts.join(' and ')}${filter.limit ? ` limit ${filter.limit}` : ''}`;
    const t = await D.query(s.sheet, tq, opts);
    // Friendly names for known StockDataa columns — ABSOLUTE sheet column letter (config ke
    // id/name/tagId/… letters) se map hote hain, taaki manual range (A5:M, B2:N …) badalne par bhi
    // Excel header column ka sahi naam rakhe.
    const friendly = {};
    [['id', 'ID'], ['name', 'Name'], ['tagId', 'Tag ID'], ['barcode', 'Barcode'], ['cls', 'Class'], ['tagType', 'Tag Type'], ['bcAllocatedAt', 'BC Allocated At'], ['agentId', 'Agent ID'], ['agentName', 'Agent Name'], ['agentAllocatedAt', 'Agent Allocated At'], ['tlName', 'TL Name']].forEach(([k, label]) => {
      const L = String(s[k] || '').trim().toUpperCase(); if (L) friendly[L] = label;
    });
    // Manual range ka start column (Settings → sheets & tabs) — returned columns isi se absolute hote hain.
    const tab = (FF.config.sheetByName && FF.config.sheetByName(s.sheet)) || null;
    const rangeStr = String((tab && tab.range) || '').toUpperCase();
    const mRange = rangeStr.match(/^([A-Z]+)\d*/);
    const startLetter = (mRange ? mRange[1] : String((tab && tab.startCol) || 'A')).toUpperCase() || 'A';
    const startIdx = Math.max(0, U.colIndex(startLetter));
    const labels = t.cols.map((c) => U.clean(c.label));
    const isLetterLabel = (v) => /^[A-Z]{1,3}$/.test(String(v || '').trim().toUpperCase());
    const looksLikeData = (v) => {
      const x = String(v || '');
      if (!x) return false;
      if (/^-?\d+(\.\d+)?$/.test(x)) return true;                 // pure number (id, count)
      if (/\d{3,}/.test(x)) return true;                          // tag / agent IDs, serials, dates
      if (/^Date\(/.test(x)) return true;                         // gviz Date(…) cell
      return /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(x);         // 12/05/2026 style date
    };
    const parsedHeader = Number(t.headers || 0) > 0;
    const dataCols = labels.filter((v) => v && !isLetterLabel(v) && looksLikeData(v)).length;
    // Bug fix: manual range header row se shuru na ho to gviz pehle DATA row ko hi header bana
    // deta hai — Excel (Summary + StockDataa rows) me "header" row me IDs aur naam aa jaate the.
    // Pehchano: header agar data jaisa dikhe to config se banao aur khedi gayi data row wapas jodo.
    const bogusHeader = parsedHeader && dataCols > 0 && (dataCols >= 2 || dataCols / Math.max(1, labels.length) >= 0.15);
    let rows = D.textRows(t);
    let header;
    if (parsedHeader && !bogusHeader) {
      header = labels.map((l, i) => {
        const abs = U.colLetter(startIdx + i);
        // Letter label (koi header parse nahi hua) → config ka naam; real header text hi asli header.
        if (l && isLetterLabel(l)) return friendly[abs] || abs;
        return l || friendly[abs] || abs;
      });
    } else {
      header = t.cols.map((c, i) => {
        const abs = U.colLetter(startIdx + i);
        const lbl = labels[i];
        // Data row header ban chuki ho ya letter labels hon → config ke naam (absolute column se).
        if (bogusHeader || (lbl && isLetterLabel(lbl))) return friendly[abs] || abs;
        return friendly[abs] || lbl || abs;
      });
      // gviz ne header banai hui data row Excel me row-1 thi, rows me nahi aayi — wapas jodo taaki
      // ek bhi StockDataa row export se drop na ho.
      if (bogusHeader) rows = [labels.map((l) => l || ''), ...rows];
    }
    return { header, rows, cols: t.cols };
  }

  /** Stock per agent × tag type × class (for the agent pivot). */
  async function loadStockAgentTypes(opts) {
    const s = FF.config.stock;
    const tq = `select ${s.agentId}, ${s.agentName}, ${s.tlName}, ${s.cls}, ${s.tagType}, count(${s.tagId}) where ${s.tagId} is not null group by ${s.agentId}, ${s.agentName}, ${s.tlName}, ${s.cls}, ${s.tagType}`;
    const t = await D.query(s.sheet, tq, opts);
    return t.rows.map((r) => {
      const raw = D.cellText(r[3]);
      const cls = normClass(raw);
      return { agentId: D.cellText(r[0]), agentName: D.cellText(r[1]) || '—', tlName: D.cellText(r[2]) || '—', cls, group: classGroup(cls), tagType: D.cellText(r[4]) || '—', n: D.cellNumber(r[5]) || 0 };
    });
  }

  /**
   * 🧓 Aged stock — kitna stock kitne din purana (bcAllocatedAt se). Buckets: 0-15 / 16-30 / 31-60 / 60+.
   * Fail-safe: sheet/date parse fail ho to { error } return — card dim note dikhata hai.
   */
  async function loadStockAging(opts) {
    const s = FF.config.stock;
    const bc = String(s.bcAllocatedAt || '').trim().toUpperCase();
    if (!bc || !s.tagId) return { error: 'BC Allocated At column set nahi (Settings → Sheets & tabs)' };
    const tq = `select ${s.tagId}, ${bc} where ${s.tagId} is not null`;
    const t = await D.query(s.sheet, tq, opts);
    const rows = D.textRows(t);
    const parseDay = (v) => {
      const x = String(v || '');
      let m = x.match(/Date\((\d{4}),(\d{1,2}),(\d{1,2})/);
      if (m) return Date.UTC(+m[1], +m[2], +m[3]);
      m = x.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
      m = x.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/); // dd/MM/yyyy (IST sheet format)
      if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return Date.UTC(y, +m[2] - 1, +m[1]); }
      return 0;
    };
    const now = Date.now();
    const b = { '0-15': 0, '16-30': 0, '31-60': 0, '60+': 0 };
    let unknown = 0, total = 0, oldest = 0;
    for (const r of rows) {
      total++;
      const day = parseDay(r[1]);
      if (!day) { unknown++; continue; }
      const age = Math.floor((now - day) / 86400e3);
      if (age > oldest) oldest = age;
      if (age <= 15) b['0-15']++;
      else if (age <= 30) b['16-30']++;
      else if (age <= 60) b['31-60']++;
      else b['60+']++;
    }
    return { buckets: b, unknown, total, oldest };
  }

  // ---- derived helpers ---------------------------------------------------------
  function months(daily) { return U.uniq((daily || []).map((r) => r.ym)).sort(); }
  function latestDate(daily) { return (daily || []).reduce((acc, r) => (!acc || r.d > acc ? r.d : acc), null); }

  /** Per-day totals for a month: { days:[1..N], labels, totals[], byGroup:{...} } */
  function dailySeries(daily, ym, dimFn) {
    const n = U.daysInMonth(ym);
    const totals = new Array(n).fill(0);
    const dims = new Map();
    for (const r of daily) {
      if (r.ym !== ym) continue;
      totals[r.day - 1] += r.n;
      if (dimFn) {
        const k = dimFn(r);
        if (!dims.has(k)) dims.set(k, new Array(n).fill(0));
        dims.get(k)[r.day - 1] += r.n;
      }
    }
    const { y, m } = U.ymParts(ym);
    const days = Array.from({ length: n }, (_, i) => i + 1);
    return { ym, days, labels: days.map(String), dates: days.map((d) => new Date(y, m - 1, d)), totals, dims };
  }

  function summary(daily, ym, upToDay) {
    const s = { ym, total: 0, vc4: 0, vc20: 0, vc5p: 0, comm: 0, issuance: 0, replacement: 0, chassis: 0, wrongVrn: 0, ff: 0, gv: 0, days: new Set(), lastDay: 0 };
    for (const r of daily) {
      if (r.ym !== ym) continue;
      if (upToDay && r.day > upToDay) continue;
      s.total += r.n;
      if (r.group === 'VC4') s.vc4 += r.n; else if (r.group === 'VC20') s.vc20 += r.n; else s.vc5p += r.n;
      if (r.type === 'REPLACEMENT') s.replacement += r.n; else s.issuance += r.n;
      if (/chassis/i.test(r.vrnType)) s.chassis += r.n;
      if (/wrong/i.test(r.vrnType)) s.wrongVrn += r.n;
      if (r.channel === 'GV Partner') s.gv += r.n; else s.ff += r.n;
      s.days.add(r.day);
      if (r.day > s.lastDay) s.lastDay = r.day;
    }
    s.comm = s.vc20 + s.vc5p;
    s.activeDays = s.days.size;
    s.avgPerDay = s.activeDays ? s.total / s.activeDays : 0;
    s.daysInMonth = U.daysInMonth(ym);
    s.projected = s.lastDay ? Math.round((s.total / s.lastDay) * s.daysInMonth) : 0;
    return s;
  }

  function byDim(daily, ym, dimFn) {
    const map = new Map();
    for (const r of daily) { if (ym && r.ym !== ym) continue; const k = dimFn(r); map.set(k, (map.get(k) || 0) + r.n); }
    return map;
  }

  FF.model = { classGroup, channelOf, loadDaily, loadAgents, loadStatus, loadStock, loadStockAgents, loadAgentClassMonthly, loadRangePeople, loadStockMovements, loadStockRows, loadStockAgentTypes, loadStockAging, months, latestDate, dailySeries, summary, byDim };
})(window.FF);
