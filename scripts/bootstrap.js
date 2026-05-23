"use strict";

let maxObservedViewportHeight = 0;
let _prevKeyboardOpen = false;

function isTypingTarget(el) {
  const activeElement = el || document.activeElement;
  return Boolean(activeElement && (
    activeElement.tagName === "TEXTAREA" ||
    (activeElement.tagName === "INPUT" && !["checkbox", "radio", "button"].includes((activeElement.type || "").toLowerCase()))
  ));
}

function isVirtualKeyboardOpen(viewportHeight) {
  if (!isTypingTarget()) {
    return false;
  }

  const baselineHeight = maxObservedViewportHeight || 0;
  return baselineHeight > 0 && baselineHeight - viewportHeight > 160;
}

function updateMobileViewportFix() {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const viewportHeight = viewport?.height || window.innerHeight || root.clientHeight;
  const viewportWidth = viewport?.width || window.innerWidth || root.clientWidth;
  const isNarrow = viewportWidth <= 960;
  const isTouchLike = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches ?? false;
  const prevKeyboardOpen = _prevKeyboardOpen;
  const typingTarget = isTypingTarget();
  let keyboardOpen = isVirtualKeyboardOpen(viewportHeight);

  // fullH 只追踪 visualViewport.height 的最大值，排除 window.innerHeight
  // 因为 window.innerHeight 包含浏览器地址栏/底部栏，会导致 fullH 偏大。
  const fullH = Math.max(maxObservedViewportHeight || 0, viewportHeight);

  // 从"开"→"关"过渡时二次确认：viewport 必须回到接近全高，才真正执行收起
  if (!keyboardOpen && prevKeyboardOpen) {
    if (fullH - viewportHeight > 80) {
      keyboardOpen = true; // 视口尚未复原，键盘动画大概率还没走完
    }
  }

  let effectiveHeight = viewportHeight;
  if (!keyboardOpen) {
    // 只在键盘状态刚翻转这一刻使用 fullH 保护（防止 blur 后取到压缩值）；
    // 稳定非键盘状态直接用 viewportHeight，避免 fullH 被 browser chrome 污染。
    if (!typingTarget && prevKeyboardOpen) {
      effectiveHeight = fullH;
    }
    // 只追踪 viewportHeight（visualViewport.height），不追踪 window.innerHeight
    maxObservedViewportHeight = Math.max(maxObservedViewportHeight, viewportHeight);
  }

  root.style.setProperty("--moyu-app-height", `${Math.floor(effectiveHeight)}px`);
  root.classList.toggle("keyboard-open", keyboardOpen);

  // 键盘弹出/收起后，view 尺寸变化，重新把输入框滚到可见区域
  if (keyboardOpen !== prevKeyboardOpen) {
    const el = document.activeElement;
    if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) && el.id !== "chatInput") {
      clearTimeout(window.__moyuKbScroll);
      window.__moyuKbScroll = setTimeout(() => {
        try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (_) {}
      }, 350);
    }
  }
  _prevKeyboardOpen = keyboardOpen;

  // 设置页/创建页自己滚动，始终锁 .main 避免键盘切换导致 layout shift
  const mainEl = document.querySelector(".main");
  if (mainEl) {
    const active = document.querySelector(".view.active");
    if (active && active.id !== "chatView") {
      if (keyboardOpen) {
        mainEl.scrollTop = 0;
      }
      mainEl.classList.add("scroll-lock");
    } else {
      mainEl.classList.remove("scroll-lock");
    }
  }

  let guard = 0;
  if ((isNarrow || isTouchLike) && !keyboardOpen) {
    // 键盘刚收起时视口尚未完全复原，window.innerHeight - viewport.height
    // 是键盘残余高度而非底部导航栏，不触发 overlay guard，防止 layout shift。
    if (!prevKeyboardOpen) {
      let detectedOverlay = 0;
      if (viewport) {
        detectedOverlay = Math.max(0, window.innerHeight - viewport.height - (viewport.offsetTop || 0));
      }
      const fallbackGuard = isAndroid ? 20 : 12;
      guard = Math.max(detectedOverlay, fallbackGuard);

      if (isStandalone && detectedOverlay < 16) {
        guard = Math.max(8, detectedOverlay);
      }
    }
  }

  root.style.setProperty("--moyu-bottom-guard", `${Math.round(guard)}px`);

  // 诊断日志
  const _t = Date.now();
  if (!window.__moyuVpLogTs || _t - window.__moyuVpLogTs > 150) {
    window.__moyuVpLogTs = _t;
    debugInfo("[MOYU-VP]", JSON.stringify({
      t: _t, vp: viewportHeight, full: fullH,
      diff: fullH - viewportHeight, ko: keyboardOpen,
      pko: prevKeyboardOpen, tt: typingTarget,
      eff: Math.floor(effectiveHeight), guard: Math.round(guard),
      ih: window.innerHeight, rh: root.clientHeight,
      max: maxObservedViewportHeight
    }));
  }
}

