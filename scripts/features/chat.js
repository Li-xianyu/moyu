function autoResizeChatInput() {
  const el = els.chatInput;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
  recalcUserTopAnchorSpacer();
}

function getChatScrollElement() {
  return els.chatMessages?.closest(".main") || els.chatMessages;
}

function getLastUserMessageBlock() {
  const userBlocks = els.chatMessages?.querySelectorAll(".message-block.user");
  return userBlocks?.[userBlocks.length - 1] || null;
}

function getComposerShellHeight() {
  const composerShell = els.chatInput?.closest(".composer-shell");
  return composerShell ? composerShell.getBoundingClientRect().height : 0;
}

function getTopFloatingChromeHeight() {
  const floatingButtons = [...document.querySelectorAll(".info-btn.floating")];
  if (!floatingButtons.length) return 0;
  return floatingButtons.reduce((maxBottom, button) => {
    const rect = button.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return maxBottom;
    return Math.max(maxBottom, rect.bottom);
  }, 0);
}

function clearUserTopAnchorSpacer() {
  els.chatMessages?.classList.remove("hide-before");
  els.chatMessages?.querySelector(".scroll-spacer")?.remove();
}

function collapseUserTopAnchorSpacer() {
  const spacer = els.chatMessages?.querySelector(".scroll-spacer");
  const shouldFollow = state.userTopAnchorAutoFollow;
  els.chatMessages?.classList.remove("hide-before");
  if (!spacer) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    spacer.remove();
    return;
  }
  const currentHeight = spacer.getBoundingClientRect().height;
  spacer.style.height = `${currentHeight}px`;
  spacer.style.transition = "height 520ms ease";
  requestAnimationFrame(() => {
    spacer.style.height = "0px";
    if (shouldFollow) scrollChatToBottom();
  });
  spacer.addEventListener("transitionend", () => spacer.remove(), { once: true });
  window.setTimeout(() => spacer.remove(), 700);
}

function scrollChatToBottom() {
  const scrollEl = getChatScrollElement();
  if (scrollEl) {
    scrollEl.scrollTop = scrollEl.scrollHeight - scrollEl.clientHeight;
  }
}

const CHAT_BOTTOM_FOCUS_THRESHOLD_PX = 160;
let shouldKeepBottomOnKeyboard = false;

function getChatBottomDistance() {
  const scrollEl = getChatScrollElement();
  if (!scrollEl) return Infinity;
  return scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
}

function isChatNearBottom(threshold = CHAT_BOTTOM_FOCUS_THRESHOLD_PX) {
  return getChatBottomDistance() <= threshold;
}

function settleChatBottomAfterViewportShift() {
  scrollChatToBottom();
  requestAnimationFrame(scrollChatToBottom);
  window.setTimeout(scrollChatToBottom, 80);
  window.setTimeout(scrollChatToBottom, 220);
}

function getMessageGapPx() {
  const styles = window.getComputedStyle(els.chatMessages);
  return parseFloat(styles.rowGap || styles.gap || "0") || 0;
}

function calculateContentBelowUserHeight(userBlock) {
  const userBottom = userBlock.offsetTop + userBlock.offsetHeight;
  let lastBottom = userBottom;
  for (let node = userBlock.nextElementSibling; node; node = node.nextElementSibling) {
    if (node.classList?.contains("scroll-spacer")) continue;
    lastBottom = Math.max(lastBottom, node.offsetTop + node.offsetHeight);
  }
  return Math.max(0, lastBottom - userBottom);
}

function recalcUserTopAnchorSpacer(userBlock = getLastUserMessageBlock()) {
  if (!state.userTopAnchorActive || !state.isSending || !els.chatMessages || !userBlock?.isConnected) {
    if (!state.isSending) clearUserTopAnchorSpacer();
    return;
  }

  const scrollEl = getChatScrollElement();
  if (!scrollEl) return;

  const existingSpacer = els.chatMessages.querySelector(".scroll-spacer");
  if (existingSpacer) existingSpacer.remove();

  els.chatMessages.classList.add("hide-before");

  const gap = getMessageGapPx();
  const contentBelowUserHeight = calculateContentBelowUserHeight(userBlock);
  const spacerGap = gap;
  const visualSafetyPx = 8;
  const visibleMessageHeight = Math.max(0, scrollEl.clientHeight - getComposerShellHeight() - getTopFloatingChromeHeight() - visualSafetyPx);
  const spareSpace = visibleMessageHeight - userBlock.offsetHeight - contentBelowUserHeight - spacerGap;
  const spacerHeight = Math.max(0, Math.floor(spareSpace));

  const spacer = document.createElement("div");
  spacer.className = "scroll-spacer";
  spacer.style.cssText = `flex:0 0 auto;pointer-events:none;height:${spacerHeight}px;`;
  els.chatMessages.appendChild(spacer);
  if (state.userTopAnchorAutoFollow) {
    scrollChatToBottom();
  }
}

function pinLastUserMessageToTop() {
  const lastUser = getLastUserMessageBlock();
  if (!lastUser) return;
  state.userTopAnchorActive = true;
  state.userTopAnchorAutoFollow = true;
  state.userScrolledAway = true;
  recalcUserTopAnchorSpacer(lastUser);
}

function finishUserTopAnchor() {
  const shouldFollow = state.userTopAnchorAutoFollow;
  state.userTopAnchorActive = false;
  state.userScrolledAway = false;
  collapseUserTopAnchorSpacer();
  state.userTopAnchorAutoFollow = false;
  if (shouldFollow) {
    requestAnimationFrame(scrollChatToBottom);
  }
}

const DIRECTOR_RECENT_HISTORY_LIMIT = 8;
const DIRECTOR_MANUAL_RECENT_HISTORY_LIMIT = 4;
const DIRECTOR_AUTO_COMPRESS_THRESHOLD_DEFAULT = 1800;
const DIRECTOR_AUTO_COMPRESS_MIN_UNSUMMARIZED = 6;
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

// ── 单 AI 模式（无导演）对话摘要压缩 ──
const CHAT_CONVERSATION_THRESHOLD = 3000;
const CHAT_SUMMARY_TARGET_MAX = 800;
const CHAT_AUTO_COMPRESS_THRESHOLD = 600;
const CHAT_COMPRESS_PROMPT = [
  "你是对话摘要器。",
  "请把给定对话历史压缩成一份细致、可靠、便于后续延续对话的摘要。",
  "目标不是一句话概括，而是保留足够多的可用细节：已讨论的话题、重要结论、待办事项、用户偏好、人物状态、明确约定、未解决问题、时间顺序。",
  "可以分成 2 到 5 个短段落，按主题或时间顺序组织，尽量保留关键信息密度。",
  "不要修辞，不要扩写到原文长度，不要模仿对白，不要引入没出现过的新事实。",
].join("\\n");

const CHAT_MANUAL_RECOMPRESS_RECENT_LIMIT = 30;
const CHAT_VIRTUAL_RECENT_RENDER_COUNT = 60;
const CHAT_VIRTUAL_BACKFILL_BATCH = 24;
const CHAT_VIRTUAL_TRIM_THRESHOLD = 156;
const CHAT_VIRTUAL_TOP_TRIGGER_DESKTOP_PX = 240;
const CHAT_VIRTUAL_TOP_TRIGGER_MOBILE_PX = 180;
const CHAT_DB_INITIAL_LOAD_COUNT = 96;
const CHAT_MONSTER_SESSION_MESSAGE_COUNT = 20000;
const CHAT_LARGE_SESSION_MESSAGE_COUNT = 5000;
const CHAT_MONSTER_RECENT_RENDER_COUNT = 18;
const CHAT_LARGE_RECENT_RENDER_COUNT = 24;
const CHAT_MONSTER_INITIAL_LOAD_COUNT = 24;
const CHAT_LARGE_INITIAL_LOAD_COUNT = 36;

function buildChatSummaryBlock(session) {
  const summary = session?.chatSummary;
  if (!summary) return "";
  return `[CHAT_SUMMARY]\n${summary}\n[/CHAT_SUMMARY]`;
}

