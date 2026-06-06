# 工作模式结构化提问卡片实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在工作模式下实现结构化提问卡片功能，让模型通过交互式卡片引导用户逐步分析问题。

**Architecture:** 模型返回特殊标识 `[[SKILL_START]]...[[SKILL_END]]`，代码解析后渲染为交互式卡片。用户点击选项或输入自定义内容，代码将选择发送给模型继续下一个问题。

**Tech Stack:** Vanilla JavaScript, CSS

---

## 文件结构

- **Create:** `scripts/features/chat-skill.js` - 核心逻辑
- **Modify:** `index.html` - 添加 CSS 样式和 JS 引用
- **Modify:** `scripts/features/chat-ui.js` - 修改消息渲染逻辑，支持卡片类型
- **Modify:** `scripts/features/chat-orchestrator.js` - 解析模型响应中的技能标识

---

## 任务分解

### Task 1: 创建 chat-skill.js 核心逻辑

**Files:**
- Create: `scripts/features/chat-skill.js`

- [ ] **Step 1: 创建文件并添加解析函数**

```javascript
"use strict";

// 解析模型响应中的技能标识
function parseSkillFromResponse(content) {
  if (!content || typeof content !== "string") return null;
  
  const startMatch = content.match(/\[\[SKILL_START\]\]\s*(\{[\s\S]*?\})\s*\[\[SKILL_END\]\]/);
  if (!startMatch) return null;
  
  try {
    return JSON.parse(startMatch[1]);
  } catch (e) {
    console.warn("[skill] Failed to parse skill JSON:", e);
    return null;
  }
}

// 检查流程是否完成
function isSkillComplete(content) {
  if (!content || typeof content !== "string") return false;
  return content.includes("[[SKILL_COMPLETE]]");
}

// 解析最终结果
function parseSkillResult(content) {
  if (!content || typeof content !== "string") return null;
  
  const match = content.match(/\[\[SKILL_COMPLETE\]\]\s*(\{[\s\S]*?\})\s*\[\[SKILL_COMPLETE_END\]\]/);
  if (!match) return null;
  
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    console.warn("[skill] Failed to parse skill result:", e);
    return null;
  }
}
```

- [ ] **Step 2: 添加渲染函数**

```javascript
// 渲染技能卡片
function renderSkillCard(skillData, messageId) {
  const card = document.createElement("div");
  card.className = "skill-card";
  card.dataset.messageId = messageId;
  card.dataset.skillName = skillData.skill_name;
  card.dataset.step = skillData.step;
  
  // 头部
  const header = document.createElement("div");
  header.className = "skill-card-header";
  header.innerHTML = `
    <span class="skill-card-icon">📋</span>
    <span class="skill-card-title">${escapeHtml(skillData.skill_name)}</span>
    <span class="skill-card-progress">(${skillData.step}/${skillData.total_steps})</span>
  `;
  card.appendChild(header);
  
  // 问题
  const question = document.createElement("div");
  question.className = "skill-card-question";
  question.textContent = skillData.question;
  card.appendChild(question);
  
  // 选项容器
  const optionsContainer = document.createElement("div");
  optionsContainer.className = "skill-card-options";
  
  // 选项按钮
  (skillData.options || []).forEach((option) => {
    const optionBtn = document.createElement("button");
    optionBtn.type = "button";
    optionBtn.className = "skill-card-option";
    optionBtn.dataset.optionId = option.id;
    optionBtn.textContent = option.text;
    optionBtn.addEventListener("click", () => {
      handleSkillAnswer(skillData.skill_name, skillData.step, option.id, null, messageId);
    });
    optionsContainer.appendChild(optionBtn);
  });
  
  // 自定义输入
  if (skillData.allow_custom) {
    const customContainer = document.createElement("div");
    customContainer.className = "skill-card-custom";
    
    const customInput = document.createElement("input");
    customInput.type = "text";
    customInput.className = "skill-card-custom-input";
    customInput.placeholder = "自定义输入...";
    
    const customBtn = document.createElement("button");
    customBtn.type = "button";
    customBtn.className = "skill-card-custom-btn";
    customBtn.textContent = "发送";
    customBtn.addEventListener("click", () => {
      const text = customInput.value.trim();
      if (text) {
        handleSkillAnswer(skillData.skill_name, skillData.step, "custom", text, messageId);
      }
    });
    
    customInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const text = customInput.value.trim();
        if (text) {
          handleSkillAnswer(skillData.skill_name, skillData.step, "custom", text, messageId);
        }
      }
    });
    
    customContainer.appendChild(customInput);
    customContainer.appendChild(customBtn);
    optionsContainer.appendChild(customContainer);
  }
  
  card.appendChild(optionsContainer);
  
  return card;
}

// 渲染技能结果卡片
function renderSkillResult(skillResult) {
  const card = document.createElement("div");
  card.className = "skill-card skill-card-result";
  
  // 头部
  const header = document.createElement("div");
  header.className = "skill-card-header";
  header.innerHTML = `
    <span class="skill-card-icon">✅</span>
    <span class="skill-card-title">${escapeHtml(skillResult.skill_name)} - 完成</span>
  `;
  card.appendChild(header);
  
  // 结果内容
  const content = document.createElement("div");
  content.className = "skill-card-content";
  
  const summary = skillResult.summary || {};
  const summaryHtml = Object.entries(summary)
    .map(([key, value]) => `<div class="skill-result-item"><strong>${escapeHtml(key)}:</strong> ${escapeHtml(String(value))}</div>`)
    .join("");
  
  content.innerHTML = summaryHtml || "<div>分析完成</div>";
  card.appendChild(content);
  
  return card;
}
```

