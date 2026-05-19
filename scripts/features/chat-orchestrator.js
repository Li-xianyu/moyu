"use strict";


const DIRECTOR_RECENT_HISTORY_LIMIT = 8;
const DIRECTOR_MANUAL_RECENT_HISTORY_LIMIT = 4;
const DIRECTOR_AUTO_COMPRESS_THRESHOLD_DEFAULT = 1800;
const DIRECTOR_AUTO_COMPRESS_MIN_UNSUMMARIZED = 6;
const DIRECTOR_MEMORY_TARGET_MIN = 260;
const DIRECTOR_MEMORY_TARGET_MAX = 1800;
// ── 单 AI 模式（无导演）对话摘要压缩 ──
const CHAT_CONVERSATION_THRESHOLD = 3000;
const CHAT_SUMMARY_TARGET_MAX = 800;
const CHAT_AUTO_COMPRESS_THRESHOLD = 600;

const CHAT_MANUAL_RECOMPRESS_RECENT_LIMIT = 30;

function buildChatSummaryBlock(session) {
  const summary = session?.chatSummary;
  const segmentMessages = typeof buildCompressionSegmentsSystemMessages === "function"
    ? buildCompressionSegmentsSystemMessages(session, "chat")
    : [];
  const blocks = [];
  if (summary) {
    blocks.push(`[CHAT_SUMMARY]\n${summary}\n[/CHAT_SUMMARY]`);
  }
  segmentMessages.forEach((message) => {
    if (message?.content) blocks.push(message.content);
  });
  return blocks.join("\n\n");
}

function buildChatContextTokenMetrics(session) {
  if (!session) return null;
  const visibleMessages = getVisibleHistoryMessages(session);
  const cutoffIndex = session?.compressedUntilMessageId
    ? visibleMessages.findIndex((m) => m.id === session.compressedUntilMessageId)
    : -1;
  const cutoffSeq = Number.isFinite(session?.compressedUntilSequence)
    ? session.compressedUntilSequence
    : Math.max(-1, ...(typeof getCompressionSegments === "function" ? getCompressionSegments(session, "chat").map((segment) => Number(segment.endSeq) || -1) : []));
  const activeMessages = session?.chatSummary
    ? (cutoffIndex >= 0
      ? visibleMessages.slice(cutoffIndex + 1)
      : (cutoffSeq >= 0
        ? visibleMessages.filter((message) => !Number.isFinite(message.sequence) || message.sequence > cutoffSeq)
        : visibleMessages))
    : visibleMessages;
  const summaryTokens = estimateTokens(session?.chatSummary || "");
  const segmentTokens = estimateChatMessagesTokens(
    typeof buildCompressionSegmentsSystemMessages === "function"
      ? buildCompressionSegmentsSystemMessages(session, "chat")
      : []
  );
  const totalTokens = estimateChatMessagesTokens(
    activeMessages.map((m) => ({ role: m.role || "user", content: m.content || "" }))
  ) + summaryTokens + segmentTokens;
  return {
    contextCurrent: totalTokens,
    contextThreshold: getSessionSetting(session, "compressThreshold"),
    recentCount: activeMessages.length,
  };
}

function getRecentChatMessages(session, limit = CHAT_MANUAL_RECOMPRESS_RECENT_LIMIT) {
  const visibleMessages = getVisibleHistoryMessages(session);
  if (!visibleMessages.length) return [];
  return visibleMessages.slice(-Math.max(1, limit));
}

function formatTokenCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return "—";
  }
  return Math.round(numeric).toLocaleString("zh-CN");
}

function getSessionStoredTokenEstimateState(session) {
  const totalMessageCount = getSessionMessageCount(session);
  if (!session) {
    return { label: "—", ready: false };
  }
  if (session.totalTokenEstimatePending) {
    return { label: "计算中...", ready: false };
  }
  if (
    Number.isFinite(session.totalTokenEstimate) &&
    Number.isFinite(session.totalTokenEstimateMessageCount) &&
    session.totalTokenEstimateMessageCount === totalMessageCount
  ) {
    return { label: formatTokenCount(session.totalTokenEstimate), ready: true };
  }
  return { label: "待计算", ready: false };
}

async function ensureSessionStoredTokenEstimate(session) {
  if (!session || !window.__chatDB?.estimateSessionTokens) {
    return null;
  }
  const totalMessageCount = getSessionMessageCount(session);
  if (
    Number.isFinite(session.totalTokenEstimate) &&
    Number.isFinite(session.totalTokenEstimateMessageCount) &&
    session.totalTokenEstimateMessageCount === totalMessageCount
  ) {
    return session.totalTokenEstimate;
  }
  if (session.totalTokenEstimatePending) {
    return null;
  }

  session.totalTokenEstimatePending = true;
  try {
    const estimated = await window.__chatDB.estimateSessionTokens(session.id);
    session.totalTokenEstimate = estimated;
    session.totalTokenEstimateMessageCount = totalMessageCount;
    return estimated;
  } catch (error) {
    debugWarn("[session] token estimate failed", error);
    return null;
  } finally {
    session.totalTokenEstimatePending = false;
    if (getCurrentSession()?.id === session.id) {
      renderCompressMemoryPopover();
      if (typeof refreshSessionMetaPanel === "function") {
        refreshSessionMetaPanel();
      }
    }
  }
}