function buildChatContextTokenMetrics(session) {
  if (!session) return null;
  const visibleMessages = getVisibleHistoryMessages(session);
  const cutoffIndex = session?.compressedUntilMessageId
    ? visibleMessages.findIndex((m) => m.id === session.compressedUntilMessageId)
    : -1;
  const activeMessages = session?.chatSummary && cutoffIndex >= 0
    ? visibleMessages.slice(cutoffIndex + 1)
    : visibleMessages;
  const summaryTokens = estimateTokens(session?.chatSummary || "");
  const totalTokens = estimateChatMessagesTokens(
    activeMessages.map((m) => ({ role: m.role || "user", content: m.content || "" }))
  ) + summaryTokens;
  return {
    contextCurrent: totalTokens,
    contextThreshold: CHAT_CONVERSATION_THRESHOLD,
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
    console.warn("[session] token estimate failed", error);
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

function getChatVirtualTopTriggerPx() {
  return window.matchMedia?.("(pointer: coarse)").matches
    ? CHAT_VIRTUAL_TOP_TRIGGER_MOBILE_PX
    : CHAT_VIRTUAL_TOP_TRIGGER_DESKTOP_PX;
}

function getSessionMessageCount(session) {
  if (session && Number.isFinite(session.messageCount) && session.messageCount >= 0) {
    return session.messageCount;
  }
  return Array.isArray(session?.messages)
    ? session.messages.filter((message) => message.role !== "system").length
    : 0;
}

function getLoadedMessageBaseSequence(session) {
  return Number.isFinite(session?.loadedStartSequence) && session.loadedStartSequence >= 0
    ? session.loadedStartSequence
    : 0;
}

function getLoadedNonSystemMessages(session) {
  return Array.isArray(session?.messages)
    ? session.messages.filter((message) => message && message.role !== "system")
    : [];
}

function getMessageSequenceInSession(session, message) {
  const loaded = getLoadedNonSystemMessages(session);
  const index = loaded.indexOf(message);
  if (index < 0) {
    return Math.max(0, getLoadedMessageBaseSequence(session) + loaded.length - 1);
  }
  return getLoadedMessageBaseSequence(session) + index;
}

function syncLoadedSessionMessageCount(session) {
  if (!session) return 0;
  const count = getLoadedMessageBaseSequence(session) + getLoadedNonSystemMessages(session).length;
  session.messageCount = Math.max(Number(session.messageCount) || 0, count);
  return session.messageCount;
}

function getChatRecentRenderCount(session) {
  const messageCount = getSessionMessageCount(session);
  if (messageCount >= CHAT_MONSTER_SESSION_MESSAGE_COUNT) {
    return CHAT_MONSTER_RECENT_RENDER_COUNT;
  }
  if (messageCount >= CHAT_LARGE_SESSION_MESSAGE_COUNT) {
    return CHAT_LARGE_RECENT_RENDER_COUNT;
  }
  return CHAT_VIRTUAL_RECENT_RENDER_COUNT;
}

function getChatInitialHydrateCount(session) {
  const messageCount = getSessionMessageCount(session);
  if (messageCount >= CHAT_MONSTER_SESSION_MESSAGE_COUNT) {
    return CHAT_MONSTER_INITIAL_LOAD_COUNT;
  }
  if (messageCount >= CHAT_LARGE_SESSION_MESSAGE_COUNT) {
    return CHAT_LARGE_INITIAL_LOAD_COUNT;
  }
  return CHAT_DB_INITIAL_LOAD_COUNT;
}

async function ensureSessionMessagesHydrated(session, options = {}) {
  if (!session || session.messagesHydrated || !window.__chatDB) {
    return session?.messages || [];
  }

  const total = Number.isFinite(session.messageCount)
    ? session.messageCount
    : await window.__chatDB.getMessageCount(session.id);
  session.messageCount = total;

  if (!total) {
    session.messages = [];
    session.loadedStartSequence = 0;
    session.messagesHydrated = true;
    return session.messages;
  }

  const desired = Math.max(1, options.limit || getChatInitialHydrateCount(session));
  const recent = await window.__chatDB.getRecentSessionMessages(session.id, Math.min(total, desired));
  session.messages = recent;
  session.loadedStartSequence = Math.max(0, total - recent.length);
  session.messagesHydrated = true;
  return recent;
}

async function loadOlderSessionMessages(session, batchSize = CHAT_VIRTUAL_BACKFILL_BATCH) {
  if (!session || !window.__chatDB) return [];
  await ensureSessionMessagesHydrated(session);

  const currentStart = Number.isFinite(session.loadedStartSequence) ? session.loadedStartSequence : 0;
  if (currentStart <= 0) {
    return [];
  }

  const nextStart = Math.max(0, currentStart - Math.max(1, batchSize));
  const limit = currentStart - nextStart;
  if (limit <= 0) {
    return [];
  }

  const older = await window.__chatDB.getSessionMessagesRange(session.id, nextStart, limit);
  if (!older.length) {
    session.loadedStartSequence = nextStart;
    return [];
  }

  session.messages = older.concat(session.messages || []);
  session.loadedStartSequence = nextStart;
  return older;
}

function bindChat() {
  els.sendBtn.addEventListener("click", function onSendClick() {
    if (state.isSending) {
      stopGeneration();
    } else {
      sendUserMessage();
    }
  });
  if (els.compressMemoryBtn) {
    ensureCompressMemoryPopover();
    els.compressMemoryBtn.addEventListener("click", (event) => {
      debugLog("compress", t("debug.msg.toolbarIconClick"), {
        disabled: Boolean(els.compressMemoryBtn?.disabled),
        openBefore: state.openCompressMemoryInfo,
      });
      event.stopPropagation();
      state.openCompressMemoryInfo = !state.openCompressMemoryInfo;
      renderCompressMemoryPopover();
      toggleCompressPopover();
    });
    els.compressMemoryBtn.addEventListener("pointerenter", () => {
      showCompressPopover();
    });
    els.compressMemoryBtn.addEventListener("pointerleave", () => {
      if (!state.openCompressMemoryInfo) {
        hideCompressPopover();
        const popover = els.compressMemoryBtn?.querySelector(".memory-compress-popover");
        if (popover) {
          popover.style.setProperty("--memory-compress-popover-shift-x", "0px");
          popover.style.setProperty("--memory-compress-popover-shift-y", "0px");
          popover.style.maxHeight = "";
        }
      }
    });
  }
  // Director thinking toggle (inside popover)
  if (els.directorThinkingBtn) {
    els.directorThinkingBtn.addEventListener("click", () => {
      state.directorThinking = !state.directorThinking;
      els.directorThinkingBtn.classList.toggle("active", state.directorThinking);
    });
  }
  // Model thinking toggle (inside popover)
  if (els.modelThinkingBtn) {
    els.modelThinkingBtn.addEventListener("click", () => {
      const current = els.modelThinkingBtn.dataset.state === "enabled" ? "disabled" : "enabled";
      els.modelThinkingBtn.dataset.state = current;
      state.settings.session = state.settings.session || {};
      state.settings.session.modelThinking = current;
      persistSettings();
      updateModelThinkingBtn();
    });
  }
  updateModelThinkingBtn();
  // Thinking settings toggle button (shows/hides popover)
  if (els.thinkingToggleBtn) {
    els.thinkingToggleBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      const session = getCurrentSession();
      if (isSingleModelWorkSession(session)) {
        const current = state.settings?.session?.modelThinking === "enabled" ? "disabled" : "enabled";
        state.settings.session = state.settings.session || {};
        state.settings.session.modelThinking = current;
        persistSettings();
        if (els.thinkingPopover) {
          els.thinkingPopover.classList.add("hidden");
          els.thinkingPopover.classList.remove("visible");
        }
        updateModelThinkingBtn();
        updateThinkingToggleMode();
        return;
      }
      const isOpen = els.thinkingPopover && !els.thinkingPopover.classList.contains("hidden");
      if (els.thinkingPopover) {
        els.thinkingPopover.classList.toggle("hidden", isOpen);
        els.thinkingPopover.classList.toggle("visible", !isOpen);
      }
      els.thinkingToggleBtn.classList.toggle("active", !isOpen);
    });
  }
  // Close thinking popover on click outside
  document.addEventListener("click", (event) => {
    if (els.thinkingPopover && !els.thinkingPopover.classList.contains("hidden")) {
      const target = event.target;
      if (target !== els.thinkingToggleBtn && !els.thinkingToggleBtn?.contains(target) &&
          target !== els.thinkingPopover && !els.thinkingPopover?.contains(target)) {
        els.thinkingPopover.classList.add("hidden");
        els.thinkingPopover.classList.remove("visible");
        els.thinkingToggleBtn?.classList.remove("active");
      }
    }
  });
  els.chatInput.addEventListener("keydown", (event) => {
    // @mention popup navigation takes priority
    if (mentionState) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const items = getMentionItems();
        if (items.length > 0) {
          const name = items[mentionState.selectedIndex]?.dataset?.name;
          if (name) insertMention(name);
        }
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        const items = getMentionItems();
        if (!items.length) return;
        mentionState.selectedIndex = mentionState.selectedIndex > 0
          ? mentionState.selectedIndex - 1
          : items.length - 1;
        updateMentionSelection(items);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const items = getMentionItems();
        if (!items.length) return;
        mentionState.selectedIndex = mentionState.selectedIndex < items.length - 1
          ? mentionState.selectedIndex + 1
          : 0;
        updateMentionSelection(items);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        hideMentionPopup();
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendUserMessage();
    }
  });
  els.chatInput.addEventListener("input", clearSuggestions);
  els.chatInput.addEventListener("input", handleMentionInput);
  els.chatInput.addEventListener("focus", () => {
    shouldKeepBottomOnKeyboard = isChatNearBottom();
    if (shouldKeepBottomOnKeyboard) {
      settleChatBottomAfterViewportShift();
    }
  });
  if (els.suggestBtn) {
    els.suggestBtn.addEventListener("click", generateSuggestions);
  }
  if (els.mobileNewlineBtn) {
    els.mobileNewlineBtn.addEventListener("click", insertChatInputNewline);
  }
  const suggestionClose = els.suggestionBar?.querySelector(".suggestion-close-btn");
  if (suggestionClose) {
    suggestionClose.addEventListener("click", clearSuggestions);
  }
  els.chatInput.addEventListener("input", autoResizeChatInput);
  els.chatMessages.addEventListener("click", (event) => {
    if (!event.target.closest(".message.user") && state.openUserMessageToolsId) {
      const block = els.chatMessages.querySelector(`[data-message-id="${state.openUserMessageToolsId}"]`);
      if (block) block.classList.remove("tools-open");
      state.openUserMessageToolsId = null;
    }
    if (!event.target.closest(".message.agent") && state.openAgentTokenInfoId) {
      const block = els.chatMessages.querySelector(`[data-message-id="${state.openAgentTokenInfoId}"]`);
      if (block) block.classList.remove("tools-open", "token-open");
      state.openAgentTokenInfoId = null;
    }
  });
  document.addEventListener("click", (event) => {
    if (!state.openCompressMemoryInfo) {
      return;
    }
    if (event.target.closest("#compressMemoryBtn") || event.target.closest(".memory-compress-popover")) {
      return;
    }
    debugLog("compress", t("debug.msg.popoverClosedOutside"));
    state.openCompressMemoryInfo = false;
    hideCompressPopover();
  });
  window.addEventListener("resize", () => {
    autoResizeChatInput();
    recalcUserTopAnchorSpacer();
    adjustCompressPopoverBoundary();
    if (document.activeElement === els.chatInput && shouldKeepBottomOnKeyboard) {
      settleChatBottomAfterViewportShift();
    }
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      adjustCompressPopoverBoundary();
      if (document.activeElement === els.chatInput && shouldKeepBottomOnKeyboard) {
        settleChatBottomAfterViewportShift();
      }
    });
  }
  autoResizeChatInput();

  // Close @mention popup on click outside
  document.addEventListener("pointerdown", (event) => {
    if (mentionState && !event.target.closest(".mention-popup") && event.target !== els.chatInput) {
      hideMentionPopup();
    }
  });

  // 滚动跟踪：检测用户是否主动离开底部
  const scrollEl = getChatScrollElement();
  if (scrollEl) {
    scrollEl.addEventListener("scroll", () => {
      if (state.userTopAnchorActive && state.isSending && els.chatMessages.querySelector(".scroll-spacer")) {
        if (getChatBottomDistance() > 180) {
          state.userTopAnchorAutoFollow = false;
        }
        state.userScrolledAway = true;
        return;
      }
      const distFromBottom = getChatBottomDistance();
      state.userScrolledAway = distFromBottom > 100;
      if (scrollEl.scrollTop <= getChatVirtualTopTriggerPx()) {
        maybeLoadOlderRenderedMessages();
      }
    }, { passive: true });
  }

  // 输入框占位符轮播提示
  startPlaceholderRotation();
}

function startPlaceholderRotation() {
  const SPEED_TYPING = 50;
  const SPEED_DELETING = 40;
  const DISPLAY_MS = 6000;

  function buildTips() {
    const session = getCurrentSession();
    const isStory = session?.mode === SESSION_MODE_STORY;
    const tips = [
      "输入你想说的话...",
      "点击输入框左上角 ✨ 生成推荐回复",
      "Shift+Enter 换行，Enter 发送",
      "支持 Markdown 格式和代码块高亮",
    ];
    if (!isStory) {
      tips.splice(1, 0, "在输入中键入 @ 可快速调用 Agent");
    }
    return tips;
  }

  let recentIndices = [];

  function pickTip(tips) {
    const available = tips
      .map((_, i) => i)
      .filter(i => !recentIndices.includes(i));
    if (available.length === 0) recentIndices = [];
    const pool = available.length > 0 ? available : tips.map((_, i) => i);
    const idx = pool[Math.floor(Math.random() * pool.length)];
    recentIndices.push(idx);
    if (recentIndices.length > 2) recentIndices.shift();
    return idx;
  }

  function startType() {
    const tips = buildTips();
    const idx = pickTip(tips);
    const text = tips[idx];
    typeText(text, 0);
  }

  function typeText(text, i) {
    if (i < text.length) {
      els.chatInput.placeholder = text.slice(0, i + 1) + "_";
      setTimeout(() => typeText(text, i + 1), SPEED_TYPING);
    } else {
      els.chatInput.placeholder = text;
      setTimeout(() => deleteText(text, text.length), DISPLAY_MS);
    }
  }

  function deleteText(text, i) {
    if (i > 0) {
      els.chatInput.placeholder = text.slice(0, i - 1) + "_";
      setTimeout(() => deleteText(text, i - 1), SPEED_DELETING);
    } else {
      startType();
    }
  }

  els.chatInput.placeholder = "_";
  setTimeout(startType, 400);
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

function insertChatInputNewline() {
  const input = els.chatInput;
  if (!input || input.disabled || state.isSending) return;

  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const nextValue = `${input.value.slice(0, start)}\n${input.value.slice(end)}`;
  input.value = nextValue;
  const nextCursor = start + 1;
  input.setSelectionRange(nextCursor, nextCursor);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  autoResizeChatInput();
  input.focus();
}


function updateComposerMode() {
  const composer = els.chatInput?.closest(".composer");
  const composerShell = els.chatInput?.closest(".composer-shell");
  const currentSession = getCurrentSession();

  // 输出中 → 暂停按钮优先于一切
  if (state.isSending) {
    els.sendBtn.innerHTML = '<i class="bi bi-stop-fill"></i>';
    els.sendBtn.disabled = false;
    els.sendBtn.classList.add("sending");
    els.chatInput.classList.remove("editing");
    if (els.mobileNewlineBtn) els.mobileNewlineBtn.disabled = true;
    if (composer) composer.classList.remove("editing");
    if (composerShell) composerShell.classList.remove("editing");
    if (els.cancelEditBtn) els.cancelEditBtn.classList.add("hidden");
    if (els.compressMemoryBtn) els.compressMemoryBtn.disabled = true;
    return;
  }

  if (state.editingUserMessageId) {
    els.sendBtn.innerHTML = '<i class="bi bi-check-lg"></i>';
    els.chatInput.classList.add("editing");
    if (els.mobileNewlineBtn) els.mobileNewlineBtn.disabled = false;
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

  els.sendBtn.classList.remove("sending");
  els.chatInput.classList.remove("editing");
  if (els.mobileNewlineBtn) {
    els.mobileNewlineBtn.disabled = !currentSession;
  }
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
  if (els.directorThinkingBtn) {
    els.directorThinkingBtn.disabled = state.isSending || !currentSession || !currentSession?.directorModel;
    if (!currentSession?.directorModel) {
      state.directorThinking = false;
      els.directorThinkingBtn.classList.remove("active");
    }
  }
  if (els.modelThinkingBtn) {
    els.modelThinkingBtn.disabled = state.isSending || !currentSession;
    const saved = state.settings?.session?.modelThinking || "disabled";
    els.modelThinkingBtn.dataset.state = saved;
    updateModelThinkingBtn();
  }
  updateThinkingToggleMode();
  renderCompressMemoryPopover();
  els.sendBtn.innerHTML = '<i class="bi bi-arrow-up"></i>';
  setText(els.chatStatus, state.isSending ? "正在处理中..." : "所有单位已就绪");
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
  if (els.thinkingPopover && !els.thinkingPopover.classList.contains("hidden")) {
    els.thinkingPopover.classList.add("hidden");
    els.thinkingPopover.classList.remove("visible");
    els.thinkingToggleBtn?.classList.remove("active");
  }
  els.sendBtn.disabled = true;
  els.chatInput.disabled = true;
  updateComposerMode();
  clearUserMessageEdit();
  applyUserMessageEdit(session, messageId, target.content || "");
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

  // 从 IDB 删除被截断的旧消息（AI 回复等），防止刷新后阴魂不散
  const removedMsgs = session.messages.slice(targetIndex + 1);
  if (removedMsgs.length && window.__chatDB) {
    removedMsgs.forEach(function (m) {
      if (m.id) window.__chatDB.deleteMessage(m.id).catch(function () {});
    });
  }

  session.messages = session.messages.slice(0, targetIndex + 1);
  session.transientNpcs = [];
  const nextCount = getLoadedMessageBaseSequence(session) + getLoadedNonSystemMessages(session).length;
  session.messageCount = Math.max(0, nextCount);
}

function buildBubbleContent(message) {
  const session = getCurrentSession();
  const sessionMode = session?.mode || SESSION_MODE_STORY;
  let html = "";
  const thinkingText = (message.thinking || "").trim();
  if (thinkingText) {
    html += `<details class="thinking-section"${message.streaming || message.thinkingExpanded ? " open" : ""}>`;
    html += `<summary><span class="thinking-label">思考过程</span></summary>`;
    html += `<div class="thinking-content">${escapeHtml(thinkingText).replace(/\n/g, "<br>")}</div>`;
    html += `</details>`;
  }
  const toolTraceHtml = buildToolTraceSection(message);
  if (toolTraceHtml) {
    html += toolTraceHtml;
  }
  if (message.retrieving) {
    return html;
  }
  if (shouldSuppressRetrievalMarkerContent(message)) {
    return html;
  }
  const enableMd = sessionMode === SESSION_MODE_WORK && state.settings?.session?.markdownRender !== false;
  if (enableMd) {
    html += renderMarkdownContent(escapeHtml(message.content));
  } else if (sessionMode === SESSION_MODE_STORY) {
    html += renderStoryContent(escapeHtml(message.content));
  } else {
    html += escapeHtml(message.content).replace(/\n/g, "<br>");
  }
  return html;
}

function shouldSuppressRetrievalMarkerContent(message) {
  const content = String(message?.content || "").trim();
  if (!content) return false;
  if (window.__chatRetrieval?.extractRangeRequest?.(content)) return true;
  if (window.__chatRetrieval?.extractSearchQuery?.(content)) return true;
  if (/^【(?:查|查看|查看区|查看区间)/.test(content)) return true;
  if (/^【(?:搜|搜索)/.test(content)) return true;
  return false;
}

function stripFakeRetrievalClaims(content, message) {
  if (!content) return content;
  const usedTool = Boolean(message?.searchEnhanced || (Array.isArray(message?.toolTrace) && message.toolTrace.length));
  if (usedTool) {
    return content;
  }
  return String(content)
    .replace(/^[ \t]*(?:（|\()(?:调用|使用|启动|正在调用|正在使用|快速检索|检索|搜索)[^）)\n]{0,80}(?:搜索工具|检索工具|历史记录|历史|工具)[^）)\n]{0,80}(?:）|\))\s*/gm, "")
    .replace(/^[ \t]*(?:\[|\【)(?:调用|使用|启动|快速检索|检索|搜索)[^\]\】\n]{0,80}(?:搜索工具|检索工具|历史记录|历史|工具)[^\]\】\n]{0,80}(?:\]|\】)\s*/gm, "")
    .trim();
}