- [ ] **Step 3: 添加答案处理函数**

```javascript
// 处理用户选择
function handleSkillAnswer(skillName, step, optionId, customText, messageId) {
  // 构造答案消息
  const answerData = {
    skill_name: skillName,
    step: step,
    selected_option_id: optionId,
    custom_text: customText,
    timestamp: new Date().toISOString()
  };
  
  const answerMessage = `[[SKILL_ANSWER]]\n${JSON.stringify(answerData, null, 2)}\n[[SKILL_ANSWER_END]]`;
  
  // 发送给模型
  if (typeof sendMessage === "function") {
    sendMessage(answerMessage);
  }
  
  // 锁定当前卡片
  lockSkillCard(messageId);
}

// 锁定技能卡片
function lockSkillCard(messageId) {
  const card = document.querySelector(`.skill-card[data-message-id="${messageId}"]`);
  if (!card) return;
  
  card.classList.add("skill-card-locked");
  
  // 禁用所有选项按钮
  card.querySelectorAll(".skill-card-option, .skill-card-custom-btn, .skill-card-custom-input").forEach((el) => {
    el.disabled = true;
  });
  
  // 显示选择标记
  card.querySelectorAll(".skill-card-option").forEach((el) => {
    el.addEventListener("click", (e) => e.preventDefault());
  });
}
```

- [ ] **Step 4: 提交代码**

```bash
git add scripts/features/chat-skill.js
git commit -m "feat: 添加 chat-skill.js 核心逻辑"
```

---

### Task 2: 添加 CSS 样式

**Files:**
- Modify: `index.html` (添加 CSS 样式)

- [ ] **Step 1: 在 index.html 的 style 标签中添加技能卡片样式**

在 `</style>` 标签之前添加：

```css
/* 技能卡片 */
.skill-card {
  background: var(--card-bg, #1a1a1a);
  border: 1px solid var(--border, #333);
  border-radius: 12px;
  padding: 16px;
  margin: 8px 0;
  max-width: 400px;
}

.skill-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-size: 14px;
  color: var(--text-secondary, #888);
}

.skill-card-icon {
  font-size: 16px;
}

.skill-card-title {
  font-weight: 600;
  color: var(--text-primary, #fff);
}

.skill-card-progress {
  color: var(--text-secondary, #888);
}

.skill-card-question {
  font-size: 16px;
  line-height: 1.5;
  margin-bottom: 16px;
  color: var(--text-primary, #fff);
}

.skill-card-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skill-card-option {
  background: var(--option-bg, #2a2a2a);
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  padding: 12px 16px;
  text-align: left;
  font-size: 14px;
  color: var(--text-primary, #fff);
  cursor: pointer;
  transition: all 0.2s ease;
}

.skill-card-option:hover:not(:disabled) {
  background: var(--option-hover, #3a3a3a);
  border-color: var(--accent, #4a9eff);
}

.skill-card-option:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.skill-card-custom {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.skill-card-custom-input {
  flex: 1;
  background: var(--option-bg, #2a2a2a);
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  padding: 12px 16px;
  font-size: 14px;
  color: var(--text-primary, #fff);
  outline: none;
}

.skill-card-custom-input:focus {
  border-color: var(--accent, #4a9eff);
}

.skill-card-custom-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.skill-card-custom-btn {
  background: var(--accent, #4a9eff);
  border: none;
  border-radius: 8px;
  padding: 12px 16px;
  font-size: 14px;
  color: #fff;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.skill-card-custom-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.skill-card-custom-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.skill-card-locked {
  opacity: 0.7;
  pointer-events: none;
}

.skill-card-result {
  background: var(--card-bg-success, #1a2a1a);
  border-color: var(--success, #4caf50);
}

.skill-card-content {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary, #fff);
}

.skill-result-item {
  margin-bottom: 8px;
}

.skill-result-item:last-child {
  margin-bottom: 0;
}
```

