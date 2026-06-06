# 模型能力判断实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于 models.dev 数据库为 moyu 添加模型能力检测，让 UI 能根据当前模型支持的能力（视觉、工具调用等）动态调整功能显示。

**Architecture:** 新建 `model-capabilities.js` 模块，从 models.dev 拉取模型目录并缓存到 localStorage，提供全局 `getModelCapabilities(modelName)` 查询函数。匹配逻辑采用「包含+别名」策略处理 API 返回的模型名与 models.dev ID 不完全一致的问题。后续图片附件按钮等功能依赖此模块判断是否启用。

**Tech Stack:** vanilla JS, localStorage, models.dev API, globals 通信

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `scripts/features/model-capabilities.js` (新建) | 拉取 models.dev、缓存、查询、别名映射 |
| `scripts/features/settings.js` (修改) | 拉取模型列表时同步更新能力缓存 |
| `scripts/features/chat-stream.js` (修改) | 发送前检查模型能力，过滤不支持的媒体 |
| `index.html` (修改) | script 标签引入新模块 |

---

### Task 1: 创建 model-capabilities.js 核心模块

**Files:**
- Create: `scripts/features/model-capabilities.js`

- [ ] **Step 1: 创建文件，写入 models.dev 数据结构定义和常量**

```js
/* model-capabilities.js — 模型能力检测 (models.dev) */
(function () {
  "use strict";

  var MODELS_DEV_URL = "https://models.dev/api.json";
  var CACHE_KEY = "moyu_model_capabilities";
  var CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

  /* ---------- 别名映射：API 返回的模型名 → models.dev ID ---------- */
  var ALIASES = {
    // OpenAI
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
    // Anthropic
    "claude-sonnet-4-20250514": "anthropic/claude-sonnet-4-20250514",
    "claude-3-5-sonnet-20241022": "anthropic/claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022": "anthropic/claude-3-5-haiku-20241022",
    "claude-3-opus-20240229": "anthropic/claude-3-opus-20240229",
    "claude-3-haiku-20240307": "anthropic/claude-3-haiku-20240307",
    // Google
    "gemini-2.5-pro": "google/gemini-2.5-pro",
    "gemini-2.5-flash": "google/gemini-2.5-flash",
    "gemini-2.0-flash": "google/gemini-2.0-flash",
    "gemini-1.5-pro": "google/gemini-1.5-pro",
    "gemini-1.5-flash": "google/gemini-1.5-flash",
    // DeepSeek
    "deepseek-chat": "deepseek/deepseek-chat",
    "deepseek-reasoner": "deepseek/deepseek-reasoner",
  };

  var _catalog = null;  // { modelId: capabilitiesObject, ... }
  var _fetching = null; // Promise (dedup concurrent fetches)

  /* ---------- 默认能力 (未知模型 fallback) ---------- */
  var DEFAULT_CAPS = {
    attachment: false,
    reasoning: false,
    tool_call: false,
    temperature: false,
    input: { text: true, image: false, audio: false, video: false, pdf: false },
    output: { text: true, image: false, audio: false, video: false, pdf: false },
  };
```

- [ ] **Step 2: 写入缓存读写函数**

```js
  /* ---------- 缓存 ---------- */
  function loadCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (Date.now() - obj.ts > CACHE_TTL) return null;
      return obj.data;
    } catch (_) {
      return null;
    }
  }

  function saveCache(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: data }));
    } catch (_) {}
  }
```

- [ ] **Step 3: 写入 models.dev 拉取和解析逻辑**

```js
  /* ---------- 拉取 models.dev ---------- */
  function parseModelsDev(raw) {
    var catalog = {};
    // raw 是一个对象，key 是 modelId (如 "openai/gpt-4o")
    var modelIds = Object.keys(raw);
    for (var i = 0; i < modelIds.length; i++) {
      var id = modelIds[i];
      var m = raw[id];
      if (!m) continue;
      var modalities = m.modalities || {};
      catalog[id] = {
        attachment: !!m.attachment,
        reasoning: !!m.reasoning,
        tool_call: !!m.tool_call,
        temperature: m.temperature !== false, // 默认 true
        input: {
          text: (modalities.input || []).indexOf("text") !== -1,
          image: (modalities.input || []).indexOf("image") !== -1,
          audio: (modalities.input || []).indexOf("audio") !== -1,
          video: (modalities.input || []).indexOf("video") !== -1,
          pdf: (modalities.input || []).indexOf("pdf") !== -1,
        },
        output: {
          text: (modalities.output || []).indexOf("text") !== -1,
          image: (modalities.output || []).indexOf("image") !== -1,
          audio: (modalities.output || []).indexOf("audio") !== -1,
          video: (modalities.output || []).indexOf("video") !== -1,
          pdf: (modalities.output || []).indexOf("pdf") !== -1,
        },
      };
    }
    return catalog;
  }

  async function fetchCatalog() {
    if (_catalog) return _catalog;
    var cached = loadCache();
    if (cached) { _catalog = cached; return _catalog; }
    if (_fetching) return _fetching;

    _fetching = fetch(MODELS_DEV_URL)
      .then(function (res) { return res.json(); })
      .then(function (raw) {
        var catalog = parseModelsDev(raw);
        saveCache(catalog);
        _catalog = catalog;
        _fetching = null;
        return _catalog;
      })
      .catch(function (err) {
        console.warn("[model-capabilities] fetch failed:", err);
        _fetching = null;
        return {};
      });

    return _fetching;
  }
```

