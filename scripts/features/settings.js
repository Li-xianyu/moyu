async function ensureSessionStoreForSettings() {
  if (typeof window.__moyuWarmSessionMetas === "function") {
    await window.__moyuWarmSessionMetas({ immediate: true });
  } else if (typeof window.ensureChatDbLoaded === "function") {
    await window.ensureChatDbLoaded();
  }
  return Boolean(window.__chatDB);
}

let apiEditorRevealed = false;

function isMobileSettingsViewport() {
  return window.matchMedia("(max-width: 960px)").matches;
}

function revealApiEditor() {
  apiEditorRevealed = true;
  syncApiEditorVisibility();
}

function collapseApiEditorForMobile() {
  apiEditorRevealed = false;
  syncApiEditorVisibility();
}

function syncApiEditorVisibility() {
  if (!els.apiSettingsPanel) return;
  const shouldCollapse = isMobileSettingsViewport() && !apiEditorRevealed;
  els.apiSettingsPanel.classList.toggle("api-editor-collapsed", shouldCollapse);
}

function bindSettings() {
  els.settingsBackBtn?.addEventListener("click", () => {
    if (isMobileSettingsViewport() && state.mobileSidebarOpen) {
      state.mobileSidebarOpen = false;
      applySidebarState();
    }
    switchView("chat");
    renderSession();
  });

  els.globalSettingsTabBtn.addEventListener("click", () => {
    switchSettingsSection("global");
  });

  els.assistantSettingsTabBtn.addEventListener("click", () => {
    switchSettingsSection("assistant");
  });

  els.apiSettingsTabBtn.addEventListener("click", () => {
    switchSettingsSection("api");
  });

  els.sessionSettingsTabBtn.addEventListener("click", () => {
    switchSettingsSection("session");
  });

  els.localeSelect.addEventListener("change", () => {
    state.locale = els.localeSelect.value || "zh-CN";
    applyI18n();
    renderSettingsSection();
    renderSavedConfigs();
    renderModelCache();
    renderWorkModels();
    refreshModelSelectors();
    renderChatListMenu();
    renderSession();
  });

  els.themeSelect.addEventListener("change", () => {
    setTheme(els.themeSelect.value);
    renderSettingsSection();
  });

  els.initialPageSelect.addEventListener("change", () => {
    state.settings.startup = state.settings.startup || {};
    state.settings.startup.initialPage = els.initialPageSelect.value || "welcome";
    persistSettings();
  });

  els.assistantModelSelect.addEventListener("change", () => {
    state.settings.assistant = state.settings.assistant || {};
    state.settings.assistant.model = els.assistantModelSelect.value || "";
    persistSettings();
    setText(els.settingsStatus, state.locale === "en-US" ? "Assistant model updated" : "辅助模型已更新");
  });

  els.debugModeToggle.addEventListener("change", () => {
    state.settings.developer = state.settings.developer || {};
    state.settings.developer.debugMode = Boolean(els.debugModeToggle.checked);
    persistSettings();
    debugLog("settings", t("debug.msg.debugModeToggled"), {
      enabled: state.settings.developer.debugMode,
    });
  });

  els.mobileConsoleToggle.addEventListener("change", () => {
    state.settings.developer = state.settings.developer || {};
    state.settings.developer.mobileConsole = Boolean(els.mobileConsoleToggle.checked);
    persistSettings();
    if (typeof syncMobileDebugConsole === "function") {
      syncMobileDebugConsole();
    }
  });

  els.exportSessionsBtn.addEventListener("click", async () => {
    await ensureSessionStoreForSettings();
    exportAllSessions();
  });

  els.importSessionsBtn.addEventListener("click", async () => {
    await ensureSessionStoreForSettings();
    els.importSessionsInput.click();
  });

  els.importSessionsInput.addEventListener("change", async () => {
    if (els.importSessionsInput.files?.[0]) {
      await ensureSessionStoreForSettings();
      importSessionsFromFile(els.importSessionsInput.files[0]);
      els.importSessionsInput.value = "";
    }
  });

  els.compressThresholdInput.addEventListener("change", () => {
    const val = parseInt(els.compressThresholdInput.value, 10);
    if (val >= 500 && val <= 10000) {
      state.settings.session = state.settings.session || {};
      state.settings.session.compressThreshold = val;
      persistSettings();
    }
  });

  els.showTokenDisplayToggle.addEventListener("change", () => {
    state.settings.session = state.settings.session || {};
    state.settings.session.showTokenDisplay = Boolean(els.showTokenDisplayToggle.checked);
    persistSettings();
    if (typeof renderMessages === "function") {
      renderMessages();
    }
  });

  const directorDispatchToggle = document.getElementById("directorDispatchToggle");
  if (directorDispatchToggle) {
    directorDispatchToggle.addEventListener("change", () => {
      state.settings.session = state.settings.session || {};
      state.settings.session.directorDispatchOnly = Boolean(directorDispatchToggle.checked);
      persistSettings();
    });
  }

  const markdownRenderToggle = document.getElementById("markdownRenderToggle");
  if (markdownRenderToggle) {
    markdownRenderToggle.addEventListener("change", () => {
      state.settings.session = state.settings.session || {};
      state.settings.session.markdownRender = Boolean(markdownRenderToggle.checked);
      persistSettings();
    });
  }

  const showLineNumbersToggle = document.getElementById("showLineNumbersToggle");
  if (showLineNumbersToggle) {
    showLineNumbersToggle.addEventListener("change", () => {
      state.settings.session = state.settings.session || {};
      state.settings.session.showLineNumbers = Boolean(showLineNumbersToggle.checked);
      persistSettings();
      if (typeof renderMessages === "function") {
        renderMessages({ stickToBottom: true });
      }
    });
  }

  const autoTtsToggle = document.getElementById("autoTtsToggle");
  if (autoTtsToggle) {
    autoTtsToggle.addEventListener("change", () => {
      state.settings.session = state.settings.session || {};
      state.settings.session.autoTts = Boolean(autoTtsToggle.checked);
      persistSettings();
      if (!autoTtsToggle.checked && typeof window.__cancelAutoTtsTurn === "function") {
        window.__cancelAutoTtsTurn();
      }
    });
  }

  els.addConfigBtn.addEventListener("click", () => {
    const config = createEmptyConfig();
    state.settings.configs.unshift(config);
    state.settings.activeConfigId = config.id;
    state.deleteConfirmConfigId = null;
    revealApiEditor();
    persistSettings();
    hydrateSettingsInputs();
    renderSavedConfigs();
    renderModelCache();
    renderWorkModels();
    refreshModelSelectors();
    setText(els.settingsStatus, state.locale === "en-US" ? "Added a new API profile" : "已新增接口，请填写信息");
  });

  els.saveSettingsBtn.addEventListener("click", () => {
    const activeConfig = getActiveConfig();
    if (!activeConfig) {
      setText(els.settingsStatus, state.locale === "en-US" ? "Add an API profile first" : "请先新增一个接口");
      return;
    }

    const name = els.configNameInput.value.trim();
    const host = normalizeHost(els.apiHostInput.value);
    const key = els.apiKeyInput.value.trim();
    if (!host || !key) {
      setText(els.settingsStatus, state.locale === "en-US" ? "Complete Host and Key first" : "请先填写完整的 Host 和 Key");
      return;
    }

    activeConfig.name = name;
    activeConfig.host = host;
    activeConfig.key = key;
    activeConfig.workModels = Array.isArray(activeConfig.workModels) ? activeConfig.workModels : [];
    state.settings.activeConfigId = activeConfig.id;
    persistSettings();
    renderSavedConfigs();
    renderModelCache();
    renderWorkModels();
    refreshModelSelectors();
    setText(els.settingsStatus, state.locale === "en-US" ? "Settings saved" : "设置已保存");
  });

  els.fetchModelsBtn.addEventListener("click", async () => {
    const activeConfig = getActiveConfig();
    if (!activeConfig) {
      setText(els.settingsStatus, state.locale === "en-US" ? "Add an API profile first" : "请先新增一个接口");
      return;
    }

    const host = normalizeHost(els.apiHostInput.value);
    const key = els.apiKeyInput.value.trim();
    if (!host || !key) {
      setText(els.settingsStatus, state.locale === "en-US" ? "Complete Host and Key first" : "请先填写完整的 Host 和 Key");
      return;
    }

    els.fetchModelsBtn.disabled = true;
    setText(els.settingsStatus, state.locale === "en-US" ? "Fetching model list..." : "正在获取模型列表...");
    try {
      const models = await fetchModels(host, key);
      const cacheKey = getConfigCacheKey(host, key);
      state.modelCache[cacheKey] = {
        host,
        fetchedAt: new Date().toISOString(),
        models,
      };
      activeConfig.name = els.configNameInput.value.trim();
      activeConfig.host = host;
      activeConfig.key = key;
      activeConfig.workModels = (activeConfig.workModels || []).filter((model) => models.includes(model));
      state.settings.activeConfigId = activeConfig.id;
      persistSettings();
      persistModelCache();
      renderSavedConfigs();
      renderModelCache();
      renderWorkModels();
      refreshModelSelectors();
      setText(els.settingsStatus, state.locale === "en-US" ? `Fetched ${models.length} models` : `已获取 ${models.length} 个模型`);
    } catch (error) {
      setText(els.settingsStatus, state.locale === "en-US" ? `Fetch failed: ${error.message}` : `获取失败：${error.message}`);
    } finally {
      els.fetchModelsBtn.disabled = false;
    }
  });

  els.clearCacheBtn.addEventListener("click", () => {
    const activeConfig = getActiveConfig();
    if (!activeConfig) {
      setText(els.settingsStatus, state.locale === "en-US" ? "No API profile available" : "当前没有可操作的接口");
      return;
    }

    const host = normalizeHost(els.apiHostInput.value || activeConfig.host);
    const key = (els.apiKeyInput.value || activeConfig.key).trim();
    if (!host || !key) {
      setText(els.settingsStatus, state.locale === "en-US" ? "No cache to clear" : "当前没有可清理的缓存");
      return;
    }

    delete state.modelCache[getConfigCacheKey(host, key)];
    activeConfig.workModels = [];
    persistSettings();
    persistModelCache();
    renderModelCache();
    renderWorkModels();
    refreshModelSelectors();
    setText(els.settingsStatus, state.locale === "en-US" ? "Cache cleared" : "当前接口缓存已清空");
  });

  els.clearWorkModelsBtn.addEventListener("click", () => {
    const activeConfig = getActiveConfig();
    if (!activeConfig) {
      return;
    }
    activeConfig.workModels = [];
    persistSettings();
    renderWorkModels();
    refreshModelSelectors();
    setText(els.settingsStatus, state.locale === "en-US" ? "Work models cleared" : "工作模型已清空");
  });

  els.modelSearchInput.addEventListener("input", () => {
    renderModelCache();
  });

  if (els.exportBackupBtn) {
    els.exportBackupBtn.addEventListener("click", exportSettingsBackup);
  }
  if (els.importBackupBtn && els.importBackupInput) {
    els.importBackupBtn.addEventListener("click", () => {
      els.importBackupInput.click();
    });
    els.importBackupInput.addEventListener("change", importSettingsBackup);
  }

  if (els.clearAllDataBtn) {
    els.clearAllDataBtn.addEventListener("click", clearAllData);
  }

  preventToggleWhileTyping();
  window.addEventListener("resize", syncApiEditorVisibility, { passive: true });
}

