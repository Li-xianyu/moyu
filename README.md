# MOYU - 模鱼空间

一个浏览器直连的多 AI 聊天剧场，支持导演调度、多角色协作、两种会话模式。

**版本**: 26.5.10

## Features

- **导演调度** — 每轮消息由导演 AI 先分析，决定发言顺序和分工，再调度各 AI 回复
- **两种模式**:
  - **创作模式 (Story)** — 面向剧情与角色互动，导演推进场景、调度 NPC
  - **工作模式 (Work)** — 面向协作分工，导演安排回答顺序和任务分配
- **多会话管理** — 本地存储、重命名、删除、重新开始、搜索
- **Markdown 渲染** — 支持代码高亮 (highlight.js)、表格、列表、引用、标题
- **上下文压缩** — 导演上下文超阈值时自动压缩，支持手动重压缩
- **多接口配置** — 维护多组 API Host / Key，按接口缓存模型列表，灵活选择工作模型
- **i18n** — 简体中文 / English
- **聊天搜索** — 在会话列表中全文搜索消息
- **导入 / 导出** — 单个会话或全部会话的 JSON 导入导出；设置备份与恢复
- **文件拖放** — 拖入文件自动识别导入类型（设置备份或会话文件）
- **调试模式** — 结构化调试日志输出到 console
- **移动端适配** — 响应式布局，可启用 Eruda 调试控制台
- **差分重绘** — 流式响应时只更新变化节点，保持滚动位置稳定
- **代码块语言名大写** — 代码块头部语言标识始终显示为大写

## Run

直接在浏览器打开 `index.html`，无需构建步骤。

确保目标 API 允许浏览器跨域请求（CORS）。

## API Contract

```
GET  {host}/models
POST {host}/chat/completions
```

Headers:

```
Authorization: Bearer YOUR_KEY
Content-Type: application/json
```

## Structure

```
moyu/
├─ index.html                       # 入口页面
├─ scripts/
│  ├─ bootstrap.js                  # 启动初始化
│  ├─ core/
│  │  ├─ constants.js               # 常量、i18n、导演 system prompt
│  │  ├─ helpers.js                 # 通用工具函数
│  │  └─ state.js                   # 全局状态、localStorage 持久化
│  └─ features/
│     ├─ navigation.js              # 视图切换
│     ├─ settings.js                # 设置面板（接口、模型、全局选项）
│     ├─ create.js                  # 创建/编辑会话
│     ├─ sessions.js                # 会话列表管理
│     ├─ chat.js                    # 聊天界面渲染与交互
│     ├─ chat-context.js            # Markdown 渲染、流式更新、消息管理
│     ├─ chat-api.js                # API 调用、重试、修复
│     └─ filedrop.js                # 拖放导入
├─ styles/
│  ├─ base/
│  │  ├─ variables.css              # CSS 变量
│  │  ├─ forms.css                  # 表单样式
│  │  ├─ responsive.css             # 响应式
│  │  ├─ scrollbars.css             # 滚动条
│  │  ├─ mobile-viewport-fix.css    # 移动端视口修正
│  │  └─ drop-overlay.css           # 拖放覆盖层
│  ├─ layout/
│  │  └─ shell.css                  # 应用布局
│  └─ views/
│     ├─ settings.css               # 设置面板
│     └─ chat.css                   # 聊天界面
```

## Notes

- 浏览器直连版本，目标 API 需允许 CORS
- API Key 和会话数据保存在 `localStorage`
- 导演 prompt 仍为前端内置，未开放自定义
- 支持 Cloudflare Workers 作为 API 代理
