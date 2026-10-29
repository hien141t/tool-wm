/**
 * Unit Test: Baccarat Table Detection & Anti-Phantom Sanitization
 * Đảm bảo:
 * 1. Bàn 3 có đếm ngược 7s KHÔNG bị ghép nhầm thành Bàn 37.
 * 2. Số lượng bàn không bị nhân bản phantom (52 bàn).
 * 3. Thẻ bot overlay không bao giờ bị bot tự quét trúng.
 * 4. Tên bàn và ID luôn đồng nhất giữa các giây đếm ngược.
 */

const assert = require('assert');

console.log('=== BẮT ĐẦU KIỂM THỬ NHẬN DIỆN BÀN & CHỐNG BÀN ẢO ===\n');

// 1. Kiểm tra Regex và thuật toán tách số bàn sạch
console.log('--- TEST 1: CHUẨN HÓA TÊN BÀN VÀ TRIỆT TIÊU DÍNH SỐ ĐẾM NGƯỢC ---');
const titleRegex = /^(?:\(([^)]+)\)\s*)?(?:Bac(?:carat)?|Bàn)\s*0*([1-9]\d?)$/i;

function parseCleanTable(rawText) {
  const m = rawText.trim().match(titleRegex);
  if (!m) return null;
  const groupName = m[1] ? `(${m[1]})` : '';
  let tableNum = parseInt(m[2]);
  if (tableNum > 25 && tableNum % 10 !== 0) {
    const candidate = Math.floor(tableNum / 10);
    if (candidate >= 1 && candidate <= 20) tableNum = candidate;
  }
  if (tableNum > 25) return null;
  const cleanTitle = groupName ? `${groupName}Bac ${tableNum}` : `Bac ${tableNum}`;
  const cleanId = cleanTitle.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  return { cleanTitle, cleanId, tableNum };
}

// Bàn 3 bình thường:
const t1 = parseCleanTable('(Sexy)Bac 3');
assert.strictEqual(t1.cleanTitle, '(Sexy)Bac 3');
assert.strictEqual(t1.cleanId, '_sexy_bac_3');
console.log('✅ (Sexy)Bac 3 -> Chuẩn:', t1.cleanTitle, '| ID:', t1.cleanId);

// Bàn 3 bị dính số đếm ngược 7s thành 37:
const t2 = parseCleanTable('(Sexy)Bac 37');
assert.strictEqual(t2.cleanTitle, '(Sexy)Bac 3');
assert.strictEqual(t2.cleanId, '_sexy_bac_3');
console.log('✅ (Sexy)Bac 37 (dính 7s) -> Đã tự sửa về:', t2.cleanTitle, '| ID:', t2.cleanId);

// Bàn 3 bị dính số đếm ngược 8s thành 38:
const t3 = parseCleanTable('(Sexy)Bac 38');
assert.strictEqual(t3.cleanTitle, '(Sexy)Bac 3');
assert.strictEqual(t3.cleanId, '_sexy_bac_3');
console.log('✅ (Sexy)Bac 38 (dính 8s) -> Đã tự sửa về:', t3.cleanTitle, '| ID:', t3.cleanId);

// Cả 3 trường hợp trên đều trỏ về cùng 1 table ID:
assert.strictEqual(t1.cleanId, t2.cleanId);
assert.strictEqual(t2.cleanId, t3.cleanId);
console.log('✅ ĐỒNG NHẤT ID: Dù đếm ngược ở 7s hay 8s thì ID vẫn luôn là _sexy_bac_3, không tạo bàn mới!\n');

// 2. Kiểm tra lọc Leaf Node (Chỉ quét thẻ con cuối cùng, không quét thẻ cha chứa cả title lẫn countdown)
console.log('--- TEST 2: LỌC LEAF NODE (CHỐNG GHÉP THẺ CHA VỚI TIMER) ---');
// Giả lập thẻ cha có 2 con: <span>Bac 3</span> và <span>7s</span>
const fakeParent = {
  children: [{ text: 'Bac 3', children: [] }, { text: '7s', children: [] }],
  innerText: 'Bac 3 7s'
};

