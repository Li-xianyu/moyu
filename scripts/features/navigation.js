const _scriptState = {};

function _loadScript(src) {
  if (_scriptState[src] === "loaded") return Promise.resolve();
  if (_scriptState[src] === "loading") {
    return new Promise((resolve) => {
      const check = () => {
        if (_scriptState[src] === "loaded") resolve();
        else setTimeout(check, 16);
      };
      check();
    });
  }
  _scriptState[src] = "loading";
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src + "?v=" + (window.APP_VERSION || "");
    s.onload = () => { _scriptState[src] = "loaded"; resolve(); };
    s.onerror = () => { _scriptState[src] = "error"; reject(new Error("Script load failed: " + src)); };
    document.body.appendChild(s);
  });
}

function pushViewHistory() {
  const activeView = getCurrentActiveView();
  if (!activeView) return;

  const entry = { view: activeView, mobileSidebarOpen: state.mobileSidebarOpen };
  if (activeView === "chat") {
    if (state.showWelcomeHome) {
      entry.welcome = true;
    } else {
      entry.sessionId = state.currentSessionId || "";
    }
  } else if (activeView === "create") {
    entry.sessionId = state.currentSessionId || "";
    entry.editingId = state.editingSessionId || "";
  }

  history.pushState(entry, "");
}

function captureViewEntry() {
  const activeView = getCurrentActiveView();
  if (!activeView) return null;
  const entry = { view: activeView, mobileSidebarOpen: state.mobileSidebarOpen };
  if (activeView === "chat") {
    if (state.showWelcomeHome) entry.welcome = true;
    else entry.sessionId = state.currentSessionId || "";
  } else if (activeView === "create") {
    entry.sessionId = state.currentSessionId || "";
    entry.editingId = state.editingSessionId || "";
  }
  return entry;
}

function getCurrentActiveView() {
  for (const [name, view] of Object.entries(els.views)) {
    if (view.classList.contains("active")) return name;
  }
  return null;
}

async function restoreViewFromHistory(entry) {
  if (entry.view === "chat" || entry.view === "welcome") {
    if (entry.welcome || entry.view === "welcome") {
      state.showWelcomeHome = true;
      state.currentSessionId = "";
    } else {
      state.showWelcomeHome = false;
      state.currentSessionId = entry.sessionId || "";
    }
    state.editingSessionId = null;
    // Temporarily close sidebar so switchView doesn't auto-close it again
    state.mobileSidebarOpen = false;
    switchView("chat");
    // Restore sidebar to saved state
    if (entry.mobileSidebarOpen && isMobileViewport()) {
      state.mobileSidebarOpen = true;
      applySidebarState();
    }
    renderSession();
  } else if (entry.view === "create") {
    state.openChatMenuId = null;
    state.deleteConfirmSessionId = null;
    state.renameSessionId = null;
    if (entry.editingId) {
      await _loadScript("./scripts/features/create.js");
      await _loadScript("./scripts/features/settings.js");
      initCreateView();
      openSessionEditor(entry.editingId);
    } else {
      await _loadScript("./scripts/features/create.js");
      initCreateView();
      prepareCreateViewForNewSession();
      switchView("create");
    }
  } else if (entry.view === "settings") {
    await _loadScript("./scripts/features/settings.js");
    initSettingsView();
    switchView("settings");
  }
}

window.addEventListener("popstate", (e) => {
  if (e.state?.view) {
    restoreViewFromHistory(e.state);
  }
});

function bindNav() {
  if (els.sidebarToggleBtn) {
    els.sidebarToggleBtn.addEventListener("click", () => {
      if (isMobileViewport()) {
        state.mobileSidebarOpen = !state.mobileSidebarOpen;
      } else {
        state.sidebarCollapsed = !(state.sidebarCollapsed === null ? false : state.sidebarCollapsed);
        persistSidebarCollapsed();
      }
      applySidebarState();
    });
  }

  if (els.sidebarBackdrop) {
    els.sidebarBackdrop.addEventListener("click", () => {
      state.mobileSidebarOpen = false;
      applySidebarState();
    });
  }

  window.addEventListener("resize", () => {
    if (!isMobileViewport()) {
      state.mobileSidebarOpen = false;
    }
    applySidebarState();
  });

  els.navButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const view = button.dataset.view;
      const fromEntry = captureViewEntry();
      if (view === "create") {
        await _loadScript("./scripts/features/create.js");
        initCreateView();
        prepareCreateViewForNewSession();
      } else if (view === "settings") {
        await _loadScript("./scripts/features/settings.js");
        initSettingsView();
      }
      // Push history right before switching — no async gap between push and switch
      if (fromEntry) history.pushState(fromEntry, "");
      switchView(view);
    });
  });

  applySidebarState();
}

let _settingsInited = false;
let _createInited = false;

function initSettingsView() {
  if (_settingsInited) return;
  _settingsInited = true;
  bindSettings();
  bindSettingsResize();
  hydrateSettingsInputs();
  renderSavedConfigs();
  renderModelCache();
  renderWorkModels();
}

function initCreateView() {
  if (_createInited) return;
  _createInited = true;
  bindCreateFlow();
}

window._loadScript = _loadScript;

function isMobileViewport() {
  return window.matchMedia("(max-width: 960px)").matches;
}

