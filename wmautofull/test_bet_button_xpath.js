/**
 * Unit Test: Exact XPath & Candidate IDs Resolution for WM Casino Bet Buttons
 * Kiểm tra các đường dẫn XPath và ID người dùng cung cấp:
 * (//div[@id='groupMultiple_101_507_betAreaPlayer'])[1]
 * (//div[@id='groupMultiple_101_507_betAreaBanker'])[1]
 * (//div[@id='groupMultiple_101_508_betAreaPlayer'])[1]
 * (//div[@id='groupMultiple_101_508_betAreaBanker'])[1]
 */

const assert = require('assert');

console.log('=== BẮT ĐẦU KIỂM THỬ XPATH & NÚT CƯỢC WM CASINO ===\n');

// 1. Giả lập phương thức getCandidateTableIds
function getCandidateTableIds(table) {
  const candidates = new Set();
  if (!table) return [];

  if (table.id) candidates.add(table.id);
  if (table.rawId) candidates.add(table.rawId);
  if (table.cardNode && table.cardNode.id) candidates.add(table.cardNode.id);
  try {
    const closestContainer = table.cardNode?.closest?.('[id^="groupMultiple_"]');
    if (closestContainer && closestContainer.id) candidates.add(closestContainer.id);
  } catch (e) {}

  const allStrings = [table.id, table.rawId, table.name, table.cardNode?.id].filter(Boolean);
  for (const str of allStrings) {
    const gmMatch = str.match(/groupMultiple_(\d+)_(\d+)/i);
    if (gmMatch) {
      candidates.add(`groupMultiple_${gmMatch[1]}_${gmMatch[2]}`);
      candidates.add(`groupMultiple_101_${gmMatch[2]}`);
    }
  }

  const nameStr = table.name || '';
  const isSexy = /sexy/i.test(nameStr) || /sexy/i.test(table.id || '');
  const isClassic = /classic/i.test(nameStr) || /classic/i.test(table.id || '');
  const isSpeed = /speed/i.test(nameStr) || /speed/i.test(table.id || '');

  const numMatches = (nameStr + ' ' + (table.id || '')).match(/\b\d+\b/g) || [];
  const numbers = Array.from(new Set(numMatches.map(n => parseInt(n)).filter(n => !isNaN(n) && n > 0)));

  for (const num of numbers) {
    candidates.add(`groupMultiple_101_${num}`);
    candidates.add(`groupMultiple_101_${String(num).padStart(2, '0')}`);

    if (isSexy || (num >= 1 && num <= 50)) {
      candidates.add(`groupMultiple_101_${500 + num}`);
    }
    if (num >= 501 && num <= 599) {
      candidates.add(`groupMultiple_101_${num}`);
    }

    if (isClassic || (num >= 1 && num <= 50)) {
      candidates.add(`groupMultiple_101_${100 + num}`);
    }
    if (num >= 101 && num <= 199) {
      candidates.add(`groupMultiple_101_${num}`);
    }

    if (isSpeed || (num >= 1 && num <= 50)) {
      candidates.add(`groupMultiple_101_${200 + num}`);
    }

    if (num >= 900 && num <= 999) {
      candidates.add(`groupMultiple_101_${num}`);
    }
  }

  return Array.from(candidates);
}

// ----------------------------------------------------
// TEST 1: SINH DANH SÁCH CANDIDATE IDS CHÍNH XÁC
// ----------------------------------------------------
console.log('--- TEST 1: SINH CANDIDATE IDS TỪ TÊN VÀ ID BÀN ---');

const sexy8 = { id: '_sexy_bac_8', name: '(Sexy)Bac 8' };
const cand8 = getCandidateTableIds(sexy8);
console.log('Candidate IDs cho (Sexy)Bac 8:', cand8);
assert(cand8.includes('groupMultiple_101_508'), 'Phải chứa groupMultiple_101_508 cho (Sexy)Bac 8');
console.log('✅ (Sexy)Bac 8 -> Có chứa groupMultiple_101_508');

const sexy7 = { id: '_sexy_bac_7', name: '(Sexy)Bac 7' };
const cand7 = getCandidateTableIds(sexy7);
console.log('Candidate IDs cho (Sexy)Bac 7:', cand7);
assert(cand7.includes('groupMultiple_101_507'), 'Phải chứa groupMultiple_101_507 cho (Sexy)Bac 7');
console.log('✅ (Sexy)Bac 7 -> Có chứa groupMultiple_101_507');

const bac931 = { id: 'bac_931', name: 'Bac 931' };
const cand931 = getCandidateTableIds(bac931);
console.log('Candidate IDs cho Bac 931:', cand931);
assert(cand931.includes('groupMultiple_101_931'), 'Phải chứa groupMultiple_101_931 cho Bac 931');
console.log('✅ Bac 931 -> Có chứa groupMultiple_101_931\n');

// ----------------------------------------------------
// TEST 2: TÌM KIẾM NÚT CƯỢC THEO ID VÀ XPATH TRÊN GIẢ LẬP DOM
// ----------------------------------------------------
console.log('--- TEST 2: TRUY VẤN NÚT CƯỢC BẰNG ID VÀ XPATH TRÊN GIẢ LẬP DOM ---');

