"use strict";

let compressPopoverHideTimer = null;
let lastPointerDownInChatMessages = false;

function isCompressionUiLocked() {
  return Boolean(document.querySelector(".app-shell")?.classList.contains("compress-lock"));
}

function normalizeUserInputText(value) {
  return String(value || "").replace(/\n{3,}/g, "\n\n");
}

function normalizeChatInputWhitespace() {
  if (!els.chatInput) return;
  const before = els.chatInput.value;
  const after = normalizeUserInputText(before);
  if (before === after) return;
  const start = els.chatInput.selectionStart ?? after.length;
  const end = els.chatInput.selectionEnd ?? after.length;
  const removedBeforeStart = before.slice(0, start).length - normalizeUserInputText(before.slice(0, start)).length;
  const removedBeforeEnd = before.slice(0, end).length - normalizeUserInputText(before.slice(0, end)).length;
  els.chatInput.value = after;
  els.chatInput.setSelectionRange(Math.max(0, start - removedBeforeStart), Math.max(0, end - removedBeforeEnd));
}

function clearCompressPopoverHideTimer() {
  if (compressPopoverHideTimer) {
    clearTimeout(compressPopoverHideTimer);
    compressPopoverHideTimer = null;
  }
}

function scheduleCompressPopoverHide() {
  clearCompressPopoverHideTimer();
  compressPopoverHideTimer = setTimeout(() => {
    compressPopoverHideTimer = null;
    if (!state.openCompressMemoryInfo) {
      hideCompressPopover();
      const popover = getCompressMemoryPopover();
      if (popover) {
        popover.style.setProperty("--memory-compress-popover-shift-x", "0px");
        popover.style.setProperty("--memory-compress-popover-shift-y", "0px");
        popover.style.maxHeight = "";
      }
    }
  }, 120);
}

function bindChat() {
  initChatOverscroll();
  els.sendBtn.addEventListener("click", function onSendClick() {
    warmChatRuntime();
    const session = getCurrentSession();
    if (state.isSending && session?.mode !== SESSION_MODE_CHAOS) {
      stopGeneration();
    } else {
      sendUserMessage();
    }
  });
  if (els.compressMemoryBtn) {
    ensureCompressMemoryPopover();
    els.compressMemoryBtn.addEventListener("click", (event) => {
      if (isCompressionUiLocked()) {
        return;
      }
      if (!event.target.closest(".memory-compress-ring")) {
        return;
      }
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
      if (isCompressionUiLocked()) {
        return;
      }
      clearCompressPopoverHideTimer();
      showCompressPopover();
    });
    els.compressMemoryBtn.addEventListener("pointerleave", () => {
      if (!state.openCompressMemoryInfo) {
        scheduleCompressPopoverHide();
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
      const session = getCurrentSession();
      if (!session) {
        return;
      }
      const current = els.modelThinkingBtn.dataset.state === "enabled" ? "disabled" : "enabled";
      els.modelThinkingBtn.dataset.state = current;
      setSessionSettingOverride(session, "modelThinking", current);
      touchSession(session);
      persistSessions();
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
        if (!session) {
          return;
        }
        const current = getSessionSetting(session, "modelThinking") === "enabled" ? "disabled" : "enabled";
        setSessionSettingOverride(session, "modelThinking", current);
        touchSession(session);
        persistSessions();
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

    if (event.key === "Enter" && !event.shiftKey && !isMobileViewport()) {
      event.preventDefault();
      sendUserMessage();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    lastPointerDownInChatMessages = Boolean(event.target.closest("#chatMessages"));
  }, { capture: true });
  document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "a") {
      return;
    }
    const active = document.activeElement;
    if (active?.closest?.("input, textarea, select, [contenteditable='true']")) {
      return;
    }
    const selection = window.getSelection();
    const anchorInMessages = Boolean(selection?.anchorNode && els.chatMessages?.contains(selection.anchorNode));
    if (!lastPointerDownInChatMessages && !anchorInMessages) {
      return;
    }
    if (!els.views.chat?.classList.contains("active") || !els.chatMessages?.childElementCount) {
      return;
    }
    event.preventDefault();
    const range = document.createRange();
    range.selectNodeContents(els.chatMessages);
    selection.removeAllRanges();
    selection.addRange(range);
  });
  els.chatInput.addEventListener("input", normalizeChatInputWhitespace);
  els.chatInput.addEventListener("input", warmChatRuntime, { once: true });
  els.chatInput.addEventListener("input", clearSuggestions);
  els.chatInput.addEventListener("input", handleMentionInput);
  els.chatInput.addEventListener("focus", () => {
    warmChatRuntime();
    shouldKeepBottomOnKeyboard = isChatNearBottom();
    if (shouldKeepBottomOnKeyboard) {
      settleChatBottomAfterViewportShift();
    }
  });
  if (els.suggestBtn) {
    els.suggestBtn.disabled = false;
    els.suggestBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (els.suggestBtn.classList.contains("generating")) {
        return;
      }
      generateSuggestions();
    });
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


