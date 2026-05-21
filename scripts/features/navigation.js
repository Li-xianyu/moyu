"use strict";

const _scriptState = {};

function _loadScript(src) {
  if (_scriptState[src] === "loaded") return Promise.resolve();
  if (_scriptState[src] === "loading") {
    return new Promise((resolve) => {
      const check = () => {
        if (_scriptState[src] === "loaded") resolve();
        else setTimeout(check, 16);
      };
      check();
    });
  }
  _scriptState[src] = "loading";
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src + "?v=" + (window.APP_VERSION || "");
    s.onload = () => { _scriptState[src] = "loaded"; resolve(); };
    s.onerror = () => { _scriptState[src] = "error"; reject(new Error("Script load failed: " + src)); };
    document.body.appendChild(s);
  });
}

function pushViewHistory() {
  syncAppHistoryState({ forceReplace: true });
}

function captureViewEntry() {
  const activeView = getCurrentActiveView();
  if (!activeView) return null;
  const entry = { view: activeView, mobileSidebarOpen: state.mobileSidebarOpen };
  if (activeView === "chat") {
    if (state.showWelcomeHome) entry.welcome = true;
    else entry.sessionId = state.currentSessionId || "";
  } else if (activeView === "create") {
    entry.sessionId = state.currentSessionId || "";
    entry.editingId = state.editingSessionId || "";
  }
  return entry;
}

function createRootHistoryEntry() {
  return {
    moyuApp: true,
    moyuAppLayer: 0,
    view: "chat",
    welcome: true,
    mobileSidebarOpen: false
  };
}

function getAppHistoryLayer(entry) {
  if (!entry || typeof entry !== "object") return 0;
  if ((entry.view === "chat" || entry.view === "welcome") && (entry.welcome || !entry.sessionId)) {
    return 0;
  }
  return 1;
}

function buildAppHistoryEntry() {
  const entry = captureViewEntry() || createRootHistoryEntry();
  entry.moyuApp = true;
  entry.moyuAppLayer = getAppHistoryLayer(entry);
  if (entry.moyuAppLayer === 0) {
    entry.view = "chat";
    entry.welcome = true;
    entry.sessionId = "";
    entry.mobileSidebarOpen = false;
  }
  return entry;
}

let _restoringAppHistory = false;

function syncAppHistoryState(options = {}) {
  if (_restoringAppHistory || !window.history?.replaceState) return;

  const entry = buildAppHistoryEntry();
  const current = history.state;
  const currentIsApp = Boolean(current?.moyuApp);
  const currentLayer = currentIsApp ? Number(current.moyuAppLayer || getAppHistoryLayer(current)) : null;

  if (!currentIsApp) {
    if (entry.moyuAppLayer === 1 && window.history?.pushState) {
      history.replaceState(createRootHistoryEntry(), "");
      history.pushState(entry, "");
    } else {
      history.replaceState(entry, "");
    }
    return;
  }

  if (options.forceReplace || currentLayer === entry.moyuAppLayer) {
    history.replaceState(entry, "");
    return;
  }

  if (currentLayer === 0 && entry.moyuAppLayer === 1 && window.history?.pushState) {
    history.pushState(entry, "");
    return;
  }

  history.replaceState(entry, "");
}

function getCurrentActiveView() {
  for (const [name, view] of Object.entries(els.views)) {
    if (view.classList.contains("active")) return name;
  }
  return null;
}

async function restoreViewFromHistory(entry) {
  if (entry.view === "chat" || entry.view === "welcome") {
    if (entry.welcome || entry.view === "welcome") {
      state.showWelcomeHome = true;
      state.currentSessionId = "";
    } else {
      state.showWelcomeHome = false;
      state.currentSessionId = entry.sessionId || "";
    }
    state.editingSessionId = null;
    // Temporarily close sidebar so switchView doesn't auto-close it again
    state.mobileSidebarOpen = false;
    switchView("chat");
    // Restore sidebar to saved state
    if (entry.mobileSidebarOpen && isMobileViewport()) {
      state.mobileSidebarOpen = true;
      applySidebarState();
    }
    renderSession();
  } else if (entry.view === "create") {
    state.openChatMenuId = null;
    state.deleteConfirmSessionId = null;
    state.renameSessionId = null;
    if (entry.editingId) {
      await _loadScript("./scripts/features/create.js");
      await _loadScript("./scripts/features/settings.js");
      initCreateView();
      openSessionEditor(entry.editingId);
    } else {
      await _loadScript("./scripts/features/create.js");
      initCreateView();
      prepareCreateViewForNewSession({ returnTarget: "chat" });
      switchView("create");
    }
  } else if (entry.view === "settings") {
    await _loadScript("./scripts/features/create.js");
    await _loadScript("./scripts/features/settings.js");
    initSettingsView();
    switchView("settings");
  } else if (entry.view === "roles") {
    await _loadScript("./scripts/features/roles.js");
    initRolesView();
    switchView("roles");
  }
}

