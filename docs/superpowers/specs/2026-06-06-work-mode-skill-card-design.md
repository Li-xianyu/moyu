# 工作模式结构化提问卡片设计

## 概述

在工作模式下，模型可以通过结构化提问来辅助用户分析问题、理清思路。模型返回特殊标识，代码解析后渲染为交互式卡片，用户通过点击选项或自定义输入来回答问题。

## 使用场景

- 需求分析
- 方案设计
- 问题排查
- 情感分析
- 任何需要逐步引导用户思考的场景

## 触发方式

1. **自动触发**：模型判断当前对话适合用结构化提问时自动触发
2. **命令触发**：用户输入 `/skill` 或类似命令手动触发

## 消息格式约定

### 模型返回格式

模型返回的消息中包含特殊标识：

```
一些前缀文字...

[[SKILL_START]]
{
  "type": "structured_question",
  "skill_name": "需求分析",
  "question": "你想分析什么类型的需求？",
  "options": [
    {"id": "opt1", "text": "新功能需求"},
    {"id": "opt2", "text": "优化需求"},
    {"id": "opt3", "text": "Bug修复需求"}
  ],
  "allow_custom": true,
  "step": 1,
  "total_steps": 5,
  "context": {
    "previous_answers": [],
    "analysis_target": "用户的需求"
  }
}
[[SKILL_END]]
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| type | string | 固定为 "structured_question" |
| skill_name | string | 技能名称，如 "需求分析"、"方案设计" |
| question | string | 当前问题 |
| options | array | 3 个选项，每个包含 id 和 text |
| allow_custom | boolean | 是否允许自定义输入 |
| step | number | 当前步骤（从 1 开始） |
| total_steps | number | 总步骤数（最多 5） |
| context | object | 上下文信息，包含之前的答案等 |

### 用户选择格式

用户选择后，代码发送给模型的消息格式：

```
[[SKILL_ANSWER]]
{
  "skill_name": "需求分析",
  "step": 1,
  "selected_option_id": "opt1",
  "custom_text": null,
  "timestamp": "2026-06-06T12:00:00Z"
}
[[SKILL_ANSWER_END]]
```

### 流程结束标识

当所有问题回答完毕，模型返回最终结果时：

```
[[SKILL_COMPLETE]]
{
  "skill_name": "需求分析",
  "summary": {
    "需求类型": "新功能需求",
    "核心目标": "提升用户体验",
    "优先级": "高",
    "建议方案": "..."
  }
}
[[SKILL_COMPLETE_END]]
```

## 卡片 UI 设计

### 卡片结构

```
┌─────────────────────────────────────┐
│ 📋 需求分析 (1/5)                    │
├─────────────────────────────────────┤
│ 你想分析什么类型的需求？              │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ ○ 新功能需求                     │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ ○ 优化需求                      │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ ○ Bug修复需求                   │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ ✏️ 自定义输入...                 │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

### 状态

- **active**：等待用户选择
- **completed**：用户已选择，显示选择结果
- **locked**：已锁定，不可再修改

### 样式

- 使用现有的 CSS 变量体系
- 卡片背景：`var(--card-bg, #1a1a1a)`
- 选项背景：`var(--option-bg, #2a2a2a)`
- 选项悬停：`var(--option-hover, #3a3a3a)`
- 选中状态：`var(--option-selected, #4a9eff)`

## 代码实现

### 新增文件

- `scripts/features/chat-skill.js` - 核心逻辑

### 修改文件

- `index.html` - 添加 CSS 样式和 JS 引用
- `scripts/features/chat-ui.js` - 修改消息渲染逻辑，支持卡片类型
- `scripts/features/chat-orchestrator.js` - 解析模型响应中的技能标识

### 核心函数

```javascript
// 解析模型响应中的技能标识
function parseSkillFromResponse(content) {
  const startMatch = content.match(/\[\[SKILL_START\]\]\s*(\{[\s\S]*?\})\s*\[\[SKILL_END\]\]/);
  if (!startMatch) return null;
  
  try {
    return JSON.parse(startMatch[1]);
  } catch (e) {
    return null;
  }
}

// 渲染技能卡片
function renderSkillCard(skillData, messageId) {
  // 创建卡片 DOM
  // 绑定事件监听
  // 返回卡片元素
}

// 处理用户选择
function handleSkillAnswer(skillName, step, optionId, customText) {
  // 构造答案消息
  // 发送给模型
  // 继续下一个问题
}

// 检查流程是否完成
function isSkillComplete(content) {
  return content.includes('[[SKILL_COMPLETE]]');
}

// 解析最终结果
function parseSkillResult(content) {
  const match = content.match(/\[\[SKILL_COMPLETE\]\]\s*(\{[\s\S]*?\})\s*\[\[SKILL_COMPLETE_END\]\]/);
  if (!match) return null;
  
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    return null;
  }
}
```

### 消息渲染修改

在 `chat-ui.js` 的消息渲染函数中，添加对技能卡片的支持：

```javascript
// 在渲染 assistant 消息时检查是否包含技能
if (message.role === 'assistant') {
  const skillData = parseSkillFromResponse(message.content);
  if (skillData) {
    // 渲染技能卡片
    const card = renderSkillCard(skillData, message.id);
    container.appendChild(card);
    return;
  }
  
  // 检查是否是流程结束
  const skillResult = parseSkillResult(message.content);
  if (skillResult) {
    // 渲染结果卡片
    const resultCard = renderSkillResult(skillResult);
    container.appendChild(resultCard);
    return;
  }
}
```

## Prompt 设计

### 系统提示词片段

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

## 测试场景

1. **基础流程**
   - 发送 "帮我分析一下这个需求"
   - 模型返回结构化提问卡片
   - 用户选择选项
   - 继续下一个问题
   - 完成后显示结果

2. **自定义输入**
   - 用户选择自定义输入
   - 输入自定义内容
   - 继续下一个问题

3. **中断流程**
   - 用户在中途发送普通消息
   - 模型应该能正常处理

4. **命令触发**
   - 用户输入 `/skill`
   - 模型发起结构化提问

## 验证方法

1. 创建一个工作模式会话
2. 发送需要分析的消息
3. 检查模型是否返回结构化提问卡片
4. 点击选项，检查是否正确发送答案
5. 完成所有问题，检查是否显示结果
6. 检查样式是否正确
