"use strict";

var hoveredAgentToolsMessageId = null;
var hoveredAgentToolsCloseTimer = null;
var AGENT_TOOLS_HOVER_CLOSE_DELAY_MS = 700;
var openAssistantRetryMenuMessageId = null;

function closeAssistantRetryMenu() {
  if (!openAssistantRetryMenuMessageId) return;
  const host = els.chatMessages?.querySelector(
    `[data-message-id="${openAssistantRetryMenuMessageId}"]`
  );
  host?.classList.remove("retry-menu-open");
  const trigger = host?.querySelector('[data-action="retry-assistant"]');
  trigger?.setAttribute("aria-expanded", "false");
  host?.querySelector(".message-retry-menu")?.classList.remove("open");
  openAssistantRetryMenuMessageId = null;
}

function toggleAssistantRetryMenu(host, messageId) {
  if (!host || !messageId) return;
  const shouldOpen = openAssistantRetryMenuMessageId !== messageId;
  closeAssistantRetryMenu();
  if (!shouldOpen) return;

  openAssistantRetryMenuMessageId = messageId;
  host.classList.add("retry-menu-open");
  host.querySelector('[data-action="retry-assistant"]')?.setAttribute("aria-expanded", "true");
  host.querySelector(".message-retry-menu")?.classList.add("open");
}

