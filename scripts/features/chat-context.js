function buildChatHistory(session) {
  return buildHistoryMessagesFromSlice(getVisibleHistoryMessages(session), "HISTORY");
}

function getVisibleHistoryMessages(session) {
  return (session?.messages || []).filter((message) => {
    if (!message || message.role === "system") {
      return false;
    }
    if (message.role === "assistant" && !message.content && !message.pending && !message.streaming) {
      return false;
    }
    return Boolean(message.content);
  });
}

function buildHistoryLines(messages) {
  const lines = [];
  for (const message of messages || []) {
    const line = formatHistoryLine(message);
    if (!line) {
      continue;
    }
    if (lines.length > 0 && lines[lines.length - 1] === line) {
      continue;
    }
    lines.push(line);
  }
  return lines;
}

function buildHistoryMessagesFromSlice(messages, blockName = "HISTORY") {
  const lines = buildHistoryLines(messages);
  if (!lines.length) {
    return [];
  }
  return [
    {
      role: "system",
      content: `[${blockName}]\n${lines.join("\n")}\n[/${blockName}]`,
    },
  ];
}

function normalizeDirectorMemoryPayload(payload) {
  return normalizeDirectorMemory(payload);
}

function buildDirectorMemoryBlock(sessionOrMemory) {
  const rawMemory = sessionOrMemory?.directorMemory || sessionOrMemory;
  const memory = normalizeDirectorMemoryPayload(rawMemory);
  const sections = [];

  if (memory.scene) {
    sections.push(`场景：${memory.scene}`);
  }
  if (memory.relationships.length) {
    sections.push(`人物关系：\n- ${memory.relationships.join("\n- ")}`);
  }
  if (memory.facts.length) {
    sections.push(`关键事实：\n- ${memory.facts.join("\n- ")}`);
  }
  if (memory.tensions.length) {
    sections.push(`当前冲突：\n- ${memory.tensions.join("\n- ")}`);
  }
  if (memory.openLoops.length) {
    sections.push(`未解悬念：\n- ${memory.openLoops.join("\n- ")}`);
  }
  if (memory.npcState.length) {
    sections.push(`人物状态：\n- ${memory.npcState.join("\n- ")}`);
  }
  if (memory.synopsis) {
    sections.push(`总括：${memory.synopsis}`);
  }

  return sections.join("\n\n");
}

function buildDirectorMemorySystemMessage(sessionOrMemory) {
  const block = buildDirectorMemoryBlock(sessionOrMemory);
  if (!block) {
    return [];
  }
  return [{
    role: "system",
    content: `[DIRECTOR_MEMORY]\n${block}\n[/DIRECTOR_MEMORY]`,
  }];
}

function getDirectorMemoryTargetTokens(session, recentLimit = DIRECTOR_RECENT_HISTORY_LIMIT) {
  const currentDirectorContext = [
    { role: "system", content: getDirectorSystemPrompt(session) },
    { role: "system", content: "固定 NPC 列表：" + JSON.stringify((session.npcs || []).map((npc) => npc.name)) },
    { role: "system", content: "场内 NPC：" + JSON.stringify(getSceneNpcs(session).map((npc) => npc.name)) },
    { role: "system", content: "NPC 资料：" + buildDirectorNpcRoster(session) },
    { role: "system", content: "全局设定：" + session.globalPrompt },
    ...buildDirectorMemorySystemMessage(session),
    ...buildHistoryMessagesFromSlice(getDirectorRecentMessages(session, recentLimit), session?.directorMemory?.synopsis ? "RECENT_HISTORY" : "HISTORY"),
  ];
  const currentTokens = estimateChatMessagesTokens(currentDirectorContext);
  return Math.max(
    DIRECTOR_MEMORY_TARGET_MIN,
    Math.min(DIRECTOR_MEMORY_TARGET_MAX, Math.round(currentTokens * 0.42))
  );
}

function buildDirectorContextMessages(session) {
  const contextMessages = [];
  contextMessages.push(...buildDirectorMemorySystemMessage(session));
  const recentMessages = getDirectorRecentMessages(session);
  contextMessages.push(...buildHistoryMessagesFromSlice(recentMessages, contextMessages.length ? "RECENT_HISTORY" : "HISTORY"));
  return contextMessages;
}

function buildDirectorNpcRoster(session) {
  const fixedRoster = (session?.npcs || []).map((npc) => ({
    name: npc.name || "",
    model: npc.model || "",
    prompt: npc.prompt || "",
    transient: false,
  }));
  const transientRoster = (session?.transientNpcs || []).map((npc) => ({
    name: npc.name || "",
    model: npc.model || "",
    prompt: npc.prompt || "",
    transient: true,
  }));

  return JSON.stringify([...fixedRoster, ...transientRoster], null, 0);
}

