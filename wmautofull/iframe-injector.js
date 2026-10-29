// iframe-injector.js - Chạy trong tất cả các iframe để tương tác DOM và lắng nghe sự kiện
(function() {
  'use strict';
  console.log('[WM Injector] Script đã nạp vào iframe:', window.location.href);

  const cachedTablesMap = new Map();
  let lastAutoScrollTime = 0;
  const iframeBetCooldown = new Map(); // tableId -> timestamp chống click đúp (Debounce Mutex)

  function getTargetDoc() {
    const iframe109 = document.getElementById('iframe_109');
    if (iframe109) {
      try {
        const d = iframe109.contentDocument || iframe109.contentWindow?.document;
        if (d) return d;
      } catch (e) {}
    }
    return document;
  }

  // Lắng nghe lệnh từ trang cha
  window.addEventListener('message', function(event) {
    const data = event.data;
    if (!data || !data.action) return;

    // Xác thực nguồn: Chỉ chấp nhận message từ window.parent hoặc window.top
    if (event.source !== window.parent && event.source !== window.top) return;

    // Xác thực action chỉ cho phép các lệnh đã biết
    const ALLOWED_ACTIONS = ['FIND_ELEMENT', 'CLICK_ELEMENT', 'GET_INFO', 'GET_ALL_IDS',
      'FIND_IN_NESTED_IFRAME', 'CLICK_IN_NESTED_IFRAME', 'GET_TABLES',
      'CLICK_BET_ZONE', 'CLICK_CONFIRM', 'FORCE_SCROLL_TABLES', 'SELECT_CHIP'];
    if (!ALLOWED_ACTIONS.includes(data.action)) return;

    // Xác thực messageId phải là number (nếu có)
    if (data.messageId !== undefined && typeof data.messageId !== 'number') return;

    switch (data.action) {
      case 'FIND_ELEMENT':
        findElement(data.selector, data.type, data.messageId);
        break;
      case 'CLICK_ELEMENT':
        clickElement(data.selector, data.type, data.messageId);
        break;
      case 'GET_INFO':
        getInfo(data.messageId);
        break;
      case 'GET_ALL_IDS':
        getAllIds(data.messageId);
        break;
      case 'FIND_IN_NESTED_IFRAME':
        findInNestedIframe(data.iframeId, data.selector, data.type, data.messageId);
        break;
      case 'CLICK_IN_NESTED_IFRAME':
        clickInNestedIframe(data.iframeId, data.selector, data.type, data.messageId);
        break;
      case 'GET_TABLES':
        getTables(data.messageId);
        break;
      case 'CLICK_BET_ZONE':
        clickBetZone(data.tableId, data.bet, data.messageId, data.candidateIds);
        break;
      case 'CLICK_CONFIRM':
        clickConfirm(data.tableId, data.messageId);
        break;
      case 'FORCE_SCROLL_TABLES':
        forceScrollAllTables(data.messageId);
        break;
      case 'SELECT_CHIP':
        selectChip(data.chip, data.messageId);
        break;
    }
  });

  function findElement(selector, type, messageId) {
    let el = null;
    try {
      const doc = getTargetDoc();
      if (type === 'id') {
        el = doc.getElementById(selector);
      } else if (type === 'css') {
        el = doc.querySelector(selector);
      } else if (type === 'xpath') {
        const res = doc.evaluate(selector, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        el = res.singleNodeValue;
      }
      window.parent.postMessage({
        type: 'WM_IFRAME_RESPONSE',
        messageId: messageId,
        found: !!el,
        selector: selector
      }, '*');
    } catch (err) {
      window.parent.postMessage({
        type: 'WM_IFRAME_RESPONSE',
        messageId: messageId,
        found: false,
        error: err.message
      }, '*');
    }
  }

  function clickElement(selector, type, messageId) {
    let el = null;
    try {
      const doc = getTargetDoc();
      if (type === 'id') {
        el = doc.getElementById(selector);
      } else if (type === 'css') {
        el = doc.querySelector(selector);
      } else if (type === 'xpath') {
        const res = doc.evaluate(selector, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        el = res.singleNodeValue;
      }

      if (el) {
        el.click();
        window.parent.postMessage({
          type: 'WM_IFRAME_RESPONSE',
          messageId: messageId,
          success: true,
          action: 'clicked'
        }, '*');
      } else {
        window.parent.postMessage({
          type: 'WM_IFRAME_RESPONSE',
          messageId: messageId,
          success: false,
          error: 'Element not found'
        }, '*');
      }
    } catch (err) {
      window.parent.postMessage({
        type: 'WM_IFRAME_RESPONSE',
        messageId: messageId,
        success: false,
        error: err.message
      }, '*');
    }
  }

  function getInfo(messageId) {
    const info = {
      type: 'WM_IFRAME_RESPONSE',
      messageId: messageId,
      url: window.location.href,
      title: document.title,
      bodyExists: !!document.body,
      elementCount: document.querySelectorAll('*').length
    };
    window.parent.postMessage(info, '*');
  }

  function getAllIds(messageId) {
    try {
      const ids = Array.from(document.querySelectorAll('[id]')).map(el => el.id).filter(Boolean);
      window.parent.postMessage({
        type: 'WM_IFRAME_RESPONSE',
        messageId: messageId,
        ids: ids,
        count: ids.length
      }, '*');
    } catch (err) {
      window.parent.postMessage({
        type: 'WM_IFRAME_RESPONSE',
        messageId: messageId,
        ids: [],
        error: err.message
      }, '*');
    }
  }

  function findInNestedIframe(iframeId, selector, type, messageId) {
    try {
      const iframe = document.getElementById(iframeId);
      const doc = iframe ? (iframe.contentDocument || iframe.contentWindow?.document) : document;

      let el = null;
      if (type === 'id') {
        el = doc.getElementById(selector);
      } else if (type === 'css') {
        el = doc.querySelector(selector);
      } else if (type === 'xpath') {
        const res = doc.evaluate(selector, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        el = res.singleNodeValue;
      }

      window.parent.postMessage({
        type: 'WM_IFRAME_RESPONSE',
        messageId: messageId,
        found: !!el,
        selector: selector
      }, '*');
    } catch (err) {
      window.parent.postMessage({
        type: 'WM_IFRAME_RESPONSE',
        messageId: messageId,
        found: false,
        error: err.message
      }, '*');
    }
  }

  function clickInNestedIframe(iframeId, selector, type, messageId) {
    try {
      const iframe = document.getElementById(iframeId);
      const doc = iframe ? (iframe.contentDocument || iframe.contentWindow?.document) : document;

      let el = null;
      if (type === 'id') {
        el = doc.getElementById(selector);
      } else if (type === 'css') {
        el = doc.querySelector(selector);
      } else if (type === 'xpath') {
        const res = doc.evaluate(selector, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        el = res.singleNodeValue;
      }

      if (el) {
        el.click();
        window.parent.postMessage({
          type: 'WM_IFRAME_RESPONSE',
          messageId: messageId,
          success: true,
          action: 'clicked'
        }, '*');
      } else {
        window.parent.postMessage({
          type: 'WM_IFRAME_RESPONSE',
          messageId: messageId,
          success: false,
          error: 'Element not found'
        }, '*');
      }
    } catch (err) {
      window.parent.postMessage({
        type: 'WM_IFRAME_RESPONSE',
        messageId: messageId,
        success: false,
        error: err.message
      }, '*');
    }
  }

  function forceScrollAllTables(messageId) {
    try {
      cachedTablesMap.clear();
      const doc = getTargetDoc();
      const scrollers = Array.from(doc.querySelectorAll('*')).filter(el => {
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
          setTimeout(() => s.scrollTo({ top: oldTop, behavior: 'smooth' }), 500);
        });
      } else {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 500);
      }

      setTimeout(() => getTables(messageId), 1000);
    } catch (e) {
      getTables(messageId);
    }
  }

  // Trích xuất tên bàn thân thiện (dịch từ ID hoặc đọc DOM)
  function extractTableName(box, id) {
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
      const sexyMatch = id.match(/_sexy_bac_(\d+)/i);
      if (sexyMatch) {
        let num = parseInt(sexyMatch[1]);
        if (num > 25 && num % 10 !== 0) num = Math.floor(num / 10);
        return `(Sexy)Bac ${num}`;
      }
      const classicMatch = id.match(/_classic_bac_(\d+)/i);
      if (classicMatch) return `(Classic)Bac ${classicMatch[1]}`;
      const speedMatch = id.match(/_speed_bac_(\d+)/i);
      if (speedMatch) return `(Speed)Bac ${speedMatch[1]}`;

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
  function extractRoadHistory(box) {
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

  function getTables(messageId) {
    try {
      const doc = getTargetDoc();
      if (!doc || !doc.body) return;

      // 1. Tuyệt đối loại trừ các phần tử thuộc Overlay và Mini-Pill của Bot nếu có
      const isBotElement = (el) => {
        if (!el || !el.closest) return false;
        return !!(el.closest('#wm-auto-helper-overlay') || el.closest('#wm-auto-mini-pill') || el.closest('.wm-table-card'));
      };

      // Dọn dẹp bất kỳ bàn phantom nào còn sót trong cachedTablesMap
      for (const [key, t] of cachedTablesMap.entries()) {
        const m = key.match(/_bac_(\d+)/i) || key.match(/bac_?(\d+)/i);
        if (m && parseInt(m[1]) > 25) {
          cachedTablesMap.delete(key);
        }
      }

      const currentScanFoundIds = new Set();

      // PHƯƠNG ÁN 1 (ƯU TIÊN): Nhận diện bàn Baccarat giao diện H5/Mobile
      // Chỉ kiểm tra leaf nodes (el.children.length === 0) khớp chính xác regex
      const titleRegex = /^(?:\(([^)]+)\)\s*)?(?:Bac(?:carat)?|Bàn)\s*0*([1-9]\d?)$/i;
      const allCandidateNodes = doc.querySelectorAll('span, div, b, p, h1, h2, h3, h4, [class*="title"], [class*="name"], [class*="room"]');

      for (const el of allCandidateNodes) {
        if (isBotElement(el)) continue;
        // Chỉ xét leaf node không có thẻ con để triệt tiêu việc ghép dính số đếm ngược
        if (el.children && el.children.length > 0) continue;

        const txt = (el.innerText || el.textContent || '').trim();
        const m = txt.match(titleRegex);
        if (m) {
          const groupName = m[1] ? `(${m[1]})` : '';
          let tableNum = parseInt(m[2]);
          if (tableNum > 25 && tableNum % 10 !== 0) {
            const candidate = Math.floor(tableNum / 10);
            if (candidate >= 1 && candidate <= 20) tableNum = candidate;
          }
          if (tableNum > 25) continue;

          const cleanTitle = groupName ? `${groupName}Bac ${tableNum}` : `Bac ${tableNum}`;
          const cleanId = cleanTitle.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

          let card = el;
          let foundCard = null;

          for (let step = 0; step < 8; step++) {
            if (!card || card === doc.body || isBotElement(card)) break;
            card = card.parentElement;
            if (!card || isBotElement(card)) break;

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

          if (foundCard && !isBotElement(foundCard)) {
            const history = extractRoadHistory(foundCard);

            let betTime = 0;
            const timeEl = foundCard.querySelector('.time, .bet-time, .count-down, [class*="time"], [class*="countdown"], [class*="second"]');
            if (timeEl) {
              const tm = (timeEl.innerText || timeEl.textContent || '').match(/(\d{1,2})\s*s?/i);
              if (tm) betTime = parseInt(tm[1]);
            }
            if (!betTime) {
              const timeMatch = (foundCard.innerText || '').match(/\b(\d{1,2})\s*s\b/i);
              if (timeMatch) betTime = parseInt(timeMatch[1]);
            }
            if (!betTime) {
              const dataTime = foundCard.getAttribute('data-bettime') || foundCard.getAttribute('data-time');
              if (dataTime) betTime = parseInt(dataTime);
            }

            // Nếu đang đóng cược / chia bài thì betTime = 0
            if (/(ngừng cược|no more bet|đang chia|chờ ván mới|dealing|settle)/i.test(foundCard.innerText || '')) {
              betTime = 0;
            }

            currentScanFoundIds.add(cleanId);
            cachedTablesMap.set(cleanId, {
              id: cleanId,
              name: cleanTitle,
              betTime: betTime,
              history: history
            });
          }
        }
      }

      // Fallback cho PC (#pc_multi_bet_tablebox)
      const pcBoxes = doc.querySelectorAll('#pc_multi_bet_tablebox .gameroom-box.multiSelectContentItem, [class*="gameroom-box"]');
      pcBoxes.forEach((box, idx) => {
        if (isBotElement(box)) return;
        const id = box.id || ('box_pc_' + idx);
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

        const friendlyName = extractTableName(box, id);
        const history = extractRoadHistory(box);

        currentScanFoundIds.add(id);
        cachedTablesMap.set(id, {
          id: id,
          name: friendlyName,
          betTime: betTime,
          history: history
        });
      });

      // Nếu có bàn quét được thực tế, dọn các bàn rỗng không có history khỏi cachedTablesMap
      if (currentScanFoundIds.size > 0) {
        for (const [key, t] of cachedTablesMap.entries()) {
          if (!currentScanFoundIds.has(key) && (!t.history || t.history.length === 0)) {
            cachedTablesMap.delete(key);
          }
        }
      }

      const tables = Array.from(cachedTablesMap.values());
      window.parent.postMessage({
        type: 'WM_IFRAME_RESPONSE',
        messageId: messageId,
        tables: tables,
        totalDetected: tables.length
      }, '*');



    } catch (err) {
      window.parent.postMessage({
        type: 'WM_IFRAME_RESPONSE',
        messageId: messageId,
        tables: Array.from(cachedTablesMap.values()),
        error: err.message
      }, '*');
    }
  }

  function clickBetZone(tableId, bet, messageId, candidateIds = []) {
    try {
      const now = Date.now();
      const lastClick = iframeBetCooldown.get(tableId) || 0;
      if (now - lastClick < 5000) {
        window.parent.postMessage({
          type: 'WM_IFRAME_RESPONSE',
          action: 'CLICK_BET_ZONE',
          messageId: messageId,
          success: true,
          tableId: tableId,
          bet: bet,
          skipped: true,
          reason: 'DEBOUNCE_COOLDOWN'
        }, '*');
        return;
      }

      const targetDocs = [getTargetDoc()];
      if (!targetDocs.includes(document)) targetDocs.push(document);
      const childIframes = Array.from(document.querySelectorAll('iframe'));
      for (const ifr of childIframes) {
        try {
          const d = ifr.contentDocument || ifr.contentWindow?.document;
          if (d && !targetDocs.includes(d)) targetDocs.push(d);
        } catch (e) {}
      }

      const betSuffix = bet === 'B' ? 'Banker' : 'Player';
      const allCandidates = Array.isArray(candidateIds) ? [...candidateIds] : [];
      if (tableId && !allCandidates.includes(tableId)) allCandidates.unshift(tableId);

      let betArea = null;

      for (const doc of targetDocs) {
        if (!doc) continue;

        // 1. Thử theo danh sách Candidate IDs: doc.getElementById(`${cid}_betArea${betSuffix}`)
        for (const cid of allCandidates) {
          if (!cid) continue;
          betArea = doc.getElementById(`${cid}_betArea${betSuffix}`);
          if (betArea) break;
        }
        if (betArea) break;

        // 2. Thử theo XPath người dùng cung cấp: (//div[@id='${cid}_betArea${betSuffix}'])[1]
        if (doc.evaluate) {
          for (const cid of allCandidates) {
            if (!cid) continue;
            try {
              const xpath = `(//div[@id='${cid}_betArea${betSuffix}'])[1]`;
              const res = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
              if (res && res.singleNodeValue) {
                betArea = res.singleNodeValue;
                break;
              }
            } catch (e) {}
            try {
              const xpathAny = `(//*[@id='${cid}_betArea${betSuffix}'])[1]`;
              const res = doc.evaluate(xpathAny, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
              if (res && res.singleNodeValue) {
                betArea = res.singleNodeValue;
                break;
              }
            } catch (e) {}
          }
          if (betArea) break;
        }

        // 3. Thử wildcard selector
        try {
          betArea = doc.querySelector(`[id$="_betArea${betSuffix}"], [id*="_betArea${betSuffix}"]`);
          if (betArea) break;
        } catch (e) {}
      }

      // 4. Tìm theo text trên H5 (loại trừ nút Pair / Đôi)
      if (!betArea) {
        const targetRegex = bet === 'B' ? /^Banker\s*(1:0\.95)?$/i : /^Player\s*(1:1)?$/i;
        const allNodes = doc.querySelectorAll('*');
        for (const el of allNodes) {
          if (el.children.length === 0) {
            const txt = (el.innerText || el.textContent || '').trim();
            if (/pair|đôi/i.test(txt) || /pair|đôi/i.test(el.className || '') || /pair|đôi/i.test(el.id || '')) continue;
            if (targetRegex.test(txt) || (bet === 'B' && txt === '1:0.95') || (bet === 'P' && txt === '1:1')) {
              betArea = el.closest('button, div[class*="bet"]') || el;
              break;
            }
          }
        }
      }

      if (betArea) {
        iframeBetCooldown.set(tableId, Date.now());
        try { betArea.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
        try {
          betArea.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          betArea.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        } catch (e) {}
        try { betArea.click(); } catch (e) {}

        // Bấm nút confirm nếu có
        try {
          const confirmBtn = doc.querySelector('[id*="confirm"], .confirm, .btn-confirm, [class*="confirm"], [class*="ok"]');
          if (confirmBtn) {
            confirmBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            confirmBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            confirmBtn.click();
          }
        } catch (e) {}

        window.parent.postMessage({
          type: 'WM_IFRAME_RESPONSE',
          action: 'CLICK_BET_ZONE',
          messageId: messageId,
          success: true,
          tableId: tableId,
          bet: bet
        }, '*');
      } else {
        window.parent.postMessage({
          type: 'WM_IFRAME_RESPONSE',
          action: 'CLICK_BET_ZONE',
          messageId: messageId,
          success: false,
          error: 'Bet area not found'
        }, '*');
      }
    } catch (err) {
      window.parent.postMessage({
        type: 'WM_IFRAME_RESPONSE',
        action: 'CLICK_BET_ZONE',
        messageId: messageId,
        success: false,
        error: err.message
      }, '*');
    }
  }

  function clickConfirm(tableId, messageId) {
    try {
      const doc = getTargetDoc();
      const confirmBtnId = tableId + '_confirm';
      let confirmBtn = doc.getElementById(confirmBtnId);

      if (!confirmBtn) {
        confirmBtn = doc.querySelector('[id*="confirm"], .confirm, .btn-confirm, [class*="confirm"], [class*="ok"]');
      }

      if (confirmBtn) {
        confirmBtn.click();
        window.parent.postMessage({
          type: 'WM_IFRAME_RESPONSE',
          messageId: messageId,
          success: true,
          tableId: tableId
        }, '*');
      } else {
        window.parent.postMessage({
          type: 'WM_IFRAME_RESPONSE',
          messageId: messageId,
          success: true,
          tableId: tableId
        }, '*');
      }
    } catch (err) {
      window.parent.postMessage({
        type: 'WM_IFRAME_RESPONSE',
        messageId: messageId,
        success: false,
        error: err.message
      }, '*');
    }
  }

  // ==========================================================================
  // HỆ THỐNG CHỌN & XÁC MINH CHIP ĐA TẦNG (MULTI-LAYER VERIFIED CHIP SELECTOR)
  // Thực hiện đúng 5 nguyên tắc:
  // 1. Chỉ phát 1 lần click thật (không dispatch mousedown, mouseup kép)
  // 2. Không quét đệ quy các iframe con
  // 3. Bỏ qua nếu iframe hiện tại đang ẩn (display: none, width=0)
  // 4. Sau khi click, kiểm tra class 'on' trên phần tử chip
  // 5. Nếu chưa active thì báo lỗi, tuyệt đối không click lặp lại
  // ==========================================================================
  function isVisibleAndInteractable(el) {
    if (!el || !el.getBoundingClientRect) return false;
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const win = el.ownerDocument?.defaultView || window;
      const style = win.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  function getChipVariants(chipStr) {
    const variants = [chipStr];
    if (chipStr === '1') variants.push('01');
    if (chipStr === '5') variants.push('05');
    if (chipStr === '1000') variants.push('1k', '1K');
    if (chipStr === '5000') variants.push('5k', '5K');
    if (chipStr === '10000') variants.push('10k', '10K');
    if (chipStr === '20000') variants.push('20k', '20K');
    if (chipStr === '50000') variants.push('50k', '50K');
    return variants;
  }

  function findValidVisibleChip(doc, chipStr) {
    if (!doc) return null;
    const variants = getChipVariants(chipStr);

    // 1. ƯU TIÊN SỐ 1: Khung chuẩn WM: #mult_chips_box (lobby đa bàn) hoặc #chip_box (bàn đơn)
    try {
      const box = doc.getElementById('mult_chips_box') || doc.getElementById('chip_box') || doc.querySelector('.chip_box');
      if (box) {
        for (const val of variants) {
          const chip = box.querySelector(`[name="${val}"], .chip_b_${val}`);
          if (chip && isVisibleAndInteractable(chip)) return chip;
        }
        for (const val of variants) {
          const chip = box.querySelector(`[name="${val}"], .chip_b_${val}`);
          if (chip) return chip;
        }
      }
    } catch (e) {}

    // 2. XPath chuẩn: (//div[@name='${val}'])[1]
    for (const val of variants) {
      try {
        const xpath = `(//div[@name='${val}'])[1]`;
        const res = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (res && res.singleNodeValue && isVisibleAndInteractable(res.singleNodeValue)) return res.singleNodeValue;
      } catch (e) {}

      try {
        const xpath = `(//*[@name='${val}'])[1]`;
        const res = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (res && res.singleNodeValue && isVisibleAndInteractable(res.singleNodeValue)) return res.singleNodeValue;
      } catch (e) {}
    }

    // 3. CSS querySelector
    for (const val of variants) {
      try {
        const el = doc.querySelector(`.chip_item[name="${val}"], div[name="${val}"], [name="${val}"], .chip_b_${val}`);
        if (el && isVisibleAndInteractable(el)) return el;
      } catch (e) {}
    }

    return null;
  }

  function checkChipActive(doc, chipStr) {
    if (!doc) return false;
    const box = doc.getElementById('mult_chips_box') || doc.getElementById('chip_box') || doc.querySelector('.chip_box');
    if (!box) return false;

    const activeChip = box.querySelector('.chip_item.on, .on');
    if (!activeChip) return false;

    // 1. Kiểm tra qua attribute name (chế độ lobby #mult_chips_box)
    const nameVal = activeChip.getAttribute('name');
    if (nameVal && String(nameVal) === chipStr) return true;

    // 2. Kiểm tra qua class chip_b_ (chế độ bàn chơi #chip_box)
    const variants = getChipVariants(chipStr);
    for (const v of variants) {
      if (activeChip.classList.contains(`chip_b_${v}`)) return true;
    }

    // 3. Kiểm tra qua dataset
    if (activeChip.dataset && (activeChip.dataset.value === chipStr || activeChip.dataset.chip === chipStr)) {
      return true;
    }

    return false;
  }

  function simulateRealClick(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    } catch (e) {}

    // Chỉ phát đúng 1 lần click thật, không gọi cả mousedown, mouseup liên tiếp
    try {
      el.click();
    } catch (e) {
      try {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      } catch (err) {}
    }
  }

  function selectChip(chipValue, messageId) {
    try {
      // 1. Nếu iframe hiện tại đang ẩn (display: none, width=0), bỏ qua không xử lý
      if (window.frameElement) {
        try {
          const style = window.parent.getComputedStyle(window.frameElement);
          if (style.display === 'none' || style.visibility === 'hidden' || window.frameElement.offsetWidth === 0) {
            return false;
          }
        } catch (e) {}
      }

      const chipStr = String(chipValue);
      const doc = document;
      const chipEl = findValidVisibleChip(doc, chipStr);

      if (!chipEl) {
        // Chỉ thông báo lỗi nếu iframe này có chứa thanh chip
        const hasBox = doc.getElementById('mult_chips_box') || doc.getElementById('chip_box') || doc.querySelector('.chip_box');
        if (hasBox) {
          window.parent.postMessage({
            type: 'WM_IFRAME_RESPONSE',
            messageId: messageId,
            action: 'SELECT_CHIP',
            success: false,
            chip: chipStr,
            error: `Không tìm thấy chip ${chipStr} trên thanh chọn`
          }, '*');
        }
        return false;
      }

      // 2. Phát đúng một lần click thật lên phần tử chip
      simulateRealClick(chipEl);

      // 3. Chờ game xử lý click rồi kiểm tra trạng thái active (class on)
      setTimeout(() => {
        const isActive = checkChipActive(doc, chipStr);
        if (isActive) {
          window.parent.postMessage({
            type: 'WM_IFRAME_RESPONSE',
            messageId: messageId,
            action: 'SELECT_CHIP',
            success: true,
            chip: chipStr
          }, '*');
        } else {
          // Báo lỗi chip chưa active, tuyệt đối KHÔNG tự click lặp vô hạn
          window.parent.postMessage({
            type: 'WM_IFRAME_RESPONSE',
            messageId: messageId,
            action: 'SELECT_CHIP',
            success: false,
            chip: chipStr,
            error: `Chip ${chipStr} chưa nhận trạng thái active (chưa có class 'on')`
          }, '*');
        }
      }, 180);

      return true;
    } catch (err) {
      window.parent.postMessage({
        type: 'WM_IFRAME_RESPONSE',
        messageId: messageId,
        action: 'SELECT_CHIP',
        success: false,
        chip: chipValue,
        error: err.message
      }, '*');
      return false;
    }
  }

  window.parent.postMessage({
    type: 'WM_IFRAME_READY',
    url: window.location.href
  }, '*');

})();