document.addEventListener("pointerdown", (event) => {
  if (openAssistantRetryMenuMessageId && !event.target.closest(".message-retry-control")) {
    closeAssistantRetryMenu();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeAssistantRetryMenu();
});

function supportsAgentToolsHoverLock() {
  return Boolean(window.matchMedia?.("(hover: hover) and (pointer: fine)").matches);
}

function openAgentToolsHoverLock(block, messageId) {
  if (!supportsAgentToolsHoverLock() || !block || !messageId) return;
  if (hoveredAgentToolsCloseTimer) {
    clearTimeout(hoveredAgentToolsCloseTimer);
    hoveredAgentToolsCloseTimer = null;
  }
  if (hoveredAgentToolsMessageId && hoveredAgentToolsMessageId !== messageId) {
    els.chatMessages
      ?.querySelector(`[data-message-id="${hoveredAgentToolsMessageId}"]`)
      ?.classList.remove("tools-hovering");
  }
  hoveredAgentToolsMessageId = messageId;
  block.classList.add("tools-hovering");
}

function scheduleAgentToolsHoverUnlock(block, messageId) {
  if (!supportsAgentToolsHoverLock() || !block || !messageId) return;
  if (hoveredAgentToolsCloseTimer) clearTimeout(hoveredAgentToolsCloseTimer);
  hoveredAgentToolsCloseTimer = setTimeout(() => {
    hoveredAgentToolsCloseTimer = null;
    if (block.matches(":hover")) return;
    block.classList.remove("tools-hovering");
    if (hoveredAgentToolsMessageId === messageId) {
      hoveredAgentToolsMessageId = null;
    }
  }, AGENT_TOOLS_HOVER_CLOSE_DELAY_MS);
}

function bindAgentToolsHoverLock(block, message) {
  if (!block || message?.role !== "assistant" || !message.id || block.dataset.toolsHoverBound === "1") {
    return;
  }
  block.dataset.toolsHoverBound = "1";
  block.addEventListener("pointerenter", () => openAgentToolsHoverLock(block, message.id));
  block.addEventListener("pointermove", () => openAgentToolsHoverLock(block, message.id));
  block.addEventListener("pointerleave", () => scheduleAgentToolsHoverUnlock(block, message.id));
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

function getModelProviderIcon(session, speakerName) {
  if (!session || !speakerName) return null;
  const allNpcs = getSceneNpcs(session);
  const resolvedName = resolveNpcSpeakerName(session, speakerName);
  const npc = allNpcs.find((n) => n.name === resolvedName);
  if (!npc?.model) return null;
  const provider = detectModelProvider(npc.model);
  return provider ? provider.icon : null;
}

function resolveNpcSpeakerName(session, speakerName) {
  const speaker = String(speakerName || "");
  if (!session || !speaker) return speaker;
  const allNpcs = getSceneNpcs(session);
  if (allNpcs.some((npc) => npc.name === speaker)) return speaker;

  const aliases = session.npcNameAliases || {};
  let resolved = speaker;
  const visited = new Set();
  while (aliases[resolved] && !visited.has(resolved)) {
    visited.add(resolved);
    resolved = aliases[resolved];
  }
  if (allNpcs.some((npc) => npc.name === resolved)) return resolved;

  const currentNames = new Set(allNpcs.map((npc) => npc.name));
  const unmatchedSpeakers = [...new Set((session.messages || [])
    .filter((message) => message?.role === "assistant" && message.speaker && message.speaker !== "导演 AI")
    .map((message) => message.speaker)
    .filter((name) => !currentNames.has(name)))];
  const matchedCurrentNames = new Set((session.messages || [])
    .filter((message) => message?.role === "assistant" && currentNames.has(message.speaker))
    .map((message) => message.speaker));
  const unmatchedNpcs = allNpcs.filter((npc) => !matchedCurrentNames.has(npc.name));
  if (unmatchedSpeakers.length === 1 && unmatchedNpcs.length === 1 && unmatchedSpeakers[0] === speaker) {
    const inferredName = unmatchedNpcs[0].name;
    session.npcNameAliases = { ...(session.npcNameAliases || {}), [speaker]: inferredName };
    (session.messages || []).forEach((message) => {
      if (message?.role === "assistant" && message.speaker === speaker) {
        message.speaker = inferredName;
      }
    });
    if (!session._npcAliasRepairPending && window.__chatDB?.renameSessionSpeakers) {
      session._npcAliasRepairPending = true;
      window.__chatDB.renameSessionSpeakers(session.id, { [speaker]: inferredName })
        .catch((error) => debugWarn("[chat-ui] NPC alias repair failed", error))
        .finally(() => {
          session._npcAliasRepairPending = false;
          persistSessions();
        });
    }
    return inferredName;
  }
  return speaker;
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
  updateStreamingIndicator();
}

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
  if (Number.isFinite(message?.sequence)) {
    return message.sequence;
  }
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
  const cutoff = Number(session.compressedUntilSequence);
  const hasStaleCompressedBranch = Number.isFinite(cutoff) && cutoff >= total;
  if (hasStaleCompressedBranch) {
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
    if (window.__chatDB.saveSession) {
      await window.__chatDB.saveSession(session);
    }
  }

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

  // 修正：如果实际加载数少于预期（stale messageCount），同步为实际值
  if (recent.length < Math.min(total, desired)) {
    session.messageCount = recent.length;
    session.loadedStartSequence = 0;
  }
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

function startPlaceholderRotation() {
  const SPEED_TYPING = 50;
  const SPEED_DELETING = 40;
  const DISPLAY_MS = 6000;

  function buildTips() {
    const session = getCurrentSession();
    const isStory = session?.mode === SESSION_MODE_STORY;
    const tips = [
      t("chat.tip1"),
      t("chat.tip2"),
      t("chat.tip3"),
      t("chat.tip4"),
    ];
    if (!isStory) {
      tips.splice(1, 0, t("chat.tipAt"));
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
      ? 108
      : window.matchMedia("(max-width: 960px)").matches
        ? 130
        : 184
  );

  el.style.height = "auto";
  const nextHeight = Math.max(minHeight, Math.min(el.scrollHeight, maxHeight));
  el.style.height = `${nextHeight}px`;
  el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  recalcUserTopAnchorSpacer();
}

function updateComposerMode() {
  const composer = els.chatInput?.closest(".composer");
  const composerShell = els.chatInput?.closest(".composer-shell");
  const currentSession = getCurrentSession();
  const isChaos = currentSession?.mode === SESSION_MODE_CHAOS;

  // 混沌模式：隐藏状态栏、压缩和思考按钮
  const chaosStatusBar = els.chatStatus?.closest(".composer-status-bar");
  if (chaosStatusBar) chaosStatusBar.classList.toggle("hidden", isChaos);
  if (els.compressMemoryBtn) els.compressMemoryBtn.classList.toggle("hidden", isChaos);
  if (els.thinkingToggleBtn) els.thinkingToggleBtn.classList.toggle("hidden", isChaos);
  if (isChaos && els.thinkingPopover) els.thinkingPopover.classList.add("hidden");

  // 输出中 → 暂停按钮优先于一切（混沌模式除外，保持发送箭头）
  if (state.isSending) {
    if (!isChaos) {
      els.sendBtn.innerHTML = '<i data-lucide="square"></i>';
      lucide.createIcons();
      els.sendBtn.disabled = false;
      els.sendBtn.classList.add("sending");
    }
    els.chatInput.classList.remove("editing");
    if (composer) composer.classList.remove("editing");
    if (composerShell) composerShell.classList.remove("editing");
    if (els.cancelEditBtn) els.cancelEditBtn.classList.add("hidden");
    if (els.compressMemoryBtn) els.compressMemoryBtn.disabled = true;
    setText(els.chatStatus, state.chatInlineStatus || t("chat.statusProcessing"));
    return;
  }

  if (state.editingUserMessageId) {
    els.sendBtn.innerHTML = '<i data-lucide="check"></i>';
    lucide.createIcons();
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

  els.sendBtn.classList.remove("sending");
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
    els.compressMemoryBtn.disabled = state.isSending || !currentSession || currentSession.mode === SESSION_MODE_CHAOS;
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
    const saved = getSessionSetting(currentSession, "modelThinking") || "disabled";
    els.modelThinkingBtn.dataset.state = saved;
    updateModelThinkingBtn();
  }
  updateThinkingToggleMode();
  renderCompressMemoryPopover();
  els.sendBtn.innerHTML = '<i data-lucide="arrow-up"></i>';
  lucide.createIcons();
  setText(els.chatStatus, state.isSending ? t("chat.statusProcessing") : t("chat.statusReady"));
  updateSuggestBtn();
}

function setInlineChatStatus(message) {
  state.chatInlineStatus = String(message || "").trim();
  setText(els.chatStatus, state.chatInlineStatus || t("chat.statusProcessing"));
}

function clearInlineChatStatus() {
  state.chatInlineStatus = "";
}

function formatNpcNamesForStatus(group) {
  const names = (Array.isArray(group) ? group : [])
    .map((npc) => npc?.name)
    .filter(Boolean);
  return names.join("、");
}

function getNpcGroupDebugLabel(groups) {
  const list = Array.isArray(groups) ? groups : [];
  const hasParallelGroup = list.some((group) => Array.isArray(group) && group.length > 1);
  return hasParallelGroup ? "NPC 并行分组" : "NPC 串行顺序";
}

function normalizeUserMessageDisplayText(value) {
  if (Array.isArray(value)) {
    var textParts = value.filter(function (p) { return p.type === "text"; }).map(function (p) { return p.text; });
    return String(textParts.join("") || "").replace(/\n{3,}/g, "\n\n");
  }
  return String(value || "").replace(/\n{3,}/g, "\n\n");
}

function extractImageAttachments(content) {
  if (!Array.isArray(content)) return [];
  return content.filter(function (p) { return p.type === "image_url"; });
}

function extractTextAttachments(content) {
  if (!Array.isArray(content)) return [];
  return content.filter(function (part) { return part?.type === "file_text"; });
}

function formatAttachmentSize(bytes) {
  var size = Math.max(0, Number(bytes || 0));
  var exactBytes = Math.round(size).toLocaleString("zh-CN") + " B";
  if (size < 1024) return exactBytes;
  if (size < 1024 * 1024) {
    return (size / 1024).toFixed(2).replace(/\.?0+$/, "") + " KB (" + exactBytes + ")";
  }
  return (size / 1024 / 1024).toFixed(2).replace(/\.?0+$/, "") + " MB (" + exactBytes + ")";
}

function buildBubbleContent(message) {
  const session = getCurrentSession();
  const sessionMode = session?.mode || SESSION_MODE_STORY;
  let html = "";
  const thinkingText = (message.thinking || "").trim();
  if (thinkingText) {
    html += `<details class="thinking-section"${message.streaming || message.thinkingExpanded ? " open" : ""}>`;
    html += `<summary><span class="thinking-label">${t("chat.thinkingLabel")}</span></summary>`;
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
  const enableMd = message.role === "assistant" && sessionMode === SESSION_MODE_WORK && getSessionSetting(getCurrentSession(), "markdownRender") !== false;
  const content = message.role === "user"
    ? normalizeUserMessageDisplayText(message.content)
    : message.content;

  if (enableMd) {
    html += renderMarkdownContent(escapeHtml(content));
  } else if (message.role === "assistant" && sessionMode === SESSION_MODE_WORK) {
    html += renderWorkPlainTextContent(escapeHtml(content));
  } else if (sessionMode === SESSION_MODE_STORY) {
    html += renderStoryContent(escapeHtml(content));
  } else {
    html += escapeHtml(content).replace(/\n/g, "<br>");
  }
  return html;
}

function renderWorkPlainTextContent(text) {
  if (!text) return "";
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${part.replace(/\n/g, "<br>")}</p>`)
    .join("");
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

function buildNarrationContent(message) {
  if (!message) return "";
  const narrationText = sanitizeNarrationText(message.content);
  let html = buildToolTraceSection(message);
  if (message.pending) {
    return html + `<span class="typing-row"><span></span><span></span><span></span></span>`;
  }
  if (message.retrieving) {
    return html;
  }
  if (narrationText) {
    html += escapeHtml(narrationText).replace(/\n/g, "<br>");
  }
  return html;
}

function buildToolTracePreviewDetail(text, limit = 1200) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  if (raw.length <= limit) return raw;
  return `${raw.slice(0, limit)}\n...(truncated)`;
}

function wrapCodeLines(el) {
  if (getSessionSetting("showLineNumbers") !== true) return;
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
      debugInfo('[LN] total=' + lines.length + ' tail=' + tail.join(', '));
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

    bubble.querySelectorAll("img").forEach(function (image) {
      image.classList.add("chat-content-image");
      image.alt = image.alt || "会话图片";
      image.title = "点击查看大图";
      image.setAttribute("role", "button");
      image.tabIndex = 0;
    });

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
    const enableMd = sessionMode === SESSION_MODE_WORK && getSessionSetting(session, "markdownRender") !== false;
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
          function copyDone() {
            btn.className = 'code-copy-btn copied';
            btn.innerHTML = '<i data-lucide="check"></i>';
            lucide.createIcons();
            setTimeout(() => {
              btn.className = 'code-copy-btn';
              btn.innerHTML = '<i data-lucide="clipboard"></i>';
              lucide.createIcons();
            }, 1500);
          }
          copyToClipboard(code, copyDone);
        });
      });
    }
    const isSingleLine = !targetMessage.pending && !/[\r\n]/.test(targetMessage.content || "");
    bubble.classList.toggle('single-line', isSingleLine);
    applyStreamingTailFade(bubble, targetMessage);
    syncStreamingTtsForMessage(targetMessage);
  }

  // streaming 过程中用户消息钉在视口顶部
  if (state.userTopAnchorActive && state.isSending) {
    recalcUserTopAnchorSpacer();
  }
}

var _streamingTailFadeTimers = new WeakMap();

function clearStreamingTailFade(bubble) {
  var timer = _streamingTailFadeTimers.get(bubble);
  if (timer) clearTimeout(timer);
  _streamingTailFadeTimers.delete(bubble);

  bubble.querySelectorAll(".tail-wrap").forEach(function (wrap) {
    wrap.replaceWith(document.createTextNode(wrap.textContent || ""));
  });
  bubble.normalize();
}

function applyStreamingTailFade(bubble, message) {
  clearStreamingTailFade(bubble);
  if (!message.streaming) return;
  var session = getCurrentSession();
  if (!session || session.mode !== SESSION_MODE_WORK) return;

  var FADE_COUNT = 8;
  var textNodes = [];
  var walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT, null, false);
  var node;
  while (node = walker.nextNode()) {
    var p = node.parentNode;
    while (p && p !== bubble) {
      if (p.tagName === 'CODE' || p.tagName === 'PRE') { node = null; break; }
      p = p.parentNode;
    }
    if (node) textNodes.push(node);
  }
  if (textNodes.length === 0) return;

  var lastNode = textNodes[textNodes.length - 1];
  var text = lastNode.textContent;
  if (text.length < FADE_COUNT) return;

  var splitAt = text.length - FADE_COUNT;
  var before = text.slice(0, splitAt);
  var tail = text.slice(splitAt);

  var fragment = document.createDocumentFragment();
  fragment.appendChild(document.createTextNode(before));
  var wrap = document.createElement('span');
  wrap.className = 'tail-wrap';
  wrap.textContent = tail;
  fragment.appendChild(wrap);
  lastNode.parentNode.replaceChild(fragment, lastNode);

  // 网络停顿时也要恢复完整可读状态，不能依赖下一次流式重绘来清除遮罩。
  var timer = setTimeout(function () {
    if (wrap.isConnected) {
      wrap.replaceWith(document.createTextNode(wrap.textContent || ""));
      bubble.normalize();
    }
    _streamingTailFadeTimers.delete(bubble);
  }, 240);
  _streamingTailFadeTimers.set(bubble, timer);
}

function createStreamBatchController(targetMessage, revealFn, updateFn) {
  const CHAR_THRESHOLD = 3;
  const THINKING_THRESHOLD = 3;
  const TIME_THRESHOLD_MS = 8;
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
  const slice = (session?.messages || []).slice(windowState.start);
  // 按 messageId 去重，兜底防止重复渲染
  var seen = {};
  return slice.filter(function (m) {
    if (!m || !m.id) return true;
    if (seen[m.id]) return false;
    seen[m.id] = true;
    return true;
  });
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
  const enableMd = sessionMode === SESSION_MODE_WORK && getSessionSetting(session, "markdownRender") !== false;
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

  const desiredNodes = [];

  renderedMessages.forEach((message) => {
    // _noBubble: 技能回答等静默消息，不渲染气泡
    if (message._noBubble) return;
    // system-notice: no stable ID, always rebuild (rare, not worth diffing)
    if (message.uiType === "system-notice") {
      const notice = document.createElement("div");
      notice.className = "system-notice";
      notice.innerHTML = escapeHtml(message.content).replace(/\n/g, "<br>");
      desiredNodes.push(notice);
      return;
    }

    if (message.uiType === "narration") {
      const existing = message.id ? oldNodes.get(message.id) : null;
      if (existing) {
        oldNodes.delete(message.id);
        refreshNarrationNode(existing, message);
        desiredNodes.push(existing);
      } else {
        const node = buildNarrationNode(message);
        if (node) desiredNodes.push(node);
      }
      return;
    }

    // Regular user / assistant message
    const existing = message.id ? oldNodes.get(message.id) : null;
    if (existing) {
      oldNodes.delete(message.id);
      refreshMessageBlock(existing, message, sessionMode, enableMd);
      desiredNodes.push(existing);
    } else {
      const block = buildMessageBlock(message, sessionMode, enableMd);
      if (block) desiredNodes.push(block);
    }
  });

  // Remove stale nodes (truncated or replaced messages)
  for (const [, node] of oldNodes) node.remove();

  // Keep stable message nodes mounted so hover/focus is not lost during streaming refreshes.
  desiredNodes.forEach((node, index) => {
    const currentNode = els.chatMessages.childNodes[index] || null;
    if (currentNode !== node) {
      els.chatMessages.insertBefore(node, currentNode);
    }
  });
  const desiredNodeSet = new Set(desiredNodes);
  Array.from(els.chatMessages.childNodes).forEach((node) => {
    if (!desiredNodeSet.has(node)) node.remove();
  });

  if (preserveScrollOnPrepend) {
    const heightDelta = scrollEl.scrollHeight - previousScrollHeight;
    scrollEl.scrollTop = previousScrollTop + Math.max(0, heightDelta);
    return;
  }

  // --- Scroll handling (unchanged) ---
  if (shouldStickToBottom) {
    if (state.userTopAnchorActive && state.isSending) {
      recalcUserTopAnchorSpacer();
      updateStreamingIndicator();
      return;
    }
    if (!state.userScrolledAway) {
      clearUserTopAnchorSpacer();
      scrollEl.scrollTop = scrollEl.scrollHeight;
      state.userScrolledAway = false;
    } else {
      clearUserTopAnchorSpacer();
    }
    lucide.createIcons();
    updateStreamingIndicator();
    return;
  }

  const heightDelta = scrollEl.scrollHeight - previousScrollHeight;
  scrollEl.scrollTop = previousScrollTop + Math.max(0, heightDelta);
  lucide.createIcons();
  updateStreamingIndicator();
}

/* ---- Narration helpers ---- */
function buildNarrationNode(message) {
  const narrationText = sanitizeNarrationText(message.content);
  const tokenLabel = buildMessageTokenLabel(message);
  const wrapper = document.createElement("article");
  wrapper.className = `narration-block ${state.openAgentTokenInfoId === message.id ? "token-open" : ""} ${openAssistantRetryMenuMessageId === message.id ? "retry-menu-open" : ""}`.trim();
  if (message.id) wrapper.dataset.messageId = message.id;
  const narration = document.createElement("div");
  const isSingleLine = !message.pending && narrationText && !/[\r\n]/.test(narrationText);
  narration.className = `narration ${message.pending ? "pending" : ""} ${message.streaming ? "streaming" : ""} ${isSingleLine ? "single-line" : ""}`.trim();
  narration.innerHTML = buildNarrationContent(message);
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
    const turnTools = buildNarrationTurnTools(message);
    if (turnTools) wrapper.appendChild(turnTools);
  }
  return wrapper;
}

function refreshNarrationNode(wrapper, message) {
  const narrationText = sanitizeNarrationText(message.content);
  const tokenLabel = buildMessageTokenLabel(message);
  wrapper.className = `narration-block ${state.openAgentTokenInfoId === message.id ? "token-open" : ""} ${openAssistantRetryMenuMessageId === message.id ? "retry-menu-open" : ""}`.trim();
  const bubble = wrapper.querySelector('.narration');
  if (bubble) {
    const isSingleLine = !message.pending && narrationText && !/[\r\n]/.test(narrationText);
    bubble.className = `narration ${message.pending ? "pending" : ""} ${message.streaming ? "streaming" : ""} ${isSingleLine ? "single-line" : ""}`.trim();
    const body = buildNarrationContent(message);
    if (bubble.innerHTML !== body) bubble.innerHTML = body;
  }
  const tokenBar = wrapper.querySelector('.message-token-bar');
  if (tokenBar) {
    tokenBar.className = `message-token-bar narration-token-bar ${tokenLabel ? "has-token" : ""}`.trim();
    tokenBar.textContent = tokenLabel;
  }
  const existingTurnTools = wrapper.querySelector(".narration-turn-tools");
  if (existingTurnTools) {
    syncLatestTurnVariantNav(existingTurnTools, message);
    syncAssistantRetryButton(existingTurnTools, message);
    const actionGroup = existingTurnTools.querySelector(".message-tools-actions");
    if (!actionGroup?.children.length) existingTurnTools.remove();
  } else {
    const nextTurnTools = buildNarrationTurnTools(message);
    if (nextTurnTools) wrapper.appendChild(nextTurnTools);
    lucide.createIcons();
  }
}

/* ---- Message block helpers ---- */
function shouldHideSkillGroupTools(message, session = getCurrentSession()) {
  if (!message?.id || !Array.isArray(session?.messages)) return false;
  return session.messages.some((candidate) => candidate?._skillContinuationOf === message.id);
}

function buildMessageBlock(message, sessionMode, enableMd) {
  const block = document.createElement("article");
  const isAgentPlainBlock = sessionMode === SESSION_MODE_WORK && message.role === "assistant";
  const isSkillContinuation = Boolean(message._skillContinuationOf);
  const modeClass = sessionMode === SESSION_MODE_WORK ? "work-mode" : sessionMode === SESSION_MODE_CHAOS ? "chaos-mode" : "story-mode";
  block.className = `message-block ${message.role === "user" ? "user" : message.role === "assistant" ? "agent" : "system"} ${isAgentPlainBlock ? "agent-plain-block" : ""} ${isSkillContinuation ? "skill-continuation" : ""} ${modeClass} ${state.openUserMessageToolsId === message.id || state.openAgentTokenInfoId === message.id ? "tools-open" : ""} ${state.openAgentTokenInfoId === message.id ? "token-open" : ""} ${hoveredAgentToolsMessageId === message.id ? "tools-hovering" : ""} ${openAssistantRetryMenuMessageId === message.id ? "retry-menu-open" : ""}`.trim();
  if (message.id) block.dataset.messageId = message.id;
  bindAgentToolsHoverLock(block, message);

  if ((message.role === "assistant" || message.role === "user") && !isSkillContinuation) {
    const meta = document.createElement("div");
    meta.className = "message-meta";
    const session = getCurrentSession();
    const displaySpeaker = message.role === "assistant"
      ? resolveNpcSpeakerName(session, message.speaker)
      : message.speaker;
    let metaHtml = `\n        <strong>${escapeHtml(displaySpeaker)}</strong>`;
    if (message.role === "assistant") {
      const iconUrl = getModelProviderIcon(session, message.speaker);
      if (iconUrl && getSessionSetting(session, "showModelProviderIcon") !== false) {
        metaHtml = `\n        <img class="model-provider-icon" src="${iconUrl}" alt="">${metaHtml}`;
      }
    }
    metaHtml += `\n        <span>${new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>\n      `;
    meta.innerHTML = metaHtml;
    block.appendChild(meta);
    syncMessageThinkingIcon(block, message);
  }

  if (message.role === "user" && Array.isArray(message.content)) {
    var images = extractImageAttachments(message.content);
    if (images.length) {
      var imgWrap = document.createElement("div");
      imgWrap.className = "message-images";
      images.forEach(function (img) {
        var imgEl = document.createElement("img");
        imgEl.className = "message-image";
        imgEl.src = img.image_url.url;
        imgEl.alt = "会话图片";
        imgEl.title = "点击查看大图";
        imgEl.setAttribute("role", "button");
        imgEl.tabIndex = 0;
        imgEl.loading = "lazy";
        imgWrap.appendChild(imgEl);
      });
      block.appendChild(imgWrap);
    }

    var textFiles = extractTextAttachments(message.content);
    if (textFiles.length) {
      var fileWrap = document.createElement("div");
      fileWrap.className = "message-files";
      textFiles.forEach(function (part) {
        var file = part.file_text || {};
        var card = document.createElement("div");
        card.className = "message-file-card";
        card._textFile = file;
        card.setAttribute("role", "button");
        card.setAttribute("aria-label", "预览 TXT 文件 " + String(file.name || "附件.txt"));
        card.title = "点击预览 TXT 文件";
        card.tabIndex = 0;

        var icon = document.createElement("i");
        icon.setAttribute("data-lucide", "file-text");
        icon.className = "message-file-icon";

        var copy = document.createElement("span");
        copy.className = "message-file-copy";
        var name = document.createElement("strong");
        name.textContent = String(file.name || "附件.txt");
        var meta = document.createElement("small");
        meta.textContent = "TXT · " + formatAttachmentSize(file.size);
        copy.append(name, meta);

        card.append(icon, copy);
        fileWrap.appendChild(card);
      });
      block.appendChild(fileWrap);
    }
  }

  const isSingleLineMessage = !message.pending && !/[\r\n]/.test(message.content || "");
  const isWorkAgent = sessionMode === SESSION_MODE_WORK && message.role === "assistant";
  const bubble = document.createElement("div");
  bubble.className = `message ${message.role === "user" ? "user" : message.role === "system" ? "system" : "agent"} ${message.pending ? "pending" : ""} ${message.streaming ? "streaming" : ""} ${isSingleLineMessage ? "single-line" : ""} ${isWorkAgent ? "agent-plain" : ""}`.trim();

  if (message.pending) {
    bubble.innerHTML = `<span class="typing-row"><span></span><span></span><span></span></span>`;
  } else {
    bubble.innerHTML = buildBubbleContent(message);
    bubble.querySelectorAll("img").forEach(function (image) {
      image.classList.add("chat-content-image");
      image.alt = image.alt || "会话图片";
      image.title = "点击查看大图";
      image.setAttribute("role", "button");
      image.tabIndex = 0;
    });
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
  // 技能标识开始后先缓冲，标识前的普通文本照常显示；闭合后再渲染卡片。
  if (message.role === "assistant" && !message.uiType) {
    const skillState = typeof getSkillResponseRenderState === "function"
      ? getSkillResponseRenderState(message.content)
      : null;
    const skillData = skillState?.skillData || null;
    const skillResult = skillState?.skillResult || null;

    if (skillState && skillState.buffering) {
      const displayMessage = { ...message, content: skillState.visibleText };
      bubble.innerHTML = skillState.visibleText ? buildBubbleContent(displayMessage) : "";
      bubble.style.display = skillState.visibleText ? "" : "none";
      block.appendChild(bubble);

      const card = skillData && typeof renderSkillCard === "function"
        ? renderSkillCard(skillData, message.id)
        : skillResult && typeof renderSkillResult === "function"
          ? renderSkillResult(skillResult)
          : null;
      if (card) block.appendChild(card);
      const transcript = typeof renderSkillAnswerTranscript === "function"
        ? renderSkillAnswerTranscript(message._skillAnswer)
        : null;
      if (transcript) block.appendChild(transcript);

      bindInlineMetaToggles(block, message);
      if (message.id && !message.pending && !shouldHideSkillGroupTools(message)) {
        block.appendChild(buildMessageTools(message));
      }
      return block;
    }
  }

  block.appendChild(bubble);

  bindInlineMetaToggles(block, message);

  if (message.id && !message.pending && !shouldHideSkillGroupTools(message)) {
    block.appendChild(buildMessageTools(message));
  }

  return block;
}

function syncMessageModelProviderIcon(block, message, session = getCurrentSession()) {
  if (!block || message?.role !== "assistant") return;
  const meta = block.querySelector('.message-meta');
  if (!meta) return;
  const speakerNode = meta.querySelector("strong");
  const displaySpeaker = resolveNpcSpeakerName(session, message.speaker);
  if (speakerNode && speakerNode.textContent !== displaySpeaker) {
    speakerNode.textContent = displaySpeaker;
  }
  const iconUrl = getModelProviderIcon(session, message.speaker);
  const showIcon = iconUrl && getSessionSetting(session, "showModelProviderIcon") !== false;
  const existingIcon = meta.querySelector('.model-provider-icon');
  if (showIcon && !existingIcon) {
    const img = document.createElement('img');
    img.className = 'model-provider-icon';
    img.src = iconUrl;
    img.alt = '';
    meta.prepend(img);
  } else if (!showIcon && existingIcon) {
    existingIcon.remove();
  } else if (showIcon && existingIcon && existingIcon.getAttribute("src") !== iconUrl) {
    existingIcon.setAttribute("src", iconUrl);
  }
}

function initAiThinkingIcon(el) {
  if (!el || el.dataset._aiInit) return;
  el.dataset._aiInit = '1';
  el.innerHTML = `
    <i class="corner"></i><i></i><i></i><i class="corner"></i>
    <i></i><i></i><i></i><i></i>
    <i></i><i></i><i></i><i></i>
    <i class="corner"></i><i></i><i></i><i class="corner"></i>
  `;
  const cells = [...el.children];
  const cores = [5,6,10,9];
  const edges = [1,2,7,11,14,13,8,4];
  const speed = parseFloat(el.style.getPropertyValue('--ai-speed')) || 1;
  const from = hex(el.style.getPropertyValue('--ai-from') || '#111');
  const to = hex(el.style.getPropertyValue('--ai-to') || '#fff');
  function hex(v) {
    v = (v || '#333').trim().replace('#','');
    if (v.length === 3) v = v.split('').map(x => x + x).join('');
    const n = parseInt(v, 16);
    return [(n>>16)&255, (n>>8)&255, n&255];
  }
  function mix(a,b,t) { return a.map((v,i) => v + (b[i] - v) * t); }
  function dist(a,b,l) { const d = Math.abs(a - b); return Math.min(d, l - d); }
  let running = true;
  el._stop = function() { running = false; };
  function render(t) {
    if (!running) return;
    if (!el.isConnected) { running = false; return; }
    const cp = (t * 0.0028 * speed) % 4;
    const dp = (t * 0.0024 * speed + 2.5) % 8;
    cores.forEach((idx,i) => {
      const light = Math.exp(-(dist(i,cp,4)**2)*2.8);
      const c = mix(from, to, .08 + light * .65);
      cells[idx].style.background = 'rgb(' + c.join(',') + ')';
    });
    edges.forEach((idx,i) => {
      const dark = Math.exp(-(dist(i,dp,8)**2)*1.1);
      const wave = Math.sin(t * 0.004 * speed + i) * .08;
      const c = mix(from, to, .88 + wave - dark * .62);
      cells[idx].style.background = 'rgb(' + c.join(',') + ')';
    });
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}

function syncMessageThinkingIcon(block, message) {
  // moved to status bar — clean up any leftover icon in meta
  const existing = block?.querySelector('.message-meta .ai-thinking-icon');
  if (existing) existing.remove();
}

function updateStreamingIndicator() {
  const session = getCurrentSession();
  if (!session || session.mode !== SESSION_MODE_WORK) return;
  const isBusy = state.isSending || session.messages?.some(function(m) { return m.streaming || m.pending; }) || false;
  const suggestBtn = document.getElementById('suggestBtn');
  const thinkingIcon = document.getElementById('statusBarThinkingIcon');
  if (!suggestBtn || !thinkingIcon) return;
  if (isBusy) {
    suggestBtn.style.display = 'none';
    thinkingIcon.style.display = '';
    initAiThinkingIcon(thinkingIcon);
  } else {
    suggestBtn.style.display = '';
    thinkingIcon.style.display = 'none';
  }
}
window.__updateStreamingIndicator = updateStreamingIndicator;

function syncModelProviderIconVisibility(session = getCurrentSession()) {
  if (!session || !els.chatMessages) return;
  const messagesById = new Map((session.messages || []).filter(Boolean).map((message) => [message.id, message]));
  els.chatMessages.querySelectorAll(".message-block.agent[data-message-id]").forEach((block) => {
    syncMessageModelProviderIcon(block, messagesById.get(block.dataset.messageId), session);
    syncMessageThinkingIcon(block, messagesById.get(block.dataset.messageId));
  });
}

function refreshMessageBlock(block, message, sessionMode, enableMd) {
  // 1. Update block-level className
  const isAgentPlainBlock = sessionMode === SESSION_MODE_WORK && message.role === "assistant";
  const modeClass = sessionMode === SESSION_MODE_WORK ? "work-mode" : sessionMode === SESSION_MODE_CHAOS ? "chaos-mode" : "story-mode";
  block.className = `message-block ${message.role === "user" ? "user" : message.role === "assistant" ? "agent" : "system"} ${isAgentPlainBlock ? "agent-plain-block" : ""} ${message._skillContinuationOf ? "skill-continuation" : ""} ${modeClass} ${state.openUserMessageToolsId === message.id || state.openAgentTokenInfoId === message.id ? "tools-open" : ""} ${state.openAgentTokenInfoId === message.id ? "token-open" : ""} ${hoveredAgentToolsMessageId === message.id ? "tools-hovering" : ""} ${openAssistantRetryMenuMessageId === message.id ? "retry-menu-open" : ""}`.trim();
  bindAgentToolsHoverLock(block, message);

  // 2. Update bubble className + content
  const bubble = block.querySelector('.message');
  if (!bubble) return;

  // 技能标识开始后停止向普通文本区域追加，直到完整卡片数据到齐。
  if (message.role === "assistant" && !message.uiType) {
    const skillState = typeof getSkillResponseRenderState === "function"
      ? getSkillResponseRenderState(message.content)
      : null;

    if (skillState && skillState.buffering) {
      const displayMessage = { ...message, content: skillState.visibleText };
      const visibleContent = skillState.visibleText;
      bubble.className = `message agent ${message.streaming ? "streaming" : ""} ${sessionMode === SESSION_MODE_WORK ? "agent-plain" : ""}`.trim();
      bubble.style.display = visibleContent ? "" : "none";
      const newContent = visibleContent ? buildBubbleContent(displayMessage) : "";
      if (bubble.innerHTML !== newContent) bubble.innerHTML = newContent;

      const existingCard = block.querySelector(".skill-bubble");
      const cardData = skillState.skillData || skillState.skillResult;
      if (cardData && !existingCard) {
        const card = skillState.skillData && typeof renderSkillCard === "function"
          ? renderSkillCard(skillState.skillData, message.id)
          : typeof renderSkillResult === "function"
            ? renderSkillResult(skillState.skillResult)
            : null;
        if (card) block.appendChild(card);
      }
      const existingTranscript = block.querySelector(".skill-answer-transcript");
      if (!existingTranscript && typeof renderSkillAnswerTranscript === "function") {
        const transcript = renderSkillAnswerTranscript(message._skillAnswer);
        if (transcript) block.appendChild(transcript);
      }
      syncMessageModelProviderIcon(block, message);
      syncMessageThinkingIcon(block, message);
      bindInlineMetaToggles(block, message);
      syncStreamingTtsForMessage(message);
      return;
    }
  }

  const isSingleLineMessage = !message.pending && !/[\r\n]/.test(message.content || "");
  const isWorkAgent = sessionMode === SESSION_MODE_WORK && message.role === "assistant";
  bubble.className = `message ${message.role === "user" ? "user" : message.role === "system" ? "system" : "agent"} ${message.pending ? "pending" : ""} ${message.streaming ? "streaming" : ""} ${isSingleLineMessage ? "single-line" : ""} ${isWorkAgent ? "agent-plain" : ""}`.trim();

  if (message.pending) {
    bubble.innerHTML = `<span class="typing-row"><span></span><span></span><span></span></span>`;
  } else {
    const newContent = buildBubbleContent(message);
    if (bubble.innerHTML !== newContent) {
      bubble.innerHTML = newContent;
      bubble.querySelectorAll("img").forEach(function (image) {
        image.classList.add("chat-content-image");
        image.alt = image.alt || "会话图片";
        image.title = "点击查看大图";
        image.setAttribute("role", "button");
        image.tabIndex = 0;
      });
      if (typeof hljs !== 'undefined' && enableMd) {
        bubble.querySelectorAll('pre code').forEach(hljs.highlightElement);
        wrapCodeLines(bubble);
      }
      if (sessionMode === SESSION_MODE_WORK) {
        bubble.querySelectorAll('.code-copy-btn').forEach(bindCodeCopyBtn);
      }
    }
  }

  // 3. Update model-provider-icon in message-meta
  syncMessageModelProviderIcon(block, message);
  syncMessageThinkingIcon(block, message);

  bindInlineMetaToggles(block, message);

  // 4. Build tools section if it doesn't exist yet (pending → done transition)
  const existingTools = block.querySelector('.message-tools');
  const hideSkillGroupTools = shouldHideSkillGroupTools(message);
  if (hideSkillGroupTools && existingTools) {
    existingTools.remove();
  } else if (!hideSkillGroupTools && message.id && !message.pending) {
    if (!existingTools) {
      const tools = buildMessageTools(message);
      block.appendChild(tools);
    } else if (message.role === "assistant") {
      const tokenLabel = buildMessageTokenLabel(message);
      const tokenSpan = existingTools.querySelector('.message-token-label');
      const actionGroup = existingTools.querySelector('.message-tools-actions');
      if (tokenSpan) {
        if (tokenLabel) {
          tokenSpan.textContent = tokenLabel;
        } else {
          tokenSpan.remove();
        }
      } else if (tokenLabel) {
        const nextTokenSpan = document.createElement("span");
        nextTokenSpan.className = "message-token-label";
        nextTokenSpan.textContent = tokenLabel;
        existingTools.insertBefore(nextTokenSpan, actionGroup || existingTools.firstChild || null);
      }
      existingTools.classList.toggle("has-token", Boolean(tokenLabel));
      syncLatestTurnVariantNav(existingTools, message);
      syncAssistantRetryButton(existingTools, message);
    }
  } else if (existingTools && message.pending) {
    existingTools.remove();
  }

  syncStreamingTtsForMessage(message);
}

function buildMessageTools(message) {
  const tools = document.createElement("div");
  tools.className = "message-tools";
  const actionGroup = document.createElement("div");
  actionGroup.className = "message-tools-actions";

  const tokenLabel = message.role === "assistant" ? buildMessageTokenLabel(message) : "";
  tools.classList.toggle("has-token", Boolean(tokenLabel));
  if (message.role === "assistant" && tokenLabel) {
    const tokenSpan = document.createElement("span");
    tokenSpan.className = "message-token-label";
    tokenSpan.textContent = tokenLabel;
    tools.appendChild(tokenSpan);
  }

  if (message.role === "assistant") {
    const ttsBtn = document.createElement("button");
    ttsBtn.type = "button";
    ttsBtn.className = "message-edit-btn";
    ttsBtn.dataset.action = "tts";
    ttsBtn.title = "朗读";
    ttsBtn.innerHTML = `<i data-lucide="${isTtsActiveForMessage(message.id) ? "pause" : "volume-2"}" class="message-edit-icon"></i>`;
    ttsBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      toggleTts(message, ttsBtn);
    });
    actionGroup.appendChild(ttsBtn);

    const variantNav = buildLatestTurnVariantNav(message);
    if (variantNav) actionGroup.appendChild(variantNav);

    const retryBtn = buildAssistantRetryButton(message);
    if (retryBtn) actionGroup.appendChild(retryBtn);
  }

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "message-edit-btn";
  copyBtn.dataset.action = "copy";
  copyBtn.title = t("chat.copy");
  copyBtn.innerHTML = `<i data-lucide="copy" class="message-edit-icon"></i>`;
  copyBtn.addEventListener("click", (e) => { e.stopPropagation(); copyMessageContent(message.id, copyBtn.querySelector(".message-edit-icon")); });
  actionGroup.appendChild(copyBtn);

  if (message.role === "user") {
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = `message-edit-btn ${state.editingUserMessageId === message.id ? "active" : ""}`.trim();
    editBtn.innerHTML = `<i data-lucide="pencil" class="message-edit-icon"></i>`;
    editBtn.addEventListener("click", (e) => { e.stopPropagation(); beginUserMessageEdit(message.id); });
    actionGroup.appendChild(editBtn);
  }

  tools.appendChild(actionGroup);

  lucide.createIcons();
  return tools;
}

function getLatestTurnControlState(message) {
  const session = getCurrentSession();
  if (!session ||
      session.mode === SESSION_MODE_CHAOS ||
      message?.role !== "assistant" ||
      (message.uiType && message.uiType !== "narration")) {
    return null;
  }

  const latestUserIndex = getLatestUserMessageIndex(session);
  const targetIndex = session.messages.indexOf(message);
  if (latestUserIndex === -1 || targetIndex <= latestUserIndex) return null;

  let anchorIndex = -1;
  for (let index = session.messages.length - 1; index > latestUserIndex; index -= 1) {
    const candidate = session.messages[index];
    if (candidate?.role === "assistant" && !candidate.uiType && !candidate.pending) {
      anchorIndex = index;
      break;
    }
  }
  if (anchorIndex === -1) {
    for (let index = session.messages.length - 1; index > latestUserIndex; index -= 1) {
      const candidate = session.messages[index];
      if (candidate?.role === "assistant" && candidate.uiType === "narration" && !candidate.pending) {
        anchorIndex = index;
        break;
      }
    }
  }
  if (targetIndex !== anchorIndex) return null;

  const userMessage = session.messages[latestUserIndex];
  const versionState = typeof getLatestTurnVariantState === "function"
    ? getLatestTurnVariantState(session)
    : null;
  return {
    session,
    userMessage,
    versionState: versionState?.userMessageId === userMessage.id ? versionState : null,
  };
}

function buildNarrationTurnTools(message) {
  const variantNav = buildLatestTurnVariantNav(message);
  const retryBtn = buildAssistantRetryButton(message);
  if (!variantNav && !retryBtn) return null;

  const tools = document.createElement("div");
  tools.className = "narration-turn-tools";
  const actionGroup = document.createElement("div");
  actionGroup.className = "message-tools-actions";
  if (variantNav) actionGroup.appendChild(variantNav);
  if (retryBtn) actionGroup.appendChild(retryBtn);
  tools.appendChild(actionGroup);
  return tools;
}

function buildLatestTurnVariantNav(message) {
  const controlState = getLatestTurnControlState(message);
  const versionState = controlState?.versionState;
  if (!versionState || versionState.variants.length <= 1) return null;

  const nav = document.createElement("span");
  nav.className = "message-variant-nav";
  nav.dataset.action = "turn-variant-nav";

  const previousBtn = document.createElement("button");
  previousBtn.type = "button";
  previousBtn.className = "message-edit-btn message-variant-btn";
  previousBtn.dataset.variantDirection = "previous";
  previousBtn.title = "上一版回复";
  previousBtn.disabled = versionState.activeIndex <= 0;
  previousBtn.innerHTML = `<i data-lucide="chevron-left" class="message-edit-icon"></i>`;
  previousBtn.addEventListener("click", function(e) {
    e.stopPropagation();
    const latestState = getLatestTurnControlState(message)?.versionState;
    if (latestState) switchLatestTurnVariant(latestState.activeIndex - 1);
  });

  const label = document.createElement("span");
  label.className = "message-variant-label";
  label.textContent = `${versionState.activeIndex + 1}/${versionState.variants.length}`;

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "message-edit-btn message-variant-btn";
  nextBtn.dataset.variantDirection = "next";
  nextBtn.title = "下一版回复";
  nextBtn.disabled = versionState.activeIndex >= versionState.variants.length - 1;
  nextBtn.innerHTML = `<i data-lucide="chevron-right" class="message-edit-icon"></i>`;
  nextBtn.addEventListener("click", function(e) {
    e.stopPropagation();
    const latestState = getLatestTurnControlState(message)?.versionState;
    if (latestState) switchLatestTurnVariant(latestState.activeIndex + 1);
  });

  nav.append(previousBtn, label, nextBtn);
  return nav;
}

function syncLatestTurnVariantNav(tools, message) {
  const actionGroup = tools?.querySelector(".message-tools-actions");
  if (!actionGroup) return;
  const existing = actionGroup.querySelector('[data-action="turn-variant-nav"]');
  const next = buildLatestTurnVariantNav(message);
  if (!next && existing) {
    existing.remove();
  } else if (next && existing) {
    const controlState = getLatestTurnControlState(message);
    const versionState = controlState?.versionState;
    const previousBtn = existing.querySelector('[data-variant-direction="previous"]');
    const nextBtn = existing.querySelector('[data-variant-direction="next"]');
    const label = existing.querySelector(".message-variant-label");
    if (versionState && previousBtn && nextBtn && label) {
      previousBtn.disabled = versionState.activeIndex <= 0;
      nextBtn.disabled = versionState.activeIndex >= versionState.variants.length - 1;
      label.textContent = `${versionState.activeIndex + 1}/${versionState.variants.length}`;
    }
  } else if (next) {
    const retryBtn = actionGroup.querySelector('[data-action="retry-assistant-control"]');
    const copyBtn = actionGroup.querySelector('[data-action="copy"]');
    actionGroup.insertBefore(next, retryBtn || copyBtn || null);
    lucide.createIcons();
  }
}

function buildAssistantRetryButton(message) {
  if (!canRegenerateAssistantMessage(message)) return null;
  const control = document.createElement("span");
  control.className = "message-retry-control";
  control.dataset.action = "retry-assistant-control";

  const retryBtn = document.createElement("button");
  retryBtn.type = "button";
  retryBtn.className = "message-edit-btn";
  retryBtn.dataset.action = "retry-assistant";
  retryBtn.title = "重新生成";
  retryBtn.setAttribute("aria-haspopup", "menu");
  retryBtn.setAttribute("aria-expanded", openAssistantRetryMenuMessageId === message.id ? "true" : "false");
  retryBtn.innerHTML = `<i data-lucide="rotate-ccw" class="message-edit-icon"></i>`;
  retryBtn.addEventListener("click", function(e) {
    e.stopPropagation();
    const host = retryBtn.closest(".message-block, .narration-block");
    toggleAssistantRetryMenu(host, message.id);
  });

  const menu = document.createElement("div");
  menu.className = `message-retry-menu ${openAssistantRetryMenuMessageId === message.id ? "open" : ""}`.trim();
  menu.setAttribute("role", "menu");

  [
    { mode: "concise", icon: "minimize-2", label: "更加简洁", hint: "压缩表达，保留重点" },
    { mode: "detailed", icon: "align-left", label: "更加详细", hint: "补充过程与必要细节" },
    { mode: "retry", icon: "rotate-ccw", label: "重试一次", hint: "重新生成另一版回复" },
  ].forEach((item) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "message-retry-option";
    option.dataset.regenerationMode = item.mode;
    option.setAttribute("role", "menuitem");
    option.innerHTML = `
      <i data-lucide="${item.icon}" class="message-retry-option-icon"></i>
      <span class="message-retry-option-copy">
        <strong>${item.label}</strong>
      </span>
    `;
    option.addEventListener("click", function(e) {
      e.stopPropagation();
      closeAssistantRetryMenu();
      regenerateFromAssistantMessage(message.id, item.mode);
    });
    menu.appendChild(option);
  });

  control.append(retryBtn, menu);
  return control;
}

function syncAssistantRetryButton(tools, message) {
  const actionGroup = tools?.querySelector(".message-tools-actions");
  if (!actionGroup) return;
  const existing = actionGroup.querySelector('[data-action="retry-assistant-control"]');
  const shouldShow = canRegenerateAssistantMessage(message);
  if (!shouldShow && existing) {
    if (openAssistantRetryMenuMessageId === message.id) closeAssistantRetryMenu();
    existing.remove();
  } else if (shouldShow && !existing) {
    const retryBtn = buildAssistantRetryButton(message);
    if (retryBtn) {
      const copyBtn = actionGroup.querySelector('[data-action="copy"]');
      actionGroup.insertBefore(retryBtn, copyBtn || null);
      lucide.createIcons();
    }
  }
}

function canRegenerateAssistantMessage(message) {
  const controlState = getLatestTurnControlState(message);
  if (!controlState) return false;
  const branchSequence = getMessageSequenceInSession(controlState.session, controlState.userMessage);
  const compressedCutoff = typeof getCompressedCutoffSeq === "function"
    ? getCompressedCutoffSeq(controlState.session)
    : (Number.isFinite(controlState.session.compressedUntilSequence)
        ? controlState.session.compressedUntilSequence
        : -1);
  return !Number.isFinite(compressedCutoff) || compressedCutoff < branchSequence;
}

var TTS_CHUNK_MAX_LENGTH = 180;
var TTS_KEEP_ALIVE_INTERVAL_MS = 4000;
var TTS_STALL_THRESHOLD_MS = 25000;
var TTS_CHUNK_GRACE_MS = 8000;
var TTS_MAX_RESTARTS_PER_CHUNK = 2;
var TTS_SPEECH_RATE = 1.0;
var TTS_CHUNK_DELAY_MS = 120;
var TTS_STREAM_SOFT_BREAK_MIN_LENGTH = 72;
var _ttsSession = null;
var _ttsKeepAliveTimer = null;
var _ttsVoices = [];
var _ttsAutoQueue = [];
var _ttsAutoQueuedIds = new Set();
var _ttsAutoTurnArmed = false;

function getTtsConfig() {
  var cfg = state?.settings?.tts || {};
  return {
    provider: cfg.provider || "system",
    host: cfg.host || "https://api.xiaomimimo.com/v1/chat/completions",
    apiKey: cfg.apiKey || "",
    voice: cfg.voice || "冰糖",
    model: cfg.model || "mimo-v2.5-tts",
    speed: Number(cfg.speed) || 1,
    systemVoice: cfg.systemVoice || "",
    systemSpeed: Number(cfg.systemSpeed) || 1,
    systemPitch: Number(cfg.systemPitch) || 1,
  };
}

function ttsSpeedToHint(speed) {
  var n = Number(speed) || 1;
  if (n <= 0.75) return "语速较慢";
  if (n >= 1.5) return "语速很快";
  if (n >= 1.25) return "语速偏快";
  return "正常语速";
}

function isTtsActiveForMessage(messageId) {
  return Boolean(_ttsSession && _ttsSession.messageId === messageId);
}

function refreshTtsVoiceCache() {
  if (!window.speechSynthesis || typeof window.speechSynthesis.getVoices !== "function") {
    _ttsVoices = [];
    return _ttsVoices;
  }
  var voices = window.speechSynthesis.getVoices();
  _ttsVoices = Array.isArray(voices) ? voices : Array.from(voices || []);
  return _ttsVoices;
}

function getPreferredTtsVoice() {
  refreshTtsVoiceCache();
  var cfg = getTtsConfig();
  if (cfg.systemVoice) {
    var found = _ttsVoices.find(function(v) { return v.voiceURI === cfg.systemVoice; });
    if (found) return found;
  }
  return null;
}

function looksLikeCodeishText(text) {
  var value = String(text || "").trim();
  if (!value) return false;
  if (/[/\\{}[\]();=<>_*`#$]/.test(value)) return true;
  if (value.length >= 24 && /[A-Za-z]/.test(value) && /\d/.test(value)) return true;
  return false;
}

function looksLikeCodeishLine(text) {
  var value = String(text || "").trim();
  if (!value) return false;
  if (/^```/.test(value)) return true;
  if (/^\|.*\|$/.test(value)) return true;
  if (/^[-=]{3,}$/.test(value)) return true;
  if (/^(function|const|let|var|if|for|while|return|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\b/i.test(value)) return true;
  var symbolMatches = value.match(/[{}[\]();=<>_*`#$\\/|]/g);
  var symbolCount = symbolMatches ? symbolMatches.length : 0;
  if (symbolCount >= 4 && symbolCount / Math.max(value.length, 1) > 0.12) return true;
  return looksLikeCodeishText(value);
}

function removeTtsNode(node) {
  if (node && node.parentNode) {
    node.parentNode.removeChild(node);
  }
}

function replaceTtsNodeWithText(node, text) {
  if (!node || !node.parentNode) return;
  node.parentNode.replaceChild(document.createTextNode(text), node);
}

function isTtsBlockElement(node) {
  if (!node || node.nodeType !== 1) return false;
  return /^(P|LI|H1|H2|H3|H4|H5|H6|BLOCKQUOTE|TR|TD|TH|UL|OL)$/.test(node.tagName);
}

function appendTtsSeparator(parts) {
  if (!parts.length) return;
  var last = parts[parts.length - 1];
  if (last !== "\n") {
    parts.push("\n");
  }
}

function collectTtsTextParts(node, parts) {
  if (!node) return;
  if (node.nodeType === 3) {
    var text = String(node.nodeValue || "").replace(/\s+/g, " ");
    if (text) {
      parts.push(text);
    }
    return;
  }
  if (node.nodeType !== 1) return;
  if (node.tagName === "BR") {
    appendTtsSeparator(parts);
    return;
  }

  var isBlock = isTtsBlockElement(node);
  if (isBlock) {
    appendTtsSeparator(parts);
  }
  Array.from(node.childNodes || []).forEach(function(child) {
    collectTtsTextParts(child, parts);
  });
  if (isBlock) {
    appendTtsSeparator(parts);
  }
}

function extractTtsTextFromBubble(bubble, options) {
  if (!bubble) return "";
  var clone = bubble.cloneNode(true);
  clone.querySelectorAll(".thinking-section, .tool-trace-section, .typing-row, .code-copy-btn, button").forEach(removeTtsNode);
  clone.querySelectorAll(".pre-code-block, pre").forEach(function(node) {
    replaceTtsNodeWithText(node, "\n代码片段已省略。\n");
  });
  clone.querySelectorAll("table").forEach(function(node) {
    replaceTtsNodeWithText(node, "\n表格内容已省略。\n");
  });
  clone.querySelectorAll("code").forEach(function(node) {
    if (node.closest("pre, .pre-code-block")) return;
    var codeText = String(node.innerText || node.textContent || "").trim();
    replaceTtsNodeWithText(node, looksLikeCodeishText(codeText) ? "代码" : codeText);
  });
  clone.querySelectorAll("img").forEach(function(node) {
    var alt = String(node.getAttribute("alt") || "").trim();
    replaceTtsNodeWithText(node, alt || "图片");
  });
  clone.querySelectorAll("svg, i").forEach(removeTtsNode);

  var parts = [];
  collectTtsTextParts(clone, parts);
  return normalizeTtsText(parts.join(""), options);
}

function extractRenderedTtsText(btn, options) {
  var block = btn?.closest(".message-block.agent");
  var bubble = block?.querySelector(".message.agent");
  return extractTtsTextFromBubble(bubble, options);
}

function extractRenderedTtsTextByMessageId(messageId, options) {
  if (!messageId || !els.chatMessages) return "";
  var block = els.chatMessages.querySelector('[data-message-id="' + messageId + '"]');
  var bubble = block?.querySelector(".message.agent");
  return extractTtsTextFromBubble(bubble, options);
}

function normalizeTtsLineBreaks(text, options) {
  var preserveIncompleteLine = Boolean(options && options.preserveIncompleteLine);
  return String(text || "")
    .split("\n")
    .map(function(line) {
      var trimmed = line.trim();
      if (!trimmed) return "";
      if (preserveIncompleteLine) {
        return looksLikeCodeishLine(trimmed) ? "代码片段已省略。" : trimmed;
      }
      if (looksLikeCodeishLine(trimmed)) {
        return "代码片段已省略。";
      }
      if (!/[。！？!?]$/.test(trimmed)) {
        return trimmed + "。";
      }
      return trimmed;
    })
    .filter(Boolean)
    .join("\n");
}

function stripMarkdownForTts(text, options) {
  var value = String(text || "");
  if (!value) return "";
  value = value.replace(/```[\s\S]*?```/g, "\n代码片段已省略。\n");
  value = value.replace(/`([^`\n]+)`/g, function(_, inlineCode) {
    var cleaned = String(inlineCode || "").trim();
    if (!cleaned) return "";
    return looksLikeCodeishText(cleaned) ? "代码" : cleaned;
  });
  value = value.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function(_, altText) {
    var cleaned = String(altText || "").trim();
    return cleaned ? cleaned : "图片";
  });
  value = value.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
  value = value.replace(/(?:https?|ftp):\/\/\S+/g, "链接");
  value = value.replace(/\bwww\.[a-zA-Z0-9.-]+(?:[/\S]*)?/g, "链接");
  value = value.replace(/^#{1,6}\s*/gm, "");
  value = value.replace(/^\s{0,3}>\s?/gm, "");
  value = value.replace(/^\s*[-*+]\s+/gm, "");
  value = value.replace(/^\s*\d+\.\s+/gm, "");
  value = value.replace(/^\s*\|?[\-: ]+\|[\-|: ]*$/gm, "");
  value = value.replace(/\|/g, "，");
  value = value.replace(/\*\*([^*]+)\*\*/g, "$1");
  value = value.replace(/\*([^*]+)\*/g, "$1");
  value = value.replace(/__([^_]+)__/g, "$1");
  value = value.replace(/_([^_]+)_/g, "$1");
  value = value.replace(/~~([^~]+)~~/g, "$1");
  value = value.replace(/<br\s*\/?>/gi, "\n");
  value = value.replace(/<\/?(?:code|pre|em|strong|b|i|u|span|div|p|section|article)[^>]*>/gi, " ");
  value = value.replace(/&nbsp;/gi, " ");
  value = value.replace(/&lt;/gi, "<");
  value = value.replace(/&gt;/gi, ">");
  value = value.replace(/&amp;/gi, "&");
  return normalizeTtsLineBreaks(value, options);
}

function normalizeTtsText(text, options) {
  return stripMarkdownForTts(text, options)
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[*_~`{}\[\]\\|]/g, "")
    .replace(/ {2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitNormalizedTtsText(normalizedText) {
  var normalized = String(normalizedText || "").trim();
  if (!normalized) return [];
  var chunks = [];

  normalized.split(/\n+/).forEach(function(paragraph) {
    var trimmed = String(paragraph || "").trim();
    if (!trimmed) return;
    splitTtsParagraph(trimmed, TTS_CHUNK_MAX_LENGTH).forEach(function(piece) {
      if (piece) chunks.push(piece);
    });
  });

  return chunks;
}

function splitTtsLongSegment(segment, maxLength) {
  var pieces = [];
  var start = 0;
  while (start < segment.length) {
    var end = Math.min(segment.length, start + maxLength);
    if (end < segment.length) {
      var slice = segment.slice(start, end);
      var breakAt = Math.max(
        slice.lastIndexOf("。"),
        slice.lastIndexOf("！"),
        slice.lastIndexOf("？"),
        slice.lastIndexOf("."),
        slice.lastIndexOf("!"),
        slice.lastIndexOf("?"),
        slice.lastIndexOf("\n\n"),
        slice.lastIndexOf("\n")
      );
      if (breakAt >= Math.floor(maxLength * 0.55)) {
        end = start + breakAt + (slice.substr(breakAt, 2) === "\n\n" ? 2 : 1);
      }
    }
    var piece = segment.slice(start, end).trim();
    if (piece) {
      pieces.push(piece);
    }
    start = end;
  }
  return pieces;
}

function splitTtsParagraph(paragraph, maxLength) {
  var normalized = String(paragraph || "").trim();
  if (!normalized) return [];
  if (normalized.length <= maxLength) return [normalized];

  var sentenceParts = normalized
    .replace(/([。！？!?])/g, "$1\u0000")
    .split("\u0000")
    .map(function(part) { return part.trim(); })
    .filter(Boolean);

  if (!sentenceParts.length) {
    return splitTtsLongSegment(normalized, maxLength);
  }

  var chunks = [];
  var current = "";

  sentenceParts.forEach(function(sentence) {
    if (!current) {
      if (sentence.length <= maxLength) {
        current = sentence;
      } else {
        splitTtsLongSegment(sentence, maxLength).forEach(function(piece) {
          if (piece) chunks.push(piece);
        });
      }
      return;
    }

    if ((current + sentence).length <= maxLength) {
      current += sentence;
      return;
    }

    chunks.push(current);
    if (sentence.length <= maxLength) {
      current = sentence;
      return;
    }

    current = "";
    splitTtsLongSegment(sentence, maxLength).forEach(function(piece) {
      if (piece) chunks.push(piece);
    });
  });

  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function splitTtsText(text) {
  return splitNormalizedTtsText(normalizeTtsText(text));
}

function findFirstTtsBoundaryIndex(text, pattern, minIndex) {
  var start = Math.max(0, minIndex || 0);
  for (var i = start; i < text.length; i++) {
    if (pattern.indexOf(text.charAt(i)) >= 0) {
      return i;
    }
  }
  return -1;
}

function getTtsBoundaryEnd(text, index) {
  if (index < 0) return 0;
  if (text.charAt(index) === "\n" && text.charAt(index + 1) === "\n") {
    return index + 2;
  }
  return index + 1;
}

function splitTtsTextForStreaming(text, forceFlushTail) {
  var normalized = normalizeTtsText(text, { preserveIncompleteLine: true });
  if (!normalized) return [];

  var remaining = normalized;
  var chunks = [];

  while (remaining) {
    var maxWindow = Math.min(remaining.length, TTS_CHUNK_MAX_LENGTH);
    var windowText = remaining.slice(0, maxWindow);
    var nextEnd = 0;
    var hardBreak = findFirstTtsBoundaryIndex(windowText, "。！？!?\n");

    if (hardBreak >= 0) {
      nextEnd = getTtsBoundaryEnd(windowText, hardBreak);
    } else if (remaining.length > TTS_CHUNK_MAX_LENGTH) {
      var softBreak = findFirstTtsBoundaryIndex(windowText, "，、；：,:;\n", TTS_STREAM_SOFT_BREAK_MIN_LENGTH);
      if (softBreak >= 0) {
        nextEnd = getTtsBoundaryEnd(windowText, softBreak);
      } else {
        nextEnd = maxWindow;
      }
    } else if (forceFlushTail) {
      nextEnd = remaining.length;
    } else {
      break;
    }

    var chunk = remaining.slice(0, nextEnd).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(nextEnd).replace(/^\n+/, "");
  }

  return chunks;
}

function getTtsButtonForMessageId(messageId) {
  if (!messageId || !els.chatMessages) return null;
  return els.chatMessages.querySelector('[data-message-id="' + messageId + '"] [data-action="tts"]');
}

function syncTtsSessionButton(session) {
  if (!session) return null;
  var btn = getTtsButtonForMessageId(session.messageId);
  if (btn) {
    session.btn = btn;
  }
  return session.btn || null;
}

function createTtsSession(message, chunks, options) {
  var config = options || {};
  return {
    messageId: message.id,
    btn: config.btn || getTtsButtonForMessageId(message.id),
    chunks: chunks || [],
    index: 0,
    cancelled: false,
    currentUtterance: null,
    chunkRestartCount: 0,
    chunkToken: 0,
    chunkStartedAt: 0,
    chunkDeadlineAt: 0,
    lastActivityAt: 0,
    sourceStreaming: Boolean(message.streaming),
    auto: Boolean(config.auto),
  };
}

function enqueueAutoTtsMessage(message) {
  if (!message?.id || _ttsAutoQueuedIds.has(message.id)) return;
  _ttsAutoQueuedIds.add(message.id);
  _ttsAutoQueue.push(message.id);
}

function findTtsMessageById(messageId) {
  var session = getCurrentSession();
  return session?.messages?.find(function(message) {
    return message?.id === messageId;
  }) || null;
}

function startAutoTtsMessage(message) {
  if (!message?.id || !message.content || _ttsSession) return false;
  var renderedText = extractRenderedTtsTextByMessageId(message.id, {
    preserveIncompleteLine: Boolean(message.streaming),
  });
  var sourceText = renderedText || message.content;
  var chunks = message.streaming
    ? splitTtsTextForStreaming(sourceText, false)
    : splitTtsText(sourceText);
  var session = createTtsSession(message, chunks, { auto: true });
  _ttsSession = session;
  setTtsIcon(syncTtsSessionButton(session), "pause");
  startTtsKeepAlive();
  if (session.chunks.length) {
    speakTtsChunk(session);
  }
  return true;
}

function startNextAutoTtsMessage() {
  if (_ttsSession || !_ttsAutoTurnArmed) return;
  while (_ttsAutoQueue.length) {
    var messageId = _ttsAutoQueue.shift();
    _ttsAutoQueuedIds.delete(messageId);
    var message = findTtsMessageById(messageId);
    if (message?.content && startAutoTtsMessage(message)) {
      return;
    }
  }
}

function prepareAutoTtsTurn() {
  cancelTtsSession();
  const session = typeof getCurrentSession === "function" ? getCurrentSession() : null;
  _ttsAutoTurnArmed = typeof getSessionSetting === "function"
    && getSessionSetting(session, "autoTts") === true;
  _ttsAutoQueue = [];
  _ttsAutoQueuedIds.clear();
  if (!_ttsAutoTurnArmed) return;
  var ttsCfg = getTtsConfig();
  if (ttsCfg.provider === "system") {
    try {
      refreshTtsVoiceCache();
      window.speechSynthesis?.resume();
    } catch (err) {}
  }
}

window.__prepareAutoTtsTurn = prepareAutoTtsTurn;
window.__cancelAutoTtsTurn = cancelTtsSession;

function syncStreamingTtsForMessage(message) {
  const currentSession = typeof getCurrentSession === "function" ? getCurrentSession() : null;
  if (typeof getSessionSetting === "function" && getSessionSetting(currentSession, "autoTts") !== true) return;
  if (typeof isSkillMessage === "function" && message?.content && isSkillMessage(message.content)) return;
  var session = _ttsSession;
  if (!message || message.role !== "assistant") {
    return;
  }

  if (!session && _ttsAutoTurnArmed && message.streaming && message.content) {
    startAutoTtsMessage(message);
    session = _ttsSession;
  } else if (session && session.messageId !== message.id && _ttsAutoTurnArmed && message.streaming && message.content) {
    enqueueAutoTtsMessage(message);
    return;
  }

  if (!session || session.messageId !== message.id || session.cancelled) return;

  syncTtsSessionButton(session);
  var renderedText = extractRenderedTtsTextByMessageId(message.id, {
    preserveIncompleteLine: Boolean(message.streaming),
  });
  var sourceText = renderedText || normalizeTtsText(message.content || "", {
    preserveIncompleteLine: Boolean(message.streaming),
  });
  var nextChunks = splitTtsTextForStreaming(sourceText, !message.streaming);

  if (nextChunks.length > session.chunks.length) {
    for (var i = session.chunks.length; i < nextChunks.length; i++) {
      session.chunks.push(nextChunks[i]);
    }
    markTtsActivity(session);
  }

  session.sourceStreaming = Boolean(message.streaming);

  var isApiTts = _ttsSession && getTtsConfig().provider === "mimo";

  if (isApiTts) {
    if (!session.currentAudio && session.index < session.chunks.length) {
      speakTtsChunk(session);
    }
  } else {
    if (!session.currentUtterance && session.index < session.chunks.length) {
      try {
        if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
          speakTtsChunk(session);
        }
      } catch (err) {}
    }
  }

  if (!message.streaming) {
    var isDone = isApiTts ? !session.currentAudio : !session.currentUtterance;
    if (isDone && session.index >= session.chunks.length) {
      finishTtsSession(session, false);
    }
  }
}

function clearTtsKeepAlive() {
  if (_ttsKeepAliveTimer) {
    clearInterval(_ttsKeepAliveTimer);
    _ttsKeepAliveTimer = null;
  }
}

function markTtsActivity(session) {
  if (!session) return;
  session.lastActivityAt = Date.now();
}

function queueNextTtsChunk(session, delayMs) {
  window.setTimeout(function() {
    if (_ttsSession === session && !session.cancelled) {
      speakTtsChunk(session);
    }
  }, delayMs || 0);
}

function retryCurrentTtsChunk(session, delayMs) {
  if (!session || session.cancelled) return false;
  if ((session.chunkRestartCount || 0) >= TTS_MAX_RESTARTS_PER_CHUNK) {
    return false;
  }
  session.chunkRestartCount = (session.chunkRestartCount || 0) + 1;
  session.currentUtterance = null;
  session.chunkToken = (session.chunkToken || 0) + 1;
  markTtsActivity(session);
  try {
    window.speechSynthesis.cancel();
  } catch (err) {}
  queueNextTtsChunk(session, delayMs != null ? delayMs : 80);
  return true;
}

function estimateTtsChunkTimeoutMs(text, rate) {
  var normalizedRate = Number(rate) > 0 ? Number(rate) : 1;
  var charCount = String(text || "").length;
  var estimatedMs = Math.round((charCount * 180) / normalizedRate);
  return Math.max(TTS_STALL_THRESHOLD_MS, estimatedMs + TTS_CHUNK_GRACE_MS);
}

function startTtsKeepAlive() {
  clearTtsKeepAlive();
  _ttsKeepAliveTimer = setInterval(function() {
    var session = _ttsSession;
    if (!session) {
      clearTtsKeepAlive();
      return;
    }
    if (getTtsConfig().provider === "mimo") return;
    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
        markTtsActivity(session);
        return;
      }
      if (!session.currentUtterance) {
        if (session.index < session.chunks.length) {
          speakTtsChunk(session);
        }
        return;
      }
      var now = Date.now();
      if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
        if (!retryCurrentTtsChunk(session)) {
          finishTtsSession(session, true);
        }
        return;
      }
      var chunkDeadlineAt = session.chunkDeadlineAt || (session.chunkStartedAt + TTS_STALL_THRESHOLD_MS);
      if (now >= chunkDeadlineAt) {
        if (!retryCurrentTtsChunk(session)) {
          finishTtsSession(session, true);
        }
      }
    } catch (err) {
      finishTtsSession(session, true);
    }
  }, TTS_KEEP_ALIVE_INTERVAL_MS);
}

function finishTtsSession(session, cancelled) {
  if (!session) return;
  if (_ttsSession === session) {
    _ttsSession = null;
  }
  clearTtsKeepAlive();
  session.cancelled = Boolean(cancelled);
  session.currentUtterance = null;
  setTtsIcon(syncTtsSessionButton(session), "volume-2");
  if (!cancelled && session.auto) {
    window.setTimeout(startNextAutoTtsMessage, TTS_CHUNK_DELAY_MS);
  }
}

function cancelTtsSession() {
  var session = _ttsSession;
  _ttsAutoTurnArmed = false;
  _ttsAutoQueue = [];
  _ttsAutoQueuedIds.clear();
  if (!session) return;
  session.cancelled = true;
  clearTtsKeepAlive();
  try {
    window.speechSynthesis.cancel();
  } catch (err) {}
  if (session.currentAudio) {
    try { session.currentAudio.pause(); } catch (err) {}
    session.currentAudio = null;
  }
  _ttsSession = null;
  session.currentUtterance = null;
  setTtsIcon(syncTtsSessionButton(session), "volume-2");
}

function speakTtsChunk(session) {
  if (!session || session.cancelled) return;
  if (session.index >= session.chunks.length) {
    if (!session.sourceStreaming) {
      finishTtsSession(session, false);
    }
    return;
  }
  var ttsCfg = getTtsConfig();
  if (ttsCfg.provider === "mimo" && ttsCfg.apiKey) {
    speakTtsChunkApi(session, ttsCfg);
  } else {
    speakTtsChunkSystem(session);
  }
}

function speakTtsChunkApi(session, ttsCfg) {
  if (session.currentAudio) {
    try { session.currentAudio.pause(); } catch (err) {}
    session.currentAudio = null;
  }
  var chunkToken = (session.chunkToken || 0) + 1;
  var chunkText = session.chunks[session.index];
  session.chunkToken = chunkToken;
  session.chunkStartedAt = Date.now();
  session.chunkDeadlineAt = session.chunkStartedAt + estimateTtsChunkTimeoutMs(chunkText, ttsCfg.speed);
  markTtsActivity(session);

  fetch(ttsCfg.host.replace(/\/$/, ""), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": ttsCfg.apiKey,
    },
    body: JSON.stringify({
      model: ttsCfg.model,
      messages: [
        { role: "user", content: ttsSpeedToHint(ttsCfg.speed) },
        { role: "assistant", content: chunkText },
      ],
      audio: { format: "wav", voice: ttsCfg.voice },
      stream: false,
    }),
  }).then(function(resp) {
    if (!resp.ok) throw new Error("TTS API " + resp.status);
    return resp.json();
  }).then(function(data) {
    if (_ttsSession !== session || session.cancelled || session.chunkToken !== chunkToken) return;
    var audioData = data && ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.audio && data.choices[0].message.audio.data) || (data.message && data.message.audio && data.message.audio.data));
    if (!audioData) throw new Error("No audio data in response");
    var binary = atob(audioData);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    var blob = new Blob([bytes], { type: "audio/wav" });
    var url = URL.createObjectURL(blob);
    var audio = new Audio(url);
    session.currentAudio = audio;
    audio.onended = function() {
      URL.revokeObjectURL(url);
      if (_ttsSession !== session || session.cancelled || session.chunkToken !== chunkToken) return;
      session.currentAudio = null;
      session.chunkRestartCount = 0;
      session.index += 1;
      if (session.index >= session.chunks.length) {
        if (!session.sourceStreaming) {
          finishTtsSession(session, false);
        }
        return;
      }
      queueNextTtsChunk(session, TTS_CHUNK_DELAY_MS);
    };
    audio.onerror = function() {
      URL.revokeObjectURL(url);
      if (_ttsSession !== session || session.cancelled || session.chunkToken !== chunkToken) return;
      session.currentAudio = null;
      retryCurrentTtsChunk(session, 500);
    };
    audio.play().catch(function() {});
  }).catch(function() {
    if (_ttsSession !== session || session.cancelled || session.chunkToken !== chunkToken) return;
    session.currentAudio = null;
    retryCurrentTtsChunk(session, 500);
  });
}

