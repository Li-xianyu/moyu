let maxObservedViewportHeight = 0;

function isVirtualKeyboardOpen(viewportHeight) {
  const activeElement = document.activeElement;
  const isTypingTarget = activeElement && (
    activeElement.tagName === "TEXTAREA" ||
    (activeElement.tagName === "INPUT" && !["checkbox", "radio", "button"].includes((activeElement.type || "").toLowerCase()))
  );

  if (!isTypingTarget) {
    return false;
  }

  const baselineHeight = Math.max(maxObservedViewportHeight || 0, window.innerHeight || 0);
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
  const keyboardOpen = isVirtualKeyboardOpen(viewportHeight);

  if (!keyboardOpen) {
    maxObservedViewportHeight = Math.max(maxObservedViewportHeight, viewportHeight);
  }

  root.style.setProperty("--moyu-app-height", `${Math.floor(viewportHeight)}px`);
  root.classList.toggle("keyboard-open", keyboardOpen);

  let detectedOverlay = 0;
  if (viewport) {
    detectedOverlay = Math.max(0, window.innerHeight - viewport.height - (viewport.offsetTop || 0));
  }

  let guard = 0;
  if ((isNarrow || isTouchLike) && !keyboardOpen) {
    const fallbackGuard = isAndroid ? 20 : 12;
    guard = Math.max(detectedOverlay, fallbackGuard);

    if (isStandalone && detectedOverlay < 16) {
      guard = Math.max(8, detectedOverlay);
    }
  }

  root.style.setProperty("--moyu-bottom-guard", `${Math.round(guard)}px`);
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
    script.src = "https://cdn.jsdelivr.net/npm/eruda";
    script.async = true;
    script.onload = () => {
      console.info("[MOYU] Eruda script loaded");
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
      console.info("[MOYU] Eruda initialized");
      console.info("[MOYU] Mobile console ready", {
        href: location.href,
        userAgent: navigator.userAgent,
        viewport: {
          width: window.visualViewport?.width || window.innerWidth,
          height: window.visualViewport?.height || window.innerHeight,
        },
      });
      debugLog("bootstrap", "Mobile debug console enabled", {
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

function init() {
  applyI18n();
  mountSessionEditButton();
  mountComposerCancelButton();
  bindNav();
  bindSettings();
  bindCreateFlow();
  bindChat();
  bindInfoPopover();
  bindChatList();
  bindSettingsResize();
  bindFileDrop();
  hydrateSettingsInputs();
  renderSavedConfigs();
  renderModelCache();
  renderWorkModels();
  ensureMinimumNpcs();
  updateCreateViewMode();
  const initialView = resolveInitialView();
  renderSession();
  switchView(initialView);
  updateMobileViewportFix();
  syncMobileDebugConsole();
}

migrateLegacySessions();
init();
