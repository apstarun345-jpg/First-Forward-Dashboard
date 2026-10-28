// 📨 Agents Complaints Summary — bank (IDFC PartnersETC) POS-complaint mails → table + status.
//
// Flow: Apps Script (Gmail) `complaints` action mails ko thread-wise bhejta hai → yahan parse hoti hain:
//   • pehli mail ki HTML table (Case Number · VRN · Tag Id · Description · BC Name · Agent Name · agent id)
//   • thread ke baaki messages se status:  Pending · Solved by <owner> (humne reply kiya) · Solved by Bank
//     (bank ne khud debit/refund/close kar diya) · Solved by Team (kisi aur ne reply kiya)
// Server background me current month ko har N minute (Settings) me refresh karke cache rakhta hai —
// page khulte hi data tayyar milta hai. Pure functions export hain taaki test ho sakein.

const MONTH_RE = /^\d{4}-\d{2}-\d{2}$/;
export const COMPLAINT_STATUS = { PENDING: 'Pending', BANK: 'Solved by Bank', TEAM: 'Solved by Team' };
export const ownerStatus = (owner) => `Solved by ${String(owner || 'Tarun').trim() || 'Tarun'}`;
const RESOLVED_RE = /(debited|debit\b|deduct|refund|resolved|closed|settled|reversed|credited|processed|rejected|recovered)/i;
const AMOUNT_RE = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d+)?)/i;

export const DEFAULT_COMPLAINTS_CFG = { enabled: true, refreshMin: 10, subjects: ['POS Related-Request'], ownerName: 'Tarun', tatHours: 24 };

export function normalizeCfg(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const subjects = (Array.isArray(c.subjects) ? c.subjects : String(c.subjects || '').split(/\n/))
    .map((s) => String(s || '').replace(/["\r\n]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 12);
  const refresh = Number(c.refreshMin);
  const tat = Number(c.tatHours);
  return {
    enabled: c.enabled !== false && c.enabled !== 'false',
    refreshMin: Number.isFinite(refresh) ? Math.min(1440, Math.max(2, Math.round(refresh))) : DEFAULT_COMPLAINTS_CFG.refreshMin,
    subjects: subjects.length ? subjects : DEFAULT_COMPLAINTS_CFG.subjects.slice(),
    ownerName: String(c.ownerName || '').trim().slice(0, 40) || DEFAULT_COMPLAINTS_CFG.ownerName,
    tatHours: Number.isFinite(tat) && tat > 0 ? Math.min(720, tat) : DEFAULT_COMPLAINTS_CFG.tatHours
  };
}

const pad = (n) => String(n).padStart(2, '0');
/** Gmail search `after:/before:` ke liye YYYY/MM/DD (before exclusive → +1 din). */
const gmailDay = (iso, plus = 0) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + plus); return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`; };
export function buildQuery(subjects, from, to) {
  const subs = (subjects || []).map((s) => `"${String(s).replace(/"/g, '')}"`);
  if (!subs.length) throw new Error('Kam se kam ek subject chahiye.');
  let q = `subject:(${subs.join(' OR ')})`;
  if (MONTH_RE.test(from || '')) q += ` after:${gmailDay(from, -1)}`;   // 1 din pad: Gmail ka date timezone alag hota hai
  if (MONTH_RE.test(to || '')) q += ` before:${gmailDay(to, 2)}`;
  return q;
}

// ---------------------------------------------------------------- HTML table parse
const ENT = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };
const cellText = (h) => String(h || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39);/g, (m) => ENT[m] || m).replace(/\s+/g, ' ').trim();
const HEAD_MAP = [
  [/^case\s*(number|no|id)?$/i, 'caseNo'], [/^(vehicle\s*registration\s*number|vehicle\s*(no|number)|vrn|reg(istration)?\s*(no|number)?)$/i, 'vrn'],
  [/^tag\s*id$/i, 'tagId'], [/^(description|complaint|issue|remarks?)$/i, 'description'], [/^bc\s*name$/i, 'bcName'],
  [/^agent\s*name$/i, 'agentName'], [/^agent\s*id$/i, 'agentId']
];
const headKey = (t) => { const s = String(t || '').trim(); for (const [re, k] of HEAD_MAP) if (re.test(s)) return k; return ''; };

/** Mail HTML → [{caseNo, vrn, tagId, description, bcName, agentName, agentId}] (ek mail me kai rows ho sakti hain). */
export function parseComplaintTable(html) {
  const rows = [];
  const trs = String(html || '').match(/<tr[\s\S]*?<\/tr>/gi) || [];
  let cols = null;
  for (const tr of trs) {
    const cells = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map((c) => cellText(c.replace(/^<t[dh][^>]*>/i, '').replace(/<\/t[dh]>$/i, '')));
    if (cells.length < 3) continue;
    const keys = cells.map(headKey);
    if (keys.filter(Boolean).length >= 3 && keys.includes('caseNo')) { cols = keys; continue; }
    if (!cols) continue;
    const o = {};
    cols.forEach((k, i) => { if (k && cells[i] !== undefined) o[k] = cells[i]; });
    if (!o.caseNo || !/\d{5,}/.test(o.caseNo)) continue;
    o.caseNo = o.caseNo.replace(/\D/g, '') || o.caseNo;
    rows.push({ caseNo: o.caseNo, vrn: (o.vrn || '').toUpperCase(), tagId: (o.tagId || '').toUpperCase(), description: o.description || '', bcName: o.bcName || '', agentName: o.agentName || '', agentId: String(o.agentId || '').replace(/\.0+$/, '') });
  }
  return rows;
}