function shouldEnableMobileDebugConsole() {
  const developerSettings = state.settings?.developer || {};
  const viewportWidth = window.visualViewport?.width || window.innerWidth || document.documentElement.clientWidth;
  const isTouchLike = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  return Boolean(developerSettings.mobileConsole) && (viewportWidth <= 960 || isTouchLike);
}

function loadErudaScript() {
  if (window.eruda) {
    return Promise.resolve(window.eruda);
  }

  if (window.__moyuErudaLoadingPromise) {
    return window.__moyuErudaLoadingPromise;
  }

  window.__moyuErudaLoadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "./vendor/eruda/3/eruda.min.js";
    script.async = true;
    script.onload = () => {
      debugInfo("[MOYU] Eruda script loaded");
      resolve(window.eruda);
    };
    script.onerror = () => {
      console.error("[MOYU] Failed to load Eruda from jsDelivr");
      reject(new Error("Eruda load failed"));
    };
    document.head.appendChild(script);
  });

  return window.__moyuErudaLoadingPromise;
}

function syncMobileDebugConsole() {
  const shouldEnable = shouldEnableMobileDebugConsole();

  if (!shouldEnable) {
    if (window.eruda?._isInit && typeof window.eruda.destroy === "function") {
      window.eruda.destroy();
    }
    return;
  }

  loadErudaScript()
    .then((eruda) => {
      if (!eruda || eruda._isInit || !shouldEnableMobileDebugConsole()) {
        return;
      }
      eruda.init();
      debugInfo("[MOYU] Eruda initialized");
      debugInfo("[MOYU] Mobile console ready", {
        href: location.href,
        userAgent: navigator.userAgent,
        viewport: {
          width: window.visualViewport?.width || window.innerWidth,
          height: window.visualViewport?.height || window.innerHeight,
        },
      });
      debugLog("bootstrap", t("debug.msg.mobileDebugConsole"), {
        href: location.href,
        viewportWidth: window.visualViewport?.width || window.innerWidth,
        viewportHeight: window.visualViewport?.height || window.innerHeight,
      });
    })
    .catch((error) => {
      console.error("[MOYU] Failed to initialize Eruda", error);
    });
}

updateMobileViewportFix();
syncMobileDebugConsole();
window.addEventListener("resize", updateMobileViewportFix, { passive: true });
window.addEventListener("orientationchange", updateMobileViewportFix, { passive: true });
window.addEventListener("resize", syncMobileDebugConsole, { passive: true });
window.addEventListener("orientationchange", syncMobileDebugConsole, { passive: true });
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", updateMobileViewportFix, { passive: true });
  window.visualViewport.addEventListener("scroll", updateMobileViewportFix, { passive: true });
  window.visualViewport.addEventListener("resize", syncMobileDebugConsole, { passive: true });
}

function resolveInitialView() {
  const initialPage = state.settings?.startup?.initialPage || "welcome";
  const hasSession = Boolean(getCurrentSession());

  if (initialPage === "create") {
    state.showWelcomeHome = false;
    return "create";
  }

  if (initialPage === "last-chat" && hasSession) {
    state.showWelcomeHome = false;
    return "chat";
  }

  state.showWelcomeHome = true;
  return "chat";
}

async function hydrateSessionMetasFromDb(options = {}) {
  const useChatFeature = Boolean(options.chatFeature);
  try {
    if (useChatFeature && typeof window.ensureChatFeatureLoaded === "function") {
      await window.ensureChatFeatureLoaded();
    } else if (typeof window.ensureChatDbLoaded === "function") {
      await window.ensureChatDbLoaded();
    } else if (typeof window._loadScript === "function") {
      await window._loadScript("./scripts/features/chat-db.js");
    }
  } catch (error) {
    debugWarn("[boot] chat-db preload failed", error);
    return false;
  }

  if (!window.__chatDB) {
    return false;
  }

  try {
    var sessions = await window.__chatDB.loadSessionMetas();
    if (sessions && sessions.length) {
      state.sessions = sessions;
    }
  } catch (e) {
    debugWarn("[boot] IDB load failed", e);
  }

  try {
    var migrated = await window.__chatDB.migrateFromLocalStorage();
    if (migrated > 0 || (!state.sessions.length)) {
      var reloaded = await window.__chatDB.loadSessionMetas();
      if (reloaded && reloaded.length) {
        state.sessions = reloaded;
      }
    }
  } catch (e) {
    debugWarn("[boot] migration failed", e);
  }

  migrateLegacySessions();
  if (state.currentSessionId && !getCurrentSession() && state.sessions.length) {
    state.currentSessionId = state.sessions[0].id;
  }

  var current = getCurrentSession();
  if (options.hydrateCurrent && current && !current.messagesHydrated) {
    if (typeof window.ensureChatFeatureLoaded === "function") {
      await window.ensureChatFeatureLoaded();
    }
    if (typeof ensureSessionMessagesHydrated === "function") {
      try {
        await ensureSessionMessagesHydrated(current);
      } catch (e) {
        debugWarn("[boot] current session hydrate failed", e);
      }
    }
  }

  if (options.renderList && typeof renderChatListMenu === "function") {
    renderChatListMenu();
  }
  return true;
}