function persistSidebarCollapsed() {
  localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, JSON.stringify(Boolean(state.sidebarCollapsed)));
}

function applySidebarState() {
  if (!els.appShell) {
    return;
  }

  const isMobile = isMobileViewport();
  const isCollapsed = state.sidebarCollapsed === null ? false : Boolean(state.sidebarCollapsed);

  els.appShell.classList.toggle("sidebar-collapsed", !isMobile && isCollapsed);
  els.appShell.classList.toggle("sidebar-drawer-open", isMobile && state.mobileSidebarOpen);

  if (els.sidebarBackdrop) {
    els.sidebarBackdrop.classList.toggle("hidden", !(isMobile && state.mobileSidebarOpen));
  }
}

function bindInfoPopover() {
  els.infoToggleBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    els.chatInfoPopover.classList.toggle("hidden");
  });

  els.chatInfoPopover.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  document.addEventListener("click", () => {
    els.chatInfoPopover.classList.add("hidden");
  });
}

function bindChatList() {
  els.chatListToggleBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = els.chatListMenu.classList.contains("hidden");
    els.chatListMenu.classList.toggle("hidden", !willOpen);
    els.chatListArrowIcon.classList.toggle("expanded", willOpen);
  });

  els.chatListMenu.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  document.addEventListener("click", () => {
    commitRenameIfNeeded();
    state.openChatMenuId = null;
    state.deleteConfirmSessionId = null;
    renderChatListMenu();
  });

  els.chatExportBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (typeof exportAllSessions === "function") {
      exportAllSessions();
    }
  });

  els.chatImportBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    els.chatImportInput.click();
  });

  els.chatImportInput.addEventListener("change", () => {
    const file = els.chatImportInput.files?.[0];
    if (file && typeof importSessionsFromFile === "function") {
      importSessionsFromFile(file);
    }
    els.chatImportInput.value = "";
  });

  els.chatSearchBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const isHidden = els.chatSearchInput.hidden;
    els.chatSearchInput.hidden = !isHidden;
    els.chatSearchBtn.classList.toggle("active", isHidden);
    if (isHidden) {
      els.chatSearchInput.value = state.chatSearchQuery || "";
      els.chatSearchInput.focus();
    } else {
      state.chatSearchQuery = "";
      els.chatSearchInput.value = "";
      renderChatListMenu();
    }
  });

  let searchTimer;
  els.chatSearchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.chatSearchQuery = els.chatSearchInput.value.trim();
      renderChatListMenu();
    }, 150);
  });
}

function bindSettingsResize() {
  if (!els.settingsResizableLayout || !els.settingsResizeHandle) {
    return;
  }

  const onPointerMove = (event) => {
    const rect = els.settingsResizableLayout.getBoundingClientRect();
    const rawTop = event.clientY - rect.top;
    const handleHeight = 10;
    const minTop = 160;
    const minBottom = 180;
    const maxTop = rect.height - minBottom - handleHeight;
    const topHeight = Math.max(minTop, Math.min(maxTop, rawTop));
    els.settingsResizableLayout.style.gridTemplateRows = `${topHeight}px ${handleHeight}px minmax(${minBottom}px, 1fr)`;
  };

  const stopResize = () => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stopResize);
  };

  els.settingsResizeHandle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
  });
}

function switchView(viewName) {
  Object.entries(els.views).forEach(([name, view]) => {
    view.classList.toggle("active", name === viewName);
  });

  els.navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });

  // 设置页/创建页自己滚动，锁 .main 避免键盘切换导致 layout shift
  const mainEl = document.querySelector(".main");
  if (mainEl) {
    const nonChat = viewName !== "chat";
    const isNarrow = window.matchMedia("(max-width: 960px)").matches;
    const isTouch = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
    if (nonChat && (isNarrow || isTouch)) {
      mainEl.classList.add("scroll-lock");
    } else {
      mainEl.classList.remove("scroll-lock");
    }
  }

  if (isMobileViewport() && state.mobileSidebarOpen) {
    state.mobileSidebarOpen = false;
    applySidebarState();
  }
}

function mountSessionEditButton() {
  if (!els.infoToggleBtn || els.editSessionBtn) {
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "info-btn floating session-edit-btn icon-only-btn";
  button.setAttribute("aria-label", "编辑当前会话");
  button.innerHTML = `<i class="bi bi-gear nav-icon-svg"></i>`;
  button.addEventListener("click", async () => {
    if (state.isSending) {
      return;
    }
    const session = getCurrentSession();
    if (session) {
      const fromEntry = captureViewEntry();
      await _loadScript("./scripts/features/create.js");
      await _loadScript("./scripts/features/settings.js");
      initCreateView();
      if (fromEntry) history.pushState(fromEntry, "");
      openSessionEditor(session.id);
    }
  });

  els.infoToggleBtn.insertAdjacentElement("beforebegin", button);
  els.editSessionBtn = button;
}

function mountComposerCancelButton() {
  if (!els.composerFooter || els.cancelEditBtn) {
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-btn composer-cancel-btn hidden";
  button.innerHTML = '<i class="bi bi-x"></i>';
  button.addEventListener("click", () => {
    clearUserMessageEdit();
  });

  els.sendBtn.insertAdjacentElement("beforebegin", button);
  els.cancelEditBtn = button;
}