function stopGeneration() {
  if (typeof window.__cancelChaosAutoplay === "function") {
    window.__cancelChaosAutoplay();
  }
  if (typeof window.__cancelAutoTtsTurn === "function") {
    window.__cancelAutoTtsTurn();
  }
  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
  }
  state.isSending = false;
  state._lastAbortAt = Date.now();
  clearInlineChatStatus();
  els.sendBtn.disabled = false;
  els.chatInput.disabled = false;
  finishUserTopAnchor();
  autoResizeChatInput();
  updateComposerMode();
  setText(els.chatStatus, t("chat.stopped"));
}

async function sendUserMessage() {
  const session = getCurrentSession();
  if (!session) {
    return;
  }
  const isChaosSending = session.mode === SESSION_MODE_CHAOS && state.isSending;
  if (!isChaosSending) {
    if (state.isSending) return;
    // 防止停止生成后快速重新提交导致消息重复
    if (state._lastAbortAt && Date.now() - state._lastAbortAt < 400) return;
  }

  clearSuggestions();

  normalizeChatInputWhitespace();
  const content = normalizeUserInputText(els.chatInput.value).trim();
  if (content && typeof window.__prepareAutoTtsTurn === "function") {
    window.__prepareAutoTtsTurn();
  }
  if (!content) {
    setText(els.chatStatus, "请先输入内容");
    return;
  }

  if (!isChaosSending) {
    state.isSending = true;
    if (els.thinkingPopover && !els.thinkingPopover.classList.contains("hidden")) {
      els.thinkingPopover.classList.add("hidden");
      els.thinkingPopover.classList.remove("visible");
      els.thinkingToggleBtn?.classList.remove("active");
    }
    els.sendBtn.disabled = true;
    els.chatInput.disabled = true;
    updateComposerMode();
  }

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
    if (session.mode === SESSION_MODE_CHAOS && session.chaosState && typeof session.chaosState === "object") {
      session.chaosState.autoplayStreak = 0;
    }
  }
  syncLoadedSessionMessageCount(session);

  touchSession(session);
  persistSessions();
  els.chatInput.value = "";
  autoResizeChatInput();
  renderMessages();
  renderChatListMenu();
  if (session.mode !== SESSION_MODE_CHAOS) {
    pinLastUserMessageToTop();
  }
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
          const savedSeq = window.__chatDB.updateMessage
            ? await window.__chatDB.updateMessage(session.id, lastUser, userSeq)
            : userSeq;
          if (!window.__chatDB.updateMessage) {
            await window.__chatDB.saveMessage(session.id, lastUser, userSeq);
          }
          session.messageCount = Math.max(Number(session.messageCount) || 0, Number(savedSeq) + 1);
        }
        await window.__chatDB.updateSessionMeta(session);
      } catch (err) {
        console.error("[chat] save user message failed", err);
        state.isSending = false;
        clearInlineChatStatus();
        els.sendBtn.disabled = false;
        els.chatInput.disabled = false;
        els.chatInput.value = content;
        autoResizeChatInput();
        updateComposerMode();
        renderMessages();
        setText(els.chatStatus, "用户消息保存失败，请稍后重试");
        return;
      }
    }
  }
  debugLog("turn", t("debug.msg.userMessageSubmitted"), {
    sessionId: session.id,
    editingMessageId: state.editingUserMessageId,
    content,
  });

  if (isChaosSending) {
    // 混沌模式生成中：不抢跑，autoplay 自然会把用户消息带进下一轮
    clearInlineChatStatus();
    els.sendBtn.disabled = false;
    els.chatInput.disabled = false;
    finishUserTopAnchor();
    autoResizeChatInput();
    updateComposerMode();
    return;
  }

  state.abortController = new AbortController();
  try {
    await ensureChatRuntimeLoaded();
  } catch (error) {
    console.error("[chat-runtime] load failed", error);
    state.isSending = false;
    state.abortController = null;
    els.sendBtn.disabled = false;
    els.chatInput.disabled = false;
    els.chatInput.value = content;
    autoResizeChatInput();
    updateComposerMode();
    setText(els.chatStatus, "聊天运行模块加载失败，请刷新后重试");
    return;
  }
  await runSessionTurn(session);
}