function ensureDirectorTraceMessage(session, existingMessage) {
  if (existingMessage) {
    return existingMessage;
  }
  const traceMessage = {
    id: `narration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: "assistant",
    speaker: "导演 AI",
    uiType: "narration",
    content: "",
    createdAt: new Date().toISOString(),
    pending: false,
    streaming: true,
    toolTraceExpanded: true,
    retrieving: false,
  };
  session.messages.push(traceMessage);
  renderMessages({ stickToBottom: true });
  return traceMessage;
}

function insertSystemMessageBeforeLastUser(messages, systemContent) {
  if (!systemContent) {
    return messages;
  }
  const result = Array.isArray(messages) ? messages.slice() : [];
  let lastUserIdx = -1;
  for (let i = result.length - 1; i >= 0; i -= 1) {
    if (result[i]?.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  const insertAt = lastUserIdx >= 0 ? lastUserIdx : result.length;
  result.splice(insertAt, 0, { role: "system", content: systemContent });
  return result;
}

function buildDirectorRetrievalRule(session) {
  if (!window.__chatRetrieval) {
    return "";
  }
  const visibleMessages = getVisibleHistoryMessages(session);
  const recentMessages = getDirectorRecentMessages(session);
  const totalVisible = visibleMessages.length;
  const visibleRecent = recentMessages.length;
  const blindEnd = totalVisible - visibleRecent;
  if (blindEnd <= 0) {
    return "";
  }
  const availableScopes = Array.from(new Set([
    ...((session.historicalScopeNames || []).filter(Boolean)),
    ...(session.messages || [])
      .filter((m) => m && m.role !== "system" && m.content && !m.pending)
      .map((m) => m.role === "user" ? "user" : (m.speaker || "assistant"))
      .filter(Boolean),
  ]));
  const turnHint = buildBlindTurnRangeHint(session, blindEnd);
  return [
    "=== DIRECTOR RETRIEVAL PROTOCOL: OBEY EXACTLY ===",
    `VISIBLE DETAIL WINDOW: messages ${blindEnd + 1}-${totalVisible}.`,
    `DETAIL BLIND SPOT: messages 1-${blindEnd}.`,
    "",
    "If recent visible history, director memory, compression segments, or normal reasoning already suffice, output JSON directly and do NOT retrieve.",
    "Use retrieval ONLY when this turn's narration/responders/spawn_npcs/parallel_groups truly depends on non-visible older details.",
    "",
    "If retrieval is needed, your ENTIRE reply MUST be exactly one retrieval marker and nothing else.",
    "After the system returns retrieved records, you MUST continue by outputting only the JSON object.",
    "",
    "ALLOWED MARKERS ONLY:",
    "1. 【查看区间】N-N【/查看区间】",
    "2. 【查看区间】scope,N-M【/查看区间】",
    "3. 【搜索】keywords【/搜索】",
    "",
    "AVAILABLE scope names in this conversation:",
    availableScopes.join(", "),
    "",
    "PRIORITY ORDER:",
    "A. If scoped retrieval can express the request, you MUST use scoped retrieval.",
    "B. Else if global range retrieval can express the request, use global range retrieval.",
    "C. Else and only else, use generic search.",
    "",
    "MANDATORY:",
    "- Questions about who said something, what a named NPC/agent said, who joined, or what the user said MUST prefer scoped retrieval first.",
    "- Never fabricate blind-spot facts just to keep the scene moving.",
    "- Never answer with natural language before retrieval if the needed detail is outside the visible window.",
    "",
    "FORBIDDEN:",
    "- No JSON plus marker in the same reply.",
    "- No markdown, no explanation, no fake 'I checked'.",
    "- No generic search when a range/scoped marker would work.",
    "",
    "CORRECT:",
    "- '李文之前第一句说了什么' -> 【查看区间】李文,1-1【/查看区间】",
    "- '本次会话第一条我发的' -> 【查看区间】user,1-1【/查看区间】",
    "- '把我最早那句翻出来' -> 优先理解成用户自己的发言序列，再决定区间。",
    "- '整个会话第二条是什么' -> 【查看区间】2-2【/查看区间】",
    "",
    "If the target detail is in the blind spot, output ONLY the marker.",
    turnHint,
    "【检索指令】",
  ].join("\n");
}

function parseRequestedRangeFromText(text, maxEnd) {
  const raw = String(text || "");
  if (!raw) return null;
  const upperBound = Number.isFinite(maxEnd) && maxEnd > 0 ? maxEnd : Number.MAX_SAFE_INTEGER;
  if (window.__chatRetrieval?.parseBlindRangeFromUserText) {
    const parsed = window.__chatRetrieval.parseBlindRangeFromUserText(raw, upperBound);
    if (parsed?.start && parsed?.end) {
      return parsed;
    }
  }
  return null;
}

function inferScopedRangePreference(session, latestUserContent) {
  const text = String(latestUserContent || "").trim();
  if (!text) return null;
  const visibleMessages = getVisibleHistoryMessages(session);
  const maxEnd = visibleMessages.length || Number.MAX_SAFE_INTEGER;
  const requestedRange = parseRequestedRangeFromText(text, maxEnd);
  if (!requestedRange) {
    return null;
  }

  const asksUserOwnUtterance = /(?:我(?:说的|发的|写的)|我的(?:发言|消息|话|那句|那条)|我最早那句|我第一条|我第二条|我第\d+条)/.test(text);
  if (asksUserOwnUtterance) {
    return {
      scope: "user",
      start: requestedRange.start,
      end: requestedRange.end,
      reason: "user-utterance-semantics",
    };
  }

  const availableScopes = Array.from(new Set([
    ...((session.historicalScopeNames || []).filter(Boolean)),
    ...(session.messages || [])
      .filter((m) => m && m.role !== "system" && m.content && !m.pending)
      .map((m) => m.role === "user" ? "user" : (m.speaker || "assistant"))
      .filter(Boolean),
  ]));
  const matchedScope = availableScopes.find((scopeName) => {
    if (!scopeName || scopeName === "user" || scopeName === "assistant") return false;
    return text.includes(scopeName);
  });
  if (matchedScope) {
    return {
      scope: matchedScope,
      start: requestedRange.start,
      end: requestedRange.end,
      reason: "named-speaker-semantics",
    };
  }

  return null;
}

function maybeNormalizeDirectorRangeRequest(session, latestUserContent, rangeReq) {
  if (!rangeReq) return null;
  if (rangeReq.scope) return rangeReq;
  const preferred = inferScopedRangePreference(session, latestUserContent);
  if (!preferred) return rangeReq;
  if (preferred.start !== rangeReq.start || preferred.end !== rangeReq.end) {
    return rangeReq;
  }
  return {
    start: rangeReq.start,
    end: rangeReq.end,
    scope: preferred.scope,
    raw: `${preferred.scope},${rangeReq.start}-${rangeReq.end}`,
    normalizedFrom: rangeReq.raw || `${rangeReq.start}-${rangeReq.end}`,
    normalizedReason: preferred.reason,
  };
}

function buildDirectorRetryInstruction() {
  return [
    "你的上一条输出不是 JSON，已被丢弃。",
    "现在重新输出，只输出 JSON 对象，一行。",
    "不要自然语言、不要解释、不要 markdown、不要\"旁白：\"前缀。",
    "",
    "⚠️ 重新判断 responders：",
    "检查用户最新消息中的名字。",
    '"小夏荷"匹配"夏荷"，"春桃姐"匹配"春桃"——昵称/简称也要算。',
    "上一轮有 NPC 回复过用户，用户在追问 → 该 NPC 必须进 responders。",
    "创作模式中，如果用户只是没点名 NPC，但发出了普通对话/动作/询问 → narration 或 responders 至少一个必须非空。",
    "如果 responders 为空，narration 必须写出这一拍的场景推进、气氛反应或动作描写。",
    "只有用户明确要求等待、沉默、无人回应时，narration 和 responders 才可以同时为空。",
  ].join("\n");
}

function buildDirectorRetrievalFollowUpMessages(retrievedText, latestUserContent, typeLabel) {
  const messages = [
    { role: "system", content: retrievedText },
    {
      role: "system",
      content: [
        `The ${typeLabel} block above is authoritative retrieved history for the director.`,
        "Use it to decide narration/responders/spawn_npcs/parallel_groups.",
        "Now output ONLY the JSON object. Do not output another retrieval marker unless the retrieved block is still insufficient.",
      ].join(" "),
    },
  ];
  if (latestUserContent) {
    messages.push({
      role: "user",
      content: [
        "用户当前最新输入：",
        latestUserContent,
        "",
        "请结合上面的检索结果继续调度，并且只输出 JSON 对象。",
      ].join("\n"),
    });
  }
  return messages;
}

async function executeDirectorRetrieval(session, traceMessage, content) {
  if (!window.__chatRetrieval || !traceMessage) {
    return null;
  }
  const rawOutput = String(content || "");
  const latestUserContent = getLatestUserMessageText(session).trim();
  const rawRangeReq = window.__chatRetrieval.extractRangeRequest(rawOutput);
  const rangeReq = maybeNormalizeDirectorRangeRequest(session, latestUserContent, rawRangeReq);
  if (rangeReq) {
    debugLog("director", "导演触发区间查看", rangeReq);
    appendToolTraceStep(traceMessage, {
      tool: "区间查看",
      label: "emit",
      command: `range ${rangeReq.raw || `${rangeReq.start}-${rangeReq.end}`}`,
      status: "running",
      detail: [
        `marker=${rawOutput}`,
        `range=${rangeReq.raw || `${rangeReq.start}-${rangeReq.end}`}`,
        rangeReq.normalizedFrom ? `normalized_from=${rangeReq.normalizedFrom}` : "",
        rangeReq.normalizedReason ? `normalized_reason=${rangeReq.normalizedReason}` : "",
      ].filter(Boolean).join("\n"),
    });
    traceMessage.content = "";
    traceMessage.retrieving = true;
    traceMessage.streaming = false;
    touchSession(session);
    persistSessions();
    renderMessages({ stickToBottom: true });
    setInlineChatStatus("导演正在检索历史...");
    const rangeResult = window.__chatRetrieval.executeRangeRetrieval(
      session,
      rangeReq.start,
      rangeReq.end,
      rangeReq.scope || null
    );
    if (!rangeResult?.text) {
      updateLastToolTraceStep(traceMessage, {
        status: "miss",
        detail: `marker=${rawOutput}\nrange=${rangeReq.raw || `${rangeReq.start}-${rangeReq.end}`}\nresult=miss`,
      });
      traceMessage.retrieving = false;
      traceMessage.streaming = false;
      touchSession(session);
      persistSessions();
      renderMessages({ stickToBottom: true });
      return {
        injectedMessages: [{
          role: "system",
          content: `你刚才请求的区间 ${rangeReq.raw || `${rangeReq.start}-${rangeReq.end}`} 没有检索到结果。请不要重复同一请求；若无必要，直接基于当前可见上下文输出 JSON。`,
        }],
        traceMessage,
      };
    }
    appendToolTraceStep(traceMessage, {
      tool: "区间查看",
      label: "hit",
      status: "running",
      detail: [
        `range=${rangeReq.raw || `${rangeReq.start}-${rangeReq.end}`}`,
        `count=${rangeResult.count}`,
        "preview=",
        buildToolTracePreviewDetail(rangeResult.text),
      ].join("\n"),
    });
    appendToolTraceStep(traceMessage, {
      tool: "区间查看",
      label: "inject",
      status: "running",
      detail: `system_len=${(rangeResult.text || "").length}\ncount=${rangeResult.count}`,
    });
    updateLastToolTraceStep(traceMessage, { status: "done" });
    traceMessage.retrieving = false;
    traceMessage.streaming = true;
    touchSession(session);
    persistSessions();
    renderMessages({ stickToBottom: true });
    return {
      injectedMessages: buildDirectorRetrievalFollowUpMessages(rangeResult.text, latestUserContent, "historical range"),
      traceMessage,
    };
  }

  const searchQuery = window.__chatRetrieval.extractSearchQuery(rawOutput);
  if (!searchQuery) {
    return null;
  }
  const preferredRange = inferScopedRangePreference(session, latestUserContent);
  if (preferredRange) {
    const normalizedRangeReq = {
      start: preferredRange.start,
      end: preferredRange.end,
      scope: preferredRange.scope,
      raw: `${preferredRange.scope},${preferredRange.start}-${preferredRange.end}`,
      normalizedFrom: searchQuery,
      normalizedReason: preferredRange.reason,
    };
    return executeDirectorRetrieval(
      session,
      traceMessage,
      `【查看区间】${normalizedRangeReq.raw}【/查看区间】`
    );
  }
  debugLog("director", "导演触发历史搜索", { query: searchQuery });
  appendToolTraceStep(traceMessage, {
    tool: "历史搜索",
    label: "emit",
    command: `search ${searchQuery}`,
    status: "running",
    detail: `marker=${rawOutput}\nquery=${searchQuery}`,
  });
  traceMessage.content = "";
  traceMessage.retrieving = true;
  traceMessage.streaming = false;
  touchSession(session);
  persistSessions();
  renderMessages({ stickToBottom: true });
  setInlineChatStatus("导演正在检索历史...");
  const searchResult = await window.__chatRetrieval.executeSearch(searchQuery, {
    maxResults: 8,
    contextRange: 4,
    sessionId: session.id,
  });
  if (!searchResult?.text) {
    updateLastToolTraceStep(traceMessage, {
      status: "miss",
      detail: `marker=${rawOutput}\nquery=${searchQuery}\nresult=miss`,
    });
    traceMessage.retrieving = false;
    traceMessage.streaming = false;
    touchSession(session);
    persistSessions();
    renderMessages({ stickToBottom: true });
    return {
      injectedMessages: [{
        role: "system",
        content: `你刚才请求搜索“${searchQuery}”，但没有命中结果。请不要重复同一搜索；若无必要，直接基于当前可见上下文输出 JSON。`,
      }],
      traceMessage,
    };
  }
  appendToolTraceStep(traceMessage, {
    tool: "历史搜索",
    label: "hit",
    status: "running",
    detail: [
      `query=${searchQuery}`,
      `count=${searchResult.count}`,
      "preview=",
      buildToolTracePreviewDetail(searchResult.text),
    ].join("\n"),
  });
  appendToolTraceStep(traceMessage, {
    tool: "历史搜索",
    label: "inject",
    status: "running",
    detail: `system_len=${(searchResult.text || "").length}\ncount=${searchResult.count}`,
  });
  updateLastToolTraceStep(traceMessage, { status: "done" });
  traceMessage.retrieving = false;
  traceMessage.streaming = true;
  touchSession(session);
  persistSessions();
  renderMessages({ stickToBottom: true });
  return {
    injectedMessages: buildDirectorRetrievalFollowUpMessages(searchResult.text, latestUserContent, "search result"),
    traceMessage,
  };
}

async function runSessionTurn(session) {
  if (!session) {
    return;
  }
  await ensureHistoricalScopeNames(session);

  // @mention direct routing — skip director, hand off to the named NPC
  if (session.mode === SESSION_MODE_WORK) {
    const userMsgs = session.messages.filter((m) => m.role === "user");
    const lastUser = userMsgs[userMsgs.length - 1];
    if (lastUser) {
        const mention = resolveDirectMentionTarget(session, lastUser.content);
      if (mention?.npc) {
        const targetNpc = mention.npc;
        const before = lastUser.content.slice(0, mention.atPos);
        const after = lastUser.content.slice(mention.endPos);
        const strippedContent = `${before} ${after}`.replace(/\s+/g, " ").trim();
        lastUser.content = strippedContent || lastUser.content;
        try {
          setInlineChatStatus(`${targetNpc.name} 正在回复...`);
          await callNpc(session, targetNpc, {});
          touchSession(session);
          persistSessions();
          renderMessages({ stickToBottom: true });
          renderChatListMenu();
          setText(els.chatStatus, `${targetNpc.name} 已回复`);
          // ── 搜索标记检测 ──
          if (window.__chatRetrieval && !state.abortController?.signal.aborted) {
            const lastResp = session.messages.filter(function (m) { return m.role === "assistant" && !m.uiType; });
            const lastAssistant = lastResp.length ? lastResp[lastResp.length - 1] : null;
            if (lastAssistant && lastAssistant._contextMessages) {
              await handleSearchMarker(session, lastAssistant, targetNpc, lastAssistant._contextMessages);
            }
          }
        } catch (error) {
          if (error.name === 'AbortError') {
            session.messages.forEach(m => { m.streaming = false; m.pending = false; });
            session.messages.push({ role: "system", speaker: "系统", content: t("chat.stoppedHint"), createdAt: new Date().toISOString() });
            touchSession(session);
            persistSessions();
            renderMessages();
            renderChatListMenu();
            setText(els.chatStatus, t("chat.stopped"));
          } else {
            debugLog("turn", t("debug.msg.turnFailed"), {
              sessionId: session.id,
              error: error.message,
            });
            console.error("[MOYU] @mention routing failed", {
              sessionId: session.id,
              mentionedName: targetNpc.name,
              error: error.message,
            });
            session.messages.push({
              role: "system",
              speaker: "系统",
              content: `@${targetNpc.name} 回复失败：${error.message}`,
              createdAt: new Date().toISOString(),
            });
            renderMessages({ stickToBottom: true });
            persistSessions();
            setText(els.chatStatus, `@${targetNpc.name} 回复失败`);
          }
        } finally {
          state.abortController = null;
          state.isSending = false;
          clearInlineChatStatus();
          els.sendBtn.disabled = false;
          els.chatInput.disabled = false;
          finishUserTopAnchor();
          autoResizeChatInput();
          updateComposerMode();
          if (!window.matchMedia?.("(pointer: coarse)").matches) {
            queueMicrotask(() => els.chatInput.focus());
          }
          scheduleAutoCompressAfterTurn(session);
        }
        return;
      }
    }
  }

  const isNoDirector = session.mode === SESSION_MODE_WORK && !session.directorModel && session.npcs.length === 1;

  if (isNoDirector) {
    try {
      const npc = session.npcs[0];
      setInlineChatStatus(`${npc.name} 正在回复...`);
      await callNpc(session, npc, {});
      touchSession(session);
      persistSessions();
      renderMessages({ stickToBottom: true });
      renderChatListMenu();
      setText(els.chatStatus, `${npc.name} 已回复`);
      // ── 搜索标记检测：模型主动请求的历史检索 ──
      let didSearch = false;
      if (window.__chatRetrieval && !state.abortController?.signal.aborted) {
        const lastResp = session.messages.filter(function (m) { return m.role === "assistant" && !m.uiType; });
        const lastAssistant = lastResp.length ? lastResp[lastResp.length - 1] : null;
        if (lastAssistant && lastAssistant._contextMessages) {
          didSearch = await handleSearchMarker(session, lastAssistant, npc, lastAssistant._contextMessages);
        }
      }

      // ── 保险：模型未输出标记但用户明显在问盲区索引 ──
      if (!didSearch && window.__chatRetrieval && !state.abortController?.signal.aborted) {
        const totalMsgs = (session.messages || []).filter(function (m) { return m && m.role !== "system" && m.content && !m.pending; }).length;
        const blindEnd = totalMsgs > 30 ? totalMsgs - 30 : 0;
        if (blindEnd > 0) {
          const lastUserMsg = session.messages.filter(function (m) { return m.role === "user"; });
          const lastUserContent = lastUserMsg.length ? lastUserMsg[lastUserMsg.length - 1].content : "";
          const explicitRetrievalCue = /(?:查看|检索|搜索|查找|回看|回顾|翻到|看下|看看|第\d+条|第\d+轮|第\d+到\d+条|第\d+到\d+轮)/.test(lastUserContent);
          const blindRange = window.__chatRetrieval.parseBlindRangeFromUserText
            ? (explicitRetrievalCue ? window.__chatRetrieval.parseBlindRangeFromUserText(lastUserContent, blindEnd) : null)
            : null;
          if (blindRange) {
            debugInfo("[MOYU-SEARCH] 模型未输出标记，自动执行历史区间检索", blindRange);
            setText(els.chatStatus, "正在检索历史记录...");
            const lastResp2 = session.messages.filter(function (m) { return m.role === "assistant" && !m.uiType; });
            const lastAssistant2 = lastResp2.length ? lastResp2[lastResp2.length - 1] : null;
            if (lastAssistant2 && lastAssistant2._contextMessages) {
              const success = await window.__chatRetrieval.followUpStreamRange(
                session, lastAssistant2, blindRange.start, blindRange.end, blindRange.scope || null, npc, lastAssistant2._contextMessages
              );
              if (success) {
                setText(els.chatStatus, "已检索相关历史记录");
              } else {
                lastAssistant2.content = "（区间检索失败或无结果）";
                lastAssistant2.pending = false;
                lastAssistant2.streaming = false;
                touchSession(session);
                persistSessions();
                renderMessages({ stickToBottom: true });
                setText(els.chatStatus, "区间检索失败或无结果");
              }
            }
          }
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        session.messages.forEach(m => { m.streaming = false; m.pending = false; });
        session.messages.push({ role: "system", speaker: "系统", content: t("chat.stoppedHint"), createdAt: new Date().toISOString() });
        touchSession(session);
        persistSessions();
        renderMessages();
        renderChatListMenu();
        setText(els.chatStatus, t("chat.stopped"));
      } else {
        debugLog("turn", t("debug.msg.turnFailed"), {
          sessionId: session.id,
          error: error.message,
        });
        console.error("[MOYU] Session turn failed", {
          sessionId: session.id,
          error: error.message,
          host: session.host,
        });
        session.messages.push({
          role: "system",
          speaker: "系统",
          content: `本轮生成失败：${error.message}`,
          createdAt: new Date().toISOString(),
        });
        renderMessages({ stickToBottom: true });
        persistSessions();
        setText(els.chatStatus, "本轮回复失败");
      }
    } finally {
      state.abortController = null;
      state.isSending = false;
      clearInlineChatStatus();
      els.sendBtn.disabled = false;
      els.chatInput.disabled = false;
      finishUserTopAnchor();
      autoResizeChatInput();
      updateComposerMode();
      if (!window.matchMedia?.("(pointer: coarse)").matches) {
        queueMicrotask(() => els.chatInput.focus());
      }
      scheduleAutoCompressAfterTurn(session);
    }
    return;
  }

  try {
    setInlineChatStatus("导演正在调度...");
    debugLog("turn", t("debug.msg.directorTurnStarted"), {
      sessionId: session.id,
      messageCount: session.messages.length,
      transientNpcCount: (session.transientNpcs || []).length,
    });
    const directorResult = await callDirector(session);
    const directive = directorResult?.directive || directorResult;
    const directorTraceMessage = directorResult?.traceMessage || null;
    debugLog("director", t("debug.msg.directiveAccepted"), directive);
    if (directive.spawnNpcs?.length) {
      upsertTransientNpcs(session, directive.spawnNpcs);
      debugLog("director", t("debug.msg.transientNpcsUpdated"), session.transientNpcs || []);
      touchSession(session);
      persistSessions();
    }
    if (!directive.narration && !directive.responders?.length && session.mode === SESSION_MODE_STORY && getLatestUserMessageText(session).trim()) {
      directive.narration = "片刻的沉默落在场间，气氛随之有了细微变化。";
      debugLog("director", "导演空响应旁白兜底", {
        narration: directive.narration,
        reason: "story turn needs narration or responders",
      });
    }
    if (directive.narration) {
      const narrationMessage = directorTraceMessage || {
        id: `narration-${Date.now()}`,
        role: "assistant",
        speaker: "导演 AI",
        uiType: "narration",
        content: "",
        createdAt: new Date().toISOString(),
        pending: false,
        streaming: true,
      };
      narrationMessage.usage = directive.usage || null;
      narrationMessage.estimatedUsage = directive.usage ? null : {
        input: estimateChatMessagesTokens([
          { role: "system", content: getDirectorSystemPrompt(session) },
          { role: "system", content: "固定 NPC 列表：" + JSON.stringify(session.npcs.map((npc) => npc.name)) },
          { role: "system", content: "场内 NPC：" + JSON.stringify(getSceneNpcs(session).map((npc) => npc.name)) },
          { role: "system", content: "全局设定：" + session.globalPrompt },
          ...buildDirectorContextMessages(session),
        ]),
        output: estimateTokens(directive.narration),
        total: 0,
      };
      if (narrationMessage.estimatedUsage) {
        narrationMessage.estimatedUsage.total = narrationMessage.estimatedUsage.input + narrationMessage.estimatedUsage.output;
      }
      narrationMessage.pending = false;
      narrationMessage.streaming = true;
      narrationMessage.retrieving = false;
      if (!directorTraceMessage) {
        session.messages.push(narrationMessage);
      }
      renderMessages({ stickToBottom: true });
      await streamLocalText(narrationMessage, directive.narration);
      touchSession(session);
      persistSessions();
    } else if (directorTraceMessage) {
      directorTraceMessage.content = "";
      directorTraceMessage.pending = false;
      directorTraceMessage.streaming = false;
      directorTraceMessage.retrieving = false;
      touchSession(session);
      persistSessions();
      renderMessages({ stickToBottom: true });
    }

    let responders = getResponderNpcs(session, directive.responders);
    debugLog("director", t("debug.msg.respondersResolved"), responders.map((npc) => ({
      name: npc.name,
      model: npc.model,
      transient: Boolean(npc.transient),
    })));
    if (!responders.length) {
      setText(els.chatStatus, directive.narration ? "旁白已更新，本轮没有 NPC 需要回答" : "本轮没有 NPC 需要回答");
    } else {
      const parallelGroups = resolveNpcParallelGroups(session, responders, directive);
      debugLog("director", getNpcGroupDebugLabel(parallelGroups), parallelGroups.map((group) => group.map((npc) => npc.name)));
      for (const group of parallelGroups) {
        await callNpcGroup(session, group, directive.npcInstructions);
      }
      debugLog("turn", t("debug.msg.npcRepliesCompleted"), responders.map((npc) => npc.name));
      setText(els.chatStatus, "本轮回复已完成");
    }

    touchSession(session);
    persistSessions();
    renderMessages({ stickToBottom: true });
    renderChatListMenu();
  } catch (error) {
    debugLog("turn", t("debug.msg.turnFailed"), {
      sessionId: session.id,
      error: error.message,
    });
    console.error("[MOYU] Session turn failed", {
      sessionId: session.id,
      error: error.message,
      host: session.host,
      directorModel: session.directorModel,
    });
    if (error.name === 'AbortError') {
      session.messages.forEach(m => { m.streaming = false; m.pending = false; });
      session.messages.push({ role: "system", speaker: "系统", content: t("chat.stoppedHint"), createdAt: new Date().toISOString() });
      touchSession(session);
      persistSessions();
      renderMessages();
      renderChatListMenu();
      setText(els.chatStatus, t("chat.stopped"));
    } else {
      session.messages.push({
        role: "system",
        speaker: "系统",
        content: `本轮生成失败：${error.message}`,
        createdAt: new Date().toISOString(),
      });
      touchSession(session);
      persistSessions();
      renderMessages();
      renderChatListMenu();
      setText(els.chatStatus, `生成失败：${error.message}`);
    }
  } finally {
    state.abortController = null;
    state.isSending = false;
    clearInlineChatStatus();
    els.sendBtn.disabled = false;
    els.chatInput.disabled = false;
    finishUserTopAnchor();
    autoResizeChatInput();
    updateComposerMode();
    if (!window.matchMedia?.("(pointer: coarse)").matches) {
      queueMicrotask(() => els.chatInput.focus());
    }
    scheduleAutoCompressAfterTurn(session);
  }
}

async function ensureHistoricalScopeNames(session) {
  if (!session?.id || !window.__chatDB?.getSessionScopeNames) {
    return;
  }
  try {
    const dbScopes = await window.__chatDB.getSessionScopeNames(session.id);
    const runtimeScopes = Array.from(new Set(
      (session.messages || [])
        .filter((m) => m && m.role !== "system" && m.content && !m.pending)
        .map((m) => m.role === "user" ? "user" : (m.speaker || "assistant"))
        .filter(Boolean)
    ));
    session.historicalScopeNames = Array.from(new Set([...(dbScopes || []), ...runtimeScopes]));
    debugInfo("[MOYU-SEARCH] historical scope names", {
      sessionId: session.id,
      dbScopes: dbScopes || [],
      runtimeScopes,
      mergedScopes: session.historicalScopeNames,
    });
  } catch (error) {
    debugWarn("[MOYU] failed to load historical scope names", {
      sessionId: session?.id,
      error: error?.message || String(error),
    });
  }
}

async function callDirector(session) {
  await ensureDirectorSummary(session);
  const sceneNpcNames = getSceneNpcs(session).map((npc) => npc.name);
  const fixedNpcNames = session.npcs.map((npc) => npc.name);

  let messages = [
    { role: "system", content: getDirectorSystemPrompt(session) },
    { role: "system", content: "固定 NPC 列表：" + JSON.stringify(fixedNpcNames) },
    { role: "system", content: "场内 NPC：" + JSON.stringify(sceneNpcNames) },
    { role: "system", content: "NPC 资料：" + buildDirectorNpcRoster(session) },
    { role: "system", content: "全局设定：" + session.globalPrompt },
    ...(session.mode === SESSION_MODE_STORY ? [{
      role: "system",
      content: DIRECTOR_STORY_MODE_RULES,
    }] : []),
    {
      role: "system",
      content: DIRECTOR_PARALLEL_GROUPS_RULES,
    },
    ...(session.mode === SESSION_MODE_STORY ? [{
      role: "system",
      content: DIRECTOR_STORY_SCHEDULING_RULES,
    }] : []),
    ...buildDirectorContextMessages(session),
  ];

  if (getSessionSetting(session, "directorDispatchOnly")) {
    messages.push({ role: "system", content: DIRECTOR_DISPATCH_ONLY_RULE });
  }

  const directorRetrievalRule = buildDirectorRetrievalRule(session);
  if (directorRetrievalRule) {
    messages = insertSystemMessageBeforeLastUser(messages, directorRetrievalRule);
  }

  const retryInstruction = buildDirectorRetryInstruction();
  let retrievalMessages = [];
  let retrievalHops = 0;
  let needsRetryInstruction = false;
  let directorTraceMessage = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    debugLog("director", t("debug.msg.requestAttempt"), {
      sessionId: session.id,
      attempt: attempt + 1,
      model: session.directorModel,
    });
    const requestMessages = [
      ...messages,
      ...retrievalMessages,
      ...(needsRetryInstruction ? [{ role: "system", content: retryInstruction }] : []),
    ];

    const directorConfig = resolveModelConfig(session.directorConfigId, session.directorModel, session.configId);
    const directorExtra = buildThinkingExtra(session.directorModel, state.directorThinking);
    const promptMessages = !state.directorThinking && !supportsThinkingParam(session.directorModel)
      ? [...requestMessages, { role: "system", content: "直接输出，不要输出思考过程。" }]
      : requestMessages;
    const dirAgentTemp = typeof getSessionAgentParam === "function"
      ? getSessionAgentParam(session, "director", "temperature")
      : undefined;
    const dirEffectiveTemp = dirAgentTemp !== undefined ? dirAgentTemp : 0.5;
    const payload = await createChatCompletionPayload(directorConfig.host, directorConfig.key, session.directorModel, promptMessages, false, dirEffectiveTemp, directorExtra);
    const content = payload.content;
    debugLog("director", t("debug.msg.rawResponseReceived"), {
      attempt: attempt + 1,
      content,
    });

    if (window.__chatRetrieval) {
      const retrievalMarker = window.__chatRetrieval.extractRangeRequest(content) || window.__chatRetrieval.extractSearchQuery(content);
      if (retrievalMarker) {
        if (retrievalHops >= 3) {
          throw new Error("导演检索次数过多，已停止继续检索");
        }
        directorTraceMessage = ensureDirectorTraceMessage(session, directorTraceMessage);
        const retrievalResult = await executeDirectorRetrieval(session, directorTraceMessage, content);
        if (!retrievalResult?.injectedMessages?.length) {
          throw new Error("导演检索执行失败");
        }
        retrievalMessages = retrievalMessages.concat(retrievalResult.injectedMessages);
        retrievalHops += 1;
        needsRetryInstruction = false;
        setInlineChatStatus("导演正在调度...");
        attempt -= 1;
        continue;
      }
    }

    try {
      const directive = parseDirectorDirective(content, session);
      directive.usage = normalizeUsage(payload.usage) || {
        input: estimateChatMessagesTokens(requestMessages),
        output: estimateTokens(content),
        total: estimateChatMessagesTokens(requestMessages) + estimateTokens(content),
      };
      return {
        directive,
        traceMessage: directorTraceMessage,
      };
    } catch (jsonError) {
      debugLog("director", t("debug.msg.invalidResponseRetrying"), {
        attempt: attempt + 1,
        error: jsonError.message,
        content,
      });

      if (attempt >= 1) {
        try {
          const repaired = await repairDirectorDirective(session, [...messages, ...retrievalMessages], content, attempt + 1);
          debugLog("director", t("debug.msg.repairResponseAccepted"), repaired);
          return {
            directive: repaired,
            traceMessage: directorTraceMessage,
          };
        } catch (repairError) {
          debugLog("director", t("debug.msg.repairResponseFailed"), {
            attempt: attempt + 1,
            error: repairError.message,
          });
        }
      }

      if (attempt === 3) {
        throw jsonError;
      }
      needsRetryInstruction = true;
      await wait(180);
    }
  }

  throw new Error("导演没有返回有效 JSON");
}

async function repairDirectorDirective(session, baseMessages, invalidContent, attempt) {
  const fixedNpcNames = (session.npcs || []).map((npc) => npc.name);
  await ensureDirectorSummary(session);
  const repairMessages = [
    { role: "system", content: getDirectorSystemPrompt(session) },
    {
      role: "system",
      content: [
        "上一次输出不是合法 JSON，已被丢弃。现在你的唯一任务：把下面那段错误输出修复成一个可解析的 JSON。",
        "",
        "关键约束：",
        "- 如果用户明确在对某个 NPC 说话（提到了名字或话锋指向），必须把该 NPC 放入 responders。",
        "- 如果一个 responder 的名字【不在固定 NPC 列表中】（列表见下方），则它【必须同时出现在 spawn_npcs 中】。",
        "  通用示例：固定列表为 [\"服务员\", \"厨师\"]，用户说\"老板，你这菜多少钱\"",
        "  → \"老板\"不在固定列表中，所以 responders: [\"老板\"], spawn_npcs: [{\"name\":\"老板\",\"prompt\":\"餐馆老板\"}]",
        "- 禁止增加剧情、禁止补写旁白、禁止添加原创内容。",
        "- 只输出 JSON，无解释，无前后缀，无 markdown。",
        "",
        `固定 NPC 列表：${fixedNpcNames.join("、") || "无"}`,
      ].join("\n"),
    },
    { role: "system", content: `NPC 资料：${buildDirectorNpcRoster(session)}` },
    { role: "system", content: `全局设定：\n${session.globalPrompt}` },
    { role: "system", content: `已有 NPC：${fixedNpcNames.join("、") || "无"}` },
    ...buildDirectorContextMessages(session),
    {
      role: "user",
      content: [
        "把下面这段错误输出修复成严格 JSON（不要新增剧情，不要解释，只返回 JSON）：",
        invalidContent,
      ].join("\n"),
    },
  ];

  debugLog("director", t("debug.msg.repairAttempt"), {
    sessionId: session.id,
    attempt,
    invalidContent,
  });

  const directorConfig = resolveModelConfig(session.directorConfigId, session.directorModel, session.configId);
  const repairedPayload = await createChatCompletionPayload(directorConfig.host, directorConfig.key, session.directorModel, repairMessages, false, 0.5);
  const repairedContent = repairedPayload.content;
  debugLog("director", t("debug.msg.repairRawResponse"), {
    attempt,
    content: repairedContent,
  });
  const directive = parseDirectorDirective(repairedContent, session);
  directive.usage = normalizeUsage(repairedPayload.usage) || {
    input: estimateChatMessagesTokens(repairMessages),
    output: estimateTokens(repairedContent),
    total: estimateChatMessagesTokens(repairMessages) + estimateTokens(repairedContent),
  };
  return directive;
}

async function generateSessionTitle(session) {
  if (!session || session.titleSource === "manual") {
    return;
  }

  try {
    const messages = [
      {
        role: "system",
        content: TITLE_GENERATION_PROMPT,
      },
      {
        role: "user",
        content: [
          `全局设定：${session.globalPrompt}`,
          `NPC：${session.npcs.map((npc) => npc.name).join("、") || "无"}`,
        ].join("\n"),
      },
    ];

    const isNoDirector = !session.directorModel;
    const titleModel = isNoDirector ? (session.npcs[0]?.model || "") : session.directorModel;
    const titleConfigId = isNoDirector ? (session.npcs[0]?.configId || "") : session.directorConfigId;
    const directorConfig = resolveModelConfig(titleConfigId, titleModel, session.configId);
    const content = await createChatCompletion(directorConfig.host, directorConfig.key, titleModel, messages, false);
    const title = sanitizeGeneratedTitle(content);
    if (!title) {
      return;
    }

    const latestSession = state.sessions.find((item) => item.id === session.id);
    if (!latestSession || latestSession.titleSource === "manual") {
      return;
    }

    latestSession.title = title;
    latestSession.titleSource = "auto";
    touchSession(latestSession);
    persistSessions();
    renderSession();
  } catch {
    const latestSession = state.sessions.find((item) => item.id === session.id);
    if (!latestSession || latestSession.titleSource === "manual") {
      return;
    }
    latestSession.title = buildFallbackTitle(latestSession);
    latestSession.titleSource = "auto";
    touchSession(latestSession);
    persistSessions();
    renderSession();
  }
}

async function ensureDirectorSummary(session, options = {}) {
  if (!session) {
    return false;
  }

  const recentLimit = options.recentLimit ?? DIRECTOR_RECENT_HISTORY_LIMIT;
  const force = Boolean(options.force);
  const mode = options.mode || (force ? "manual" : "auto");
  const allowAutoMerge = Boolean(options.allowAutoMerge);
  const candidateMessages = getCompressibleDirectorMessages(session, recentLimit);

  if (mode !== "manual") {
    // 只衡量导演记忆本身（排除系统提示词、NPC 资料等固定开销），
    // 因为压缩只能缩小记忆内容，无法减少固定开销。
    const memoryOnlyContext = buildDirectorMemorySystemMessage(session);
    const threshold = DIRECTOR_MEMORY_TARGET_MAX;
    const memoryTokens = estimateChatMessagesTokens(memoryOnlyContext);

    debugInfo("[MOYU:compress]", mode, "mode", {
      memoryTokens,
      threshold,
      candidateCount: candidateMessages.length,
      recentLimit,
    });

    if (memoryTokens >= threshold) {
      // 记忆超阈值 → 全量重压缩（像手动压缩一样收紧记忆）
      debugWarn("[MOYU:compress] 记忆超阈值，触发全量重压缩", { memoryTokens, threshold });
      return ensureDirectorSummary(session, { force: true, mode: "manual", recentLimit: DIRECTOR_MANUAL_RECENT_HISTORY_LIMIT });
    }

    if (!candidateMessages.length) {
      return false;
    }

    if (!allowAutoMerge) {
      debugInfo("[MOYU:compress]", "跳过自动合并新增历史", {
        reason: "auto-merge-not-allowed",
        candidateCount: candidateMessages.length,
        recentLimit,
      });
      return false;
    }
  }

  const directorConfig = resolveModelConfig(session.directorConfigId, session.directorModel, session.configId);
  const currentMemoryBlock = buildDirectorMemoryBlock(session);
  const targetTokens = getDirectorMemoryTargetTokens(session, recentLimit);
  const summaryMessages = mode === "manual"
    ? [
        { role: "system", content: DIRECTOR_MANUAL_RECOMPRESS_PROMPT },
        { role: "system", content: `全局设定：\n${session.globalPrompt}` },
        { role: "system", content: `目标：把导演长期记忆尽量压到约 ${targetTokens} tokens 左右；允许略高，但不要明显膨胀。` },
        ...buildManualCompressSourceMessages(session, recentLimit),
        { role: "user", content: "请基于上面的当前长期记忆和最近历史，输出一份更短、更稳的导演长期记忆 JSON。" },
      ]
    : [
        { role: "system", content: DIRECTOR_SUMMARY_PROMPT },
        { role: "system", content: `全局设定：\n${session.globalPrompt}` },
        { role: "system", content: `目标：把新增历史并入长期记忆后，总记忆尽量控制在约 ${targetTokens} tokens 左右。` },
        ...buildDirectorMemorySystemMessage(session),
        ...buildHistoryMessagesFromSlice(candidateMessages, "待压缩历史"),
        { role: "user", content: "请把已有长期记忆与待压缩历史合并，输出更新后的导演长期记忆 JSON。" },
      ];

  const beforeRecentTokens = estimateChatMessagesTokens(buildHistoryMessagesFromSlice(getDirectorRecentMessages(session, recentLimit), "RECENT_HISTORY"));
  const beforeMemoryTokens = estimateTokens(currentMemoryBlock || String(session.directorSummary || ""));
  const beforeManualBudget = beforeMemoryTokens + beforeRecentTokens;

  debugInfo("[MOYU:compress]", "调用压缩模型", {
    model: session.directorModel,
    mode,
    targetTokens,
    beforeMemoryTokens,
    beforeRecentTokens,
  });

  let payload;
  try {
    payload = await createChatCompletionPayload(directorConfig.host, directorConfig.key, session.directorModel, summaryMessages, false, 0.4);
  } catch (apiError) {
    console.error("[MOYU:compress] 压缩 API 调用失败", {
      model: session.directorModel,
      host: directorConfig.host,
      message: apiError.message,
      status: apiError.status,
    });
    throw apiError;
  }

  debugInfo("[MOYU:compress]", "压缩模型返回", {
    contentLength: payload.content?.length || 0,
    usage: payload.usage,
  });
  debugInfo("[MOYU:compress]", "压缩结果文本", payload.content);
  const nextMemory = parseDirectorMemoryPayload(payload.content, session);
  const segmentSummary = mode === "manual" ? "" : extractDirectorSegmentSummary(payload.content, nextMemory);
  const nextMemoryBlock = buildDirectorMemoryBlock(nextMemory);
  const nextSummary = nextMemory.synopsis || nextMemoryBlock;
  const nextMemoryTokens = estimateTokens(nextMemoryBlock || nextSummary);
  const shouldApplyManualSummary = mode !== "manual"
    || !currentMemoryBlock
    || nextMemoryTokens <= Math.max(DIRECTOR_MEMORY_TARGET_MIN, beforeManualBudget);

  debugInfo("[MOYU:compress]", "解析结果", {
    mode,
    beforeMemoryTokens,
    nextMemoryTokens,
    shouldApply: shouldApplyManualSummary,
  });

  if (!shouldApplyManualSummary) {
    debugWarn("[MOYU:compress]", "未应用压缩结果", {
      reason: mode === "manual" ? "新记忆token超预算" : "非手动模式且无变更",
    });
    return false;
  }

  session.directorMemory = nextMemory;
  session.directorSummary = nextSummary;
  if (mode === "manual") {
    const visibleMessages = getVisibleHistoryMessages(session);
    session.compressedUntilMessageId = visibleMessages[visibleMessages.length - 1]?.id || session.compressedUntilMessageId || "";
    session.compressedUntilSequence = visibleMessages.length
      ? getMessageSequenceInSession(session, visibleMessages[visibleMessages.length - 1])
      : (Number.isFinite(session.compressedUntilSequence) ? session.compressedUntilSequence : null);
  } else {
    appendCompressionSegment(session, "director", candidateMessages, segmentSummary);
    session.compressedUntilMessageId = candidateMessages[candidateMessages.length - 1]?.id || session.compressedUntilMessageId || "";
    session.compressedUntilSequence = candidateMessages.length
      ? getMessageSequenceInSession(session, candidateMessages[candidateMessages.length - 1])
      : (Number.isFinite(session.compressedUntilSequence) ? session.compressedUntilSequence : null);
  }
  touchSession(session);
  persistSessions();

  debugInfo("[MOYU:compress]", "压缩完成", {
    mode,
    beforeMemoryTokens,
    nextMemoryTokens,
    compressedUntilMessageId: session.compressedUntilMessageId,
  });
  return true;
}

async function ensureChatSummary(session, options = {}) {
  if (!session) return false;
  const force = Boolean(options.force);
  const npc = session.npcs?.[0];
  if (!npc?.model) return false;

  const configId = npc.configId || session.configId || "";
  const config = resolveModelConfig(configId, npc.model, session.configId);

  const visibleMessages = getVisibleHistoryMessages(session);
  const cutoffIdx = session?.compressedUntilMessageId
    ? visibleMessages.findIndex((m) => m.id === session.compressedUntilMessageId)
    : -1;
  const cutoffSeq = Number.isFinite(session?.compressedUntilSequence)
    ? session.compressedUntilSequence
    : Math.max(-1, ...(typeof getCompressionSegments === "function" ? getCompressionSegments(session, "chat").map((segment) => Number(segment.endSeq) || -1) : []));
  const unsummarizedMessages = cutoffIdx >= 0
    ? visibleMessages.slice(cutoffIdx + 1)
    : (cutoffSeq >= 0
      ? visibleMessages.filter((message) => !Number.isFinite(message.sequence) || message.sequence > cutoffSeq)
      : visibleMessages);
  const compressible = force
    ? visibleMessages.slice(0, Math.max(0, visibleMessages.length - 4))
    : unsummarizedMessages.slice(0, Math.max(0, unsummarizedMessages.length - 4));

  if (!compressible.length && !force) return false;

  const currentSummary = session.chatSummary || "";
  const summaryTokens = estimateTokens(currentSummary);
  const metrics = buildChatContextTokenMetrics(session);
  const contextCurrent = metrics?.contextCurrent || 0;
  const recentUnsummarizedCount = compressible.length;
  if (!force) {
    const thresholdHit = contextCurrent >= CHAT_AUTO_COMPRESS_THRESHOLD;
    const summaryTooLong = summaryTokens >= CHAT_AUTO_COMPRESS_THRESHOLD;
    const hasEnoughNewHistory = recentUnsummarizedCount >= 6;
    if (!thresholdHit && !summaryTooLong && !hasEnoughNewHistory) return false;
  }

  const recentMessages = force
    ? getRecentChatMessages(session, CHAT_MANUAL_RECOMPRESS_RECENT_LIMIT)
    : compressible;

  if (!recentMessages.length && !force) return false;

  // Build compression messages
  const compressMessages = [
    { role: "system", content: CHAT_COMPRESS_PROMPT },
    { role: "system", content: `全局设定：\n${session.globalPrompt}` },
  ];

  if (currentSummary) {
    compressMessages.push({ role: "system", content: `已有摘要：\n${currentSummary}` });
  }

  if (recentMessages.length) {
    const historyBlock = buildHistoryMessagesFromSlice(recentMessages, force ? "待重压对话" : "待压缩对话");
    compressMessages.push(...historyBlock);
  }

  compressMessages.push({ role: "user", content: "请基于已有摘要和新增对话，输出一份更新的简洁摘要。" });

  debugInfo("[MOYU:compress]", "单 AI 摘要压缩调用", {
    model: npc.model,
    force,
    summaryTokens,
    recentCount: recentMessages.length,
  });

  let payload;
  try {
    payload = await createChatCompletionPayload(config.host, config.key, npc.model, compressMessages, false, 0.4);
  } catch (apiError) {
    console.error("[MOYU:compress] 单 AI 压缩 API 调用失败", {
      model: npc.model,
      host: config.host,
      message: apiError.message,
      status: apiError.status,
    });
    throw apiError;
  }

  const nextSummary = (payload.content || "").trim();
  if (!nextSummary) return false;

  const nextTokens = estimateTokens(nextSummary);
  const beforeTokens = estimateTokens(currentSummary);

  debugInfo("[MOYU:compress]", "单 AI 摘要压缩结果", {
    beforeTokens,
    nextTokens,
    summaryLength: nextSummary.length,
  });

  session.chatSummary = nextSummary;
  if (recentMessages.length) {
    appendCompressionSegment(session, "chat", recentMessages, nextSummary);
    session.compressedUntilMessageId = recentMessages[recentMessages.length - 1]?.id || session.compressedUntilMessageId || "";
    session.compressedUntilSequence = getMessageSequenceInSession(session, recentMessages[recentMessages.length - 1]);
  }
  touchSession(session);
  persistSessions();

  return true;
}

let _autoCompressPending = false;

function setCompressionUiLocked(locked) {
  const shell = document.querySelector(".app-shell");
  if (shell) shell.classList.toggle("compress-lock", Boolean(locked));
}

function normalizeCompressionSegmentSummary(summary) {
  return String(summary || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s{0,3}(#{1,6}|[-*+>]|\d+\.)\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .trim();
}

function extractDirectorSegmentSummary(rawContent, fallbackMemory) {
  try {
    const parsed = parseDirectorJsonLoose(String(rawContent || ""));
    const segmentSummary = normalizeCompressionSegmentSummary(parsed?.segmentSummary);
    if (segmentSummary) return segmentSummary;
  } catch {}
  return normalizeCompressionSegmentSummary(fallbackMemory?.synopsis || buildDirectorMemoryBlock(fallbackMemory));
}

function appendCompressionSegment(session, kind, messages, summary) {
  if (!session || !Array.isArray(messages) || !messages.length) return null;
  const cleanSummary = normalizeCompressionSegmentSummary(summary);
  if (!cleanSummary) return null;

  const first = messages[0];
  const last = messages[messages.length - 1];
  const startSeq = getMessageSequenceInSession(session, first);
  const endSeq = getMessageSequenceInSession(session, last);
  const segment = {
    id: `seg-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    startMessageId: first?.id || "",
    endMessageId: last?.id || "",
    startSeq,
    endSeq,
    messageCount: messages.length,
    summary: cleanSummary,
    tokenCount: estimateTokens(cleanSummary),
    createdAt: new Date().toISOString(),
  };

  const segments = Array.isArray(session.compressionSegments) ? session.compressionSegments.slice() : [];
  const duplicateIndex = segments.findIndex((item) =>
    item && item.kind === kind && item.startSeq === startSeq && item.endSeq === endSeq
  );
  if (duplicateIndex >= 0) {
    segments[duplicateIndex] = { ...segments[duplicateIndex], ...segment };
  } else {
    segments.push(segment);
  }
  segments.sort((a, b) => (Number(a.startSeq) || 0) - (Number(b.startSeq) || 0));
  session.compressionSegments = segments.slice(-80);
  session.compressedUntilSequence = Math.max(Number(session.compressedUntilSequence) || -1, endSeq);
  return segment;
}