// 移动端设置页：输入框有焦点时，点开关只收起键盘，不触发切换。
// 避免 blur → 键盘收起过程中 viewport 状态机计算错误导致页面收缩。
function preventToggleWhileTyping() {
  const isNarrow = window.matchMedia("(max-width: 960px)").matches;
  const isTouch = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  if (!isNarrow && !isTouch) return;

  document.addEventListener("pointerdown", (e) => {
    if (!isTypingTarget()) return;
    const toggle = e.target.closest(".settings-toggle-row, .settings-toggle-input");
    if (!toggle) return;
    e.preventDefault();
    document.activeElement?.blur();
  }, { capture: true });
}

function switchSettingsSection(section) {
  const previousSection = state.currentSettingsSection;
  state.currentSettingsSection = ["global", "assistant", "session", "api"].includes(section) ? section : "global";
  if (state.currentSettingsSection === "api" && previousSection !== "api") {
    collapseApiEditorForMobile();
  }
  renderSettingsSection();
}

function renderSettingsSection() {
  const section = state.currentSettingsSection;
  const isGlobal = section === "global";
  const isAssistant = section === "assistant";
  const isApi = section === "api";
  const isSession = section === "session";

  els.globalSettingsTabBtn.classList.toggle("active", isGlobal);
  els.assistantSettingsTabBtn.classList.toggle("active", isAssistant);
  els.apiSettingsTabBtn.classList.toggle("active", isApi);
  els.sessionSettingsTabBtn.classList.toggle("active", isSession);
  els.globalSettingsPanel.classList.toggle("active", isGlobal);
  els.assistantSettingsPanel.classList.toggle("active", isAssistant);
  els.apiSettingsPanel.classList.toggle("active", isApi);
  els.sessionSettingsPanel.classList.toggle("active", isSession);
  syncApiEditorVisibility();

}