function speakTtsChunkSystem(session) {
  if (!session || session.cancelled) return;
  if (session.index >= session.chunks.length) {
    if (!session.sourceStreaming) {
      finishTtsSession(session, false);
    }
    return;
  }
  if (session.currentUtterance) {
    try { window.speechSynthesis.cancel(); } catch (err) {}
  }
  var chunkToken = (session.chunkToken || 0) + 1;
  var chunkText = session.chunks[session.index];
  var utterance = new SpeechSynthesisUtterance(chunkText);
  var ttsCfg = getTtsConfig();
  var voice = getPreferredTtsVoice();
  session.chunkToken = chunkToken;
  session.chunkStartedAt = Date.now();
  session.chunkDeadlineAt = session.chunkStartedAt + estimateTtsChunkTimeoutMs(chunkText, ttsCfg.systemSpeed);
  markTtsActivity(session);
  if (voice) {
    utterance.voice = voice;
  }
  utterance.lang = voice?.lang || "zh-CN";
  utterance.rate = ttsCfg.systemSpeed;
  utterance.pitch = ttsCfg.systemPitch;
  utterance.onstart = function() {
    if (_ttsSession !== session || session.cancelled || session.chunkToken !== chunkToken) return;
    markTtsActivity(session);
  };
  utterance.onresume = function() {
    if (_ttsSession !== session || session.cancelled || session.chunkToken !== chunkToken) return;
    markTtsActivity(session);
  };
  utterance.onend = function() {
    if (_ttsSession !== session || session.cancelled || session.chunkToken !== chunkToken || session.currentUtterance !== utterance) return;
    session.currentUtterance = null;
    session.chunkRestartCount = 0;
    session.index += 1;
    if (session.index >= session.chunks.length) {
      if (!session.sourceStreaming) {
        finishTtsSession(session, false);
      }
      return;
    }
    queueNextTtsChunk(session, TTS_CHUNK_DELAY_MS);
  };
  utterance.onerror = function(err) {
    if (_ttsSession !== session || session.cancelled || session.chunkToken !== chunkToken || session.currentUtterance !== utterance) return;
    session.currentUtterance = null;
    retryCurrentTtsChunk(session, 300);
  };
  session.currentUtterance = utterance;
  window.speechSynthesis.speak(utterance);
}

