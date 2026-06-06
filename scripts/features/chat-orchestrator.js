"use strict";


// ── 单 AI 模式（无导演）对话摘要压缩 ──
const CHAT_CONVERSATION_THRESHOLD = 3000;
const CHAT_SUMMARY_TARGET_MAX = 800;
const CHAT_AUTO_COMPRESS_THRESHOLD = 600;

const CHAOS_MODE_MAX_RESPONDERS = 3;
const CHAOS_MODE_TRANSCRIPT_LIMIT = 12;
const CHAOS_MODE_REPLY_HARD_LIMIT = 50;
const CHAOS_REACTION_TAGS = ["典", "孝", "急", "乐", "崩", "无", "草", "哈", "赞", "？"];
const CHAOS_SUMMARY_TARGET = 400;
const CHAOS_AUTO_COMPRESS_THRESHOLD = 30;
const CHAOS_PERSONAS = [
  { label: "严谨学者", desc: "喜欢深挖问题本质，说话有逻辑，偶尔引用数据或例子但不掉书袋。对肤浅的讨论没耐心，会追问关键点。" },
  { label: "直爽吐槽", desc: "嘴快心直，看不惯就当面说，语气糙但理不糙。经常拆台反转打破砂锅问到底，不会恶意人身攻击。" },
  { label: "随和乐天", desc: "好说话，爱打圆场，看到气氛僵了会接一句缓和的话。不太较真，偶尔跑题聊日常。" },
  { label: "抬杠能手", desc: "不管别人说什么都要挑个反方向想想，专门唱反调帮大家看到另一面。语气带点挑衅但能接住。" },
  { label: "感性表达", desc: "说话带情绪，喜欢用自己的经历来举例。容易共情也容易上头，不太喜欢冷冰冰的逻辑分析。" },
  { label: "冷面吐槽", desc: "话少但精，经常一句冷幽默让全场安静。不主动带话题，喜欢用比喻和反讽。" },
  { label: "务实老哥", desc: "说话实在，不喜欢虚的。别人聊理论他聊落地，别人争对错他问「所以呢」。经常把话题拉回现实。" },
  { label: "好奇宝宝", desc: "对新鲜东西充满兴趣，喜欢追问细节。语气体贴不过度热情，偶尔自嘲。遇到不懂的就直说不装。" },
];

function getChaosPersona(npc) {
  if (npc?.prompt?.trim()) return null;
  const index = Math.abs(hashStringForPrompt(`${npc?.name || ""}|${npc?.model || ""}|persona`)) % CHAOS_PERSONAS.length;
  return CHAOS_PERSONAS[index];
}


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
  const cutoffSeq = typeof getCompressedCutoffSeq === "function"
    ? getCompressedCutoffSeq(session, "chat")
    : (Number.isFinite(session?.compressedUntilSequence) ? session.compressedUntilSequence : -1);
  const activeMessages = session?.chatSummary
    ? (cutoffSeq >= 0
      ? visibleMessages.filter((message) => !Number.isFinite(message.sequence) || message.sequence > cutoffSeq)
      : visibleMessages)
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