window.addEventListener("popstate", async (e) => {
  if (e.state?.view || e.state?.moyuApp) {
    const entry = e.state?.moyuApp ? e.state : createRootHistoryEntry();
    _restoringAppHistory = true;
    try {
      await restoreViewFromHistory(entry);
    } finally {
      _restoringAppHistory = false;
      syncAppHistoryState({ forceReplace: true });
    }
  }
});

function bindNav() {
  if (els.sidebarToggleBtn) {
    els.sidebarToggleBtn.addEventListener("click", () => {
      if (isMobileViewport()) {
        state.mobileSidebarOpen = !state.mobileSidebarOpen;
      } else {
        state.sidebarCollapsed = !(state.sidebarCollapsed === null ? false : state.sidebarCollapsed);
        persistSidebarCollapsed();
      }
      applySidebarState();
    });
  }

  if (els.sidebarCollapseBtn) {
    els.sidebarCollapseBtn.addEventListener("click", () => {
      if (isMobileViewport()) {
        state.mobileSidebarOpen = false;
      } else {
        state.sidebarCollapsed = true;
        persistSidebarCollapsed();
      }
      applySidebarState();
    });
  }

  if (els.sidebarBackdrop) {
    els.sidebarBackdrop.addEventListener("click", () => {
      state.mobileSidebarOpen = false;
      applySidebarState();
    });
  }

  window.addEventListener("resize", () => {
    if (!isMobileViewport()) {
      state.mobileSidebarOpen = false;
    }
    applySidebarState();
  });

  els.navButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const view = button.dataset.view;
      if (view === "create") {
        await _loadScript("./scripts/features/create.js");
        initCreateView();
        const returnTarget = state.showWelcomeHome ? "welcome" : "chat";
        prepareCreateViewForNewSession({ returnTarget });
      } else if (view === "settings") {
        await _loadScript("./scripts/features/create.js");
        await _loadScript("./scripts/features/settings.js");
        initSettingsView();
      } else if (view === "roles") {
        await _loadScript("./scripts/features/roles.js");
        initRolesView();
      }
      switchView(view);
    });
  });

  applySidebarState();
}

bindMobileSwipeGesture();

let _settingsInited = false;
let _createInited = false;

function initSettingsView() {
  if (_settingsInited) return;
  _settingsInited = true;
  bindSettings();
  bindSettingsResize();
  hydrateSettingsInputs();
  renderSavedConfigs();
  renderModelCache();
  renderWorkModels();
}

function initCreateView() {
  if (_createInited) return;
  if (typeof bindCreateFlow !== "function") {
    _createInited = false;
    return;
  }
  _createInited = true;
  bindCreateFlow();
}

window._loadScript = _loadScript;

function isMobileViewport() {
  return window.matchMedia("(max-width: 960px)").matches;
}

function persistSidebarCollapsed() {
  localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, JSON.stringify(Boolean(state.sidebarCollapsed)));
}

function applySidebarState() {
  if (!els.appShell) {
    return;
  }

  const isMobile = isMobileViewport();
  const isCollapsed = state.sidebarCollapsed === null ? false : Boolean(state.sidebarCollapsed);

  els.appShell.classList.toggle("sidebar-collapsed", !isMobile && isCollapsed);
  els.appShell.classList.toggle("sidebar-drawer-open", isMobile && state.mobileSidebarOpen);

  if (els.sidebarBackdrop) {
    els.sidebarBackdrop.classList.toggle("hidden", !(isMobile && state.mobileSidebarOpen));
  }
}