function toggleTts(message, btn) {
  var ttsCfg = getTtsConfig();
  var hasSystemTts = window.speechSynthesis && typeof window.SpeechSynthesisUtterance === "function";
  var hasApiTts = ttsCfg.provider === "mimo" && Boolean(ttsCfg.apiKey);
  if (!hasSystemTts && !hasApiTts) {
    return;
  }
  if (isTtsActiveForMessage(message.id)) {
    cancelTtsSession();
    return;
  }
  cancelTtsSession();
  var renderedText = extractRenderedTtsText(btn, {
    preserveIncompleteLine: Boolean(message.streaming),
  });
  var chunks = message.streaming
    ? splitTtsTextForStreaming(renderedText || message.content || "", false)
    : splitTtsText(renderedText || message.content || "");
  if (!chunks.length && !message.streaming) return;
  var session = {
    messageId: message.id,
    btn: btn,
    chunks: chunks,
    index: 0,
    cancelled: false,
    currentUtterance: null,
    chunkRestartCount: 0,
    chunkToken: 0,
    chunkStartedAt: 0,
    chunkDeadlineAt: 0,
    lastActivityAt: 0,
    sourceStreaming: Boolean(message.streaming)
  };
  _ttsSession = session;
  setTtsIcon(btn, "pause");
  startTtsKeepAlive();
  if (session.chunks.length) {
    speakTtsChunk(session);
  }
}

