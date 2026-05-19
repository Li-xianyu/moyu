// ──────────────────────────────────────────────
// chat-db.js — IndexedDB 存储层 + FTS 全文搜索
// ──────────────────────────────────────────────
// Schema:
//   sessions  (keyPath: id)  完整会话（不含 messages）
//     indexes: updatedAt, createdAt, mode
//   messages  (keyPath: id)  单条消息
//     indexes: session_seq([sessionId,sequence]), sessionId, timestamp, role
//   fts       (autoIncrement) 倒排索引
//     indexes: term, msgId
// ──────────────────────────────────────────────

(function () {
  "use strict";

  var DB_NAME = "moyu_chat";
  var DB_VERSION = 1;

  // ── 智能配速器 ──
  // 根据每批次实际耗时动态调整 batch/chunk 大小
  function createAdaptiveBatcher(options) {
    options = options || {};
    var min = Math.max(50, Number(options.minSize) || 100);
    var max = Math.max(min, Number(options.maxSize) || 5000);
    var size = Math.max(min, Math.min(max, Number(options.initialSize) || 1000));
    var targetMs = Number(options.targetMs) || 260;
    var hardSlowMs = Number(options.hardSlowMs) || 900;
    var emaMs = 0;
    var fastMs = Number(options.fastThreshold) || 150;
    var slowMs = Number(options.slowThreshold) || 600;
    var consecutiveFast = 0;

    return {
      getSize: function () { return size; },
      reportBatch: function (elapsedMs) {
        // 持续偏快 → 加量（加法递增）
        if (elapsedMs < fastMs) {
          consecutiveFast++;
          if (consecutiveFast >= 2) {
            var increment = Math.max(100, Math.ceil(size * 0.15));
            size = Math.min(max, size + increment);
            consecutiveFast = 0;
          }
        } else if (elapsedMs > slowMs) {
          // 偏慢 → 减量（乘法递减）
          size = Math.max(min, Math.floor(size * 0.6));
          consecutiveFast = 0;
        } else {
          consecutiveFast = 0;
        }
        return size;
      },
      reset: function (initialSize) {
        size = Math.max(min, Math.min(max, Number(initialSize) || 1000));
        consecutiveFast = 0;
      },
    };
  }

  // ── 停用词（索引时跳过，缩小体积） ──
  function createAdaptiveBatcherV2(options) {
    options = options || {};
    var min = Math.max(50, Number(options.minSize) || 100);
    var max = Math.max(min, Number(options.maxSize) || 5000);
    var size = Math.max(min, Math.min(max, Number(options.initialSize) || 1000));
    var targetMs = Number(options.targetMs) || 260;
    var hardSlowMs = Number(options.hardSlowMs) || 900;
    var emaMs = 0;

    return {
      getSize: function () { return size; },
      getAverageMs: function () { return Math.round(emaMs || 0); },
      reportBatch: function (elapsedMs) {
        elapsedMs = Math.max(1, Number(elapsedMs) || targetMs);
        emaMs = emaMs ? (emaMs * 0.65 + elapsedMs * 0.35) : elapsedMs;
        if (elapsedMs > hardSlowMs) {
          size = Math.max(min, Math.floor(size * 0.55));
          return size;
        }
        if (emaMs < targetMs * 0.72) {
          size = Math.min(max, Math.ceil(size * 1.35 + 64));
        } else if (emaMs < targetMs * 0.95) {
          size = Math.min(max, Math.ceil(size * 1.15 + 32));
        } else if (emaMs > targetMs * 1.55) {
          size = Math.max(min, Math.floor(size * 0.72));
        } else if (emaMs > targetMs * 1.18) {
          size = Math.max(min, Math.floor(size * 0.9));
        }
        return size;
      },
    };
  }

  var STOP_WORDS = new Set(
    // 中文高频虚词
    "的了在是我有和就不人都一一个上也也很到说要会着没有看好自己这他她它们那"
    + "|那个|这个|什么|怎么|可以|因为|所以|但是|如果|虽然|而且|或者|还是|只是"
    + "|不是|就是|但是|没有|已经|正在|一直|还是|因为|所以|然而|不过|关于|对于"
    + "|除了|通过|根据|按照|经过|自从|为了|由于|除非|作为|所谓|比如|例如|以及"
    // 英文停用词
    + "|the|a|an|is|are|was|were|be|been|being|have|has|had|do|does|did"
    + "|will|would|can|could|shall|should|may|might|must|i|you|he|she|it"
    + "|we|they|me|him|her|us|them|my|your|his|her|its|our|their|mine|yours"
    + "|this|that|these|those|and|but|or|in|on|at|to|for|of|with|by|from|up"
    + "|about|into|through|during|before|after|above|below|between|out|off"
    + "|over|under|again|further|then|once|here|there|when|where|why|how"
    + "|all|each|every|both|few|more|most|other|some|such|no|nor|not|only"
    + "|own|same|so|than|too|very|just|because|as|until|while|嗯|哦|啊|吧|吗"
      .split("|")
  );

  // ── 分词 ──
  function tokenize(text) {
    if (!text || typeof text !== "string") return [];
    var raw = text.toLowerCase().trim();
    if (!raw) return [];
    var tokens = [];
    var i, ch, segment, isChinese;

    // 按字符类型分段：连续英文/数字 vs 连续中文 vs 其他
    var segments = [];
    var buf = "";
    var mode = null; // 'en', 'zh', 'other'

    function flushBuf() {
      if (!buf) return;
      segments.push({ text: buf, type: mode });
      buf = "";
    }

    for (i = 0; i < raw.length; i++) {
      ch = raw[i];
      if (/[一-鿿㐀-䶿]/.test(ch)) {
        if (mode !== "zh") { flushBuf(); mode = "zh"; }
        buf += ch;
      } else if (/[a-z0-9]/.test(ch)) {
        if (mode !== "en") { flushBuf(); mode = "en"; }
        buf += ch;
      } else {
        if (mode !== "other") { flushBuf(); mode = "other"; }
        buf += ch;
      }
    }
    flushBuf();

    // 对每个段生成 token
    for (var s = 0; s < segments.length; s++) {
      var seg = segments[s];
      if (seg.type === "zh") {
        // 中文：生成 bigram + trigram
        var chars = seg.text;
        // bigram
        for (i = 0; i < chars.length - 1; i++) {
          var bg = chars.slice(i, i + 2);
          if (!STOP_WORDS.has(bg)) tokens.push(bg);
        }
        // trigram（只在字符 >=3 时生成，提高精确度）
        for (i = 0; i < chars.length - 2; i++) {
          var tg = chars.slice(i, i + 3);
          if (!STOP_WORDS.has(tg)) tokens.push(tg);
        }
      } else if (seg.type === "en") {
        // 英文/数字：按单词切分
        var words = seg.text.split(/[^a-z0-9]+/).filter(Boolean);
        for (var w = 0; w < words.length; w++) {
          var word = words[w];
          if (word.length < 2) continue; // 跳过单字母
          if (STOP_WORDS.has(word)) continue;
          tokens.push(word);
          // 对长词也做子串索引（>=5 的单词，生成 3-gram）
          if (word.length >= 5) {
            for (i = 0; i < word.length - 2; i++) {
              tokens.push(word.slice(i, i + 3));
            }
          }
        }
      }
      // 'other' 类型（标点等）跳过
    }

    // 去重（同一个位置范围不重复索引同一消息）
    var unique = [];
    var seen = {};
    for (i = 0; i < tokens.length; i++) {
      if (!seen[tokens[i]]) {
        seen[tokens[i]] = true;
        unique.push(tokens[i]);
      }
    }
    return unique;
  }

  // ── DB 初始化 ──
  var _db = null;
  var _initPromise = null;

  function estimateStoredTokens(text) {
    var source = String(text || "");
    if (!source.trim()) {
      return 0;
    }

    var cjkMatches = source.match(/[\u3400-\u9FFF\uF900-\uFAFF]/g) || [];
    var asciiWordMatches = source.match(/[A-Za-z0-9_]+/g) || [];
    var asciiWordChars = asciiWordMatches.reduce(function (sum, chunk) { return sum + chunk.length; }, 0);
    var punctuationChars = (source.match(/[^\sA-Za-z0-9_\u3400-\u9FFF\uF900-\uFAFF]/g) || []).length;
    var whitespaceChars = (source.match(/\s/g) || []).length;
    var otherChars = Math.max(0, source.length - cjkMatches.length - asciiWordChars - punctuationChars - whitespaceChars);

    return Math.max(
      1,
      Math.round(
        cjkMatches.length * 0.85 +
        asciiWordChars / 3.6 +
        punctuationChars * 0.35 +
        otherChars * 0.7
      )
    );
  }

  function estimateStoredMessageTokens(message) {
    if (!message) return 0;
    var total = 4;
    total += estimateStoredTokens(message.role || "");
    total += estimateStoredTokens(message.speaker || "");
    total += estimateStoredTokens(message.content || "");
    total += estimateStoredTokens(message.thinking || "");
    return total;
  }

  function countSessionMessagesForSave(session) {
    if (session && Number.isFinite(session.messageCount) && session.messageCount >= 0) {
      return session.messageCount;
    }
    return (session && session.messages || []).filter(function (m) { return m.role !== "system"; }).length;
  }

  function getSessionLoadedStartSequence(session) {
    if (session && Number.isFinite(session.loadedStartSequence) && session.loadedStartSequence >= 0) {
      return session.loadedStartSequence;
    }
    return 0;
  }

  function putSessionRecord(session) {
    if (!session || !session.id) return Promise.reject(new Error("无效 session"));
    return doPut("sessions", {
      id: session.id,
      title: session.title || "",
      createdAt: session.createdAt || new Date().toISOString(),
      updatedAt: session.updatedAt || new Date().toISOString(),
      configId: session.configId || "",
      host: session.host || "",
      key: session.key || "",
      titleSource: session.titleSource || "auto",
      globalPrompt: session.globalPrompt || "",
      mode: session.mode || "work",
      directorModel: session.directorModel || "",
      directorConfigId: session.directorConfigId || "",
      npcs: session.npcs || [],
      transientNpcs: session.transientNpcs || [],
      directorMemory: session.directorMemory || null,
      directorSummary: session.directorSummary || "",
      chatSummary: session.chatSummary || "",
      compressedUntilMessageId: session.compressedUntilMessageId || "",
      compressedUntilSequence: Number.isFinite(session.compressedUntilSequence) ? session.compressedUntilSequence : null,
      compressionSegments: Array.isArray(session.compressionSegments) ? session.compressionSegments : [],
      settingsOverrides: normalizeSessionOverrides(session.settingsOverrides),
      suggestionGuide: session.suggestionGuide || "",
      messageCount: countSessionMessagesForSave(session),
      tags: extractTags(session),
    });
  }

  function deleteSessionMessagesOnly(sessionId) {
    if (!sessionId) return Promise.resolve();
    return db().then(function (database) {
      return new Promise(function (resolve, reject) {
        var tx = database.transaction(["messages"], "readwrite");
        var msgIndex = tx.objectStore("messages").index("sessionId");
        var cursorReq = msgIndex.openCursor(IDBKeyRange.only(sessionId));
        cursorReq.onsuccess = function () {
          var cursor = cursorReq.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function deleteSessionMessagesBatched(sessionId, options) {
    options = options || {};
    var total = Math.max(0, Number(options.total) || 0);
    var deleted = 0;
    var onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
    var shouldCancel = typeof options.shouldCancel === "function" ? options.shouldCancel : null;
    var adaptive = createAdaptiveBatcherV2({
      initialSize: Math.max(100, Number(options.batchSize) || 3000),
      minSize: 100,
      maxSize: 5000,
      targetMs: 180,
      hardSlowMs: 800,
    });

    function getMessageKeysBatch() {
      var size = adaptive.getSize();
      return db().then(function (database) {
        return new Promise(function (resolve, reject) {
          var tx = database.transaction("messages", "readonly");
          var msgIndex = tx.objectStore("messages").index("sessionId");
          var req = msgIndex.getAllKeys(IDBKeyRange.only(sessionId), size);
          req.onsuccess = function () { resolve(req.result || []); };
          req.onerror = function () { reject(req.error); };
        });
      });
    }

    function deleteKeysBatch(keys) {
      if (!keys.length) return Promise.resolve(0);
      return db().then(function (database) {
        return new Promise(function (resolve, reject) {
          var tx = database.transaction("messages", "readwrite");
          var store = tx.objectStore("messages");
          for (var i = 0; i < keys.length; i++) {
            store.delete(keys[i]);
          }
          tx.oncomplete = function () { resolve(keys.length); };
          tx.onerror = function () { reject(tx.error); };
          tx.onabort = function () { reject(tx.error || new Error("message delete aborted")); };
        });
      });
    }

    function countRemainingMessages() {
      return db().then(function (database) {
        return new Promise(function (resolve, reject) {
          var tx = database.transaction("messages", "readonly");
          var msgIndex = tx.objectStore("messages").index("sessionId");
          var req = msgIndex.count(IDBKeyRange.only(sessionId));
          req.onsuccess = function () { resolve(req.result || 0); };
          req.onerror = function () { reject(req.error); };
        });
      });
    }

    function deleteBatch() {
      if (shouldCancel && shouldCancel()) {
        return Promise.reject(new Error("DELETE_ABORTED"));
      }
      var start = Date.now();
      return getMessageKeysBatch().then(function (keys) {
        return deleteKeysBatch(keys);
      }).then(function (batchDeleted) {
        deleted += batchDeleted;
        adaptive.reportBatch(Date.now() - start);
        if (onProgress) {
          onProgress({
            deleted: deleted,
            total: total || deleted,
            batch: batchDeleted,
            nextBatchSize: adaptive.getSize(),
            avgMs: adaptive.getAverageMs(),
          });
        }
        if (batchDeleted <= 0) {
          return deleted;
        }
        if (total > 0 && deleted >= total) {
          return countRemainingMessages().then(function (remaining) {
            if (remaining <= 0) return deleted;
            total = deleted + remaining;
            return new Promise(function (resolve) {
              setTimeout(resolve, 0);
            }).then(deleteBatch);
          });
        }
        return new Promise(function (resolve) {
          setTimeout(resolve, 0);
        }).then(deleteBatch);
      });
    }

    return deleteBatch();
  }

  function mapDbMessageToSessionMessage(m) {
    var msg = {
      id: m.id,
      role: m.role,
      speaker: m.speaker,
      content: m.content,
      createdAt: m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString(),
      sequence: Number.isFinite(m.sequence) ? m.sequence : null,
    };
    if (m.uiType) {
      msg.uiType = m.uiType;
    } else if (m.role === "assistant" && m.speaker === "瀵兼紨 AI") {
      msg.uiType = "narration";
    }
    if (m.thinking) msg.thinking = m.thinking;
    if (m.usage) msg.usage = m.usage;
    if (m.estimatedUsage) msg.estimatedUsage = m.estimatedUsage;
    if (m.toolTrace) msg.toolTrace = m.toolTrace;
    if (m.toolTraceExpanded) msg.toolTraceExpanded = true;
    if (m.thinkingExpanded) msg.thinkingExpanded = true;
    return msg;
  }

  function buildMessageRecord(sessionId, msg, sequence) {
    return {
      id: msg.id,
      sessionId: sessionId,
      role: msg.role || "user",
      speaker: msg.speaker || "",
      content: msg.content || "",
      timestamp: msg.createdAt ? new Date(msg.createdAt).getTime() : (Number(msg.timestamp) || Date.now()),
      sequence: typeof sequence === "number" ? sequence : 0,
      uiType: msg.uiType || "",
      thinking: msg.thinking || "",
      usage: msg.usage || null,
      estimatedUsage: msg.estimatedUsage || null,
      toolTrace: msg.toolTrace || null,
      toolTraceExpanded: Boolean(msg.toolTraceExpanded),
      thinkingExpanded: Boolean(msg.thinkingExpanded),
    };
  }

  function bulkPutMessagesRaw(sessionId, msgs, startSeq) {
    if (!msgs || !msgs.length) return Promise.resolve(0);
    startSeq = typeof startSeq === "number" ? startSeq : 0;
    return db().then(function (database) {
      return new Promise(function (resolve, reject) {
        var tx = database.transaction("messages", "readwrite");
        var store = tx.objectStore("messages");
        var saved = 0;

        for (var i = 0; i < msgs.length; i++) {
          var msg = msgs[i];
          if (!msg || msg.role === "system" || !msg.id) continue;
          store.put(buildMessageRecord(sessionId, msg, startSeq + i));
          saved++;
        }

        tx.oncomplete = function () { resolve(saved); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error("message import aborted")); };
      });
    });
  }

  function getNextSessionMessageSequence(sessionId) {
    return db().then(function (database) {
      return new Promise(function (resolve, reject) {
        var tx = database.transaction("messages", "readonly");
        var index = tx.objectStore("messages").index("session_seq");
        var req = index.openCursor(
          IDBKeyRange.bound([sessionId, 0], [sessionId, Infinity]),
          "prev"
        );
        req.onsuccess = function () {
          var cursor = req.result;
          if (!cursor) {
            resolve(0);
            return;
          }
          var sequence = Number(cursor.value && cursor.value.sequence);
          resolve(Number.isFinite(sequence) ? sequence + 1 : 0);
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function mapSessionRecordToSessionMeta(rec) {
    return {
      id: rec.id,
      title: rec.title || "",
      createdAt: rec.createdAt || new Date().toISOString(),
      updatedAt: rec.updatedAt || new Date().toISOString(),
      configId: rec.configId || "",
      host: rec.host || "",
      key: rec.key || "",
      titleSource: rec.titleSource || "auto",
      globalPrompt: rec.globalPrompt || "",
      mode: rec.mode || "work",
      directorModel: rec.directorModel || "",
      directorConfigId: rec.directorConfigId || "",
      npcs: rec.npcs || [],
      transientNpcs: rec.transientNpcs || [],
      directorMemory: rec.directorMemory || null,
      directorSummary: rec.directorSummary || "",
      chatSummary: rec.chatSummary || "",
      compressedUntilMessageId: rec.compressedUntilMessageId || "",
      compressedUntilSequence: Number.isFinite(rec.compressedUntilSequence) ? rec.compressedUntilSequence : null,
      compressionSegments: Array.isArray(rec.compressionSegments) ? rec.compressionSegments : [],
      settingsOverrides: normalizeSessionOverrides(rec.settingsOverrides),
      suggestionGuide: rec.suggestionGuide || "",
      messageCount: Number.isFinite(rec.messageCount) ? rec.messageCount : 0,
      messages: [],
      messagesHydrated: false,
      loadedStartSequence: 0,
    };
  }

  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        var tx = e.target.transaction;

        // sessions store
        if (!db.objectStoreNames.contains("sessions")) {
          var sessionStore = db.createObjectStore("sessions", { keyPath: "id" });
          sessionStore.createIndex("idx_updatedAt", "updatedAt", { unique: false });
          sessionStore.createIndex("idx_createdAt", "createdAt", { unique: false });
          sessionStore.createIndex("idx_mode", "mode", { unique: false });
        }

        // messages store
        if (!db.objectStoreNames.contains("messages")) {
          var msgStore = db.createObjectStore("messages", { keyPath: "id" });
          msgStore.createIndex("session_seq", ["sessionId", "sequence"], { unique: true });
          msgStore.createIndex("sessionId", "sessionId", { unique: false });
          msgStore.createIndex("timestamp", "timestamp", { unique: false });
          msgStore.createIndex("role", "role", { unique: false });
        }

        // fts inverted index
        if (!db.objectStoreNames.contains("fts")) {
          var ftsStore = db.createObjectStore("fts", { autoIncrement: true });
          ftsStore.createIndex("idx_term", "term", { unique: false });
          ftsStore.createIndex("idx_msgId", "messageId", { unique: false });
        }

        // 给 old sessions 数据建立 FTS（在版本升级时跑一次）
        if (tx) {
          tx.addEventListener("complete", function () {
            rebuildFTS().catch(function (err) {
              debugWarn("[chat-db] FTS rebuild on upgrade:", err);
            });
          });
        }
      };

      req.onsuccess = function (e) {
        _db = e.target.result;
        _db.onversionchange = function () { _db.close(); };
        resolve(_db);
      };

      req.onerror = function (e) {
        console.error("[chat-db] open failed", e.target.error);
        reject(e.target.error);
      };
    });
  }

  function db() {
    if (_db) return Promise.resolve(_db);
    if (!_initPromise) _initPromise = openDB();
    return _initPromise;
  }

  // ── 通用读写 ──
  function doGet(storeName, key) {
    return db().then(function (database) {
      return new Promise(function (resolve, reject) {
        var tx = database.transaction(storeName, "readonly");
        var req = tx.objectStore(storeName).get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function doGetAll(storeName) {
    return db().then(function (database) {
      return new Promise(function (resolve, reject) {
        var tx = database.transaction(storeName, "readonly");
        var req = tx.objectStore(storeName).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function doPut(storeName, value) {
    return db().then(function (database) {
      return new Promise(function (resolve, reject) {
        var tx = database.transaction(storeName, "readwrite");
        var req = tx.objectStore(storeName).put(value);
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function doDelete(storeName, key) {
    return db().then(function (database) {
      return new Promise(function (resolve, reject) {
        var tx = database.transaction(storeName, "readwrite");
        var req = tx.objectStore(storeName).delete(key);
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function doClear(storeName) {
    return db().then(function (database) {
      return new Promise(function (resolve, reject) {
        var tx = database.transaction(storeName, "readwrite");
        var req = tx.objectStore(storeName).clear();
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function doCount(storeName) {
    return db().then(function (database) {
      return new Promise(function (resolve, reject) {
        var tx = database.transaction(storeName, "readonly");
        var req = tx.objectStore(storeName).count();
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  // ── 索引范围查询 ──
  function doGetByIndex(storeName, indexName, range, options) {
    return db().then(function (database) {
      return new Promise(function (resolve, reject) {
        var tx = database.transaction(storeName, "readonly");
        var store = tx.objectStore(storeName);
        var index = store.index(indexName);
        var results = [];
        var limit = (options && options.limit) || Infinity;
        var direction = (options && options.dir) || "next";

        var req = index.openCursor(range, direction);
        req.onsuccess = function () {
          var cursor = req.result;
          if (cursor && results.length < limit) {
            results.push(cursor.value);
            cursor.continue();
          } else {
            resolve(results);
          }
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  // ── FTS 索引 ──
  function indexMessage(msg) {
    if (!msg || !msg.id || !msg.content) return Promise.resolve();
    var tokens = tokenize(msg.content);
    if (!tokens.length) return Promise.resolve();

    return db().then(function (database) {
      return new Promise(function (resolve, reject) {
        var tx = database.transaction("fts", "readwrite");
        var store = tx.objectStore("fts");
        var count = 0;

        var existingTokens = [];
        var getReq = store.index("idx_msgId").getAllKeys(msg.id);
        getReq.onsuccess = function () {
          existingTokens = getReq.result || [];
          // 删除旧索引
          var deletePromises = existingTokens.map(function (entry) {
            return new Promise(function (res, rej) {
              if (entry === undefined || entry === null) {
                res();
                return;
              }
              var delReq = store.delete(entry);
              delReq.onsuccess = res;
              delReq.onerror = rej;
            });
          });
          Promise.all(deletePromises).then(function () {
            // 写入新索引
            tokens.forEach(function (term) {
              var putReq = store.put({
                term: term,
                messageId: msg.id,
                sessionId: msg.sessionId,
                timestamp: msg.timestamp,
                role: msg.role,
              });
              putReq.onsuccess = function () { count++; };
            });
            tx.oncomplete = function () { resolve(count); };
            tx.onerror = function () { reject(tx.error); };
          });
        };
        getReq.onerror = function () {
          // 如果没有旧索引，就直接写
          tokens.forEach(function (term) {
            store.put({
              term: term,
              messageId: msg.id,
              sessionId: msg.sessionId,
              timestamp: msg.timestamp,
              role: msg.role,
            });
          });
          tx.oncomplete = function () { resolve(count); };
          tx.onerror = function () { reject(tx.error); };
        };
      });
    });
  }

  function deleteFTSByMessageId(messageId) {
    return db().then(function (database) {
      return new Promise(function (resolve, reject) {
        var tx = database.transaction("fts", "readwrite");
        var store = tx.objectStore("fts");
        var index = store.index("idx_msgId");
        var req = index.openCursor(IDBKeyRange.only(messageId));
        req.onsuccess = function () {
          var cursor = req.result;
          if (cursor) {
            store.delete(cursor.primaryKey);
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function deleteFTSBySession(sessionId) {
    return db().then(function (database) {
      return new Promise(function (resolve, reject) {
        var tx = database.transaction(["fts", "messages"], "readwrite");
        var store = tx.objectStore("fts");
        var msgStore = tx.objectStore("messages");
        var msgIndex = msgStore.index("sessionId");
        var msgReq = msgIndex.openCursor(IDBKeyRange.only(sessionId));
        msgReq.onsuccess = function () {
          var cursor = msgReq.result;
          if (!cursor) return;
          var mid = cursor.value && cursor.value.id;
          if (mid) {
            try {
              var ftsReq = store.index("idx_msgId").openCursor(IDBKeyRange.only(mid));
              ftsReq.onsuccess = function () {
                var ftsCursor = ftsReq.result;
                if (ftsCursor) {
                  store.delete(ftsCursor.primaryKey);
                  ftsCursor.continue();
                } else {
                  cursor.continue();
                }
              };
              ftsReq.onerror = function () { cursor.continue(); };
            } catch (e) {
              cursor.continue();
            }
          } else {
            cursor.continue();
          }
        };
        msgReq.onerror = function () { reject(msgReq.error); };
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error("fts delete aborted")); };
      });
    });
  }

  // ── 搜索排名 ──
  function rankMessages(matches, queryTerms, options) {
    options = options || {};
    var now = Date.now();
    var scored = matches.map(function (m) {
      var score = 0;

      // 1. 匹配词多样性（核心指标）
      var matchedTerms = m.matchedTerms || [];
      var uniqueMatchCount = new Set(matchedTerms).size;
      // 每个匹配词贡献基础分
      score += uniqueMatchCount * 10;

      // 2. 匹配词占查询词比例
      var queryTermCount = queryTerms.length;
      var ratio = queryTermCount > 0 ? uniqueMatchCount / queryTermCount : 0;
      score += ratio * 20;

      // 3. 精确短语匹配（连续 bigram 匹配）加成
      if (m.exactPhraseBoost) {
        score += 30;
      }

      // 4. 角色权重：用户问题优先
      if (m.role === "user") {
        score *= 1.5;
      }

      // 5. 时间衰减：越新分越高
      var age = now - m.timestamp;
      var ageHours = age / (1000 * 60 * 60);
      if (ageHours < 1) score *= 3.0;
      else if (ageHours < 24) score *= 2.0;
      else if (ageHours < 168) score *= 1.5;
      else score *= Math.max(0.5, 1 - ageHours / (24 * 365));

      return { messageId: m.messageId, sessionId: m.sessionId, score: score, role: m.role };
    });

    // 按分数降序
    scored.sort(function (a, b) { return b.score - a.score; });

    // 去重（同一 messageId 只保留最高分）
    var deduped = [];
    var seen = {};
    for (var i = 0; i < scored.length; i++) {
      if (!seen[scored[i].messageId]) {
        seen[scored[i].messageId] = true;
        deduped.push(scored[i]);
      }
    }

    return deduped;
  }

  // ── 公共 API ──
  var ChatDB = {
    // ── 初始化 ──
    init: function () {
      return db();
    },

    ready: function () {
      return _db ? Promise.resolve() : db().then(function () {});
    },

    // ── 会话管理（完整存储，不含 messages，messages 单独存 messages store） ──
    saveSession: function (session) {
      if (!session || !session.id) return Promise.reject(new Error("无效 session"));
      var record = {
        id: session.id,
        title: session.title || "",
        createdAt: session.createdAt || new Date().toISOString(),
        updatedAt: session.updatedAt || new Date().toISOString(),
        configId: session.configId || "",
        host: session.host || "",
        key: session.key || "",
        titleSource: session.titleSource || "auto",
        globalPrompt: session.globalPrompt || "",
        mode: session.mode || "work",
        directorModel: session.directorModel || "",
        directorConfigId: session.directorConfigId || "",
        npcs: session.npcs || [],
        transientNpcs: session.transientNpcs || [],
        directorMemory: session.directorMemory || null,
        directorSummary: session.directorSummary || "",
        chatSummary: session.chatSummary || "",
        compressedUntilMessageId: session.compressedUntilMessageId || "",
        compressedUntilSequence: Number.isFinite(session.compressedUntilSequence) ? session.compressedUntilSequence : null,
        compressionSegments: Array.isArray(session.compressionSegments) ? session.compressionSegments : [],
        settingsOverrides: normalizeSessionOverrides(session.settingsOverrides),
        suggestionGuide: session.suggestionGuide || "",
        messageCount: countSessionMessagesForSave(session),
        tags: extractTags(session),
      };
      return doPut("sessions", record);
    },

    updateSessionMeta: function (session) {
      if (!session || !session.id) return Promise.reject(new Error("无效 session"));
      return doGet("sessions", session.id).then(function (existing) {
        var record = existing || { id: session.id };
        record.title = session.title || record.title || "";
        record.updatedAt = session.updatedAt || new Date().toISOString();
        record.mode = session.mode || record.mode || "work";
        record.messageCount = countSessionMessagesForSave(session);
        record.tags = extractTags(session);
        record.host = session.host || record.host || "";
        record.directorMemory = session.directorMemory || record.directorMemory || null;
        record.directorSummary = session.directorSummary || record.directorSummary || "";
        record.chatSummary = session.chatSummary || record.chatSummary || "";
        record.compressedUntilMessageId = session.compressedUntilMessageId || record.compressedUntilMessageId || "";
        record.compressedUntilSequence = Number.isFinite(session.compressedUntilSequence) ? session.compressedUntilSequence : (Number.isFinite(record.compressedUntilSequence) ? record.compressedUntilSequence : null);
        record.compressionSegments = Array.isArray(session.compressionSegments) ? session.compressionSegments : (Array.isArray(record.compressionSegments) ? record.compressionSegments : []);
        record.settingsOverrides = normalizeSessionOverrides(session.settingsOverrides || record.settingsOverrides);
        if (!record.createdAt) record.createdAt = session.createdAt || new Date().toISOString();
        return doPut("sessions", record);
      });
    },

    _deleteSessionLegacy: function (sessionId) {
      if (!sessionId) return Promise.reject(new Error("无效 sessionId"));
      return deleteFTSBySession(sessionId).then(function () {
        // 删除所有消息
        return db().then(function (database) {
          return new Promise(function (resolve, reject) {
            var tx = database.transaction(["messages", "sessions"], "readwrite");
            var msgIndex = tx.objectStore("messages").index("sessionId");
            var cursorReq = msgIndex.openCursor(IDBKeyRange.only(sessionId));
            cursorReq.onsuccess = function () {
              var cursor = cursorReq.result;
              if (cursor) {
                cursor.delete();
                cursor.continue();
              }
            };
            tx.objectStore("sessions").delete(sessionId);
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () { reject(tx.error); };
          });
        });
      });
    },

    deleteSession: function (sessionId, options) {
      options = options || {};
      if (!sessionId) return Promise.reject(new Error("鏃犳晥 sessionId"));
      var onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
      var shouldCancel = typeof options.shouldCancel === "function" ? options.shouldCancel : null;
      var batchSize = Math.max(100, Number(options.batchSize) || 3000);

      return ChatDB.getMessageCount(sessionId).then(function (total) {
        if (onProgress) {
          onProgress({ phase: "prepare", deleted: 0, total: total || 0, skippedFts: false });
        }
        var shouldSkipFTS = total > 5000 || options.skipFTS === true;
        var ftsStep = shouldSkipFTS ? Promise.resolve() : deleteFTSBySession(sessionId);
        return ftsStep.then(function () {
          if (onProgress) {
            onProgress({ phase: "messages", deleted: 0, total: total || 0, skippedFts: shouldSkipFTS });
          }
          return deleteSessionMessagesBatched(sessionId, {
            batchSize: batchSize,
            total: total,
            shouldCancel: shouldCancel,
            onProgress: function (info) {
              if (onProgress) {
                onProgress({
                  phase: "messages",
                  deleted: info.deleted,
                  total: total || info.total,
                  batch: info.batch,
                  skippedFts: shouldSkipFTS,
                });
              }
            },
          });
        }).then(function () {
          if (shouldCancel && shouldCancel()) {
            throw new Error("DELETE_ABORTED");
          }
          if (onProgress) {
            onProgress({ phase: "session", deleted: total || 0, total: total || 0, skippedFts: shouldSkipFTS });
          }
          return doDelete("sessions", sessionId);
        }).then(function () {
          if (onProgress) {
            onProgress({ phase: "done", deleted: total || 0, total: total || 0, skippedFts: shouldSkipFTS });
          }
        });
      });
    },

    getSession: function (sessionId) {
      if (!sessionId) return Promise.resolve(null);
      return doGet("sessions", sessionId);
    },

    getRecentSessions: function (limit) {
      limit = limit || 50;
      return doGetByIndex("sessions", "idx_updatedAt", null, {
        limit: limit,
        dir: "prev",
      });
    },

    getAllSessionIds: function () {
      return db().then(function (database) {
        return new Promise(function (resolve, reject) {
          var tx = database.transaction("sessions", "readonly");
          var req = tx.objectStore("sessions").getAllKeys();
          req.onsuccess = function () { resolve(req.result || []); };
          req.onerror = function () { reject(req.error); };
        });
      });
    },

    loadSessionMetas: function () {
      return doGetAll("sessions").then(function (records) {
        var sessions = (records || []).map(mapSessionRecordToSessionMeta);
        sessions.sort(function (a, b) {
          return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
        });
        return sessions;
      });
    },

    // ── 加载全量会话（含消息）：启动时调用 ──
    loadAllSessions: function () {
      return db().then(function (database) {
        return new Promise(function (resolve, reject) {
          var tx = database.transaction(["sessions", "messages"], "readonly");
          var sReq = tx.objectStore("sessions").getAll();
          sReq.onsuccess = function () {
            var sessionRecords = sReq.result || [];
            var msgIndex = tx.objectStore("messages").index("sessionId");

            var chain = Promise.resolve();
            var loadedSessions = [];

            sessionRecords.forEach(function (rec) {
              chain = chain.then(function () {
                return new Promise(function (res) {
                  var mReq = msgIndex.getAll(IDBKeyRange.only(rec.id));
                  mReq.onsuccess = function () {
                    var rawMsgs = mReq.result || [];
                    rawMsgs.sort(function (a, b) { return a.sequence - b.sequence; });
                    var msgs = new Array(rawMsgs.length);
                    for (var i = 0; i < rawMsgs.length; i++) {
                      var m = rawMsgs[i];
                      var msg = {
                        id: m.id,
                        role: m.role,
                        speaker: m.speaker,
                        content: m.content,
                        createdAt: m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString(),
                        sequence: Number.isFinite(m.sequence) ? m.sequence : null,
                      };
                      if (m.uiType) {
                        msg.uiType = m.uiType;
                      } else if (m.role === "assistant" && m.speaker === "导演 AI") {
                        // 兼容旧数据：导演旁白的 uiType 可能丢失
                        msg.uiType = "narration";
                      }
                      if (m.thinking) msg.thinking = m.thinking;
                      if (m.usage) msg.usage = m.usage;
                      if (m.estimatedUsage) msg.estimatedUsage = m.estimatedUsage;
                      if (m.toolTrace) msg.toolTrace = m.toolTrace;
                      if (m.toolTraceExpanded) msg.toolTraceExpanded = true;
                      if (m.thinkingExpanded) msg.thinkingExpanded = true;
                      msgs[i] = msg;
                    }
                    // 重建完整 session 对象
                    var session = {
                      id: rec.id,
                      title: rec.title || "",
                      createdAt: rec.createdAt || new Date().toISOString(),
                      updatedAt: rec.updatedAt || new Date().toISOString(),
                      configId: rec.configId || "",
                      host: rec.host || "",
                      key: rec.key || "",
                      titleSource: rec.titleSource || "auto",
                      globalPrompt: rec.globalPrompt || "",
                      mode: rec.mode || "work",
                      directorModel: rec.directorModel || "",
                      directorConfigId: rec.directorConfigId || "",
                      npcs: rec.npcs || [],
                      transientNpcs: rec.transientNpcs || [],
                      directorMemory: rec.directorMemory || null,
                      directorSummary: rec.directorSummary || "",
                      chatSummary: rec.chatSummary || "",
                      compressedUntilMessageId: rec.compressedUntilMessageId || "",
                      compressedUntilSequence: Number.isFinite(rec.compressedUntilSequence) ? rec.compressedUntilSequence : null,
                      compressionSegments: Array.isArray(rec.compressionSegments) ? rec.compressionSegments : [],
                      settingsOverrides: normalizeSessionOverrides(rec.settingsOverrides),
                      suggestionGuide: rec.suggestionGuide || "",
                      messages: msgs,
                    };
                    loadedSessions.push(session);
                    res();
                  };
                  mReq.onerror = function () { res(); };
                });
              });
            });

            chain.then(function () {
              resolve(loadedSessions);
            });
          };
          sReq.onerror = function () { reject(sReq.error); };
        });
      });
    },

    // ── 批量保存全量会话（调用 persistSessions 时触发） ──
    saveAllSessionBlobs: function (sessions) {
      if (!sessions || !sessions.length) return Promise.resolve(0);
      return db().then(function (database) {
        return new Promise(function (resolve, reject) {
          var tx = database.transaction(["sessions", "messages"], "readwrite");
          var sessionStore = tx.objectStore("sessions");
          var msgStore = tx.objectStore("messages");
          var count = 0;

          sessions.forEach(function (s) {
            if (!s || !s.id) return;
            // 保存会话元数据
            sessionStore.put({
              id: s.id,
              title: s.title || "",
              createdAt: s.createdAt || new Date().toISOString(),
              updatedAt: s.updatedAt || new Date().toISOString(),
              configId: s.configId || "",
              host: s.host || "",
              key: s.key || "",
              titleSource: s.titleSource || "auto",
              globalPrompt: s.globalPrompt || "",
              mode: s.mode || "work",
              directorModel: s.directorModel || "",
              directorConfigId: s.directorConfigId || "",
              npcs: s.npcs || [],
              transientNpcs: s.transientNpcs || [],
              directorMemory: s.directorMemory || null,
              directorSummary: s.directorSummary || "",
              chatSummary: s.chatSummary || "",
              compressedUntilMessageId: s.compressedUntilMessageId || "",
              compressedUntilSequence: Number.isFinite(s.compressedUntilSequence) ? s.compressedUntilSequence : null,
              compressionSegments: Array.isArray(s.compressionSegments) ? s.compressionSegments : [],
              settingsOverrides: normalizeSessionOverrides(s.settingsOverrides),
              suggestionGuide: s.suggestionGuide || "",
              messageCount: countSessionMessagesForSave(s),
              tags: extractTags(s),
            });

            // 安全网：同步该会话的消息（已存在的会被覆盖，不影响）
            var msgs = s.messages || [];
            var baseSequence = getSessionLoadedStartSequence(s);
            for (var i = 0; i < msgs.length; i++) {
              var m = msgs[i];
              if (m.role === "system" || !m.id) continue;
              msgStore.put({
                id: m.id,
                sessionId: s.id,
                role: m.role || "user",
                speaker: m.speaker || "",
                content: m.content || "",
                timestamp: m.createdAt ? new Date(m.createdAt).getTime() : Date.now(),
                sequence: baseSequence + i,
                uiType: m.uiType || "",
                thinking: m.thinking || "",
                usage: m.usage || null,
                estimatedUsage: m.estimatedUsage || null,
                toolTrace: m.toolTrace || null,
                toolTraceExpanded: Boolean(m.toolTraceExpanded),
                thinkingExpanded: Boolean(m.thinkingExpanded),
              });
            }
            count++;
          });

          tx.oncomplete = function () { resolve(count); };
          tx.onerror = function () { reject(tx.error); };
        });
      });
    },

    // ── 消息管理 ──
    saveMessage: function (sessionId, msg, sequence) {
      if (!msg || !msg.id) return Promise.reject(new Error("无效 message"));
      var record = {
        id: msg.id,
        sessionId: sessionId,
        role: msg.role || "user",
        speaker: msg.speaker || "",
        content: msg.content || "",
        timestamp: msg.createdAt ? new Date(msg.createdAt).getTime() : Date.now(),
        sequence: typeof sequence === "number" ? sequence : 0,
        uiType: msg.uiType || "",
        thinking: msg.thinking || "",
        usage: msg.usage || null,
        estimatedUsage: msg.estimatedUsage || null,
        toolTrace: msg.toolTrace || null,
        toolTraceExpanded: Boolean(msg.toolTraceExpanded),
        thinkingExpanded: Boolean(msg.thinkingExpanded),
      };
      return doPut("messages", record).then(function () {
        return indexMessage(record);
      });
    },

    updateMessage: function (sessionId, msg, fallbackSequence) {
      if (!msg || !msg.id) return Promise.reject(new Error("invalid message"));
      return doGet("messages", msg.id).then(function (existing) {
        if (existing && existing.sessionId === sessionId && Number.isFinite(Number(existing.sequence))) {
          return ChatDB.saveMessage(sessionId, msg, Number(existing.sequence)).then(function () {
            return Number(existing.sequence);
          });
        }
        var sequence = Number.isFinite(Number(fallbackSequence)) ? Number(fallbackSequence) : 0;
        return ChatDB.saveMessage(sessionId, msg, sequence).then(function () {
          return sequence;
        }, function () {
          return ChatDB.appendMessage(sessionId, msg);
        });
      });
    },

    appendMessage: function (sessionId, msg) {
      if (!msg || !msg.id) return Promise.reject(new Error("invalid message"));
      return getNextSessionMessageSequence(sessionId).then(function (sequence) {
        return ChatDB.saveMessage(sessionId, msg, sequence).then(function () {
          return sequence;
        }, function () {
          return getNextSessionMessageSequence(sessionId).then(function (freshSequence) {
            return ChatDB.saveMessage(sessionId, msg, freshSequence).then(function () {
              return freshSequence;
            });
          });
        });
      });
    },

    saveMessages: function (sessionId, msgs, startSeq) {
      if (!msgs || !msgs.length) return Promise.resolve(0);
      startSeq = typeof startSeq === "number" ? startSeq : 0;
      var saved = 0;
      var chain = Promise.resolve();

      msgs.forEach(function (msg, idx) {
        if (msg.role === "system") return;
        chain = chain.then(function () {
          var record = buildMessageRecord(sessionId, msg, startSeq + idx);
          return doPut("messages", record).then(function () {
            return indexMessage(record).then(function () { saved++; });
          });
        });
      });

      return chain.then(function () { return saved; });
    },

    importMessageBatch: function (sessionId, msgs, startSeq) {
      return bulkPutMessagesRaw(sessionId, msgs, startSeq);
    },

    prepareSessionImport: function (session) {
      if (!session || !session.id) {
        return Promise.reject(new Error("鏃犳晥 session"));
      }
      return deleteFTSBySession(session.id)
        .then(function () { return deleteSessionMessagesOnly(session.id); })
        .then(function () { return putSessionRecord(session); });
    },

    getSessionMessages: function (sessionId, options) {
      options = options || {};
      var limit = options.limit || 500;
      return doGetByIndex("messages", "session_seq",
        IDBKeyRange.bound([sessionId, 0], [sessionId, Infinity]),
        { limit: limit, dir: "next" }
      );
    },

    getSessionMessagesRange: function (sessionId, startSeq, limit) {
      startSeq = Math.max(0, Number(startSeq) || 0);
      limit = Math.max(1, Number(limit) || 100);
      return doGetByIndex(
        "messages",
        "session_seq",
        IDBKeyRange.bound([sessionId, startSeq], [sessionId, Infinity]),
        { limit: limit, dir: "next" }
      ).then(function (records) {
        return (records || []).map(mapDbMessageToSessionMessage);
      });
    },

    getRecentSessionMessages: function (sessionId, limit) {
      limit = Math.max(1, Number(limit) || 100);
      return doGetByIndex(
        "messages",
        "session_seq",
        IDBKeyRange.bound([sessionId, 0], [sessionId, Infinity]),
        { limit: limit, dir: "prev" }
      ).then(function (records) {
        var ordered = (records || []).slice().reverse();
        return ordered.map(mapDbMessageToSessionMessage);
      });
    },

    estimateSessionTokens: function (sessionId) {
      if (!sessionId) return Promise.resolve(0);
      return db().then(function (database) {
        return new Promise(function (resolve, reject) {
          var tx = database.transaction("messages", "readonly");
          var index = tx.objectStore("messages").index("sessionId");
          var req = index.openCursor(IDBKeyRange.only(sessionId));
          var total = 2;
          req.onsuccess = function () {
            var cursor = req.result;
            if (!cursor) {
              resolve(Math.max(0, total));
              return;
            }
            total += estimateStoredMessageTokens(cursor.value);
            cursor.continue();
          };
          req.onerror = function () { reject(req.error); };
        });
      });
    },

    importSessionSnapshot: function (session, options) {
      options = options || {};
      var onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
      var shouldCancel = typeof options.shouldCancel === "function" ? options.shouldCancel : null;
      if (!session || !session.id) {
        return Promise.reject(new Error("无效 session"));
      }

      var nonSysMessages = (session.messages || []).filter(function (m) {
        return m && m.id && m.role !== "system";
      });
      var adaptive = createAdaptiveBatcherV2({
        initialSize: Math.max(100, Number(options.chunkSize) || 3000),
        minSize: 100,
        maxSize: 5000,
        targetMs: 260,
        hardSlowMs: 1000,
      });

      function writeNextChunk(index) {
        if (index >= nonSysMessages.length) return Promise.resolve();
        var size = adaptive.getSize();
        var chunk = nonSysMessages.slice(index, index + size);
        var start = Date.now();
        return bulkPutMessagesRaw(session.id, chunk, index).then(function () {
          adaptive.reportBatch(Date.now() - start);
          if (onProgress) {
            onProgress({
              written: Math.min(nonSysMessages.length, index + chunk.length),
              total: nonSysMessages.length,
            });
          }
          return new Promise(function (r) { setTimeout(r, 0); }).then(function () {
            return writeNextChunk(index + size);
          });
        });
      }

      return deleteFTSBySession(session.id)
        .then(function () { return deleteSessionMessagesOnly(session.id); })
        .then(function () { return putSessionRecord(session); })
        .then(function () {
          return writeNextChunk(0).then(function () {
            if (shouldCancel && shouldCancel()) throw new Error("IMPORT_ABORTED");
            return putSessionRecord(session);
          });
        });
    },

    getSessionScopeNames: function (sessionId) {
      if (!sessionId) return Promise.resolve([]);
      return doGetByIndex(
        "messages",
        "session_seq",
        IDBKeyRange.bound([sessionId, 0], [sessionId, Infinity]),
        { limit: Infinity, dir: "next" }
      ).then(function (messages) {
        var seen = {};
        var scopes = [];
        (messages || []).forEach(function (msg) {
          if (!msg || msg.role === "system" || !msg.content) return;
          var scope = msg.role === "user" ? "user" : (msg.speaker || "assistant");
          scope = String(scope || "").trim();
          if (!scope || seen[scope]) return;
          seen[scope] = true;
          scopes.push(scope);
        });
        return scopes;
      });
    },

    getMessageCount: function (sessionId) {
      return db().then(function (database) {
        return new Promise(function (resolve, reject) {
          var tx = database.transaction("messages", "readonly");
          var index = tx.objectStore("messages").index("sessionId");
          var req = index.count(IDBKeyRange.only(sessionId));
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        });
      });
    },

    deleteMessage: function (messageId) {
      if (!messageId) return Promise.resolve();
      return deleteFTSByMessageId(messageId).then(function () {
        return doDelete("messages", messageId);
      });
    },

    // ── 上下文窗口 ──
    getMessageContext: function (messageId, range) {
      range = typeof range === "number" ? range : 3;
      if (!messageId) return Promise.resolve(null);

      return doGet("messages", messageId).then(function (msg) {
        if (!msg) return null;

        var sessionId = msg.sessionId;
        var seq = msg.sequence;

        return doGetByIndex("messages", "session_seq",
          IDBKeyRange.bound([sessionId, Math.max(0, seq - range)], [sessionId, seq + range]),
          { limit: range * 2 + 1, dir: "next" }
        ).then(function (messages) {
          // 分离前后的 user message（找到最近的用户问题）
          var beforeUser = null;
          for (var i = seq - range - 1; i >= 0; i--) {
            var found = messages.filter(function (m) { return m.sequence === i && m.role === "user"; });
            if (found.length) { beforeUser = found[0]; break; }
          }

          return {
            center: msg,
            context: messages,
            precedingUserMessage: beforeUser,
            sessionId: sessionId,
          };
        });
      });
    },

    // ── 全文搜索 ──
    search: function (query, options) {
      options = options || {};
      var maxResults = options.maxResults || 10;
      var sessionFilter = options.sessionId || null;
      var contextRange = options.contextRange || 3;

      if (!query || typeof query !== "string") {
        return Promise.resolve({ results: [], total: 0 });
      }

      var queryTokens = tokenize(query);
      if (!queryTokens.length) {
        return Promise.resolve({ results: [], total: 0 });
      }

      return db().then(function (database) {
        return new Promise(function (resolve, reject) {
          var tx = database.transaction("fts", "readonly");
          var store = tx.objectStore("fts");
          var index = store.index("idx_term");

          // 收集每个 term 匹配的 message
          var matchMap = {}; // messageId -> { messageId, sessionId, role, timestamp, matchedTerms:[] }

          var pending = queryTokens.length;
          var done = 0;

          queryTokens.forEach(function (term) {
            var req = index.getAll(IDBKeyRange.only(term));
            req.onsuccess = function () {
              var entries = req.result || [];
              entries.forEach(function (entry) {
                if (sessionFilter && entry.sessionId !== sessionFilter) return;
                if (!matchMap[entry.messageId]) {
                  matchMap[entry.messageId] = {
                    messageId: entry.messageId,
                    sessionId: entry.sessionId,
                    role: entry.role,
                    timestamp: entry.timestamp,
                    matchedTerms: [],
                    exactPhraseBoost: false,
                  };
                }
                matchMap[entry.messageId].matchedTerms.push(term);
              });
              done++;
              if (done >= pending) {
                finishSearch();
              }
            };
            req.onerror = function () {
              done++;
              if (done >= pending) finishSearch();
            };
          });

          function finishSearch() {
            var matches = [];
            for (var key in matchMap) {
              if (matchMap.hasOwnProperty(key)) {
                matches.push(matchMap[key]);
              }
            }

            // 精确短语检查：如果查询包含连续中文字符，检查是否完整出现在消息内容中
            if (queryTokens.length >= 2) {
              var rawQuery = query.toLowerCase().trim();
              matches.forEach(function (m) {
                // 我们只对中文精确匹配做加成
                // 这里用 messageId 从 messages store 读取内容
                // 但为了效率，我们在排名时标记，后续批量查询
                m.needsExactCheck = true;
              });
            }

            var scored = rankMessages(matches, queryTokens, options);
            var topResults = scored.slice(0, maxResults);

            if (!topResults.length) {
              resolve({ results: [], total: 0, query: query });
              return;
            }

            // 加载每条消息的完整内容 + 上下文
            var msgTx = database.transaction("messages", "readonly");
            var msgStore = msgTx.objectStore("messages");
            var loadPromises = topResults.map(function (r, idx) {
              return new Promise(function (res, rej) {
                var req = msgStore.get(r.messageId);
                req.onsuccess = function () {
                  var fullMsg = req.result;
                  if (!fullMsg) { res(null); return; }

                  // 精确短语检查
                  var content = (fullMsg.content || "").toLowerCase();
                  var phraseBoost = false;
                  if (content.indexOf(query.toLowerCase().trim()) !== -1) {
                    phraseBoost = true;
                    r.score += 30; // 运行时加分
                  }

                  // 找对应的用户问题（前一条用户消息）
                  var userQuestion = null;
                  // 需要查前后文
                  var seq = fullMsg.sequence;
                  var sid = fullMsg.sessionId;
                  // 异步查找用户问题
                  lookupPrecedingUserMessage(msgStore, sid, seq).then(function (userMsg) {
                    r.userQuestion = userMsg;
                    r.fullContent = content;
                    res({
                      rank: idx + 1,
                      score: r.score,
                      messageId: r.messageId,
                      sessionId: r.sessionId,
                      role: fullMsg.role,
                      speaker: fullMsg.speaker,
                      content: fullMsg.content,
                      timestamp: fullMsg.timestamp,
                      sequence: fullMsg.sequence,
                      matchedTerms: r.matchedTerms,
                      exactPhraseMatch: phraseBoost,
                      userQuestion: userMsg,
                      contextRange: contextRange,
                    });
                  });
                };
                req.onerror = function () { res(null); };
              });
            });

            Promise.all(loadPromises).then(function (results) {
              var filtered = results.filter(Boolean);
              // 根据调整后的分数重新排序
              filtered.sort(function (a, b) { return b.score - a.score; });
              resolve({
                results: filtered,
                total: filtered.length,
                query: query,
                matchedTerms: queryTokens,
              });
            });
          }
        });
      });
    },

    // ── 批量加载上下文 ──
    loadContextWindows: function (searchResults) {
      if (!searchResults || !searchResults.length) return Promise.resolve([]);

      return db().then(function (database) {
        var tx = database.transaction("messages", "readonly");
        var msgStore = tx.objectStore("messages");
        var promises = searchResults.map(function (r) {
          return getContextWindow(msgStore, r.sessionId, r.sequence, r.contextRange || 3, r);
        });
        return Promise.all(promises).then(function (contexts) {
          return contexts.filter(Boolean);
        });
      });
    },

    // ── 重建索引 ──
    rebuildFTS: function () {
      return rebuildFTS();
    },

    // ── 统计 ──
    getStats: function () {
      return Promise.all([
        doCount("sessions"),
        doCount("messages"),
        doCount("fts"),
      ]).then(function (counts) {
        return {
          sessions: counts[0],
          messages: counts[1],
          indexedTerms: counts[2],
        };
      });
    },

    // ── 清空 ──
    clearAll: function () {
      return Promise.all([
        doClear("sessions"),
        doClear("messages"),
        doClear("fts"),
      ]);
    },

    // ── 从 localStorage 迁移现有会话 ──
    // ── 从 localStorage 迁移完整会话到 IDB ──
    migrateFromLocalStorage: function () {
      if (ChatDB._migrated) return Promise.resolve(0);
      var migratedKey = "moyu_idb_migrated_v2";
      try {
        if (localStorage.getItem(migratedKey)) {
          ChatDB._migrated = true;
          return Promise.resolve(0);
        }
      } catch (e) {}

      var sessions = [];
      try {
        // 优先读 localStorage（那里有完整的旧数据），再 fallback 到 state
        var raw = localStorage.getItem("moyu-sessions");
        if (raw) {
          sessions = JSON.parse(raw) || [];
        } else if (window.state && window.state.sessions && window.state.sessions.length) {
          sessions = window.state.sessions;
        }
      } catch (e) {}

      if (!sessions.length) {
        // 即使 localStorage 为空，也尝试修复已有 IDB 消息（补全 uiType 等字段）
        ChatDB._migrated = true;
        try { localStorage.setItem(migratedKey, "1"); } catch (e) {}
        return ChatDB.repairMessages().then(function (repaired) {
          return repaired;
        });
      }

      var total = 0;
      var chain = Promise.resolve();

      sessions.forEach(function (session) {
        if (!session || !session.id) return;
        chain = chain.then(function () {
          // 保存完整会话 blob
          return ChatDB.saveAllSessionBlobs([session]).then(function () {
            // 同时保存消息到 messages store（用于搜索）
            var msgs = (session.messages || []).filter(function (m) {
              return m && m.id && m.role !== "system";
            });
            return ChatDB.saveMessages(session.id, msgs, 0).then(function (saved) {
              total += saved;
            });
          }).catch(function (err) {
            debugWarn("[chat-db] migrate session", session.id, err);
          });
        });
      });

      return chain.then(function () {
        ChatDB._migrated = true;
        try { localStorage.setItem(migratedKey, "1"); } catch (e) {}
        // 迁移完成后清除 localStorage 中的会话数据
        try {
          localStorage.removeItem("moyu-sessions");
          localStorage.removeItem("moyu-current-session");
        } catch (e) {}
        return total;
      });
    },

    // ── 修复已有 IDB 消息的缺失字段（如 uiType） ──
    repairMessages: function () {
      return ChatDB.loadAllSessions().then(function (sessions) {
        if (!sessions || !sessions.length) return 0;

        var fixed = 0;
        var chain = Promise.resolve();

        sessions.forEach(function (session) {
          chain = chain.then(function () {
            var msgs = (session.messages || []).filter(function (m) {
              return m && m.id && m.role !== "system";
            });
            if (!msgs.length) return;
            // 用新的 saveMessages（含 uiType/thinking）重新写入所有消息
            return ChatDB.saveMessages(session.id, msgs, 0).then(function (saved) {
              fixed += saved;
            }).catch(function (err) {
              debugWarn("[chat-db] repair session", session.id, err);
            });
          });
        });

        return chain.then(function () {
          debugInfo("[chat-db] 修复完成", fixed, "条消息");
          // 重建 FTS
          return ChatDB.rebuildFTS().then(function (ftsCount) {
            debugInfo("[chat-db] FTS 重建", ftsCount, "条索引");
            return fixed;
          });
        });
      });
    },
  };

  // ── 辅助函数 ──

  function extractTags(session) {
    var tags = [];
    var nameSet = {};
    (session.npcs || []).forEach(function (npc) {
      if (npc.name && !nameSet[npc.name]) {
        tags.push("@" + npc.name);
        nameSet[npc.name] = true;
      }
    });
    (session.transientNpcs || []).forEach(function (npc) {
      if (npc.name && !nameSet[npc.name]) {
        tags.push("@" + npc.name);
        nameSet[npc.name] = true;
      }
    });
    if (session.mode) tags.push("#" + session.mode);
    return tags;
  }

  function rebuildFTS() {
    return db().then(function (database) {
      return new Promise(function (resolve, reject) {
        var tx = database.transaction(["messages", "fts"], "readonly");
        var msgStore = tx.objectStore("messages");
        var ftsStore = tx.objectStore("fts");

        // 先清空 FTS
        var clearReq = ftsStore.clear();
        clearReq.onsuccess = function () {
          var allReq = msgStore.getAll();
          allReq.onsuccess = function () {
            var msgs = allReq.result || [];
            // 切到读写事务来写 FTS
            var writeTx = database.transaction("fts", "readwrite");
            var writeStore = writeTx.objectStore("fts");
            var count = 0;

            msgs.forEach(function (msg) {
              var tokens = tokenize(msg.content || "");
              tokens.forEach(function (term) {
                writeStore.put({
                  term: term,
                  messageId: msg.id,
                  sessionId: msg.sessionId,
                  timestamp: msg.timestamp,
                  role: msg.role,
                });
                count++;
              });
            });

            writeTx.oncomplete = function () { resolve(count); };
            writeTx.onerror = function () { reject(writeTx.error); };
          };
          allReq.onerror = function () { reject(allReq.error); };
        };
        clearReq.onerror = function () { reject(clearReq.error); };
      });
    });
  }

  // 查找指定 sequence 之前的最近用户消息
  function lookupPrecedingUserMessage(msgStore, sessionId, sequence) {
    return new Promise(function (resolve) {
      var index = msgStore.index("session_seq");
      // 查 [sessionId, 0] 到 [sessionId, sequence-1]
      var range = IDBKeyRange.bound(
        [sessionId, 0],
        [sessionId, sequence - 1]
      );
      var req = index.openCursor(range, "prev");
      req.onsuccess = function () {
        var cursor = req.result;
        if (cursor) {
          if (cursor.value.role === "user") {
            resolve(cursor.value);
          } else {
            cursor.continue();
          }
        } else {
          resolve(null);
        }
      };
      req.onerror = function () { resolve(null); };
    });
  }

  // 获取上下文窗口（前后 N 条）
  function getContextWindow(msgStore, sessionId, centerSeq, range, resultItem) {
    return new Promise(function (resolve) {
      var index = msgStore.index("session_seq");
      var startSeq = Math.max(0, centerSeq - range);
      var endSeq = centerSeq + range;
      var req = index.getAll(IDBKeyRange.bound(
        [sessionId, startSeq],
        [sessionId, endSeq]
      ));
      req.onsuccess = function () {
        var msgs = req.result || [];
        msgs.sort(function (a, b) { return a.sequence - b.sequence; });

        // 找前后的用户问题
        var precedingUser = null;
        var followingUser = null;
        for (var i = 0; i < msgs.length; i++) {
          if (msgs[i].role === "user" && msgs[i].sequence < centerSeq) {
            precedingUser = msgs[i];
          }
          if (msgs[i].role === "user" && msgs[i].sequence > centerSeq && !followingUser) {
            followingUser = msgs[i];
          }
        }

        resolve({
          center: resultItem,
          context: msgs,
          precedingUser: precedingUser,
          followingUser: followingUser,
        });
      };
      req.onerror = function () { resolve(null); };
    });
  }

  // ── 自动预搜索（用于注入模型上下文） ──
  ChatDB.autoSearch = function (query, currentSessionId, maxResults, excludeRecentCount) {
    maxResults = maxResults || 5;
    if (!query || typeof query !== "string") return Promise.resolve([]);

    // 提取有意义的查询词（去掉过短的）
    var tokens = tokenize(query);
    var meaningfulTokens = [];
    for (var i = 0; i < tokens.length; i++) {
      // 只保留长度 >= 2 的词/ngram
      if (tokens[i].length >= 2) meaningfulTokens.push(tokens[i]);
    }
    var searchQuery = meaningfulTokens.slice(0, 12).join(" ");
    if (!searchQuery) return Promise.resolve([]);

    return ChatDB.search(searchQuery, {
      maxResults: maxResults + (excludeRecentCount || 0),
      sessionId: null,
      contextRange: 2,
    }).then(function (result) {
      if (!result.results || !result.results.length) return [];
      var filtered = [];
      var seen = {};
      var now = Date.now();
      for (var i = 0; i < result.results.length; i++) {
        var r = result.results[i];
        if (seen[r.messageId]) continue;
        seen[r.messageId] = true;
        // 跳过非常新的消息（最近 10 秒内的，可能正在生成）
        if (now - r.timestamp < 10000) continue;
        filtered.push(r);
      }
      // 按 sequence 降序排除最近 N 条（可见窗口内的消息），然后按相关度重排
      filtered.sort(function (a, b) { return (b.sequence || 0) - (a.sequence || 0); });
      if (excludeRecentCount > 0) {
        filtered = filtered.slice(excludeRecentCount);
      }
      filtered.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
      return filtered.slice(0, maxResults);
    });
  };

  // ── 在当前会话中搜索（排除可见窗口内的消息） ──
  ChatDB.searchCurrentSession = function (query, sessionId, visibleCount) {
    if (!query || !sessionId) return Promise.resolve([]);
    var tokens = tokenize(query);
    var meaningfulTokens = [];
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i].length >= 2) meaningfulTokens.push(tokens[i]);
    }
    var searchQuery = meaningfulTokens.slice(0, 12).join(" ");
    if (!searchQuery) return Promise.resolve([]);

    return ChatDB.search(searchQuery, {
      maxResults: 10,
      sessionId: sessionId,
      contextRange: 0,
    }).then(function (result) {
      if (!result.results || !result.results.length) return [];
      var sorted = result.results.slice();
      sorted.sort(function (a, b) { return (b.sequence || 0) - (a.sequence || 0); });
      if (visibleCount > 0) {
        sorted = sorted.slice(visibleCount);
      }
      return sorted.reverse();
    });
  };

  // 暴露全局
  window.__chatDB = ChatDB;

  // 页面加载后自动初始化（仅打开 DB）
  function autoInit() {
    ChatDB.init().catch(function (err) {
      debugWarn("[chat-db] init:", err);
    });
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    autoInit();
  } else {
    document.addEventListener("DOMContentLoaded", autoInit);
  }
})();