/** Plain body ka sirf naya hissa (quoted purani mail hata ke). */
export function freshText(plain) {
  const t = String(plain || '').replace(/\r/g, '');
  const cut = t.search(/^(on .{5,160}wrote:|from:\s.+|-{2,}\s*(original|forwarded)|_{5,}|>.*)$/im);
  return (cut > 0 ? t.slice(0, cut) : t).trim();
}
const addrOf = (from) => { const m = String(from || '').match(/<([^<>]+)>/); return (m ? m[1] : String(from || '')).trim().toLowerCase(); };
const domainOf = (a) => (String(a).split('@')[1] || '').toLowerCase();

/**
 * Thread → complaint rows.
 *   thread: { id, subject, messages: [{ id, from, date(ms), plain, html }] }
 *   me: ['you@gmail.com', ...] — Apps Script account (aur aliases)
 */
export function parseThread(thread, { me = [], cfg = DEFAULT_COMPLAINTS_CFG, now = Date.now() } = {}) {
  const msgs = (thread.messages || []).slice().sort((a, b) => (a.date || 0) - (b.date || 0));
  if (!msgs.length) return [];
  const first = msgs[0];
  const mine = new Set((me || []).map((x) => String(x).toLowerCase()));
  const firstAddr = addrOf(first.from);
  const bankDomain = domainOf(firstAddr);
  const kind = (m) => {
    const a = addrOf(m.from);
    if (mine.has(a)) return 'me';
    if (a === firstAddr || (bankDomain && domainOf(a) === bankDomain)) return 'bank';
    return 'team';
  };
  let table = [];
  for (const m of msgs) { if (m.html) { table = parseComplaintTable(m.html); if (table.length) break; } }
  const subjCase = (String(thread.subject || '').match(/(\d{8,})\s*$/) || [])[1] || '';
  if (!table.length) table = [{ caseNo: subjCase, vrn: '', tagId: '', description: '', bcName: '', agentName: '', agentId: '' }];

  const after = msgs.slice(1);
  const myReply = after.find((m) => kind(m) === 'me');
  const teamReply = after.find((m) => kind(m) === 'team');
  const bankDone = after.find((m) => kind(m) === 'bank' && RESOLVED_RE.test(freshText(m.plain)));
  const bankAny = after.find((m) => kind(m) === 'bank');
  const t = (m) => (m ? m.date || 0 : Infinity);
  const winners = [['me', t(myReply)], ['bank', t(bankDone)], ['team', t(teamReply)]].filter(([, v]) => v !== Infinity).sort((a, b) => a[1] - b[1]);
  const who = winners.length ? winners[0][0] : '';
  const status = who === 'me' ? ownerStatus(cfg.ownerName) : who === 'bank' ? COMPLAINT_STATUS.BANK : who === 'team' ? COMPLAINT_STATUS.TEAM : COMPLAINT_STATUS.PENDING;
  const resolvedAt = winners.length ? winners[0][1] : 0;
  const amt = bankDone ? (freshText(bankDone.plain).match(AMOUNT_RE) || [])[1] : '';
  const deducted = amt ? Number(String(amt).replace(/,/g, '')) : 0;
  const tatDueAt = (first.date || 0) + (Number(cfg.tatHours) || 24) * 3600e3;
  const pending = status === COMPLAINT_STATUS.PENDING;
  return table.map((r) => ({
    key: `${thread.id}:${r.caseNo || subjCase}:${r.tagId || ''}`,
    threadId: thread.id, caseNo: r.caseNo || subjCase, subject: thread.subject || '',
    date: first.date || 0, vrn: r.vrn, tagId: r.tagId, description: r.description, bcName: r.bcName, agentName: r.agentName, agentId: r.agentId,
    status, resolvedAt: resolvedAt || 0, repliedAt: myReply ? myReply.date || 0 : 0, bankRepliedAt: bankAny ? bankAny.date || 0 : 0,
    deducted, bankNote: bankDone ? freshText(bankDone.plain).replace(/\s+/g, ' ').slice(0, 240) : '',
    messages: msgs.length, lastAt: msgs[msgs.length - 1].date || 0,
    tatDueAt, tatBreached: pending && now > tatDueAt, link: `https://mail.google.com/mail/u/0/#all/${thread.id}`
  }));
}

// ---------------------------------------------------------------- service (cache + background refresh)
const istDay = (ms) => new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10);
const monthStart = (day) => `${day.slice(0, 7)}-01`;

