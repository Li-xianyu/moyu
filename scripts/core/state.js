const state = {
  locale: loadJson(STORAGE_KEYS.locale, "zh-CN"),
  settings: normalizeSettings(loadJson(STORAGE_KEYS.settings, { host: "", key: "", configs: [] })),
  modelCache: loadJson(STORAGE_KEYS.modelCache, {}),
  sessions: [],
  currentSessionId: loadJson(STORAGE_KEYS.currentSessionId, null),
  sidebarCollapsed: loadJson(STORAGE_KEYS.sidebarCollapsed, null),
  mobileSidebarOpen: false,
  currentSettingsSection: "global",
  showWelcomeHome: false,
  isSending: false,
  chatInlineStatus: "",
  editingSessionId: null,
  editingUserMessageId: null,
  openUserMessageToolsId: null,
  openAgentTokenInfoId: null,
  openAgentToolTraceId: null,
  openCompressMemoryInfo: false,
  directorThinking: false,
  openChatMenuId: null,
  renameSessionId: null,
  deleteConfirmSessionId: null,
  deleteConfirmConfigId: null,
  chatSearchQuery: "",
  userScrolledAway: false,
  userTopAnchorActive: false,
  userTopAnchorAutoFollow: false,
  abortController: null,
};

const els = {
  appShell: document.querySelector(".app-shell"),
  sidebar: document.querySelector(".sidebar"),
  navButtons: [...document.querySelectorAll(".nav-btn")],
  views: {
    settings: document.getElementById("settingsView"),
    create: document.getElementById("createView"),
    chat: document.getElementById("chatView"),
  },
  globalSettingsTabBtn: document.getElementById("globalSettingsTabBtn"),
  assistantSettingsTabBtn: document.getElementById("assistantSettingsTabBtn"),
  apiSettingsTabBtn: document.getElementById("apiSettingsTabBtn"),
  sessionSettingsTabBtn: document.getElementById("sessionSettingsTabBtn"),
  globalSettingsPanel: document.getElementById("globalSettingsPanel"),
  assistantSettingsPanel: document.getElementById("assistantSettingsPanel"),
  apiSettingsPanel: document.getElementById("apiSettingsPanel"),
  sessionSettingsPanel: document.getElementById("sessionSettingsPanel"),
  settingsPanelTitle: document.getElementById("settingsPanelTitle"),
  settingsPanelSubtitle: document.getElementById("settingsPanelSubtitle"),
  localeSelect: document.getElementById("localeSelect"),
  initialPageSelect: document.getElementById("initialPageSelect"),
  assistantModelSelect: document.getElementById("assistantModelSelect"),
  debugModeToggle: document.getElementById("debugModeToggle"),
  mobileConsoleToggle: document.getElementById("mobileConsoleToggle"),
  compressThresholdInput: document.getElementById("compressThresholdInput"),
  showTokenDisplayToggle: document.getElementById("showTokenDisplayToggle"),
  exportSessionsBtn: document.getElementById("exportSessionsBtn"),
  importSessionsBtn: document.getElementById("importSessionsBtn"),
  importSessionsInput: document.getElementById("importSessionsInput"),
  apiHostInput: document.getElementById("apiHostInput"),
  apiKeyInput: document.getElementById("apiKeyInput"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  fetchModelsBtn: document.getElementById("fetchModelsBtn"),
  clearCacheBtn: document.getElementById("clearCacheBtn"),
  settingsStatus: document.getElementById("settingsStatus"),
  modelCacheInfo: document.getElementById("modelCacheInfo"),
  modelList: document.getElementById("modelList"),
  modelSearchInput: document.getElementById("modelSearchInput"),
  savedConfigs: document.getElementById("savedConfigs"),
  addConfigBtn: document.getElementById("addConfigBtn"),
  configNameInput: document.getElementById("configNameInput"),
  globalPromptInput: document.getElementById("globalPromptInput"),
  directorModelSelect: document.getElementById("directorModelSelect"),
  addNpcBtn: document.getElementById("addNpcBtn"),
  npcList: document.getElementById("npcList"),
  createChatBtn: document.getElementById("createChatBtn"),
  createStatus: document.getElementById("createStatus"),
  chatStage: document.getElementById("chatStage"),
  chatWelcome: document.getElementById("chatWelcome"),
  chatMeta: document.getElementById("chatMeta"),
  chatMessages: document.getElementById("chatMessages"),
  chatInput: document.getElementById("chatInput"),
  suggestBtn: document.getElementById("suggestBtn"),
  suggestionBar: document.getElementById("suggestionBar"),
  compressMemoryBtn: document.getElementById("compressMemoryBtn"),
  directorThinkingBtn: document.getElementById("directorThinkingBtn"),
  modelThinkingBtn: document.getElementById("modelThinkingBtn"),
  thinkingToggleBtn: document.getElementById("thinkingToggleBtn"),
  thinkingPopover: document.getElementById("thinkingPopover"),
  mobileNewlineBtn: document.getElementById("mobileNewlineBtn"),
  sendBtn: document.getElementById("sendBtn"),
  chatStatus: document.getElementById("chatStatus"),
  createViewTitle: document.querySelector("#createView .panel-head h2"),
  createViewSubtitle: document.querySelector("#createView .panel-head p"),
  npcTemplate: document.getElementById("npcTemplate"),
  composerFooter: document.querySelector(".composer-footer"),
  infoToggleBtn: document.getElementById("infoToggleBtn"),
  chatInfoPopover: document.getElementById("chatInfoPopover"),
  chatListToggleBtn: document.getElementById("chatListToggleBtn"),
  chatListMenu: document.getElementById("chatListMenu"),
  chatListItems: document.getElementById("chatListItems"),
  chatListArrowIcon: document.getElementById("chatListArrowIcon"),
  sidebarToggleBtn: document.getElementById("sidebarToggleBtn"),
  sidebarBackdrop: document.getElementById("sidebarBackdrop"),
  openCurrentChatBtn: document.getElementById("openCurrentChatBtn"),
  chatListEmpty: document.getElementById("chatListEmpty"),
  chatSearchBtn: document.getElementById("chatSearchBtn"),
  chatSearchInput: document.getElementById("chatSearchInput"),
  chatExportBtn: document.getElementById("chatExportBtn"),
  chatImportBtn: document.getElementById("chatImportBtn"),
  chatImportInput: document.getElementById("chatImportInput"),
  workModelList: document.getElementById("workModelList"),
  workModelHint: document.getElementById("workModelHint"),
  clearWorkModelsBtn: document.getElementById("clearWorkModelsBtn"),
  settingsResizableLayout: document.getElementById("settingsResizableLayout"),
  settingsResizeHandle: document.getElementById("settingsResizeHandle"),
  editSessionBtn: null,
  cancelEditBtn: null,
  dropOverlay: document.getElementById("dropOverlay"),
  dropOverlayText: document.getElementById("dropOverlayText"),
  exportBackupBtn: document.getElementById("exportBackupBtn"),
  importBackupBtn: document.getElementById("importBackupBtn"),
  importBackupInput: document.getElementById("importBackupInput"),
};

function normalizeDirectorMemory(memory) {
  const source = memory && typeof memory === "object" ? memory : {};
  const normalizeList = (value) => Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 10)
    : [];

  return {
    scene: typeof source.scene === "string" ? source.scene.trim() : "",
    relationships: normalizeList(source.relationships),
    facts: normalizeList(source.facts),
    tensions: normalizeList(source.tensions),
    openLoops: normalizeList(source.openLoops),
    npcState: normalizeList(source.npcState),
    synopsis: typeof source.synopsis === "string" ? source.synopsis.trim() : "",
  };
}