function hydrateSettingsInputs() {
  const activeConfig = getActiveConfig();
  els.localeSelect.value = state.locale || "zh-CN";
  els.themeSelect.value = state.theme || "dark";
  els.initialPageSelect.value = state.settings?.startup?.initialPage || "welcome";
  hydrateAssistantModelSelect();
  els.debugModeToggle.checked = Boolean(state.settings?.developer?.debugMode);
  els.mobileConsoleToggle.checked = Boolean(state.settings?.developer?.mobileConsole);
  els.compressThresholdInput.value = state.settings?.session?.compressThreshold || 1800;
  els.showTokenDisplayToggle.checked = state.settings?.session?.showTokenDisplay !== false;
  const directorDispatchToggle = document.getElementById("directorDispatchToggle");
  if (directorDispatchToggle) {
    directorDispatchToggle.checked = state.settings?.session?.directorDispatchOnly === true;
  }
  const markdownRenderToggle = document.getElementById("markdownRenderToggle");
  if (markdownRenderToggle) {
    markdownRenderToggle.checked = state.settings?.session?.markdownRender !== false;
  }
  const showLineNumbersToggle = document.getElementById("showLineNumbersToggle");
  if (showLineNumbersToggle) {
    showLineNumbersToggle.checked = state.settings?.session?.showLineNumbers === true;
  }
  const autoTtsToggle = document.getElementById("autoTtsToggle");
  if (autoTtsToggle) {
    autoTtsToggle.checked = state.settings?.session?.autoTts === true;
  }
  els.configNameInput.value = activeConfig?.name || "";
  els.apiHostInput.value = activeConfig?.host || "";
  els.apiKeyInput.value = activeConfig?.key || "";
  renderSettingsSection();
  window.__customSelect?.refreshAll?.();
}