export function createComplaintsService({ getStore, getConfig, lookupAgent, now = () => Date.now(), log = () => {} }) {
  const byThread = new Map();      // threadId → [rows]
  const st = { at: 0, ok: 0, running: null, error: '', coverFrom: '', month: '', sig: '', me: [], threads: 0, lastRun: 0, runs: 0 };
  const cfg = () => normalizeCfg(getConfig());

  async function fetchWindow(from, to) {
    const c = cfg();
    const store = getStore();
    if (!store) throw new Error('Apps Script connect nahi hai (APPS_SCRIPT_URL / SECRET) — Gmail se complaints padhne ke liye zaroori.');
    const query = buildQuery(c.subjects, from, to);
    let n = 0;
    for (let start = 0; start < 1000; start += 100) {
      let out;
      try { out = await store.call('complaints', { query, start, max: 100 }); }
      catch (err) {
        const msg = String((err && err.message) || err);
        if (/unknown action|invalid action|not supported|unauthorized.*action/i.test(msg)) throw new Error('Apps Script me naya Gmail code nahi hai — google-apps-script/Code.gs dobara paste karke Deploy → New version karo (Gmail permission Allow karna).');
        throw err;
      }
      if (!out || !Array.isArray(out.threads)) throw new Error('Apps Script ne complaints data nahi diya — Code.gs update + New version deploy karo.');
      st.me = Array.isArray(out.me) ? out.me : st.me;
      for (const th of out.threads) {
        const rows = parseThread(th, { me: st.me, cfg: c, now: now() });
        if (rows.length) byThread.set(th.id, rows); n++;
      }
      if (!out.more) break;
    }
    return n;
  }

  /** Current month (ya jo window do) refresh. full=true → mahine ka poora; warna pichhle 3 din (naye messages). */
  async function sync({ full = false, from = '', to = '' } = {}) {
    if (st.running) return st.running;
    const run = (async () => {
      const today = istDay(now());
      const c = cfg();
      const sig = JSON.stringify([c.subjects, c.ownerName, c.tatHours]);
      if (st.sig !== sig || st.month !== today.slice(0, 7)) { byThread.clear(); st.coverFrom = ''; full = true; st.sig = sig; st.month = today.slice(0, 7); }
      let f = from, t = to;
      if (!f) {
        const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 3);
        f = full || !st.coverFrom ? monthStart(today) : istDay(d.getTime());
      }
      try {
        const n = await fetchWindow(f, t || '');
        st.threads = byThread.size; st.error = ''; st.ok = now(); st.at = now();
        if (!from && (!st.coverFrom || f < st.coverFrom)) st.coverFrom = f;
        if (from && (!st.coverFrom || from < st.coverFrom)) st.coverFrom = from;
        log(`complaints sync ${f}${t ? '→' + t : ''}: ${n} threads`);
      } catch (err) { st.error = String((err && err.message) || err).slice(0, 300); st.at = now(); throw err; }
    })().finally(() => { st.running = null; st.lastRun = now(); st.runs++; });
    st.running = run; run.catch(() => {});
    return run;
  }

  async function ensureRange(from) {
    if (!MONTH_RE.test(from || '')) return;
    if (!st.coverFrom) { try { await sync({ full: true }); } catch { /* error state me */ } }
    if (st.coverFrom && from < st.coverFrom) {
      const upto = st.coverFrom;
      await sync({ from: monthStart(from), to: upto });   // purane mahine ka hissa (status abhi ke hisaab se)
    }
  }

  /** Due ho to background refresh (timer har 30s yahi call karta hai). */
  function tick() {
    const c = cfg();
    if (!c.enabled || st.running || !getStore()) return;
    if (st.ok && now() - st.lastRun < c.refreshMin * 60e3) return;
    if (!st.ok && st.lastRun && now() - st.lastRun < Math.min(c.refreshMin, 5) * 60e3) return;   // fail par bhi jaldi-jaldi nahi
    sync({ full: !st.coverFrom }).catch((e) => log(`complaints sync fail: ${String((e && e.message) || e).slice(0, 160)}`));
  }

  function rows({ from = '', to = '' } = {}) {
    const out = [];
    for (const list of byThread.values()) for (const r of list) {
      const d = istDay(r.date);
      if (MONTH_RE.test(from) && d < from) continue;
      if (MONTH_RE.test(to) && d > to) continue;
      out.push(r);
    }
    out.sort((a, b) => b.date - a.date);
    const lookups = new Map();
    return out.map((r) => {
      const k = `${r.agentId}|${r.agentName}`;
      if (!lookups.has(k)) { let v = null; try { v = lookupAgent ? lookupAgent({ agentId: r.agentId, agentName: r.agentName }) : null; } catch { v = null; } lookups.set(k, v || {}); }
      const a = lookups.get(k);
      return { ...r, day: istDay(r.date), tlName: a.tlName || '', tlId: a.tlId || '', agentFound: !!a.found };
    });
  }
  const meta = () => ({ at: st.at ? new Date(st.at).toISOString() : '', okAt: st.ok ? new Date(st.ok).toISOString() : '', running: !!st.running, error: st.error, coverFrom: st.coverFrom, threads: byThread.size, config: cfg(), account: st.me[0] || '' });
  return { sync, ensureRange, tick, rows, meta, _state: st, _byThread: byThread };
}
