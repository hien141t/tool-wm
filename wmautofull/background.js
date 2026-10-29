// WM Auto Helper - Background Service Worker (Manifest V3)
// Đóng vai trò Network Proxy an toàn cho AI Brain (Vượt qua Mixed Content & Private Network Access)

console.log('[WM Background] Service worker đã khởi chạy');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'reloadTab') {
    if (sender.tab && sender.tab.id) {
      chrome.tabs.reload(sender.tab.id);
    }
    return;
  }

  // 1. NẠP DỮ LIỆU NÃO AI TRỰC TIẾP
  if (request.action === 'AI_FETCH_BRAIN') {
    (async () => {
      // Ưu tiên 1: Thử lấy từ Local Sync Bridge (http://127.0.0.1:8421/brain)
      try {
        const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), 1200) : null;
        const resp = await fetch('http://127.0.0.1:8421/brain', {
          method: 'GET',
          cache: 'no-cache',
          signal: controller ? controller.signal : undefined
        });
        if (timeoutId) clearTimeout(timeoutId);
        if (resp.ok) {
          const data = await resp.json();
          if (data && (data.weights || data.markovCounts)) {
            console.log('[WM Background] Đã nạp não thành công từ Local Sync Bridge');
            sendResponse({
              success: true,
              source: 'bridge',
              bridgeConnected: true,
              data: data
            });
            return;
          }
        }
      } catch (err) {
        // Bridge không bật hoặc timeout
      }

      // Ưu tiên 2: Đọc file ai_brain.json đóng gói sẵn trong thư mục Extension
      try {
        const bundledUrl = chrome.runtime.getURL('ai_brain.json');
        const bResp = await fetch(bundledUrl);
        if (bResp.ok) {
          const bData = await bResp.json();
          if (bData && (bData.weights || bData.markovCounts)) {
            console.log('[WM Background] Đã nạp não từ file ai_brain.json đóng gói');
            sendResponse({
              success: true,
              source: 'bundled_file',
              bridgeConnected: false,
              data: bData
            });
            return;
          }
        }
      } catch (err) {
        console.warn('[WM Background] Lỗi đọc bundled ai_brain.json:', err);
      }

      // Ưu tiên 3: Đọc sao lưu từ chrome.storage.local
      try {
        const stored = await chrome.storage.local.get(['wm_ai_brain_state']);
        if (stored && stored.wm_ai_brain_state) {
          sendResponse({
            success: true,
            source: 'storage',
            bridgeConnected: false,
            data: stored.wm_ai_brain_state
          });
          return;
        }
      } catch (e) {}

      sendResponse({ success: false, error: 'Không tìm thấy dữ liệu não AI' });
    })();
    return true; // Giữ kết nối sendResponse mở cho hàm bất đồng bộ (async)
  }

  // 2. TỰ ĐỘNG LƯU DỮ LIỆU NÃO AI VÀO FILE
  if (request.action === 'AI_SAVE_BRAIN') {
    (async () => {
      const payload = request.payload;
      if (!payload) {
        sendResponse({ success: false, error: 'Payload rỗng' });
        return;
      }

      // Sao lưu cục bộ vào chrome.storage.local
      try {
        await chrome.storage.local.set({ wm_ai_brain_state: payload });
      } catch (e) {}

      // Gửi sang Local Bridge để ghi đè vào file ai_brain.json trên ổ cứng
      let bridgeSaved = false;
      try {
        const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), 1500) : null;
        const resp = await fetch('http://127.0.0.1:8421/brain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller ? controller.signal : undefined
        });
        if (timeoutId) clearTimeout(timeoutId);
        if (resp.ok) {
          bridgeSaved = true;
          console.log('[WM Background] Đã tự động lưu não AI vào ai_brain.json trên máy!');
        }
      } catch (err) {
        bridgeSaved = false;
      }

      sendResponse({ success: true, bridgeSaved: bridgeSaved });
    })();
    return true;
  }
});
