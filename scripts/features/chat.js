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
      updateThinkingDepthVisibility();
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
  initThinkingDepthSelector();
  initImageLightbox();
  initTextPreview();
  initAttachmentHandlers();
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
  if (!session || state.isSwitchingTurnVariant) {
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
  const textContent = normalizeUserInputText(els.chatInput.value).trim();
  const hasAttachments = _pendingAttachments.length > 0;
  if (textContent && typeof window.__prepareAutoTtsTurn === "function") {
    window.__prepareAutoTtsTurn();
  }
  if (!textContent && !hasAttachments) {
    setText(els.chatStatus, "请先输入内容");
    return;
  }

  const content = hasAttachments ? buildImageContent(_pendingAttachments, textContent) : textContent;

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
    finalizeLatestTurnVariants(session);
    try {
      await applyUserMessageEdit(session, state.editingUserMessageId, content);
    } catch (error) {
      state.isSending = false;
      clearInlineChatStatus();
      els.sendBtn.disabled = false;
      els.chatInput.disabled = false;
      restoreComposerContent(content);
      updateComposerMode();
      setText(els.chatStatus, "修改失败：无法清理后续消息");
      console.error("[chat] edit cleanup failed", error);
      return;
    }
    const editedUserMessage = session.messages.find((message) =>
      message?.id === editingUserMessageId && message.role === "user"
    );
    setLatestTurnBaseState(session, editedUserMessage);
    state.editingUserMessageId = null;
  } else {
    finalizeLatestTurnVariants(session);
    const nextUserMessage = {
      id: createMessageId("user"),
      role: "user",
      speaker: "你",
      content,
      createdAt: new Date().toISOString(),
    };
    session.messages.push(nextUserMessage);
    setLatestTurnBaseState(session, nextUserMessage);
    if (session.mode === SESSION_MODE_CHAOS && session.chaosState && typeof session.chaosState === "object") {
      session.chaosState.autoplayStreak = 0;
    }
  }
  syncLoadedSessionMessageCount(session);

  touchSession(session);
  persistSessions();
  els.chatInput.value = "";
  clearPendingAttachments();
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
        restoreComposerContent(content);
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
    restoreComposerContent(content);
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
  updateThinkingDepthVisibility();
}

function getModelThinkingState() {
  return getSessionSetting("modelThinking") || "disabled";
}

function getModelThinkingDepth() {
  return getSessionSetting("modelThinkingDepth") || "medium";
}

function buildModelThinkingExtra(modelName) {
  return buildThinkingExtra(modelName, getModelThinkingState(), getModelThinkingDepth());
}

function shouldRenderThinkingForModel(modelName) {
  const name = (modelName || "").toLowerCase();
  if (name.includes("claude") && getModelThinkingState() === "disabled") {
    return false;
  }
  return true;
}

function getActiveWorkModel() {
  var session = getCurrentSession();
  if (!session) return null;
  if (session.directorModel) return session.directorModel;
  var npcs = session.npcs || [];
  if (npcs.length === 1) return npcs[0].model;
  return null;
}

function updateThinkingDepthVisibility() {
  if (!els.thinkingDepthWrap) return;
  var session = getCurrentSession();
  var singleModel = isSingleModelWorkSession(session);
  var enabled = getSessionSetting(session, "modelThinking") === "enabled";
  var model = getActiveWorkModel();
  var supports = singleModel && enabled && model && typeof modelSupportsReasoningDepth === "function" && modelSupportsReasoningDepth(model);
  els.thinkingDepthWrap.classList.toggle("hidden", !supports);
  if (supports) {
    var depth = getSessionSetting(session, "modelThinkingDepth") || "medium";
    els.thinkingDepthBtn.textContent = t(REASONING_DEPTH_LABELS[depth]) || depth;
  }
}

function initThinkingDepthSelector() {
  if (!els.thinkingDepthBtn) return;
  els.thinkingDepthBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (!els.thinkingDepthDropdown) return;
    els.thinkingDepthDropdown.classList.toggle("hidden");
  });
  if (els.thinkingDepthDropdown) {
    els.thinkingDepthDropdown.addEventListener("click", function (e) {
      e.stopPropagation();
      var option = e.target.closest(".thinking-depth-option");
      if (!option) return;
      var depth = option.dataset.depth;
      var session = getCurrentSession();
      if (session) {
        setSessionSettingOverride(session, "modelThinkingDepth", depth);
      }
      els.thinkingDepthBtn.textContent = t(REASONING_DEPTH_LABELS[depth]) || depth;
      els.thinkingDepthDropdown.classList.add("hidden");
    });
  }
  document.addEventListener("click", function () {
    if (els.thinkingDepthDropdown) els.thinkingDepthDropdown.classList.add("hidden");
  });
}