function getDirectorRecentMessages(session, recentLimit = DIRECTOR_RECENT_HISTORY_LIMIT) {
  const visibleMessages = getVisibleHistoryMessages(session);
  if (!visibleMessages.length) {
    return [];
  }

  const cutoffIndex = session?.compressedUntilMessageId
    ? visibleMessages.findIndex((message) => message.id === session.compressedUntilMessageId)
    : -1;
  const unsummarized = cutoffIndex >= 0 ? visibleMessages.slice(cutoffIndex + 1) : visibleMessages;
  return unsummarized.slice(-recentLimit);
}

function getCompressibleDirectorMessages(session, recentLimit = DIRECTOR_RECENT_HISTORY_LIMIT) {
  const visibleMessages = getVisibleHistoryMessages(session);
  if (visibleMessages.length === 0) {
    return [];
  }

  const cutoffIndex = session?.compressedUntilMessageId
    ? visibleMessages.findIndex((message) => message.id === session.compressedUntilMessageId)
    : -1;
  const unsummarized = cutoffIndex >= 0 ? visibleMessages.slice(cutoffIndex + 1) : visibleMessages;
  if (unsummarized.length === 0) {
    return [];
  }

  const compressCount = Math.max(1, unsummarized.length - recentLimit);
  return unsummarized.slice(0, compressCount);
}

function buildManualCompressSourceMessages(session, recentLimit = DIRECTOR_MANUAL_RECENT_HISTORY_LIMIT) {
  const recentMessages = getDirectorRecentMessages(session, recentLimit);
  const recentHistoryBlock = buildHistoryMessagesFromSlice(recentMessages, "RECENT_HISTORY");
  const sourceMessages = [];

  sourceMessages.push(...buildDirectorMemorySystemMessage(session));
  sourceMessages.push(...recentHistoryBlock);
  return sourceMessages;
}

function buildNpcContextMessages(session, npc) {
  const scopedHistory = buildScopedNpcHistory(session, npc);
  const visibilityNote = npc?.transient
    ? [
        "你是刚进入场景的临时 NPC，登场前的事情你不在场。",
        "但上面 [DIRECTOR_MEMORY] 中的信息是所有 NPC 共享的公共记忆，你可以据此了解已发生的关键事件。",
        "你只能依据上面的角色设定和下面提供的对话片段来判断现在该怎么回应。",
        "如果上下文和记忆里都没写到的事情，就当你并不知道，禁止凭空编造。",
      ].join("\n")
    : [
        "你不是全知旁观者。",
        "上面 [DIRECTOR_MEMORY] 中的信息是所有 NPC 共享的公共记忆，你可以据此了解较早前发生的关键事件。",
        "但不要编造 [DIRECTOR_MEMORY] 和下方对话历史中均未出现的细节。",
      ].join("\n");

  // Calculate position info: tell the model which segment of the full history it can see
  // Must use the same filter as buildScopedNpcHistory and executeRangeRetrieval
  const totalMsgs = (session.messages || []).filter(function (m) {
    return m && m.role !== "system" && m.content && !m.pending;
  }).length;
  const scopedCount = scopedHistory.length;
  const blindEnd = totalMsgs - scopedCount;
  const scopedSpeakerNames = Array.from(new Set([
    ...((session.historicalScopeNames || []).filter(Boolean)),
    ...(session.messages || [])
      .filter((m) => m && m.role !== "system" && m.content && !m.pending)
      .map((m) => m.role === "user" ? "user" : (m.speaker || "assistant"))
      .filter(Boolean),
  ]));
  const positionNote = totalMsgs > scopedCount
    ? "You see GLOBAL messages " + (blindEnd + 1) + "-" + totalMsgs + " of " + totalMsgs + " below. BLIND SPOT: GLOBAL messages 1-" + blindEnd + " are NOT shown. You have zero knowledge of them."
    : "Full conversation: " + totalMsgs + " messages (global 1-" + totalMsgs + "). All shown below.";

  // Single AI mode: hard search rule before history
  const isSingleAI = session.mode === SESSION_MODE_WORK && !session.directorModel && (session.npcs || []).length === 1;
  const searchNote = isSingleAI && totalMsgs > scopedCount
    ? [
        "=== RETRIEVAL PROTOCOL: OBEY EXACTLY ===",
        "You do NOT have access to messages 1-" + blindEnd + ". They are outside your visible window.",
        "If the answer depends on blind-spot history, your ENTIRE reply MUST be exactly one retrieval marker and nothing else.",
        "",
        "ALLOWED MARKERS ONLY:",
        "1. 【查看区间】X-Y【/查看区间】",
        "2. 【查看区间】scope,X-Y【/查看区间】",
        "3. 【搜索】keywords【/搜索】",
        "",
        "AVAILABLE scope names in THIS conversation:",
        scopedSpeakerNames.join(", "),
        "",
        "SEMANTICS:",
        "- '第X条' / '第X条消息' / '第X条记录' / '整个会话的第X条' = GLOBAL chronological message index, counting BOTH user and assistant messages.",
        "- NEVER rewrite '第X条' as '用户第X条发言'.",
        "- '我说的第X条发言' / '我的第X条发言' = use 【查看区间】user,X-X【/查看区间】.",
        "- If the user refers to one speaker's own message list, use scoped retrieval: 【查看区间】SpeakerName,X-Y【/查看区间】.",
        "- '第X轮' is NOT '第X条'. A round starts at the Xth USER message and includes following assistant replies until the next user message.",
        "",
        "STRICT PRIORITY ORDER:",
        "A. If scoped retrieval can express the question, you MUST use scoped retrieval.",
        "B. If global range retrieval can express the question, you MUST use global range retrieval.",
        "C. Use 【搜索】...【/搜索】 ONLY when neither scoped nor range retrieval can express the request.",
        "D. When you must use 【搜索】...【/搜索】, the keywords must maximize coverage, not redundancy.",
        "",
        "THIS IS MANDATORY:",
        "- Questions about who said something, which model/agent joined, what a named agent said, or a specific user's own utterance MUST use scoped retrieval first.",
        "- For those cases, generic keyword search is WRONG unless scoped retrieval is impossible.",
        "- Only use a speaker-name scope from the available scope list above.",
        "",
        "FORBIDDEN:",
        "- No generic search when a scoped marker would work.",
        "- No keyword lists made of near-synonyms that cover the same semantic slot.",
        "- No natural-language answer before retrieval.",
        "- No roleplay, no explanation, no hedging, no 'let me check', no pretending you searched unless you actually output a retrieval marker.",
        "",
        "GENERIC SEARCH KEYWORD RULES:",
        "- Include distinct anchors when available: person/agent names, event/action, artifact/object, time hint, role/model hint, and topic noun.",
        "- Prefer 4-8 high-information tokens or short phrases.",
        "- Remove filler and redundant near-synonyms.",
        "- Good: 【搜索】Ava 加入 会话 deepseek 发言【/搜索】",
        "- Bad: 【搜索】加入 进入 进来 模型 agent AI 说话 发言 回复【/搜索】",
        "",
        "CORRECT EXAMPLES:",
        "- user asks '我说的第二条发言是什么' -> 【查看区间】user,2-2【/查看区间】",
        "- user asks 'Ava 说的第一句是什么' -> 【查看区间】Ava,1-1【/查看区间】",
        "- user asks '整个会话第二条是什么' -> 【查看区间】2-2【/查看区间】",
        "",
        "WRONG EXAMPLES:",
        "- Asking '谁说了什么' and outputting 【搜索】谁说了什么【/搜索】",
        "- Asking about a named agent and outputting generic search keywords instead of name-scoped retrieval",
        "",
        "If the needed target is in blind spot, output ONLY the marker. Nothing else.",
        "【检索指令】",
      ].join("\n")
    : "";

  return [
    { role: "system", content: visibilityNote },
    { role: "system", content: positionNote },
    ...(searchNote ? [{ role: "system", content: searchNote }] : []),
    ...scopedHistory,
  ];
}