function setTtsIcon(btn, iconName) {
  if (!btn) return;
  var icon = btn.querySelector(".message-edit-icon");
  if (icon) {
    icon.dataset.lucide = iconName;
    lucide.createIcons();
  }
}

if (window.speechSynthesis && typeof window.speechSynthesis.addEventListener === "function") {
  window.speechSynthesis.addEventListener("voiceschanged", refreshTtsVoiceCache);
}

document.addEventListener("visibilitychange", function() {
  if (!_ttsSession || document.visibilityState !== "visible") {
    return;
  }
  var ttsCfg = getTtsConfig();
  if (ttsCfg.provider === "mimo") {
    if (_ttsSession.currentAudio && _ttsSession.index < _ttsSession.chunks.length) {
      _ttsSession.currentAudio.play().catch(function() {});
    }
    return;
  }
  try {
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      markTtsActivity(_ttsSession);
      return;
    }
    if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending && _ttsSession.index < _ttsSession.chunks.length) {
      if (!_ttsSession.currentUtterance) {
        speakTtsChunk(_ttsSession);
      } else if (!retryCurrentTtsChunk(_ttsSession)) {
        finishTtsSession(_ttsSession, true);
      }
    }
  } catch (err) {
    finishTtsSession(_ttsSession, true);
  }
});

