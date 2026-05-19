"use strict";

function hashStringForPrompt(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildNpcVoiceRules(session, npc, turnContext) {
  if (!session || !npc) return "";
  const isStoryMode = session.mode === SESSION_MODE_STORY;
  const peers = getSceneNpcs(session)
    .filter((item) => item && item.name && item.name !== npc.name)
    .map((item) => {
      const prompt = String(item.prompt || "").replace(/\s+/g, " ").slice(0, 42);
      return prompt ? `${item.name}(${prompt})` : item.name;
    })
    .slice(0, 4);

  const lanes = isStoryMode ? NPC_STORY_VOICE_LANES : NPC_WORK_VOICE_LANES;
  const lane = lanes[hashStringForPrompt(`${npc.name}|${npc.prompt || ""}`) % lanes.length];
  const repeatedGuard = turnContext?.previousSpeakers?.length
    ? "你前面已经有人发言，本轮必须接住现场变化，换角度推进，不要复述上一位的话。"
    : "你是本轮第一个发言，要给后续角色留下可接的话口，不要一次说满。";

  return [
    "=== 角色声纹（防撞脸） ===",
    `稳定声纹：${lane}`,
    "人物要求优先；如果人物 Prompt 没写细，以上声纹用于补足你的表达习惯。",
    peers.length ? `和你同场的其他角色：${peers.join("；")}。不要模仿他们的词汇、句式、态度和关注点。` : "",
    isStoryMode
      ? `每次回应至少体现两项：你的欲望、顾虑、关系态度、身体动作、当下误解或隐瞒。动作描写用第三人称写 ${npc.name} 或“他/她”，台词里才用“我”。不要使用通用助手腔、总结腔、鸡汤腔。`
      : "每次回应要体现你的职责边界和判断方式，不要变成泛泛的全能助手。",
    repeatedGuard,
  ].filter(Boolean).join("\n");
}

async function callNpc(session, npc, npcInstructions = {}, parallelPeerNames = []) {
  const targetMessage = {
    id: `msg-${npc.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: "assistant",
    speaker: npc.name,
    content: "",
    thinking: "",
    createdAt: new Date().toISOString(),
    pending: true,
    streaming: false,
  };
  session.messages.push(targetMessage);
  syncLoadedSessionMessageCount(session);
  touchSession(session);
  persistSessions();
  renderMessages({ stickToBottom: true });

  const turnContext = getCurrentTurnNpcContext(session, npc.name);
  const priorRepliesText = turnContext.previousSpeakers.length
    ? `本轮在你之前已经发言的 NPC：${turnContext.previousSpeakers.join("、")}（他们和你一样仍在现场，没有离开，你们正在一起交谈）。`
    : "你是本轮第一个发言的 NPC。";
  const parallelPeersText = parallelPeerNames.length
    ? `本轮你会和 ${parallelPeerNames.join("、")} 同时回答。你看不到他们这一轮刚生成的内容，不要假装接住他们的具体台词；只从自己的角度独立回应。`
    : "";
  const voiceRulesText = buildNpcVoiceRules(session, npc, turnContext);
  const playerPresenceText = session.mode === SESSION_MODE_STORY
    ? NPC_PLAYER_PRESENCE_RULES
    : "";

  // 导演给这个 NPC 的额外指令
  const directorInstruction = npcInstructions && typeof npcInstructions === "object" && npcInstructions[npc.name]
    ? `导演要求：${npcInstructions[npc.name]}`
    : "";

  const directiveSection = directorInstruction
    ? [
        "",
        "=== 导演指令 ===",
        directorInstruction,
        "你必须严格遵守导演的上述指令。",
      ].join("\n")
    : "";

  const isSingleAIMode = session.mode === SESSION_MODE_WORK && !session.directorModel && session.npcs.length === 1;

  const baseRules = isWeakModel(npc.model)
    ? [
        `你现在扮演 ${npc.name}。`,
        npc.prompt ? `人物要求：${npc.prompt}` : "请根据全局设定自然回应。",
        voiceRulesText,
        playerPresenceText,
        priorRepliesText,
        parallelPeersText,
        directorInstruction,
        directorInstruction ? "严格按照导演指令回应。" : "",
        "禁止输出思考过程，禁止任何形式的说话人标签。",
        `直接输出 ${npc.name} 的回应内容，不要写"${npc.name}："或"模型："或"AI："等前缀。`,
        "禁止替用户说话或行动，用户会自己发言。",
        ...(session.mode === SESSION_MODE_STORY ? [
          "你可以写一小句自己的动作、神态或感受，再写自己的台词；只允许写你自己的镜头。",
          `动作/神态/感受描写用第三人称写自己，例如“（${npc.name}扶住石柱，脸色发白）”或“（他咽了口唾沫）”；不要写“（我扶住石柱）”。`,
          "台词里可以自然使用第一人称，例如“我怕啊”“咱不是来拜师的吗”。",
          `正确示例：（${npc.name}扶住石柱，脸色发白）“我差点被你吓死，咱不是来拜师的吗？”`,
          "错误示例：（我扶住石柱，脸色发白）“我差点被你吓死。”",
          "禁止输出[旁白]、旁白：、全局场景调度、远处发生了什么、其他新角色登场或其他角色台词。",
          "对话用双引号包起来，动作和想法用圆括号包起来。例如：\"你好吗？\"（她推开门）",
        ] : []),
      ].filter(Boolean)
    : [
        `你现在扮演 ${npc.name}。`,
        npc.prompt ? `人物要求：${npc.prompt}` : "请根据全局设定和当前聊天自然回应。",
        voiceRulesText,
        playerPresenceText,
        priorRepliesText,
        parallelPeersText,
        ...(directiveSection ? ["", directiveSection] : []),
        "",
        "=== 绝对禁止 ===",
        `1. 禁止输出任何形式的说话人标签。不要写"${npc.name}："、"模型："、"AI："等前缀。历史中的 [标签] 仅为标识谁在说话，不要模仿。直接输出内容，不要加任何前缀。`,
        "2. 禁止重复！检查历史中你自己的上一条回复，如果与你要说的话有 40% 以上词语重合，这是严重违规。",
        "   每轮必须用全新的措辞、不同的比喻、不同的角度来回应。宁可说一句全新的话，也不准改写旧内容。",
        ...(!isSingleAIMode ? [
          "3. 禁止模拟别的 NPC、禁止替别人补充、禁止自问自答、禁止连续写多轮对话。",
          "5. 只能写你自己的发言、动作、神态、感受和判断。禁止替别的 NPC 决定动作，禁止代替别的 NPC 说话。",
          "7. 如果本轮在你之前已经有 NPC 说过话，禁止重写、复述、扩写、改写那位 NPC 刚刚说过的大段内容。",
          "8. 你可以接着别人的话往下说，但必须明显往前推进，不能把上一位的整段描写再说一遍。",
        ] : []),
        "4. 只输出一版最终答案，不要给草稿、补充版、总结版、收尾版。",
        "6. 禁止替用户说话、行动或做决定。用户会自己发言，不需要你代言。",
        "",
        "=== 输出格式 ===",
        `直接输出 ${npc.name} 说的话，禁止加任何前缀标签。不要包含说话人标识。`,
        ...(session.mode === SESSION_MODE_STORY ? [
          "可以在台词前写一小句你自己的动作、神态、语气、感受或对现场的即时观察。",
          `动作/神态/感受描写必须用第三人称写自己，例如“（${npc.name}扶住石柱，脸色发白）”或“（他咽了口唾沫）”；不要写“（我扶住石柱）”。`,
          "台词内部可以自然使用第一人称，例如“我怕啊”“咱不是来拜师的吗”。",
          `正确示例：（${npc.name}扶住石柱，脸色发白）“我差点被你吓死，咱不是来拜师的吗？”`,
          "错误示例：（我扶住石柱，脸色发白）“我差点被你吓死。”",
          "禁止输出[旁白]或旁白：。禁止写全局旁白、场景调度、远处动静、其他新角色登场、其他角色说话。",
          "禁止代替导演推进外部事件；需要掌门、长老、路人、守卫登场时，只能由导演旁白安排，不由你安排。",
          "对话用双引号包起来，例如\"你好吗？\"。动作和想法用圆括号包起来，例如（她推开门）(他在想什么)。",
          "禁止替用户做动作——用户进门你写\"（听到门响）\"就好，不要写\"（推开门）\"这个动作本身。只写你自己的动作和感知。",
          "禁止使用 Markdown 格式，禁止输出代码块。",
        ] : [
          "一句完整的回应就好。",
        ]),

        "=== 必须遵守 ===",
        "如果用户要求限制字数、格式或风格，你必须严格遵守。",
      ].filter(Boolean);

  const baseRulesText = baseRules.join("\n");

  const directorMemoryMsgs = buildDirectorMemorySystemMessage(session);
  const directorSegmentMsgs = buildCompressionSegmentsSystemMessages(session, "director");
  const chatSummaryBlock = buildChatSummaryBlock(session);

  let messages = [
    { role: "system", content: baseRulesText },
    // work 模式注入当前时间（模型时间感知）
    ...(session.mode === SESSION_MODE_WORK
      ? [{ role: "system", content: `当前时间：${new Date().toLocaleString("zh-CN", { hour12: false })}` }]
      : []),
    // 多 NPC 模式下告知在场角色（单 AI 模式下模型已知自己是谁）
    ...(isSingleAIMode ? [] : [{ role: "system", content: `当前场景中在场的 NPC：${getSceneNpcs(session).map((item) => item.name).join("、")}。所有场内 NPC 始终一起待在当前场景中，不会因发言顺序而离开或入场。你们的对话视为同处一室的当面交谈。` }]),
    // 全局设定（单 AI 模式下可能为空）
    ...(session.globalPrompt ? [{ role: "system", content: `全局设定：\n${session.globalPrompt}` }] : []),
    // [DIRECTOR_MEMORY]：仅当实际有记忆内容时才发送说明文字
    ...(directorMemoryMsgs.length
      ? [
          { role: "system", content: "以下 [DIRECTOR_MEMORY] 是本轮之前发生的关键事件摘要，仅作为背景参考。你据此了解已发生过的事情即可，不要重复叙述历史，不要替用户或不在当前场景中的角色说话。" },
          ...directorMemoryMsgs,
        ]
      : []),
    ...(directorSegmentMsgs.length
      ? [
          { role: "system", content: "以下压缩历史片段按消息区间保存，用于补足较早剧情。它们是背景记忆，不代表当前正在发生；不要逐字复述。" },
          ...directorSegmentMsgs,
        ]
      : []),
    // For single AI mode: include chat summary for context of older conversation
    ...(chatSummaryBlock ? [{ role: "system", content: chatSummaryBlock }] : []),
    ...buildNpcContextMessages(session, npc),
  ];
  // Single AI mode: hard rule for search — MUST be inserted right before the user's last message
  // Reasoning models process context sequentially during thinking, so the rule must
  // precede the user's question to be considered during the reasoning phase.
  if (isSingleAIMode && window.__chatRetrieval) {
    const visibleForSearch = getVisibleHistoryMessages(session);
    const cutoffForSearch = session?.compressedUntilMessageId
      ? visibleForSearch.findIndex(function (m) { return m.id === session.compressedUntilMessageId; })
      : -1;
    const searchSourceMessages = session?.chatSummary && cutoffForSearch >= 0
      ? visibleForSearch.slice(cutoffForSearch + 1)
      : visibleForSearch;
    const totalForSearch = visibleForSearch.length;
    const scopedForSearch = searchSourceMessages.slice(-30).length;
    const hasBlind = totalForSearch > scopedForSearch;
    const blindEnd = totalForSearch - scopedForSearch;
    const availableScopes = Array.from(new Set([
      ...((session.historicalScopeNames || []).filter(Boolean)),
      ...(session.messages || [])
        .filter(function (m) { return m && m.role !== "system" && m.content && !m.pending; })
        .map(function (m) { return m.role === "user" ? "user" : (m.speaker || "assistant"); })
        .filter(Boolean),
    ]));
    const turnHint = buildBlindTurnRangeHint(session, blindEnd);
    const hardRuleContent = hasBlind
      ? [
          "=== RETRIEVAL PROTOCOL: OBEY EXACTLY ===",
          "VISIBLE: messages " + (blindEnd + 1) + "-" + totalForSearch + ".",
          "NOT VISIBLE: messages 1-" + blindEnd + ".",
          "",
          "If the user's request can be answered from the visible messages, the current turn, or normal conversation ability, answer normally and do NOT output any retrieval marker.",
          "Use retrieval ONLY when the answer truly depends on non-visible history.",
          "",
          "If the answer depends on non-visible history, your ENTIRE reply MUST be exactly one retrieval marker and nothing else.",
          "",
          "ALLOWED MARKERS ONLY:",
          "1. 【查看区间】N-N【/查看区间】",
          "2. 【查看区间】scope,N-M【/查看区间】",
          "3. 【搜索】keywords【/搜索】",
          "",
          "AVAILABLE scope names in this conversation:",
          availableScopes.join(", "),
          "",
          "SEMANTICS:",
          "- '第N条' / '第N条消息' / '第N条记录' / '整个会话的第N条' = GLOBAL chronological message index, counting BOTH user and assistant messages.",
          "- NEVER reinterpret '第N条' as '用户第N条发言'.",
          "- '我说的第N条发言' / '我的第N条发言' = 【查看区间】user,N-N【/查看区间】.",
          "- A named speaker's own message sequence = 【查看区间】SpeakerName,N-M【/查看区间】.",
          "- '第N轮' is NOT '第N条'.",
          "",
          "PRIORITY ORDER:",
          "A. If scoped retrieval can express the request, you MUST use scoped retrieval.",
          "B. Else if global range retrieval can express the request, you MUST use global range retrieval.",
          "C. Else and only else, use generic search.",
          "D. Generic search keywords must maximize coverage, not redundancy.",
          "",
          "MANDATORY:",
          "- Questions about who said something, which model/agent joined, what a named agent said, or a user's own utterance MUST use scoped retrieval first.",
          "- Generic search is WRONG for those cases unless scoped retrieval is impossible.",
          "- Only use a speaker-name scope from the available scope list above.",
          "",
          "FORBIDDEN:",
          "- No natural-language answer before retrieval.",
          "- No generic search when scoped retrieval would work.",
          "- No keyword spam with many near-synonyms for the same idea.",
          "- No 'let me check', no roleplay, no fake retrieval claims.",
          "",
          "GENERIC SEARCH KEYWORD RULES:",
          "- Use distinct anchors: speaker/agent name, action/event, object/topic, time hint, role/model hint when available.",
          "- Prefer 4-8 high-information terms or short phrases.",
          "- Remove filler words and redundant variants.",
          "- GOOD: 【搜索】Ava 加入 会话 deepseek 发言【/搜索】",
          "- BAD: 【搜索】加入 进入 进来 模型 agent AI 说话 发言 回复【/搜索】",
          "",
          "CORRECT:",
          "- '我说的第二条发言是什么' -> 【查看区间】user,2-2【/查看区间】",
          "- 'Ava 说的第一句是什么' -> 【查看区间】Ava,1-1【/查看区间】",
          "- '整个会话第二条是什么' -> 【查看区间】2-2【/查看区间】",
          "",
          "WRONG:",
          "- '谁说了什么' -> 【搜索】谁说了什么【/搜索】",
          "- Asking about a named agent and using generic search instead of name-scoped retrieval",
          "",
          "If the target is in the blind spot, output ONLY the marker.",
          turnHint,
          "【检索指令】",
        ].join("\n")
      : "";
    if (hardRuleContent) {
      // Find the last user message in the array and insert before it
      let lastUserIdx = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          lastUserIdx = i;
          break;
        }
      }
      const insertAt = lastUserIdx >= 0 ? lastUserIdx : messages.length;
      messages.splice(insertAt, 0, { role: "system", content: hardRuleContent });
    }
  }
  // Prompt-based thinking inhibition for models that don't support the thinking param
  // Also insert before the last user message so it's processed before the question
  if (getModelThinkingState() === "disabled" && !supportsThinkingParam(npc.model)) {
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    const insertAt = lastUserIdx >= 0 ? lastUserIdx : messages.length;
    messages.splice(insertAt, 0, { role: "system", content: "直接输出，不要输出思考过程。" });
  }

  // ── 调试：输出当前构建的上下文概览 ──
  debugLog("npc", "上下文概览", {
    total: messages.length,
    system: messages.filter(function (m) { return m.role === "system"; }).length,
    user: messages.filter(function (m) { return m.role === "user"; }).length,
    assistant: messages.filter(function (m) { return m.role === "assistant"; }).length,
    messages: messages.map(function (m) {
      var preview = (m.content || "").slice(0, 60);
      return { role: m.role, preview: preview + (m.content && m.content.length > 60 ? "..." : "") };
    }),
  });
  targetMessage.estimatedUsage = {
    input: estimateChatMessagesTokens(messages),
    output: 0,
    total: estimateChatMessagesTokens(messages),
  };

  // 保存上下文到消息（供搜索标记检测使用）
  targetMessage._contextMessages = messages;

  await streamChatCompletion(session, npc.name, npc.model, messages, npc.configId);

  // ── 保存 AI 响应到 IndexedDB ──
  if (window.__chatDB && !targetMessage.streaming) {
    const saveAssistant = window.__chatDB.appendMessage
      ? window.__chatDB.appendMessage(session.id, targetMessage)
      : window.__chatDB.saveMessage(session.id, targetMessage, getMessageSequenceInSession(session, targetMessage));
    saveAssistant.catch(function (err) {
      debugWarn("[chat] save assistant message failed", err);
    });
    window.__chatDB.updateSessionMeta(session).catch(function () {});
  }
}

// ── 搜索/区间标记检测：模型主动请求的历史检索 ──
// Returns true if a search or range retrieval was executed, false otherwise
async function handleSearchMarker(session, targetMessage, npc, contextMessages) {
  if (!window.__chatRetrieval || !targetMessage || !targetMessage.content) return false;
  const rawModelOutput = targetMessage.content;

  // 先检查区间查看标记
  let rangeReq = window.__chatRetrieval.extractRangeRequest(targetMessage.content);
  if (rangeReq) {
    debugLog("retrieval", "检测到模型区间查看请求", rangeReq);
    debugInfo("[MOYU-SEARCH] 模型触发了区间查看", rangeReq);
    appendToolTraceStep(targetMessage, {
      tool: "区间查看",
      label: "emit",
      command: `range ${rangeReq.raw || `${rangeReq.start}-${rangeReq.end}`}`,
      status: "running",
      detail: `marker=${rawModelOutput}\nrange=${rangeReq.raw || `${rangeReq.start}-${rangeReq.end}`}`,
    });
    // 立即清除标记内容，不让用户看到标记文本
    targetMessage.content = "";
    targetMessage.retrieving = true;
    targetMessage.pending = false;
    targetMessage.streaming = false;
    touchSession(session);
    persistSessions();
    renderMessages();
    setText(els.chatStatus, "正在检索历史记录...");

    const success = await window.__chatRetrieval.followUpStreamRange(
      session, targetMessage, rangeReq.start, rangeReq.end, rangeReq.scope || null, npc, contextMessages
    );
    if (!success) {
      targetMessage.retrieving = false;
      updateLastToolTraceStep(targetMessage, {
        status: "miss",
        detail: `marker=${rawModelOutput}\nrange=${rangeReq.raw || `${rangeReq.start}-${rangeReq.end}`}\nresult=miss`,
      });
      targetMessage.content = "（检索无结果）";
      touchSession(session);
      persistSessions();
      renderMessages({ stickToBottom: true });
      setText(els.chatStatus, "区间检索未命中");
    } else {
      targetMessage.retrieving = false;
      updateLastToolTraceStep(targetMessage, {
        status: "done",
      });
      touchSession(session);
      persistSessions();
      renderMessages({ stickToBottom: true });
      setText(els.chatStatus, "已检索相关历史记录");
    }
    return true;
  }

  // 再检查搜索标记
  const searchQuery = window.__chatRetrieval.extractSearchQuery(targetMessage.content);
  if (!searchQuery) return false;

  debugLog("retrieval", "检测到模型搜索请求", { query: searchQuery });
  debugInfo("[MOYU-SEARCH] 模型触发了搜索请求", { query: searchQuery });
  const historicalScopes = Array.isArray(session.historicalScopeNames) ? session.historicalScopeNames : [];
  const scopePreferred = isScopePreferredSearchQuery(searchQuery);
  if (scopePreferred) {
    debugWarn("[MOYU-SEARCH] scoped retrieval should have been preferred", {
      query: searchQuery,
      historicalScopes,
    });
  }
  appendToolTraceStep(targetMessage, {
    tool: "历史搜索",
    label: "emit",
    command: `search ${searchQuery}`,
    status: "running",
    detail: `marker=${rawModelOutput}\nquery=${searchQuery}${scopePreferred ? `\nwarn=scoped_retrieval_expected\nscopes=${historicalScopes.join(",")}` : ""}`,
  });
  // 立即清除标记内容
  targetMessage.content = "";
  targetMessage.retrieving = true;
  targetMessage.pending = false;
  targetMessage.streaming = false;
  touchSession(session);
  persistSessions();
  renderMessages();
  setText(els.chatStatus, "正在检索历史记录...");

  const success = await window.__chatRetrieval.followUpStreamSearch(
    session, targetMessage, searchQuery, session.id, npc, contextMessages
  );
  if (!success) {
    targetMessage.retrieving = false;
    updateLastToolTraceStep(targetMessage, {
      status: "miss",
      detail: `marker=${rawModelOutput}\nquery=${searchQuery}\nresult=miss`,
    });
    targetMessage.content = "（检索无结果）";
    touchSession(session);
    persistSessions();
    renderMessages({ stickToBottom: true });
    setText(els.chatStatus, "历史检索未命中");
  } else {
    targetMessage.retrieving = false;
    updateLastToolTraceStep(targetMessage, {
      status: "done",
    });
    touchSession(session);
    persistSessions();
    renderMessages({ stickToBottom: true });
    setText(els.chatStatus, "已检索相关历史记录");
  }
  return true;
}














function getNpcResponseTemperature(session, model) {
  const weak = isWeakModel(model);
  if (session?.mode === SESSION_MODE_STORY) {
    return weak ? 0.45 : 0.72;
  }
  return weak ? 0.25 : 0.5;
}


async function streamChatCompletion(session, speaker, model, messages, configId = "") {
  const targetMessage = findLatestAssistantMessage(session, speaker);
  if (!targetMessage) {
    throw new Error(`未找到 ${speaker} 的输出占位`);
  }

  const targetConfig = resolveModelConfig(configId, model, session.configId);

  // Defer reveal: buffer initial stream content, show meta + first chunk together
  let streamRevealed = false;
  let initialBuffer = "";
  let initialThinkingBuffer = "";
  const INITIAL_REVEAL_THRESHOLD = 12;
  const streamBatch = createStreamBatchController(
    targetMessage,
    () => renderMessages({ stickToBottom: true }),
    () => updateStreamingBubble(targetMessage)
  );

  const shouldTrackUsage = getSessionSetting(session, "showTokenDisplay") !== false;

  const buildStreamBody = (withUsage, withTemp = true) => {
    const body = {
      model,
      messages,
      stream: true,
    };
    if (withTemp) {
      body.temperature = getNpcResponseTemperature(session, model);
    }
    if (withUsage) {
      body.stream_options = { include_usage: true };
    }
    const thinkingExtra = buildModelThinkingExtra(model);
    if (thinkingExtra.thinking) {
      body.thinking = thinkingExtra.thinking;
    }
    return body;
  };

  const doStreamFetch = (withUsage, withTemp = true) => fetch(`${targetConfig.host}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${targetConfig.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildStreamBody(withUsage, withTemp)),
    signal: state.abortController?.signal,
  });

  let response = shouldTrackUsage ? await doStreamFetch(true) : await doStreamFetch(false);
  let errorDetail = "";

  if (!response.ok) {
    errorDetail = await safeReadError(response);
    const isUsageError = shouldTrackUsage && /stream_options|include_usage/i.test(errorDetail);
    const isTempError = /temperature|unsupported param/i.test(errorDetail);

    if (isUsageError && isTempError) {
      debugWarn("[MOYU] stream_options and temperature rejected, retrying without both", { model, detail: errorDetail });
      response = await doStreamFetch(false, false);
      errorDetail = "";
    } else if (isUsageError) {
      debugWarn("[MOYU] stream_options rejected, retrying without it", { model, detail: errorDetail });
      response = await doStreamFetch(false);
      errorDetail = "";
    } else if (isTempError) {
      debugWarn("[MOYU] temperature not supported, retrying without it", { model, detail: errorDetail });
      response = await doStreamFetch(shouldTrackUsage, false);
      errorDetail = "";
    }
  }

  if (!response.ok) {
    if (!errorDetail) {
      errorDetail = await safeReadError(response);
    }
    console.error("[MOYU] Stream chat completion failed", {
      speaker,
      model,
      status: response.status,
      detail: errorDetail,
    });
    targetMessage.streaming = false;
    targetMessage.content = `生成失败：模型 ${model} 调用失败：HTTP ${response.status}${errorDetail ? ` ${errorDetail}` : ""}`;
    touchSession(session);
    persistSessions();
    renderMessages({ stickToBottom: true });
    throw new Error(`模型 ${model} 调用失败：HTTP ${response.status}${errorDetail ? ` ${errorDetail}` : ""}`);
  }

  if (!response.body) {
    const result = await readChatCompletionPayload(response, model);
    targetMessage.content = result.content;
    if (speaker !== "导演 AI") {
      targetMessage.content = stripThinkingLeakage(targetMessage.content);
    }
    targetMessage.thinking = shouldRenderThinkingForModel(model) ? (result.thinking || "") : "";
    targetMessage.usage = normalizeUsage(result.usage);
    targetMessage.streaming = false;
    touchSession(session);
    persistSessions();
    renderMessages({ stickToBottom: true });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const segments = buffer.split("\n\n");
    buffer = segments.pop() || "";

    for (const segment of segments) {
      const lines = segment.split("\n");
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) {
          continue;
        }

        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") {
          continue;
        }

        try {
          const data = JSON.parse(payload);
          const usage = normalizeUsage(data?.usage);
          if (usage) {
            targetMessage.usage = usage;
          }
          const delta = data?.choices?.[0]?.delta?.content ?? data?.choices?.[0]?.message?.content ?? "";
          const thinkingDelta =
            data?.choices?.[0]?.delta?.reasoning_content ??
            data?.choices?.[0]?.delta?.reasoning ??
            data?.choices?.[0]?.message?.reasoning_content ??
            data?.choices?.[0]?.message?.reasoning ??
            "";
          const visibleThinkingDelta = shouldRenderThinkingForModel(model) ? thinkingDelta : "";
          if (visibleThinkingDelta && !streamRevealed) {
            initialThinkingBuffer += visibleThinkingDelta;
          }
          if (delta) {
            if (!streamRevealed) {
              initialBuffer += delta;
              if (initialBuffer.length >= INITIAL_REVEAL_THRESHOLD) {
                targetMessage.pending = false;
                targetMessage.streaming = true;
                streamBatch.revealWithInitial(initialBuffer, initialThinkingBuffer);
                streamRevealed = true;
                initialThinkingBuffer = "";
              }
            } else {
              streamBatch.queue(delta, visibleThinkingDelta, streamRevealed);
            }
          } else if (visibleThinkingDelta && streamRevealed) {
            streamBatch.queue("", visibleThinkingDelta, streamRevealed);
          }
        } catch {
          // Ignore incompatible keepalive chunks.
        }
      }
    }
  }

  // Flush any buffered content that didn't reach the threshold
  if (!streamRevealed && (initialBuffer || initialThinkingBuffer)) {
    targetMessage.pending = false;
    targetMessage.streaming = true;
    streamBatch.revealWithInitial(initialBuffer, initialThinkingBuffer);
    streamRevealed = true;
    initialThinkingBuffer = "";
  }
  streamBatch.flushFinal();

  if (!targetMessage.content.trim()) {
    targetMessage.streaming = false;
    targetMessage.pending = true;
    touchSession(session);
    persistSessions();
    renderMessages({ stickToBottom: true });
    debugLog("npc", t("debug.msg.npcRetry", { speaker }), { sessionId: session.id });
    await wait(300);

    targetMessage.thinking = "";
    const retryResponse = await doStreamFetch(shouldTrackUsage);

    if (retryResponse.ok && retryResponse.body) {
      let retryRevealed = false;
      let retryInitialBuffer = "";
      let retryInitialThinkingBuffer = "";
      const retryBatch = createStreamBatchController(
        targetMessage,
        () => renderMessages({ stickToBottom: true }),
        () => updateStreamingBubble(targetMessage)
      );
      const retryReader = retryResponse.body.getReader();
      const retryDecoder = new TextDecoder("utf-8");
      let retryBuffer = "";
      while (true) {
        const { value, done } = await retryReader.read();
        if (done) break;
        retryBuffer += retryDecoder.decode(value, { stream: true });
        const segments = retryBuffer.split("\n\n");
        retryBuffer = segments.pop() || "";
        for (const segment of segments) {
          const lines = segment.split("\n");
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const data = JSON.parse(payload);
              const usage = normalizeUsage(data?.usage);
              if (usage) {
                targetMessage.usage = usage;
              }
              const delta = data?.choices?.[0]?.delta?.content ?? "";
              const thinkingDelta =
                data?.choices?.[0]?.delta?.reasoning_content ??
                data?.choices?.[0]?.delta?.reasoning ??
                "";
              const visibleThinkingDelta = shouldRenderThinkingForModel(model) ? thinkingDelta : "";
              if (visibleThinkingDelta && !retryRevealed) {
                retryInitialThinkingBuffer += visibleThinkingDelta;
              }
              if (delta) {
                if (!retryRevealed) {
                  retryInitialBuffer += delta;
                  if (retryInitialBuffer.length >= INITIAL_REVEAL_THRESHOLD) {
                    targetMessage.pending = false;
                    targetMessage.streaming = true;
                    retryBatch.revealWithInitial(retryInitialBuffer, retryInitialThinkingBuffer);
                    retryRevealed = true;
                    retryInitialThinkingBuffer = "";
                  }
                } else {
                  retryBatch.queue(delta, visibleThinkingDelta, retryRevealed);
                }
              } else if (visibleThinkingDelta && retryRevealed) {
                retryBatch.queue("", visibleThinkingDelta, retryRevealed);
              }
            } catch {}
          }
        }
      }

      if (!retryRevealed && retryInitialBuffer) {
        targetMessage.pending = false;
        targetMessage.streaming = true;
        retryBatch.revealWithInitial(retryInitialBuffer, retryInitialThinkingBuffer);
        retryRevealed = true;
        retryInitialThinkingBuffer = "";
      }
      retryBatch.flushFinal();
    }

    if (!targetMessage.content.trim()) {
      targetMessage.content = "本次没有返回可显示内容";
    }
  }

  if (speaker !== "导演 AI") {
    targetMessage.content = sanitizeNpcReplyStrict(session, speaker, targetMessage.content);
    targetMessage.content = stripThinkingLeakage(targetMessage.content);
    targetMessage.content = stripFakeRetrievalClaims(targetMessage.content, targetMessage);
  }

  const estimatedInput = Number(targetMessage.estimatedUsage?.input || 0) || 0;
  const estimatedOutput = estimateTokens(targetMessage.content) + estimateTokens(targetMessage.thinking);
  targetMessage.estimatedUsage = {
    input: estimatedInput,
    output: estimatedOutput,
    total: estimatedInput + estimatedOutput,
  };

  targetMessage.streaming = false;
  touchSession(session);
  persistSessions();
  renderMessages({ stickToBottom: true });
}