function hydrateAssistantModelSelect() {
  const models = getAllAssistantModels();
  const selectedValue = state.settings?.assistant?.model || "";
  els.assistantModelSelect.innerHTML = "";

  if (!models.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = t("settings.assistantModelEmpty");
    els.assistantModelSelect.appendChild(option);
    els.assistantModelSelect.value = "";
    return;
  }

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = t("settings.assistantModelPlaceholder");
  els.assistantModelSelect.appendChild(placeholder);

  models.forEach((model) => {
    const option = document.createElement("option");
    option.value = model.value;
    option.textContent = model.label;
    els.assistantModelSelect.appendChild(option);
  });

  const hasSelectedValue = models.some((model) => model.value === selectedValue);
  els.assistantModelSelect.value = hasSelectedValue ? selectedValue : "";
  if (!hasSelectedValue && selectedValue) {
    state.settings.assistant = state.settings.assistant || {};
    state.settings.assistant.model = "";
    persistSettings();
  }
  els.assistantModelSelect.dispatchEvent(new Event("change", { bubbles: true }));
}

function getAllAssistantModels() {
  return (state.settings.configs || []).flatMap((config) => {
    if (!config?.host || !config?.key) {
      return [];
    }
    return (config.workModels || []).map((name) => ({
      value: `${config.id}:::${name}`,
      label: config.name?.trim() ? `${name} · ${config.name.trim()}` : `${name} · ${config.host}`,
    }));
  });
}

