// ws-hook.js - Chạy ở execution context MAIN để hook trực tiếp WebSocket của sảnh WM
(function() {
  if (window.__WM_WS_HOOKED__) return;
  window.__WM_WS_HOOKED__ = true;

  console.log('[WM Hook] Đã kích hoạt bộ lắng nghe WebSocket sảnh WM');

  const OriginalWebSocket = window.WebSocket;
  if (!OriginalWebSocket) return;

  window.WebSocket = function(url, protocols) {
    const ws = protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);

    try {
      const urlStr = String(url);
      console.log('[WM Hook] Kết nối WebSocket mới:', urlStr);

      ws.addEventListener('message', function(event) {
        try {
          // Bắn message về cho content script / iframe injector
          window.postMessage({
            type: 'WM_WS_PACKET_IN',
            url: urlStr,
            data: event.data
          }, '*');
        } catch (err) {}
      });

      const originalSend = ws.send;
      ws.send = function(data) {
        try {
          window.postMessage({
            type: 'WM_WS_PACKET_OUT',
            url: urlStr,
            data: data
          }, '*');
        } catch (err) {}
        return originalSend.apply(this, arguments);
      };
    } catch (e) {
      console.error('[WM Hook] Lỗi gắn hook:', e);
    }

    return ws;
  };

  window.WebSocket.prototype = OriginalWebSocket.prototype;
  window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  window.WebSocket.OPEN = OriginalWebSocket.OPEN;
  window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
  window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;
})();
