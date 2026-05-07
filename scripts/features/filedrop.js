function detectImportedFileType(data) {
  if (data && typeof data === "object" && data.version && data.settings) {
    return "settings";
  }
  if (Array.isArray(data)) {
    return "sessions";
  }
  if (data && typeof data === "object" && data.globalPrompt && Array.isArray(data.messages)) {
    return "sessions";
  }
  return "unknown";
}

function applySettingsFromDrop(data) {
  try {
    state.settings.configs = Array.isArray(data.settings.configs) ? data.settings.configs : [];
    state.settings.activeConfigId = data.settings.activeConfigId || null;
    state.settings.assistant = data.settings.assistant || {};
    state.settings.startup = data.settings.startup || {};
    state.settings.developer = data.settings.developer || {};
    if (data.locale) {
      state.locale = data.locale;
    }
    if (data.modelCache && typeof data.modelCache === "object") {
      state.modelCache = data.modelCache;
    }

    persistSettings();
    persistModelCache();
    applyI18n();
    hydrateSettingsInputs();
    renderSavedConfigs();
    renderModelCache();
    renderWorkModels();
    refreshModelSelectors();
    renderChatListMenu();
    renderSession();
    setText(els.settingsStatus, t("settings.importSuccess"));
  } catch {
    setText(els.settingsStatus, t("settings.importFailed"));
  }
}

function handleDroppedFile(file) {
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);
      const type = detectImportedFileType(data);

      if (type === "settings") {
        applySettingsFromDrop(data);
      } else if (type === "sessions") {
        importSessionsFromFile(file);
      } else {
        setText(els.chatStatus, t("drop.overlayAuto"));
      }
    } catch {
      setText(els.chatStatus, t("settings.importFailedParse"));
    }
  };
  reader.readAsText(file);
}

function getDropContext() {
  const settingsView = document.getElementById("settingsView");
  if (settingsView?.classList.contains("active")) {
    if (state.currentSettingsSection === "global") return "global";
    if (state.currentSettingsSection === "session") return "session";
  }
  return "auto";
}

function bindFileDrop() {
  let dragCounter = 0;

  document.addEventListener("dragenter", (event) => {
    event.preventDefault();
    dragCounter++;
    if (dragCounter === 1) {
      const context = getDropContext();
      const key = context === "global" ? "drop.overlayGlobal" : context === "session" ? "drop.overlaySession" : "drop.overlayAuto";
      if (els.dropOverlayText) {
        els.dropOverlayText.textContent = t(key);
      }
      if (els.dropOverlay) {
        els.dropOverlay.classList.remove("hidden");
      }
    }
  });

  document.addEventListener("dragover", (event) => {
    event.preventDefault();
  });

  document.addEventListener("dragleave", (event) => {
    event.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      if (els.dropOverlay) {
        els.dropOverlay.classList.add("hidden");
      }
    }
  });

  document.addEventListener("drop", (event) => {
    event.preventDefault();
    dragCounter = 0;
    if (els.dropOverlay) {
      els.dropOverlay.classList.add("hidden");
    }

    const files = event.dataTransfer?.files;
    if (!files?.length) return;

    const file = files[0];
    if (!file.name.toLowerCase().endsWith(".json")) {
      setText(els.chatStatus, t("settings.importFailedParse"));
      return;
    }

    handleDroppedFile(file);
  });
}
