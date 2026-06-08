"use strict";

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function copyToClipboard(text, onSuccess) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(onSuccess, () => onSuccess());
  } else {
    onSuccess();
  }
}

function smoothScrollTo(element, targetY) {
  const startY = element.scrollTop;
  const distance = targetY - startY;
  if (Math.abs(distance) < 1) return;
  const duration = Math.min(Math.max(Math.abs(distance) * 0.2 + 60, 100), 360);
  const startTime = performance.now();

  function step(now) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1);
    const ease = 1 - (1 - t) * (1 - t);
    element.scrollTop = startY + distance * ease;
    if (t < 1) {
      requestAnimationFrame(step);
    }
  }

  requestAnimationFrame(step);
}

async function safeReadError(response) {
  try {
    const data = await response.json();
    return data?.error?.message || "";
  } catch {
    return "";
  }
}

function upsertConfig(host, key) {
  const activeConfig = getActiveConfig();
  if (!activeConfig) {
    return;
  }
  activeConfig.host = host;
  activeConfig.key = key;
}

function upsertSession(session) {
  const existingIndex = state.sessions.findIndex((item) => item.id === session.id);
  if (existingIndex >= 0) {
    state.sessions[existingIndex] = session;
  } else {
    state.sessions.unshift(session);
  }
}

function touchSession(session) {
  session.updatedAt = new Date().toISOString();
  upsertSession(session);
}

const SESSION_SETTING_DEFAULTS = Object.freeze({
  compressThreshold: 1800,
  showTokenDisplay: true,
  directorDispatchOnly: false,
  markdownRender: true,
  showLineNumbers: false,
  autoTts: false,
  showModelProviderIcon: null,
  modelThinking: "disabled",
});

function getDefaultModelProviderIconVisibility(session) {
  return (session?.mode || SESSION_MODE_STORY) === SESSION_MODE_WORK;
}

function normalizeSessionSettingValue(key, value) {
  switch (key) {
    case "compressThreshold": {
      const num = Number.parseInt(value, 10);
      return Number.isFinite(num) ? Math.max(500, Math.min(10000, num)) : SESSION_SETTING_DEFAULTS.compressThreshold;
    }
    case "showTokenDisplay":
    case "directorDispatchOnly":
    case "markdownRender":
    case "showLineNumbers":
    case "autoTts":
    case "showModelProviderIcon":
      return Boolean(value);
    case "modelThinking":
      return value === "enabled" ? "enabled" : "disabled";
    default:
      return value;
  }
}

function normalizeSessionOverrides(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const overrides = {};
  Object.keys(SESSION_SETTING_DEFAULTS).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      overrides[key] = normalizeSessionSettingValue(key, source[key]);
    }
  });
  return overrides;
}

function getGlobalSessionSetting(key) {
  const fallback = SESSION_SETTING_DEFAULTS[key];
  const source = state.settings?.session || {};
  if (!Object.prototype.hasOwnProperty.call(source, key)) {
    return fallback;
  }
  return normalizeSessionSettingValue(key, source[key]);
}

function getSessionSetting(sessionOrKey, maybeKey) {
  const session = typeof sessionOrKey === "string" || sessionOrKey == null
    ? getCurrentSession()
    : sessionOrKey;
  const key = typeof sessionOrKey === "string" ? sessionOrKey : maybeKey;
  if (!key) {
    return undefined;
  }
  const overrides = normalizeSessionOverrides(session?.settingsOverrides);
  if (Object.prototype.hasOwnProperty.call(overrides, key)) {
    return overrides[key];
  }
  if (key === "showModelProviderIcon") {
    return getDefaultModelProviderIconVisibility(session);
  }
  return getGlobalSessionSetting(key);
}

function hasSessionSettingOverride(session, key) {
  const overrides = session?.settingsOverrides;
  return Boolean(overrides && Object.prototype.hasOwnProperty.call(overrides, key));
}

function setSessionSettingOverride(session, key, value) {
  if (!session || !key) {
    return;
  }
  session.settingsOverrides = normalizeSessionOverrides({
    ...(session.settingsOverrides || {}),
    [key]: normalizeSessionSettingValue(key, value),
  });
}

function clearSessionSettingOverride(session, key) {
  if (!session?.settingsOverrides || !key) {
    return;
  }
  const next = { ...session.settingsOverrides };
  delete next[key];
  session.settingsOverrides = normalizeSessionOverrides(next);
}

function normalizeAgentParamValue(key, value) {
  if (key === "temperature") {
    const num = Number.parseFloat(value);
    return Number.isFinite(num) ? Math.max(0, Math.min(2, Math.round(num * 10) / 10)) : undefined;
  }
  return value;
}

function getSessionAgentParam(session, agentName, param) {
  if (!session?.agentParams || !agentName || !param) return undefined;
  const agent = session.agentParams[agentName];
  if (!agent) return undefined;
  return agent[param];
}

function setSessionAgentParam(session, agentName, param, value) {
  if (!session) return;
  session.agentParams = {
    ...(session.agentParams || {}),
    [agentName]: {
      ...((session.agentParams || {})[agentName] || {}),
      [param]: normalizeAgentParamValue(param, value),
    },
  };
}