function syncThinkingArrowRotation(section, immediate, forceOpenState) {
  if (!section) return;
  const label = section.querySelector(".thinking-label");
  if (!label) return;

  const isExpanded = typeof forceOpenState === "boolean" ? forceOpenState : section.open;
  const desiredRotation = isExpanded ? 225 : 45;
  const storedRotation = Number(label.dataset.arrowRotationDeg);
  let nextRotation = desiredRotation;

  if (Number.isFinite(storedRotation)) {
    const normalizedRotation = ((storedRotation % 360) + 360) % 360;
    nextRotation = storedRotation + ((desiredRotation - normalizedRotation + 360) % 360);
  }

  if (immediate) {
    label.classList.add("thinking-label-no-motion");
  }

  label.dataset.arrowRotationDeg = String(nextRotation);
  label.style.setProperty("--thinking-arrow-rotation", nextRotation + "deg");

  if (immediate) {
    requestAnimationFrame(function() {
      label.classList.remove("thinking-label-no-motion");
    });
  }
}

function getThinkingContentExpandedHeight(content) {
  if (!content) return 0;
  const computed = window.getComputedStyle(content);
  const maxHeight = parseFloat(computed.maxHeight);
  const scrollHeight = content.scrollHeight;
  if (Number.isFinite(maxHeight) && maxHeight > 0) {
    return Math.min(scrollHeight, maxHeight);
  }
  return scrollHeight;
}

