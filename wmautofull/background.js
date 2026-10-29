// Background service worker
console.log('WM Auto Helper - Background script loaded');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'reloadTab') {
    chrome.tabs.reload(sender.tab.id);
  }
});
