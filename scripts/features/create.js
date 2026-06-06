"use strict";

function resetUserMessageEditStateIfNeeded() {
  if (typeof clearUserMessageEdit === "function") {
    clearUserMessageEdit();
    return;
  }
  state.editingUserMessageId = null;
  state.openUserMessageToolsId = null;
  if (els.chatInput) {
    els.chatInput.value = "";
  }
}

async function ensureChatFeatureForCreateTransition() {
  if (typeof window.ensureChatFeatureLoaded === "function") {
    await window.ensureChatFeatureLoaded();
  }
}

function queueSessionTitleGeneration(session) {
  if (!session || session.titleSource === "manual") {
    return;
  }
  if (typeof ensureChatRuntimeLoaded === "function") {
    void ensureChatRuntimeLoaded()
      .then(() => {
        if (typeof generateSessionTitle === "function") {
          return generateSessionTitle(session);
        }
        return null;
      })
      .catch((error) => debugWarn("[chat-runtime] title generation preload failed", error));
    return;
  }
  if (typeof generateSessionTitle === "function") {
    void generateSessionTitle(session);
  }
}

function queueSuggestionGuideGeneration(session) {
  if (typeof generateSuggestionGuide === "function") {
    void generateSuggestionGuide(session);
  }
}

function updateEntityTerms() {
  const mode = getSelectedMode();
  const term = getEntityTerm(mode);
  const entityKeys = [
    "create.subtitle", "create.editSubtitle", "create.newSubtitle",
    "create.statusMaxNpc", "create.statusNpcAdded", "create.statusMinNpc",
    "create.statusNpcDeleted", "create.statusNpcCount", "create.errorNpcCount",
    "create.errorNpcModel", "create.npcTitle", "create.npcSubtitle",
    "create.addNpc", "create.noDirectorHint", "create.noGlobalPromptHint",
    "npc.unnamed", "npc.nameLabel", "npc.promptLabel", "npc.footer",
  ];

  entityKeys.forEach((key) => {
    document.querySelectorAll(`[data-i18n="${key}"]`).forEach((node) => {
      node.textContent = t(key, { entityType: term });
    });
  });
}

function setCreateStatus(message, tone = "") {
  if (!els.createStatus) return;
  els.createStatus.textContent = message;
  els.createStatus.dataset.tone = tone;
}

function getNpcCountHint() {
  const min = getModeMinNpcs();
  return t("create.statusNpcCount", { min: String(min), max: "5", entityType: getEntityTerm(getSelectedMode()) });
}

function getMinNpcWarning() {
  return t("create.statusMinNpc", { n: String(getModeMinNpcs()), entityType: getEntityTerm(getSelectedMode()) });
}

function getCurrentCreateEditSection() {
  const valid = ["details", "overrides", "advanced"];
  return valid.includes(state.currentSessionEditSection) ? state.currentSessionEditSection : "details";
}

function getSessionAgents(session) {
  if (!session) return [];
  const agents = [];
  const isSingleNpc = session.mode === SESSION_MODE_WORK
    && (!session.directorModel || (session.npcs || []).length <= 1);
  if (!isSingleNpc && session.directorModel) {
    agents.push({ key: "director", label: "导演", model: session.directorModel });
  }
  (session.npcs || []).forEach(function (npc) {
    if (npc.name && npc.model) {
      agents.push({ key: npc.name, label: npc.name, model: npc.model });
    }
  });
  return agents;
}

function renderSessionAdvancedControls() {
  var session = getEditingSessionTarget();
  var container = els.sessionAdvancedAgentList;
  if (!container) return;

  container.innerHTML = "";
  if (!session) return;

  var agents = getSessionAgents(session);
  agents.forEach(function (agent) {
    var tempVal = getSessionAgentParam(session, agent.key, "temperature");
    var defaultTemp = agent.key === "director" ? 0.5 : getNpcResponseTemperature(session, agent.model);
    var displayTemp = tempVal !== undefined && tempVal !== null ? tempVal : defaultTemp;

    var row = document.createElement("div");
    row.className = "session-agent-param-row";

    var header = document.createElement("div");
    header.className = "session-agent-param-header";

    var nameSpan = document.createElement("span");
    nameSpan.className = "session-agent-param-name";
    nameSpan.textContent = agent.label;

    var modelSpan = document.createElement("span");
    modelSpan.className = "session-agent-param-model";
    modelSpan.textContent = agent.model;

    header.appendChild(nameSpan);
    header.appendChild(modelSpan);

    var controls = document.createElement("div");
    controls.className = "session-agent-param-controls";

    // Temperature field
    var tempField = document.createElement("label");
    tempField.className = "session-agent-param-field";
    var tempLabel = document.createElement("span");
    tempLabel.textContent = t("create.advancedTemperatureLabel");
    var tempInput = document.createElement("input");
    tempInput.type = "number";
    tempInput.min = "0";
    tempInput.max = "2";
    tempInput.step = "0.1";
    tempInput.className = "field";
    tempInput.value = String(displayTemp);
    tempInput.placeholder = t("create.overrideGlobalDefault", { value: String(defaultTemp) });
    tempInput.dataset.agent = agent.key;
    tempInput.dataset.param = "temperature";
    tempField.appendChild(tempLabel);
    tempField.appendChild(tempInput);

    controls.appendChild(tempField);

    row.appendChild(header);
    row.appendChild(controls);
    container.appendChild(row);
  });

  // Bind change events
  container.querySelectorAll("input[data-param]").forEach(function (input) {
    input.addEventListener("change", function () {
      if (!state.editingSessionId) return;
      var s = getEditingSessionTarget();
      if (!s) return;
      var agentName = this.dataset.agent;
      var param = this.dataset.param;
      var raw = this.value.trim();
      if (raw === "") {
        if (s.agentParams && s.agentParams[agentName]) {
          var next = {};
          Object.keys(s.agentParams[agentName]).forEach(function (k) {
            if (k !== param) next[k] = s.agentParams[agentName][k];
          });
          if (Object.keys(next).length === 0) {
            var cleaned = {};
            Object.keys(s.agentParams).forEach(function (k) {
              if (k !== agentName) cleaned[k] = s.agentParams[k];
            });
            s.agentParams = cleaned;
          } else {
            s.agentParams[agentName] = next;
          }
        }
      } else {
        setSessionAgentParam(s, agentName, param, raw);
      }
      touchSession(s);
      persistSessions();
    });
  });

  lucide.createIcons();
}

