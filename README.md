# MOYU MVP

当前是一个可直接浏览器打开的静态前端 MVP，核心能力包括：

- `Settings` 中维护多个接口配置
- 按 `host + key` 缓存模型列表
- 从缓存模型中选择工作模型
- 创建多 NPC 会话，并指定导演模型与全局设定
- 多会话本地存储、重命名、删除、重新开始
- 聊天时由导演先调度，再决定哪些 NPC 回复

## Run

直接打开 [index.html](C:\Users\Lenovo\Desktop\moyu\index.html)。

## Structure

```text
moyu/
├─ index.html
├─ scripts/
│  ├─ core/
│  │  ├─ constants.js
│  │  ├─ helpers.js
│  │  └─ state.js
│  ├─ features/
│  │  ├─ navigation.js
│  │  ├─ settings.js
│  │  ├─ create.js
│  │  ├─ sessions.js
│  │  └─ chat.js
│  └─ bootstrap.js
├─ styles/
│  ├─ base/
│  │  ├─ variables.css
│  │  ├─ forms.css
│  │  ├─ responsive.css
│  │  └─ scrollbars.css
│  ├─ layout/
│  │  └─ shell.css
│  └─ views/
│     ├─ settings.css
│     └─ chat.css
└─ legacy/
   ├─ app.monolith.js
   └─ styles.monolith.css
```

## API contract

- `GET {host}/models`
- `POST {host}/chat/completions`

Headers:

```http
Authorization: Bearer YOUR_KEY
Content-Type: application/json
```

## Notes

- 这是浏览器直连版本，目标 API 需要允许 CORS
- `API Key` 和本地会话数据会保存在 `localStorage`
- 导演 prompt 仍然是前端逻辑内置的
