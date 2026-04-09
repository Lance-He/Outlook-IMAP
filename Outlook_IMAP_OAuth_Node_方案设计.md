# Outlook IMAP OAuth 多邮箱采集器方案设计

## 1. 结论先说

这个项目可以直接用 `Node.js` 做后端，而且很适合。

原因很直接：

1. 你的核心需求是本地工具型 Web 程序，不是重型分布式系统。
2. 后端需要做的事情很明确：批量导入、OAuth 刷新 token、IMAP 拉取、调度、邮件原文存储、前端 API。
3. 后期你还要打包成可执行软件，`Node.js + React + Electron` 这一套衔接最顺。

当前更推荐的首版技术路线：

- 前端：`React + Vite`
- 后端：`Node.js 20+ + TypeScript + Fastify`
- IMAP：`imapflow`
- 邮件解析：`mailparser`
- 存储：`SQLite + better-sqlite3`
- 打包：`Electron`

不建议首版上太重的服务化架构，也不建议一开始追求云端部署、多用户权限、远程管理。


## 2. 一个非常关键的判断

你现在定义的导入格式是：

```text
邮箱----密码----client_id----refresh_token
```

这 4 段里，真正决定 Outlook IMAP OAuth 能不能工作的核心字段其实是：

```text
邮箱 + client_id + refresh_token
```

`密码` 在 OAuth 主链路里通常不是核心认证字段。

更准确地说：

1. 后端会先用 `client_id + refresh_token` 去微软 token endpoint 换取 `access_token`
2. 再用 `邮箱 + access_token` 通过 IMAP 的 `XOAUTH2` 登录
3. 登录成功后才能去打开 `INBOX` 并拉取邮件

所以首版方案建议：

- 保留 `密码` 字段，兼容你的固定输入格式
- 但后端主逻辑不要依赖它进行 IMAP 登录
- 如果后续确认它没有业务价值，导入后不要明文长期保存


## 3. 目标产品的 MVP 边界

第一版只做最重要的 5 个能力：

1. 批量导入 Outlook IMAP OAuth 邮箱
2. 逐条验证每个邮箱是否真的可拉取
3. 每个邮箱独立启停自动拉取，并设置拉取间隔
4. 后端检测到新邮件后，自动推送到网页并刷新列表
5. 查看原始邮件内容，确保“原版邮件”可追溯

第一版明确不做：

- 回复邮件
- 删除邮件
- 发件箱管理
- 多文件夹完整同步
- 附件上传下载管理
- 团队协作和多用户权限
- 云端托管版


## 4. 推荐总体架构

### 4.1 架构形态

推荐使用“本地单机应用 + 内嵌后端 + Web 前端”的结构：

```text
┌──────────────────────────────┐
│ Electron 桌面壳              │
│  ├── React 前端              │
│  └── Node/Fastify 本地 API   │
└─────────────┬────────────────┘
              │
              ├── OAuth Token Service
              ├── IMAP Pull Service
              ├── Scheduler
              ├── Event Push Service
              ├── Mail Parser
              ├── SQLite
              └── 本地 .eml 原始邮件存储
```

如果暂时不打包桌面端，也可以先按普通 Web 项目开发：

```text
React 前端 <-> Fastify API <-> SQLite + 本地邮件文件目录
```

后面再挂进 Electron，业务核心不用重写。


### 4.2 为什么不建议首版做成“前端自己 setInterval 拉信”

因为这会带来几个问题：

1. 页面刷新后状态容易乱
2. 页面隐藏或打包成桌面端后行为不一致
3. 多邮箱并发控制会失控
4. 错误重试、暂停、恢复都不好做

更合理的方式是：

- 前端只做配置和展示
- 后端统一管理调度
- 每个邮箱的自动拉取都由后端 worker 执行


### 4.3 为什么推荐“后端统一调度 + 实时推送到前端”

你刚补的这个方向是对的，而且比“前端点同步”更贴合产品定位。

推荐主链路：

```text
后端调度器轮询各邮箱
  -> 发现新邮件
  -> 写入 SQLite 和 .eml
  -> 广播事件给前端
  -> 当前打开的网页自动刷新对应账户和邮件列表
```

这样做的好处：

1. 用户不用手动点同步，体验更像真正的“接收器”
2. 前端状态更干净，不承担调度责任
3. 后期打包成 Electron 后行为更一致
4. 新邮件、账号状态变化、同步失败都可以统一推送

首版更推荐使用 `SSE`，不是 `WebSocket`。

原因：

1. 你的核心是后端单向推送到前端
2. `SSE` 实现更轻，浏览器原生支持
3. 自动重连更省心
4. 这类“邮件到达通知 + 状态刷新”场景不需要双向实时交互

只有后续你想做更复杂的双向控制台，再考虑 `WebSocket`。


## 5. 核心模块划分

### 5.1 前端模块

1. 账户列表区
2. 批量导入弹窗
3. 导入校验结果弹窗
4. 当前邮箱邮件列表
5. 邮件详情区
6. 原始邮件视图区
7. 系统配置区


### 5.2 后端模块

1. `import-service`
   - 解析批量导入文本
   - 校验每行格式
   - 生成导入结果