const SESSION_OVERRIDE_KEYS = [
  "compressThreshold",
  "directorDispatchOnly",
  "modelThinking",
  "showTokenDisplay",
  "markdownRender",
  "showLineNumbers",
  "showModelProviderIcon",
];

function getEditingSessionTarget() {
  return state.sessions.find((item) => item.id === state.editingSessionId) || null;
}

function formatSessionOverrideValue(key, value) {
  if (key === "compressThreshold") {
    return String(normalizeSessionSettingValue(key, value));
  }
  if (key === "modelThinking") {
    return normalizeSessionSettingValue(key, value) === "enabled"
      ? t("create.overrideValueOn")
      : t("create.overrideValueOff");
  }
  return normalizeSessionSettingValue(key, value)
    ? t("create.overrideValueOn")
    : t("create.overrideValueOff");
}

function renderSessionOverrideControls() {
  const session = getEditingSessionTarget();
  if (!els.sessionEditOverridesPanel) {
    return;
  }

  SESSION_OVERRIDE_KEYS.forEach((key) => {
    const control = els.sessionEditOverridesPanel.querySelector(`[data-session-setting="${key}"]`);
    const source = els.sessionEditOverridesPanel.querySelector(`[data-session-override-source="${key}"]`);
    const resetBtn = els.sessionEditOverridesPanel.querySelector(`[data-session-override-reset="${key}"]`);
    const hasOverride = session ? hasSessionSettingOverride(session, key) : false;
    const effectiveValue = session ? getSessionSetting(session, key) : getGlobalSessionSetting(key);
    const globalValue = getGlobalSessionSetting(key);

    if (control) {
      if (control.type === "checkbox") {
        control.checked = key === "modelThinking"
          ? effectiveValue === "enabled"
          : Boolean(effectiveValue);
      } else {
        control.value = String(effectiveValue);
      }
      control.disabled = !session;
    }

    if (source) {
      const stateText = hasOverride ? t("create.overrideCustomized") : t("create.overrideUsingGlobal");
      const globalDefaultValue = key === "showModelProviderIcon" && session
        ? getDefaultModelProviderIconVisibility(session)
        : globalValue;
      const globalText = t("create.overrideGlobalDefault", { value: formatSessionOverrideValue(key, globalDefaultValue) });
      source.textContent = `${stateText} | ${globalText}`;
    }

    if (resetBtn) {
      resetBtn.disabled = !session || !hasOverride;
    }
  });
}

function commitSessionOverrideChange(key, nextValue, options = {}) {
  const session = getEditingSessionTarget();
  if (!session || !SESSION_OVERRIDE_KEYS.includes(key)) {
    return;
  }

  if (options.clear) {
    clearSessionSettingOverride(session, key);
  } else {
    setSessionSettingOverride(session, key, nextValue);
  }

  touchSession(session);
  persistSessions();
  renderSessionOverrideControls();
  if (state.currentSessionId === session.id) {
    if (key === "showTokenDisplay" || key === "markdownRender" || key === "showLineNumbers" || key === "showModelProviderIcon") {
      if (typeof renderMessages === "function") {
        renderMessages({ keepWindow: true });
      }
      if (key === "showModelProviderIcon" && typeof syncModelProviderIconVisibility === "function") {
        syncModelProviderIconVisibility(session);
      }
    }
    if (key === "modelThinking") {
      if (els.modelThinkingBtn) {
        els.modelThinkingBtn.dataset.state = getSessionSetting(session, "modelThinking");
      }
      if (typeof updateModelThinkingBtn === "function") {
        updateModelThinkingBtn();
      }
      if (typeof updateThinkingToggleMode === "function") {
        updateThinkingToggleMode();
      }
    }
    if (key === "compressThreshold" && typeof renderCompressMemoryPopover === "function") {
      renderCompressMemoryPopover();
    }
  }
}