function renderSavedConfigs() {
  els.savedConfigs.innerHTML = "";
  if (!state.settings.configs.length) {
    els.savedConfigs.innerHTML = `<div class="hint-text">${escapeHtml(state.locale === "en-US" ? "No API profiles yet. Add one first." : "还没有接口，先新增一个。")}</div>`;
    return;
  }

  state.settings.configs.forEach((config) => {
    const button = document.createElement("button");
    button.type = "button";
    const isActive = config.id === state.settings.activeConfigId;
    button.className = `settings-config-item ${isActive ? "active" : ""}`.trim();
    const configLabel = getConfigLabel(config);
    button.title = configLabel;
    const isDeleteConfirm = state.deleteConfirmConfigId === config.id;
    const workModelCount = Array.isArray(config.workModels) ? config.workModels.length : 0;
    button.innerHTML = `
      <div class="settings-config-top">
        <strong class="settings-config-name">${escapeHtml(configLabel)}</strong>
        <button type="button" class="settings-config-delete-btn ${isDeleteConfirm ? "confirm" : ""}" aria-label="${escapeHtml(state.locale === "en-US" ? "Delete API profile" : "删除接口")}">
          <i data-lucide="x" class="settings-config-delete-icon"></i>
        </button>
      </div>
      <span class="settings-config-host">${escapeHtml(config.host || (state.locale === "en-US" ? "Host not set" : "未填写 Host"))}</span>
      <div class="settings-config-meta">
        <span class="settings-config-count">${escapeHtml(state.locale === "en-US" ? `${workModelCount} models` : `${workModelCount} 个模型`)}</span>
      </div>
    `;
    button.addEventListener("click", () => {
      state.settings.activeConfigId = config.id;
      state.deleteConfirmConfigId = null;
      revealApiEditor();
      persistSettings();
    hydrateSettingsInputs();
    renderSavedConfigs();
    renderModelCache();
    renderWorkModels();
    refreshModelSelectors();
      setText(els.settingsStatus, state.locale === "en-US" ? "Switched to this API profile" : "已切换到该接口配置");
    });

    const deleteBtn = button.querySelector(".settings-config-delete-btn");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        if (state.deleteConfirmConfigId === config.id) {
          deleteConfig(config.id);
          return;
        }
        state.deleteConfirmConfigId = config.id;
        renderSavedConfigs();
      });
    }

    els.savedConfigs.appendChild(button);
  });
  lucide.createIcons();
}

function deleteConfig(configId) {
  const target = state.settings.configs.find((config) => config.id === configId);
  if (!target) {
    return;
  }

  if (target.host && target.key) {
    delete state.modelCache[getConfigCacheKey(target.host, target.key)];
  }

  state.settings.configs = state.settings.configs.filter((config) => config.id !== configId);
  if (!state.settings.configs.length) {
    const nextConfig = createEmptyConfig();
    state.settings.configs.push(nextConfig);
    state.settings.activeConfigId = nextConfig.id;
  } else if (state.settings.activeConfigId === configId) {
    state.settings.activeConfigId = state.settings.configs[0].id;
  }

  state.deleteConfirmConfigId = null;
  persistSettings();
  persistModelCache();
    hydrateSettingsInputs();
    renderSavedConfigs();
    renderModelCache();
    renderWorkModels();
    refreshModelSelectors();
  setText(els.settingsStatus, state.locale === "en-US" ? "API profile deleted" : "接口已删除");
}

