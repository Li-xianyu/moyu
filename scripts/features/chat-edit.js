"use strict";

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
  restoreComposerContent(target.content);
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
  clearPendingAttachments();
  if (!state.isSending) {
    els.chatInput.value = "";
    autoResizeChatInput();
  }
  updateComposerMode();
  renderMessages();
}

function copyMessageContent(messageId, iconEl) {
  const session = getCurrentSession();
  if (!session) {
    return;
  }
  const message = session.messages.find((m) => m.id === messageId);
  if (!message || !message.content) {
    return;
  }

  const showCopied = () => {
    setText(els.chatStatus, t("chat.copied"));
    if (iconEl) {
      iconEl.setAttribute("data-lucide", "check");
      iconEl.classList.add("message-edit-icon-copied");
      lucide.createIcons();
      setTimeout(() => {
        iconEl.setAttribute("data-lucide", "copy");
        iconEl.classList.remove("message-edit-icon-copied");
        lucide.createIcons();
      }, 3000);
    }
  };

  const copyContent = message.role === "user"
    ? getUserContentText(message.content)
    : String(message.content || "");
  copyToClipboard(copyContent, showCopied);
}

function cloneLatestTurnVariantValue(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function cloneLatestTurnVariantMessage(message) {
  const cloned = cloneLatestTurnVariantValue(message, null);
  if (!cloned) return null;
  delete cloned.sequence;
  delete cloned.pending;
  delete cloned.streaming;
  delete cloned.retrieving;
  delete cloned._contextMessages;
  return cloned;
}

function getLatestUserMessageIndex(session) {
  for (let index = (session?.messages || []).length - 1; index >= 0; index -= 1) {
    if (session.messages[index]?.role === "user") return index;
  }
  return -1;
}

function getLatestTurnVariantState(session) {
  const variants = session?.latestTurnVariants;
  if (!variants || !variants.userMessageId || !Array.isArray(variants.variants) || !variants.variants.length) {
    return null;
  }
  variants.activeIndex = Math.max(0, Math.min(
    Number.isFinite(variants.activeIndex) ? variants.activeIndex : variants.variants.length - 1,
    variants.variants.length - 1
  ));
  return variants;
}

function setLatestTurnBaseState(session, userMessage) {
  if (!session || session.mode === SESSION_MODE_CHAOS || !userMessage?.id) {
    if (session) session.latestTurnBaseState = null;
    return;
  }
  session.latestTurnBaseState = {
    userMessageId: userMessage.id,
    transientNpcs: cloneLatestTurnVariantValue(session.transientNpcs || [], []),
  };
}

function createLatestTurnVariantSnapshot(session, userMessageId, existingVariant = null) {
  const userIndex = (session?.messages || []).findIndex((message) =>
    message?.id === userMessageId && message.role === "user"
  );
  if (userIndex === -1) return null;

  const turnMessages = session.messages.slice(userIndex + 1);
  if (turnMessages.some((message) => message?.role === "system" && String(message.content || "").trim())) {
    return null;
  }

  const messages = turnMessages
    .filter((message) =>
      message?.id &&
      message.role === "assistant" &&
      !message.pending &&
      !message.streaming &&
      String(message.content || "").trim()
    )
    .map(cloneLatestTurnVariantMessage)
    .filter(Boolean);
  if (!messages.length) return null;

  return {
    id: existingVariant?.id || createMessageId("turn-version"),
    createdAt: existingVariant?.createdAt || new Date().toISOString(),
    messages,
    transientNpcs: cloneLatestTurnVariantValue(session.transientNpcs || [], []),
  };
}

function getLatestTurnBaseTransientNpcs(session, userMessage) {
  const savedBase = session?.latestTurnBaseState;
  if (savedBase?.userMessageId === userMessage?.id && Array.isArray(savedBase.transientNpcs)) {
    return cloneLatestTurnVariantValue(savedBase.transientNpcs, []);
  }

  const branchPointAt = new Date(userMessage?.createdAt || 0).getTime();
  return cloneLatestTurnVariantValue((session.transientNpcs || []).filter((npc) => {
    const spawnedAt = new Date(npc?.spawnedAt || 0).getTime();
    return !Number.isFinite(branchPointAt) || !Number.isFinite(spawnedAt) || spawnedAt <= branchPointAt;
  }), []);
}

function canVersionLatestTurn(session, userMessage) {
  if (!session || session.mode === SESSION_MODE_CHAOS || !userMessage?.id) return false;
  const latestUserIndex = getLatestUserMessageIndex(session);
  if (latestUserIndex === -1 || session.messages[latestUserIndex] !== userMessage) return false;

  const branchSequence = getMessageSequenceInSession(session, userMessage);
  const compressedCutoff = typeof getCompressedCutoffSeq === "function"
    ? getCompressedCutoffSeq(session)
    : (Number.isFinite(session.compressedUntilSequence) ? session.compressedUntilSequence : -1);
  if (Number.isFinite(compressedCutoff) && compressedCutoff >= branchSequence) return false;

  return Boolean(createLatestTurnVariantSnapshot(session, userMessage.id));
}

async function saveLatestTurnVariantState(session) {
  persistSessions();
  if (window.__chatDB?.saveSession) {
    await window.__chatDB.saveSession(session);
  }
}

async function prepareLatestTurnRegeneration(session, userMessage) {
  if (!canVersionLatestTurn(session, userMessage)) return false;

  let versionState = getLatestTurnVariantState(session);
  if (!versionState || versionState.userMessageId !== userMessage.id) {
    const firstVariant = createLatestTurnVariantSnapshot(session, userMessage.id);
    if (!firstVariant) return false;
    versionState = {
      userMessageId: userMessage.id,
      activeIndex: 0,
      baseTransientNpcs: getLatestTurnBaseTransientNpcs(session, userMessage),
      variants: [firstVariant],
    };
  } else {
    const current = versionState.variants[versionState.activeIndex];
    const refreshed = createLatestTurnVariantSnapshot(session, userMessage.id, current);
    if (refreshed) versionState.variants[versionState.activeIndex] = refreshed;
  }

  session.latestTurnVariants = versionState;
  await saveLatestTurnVariantState(session);
  return true;
}

function finalizeLatestTurnVariants(session) {
  if (!session?.latestTurnVariants) return false;
  session.latestTurnVariants = null;
  return true;
}

function resetSessionDerivedMemoryAfterBranch(session) {
  if (!session) return;
  session.chatSummary = "";
  session.directorSummary = "";
  session.compressedUntilMessageId = "";
  session.compressedUntilSequence = -1;
  session.compressionSegments = [];
  session.directorMemory = {
    scene: "",
    relationships: [],
    facts: [],
    tensions: [],
    openLoops: [],
    npcState: [],
    synopsis: "",
  };
  session.chaosSummary = "";
  session.chaosSummaryUntilSeq = -1;
}

async function replaceLatestTurnWithVariant(session, targetIndex, options = {}) {
  const versionState = getLatestTurnVariantState(session);
  if (!versionState || (!options.force && state.isSending)) return false;
  if (targetIndex < 0 || targetIndex >= versionState.variants.length) return false;

  const userIndex = session.messages.findIndex((message) =>
    message?.id === versionState.userMessageId && message.role === "user"
  );
  if (userIndex === -1) {
    finalizeLatestTurnVariants(session);
    await saveLatestTurnVariantState(session);
    return false;
  }

  if (!options.skipCapture) {
    const currentVariant = versionState.variants[versionState.activeIndex];
    const refreshed = createLatestTurnVariantSnapshot(session, versionState.userMessageId, currentVariant);
    if (refreshed) versionState.variants[versionState.activeIndex] = refreshed;
  }

  const removedMessages = session.messages.slice(userIndex + 1);
  if (window.__chatDB) {
    await Promise.all(removedMessages
      .filter((message) => message?.id)
      .map((message) => window.__chatDB.deleteMessage(message.id)));
  }

  const selected = versionState.variants[targetIndex];
  const selectedMessages = (selected.messages || [])
    .map(cloneLatestTurnVariantMessage)
    .filter(Boolean);
  session.messages = session.messages.slice(0, userIndex + 1).concat(selectedMessages);
  session.transientNpcs = cloneLatestTurnVariantValue(selected.transientNpcs || [], []);
  versionState.activeIndex = targetIndex;
  session.latestTurnVariants = versionState;
  session.historicalScopeNames = [];
  session.totalTokenEstimate = null;
  session.totalTokenEstimateMessageCount = null;

  const baseSequence = getMessageSequenceInSession(session, session.messages[userIndex]) + 1;
  selectedMessages.forEach((message, index) => {
    message.sequence = baseSequence + index;
  });
  session.messageCount = getLoadedMessageBaseSequence(session) + getLoadedNonSystemMessages(session).length;

  if (window.__chatDB) {
    for (let index = 0; index < selectedMessages.length; index += 1) {
      await window.__chatDB.saveMessage(session.id, selectedMessages[index], baseSequence + index);
    }
  }
  await saveLatestTurnVariantState(session);

  if (typeof window.__cancelAutoTtsTurn === "function") {
    window.__cancelAutoTtsTurn();
  }
  state.openAgentTokenInfoId = null;
  renderMessages({ stickToBottom: true });
  renderChatListMenu();
  return true;
}

async function switchLatestTurnVariant(targetIndex) {
  const session = getCurrentSession();
  if (!session || state.isSwitchingTurnVariant) return;
  state.isSwitchingTurnVariant = true;
  try {
    await replaceLatestTurnWithVariant(session, targetIndex);
  } catch (error) {
    console.error("[chat] switch turn version failed", error);
    setText(els.chatStatus, "切换回复版本失败，请稍后重试");
  } finally {
    state.isSwitchingTurnVariant = false;
  }
}

async function finishLatestTurnRegeneration(session, userMessageId) {
  const versionState = getLatestTurnVariantState(session);
  if (!versionState || versionState.userMessageId !== userMessageId) return;

  const nextVariant = createLatestTurnVariantSnapshot(session, userMessageId);
  if (!nextVariant) {
    await replaceLatestTurnWithVariant(session, versionState.activeIndex, {
      force: true,
      skipCapture: true,
    });
    if (versionState.variants.length <= 1) {
      finalizeLatestTurnVariants(session);
      await saveLatestTurnVariantState(session);
      renderMessages({ stickToBottom: true });
    }
    return;
  }

  versionState.variants.push(nextVariant);
  versionState.activeIndex = versionState.variants.length - 1;
  session.latestTurnVariants = versionState;
  await saveLatestTurnVariantState(session);
  renderMessages({ stickToBottom: true });
}

function getRegenerationInstruction(mode) {
  if (mode === "concise") {
    return [
      "重新生成这一整轮回复。",
      "相比普通回答明显更加简洁，减少铺垫、重复解释和非必要细节，但必须保留关键结论、必要依据与角色语气。",
      "如果由导演调度多个角色，旁白和所有角色回复都要共同遵守精简要求。",
      "不要提及正在重试、改写或遵循这条指令。",
    ].join("\n");
  }
  if (mode === "detailed") {
    return [
      "重新生成这一整轮回复。",
      "相比普通回答更加详细，补充必要的推理过程、步骤、背景、例子或场景细节，但避免无意义重复。",
      "如果由导演调度多个角色，旁白和所有角色回复都要共同提供更充分的信息。",
      "不要提及正在重试、改写或遵循这条指令。",
    ].join("\n");
  }
  return [
    "重新生成这一整轮回复，给出一个自然、完整且与上一版不同的新版本。",
    "保持原始用户意图、会话设定和角色一致性。",
    "不要提及正在重试、改写或遵循这条指令。",
  ].join("\n");
}

async function regenerateFromUserMessage(messageId, options = {}) {
  const session = getCurrentSession();
  if (!session || state.isSending || state.isSwitchingTurnVariant) {
    return;
  }

  const target = session.messages.find((message) => message.id === messageId && message.role === "user");
  if (!target) {
    return;
  }

  const baseTransientNpcs = getLatestTurnBaseTransientNpcs(session, target);
  finalizeLatestTurnVariants(session);

  if (typeof window.__prepareAutoTtsTurn === "function") {
    window.__prepareAutoTtsTurn();
  }

  state.isSending = true;
  setInlineChatStatus(t("chat.statusProcessing"));
  if (els.thinkingPopover && !els.thinkingPopover.classList.contains("hidden")) {
    els.thinkingPopover.classList.add("hidden");
    els.thinkingPopover.classList.remove("visible");
    els.thinkingToggleBtn?.classList.remove("active");
  }
  els.sendBtn.disabled = true;
  els.chatInput.disabled = true;
  updateComposerMode();
  clearUserMessageEdit();
  try {
    await applyUserMessageEdit(session, messageId, target.content || "", {
      touchTarget: false,
      baseTransientNpcs,
    });
  } catch (error) {
    state.isSending = false;
    state.abortController = null;
    clearInlineChatStatus();
    els.sendBtn.disabled = false;
    els.chatInput.disabled = false;
    finishUserTopAnchor();
    updateComposerMode();
    setText(els.chatStatus, "重新生成失败：无法清理旧回复");
    console.error("[chat] regenerate cleanup failed", error);
    return;
  }
  setLatestTurnBaseState(session, target);
  debugLog("turn", t("debug.msg.regenerate"), {
    sessionId: session.id,
    messageId,
    content: target.content || "",
  });
  touchSession(session);
  persistSessions();
  renderMessages();
  renderChatListMenu();
  pinLastUserMessageToTop();
  state.abortController = new AbortController();
  session.regenerationInstruction = getRegenerationInstruction(options.mode || "retry");
  try {
    await runSessionTurn(session);
  } finally {
    session.regenerationInstruction = "";
  }
}

async function regenerateFromAssistantMessage(messageId, mode = "retry") {
  const session = getCurrentSession();
  if (!session || state.isSending || state.isSwitchingTurnVariant) {
    return;
  }

  const targetIndex = session.messages.findIndex((message) =>
    message.id === messageId && message.role === "assistant"
  );
  if (targetIndex === -1) {
    return;
  }
  if (typeof canRegenerateAssistantMessage === "function" &&
      !canRegenerateAssistantMessage(session.messages[targetIndex])) {
    return;
  }

  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    const message = session.messages[index];
    if (message?.role === "user" && message.id) {
      await regenerateFromUserMessage(message.id, { mode });
      return;
    }
  }
}

