function autoResizeChatInput() {
  const el = els.chatInput;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

const DIRECTOR_RECENT_HISTORY_LIMIT = 8;
const DIRECTOR_MANUAL_RECENT_HISTORY_LIMIT = 4;
const DIRECTOR_AUTO_COMPRESS_THRESHOLD_DEFAULT = 1800;
const DIRECTOR_MEMORY_TARGET_MIN = 260;
const DIRECTOR_MEMORY_TARGET_MAX = 720;
const DIRECTOR_SUMMARY_PROMPT = [
  "你是导演记忆整合器。",
  "请把给定的多 NPC 对话压缩成一份给导演 AI 使用的结构化长期记忆。",
  "你要同时兼顾两件事：信息不残、token 尽量省。",
  "不要写修辞，不要扩写，不要模仿对白，不要复述整段原文。",
  "只保留后续调度真正需要的内容：场景状态、人物关系、已公开事实、隐藏事实/危险、正在发酵的冲突、未解决悬念、临时 NPC 身份、明显的人物状态变化。",
  "必须只输出 JSON 对象，字段固定为：scene, relationships, facts, tensions, openLoops, npcState, synopsis。",
  "其中 relationships/facts/tensions/openLoops/npcState 都必须是字符串数组；scene/synopsis 必须是字符串。",
  "每个数组尽量控制在 3 到 8 条，每条一句话，短而信息密。",
  "synopsis 只写一小段总括，不要和数组内容大段重复。",
].join("\\n");

const DIRECTOR_MANUAL_RECOMPRESS_PROMPT = [
  "你是导演长期记忆压缩器。",
  "请在不丢掉关键调度信息的前提下，把当前导演记忆压得更短、更稳、更结构化。",
  "优先删除重复、修辞、次要细节、已经不再重要的气氛描写。",
  "必须保留：当前场景、人物关系、关键事实、仍在生效的冲突/秘密、未解决悬念、NPC 当前状态。",
  "如果当前记忆已经足够紧凑，就只做轻度整理，不要为压缩而压缩。",
  "必须只输出 JSON 对象，字段固定为：scene, relationships, facts, tensions, openLoops, npcState, synopsis。",
].join("\\n");

function bindChat() {
  els.sendBtn.addEventListener("click", sendUserMessage);
  if (els.compressMemoryBtn) {
    ensureCompressMemoryPopover();
    els.compressMemoryBtn.addEventListener("pointerdown", (event) => {
      debugLog("compress", "Toolbar icon pointerdown", {
        disabled: Boolean(els.compressMemoryBtn?.disabled),
        open: state.openCompressMemoryInfo,
      });
      event.preventDefault();
    });
    els.compressMemoryBtn.addEventListener("click", (event) => {
      debugLog("compress", "Toolbar icon click", {
        disabled: Boolean(els.compressMemoryBtn?.disabled),
        openBefore: state.openCompressMemoryInfo,
      });
      event.preventDefault();
      event.stopPropagation();
      state.openCompressMemoryInfo = !state.openCompressMemoryInfo;
      renderCompressMemoryPopover();
    });
  }
  els.chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendUserMessage();
    }
  });
  els.chatInput.addEventListener("input", clearSuggestions);
  if (els.suggestBtn) {
    els.suggestBtn.addEventListener("click", generateSuggestions);
  }
  const suggestionClose = els.suggestionBar?.querySelector(".suggestion-close-btn");
  if (suggestionClose) {
    suggestionClose.addEventListener("click", clearSuggestions);
  }
  els.chatInput.addEventListener("input", autoResizeChatInput);
  els.chatMessages.addEventListener("click", (event) => {
    if (!event.target.closest(".message.user")) {
      if (state.openUserMessageToolsId) {
        state.openUserMessageToolsId = null;
        renderMessages();
      }
    }
    if (!event.target.closest(".message.agent")) {
      if (state.openAgentTokenInfoId) {
        state.openAgentTokenInfoId = null;
        renderMessages();
      }
    }
  });
  document.addEventListener("click", (event) => {
    if (!state.openCompressMemoryInfo) {
      return;
    }
    if (event.target.closest("#compressMemoryBtn") || event.target.closest(".memory-compress-popover")) {
      return;
    }
    debugLog("compress", "Popover closed by outside click");
    state.openCompressMemoryInfo = false;
    renderCompressMemoryPopover();
  });
  window.addEventListener("resize", autoResizeChatInput);
  autoResizeChatInput();
}

function autoResizeChatInput() {
  const el = els.chatInput;
  if (!el) {
    return;
  }

  const computed = window.getComputedStyle(el);
  const minHeight = parseFloat(computed.minHeight) || 0;
  const maxHeight = parseFloat(computed.maxHeight) || (
    window.matchMedia("(max-width: 640px)").matches
      ? 132
      : window.matchMedia("(max-width: 960px)").matches
        ? 156
        : 184
  );

  el.style.height = "auto";
  const nextHeight = Math.max(minHeight, Math.min(el.scrollHeight, maxHeight));
  el.style.height = `${nextHeight}px`;
  el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
}


function updateComposerMode() {
  const composer = els.chatInput?.closest(".composer");
  const composerShell = els.chatInput?.closest(".composer-shell");
  const currentSession = getCurrentSession();
  if (state.editingUserMessageId) {
    els.sendBtn.textContent = "确定修改";
    els.chatInput.classList.add("editing");
    if (composer) {
      composer.classList.add("editing");
    }
    if (composerShell) {
      composerShell.classList.add("editing");
    }
    if (els.cancelEditBtn) {
      els.cancelEditBtn.classList.remove("hidden");
    }
    if (els.compressMemoryBtn) {
      els.compressMemoryBtn.disabled = true;
    }
    setText(els.chatStatus, "正在修改一条历史消息，确认后会删除其后的内容并重新生成");
    clearSuggestions();
    updateSuggestBtn();
    return;
  }

  els.chatInput.classList.remove("editing");
  if (composer) {
    composer.classList.remove("editing");
  }
  if (composerShell) {
    composerShell.classList.remove("editing");
  }
  if (els.cancelEditBtn) {
    els.cancelEditBtn.classList.add("hidden");
  }
  if (els.compressMemoryBtn) {
    els.compressMemoryBtn.disabled = state.isSending || !currentSession;
  }
  renderCompressMemoryPopover();
  els.sendBtn.textContent = t("chat.send");
  setText(els.chatStatus, state.isSending ? "正在处理中..." : "可以开始聊天了");
  updateSuggestBtn();
}

