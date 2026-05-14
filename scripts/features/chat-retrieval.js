// ──────────────────────────────────────────────
// chat-retrieval.js — 检索逻辑层 + 模型交互协议
// ──────────────────────────────────────────────
// 职责:
//   1. 注入搜索能力到系统提示词
//   2. 自动预搜索（模型生成前自动注入相关历史）
//   3. 模型触发搜索（检测 【SEARCH】 标记并执行）
//   4. 搜索结果格式化供模型消费
// ──────────────────────────────────────────────

(function () {
  "use strict";

  var RETRIEVAL = {};

  // ── 搜索标记格式 ──
  var SEARCH_PATTERN = /【搜索】([\s\S]*?)【\/搜索】/;
  var RANGE_PATTERN = /【查看区间】(\d+)\s*-\s*(\d+)【\/查看区间】/;
  var RETRIEVING_TEXT = "【检索中...】";

  // ── 1. Hard Rule Prompt ──
  // Tells the model it MUST use markers for blind-spot content
  RETRIEVAL.getSearchCapabilitySystemPrompt = function () {
    return [
      "=== HARD RULE: History Retrieval ===",
      "",
      "You CANNOT see the full conversation. Messages before your visible window are a BLIND SPOT.",
      "",
      "If the user's question involves blind-spot content, you HAVE ONLY TWO OPTIONS:",
      "  【搜索】keywords【/搜索】  — full-text search across all sessions",
      "  【查看区间】start-end【/查看区间】 — view a specific message range by index",
      "",
      "RULES:",
      "- Output the marker at the VERY START of your reply, before anything else.",
      "- The system will execute the retrieval and give you the missing context.",
      "- NEVER ask the user for keywords or what to search.",
      "- NEVER guess or fabricate blind-spot content.",
      "",
      "Failure to follow these rules = BAD. You WILL be corrected.",
    ].join("\n");
  };

  // ── 2. Build search result context block (shown to the model) ──
  function formatSearchResultsForModel(results, originalQuery) {
    if (!results || !results.length) return "";

    var blocks = [
      "## System Search Results",
      "Relevant historical records based on your search request \"" + originalQuery + "\":",
      "",
    ];

    // Group by session
    var sessions = {};
    results.forEach(function (r) {
      var sid = r.sessionId || "unknown";
      if (!sessions[sid]) sessions[sid] = [];
      sessions[sid].push(r);
    });

    var sessionTitles = {};
    try {
      if (window.__chatDB && window.__chatDB._sessionTitles) {
        sessionTitles = window.__chatDB._sessionTitles;
      }
    } catch (e) {}

    var groupIndex = 0;
    for (var sid in sessions) {
      if (!sessions.hasOwnProperty(sid)) continue;
      var group = sessions[sid];
      groupIndex++;

      var title = sessionTitles[sid] || ("Session #" + groupIndex);
      blocks.push("---");
      blocks.push("### " + title);
      blocks.push("");

      // Sort by sequence
      group.sort(function (a, b) { return (a.sequence || 0) - (b.sequence || 0); });

      group.forEach(function (item) {
        var speakerTag = item.role === "user" ? "User" : (item.speaker || "AI");
        var relevance = item.exactPhraseMatch ? " [Exact Match]" : "";
        var scoreInfo = " [Relevance:" + Math.round(item.score || 0) + "]";

        // If there's a preceding user question, show it first
        if (item.userQuestion && item.role !== "user") {
          blocks.push("> **User**: " + (item.userQuestion.content || "").substring(0, 300));
        }

        blocks.push("> **" + speakerTag + "**" + scoreInfo + relevance + ":");
        var content = item.content || "";
        if (content.length > 500) {
          content = content.substring(0, 500) + "...(truncated)";
        }
        blocks.push("> " + content.replace(/\n/g, "\n> "));
        blocks.push("");
      });
    }

    blocks.push("---");
    blocks.push("Please continue your reply based on the historical records above, combined with the current conversation.");
    blocks.push("If you think the search results are irrelevant, ignore them and reply normally.");
    blocks.push("Note: Historical records may contain outdated information. The current conversation takes precedence.");

    return blocks.join("\n");
  }

  // ── 3. 自动预搜索（模型生成前自动调用） ──
  RETRIEVAL.autoRetrieve = function (query, currentSessionId) {
    if (!query || typeof query !== "string") return Promise.resolve(null);

    // 只在查询长度 >= 4 时触发
    if (query.trim().length < 4) return Promise.resolve(null);

    return window.__chatDB.autoSearch(query, currentSessionId, 3).then(function (results) {
      if (!results || !results.length) return null;

      // 加载完整上下文窗口
      return window.__chatDB.loadContextWindows(results).then(function (contexts) {
        if (!contexts || !contexts.length) return null;

        var formatted = formatSearchResultsForModel(
          contexts.map(function (c) { return c.center; }),
          query
        );

        return {
          text: formatted,
          count: results.length,
          contexts: contexts,
        };
      });
    });
  };

  // ── 4. 构建要注入的系统消息 ──
  RETRIEVAL.buildInjectionMessages = function (searchResult) {
    if (!searchResult || !searchResult.text) return [];
    return [
      {
        role: "system",
        content: searchResult.text,
      },
    ];
  };

  // ── 5. 检测模型输出中的搜索标记 ──
  RETRIEVAL.extractSearchQuery = function (content) {
    if (!content || typeof content !== "string") return null;
    var match = content.match(SEARCH_PATTERN);
    if (!match) return null;
    return match[1].trim();
  };

  // ── 5b. 检测模型输出中的区间查看标记 ──
  RETRIEVAL.extractRangeRequest = function (content) {
    if (!content || typeof content !== "string") return null;
    var match = content.match(RANGE_PATTERN);
    if (!match) return null;
    var start = parseInt(match[1], 10);
    var end = parseInt(match[2], 10);
    if (isNaN(start) || isNaN(end) || start < 1 || end < start) return null;
    return { start: start, end: end };
  };

  RETRIEVAL.parseBlindRangeFromUserText = function (content, blindEnd) {
    if (!content || !blindEnd) return null;
    var text = String(content);
    var patterns = [
      /第\s*(\d+)\s*(?:条|則|则|个|個)?\s*(?:到|至|-|~|～)\s*第?\s*(\d+)\s*(?:条|則|则|个|個)?/,
      /(\d+)\s*(?:条|則|则|个|個|消息|记录|紀錄)\s*(?:到|至|-|~|～)\s*(\d+)\s*(?:条|則|则|个|個|消息|记录|紀錄)?/,
      /(?:消息|记录|紀錄|聊天记录|聊天記錄|条目|條目|第)\s*(\d+)\s*(?:条|則|则|个|個)?/,
      /#\s*(\d+)/
    ];

    for (var i = 0; i < patterns.length; i++) {
      var match = text.match(patterns[i]);
      if (!match) continue;
      var start = parseInt(match[1], 10);
      var end = parseInt(match[2] || match[1], 10);
      if (isNaN(start) || isNaN(end)) continue;
      if (end < start) {
        var tmp = start;
        start = end;
        end = tmp;
      }
      if (start > blindEnd) continue;
      return {
        start: Math.max(1, start),
        end: Math.min(blindEnd, end),
      };
    }

    return null;
  };

  // ── 6. 移除搜索标记（清理显示内容） ──
  RETRIEVAL.stripSearchMarker = function (content) {
    if (!content) return content;
    return content.replace(SEARCH_PATTERN, "").trim();
  };

  // ── 6b. 移除区间查看标记 ──
  RETRIEVAL.stripRangeMarker = function (content) {
    if (!content) return content;
    return content.replace(RANGE_PATTERN, "").trim();
  };

  // ── 7. 执行搜索并格式化结果 ──
  RETRIEVAL.executeSearch = function (query, options) {
    options = options || {};
    var maxResults = options.maxResults || 8;
    var contextRange = options.contextRange || 4;

    return window.__chatDB.search(query, {
      maxResults: maxResults,
      contextRange: contextRange,
      sessionId: options.sessionId || null,
    }).then(function (searchResult) {
      if (!searchResult.results || !searchResult.results.length) {
        return { text: "", results: [], count: 0 };
      }

      return window.__chatDB.loadContextWindows(searchResult.results).then(function (contexts) {
        if (!contexts || !contexts.length) {
          return { text: "", results: [], count: 0 };
        }

        var formatted = formatSearchResultsForModel(
          contexts.map(function (c) { return c.center; }),
          query
        );

        return {
          text: formatted,
          results: contexts,
          count: contexts.length,
        };
      });
    });
  };

  // ── 7b. Execute range retrieval (slice session.messages by index range) ──
  RETRIEVAL.executeRangeRetrieval = function (session, start, end) {
    if (!session || !Array.isArray(session.messages)) return null;
    // Must use the same filter as buildScopedNpcHistory
    var visibleMsgs = session.messages.filter(function (m) {
      return m && m.role !== "system" && m.content && !m.pending;
    });
    var total = visibleMsgs.length;
    var from = Math.max(0, start - 1);
    var to = Math.min(total, end);
    if (from >= to) return null;

    var sliced = visibleMsgs.slice(from, to);
    if (!sliced.length) return null;

    var lines = sliced.map(function (m, i) {
      var idx = from + i + 1;
      var tag = m.role === "user" ? "User" : (m.speaker || "AI");
      return "#" + idx + " [" + tag + "]: " + m.content;
    });

    return {
      text: "## Historical Range Retrieval Results (Messages " + (from + 1) + "-" + Math.min(to, total) + " of " + total + ")\n" + lines.join("\n\n"),
      count: sliced.length,
    };
  };

  // ── 8. 为上下文消息数组注入预搜索（给调用方用） ──
  // 在已有 messages 数组基础上，把搜索注入插入到适当位置
  RETRIEVAL.injectAutoSearch = function (messages, userQuery, currentSessionId) {
    if (!messages || !Array.isArray(messages)) return Promise.resolve(messages);

    return RETRIEVAL.autoRetrieve(userQuery, currentSessionId).then(function (result) {
      if (!result) return messages;

      // 在倒数第二个 system 消息之前插入（或追加到 system 部分末尾）
      var injection = RETRIEVAL.buildInjectionMessages(result);
      if (!injection.length) return messages;

      // 找到最后一个 system 消息的位置，在其后插入
      var lastSysIdx = -1;
      for (var i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "system") {
          lastSysIdx = i;
          break;
        }
      }

      var newMessages = messages.slice();
      if (lastSysIdx >= 0) {
        newMessages.splice(lastSysIdx + 1, 0, injection[0]);
      } else {
        newMessages.unshift(injection[0]);
      }

      return newMessages;
    });
  };

  // ── 9. 会话标题缓存（用于搜索结果显示） ──
  RETRIEVAL.refreshSessionTitleCache = function () {
    try {
      var titles = {};
      if (window.state && window.state.sessions) {
        window.state.sessions.forEach(function (s) {
          if (s && s.id) {
            titles[s.id] = s.title || s.id;
          }
        });
      }
      window.__chatDB._sessionTitles = titles;
    } catch (e) {
      // 安静失败
    }
  };

  // ── 10. 搜索标记跟进的流式 API 调用 ──
  // 在检测到模型输出了 【搜索】 标记后，执行搜索并发起二次流式请求
  RETRIEVAL.followUpStreamSearch = function (session, targetMessage, searchQuery, sessionId, npc, contextMessages) {
    if (!session || !targetMessage || !searchQuery) return Promise.resolve(false);
    if (!window.__chatDB) return Promise.resolve(false);

    var followUp = { executed: false };

    return RETRIEVAL.executeSearch(searchQuery, {
      maxResults: 8,
      contextRange: 4,
      sessionId: sessionId,
    }).then(function (searchResult) {
      if (!searchResult.text) {
        debugLog("retrieval", "搜索无结果", { query: searchQuery });
        return false;
      }

      debugLog("retrieval", "搜索命中，发起跟进调用", {
        query: searchQuery,
        count: searchResult.count,
      });
      console.log("[MOYU-SEARCH] 搜索命中，发起二次调用", {
        query: searchQuery,
        count: searchResult.count,
        resultPreview: (searchResult.text || "").slice(0, 200),
      });

      followUp.executed = true;

      // Mark the message as searching without leaking the model's retrieval marker.
      targetMessage.content = RETRIEVING_TEXT;
      targetMessage.pending = false;
      targetMessage.streaming = false;
      if (window.renderMessages) {
        try { window.renderMessages({ stickToBottom: true }); } catch (e) {}
      }

      // Build follow-up context: original context + search results + user's original question + model's partial output
      var followUpMsgs = (contextMessages || []).slice();

      // Remove the old search instruction to avoid looping
      followUpMsgs = followUpMsgs.filter(function (m) {
        if (m.role === "system" && m.content && m.content.indexOf("【检索指令】") !== -1) return false;
        return true;
      });

      // Inject search results as a system message
      followUpMsgs.push({ role: "system", content: searchResult.text });

      // Re-add the user's latest question
      var userMsgs = (session.messages || []).filter(function (m) { return m.role === "user"; });
      var lastUserContent = userMsgs.length ? userMsgs[userMsgs.length - 1].content : "";
      if (lastUserContent) {
        followUpMsgs.push({
          role: "user",
          content: "My question was: " + lastUserContent + "\n\nPlease answer based on the search results provided above. If the results are irrelevant, ignore them and answer normally.",
        });
      }

      // 解析模型配置
      var npcModel = npc ? npc.model : null;
      var npcConfigId = npc ? npc.configId : null;
      var config;
      try {
        if (window.resolveModelConfig) {
          config = window.resolveModelConfig(npcConfigId, npcModel, session.configId);
        } else {
          return false;
        }
      } catch (e) {
        debugLog("retrieval", "解析模型配置失败", e.message);
        return false;
      }

      if (!config || !config.host || !config.key) return false;

      // 发起非流式调用（简单可靠）
      var requestBody = {
        model: npcModel,
        messages: followUpMsgs,
        stream: false,
        temperature: 0.5,
      };

      var thinkingExtra = null;
      try {
        if (window.buildModelThinkingExtra) {
          thinkingExtra = window.buildModelThinkingExtra(npcModel);
          if (thinkingExtra && thinkingExtra.thinking) {
            requestBody.thinking = thinkingExtra.thinking;
          }
        }
      } catch (e) {}

      // 30s timeout for follow-up call
      var followUpController = new AbortController();
      var followUpTimer = setTimeout(function () { followUpController.abort(); }, 30000);
      var combinedSignal = (function () {
        if (!targetMessage._abortSignal) return followUpController.signal;
        var outer = targetMessage._abortSignal;
        if (outer.aborted) { clearTimeout(followUpTimer); followUpController.abort(); return followUpController.signal; }
        var onAbort = function () { clearTimeout(followUpTimer); followUpController.abort(); };
        outer.addEventListener("abort", onAbort, { once: true });
        return followUpController.signal;
      })();

      var doFollowUpFetch = function (body) {
        return fetch(config.host + "/chat/completions", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + config.key,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: combinedSignal,
        });
      };

      return doFollowUpFetch(requestBody).then(function (response) {
        if (!response.ok && requestBody.temperature !== undefined) {
          return response.text().then(function (errText) {
            if (/temperature|unsupported param|not support/i.test(errText || "")) {
              var retryBody = Object.assign({}, requestBody);
              delete retryBody.temperature;
              return doFollowUpFetch(retryBody);
            }
            response._moyuErrorText = errText;
            return response;
          });
        }
        return response;
      }).then(function (response) {
        clearTimeout(followUpTimer);
        if (!response.ok) {
          var errPromise = response._moyuErrorText ? Promise.resolve(response._moyuErrorText) : response.text();
          return errPromise.then(function (errText) {
            debugLog("retrieval", "跟进调用失败", { status: response.status, error: errText });
            return false;
          });
        }
        return response.json().then(function (data) {
          var content = "";
          try {
            content = data.choices[0].message.content || "";
          } catch (e) {
            content = "";
          }

          if (content) {
            // 清理模型思考标签
            try {
              if (window.stripThinkingLeakage) {
                content = window.stripThinkingLeakage(content);
              }
            } catch (e) {}

            targetMessage.content = content;
            targetMessage.streaming = false;
            targetMessage.pending = false;
            targetMessage.searchEnhanced = true;

            // 更新用量
            try {
              if (data.usage) {
                targetMessage.usage = data.usage;
              }
            } catch (e) {}

            // 触发保存和渲染
            try {
              if (window.touchSession) window.touchSession(session);
              if (window.persistSessions) window.persistSessions();
              if (window.renderMessages) window.renderMessages({ stickToBottom: true });
            } catch (e) {}

            debugLog("retrieval", "搜索跟进完成", { contentLength: content.length });
            console.log("[MOYU-SEARCH] 搜索跟进响应", {
              contentPreview: content.slice(0, 300),
              contentLength: content.length,
            });
            return true;
          }
          return false;
        });
      }).catch(function (err) {
        clearTimeout(followUpTimer);
        if (err.name === "AbortError") return false;
        debugLog("retrieval", "跟进调用异常", err.message);
        return false;
      });
    });
  };

  // ── 11. 区间标记跟进 ──
  // 检测到 【查看区间】 标记后，直接从 session.messages 取数据并发起二次请求
  RETRIEVAL.followUpStreamRange = function (session, targetMessage, start, end, npc, contextMessages) {
    if (!session || !targetMessage) return Promise.resolve(false);
    var rangeResult = RETRIEVAL.executeRangeRetrieval(session, start, end);
    if (!rangeResult || !rangeResult.text) {
      debugLog("retrieval", "区间检索无结果", { start: start, end: end });
      return Promise.resolve(false);
    }

    debugLog("retrieval", "区间检索命中", { start: start, end: end, count: rangeResult.count });

    targetMessage.content = RETRIEVING_TEXT;
    targetMessage.pending = false;
    targetMessage.streaming = false;
    try { if (window.renderMessages) window.renderMessages({ stickToBottom: true }); } catch (e) {}

    var followUpMsgs = (contextMessages || []).slice();
    followUpMsgs = followUpMsgs.filter(function (m) {
      if (m.role === "system" && m.content && m.content.indexOf("【检索指令】") !== -1) return false;
      return true;
    });
    followUpMsgs.push({ role: "system", content: rangeResult.text });

    var userMsgs = (session.messages || []).filter(function (m) { return m.role === "user"; });
    var lastUserContent = userMsgs.length ? userMsgs[userMsgs.length - 1].content : "";
    if (lastUserContent) {
      followUpMsgs.push({
        role: "user",
        content: "My question was: " + lastUserContent + "\n\nPlease answer based on the historical records provided above. If the content is irrelevant, ignore it and answer normally.",
      });
    }

    var npcModel = npc ? npc.model : null;
    var npcConfigId = npc ? npc.configId : null;
    var config;
    try {
      if (window.resolveModelConfig) {
        config = window.resolveModelConfig(npcConfigId, npcModel, session.configId);
      } else { return false; }
    } catch (e) {
      debugLog("retrieval", "解析模型配置失败", e.message);
      return false;
    }
    if (!config || !config.host || !config.key) return false;

    var requestBody = {
      model: npcModel,
      messages: followUpMsgs,
      stream: false,
      temperature: 0.5,
    };
    var thinkingExtra = window.buildModelThinkingExtra ? window.buildModelThinkingExtra(npcModel) : {};
    if (thinkingExtra && thinkingExtra.thinking) requestBody.thinking = thinkingExtra.thinking;

    // 30s timeout for follow-up call (reasoning models can hang)
    var followUpController = new AbortController();
    var followUpTimer = setTimeout(function () { followUpController.abort(); }, 30000);
    var combinedSignal = (function () {
      if (!targetMessage._abortSignal) return followUpController.signal;
      // Combine abort signals: abort if EITHER triggers
      var outer = targetMessage._abortSignal;
      if (outer.aborted) { clearTimeout(followUpTimer); followUpController.abort(); return followUpController.signal; }
      var onAbort = function () { clearTimeout(followUpTimer); followUpController.abort(); };
      outer.addEventListener("abort", onAbort, { once: true });
      return followUpController.signal;
    })();

    var doFollowUpFetch = function (body) {
      return fetch(config.host + "/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + config.key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: combinedSignal,
      });
    };

    return doFollowUpFetch(requestBody).then(function (response) {
      if (!response.ok && requestBody.temperature !== undefined) {
        return response.text().then(function (errText) {
          if (/temperature|unsupported param|not support/i.test(errText || "")) {
            var retryBody = Object.assign({}, requestBody);
            delete retryBody.temperature;
            return doFollowUpFetch(retryBody);
          }
          response._moyuErrorText = errText;
          return response;
        });
      }
      return response;
    }).then(function (response) {
      clearTimeout(followUpTimer);
      if (!response.ok) {
        var errPromise = response._moyuErrorText ? Promise.resolve(response._moyuErrorText) : response.text();
        return errPromise.then(function (errText) {
          debugLog("retrieval", "区间跟进调用失败", { status: response.status, error: errText });
          return false;
        });
      }
      return response.json().then(function (data) {
        var content = "";
        try { content = data.choices[0].message.content || ""; } catch (e) {}
        if (!content) return false;

        try { if (window.stripThinkingLeakage) content = window.stripThinkingLeakage(content); } catch (e) {}
        targetMessage.content = content;
        targetMessage.streaming = false;
        targetMessage.pending = false;
        targetMessage.searchEnhanced = true;

        try {
          if (data.usage) targetMessage.usage = data.usage;
          if (window.touchSession) window.touchSession(session);
          if (window.persistSessions) window.persistSessions();
          if (window.renderMessages) window.renderMessages({ stickToBottom: true });
        } catch (e) {}

        debugLog("retrieval", "区间跟进完成", { contentLength: content.length });
        return true;
      });
    }).catch(function (err) {
      clearTimeout(followUpTimer);
      if (err.name === "AbortError") return false;
      debugLog("retrieval", "区间跟进异常", err.message);
      return false;
    });
  };

  // ── 12. Format current session search results (context block shown to model) ──
  RETRIEVAL._formatCurrentSessionContext = function (contexts, originalQuery) {
    if (!contexts || !contexts.length) return "";
    var blocks = [
      "## Earlier Related Records (This Session)",
      "Based on your query \"" + originalQuery + "\", here are earlier conversations from this session:",
      "",
    ];
    var added = 0;
    var seenContent = {};
    for (var i = 0; i < contexts.length; i++) {
      var ctx = contexts[i];
      if (!ctx) continue;
      var allMsgs = (ctx.context || []).slice();
      // ctx.context already includes the center message (fetched by getContextWindow by sequence range)
      // Fall back to center alone if context array is empty
      if (!allMsgs.length && ctx.center) {
        allMsgs = [ctx.center];
      }
      allMsgs.sort(function (a, b) { return (a.sequence || 0) - (b.sequence || 0); });
      for (var j = 0; j < allMsgs.length; j++) {
        var m = allMsgs[j];
        if (!m || !m.content) continue;
        var key = (m.sequence || "x") + "-" + (m.content || "").substring(0, 80);
        if (seenContent[key]) continue;
        seenContent[key] = true;
        var tag = m.role === "user" ? "User" : (m.speaker || "AI");
        blocks.push("> **" + tag + "**: " + m.content.substring(0, 400));
        added++;
      }
    }
    if (!added) return "";
    blocks.push("");
    blocks.push("The above is for reference only. Prioritize the currently visible conversation history when replying.");
    return blocks.join("\n");
  };

  // ── 暴露全局 ──
  window.__chatRetrieval = RETRIEVAL;

  // ── 日志 ──
  function debugLog(category, message, data) {
    try {
      if (window.debugLog) {
        window.debugLog(category, message, data);
      } else {
        console.log("[MOYU:retrieval]", message, data || "");
      }
    } catch (e) {}
  }

  RETRIEVAL._debugLog = debugLog;

})();
