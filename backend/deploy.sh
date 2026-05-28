#!/bin/bash
# deploy.sh — 将前端文件同步到 public/ 目录（方案 A，R-24）
# 每次更新代码后执行此脚本以刷新前端静态文件

set -e

REPO_ROOT="/home/ubuntu/NPC-"
PUBLIC_DIR="${REPO_ROOT}/public"

echo "▶ 同步前端文件到 ${PUBLIC_DIR}..."
mkdir -p "${PUBLIC_DIR}"

# rsync 仅同步前端白名单文件类型（避免误暴露 .py / .md / .bat / config.local.js 等）
rsync -av --delete \
  --include='*.html' \
  --include='*.js' \
  --include='*.css' \
  --include='*.png' \
  --include='*.jpg' \
  --include='*.jpeg' \
  --include='*.ico' \
  --include='*.svg' \
  --include='*.woff' \
  --include='*.woff2' \
  --exclude='config.local.js' \
  --exclude='*' \
  "${REPO_ROOT}/" "${PUBLIC_DIR}/"

echo "✓ 前端文件已同步到 ${PUBLIC_DIR}"
echo "  如需刷新浏览器缓存，请在文件名中更新版本号参数（?v=日期）"
