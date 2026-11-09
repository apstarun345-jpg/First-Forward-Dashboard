// Gems Robot — relay: dashboard tab (brain) → jo tab abhi saamne hai (robot.js).
const DASH = 'https://first-forward-dashboard.onrender.com/';
const DAY = 24 * 3600e3;
const isDash = (u) => String(u || '').startsWith(DASH);
const ensureAlarm = () => chrome.alarms.create('pull', { periodInMinutes: 0.5 });
// Install / update ke waqt jo tabs pehle se khule hain unme bhi robot daalo (warna reload karna padta)
async function injectOpenTabs() {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (!t.id || !/^https?:/.test(t.url || '')) continue;
    const files = isDash(t.url) ? ['bridge.js'] : ['robot.js'];
    chrome.scripting.executeScript({ target: { tabId: t.id }, files }).catch(() => {});
  }
}
chrome.runtime.onInstalled.addListener(() => { ensureAlarm(); injectOpenTabs(); });
chrome.runtime.onStartup.addListener(ensureAlarm);
let curShow = null;
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (!curShow) return;
  const left = curShow.at + curShow.dur - Date.now();
  if (left < 2500) return;
  try { const t = await chrome.tabs.get(tabId); if (isDash(t.url)) return; } catch { return; }
  chrome.tabs.sendMessage(tabId, { type: 'resume', item: curShow.item, ms: left }).catch(() => {});
});
async function activeTab() { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); return t; }
async function dashTab() { const ts = await chrome.tabs.query({ url: `${DASH}*` }); return ts[0]; }
async function getHist() { const { hist } = await chrome.storage.local.get('hist'); return (Array.isArray(hist) ? hist : []).filter((h) => Date.now() - h.at < DAY); }
async function addHist(it) {
  if (!it || it.fun) return;
  const sig = `${it.key}|${it.head}|${it.big || ''}`;
  const a = (await getHist()).filter((h) => h.sig !== sig);
  a.unshift({ sig, at: Date.now(), icon: it.icon, title: it.title, head: it.head, big: it.big || '', q: it.q || '', mood: it.mood });
  await chrome.storage.local.set({ hist: a.slice(0, 60) });
}
async function toFront(msg) {
  const t = await activeTab();
  if (t && t.id != null && !isDash(t.url)) chrome.tabs.sendMessage(t.id, msg).catch(() => {});
}
// har 30 sec: dashboard peeche ho to usse agli khabar maango
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'pull') return;
  const t = await activeTab(); if (!t || isDash(t.url)) return;
  const d = await dashTab(); if (d) chrome.tabs.sendMessage(d.id, { type: 'pull' }).catch(() => {});
  else toFront({ type: 'nodash' });
});
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || !m.type) return;
  if (m.type === 'show') {
    // abhi chal rahi khabar yaad rakho — tab badle to naye tab me wahi (bacha hua time) turant
    curShow = { item: m.item, at: Date.now(), dur: (m.item && m.item.stay ? m.item.stay : 11000) + 4500 };
    addHist(m.item).then(() => toFront({ type: 'show', item: m.item }));
  }
  else if (m.type === 'open') {
    (async () => {
      const d = await dashTab();
      if (d) { await chrome.tabs.update(d.id, { active: true }); await chrome.windows.update(d.windowId, { focused: true }); if (m.q) chrome.tabs.sendMessage(d.id, { type: 'open', q: m.q }).catch(() => {}); }
      else chrome.tabs.create({ url: DASH + (m.q && m.q[0] === '#' ? m.q : '') });
    })();
  } else if (m.type === 'hist') { getHist().then(reply); return true; }
  else if (m.type === 'status') { dashTab().then((d) => reply({ dash: !!d })); return true; }
});
// icon click → dashboard kholo
chrome.action.onClicked.addListener(async () => {
  const d = await dashTab();
  if (d) { chrome.tabs.update(d.id, { active: true }); chrome.windows.update(d.windowId, { focused: true }); } else chrome.tabs.create({ url: DASH });
});