/* ========== 图片附件 ========== */
var _pendingAttachments = [];
var _imageLightboxReturnFocus = null;
var _imageLightboxPositionFrame = 0;
var _lightboxZoom = { scale: 1, tx: 0, ty: 0, dragging: false, moved: false, dragStartX: 0, dragStartY: 0, dragTx: 0, dragTy: 0 };
var _touchPinch = { prevDist: 0, scale: 1, tx: 0, ty: 0, cx: 0, cy: 0 };
var _touchPanning = false;
var _touchPanStart = { x: 0, y: 0, tx: 0, ty: 0 };
var _textPreviewReturnFocus = null;
var _textPreviewPositionFrame = 0;

function syncTextPreviewBounds() {
  var preview = document.getElementById("textFilePreview");
  if (!preview) return;
  preview.style.left = "";
  preview.style.top = "";
  preview.style.width = "";
  preview.style.height = "";
  _textPreviewPositionFrame = 0;
}

function syncImageLightboxBounds() {
  var lightbox = document.getElementById("imageLightbox");
  if (!lightbox) return;
  lightbox.style.left = "";
  lightbox.style.top = "";
  lightbox.style.width = "";
  lightbox.style.height = "";
  _imageLightboxPositionFrame = 0;
}

function resetLightboxZoom() {
  _lightboxZoom.scale = 1;
  _lightboxZoom.tx = 0;
  _lightboxZoom.ty = 0;
  _lightboxZoom.dragging = false;
  _lightboxZoom.moved = false;
}

function updateLightboxTransform() {
  var preview = document.querySelector(".image-lightbox-preview");
  if (!preview) return;
  var z = _lightboxZoom;
  preview.style.transform = "translate(" + z.tx + "px, " + z.ty + "px) scale(" + z.scale + ")";
  updateLightboxScaleBadge();
}

function updateLightboxScaleBadge() {
  var lightbox = document.getElementById("imageLightbox");
  var badge = lightbox?.querySelector(".image-lightbox-scale");
  if (!badge) return;
  badge.textContent = Math.round(_lightboxZoom.scale * 100) + "%";
  badge.classList.toggle("visible", _lightboxZoom.scale > 1.02);
}

function clampLightboxPan() {
  var lightbox = document.getElementById("imageLightbox");
  var preview = lightbox?.querySelector(".image-lightbox-preview");
  if (!preview || !lightbox?.classList.contains("open")) return;
  var z = _lightboxZoom;
  if (z.scale <= 1) {
    z.tx = 0;
    z.ty = 0;
    return;
  }
  var r = preview.getBoundingClientRect();
  var lb = lightbox.getBoundingClientRect();
  var baseWidth = r.width / z.scale;
  var baseHeight = r.height / z.scale;
  var maxX = Math.max(0, (baseWidth * z.scale - lb.width) / 2 + 32);
  var maxY = Math.max(0, (baseHeight * z.scale - lb.height) / 2 + 32);
  z.tx = Math.max(-maxX, Math.min(maxX, z.tx));
  z.ty = Math.max(-maxY, Math.min(maxY, z.ty));
}

function setLightboxScaleAt(clientX, clientY, nextScale, animated) {
  var lightbox = document.getElementById("imageLightbox");
  var preview = lightbox?.querySelector(".image-lightbox-preview");
  if (!preview || !lightbox?.classList.contains("open")) return;
  var z = _lightboxZoom;
  var oldScale = z.scale || 1;
  var newScale = Math.min(5, Math.max(1, nextScale));
  var rect = preview.getBoundingClientRect();
  var centerX = rect.left + rect.width / 2;
  var centerY = rect.top + rect.height / 2;
  var actualDelta = newScale / oldScale;
  z.tx = z.tx + (clientX - centerX) * (1 - actualDelta);
  z.ty = z.ty + (clientY - centerY) * (1 - actualDelta);
  z.scale = newScale;
  if (z.scale <= 1.01) {
    z.scale = 1;
    z.tx = 0;
    z.ty = 0;
  }
  clampLightboxPan();
  preview.style.transition = animated ? "transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1)" : "none";
  updateLightboxTransform();
  if (animated) setTimeout(function () { preview.style.transition = "none"; }, 190);
}