function beginUserMessageEdit(messageId) {
  if (state.isSending) {
    return;
  }

  const session = getCurrentSession();
  if (!session) {
    return;
  }

  const target = session.messages.find((message) => message.id === messageId && message.role === "user");
  if (!target) {
    return;
  }

  state.editingUserMessageId = messageId;
  state.openUserMessageToolsId = null;
  els.chatInput.disabled = false;
  els.sendBtn.disabled = false;
  els.chatInput.value = target.content || "";
  autoResizeChatInput();
  updateComposerMode();
  queueMicrotask(() => {
    els.chatInput.focus();
    els.chatInput.setSelectionRange(els.chatInput.value.length, els.chatInput.value.length);
  });
  renderMessages();
}

function clearUserMessageEdit() {
  state.editingUserMessageId = null;
  state.openUserMessageToolsId = null;
  if (!state.isSending) {
    els.chatInput.value = "";
    autoResizeChatInput();
  }
  updateComposerMode();
  renderMessages();
}

function copyMessageContent(messageId) {
  const session = getCurrentSession();
  if (!session) {
    return;
  }
  const message = session.messages.find((m) => m.id === messageId);
  if (!message || !message.content) {
    return;
  }

  navigator.clipboard.writeText(message.content).then(() => {
    setText(els.chatStatus, t("chat.copied"));
  }, () => {
    const textarea = document.createElement("textarea");
    textarea.value = message.content;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    setText(els.chatStatus, t("chat.copied"));
  });
}

async function regenerateFromUserMessage(messageId) {
  const session = getCurrentSession();
  if (!session || state.isSending) {
    return;
  }

  const target = session.messages.find((message) => message.id === messageId && message.role === "user");
  if (!target) {
    return;
  }

  state.isSending = true;
  els.sendBtn.disabled = true;
  els.chatInput.disabled = true;
  updateComposerMode();
  clearUserMessageEdit();
  applyUserMessageEdit(session, messageId, target.content || "");
  debugLog("turn", "Regenerate from user message", {
    sessionId: session.id,
    messageId,
    content: target.content || "",
  });
  touchSession(session);
  persistSessions();
  renderMessages({ stickToBottom: true });
  renderChatListMenu();
  await runSessionTurn(session);
}

function applyUserMessageEdit(session, messageId, content) {
  const targetIndex = session.messages.findIndex((message) => message.id === messageId && message.role === "user");
  if (targetIndex === -1) {
    session.messages.push({
      id: createMessageId("user"),
      role: "user",
      speaker: "你",
      content,
      createdAt: new Date().toISOString(),
    });
    return;
  }

  const target = session.messages[targetIndex];
  target.content = content;
  target.createdAt = new Date().toISOString();
  session.messages = session.messages.slice(0, targetIndex + 1);
  session.transientNpcs = [];
}

function renderMessages(options = {}) {
  const shouldStickToBottom = Boolean(options.stickToBottom);
  const previousScrollTop = els.chatMessages.scrollTop;
  const previousScrollHeight = els.chatMessages.scrollHeight;
  const session = getCurrentSession();
  els.chatMessages.innerHTML = "";
  if (!session) {
    return;
  }

  session.messages.forEach((message) => {
    if (message.uiType === "system-notice") {
      const notice = document.createElement("div");
      notice.className = "system-notice";
      notice.innerHTML = escapeHtml(message.content).replace(/\n/g, "<br>");
      els.chatMessages.appendChild(notice);
      return;
    }

    if (message.uiType === "narration") {
      const narrationText = sanitizeNarrationText(message.content);
      const tokenLabel = buildMessageTokenLabel(message);
      const wrapper = document.createElement("article");
      wrapper.className = `narration-block ${state.openAgentTokenInfoId === message.id ? "token-open" : ""}`.trim();

      const narration = document.createElement("div");
      narration.className = `narration ${message.pending ? "pending" : ""} ${message.streaming ? "streaming" : ""} ${!message.pending && !/[\r\n]/.test(narrationText) ? "single-line" : ""}`.trim();
      narration.innerHTML = message.pending
        ? `<span class="typing-row"><span></span><span></span><span></span></span>`
        : escapeHtml(narrationText).replace(/\n/g, "<br>");
      if (message.id && tokenLabel && isMobileTokenToggleMode()) {
        narration.addEventListener("click", () => {
          state.openAgentTokenInfoId = state.openAgentTokenInfoId === message.id ? null : message.id;
          renderMessages();
        });
      }
      wrapper.appendChild(narration);

      if (message.id && !message.pending) {
        const tokenBar = document.createElement("div");
        tokenBar.className = `message-token-bar narration-token-bar ${tokenLabel ? "has-token" : ""}`.trim();
        tokenBar.textContent = tokenLabel;
        wrapper.appendChild(tokenBar);
      }

      els.chatMessages.appendChild(wrapper);
      return;
    }

    const block = document.createElement("article");
    block.className = `message-block ${message.role === "user" ? "user" : message.role === "assistant" ? "agent" : "system"} ${state.openUserMessageToolsId === message.id || state.openAgentTokenInfoId === message.id ? "tools-open" : ""} ${state.openAgentTokenInfoId === message.id ? "token-open" : ""}`.trim();

    if (message.role === "assistant" || message.role === "user") {
      const meta = document.createElement("div");
      meta.className = "message-meta";
      meta.innerHTML = `
        <strong>${escapeHtml(message.speaker)}</strong>
        <span>${new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
      `;
      block.appendChild(meta);
    }

    const tokenLabel = message.role === "assistant" ? buildMessageTokenLabel(message) : "";

    const isSingleLineMessage = !message.pending && !/[\r\n]/.test(message.content || "");
    const bubble = document.createElement("div");
    bubble.className = `message ${message.role === "user" ? "user" : message.role === "system" ? "system" : "agent"} ${message.pending ? "pending" : ""} ${message.streaming ? "streaming" : ""} ${isSingleLineMessage ? "single-line" : ""}`.trim();
    bubble.innerHTML = message.pending
      ? `<span class="typing-row"><span></span><span></span><span></span></span>`
      : escapeHtml(message.content).replace(/\n/g, "<br>");
    if (message.role === "user" && message.id) {
      bubble.addEventListener("click", () => {
        state.openUserMessageToolsId = state.openUserMessageToolsId === message.id ? null : message.id;
        renderMessages();
      });
    }
    if (message.role === "assistant" && message.id && isMobileTokenToggleMode()) {
      bubble.addEventListener("click", () => {
        state.openAgentTokenInfoId = state.openAgentTokenInfoId === message.id ? null : message.id;
        renderMessages();
      });
    }
    block.appendChild(bubble);

    if (message.id && !message.pending) {
      const tools = document.createElement("div");
      tools.className = "message-tools";
      if (message.role === "user") {
        tools.style.justifyContent = "flex-end";
      } else if (message.role === "assistant") {
        tools.style.justifyContent = "space-between";
      }

      if (message.role === "assistant" && tokenLabel) {
        const tokenSpan = document.createElement("span");
        tokenSpan.className = "message-token-label";
        tokenSpan.textContent = tokenLabel;
        tools.appendChild(tokenSpan);
      }

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "message-edit-btn";
      copyBtn.title = t("chat.copy");
      copyBtn.innerHTML = `
        <i class="bi bi-copy message-edit-icon"></i>
      `;
      copyBtn.addEventListener("click", () => copyMessageContent(message.id));
      tools.appendChild(copyBtn);

      if (message.role === "user") {
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = `message-edit-btn ${state.editingUserMessageId === message.id ? "active" : ""}`.trim();
        editBtn.innerHTML = `
          <i class="bi bi-pencil message-edit-icon"></i>
        `;
        editBtn.addEventListener("click", () => beginUserMessageEdit(message.id));
        tools.appendChild(editBtn);

        const retryBtn = document.createElement("button");
        retryBtn.type = "button";
        retryBtn.className = "message-edit-btn";
        retryBtn.innerHTML = `
          <i class="bi bi-arrow-counterclockwise message-edit-icon"></i>
        `;
        retryBtn.addEventListener("click", () => regenerateFromUserMessage(message.id));
        tools.appendChild(retryBtn);
      }
      block.appendChild(tools);

      els.chatMessages.appendChild(block);
    }
  });

  if (shouldStickToBottom) {
    els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
    return;
  }

  const heightDelta = els.chatMessages.scrollHeight - previousScrollHeight;
  els.chatMessages.scrollTop = previousScrollTop + Math.max(0, heightDelta);
}