function renderModelCache() {
  const activeConfig = getActiveConfig();
  const host = normalizeHost(els.apiHostInput.value || activeConfig?.host || "");
  const key = (els.apiKeyInput.value || activeConfig?.key || "").trim();
  const cache = host && key ? state.modelCache[getConfigCacheKey(host, key)] : null;
  const search = els.modelSearchInput.value.trim().toLowerCase();
  const selected = new Set(activeConfig?.workModels || []);

  els.modelList.innerHTML = "";
  if (!cache?.models?.length) {
    els.modelCacheInfo.textContent = state.locale === "en-US" ? "No cache available" : "当前没有缓存";
    els.modelList.innerHTML = `<li class="hint-text">${escapeHtml(state.locale === "en-US" ? "Fetch models first" : "先获取模型列表")}</li>`;
    return;
  }

  const time = new Date(cache.fetchedAt).toLocaleString("zh-CN");
  const filteredModels = cache.models.filter((model) => model.toLowerCase().includes(search));
  const selectedCount = cache.models.filter((model) => selected.has(model)).length;
  els.modelCacheInfo.textContent = state.locale === "en-US"
    ? `Cached at ${time}, selected ${selectedCount}/${cache.models.length}, showing ${filteredModels.length}`
    : `缓存时间：${time}，已选 ${selectedCount}/${cache.models.length}，当前显示 ${filteredModels.length} 个`;

  if (!filteredModels.length) {
    els.modelList.innerHTML = `<li class="hint-text">${escapeHtml(state.locale === "en-US" ? "No matching models" : "没有匹配到模型")}</li>`;
    return;
  }

  filteredModels.forEach((model) => {
    const item = document.createElement("li");
    item.className = `model-list-item ${selected.has(model) ? "selected" : ""}`.trim();
    const caps = window.getModelCapabilities ? window.getModelCapabilities(model) : null;
    let icons = '';
    if (caps) {
      if (caps.input.image) icons += '<i data-lucide="eye" class="model-cap-icon cap-vision"></i>';
      if (caps.tool_call) icons += '<i data-lucide="wrench" class="model-cap-icon cap-tool"></i>';
      if (caps.reasoning) icons += '<i data-lucide="brain" class="model-cap-icon cap-reason"></i>';
    }
    item.innerHTML = `<span class="model-list-name">${escapeHtml(model)}</span><span class="model-cap-icons">${icons}</span>`;
    item.addEventListener("click", () => {
      if (!activeConfig) {
        return;
      }
      const next = new Set(activeConfig.workModels || []);
      if (next.has(model)) {
        next.delete(model);
      } else {
        next.add(model);
      }
      activeConfig.workModels = cache.models.filter((name) => next.has(name));
      persistSettings();
      renderModelCache();
      renderWorkModels();
      refreshModelSelectors();
    });
    els.modelList.appendChild(item);
  });
  lucide.createIcons();
}

