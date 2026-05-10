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
      debugLog("compress", t("debug.msg.toolbarIconPointerdown"), {
        disabled: Boolean(els.compressMemoryBtn?.disabled),
        open: state.openCompressMemoryInfo,
      });
      event.preventDefault();
    });
    els.compressMemoryBtn.addEventListener("click", (event) => {
      debugLog("compress", t("debug.msg.toolbarIconClick"), {
        disabled: Boolean(els.compressMemoryBtn?.disabled),
        openBefore: state.openCompressMemoryInfo,
      });
      event.preventDefault();
      event.stopPropagation();
      state.openCompressMemoryInfo = !state.openCompressMemoryInfo;
      renderCompressMemoryPopover();
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
    renderCompressMemoryPopover();
  });
  window.addEventListener("resize", autoResizeChatInput);
  autoResizeChatInput();

  // 滚动跟踪：检测用户是否主动离开底部
  const scrollEl = els.chatMessages.closest(".main") || els.chatMessages;
  if (scrollEl) {
    scrollEl.addEventListener("scroll", () => {
      const distFromBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      state.userScrolledAway = distFromBottom > 100;
    }, { passive: true });
  }
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
  const userBlocks = els.chatMessages.querySelectorAll('.message-block.user');
  const lastUser = userBlocks[userBlocks.length - 1];
  if (lastUser) {
    els.chatMessages.classList.add('hide-before');
    if (!els.chatMessages.querySelector('.scroll-spacer')) {
      const spacer = document.createElement('div');
      spacer.className = 'scroll-spacer';
      spacer.style.cssText = 'flex:0 0 auto;pointer-events:none;height:100vh;min-height:600px;';
      els.chatMessages.appendChild(spacer);
    }
    lastUser.scrollIntoView({ block: "start" });
    state.userScrolledAway = true;
  }
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

