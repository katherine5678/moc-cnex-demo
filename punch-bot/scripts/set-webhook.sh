#!/usr/bin/env bash
# 設定 Telegram webhook 指向部署好的 Worker
# 用法：TELEGRAM_BOT_TOKEN=xxx TELEGRAM_WEBHOOK_SECRET=yyy ./scripts/set-webhook.sh https://punch-bot.<你的子網域>.workers.dev
set -euo pipefail

WORKER_URL="${1:?請提供 Worker 網址，例如 https://punch-bot.xxx.workers.dev}"
: "${TELEGRAM_BOT_TOKEN:?請設定 TELEGRAM_BOT_TOKEN}"
: "${TELEGRAM_WEBHOOK_SECRET:?請設定 TELEGRAM_WEBHOOK_SECRET}"

curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=${WORKER_URL%/}/telegram" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  -d 'allowed_updates=["message","callback_query"]'
echo