- [ ] **Step 2: 提交代码**

```bash
git add index.html
git commit -m "feat: 添加技能卡片 CSS 样式"
```

---

### Task 3: 添加 JS 引用

**Files:**
- Modify: `index.html` (添加 JS 引用)

- [ ] **Step 1: 在 index.html 中添加 chat-skill.js 引用**

在 `<script src="./scripts/features/chat-ui.js"></script>` 之前添加：

```html
<script src="./scripts/features/chat-skill.js"></script>
```

- [ ] **Step 2: 提交代码**

```bash
git add index.html
git commit -m "feat: 添加 chat-skill.js 引用"
```

---

### Task 4: 修改消息渲染逻辑

**Files:**
- Modify: `scripts/features/chat-ui.js`

- [ ] **Step 1: 在 renderMessageBubble 函数中添加技能卡片支持**

找到 `renderMessageBubble` 函数，在渲染 assistant 消息时添加技能卡片检查：

```javascript
// 在渲染 assistant 消息时检查是否包含技能
if (message.role === "assistant" && !message.uiType) {
  const skillData = typeof parseSkillFromResponse === "function" 
    ? parseSkillFromResponse(message.content) 
    : null;
  
  if (skillData) {
    // 渲染技能卡片
    const card = typeof renderSkillCard === "function"
      ? renderSkillCard(skillData, message.id)
      : null;
    if (card) {
      fragment.appendChild(card);
      continue;
    }
  }
  
  // 检查是否是流程结束
  const skillResult = typeof parseSkillResult === "function"
    ? parseSkillResult(message.content)
    : null;
  
  if (skillResult) {
    // 渲染结果卡片
    const resultCard = typeof renderSkillResult === "function"
      ? renderSkillResult(skillResult)
      : null;
    if (resultCard) {
      fragment.appendChild(resultCard);
      continue;
    }
  }
}
```

- [ ] **Step 2: 提交代码**

```bash
git add scripts/features/chat-ui.js
git commit -m "feat: 修改消息渲染逻辑支持技能卡片"
```

---

### Task 5: 添加系统提示词

**Files:**
- Modify: `scripts/features/chat-prompts.js` (或工作模式的系统提示词文件)

- [ ] **Step 1: 在工作模式系统提示词中添加结构化提问技能说明**

在工作模式的系统提示词中添加：

```
## 结构化提问技能

当你需要引导用户逐步分析问题时，可以使用结构化提问技能。

### 使用场景
- 需求分析
- 方案设计
- 问题排查
- 情感分析
- 任何需要逐步引导用户思考的场景

### 格式要求
使用以下格式发起提问：

[[SKILL_START]]
{
  "type": "structured_question",
  "skill_name": "技能名称",
  "question": "当前问题",
  "options": [
    {"id": "opt1", "text": "选项1"},
    {"id": "opt2", "text": "选项2"},
    {"id": "opt3", "text": "选项3"}
  ],
  "allow_custom": true,
  "step": 1,
  "total_steps": 5,
  "context": {}
}
[[SKILL_END]]

### 规则
1. 最多 5 个问题
2. 每次提供 3 个选项 + 可选的自定义输入
3. 问题要逐步深入，从宏观到微观
4. 每个问题只问一件事
5. 选项要互斥且覆盖主要情况

### 结束格式
当所有问题回答完毕，使用以下格式返回结果：

[[SKILL_COMPLETE]]
{
  "skill_name": "技能名称",
  "summary": {
    "key1": "value1",
    "key2": "value2"
  }
}
[[SKILL_COMPLETE_END]]
```

- [ ] **Step 2: 提交代码**

```bash
git add scripts/features/chat-prompts.js
git commit -m "feat: 添加结构化提问技能系统提示词"
```

---

## 验证方法

1. **基础流程测试**
   - 创建一个工作模式会话
   - 发送 "帮我分析一下这个需求"
   - 检查模型是否返回结构化提问卡片
   - 点击选项，检查是否正确发送答案
   - 完成所有问题，检查是否显示结果

2. **自定义输入测试**
   - 在卡片中选择自定义输入
   - 输入自定义内容
   - 检查是否正确发送

3. **样式测试**
   - 检查卡片样式是否正确
   - 检查悬停效果
   - 检查响应式布局

4. **边界情况测试**
   - 测试中断流程
   - 测试重复点击
   - 测试无效输入