function bindSessionOverrideControls() {
  if (!els.sessionEditOverridesPanel) {
    return;
  }

  els.sessionEditOverridesPanel.querySelectorAll("[data-session-setting]").forEach((control) => {
    control.addEventListener("change", () => {
      if (!state.editingSessionId) {
        return;
      }

      const key = control.dataset.sessionSetting;
      if (!key) {
        return;
      }

      if (control.type === "number") {
        const value = Number.parseInt(control.value, 10);
        if (!Number.isFinite(value)) {
          renderSessionOverrideControls();
          return;
        }
        commitSessionOverrideChange(key, value);
        return;
      }

      if (key === "modelThinking") {
        commitSessionOverrideChange(key, control.checked ? "enabled" : "disabled");
        return;
      }

      commitSessionOverrideChange(key, Boolean(control.checked));
    });
  });

  els.sessionEditOverridesPanel.querySelectorAll("[data-session-override-reset]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sessionOverrideReset;
      if (!key || !state.editingSessionId) {
        return;
      }
      commitSessionOverrideChange(key, null, { clear: true });
    });
  });
}

function getCreateExitMeta() {
  if (state.editingSessionId) {
    return {
      label: state.locale === "en-US" ? "Exit Editing" : "退出编辑",
      target: "chat",
      welcome: false,
    };
  }

  if (state.createExitTarget === "chat") {
    return {
      label: state.locale === "en-US" ? "Back to Chat" : "返回聊天",
      target: "chat",
      welcome: false,
    };
  }

  return {
    label: state.locale === "en-US" ? "Back to Home" : "返回主页",
    target: "welcome",
    welcome: true,
  };
}

function updateCreateExitButton() {
  const meta = getCreateExitMeta();
  if (els.sessionEditTopbar) {
    els.sessionEditTopbar.classList.remove("hidden");
  }
  if (els.sessionEditExitLabel) {
    els.sessionEditExitLabel.textContent = meta.label;
  }
  if (els.sessionEditExitBtn) {
    els.sessionEditExitBtn.setAttribute("aria-label", meta.label);
    els.sessionEditExitBtn.title = meta.label;
    els.sessionEditExitBtn.dataset.targetView = meta.target;
  }
}

function syncCreateEditNavigation() {
  const isEditing = Boolean(state.editingSessionId);
  const activeSection = isEditing ? getCurrentCreateEditSection() : "details";
  const showDetails = activeSection === "details";
  const tabButtons = [els.sessionEditInfoTabBtn, els.sessionEditOverridesTabBtn, els.sessionEditAdvancedTabBtn];
  const navButtons = [els.sessionEditInfoNavBtn, els.sessionEditOverridesNavBtn, els.sessionEditAdvancedNavBtn];

  updateCreateExitButton();
  if (els.sessionEditTabs) {
    const showTabs = isEditing && window.matchMedia("(max-width: 960px)").matches;
    els.sessionEditTabs.classList.toggle("hidden", !showTabs);
  }
  if (els.sessionEditSidebar) {
    els.sessionEditSidebar.classList.toggle("hidden", !isEditing);
  }
  if (els.sessionEditFooter) {
    els.sessionEditFooter.classList.toggle("hidden", isEditing && activeSection !== "details");
  }

  tabButtons.forEach((button) => {
    if (!button) return;
    const isActive = isEditing && button.dataset.sessionEditSection === activeSection;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
    button.tabIndex = isActive ? 0 : -1;
  });

  navButtons.forEach((button) => {
    if (!button) return;
    const isActive = isEditing && button.dataset.sessionEditSection === activeSection;
    button.classList.toggle("active", isActive);
  });

  if (els.sessionEditInfoPanel) {
    els.sessionEditInfoPanel.classList.toggle("active", showDetails);
  }
  if (els.sessionEditOverridesPanel) {
    els.sessionEditOverridesPanel.classList.toggle("active", isEditing && activeSection === "overrides");
  }
  if (els.sessionEditAdvancedPanel) {
    els.sessionEditAdvancedPanel.classList.toggle("active", isEditing && activeSection === "advanced");
  }
  if (isEditing) {
    renderSessionOverrideControls();
    if (activeSection === "advanced") {
      renderSessionAdvancedControls();
    }
  }
}

function switchCreateEditSection(section) {
  var valid = ["details", "overrides", "advanced"];
  state.currentSessionEditSection = valid.includes(section) ? section : "details";
  updateCreateViewMode();
}

function bindCreateEditNavigation() {
  [els.sessionEditInfoTabBtn, els.sessionEditOverridesTabBtn, els.sessionEditAdvancedTabBtn,
   els.sessionEditInfoNavBtn, els.sessionEditOverridesNavBtn, els.sessionEditAdvancedNavBtn]
    .filter(Boolean)
    .forEach((button) => {
      button.addEventListener("click", () => {
        if (!state.editingSessionId) {
          return;
        }
        switchCreateEditSection(button.dataset.sessionEditSection);
      });
    });

  els.sessionEditExitBtn?.addEventListener("click", async () => {
    if (state.editingSessionId) {
      await ensureChatFeatureForCreateTransition();
      state.editingSessionId = null;
      state.currentSessionEditSection = "details";
      updateCreateViewMode();
      renderSession();
      switchView("chat");
      return;
    }

    state.currentSessionEditSection = "details";
    state.showWelcomeHome = state.createExitTarget !== "chat";
    if (!state.showWelcomeHome) {
      await ensureChatFeatureForCreateTransition();
    }
    renderSession();
    switchView("chat");
  });
}