function buildBubbleContent(message) {
  const session = getCurrentSession();
  const sessionMode = session?.mode || SESSION_MODE_STORY;
  let html = "";
  const thinkingText = (message.thinking || "").trim();
  if (thinkingText) {
    html += `<details class="thinking-section"${message.streaming ? " open" : ""}>`;
    html += `<summary><span class="thinking-label">思考过程</span></summary>`;
    html += `<div class="thinking-content">${escapeHtml(thinkingText).replace(/\n/g, "<br>")}</div>`;
    html += `</details>`;
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
    // FLIP: capture old code block heights for smooth expansion
    const oldPreHeights = Array.from(bubble.querySelectorAll('.pre-code-block'), pre => pre.offsetHeight);

    bubble.innerHTML = buildBubbleContent(targetMessage);

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
  if (state.userScrolledAway) {
    const userBlock = els.chatMessages.querySelector('.message-block.user:last-child');
    if (userBlock) {
      userBlock.scrollIntoView({ block: "start" });
    }
  }
}

function renderMessages(options = {}) {
  const shouldStickToBottom = Boolean(options.stickToBottom);
  const scrollEl = els.chatMessages.closest(".main") || els.chatMessages;
  const previousScrollTop = scrollEl.scrollTop;
  const previousScrollHeight = scrollEl.scrollHeight;
  const session = getCurrentSession();

  if (!session) {
    els.chatMessages.innerHTML = "";
    return;
  }

  const sessionMode = session.mode || SESSION_MODE_STORY;
  const enableMd = sessionMode === SESSION_MODE_WORK && state.settings?.session?.markdownRender !== false;

  // Index existing DOM by messageId — avoid destroying/recreating unchanged nodes
  const oldNodes = new Map();
  for (const child of els.chatMessages.children) {
    if (child.dataset?.messageId) oldNodes.set(child.dataset.messageId, child);
  }

  const fragment = document.createDocumentFragment();

  session.messages.forEach((message) => {
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

  // --- Scroll handling (unchanged) ---
  if (shouldStickToBottom) {
    if (!state.userScrolledAway) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
      state.userScrolledAway = false;
    } else {
      els.chatMessages.classList.add('hide-before');
      if (!els.chatMessages.querySelector('.scroll-spacer')) {
        const spacer = document.createElement('div');
        spacer.className = 'scroll-spacer';
        spacer.style.cssText = 'flex:0 0 auto;pointer-events:none;height:100vh;min-height:600px;';
        els.chatMessages.appendChild(spacer);
      }
      const userBlock = els.chatMessages.querySelector('.message-block.user:last-child');
      if (userBlock) {
        userBlock.scrollIntoView({ block: "start" });
      }
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
      }
      if (sessionMode === SESSION_MODE_WORK) {
        bubble.querySelectorAll('.code-copy-btn').forEach(bindCodeCopyBtn);
      }
    }
  }

  // 3. Build tools section if it doesn't exist yet (pending → done transition)
  const existingTools = block.querySelector('.message-tools');
  if (message.id && !message.pending) {
    if (!existingTools) {
      const tools = buildMessageTools(message);
      block.appendChild(tools);
    } else if (message.role === "assistant") {
      const tokenSpan = existingTools.querySelector('.message-token-label');
      if (tokenSpan) tokenSpan.textContent = buildMessageTokenLabel(message);
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

/* Shared copy-button handler */
function bindCodeCopyBtn(btn) {
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
  els.chatInput.value = "";
  autoResizeChatInput();
  renderMessages();
  renderChatListMenu();
  // 用户消息固定到视口顶部 + 底部垫片供 AI 展开
  const userBlocks = els.chatMessages.querySelectorAll('.message-block.user');
  const lastUser = userBlocks[userBlocks.length - 1];
  if (lastUser) {
    els.chatMessages.classList.add('hide-before');
    const spacer = document.createElement('div');
    spacer.className = 'scroll-spacer';
    spacer.style.cssText = 'flex:0 0 auto;pointer-events:none;height:100vh;min-height:600px;';
    els.chatMessages.appendChild(spacer);
    lastUser.scrollIntoView({ block: "start" });
    state.userScrolledAway = true;
  }
  debugLog("turn", t("debug.msg.userMessageSubmitted"), {
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
    } finally {
      state.isSending = false;
      els.sendBtn.disabled = false;
      els.chatInput.disabled = false;
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
    debugLog("director", t("debug.msg.respondersResolved"), responders.map((npc) => ({
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
    if (!window.matchMedia?.("(pointer: coarse)").matches) {
      queueMicrotask(() => els.chatInput.focus());
    }
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
              "如果用户没提任何 NPC、也没接任何人的话 → responders 可以是 []。",
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

async function callNpc(session, npc, npcInstructions = {}) {
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
  touchSession(session);
  persistSessions();
  renderMessages({ stickToBottom: true });

  const turnContext = getCurrentTurnNpcContext(session, npc.name);
  const priorRepliesText = turnContext.previousSpeakers.length
    ? `本轮在你之前已经发言的 NPC：${turnContext.previousSpeakers.join("、")}（他们和你一样仍在现场，没有离开，你们正在一起交谈）。`
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

  const baseRules = isWeakModel(npc.model)
    ? [
        `你现在扮演 ${npc.name}。`,
        npc.prompt ? `人物要求：${npc.prompt}` : "请根据全局设定自然回应。",
        priorRepliesText,
        directorInstruction,
        directorInstruction ? "严格按照导演指令回应。" : "",
        "禁止输出思考过程，禁止任何形式的说话人标签。",
        `直接输出 ${npc.name} 的回应内容，不要写"${npc.name}："或"模型："或"AI："等前缀。`,
        "禁止替用户说话或行动，用户会自己发言。",
        ...(session.mode === SESSION_MODE_STORY ? ["对话用双引号包起来，动作和想法用圆括号包起来。例如：\"你好吗？\"（她推开门）"] : []),
      ].filter(Boolean)
    : [
        `你现在扮演 ${npc.name}。`,
        npc.prompt ? `人物要求：${npc.prompt}` : "请根据全局设定和当前聊天自然回应。",
        priorRepliesText,
        directiveSection,
        "",
        "=== 绝对禁止 ===",
        `1. 禁止输出任何形式的说话人标签。不要写"${npc.name}："、"模型："、"AI："等前缀。历史中的 [标签] 仅为标识谁在说话，不要模仿。直接输出内容，不要加任何前缀。`,
        "2. 禁止重复！检查历史中你自己的上一条回复，如果与你要说的话有 40% 以上词语重合，这是严重违规。",
        "   每轮必须用全新的措辞、不同的比喻、不同的角度来回应。宁可说一句全新的话，也不准改写旧内容。",
        "3. 禁止模拟别的 NPC、禁止替别人补充、禁止自问自答、禁止连续写多轮对话。",
        "4. 只输出一版最终答案，不要给草稿、补充版、总结版、收尾版。",
        "5. 只能写你自己的发言、动作、神态、感受和判断。禁止替别的 NPC 决定动作，禁止代替别的 NPC 说话。",
        "6. 禁止替用户说话、行动或做决定。用户会自己发言，不需要你代言。",
        "7. 如果本轮在你之前已经有 NPC 说过话，禁止重写、复述、扩写、改写那位 NPC 刚刚说过的大段内容。",
        "8. 你可以接着别人的话往下说，但必须明显往前推进，不能把上一位的整段描写再说一遍。",
        "",
        "=== 输出格式 ===",
        `直接输出 ${npc.name} 说的话，禁止加任何前缀标签。不要包含说话人标识。`,
        ...(session.mode === SESSION_MODE_STORY ? [
          "对话用双引号包起来，例如\"你好吗？\"。动作和想法用圆括号包起来，例如（她推开门）(他在想什么)。",
          "禁止替用户做动作——用户进门你写\"（听到门响）\"就好，不要写\"（推开门）\"这个动作本身。只写你自己的动作和感知。",
          "禁止使用 Markdown 格式，禁止输出代码块。",
        ] : [
          "一句完整的回应就好。",
        ]),

        "=== 必须遵守 ===",
        "如果用户要求限制字数、格式或风格，你必须严格遵守。",
      ];

      // Story mode: no extra push needed — format rules are inline above

  const baseRulesText = baseRules.join("\n");

  const messages = [
    { role: "system", content: baseRulesText },
    { role: "system", content: `当前场景中在场的 NPC：${getSceneNpcs(session).map((item) => item.name).join("、")}。所有场内 NPC 始终一起待在当前场景中，不会因发言顺序而离开或入场。你们的对话视为同处一室的当面交谈。` },
    { role: "system", content: `全局设定：\n${session.globalPrompt}` },
    { role: "system", content: "以下 [DIRECTOR_MEMORY] 是本轮之前发生的关键事件摘要，仅作为背景参考。你据此了解已发生过的事情即可，不要重复叙述历史，不要替用户或不在当前场景中的角色说话。" },
    ...buildDirectorMemorySystemMessage(session),
    ...buildNpcContextMessages(session, npc),
  ];
  // Prompt-based thinking inhibition for models that don't support the thinking param
  if (getModelThinkingState() === "disabled" && !supportsThinkingParam(npc.model)) {
    messages.push({ role: "system", content: "直接输出，不要输出思考过程。" });
  }
  targetMessage.estimatedUsage = {
    input: estimateChatMessagesTokens(messages),
    output: 0,
    total: estimateChatMessagesTokens(messages),
  };

  await streamChatCompletion(session, npc.name, npc.model, messages, npc.configId);
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

  state.openCompressMemoryInfo = false;
  renderCompressMemoryPopover();
  if (els.compressMemoryBtn) {
    els.compressMemoryBtn.disabled = true;
  }
  updateComposerMode();
  setText(els.chatStatus, "正在压缩导演记忆...");
  debugLog("compress", t("debug.msg.compressionStarted"), {
    sessionId: session.id,
    recentLimit: DIRECTOR_MANUAL_RECENT_HISTORY_LIMIT,
  });

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
      setText(els.chatStatus, finalStatusText);
    } else {
      finalStatusText = "导演记忆已压缩";
      setText(els.chatStatus, finalStatusText);
    }
  } catch (error) {
    debugLog("compress", t("debug.msg.compressionFailed"), {
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
    els.compressMemoryBtn.insertAdjacentElement("afterend", popover);
  }
  return popover;
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
    debugLog("compress", t("debug.msg.popoverRenderSkipped"), {
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
  debugLog("compress", t("debug.msg.popoverRendered"), {
    hasSession,
    open: state.openCompressMemoryInfo,
    sending: state.isSending,
    hasMarkup: Boolean(popover.innerHTML.trim()),
  });
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

function updateModelThinkingBtn() {
  if (!els.modelThinkingBtn) return;
  const on = els.modelThinkingBtn.dataset.state === "enabled";
  els.modelThinkingBtn.className = `secondary-btn model-thinking-btn ${on ? "state-enabled" : "state-disabled"}`;
  els.modelThinkingBtn.textContent = on ? "思考·开启" : "思考·关闭";
}

function getModelThinkingState() {
  return state.settings?.session?.modelThinking || "disabled";
}

function buildModelThinkingExtra(modelName) {
  return buildThinkingExtra(modelName, getModelThinkingState());
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

  const shouldTrackUsage = state.settings?.session?.showTokenDisplay !== false;

  const buildStreamBody = (withUsage, withTemp = true) => {
    const body = {
      model,
      messages,
      stream: true,
    };
    if (withTemp) {
      body.temperature = isWeakModel(model) ? 0.1 : 0.5;
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
    state.userScrolledAway = false;
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
    state.userScrolledAway = false;
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
          const thinkingDelta = data?.choices?.[0]?.delta?.reasoning_content ?? data?.choices?.[0]?.message?.reasoning_content ?? "";
          if (thinkingDelta) {
            targetMessage.thinking += thinkingDelta;
            if (streamRevealed) updateStreamingBubble(targetMessage);
          }
          if (delta) {
            if (!streamRevealed) {
              initialBuffer += delta;
              if (initialBuffer.length >= 25) {
                targetMessage.content = initialBuffer;
                targetMessage.pending = false;
                targetMessage.streaming = true;
                renderMessages({ stickToBottom: true });
                streamRevealed = true;
              }
            } else {
              targetMessage.content += delta;
              updateStreamingBubble(targetMessage);
            }
          }
        } catch {
          // Ignore incompatible keepalive chunks.
        }
      }
    }
  }

  // Flush any buffered content that didn't reach the threshold
  if (!streamRevealed && initialBuffer) {
    targetMessage.content = initialBuffer;
    targetMessage.pending = false;
    targetMessage.streaming = true;
    renderMessages({ stickToBottom: true });
    streamRevealed = true;
  }

  if (!targetMessage.content.trim()) {
    targetMessage.streaming = false;
    targetMessage.pending = true;
    touchSession(session);
    persistSessions();
    state.userScrolledAway = false;
    renderMessages({ stickToBottom: true });
    debugLog("npc", t("debug.msg.npcRetry", { speaker }), { sessionId: session.id });
    await wait(300);

    targetMessage.thinking = "";
    const retryResponse = await doStreamFetch(shouldTrackUsage);

    if (retryResponse.ok && retryResponse.body) {
      let retryRevealed = false;
      let retryInitialBuffer = "";
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
              const thinkingDelta = data?.choices?.[0]?.delta?.reasoning_content ?? "";
              if (thinkingDelta) {
                targetMessage.thinking += thinkingDelta;
                if (retryRevealed) updateStreamingBubble(targetMessage);
              }
              if (delta) {
                if (!retryRevealed) {
                  retryInitialBuffer += delta;
                  if (retryInitialBuffer.length >= 25) {
                    targetMessage.content = retryInitialBuffer;
                    targetMessage.pending = false;
                    targetMessage.streaming = true;
                    renderMessages({ stickToBottom: true });
                    retryRevealed = true;
                  }
                } else {
                  targetMessage.content += delta;
                  updateStreamingBubble(targetMessage);
                }
              }
            } catch {}
          }
        }
      }

      if (!retryRevealed && retryInitialBuffer) {
        targetMessage.content = retryInitialBuffer;
        targetMessage.pending = false;
        targetMessage.streaming = true;
        renderMessages({ stickToBottom: true });
        retryRevealed = true;
      }
    }

    if (!targetMessage.content.trim()) {
      targetMessage.content = "本次没有返回可显示内容";
    }
  }

  if (speaker !== "导演 AI") {
    targetMessage.content = sanitizeNpcReplyStrict(session, speaker, targetMessage.content);
    targetMessage.content = stripThinkingLeakage(targetMessage.content);
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
  state.userScrolledAway = false;
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
