// Dashboard tab ↔ extension: dashboard ka robot (mascot.js) yahan se baaki tabs ko updates bhejta hai.
document.documentElement.dataset.ffRobotExt = '1';
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.source !== 'ff-robot-page') return;
  try { chrome.runtime.sendMessage(e.data.msg); } catch { /* extension reload hua */ }
});
chrome.runtime.onMessage.addListener((m) => { window.postMessage({ source: 'ff-robot-ext', msg: m }, location.origin); });
