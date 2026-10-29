/**
 * Unit Test: AI Selective Decision Gating System
 * Kiểm thử toàn diện 4 Điều Kiện Chọn Lọc Nâng Cấp:
 * 1. Điều kiện 1: Đủ dữ liệu (Min Observation Support)
 * 2. Điều kiện 2: Đồng thuận mô hình & Biên an toàn (Consensus & Safe Margin >= 58%)
 * 3. Điều kiện 3: Kiểm tra hiệu suất gần đây (Rolling Window & Dynamic Paper Trading)
 * 4. Điều kiện 4: Kiểm soát rủi ro & Tính chuẩn Net EV sau 5% phế Banker
 */

const assert = require('assert');
const fs = require('fs');

console.log('=== BẮT ĐẦU KIỂM THỬ HỆ THỐNG CHỌN LỌC DỰ ĐOÁN AI (SELECTIVE GATING) ===\n');

const mockWindow = {
  localStorage: {
    data: {},
    getItem(k) { return this.data[k] || null; },
    setItem(k, v) { this.data[k] = String(v); }
  }
};
global.localStorage = mockWindow.localStorage;
global.window = mockWindow;

const code = fs.readFileSync('D:/tool game/tool wm/wmautofull/ai-engine.js', 'utf-8');
new Function('window', code)(mockWindow);
const WMBaccaratAIEngine = mockWindow.WMBaccaratAIEngine;