function bindCreateFlow() {
  bindCreateEditNavigation();
  bindSessionOverrideControls();

  document.querySelectorAll('input[name="sessionMode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.checked) {
        syncSessionModePresentation(Boolean(state.editingSessionId), radio.value);
        setCreateStatus(getNpcCountHint(), "");
      }
    });
  });

  els.addNpcBtn.addEventListener("click", () => {
    if (els.npcList.children.length >= 5) {
      setCreateStatus(t("create.statusMaxNpc", { entityType: getEntityTerm(getSelectedMode()) }), "warning");
      return;
    }
    addNpcCard();
    updateSingleNpcVisibility();
    updateEntityTerms();
    setCreateStatus(t("create.statusNpcAdded", { entityType: getEntityTerm(getSelectedMode()) }), "success");
  });

  els.createChatBtn.addEventListener("click", async () => {
    const payload = collectSessionDraft();
    if (!payload.ok) {
      setCreateStatus(payload.message, "error");
      return;
    }

    const activeConfig = getActiveConfig();
    if (!activeConfig) {
      setCreateStatus(t("create.errorSelectConfig"), "error");
      return;
    }

    if (state.editingSessionId) {
      await saveSessionEdits(payload, activeConfig);
      return;
    }

    const isSingleNpc = payload.mode === SESSION_MODE_WORK && payload.npcs.length <= 1;
    const chaosMode = isChaosMode(payload.mode);
    const directorConfig = isSingleNpc || chaosMode ? null : getConfigById(payload.directorConfigId);
    if (!isSingleNpc && !chaosMode && (!directorConfig?.host || !directorConfig?.key)) {
      setCreateStatus(t("create.statusDirectorUnavailable"), "error");
      return;
    }

    const npcConfig = isSingleNpc ? getConfigById(payload.npcs[0].configId) : null;
    const primaryChaosConfig = chaosMode ? getConfigById(payload.npcs[0]?.configId || "") : null;
    const session = {
      id: `session-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      configId: isSingleNpc
        ? (npcConfig?.id || "")
        : chaosMode
          ? (primaryChaosConfig?.id || activeConfig?.id || "")
          : (directorConfig?.id || ""),
      host: isSingleNpc
        ? (npcConfig?.host || "")
        : chaosMode
          ? (primaryChaosConfig?.host || activeConfig?.host || "")
          : (directorConfig?.host || ""),
      key: isSingleNpc
        ? (npcConfig?.key || "")
        : chaosMode
          ? (primaryChaosConfig?.key || activeConfig?.key || "")
          : (directorConfig?.key || ""),
      title: t("chat.generatingTitle"),
      titleSource: "auto",
      globalPrompt: payload.globalPrompt,
      mode: payload.mode,
      directorModel: payload.directorModel || "",
      directorConfigId: payload.directorConfigId || "",
      settingsOverrides: {},
      agentParams: {},
      npcs: payload.npcs,
      transientNpcs: [],
      directorMemory: normalizeDirectorMemory(null),
      directorSummary: "",
      chatSummary: "",
      compressedUntilMessageId: "",
      suggestionGuide: "",
      latestTurnBaseState: null,
      latestTurnVariants: null,
      userRole: payload.userRole || "",
      chaosState: null,
      messages: [
        {
          role: "system",
          speaker: t("chat.systemSpeaker"),
          uiType: "system-notice",
          content: payload.globalPrompt
            ? `${t("chat.systemNoticeCreated")}\n\n${t("chat.globalPromptLabel")}：\n${payload.globalPrompt}`
            : t("chat.systemNoticeCreated"),
          createdAt: new Date().toISOString(),
        },
      ],
    };

    upsertSession(session);
    state.showWelcomeHome = false;
    state.currentSessionId = session.id;
    persistSessions();
    try {
      await ensureChatFeatureForCreateTransition();
    } catch (error) {
      debugWarn("[chat-feature] create transition failed", error);
      setCreateStatus("聊天模块加载失败，请刷新后重试", "error");
      return;
    }
    persistSessions();
    renderSession();
    switchView("chat");
    setCreateStatus(t("create.statusCreated"), "success");
    setText(els.chatStatus, t("chat.readyAfterCreate"));
    queueSessionTitleGeneration(session);
    queueSuggestionGuideGeneration(session);
  });

  bindUserRoleSelect();
}

function refreshRoleSelectOptions() {
  var select = els.userRoleSelect;
  if (!select) return;
  var currentVal = select.value;
  select.innerHTML = "<option value=\"\">" + escapeHtml(t("create.userRoleSelect")) + "</option>";
  state.userRoles.forEach(function (role) {
    var opt = document.createElement("option");
    opt.value = role.id;
    opt.textContent = role.name;
    select.appendChild(opt);
  });
  if (currentVal && state.userRoles.some(function (r) { return r.id === currentVal; })) {
    select.value = currentVal;
  }
}

var _userRoleSelectBound = false;

function bindUserRoleSelect() {
  var select = els.userRoleSelect;
  var input = els.userRoleInput;
  if (!select || !input) return;

  refreshRoleSelectOptions();

  if (!_userRoleSelectBound) {
    _userRoleSelectBound = true;
    select.addEventListener("change", function () {
      var role = getRoleById(select.value);
      if (role) {
        input.value = role.description;
      }
    });
  }
}

function getSelectedMode() {
  const radio = document.querySelector('input[name="sessionMode"]:checked');
  return radio ? radio.value : SESSION_MODE_STORY;
}

function isChaosMode(mode) {
  return mode === SESSION_MODE_CHAOS;
}

function getModeMinNpcs() {
  return getSelectedMode() === SESSION_MODE_WORK ? 1 : 2;
}

function updateSingleNpcVisibility() {
  const directorField = document.getElementById("directorField");
  const noDirectorHint = document.getElementById("noDirectorHint");
  const globalPromptField = document.getElementById("globalPromptField");
  const noGlobalPromptHint = document.getElementById("noGlobalPromptHint");
  const userRoleField = document.getElementById("userRoleField");
  if (!directorField) return;
  const mode = getSelectedMode();
  const isWorkModeSingleNpc = mode === SESSION_MODE_WORK && els.npcList.children.length <= 1;
  const chaosMode = isChaosMode(mode);
  directorField.hidden = chaosMode || isWorkModeSingleNpc;
  if (noDirectorHint) {
    noDirectorHint.hidden = true;
  }
  if (globalPromptField) {
    globalPromptField.hidden = isWorkModeSingleNpc;
  }
  if (noGlobalPromptHint) {
    noGlobalPromptHint.hidden = true;
  }
  if (userRoleField) {
    userRoleField.hidden = chaosMode;
  }
}

function ensureMinimumNpcs() {
  const min = getModeMinNpcs();
  while (els.npcList.children.length < min) {
    addNpcCard({}, { expandOnMount: false });
  }
  refreshModelSelectors();
  collapseAllNpcAccordions();
  updateSingleNpcVisibility();
  updateEntityTerms();
}

function ensureModeMinNpcs() {
  const min = getModeMinNpcs();
  while (els.npcList.children.length < min) {
    addNpcCard({}, { expandOnMount: false });
  }
  const cards = [...els.npcList.querySelectorAll(".npc-card")];
  while (cards.length > min) {
    const card = cards.pop();
    const name = card.querySelector(".npc-name")?.value?.trim() || "";
    const model = card.querySelector(".npc-model")?.value?.trim() || "";
    const prompt = card.querySelector(".npc-prompt")?.value?.trim() || "";
    if (!name && !model && !prompt) {
      card.remove();
    } else {
      break;
    }
  }
  refreshModelSelectors();
  collapseAllNpcAccordions();
  updateSingleNpcVisibility();
  updateEntityTerms();
}

function addNpcCard(prefill = {}, options = {}) {
  const fragment = els.npcTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".npc-card");
  const accordionToggle = fragment.querySelector(".npc-accordion-toggle");
  const accordionName = fragment.querySelector(".npc-accordion-name");
  const nameInput = fragment.querySelector(".npc-name");
  const modelSelect = fragment.querySelector(".npc-model");
  const promptInput = fragment.querySelector(".npc-prompt");
  const removeBtn = fragment.querySelector(".remove-npc-btn");

  nameInput.value = prefill.name || "";
  promptInput.value = prefill.prompt || "";
  syncNpcCardTitle(card, accordionName, nameInput.value);

  nameInput.addEventListener("input", () => {
    syncNpcCardTitle(card, accordionName, nameInput.value);
  });

  if (accordionToggle) {
    accordionToggle.addEventListener("click", () => {
      toggleNpcAccordion(card);
    });
  }

  removeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (els.npcList.children.length <= getModeMinNpcs()) {
      setCreateStatus(getMinNpcWarning(), "warning");
      return;
    }
    card.remove();
    ensureSingleExpandedNpc();
    updateSingleNpcVisibility();
    updateEntityTerms();
    setCreateStatus(t("create.statusNpcDeleted", { entityType: getEntityTerm(getSelectedMode()) }), "success");
  });

  // Set collapsed inline styles before DOM insertion to prevent
  // CSS transition flash when the card first renders.
  if (!options.expandOnMount) {
    const body = card.querySelector(".npc-accordion-body");
    if (body) {
      body.style.height = "0px";
      body.style.opacity = "0";
    }
    card.classList.add("collapsed");
    if (accordionToggle) {
      accordionToggle.setAttribute("aria-expanded", "false");
    }
  }

  els.npcList.appendChild(fragment);
  bindAccordionBody(card);
  populateModelSelect(modelSelect, buildModelOptionValue(prefill.model, prefill.configId || prefill.modelConfigId));

  // ── Agent summary sync ──
  const modelChip = card.querySelector(".npc-agent-model-chip");
  const promptBadge = card.querySelector(".badge-prompt");

  function syncModelChip() {
    if (!modelChip) return;
    const opt = modelSelect.options[modelSelect.selectedIndex];
    modelChip.textContent = opt ? opt.text : "";
  }
  function syncPromptBadge() {
    if (!promptBadge) return;
    const ok = promptInput.value.trim().length > 0;
    promptBadge.textContent = ok ? "Prompt" : "";
    promptBadge.classList.toggle("badge-prompt-on", ok);
    promptBadge.classList.toggle("badge-prompt-off", !ok);
  }

  modelSelect.addEventListener("change", syncModelChip);
  promptInput.addEventListener("input", syncPromptBadge);
  syncModelChip();
  syncPromptBadge();

  if (options.expandOnMount) {
    toggleNpcAccordion(card, { force: true });
  }
}

function refreshModelSelectors() {
  populateModelSelect(els.directorModelSelect, els.directorModelSelect.value);
  [...els.npcList.querySelectorAll(".npc-model")].forEach((select) => {
    populateModelSelect(select, select.value);
  });
}

function syncNpcCardTitle(card, titleNode, rawName = "") {
  if (!titleNode) {
    return;
  }
  const text = String(rawName || "").trim();
  if (text) {
    titleNode.textContent = text;
    titleNode.removeAttribute("data-i18n");
  } else {
    titleNode.textContent = t("npc.unnamed", { entityType: getEntityTerm(getSelectedMode()) });
    titleNode.setAttribute("data-i18n", "npc.unnamed");
  }
  card?.classList.toggle("is-unnamed", !text);
}

function getCreateScrollHost() {
  return document.scrollingElement || document.documentElement;
}

function keepAccordionAnchorStable(targetCard, anchorTop, duration = 380) {
  const scrollHost = getCreateScrollHost();
  const start = performance.now();

  function tick(now) {
    const delta = targetCard.getBoundingClientRect().top - anchorTop;
    if (Math.abs(delta) > 0.5) {
      scrollHost.scrollTop += delta;
    }
    if (now - start < duration) {
      requestAnimationFrame(tick);
    }
  }

  requestAnimationFrame(tick);
}

function setAccordionBodyState(card, expanded) {
  const body = card?.querySelector(".npc-accordion-body");
  if (!body) {
    return;
  }

  if (expanded) {
    body.style.height = "0px";
    body.style.opacity = "0";
    card.classList.add("expanded");
    card.classList.remove("collapsed");

    requestAnimationFrame(() => {
      body.style.height = `${body.scrollHeight}px`;
      body.style.opacity = "1";
    });
    return;
  }

  if (!card.classList.contains("expanded")) {
    card.classList.add("collapsed");
    body.style.height = "0px";
    body.style.opacity = "0";
    return;
  }

  body.style.height = `${body.scrollHeight}px`;
  body.style.opacity = "1";

  requestAnimationFrame(() => {
    card.classList.remove("expanded");
    card.classList.add("collapsed");
    body.style.height = "0px";
    body.style.opacity = "0";
  });
}

function bindAccordionBody(card) {
  const body = card?.querySelector(".npc-accordion-body");
  if (!body || body.dataset.bound === "true") {
    return;
  }

  body.dataset.bound = "true";
  body.addEventListener("transitionend", (event) => {
    if (event.propertyName !== "height") {
      return;
    }
    body.style.height = card.classList.contains("expanded") ? "auto" : "0px";
  });
}

function toggleNpcAccordion(targetCard, options = {}) {
  if (!targetCard) {
    return;
  }
  const anchorTop = targetCard.getBoundingClientRect().top;
  const shouldOpen = options.force === true ? true : !targetCard.classList.contains("expanded");
  [...els.npcList.querySelectorAll(".npc-card")].forEach((card) => {
    const open = card === targetCard ? shouldOpen : false;
    bindAccordionBody(card);
    setAccordionBodyState(card, open);
    const toggle = card.querySelector(".npc-accordion-toggle");
    if (toggle) {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
  });
  keepAccordionAnchorStable(targetCard, anchorTop);
}

function ensureSingleExpandedNpc() {
  const cards = [...els.npcList.querySelectorAll(".npc-card")];
  if (!cards.length) {
    return;
  }
  const expandedCard = cards.find((card) => card.classList.contains("expanded"));
  toggleNpcAccordion(expandedCard || cards[0], { force: true });
}

function collapseAllNpcAccordions() {
  const cards = [...els.npcList.querySelectorAll(".npc-card")];
  cards.forEach((card) => {
    bindAccordionBody(card);
    setAccordionBodyState(card, false);
    const toggle = card.querySelector(".npc-accordion-toggle");
    if (toggle) {
      toggle.setAttribute("aria-expanded", "false");
    }
  });
}

function populateModelSelect(select, preferredValue = "") {
  const models = getAllWorkModels();
  select.innerHTML = "";

  if (!models.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = t("create.workModelsEmpty");
    select.appendChild(option);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = t("create.modelPlaceholder");
  select.appendChild(placeholder);

  models.forEach((model) => {
    const option = document.createElement("option");
    option.value = buildModelOptionValue(model.name, model.configId);
    option.textContent = model.label;
    if (option.value === preferredValue) {
      option.selected = true;
    }
    select.appendChild(option);
  });

  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function getAllWorkModels() {
  return (state.settings.configs || []).flatMap((config) => {
    if (!config?.host || !config?.key) {
      return [];
    }
    return (config.workModels || []).map((name) => ({
      name,
      configId: config.id,
      label: config.name?.trim() ? `${name} · ${config.name.trim()}` : `${name} · ${config.host}`,
    }));
  });
}

function buildModelOptionValue(modelName, configId) {
  return modelName && configId ? `${configId}:::${modelName}` : "";
}

function parseModelOptionValue(value) {
  const raw = String(value || "");
  const splitIndex = raw.indexOf(":::");
  if (splitIndex === -1) {
    return { configId: "", model: raw };
  }
  return {
    configId: raw.slice(0, splitIndex),
    model: raw.slice(splitIndex + 3),
  };
}

function getConfigById(configId) {
  return (state.settings.configs || []).find((config) => config.id === configId) || null;
}

function resolveConfigIdForModel(modelName, preferredConfigId = "") {
  if (preferredConfigId && getConfigById(preferredConfigId)) {
    return preferredConfigId;
  }

  const matchedConfig = (state.settings.configs || []).find((config) =>
    config?.host && config?.key && Array.isArray(config.workModels) && config.workModels.includes(modelName)
  );
  return matchedConfig?.id || "";
}

function collectSessionDraft() {
  const configs = (state.settings.configs || []).filter((config) => config?.host && config?.key);
  if (!configs.length) {
    return { ok: false, message: t("create.errorSetup") };
  }

  const models = getAllWorkModels();
  if (!models.length) {
    return { ok: false, message: t("create.errorWorkModels") };
  }

  const globalPrompt = els.globalPromptInput.value.trim();
  const directorSelection = parseModelOptionValue(els.directorModelSelect.value);
  const npcCards = [...els.npcList.querySelectorAll(".npc-card")];
  const modeRadio = document.querySelector('input[name="sessionMode"]:checked');
  const mode = modeRadio ? modeRadio.value : SESSION_MODE_STORY;

  const minNpcs = mode === SESSION_MODE_WORK ? 1 : 2;
  const isWorkModeSingleNpc = mode === SESSION_MODE_WORK && npcCards.length <= 1;
  const chaosMode = isChaosMode(mode);

  if (!globalPrompt && !isWorkModeSingleNpc && !chaosMode) {
    return { ok: false, message: t("create.errorGlobalPrompt") };
  }

  if (npcCards.length < minNpcs || npcCards.length > 5) {
    return { ok: false, message: t("create.errorNpcCount", { entityType: getEntityTerm(mode), min: String(minNpcs), max: "5" }) };
  }

  if (!isWorkModeSingleNpc && !chaosMode && (!directorSelection.model || !directorSelection.configId)) {
    return { ok: false, message: t("create.errorDirector") };
  }

  const npcs = npcCards.map((card, index) => {
    const prefix = getEntityTerm(mode);
    const name = card.querySelector(".npc-name").value.trim() || `${prefix} ${index + 1}`;
    const modelSelection = parseModelOptionValue(card.querySelector(".npc-model").value);
    const prompt = card.querySelector(".npc-prompt").value.trim();
    return {
      name,
      model: modelSelection.model,
      configId: modelSelection.configId,
      prompt,
    };
  });

  if (npcs.some((npc) => !npc.model || !npc.configId)) {
    return { ok: false, message: t("create.errorNpcModel", { entityType: getEntityTerm(mode) }) };
  }

  return {
    ok: true,
    mode,
    globalPrompt: globalPrompt,
    directorModel: chaosMode ? "" : directorSelection.model,
    directorConfigId: chaosMode ? "" : directorSelection.configId,
    npcs,
    userRole: chaosMode ? "" : els.userRoleInput.value.trim(),
  };
}

function openSessionEditor(sessionId) {
  resetUserMessageEditStateIfNeeded();
  if (typeof closeChatItemMenus === "function") {
    closeChatItemMenus({ render: false });
  } else {
    state.openChatMenuId = null;
    state.deleteConfirmSessionId = null;
  }
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) {
    return;
  }

  state.currentSessionId = session.id;
  persistSessions();

  if (session.configId && state.settings.configs.some((config) => config.id === session.configId)) {
    state.settings.activeConfigId = session.configId;
    persistSettings();
    hydrateSettingsInputs();
    renderSavedConfigs();
    renderModelCache();
    renderWorkModels();
  }

  state.createExitTarget = "chat";
  state.editingSessionId = session.id;
  session.directorConfigId = resolveConfigIdForModel(session.directorModel, session.directorConfigId || session.configId);
  session.npcs = (session.npcs || []).map((npc) => ({
    ...npc,
    configId: resolveConfigIdForModel(npc.model, npc.configId || session.configId),
  }));
  els.globalPromptInput.value = session.globalPrompt || "";
  els.userRoleInput.value = session.userRole || "";
  if (typeof bindUserRoleSelect === "function") bindUserRoleSelect();
  const lockedMode = session.mode || SESSION_MODE_STORY;
  const modeRadio = document.querySelector(`input[name="sessionMode"][value="${lockedMode}"]`);
  if (modeRadio) {
    modeRadio.checked = true;
  }
  refreshModelSelectors();
  populateModelSelect(els.directorModelSelect, buildModelOptionValue(session.directorModel, session.directorConfigId || session.configId));
  els.npcList.innerHTML = "";
  (session.npcs || []).forEach((npc) => addNpcCard(npc));
  ensureMinimumNpcs();
  state.currentSessionEditSection = "details";
  updateCreateViewMode();
  renderSessionOverrideControls();
  updateEntityTerms();
  switchView("create");
  setCreateStatus(t("create.statusEditing"), "");
}

function prepareCreateViewForNewSession(options = {}) {
  resetUserMessageEditStateIfNeeded();
  state.editingSessionId = null;
  state.currentSessionEditSection = "details";
  state.createExitTarget = options.returnTarget === "chat" ? "chat" : "welcome";
  els.globalPromptInput.value = "";
  els.userRoleInput.value = "";
  if (els.userRoleSelect) els.userRoleSelect.value = "";
  if (typeof bindUserRoleSelect === "function") bindUserRoleSelect();
  populateModelSelect(els.directorModelSelect, "");
  els.npcList.innerHTML = "";
  ensureMinimumNpcs();
  refreshModelSelectors();
  updateCreateViewMode();
  renderSessionOverrideControls();
  updateEntityTerms();
  setCreateStatus(getNpcCountHint(), "");
}

function setSessionModeEditable(editable) {
  document.querySelectorAll('input[name="sessionMode"]').forEach((input) => {
    input.disabled = !editable;
  });
}

function syncSessionModePresentation(isEditing, sessionMode) {
  const selector = document.getElementById("sessionModeSelector");
  const hint = document.getElementById("sessionModeHint");
  if (!selector) {
    return;
  }

  selector.classList.toggle("mode-locked", isEditing);
  selector.querySelectorAll("[data-mode-option]").forEach((option) => {
    const shouldHide = isEditing && option.dataset.modeOption !== sessionMode;
    option.classList.toggle("mode-hidden", shouldHide);
  });

  if (hint) {
    hint.textContent = isEditing ? t("create.modeLockedHint") : t("create.modeHint");
  }

  ensureModeMinNpcs();
  updateSingleNpcVisibility();
  updateEntityTerms();
}

function updateCreateViewMode() {
  const isEditing = Boolean(state.editingSessionId);
  const activeSection = isEditing ? getCurrentCreateEditSection() : "details";
  els.views.create?.classList.toggle("create-view-editing", isEditing);
  if (els.createViewTitle) {
    els.createViewTitle.textContent = isEditing ? t("create.editTitle") : t("create.title");
  }
  let sessionMode = SESSION_MODE_STORY;
  if (isEditing) {
    const session = state.sessions.find((item) => item.id === state.editingSessionId);
    if (session && session.mode) {
      sessionMode = session.mode;
    }
  } else {
    sessionMode = getSelectedMode();
  }
  const term = getEntityTerm(sessionMode);
  if (els.createViewSubtitle) {
    els.createViewSubtitle.textContent = isEditing
      ? (activeSection === "overrides"
        ? t("create.overridesSubtitle")
        : activeSection === "advanced"
          ? t("create.advancedSubtitle")
          : t("create.editSubtitle", { entityType: term }))
      : t("create.newSubtitle", { entityType: term });
  }
  els.createChatBtn.textContent = isEditing ? t("create.saveBtn") : t("create.submit");

  setSessionModeEditable(!isEditing);
  if (!isEditing) {
    sessionMode = getSelectedMode();
  }
  const modeRadio = document.querySelector(`input[name="sessionMode"][value="${sessionMode}"]`);
  if (modeRadio) {
    modeRadio.checked = true;
  }
  syncSessionModePresentation(isEditing, sessionMode);
  syncCreateEditNavigation();
}

async function saveSessionEdits(payload, activeConfig) {
  const session = state.sessions.find((item) => item.id === state.editingSessionId);
  if (!session) {
    state.editingSessionId = null;
    updateCreateViewMode();
    setCreateStatus(t("create.statusNotFound"), "error");
    return;
  }

  const isSingleNpc = payload.mode === SESSION_MODE_WORK && payload.npcs.length <= 1;
  const chaosMode = isChaosMode(payload.mode);

  if (!isSingleNpc && !chaosMode) {
    const directorConfig = getConfigById(payload.directorConfigId);
    if (!directorConfig?.host || !directorConfig?.key) {
      setCreateStatus(t("create.statusDirectorUnavailable"), "error");
      return;
    }
    session.directorModel = payload.directorModel;
    session.directorConfigId = payload.directorConfigId;
    session.configId = payload.directorConfigId;
    session.host = directorConfig.host;
    session.key = directorConfig.key;
  } else {
    session.directorModel = "";
    session.directorConfigId = "";
    if (chaosMode) {
      const primaryNpcConfig = getConfigById(payload.npcs[0]?.configId || "");
      session.configId = primaryNpcConfig?.id || activeConfig?.id || session.configId || "";
      session.host = primaryNpcConfig?.host || activeConfig?.host || session.host || "";
      session.key = primaryNpcConfig?.key || activeConfig?.key || session.key || "";
    }
  }

  session.globalPrompt = payload.globalPrompt;
  session.userRole = payload.userRole || "";
  session.npcs = payload.npcs.map((npc) => ({ ...npc }));
  session.transientNpcs = (session.transientNpcs || []).filter((npc) => !session.npcs.some((baseNpc) => baseNpc.name === npc.name));
  // Clean up orphaned agentParams keys (NPCs renamed or removed)
  if (session.agentParams) {
    var validKeys = new Set(["director"]);
    (session.npcs || []).forEach(function (npc) { validKeys.add(npc.name); });
    var cleaned = {};
    Object.keys(session.agentParams).forEach(function (k) {
      if (validKeys.has(k)) cleaned[k] = session.agentParams[k];
    });
    session.agentParams = cleaned;
  }
  session.directorMemory = normalizeDirectorMemory(null);
  session.directorSummary = "";
  session.chatSummary = "";
  session.compressedUntilMessageId = "";
  session.suggestionGuide = "";
  session.latestTurnBaseState = null;
  session.latestTurnVariants = null;
  session.chaosState = null;
  touchSession(session);
  persistSessions();
  state.currentSessionId = session.id;
  state.showWelcomeHome = false;
  state.editingSessionId = null;
  updateCreateViewMode();
  try {
    await ensureChatFeatureForCreateTransition();
  } catch (error) {
    debugWarn("[chat-feature] edit transition failed", error);
    setCreateStatus("聊天模块加载失败，请刷新后重试", "error");
    return;
  }
  persistSessions();
  renderSession();
  switchView("chat");
  setCreateStatus(t("create.statusSaved"), "success");
  setText(els.chatStatus, state.isSending ? t("create.statusProcessing") : t("chat.readyAfterCreate"));
}
