"use strict";

(function () {
  var CACHE_KEY = "moyu_model_capabilities";
  var CACHE_VERSION = 2;
  var CACHE_TTL = 24 * 60 * 60 * 1000;
  var API_URL = "https://models.dev/api.json";

  var _catalog = null;
  var _fetchPromise = null;

  var ALIASES = {
    "gpt-4o": "openai/gpt-4o",
    "gpt-4o-mini": "openai/gpt-4o-mini",
    "gpt-4-turbo": "openai/gpt-4-turbo",
    "gpt-4": "openai/gpt-4",
    "gpt-3.5-turbo": "openai/gpt-3.5-turbo",
    "o1": "openai/o1",
    "o1-mini": "openai/o1-mini",
    "o1-preview": "openai/o1-preview",
    "o3": "openai/o3",
    "o3-mini": "openai/o3-mini",
    "o4-mini": "openai/o4-mini",
    "claude-sonnet-4-20250514": "anthropic/claude-sonnet-4-20250514",
    "claude-3-5-sonnet-20241022": "anthropic/claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022": "anthropic/claude-3-5-haiku-20241022",
    "claude-3-opus-20240229": "anthropic/claude-3-opus-20240229",
    "claude-3-haiku-20240307": "anthropic/claude-3-haiku-20240307",
    "gemini-2.5-pro": "google/gemini-2.5-pro",
    "gemini-2.5-flash": "google/gemini-2.5-flash",
    "gemini-2.0-flash": "google/gemini-2.0-flash",
    "gemini-1.5-pro": "google/gemini-1.5-pro",
    "gemini-1.5-flash": "google/gemini-1.5-flash",
    "deepseek-chat": "deepseek/deepseek-chat",
    "deepseek-reasoner": "deepseek/deepseek-reasoner"
  };

  var MODALITY_TYPES = ["text", "image", "audio", "video", "pdf"];

  function makeDefaultCaps() {
    var input = {};
    var output = {};
    MODALITY_TYPES.forEach(function (k) { input[k] = false; output[k] = false; });
    input.text = true;
    output.text = true;
    return {
      known: false,
      attachment: false,
      reasoning: false,
      tool_call: false,
      temperature: true,
      input: input,
      output: output
    };
  }

  function parseModel(raw) {
    var input = {};
    var output = {};
    MODALITY_TYPES.forEach(function (k) { input[k] = false; output[k] = false; });
    if (raw.modalities) {
      (raw.modalities.input || []).forEach(function (k) { if (input.hasOwnProperty(k)) input[k] = true; });
      (raw.modalities.output || []).forEach(function (k) { if (output.hasOwnProperty(k)) output[k] = true; });
    }
    return {
      known: true,
      attachment: Boolean(raw.attachment),
      reasoning: Boolean(raw.reasoning),
      tool_call: Boolean(raw.tool_call),
      temperature: raw.temperature !== false,
      input: input,
      output: output
    };
  }

  function flattenCatalog(raw) {
    var flat = {};
    Object.keys(raw).forEach(function (providerId) {
      var entry = raw[providerId];
      if (!entry || typeof entry !== "object") return;
      // Top-level model entry (flat format)
      if (entry.modalities || entry.attachment !== undefined) {
        flat[providerId] = entry;
        return;
      }
      // Provider entry with nested models: { id, models: { modelId: data } }
      if (entry.models && typeof entry.models === "object") {
        Object.keys(entry.models).forEach(function (modelId) {
          var model = entry.models[modelId];
          if (model && typeof model === "object" && (model.modalities || model.attachment !== undefined)) {
            flat[modelId] = model;
            flat[providerId + "/" + modelId] = model;
          }
        });
      }
    });
    return flat;
  }

  function loadCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var cached = JSON.parse(raw);
      if (cached.version !== CACHE_VERSION || Date.now() - cached.ts > CACHE_TTL) {
        localStorage.removeItem(CACHE_KEY);
        return null;
      }
      return cached.data;
    } catch (_) {
      return null;
    }
  }

  function saveCache(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ version: CACHE_VERSION, ts: Date.now(), data: data }));
    } catch (_) {}
  }

  function fetchCatalog() {
    if (_fetchPromise) return _fetchPromise;
    var cached = loadCache();
    if (cached) {
      _catalog = cached;
      return Promise.resolve(_catalog);
    }
    _fetchPromise = fetch(API_URL)
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (raw) {
        _catalog = flattenCatalog(raw);
        saveCache(_catalog);
        _fetchPromise = null;
        return _catalog;
      })
      .catch(function () {
        _catalog = _catalog || {};
        _fetchPromise = null;
        return _catalog;
      });
    return _fetchPromise;
  }

  function resolveModel(modelName) {
    if (!_catalog) return null;
    var name = String(modelName || "").trim();
    if (!name) return null;
    if (_catalog[name]) return _catalog[name];
    if (ALIASES[name] && _catalog[ALIASES[name]]) {
      return _catalog[ALIASES[name]];
    }
    var bareName = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
    if (_catalog[bareName]) return _catalog[bareName];
    var lowerName = name.toLowerCase();
    var lowerBareName = bareName.toLowerCase();
    var keys = Object.keys(_catalog);
    for (var i = 0; i < keys.length; i++) {
      var lowerKey = keys[i].toLowerCase();
      if (lowerKey === lowerName || lowerKey === lowerBareName || lowerKey.endsWith("/" + lowerBareName)) {
        return _catalog[keys[i]];
      }
    }
    return null;
  }

  window.getModelCapabilities = function (modelName) {
    var raw = resolveModel(modelName);
    if (raw) return parseModel(raw);
    return makeDefaultCaps();
  };

  window.modelSupportsImage = function (modelName) {
    var caps = window.getModelCapabilities(modelName);
    return caps.input.image || caps.attachment;
  };

  window.isModelCapabilityKnown = function (modelName) {
    return Boolean(resolveModel(modelName));
  };

  window.modelCapabilitiesReady = function () {
    return fetchCatalog();
  };

  window.modelSupportsToolCall = function (modelName) {
    return window.getModelCapabilities(modelName).tool_call;
  };

  window.refreshModelCapabilities = function () {
    _catalog = null;
    _fetchPromise = null;
    try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
    return fetchCatalog();
  };

  window.getWorkModelCapabilities = function () {
    var result = {};
    var configs = (window.state && window.state.settings && window.state.settings.configs) || [];
    configs.forEach(function (config) {
      (config.workModels || []).forEach(function (name) {
        if (!result[name]) {
          result[name] = window.getModelCapabilities(name);
        }
      });
    });
    return result;
  };

  fetchCatalog();
})();