function buildFallbackTitle(session) {
  const text = session?.globalPrompt?.trim() || "未命名会话";
  return text.length > 12 ? `${text.slice(0, 12)}...` : text;
}

function getConfigCacheKey(host, key) {
  return `${host}::${key}`;
}

function normalizeHost(host) {
  return host.trim().replace(/\/+$/, "");
}

function persistSettings() {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings));
}

function persistModelCache() {
  localStorage.setItem(STORAGE_KEYS.modelCache, JSON.stringify(state.modelCache));
}

// ── IDB 持久化防抖 ──
var _idbPersistTimer = null;
function _flushIDBPersist() {
  _idbPersistTimer = null;
  if (window.__chatDB && state.sessions) {
    Promise.all((state.sessions || []).map(function (session) {
      if (!session || !session.id) return Promise.resolve();
      return window.__chatDB.updateSessionMeta(session);
    })).catch(function (err) {
      debugWarn("[persist] IDB meta sync failed", err);
    });
  }
}
function _scheduleIDBPersist() {
  if (_idbPersistTimer) clearTimeout(_idbPersistTimer);
  _idbPersistTimer = setTimeout(_flushIDBPersist, 1500);
}

function persistSessions() {
  localStorage.setItem(STORAGE_KEYS.currentSessionId, JSON.stringify(state.currentSessionId));
  if (window.__chatDB) {
    // 立即保存当前会话元数据（防丢）
    var current = getCurrentSession();
    if (current) {
      window.__chatDB.saveSession(current).catch(function (err) {
        debugWarn("[persist] save session failed", err);
      });
    }
    // 全量防抖保存（同步所有会话的排序/标题）
    _scheduleIDBPersist();
  }
}

// 页面关闭前强制刷一次
window.addEventListener("beforeunload", function () {
  if (_idbPersistTimer) {
    clearTimeout(_idbPersistTimer);
    if (window.__chatDB && state.sessions) {
      Promise.all((state.sessions || []).map(function (session) {
        if (!session || !session.id) return Promise.resolve();
        return window.__chatDB.updateSessionMeta(session);
      })).catch(function (err) {
        debugWarn("[persist] IDB meta sync failed", err);
      });
    }
  }
});

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function setText(element, text) {
  if (!element) {
    return;
  }
  element.textContent = text;
  if (element.id === "chatStatus") {
    element.dataset.tone = getChatStatusTone(text);
  }
}

function getChatStatusTone(text) {
  const value = String(text || "");
  if (/失败|异常|错误|无效|请先|failed|error|invalid|please/i.test(value)) {
    return "error";
  }
  if (/修改|edit/i.test(value)) {
    return "editing";
  }
  if (/正在|处理中|判断|回复|生成|processing|working|replying|generating/i.test(value)) {
    return "working";
  }
  if (/完成|已更新|可以开始聊天|创建会话后即可聊天|ready|completed|updated|start talking/i.test(value)) {
    return "success";
  }
  return "muted";
}

function showToast(message, type = "error", duration = 4000) {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("visible"));
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function getEntityTerm(mode) {
  return mode === SESSION_MODE_WORK ? "AI" : "NPC";
}