async function runGatingTests() {
  const engine = new WMBaccaratAIEngine();
  await engine.isReadyPromise;

  // --------------------------------------------------------------------------
  // TEST 1: ĐIỀU KIỆN 1 — ĐỦ DỮ LIỆU QUAN SÁT TỐI THIỂU
  // --------------------------------------------------------------------------
  console.log('--- TEST 1: ĐIỀU KIỆN 1 — MẪU CHƯA ĐỦ QUAN SÁT TỐI THIỂU (MIN SUPPORT) ---');
  // Tạo một chuỗi N-gram hoàn toàn mới chưa từng gặp trong lịch sử: 'P', 'B', 'P', 'B', 'P', 'B'
  const rareHistory = ['P', 'B', 'P', 'B', 'P', 'B'];
  // Huấn luyện chỉ 2 lần (dưới minSupport = 8)
  engine.onRoundCompleted('test_tbl_min_1', 'Baccarat Test', rareHistory, 'P');
  engine.onRoundCompleted('test_tbl_min_2', 'Baccarat Test', rareHistory, 'P');

  // Yêu cầu dự đoán trên chuỗi hiếm này
  const pred1 = engine.generatePrediction('test_tbl_min_3', 'Baccarat Test', rareHistory);
  console.log(`Kết quả dự đoán mẫu mới (N=2 < 8): ${pred1.predicted} | Lý do: "${pred1.rationale}"`);
  assert.strictEqual(pred1.predicted, 'PASS', 'Mẫu chỉ xuất hiện 2 lần bắt buộc AI phải PASS!');
  assert.strictEqual(pred1.shouldBet, false, 'Tuyệt đối không được phép cược khi chưa đủ mẫu!');
  console.log('✅ TEST 1 ĐẠT: Mẫu quan sát ít (< minSupport) bị từ chối 100%, AI chủ động PASS.\n');

  // --------------------------------------------------------------------------
  // TEST 2: ĐIỀU KIỆN 2 — ĐỒNG THUẬN MÔ HÌNH & CHỐNG XUNG ĐỘT (CONSENSUS & MARGIN)
  // --------------------------------------------------------------------------
  console.log('--- TEST 2: ĐIỀU KIỆN 2 — ĐỒNG THUẬN MÔ HÌNH & CHỐNG XUNG ĐỘT ---');

  // Test 2A: Giả lập 2 mô hình xung đột nhau (Markov = B, Streak = P)
  console.log('Test 2A: Kiểm tra xung đột mô hình (Markov=B vs Streak=P)...');
  const conflictingPredictions = {
    markov: {
      model: 'Markov',
      predicted: 'B',
      probB: 0.62,
      probP: 0.38,
      confidence: 0.24,
      support: 12,
      rationale: 'Chuỗi ủng hộ Banker 62%'
    },
    streak: {
      model: 'Streak',
      predicted: 'P',
      probB: 0.35,
      probP: 0.65,
      confidence: 0.30,
      support: 10,
      rationale: 'Bệt gãy sang Player 65%'
    }
  };

  const conflictResult = engine.ensemble.combine(conflictingPredictions);
  console.log(`Kết quả khi mô hình xung đột: ${conflictResult.predicted} | Lý do: "${conflictResult.rationale}"`);
  assert.strictEqual(conflictResult.predicted, 'PASS', 'Khi các mô hình xung đột, AI bắt buộc phải PASS!');
  assert.strictEqual(conflictResult.gateReason, 'MODEL_CONFLICT', 'Lý do phải là MODEL_CONFLICT');
  console.log('✅ Test 2A ĐẠT: Xung đột mô hình được phát hiện và từ chối cược 100%!');

  // Test 2B: Kiểm tra biên lợi thế mỏng (< 58%)
  console.log('\nTest 2B: Kiểm tra biên an toàn mỏng (Xác suất 53% < 58%)...');
  const thinMarginPredictions = {
    markov: {
      model: 'Markov',
      key: 'markov',
      predicted: 'B',
      probB: 0.53,
      probP: 0.47,
      confidence: 0.06,
      support: 16,
      rationale: 'Chuỗi ủng hộ Banker 53%'
    },
    streak: {
      model: 'Streak',
      key: 'streak',
      predicted: 'B',
      probB: 0.53,
      probP: 0.47,
      confidence: 0.06,
      support: 12,
      rationale: 'Bệt ủng hộ Banker 53%'
    }
  };
  const thinResult = engine.ensemble.combine(thinMarginPredictions);
  console.log(`Kết quả khi biên lợi thế mỏng: ${thinResult.predicted} | Lý do: "${thinResult.rationale}"`);
  assert.strictEqual(thinResult.predicted, 'PASS', 'Biên an toàn dưới 58% phải PASS!');
  assert.strictEqual(thinResult.gateReason, 'MARGIN_TOO_THIN');
  console.log('✅ Test 2B ĐẠT: Biên an toàn mỏng (< 58%) bị loại bỏ để tránh phế nhà cái!');

  // Test 2C: Kiểm tra đồng thuận mạnh (Cả Markov và Streak cùng chọn B với P >= 58%)
  console.log('\nTest 2C: Kiểm tra đồng thuận mạnh (Markov=B và Streak=B)...');
  const consensusPredictions = {
    markov: {
      model: 'Markov',
      key: 'markov',
      predicted: 'B',
      probB: 0.64,
      probP: 0.36,
      confidence: 0.28,
      support: 15,
      rationale: 'Chuỗi ủng hộ Banker 64%'
    },
    streak: {
      model: 'Streak',
      key: 'streak',
      predicted: 'B',
      probB: 0.61,
      probP: 0.39,
      confidence: 0.22,
      support: 12,
      rationale: 'Nhịp bệt đi tiếp Banker 61%'
    }
  };
  const consensusResult = engine.ensemble.combine(consensusPredictions);
  console.log(`Kết quả khi đồng thuận: ${consensusResult.predicted} | Lý do: "${consensusResult.rationale}"`);
  assert.strictEqual(consensusResult.predicted, 'B', 'Khi các mô hình đồng thuận vượt ngưỡng an toàn, phải chấp thuận B!');
  assert.strictEqual(consensusResult.gatePassed, true);
  console.log('✅ Test 2C ĐẠT: Đồng thuận đa mô hình được phê duyệt thành công!\n');

  // --------------------------------------------------------------------------
  // TEST 3: ĐIỀU KIỆN 3 — THEO DÕI HIỆU SUẤT GẦN ĐÂY & DYNAMIC PAPER TRADING
  // --------------------------------------------------------------------------
  console.log('--- TEST 3: ĐIỀU KIỆN 3 — HIỆU SUẤT GẦN ĐÂY & DYNAMIC PAPER TRADING ---');
  // Chuyển sang chế độ REAL
  engine.setTradingMode('REAL');
  assert.strictEqual(engine.tradingMode, 'REAL');

  // Giả lập 4 ván thua liên tiếp trong sổ dự đoán
  for (let i = 1; i <= 4; i++) {
    const tbl = `test_loss_${i}`;
    engine.pendingPredictions.set(tbl, {
      id: `pred_loss_${i}`,
      tableId: tbl,
      predicted: 'B',
      status: 'PENDING'
    });
    // Kết quả thật ra 'P' -> Thua
    engine.onRoundCompleted(tbl, 'Table Loss', ['P', 'P', 'P', 'P'], 'P');
  }

  console.log(`Chuỗi thua hiện tại: ${engine.currentLossStreak} ván`);
  assert(engine.currentLossStreak >= 3, 'Chuỗi thua >= 3');

  // Giả lập 1 dự đoán mạnh 'B'
  engine.markov.predict = () => ({
    model: 'Markov', key: 'markov', predicted: 'B', probB: 0.70, probP: 0.30, confidence: 0.40, support: 20, rationale: 'Test mạnh'
  });
  engine.streak.predict = () => ({
    model: 'Streak', key: 'streak', predicted: 'B', probB: 0.65, probP: 0.35, confidence: 0.30, support: 15, rationale: 'Test mạnh'
  });

  // Test 3A: Người dùng chọn CƯỢC THẬT (REAL) -> Bắt buộc cược thật 100%, không bị hạ Paper dù chuỗi thua
  engine.setTradingMode('REAL');
  const realPred = engine.generatePrediction('test_guarded_tbl', 'Table Guard', ['P', 'P', 'P', 'P']);
  console.log(`Dự đoán sinh ra: ${realPred.predicted}`);
  console.log(`Cho phép cược thật (shouldBet): ${realPred.shouldBet}`);
  console.log(`Chế độ Paper Trading: ${realPred.isPaperTrading}`);
  assert.strictEqual(realPred.shouldBet, true, 'Khi người dùng chọn REAL, AI luôn cược thật 100%, không bị hạ Paper!');
  assert.strictEqual(realPred.isPaperTrading, false);

  // Test 3B: Người dùng chọn PAPER TRADING -> Mô phỏng an toàn
  engine.setTradingMode('PAPER');
  const paperPred = engine.generatePrediction('test_guarded_tbl', 'Table Guard', ['P', 'P', 'P', 'P']);
  assert.strictEqual(paperPred.shouldBet, false, 'Khi người dùng chọn PAPER, AI cược mô phỏng!');
  assert.strictEqual(paperPred.isPaperTrading, true);
  console.log('✅ TEST 3 ĐẠT: Đã loại bỏ hoàn toàn cơ chế tự động hạ Paper. Lệnh Cược thật (Real Bet) luôn được thực thi 100%!\n');

  // --------------------------------------------------------------------------
  // TEST 4: ĐIỀU KIỆN 4 — CHẤM ĐIỂM BACCARAT CHUẨN (NET EV TRỪ 5% PHẾ BANKER)
  // --------------------------------------------------------------------------
  console.log('--- TEST 4: ĐIỀU KIỆN 4 — LỢI NHUẬN RÒNG SAU 5% PHẾ BANKER (NET UNITS & EV) ---');
  const initialNet = engine.stats.netUnitsWon || 0;

  // Thắng 1 ván Banker: phải được +0.95 unit
  engine.pendingPredictions.set('tbl_banker_win', {
    id: 'pred_b_win',
    tableId: 'tbl_banker_win',
    predicted: 'B',
    status: 'PENDING'
  });
  engine.onRoundCompleted('tbl_banker_win', 'Table Win B', ['B', 'B', 'B', 'B'], 'B');
  const netAfterBanker = engine.stats.netUnitsWon;
  const bankerProfit = Number((netAfterBanker - initialNet).toFixed(2));
  console.log(`Lợi nhuận ván Banker thắng: +${bankerProfit} unit (Đã trừ 5% hoa hồng)`);
  assert.strictEqual(bankerProfit, 0.95, 'Banker thắng phải được cộng chính xác +0.95 unit!');

  // Thắng 1 ván Player: phải được +1.00 unit
  engine.pendingPredictions.set('tbl_player_win', {
    id: 'pred_p_win',
    tableId: 'tbl_player_win',
    predicted: 'P',
    status: 'PENDING'
  });
  engine.onRoundCompleted('tbl_player_win', 'Table Win P', ['P', 'P', 'P', 'P'], 'P');
  const netAfterPlayer = engine.stats.netUnitsWon;
  const playerProfit = Number((netAfterPlayer - netAfterBanker).toFixed(2));
  console.log(`Lợi nhuận ván Player thắng: +${playerProfit} unit (Tỷ lệ 1:1)`);
  assert.strictEqual(playerProfit, 1.00, 'Player thắng phải được cộng chính xác +1.00 unit!');

  // Thua 1 ván: phải bị trừ -1.00 unit
  engine.pendingPredictions.set('tbl_loss', {
    id: 'pred_loss',
    tableId: 'tbl_loss',
    predicted: 'B',
    status: 'PENDING'
  });
  engine.onRoundCompleted('tbl_loss', 'Table Loss', ['P', 'P', 'P', 'P'], 'P');
  const netAfterLoss = engine.stats.netUnitsWon;
  const lossProfit = Number((netAfterLoss - netAfterPlayer).toFixed(2));
  console.log(`Lợi nhuận ván thua: ${lossProfit} unit`);
  assert.strictEqual(lossProfit, -1.00, 'Thua phải bị trừ chính xác -1.00 unit!');

  // Ván Hòa (Tie): phải hoàn vốn (0.00)
  engine.pendingPredictions.set('tbl_tie', {
    id: 'pred_tie',
    tableId: 'tbl_tie',
    predicted: 'B',
    status: 'PENDING'
  });
  engine.onRoundCompleted('tbl_tie', 'Table Tie', ['P', 'P', 'P', 'P'], 'T');
  const netAfterTie = engine.stats.netUnitsWon;
  assert.strictEqual(netAfterTie, netAfterLoss, 'Ván Hòa (Tie) phải hoàn tiền 0 unit!');
  console.log('✅ Ván Hòa (Tie) hoàn vốn nguyên vẹn: +0.00 unit');

  console.log(`EV kỳ vọng trên mỗi ván: ${engine.stats.expectedValue} unit/bet`);
  console.log('✅ TEST 4 ĐẠT: Chấm điểm Baccarat và tính toán Net EV sau phí hoa hồng 100% chuẩn xác!\n');

  console.log('================================================================');
  console.log('🎉 TẤT CẢ CÁC BÀI KIỂM THỬ 4 ĐIỀU KIỆN CHỌN LỌC ĐỀU ĐẠT 100%!');
  console.log('================================================================');

  setTimeout(() => process.exit(0), 100);
}

runGatingTests().catch(err => {
  console.error('Lỗi kiểm thử:', err);
  setTimeout(() => process.exit(1), 100);
});
