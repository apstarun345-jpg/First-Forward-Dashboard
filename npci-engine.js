// 🛰️ v3.125.303 — NPCI Status engine (server). Pehle ye sab handleApi ke andar har request par dobara banta tha.
//
//  1. Rate gate (tez + bina error): concurrency nahi, "requests / second" seekhta hai. Kaamyaab call par rate dheere badhta hai,
//     429 aaye to us rate ko "chhat" (ceil) maan ke 60% par aata hai aur chhat ke 90% tak hi wapas jaata hai — sawtooth / 25s ruk khatam.
//     Ek saath kitni calls = rate × API latency (3s latency par 3 nahi, jitni chahiye utni). Seekha hua rate disk par yaad rehta hai.
//  2. Pichhli 5 runs + CHALTA run: job shuru hote hi history me aata hai, har 10s disk par checkpoint (sheet par ~3 min me),
//     server restart / deploy ke baad page kholte hi bache hue items apne aap resume.
//  3. History load kabhi "khali" nahi: sheet load slow ho to `loading`, fail ho to purani history overwrite NAHI hoti.
import zlib from 'node:zlib';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';

const gzipA = promisify(zlib.gzip);
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

export const NPCI_URL_DEFAULT = 'https://www.apnapayment.com/api/agent/idfc/verifyNpciStatus';
export const npciKind = (v) => (/^\d{8,}$/.test(v) ? 'Barcode' : /^[0-9A-F]{19,24}$/.test(v) ? 'Tag ID' : (/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/.test(v) || /^\d{2}BH\d{4}[A-Z]{1,2}$/.test(v) || v.length <= 10) ? 'VRN' : 'Chassis');
export const npciPrimary = (recs) => (!recs || !recs.length ? null : (recs.find((d) => d.TAGSTATUS === 'A' || /^active$/i.test(d.npci_ExcCode)) || recs.find((d) => !/closed|replaced|blacklist/i.test(d.npci_ExcCode)) || recs[0]));
export const npciIsRetry = (r) => !r.ok && (r.retry || /busy|429|HTML|time out|fetch|fail$/i.test(r.msg || ''));
export const cleanItem = (x) => String(x || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

export function npciSummary(rows, total) {
  const s = { total: Math.max(total || 0, rows.length), checked: rows.length, kind: { 'Tag ID': 0, Barcode: 0, VRN: 0, Chassis: 0 }, found: 0, notFound: 0, retry: 0, upd: 0, notUpd: 0, updBase: 0, status: {}, active: 0 };
  for (const r of rows) {
    s.kind[r.kind] = (s.kind[r.kind] || 0) + 1;
    const prim = npciPrimary(r.records);
    if (prim) s.found++; else if (npciIsRetry(r)) s.retry++; else s.notFound++;
    const key = prim ? (prim.npci_ExcCode || prim.tagDetails_npci_ExcCode || 'Blank (NPCI ne status nahi diya)') : (npciIsRetry(r) ? 'Check fail — dobara karo' : 'Not found (NPCI me nahi)');
    if (prim && /^active$/i.test(key)) s.active++;
    if (r.kind !== 'VRN' && prim) { s.updBase++; const reg = String(prim.REGNUMBER || '').replace(/[^A-Z0-9]/gi, ''); if (reg.length >= 1 && reg.length <= 10) s.upd++; else s.notUpd++; }
    s.status[key] = (s.status[key] || 0) + 1;
  }
  return s;
}

/** base rows me naye rows (same input = replace, naya = aakhir me). Idempotent — har checkpoint par dobara chala sakte hain. */
export function mergeRows(base, add) {
  const out = (base || []).slice(); const idx = new Map(out.map((r, i) => [r.input, i]));
  for (const r of add || []) { const i = idx.get(r.input); if (i !== undefined) out[i] = r; else { idx.set(r.input, out.length); out.push(r); } }
  return out;
}

/** API response (array / object) → records. */
export function parseNpci(txt) {
  const j = JSON.parse(txt);
  const m = Array.isArray(j) ? (j[0] || {}) : (j || {});
  const td = (m.res && Array.isArray(m.res.tagDetails)) ? m.res.tagDetails : [];
  const tdBy = new Map(td.map((x) => [String(x.tagId || '').toUpperCase(), x]));
  let recs = (Array.isArray(m.NPCIVehicleDetails) ? m.NPCIVehicleDetails : []).map((d) => {
    const tg = tdBy.get(String(d.TAGID || '').toUpperCase()) || {};
    return { TAGID: d.TAGID || '', BANKID: d.BANKID || '', REGNUMBER: d.REGNUMBER || '', custId: d.custId || '', cch: d.cch || d.VEHICLECLASS || '', commVeh: d.commVeh || d.COMVEHICLE || '', activationDt: d.activationDt || '', closeDt: d.closeDt || '', ENTITYID: d.ENTITYID || '', tagDetails_cardStage: tg.cardStage || '', tagDetails_npci_ExcCode: tg.npci_ExcCode || '', npci_ExcCode: d.npci_ExcCode || '', TAGSTATUS: d.TAGSTATUS || '' };
  });
  if (!recs.length && td.length) recs = td.map((x) => ({ TAGID: x.tagId || '', BANKID: x.npci_BankId || '', REGNUMBER: x.regNumber || '', custId: x.custId || '', cch: x.cch || '', commVeh: x.commVeh || '', activationDt: x.activationDt || '', closeDt: x.closeDt || '', ENTITYID: x.entityId || '', tagDetails_cardStage: x.cardStage || '', tagDetails_npci_ExcCode: x.npci_ExcCode || '', npci_ExcCode: x.npci_ExcCode || '', TAGSTATUS: x.npci_TagStatus || '' }));
  return { ok: m.STATUS === 'Success' && recs.length > 0, msg: m.APIRESPMSG || m.STATUS || '', records: recs };
}

// ------------------------------------------------------------------ rate gate
export function createRateGate(init = {}) {
  const g = {
    rate: Number(init.rate) > 0 ? Number(init.rate) : 4, ceil: Number(init.ceil) > 0 ? Number(init.ceil) : 0,
    minRate: 0.4, maxRate: Number(init.maxRate) > 0 ? Number(init.maxRate) : 40, maxConcCap: Number(init.maxConc) > 0 ? Number(init.maxConc) : 40,
    next: 0, pauseUntil: 0, inflight: 0, waitQ: [], lat: Number(init.lat) > 0 ? Number(init.lat) : 0,
    n429: 0, calls: 0, errs: 0, okRun: 0, streak429: 0, cut: 0, fixed: false, fixedConc: 0
  };
  // ek saath kitni: rate × latency (+25% + 1), latency badhe to concurrency apne aap badhti hai.
  g.maxConc = () => (g.fixed && g.fixedConc ? g.fixedConc : Math.max(2, Math.min(g.maxConcCap, Math.ceil(g.rate * Math.max(0.25, (g.lat || 1500) / 1000) * 1.25) + 1)));
  const drain = () => { while (g.waitQ.length && g.inflight < g.maxConc()) { g.inflight++; g.waitQ.shift()(); } };
  g.acquire = async () => {
    await new Promise((res) => { if (g.inflight < g.maxConc()) { g.inflight++; res(); } else g.waitQ.push(res); });
    for (;;) {   // start times ko 1/rate ke gap par baanto; beech me 429 ruk aaye to naya slot lo (ruk ke baad burst nahi)
      const now = Date.now();
      const start = Math.max(now, g.next, g.pauseUntil);
      g.next = start + 1000 / g.rate;
      if (start > now) await sleep(start - now);
      if (g.pauseUntil <= Date.now()) return;
    }
  };
  g.release = () => { g.inflight = Math.max(0, g.inflight - 1); drain(); };
  g.onOk = (ms) => {
    g.lat = g.lat ? Math.round(g.lat * 0.9 + ms * 0.1) : ms;
    g.calls++; g.streak429 = 0; g.okRun++;
    if (g.fixed) return;
    if (g.ceil && g.okRun % 80 === 0) g.ceil = Math.min(g.maxRate, g.ceil * 1.06);   // chhat dheere upar khisakti hai (API ki limit badal sakti hai)
    const cap = g.ceil ? g.ceil * 0.9 : g.maxRate;
    if (g.rate < cap) g.rate = Math.min(cap, g.ceil ? g.rate + 0.04 : g.rate + Math.max(0.12, g.rate * 0.03));   // chhat pata nahi = tez "slow start"
    drain();
  };
  g.on429 = (retryAfterSec) => {
    g.n429++;
    const now = Date.now();
    if (now - g.cut < 2000) return;   // ek burst = ek hi baar
    g.cut = now; g.streak429++; g.okRun = 0;
    if (!g.fixed) { g.ceil = Math.max(g.minRate, g.rate); g.rate = Math.max(g.minRate, g.rate * 0.6); }
    const pause = retryAfterSec > 0 ? Math.min(30e3, retryAfterSec * 1000) : Math.min(8000, 700 * 2 ** (g.streak429 - 1));
    g.pauseUntil = Math.max(g.pauseUntil, now + pause);
    g.next = Math.max(g.next, g.pauseUntil);
  };
  g.onErr = () => { g.errs++; if (!g.fixed) g.rate = Math.max(g.minRate, g.rate * 0.85); };
  g.stats = () => ({ rate: Math.round(g.rate * 100) / 100, ceil: Math.round(g.ceil * 100) / 100, conc: g.maxConc(), inflight: g.inflight, lat: g.lat, n429: g.n429, calls: g.calls, gap: Math.round(1000 / g.rate) });
  return g;
}

// ------------------------------------------------------------------ engine
export function createNpciEngine(opts = {}) {
  const dataDir = opts.dataDir || path.join(process.cwd(), 'data');
  const url = opts.url || NPCI_URL_DEFAULT;
  const fetchImpl = opts.fetch || ((...a) => fetch(...a));
  const getStore = typeof opts.store === 'function' ? opts.store : () => opts.store || null;
  const barcodeToTag = opts.barcodeToTag || (async () => new Map());
  const log = opts.log || console;
  const KEEP = opts.keep || 5, TAB = 'CACHE_SNAPSHOT', CHUNK = 45000;
  const CKPT_MS = opts.checkpointMs || 10e3, SHEET_MS = opts.sheetEveryMs || 180e3, CALL_TIMEOUT = opts.callTimeoutMs || 20e3;
  const runDir = path.join(dataDir, 'npci-runs');
  const gateFile = path.join(dataDir, 'npci-gate.json');

  let saved = {}; try { if (existsSync(gateFile)) saved = JSON.parse(readFileSync(gateFile, 'utf8')) || {}; } catch { saved = {}; }
  const gate = createRateGate({ rate: saved.ceil ? saved.ceil * 0.8 : saved.rate, ceil: saved.ceil, lat: saved.lat, ...(opts.gate || {}) });
  const saveGate = () => { try { mkdirSync(dataDir, { recursive: true }); writeFileSync(gateFile, JSON.stringify({ rate: gate.rate, ceil: gate.ceil, lat: gate.lat, at: Date.now() })); } catch { /* optional */ } };

  const jobs = new Map();
  const mem = new Map();        // owner → { runs, touched, diskOk, stale, staleAt }
  const loading = new Map();    // owner → Promise
  const diskChain = new Map();  // owner → Promise (disk writes ek ke baad ek)
  const sheetQ = new Map();     // owner → { busy, pending }
  const cache = new Map();      // input → { at, r } (5 min)
  let colMap = null, colChain = Promise.resolve();
  const safeOwner = (o) => String(o || 'user').toLowerCase().replace(/[^a-z0-9._-]/g, '_').slice(0, 60) || 'user';
  const storeOk = () => { const s = getStore(); return s && typeof s.call === 'function' ? s : null; };

  // ---------- one call
  async function checkOne(raw) {
    const v = cleanItem(raw);
    const kind = npciKind(v);
    const body = kind === 'Tag ID' ? { tagId: v } : { vrn: v };
    let lastErr = '', tries = 0, rl = 0;
    while (tries < 4 && rl < 25) {   // 429 = sirf "ruko" (attempt nahi ginta)
      if (tries) await sleep(500 * tries);
      await gate.acquire();
      const ac = new AbortController(); const t = setTimeout(() => ac.abort(), CALL_TIMEOUT); const t0 = Date.now();
      try {
        const r = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), signal: ac.signal });
        const txt = await r.text();
        if (r.status === 429) { rl++; gate.on429(Number(r.headers && r.headers.get && r.headers.get('retry-after')) || 0); lastErr = 'HTTP 429 — API ne "bahut zyada requests" kaha (rate limit)'; continue; }
        if (r.status >= 500 || /^\s*</.test(txt)) { tries++; gate.onErr(); lastErr = `HTTP ${r.status} — ${/^\s*</.test(txt) ? 'HTML aaya (server ne JSON nahi diya)' : 'API server error'}`; continue; }
        gate.onOk(Date.now() - t0);
        let parsed; try { parsed = parseNpci(txt); } catch { tries++; lastErr = 'Response samajh nahi aaya'; continue; }
        return { input: v, kind, ...parsed };
      } catch (err) { tries++; gate.onErr(); lastErr = err && err.name === 'AbortError' ? `Time out (${Math.round(CALL_TIMEOUT / 1000)}s) — API ne jawab nahi diya` : String((err && err.message) || err); }
      finally { clearTimeout(t); gate.release(); }
    }
    return { input: v, kind, ok: false, retry: !!lastErr && !/samajh nahi/i.test(lastErr), msg: lastErr || 'Fail', records: [] };
  }

  // ---------- storage
  async function ownerCol(owner) {
    const s = storeOk(); if (!s) throw new Error('sheet store nahi');
    const p = colChain.then(async () => {
      if (colMap && colMap[owner]) return colMap[owner];
      const out = await s.call('readrange', { spreadsheetId: '', tab: TAB, startRow: 1, columns: ['B'] }, { timeoutMs: 30e3, attempts: 2 });
      let map = {}; try { map = JSON.parse(((out.rows || [])[0] || [])[0] || '{}') || {}; } catch { map = {}; }
      colMap = map;
      if (map[owner]) return map[owner];
      const used = new Set(Object.values(map)); let n = 4; while (used.has(String.fromCharCode(64 + n)) && n < 26) n++;
      map[owner] = String.fromCharCode(64 + n);
      await s.call('writecells', { spreadsheetId: '', tab: TAB, column: 'B', writes: [{ row: 1, value: JSON.stringify(map) }] });
      return map[owner];
    });
    colChain = p.catch(() => {});
    return p;
  }
  async function sheetRead(owner) {
    const s = storeOk(); if (!s) return null;
    const col = await ownerCol(owner);
    const out = await s.call('readrange', { spreadsheetId: '', tab: TAB, startRow: 1, columns: [col] }, { timeoutMs: 60e3, attempts: 2 });
    const rows = (out && out.rows) || [];
    let head = null; try { head = JSON.parse((rows[0] && rows[0][0]) || 'null'); } catch { head = null; }
    if (!head || head.kind !== 'npciRuns' || !head.n) return [];
    const body = rows.slice(1, 1 + head.n).map((r) => r[0] || '').join('');
    const runs = JSON.parse(zlib.gunzipSync(Buffer.from(body, 'base64')).toString('utf8')).runs;
    return Array.isArray(runs) ? runs : [];
  }
  const diskFile = (owner) => path.join(runDir, `${safeOwner(owner)}.json.gz`);
  function diskRead(owner) {
    const f = diskFile(owner);
    try { if (existsSync(f)) { const runs = JSON.parse(zlib.gunzipSync(readFileSync(f)).toString('utf8')).runs; if (Array.isArray(runs)) return runs; } } catch { /* corrupt → sheet */ }
    return null;
  }
  /** do lists ko id se jodo (jo zyada naya update hua wo), naye pehle. */
  function union(a, b) {
    const by = new Map();
    for (const r of [...(a || []), ...(b || [])]) { if (!r || !r.id) continue; const o = by.get(r.id); if (!o || (r.updated || r.at || 0) > (o.updated || o.at || 0)) by.set(r.id, r); }
    return [...by.values()].sort((x, y) => (y.at || 0) - (x.at || 0));
  }
  function ensure(owner) {
    const e = mem.get(owner); if (e) { e.touched = Date.now(); return Promise.resolve(e); }
    if (loading.has(owner)) return loading.get(owner);
    const p = (async () => {
      const disk = diskRead(owner);
      if (disk) { const ent = { runs: disk, touched: Date.now(), diskOk: true, stale: false }; mem.set(owner, ent); return ent; }
      let runs = [], stale = false;
      if (storeOk()) {
        try { runs = (await sheetRead(owner)) || []; } catch (err) { stale = true; log.warn('NPCI runs load:', String((err && err.message) || err).slice(0, 160)); }
      }
      const ent = mem.get(owner) || { runs: [], touched: Date.now(), diskOk: false };
      ent.runs = union(ent.runs, runs); ent.stale = stale; ent.staleAt = Date.now();
      mem.set(owner, ent);
      return ent;
    })().finally(() => loading.delete(owner));
    loading.set(owner, p);
    return p;
  }
  async function syncFromSheet(owner) {
    const ent = mem.get(owner); if (!ent || !ent.stale || ent.syncing) return;
    ent.syncing = true; ent.staleAt = Date.now();
    try { const runs = await sheetRead(owner); ent.runs = trim(owner, union(ent.runs, runs || [])); ent.stale = false; persist(owner, { sheet: false }).catch(() => {}); }
    catch (err) { log.warn('NPCI runs sheet sync:', String((err && err.message) || err).slice(0, 160)); }
    finally { ent.syncing = false; }
  }
  let dead = false;   // tests: "crash" simulate (iske baad kuch save nahi)
  function persist(owner, { sheet }) {
    if (dead) return Promise.resolve();
    const prev = diskChain.get(owner) || Promise.resolve();
    const p = prev.then(async () => {
      const ent = mem.get(owner); if (!ent) return;
      const gz = await gzipA(Buffer.from(JSON.stringify({ v: 2, owner, runs: ent.runs })));
      try { mkdirSync(runDir, { recursive: true }); const f = diskFile(owner); writeFileSync(`${f}.tmp`, gz); renameSync(`${f}.tmp`, f); ent.diskOk = true; } catch { ent.diskOk = false; }
    });
    diskChain.set(owner, p.catch(() => {}));
    if (sheet) p.then(() => sheetWrite(owner)).catch(() => {});
    return p;
  }
  async function sheetWrite(owner) {
    const s = storeOk(); if (!s) return;
    const q = sheetQ.get(owner) || { busy: false, pending: false }; sheetQ.set(owner, q);
    if (q.busy) { q.pending = true; return; }
    q.busy = true;
    try {
      do {
        q.pending = false;
        const ent = mem.get(owner); if (!ent) break;
        if (ent.stale) await syncFromSheet(owner);
        if (ent.stale) { log.warn(`NPCI runs (${owner}): sheet ki purani history abhi padhi nahi gayi — overwrite nahi kiya (disk par save hai)`); break; }
        const gz = await gzipA(Buffer.from(JSON.stringify({ v: 2, owner, runs: ent.runs })));
        const body = gz.toString('base64'); const parts = []; for (let i = 0; i < body.length; i += CHUNK) parts.push(body.slice(i, i + CHUNK));
        if (parts.length > 600) { log.warn('NPCI runs: bahut bada, sheet save skip'); break; }
        const col = await ownerCol(owner);
        const writes = [{ row: 1, value: JSON.stringify({ v: 2, kind: 'npciRuns', owner, at: Date.now(), n: parts.length }) }, ...parts.map((v, i) => ({ row: i + 2, value: v })), ...Array.from({ length: 40 }, (_, j) => ({ row: parts.length + 2 + j, value: '' }))];
        await s.call('writecells', { spreadsheetId: '', tab: TAB, column: col, writes });
        log.log(`🗂️ NPCI runs saved (${owner}): ${ent.runs.length} run · ${parts.length} chunk · ${Math.round(body.length / 1024)} KB`);
      } while (q.pending);
    } catch (err) { log.warn('NPCI runs sheet save:', String((err && err.message) || err).slice(0, 200)); }
    finally { q.busy = false; }
  }
  const activeJobFor = (runId) => { for (const j of jobs.values()) if (j.runId === runId && !j.done && !j.stop) return j; return null; };
  const activeOf = (owner) => { for (const j of jobs.values()) if (j.owner === owner && !j.done && !j.stop) return j; return null; };
  /** Chalta run hamesha + baaki naye 5. */
  function trim(owner, runs, endingJob) {
    let act = activeOf(owner); if (act && act === endingJob) act = null; let others = 0;
    return runs.filter((r) => (act && r.id === act.runId) || ++others <= KEEP);
  }

  async function upsert(job, final) {
    const ent = await ensure(job.owner);
    const runs = ent.runs;
    let rec = runs.find((r) => r.id === job.runId);
    if (!rec) { rec = { id: job.runId, at: job.started, total: job.items.length, items: job.items.slice(), rows: [], ms: 0 }; runs.unshift(rec); }
    const rows = mergeRows(rec.rows, job.rows);
    const items = rec.items && rec.items.length ? rec.items : [...new Set([...(rec.rows || []).map((r) => r.input), ...job.items])];
    const have = new Set(rows.map((r) => r.input));
    const left = items.reduce((n, x) => n + (have.has(x) ? 0 : 1), 0);
    const total = Math.max(rec.total || 0, items.length);
    const stillRunning = [...jobs.values()].some((j) => j.runId === job.runId && !j.done && !j.stop && !(final && j === job));
    Object.assign(rec, { rows, total, checked: rows.length, left, updated: Date.now(), ms: job.baseMs + ((job.ended || Date.now()) - job.started), running: stillRunning, stopped: !stillRunning && final && left > 0 && !!job.stop, sum: npciSummary(rows, total) });
    if (left > 0) rec.items = items; else delete rec.items;
    ent.runs = trim(job.owner, runs, final ? job : null);
    const now = Date.now();
    const sheet = final || !job.lastSheet || now - job.lastSheet > SHEET_MS;
    if (sheet) job.lastSheet = now;
    await persist(job.owner, { sheet });
  }

  function gcMem() {
    const now = Date.now();
    for (const [k, j] of jobs) if (j.done && now - j.touched > 60 * 60e3) jobs.delete(k);
    for (const [o, e] of mem) if (e.diskOk && !e.stale && now - e.touched > 20 * 60e3 && !activeOf(o)) mem.delete(o);
  }

  // ---------- jobs
  async function startJob({ owner, items = [], mergeInto = '', resume = '', tune = null }) {
    gcMem();
    const ent = await ensure(owner);
    for (const j0 of jobs.values()) if (j0.owner === owner && !j0.done) j0.stop = true;   // ek user = ek job (do job ek saath 429 dilate the)
    const id = crypto.randomBytes(8).toString('hex');
    let runId = id, list = [...new Set(items.map(cleanItem).filter((x) => x.length >= 4 && x.length <= 30))].slice(0, 5000), baseMs = 0;
    const baseId = resume || mergeInto;
    const base = baseId ? ent.runs.find((r) => r.id === baseId) : null;
    if (resume) {
      if (!base) { const e = new Error('Ye run ab save nahi hai.'); e.status = 404; throw e; }
      const have = new Set((base.rows || []).map((r) => r.input));
      list = (base.items || []).filter((x) => !have.has(x));
      base.resumes = (base.resumes || 0) + 1;
      if (!list.length) { base.running = false; base.left = 0; delete base.items; await persist(owner, { sheet: true }); return { id: null, total: 0, runId: base.id, nothing: true }; }
    }
    if (!list.length) { const e = new Error('Tag ID / VRN / Chassis daalo.'); e.status = 400; throw e; }
    if (base) { runId = base.id; baseMs = base.ms || 0; }
    const job = { id, runId, owner, items: list, rows: [], done: false, stop: false, started: Date.now(), touched: Date.now(), baseMs, mergeInto: base ? base.id : '', resumed: !!resume, lastSheet: 0 };
    jobs.set(id, job);
    if (tune && (Number(tune.rate) > 0 || Number(tune.gap) > 0)) { gate.fixed = true; gate.rate = Math.max(0.2, Math.min(50, Number(tune.rate) || 1000 / Number(tune.gap))); gate.fixedConc = Math.max(1, Math.min(40, Number(tune.conc) || 0)); } else gate.fixed = false;
    await upsert(job, false);   // history me turant "⏳ chal raha"
    runJob(job, tune).catch((err) => log.warn('NPCI job:', String((err && err.message) || err).slice(0, 160)));
    return { id, total: list.length, runId };
  }

  async function runJob(job, tune) {
    const g0 = { n429: gate.n429, calls: gate.calls };
    let bcTag = new Map();
    const bcs = job.items.filter((x) => /^\d{8,}$/.test(x));
    if (bcs.length) { try { bcTag = (await barcodeToTag(bcs)) || new Map(); } catch (err) { log.log('NPCI barcode lookup fail:', String((err && err.message) || err).slice(0, 160)); } }
    const doOne0 = async (it) => {
      if (!/^\d{8,}$/.test(it)) return checkOne(it);
      const tag = bcTag.get(it);
      if (!tag) return { input: it, kind: 'Barcode', ok: false, msg: 'Barcode StockDataa / Tag Assignment me nahi mila (Tag ID nahi nikla)', records: [] };
      const r = await checkOne(tag);
      return { ...r, input: it, kind: 'Barcode', tagFromBarcode: tag };
    };
    const doOne = async (it) => {
      const hit = cache.get(it); if (hit && Date.now() - hit.at < 5 * 60e3) return hit.r;
      const r = await doOne0(it);
      if (r && !r.retry) { cache.set(it, { at: Date.now(), r }); if (cache.size > 8000) cache.delete(cache.keys().next().value); }
      return r;
    };
    const queue = job.items.slice(), requeued = new Set(); let next = 0, inflight = 0;
    const worker = async () => {
      while (!job.stop) {
        if (next >= queue.length) { if (inflight > 0) { await sleep(150); continue; } break; }
        const it = queue[next++]; inflight++;
        try {
          const r = await doOne(it);
          if (r.retry && !requeued.has(it) && !job.stop) { requeued.add(it); queue.push(it); } else job.rows.push(r);
        } catch (err) { job.rows.push({ input: it, kind: npciKind(it), ok: false, retry: true, msg: String((err && err.message) || err).slice(0, 120), records: [] }); }
        finally { inflight--; }
      }
    };
    let ckBusy = false;
    const ck = setInterval(() => { if (ckBusy || job.done) return; ckBusy = true; upsert(job, false).catch(() => {}).finally(() => { ckBusy = false; }); }, CKPT_MS);
    if (ck.unref) ck.unref();
    const nWorkers = tune && Number(tune.workers) > 0 ? Math.min(60, Number(tune.workers)) : 48;   // asli limit gate karta hai
    try { await Promise.all(Array.from({ length: nWorkers }, worker)); }
    finally {
      clearInterval(ck);
      job.ended = Date.now();
      try { await upsert(job, true); } catch (err) { log.warn('NPCI run save:', String((err && err.message) || err).slice(0, 160)); }
      job.done = true; job.touched = Date.now();
      saveGate();
      const sec = (job.ended - job.started) / 1000; const st = gate.stats();
      log.log(`🛰️ NPCI job: ${job.rows.length}/${job.items.length} in ${sec.toFixed(1)}s (${(job.rows.length / Math.max(sec, 0.1)).toFixed(1)}/s) · 429 x${gate.n429 - g0.n429} · rate ${st.rate}/s (chhat ${st.ceil}) · conc ${st.conc} · avg call ${st.lat}ms · fail ${job.rows.filter((r) => r.retry).length}`);
    }
  }

  function jobStatus(id, owner, isAdmin, from = 0) {
    const job = jobs.get(id);
    if (!job || (job.owner !== owner && !isAdmin)) return null;
    job.touched = Date.now();
    const st = gate.stats();
    return { ok: true, runId: job.runId, total: job.items.length, checked: job.rows.length, done: job.done, stopped: job.stop, n429: st.n429, gap: st.gap, conc: st.conc, rate: st.rate, lat: st.lat, rows: job.rows.slice(Math.max(0, from)), ms: (job.ended || Date.now()) - job.started };
  }
  function stopJob(id, owner, isAdmin) { const job = jobs.get(id); if (!job || (job.owner !== owner && !isAdmin)) return false; job.stop = true; job.touched = Date.now(); return true; }

  const meta = (r) => {
    const act = activeJobFor(r.id);
    const liveRows = act ? mergeRows(r.rows, act.rows) : null;
    const checked = liveRows ? liveRows.length : r.checked;
    return { id: r.id, at: r.at, updated: r.updated || r.at, total: r.total, checked, left: act ? Math.max(0, (r.total || 0) - checked) : (r.left || 0), ms: act ? act.baseMs + (Date.now() - act.started) : r.ms, stopped: !!r.stopped, running: !!act, interrupted: !act && !!r.running, jobId: act ? act.id : '', sum: liveRows ? npciSummary(liveRows, r.total) : r.sum };
  };

  /** Page khulne par: runs + chalta job. Sheet slow ho to `loading` (client 2-3s me dobara poochta hai). Adhoora run (server restart) ho to apne aap resume. */
  async function listRuns(owner, { waitMs = 12e3, autoResume = true } = {}) {
    gcMem();
    const pr = ensure(owner);
    const r = await Promise.race([pr.then(() => 'ok', () => 'err'), sleep(waitMs).then(() => 'slow')]);
    const actJ = activeOf(owner);
    const active = actJ ? { id: actJ.id, runId: actJ.runId, total: actJ.items.length, checked: actJ.rows.length, mergeInto: actJ.mergeInto } : null;
    if (r !== 'ok') return { ok: true, loading: r === 'slow', error: r === 'err' ? 'History load nahi hui' : '', active, runs: [] };
    const ent = mem.get(owner);
    if (ent.stale && Date.now() - (ent.staleAt || 0) > 45e3) syncFromSheet(owner).catch(() => {});
    let resumed = null;
    if (autoResume && !actJ) {
      const cand = ent.runs.find((x) => x.running && !x.stopped && x.left > 0 && (x.items || []).length && (x.resumes || 0) < 6 && Date.now() - (x.updated || x.at) < 24 * 3600e3);
      if (cand) {
        try { const j = await startJob({ owner, resume: cand.id }); if (j.id) resumed = { id: j.id, runId: j.runId, total: j.total, checked: 0, mergeInto: cand.id, resumed: true }; } catch (err) { log.warn('NPCI auto-resume:', String((err && err.message) || err).slice(0, 160)); }
      }
    }
    return { ok: true, active: resumed || active, resumed: !!resumed, stale: !!ent.stale, runs: ent.runs.map(meta) };
  }
  async function getRun(owner, id) {
    const ent = await ensure(owner);
    const r = ent.runs.find((x) => x.id === id); if (!r) return null;
    const act = activeJobFor(id);
    if (!act) { const { items, ...rest } = r; return { ...rest, running: false, interrupted: !!r.running }; }
    const rows = mergeRows(r.rows, act.rows);
    const { items, ...rest } = r;
    return { ...rest, rows, checked: rows.length, running: true, jobId: act.id, sum: npciSummary(rows, r.total) };
  }

  return { gate, jobs, mem, checkOne, startJob, jobStatus, stopJob, listRuns, getRun, ensure, upsert, persist, _union: union, _kill: () => { dead = true; for (const j of jobs.values()) j.stop = true; }, _flush: async (owner) => { await (diskChain.get(owner) || Promise.resolve()); } };
}
