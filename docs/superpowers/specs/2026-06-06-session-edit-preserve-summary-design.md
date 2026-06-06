# 会话编辑时保留摘要设计

## 问题描述

在编辑会话时（如切换模型、修改全局设定、修改 NPC 提示词等），代码会无条件清空所有压缩相关状态，导致：
1. 摘要丢失
2. 上下文突然"爆掉"（因为没有摘要来压缩历史）
3. 之前的积累的导演记忆和对话摘要全部丢失

**问题代码位置：** `create.js:1435-1441`

```js
session.directorMemory = normalizeDirectorMemory(null);
session.directorSummary = "";
session.chatSummary = "";
session.compressedUntilMessageId = "";
session.suggestionGuide = "";
session.latestTurnBaseState = null;
session.latestTurnVariants = null;
session.chaosState = null;
```

## 解决方案

**方案：条件清空** - 只在改了全局设定或 NPC 提示词时清空摘要，改模型时保留。

### 核心逻辑

在 `saveSessionEdits` 函数中：
1. 比较新旧全局设定（`globalPrompt`）
2. 比较每个 NPC 的新旧提示词（`prompt`）
3. 根据变化类型决定是否清空摘要

### 判断条件

**清空摘要的情况：**
- 全局设定（`globalPrompt`）发生了变化
- 任何 NPC 的提示词（`prompt`）发生了变化

**保留摘要的情况：**
- 只改了模型（`directorModel` 或 NPC 的 `model`）
- 只改了模型配置（`directorConfigId` 或 NPC 的 `configId`）
- 只改了 NPC 名字（`name`）- 名字变化会在消息中更新
- 只改了其他非设定相关字段

### 实现细节

1. **保存旧设定快照**
   - 在修改 `session` 之前，保存旧的 `globalPrompt` 和每个 NPC 的旧 `prompt`

2. **比较新旧设定**
   ```js
   const globalPromptChanged = session.globalPrompt !== payload.globalPrompt;
   const npcPromptChanged = session.npcs.some((oldNpc, i) => {
     const newNpc = payload.npcs[i];
     return oldNpc && newNpc && oldNpc.prompt !== newNpc.prompt;
   });
   const shouldClearSummary = globalPromptChanged || npcPromptChanged;
   ```

3. **条件清空摘要**
   ```js
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

4. **修复状态不一致**
   - 当清空摘要时，同时清空 `compressedUntilSequence` 和 `compressionSegments`
   - 避免出现"摘要清空了但压缩标记还在"的不一致状态

### 修改文件

- `scripts/features/create.js` - 修改 `saveSessionEdits` 函数

### 测试场景

1. **只改模型** - 保留摘要，上下文不爆
2. **改全局设定** - 清空摘要，重新开始压缩
3. **改 NPC 提示词** - 清空摘要，重新开始压缩
4. **改 NPC 名字** - 保留摘要，消息中的名字会更新
5. **混合修改** - 根据是否改了设定来决定

## 验证方法

1. 创建一个有大量消息的会话
2. 手动压缩几次，确保有摘要
3. 编辑会话，只改模型
4. 保存后检查摘要是否保留
5. 继续对话，确认上下文不爆
6. 编辑会话，改全局设定
7. 保存后检查摘要是否清空
8. 继续对话，确认重新开始压缩