2. `oauth-service`
   - 用 `refresh_token` 换 `access_token`
   - 处理 token 失效、轮换、替换保存

3. `imap-service`
   - 建立 IMAP 连接
   - 打开收件箱
   - 增量拉取邮件
   - 下载原始 MIME

4. `scheduler-service`
   - 统一扫描待执行邮箱
   - 控制全局并发
   - 调度单邮箱同步任务

5. `event-service`
   - 维护前端订阅连接
   - 推送新邮件事件
   - 推送账户状态变化
   - 推送同步失败和恢复事件

6. `message-service`
   - 保存邮件摘要
   - 保存 `.eml` 原件
   - 读取并解析 HTML / Text / Header

7. `settings-service`
   - 全局默认拉取间隔
   - 全局并发数
   - 默认重试策略
   - 存储目录


## 6. 核心业务流程

### 6.1 批量导入流程

推荐做成两步，而不是“粘贴就直接入库”。

```text
粘贴文本
  -> 逐行解析
  -> 格式校验
  -> 在线验证
  -> 返回逐条结果
  -> 用户确认
  -> 正式写入数据库
```

每条在线验证建议走完整链路：

1. `refresh_token -> access_token`
2. `IMAP OAuth 登录`
3. `SELECT INBOX`
4. 成功后标记为可用

这样“验证通过”才有真实意义。


### 6.2 自动拉取流程

推荐做“定时短连接拉取”，不要一开始就做大量常驻连接。

```text
调度器扫描 next_run_at
  -> 把到期邮箱放入队列
  -> worker 执行一次同步
  -> 刷新 token
  -> IMAP 登录
  -> 拉取新邮件
  -> 保存摘要 + 原始邮件
  -> 产生 new_message / sync_status 事件
  -> 推送到前端
  -> 更新 last_uid / last_sync_at / next_run_at
```

这样更适合多邮箱场景，也更容易控制并发与失败重试。


### 6.3 前端实时更新流程

```text
前端进入页面
  -> 建立 SSE 订阅
  -> 等待后端事件
  -> 收到 new_message
  -> 局部刷新账户状态和邮件列表
  -> 当前账户命中时自动插入新邮件
```

建议推送的事件类型：

- `account_status_changed`
- `sync_started`
- `sync_succeeded`
- `sync_failed`
- `new_message`
- `account_verified`

### 6.4 邮件展示流程

```text
点击邮件
  -> 读取消息摘要
  -> 读取本地 .eml 原件
  -> mailparser 解析
  -> 展示 HTML / Text
  -> 提供原始 MIME / Header 查看
```

这条链路能同时满足两个目标：

1. 页面里读起来方便
2. 原始邮件内容可追溯、可导出、可核验


## 7. 数据模型建议

### 7.1 mail_accounts

建议字段：

- `id`
- `email`
- `display_name`
- `password_raw` 或空
- `client_id`
- `refresh_token_encrypted`
- `tenant`，首版可默认 `common`
- `verify_status`
- `runtime_status`
- `pull_interval_sec`
- `enabled`
- `last_sync_at`
- `last_error`
- `last_uid`
- `uid_validity`
- `created_at`
- `updated_at`


### 7.2 sync_jobs

建议字段：

- `id`
- `account_id`
- `job_type`
- `status`
- `started_at`
- `finished_at`
- `error_message`
- `retry_count`


### 7.3 event_cursor 可选设计

如果后续担心前端断线重连丢事件，可以补一张轻量事件表，首版可选。

建议字段：

- `id`
- `event_type`
- `account_id`
- `message_id`
- `payload_json`
- `created_at`

### 7.4 messages

建议字段：

- `id`
- `account_id`
- `imap_uid`
- `message_id`
- `subject`
- `from_name`
- `from_address`
- `to_addresses`
- `received_at`
- `has_html`
- `has_text`
- `has_attachments`
- `flags_json`
- `headers_json`
- `raw_eml_path`
- `html_cache`
- `text_cache`
- `created_at`


### 7.5 app_settings

建议字段：

- `default_pull_interval_sec`
- `max_concurrency`
- `retry_backoff_sec`
- `storage_root`
- `log_level`


## 8. API 草案

### 8.1 导入与校验

- `POST /api/accounts/import/preview`
  - 输入：批量文本
  - 输出：每行解析结果

- `POST /api/accounts/import/commit`
  - 输入：确认导入的有效项
  - 输出：成功写入的账号列表

- `POST /api/accounts/:id/verify`
  - 重新验证单个邮箱


### 8.2 账户管理

- `GET /api/accounts`
- `PATCH /api/accounts/:id`
  - 修改显示名、备注、拉取间隔、启停状态

- `DELETE /api/accounts/:id`

- `POST /api/accounts/:id/start`
- `POST /api/accounts/:id/stop`


### 8.3 邮件查询

- `GET /api/accounts/:id/messages`
  - 支持分页、关键词、未读筛选

- `GET /api/messages/:id`
  - 返回摘要 + 解析后内容

- `GET /api/messages/:id/raw`
  - 返回原始 MIME / `.eml`

