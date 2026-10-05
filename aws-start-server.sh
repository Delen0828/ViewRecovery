#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8001}"
# Retain the existing PM2 name so upgrades replace the previous PHP service.
PM2_NAME="${PM2_NAME:-php-server-nontrack}"
source "$APP_DIR/scripts/server-common.sh"
require_command pm2
prepare_server

# A failed build leaves the existing PM2 process running.
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
    pm2 delete "$PM2_NAME"
fi
echo "Starting ViewRecovery on $HOST:$PORT under PM2 ($PM2_NAME)..."
pm2 start "$SERVE_BIN" --name "$PM2_NAME" --cwd "$APP_DIR" --interpreter "$NODE_BIN"
