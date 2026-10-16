#!/bin/sh

set -eu

SUBSCRIPTION_URL="http://192.168.50.152:37077/sub/api/config?type=mihomo"

# 目录路径
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_FILE="$PROJECT_DIR/config/config-temp.yaml"
CONFIG_FILE="$PROJECT_DIR/config/config.yaml"

rm -rf "$TARGET_FILE"

# 从订阅链接下载配置文件
curl \
  --fail \
  --location \
  --silent \
  --show-error \
  --connect-timeout 15 \
  --max-time 120 \
  --output "$TARGET_FILE" \
  "$SUBSCRIPTION_URL"

# 检查下载的文件是否存在且非空
if [ ! -s "$TARGET_FILE" ]; then
  echo "Downloaded subscription is empty" >&2
  exit 1
fi

# 检查下载的文件是否包含 "proxies:" 字段，判断是否为 Mihomo proxy-provider 配置
if ! grep -Eq '^[[:space:]]*proxies:' "$TARGET_FILE"; then
  echo "Downloaded file is not a Mihomo proxy-provider configuration" >&2
  exit 1
fi

# 替换原有的配置文件
rm -rf "$CONFIG_FILE"
mv "$TARGET_FILE" "$CONFIG_FILE"

# 判断 Mihomo 是否正在运行，如果没有运行则启动 Mihomo，# 否则直接执行 docker restart mihomo
if ! docker ps --filter "name=mihomo" | grep -q "mihomo"; then
  echo "Mihomo is not running, starting Mihomo..."
  cd "$PROJECT_DIR" && docker-compose up -d
  echo "Mihomo started"
else
  echo "Mihomo is running, restarting Mihomo..."
  docker restart mihomo
fi

exit 0