async function applyUserMessageEdit(session, messageId, content, options = {}) {
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
  const branchPointAt = new Date(target.createdAt || 0).getTime();
  const removedMsgs = session.messages.slice(targetIndex + 1);
  if (window.__chatDB) {
    const targetSequence = getMessageSequenceInSession(session, target);
    if (window.__chatDB.deleteSessionMessagesAfter && Number.isFinite(targetSequence)) {
      await window.__chatDB.deleteSessionMessagesAfter(session.id, targetSequence);
    } else if (removedMsgs.length) {
      await Promise.all(removedMsgs
        .filter((message) => message?.id)
        .map((message) => window.__chatDB.deleteMessage(message.id)));
    }
  }

  if (options.touchTarget !== false) {
    target.content = content;
    target.createdAt = new Date().toISOString();
  }

  session.messages = session.messages.slice(0, targetIndex + 1);
  resetSessionDerivedMemoryAfterBranch(session);
  session.transientNpcs = Array.isArray(options.baseTransientNpcs)
    ? cloneLatestTurnVariantValue(options.baseTransientNpcs, [])
    : (session.transientNpcs || []).filter((npc) => {
        const spawnedAt = new Date(npc?.spawnedAt || 0).getTime();
        return !Number.isFinite(branchPointAt) || !Number.isFinite(spawnedAt) || spawnedAt <= branchPointAt;
      });
  if (options.preserveLatestTurnVariants !== true) {
    finalizeLatestTurnVariants(session);
  }
  session.historicalScopeNames = [];
  session.totalTokenEstimate = null;
  session.totalTokenEstimateMessageCount = null;
  const nextCount = getLoadedMessageBaseSequence(session) + getLoadedNonSystemMessages(session).length;
  session.messageCount = Math.max(0, nextCount);
}
