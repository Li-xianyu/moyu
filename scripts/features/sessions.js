"use strict";

function renderSession() {
  var session = getCurrentSession();
  renderChatListMenu();

  // Welcome page: don't load session content
  if (state.showWelcomeHome) {
    if (els.chatStage) els.chatStage.classList.add("empty-state");
    if (els.views.chat) els.views.chat.classList.add("empty-state");
    state.chatRenderActiveSessionId = null;
    els.chatMessages.innerHTML = "";
    return;
  }

  if (els.chatStage) {
    els.chatStage.classList.toggle("empty-state", !session);
  }
  if (els.views.chat) {
    els.views.chat.classList.toggle("empty-state", !session);
  }

  if (!session) {
    state.chatRenderActiveSessionId = null;
    els.chatMeta.className = "chat-meta empty";
    els.chatMeta.textContent = t("chat.noActiveSession");
    els.chatInput.disabled = true;
    els.sendBtn.disabled = true;
    if (els.compressMemoryBtn) {
      els.compressMemoryBtn.disabled = true;
    }
    if (els.editSessionBtn) {
      els.editSessionBtn.disabled = true;
    }
    els.chatMessages.innerHTML = "";
    setText(els.chatStatus, t("chat.readyAfterCreate"));
    autoResizeChatInput();
    if (typeof clearSuggestions === "function") clearSuggestions();
    if (typeof updateSuggestBtn === "function") updateSuggestBtn();
    return;
  }

  els.chatMeta.className = "chat-meta";
  els.chatMeta.innerHTML = renderChatMetaMarkup(session);
  bindChatMetaExpanders();

  els.chatInput.disabled = false;
  els.sendBtn.disabled = false;
  if (els.compressMemoryBtn) {
    els.compressMemoryBtn.disabled = state.isSending || !session.directorModel;
  }
  if (els.editSessionBtn) {
    els.editSessionBtn.disabled = false;
  }
  updateComposerMode();
  autoResizeChatInput();
  renderMessages();
  scrollChatToBottom();
}

function renderSessionLoadingShell(session) {
  if (els.chatStage) {
    els.chatStage.classList.remove("empty-state");
  }
  if (els.views.chat) {
    els.views.chat.classList.remove("empty-state");
  }
  state.chatRenderActiveSessionId = null;
  els.chatMeta.className = "chat-meta";
  els.chatMeta.textContent = session?.title || "正在加载会话...";
  els.chatInput.disabled = true;
  els.sendBtn.disabled = true;
  if (els.compressMemoryBtn) {
    els.compressMemoryBtn.disabled = true;
  }
  if (els.editSessionBtn) {
    els.editSessionBtn.disabled = false;
  }
  els.chatMessages.replaceChildren();
  updateComposerMode();
  autoResizeChatInput();
  setText(els.chatStatus, "正在加载会话...");
}

function trimInactiveSessionBuffer(session) {
  if (!session || !Array.isArray(session.messages) || !session.messages.length) {
    return;
  }
  const keepCount = typeof getChatInitialHydrateCount === "function"
    ? getChatInitialHydrateCount(session)
    : 60;
  if (session.messages.length <= keepCount) {
    return;
  }
  const trimmed = session.messages.slice(-keepCount);
  const total = Number.isFinite(session.messageCount) ? session.messageCount : trimmed.length;
  session.messages = trimmed;
  session.loadedStartSequence = Math.max(0, total - trimmed.length);
  session.messagesHydrated = true;
  if (state.chatRenderWindows && session.id) {
    delete state.chatRenderWindows[session.id];
  }
}

function buildSessionStatsMarkup(session) {
  if (!session) {
    return "";
  }
  const totalMessages = typeof getSessionMessageCount === "function"
    ? getSessionMessageCount(session)
    : (Array.isArray(session.messages) ? session.messages.length : 0);
  const tokenState = typeof getSessionStoredTokenEstimateState === "function"
    ? getSessionStoredTokenEstimateState(session)
    : { label: "—" };

  return `
    <section class="chat-meta-section compact">
      <div class="chat-meta-label">会话统计</div>
      <dl class="chat-meta-stats">
        <div class="chat-meta-stat">
          <dt>消息数</dt>
          <dd>${escapeHtml(String(totalMessages))}</dd>
        </div>
        <div class="chat-meta-stat">
          <dt>全库 Token 预估</dt>
          <dd>${escapeHtml(String(tokenState.label || "—"))}</dd>
        </div>
      </dl>
    </section>
  `.trim();
}

function renderChatMetaMarkup(session) {
  const entityType = getEntityTerm(session.mode || SESSION_MODE_STORY);
  const npcCards = (session.npcs || []).map((npc) => `
    <div class="chat-meta-npc-item">
      <div class="chat-meta-npc-head">
        <div class="chat-meta-npc-name">${escapeHtml(npc.name || t("npc.unnamed", { entityType }))}</div>
        <div class="chat-meta-npc-model">${escapeHtml(npc.model || t("npc.noModel"))}</div>
      </div>
      ${npc.prompt ? renderCollapsibleMetaText(npc.prompt, {
        className: "chat-meta-npc-prompt",
        collapsedLines: 4,
        kind: "npc-prompt",
      }) : ""}
    </div>
  `).join("");

  return `
    <section class="chat-meta-section">
      <div class="chat-meta-label">${escapeHtml(t("chat.globalPromptLabel"))}</div>
      ${renderCollapsibleMetaText(session.globalPrompt || t("chat.globalPromptEmpty"), {
        className: "chat-meta-body",
        collapsedLines: 6,
        kind: "global-prompt",
      })}
    </section>
    ${session.directorModel ? `<section class="chat-meta-section compact">
      <div class="chat-meta-label">${escapeHtml(t("create.directorLabel"))}</div>
      <div class="chat-meta-chip">${escapeHtml(session.directorModel)}</div>
    </section>` : ""}
    ${buildSessionStatsMarkup(session)}
    <section class="chat-meta-section">
      <div class="chat-meta-label">${escapeHtml(t("create.npcTitle", { entityType }))}</div>
      <div class="chat-meta-npc-list">${npcCards || `<div class="chat-meta-empty">${escapeHtml(t("chat.noNpcs"))}</div>`}</div>
    </section>
  `;
}

function refreshSessionMetaPanel() {
  const session = getCurrentSession();
  if (!els.chatMeta || !session || state.showWelcomeHome) {
    return;
  }
  els.chatMeta.className = "chat-meta";
  els.chatMeta.innerHTML = renderChatMetaMarkup(session);
  bindChatMetaExpanders();
}

function renderCollapsibleMetaText(value, options = {}) {
  const text = String(value || "").trim();
  const escapedHtml = escapeHtml(text).replace(/\n/g, "<br>");
  const className = options.className || "";
  const collapsedLines = options.collapsedLines || 5;
  const collapsible = shouldCollapseMetaText(text, options.kind);

  if (!collapsible) {
    return `<div class="${className}">${escapedHtml}</div>`;
  }

  return `
    <div class="chat-meta-text-block">
      <div class="${className} chat-meta-text is-collapsible collapsed" style="--collapsed-lines:${collapsedLines};">${escapedHtml}</div>
      <button type="button" class="chat-meta-toggle-btn">${escapeHtml(t("chat.metaExpand"))}</button>
    </div>
  `;
}