function clampChaosValue(value, min = 0, max = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function normalizeChaosReactionTag(value) {
  return CHAOS_REACTION_TAGS.includes(value) ? value : "无";
}

function buildChaosSeed(npc, salt) {
  return hashStringForPrompt(`${salt}|${npc?.name || ""}|${npc?.model || ""}|${npc?.prompt || ""}`);
}

function buildChaosTrait(npc, salt, min, max) {
  const span = Math.max(1, max - min + 1);
  return min + (buildChaosSeed(npc, salt) % span);
}

function ensureChaosState(session) {
  if (!session) return { npcStates: {}, turnIndex: 0 };
  const existing = session.chaosState && typeof session.chaosState === "object" ? session.chaosState : {};
  const npcStates = existing.npcStates && typeof existing.npcStates === "object" ? existing.npcStates : {};
  const nextStates = {};
  getSceneNpcs(session).forEach((npc) => {
    if (!npc?.name) return;
    const current = npcStates[npc.name] && typeof npcStates[npc.name] === "object" ? npcStates[npc.name] : {};
    nextStates[npc.name] = {
      rationality: clampChaosValue(current.rationality ?? buildChaosTrait(npc, "rationality", 35, 85)),
      aggression: clampChaosValue(current.aggression ?? buildChaosTrait(npc, "aggression", 15, 65)),
      expressiveness: clampChaosValue(current.expressiveness ?? buildChaosTrait(npc, "expressiveness", 30, 92)),
      emotion: clampChaosValue(current.emotion ?? buildChaosTrait(npc, "emotion", 24, 72)),
      fatigue: clampChaosValue(current.fatigue ?? 0),
      reactionTag: normalizeChaosReactionTag(current.reactionTag),
      speakCount: Math.max(0, Number(current.speakCount) || 0),
      lastSpokeTurn: Number.isFinite(current.lastSpokeTurn) ? current.lastSpokeTurn : -1,
      lastSpokeCycle: Number.isFinite(current.lastSpokeCycle) ? current.lastSpokeCycle : -1,
    };
  });
  session.chaosState = {
    turnIndex: Number.isFinite(existing.turnIndex) ? existing.turnIndex : 0,
    autoplayStreak: Number.isFinite(existing.autoplayStreak) ? existing.autoplayStreak : 0,
    npcStates: nextStates,
  };
  return session.chaosState;
}

window.__cancelChaosAutoplay = function cancelChaosAutoplay() {};

function buildChaosTranscriptMessages(session, stagedMessages = [], limit = CHAOS_MODE_TRANSCRIPT_LIMIT) {
  const visibleMessages = (session?.messages || []).filter((message) =>
    message && message.role !== "system" && message.content && !message.pending
  );
  return visibleMessages.concat(stagedMessages).slice(-Math.max(1, limit));
}

function buildChaosTranscript(session, stagedMessages = [], limit = CHAOS_MODE_TRANSCRIPT_LIMIT) {
  const summaryBlock = session?.chaosSummary
    ? `[聊天概况]\n${session.chaosSummary}\n[/聊天概况]\n`
    : "";
  return summaryBlock + buildChaosTranscriptMessages(session, stagedMessages, limit)
    .map((message) => {
      const speaker = message.role === "user" ? "用户" : (message.speaker || "某人");
      return `[${speaker}] ${String(message.content || "").replace(/\s+/g, " ").trim()}`;
    })
    .join("\n");
}

function buildChaosRoster(session) {
  return getSceneNpcs(session)
    .map((npc) => {
      const prompt = String(npc?.prompt || "").replace(/\s+/g, " ").trim().slice(0, 52);
      if (prompt) return `${npc.name}：${prompt}`;
      const persona = getChaosPersona(npc);
      return persona ? `${npc.name}（${persona.label}）` : `${npc.name}`;
    })
    .join("\n");
}

function parseChaosJson(rawContent) {
  if (!rawContent) return null;
  try {
    return parseDirectorJsonLoose(String(rawContent || ""));
  } catch {
    return null;
  }
}

function sanitizeChaosReply(content) {
  let text = String(content || "").replace(/\r/g, "").split("\n")[0].trim();
  text = text.replace(/^["“”'「」『』]+|["“”'「」『』]+$/g, "").trim();
  text = text.replace(/^[\[(（【]?(?:用户|群友|路人|我|你|他|她|它|AI|NPC|agent|Agent|模型|[^:：\]\)）】]{1,12})[\]）】]?\s*[:：]\s*/i, "");
  text = text.replace(/\s+/g, " ").trim();
  if (text === "<SKIP>") return "";
  if (text.length > CHAOS_MODE_REPLY_HARD_LIMIT) {
    text = text.slice(0, CHAOS_MODE_REPLY_HARD_LIMIT).trim();
  }
  return text;
}

function buildChaosStateSummary(npcState) {
  return [
    `情绪=${Math.round(npcState.emotion)}`,
    `理性=${Math.round(npcState.rationality)}`,
    `攻击性=${Math.round(npcState.aggression)}`,
    `表达欲=${Math.round(npcState.expressiveness)}`,
    `疲劳=${Math.round(npcState.fatigue)}`,
    `上轮反应=${normalizeChaosReactionTag(npcState.reactionTag)}`,
  ].join("，");
}

function isChaosNpcTargeted(session, npc, stagedMessages = []) {
  const transcriptMessages = buildChaosTranscriptMessages(session, stagedMessages, 4);
  const latestMessage = transcriptMessages[transcriptMessages.length - 1];
  if (!latestMessage?.content) return false;
  return String(latestMessage.content).includes(npc.name);
}

async function evaluateChaosNpcIntent(session, npc, npcState, stagedMessages, cycle) {
  const transcript = buildChaosTranscript(session, stagedMessages);
  const roster = buildChaosRoster(session);
  const config = resolveModelConfig(npc.configId, npc.model, session.configId);
  const transcriptMessages = buildChaosTranscriptMessages(session, stagedMessages, 4);
  const latestVisible = transcriptMessages[transcriptMessages.length - 1] || null;
  const latestSpeaker = latestVisible?.role === "assistant" ? latestVisible.speaker : "用户";
  const isEmptyRoom = transcriptMessages.length === 0;
  const messages = [
    {
      role: "system",
      content: [
        `你是群聊成员 ${npc.name}。`,
        npc.prompt ? `你的人设：${npc.prompt}` : `你的性格：${getChaosPersona(npc)?.desc || "有自己的脾气和说话习惯"}`,
        session.globalPrompt ? `世界观：${session.globalPrompt}` : "",
        `你的隐藏状态：${buildChaosStateSummary(npcState)}。`,
        "你正在一个群聊里跟人聊天。",
        "这不是你和用户的一对一聊天。",
        "群里其他成员也都是真人在场，你可以接任何人的话，不需要只对用户负责。",
        "判断你这一拍要不要接话。",
        "该认真就认真，该轻松就轻松，语气跟着话题走。",
        "如果群里刚安静下来、没人先开口、或者同一个话题聊腻了，你可以主动起个新话题。",
        "主动起话题时别总跳到推荐东西上（推荐好吃的、好剧、好游戏之类的），聊点别的。",
        "只输出一个 JSON 对象，不要解释，不要 markdown。",
        '格式固定：{"speak":true,"impulse":0-100,"reactionTag":"典|孝|急|乐|崩|无|草|哈|赞|？","target":"用户|某个群友名|","style":"一句8字内概括","reason":"12字内简因"}',
        "规则：",
        "1. speak 表示你这一拍到底想不想说。",
        "2. impulse 越高越想说；被点名、被戳中、有共鸣、想接话时提高。",
        "3. 若你懒得理、刚说过、兴趣不大、局势冷掉，就降低。",
        "4. 如果群里在复读或者同一个话题绕了 3 轮以上，主动起个新话题——别又绕回推荐吃的喝的玩的。",
        "5. reason 极短即可，不要解释链条。",
        "6. 无话可说或者不想顺着聊就别接，不用硬凑。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `当前群成员：\n${roster || "无"}`,
        `\n最近群聊：\n${transcript || "[暂无消息]"}`,
        `\n最新一条来自：${latestSpeaker || "无人"}。`,
        isEmptyRoom ? "\n现在群里还没人正式开口，你可以主动冒一句。" : "",
        `\n当前是这一轮的第 ${cycle + 1} 拍。`,
        "\n只输出 JSON。",
      ].join("\n"),
    },
  ];

  const intentTemp = typeof getSessionAgentParam === "function"
    ? getSessionAgentParam(session, npc.name, "temperature")
    : undefined;
  const temp = intentTemp !== undefined ? intentTemp : getNpcResponseTemperature(session, npc.model);
  const payload = await createChatCompletionPayload(config.host, config.key, npc.model, messages, false, temp);
  const parsed = parseChaosJson(payload.content) || {};
  const targeted = isChaosNpcTargeted(session, npc, stagedMessages);
  const latestIsPeer = latestVisible?.role === "assistant" && latestVisible.speaker && latestVisible.speaker !== npc.name;
  const latestIsSelf = latestVisible?.role === "assistant" && latestVisible.speaker === npc.name;
  const turnGap = Number.isFinite(npcState.lastSpokeTurn)
    ? Math.max(0, (ensureChaosState(session).turnIndex || 0) - npcState.lastSpokeTurn)
    : 99;
  let impulse = clampChaosValue(parsed.impulse ?? (parsed.speak ? 72 : 48));
  impulse = clampChaosValue(
    impulse
      - Math.round((npcState.fatigue || 0) * 0.15)
      - (npcState.lastSpokeCycle === cycle - 1 ? 10 : 0)
      - (turnGap <= 1 ? 14 : turnGap === 2 ? 6 : 0)
      + (targeted ? 16 : 0)
      + (latestIsPeer ? 24 : 0)
      - (latestIsSelf ? 28 : 0)
      + (isEmptyRoom ? 18 : 0)
      + Math.round((npcState.expressiveness - 50) * 0.16)
      + Math.round((npcState.aggression - 50) * 0.08)
      + Math.round((Math.random() - 0.5) * 10)
      + 12  // 基础发言冲动，保证群聊不会冷场
  );

  return {
    npc,
    speak: Boolean(parsed.speak),
    impulse,
    targeted,
    reactionTag: normalizeChaosReactionTag(parsed.reactionTag),
    style: String(parsed.style || "").trim().slice(0, 24),
    reason: String(parsed.reason || "").trim().slice(0, 20),
  };
}

function selectChaosResponders(intents, cycle) {
  const ranked = (Array.isArray(intents) ? intents : [])
    .filter((item) => item && (item.speak || item.impulse >= 24))
    .sort((a, b) => b.impulse - a.impulse);
  if (!ranked.length) {
    // 全员不想接话 → 强制冲动最高的 NPC 发言，避免意图评估白烧钱
    const sorted = (Array.isArray(intents) ? intents : [])
      .filter((item) => item)
      .sort((a, b) => b.impulse - a.impulse);
    if (sorted.length) {
      sorted[0].impulse = Math.max(50, sorted[0].impulse || 0);
      sorted[0].forceReply = true;
      return [sorted[0]];
    }
    return [];
  }

  const threshold = cycle === 0 ? 24 : 30;
  const selected = [];
  const topImpulse = ranked[0].impulse;
  ranked.forEach((item, index) => {
    if (selected.length >= CHAOS_MODE_MAX_RESPONDERS) return;
    if (index === 0) {
      if (item.impulse >= Math.max(18, threshold - 10)) {
        selected.push(item);
      }
      return;
    }
    if (item.impulse < threshold) return;
    if (item.impulse < topImpulse - 20 && !item.targeted) return;
    selected.push(item);
  });
  return selected;
}

async function generateChaosNpcReply(session, npc, npcState, intent, stagedMessages, cycle) {
  const transcript = buildChaosTranscript(session, stagedMessages);
  const roster = buildChaosRoster(session);
  const config = resolveModelConfig(npc.configId, npc.model, session.configId);
  const recentMessages = buildChaosTranscriptMessages(session, stagedMessages, 6);
  const latestComparable = [...recentMessages].reverse().find((item) => item.role === "assistant" && item.speaker === npc.name);
  const messages = [
    {
      role: "system",
      content: [
        `你是群聊成员 ${npc.name}。`,
        npc.prompt ? `你的人设：${npc.prompt}` : `你的性格：${getChaosPersona(npc)?.desc || "有明确态度和表达习惯"}`,
        session.globalPrompt ? `世界观：${session.globalPrompt}` : "",
        `你的隐藏状态：${buildChaosStateSummary(npcState)}。`,
        `你这一拍的反应态：${intent.reactionTag}。`,
        intent.style ? `你这句的感觉：${intent.style}。` : "",
        intent.reason ? `你想说的原因：${intent.reason}。` : "",
        "这不是回复客服单，群聊里有轻松也有正经话题。",
        "你是在群里说话，回应别人、分享见解、吐个槽都可以，说话水平跟着话题走。",
        "你现在要往群里发一条短消息。",
        "硬规则：",
        "1. 只输出消息正文，不要说话人标签，不要引号，不要括号动作，不要 markdown。",
        "2. 长度 4-30 个字，可以写一两句，但别写成小作文。",
        "3. 该正经就正经，该随意就随意——聊严肃话题时拿出见识和分量，聊日常时可以轻松随意。",
        "4. 别写成教科书，但可以说出有内容的见解。",
        "5. 不要重复你自己刚说过的话，也别顺着别人的句式复读。",
        "6. 同一个话题绕了 3 轮以上就别硬续了，可以抛个新话题——别总跳到推荐东西上。",
        ...(intent.forceReply
          ? ["这一拍你必须说点什么，不能跳过。"]
          : ["7. 如果你这一拍其实不想说，输出 <SKIP>。"]),
      ].filter(Boolean).join("\n"),
    },
    {
      role: "user",
      content: [
        `群成员：\n${roster || "无"}`,
        `\n最近群聊：\n${transcript || "[暂无消息]"}`,
        latestComparable?.content ? `\n你上一次刚说过：${latestComparable.content}` : "",
        `\n当前是这一轮的第 ${cycle + 1} 拍。`,
        "\n只输出这一条消息正文。",
      ].join("\n"),
    },
  ];

  const replyTemp = typeof getSessionAgentParam === "function"
    ? getSessionAgentParam(session, npc.name, "temperature")
    : undefined;
  const temp = replyTemp !== undefined ? replyTemp : getNpcResponseTemperature(session, npc.model);
  const payload = await createChatCompletionPayload(config.host, config.key, npc.model, messages, false, temp);
  const content = sanitizeChaosReply(payload.content);
  if (!content) return null;
  if (latestComparable && normalizeComparableText(latestComparable.content) === normalizeComparableText(content)) {
    return null;
  }
  const usage = normalizeUsage(payload.usage) || null;
  const estimatedUsage = usage ? null : {
    input: estimateChatMessagesTokens(messages),
    output: estimateTokens(content),
    total: estimateChatMessagesTokens(messages) + estimateTokens(content),
  };
  return {
    id: createMessageId("chaos"),
    role: "assistant",
    speaker: npc.name,
    content,
    createdAt: new Date().toISOString(),
    pending: false,
    streaming: false,
    usage,
    estimatedUsage,
  };
}

function applyChaosReplyState(session, reply, intent, cycle) {
  const chaosState = ensureChaosState(session);
  const npcState = chaosState.npcStates[reply.speaker];
  if (!npcState) return;
  npcState.emotion = clampChaosValue(npcState.emotion + Math.round((intent.impulse - 50) / 7) + (intent.reactionTag === "崩" ? 10 : 0));
  npcState.fatigue = clampChaosValue(npcState.fatigue + 18);
  npcState.reactionTag = normalizeChaosReactionTag(intent.reactionTag);
  npcState.speakCount = Math.max(0, Number(npcState.speakCount) || 0) + 1;
  npcState.lastSpokeTurn = Number.isFinite(chaosState.turnIndex) ? chaosState.turnIndex : 0;
  npcState.lastSpokeCycle = cycle;
}

async function runChaosWave(session, responders, chaosState, waveIndex) {
  const replies = [];
  const spokeNames = new Set();
  const promises = responders.map((intent) => {
    const npcState = chaosState.npcStates[intent.npc.name] || {};
    const typingDelay = 600 + Math.random() * 2400;
    return new Promise((resolve) => {
      setTimeout(async () => {
        if (state.abortController?.signal.aborted) { resolve(); return; }
        try {
          const reply = await generateChaosNpcReply(session, intent.npc, npcState, intent, [], waveIndex);
          if (reply) {
            session.messages.push(reply);
            applyChaosReplyState(session, reply, intent, waveIndex);
            spokeNames.add(reply.speaker);
            renderMessages({ stickToBottom: true });
            replies.push(reply);
          }
        } catch (error) {
          debugWarn("[chaos] reply failed", { npc: intent.npc.name, error: error?.message });
        }
        resolve();
      }, typingDelay);
    });
  });

  await Promise.all(promises);

  if (replies.length && window.__chatDB?.saveMessages) {
    const startSeq = getSessionMessageCount(session);
    window.__chatDB.saveMessages(session.id, replies, startSeq).catch(() => {});
    session.messageCount = Math.max(Number(session.messageCount) || 0, startSeq + replies.length);
  }
  return { replies, spokeNames };
}

async function runChaosTurn(session) {
  const sceneNpcs = getSceneNpcs(session).filter((npc) => npc?.name && npc?.model);
  if (!sceneNpcs.length) {
    setText(els.chatStatus, "混沌模式暂无可发言成员");
    return { replyCount: 0, shouldAutoplay: false, strongestImpulse: 0 };
  }

  const chaosState = ensureChaosState(session);
  chaosState.autoplayStreak = 0;
  let totalReplies = 0;
  let strongestImpulse = 0;

  function checkAbort() {
    if (state.abortController?.signal.aborted || state.currentSessionId !== session.id) {
      throw new DOMException("Aborted", "AbortError");
    }
  }

  // Phase 1 — all NPCs evaluate intent in parallel
  setInlineChatStatus("群成员正在看消息...");
  checkAbort();
  const intents = await Promise.all(
    sceneNpcs.map((npc) =>
      evaluateChaosNpcIntent(session, npc, chaosState.npcStates[npc.name] || {}, [], 0)
        .catch((err) => {
          if (err?.name === "AbortError") throw err;
          debugWarn("[chaos] intent failed", { npc: npc.name, error: err?.message || String(err) });
          return null;
        })
    )
  );
  checkAbort();
  const validIntents = intents.filter(Boolean);
  let responders = selectChaosResponders(validIntents, 0);

  // Track who stayed silent this phase
  const phase1Skipped = new Set(
    validIntents
      .filter((intent) => !responders.some((r) => r.npc.name === intent.npc.name))
      .map((i) => i.npc.name)
  );

  if (responders.length) {
    checkAbort();
    setInlineChatStatus(`${responders.map((r) => r.npc.name).join("、")} 正在输入...`);
    const result = await runChaosWave(session, responders, chaosState, 0);
    checkAbort();
    totalReplies += result.replies.length;
    result.replies.forEach((r) => { strongestImpulse = Math.max(strongestImpulse, Number(r._impulse) || 0); });
  }

  // Phase 2 — NPCs that stayed silent get a second look with fresh context
  if (phase1Skipped.size && totalReplies > 0) {
    checkAbort();
    const p2Npcs = sceneNpcs.filter((npc) => phase1Skipped.has(npc.name));
    setInlineChatStatus("有人在酝酿接话...");
    const p2Intents = await Promise.all(
      p2Npcs.map((npc) =>
        evaluateChaosNpcIntent(session, npc, chaosState.npcStates[npc.name] || {}, [], 1)
          .catch((err) => {
            if (err?.name === "AbortError") throw err;
            debugWarn("[chaos] phase2 intent failed", { npc: npc.name, error: err?.message || String(err) });
            return null;
          })
      )
    );
    checkAbort();
    const p2Responders = selectChaosResponders(p2Intents.filter(Boolean), 1);
    if (p2Responders.length) {
      checkAbort();
      setInlineChatStatus(`${p2Responders.map((r) => r.npc.name).join("、")} 忍不住接了一句...`);
      const result = await runChaosWave(session, p2Responders, chaosState, 1);
      totalReplies += result.replies.length;
      result.replies.forEach((r) => { strongestImpulse = Math.max(strongestImpulse, Number(r._impulse) || 0); });
    }
  }

  // Finalize
  syncLoadedSessionMessageCount(session);
  touchSession(session);
  persistSessions();
  renderMessages({ stickToBottom: true });
  renderChatListMenu();

  if (totalReplies) {
    setText(els.chatStatus, `群聊刷出了 ${totalReplies} 条消息`);
  } else {
    setText(els.chatStatus, "这波没人接话");
  }
  ensureChaosSummary(session).catch(() => {});
  return { replyCount: totalReplies, shouldAutoplay: false, strongestImpulse };
}

async function runSessionTurn(session) {
  if (!session) {
    return;
  }
  await ensureHistoricalScopeNames(session);

  if (session.mode === SESSION_MODE_CHAOS) {
    try {
      await runChaosTurn(session);
    } catch (error) {
      window.__cancelChaosAutoplay();
      if (error.name === "AbortError") {
        session.messages.push({ role: "system", speaker: "系统", content: t("chat.stoppedHint"), createdAt: new Date().toISOString() });
        touchSession(session);
        persistSessions();
        renderMessages();
        renderChatListMenu();
        setText(els.chatStatus, t("chat.stopped"));
      } else {
        console.error("[MOYU] Chaos turn failed", {
          sessionId: session.id,
          error: error.message,
        });
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
    }
    return;
  }

  // @mention direct routing — skip director, hand off to the named NPC
  if (session.mode === SESSION_MODE_WORK) {
    const userMsgs = session.messages.filter((m) => m.role === "user");
    const lastUser = userMsgs[userMsgs.length - 1];
    if (lastUser) {
      const lastUserText = getUserContentText(lastUser.content);
      const mention = resolveDirectMentionTarget(session, lastUserText);
      if (mention?.npc) {
        const targetNpc = mention.npc;
        const before = lastUserText.slice(0, mention.atPos);
        const after = lastUserText.slice(mention.endPos);
        const strippedContent = `${before} ${after}`.replace(/\s+/g, " ").trim();
        if (Array.isArray(lastUser.content)) {
          var textPart = lastUser.content.find(function (part) { return part?.type === "text"; });
          if (textPart) {
            textPart.text = strippedContent;
          } else if (strippedContent) {
            lastUser.content.unshift({ type: "text", text: strippedContent });
          }
        } else {
          lastUser.content = strippedContent || lastUser.content;
        }
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
  messages = injectRegenerationInstruction(messages, session);

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
  const cutoffSeq = typeof getCompressedCutoffSeq === "function"
    ? getCompressedCutoffSeq(session, "chat")
    : (Number.isFinite(session?.compressedUntilSequence) ? session.compressedUntilSequence : -1);
  const unsummarizedMessages = cutoffSeq >= 0
    ? visibleMessages.filter((message) => !Number.isFinite(message.sequence) || message.sequence > cutoffSeq)
    : visibleMessages;
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

async function ensureChaosSummary(session) {
  if (!session || session.mode !== SESSION_MODE_CHAOS) return false;
  const npc = session.npcs?.[0];
  if (!npc?.model) return false;

  const visibleMessages = (session.messages || []).filter((m) =>
    m && m.role !== "system" && m.content && !m.pending
  );
  const cutoffSeq = Number.isFinite(session?.chaosSummaryUntilSeq)
    ? session.chaosSummaryUntilSeq
    : -1;
  const unsummarized = cutoffSeq >= 0
    ? visibleMessages.filter((m) => !Number.isFinite(m.sequence) || m.sequence > cutoffSeq)
    : visibleMessages;

  if (unsummarized.length < CHAOS_AUTO_COMPRESS_THRESHOLD / 2 && session.chaosSummary) return false;

  const configId = npc.configId || session.configId || "";
  const config = resolveModelConfig(configId, npc.model, session.configId);
  const currentSummary = session.chaosSummary || "";

  const compressMessages = [
    { role: "system", content: CHAOS_COMPRESS_PROMPT },
  ];
  if (currentSummary) {
    compressMessages.push({ role: "system", content: `已有概况：\n${currentSummary}` });
  }
  if (unsummarized.length) {
    const historyBlock = buildHistoryMessagesFromSlice(unsummarized, "待压缩对话");
    compressMessages.push(...historyBlock);
  }
  compressMessages.push({ role: "user", content: "请基于已有概况和新增对话，输出一份更新的群聊概况。" });

  debugInfo("[MOYU:compress]", "混沌模式摘要压缩调用", {
    model: npc.model,
    summaryTokens: estimateTokens(currentSummary),
    newCount: unsummarized.length,
  });

  let payload;
  try {
    payload = await createChatCompletionPayload(config.host, config.key, npc.model, compressMessages, false, 0.4);
  } catch (apiError) {
    console.error("[MOYU:compress] 混沌模式压缩 API 调用失败", {
      model: npc.model,
      host: config.host,
      message: apiError.message,
    });
    return false;
  }

  const nextSummary = (payload.content || "").trim();
  if (!nextSummary) return false;

  session.chaosSummary = nextSummary;
  const lastMsg = visibleMessages[visibleMessages.length - 1];
  if (lastMsg && Number.isFinite(lastMsg.sequence)) {
    session.chaosSummaryUntilSeq = lastMsg.sequence;
  }
  touchSession(session);
  persistSessions();
  return true;
}

let _autoCompressPending = false;

function setCompressionUiLocked(locked) {
  const shell = document.querySelector(".app-shell");
  if (shell) shell.classList.toggle("compress-lock", Boolean(locked));
  if (locked) {
    state.openCompressMemoryInfo = false;
    if (typeof hideCompressPopover === "function") {
      hideCompressPopover();
    }
    if (els.compressMemoryBtn) {
      els.compressMemoryBtn.classList.remove("info-open");
    }
  }
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
  session.compressionSegments = segments.slice(-30);
  session.compressedUntilSequence = Math.max(Number(session.compressedUntilSequence) || -1, endSeq);
  mergeAdjacentSmallSegments(session, kind);
  return segment;
}

function mergeAdjacentSmallSegments(session, kind) {
  const segments = Array.isArray(session.compressionSegments) ? session.compressionSegments : [];
  const sameKind = segments.filter((s) => s && s.kind === kind);
  if (sameKind.length < 2) return;
  const MERGE_TOKEN_THRESHOLD = 300;
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < sameKind.length - 1; i++) {
      const a = sameKind[i];
      const b = sameKind[i + 1];
      if (!a || !b) continue;
      const combinedTokens = (Number(a.tokenCount) || 0) + (Number(b.tokenCount) || 0);
      if (combinedTokens > MERGE_TOKEN_THRESHOLD) continue;
      a.summary = `${String(a.summary || "").trim()}\n${String(b.summary || "").trim()}`;
      a.endSeq = b.endSeq;
      a.endMessageId = b.endMessageId;
      a.messageCount = (Number(a.messageCount) || 0) + (Number(b.messageCount) || 0);
      a.tokenCount = combinedTokens;
      sameKind.splice(i + 1, 1);
      merged = true;
      break;
    }
  }
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
  if (!session || state.isSending || _autoCompressPending || session.latestTurnVariants) return;

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
    const cutoffSeq = typeof getCompressedCutoffSeq === "function"
      ? getCompressedCutoffSeq(session, "director")
      : (Number.isFinite(session?.compressedUntilSequence) ? session.compressedUntilSequence : -1);
    unsummarizedCount = cutoffSeq >= 0
      ? visibleMessages.filter((message) => !Number.isFinite(message.sequence) || message.sequence > cutoffSeq).length
      : visibleMessages.length;
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
  const cutoffSeq = typeof getCompressedCutoffSeq === "function"
    ? getCompressedCutoffSeq(session, "chat")
    : (Number.isFinite(session?.compressedUntilSequence) ? session.compressedUntilSequence : -1);
  const unsummarizedMessages = cutoffSeq >= 0
    ? visibleMessages.filter((message) => !Number.isFinite(message.sequence) || message.sequence > cutoffSeq)
    : visibleMessages;
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
  if (session.latestTurnVariants) {
    setText(els.chatStatus, "当前回复还有多个版本，继续对话锁定后再压缩");
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
      return getUserContentText(message.content);
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
