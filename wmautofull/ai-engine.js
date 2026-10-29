/**
 * WM Casino Baccarat Online Adaptive Multi-Model AI Engine
 * 
 * Kiến trúc:
 * 1. Thu thập & chuẩn hóa dữ liệu ván (B / P / T)
 * 2. Bộ nhớ 3 tầng (Short-term, Session, Long-term IndexedDB)
 * 3. 5 Bộ học song song (Markov N-gram, Streak/Alternation, Context Pattern, Table Dynamics, Model Reliability)
 * 4. Ensemble tự động điều chỉnh trọng số theo hiệu suất thực tế (Exponential Decay + Laplace Smoothing)
 * 5. Cơ chế giải thích quyết định (Explainability: lý do, số mẫu hỗ trợ, xác suất ước lượng)
 * 6. Chốt an toàn Paper Trading (mặc định) chống cược nhầm
 */

(function(window) {
  'use strict';

  // ==========================================================================
  // 1. BỘ NHỚ CỤC BỘ INDEXEDDB (3-TIER PERSISTENT STORAGE)
  // ==========================================================================
  class WMDatabase {
    constructor() {
      this.dbName = 'WM_AI_Baccarat_DB';
      this.version = 1;
      this.db = null;
      this.isReady = false;
      this.initPromise = this.init();
    }

    async init() {
      if (!window.indexedDB) {
        console.warn('[AI DB] Trình duyệt không hỗ trợ IndexedDB, dùng in-memory fallback.');
        return;
      }
      return new Promise((resolve) => {
        const req = indexedDB.open(this.dbName, this.version);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('rounds')) {
            const roundsStore = db.createObjectStore('rounds', { keyPath: 'id' });
            roundsStore.createIndex('tableId', 'tableId', { unique: false });
            roundsStore.createIndex('date', 'date', { unique: false });
            roundsStore.createIndex('sessionId', 'sessionId', { unique: false });
          }
          if (!db.objectStoreNames.contains('predictions')) {
            const predStore = db.createObjectStore('predictions', { keyPath: 'id' });
            predStore.createIndex('tableId', 'tableId', { unique: false });
            predStore.createIndex('status', 'status', { unique: false });
          }
          if (!db.objectStoreNames.contains('knowledge')) {
            db.createObjectStore('knowledge', { keyPath: 'key' });
          }
        };
        req.onsuccess = (e) => {
          this.db = e.target.result;
          this.isReady = true;
          resolve();
        };
        req.onerror = (e) => {
          console.warn('[AI DB] Lỗi khởi tạo IndexedDB:', e.target.error);
          resolve();
        };
      });
    }

    async saveRound(roundData) {
      if (!this.db) return;
      try {
        const tx = this.db.transaction(['rounds'], 'readwrite');
        tx.objectStore('rounds').put(roundData);
      } catch (e) {}
    }

    async savePrediction(predData) {
      if (!this.db) return;
      try {
        const tx = this.db.transaction(['predictions'], 'readwrite');
        tx.objectStore('predictions').put(predData);
      } catch (e) {}
    }

    async getRecentPredictions(limit = 20) {
      if (!this.db) return [];
      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction(['predictions'], 'readonly');
          const store = tx.objectStore('predictions');
          const req = store.getAll();
          req.onsuccess = () => {
            const list = req.result || [];
            list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            resolve(list.slice(0, limit));
          };
          req.onerror = () => resolve([]);
        } catch (e) {
          resolve([]);
        }
      });
    }

    async saveKnowledge(key, value) {
      if (!this.db) return;
      try {
        const tx = this.db.transaction(['knowledge'], 'readwrite');
        tx.objectStore('knowledge').put({ key, value, updated: Date.now() });
      } catch (e) {}
    }

    async loadKnowledge(key) {
      if (!this.db) return null;
      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction(['knowledge'], 'readonly');
          const req = tx.objectStore('knowledge').get(key);
          req.onsuccess = () => resolve(req.result ? req.result.value : null);
          req.onerror = () => resolve(null);
        } catch (e) {
          resolve(null);
        }
      });
    }

    async clearAll() {
      if (!this.db) return;
      try {
        const tx = this.db.transaction(['rounds', 'predictions', 'knowledge'], 'readwrite');
        tx.objectStore('rounds').clear();
        tx.objectStore('predictions').clear();
        tx.objectStore('knowledge').clear();
      } catch (e) {}
    }
  }

  // ==========================================================================
  // 2. CÁC BỘ HỌC TRỰC TUYẾN (ONLINE PARALLEL LEARNERS)
  // ==========================================================================

  /**
   * Bộ học 1: Markov Transition / N-gram Learner
   * Học phân bố xác suất chuyển trạng thái có điều kiện P(X_t | X_{t-1}, ... X_{t-k})
   * Áp dụng Bayesian / Laplace Smoothing: P(B | ctx) = (Count(B) + alpha) / (Count(total) + 2*alpha)
   */
  class MarkovLearner {
    constructor() {
      this.name = 'Mô hình Chuỗi Markov (N-gram)';
      this.ngramCounts = {}; // { 'BPB': { B: 12, P: 5 } }
      this.alpha = 0.5; // Laplace smoothing parameter
      // ĐIỀU KIỆN 1: Tối thiểu 8 mẫu tương tự trong quá khứ mới đủ độ tin cậy thống kê
      this.minSupport = 8;
    }

    trainRound(history, outcome) {
      if (outcome !== 'B' && outcome !== 'P') return;
      // Trích xuất các chuỗi N-gram độ dài từ 1 đến 4
      const bp = history.filter(x => x === 'B' || x === 'P');
      for (let n = 1; n <= 4; n++) {
        if (bp.length >= n) {
          const ctx = bp.slice(-n).join('');
          if (!this.ngramCounts[ctx]) {
            this.ngramCounts[ctx] = { B: 0, P: 0, total: 0 };
          }
          this.ngramCounts[ctx][outcome]++;
          this.ngramCounts[ctx].total++;
        }
      }
    }

    predict(history) {
      const bp = history.filter(x => x === 'B' || x === 'P');
      if (bp.length < 2) return null;

      let bestCandidate = null;

      // Ưu tiên n-gram dài nhất có đủ số mẫu hỗ trợ và đạt độ tự tin (Hierarchical Backoff Model)
      for (let n = 4; n >= 1; n--) {
        if (bp.length >= n) {
          const ctx = bp.slice(-n).join('');
          const stats = this.ngramCounts[ctx];
          if (stats) {
            const total = stats.total || ((stats.B || 0) + (stats.P || 0));
            // ĐIỀU KIỆN 1: Kiểm tra đủ số lượng quan sát tối thiểu
            if (total >= this.minSupport) {
              const probB = ((stats.B || 0) + this.alpha) / (total + 2 * this.alpha);
              const probP = 1 - probB;
              const diff = Math.abs(probB - 0.5);

              // Nếu n-gram này đạt biên an toàn >= 58%: trả về ngay lập tức
              if (probB >= 0.58 || probP >= 0.58) {
                return {
                  model: this.name,
                  order: n,
                  context: ctx,
                  support: total,
                  probB: probB,
                  probP: probP,
                  predicted: probB >= 0.58 ? 'B' : 'P',
                  confidence: diff * 2,
                  isSufficient: true,
                  rationale: `Chuỗi [${ctx}] đã gặp ${total} lần trong quá khứ (${stats.B || 0} lần Banker, ${stats.P || 0} lần Player)`
                };
              } else if (!bestCandidate) {
                // Lưu lại làm ứng viên nếu các n-gram bậc thấp hơn cũng không vượt ngưỡng
                bestCandidate = {
                  model: this.name,
                  order: n,
                  context: ctx,
                  support: total,
                  probB: probB,
                  probP: probP,
                  predicted: 'PASS',
                  confidence: diff * 2,
                  isSufficient: true,
                  rationale: `Chuỗi [${ctx}] đã gặp ${total} lần (${stats.B || 0}B, ${stats.P || 0}P) nhưng xác suất quá sát 50%`
                };
              }
            }
          }
        }
      }
      return bestCandidate;
    }
  }

  /**
   * Bộ học 2: Streak & Alternation Pattern Learner
   * Học quy luật bệt (run dài) và bẻ cầu (đảo 1-1, 2-2)
   */
  class StreakLearner {
    constructor() {
      this.name = 'Mô hình Nhịp Cầu & Bệt (Streak/Chop)';
      this.streakStats = {}; // { 'B_3': { continue: 8, break: 4 } }
      this.pingPongStats = { continue: 0, break: 0 };
      // ĐIỀU KIỆN 1: Tối thiểu 6 mẫu bệt tương tự mới đủ độ tin cậy
      this.minSupport = 6;
    }

    trainRound(history, outcome) {
      if (outcome !== 'B' && outcome !== 'P') return;
      const bp = history.filter(x => x === 'B' || x === 'P');
      if (bp.length < 2) return;

      const last = bp[bp.length - 1];
      let streakLen = 1;
      for (let i = bp.length - 2; i >= 0; i--) {
        if (bp[i] === last) streakLen++;
        else break;
      }

      const key = `${last}_${streakLen}`;
      if (!this.streakStats[key]) {
        this.streakStats[key] = { continue: 0, break: 0 };
      }

      if (outcome === last) {
        this.streakStats[key].continue++;
      } else {
        this.streakStats[key].break++;
      }
    }

    predict(history) {
      const bp = history.filter(x => x === 'B' || x === 'P');
      if (bp.length < 2) return null;

      const current = bp[bp.length - 1];
      let streakLen = 1;
      for (let i = bp.length - 2; i >= 0; i--) {
        if (bp[i] === current) streakLen++;
        else break;
      }

      const key = `${current}_${streakLen}`;
      const stats = this.streakStats[key] || this.streakStats[`streak_${current}_${streakLen}`];
      if (stats) {
        const cont = stats.continue !== undefined ? stats.continue : (stats.continueCount || 0);
        const brk = stats.break !== undefined ? stats.break : (stats.breakCount || 0);
        const total = cont + brk;
        // ĐIỀU KIỆN 1: Kiểm tra đủ số lượng quan sát bệt tối thiểu
        if (total >= this.minSupport) {
          const probContinue = (cont + 0.5) / (total + 1);
          const probBreak = 1 - probContinue;

          const probB = current === 'B' ? probContinue : probBreak;
          const probP = current === 'P' ? probContinue : probBreak;

          let predicted = 'PASS';
          if (probB >= 0.58) predicted = 'B';
          else if (probP >= 0.58) predicted = 'P';

          return {
            model: this.name,
            streakLength: streakLen,
            currentSide: current,
            support: total,
            probB: probB,
            probP: probP,
            predicted: predicted,
            confidence: Math.abs(probContinue - 0.5) * 2,
            isSufficient: true,
            rationale: `Bệt [${current}] dài ${streakLen} ván: lịch sử ${cont}/${total} lần đi tiếp, ${brk}/${total} lần bẻ`
          };
        }
      }
      return null;
    }
  }

  /**
   * Bộ học 3: Table Dynamics & Shoe Balance Learner
   * Học theo bàn riêng biệt, phân bố Banker/Player theo tiến độ bài
   */
  class TableLearner {
    constructor() {
      this.name = 'Mô hình Cân Bằng Bàn (Shoe Dynamics)';
      this.tableShoeStats = {}; // { 'tableId:shoeId': { B, P, T, total } }
      this.minSupport = 15; // Cần ít nhất 15 ván trong shoe bàn
    }

    // FIX 5: Thêm tham số shoeId, key = tableId:shoeId
    trainRound(tableId, shoeId, outcome) {
      // Backward-compat: nếu shoeId không được truyền vào (gọi kiểu cũ)
      if (typeof shoeId === 'string' && (shoeId === 'B' || shoeId === 'P' || shoeId === 'T')) {
        // shoeId thực ra là outcome (gọi kiểu cũ trainRound(tableId, outcome))
        outcome = shoeId;
        shoeId = 1;
      }
      const key = tableId + ':' + (shoeId || 1);
      if (!this.tableShoeStats[key]) {
        this.tableShoeStats[key] = { B: 0, P: 0, T: 0, total: 0 };
      }
      if (outcome === 'B' || outcome === 'P' || outcome === 'T') {
        this.tableShoeStats[key][outcome]++;
        this.tableShoeStats[key].total++;
      }
    }

    // FIX 5: predict theo key = tableId:shoeId
    predict(tableId, shoeId, history) {
      // Backward-compat: nếu shoeId là array (gọi kiểu cũ predict(tableId, history))
      if (Array.isArray(shoeId)) {
        history = shoeId;
        shoeId = 1;
      }
      const key = tableId + ':' + (shoeId || 1);
      const stats = this.tableShoeStats[key];
      if (!stats || stats.total < this.minSupport) return null;

      const nonTie = stats.B + stats.P;
      if (nonTie < 12) return null;

      // Đánh giá độ lệch thế bàn (Bàn đang thiên Banker hay Player)
      const ratioB = stats.B / nonTie;
      const ratioP = stats.P / nonTie;

      let predicted = 'PASS';
      let confidence = 0;
      let probB = ratioB;
      let probP = ratioP;

      // Nếu bàn thiên lệch rõ rệt (>= 60% trên ít nhất 18 ván)
      if (stats.total >= 18) {
        if (ratioB >= 0.60) {
          predicted = 'B';
          confidence = (ratioB - 0.5) * 2;
        } else if (ratioP >= 0.60) {
          predicted = 'P';
          confidence = (ratioP - 0.5) * 2;
        }
      }

      return {
        model: this.name,
        tableId: tableId,
        shoeId: shoeId,
        support: stats.total,
        probB: probB,
        probP: probP,
        predicted: predicted,
        confidence: confidence,
        isSufficient: stats.total >= this.minSupport,
        rationale: `Bàn ${tableId} shoe#${shoeId}: ${stats.B}B - ${stats.P}P - ${stats.T}T (${Math.round(ratioB * 100)}% B)`
      };
    }
  }

  // ==========================================================================
  // 3. BỘ KẾT HỢP MÔ HÌNH VÀ TỰ ĐIỀU CHỈNH TRỌNG SỐ (ENSEMBLE MANAGER)
  // ==========================================================================
  class EnsembleManager {
    constructor() {
      // Trọng số cơ sở ban đầu của các mô hình con
      this.weights = {
        markov: 1.0,
        streak: 1.0,
        table: 0.6
      };
      this.emaFactor = 0.92; // Hệ số suy giảm mũ theo thời gian
      this.modelScores = {
        markov: { correct: 0, total: 0, accuracy: 0.5 },
        streak: { correct: 0, total: 0, accuracy: 0.5 },
        table: { correct: 0, total: 0, accuracy: 0.5 }
      };
    }

    updateModelPerformance(modelKey, wasCorrect) {
      if (!this.modelScores[modelKey]) return;
      const score = this.modelScores[modelKey];
      score.total++;
      if (wasCorrect) score.correct++;
      score.accuracy = score.total > 0 ? (score.correct / score.total) : 0.5;

      // Cập nhật trọng số động EMA: mô hình đúng được tăng trọng số, sai bị giảm trọng số
      const outcomeVal = wasCorrect ? 1.0 : 0.0;
      this.weights[modelKey] = Math.max(0.2, Math.min(2.5, this.weights[modelKey] * this.emaFactor + (1 - this.emaFactor) * (outcomeVal * 1.8)));
    }

    combine(predictions) {
      // ==========================================================================
      // ĐIỀU KIỆN 2: CÁC MÔ HÌNH CÓ ĐỒNG THUẬN & BIÊN AN TOÀN (CONSENSUS & MARGIN)
      // ==========================================================================
      const minConsensusMargin = 0.58; // Xác suất tối thiểu 58% mới đủ an toàn sau khi trừ phế

      const validPredictions = [];
      const activeBets = [];

      for (const [key, pred] of Object.entries(predictions)) {
        if (!pred) continue;
        validPredictions.push({ key, ...pred });
        if (pred.predicted === 'B' || pred.predicted === 'P') {
          activeBets.push({ key, ...pred });
        }
      }

      // Nếu không có mô hình nào đủ điều kiện hoặc tất cả đều PASS
      if (activeBets.length === 0) {
        return {
          predicted: 'PASS',
          probB: 0.5,
          probP: 0.5,
          confidence: 0,
          rationale: 'Chưa đủ dữ liệu quan sát tối thiểu hoặc các mô hình con đều khuyến nghị PASS.',
          contributors: [],
          gatePassed: false,
          gateReason: 'INSUFFICIENT_DATA'
        };
      }

      // 1. KIỂM TRA XUNG ĐỘT (DISCORD / CONFLICT CHECK):
      // Nếu có mô hình bảo Banker và mô hình bảo Player -> XUNG ĐỘT -> BẮT BUỘC PASS!
      const votesB = activeBets.filter(m => m.predicted === 'B');
      const votesP = activeBets.filter(m => m.predicted === 'P');

      if (votesB.length > 0 && votesP.length > 0) {
        const strB = votesB.map(m => `${m.key}=B(${(m.probB * 100).toFixed(0)}%)`).join(', ');
        const strP = votesP.map(m => `${m.key}=P(${(m.probP * 100).toFixed(0)}%)`).join(', ');
        return {
          predicted: 'PASS',
          probB: 0.5,
          probP: 0.5,
          confidence: 0,
          rationale: `Xung đột tín hiệu: [${strB}] đối đầu [${strP}]. AI chủ động bỏ qua để bảo vệ vốn.`,
          contributors: activeBets,
          gatePassed: false,
          gateReason: 'MODEL_CONFLICT'
        };
      }

      // Tất cả mô hình có ý kiến đều cùng chọn 1 hướng ('B' hoặc 'P')
      const unanimousSide = votesB.length > 0 ? 'B' : 'P';

      // 2. KIỂM TRA ĐỘ ĐỒNG THUẬN TỐI THIỂU (CONSENSUS REQUIREMENT):
      // Nếu chỉ có đúng 1 mô hình ra tín hiệu:
      if (activeBets.length === 1) {
        const single = activeBets[0];
        const singleProb = unanimousSide === 'B' ? single.probB : single.probP;
        const singleSupport = single.support || 0;

        // Cần mẫu dày (N >= 15) và xác suất mạnh (>= 62%) khi không có mô hình thứ 2 bảo chứng
        if (singleSupport < 15 || singleProb < 0.62) {
          return {
            predicted: 'PASS',
            probB: single.probB,
            probP: single.probP,
            confidence: single.confidence || 0,
            rationale: `Thiếu đồng thuận: Chỉ có ${single.key} đề xuất (${unanimousSide} ${(singleProb * 100).toFixed(0)}%), mẫu N=${singleSupport} chưa đạt ngưỡng độc lập (cần N>=15 và P>=62%).`,
            contributors: activeBets,
            gatePassed: false,
            gateReason: 'LACK_OF_CONSENSUS'
          };
        }
      }

      // 3. TÍNH XÁC SUẤT BÌNH QUÂN CÓ TRỌNG SỐ VÀ KIỂM TRA BIÊN LỢI THẾ (MARGIN CHECK)
      let totalWeight = 0;
      let weightedB = 0;
      let weightedP = 0;

      for (const pred of activeBets) {
        const w = (this.weights[pred.key] || 1.0) * (pred.confidence || 0.5);
        totalWeight += w;
        weightedB += pred.probB * w;
        weightedP += pred.probP * w;
      }

      const finalProbB = weightedB / totalWeight;
      const finalProbP = weightedP / totalWeight;
      const chosenProb = unanimousSide === 'B' ? finalProbB : finalProbP;

      // Kiểm tra biên an toàn tối thiểu (tối thiểu 58%)
      if (chosenProb < minConsensusMargin) {
        return {
          predicted: 'PASS',
          probB: finalProbB,
          probP: finalProbP,
          confidence: Math.abs(chosenProb - 0.5) * 2,
          rationale: `Biên an toàn quá mỏng: Xác suất ${unanimousSide} đạt ${(chosenProb * 100).toFixed(1)}% < ${Math.round(minConsensusMargin * 100)}% (chưa đủ bù phí nhà cái).`,
          contributors: activeBets,
          gatePassed: false,
          gateReason: 'MARGIN_TOO_THIN'
        };
      }

      // Sắp xếp mô hình đóng góp uy tín nhất
      activeBets.sort((a, b) => (b.weight || 0) - (a.weight || 0));
      const topModel = activeBets[0];
      const consensusNames = activeBets.map(m => m.key).join(' + ');

      // FIX 7: Tìm topModelName từ model có weight lớn nhất (trong các model không phải PASS)
      let bestWeightKey = null;
      let bestWeightVal = -1;
      for (const pred of activeBets) {
        const w = this.weights[pred.key] || 1.0;
        if (w > bestWeightVal) {
          bestWeightVal = w;
          bestWeightKey = pred;
        }
      }

      return {
        predicted: unanimousSide,
        probB: finalProbB,
        probP: finalProbP,
        // FIX 7: tách predictedProbability và confidenceScore
        predictedProbability: chosenProb,
        confidenceScore: Math.abs(chosenProb - 0.5) * 2,
        confidence: Math.min(1.0, (chosenProb - 0.5) * 2.5), // giữ nguyên để không break UI
        rationale: `[Đồng thuận ${consensusNames}] ${topModel ? topModel.rationale : ''} (Xác suất ${(chosenProb * 100).toFixed(1)}%)`,
        contributors: activeBets,
        topModelName: bestWeightKey ? bestWeightKey.model : 'Đồng thuận đa mô hình',
        gatePassed: true,
        gateReason: 'APPROVED'
      };
    }
  }

  // ==========================================================================
  // 4. BỘ ĐIỀU PHỐI CHÍNH (AI ENGINE ORCHESTRATOR)
  // ==========================================================================
  class WMBaccaratAIEngine {
    constructor() {
      this.db = new WMDatabase();
      this.markov = new MarkovLearner();
      this.streak = new StreakLearner();
      this.tableLearner = new TableLearner();
      this.ensemble = new EnsembleManager();

      // Sổ dự đoán đang chờ kết quả: { 'tableId': { id, predicted, probB, probP, timestamp, ... } }
      this.pendingPredictions = new Map();

      // Thống kê phiên học trực tiếp
      this.stats = {
        totalRoundsObserved: 0,
        predictionsScored: 0,
        wins: 0,
        losses: 0,
        tiesPush: 0,
        accuracy: 0,
        baselineAccuracy: 0.50, // Mức cơ sở ngẫu nhiên (Baseline 50.0%)
        edgeOverBaseline: 0,    // Độ vượt trội so với mức cơ sở (Alpha/Edge)
        patternsLearnedCount: 0,
        netUnitsWon: 0,         // Lợi nhuận ròng sau khi trừ 5% hoa hồng Banker
        expectedValue: 0,       // EV kỳ vọng trung bình mỗi ván cược
        totalPassCount: 0,      // Số ván AI đã chủ động bỏ qua an toàn (PASS)
        rollingAccuracy: 0.50,  // Độ chính xác trên 20 ván gần nhất
        currentLossStreak: 0,   // Chuỗi thua liên tiếp hiện tại
        maxLossStreak: 0,       // Chuỗi thua kỷ lục trong phiên
        riskGuardStatus: 'NORMAL' // 'NORMAL' | 'UNDERPERFORMING' | 'STOP_LOSS'
      };

      // ĐIỀU KIỆN 3: Cửa sổ trượt theo dõi hiệu suất gần đây (Rolling Window 20 ván)
      this.rollingWindow = [];
      this.rollingWindowSize = 20;
      this.currentLossStreak = 0;
      this.maxLossStreak = 0;
      this.netUnitsWon = 0;
      this.totalPassCount = 0;
      this.isUnderperforming = false;
      this.underperformReason = '';

      // Bộ lọc chống học trùng ván đa luồng (Round Deduplication Cache)
      this.processedRounds = new Set();

      // FIX 4: Shoe ID tracking để phát hiện shoe reset theo từng bàn
      this.tableShoeIds = {};           // { tableId: shoeId (int, bắt đầu từ 1) }
      this.tablePrevHistoryLen = {};    // { tableId: số ván ở lần scan trước }

      // FIX 7: Chống đếm PASS trùng theo opportunity
      this.countedOpportunities = new Set();

      // FIX 6: Trạng thái não AI ('EMPTY' | 'TRAINED')
      this.brainState = 'EMPTY';

      // Chế độ cược an toàn: 'PAPER' (Mặc định - chỉ mô phỏng & học) hoặc 'REAL' (cược tiền thật)
      this.tradingMode = localStorage.getItem('wm_ai_trading_mode') || 'PAPER';
      this.sessionId = 'session_' + Date.now();
      this.onStatsChange = null;

      // Trạng thái kết nối Local Sync Bridge (tự động lưu vào file ai_brain.json)
      this.bridgeConnected = false;

      this.isReadyPromise = this.loadSavedState();
    }

    // FIX 4: Phát hiện shoe reset theo từng bàn
    detectShoeReset(tableId, historyLength) {
      const prev = this.tablePrevHistoryLen[tableId];
      if (prev !== undefined && historyLength < prev) {
        // Lịch sử bị reset => shoe mới
        this.tableShoeIds[tableId] = (this.tableShoeIds[tableId] || 1) + 1;
        console.log(`[AI Engine] Shoe reset bàn ${tableId}: shoe #${this.tableShoeIds[tableId]}`);
      }
      if (!this.tableShoeIds[tableId]) {
        this.tableShoeIds[tableId] = 1;
      }
      this.tablePrevHistoryLen[tableId] = historyLength;
      return this.tableShoeIds[tableId];
    }

    async loadSavedState() {
      await this.db.initPromise;

      let brainData = null;
      let bridgeConnected = false;

      // 1. Nạp trực tiếp qua Background Service Worker (Không bị Mixed Content chặn)
      try {
        const bgRes = await new Promise((resolve) => {
          if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({ action: 'AI_FETCH_BRAIN' }, res => {
              if (chrome.runtime.lastError) resolve(null);
              else resolve(res);
            });
          } else {
            resolve(null);
          }
        });

        if (bgRes && bgRes.success && bgRes.data) {
          brainData = bgRes.data;
          bridgeConnected = !!bgRes.bridgeConnected;
        }
      } catch (e) {}

      // Fallback khi chạy ngoài môi trường Extension (ví dụ test NodeJS)
      if (!brainData) {
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
            const fileData = await resp.json();
            if (fileData && fileData.weights) {
              brainData = fileData;
              bridgeConnected = true;
            }
          }
        } catch (err) {}
      }

      // Đọc dữ liệu IndexedDB hiện tại
      let savedKnowledge = null;
      let savedStats = null;
      try {
        savedKnowledge = await this.db.loadKnowledge('ai_engine_weights');
        savedStats = await this.db.loadKnowledge('ai_engine_stats');
      } catch (e) {}

      const fileRounds = (brainData && brainData.stats) ? (brainData.stats.totalRoundsObserved || 0) : 0;
      const idbRounds = (savedStats && savedStats.totalRoundsObserved) ? savedStats.totalRoundsObserved : 0;

      // Nếu file não có dữ liệu (hoặc IndexedDB rỗng / ít hơn file)
      if (brainData && (fileRounds >= idbRounds || idbRounds === 0)) {
        this.applyKnowledge(brainData);
        this.bridgeConnected = bridgeConnected;
        this.brainState = 'TRAINED'; // FIX 6
        console.log(`[AI Engine] Đã nạp trực tiếp bộ não AI thành công! (${fileRounds} ván | ${this.stats.patternsLearnedCount} mẫu)`);
        await this.persistKnowledge();
      } else if (savedKnowledge) {
        if (savedKnowledge.weights) this.ensemble.weights = savedKnowledge.weights;
        if (savedKnowledge.markovCounts) this.markov.ngramCounts = savedKnowledge.markovCounts;
        if (savedKnowledge.streakStats) this.streak.streakStats = savedKnowledge.streakStats;
        if (savedKnowledge.tableShoeStats) this.tableLearner.tableShoeStats = savedKnowledge.tableShoeStats;
        if (savedStats) this.stats = Object.assign(this.stats, savedStats);
        this.bridgeConnected = bridgeConnected;
        this.brainState = 'TRAINED'; // FIX 6
      } else if (brainData) {
        this.applyKnowledge(brainData);
        this.bridgeConnected = bridgeConnected;
        await this.persistKnowledge();
      } else {
        this.loadPretrainedBaseline();
      }

      this.notifyStats();
    }

    loadPretrainedBaseline() {
      /* DISABLED: baseline_giả
      this.markov.ngramCounts = {
        'B': { B: 18, P: 17, T: 4, total: 35 },
        'P': { B: 17, P: 18, T: 4, total: 35 },
        'BB': { B: 15, P: 7, T: 2, total: 22 },
        'PP': { B: 7, P: 15, T: 2, total: 22 },
        'BP': { B: 15, P: 5, T: 2, total: 20 },
        'PB': { B: 5, P: 15, T: 2, total: 20 },
        'BBB': { B: 5, P: 13, T: 1, total: 18 },
        'PPP': { B: 13, P: 5, T: 1, total: 18 },
        'BPB': { B: 4, P: 12, T: 1, total: 16 },
        'PBP': { B: 12, P: 4, T: 1, total: 16 }
      };
      this.streak.streakStats = {
        'B_2': { continue: 14, break: 6 },
        'P_2': { continue: 14, break: 6 },
        'B_3': { continue: 5, break: 14 },
        'P_3': { continue: 5, break: 14 }
      };
      */
      // Intentionally empty: Do not seed fake data.
      // AI learns exclusively from real observed rounds.
      this.brainState = 'EMPTY';
      console.log('[AI Engine] Khởi tạo sạch — chờ thu thập dữ liệu thực tế.');
    }

    exportKnowledge() {
      return {
        version: 2,
        exportedAt: new Date().toISOString(),
        brainState: this.brainState,        // FIX 6: expose cho UI
        weights: this.ensemble.weights,
        markovCounts: this.markov.ngramCounts,
        streakStats: this.streak.streakStats,
        tableShoeStats: this.tableLearner.tableShoeStats,
        tableShoeIds: this.tableShoeIds,    // FIX 4: persist shoe IDs
        rollingWindow: this.rollingWindow.slice(-20),
        observedRoundIds: Array.from(this.processedRounds).slice(-5000), // FIX 4: persist (max 5000)
        stats: {
          totalRoundsObserved: this.stats.totalRoundsObserved || 0,
          predictionsScored: this.stats.predictionsScored || 0,
          wins: this.stats.wins || 0,
          losses: this.stats.losses || 0,
          tiesPush: this.stats.tiesPush || 0,
          accuracy: this.stats.accuracy || 0,
          baselineAccuracy: this.stats.baselineAccuracy || 0.50,
          edgeOverBaseline: this.stats.edgeOverBaseline || 0,
          patternsLearnedCount: Object.keys(this.markov.ngramCounts).length + Object.keys(this.streak.streakStats).length,
          netUnitsWon: this.stats.netUnitsWon || 0,
          expectedValue: this.stats.expectedValue || 0,
          totalPassCount: this.stats.totalPassCount || 0,
          rollingAccuracy: this.stats.rollingAccuracy || 0.50,
          currentLossStreak: this.stats.currentLossStreak || 0,
          maxLossStreak: this.stats.maxLossStreak || 0,
          riskGuardStatus: this.isUnderperforming ? 'UNDERPERFORMING' : 'NORMAL'
        }
      };
    }

    applyKnowledge(data) {
      if (!data || typeof data !== 'object') return false;
      if (data.weights) this.ensemble.weights = Object.assign(this.ensemble.weights, data.weights);
      if (data.markovCounts) this.markov.ngramCounts = Object.assign(this.markov.ngramCounts, data.markovCounts);
      if (data.streakStats) this.streak.streakStats = Object.assign(this.streak.streakStats, data.streakStats);
      if (data.tableShoeStats) this.tableLearner.tableShoeStats = Object.assign(this.tableLearner.tableShoeStats, data.tableShoeStats);
      if (data.rollingWindow && Array.isArray(data.rollingWindow)) {
        this.rollingWindow = data.rollingWindow.slice(-20);
      }
      // FIX 4: restore shoe IDs và processed rounds
      if (data.tableShoeIds && typeof data.tableShoeIds === 'object') {
        this.tableShoeIds = Object.assign(this.tableShoeIds, data.tableShoeIds);
      }
      if (data.observedRoundIds && Array.isArray(data.observedRoundIds)) {
        data.observedRoundIds.slice(-5000).forEach(k => this.processedRounds.add(k));
      }
      if (data.stats) {
        this.stats = Object.assign(this.stats, data.stats);
        this.netUnitsWon = this.stats.netUnitsWon || 0;
        this.totalPassCount = this.stats.totalPassCount || 0;
        this.currentLossStreak = this.stats.currentLossStreak || 0;
        this.maxLossStreak = this.stats.maxLossStreak || 0;
        if (this.stats.riskGuardStatus === 'UNDERPERFORMING') {
          this.isUnderperforming = true;
          this.underperformReason = 'Khôi phục từ phiên trước: Hiệu suất gần đây yếu';
        }
      }
      // FIX 6: đánh dấu não đã được nạp dữ liệu thật
      const hasRealData = (this.stats.totalRoundsObserved || 0) > 0
        || Object.keys(this.markov.ngramCounts).length > 0;
      if (hasRealData) this.brainState = 'TRAINED';
      this.notifyStats();
      return true;
    }

    async importKnowledge(data) {
      if (!data || typeof data !== 'object') return false;
      if (this.isReadyPromise) {
        await this.isReadyPromise;
      }
      this.applyKnowledge(data);
      await this.persistKnowledge();
      return true;
    }

    async persistKnowledge() {
      const payload = {
        version: 2,
        weights: this.ensemble.weights,
        markovCounts: this.markov.ngramCounts,
        streakStats: this.streak.streakStats,
        tableShoeStats: this.tableLearner.tableShoeStats,
        rollingWindow: this.rollingWindow.slice(-20),
        stats: this.stats,
        updatedAt: new Date().toISOString()
      };

      try {
        await this.db.saveKnowledge('ai_engine_weights', payload);
        await this.db.saveKnowledge('ai_engine_stats', this.stats);
      } catch (e) {}

      // 1. Tự động lưu qua Background Service Worker (Vượt Mixed Content & CORS an toàn)
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ action: 'AI_SAVE_BRAIN', payload }, res => {
            if (res && res.bridgeSaved) {
              this.bridgeConnected = true;
            }
          });
        }
      } catch (e) {}

      // 2. Fallback trực tiếp cho NodeJS test runner
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
          this.bridgeConnected = true;
        }
      } catch (err) {}
    }

    setTradingMode(mode) {
      if (mode === 'PAPER' || mode === 'REAL') {
        this.tradingMode = mode;
        localStorage.setItem('wm_ai_trading_mode', mode);
        this.notifyStats();
      }
    }

    notifyStats() {
      this.stats.patternsLearnedCount = Object.keys(this.markov.ngramCounts).length + Object.keys(this.streak.streakStats).length;
      if (typeof this.onStatsChange === 'function') {
        this.onStatsChange(this.stats, this.tradingMode, this.bridgeConnected);
      }
    }

    /**
     * VÒNG HỌC 1: ĐỐI CHIẾU KẾT QUẢ VÁN MỚI (POST-ROUND VERIFICATION & ONLINE LEARNING)
     * Khi bàn cập nhật lịch sử mới, kiểm tra ván vừa ra, chấm điểm dự đoán cũ và học trực tiếp.
     */
    onRoundCompleted(tableId, tableName, previousHistory, newOutcome) {
      if (!newOutcome) return;

      // FIX 4: Phát hiện shoe reset và lấy shoeId ổn định
      const histLen = previousHistory ? previousHistory.length : 0;
      const shoeId = this.detectShoeReset(tableId, histLen);

      // 1. CHỐNG HỌC TRÙNG (Round Deduplication Filter) — FIX 4: dùng shoeId trong roundKey
      const prevSig = (previousHistory && previousHistory.length > 0) ? previousHistory.slice(-6).join('') : 'init';
      const roundKey = `${tableId}:shoe${shoeId}:r${histLen}:${newOutcome}`;
      if (this.processedRounds.has(roundKey)) {
        return; // Đã xử lý ván này rồi -> bỏ qua ngay lập tức, tuyệt đối không học trùng
      }
      this.processedRounds.add(roundKey);
      if (this.processedRounds.size > 5000) {
        const oldest = Array.from(this.processedRounds).slice(0, 500);
        oldest.forEach(k => this.processedRounds.delete(k));
      }

      this.stats.totalRoundsObserved++;

      // 2. KIỂM THỬ KHẢ NĂNG DỰ ĐOÁN NGOÀI MẪU & CHẤM ĐIỂM BACCARAT (NET PROFIT & EV):
      // Đánh giá dự đoán đã lưu TRƯỚC KHI cho các mô hình học kết quả ván mới này
      const pending = this.pendingPredictions.get(tableId);
      if (pending && pending.status === 'PENDING') {
        this.pendingPredictions.delete(tableId);

        let resultStatus = 'LOSS';
        let roundUnitProfit = 0;

        if (newOutcome === 'T') {
          // Baccarat TIE: Hoàn vốn, không tính là thắng hay thua
          resultStatus = 'TIE_PUSH';
          roundUnitProfit = 0;
          this.stats.tiesPush++;
        } else if (pending.predicted === newOutcome) {
          resultStatus = 'WIN';
          this.stats.wins++;
          this.currentLossStreak = 0; // Đứt chuỗi thua
          // Tỷ lệ trả thưởng chuẩn Baccarat: Banker ăn 1:0.95 (trừ 5% hoa hồng), Player ăn 1:1
          roundUnitProfit = (newOutcome === 'B') ? 0.95 : 1.00;
        } else if (pending.predicted !== 'PASS') {
          resultStatus = 'LOSS';
          this.stats.losses++;
          this.currentLossStreak++;
          if (this.currentLossStreak > this.maxLossStreak) {
            this.maxLossStreak = this.currentLossStreak;
          }
          roundUnitProfit = -1.00;
        }

        if (pending.predicted !== 'PASS' && newOutcome !== 'T') {
          this.stats.predictionsScored++;
          const scoredCount = this.stats.wins + this.stats.losses;
          this.stats.accuracy = scoredCount > 0 ? (this.stats.wins / scoredCount) : 0;
          this.stats.baselineAccuracy = 0.50;
          this.stats.edgeOverBaseline = this.stats.accuracy - this.stats.baselineAccuracy;

          // Cập nhật lợi nhuận ròng có tính phí hoa hồng 5% của Banker
          this.netUnitsWon += roundUnitProfit;
          this.stats.netUnitsWon = Number(this.netUnitsWon.toFixed(2));
          this.stats.expectedValue = Number((this.netUnitsWon / scoredCount).toFixed(3));

          // Ghi nhận vào Rolling Window (20 ván gần nhất)
          this.rollingWindow.push({
            isWin: resultStatus === 'WIN',
            side: pending.predicted,
            outcome: newOutcome,
            profit: roundUnitProfit,
            timestamp: Date.now()
          });
          if (this.rollingWindow.length > this.rollingWindowSize) {
            this.rollingWindow.shift();
          }

          // Tính toán Rolling Metrics
          const winInWindow = this.rollingWindow.filter(r => r.isWin).length;
          const rollingAcc = this.rollingWindow.length > 0 ? (winInWindow / this.rollingWindow.length) : 0.5;
          this.stats.rollingAccuracy = Number(rollingAcc.toFixed(3));
          this.stats.currentLossStreak = this.currentLossStreak;
          this.stats.maxLossStreak = this.maxLossStreak;

          // ĐIỀU KIỆN 3: KIỂM TRA HIỆU SUẤT GẦN ĐÂY
          // Nếu đã có từ 8 ván trong cửa sổ và:
          // 1. Tỷ lệ thắng cửa sổ < 48% (hiệu suất rơi xuống dưới mức nền), HOẶC
          // 2. Chuỗi thua liên tiếp >= 3 ván:
          // -> TỰ ĐỘNG HẠ XUỐNG DYNAMIC PAPER TRADING
          if (this.rollingWindow.length >= 8) {
            if (rollingAcc < 0.48 || this.currentLossStreak >= 3) {
              this.isUnderperforming = true;
              this.underperformReason = `Hiệu suất 20 ván gần nhất sụt giảm (${(rollingAcc * 100).toFixed(0)}%) hoặc chuỗi thua ${this.currentLossStreak} ván`;
              this.stats.riskGuardStatus = 'UNDERPERFORMING';
            } else if (rollingAcc >= 0.55 && this.currentLossStreak === 0) {
              // Hồi phục: Rolling Acc >= 55% và không còn trong chuỗi thua
              this.isUnderperforming = false;
              this.underperformReason = '';
              this.stats.riskGuardStatus = 'NORMAL';
            }
          }
        }

        // Cập nhật trọng số thích ứng cho từng mô hình con (Online Adaptive Weighting)
        if (newOutcome === 'B' || newOutcome === 'P') {
          if (pending.subPredictions) {
            for (const [key, sub] of Object.entries(pending.subPredictions)) {
              if (sub && sub.predicted && sub.predicted !== 'PASS') {
                this.ensemble.updateModelPerformance(key, sub.predicted === newOutcome);
              }
            }
          }
        }

        // Lưu vào sổ dự đoán IndexedDB
        pending.status = resultStatus;
        pending.actualOutcome = newOutcome;
        pending.profit = roundUnitProfit;
        pending.resolvedAt = Date.now();
        this.db.savePrediction(pending);
      }

      // 3. HỌC TRỰC TUYẾN NGAY LẬP TỨC TRÊN DỮ LIỆU VÁN MỚI (SAU KHI ĐÃ ĐỐI CHIẾU NGOÀI MẪU)
      this.markov.trainRound(previousHistory, newOutcome);
      this.streak.trainRound(previousHistory, newOutcome);
      // FIX 5: TableLearner tách theo shoe — key = tableId:shoeId
      this.tableLearner.trainRound(tableId, shoeId, newOutcome);
      // FIX 6: Cập nhật brainState khi đã có dữ liệu thật
      if (this.brainState === 'EMPTY') this.brainState = 'TRAINED';

      // Lưu ván vào DB
      this.db.saveRound({
        id: `${tableId}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        tableId: tableId,
        tableName: tableName,
        outcome: newOutcome,
        timestamp: Date.now(),
        date: new Date().toISOString().split('T')[0],
        sessionId: this.sessionId
      });

      // Tự động lưu kiến thức định kỳ
      if (this.stats.totalRoundsObserved % 2 === 0) {
        this.persistKnowledge();
      }

      this.notifyStats();
    }

    /**
     * VÒNG HỌC 2: TẠO DỰ ĐOÁN CHO VÁN TIẾP THEO (PRE-ROUND PREDICTION)
     * Áp dụng Luồng Quyết Định Mới 4 Điều Kiện Chọn Lọc.
     */
    generatePrediction(tableId, tableName, history) {
      // ĐIỀU KIỆN 1: KIỂM TRA ĐỦ DỮ LIỆU BÀN
      if (!history || history.length < 4) {
        return {
          tableId: tableId,
          tableName: tableName,
          shouldBet: false,
          predicted: 'PASS',
          confidence: 0,
          rationale: 'Chưa đủ dữ liệu ván ban đầu (cần >= 4 ván)',
          tradingMode: this.tradingMode,
          gatePassed: false,
          gateReason: 'INSUFFICIENT_HISTORY'
        };
      }

      // 1. Chạy 3 bộ học song song
      // FIX 4+5: lấy shoeId hiện tại, truyền vào TableLearner
      const currentShoeId = this.tableShoeIds[tableId] || 1;
      const subMarkov = this.markov.predict(history);
      const subStreak = this.streak.predict(history);
      const subTable = this.tableLearner.predict(tableId, currentShoeId, history);

      // 2. ĐIỀU KIỆN 2: ĐÁNH GIÁ ĐỒNG THUẬN & BIÊN AN TOÀN QUA ENSEMBLE GATING
      const combined = this.ensemble.combine({
        markov: subMarkov,
        streak: subStreak,
        table: subTable
      });

      // FIX 7: Chống đếm PASS trùng theo opportunity (tableId:shoeId:historyLen)
      const oppId = `${tableId}:${currentShoeId}:${history.length}`;
      if (!this.countedOpportunities.has(oppId)) {
        this.countedOpportunities.add(oppId);
        if (combined.predicted === 'PASS') {
          this.totalPassCount++;
          this.stats.totalPassCount = this.totalPassCount;
        }
        // Giới hạn size countedOpportunities
        if (this.countedOpportunities.size > 10000) {
          const iter = this.countedOpportunities.values();
          this.countedOpportunities.delete(iter.next().value);
        }
      }

      const predictionRecord = {
        id: `pred_${Date.now()}_${tableId}`,
        tableId: tableId,
        tableName: tableName,
        predicted: combined.predicted,
        probB: combined.probB,
        probP: combined.probP,
        confidence: combined.confidence,
        rationale: combined.rationale,
        topModelName: combined.topModelName,
        gatePassed: combined.gatePassed,
        gateReason: combined.gateReason,
        subPredictions: {
          markov: subMarkov,
          streak: subStreak,
          table: subTable
        },
        status: 'PENDING',
        actualOutcome: null,
        timestamp: Date.now(),
        tradingMode: this.tradingMode,
        sessionId: this.sessionId
      };

      // 3. Ghi vào Sổ dự đoán đang chờ (chỉ ghi nhận khi vượt qua chọn lọc)
      if (combined.predicted !== 'PASS') {
        this.pendingPredictions.set(tableId, predictionRecord);
        this.db.savePrediction(predictionRecord);
      }

      // ĐIỀU KIỆN 3 & 4: KIỂM TRA HIỆU SUẤT GẦN ĐÂY & KIỂM SOÁT RỦI RO
      const isConfident = (combined.predicted === 'B' || combined.predicted === 'P');
      let allowRealExecution = false;
      let paperReason = '';

      if (!isConfident) {
        allowRealExecution = false;
        paperReason = combined.rationale;
      } else if (this.tradingMode !== 'REAL') {
        allowRealExecution = false;
        paperReason = 'Đang ở chế độ Paper Trading (Mô phỏng an toàn)';
      } else if (this.isUnderperforming) {
        // ĐIỀU KIỆN 3: Hiệu suất 20 ván gần đây sụt giảm
        allowRealExecution = false;
        paperReason = `Hạ mức cược: ${this.underperformReason}`;
      } else if (this.currentLossStreak >= 4) {
        // ĐIỀU KIỆN 4: Chạm giới hạn chuỗi thua liên tiếp (Stop-Loss)
        allowRealExecution = false;
        paperReason = `Kích hoạt Stop-Loss: Chuỗi thua chạm mốc ${this.currentLossStreak} ván`;
      } else {
        // VƯỢT QUA TOÀN BỘ 4 ĐIỀU KIỆN: ĐỦ TIÊU CHUẨN CƯỢC THẬT!
        allowRealExecution = true;
      }

      return {
        tableId: tableId,
        tableName: tableName,
        predicted: combined.predicted,
        shouldBet: allowRealExecution,
        isPaperTrading: !allowRealExecution,
        paperTradingReason: paperReason,
        probB: combined.probB,
        probP: combined.probP,
        confidence: combined.confidence,
        rationale: combined.rationale,
        topModelName: combined.topModelName,
        gatePassed: combined.gatePassed,
        gateReason: combined.gateReason,
        predictionRecord: predictionRecord
      };
    }
  }

  // Xuất ra phạm vi toàn cục
  window.WMBaccaratAIEngine = WMBaccaratAIEngine;

})(window);
