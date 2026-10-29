// WM Auto Helper - Background Service Worker (Manifest V3)
// Đóng vai trò Network Proxy an toàn cho AI Brain (Vượt qua Mixed Content & Private Network Access)

console.log('[WM Background] Service worker đã khởi chạy');

let cachedBridgeToken = null;

async function getBridgeToken() {
  if (cachedBridgeToken) return cachedBridgeToken;
  try {
    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 1000) : null;
    const resp = await fetch('http://127.0.0.1:8421/token', {
      method: 'GET',
      cache: 'no-cache',
      signal: controller ? controller.signal : undefined
    });
    if (timeoutId) clearTimeout(timeoutId);
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.token) {
        cachedBridgeToken = data.token;
        return cachedBridgeToken;
      }
    }
  } catch (e) {}
  return null;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'reloadTab') {
    if (sender.tab && sender.tab.id) {
      chrome.tabs.reload(sender.tab.id);
    }
    return;
  }

  // 1. NẠP DỮ LIỆU NÃO AI TRỰC TIẾP
  // FIX 8: Thứ tự ưu tiên đúng: Bridge > chrome.storage.local > bundled file
  // Kết hợp so sánh revision để chọn nguồn mới nhất
  if (request.action === 'AI_FETCH_BRAIN') {
    (async () => {
      let bridgeData = null;
      let storageData = null;
      let bundledData = null;

      // --- Ưu tiên 1: Thử lấy từ Local Sync Bridge (http://127.0.0.1:8421/brain) ---
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
            bridgeData = data;
            console.log('[WM Background] Đã nạp não từ Local Sync Bridge');
          }
        }
      } catch (err) {
        // Bridge không bật hoặc timeout
      }

      // --- Ưu tiên 2: Đọc sao lưu từ chrome.storage.local ---
      try {
        const stored = await chrome.storage.local.get(['wm_ai_brain_state']);
        if (stored && stored.wm_ai_brain_state) {
          storageData = stored.wm_ai_brain_state;
        }
      } catch (e) {}

      // --- FIX 8: So sánh revision giữa Bridge và Storage ---
      // Nếu storage có revision cao hơn Bridge, ưu tiên storage
      if (bridgeData && storageData) {
        const bridgeRev = typeof bridgeData.revision === 'number' ? bridgeData.revision : 0;
        const storageRev = typeof storageData.revision === 'number' ? storageData.revision : 0;
        if (storageRev > bridgeRev) {
          console.log(`[WM Background] Storage (rev=${storageRev}) mới hơn Bridge (rev=${bridgeRev}), ưu tiên Storage.`);
          sendResponse({
            success: true,
            source: 'storage',
            bridgeConnected: true,
            data: storageData
          });
          return;
        }
        // Bridge có revision >= storage → dùng Bridge
        sendResponse({
          success: true,
          source: 'bridge',
          bridgeConnected: true,
          data: bridgeData
        });
        return;
      }

      if (bridgeData) {
        sendResponse({
          success: true,
          source: 'bridge',
          bridgeConnected: true,
          data: bridgeData
        });
        return;
      }

      if (storageData) {
        sendResponse({
          success: true,
          source: 'storage',
          bridgeConnected: false,
          data: storageData
        });
        return;
      }

      // --- Ưu tiên 3 (cuối cùng): Đọc file ai_brain.json đóng gói sẵn ---
      try {
        const bundledUrl = chrome.runtime.getURL('ai_brain.json');
        const bResp = await fetch(bundledUrl);
        if (bResp.ok) {
          const bData = await bResp.json();
          if (bData && (bData.weights || bData.markovCounts)) {
            bundledData = bData;
            console.log('[WM Background] Đã nạp não từ file ai_brain.json đóng gói (fallback cuối)');
            sendResponse({
              success: true,
              source: 'bundled_file',
              bridgeConnected: false,
              data: bundledData
            });
            return;
          }
        }
      } catch (err) {
        console.warn('[WM Background] Lỗi đọc bundled ai_brain.json:', err);
      }

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
        // Đọc token từ Bridge (Bridge tự sinh khi khởi động)
        // Background không cần token để đọc (GET), nhưng cần token để ghi (POST)
        // Token được lưu ở bridge_token.txt, background không có quyền đọc file hệ thống
        // → dùng header Authorization nếu token được cung cấp qua payload
        let bridgeToken = payload._bridgeToken || cachedBridgeToken;
        if (!bridgeToken) {
          bridgeToken = await getBridgeToken();
        }
        const headers = { 'Content-Type': 'application/json' };
        if (bridgeToken) {
          headers['Authorization'] = 'Bearer ' + bridgeToken;
        }
        // Tạo bản sao payload không có _bridgeToken để không lưu vào file
        const payloadClean = Object.assign({}, payload);
        delete payloadClean._bridgeToken;

        const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), 1500) : null;
        const resp = await fetch('http://127.0.0.1:8421/brain', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(payloadClean),
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