function isScopePreferredSearchQuery(query) {
  const text = String(query || "").toLowerCase();
  if (!text) return false;
  return /谁说|谁讲|谁提|谁回复|哪(个|些).*(模型|agent|npc)|加入.*会话|哪些.*加入|谁加入|哪个.*加入|什么模型|哪些模型/.test(text);
}

function ensureToolTrace(message) {
  if (!message) return null;
  if (!Array.isArray(message.toolTrace)) {
    message.toolTrace = [];
  }
  return message.toolTrace;
}

function appendToolTraceStep(message, step) {
  if (!message || !step) return;
  const trace = ensureToolTrace(message);
  trace.push({
    id: step.id || `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: step.label || "工具调用",
    command: step.command || "",
    status: step.status || "info",
    detail: step.detail || "",
    tool: step.tool || "",
    createdAt: step.createdAt || new Date().toISOString(),
  });
}

function updateLastToolTraceStep(message, patch) {
  if (!message || !Array.isArray(message.toolTrace) || !message.toolTrace.length || !patch) return;
  const lastStep = message.toolTrace[message.toolTrace.length - 1];
  Object.assign(lastStep, patch);
}

window.__appendToolTraceStep = appendToolTraceStep;
window.__updateLastToolTraceStep = updateLastToolTraceStep;

function getToolTraceTitle(message) {
  const trace = Array.isArray(message?.toolTrace) ? message.toolTrace : [];
  if (!trace.length) return "";
  const firstCommand = String(trace[0]?.command || "").trim();
  const lastStep = trace[trace.length - 1] || {};
  const base = firstCommand || (lastStep.tool || "history");
  if (lastStep.status === "running") return `$ ${base} --running`;
  if (lastStep.status === "done") return `$ ${base} --done`;
  if (lastStep.status === "miss") return `$ ${base} --miss`;
  if (lastStep.status === "error") return `$ ${base} --error`;
  return `$ ${base}`;
}

function buildToolTraceSection(message) {
  const trace = Array.isArray(message?.toolTrace) ? message.toolTrace : [];
  if (!trace.length) return "";
  const title = getToolTraceTitle(message);
  const stepsHtml = trace.map((item, index) => {
    const commandText = item.command || item.label || item.tool || "trace";
    const headingHtml = index === 0
      ? `<div class="tool-trace-step-command">${escapeHtml(commandText)}</div>`
      : `<div class="tool-trace-step-output">${escapeHtml(item.label || "output")}</div>`;
    return [
      `<div class="tool-trace-step" data-status="${escapeHtml(item.status || "info")}">`,
      headingHtml,
      item.detail ? `<div class="tool-trace-step-detail">${escapeHtml(item.detail).replace(/\n/g, "<br>")}</div>` : "",
      `</div>`,
    ].join("");
  }).join("");
  return [
    `<details class="tool-trace-section"${message.streaming || message.toolTraceExpanded ? " open" : ""}>`,
    `<summary><span class="tool-trace-chip">${escapeHtml(title)}</span></summary>`,
    `<div class="tool-trace-content">${stepsHtml}</div>`,
    `</details>`,
  ].join("");
}

function wrapCodeLines(el) {
  if (state.settings?.session?.showLineNumbers !== true) return;
  var codes = el.tagName === 'CODE' ? [el] : el.querySelectorAll('pre code');
  Array.from(codes).forEach(function (code) {
    var raw = code.innerHTML;
    var lines = raw.split('\n');
    // debug: trailing lines
    if (lines.length > 0) {
      var tail = [];
      for (var di = Math.max(0, lines.length - 5); di < lines.length; di++) {
        tail.push(JSON.stringify(lines[di]));
      }
      console.log('[LN] total=' + lines.length + ' tail=' + tail.join(', '));
    }
    // 去掉末尾空白行（streaming 过程中内容末尾换行产生的伪影）
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }
    var lineCount = lines.length;
    if (lineCount > 1 || (lineCount === 1 && lines[0] !== '')) {
      // Split layout: fixed gutter + scrollable code
      var numHtml = '';
      var textHtml = '';
      for (var i = 0; i < lineCount; i++) {
        numHtml += '<span class="code-line-num">' + (i + 1) + '</span>';
        textHtml += lines[i] === ''
          ? '<div class="code-line-text code-line-empty"></div>'
          : '<div class="code-line-text">' + lines[i] + '</div>';
      }
      code.innerHTML =
        '<div class="code-body">' +
          '<div class="code-gutter">' + numHtml + '</div>' +
          '<div class="code-lines">' + textHtml + '</div>' +
        '</div>';

      // 行号列宽：位数 + 1ch 余量
      var gutterWidth = String(lineCount).length + 1;
      var block = code.closest('.pre-code-block');
      block.style.setProperty('--line-num-width', gutterWidth + 'ch');
    }
  });
}

function updateStreamingBubble(targetMessage) {
  const article = targetMessage.id ? els.chatMessages.querySelector(`[data-message-id="${targetMessage.id}"]`) : null;
  if (!article) {
    renderMessages({ stickToBottom: true });
    return;
  }

  const isNarration = targetMessage.uiType === "narration";
  const bubble = isNarration ? article.querySelector('.narration') : article.querySelector('.message');
  if (!bubble) {
    renderMessages({ stickToBottom: true });
    return;
  }

  if (isNarration) {
    const narrationText = sanitizeNarrationText(targetMessage.content);
    bubble.innerHTML = escapeHtml(narrationText).replace(/\n/g, "<br>");
    const isSingleLine = !targetMessage.pending && !/[\r\n]/.test(narrationText);
    bubble.classList.toggle('single-line', isSingleLine);
  } else {
    // Streaming incremental: inside an unclosed code block → update text
    // only, avoiding DOM destruction (fixes mobile scroll during streaming).
    if (targetMessage.streaming) {
      const c = targetMessage.content;
      var fenceRe = /^`{3,}/gm;
      var fenceMatches = c.match(fenceRe);
      if (fenceMatches && fenceMatches.length % 2 === 1) {
        var allCodes = bubble.querySelectorAll('.pre-code-block code');
        var existingCode = allCodes.length > 0 ? allCodes[allCodes.length - 1] : null;
        if (existingCode) {
          var lines = c.split('\n');
          var fenceCount = 0;
          var codeStartLine = -1;
          for (var j = 0; j < lines.length; j++) {
            if (/^`{3,}/.test(lines[j])) {
              fenceCount++;
              if (fenceCount === fenceMatches.length) {
                codeStartLine = j;
                break;
              }
            }
          }
          if (codeStartLine >= 0) {
            var rawCode = lines.slice(codeStartLine + 1).join('\n');
            var atBottom = existingCode.scrollHeight - existingCode.scrollTop - existingCode.clientHeight < 30;
            existingCode.textContent = rawCode;
            if (atBottom) {
              existingCode.scrollTop = existingCode.scrollHeight;
            }
            if (typeof hljs !== 'undefined') {
              delete existingCode.dataset.highlighted;
              hljs.highlightElement(existingCode);
              wrapCodeLines(existingCode);
            }
            return;
          }
        }
      }
    }
    // FLIP: capture old code block heights for smooth expansion
    const oldPreHeights = Array.from(bubble.querySelectorAll('.pre-code-block'), pre => pre.offsetHeight);
    // Save code element scroll positions for streaming continuity
    const oldCodeScrolls = Array.from(bubble.querySelectorAll('.pre-code-block code'), code => ({
      top: code.scrollTop,
      atBottom: code.scrollHeight - code.scrollTop - code.clientHeight < 30,
    }));

    bubble.innerHTML = buildBubbleContent(targetMessage);

    // Restore code element scroll positions synchronously after content replacement
    const newCodes = bubble.querySelectorAll('.pre-code-block code');
    newCodes.forEach((code, i) => {
      if (i < oldCodeScrolls.length) {
        code.scrollTop = oldCodeScrolls[i].atBottom ? code.scrollHeight : oldCodeScrolls[i].top;
      }
    });

    // Animate code block height transitions
    if (oldPreHeights.length) {
      requestAnimationFrame(() => {
        const newPres = bubble.querySelectorAll('.pre-code-block');
        newPres.forEach((pre, i) => {
          const oldH = i < oldPreHeights.length ? oldPreHeights[i] : 0;
          if (oldH > 0) {
            const newH = pre.scrollHeight;
            if (newH > oldH) {
              pre.style.height = oldH + 'px';
              pre.style.overflow = 'hidden';
              pre.style.transition = 'height 0.12s ease';
              requestAnimationFrame(() => {
                pre.style.height = newH + 'px';
                setTimeout(() => {
                  pre.style.height = '';
                  pre.style.overflow = '';
                  pre.style.transition = '';
                }, 150);
              });
            }
          }
        });
      });
    }

    const session = getCurrentSession();
    const sessionMode = session?.mode || SESSION_MODE_STORY;
    const enableMd = sessionMode === SESSION_MODE_WORK && state.settings?.session?.markdownRender !== false;
    if (typeof hljs !== 'undefined' && enableMd) {
      bubble.querySelectorAll('pre code').forEach(hljs.highlightElement);
      wrapCodeLines(bubble);
    }
    if (sessionMode === SESSION_MODE_WORK) {
      bubble.querySelectorAll('.code-copy-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          var pre = btn.closest('.pre-code-block');
          const code = pre ? pre.querySelector('code').textContent : '';
          navigator.clipboard.writeText(code).then(() => {
            btn.className = 'code-copy-btn copied';
            btn.innerHTML = '<i class="bi bi-check"></i>';
            setTimeout(() => {
              btn.className = 'code-copy-btn';
              btn.innerHTML = '<i class="bi bi-clipboard"></i>';
            }, 1500);
          }).catch(() => {});
        });
      });
    }
    const isSingleLine = !targetMessage.pending && !/[\r\n]/.test(targetMessage.content || "");
    bubble.classList.toggle('single-line', isSingleLine);
  }

  // streaming 过程中用户消息钉在视口顶部
  if (state.userTopAnchorActive && state.isSending) {
    recalcUserTopAnchorSpacer();
  }
}

function createStreamBatchController(targetMessage, revealFn, updateFn) {
  const CHAR_THRESHOLD = 10;
  const THINKING_THRESHOLD = 6;
  const TIME_THRESHOLD_MS = 24;
  let pendingContent = "";
  let pendingThinking = "";
  let timer = null;
  let startedAt = Date.now();

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function flush() {
    clearTimer();
    if (!pendingContent && !pendingThinking) return false;
    const contentChunk = pendingContent;
    const thinkingChunk = pendingThinking;
    pendingContent = "";
    pendingThinking = "";
    if (thinkingChunk) {
      targetMessage.thinking += thinkingChunk;
    }
    if (contentChunk) {
      targetMessage.content += contentChunk;
    }
    updateFn();
    return true;
  }

  function schedule() {
    if (!timer) {
      timer = setTimeout(flush, TIME_THRESHOLD_MS);
    }
  }

  return {
    queue(delta, thinkingDelta, isRevealed) {
      if (!isRevealed) {
        return false;
      }
      if (delta) pendingContent += delta;
      if (thinkingDelta) pendingThinking += thinkingDelta;
      const elapsed = Date.now() - startedAt;
      if (
        pendingContent.length >= CHAR_THRESHOLD ||
        pendingThinking.length >= THINKING_THRESHOLD ||
        (pendingThinking && elapsed >= 120)
      ) {
        flush();
        return true;
      }
      schedule();
      return false;
    },
    revealWithInitial(content, thinking) {
      clearTimer();
      pendingContent = "";
      pendingThinking = "";
      startedAt = Date.now();
      if (thinking) {
        targetMessage.thinking += thinking;
      }
      if (content) {
        targetMessage.content = content;
      }
      revealFn();
    },
    flushFinal() {
      flush();
    },
    reset() {
      clearTimer();
      pendingContent = "";
      pendingThinking = "";
      startedAt = Date.now();
    }
  };
}

function ensureChatRenderWindowStore() {
  if (!state.chatRenderWindows || typeof state.chatRenderWindows !== "object") {
    state.chatRenderWindows = {};
  }
  return state.chatRenderWindows;
}

function getChatRenderWindow(session) {
  const store = ensureChatRenderWindowStore();
  const sessionId = session?.id || "__default__";
  const total = Array.isArray(session?.messages) ? session.messages.length : 0;
  if (!store[sessionId]) {
    const recentCount = getChatRecentRenderCount(session);
    store[sessionId] = {
      start: Math.max(0, total - recentCount),
      total,
    };
  }
  return store[sessionId];
}

function clampChatRenderWindow(session) {
  const windowState = getChatRenderWindow(session);
  const total = Array.isArray(session?.messages) ? session.messages.length : 0;
  const maxStart = Math.max(0, total - 1);
  const recentCount = getChatRecentRenderCount(session);
  if (!Number.isFinite(windowState.start)) {
    windowState.start = Math.max(0, total - recentCount);
  }
  windowState.start = Math.max(0, Math.min(windowState.start, maxStart));
  windowState.total = total;
  return windowState;
}

function collapseRenderedMessageWindow(session, recentCount = CHAT_VIRTUAL_RECENT_RENDER_COUNT) {
  if (!session) return false;
  const total = Array.isArray(session.messages) ? session.messages.length : 0;
  const windowState = getChatRenderWindow(session);
  const nextStart = Math.max(0, total - Math.max(1, recentCount));
  const changed = windowState.start !== nextStart;
  windowState.start = nextStart;
  windowState.total = total;
  return changed;
}

function syncRenderedMessageWindow(session, options = {}) {
  if (!session) return { start: 0, total: 0 };
  const windowState = clampChatRenderWindow(session);
  const sessionChanged = state.chatRenderActiveSessionId !== session.id;
  const total = Array.isArray(session.messages) ? session.messages.length : 0;

  if (sessionChanged) {
    state.chatRenderActiveSessionId = session.id;
    if (!options.keepWindow) {
      windowState.start = Math.max(0, total - getChatRecentRenderCount(session));
    }
  } else if (options.forceRecent) {
    const renderedCount = total - windowState.start;
    if (renderedCount > CHAT_VIRTUAL_TRIM_THRESHOLD || options.alwaysTrim) {
      collapseRenderedMessageWindow(session, getChatRecentRenderCount(session));
    }
  }

  windowState.total = total;
  return windowState;
}

function getRenderedMessagesForSession(session) {
  const windowState = clampChatRenderWindow(session);
  return (session?.messages || []).slice(windowState.start);
}

async function maybeLoadOlderRenderedMessages() {
  const session = getCurrentSession();
  const scrollEl = getChatScrollElement();
  if (!session || !scrollEl || state.chatHistoryLoadPending) {
    return false;
  }
  if (state.userTopAnchorActive && state.isSending && els.chatMessages.querySelector(".scroll-spacer")) {
    return false;
  }
  if (scrollEl.scrollTop > getChatVirtualTopTriggerPx()) {
    return false;
  }

  const windowState = syncRenderedMessageWindow(session, { keepWindow: true });
  if (windowState.start <= 0) {
    state.chatHistoryLoadPending = true;
    try {
      const older = await loadOlderSessionMessages(session, CHAT_VIRTUAL_BACKFILL_BATCH);
      if (!older.length) {
        return false;
      }
      windowState.start = 0;
      windowState.total = Array.isArray(session.messages) ? session.messages.length : 0;
      renderMessages({ preserveScrollOnPrepend: true, keepWindow: true });
      return true;
    } finally {
      state.chatHistoryLoadPending = false;
    }
  }

  const nextStart = Math.max(0, windowState.start - CHAT_VIRTUAL_BACKFILL_BATCH);
  if (nextStart === windowState.start) {
    return false;
  }

  state.chatHistoryLoadPending = true;
  windowState.start = nextStart;
  windowState.total = Array.isArray(session.messages) ? session.messages.length : 0;
  renderMessages({ preserveScrollOnPrepend: true, keepWindow: true });
  state.chatHistoryLoadPending = false;
  return true;
}

function renderMessages(options = {}) {
  const shouldStickToBottom = Boolean(options.stickToBottom);
  const preserveScrollOnPrepend = Boolean(options.preserveScrollOnPrepend);
  const keepWindow = Boolean(options.keepWindow);
  const scrollEl = getChatScrollElement();
  const previousScrollTop = scrollEl.scrollTop;
  const previousScrollHeight = scrollEl.scrollHeight;
  const session = getCurrentSession();

  if (!session) {
    state.chatRenderActiveSessionId = null;
    els.chatMessages.innerHTML = "";
    return;
  }

  const sessionMode = session.mode || SESSION_MODE_STORY;
  const enableMd = sessionMode === SESSION_MODE_WORK && state.settings?.session?.markdownRender !== false;
  syncRenderedMessageWindow(session, {
    keepWindow,
    forceRecent: !keepWindow && (shouldStickToBottom || state.isSending),
    alwaysTrim: shouldStickToBottom && !state.userScrolledAway,
  });
  const renderedMessages = getRenderedMessagesForSession(session);

  // Index existing DOM by messageId — avoid destroying/recreating unchanged nodes
  const oldNodes = new Map();
  for (const child of els.chatMessages.children) {
    if (child.dataset?.messageId) oldNodes.set(child.dataset.messageId, child);
  }

  const fragment = document.createDocumentFragment();

  renderedMessages.forEach((message) => {
    // system-notice: no stable ID, always rebuild (rare, not worth diffing)
    if (message.uiType === "system-notice") {
      const notice = document.createElement("div");
      notice.className = "system-notice";
      notice.innerHTML = escapeHtml(message.content).replace(/\n/g, "<br>");
      fragment.appendChild(notice);
      return;
    }

    if (message.uiType === "narration") {
      const existing = message.id ? oldNodes.get(message.id) : null;
      if (existing) {
        oldNodes.delete(message.id);
        refreshNarrationNode(existing, message);
        fragment.appendChild(existing);
      } else {
        const node = buildNarrationNode(message);
        if (node) fragment.appendChild(node);
      }
      return;
    }

    // Regular user / assistant message
    const existing = message.id ? oldNodes.get(message.id) : null;
    if (existing) {
      oldNodes.delete(message.id);
      refreshMessageBlock(existing, message, sessionMode, enableMd);
      fragment.appendChild(existing);
    } else {
      const block = buildMessageBlock(message, sessionMode, enableMd);
      if (block) fragment.appendChild(block);
    }
  });

  // Remove stale nodes (truncated or replaced messages)
  for (const [, node] of oldNodes) node.remove();

  // Replace children — existing nodes are MOVED, not destroyed
  els.chatMessages.replaceChildren(fragment);

  if (preserveScrollOnPrepend) {
    const heightDelta = scrollEl.scrollHeight - previousScrollHeight;
    scrollEl.scrollTop = previousScrollTop + Math.max(0, heightDelta);
    return;
  }

  // --- Scroll handling (unchanged) ---
  if (shouldStickToBottom) {
    if (state.userTopAnchorActive && state.isSending) {
      recalcUserTopAnchorSpacer();
      return;
    }
    if (!state.userScrolledAway) {
      clearUserTopAnchorSpacer();
      scrollEl.scrollTop = scrollEl.scrollHeight;
      state.userScrolledAway = false;
    } else {
      clearUserTopAnchorSpacer();
    }
    return;
  }

  const heightDelta = scrollEl.scrollHeight - previousScrollHeight;
  scrollEl.scrollTop = previousScrollTop + Math.max(0, heightDelta);
}

/* ---- Narration helpers ---- */
function buildNarrationNode(message) {
  const narrationText = sanitizeNarrationText(message.content);
  const tokenLabel = buildMessageTokenLabel(message);
  const wrapper = document.createElement("article");
  wrapper.className = `narration-block ${state.openAgentTokenInfoId === message.id ? "token-open" : ""}`.trim();
  if (message.id) wrapper.dataset.messageId = message.id;
  const narration = document.createElement("div");
  narration.className = `narration ${message.pending ? "pending" : ""} ${message.streaming ? "streaming" : ""} ${!message.pending && !/[\r\n]/.test(narrationText) ? "single-line" : ""}`.trim();
  narration.innerHTML = message.pending
    ? `<span class="typing-row"><span></span><span></span><span></span></span>`
    : escapeHtml(narrationText).replace(/\n/g, "<br>");
  if (message.id && tokenLabel && isMobileTokenToggleMode()) {
    narration.addEventListener("click", () => {
      if (window.getSelection().toString().trim()) return;
      const wasOpen = state.openAgentTokenInfoId === message.id;
      state.openAgentTokenInfoId = wasOpen ? null : message.id;
      wrapper.classList.toggle("token-open", !wasOpen);
    });
  }
  wrapper.appendChild(narration);
  if (message.id && !message.pending) {
    const tokenBar = document.createElement("div");
    tokenBar.className = `message-token-bar narration-token-bar ${tokenLabel ? "has-token" : ""}`.trim();
    tokenBar.textContent = tokenLabel;
    wrapper.appendChild(tokenBar);
  }
  return wrapper;
}

function refreshNarrationNode(wrapper, message) {
  const narrationText = sanitizeNarrationText(message.content);
  const tokenLabel = buildMessageTokenLabel(message);
  wrapper.className = `narration-block ${state.openAgentTokenInfoId === message.id ? "token-open" : ""}`.trim();
  const bubble = wrapper.querySelector('.narration');
  if (bubble) {
    bubble.className = `narration ${message.pending ? "pending" : ""} ${message.streaming ? "streaming" : ""} ${!message.pending && !/[\r\n]/.test(narrationText) ? "single-line" : ""}`.trim();
    const body = message.pending
      ? `<span class="typing-row"><span></span><span></span><span></span></span>`
      : escapeHtml(narrationText).replace(/\n/g, "<br>");
    if (bubble.innerHTML !== body) bubble.innerHTML = body;
  }
  const tokenBar = wrapper.querySelector('.message-token-bar');
  if (tokenBar) {
    tokenBar.className = `message-token-bar narration-token-bar ${tokenLabel ? "has-token" : ""}`.trim();
    tokenBar.textContent = tokenLabel;
  }
}

/* ---- Message block helpers ---- */
function buildMessageBlock(message, sessionMode, enableMd) {
  const block = document.createElement("article");
  const isAgentPlainBlock = sessionMode === SESSION_MODE_WORK && message.role === "assistant";
  block.className = `message-block ${message.role === "user" ? "user" : message.role === "assistant" ? "agent" : "system"} ${isAgentPlainBlock ? "agent-plain-block" : ""} ${state.openUserMessageToolsId === message.id || state.openAgentTokenInfoId === message.id ? "tools-open" : ""} ${state.openAgentTokenInfoId === message.id ? "token-open" : ""}`.trim();
  if (message.id) block.dataset.messageId = message.id;

  if (message.role === "assistant" || message.role === "user") {
    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.innerHTML = `\n        <strong>${escapeHtml(message.speaker)}</strong>\n        <span>${new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>\n      `;
    block.appendChild(meta);
  }

  const isSingleLineMessage = !message.pending && !/[\r\n]/.test(message.content || "");
  const isWorkAgent = sessionMode === SESSION_MODE_WORK && message.role === "assistant";
  const bubble = document.createElement("div");
  bubble.className = `message ${message.role === "user" ? "user" : message.role === "system" ? "system" : "agent"} ${message.pending ? "pending" : ""} ${message.streaming ? "streaming" : ""} ${isSingleLineMessage ? "single-line" : ""} ${isWorkAgent ? "agent-plain" : ""}`.trim();

  if (message.pending) {
    bubble.innerHTML = `<span class="typing-row"><span></span><span></span><span></span></span>`;
  } else {
    bubble.innerHTML = buildBubbleContent(message);
    if (typeof hljs !== 'undefined' && enableMd) {
      bubble.querySelectorAll('pre code').forEach(hljs.highlightElement);
      wrapCodeLines(bubble);
    }
    if (sessionMode === SESSION_MODE_WORK) {
      bubble.querySelectorAll('.code-copy-btn').forEach(bindCodeCopyBtn);
    }
  }

  if (message.role === "user" && message.id) {
    bubble.addEventListener("click", () => {
      if (window.getSelection().toString().trim()) return;
      if (!block.parentNode) return;
      const wasOpen = state.openUserMessageToolsId === message.id;
      if (state.openAgentTokenInfoId) {
        const agentBlock = els.chatMessages.querySelector(`[data-message-id="${state.openAgentTokenInfoId}"]`);
        if (agentBlock) agentBlock.classList.remove("tools-open", "token-open");
        state.openAgentTokenInfoId = null;
      }
      state.openUserMessageToolsId = wasOpen ? null : message.id;
      block.classList.toggle("tools-open", !wasOpen);
    });
  }
  if (message.role === "assistant" && message.id && isMobileTokenToggleMode()) {
    bubble.addEventListener("click", () => {
      if (window.getSelection().toString().trim()) return;
      if (!block.parentNode) return;
      const wasOpen = state.openAgentTokenInfoId === message.id;
      if (state.openUserMessageToolsId) {
        const userBlock = els.chatMessages.querySelector(`[data-message-id="${state.openUserMessageToolsId}"]`);
        if (userBlock) userBlock.classList.remove("tools-open");
        state.openUserMessageToolsId = null;
      }
      state.openAgentTokenInfoId = wasOpen ? null : message.id;
      block.classList.toggle("tools-open", !wasOpen);
      block.classList.toggle("token-open", !wasOpen);
    });
  }
  block.appendChild(bubble);

  bindInlineMetaToggles(block, message);

  if (message.id && !message.pending) {
    block.appendChild(buildMessageTools(message));
  }

  return block;
}

function refreshMessageBlock(block, message, sessionMode, enableMd) {
  // 1. Update block-level className
  const isAgentPlainBlock = sessionMode === SESSION_MODE_WORK && message.role === "assistant";
  block.className = `message-block ${message.role === "user" ? "user" : message.role === "assistant" ? "agent" : "system"} ${isAgentPlainBlock ? "agent-plain-block" : ""} ${state.openUserMessageToolsId === message.id || state.openAgentTokenInfoId === message.id ? "tools-open" : ""} ${state.openAgentTokenInfoId === message.id ? "token-open" : ""}`.trim();

  // 2. Update bubble className + content
  const bubble = block.querySelector('.message');
  if (!bubble) return;

  const isSingleLineMessage = !message.pending && !/[\r\n]/.test(message.content || "");
  const isWorkAgent = sessionMode === SESSION_MODE_WORK && message.role === "assistant";
  bubble.className = `message ${message.role === "user" ? "user" : message.role === "system" ? "system" : "agent"} ${message.pending ? "pending" : ""} ${message.streaming ? "streaming" : ""} ${isSingleLineMessage ? "single-line" : ""} ${isWorkAgent ? "agent-plain" : ""}`.trim();

  if (message.pending) {
    bubble.innerHTML = `<span class="typing-row"><span></span><span></span><span></span></span>`;
  } else {
    const newContent = buildBubbleContent(message);
    if (bubble.innerHTML !== newContent) {
      bubble.innerHTML = newContent;
      if (typeof hljs !== 'undefined' && enableMd) {
        bubble.querySelectorAll('pre code').forEach(hljs.highlightElement);
        wrapCodeLines(bubble);
      }
      if (sessionMode === SESSION_MODE_WORK) {
        bubble.querySelectorAll('.code-copy-btn').forEach(bindCodeCopyBtn);
      }
    }
  }

  bindInlineMetaToggles(block, message);

  // 3. Build tools section if it doesn't exist yet (pending → done transition)
  const existingTools = block.querySelector('.message-tools');
  if (message.id && !message.pending) {
    if (!existingTools) {
      const tools = buildMessageTools(message);
      block.appendChild(tools);
    } else if (message.role === "assistant") {
      const tokenLabel = buildMessageTokenLabel(message);
      const tokenSpan = existingTools.querySelector('.message-token-label');
      if (tokenSpan) {
        tokenSpan.textContent = tokenLabel;
      } else if (tokenLabel) {
        const nextTokenSpan = document.createElement("span");
        nextTokenSpan.className = "message-token-label";
        nextTokenSpan.textContent = tokenLabel;
        existingTools.prepend(nextTokenSpan);
      }
      existingTools.classList.toggle("has-token", Boolean(tokenLabel));
    }
  } else if (existingTools && message.pending) {
    existingTools.remove();
  }
}

function buildMessageTools(message) {
  const tools = document.createElement("div");
  tools.className = "message-tools";
  tools.style.justifyContent = message.role === "user" ? "flex-end" : "space-between";

  const tokenLabel = message.role === "assistant" ? buildMessageTokenLabel(message) : "";
  tools.classList.toggle("has-token", Boolean(tokenLabel));
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
  copyBtn.innerHTML = `<i class="bi bi-copy message-edit-icon"></i>`;
  copyBtn.addEventListener("click", () => copyMessageContent(message.id));
  tools.appendChild(copyBtn);

  if (message.role === "user") {
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = `message-edit-btn ${state.editingUserMessageId === message.id ? "active" : ""}`.trim();
    editBtn.innerHTML = `<i class="bi bi-pencil message-edit-icon"></i>`;
    editBtn.addEventListener("click", () => beginUserMessageEdit(message.id));
    tools.appendChild(editBtn);

    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "message-edit-btn";
    retryBtn.innerHTML = `<i class="bi bi-arrow-counterclockwise message-edit-icon"></i>`;
    retryBtn.addEventListener("click", () => regenerateFromUserMessage(message.id));
    tools.appendChild(retryBtn);
  }

  return tools;
}

function bindInlineMetaToggles(block, message) {
  if (!block || !message?.id) return;
  const thinkingSection = block.querySelector(".thinking-section");
  if (thinkingSection && !thinkingSection.dataset.boundToggle) {
    thinkingSection.dataset.boundToggle = "true";
    thinkingSection.addEventListener("toggle", () => {
      message.thinkingExpanded = thinkingSection.open;
      if (window.persistSessions) {
        window.persistSessions();
      }
    });
  }
  const toolTraceSection = block.querySelector(".tool-trace-section");
  if (toolTraceSection && !toolTraceSection.dataset.boundToggle) {
    toolTraceSection.dataset.boundToggle = "true";
    toolTraceSection.addEventListener("toggle", () => {
      message.toolTraceExpanded = toolTraceSection.open;
      state.openAgentToolTraceId = toolTraceSection.open ? message.id : (state.openAgentToolTraceId === message.id ? null : state.openAgentToolTraceId);
      if (window.persistSessions) {
        window.persistSessions();
      }
    });
  }
}

/* Shared copy-button handler */
function bindCodeCopyBtn(btn) {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    var pre = btn.closest('.pre-code-block');
    let code = '';
    if (pre) {
      const numberedLines = pre.querySelectorAll('.code-line-text');
      if (numberedLines.length) {
        code = Array.from(numberedLines)
          .map((line) => (line.textContent || '').replace(/\u200B/g, ''))
          .join('\n');
      } else {
        const codeEl = pre.querySelector('code');
        code = codeEl ? codeEl.textContent.replace(/\u200B/g, '') : '';
      }
    }
    navigator.clipboard.writeText(code).then(() => {
      btn.className = 'code-copy-btn copied';
      btn.innerHTML = '<i class="bi bi-check"></i>';
      setTimeout(() => {
        btn.className = 'code-copy-btn';
        btn.innerHTML = '<i class="bi bi-clipboard"></i>';
      }, 1500);
    }).catch(() => {});
  });
}

function stopGeneration() {
  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
  }
  state.isSending = false;
  els.sendBtn.disabled = false;
  els.chatInput.disabled = false;
  finishUserTopAnchor();
  autoResizeChatInput();
  updateComposerMode();
  setText(els.chatStatus, t("chat.stopped"));
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
  if (els.thinkingPopover && !els.thinkingPopover.classList.contains("hidden")) {
    els.thinkingPopover.classList.add("hidden");
    els.thinkingPopover.classList.remove("visible");
    els.thinkingToggleBtn?.classList.remove("active");
  }
  els.sendBtn.disabled = true;
  els.chatInput.disabled = true;
  updateComposerMode();

  const editingUserMessageId = state.editingUserMessageId;
  if (editingUserMessageId) {
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
  syncLoadedSessionMessageCount(session);

  touchSession(session);
  persistSessions();
  // 保存用户消息到 IndexedDB
  if (window.__chatDB) {
    const lastUser = session.messages[session.messages.length - 1];
    if (lastUser && lastUser.role === "user") {
      try {
        if (!editingUserMessageId && window.__chatDB.appendMessage) {
          const savedSeq = await window.__chatDB.appendMessage(session.id, lastUser);
          session.messageCount = Math.max(Number(session.messageCount) || 0, savedSeq + 1);
        } else {
          const userSeq = getMessageSequenceInSession(session, lastUser);
          await window.__chatDB.saveMessage(session.id, lastUser, userSeq);
        }
        await window.__chatDB.updateSessionMeta(session);
      } catch (err) {
        console.error("[chat] save user message failed", err);
        setText(els.chatStatus, "用户消息保存失败，请稍后重试");
        state.isSending = false;
        els.sendBtn.disabled = false;
        els.chatInput.disabled = false;
        updateComposerMode();
        return;
      }
    }
  }
  els.chatInput.value = "";
  autoResizeChatInput();
  renderMessages();
  renderChatListMenu();
  pinLastUserMessageToTop();
  debugLog("turn", t("debug.msg.userMessageSubmitted"), {
    sessionId: session.id,
    editingMessageId: state.editingUserMessageId,
    content,
  });

  state.abortController = new AbortController();
  await runSessionTurn(session);
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
          setText(els.chatStatus, `${targetNpc.name} 正在回复...`);
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
    }
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
            console.log("[MOYU-SEARCH] 模型未输出标记，自动执行历史区间检索", blindRange);
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

  try {
    debugLog("turn", t("debug.msg.directorTurnStarted"), {
      sessionId: session.id,
      messageCount: session.messages.length,
      transientNpcCount: (session.transientNpcs || []).length,
    });
    const directive = await callDirector(session);
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
      debugLog("director", "NPC 并行分组", parallelGroups.map((group) => group.map((npc) => npc.name)));
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
    els.sendBtn.disabled = false;
    els.chatInput.disabled = false;
    finishUserTopAnchor();
    autoResizeChatInput();
    updateComposerMode();
    if (!window.matchMedia?.("(pointer: coarse)").matches) {
      queueMicrotask(() => els.chatInput.focus());
    }
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
    console.log("[MOYU-SEARCH] historical scope names", {
      sessionId: session.id,
      dbScopes: dbScopes || [],
      runtimeScopes,
      mergedScopes: session.historicalScopeNames,
    });
  } catch (error) {
    console.warn("[MOYU] failed to load historical scope names", {
      sessionId: session?.id,
      error: error?.message || String(error),
    });
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
    ...(session.mode === SESSION_MODE_STORY ? [{
      role: "system",
      content: [
        "重要修正：创作模式里，用户发出普通对话、动作、询问、试探、寒暄时，本轮必须产生推进。",
        "每次调度前，先在心里根据最近历史确认当前现场参与者：用户本人、仍在同一场景同行/对峙/围观的固定 NPC、刚由旁白登场且未离开的临时 NPC。",
        "历史格式 {npc:名字} 表示该 NPC 曾经发言；只要最近没有明确离场/分开/消失，就默认仍在当前场景。",
        "推进可以是 narration 旁白，也可以是 responders 中的 NPC 回应，也可以两者都有。",
        "responders 可以为空，但前提是 narration 必须承担这一拍的场景推进、气氛反应或动作描写。",
        "除非用户明确要求等待、沉默、无人回应，禁止同时返回空 narration 和空 responders。",
        "用户不是镜头外旁观者，而是当前场景中的在场参与者；历史里的“你/用户/我们/三人/同行”都包含用户本人。",
        "旁白或调度描述队伍、人数、来意、站位、同行关系时，必须把所有现场参与者算进去；禁止漏掉同行 NPC，也禁止只数 NPC 导致用户像不存在。",
        "例如用户与李文、张铁同行到山门，即使用户飞起来震慑山门，现场仍是用户、李文、张铁三人；新登场长老看向他们时应理解为三人，而不是两人。",
        "这不代表替用户说话或行动。只能承认用户在场、被看见、被 NPC 回应，用户的具体发言和动作仍由用户自己决定。",
      ].join("\n"),
    }] : []),
    {
      role: "system",
      content: [
        "你可以额外输出 parallel_groups 字段，用来声明 NPC 回复并行分组。",
        "格式：\"parallel_groups\":[[\"NPC甲\",\"NPC乙\"],[\"NPC丙\"]]。",
        "parallel_groups 必须只包含 responders 中已经出现的 NPC 名字；没有把握时可以省略，系统会按 responders 串行执行。",
        "判断规则：用户要求“分别、各自、都说说、一起回答、每个人”这类独立观点时，可以把这些 NPC 放进同一个并行组。",
        "用户要求“接着、反驳、吵、轮流、先后、总结、回应他/她”这类互相接话时，必须拆成多个单人组，保持串行。",
      ].join("\n"),
    },
    ...(session.mode === SESSION_MODE_STORY ? [{
      role: "system",
      content: [
        "创作调度原则：你只安排本轮谁说、顺序和具体任务，不要把所有 NPC 调成同一种语气。",
        "npc_instructions 应当保留每个 NPC 的人物 Prompt、欲望、关系立场和说话习惯。",
        "多人同场时，给不同 NPC 分配不同角度：有人推进事件、有人暴露情绪、有人质疑、有人遮掩或转移话题。不要全部写成“简洁解释”。",
      ].join("\n"),
    }] : []),
    ...buildDirectorContextMessages(session),
  ];

  if (state.settings?.session?.directorDispatchOnly) {
    messages.push({ role: "system", content: "你只负责调度。禁止输出 npc_instructions 字段——NPC 不需要你的指挥，让他们自由发挥。" });
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    debugLog("director", t("debug.msg.requestAttempt"), {
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
              "创作模式中，如果用户只是没点名 NPC，但发出了普通对话/动作/询问 → narration 或 responders 至少一个必须非空。",
              "如果 responders 为空，narration 必须写出这一拍的场景推进、气氛反应或动作描写。",
              "只有用户明确要求等待、沉默、无人回应时，narration 和 responders 才可以同时为空。",
            ].join("\n"),
          },
        ];

    const directorConfig = resolveModelConfig(session.directorConfigId, session.directorModel, session.configId);
    const directorExtra = buildThinkingExtra(session.directorModel, state.directorThinking);
    const promptMessages = !state.directorThinking && !supportsThinkingParam(session.directorModel)
      ? [...requestMessages, { role: "system", content: "直接输出，不要输出思考过程。" }]
      : requestMessages;
    const payload = await createChatCompletionPayload(directorConfig.host, directorConfig.key, session.directorModel, promptMessages, false, 0.5, directorExtra);
    const content = payload.content;
    debugLog("director", t("debug.msg.rawResponseReceived"), {
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
      debugLog("director", t("debug.msg.invalidResponseRetrying"), {
        attempt: attempt + 1,
        error: jsonError.message,
        content,
      });

      if (attempt >= 1) {
        try {
          const repaired = await repairDirectorDirective(session, messages, content, attempt + 1);
          debugLog("director", t("debug.msg.repairResponseAccepted"), repaired);
          return repaired;
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

  const storyLanes = [
    "短句、克制、先观察再开口；情绪藏在动作里，不急着解释。",
    "反应快、语气带刺或俏皮；先给态度，再补一句真实想法。",
    "说话慢、有分寸；喜欢用具体物件、天气、距离感承接情绪。",
    "直白、务实、少修饰；先处理眼前问题，不主动抒情。",
    "敏感、细腻、容易捕捉别人没说出口的东西；少下结论。",
    "有压迫感或主导欲；句子干净，行动比解释更重。",
  ];
  const workLanes = [
    "先给判断，再给理由；少寒暄，保持自己的专业角度。",
    "先拆问题，再指出风险；语气冷静，不抢结论。",
    "先补充盲点，再给可执行建议；避免泛泛总结。",
    "先确认目标，再推进下一步；表达简洁但不模板化。",
  ];
  const lanes = isStoryMode ? storyLanes : workLanes;
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
    ? [
        "=== 用户在场规则 ===",
        "用户不是镜头外旁观者，而是当前场景中的在场参与者；历史里的“你/用户/我们/三人/同行”都包含用户本人。",
        "历史格式 {npc:名字} 表示该 NPC 曾经发言；只要最近没有明确离场/分开/消失，就默认仍在当前场景。",
        "当你提到队伍、人数、来意、同行者、站位或一起行动时，必须把用户算进去，不能只列 NPC。",
        "也必须把仍在场的同行 NPC 算进去。比如用户与李文、张铁同行到山门，旁人看向他们时应是三人，不是只看用户和张铁两人。",
        "如果历史显示用户与多个 NPC 同行，可以称用户为“你”“这位朋友”“这位兄台”“同行之人”等，不要凭空给用户起名。",
        "禁止替用户说话、行动或做决定；但可以看见用户、回应用户、把用户纳入现场关系。",
      ].join("\n")
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
    // For single AI mode: include chat summary for context of older conversation
    ...(session.chatSummary ? [{ role: "system", content: buildChatSummaryBlock(session) }] : []),
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
      console.warn("[chat] save assistant message failed", err);
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
    console.log("[MOYU-SEARCH] 模型触发了区间查看", rangeReq);
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
  console.log("[MOYU-SEARCH] 模型触发了搜索请求", { query: searchQuery });
  const historicalScopes = Array.isArray(session.historicalScopeNames) ? session.historicalScopeNames : [];
  const scopePreferred = isScopePreferredSearchQuery(searchQuery);
  if (scopePreferred) {
    console.warn("[MOYU-SEARCH] scoped retrieval should have been preferred", {
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

    console.log("[MOYU:compress]", mode, "mode", {
      memoryTokens,
      threshold,
      candidateCount: candidateMessages.length,
      recentLimit,
    });

    if (memoryTokens >= threshold) {
      // 记忆超阈值 → 全量重压缩（像手动压缩一样收紧记忆）
      console.warn("[MOYU:compress] 记忆超阈值，触发全量重压缩", { memoryTokens, threshold });
      return ensureDirectorSummary(session, { force: true, mode: "manual", recentLimit: DIRECTOR_MANUAL_RECENT_HISTORY_LIMIT });
    }

    if (!candidateMessages.length) {
      return false;
    }

    if (!allowAutoMerge) {
      console.log("[MOYU:compress]", "跳过自动合并新增历史", {
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

  console.log("[MOYU:compress]", "调用压缩模型", {
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

  console.log("[MOYU:compress]", "压缩模型返回", {
    contentLength: payload.content?.length || 0,
    usage: payload.usage,
  });
  console.log("[MOYU:compress]", "压缩结果文本", payload.content);
  const nextMemory = parseDirectorMemoryPayload(payload.content, session);
  const nextMemoryBlock = buildDirectorMemoryBlock(nextMemory);
  const nextSummary = nextMemory.synopsis || nextMemoryBlock;
  const nextMemoryTokens = estimateTokens(nextMemoryBlock || nextSummary);
  const shouldApplyManualSummary = mode !== "manual"
    || !currentMemoryBlock
    || nextMemoryTokens <= Math.max(DIRECTOR_MEMORY_TARGET_MIN, beforeManualBudget);

  console.log("[MOYU:compress]", "解析结果", {
    mode,
    beforeMemoryTokens,
    nextMemoryTokens,
    shouldApply: shouldApplyManualSummary,
  });

  if (!shouldApplyManualSummary) {
    console.warn("[MOYU:compress]", "未应用压缩结果", {
      reason: mode === "manual" ? "新记忆token超预算" : "非手动模式且无变更",
    });
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

  console.log("[MOYU:compress]", "压缩完成", {
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

  // Messages before the cutoff are the "old" ones to summarize
  const oldMessages = cutoffIdx >= 0 ? visibleMessages.slice(0, cutoffIdx) : [];
  // If force mode, take everything up to the last few messages
  const compressible = force
    ? visibleMessages.slice(0, Math.max(0, visibleMessages.length - 4))
    : oldMessages;

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

  console.log("[MOYU:compress]", "单 AI 摘要压缩调用", {
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

  console.log("[MOYU:compress]", "单 AI 摘要压缩结果", {
    beforeTokens,
    nextTokens,
    summaryLength: nextSummary.length,
  });

  session.chatSummary = nextSummary;
  if (recentMessages.length) {
    session.compressedUntilMessageId = recentMessages[recentMessages.length - 1]?.id || session.compressedUntilMessageId || "";
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
    unsummarizedCount = cutoffIdx >= 0
      ? Math.max(0, visibleMessages.length - cutoffIdx - 1)
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

  console.log("[MOYU:compress]", "自动压缩触发", {
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
    setText(els.chatStatus, prevStatusText || "所有单位已就绪");
  } catch (error) {
    setText(els.chatStatus, prevStatusText || "所有单位已就绪");
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
  const unsummarizedMessages = cutoffIdx >= 0
    ? visibleMessages.slice(cutoffIdx + 1)
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

  console.log("[MOYU:compress]", "单 AI 自动压缩触发", {
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
    setText(els.chatStatus, prevStatusText || "所有单位已就绪");
  } catch (error) {
    setText(els.chatStatus, prevStatusText || "所有单位已就绪");
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

function isMobileTokenToggleMode() {
  return window.matchMedia("(hover: none), (pointer: coarse)").matches;
}

function ensureCompressMemoryPopover() {
  if (!els.compressMemoryBtn || !els.composerFooter) {
    debugLog("compress", t("debug.msg.popoverMountSkipped"), {
      hasButton: Boolean(els.compressMemoryBtn),
      hasFooter: Boolean(els.composerFooter),
    });
    return null;
  }
  let popover = els.composerFooter.querySelector(".memory-compress-popover");
  if (!popover) {
    popover = document.createElement("div");
    popover.className = "memory-compress-popover hidden";
    debugLog("compress", t("debug.msg.popoverMounted"));
    els.compressMemoryBtn.appendChild(popover);
  }
  return popover;
}


function buildCompressMemoryPopoverMarkup(session) {
  const isSingleAi = session?.mode === SESSION_MODE_WORK && !session.directorModel && session.npcs?.length === 1;
  const metrics = isSingleAi ? buildChatContextTokenMetrics(session) : buildDirectorContextTokenMetrics(session);
  if (!metrics) {
    return "";
  }

  const contextPercent = Math.max(0, Math.min(100, Math.round((metrics.contextCurrent / Math.max(1, metrics.contextThreshold)) * 100)));
  const headText = isSingleAi ? "对话上下文与压缩进度" : "导演上下文与自动压缩进度";
  const progressTone = contextPercent >= 100 ? "full" : contextPercent >= 76 ? "high" : contextPercent >= 48 ? "mid" : "low";
  const summaryText = isSingleAi ? String(session?.chatSummary || "").trim() : String(session?.directorSummary || "").trim();
  const summaryPreview = summaryText
    ? escapeHtml(summaryText.length > 360 ? `${summaryText.slice(0, 360)}…` : summaryText).replace(/\n/g, "<br>")
    : "";
  const summaryCollapsed = summaryPreview && summaryText.split(/\n+/).filter(Boolean).length > 3 ? "collapsed" : "expanded";
  const rows = [
    ["上下文", `${formatTokenCount(metrics.contextCurrent)} / ${formatTokenCount(metrics.contextThreshold)}`],
  ];
  if (isSingleAi && metrics.recentCount > 0) {
    rows.push(["消息数", String(metrics.recentCount)]);
  }

  return `
    <div class="memory-compress-popover-panel">
      <div class="memory-compress-popover-header">
        <span class="memory-compress-popover-title">${headText}</span>
        <span class="memory-compress-popover-percent" data-tone="${progressTone}">${contextPercent}%</span>
      </div>
      <div class="memory-compress-progress" aria-hidden="true">
        <div class="memory-compress-progress-fill" data-tone="${progressTone}" style="width:${contextPercent}%"></div>
      </div>
      <dl class="memory-compress-metrics">
        ${rows.map(([label, value]) => `
          <div class="memory-compress-metric">
            <dt>${label}</dt>
            <dd>${value}</dd>
          </div>
        `).join("")}
      </dl>
      ${summaryPreview ? `
      <div class="memory-compress-summary ${summaryCollapsed}">
        <div class="memory-compress-summary-label">${isSingleAi ? "压缩摘要" : "导演记忆"}</div>
        <div class="memory-compress-summary-body">${summaryPreview}</div>
        <button class="memory-compress-summary-toggle" type="button">${summaryCollapsed === "collapsed" ? "展开" : "收起"}</button>
      </div>
      ` : ""}
      <div class="memory-compress-popover-footer">
        <button class="memory-compress-popover-action" type="button"${state.isSending ? " disabled" : ""}>压缩</button>
      </div>
    </div>
  `.trim();
}

function updateCompressMemoryButtonProgress(session) {
  if (!els.compressMemoryBtn) {
    return;
  }

  const isSingleAi = session?.mode === SESSION_MODE_WORK && !session.directorModel && session.npcs?.length === 1;
  const metrics = session
    ? (isSingleAi ? buildChatContextTokenMetrics(session) : buildDirectorContextTokenMetrics(session))
    : null;
  const contextPercent = metrics
    ? Math.max(0, Math.min(100, Math.round((metrics.contextCurrent / Math.max(1, metrics.contextThreshold)) * 100)))
    : 0;

  const progressColor = contextPercent >= 100
    ? "#ff7a59"
    : contextPercent >= 80
      ? "#f0c35a"
      : "#5aa7ff";

  els.compressMemoryBtn.style.setProperty("--memory-compress-percent", String(contextPercent));
  els.compressMemoryBtn.style.setProperty("--memory-compress-progress", progressColor);
  els.compressMemoryBtn.dataset.hasProgress = metrics ? "true" : "false";
  els.compressMemoryBtn.setAttribute(
    "aria-label",
    metrics
      ? `压缩记忆，当前上下文 ${metrics.contextCurrent} / ${metrics.contextThreshold}，进度 ${contextPercent}%`
      : "压缩记忆"
  );
  els.compressMemoryBtn.title = metrics
    ? `压缩记忆 ${metrics.contextCurrent} / ${metrics.contextThreshold}`
    : "压缩记忆";
}

function showCompressPopover() {
  const popover = els.compressMemoryBtn?.querySelector(".memory-compress-popover");
  if (!popover || popover.classList.contains("hidden")) return;
  popover.style.setProperty("transition", "opacity 0.18s ease");
  adjustCompressPopoverBoundary();
  popover.classList.add("visible");
  popover.getBoundingClientRect();
  popover.style.removeProperty("transition");
}

function hideCompressPopover() {
  const popover = els.compressMemoryBtn?.querySelector(".memory-compress-popover");
  if (!popover) return;
  popover.classList.remove("visible");
}

function toggleCompressPopover() {
  if (state.openCompressMemoryInfo) {
    showCompressPopover();
  } else {
    hideCompressPopover();
  }
}

function renderCompressMemoryPopover() {
  const popover = ensureCompressMemoryPopover();
  if (!popover || !els.compressMemoryBtn) {
    debugLog("compress", t("debug.msg.popoverRenderSkipped"), {
      hasPopover: Boolean(popover),
      hasButton: Boolean(els.compressMemoryBtn),
    });
    return;
  }

  const session = getCurrentSession();
  const hasSession = Boolean(session);
  updateCompressMemoryButtonProgress(session);
  popover.innerHTML = hasSession ? buildCompressMemoryPopoverMarkup(session) : "";
  if (hasSession) {
    void ensureSessionStoredTokenEstimate(session);
  }
  popover.classList.remove("is-positioned");
  popover.classList.toggle("hidden", !hasSession);
  els.compressMemoryBtn.classList.toggle("info-open", state.openCompressMemoryInfo && hasSession);
  if (hasSession) {
    adjustCompressPopoverBoundary();
  }
  debugLog("compress", t("debug.msg.popoverRendered"), {
    hasSession,
    open: state.openCompressMemoryInfo,
    sending: state.isSending,
    hasMarkup: Boolean(popover.innerHTML.trim()),
  });
  const summaryToggle = popover.querySelector(".memory-compress-summary-toggle");
  const summaryBox = popover.querySelector(".memory-compress-summary");
  if (summaryToggle && summaryBox) {
    summaryToggle.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const collapsed = summaryBox.classList.toggle("collapsed");
      summaryBox.classList.toggle("expanded", !collapsed);
      summaryToggle.textContent = collapsed ? "展开" : "收起";
    };
  }
  const actionBtn = popover.querySelector(".memory-compress-popover-action");
  if (actionBtn) {
    actionBtn.disabled = state.isSending || !hasSession;
    actionBtn.onpointerdown = (event) => {
      debugLog("compress", t("debug.msg.popoverActionPointerdown"), {
        disabled: actionBtn.disabled,
      });
      event.preventDefault();
      event.stopPropagation();
    };
    actionBtn.onclick = (event) => {
      debugLog("compress", t("debug.msg.popoverActionClick"), {
        disabled: actionBtn.disabled,
        hasSession,
        sending: state.isSending,
      });
      event.preventDefault();
      event.stopPropagation();
      void triggerManualDirectorCompression();
    };
    debugLog("compress", t("debug.msg.popoverActionBound"), {
      disabled: actionBtn.disabled,
    });
  } else {
    debugLog("compress", t("debug.msg.popoverActionMissing"));
  }
}

function adjustCompressPopoverBoundary() {
  const popover = els.compressMemoryBtn?.querySelector(".memory-compress-popover");
  if (!popover || popover.classList.contains("hidden")) return;
  popover.classList.remove("is-positioned");
  popover.style.setProperty("--memory-compress-popover-shift-x", "0px");
  popover.style.setProperty("--memory-compress-popover-shift-y", "0px");
  popover.style.maxHeight = "";
  const rect = popover.getBoundingClientRect();
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft || 0;
  const viewportTop = viewport?.offsetTop || 0;
  const vw = viewport?.width || window.innerWidth;
  const vh = viewport?.height || window.innerHeight;
  const viewportRight = viewportLeft + vw;
  const viewportBottom = viewportTop + vh;
  const pad = 8;

  let shiftX = 0;
  if (rect.left < viewportLeft + pad) {
    shiftX = viewportLeft + pad - rect.left;
  } else if (rect.right > viewportRight - pad) {
    shiftX = viewportRight - pad - rect.right;
  }

  let shiftY = 0;
  if (rect.top < viewportTop + pad) {
    shiftY = viewportTop + pad - rect.top;
  } else if (rect.bottom > viewportBottom - pad) {
    shiftY = viewportBottom - pad - rect.bottom;
  }

  popover.style.setProperty("--memory-compress-popover-shift-x", `${Math.round(shiftX)}px`);
  popover.style.setProperty("--memory-compress-popover-shift-y", `${Math.round(shiftY)}px`);

  const nextRect = popover.getBoundingClientRect();
  const fitsViewport =
    nextRect.left >= viewportLeft + pad &&
    nextRect.right <= viewportRight - pad &&
    nextRect.top >= viewportTop + pad &&
    nextRect.bottom <= viewportBottom - pad;

  popover.classList.toggle("is-positioned", fitsViewport);
}

function updateModelThinkingBtn() {
  if (!els.modelThinkingBtn) return;
  const on = els.modelThinkingBtn.dataset.state === "enabled";
  els.modelThinkingBtn.className = `secondary-btn model-thinking-btn ${on ? "state-enabled" : "state-disabled"}`;
  els.modelThinkingBtn.textContent = "Agent思考";
}

function isSingleModelWorkSession(session) {
  return Boolean(session && session.mode === SESSION_MODE_WORK && !session.directorModel && (session.npcs || []).length === 1);
}

function buildBlindTurnRangeHint(session, blindEnd) {
  if (!window.__chatRetrieval?.getTurnRanges || !blindEnd) {
    return "";
  }
  const ranges = window.__chatRetrieval.getTurnRanges(session)
    .filter((item) => item.start <= blindEnd)
    .slice(0, 20);
  if (!ranges.length) {
    return "";
  }
  const lines = ranges.map((item) => {
    const end = Math.min(item.end, blindEnd);
    return `Round ${item.turn}: GLOBAL messages ${item.start}-${end}; use 【查看区间】${item.start}-${end}【/查看区间】`;
  });
  return "Blind round index map. If the user asks about a round, use the exact marker shown here:\n" + lines.join("\n") + "\n\n";
}

function updateThinkingToggleMode() {
  if (!els.thinkingToggleBtn) return;
  const session = getCurrentSession();
  const singleModel = isSingleModelWorkSession(session);
  const enabled = state.settings?.session?.modelThinking === "enabled";
  els.thinkingToggleBtn.classList.toggle("single-model-thinking", singleModel);
  els.thinkingToggleBtn.classList.toggle("state-enabled", singleModel && enabled);
  els.thinkingToggleBtn.classList.toggle("state-disabled", singleModel && !enabled);
  els.thinkingToggleBtn.textContent = singleModel ? "深度思考" : "思考设置";
  els.thinkingToggleBtn.setAttribute("aria-pressed", singleModel ? String(enabled) : "false");
  if (singleModel && els.thinkingPopover) {
    els.thinkingPopover.classList.add("hidden");
    els.thinkingPopover.classList.remove("visible");
    els.thinkingToggleBtn.classList.remove("active");
  }
}

function getModelThinkingState() {
  return state.settings?.session?.modelThinking || "disabled";
}

function buildModelThinkingExtra(modelName) {
  return buildThinkingExtra(modelName, getModelThinkingState());
}
























function getNpcResponseTemperature(session, model) {
  const weak = isWeakModel(model);
  if (session?.mode === SESSION_MODE_STORY) {
    return weak ? 0.45 : 0.72;
  }
  return weak ? 0.25 : 0.5;
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
  return /分别|各自|都说说|一起回答|一起说|每个人|每位|各说|同时|各抒己见|都回答/u.test(String(text || ""));
}

function shouldForceSerialNpcReply(text) {
  return /接着|反驳|吵|争吵|轮流|先后|总结|回应他|回应她|回应它|接话|插话|打断|辩论|质问|追问|收尾/u.test(String(text || ""));
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

  if (Array.isArray(directive?.parallelGroups) && directive.parallelGroups.length) {
    directive.parallelGroups.forEach((group) => {
      if (!Array.isArray(group)) return;
      const resolved = group
        .map((name) => byName.get(name))
        .filter((npc) => npc && !used.has(npc.name));
      resolved.forEach((npc) => used.add(npc.name));
      if (resolved.length) {
        groups.push(resolved);
      }
    });
    responders.forEach((npc) => {
      if (!used.has(npc.name)) {
        groups.push([npc]);
      }
    });
    return groups;
  }

  return buildFallbackParallelGroups(session, responders);
}

async function callNpcGroup(session, group, npcInstructions) {
  if (!group.length) return;
  if (group.length === 1) {
    await callNpc(session, group[0], npcInstructions);
    return;
  }

  for (let index = 0; index < group.length; index += NPC_PARALLEL_GROUP_LIMIT) {
    const chunk = group.slice(index, index + NPC_PARALLEL_GROUP_LIMIT);
    await Promise.all(chunk.map((npc) => callNpc(
      session,
      npc,
      npcInstructions,
      chunk.filter((item) => item.name !== npc.name).map((item) => item.name)
    )));
  }
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

  const shouldTrackUsage = state.settings?.session?.showTokenDisplay !== false;

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
    if (speaker !== "导演 AI") {
      targetMessage.content = stripThinkingLeakage(targetMessage.content);
    }
    targetMessage.thinking = result.thinking || "";
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
          if (thinkingDelta && !streamRevealed) {
            initialThinkingBuffer += thinkingDelta;
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
              streamBatch.queue(delta, thinkingDelta, streamRevealed);
            }
          } else if (thinkingDelta && streamRevealed) {
            streamBatch.queue("", thinkingDelta, streamRevealed);
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
              if (thinkingDelta && !retryRevealed) {
                retryInitialThinkingBuffer += thinkingDelta;
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
                  retryBatch.queue(delta, thinkingDelta, retryRevealed);
                }
              } else if (thinkingDelta && retryRevealed) {
                retryBatch.queue("", thinkingDelta, retryRevealed);
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
  if (els.chatMessages) {
    var scrollEl = els.chatMessages.closest(".main");
    if (scrollEl) scrollEl.style.scrollPaddingBottom = "";
  }
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
    var scrollEl = els.chatMessages.closest(".main");
    if (scrollEl) {
      scrollEl.style.scrollPaddingBottom = "200px";
      smoothScrollTo(scrollEl, scrollEl.scrollHeight);
    }
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

// ============================================================
// @mention Autocomplete — work-mode only NPC quick-select
// ============================================================

let mentionState = null;

function escapeMentionPattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveDirectMentionTarget(session, text, cursorPos = text.length) {
  if (!session || session.mode !== SESSION_MODE_WORK || !text) {
    return null;
  }

  const allNpcs = getSceneNpcs(session);
  const seen = new Set();
  const uniqueNpcs = allNpcs.filter((npc) => {
    if (!npc?.name || seen.has(npc.name)) {
      return false;
    }
    seen.add(npc.name);
    return true;
  });

  let matched = null;
  uniqueNpcs.forEach((npc) => {
    const pattern = new RegExp(`@${escapeMentionPattern(npc.name)}(?=$|\\s|[，。、“”"'！？!?：:；;,.()（）\\[\\]{}<>《》])`, "g");
    let result;
    while ((result = pattern.exec(text)) !== null) {
      const atPos = result.index;
      const endPos = atPos + result[0].length;
      if (atPos > cursorPos) {
        break;
      }
      if (!matched || atPos >= matched.atPos) {
        matched = {
          npc,
          atPos,
          endPos,
          raw: result[0],
        };
      }
    }
  });

  if (matched) {
    return matched;
  }

  const beforeCursor = text.slice(0, cursorPos);
  const atPos = beforeCursor.lastIndexOf("@");
  if (atPos < 0) {
    return null;
  }

  return {
    npc: null,
    atPos,
    endPos: cursorPos,
    raw: beforeCursor.slice(atPos, cursorPos),
    filterText: beforeCursor.slice(atPos + 1, cursorPos),
  };
}

function getMentionItems() {
  const popup = document.querySelector('.mention-popup');
  return popup ? [...popup.querySelectorAll('.mention-popup-item')] : [];
}

function updateMentionSelection(items) {
  items.forEach((el, i) => {
    el.classList.toggle('active', i === mentionState?.selectedIndex);
  });
  const active = mentionState != null ? items[mentionState.selectedIndex] : null;
  if (active) {
    active.scrollIntoView({ block: 'nearest' });
  }
}

function handleMentionInput() {
  const session = getCurrentSession();
  if (!session || session.mode !== SESSION_MODE_WORK) {
    hideMentionPopup();
    return;
  }

  // 单 NPC 模式无需 @ 检测，所有消息默认发给它
  const allNpcs = getSceneNpcs(session);
  const uniqueNpcs = [...new Map(allNpcs.map((n) => [n.name, n])).values()];
  if (uniqueNpcs.length <= 1) {
    hideMentionPopup();
    return;
  }

  const input = els.chatInput;
  const cursorPos = input.selectionStart;
  const text = input.value;
  if (!text) { hideMentionPopup(); return; }

  const mention = resolveDirectMentionTarget(session, text, cursorPos);
  if (mention && mention.atPos >= 0 && !mention.npc) {
    showMentionPopup(mention.atPos, mention.filterText || "");
  } else {
    hideMentionPopup();
  }
}

function getTextCoords(textarea, charIndex) {
  const style = getComputedStyle(textarea);
  const tr = textarea.getBoundingClientRect();

  if (charIndex === 0) {
    return {
      top: tr.top + (parseFloat(style.paddingTop) || 0),
      left: tr.left + (parseFloat(style.paddingLeft) || 0),
    };
  }

  const d = document.createElement('div');
  d.style.cssText = [
    'position:fixed;visibility:hidden;height:auto;overflow:hidden;',
    'white-space:pre-wrap;overflow-wrap:break-word;',
    `top:${tr.top}px;left:${tr.left}px;`,
    `width:${style.width};`,
    `padding-top:${style.paddingTop};padding-left:${style.paddingLeft};`,
    `padding-right:${style.paddingRight};padding-bottom:${style.paddingBottom};`,
    `font-size:${style.fontSize};font-family:${style.fontFamily};`,
    `font-weight:${style.fontWeight};line-height:${style.lineHeight};`,
    `letter-spacing:${style.letterSpacing};`,
    `box-sizing:${style.boxSizing};`,
  ].join('');

  const before = textarea.value.substring(0, charIndex);
  d.innerHTML = before
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
    + '<i style="font-style:normal"></i>';
  document.body.appendChild(d);

  const m = d.querySelector('i').getBoundingClientRect();
  document.body.removeChild(d);

  return {
    top: m.top - textarea.scrollTop,
    left: m.left,
  };
}

function showMentionPopup(atPos, filterText) {
  const session = getCurrentSession();
  if (!session || session.mode !== SESSION_MODE_WORK) {
    hideMentionPopup();
    return;
  }

  const allNpcs = getSceneNpcs(session);
  // Deduplicate by name
  const seen = new Set();
  const filtered = allNpcs.filter(npc => {
    if (seen.has(npc.name)) return false;
    seen.add(npc.name);
    return npc.name.includes(filterText);
  });

  if (!filtered.length) { hideMentionPopup(); return; }

  let popup = document.querySelector('.mention-popup');
  if (!popup) {
    popup = document.createElement('div');
    popup.className = 'mention-popup hidden';
    document.body.appendChild(popup);
  }

  popup.innerHTML = filtered.map((npc, i) =>
    `<div class="mention-popup-item ${i === 0 ? 'active' : ''}" data-name="${escapeHtml(npc.name)}">${escapeHtml(npc.name)}</div>`
  ).join('');

  // Position: 5px above the '@' character
  const coords = getTextCoords(els.chatInput, atPos);
  popup.style.left = coords.left + 'px';
  popup.style.top = '0';
  popup.classList.add('visible');
  popup.classList.remove('hidden');
  // Wait for layout then finalize position
  requestAnimationFrame(() => {
    const h = popup.offsetHeight;
    popup.style.top = (coords.top - 5 - h) + 'px';
    // Clamp to viewport
    const r = popup.getBoundingClientRect();
    const vw = window.innerWidth;
    if (r.right > vw - 4) popup.style.left = (vw - r.width - 8) + 'px';
    if (parseFloat(popup.style.left) < 4) popup.style.left = '4px';
    if (r.top < 0) popup.style.top = (coords.top + 5) + 'px'; // flip below
  });

  // Click selection
  popup.querySelectorAll('.mention-popup-item').forEach(item => {
    item.addEventListener('click', () => insertMention(item.dataset.name));
    item.addEventListener('mouseenter', () => {
      if (!mentionState) return;
      popup.querySelectorAll('.mention-popup-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      mentionState.selectedIndex = [...item.parentNode.children].indexOf(item);
    });
  });

  mentionState = { atPos, filterText, selectedIndex: 0 };
}

function insertMention(name) {
  const input = els.chatInput;
  const text = input.value;
  if (!mentionState) return;
  const atPos = mentionState.atPos;

  // Find end of current filter text
  let endPos = atPos + 1;
  while (endPos < text.length && text[endPos] !== ' ' && text[endPos] !== '\n') {
    endPos++;
  }

  hideMentionPopup();

  const before = text.substring(0, atPos);
  const after = text.substring(endPos);
  input.value = before + '@' + name + ' ' + after;

  const newCursor = before.length + name.length + 2;
  input.setSelectionRange(newCursor, newCursor);
  autoResizeChatInput();
  input.focus();
}

function hideMentionPopup() {
  const popup = document.querySelector('.mention-popup');
  if (popup) {
    popup.classList.remove('visible');
    popup.classList.add('hidden');
  }
  mentionState = null;
}

// 控制台工具：
//   __msg(n)         — 全局第 n 条详情（1-based, 非 system）
//   __msg(g, w)      — 全局第 g 条 = 可见窗口内第 w 条，验证对应关系
window.__msg = function (g, w) {
  var session = getCurrentSession();
  if (!session) return console.warn("[__msg] 没有当前会话");
  var msgs = session.messages.filter(function (m) { return m && m.role !== "system" && m.content && !m.pending; });
  var total = msgs.length;
  var windowSize = 30;
  var windowStart = Math.max(1, total - windowSize + 1);

  // 单参数：原行为
  if (w === undefined) {
    if (g < 1 || g > total) return console.warn("[__msg] 序号超出范围，共 " + total + " 条可见消息");
    var msg = msgs[g - 1];
    var inWin = g >= windowStart ? "第 " + (g - windowStart + 1) + "/30" : "窗口外";
    console.log("[__msg] 全局第 " + g + "/" + total + " 条（窗口内 " + inWin + "）:", {
      role: msg.role,
      speaker: msg.speaker || (msg.role === "user" ? "你" : "AI"),
      uiType: msg.uiType || "normal",
      createdAt: msg.createdAt,
      sequence: msg.sequence,
      id: msg.id,
      content: msg.content,
    });
    return msg;
  }

  // 双参数：g = 全局第几条, w = 30条窗口里第几条
  // 验证全局索引 g 是否恰好等于 windowStart + w - 1
  var expectedGlobal = windowStart + w - 1;
  if (g !== expectedGlobal) {
    console.warn("[__msg] 对不上: 全局第 " + g + " 条 ≠ 窗口第 " + w + " 条（窗口从 " + windowStart + " 开始，窗口第 " + w + " 条 = 全局第 " + expectedGlobal + " 条）");
    // 仍然打印两条各自的信息方便对比
    if (g >= 1 && g <= total) {
      var msgG = msgs[g - 1];
      console.log("[__msg] 全局第 " + g + ": [" + (msgG.role === "user" ? "用户" : (msgG.speaker || "AI")) + "] " + (msgG.content || "").slice(0, 200));
    }
    if (w >= 1 && w <= windowSize && windowStart + w - 1 <= total) {
      var msgW = msgs[windowStart + w - 2];
      console.log("[__msg] 窗口第 " + w + ": [" + (msgW.role === "user" ? "用户" : (msgW.speaker || "AI")) + "] " + (msgW.content || "").slice(0, 200));
    }
    return;
  }

  // 对上了，打印这条消息
  var msg = msgs[g - 1];
  console.log("[__msg] ✓ 全局第 " + g + " = 窗口第 " + w + "/30" + ":", {
    role: msg.role,
    speaker: msg.speaker || (msg.role === "user" ? "你" : "AI"),
    uiType: msg.uiType || "normal",
    createdAt: msg.createdAt,
    sequence: msg.sequence,
    id: msg.id,
    content: msg.content,
  });
  return msg;
};