// Tạo mock DOM đơn giản hỗ trợ getElementById và evaluate (XPath)
class MockElement {
  constructor(id, tagName = 'div', text = '') {
    this.id = id;
    this.tagName = tagName;
    this.innerText = text;
    this.children = [];
    this.events = [];
  }
  addEventListener(evt, fn) { this.events.push(evt); }
  dispatchEvent(evt) { this.events.push(evt.type || evt); }
  click() { this.events.push('click'); }
  scrollIntoView() { this.events.push('scrollIntoView'); }
  closest(selector) { return this; }
}

const mockDom = {
  elements: new Map(),
  register(el) {
    this.elements.set(el.id, el);
  },
  getElementById(id) {
    return this.elements.get(id) || null;
  },
  evaluate(xpath, doc, resolver, resultType, result) {
    // Parser đơn giản cho (//div[@id='...'])[1]
    const m = xpath.match(/@id=['"]([^'"]+)['"]/);
    if (m && this.elements.has(m[1])) {
      return { singleNodeValue: this.elements.get(m[1]) };
    }
    return { singleNodeValue: null };
  }
};

// Đăng ký các element theo đúng XPath người dùng cung cấp
const btn507P = new MockElement('groupMultiple_101_507_betAreaPlayer', 'div', 'Player 1:1');
const btn507B = new MockElement('groupMultiple_101_507_betAreaBanker', 'div', 'Banker 1:0.95');
const btn508P = new MockElement('groupMultiple_101_508_betAreaPlayer', 'div', 'Player 1:1');
const btn508B = new MockElement('groupMultiple_101_508_betAreaBanker', 'div', 'Banker 1:0.95');
const btn931P = new MockElement('groupMultiple_101_931_betAreaPlayer', 'div', 'Player 1:1');
const btn931B = new MockElement('groupMultiple_101_931_betAreaBanker', 'div', 'Banker 1:0.95');

mockDom.register(btn507P);
mockDom.register(btn507B);
mockDom.register(btn508P);
mockDom.register(btn508B);
mockDom.register(btn931P);
mockDom.register(btn931B);

function findTargetBetButton(table, betTarget, doc) {
  const betSuffix = betTarget === 'B' ? 'Banker' : 'Player';
  const candidateIds = getCandidateTableIds(table);

  // 1. Tìm theo getElementById
  for (const cid of candidateIds) {
    const el = doc.getElementById(`${cid}_betArea${betSuffix}`);
    if (el) return el;
  }

  // 2. Tìm theo XPath
  for (const cid of candidateIds) {
    const xpath = `(//div[@id='${cid}_betArea${betSuffix}'])[1]`;
    const res = doc.evaluate(xpath, doc, null, 9, null);
    if (res && res.singleNodeValue) return res.singleNodeValue;
  }

  return null;
}

// Kiểm tra tìm nút Banker trên (Sexy)Bac 8
const found8B = findTargetBetButton(sexy8, 'B', mockDom);
assert.strictEqual(found8B, btn508B);
console.log('✅ Tìm thấy nút Banker trên (Sexy)Bac 8 ->', found8B.id);

// Kiểm tra tìm nút Player trên (Sexy)Bac 8
const found8P = findTargetBetButton(sexy8, 'P', mockDom);
assert.strictEqual(found8P, btn508P);
console.log('✅ Tìm thấy nút Player trên (Sexy)Bac 8 ->', found8P.id);

// Kiểm tra tìm nút Banker trên (Sexy)Bac 7
const found7B = findTargetBetButton(sexy7, 'B', mockDom);
assert.strictEqual(found7B, btn507B);
console.log('✅ Tìm thấy nút Banker trên (Sexy)Bac 7 ->', found7B.id);

// Kiểm tra tìm nút Player trên (Sexy)Bac 7
const found7P = findTargetBetButton(sexy7, 'P', mockDom);
assert.strictEqual(found7P, btn507P);
console.log('✅ Tìm thấy nút Player trên (Sexy)Bac 7 ->', found7P.id);

// Kiểm tra tìm nút Player trên Bac 931
const found931P = findTargetBetButton(bac931, 'P', mockDom);
assert.strictEqual(found931P, btn931P);
console.log('✅ Tìm thấy nút Player trên Bac 931 ->', found931P.id);

// ----------------------------------------------------
// TEST 3: ĐẢM BẢO CHUỖI SỰ KIỆN CLICK HOÀN CHỈNH
// ----------------------------------------------------
console.log('\n--- TEST 3: KÍCH HOẠT SỰ KIỆN CLICK CHUẨN (MOUSEDOWN -> MOUSEUP -> CLICK) ---');

function triggerFullClick(el) {
  if (!el) return;
  el.scrollIntoView();
  el.dispatchEvent({ type: 'mousedown' });
  el.dispatchEvent({ type: 'mouseup' });
  el.click();
}

triggerFullClick(found8B);
assert(found8B.events.includes('mousedown'));
assert(found8B.events.includes('mouseup'));
assert(found8B.events.includes('click'));
console.log('✅ Sự kiện click mô phỏng chuột thực tế thành công trên:', found8B.id, found8B.events);

console.log('\n======================================================');
console.log('🎉 TẤT CẢ CÁC BÀI TEST XPATH & NÚT CƯỢC ĐỀU ĐẠT 100%!');
console.log('======================================================');

setTimeout(() => {
  process.exit(0);
}, 100);