function setSidebarGestureProgress(progress, options = {}) {
  const sb = els.sidebar || document.querySelector(".sidebar");
  const bd = els.sidebarBackdrop || document.querySelector(".sidebar-backdrop");
  const clamped = Math.max(0, Math.min(1, Number(progress) || 0));
  const eased = 1 - Math.pow(1 - clamped, 1.55);
  const interacting = Boolean(options.interacting);
  const openEdgeOffsetPx = Math.max(0, Number(options.openEdgeOffsetPx) || 0);

  if (els.appShell) {
    els.appShell.classList.toggle("sidebar-swiping", clamped > 0.001);
  }

  if (sb) {
    if (openEdgeOffsetPx > 0 && clamped >= 0.999) {
      sb.style.transform = `translate3d(${openEdgeOffsetPx}px, 0, 0)`;
      sb.style.boxShadow = "";
    } else {
      sb.style.transform = `translate3d(${-100 * (1 - clamped)}%, 0, 0)`;
      sb.style.boxShadow = "";
    }
    sb.style.opacity = clamped;
  }

  if (bd) {
    const visible = clamped > 0.001;
    bd.classList.toggle("hidden", !visible);
    bd.style.display = visible ? "block" : "none";
    bd.style.opacity = visible ? String(eased) : "0";
    bd.style.pointerEvents = visible && !interacting ? "auto" : "none";
  }
}

function clearSidebarGestureProgress() {
  const sb = els.sidebar || document.querySelector(".sidebar");
  const bd = els.sidebarBackdrop || document.querySelector(".sidebar-backdrop");

  if (els.appShell) {
    els.appShell.classList.remove("sidebar-swiping");
  }

  if (sb) {
    sb.style.transform = "";
    sb.style.opacity = "";
    sb.style.transition = "";
    sb.style.boxShadow = "";
  }

  if (bd) {
    bd.style.display = "";
    bd.style.opacity = "";
    bd.style.pointerEvents = "";
    bd.style.transition = "";
  }
}

