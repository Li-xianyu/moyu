function bindCreateFlow() {
  els.addNpcBtn.addEventListener("click", () => {
    if (els.npcList.children.length >= 5) {
      setText(els.createStatus, t("create.statusMaxNpc"));
      return;
    }
    addNpcCard();
    setText(els.createStatus, t("create.statusNpcAdded"));
  });

  els.createChatBtn.addEventListener("click", () => {
    const payload = collectSessionDraft();
    if (!payload.ok) {
      setText(els.createStatus, payload.message);
      return;
    }

    const activeConfig = getActiveConfig();
    if (!activeConfig) {
      setText(els.createStatus, t("create.errorSelectConfig"));
      return;
    }

    if (state.editingSessionId) {
      saveSessionEdits(payload, activeConfig);
      return;
    }

    const directorConfig = getConfigById(payload.directorConfigId);
    if (!directorConfig?.host || !directorConfig?.key) {
      setText(els.createStatus, t("create.statusDirectorUnavailable"));
      return;
    }

    const session = {
      id: `session-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      configId: directorConfig.id,
      host: directorConfig.host,
      key: directorConfig.key,
      title: t("chat.generatingTitle"),
      titleSource: "auto",
      globalPrompt: payload.globalPrompt,
      mode: payload.mode,
      directorModel: payload.directorModel,
      directorConfigId: payload.directorConfigId,
      npcs: payload.npcs,
      transientNpcs: [],
      directorMemory: normalizeDirectorMemory(null),
      directorSummary: "",
      compressedUntilMessageId: "",
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
    setText(els.createStatus, t("create.statusCreated"));
    setText(els.chatStatus, t("chat.readyAfterCreate"));
    void generateSessionTitle(session);
  });
}

function ensureMinimumNpcs() {
  while (els.npcList.children.length < 2) {
    addNpcCard();
  }
  refreshModelSelectors();
  ensureSingleExpandedNpc();
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
    if (els.npcList.children.length <= 2) {
      setText(els.createStatus, t("create.statusMinNpc"));
      return;
    }
    card.remove();
    ensureSingleExpandedNpc();
    setText(els.createStatus, t("create.statusNpcDeleted"));
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
  titleNode.textContent = text || t("npc.unnamed");
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

  if (!globalPrompt) {
    return { ok: false, message: t("create.errorGlobalPrompt") };
  }

  if (!directorSelection.model || !directorSelection.configId) {
    return { ok: false, message: t("create.errorDirector") };
  }

  if (npcCards.length < 2 || npcCards.length > 5) {
    return { ok: false, message: t("create.errorNpcCount") };
  }

  const npcs = npcCards.map((card, index) => {
    const name = card.querySelector(".npc-name").value.trim() || `NPC ${index + 1}`;
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
    return { ok: false, message: t("create.errorNpcModel") };
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
  switchView("create");
  setText(els.createStatus, t("create.statusEditing"));
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
  setText(els.createStatus, t("create.statusNpcCount"));
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
}

function updateCreateViewMode() {
  const isEditing = Boolean(state.editingSessionId);
  if (els.createViewTitle) {
    els.createViewTitle.textContent = isEditing ? t("create.editTitle") : t("create.title");
  }
  if (els.createViewSubtitle) {
    els.createViewSubtitle.textContent = isEditing
      ? t("create.editSubtitle")
      : t("create.newSubtitle");
  }
  els.createChatBtn.textContent = isEditing ? t("create.saveBtn") : t("create.submit");

  setSessionModeEditable(!isEditing);
  let sessionMode = SESSION_MODE_STORY;
  if (isEditing) {
    const session = state.sessions.find((item) => item.id === state.editingSessionId);
    if (session && session.mode) {
      sessionMode = session.mode;
    }
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
    setText(els.createStatus, t("create.statusNotFound"));
    return;
  }

  const directorConfig = getConfigById(payload.directorConfigId);
  if (!directorConfig?.host || !directorConfig?.key) {
    setText(els.createStatus, t("create.statusDirectorUnavailable"));
    return;
  }

  session.configId = payload.directorConfigId;
  session.host = directorConfig.host;
  session.key = directorConfig.key;
  session.globalPrompt = payload.globalPrompt;
  session.directorModel = payload.directorModel;
  session.directorConfigId = payload.directorConfigId;
  session.npcs = payload.npcs.map((npc) => ({ ...npc }));
  session.transientNpcs = (session.transientNpcs || []).filter((npc) => !session.npcs.some((baseNpc) => baseNpc.name === npc.name));
  session.directorMemory = normalizeDirectorMemory(null);
  session.directorSummary = "";
  session.compressedUntilMessageId = "";
  touchSession(session);
  persistSessions();
  state.currentSessionId = session.id;
  state.showWelcomeHome = false;
  state.editingSessionId = null;
  updateCreateViewMode();
  renderSession();
  switchView("chat");
  setText(els.createStatus, t("create.statusSaved"));
  setText(els.chatStatus, state.isSending ? t("create.statusProcessing") : t("chat.readyAfterCreate"));
  if (session.titleSource !== "manual") {
    void generateSessionTitle(session);
  }
}
