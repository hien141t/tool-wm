// ==========================================================================
// WM AUTO BACCARAT PRO - CONTENT SCRIPT (PHIÊN BẢN V2.5 TOÀN NĂNG)
// Tự động nhận diện mọi giao diện (H5 Mobile / PC Mới / Cũ), quét toàn bàn
// ==========================================================================

console.log('[WM Bot] Content script đã nạp thành công');

class WMAutoHelper {
  constructor() {
    this.overlay = null;
    this.miniPill = null;
    this.isRunning = false;
    this.isDragging = false;
    this.currentX = 0;
    this.currentY = 0;
    this.initialX = 0;
    this.initialY = 0;
    this.messageIdCounter = 0;
    this.pendingMessages = {};

    // Cấu hình mặc định
    this.selectedChip = 10;
    this.maxTotalBet = 5000; // Hạn mức tổng tiền cược tối đa (0 = không giới hạn)
    this.maxConcurrentBets = 3; // Số lệnh cược chạy cùng lúc tối đa (0 = không giới hạn)
    this.maxTables = 20;

    // Bộ não AI Baccarat thích ứng trực tuyến (Online Adaptive Multi-Model AI Engine)
    this.aiEngine = window.WMBaccaratAIEngine ? new window.WMBaccaratAIEngine() : null;
    this.tableLastHistory = new Map();
    this.recentPredictionsLog = [];

    // Trạng thái bàn & Thống kê
    this.tablesMap = new Map();
    this.tableStates = {}; // Lưu round hiện tại đã cược chưa
    this.activeBettingTables = new Set(); // Khóa Mutex chống cược trùng bàn khi đang thực thi (In-flight Mutex)
    this.isEvaluatingAllTables = false;   // Khóa vòng lặp chống đè cược lặp lại (Loop Mutex)
    this.betHistory = [];
    this.stats = {
      totalBets: 0,
      totalAmount: 0,
      bankerBets: 0,
      playerBets: 0
    };

    this.scanInterval = null;
    this.bettingLoopInterval = null;
    this.roadViewMode = localStorage.getItem('wm_road_view_mode') || 'scroll';
    this.actualGameChip = null; // Mệnh giá chip thực tế đang active trên bàn game

    this.initApp();
  }

  // ==========================================================================
  // KHỞI TẠO TỰ ĐỘNG
  // ==========================================================================
  async initApp() {
    try {
      const res = await chrome.storage.local.get(['wm_bet_history']);
      if (res.wm_bet_history && Array.isArray(res.wm_bet_history)) {
        this.betHistory = res.wm_bet_history;
        this.recalculateStats();
      }

      console.log('[WM Bot] Tự động khởi động trên host:', window.location.hostname);
      this.init();
      this.setupMessageListener();
      this.loadSettings();

      // Khởi chạy quét bàn nền ngay lập tức (kể cả khi chưa bấm Bắt đầu)
      this.startBackgroundScanner();

      // Khôi phục nhật ký dự đoán AI từ IndexedDB khi mở lại extension
      if (this.aiEngine && this.aiEngine.db) {
        this.aiEngine.db.getRecentPredictions(15).then(list => {
          if (list && list.length > 0 && this.recentPredictionsLog.length === 0) {
            this.recentPredictionsLog = list.map(p => ({
              id: p.id,
              tableId: p.tableId,
              tableName: p.tableName,
              predicted: p.predicted,
              prob: Math.round(((p.predicted === 'B' ? p.probB : p.probP) || 0.5) * 100),
              reason: p.rationale || 'Đánh giá đa mô hình',
              mode: p.tradingMode || 'PAPER',
              time: new Date(p.timestamp || Date.now()).toLocaleTimeString('vi-VN'),
              actualOutcome: p.actualOutcome,
              status: p.status
            }));
            this.updateAILogTable();
          }
        });
      }

    } catch (err) {
      console.error('[WM Bot] Lỗi khởi động:', err);
      this.init();
      this.setupMessageListener();
      this.loadSettings();
      this.startBackgroundScanner();
    }
  }

  loadSettings() {
    try {
      const chip = localStorage.getItem('wm_chip');
      if (chip) this.selectedChip = parseInt(chip);

      const maxLimit = localStorage.getItem('wm_max_total_bet');
      if (maxLimit !== null) this.maxTotalBet = parseInt(maxLimit) || 0;

      const maxConcurrent = localStorage.getItem('wm_max_concurrent_bets');
      if (maxConcurrent !== null) {
        const val = parseInt(maxConcurrent);
        this.maxConcurrentBets = isNaN(val) ? 3 : Math.max(0, val);
      }

      const maxTables = localStorage.getItem('wm_max_tables');
      if (maxTables) this.maxTables = parseInt(maxTables);

      const patterns = localStorage.getItem('wm_patterns');
      if (patterns) this.patterns = JSON.parse(patterns);
    } catch (e) {}
  }

  saveSettings() {
    try {
      localStorage.setItem('wm_chip', this.selectedChip);
      localStorage.setItem('wm_max_total_bet', this.maxTotalBet);
      localStorage.setItem('wm_max_concurrent_bets', this.maxConcurrentBets);
      localStorage.setItem('wm_max_tables', this.maxTables);
      localStorage.setItem('wm_patterns', JSON.stringify(this.patterns));
    } catch (e) {}
  }

  saveBetHistory() {
    try {
      chrome.storage.local.set({ wm_bet_history: this.betHistory.slice(0, 100) });
    } catch (e) {}
  }

  recalculateStats() {
    this.stats = {
      totalBets: 0,
      totalAmount: 0,
      bankerBets: 0,
      playerBets: 0,
      wins: 0,
      losses: 0,
      ties: 0,
      pending: 0,
      winRate: 0,
      totalProfit: 0
    };

    this.betHistory.forEach(item => {
      // Chỉ tính các lệnh đặt cược thành công vào bàn (bỏ qua lệnh lỗi/không đặt được)
      if (item.result === 'FAILED' || item.success === false) return;

      this.stats.totalBets++;
      this.stats.totalAmount += (item.amount || 0);
      if (item.bet === 'B') this.stats.bankerBets++;
      if (item.bet === 'P') this.stats.playerBets++;

      if (item.result === 'WIN') {
        this.stats.wins++;
        this.stats.totalProfit += (item.profit !== undefined ? item.profit : item.amount);
      } else if (item.result === 'LOSS') {
        this.stats.losses++;
        this.stats.totalProfit += (item.profit !== undefined ? item.profit : -item.amount);
      } else if (item.result === 'TIE') {
        this.stats.ties++;
      } else if (item.result === 'PENDING') {
        this.stats.pending++;
      }
    });

    const settled = this.stats.wins + this.stats.losses;
    this.stats.winRate = settled > 0 ? Math.round((this.stats.wins / settled) * 100) : 0;
    this.updateLimitProgressUI();
  }