function resetImageLightboxView(animated) {
  var preview = document.querySelector(".image-lightbox-preview");
  if (!preview) return;
  _lightboxZoom.scale = 1;
  _lightboxZoom.tx = 0;
  _lightboxZoom.ty = 0;
  _lightboxZoom.dragging = false;
  _lightboxZoom.moved = false;
  preview.style.transition = animated ? "transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1)" : "none";
  updateLightboxTransform();
  if (animated) setTimeout(function () { preview.style.transition = "none"; }, 190);
}

async function openLightboxImageInNewTab() {
  var preview = document.querySelector(".image-lightbox-preview");
  if (!preview?.src) return;
  var imageUrl = preview.currentSrc || preview.src;
  var opened = window.open("about:blank", "_blank");
  if (!opened) {
    window.open(imageUrl, "_blank", "noopener");
    return;
  }
  try { opened.opener = null; } catch (_) {}
  try {
    var response = await fetch(imageUrl);
    var blob = await response.blob();
    var objectUrl = URL.createObjectURL(blob);
    opened.location.href = objectUrl;
    setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 60000);
  } catch (err) {
    opened.location.href = imageUrl;
  }
}

function closeImageLightbox() {
  var lightbox = document.getElementById("imageLightbox");
  if (!lightbox || !lightbox.classList.contains("open")) return;
  lightbox.classList.remove("open");
  lightbox.setAttribute("aria-hidden", "true");
  lightbox.hidden = true;
  document.querySelector(".main")?.classList.remove("image-lightbox-open");
  document.body.classList.remove("image-lightbox-open");
  cancelAnimationFrame(_imageLightboxPositionFrame);
  _imageLightboxPositionFrame = 0;
  resetLightboxZoom();
  updateLightboxScaleBadge();

  var returnFocus = _imageLightboxReturnFocus;
  _imageLightboxReturnFocus = null;
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
}

function openImageLightbox(image) {
  closeTextPreview();
  var lightbox = document.getElementById("imageLightbox");
  var preview = lightbox?.querySelector(".image-lightbox-preview");
  if (!lightbox || !preview || !image?.src) return;

  _imageLightboxReturnFocus = image;
  preview.src = image.currentSrc || image.src;
  preview.alt = image.alt || "图片预览";
  resetLightboxZoom();
  preview.style.transition = "none";
  preview.style.transform = "scale(0.97)";
  lightbox.hidden = false;
  lightbox.classList.add("open");
  lightbox.setAttribute("aria-hidden", "false");
  document.querySelector(".main")?.classList.add("image-lightbox-open");
  document.body.classList.add("image-lightbox-open");
  cancelAnimationFrame(_imageLightboxPositionFrame);
  syncImageLightboxBounds();
  requestAnimationFrame(function () {
    preview.style.transition = "transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1)";
    updateLightboxTransform();
    setTimeout(function () { preview.style.transition = "none"; }, 180);
  });
  lightbox.querySelector(".image-lightbox-close")?.focus({ preventScroll: true });
}

function updateTextPreviewSearch(preview, direction, keepSearchFocus) {
  var contentEl = preview?.querySelector(".text-preview-content");
  var input = preview?.querySelector(".text-preview-search");
  var count = preview?.querySelector(".text-preview-search-count");
  if (!contentEl || !input || !count) return;

  var query = input.value;
  if (!query) {
    count.textContent = "";
    contentEl.textContent = contentEl.textContent;
    return;
  }

  var source = contentEl.textContent;
  var lowerSource = source.toLocaleLowerCase();
  var needle = query.toLocaleLowerCase();
  var matches = [];
  var from = 0;
  while (from < lowerSource.length) {
    var index = lowerSource.indexOf(needle, from);
    if (index < 0) break;
    matches.push(index);
    from = index + Math.max(1, needle.length);
  }

  if (!matches.length) {
    count.textContent = "0/0";
    contentEl.textContent = source;
    return;
  }

  if (direction === 0) {
    preview.dataset.searchIndex = "-1";
    count.textContent = matches.length + " 处";
    contentEl.innerHTML = highlightMatches(source, matches, query.length, -1);
    return;
  }

  var current = Number(preview.dataset.searchIndex || -1);
  current = direction < 0
    ? (current <= 0 ? matches.length - 1 : current - 1)
    : (current + 1) % matches.length;
  preview.dataset.searchIndex = current;
  count.textContent = (current + 1) + "/" + matches.length;

  contentEl.innerHTML = highlightMatches(source, matches, query.length, current);

  var currentMark = contentEl.querySelector("mark.current");
  if (currentMark) {
    currentMark.scrollIntoView({ block: "center", behavior: "instant" });
  }

  if (keepSearchFocus) input.focus({ preventScroll: true });
}

