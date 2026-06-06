# 重试菜单重新设计实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化 AI 回复消息底部重试按钮的弹出菜单，使其更紧凑、协调

**Architecture:** 修改 CSS 样式缩小菜单尺寸，修改 JavaScript 去掉提示文字，调整图标颜色

**Tech Stack:** vanilla JS, CSS

---

### Task 1: 修改 CSS 样式 - 缩小菜单尺寸

**Files:**
- Modify: `styles/views/chat.css:831-850`

- [ ] **Step 1: 修改菜单宽度**

```css
.message-retry-menu {
  position: absolute;
  right: -6px;
  bottom: calc(100% + 9px);
  z-index: 24;
  width: 160px; /* 原值 218px */
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 12px;
  display: grid;
  gap: 3px;
  background: var(--panel-strong);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.3);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateY(5px) scale(0.98);
  transform-origin: right bottom;
  transition: opacity 0.14s ease, transform 0.14s ease, visibility 0.14s ease;
}
```

- [ ] **Step 2: 修改选项高度**

```css
.message-retry-option {
  width: 100%;
  min-height: 36px; /* 原值 48px */
  padding: 7px 9px;
  border: 0;
  border-radius: 8px;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  text-align: left;
  background: transparent;
  color: var(--theme-text-primary);
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}
```

- [ ] **Step 3: 修改图标颜色**

```css
.message-retry-option-icon {
  width: 17px;
  height: 17px;
  color: var(--theme-text-primary); /* 原值 var(--theme-accent) */
}
```

- [ ] **Step 4: 删除提示文字样式**

删除以下代码（第 909-913 行）：

```css
.message-retry-option-copy small {
  color: var(--muted);
  font-size: 10px;
  line-height: 1.35;
}
```

- [ ] **Step 5: 验证 CSS 修改**

在浏览器中打开聊天界面，点击重试按钮，检查菜单：
- 菜单宽度是否缩小到 160px
- 选项高度是否缩小到 36px
- 图标是否为黑色

### Task 2: 修改 JavaScript - 去掉提示文字

**Files:**
- Modify: `scripts/features/chat-ui.js:1798-1803`

- [ ] **Step 1: 修改菜单选项 HTML 结构**

将第 1798-1803 行的代码：

```javascript
option.innerHTML = `
  <i data-lucide="${item.icon}" class="message-retry-option-icon"></i>
  <span class="message-retry-option-copy">
    <strong>${item.label}</strong>
    <small>${item.hint}</small>
  </span>
`;
```

修改为：

```javascript
option.innerHTML = `
  <i data-lucide="${item.icon}" class="message-retry-option-icon"></i>
  <span class="message-retry-option-copy">
    <strong>${item.label}</strong>
  </span>
`;
```

- [ ] **Step 2: 验证 JavaScript 修改**

在浏览器中打开聊天界面，点击重试按钮，检查菜单：
- 是否只显示标题文字（更加简洁、更加详细、重试一次）
- 是否不再显示提示文字

### Task 3: 完整功能测试

**Files:**
- None (测试任务)

- [ ] **Step 1: 测试菜单打开/关闭**

1. 打开聊天界面
2. 发送一条消息
3. 等待 AI 回复
4. 点击重试按钮，验证菜单打开
5. 点击菜单外部，验证菜单关闭
6. 再次点击重试按钮，验证菜单打开
7. 按 Escape 键，验证菜单关闭

- [ ] **Step 2: 测试菜单选项功能**

1. 点击重试按钮打开菜单
2. 点击「更加简洁」选项，验证功能正常
3. 等待新的 AI 回复
4. 点击重试按钮打开菜单
5. 点击「更加详细」选项，验证功能正常
6. 等待新的 AI 回复
7. 点击重试按钮打开菜单
8. 点击「重试一次」选项，验证功能正常

- [ ] **Step 3: 测试视觉效果**

1. 检查菜单尺寸是否合适
2. 检查图标颜色是否为黑色
3. 检查文字是否清晰可读
4. 检查菜单是否与整体界面协调

- [ ] **Step 4: 提交代码**

```bash
git add styles/views/chat.css scripts/features/chat-ui.js
git commit -m "feat: 优化重试菜单样式，缩小尺寸并去掉提示文字"
```