function scheduleSessionMetaHydration(delay = 1800) {
  const run = () => hydrateSessionMetasFromDb({ renderList: true });
  if (window.requestIdleCallback) {
    window.requestIdleCallback(run, { timeout: delay + 1400 });
    return;
  }
  window.setTimeout(run, delay);
}

window.__moyuWarmSessionMetas = function(options = {}) {
  if (options.immediate) {
    return hydrateSessionMetasFromDb({ renderList: true });
  }
  scheduleSessionMetaHydration(Number.isFinite(options.delay) ? options.delay : 900);
  return Promise.resolve(false);
};

async function init() {
  applyI18n();
  applyTheme(state.theme);
  if (typeof _updateSystemThemeListener === "function") {
    _updateSystemThemeListener(state.theme);
  }
  bindNav();
  bindInfoPopover();
  bindChatList();

  const initialView = resolveInitialView();
  if (initialView === "create") {
    if (typeof window.ensureCreateRuntimeLoaded === "function") {
      await window.ensureCreateRuntimeLoaded();
    } else {
      await _loadScript("./scripts/features/create.js");
    }
    initCreateView();
    prepareCreateViewForNewSession({ returnTarget: "welcome" });
    switchView("create");
  } else if (initialView === "settings") {
    if (typeof ensureSettingsRuntimeLoaded === "function") {
      await ensureSettingsRuntimeLoaded();
    } else {
      await _loadScript("./scripts/features/settings.js");
    }
    initSettingsView();
    switchView("settings");
  } else {
    if (!state.showWelcomeHome && typeof window.ensureChatFeatureLoaded === "function") {
      await window.ensureChatFeatureLoaded();
    }
    switchView(initialView);
  }
  renderChatListMenu();
  renderSession();
  updateMobileViewportFix();
  syncMobileDebugConsole();
  if (typeof warmSettingsRuntime === "function" && initialView !== "settings") {
    warmSettingsRuntime();
  }
  if (window.__moyuCriticalStylesReady?.then) {
    await window.__moyuCriticalStylesReady;
  }

  var loadingEl = document.getElementById('loadingScreen');
  if (loadingEl) {
    var tw = window.__moyuTypewriter;
    function fadeOut() {
      loadingEl.classList.add('loading-screen--fade-out');
      setTimeout(function() {
        loadingEl.setAttribute('aria-hidden', 'true');
        if (tw && typeof tw.stop === "function") tw.stop();
      }, 400);
    }
    fadeOut();
  }

  // DEBUG: measure welcome layout shifts
  (function() {
    var logWelcomeMetrics = function(label) {
      var logo = document.querySelector('.welcome-logo');
      var copy = document.querySelector('.chat-welcome-copy');
      if (!logo || !copy) { console.log('[welcome-debug]', label, 'elements not found'); return; }
      var lr = logo.getBoundingClientRect();
      var cr = copy.getBoundingClientRect();
      console.log('[welcome-debug]', label,
        'logo:', Math.round(lr.width), 'x', Math.round(lr.height),
        '| copy:', Math.round(cr.width), 'x', Math.round(cr.height));
    };
    logWelcomeMetrics('pre-fade');
    [100, 400, 800, 1500, 3000].forEach(function(ms) {
      setTimeout(function() { logWelcomeMetrics(ms + 'ms'); }, ms);
    });
  })();

  // 首屏转场后立即用 idle 时间并行预热全部功能（settings 已在上方预热）
  var warmAll = function() {
    hydrateSessionMetasFromDb({ renderList: true }).catch(function() {});
    if (typeof ensureChatFeatureLoaded === "function") ensureChatFeatureLoaded().catch(function() {});
  };
  if (window.requestIdleCallback) {
    window.requestIdleCallback(warmAll, { timeout: 1000 });
  } else {
    window.setTimeout(warmAll, 300);
  }
}

(async function boot() {
  const startupInitialPage = state.settings?.startup?.initialPage || "welcome";
  if (startupInitialPage === "last-chat") {
    await hydrateSessionMetasFromDb({ hydrateCurrent: true });
  }

  migrateLegacySessions();

  await init();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(function() {});
  }
})();
