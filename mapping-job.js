/* ⚡ v194 — FASTag Mapping background jobs.
   Browser ab rows ko batch-batch bhejkar wait nahi karta: poori list server par ek "job" ban jaati hai, server shared adaptive gate
   se upstream mapping API ko dheere-dheere/tez bhejta hai, fail rows ko khud dobara try karta hai (rounds), aur Google Sheet me
   "done" row-by-row saath ke saath likhta hai. Page badalo / refresh karo / band karo — job chalti rehti hai. Browser sirf poll karta hai. */
import crypto from 'node:crypto';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
const TRANSIENT = [408, 425, 429, 500, 502, 503, 504];

export function createMappingJobs(deps) {
  const {
    gate, normalizeVcType, getApiUrl, getSecret, makeSheetStore, sheetIdFrom,
    log = (...a) => console.log(...a), fetchImpl = (...a) => fetch(...a)
  } = deps;
  const T = Object.assign({ attemptTimeoutMs: 40000, attempts: 4, roundWaits: [3000, 8000, 15000, 30000], workers: 16, retryWorkers: 8, flushMs: 2500, keepMs: 6 * 3600e3, maxRows: 6000 }, deps.tuning || {});
  const jobs = new Map();

  function cleanup() {
    const now = Date.now();
    for (const [id, j] of jobs) if (j.finishedAt && now - j.finishedAt > T.keepMs) jobs.delete(id);
    while (jobs.size > 20) { const first = jobs.keys().next().value; if (jobs.get(first).status === 'running') break; jobs.delete(first); }
  }

  async function callOne(job, row) {
    const data = {
      tagId: clip(row.tagId, 180).trim(), serialNo: clip(row.serialNo, 180).trim(),
      vcType: normalizeVcType(row.vcType), agentId: clip(row.agentId, 100).trim()
    };
    if (!data.tagId || !data.serialNo || !data.vcType || !data.agentId) return { success: false, status: 'Validation failed', message: 'tagId, serialNo, vcType aur agentId sab required hain.' };
    if ([data.tagId, data.serialNo, data.vcType, data.agentId].some((v) => /[,\r\n]/.test(v))) return { success: false, status: 'Invalid characters', message: 'Mapping values me comma ya newline allowed nahi.' };
    const apiUrl = getApiUrl(), secret = getSecret();
    let lastMessage = 'API unavailable', lastCode = 0, ambiguous = job.ambiguous.has(data.tagId);
    for (let attempt = 0; attempt < T.attempts; attempt++) {
      if (job.cancelled) return { success: false, status: 'Cancelled', message: 'Mapping roki gayi.', retryable: true };
      await gate.acquire();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), T.attemptTimeoutMs);
      let waitMs = 0;
      try {
        const response = await fetchImpl(apiUrl, {
          method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'X-Secret-Key': secret },
          body: JSON.stringify({ bank_id: 1, sno: [data.tagId, data.serialNo, data.vcType, data.agentId].join(',') })
        });
        clearTimeout(timer);
        const text = (await response.text()).slice(0, 4000);
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { /* plain text / html */ }
        lastCode = response.status;
        const success = response.ok && parsed && parsed.success === true;
        const limited = response.status === 429;
        const message = String(success ? (parsed.message || 'Mapping successful') : (limited ? 'Mapping API rate limit (429 Too Many Requests)' : ((parsed && (parsed.message || parsed.error || parsed.errors)) || text || ('HTTP ' + response.status))) || 'Mapping failed').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
        if (success) { gate.good(); return { success: true, httpCode: response.status, status: 'Success', message }; }
        if (ambiguous && (response.status === 409 || /already|exist|duplicate|mapped/i.test(message))) {
          gate.good();
          return { success: true, httpCode: response.status, status: 'Success', message: 'Pehle se mapped (retry me confirm hua) — ' + message.slice(0, 120) };
        }
        lastMessage = message;
        const transient = TRANSIENT.includes(response.status);
        if (!transient) { gate.release(); return { success: false, httpCode: response.status, status: response.status === 409 ? 'Conflict' : 'Failed (HTTP ' + response.status + ')', message, retryable: false }; }
        const retryAfterSec = Number(response.headers.get('retry-after') || 0);
        waitMs = retryAfterSec > 0 ? Math.min(15e3, retryAfterSec * 1000) : Math.min(9000, 700 * Math.pow(2, attempt) + Math.random() * 500);
        gate.throttle(limited ? Math.max(waitMs, 1500) : 600);
        if (response.status >= 500) { ambiguous = true; job.ambiguous.add(data.tagId); }
        if (attempt === T.attempts - 1) { gate.release(); return { success: false, httpCode: response.status, status: limited ? 'Rate limited' : 'Busy (HTTP ' + response.status + ')', message, retryable: true }; }
      } catch (err) {
        clearTimeout(timer);
        ambiguous = true; job.ambiguous.add(data.tagId);
        lastMessage = err && err.name === 'AbortError' ? 'Mapping API ne ' + Math.round(T.attemptTimeoutMs / 1000) + 's me jawab nahi diya (timeout)' : 'Mapping API network error: ' + clip(err && err.message || err, 160);
        gate.throttle(800);
        waitMs = 800 * Math.pow(2, attempt) + Math.random() * 400;
        if (attempt === T.attempts - 1) { gate.release(); return { success: false, httpCode: lastCode, status: 'Timeout / network', message: lastMessage, retryable: true }; }
      }
      gate.release();
      await sleep(waitMs);
    }
    return { success: false, httpCode: lastCode, status: 'Failed', message: lastMessage, retryable: true };
  }

  function setResult(job, i, r) {
    const prev = job.res[i];
    if (prev) { if (prev.success) job.okCount--; else job.badCount--; }
    job.res[i] = r;
    if (r.success) job.okCount++; else job.badCount++;
    job.events.push({ i, k: job.rows[i].tagId, s: r.success ? 1 : 0, st: clip(r.status, 40), m: clip(r.message, 200), rt: r.retryable ? 1 : 0 });
    if (!r.success) job.lastError = clip(r.status + ': ' + r.message, 220);
    const sr = job.rows[i].sheetRow;
    if (sr && job.sheet && r.success && !(prev && prev.success)) {
      const n = (job.sheetOk.get(sr) || 0) + 1; job.sheetOk.set(sr, n);
      if (n >= (job.sheetNeed.get(sr) || Infinity) && !job.sheetWritten.has(sr) && !job.sheetQueued.has(sr)) { job.sheetQueued.add(sr); job.sheetPending.push(sr); }
    }
  }

  async function flushSheet(job) {
    if (!job.sheet || job.flushing || !job.sheetPending.length) return;
    job.flushing = true;
    const batch = job.sheetPending.splice(0, 3000);
    try {
      const store = makeSheetStore();
      await store.call('writecells', { spreadsheetId: job.sheet.spreadsheetId, tab: job.sheet.tab, column: job.sheet.column, writes: batch.map((row) => ({ row, value: job.sheet.doneText })) });
      batch.forEach((row) => { job.sheetWritten.add(row); job.sheetQueued.delete(row); });
      job.sheetError = '';
    } catch (err) {
      job.sheetPending.unshift(...batch);
      job.sheetError = clip(err && err.message || err, 200);
    } finally { job.flushing = false; }
  }

  async function runPool(job, indexes, workers) {
    let cursor = 0;
    const loops = Array.from({ length: Math.min(workers, indexes.length) }, async () => {
      while (cursor < indexes.length && !job.cancelled) {
        const i = indexes[cursor++];
        setResult(job, i, await callOne(job, job.rows[i]));
      }
    });
    await Promise.all(loops);
  }

  async function run(job) {
    const timer = setInterval(() => { flushSheet(job).catch(() => {}); }, T.flushMs);
    if (timer.unref) timer.unref();
    try {
      job.note = 'Mapping chal rahi hai…';
      const first = job.rows.map((_, i) => i).filter((i) => !job.res[i] || !job.res[i].success);
      await runPool(job, first, T.workers);
      for (let round = 1; round <= T.roundWaits.length && !job.cancelled; round++) {
        const retry = job.rows.map((_, i) => i).filter((i) => job.res[i] && !job.res[i].success && job.res[i].retryable);
        if (!retry.length) break;
        job.round = round;
        const wait = T.roundWaits[round - 1];
        job.note = '🔁 Auto-retry round ' + round + ' / ' + T.roundWaits.length + ': ' + retry.length + ' failed row ' + Math.round(wait / 1000) + 's baad dobara…';
        const until = Date.now() + wait;
        while (Date.now() < until && !job.cancelled) await sleep(Math.min(500, until - Date.now()));
        job.note = '🔁 Auto-retry round ' + round + ' / ' + T.roundWaits.length + ' chal raha hai (' + retry.length + ' row)…';
        await runPool(job, retry, T.retryWorkers);
      }
    } catch (err) {
      job.lastError = clip('Job error: ' + (err && err.message || err), 220);
    } finally {
      clearInterval(timer);
      for (let i = 0; i < 4 && job.sheet && (job.sheetPending.length || job.flushing); i++) { await flushSheet(job).catch(() => {}); if (job.sheetPending.length) await sleep(1500); }
      job.status = 'done'; job.finishedAt = Date.now();
      job.note = job.cancelled ? '⏹ Mapping roki gayi.' : (job.badCount ? 'Mapping complete — ' + job.badCount + ' row fail rahi.' : 'Mapping complete — sab rows map ho gayi.');
      const reasons = reasonList(job);
      log('[mapping-job]', job.id, 'done', 'total=' + job.total, 'ok=' + job.okCount, 'failed=' + job.badCount, 'rounds=' + job.round, 'sheetWritten=' + job.sheetWritten.size, reasons.length ? 'reasons=' + JSON.stringify(reasons.slice(0, 4)) : '');
    }
  }

  function reasonList(job) {
    const m = new Map();
    for (const r of job.res) if (r && !r.success) { const k = clip(r.status, 40) + (r.message ? ' — ' + clip(r.message, 70) : ''); m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }

  function create({ owner, rows, sheet, sheetPlan, retryOf }) {
    cleanup();
    for (const j of jobs.values()) if (j.owner === owner && j.status === 'running') { const e = new Error('Aapki ek mapping job pehle se chal rahi hai.'); e.runningId = j.id; e.code = 'RUNNING'; throw e; }
    let list = [], base = null;
    if (retryOf) {
      const old = jobs.get(String(retryOf));
      if (!old || old.owner !== owner) { const e = new Error('Purani job nahi mili (server restart / 6 ghante se purani). Rows dobara lookup karke map karein.'); e.code = 'GONE'; throw e; }
      list = old.rows.filter((_, i) => !(old.res[i] && old.res[i].success)).map((r) => ({ ...r }));
      sheet = old.sheet ? { ...old.sheet } : null; base = old;
    } else {
      list = (Array.isArray(rows) ? rows : []).slice(0, T.maxRows).map((r) => ({ tagId: clip(r && r.tagId, 180), serialNo: clip(r && r.serialNo, 180), vcType: clip(r && r.vcType, 40), agentId: clip(r && r.agentId, 100), sheetRow: Math.floor(Number(r && r.sheetRow)) || 0 }));
    }
    if (!list.length) { const e = new Error('Map karne ke liye koi row nahi (sab pehle se mapped).'); e.code = 'EMPTY'; throw e; }
    const job = {
      id: crypto.randomBytes(8).toString('hex'), owner, createdAt: Date.now(), startedAt: Date.now(), finishedAt: 0, status: 'running', cancelled: false,
      rows: list, res: new Array(list.length), events: [], okCount: 0, badCount: 0, total: list.length, round: 0, note: '', lastError: '',
      ambiguous: new Set(), sheet: null, sheetNeed: new Map(), sheetOk: new Map(), sheetQueued: new Set(), sheetWritten: new Set(), sheetPending: [], sheetError: '', flushing: false
    };
    if (base) { job.sheetNeed = new Map(base.sheetNeed); job.sheetOk = new Map(base.sheetOk); job.sheetWritten = new Set(base.sheetWritten); job.sheet = base.sheet; }
    else if (sheet && sheet.spreadsheetId && sheet.tab && sheet.column) {
      job.sheet = { spreadsheetId: sheet.spreadsheetId, tab: clip(sheet.tab, 80), column: sheet.column, doneText: clip(sheet.doneText || 'done', 200) };
      for (const [row, need] of Object.entries(sheetPlan || {})) { const r = Math.floor(Number(row)), n = Math.floor(Number(need)); if (r >= 1 && n >= 1) job.sheetNeed.set(r, n); }
    }
    jobs.set(job.id, job);
    run(job).catch((err) => { job.status = 'done'; job.finishedAt = Date.now(); job.lastError = clip(err && err.message || err, 220); });
    return job;
  }

  function snapshot(job, from) {
    const start = Math.max(0, Math.min(job.events.length, Number(from) || 0));
    const doneRows = job.okCount + job.badCount;
    let retrying = 0;
    if (job.status === 'running') for (const r of job.res) if (r && !r.success && r.retryable) retrying++;
    return {
      ok: true, id: job.id, status: job.status, cancelled: job.cancelled, total: job.total, okCount: job.okCount, failed: job.badCount, retrying,
      left: Math.max(0, job.total - doneRows), round: job.round, rounds: T.roundWaits.length, note: job.note, lastError: job.lastError,
      startedAt: job.startedAt, finishedAt: job.finishedAt, serverNow: Date.now(), speed: gate.snapshot(), reasons: reasonList(job),
      sheet: job.sheet ? { enabled: true, written: job.sheetWritten.size, pending: job.sheetPending.length + (job.flushing ? 1 : 0), error: job.sheetError } : { enabled: false },
      events: job.events.slice(start), next: job.events.length
    };
  }

  const find = (id, owner) => { const j = jobs.get(String(id || '')); return j && j.owner === owner ? j : null; };
  const latest = (owner) => { let best = null; for (const j of jobs.values()) if (j.owner === owner && (!best || j.createdAt > best.createdAt)) best = j; return best; };
  const cancel = (job) => { job.cancelled = true; };

  return { create, snapshot, find, latest, cancel, flushSheet, _jobs: jobs };
}