- [ ] **Step 4: 写入模型名匹配逻辑和全局 API**

```js
  /* ---------- 匹配：API 模型名 → models.dev ID ---------- */
  function resolveModelId(modelName) {
    if (!modelName) return null;
    var name = modelName.trim();

    // 1. 精确匹配 (已经带前缀如 "openai/gpt-4o")
    if (_catalog && _catalog[name]) return name;

    // 2. 别名映射
    if (ALIASES[name]) return ALIASES[name];

    // 3. 后缀匹配：在 catalog 里找 ID 以 "/{modelName}" 结尾的
    if (_catalog) {
      var ids = Object.keys(_catalog);
      for (var i = 0; i < ids.length; i++) {
        if (ids[i].endsWith("/" + name)) return ids[i];
      }
    }

    return null;
  }

  /* ---------- 公开 API ---------- */

  /**
   * 查询模型能力
   * @param {string} modelName - 模型名 (如 "gpt-4o", "openai/gpt-4o")
   * @returns {object} 能力对象，未知模型返回 DEFAULT_CAPS
   */
  window.getModelCapabilities = function (modelName) {
    var id = resolveModelId(modelName);
    if (id && _catalog && _catalog[id]) return _catalog[id];
    return Object.assign({}, DEFAULT_CAPS);
  };

  /**
   * 模型是否支持图片输入
   */
  window.modelSupportsImage = function (modelName) {
    return window.getModelCapabilities(modelName).input.image;
  };

  /**
   * 模型是否支持工具调用
   */
  window.modelSupportsToolCall = function (modelName) {
    return window.getModelCapabilities(modelName).tool_call;
  };

  /**
   * 手动刷新能力缓存 (settings 页面可调用)
   */
  window.refreshModelCapabilities = function () {
    _catalog = null;
    localStorage.removeItem(CACHE_KEY);
    return fetchCatalog();
  };

  /**
   * 获取当前活动配置的所有工作模型的能力概况
   * @returns {object} { modelName: capabilities, ... }
   */
  window.getWorkModelCapabilities = function () {
    var caps = {};
    var configs = window.state && window.state.settings && window.state.settings.configs;
    if (!configs) return caps;
    for (var i = 0; i < configs.length; i++) {
      var wm = configs[i].workModels || [];
      for (var j = 0; j < wm.length; j++) {
        caps[wm[j]] = window.getModelCapabilities(wm[j]);
      }
    }
    return caps;
  };

  // 启动时静默拉取
  fetchCatalog();
})();
```

- [ ] **Step 5: 验证文件语法正确**

在浏览器控制台测试（打开 index.html 后）：
```js
// 等几秒让 fetch 完成
await new Promise(r => setTimeout(r, 2000));
getModelCapabilities("gpt-4o")
// 应返回 { attachment: true, input: { text: true, image: true, ... }, ... }
getModelCapabilities("unknown-model-xyz")
// 应返回 DEFAULT_CAPS (input.image = false)
```

- [ ] **Step 6: Commit**

```bash
git add scripts/features/model-capabilities.js
git commit -m "feat: 模型能力检测模块，基于 models.dev"
```

---

### Task 2: 在 index.html 引入新模块

**Files:**
- Modify: `index.html`

- [ ] **Step 1: 在 chat runtime 脚本组中添加 model-capabilities.js**

找到 `navigation.js` 中 chat runtime 的脚本列表（搜索 `chat-retrieval.js`），在 `chat-stream.js` **之前**添加 `model-capabilities.js`。这样 `streamChatCompletion` 执行时能力数据已就绪。

```js
// navigation.js 中 chatRuntimeScripts 数组，添加一行：
"scripts/features/model-capabilities.js",
```

- [ ] **Step 2: 验证加载**

打开 index.html，开一个新会话发一条消息，在 Network 面板确认 `model-capabilities.js` 被加载，控制台执行 `window.getModelCapabilities("gpt-4o")` 返回正确结果。

- [ ] **Step 3: Commit**

```bash
git add index.html scripts/features/navigation.js
git commit -m "feat: 引入 model-capabilities 模块到 chat runtime"
```

---

### Task 3: 设置页面显示模型能力标签