function highlightMatches(source, matches, matchLen, currentIndex) {
  var result = "";
  var lastIndex = 0;

  function esc(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  for (var i = 0; i < matches.length; i++) {
    var pos = matches[i];
    result += esc(source.slice(lastIndex, pos));
    var matchText = esc(source.slice(pos, pos + matchLen));
    if (i === currentIndex) {
      result += '<mark class="current">' + matchText + "</mark>";
    } else {
      result += "<mark>" + matchText + "</mark>";
    }
    lastIndex = pos + matchLen;
  }
  result += esc(source.slice(lastIndex));
  return result;
}

function closeTextPreview() {
  var preview = document.getElementById("textFilePreview");
  if (!preview || !preview.classList.contains("open")) return;
  preview.classList.remove("open");
  preview.setAttribute("aria-hidden", "true");
  preview.hidden = true;
  document.querySelector(".main")?.classList.remove("image-lightbox-open");
  document.body.classList.remove("image-lightbox-open");
  cancelAnimationFrame(_textPreviewPositionFrame);
  _textPreviewPositionFrame = 0;

  var returnFocus = _textPreviewReturnFocus;
  _textPreviewReturnFocus = null;
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
}

function openTextPreview(trigger) {
  var file = trigger?._textFile;
  var preview = document.getElementById("textFilePreview");
  if (!file || !preview) return;

  closeImageLightbox();
  _textPreviewReturnFocus = trigger;
  preview._textFile = file;
  preview.dataset.searchIndex = "-1";
  preview.querySelector(".text-preview-name").textContent = file.name || "附件.txt";
  preview.querySelector(".text-preview-meta").textContent = "TXT · " + formatAttachmentSize(file.size);
  preview.querySelector(".text-preview-content").textContent = String(file.content || "");
  preview.querySelector(".text-preview-search").value = "";
  preview.querySelector(".text-preview-search-count").textContent = "";
  preview.classList.remove("search-open");
  preview.hidden = false;
  preview.classList.add("open");
  preview.setAttribute("aria-hidden", "false");
  document.querySelector(".main")?.classList.add("image-lightbox-open");
  document.body.classList.add("image-lightbox-open");
  cancelAnimationFrame(_textPreviewPositionFrame);
  syncTextPreviewBounds();
  preview.querySelector(".text-preview-close")?.focus({ preventScroll: true });
}

function initTextPreview() {
  if (document.getElementById("textFilePreview")) return;

  var preview = document.createElement("div");
  preview.id = "textFilePreview";
  preview.className = "text-preview";
  preview.setAttribute("role", "dialog");
  preview.setAttribute("aria-modal", "true");
  preview.setAttribute("aria-label", "TXT 文件预览");
  preview.setAttribute("aria-hidden", "true");
  preview.hidden = true;
  preview.innerHTML = [
    '<section class="text-preview-panel">',
    '<header class="text-preview-head">',
    '<div class="text-preview-title"><i data-lucide="file-text"></i><span><strong class="text-preview-name"></strong><small class="text-preview-meta"></small></span></div>',
    '<div class="text-preview-actions">',
    '<button class="text-preview-copy" type="button" title="复制全文"><i data-lucide="copy"></i><span>复制</span></button>',
    '<button class="text-preview-download" type="button" title="下载文件"><i data-lucide="download"></i><span>下载</span></button>',
    '<button class="text-preview-close" type="button" title="关闭" aria-label="关闭 TXT 预览"><i data-lucide="x"></i></button>',
    "</div>",
    "</header>",
    '<div class="text-preview-search-row">',
    '<i data-lucide="search"></i><input class="text-preview-search" type="search" placeholder="搜索文件内容">',
    '<span class="text-preview-search-count"></span>',
    '<button class="text-preview-search-prev" type="button" title="上一个"><i data-lucide="chevron-up"></i></button>',
    '<button class="text-preview-search-next" type="button" title="下一个"><i data-lucide="chevron-down"></i></button>',
    "</div>",
    '<div class="text-preview-content" spellcheck="false" aria-label="TXT 文件内容"></div>',
    "</section>",
  ].join("");
  document.body.appendChild(preview);
  var searchToggle = document.createElement("button");
  searchToggle.className = "text-preview-search-toggle";
  searchToggle.type = "button";
  searchToggle.title = "搜索内容";
  searchToggle.setAttribute("aria-label", "搜索内容");
  searchToggle.innerHTML = '<i data-lucide="search"></i><span>搜索</span>';
  preview.querySelector(".text-preview-actions")?.prepend(searchToggle);
  lucide.createIcons();

  preview.addEventListener("click", function (event) {
    if (event.target === preview || event.target.closest(".text-preview-close")) {
      closeTextPreview();
      return;
    }
    var file = preview._textFile || {};
    if (event.target.closest(".text-preview-search-toggle")) {
      var searchInput = preview.querySelector(".text-preview-search");
      var isOpen = preview.classList.toggle("search-open");
      if (isOpen) {
        searchInput?.focus({ preventScroll: true });
      } else {
        if (searchInput) searchInput.value = "";
        preview.querySelector(".text-preview-search-count").textContent = "";
        preview.dataset.searchIndex = "-1";
      }
      return;
    }
    if (event.target.closest(".text-preview-copy")) {
      navigator.clipboard.writeText(String(file.content || ""))
        .then(function () { showToast("TXT 内容已复制", "success", 1800); })
        .catch(function () { showToast("复制失败，请手动选择文本", "error", 2200); });
    } else if (event.target.closest(".text-preview-download")) {
      var blob = new Blob([String(file.content || "")], { type: "text/plain;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = String(file.name || "附件.txt");
      link.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 0);
    } else if (event.target.closest(".text-preview-search-prev")) {
      updateTextPreviewSearch(preview, -1);
    } else if (event.target.closest(".text-preview-search-next")) {
      updateTextPreviewSearch(preview, 1);
    }
  });

  preview.querySelector(".text-preview-search").addEventListener("input", function () {
    preview.dataset.searchIndex = "-1";
    updateTextPreviewSearch(preview, 0);
  });
  preview.querySelector(".text-preview-search").addEventListener("keydown", function (event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    updateTextPreviewSearch(preview, event.shiftKey ? -1 : 1, true);
  });

  document.addEventListener("click", function (event) {
    var card = event.target.closest(".message-file-card, .attachment-thumb.attachment-text");
    if (!card || event.target.closest(".attachment-remove")) return;
    event.stopPropagation();
    openTextPreview(card);
  }, true);

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && preview.classList.contains("open")) {
      event.preventDefault();
      closeTextPreview();
      return;
    }
    if ((event.key === "Enter" || event.key === " ") &&
        event.target.matches(".message-file-card, .attachment-thumb.attachment-text")) {
      event.preventDefault();
      openTextPreview(event.target);
    }
  });
}

