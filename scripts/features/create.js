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

function bindCreateFlow() {
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

  els.createChatBtn.addEventListener("click", () => {
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
      saveSessionEdits(payload, activeConfig);
      return;
    }

    const isSingleNpc = payload.mode === SESSION_MODE_WORK && payload.npcs.length <= 1;
    const directorConfig = isSingleNpc ? null : getConfigById(payload.directorConfigId);
    if (!isSingleNpc && (!directorConfig?.host || !directorConfig?.key)) {
      setCreateStatus(t("create.statusDirectorUnavailable"), "error");
      return;
    }

    const npcConfig = isSingleNpc ? getConfigById(payload.npcs[0].configId) : null;
    const session = {
      id: `session-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      configId: isSingleNpc ? (npcConfig?.id || "") : (directorConfig?.id || ""),
      host: isSingleNpc ? (npcConfig?.host || "") : (directorConfig?.host || ""),
      key: isSingleNpc ? (npcConfig?.key || "") : (directorConfig?.key || ""),
      title: t("chat.generatingTitle"),
      titleSource: "auto",
      globalPrompt: payload.globalPrompt,
      mode: payload.mode,
      directorModel: payload.directorModel || "",
      directorConfigId: payload.directorConfigId || "",
      npcs: payload.npcs,
      transientNpcs: [],
      directorMemory: normalizeDirectorMemory(null),
      directorSummary: "",
      chatSummary: "",
      compressedUntilMessageId: "",
      suggestionGuide: "",
      messages: [
        {
          role: "system",
          speaker: t("chat.systemSpeaker"),
          uiType: "system-notice",
          content: `${t("chat.systemNoticeCreated")}\n\n${t("chat.globalPromptLabel")}：\n${payload.globalPrompt}`,
          createdAt: new Date().toISOString(),
        },
      ],
    };

    upsertSession(session);
    state.showWelcomeHome = false;
    state.currentSessionId = session.id;
    persistSessions();
    renderSession();
    switchView("chat");
    setCreateStatus(t("create.statusCreated"), "success");
    setText(els.chatStatus, t("chat.readyAfterCreate"));
    void generateSessionTitle(session);
    void generateSuggestionGuide(session);
  });
}

function getSelectedMode() {
  const radio = document.querySelector('input[name="sessionMode"]:checked');
  return radio ? radio.value : SESSION_MODE_STORY;
}

function getModeMinNpcs() {
  return getSelectedMode() === SESSION_MODE_WORK ? 1 : 2;
}

function updateSingleNpcVisibility() {
  const directorField = document.getElementById("directorField");
  const noDirectorHint = document.getElementById("noDirectorHint");
  const globalPromptField = document.getElementById("globalPromptField");
  const noGlobalPromptHint = document.getElementById("noGlobalPromptHint");
  if (!directorField) return;
  const isWorkModeSingleNpc = getSelectedMode() === SESSION_MODE_WORK && els.npcList.children.length <= 1;
  directorField.hidden = isWorkModeSingleNpc;
  if (noDirectorHint) {
    noDirectorHint.hidden = !isWorkModeSingleNpc;
  }
  if (globalPromptField) {
    globalPromptField.hidden = isWorkModeSingleNpc;
  }
  if (noGlobalPromptHint) {
    noGlobalPromptHint.hidden = !isWorkModeSingleNpc;
  }
}

function ensureMinimumNpcs() {
  const min = getModeMinNpcs();
  while (els.npcList.children.length < min) {
    addNpcCard();
  }
  refreshModelSelectors();
  ensureSingleExpandedNpc();
  updateSingleNpcVisibility();
  updateEntityTerms();
}

function ensureModeMinNpcs() {
  const min = getModeMinNpcs();
  while (els.npcList.children.length < min) {
    addNpcCard();
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
  ensureSingleExpandedNpc();
  updateSingleNpcVisibility();
  updateEntityTerms();
}

function addNpcCard(prefill = {}) {
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
  bindAccordionBody(card);

  nameInput.addEventListener("input", () => {
    syncNpcCardTitle(card, accordionName, nameInput.value);
  });

  if (accordionToggle) {
    accordionToggle.addEventListener("click", () => {
      toggleNpcAccordion(card);
    });
  }

  removeBtn.addEventListener("click", () => {
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

  els.npcList.appendChild(fragment);
  populateModelSelect(modelSelect, buildModelOptionValue(prefill.model, prefill.configId || prefill.modelConfigId));
  toggleNpcAccordion(els.npcList.lastElementChild, { force: true });
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

function populateModelSelect(select, preferredValue = "") {
  const models = getAllWorkModels();
  select.innerHTML = "";

  if (!models.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = t("create.workModelsEmpty");
    select.appendChild(option);
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

  if (!globalPrompt && !isWorkModeSingleNpc) {
    return { ok: false, message: t("create.errorGlobalPrompt") };
  }

  if (npcCards.length < minNpcs || npcCards.length > 5) {
    return { ok: false, message: t("create.errorNpcCount", { entityType: getEntityTerm(mode), min: String(minNpcs), max: "5" }) };
  }

  if (!isWorkModeSingleNpc && (!directorSelection.model || !directorSelection.configId)) {
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
    globalPrompt,
    directorModel: directorSelection.model,
    directorConfigId: directorSelection.configId,
    npcs,
  };
}

function openSessionEditor(sessionId) {
  clearUserMessageEdit();
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

  state.editingSessionId = session.id;
  session.directorConfigId = resolveConfigIdForModel(session.directorModel, session.directorConfigId || session.configId);
  session.npcs = (session.npcs || []).map((npc) => ({
    ...npc,
    configId: resolveConfigIdForModel(npc.model, npc.configId || session.configId),
  }));
  els.globalPromptInput.value = session.globalPrompt || "";
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
  updateCreateViewMode();
  updateEntityTerms();
  switchView("create");
  setCreateStatus(t("create.statusEditing"), "");
}

function prepareCreateViewForNewSession() {
  clearUserMessageEdit();
  state.editingSessionId = null;
  els.globalPromptInput.value = "";
  populateModelSelect(els.directorModelSelect, "");
  els.npcList.innerHTML = "";
  ensureMinimumNpcs();
  refreshModelSelectors();
  updateCreateViewMode();
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
      ? t("create.editSubtitle", { entityType: term })
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
}

function saveSessionEdits(payload, activeConfig) {
  const session = state.sessions.find((item) => item.id === state.editingSessionId);
  if (!session) {
    state.editingSessionId = null;
    updateCreateViewMode();
    setCreateStatus(t("create.statusNotFound"), "error");
    return;
  }

  const isSingleNpc = payload.mode === SESSION_MODE_WORK && payload.npcs.length <= 1;

  if (!isSingleNpc) {
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
  }

  session.globalPrompt = payload.globalPrompt;
  session.npcs = payload.npcs.map((npc) => ({ ...npc }));
  session.transientNpcs = (session.transientNpcs || []).filter((npc) => !session.npcs.some((baseNpc) => baseNpc.name === npc.name));
  session.directorMemory = normalizeDirectorMemory(null);
  session.directorSummary = "";
  session.chatSummary = "";
  session.compressedUntilMessageId = "";
  session.suggestionGuide = "";
  touchSession(session);
  persistSessions();
  state.currentSessionId = session.id;
  state.showWelcomeHome = false;
  state.editingSessionId = null;
  updateCreateViewMode();
  renderSession();
  switchView("chat");
  setCreateStatus(t("create.statusSaved"), "success");
  setText(els.chatStatus, state.isSending ? t("create.statusProcessing") : t("chat.readyAfterCreate"));
  if (session.titleSource !== "manual") {
    void generateSessionTitle(session);
  }
}