function buildScopedNpcHistory(session, npc) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const visibleMessages = messages.filter((message) => {
    if (!message || message.role === "system") {
      return false;
    }
    if (!message.content || message.pending) {
      return false;
    }
    return true;
  });

  if (!visibleMessages.length) {
    return [];
  }

  const cutoffIndex = session?.compressedUntilMessageId
    ? visibleMessages.findIndex((message) => message.id === session.compressedUntilMessageId)
    : -1;
  const compressedVisibleMessages = cutoffIndex >= 0
    ? visibleMessages.slice(cutoffIndex + 1)
    : visibleMessages;
  const scopedSourceMessages = session?.chatSummary ? compressedVisibleMessages : visibleMessages;

  let scopedMessages;
  if (npc?.transient) {
    const spawnedAt = npc.spawnedAt ? new Date(npc.spawnedAt).getTime() : NaN;
    const spawnedMessages = Number.isFinite(spawnedAt)
      ? scopedSourceMessages.filter((message) => new Date(message.createdAt || 0).getTime() >= spawnedAt)
      : [];
    const transientWindow = spawnedMessages.length ? spawnedMessages : scopedSourceMessages.slice(-4);
    scopedMessages = transientWindow.slice(-6);
  } else if (session.mode === SESSION_MODE_WORK) {
    // work 模式保持最近 30 条，模型可通过搜索回顾更早历史
    const windowSize = 30;
    scopedMessages = scopedSourceMessages.length > windowSize
      ? scopedSourceMessages.slice(-windowSize)
      : scopedSourceMessages;
  } else {
    const ownLastIndex = findLastNpcMessageIndex(scopedSourceMessages, npc?.name);
    const startIndex = ownLastIndex >= 0 ? Math.max(ownLastIndex, scopedSourceMessages.length - 8) : Math.max(0, scopedSourceMessages.length - 8);
    scopedMessages = scopedSourceMessages.slice(startIndex);
  }

  return scopedMessages.map((message) => {
    if (message.uiType === "narration") {
      return { role: "assistant", content: "[旁白] " + message.content };
    }
    if (message.role === "assistant") {
      return { role: "assistant", content: message.content };
    }
    return { role: "user", content: message.content };
  });
}