function isMobileTokenToggleMode() {
  return window.matchMedia("(hover: none), (pointer: coarse)").matches;
}

function getCompressMemoryPopover() {
  return els.compressMemoryBtn?.parentElement?.querySelector(".memory-compress-popover")
    || els.composerFooter?.querySelector(".memory-compress-popover")
    || null;
}

function ensureCompressMemoryPopover() {
  if (!els.compressMemoryBtn || !els.composerFooter) {
    debugLog("compress", t("debug.msg.popoverMountSkipped"), {
      hasButton: Boolean(els.compressMemoryBtn),
      hasFooter: Boolean(els.composerFooter),
    });
    return null;
  }
  const mount = els.compressMemoryBtn.parentElement || els.composerFooter;
  let popover = getCompressMemoryPopover();
  if (!popover) {
    popover = document.createElement("div");
    popover.className = "memory-compress-popover hidden";
    debugLog("compress", t("debug.msg.popoverMounted"));
  }
  if (popover.parentElement !== mount) {
    mount.appendChild(popover);
  }
  if (!popover.dataset.hoverBound) {
    popover.dataset.hoverBound = "true";
    popover.addEventListener("pointerenter", () => {
      clearCompressPopoverHideTimer();
      showCompressPopover();
    });
    popover.addEventListener("pointerleave", () => {
      if (!state.openCompressMemoryInfo) {
        scheduleCompressPopoverHide();
      }
    });
  }
  return popover;
}


function buildCompressionSegmentsMarkup(session) {
  var segments = Array.isArray(session?.compressionSegments) ? session.compressionSegments : [];
  if (!segments.length) return "";
  var itemsHtml = segments.map(function (seg, i) {
    var summary = String(seg.summary || "").trim();
    if (!summary) return "";
    var rangeLabel = Number.isFinite(seg.startSeq) && Number.isFinite(seg.endSeq)
      ? (seg.startSeq + 1) + "-" + (seg.endSeq + 1)
      : "#" + (i + 1);
    var bodyClass = summary.length > 200 || summary.split(/\n+/).filter(Boolean).length > 3 ? "collapsed" : "";
    return '<div class="memory-compress-segment' + (bodyClass ? " collapsed" : "") + '">'
      + '<div class="memory-compress-segment-range">' + t("chat.compressSegmentRange", { range: rangeLabel }) + "</div>"
      + '<div class="memory-compress-segment-body' + (bodyClass ? " collapsed" : "") + '">' + escapeHtml(summary).replace(/\n/g, "<br>") + "</div>"
      + (bodyClass ? '<button class="memory-compress-segment-toggle" type="button">' + t("chat.compressExpand") + "</button>" : "")
      + "</div>";
  }).filter(Boolean).join("");
  if (!itemsHtml) return "";
  var collapsed = segments.length > 2 ? " collapsed" : "";
  return '<div class="memory-compress-segments' + collapsed + '">'
    + '<div class="memory-compress-segments-head">' + t("chat.compressMetricSegments") + "</div>"
    + itemsHtml
    + (collapsed ? '<button class="memory-compress-segments-toggle" type="button">' + t("chat.compressExpandAll") + "</button>" : "")
    + "</div>";
}

