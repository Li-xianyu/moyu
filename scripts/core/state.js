"use strict";

// ===== 域拆分辅助：创建带 getter/setter 的实时别名对象 =====
function createLiveAlias(target, props) {
  var obj = {};
  props.forEach(function (key) {
    Object.defineProperty(obj, key, {
      get: function () { return target[key]; },
      set: function (v) { target[key] = v; },
      enumerable: true
    });
  });
  return obj;
}

// ===== 全局状态 =====
const state = {
  // ======== 持久化配置 ========
  locale: loadJson(STORAGE_KEYS.locale, "zh-CN"),
  settings: normalizeSettings(loadJson(STORAGE_KEYS.settings, { host: "", key: "", configs: [] })),
  modelCache: loadJson(STORAGE_KEYS.modelCache, {}),
  theme: loadJson(STORAGE_KEYS.theme, "dark"),
  userRoles: loadJson(STORAGE_KEYS.userRoles, []),

  // ======== 会话数据 ========
  sessions: [],
  currentSessionId: loadJson(STORAGE_KEYS.currentSessionId, null),
  chatRenderWindows: {},
  chatRenderActiveSessionId: null,
  chatHistoryLoadPending: false,

  // ======== UI 状态 ========
  sidebarCollapsed: loadJson(STORAGE_KEYS.sidebarCollapsed, null),
  mobileSidebarOpen: false,
  currentSettingsSection: "global",
  showWelcomeHome: false,
  createExitTarget: "welcome",
  suggestHintTimer: null,
  userScrolledAway: false,
  userTopAnchorActive: false,
  userTopAnchorAutoFollow: false,

  // ======== 聊天交互状态 ========
  isSending: false,
  chatInlineStatus: "",
  editingSessionId: null,
  currentSessionEditSection: "details",
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
  abortController: null,
};

// ===== 命名空间快捷入口（新代码推荐使用，不破坏旧代码） =====
state.config = createLiveAlias(state, [
  "locale", "settings", "modelCache", "theme", "userRoles"
]);
state.ui = createLiveAlias(state, [
  "sidebarCollapsed", "mobileSidebarOpen", "currentSettingsSection",
  "showWelcomeHome", "createExitTarget", "suggestHintTimer",
  "userScrolledAway", "userTopAnchorActive", "userTopAnchorAutoFollow"
]);
state.chat = createLiveAlias(state, [
  "isSending", "chatInlineStatus", "editingSessionId", "currentSessionEditSection",
  "editingUserMessageId", "openUserMessageToolsId", "openAgentTokenInfoId",
  "openAgentToolTraceId", "openCompressMemoryInfo", "directorThinking",
  "openChatMenuId", "renameSessionId", "deleteConfirmSessionId",
  "deleteConfirmConfigId", "chatSearchQuery", "abortController",
  "chatHistoryLoadPending"
]);
state.session = createLiveAlias(state, [
  "sessions", "currentSessionId", "chatRenderWindows", "chatRenderActiveSessionId"
]);

