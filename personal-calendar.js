/* Personal-link issuance calendar. Input is already limited to the authenticated link's scope. */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
const label = (ym) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-01T00:00:00Z`));

/** Current + previous calendar month; completed report days only (today's partial data is excluded). */
export function personalActivityCalendar(rows, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today))) throw new Error('Invalid calendar date');
  const now = new Date(`${today}T00:00:00Z`);
  if (!Number.isFinite(now.getTime()) || now.toISOString().slice(0, 10) !== today) throw new Error('Invalid calendar date');
  const ym = today.slice(0, 7);
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const cutoff = new Date(now.getTime() - 86400e3).toISOString().slice(0, 10);
  const months = [ym, prev];
  const byDay = new Map();
  for (const row of rows || []) {
    const date = String(row && row.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !months.includes(date.slice(0, 7)) || date > cutoff) continue;
    const d = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== date) continue;
    const n = Number(row.n);
    if (!Number.isFinite(n) || n <= 0) continue;
    const cls = row.cls === 'VC4' || row.cls === 'VC20' ? row.cls : 'VC5+';
    const entry = byDay.get(date) || { VC4: 0, VC20: 0, 'VC5+': 0 };
    entry[cls] += n; byDay.set(date, entry);
  }
  const total = (v) => v.VC4 + v.VC20 + v['VC5+'];
  const panel = (month, selected) => {
    const [year, mon] = month.split('-').map(Number);
    const firstWeekday = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
    const days = new Date(Date.UTC(year, mon, 0)).getUTCDate();
    const vals = Array.from({ length: days }, (_, i) => {
      const date = `${month}-${pad(i + 1)}`, c = byDay.get(date) || { VC4: 0, VC20: 0, 'VC5+': 0 };
      return { date, c, n: total(c), pending: date > cutoff };
    });
    const max = Math.max(1, ...vals.map((v) => v.n));
    const sum = vals.reduce((s, v) => s + v.n, 0), active = vals.filter((v) => v.n > 0).length;
    const buttons = vals.map((v, i) => {
      const level = v.pending ? 'pending' : !v.n ? 'zero' : `level${Math.min(4, Math.ceil(v.n / max * 4))}`;
      const text = v.pending ? 'Not yet in completed report' : `${fmt(v.n)} tags issued`;
      return `<button type="button" class="pl-cal-day ${level}" data-cal-day="${v.date}" aria-label="${v.date}: ${text}" aria-pressed="false" ${v.pending ? 'disabled' : ''}><span>${i + 1}</span><b>${v.pending ? '—' : fmt(v.n)}</b></button>`;
    }).join('');
    const details = vals.filter((v) => !v.pending).map((v) => `<div class="pl-cal-detail" data-cal-detail="${v.date}" hidden><h4>${esc(v.date)} · ${fmt(v.n)} tags</h4><div class="pl-cal-split"><span>VC4 <b>${fmt(v.c.VC4)}</b></span><span>VC20 <b>${fmt(v.c.VC20)}</b></span><span>VC5+ <b>${fmt(v.c['VC5+'])}</b></span></div>${v.n ? '' : '<p class="dim small">No issuance recorded in this report for this date.</p>'}</div>`).join('');
    return `<div data-cal-grid="${month}" ${selected ? '' : 'hidden'}><p class="pl-cal-summary"><b>${esc(label(month))}</b> · ${fmt(sum)} tags · ${fmt(active)} active ${active === 1 ? 'day' : 'days'}</p><div class="pl-cal-week">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<span>${d}</span>`).join('')}</div><div class="pl-cal-grid">${'<span class="pl-cal-blank" aria-hidden="true"></span>'.repeat(firstWeekday)}${buttons}</div><div class="pl-cal-details" aria-live="polite"><p class="dim small" data-cal-placeholder>Select a completed date to see the class-wise split.</p>${details}</div></div>`;
  };
  return `<section class="pb-card pl-calendar" id="pl-activity-calendar"><div class="pb-card-head"><div><h3>📆 Day-wise Activity Calendar</h3><p class="pb-matrix-note">Issuance for this link's agent or team · completed report through ${esc(cutoff)} · today is excluded</p></div><div class="pl-cal-months">${months.map((m, i) => `<button type="button" class="pb-btn ${i === 0 ? 'on' : ''}" data-cal-month="${m}" aria-pressed="${i === 0}">${esc(label(m))}</button>`).join('')}</div></div><p class="pl-cal-legend"><span>○ No issuance recorded</span><span>🟩 Higher activity = darker</span><span>— Not yet in completed report</span></p>${months.map((m, i) => panel(m, i === 0)).join('')}<p class="dim small">Same scoped issuance data and class groups as Date-wise Issuance. Data depends on the source sheet and may be delayed; today’s live numbers are separate.</p></section>`;
}