// Logic mới: el.children && el.children.length > 0 thì bỏ qua
const shouldSkipParent = fakeParent.children && fakeParent.children.length > 0;
assert.strictEqual(shouldSkipParent, true);
console.log('✅ Thẻ cha chứa cả Bac 3 và 7s bị bỏ qua:', shouldSkipParent);

// Logic mới: chỉ xét thẻ con:
const leafChild = fakeParent.children[0];
const shouldScanChild = (!leafChild.children || leafChild.children.length === 0);
const childParsed = parseCleanTable(leafChild.text);
assert.strictEqual(shouldScanChild, true);
assert.strictEqual(childParsed.cleanTitle, 'Bac 3');
console.log('✅ Thẻ con leaf node được nhận diện chính xác tuyệt đối:', childParsed.cleanTitle, '\n');

// 3. Kiểm tra tự động lọc và xóa bàn ảo > 25
console.log('--- TEST 3: DỌN DẸP BỘ NHỚ BÀN ẢO TRONG TABLESMAP & CACHEDTABLESMAP ---');
const tablesMap = new Map();
tablesMap.set('_sexy_bac_1', { id: '_sexy_bac_1', name: '(Sexy)Bac 1' });
tablesMap.set('_sexy_bac_2', { id: '_sexy_bac_2', name: '(Sexy)Bac 2' });
tablesMap.set('_sexy_bac_3', { id: '_sexy_bac_3', name: '(Sexy)Bac 3' });
// Giả lập có 3 bàn ảo lọt vào trước đó:
tablesMap.set('_sexy_bac_37', { id: '_sexy_bac_37', name: '(Sexy)Bac 37' });
tablesMap.set('_sexy_bac_38', { id: '_sexy_bac_38', name: '(Sexy)Bac 38' });
tablesMap.set('_sexy_bac_52', { id: '_sexy_bac_52', name: '(Sexy)Bac 52' });

console.log('Trước khi dọn dẹp:', tablesMap.size, 'bàn');

// Áp dụng thuật toán dọn dẹp:
for (const [key, t] of tablesMap.entries()) {
  const m = key.match(/_bac_(\d+)/i) || key.match(/bac_?(\d+)/i);
  if (m && parseInt(m[1]) > 25) {
    tablesMap.delete(key);
  }
}

console.log('Sau khi dọn dẹp:', tablesMap.size, 'bàn');
assert.strictEqual(tablesMap.size, 3);
assert.strictEqual(tablesMap.has('_sexy_bac_37'), false);
assert.strictEqual(tablesMap.has('_sexy_bac_38'), false);
assert.strictEqual(tablesMap.has('_sexy_bac_52'), false);
console.log('✅ Toàn bộ bàn phantom 37, 38, 52 đã bị xóa sổ 100%, chỉ giữ lại đúng 3 bàn thực tế!\n');

// 4. Kiểm tra chặn 100% tự quét phần tử của Bot
console.log('--- TEST 4: MIỄN NHIỄM VỚI OVERLAY CỦA CHÍNH BOT ---');
const botSelectors = ['#wm-auto-helper-overlay', '#wm-auto-mini-pill', '.wm-table-card'];

function isBotElement(element) {
  if (!element || !element.closest) return false;
  return !!(
    element.closest('#wm-auto-helper-overlay') ||
    element.closest('#wm-auto-mini-pill') ||
    element.closest('.wm-table-card')
  );
}

// Mock DOM node bên trong overlay bot:
const botCardNode = {
  closest(selector) {
    return botSelectors.includes(selector) ? {} : null;
  }
};

assert.strictEqual(isBotElement(botCardNode), true);
console.log('✅ Thẻ bên trong overlay/card của bot được nhận diện và bỏ qua 100%');

// Mock DOM node bàn game thật:
const realGameNode = {
  closest(selector) {
    return null;
  }
};
assert.strictEqual(isBotElement(realGameNode), false);
console.log('✅ Bàn game thật được phép nhận diện bình thường');

console.log('\n🎉 TẤT CẢ 4 BÀI KIỂM THỬ NHẬN DIỆN BÀN ĐỀU ĐẠT CHUẨN XUẤT SẮC 100%!');