function initSidebarGestureDebugTools() {
  const STORAGE_KEY = "moyu-sidebar-gesture-debug";
  const MAX_SESSIONS = 12;
  const MAX_FRAMES = 240;
  const MAX_MOVES = 180;
  const debug = {
    enabled: false,
    live: false,
    sessions: [],
    activeSession: null,
    rafId: 0,
    lastFrame: null
  };

  function round(value, digits = 2) {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Number(num.toFixed(digits));
  }

  function getSidebarMetrics(progressHint) {
    const sb = els.sidebar || document.querySelector(".sidebar");
    const chatList = document.querySelector(".chat-list-items");
    if (!sb) {
      return {
        progress: round(progressHint, 4)
      };
    }

    const rect = sb.getBoundingClientRect();
    const style = window.getComputedStyle(sb);
    let translateX = 0;
    if (style.transform && style.transform !== "none") {
      try {
        translateX = new DOMMatrixReadOnly(style.transform).m41;
      } catch (error) {
        translateX = 0;
      }
    }

    return {
      left: round(rect.left),
      width: round(rect.width),
      translateX: round(translateX),
      opacity: round(style.opacity, 4),
      progress: round(progressHint, 4),
      sidebarScrollTop: round(sb.scrollTop),
      chatListScrollTop: chatList ? round(chatList.scrollTop) : null
    };
  }

  function describeTarget(target) {
    if (!(target instanceof Element)) return String(target || "");
    const parts = [];
    let node = target;
    let depth = 0;
    while (node && depth < 4) {
      let label = node.tagName.toLowerCase();
      if (node.id) label += "#" + node.id;
      if (node.classList?.length) {
        label += "." + [...node.classList].slice(0, 3).join(".");
      }
      parts.push(label);
      node = node.parentElement;
      depth += 1;
    }
    return parts.join(" <= ");
  }

  function buildSummary(session) {
    const safeSession = session && typeof session === "object" ? session : {};
    const moveEntries = Array.isArray(session?.moves)
      ? session.moves.filter((item) => item && typeof item === "object")
      : [];
    const moves = moveEntries.length;
    const frames = Array.isArray(safeSession.frames) ? safeSession.frames.length : 0;
    const anomalies = Array.isArray(safeSession.anomalies) ? safeSession.anomalies.length : 0;
    const firstProgress = moves ? moveEntries[0].visualProgress : safeSession.start?.progress;
    const lastProgress = moves ? moveEntries[moves - 1].visualProgress : safeSession.end?.progress;
    return {
      sessionId: safeSession.id,
      startedAt: safeSession.startedAt,
      startTarget: safeSession.start?.targetLabel || "",
      insideSidebar: Boolean(safeSession.start?.insideSidebar),
      insideChatList: Boolean(safeSession.start?.insideChatList),
      wasOpen: Boolean(safeSession.start?.wasOpen),
      willOpen: safeSession.end?.willOpen ?? null,
      moves: moves,
      frames: frames,
      anomalies: anomalies,
      firstProgress: round(firstProgress, 4),
      lastProgress: round(lastProgress, 4)
    };
  }

  function printSession(session) {
    const summary = buildSummary(session || {});
    console.groupCollapsed("[MOYU sidebar-debug]", summary);
    console.log("summary", summary);
    console.log("start", session?.start || null);
    if (Array.isArray(session?.moves) && session.moves.length) {
      console.table(session.moves.filter((item) => item && typeof item === "object").slice(-12));
    }
    if (Array.isArray(session?.anomalies) && session.anomalies.length) {
      console.warn("anomalies", session.anomalies);
      console.table(session.anomalies);
    }
    if (session?.end) {
      console.log("end", session.end);
    }
    console.groupEnd();
  }

  function serializeSession(session) {
    if (!session) return "";
    return JSON.stringify(session, null, 2);
  }

  async function copyText(text) {
    const value = String(text || "");
    if (!value) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (error) {}

    try {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.style.pointerEvents = "none";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      textarea.remove();
      return ok;
    } catch (error) {
      return false;
    }
  }

  function pushSession(session) {
    debug.sessions.push(session);
    if (debug.sessions.length > MAX_SESSIONS) {
      debug.sessions.shift();
    }
  }

  function sampleFrame(ts) {
    if (!debug.enabled || !debug.activeSession || !debug.activeSession.dragging) {
      debug.rafId = 0;
      debug.lastFrame = null;
      return;
    }

    const session = debug.activeSession;
    const metrics = getSidebarMetrics(session.latestProgress);
    const frame = {
      t: round(ts, 2),
      dt: debug.lastFrame ? round(ts - debug.lastFrame.t, 2) : 0,
      left: metrics.left,
      translateX: metrics.translateX,
      opacity: metrics.opacity,
      progress: metrics.progress,
      sidebarScrollTop: metrics.sidebarScrollTop,
      chatListScrollTop: metrics.chatListScrollTop
    };

    if (session.frames.length < MAX_FRAMES) {
      session.frames.push(frame);
    }

    if (debug.lastFrame) {
      const jumpPx = Math.abs((frame.left ?? 0) - (debug.lastFrame.left ?? 0));
      const jumpProgress = Math.abs((frame.progress ?? 0) - (debug.lastFrame.progress ?? 0));
      const scrollJump = Math.abs((frame.sidebarScrollTop ?? 0) - (debug.lastFrame.sidebarScrollTop ?? 0));
      if (frame.dt > 24 || jumpPx > 18 || jumpProgress > 0.16 || scrollJump > 1) {
        session.anomalies.push({
          type: "frame",
          t: frame.t,
          dt: frame.dt,
          jumpPx: round(jumpPx),
          jumpProgress: round(jumpProgress, 4),
          scrollJump: round(scrollJump),
          left: frame.left,
          progress: frame.progress,
          sidebarScrollTop: frame.sidebarScrollTop
        });
      }
    }

    debug.lastFrame = frame;
    debug.rafId = requestAnimationFrame(sampleFrame);
  }

  function ensureFrameLoop() {
    if (!debug.enabled || !debug.activeSession || debug.rafId) return;
    debug.lastFrame = null;
    debug.rafId = requestAnimationFrame(sampleFrame);
  }

  function stopFrameLoop() {
    if (debug.rafId) {
      cancelAnimationFrame(debug.rafId);
      debug.rafId = 0;
    }
    debug.lastFrame = null;
  }

  window.__moyuSidebarGestureDebug = {
    enable(options = {}) {
      debug.enabled = true;
      debug.live = Boolean(options.live);
      if (options.persist !== false) {
        localStorage.setItem(STORAGE_KEY, "1");
      }
      console.info("[MOYU sidebar-debug] enabled", { live: debug.live });
      return this.getState();
    },
    disable(options = {}) {
      debug.enabled = false;
      debug.live = false;
      debug.activeSession = null;
      stopFrameLoop();
      if (options.persist !== false) {
        localStorage.removeItem(STORAGE_KEY);
      }
      console.info("[MOYU sidebar-debug] disabled");
      return this.getState();
    },
    clear() {
      debug.sessions.length = 0;
      debug.activeSession = null;
      stopFrameLoop();
      console.info("[MOYU sidebar-debug] cleared");
    },
    getState() {
      return {
        enabled: debug.enabled,
        live: debug.live,
        sessions: debug.sessions.length,
        activeSessionId: debug.activeSession?.id || null
      };
    },
    dumpLast() {
      const session = debug.sessions[debug.sessions.length - 1];
      if (!session) {
        console.info("[MOYU sidebar-debug] no session");
        return null;
      }
      printSession(session);
      return session;
    },
    getLastJson() {
      const session = debug.sessions[debug.sessions.length - 1];
      if (!session) return "";
      return serializeSession(session);
    },
    async copyLast() {
      const text = this.getLastJson();
      if (!text) {
        console.info("[MOYU sidebar-debug] no session to copy");
        return false;
      }
      const ok = await copyText(text);
      console.info(ok ? "[MOYU sidebar-debug] copied last session" : "[MOYU sidebar-debug] copy failed; use getLastJson()");
      return ok;
    },
    getAllJson() {
      return JSON.stringify(debug.sessions, null, 2);
    },
    async copyAll() {
      const text = this.getAllJson();
      if (!text || text === "[]") {
        console.info("[MOYU sidebar-debug] no sessions to copy");
        return false;
      }
      const ok = await copyText(text);
      console.info(ok ? "[MOYU sidebar-debug] copied all sessions" : "[MOYU sidebar-debug] copy failed; use getAllJson()");
      return ok;
    },
    getSessions() {
      return debug.sessions.slice();
    },
    describeTarget(target) {
      return describeTarget(target);
    },
    startSession(payload) {
      if (!debug.enabled) return;
      const safePayload = payload && typeof payload === "object" ? payload : {};
      const session = {
        id: Date.now() + "-" + Math.random().toString(16).slice(2, 8),
        startedAt: new Date().toISOString(),
        start: safePayload,
        moves: [],
        frames: [],
        anomalies: [],
        latestProgress: safePayload.progress ?? 0,
        dragging: false,
        end: null
      };
      debug.activeSession = session;
      pushSession(session);
      if (debug.live) {
        console.log("[MOYU sidebar-debug] start", safePayload);
      }
    },
    markDragStart(payload) {
      if (!debug.enabled || !debug.activeSession) return;
      debug.activeSession.dragging = true;
      if (debug.live) {
        console.log("[MOYU sidebar-debug] drag-start", payload);
      }
      ensureFrameLoop();
    },
    recordMove(payload) {
      if (!debug.enabled || !debug.activeSession) return;
      if (!payload || typeof payload !== "object") return;
      debug.activeSession.latestProgress = payload.visualProgress ?? debug.activeSession.latestProgress ?? 0;
      if (debug.activeSession.moves.length < MAX_MOVES) {
        debug.activeSession.moves.push(payload);
      }
      if (debug.live && debug.activeSession.moves.length % 6 === 0) {
        console.log("[MOYU sidebar-debug] move", payload);
      }
    },
    finishSession(payload) {
      if (!debug.enabled || !debug.activeSession) return;
      debug.activeSession.dragging = false;
      debug.activeSession.end = payload;
      stopFrameLoop();
      printSession(debug.activeSession);
      debug.activeSession = null;
    },
    cancelSession(payload) {
      if (!debug.enabled || !debug.activeSession) return;
      debug.activeSession.dragging = false;
      debug.activeSession.end = Object.assign({ canceled: true }, payload);
      stopFrameLoop();
      printSession(debug.activeSession);
      debug.activeSession = null;
    }
  };

  if (localStorage.getItem(STORAGE_KEY) === "1") {
    window.__moyuSidebarGestureDebug.enable({ persist: false });
  }
}

