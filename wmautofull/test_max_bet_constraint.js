/**
 * Unit Test for Max Total Bet Constraint
 */
const fs = require('fs');

const mockLocalStorage = {
  data: {},
  getItem(k) { return this.data[k] || null; },
  setItem(k, v) { this.data[k] = String(v); },
  removeItem(k) { delete this.data[k]; }
};

const domElements = {};
function createMockEl(id) {
  const el = {
    id,
    value: '',
    textContent: '',
    style: {},
    classList: {
      remove() {},
      add() {}
    },
    disabled: false,
    appendChild() {},
    addEventListener(evt, fn) { this[`on_${evt}`] = fn; }
  };
  domElements[id] = el;
  return el;
}

const mockDoc = {
  readyState: 'complete',
  getElementById(id) {
    if (!domElements[id]) createMockEl(id);
    return domElements[id];
  },
  querySelectorAll() { return []; },
  createElement(tag) { return createMockEl('elem_' + Math.random().toString(36).substr(2, 5)); },
  body: { appendChild() {} }
};

global.window = {
  location: { hostname: 'wmcasinotest.com' },
  getComputedStyle() { return { display: 'block', visibility: 'visible' }; },
  addEventListener() {}
};
global.document = mockDoc;
global.localStorage = mockLocalStorage;
global.chrome = {
  storage: {
    local: {
      get(keys) { return Promise.resolve({}); },
      set(data) { return Promise.resolve(); }
    }
  }
};

// Đọc mã nguồn content.js
const contentCode = fs.readFileSync('D:/tool game/tool wm/wmautofull/content.js', 'utf-8');

// Tạo môi trường thực thi
const sandbox = {
  window: global.window,
  document: mockDoc,
  localStorage: mockLocalStorage,
  chrome: global.chrome,
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Promise,
  parseInt,
  parseFloat,
  Math,
  Date,
  Array,
  Object,
  alert: (msg) => console.log('Mock Alert:', msg)
};
sandbox.global = sandbox;

const vm = require('vm');
const context = vm.createContext(sandbox);
vm.runInContext(contentCode + '\n;global.WMAutoHelper = WMAutoHelper;', context);

const WMAutoHelper = sandbox.WMAutoHelper;

async function runConstraintTests() {
  console.log('=== BẮT ĐẦU KIỂM THỬ RÀNG BUỘC HẠN MỨC TỔNG CƯỢC ===\n');

  const bot = new WMAutoHelper();
  bot.init();

  // Test 1: Khởi tạo giá trị mặc định & cập nhật UI
  console.log('--- TEST 1: CẤU HÌNH HẠN MỨC MẶC ĐỊNH ---');
  console.log(`Hạn mức ban đầu: ${bot.maxTotalBet}`);
  if (bot.maxTotalBet === 5000) {
    console.log('✅ TEST 1 ĐẠT: Mặc định hạn mức là 5.000\n');
  } else {
    console.error('❌ TEST 1 THẤT BẠI: Hạn mức mặc định không đúng\n');
    process.exit(1);
  }

  // Test 2: Tiến độ hiển thị UI
  console.log('--- TEST 2: HIỂN THỊ TIẾN ĐỘ HẠN MỨC (0 / 5,000) ---');
  bot.stats.totalAmount = 2500;
  bot.updateLimitProgressUI();
  const progressText = domElements['wm-limit-progress-text'].textContent;
  const percentText = domElements['wm-limit-percent'].textContent;
  console.log(`Hiển thị UI: "${progressText}" - Phần trăm: "${percentText}"`);
  if (progressText.includes('2.500') && progressText.includes('5.000') && percentText === '50%') {
    console.log('✅ TEST 2 ĐẠT: Giao diện tính đúng 50% tiến độ (2.500 / 5.000)\n');
  } else {
    console.error('❌ TEST 2 THẤT BẠI\n');
    process.exit(1);
  }

  // Test 3: Chặn bắt đầu cược nếu đã chạm hạn mức
  console.log('--- TEST 3: CHẶN START KHI ĐÃ ĐẠT HẠN MỨC ---');
  bot.stats.totalAmount = 5000;
  bot.start();
  if (!bot.isRunning) {
    console.log('✅ TEST 3 ĐẠT: Bot từ chối khởi động khi tổng tiền cược đã chạm mức 5.000\n');
  } else {
    console.error('❌ TEST 3 THẤT BẠI: Bot vẫn chạy dù đã chạm hạn mức!\n');
    process.exit(1);
  }

  // Test 4: Tự động dừng vòng lặp đánh giá bàn khi chạm hạn mức
  console.log('--- TEST 4: TỰ ĐỘNG DỪNG KHI ĐẠT HẠN MỨC TRONG VÒNG LẶP ---');
  bot.stats.totalAmount = 4900;
  bot.isRunning = true;
  bot.stats.totalAmount = 5050; // Giả sử ván trước vừa đặt cược xong đạt 5050
  await bot.evaluateAllTablesForBetting();
  if (!bot.isRunning) {
    console.log('✅ TEST 4 ĐẠT: evaluateAllTablesForBetting() lập tức dừng bot khi chạm hạn mức\n');
  } else {
    console.error('❌ TEST 4 THẤT BẠI\n');
    process.exit(1);
  }

  // Test 5: Ngăn chặn đặt cược vượt hạn mức ở evaluateSingleTable
  console.log('--- TEST 5: CHẶN ĐẶT CƯỢC KHI LỆNH MỚI SẼ LÀM VƯỢT HẠN MỨC ---');
  bot.stats.totalAmount = 4950;
  bot.selectedChip = 100; // 4950 + 100 = 5050 > 5000
  bot.isRunning = true;
  let executed = false;
  bot.executeBet = async () => { executed = true; };
  bot.aiEngine = {
    generatePrediction: () => ({
      predicted: 'B',
      shouldBet: true,
      confidence: 0.7,
      tableName: 'Bàn Test',
      rationale: 'Test limit'
    })
  };
  const mockTable = {
    id: 'tbl_limit_test',
    name: 'Bàn 1',
    history: ['B', 'P', 'B'],
    betTime: 15
  };
  await bot.evaluateSingleTable(mockTable);
  if (!executed && !bot.isRunning) {
    console.log('✅ TEST 5 ĐẠT: Lệnh cược vượt quá hạn mức bị chặn và bot tự động dừng an toàn\n');
  } else {
    console.error('❌ TEST 5 THẤT BẠI: Lệnh cược vượt hạn mức vẫn được đặt!\n');
    process.exit(1);
  }

  console.log('🎉 TẤT CẢ CÁC BÀI KIỂM THỬ RÀNG BUỘC HẠN MỨC ĐỀU THÀNH CÔNG 100%!');
}

runConstraintTests().catch(err => {
  console.error(err);
  process.exit(1);
});