function initImageLightbox() {
  if (document.getElementById("imageLightbox")) return;

  var lightbox = document.createElement("div");
  lightbox.id = "imageLightbox";
  lightbox.className = "image-lightbox";
  lightbox.setAttribute("role", "dialog");
  lightbox.setAttribute("aria-modal", "true");
  lightbox.setAttribute("aria-label", "图片预览");
  lightbox.setAttribute("aria-hidden", "true");
  lightbox.hidden = true;
  lightbox.innerHTML = [
    '<button class="image-lightbox-close" type="button" aria-label="关闭图片预览" title="关闭">',
    '<i data-lucide="x"></i>',
    "</button>",
    '<img class="image-lightbox-preview" alt="图片预览" draggable="false">',
  ].join("");
  document.body.appendChild(lightbox);
  var scaleBadge = document.createElement("div");
  scaleBadge.className = "image-lightbox-scale";
  scaleBadge.setAttribute("aria-hidden", "true");
  scaleBadge.textContent = "100%";
  lightbox.appendChild(scaleBadge);
  var toolbar = document.createElement("div");
  toolbar.className = "image-lightbox-toolbar";
  toolbar.setAttribute("aria-label", "图片预览操作");
  toolbar.innerHTML = [
    '<button class="image-lightbox-reset" type="button" aria-label="重置缩放" title="重置缩放"><i data-lucide="rotate-ccw"></i></button>',
    '<button class="image-lightbox-open-original" type="button" aria-label="打开原图" title="打开原图"><i data-lucide="external-link"></i></button>',
  ].join("");
  lightbox.appendChild(toolbar);
  lucide.createIcons();

  lightbox.addEventListener("click", function (event) {
    if (event.target.closest(".image-lightbox-reset")) {
      resetImageLightboxView(true);
      return;
    }
    if (event.target.closest(".image-lightbox-open-original")) {
      openLightboxImageInNewTab();
      return;
    }
    if (_lightboxZoom.moved) {
      _lightboxZoom.moved = false;
      return;
    }
    if (event.target === lightbox || event.target.closest(".image-lightbox-close")) {
      closeImageLightbox();
    }
  });

  lightbox.addEventListener("wheel", function (e) {
    if (!lightbox.classList.contains("open")) return;
    if (e.target.closest(".image-lightbox-close")) return;
    if (e.target.closest(".image-lightbox-toolbar")) return;
    e.preventDefault();
    var preview = lightbox.querySelector(".image-lightbox-preview");
    if (!preview) return;
    var z = _lightboxZoom;
    var delta = e.deltaY > 0 ? 0.9 : 1.1;
    setLightboxScaleAt(e.clientX, e.clientY, z.scale * delta, false);
  }, { passive: false });

  lightbox.addEventListener("mousedown", function (e) {
    if (e.target.closest(".image-lightbox-close")) return;
    if (e.target.closest(".image-lightbox-toolbar")) return;
    if (_lightboxZoom.scale <= 1) return;
    e.preventDefault();
    var z = _lightboxZoom;
    z.dragging = true;
    z.moved = false;
    z.dragStartX = e.clientX;
    z.dragStartY = e.clientY;
    z.dragTx = z.tx;
    z.dragTy = z.ty;
    document.querySelector(".image-lightbox-preview")?.classList.add("dragging");
  });

  document.addEventListener("mousemove", function (e) {
    var z = _lightboxZoom;
    if (!z.dragging) return;
    var dx = e.clientX - z.dragStartX;
    var dy = e.clientY - z.dragStartY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) z.moved = true;
    z.tx = z.dragTx + dx;
    z.ty = z.dragTy + dy;
    var preview = document.querySelector(".image-lightbox-preview");
    if (preview) {
      preview.style.transition = "none";
      clampLightboxPan();
      updateLightboxTransform();
    }
  });

  document.addEventListener("mouseup", function () {
    var z = _lightboxZoom;
    if (!z.dragging) return;
    z.dragging = false;
    document.querySelector(".image-lightbox-preview")?.classList.remove("dragging");
  });

  lightbox.addEventListener("dblclick", function (e) {
    if (e.target.closest(".image-lightbox-close")) return;
    if (e.target.closest(".image-lightbox-toolbar")) return;
    var z = _lightboxZoom;
    if (z.scale > 1) {
      resetImageLightboxView(true);
    } else {
      setLightboxScaleAt(e.clientX, e.clientY, 2.5, true);
    }
  });

  lightbox.addEventListener("touchstart", function (e) {
    if (e.target.closest(".image-lightbox-close")) return;
    if (e.target.closest(".image-lightbox-toolbar")) return;
    var touches = e.touches;
    if (touches.length === 2) {
      var t = _touchPinch;
      t.prevDist = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
      t.scale = _lightboxZoom.scale;
      t.tx = _lightboxZoom.tx;
      t.ty = _lightboxZoom.ty;
      t.cx = (touches[0].clientX + touches[1].clientX) / 2;
      t.cy = (touches[0].clientY + touches[1].clientY) / 2;
    } else if (touches.length === 1 && _lightboxZoom.scale > 1) {
      _touchPanning = true;
      _touchPanStart.x = touches[0].clientX;
      _touchPanStart.y = touches[0].clientY;
      _touchPanStart.tx = _lightboxZoom.tx;
      _touchPanStart.ty = _lightboxZoom.ty;
    }
  }, { passive: true });

  lightbox.addEventListener("touchmove", function (e) {
    var z = _lightboxZoom;
    var preview = lightbox.querySelector(".image-lightbox-preview");
    if (!preview) return;
    var touches = e.touches;
    if (touches.length === 2) {
      e.preventDefault();
      var t = _touchPinch;
      var dist = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
      var incRatio = dist / t.prevDist;
      t.prevDist = dist;
      var cx = (touches[0].clientX + touches[1].clientX) / 2;
      var cy = (touches[0].clientY + touches[1].clientY) / 2;
      setLightboxScaleAt(cx, cy, z.scale * incRatio, false);
    } else if (touches.length === 1 && _touchPanning) {
      e.preventDefault();
      z.tx = _touchPanStart.tx + (touches[0].clientX - _touchPanStart.x);
      z.ty = _touchPanStart.ty + (touches[0].clientY - _touchPanStart.y);
      preview.style.transition = "none";
      clampLightboxPan();
      updateLightboxTransform();
    }
  }, { passive: false });

  lightbox.addEventListener("touchend", function () {
    _touchPanning = false;
    if (_lightboxZoom.scale <= 1.01) resetImageLightboxView(false);
  });

  document.addEventListener("click", function (event) {
    var image = event.target.closest(".message-image, .chat-content-image, .attachment-thumb img");
    if (!image || event.target.closest(".attachment-remove")) return;
    event.stopPropagation();
    openImageLightbox(image);
  }, true);

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && lightbox.classList.contains("open")) {
      event.preventDefault();
      closeImageLightbox();
      return;
    }
    if ((event.key === "Enter" || event.key === " ") &&
        event.target.matches(".message-image, .chat-content-image, .attachment-thumb img")) {
      event.preventDefault();
      openImageLightbox(event.target);
    }
  });
}