const els = {
  appShell: document.querySelector(".app-shell"),
  sidebar: document.querySelector(".sidebar"),
  navButtons: [...document.querySelectorAll(".nav-btn")],
  views: {
    settings: document.getElementById("settingsView"),
    create: document.getElementById("createView"),
    chat: document.getElementById("chatView"),
    roles: document.getElementById("rolesView"),
  },
  globalSettingsTabBtn: document.getElementById("globalSettingsTabBtn"),
  assistantSettingsTabBtn: document.getElementById("assistantSettingsTabBtn"),
  apiSettingsTabBtn: document.getElementById("apiSettingsTabBtn"),
  sessionSettingsTabBtn: document.getElementById("sessionSettingsTabBtn"),
  globalSettingsPanel: document.getElementById("globalSettingsPanel"),
  assistantSettingsPanel: document.getElementById("assistantSettingsPanel"),
  apiSettingsPanel: document.getElementById("apiSettingsPanel"),
  sessionSettingsPanel: document.getElementById("sessionSettingsPanel"),
  localeSelect: document.getElementById("localeSelect"),
  themeSelect: document.getElementById("themeSelect"),
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
  sessionEditTopbar: document.getElementById("sessionEditTopbar"),
  sessionEditExitBtn: document.getElementById("sessionEditExitBtn"),
  sessionEditExitLabel: document.getElementById("sessionEditExitLabel"),
  sessionEditTabs: document.getElementById("sessionEditTabs"),
  sessionEditInfoTabBtn: document.getElementById("sessionEditInfoTabBtn"),
  sessionEditOverridesTabBtn: document.getElementById("sessionEditOverridesTabBtn"),
  sessionEditSidebar: document.getElementById("sessionEditSidebar"),
  sessionEditInfoNavBtn: document.getElementById("sessionEditInfoNavBtn"),
  sessionEditOverridesNavBtn: document.getElementById("sessionEditOverridesNavBtn"),
  sessionEditInfoPanel: document.getElementById("sessionEditInfoPanel"),
  sessionEditOverridesPanel: document.getElementById("sessionEditOverridesPanel"),
  sessionEditAdvancedTabBtn: document.getElementById("sessionEditAdvancedTabBtn"),
  sessionEditAdvancedNavBtn: document.getElementById("sessionEditAdvancedNavBtn"),
  sessionEditAdvancedPanel: document.getElementById("sessionEditAdvancedPanel"),
  sessionAdvancedAgentList: document.getElementById("sessionAdvancedAgentList"),
  sessionEditFooter: document.querySelector("#createView .session-edit-footer"),
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
  thinkingDepthWrap: document.getElementById("thinkingDepthWrap"),
  thinkingDepthBtn: document.getElementById("thinkingDepthBtn"),
  thinkingDepthDropdown: document.getElementById("thinkingDepthDropdown"),
  attachImageBtn: document.getElementById("attachImageBtn"),
  imageFileInput: document.getElementById("imageFileInput"),
  attachmentPreview: document.getElementById("attachmentPreview"),
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
  sidebarCollapseBtn: document.getElementById("sidebarCollapseBtn"),
  sidebarBackdrop: document.getElementById("sidebarBackdrop"),
  settingsBackBtn: document.getElementById("settingsBackBtn"),
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
  clearAllDataBtn: document.getElementById("clearAllDataBtn"),
  // User role library
  rolesView: document.getElementById("rolesView"),
  addRoleBtn: document.getElementById("addRoleBtn"),
  roleList: document.getElementById("roleList"),
  roleEditPanel: document.getElementById("roleEditPanel"),
  roleEditNameInput: document.getElementById("roleEditNameInput"),
  roleEditDescInput: document.getElementById("roleEditDescInput"),
  roleSaveBtn: document.getElementById("roleSaveBtn"),
  roleCancelBtn: document.getElementById("roleCancelBtn"),
  roleEditEmptyState: document.getElementById("roleEditEmptyState"),
  // User role in create/edit session
  userRoleInput: document.getElementById("userRoleInput"),
  userRoleSelect: document.getElementById("userRoleSelect"),
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
    npcNameAliases: session.npcNameAliases && typeof session.npcNameAliases === "object"
      ? session.npcNameAliases
      : {},
    transientNpcs: Array.isArray(session.transientNpcs) ? session.transientNpcs : [],
    directorMemory: resolveDirectorMemory(session.directorMemory, session.directorSummary),
    directorSummary: typeof session.directorSummary === "string" ? session.directorSummary : "",
    compressedUntilMessageId: session.compressedUntilMessageId || "",
    suggestionGuide: session.suggestionGuide || "",
    latestTurnBaseState: session.latestTurnBaseState &&
      session.latestTurnBaseState.userMessageId
        ? session.latestTurnBaseState
        : null,
    latestTurnVariants: session.latestTurnVariants &&
      Array.isArray(session.latestTurnVariants.variants)
        ? session.latestTurnVariants
        : null,
    userRole: session.userRole || "",
    messageCount: Number.isFinite(session.messageCount)
      ? session.messageCount
      : Array.isArray(session.messages)
        ? session.messages.filter((message) => message.role !== "system").length
        : 0,
    agentParams: session.agentParams || {},
    messagesHydrated: Array.isArray(session.messages) && session.messages.length
      ? session.messagesHydrated !== false
      : Boolean(session.messagesHydrated),
    loadedStartSequence: Number.isFinite(session.loadedStartSequence) ? session.loadedStartSequence : 0,
  })).map((session) => ensureSessionMessageIds(session));

  if (!state.currentSessionId && state.sessions.length) {
    state.currentSessionId = state.sessions[0].id;
  }
}

function persistUserRoles() {
  localStorage.setItem(STORAGE_KEYS.userRoles, JSON.stringify(state.userRoles));
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
    /* skip typewriter loading text — managed by its own animation */
    if (node.closest("#loadingScreen")) return;
    node.textContent = t(node.dataset.i18n, defaultParams);
    if (node.id === "chatStatus" && typeof getChatStatusTone === "function") {
      node.dataset.tone = getChatStatusTone(node.textContent);
    }
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  });

  document.querySelectorAll("[data-i18n-aria-label]").forEach((node) => {
    node.setAttribute("aria-label", t(node.dataset.i18nAriaLabel));
  });

  document.querySelectorAll("[data-i18n-title]").forEach((node) => {
    node.title = t(node.dataset.i18nTitle);
  });

  const localeSelect = document.getElementById("localeSelect");
  if (localeSelect) {
    localeSelect.value = state.locale || "zh-CN";
  }

  document.documentElement.lang = state.locale || "zh-CN";
  document.title = t("app.title");
  localStorage.setItem(STORAGE_KEYS.locale, JSON.stringify(state.locale));
  window.__customSelect?.refreshAll?.();
}