function shouldCollapseMetaText(text, kind = "") {
  if (!text) {
    return false;
  }

  const lineCount = text.split(/\r?\n/).filter(Boolean).length;
  if (kind === "npc-prompt") {
    return text.length > 110 || lineCount > 4;
  }

  return text.length > 180 || lineCount > 6;
}

function bindChatMetaExpanders() {
  if (!els.chatMeta) {
    return;
  }

  els.chatMeta.querySelectorAll(".chat-meta-text-block").forEach((block) => {
    const content = block.querySelector(".chat-meta-text");
    const toggleBtn = block.querySelector(".chat-meta-toggle-btn");
    if (!content || !toggleBtn) {
      return;
    }

    toggleBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      const willExpand = content.classList.contains("collapsed");
      content.classList.toggle("collapsed", !willExpand);
      content.classList.toggle("expanded", willExpand);
      toggleBtn.textContent = willExpand ? t("chat.metaCollapse") : t("chat.metaExpand");
    });
  });
}

function sessionMatchesQuery(session, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  if ((session.title || "").toLowerCase().includes(q)) return true;
  if ((session.globalPrompt || "").toLowerCase().includes(q)) return true;
  if (Array.isArray(session.messages)) {
    for (let i = 0; i < session.messages.length; i++) {
      const content = session.messages[i]?.content;
      if (content && String(content).toLowerCase().includes(q)) return true;
    }
  }
  return false;
}