function findLastNpcMessageIndex(messages, speaker) {
  if (!speaker) {
    return -1;
  }

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === "assistant" && message.speaker === speaker) {
      return i;
    }
  }

  return -1;
}

function formatHistoryLine(message) {
  if (!message) {
    return "";
  }

  if (message.uiType === "narration") {
    return message.content ? "{narration} " + message.content : "";
  }

  if (!message.content) {
    return "";
  }

  const tag = message.role === "user" ? "{user}" : "{npc}";
  return tag + " " + message.content;
}


function sanitizeNarrationText(content) {
  const cleaned = String(content || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^旁白[：:]\s*/u, "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();

  // 检测乱码：如果包含连续"io数字."模式（如 "光天化io2010.2010."），认为是模型生成异常
  if (/[ioIO]\d+\.\d+/.test(cleaned)) {
    throw new Error("导演旁白包含乱码/模型生成异常");
  }

  return cleaned;
}

function extractDirectorJson(content) {
  const raw = String(content || "").trim();
  if (!raw) {
    return "";
  }

  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = (fenceMatch ? fenceMatch[1] : raw).trim();

  if (source.startsWith("{") && source.endsWith("}")) {
    return source;
  }

  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth === 0) {
        continue;
      }
      depth -= 1;
      if (depth === 0 && start !== -1) {
        return source.slice(start, index + 1).trim();
      }
    }
  }

  return "";
}

function buildDirectorJsonCandidates(jsonText) {
  const base = String(jsonText || "").trim();
  if (!base) {
    return [];
  }

  const candidates = [];
  const pushCandidate = (value) => {
    const normalized = String(value || "").trim();
    if (!normalized || candidates.includes(normalized)) {
      return;
    }
    candidates.push(normalized);
  };

  pushCandidate(base);
  pushCandidate(base.replace(/^﻿/, "").replace(/[​-‍⁠]/g, ""));
  pushCandidate(base.replace(/[“”]/g, "\"").replace(/[‘’]/g, "'"));
  pushCandidate(
    base
      .replace(/^﻿/, "")
      .replace(/[​-‍⁠]/g, "")
      .replace(/[“”]/g, "\"")
      .replace(/[‘’]/g, "'")
      .replace(/,\s*([}\]])/g, "$1")
  );

  return candidates;
}

function parseDirectorJsonLoose(jsonText) {
  const candidates = buildDirectorJsonCandidates(jsonText);
  let lastError = null;

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("导演返回的 JSON 无法解析");
}

function parseDirectorMemoryPayload(content, session) {
  const raw = String(content || "").trim();
  if (!raw) {
    return normalizeDirectorMemory({
      synopsis: String(session?.directorSummary || "").trim(),
    });
  }

  try {
    const parsed = parseDirectorJsonLoose(raw);
    return normalizeDirectorMemory(parsed);
  } catch {
    return normalizeDirectorMemory({
      scene: "",
      relationships: [],
      facts: [],
      tensions: [],
      openLoops: [],
      npcState: [],
      synopsis: raw,
    });
  }
}

function parseDirectorDirective(content, session) {
  const jsonText = extractDirectorJson(content);
  if (!jsonText) {
    throw new Error("导演没有返回 JSON");
  }

  let parsed;
  try {
    parsed = parseDirectorJsonLoose(jsonText);
  } catch {
    throw new Error("导演返回的 JSON 无法解析");
  }
  const narration = typeof parsed.narration === "string" ? parsed.narration.trim() : "";
  const responders = Array.isArray(parsed.responders) ? parsed.responders.map((item) => String(item).trim()).filter(Boolean) : [];
  const spawnNpcs = Array.isArray(parsed.spawn_npcs) ? parsed.spawn_npcs : [];
  const npcInstructions = parsed.npc_instructions && typeof parsed.npc_instructions === "object" && !Array.isArray(parsed.npc_instructions)
    ? parsed.npc_instructions
    : {};
  return sanitizeDirectorDirective(session, narration, responders, spawnNpcs, npcInstructions);
}

