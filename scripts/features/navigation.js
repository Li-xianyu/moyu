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
    button.addEventListener("click", () => {
      if (button.dataset.view === "create") {
        prepareCreateViewForNewSession();
      }
      switchView(button.dataset.view);
    });
  });

  applySidebarState();
}

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
  button.addEventListener("click", () => {
    if (state.isSending) {
      return;
    }
    const session = getCurrentSession();
    if (session) {
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
  button.textContent = "取消";
  button.addEventListener("click", () => {
    clearUserMessageEdit();
  });

  els.sendBtn.insertAdjacentElement("beforebegin", button);
  els.cancelEditBtn = button;
}
