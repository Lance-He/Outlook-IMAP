# Outlook IMAP Mail Collector

一个本地运行的 Outlook IMAP OAuth 多邮箱邮件采集工具。

当前项目采用 `React + Vite` 前端和 `Node.js + Fastify` 后端，支持批量导入多个 Outlook IMAP OAuth 账户、后端统一调度自动抓取、实时推送新邮件到网页、查看 HTML 邮件内容以及原始 MIME 内容。

## 项目特性

- 批量导入 Outlook IMAP OAuth 账户
- 导入格式固定为：`邮箱----密码----client_id----refresh_token`
- 导入后端异步验证，界面可显示 `导入中 / 导入失败 / 等待中 / 正常 / 同步中 / 异常`
- 后端统一调度自动抓取，不依赖前端页面轮询
- 全局唯一抓取间隔，修改后对所有启用账户立即生效，并从保存时刻重新计时
- 通过 `SSE` 将账户状态变化和新邮件事件实时推送到前端
- 支持查看邮件列表、HTML 正文预览、纯文本正文、原始 MIME 内容
- 所有运行时数据保存在本地 `data/` 目录，不依赖远程数据库

## 当前技术栈

- 前端：`React 19`、`Vite 6`、`TypeScript`、`Tailwind CSS`
- 后端：`Node.js`、`Fastify 5`、`TypeScript`
- IMAP：`imapflow`
- 邮件解析：`mailparser`
- 数据存储：`SQLite`（`better-sqlite3`）
- 实时推送：`SSE`

## 当前目录结构

```text
.
├── backend/                  # Fastify API、IMAP 拉取、调度器、SQLite 逻辑
├── frontend/                 # React + Vite 前端
├── data/                     # 本地数据目录（数据库、密钥、邮件原文）
├── Frontend.html             # 用户提供的样式母版
├── 一键启动.command          # macOS 一键启动脚本
├── package.json              # workspaces 根配置
└── README.md
```

## 当前运行方式说明

当前项目最稳定的运行方式是：

1. 启动后端 API：`127.0.0.1:3030`
2. 启动前端 Vite 开发服务：`127.0.0.1:5173`
3. 前端通过 Vite 代理访问 `/api`

也就是说，**当前项目主要以开发模式运行**。  
`npm run build` 已经可以通过，用来做构建验证；但后端目前**不会直接托管前端构建产物**，所以如果你要长期部署或打包桌面端，还需要额外接一层静态资源托管或 Electron 外壳。

## 环境要求

推荐环境：

- `Node.js 20+`
- `npm 10+`

当前这台机器已验证版本：

- `Node.js v22.14.0`
- `npm 10.9.2`

如果你在 Ubuntu / Windows 上第一次安装依赖时遇到 `better-sqlite3` 本地编译问题，请先补齐各平台的编译工具链，下面会分别说明。

## 一键启动（macOS）

macOS 下可以直接使用仓库根目录自带的启动脚本：

```bash
./一键启动.command
```

这个脚本会：

1. 检查 `node` / `npm`
2. 首次运行时自动执行 `npm install`
3. 自动创建 `data/messages`
4. 启动前后端开发服务

启动后默认地址：

- 前端：`http://127.0.0.1:5173`
- 后端：`http://127.0.0.1:3030`

## macOS 运行说明

### 1. 安装依赖

如果你还没有安装 Node.js，推荐直接安装 Node.js 20 或 22。

安装完成后在项目根目录执行：

```bash
npm install
```

### 2. 启动项目

```bash
npm run dev
```

或者：

```bash
./一键启动.command
```

### 3. 打开页面

浏览器访问：

```text
http://127.0.0.1:5173
```

## Ubuntu 运行说明

### 1. 安装 Node.js 与构建工具

建议使用 Node.js 20 或 22。  
如果系统还没有基础编译工具，先执行：

```bash
sudo apt update
sudo apt install -y build-essential python3 make g++
```

然后安装 Node.js（方式任选其一）：

- 使用你常用的 Node 版本管理器
- 或直接安装官方 Node.js 发行版

### 2. 安装依赖

进入项目根目录后执行：

```bash
npm install
mkdir -p data/messages
```

### 3. 启动项目

```bash
npm run dev
```

### 4. 访问地址

```text
http://127.0.0.1:5173
```

如果你想改监听地址，可以通过环境变量控制后端：

```bash
HOST=0.0.0.0 PORT=3030 npm run dev:backend
```

注意：前端当前默认是 `127.0.0.1:5173`，如果要暴露给局域网访问，还需要同时调整 Vite 启动参数或配置。

## Windows 运行说明

### 1. 安装 Node.js

请先安装 Node.js 20 或 22，安装时确保 `npm` 一并可用。

### 2. 如有需要，补齐本地编译工具

如果 `npm install` 在 `better-sqlite3` 阶段失败，通常是因为缺少本地编译环境。  
可以安装：