  // ==========================================================================
  // XÂY DỰNG GIAO DIỆN OVERLAY
  // ==========================================================================
  init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.createOverlay());
    } else {
      this.createOverlay();
    }
  }

  createOverlay() {
    if (document.getElementById('wm-auto-helper-overlay')) return;

    // 1. Mini Floating Pill (Thu nhỏ - Siêu gọn & Kéo thả di chuyển)
    this.miniPill = document.createElement('div');
    this.miniPill.id = 'wm-auto-mini-pill';
    this.miniPill.innerHTML = `
      <span class="pill-title">🎰 WM</span>
      <span id="wm-mini-badge">0 Bàn</span>
      <span id="wm-mini-status-dot"></span>
    `;
    document.body.appendChild(this.miniPill);
    this.setupMiniPillDragging();

    // 2. Bảng điều khiển chính
    this.overlay = document.createElement('div');
    this.overlay.id = 'wm-auto-helper-overlay';
    this.overlay.innerHTML = `
      <!-- HEADER -->
      <div id="wm-auto-helper-header">
        <h3 id="wm-auto-helper-title">
          <span>🎰</span>
          <span>WM Baccarat Multi-Bot Pro</span>
        </h3>
        <div id="wm-auto-helper-controls">
          <button class="wm-ctrl-btn" id="wm-btn-minimize" title="Thu nhỏ">−</button>
          <button class="wm-ctrl-btn close" id="wm-btn-close" title="Đóng">×</button>
        </div>
      </div>

      <!-- STATUS TOP BAR -->
      <div class="wm-top-status-bar">
        <div class="wm-status-pill stopped" id="wm-status-pill">
          <span style="font-size:8px;">●</span>
          <span id="wm-status-text">ĐÃ DỪNG</span>
        </div>
        <div class="wm-top-metric">
          Đang nắm: <b id="wm-metric-tables">0</b> bàn
        </div>
        <div class="wm-top-metric">
          Tổng cược: <b id="wm-metric-bets">0</b> (<b id="wm-metric-total-amount" style="color:#00f2fe;">0</b>)
        </div>
        <div class="wm-top-metric">
          Thắng: <b id="wm-metric-wins" style="color:#10b981;">0</b>
        </div>
        <div class="wm-top-metric">
          Lãi: <b id="wm-metric-profit" style="color:#facc15;">0</b>
        </div>
      </div>

      <!-- NAVIGATION TABS -->
      <div class="wm-nav-tabs">
        <button class="wm-tab-btn active" data-tab="settings">⚙️ Cài Đặt</button>
        <button class="wm-tab-btn" data-tab="tables">
          📊 Bàn Chơi <span class="wm-tab-badge" id="wm-tab-badge-tables">0</span>
        </button>
        <button class="wm-tab-btn" data-tab="history">
          📜 Lịch Sử <span class="wm-tab-badge" id="wm-tab-badge-history">0</span>
        </button>
        <button class="wm-tab-btn" data-tab="logs">📝 Nhật Ký</button>
      </div>

      <!-- TAB 1: CÀI ĐẶT -->
      <div class="wm-tab-content active" id="wm-tab-settings">
        <div class="wm-action-row">
          <button class="wm-btn-start" id="wm-start-btn">▶ Bắt Đầu Tự Động Cược</button>
          <button class="wm-btn-stop" id="wm-stop-btn" disabled>⏹ Dừng Lại</button>
        </div>

        <div class="wm-card">
          <div class="wm-card-title">
            <span>💰 Cấu hình tiền cược & Hạn mức</span>
          </div>
          <div class="wm-form-grid">
            <div class="wm-form-group">
              <label class="wm-label">Mệnh giá Chip:</label>
              <select class="wm-select" id="wm-chip-select">
                <option value="10">Chip 10</option>
                <option value="20">Chip 20</option>
                <option value="50">Chip 50</option>
                <option value="100">Chip 100</option>
                <option value="500">Chip 500</option>
                <option value="1000">Chip 1,000</option>
                <option value="5000">Chip 5,000</option>
              </select>
            </div>
            <div class="wm-form-group">
              <label class="wm-label">Hạn mức tổng cược (Dừng bot):</label>
              <input type="number" class="wm-input" id="wm-max-total-bet" min="0" step="100" value="5000" placeholder="0 = Không giới hạn" title="Khi tổng tiền cược đạt mức này, bot sẽ tự động dừng lại">
            </div>
            <div class="wm-form-group">
              <label class="wm-label">Số bàn tối đa theo dõi:</label>
              <input type="number" class="wm-input" id="wm-max-tables" min="1" max="30" value="20">
            </div>
            <div class="wm-form-group">
              <label class="wm-label">Tiến độ hạn mức cược:</label>
              <div id="wm-limit-progress-wrap" style="background:#0f121a; border:1px solid #2d384d; border-radius:6px; padding:7px 10px; font-size:11px; display:flex; justify-content:space-between; align-items:center; box-sizing:border-box; height:34px;">
                <span id="wm-limit-progress-text" style="font-weight:600; color:#38bdf8;">0 / 5,000</span>
                <span id="wm-limit-percent" style="font-weight:bold; color:#10b981;">0%</span>
              </div>
            </div>
            <div class="wm-form-group">
              <label class="wm-label">Cược tối đa cùng lúc (lệnh):</label>
              <input type="number" class="wm-input" id="wm-max-concurrent-bets" min="0" max="30" value="3" placeholder="0 = Không giới hạn" title="Số lệnh cược đang chờ kết quả chạy cùng một lúc tối đa (mặc định 3)">
            </div>
            <div class="wm-form-group">
              <label class="wm-label">Đang cược đồng thời:</label>
              <div id="wm-concurrent-status-wrap" style="background:#0f121a; border:1px solid #2d384d; border-radius:6px; padding:7px 10px; font-size:11px; display:flex; justify-content:space-between; align-items:center; box-sizing:border-box; height:34px;">
                <span id="wm-concurrent-status-text" style="font-weight:600; color:#38bdf8;">0 / 3 lệnh</span>
                <span id="wm-concurrent-badge" style="font-weight:bold; color:#10b981;">SẴN SÀNG</span>
              </div>
            </div>
          </div>
        </div>

        <div class="wm-card wm-ai-card">
          <div class="wm-card-title" style="display:flex; justify-content:space-between; align-items:center;">
            <span>🤖 AI Learning Center (Học & Dự Đoán Tự Động)</span>
            <span class="wm-ai-mode-pill" id="wm-ai-mode-badge">MÔ PHỎNG (PAPER)</span>
          </div>

          <!-- Chốt an toàn / Chế độ giao dịch -->
          <div class="wm-ai-mode-bar">
            <span style="font-size:11px; color:#94a3b8; font-weight:600;">Chế độ cược:</span>
            <div class="wm-ai-mode-toggle">
              <button type="button" class="wm-mode-btn active" id="wm-mode-paper-btn">🟢 Paper Trading (Mô phỏng)</button>
              <button type="button" class="wm-mode-btn" id="wm-mode-real-btn">🔴 Cược thật (Real Bet)</button>
            </div>
          </div>

          <!-- Thống kê AI thời gian thực -->
          <div class="wm-ai-stats-grid">
            <div class="wm-ai-stat-box">
              <div class="wm-ai-stat-val" id="wm-ai-total-rounds">0</div>
              <div class="wm-ai-stat-lbl">Ván đã ghi nhận</div>
            </div>
            <div class="wm-ai-stat-box">
              <div class="wm-ai-stat-val" id="wm-ai-scored">0</div>
              <div class="wm-ai-stat-lbl">Dự đoán đã chấm</div>
            </div>
            <div class="wm-ai-stat-box">
              <div class="wm-ai-stat-val" id="wm-ai-accuracy" style="color:#00ff88;">0.0%</div>
              <div class="wm-ai-stat-lbl">Độ chính xác</div>
            </div>
            <div class="wm-ai-stat-box">
              <div class="wm-ai-stat-val" id="wm-ai-pending" style="color:#38bdf8;">0</div>
              <div class="wm-ai-stat-lbl">Đang chờ kết quả</div>
            </div>
          </div>

          <!-- Trạng thái học -->
          <div class="wm-ai-learning-status">
            <div class="wm-ai-status-row">
              <span class="lbl">🧬 Mẫu cầu đã tích lũy:</span>
              <span class="val" id="wm-ai-patterns">0 mẫu (N-gram & Nhịp cầu)</span>
            </div>
            <div class="wm-ai-status-row">
              <span class="lbl">🏆 Mô hình dẫn đầu:</span>
              <span class="val" id="wm-ai-top-model">Markov N-gram (Order 3)</span>
            </div>
            <div class="wm-ai-status-row">
              <span class="lbl">⚡ Trạng thái:</span>
              <span class="val" style="color:#34d399;">Học trực tuyến liên tục (Online Adaptive)</span>
            </div>
          </div>

          <!-- Bảng dự đoán mới nhất & giải thích lý do -->
          <div style="font-size:11px; font-weight:bold; color:#cbd5e1; margin-top:10px; margin-bottom:5px;">
            📋 Nhật ký dự đoán & Giải thích lý do (Explainability):
          </div>
          <div class="wm-ai-log-table-wrap">
            <table class="wm-table wm-ai-table">
              <thead>
                <tr>
                  <th>Bàn</th>
                  <th>Dự đoán</th>
                  <th>Xác suất</th>
                  <th>Lý do phân tích</th>
                  <th>Thật</th>
                  <th>Kết quả</th>
                </tr>
              </thead>
              <tbody id="wm-ai-predictions-body">
                <tr>
                  <td colspan="6" style="text-align:center; color:#64748b; padding:12px;">Đang quét bàn để thu thập dữ liệu học trực tuyến...</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; gap:6px; flex-wrap:wrap;">
            <div style="display:flex; gap:6px;">
              <button type="button" class="wm-ai-action-btn" id="wm-ai-export-btn" title="Xuất toàn bộ mẫu cầu & trọng số AI thành file JSON để mang sang profile khác">📤 Xuất não AI</button>
              <button type="button" class="wm-ai-action-btn" id="wm-ai-import-btn" title="Nạp file não AI đã học từ profile khác">📥 Nạp não AI</button>
              <input type="file" id="wm-ai-import-file" accept=".json" style="display:none;">
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <button type="button" class="wm-clear-log-btn" id="wm-ai-reset-memory-btn" style="color:#ef4444; margin-top:0;">🧹 Đặt lại</button>
            </div>
          </div>
          <div style="margin-top:6px; font-size:10px; color:#64748b; display:flex; justify-content:space-between; align-items:center;">
            <span id="wm-ai-bridge-status">⚪ Đang kiểm tra tự động lưu file ai_brain.json...</span>
            <span>Tự đồng bộ đa Profile</span>
          </div>
        </div>
      </div>

      <!-- TAB 2: THỐNG KÊ BÀN CHƠI (LIVE TABLES) -->
      <div class="wm-tab-content" id="wm-tab-tables">
        <div class="wm-tables-summary-bar">
          <div>
            <span>Đã nắm: <b id="wm-live-count">0</b> bàn</span> | 
            <span>Mở cược: <b id="wm-live-open-count" style="color:#00f2fe;">0</b></span>
          </div>
          <div style="display:flex; gap:6px; align-items:center;">
            <button class="wm-refresh-tables-btn" id="wm-btn-toggle-all-view" title="Chuyển chế độ xem: Cuộn ngang 1 hàng hoặc Xem hết 2 hàng">
              ${this.roadViewMode === 'wrap' ? '↔️ Cuộn 1 hàng' : '▦ Xem 2 hàng'}
            </button>
            <button class="wm-refresh-tables-btn" id="wm-btn-force-scroll">🔄 Cuộn Quét Toàn Bàn</button>
          </div>
        </div>

        <div class="wm-tables-grid" id="wm-tables-list">
          <div style="text-align:center; padding:30px 10px; color:#64748b; font-size:12px;">
            Đang quét danh sách bàn chơi...
          </div>
        </div>
      </div>

      <!-- TAB 3: LỊCH SỬ ĐẶT CƯỢC -->
      <div class="wm-tab-content" id="wm-tab-history">
        <div class="wm-history-stats-bar">
          <div class="wm-stat-box">
            <div class="wm-stat-num" id="wm-stat-total-bets">0</div>
            <div class="wm-stat-label">Số lần cược</div>
          </div>
          <div class="wm-stat-box">
            <div class="wm-stat-num" style="color:#00f2fe;" id="wm-stat-total-amount">0</div>
            <div class="wm-stat-label">Tổng tiền cược</div>
          </div>
          <div class="wm-stat-box">
            <div class="wm-stat-num" style="color:#38bdf8;" id="wm-stat-winrate">0%</div>
            <div class="wm-stat-label">Tỷ lệ thắng</div>
          </div>
          <div class="wm-stat-box">
            <div class="wm-stat-num" style="color:#10b981;" id="wm-stat-wins">0</div>
            <div class="wm-stat-label">Thắng (Win)</div>
          </div>
          <div class="wm-stat-box">
            <div class="wm-stat-num" style="color:#ef4444;" id="wm-stat-losses">0</div>
            <div class="wm-stat-label">Thua (Loss)</div>
          </div>
          <div class="wm-stat-box">
            <div class="wm-stat-num" id="wm-stat-profit" style="color:#facc15;">0</div>
            <div class="wm-stat-label">Lợi nhuận (P/L)</div>
          </div>
        </div>

        <div class="wm-history-table-container">
          <table class="wm-history-table">
            <thead>
              <tr>
                <th>Giờ</th>
                <th>Bàn</th>
                <th>Cửa cược</th>
                <th>Tiền cược</th>
                <th>Cầu khớp</th>
                <th>Kết quả ván</th>
                <th>Lãi / Lỗ</th>
              </tr>
            </thead>
            <tbody id="wm-history-tbody">
              <!-- Render lịch sử cược -->
            </tbody>
            <tfoot id="wm-history-tfoot" style="display:none;">
              <tr style="background:#0f172a; font-weight:800; border-top:2px solid #334155;">
                <td colspan="3" style="color:#94a3b8; font-size:10px;">TỔNG CỘNG:</td>
                <td id="wm-tfoot-total-amount" style="color:#00f2fe;">0</td>
                <td></td>
                <td id="wm-tfoot-win-loss" style="color:#10b981;">0W - 0L</td>
                <td id="wm-tfoot-profit" style="color:#facc15;">0</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <button class="wm-clear-history-btn" id="wm-btn-clear-history">🗑️ Xóa Lịch Sử Cược</button>
      </div>

      <!-- TAB 4: NHẬT KÝ -->
      <div class="wm-tab-content" id="wm-tab-logs">
        <div id="wm-auto-helper-log"></div>
        <button class="wm-clear-log-btn" id="wm-btn-clear-log">Xóa nhật ký</button>
      </div>
    `;

    document.body.appendChild(this.overlay);

    this.setupEventListeners();
    this.loadSettingsToUI();
    this.renderBetHistory();
    this.addLog('WM Auto Baccarat Pro đã sẵn sàng! Đang tự động quét bàn...', 'success');
  }

  // ==========================================================================
  // SỰ KIỆN GIAO DIỆN
  // ==========================================================================
  setupEventListeners() {
    // Kéo thả Header
    const header = document.getElementById('wm-auto-helper-header');
    header.addEventListener('mousedown', (e) => this.dragStart(e));
    document.addEventListener('mousemove', (e) => this.drag(e));
    document.addEventListener('mouseup', () => this.dragEnd());

    // Thu nhỏ / Đóng
    document.getElementById('wm-btn-minimize').addEventListener('click', () => this.toggleMinimize(true));
    document.getElementById('wm-btn-close').addEventListener('click', () => this.close());

    // Chuyển Tab
    const tabButtons = this.overlay.querySelectorAll('.wm-tab-btn');
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        tabButtons.forEach(b => b.classList.remove('active'));
        this.overlay.querySelectorAll('.wm-tab-content').forEach(c => c.classList.remove('active'));

        btn.classList.add('active');
        const targetTab = btn.getAttribute('data-tab');
        const targetContent = document.getElementById(`wm-tab-${targetTab}`);
        if (targetContent) targetContent.classList.add('active');
      });
    });

    // Form Cài đặt
    const chipSelect = document.getElementById('wm-chip-select');
    chipSelect.addEventListener('change', (e) => {
      this.selectedChip = parseInt(e.target.value);
      this.saveSettings();
      this.addLog(`Đã chọn Chip: ${this.selectedChip}`, 'info');
      this.selectGameChip(this.selectedChip);
    });

    const maxTotalBetInput = document.getElementById('wm-max-total-bet');
    if (maxTotalBetInput) {
      maxTotalBetInput.addEventListener('change', (e) => {
        const val = parseInt(e.target.value);
        this.maxTotalBet = isNaN(val) || val < 0 ? 0 : val;
        this.saveSettings();
        this.updateLimitProgressUI();
        this.addLog(`Đã cài đặt Hạn mức tổng cược: ${this.maxTotalBet > 0 ? this.maxTotalBet.toLocaleString('vi-VN') : 'Không giới hạn'}`, 'info');
      });
    }

    const maxConcurrentInput = document.getElementById('wm-max-concurrent-bets');
    if (maxConcurrentInput) {
      maxConcurrentInput.addEventListener('change', (e) => {
        const val = parseInt(e.target.value);
        this.maxConcurrentBets = isNaN(val) || val < 0 ? 0 : val;
        this.saveSettings();
        this.updateLimitProgressUI();
        this.addLog(`Đã cài đặt Cược tối đa cùng lúc: ${this.maxConcurrentBets > 0 ? this.maxConcurrentBets + ' lệnh' : 'Không giới hạn'}`, 'info');
      });
    }

    const maxTablesInput = document.getElementById('wm-max-tables');
    maxTablesInput.addEventListener('change', (e) => {
      this.maxTables = Math.max(1, parseInt(e.target.value) || 10);
      this.saveSettings();
      this.addLog(`Số bàn tối đa theo dõi: ${this.maxTables}`, 'info');
    });

    // Chế độ cược AI: Paper Trading vs Real Bet
    const paperBtn = document.getElementById('wm-mode-paper-btn');
    const realBtn = document.getElementById('wm-mode-real-btn');
    if (paperBtn) {
      paperBtn.addEventListener('click', () => {
        if (this.aiEngine) {
          this.aiEngine.setTradingMode('PAPER');
          this.addLog('🛡️ Đã chuyển sang chế độ: PAPER TRADING (Mô phỏng an toàn - không đặt cược thật)', 'info');
        }
      });
    }
    if (realBtn) {
      realBtn.addEventListener('click', () => {
        if (this.aiEngine) {
          this.aiEngine.setTradingMode('REAL');
          this.addLog('⚠️ Đã chuyển sang chế độ: CƯỢC THẬT (Bot sẽ tự đặt tiền thật khi bấm Bắt đầu)', 'warning');
        }
      });
    }

    // Xuất bộ não AI thành file JSON
    const exportAiBtn = document.getElementById('wm-ai-export-btn');
    if (exportAiBtn) {
      exportAiBtn.addEventListener('click', () => {
        if (!this.aiEngine) return;
        const data = this.aiEngine.exportKnowledge();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wm_ai_brain_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.addLog('📤 Đã xuất file bộ não AI (JSON) thành công!', 'success');
      });
    }

    // Nạp bộ não AI từ file JSON
    const importAiBtn = document.getElementById('wm-ai-import-btn');
    const importAiFile = document.getElementById('wm-ai-import-file');
    if (importAiBtn && importAiFile) {
      importAiBtn.addEventListener('click', () => importAiFile.click());
      importAiFile.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (evt) => {
          try {
            const data = JSON.parse(evt.target.result);
            if (this.aiEngine) {
              const ok = await this.aiEngine.importKnowledge(data);
              if (ok) {
                this.addLog(`📥 Nạp bộ não AI thành công! (${this.aiEngine.stats.patternsLearnedCount} mẫu đã tích lũy)`, 'success');
              } else {
                this.addLog('❌ File dữ liệu AI không đúng định dạng!', 'error');
              }
            }
          } catch (err) {
            this.addLog(`❌ Lỗi đọc file AI: ${err.message}`, 'error');
          }
        };
        reader.readAsText(file);
      });
    }

    // Đặt lại bộ nhớ học AI
    const resetAiBtn = document.getElementById('wm-ai-reset-memory-btn');
    if (resetAiBtn) {
      resetAiBtn.addEventListener('click', async () => {
        if (confirm('Bạn có chắc chắn muốn đặt lại toàn bộ dữ liệu học AI trên máy này?')) {
          if (this.aiEngine) {
            await this.aiEngine.db.clearAll();
            this.aiEngine.stats = {
              totalRoundsObserved: 0,
              predictionsScored: 0,
              wins: 0,
              losses: 0,
              tiesPush: 0,
              accuracy: 0,
              patternsLearnedCount: 0
            };
            this.aiEngine.markov.ngramCounts = {};
            this.aiEngine.streak.streakStats = {};
            this.aiEngine.tableLearner.tableShoeStats = {};
            this.aiEngine.notifyStats();
            this.recentPredictionsLog = [];
            this.updateAILogTable();
            this.addLog('🧹 Đã xóa toàn bộ bộ nhớ học AI.', 'info');
          }
        }
      });
    }

    // Kết nối sự kiện cập nhật thống kê AI
    if (this.aiEngine) {
      this.aiEngine.onStatsChange = (stats, mode, bridgeConnected) => {
        this.renderAIStats(stats, mode, bridgeConnected);
      };
      this.renderAIStats(this.aiEngine.stats, this.aiEngine.tradingMode, this.aiEngine.bridgeConnected);
    }

    // Nút Bắt đầu / Dừng
    document.getElementById('wm-start-btn').addEventListener('click', () => this.start());
    document.getElementById('wm-stop-btn').addEventListener('click', () => this.stop());

    // Nút Cuộn quét toàn bàn
    document.getElementById('wm-btn-force-scroll').addEventListener('click', () => {
      this.forceScrollAllTables();
    });

    // Nút chuyển chế độ xem tất cả các bàn (1 Hàng cuộn / 2 Hàng xem hết)
    const toggleAllBtn = document.getElementById('wm-btn-toggle-all-view');
    if (toggleAllBtn) {
      toggleAllBtn.addEventListener('click', () => {
        this.roadViewMode = this.roadViewMode === 'wrap' ? 'scroll' : 'wrap';
        localStorage.setItem('wm_road_view_mode', this.roadViewMode);
        toggleAllBtn.textContent = this.roadViewMode === 'wrap' ? '↔️ Cuộn 1 hàng' : '▦ Xem 2 hàng';

        // Cập nhật tất cả các card hiện tại
        const allDots = document.querySelectorAll('#wm-tables-list .wm-road-dots');
        allDots.forEach(dotsEl => {
          if (this.roadViewMode === 'wrap') {
            dotsEl.classList.add('wm-wrap-mode');
          } else {
            dotsEl.classList.remove('wm-wrap-mode');
            dotsEl.scrollLeft = dotsEl.scrollWidth;
          }
        });

        // Cập nhật text trên các nút con
        const allModeBtns = document.querySelectorAll('#wm-tables-list .wm-road-mode-btn');
        allModeBtns.forEach(btn => {
          btn.textContent = this.roadViewMode === 'wrap' ? '↔️ Cuộn' : '▦ 2 Hàng';
        });
      });
    }

    // Xóa lịch sử / log
    document.getElementById('wm-btn-clear-history').addEventListener('click', () => {
      this.betHistory = [];
      this.recalculateStats();
      this.saveBetHistory();
      this.renderBetHistory();
      this.addLog('Đã xóa toàn bộ lịch sử cược!', 'info');
    });

    document.getElementById('wm-btn-clear-log').addEventListener('click', () => {
      document.getElementById('wm-auto-helper-log').innerHTML = '';
    });
  }

  loadSettingsToUI() {
    try {
      const chipSelect = document.getElementById('wm-chip-select');
      if (chipSelect) chipSelect.value = String(this.selectedChip);

      const maxTotalBetInput = document.getElementById('wm-max-total-bet');
      if (maxTotalBetInput) maxTotalBetInput.value = String(this.maxTotalBet);

      const maxConcurrentInput = document.getElementById('wm-max-concurrent-bets');
      if (maxConcurrentInput) maxConcurrentInput.value = String(this.maxConcurrentBets);

      const maxTablesInput = document.getElementById('wm-max-tables');
      if (maxTablesInput) maxTablesInput.value = String(this.maxTables);

      const patternsInput = document.getElementById('wm-patterns-input');
      if (patternsInput && this.patterns.length > 0) {
        patternsInput.value = this.patterns.map(p => `${p.condition}=${p.bet}`).join('\n');
      }
      this.updateLimitProgressUI();
      this.setControlsLocked(this.isRunning);
    } catch (e) {}
  }

  toggleMinimize(minimize) {
    if (minimize) {
      this.overlay.style.display = 'none';
      this.miniPill.style.display = 'flex';
      this.updateMiniPill();
    } else {
      this.overlay.style.display = 'flex';
      this.miniPill.style.display = 'none';
    }
  }

  updateMiniPill() {
    if (!this.miniPill) return;
    const badge = document.getElementById('wm-mini-badge');
    const dot = document.getElementById('wm-mini-status-dot');
    if (badge) {
      if (this.stats && this.stats.totalBets > 0) {
        const p = this.stats.totalProfit;
        const pStr = p > 0 ? `+${p}` : `${p}`;
        badge.textContent = `${this.tablesMap.size}B | W:${this.stats.wins}/${this.stats.totalBets} (${pStr})`;
      } else {
        badge.textContent = `${this.tablesMap.size} Bàn`;
      }
    }
    if (dot) dot.style.background = this.isRunning ? '#10b981' : '#ef4444';
  }

  // ==========================================================================
  // KÉO THẢ DI CHUYỂN VIÊN PIN (MINI PILL DRAG & CLICK)
  // ==========================================================================
  setupMiniPillDragging() {
    let isDragging = false;
    let hasMoved = false;
    let startX = 0, startY = 0;
    let initialX = 0, initialY = 0;
    let currentX = 0, currentY = 0;

    // Nạp vị trí đã lưu trước đó nếu có
    const savedPos = localStorage.getItem('wm_mini_pill_pos');
    if (savedPos) {
      try {
        const { x, y } = JSON.parse(savedPos);
        this.miniPill.style.left = `${x}px`;
        this.miniPill.style.top = `${y}px`;
        this.miniPill.style.right = 'auto';
        currentX = x;
        currentY = y;
      } catch (e) {}
    }

    const onStart = (e) => {
      isDragging = true;
      hasMoved = false;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      startX = clientX;
      startY = clientY;

      const rect = this.miniPill.getBoundingClientRect();
      initialX = clientX - rect.left;
      initialY = clientY - rect.top;

      this.miniPill.style.cursor = 'grabbing';
      this.miniPill.style.transition = 'none';
    };

    const onMove = (e) => {
      if (!isDragging) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      const dist = Math.hypot(clientX - startX, clientY - startY);
      if (dist > 4) {
        hasMoved = true;
      }

      if (hasMoved) {
        if (e.cancelable) e.preventDefault();
        let newX = clientX - initialX;
        let newY = clientY - initialY;

        // Giới hạn trong màn hình
        const maxW = window.innerWidth - this.miniPill.offsetWidth - 4;
        const maxH = window.innerHeight - this.miniPill.offsetHeight - 4;
        newX = Math.max(4, Math.min(maxW, newX));
        newY = Math.max(4, Math.min(maxH, newY));

        this.miniPill.style.left = `${newX}px`;
        this.miniPill.style.top = `${newY}px`;
        this.miniPill.style.right = 'auto';
        currentX = newX;
        currentY = newY;
      }
    };

    const onEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      this.miniPill.style.cursor = 'grab';
      this.miniPill.style.transition = 'transform 0.15s ease, box-shadow 0.2s ease';

      if (hasMoved) {
        // Đã di chuyển -> Lưu tọa độ
        localStorage.setItem('wm_mini_pill_pos', JSON.stringify({ x: currentX, y: currentY }));
      } else {
        // Nhấp chuột tại chỗ -> Mở bảng điều khiển
        this.toggleMinimize(false);
      }
    };

    // Sự kiện Chuột
    this.miniPill.addEventListener('mousedown', onStart);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);

    // Sự kiện Cảm ứng (Touch / Mobile mode)
    this.miniPill.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  }

  dragStart(e) {
    if (e.target.tagName === 'BUTTON') return;
    this.initialX = e.clientX - this.currentX;
    this.initialY = e.clientY - this.currentY;
    this.isDragging = true;
  }

  drag(e) {
    if (!this.isDragging) return;
    e.preventDefault();
    this.currentX = e.clientX - this.initialX;
    this.currentY = e.clientY - this.initialY;
    this.overlay.style.transform = `translate(${this.currentX}px, ${this.currentY}px)`;
  }

  dragEnd() {
    this.isDragging = false;
  }

  close() {
    if (this.isRunning) this.stop();
    if (this.overlay) this.overlay.remove();
    if (this.miniPill) this.miniPill.remove();
  }

  parsePatterns() {
    return true;
  }

  updateStatus(statusText, type = 'stopped') {
    const pill = document.getElementById('wm-status-pill');
    const text = document.getElementById('wm-status-text');
    if (pill) pill.className = `wm-status-pill ${type}`;
    if (text) text.textContent = statusText;
    this.updateMiniPill();
  }

  addLog(msg, type = 'info') {
    const container = document.getElementById('wm-auto-helper-log');
    if (!container) return;

    const entry = document.createElement('div');
    entry.className = `wm-log-entry ${type}`;
    const time = new Date().toLocaleTimeString('vi-VN');
    entry.textContent = `[${time}] ${msg}`;

    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;
  }

  // ==========================================================================
  // THUẬT TOÁN QUÉT BÀN ĐA NĂNG (UNIVERSAL TABLE SCANNER)
  // Quét cả Document chính và bất kỳ Iframe nào, nhận diện mọi bàn H5 & PC
  // ==========================================================================
  startBackgroundScanner() {
    // Quét ngay lập tức
    this.scanAllTables();

    // Lặp lại mỗi 1.2 giây để cập nhật liên tục thời gian và bàn mới
    if (this.scanInterval) clearInterval(this.scanInterval);
    this.scanInterval = setInterval(() => {
      this.scanAllTables();
    }, 1200);
  }

  scanAllTables() {
    const allFound = [];

    // 1. Quét trong Document hiện tại (nơi bot đang chạy)
    try {
      const mainTables = this.findTablesInDocument(document);
      allFound.push(...mainTables);
    } catch (e) {}

    // 2. Quét trong tất cả Iframe nếu có
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach((iframe, idx) => {
      try {
        const iDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iDoc) {
          const iTables = this.findTablesInDocument(iDoc);
          allFound.push(...iTables);
        }
      } catch (e) {}

      // Đồng thời bắn tín hiệu GET_TABLES tới iframe-injector nếu có
      try {
        iframe.contentWindow?.postMessage({
          action: 'GET_TABLES',
          messageId: ++this.messageIdCounter
        }, '*');
      } catch (e) {}
    });

    // 3. Cập nhật vào tablesMap
    if (allFound.length > 0) {
      allFound.forEach(t => {
        const existing = this.tablesMap.get(t.id);
        if (existing) {
          const oldHist = existing.history || [];
          const newHist = t.history || [];
          if (newHist.length > oldHist.length) {
            for (let i = oldHist.length; i < newHist.length; i++) {
              const prev = newHist.slice(0, i);
              const outcome = newHist[i];
              if (this.aiEngine) {
                this.aiEngine.onRoundCompleted(t.id, t.name || existing.name || t.id, prev, outcome);
              }
            }
            const recentLog = this.recentPredictionsLog.find(p => p.tableId === t.id && p.status === 'PENDING');
            if (recentLog) {
              const newOutcome = newHist[newHist.length - 1];
              recentLog.actualOutcome = newOutcome;
              if (newOutcome === 'T') {
                recentLog.status = 'TIE_PUSH';
              } else if (recentLog.predicted === newOutcome) {
                recentLog.status = 'WIN';
              } else {
                recentLog.status = 'LOSS';
              }
              this.updateAILogTable();
            }
          }
          existing.name = t.name || existing.name;
          existing.betTime = (t.betTime !== undefined && t.betTime !== null) ? t.betTime : existing.betTime;
          if (t.history && t.history.length > 0) existing.history = t.history;
          existing.cardNode = t.cardNode || existing.cardNode;
          existing.playerBtn = t.playerBtn || existing.playerBtn;
          existing.bankerBtn = t.bankerBtn || existing.bankerBtn;
          this.tablesMap.set(t.id, existing);
        } else {
          this.tablesMap.set(t.id, t);
          this.addLog(`✨ Đã phát hiện bàn mới: ${t.name || t.id}`, 'info');
        }
      });
    }

    this.checkPendingBetResults();
    this.updateTableMetricsUI();
  }

  // Trích xuất tên bàn thân thiện (dịch từ ID hoặc đọc DOM)
  extractTableName(box, id) {
    if (box) {
      const titleSelectors = [
        '.gameroom-title', '.table-name', '.title', '.table_title', '.name',
        '[class*="gameroom-title"]', '[class*="table-name"]', '[class*="tableName"]',
        '[class*="title"]', '.gameroom_header', '.header'
      ];
      for (const sel of titleSelectors) {
        try {
          const el = box.querySelector(sel);
          if (el) {
            const txt = (el.innerText || el.textContent || '').trim();
            if (txt && /(?:\([^)]+\))?\s*Bac\s*\d+/i.test(txt)) {
              return txt;
            }
          }
        } catch (e) {}
      }

      try {
        const allSub = box.querySelectorAll('*');
        for (const el of allSub) {
          if (!el.children || el.children.length === 0) {
            const txt = (el.innerText || el.textContent || '').trim();
            if (txt && /^(?:\([^)]+\))?\s*Bac\s*\d+$/i.test(txt)) {
              return txt;
            }
          }
        }
      } catch (e) {}
    }

    if (id) {
      const idMatch = id.match(/groupMultiple_(\d+)_(\d+)/i) || id.match(/_(\d{3,4})$/);
      if (idMatch) {
        const tableNum = parseInt(idMatch[2] || idMatch[1]);
        if (tableNum >= 501 && tableNum <= 599) return `(Sexy)Bac ${tableNum - 500}`;
        if (tableNum >= 101 && tableNum <= 199) return `(Classic)Bac ${tableNum - 100}`;
        if (tableNum >= 201 && tableNum <= 299) return `(Speed)Bac ${tableNum - 200}`;
        if (tableNum >= 301 && tableNum <= 399) return `(Mi)Bac ${tableNum - 300}`;
        if (tableNum >= 601 && tableNum <= 699) return `(Special)Bac ${tableNum - 600}`;
        return `Bac ${tableNum}`;
      }
    }

    return id || 'Bàn Chơi';
  }

  // Trích xuất lịch sử cầu đa tầng (Châu Bàn, Đại Lộ, SVG, Text)
  extractRoadHistory(box) {
    if (!box) return [];

    // LAYER 1: ZhuPan Road (Châu Bàn / Bead Road) - type61..type72
    try {
      const zhuPanNodes = box.querySelectorAll(
        '.zhuPanRoad [class*="type"], .zhuPanRoad *, [class*="zhuPan"] *, [class*="cardroad_item"] [class*="type"], [class*="type6"], [class*="type7"]'
      );
      const zhuPanReg = /\btype[_-]?(6[1-9]|7[0-2])\b/i;
      const validZhuPan = [];

      zhuPanNodes.forEach(el => {
        const classStr = (typeof el.className === 'string') ? el.className : (el.classList ? Array.from(el.classList).join(' ') : '');
        const m = classStr.match(zhuPanReg);
        if (m) {
          const code = parseInt(m[1]);
          if (code >= 61 && code <= 64) validZhuPan.push('B');
          else if (code >= 65 && code <= 68) validZhuPan.push('P');
          else if (code >= 69 && code <= 72) validZhuPan.push('T');
        }
      });

      if (validZhuPan.length > 0) {
        return validZhuPan.slice(-24);
      }
    } catch (e) {}

    // LAYER 2: DaLu Road (Đại Lộ / Big Road) - type1..type12
    try {
      const daLuNodes = box.querySelectorAll(
        '.daLuRoad [class*="type"], .daLuRoad *, [class*="daLu"] *, [class*="type1"], [class*="type2"], [class*="type3"], [class*="type4"], [class*="type5"]'
      );
      const daLuReg = /\btype[_-]?([1-9]|1[0-2])\b/i;
      const validDaLu = [];

      daLuNodes.forEach(el => {
        const classStr = (typeof el.className === 'string') ? el.className : (el.classList ? Array.from(el.classList).join(' ') : '');
        const m = classStr.match(daLuReg);
        if (m) {
          const code = parseInt(m[1]);
          if (code >= 1 && code <= 4) validDaLu.push('B');
          else if (code >= 5 && code <= 8) validDaLu.push('P');
          else if (code >= 9 && code <= 12) validDaLu.push('T');
        }
      });

      if (validDaLu.length > 0) {
        return validDaLu.slice(-24);
      }
    } catch (e) {}

    // LAYER 3: Semantic classes (banker, player, zhuang, xian, tie)
    try {
      const roadItems = box.querySelectorAll('[class*="road"] [class*="dot"], [class*="road"] [class*="item"], [class*="cardroad"] > *');
      const validSemantic = [];
      roadItems.forEach(el => {
        const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
        if (cls.includes('banker') || cls.includes('zhuang') || cls.includes('red')) {
          validSemantic.push('B');
        } else if (cls.includes('player') || cls.includes('xian') || cls.includes('blue')) {
          validSemantic.push('P');
        } else if (cls.includes('tie') || cls.includes('he') || cls.includes('green')) {
          validSemantic.push('T');
        }
      });
      if (validSemantic.length > 0) return validSemantic.slice(-24);
    } catch (e) {}

    // LAYER 4: SVG circles / rects / paths
    try {
      const svgDots = box.querySelectorAll('svg circle, svg rect, svg path');
      const validSvg = [];
      svgDots.forEach(dot => {
        const fill = (dot.getAttribute ? dot.getAttribute('fill') : '') || '';
        const stroke = (dot.getAttribute ? dot.getAttribute('stroke') : '') || '';
        const cls = (dot.getAttribute ? dot.getAttribute('class') : '') || '';
        const f = (fill + ' ' + stroke + ' ' + cls).toLowerCase();

        if (f.includes('red') || f.includes('#ef') || f.includes('#b9') || f.includes('#dc') || f.includes('banker')) {
          validSvg.push('B');
        } else if (f.includes('blue') || f.includes('#3b') || f.includes('#1d') || f.includes('#25') || f.includes('player')) {
          validSvg.push('P');
        } else if (f.includes('green') || f.includes('#10') || f.includes('#16') || f.includes('tie')) {
          validSvg.push('T');
        }
      });
      if (validSvg.length > 0) return validSvg.slice(-24);
    } catch (e) {}

    // LAYER 5: Text nodes 'B', 'P', 'T'
    try {
      const textNodes = box.querySelectorAll('.zhuPanRoad *, .daLuRoad *, [class*="road"] *');
      const validText = [];
      textNodes.forEach(node => {
        if (!node.children || node.children.length === 0) {
          const txt = (node.innerText || node.textContent || '').trim();
          if (txt === 'B' || txt === '庄') validText.push('B');
          else if (txt === 'P' || txt === '闲') validText.push('P');
          else if (txt === 'T' || txt === '和') validText.push('T');
        }
      });
      if (validText.length > 0) return validText.slice(-24);
    } catch (e) {}

    return [];
  }

  // Quét bên trong 1 Document cụ thể
  findTablesInDocument(doc) {
    const results = [];

    // PHƯƠNG ÁN 1 (ƯU TIÊN): Nhận diện bàn Baccarat giao diện H5/Mobile
    const titleRegex = /(?:\([^)]+\))?\s*Bac\s*\d+/i;
    const allNodes = doc.querySelectorAll('*');

    for (const el of allNodes) {
      if (el.children.length <= 2) {
        const txt = (el.innerText || el.textContent || '').trim();
        if (txt && titleRegex.test(txt) && txt.length <= 25) {
          let card = el;
          let foundCard = null;

          for (let step = 0; step < 8; step++) {
            if (!card || card === doc.body) break;
            card = card.parentElement;
            if (!card) break;

            const cardText = card.innerText || card.textContent || '';
            if (/Player/i.test(cardText) && /Banker/i.test(cardText)) {
              const matchTitles = cardText.match(/(?:\([^)]+\))?\s*Bac\s*\d+/gi) || [];
              if (matchTitles.length === 1) {
                foundCard = card;
              } else if (matchTitles.length > 1) {
                break;
              }
            }
          }

          if (foundCard && !results.some(r => r.cardNode === foundCard)) {
            const tableData = this.extractH5TableData(foundCard, txt);
            if (tableData) results.push(tableData);
          }
        }
      }
    }

    // PHƯƠNG ÁN 2 (FALLBACK): Bàn giao diện PC (#pc_multi_bet_tablebox)
    if (results.length === 0) {
      const pcBoxes = doc.querySelectorAll('#pc_multi_bet_tablebox .gameroom-box.multiSelectContentItem, [class*="gameroom-box"]');
      pcBoxes.forEach(box => {
        const id = box.id || ('table_' + Math.random().toString(36).substr(2, 6));
        let betTime = Number(box.getAttribute('data-bettime')) || 0;
        if (!betTime) {
          try {
            const timeEl = box.querySelector('.time, .bet-time, .count-down, [class*="time"], [class*="countdown"]');
            if (timeEl) {
              const m = (timeEl.innerText || timeEl.textContent || '').match(/(\d{1,2})\s*s?/i);
              if (m) betTime = parseInt(m[1]);
            }
          } catch (e) {}
        }
        if (!betTime) {
          const m = (box.innerText || '').match(/\b(\d{1,2})\s*s\b/i);
          if (m) betTime = parseInt(m[1]);
        }

        const friendlyName = this.extractTableName(box, id);
        const history = this.extractRoadHistory(box);

        const docOwner = box.ownerDocument || doc || document;
        const playerBtn = box.querySelector(`[id$="_betAreaPlayer"], .bet-player, [class*="bet-player"]`) || docOwner.getElementById(id + "_betAreaPlayer");
        const bankerBtn = box.querySelector(`[id$="_betAreaBanker"], .bet-banker, [class*="bet-banker"]`) || docOwner.getElementById(id + "_betAreaBanker");

        results.push({
          id: id,
          name: friendlyName,
          betTime: betTime,
          history: history,
          cardNode: box,
          playerBtn: playerBtn,
          bankerBtn: bankerBtn
        });
      });
    }

    return results;
  }

  // Trích xuất chi tiết bàn từ thẻ H5
  extractH5TableData(cardNode, rawTitle) {
    const cleanId = rawTitle.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

    // 1. Tìm nút cược Player & Banker
    let playerBtn = null;
    let bankerBtn = null;

    const allDescendants = cardNode.querySelectorAll('*');
    for (const el of allDescendants) {
      if (el.children.length <= 2) {
        const t = (el.innerText || el.textContent || '').trim();
        if (/^Player/i.test(t) || t === '1:1') {
          playerBtn = el.closest('button, div[class*="bet"], div') || el;
        }
        if (/^Banker/i.test(t) || t === '1:0.95') {
          bankerBtn = el.closest('button, div[class*="bet"], div') || el;
        }
      }
    }

    // 2. Tìm thời gian đếm ngược (betTime)
    let betTime = 0;
    const timeEl = cardNode.querySelector('.time, .bet-time, .count-down, [class*="time"], [class*="countdown"], [class*="second"]');
    if (timeEl) {
      const m = (timeEl.innerText || timeEl.textContent || '').match(/(\d{1,2})\s*s?/i);
      if (m) betTime = parseInt(m[1]);
    }
    if (!betTime) {
      const timeMatch = (cardNode.innerText || '').match(/\b(\d{1,2})\s*s\b/i);
      if (timeMatch) betTime = parseInt(timeMatch[1]);
    }
    if (!betTime) {
      const dataTime = cardNode.getAttribute('data-bettime') || cardNode.getAttribute('data-time');
      if (dataTime) betTime = parseInt(dataTime);
    }

    // Nếu đang đóng cược / chia bài / chờ ván mới thì betTime = 0
    if (/(ngừng cược|no more bet|đang chia|chờ ván mới|dealing|settle)/i.test(cardNode.innerText || '')) {
      betTime = 0;
    }

    // 3. Lấy lịch sử cầu đa tầng
    const history = this.extractRoadHistory(cardNode);

    return {
      id: cleanId,
      name: rawTitle,
      betTime: betTime,
      history: history,
      cardNode: cardNode,
      playerBtn: playerBtn,
      bankerBtn: bankerBtn
    };
  }

  // ==========================================================================
  // CẬP NHẬT CHỈ SỐ BÀN LÊN UI
  // ==========================================================================
  updateTableMetricsUI() {
    const totalCount = this.tablesMap.size;
    let openCount = 0;

    for (const t of this.tablesMap.values()) {
      if (t.betTime > 0) openCount++;
    }

    const metricTables = document.getElementById('wm-metric-tables');
    if (metricTables) metricTables.textContent = totalCount;

    const badgeTables = document.getElementById('wm-tab-badge-tables');
    if (badgeTables) badgeTables.textContent = totalCount;

    const liveCount = document.getElementById('wm-live-count');
    if (liveCount) liveCount.textContent = totalCount;

    const liveOpenCount = document.getElementById('wm-live-open-count');
    if (liveOpenCount) liveOpenCount.textContent = openCount;

    this.updateMiniPill();
    this.renderTablesList();
  }

  // Gắn sự kiện kéo chuột mượt mà (Drag-to-scroll) & lăn chuột cuộn ngang
  attachRoadScrollHandlers(dotsEl) {
    if (!dotsEl || dotsEl.dataset.scrollAttached) return;
    dotsEl.dataset.scrollAttached = 'true';

    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;

    dotsEl.addEventListener('mousedown', (e) => {
      isDown = true;
      dotsEl.classList.add('is-dragging');
      startX = e.pageX - dotsEl.offsetLeft;
      scrollLeft = dotsEl.scrollLeft;
    });

    window.addEventListener('mouseup', () => {
      if (isDown) {
        isDown = false;
        dotsEl.classList.remove('is-dragging');
      }
    });

    dotsEl.addEventListener('mouseleave', () => {
      isDown = false;
      dotsEl.classList.remove('is-dragging');
    });

    dotsEl.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - dotsEl.offsetLeft;
      const walk = (x - startX) * 1.6;
      dotsEl.scrollLeft = scrollLeft - walk;
    });

    // Lăn chuột dọc để cuộn ngang mượt mà
    dotsEl.addEventListener('wheel', (e) => {
      if (dotsEl.classList.contains('wm-wrap-mode')) return;
      if (e.deltaY !== 0) {
        e.preventDefault();
        dotsEl.scrollLeft += (e.deltaY * 0.9);
      }
    }, { passive: false });
  }

  renderTablesList() {
    const container = document.getElementById('wm-tables-list');
    if (!container) return;

    if (this.tablesMap.size === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:30px 10px; color:#64748b; font-size:12px;">
          Chưa tìm thấy bàn chơi.<br>Hãy mở chế độ <b>"Nhiều bàn"</b> hoặc bấm <b>"Cuộn Quét Toàn Bàn"</b>.
        </div>
      `;
      return;
    }

    // Xóa thông báo chờ nếu có
    const emptyMsg = container.querySelector('div[style*="text-align:center"]');
    if (emptyMsg) {
      container.innerHTML = '';
    }

    const tables = Array.from(this.tablesMap.values());
    const currentTableIds = new Set(tables.map(t => t.id));

    // 1. Dọn dẹp card của các bàn không còn tồn tại
    Array.from(container.children).forEach(child => {
      const cardId = child.getAttribute('data-table-id');
      if (cardId && !currentTableIds.has(cardId)) {
        child.remove();
      }
    });

    // 2. Cập nhật in-place hoặc tạo mới từng card (giữ nguyên vị trí cuộn của người dùng)
    tables.forEach(t => {
      let timeClass = 'closed';
      let timeText = 'Chờ';
      if (t.betTime > 10) {
        timeClass = 'green';
        timeText = `${t.betTime}s`;
      } else if (t.betTime > 4) {
        timeClass = 'yellow';
        timeText = `${t.betTime}s`;
      } else if (t.betTime > 0) {
        timeClass = 'red';
        timeText = `${t.betTime}s`;
      }

      let roadDotsHtml = '';
      let statsHtml = '';
      const historyLen = t.history ? t.history.length : 0;
      const historySig = t.history ? t.history.join('') : '';

      if (historyLen > 0) {
        let bCount = 0;
        let pCount = 0;
        let tCount = 0;

        roadDotsHtml = t.history.map((res, idx) => {
          if (res === 'B') bCount++;
          else if (res === 'P') pCount++;
          else if (res === 'T') tCount++;

          const isLatest = idx === historyLen - 1 ? 'latest' : '';
          const cls = res === 'B' ? 'banker' : (res === 'P' ? 'player' : 'tie');
          const title = res === 'B' ? 'Banker' : (res === 'P' ? 'Player' : 'Hòa (Tie)');
          return `<div class="wm-road-dot ${cls} ${isLatest}" title="${title}">${res}</div>`;
        }).join('');

        statsHtml = `
          <span style="color:#f87171;">🔴 B: ${bCount}</span>
          <span style="color:#60a5fa;">🔵 P: ${pCount}</span>
          <span style="color:#34d399;">🟢 T: ${tCount}</span>
          <span style="color:#94a3b8; margin-left:auto; font-size:9px;">(Tổng: ${historyLen})</span>
        `;
      } else {
        roadDotsHtml = '<span style="font-size:10px; color:#94a3b8; font-style:italic;">⏳ Đang đọc chuỗi cầu... (chờ ván mới hoặc cuộn bàn)</span>';
        statsHtml = '<span style="color:#64748b; font-size:9px;">Chưa có thống kê</span>';
      }

      const lastRes = historyLen > 0 ? t.history[historyLen - 1] : null;
      let lastResBadge = '<span style="color:#64748b;">Chưa có</span>';
      if (lastRes === 'B') lastResBadge = '<b style="color:#f87171;">🔴 Banker</b>';
      else if (lastRes === 'P') lastResBadge = '<b style="color:#60a5fa;">🔵 Player</b>';
      else if (lastRes === 'T') lastResBadge = '<b style="color:#34d399;">🟢 Hòa (Tie)</b>';

      let card = container.querySelector(`[data-table-id="${t.id}"]`);

      if (!card) {
        // TẠO MỚI CARD CHO BÀN NÀY
        card = document.createElement('div');
        card.className = `wm-table-card ${t.betTime > 5 && t.betTime < 25 ? 'active-betting' : ''}`;
        card.setAttribute('data-table-id', t.id);
        card.dataset.sig = historySig;

        const isWrapGlobal = this.roadViewMode === 'wrap';

        card.innerHTML = `
          <div class="wm-table-card-header">
            <div class="wm-table-title">
              <span>🎲</span>
              <span style="font-weight:700;">${t.name || t.id}</span>
            </div>
            <div style="display:flex; gap:6px; align-items:center;">
              <button class="wm-road-mode-btn" data-table="${t.id}" title="Chuyển chế độ: 1 Hàng Cuộn / 2 Hàng Xem Hết">
                ${isWrapGlobal ? '↔️ Cuộn' : '▦ 2 Hàng'}
              </button>
              <div class="wm-bettime-badge ${timeClass}">
                ⏱️ ${timeText}
              </div>
            </div>
          </div>
          <div class="wm-road-dots ${isWrapGlobal ? 'wm-wrap-mode' : ''}">
            ${roadDotsHtml}
          </div>
          <div class="wm-road-stats">
            ${statsHtml}
          </div>
          <div class="wm-table-footer">
            <span style="font-size:10px; color:#64748b;">ID: ${t.id}</span>
            <span style="font-size:11px;">Ván gần nhất: <span class="wm-footer-last-badge">${lastResBadge}</span></span>
          </div>
        `;

        container.appendChild(card);

        const dotsEl = card.querySelector('.wm-road-dots');
        if (dotsEl) {
          this.attachRoadScrollHandlers(dotsEl);
          // Tự động cuộn sang phải để ván MỚI NHẤT luôn hiển thị ngay lập tức
          requestAnimationFrame(() => {
            dotsEl.scrollLeft = dotsEl.scrollWidth;
          });
        }

        const modeBtn = card.querySelector('.wm-road-mode-btn');
        if (modeBtn) {
          modeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (dotsEl) {
              const isWrap = dotsEl.classList.toggle('wm-wrap-mode');
              modeBtn.textContent = isWrap ? '↔️ Cuộn' : '▦ 2 Hàng';
              if (!isWrap) {
                dotsEl.scrollLeft = dotsEl.scrollWidth;
              }
            }
          });
        }

      } else {
        // CẬP NHẬT IN-PLACE TRÊN CARD ĐÃ CÓ (KHÔNG LÀM MẤT VỊ TRÍ CUỘN CỦA NGƯỜI DÙNG)
        // 1. Cập nhật thời gian đếm ngược
        const badge = card.querySelector('.wm-bettime-badge');
        if (badge) {
          badge.className = `wm-bettime-badge ${timeClass}`;
          badge.textContent = `⏱️ ${timeText}`;
        }

        // 2. Cập nhật trạng thái active betting
        if (t.betTime > 5 && t.betTime < 25) {
          card.classList.add('active-betting');
        } else {
          card.classList.remove('active-betting');
        }

        // 3. Chỉ vẽ lại cầu khi thực sự có ván mới
        if (card.dataset.sig !== historySig) {
          card.dataset.sig = historySig;

          const dotsEl = card.querySelector('.wm-road-dots');
          if (dotsEl) {
            dotsEl.innerHTML = roadDotsHtml;
            // Tự động cuộn sang phải để ván mới nhất luôn trong tầm mắt
            if (!dotsEl.classList.contains('wm-wrap-mode')) {
              dotsEl.scrollLeft = dotsEl.scrollWidth;
            }
          }

          const statsEl = card.querySelector('.wm-road-stats');
          if (statsEl) {
            statsEl.innerHTML = statsHtml;
          }

          const footerLast = card.querySelector('.wm-footer-last-badge');
          if (footerLast) {
            footerLast.innerHTML = lastResBadge;
          }
        }
      }
    });
  }

  // Cuộn nạp toàn bộ danh sách bàn (kích hoạt lazy loading)
  forceScrollAllTables() {
    this.addLog('Đang kích hoạt cuộn nạp toàn bộ danh sách bàn...', 'info');

    // Tìm các thẻ có thanh cuộn
    const allDivs = Array.from(document.querySelectorAll('*'));
    const scrollers = allDivs.filter(el => {
      try {
        const style = window.getComputedStyle(el);
        return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 50;
      } catch (e) {
        return false;
      }
    });

    if (scrollers.length > 0) {
      scrollers.forEach(s => {
        const oldTop = s.scrollTop;
        s.scrollTo({ top: s.scrollHeight, behavior: 'smooth' });
        setTimeout(() => {
          s.scrollTo({ top: oldTop, behavior: 'smooth' });
          this.scanAllTables();
        }, 600);
      });
    } else {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        this.scanAllTables();
      }, 600);
    }

    setTimeout(() => {
      this.scanAllTables();
      this.addLog(`Đã quét xong! Nắm được tổng cộng ${this.tablesMap.size} bàn.`, 'success');
    }, 1200);
  }

  setControlsLocked(locked) {
    if (!this.overlay) return;
    const chipSelect = document.getElementById('wm-chip-select');
    if (chipSelect) chipSelect.disabled = locked;

    const maxTotalBetInput = document.getElementById('wm-max-total-bet');
    if (maxTotalBetInput) maxTotalBetInput.disabled = locked;

    const maxConcurrentInput = document.getElementById('wm-max-concurrent-bets');
    if (maxConcurrentInput) maxConcurrentInput.disabled = locked;

    const maxTablesInput = document.getElementById('wm-max-tables');
    if (maxTablesInput) maxTablesInput.disabled = locked;

    const paperBtn = document.getElementById('wm-mode-paper-btn');
    const realBtn = document.getElementById('wm-mode-real-btn');
    if (paperBtn) paperBtn.disabled = locked;
    if (realBtn) realBtn.disabled = locked;

    const resetBtn = document.getElementById('wm-ai-reset-memory-btn');
    if (resetBtn) resetBtn.disabled = locked;

    const exportBtn = document.getElementById('wm-ai-export-btn');
    if (exportBtn) exportBtn.disabled = locked;

    const importBtn = document.getElementById('wm-ai-import-btn');
    if (importBtn) importBtn.disabled = locked;
  }

  // ==========================================================================
  // BẮT ĐẦU / DỪNG TỰ ĐỘNG CƯỢC
  // ==========================================================================
  start() {
    if (this.isRunning) return;

    // Ràng buộc hạn mức tổng tiền cược
    if (this.maxTotalBet > 0 && this.stats.totalAmount >= this.maxTotalBet) {
      alert(`⚠️ Tổng tiền cược hiện tại (${this.stats.totalAmount.toLocaleString('vi-VN')}) đã đạt hoặc vượt hạn mức tối đa (${this.maxTotalBet.toLocaleString('vi-VN')})!\n\nVui lòng nâng hạn mức cược hoặc xóa lịch sử cược trước khi bắt đầu.`);
      this.addLog(`❌ Không thể bắt đầu: Đã đạt hạn mức cược ${this.stats.totalAmount.toLocaleString('vi-VN')} / ${this.maxTotalBet.toLocaleString('vi-VN')}`, 'error');
      return;
    }

    if (!this.parsePatterns()) return;

    this.isRunning = true;
    document.getElementById('wm-start-btn').disabled = true;
    document.getElementById('wm-stop-btn').disabled = false;
    this.setControlsLocked(true);
    this.updateStatus('ĐANG TỰ ĐỘNG CƯỢC', 'running');
    this.addLog(`=== BẮT ĐẦU AUTO BET (Đang quét ${this.tablesMap.size} bàn) ===`, 'success');

    // Chạy vòng lặp đánh giá cược mỗi 1.5 giây
    if (this.bettingLoopInterval) clearInterval(this.bettingLoopInterval);
    this.bettingLoopInterval = setInterval(() => {
      this.evaluateAllTablesForBetting();
    }, 1500);
  }

  stop() {
    this.isRunning = false;
    if (this.bettingLoopInterval) clearInterval(this.bettingLoopInterval);
    document.getElementById('wm-start-btn').disabled = false;
    document.getElementById('wm-stop-btn').disabled = true;
    this.setControlsLocked(false);
    this.updateStatus('ĐÃ DỪNG', 'stopped');
    this.addLog('=== ĐÃ DỪNG TỰ ĐỘNG CƯỢC ===', 'error');
  }

  async evaluateAllTablesForBetting() {
    if (!this.isRunning) return;

    // Ràng buộc hạn mức tổng tiền cược: tự động dừng nếu chạm trần
    if (this.maxTotalBet > 0 && this.stats.totalAmount >= this.maxTotalBet) {
      this.stop();
      this.addLog(`🛑 [HẠN MỨC] ĐÃ ĐẠT HẠN MỨC TỔNG TIỀN CƯỢC (${this.stats.totalAmount.toLocaleString('vi-VN')} / ${this.maxTotalBet.toLocaleString('vi-VN')}). Bot tự động dừng!`, 'error');
      return;
    }

    // Ràng buộc cược đồng thời: nếu đã đủ số lệnh chờ kết quả, tạm ngưng cược thêm để đợi kết quả
    if (this.maxConcurrentBets > 0 && this.getPendingBetsCount() >= this.maxConcurrentBets) {
      return;
    }

    if (this.isEvaluatingAllTables) return;

    this.isEvaluatingAllTables = true;
    try {
      const tables = Array.from(this.tablesMap.values()).slice(0, this.maxTables);
      for (const table of tables) {
        if (!this.isRunning) break;
        await this.evaluateSingleTable(table);
      }
    } finally {
      this.isEvaluatingAllTables = false;
    }
  }

  async evaluateSingleTable(table) {
    const tableId = table.id;
    const history = table.history;
    const betTime = table.betTime;

    if (!history || history.length < 2) return;

    // LỚP 1: Chống cược đè khi đang thực thi trên cùng bàn này (In-flight Mutex)
    if (this.activeBettingTables.has(tableId)) {
      return;
    }

    const state = this.tableStates[tableId] || {
      lastHistorySignature: '',
      betPlaced: false,
      lastBetTimestamp: 0
    };
    const currentSignature = history.join('');

    // Nếu ván mới đã kết thúc (chuỗi lịch sử có thêm kết quả mới) -> Mở lại quyền cược ván tiếp theo
    if (currentSignature !== state.lastHistorySignature) {
      state.lastHistorySignature = currentSignature;
      state.betPlaced = false;
    }

    // LỚP 2: Chống cược trùng lặp (Pending Bet Check)
    // Nếu bàn này đang có 1 lệnh cược ở trạng thái PENDING chưa có kết quả -> Tuyệt đối không cược thêm!
    const hasPendingBet = this.betHistory.some(
      item => item.tableId === tableId && item.result === 'PENDING'
    );
    if (hasPendingBet) {
      return;
    }

    // LỚP 3: Cooldown an toàn giữa 2 lần cược trên cùng bàn (tối thiểu 10 giây)
    const now = Date.now();
    if (state.lastBetTimestamp && (now - state.lastBetTimestamp < 10000)) {
      return;
    }

    // LỚP 4: KIỂM TRA CHẶT CHẼ THỜI GIAN ĐẶT CƯỢC (BETTING TIME):
    // - Chỉ cược khi thời gian đếm ngược còn từ 5s đến 28s.
    // - TUYỆT ĐỐI BỎ QUA khi betTime < 5s (sát giờ khóa cược, tránh bị trễ nhịp hoặc sàn từ chối).
    // - TUYỆT ĐỐI BỎ QUA khi betTime === 0 (bàn đang lật bài / chia bài / chưa mở cược).
    const isBetTimeValid = (typeof betTime === 'number' && betTime >= 5 && betTime <= 28);
    const canBet = isBetTimeValid && !state.betPlaced;

    if (canBet && this.aiEngine) {
      // 1. Gọi Online Adaptive Multi-Model AI Engine dự đoán
      const prediction = this.aiEngine.generatePrediction(tableId, table.name || tableId, history);

      if (prediction && prediction.predicted && prediction.predicted !== 'PASS') {
        const targetSide = prediction.predicted; // 'B' hoặc 'P'
        const sideName = targetSide === 'B' ? 'Banker' : 'Player';
        const confPercent = Math.round((prediction.confidence || 0.5) * 100);

        if (prediction.shouldBet) {
          // Ràng buộc cược đồng thời: Kiểm tra số lệnh cược đang chạy
          const pendingCount = this.getPendingBetsCount();
          if (this.maxConcurrentBets > 0 && pendingCount >= this.maxConcurrentBets) {
            // Chưa cược được do đầy slot đồng thời -> không đánh dấu betPlaced để thử lại khi có slot
            return;
          }

          const betAmount = this.actualGameChip || this.selectedChip || 10;
          if (this.maxTotalBet > 0 && (this.stats.totalAmount + betAmount) > this.maxTotalBet) {
            this.stop();
            this.addLog(`🛑 [HẠN MỨC] Lệnh cược ${betAmount} sẽ vượt hạn mức tổng cược (${this.stats.totalAmount.toLocaleString('vi-VN')} + ${betAmount} > ${this.maxTotalBet.toLocaleString('vi-VN')}). Bot tự động dừng!`, 'error');
            return;
          }

          // Đánh dấu đã cược ngay khi lệnh cược được duyệt
          state.betPlaced = true;
          state.lastBetTimestamp = now;
          this.tableStates[tableId] = state;

          // Thêm vào nhật ký Explainability trên dashboard
          this.addAIPredictionToLog(prediction);

          // CHẾ ĐỘ REAL BET: Khóa bàn vào activeBettingTables để ngăn chặn tuyệt đối cược đúp
          this.activeBettingTables.add(tableId);
          try {
            this.addLog(`⚡ [AI REAL BET] ${prediction.tableName} (Còn ${betTime}s) ➔ Cược ${sideName} (${confPercent}%) | ${prediction.rationale}`, 'success');
            await this.executeBet(table, targetSide, prediction.rationale);
          } finally {
            this.activeBettingTables.delete(tableId);
          }
        } else {
          // CHẾ ĐỘ PAPER TRADING (MẶC ĐỊNH): Mô phỏng an toàn, tuyệt đối không đặt tiền thật!
          state.betPlaced = true;
          state.lastBetTimestamp = now;
          this.tableStates[tableId] = state;
          this.addAIPredictionToLog(prediction);
          this.addLog(`🤖 [AI PAPER] ${prediction.tableName} (Còn ${betTime}s) ➔ Dự đoán ${sideName} (${confPercent}%) | ${prediction.rationale}`, 'info');
        }
      }
    }

    this.tableStates[tableId] = state;
  }

  matchesPattern(historyArray, condition) {
    if (historyArray.length < condition.length) return false;
    const endSlice = historyArray.slice(-condition.length).join('');
    if (endSlice !== condition) return false;

    const prevIndex = historyArray.length - condition.length - 1;
    if (prevIndex >= 0) {
      if (historyArray[prevIndex] === condition[0]) {
        return false;
      }
    }
    return true;
  }

  // ==========================================================================
  // BỘ TỰ ĐỘNG CHỌN CHIP TRÊN BÀN GAME WM CASINO
  // Hỗ trợ XPath chính xác do User cung cấp:
  // Chip 10: (//div[@name='10'])[1]
  // Chip 20: (//div[@name='20'])[1]
  // Chip 50: (//div[@name='50'])[1]
  // ==========================================================================
  selectGameChip(chipValue) {
    const chipStr = String(chipValue);
    try {
      const allIframes = Array.from(document.querySelectorAll('iframe'));
      // Chỉ gửi tới các iframe đang hiển thị thực tế (bỏ qua iframe display: none, width/height = 0)
      const visibleIframes = allIframes.filter((ifr) => {
        try {
          const style = window.getComputedStyle(ifr);
          return style.display !== 'none' && style.visibility !== 'hidden' && ifr.offsetWidth > 0 && ifr.offsetHeight > 0;
        } catch (e) {
          return false;
        }
      });

      const targets = visibleIframes.length > 0 ? visibleIframes : allIframes;
      targets.forEach((ifr) => {
        try {
          ifr.contentWindow?.postMessage({
            action: 'SELECT_CHIP',
            chip: chipStr,
            messageId: ++this.messageIdCounter
          }, '*');
        } catch (e) {}
      });
    } catch (e) {}
    return true;
  }

  simulateRealClick(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    } catch (e) {}
    try {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      el.click();
    } catch (err) {
      try { el.click(); } catch (e) {}
    }
  }

  findValidVisibleChip(doc, chipStr) {
    if (!doc) return null;

    const variants = [chipStr];
    if (chipStr === '1000') variants.push('1k', '1K');
    if (chipStr === '5000') variants.push('5k', '5K');
    if (chipStr === '10000') variants.push('10k', '10K');
    if (chipStr === '20000') variants.push('20k', '20K');
    if (chipStr === '50000') variants.push('50k', '50K');

    // 1. Khung chuẩn của WM: #mult_chips_box hoặc .chip_box
    try {
      const box = doc.getElementById('mult_chips_box') || doc.querySelector('.chip_box');
      if (box) {
        for (const val of variants) {
          const chip = box.querySelector(`[name="${val}"], .chip_b_${val}`);
          if (chip) return chip;
        }
      }
    } catch (e) {}

    // 2. XPath chuẩn người dùng cung cấp: (//div[@name='${val}'])[1]
    for (const val of variants) {
      try {
        const xpath = `(//div[@name='${val}'])[1]`;
        const res = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (res && res.singleNodeValue) return res.singleNodeValue;
      } catch (e) {}

      try {
        const xpath = `(//*[@name='${val}'])[1]`;
        const res = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (res && res.singleNodeValue) return res.singleNodeValue;
      } catch (e) {}
    }

    // 3. CSS querySelector
    for (const val of variants) {
      try {
        const el = doc.querySelector(`.chip_item[name="${val}"], div[name="${val}"], [name="${val}"], .chip_b_${val}`);
        if (el) return el;
      } catch (e) {}
    }

    return null;
  }

  triggerFullClick(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    } catch (e) {}
    try {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    } catch (e) {}
    try {
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    } catch (e) {}
    try {
      el.click();
    } catch (err) {}
  }

  async executeBet(table, pattern, reason = '') {
    const betTarget = typeof pattern === 'string' ? pattern : (pattern.bet || 'B');
    const betTargetName = betTarget === 'B' ? 'Banker' : 'Player';
    const currentChip = this.actualGameChip || this.selectedChip;
    const amount = currentChip;

    this.addLog(`Đang cược chip ${currentChip} vào ${betTargetName} (${table.name || table.id})...`, 'info');

    let betSuccess = false;

    try {
      // 1. Cuộn bàn vào tầm nhìn
      if (table.cardNode) {
        table.cardNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await new Promise(r => setTimeout(r, 200));
      }

      // 2. Xác định nút cược tương ứng
      const targetBtn = betTarget === 'B' ? table.bankerBtn : table.playerBtn;

      if (targetBtn) {
        this.triggerFullClick(targetBtn);

        // Bấm xác nhận cược nếu có nút confirm
        if (table.cardNode) {
          const confirmBtn = table.cardNode.querySelector('[id*="confirm"], .confirm, .btn-confirm, [class*="confirm"], [class*="ok"]');
          if (confirmBtn) {
            this.triggerFullClick(confirmBtn);
          }
        }

        betSuccess = true;
        this.addLog(`✅ Đã đặt cược ${amount} vào ${betTargetName} (${table.name || table.id})!`, 'success');
      } else {
        this.addLog(`Không tìm thấy nút cược ${betTargetName} trên bàn ${table.name || table.id}!`, 'warning');
      }

    } catch (err) {
      this.addLog(`Lỗi cược: ${err.message}`, 'error');
    }

    // Ghi vào Lịch sử cược
    const historyItem = {
      id: 'bet_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      time: new Date().toLocaleTimeString('vi-VN'),
      timestamp: Date.now(),
      table: table.name || table.id,
      tableId: table.id,
      bet: betTarget,
      chip: currentChip,
      amount: amount,
      pattern: reason || (typeof pattern === 'string' ? `AI-${betTarget}` : `${pattern.condition}=${pattern.bet}`),
      success: betSuccess,
      historyLengthAtBet: (table.history || []).length,
      historySigAtBet: (table.history || []).join(''),
      result: betSuccess ? 'PENDING' : 'FAILED',
      roundOutcome: null,
      profit: 0
    };

    this.betHistory.unshift(historyItem);
    this.recalculateStats();
    this.saveBetHistory();
    this.renderBetHistory();

    // Kiểm tra nếu tổng tiền cược đã đạt hạn mức tối đa thì lập tức dừng bot
    if (this.isRunning && this.maxTotalBet > 0 && this.stats.totalAmount >= this.maxTotalBet) {
      this.stop();
      this.addLog(`🛑 [HẠN MỨC] ĐÃ ĐẠT HẠN MỨC TỔNG TIỀN CƯỢC (${this.stats.totalAmount.toLocaleString('vi-VN')} / ${this.maxTotalBet.toLocaleString('vi-VN')}). Bot tự động dừng!`, 'error');
    }
  }

  // ==========================================================================
  // BỘ KIỂM TRA & TÍNH KẾT QUẢ THẮNG / THUA TỰ ĐỘNG
  // ==========================================================================
  checkPendingBetResults() {
    let hasChanges = false;

    this.betHistory.forEach(item => {
      // Chỉ xét các lệnh đang đợi kết quả
      if (item.result !== 'PENDING' || !item.success) return;

      const table = this.tablesMap.get(item.tableId);
      if (!table || !table.history || table.history.length === 0) return;

      const currentSig = table.history.join('');
      // Nếu chuỗi cầu chưa thay đổi gì so với lúc đặt cược -> ván chưa có kết quả
      if (currentSig === item.historySigAtBet) {
        // Quá 3 phút không có kết quả -> đánh dấu Hết giờ
        if (Date.now() - item.timestamp > 180000) {
          item.result = 'TIMEOUT';
          item.profit = 0;
          hasChanges = true;
        }
        return;
      }

      // Ván đã ra kết quả mới! Xác định outcome
      let outcome = null;
      if (typeof item.historyLengthAtBet === 'number' && table.history.length > item.historyLengthAtBet) {
        outcome = table.history[item.historyLengthAtBet];
      } else {
        // Trường hợp đã chạm trần slice hoặc độ dài bằng nhau, lấy ván mới nhất vừa ra
        outcome = table.history[table.history.length - 1];
      }

      if (!outcome) return;

      item.roundOutcome = outcome;

      if (outcome === 'T') {
        item.result = 'TIE';
        item.profit = 0;
        this.addLog(`🟡 [HÒA TIỀN] ${item.table}: Cược ${item.bet === 'B' ? 'Banker' : 'Player'} ➔ Kết quả HÒA (Tie) | Hoàn 0`, 'info');
      } else if (outcome === item.bet) {
        item.result = 'WIN';
        // Tiền thắng: Player ăn 1:1, Banker ăn 1:0.95
        item.profit = item.bet === 'B' ? Math.round(item.amount * 0.95) : item.amount;
        this.addLog(`🎉 [THẮNG CƯỢC] ${item.table}: Cược ${item.bet === 'B' ? 'Banker' : 'Player'} ➔ Ra ${outcome} | +${item.profit}`, 'success');
      } else {
        item.result = 'LOSS';
        item.profit = -item.amount;
        this.addLog(`💥 [THUA CƯỢC] ${item.table}: Cược ${item.bet === 'B' ? 'Banker' : 'Player'} ➔ Ra ${outcome} | -${item.amount}`, 'error');
      }

      hasChanges = true;
    });

    if (hasChanges) {
      this.recalculateStats();
      this.saveBetHistory();
      this.renderBetHistory();
    }
  }

  getPendingBetsCount() {
    const pendingTableIds = new Set(
      this.betHistory
        .filter(item => item.result === 'PENDING' && item.success !== false)
        .map(item => item.tableId)
    );
    for (const tid of this.activeBettingTables) {
      pendingTableIds.add(tid);
    }
    return pendingTableIds.size;
  }

  updateLimitProgressUI() {
    const progressText = document.getElementById('wm-limit-progress-text');
    const percentEl = document.getElementById('wm-limit-percent');
    if (progressText && percentEl) {
      const currentTotal = this.stats.totalAmount || 0;
      const maxLimit = this.maxTotalBet || 0;

      if (maxLimit <= 0) {
        progressText.textContent = `${currentTotal.toLocaleString('vi-VN')} (Không giới hạn)`;
        progressText.style.color = '#94a3b8';
        percentEl.textContent = '∞';
        percentEl.style.color = '#38bdf8';
      } else {
        const percent = Math.min(100, Math.round((currentTotal / maxLimit) * 100));
        progressText.textContent = `${currentTotal.toLocaleString('vi-VN')} / ${maxLimit.toLocaleString('vi-VN')}`;

        if (percent >= 100) {
          progressText.style.color = '#ef4444';
          percentEl.style.color = '#ef4444';
          percentEl.textContent = '100% (ĐẠT HẠN MỨC)';
        } else if (percent >= 80) {
          progressText.style.color = '#f59e0b';
          percentEl.style.color = '#f59e0b';
          percentEl.textContent = `${percent}%`;
        } else {
          progressText.style.color = '#38bdf8';
          percentEl.style.color = '#10b981';
          percentEl.textContent = `${percent}%`;
        }
      }
    }

    // Cập nhật trạng thái cược đồng thời
    const concurrentText = document.getElementById('wm-concurrent-status-text');
    const concurrentBadge = document.getElementById('wm-concurrent-badge');
    if (concurrentText && concurrentBadge) {
      const pendingCount = this.getPendingBetsCount();
      const maxConcurrent = this.maxConcurrentBets || 0;

      if (maxConcurrent <= 0) {
        concurrentText.textContent = `${pendingCount} lệnh (Không giới hạn)`;
        concurrentText.style.color = '#94a3b8';
        concurrentBadge.textContent = 'KHÔNG GIỚI HẠN';
        concurrentBadge.style.color = '#38bdf8';
      } else {
        concurrentText.textContent = `${pendingCount} / ${maxConcurrent} lệnh`;
        if (pendingCount >= maxConcurrent) {
          concurrentText.style.color = '#f59e0b';
          concurrentBadge.textContent = 'ĐANG ĐẦY';
          concurrentBadge.style.color = '#ef4444';
        } else {
          concurrentText.style.color = '#38bdf8';
          concurrentBadge.textContent = 'SẴN SÀNG';
          concurrentBadge.style.color = '#10b981';
        }
      }
    }
  }

  updateHeaderMetrics() {
    const metricBets = document.getElementById('wm-metric-bets');
    if (metricBets) metricBets.textContent = this.stats.totalBets;

    const metricAmount = document.getElementById('wm-metric-total-amount');
    if (metricAmount) metricAmount.textContent = this.stats.totalAmount.toLocaleString('vi-VN');

    const metricWins = document.getElementById('wm-metric-wins');
    if (metricWins) metricWins.textContent = this.stats.wins;

    const metricProfit = document.getElementById('wm-metric-profit');
    if (metricProfit) {
      const p = this.stats.totalProfit;
      metricProfit.textContent = (p > 0 ? `+${p.toLocaleString('vi-VN')}` : `${p.toLocaleString('vi-VN')}`);
      metricProfit.style.color = p > 0 ? '#10b981' : (p < 0 ? '#ef4444' : '#facc15');
    }

    this.updateLimitProgressUI();
    this.updateMiniPill();
  }

  renderBetHistory() {
    const tbody = document.getElementById('wm-history-tbody');
    const badge = document.getElementById('wm-tab-badge-history');
    if (badge) badge.textContent = this.betHistory.length;

    const statTotal = document.getElementById('wm-stat-total-bets');
    const statAmount = document.getElementById('wm-stat-total-amount');
    const statWins = document.getElementById('wm-stat-wins');
    const statLosses = document.getElementById('wm-stat-losses');
    const statWinrate = document.getElementById('wm-stat-winrate');
    const statProfit = document.getElementById('wm-stat-profit');

    if (statTotal) statTotal.textContent = this.stats.totalBets;
    if (statAmount) statAmount.textContent = this.stats.totalAmount.toLocaleString('vi-VN');
    if (statWins) statWins.textContent = this.stats.wins;
    if (statLosses) statLosses.textContent = this.stats.losses;
    if (statWinrate) statWinrate.textContent = `${this.stats.winRate}%`;
    if (statProfit) {
      const p = this.stats.totalProfit;
      statProfit.textContent = (p > 0 ? `+${p.toLocaleString('vi-VN')}` : `${p.toLocaleString('vi-VN')}`);
      statProfit.style.color = p > 0 ? '#10b981' : (p < 0 ? '#ef4444' : '#facc15');
    }

    // Cập nhật dòng footer tổng cộng ở chân bảng
    const tfoot = document.getElementById('wm-history-tfoot');
    const tfootAmount = document.getElementById('wm-tfoot-total-amount');
    const tfootWinLoss = document.getElementById('wm-tfoot-win-loss');
    const tfootProfit = document.getElementById('wm-tfoot-profit');

    if (tfoot) {
      if (this.betHistory.length > 0) {
        tfoot.style.display = 'table-footer-group';
        if (tfootAmount) tfootAmount.textContent = this.stats.totalAmount.toLocaleString('vi-VN');
        if (tfootWinLoss) tfootWinLoss.textContent = `${this.stats.wins}W - ${this.stats.losses}L (${this.stats.winRate}%)`;
        if (tfootProfit) {
          const p = this.stats.totalProfit;
          tfootProfit.textContent = (p > 0 ? `+${p.toLocaleString('vi-VN')}` : `${p.toLocaleString('vi-VN')}`);
          tfootProfit.style.color = p > 0 ? '#10b981' : (p < 0 ? '#ef4444' : '#facc15');
        }
      } else {
        tfoot.style.display = 'none';
      }
    }

    this.updateHeaderMetrics();

    if (!tbody) return;

    if (this.betHistory.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center; padding:25px 10px; color:#64748b;">
            Chưa có lịch sử cược nào được ghi nhận.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = this.betHistory.map(item => {
      const betBadge = item.bet === 'B' 
        ? '<span class="wm-badge-bet banker">🔴 Banker</span>' 
        : '<span class="wm-badge-bet player">🔵 Player</span>';
      
      let resultHtml = '';
      let profitHtml = '';

      if (item.result === 'WIN') {
        const outStr = item.roundOutcome ? ` (${item.roundOutcome})` : '';
        resultHtml = `<span class="wm-badge-result win">🎉 THẮNG${outStr}</span>`;
        profitHtml = `<b style="color:#10b981;">+${item.profit}</b>`;
      } else if (item.result === 'LOSS') {
        const outStr = item.roundOutcome ? ` (${item.roundOutcome})` : '';
        resultHtml = `<span class="wm-badge-result loss">💥 THUA${outStr}</span>`;
        profitHtml = `<b style="color:#ef4444;">${item.profit}</b>`;
      } else if (item.result === 'TIE') {
        resultHtml = `<span class="wm-badge-result tie">🟡 HÒA (Tie)</span>`;
        profitHtml = `<span style="color:#94a3b8;">0</span>`;
      } else if (item.result === 'PENDING') {
        resultHtml = `<span class="wm-badge-result pending">⏳ Đang đợi...</span>`;
        profitHtml = `<span style="color:#64748b;">--</span>`;
      } else if (item.result === 'TIMEOUT') {
        resultHtml = `<span class="wm-badge-result failed">⏱️ Hết giờ</span>`;
        profitHtml = `<span style="color:#64748b;">0</span>`;
      } else if (item.success) {
        resultHtml = `<span style="color:#10b981; font-weight:700;">✅ Đã cược</span>`;
        profitHtml = `<span style="color:#64748b;">--</span>`;
      } else {
        resultHtml = `<span class="wm-badge-result failed">❌ Lỗi cược</span>`;
        profitHtml = `<span style="color:#64748b;">0</span>`;
      }

      return `
        <tr>
          <td>${item.time}</td>
          <td><b>${item.table}</b></td>
          <td>${betBadge}</td>
          <td><b>${item.amount}</b></td>
          <td><code style="color:#00ff88;">${item.pattern}</code></td>
          <td>${resultHtml}</td>
          <td>${profitHtml}</td>
        </tr>
      `;
    }).join('');
  }

  // ==========================================================================
  // HIỂN THỊ THỐNG KÊ & NHẬT KÝ DỰ ĐOÁN AI (AI LEARNING CENTER)
  // ==========================================================================
  renderAIStats(stats, mode, bridgeConnected) {
    if (!this.overlay) return;

    // 0. Cập nhật trạng thái tự động lưu file (Local Bridge)
    const isBridge = (bridgeConnected !== undefined) ? bridgeConnected : (this.aiEngine?.bridgeConnected);
    const bridgeIndicator = document.getElementById('wm-ai-bridge-status');
    if (bridgeIndicator) {
      if (isBridge) {
        bridgeIndicator.innerHTML = '<span style="color:#10b981; font-weight:600;">🟢 Tự động lưu: <b>ai_brain.json</b> (Đã kết nối)</span>';
      } else {
        bridgeIndicator.innerHTML = '<span style="color:#94a3b8;" title="Chạy start_sync.bat trong thư mục extension để tự động ghi đè file">⚪ File Sync: Chạy <code>start_sync.bat</code> để tự lưu vào file</span>';
      }
    }

    // 1. Cập nhật Badge Mode & Nút
    const badge = document.getElementById('wm-ai-mode-badge');
    const paperBtn = document.getElementById('wm-mode-paper-btn');
    const realBtn = document.getElementById('wm-mode-real-btn');

    if (badge) {
      if (mode === 'REAL') {
        badge.textContent = 'CƯỢC THẬT (REAL)';
        badge.className = 'wm-ai-mode-pill real';
      } else {
        badge.textContent = 'MÔ PHỎNG (PAPER)';
        badge.className = 'wm-ai-mode-pill';
      }
    }

    if (paperBtn && realBtn) {
      if (mode === 'REAL') {
        paperBtn.classList.remove('active');
        realBtn.classList.add('active');
      } else {
        paperBtn.classList.add('active');
        realBtn.classList.remove('active');
      }
    }

    // 2. Thống kê 4 ô
    const totalEl = document.getElementById('wm-ai-total-rounds');
    if (totalEl) totalEl.textContent = stats.totalRoundsObserved || 0;

    const scoredEl = document.getElementById('wm-ai-scored');
    if (scoredEl) scoredEl.textContent = `${stats.predictionsScored || 0} (${stats.wins || 0}W-${stats.losses || 0}L)`;

    const accEl = document.getElementById('wm-ai-accuracy');
    if (accEl) {
      const pct = ((stats.accuracy || 0) * 100).toFixed(1);
      const edge = ((stats.edgeOverBaseline !== undefined ? stats.edgeOverBaseline : (stats.accuracy ? stats.accuracy - 0.5 : 0)) * 100).toFixed(1);
      const edgeSign = Number(edge) >= 0 ? `+${edge}%` : `${edge}%`;
      accEl.innerHTML = `${pct}% <span style="font-size:9.5px; font-weight:normal; color:#94a3b8; display:block;">(Edge: <b style="color:${Number(edge) >= 0 ? '#10b981' : '#ef4444'}">${edgeSign}</b> vs 50% Base)</span>`;
      accEl.style.color = (stats.accuracy >= 0.52) ? '#00ff88' : ((stats.accuracy >= 0.48) ? '#facc15' : '#ef4444');
    }

    const pendingEl = document.getElementById('wm-ai-pending');
    if (pendingEl) {
      const pendingCount = this.aiEngine ? this.aiEngine.pendingPredictions.size : 0;
      pendingEl.textContent = pendingCount;
    }

    // 3. Mẫu cầu và mô hình dẫn đầu
    const patternsEl = document.getElementById('wm-ai-patterns');
    if (patternsEl) {
      patternsEl.textContent = `${stats.patternsLearnedCount || 0} mẫu (N-gram & Nhịp cầu)`;
    }

    const topModelEl = document.getElementById('wm-ai-top-model');
    if (topModelEl && this.aiEngine && this.aiEngine.ensemble) {
      const weights = this.aiEngine.ensemble.weights;
      let bestName = 'Markov N-gram';
      let maxW = -1;
      const nameMap = { markov: 'Markov N-gram', streak: 'Streak / Bệt / Đảo', table: 'Cân bằng Bàn (Shoe)' };
      for (const [k, w] of Object.entries(weights)) {
        if (w > maxW) {
          maxW = w;
          bestName = nameMap[k] || k;
        }
      }
      topModelEl.textContent = `${bestName} (Trọng số ${maxW.toFixed(2)})`;
    }
  }

  addAIPredictionToLog(prediction) {
    if (!prediction || !prediction.predicted || prediction.predicted === 'PASS') return;

    const item = {
      id: prediction.predictionRecord?.id || ('pred_' + Date.now()),
      tableId: prediction.tableId,
      tableName: prediction.tableName || prediction.tableId,
      predicted: prediction.predicted,
      prob: Math.round(((prediction.predicted === 'B' ? prediction.probB : prediction.probP) || 0.5) * 100),
      reason: prediction.rationale || 'Đánh giá đa mô hình',
      mode: prediction.isPaperTrading ? 'PAPER' : 'REAL',
      time: new Date().toLocaleTimeString('vi-VN'),
      actualOutcome: null,
      status: 'PENDING'
    };

    const existingIdx = this.recentPredictionsLog.findIndex(p => p.tableId === item.tableId && p.status === 'PENDING');
    if (existingIdx >= 0) {
      this.recentPredictionsLog[existingIdx] = item;
    } else {
      this.recentPredictionsLog.unshift(item);
      if (this.recentPredictionsLog.length > 30) this.recentPredictionsLog.pop();
    }

    this.updateAILogTable();
  }

  updateAILogTable() {
    const tbody = document.getElementById('wm-ai-predictions-body');
    if (!tbody) return;

    if (!this.recentPredictionsLog || this.recentPredictionsLog.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center; color:#64748b; padding:12px;">
            Đang quét bàn để thu thập dữ liệu học trực tuyến...
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = this.recentPredictionsLog.slice(0, 10).map(item => {
      const predBadge = item.predicted === 'B'
        ? '<span class="wm-badge-bet banker" style="font-size:10px; padding:2px 6px;">🔴 B</span>'
        : '<span class="wm-badge-bet player" style="font-size:10px; padding:2px 6px;">🔵 P</span>';

      let statusBadge = '<span class="wm-badge-result pending" style="font-size:10px;">⏳ Chờ</span>';
      if (item.status === 'WIN') {
        statusBadge = '<span class="wm-badge-result win" style="font-size:10px;">✅ ĐÚNG</span>';
      } else if (item.status === 'LOSS') {
        statusBadge = '<span class="wm-badge-result loss" style="font-size:10px;">❌ SAI</span>';
      } else if (item.status === 'TIE_PUSH') {
        statusBadge = '<span class="wm-badge-result tie" style="font-size:10px;">🟡 HÒA</span>';
      }

      const modeBadge = item.mode === 'REAL' 
        ? '<span style="color:#ef4444; font-size:10px; font-weight:bold;">REAL</span>' 
        : '<span style="color:#94a3b8; font-size:10px;">PAPER</span>';

      return `
        <tr>
          <td style="font-weight:600; color:#f1f5f9;">${item.tableName}</td>
          <td>${predBadge}</td>
          <td><b style="color:#00ff88;">${item.prob}%</b></td>
          <td style="max-width:200px; font-size:10.5px; color:#cbd5e1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${item.reason}">${item.reason}</td>
          <td>${modeBadge}</td>
          <td>${statusBadge}</td>
        </tr>
      `;
    }).join('');
  }

  // ==========================================================================
  // XỬ LÝ GÓI TIN WEBSOCKET & POSTMESSAGE
  // ==========================================================================
  setupMessageListener() {
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data) return;

      // Nhận kết quả quét bàn từ iframe-injector
      if (data.type === 'WM_IFRAME_RESPONSE' && Array.isArray(data.tables)) {
        data.tables.forEach(t => {
          if (!t || !t.id) return;
          const existing = this.tablesMap.get(t.id);
          if (existing) {
            const oldHist = existing.history || [];
            const newHist = t.history || [];
            if (newHist.length > oldHist.length) {
              for (let i = oldHist.length; i < newHist.length; i++) {
                const prev = newHist.slice(0, i);
                const outcome = newHist[i];
                if (this.aiEngine) {
                  this.aiEngine.onRoundCompleted(t.id, t.name || existing.name || t.id, prev, outcome);
                }
              }
              const recentLog = this.recentPredictionsLog.find(p => p.tableId === t.id && p.status === 'PENDING');
              if (recentLog) {
                const newOutcome = newHist[newHist.length - 1];
                recentLog.actualOutcome = newOutcome;
                if (newOutcome === 'T') {
                  recentLog.status = 'TIE_PUSH';
                } else if (recentLog.predicted === newOutcome) {
                  recentLog.status = 'WIN';
                } else {
                  recentLog.status = 'LOSS';
                }
                this.updateAILogTable();
              }
            }
            existing.name = t.name || existing.name;
            existing.betTime = (t.betTime !== undefined && t.betTime !== null) ? t.betTime : existing.betTime;
            if (t.history && t.history.length > 0) existing.history = t.history;
            this.tablesMap.set(t.id, existing);
          } else {
            this.tablesMap.set(t.id, t);
          }
        });
        this.checkPendingBetResults();
        this.updateTableMetricsUI();
      }

      // Nhận phản hồi chọn Chip từ iframe-injector
      if (data.type === 'WM_IFRAME_RESPONSE' && data.action === 'SELECT_CHIP') {
        if (data.success) {
          this.actualGameChip = parseInt(data.chip) || this.selectedChip;
          this.addLog(`🎯 Đã chọn Chip ${data.chip} trên bàn game thành công!`, 'success');
        } else if (data.error) {
          this.addLog(`⚠️ [Chọn Chip] ${data.error}`, 'warning');
        }
      }

      // Nhận gói tin từ WebSocket hook
      if (data.type === 'WM_WS_PACKET_IN' && data.data) {
        this.handleWsPacket(data.data);
      }
    });
  }

  handleWsPacket(rawData) {
    try {
      if (typeof rawData !== 'string') return;
      if (!rawData.includes('protocol')) return;

      const parsed = JSON.parse(rawData);
      if (parsed.protocol === 999) return; // Bỏ qua heartbeat

      // Xử lý gói tin trạng thái bàn từ máy chủ
      if (parsed.data) {
        // Cập nhật dữ liệu từ WebSocket nếu có
      }
    } catch (e) {}
  }
}

// Khởi tạo
if (window === window.top) {
  new WMAutoHelper();
}
