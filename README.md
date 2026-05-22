# MOYU — 模鱼空间

多 AI 聊天剧场，支持导演调度、多角色协作，浏览器直连，无需构建。

## Lighthouse

桌面端 & 移动端均可达 **四项满分**：Performance 100 · Accessibility 100 · Best Practices 100 · SEO 100

## 功能

- **导演调度** — 每轮由导演 AI 分析话题、决定发言顺序和分工，再调度各 AI 回复
- **三种会话模式**:
  - **Story** — 剧情与角色互动，导演推进场景、调度 NPC
  - **Work** — 协作分工，导演安排回答顺序和任务分配
  - **Chaos** — 自由混战，各 AI 直接并发回复，无导演干预
- **多会话管理** — 本地持久化（IndexedDB）、重命名、删除、重新开始、搜索
- **角色设定库** — 预设角色身份，创建会话时快速选用
- **Markdown 渲染** — 代码高亮（highlight.js）、表格、列表、引用、标题
- **上下文压缩** — 超出窗口时自动摘要压缩，支持手动重压缩
- **多接口配置** — 维护多组 API Host / Key，按接口缓存模型列表，灵活选配工作模型
- **按需加载** — 功能脚本懒加载，视图切换时才拉取对应模块，不阻塞主线程
- **i18n** — 简体中文 / English
- **会话导入 / 导出** — 单会话或全量 JSON，设置备份与恢复
- **文件拖放** — 拖入文件自动识别导入类型
- **移动端适配** — 响应式布局，侧栏手势，底部弹性超拖
- **差分重绘** — 流式响应只更新变化 DOM 节点，保持滚动位置
- **Service Worker** — 静态资源缓存，离线可用

## 快速开始

直接在浏览器打开 `index.html`，无需构建步骤。

目标 API 需允许浏览器跨域请求（CORS）。

## 项目结构

```
moyu/
├── index.html                       # 入口页面（所有视图 + 首屏 CSS）
├── manifest.json                    # PWA 清单
├── favicon.svg                      # 图标
├── sw.js                            # Service Worker
│
├── scripts/
│   ├── bootstrap.js                 # 启动初始化、视图解析、i18n 注入
│   ├── core/
│   │   ├── constants.js             # 常量、i18n 词典、导演 system prompt
│   │   ├── helpers.js               # 通用工具函数
│   │   └── state.js                 # 全局状态 + DOM 元素引用缓存
│   └── features/
│       ├── navigation.js            # 视图切换、脚本懒加载、侧栏手势
│       ├── settings.js              # 设置面板（接口、模型、全局选项）
│       ├── create.js                # 创建/编辑会话
│       ├── sessions.js              # 会话列表管理
│       ├── roles.js                 # 角色设定库
│       ├── chat.js                  # 聊天界面入口、发送逻辑
│       ├── chat-api.js              # API 调用、重试、错误修复
│       ├── chat-context.js          # Markdown 渲染、消息管理、差分重绘
│       ├── chat-ui.js               # 聊天 UI 行为
│       ├── chat-edit.js             # 消息编辑/删除
│       ├── chat-db.js               # IndexedDB 持久化
│       ├── chat-stream.js           # SSE 流式处理
│       ├── chat-orchestrator.js     # 导演编排逻辑
│       ├── chat-prompts.js          # 提示词构建
│       ├── chat-retrieval.js        # 上下文检索与压缩
│       ├── custom-select.js         # 自定义选择框
│       └── filedrop.js              # 拖放导入
│
├── styles/
│   ├── base/
│   │   ├── variables.css            # CSS 自定义属性
│   │   ├── forms.css                # 表单样式
│   │   ├── responsive.css           # 响应式断点
│   │   ├── scrollbars.css           # 滚动条
│   │   ├── mobile-viewport-fix.css  # 移动端视口/键盘适配
│   │   └── drop-overlay.css         # 拖放覆盖层
│   ├── layout/
│   │   └── shell.css                # 应用布局
│   └── views/
│       ├── chat.css                 # 聊天视图
│       ├── settings.css             # 设置面板
│       └── roles.css                # 角色设定
│
├── vendor/                          # 外部依赖，直接引入
└── .githooks/                       # Git hooks
```

## API 接口

兼容 OpenAI 格式：

```
GET  {host}/v1/models
POST {host}/v1/chat/completions
```

请求头：

```
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

## 版本

格式 `YYYY.M.D.RR`（年.月.日.本日修订号），每次 commit 自动递增修订号。

## 备注

- API Key 和设置保存在 `localStorage`，会话数据在 IndexedDB
- 浏览器直连，目标 API 需配置 CORS 允许跨域
- 支持 Cloudflare Workers 等反向代理绕过 CORS 限制