function buildCompressMemoryPopoverMarkup(session) {
  const isSingleAi = session?.mode === SESSION_MODE_WORK && !session.directorModel && session.npcs?.length === 1;
  const metrics = isSingleAi ? buildChatContextTokenMetrics(session) : buildDirectorContextTokenMetrics(session);
  if (!metrics) {
    return "";
  }

  const contextPercent = Math.max(0, Math.min(100, Math.round((metrics.contextCurrent / Math.max(1, metrics.contextThreshold)) * 100)));
  const headText = isSingleAi ? t("chat.compressContextTitle") : t("chat.compressDirectorTitle");
  const progressTone = contextPercent >= 100 ? "full" : contextPercent >= 76 ? "high" : contextPercent >= 48 ? "mid" : "low";
  const summaryText = isSingleAi ? String(session?.chatSummary || "").trim() : String(session?.directorSummary || "").trim();
  const summaryMarkup = summaryText ? escapeHtml(summaryText).replace(/\n/g, "<br>") : "";
  const summaryCollapsed = summaryMarkup && (summaryText.length > 360 || summaryText.split(/\n+/).filter(Boolean).length > 3) ? "collapsed" : "expanded";
  const rows = [
    [t("chat.compressMetricContext"), `${formatTokenCount(metrics.contextCurrent)} / ${formatTokenCount(metrics.contextThreshold)}`],
  ];
  const segmentCount = Array.isArray(session?.compressionSegments) ? session.compressionSegments.length : 0;
  if (segmentCount > 0) {
    rows.push([t("chat.compressMetricSegments"), String(segmentCount)]);
  }
  if (isSingleAi && metrics.recentCount > 0) {
    rows.push([t("chat.compressMetricMessages"), String(metrics.recentCount)]);
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
      ${buildCompressionSegmentsMarkup(session)}
      ${summaryMarkup ? `
      <div class="memory-compress-summary ${summaryCollapsed}">
        <div class="memory-compress-summary-label">${isSingleAi ? t("chat.compressSummaryLabel") : t("chat.compressDirectorLabel")}</div>
        <div class="memory-compress-summary-body">${summaryMarkup}</div>
        <button class="memory-compress-summary-toggle" type="button">${summaryCollapsed === "collapsed" ? t("chat.compressExpand") : t("chat.compressCollapse")}</button>
      </div>
      ` : ""}
      <div class="memory-compress-popover-footer">
        <button class="memory-compress-popover-action" type="button"${state.isSending ? " disabled" : ""}>${t("chat.compressAction")}</button>
      </div>
    </div>
  `.trim();
}

function updateCompressMemoryButtonProgress(session) {
  if (!els.compressMemoryBtn) {
    return;
  }

  if (session?.mode === SESSION_MODE_CHAOS) {
    els.compressMemoryBtn.style.setProperty("--memory-compress-percent", "0");
    els.compressMemoryBtn.style.setProperty("--memory-compress-progress", "#5aa7ff");
    els.compressMemoryBtn.dataset.hasProgress = "false";
    els.compressMemoryBtn.setAttribute("aria-label", t("chat.compressMemory"));
    els.compressMemoryBtn.title = t("chat.compressMemory");
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
      ? t("chat.compressMemoryAria", { current: metrics.contextCurrent, threshold: metrics.contextThreshold, percent: contextPercent })
      : t("chat.compressMemory")
  );
  els.compressMemoryBtn.title = metrics
    ? t("chat.compressMemoryTitle", { current: metrics.contextCurrent, threshold: metrics.contextThreshold })
    : t("chat.compressMemory");
}

function showCompressPopover() {
  if (isCompressionUiLocked()) return;
  clearCompressPopoverHideTimer();
  const popover = getCompressMemoryPopover();
  if (!popover || popover.classList.contains("hidden")) return;
  popover.style.setProperty("transition", "opacity 0.18s ease");
  adjustCompressPopoverBoundary();
  popover.classList.add("visible");
  popover.getBoundingClientRect();
  popover.style.removeProperty("transition");
  // 移动端：阻止外层 .main 抢滚动
  popover.addEventListener("touchmove", preventPopoverScrollEscape, { passive: false });
}

function hideCompressPopover() {
  clearCompressPopoverHideTimer();
  const popover = getCompressMemoryPopover();
  if (!popover) return;
  popover.classList.remove("visible");
  popover.removeEventListener("touchmove", preventPopoverScrollEscape);
}

function preventPopoverScrollEscape(e) {
  e.stopPropagation();
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
  if (session?.mode === SESSION_MODE_CHAOS) {
    updateCompressMemoryButtonProgress(session);
    popover.innerHTML = "";
    popover.classList.add("hidden");
    els.compressMemoryBtn.classList.remove("info-open");
    return;
  }
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
  // Segment toggles
  var segmentsWrap = popover.querySelector(".memory-compress-segments");
  var segmentsToggle = popover.querySelector(".memory-compress-segments-toggle");
  if (segmentsWrap && segmentsToggle) {
    segmentsToggle.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      var isCollapsed = segmentsWrap.classList.toggle("collapsed");
      segmentsToggle.textContent = isCollapsed ? t("chat.compressExpandAll") : t("chat.compressCollapseAll");
      segmentsWrap.querySelectorAll(".memory-compress-segment").forEach(function (seg) {
        seg.classList.remove("collapsed");
      });
      segmentsWrap.querySelectorAll(".memory-compress-segment-body").forEach(function (body) {
        body.classList.remove("collapsed");
      });
      segmentsWrap.querySelectorAll(".memory-compress-segment-toggle").forEach(function (btn) {
        if (btn) btn.textContent = t("chat.compressCollapse");
      });
    };
  }
  popover.querySelectorAll(".memory-compress-segment-toggle").forEach(function (btn) {
    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      var seg = btn.closest(".memory-compress-segment");
      if (!seg) return;
      var body = seg.querySelector(".memory-compress-segment-body");
      if (body) body.classList.toggle("collapsed");
      seg.classList.toggle("collapsed");
      btn.textContent = seg.classList.contains("collapsed") ? t("chat.compressExpand") : t("chat.compressCollapse");
    };
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
      void ensureChatRuntimeLoaded()
        .then(() => triggerManualDirectorCompression())
        .catch((error) => {
          console.error("[chat-runtime] load failed", error);
          setText(els.chatStatus, "聊天运行模块加载失败，请刷新后重试");
        });
    };
    debugLog("compress", t("debug.msg.popoverActionBound"), {
      disabled: actionBtn.disabled,
    });
  } else {
    debugLog("compress", t("debug.msg.popoverActionMissing"));
  }
}

function adjustCompressPopoverBoundary() {
  const popover = getCompressMemoryPopover();
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
  els.modelThinkingBtn.textContent = t("chat.agentThinking");
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
  const enabled = getSessionSetting(session, "modelThinking") === "enabled";
  els.thinkingToggleBtn.classList.toggle("single-model-thinking", singleModel);
  els.thinkingToggleBtn.classList.toggle("state-enabled", singleModel && enabled);
  els.thinkingToggleBtn.classList.toggle("state-disabled", singleModel && !enabled);
  els.thinkingToggleBtn.textContent = singleModel ? t("chat.deepThinking") : t("chat.thinkingSettings");
  els.thinkingToggleBtn.setAttribute("aria-pressed", singleModel ? String(enabled) : "false");
  if (singleModel && els.thinkingPopover) {
    els.thinkingPopover.classList.add("hidden");
    els.thinkingPopover.classList.remove("visible");
    els.thinkingToggleBtn.classList.remove("active");
  }
}

function getModelThinkingState() {
  return getSessionSetting("modelThinking") || "disabled";
}

function buildModelThinkingExtra(modelName) {
  return buildThinkingExtra(modelName, getModelThinkingState());
}

function shouldRenderThinkingForModel(modelName) {
  const name = (modelName || "").toLowerCase();
  if (name.includes("claude") && getModelThinkingState() === "disabled") {
    return false;
  }
  return true;
}

// 移动端会话消息区底部超拖弹性效果
// 仅作用于 .chat-messages，底部输入框不动
// 使用 GPU 合成 transform 实现，避免主线程重排抖动
function initChatOverscroll() {
  if (!isMobileViewport()) return;

  var MAX_PX = 60;
  var RELEASE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
  var main = document.querySelector(".main");
  if (!main) return;

  var msgEl = null;
  var overscrolling = false;
  var anchorY = 0;

  function el() {
    if (!msgEl) msgEl = document.querySelector("#chatView .chat-messages");
    return msgEl;
  }

  function damp(dist) {
    var safe = Math.max(0, dist);
    if (!safe) return 0;
    return (safe * MAX_PX) / (safe + MAX_PX);
  }

  function chatActive() {
    var cv = document.getElementById("chatView");
    return !!(cv && cv.classList.contains("active"));
  }

  main.addEventListener("touchstart", function () {
    if (!chatActive() || state.sidebarDragging) return;
    overscrolling = false;
    anchorY = 0;
    var m = el();
    if (m) m.style.transition = "none";
  }, { passive: true });

  main.addEventListener("touchmove", function (e) {
    if (!chatActive() || state.sidebarDragging) return;
    var m = el();
    if (!m) return;

    var touchY = e.touches[0].clientY;
    var atBottom = main.scrollTop + main.clientHeight >= main.scrollHeight - 3;

    if (!atBottom) {
      anchorY = 0;
      return;
    }

    if (!anchorY) {
      anchorY = touchY;
      try { e.preventDefault(); } catch (_) {}
      m.style.willChange = "transform";
      return;
    }

    var dragPast = anchorY - touchY;
    if (dragPast < 0) {
      anchorY = touchY;
      if (overscrolling) {
        overscrolling = false;
        m.style.transform = "";
        m.style.willChange = "";
      }
      return;
    }

    overscrolling = true;
    try { e.preventDefault(); } catch (_) {}
    m.style.transform = "translateY(" + (-damp(dragPast)) + "px)";
  }, { passive: false });

  function release() {
    if (!overscrolling) return;
    overscrolling = false;
    anchorY = 0;

    var m = el();
    if (!m) return;

    m.style.transition = "transform 0.22s " + RELEASE_EASING;
    m.style.transform = "";
    m.addEventListener("transitionend", function () {
      m.style.transition = "";
      m.style.willChange = "";
    }, { once: true });
  }

  main.addEventListener("touchend", release, { passive: true });
  main.addEventListener("touchcancel", release, { passive: true });
}
