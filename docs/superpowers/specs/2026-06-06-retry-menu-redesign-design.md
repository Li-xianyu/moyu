# 重试菜单重新设计

## 概述

优化 AI 回复消息底部重试按钮的弹出菜单，使其更紧凑、协调。

## 当前状态

### 问题
1. 菜单尺寸过大（宽度 218px，选项高度 48px）
2. 包含提示文字（`<small>` 标签），视觉上不够简洁
3. 图标为蓝色（`var(--theme-accent)`），与整体风格不协调

### 当前实现
- **文件**: `scripts/features/chat-ui.js`
- **行号**: 第 1764-1815 行
- **菜单结构**: 每个选项包含图标 + 标题 + 提示文字

## 设计方案

### 目标
1. 缩小菜单尺寸，使其更紧凑
2. 去掉提示文字，只保留四字标题
3. 图标改为黑色

### 具体改动

#### 1. 修改菜单尺寸（CSS）
**文件**: `styles/views/chat.css`

| 选择器 | 当前值 | 新值 | 说明 |
|--------|--------|------|------|
| `.message-retry-menu` | `width: 218px` | `width: 160px` | 缩小菜单宽度 |
| `.message-retry-option` | `min-height: 48px` | `min-height: 36px` | 缩小选项高度 |

#### 2. 修改图标颜色（CSS）
**文件**: `styles/views/chat.css`

| 选择器 | 当前值 | 新值 | 说明 |
|--------|--------|------|------|
| `.message-retry-option-icon` | `color: var(--theme-accent)` | `color: var(--theme-text-primary)` | 图标改为黑色 |

#### 3. 去掉提示文字（JavaScript）
**文件**: `scripts/features/chat-ui.js`

| 行号 | 当前代码 | 新代码 | 说明 |
|------|----------|--------|------|
| 1798-1803 | 包含 `<small>${item.hint}</small>` | 移除 `<small>` 标签 | 去掉提示文字 |

### 修改后的菜单结构
```javascript
option.innerHTML = `
  <i data-lucide="${item.icon}" class="message-retry-option-icon"></i>
  <span class="message-retry-option-copy">
    <strong>${item.label}</strong>
  </span>
`;
```

## 视觉效果

### 修改前
- 菜单宽度：218px
- 选项高度：48px
- 包含提示文字
- 图标为蓝色

### 修改后
- 菜单宽度：160px
- 选项高度：36px
- 只保留标题文字
- 图标为黑色

## 影响范围

- **CSS 文件**: `styles/views/chat.css`
- **JavaScript 文件**: `scripts/features/chat-ui.js`
- **功能**: 重试菜单的显示和交互逻辑不变

## 验证方法

1. 打开聊天界面，发送一条消息
2. 等待 AI 回复
3. 点击重试按钮，检查菜单：
   - 菜单尺寸是否缩小
   - 是否只显示标题文字
   - 图标是否为黑色
4. 测试菜单的打开/关闭功能
5. 测试三个选项的点击功能

## 风险评估

- **低风险**: 只涉及 UI 样式和结构改动，不影响核心功能
- **兼容性**: 不涉及 API 变更，不影响其他功能