- `GET /api/messages/:id/headers`
  - 返回解析后的头信息


### 8.4 事件订阅

- `GET /api/events/stream`
  - 使用 `SSE`
  - 推送新邮件、同步状态、账号状态变化


### 8.5 系统配置

- `GET /api/settings`
- `PATCH /api/settings`


## 9. 前端界面设计建议

你本地的 `Frontend.html` 很有价值，不是只能参考配色，而是连主框架都可以继承。

当前最适合的产品映射方式是“三栏结构”：

### 9.1 左栏：邮箱控制台

每个邮箱卡片建议展示：

- 显示名
- 邮箱地址
- 校验状态
- 运行状态
- 拉取间隔
- 上次拉取时间
- 最近错误
- 启动 / 停止 / 编辑 / 删除

顶部保留“批量导入邮箱”按钮。


### 9.2 中栏：邮件列表

每条邮件显示：

- 发件人
- 主题
- 接收时间
- 是否包含 HTML
- 是否包含附件

顶部工具建议保留：

- 搜索框
- 拉取间隔设置
- 邮件筛选条件
- 同步状态提示

这里不再放“手动同步”按钮。

当前页面的刷新策略应改成：

1. 首次进入页面时拉一次初始化数据
2. 后续靠 `SSE` 接收新邮件和状态事件
3. 收到事件后局部刷新，不做整页重载


### 9.3 右栏：邮件详情

不要只做正文预览，建议拆成 3 个 Tab：

1. `邮件预览`
2. `HTML 原文`
3. `原始 MIME / Header`

如果后续需要，可以再补：

4. `附件`


### 9.4 当前样式案例哪些能直接复用

可以直接复用：

- 三栏信息架构
- 左侧账户卡片风格
- 顶部工具栏布局
- 邮件列表项视觉层次
- 批量导入弹窗样式

必须重构：

- 自动抓取从单个开关升级为完整任务控制
- 账户列表增加状态体系
- 邮件详情区增加原始内容展示
- 导入流程改成“预校验 + 确认导入”
- 手动同步改成“后端调度 + 前端被动接收推送”
- 移除不必要的“回复”“删除”邮件客户端式动作


## 10. 状态体系建议

### 10.1 账户校验状态

- `未验证`
- `验证中`
- `验证成功`
- `验证失败`
- `token 失效`
- `IMAP 禁用`


### 10.2 运行状态

- `已停止`
- `排队中`
- `同步中`
- `正常`
- `异常`
- `暂停`


## 11. 存储建议

### 11.1 不要只存解析后的正文

建议同时保存两层内容：

1. 数据库存摘要
2. 本地磁盘存 `.eml` 原件

这样做的好处：

1. 邮件列表加载更快
2. 原始邮件可追溯
3. 后续要重新解析 HTML、Text、Header 时不怕信息丢失


### 11.2 敏感字段不要明文裸存

尤其注意：

- `refresh_token`
- 可能无业务价值的 `password`

建议：

- `refresh_token` 至少做本地加密存储
- 如果 `password` 不参与业务主链路，尽量不要长期保存
- 日志里禁止打印 token 和完整原始邮件正文


## 12. 首版实现顺序建议

### 第一阶段：方案落地

1. 建 Node + React 项目骨架
2. 接入 SQLite
3. 完成账户表与基础 API
4. 把 `Frontend.html` 改造成真实 React 页面骨架


### 第二阶段：导入与验证

1. 实现批量导入解析
2. 实现逐条在线验证
3. 把验证结果回显到前端


### 第三阶段：邮件拉取

1. 打通 token 刷新
2. 打通 IMAP 登录
3. 保存消息摘要
4. 下载并保存 `.eml`


### 第四阶段：调度与展示

1. 实现拉取调度器
2. 实现 `SSE` 事件推送
3. 实现启停与间隔配置
4. 实现邮件详情视图
5. 实现原始 MIME 查看


### 第五阶段：桌面打包

1. 接入 Electron
2. 梳理本地存储目录
3. 增加日志路径与异常恢复
4. 产出可执行安装包


## 13. 首版最值得坚持的设计原则

1. 前端只做展示和操作入口，不直接控制后台轮询逻辑
2. 前端默认通过 `SSE` 被动接收新邮件和状态变化
3. 每个邮箱同时只允许一个活跃拉取任务
4. 首版只同步 `INBOX`
5. 首版只做增量拉取，不做全量历史回灌
6. 原始邮件必须保留
7. 错误状态必须对用户可见
8. 密钥与 token 优先考虑本地安全存储


## 14. 当前推荐结论

如果现在就要开始做，建议直接按下面这条主线推进：

```text
React + Vite
  + Fastify
  + ImapFlow
  + MailParser
  + SQLite
  + Electron
```

这是当前最贴合你需求、也最利于后续打包的方案。


## 15. 参考资料

- Microsoft IMAP OAuth:
  - https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth
- Microsoft OAuth refresh token:
  - https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- ImapFlow:
  - https://imapflow.com/docs/api/imapflow-client/
  - https://imapflow.com/docs/guides/fetching-messages/
- MailParser:
  - https://nodemailer.com/extras/mailparser