function renderChatListMenu() {
  const sessions = [...state.sessions].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  els.chatListItems.innerHTML = "";

  const query = (state.chatSearchQuery || "").trim();
  const filtered = query ? sessions.filter((s) => sessionMatchesQuery(s, query)) : sessions;

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "chat-list-empty";
    empty.textContent = query ? "没有匹配的会话" : t("chat.emptySessions");
    els.chatListItems.appendChild(empty);
    return;
  }

  const isChatView = els.views.chat?.classList.contains("active") || false;
  const showActive = isChatView && !state.showWelcomeHome && !state.editingSessionId;

  filtered.forEach((session) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chat-list-item ${(showActive && session.id === state.currentSessionId) ? "active" : ""} ${state.openChatMenuId === session.id ? "menu-open" : ""}`.trim();
    button.addEventListener("click", async () => {
      if (state.currentSessionId === session.id && !state.showWelcomeHome) {
        return;
      }
      const previousSession = getCurrentSession();
      if (state.renameSessionId) {
        commitRenameIfNeeded();
      }
      pushViewHistory();
      clearUserMessageEdit();
      state.showWelcomeHome = false;
      state.currentSessionId = session.id;
      if (!(els.views.chat?.classList.contains("active"))) {
        switchView("chat");
      }
      renderChatListMenu();
      setTimeout(() => {
        if (state.currentSessionId !== session.id || state.showWelcomeHome) {
          return;
        }
        renderSessionLoadingShell(session);
        setTimeout(async () => {
          if (!session.messagesHydrated && typeof ensureSessionMessagesHydrated === "function") {
            try {
              await ensureSessionMessagesHydrated(session);
            } catch (error) {
              debugWarn("[session] hydrate failed", error);
            }
          }
          if (state.currentSessionId !== session.id || state.showWelcomeHome) {
            return;
          }
          renderSession();
          scrollChatToBottom();
          setTimeout(persistSessions, 0);
          setTimeout(() => {
            if (previousSession && previousSession.id !== state.currentSessionId) {
              trimInactiveSessionBuffer(previousSession);
            }
          }, 0);
        }, 0);
      }, 0);
    });

    const main = document.createElement("div");
    main.className = "chat-list-main";

    if (state.renameSessionId === session.id) {
      const input = document.createElement("input");
      input.type = "text";
      input.value = getSessionLabel(session, false);
      input.className = "chat-list-rename-input";
      input.dataset.sessionId = session.id;
      input.addEventListener("click", (event) => {
        event.stopPropagation();
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commitRenameIfNeeded();
        }
      });
      main.appendChild(input);
      queueMicrotask(() => {
        input.focus();
        input.select();
      });
    } else {
      const title = document.createElement("strong");
      title.className = "chat-list-title";
      title.textContent = getSessionLabel(session);
      main.appendChild(title);
    }

    const actions = document.createElement("div");
    actions.className = "chat-list-actions";

    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = `chat-list-more-btn ${state.openChatMenuId === session.id ? "active" : ""}`.trim();
    moreBtn.innerHTML = `
      <i class="bi bi-three-dots-vertical nav-icon-svg"></i>
    `;
    moreBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      state.openChatMenuId = state.openChatMenuId === session.id ? null : session.id;
      state.deleteConfirmSessionId = null;
      renderChatListMenu();
    });
    actions.appendChild(moreBtn);

    const menu = document.createElement("div");
    menu.className = `chat-item-menu ${state.openChatMenuId === session.id ? "" : "hidden"}`.trim();

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "chat-item-menu-btn";
    editBtn.innerHTML = `
      <span class="chat-item-menu-icon">
        <i class="bi bi-gear nav-icon-svg"></i>
      </span>
      <span>${t("chat.menuEditSession")}</span>
    `;
    editBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      state.openChatMenuId = null;
      state.deleteConfirmSessionId = null;
      if (typeof window._loadScript === "function") {
        await Promise.all([
          window._loadScript("./scripts/features/create.js"),
          window._loadScript("./scripts/features/settings.js"),
        ]);
      }
      if (typeof initCreateView === "function") {
        initCreateView();
      }
      openSessionEditor(session.id);
    });

    const restartBtn = document.createElement("button");
    restartBtn.type = "button";
    restartBtn.className = "chat-item-menu-btn";
    restartBtn.innerHTML = `
      <span class="chat-item-menu-icon">
        <i class="bi bi-arrow-counterclockwise nav-icon-svg"></i>
      </span>
      <span>${t("chat.menuRestart")}</span>
    `;
    restartBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      restartSessionFromExisting(session.id);
    });

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "chat-item-menu-btn";
    renameBtn.innerHTML = `
      <span class="chat-item-menu-icon">
        <i class="bi bi-pencil nav-icon-svg"></i>
      </span>
      <span>${t("chat.menuRename")}</span>
    `;
    renameBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      state.renameSessionId = session.id;
      state.openChatMenuId = null;
      state.deleteConfirmSessionId = null;
      renderChatListMenu();
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    const isDeleteConfirm = state.deleteConfirmSessionId === session.id;
    deleteBtn.className = `chat-item-menu-btn danger ${isDeleteConfirm ? "confirm" : ""}`.trim();
    deleteBtn.innerHTML = isDeleteConfirm
      ? `
        <span class="chat-item-menu-icon">
          <i class="bi bi-check-lg nav-icon-svg"></i>
        </span>
        <span>${t("chat.menuDelete")}</span>
      `
      : `
        <span class="chat-item-menu-icon">
          <i class="bi bi-trash nav-icon-svg"></i>
        </span>
        <span>${t("chat.menuDelete")}</span>
      `;
    deleteBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.deleteConfirmSessionId === session.id) {
        deleteSession(session.id);
        return;
      }
      state.deleteConfirmSessionId = session.id;
      renderChatListMenu();
    });

    menu.appendChild(editBtn);
    menu.appendChild(restartBtn);
    menu.appendChild(renameBtn);

    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.className = "chat-item-menu-btn";
    exportBtn.innerHTML = `
      <span class="chat-item-menu-icon">
        <i class="bi bi-download nav-icon-svg"></i>
      </span>
      <span>${t("chat.menuExport")}</span>
    `;
    exportBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      exportSingleSession(session.id);
      state.openChatMenuId = null;
      renderChatListMenu();
    });

    menu.appendChild(exportBtn);
    menu.appendChild(deleteBtn);
    actions.appendChild(menu);
    if (state.openChatMenuId === session.id) {
      queueMicrotask(() => {
        positionChatItemMenu(menu, moreBtn);
      });
    }

    button.appendChild(main);
    button.appendChild(actions);
    els.chatListItems.appendChild(button);
  });
}

function positionChatItemMenu(menu, anchorButton) {
  if (!menu || !anchorButton) {
    return;
  }

  const anchorRect = anchorButton.getBoundingClientRect();
  const previousVisibility = menu.style.visibility;
  menu.style.visibility = "hidden";
  menu.style.top = "0px";
  menu.style.left = "0px";
  menu.style.width = "164px";

  const menuRect = menu.getBoundingClientRect();
  const menuWidth = Math.max(164, Math.ceil(menuRect.width || 164));
  const menuHeight = Math.ceil(menuRect.height || 0);
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const margin = 10;

  let left = anchorRect.right - menuWidth;
  left = Math.max(margin, Math.min(left, viewportWidth - menuWidth - margin));

  const spaceBelow = viewportHeight - anchorRect.bottom - margin;
  const shouldOpenUpward = menuHeight > 0 && spaceBelow < menuHeight && anchorRect.top > menuHeight;
  let top = shouldOpenUpward ? anchorRect.top - menuHeight - 6 : anchorRect.bottom + 6;
  top = Math.max(margin, Math.min(top, viewportHeight - menuHeight - margin));

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.width = `${menuWidth}px`;
  menu.style.visibility = previousVisibility || "";
}

function getSessionLabel(session, truncated = true) {
  const text = session.title?.trim() || buildFallbackTitle(session);
  if (!truncated) {
    return text;
  }
  return text.length > 16 ? `${text.slice(0, 16)}...` : text;
}

function commitRenameIfNeeded() {
  if (!state.renameSessionId) {
    return;
  }

  const input = document.querySelector(`.chat-list-rename-input[data-session-id="${state.renameSessionId}"]`);
  const session = state.sessions.find((item) => item.id === state.renameSessionId);
  if (input && session) {
    const nextTitle = input.value.trim();
    if (nextTitle) {
      session.title = nextTitle;
      session.titleSource = "manual";
      touchSession(session);
      persistSessions();
    }
  }

  state.renameSessionId = null;
  renderSession();
}

async function deleteSession(sessionId) {
  const session = state.sessions.find((item) => item.id === sessionId);
  const title = session?.title || sessionId;
  state.openChatMenuId = null;
  state.deleteConfirmSessionId = null;
  state.renameSessionId = null;
  renderChatListMenu();

  const task = startSessionTransferTask({
    title: "删除会话",
    initialStatus: "正在准备删除...",
    initialSubtext: title,
    cancelledStatus: "删除已取消",
  });
  task.title = "删除会话";
  task.status = "正在准备删除...";
  task.subtext = title;
  task.detail = "";
  updateSessionTransferModal({
    title: "删除会话",
    status: "正在准备删除...",
    subtext: title,
    percent: 1,
    detail: "",
    disableCancel: true,
  });

  try {
    if (window.__chatDB?.deleteSession) {
      await window.__chatDB.deleteSession(sessionId, {
        batchSize: getDeleteTransactionBatchSize(),
        onProgress: ({ phase, deleted, total, batch, nextBatchSize, avgMs, skippedFts }) => {
          const safeTotal = Math.max(1, Number(total) || Number(deleted) || 1);
          const percent = phase === "done"
            ? 99
            : phase === "prepare"
              ? 3
              : phase === "session"
                ? 98
              : Math.max(5, Math.min(96, 5 + Math.round((Number(deleted) || 0) / safeTotal * 91)));
          task.fakeProgress = percent;
          updateSessionTransferModal({
            title: "删除会话",
            status: phase === "prepare" ? "正在统计消息..." : phase === "session" ? "正在删除会话记录..." : "正在删除消息...",
            subtext: title,
            percent,
            detail: `${Math.min(Number(deleted) || 0, safeTotal).toLocaleString("zh-CN")} / ${safeTotal.toLocaleString("zh-CN")} 消息`,
            debug: [
              `mode: delete`,
              `phase: ${phase}`,
              `batch: ${batch || 0}`,
              nextBatchSize ? `next batch: ${nextBatchSize}` : "",
              avgMs ? `avg: ${avgMs}ms` : "",
              skippedFts ? "note: large session, search index cleanup skipped" : "",
            ].filter(Boolean).join("\n"),
            disableCancel: true,
          });
        },
      });
    }

    state.sessions = state.sessions.filter((item) => item.id !== sessionId);
    delete state.chatRenderWindows[sessionId];
    if (state.currentSessionId === sessionId) {
      state.currentSessionId = state.sessions[0]?.id || null;
    }
    persistSessions();
    renderSession();
    finishSessionTransferTask(task, {
      title: "删除完成",
      status: "会话已删除",
      subtext: title,
      detail: "",
      autoHideMs: 1000,
    });
  } catch (error) {
    updateSessionTransferModal({
      title: "删除失败",
      status: "删除失败",
      subtext: error?.message || "本地数据库删除失败",
      percent: Math.max(task.fakeProgress, 0),
      detail: "",
      completed: true,
      disableCancel: false,
      cancelLabel: "关闭",
    });
    setText(els.chatStatus, "删除失败");
    sessionTransferTask = null;
  }
}

function restartSessionFromExisting(sessionId) {
  clearUserMessageEdit();
  const source = state.sessions.find((session) => session.id === sessionId);
  if (!source) {
    return;
  }

  const createdAt = new Date().toISOString();
  const session = {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt,
    updatedAt: createdAt,
    configId: source.configId,
    host: source.host,
    key: source.key,
    title: source.titleSource === "manual" && source.title ? source.title : t("chat.generatingTitle"),
    titleSource: source.titleSource === "manual" && source.title ? "manual" : "auto",
    globalPrompt: source.globalPrompt,
    mode: source.mode,
    directorModel: source.directorModel,
    directorConfigId: source.directorConfigId || source.configId || "",
    npcs: (source.npcs || []).map((npc) => ({ ...npc })),
    transientNpcs: [],
    directorMemory: normalizeDirectorMemory(source.directorMemory),
    directorSummary: "",
    chatSummary: "",
    compressedUntilMessageId: "",
    suggestionGuide: "",
    messages: [
      {
        role: "system",
        speaker: t("chat.systemSpeaker"),
        uiType: "system-notice",
        content: `${t("chat.systemNoticeCreated")}\n\n${t("chat.globalPromptLabel")}：\n${source.globalPrompt}`,
        createdAt,
      },
    ],
  };

  upsertSession(session);
  state.showWelcomeHome = false;
  state.currentSessionId = session.id;
  state.openChatMenuId = null;
  state.deleteConfirmSessionId = null;
  state.renameSessionId = null;
  persistSessions();
  renderSession();
  switchView("chat");
  setText(els.chatStatus, t("chat.restartedFromExisting"));

  if (session.titleSource !== "manual") {
    void generateSessionTitle(session);
  }
  void generateSuggestionGuide(session);
}

function exportSingleSession(sessionId) {
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) {
    return;
  }
  const task = startSessionTransferTask({
    title: "导出会话",
    initialStatus: "正在准备导出...",
    initialSubtext: session.title || session.id,
    cancelledStatus: "导出已取消",
  });
  task.title = "导出会话";
  task.status = "正在准备导出...";
  task.subtext = session.title || session.id;
  task.detail = "单个会话";

  buildSessionArchiveBlob(task, sessionId).then((archiveBlob) => {
    if (task.cancelled) return;
    updateSessionTransferModal({
      title: "导出会话",
      status: "正在生成归档文件...",
      subtext: session.title || session.id,
      percent: 98,
      detail: `${Math.max(1, Math.round(archiveBlob.size / 1024 / 1024))}MB`,
    });
    downloadBlob(archiveBlob, `${session.title || "session"}-${session.id.slice(0, 8)}.moyu.ndjson`);
    setText(els.chatStatus, state.locale === "en-US" ? "Session exported" : "会话已导出");
    finishSessionTransferTask(task, {
      title: "导出完成",
      status: "会话已导出",
      subtext: "单会话归档文件已经开始下载",
      detail: `${Math.max(1, Math.round(archiveBlob.size / 1024 / 1024))}MB`,
    });
  }).catch((error) => {
    if (task.cancelled || error?.message === "EXPORT_ABORTED") {
      return;
    }
    updateSessionTransferModal({
      title: "导出失败",
      status: "导出失败",
      subtext: error?.message || "请稍后重试",
      percent: Math.max(task.fakeProgress, 0),
      detail: "",
      completed: true,
      disableCancel: false,
      cancelLabel: "关闭",
    });
    setText(els.chatStatus, state.locale === "en-US" ? "Export failed" : "导出失败");
    sessionTransferTask = null;
  });
}

let sessionTransferTask = null;

function ensureSessionTransferModal() {
  let modal = document.getElementById("sessionTransferModal");
  if (modal) {
    return modal;
  }
  modal = document.createElement("div");
  modal.id = "sessionTransferModal";
  modal.className = "session-transfer-modal hidden";
  modal.innerHTML = `
    <div class="session-transfer-backdrop"></div>
    <div class="session-transfer-card" role="dialog" aria-modal="true" aria-labelledby="sessionTransferTitle">
      <div class="session-transfer-head">
        <h3 id="sessionTransferTitle">处理中</h3>
        <button type="button" class="session-transfer-close" aria-label="关闭">×</button>
      </div>
      <div class="session-transfer-body">
        <div class="session-transfer-status" id="sessionTransferStatus">准备中...</div>
        <div class="session-transfer-subtext" id="sessionTransferSubtext"></div>
        <div class="session-transfer-progress">
          <div class="session-transfer-progress-fill" id="sessionTransferProgressFill"></div>
        </div>
        <div class="session-transfer-progress-meta">
          <span id="sessionTransferPercent">0%</span>
          <span id="sessionTransferDetail"></span>
        </div>
        <pre class="session-transfer-debug" id="sessionTransferDebug"></pre>
      </div>
      <div class="session-transfer-actions">
        <button type="button" class="secondary-btn session-transfer-cancel" id="sessionTransferCancelBtn">取消</button>
      </div>
    </div>
  `.trim();
  document.body.appendChild(modal);

  const closeTask = () => {
    if (sessionTransferTask?.cancel) {
      sessionTransferTask.cancel();
    }
  };
  modal.querySelector(".session-transfer-close")?.addEventListener("click", closeTask);
  modal.querySelector(".session-transfer-backdrop")?.addEventListener("click", closeTask);
  modal.querySelector("#sessionTransferCancelBtn")?.addEventListener("click", closeTask);
  return modal;
}

function updateSessionTransferModal(options = {}) {
  const modal = ensureSessionTransferModal();
  modal.classList.remove("hidden");
  const titleEl = modal.querySelector("#sessionTransferTitle");
  const statusEl = modal.querySelector("#sessionTransferStatus");
  const subtextEl = modal.querySelector("#sessionTransferSubtext");
  const fillEl = modal.querySelector("#sessionTransferProgressFill");
  const percentEl = modal.querySelector("#sessionTransferPercent");
  const detailEl = modal.querySelector("#sessionTransferDetail");
  const debugEl = modal.querySelector("#sessionTransferDebug");
  const cancelBtn = modal.querySelector("#sessionTransferCancelBtn");
  const closeBtn = modal.querySelector(".session-transfer-close");

  const percent = Math.max(0, Math.min(100, Math.round(options.percent || 0)));
  if (titleEl) titleEl.textContent = options.title || "处理中";
  if (statusEl) statusEl.textContent = options.status || "准备中...";
  if (subtextEl) subtextEl.textContent = options.subtext || "";
  if (fillEl) fillEl.style.width = `${percent}%`;
  if (percentEl) percentEl.textContent = `${percent}%`;
  if (detailEl) detailEl.textContent = options.detail || "";
  if (debugEl) {
    const debugText = String(options.debug || "").trim();
    debugEl.textContent = debugText;
    debugEl.style.display = debugText ? "block" : "none";
  }
  if (cancelBtn) {
    cancelBtn.disabled = Boolean(options.disableCancel);
    cancelBtn.textContent = options.completed ? "完成" : (options.cancelLabel || "取消");
  }
  if (closeBtn) {
    closeBtn.disabled = Boolean(options.disableCancel);
  }
}

function hideSessionTransferModal() {
  const modal = document.getElementById("sessionTransferModal");
  if (!modal) return;
  modal.classList.add("hidden");
}

function startSessionTransferTask(config = {}) {
  if (sessionTransferTask?.cancel) {
    sessionTransferTask.cancel(true);
  }
  const task = {
    cancelled: false,
    fakeProgress: 0,
    fakeTimer: null,
    cancel: function (silent) {
      if (task.cancelled) return;
      task.cancelled = true;
      if (task.fakeTimer) {
        clearInterval(task.fakeTimer);
        task.fakeTimer = null;
      }
      if (!silent) {
        updateSessionTransferModal({
          title: config.title || "处理中",
          status: config.cancelledStatus || "已取消",
          subtext: config.cancelledSubtext || "",
          percent: task.fakeProgress,
          detail: config.cancelledDetail || "",
          completed: true,
          disableCancel: false,
          cancelLabel: "关闭",
        });
        setText(els.chatStatus, config.cancelledStatus || "已取消");
      }
    }
  };
  sessionTransferTask = task;
  updateSessionTransferModal({
    title: config.title || "处理中",
    status: config.initialStatus || "准备中...",
    subtext: config.initialSubtext || "",
    percent: 0,
    detail: config.initialDetail || "",
  });
  return task;
}

function startFakeTransferProgress(task, ceiling = 88, step = 2, intervalMs = 140) {
  if (!task || task.cancelled) return;
  if (task.fakeTimer) clearInterval(task.fakeTimer);
  task.fakeTimer = setInterval(() => {
    if (task.cancelled) {
      clearInterval(task.fakeTimer);
      task.fakeTimer = null;
      return;
    }
    task.fakeProgress = Math.min(ceiling, task.fakeProgress + step);
    updateSessionTransferModal({
      title: task.title,
      status: task.status,
      subtext: task.subtext,
      percent: task.fakeProgress,
      detail: task.detail,
    });
  }, intervalMs);
}

function finishSessionTransferTask(task, options = {}) {
  if (!task || task.cancelled) return;
  if (task.fakeTimer) {
    clearInterval(task.fakeTimer);
    task.fakeTimer = null;
  }
  task.fakeProgress = 100;
  updateSessionTransferModal({
    title: options.title || "处理完成",
    status: options.status || "已完成",
    subtext: options.subtext || "",
    percent: 100,
    detail: options.detail || "",
    completed: true,
    disableCancel: false,
    cancelLabel: "关闭",
  });
  setTimeout(() => {
    if (sessionTransferTask === task) {
      hideSessionTransferModal();
      sessionTransferTask = null;
    }
  }, options.autoHideMs || 1200);
}

function readFileAsTextWithProgress(file, task) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    if (task) {
      task.abortReader = () => reader.abort();
      const prevCancel = task.cancel;
      task.cancel = function (silent) {
        if (reader.readyState === FileReader.LOADING) {
          reader.abort();
        }
        prevCancel(silent);
      };
    }
    reader.onprogress = (event) => {
      if (!task || !event.lengthComputable || task.cancelled) return;
      const percent = Math.max(task.fakeProgress || 0, Math.round((event.loaded / Math.max(1, event.total)) * 55));
      task.fakeProgress = percent;
      updateSessionTransferModal({
        title: "导入会话",
        status: "正在读取文件...",
        subtext: file.name,
        percent,
        detail: `${(event.loaded / 1024 / 1024).toFixed(1)}MB / ${Math.max(0.1, event.total / 1024 / 1024).toFixed(1)}MB`,
      });
    };
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
    reader.onabort = () => reject(new Error("IMPORT_ABORTED"));
    reader.readAsText(file);
  });
}

function buildArchiveSessionMeta(session) {
  return {
    id: session.id || createMessageId("session"),
    title: typeof session.title === "string" ? session.title : "",
    titleSource: session.titleSource || "",
    mode: session.mode || SESSION_MODE_STORY,
    configId: session.configId || session.directorConfigId || "",
    directorConfigId: session.directorConfigId || session.configId || "",
    model: session.model || "",
    directorModel: session.directorModel || session.model || "",
    globalPrompt: session.globalPrompt || "",
    settingsOverrides: normalizeSessionOverrides(session.settingsOverrides),
    npcs: Array.isArray(session.npcs) ? session.npcs.map((n) => ({ ...n })) : [],
    transientNpcs: [],
    directorMemory: normalizeDirectorMemory(session.directorMemory),
    directorSummary: session.directorSummary || "",
    chatSummary: session.chatSummary || "",
    compressedUntilMessageId: session.compressedUntilMessageId || "",
    suggestionGuide: session.suggestionGuide || "",
    host: session.host || "",
    key: session.key || "",
    messageCount: Number.isFinite(session.messageCount)
      ? session.messageCount
      : Array.isArray(session.messages)
        ? session.messages.filter((m) => m?.role !== "system").length
        : 0,
    createdAt: session.createdAt || new Date().toISOString(),
    updatedAt: session.updatedAt || new Date().toISOString(),
  };
}

function createImportedSessionShell(raw) {
  return {
    id: raw.id || createMessageId("session"),
    title: typeof raw.title === "string" ? raw.title : "",
    titleSource: raw.titleSource || "",
    mode: raw.mode || SESSION_MODE_STORY,
    configId: raw.configId || raw.directorConfigId || "",
    directorConfigId: raw.directorConfigId || raw.configId || "",
    model: raw.model || "",
    directorModel: raw.directorModel || raw.model || "",
    globalPrompt: raw.globalPrompt || "",
    settingsOverrides: normalizeSessionOverrides(raw.settingsOverrides),
    npcs: Array.isArray(raw.npcs) ? raw.npcs.map((n) => ({ ...n })) : [],
    transientNpcs: [],
    directorMemory: normalizeDirectorMemory(raw.directorMemory),
    directorSummary: raw.directorSummary || "",
    chatSummary: raw.chatSummary || "",
    compressedUntilMessageId: raw.compressedUntilMessageId || "",
    compressedUntilSequence: Number.isFinite(raw.compressedUntilSequence) ? raw.compressedUntilSequence : null,
    compressionSegments: Array.isArray(raw.compressionSegments) ? raw.compressionSegments.map((segment) => ({ ...segment })) : [],
    suggestionGuide: raw.suggestionGuide || "",
    host: raw.host || "",
    key: raw.key || "",
    messages: [],
    messageCount: Number.isFinite(raw.messageCount)
      ? raw.messageCount
      : Array.isArray(raw.messages)
        ? raw.messages.filter((m) => m?.role !== "system").length
        : 0,
    messagesHydrated: false,
    loadedStartSequence: 0,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function buildSessionArchiveBlob(task, sessionId = "") {
  const sessions = window.__chatDB?.loadSessionMetas
    ? await window.__chatDB.loadSessionMetas()
    : state.sessions;
  const exportSessions = (sessions || []).filter((session) => !sessionId || session.id === sessionId);
  const totalSessions = exportSessions.length;
  const totalMessages = exportSessions.reduce((sum, session) => {
    return sum + Math.max(0, Number(session.messageCount) || 0);
  }, 0);

  const parts = [];
  let textBuffer = "";
  let exportedMessages = 0;
  const flushTextBuffer = () => {
    if (!textBuffer) return;
    parts.push(textBuffer);
    textBuffer = "";
  };
  const appendLine = (value) => {
    textBuffer += `${JSON.stringify(value)}\n`;
    if (textBuffer.length >= 1024 * 1024) {
      flushTextBuffer();
    }
  };

  appendLine({ t: "meta", v: 2, f: "moyu-ndjson" });

  for (let sessionIndex = 0; sessionIndex < exportSessions.length; sessionIndex += 1) {
    if (task?.cancelled) {
      throw new Error("EXPORT_ABORTED");
    }
    const session = exportSessions[sessionIndex];
    const meta = buildArchiveSessionMeta(session);
    appendLine({ t: "s", d: meta });

    const total = Math.max(0, Number(meta.messageCount) || 0);
    let offset = 0;
    while (offset < total) {
      if (task?.cancelled) {
        throw new Error("EXPORT_ABORTED");
      }
      const batch = await window.__chatDB.getSessionMessagesRange(session.id, offset, 500);
      if (!batch.length) {
        break;
      }
      for (let i = 0; i < batch.length; i += 1) {
        appendLine({ t: "m", d: batch[i] });
      }
      offset += batch.length;
      exportedMessages += batch.length;
      const progressBase = totalSessions + totalMessages;
      const progressCurrent = Math.min(progressBase, sessionIndex + 1 + exportedMessages);
      const percent = Math.max(4, Math.min(96, Math.round((progressCurrent / Math.max(1, progressBase)) * 96)));
      task.fakeProgress = percent;
      updateSessionTransferModal({
        title: "导出会话",
        status: "正在整理归档...",
        subtext: `第 ${sessionIndex + 1} / ${totalSessions} 个会话`,
        percent,
        detail: `${Math.round(exportedMessages / 1000)}k / ${Math.max(1, Math.round(totalMessages / 1000))}k 消息`,
      });
      if (offset % 2000 === 0) {
        await wait(0);
      }
    }
  }

  flushTextBuffer();
  return new Blob(parts, { type: "application/x-ndjson" });
}

async function peekFileHeaderText(file, byteLength = 2048) {
  const slice = file.slice(0, byteLength);
  return slice.text();
}

function isStreamingArchiveHeader(text) {
  const normalized = String(text || "").trimStart();
  return normalized.startsWith("{\"t\":\"meta\"") && normalized.includes("\"f\":\"moyu-ndjson\"");
}

function isLegacyLargeJsonFile(file) {
  if (!file) return false;
  const name = String(file.name || "").toLowerCase();
  return name.endsWith(".json") && Number(file.size || 0) >= 50 * 1024 * 1024;
}

function shouldUseFastArchiveImport(file) {
  if (!file) return false;
  const isCoarsePointer = window.matchMedia?.("(pointer: coarse)").matches;
  const isNarrow = window.matchMedia?.("(max-width: 960px)").matches;
  const size = Number(file.size || 0);
  return !isCoarsePointer && !isNarrow && size > 0 && size <= 64 * 1024 * 1024;
}

function getImportTransactionBatchSize() {
  const isCoarsePointer = window.matchMedia?.("(pointer: coarse)").matches;
  const isNarrow = window.matchMedia?.("(max-width: 960px)").matches;
  const cores = Number(navigator.hardwareConcurrency || 0);
  const memory = Number(navigator.deviceMemory || 0);
  if (isCoarsePointer || isNarrow || (cores > 0 && cores <= 4) || (memory > 0 && memory <= 4)) {
    return 3000;
  }
  return 8000;
}

function getDeleteTransactionBatchSize() {
  const isCoarsePointer = window.matchMedia?.("(pointer: coarse)").matches;
  const isNarrow = window.matchMedia?.("(max-width: 960px)").matches;
  return isCoarsePointer || isNarrow ? 800 : 1500;
}

async function importFastArchive(file, task) {
  const rawText = await readFileAsTextWithProgress(file, task);
  if (task.cancelled) {
    throw new Error("IMPORT_ABORTED");
  }

  updateSessionTransferModal({
    title: "导入会话",
    status: "正在快速解析归档...",
    subtext: file.name,
    percent: Math.max(task.fakeProgress, 58),
    detail: `${Math.max(0.1, file.size / 1024 / 1024).toFixed(1)}MB`,
    debug: "mode: fast\nnote: desktop archive import",
  });

  const lines = rawText.split(/\r?\n/);
  let imported = 0;
  let skipped = 0;
  let currentSession = null;
  let currentMessages = [];
  const importBatchSize = getImportTransactionBatchSize();

  async function flushCurrentSession() {
    if (!currentSession) return;
    currentSession.messages = currentMessages;
    currentSession.messageCount = currentMessages.filter((m) => m?.role !== "system").length;
    currentSession.messagesHydrated = true;
    currentSession.loadedStartSequence = 0;
    upsertSession(currentSession);
    if (window.__chatDB?.importSessionSnapshot) {
      await window.__chatDB.importSessionSnapshot(currentSession, {
        chunkSize: importBatchSize,
        shouldCancel: () => task.cancelled,
        onProgress: ({ written, total }) => {
          const writePercent = total > 0 ? written / total : 1;
          const percent = Math.max(88, Math.min(99, 88 + Math.round(writePercent * 11)));
          task.fakeProgress = percent;
          updateSessionTransferModal({
            title: "导入会话",
            status: "正在写入消息...",
            subtext: currentSession.title || currentSession.id,
            percent,
            detail: `${written.toLocaleString("zh-CN")} / ${total.toLocaleString("zh-CN")} 消息`,
            debug: `mode: fast\nwrite batch: ${importBatchSize}\nwritten: ${written}\ntotal: ${total}`,
          });
        },
      });
    } else if (window.__chatDB?.saveAllSessionBlobs) {
      await window.__chatDB.saveAllSessionBlobs([currentSession]);
    }
    imported += 1;
    currentSession = null;
    currentMessages = [];
  }

  for (let index = 0; index < lines.length; index += 1) {
    if (task.cancelled) {
      throw new Error("IMPORT_ABORTED");
    }
    const line = lines[index];
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    if (!record || typeof record !== "object" || record.t === "meta") {
      continue;
    }
    if (record.t === "s") {
      await flushCurrentSession();
      currentSession = createImportedSessionShell(record.d || {});
    } else if (record.t === "m") {
      if (!currentSession) {
        skipped += 1;
      } else {
        currentMessages.push(record.d || {});
      }
    }

    if (index > 0 && index % 4000 === 0) {
      const percent = Math.max(60, Math.min(98, Math.round((index / Math.max(1, lines.length)) * 98)));
      task.fakeProgress = percent;
      updateSessionTransferModal({
        title: "导入会话",
        status: "正在快速解析归档...",
        subtext: currentSession ? (currentSession.title || currentSession.id) : file.name,
        percent,
        detail: `${index.toLocaleString("zh-CN")} / ${lines.length.toLocaleString("zh-CN")} 行`,
        debug: `mode: fast\nlines: ${index}\nsession: ${currentSession ? (currentSession.title || currentSession.id) : "-"}\nbuffered messages: ${currentMessages.length}`,
      });
      await wait(0);
    }
  }

  await flushCurrentSession();
  persistSessions();
  renderChatListMenu();

  if (skipped === 0) {
    setText(els.chatStatus, t("settings.importSessionsSuccess"));
  } else {
    setText(els.chatStatus, t("settings.importSessionsPartial").replace("${n}", String(skipped)));
  }

  finishSessionTransferTask(task, {
    title: "导入完成",
    status: skipped === 0 ? "归档导入完成" : "归档导入完成，部分已跳过",
    subtext: `${imported} 个会话已导入`,
    detail: skipped ? `${skipped} 条记录被跳过` : "",
    autoHideMs: 1200,
  });
}

async function importStreamingArchive(file, task) {
  if (!file?.stream || !window.__chatDB) {
    throw new Error("当前环境不支持流式导入");
  }

  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytesRead = 0;
  let currentSession = null;
  let currentChunk = [];
  let currentWritten = 0;
  let imported = 0;
  let skipped = 0;
  const chunkSize = getImportTransactionBatchSize();
  let chunksRead = 0;
  let processedLines = 0;
  let lastUiUpdateAt = 0;
  let lastStreamUiUpdateAt = 0;

  function buildStreamDebug(extra) {
    return [
      `mode: stream`,
      `chunks: ${chunksRead}`,
      `lines: ${processedLines}`,
      `session: ${currentSession ? (currentSession.title || currentSession.id) : "-"}`,
      `written: ${currentWritten}`,
      extra ? `note: ${extra}` : "",
    ].filter(Boolean).join("\n");
  }

  const prevCancel = task.cancel;
  task.cancel = function (silent) {
    reader.cancel().catch(function () {});
    prevCancel(silent);
  };

  async function flushCurrentChunk() {
    if (!currentSession || !currentChunk.length) return;
    const batchSize = currentChunk.length;
    if (window.__chatDB.importMessageBatch) {
      await window.__chatDB.importMessageBatch(currentSession.id, currentChunk, currentWritten);
    } else {
      await window.__chatDB.saveMessages(currentSession.id, currentChunk, currentWritten);
    }
    currentWritten += currentChunk.length;
    currentSession.messageCount = Math.max(Number(currentSession.messageCount) || 0, currentWritten);
    currentChunk = [];
    lastUiUpdateAt = Date.now();
    updateSessionTransferModal({
      title: "导入会话",
      status: "正在写入消息...",
      subtext: currentSession ? `当前会话：${currentSession.title || currentSession.id}` : file.name,
      percent: task.fakeProgress,
      detail: `${(bytesRead / 1024 / 1024).toFixed(1)}MB / ${Math.max(0.1, file.size / 1024 / 1024).toFixed(1)}MB`,
      debug: buildStreamDebug(`batch ${batchSize} flushed`),
    });
    await wait(0);
  }

  async function handleLine(line) {
    if (!line.trim()) return;
    processedLines += 1;
    const record = JSON.parse(line);
    if (!record || typeof record !== "object") return;
    if (record.t === "meta") return;
    if (record.t === "s") {
      await flushCurrentChunk();
      currentSession = createImportedSessionShell(record.d || {});
      currentWritten = 0;
      upsertSession(currentSession);
      if (window.__chatDB.prepareSessionImport) {
        await window.__chatDB.prepareSessionImport(currentSession);
      } else {
        await window.__chatDB.saveSession(currentSession);
      }
      imported += 1;
      updateSessionTransferModal({
        title: "导入会话",
        status: "已识别会话头",
        subtext: currentSession.title || currentSession.id,
        percent: task.fakeProgress,
        detail: `${(bytesRead / 1024 / 1024).toFixed(1)}MB / ${Math.max(0.1, file.size / 1024 / 1024).toFixed(1)}MB`,
        debug: buildStreamDebug("session header parsed"),
      });
      await wait(0);
      return;
    }
    if (record.t === "m") {
      if (!currentSession) {
        skipped += 1;
        return;
      }
      currentChunk.push(record.d || {});
      if (currentChunk.length >= chunkSize) {
        await flushCurrentChunk();
      }
      if (Date.now() - lastUiUpdateAt > 450) {
        lastUiUpdateAt = Date.now();
        updateSessionTransferModal({
          title: "导入会话",
          status: "正在解析消息...",
          subtext: currentSession ? `当前会话：${currentSession.title || currentSession.id}` : file.name,
          percent: task.fakeProgress,
          detail: `${(bytesRead / 1024 / 1024).toFixed(1)}MB / ${Math.max(0.1, file.size / 1024 / 1024).toFixed(1)}MB`,
          debug: buildStreamDebug(`chunk buffer ${currentChunk.length}`),
        });
        await wait(0);
      }
      return;
    }
  }

  while (true) {
    if (task.cancelled) {
      throw new Error("IMPORT_ABORTED");
    }
    const result = await reader.read();
    if (result.done) {
      break;
    }
    chunksRead += 1;
    bytesRead += result.value.byteLength;
    buffer += decoder.decode(result.value, { stream: true });

    let lineBreakIndex = buffer.indexOf("\n");
    while (lineBreakIndex >= 0) {
      const line = buffer.slice(0, lineBreakIndex);
      buffer = buffer.slice(lineBreakIndex + 1);
      await handleLine(line);
      lineBreakIndex = buffer.indexOf("\n");
    }

    if (Date.now() - lastStreamUiUpdateAt > 300) {
      lastStreamUiUpdateAt = Date.now();
      const percent = Math.max(1, Math.min(98, Math.round((bytesRead / Math.max(1, file.size)) * 98)));
      task.fakeProgress = percent;
      updateSessionTransferModal({
        title: "导入会话",
        status: "正在导入流式归档...",
        subtext: currentSession ? `当前会话：${currentSession.title || currentSession.id}` : file.name,
        percent,
        detail: `${(bytesRead / 1024 / 1024).toFixed(1)}MB / ${Math.max(0.1, file.size / 1024 / 1024).toFixed(1)}MB`,
        debug: buildStreamDebug(`buffer ${buffer.length}`),
      });
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    await handleLine(buffer);
  }
  await flushCurrentChunk();

  persistSessions();
  renderChatListMenu();

  if (skipped === 0) {
    setText(els.chatStatus, t("settings.importSessionsSuccess"));
  } else {
    setText(els.chatStatus, t("settings.importSessionsPartial").replace("${n}", String(skipped)));
  }

  finishSessionTransferTask(task, {
    title: "导入完成",
    status: skipped === 0 ? "流式归档导入完成" : "流式归档导入完成，部分已跳过",
    subtext: `${imported} 个会话已导入`,
    detail: skipped ? `${skipped} 条记录被跳过` : "",
    autoHideMs: 1400,
  });
}

async function exportAllSessions() {
  if (!state.sessions.length) {
    setText(els.chatStatus, state.locale === "en-US" ? "No sessions to export" : "没有可导出的会话");
    return;
  }

  const task = startSessionTransferTask({
    title: "导出会话",
    initialStatus: "正在准备导出...",
    initialSubtext: "正在从本地数据库收集完整会话内容",
    cancelledStatus: "导出已取消",
  });
  task.title = "导出会话";
  task.status = "正在准备导出...";
  task.subtext = "正在从本地数据库收集完整会话内容";
  task.detail = `${state.sessions.length} 个会话`;

  try {
    const archiveBlob = await buildSessionArchiveBlob(task);
    if (task.cancelled) return;
    updateSessionTransferModal({
      title: "导出会话",
      status: "正在生成归档文件...",
      subtext: "流式归档已生成，正在准备下载",
      percent: 98,
      detail: `${Math.max(1, Math.round(archiveBlob.size / 1024 / 1024))}MB`,
    });
    downloadBlob(archiveBlob, `moyu-sessions-${new Date().toISOString().slice(0, 10)}.moyu.ndjson`);
    setText(els.chatStatus, state.locale === "en-US" ? "Sessions exported" : "会话已导出");
    finishSessionTransferTask(task, {
      title: "导出完成",
      status: "会话已导出",
      subtext: "流式归档文件已经开始下载",
      detail: `${Math.max(1, Math.round(archiveBlob.size / 1024 / 1024))}MB`,
    });
  } catch (error) {
    if (task.cancelled || error?.message === "EXPORT_ABORTED") {
      return;
    }
    updateSessionTransferModal({
      title: "导出失败",
      status: "导出失败",
      subtext: error?.message || "请稍后重试",
      percent: Math.max(task.fakeProgress, 0),
      detail: "",
      completed: true,
      disableCancel: false,
      cancelLabel: "关闭",
    });
    setText(els.chatStatus, state.locale === "en-US" ? "Export failed" : "导出失败");
    sessionTransferTask = null;
  }
}

function downloadSessionAsJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  downloadBlob(blob, filename);
}

async function importSessionsFromFile(file) {
  const task = startSessionTransferTask({
    title: "导入会话",
    initialStatus: "正在读取文件...",
    initialSubtext: file?.name || "",
    cancelledStatus: "导入已取消",
  });
  task.title = "导入会话";
  task.status = "正在读取文件...";
  task.subtext = file?.name || "";
  task.detail = "";

  try {
    const headerText = await peekFileHeaderText(file, 4096);
    if (isStreamingArchiveHeader(headerText)) {
      if (shouldUseFastArchiveImport(file)) {
        await importFastArchive(file, task);
        return;
      }
      await importStreamingArchive(file, task);
      return;
    }

    if (isLegacyLargeJsonFile(file)) {
      throw new Error("检测到旧版超大 JSON 导出文件。请用当前版本重新导出 .moyu.ndjson 归档后再导入。");
    }

    const rawText = await readFileAsTextWithProgress(file, task);
    if (task.cancelled) return;

    task.fakeProgress = Math.max(task.fakeProgress, 60);
    updateSessionTransferModal({
      title: "导入会话",
      status: "正在解析文件...",
      subtext: "文件读取完成，正在解析 JSON",
      percent: task.fakeProgress,
      detail: file?.name || "",
    });

    const data = JSON.parse(rawText);
    const sessions = Array.isArray(data) ? data : [data];
    let imported = 0;
    let skipped = 0;

    for (let index = 0; index < sessions.length; index += 1) {
      if (task.cancelled) {
        return;
      }
      const raw = sessions[index];
      if (!raw || typeof raw !== "object" || !raw.globalPrompt || !Array.isArray(raw.messages)) {
        skipped += 1;
        continue;
      }

      const session = {
        id: raw.id || createMessageId("session"),
        title: typeof raw.title === "string" ? raw.title : "",
        titleSource: raw.titleSource || "",
        mode: raw.mode || SESSION_MODE_STORY,
        configId: raw.configId || raw.directorConfigId || "",
        directorConfigId: raw.directorConfigId || raw.configId || "",
        model: raw.model || "",
        directorModel: raw.directorModel || raw.model || "",
        globalPrompt: raw.globalPrompt || "",
        npcs: Array.isArray(raw.npcs) ? raw.npcs.map((n) => ({ ...n })) : [],
        transientNpcs: [],
        directorMemory: normalizeDirectorMemory(raw.directorMemory),
        directorSummary: raw.directorSummary || "",
        chatSummary: raw.chatSummary || "",
        compressedUntilMessageId: raw.compressedUntilMessageId || "",
        suggestionGuide: raw.suggestionGuide || "",
        messages: Array.isArray(raw.messages) ? raw.messages.map((m) => ({ ...m })) : [],
        messageCount: Array.isArray(raw.messages) ? raw.messages.filter((m) => m?.role !== "system").length : 0,
        messagesHydrated: true,
        loadedStartSequence: 0,
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      state.sessions.push(session);
      if (window.__chatDB) {
        if (window.__chatDB.importSessionSnapshot) {
          await window.__chatDB.importSessionSnapshot(session, {
            chunkSize: getImportTransactionBatchSize(),
            shouldCancel: () => task.cancelled,
            onProgress: ({ written, total }) => {
              const sessionPercent = total > 0 ? written / total : 1;
              const percent = Math.max(
                62,
                Math.min(
                  98,
                  62 + Math.round((((index + sessionPercent) / Math.max(1, sessions.length))) * 36)
                )
              );
              task.fakeProgress = percent;
              updateSessionTransferModal({
                title: "导入会话",
                status: "正在写入消息...",
                subtext: `正在写入第 ${index + 1} / ${sessions.length} 个会话`,
                percent,
                detail: `${Math.round(written / 1000)}k / ${Math.max(1, Math.round(total / 1000))}k 消息`,
              });
            },
          });
        } else {
          await window.__chatDB.saveAllSessionBlobs([session]);
        }
      }
      imported += 1;

      const percent = Math.max(62, Math.min(98, 62 + Math.round(((index + 1) / Math.max(1, sessions.length)) * 36)));
      task.fakeProgress = percent;
      updateSessionTransferModal({
        title: "导入会话",
        status: "正在写入会话...",
        subtext: `已处理 ${index + 1} / ${sessions.length} 个会话`,
        percent,
        detail: `${imported} 成功，${skipped} 跳过`,
      });

      if ((index + 1) % 2 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    persistSessions();
    renderChatListMenu();

    if (skipped === 0) {
      setText(els.chatStatus, t("settings.importSessionsSuccess"));
    } else {
      setText(els.chatStatus, t("settings.importSessionsPartial").replace("${n}", String(skipped)));
    }

    finishSessionTransferTask(task, {
      title: "导入完成",
      status: skipped === 0 ? "会话导入完成" : "会话导入完成，部分已跳过",
      subtext: `${imported} 个会话已导入`,
      detail: skipped ? `${skipped} 个会话被跳过` : "",
      autoHideMs: 1400,
    });
  } catch (error) {
    if (task.cancelled || error?.message === "IMPORT_ABORTED") {
      return;
    }
    setText(els.chatStatus, t("settings.importSessionsFailed"));
    updateSessionTransferModal({
      title: "导入失败",
      status: "导入失败",
      subtext: error?.message || "文件格式无效或处理失败",
      percent: Math.max(task.fakeProgress, 0),
      detail: "",
      completed: true,
      disableCancel: false,
      cancelLabel: "关闭",
    });
    sessionTransferTask = null;
  }
}
