/* ── Custom Select — replaces native <select> with styled UI ── */

(function () {
  "use strict";

  const REFRESH_QUEUE = new Set();
  const INSTANCES = new Set();
  const INSTANCE_BY_SELECT = new WeakMap();
  let refreshScheduled = false;
  let CUSTOM_SELECT_SEQ = 0;

  function batchRefresh() {
    refreshScheduled = false;
    for (const cs of REFRESH_QUEUE) {
      try { cs._sync(); } catch (e) { /* ignore */ }
    }
    REFRESH_QUEUE.clear();
  }

  function scheduleRefresh(cs) {
    REFRESH_QUEUE.add(cs);
    if (!refreshScheduled) {
      refreshScheduled = true;
      requestAnimationFrame(batchRefresh);
    }
  }

  /* ── CustomSelect instance ── */
  class CustomSelect {
    constructor(selectEl) {
      if (selectEl.dataset.csEnhanced) return;
      selectEl.dataset.csEnhanced = "true";

      this.el = selectEl;
      this.el.style.display = "none";
      this.uid = ++CUSTOM_SELECT_SEQ;
      this.listboxId = `cs-listbox-${this.uid}`;
      this.activeIndex = -1;

      this._build();
      this._sync();
      INSTANCES.add(this);
      INSTANCE_BY_SELECT.set(this.el, this);

      /* auto-refresh when select options change */
      /* split into two observers so attributeFilter can't suppress childList */
      this._obsChild = new MutationObserver(() => scheduleRefresh(this));
      this._obsChild.observe(this.el, { childList: true, subtree: true, characterData: true });
      this._obsAttr = new MutationObserver(() => scheduleRefresh(this));
      this._obsAttr.observe(this.el, { attributes: true, attributeFilter: ["value", "selected", "label"] });
      this.el.addEventListener("change", () => this._sync());
    }

    destroy() {
      this._close();
      this._obsChild?.disconnect();
      this._obsAttr?.disconnect();
      INSTANCES.delete(this);
      INSTANCE_BY_SELECT.delete(this.el);
      if (this.wrap.parentNode) {
        this.wrap.parentNode.insertBefore(this.el, this.wrap);
      }
      this.wrap.remove();
      /* if panel was orphaned on body, remove it */
      if (this.panel.parentNode !== this.wrap) this.panel.remove();
      this.el.style.display = "";
      delete this.el.dataset.csEnhanced;
    }

    /* ── build DOM ── */
    _build() {
      this.wrap = document.createElement("div");
      this.wrap.className = "cs-wrap";

      this.trigger = document.createElement("button");
      this.trigger.type = "button";
      this.trigger.className = "cs-trigger";
      this.trigger.tabIndex = 0;
      this.trigger.setAttribute("aria-haspopup", "listbox");
      this.trigger.setAttribute("aria-expanded", "false");
      this.trigger.setAttribute("aria-controls", this.listboxId);

      this.valueEl = document.createElement("span");
      this.valueEl.className = "cs-value";
      this.trigger.appendChild(this.valueEl);

      this.arrowEl = document.createElement("span");
      this.arrowEl.className = "cs-arrow";
      this.arrowEl.textContent = "▾";
      this.trigger.appendChild(this.arrowEl);

      this.panel = document.createElement("div");
      this.panel.className = "cs-panel";
      this.panel.id = this.listboxId;
      this.panel.setAttribute("role", "listbox");
      this.panel.tabIndex = -1;

      this.wrap.appendChild(this.trigger);
      this.wrap.appendChild(this.panel);

      this.el.parentNode.insertBefore(this.wrap, this.el);
      this.wrap.appendChild(this.el);

      /* events */
      this.trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        this._toggle();
      });

      this.trigger.addEventListener("keydown", (e) => this._onTriggerKeyDown(e));
      this.panel.addEventListener("keydown", (e) => this._onPanelKeyDown(e));

      this._closeHandler = (e) => {
        if (!this.wrap.contains(e.target) && !this.panel.contains(e.target)) this._close();
      };
    }

    /* ── sync options from original <select> ── */
    _sync() {
      const optEls = [...this.el.options];
      const value = this.el.value;

      /* update trigger text */
      const matched = optEls.find((o) => o.value === value);
      this.valueEl.textContent = matched ? matched.text : optEls[0]?.text || "";

      /* update trigger disabled state */
      this.trigger.disabled = this.el.disabled;

      /* rebuild panel */
      this.panel.innerHTML = "";
      optEls.forEach((opt, index) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cs-opt" + (opt.value === value ? " cs-opt-sel" : "");
        btn.textContent = opt.text;
        btn.dataset.value = opt.value;
        btn.dataset.index = String(index);
        btn.id = `${this.listboxId}-opt-${index}`;
        btn.tabIndex = -1;
        btn.setAttribute("role", "option");
        btn.setAttribute("aria-selected", opt.value === value ? "true" : "false");
        btn.addEventListener("mousedown", (e) => e.preventDefault());
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          this._select(opt.value);
        });
        this.panel.appendChild(btn);
      });

      const selectedIndex = Math.max(0, optEls.findIndex((o) => o.value === value));
      this.activeIndex = selectedIndex;
      this._syncActiveDescendant();
    }

    _select(value) {
      if (this.el.value === value) {
        this._close();
        return;
      }
      this.el.value = value;
      this.el.dispatchEvent(new Event("change", { bubbles: true }));
      this._sync();
      this._close();
    }

    _toggle() {
      if (this.panel.classList.contains("cs-open")) {
        this._close();
      } else {
        this._open();
      }
    }

    _open() {
      /* close other open panels */
      document.querySelectorAll(".cs-panel.cs-open").forEach((p) => {
        if (p !== this.panel) p.classList.remove("cs-open");
      });

      /* portal panel to body so no container can clip it */
      document.body.appendChild(this.panel);
      this.panel.classList.add("cs-open");
      this.trigger.setAttribute("aria-expanded", "true");

      this._positionPanel();
      this._focusSelectedOption();

      /* reposition on scroll / resize while open */
      this._repositionHandler = () => this._positionPanel();
      window.addEventListener("scroll", this._repositionHandler, true);
      window.addEventListener("resize", this._repositionHandler);

      document.addEventListener("mousedown", this._closeHandler);
      /* close on blur */
      this._blurHandler = () => setTimeout(() => this._close(), 120);
      this.trigger.addEventListener("blur", this._blurHandler);
    }

    _positionPanel() {
      const rect = this.trigger.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      let top, maxHeight;

      if (spaceBelow < 120 && rect.top > 160) {
        /* open upward */
        top = rect.top - Math.min(220, rect.top - 12);
        maxHeight = Math.min(220, rect.top - 12);
      } else {
        /* open downward */
        top = rect.bottom;
        maxHeight = Math.min(220, spaceBelow);
      }

      this.panel.style.position = "fixed";
      this.panel.style.top = top + "px";
      this.panel.style.left = rect.left + "px";
      this.panel.style.width = rect.width + "px";
      this.panel.style.maxHeight = maxHeight + "px";
      this.panel.style.bottom = "auto";
    }

    _close() {
      this.panel.classList.remove("cs-open");
      this.trigger.setAttribute("aria-expanded", "false");
      this.trigger.removeAttribute("aria-activedescendant");
      /* reset inline styles */
      this.panel.style.position = "";
      this.panel.style.top = "";
      this.panel.style.left = "";
      this.panel.style.minWidth = "";
      this.panel.style.maxHeight = "";
      this.panel.style.bottom = "";
      /* move back to wrap */
      this.wrap.appendChild(this.panel);

      document.removeEventListener("mousedown", this._closeHandler);
      if (this._blurHandler) {
        this.trigger.removeEventListener("blur", this._blurHandler);
      }
      if (this._repositionHandler) {
        window.removeEventListener("scroll", this._repositionHandler, true);
        window.removeEventListener("resize", this._repositionHandler);
      }
    }

    _onTriggerKeyDown(event) {
      if (this.trigger.disabled) return;
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          if (!this.panel.classList.contains("cs-open")) {
            this._open();
          } else {
            this._moveActive(1);
          }
          break;
        case "ArrowUp":
          event.preventDefault();
          if (!this.panel.classList.contains("cs-open")) {
            this._open();
          } else {
            this._moveActive(-1);
          }
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          if (this.panel.classList.contains("cs-open")) {
            this._commitActive();
          } else {
            this._open();
          }
          break;
        case "Escape":
          if (this.panel.classList.contains("cs-open")) {
            event.preventDefault();
            this._close();
          }
          break;
        default:
          break;
      }
    }

    _onPanelKeyDown(event) {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          this._moveActive(1);
          break;
        case "ArrowUp":
          event.preventDefault();
          this._moveActive(-1);
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          this._commitActive();
          break;
        case "Escape":
          event.preventDefault();
          this._close();
          this.trigger.focus();
          break;
        default:
          break;
      }
    }

    _getOptions() {
      return [...this.panel.querySelectorAll(".cs-opt")];
    }

    _moveActive(delta) {
      const options = this._getOptions();
      if (!options.length) return;
      const lastIndex = options.length - 1;
      const nextIndex = this.activeIndex < 0
        ? 0
        : Math.max(0, Math.min(lastIndex, this.activeIndex + delta));
      this.activeIndex = nextIndex;
      this._syncActiveDescendant();
      this._scrollActiveIntoView();
    }

    _commitActive() {
      const options = this._getOptions();
      const target = options[this.activeIndex];
      if (!target) return;
      this._select(target.dataset.value || "");
      this.trigger.focus();
    }

    _focusSelectedOption() {
      const selectedIndex = [...this.el.options].findIndex((o) => o.value === this.el.value);
      this.activeIndex = Math.max(0, selectedIndex);
      this._syncActiveDescendant();
      this._scrollActiveIntoView();
      this.panel.focus();
    }

    _syncActiveDescendant() {
      const options = this._getOptions();
      options.forEach((opt, index) => {
        opt.classList.toggle("cs-opt-active", index === this.activeIndex);
      });
      const active = options[this.activeIndex];
      if (active) {
        this.trigger.setAttribute("aria-activedescendant", active.id);
      } else {
        this.trigger.removeAttribute("aria-activedescendant");
      }
    }

    _scrollActiveIntoView() {
      const options = this._getOptions();
      const active = options[this.activeIndex];
      if (!active) return;
      active.scrollIntoView({ block: "nearest" });
    }
  }

  /* ── init: enhance all <select> elements ── */
  function initCustomSelects(root) {
    (root || document).querySelectorAll("select:not([data-cs-enhanced])").forEach((el) => {
      new CustomSelect(el);
    });
  }

  /* re-enhance when new selects appear (e.g. npc cards) */
  const initObserver = new MutationObserver((records) => {
    for (const rec of records) {
      for (const node of rec.addedNodes) {
        if (node.nodeType === 1) {
          if (node.matches?.("select:not([data-cs-enhanced])")) {
            new CustomSelect(node);
          } else if (node.querySelectorAll) {
            node.querySelectorAll("select:not([data-cs-enhanced])").forEach((el) => new CustomSelect(el));
          }
        }
      }
    }
  });
  initObserver.observe(document.body, { childList: true, subtree: true });

  /* auto-init: enhance selects already in DOM */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initCustomSelects());
  } else {
    initCustomSelects();
  }

  /* expose */
  function refreshAll() {
    INSTANCES.forEach((instance) => scheduleRefresh(instance));
  }

  function destroy(selectEl) {
    INSTANCE_BY_SELECT.get(selectEl)?.destroy();
  }

  window.__customSelect = { CustomSelect, initCustomSelects, refreshAll, destroy };
})();