function scheduleAutoCompressAfterTurn(session) {
  if (!session?.id) return;
  const sessionId = session.id;
  setTimeout(() => {
    const latestSession = getCurrentSession();
    const targetSession = latestSession?.id === sessionId ? latestSession : session;
    void tryAutoCompressSession(targetSession);
  }, 0);
}

async function tryAutoCompressSession(session) {
  if (!session || state.isSending || _autoCompressPending) return;

  const isSingleAi = session.mode === SESSION_MODE_WORK && !session.directorModel && session.npcs.length === 1;

  if (isSingleAi) {
    await tryAutoCompressChat(session);
    return;
  }

  if (!session.directorModel) return;

  let metrics = buildDirectorContextTokenMetrics(session);
  let unsummarizedCount = 0;
  if (metrics) {
    const needsRecompress = metrics.contextCurrent >= metrics.contextThreshold;
    // 算未压缩消息数，超过 recentLimit 才有合并价值
    const visibleMessages = getVisibleHistoryMessages(session);
    const cutoffIdx = session?.compressedUntilMessageId
      ? visibleMessages.findIndex((m) => m.id === session.compressedUntilMessageId)
      : -1;
    const cutoffSeq = Number.isFinite(session?.compressedUntilSequence)
      ? session.compressedUntilSequence
      : Math.max(-1, ...(typeof getCompressionSegments === "function" ? getCompressionSegments(session, "director").map((segment) => Number(segment.endSeq) || -1) : []));
    unsummarizedCount = cutoffIdx >= 0
      ? Math.max(0, visibleMessages.length - cutoffIdx - 1)
      : (cutoffSeq >= 0
        ? visibleMessages.filter((message) => !Number.isFinite(message.sequence) || message.sequence > cutoffSeq).length
        : visibleMessages.length);
    const needsMerge = unsummarizedCount > DIRECTOR_RECENT_HISTORY_LIMIT;
    const hasEnoughFreshMessages = unsummarizedCount >= DIRECTOR_AUTO_COMPRESS_MIN_UNSUMMARIZED;
    const shouldAutoCompress = needsRecompress && hasEnoughFreshMessages;
    if (!shouldAutoCompress) {
      updateCompressMemoryButtonProgress(session);
      return;
    }
  }

  // Show state immediately
  updateCompressMemoryButtonProgress(session);

  debugInfo("[MOYU:compress]", "自动压缩触发", {
    sessionId: session.id,
    directorModel: session.directorModel,
    contextCurrent: metrics?.contextCurrent,
    contextThreshold: metrics?.contextThreshold,
    unsummarizedCount,
    minUnsummarized: DIRECTOR_AUTO_COMPRESS_MIN_UNSUMMARIZED,
    needsMerge,
  });

  const prevStatusText = els.chatStatus?.textContent || "";
  setText(els.chatStatus, "正在自动压缩导演记忆...");
  _autoCompressPending = true;
  setCompressionUiLocked(true);
  try {
    const changed = await ensureDirectorSummary(session, { allowAutoMerge: true });
    if (changed && getCurrentSession()?.id === session.id) {
      updateCompressMemoryButtonProgress(session);
      renderCompressMemoryPopover();
    }
    setText(els.chatStatus, prevStatusText || t("chat.statusReady"));
  } catch (error) {
    setText(els.chatStatus, prevStatusText || t("chat.statusReady"));
    console.error("[MOYU:compress]", "自动压缩失败", {
      message: error?.message || String(error),
      directorModel: session.directorModel,
      stack: error?.stack,
    });
  } finally {
    _autoCompressPending = false;
    setCompressionUiLocked(false);
  }
}

