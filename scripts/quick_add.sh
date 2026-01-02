#!/bin/bash
# 一键添加电影脚本
# 使用方法: ./scripts/quick_add.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# 加载 .env 文件（如果存在）
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# 检查 TMDB_API_KEY
if [ -z "$TMDB_API_KEY" ]; then
    echo "❌ 错误: 未设置 TMDB_API_KEY"
    echo "请在 .env 文件中添加: TMDB_API_KEY=你的密钥"
    exit 1
fi

echo "🎬 === 快速添加电影 ==="
echo ""

# 1. 添加电影
node scripts/add_movie.js

# 2. 同步 TMDB 数据
echo ""
echo "📡 正在同步 TMDB 数据..."
node scripts/fetch_movies.js

# 3. 询问是否提交 Git
echo ""
read -p "✅ 同步完成！是否提交并推送到 GitHub？(y/n): " confirm

if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
    git add data/
    git commit -m "🎬 更新观影记录 $(date +%Y-%m-%d)"
    git push
    echo ""
    echo "🚀 已推送到 GitHub！网站将自动更新。"
else
    echo ""
    echo "📁 数据已保存到本地，稍后可手动提交。"
fi