function clearThinkingContentInlineStyles(content) {
  if (!content) return;
  content.style.removeProperty("height");
  content.style.removeProperty("overflow-y");
  content.style.removeProperty("opacity");
  content.style.removeProperty("padding-bottom");
}

function animateThinkingSection(section, shouldOpen, onStateChange) {
  const content = section?.querySelector(".thinking-content");
  if (!section || !content) {
    if (section) section.open = shouldOpen;
    if (typeof onStateChange === "function") onStateChange(shouldOpen);
    return;
  }
  if (section.dataset.thinkingAnimating === "true") {
    return;
  }
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    section.open = shouldOpen;
    clearThinkingContentInlineStyles(content);
    syncThinkingArrowRotation(section, false, shouldOpen);
    if (typeof onStateChange === "function") onStateChange(shouldOpen);
    return;
  }

  const finish = function(finalOpen) {
    section.dataset.thinkingAnimating = "false";
    section.open = finalOpen;
    clearThinkingContentInlineStyles(content);
    syncThinkingArrowRotation(section, false);
    if (typeof onStateChange === "function") onStateChange(finalOpen);
  };

  section.dataset.thinkingAnimating = "true";

  if (shouldOpen) {
    section.open = true;
    syncThinkingArrowRotation(section, false, true);
    content.style.overflowY = "hidden";
    content.style.height = "0px";
    content.style.opacity = "0";
    content.style.paddingBottom = "0px";
    content.getBoundingClientRect();
    const targetHeight = getThinkingContentExpandedHeight(content);
    requestAnimationFrame(function() {
      content.style.height = targetHeight + "px";
      content.style.opacity = "1";
      content.style.paddingBottom = "8px";
    });
  } else {
    syncThinkingArrowRotation(section, false, false);
    const currentHeight = Math.max(content.getBoundingClientRect().height, getThinkingContentExpandedHeight(content));
    content.style.overflowY = "hidden";
    content.style.height = currentHeight + "px";
    content.style.opacity = "1";
    content.style.paddingBottom = "8px";
    content.getBoundingClientRect();
    requestAnimationFrame(function() {
      content.style.height = "0px";
      content.style.opacity = "0";
      content.style.paddingBottom = "0px";
    });
  }

  const onTransitionEnd = function(event) {
    if (event.target !== content || event.propertyName !== "height") return;
    content.removeEventListener("transitionend", onTransitionEnd);
    finish(shouldOpen);
  };

  content.addEventListener("transitionend", onTransitionEnd);
}

