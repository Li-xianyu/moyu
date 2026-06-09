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

async function applySettingsFromDrop(data) {
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
    await Promise.all([
      typeof window._loadScript === "function" ? window._loadScript("./scripts/features/settings.js") : Promise.resolve(),
      typeof window._loadScript === "function" ? window._loadScript("./scripts/features/create.js") : Promise.resolve(),
    ]);
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
  reader.onload = async (event) => {
    try {
      const data = JSON.parse(event.target.result);
      const type = detectImportedFileType(data);

      if (type === "settings") {
        await applySettingsFromDrop(data);
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
  const chatView = document.getElementById("chatView");
  if (chatView?.classList.contains("active") && getCurrentSession()) {
    return "chat";
  }
  const settingsView = document.getElementById("settingsView");
  if (settingsView?.classList.contains("active")) {
    if (state.currentSettingsSection === "global") return "global";
    if (state.currentSettingsSection === "session") return "session";
  }
  return "auto";
}

function isFileDrag(event) {
  return event.dataTransfer?.types && Array.from(event.dataTransfer.types).indexOf("Files") !== -1;
}

function bindFileDrop() {
  let dragCounter = 0;

  document.addEventListener("dragenter", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragCounter++;
    if (dragCounter === 1) {
      const context = getDropContext();
      const key = context === "chat"
        ? "drop.overlayChatAttachment"
        : context === "global"
          ? "drop.overlayGlobal"
          : context === "session"
            ? "drop.overlaySession"
            : "drop.overlayAuto";
      if (els.dropOverlayText) {
        els.dropOverlayText.textContent = t(key);
      }
      if (els.dropOverlay) {
        els.dropOverlay.classList.remove("hidden");
      }
    }
  });

  document.addEventListener("dragover", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
  });

  document.addEventListener("dragleave", (event) => {
    if (!isFileDrag(event)) return;
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
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragCounter = 0;
    if (els.dropOverlay) {
      els.dropOverlay.classList.add("hidden");
    }

    const files = event.dataTransfer?.files;
    if (!files?.length) return;

    if (getDropContext() === "chat") {
      const attachments = Array.from(files).filter(isSupportedChatAttachment);
      if (!attachments.length) {
        setText(els.chatStatus, "仅支持 PNG、JPEG、WEBP、GIF 图片、TXT 或 Markdown 文件");
        return;
      }
      addAttachments(attachments);
      if (attachments.length < files.length) {
        setText(els.chatStatus, "已添加支持的附件，其余文件已忽略");
      }
      return;
    }

    const file = files[0];
    const name = file.name.toLowerCase();
    if (!name.endsWith(".json") && !name.endsWith(".ndjson")) {
      setText(els.chatStatus, t("settings.importFailedParse"));
      return;
    }

    handleDroppedFile(file);
  });

  // 阻止选中文本后拖拽触发页面行为
  document.addEventListener("dragstart", (e) => e.preventDefault());
}