function sanitizeDirectorDirective(session, narration, responders, spawnNpcs = [], npcInstructions = {}) {
  const existingNpcNames = getSceneNpcs(session).map((npc) => npc.name);
  const spawnMap = new Map();

  spawnNpcs.forEach((rawNpc) => {
    const normalized = normalizeSpawnNpc(rawNpc);
    if (normalized && !existingNpcNames.includes(normalized.name)) {
      spawnMap.set(normalized.name, normalized);
    }
  });

  const requestedSpawnNpcs = [...spawnMap.values()];
  const knownNpcNames = [...existingNpcNames, ...requestedSpawnNpcs.map((npc) => npc.name)];
  const normalizedResponders = [];
  const seenResponders = new Set();
  responders.forEach((name) => {
    if (!knownNpcNames.includes(name) || seenResponders.has(name)) {
      return;
    }
    seenResponders.add(name);
    normalizedResponders.push(name);
  });
  const cleanedNarration = sanitizeNarrationText(narration);

  if (responders.some((name) => name && !knownNpcNames.includes(name))) {
    throw new Error("导演返回了未声明的 responder");
  }

  validateDirectorNarration(cleanedNarration, knownNpcNames);

  // 过滤 npcInstructions，只保留针对已知 NPC 的指令（纯调度模式下直接丢弃）
  const filteredInstructions = {};
  if (!state.settings?.session?.directorDispatchOnly && npcInstructions && typeof npcInstructions === "object" && !Array.isArray(npcInstructions)) {
    for (const [npcName, instruction] of Object.entries(npcInstructions)) {
      if (knownNpcNames.includes(npcName) && typeof instruction === "string" && instruction.trim()) {
        filteredInstructions[npcName] = instruction.trim();
      }
    }
  }

  return {
    narration: cleanedNarration,
    responders: normalizedResponders,
    spawnNpcs: requestedSpawnNpcs,
    npcInstructions: filteredInstructions,
  };
}

function validateDirectorNarration(narration, knownNpcNames) {
  if (!narration) {
    return;
  }

  if (/【?\s*新\s*NPC\s*登场\s*[：:]/u.test(narration)) {
    throw new Error("导演把临时 NPC 声明写进了旁白");
  }

  for (const name of knownNpcNames) {
    if (!name) {
      continue;
    }

    const speakerLabelPattern = new RegExp(`(^|\\n|\\s)${escapeRegExp(name)}[：:]`, "u");
    if (speakerLabelPattern.test(narration)) {
      throw new Error(`导演把 ${name} 的台词写进了旁白`);
    }
  }
}

function normalizeSpawnNpc(raw) {
  if (!raw) {
    return null;
  }

  if (typeof raw === "string") {
    const name = raw.trim();
    return name ? { name, prompt: "" } : null;
  }

  const name = String(raw.name || "").trim();
  const prompt = String(raw.prompt || raw.description || raw.notes || "").trim();
  if (!name) {
    return null;
  }

  return { name, prompt };
}