function getUserContentText(content) {
  if (!Array.isArray(content)) return String(content || "");
  return content
    .filter(function (part) { return part?.type === "text"; })
    .map(function (part) { return String(part.text || ""); })
    .join("");
}

function restoreComposerContent(content) {
  els.chatInput.value = getUserContentText(content);
  _pendingAttachments = [];

  if (Array.isArray(content)) {
    var imageIndex = 0;
    content.forEach(function (part) {
      if (part?.type === "image_url" && part.image_url?.url) {
        imageIndex += 1;
        var dataUrl = String(part.image_url.url);
        var mimeMatch = dataUrl.match(/^data:([^;,]+)[;,]/);
        var base64Match = dataUrl.match(/^data:[^;,]+;base64,(.*)$/s);
        _pendingAttachments.push({
          kind: "image",
          name: "附件图片 " + imageIndex,
          size: base64Match?.[1] ? Math.floor(base64Match[1].length * 3 / 4) : 0,
          type: mimeMatch?.[1] || "image/*",
          dataUrl: dataUrl,
        });
      } else if (part?.type === "file_text") {
        var file = part.file_text || {};
        _pendingAttachments.push({
          kind: "text",
          name: String(file.name || "附件.txt"),
          size: Number(file.size || 0),
          type: String(file.mediaType || "text/plain"),
          content: String(file.content || ""),
        });
      }
    });
  }

  renderAttachmentPreview();
  autoResizeChatInput();
}