initSidebarGestureDebugTools();

function bindMobileSwipeGesture() {
  if (!("ontouchstart" in window)) return;

  let touchStartX = 0;
  let touchStartY = 0;
  let isDragging = false;
  let gestureBlocked = false;
  let gestureStartedInsideSidebar = false;
  let wasOpen = false;
  let sbWidth = 0;
  let gestureProgress = 0;
  let clearGestureTimer = 0;
  const SNAP_THRESHOLD = 0.35;
  const CLEAR_GESTURE_BUFFER_MS = 48;
  const OPEN_EDGE_ELASTIC_MAX_PX = 22;

  function getSb() { return els.sidebar || document.querySelector(".sidebar"); }
  function getBd() { return els.sidebarBackdrop || document.querySelector(".sidebar-backdrop"); }
  function getDebugTools() { return window.__moyuSidebarGestureDebug; }
  function isFormField(target) {
    return Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
  }
  function isInsideEruda(target) {
    if (!(target instanceof Element)) return false;
    let node = target;
    while (node) {
      const id = typeof node.id === "string" ? node.id.toLowerCase() : "";
      const className = typeof node.className === "string" ? node.className.toLowerCase() : "";
      if (
        id.includes("eruda") ||
        className.includes("eruda") ||
        node.matches?.("#eruda, .eruda-container, .eruda-entry-btn, .eruda-resizer, .eruda-dev-tools")
      ) {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  }
  function isCodeBlockHorizontalScrollArea(target) {
    const block = target instanceof Element ? target.closest(".pre-code-block") : null;
    if (!block) {
      return false;
    }
    const codeLines = block.querySelector(".code-lines");
    if (codeLines && codeLines.scrollWidth > codeLines.clientWidth + 2) {
      return true;
    }
    return block.scrollWidth > block.clientWidth + 2;
  }
  function getRubberBandOffset(distancePx) {
    const safe = Math.max(0, Number(distancePx) || 0);
    if (!safe) return 0;
    return (safe * OPEN_EDGE_ELASTIC_MAX_PX) / (safe + OPEN_EDGE_ELASTIC_MAX_PX);
  }

  document.addEventListener("touchstart", (e) => {
    if (!isMobileViewport()) return;
    const target = e.target;
    if (isFormField(target)) return;
    if (isInsideEruda(target)) return;

    if (clearGestureTimer) {
      clearTimeout(clearGestureTimer);
      clearGestureTimer = 0;
    }
    clearSidebarGestureProgress();

    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    wasOpen = state.mobileSidebarOpen;
    isDragging = false;
    gestureBlocked = false;
    gestureStartedInsideSidebar = Boolean(target?.closest?.(".sidebar"));
    sbWidth = 0;
    gestureProgress = wasOpen ? 1 : 0;

    getDebugTools()?.startSession({
      t: Number(performance.now().toFixed(2)),
      x: touchStartX,
      y: touchStartY,
      wasOpen: wasOpen,
      progress: gestureProgress,
      targetLabel: getDebugTools()?.describeTarget?.(e.target) || String(e.target || ""),
      insideSidebar: Boolean(e.target?.closest?.(".sidebar")),
      insideChatList: Boolean(e.target?.closest?.(".chat-list-items")),
      sidebarScrollTop: getSb() ? Number(getSb().scrollTop.toFixed ? getSb().scrollTop.toFixed(2) : getSb().scrollTop) : null
    });

    if (isCodeBlockHorizontalScrollArea(target)) {
      gestureBlocked = true;
      touchStartX = 0;
      getDebugTools()?.cancelSession({
        t: Number(performance.now().toFixed(2)),
        reason: "code-block-horizontal-scroll"
      });
      return;
    }
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (!isMobileViewport() || touchStartX === 0 || gestureBlocked) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStartX;
    const dy = Math.abs(t.clientY - touchStartY);
    if (dy > Math.abs(dx) * 1.8) return;
    if (Math.abs(dx) < 10) return;

    if (!isDragging) {
      isDragging = true;
      const sb = getSb();
      sbWidth = sb ? sb.getBoundingClientRect().width : 260;
      if (sb) sb.style.transition = "none";
      const bd = getBd();
      if (bd) bd.style.transition = "none";
      getDebugTools()?.markDragStart({
        t: Number(performance.now().toFixed(2)),
        sbWidth: Number(sbWidth.toFixed(2)),
        insideSidebar: Boolean(e.target?.closest?.(".sidebar")),
        sidebarScrollTop: sb ? Number(sb.scrollTop.toFixed ? sb.scrollTop.toFixed(2) : sb.scrollTop) : null
      });
    }

    // 跟手阶段统一灵敏度，展开/收起对称
    let rawProgress = dx / sbWidth;
    if (wasOpen) rawProgress = 1 + (dx / sbWidth);

    // Rubber band resistance past edges
    let progress;
    if (rawProgress < 0) progress = rawProgress * 0.5;
    else if (rawProgress > 1) progress = 1 + (rawProgress - 1) * 0.5;
    else progress = rawProgress;

    // Visual: never let sidebar go past its bounds
    const visualProgress = Math.max(0, Math.min(1, progress));
    const openEdgeOffsetPx = dx > 0 && progress >= 1
      ? getRubberBandOffset(dx)
      : 0;
    gestureProgress = visualProgress;

    setSidebarGestureProgress(visualProgress, {
      interacting: true,
      openEdgeOffsetPx: openEdgeOffsetPx
    });
    getDebugTools()?.recordMove({
      t: Number(performance.now().toFixed(2)),
      dx: Number(dx.toFixed(2)),
      dy: Number(dy.toFixed(2)),
      rawProgress: Number(rawProgress.toFixed(4)),
      visualProgress: Number(visualProgress.toFixed(4)),
      openEdgeOffsetPx: Number(openEdgeOffsetPx.toFixed(2)),
      insideSidebar: Boolean(e.target?.closest?.(".sidebar")),
      sidebarScrollTop: getSb() ? Number(getSb().scrollTop.toFixed ? getSb().scrollTop.toFixed(2) : getSb().scrollTop) : null
    });

    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  document.addEventListener("touchend", () => {
    if (!isMobileViewport()) return;
    if (!isDragging) {
      getDebugTools()?.cancelSession({
        t: Number(performance.now().toFixed(2)),
        reason: gestureBlocked ? "gesture-blocked" : "no-drag"
      });
      touchStartX = 0;
      touchStartY = 0;
      gestureBlocked = false;
      gestureStartedInsideSidebar = false;
      return;
    }
    isDragging = false;

    const sb = getSb();
    const progress = gestureProgress;

    // 展开/收起使用对称触发距离：wasOpen时阈值上移至0.65，两边触发距离一致
    const openThreshold = wasOpen ? 0.65 : SNAP_THRESHOLD;
    const willOpen = progress > openThreshold;
    state.mobileSidebarOpen = willOpen;

    // 松手过渡：展开→iOS经典缓出  收起→干脆利落无顿挫
    if (sb) {
      if (willOpen) {
        sb.style.transition = "transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1), opacity 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)";
      } else {
        sb.style.transition = "transform 0.22s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.22s cubic-bezier(0.4, 0, 0.2, 1)";
      }
    }
    const bd = getBd();
    if (bd) {
      bd.style.transition = willOpen
        ? "opacity 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)"
        : "opacity 0.22s cubic-bezier(0.4, 0, 0.2, 1)";
    }
    applySidebarState();
    requestAnimationFrame(() => {
      if (sb) {
        sb.style.transform = "";
        sb.style.opacity = "";
      }
      if (bd) {
        bd.style.opacity = "";
        bd.style.pointerEvents = "";
      }
    });
    clearGestureTimer = window.setTimeout(() => {
      clearSidebarGestureProgress();
      clearGestureTimer = 0;
    }, (willOpen ? 350 : 220) + CLEAR_GESTURE_BUFFER_MS);
    getDebugTools()?.finishSession({
      t: Number(performance.now().toFixed(2)),
      progress: Number(progress.toFixed(4)),
      willOpen: willOpen,
      sidebarLeft: sb ? Number(sb.getBoundingClientRect().left.toFixed(2)) : null,
      sidebarScrollTop: sb ? Number(sb.scrollTop.toFixed ? sb.scrollTop.toFixed(2) : sb.scrollTop) : null
    });

    touchStartX = 0;
    touchStartY = 0;
    gestureBlocked = false;
    gestureStartedInsideSidebar = false;
    gestureProgress = willOpen ? 1 : 0;
  }, { passive: true });

  document.addEventListener("touchcancel", () => {
    if (clearGestureTimer) {
      clearTimeout(clearGestureTimer);
      clearGestureTimer = 0;
    }
    isDragging = false;
    clearSidebarGestureProgress();
    touchStartX = 0;
    touchStartY = 0;
    gestureBlocked = false;
    gestureStartedInsideSidebar = false;
    gestureProgress = state.mobileSidebarOpen ? 1 : 0;
    getDebugTools()?.cancelSession({
      t: Number(performance.now().toFixed(2)),
      wasOpen: state.mobileSidebarOpen
    });
  }, { passive: true });
}

function bindInfoPopover() {
  els.infoToggleBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    els.chatInfoPopover.classList.toggle("hidden");
  });

  els.chatInfoPopover.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  document.addEventListener("click", () => {
    els.chatInfoPopover.classList.add("hidden");
  });
}

function bindChatList() {
  els.chatListToggleBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = els.chatListMenu.classList.contains("hidden");
    els.chatListMenu.classList.toggle("hidden", !willOpen);
    const arrow = document.getElementById("chatListArrowIcon");
    if (arrow) arrow.classList.toggle("expanded", willOpen);
  });

  els.chatListMenu.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  document.addEventListener("click", () => {
    commitRenameIfNeeded();
    state.openChatMenuId = null;
    state.deleteConfirmSessionId = null;
    renderChatListMenu();
  });

  els.chatExportBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (typeof exportAllSessions === "function") {
      exportAllSessions();
    }
  });

  els.chatImportBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    els.chatImportInput.click();
  });

  els.chatImportInput.addEventListener("change", () => {
    const file = els.chatImportInput.files?.[0];
    if (file && typeof importSessionsFromFile === "function") {
      importSessionsFromFile(file);
    }
    els.chatImportInput.value = "";
  });

  els.chatSearchBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const isHidden = els.chatSearchInput.hidden;
    els.chatSearchInput.hidden = !isHidden;
    els.chatSearchBtn.classList.toggle("active", isHidden);
    if (isHidden) {
      els.chatSearchInput.value = state.chatSearchQuery || "";
      els.chatSearchInput.focus();
      // auto-expand chat list so the search input is visible
      if (els.chatListMenu.classList.contains("hidden")) {
        els.chatListMenu.classList.remove("hidden");
        document.getElementById("chatListArrowIcon")?.classList.add("expanded");
      }
    } else {
      state.chatSearchQuery = "";
      els.chatSearchInput.value = "";
      renderChatListMenu();
    }
  });

  let searchTimer;
  els.chatSearchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.chatSearchQuery = els.chatSearchInput.value.trim();
      renderChatListMenu();
    }, 150);
  });
}