async function tryAutoCompressChat(session) {
  if (!session || state.isSending || _autoCompressPending) return;

  const visibleMessages = getVisibleHistoryMessages(session);
  const cutoffIdx = session?.compressedUntilMessageId
    ? visibleMessages.findIndex((m) => m.id === session.compressedUntilMessageId)
    : -1;
  const cutoffSeq = Number.isFinite(session?.compressedUntilSequence)
    ? session.compressedUntilSequence
    : Math.max(-1, ...(typeof getCompressionSegments === "function" ? getCompressionSegments(session, "chat").map((segment) => Number(segment.endSeq) || -1) : []));
  const unsummarizedMessages = cutoffIdx >= 0
    ? visibleMessages.slice(cutoffIdx + 1)
    : (cutoffSeq >= 0
      ? visibleMessages.filter((message) => !Number.isFinite(message.sequence) || message.sequence > cutoffSeq)
      : visibleMessages);
  const unsummarizedCount = unsummarizedMessages.length;
  const unsummarizedTokens = estimateChatMessagesTokens(
    unsummarizedMessages.map((m) => ({ role: m.role || "user", content: m.content || "" }))
  );
  const shouldAutoCompress = unsummarizedCount >= 6 && unsummarizedTokens >= CHAT_AUTO_COMPRESS_THRESHOLD;
  if (!shouldAutoCompress) {
    updateCompressMemoryButtonProgress(session);
    return;
  }

  updateCompressMemoryButtonProgress(session);

  const npc = session.npcs?.[0];
  if (!npc?.model) return;

  debugInfo("[MOYU:compress]", "单 AI 自动压缩触发", {
    sessionId: session.id,
    npcModel: npc.model,
    unsummarizedCount,
    unsummarizedTokens,
  });

  const prevStatusText = els.chatStatus?.textContent || "";
  setText(els.chatStatus, "正在自动压缩对话摘要...");
  _autoCompressPending = true;
  setCompressionUiLocked(true);
  try {
    const changed = await ensureChatSummary(session);
    if (changed && getCurrentSession()?.id === session.id) {
      updateCompressMemoryButtonProgress(session);
      renderCompressMemoryPopover();
    }
    setText(els.chatStatus, prevStatusText || t("chat.statusReady"));
  } catch (error) {
    setText(els.chatStatus, prevStatusText || t("chat.statusReady"));
    console.error("[MOYU:compress]", "单 AI 自动压缩失败", {
      message: error?.message || String(error),
      npcModel: npc.model,
      stack: error?.stack,
    });
  } finally {
    _autoCompressPending = false;
    setCompressionUiLocked(false);
  }
}