**Files:**
- Modify: `scripts/features/settings.js` (renderWorkModels 函数附近)
- Modify: `styles/views/settings.css` (新增能力标签样式)

- [ ] **Step 1: 在 renderWorkModels 中为每个模型名后面追加能力小标签**

在 `settings.js` 的 `renderWorkModels()` 函数中，渲染每个模型条目时，调用 `getModelCapabilities(modelName)` 获取能力，在模型名后面追加小图标标签：
- 支持图片 → 显示 📷 小标签
- 支持工具 → 显示 🔧 小标签
- 支持推理 → 显示 🧠 小标签

```js
// 在 renderWorkModels 的模型名渲染处追加：
var caps = window.getModelCapabilities ? window.getModelCapabilities(name) : null;
if (caps) {
  var tags = [];
  if (caps.input.image) tags.push('<span class="model-cap-tag" title="支持图片">📷</span>');
  if (caps.tool_call) tags.push('<span class="model-cap-tag" title="工具调用">🔧</span>');
  if (caps.reasoning) tags.push('<span class="model-cap-tag" title="推理模式">🧠</span>');
  // 在模型名 span 后面插入
}
```

- [ ] **Step 2: 添加能力标签 CSS**

```css
/* settings.css */
.model-cap-tag {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  margin-left: 4px;
  opacity: 0.6;
}
```

- [ ] **Step 3: 验证**

打开设置页面 → 工作模型列表，确认每个模型名后面显示对应的能力小标签。

- [ ] **Step 4: Commit**

```bash
git add scripts/features/settings.js styles/views/settings.css
git commit -m "feat: 设置页面显示模型能力标签"
```

---

### Task 4: 发送前过滤不支持的媒体 (防御层)

**Files:**
- Modify: `scripts/features/chat-stream.js` (streamChatCompletion 函数)

- [ ] **Step 1: 在 streamChatCompletion 构建 messages 时，过滤不支持的图片**

在 `streamChatCompletion()` 构建请求 body 之前，对 messages 数组做一轮过滤：如果模型不支持图片输入，把 `content` 为数组且包含 `image_url` 类型的部分替换为文本错误提示。

```js
// 在 streamChatCompletion 的 body 构建前添加：
function filterUnsupportedMedia(messages, modelName) {
  var caps = window.getModelCapabilities ? window.getModelCapabilities(modelName) : null;
  if (!caps) return messages;

  return messages.map(function (msg) {
    if (msg.role !== "user" || !Array.isArray(msg.content)) return msg;

    var filtered = msg.content.map(function (part) {
      if (part.type === "image_url") {
        if (!caps.input.image) {
          return { type: "text", text: "⚠️ 当前模型不支持图片输入，已忽略该图片。" };
        }
      }
      return part;
    });

    return Object.assign({}, msg, { content: filtered });
  });
}

// 在 streamChatCompletion 中构建 body 前调用：
messages = filterUnsupportedMedia(messages, model);
```

- [ ] **Step 2: 验证**

选择一个不支持图片的模型（如 deepseek-chat），如果未来有图片附件功能，发送带图片的消息应自动忽略图片并显示提示文本。

- [ ] **Step 3: Commit**

```bash
git add scripts/features/chat-stream.js
git commit -m "feat: 发送前过滤模型不支持的媒体类型"
```

---

### Task 5: 全局类型提示 (可选但推荐)

**Files:**
- Modify: `scripts/core/state.js` (顶部注释区)

- [ ] **Step 1: 在 state.js 顶部添加 JSDoc 类型提示**

```js
/**
 * @typedef {object} ModelCapabilities
 * @property {boolean} attachment
 * @property {boolean} reasoning
 * @property {boolean} tool_call
 * @property {boolean} temperature
 * @property {{ text: boolean, image: boolean, audio: boolean, video: boolean, pdf: boolean }} input
 * @property {{ text: boolean, image: boolean, audio: boolean, video: boolean, pdf: boolean }} output
 */

/**
 * @returns {ModelCapabilities}
 */
window.getModelCapabilities = window.getModelCapabilities || function () { return {}; };
window.modelSupportsImage = window.modelSupportsImage || function () { return false; };
```

- [ ] **Step 2: Commit**

```bash
git add scripts/core/state.js
git commit -m "chore: 添加模型能力类型提示"
```

---

## 验证清单

1. ✅ 控制台执行 `getModelCapabilities("gpt-4o")` 返回正确能力对象
2. ✅ `getModelCapabilities("不存在的模型")` 返回全 false 默认值
3. ✅ 设置页面工作模型列表显示 📷/🔧/🧠 标签
4. ✅ `window.modelSupportsImage("gpt-4o")` 返回 true
5. ✅ `window.modelSupportsImage("deepseek-chat")` 返回 false
6. ✅ 缓存 24h 有效，不重复拉取
7. ✅ localStorage 缓存可在控制台查看