function resolveDirectorMemory(memory, fallbackSummary = "") {
  const normalized = normalizeDirectorMemory(memory);
  if (normalized.scene || normalized.relationships.length || normalized.facts.length || normalized.tensions.length || normalized.openLoops.length || normalized.npcState.length || normalized.synopsis) {
    return normalized;
  }
  return normalizeDirectorMemory({
    synopsis: typeof fallbackSummary === "string" ? fallbackSummary.trim() : "",
  });
}

function getCurrentSession() {
  return state.sessions.find((session) => session.id === state.currentSessionId) || null;
}

function getActiveConfig() {
  return state.settings.configs.find((config) => config.id === state.settings.activeConfigId) || null;
}

function getSceneNpcs(session) {
  return [...(session?.npcs || []), ...(session?.transientNpcs || [])];
}

function createMessageId(prefix = "msg") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function ensureSessionMessageIds(session) {
  if (!Array.isArray(session?.messages)) {
    return session;
  }

  session.messages = session.messages.map((message) => ({
    ...message,
    id: message.id || createMessageId(message.role || "msg"),
  }));
  return session;
}

function migrateLegacySessions() {
  if (!Array.isArray(state.sessions)) {
    state.sessions = [];
  }

  state.sessions = state.sessions.map((session) => ({
    ...session,
    mode: session.mode || SESSION_MODE_STORY,
    title: session.title || buildFallbackTitle(session),
    titleSource: session.titleSource || "auto",
    transientNpcs: Array.isArray(session.transientNpcs) ? session.transientNpcs : [],
    directorMemory: resolveDirectorMemory(session.directorMemory, session.directorSummary),
    directorSummary: typeof session.directorSummary === "string" ? session.directorSummary : "",
    compressedUntilMessageId: session.compressedUntilMessageId || "",
    suggestionGuide: session.suggestionGuide || "",
  })).map((session) => ensureSessionMessageIds(session));

  if (!state.currentSessionId && state.sessions.length) {
    state.currentSessionId = state.sessions[0].id;
  }
}

function t(key, params = {}) {
  let text = i18n[state.locale]?.[key] || key;
  if (params && typeof params === "object") {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\$\\{${k}\\}`, "g"), v);
    }
  }
  return text;
}

function applyI18n() {
  const mode = typeof getSelectedMode === "function" ? getSelectedMode() : SESSION_MODE_STORY;
  const entityType = mode === SESSION_MODE_WORK ? "AI" : "NPC";
  const defaultParams = { entityType };

  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n, defaultParams);
    if (node.id === "chatStatus" && typeof getChatStatusTone === "function") {
      node.dataset.tone = getChatStatusTone(node.textContent);
    }
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  });

  document.documentElement.lang = state.locale || "zh-CN";
  document.title = t("app.title");
  localStorage.setItem(STORAGE_KEYS.locale, JSON.stringify(state.locale));
}
