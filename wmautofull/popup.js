// popup.js - Trạng thái & hành động nhanh
document.addEventListener('DOMContentLoaded', () => {
  const reloadBtn = document.getElementById('reload-tab-btn');
  if (reloadBtn) {
    reloadBtn.addEventListener('click', async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
          chrome.tabs.reload(tab.id);
          window.close();
        }
      } catch (e) {
        console.error(e);
      }
    });
  }
});