function renderWorkModels() {
  els.workModelList.innerHTML = "";
  const configs = Array.isArray(state.settings.configs) ? state.settings.configs : [];
  const groupedConfigs = configs
    .map((config) => {
      const cachedModels = config.host && config.key
        ? (state.modelCache[getConfigCacheKey(config.host, config.key)]?.models || [])
        : [];
      const selectedModels = (config.workModels || []).filter((model) => !cachedModels.length || cachedModels.includes(model));
      return {
        config,
        selectedModels,
      };
    })
    .filter((entry) => entry.selectedModels.length);

  els.workModelHint.textContent = groupedConfigs.length
    ? (state.locale === "en-US" ? "Showing all enabled work models grouped by API profile." : "按接口分组显示所有正在启用的工作模型。")
    : (state.locale === "en-US" ? "No work models enabled yet. Click models in the cached models panel to add them." : "还没有启用工作模型，请在缓存模型区点击添加。");

  if (!groupedConfigs.length) {
    els.workModelList.innerHTML = `<div class="hint-text">${escapeHtml(els.workModelHint.textContent)}</div>`;
    return;
  }

  groupedConfigs.forEach(({ config, selectedModels }) => {
    const group = document.createElement("section");
    group.className = "work-model-group";

    group.innerHTML = `
      <div class="work-model-group-label">${escapeHtml(getConfigLabel(config))}</div>
      <div class="work-model-group-list"></div>
    `;

    const list = group.querySelector(".work-model-group-list");
    selectedModels.forEach((model) => {
      const item = document.createElement("div");
      item.className = "work-model-item";
      const caps = window.getModelCapabilities ? window.getModelCapabilities(model) : null;
      let icons = "";
      if (caps) {
        if (caps.input.image) icons += `<i data-lucide="eye" class="model-cap-icon cap-vision"></i>`;
        if (caps.tool_call) icons += `<i data-lucide="wrench" class="model-cap-icon cap-tool"></i>`;
        if (caps.reasoning) icons += `<i data-lucide="brain" class="model-cap-icon cap-reason"></i>`;
      }
      item.innerHTML = `<span class="work-model-name">${escapeHtml(model)}</span><span class="model-cap-icons">${icons}</span>`;
      item.addEventListener("click", () => {
        config.workModels = (config.workModels || []).filter((name) => name !== model);
        persistSettings();
        renderModelCache();
        renderWorkModels();
        refreshModelSelectors();
      });
      list.appendChild(item);
    });

    els.workModelList.appendChild(group);
  });
  lucide.createIcons();
}

function getActiveConfigModels() {
  const activeConfig = getActiveConfig();
  if (!activeConfig?.host || !activeConfig?.key) {
    return [];
  }
  return state.modelCache[getConfigCacheKey(activeConfig.host, activeConfig.key)]?.models || [];
}

async function fetchModels(host, key) {
  const response = await fetch(`${host}/models`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  const models = Array.isArray(data.data) ? data.data.map((item) => item.id).filter(Boolean) : [];
  if (!models.length) {
    throw new Error(state.locale === "en-US" ? "No models returned" : "没有获取到模型列表");
  }
  return models;
}

function exportSettingsBackup() {
  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: {
      configs: state.settings.configs,
      activeConfigId: state.settings.activeConfigId,
      assistant: state.settings.assistant,
      startup: state.settings.startup,
      developer: state.settings.developer,
      session: state.settings.session,
    },
    locale: state.locale,
    modelCache: state.modelCache,
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `moyu-settings-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  setText(els.settingsStatus, state.locale === "en-US" ? "Settings exported" : "设置备份已导出");
}

function importSettingsBackup(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data?.version || !data?.settings) {
        throw new Error("invalid");
      }

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
    } catch (err) {
      const msg = err.message === "invalid" ? t("settings.importFailed") : t("settings.importFailedParse");
      setText(els.settingsStatus, msg);
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

async function clearAllData() {
  await ensureSessionStoreForSettings();
  if (window.__chatDB?.clearAll) {
    if (!confirm(t("settings.clearAllDataConfirm"))) return;
    if (!confirm(t("settings.clearAllDataConfirm2"))) return;
    var btn = document.getElementById("clearAllDataBtn");
    if (btn) btn.disabled = true;
    window.__chatDB.clearAll().then(function () {
      state.sessions = [];
      state.currentSessionId = null;
      persistSessions();
      renderSession();
      renderChatListMenu();
      setText(els.settingsStatus, t("settings.clearAllDataSuccess"));
    }).catch(function (err) {
      setText(els.settingsStatus, t("settings.clearAllDataFailed", { message: err.message || String(err) }));
    }).finally(function () {
      if (btn) btn.disabled = false;
    });
  }
}
