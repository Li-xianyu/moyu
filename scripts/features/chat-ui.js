"use strict";

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
  const npc = allNpcs.find((n) => n.name === speakerName);
  if (!npc?.model) return null;
  const provider = detectModelProvider(npc.model);
  return provider ? provider.icon : null;
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
  const enableMd = message.role === "assistant" && sessionMode === SESSION_MODE_WORK && getSessionSetting(getCurrentSession(), "markdownRender") !== false;
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
    lucide.createIcons();
    return;
  }

  const heightDelta = scrollEl.scrollHeight - previousScrollHeight;
  scrollEl.scrollTop = previousScrollTop + Math.max(0, heightDelta);
  lucide.createIcons();
}

/* ---- Narration helpers ---- */
function buildNarrationNode(message) {
  const narrationText = sanitizeNarrationText(message.content);
  const tokenLabel = buildMessageTokenLabel(message);
  const wrapper = document.createElement("article");
  wrapper.className = `narration-block ${state.openAgentTokenInfoId === message.id ? "token-open" : ""}`.trim();
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
  }
  return wrapper;
}

function refreshNarrationNode(wrapper, message) {
  const narrationText = sanitizeNarrationText(message.content);
  const tokenLabel = buildMessageTokenLabel(message);
  wrapper.className = `narration-block ${state.openAgentTokenInfoId === message.id ? "token-open" : ""}`.trim();
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
}

/* ---- Message block helpers ---- */
function buildMessageBlock(message, sessionMode, enableMd) {
  const block = document.createElement("article");
  const isAgentPlainBlock = sessionMode === SESSION_MODE_WORK && message.role === "assistant";
  block.className = `message-block ${message.role === "user" ? "user" : message.role === "assistant" ? "agent" : "system"} ${isAgentPlainBlock ? "agent-plain-block" : ""} ${sessionMode === SESSION_MODE_CHAOS ? "chaos-mode" : ""} ${state.openUserMessageToolsId === message.id || state.openAgentTokenInfoId === message.id ? "tools-open" : ""} ${state.openAgentTokenInfoId === message.id ? "token-open" : ""}`.trim();
  if (message.id) block.dataset.messageId = message.id;

  if (message.role === "assistant" || message.role === "user") {
    const meta = document.createElement("div");
    meta.className = "message-meta";
    let metaHtml = `\n        <strong>${escapeHtml(message.speaker)}</strong>`;
    if (message.role === "assistant") {
      const session = getCurrentSession();
      const iconUrl = getModelProviderIcon(session, message.speaker);
      if (iconUrl) {
        metaHtml = `\n        <img class="model-provider-icon" src="${iconUrl}" alt="">${metaHtml}`;
      }
    }
    metaHtml += `\n        <span>${new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>\n      `;
    meta.innerHTML = metaHtml;
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
  block.className = `message-block ${message.role === "user" ? "user" : message.role === "assistant" ? "agent" : "system"} ${isAgentPlainBlock ? "agent-plain-block" : ""} ${sessionMode === SESSION_MODE_CHAOS ? "chaos-mode" : ""} ${state.openUserMessageToolsId === message.id || state.openAgentTokenInfoId === message.id ? "tools-open" : ""} ${state.openAgentTokenInfoId === message.id ? "token-open" : ""}`.trim();

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
  copyBtn.innerHTML = `<i data-lucide="copy" class="message-edit-icon"></i>`;
  copyBtn.addEventListener("click", (e) => { e.stopPropagation(); copyMessageContent(message.id, copyBtn.querySelector(".message-edit-icon")); });
  tools.appendChild(copyBtn);

  if (message.role === "user") {
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = `message-edit-btn ${state.editingUserMessageId === message.id ? "active" : ""}`.trim();
    editBtn.innerHTML = `<i data-lucide="pencil" class="message-edit-icon"></i>`;
    editBtn.addEventListener("click", (e) => { e.stopPropagation(); beginUserMessageEdit(message.id); });
    tools.appendChild(editBtn);

    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "message-edit-btn";
    retryBtn.innerHTML = `<i data-lucide="rotate-ccw" class="message-edit-icon"></i>`;
    retryBtn.addEventListener("click", (e) => { e.stopPropagation(); regenerateFromUserMessage(message.id); });
    tools.appendChild(retryBtn);
  }

  lucide.createIcons();
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
