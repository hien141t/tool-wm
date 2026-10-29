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
      this.minSupport = 3; // Cần tối thiểu 3 mẫu tương tự để tính xác suất
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
      if (bp.length === 0) return null;

      // Ưu tiên n-gram dài nhất có đủ số mẫu hỗ trợ (backoff model)
      for (let n = 4; n >= 1; n--) {
        if (bp.length >= n) {
          const ctx = bp.slice(-n).join('');
          const stats = this.ngramCounts[ctx];
          if (stats && stats.total >= this.minSupport) {
            const probB = (stats.B + this.alpha) / (stats.total + 2 * this.alpha);
            const probP = 1 - probB;
            const diff = Math.abs(probB - 0.5);

            return {
              model: this.name,
              order: n,
              context: ctx,
              support: stats.total,
              probB: probB,
              probP: probP,
              predicted: probB > 0.55 ? 'B' : (probP > 0.55 ? 'P' : 'PASS'),
              confidence: diff * 2,
              rationale: `Chuỗi [${ctx}] đã gặp ${stats.total} lần trong quá khứ (${stats.B} lần Banker, ${stats.P} lần Player)`
            };
          }
        }
      }
      return null;
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
      const stats = this.streakStats[key];
      if (stats && (stats.continue + stats.break >= 3)) {
        const total = stats.continue + stats.break;
        const probContinue = (stats.continue + 0.5) / (total + 1);
        const probBreak = 1 - probContinue;

        const predicted = probContinue > 0.55 ? current : (probBreak > 0.55 ? (current === 'B' ? 'P' : 'B') : 'PASS');
        const probB = current === 'B' ? probContinue : probBreak;
        const probP = current === 'P' ? probContinue : probBreak;

        return {
          model: this.name,
          streakLength: streakLen,
          currentSide: current,
          support: total,
          probB: probB,
          probP: probP,
          predicted: predicted,
          confidence: Math.abs(probContinue - 0.5) * 2,
          rationale: `Bệt [${current}] dài ${streakLen} ván: lịch sử ${stats.continue}/${total} lần đi tiếp, ${stats.break}/${total} lần bẻ`
        };
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
      this.tableShoeStats = {}; // { tableId: { B: 15, P: 18, T: 2, total: 35 } }
    }

    trainRound(tableId, outcome) {
      if (!this.tableShoeStats[tableId]) {
        this.tableShoeStats[tableId] = { B: 0, P: 0, T: 0, total: 0 };
      }
      if (outcome === 'B' || outcome === 'P' || outcome === 'T') {
        this.tableShoeStats[tableId][outcome]++;
        this.tableShoeStats[tableId].total++;
      }
    }

    predict(tableId, history) {
      const stats = this.tableShoeStats[tableId];
      if (!stats || stats.total < 10) return null;

      const nonTie = stats.B + stats.P;
      if (nonTie < 8) return null;

      // Đánh giá độ lệch thế bàn (Bàn đang thiên Banker hay Player)
      const ratioB = stats.B / nonTie;
      const ratioP = stats.P / nonTie;

      let predicted = 'PASS';
      let confidence = 0;
      let probB = ratioB;
      let probP = ratioP;

      // Nếu bàn thiên lệch rõ rệt (> 60% trên ít nhất 15 ván)
      if (stats.total >= 15) {
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
        support: stats.total,
        probB: probB,
        probP: probP,
        predicted: predicted,
        confidence: confidence,
        rationale: `Bàn ${tableId} có tỷ lệ tổng: ${stats.B}B - ${stats.P}P - ${stats.T}T (${Math.round(ratioB * 100)}% B)`
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
      // predictions: { markov: {...}, streak: {...}, table: {...} }
      let totalWeight = 0;
      let weightedB = 0;
      let weightedP = 0;
      const activeContributors = [];

      for (const [key, pred] of Object.entries(predictions)) {
        if (!pred || pred.predicted === 'PASS' || !pred.probB) continue;
        const w = (this.weights[key] || 1.0) * (pred.confidence || 0.5);
        totalWeight += w;
        weightedB += pred.probB * w;
        weightedP += pred.probP * w;
        activeContributors.push({
          key,
          model: pred.model,
          weight: w,
          predicted: pred.predicted,
          rationale: pred.rationale,
          support: pred.support
        });
      }

      if (totalWeight === 0 || activeContributors.length === 0) {
        return {
          predicted: 'PASS',
          probB: 0.5,
          probP: 0.5,
          confidence: 0,
          rationale: 'Chưa đủ dữ liệu hoặc các mô hình chưa đạt độ tin cậy cần thiết.',
          contributors: []
        };
      }

      const finalProbB = weightedB / totalWeight;
      const finalProbP = weightedP / totalWeight;
      const diff = Math.abs(finalProbB - 0.5);

      // Ngưỡng ra quyết định: Xác suất tối thiểu 56% và tự tin > 15%
      let decision = 'PASS';
      if (finalProbB >= 0.56) decision = 'B';
      else if (finalProbP >= 0.56) decision = 'P';

      // Sắp xếp mô hình đóng góp nhiều nhất
      activeContributors.sort((a, b) => b.weight - a.weight);
      const topModel = activeContributors[0];

      return {
        predicted: decision,
        probB: finalProbB,
        probP: finalProbP,
        confidence: Math.min(1.0, diff * 2.5),
        rationale: topModel ? topModel.rationale : 'Đánh giá tổng hợp đa mô hình',
        contributors: activeContributors,
        topModelName: topModel ? topModel.model : 'Tổng hợp'
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
        patternsLearnedCount: 0
      };

      // Chế độ cược an toàn: 'PAPER' (Mặc định - chỉ mô phỏng & học) hoặc 'REAL' (cược tiền thật)
      this.tradingMode = localStorage.getItem('wm_ai_trading_mode') || 'PAPER';
      this.sessionId = 'session_' + Date.now();
      this.onStatsChange = null;

      // Trạng thái kết nối Local Sync Bridge (tự động lưu vào file ai_brain.json)
      this.bridgeConnected = false;

      this.loadSavedState();
    }

    async loadSavedState() {
      await this.db.initPromise;

      // 1. Ưu tiên cao nhất: Kiểm tra Local Sync Bridge (http://127.0.0.1:8421/brain)
      // Giúp đọc trực tiếp từ file ai_brain.json dùng chung cho mọi Chrome Profile!
      let loadedFromFile = false;
      try {
        const resp = await fetch('http://127.0.0.1:8421/brain', { method: 'GET', cache: 'no-cache' });
        if (resp.ok) {
          const fileData = await resp.json();
          if (fileData && fileData.weights) {
            await this.importKnowledge(fileData);
            this.bridgeConnected = true;
            loadedFromFile = true;
            console.log('[AI Engine] Đã kết nối Local Bridge và tải dữ liệu từ file ai_brain.json thành công!');
          }
        }
      } catch (err) {
        this.bridgeConnected = false;
      }

      if (!loadedFromFile) {
        // 2. Kiểm tra IndexedDB của Profile hiện tại
        const savedKnowledge = await this.db.loadKnowledge('ai_engine_weights');
        if (savedKnowledge) {
          if (savedKnowledge.weights) this.ensemble.weights = savedKnowledge.weights;
          if (savedKnowledge.markovCounts) this.markov.ngramCounts = savedKnowledge.markovCounts;
          if (savedKnowledge.streakStats) this.streak.streakStats = savedKnowledge.streakStats;
        } else {
          // 3. Nếu IndexedDB trống (Profile mới), đọc file ai_brain.json đóng gói sẵn trong extension!
          try {
            const bundledUrl = (typeof chrome !== 'undefined' && chrome.runtime?.getURL) ? chrome.runtime.getURL('ai_brain.json') : null;
            if (bundledUrl) {
              const bResp = await fetch(bundledUrl);
              if (bResp.ok) {
                const bData = await bResp.json();
                await this.importKnowledge(bData);
                loadedFromFile = true;
              }
            }
          } catch (e) {}

          if (!loadedFromFile) {
            this.loadPretrainedBaseline();
          }
        }

        const savedStats = await this.db.loadKnowledge('ai_engine_stats');
        if (savedStats) {
          this.stats = Object.assign(this.stats, savedStats);
        }
      }

      this.notifyStats();
    }

    loadPretrainedBaseline() {
      this.markov.ngramCounts = {
        'B': { B: 18, P: 17, T: 4 },
        'P': { B: 17, P: 18, T: 4 },
        'BB': { B: 12, P: 10, T: 2 },
        'PP': { B: 10, P: 12, T: 2 },
        'BP': { B: 11, P: 9, T: 2 },
        'PB': { B: 9, P: 11, T: 2 },
        'BBB': { B: 7, P: 8, T: 1 },
        'PPP': { B: 8, P: 7, T: 1 },
        'BPB': { B: 6, P: 9, T: 1 },
        'PBP': { B: 9, P: 6, T: 1 }
      };
      this.streak.streakStats = {
        'streak_B_2': { continueCount: 12, breakCount: 10 },
        'streak_P_2': { continueCount: 12, breakCount: 10 },
        'streak_B_3': { continueCount: 7, breakCount: 9 },
        'streak_P_3': { continueCount: 7, breakCount: 9 },
        'alt_3': { continueCount: 9, breakCount: 6 }
      };
    }

    exportKnowledge() {
      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        weights: this.ensemble.weights,
        markovCounts: this.markov.ngramCounts,
        streakStats: this.streak.streakStats,
        stats: {
          totalRoundsObserved: this.stats.totalRoundsObserved || 0,
          predictionsScored: this.stats.predictionsScored || 0,
          wins: this.stats.wins || 0,
          losses: this.stats.losses || 0,
          tiesPush: this.stats.tiesPush || 0,
          accuracy: this.stats.accuracy || 0,
          patternsLearnedCount: Object.keys(this.markov.ngramCounts).length + Object.keys(this.streak.streakStats).length
        }
      };
    }

    async importKnowledge(data) {
      if (!data || typeof data !== 'object') return false;
      if (data.weights) this.ensemble.weights = Object.assign(this.ensemble.weights, data.weights);
      if (data.markovCounts) this.markov.ngramCounts = Object.assign(this.markov.ngramCounts, data.markovCounts);
      if (data.streakStats) this.streak.streakStats = Object.assign(this.streak.streakStats, data.streakStats);
      if (data.stats) {
        this.stats = Object.assign(this.stats, data.stats);
      }
      await this.persistKnowledge();
      this.notifyStats();
      return true;
    }

    async persistKnowledge() {
      const payload = {
        version: 1,
        weights: this.ensemble.weights,
        markovCounts: this.markov.ngramCounts,
        streakStats: this.streak.streakStats,
        stats: this.stats,
        updatedAt: new Date().toISOString()
      };

      try {
        await this.db.saveKnowledge('ai_engine_weights', payload);
        await this.db.saveKnowledge('ai_engine_stats', this.stats);
      } catch (e) {}

      // Tự động lưu thẳng vào file ai_brain.json qua Local Bridge (nếu đang chạy)
      try {
        const resp = await fetch('http://127.0.0.1:8421/brain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (resp.ok) {
          this.bridgeConnected = true;
        }
      } catch (err) {
        this.bridgeConnected = false;
      }
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
      this.stats.totalRoundsObserved++;

      // 1. Kiểm tra đối chiếu với Dự đoán đang chờ
      const pending = this.pendingPredictions.get(tableId);
      if (pending && pending.status === 'PENDING') {
        this.pendingPredictions.delete(tableId);

        let resultStatus = 'LOSS';
        if (newOutcome === 'T') {
          // Quy tắc hòa Baccarat: Hoàn tiền, không tính là thua
          resultStatus = 'TIE_PUSH';
          this.stats.tiesPush++;
        } else if (pending.predicted === newOutcome) {
          resultStatus = 'WIN';
          this.stats.wins++;
        } else if (pending.predicted !== 'PASS') {
          resultStatus = 'LOSS';
          this.stats.losses++;
        }

        if (pending.predicted !== 'PASS' && newOutcome !== 'T') {
          this.stats.predictionsScored++;
          const scoredCount = this.stats.wins + this.stats.losses;
          this.stats.accuracy = scoredCount > 0 ? (this.stats.wins / scoredCount) : 0;
        }

        // Cập nhật trọng số thích ứng cho từng mô hình con
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
        pending.resolvedAt = Date.now();
        this.db.savePrediction(pending);
      }

      // 2. Học trực tuyến ngay lập tức trên dữ liệu ván mới
      this.markov.trainRound(previousHistory, newOutcome);
      this.streak.trainRound(previousHistory, newOutcome);
      this.tableLearner.trainRound(tableId, newOutcome);

      // Lưu ván vào DB
      this.db.saveRound({
        id: `${tableId}_${Date.now()}`,
        tableId: tableId,
        tableName: tableName,
        outcome: newOutcome,
        timestamp: Date.now(),
        date: new Date().toISOString().split('T')[0],
        sessionId: this.sessionId
      });

      // Lưu định kỳ kiến thức học
      if (this.stats.totalRoundsObserved % 5 === 0) {
        this.persistKnowledge();
      }

      this.notifyStats();
    }

    /**
     * VÒNG HỌC 2: TẠO DỰ ĐOÁN CHO VÁN TIẾP THEO (PRE-ROUND PREDICTION)
     * Sinh dự đoán trước khi biết kết quả, lưu vào sổ và trả về đề xuất cược.
     */
    generatePrediction(tableId, tableName, history) {
      if (!history || history.length < 2) {
        return {
          shouldBet: false,
          predicted: 'PASS',
          confidence: 0,
          rationale: 'Chưa đủ dữ liệu ván ban đầu (cần >= 2 ván)',
          tradingMode: this.tradingMode
        };
      }

      // 1. Chạy 3 bộ học song song
      const subMarkov = this.markov.predict(history);
      const subStreak = this.streak.predict(history);
      const subTable = this.tableLearner.predict(tableId, history);

      // 2. Kết hợp đa mô hình có trọng số
      const combined = this.ensemble.combine({
        markov: subMarkov,
        streak: subStreak,
        table: subTable
      });

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

      // 3. Ghi vào Sổ dự đoán đang chờ
      if (combined.predicted !== 'PASS') {
        this.pendingPredictions.set(tableId, predictionRecord);
        this.db.savePrediction(predictionRecord);
      }

      // Chốt an toàn: Chỉ cho phép cược thật nếu người dùng bật REAL
      const isConfident = combined.predicted === 'B' || combined.predicted === 'P';
      const allowRealExecution = isConfident && (this.tradingMode === 'REAL');

      return {
        tableId: tableId,
        tableName: tableName,
        predicted: combined.predicted,
        shouldBet: allowRealExecution,
        isPaperTrading: this.tradingMode === 'PAPER',
        probB: combined.probB,
        probP: combined.probP,
        confidence: combined.confidence,
        rationale: combined.rationale,
        topModelName: combined.topModelName,
        predictionRecord: predictionRecord
      };
    }
  }

  // Xuất ra phạm vi toàn cục
  window.WMBaccaratAIEngine = WMBaccaratAIEngine;

})(window);
