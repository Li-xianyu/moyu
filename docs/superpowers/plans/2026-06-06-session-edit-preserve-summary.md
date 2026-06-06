# 会话编辑时保留摘要实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修改会话编辑保存逻辑，使其在只改模型时保留摘要，只在改了设定时清空摘要。

**Architecture:** 在 `saveSessionEdits` 函数中比较新旧设定，根据变化类型决定是否清空摘要。

**Tech Stack:** Vanilla JavaScript

---

## 文件结构

- **修改:** `scripts/features/create.js` - 修改 `saveSessionEdits` 函数

---

## 任务分解

### Task 1: 添加设定变化检测逻辑

**Files:**
- Modify: `scripts/features/create.js:1347-1461`

- [ ] **Step 1: 在 saveSessionEdits 函数开头添加变化检测代码**

在 `saveSessionEdits` 函数中，在修改 `session` 之前，添加以下代码：

```javascript
// 检测设定是否发生变化
const originalGlobalPrompt = session.globalPrompt || "";
const originalNpcPrompts = (session.npcs || []).map((npc) => npc.prompt || "");
```

- [ ] **Step 2: 在保存新设定后添加比较逻辑**

在 `session.npcs = payload.npcs.map(...)` 之后，添加以下代码：

```javascript
// 比较新旧设定
const globalPromptChanged = originalGlobalPrompt !== (payload.globalPrompt || "");
const npcPromptChanged = payload.npcs.some((newNpc, i) => {
  const oldPrompt = originalNpcPrompts[i] || "";
  const newPrompt = newNpc.prompt || "";
  return oldPrompt !== newPrompt;
});
const shouldClearSummary = globalPromptChanged || npcPromptChanged;
```

- [ ] **Step 3: 修改摘要清空逻辑**

将原来的无条件清空代码：

```javascript
session.directorMemory = normalizeDirectorMemory(null);
session.directorSummary = "";
session.chatSummary = "";
session.compressedUntilMessageId = "";
session.suggestionGuide = "";
session.latestTurnBaseState = null;
session.latestTurnVariants = null;
session.chaosState = null;
```

替换为条件清空：

```javascript
if (shouldClearSummary) {
  session.directorMemory = normalizeDirectorMemory(null);
  session.directorSummary = "";
  session.chatSummary = "";
  session.compressedUntilMessageId = "";
  session.compressionSegments = [];
  session.compressedUntilSequence = -1;
}
session.suggestionGuide = "";
session.latestTurnBaseState = null;
session.latestTurnVariants = null;
session.chaosState = null;
```

- [ ] **Step 4: 验证代码语法**

检查修改后的代码是否有语法错误。

- [ ] **Step 5: 提交代码**

```bash
git add scripts/features/create.js
git commit -m "fix: 编辑会话时根据设定变化条件清空摘要"
```

---

## 验证方法

1. **只改模型场景**
   - 创建一个有摘要的会话
   - 编辑会话，只切换模型
   - 保存后检查摘要是否保留

2. **改设定场景**
   - 创建一个有摘要的会话
   - 编辑会话，修改全局设定
   - 保存后检查摘要是否清空

3. **混合修改场景**
   - 创建一个有摘要的会话
   - 编辑会话，同时改模型和设定
   - 保存后检查摘要是否清空

---

## 注意事项

1. 确保在修改 `session` 之前保存旧设定快照
2. 比较逻辑要处理 `undefined` 和 `null` 的情况
3. 清空摘要时要同时清空 `compressionSegments` 和 `compressedUntilSequence`，避免状态不一致
4. `suggestionGuide`、`latestTurnBaseState`、`latestTurnVariants`、`chaosState` 始终清空，因为它们与当前轮次相关