function pickTransientNpcModel(session) {
  const pool = (session.npcs || []).filter((npc) => npc.model && npc.configId);
  if (!pool.length) {
    return {
      model: session.directorModel || "",
      configId: session.directorConfigId || session.configId || "",
    };
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function upsertTransientNpcs(session, requestedSpawnNpcs) {
  const baseNames = new Set((session.npcs || []).map((npc) => npc.name));
  const current = Array.isArray(session.transientNpcs) ? session.transientNpcs.map((npc) => ({ ...npc })) : [];

  requestedSpawnNpcs.forEach((rawNpc) => {
    const normalized = normalizeSpawnNpc(rawNpc);
    if (!normalized || baseNames.has(normalized.name)) {
      return;
    }

    const existing = current.find((npc) => npc.name === normalized.name);
    if (existing) {
      if (normalized.prompt) {
        existing.prompt = normalized.prompt;
      }
      return;
    }

    const assignedModel = pickTransientNpcModel(session);
    current.push({
      name: normalized.name,
      prompt: normalized.prompt,
      model: assignedModel.model || session.directorModel || "",
      configId: assignedModel.configId || session.directorConfigId || session.configId || "",
      transient: true,
      spawnedAt: new Date().toISOString(),
    });
  });

  session.transientNpcs = current;
  return current;
}

function getResponderNpcs(session, responderNames) {
  const sceneNpcMap = new Map(getSceneNpcs(session).map((npc) => [npc.name, npc]));
  const orderedResponders = [];
  const seen = new Set();

  responderNames.forEach((name) => {
    if (!name || seen.has(name)) {
      return;
    }
    const npc = sceneNpcMap.get(name);
    if (!npc) {
      return;
    }
    seen.add(name);
    orderedResponders.push(npc);
  });

  return orderedResponders;
}

function sanitizeNpcReply(session, speaker, content) {
  let cleaned = String(content || "").trim();
  if (!cleaned) {
    return cleaned;
  }
  if (/^`{3,}/m.test(cleaned)) {
    return cleaned;
  }

  const allNpcNames = getSceneNpcs(session).map((npc) => npc.name);
  const labelPattern = new RegExp(`^(${allNpcNames.map(escapeRegExp).join("|")})[：:]\\s*`);
  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const keptLines = [];
  for (const line of lines) {
    const match = line.match(labelPattern);
    if (!match) {
      keptLines.push(line);
      continue;
    }

    const lineSpeaker = match[1];
    if (lineSpeaker === speaker) {
      keptLines.push(line.replace(labelPattern, "").trim());
      continue;
    }

    if (keptLines.length > 0) {
      break;
    }
  }

  cleaned = keptLines.join("\n").trim() || cleaned.replace(labelPattern, "").trim();

  const selfReplayPattern = new RegExp(`(?:^|\\n)${escapeRegExp(speaker)}[：:]`, "g");
  const selfReplayCount = (cleaned.match(selfReplayPattern) || []).length;
  if (selfReplayCount > 0) {
    cleaned = cleaned.split(/\n/)[0].replace(labelPattern, "").trim();
  }

  return cleaned;
}

function sanitizeNpcReplyStrict(session, speaker, content) {
  let cleaned = sanitizeNpcReply(session, speaker, content);
  if (!cleaned) {
    return cleaned;
  }
  if (/^`{3,}/m.test(cleaned)) {
    return cleaned;
  }

  cleaned = cleaned.replace(/^旁白[：:]\s*/u, "").trim();
  const allNpcNames = getSceneNpcs(session).map((npc) => npc.name);
  const labelPattern = new RegExp(`^(${allNpcNames.map(escapeRegExp).join("|")})[：:]\\s*`);
  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const keptLines = [];
  for (const line of lines) {
    if (/^旁白[：:]/u.test(line)) {
      if (keptLines.length > 0) {
        break;
      }
      continue;
    }

    const match = line.match(labelPattern);
    if (!match) {
      keptLines.push(line);
      continue;
    }

    if (match[1] === speaker) {
      keptLines.push(line.replace(labelPattern, "").trim());
      continue;
    }

    if (keptLines.length > 0) {
      break;
    }
  }

  cleaned = keptLines.join("\n").trim() || cleaned.replace(labelPattern, "").trim();
  const selfReplayPattern = new RegExp(`(?:^|\\n)${escapeRegExp(speaker)}[：:]`, "g");
  if ((cleaned.match(selfReplayPattern) || []).length > 0) {
    cleaned = cleaned.split(/\n/)[0].replace(labelPattern, "").trim();
  }

  // 如果 NPC 输出中包含"你："的用户消息标签，截断丢弃（NPC 模拟了用户发言）
  const userLabelIndex = cleaned.search(/\n你[：:]/u);
  if (userLabelIndex !== -1) {
    cleaned = cleaned.slice(0, userLabelIndex).trim();
  }

  const turnContext = getCurrentTurnNpcContext(session, speaker);
  const latestPriorReply = turnContext.previousReplies[turnContext.previousReplies.length - 1]?.content || "";
  if (latestPriorReply) {
    const normalizedPrior = normalizeComparableText(latestPriorReply);
    const normalizedCurrent = normalizeComparableText(cleaned);
    if (normalizedPrior && normalizedCurrent.startsWith(normalizedPrior) && cleaned.length > latestPriorReply.length) {
      cleaned = cleaned.slice(latestPriorReply.length).trim();
    } else {
      const overlapPrefix = findRepeatedPrefix(cleaned, latestPriorReply);
      if (overlapPrefix && overlapPrefix.length >= 24) {
        cleaned = cleaned.slice(overlapPrefix.length).trim();
      }
    }
  }

  return cleaned;
}

function stripThinkingLeakage(content) {
  if (!content) return content;
  let cleaned = String(content).trim();
  if (!cleaned) return cleaned;

  const debugMode = isDebugModeEnabled();
  const beforeLines = cleaned;

  // Deduplicate repeated blocks (same paragraph repeated N times)
  const blocks = cleaned.split(/\n{2,}/);
  if (blocks.length > 1) {
    const seen = new Set();
    const unique = [];
    for (const block of blocks) {
      const norm = block.replace(/\s+/g, "").toLowerCase();
      if (!seen.has(norm)) {
        seen.add(norm);
        unique.push(block);
      }
    }
    cleaned = unique.join("\n\n");
  }

  if (debugMode && cleaned !== beforeLines) {
    debugLog("stripThinking", t("debug.msg.strippedRepeatedBlocks"), {
      before: beforeLines,
      after: cleaned,
    });
  }

  return cleaned;
}

function getCurrentTurnNpcContext(session, speaker) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }

  const previousReplies = [];
  for (let i = lastUserIndex + 1; i < messages.length; i += 1) {
    const item = messages[i];
    if (!item || item.role !== "assistant" || item.uiType === "narration" || item.speaker === speaker) {
      continue;
    }
    if (!item.content || item.pending || item.streaming) {
      continue;
    }
    previousReplies.push({
      speaker: item.speaker,
      content: item.content,
    });
  }

  return {
    previousReplies,
    previousSpeakers: previousReplies.map((item) => item.speaker),
  };
}