async function triggerManualDirectorCompression() {
  const session = getCurrentSession();
  let finalStatusText = "";
  debugLog("compress", t("debug.msg.compressionRequested"), {
    hasSession: Boolean(session),
    isSending: state.isSending,
    openPopover: state.openCompressMemoryInfo,
  });
  if (!session || state.isSending) {
    debugLog("compress", t("debug.msg.compressionAborted"), {
      reason: !session ? "missing-session" : "sending-in-progress",
    });
    return;
  }

  const isSingleAi = session.mode === SESSION_MODE_WORK && !session.directorModel && session.npcs.length === 1;

  state.openCompressMemoryInfo = false;
  renderCompressMemoryPopover();
  hideCompressPopover();
  if (els.compressMemoryBtn) {
    els.compressMemoryBtn.disabled = true;
  }
  updateComposerMode();

  if (isSingleAi) {
    setText(els.chatStatus, "正在压缩对话摘要...");
    debugLog("compress", t("debug.msg.compressionStarted"), {
      sessionId: session.id,
      mode: "chat-summary",
    });
    setCompressionUiLocked(true);
    try {
      const changed = await ensureChatSummary(session, { force: true });
      if (!changed) {
        finalStatusText = "当前摘要已经够短了";
      } else {
        finalStatusText = "对话摘要已压缩";
      }
    } catch (error) {
      debugLog("compress", t("debug.msg.compressionFailed"), {
        message: error?.message || String(error),
      });
      finalStatusText = `压缩失败：${error.message}`;
    }
    finally {
      setCompressionUiLocked(false);
    }
  } else {
    setText(els.chatStatus, "正在压缩导演记忆...");
    debugLog("compress", t("debug.msg.compressionStarted"), {
      sessionId: session.id,
      recentLimit: DIRECTOR_MANUAL_RECENT_HISTORY_LIMIT,
    });
    setCompressionUiLocked(true);
    try {
      const changed = await ensureDirectorSummary(session, {
        force: true,
        mode: "manual",
        recentLimit: DIRECTOR_MANUAL_RECENT_HISTORY_LIMIT,
      });
      debugLog("compress", t("debug.msg.compressionFinished"), {
        changed,
        summaryLength: String(session.directorSummary || "").length,
        compressedUntilMessageId: session.compressedUntilMessageId || "",
      });
      if (!changed) {
        finalStatusText = "当前导演记忆已经够短了";
      } else {
        finalStatusText = "导演记忆已压缩";
      }
    } catch (error) {
      debugLog("compress", t("debug.msg.compressionFailed"), {
        message: error?.message || String(error),
      });
      finalStatusText = `压缩失败：${error.message}`;
    }
    finally {
      setCompressionUiLocked(false);
    }
  }

  if (finalStatusText) {
    setText(els.chatStatus, finalStatusText);
  }
  updateComposerMode();
}