function clearPendingAttachments() {
  _pendingAttachments = [];
  renderAttachmentPreview();
}

function renderAttachmentPreview() {
  if (!els.attachmentPreview) return;
  els.attachmentPreview.innerHTML = "";
  if (!_pendingAttachments.length) {
    els.attachmentPreview.classList.remove("has-attachments");
    return;
  }
  els.attachmentPreview.classList.add("has-attachments");
  _pendingAttachments.forEach(function (att, idx) {
    var thumb = document.createElement("div");
    thumb.className = "attachment-thumb" + (att.kind === "text" ? " attachment-text" : "");
    if (att.kind === "text") {
      thumb._textFile = att;
      thumb.setAttribute("role", "button");
      thumb.setAttribute("aria-label", "预览 TXT 文件 " + att.name);
      thumb.title = "点击预览 TXT 文件";
      thumb.tabIndex = 0;
      var icon = document.createElement("i");
      icon.setAttribute("data-lucide", "file-text");
      icon.className = "attachment-text-icon";
      var name = document.createElement("span");
      name.className = "attachment-text-name";
      name.textContent = att.name;
      thumb.append(icon, name);
    } else {
      var image = document.createElement("img");
      image.src = att.dataUrl;
      image.alt = "附件图片";
      image.title = "点击查看大图";
      image.setAttribute("role", "button");
      image.tabIndex = 0;
      thumb.appendChild(image);
    }
    var removeBtn = document.createElement("button");
    removeBtn.className = "attachment-remove";
    removeBtn.dataset.idx = idx;
    removeBtn.title = "移除";
    removeBtn.innerHTML = "&times;";
    thumb.appendChild(removeBtn);
    els.attachmentPreview.appendChild(thumb);
  });
  lucide.createIcons();
}

