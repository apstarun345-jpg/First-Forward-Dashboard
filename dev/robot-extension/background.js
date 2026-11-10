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
// 🎬 tab badla → jo khabar abhi board par chal rahi hai wahi, usi jagah, usi board side par, jahan tak pahunchi wahin se
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (!curShow) return;
  const left = curShow.t0 + curShow.dur - Date.now();
  if (left < 1500) { curShow = null; return; }
  if (curShow.owner === tabId) return; // isi tab par already chal rahi
  const prev = curShow.owner;
  const msg = { type: 'resume', item: curShow.item, ms: left, elapsed: Date.now() - curShow.t0, fx: curShow.fx, fy: curShow.fy, side: curShow.side };
  curShow.owner = tabId;
  if (prev != null) chrome.tabs.sendMessage(prev, { type: 'drop', key: curShow.item && curShow.item.key }).catch(() => {});
  chrome.tabs.sendMessage(tabId, msg).catch(() => { /* tab me robot / bridge abhi nahi — agli baar */ });
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
    const it = m.item || {}, typing = String(it.head || '').length * 28;
    curShow = { item: it, t0: Date.now() + (m.st ? 0 : 2400), dur: Math.max(it.stay || 0, 10000) + typing + 1200, owner: sender.tab ? sender.tab.id : null, fx: m.st ? m.st.fx : undefined, fy: m.st ? m.st.fy : undefined, side: m.st ? m.st.side : undefined };
    addHist(m.item).then(() => toFront({ type: 'show', item: m.item }));
  }
  else if (m.type === 'stage') { // jo tab dikha raha hai wo landing ke baad apni jagah batata hai
    if (curShow && curShow.item && curShow.item.key === m.key) { curShow.fx = m.fx; curShow.fy = m.fy; curShow.side = m.side; curShow.t0 = m.t0 || Date.now(); if (sender.tab) curShow.owner = sender.tab.id; }
  }
  else if (m.type === 'end') { if (curShow && curShow.item && curShow.item.key === m.key && (curShow.owner == null || !sender.tab || sender.tab.id === curShow.owner)) curShow = null; } // sirf abhi dikhane wale tab ka 'end' maano
  else if (m.type === 'open') {
    (async () => {
      const d = await dashTab();
      if (d) { await chrome.tabs.update(d.id, { active: true }); await chrome.windows.update(d.windowId, { focused: true }); if (m.q) chrome.tabs.sendMessage(d.id, { type: 'open', q: m.q }).catch(() => {}); }
      else chrome.tabs.create({ url: DASH + (m.q && m.q[0] === '#' ? m.q : '') });
    })();
  } else if (m.type === 'ask') {
    // 💬 sawaal → dashboard tab (Gems wahan hai) → jawab wapas isi tab par
    (async () => {
      const d = await dashTab(), tab = sender.tab && sender.tab.id;
      if (!d) { if (tab != null) chrome.tabs.sendMessage(tab, { type: 'answer', item: { key: 'nodash', fun: true, mood: 'sad', icon: '📊', title: 'Dashboard band hai', head: 'Sawaal ka jawab dene ke liye dashboard ka tab khula rakho', view: 'text', stay: 6000 } }).catch(() => {}); return; }
      chrome.tabs.sendMessage(d.id, { type: 'ask', q: m.q, tab }).catch(() => {});
    })();
  } else if (m.type === 'answer') {
    if (m.tab != null) chrome.tabs.sendMessage(m.tab, { type: 'answer', item: m.item }).catch(() => {});
  } else if (m.type === 'hist') { getHist().then(reply); return true; }
  else if (m.type === 'status') { dashTab().then((d) => reply({ dash: !!d })); return true; }
});
// icon click → dashboard kholo
chrome.action.onClicked.addListener(async () => {
  const d = await dashTab();
  if (d) { chrome.tabs.update(d.id, { active: true }); chrome.windows.update(d.windowId, { focused: true }); } else chrome.tabs.create({ url: DASH });
});
