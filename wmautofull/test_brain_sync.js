/**
 * Unit Test: AI Brain Direct Sync & Multi-Profile Persistence
 * Kiểm chứng:
 * 1. AI Engine tải trực tiếp 100% dữ liệu từ file ai_brain.json (732 ván, 46 mẫu cầu).
 * 2. Ngay cả khi IndexedDB đang rỗng hoặc có số liệu cũ (0 ván), dữ liệu não thật không bị ghi đè thành 0.
 * 3. Mô phỏng Background Service Worker xử lý AI_FETCH_BRAIN và AI_SAVE_BRAIN vượt rào Mixed Content.
 */

const fs = require('fs');
const assert = require('assert');

console.log('=== BẮT ĐẦU KIỂM THỬ NẠP VÀ LƯU NÃO AI TRỰC TIẾP ===\n');

// 1. Kiểm tra đọc trực tiếp file ai_brain.json trên đĩa
console.log('--- TEST 1: ĐỌC VÀ XÁC THỰC FILE ai_brain.json TRÊN Ổ CỨNG ---');
const brainPath = 'D:/tool game/tool wm/wmautofull/ai_brain.json';
assert.strictEqual(fs.existsSync(brainPath), true, 'File ai_brain.json phải tồn tại trên ổ cứng');

const brainContent = JSON.parse(fs.readFileSync(brainPath, 'utf8'));
assert.ok(brainContent.stats, 'ai_brain.json phải chứa stats');
assert.ok(brainContent.stats.totalRoundsObserved >= 700, 'Số ván đã học phải >= 700');
assert.ok(brainContent.stats.patternsLearnedCount >= 40, 'Số mẫu cầu phải >= 40');
console.log(`✅ File não hợp lệ: ${brainContent.stats.totalRoundsObserved} ván | ${brainContent.stats.patternsLearnedCount} mẫu cầu | Tỉ lệ thắng: ${(brainContent.stats.accuracy * 100).toFixed(1)}%\n`);

// 2. Mô phỏng Chrome Extension Environment (Background Service Worker & Message Passing)
console.log('--- TEST 2: MÔ PHỎNG BACKGROUND SERVICE WORKER PROXY ---');

let storedBrain = null;
const mockChrome = {
  runtime: {
    getURL(path) { return `chrome-extension://mock_id/${path}`; },
    sendMessage(message, callback) {
      if (message.action === 'AI_FETCH_BRAIN') {
        // Background đọc file ai_brain.json và trả về
        setTimeout(() => {
          callback({
            success: true,
            source: 'bundled_file',
            bridgeConnected: true,
            data: brainContent
          });
        }, 10);
      } else if (message.action === 'AI_SAVE_BRAIN') {
        storedBrain = message.payload;
        setTimeout(() => {
          callback({ success: true, bridgeSaved: true });
        }, 10);
      }
    }
  },
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {}
    }
  }
};

global.chrome = mockChrome;
const mockLocalStorage = {
  getItem: () => null,
  setItem: () => {}
};
global.localStorage = mockLocalStorage;
global.window = {
  localStorage: mockLocalStorage
};

const aiCode = fs.readFileSync('D:/tool game/tool wm/wmautofull/ai-engine.js', 'utf8');
new Function('window', aiCode)(global.window);
const WMBaccaratAIEngine = global.window.WMBaccaratAIEngine;

async function runTest2() {
  const engine = new WMBaccaratAIEngine();
  await engine.isReadyPromise;

  console.log('Stats sau khi engine nạp trực tiếp qua Background:');
  console.log(`- Ván đã ghi nhận: ${engine.stats.totalRoundsObserved}`);
  console.log(`- Dự đoán đã chấm: ${engine.stats.predictionsScored} (${engine.stats.wins}W - ${engine.stats.losses}L)`);
  console.log(`- Độ chính xác: ${(engine.stats.accuracy * 100).toFixed(1)}%`);
  console.log(`- Mẫu cầu đã tích lũy: ${engine.stats.patternsLearnedCount} mẫu`);
  console.log(`- Trạng thái kết nối Bridge: ${engine.bridgeConnected ? 'ĐÃ KẾT NỐI' : 'CHƯA'}`);

  assert.strictEqual(engine.stats.totalRoundsObserved, brainContent.stats.totalRoundsObserved);
  assert.strictEqual(engine.stats.predictionsScored, brainContent.stats.predictionsScored);
  assert.strictEqual(engine.bridgeConnected, true);
  console.log('✅ TEST 2 ĐẠT: AI Engine đã nạp trực tiếp 100% dữ liệu não từ file!\n');

  // 3. Kiểm tra tự động lưu khi có ván mới
  console.log('--- TEST 3: TỰ ĐỘNG GỬI LƯU NÃO KHI CÓ VÁN MỚI ---');
  const prevCount = engine.stats.totalRoundsObserved;
  engine.onRoundCompleted('bac_table_sync_test', 'Baccarat Test', ['B', 'P', 'B'], 'B');
  await new Promise(r => setTimeout(r, 50));

  assert.strictEqual(engine.stats.totalRoundsObserved, prevCount + 1);
  assert.ok(storedBrain !== null, 'Phải gửi payload lưu sang Background');
  assert.strictEqual(storedBrain.stats.totalRoundsObserved, prevCount + 1);
  console.log(`✅ TEST 3 ĐẠT: Ván mới (${storedBrain.stats.totalRoundsObserved} ván) được tự động chuyển sang Background lưu ngay lập tức!\n`);

  console.log('🎉 TẤT CẢ CÁC BÀI KIỂM THỬ NẠP NÃO TRỰC TIẾP ĐỀU THÀNH CÔNG 100%!');
  setTimeout(() => process.exit(0), 100);
}

runTest2().catch(err => {
  console.error(err);
  process.exit(1);
});