function bindSettingsResize() {
  if (!els.settingsResizableLayout || !els.settingsResizeHandle) {
    return;
  }

  const getResizeShell = () => els.settingsResizeHandle.parentElement;
  let activeRect = null;
  let pendingTopHeight = null;
  let rafId = 0;

  const applyPendingHeight = () => {
    rafId = 0;
    const shell = getResizeShell();
    if (!shell || pendingTopHeight === null) {
      return;
    }
    shell.style.gridTemplateRows = `${pendingTopHeight}px 10px minmax(180px, 1fr)`;
  };

  const onPointerMove = (event) => {
    if (!activeRect) {
      return;
    }
    const rawTop = event.clientY - activeRect.top;
    const handleHeight = 10;
    const minTop = 160;
    const minBottom = 180;
    const maxTop = activeRect.height - minBottom - handleHeight;
    pendingTopHeight = Math.max(minTop, Math.min(maxTop, rawTop));
    if (!rafId) {
      rafId = requestAnimationFrame(applyPendingHeight);
    }
  };

  const stopResize = () => {
    activeRect = null;
    pendingTopHeight = null;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stopResize);
  };

  els.settingsResizeHandle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const shell = getResizeShell();
    if (!shell) {
      return;
    }
    activeRect = shell.getBoundingClientRect();
    if (typeof els.settingsResizeHandle.setPointerCapture === "function") {
      try {
        els.settingsResizeHandle.setPointerCapture(event.pointerId);
      } catch (_) {}
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
  });
}