async function addAttachments(files) {
  var supportedTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  var selectedFiles = Array.from(files || []);
  for (var i = 0; i < selectedFiles.length; i++) {
    var file = selectedFiles[i];
    var fileType = String(file.type || "").toLowerCase();
    var isText = fileType === "text/plain" || /\.txt$/i.test(file.name || "");
    try {
      if (isText) {
        if (file.size > 256 * 1024) {
          setText(els.chatStatus, "TXT 文件 " + file.name + " 超过 256KB 限制");
          continue;
        }
        var textContent = await textFileToString(file);
        _pendingAttachments.push({
          kind: "text",
          name: file.name || "附件.txt",
          size: file.size,
          type: file.type || "text/plain",
          content: textContent,
        });
      } else if (supportedTypes.includes(fileType)) {
        if (file.size > 8 * 1024 * 1024) {
          setText(els.chatStatus, "图片 " + file.name + " 超过 8MB 限制");
          continue;
        }
        var dataUrl = await imageFileToBase64(file);
        _pendingAttachments.push({
          kind: "image",
          name: file.name,
          size: file.size,
          type: file.type,
          dataUrl: dataUrl,
        });
      }
    } catch (err) {
      console.error("[chat] read attachment failed", err);
    }
  }
  renderAttachmentPreview();
}

function isSupportedChatAttachment(file) {
  if (!file) return false;
  var type = String(file.type || "").toLowerCase();
  var name = String(file.name || "");
  return ["image/png", "image/jpeg", "image/webp", "image/gif", "text/plain"].includes(type)
    || /\.txt$/i.test(name);
}

function removeAttachment(idx) {
  _pendingAttachments.splice(idx, 1);
  renderAttachmentPreview();
}

function initAttachmentHandlers() {
  if (els.attachImageBtn && els.imageFileInput) {
    els.attachImageBtn.addEventListener("click", function () {
      els.imageFileInput.value = "";
      els.imageFileInput.click();
    });
    els.imageFileInput.addEventListener("change", function () {
      addAttachments(els.imageFileInput.files);
    });
  }
  if (els.attachmentPreview) {
    els.attachmentPreview.addEventListener("click", function (e) {
      var btn = e.target.closest(".attachment-remove");
      if (btn) removeAttachment(Number(btn.dataset.idx));
    });
  }
  if (els.chatInput) {
    els.chatInput.addEventListener("paste", function (e) {
      var clipboard = e.clipboardData || e.originalEvent?.clipboardData;
      if (!clipboard) return;
      var attachmentFiles = [];
      var seenFiles = new Set();
      Array.from(clipboard.files || []).forEach(function (file) {
        if (!isSupportedChatAttachment(file)) return;
        attachmentFiles.push(file);
        seenFiles.add([file.name, file.size, file.type, file.lastModified].join(":"));
      });
      var items = clipboard.items || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind !== "file") continue;
        var file = items[i].getAsFile();
        var fileKey = file ? [file.name, file.size, file.type, file.lastModified].join(":") : "";
        if (seenFiles.has(fileKey)) continue;
        if (isSupportedChatAttachment(file)) {
          attachmentFiles.push(file);
          seenFiles.add(fileKey);
        }
      }
      if (attachmentFiles.length) {
        e.preventDefault();
        addAttachments(attachmentFiles);
      }
    });
  }
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
