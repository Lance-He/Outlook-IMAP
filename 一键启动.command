#!/bin/zsh

set -u

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR" || exit 1

pause_on_error() {
  echo ""
  echo "启动失败，按回车退出..."
  read
}

trap 'pause_on_error' ERR
set -e

echo "======================================"
echo " Outlook IMAP 控制台 一键启动"
echo "======================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js，请先安装 Node.js 20+"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "未检测到 npm，请先安装 npm"
  exit 1
fi

echo "项目目录: $PROJECT_DIR"
echo "Node 版本: $(node -v)"
echo "npm 版本: $(npm -v)"
echo ""

mkdir -p data/messages

if [ ! -d node_modules ]; then
  echo "首次启动，正在安装依赖..."
  npm install
  echo ""
fi

echo "前端地址: http://127.0.0.1:5173"
echo "后端地址: http://127.0.0.1:3030"
echo ""
echo "正在启动前后端服务..."
echo "关闭本窗口即可停止服务。"
echo ""

npm run dev