function switchView(viewName) {
  Object.entries(els.views).forEach(([name, view]) => {
    view.classList.toggle("active", name === viewName);
  });

  els.navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });

  // 设置页/创建页自己滚动，锁 .main 避免键盘切换导致 layout shift
  const mainEl = document.querySelector(".main");
  if (mainEl) {
    const nonChat = viewName !== "chat";
    const isNarrow = window.matchMedia("(max-width: 960px)").matches;
    const isTouch = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
    if (nonChat && (isNarrow || isTouch)) {
      mainEl.classList.add("scroll-lock");
    } else {
      mainEl.classList.remove("scroll-lock");
    }
  }

  if (isMobileViewport() && state.mobileSidebarOpen) {
    state.mobileSidebarOpen = false;
    applySidebarState();
  }

  syncAppHistoryState();
}

function mountSessionEditButton() {
  if (!els.infoToggleBtn || els.editSessionBtn) {
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "info-btn floating session-edit-btn icon-only-btn";
  button.setAttribute("aria-label", "编辑当前会话");
  button.innerHTML = `<i data-lucide="settings" class="nav-icon-svg"></i>`;
  button.addEventListener("click", async () => {
    if (state.isSending) {
      return;
    }
    const session = getCurrentSession();
    if (session) {
      await _loadScript("./scripts/features/create.js");
      await _loadScript("./scripts/features/settings.js");
      initCreateView();
      openSessionEditor(session.id);
    }
  });

  els.infoToggleBtn.insertAdjacentElement("beforebegin", button);
  els.editSessionBtn = button;
  lucide.createIcons();
}

function mountComposerCancelButton() {
  if (!els.composerFooter || els.cancelEditBtn) {
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-btn composer-cancel-btn hidden";
  button.innerHTML = '<i data-lucide="x"></i>';
  button.addEventListener("click", () => {
    clearUserMessageEdit();
  });

  els.sendBtn.insertAdjacentElement("beforebegin", button);
  els.cancelEditBtn = button;
  lucide.createIcons();
}