function normalizeComparableText(content) {
  return String(content || "")
    .replace(/\s+/g, "")
    .replace(/[（）()\[\]【】"'“”、，。！？!?,.:：；;<>《》]/g, "")
    .trim();
}

function findRepeatedPrefix(current, prior) {
  const currentText = String(current || "");
  const priorText = String(prior || "");
  const maxLength = Math.min(currentText.length, priorText.length);
  let matchedLength = 0;

  for (let i = 0; i < maxLength; i += 1) {
    if (currentText[i] !== priorText[i]) {
      break;
    }
    matchedLength = i + 1;
  }

  return matchedLength > 0 ? currentText.slice(0, matchedLength) : "";
}

function renderInlineMarkdown(text) {
  // Input is already HTML-escaped — safe from XSS
  // Order matters: process inline code first so ** inside `` is not mistaken for bold
  let result = text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/__([^_]+)__/g, "<u>$1</u>")
    // Support raw <u> tags from AI output (already escaped to &lt;u&gt; by escapeHtml)
    .replace(/&lt;u&gt;(.+?)&lt;\/u&gt;/g, "<u>$1</u>");

  // Images ![alt](url) — must process before links
  result = result.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (match, alt, url) => {
      const trimmed = url.trim();
      if (/^(https?:\/\/|data:)/i.test(trimmed)) {
        return `<img src="${trimmed}" alt="${alt}" loading="lazy" style="max-width:100%">`;
      }
      return alt || match;
    }
  );

  // Links — only allow safe URL schemes
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (match, linkText, url) => {
      const trimmed = url.trim();
      if (/^(https?:\/\/|mailto:)/i.test(trimmed)) {
        return `<a href="${trimmed}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
      }
      return linkText;
    }
  );

  return result;
}

function unescapeHtml(text) {
  return String(text)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function formatCodeBlock(lang, code) {
  return String(code || "");
}

// Normalize code fence language identifiers to highlight.js language names.
// AI models often output informal or partial names (e.g. "objective" vs "objectivec").
const LANG_ALIASES = {
  "c#": "csharp",
  "c++": "cpp",
  "cplusplus": "cpp",
  "objective": "objectivec",
  "objective-c": "objectivec",
  "obj-c": "objectivec",
  "objc": "objectivec",
  "f#": "fsharp",
  "fsharp": "fsharp",
  "vb.net": "vbnet",
  "golang": "go",
  "node": "javascript",
  "ts": "typescript",
  "js": "javascript",
  "py": "python",
  "rb": "ruby",
  "sh": "bash",
  "shell": "bash",
};
function normalizeCodeLang(raw) {
  const lang = String(raw || "").trim().toLowerCase();
  return LANG_ALIASES[lang] || lang;
}

function renderMarkdownContent(text) {
  // Input is already HTML-escaped — safe from XSS
  // Converts markdown to safe HTML for work mode chat bubbles
  if (!text) return "";

  const lines = text.split("\n");
  const fragments = [];
  let inCodeBlock = false;
  let codeBuffer = [];
  let paraBuffer = [];
  let tableBuffer = [];
  let openingFence = null;

  function flushPara() {
    if (paraBuffer.length) {
      fragments.push("<p>" + paraBuffer.join("<br>") + "</p>");
      paraBuffer = [];
    }
  }

  function isTableRow(line) {
    return /^\|.+\|$/.test(line.trim());
  }
  function isTableSeparator(line) {
    var t = line.trim();
    return /^\|[\s\-:|]+\|$/.test(t) && /-/.test(t);
  }
  function parseTableCells(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(function (cell) { return cell.trim(); });
  }
  function flushTable() {
    if (tableBuffer.length >= 3 && isTableSeparator(tableBuffer[1])) {
      var headerCells = parseTableCells(tableBuffer[0]);
      var alignments = parseTableCells(tableBuffer[1]).map(function (cell) {
        var t = cell.trim();
        if (/^:[-]+:$/.test(t)) return "center";
        if (/^[-]+:$/.test(t)) return "right";
        if (/^:[-]+$/.test(t)) return "left";
        return "";
      });
      var dataRows = tableBuffer.slice(2);
      var html = ["<table>"];
      html.push("<thead><tr>");
      headerCells.forEach(function (cell, i) {
        var align = alignments[i] ? " style=\"text-align:" + alignments[i] + "\"" : "";
        html.push("<th" + align + ">" + renderInlineMarkdown(cell) + "</th>");
      });
      html.push("</tr></thead><tbody>");
      dataRows.forEach(function (row) {
        var cells = parseTableCells(row);
        html.push("<tr>");
        cells.forEach(function (cell, i) {
          var align = alignments[i] ? " style=\"text-align:" + alignments[i] + "\"" : "";
          html.push("<td" + align + ">" + renderInlineMarkdown(cell) + "</td>");
        });
        html.push("</tr>");
      });
      html.push("</tbody></table>");
      fragments.push(html.join(""));
    } else {
      tableBuffer.forEach(function (line) {
        paraBuffer.push(renderInlineMarkdown(line));
      });
      flushPara();
    }
    tableBuffer = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code block — must track fence length (CommonMark: closing fence
    // needs at least as many backticks as the opening fence).
    const fenceMatch = line.match(/^`{3,}/);
    if (fenceMatch) {
      const fenceLen = fenceMatch[0].length;
      flushPara();
      if (inCodeBlock) {
        const openLen = (openingFence?.match(/^`+/) || [""])[0].length;
        const isCleanFence = /^`+\s*$/.test(line);
        if (fenceLen >= openLen && isCleanFence) {
          const langMatch = openingFence?.match(/^`+\s*(\S*)/);
          const rawLang = (langMatch && langMatch[1]) || "";
          const lang = normalizeCodeLang(rawLang);
          const langAttr = lang ? ` class="language-${lang}"` : "";
          const copyBtnHtml = "<button class=\"code-copy-btn\" type=\"button\" title=\"复制代码\"><i class=\"bi bi-clipboard\"></i></button>";
          const langLabelHtml = lang
            ? `<div class="code-block-header"><span>${escapeHtml(lang.toUpperCase())}</span>${copyBtnHtml}</div>`
            : `<div class="code-block-header no-lang">${copyBtnHtml}</div>`;
          // Unescape → format → re-escape for proper indentation
          const rawCode = unescapeHtml(codeBuffer.join("\n"));
          const formattedCode = formatCodeBlock(lang, rawCode);
          const escapedCode = escapeHtml(formattedCode);
          fragments.push(
            "<pre class=\"pre-code-block\">" +
            langLabelHtml +
            "<code" + langAttr + ">" + escapedCode + "</code></pre>"
          );
          codeBuffer = [];
          openingFence = null;
          inCodeBlock = false;
        } else {
          codeBuffer.push(line);
        }
      } else {
        openingFence = line;
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Table row — buffer until we can decide if it's a valid table
    if (isTableRow(line)) {
      flushPara();
      tableBuffer.push(line);
      continue;
    }
    if (tableBuffer.length > 0) {
      flushTable();
    }

    // Empty line = paragraph break
    if (line.trim() === "") {
      flushPara();
      continue;
    }

    const processed = renderInlineMarkdown(line);

    // Heading (# through ######)
    const headingMatch = line.match(/^(#{1,6})\s/);
    if (headingMatch) {
      flushPara();
      const level = headingMatch[1].length;
      const content = processed.slice(headingMatch[0].length);
      fragments.push("<h" + level + ">" + content + "</h" + level + ">");
      continue;
    }

    // Blockquote (> is escaped to &gt; by escapeHtml)
    if (/^&gt;\s/.test(line)) {
      flushPara();
      fragments.push("<blockquote>" + processed.replace(/^&gt;\s/, "") + "</blockquote>");
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(line)) {
      flushPara();
      fragments.push("<li>" + processed.replace(/^[-*+]\s/, "") + "</li>");
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      flushPara();
      fragments.push("<li>" + processed.replace(/^\d+\.\s/, "") + "</li>");
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,})$/.test(line)) {
      flushPara();
      fragments.push("<hr>");
      continue;
    }

    // Regular paragraph line
    paraBuffer.push(processed);
  }

  flushTable();
  flushPara();

  // Close unclosed code block — same treatment as closed but without formatting
  if (inCodeBlock && codeBuffer.length) {
    const langMatch = openingFence?.match(/^`+\s*(\S*)/);
    const rawLang = (langMatch && langMatch[1]) || "";
    const lang = normalizeCodeLang(rawLang);
    const langAttr = lang ? ` class="language-${lang}"` : "";
    const copyBtnHtml = "<button class=\"code-copy-btn\" type=\"button\" title=\"复制代码\"><i class=\"bi bi-clipboard\"></i></button>";
    const langLabelHtml = lang
      ? `<div class="code-block-header"><span>${escapeHtml(lang.toUpperCase())}</span>${copyBtnHtml}</div>`
      : `<div class="code-block-header no-lang">${copyBtnHtml}</div>`;
    const rawCode = unescapeHtml(codeBuffer.join("\n"));
    const escapedCode = escapeHtml(rawCode);
    fragments.push(
      "<pre class=\"pre-code-block\">" +
      langLabelHtml +
      "<code" + langAttr + ">" + escapedCode + "</code></pre>"
    );
  }

  let html = fragments.join("\n");
  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*?<\/li>(?:\n|$))+)/g, "<ul>$1</ul>");
  return html;
}

function buildDirectorContextTokenMetrics(session) {
  if (!session) {
    return null;
  }

  // 只衡量导演记忆本身（排除系统提示词、NPC 资料等固定开销），
  // 因为压缩只能缩小记忆，无法减少固定开销。
  const memoryMessages = buildDirectorMemorySystemMessage(session);
  const recentMessages = getDirectorRecentMessages(session);

  return {
    contextCurrent: estimateChatMessagesTokens(memoryMessages),
    contextThreshold: DIRECTOR_MEMORY_TARGET_MAX,
    recentCount: recentMessages.length,
  };
}

function renderStoryContent(text) {
  if (!text) return "";
  let html = text.replace(/\n/g, "<br>");
  // ASCII double quotes (HTML-escaped): &quot;content&quot;
  html = html.replace(/&quot;(.*?)&quot;/g, '<span class="story-dialogue">"$1"</span>');
  // Chinese double quotes: "content"
  html = html.replace(/“([^”]*)”/g, '<span class="story-dialogue">“$1”</span>');
  // Inner thoughts in parentheses
  html = html.replace(/（([^）]*)）/g, '<span class="story-thought">（$1）</span>');
  html = html.replace(/\(([^)]*)\)/g, '<span class="story-thought">($1)</span>');
  return html;
}