function maskKey(key) {
  if (key.length <= 8) {
    return "*".repeat(Math.max(key.length, 4));
  }
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isWeakModel(modelName) {
  const name = (modelName || "").toLowerCase();
  const weakPatterns = ["flash", "mini", "light", "tiny", "nano", "lte", "nothinking", "fast", "quick"];
  return weakPatterns.some((pattern) => name.includes(pattern));
}

function sanitizeGeneratedTitle(value) {
  const text = String(value || "")
    .replace(/["'“”‘’《》【】]/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (!text) {
    return "";
  }
  return text.slice(0, 8);
}

function normalizeSettings(raw) {
  const configs = [];
  const sourceConfigs = Array.isArray(raw?.configs) ? raw.configs : [];

  sourceConfigs.forEach((config, index) => {
    if (!config) {
      return;
    }
    configs.push({
      id: config.id || `cfg-${Date.now()}-${index}`,
      name: config.name || "",
      host: normalizeHost(config.host || ""),
      key: config.key || "",
      workModels: Array.isArray(config.workModels) ? config.workModels : [],
    });
  });

  if (!configs.length && (raw?.host || raw?.key)) {
    configs.push({
      id: `cfg-${Date.now()}-legacy`,
      name: "",
      host: normalizeHost(raw.host || ""),
      key: raw.key || "",
      workModels: [],
    });
  }

  if (!configs.length) {
    configs.push(createEmptyConfig());
  }

  const activeConfigId = configs.some((config) => config.id === raw?.activeConfigId)
    ? raw.activeConfigId
    : configs[0].id;
  const initialPage = ["welcome", "create", "last-chat"].includes(raw?.startup?.initialPage)
    ? raw.startup.initialPage
    : "welcome";

  return {
    activeConfigId,
    configs,
    assistant: {
      model: typeof raw?.assistant?.model === "string" ? raw.assistant.model : "",
    },
    startup: {
      initialPage,
    },
    developer: {
      debugMode: Boolean(raw?.developer?.debugMode),
      mobileConsole: Boolean(raw?.developer?.mobileConsole),
    },
    session: {
      ...(raw?.session || {}),
      compressThreshold: normalizeSessionSettingValue("compressThreshold", raw?.session?.compressThreshold),
      showTokenDisplay: normalizeSessionSettingValue("showTokenDisplay", raw?.session?.showTokenDisplay !== false),
      directorDispatchOnly: normalizeSessionSettingValue("directorDispatchOnly", raw?.session?.directorDispatchOnly),
      markdownRender: normalizeSessionSettingValue("markdownRender", raw?.session?.markdownRender !== false),
      showLineNumbers: normalizeSessionSettingValue("showLineNumbers", raw?.session?.showLineNumbers),
      autoTts: normalizeSessionSettingValue("autoTts", raw?.session?.autoTts),
      modelThinking: normalizeSessionSettingValue("modelThinking", raw?.session?.modelThinking),
    },
    tts: raw?.tts,
  };
}

function createEmptyConfig() {
  return {
    id: `cfg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    host: "",
    key: "",
    workModels: [],
  };
}

function getConfigLabel(config) {
  if (config.name?.trim()) {
    return config.name.trim();
  }
  if (config.host?.trim()) {
    return config.host.trim();
  }
  return "未命名接口";
}

function isDebugModeEnabled() {
  const developerSettings = state.settings?.developer || {};
  const viewportWidth = window.visualViewport?.width || window.innerWidth || document.documentElement.clientWidth;
  const isTouchLike = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  const mobileConsoleDebug = Boolean(developerSettings.mobileConsole) && (viewportWidth <= 960 || isTouchLike);
  return Boolean(developerSettings.debugMode || mobileConsoleDebug);
}

function debugLog(scope, message, payload) {
  if (!isDebugModeEnabled()) {
    return;
  }

  const SCOPE_COLORS = {
    director: "#9b59b6",
    turn: "#27ae60",
    compress: "#e67e22",
    npc: "#1abc9c",
    settings: "#7f8c8d",
    bootstrap: "#2980b9",
    stripThinking: "#e74c3c",
  };

  const time = new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const scopeLabel = t("debug.scope." + scope) || scope;
  const bg = SCOPE_COLORS[scope] || "#007acc";
  const prefix = `%c${scopeLabel}%c ${time} %c${message}`;
  const styles = [
    `color:#fff;background:${bg};padding:2px 8px;border-radius:999px;font-weight:700;font-size:11px;`,
    "color:#888;",
    "color:inherit;",
  ];

  if (typeof payload === "undefined") {
    console.log(prefix, ...styles);
    return;
  }

  console.group(prefix, ...styles);
  console.log(payload);
  console.groupEnd();
}

function debugInfo(...args) {
  if (!isDebugModeEnabled()) {
    return;
  }
  console.info(...args);
}

function debugWarn(...args) {
  if (!isDebugModeEnabled()) {
    return;
  }
  console.warn(...args);
}

function applyTheme(theme) {
  const resolved = theme === "system"
    ? (window.matchMedia?.('(prefers-color-scheme: light)').matches ? "light" : "dark")
    : (theme || "dark");
  document.documentElement.setAttribute("data-theme", resolved);
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  const metaScheme = document.querySelector('meta[name="color-scheme"]');
  if (metaTheme) {
    metaTheme.setAttribute("content", resolved === "light" ? "#f3f3f3" : "#1e1e1e");
  }
  if (metaScheme) {
    metaScheme.setAttribute("content", resolved === "light" ? "light" : "dark");
  }
  swapHighlightTheme(resolved);
}

let _themeMediaQuery = null;

function _onSystemThemeChange() {
  if (state.theme === "system") {
    applyTheme("system");
  }
}

function _updateSystemThemeListener(theme) {
  if (_themeMediaQuery) {
    _themeMediaQuery.removeEventListener("change", _onSystemThemeChange);
    _themeMediaQuery = null;
  }
  if (theme === "system") {
    _themeMediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    _themeMediaQuery.addEventListener("change", _onSystemThemeChange);
  }
}

function setTheme(theme) {
  const valid = theme === "system" || theme === "light" ? theme : "dark";
  state.theme = valid;
  applyTheme(valid);
  localStorage.setItem(STORAGE_KEYS.theme, JSON.stringify(valid));
  if (els?.themeSelect) {
    els.themeSelect.value = valid;
  }
  window.__customSelect?.refreshAll?.();
  _updateSystemThemeListener(valid);
}

function swapHighlightTheme(theme) {
  const links = document.querySelectorAll('link[href*="highlight.js"]');
  links.forEach(function (link) {
    link.href = link.href.replace(/atom-one-(dark|light)/, "atom-one-" + (theme === "light" ? "light" : "dark"));
  });
}

function cycleTheme() {
  const current = state.theme === "system"
    ? (window.matchMedia?.('(prefers-color-scheme: light)').matches ? "light" : "dark")
    : state.theme;
  const next = current === "dark" ? "light" : "dark";
  setTheme(next);
}
