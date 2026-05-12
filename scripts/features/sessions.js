function renderSession() {
  var session = getCurrentSession();
  renderChatListMenu();

  // Welcome page: don't load session content
  if (state.showWelcomeHome) {
    if (els.chatStage) els.chatStage.classList.add("empty-state");
    els.chatMessages.innerHTML = "";
    return;
  }

  if (els.chatStage) {
    els.chatStage.classList.toggle("empty-state", !session);
  }

  if (!session) {
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
    <section class="chat-meta-section">
      <div class="chat-meta-label">${escapeHtml(t("create.npcTitle", { entityType }))}</div>
      <div class="chat-meta-npc-list">${npcCards || `<div class="chat-meta-empty">${escapeHtml(t("chat.noNpcs"))}</div>`}</div>
    </section>
  `;
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
    button.addEventListener("click", () => {
      if (state.renameSessionId) {
        commitRenameIfNeeded();
      }
      clearUserMessageEdit();
      state.showWelcomeHome = false;
      state.currentSessionId = session.id;
      persistSessions();
      renderSession();
      switchView("chat");
      scrollChatToBottom();
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

function deleteSession(sessionId) {
  state.sessions = state.sessions.filter((session) => session.id !== sessionId);
  if (state.currentSessionId === sessionId) {
    state.currentSessionId = state.sessions[0]?.id || null;
  }
  state.openChatMenuId = null;
  state.deleteConfirmSessionId = null;
  state.renameSessionId = null;
  persistSessions();
  renderSession();
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
    directorModel: source.directorModel,
    directorConfigId: source.directorConfigId || source.configId || "",
    npcs: (source.npcs || []).map((npc) => ({ ...npc })),
    transientNpcs: [],
    directorMemory: normalizeDirectorMemory(source.directorMemory),
    directorSummary: "",
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
  downloadSessionAsJson(session, `${session.title || "session"}-${session.id.slice(0, 8)}.json`);
}

function exportAllSessions() {
  if (!state.sessions.length) {
    setText(els.chatStatus, state.locale === "en-US" ? "No sessions to export" : "没有可导出的会话");
    return;
  }
  downloadSessionAsJson(state.sessions, `moyu-sessions-${new Date().toISOString().slice(0, 10)}.json`);
}

function downloadSessionAsJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importSessionsFromFile(file) {
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);
      const sessions = Array.isArray(data) ? data : [data];
      let imported = 0;
      let skipped = 0;

      sessions.forEach((raw) => {
        if (!raw || typeof raw !== "object" || !raw.globalPrompt || !Array.isArray(raw.messages)) {
          skipped++;
          return;
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
          compressedUntilMessageId: "",
          messages: Array.isArray(raw.messages) ? raw.messages.map((m) => ({ ...m })) : [],
          createdAt: raw.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        state.sessions.push(session);
        imported++;
      });

      persistSessions();
      renderChatListMenu();

      if (skipped === 0) {
        setText(els.chatStatus, t("settings.importSessionsSuccess"));
      } else {
        setText(els.chatStatus, t("settings.importSessionsPartial").replace("${n}", String(skipped)));
      }
    } catch {
      setText(els.chatStatus, t("settings.importSessionsFailed"));
    }
  };
  reader.readAsText(file);
}