const NPC_PARALLEL_GROUP_LIMIT = 2;

function getLatestUserMessageText(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message && message.role === "user" && message.content) {
      return String(message.content || "");
    }
  }
  return "";
}

function shouldPreferParallelNpcReply(text) {
  return /并行|同时|一起回答|一起说|分别|各自|各说|各聊|各写|各自展开|分别展开|每个人|每位|都说说|都回答|各抒己见/u.test(String(text || ""));
}

function shouldForceSerialNpcReply(text) {
  return /串行|依次|逐个|一个一个|挨个|轮流|先后|先来|后来|接着|接话|插话|打断|反驳|吵|争吵|辩论|质问|追问|总结|收尾|开头|打头阵|收个尾|最后总结|最后收尾|回应他|回应她|回应它|先.*后/u.test(String(text || ""));
}

function buildFallbackParallelGroups(session, responders) {
  if (!responders.length) return [];
  const text = getLatestUserMessageText(session);
  if (responders.length <= 1 || shouldForceSerialNpcReply(text)) {
    return responders.map((npc) => [npc]);
  }
  if (shouldPreferParallelNpcReply(text)) {
    return [responders];
  }
  return responders.map((npc) => [npc]);
}

function resolveNpcParallelGroups(session, responders, directive) {
  const byName = new Map(responders.map((npc) => [npc.name, npc]));
  const used = new Set();
  const groups = [];
  const text = getLatestUserMessageText(session);
  const forceSerial = shouldForceSerialNpcReply(text);
  const allowParallel = shouldPreferParallelNpcReply(text) && !forceSerial;

  if (Array.isArray(directive?.parallelGroups) && directive.parallelGroups.length) {
    directive.parallelGroups.forEach((group) => {
      if (!Array.isArray(group)) return;
      const resolved = group
        .map((name) => byName.get(name))
        .filter((npc) => npc && !used.has(npc.name));
      resolved.forEach((npc) => used.add(npc.name));
      if (resolved.length) {
        groups.push(forceSerial || !allowParallel ? resolved.map((npc) => [npc]) : [resolved]);
      }
    });
    responders.forEach((npc) => {
      if (!used.has(npc.name)) {
        groups.push([npc]);
      }
    });
    return groups.flat();
  }

  return buildFallbackParallelGroups(session, responders);
}

async function callNpcGroup(session, group, npcInstructions) {
  if (!group.length) return;
  if (group.length === 1) {
    setInlineChatStatus(`${group[0].name} 正在回复...`);
    await callNpc(session, group[0], npcInstructions);
    return;
  }

  for (let index = 0; index < group.length; index += NPC_PARALLEL_GROUP_LIMIT) {
    const chunk = group.slice(index, index + NPC_PARALLEL_GROUP_LIMIT);
    const names = formatNpcNamesForStatus(chunk);
    setInlineChatStatus(`${names} 正在组织语言...`);
    await Promise.all(chunk.map((npc) => callNpc(
      session,
      npc,
      npcInstructions,
      chunk.filter((item) => item.name !== npc.name).map((item) => item.name)
    )));
  }
}


