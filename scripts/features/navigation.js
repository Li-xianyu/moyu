"use strict";

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
      prepareCreateViewForNewSession({ returnTarget: "chat" });
      switchView("create");
    }
  } else if (entry.view === "settings") {
    await _loadScript("./scripts/features/create.js");
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

  if (els.sidebarCollapseBtn) {
    els.sidebarCollapseBtn.addEventListener("click", () => {
      if (isMobileViewport()) {
        state.mobileSidebarOpen = false;
      } else {
        state.sidebarCollapsed = true;
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
        const returnTarget = state.showWelcomeHome ? "welcome" : "chat";
        prepareCreateViewForNewSession({ returnTarget });
      } else if (view === "settings") {
        await _loadScript("./scripts/features/create.js");
        await _loadScript("./scripts/features/settings.js");
        initSettingsView();
      } else if (view === "roles") {
        await _loadScript("./scripts/features/roles.js");
        initRolesView();
      }
      // Push history right before switching — no async gap between push and switch
      if (fromEntry) history.pushState(fromEntry, "");
      switchView(view);
    });
  });

  applySidebarState();
}

bindMobileSwipeGesture();

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
  if (typeof bindCreateFlow !== "function") {
    _createInited = false;
    return;
  }
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

function bindMobileSwipeGesture() {
  if (!("ontouchstart" in window)) return;

  let touchStartX = 0;
  let touchStartY = 0;
  let isDragging = false;
  let wasOpen = false;
  let sbWidth = 0;
  const SENSITIVITY = 1.4;
  const SNAP_THRESHOLD = 0.35;

  function getSb() { return els.sidebar || document.querySelector(".sidebar"); }
  function getBd() { return els.sidebarBackdrop || document.querySelector(".sidebar-backdrop"); }

  document.addEventListener("touchstart", (e) => {
    if (!isMobileViewport()) return;
    const target = e.target;
    if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;

    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    wasOpen = state.mobileSidebarOpen;
    isDragging = false;
    sbWidth = 0;
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (!isMobileViewport() || touchStartX === 0) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStartX;
    const dy = Math.abs(t.clientY - touchStartY);
    if (dy > Math.abs(dx) * 1.8) return;
    if (Math.abs(dx) < 10) return;

    if (!isDragging) {
      isDragging = true;
      const sb = getSb();
      sbWidth = sb ? sb.getBoundingClientRect().width : 260;
      if (sb) sb.style.transition = "none";
      const bd = getBd();
      if (bd) bd.style.transition = "none";
    }

    // 跟手阶段统一灵敏度，展开/收起对称
    let rawProgress = (dx / sbWidth) * SENSITIVITY;
    if (wasOpen) rawProgress = 1 + (dx / sbWidth) * SENSITIVITY;

    // Rubber band resistance past edges
    let progress;
    if (rawProgress < 0) progress = rawProgress * 0.5;
    else if (rawProgress > 1) progress = 1 + (rawProgress - 1) * 0.5;
    else progress = rawProgress;

    // Visual: never let sidebar go past its bounds
    const visualProgress = Math.max(0, Math.min(1, progress));

    const sb = getSb();
    if (sb) {
      sb.style.transform = `translateX(${-100 * (1 - visualProgress)}%)`;
      sb.style.opacity = visualProgress;
    }
    const bd = getBd();
    if (bd) {
      if (wasOpen) {
        // 侧栏本来就是展开的 → 遮罩全程保持不动
        // 不设 opacity——CSS 已有 background: rgba(0,0,0,0.38)，
        // 再设 opacity:0.38 会让黑色再乘一层导致变淡
        bd.style.display = "block";
        bd.style.opacity = "1";
      } else {
        // 侧栏关闭中拖开 → 遮罩随进度淡入
        bd.style.display = visualProgress > 0.01 ? "block" : "none";
        bd.style.opacity = 0.38 * visualProgress;
      }
    }

    e.preventDefault();
  }, { passive: false });

  document.addEventListener("touchend", () => {
    if (!isMobileViewport() || !isDragging) return;
    isDragging = false;

    const sb = getSb();
    let progress = 0;
    if (sb) {
      const m = sb.style.transform.match(/translateX\(([-\d.]+)%\)/);
      if (m) progress = 1 + parseFloat(m[1]) / 100;
    }

    // 展开/收起使用对称触发距离：wasOpen时阈值上移至0.65，两边触发距离一致
    const openThreshold = wasOpen ? 0.65 : SNAP_THRESHOLD;
    const willOpen = progress > openThreshold;
    state.mobileSidebarOpen = willOpen;

    // 松手过渡：展开→iOS经典缓出  收起→干脆利落无顿挫
    if (sb) {
      if (willOpen) {
        sb.style.transition = "transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1), opacity 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)";
      } else {
        sb.style.transition = "transform 0.22s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.22s cubic-bezier(0.4, 0, 0.2, 1)";
      }
    }
    const bd = getBd();
    if (bd) {
      bd.style.transition = willOpen
        ? "opacity 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)"
        : "opacity 0.22s cubic-bezier(0.4, 0, 0.2, 1)";
    }
    applySidebarState();
    if (sb) { sb.style.transform = ""; sb.style.opacity = ""; }
    if (bd) { bd.style.opacity = ""; bd.style.display = ""; }

    touchStartX = 0;
    touchStartY = 0;
  }, { passive: true });
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
    const arrow = document.getElementById("chatListArrowIcon");
    if (arrow) arrow.classList.toggle("expanded", willOpen);
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
      // auto-expand chat list so the search input is visible
      if (els.chatListMenu.classList.contains("hidden")) {
        els.chatListMenu.classList.remove("hidden");
        document.getElementById("chatListArrowIcon")?.classList.add("expanded");
      }
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

  const getResizeShell = () => els.settingsResizeHandle.parentElement;
  let activeRect = null;
  let pendingTopHeight = null;
  let rafId = 0;

  const applyPendingHeight = () => {
    rafId = 0;
    const shell = getResizeShell();
    if (!shell || pendingTopHeight === null) {
      return;
    }
    shell.style.gridTemplateRows = `${pendingTopHeight}px 10px minmax(180px, 1fr)`;
  };

  const onPointerMove = (event) => {
    if (!activeRect) {
      return;
    }
    const rawTop = event.clientY - activeRect.top;
    const handleHeight = 10;
    const minTop = 160;
    const minBottom = 180;
    const maxTop = activeRect.height - minBottom - handleHeight;
    pendingTopHeight = Math.max(minTop, Math.min(maxTop, rawTop));
    if (!rafId) {
      rafId = requestAnimationFrame(applyPendingHeight);
    }
  };

  const stopResize = () => {
    activeRect = null;
    pendingTopHeight = null;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stopResize);
  };

  els.settingsResizeHandle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const shell = getResizeShell();
    if (!shell) {
      return;
    }
    activeRect = shell.getBoundingClientRect();
    if (typeof els.settingsResizeHandle.setPointerCapture === "function") {
      try {
        els.settingsResizeHandle.setPointerCapture(event.pointerId);
      } catch (_) {}
    }
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
  button.innerHTML = `<i data-lucide="settings" class="nav-icon-svg"></i>`;
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
  lucide.createIcons();
}

function mountComposerCancelButton() {
  if (!els.composerFooter || els.cancelEditBtn) {
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-btn composer-cancel-btn hidden";
  button.innerHTML = '<i data-lucide="x"></i>';
  button.addEventListener("click", () => {
    clearUserMessageEdit();
  });

  els.sendBtn.insertAdjacentElement("beforebegin", button);
  els.cancelEditBtn = button;
  lucide.createIcons();
}