- Visual Studio Build Tools
- 或 Visual Studio 的 C++ 构建组件

### 3. 安装依赖

在 PowerShell 中进入项目目录后执行：

```powershell
npm install
New-Item -ItemType Directory -Force data/messages | Out-Null
```

### 4. 启动项目

```powershell
npm run dev
```

### 5. 打开页面

浏览器访问：

```text
http://127.0.0.1:5173
```

## 常用开发命令

### 根目录

```bash
npm install
npm run dev
npm run build
```

### 单独启动后端

```bash
npm run dev:backend
```

### 单独启动前端

```bash
npm run dev:frontend
```

### 仅做构建验证

```bash
npm run build
```

## 数据与本地文件

当前项目所有运行时数据都放在根目录 `data/` 下：

- `data/mail-collector.db`
  - SQLite 主数据库
- `data/app-secret.key`
  - 本地加密密钥
- `data/messages/`
  - 邮件原文 `.eml` 文件

这些文件都属于**本地敏感数据**，不应该上传到公开仓库。  
项目根目录已经配置了 `.gitignore` 来忽略这些内容。

## 导入格式

批量导入时，每行一条，格式必须严格为：

```text
邮箱----密码----client_id----refresh_token
```

例如：

```text
demo@outlook.com----password123----9e5f94bc-e8a4-4e73-b8be-63364c29d753----M.C532_xxx
```

说明：

- 后端真正用于 Outlook IMAP OAuth 登录的核心字段是：
  - `邮箱`
  - `client_id`
  - `refresh_token`
- `密码` 当前保留在导入格式里，主要用于兼容你要求的统一输入结构

## 当前页面功能

当前前端已经覆盖这些核心能力：

- 批量导入账户
- 账户列表展示
- 账户备注编辑
- 账户显示名编辑
- 启动 / 停止自动抓取
- 手动触发一次同步
- 查看邮件列表
- 查看邮件 HTML 正文
- 查看原始 MIME 内容
- 系统配置：
  - 全局抓取间隔
  - 并发同步上限
  - 失败重试等待时间

## 当前后端接口概览

### 健康检查

- `GET /api/health`

### 系统设置

- `GET /api/settings`
- `PATCH /api/settings`

### 账户管理

- `GET /api/accounts`
- `POST /api/accounts/import/preview`
- `POST /api/accounts/import/commit`
- `PATCH /api/accounts/:id`
- `POST /api/accounts/:id/start`
- `POST /api/accounts/:id/stop`
- `POST /api/accounts/:id/sync`
- `DELETE /api/accounts/:id`

### 邮件读取

- `GET /api/accounts/:id/messages`
- `GET /api/messages/:id`
- `GET /api/messages/:id/raw`

### 实时事件

- `GET /api/events/stream`

## 环境变量（可选）

后端支持以下环境变量：

- `HOST`
  - 后端监听地址，默认 `127.0.0.1`
- `PORT`
  - 后端端口，默认 `3030`
- `DATA_ROOT`
  - 数据目录，默认是项目根目录下的 `data`
- `DEFAULT_PULL_INTERVAL_SEC`
  - 应用首次初始化时的默认全局抓取间隔，默认 `60`
- `MAX_CONCURRENCY`
  - 应用首次初始化时的默认并发数，默认 `3`
- `RETRY_BACKOFF_SEC`
  - 应用首次初始化时的默认失败重试等待时间，默认 `30`
- `SCHEDULER_TICK_MS`
  - 调度器扫描周期，默认 `5000`

注意：

- 这些值主要作用于**首次初始化**或后端运行层
- 页面里保存过系统配置后，SQLite 中的设置会成为主要来源

## 当前限制

当前项目还存在这些明确边界：

- 仅支持 Outlook IMAP OAuth 这条主链路
- 当前以本地开发模式运行最稳定
- 后端不直接托管前端构建产物
- 尚未做 Electron 打包
- 尚未做附件下载管理、邮件回复、文件夹管理等扩展功能

## 安全建议

如果你准备把项目开源：

1. 不要提交 `data/` 目录里的任何真实数据
2. 不要提交真实邮箱、真实 `refresh_token`、真实 `client_id`
3. 提交前检查 `.gitignore` 是否生效
4. 如果敏感文件曾经被 Git 跟踪过，需要执行 `git rm --cached`

## 当前开源状态建议

适合开源的内容：

- 前后端源码
- 启动脚本
- README
- 样式母版 `Frontend.html`

不适合开源的内容：

- 本地数据库
- 本地邮件原文
- 本地密钥
- 任何真实测试邮箱配置

## 说明

这个仓库当前重点是：

- 先把本地多邮箱接收、调度、预览这条主链路做稳定
- 后续再考虑桌面打包、部署形态和更丰富的邮件能力

如果你是第一次接手这个项目，建议先按本文档的开发模式跑起来，再开始改功能。