async function sendUserMessage() {
  const session = getCurrentSession();
  if (!session || state.isSending) {
    return;
  }

  clearSuggestions();

  const content = els.chatInput.value.trim();
  if (!content) {
    setText(els.chatStatus, "请先输入内容");
    return;
  }

  state.isSending = true;
  els.sendBtn.disabled = true;
  els.chatInput.disabled = true;
  updateComposerMode();

  if (state.editingUserMessageId) {
    applyUserMessageEdit(session, state.editingUserMessageId, content);
    state.editingUserMessageId = null;
  } else {
    session.messages.push({
      id: createMessageId("user"),
      role: "user",
      speaker: "你",
      content,
      createdAt: new Date().toISOString(),
    });
  }

  touchSession(session);
  persistSessions();
  renderMessages({ stickToBottom: true });
  renderChatListMenu();
  els.chatInput.value = "";
  autoResizeChatInput();
  debugLog("turn", "User message submitted", {
    sessionId: session.id,
    editingMessageId: state.editingUserMessageId,
    content,
  });

  await runSessionTurn(session);
}

async function runSessionTurn(session) {
  if (!session) {
    return;
  }

  const isNoDirector = session.mode === SESSION_MODE_WORK && !session.directorModel && session.npcs.length === 1;

  if (isNoDirector) {
    try {
      const npc = session.npcs[0];
      setText(els.chatStatus, `${npc.name} 正在回复...`);
      await callNpc(session, npc, {});
      touchSession(session);
      persistSessions();
      renderMessages({ stickToBottom: true });
      renderChatListMenu();
      setText(els.chatStatus, `${npc.name} 已回复`);
    } catch (error) {
      debugLog("turn", "Turn failed", {
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
    } finally {
      state.isSending = false;
      els.sendBtn.disabled = false;
      els.chatInput.disabled = false;
      autoResizeChatInput();
      updateComposerMode();
    }
    return;
  }

  try {
    debugLog("turn", "Director turn started", {
      sessionId: session.id,
      messageCount: session.messages.length,
      transientNpcCount: (session.transientNpcs || []).length,
    });
    const directive = await callDirector(session);
    debugLog("director", "Directive accepted", directive);
    if (directive.spawnNpcs?.length) {
      upsertTransientNpcs(session, directive.spawnNpcs);
      debugLog("director", "Transient NPCs updated", session.transientNpcs || []);
      touchSession(session);
      persistSessions();
    }
    if (directive.narration) {
      const narrationMessage = {
        id: `narration-${Date.now()}`,
        role: "assistant",
        speaker: "导演 AI",
        uiType: "narration",
        content: "",
        createdAt: new Date().toISOString(),
        pending: false,
        streaming: true,
        usage: directive.usage || null,
        estimatedUsage: directive.usage ? null : {
          input: estimateChatMessagesTokens([
            { role: "system", content: getDirectorSystemPrompt(session) },
            { role: "system", content: "固定 NPC 列表：" + JSON.stringify(session.npcs.map((npc) => npc.name)) },
            { role: "system", content: "场内 NPC：" + JSON.stringify(getSceneNpcs(session).map((npc) => npc.name)) },
            { role: "system", content: "全局设定：" + session.globalPrompt },
            ...buildDirectorContextMessages(session),
          ]),
          output: estimateTokens(directive.narration),
          total: 0,
        },
      };
      if (narrationMessage.estimatedUsage) {
        narrationMessage.estimatedUsage.total = narrationMessage.estimatedUsage.input + narrationMessage.estimatedUsage.output;
      }
      session.messages.push(narrationMessage);
      renderMessages({ stickToBottom: true });
      await streamLocalText(narrationMessage, directive.narration);
      touchSession(session);
      persistSessions();
    }

    const responders = getResponderNpcs(session, directive.responders);
    debugLog("director", "Responders resolved", responders.map((npc) => ({
      name: npc.name,
      model: npc.model,
      transient: Boolean(npc.transient),
    })));
    if (!responders.length) {
      setText(els.chatStatus, directive.narration ? "旁白已更新，本轮没有 NPC 需要回答" : "本轮没有 NPC 需要回答");
    } else {
      for (const npc of responders) {
        await callNpc(session, npc, directive.npcInstructions);
      }
      debugLog("turn", "NPC replies completed", responders.map((npc) => npc.name));
      setText(els.chatStatus, "本轮回复已完成");
    }

    touchSession(session);
    persistSessions();
    renderMessages({ stickToBottom: true });
    renderChatListMenu();
  } catch (error) {
    debugLog("turn", "Turn failed", {
      sessionId: session.id,
      error: error.message,
    });
    console.error("[MOYU] Session turn failed", {
      sessionId: session.id,
      error: error.message,
      host: session.host,
      directorModel: session.directorModel,
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
  } finally {
    state.isSending = false;
    els.sendBtn.disabled = false;
    els.chatInput.disabled = false;
    autoResizeChatInput();
    updateComposerMode();
  }
}

async function callDirector(session) {
  await ensureDirectorSummary(session);
  const sceneNpcNames = getSceneNpcs(session).map((npc) => npc.name);
  const fixedNpcNames = session.npcs.map((npc) => npc.name);

  const messages = [
    { role: "system", content: getDirectorSystemPrompt(session) },
    { role: "system", content: "固定 NPC 列表：" + JSON.stringify(fixedNpcNames) },
    { role: "system", content: "场内 NPC：" + JSON.stringify(sceneNpcNames) },
    { role: "system", content: "NPC 资料：" + buildDirectorNpcRoster(session) },
    { role: "system", content: "全局设定：" + session.globalPrompt },
    ...buildDirectorContextMessages(session),
  ];

  for (let attempt = 0; attempt < 4; attempt += 1) {
    debugLog("director", "Request attempt", {
      sessionId: session.id,
      attempt: attempt + 1,
      model: session.directorModel,
    });
    const requestMessages = attempt === 0
      ? messages
      : [
          ...messages,
          {
            role: "system",
            content: [
              "你的上一条输出不是 JSON，已被丢弃。",
              "现在重新输出——只输出 JSON 对象，一行。",
              "不要自然语言、不要解释、不要 markdown、不要\"旁白：\"前缀。",
              "",
              "⚠️ 重新判断 responders：",
              "检查用户最新消息中的名字。",
              '"小夏荷"匹配"夏荷"，"春桃姐"匹配"春桃"——昵称/简称也要算。',
              "上一轮有 NPC 回复过用户，用户在追问 → 该 NPC 必须进 responders。",
              "如果用户没提任何 NPC、也没接任何人的话 → responders 可以是 []。",
            ].join("\n"),
          },
        ];

    const directorConfig = resolveModelConfig(session.directorConfigId, session.directorModel, session.configId);
    const payload = await createChatCompletionPayload(directorConfig.host, directorConfig.key, session.directorModel, requestMessages, false, 0.5);
    const content = payload.content;
    debugLog("director", "Raw response received", {
      attempt: attempt + 1,
      content,
    });

    try {
      const directive = parseDirectorDirective(content, session);
      directive.usage = normalizeUsage(payload.usage) || {
        input: estimateChatMessagesTokens(requestMessages),
        output: estimateTokens(content),
        total: estimateChatMessagesTokens(requestMessages) + estimateTokens(content),
      };
      return directive;
    } catch (jsonError) {
      debugLog("director", "Invalid response, retrying", {
        attempt: attempt + 1,
        error: jsonError.message,
        content,
      });

      if (attempt >= 1) {
        try {
          const repaired = await repairDirectorDirective(session, messages, content, attempt + 1);
          debugLog("director", "Repair response accepted", repaired);
          return repaired;
        } catch (repairError) {
          debugLog("director", "Repair response failed", {
            attempt: attempt + 1,
            error: repairError.message,
          });
        }
      }

      if (attempt === 3) {
        throw jsonError;
      }
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

  debugLog("director", "Repair attempt", {
    sessionId: session.id,
    attempt,
    invalidContent,
  });

  const directorConfig = resolveModelConfig(session.directorConfigId, session.directorModel, session.configId);
  const repairedPayload = await createChatCompletionPayload(directorConfig.host, directorConfig.key, session.directorModel, repairMessages, false, 0.5);
  const repairedContent = repairedPayload.content;
  debugLog("director", "Repair raw response received", {
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
        content: [
          "你是标题生成器。",
          "请根据会话主题生成一个 4 到 8 个汉字的中文标题。",
          "不要标点，不要解释，不要引号，不要额外文本。",
          "要简洁，像聊天标题。"
        ].join("\n"),
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

async function callNpc(session, npc, npcInstructions = {}) {
  const targetMessage = {
    id: `msg-${npc.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: "assistant",
    speaker: npc.name,
    content: "",
    createdAt: new Date().toISOString(),
    pending: true,
    streaming: false,
  };
  session.messages.push(targetMessage);
  touchSession(session);
  persistSessions();
  renderMessages({ stickToBottom: true });

  const turnContext = getCurrentTurnNpcContext(session, npc.name);
  const priorRepliesText = turnContext.previousSpeakers.length
    ? `本轮在你之前已经发言的 NPC：${turnContext.previousSpeakers.join("、")}。`
    : "你是本轮第一个发言的 NPC。";

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

  const baseRules = [
    `你现在扮演 ${npc.name}。`,
    npc.prompt ? `人物要求：${npc.prompt}` : "请根据全局设定和当前聊天自然回应。",
    priorRepliesText,
    directiveSection,
    "",
    "=== 绝对禁止 ===",
    "1. 禁止重复！检查历史中你自己的上一条回复，如果与你要说的话有 40% 以上词语重合，这是严重违规。",
    "   每轮必须用全新的措辞、不同的比喻、不同的角度来回应。宁可说一句全新的话，也不准改写旧内容。",
    "2. 禁止模拟别的 NPC、禁止替别人补充、禁止自问自答、禁止连续写多轮对话。",
    `3. 禁止输出"${npc.name}："这种说话人标签，直接输出内容本身。`,
    "4. 只输出一版最终答案，不要给草稿、补充版、总结版、收尾版。",
    "5. 只能写你自己的发言、动作、神态、感受和判断。禁止替别的 NPC 决定动作，禁止代替别的 NPC 说话。",
    "6. 如果本轮在你之前已经有 NPC 说过话，禁止重写、复述、扩写、改写那位 NPC 刚刚说过的大段内容。",
    "7. 你可以接着别人的话往下说，但必须明显往前推进，不能把上一位的整段描写再说一遍。",
    "",
    "=== 必须遵守 ===",
    "如果用户要求限制字数、格式或风格，你必须严格遵守。",
  ].join("\n");

  const messages = [
    { role: "system", content: baseRules },
    { role: "system", content: `Current in-scene NPCs: ${getSceneNpcs(session).map((item) => item.name).join(", ") || "none"}` },
    { role: "system", content: `全局设定：\n${session.globalPrompt}` },
    { role: "system", content: `当前场内 NPC 名单：${session.npcs.map((item) => item.name).join("、")}` },
    ...buildNpcContextMessages(session, npc),
  ];
  targetMessage.estimatedUsage = {
    input: estimateChatMessagesTokens(messages),
    output: 0,
    total: estimateChatMessagesTokens(messages),
  };

  await streamChatCompletion(session, npc.name, npc.model, messages, npc.configId);
}

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
  if (visibleMessages.length <= recentLimit) {
    return [];
  }

  const cutoffIndex = session?.compressedUntilMessageId
    ? visibleMessages.findIndex((message) => message.id === session.compressedUntilMessageId)
    : -1;
  const unsummarized = cutoffIndex >= 0 ? visibleMessages.slice(cutoffIndex + 1) : visibleMessages;
  if (unsummarized.length <= recentLimit) {
    return [];
  }

  return unsummarized.slice(0, unsummarized.length - recentLimit);
}

function buildManualCompressSourceMessages(session, recentLimit = DIRECTOR_MANUAL_RECENT_HISTORY_LIMIT) {
  const recentMessages = getDirectorRecentMessages(session, recentLimit);
  const recentHistoryBlock = buildHistoryMessagesFromSlice(recentMessages, "RECENT_HISTORY");
  const sourceMessages = [];

  sourceMessages.push(...buildDirectorMemorySystemMessage(session));
  sourceMessages.push(...recentHistoryBlock);
  return sourceMessages;
}

async function ensureDirectorSummary(session, options = {}) {
  if (!session) {
    return false;
  }

  const recentLimit = options.recentLimit ?? DIRECTOR_RECENT_HISTORY_LIMIT;
  const force = Boolean(options.force);
  const mode = options.mode || (force ? "manual" : "auto");
  const candidateMessages = getCompressibleDirectorMessages(session, recentLimit);
  if (mode !== "manual" && !candidateMessages.length) {
    return false;
  }

  if (mode !== "manual") {
    const currentDirectorContext = [
      { role: "system", content: getDirectorSystemPrompt(session) },
      { role: "system", content: "固定 NPC 列表：" + JSON.stringify((session.npcs || []).map((npc) => npc.name)) },
      { role: "system", content: "场内 NPC：" + JSON.stringify(getSceneNpcs(session).map((npc) => npc.name)) },
      { role: "system", content: "全局设定：" + session.globalPrompt },
      ...buildDirectorContextMessages(session),
    ];
    const threshold = state.settings?.session?.compressThreshold || DIRECTOR_AUTO_COMPRESS_THRESHOLD_DEFAULT;
    if (estimateChatMessagesTokens(currentDirectorContext) < threshold) {
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

  const payload = await createChatCompletionPayload(directorConfig.host, directorConfig.key, session.directorModel, summaryMessages, false, 0.4);
  const nextMemory = parseDirectorMemoryPayload(payload.content, session);
  const nextMemoryBlock = buildDirectorMemoryBlock(nextMemory);
  const nextSummary = nextMemory.synopsis || nextMemoryBlock;
  const nextMemoryTokens = estimateTokens(nextMemoryBlock || nextSummary);
  const shouldApplyManualSummary = mode !== "manual"
    || !currentMemoryBlock
    || nextMemoryTokens <= Math.max(DIRECTOR_MEMORY_TARGET_MIN, beforeManualBudget);

  if (!shouldApplyManualSummary) {
    return false;
  }

  session.directorMemory = nextMemory;
  session.directorSummary = nextSummary;
  if (mode === "manual") {
    const visibleMessages = getVisibleHistoryMessages(session);
    session.compressedUntilMessageId = visibleMessages[visibleMessages.length - 1]?.id || session.compressedUntilMessageId || "";
  } else {
    session.compressedUntilMessageId = candidateMessages[candidateMessages.length - 1]?.id || session.compressedUntilMessageId || "";
  }
  touchSession(session);
  persistSessions();
  return true;
}

async function triggerManualDirectorCompression() {
  const session = getCurrentSession();
  let finalStatusText = "";
  debugLog("compress", "Compression requested", {
    hasSession: Boolean(session),
    isSending: state.isSending,
    openPopover: state.openCompressMemoryInfo,
  });
  if (!session || state.isSending) {
    debugLog("compress", "Compression aborted before start", {
      reason: !session ? "missing-session" : "sending-in-progress",
    });
    return;
  }

  state.openCompressMemoryInfo = false;
  renderCompressMemoryPopover();
  if (els.compressMemoryBtn) {
    els.compressMemoryBtn.disabled = true;
  }
  updateComposerMode();
  setText(els.chatStatus, "正在压缩导演记忆...");
  debugLog("compress", "Compression started", {
    sessionId: session.id,
    recentLimit: DIRECTOR_MANUAL_RECENT_HISTORY_LIMIT,
  });

  try {
    const changed = await ensureDirectorSummary(session, {
      force: true,
      mode: "manual",
      recentLimit: DIRECTOR_MANUAL_RECENT_HISTORY_LIMIT,
    });
    debugLog("compress", "Compression finished", {
      changed,
      summaryLength: String(session.directorSummary || "").length,
      compressedUntilMessageId: session.compressedUntilMessageId || "",
    });
    if (!changed) {
      finalStatusText = "当前导演记忆已经够短了";
      setText(els.chatStatus, finalStatusText);
    } else {
      finalStatusText = "导演记忆已压缩";
      setText(els.chatStatus, finalStatusText);
    }
  } catch (error) {
    debugLog("compress", "Compression failed", {
      message: error?.message || String(error),
    });
    finalStatusText = `压缩失败：${error.message}`;
    setText(els.chatStatus, finalStatusText);
  } finally {
    updateComposerMode();
    if (finalStatusText) {
      setText(els.chatStatus, finalStatusText);
    }
  }
}

function isMobileTokenToggleMode() {
  return window.matchMedia("(hover: none), (pointer: coarse)").matches;
}

function ensureCompressMemoryPopover() {
  if (!els.compressMemoryBtn || !els.composerFooter) {
    debugLog("compress", "Popover mount skipped", {
      hasButton: Boolean(els.compressMemoryBtn),
      hasFooter: Boolean(els.composerFooter),
    });
    return null;
  }
  let popover = els.composerFooter.querySelector(".memory-compress-popover");
  if (!popover) {
    popover = document.createElement("div");
    popover.className = "memory-compress-popover hidden";
    debugLog("compress", "Popover mounted");
    els.compressMemoryBtn.insertAdjacentElement("afterend", popover);
  }
  return popover;
}

function buildDirectorContextTokenMetrics(session) {
  if (!session) {
    return null;
  }

  const currentDirectorContext = [
    { role: "system", content: getDirectorSystemPrompt(session) },
    { role: "system", content: "固定 NPC 列表：" + JSON.stringify((session.npcs || []).map((npc) => npc.name)) },
    { role: "system", content: "场内 NPC：" + JSON.stringify(getSceneNpcs(session).map((npc) => npc.name)) },
    { role: "system", content: "NPC 资料：" + buildDirectorNpcRoster(session) },
    { role: "system", content: "全局设定：" + session.globalPrompt },
    ...buildDirectorContextMessages(session),
  ];

  const recentMessages = getDirectorRecentMessages(session);

  return {
    contextCurrent: estimateChatMessagesTokens(currentDirectorContext),
    contextThreshold: state.settings?.session?.compressThreshold || DIRECTOR_AUTO_COMPRESS_THRESHOLD_DEFAULT,
    recentCount: recentMessages.length,
  };
}

function buildCompressMemoryPopoverMarkup(session) {
  const metrics = buildDirectorContextTokenMetrics(session);
  if (!metrics) {
    return "";
  }

  const contextPercent = Math.max(0, Math.min(100, Math.round((metrics.contextCurrent / Math.max(1, metrics.contextThreshold)) * 100)));

  return `
    <p class="memory-compress-popover-head">导演上下文与自动压缩进度</p>
    <div class="memory-compress-stat">
      <div class="memory-compress-stat-row">
        <span class="memory-compress-stat-label">上下文</span>
        <span class="memory-compress-stat-value">${metrics.contextCurrent} / ${metrics.contextThreshold}</span>
      </div>
      <div class="memory-compress-progress"><div class="memory-compress-progress-fill" style="width:${contextPercent}%"></div></div>
    </div>
    <button class="memory-compress-popover-action" type="button"${state.isSending ? " disabled" : ""}>压缩</button>
  `.trim();
}

function renderCompressMemoryPopover() {
  const popover = ensureCompressMemoryPopover();
  if (!popover || !els.compressMemoryBtn) {
    debugLog("compress", "Popover render skipped", {
      hasPopover: Boolean(popover),
      hasButton: Boolean(els.compressMemoryBtn),
    });
    return;
  }

  const session = getCurrentSession();
  const hasSession = Boolean(session);
  popover.innerHTML = hasSession ? buildCompressMemoryPopoverMarkup(session) : "";
  popover.classList.toggle("hidden", !hasSession);
  els.compressMemoryBtn.classList.toggle("info-open", state.openCompressMemoryInfo && hasSession);
  debugLog("compress", "Popover rendered", {
    hasSession,
    open: state.openCompressMemoryInfo,
    sending: state.isSending,
    hasMarkup: Boolean(popover.innerHTML.trim()),
  });
  const actionBtn = popover.querySelector(".memory-compress-popover-action");
  if (actionBtn) {
    actionBtn.disabled = state.isSending || !hasSession;
    actionBtn.onpointerdown = (event) => {
      debugLog("compress", "Popover action pointerdown", {
        disabled: actionBtn.disabled,
      });
      event.preventDefault();
      event.stopPropagation();
    };
    actionBtn.onclick = (event) => {
      debugLog("compress", "Popover action click", {
        disabled: actionBtn.disabled,
        hasSession,
        sending: state.isSending,
      });
      event.preventDefault();
      event.stopPropagation();
      void triggerManualDirectorCompression();
    };
    debugLog("compress", "Popover action bound", {
      disabled: actionBtn.disabled,
    });
  } else {
    debugLog("compress", "Popover action missing after render");
  }
}

function normalizeUsage(rawUsage) {
  if (!rawUsage || typeof rawUsage !== "object") {
    return null;
  }

  const input = Number(rawUsage.prompt_tokens ?? rawUsage.input_tokens ?? rawUsage.input ?? 0) || 0;
  const output = Number(rawUsage.completion_tokens ?? rawUsage.output_tokens ?? rawUsage.output ?? 0) || 0;
  const total = Number(rawUsage.total_tokens ?? input + output) || 0;
  if (!input && !output && !total) {
    return null;
  }

  return { input, output, total };
}

function estimateTokens(text) {
  const source = String(text || "");
  if (!source.trim()) {
    return 0;
  }

  const cjkMatches = source.match(/[\u3400-\u9FFF\uF900-\uFAFF]/g) || [];
  const asciiWordMatches = source.match(/[A-Za-z0-9_]+/g) || [];
  const asciiWordChars = asciiWordMatches.reduce((sum, chunk) => sum + chunk.length, 0);
  const punctuationChars = (source.match(/[^\sA-Za-z0-9_\u3400-\u9FFF\uF900-\uFAFF]/g) || []).length;
  const whitespaceChars = (source.match(/\s/g) || []).length;
  const otherChars = Math.max(0, source.length - cjkMatches.length - asciiWordChars - punctuationChars - whitespaceChars);

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

function estimateChatMessagesTokens(messages) {
  if (!Array.isArray(messages) || !messages.length) {
    return 0;
  }

  let total = 0;
  messages.forEach((message) => {
    total += 4;
    total += estimateTokens(message?.role || "");
    total += estimateTokens(message?.name || "");
    total += estimateTokens(message?.content || "");
  });

  return Math.max(1, total + 2);
}

function buildMessageTokenLabel(message) {
  if (state.settings?.session?.showTokenDisplay === false) {
    return "";
  }
  const usage = normalizeUsage(message?.usage);
  const estimatedUsage = normalizeUsage(message?.estimatedUsage);
  const tokenStats = usage || estimatedUsage;
  if (!tokenStats) {
    return "";
  }
  const prefix = usage ? "" : "~";

  if (tokenStats.input && tokenStats.output) {
    return `${prefix}${tokenStats.input} in · ${prefix}${tokenStats.output} out`;
  }
  if (tokenStats.total) {
    return `${prefix}${tokenStats.total} total`;
  }
  if (tokenStats.input) {
    return `${prefix}${tokenStats.input} in`;
  }
  return `${prefix}${tokenStats.output} out`;
}

function buildNpcContextMessages(session, npc) {
  const scopedHistory = buildScopedNpcHistory(session, npc);
  const visibilityNote = npc?.transient
    ? [
        "你是刚进入场景的临时 NPC。",
        "你不知道登场前的大部分旧历史，也没有读过完整会话记录。",
        "你只能依据上面的角色设定，以及下面提供的有限片段来判断现在该怎么回应。",
        "如果上下文里没写到的事情，就当你并不知道，禁止装作自己早就见过或参与过。",
      ].join("\n")
    : [
        "你不是全知旁观者。",
        "你只能依据下面提供的局部上下文来回应，禁止假装知道未出现在上下文里的更早细节。",
      ].join("\n");

  return [
    { role: "system", content: visibilityNote },
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

  let scopedMessages;
  if (npc?.transient) {
    const spawnedAt = npc.spawnedAt ? new Date(npc.spawnedAt).getTime() : NaN;
    const spawnedMessages = Number.isFinite(spawnedAt)
      ? visibleMessages.filter((message) => new Date(message.createdAt || 0).getTime() >= spawnedAt)
      : [];
    const transientWindow = spawnedMessages.length ? spawnedMessages : visibleMessages.slice(-4);
    scopedMessages = transientWindow.slice(-6);
  } else {
    const ownLastIndex = findLastNpcMessageIndex(visibleMessages, npc?.name);
    const startIndex = ownLastIndex >= 0 ? Math.max(ownLastIndex, visibleMessages.length - 8) : Math.max(0, visibleMessages.length - 8);
    scopedMessages = visibleMessages.slice(startIndex);
  }

  return scopedMessages.map((message) => {
    if (message.uiType === "narration") {
      return { role: "system", content: "[旁白] " + message.content };
    }
    if (message.role === "assistant") {
      return { role: "assistant", content: (message.speaker || "") + ": " + message.content };
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
  return tag + " " + message.speaker + ": " + message.content;
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
  pushCandidate(base.replace(/^\uFEFF/, "").replace(/[\u200B-\u200D\u2060]/g, ""));
  pushCandidate(base.replace(/[“”]/g, "\"").replace(/[‘’]/g, "'"));
  pushCandidate(
    base
      .replace(/^\uFEFF/, "")
      .replace(/[\u200B-\u200D\u2060]/g, "")
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

  // 过滤 npcInstructions，只保留针对已知 NPC 的指令
  const filteredInstructions = {};
  if (npcInstructions && typeof npcInstructions === "object" && !Array.isArray(npcInstructions)) {
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


function findLatestAssistantMessage(session, speaker) {
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const item = session.messages[i];
    if (item.role === "assistant" && item.speaker === speaker && (item.pending || item.streaming || !item.content)) {
      return item;
    }
  }
  return null;
}

function resolveModelConfig(configId, model, fallbackConfigId = "") {
  const configs = state.settings.configs || [];
  const directMatch = configs.find((config) => config.id === configId && config.host && config.key);
  if (directMatch) {
    return directMatch;
  }

  const byModel = configs.find((config) =>
    config.host && config.key && Array.isArray(config.workModels) && config.workModels.includes(model)
  );
  if (byModel) {
    return byModel;
  }

  const fallback = configs.find((config) => config.id === fallbackConfigId && config.host && config.key);
  if (fallback) {
    return fallback;
  }

  throw new Error(`未找到模型 ${model} 对应的接口配置`);
}

async function streamChatCompletion(session, speaker, model, messages, configId = "") {
  const targetMessage = findLatestAssistantMessage(session, speaker);
  if (!targetMessage) {
    throw new Error(`未找到 ${speaker} 的输出占位`);
  }

  const targetConfig = resolveModelConfig(configId, model, session.configId);

  targetMessage.pending = false;
  targetMessage.streaming = true;
  renderMessages({ stickToBottom: true });

  const shouldTrackUsage = state.settings?.session?.showTokenDisplay !== false;

  const buildStreamBody = (withUsage, withTemp = true) => {
    const body = {
      model,
      messages,
      stream: true,
    };
    if (withTemp) {
      body.temperature = 0.5;
    }
    if (withUsage) {
      body.stream_options = { include_usage: true };
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
  });

  let response = shouldTrackUsage ? await doStreamFetch(true) : await doStreamFetch(false);
  let errorDetail = "";

  if (!response.ok) {
    errorDetail = await safeReadError(response);
    const isUsageError = shouldTrackUsage && /stream_options|include_usage/i.test(errorDetail);
    const isTempError = /temperature|unsupported param/i.test(errorDetail);

    if (isUsageError && isTempError) {
      console.warn("[MOYU] stream_options and temperature rejected, retrying without both", { model, detail: errorDetail });
      response = await doStreamFetch(false, false);
      errorDetail = "";
    } else if (isUsageError) {
      console.warn("[MOYU] stream_options rejected, retrying without it", { model, detail: errorDetail });
      response = await doStreamFetch(false);
      errorDetail = "";
    } else if (isTempError) {
      console.warn("[MOYU] temperature not supported, retrying without it", { model, detail: errorDetail });
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
          if (delta) {
            targetMessage.content += delta;
            renderMessages({ stickToBottom: true });
          }
        } catch {
          // Ignore incompatible keepalive chunks.
        }
      }
    }
  }

  if (!targetMessage.content.trim()) {
    targetMessage.streaming = false;
    targetMessage.pending = true;
    touchSession(session);
    persistSessions();
    renderMessages({ stickToBottom: true });
    debugLog("npc", `${speaker} 首次调用返回空，正在重试...`, { sessionId: session.id });
    await wait(300);

    const retryResponse = await doStreamFetch(shouldTrackUsage);

    if (retryResponse.ok && retryResponse.body) {
      targetMessage.pending = false;
      targetMessage.streaming = true;
      renderMessages({ stickToBottom: true });
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
              if (delta) {
                targetMessage.content += delta;
                renderMessages({ stickToBottom: true });
              }
            } catch {}
          }
        }
      }
    }

    if (!targetMessage.content.trim()) {
      targetMessage.content = "本次没有返回可显示内容";
    }
  }

  if (speaker !== "导演 AI") {
    targetMessage.content = sanitizeNpcReplyStrict(session, speaker, targetMessage.content);
  }

  const estimatedInput = Number(targetMessage.estimatedUsage?.input || 0) || 0;
  const estimatedOutput = estimateTokens(targetMessage.content);
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

function sanitizeNpcReply(session, speaker, content) {
  let cleaned = String(content || "").trim();
  if (!cleaned) {
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

async function createChatCompletion(host, key, model, messages, stream = false, temperature = 0.7) {
  const payload = await createChatCompletionPayload(host, key, model, messages, stream, temperature);
  return payload.content;
}

async function createChatCompletionPayload(host, key, model, messages, stream = false, temperature = 0.7) {
  const doPayloadFetch = (withTemp) => fetch(`${host}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      ...(withTemp ? { temperature, stream } : { stream }),
    }),
  });

  let response = await doPayloadFetch(true);
  let detail = "";

  if (!response.ok) {
    detail = await safeReadError(response);
    if (/temperature|unsupported param|not support/i.test(detail)) {
      console.warn("[MOYU] temperature not supported, retrying without it", { model, detail });
      response = await doPayloadFetch(false);
      detail = "";
    }
  }

  if (!response.ok) {
    if (!detail) {
      detail = await safeReadError(response);
    }
    console.error("[MOYU] Create chat completion failed", {
      model,
      status: response.status,
      detail,
      host,
      stream,
    });
    throw new Error(`模型 ${model} 调用失败：HTTP ${response.status}${detail ? ` ${detail}` : ""}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error(`模型 ${model} 没有返回有效内容`);
  }
  return {
    content,
    usage: data?.usage || null,
  };
}

async function readChatCompletionResponse(response, model) {
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error(`模型 ${model} 没有返回有效内容`);
  }
  return {
    content,
    usage: data?.usage || null,
  };
}

async function readChatCompletionPayload(response, model) {
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error(`模型 ${model} 没有返回有效内容`);
  }
  return {
    content,
    usage: data?.usage || null,
  };
}

async function streamLocalText(message, content) {
  const text = message?.uiType === "narration" ? sanitizeNarrationText(content) : content.trim();
  if (!text) {
    message.streaming = false;
    message.content = "";
    renderMessages({ stickToBottom: true });
    return;
  }

  const step = Math.max(2, Math.min(12, Math.floor(text.length / 24) || 2));
  for (let index = 0; index < text.length; index += step) {
    message.content = text.slice(0, index + step);
    renderMessages({ stickToBottom: true });
    await wait(28);
  }
  message.content = text;
  message.streaming = false;
  renderMessages({ stickToBottom: true });
}

function updateSuggestBtn() {
  const session = getCurrentSession();
  const isIdle = session && !state.isSending && !state.editingUserMessageId;
  const lastMsg = isIdle && session.messages.length ? session.messages[session.messages.length - 1] : null;
  const aiReplied = lastMsg && lastMsg.role !== "user";
  const hasAssistant = Boolean(state.settings?.assistant?.model) && state.settings.configs.length > 0;

  els.suggestBtn.disabled = !(isIdle && aiReplied && hasAssistant);
}

function clearSuggestions() {
  const list = els.suggestionBar?.querySelector(".suggestion-list");
  if (list) list.innerHTML = "";
  els.suggestionBar?.classList.add("hidden");
  if (els.chatMessages) els.chatMessages.style.paddingBottom = "";
}

function getSuggestionContextMessages(session) {
  const recentLimit = 4;
  const messages = [];

  const recentMessages = session.messages.slice(-(recentLimit + 1)).filter((m) => m.role !== "system" && m.content);
  messages.push(...recentMessages.map((m) => ({ role: m.role || "user", content: String(m.content || "") })));

  return messages;
}

async function generateSuggestions() {
  const session = getCurrentSession();
  if (!session || state.isSending) return;

  const assistantKey = state.settings?.assistant?.model;
  if (!assistantKey) {
    setText(els.chatStatus, "请先在设置-辅助 AI 中配置辅助模型");
    return;
  }

  const parts = assistantKey.split(":::");
  const configId = parts[0];
  const modelName = parts.slice(1).join(":::");

  let config;
  try {
    config = resolveModelConfig(configId, modelName);
  } catch {
    setText(els.chatStatus, "未找到辅助模型对应的接口配置");
    return;
  }

  els.suggestBtn.classList.add("generating");
  els.suggestBtn.disabled = true;
  setText(els.chatStatus, "正在生成推荐回复...");

  const contextMessages = getSuggestionContextMessages(session);
  const requestMessages = [...contextMessages, {
    role: "user",
    content: "忽略你之前的任何角色设定。现在你是我的回复建议助手。根据以上对话历史，以我（用户）的口吻和视角推荐3条我接下来可以发送的自然回复。必须只输出JSON数组，例如：[\"回复1\", \"回复2\", \"回复3\"]，不要任何其他文字。",
  }];

  try {
    const content = await createChatCompletion(config.host, config.key, modelName, requestMessages, false, 0.8);
    const normalized = content.replace(/“|”|„|‟/g, '"');
    let suggestions;
    try {
      suggestions = JSON.parse(normalized);
    } catch {
      const cleaned = normalized
        .replace(/^[\s\S]*?```(?:json)?\s*\[/, "[")
        .replace(/\][\s\S]*?```[\s\S]*$/, "]")
        .replace(/```[\s\S]*?$/g, "")
        .trim();
      let arrayStr = cleaned;
      if (!cleaned.startsWith("[")) {
        const match = cleaned.match(/\[[\s\S]*?\]/);
        arrayStr = match ? match[0] : cleaned;
      }
      try {
        suggestions = JSON.parse(arrayStr);
      } catch {
        suggestions = null;
      }
    }

    if (!Array.isArray(suggestions) || !suggestions.length) {
      console.warn("[Suggest] 原始响应:", content);
      throw new Error("invalid");
    }

    const valid = suggestions.filter((s) => typeof s === "string" && s.trim()).slice(0, 4);
    if (!valid.length) throw new Error("invalid");

    const list = els.suggestionBar.querySelector(".suggestion-list");
    if (!list) throw new Error("missing suggestion-list");
    list.innerHTML = "";
    valid.forEach((text) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "suggestion-chip";
      chip.textContent = text.trim();
      chip.addEventListener("click", () => {
        clearSuggestions();
        els.chatInput.value = text.trim();
        sendUserMessage();
      });
      list.appendChild(chip);
    });
    els.suggestionBar.classList.remove("hidden");
    els.chatMessages.style.paddingBottom = "200px";
    smoothScrollTo(els.chatMessages, els.chatMessages.scrollHeight);
    setText(els.chatStatus, "选择一个推荐回复，或自行输入");
  } catch (err) {
    const msg = err.message === "invalid"
      ? "推荐回复生成失败，请重试"
      : `推荐回复生成失败：${err.message || "未知错误"}`;
    setText(els.chatStatus, msg);
    showToast(msg, "error");
    console.error("[Suggest]", err);
  } finally {
    els.suggestBtn.classList.remove("generating");
    updateSuggestBtn();
  }
}

async function generateSuggestionGuide(session) {
  if (!session?.globalPrompt) return;

  const assistantKey = state.settings?.assistant?.model;
  let config, modelName;

  if (assistantKey) {
    const parts = assistantKey.split(":::");
    try {
      config = resolveModelConfig(parts[0], parts.slice(1).join(":::"));
      modelName = parts.slice(1).join(":::");
    } catch {}
  }

  if (!config) {
    try {
      config = resolveModelConfig(session.directorConfigId, session.directorModel, session.configId);
      modelName = session.directorModel;
    } catch {
      return;
    }
  }

  const guidePrompt = {
    role: "system",
    content: "将以下全局设定压缩成一段100字以内的简短指引，用于AI在对话中为用户推荐回复时参考。\n\n保留：题材风格、语言特点、核心氛围。\n删除：具体世界观细节、角色关系、剧情线索、历史事件。\n\n直接输出压缩后的指引文本，不要任何前缀或解释。",
  };
  const userMsg = { role: "user", content: session.globalPrompt };

  try {
    const guide = await createChatCompletion(config.host, config.key, modelName, [guidePrompt, userMsg], false, 0.3);
    const trimmed = guide?.trim();
    if (trimmed && trimmed.length < session.globalPrompt.length) {
      session.suggestionGuide = trimmed;
      persistSessions();
    }
  } catch {}
}