function bindInlineMetaToggles(block, message) {
  if (!block || !message?.id) return;
  const thinkingSection = block.querySelector(".thinking-section");
  if (thinkingSection) {
    syncThinkingArrowRotation(thinkingSection, !thinkingSection.dataset.boundToggle);
  }
  if (thinkingSection && !thinkingSection.dataset.boundToggle) {
    thinkingSection.dataset.boundToggle = "true";
    const summary = thinkingSection.querySelector("summary");
    if (summary) {
      summary.addEventListener("click", function(event) {
        event.preventDefault();
        animateThinkingSection(thinkingSection, !thinkingSection.open, function(expanded) {
          message.thinkingExpanded = expanded;
          if (window.persistSessions) {
            window.persistSessions();
          }
        });
      });
    }
    thinkingSection.addEventListener("toggle", () => {
      if (thinkingSection.dataset.thinkingAnimating === "true") {
        return;
      }
      syncThinkingArrowRotation(thinkingSection, false);
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
    copyToClipboard(code, function () {
      btn.className = 'code-copy-btn copied';
      btn.innerHTML = '<i data-lucide="check"></i>';
      lucide.createIcons();
      setTimeout(() => {
        btn.className = 'code-copy-btn';
        btn.innerHTML = '<i data-lucide="clipboard"></i>';
        lucide.createIcons();
      }, 1500);
    });
  });
}

function getSuggestionAvailability() {
  const session = getCurrentSession();
  const isIdle = Boolean(session) && !state.isSending && !state.editingUserMessageId;
  const lastMsg = isIdle && session.messages.length ? session.messages[session.messages.length - 1] : null;
  const hasAssistant = Boolean(state.settings?.assistant?.model) && state.settings.configs.length > 0;

  if (!hasAssistant) {
    return { enabled: false, reasonKey: "chat.suggestHintNoAssistant" };
  }
  if (!lastMsg || lastMsg.role === "user") {
    return { enabled: false, reasonKey: "chat.suggestHintNeedReply" };
  }

  return { enabled: true, reasonKey: "" };
}

function showSuggestHint(reasonKey) {
  if (!reasonKey || !els.chatStatus) return;
  if (state.suggestHintTimer) {
    clearTimeout(state.suggestHintTimer);
    state.suggestHintTimer = null;
  }
  setText(els.chatStatus, t(reasonKey));
  els.chatStatus.dataset.tone = "muted";
  state.suggestHintTimer = setTimeout(() => {
    state.suggestHintTimer = null;
    updateComposerMode();
  }, 2000);
}

function updateSuggestBtn() {
  const availability = getSuggestionAvailability();

  els.suggestBtn.disabled = false;
  els.suggestBtn.classList.toggle("is-disabled", !availability.enabled);
  els.suggestBtn.setAttribute("aria-disabled", availability.enabled ? "false" : "true");
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

  const availability = getSuggestionAvailability();
  if (!availability.enabled) {
    showSuggestHint(availability.reasonKey);
    return;
  }

  const assistantKey = state.settings?.assistant?.model;
  if (!assistantKey) {
    showSuggestHint("chat.suggestHintNoAssistant");
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
  els.suggestBtn.classList.add("is-disabled");
  els.suggestBtn.disabled = false;
  els.suggestBtn.setAttribute("aria-disabled", "true");
  setText(els.chatStatus, "正在生成推荐回复...");

  const contextMessages = getSuggestionContextMessages(session);
  const requestMessages = [...contextMessages, {
    role: "user",
    content: SUGGESTION_GENERATION_PROMPT,
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
      debugWarn("[Suggest] 原始响应:", content);
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
  if (!session) return debugWarn("[__msg] 没有当前会话");
  var msgs = session.messages.filter(function (m) { return m && m.role !== "system" && m.content && !m.pending; });
  var total = msgs.length;
  var windowSize = 30;
  var windowStart = Math.max(1, total - windowSize + 1);

  // 单参数：原行为
  if (w === undefined) {
    if (g < 1 || g > total) return debugWarn("[__msg] 序号超出范围，共 " + total + " 条可见消息");
    var msg = msgs[g - 1];
    var inWin = g >= windowStart ? "第 " + (g - windowStart + 1) + "/30" : "窗口外";
    debugInfo("[__msg] 全局第 " + g + "/" + total + " 条（窗口内 " + inWin + "）:", {
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
    debugWarn("[__msg] 对不上: 全局第 " + g + " 条 ≠ 窗口第 " + w + " 条（窗口从 " + windowStart + " 开始，窗口第 " + w + " 条 = 全局第 " + expectedGlobal + " 条）");
    // 仍然打印两条各自的信息方便对比
    if (g >= 1 && g <= total) {
      var msgG = msgs[g - 1];
      debugInfo("[__msg] 全局第 " + g + ": [" + (msgG.role === "user" ? "用户" : (msgG.speaker || "AI")) + "] " + (msgG.content || "").slice(0, 200));
    }
    if (w >= 1 && w <= windowSize && windowStart + w - 1 <= total) {
      var msgW = msgs[windowStart + w - 2];
      debugInfo("[__msg] 窗口第 " + w + ": [" + (msgW.role === "user" ? "用户" : (msgW.speaker || "AI")) + "] " + (msgW.content || "").slice(0, 200));
    }
    return;
  }

  // 对上了，打印这条消息
  var msg = msgs[g - 1];
  debugInfo("[__msg] ✓ 全局第 " + g + " = 窗口第 " + w + "/30" + ":", {
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
